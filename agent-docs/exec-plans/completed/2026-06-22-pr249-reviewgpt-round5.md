# PR 249 ReviewGPT Round 5 Follow-Up

## Goal

Resolve accepted ReviewGPT round 5 findings on PR 249.

Success criteria:

- Dense raw retention never tombstones raw artifacts still referenced by integration ingest records.
- Duplicate samples in one provider batch deduplicate consistently across storage, return values, counts, and ingest outputs.
- The stale migration/raw-delete compatibility suggestion is either removed if truly unused or explicitly rejected with code-path evidence.
- Focused and diff-wide verification pass before committing and rerunning ReviewGPT.

## Scope

- `packages/core/src/wearable-storage-migration.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/integration-ingests.ts`
- Focused core tests covering retention and duplicate sample imports
- Related compatibility/delete surfaces only if inspection proves they are unused and safe to delete
- Review artifacts under `audit-packages/`

## Notes

- Preserve existing vault data.
- Do not remove active raw retention behavior.
- Keep the integration ingest journal compact; avoid broad schema churn unless required by a correctness finding.

## Progress

- Reproduced the dense raw finding with an integration-ingest evidence fixture: pruning tombstoned the referenced raw part and failed validation before the fix.
- Reproduced the duplicate sample finding with a duplicate sample-only provider batch: integration ingest validation failed before the fix.
- Fixed dense raw pruning by including `ledger/integration-ingests` in the raw hard-reference scan.
- Fixed duplicate samples by deduping normalized device samples by deterministic record id before import-id calculation, append planning, return values, counts, and ingest outputs.
- Removed the no-op `allowLegacyIntegrationRaw` validation option.
- Preserved `vault_migration` audit action and raw delete receipt compatibility because those are persisted-data compatibility surfaces for existing vaults/write receipts, not proven-dead code.
- Focused core regression command passed: `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts test/wearable-storage-migration.test.ts test/wearable-receipts.test.ts`.
- Repo gates passed: `pnpm typecheck`, `pnpm test:smoke`, and scoped `bash scripts/workspace-verify.sh test:diff ...` over the round 5 changed files.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
