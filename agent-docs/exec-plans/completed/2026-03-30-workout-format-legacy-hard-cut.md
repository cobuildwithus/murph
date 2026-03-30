# Remove workout-format legacy compatibility

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

- Remove the temporary legacy workout-format compatibility layer so workout-format bank docs only read through first-class frontmatter fields and ids.

## Success criteria

- Contracts/query/core/CLI no longer derive workout-format ids from slugs or read `type` / `text` as compatibility aliases for first-class workout-format fields.
- Query and CLI workout-format reads still work for first-class docs that carry `workoutFormatId`, `activityType`, and optional `templateText`.
- Focused tests cover the tightened behavior and no longer encode legacy workout-format compatibility expectations.

## Scope

- In scope:
  - `packages/contracts/src/bank-entities.ts`
  - `packages/core/src/bank/workout-formats.ts`
  - `packages/query/src/health/registries.ts`
  - `packages/cli/src/usecases/workout-format.ts`
  - Focused workout-format tests in `packages/{core,query,cli}/test/**`
- Out of scope:
  - Broader workout quick-capture behavior outside the saved workout-format seam
  - Unrelated dirty hosted-runner work already present in the repo

## Constraints

- Technical constraints:
  - Preserve the current first-class workout-format document shape and the existing shared bank-registry path.
- Product/process constraints:
  - Keep the change narrow to legacy compatibility removal only.
  - Run focused verification plus the repo-required audit passes before handoff.

## Risks and mitigations

1. Risk: Tightening the read path could accidentally break current first-class workout-format docs or query lookups.
   Mitigation: Remove only the explicit legacy fallbacks, then add focused tests around first-class docs and failed legacy reads.

## Tasks

1. Update the workout-format bank entity contract so the registry seam only projects first-class workout-format ids and frontmatter fields.
2. Remove legacy compatibility fallbacks from core/query/CLI workout-format readers and align focused tests with the stricter behavior.
3. Run focused verification, a direct CLI scenario check, the mandatory audit passes, and finish the task through the plan workflow.

## Decisions

- Keep first-class docs without `templateText` readable in the CLI; that behavior is not legacy compatibility and still supports inspectability while `log` enforces template presence.

## Verification

- Commands to run:
  - `pnpm --dir packages/contracts typecheck`
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core test`
  - `pnpm --dir packages/query typecheck`
  - `pnpm --dir packages/query test`
  - `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts --no-coverage --maxWorkers 1`
  - One direct built-CLI workout-format save/show scenario
- Expected outcomes:
  - Legacy workout-format docs without first-class ids/fields fail fast instead of receiving compatibility ids.
  - First-class workout-format docs continue to save, list, show, and log correctly.

## Status

Implemented in this clone. Workout formats now require first-class `workoutFormatId` in contracts/core/query/CLI, no longer read `type` / `text` as workout-format compatibility aliases, and no longer derive compatibility ids from slugs. Query skips stale legacy workout-format docs during registry scans, while the CLI now preserves direct targeted errors for legacy docs but skips those stale leftovers during broader scans so valid first-class docs still show, list, and log cleanly in mixed vaults.

## Verification Notes

- `pnpm --dir packages/contracts typecheck` passed.
- `pnpm --dir packages/core typecheck` passed.
- `pnpm --dir packages/core test` passed.
- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/query test` passed.
- `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts --no-coverage --maxWorkers 1` passed before and after the final CLI scan-path fix; final run covered 14 tests.
- Direct built-CLI scenario before the final scan-path fix confirmed first-class `workout format save/show` emitted a first-class `workoutFormatId`, `activityType`, and `templateText`.
- Final completion audit reported no remaining actionable findings after the mixed-directory CLI regression fix and recorded a direct built-CLI mixed-directory check where valid first-class docs still showed/listed while direct legacy lookup failed with the targeted missing-`workoutFormatId` error.
- `pnpm --dir packages/cli typecheck` remains red for unrelated pre-existing errors in `packages/cli/test/assistant-service.test.ts` and `packages/cli/test/assistant-state.test.ts`.
- Repo-required wrappers remain red for unrelated pre-existing `apps/web` typecheck failures at `apps/web/src/lib/hosted-execution/hydration.ts:267` and `apps/web/src/lib/hosted-execution/usage.ts:81`.
Completed: 2026-03-30
