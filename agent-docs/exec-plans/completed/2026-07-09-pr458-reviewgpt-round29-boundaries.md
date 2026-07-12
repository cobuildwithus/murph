# PR 458 ReviewGPT Round 29 Boundaries

## Goal

Fix the two accepted ReviewGPT round 29 findings for PR #458: prevent component-bearing scalar vital Observations from partially importing, and constrain raw clinical manifests to the documented clinical FHIR path family whose connection and retrieval identities match the manifest.

Success criteria:

- A top-level supported vital with any unhandled component produces no candidate and one unsupported raw resource.
- Clinical manifest input accepts only `raw/clinical/fhir/<connectionId>/<retrievalJobId>/manifest.json`.
- Path identifiers are safe single segments and match the parsed manifest identity.
- Raw resource refs remain derived beneath the validated manifest directory.
- Focused tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Keep component-bearing vital ownership in the existing Observation mapper.
- Keep generic `clinicalRawPathSchema` for already-classified raw evidence refs; add only the dedicated manifest boundary.
- Reuse the manifest path schema in the contract, raw-ref derivation, import-plan source, and importer entry point.
- Add no persisted state, migration, or compatibility layer.

## Current State

- Both round 29 regressions are fixed: component-bearing scalar vitals are rejected as a unit, and clinical FHIR manifest paths are constrained and bound to their manifest identity before resource pages are read.
- Focused package tests, workspace typecheck, and the full diff-aware verification suite pass.
- Final commit, push, PR CI, and the next ReviewGPT round remain.

## Plan

1. Add failing regressions for the scalar vital bypass, out-of-family manifest path, and mismatched path identity.
2. Make scalar vital mapping component-free only.
3. Add and reuse a dedicated clinical FHIR manifest path schema and identity check.
4. Run focused package tests, typecheck, `pnpm test:diff`, and whitespace/privacy checks.
5. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- `pnpm --dir packages/clinical-records test -- contracts.test.ts` (8 passed)
- `pnpm --dir packages/importers test -- clinical-records.test.ts` (308 passed across 14 files)
- `pnpm typecheck` (passed)
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/clinical-records/src/index.ts packages/clinical-records/test/contracts.test.ts packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` (passed)
- `git diff --check` (passed)
- Touched-file privacy scan (passed)

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
