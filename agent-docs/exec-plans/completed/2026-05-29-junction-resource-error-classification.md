# Junction Resource Error Classification

## Goal

Stop treating every Junction 404/422 resource response as harmless empty data.
Only skip resource reads when the provider response clearly says the resource is
unsupported or unavailable; ambiguous failures must fail the job and use the
normal retry/failure diagnostic path.

## Constraints

- Keep the fix local to the Junction provider and existing device-sync job
  result/metadata mechanisms.
- Do not log raw provider bodies, account ids from Junction, tokens, query
  values, or health records.
- Preserve successful partial timeseries chunks only for clearly unavailable
  later chunks.
- Keep diagnostics compact and per account via existing sanitized metadata.

## Plan

1. Classify optional Junction resource failures from safe provider diagnostics
   instead of status code alone.
2. Aggregate skipped optional-resource counts during a provider job and persist a
   compact metadata diagnostic on successful jobs.
3. Keep ambiguous 404/422 responses retryable/failing through existing job
   failure diagnostics.
4. Keep ambiguous-failure metadata provider-owned through a generic failure
   metadata patch detail so the shared service stays provider-agnostic.
5. Add focused provider tests for clear unavailable skips, ambiguous 404/422
   failures, failure metadata persistence, and timeseries chunk behavior.
6. Run focused and package verification, then finish with the repo completion
   workflow.

## Verification

- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-provider.test.ts test/service.test.ts`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts -t 'documented activity and body summary scalar fields'`
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-normalized-surfaces.test.ts test/wearables-source-health-final.test.ts`
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/inbox-incur-smoke.test.ts`
- `pnpm verify:acceptance` (includes hosted-local E2E)
- `git diff --check`
- Scoped and full diff privacy scans for local identifiers and secret markers.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
