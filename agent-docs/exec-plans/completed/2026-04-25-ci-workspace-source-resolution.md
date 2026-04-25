# Fix CI Workspace Source Resolution

## Goal

Restore the failing `Murph Host Support` workflow run by fixing workspace source resolution and directly coupled Health Commons runtime artifact assumptions in CI/package verification lanes.

Success means the failed package/app shards from run `24924775680` can resolve repo-local workspace packages from source or from explicitly prepared artifacts without relying on stale `dist/` output.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Keep the change limited to verification/source-resolution wiring, package test config, and directly coupled tests/scripts.
- Do not change runtime package ownership or add dependencies.
- Do not expose local user/home identifiers or secret material in files, docs, logs, or commit messages.

## Current Findings

- `Release package coverage` shards fail when package-local Vitest configs resolve transitive workspace imports through package `exports` pointing at missing `dist/` output.
- `apps/cloudflare verify` fails on `@murphai/health-commons/runtime` resolution and a runner bundle test that expects the Health Commons runtime artifact before that app-local lane builds workspace artifacts.
- Fix landed by adding tsconfig-path alias fallbacks to shared package and Cloudflare Vitest config, generating Health Commons before source coverage/app verification lanes, and building Health Commons before the scriptless package pack proof.

## Plan

1. Add missing source aliases or centralize package-local alias coverage for the affected Vitest lanes.
2. Fix the Health Commons runtime artifact expectation in the Cloudflare runner bundle proof so it matches the lane's actual preparation contract.
3. Re-run the failing focused shards locally, then the scoped verification lane and typecheck.
4. Run required completion workflow checks before closing this plan.

## Verification

- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/cloudflare-hosted-control test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/query test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/assistant-engine test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/assistant-runtime test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/assistant-cli test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/setup-cli test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/operator-config test:coverage`
- Passed: `env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir packages/assistantd test:coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts --no-coverage`
- Passed: `pnpm --dir apps/cloudflare verify`
- Passed: `pnpm build:test-runtime:prepared`
- Passed: `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50% pnpm exec vitest run --config packages/cli/vitest.workspace.ts --coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:packages:coverage`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
