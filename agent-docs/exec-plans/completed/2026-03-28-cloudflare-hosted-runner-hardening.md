# 2026-03-28 Cloudflare Hosted Runner Hardening

## Goal

- Prevent untrusted hosted agent code from mutating the shipped app source tree inside warm Cloudflare containers.
- Prevent prompt-injected code inside the runner container from abusing internal worker callback/proxy hosts without an in-memory per-run capability.

## Scope

- `Dockerfile.cloudflare-hosted-runner`
- `ARCHITECTURE.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/src/{node-runner.ts,runner-container.ts,runner-env.ts,runner-outbound.ts}`
- `apps/cloudflare/test/{index.test.ts,runner-container.test.ts,runner-env.test.ts,runner-outbound.test.ts}`
- `apps/cloudflare/test/workers/{runner-container-double.ts,runtime.test.ts}`
- `packages/assistant-runtime/src/{hosted-runtime.ts,hosted-runtime/environment.ts,hosted-runtime/internal-http.ts,hosted-runtime/models.ts}`
- `packages/assistant-runtime/test/hosted-runtime-http.test.ts`
- `packages/hosted-execution/src/contracts.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve current hosted execution behavior and callback shapes apart from the new proxy-auth requirement.
- Keep worker-owned web control tokens out of the runner environment.
- Avoid broad hosted-runtime refactors; keep the patch narrow at the trust-boundary seams.
- Preserve adjacent hosted-runtime and hosted-web edits already in flight.

## Plan

1. Make the Cloudflare runner image execute as a dedicated non-root user while keeping the baked `/app` source tree root-owned and effectively read-only to the job process.
2. Stop forwarding internal worker proxy base URLs into the runner environment; set the runner-facing worker proxy URLs in trusted Node-runner code instead.
3. Generate a per-run internal worker proxy token in the Worker/container bridge, thread it in-memory to the hosted runtime request, require it on all worker outbound proxy hosts, and keep it out of environment variables.
4. Keep isolated hosted child processes off the repo root by launching them from an ephemeral temp directory instead of `/app`, while resolving the `tsx` preload by absolute file URL.
5. Add focused Cloudflare and assistant-runtime regressions for env leak removal plus proxy-token enforcement/injection.

## Verification

- Focused checks:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-container.test.ts`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/index.test.ts`
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-http.test.ts`
- Required repo commands after focused checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Outcome

- Implemented the non-root runner image, per-run internal worker proxy token enforcement, runner env leak removal for internal worker proxy URLs, and temp-cwd isolated child launch with absolute `tsx` preload resolution.
- Focused hardening checks passed:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-container.test.ts`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/index.test.ts`
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-http.test.ts`
- Known unrelated failures remain outside this lane:
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/workers/runtime.test.ts` still fails in hosted user-env allowlist assertions.
  - `pnpm typecheck` still fails in `packages/contracts/scripts/verify.ts`.
  - `pnpm test` still fails in `packages/importers` module resolution and then `packages/core/dist` cleanup.
  - `pnpm test:coverage` still fails in `apps/cloudflare/test/outbox-delivery-journal.test.ts`.
- Required audit passes were launched for `simplify`, `test-coverage-audit`, and `task-finish-review`.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
