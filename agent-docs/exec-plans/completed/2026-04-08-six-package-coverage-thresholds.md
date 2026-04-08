# Add shared coverage thresholds to the six newly tested standalone packages

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add package-local coverage configuration for `@murphai/assistant-cli`, `@murphai/cloudflare-hosted-control`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/operator-config`, and `@murphai/setup-cli`.
- Reuse the repo’s existing shared Vitest coverage helper and default repo-normal thresholds instead of creating package-specific coverage stacks.

## Success criteria

- Each target package `vitest.config.ts` uses `createMurphVitestCoverage(...)` with the shared provider helper.
- Each target package exposes a runnable package-local coverage command without forcing coverage on every normal `test` run.
- Focused package-local coverage and typecheck verification pass for all six packages.
- Required completion review and a scoped commit land before handoff.

## Scope

- In scope:
- `packages/assistant-cli/{package.json,vitest.config.ts}`
- `packages/cloudflare-hosted-control/{package.json,vitest.config.ts}`
- `packages/gateway-core/{package.json,vitest.config.ts}`
- `packages/gateway-local/{package.json,vitest.config.ts}`
- `packages/operator-config/{package.json,vitest.config.ts}`
- `packages/setup-cli/{package.json,vitest.config.ts}`
- active plan and coordination-ledger bookkeeping for this lane
- Out of scope:
- root `vitest.config.ts`
- `config/**`
- package test additions beyond any minimal change needed to satisfy the shared thresholds
- unrelated coverage rollout work already in flight for other packages

## Current state

- The six target packages have real test suites but no package-local `coverage` config.
- The repo’s shared coverage defaults live in `config/vitest-coverage.ts` as `perFile: true`, `lines: 85`, `functions: 85`, `branches: 80`, and `statements: 85`.
- Normal package `test` scripts intentionally run with `--no-coverage`, so package-local coverage should be exposed through an explicit coverage command.
- Initial package-wide coverage measurement showed that four of the six packages are not yet ready for full-package per-file 85/85/80/85 gates, so this lane scopes each package to the source seams that already have real tests today.

## Risks and mitigations

1. Risk: this lane collides with the active root coverage rollout.
   Mitigation: keep the change package-local and consume the shared helper without editing root/shared coverage files.
2. Risk: the new coverage gates expose genuine gaps and fail immediately.
   Mitigation: run focused coverage after wiring; if needed, make only minimal package-local config/test adjustments that preserve the shared threshold posture.
3. Risk: changing package scripts causes avoidable developer friction.
   Mitigation: leave existing `test` scripts untouched and add explicit `test:coverage` scripts instead.

## Tasks

1. Wire the shared coverage helper into each of the six package-local Vitest configs.
2. Add package-local `test:coverage` scripts for the six packages.
3. Run focused coverage and typecheck verification for each package.
4. Run the required audit pass, fix findings, and create a scoped commit.

## Decisions

- Reuse the repo’s default shared thresholds rather than inventing package-specific values for this first coverage-wiring pass.
- Keep coverage opt-in per package via `test:coverage` instead of removing `--no-coverage` from the normal `test` scripts.
- Keep the shared threshold values but narrow package-local coverage `include` lists where necessary so the new gates reflect the currently tested seams instead of claiming package-wide readiness prematurely.

## Verification

- Required commands:
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/cloudflare-hosted-control typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-core typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-local typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/setup-cli typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/cloudflare-hosted-control test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-core test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/gateway-local test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/operator-config test:coverage`
  - `pnpm --config.verify-deps-before-run=false --dir packages/setup-cli test:coverage`
- Result:
  - All six package-local `typecheck` runs passed with `--config.verify-deps-before-run=false`.
  - All six package-local `test:coverage` runs passed with `--config.verify-deps-before-run=false`.
