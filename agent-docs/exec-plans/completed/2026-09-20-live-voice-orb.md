# Connect the cloud orb to live speech

## Outcome

Integrate merged PR #3611 into the existing local GPT-Live preview. Select
Willow (Irish) by default. User speech shrinks the orb with subtle cloud motion;
assistant speech drives stronger motion. Pause freezes the orb.

## Implementation

Reuse the merged shader and graphics lifecycle in a shared visual component.
Measure microphone and remote audio locally in the existing call lifecycle;
release analysis resources when the call ends. Preserve pause acknowledgement,
voice selection, fallback rendering, reduced motion, and playground controls.
No provider protocol or production admission changes. No persistence.

## Product UX and verification

Replay default Willow, input/output animation, silence, pause/resume, end,
permission failure, mobile layout, reduced motion, graphics fallback/context
recovery, and existing playground interactions. Run focused voice tests, web
typecheck, changed-file lint, complexity review, and browser proof.

## Completion

Ready. Merged main including PR #3611 and reused its shader, fallback images,
reduced-motion handling, and context recovery. Willow is selected by default.

Validation:
- Focused route/session Vitest suite: 32 passing tests, including independent
  input/output levels, quiet-room threshold, pause/resume, resource disposal,
  and optional Web Audio fallback.
- Web `typecheck:prepared`, changed-file ESLint, and `git diff --check`: passed.
- `pnpm complexity:diff`: passed; no changed functions above 20.
- Existing orb Playwright suite (Chromium): six passing journeys, including
  three viewport sizes, touch, reduced motion, fallback, and context recovery.
- Real GPT-Live call with synthetic microphone audio: provider selected Willow;
  both speaking states observed, user orb shrank, pause froze rendered pixels,
  resume/end worked, no browser errors, no phone overflow.
- Rendered component studies: user orb approximately 111px versus assistant
  144px; assistant cloud drift approximately nine times faster at equal sample
  levels. Live control remained available with WebGL disabled.
- Desktop and phone screenshots inspected; component studies include both
  speakers. Evidence is local under `.artifacts/review-gpt/live-voice/`.

Parent review: audio stays in the existing call owner; meters cannot monitor
microphone audio through speakers, pause resets levels, and teardown disconnects
nodes and closes the analysis context. No new dependencies or provider protocol.
Local development preview only; no public changelog, PR, or deployment.
Frontend-only interaction is exempt from final external ReviewGPT. No new
repository friction required an entry. Existing preview server remains running.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
