# Codex Container Continuity E2E

## Goal

Add a minimal, manual-only hosted-local E2E scenario proving that a real Codex app-server session resumes across hosted Cloudflare runner container teardown and recreation.

Success criteria:
- The scenario uses the existing hosted-local full-stack harness.
- The scenario uses the real Codex app server, with the local Responses recorder as the model provider.
- The first run records Codex-native resume state.
- An idle-shutdown checkpoint destroys the hosted runner container.
- The second run completes with the same Codex provider session id and rollout path.
- The scenario is addressable by name but not part of the default `all` hosted-local suite.
- The runner restarts stale warm containers whose startup control token no longer matches the container process after lifecycle cleanup.

## Scope

Expected files:
- `apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- focused registry tests under `apps/cloudflare/test/**` and `scripts/**`

## Verification

Run targeted scenario/registry tests first, then the required repo verification lane unless blocked by unrelated pre-existing failures.

Current proof:
- `pnpm --dir apps/cloudflare test:node` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts` passed.
- `pnpm hosted-local e2e codex-container-continuity` passed.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
