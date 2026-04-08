# Stand up initial Vitest suites for six untested packages

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Stand up initial package-local Vitest suites for `@murphai/assistant-cli`, `@murphai/cloudflare-hosted-control`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/operator-config`, and `@murphai/setup-cli`.
- Reuse the repo's existing Vitest patterns and shared harness helpers so the new tests fit the current verification model without inventing duplicate scaffolding.
- Wire the new package tests into the repo-level verification surface where needed, while intentionally ignoring coverage work for this task.

## Success criteria

- Each target package has a meaningful first wave of tests instead of `passWithNoTests` only.
- Packages that currently lack package-local Vitest config gain the minimal config needed to run stable tests in repo style.
- Shared harness setup is reused or centralized instead of duplicated across packages.
- Root/shared verification wiring is updated only as needed so the new tests participate in normal repo verification.
- Required repo verification and the required completion audit pass run before handoff.

## Scope

- In scope:
- package-local Vitest config, test files, and package `test` script adjustments for the six target packages
- minimal shared helper or root Vitest wiring needed to include those packages cleanly
- using parallel Codex Workers for package lanes, with each package worker required to spawn subagents for disjoint internal work
- Out of scope:
- broad coverage-threshold expansion or coverage-source mapping changes
- unrelated runtime refactors outside what the tests or harness setup strictly require
- app-level test changes outside the six target packages unless a root repo harness seam forces a narrow edit

## Constraints

- Preserve unrelated worktree edits.
- Keep package ownership clear in the shared worktree to reduce merge conflicts.
- Prefer existing repo Vitest conventions, workspace alias helpers, and test harness seams over new abstractions.
- Parent lane owns root/shared harness integration unless a worker prompt explicitly grants a narrow shared file.
- The user explicitly wants internal parallelization, so each package worker must spawn subagents for independent parts of that package.

## Risks and mitigations

1. Risk: Six workers collide on the same root Vitest or verification files.
   Mitigation: Keep shared/root harness ownership in the parent lane and constrain package workers to their package scope unless explicitly delegated otherwise.
2. Risk: Workers duplicate test helpers or alias setup inconsistently.
   Mitigation: Require each worker to inspect analogous tested packages first and reuse shared helpers or centralize any new helper only when it clearly serves multiple packages.
3. Risk: Initial tests overreach into brittle runtime behavior and slow progress.
   Mitigation: Bias first-wave tests toward stable contracts, parsers, route builders, env normalization, helper functions, and isolated service seams.

## Tasks

1. Prepare the coordination artifacts and worker prompts for six package lanes.
2. Launch one Codex Worker per package in the shared worktree.
3. Require each worker to plan thoroughly, then spawn package-internal subagents for parallel implementation.
4. Integrate shared/root Vitest harness changes centrally after package-local work lands.
5. Run required verification, complete the required review pass, and commit the scoped diff.

## Decisions

- Shared/root harness edits stay centralized in the parent lane unless a package prompt explicitly assigns a narrow shared file.
- Package workers should favor package-local tests first and only request shared harness changes when duplication would otherwise be unavoidable.
- Coverage remains out of scope for this task; the target is standing up durable initial tests.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- any focused package-local `pnpm --dir packages/<name> test` reruns needed during integration
- `pnpm --dir packages/assistant-cli test`
- `pnpm --dir packages/assistant-cli typecheck`
- `pnpm --dir packages/cloudflare-hosted-control test`
- `pnpm --dir packages/cloudflare-hosted-control typecheck`
- `pnpm --dir packages/gateway-core test`
- `pnpm --dir packages/gateway-core typecheck`
- `pnpm --dir packages/gateway-local test`
- `pnpm --dir packages/gateway-local typecheck`
- `pnpm --dir packages/operator-config test`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/setup-cli test`
- `pnpm --dir packages/setup-cli typecheck`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/assistant-cli/test/**/*.test.ts packages/cloudflare-hosted-control/test/**/*.test.ts packages/gateway-core/test/**/*.test.ts packages/gateway-local/test/**/*.test.ts packages/operator-config/test/**/*.test.ts packages/setup-cli/test/**/*.test.ts`
- Outcomes:
- PASS: package-local test and typecheck runs for all six target packages.
- PASS: focused root Vitest integration run for the six target package test surfaces (`19` files, `76` tests).
- FAIL, unrelated: `pnpm typecheck` currently fails in `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts` because that test imports `@murphai/device-syncd` through the daemon root instead of an explicit public subpath.
- FAIL, unrelated: `pnpm test:packages` currently fails in `packages/cli/test/assistant-core-facades.test.ts` on an existing `vault-usecases` export assertion outside this lane.
Completed: 2026-04-08
