# PR 458 Vital Panel Candidate Collapse

## Goal

Fix ReviewGPT round 27 for PR #458 by ensuring one FHIR vital-sign Observation maps to at most one Murph vitals import candidate, even when the Observation contains multiple supported vital components.

Success criteria:

- Supported vital components on one Observation become one vitals candidate with multiple measurements.
- A valid 5,000-resource raw manifest cannot exceed the 5,000-candidate cap solely because vital panels have multiple components.
- Ambiguous, duplicate, unsupported, or invalid vital component evidence still fails closed for that Observation.
- Focused importer tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Keep `packages/importers` as a pure importer surface; canonical writes stay owned by `packages/core`.
- Do not add new persisted state, queues, or compatibility machinery.
- Preserve raw evidence refs and stable FHIR external references.
- Keep the fix scoped to clinical record importer mapping and tests unless direct evidence requires more.

## Current State

- PR #458 head has green CI at `5945c67dfa`.
- ReviewGPT round 27 found a candidate-cap bug for multi-component vital Observations.
- Implemented component-vital collapse so supported components produce one Observation-level vitals candidate with multiple measurements.
- Added regression coverage for a 2,501-resource blood-pressure-panel manifest that previously would have produced 5,002 candidates.

## Plan

1. Inspect the existing vital Observation mapper and import-plan candidate schema.
2. Collapse component vitals into one candidate per source Observation.
3. Add tests for blood-pressure collapse, cap regression, and fail-closed component duplication/ambiguity.
4. Run focused importer tests, typecheck, `pnpm test:diff`, and whitespace/privacy checks.
5. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` passed.
- `git diff --check` passed.
- Touched-file local identifier scan passed.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
