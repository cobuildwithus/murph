# PR 458 Mixed Vital Panel Fail-Closed Mapping

## Goal

Fix ReviewGPT round 28 for PR #458 by preventing a component-based FHIR vital Observation from importing only the supported measurements while silently dropping unsupported components from the same source resource.

Success criteria:

- A mixed panel with supported and unsupported components produces no import candidate.
- The whole source Observation remains reviewable as one unsupported raw resource.
- Observations with no supported vital components still follow the existing laboratory or unsupported mapping paths.
- Focused importer tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Keep the correction inside the existing Observation mapper; add no persisted state or new abstraction layer.
- Preserve the one-candidate-per-supported-vital-panel behavior from round 27.
- Preserve raw evidence refs and stable FHIR external references.
- Keep the change scoped to the clinical records importer and its tests.

## Current State

- PR #458 has been refreshed from `origin/main` after round 28.
- ReviewGPT round 28 found that unmatched components are skipped after another component maps to a supported vital.
- The mapper now rejects the whole Observation when supported and unmatched components appear in the same panel.
- A regression fixture proves the previous systolic-only partial import and the corrected unsupported result.

## Plan

1. Add a regression fixture for a panel containing one supported vital and one unsupported component.
2. Track unmatched panel components and reject the whole Observation when any supported vital component is present.
3. Run focused importer tests, typecheck, `pnpm test:diff`, and whitespace/privacy checks.
4. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed: 14 files, 306 tests.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` passed.
- `git diff --check` passed.
- Touched-file local identifier scan passed.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
