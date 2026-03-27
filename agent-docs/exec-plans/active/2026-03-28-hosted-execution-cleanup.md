# Hosted Execution Cleanup Finalization

Status: completed
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
  - completed the hosted-execution contract parity work so the shared package remains the authoritative seam, including `email.message.received` builder/parser/outbox parity and exhaustive parity coverage
  - finished the immutable bundle-ref storage flow in `apps/cloudflare` and aligned the runner/journal paths with ref-based reads and writes
  - replaced web-side outbox lifecycle inference with explicit event-level dispatch outcomes from the Cloudflare runner path
  - finished share-by-reference acceptance, moved share completion finalization into async completion handling, and removed the remaining request-path inline drain behavior
  - simplified the Cloudflare Durable Object RPC surface around instance-scoped methods and removed the stale compatibility wrappers
  - added Cloudflare 400 mapping for malformed request bodies and updated the Workers-runtime lane around the Cloudflare-specific seams
  - applied a post-implementation simplify pass that removed dead async-drain helper surface, deleted no-op webhook receipt hooks, made share preview fallback lazy, and collapsed a redundant runner bootstrap path
- Now:
  - none
- Next:
  - monitor unrelated workspace typecheck breakages separately from this hosted-execution lane

## Verification status

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-share-service.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/index.test.ts --no-coverage --maxWorkers 1`
- Failed for credibly unrelated pre-existing reasons in already-dirty areas:
  - `pnpm typecheck`
    - `packages/cli/src/assistant-cli-tools.ts(728,23)`: `Property 'error' does not exist on type '{}'`
    - `packages/cli/src/assistant-cli-tools.ts(729,19)`: `Property 'error' does not exist on type '{}'`
  - `pnpm test`
    - after the web build completes, `apps/cloudflare` verification stops on unrelated workspace type errors in `packages/cli/src/assistant-cli-tools.ts`, `packages/cli/src/assistant/canonical-write-guard.ts`, and `packages/core/src/operations/write-batch.ts`
  - `pnpm test:coverage`
    - fails for the same unrelated workspace typecheck blockers when the Cloudflare verify step runs
- Audit-pass note:
  - simplify audit completed and the resulting cleanup landed
  - the remaining audit passes should be treated as required completion-workflow follow-through when the subagent tooling path returns results normally
