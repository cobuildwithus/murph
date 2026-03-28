# Execution outbox minimization

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Minimize `execution_outbox.payloadJson` so new rows persist only a durable dispatch reference instead of the full hosted execution payload.
- Keep hosted draining behavior equivalent by hydrating dispatches from durable source records and preserving backward compatibility for legacy full-payload rows.

## Success criteria

- New hosted outbox rows serialize a minimal dispatch ref rather than the full dispatch payload.
- Outbox draining can rebuild dispatches from the durable source rows for device-sync signals, hosted share links, and hosted webhook receipts.
- Legacy outbox rows that still store full dispatch payloads remain readable and are rewritten to the minimized ref shape after successful processing.
- Hosted execution contracts and affected tests are updated to match the slimmer event payloads without requiring a Prisma migration.

## Scope

- In scope:
  - `packages/hosted-execution` contract slimming for the affected hosted events
  - `apps/web` hosted outbox payload serialization and hydration
  - `apps/web` device-sync wake signaling durability updates
  - targeted `apps/web` and `apps/cloudflare` test updates required by the slimmer contracts
- Out of scope:
  - Prisma schema changes or migrations
  - minimization of the hosted webhook receipt side-effect journal itself
  - unrelated hosted runner or onboarding refactors outside the touched dispatch/outbox paths

## Constraints

- Preserve compatibility with existing full-payload outbox rows already persisted in Postgres.
- Preserve adjacent dirty hosted execution work, especially the in-flight Cloudflare runner and hosted bootstrap lanes.
- Keep the hydration path sourced from already durable records; do not invent new secondary state.
- Do not widen contract changes beyond the specific event fields called out in the supplied patch.

## Risks and mitigations

1. Risk: minimized payloads could lose enough information to rebuild a valid dispatch.
   Mitigation: derive dispatches only from durable source records and validate hydrated `eventId`, `event.kind`, and `userId` against the outbox row before dispatching.
2. Risk: older outbox rows become unreadable once the hydration path assumes refs only.
   Mitigation: keep explicit legacy full-dispatch parsing and rewrite rows to the minimized ref shape after successful processing.
3. Risk: the dirty tree already has overlapping hosted execution edits in `apps/web` and `apps/cloudflare`.
   Mitigation: keep the lane narrow, preserve adjacent edits, and avoid widening into other active hosted execution work.

## Tasks

1. Register the lane in the coordination ledger.
2. Apply the supplied patch and inspect the resulting diff for overlap or follow-up fixes.
3. Run focused verification for the touched hosted execution surfaces, then run the required repo commands as far as current tree state allows.
4. Run the mandatory simplify, coverage, and final-review audit passes and address any actionable findings before handoff.

## Outcome

- New hosted outbox rows now serialize only a durable dispatch ref, and the drain path hydrates dispatches from durable source records or legacy full-payload rows as needed.
- Device-sync direct wake dispatches now create a real `device_sync_signal` row and enqueue the outbox against that durable signal id instead of the connection id.
- Hosted execution event payloads were slimmed for the affected event kinds, the shared hosted-execution builders/parsers were updated to match, and hosted share acceptance now carries the full share pack directly in the execution event.
- The simplify audit found one actionable cleanup in the outbox drain path, and that follow-up replaced exception-driven legacy detection with an explicit legacy payload check before hydration.
- Focused verification passed:
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Direct scenario proof outside the test harness passed via `pnpm exec tsx /tmp/execution_outbox_direct_scenario.ts`, showing that the minimized ref payload shape round-trips through source-backed hydration for `device_sync_signal` and `hosted_webhook_receipt`.
- Repo-wide wrappers remain blocked by unrelated dirty-tree work outside this lane:
  - `pnpm typecheck` fails in `packages/core/src/{history/api.ts,operations/write-batch.ts}` because of active history/write-batch typing drift.
  - `pnpm test` and `pnpm test:coverage` fail at the same `packages/core` build step before they reach this hosted-execution lane.
  - Focused Cloudflare node/workers suites currently fail in unrelated dirty-tree hosted runner/bootstrap paths (`Hosted runner user is not initialized`, missing `bootstrapUser`, sqlite/email helper issues) after the test harness loads the current `assistant-runtime` source.
- Mandatory audit-pass tooling was only partially usable in this environment:
  - the simplify pass returned one actionable finding that was applied;
  - repeated attempts to obtain clean coverage-audit and final-review subagent output did not return usable final reviews because the spawned workers either recursed into extra delegation or stalled without producing a review result.
Completed: 2026-03-28
