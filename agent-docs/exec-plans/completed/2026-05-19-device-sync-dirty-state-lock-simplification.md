# Device Sync Dirty State Lock Simplification

## Goal

Remove the explicit parent `device_connection` row lock from hosted device-sync dirty-state persistence and replace it with a simpler dirty-row concurrency contract that avoids webhook deadlocks while preserving dirty revision, resource merge, and wake-request invariants.

## Scope

- `apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- Focused hosted device-sync dirty-state tests under `apps/web/test/**`

## Constraints

- Do not weaken webhook trace claiming, mailbox wake idempotency, or device-sync data minimization.
- Do not expose raw health payloads, tokens, user identifiers, or provider secrets in tests/logs.
- Preserve unrelated dirty worktree edits.

## Plan

1. Replace `device_connection ... for update` with dirty-row optimistic revision updates.
2. Keep webhook transaction ordering simple: dirty state, signal audit, trace completion, mailbox wake append.
3. Add/adjust focused tests for no parent lock, retry-on-contention, and webhook failure ordering.
4. Run focused verification and required completion audits.

## Verification

- `pnpm test:diff apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts apps/web/src/lib/device-sync/wake-service.ts apps/web/test/prisma-store-dirty-connections.test.ts apps/web/test/device-sync-hosted-wake.test.ts`
- `pnpm typecheck`

Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
