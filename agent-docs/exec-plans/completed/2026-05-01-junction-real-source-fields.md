# Support real Junction nested source provider fields

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make the Junction importer normalize real Junction payloads that carry provider/source attribution under nested `source` or `provider` fields, without requiring Murph-synthetic `sourceProviderSlug` fields.

## Success criteria

- `timeseries.heartrate` entries shaped like Junction's documented `source.provider` payload produce a normalized sample.
- The sample keeps `externalRef.system = "junction"` and a source-specific `externalRef.resourceType`.
- `dataOrigin.sourceProviderSlug`, `sourceType`, and opaque `sourceInstanceId` are populated without retaining raw device/app identifiers.
- Focused importer tests pass, followed by the required repo verification/audit path for the touched package slice.

## Scope

- In scope: `packages/importers` Junction source-provider extraction, raw/profile sanitization, and focused importer tests.
- Out of scope: provider/webhook snapshot shape changes, device-sync provider polling/webhook behavior, query source-selection policy, and broader Junction PR4 work.

## Constraints

- Technical constraints: preserve existing source-instance hashing/minimization and keep Junction as the aggregator in external refs.
- Product/process constraints: coordinate with active Junction importer/device-sync rows and do not revert unrelated dirty hunks in overlapping files.

## Risks and mitigations

1. Risk: overlapping active Junction work has already changed the same importer files.
   Mitigation: keep edits narrow, inspect diffs before staging, and avoid a scoped commit if separating this slice from pre-existing hunks is unsafe.
2. Risk: real nested source fields can include raw device/app identifiers.
   Mitigation: only derive an opaque source instance id and keep raw identifier minimization assertions.

## Tasks

1. Confirm the current extractor and sanitizer paths.
2. Add/adjust the source-provider helper so real Junction nested attribution fields are accepted.
3. Add a direct fixture for ungrouped `timeseries.heartrate[]` with nested `source.provider`.
4. Run focused importer tests and the required package verification/audit path.

## Decisions

- Use the importer-local origin helper rather than changing provider snapshot serialization.
- Ignore non-scalar provider/source-provider values before slug normalization so object-valued provider containers cannot become `object-object` source slugs.
- Leave the separate explicit summary resource-id minimization finding to the overlapping stable-resource-id row; this task only owns source-provider extraction and sanitization.
- Treat grouped Junction timeseries source metadata as authoritative over resolved connection fallback for source-provider/type attribution.

## Verification

- Passed: `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts --config vitest.config.ts --no-coverage`.
- Passed: `pnpm --dir packages/importers typecheck`.
- Passed: `pnpm --dir packages/importers test:coverage`.
- Passed: `pnpm test:smoke`.
- Blocked outside this slice: `pnpm typecheck` passed `packages/importers` and later failed in unrelated active `packages/assistant-runtime` Garmin-removal overlap (`providerConfigs.garmin` no longer exists).
Completed: 2026-05-01
