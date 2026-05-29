# Junction retention review fixes

Status: completed
Created: 2026-05-29
Updated: 2026-05-29

## Goal

- Close post-commit review findings for Junction dense raw retention without
  broadening the architecture or touching unrelated Junction/provider lanes.

## Success criteria

- Hosted automatic retention invokes only dense raw pruning, not legacy receipt
  compaction or derived canonical raw tombstoning.
- Dense raw pruning honors `maxBytes` as a hard per-pass candidate budget.
- Newly added distance and active-calories terms require an explicit timeseries
  role marker and do not classify exact summary/product roles.
- Focused tests cover the above edge cases.

## Scope

- In scope:
  - `packages/core/src/wearable-storage-migration.ts`
  - `packages/core/test/wearable-storage-migration.test.ts`
  - `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
  - `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
  - `packages/hosted-execution/src/runtime-control.ts`
- Out of scope:
  - Junction provider fetch/window changes.
  - Query/read visibility changes.
  - New cron, queue, or scheduling infrastructure.

## Constraints

- Preserve tombstone proof, manifest byte/SHA validation, and metadata-only logs.
- Keep the existing operator repair defaults unless a caller explicitly scopes
  the migration pass.
- Preserve unrelated dirty work in the checkout.

## Risks and mitigations

1. Risk: Automatic hosted pruning mutates broader repair classes.
   Mitigation: add a narrow class-selection option and use dense-only scope from
   hosted runtime.
2. Risk: Metric-name exact roles overclassify sparse/product facts.
   Mitigation: require timeseries markers for the new distance and active-calorie
   terms and add exact-role preservation tests.

## Tasks

1. Add a dense-only migration class scope for hosted retention.
2. Enforce the byte budget before preparing over-budget candidates.
3. Tighten role classification for new Junction terms.
4. Add focused regression tests and rerun affected checks.

## Verification

- Passed:
  - `pnpm --dir packages/core test -- test/wearable-storage-migration.test.ts`
  - `pnpm --dir packages/core test:coverage -- test/wearable-storage-migration.test.ts`
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/assistant-runtime test:coverage -- test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/hosted-execution test -- test/hosted-runtime-control.test.ts`
  - `pnpm --dir packages/hosted-execution test:coverage -- test/hosted-runtime-control.test.ts`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/vault-usecases test -- test/runtime.test.ts`
  - `pnpm --dir packages/vault-usecases test:coverage -- test/runtime.test.ts`
  - `pnpm --dir packages/vault-usecases typecheck`
  - Scoped `git diff --check`
- Blocked:
  - `bash scripts/workspace-verify.sh test:diff ...` reached package tests and
    failed in unrelated dirty `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
    progress-delivery coverage outside this task's working set.
Completed: 2026-05-29
