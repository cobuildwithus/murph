## Goal

Trim the remaining hosted execution worktree to the smallest production-safe shape that still preserves the local full-stack texting repro harness.

## Why

- The remaining staged hosted-execution slice mixes real runtime fixes with debug-oriented instrumentation.
- The user wants production code kept clean while still retaining the local e2e harness needed for future debugging.

## Scope

- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/test/**`
- `scripts/dev-hosted-local/**`
- `apps/cloudflare/scripts/deploy-automation/**`

## Constraints

- Keep the real container-to-worker bridge and host-alias support required by local Docker-based e2e.
- Remove debug-only or localhost-only production branches when they are not required by the runtime fix.
- Preserve unrelated dirty slices, especially the active assistant-engine work.

## Verification

- Focused Cloudflare and assistant-runtime tests for the cleaned hosted-execution slice
- The local hosted Linq first-contact e2e through root `pnpm dev`
- `git diff --check`

## Outcome

- Kept the production runtime fixes needed for the container-to-worker bridge, host-alias proxying, and local full-stack texting repro.
- Removed leftover debug-only production branches:
  - local worker error-body debug exposure
  - child structured-log relay env plumbing
  - container debug callback route/caller
  - high-volume assistant-delivery hook trace strings and per-step journal chatter
- Preserved the local worker-only Linq e2e harness.

## Verification Results

- Passed:
  - `git diff --check`
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts packages/assistant-runtime/test/hosted-runtime-entry-execution.test.ts packages/assistant-runtime/test/hosted-runtime-execution.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-container.test.ts`
  - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/config.test.ts scripts/dev-hosted-local/main.test.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/runtime.test.ts`
  - `MURPH_E2E_STUB_ASSISTANT_PROVIDER=1 MURPH_DEV_SKIP_WEB=1 pnpm exec vitest run --disableConsoleIntercept --reporter=verbose --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- Known unrelated / residual:
  - `pnpm typecheck` still fails in `apps/web/.next/types/validator.ts` because generated stubs are missing for `app/design-system/page.js`, `app/api/internal/hosted-execution/share-import/complete/route.js`, and `app/api/internal/hosted-execution/share-import/release/route.js`.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 apps/cloudflare/test/container-entrypoint.test.ts` hangs without returning a test result; this needs separate follow-up.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
