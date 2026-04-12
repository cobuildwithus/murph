## Goal

Land the remaining still-applicable hunks from the supplied hosted device-sync runtime review patch without disturbing unrelated in-flight work.

## Scope

- `apps/web/src/lib/device-sync/agent-session-service.ts`
- `apps/web/src/lib/device-sync/prisma-store/local-heartbeats.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- verification limited to the touched device-sync/runtime slices

## Constraints

- Preserve unrelated dirty worktree edits, especially the active `apps/web/**` hosted-onboarding lane and `packages/messaging-ingress/**`.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Keep the merge limited to explicit hosted runtime apply-result handling (`writeUpdate`) and the corresponding helper usage.

## Plan

1. Confirm which supplied hunks are already present and which are still missing.
2. Apply only the missing `apps/web` runtime-caller changes that switch to explicit apply-result helpers.
3. Run truthful scoped verification for the touched owners.
4. Update the coordination ledger note if needed, then commit only the exact touched paths.

## Verification target

- `pnpm typecheck`
- truthful scoped checks for the touched `apps/web` and device-sync runtime slice, likely via `pnpm test:diff` or the narrower owner-level commands if repo-wide diff fanout is already blocked by unrelated work
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
