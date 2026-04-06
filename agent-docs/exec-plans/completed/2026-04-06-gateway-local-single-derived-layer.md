# Simplify gateway-local to one persisted derived layer

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the extra persisted gateway-local serving snapshot layer so `.runtime/projections/gateway.sqlite` keeps only one derived persistence seam.

## Success criteria

- `gateway-local` persists source-side gateway tables plus existing event/permission metadata only, without storing `gateway_conversations`, `gateway_messages`, or `gateway_attachments`.
- Gateway reads still return the same projection snapshot and conversation/message/attachment views by deriving them from persisted source tables on demand.
- Event polling stays stable across no-op syncs and still emits changes when source data or permissions change.
- Required verification passes.

## Scope

- In scope:
  - `packages/gateway-local/src/store/**`
  - `packages/gateway-local/README.md`
  - `packages/cli/test/gateway-local-service.test.ts`
- Out of scope:
  - Changing gateway-core contracts
  - Reworking assistant/inbox canonical sources
  - Introducing a new persisted snapshot blob format

## Constraints

- Prefer source-side persistence over serving-snapshot persistence.
- Keep migration surface smaller, not larger.
- Preserve unrelated worktree edits, especially the in-flight compatibility cleanup elsewhere in the repo.

## Risks and mitigations

1. Risk: Removing serving tables causes event churn on every sync.
   Mitigation: Keep a stable generated-at metadata seam and compare snapshots using source-derived content before rewriting event state.
2. Risk: Existing tests encode the current persisted serving-table contract.
   Mitigation: Update the tests to assert the new single-layer contract directly.
3. Risk: Migration leaves stale serving tables or snapshot metadata behind.
   Mitigation: Bump the schema version and drop obsolete tables/meta in the schema reset path.

## Tasks

1. Simplify the schema reset path to remove persisted serving tables and obsolete snapshot metadata.
2. Refactor gateway-local snapshot/event state reads to derive snapshots directly from source tables.
3. Update tests and package docs to reflect the single-layer storage model.
4. Run required verification, complete the required audit review, and commit the scoped diff.

## Decisions

- Choose the "persist source tables only, derive the serving snapshot on demand" design for local gateway runtime state.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Typecheck passes.
  - Repo tests pass, or any unrelated pre-existing failures are called out precisely.
- Outcomes:
  - Passed: `pnpm --dir packages/cli exec vitest run test/gateway-local-service.test.ts --no-coverage --maxWorkers 1`
  - Passed: `pnpm exec tsc -p packages/gateway-local/tsconfig.json --pretty false`
  - Passed direct scenario proof: one capture produced one derived conversation/message while `gateway_capture_sources` had 1 row and `sqlite_master` showed 0 legacy serving tables.
  - Failed, pre-existing/unrelated: `pnpm typecheck` still stops in the workspace build lane on missing prebuilt outputs and unrelated type/export issues under `packages/assistant-core`, `packages/assistant-cli`, `packages/assistantd`, and `packages/cli`.
  - Failed, pre-existing/unrelated: `pnpm test` still stops in `build:test-runtime:prepared` on the same missing build-output lane plus unrelated type/export issues outside this gateway-local change.
Completed: 2026-04-06
