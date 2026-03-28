# Core Domain Registry Refactor

## Goal

Implement the requested refactor sequence by first standardizing provider and recipe markdown-registry ownership in `packages/core`, then collapsing the split experiment/journal/event/vault-summary write surface into domain modules behind the existing public mutation API.

## Scope

- `packages/core/src/index.ts`
- `packages/core/src/public-mutations.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/canonical-mutations.ts`
- new `packages/core/src/bank/providers.ts`
- new `packages/core/src/domains/{shared,experiments,journal,events,vault-summary}.ts`
- targeted `packages/core/test/{core,canonical-mutations-boundary}.test.ts`
- `packages/cli/src/usecases/{recipe,provider-event}.ts`
- targeted `packages/cli/test/**` coverage for provider/recipe/core-boundary behavior as needed

## Non-Goals

- Do not move `importDocument`, `importSamples`, `importDeviceBatch`, or other importer/idempotency-heavy flows in this task.
- Do not reshape inbox promotions beyond any tiny helper import rewiring needed to keep existing behavior.
- Do not decide a new long-term query-model home for providers or recipes beyond moving CLI read ownership to core APIs.

## Invariants

- Keep the public `@murph/core` mutation API stable.
- Preserve existing canonical write lock behavior, audit behavior, error codes/messages, and markdown/frontmatter output for the migrated flows.
- Preserve the current split semantics where legacy `createExperiment` still differs from canonical update/stop validation.
- Keep provider and recipe path layout, slug/id conflict behavior, and read/list ordering unchanged unless an existing test proves otherwise.

## Plan

1. Add focused characterization coverage for provider/recipe reads and for the experiment/journal/event/vault-summary mutation boundary where current tests are missing.
2. Extract providers into a first-class markdown-registry module in `packages/core` and export `upsertProvider`, `readProvider`, and `listProviders`.
3. Rewire CLI recipe/provider show/list flows to core read APIs and delete the bespoke file-walking/frontmatter parsing paths.
4. Add a small internal write-kernel/shared helper layer for `loadVault` plus `runCanonicalWrite` and shared frontmatter/document helpers.
5. Move experiments, journal, events, and vault summary writes into domain modules one vertical at a time while preserving the existing public exports.
6. Remove the migrated implementations from the old mega-files instead of leaving permanent forwarding ownership there.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes: `simplify` -> `test-coverage-audit` -> `task-finish-review`
