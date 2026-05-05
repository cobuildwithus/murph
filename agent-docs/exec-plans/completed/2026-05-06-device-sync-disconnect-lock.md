# Device Sync Disconnect Lock

## Goal

Prevent stale hosted device-sync token refresh or runtime-apply writes from reactivating a browser-disconnected connection.

Success criteria:

- Browser disconnect serializes with the same per-connection mutation lock used by token refresh and hosted runtime apply.
- Disconnect performs a fresh read inside the lock before clearing tokens/status.
- Already-disconnected, tokenless connections remain idempotent.
- Focused tests cover stale refresh/apply versus disconnect ordering.

## Constraints

- Keep the fix small and composable; prefer the existing per-connection advisory lock over new persisted state.
- Do not hold a DB transaction while making provider revoke network calls.
- Preserve unrelated working-tree edits.
- Do not expose secrets, local usernames, home paths, or direct personal identifiers in diffs or logs.

## Scope

Planned files:

- `apps/web/src/lib/device-sync/prisma-store.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- focused hosted device-sync tests under `apps/web/test/**`

Out of scope:

- Schema changes or new generation counters.
- Broad device-sync state-machine redesign.
- Provider revoke behavior changes beyond keeping it outside the DB lock.

## Verification

Planned:

- Focused Vitest coverage for hosted device-sync disconnect locking/race behavior.
- `pnpm test:diff` scoped to touched files if truthful for the hosted-web slice.
- `pnpm typecheck` unless blocked by unrelated existing worktree state.

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
