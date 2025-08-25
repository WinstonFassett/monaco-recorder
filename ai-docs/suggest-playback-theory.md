# Monaco Suggest Playback Theory (from index.html behavior)

This document captures how the working `index.html` replays ArrowUp/ArrowDown so the Monaco suggest overlay (autocomplete) actually moves focus, and what invariants must be respected.

## Model and Internals

- **SuggestController**: `editor.getContribution('editor.contrib.suggestController')` drives the overlay.
- **Widget + List**: `ctrl._widget.value` is the suggest widget. `widget._list` holds items and focus state.
- **Focus source of truth**: `list.getFocus()` exposes the currently highlighted index; items live in `list._items`.
- **Keyboard ingress**: Monaco consumes keys primarily via the hidden textarea `.monaco-editor textarea.inputarea`. The suggest list can also react when its root element has focus and receives keydown.

## Recording (what index.html captures)

- **Keyboard events**: `keydown` on the hidden textarea to stamp ArrowUp/ArrowDown as `keyDown` (`category: 'navigation'` during suggest).
- **Suggest lifecycle**: `suggestShow`/`suggestHide` via MutationObserver + polling heuristics.
- **Focus and Accept**: Patching internals to record:
  - `list.setFocus` → `suggestFocus { index, item.label }`
  - `ctrl.acceptSelectedSuggestion` → `suggestAccept { item.label }`

## Playback (critical sequence in index.html)

1. **Ensure open + ready**
   - Open using Monaco, not by typing: `editor.focus()` then `editor.trigger('keyboard', 'editor.action.triggerSuggest', {})`.
   - Wait until widget is visible AND `list._items.length > 0` (soft timeout, micro-polling). This is the demo’s `ensureSuggestReady()` equivalent.

2. **Drive navigation through Monaco & yield**
   - For ArrowDown: `editor.trigger('keyboard', 'selectNextSuggestion', {})`.
   - For ArrowUp: `editor.trigger('keyboard', 'selectPrevSuggestion', {})`.
   - Immediately `await Promise.resolve()` (microtask) so Monaco updates the list’s internal selection.

3. **Guarantee visual focus (manual reconcile)**
   - Read `before = list.getFocus()[0] ?? -1`.
   - Compute target index based on arrow.
   - Call `list.setFocus([idx])` and `list.reveal(idx)` to ensure the list visibly updates (this is an explicit reconciliation the demo performs to avoid state drifts across Monaco versions/themes/platforms).

4. **Restore focus by label when needed**
   - If content changed while suggest is open, the demo restores focus using the recorded label (`selectSuggestionByLabel(label)`) with a fallback to the recorded index.

5. **Explicit editor focus hygiene**
   - Before opening/hiding suggest, `editor.focus()` (prevents cursor jumps and ensures commands land on the right editor instance).

## Why this works

- Commands target the active editor and update suggest’s internal selection state.
- The demo does not rely solely on commands; it reconciles the list focus visually via `list.setFocus()` and `list.reveal()`.
- The readiness wait guarantees the list exists and has items before any navigation or focus reconciliation.
- Label-based restore eliminates drift caused by content edits changing item order.

---

# Current Library vs. Demo: Gaps that break navigation

- **Event targeting**: If the active focus is not the right element, Monaco ignores commands. The demo always `editor.focus()` and reopens suggest via Monaco, not DOM typing.
- **Readiness timing**: If playback navigates before `list._items` is populated, commands are ignored. The demo uses a soft wait (`ensureSuggestReady`).
- **Manual reconcile absent/late**: Without `list.setFocus()` + `list.reveal()` after command, the overlay can appear unchanged visually even when Monaco moved internal state.
- **Label restore omitted**: If items reshuffle due to content changes, relying on bare index will highlight the wrong row or no visible change.

---

# What we’ve already tried (compact list)

1. **Command-based navigation**
   - `editor.trigger('playback'|'keyboard', 'selectNextSuggestion'|'selectPrevSuggestion', {})` + microtask.
