# Junction Meal PR Review Fixes (Round 2)

## Goal

Address the second round of PR review findings for Junction meal imports before merge.

Success criteria:

- Junction meal fiber totals read the documented `macros.fibre` spelling.
- Meal nutrition revision dedupe applies to device meals only; manual meals stay append-only even when they carry an externalRef.
- Micros-only food items keep their ingredient names.
- The deterministic contract ID helper has a single owner instead of duplicated copies in core and importers.

## Scope

- `packages/core/src/ids.ts`
- `packages/core/src/index.ts`
- `packages/core/src/mutations.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/query/src/meal-nutrition.ts`
- `packages/query/test/meal-nutrition.test.ts`

## Constraints

- Junction documents meal fiber as `macros.fibre`; test fixtures must use the documented shape.
- Keep `@murphai/contracts` runtime-neutral; the hash-based ID helper stays in core, which importers already depend on.
- No behavior change to existing meal identity or revision-selection semantics beyond the manual-meal guard.

## Verification

- `pnpm --dir packages/importers test -- device-providers-junction.test.ts`
- `pnpm --dir packages/importers test:coverage`
- `pnpm --dir packages/query test -- meal-nutrition.test.ts`
- `pnpm --dir packages/query test:coverage`
- `pnpm --dir packages/core test`
- `pnpm typecheck`
- `git diff --check`

## State

Ready for commit. Implemented:

- Added the documented `fibre`/`macros.fibre` paths to the meal fiber gram paths and moved the canonical Cronometer fixture to the documented spelling.
- `mealRevisionKey` now requires `source: "device"` for both the externalRef and mealId branches, so manual meals never collapse into device revision groups; regression covered by giving the manual meal the imported meal's externalRef.
- `isJunctionMealNutritionItem` recognizes micros-only food items so their names survive as ingredients.
- Moved `deterministicContractId`/Crockford base32 encoding from `packages/core/src/mutations.ts` into `packages/core/src/ids.ts`, exported it from core, and deleted the duplicated copy in the Junction normalizer.

Known scoping decision: imported meal corrections still appear as distinct ledger records outside nutrition totals (export packs and generic entity listings). Collapsing them everywhere requires import-time revision identity (stable event record IDs per externalRef), which changes identity semantics for all device events and is deliberately deferred.

Verification passed:

- `pnpm --dir packages/importers test -- device-providers-junction.test.ts`
- `pnpm --dir packages/importers test:coverage`
- `pnpm --dir packages/query test -- meal-nutrition.test.ts`
- `pnpm --dir packages/query test:coverage`
- `pnpm --dir packages/core test`
- `pnpm typecheck`
- `git diff --check`
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
