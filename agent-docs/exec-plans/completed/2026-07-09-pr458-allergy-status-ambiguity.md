# PR 458 Allergy Status Ambiguity Fix

## Goal

Fix the accepted PR 458 ReviewGPT round-24 finding that ambiguous canonical
AllergyIntolerance statuses can still emit a global no-known-allergies
candidate.

## Constraints

- Keep the shared NKDA importability predicate as the mapper/conflict-scan owner.
- Fail closed on contradictory canonical status codings.
- Do not broaden allergy import support or add a new policy layer.

## Working Set

- `packages/importers/src/clinical-records/index.ts`
- `packages/importers/test/clinical-records.test.ts`

## Plan

1. Add a strict canonical CodeableConcept status helper for AllergyIntolerance
   status concepts.
2. Use it from `hasImportableAllergyStatus`.
3. Add regressions for confirmed+refuted verification status and
   active+inactive clinical status.
4. Run focused importer, typecheck, release smoke, commit, push, and rerun the
   ReviewGPT PR loop.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50% pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
