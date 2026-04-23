# Decouple vault-usecases loader ownership across core, query, and importers

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Stop `packages/vault-usecases` from requiring `@murphai/query` for core-only and importer-only operations.
- Make loader ownership explicit so combined runtime loading happens only where a usecase genuinely needs both core and query.

## Success criteria

- `loadCoreRuntime()` and `loadQueryRuntime()` each validate and cache only their own owner package.
- `loadIntegratedRuntime()` composes those owner loaders instead of being the sole eager loader seam.
- `loadImporterRuntime()` depends on core plus importers only, not query.
- Core-only integrated services (`init`, `validate`, `repairVault`, `addMeal`, `projectAssessment`, and health-core wiring) no longer resolve query.
- Importer services no longer resolve query before creating importers.
- Directly coupled runtime tests cover the split loader caching and the importer-no-query path.
- Required verification, required audit passes, and a scoped commit complete unless an unrelated blocker is documented precisely.

## Scope

- In scope:
  - `packages/vault-usecases/src/usecases/{runtime.ts,integrated-services.ts}`
  - directly coupled `packages/vault-usecases/test/{runtime.test.ts,integrated-services-meal.test.ts,wearables-query-services.test.ts}`
  - `agent-docs/exec-plans/active/{2026-04-23-vault-usecases-loader-seams.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - broader `vault-usecases` barrel/export cleanup
  - query-only service refactors beyond swapping to the explicit query loader
  - changes to `@murphai/core`, `@murphai/query`, or `@murphai/importers`

## Constraints

- Technical constraints:
  - Keep the diff narrow to loader ownership and directly coupled tests.
- Product/process constraints:
  - Preserve unrelated dirty-tree edits, especially the shared coordination ledger churn.
  - Do not widen into runtime contract redesign outside this reported seam.

## Risks and mitigations

1. Risk: introducing parallel loader caches could break the existing integrated-runtime retry/reset behavior.
   Mitigation: keep cache invalidation owner-local and cover recovery behavior in `runtime.test.ts`.
2. Risk: query-only integrated services could accidentally keep using the combined loader by habit.
   Mitigation: swap those call sites to the explicit query loader while leaving combined loading available only as a thin composition seam.
3. Risk: the shared runtime-unavailable message still references all three packages even when only one owner is needed.
   Mitigation: keep existing error guidance for now and limit this change to dependency resolution ownership rather than message taxonomy.

## Tasks

1. Register the narrowed task in the active plan and ledger.
2. Split the runtime loaders into explicit core, query, integrated, and importer ownership paths.
3. Update integrated services to call the narrowest loader required by each usecase.
4. Expand `runtime.test.ts` to cover owner-local caching/recovery and importer creation without query.
5. Run required verification, required audit passes, and land a scoped commit if the dirty shared ledger still permits it.

## Decisions

- Keep `loadIntegratedRuntime()` as a convenience seam, but make it compose `loadCoreRuntime()` plus `loadQueryRuntime()` instead of owning eager package resolution itself.
- Keep the fix localized to `packages/vault-usecases` rather than introducing a broader shared loader abstraction.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/vault-usecases/src/usecases/runtime.ts packages/vault-usecases/src/usecases/integrated-services.ts packages/vault-usecases/test/runtime.test.ts`
  - `pnpm --dir packages/vault-usecases test:coverage`
- Direct proof:
  - runtime tests that prove importer creation succeeds without ever loading `@murphai/query`
  - runtime tests that prove core and query caches recover independently after owner-shape failures
  - service tests that prove `addMeal` stays on the core loader and wearable read services stay on the query loader without touching other owners
