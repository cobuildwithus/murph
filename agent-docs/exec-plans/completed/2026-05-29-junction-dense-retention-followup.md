# Deep Review Fixups

## Goal

Fix the dense-retention follow-ups and confirmed deep-review defects with the
smallest durable boundary changes: automatic hosted dense raw pruning through a
named core primitive, metadata-backed Junction dense classification while
keeping weight sparse, pure dense raw tombstone planning, bounded/cancellable
progress delivery, Junction historical import/privacy boundary hardening, and
symmetric device-sync success fencing.

## Success Criteria

- Dense raw retention never writes manifest changes for tombstone candidates
  that were rejected by deadline/budget after planning.
- Hosted post-device-sync maintenance runs only the named dense raw prune
  primitive with recent dense raw excluded and bounded budgets; no generic
  maintenance framework, queue, table, or broad migration loop is introduced.
- New Junction dense timeseries artifacts carry explicit retention metadata,
  with `weight` remaining sparse/provider evidence rather than dense-pruned.
- Progress updates cannot block final-answer delivery indefinitely or arrive
  after the final answer path is released.
- Hosted Linq progress delivery can recover the same-wake direct recipient
  without treating wake contact lookup fields as sender authority.
- Junction historical backfills import fetched configured summaries separately
  from strict backfill completion decisions.
- Junction raw artifact sanitization strips direct user/account identifiers at
  the importer boundary.
- Successful device-sync completion is fenced by the captured local connection
  revision, matching failure completion.

## Constraints

- Do not hard-delete raw artifacts; keep tombstone and manifest proof behavior.
- Do not log provider payloads, health rows, account ids, local paths, or direct
  identifiers.
- Keep the architecture narrow: no new cron, queue, table, generic maintenance
  framework, or broad refactor.
- Preserve unrelated active work in hosted dirty-ack and Murph Age lanes.

## Plan

1. Add a narrow core `pruneWearableDenseRawTimeseries` wrapper and route hosted
   post-device-sync maintenance through it directly.
2. Tag Junction dense timeseries raw artifacts at creation time, keep `weight`
   sparse, and keep legacy role-string fallback for old artifacts.
3. Make raw tombstone planning side-effect-free and materialize manifest and
   provenance updates from accepted tombstones only.
4. Add a bounded progress-drain/abort path and pass hosted wake context into
   Linq progress dependencies without granting wake-derived sender authority.
5. Split Junction summary import from historical completion and extend strict
   completion coverage for newly supported configured resources.
6. Broaden shared Junction raw identity sanitization and enforce it in importer
   raw artifacts.
7. Add `localConnectionRevision` to successful sync completion fencing.
8. Add focused regression tests for each confirmed defect.

## Verification

- Focused core, assistant-engine/runtime, device-syncd, and importer tests for
  the changed behavior passed.
- `pnpm --dir packages/core test -- test/wearable-storage-migration.test.ts`
  passed.
- `pnpm --dir packages/importers typecheck` and focused Junction importer tests
  passed.
- `pnpm --dir packages/assistant-runtime typecheck` and focused hosted-runtime
  tests passed.
- `pnpm --dir packages/assistant-engine typecheck` and focused progress/outbox
  tests passed.
- `pnpm --dir packages/device-syncd typecheck` and focused service/Junction
  tests passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff <touched files>` passed.
- Required coverage, simplification/architecture, security/privacy, and
  task-finish audits ran; their findings were fixed.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
