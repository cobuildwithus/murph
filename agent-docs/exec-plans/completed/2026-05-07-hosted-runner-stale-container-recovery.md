# Hosted Runner Stale Container Recovery

## Goal

Make hosted-local runner startup recover cleanly when Cloudflare local container state survives a worker restart but the Durable Object's in-memory runner control token is gone.

## Scope

- `scripts/dev-hosted-local/runtime.ts`
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/environment.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts`
- `apps/cloudflare/scripts/deploy-artifacts.ts`
- `scripts/dev-hosted-local/environment.test.ts`
- `scripts/dev-hosted-local/runtime.cleanup.test.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`

## Constraints

- Preserve the production control-token invariant: a runner shell without a known control token must not be reused for user work.
- Keep the change small and lifecycle-local.
- Do not weaken explicit cleanup failure reporting for normal failed/stale shells.

## Plan

1. Keep production runner lifecycle behavior unchanged.
2. Give isolated E2E profiles a generated Cloudflare worker name so their Docker runner containers do not share the interactive dev namespace.
3. Give deploy smoke its own RunnerContainer subclass and binding so smoke start/stop state cannot poison the live per-user runner container class.
4. Make hosted-local pre-start cleanup sweep stale runner and smoke proxy containers from previous build ids only inside the relevant worker namespace.
5. Keep E2E/test cleanup scoped to the current local runner build id to preserve parallel isolation.
6. Add focused regression coverage for cleanup scope, generated worker names, deploy-smoke binding selection, deploy config, and stack wiring.
7. Run focused hosted-local and Cloudflare verification plus typecheck.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/runtime.cleanup.test.ts scripts/dev-hosted-local/stack.test.ts` passed.
- `pnpm typecheck` passed after waiting for existing workspace locks.
- `bash scripts/workspace-verify.sh test:diff scripts/dev-hosted-local/runtime.ts scripts/dev-hosted-local/stack.ts scripts/dev-hosted-local/runtime.cleanup.test.ts scripts/dev-hosted-local/stack.test.ts` reached repo-tools tests and failed on unrelated existing expectations in `scripts/hosted-local.test.ts` and `scripts/workspace-source-resolution.test.ts`.
- `pnpm --dir packages/hosted-local-harness typecheck` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/runtime.cleanup.test.ts scripts/dev-hosted-local/stack.test.ts` passed.
- `pnpm typecheck` passed.

## Runtime Findings

- The failing `destroyIfRunning` path is Worker-side recovery, not just harness pre-start Docker cleanup: `RunnerContainer.ensureContainerReady()` destroys a non-stopped shell when local container state is `running` but the in-memory runner control token is absent.
- Docker events around the failing local run show the `workerd-murph-hosted-RunnerContainer-*` app and proxy containers had already been killed and destroyed before later user wakes logged `statusBeforeDestroy: "running"`.
- Current local DB evidence shows webhook/mailbox enqueue is working while runner import is stalled: conversation lane max sequence is 20, but the workspace redacted status still reports conversation imported sequence 8 for the affected local user suffix.
- The deploy smoke route uses a separate RunnerContainer Durable Object name (`__deploy-smoke` or version-specific), but the same Cloudflare worker/container class namespace. In local Wrangler, the smoke start/stop cycle can still leave stale container lifecycle state in the running local runtime even when Docker has no matching container left.
- The fix separates deploy-smoke container lifecycle into `DeploySmokeRunnerContainer` behind `RUNNER_CONTAINER_SMOKE`, while keeping the same underlying runner image and implementation.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
