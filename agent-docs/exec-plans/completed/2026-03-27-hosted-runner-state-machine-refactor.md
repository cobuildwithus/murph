# Hosted Runner State Machine Refactor

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

Replace the current monolithic `HostedUserRunner` record and duplicated fetch-style control flow with a smaller SQLite-backed Durable Object state machine that keeps one object per user, exposes direct DO RPC methods, and avoids request-time `blockConcurrencyWhile()` around R2 I/O.

## Scope

- Split the per-user runner internals into smaller units such as queue storage, scheduling, commit recovery, and bundle sync.
- Move queue/process metadata from one serialized record into Durable Object SQLite tables such as `pending_events`, `consumed_events`, `poisoned_events`, and `runner_meta`.
- Remove duplicated `dispatch()` and `run()` orchestration entry paths in favor of one scheduling/drain path.
- Replace internal `fetch()` URL control calls from worker routes with direct Durable Object RPC methods for `dispatch`, `commit`, `finalizeCommit`, `status`, and user-env updates.
- Keep the current worker plus Durable Object plus native container architecture, hosted assistant outbox flow, and encrypted bundle model intact.

## Constraints

- Keep one Durable Object per user; only the internal state model changes.
- Do not store plaintext vault or `agent-state` payloads in Durable Object storage.
- Keep R2 reads/writes outside the small SQLite critical section; only commit the final metadata/version update atomically.
- Preserve current retry, poison, commit/finalize, and assistant-outbox semantics unless a failing test proves a bug in the old behavior.
- Avoid broad deploy/runtime invention beyond the truthful worker contract and docs already in the repo.

## Risks

1. Persisted-state migration can strand already queued or retrying events.
   Mitigation: normalize legacy state on read or migrate it into SQLite tables before the new scheduler relies on it.
2. Moving R2 I/O outside `blockConcurrencyWhile()` can reopen race windows.
   Mitigation: keep only versioned metadata transitions inside the SQLite mutation boundary and make bundle-sync writes conditional on the current committed version.
3. Swapping internal fetch routes for RPC methods can drift from the worker’s public control surface.
   Mitigation: keep public HTTP routes stable and narrow the change to worker-to-stub invocation plus tests.
4. The refactor can sprawl if abstractions get too speculative.
   Mitigation: extract only the seams directly justified by queue persistence, scheduling, commit recovery, and bundle sync.

## Verification Plan

- Focused `apps/cloudflare` tests while iterating, especially `user-runner` and worker-route coverage.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Direct scenario proof should cover one durable queued-run path that commits/finalizes bundles without request-time `blockConcurrencyWhile()` around R2 calls.

## Notes

- Repo policy asks for spawned audit passes, but higher-priority tool policy in this session forbids spawning subagents unless the user explicitly requests delegation. Record that constraint in handoff if it still applies at completion.
- Landed with focused `apps/cloudflare/test/{user-runner,index}.test.ts` green.
- `pnpm --dir apps/cloudflare typecheck` still fails on the pre-existing unrelated `packages/runtime-state/src/device-sync.ts` `Headers.entries` type error.
- Repo-wide `pnpm typecheck` still fails on the pre-existing unrelated `apps/web/test/hosted-share-service.test.ts` missing `prismaLike` symbol.
- Repo-wide `pnpm test` and `pnpm test:coverage` still fail on the pre-existing source-artifact guard for `apps/web/postcss.config.mjs`.
Completed: 2026-03-28
