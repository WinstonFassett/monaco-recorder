# UI Specs: Golden Demos (2) and Recorder/Playback Page

This document codifies the UI requirements from the two golden demos and specifies the competing recorder/playback page UI. Keep feature parity.

## Golden UI Spec 1: Vanilla Demo (`demos/vanilla.html`)

- __Layout__
  - Toolbar at top with: Demo select, Play, Stop, Speed select.
  - Editor fills remaining viewport height.
- __Controls__
  - Demo Select (`#demoSelect`): options include TypeScript Class, React Component.
  - Play (`#playBtn`): toggles Play/Pause behavior.
  - Stop (`#stopBtn`): stops playback immediately.
  - Speed Select (`#speedSelect`): values 0.5x, 1x, 2x, 4x represented numerically as 50, 100, 200, 400 (multiplier semantics).
- __States__
  - Initial: Play disabled, Stop disabled.
  - After demo selection and recording load: Play enabled, Stop disabled.
  - During playback: Play label switches to "⏸ Pause"; Stop enabled.
  - After stop/onDone: Play resets to "▶ Play"; Stop disabled.
- __Behavior__
  - On demo change: fetch code (TS/JSX), set editor model language (TS for TypeScript, JS for React JSX), fetch corresponding recording JSON.
  - Play: `recorder.play(recording.events, { speed: parseFloat(speedSelect.value), minDelayMs: 0, maxDelayMs: 1000 })`.
  - Pause: `recorder.stopPlayback()` when Play clicked during playback (toggle semantics).
  - Stop: `recorder.stopPlayback()`.
- __Defaults__
  - Theme: vs-dark. Minimap disabled. Automatic layout on.
- __Error__
  - Console errors on fetch failure; UI remains disabled.

## Golden UI Spec 2: React Demo (`demos/react.html` + integration page)

- __Layout__
  - Similar to Vanilla: Play, Stop, Speed select; editor area in a demo section.
- __Controls__
  - Play (`#playBtn`), Stop (`#stopBtn`), Speed select (`#speedSelect` with 0.5x, 1x, 2x, 5x).
- __States__
  - Initial: Play disabled until recording is loaded; Stop disabled.
  - During playback: Play label switches to "⏸ Pause"; Stop enabled.
- __Behavior__
  - Load recording from `recording.json` in the demo folder.
  - Play: `recorder.play(events, { speed: parseFloat(speedSelect.value), minDelayMs: 0, maxDelayMs: 1000 })`.
  - Pause/Stop: `recorder.stopPlayback()`.
- __Defaults__
  - Theme: vs-dark; automatic layout enabled.

## Recorder/Playback Page UI Spec (Competing Page)

Target files: `demos/typescript-demo.html` and `demos/typescript-recorder/index.html` must preserve golden behavior and add TS-specific controls where applicable.

- __Layout__
  - Top control bar with: Record toggle, Stop (if applicable), Play, Stop/Pause, Export/Download, Speed control, Threshold control (optional), Demo selector (optional) on the far right.
  - Editor pane below, full-width responsive.
- __Controls__
  - Record (`#recordBtn` or Start/Stop buttons): toggles recording session (Start → Stop).
  - Play (`#playBtn`): toggles play/pause.
  - Stop (`#stopBtn` or Pause/Stop): hard-stops playback.
  - Export/Download (`#exportBtn`/`#downloadBtn`): saves current recording JSON to disk.
  - Speed: dropdown/select or numeric input. __Semantics__: multiplier (0.1–10.0). Default 1.0.
  - Threshold: numeric input (ms) mapping to `maxDelayMs` to cap pauses. Default 1000ms (or 500ms). `minDelayMs` is 0.
  - Optional Demo selector: preloads sample recordings and initial content for quick testing.
- __States__
  - Initial (no recording yet): Play disabled, Stop disabled, Export disabled. Record enabled.
  - Recording: Play disabled, Export disabled; Record shows "⏹ Stop Recording".
  - Recorded (idle): Play enabled, Export enabled. Stop disabled.
  - Playing: Play label "⏸ Pause"; Stop enabled; Record/Export disabled; speed/threshold disabled during active playback.
  - After playback completes or stop: revert to Recorded (idle) state.
- __Behavior__
  - Record: `recorder.start()`; Stop record: `recorder.stop()` returns array of events.
  - Play: `recorder.play(events, { speed, minDelayMs: 0, maxDelayMs: threshold, onDone })`.
  - Pause: calling Play while playing or an explicit Pause/Stop calls `recorder.stopPlayback()`.
  - Export: serialize events (plain array or via `serializeEvents`) and trigger a download with a `.json` filename.
  - Demo selector (if present): loads code content and recording JSON; sets model language and URI (.ts for TypeScript) before playback.
- __Defaults__
  - Theme: vs-dark; minimap optional; automatic layout.
  - TypeScript: use `.ts` model URI; set compiler options (ESNext, DOM), diagnostics enabled; worker URLs set via `MonacoEnvironment.getWorkerUrl`.
- __Keyboard__
  - During playback, speed/threshold do not react to input until playback completes; arrow keys for suggest navigation are simulated from recorded events.
- __Error Handling__
  - If playback invoked without a recording, ignore and keep state unchanged.
  - If loading demo resources fails, surface console error; keep Play disabled.

## Preservation Checklist
- __Speed semantics__: multiplier 0.5/1/2/4/5 etc.
- __Pause behavior__: Play toggles to Pause; Pause stops playback (like golden demos).
- __Stop button__: present and functional during playback.
- __State locking__: Disable conflicting controls during recording/playback.
- __TS model/worker__: `.ts` URI; `getWorkerUrl` set; TS compiler/diagnostics defaults applied.
- __Import/Export__: JSON round-trip; export downloads file.
- __Sample loading__: Preload demos set editor language and content before playback.
