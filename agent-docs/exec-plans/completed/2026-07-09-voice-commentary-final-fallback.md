# Voice commentary final fallback

## Goal

Prevent a voice-only assistant reply from sending its already-delivered
commentary/progress text again as companion text before the voice memo.

Success criteria:

- Reproduce the incident shape with a focused Codex runtime test.
- Keep commentary available for progress and traces while excluding it from
  final-response fallback selection.
- Preserve explicit final text and media-only delivery behavior.
- Run focused owner coverage, typecheck, required audits, and direct scenario
  proof before commit and PR handoff.

## Constraints

- Preserve unrelated work and the existing hosted delivery/outbox invariants.
- Do not add provider-specific dedupe state or weaken legitimate repeated
  messages.
- Keep logs, fixtures, and committed artifacts free of private identifiers and
  message payloads from the reported incident.

## Approach

1. Add a regression test for commentary progress followed by a voice memo and
   an empty final answer.
2. Remove completed commentary streams from final-message fallback candidates
   without changing progress delivery or trace visibility.
3. Verify explicit final-answer, media-only, and steered-message behavior.
4. Run completion audits, scoped verification, final review, and the PR review
   loop.

## State

Complete; ready for scoped commit and PR review.

## Notes

- Production-safe metadata proved one inbound turn, two distinct text sends,
  and one voice-memo send; no provider retry occurred.
- The supplied canonical vault export does not include assistant runtime or
  outbox state, so it is not delivery evidence for this incident.
- The focused regression failed before the production fix because commentary
  became `finalMessage`, then passed after commentary was excluded from
  fallback.
- The full assistant Codex runtime file passed 152 tests. The final sequential
  assistant-engine coverage run passed 1,994 tests with 4 skipped, and root
  typecheck passed across all 27 selected workspace projects.
- Diff-aware verification completed all selected guards and typechecks, then
  stopped on an unrelated assistant-CLI startup-import test at its fixed
  30-second timeout; the same test reproduces independently of this path.
- Coverage-write review found no missing regression cases. Security/privacy
  review found no medium-or-higher findings and no required human checks.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
