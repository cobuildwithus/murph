# Normalize Dates in wearable raw receipts

Status: completed
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Ensure Date-valued wearable provider snapshots and raw artifact content serialize deterministically and safely.
- Valid `Date` objects should hash/write as ISO strings, matching already-stringified provider payloads.
- Invalid `Date` objects should fail with explicit errors instead of becoming `{}` or causing unclear receipt hash failures.

## Success criteria

- `buildWearableRawIngestReceipt` produces the same `payloadHash` for a valid `Date` and its ISO string form.
- `buildWearableRawIngestReceipt` rejects invalid `Date` values with a clear boundary error.
- Core raw artifact persistence writes valid `Date` values as ISO strings in compact stable JSON.
- Core raw artifact persistence rejects invalid `Date` values with `VAULT_INVALID_RAW_CONTENT`.
- Focused importer/core tests, owner coverage, typecheck, smoke, and required completion audits pass.

## Scope

- In scope:
  - Wearable raw receipt payload normalization in `packages/importers`.
  - Core raw artifact stable JSON normalization in `packages/core`.
  - Focused regression tests for valid and invalid `Date` values.
- Out of scope:
  - Changing provider fetch policy, gzip/chunking, timeseries storage, raw search indexing, or historical artifact migration.
  - Renaming the canonical wearable record internal `envelopeId` ID extra.

## Constraints

- Technical constraints:
  - Do not change stable receipt ID ingredients beyond the normalized payload hash behavior for valid `Date` objects.
  - Preserve raw artifact immutability and compact JSON output.
  - Keep changes at the importer/core boundary; no new persisted state.
- Product/process constraints:
  - Preserve unrelated working-tree edits.
  - Do not expose local account names, home paths, raw health payloads, or provider credentials in logs, docs, tests, or commits.

## Risks and mitigations

1. Risk: Normalizing `Date` values could mask invalid timestamps.
   Mitigation: Reject non-finite `Date` values explicitly.
2. Risk: New behavior changes historical receipt hash results for callers that previously failed on `Date`.
   Mitigation: Only make previously valid schema shapes hashable; ISO-string payloads remain unchanged and equivalent to valid `Date` values.

## Tasks

1. Patch wearable raw receipt normalization for valid and invalid `Date` objects.
2. Patch core raw artifact stable sorting for valid and invalid `Date` objects.
3. Add focused importer/core regression tests.
4. Run scoped package coverage, typecheck, smoke, privacy/stale scans, and completion audits.
5. Close the plan with a scoped commit.

## Decisions

- Use ISO strings as the canonical JSON representation for valid `Date` objects at both receipt-hash and raw-artifact serialization boundaries.
- Keep this change migration-free: existing artifacts are not read, rewritten, deleted, or dropped.

## Verification

- Commands to run:
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts test/garmin-provider-coverage.test.ts`
  - `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts`
  - `pnpm --dir packages/importers test:coverage`
  - `pnpm --dir packages/core test:coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- <task paths>`
  - Scoped stale-reference and privacy scans over task files.
- Expected outcomes:
  - Focused tests prove valid `Date` values normalize to ISO and invalid `Date` values fail closed.
  - Coverage/typecheck/smoke remain green.
- Results:
  - Passed: `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts test/garmin-provider-coverage.test.ts` (2 files, 31 tests).
  - Passed: `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts` (1 file, 19 tests).
  - Passed: `pnpm --dir packages/importers test:coverage` (14 files, 180 tests).
  - Passed: `pnpm --dir packages/core test:coverage` (32 files, 353 tests).
  - Passed: `pnpm typecheck`.
  - Passed: `pnpm test:smoke`.
  - Passed: `git diff --check -- <task paths>`.
  - Passed: added-diff privacy scan had no direct identifier or credential matches.
  - Stale-reference scan had no unexpected task-scope matches; the only relevant old envelope string remains the intentional legacy-role exclusion in core.

## Audits

- `security-privacy-review`: no findings. Residual noted that ordinary in-process `Date` objects are covered; exotic cross-realm or custom Date-like values stay outside this narrow provider snapshot path.
- `coverage-write` on `gpt-5.5` with medium reasoning: no test edits needed; direct receipt, Junction integration, valid raw artifact, and invalid raw artifact Date cases are covered.
- `task-finish-review`: no findings. Same non-blocking cross-realm/custom Date-like residual noted.
Completed: 2026-05-22
