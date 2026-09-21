# Increase cloud movement during speech

## Outcome

Make cloud motion visibly faster for both speakers, including ordinary quiet
speech. Keep assistant motion stronger, the user orb smaller, silence calm,
and paused/reduced-motion graphics still.

## Change

Adjust only the live control's amplitude-to-motion mapping. Apply a bounded
square-root response to lift quiet speech, then increase both speed and cloud
energy. Reuse the existing renderer, microphone analysis, and call lifecycle.

## Verification

Ready. Focused voice tests: 32 passed. Web typecheck, changed-file ESLint,
complexity guard, and diff whitespace check passed. No new hotspots.

Real GPT-Live browser call confirmed Willow, both speakers, smaller user orb,
pause/resume/end, reduced-motion freezing, no mobile overflow, and no errors.
Rendered equal-amplitude studies confirmed much faster shader timing for both
speakers, with assistant motion about twice as fast as user motion. Static
fallback remained usable. Quiet speech now benefits from a bounded square-root
response instead of the previous low linear gain.

Parent review: changes stay in presentation; audio capture, session lifecycle,
idle drift, and pause/reduced-motion handling reuse their existing owners.
Local preview only; no public changelog or external review needed. No new
repository friction. Existing localhost server remains running.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
