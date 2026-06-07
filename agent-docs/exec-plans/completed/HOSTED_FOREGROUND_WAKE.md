## Goal

Preserve immediate foreground assistant wakes when late conversation input is
imported during hosted post-delivery cleanup.

## Context

Production logs showed a follow-up conversation mailbox row accepted and staged
while the active hosted runtime was finishing its previous response. The next
assistant pass queried before the row was imported; after the row imported, the
pending-input wake was merged and then overwritten by a later provider-cleanup
wake.

## Plan

1. Change the post-checkpoint wake merge to keep the earliest existing or
   post-checkpoint assistant wake.
2. Add focused regression coverage for an existing immediate assistant wake plus
   a later post-checkpoint wake.
3. Run targeted tests plus required typecheck/test verification.

## Status

Implemented. Verification passed:

- Focused hosted workspace runner test: 47 tests passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: 605 files, 6011 passed, 9 skipped.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
