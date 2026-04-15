# Automation Notification Target Hardening

## Goal

Land the remaining patch behavior for assistant cron notification target hardening:

- remove the legacy `deliverResponse` field from cron target persistence/contracts
- add cron-specific notification dedupe tokens for scheduled runs
- keep notification turn persistence-before-delivery behavior intact
- add focused regression tests for the new behavior

## Scope

- `packages/assistant-engine/**`
- `packages/operator-config/**`

## Constraints

- Treat the supplied patch as intent, not overwrite authority.
- Preserve unrelated worktree edits.
- Keep the change narrow to cron target semantics and notification delivery dedupe.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine packages/operator-config`

## Notes

- Direct proof should include scheduled-cron dedupe token coverage and notification delivery ordering coverage.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
