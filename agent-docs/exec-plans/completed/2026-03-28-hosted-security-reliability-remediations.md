# 2026-03-28 Hosted Security And Reliability Remediations

## Goal

- Close the reported hosted trust-boundary, idempotency, recovery, replay, and queue-fairness gaps without widening the hosted execution surface.

## Scope

- `agent-docs/exec-plans/active/{2026-03-28-hosted-security-reliability-remediations.md,COORDINATION_LEDGER.md}`
- `ARCHITECTURE.md`
- `apps/cloudflare/src/{execution-journal.ts,index.ts,runner-container.ts,runner-env.ts,runner-outbound.ts,user-runner.ts,user-runner/runner-queue-store.ts,user-runner/types.ts}`
- `apps/cloudflare/test/{auth.test.ts,index.test.ts,runner-container.test.ts,runner-outbound.test.ts,user-runner.test.ts}`
- `apps/web/app/api/internal/device-sync/runtime/{snapshot,apply}/route.ts`
- `apps/web/src/lib/device-sync/internal-runtime.ts`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/test/{device-sync-internal-runtime.test.ts,hosted-execution-outbox.test.ts}`
- `packages/assistant-runtime/src/{hosted-device-sync-control-plane.ts,hosted-runtime/environment.ts,hosted-runtime/events/share.ts}`
- `packages/assistant-runtime/test/hosted-runtime-http.test.ts`
- `packages/hosted-execution/src/auth.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`

## Constraints

- Preserve overlapping in-flight hosted-runtime and Cloudflare edits already active in the worktree.
- Keep the runner-to-web trust boundary narrow: no new broad runner-visible internal tokens.
- Prefer behavior-preserving fixes at existing seams over new public APIs.
- Document any architecture-significant auth or replay changes in `ARCHITECTURE.md`.

## Plan

1. Move runner access to hosted device-sync snapshot/apply and hosted share payload reads onto the Cloudflare outbound proxy so user binding is implicit and runner-visible global web tokens are removed.
2. Authenticate the outer runner container invoke/destroy wrapper itself with a header-based control token distinct from the body.
3. Make outbox upserts reject conflicting metadata, include `userId` in committed journal state for recovery, tighten replay protection beyond timestamp-only verification, and enforce side-effect route path/body `effectId` equality.
4. Keep the queue moving after retry reschedules, and make consumed-event replay suppression durable enough for immutable hosted event ids.
5. Add focused regressions, run targeted verification plus required repo checks, then complete the mandatory simplify, coverage-audit, and finish-review subagent passes.

## Verification

- Focused hosted regressions passed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-device-sync-internal-routes.test.ts apps/web/test/device-sync-internal-runtime.test.ts apps/web/test/hosted-execution-outbox.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-http.test.ts --no-coverage --maxWorkers 1`
- Required repo checks on the final tree remain blocked by unrelated pre-existing failures:
  - `pnpm test`
    - fails in `apps/web/src/lib/hosted-onboarding/webhook-provider-{linq,stripe,telegram}.ts` because `./webhook-receipts` does not export `HostedWebhookReceiptPersistenceClient`
  - `pnpm test:coverage`
    - fails on the same unrelated hosted-onboarding type error
  - `pnpm typecheck`
    - fails in `packages/cli/test/inbox-service-boundaries.test.ts` with existing `never` property access errors
- Mandatory audits:
  - `simplify`: completed and integrated
  - `test-coverage-audit`: completed and integrated with a direct web route regression
  - `task-finish-review`: first pass completed and surfaced proxy-token and replay-retention regressions, both fixed here; a follow-up pass could not be rerun because the agent environment hit its usage limit

## Outcome

- Removed runner-visible broad web internal tokens from the hosted runner environment and routed device-sync/share reads through worker-local proxy seams so user binding is no longer caller-controlled.
- Added trusted-user enforcement at the hosted web device-sync internal routes and accepted hosted execution auth as the narrow share-payload fallback.
- Included `userId` in committed execution journal results, bounded replay retention with an exact-plus-filter approach, and added regression coverage for the new proxy and replay behaviors.
- Left repo-wide red checks untouched where they are already blocked by unrelated hosted-onboarding and CLI typing failures outside this lane.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