2. **Manual list reconcile**
   - `list.domFocus()`, compute index, `list.setFocus([idx])`, `list.reveal(idx)`.
3. **Widget readiness waits**
   - Poll until `widget.isVisible()` and `list._items.length > 0`.
4. **Textarea DOM key dispatch**
   - Dispatch real `keydown` ArrowUp/ArrowDown to `.monaco-editor textarea.inputarea`.
5. **List element DOM key dispatch**
   - Dispatch `keydown` to `list.getHTMLElement()` / `_domNode`.
6. **Always route ArrowUp/Down**
   - Use navigation helper regardless of recorded `category`.
7. **Suggest hook patching**
   - Patch `list.setFocus` to record `suggestFocus` and wrap `acceptSelectedSuggestion` to record `suggestAccept`.
8. **Editor focus before actions**
   - `editor.focus()` before opening suggest or navigating.

---

# What we have NOT tried (remaining levers)

1. **Exact microtask/macrotask cadence from demo**
   - The demo may perform an extra `await new Promise(r => setTimeout(r, 0))` (macrotask) after the command or after the reconcile, not just a microtask. Reproduce exact cadence around each step.

2. **Preserving and restoring the active DOM focus element**
   - The demo might explicitly move focus to the list container before sending commands, then back to the input, to satisfy platform-specific key routing. Try strictly matching the focus choreography.

3. **Command-source parity for all invocations**
   - Ensure every navigation open/hide uses the identical source `'keyboard'` (not `'playback'`) everywhere (open, next/prev, hide). Verify all four paths use the same source string consistently.

4. **Monaco version-specific guards**
   - Some builds require using `getFocusedElements()` over `getFocus()` or rely on `getSelectedElements()`. Add conditional reconciliation that mirrors the demo’s compatibility shims.

5. **Label-first restore for every navigation step**
   - Before manual index fallback, try restoring by recorded label on every nav (not only after open). This mirrors the demo’s resilience when the list content mutates mid-session.

6. **Forcing list internal focus via controller API**
   - Use `ctrl._widget.value` helpers if present (e.g., `getFocusedItem()`) to drive focus before/after commands, matching the demo’s sequence if it uses controller-level nudges.

7. **Re-applying patches on each visibility flip**
   - Immediately re-patch `list.setFocus` whenever the widget re-appears (already partially done) and assert with a log right before nav that the patch is active and the list reference is current.

8. **Strict parity of open/close handling**
   - On `suggestShow` playback, always call `editor.trigger('keyboard', 'editor.action.triggerSuggest', {})` and wait ready before proceeding to the very next event (gate with an internal barrier), exactly like the demo.

9. **Environment-driven differences**
   - Confirm the demo sets `window.recorder` and prints `[HOOK]`/`[PLAY]` logs at the same points. If a log is missing in the library flow but exists in the demo, align control flow there first.

---

# Reference: Key APIs you must see in logs (demo parity)

- `editor.trigger('keyboard', 'editor.action.triggerSuggest', {})`
- `editor.trigger('keyboard', 'selectNextSuggestion', {})`
- `editor.trigger('keyboard', 'selectPrevSuggestion', {})`
- `list.setFocus([idx]); list.reveal(idx);`
- `list.getFocus()` and `list._items.length`
- `ctrl.acceptSelectedSuggestion`

---

# Minimal checklist to debug a no-visual-change navigation

- **[ready]** Before Arrow: widget visible AND `list._items.length > 0`.
- **[command]** After Arrow command: microtask or `setTimeout(0)` to let Monaco process.
- **[reconcile]** Read `before = list.getFocus()[0]`; compute `after`; call `list.setFocus()` + `reveal()`.
- **[label restore]** If needed, resolve by `label` → fallback to index.
- **[logs]** Ensure `[HOOK]` applied, and `[PLAY:NAV]` logs show `before/after` index changes.
