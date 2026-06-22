# PR 249 ReviewGPT Round 7 Follow-Up

## Goal

Resolve accepted ReviewGPT round 7 findings on PR 249.

Success criteria:

- Dense `debug_temporary` evidence no longer becomes permanently unprunable through immutable integration-ingest references, while durable evidence remains protected for existing vault validation.
- Public `importDeviceBatch` retries without explicit `importedAt` remain idempotent for identical logical deliveries and do not duplicate full raw payloads.
- Junction heart-rate-zone repair avoids repeated full integration-ingest journal scans per candidate.
- Unused raw-delete receipt privilege is removed if inspection confirms no production caller needs it.
- Manifest-only evidence-catalog suggestion is either rejected with code-path evidence or implemented only if it is the smallest safe fix.
- Focused and diff-wide verification pass before committing and rerunning ReviewGPT.

## Scope

- `packages/core/src/mutations.ts`
- `packages/core/src/wearable-storage-migration.ts`
- `packages/core/src/junction-hr-zone-repair.ts`
- `packages/core/src/integration-ingests.ts`
- `packages/core/src/operations/write-batch.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- Focused core/runtime tests for accepted findings
- Review artifact `audit-packages/pr-249-round-7.md`

## Notes

- Preserve existing vaults and existing durable evidence references.
- Do not perform broad integration-ingest schema replacement unless direct inspection proves it is smaller and safer than targeted fixes.
- Current pushed head `353530f53` has green GitHub checks and Vercel; ReviewGPT round 7 found new issues.

## Decisions

- Keep the integration-ingest journal as the durable event/sample lookup index, but exclude dense `debug_temporary` evidence parts from immutable event output references so retention can prune debug payloads.
- Reject a broad manifest-only evidence catalog rewrite for this PR: the targeted durable/debug split removes the retention conflict while preserving existing vault validation and journal query behavior.
- Preserve explicit `importedAt` import IDs, but omit generated `importedAt` from the public idempotency key when callers do not provide it; default omitted timestamps to vault creation time for stable retries.
- Build the Junction repair integration-ingest event index once per repair run and parse evidence from summarized parts directly instead of rescanning the full journal per candidate.
- Remove delete-side raw write-receipt privilege; retain raw text-write privilege for the existing manifest and compaction paths.

## Verification

- `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts test/wearable-storage-migration.test.ts test/operations-thresholds.test.ts` passed.
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- `bash scripts/workspace-verify.sh test:diff` passed for the changed file set.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
