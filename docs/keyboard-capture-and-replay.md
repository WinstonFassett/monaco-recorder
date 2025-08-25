# Monaco Recorder: Keyboard Capture and Replay (Parity With index.html)

This document explains the design and decisions that made suggestion navigation playback work reliably in `demos/vanilla.html` and `demos/react.html`, using the exact behavior proven in `index.html`.

- Library: `src/monaco-recorder.js`
- Demos: `demos/vanilla.html`, `demos/react.html`
- Reference implementation: `index.html`

## Summary

- Navigation keys (ArrowUp/ArrowDown) are captured as `keyDown` events and replayed only through a dedicated `keyDown` handler.
- Playback issues Monaco suggest navigation commands first, then performs a soft readiness check, and finally adjusts the list focus.
- Escape closes the suggest widget using the controller’s `cancelSuggestWidget`, not by dispatching DOM keyboard events.
- Immediate focus application during `suggestFocus` events was removed; we only record that focus state and optionally restore it after re-triggering suggestions following edits.

## Root Cause of the Playback Issue

- Navigation handling was previously attempted via `contentChange` events and ad-hoc DOM dispatch. `contentChange` does not encode navigation keys, so playback missed the user’s ArrowUp/ArrowDown intent.
- The navigation simulator had extra paths (DOM dispatch to list/input) that diverged from the known-good `index.html` logic, causing inconsistent behavior between demos and the reference.

## What Changed (Library)

File: `src/monaco-recorder.js`

- Keydown handling in `createMonacoRecorder.play()`
  - Only navigates when `ev.category === 'navigation'`.
  - Skips `Enter` during an active suggest session to avoid inserting a newline (mirrors `index.html`).
  - Handles `Escape` by calling `editor.getContribution('editor.contrib.suggestController').cancelSuggestWidget()` and clearing session flags.

- Navigation simulation in `simulateNavigationKey()`
  - Issues Monaco commands first: `selectNextSuggestion` / `selectPrevSuggestion` via `editor.trigger('playback', ...)`.
  - Performs a short, adaptive readiness wait (soft) for the suggest widget to be visible and populated.
  - Focuses the list and adjusts focus index explicitly, matching `index.html`.
  - Removed DOM event dispatch paths to the list/inputarea and other last-resort hacks.

- Suggest focus event handling
  - `suggestFocus` now only records label/index for later restoration; it no longer tries to apply focus immediately on playback.

## Recording: Keyboard Capture Requirements

- Capture `keydown` on the Monaco hidden input area (textarea) in the capture phase to reliably observe navigation and control keys.
- Record minimal, semantically relevant data:
  - `type: 'keyDown'`, `key`, modifiers, and a derived `category` (e.g., `navigation` for ArrowUp/ArrowDown).
- Keep suggestion lifecycle signals separate:
  - `suggestTriggered`, `suggestShow`, `suggestHide`, `suggestInferredOpen/Close`.
  - `suggestFocus` is informational for later restoration; it does not drive movement.

## Playback: Execution Rules

- Only the `keyDown` event drives navigation.
- Sequence for ArrowUp/ArrowDown:
  1. Trigger Monaco command (`selectNextSuggestion`/`selectPrevSuggestion`).
  2. Await a short soft readiness window for the widget to be visible and populated.
  3. Focus list and adjust selection index (clamped), then reveal.
- Escape during an active session:
  - Use `cancelSuggestWidget()` to close and clear playback’s session flags.
- Content changes during suggest:
  - If a `contentChange` was recorded while suggestions were visible, mark that we desire suggestions to be open and re-trigger after the edit. Then optionally restore the last recorded focus by label/index.

## Parity With `index.html`

- Removed behaviors not present in `index.html` (DOM event dispatch on list/inputarea, immediate `suggestFocus` application).
- Adopted the exact ordering and guards used in `index.html`:
  - Commands-first navigation.
  - Soft readiness wait (short timeout, small poll interval).
  - Direct list focus/index adjustment.
  - Escape via controller cancel.
  - Skip `Enter` while suggest is active.

## Testing Steps

1. In the demo, record a sequence that opens suggestions (e.g., type `user.profile.`) then use ArrowDown/ArrowUp to navigate and Enter to accept.
2. Stop recording and play back the events.
3. Verify that the suggestion widget:
   - Opens at the same times as recorded.
   - Moves focus through items on ArrowDown/ArrowUp.
   - Closes on Escape when present in the recording.
   - Accepts as implied by the recorded content change (not by replaying Enter when suggest was active).

## Do’s and Don’ts

- Do:
  - Use Monaco commands for navigation first.
  - Keep `keyDown` as the single source of truth for navigation.
  - Maintain a soft readiness wait before manipulating the list.
- Don’t:
  - Inject DOM keyboard events into the suggest list or inputarea for navigation.
  - Apply `suggestFocus` immediately on playback.
  - Infer navigation from `contentChange`.

## References

- Library: `src/monaco-recorder.js`
- Reference implementation details: `index.html` (React demo section for playback controller and `simulateNavigationKey`).
