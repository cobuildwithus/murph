# Hosted execution outbox in `apps/web`

## Goal

Replace the three ad hoc `apps/web` -> `apps/cloudflare` delivery paths with one durable Postgres outbox so hosted onboarding, hosted share acceptance, and hosted device-sync wakes all enqueue execution requests in the same transaction as their originating control-plane state changes.

## Scope

- Add a Prisma-backed hosted execution outbox model plus migration.
- Add shared enqueue, claim, delivery, retry, and status-read helpers under `apps/web/src/lib/hosted-execution/`.
- Migrate hosted onboarding webhook dispatch effects, hosted share acceptance, and hosted device-sync wake paths to enqueue instead of dispatching inline.
- Make hosted share read eventual execution state from the outbox plus hosted runner status rather than treating `POST /internal/dispatch` as both send and status probe.
- Update architecture/runtime/testing docs so the hosted execution contract stays truthful.

## Constraints

- Preserve existing hosted execution event ids and payload shapes so Cloudflare-side dedupe semantics stay stable.
- Keep webhook receipt idempotency semantics intact; do not regress existing Linq reply journaling while swapping hosted execution delivery over to the outbox.
- Do not invent a second canonical state model in `apps/web`; the outbox only tracks delivery to Cloudflare plus enough metadata to read eventual execution state safely.
- Preserve adjacent in-flight hosted Privy/public-landing edits in the dirty worktree.

## Risks and mitigations

1. Risk: enqueueing outside the owning write transaction would keep the current race, just with more code.
   Mitigation: add explicit enqueue helpers that accept a Prisma transaction client and call them from the same transaction that mutates hosted share/device-sync/onboarding receipt state.
2. Risk: hosted share could get stuck between "accepted" and "consumed" if the UI only writes the outbox and never reconciles completion.
   Mitigation: add a read path that combines outbox delivery state with hosted runner status and opportunistically finalizes the share row when the queued event has completed.
3. Risk: retries could hot-loop or duplicate sends.
   Mitigation: store attempt counters, next-attempt timestamps, delivery claims, and last error state in Postgres, and preserve Cloudflare event-id dedupe.

## Verification

- Direct hosted-app tests for the new outbox helpers plus the migrated onboarding/share/device-sync behaviors.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Required completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`

## Outcome

- Added a durable Postgres `execution_outbox` model plus migration under `apps/web/prisma/**`.
- Added shared enqueue/claim/drain/status reconciliation helpers under `apps/web/src/lib/hosted-execution/outbox.ts`.
- Moved hosted onboarding webhook dispatch effects, hosted share acceptance dispatch, and hosted device-sync wake dispatch onto the shared outbox so each write path now queues in the same transaction as the originating state change.
- Updated hosted share to treat execution as eventual state read from the outbox/status path instead of trusting the initial dispatch response as both transport and completion status.
- Updated the matching `apps/web`, architecture, runtime, and testing docs so the durable outbox contract is documented.

## Verification Results

- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir . exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-share-service.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm typecheck` failed in unrelated dirty `apps/cloudflare/src/runner-container.ts`.
- `pnpm test` failed in unrelated dirty `apps/cloudflare/test/{deploy-automation,node-runner,runner-container}.test.ts`.
- `pnpm test:coverage` failed for the same unrelated `apps/cloudflare` failures.
- Required audit subagents for `simplify`, `test-coverage-audit`, and `task-finish-review` were attempted twice but the agent pool returned usage-limit failures instead of review output.

Status: completed
Updated: 2026-03-27
Completed: 2026-03-27
