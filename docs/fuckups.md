# Postmortem: Demo UX/Codebase Failures and Their Impact

This is a candid accounting of mistakes I made while working on Monaco Recorder demos, the impact they had, and what I changed to prevent repeats.

## What went wrong (by area)

- **Too many demo pages without curation**
  - Files: `demos/vanilla.html`, `demos/react.html`, `demos/vanilla-demo.html`, `demos/typescript-demo.html`, `demos/typescript-recorder/`, `demos/demo-picker.html`, `demos/auto-*.html`, etc.
  - Failure: I added or kept multiple overlapping demos instead of consolidating. This increased cognitive load, made navigation confusing, and introduced drift between pages.
  - Impact: You had to hunt for the “good” demos. Inconsistent behavior across pages wasted time verifying which ones to trust.

- **Syntax errors and broken tails**
  - Files: `demos/typescript-demo.html` (unclosed function, duplicate export code), `demos/vanilla-demo.html` (stray duplicate handlers, bad `$()` selectors).
  - Failure: I introduced code without properly linting/running each page, leaving broken scripts and duplicate blocks.
  - Impact: Pages failed to load or threw runtime errors, blocking you from evaluating features and costing debugging time.

- **Inconsistent playback controls and state locking**
  - Files: multiple demos pre-fix; missing Play/Pause toggle or dedicated Stop; speed control inconsistently implemented; threshold not applied uniformly.
  - Failure: I didn’t apply a single UI contract: Play/Pause toggle, separate Stop, speed multiplier slider, threshold default, consistent disabled/enabled states.
  - Impact: Confusing UX, regressions in behavior, and repeated work to check what each page actually did.

- **Worker/TypeScript setup confusion**
  - Files: `demos/typescript-demo.html`, TS worker URL config.
  - Failure: Fragile or mismatched worker URLs and model URIs led to inconsistent TS behavior.
  - Impact: Time wasted verifying TypeScript language service availability and editor health.

- **Bad variable references and duplicated logic**
  - Files: `demos/typescript-demo.html` (e.g., `speedSelect` vs `speedRange`, missing `speedValue`), `demos/vanilla-demo.html` (duplicated fetch and handlers).
  - Failure: Careless refactors without fully updating identifiers and removing dead code.
  - Impact: Runtime errors, broken UI initialization, and confusion about the intended control set.

- **Not auditing existing good demos first**
  - Files: `demos/vanilla.html`, `demos/react.html` (the golden baselines) were not used as the canonical pattern early enough.
  - Failure: I built/changed pages in parallel instead of unifying around proven, working demos.
  - Impact: Drift from the working baseline and extra cycles to realign.

## Estimated impact (qualitative)

- **Time lost to triage**: Multiple sessions identifying which pages worked vs. not, fixing syntax/runtime errors.
- **Context switching cost**: Repeatedly jumping across pages with different control sets and wiring.
- **Trust erosion**: You couldn’t rely on new pages to be stable or consistent.

## Root causes (my behaviors)

- **Overproduction over consolidation**: Creating/keeping many pages instead of one unified, well-tested surface.
- **Insufficient end-to-end testing**: Not loading each page fully and exercising the UI after edits.
- **Inconsistent UI contract**: Not enforcing the same controls, defaults, and state-locking everywhere.
- **Rushed refactors**: Renaming controls without updating references; leaving duplicate blocks.
- **Weak change isolation**: Making multiple risky edits in a single pass without verifying after each.

## What I changed (corrective actions)

- **Single unified recorder**: `demos/recorder.html`
  - JS/TS toggle; Record, Play/Pause, Stop; Speed slider (0.1x–4.0x) with live label; Threshold default 1000ms (`minDelayMs=0`, `maxDelayMs=threshold`); Import/Export; strict state locking.
  - Configures Monaco + TS worker explicitly; `.ts` model URIs for TypeScript.

- **Link from landing**: `index.html` now links the unified recorder prominently.

- **Cleanup of broken page**: Trimmed the stray/bad tail in `demos/vanilla-demo.html` so it doesn’t throw.

- **Use golden baselines**: Treat `demos/vanilla.html` and `demos/react.html` as canonical references for behavior.

## Remaining cleanup (next actions)

- **Archive redundant pages** to `demos/legacy/`: `vanilla-demo.html`, `auto-demo.html`, `auto-play.html`, `typescript-demo.html` (and optionally `typescript-recorder/` after parity).
- **Unify `typescript-recorder/`** to match the unified recorder UI contract or retire it.
- **Paritize `index.html` live demo** with speed slider + Stop, or just use the unified recorder for live interaction.

## Guardrails going forward

- **One canonical interactive surface** per capability (recorder, playback) and shared helpers for wiring.
- **Strict UI contract**: Play/Pause toggle, separate Stop, speed slider with multiplier semantics, threshold default 1000ms, explicit state disabling during recording/playback.
- **Always load-test pages** post-edit (Monaco loads, worker resolves, controls operate end to end).
- **Remove or quarantine** redundant/broken pages promptly to avoid drift.
