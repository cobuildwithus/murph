# Hosted Execution Cleanup Finalization

Status: in_progress
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Finish the remaining hosted execution cleanup across `packages/hosted-execution`, `apps/web`, `apps/cloudflare`, `packages/assistant-runtime`, and `packages/assistant-services` so the shared contract boundary is exhaustive, bundle refs are truly immutable, outbox state is event-specific, share acceptance is honestly async/by-reference, and the Cloudflare runner/test seams match the current architecture.

## Scope

- Hosted execution contract/builder/parser/outbox parity, including `email.message.received`
- Immutable bundle-ref storage and DO state transitions in `apps/cloudflare`
- Event-level hosted execution outbox outcomes in `apps/web`
- Hosted share acceptance by reference and async completion flow
- Durable Object RPC cleanup and Cloudflare request error mapping
- Removal of request-path outbox draining in favor of the async drain endpoint
- Real `assistant-services` boundary cleanup for hosted runtime callers
- Cloudflare Workers-runtime coverage for the updated control-plane seams
- Matching architecture/runtime/testing doc updates when the documented behavior changes

## Constraints

- Preserve the current Container-based Cloudflare direction and internal worker handler path.
- Do not revert unrelated dirty work in the live tree.
- Keep hosted control-plane writes transactional on the `apps/web` side and event-driven on the `apps/cloudflare` side.
- Maintain package-boundary rules: cross-workspace imports must stay on public entrypoints.
- Run required audit passes (`simplify`, `test-coverage-audit`, `task-finish-review`) after implementation.

## Risks

1. Bundle-ref persistence changes could strand existing runner state or mismatch R2/object-store lookups.
   Mitigation: update the store API and the journal/runner callers together, keep refs/version counters in DO state, and add direct tests for read/write/finalize paths.
2. Event-level outbox outcomes could diverge between `apps/web` and Cloudflare dispatch responses.
   Mitigation: push the result contract into shared hosted-execution types and add exhaustive parity tests across builder/parser/outbox-kind consumers.
3. Share-accept flow changes can break current UX if the request path still assumes immediate import.
   Mitigation: switch acceptance to pending semantics consistently, move completion/finalization into hosted execution completion handling, and cover the route/service/runtime path end to end.

## Verification

- Focused package/app tests while iterating, especially `packages/hosted-execution`, `apps/web`, and `apps/cloudflare`
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents after functional verification

## Progress

- Done:
  - read repo routing, architecture, verification, and completion-workflow guidance
  - inspected coordination-ledger overlap and current dirty worktree state
  - implemented the applicable Cloudflare predeploy fixes from the nine-item review:
    - `UserRunnerDurableObject` now extends `DurableObject`
    - stale `next_wake_at` reuse was removed from `RunnerQueueStore.syncNextWake()`
    - runner container idle retention is configurable via `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER` and defaults to `5m`
    - default `max_instances` was lowered to `50`
    - deploy/runtime env handling now normalizes legacy AgentMail and ffmpeg aliases onto canonical names
    - callback-hostname persistence was documented as a transitional seam
  - confirmed the already-requested repo artifacts already exist in-tree: root `Dockerfile.cloudflare-hosted-runner`, root `.dockerignore`, and `pnpm-lock.yaml`
  - added focused Cloudflare regression coverage for runner env aliasing, stale wake suppression, container idle retention, and legacy hosted user env compatibility
  - captured a direct scenario check by rendering deploy config with legacy env aliases and a custom sleep-after override
- Now:
  - prepare final handoff and commit for the Cloudflare predeploy fixes
- Next:
  - if the broader hosted-execution lane continues, return to the remaining async-share and outbox cleanup outside this focused predeploy patch

## Verification status

- Passed:
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-env.test.ts`
  - direct scenario: `CF_BUNDLES_BUCKET=test-bundles CF_BUNDLES_PREVIEW_BUCKET=test-bundles-preview CF_WORKER_NAME=test-worker AGENTMAIL_API_BASE_URL=https://legacy-mail.example.test/v0 PARSER_FFMPEG_PATH=/usr/local/bin/ffmpeg CF_CONTAINER_SLEEP_AFTER=9m pnpm --dir apps/cloudflare deploy:config:render <tmpfile>`
- Failed for credibly unrelated pre-existing reasons in already-dirty areas:
  - `pnpm typecheck`
    - `apps/web/src/lib/hosted-onboarding/webhook-receipts.ts`: missing `schemaVersion` on `HostedWebhookDispatchSideEffectPayload`
  - `pnpm test`
    - same `apps/web` typecheck failure through the hosted web package test wrapper
  - `pnpm test:coverage`
    - `packages/contracts/dist/index.js` imports missing `dist/constants.js`
- Audit-pass note:
  - repo policy requests spawned `simplify`, `test-coverage-audit`, and `task-finish-review` subagents, but the current higher-priority tool policy forbids spawning agents unless the user explicitly asks for delegation. This remains an explicit gap in this turn rather than silently skipped work.
