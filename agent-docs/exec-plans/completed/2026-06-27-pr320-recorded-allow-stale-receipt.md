# PR 320 recorded allow stale receipt

## Goal

Ensure a stale Linq first-contact processing receipt is reclaimed and consumed
even when a terminal allow decision already exists before webhook retry
planning.

## Constraints

- Preserve fresh processing receipt 503 behavior.
- Do not create processing receipts for events that have no receipt.
- Keep invite-signup consumption on the delivered-send path.
- Keep changes scoped to Linq webhook service and focused dispatch tests.

## Plan

1. Reclaim existing processing receipts before returning no-request recorded-admission plans.
2. Attach the reclaimed owner token so post-side-effect consumption runs.
3. Add regression for pre-recorded allow plus stale receipt plus active member.
4. Run focused tests and app verification.
5. Commit, push, and continue Eragon.
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
