// Monaco Recorder/Playback (function-based, framework-agnostic)
// Usage:
//   const rec = createMonacoRecorder(editor, monaco, { captureSelection: false, captureKeys: false })
//   const stop = rec.start()
//   const events = stop()
//   rec.play(events, { speed: 200, minDelayMs: 0, maxDelayMs: 1000, onProgress, onDone })

export function createMonacoRecorder(editor, monaco, options = {}) {
  if (!editor || !monaco) throw new Error('createMonacoRecorder requires editor and monaco');

  const opts = {
    captureCursor: true,
    captureSelection: false,
    captureKeys: false,
    ...options,
  };

  let disposers = [];
  let startTs = 0;
  let events = [];
  let inputCleanup = null;

  // Playback state
  let playing = false;
  const timers = new Set();

  function now() { return Date.now(); }
  function stamp(ev) { events.push({ ...ev, timestamp: now() - startTs }); }

  function attachKeyCapture() {
    try {
      const container = editor.getContainerDomNode?.();
      const input = container?.querySelector?.('.monaco-editor textarea.inputarea');
      if (!input) return;
      const handler = (e) => {
        const nav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Tab','Enter','Escape'];
        const isModifier = ['Control','Shift','Alt','Meta'].includes(e.key);
        if (nav.includes(e.key) || isModifier || e.ctrlKey || e.altKey || e.metaKey) {
          stamp({
            type: 'keyDown',
            key: e.key,
            code: e.code,
            ctrlKey: !!e.ctrlKey,
            metaKey: !!e.metaKey,
            altKey: !!e.altKey,
            shiftKey: !!e.shiftKey,
          });
        }
      };
      input.addEventListener('keydown', handler, true);
      inputCleanup = () => input.removeEventListener('keydown', handler, true);
    } catch {}
  }

  function start() {
    stop();
    events = [];
    startTs = now();

    // Initial snapshot
    const model = editor.getModel();
    const position = editor.getPosition();
    const selection = editor.getSelection();
    stamp({
      type: 'initialState',
      content: model?.getValue() || '',
      position: position ? { lineNumber: position.lineNumber, column: position.column } : null,
      selection: selection ? {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      } : null,
    });

    // Content changes
    const d1 = editor.onDidChangeModelContent((e) => {
      stamp({
        type: 'contentChange',
        changes: e.changes.map((c) => ({
          range: {
            startLineNumber: c.range.startLineNumber,
            startColumn: c.range.startColumn,
            endLineNumber: c.range.endLineNumber,
            endColumn: c.range.endColumn,
          },
          text: c.text,
          rangeLength: c.rangeLength,
        })),
        versionId: e.versionId,
      });
    });
    disposers.push(d1);

    // Cursor position
    if (opts.captureCursor) {
      const d2 = editor.onDidChangeCursorPosition((e) => {
        stamp({ type: 'cursorPosition', position: { lineNumber: e.position.lineNumber, column: e.position.column } });
      });
      disposers.push(d2);
    }

    // Selection
    if (opts.captureSelection) {
      const d3 = editor.onDidChangeCursorSelection((e) => {
        const s = e.selection;
        stamp({ type: 'cursorSelection', selection: {
          startLineNumber: s.startLineNumber,
          startColumn: s.startColumn,
          endLineNumber: s.endLineNumber,
          endColumn: s.endColumn,
        }});
      });
      disposers.push(d3);
    }

    if (opts.captureKeys) attachKeyCapture();

    // Return a stop function for convenience
    return stop;
  }

  function stop() {
    while (disposers.length) {
      try { disposers.pop()?.dispose?.(); } catch {}
    }
    if (inputCleanup) { try { inputCleanup(); } catch {} inputCleanup = null; }
    return getEvents();
  }

  function getEvents() { return events.slice(); }

  function stopPlayback() {
    playing = false;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function applyInitial(initial) {
    const model = editor.getModel();
    if (model && typeof initial.content === 'string') {
      editor.pushUndoStop();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: initial.content }], () => null);
      editor.pushUndoStop();
    }
    if (initial.position) editor.setPosition(initial.position);
    if (initial.selection) editor.setSelection(initial.selection);
  }

  function execEvent(ev) {
    switch (ev.type) {
      case 'contentChange': {
        const edits = ev.changes.map((c) => ({
          range: new monaco.Range(
            c.range.startLineNumber,
            c.range.startColumn,
            c.range.endLineNumber,
            c.range.endColumn
          ),
          text: c.text,
          forceMoveMarkers: true,
        }));
        try { editor.executeEdits('monaco-recorder:replay', edits); } catch {}
        break;
      }
      case 'cursorPosition':
        try { editor.setPosition(ev.position); } catch {}
        break;
      case 'cursorSelection':
        try { editor.setSelection(ev.selection); } catch {}
        break;
      case 'keyDown':
        // Optional: synthesize commands here if desired
        break;
      default:
        break;
    }
  }

  // Schedule with deltas so long gaps are preserved, but allow optional per-step clamps
  function play(recording, opts = {}) {
    stopPlayback();
    const list = Array.isArray(recording) ? recording.slice() : events.slice();
    if (!list.length) return;

    const {
      speed = 200, // percent (200 = 2x faster)
      minDelayMs = 0,
      maxDelayMs = Infinity,
      onProgress = null,
      onDone = null,
    } = opts;

    playing = true;

    // Ensure initial is applied immediately
    const initial = list.find((e) => e.type === 'initialState');
    if (initial) applyInitial(initial);

    // Sort by timestamp to be safe (stable)
    list.sort((a, b) => a.timestamp - b.timestamp);

    // Build a list of events to play (skip initial in stream)
    const toPlay = list.filter((e) => e.type !== 'initialState');
    if (!toPlay.length) { onDone?.(); return; }

    const scale = (ms) => Math.floor(ms * (100 / Math.max(1, speed)));

    let prevTs = initial ? initial.timestamp : toPlay[0].timestamp;
    let cumulative = 0;

    toPlay.forEach((ev, idx) => {
      const rawDelta = Math.max(0, ev.timestamp - prevTs);
      const scaled = scale(rawDelta);
      const clamped = Math.min(Math.max(scaled, minDelayMs), maxDelayMs);
      cumulative += clamped;
      prevTs = ev.timestamp;

      const t = setTimeout(() => {
        if (!playing) return;
        execEvent(ev);
        onProgress?.(idx + 1, toPlay.length);
        if (idx === toPlay.length - 1) {
          stopPlayback();
          onDone?.();
        }
      }, cumulative);
      timers.add(t);
    });
  }

  return {
    start,
    stop,
    getEvents,
    play,
    stopPlayback,
  };
}

export default createMonacoRecorder;
