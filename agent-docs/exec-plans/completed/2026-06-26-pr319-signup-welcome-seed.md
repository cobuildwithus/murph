# PR 319 Signup Welcome Seed Fix

## Goal

Align signup welcome variant selection with the stable per-member delivery identity before PR 319 merges.

## Scope

- Remove activation source event fields from the signup welcome variant seed.
- Keep the existing one-welcome-per-member delivery dedupe/idempotency keys.
- Add regression coverage for two activation source events on the same member producing the same welcome text.

## Constraints

- Preserve current delivery idempotency behavior.
- Do not add rollout flags or new delivery identities.

## Verification

- Focused hosted member activation tests.
- `pnpm typecheck`.
- `pnpm test:diff` for touched files.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
