# PR 458 Codeable Concept Ambiguity Fix

## Goal

Fix the accepted PR 458 ReviewGPT round-25 finding that ambiguous FHIR
CodeableConcepts can still emit import candidates for no-known-allergy
assertions and vitals.

## Constraints

- Keep the importer fail-closed at the raw-to-candidate boundary.
- Do not broaden allergy or vital import support.
- Prefer local decision helpers over a new policy layer.

## Working Set

- `packages/importers/src/clinical-records/index.ts`
- `packages/importers/test/clinical-records.test.ts`

## Plan

1. Reject no-known-allergy status concepts that contain any noncanonical or
   non-importable status coding.
2. Make vital CodeableConcept matching fail closed when one concept maps to
   multiple trusted vital facets.
3. Add regressions for mixed vendor/local allergy statuses and ambiguous vital
   LOINC concepts.
4. Run focused importer tests, typecheck, release smoke, commit, push, and
   rerun the ReviewGPT PR loop.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50% pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts` passed.
- `git diff --check` passed.
- Initial `pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` hit unrelated CLI runtime artifact repair-lock timeouts while another local build was active.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` passed.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
