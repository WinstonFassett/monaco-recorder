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
//   import createMonacoRecorder, { createRecorder, createPlayback, serializeEvents, deserializeEvents } from './src/monaco-recorder.js'
//   // 1) Back-compat combined factory
//   const rec = createMonacoRecorder(editor, monaco, { captureSelection: true, captureKeys: false })
//   const stop = rec.start(); const events = stop();
//   rec.play(events, { speed: 200, minDelayMs: 0, maxDelayMs: 1000, onProgress, onDone })
//   // 2) Separate factories sharing the same event format
//   const recorder = createRecorder(editor, monaco, { captureSelection: true })
//   const playback = createPlayback(editor, monaco)
//   const stopRec = recorder.start(); const recording = stopRec();
//   // serialize to persist/transmit
//   const json = serializeEvents(recording)
//   const loaded = deserializeEvents(json)
//   playback.play(loaded)

export function createMonacoRecorder(editor, monaco, options = {}) {
  if (!editor || !monaco) throw new Error('createMonacoRecorder requires editor and monaco');

  const opts = {
    captureCursor: true,
    captureSelection: true,
    captureKeys: false,
    captureSuggest: true,
    ...options,
  };

  // --- Recorder state ---
  let disposers = [];
  let startTs = 0;
  let events = [];
  let inputCleanup = null;
  let suggestDetectionCleanup = null;
  

  // Suggest hook originals to restore
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
          stamp({ type: 'suggestShow', method: 'attr-observer', reason });
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
        // Stamp only navigation keys needed for playback
        if (opts.captureKeys || opts.captureSuggest) {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const base = { type: 'keyDown', key: e.key, code: e.code, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey };
            stamp({ ...base, category: 'navigation' });
          }
        }

        if (!opts.captureSuggest) return;

        // Hide when visible and user presses Escape
        const { widget } = getSuggestParts();
        const visible = widget?.isVisible?.();
        if (visible && e.key === 'Escape') {
          stamp({ type: 'suggestHide', method: 'esc' });
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
      const { list } = getSuggestParts();
      if (list && originalListSetFocus) {
        list.setFocus = originalListSetFocus;
      }
    } catch {}
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
      // Treat speed as a multiplier: 1 = normal, 2 = twice as fast, 0.5 = half speed
      speed = 1,
      minDelayMs = 0,
      maxDelayMs = 1000,
      onProgress = null,
      onDone = null,
    } = playOpts;

    const factor = 1 / Math.max(0.1, speed);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const scaleDelay = (ms) => clamp(ms * factor, minDelayMs, maxDelayMs);
    const waitFor = async (condFn, timeout = 300, poll = 10) => {
      const start = Date.now();
      const budget = clamp(timeout * factor, minDelayMs, maxDelayMs);
      if (budget === 0) return !!condFn();
      while (Date.now() - start < budget) {
        if (!playing) return false;
        if (condFn()) return true;
        await sleep(clamp(poll * factor, minDelayMs, maxDelayMs));
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
        if (prev && prev.type === 'suggestShow') {
          await waitForSuggestWidget(true);
        }
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
          case 'suggestHide': {
            try { editor.focus?.(); } catch {}
            try { editor.trigger('keyboard', 'hideSuggestWidget', {}); } catch {}
            suggestSessionActive = false;
            desiredSuggestOpen = false;
            break;
          }
          case 'suggestShow':
          {
            try { editor.focus?.(); } catch {}
            try { editor.trigger('keyboard', 'editor.action.triggerSuggest', {}); } catch {}
            suggestSessionActive = true;
            desiredSuggestOpen = true;
            await waitForSuggestWidget(false);
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

// Named helpers: separate recording and playback facades sharing the same event format
export function createRecorder(editor, monaco, options = {}) {
  const api = createMonacoRecorder(editor, monaco, options);
  return {
    start: api.start,
    stop: api.stop,
    getEvents: api.getEvents,
  };
}

export function createPlayback(editor, monaco, options = {}) {
  const api = createMonacoRecorder(editor, monaco, options);
  return {
    play: api.play,
    stopPlayback: api.stopPlayback,
  };
}

// Pure helpers: JSON serialization for decoupling event stream from editor state
export function serializeEvents(evts) {
  try {
    const events = Array.isArray(evts) ? evts : [];
    return JSON.stringify({ v: 1, events }, null, 2);
  } catch {
    return '[]';
  }
}

export function deserializeEvents(json) {
  try {
    const obj = JSON.parse(json);
    if (Array.isArray(obj)) return obj;
    if (obj && Array.isArray(obj.events)) return obj.events;
    return [];
  } catch { return []; }
}
