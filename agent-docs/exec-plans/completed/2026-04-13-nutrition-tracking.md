# Nutrition Tracking Implementation Plan

## Goal

Add a clean canonical nutrition-tracking seam so Murph can durably store meal calories/macros, reuse per-serving nutrition for saved foods, and expose simple totals/trend reads without turning meal logging into a heavy calorie-counting workflow.

## Why

- The assistant prompt already encourages nutrition inference for meals, but the canonical storage model does not currently have durable nutrition fields for foods or meals.
- Users should be able to ask Murph to track protein, calories, and basic macros over time with queryable product truth instead of ad hoc assistant text.
- The implementation should preserve Murph's low-friction meal logging posture: nutrition is optional, provenance-aware, and not required to log a meal.

## Scope

1. Extend canonical contracts and core-owned food/meal models with optional nutrition fields.
2. Propagate those fields through core, usecases, query projections, CLI surfaces, and assistant tools.
3. Allow assistant-bound meal logging to use note-only captures in parity with the CLI/core write path.
4. Carry saved-food nutrition into recurring food auto-log meal creation.
5. Add a narrow nutrition totals read surface for tracking calories/macros over time.
6. Add focused tests across contracts, core, usecases/query, CLI, and assistant surfaces.

## Non-goals

- No mandatory nutrition capture at meal-log time.
- No micronutrient ontology or expansive food-database integration.
- No broad product-behavior rewrite beyond the new storage/read seams required for nutrition tracking.

## Intended data shape

- `food` records gain optional per-serving nutrition fields with lightweight provenance/confidence metadata.
- `meal` events gain optional nutrition total fields with the same lightweight provenance/confidence metadata.
- Existing freeform meal notes, ingredients, and saved-food workflow stay intact.

## Workstreams

### 1. Contracts and core storage

- Add the shared nutrition schema/types under contracts.
- Extend food frontmatter/upsert payloads and meal event records.
- Update core food serialization and meal mutation paths.

### 2. Query, usecases, and CLI

- Propagate food nutrition fields through read/write adapters.
- Add a narrow nutrition totals query/usecase and CLI command surface.
- Keep the existing food/meal show/list paths aligned with the new attributes.

### 3. Assistant/runtime integration

- Update assistant-bound meal logging to support note-only meals.
- Ensure recurring food auto-log copies nutrition into created meals.
- Keep prompt/tool behavior aligned with the new canonical storage seam.

## Verification target

- `pnpm typecheck`
- Truthful coverage-bearing verification for touched packages, likely via `pnpm test:diff <path ...>` if it fully covers the touched owners; otherwise the required package/app coverage commands from the verification matrix.
- Direct scenario proof for at least one end-to-end nutrition logging + totals read path.

## State

- Contracts/core/query/usecases/CLI/assistant seams are integrated on the nested nutrition shape:
  - foods store `nutrition.perServing` + `nutrition.provenance`
  - meals store `nutrition.totals` + `nutrition.provenance`
- Assistant meal logging now accepts note-only inputs.
- Recurring food auto-log copies saved-food per-serving nutrition into meal totals with `source: "inherited"`.
- Meal totals query/read surfaces are wired through query, usecases, and CLI.

## Verification completed

- `pnpm typecheck`
- `pnpm test:smoke`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/core test:coverage`
- `pnpm --dir packages/query test:coverage`
- `pnpm --dir packages/vault-usecases test:coverage`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/cli test:coverage`
- Direct scenario: source CLI in a temp vault logged a note-only meal, applied nutrition totals via `meal edit`, and `meal totals --from 2026-04-08 --to 2026-04-08` returned calories `380` and protein `24`.

## Notes

- `bash scripts/workspace-verify.sh test:diff ...nutrition paths...` was not used as the final coverage-bearing lane because package-local `typecheck` substeps inside that diff-aware path are currently noisier than the repo-root `pnpm typecheck` path for this cross-package contracts/query slice.
- The assistant `vault.meal.add` executor now enforces the non-empty input invariant directly so both harnessed execution and direct bound-tool tests reject completely empty payloads.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
