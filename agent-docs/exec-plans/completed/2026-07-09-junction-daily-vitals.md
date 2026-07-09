# Junction daily vitals

## Goal

Fix the Junction Apple HealthKit path so product-needed daily SpO2 and
respiratory-rate facts are not silently dropped going forward.

Success criteria:

- Reproduce the current failure mode with focused tests: a Junction config or
  import path that keeps summaries but omits compact daily vitals.
- Preserve the architecture rule that dense timeseries are not stored by
  default.
- Ensure `blood_oxygen` and `respiratory_rate` land through the compact daily
  Junction timeseries path when Junction exposes them.
- Verify focused device-sync/importer coverage plus typecheck.

## Constraints

- Do not store dense provider sample arrays or real user health payloads in
  committed fixtures.
- Keep provider-specific behavior in the Junction provider/importer seams.
- Preserve existing summary ingestion, source attribution, and optional-resource
  skip metadata.
- Do not expose local identifiers, full paths, secrets, provider account ids, or
  raw health values in committed artifacts or handoff text.

## Approach

1. Inspect current Junction config normalization, timeseries fetch scheduling,
   and importer daily aggregate mapping.
2. Add a regression for legacy/explicit `JUNCTION_TIMESERIES_RESOURCES` config
   that would otherwise drop required daily vitals.
3. Patch the smallest owner boundary so required compact vitals stay present
   while dense resources remain opt-in/excluded.
4. Run focused tests/typecheck and review the diff.

## State

Ready to close.

## Notes

- User-provided Apple Health export contains daily WHOOP-written SpO2 and
  respiratory-rate records, while the supplied vault raw Junction ingests have
  no `timeseriesResources`.
- Current importer already supports compact daily `blood_oxygen` and
  `respiratory_rate` observations when the Junction snapshot contains those
  resources.
- Verification:
  - `pnpm --dir packages/device-syncd test -- provider-manifests.test.ts junction-provider.test.ts`
    passed.
  - `pnpm --dir packages/device-syncd typecheck` passed.
  - `pnpm --dir packages/device-syncd test:coverage` passed.
  - `pnpm build:test-runtime:prepared` passed to prepare generated package
    artifacts in the fresh worktree.
  - Root `pnpm typecheck` reached green package/app typecheck fanout after
    prepared artifacts, but the independent workspace-boundary preflight did
    not exit and was interrupted.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
