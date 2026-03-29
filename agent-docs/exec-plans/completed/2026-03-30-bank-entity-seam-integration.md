# Bank Entity Seam Integration

## Goal

Land the supplied bank-entity seam patch so contracts, core, query, and CLI share the same neutral bank registry ownership for food, recipe, provider, and workout-format records.

Success criteria:

- contracts expose the neutral bank-entity metadata and the canonical/query model can distinguish record class explicitly
- core reads and writes foods, recipes, providers, and workout formats through the shared bank registry path without breaking existing selector or frontmatter compatibility
- query exports the expanded food/recipe/provider/workout-format read surface and regression coverage proves the new seam
- CLI workout-format save/read paths emit first-class bank workout-format docs while preserving compatibility with older saved files

## Scope

- `packages/contracts/src/**` for the bank-entity seam and related schema/examples updates
- `packages/core/src/{bank/**,public-mutations.ts,shares.ts,vault.ts,constants.ts}`
- `packages/query/src/{canonical-entities.ts,health/**,index.ts}`
- `packages/cli/src/usecases/workout-format.ts`
- targeted tests and minimal docs only if the landed seam changes durable ownership expectations

## Constraints

- Apply the supplied patch shape without widening into unrelated active refactors
- Preserve overlapping in-progress edits and avoid reverting unrelated worktree changes
- Keep existing vault storage layout and legacy workout-format read compatibility intact
- Run the repo-required verification commands plus the mandatory completion-workflow audit passes

## Risks

- Overwriting adjacent active work in shared contracts/core/query files
- Breaking id-or-slug lookup or selector compatibility while moving more families onto the shared bank seam
- Regressing older CLI-saved workout-format documents during the first-class bank-doc migration

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused package tests or direct scenario checks if the repo-wide wrappers surface a narrower issue first

Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
