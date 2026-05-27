# Remove unused canonical wearable records

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Remove the unused `canonicalWearableRecords` pathway so provider imports expose only durable evidence and compact facts.
- Keep raw provider artifacts and wearable raw receipt artifacts as the persisted evidence path.

## Success criteria

- Importer/core payload types no longer expose `canonicalWearableRecords` or `rawIngestReceipts`.
- Provider snapshot preparation still writes the wearable raw receipt as a normal raw artifact.
- Query no longer exports or tests the in-memory canonical wearable dataset path.
- Focused importer/query/core checks pass, or any unrelated blocker is documented.

## Scope

- In scope:
- `packages/importers` payload types, snapshot preparation, exports, and tests.
- `packages/query` canonical wearable helper export/test removal.
- Narrow docs that would otherwise describe canonical wearable records as current.
- Out of scope:
- New durable wearable storage.
- Dense telemetry policy work from the active query cleanup lane.
- Provider transport/runtime changes.

## Constraints

- Technical constraints:
- Do not disturb unrelated dirty work in overlapping core/query/importer files.
- Preserve core-owned raw artifact persistence and existing compact events/metrics.
- Product/process constraints:
- Favor the simplest honest architecture: raw evidence plus compact durable facts plus rebuildable query summaries.
- Do not expose raw health payloads, account identifiers, local paths, or direct personal identifiers.

## Risks and mitigations

1. Risk:
   Tests or active work still depend on the future canonical-record helper.
   Mitigation:
   Remove only the public/import path and update focused tests to assert durable raw receipt artifacts instead.
2. Risk:
   Overlap with active Garmin/query cleanup rows causes unsafe partial staging.
   Mitigation:
   Keep edits narrow and stop before committing if unrelated changes prevent a scoped `finish-task`.

## Tasks

1. Remove canonical wearable payload fields and snapshot computation.
2. Remove query canonical wearable dataset export/test path.
3. Update importer tests and docs around raw receipt artifacts.
4. Run focused verification and completion audits.

## Decisions

- Do not add core storage for canonical wearable records in this slice.
- Keep wearable raw receipts only as raw artifacts/provenance, not as separate payload objects.

## Verification

- Passed:
- `pnpm --dir packages/importers exec vitest run test/wearable-evidence.test.ts test/device-providers-junction.test.ts test/device-providers.test.ts test/strava.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/device-syncd exec vitest run test/oura-provider.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-normalized-surfaces.test.ts test/wearables-source-health-final.test.ts`
- `pnpm --dir packages/core exec vitest run test/device-import.test.ts --config vitest.config.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check` on touched files
- Required audits:
- `security-privacy-review`: no findings.
- `coverage-write`: no findings.
- `task-finish-review`: fixed stale app tsconfig alias, active plan references, and metric-doc wording found by the review.
- Known unrelated blocker:
- `bash scripts/workspace-verify.sh test:diff <touched files>` broadened to `packages/cli` and failed there because the CLI harness could not resolve `packages/runtime-state/dist/hosted-bundle-ref.js` and then timed out/faulted several CLI-list tests. The wearable/importer/query/device-syncd focused checks above passed.
Completed: 2026-05-27
