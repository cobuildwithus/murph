# PR 320 receipt consume after active resolution

## Goal

Consume reclaimed Linq first-contact processing receipts after successful
resolved non-invite plans, so allow/fail-open active-member handling does not
leave the event id stuck in `processing`.

## Constraints

- Keep invite-signup consumption on the transport-delivery path.
- Do not consume before non-invite side effects and wake handoff succeed.
- Preserve block consumption inside the admission resolution transaction.
- Keep changes scoped to Linq webhook service/types and focused dispatch tests.

## Plan

1. Carry first-contact receipt owner token on resolved Linq plans.
2. Consume non-invite resolved receipts after side effects and wake handoff.
3. Add allow/fail-open active-member replay regressions.
4. Run focused hosted onboarding tests and app verification.
5. Commit, push, and continue Eragon.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
