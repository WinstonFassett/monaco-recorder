// Monaco Recorder/Playback (framework-agnostic, ES module)
// API:
//   import createMonacoRecorder from './src/monaco-recorder.js'
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
    captureSuggest: true,
    ...options,
  };

  // --- Recorder state ---
  let disposers = [];
  let startTs = 0;
  let events = [];
  let inputCleanup = null;
  let suggestPoll = null;
  let lastSuggestVisible = false;
  let lastSuggestState = 0;
  let suggestDetectionCleanup = null;
  const keyboardBuffer = [];

  // Suggest hook originals to restore
  let originalListSetFocus = null;
  let originalAcceptSelected = null;
  let patchedSuggestController = null;

  // --- Playback state ---
  let playing = false;
  const timers = new Set();

  // --- Utility ---
  function now() { return Date.now(); }
  function stamp(ev) { events.push({ ...ev, timestamp: now() - startTs }); }

  // --- Recording: helpers ---
  function getSuggestParts() {
    try {
      const ctrl = editor.getContribution('editor.contrib.suggestController');
      const widget = ctrl?._widget?.value;
      const list = widget?._list;
      return { ctrl, widget, list };
    } catch {
      return {};
    }
  }

  function startSuggestPolling() {
    if (!opts.captureSuggest) return;
    lastSuggestVisible = false;
    suggestPoll = setInterval(() => {
      const { widget, list } = getSuggestParts();
      const visible = !!(widget?.isVisible?.() && (list?._items?.length || 0) > 0);
      const state = widget?._state || 0;
      if (state !== lastSuggestState) {
        // Opening heuristic
        if (state >= 2 && visible && lastSuggestState < 2) {
          stamp({ type: 'suggestInferredOpen', method: 'polling', state, recentKeys: keyboardBuffer.slice(-3) });
        }
        // Closing heuristic
        if (state === 0 && !visible && lastSuggestState === 2) {
          stamp({ type: 'suggestHide', method: 'polling', state });
        }
        lastSuggestState = state;
      }
      if (visible !== lastSuggestVisible) {
        lastSuggestVisible = visible;
        stamp({ type: visible ? 'suggestShow' : 'suggestHide', method: 'poll' });
      }
    }, 50);
  }

  function setupSuggestionMenuDetection() {
    if (!opts.captureSuggest) return () => {};
    try {
      const container = editor.getContainerDomNode?.();
      if (!container) return () => {};

      let widgetEl = null;
      let lastVisible = false;

      const isWidgetVisible = (el) => {
        if (!el) return false;
        const attr = el.getAttribute('monaco-visible-content-widget');
        const style = el.style || {};
        const ariaHidden = el.getAttribute('aria-hidden');
        const visibleByAttr = attr === 'true';
        const visibleByStyle = (style.display !== 'none' && style.visibility !== 'hidden');
        const inLayout = el.offsetParent !== null || (el.getClientRects?.().length || 0) > 0;
        const ariaOk = ariaHidden !== 'true';
        return (visibleByAttr || visibleByStyle) && ariaOk && inLayout;
      };

      const handleVisibilityFlip = (reason) => {
        if (!widgetEl) return;
        const visible = isWidgetVisible(widgetEl);
        if (visible === lastVisible) return;
        lastVisible = visible;
        if (visible) {
          stamp({ type: 'suggestShow', method: 'attr-observer', reason, recentKeys: keyboardBuffer.slice(-3) });
        } else {
          stamp({ type: 'suggestHide', method: 'attr-observer', reason });
        }
      };

      const attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes') handleVisibilityFlip(m.attributeName);
        }
      });

      const watchWidgetAttributes = () => {
        if (!widgetEl) return;
        lastVisible = isWidgetVisible(widgetEl);
        attrObserver.observe(widgetEl, {
          attributes: true,
          attributeFilter: ['style', 'aria-hidden', 'monaco-visible-content-widget'],
          subtree: false,
        });
      };

      const findWidget = () => {
        widgetEl = container.querySelector?.('.editor-widget.suggest-widget[widgetid="editor.widget.suggestWidget"]') ||
                   container.querySelector?.('.editor-widget.suggest-widget') ||
                   document.querySelector('.editor-widget.suggest-widget');
        if (widgetEl) watchWidgetAttributes();
      };

      const treeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node.matches?.('.editor-widget.suggest-widget') ? node : node.querySelector?.('.editor-widget.suggest-widget');
              if (el) {
                widgetEl = el;
                if (isWidgetVisible(el)) {
                  stamp({ type: 'suggestInferredOpen', method: 'dom-mutation', recentKeys: keyboardBuffer.slice(-3) });
                }
                watchWidgetAttributes();
              }
            }
          });
          mutation.removedNodes.forEach((node) => {
            if (node === widgetEl || node.querySelector?.('.editor-widget.suggest-widget')) {
              stamp({ type: 'suggestInferredClose', method: 'dom-mutation' });
              try { attrObserver.disconnect(); } catch {}
              widgetEl = null;
              lastVisible = false;
            }
          });
        });
      });

      treeObserver.observe(container, { childList: true, subtree: true });
      findWidget();

      return () => { try { treeObserver.disconnect(); } catch {}; try { attrObserver.disconnect(); } catch {} };
    } catch { return () => {}; }
  }

  function setupSuggestHooks() {
    if (!opts.captureSuggest) return;
    try {
      const ctrl = editor.getContribution('editor.contrib.suggestController');
      if (!ctrl) return;
      patchedSuggestController = ctrl;
      const widget = ctrl?._widget?.value;
      const list = widget?._list;

      // Patch focus to record which item is focused
      if (list && !originalListSetFocus) {
        const orig = list.setFocus?.bind(list) || null;
        if (orig) {
          originalListSetFocus = orig;
          list.setFocus = function(indexes) {
            const idx = Array.isArray(indexes) ? indexes[0] : -1;
            const it = list._items?.[idx];
            if (it?.suggestion) {
              stamp({
                type: 'suggestFocus',
                index: idx,
                item: {
                  label: it.suggestion.label,
                  kind: it.suggestion.kind,
                  insertText: it.suggestion.insertText,
                },
              });
            }
            return orig(indexes);
          };
        }
      }

      // Wrap acceptance to record the selected item
      if (ctrl.acceptSelectedSuggestion && !originalAcceptSelected) {
        const origAccept = ctrl.acceptSelectedSuggestion.bind(ctrl);
        originalAcceptSelected = origAccept;
        ctrl.acceptSelectedSuggestion = function(...args) {
          let selected = null;
          try {
            const w = ctrl._widget?.value;
            selected = w?.getFocusedItem?.()?.item ||
                       w?._list?.getFocusedElements?.()?.[0] ||
                       w?._list?.getSelectedElements?.()?.[0] || null;
          } catch {}
          stamp({
            type: 'suggestAccept',
            method: 'acceptSelectedSuggestion',
            item: selected?.suggestion ? {
              label: selected.suggestion.label,
              kind: selected.suggestion.kind,
              insertText: selected.suggestion.insertText,
            } : null,
          });
          return origAccept(...args);
        };
      }
    } catch {}
  }

  function attachKeyCapture() {
    if (!opts.captureKeys && !opts.captureSuggest) return;
    try {
      const container = editor.getContainerDomNode?.();
      const input = container?.querySelector?.('.monaco-editor textarea.inputarea');
      if (!input) return;

      const handler = (e) => {
        try {
          keyboardBuffer.push({ key: e.key, code: e.code });
          if (keyboardBuffer.length > 20) keyboardBuffer.shift();
        } catch {}
        // Stamp navigation/modifier keys for context
        const nav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Tab','Enter','Escape'];
        const isModifier = ['Control','Shift','Alt','Meta'].includes(e.key);
        if (opts.captureKeys && (nav.includes(e.key) || isModifier || e.ctrlKey || e.altKey || e.metaKey)) {
          stamp({ type: 'keyDown', key: e.key, code: e.code, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey });
        }

        if (!opts.captureSuggest) return;

        // Detect common triggers ("." and Ctrl/Cmd+Space)
        const ctrlSpace = (e.ctrlKey || e.metaKey) && e.key === ' ';
        if (e.key === '.' || ctrlSpace) {
          setTimeout(() => {
            const { widget, list } = getSuggestParts();
            if (widget?.isVisible?.() && (list?._items?.length || 0) > 0) {
              stamp({ type: 'suggestTriggered', method: 'keyboard-trigger', triggerKey: ctrlSpace ? 'Ctrl+Space' : '.', recentKeys: keyboardBuffer.slice(-3) });
            }
          }, 40);
        }

        // While visible, capture navigation and accept intent
        const { widget, list } = getSuggestParts();
        const visible = widget?.isVisible?.();
        if (visible && list) {
          const focusIdx = (list.getFocus?.() || [])[0] ?? -1;
          const items = list._items || [];
          const labelAt = (i) => (items[i]?.suggestion?.label ?? null);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            stamp({ type: 'suggestNavigate', direction: e.key === 'ArrowDown' ? 'down' : 'up', fromIndex: focusIdx, fromLabel: labelAt(focusIdx) });
          } else if (e.key === 'Enter') {
            // acceptance intent (actual accept recorded by wrapped method)
            stamp({ type: 'suggestAcceptIntent', index: focusIdx, label: labelAt(focusIdx) });
          } else if (e.key === 'Escape') {
            stamp({ type: 'suggestHide', method: 'esc' });
          }
        }
      };

      input.addEventListener('keydown', handler, true);
      inputCleanup = () => input.removeEventListener('keydown', handler, true);
    } catch {}
  }

  // --- Recording: public ---
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
      const { widget, list } = getSuggestParts();
      const duringSuggest = !!(widget?.isVisible?.() && (list?._items?.length || 0) > 0);
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
        })),
        versionId: model.getVersionId(),
        duringSuggest,
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

    attachKeyCapture();
    startSuggestPolling();
    setupSuggestHooks();
    suggestDetectionCleanup = setupSuggestionMenuDetection();

    return stop; // convenience
  }

  function stop() {
    while (disposers.length) {
      try { disposers.pop()?.dispose?.(); } catch {}
    }
    if (inputCleanup) { try { inputCleanup(); } catch {} inputCleanup = null; }
    if (suggestPoll) { clearInterval(suggestPoll); suggestPoll = null; }
    if (suggestDetectionCleanup) { try { suggestDetectionCleanup(); } catch {} suggestDetectionCleanup = null; }

    // Restore suggest patches
    try {
      if (patchedSuggestController && originalAcceptSelected) {
        patchedSuggestController.acceptSelectedSuggestion = originalAcceptSelected;
      }
      const { list } = getSuggestParts();
      if (list && originalListSetFocus) {
        list.setFocus = originalListSetFocus;
      }
    } catch {}
    patchedSuggestController = null;
    originalAcceptSelected = null;
    originalListSetFocus = null;

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
    if (typeof initial.content === 'string') {
      try { editor.setValue(initial.content); } catch { if (model) { try { model.setValue(initial.content); } catch {} } }
    }
    if (initial.position) editor.setPosition(initial.position);
    if (initial.selection) editor.setSelection(initial.selection);
  }

  function execEvent(ev) {
    switch (ev.type) {
      case 'initialState':
        applyInitial(ev);
        break;
      case 'contentChange': {
        const model = editor.getModel();
        if (!model) return;
        const edits = ev.changes.map((c) => ({
          range: new monaco.Range(
            c.range.startLineNumber,
            c.range.startColumn,
            c.range.endLineNumber,
            c.range.endColumn
          ),
          text: c.text,
        }));
        editor.executeEdits('playback', edits);
        break;
      }
      case 'cursorPosition': {
        if (ev.position) {
          try { editor.setPosition(ev.position); } catch {}
        }
        break;
      }
      case 'cursorSelection': {
        if (ev.selection) {
          try { editor.setSelection(ev.selection); } catch {}
        }
        break;
      }
      case 'suggestFocus':
        // informational marker only
        break;
      default:
        break;
    }
  }

  // --- Playback ---
  function play(recording, playOpts = {}) {
    stopPlayback();
    const list = Array.isArray(recording) ? recording.slice() : events.slice();
    if (!list.length) return;

    const {
      speed = 200,
      minDelayMs = 0,
      maxDelayMs = 1000,
      onProgress = null,
      onDone = null,
    } = playOpts;

    const sleep = (ms) => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
    const scaleDelay = (ms) => {
      const scaled = ms * (100 / Math.max(1, speed));
      return Math.min(Math.max(scaled, minDelayMs), maxDelayMs);
    };
    const waitFor = async (condFn, timeout = 300, poll = 10) => {
      const start = Date.now();
      const budget = Math.min(maxDelayMs, Math.max(minDelayMs, timeout * (100 / Math.max(1, speed))));
      if (budget === 0) return !!condFn();
      while (Date.now() - start < budget) {
        if (!playing) return false;
        if (condFn()) return true;
        await sleep(Math.min(maxDelayMs, Math.max(minDelayMs, poll * (100 / Math.max(1, speed)))));
      }
      return !!condFn();
    };

    const waitForSuggestWidget = async (soft = false) => {
      const { widget, list } = getSuggestParts();
      const ready = () => !!(widget?.isVisible?.() && (list?._items?.length || 0) > 0);
      if (ready()) return true;
      return await waitFor(ready, soft ? 120 : 300, 8);
    };

    const simulateNavigate = async (direction) => {
      try {
        const cmd = direction === 'down' ? 'selectNextSuggestion' : 'selectPrevSuggestion';
        editor.trigger('playback', cmd, {});
        await sleep(0);
      } catch {}
    };

    playing = true;

    // Session flags for suggest
    let suggestSessionActive = false;
    let desiredSuggestOpen = false;
    let lastFocusedLabel = null;
    let lastFocusedIndex = null;

    const initial = list.find((e) => e.type === 'initialState');
    if (initial) applyInitial(initial);

    (async () => {
      // Sequential loop
      for (let i = 0; i < list.length && playing; i++) {
        const ev = list[i];

        // Delay based on timestamp delta
        const prevTs = i > 0 ? list[i - 1].timestamp : 0;
        const waitMs = scaleDelay(Math.max(0, ev.timestamp - prevTs));
        if (waitMs) await sleep(waitMs);

        // Handle suggest state machine first for certain events
        switch (ev.type) {
          case 'initialState': {
            // Already applied once before loop; do not re-apply to avoid cursor jumps
            break;
          }
          case 'suggestHide':
          case 'suggestInferredClose': {
            try { editor.focus?.(); } catch {}
            try { editor.trigger('keyboard', 'hideSuggestWidget', {}); } catch {}
            suggestSessionActive = false;
            desiredSuggestOpen = false;
            break;
          }
          case 'suggestTriggered':
          case 'suggestShow':
          case 'suggestInferredOpen': {
            try { editor.focus?.(); } catch {}
            try { editor.trigger('keyboard', 'editor.action.triggerSuggest', {}); } catch {}
            suggestSessionActive = true;
            desiredSuggestOpen = true;
            await waitForSuggestWidget(false);
            break;
          }
          case 'suggestNavigate': {
            await waitForSuggestWidget(true);
            await simulateNavigate(ev.direction);
            break;
          }
          case 'suggestFocus': {
            lastFocusedLabel = ev.item?.label ?? null;
            lastFocusedIndex = Number.isInteger(ev.index) ? ev.index : null;
            break;
          }
          case 'suggestAccept': {
            // Mirror index.html: do not apply accept; rely on recorded contentChange
            try { editor.focus?.(); } catch {}
            try { editor.trigger('keyboard', 'hideSuggestWidget', {}); } catch {}
            suggestSessionActive = false;
            desiredSuggestOpen = false;
            break;
          }
          case 'contentChange': {
            // Apply edit
            execEvent(ev);
            // If this happened during suggest in the recording, re-open and wait
            if (ev.duringSuggest || desiredSuggestOpen) {
              try { editor.focus?.(); } catch {}
              try { editor.trigger('keyboard', 'editor.action.triggerSuggest', {}); } catch {}
              suggestSessionActive = true;
              desiredSuggestOpen = true;
              await waitForSuggestWidget(true);
              // Optionally try restore focus roughly by label/index
              if (lastFocusedLabel != null || Number.isInteger(lastFocusedIndex)) {
                try {
                  const { list } = getSuggestParts();
                  const items = list?._items || [];
                  let targetIndex = -1;
                  if (lastFocusedLabel != null) targetIndex = items.findIndex(it => it?.suggestion?.label === lastFocusedLabel);
                  if (targetIndex < 0 && Number.isInteger(lastFocusedIndex)) targetIndex = lastFocusedIndex;
                  const current = (list.getFocus?.() || [])[0] ?? -1;
                  let steps = targetIndex - current;
                  const dir = steps >= 0 ? 'down' : 'up';
                  steps = Math.abs(steps);
                  for (let s = 0; s < steps; s++) await simulateNavigate(dir);
                } catch {}
              }
            }
            break;
          }
          default: {
            // All other events
            execEvent(ev);
          }
        }

        if (onProgress) {
          try { onProgress(i + 1, list.length, ev); } catch {}
        }
      }

      playing = false;
      if (onDone) { try { onDone(); } catch {} }
    })();
  }

  return { start, stop, getEvents, play, stopPlayback };
}

export default createMonacoRecorder;
