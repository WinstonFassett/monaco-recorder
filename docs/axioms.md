# Demo Discipline Axioms (Do Not Break)

These rules exist to stop demo clutter, regressions, and wasted time.

## Canonical Surfaces
- Only one page per capability.
  - Recorder: `demos/recorder.html`
  - React example: `demos/react.html`
  - Vanilla playback example: `demos/vanilla.html`
- If a unified page exists, older variants are removed in the same commit.

## Aggressive Deletion
- Redundant or temporary pages are deleted immediately (history lives in Git).
- If something must live briefly, mark it "deprecated", hide it from `index.html`, and schedule removal.

## Golden Baselines
- Mirror behavior/UX of the golden demos (`demos/vanilla.html`, `demos/react.html`).
- New work inherits from these baselines before adding any variants.

## Strict UI Contract
- Controls: Play/Pause toggle, dedicated Stop.
- Speed: slider with multiplier semantics 0.1x–4.0x and live label.
- Timing: `minDelayMs=0`, threshold input defaults to `maxDelayMs=1000`.
- Recording/Playback: lock incompatible controls during activity.
- Import/Export available where applicable.

## Validate By Running
- After any change, load the page and verify end-to-end:
  - Monaco loads, worker resolves, editor responsive.
  - Controls operate as specified; timing and state locks behave correctly.

## No Parallel Variants
- Never keep both “demo” and “-demo” pages or multiple TS pages.
- If a page is superseded, delete the old one immediately.

## Index Is Source of Truth
- `index.html` links only the allowed demos.
- If it’s not linked from `index.html`, it doesn’t exist.

## Tight, Verified Changes
- Small, isolated edits with immediate manual verification.
- No multi-page risky refactors without validating each page after change.

## No Dead Code
- Remove duplicate handlers, stray tails, unused selectors, and half-refactors in the same change.
- Keep control IDs and variables consistent (e.g., `speedRange` + `speedValue`).

## TypeScript Worker Correctness
- Always configure AMD paths and worker URLs for TS.
- Use `.ts` model URIs when language is TypeScript.

## Docs Track Reality
- Update `docs/ui-specs.md` and `docs/golden-vs-current.md` with each change.
- Add postmortems when mistakes occur (e.g., `docs/fuckups.md`).

## Commit With Intent
- Explain what changed, why, and which pages were removed to reduce surface area.
