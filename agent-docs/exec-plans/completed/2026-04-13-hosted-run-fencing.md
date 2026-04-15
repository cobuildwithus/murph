## Goal

Eliminate stale duplicate durable commit attempts in the hosted Cloudflare runner by fencing each claimed run with a durable run identity and rejecting late commit callbacks from obsolete attempts.

## Why

- Production showed duplicate `/commit` attempts for the same event after a durable commit already existed.
- The current runner only decides `resume` from a pre-invocation journal read.
- The commit callback does not carry run identity, and the active run identity is only volatile in memory.

## Scope

- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/runner-outbound/results.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- Focused tests in `apps/cloudflare/test/**` and `packages/assistant-runtime/test/**` as needed

## Constraints

- No hacky retries or silent fallbacks.
- Preserve the existing durable commit/finalize model.
- Keep logs sanitized.
- Avoid broad refactors outside the hosted runner/commit boundary.

## Verification

- `pnpm test:diff ...` for the touched Cloudflare/runtime files if truthful
- Focused package/app tests for any touched owner not fully covered by `test:diff`
- Required completion-workflow audit passes before handoff

## Current State

- Durable run-fencing is implemented in the Cloudflare runner queue and `/commit` callback path.
- Recovery now clears same-event persisted leases when a durable commit already exists, so a crash after commit cannot leave the DO stuck `in_flight`.
- Worker-side `/commit` handling is rollout-compatible with older containers: `run` metadata is still preferred and required for new runtime paths, but legacy callbacks without `run` are accepted only while the same event still owns the active lease.
- Focused verification is green:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/execution-journal.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare test:workers`
  - `pnpm exec vitest run test/hosted-runtime-callbacks.test.ts test/hosted-runtime-runner.test.ts test/hosted-runtime-parsers.test.ts --no-coverage` from `packages/assistant-runtime`
- `pnpm test:diff ...` fully passed through `packages/assistant-runtime` and into `apps/cloudflare verify`, but the all-files `apps/cloudflare` Node Vitest workspace run appeared to hang after startup with no additional failure output. Focused owner verification above was used as the truthful fallback lane for the touched Cloudflare paths.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
