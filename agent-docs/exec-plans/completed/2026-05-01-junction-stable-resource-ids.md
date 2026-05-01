# Junction Stable Resource IDs

## Goal

Make Junction external reference resource ids stable across mutable payload updates.

Success criteria:

- Summary records with the same explicit Junction id keep the same `externalRef.resourceId` when mutable values change.
- Timeseries samples with the same resource/source/source type/timestamp keep the same `externalRef.resourceId` when mutable values change.
- Different source devices produce different `externalRef.resourceId` values.
- Different resources produce different `externalRef.resourceId` values.

## Constraints

- Do not hash the full mutable Junction payload into `externalRef.resourceId`.
- Keep metric-level distinction in `externalRef.facet`, not in `externalRef.resourceId`.
- Preserve existing active Junction primitive/provider work in this dirty checkout.
- Do not add dependencies.

## Scope

- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- This plan and the coordination ledger row.

## Verification Plan

- Focused Junction importer test coverage.
- `pnpm typecheck`.
- Diff-aware or package-local importer verification according to the repo verification policy.

## State

- Created: 2026-05-01T08:59:14Z.
- Status: focused verified, scoped commit blocked by overlapping dirty Junction importer work.
- Implemented stable summary/timeseries resource ids without hashing full mutable payloads.
- Added regression coverage for same summary id with changed values, same timeseries key with changed value, different source device, and different resource.
- Verification:
  - `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts --config vitest.config.ts --no-coverage` passed.
  - `pnpm --dir packages/importers test:coverage` passed.
  - `pnpm --dir packages/importers typecheck` passed.
  - `pnpm test:smoke` passed.
  - `pnpm typecheck` and scoped `bash scripts/workspace-verify.sh test:diff ...` both reached this package cleanly but failed later in `packages/assistant-runtime` on the active Junction serializable-config row.
- Commit status:
  - No scoped commit: `packages/importers/src/device-providers/junction.ts` and `packages/importers/test/device-providers-junction.test.ts` already contain unrelated active Junction hunks, and this fix builds on that dirty context.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
