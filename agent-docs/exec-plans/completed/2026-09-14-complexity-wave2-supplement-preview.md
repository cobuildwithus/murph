# Reduce supplement-preview complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports hasLikelyMissingProductActive (94), repairPreviewForRow (87), isUsefulIngredientRow (79) at complexity 94. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/supplement-db-brand-site-labels.test.ts`: 207 tests passed.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`: passed.
- JavaScript syntax check of the repair-preview module: passed.
- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

Supplement repair preview repeated the same product-pattern and required-ingredient branching across dozens of categories. Represent those existing decisions as an ordered table, retaining specialized count and combined-evidence rules.

hasLikelyMissingProductActive 94 → 16; file maximum 94 → 87; excess-over-20 debt delta -74; total function complexity delta -58.

The changed responsibility now fits below the threshold; unchanged neighboring policies remain separately scoped. Remaining file hotspots: repairPreviewForRow (87), parserBlockersForRow (34), hasImplausibleParsedIngredientAmount (60), hasLikelyMissingProminentFactsRows (21), ingredientRowFromValue (21), ingredientRowsByTransposedTable (21), ingredientRowsByLeadingAmountTable (27), ingredientRowsByStackedTable (29), isUsefulIngredientRow (79).

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.
Completed: 2026-09-14
