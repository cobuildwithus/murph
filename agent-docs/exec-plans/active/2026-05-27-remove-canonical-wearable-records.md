# Remove unused canonical wearable records

Status: active
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

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched files>`
- Focused package tests if the diff-aware lane is not specific enough.
- Expected outcomes:
- Checks pass, or unrelated pre-existing failures are called out with exact failing targets.
