# Add honest built-package boundary proof for `@murphai/runtime-state`

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add a mechanized post-build smoke proof that plain package resolution can import both `@murphai/runtime-state` and `@murphai/runtime-state/node`.
- Make the package-local `typecheck` command include `test/**/*.ts` so future verification claims about runtime-state tests are accurate.

## Success criteria

- The prepared runtime build smoke path fails if either `@murphai/runtime-state` or `@murphai/runtime-state/node` cannot be imported through the package exports map after build.
- `pnpm --dir packages/runtime-state typecheck` checks both `src/**/*.ts` and `test/**/*.ts`.
- Existing runtime-state package tests still pass on the live tree without weakening the boundary assertions.

## Scope

- In scope:
- `packages/runtime-state/{package.json,tsconfig*.json,test/**}`
- `scripts/build-test-runtime-prepared.mjs`
- this active plan and the coordination ledger row for the lane
- Out of scope:
- broader changes to shared workspace-source aliasing
- unrelated runtime-state runtime behavior
- unrelated package-coverage cleanup beyond preserving the existing in-flight `test:coverage` script edit

## Current state

- `packages/runtime-state/package.json` already has an uncommitted `test:coverage` script addition from another active lane.
- The current boundary test imports `@murphai/runtime-state` and `@murphai/runtime-state/node` inside Vitest, but the package Vitest config aliases that package name back to source, so the passing test does not prove the built-package exports path.
- The package `typecheck` command currently runs `tsc -p tsconfig.json --noEmit`, and `tsconfig.json` only includes `src/**/*.ts`, so package-local typecheck does not validate test files.
- The widened package-local `typecheck` now passes after fixing three previously hidden test typing issues: two literal-widening sites in `test/assistant-usage.test.ts` and one `never[]` narrowing site in `test/hosted-bundle.test.ts`.
- The post-review audit found one additional config gap: the first `tsconfig.typecheck.json` version had cleared `paths`, which made the boundary test depend on `dist/`. The config now maps `@murphai/runtime-state` and `@murphai/runtime-state/node` back to the package source entrypoints so test typecheck stays source-based on a clean tree.
- The direct built-package smoke scenario now passes from `packages/runtime-state`, but the repo-wide prepared-build/typecheck lanes are currently blocked by unrelated active `packages/assistant-engine` and adjacent CLI state on the shared tree.

## Risks and mitigations

1. Risk: this lane collides with the broader package-coverage cleanup already editing `packages/runtime-state/package.json`.
   Mitigation: preserve the existing `test:coverage` edit and keep package manifest changes additive and narrow.
2. Risk: a generic shared verification change widens scope unnecessarily.
   Mitigation: keep the shared change limited to one explicit runtime-state self-reference smoke check in the prepared-build script.
3. Risk: test typecheck changes accidentally affect build output.
   Mitigation: keep build config on `tsconfig.json` and move test coverage for typecheck into a separate no-emit config.

## Tasks

1. Add a runtime-state-specific no-emit typecheck config that includes tests and wire the package `typecheck` script to it.
2. Add a prepared-build smoke import that uses plain package resolution for `@murphai/runtime-state` and `@murphai/runtime-state/node`.
3. Run focused package verification and the required repo verification for this scope.
4. Run the required final audit review and land a scoped commit.

## Decisions

- Keep the existing Vitest boundary test as source-surface coverage and add a separate post-build smoke proof instead of trying to force Vitest to double as the packaging check.
- Do not broaden `config/workspace-source-resolution.ts` behavior unless a direct runtime-state smoke path proves insufficient.

## Verification

- Focused commands:
  - `pnpm --dir packages/runtime-state typecheck`
  - `pnpm --dir packages/runtime-state test`
  - `pnpm build:test-runtime:prepared`
- Required repo commands:
  - `pnpm typecheck`
  - `pnpm test:packages`
  - `pnpm test:smoke`
- Results:
  - PASS `pnpm --dir packages/runtime-state typecheck`
  - PASS `pnpm --dir packages/runtime-state test`
  - PASS direct scenario from `packages/runtime-state`: `pnpm build && node --input-type=module -e "await import('@murphai/runtime-state'); await import('@murphai/runtime-state/node');"`
  - PASS clean-tree package proof: from `packages/runtime-state`, `node ../../scripts/rm-paths.mjs dist && pnpm typecheck`
  - PASS `pnpm test:smoke`
  - FAIL unrelated shared-tree blocker: `pnpm build:test-runtime:prepared`
  - FAIL unrelated shared-tree blocker: `pnpm typecheck`
  - FAIL unrelated shared-tree blocker: `pnpm test:packages`
Completed: 2026-04-08
