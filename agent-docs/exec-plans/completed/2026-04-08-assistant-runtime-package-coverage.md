# Assistant-runtime package coverage readiness

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/assistant-runtime` ready for package-wide root coverage patterns by adding package-local coverage configuration and enough focused tests to cover currently untested hosted-runtime seams.

## Success criteria

- `packages/assistant-runtime/vitest.config.ts` defines package-local coverage settings following the repo package pattern.
- Package-local tests cover the main currently untested helper and event seams without broadening into unrelated refactors.
- Shared hosted-runtime helpers live under `packages/assistant-runtime/test/**` instead of being duplicated across test files.
- Package-local verification passes, and any remaining root `vitest.config.ts` integration need is called out explicitly rather than edited here.

## Scope

- In scope:
  - `packages/assistant-runtime/**`
  - package-local shared test helpers
  - focused behavior and boundary tests for hosted runtime helpers
- Out of scope:
  - root `vitest.config.ts`
  - `config/**`
  - changes in other packages
  - broad hosted runtime refactors

## Initial seam map

1. Coverage config:
   - add a package-local `coverage` block with package-wide `src/**/*.ts` includes and standard per-file thresholds
2. Highest-value missing tests:
   - `src/hosted-runtime/events.ts`
   - `src/hosted-runtime/events/{email,linq,telegram}.ts`
   - `src/hosted-runtime/environment.ts`
   - `src/hosted-runtime/artifacts.ts`
   - `src/hosted-device-sync-runtime.ts`
   - remaining negative branches in `src/hosted-email.ts` and `src/hosted-email-route.ts`
3. Helper extraction:
   - extend `test/hosted-runtime-test-helpers.ts` for env, fetch, dispatch, and platform stubs

## Subagent split

1. Hosted runtime event handlers and summary paths
2. Platform/environment/artifact and usage helpers
3. Hosted email and device-sync runtime helpers

## Verification plan

- Focused package-local Vitest runs during iteration
- Final package-local:
  - `pnpm --dir packages/assistant-runtime test`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --coverage`
  - `pnpm --dir packages/assistant-runtime typecheck`

## Outcome

- Added package-local coverage config to `packages/assistant-runtime/vitest.config.ts` using package-wide `src/**/*.ts` includes, rollout-stage per-file thresholds, and exclusions only for barrel/type-only surfaces.
- Added shared package-local hosted-runtime test helpers plus new focused tests for environment, artifacts, timeouts, usage, inbox-pipeline, event routing, Telegram/Linq/email helper boundaries, device-sync runtime sync/reconcile paths, runtime runner orchestration, callbacks, execution, maintenance, package entrypoints, and utility/error helpers.
- Package-local direct Vitest coverage now passes for the package.
- Root `vitest.config.ts` still needs a separate follow-up outside this package lane to add `@murphai/assistant-runtime` to the root package-wide coverage surface.

## Verification outcome

- `../../node_modules/.bin/vitest run --config vitest.config.ts --no-coverage`
  - passed: 25 files, 99 tests
- `../../node_modules/.bin/vitest run --config vitest.config.ts --coverage`
  - passed with package-wide per-file thresholds and overall coverage at 84.72 statements / 67.4 branches / 96.15 functions / 84.6 lines
- `pnpm --dir packages/assistant-runtime typecheck`
  - passed earlier during package-local iteration before the worktree hit a PNPM install-state guard
- Later reruns of the package `pnpm` wrappers were blocked by `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, and direct `tsc -p packages/assistant-runtime/tsconfig.typecheck.json` hit unrelated pre-existing workspace alias/core type errors outside this package change
