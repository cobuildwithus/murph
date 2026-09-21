# Make voice clouds roll across the orb

## Outcome and scope

Replace the fixed horizontal cloud ribbon with broad, soft cloud banks that
change direction, tilt, and coverage across the sphere. Preserve the user's
smaller speaking orb, stronger assistant movement, quiet-speech response, pause,
reduced motion, and graphics fallback. No audio or provider protocol changes.

## Approach

Reuse the shared shader with a sphere-oriented cloud bank, independent travel
and tilt phases, and fine edge texture. Tune live speed to the larger-scale
movement. Keep private reference media outside repository artifacts and source.

## Verification

Ready. Rendered sequences inspected: cloud banks roll across the sphere with
changing diagonal/vertical orientation and coverage. Speech energy shifts cloud
travel directly. The fallback is hidden after a successful WebGL draw so its
static edge cannot bleed through; context loss reveals it again.

- Focused voice tests: 32 passed.
- Web typecheck, changed-file ESLint, whitespace, and complexity guard passed;
  no changed source functions above the complexity threshold.
- Existing Chromium playground suite: six passed, including responsive/touch
  controls, pause, reduced motion, fallback, and graphics context restoration.
- Actual GPT-Live call with synthetic input: Willow confirmed, both speakers
  observed, user orb smaller, pause/resume/end passed, reduced motion remained
  still, no browser errors or mobile overflow.
- Parent review: shader and visual mapping only; no new dependencies, stored
  audio, network calls, or changes to call lifecycle. Rendered application
  evidence remains local under `.artifacts/review-gpt/live-voice/`.

Local preview only; no public changelog or external review required for
presentation changes. No new repository friction. Reference media remains
private and outside the repository. The localhost preview remains running.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
