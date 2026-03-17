# 2026-03-17 Document Meal Read Simplify

## Goal

Remove duplicated document/meal read projection/runtime-loading logic in the CLI while preserving the current document/meal show, list, and manifest behavior exactly.

## Scope

- `packages/cli/src/commands/query-record-command-helpers.ts`
- `packages/cli/src/commands/sample-query-command-helpers.ts` only if verification is blocked by adjacent implicit-`any` fallout
- `packages/cli/src/usecases/document-meal-read.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/types.ts`
- `packages/cli/src/commands/document.ts`
- `packages/cli/src/commands/meal.ts`
- Targeted document/meal CLI tests only if they are needed to prove unchanged behavior

## Constraints

- Keep `document show` and `meal show` returning the stable `doc_*` / `meal_*` id as `entity.id` even when the lookup uses the `evt_*` alias.
- Keep the event lookup id present in `links` when it differs from the stable display id.
- Preserve `manifest_missing` and `manifest_invalid` behavior exactly for raw manifest reads.
- Keep the refactor small; do not introduce a broader owned-artifact framework.

## Plan

1. Extend the shared query-record helper with the minimal owned-event projection hook needed for document/meal reads.
2. Move the document/meal read implementation to a neutral usecase module that uses the wrapped `loadQueryRuntime()`.
3. Rewire document/meal command registration and integrated services to the neutral module, then delete the pass-through document usecase wrapper.
4. Add only the smallest type annotations needed if the current CLI tree blocks verification on adjacent implicit-`any` errors.
5. Run the requested document/meal runtime tests, then the required repo checks and completion-workflow audits before commit.

Status: completed
Updated: 2026-03-17
