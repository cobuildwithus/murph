# Expand initial Vitest suites for six recently bootstrapped packages

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add a second wave of meaningful tests for `@murphai/assistant-cli`, `@murphai/cloudflare-hosted-control`, `@murphai/gateway-core`, `@murphai/gateway-local`, `@murphai/operator-config`, and `@murphai/setup-cli`.
- Keep using repo-standard Vitest patterns and existing workspace alias helpers.
- Prefer deeper package-local seams over broad root-harness work.

## Success criteria

- Each of the six target packages gains additional high-value tests beyond the first bootstrap wave.
- New tests cover previously thin or untested stable seams rather than duplicating existing assertions.
- Shared/root wiring changes are kept minimal and centralized.
- Required verification, review, and scoped commit run before handoff.

## Scope

- In scope:
- adding more package-local Vitest tests in the six target packages
- package-local config or helper adjustments required to support those tests
- narrow root/shared harness adjustments only if a package expansion proves they are needed
- parallel subagent work split by package ownership
- Out of scope:
- coverage gate rollout
- unrelated runtime refactors
- expanding tests for packages outside the same six-package set

## Constraints

- Preserve unrelated worktree edits.
- Keep ownership disjoint by package to avoid conflicts.
- Bias toward deterministic seams: request shaping, route helpers, package boundaries, env normalization, error mapping, and isolated service helpers.
- Parent lane owns any shared/root integration.

## Risks and mitigations

1. Risk: workers duplicate tests already added in the bootstrap lane.
   Mitigation: inspect current test files first and target only uncovered seams.
2. Risk: workers reach into mixed root files or unrelated packages.
   Mitigation: keep worker ownership package-scoped and reserve root integration to the parent lane.
3. Risk: new tests become flaky by depending on broad runtime setup.
   Mitigation: prefer pure helpers, request/response shaping, and mocked service seams.

## Tasks

1. Register the follow-up package-test expansion lane.
2. Inspect existing tests and identify the highest-value missing seams for each package.
3. Spawn one worker per package to add additional tests in parallel.
4. Integrate any required shared/root changes centrally.
5. Run verification, review, and commit the scoped diff.

## Decisions

- This lane is additive to the initial bootstrap work, not a harness redesign.
- Package workers stay package-scoped unless the parent lane explicitly requests a shared change.
- Follow-up test selection should favor thin areas called out by the earlier audit when relevant.

## Verification

- Commands to run:
- focused package-local `pnpm --dir packages/<name> test`
- focused package-local `pnpm --dir packages/<name> typecheck`
- focused root Vitest rerun for the six package test surfaces
- full-repo failures may be noted if they remain unrelated to this lane
- Outcomes:
- PASS: worker lanes added second-wave package-scoped tests for all six target packages and committed those changes directly on the current branch.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run --config vitest.config.ts --no-coverage packages/assistant-cli/test/**/*.test.ts packages/cloudflare-hosted-control/test/**/*.test.ts packages/gateway-core/test/**/*.test.ts packages/gateway-local/test/**/*.test.ts packages/operator-config/test/**/*.test.ts packages/setup-cli/test/**/*.test.ts` (`24` files, `115` tests).
- PASS: package-local typechecks for all six target packages using `pnpm --config.verify-deps-before-run=false --dir packages/<name> typecheck`.
- FAIL, workspace-state-only: plain `pnpm` package commands are currently blocked before execution with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` because the workspace `dedupeInjectedDeps` setting no longer matches the installed dependency state.
Completed: 2026-04-08
