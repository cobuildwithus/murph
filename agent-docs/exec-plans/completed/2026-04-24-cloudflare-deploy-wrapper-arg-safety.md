# Cloudflare Deploy Wrapper And Runner Lifecycle Safety

## Goal

Prove and fix Cloudflare hosted deployment hazards that can produce false deploy confidence or runner-output bundle validation failures.

## Scope

- `apps/cloudflare/scripts/deploy-worker-version-paths.ts`
- `apps/cloudflare/src/runner-container.ts`
- Focused Cloudflare deploy-wrapper tests
- Focused runner-container lifecycle tests
- `apps/cloudflare/test/container-entrypoint.test.ts` test-isolation cleanup required to keep the Cloudflare verifier green under full-suite fetch stubbing
- This plan and the coordination-ledger row

## Constraints

- Preserve unrelated dirty work in the shared tree.
- Do not weaken deploy artifact validation or production runtime invariants.
- Keep the change narrow enough to deploy after verification.
- Align runtime behavior with the existing documented contract that the runner shell is torn down after each invocation.

## Verification

- Focused deploy-wrapper Vitest coverage
- Focused runner-container Vitest coverage
- Cloudflare app typecheck
- Completion workflow audit passes required for an `apps/cloudflare` deploy-surface change

## State

Implementation complete pending final verification/commit/deploy. Deploy-wrapper unsupported-arg regression is green locally. Runner lifecycle now tears down successful invocations after subagent review identified warm-container version skew as the likely `Hosted bundle archive is invalid` production path. Final review finding about unsupported equals-form value leakage was fixed with a redaction regression.

## Evidence

- Focused deploy-wrapper tests failed before the parser fix, then passed after the fix.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-worker-version-paths.test.ts apps/cloudflare/test/deploy-worker-version-cli.test.ts apps/cloudflare/test/runner-container.test.ts --no-coverage` passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/container-entrypoint.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare verify` passed after container-entrypoint test isolation cleanup.
- `bash scripts/workspace-verify.sh test:diff ...` passed before the final audit follow-up; rerun pending with container-entrypoint included.
- `pnpm --dir apps/cloudflare deploy:worker:apply -- --dry-run` fails immediately before deploy orchestration with an unsupported-argument error.
- `pnpm typecheck` is blocked by an unrelated pre-existing `packages/assistant-engine/test/assistant-cli-tools-capabilities.test.ts` type error.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
