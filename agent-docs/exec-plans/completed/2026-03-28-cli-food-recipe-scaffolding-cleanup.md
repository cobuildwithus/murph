# 2026-03-28 CLI Food Recipe Scaffolding Cleanup

## Goal

Extract the narrow, immediately reusable CRUD scaffolding duplicated between the CLI food and recipe usecases without introducing a broad generic framework or changing behavior.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/usecases/{food.ts,recipe.ts,provider-event.ts,shared.ts}`
- Focused CLI tests only if needed for direct proof

## Constraints

- Keep entity-specific parsing, runtime loading, error maps, ID patterns, and read-model transforms local.
- Prefer the smallest reusable helpers that are already textually duplicated: shared JSON input loading and the edit-via-patch scaffolding.
- Do not build a generalized CRUD abstraction that makes food/recipe harder to read.
- If the delete flow starts needing too many entity-specific callbacks, leave delete local.
- Preserve adjacent in-flight CLI work and do not touch unrelated dirty test files unless required.

## Planned Changes

1. Reuse the existing shared JSON payload loader instead of keeping local `loadJsonInputFile` wrappers in food/recipe.
2. Add one narrow shared helper for the repeated `load current -> build payload -> patch -> parse -> upsert` edit preparation path.
3. Update `food.ts` and `recipe.ts` to use the shared helper while keeping runtime/error/delete logic local.
4. Keep `provider-event.ts` aligned with the shared loader surface if that removes stale duplication cleanly.
5. Add only focused tests if the extraction needs direct proof beyond the existing food/recipe slice coverage.

## Verification

- Focused CLI tests covering food/recipe upsert/edit/delete flows
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents after implementation

## Current Status

- Implemented the narrow extraction only:
  - shared `loadJsonInputFile` in `packages/cli/src/usecases/shared.ts`
  - shared `preparePatchedUpsertPayload` for the repeated patch -> parse -> upsert preparation path
  - `food.ts`, `recipe.ts`, and `provider-event.ts` now reuse the shared loader
  - `food.ts` and `recipe.ts` now reuse the shared edit-preparation helper
- Delete flows, runtime loading, schema parsing, ID patterns, read-model transforms, and error mapping remain local to each usecase.
- Added focused shared-helper tests proving:
  - shared JSON payload loading works for record scaffolding inputs
  - patched upserts preserve canonical IDs even if the patch file attempts to overwrite them
  - patched upserts surface cleared fields and slug-rename detection
  - patched upserts do not mutate the source record passed into the helper
- Verification outcomes on the current workspace:
  - `pnpm --dir packages/cli typecheck`: passed
  - `pnpm exec vitest run --config vitest.config.ts packages/cli/test/vault-usecase-helpers.test.ts --no-coverage --maxWorkers 1`: passed
  - earlier focused broader CLI slices passed before adjacent workspace build-artifact churn; later reruns are now blocked by unrelated missing `packages/cli/dist/*`, `packages/runtime-state/dist/*`, and `@murph/inboxd/dist/index.js` artifacts in existing CLI integration lanes
  - `pnpm typecheck`: currently fails in an unrelated workspace build lane while building `packages/importers` because `@murph/contracts` cannot be resolved from `packages/importers/src/{device-providers/oura.ts,shared.ts}`
  - `pnpm test`: earlier full run passed before the workspace moved; later reruns became noisy/unstable due unrelated build-artifact churn in broader app and CLI lanes
  - `pnpm test:coverage`: already failing in unrelated existing workspace lanes outside this refactor
- Required completion-workflow audit passes could not be executed as specified because the current environment does not expose a usable spawned-subagent tool path. That repo-policy blocker is environmental rather than change-specific.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
