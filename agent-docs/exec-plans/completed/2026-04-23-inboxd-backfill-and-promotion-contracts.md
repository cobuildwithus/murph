# Push inbox backfill orchestration into inboxd and stop re-deriving promotion IDs

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Remove the inbox-services-owned historical backfill loop/checkpoint logic and promotion-id derivation so inboxd and core remain the single owners of those contracts.

## Success criteria

- Historical inbox backfill delegates cursor checkpointing and single-connector orchestration to inboxd instead of maintaining a service-local emit loop.
- Optional historical backfill parsing reuses inboxd's parsed-pipeline composition instead of creating and draining a separate parser service in inbox-services.
- `buildCaptureCursor` stops locally re-deriving the checkpoint shape and instead delegates to inboxd's exported checkpoint helper.
- Journal and experiment-note promotion persistence/results use the IDs returned by core (`result.lookupId` / `result.relatedId` for journal, `result.experimentId` / `result.relatedId` for experiment-note).
- Focused inbox-services and inboxd coverage proves the delegated backfill path and the promotion result-contract behavior.

## Scope

- In scope:
- `packages/inbox-services/src/inbox-app/{runtime.ts,promotions.ts,types.ts}`
- `packages/inbox-services/src/inbox-services/query.ts`
- directly coupled `packages/inbox-services/test/{inbox-app-reads-runtime,promotions-seam,service-layer-coverage,inbox-services-core-seams}.test.ts`
- `packages/inboxd/src/{index.ts,runtime.ts,kernel/daemon.ts}`
- directly coupled `packages/inboxd/test/{connectors-daemon,inboxd-parsers-shared-coverage}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-inboxd-backfill-and-promotion-contracts.md,COORDINATION_LEDGER.md}`
- Out of scope:
- inboxd persistence/recovery work already tracked in the active inboxd storage rows
- connector-specific normalization or parser-runtime redesign
- broader promotion-target lookup rules or canonical mutation behavior changes inside core

## Constraints

- Technical constraints:
- Preserve the current dirty tree and avoid widening into the adjacent inboxd persistence rows or unrelated inbox-services seams.
- Keep imports on declared public package entrypoints only; if inbox-services needs inboxd helpers, expose them through inboxd's owner surface instead of reaching into source internals.
- Keep the refactor small: move orchestration to inboxd with a focused helper rather than redesigning the broader daemon/runtime API.
- Product/process constraints:
- Follow the standard repo-change workflow: scoped verification, required `coverage-write` and `task-finish-review` audit passes, then a scoped commit if the shared dirty tree allows it.

## Risks and mitigations

1. Risk: a new inboxd backfill helper could subtly change cursor semantics relative to current historical backfill behavior.
   Mitigation: add focused inboxd helper coverage for checkpoint writes/final cursor behavior and update inbox-services runtime tests against that owner-defined contract.
2. Risk: adding helper exports could drift the inboxd root/runtime barrels.
   Mitigation: extend the existing inboxd barrel-alignment coverage alongside the helper export.
3. Risk: promotion persistence could start trusting the wrong IDs if the core contract assumptions are wrong.
   Mitigation: keep the existing target-resolution checks, but persist and return the exact IDs from core and add focused seam assertions.

## Tasks

1. Add a focused inboxd single-connector backfill helper and export the helper/checkpoint seams through the appropriate owner entrypoints.
2. Switch inbox-services historical backfill to use inboxd's backfill helper plus inboxd's parsed-pipeline helper, while keeping the service layer limited to connector instantiation and result summarization.
3. Replace the local `buildCaptureCursor` implementation with delegation to inboxd's checkpoint helper.
4. Update journal and experiment-note promotions to persist and return the IDs produced by core.
5. Run scoped verification, required audit passes, and a scoped finish/commit flow if the shared dirty tree permits it.

## Decisions

- Use a focused owner helper in inboxd instead of pushing historical backfill through the full daemon watch loop.
- Keep the service-layer `buildCaptureCursor` name for compatibility, but make it a direct delegation to inboxd's checkpoint helper so inbox-services no longer owns the checkpoint shape.
- Preserve historical backfill semantics by keeping parsed-pipeline drain ownership in inboxd but adding a focused `drainParsersOnDeduped: false` path for backfill.
- Persist a separate `captureEventId` alongside promotion rows so experiment-note retries can still verify capture binding even after `relatedId` starts mirroring the core-returned canonical id.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inbox-services/src/inbox-app/runtime.ts packages/inbox-services/src/inbox-app/promotions.ts packages/inbox-services/src/inbox-app/types.ts packages/inbox-services/src/inbox-services/query.ts packages/inbox-services/test/inbox-app-reads-runtime.test.ts packages/inbox-services/test/promotions-seam.test.ts packages/inbox-services/test/service-layer-coverage.test.ts packages/inbox-services/test/inbox-services-core-seams.test.ts packages/inboxd/src/index.ts packages/inboxd/src/runtime.ts packages/inboxd/src/kernel/daemon.ts packages/inboxd/test/connectors-daemon.test.ts packages/inboxd/test/inboxd-parsers-shared-coverage.test.ts`
- `pnpm --dir packages/inbox-services test:coverage`
- `pnpm --dir packages/inboxd test:coverage`
- `pnpm test:smoke`
- `git diff --check`
- Expected outcomes:
- Backfill proof shows inbox-services using inboxd-owned checkpointing/parsing composition, with imported/deduped counts and cursor writes still correct.
- Promotion seam proof shows the persisted/returned IDs now mirror the core-returned values rather than locally re-derived ones.
- Actual outcomes:
- `pnpm --dir packages/inbox-services test:coverage` passed.
- Focused direct proof passed via `pnpm --dir packages/inbox-services exec vitest run --config vitest.config.ts test/inbox-app-reads-runtime.test.ts test/promotions-seam.test.ts test/service-layer-coverage.test.ts test/inbox-app-types-environment.test.ts test/inbox-app-environment-sources.test.ts` and `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts test/connectors-daemon.test.ts test/inboxd-parsers-shared-coverage.test.ts`.
- `pnpm test:smoke` passed.
- `git diff --check -- <touched paths>` passed.
- Required `simplify`, `coverage-write`, and `task-finish-review` audit passes completed. `simplify` found two medium issues (deduped parser drains and lost experiment capture-binding invariant); both were fixed locally and reverified. `coverage-write` returned a no-change conclusion, and `task-finish-review` returned no remaining findings.
- `pnpm typecheck` remains blocked by unrelated pre-existing `packages/vault-usecases` errors.
- Diff-aware verification plus current `packages/inboxd` / `packages/inbox-services` package-wide typecheck and inboxd package-wide coverage reruns are now blocked by unrelated dirty work in `packages/inboxd/src/kernel/sqlite.ts` (`generatePrefixedId` missing), outside this task's write set.
Completed: 2026-04-24
