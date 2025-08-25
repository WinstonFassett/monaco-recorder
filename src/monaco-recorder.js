  // Try to (re)patch suggest list focus whenever the widget becomes available
  function ensureSuggestListPatched() {
    try {
      const { list } = getSuggestParts();
      if (!list) return;
      patchSuggestListFocusIfNeeded(list);
    } catch {}
  }
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
  let lastSuggestVisible = false;
  let lastSuggestState = 0;
  let suggestDetectionCleanup = null;
  const keyboardBuffer = [];

  // Suggest hook originals to restore
  let patchedSuggestController = null;
  let originalAcceptSelected = null;
  let originalListSetFocus = null;

  // --- Playback state ---
  let playing = false;
  let lastFocusedLabel = null;
  let lastFocusedIndex = null;
  // (removed) timers set was unused; we rely on async sleeps only

  // --- Utility ---
  function now() { return Date.now(); }
  function stamp(ev) {
  const e = { ...ev, timestamp: now() - startTs };
  events.push(e);
  try {
    const tag = e.item?.label || e.key || e.triggerKey || e.method || '';
    console.log('[REC]', e.type, tag, e);
  } catch {}
}
  // Small sleep utility available to helpers (e.g., simulateNavigationKey)
  function sleep(ms) { return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve(); }

  // --- Suggest timing constants (keep parity with index.html values) ---
  const SOFT_SUGGEST_TIMEOUT_MS = 120;
  const HARD_SUGGEST_TIMEOUT_MS = 300;
  const SUGGEST_POLL_MS = 8;
  

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

  // --- Playback helpers (parity with index.html) ---
  async function simulateNavigationKey(keyEvent) {
    const key = keyEvent?.key;
    try { editor?.focus?.(); } catch {}

    // While suggestion menu is open, playback 
    // arrow keys as selection commands
    try {
      if (key === 'ArrowDown') {
        editor?.trigger('playback', 'selectNextSuggestion', {});
      } else if (key === 'ArrowUp') {
        editor?.trigger('playback', 'selectPrevSuggestion', {});
      }
      await sleep(0);
    } catch {}
  }

  // Polling removed; attribute observer is primary detection.

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
        if (widgetEl) {
          // Ensure our suggest list patch is applied as soon as the widget is present
          ensureSuggestListPatched();
          watchWidgetAttributes();
        }
      };

      const treeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node.matches?.('.editor-widget.suggest-widget') ? node : node.querySelector?.('.editor-widget.suggest-widget');
              if (el) {
                widgetEl = el;
                // No inferred stamp; rely on attribute observer for show/hide
                watchWidgetAttributes();
              }
            }
          });
          mutation.removedNodes.forEach((node) => {
            if (node === widgetEl || node.querySelector?.('.editor-widget.suggest-widget')) {
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
      // Patch focus via shared helper
      patchSuggestListFocusIfNeeded(list);
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
        // Stamp navigation/modifier keys for context (always when suggest capture is enabled)
        const nav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Tab','Enter','Escape'];
        const isModifier = ['Control','Shift','Alt','Meta'].includes(e.key);
        if (opts.captureKeys || opts.captureSuggest) {
          if (nav.includes(e.key) || isModifier || e.ctrlKey || e.altKey || e.metaKey) {
            // DIAGNOSTIC-ONLY: generic keyDown stamps for visibility; safe to delete once stable
            const base = { type: 'keyDown', key: e.key, code: e.code, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey };
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              stamp({ ...base, category: 'navigation' });
            } else {
              stamp(base);
            }
          }
        }

        if (!opts.captureSuggest) return;

        // Detect common triggers ("." and Ctrl/Cmd+Space)
        const ctrlSpace = (e.ctrlKey || e.metaKey) && e.key === ' ';
        if (e.key === '.' || ctrlSpace) {
          setTimeout(() => {
            const { widget, list } = getSuggestParts();
            if (widget?.isVisible?.() && (list?._items?.length || 0) > 0) {
              // DIAGNOSTIC-ONLY: suggestion likely opened due to keyboard; safe to delete
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
            // DIAGNOSTIC-ONLY: navigation intent; playback uses recorded keyDown category
            stamp({ type: 'suggestNavigate', direction: e.key === 'ArrowDown' ? 'down' : 'up', fromIndex: focusIdx, fromLabel: labelAt(focusIdx) });
          } else if (e.key === 'Enter') {
            // acceptance intent (actual accept recorded by wrapped method)
            // DIAGNOSTIC-ONLY: acceptance intent; playback relies on contentChange
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
    // Polling intentionally disabled; rely on DOM attribute + tree observers
    setupSuggestHooks();
    suggestDetectionCleanup = setupSuggestionMenuDetection();

    return stop; // convenience
  }

  function stop() {
    while (disposers.length) {
      try { disposers.pop()?.dispose?.(); } catch {}
    }
    if (inputCleanup) { try { inputCleanup(); } catch {} inputCleanup = null; }
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
      return await waitFor(ready, soft ? SOFT_SUGGEST_TIMEOUT_MS : HARD_SUGGEST_TIMEOUT_MS, SUGGEST_POLL_MS);
    };

    // (removed) simulateNavigate helper was unused; navigation goes through simulateNavigationKey

    playing = true;

    // Session flags for suggest
    let suggestSessionActive = false;
    let desiredSuggestOpen = false;

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

        // If the previous event opened suggestions, ensure widget is ready before executing this one
        const prev = list[i - 1];
        if (prev && (prev.type === 'suggestShow' || prev.type === 'suggestTriggered' || prev.type === 'suggestInferredOpen')) {
          await waitForSuggestWidget(true);
        }
        try {
          const tag = ev.item?.label || ev.key || ev.direction || ev.method || '';
          console.log('[PLAY]', ev.type, tag, ev);
        } catch {}
        switch (ev.type) {
          case 'initialState': {
            // Already applied once before loop; do not re-apply to avoid cursor jumps
            break;
          }
          case 'keyDown': {
            // Drive suggest navigation and basic control keys (parity with index.html)
            if (ev.key === 'Enter' && suggestSessionActive) {
              // Skip Enter during suggest session to avoid newline
              break;
            }
            if (ev.key === 'Escape' && suggestSessionActive) {
              const ctrl = editor.getContribution('editor.contrib.suggestController');
              try { ctrl?.cancelSuggestWidget?.(); } catch {}
              suggestSessionActive = false;
              desiredSuggestOpen = false;
              break;
            }
            if (ev.category === 'navigation') {
              await simulateNavigationKey(ev);
            }
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
            // Navigation is driven by recorded keyDown ArrowUp/Down like index.html; ignore this if present
            break;
          }
          case 'suggestFocus': {
            // Update last known focus from recording (used to restore after re-open)
            lastFocusedLabel = ev.item?.label ?? null;
            lastFocusedIndex = Number.isInteger(ev.index) ? ev.index : null;
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
              // Restore focus by label or fallback to index
              try {
                const { list } = getSuggestParts();
                if (list) {
                  const items = list._items || [];
                  let idx = -1;
                  if (lastFocusedLabel) {
                    idx = items.findIndex(it => it?.suggestion?.label === lastFocusedLabel);
                  }
                  if (idx < 0 && Number.isInteger(lastFocusedIndex)) {
                    idx = Math.max(0, Math.min(lastFocusedIndex, Math.max(0, items.length - 1)));
                  }
                  if (idx >= 0) {
                    try { list.domFocus?.(); } catch {}
                    list.setFocus([idx]);
                    list.reveal?.(idx);
                  }
                }
              } catch {}
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
