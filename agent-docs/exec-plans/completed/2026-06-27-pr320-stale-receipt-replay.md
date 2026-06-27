# PR 320 stale receipt replay

## Goal

Ensure a Linq first-contact event with an existing stale `processing` receipt
cannot replay as a normal active-member inbound message before admission
recovery.

## Constraints

- Preserve consumed receipt duplicate handling.
- Preserve fresh processing owner exclusion.
- Reclaim stale processing receipts before active-member mailbox/wake routing.
- Keep the fix scoped to Linq webhook planning and focused dispatch tests.

## Plan

1. Move stale receipt reclaim/ownership ahead of active-member side effects.
2. Add regression coverage for stale receipt plus later active member replay.
3. Run focused hosted onboarding tests and app verification.
4. Commit, push, and continue the Eragon loop.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
