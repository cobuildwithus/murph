# Stop Junction floating timestamps from becoming queryable samples

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Prevent Junction floating wall-time records, especially Libre/LibreView CGM glucose rows with misleading `+00:00` suffixes, from being emitted as canonical queryable samples at the reconcile window timestamp.
- Preserve raw artifact/provenance capture so the original timestamps remain auditable until a user timezone conversion path exists.

## Success criteria

- Floating Junction timeseries rows do not produce `DeviceSamplePayload` rows or canonical wearable sample records.
- Libre/LibreView `+00:00` glucose rows still appear in raw Junction artifacts and import provenance.
- Non-floating glucose rows such as Dexcom UTC rows still produce canonical samples.
- Focused importer tests and the required repo verification/audit passes complete or have documented unrelated blockers.

## Scope

- In scope:
  - `packages/importers/src/device-providers/junction.ts`
  - `packages/importers/test/device-providers-junction.test.ts`
- Out of scope:
  - User timezone fallback conversion.
  - Broad glucose enablement policy.
  - Junction connection/source routing, hosted runtime credentials, and device-sync provider config.
  - Core/query schema changes.

## Constraints

- Technical constraints:
  - Preserve raw artifact creation before normalized sample gating.
  - Do not weaken provenance fields such as `observedAtRaw` or `timestampSemantics`.
  - Keep non-floating sample behavior unchanged.
- Product/process constraints:
  - Treat health data as high sensitivity.
  - Preserve unrelated dirty work and active Junction/device-sync rows.

## Risks and mitigations

1. Risk: Skipping all floating timeseries samples could hide values users expect before timezone support exists.
   Mitigation: raw artifacts and import provenance remain available; only queryable samples are withheld.
2. Risk: Regression for valid UTC glucose streams.
   Mitigation: keep focused Dexcom UTC coverage green.

## Tasks

1. Add a focused sample-emission guard for floating Junction timestamps.
2. Update Junction regression tests for Libre/LibreView floating glucose and generic floating timeseries samples.
3. Run focused importer verification plus required typecheck/diff checks where possible.
4. Run mandatory security/privacy, coverage-write, and final-review passes.
5. Finish or close this plan with a scoped commit if safe.

## Decisions

- Use Option A for Junction floating timeseries rows: raw artifact plus provenance only, with no canonical queryable sample.

## Verification

- Commands to run:
  - `pnpm --dir packages/importers test -- --runInBand` or focused Vitest for `device-providers-junction.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/importers/src/device-providers/junction.ts packages/importers/test/device-providers-junction.test.ts`
- Expected outcomes:
  - Focused importer tests pass.
  - Typecheck/diff-aware verification pass unless blocked by unrelated active work.
Completed: 2026-05-01
