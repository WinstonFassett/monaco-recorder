// Minimal Monaco Recorder/Playback library (ES module)
// Agnostic to Monaco initialization. You pass an editor instance and the monaco namespace.

export class MonacoRecorder {
  constructor(editor, monaco, options = {}) {
    if (!editor || !monaco) throw new Error('MonacoRecorder requires editor and monaco');
    this.editor = editor;
    this.monaco = monaco;
    this.options = {
      captureCursor: true,
      captureSelection: false,
      captureKeys: false, // optional; not needed for basic POC
      ...options,
    };

    this._disposers = [];
    this._startTs = 0;
    this._events = [];

    this._playing = false;
    this._playIdx = 0;
    this._playTimers = new Set();
    this._onProgress = null;
    this._onDone = null;

    this._inputCleanup = null;
  }

  get events() {
    return this._events.slice();
  }

  now() {
    return Date.now();
  }

  _stamp(event) {
    this._events.push({ ...event, timestamp: this.now() - this._startTs });
  }

  start() {
    this.stop();
    this._events = [];
    this._startTs = this.now();

    // Initial snapshot to make playback deterministic
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    const selection = this.editor.getSelection();
    this._stamp({
      type: 'initialState',
      content: model?.getValue() || '',
      position: position ? { lineNumber: position.lineNumber, column: position.column } : null,
      selection: selection
        ? {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          }
        : null,
    });

    // Content changes
    const d1 = this.editor.onDidChangeModelContent((e) => {
      const payload = {
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
      };
      this._stamp(payload);
    });

    this._disposers.push(d1);

    // Cursor position
    if (this.options.captureCursor) {
      const d2 = this.editor.onDidChangeCursorPosition((e) => {
        this._stamp({
          type: 'cursorPosition',
          position: { lineNumber: e.position.lineNumber, column: e.position.column },
        });
      });
      this._disposers.push(d2);
    }

    // Selection change (optional)
    if (this.options.captureSelection) {
      const d3 = this.editor.onDidChangeCursorSelection((e) => {
        const s = e.selection;
        this._stamp({
          type: 'cursorSelection',
          selection: {
            startLineNumber: s.startLineNumber,
            startColumn: s.startColumn,
            endLineNumber: s.endLineNumber,
            endColumn: s.endColumn,
          },
        });
      });
      this._disposers.push(d3);
    }

    // Optional key capture (not necessary for core POC)
    if (this.options.captureKeys) {
      this._attachInputKeyCapture();
    }

    return () => this.stop();
  }

  stop() {
    // Detach listeners
    while (this._disposers.length) {
      try {
        const d = this._disposers.pop();
        d?.dispose?.();
      } catch {}
    }
    if (this._inputCleanup) {
      try { this._inputCleanup(); } catch {}
      this._inputCleanup = null;
    }
    return this.events;
  }

  _attachInputKeyCapture() {
    try {
      const container = this.editor.getContainerDomNode?.();
      const input = container?.querySelector?.('.monaco-editor textarea.inputarea');
      if (!input) return;
      const handler = (e) => {
        // Only record navigation/modifier keys for POC
        const nav = [
          'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Tab','Enter','Escape'
        ];
        const isModifier = ['Control','Shift','Alt','Meta'].includes(e.key);
        if (nav.includes(e.key) || isModifier || e.ctrlKey || e.altKey || e.metaKey) {
          this._stamp({
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
      this._inputCleanup = () => input.removeEventListener('keydown', handler, true);
    } catch {}
  }

  // Playback API
  play(recording, opts = {}) {
    this.stopPlayback();
    const events = Array.isArray(recording) ? recording : this._events;
    if (!events.length) return;

    const {
      speed = 200, // percent
      minDelayMs = 0,
      maxDelayMs = 1000,
      onProgress = null,
      onDone = null,
    } = opts;

    this._playing = true;
    this._playIdx = 0;
    this._onProgress = onProgress;
    this._onDone = onDone;

    // Reset to initial state if present
    const initial = events.find((e) => e.type === 'initialState');
    if (initial) {
      this._applyInitial(initial);
    }

    // Schedule all subsequent events relative to timestamps
    const baseTs = initial ? initial.timestamp : 0;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'initialState') continue;
      const rawDelay = Math.max(0, ev.timestamp - baseTs);
      const scaled = Math.floor(rawDelay * (100 / Math.max(1, speed)));
      const clamped = Math.min(Math.max(scaled, minDelayMs), Math.max(minDelayMs, maxDelayMs));
      const t = setTimeout(() => this._executeEvent(i, events), clamped);
      this._playTimers.add(t);
    }

    // Completion watchdog at the last delay
    const lastTs = events[events.length - 1].timestamp - baseTs;
    const lastScaled = Math.floor(lastTs * (100 / Math.max(1, speed)));
    const lastClamped = Math.min(Math.max(lastScaled, minDelayMs), Math.max(minDelayMs, maxDelayMs));
    const endTimer = setTimeout(() => this._complete(), lastClamped + 10);
    this._playTimers.add(endTimer);
  }

  stopPlayback() {
    this._playing = false;
    for (const t of this._playTimers) clearTimeout(t);
    this._playTimers.clear();
  }

  _progress(currentIndex, total) {
    this._onProgress?.(currentIndex, total);
  }

  _complete() {
    this.stopPlayback();
    this._onDone?.();
  }

  _applyInitial(initial) {
    const model = this.editor.getModel();
    if (model && typeof initial.content === 'string') {
      this.editor.pushUndoStop();
      model.pushEditOperations([], [
        { range: model.getFullModelRange(), text: initial.content }
      ], () => null);
      this.editor.pushUndoStop();
    }
    if (initial.position) this.editor.setPosition(initial.position);
    if (initial.selection) this.editor.setSelection(initial.selection);
  }

  _executeEvent(index, events) {
    if (!this._playing) return;
    const ev = events[index];
    if (!ev) return;

    switch (ev.type) {
      case 'contentChange': {
        const edits = ev.changes.map((c) => ({
          range: new this.monaco.Range(
            c.range.startLineNumber,
            c.range.startColumn,
            c.range.endLineNumber,
            c.range.endColumn
          ),
          text: c.text,
          forceMoveMarkers: true,
        }));
        try {
          this.editor.executeEdits('monaco-recorder:replay', edits);
        } catch {}
        break;
      }
      case 'cursorPosition': {
        try { this.editor.setPosition(ev.position); } catch {}
        break;
      }
      case 'cursorSelection': {
        try { this.editor.setSelection(ev.selection); } catch {}
        break;
      }
      case 'keyDown': {
        // Optional: could synthesize commands here if desired
        break;
      }
      default:
        break;
    }

    this._playIdx = index + 1;
    this._progress(this._playIdx, events.length);
  }
}

export default MonacoRecorder;
