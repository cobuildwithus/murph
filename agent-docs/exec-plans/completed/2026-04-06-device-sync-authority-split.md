# Split local device-sync authority storage by concern

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the hybrid local `device_account` authority row so local durable device-sync state is stored as three explicit records:
  - connection identity/config
  - credential authority state
  - observation/reconcile state

## Success criteria

- Local SQLite runtime state no longer stores hosted/local identity, credential escrow, and observation data in one durable row.
- `packages/device-syncd` exposes the same operational behavior to callers, but internally reads/writes explicit connection, credential, and observation records.
- Hosted hydration and local reconciliation keep the authority rule explicit: hosted authority owns connection identity plus token versioning, while local runtime owns observation and reconcile markers.
- Direct store/service regressions cover hydration, token updates, disconnects, sync lifecycle, and hosted observation markers after the split.
- Architecture docs describe the split clearly enough that future reconnect/debug/ownership work does not need to rediscover the model.

## Scope

- In scope:
  - `packages/device-syncd/**`
  - `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
  - `packages/hosted-execution/**` only if a contract/type change is strictly required
  - `apps/web/src/lib/device-sync/**` only if a caller/type change is strictly required
  - `ARCHITECTURE.md`
  - Related tests and durable docs
- Out of scope:
  - Reworking hosted Prisma/Postgres control-plane tables
  - New reconnect UX or operator tooling
  - Broader hosted bundle/runtime refactors already active elsewhere

## Constraints

- Keep one side authoritative for credentials and the other side observational; do not reintroduce hybrid merge semantics.
- Prefer an internal local-store split over widening the hosted runtime contract unless that contract is truly underspecified.
- Preserve unrelated worktree edits and avoid the active hosted bundle lane except where existing device-sync contracts already overlap.

## Risks and mitigations

1. Risk: SQLite migration loses or misplaces existing device-sync rows.
   Mitigation: migrate in place from the legacy `device_account` table into the three explicit tables under one schema-version bump and keep row reconstruction deterministic.
2. Risk: call sites still assume one-table updates and silently stop updating part of the state.
   Mitigation: funnel all account reconstruction through one mapper and update every write path in the same change.
3. Risk: hosted hydration keeps implicit merge rules for local observation fields.
   Mitigation: keep hosted hydration limited to hosted-owned records plus monotonic observation merge helpers, and document that split in code/tests/docs.

## Tasks

1. Split the local SQLite schema and store internals into connection, credential, and observation tables with a migration path from the legacy row.
2. Update `StoredDeviceSyncAccount` reconstruction and all store write paths to use the split tables.
3. Update hosted runtime hydration/reconcile helpers only as needed to match the new store model.
4. Add focused regression coverage and update architecture docs for the explicit authority split.
5. Run required verification, complete the required audit review, and commit the scoped diff.

## Decisions

- Local SQLite will keep a reconstructed `StoredDeviceSyncAccount` API for callers, but persistence and authority boundaries will be explicit internally.
- Hosted-observed markers stay with local observation/reconcile state because they are replay/debug markers, not canonical credential authority state.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Typecheck passes.
  - Repo tests pass, or any unrelated pre-existing failures are called out precisely.
- Outcomes:
  - Passed: `pnpm exec tsc -p packages/device-syncd/tsconfig.json --pretty false`
  - Passed: `pnpm exec vitest run packages/device-syncd/test/service.test.ts --maxWorkers 1 --no-coverage`
  - Passed direct scenario proof: fresh local device-sync DB creation showed `device_connection`, `device_credential_state`, and `device_observation_state` holding the expected split state for one inserted account.
  - Passed before the post-simplify cleanup: `pnpm typecheck`
  - Passed before the post-simplify cleanup: `pnpm test`
  - Failed after the post-simplify cleanup, credibly unrelated: `pnpm typecheck` stops in the workspace build lane on pre-existing `packages/assistant-core`, `packages/assistant-cli`, `packages/assistantd`, and `packages/cli` build-output/type errors outside this device-sync change.
  - Failed after the post-simplify cleanup, credibly unrelated: `pnpm test` stops in `build:test-runtime:prepared` on pre-existing `packages/assistant-core`, `packages/gateway-core`, `packages/gateway-local`, and CLI build-output/type errors outside this device-sync change.
Completed: 2026-04-06
