# PR 458 NKDA Conflict ReviewGPT Fix

## Goal

Fix the accepted PR 458 ReviewGPT finding that unsafe or contradictory
no-known-allergy FHIR resources can fail local mapping while still not blocking
a global no-known-allergies candidate.

## Constraints

- Keep the clinical intake foundation conservative and fail closed.
- Reuse the existing allergy-intake predicates; do not add a new state owner or
  policy layer.
- Preserve unrelated PR 458 worktree changes.

## Working Set

- `packages/importers/src/clinical-records/index.ts`
- `packages/importers/test/clinical-records.test.ts`

## Plan

1. Inspect the existing no-known-allergy mapper and conflict scan.
2. Collapse safe NKDA recognition to one predicate shared by the mapper and
   conflict scanner.
3. Add a regression where contradictory unsafe NKDA evidence blocks a global
   NKDA candidate.
4. Run focused importer tests, typecheck, diff checks, commit, push, and rerun
   the PR ReviewGPT loop.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50% pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts` passed locally on the branch head.
- `pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
