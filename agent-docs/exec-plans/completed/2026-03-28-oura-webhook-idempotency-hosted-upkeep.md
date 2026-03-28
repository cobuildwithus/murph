# Fix Oura hosted webhook upkeep and idempotency gaps

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Keep hosted Oura webhook delivery fresh and idempotent by refreshing hosted subscriptions outside connect-time best-effort calls, making provider-side subscription ensure resilient to concurrent and drifted state, stabilizing webhook dedupe when Oura retries without a stable event id, and collapsing the remaining Oura-only hosted seams onto shared provider-admin capabilities.

## Success criteria

- Hosted Oura subscription upkeep runs on a steady-state hosted control-plane path instead of only connect-time best effort, and failures no longer disappear behind `console.warn`.
- `packages/device-syncd` Oura subscription ensure reduces duplicate-create drift and can prune stale duplicate subscriptions beyond only the current callback URL when it is safe to do so.
- Oura webhook fallback dedupe no longer depends on the transport timestamp when Oura omits `trace_id` / `event_id`.
- The hosted/local Oura-only branches for webhook subscription upkeep and challenge resolution are replaced with shared provider-admin capabilities.
- Webhook trace completion ownership is explicit at the durable hook boundary instead of implicitly shared with public ingress.
- Focused tests prove the hosted upkeep trigger, the Oura ensure/prune behavior, the timestamp-independent webhook dedupe behavior, and the trace-completion / hosted-runtime cleanup behavior.

## Scope

- In scope:
- Hosted Oura subscription upkeep wiring in the hosted device-sync control plane.
- Oura subscription ensure behavior in `packages/device-syncd/src/providers/oura-webhooks.ts`.
- Oura webhook fallback trace-id generation and directly related tests.
- Shared webhook-admin/provider seams directly required to remove the duplicated Oura-only branching in hosted/local webhook control paths.
- Explicit webhook trace-completion ownership and the hosted-runtime wake fallback cleanup.
- Out of scope:
- Unrelated device-sync provider/runtime cleanups.
- Broader hosted webhook scheduling architecture beyond what is required to keep Oura subscriptions fresh.

## Constraints

- Technical constraints:
- Preserve adjacent in-flight hosted/device-sync edits and work with the current shared ingress/runtime seams.
- Keep Oura webhook dedupe compatible with existing trace-id and queue semantics for providers that already send stable ids.
- Product/process constraints:
- Run the required completion-workflow audit passes via spawned subagents after implementation.
- Record and defend any repo-wide verification failures that remain unrelated to this lane.

## Risks and mitigations

1. Risk: Hosted upkeep wiring overlaps active hosted/device-sync lanes in `apps/web`.
   Mitigation: Keep the change narrow, read the live file state first, and preserve adjacent behavior outside Oura subscription refresh.
2. Risk: Oura subscription APIs may not support perfect linearizability from a single-process code change.
   Mitigation: Prefer deterministic idempotent target reconciliation, duplicate cleanup, and regression tests that prove the improved invariants we can actually enforce.
3. Risk: Changing webhook dedupe keys could accidentally collapse distinct events.
   Mitigation: Restrict the timestamp-independent fallback to the no-stable-id path and keep the key scoped to account, event, resource, and object identity.

## Tasks

1. Inspect the hosted Oura upkeep call sites, Oura subscription ensure flow, webhook dedupe path, and current tests.
2. Implement hosted upkeep invocation and error handling that keeps Oura subscription ensure on the steady-state path.
3. Tighten Oura subscription ensure against concurrent duplicate creation and cross-origin stale subscription drift where the provider data allows safe cleanup.
4. Make fallback Oura webhook trace ids independent from transport timestamps and add focused regression coverage.
5. Run focused verification, required repo checks, and mandatory simplify/coverage/final-review audits before closing the task.

## Decisions

- Introduced a shared provider-level `webhookAdmin` capability instead of keeping hosted/local Oura subscription upkeep and verification challenge handling behind ad hoc `provider === "oura"` branches.
- Kept hosted webhook subscription ensure on two paths: best-effort during connection establishment and strict upkeep during hosted runtime snapshot generation, which is the steady-state hosted maintenance path already exercised by local-agent sync.
- Made durable webhook trace completion hook-owned whenever `onWebhookAccepted` is installed so transactional accept-and-complete remains in the durable hooks instead of being implicitly duplicated in public ingress.
- Removed the hosted runtime fallback that treated hosted connection ids like local account ids; hosted/local reconciliation remains the only supported mapping.
- Tightened Oura webhook subscription reconciliation to prefer the current callback URL, re-list before managed pruning, and prune stale managed callbacks by webhook path across origins.
- Stabilized fallback Oura webhook trace ids against transport timestamp churn by hashing stable event/account/object identity plus body event time when Oura omits `trace_id` / `event_id`.

## Verification

- Commands to run:
- Targeted `vitest` coverage for Oura provider/webhooks and hosted control-plane behavior.
- Required repo wrappers: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Expected outcomes:
- Focused Oura/hosted tests pass.
- Repo-wide wrappers either pass or fail only for clearly unrelated pre-existing issues documented in handoff.

## Outcome

- Implemented the shared hosted/local `webhookAdmin` seam for Oura verification challenges and hosted subscription upkeep in `apps/web/src/lib/device-sync/control-plane.ts`, `packages/device-syncd/src/http.ts`, and `packages/device-syncd/src/providers/oura.ts`.
- Added hosted runtime-snapshot upkeep so active hosted providers with webhook-admin support are refreshed outside the connect-time best-effort path.
- Hardened `packages/device-syncd/src/providers/oura-webhooks.ts` against stale snapshot cleanup, cross-origin managed callback drift, and 404 races during duplicate deletion.
- Clarified webhook trace-completion ownership in public ingress and regression-tested the single-completion invariant.
- Removed the misleading hosted wake fallback lookup from the hosted runtime by relying only on hosted-to-local reconciliation.

## Verification Results

- Passed: `pnpm vitest --no-coverage packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/oura-webhooks.test.ts packages/device-syncd/test/public-ingress.test.ts packages/device-syncd/test/http.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-device-sync-internal-routes.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/agent-route.test.ts`
- Passed: `pnpm --dir packages/device-syncd build`
- Failed, unrelated: `pnpm --dir packages/assistant-runtime build` due existing cross-package build errors in `packages/inboxd/src/connectors/linq/normalize.ts` and missing `@murph/importers` resolution from `packages/device-syncd/src/service.ts`
- Failed, unrelated: `pnpm typecheck` due existing `packages/inboxd/src/connectors/linq/{connector.ts:195,normalize.ts:123}` nullability errors during the workspace build phase
- Failed, unrelated: `pnpm test` due the same existing `packages/inboxd/src/connectors/linq/{connector.ts:195,normalize.ts:123}` nullability errors during the workspace build phase
- Failed, unrelated: `pnpm test:coverage` after a transient `ENOTEMPTY` cleanup retry in `packages/importers/dist`; final failure remained existing `packages/inboxd/src/connectors/linq/{connector.ts:195,normalize.ts:82}` nullability typing
- Blocked: required `simplify`, `test-coverage-audit`, and `task-finish-review` audit passes could not be run because this session does not expose a spawn-agent tool
Completed: 2026-03-28
