# 2026-03-30 Hosted Run Trace Landing

## Goal

- Land the supplied hosted run-trace patch so the Cloudflare hosted runner persists a bounded per-user run trace with a shared `runId` / `attempt` / `phase` / `lastErrorCode` contract across the worker, container, and hosted runtime surfaces.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
- `apps/cloudflare/src/{user-runner.ts,runner-container.ts,container-entrypoint.ts,user-runner/**}`
- `apps/cloudflare/test/**`
- `packages/hosted-execution/src/**`
- `packages/hosted-execution/test/**`
- `packages/assistant-runtime/src/{hosted-runtime.ts,hosted-runtime/**}`
- `packages/assistant-runtime/test/**`

## Findings

- The supplied core patch applied cleanly against the current tree.
- The supplied docs patch drifted in `ARCHITECTURE.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, so its intent is being translated manually onto the live docs state instead of force-applying the stale diff.
- The landed code keeps the requested narrow shape: one Durable Object-backed run trace, additive hosted status fields, shared run-context parsing, and one structured logging vocabulary across worker, container, and hosted runtime.
- The mandatory `simplify` audit returned no actionable simplification prompts.
- The mandatory `task-finish-review` audit found three issues in scope: raw error text leaked into structured logs, configuration retries did not advance the observability `attempt`, and the container/runtime handoff lacked an end-to-end `run` propagation proof. All three were addressed in this lane.
- Repo-level Cloudflare verification is currently blocked by unrelated active-tree failures in hosted email auth and outbox journal expectations; the run-trace surface itself verifies cleanly in focused tests.

## Constraints

- Preserve adjacent hosted-runtime and Cloudflare runner edits already in flight on overlapping files.
- Keep the change within the supplied simplification: one Durable Object-backed run trace, one shared contract, one structured logging vocabulary, no second persistence ledger.
- Keep docs truthful to the implemented runtime and verification surface; do not invent deployment guarantees or unsupported checks.

## Plan

1. Register the ledger row and dry-run the supplied patch series to locate clean applies versus drift.
2. Apply the patches or reconcile conflicts manually while preserving the intended shared run-trace contract.
3. Run focused verification on the touched hosted-execution, Cloudflare, and assistant-runtime surfaces, then attempt the required repo checks.
4. Run the mandatory `simplify` audit, integrate any behavior-preserving reductions, and re-run affected verification.
5. Run the mandatory `task-finish-review` audit, resolve findings, close the plan, and commit the touched files.

## Verification

- Passed:
  - `pnpm --filter @murph/hosted-execution typecheck`
  - `pnpm --filter @murph/assistant-runtime typecheck`
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-http.test.ts packages/assistant-runtime/test/hosted-runtime-isolated.test.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1`
- Audits:
  - `simplify` spawned audit: no actionable simplify prompts.
  - `task-finish-review` spawned audit: flagged log redaction, configuration-retry attempt semantics, and container/runtime boundary proof gaps; all three were fixed and the focused checks above were re-run afterward.
- Failed for unrelated active-tree reasons:
  - `pnpm --dir apps/cloudflare verify`
    - `apps/cloudflare/test/index.test.ts` fails because `seedHostedVerifiedEmailUserEnv` is undefined in the active hosted-email auth lane.
    - `apps/cloudflare/test/outbox-delivery-journal.test.ts` expects older side-effect record shapes and now disagrees on `delivery.idempotencyKey: null`.
  - `pnpm --dir apps/cloudflare test:workers`
    - `apps/cloudflare/test/workers/runtime.test.ts` expects a specific hosted user-env error body but currently receives the generic `"Invalid request."` response.
  - `pnpm typecheck`
    - currently stops in unrelated `packages/contracts` script/typecheck failures around `@murph/contracts` self-imports and existing implicit `any`s in `scripts/verify.ts`.
  - `pnpm test`
    - stopped in unrelated `apps/web` typecheck failures at `src/lib/hosted-execution/hydration.ts` and `src/lib/hosted-execution/usage.ts`.
  - `pnpm test:coverage`
    - stopped in unrelated workspace build/type failures under `packages/core` and `packages/device-syncd` due missing `@murph/runtime-state` exports and broader active type drift.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
