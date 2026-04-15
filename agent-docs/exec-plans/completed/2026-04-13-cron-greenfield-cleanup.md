# Cron Greenfield Cleanup

## Goal

Remove the now-unneeded cron legacy compatibility path and trim cron-only test scaffolding that still models the removed `deliverResponse` field.

## Scope

- `packages/assistant-engine/**`

## Constraints

- Greenfield follow-up only: do not widen back into general assistant delivery behavior.
- Preserve unrelated worktree edits, including the existing outbox changes outside this task.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine`

## Notes

- This intentionally removes legacy cron-store upgrade compatibility because the user confirmed greenfield assumptions.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
