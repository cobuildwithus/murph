# Hosted Codex E2E Shim Boundary

## Goal

Move the fake Codex app-server implementation out of assistant-runtime production setup and into the hosted-local harness. Production runtime setup should build only the real hosted Codex environment and may expose only neutral, test-gated command injection needed by local harnesses.

## Success Criteria

- `prepareHostedCodexRuntimeEnvironment` no longer imports or installs the E2E Codex app-server shim.
- Assistant-runtime forwarded env profiles no longer include `MURPH_E2E_CODEX_APP_SERVER_STUB_*` keys.
- Hosted-runtime contracts no longer export fake app-server stub constants.
- Hosted-local harness owns the fake Codex app-server installer/source and its tests.
- Hosted-local harness owns the local dev stack implementation; root scripts are
  compatibility entrypoints that import declared package exports.
- Hosted-local E2E stub behavior continues through a harness-installed fake executable and a neutral hosted Codex command override.
- Production setup fails closed if the neutral hosted Codex command override is configured outside test mode.

## Constraints

- Preserve unrelated dirty work and active hosted runtime lifecycle changes.
- Keep production-side primitives simple: no new service layer or fake transport awareness.
- Do not expose secrets, local account identifiers, or home-directory paths.

## Work Plan

1. Move the fake app-server shim source into `packages/hosted-local-harness`.
2. Replace production E2E-specific env forwarding with a neutral, test-gated command override.
3. Move hosted-local dev stack internals into the harness package and keep root scripts as thin package-export wrappers.
4. Move or rewrite shim/dev-stack tests under the harness package and add assistant-runtime regression coverage for rejected forwarding.
5. Run focused package tests, typecheck, and required completion audits before closing the plan.

## Verification

- Focused assistant-runtime hosted Codex config/env tests.
- Focused hosted-local harness shim tests.
- Focused Cloudflare hosted env policy/runner env tests touched by forwarded env behavior.
- `pnpm typecheck` unless blocked by unrelated dirty work.
- Passed: `pnpm install --frozen-lockfile --ignore-scripts`.
- Passed: `pnpm --dir packages/hosted-local-harness typecheck`.
- Passed: `pnpm --dir packages/hosted-local-harness test`.
- Passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-config.test.ts --no-coverage`.
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cli-access.test.ts test/assistant-codex-runtime.test.ts --no-coverage`.
- Passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-env.test.ts test/hosted-runner-env-policy.test.ts test/hosted-local-e2e-support.test.ts test/helpers/hosted-local-dev-harness.test.ts test/run-hosted-local-e2e-runner.test.ts --no-coverage`.
- Passed: `node scripts/verify-workspace-boundaries.mjs`.
- Passed: `pnpm exec tsx --tsconfig tsconfig.base.json scripts/hosted-local.ts --help`.
- Passed: `pnpm exec tsx --tsconfig tsconfig.base.json scripts/dev-hosted-local.ts --help`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm test`.
- Passed: `git diff --check`.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
