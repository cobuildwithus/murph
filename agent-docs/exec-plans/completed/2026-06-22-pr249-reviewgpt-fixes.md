Goal (incl. success criteria):
- Address ReviewGPT round 1 findings on PR 249 without broadening the integration ingest journal design.
- Success means hosted canonical replay can safely replay integration-storage migration event-shard rewrites, and valid provider backfills/v1 migrations are not rejected by an arbitrary ingest part cap.

Constraints/Assumptions:
- Keep fixes narrowly scoped to ReviewGPT findings.
- Preserve append-only write policy invariants: only explicit integration-storage migration event-ledger rewrites may carry append-only JSONL authorization through hosted replay.
- Do not add chunking or new storage abstractions unless tests prove the simpler fix is insufficient.

Key decisions:
- Persist `allowAppendOnlyJsonl` through hosted canonical text receipts only when the original staged text write carried it, and permit replay only for `integration_storage_migration` event-ledger JSONL paths.
- Remove the ingest-record evidence part cap instead of adding chunking; the journal row is the intended single manifest for a provider ingest/backfill.

State:
- ReviewGPT round 1 fixes are implemented and verified locally.

Done:
- Confirmed the local migration stages event-shard rewrites with `allowAppendOnlyJsonl: true`.
- Confirmed hosted canonical text receipt replay does not preserve that authorization.
- Confirmed `integrationIngestRecordSchema.parts` has `maxItems: 64`.
- Patched hosted receipt serialization/replay to preserve append-only JSONL authorization for integration-storage migration event-ledger rewrites, while rejecting the flag outside that operation/path scope.
- Patched assistant-runtime hosted workspace restore parsing so remote canonical text receipts retain the append-only JSONL flag.
- Removed the arbitrary `integrationIngestRecordSchema.parts` max item cap and regenerated the JSON schema artifact.
- Added focused regression coverage for hosted receipt replay, assistant-runtime restore replay, and ingest records with more than 64 evidence parts.
- Verification passed:
  - `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/operations-thresholds.test.ts --testNamePattern "hosted canonical receipt replay carries integration migration event rewrite authorization"`
  - `pnpm --filter @murphai/contracts exec vitest run --config vitest.config.ts --no-coverage test/schema-catalog-examples.test.ts --testNamePattern "allows integration ingest records with more than 64 evidence parts"`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts --testNamePattern "restores base snapshots and authoritative latest hot state before mailbox import"`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/contracts typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/contracts test:coverage`
  - `pnpm --filter @murphai/core test:coverage`
  - `pnpm test:diff`

Now:
- Commit and push the ReviewGPT fix pass.

Next:
- Rerun ReviewGPT against PR 249 after the fix commit is pushed.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/core/src/operations/write-batch.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/contracts/src/zod.ts`
- `packages/core/test/operations-thresholds.test.ts`
- `packages/core/test/core.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/contracts/test/schema-catalog-examples.test.ts`
- `packages/contracts/generated/integration-ingest-record.schema.json`
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
