# Internal: Golden Demos (2) vs Current Implementation

This is a terse, engineering-facing comparison to align behavior exactly with the two golden demos.

Golden demos (the 2):
- Vanilla: `demos/vanilla.html`
- React: `demos/react.html`

Current subjects to compare:
- Library: `monaco-recorder.js`
- TS demo: `demos/typescript-demo.html`
- TS recorder: `demos/typescript-recorder/index.html`
- Showcase tabs: `index.html`

## 1) Module loading
- __Golden (Vanilla/React)__
  - Monaco via AMD loader (unpkg path).
  - Recorder loaded as native ES module import.
- __Current__
  - Same pattern across demos. TS demo now explicitly sets AMD paths before `vs/editor/editor.main` and uses dynamic import for recorder.
- __Status__: aligned.

## 2) Worker configuration
- __Golden__
  - `window.MonacoEnvironment.getWorkerUrl` returns `.../language/typescript/ts.worker.js` for ts/js; `.../base/worker/workerMain.js` otherwise.
- __Current__
  - Same in `index.html`, `demos/typescript-demo.html`, and `demos/typescript-recorder/index.html`.
- __Status__: aligned.

## 3) Model language and URI
- __Golden__
  - Language matches content; TS files use `.ts` Uri to avoid TS service errors.
- __Current__
  - TS demo creates model with `file:///demo.ts` and language `typescript`.
  - TS recorder uses `file:///workspace.ts`.
- __Status__: aligned.

## 4) TypeScript compiler/diagnostics defaults
- __Golden__
  - Reasonable TS defaults for ESNext, DOM libs, no emit; diagnostics on.
- __Current__
  - `index.html` and TS pages set `ESNext`, `allowJs`, `allowNonTsExtensions`, libs `['esnext','dom']`, diagnostics enabled.
- __Status__: aligned.

## 5) Playback timing semantics (speed/threshold)
- __Golden__
  - Speed is a multiplier (1x normal, 2x faster, 0.5x slower).
  - Optional cap on long pauses (aka threshold) via a max delay.
- __Current__
  - Library updated: `speed` is a multiplier; delays scaled and clamped between `minDelayMs` and `maxDelayMs`.
  - TS demos map Threshold -> `maxDelayMs`, and set `minDelayMs: 0`.
- __Status__: aligned.

## 6) Event format and suggest behavior
- __Golden__
  - Events: `initialState`, `contentChange`, cursor events; suggest visibility and focus captured sufficiently to replay intent.
- __Current__
  - Records `initialState`, `contentChange` (with `duringSuggest`), `cursorSelection`, `keyDown` for Arrow nav when enabled.
  - Suggest show/hide via DOM observer; playback reopens widget, waits readiness, restores focus by label/index when available.
- __Status__: aligned; parity for common cases. Further polish possible for edge cases with differing suggestion providers.

## 7) Controls and UX
- __Golden__
  - Buttons lock during playback/recording to avoid conflicts; simple speed control.
- __Current__
  - Same locking applied in TS demos; speed and threshold exposed; export/download present.
- __Status__: aligned.

## 8) Export/Import format
- __Golden__
  - JSON array of events starting with `initialState`.
- __Current__
  - Library provides `serializeEvents`/`deserializeEvents` with `{ v:1, events }` wrapper; demos also handle plain arrays.
- __Status__: compatible; demos export plain array when appropriate.

## Known gaps to keep an eye on
- __Suggest focus restoration edge cases__
  - If provider set differs at replay time, label/index restoration may not match. Current logic falls back safely.
- __Pause/resume mid-playback__
  - Golden behavior is simple toggle; we stop playback, which matches vanilla; true resume would require tracking deltas.

## Summary
- Core parity with the two golden demos is in place: loader, workers, TS model/diagnostics, speed=multiplier, threshold=maxDelayMs, controls, and event format.
- Remaining work would be targeted polish for rare suggest edge cases if needed by recordings.
