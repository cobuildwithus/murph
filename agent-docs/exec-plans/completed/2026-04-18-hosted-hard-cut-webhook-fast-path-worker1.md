# Hosted webhook fast path for Linq and Telegram

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove active-member Linq and Telegram message traffic from the hosted
  webhook receipt wrapper so those hot paths authenticate, append the canonical
  wake in the same DB transaction, acknowledge directly, and best-effort nudge
  Cloudflare without receipt continuation ownership.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts` no longer routes
  active-member Linq or Telegram message traffic through
  `runHostedWebhookWithReceipt(...)`.
- Active-member Linq and Telegram message ingress still preserves duplicate
  protection, current response shapes, and canonical `HostedWake` append plus
  wake nudge behavior.
- Receipt-managed onboarding, invite, quota-reply, and other receipt-local side
  effects still use the receipt wrapper unchanged.
- Focused hosted-web Linq/Telegram dispatch and webhook idempotency tests pass,
  or failures are documented as pre-existing and unrelated.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
  - focused `apps/web/test/hosted-onboarding-{linq,telegram}-dispatch.test.ts`
  - `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Out of scope:
  - `packages/assistant-runtime/**`
  - `apps/cloudflare/**`
  - broad hosted-execution contract renames beyond tiny compile-through changes
  - unrelated hosted onboarding UI or auth behavior

## Constraints

- Technical constraints:
  - Preserve active-member duplicate protection and webhook response payloads
    unless a focused test proves a change is required.
  - Keep direct wake append in the same DB transaction as policy/auth handling.
  - Do not reintroduce `execution_outbox`, stored dispatch payloads, or awaited
    recovery semantics.
- Product/process constraints:
  - Work carefully on top of the shared dirty tree and avoid overwriting nearby
    hosted-migration edits from other lanes.
  - Use the repo-required plan, ledger, verification, audit, and commit flow.

## Risks and mitigations

1. Risk: the service split could accidentally bypass receipt-local side effects
   for onboarding or quota flows.
   Mitigation: keep provider planning logic authoritative and branch only on the
   active-member direct-dispatch outcome.

2. Risk: duplicate handling could drift between the direct path and the receipt
   path.
   Mitigation: preserve existing wake/event id usage and extend focused
   idempotency coverage instead of adding new dedupe primitives.

## Tasks

1. Register this worker plan and ledger row before editing code.
2. Inspect the current webhook service, provider plans, receipt engine, and
   focused tests to isolate the active-member fast path seam.
3. Implement a direct append-plus-nudge service path for active-member Linq and
   Telegram messages while preserving receipt-managed non-active-member flows.
4. Update or extend focused hosted-web dispatch/idempotency tests only where
   behavior changed.
5. Run focused verification, then required audits and a scoped finish-task
   commit.

## Decisions

- Treat provider planning as the source of truth for whether a webhook should
  take the direct active-member path or the receipt-managed path.
- Keep `plannedAt` as the durable "planner already ran" marker. Fast-path
  retries now only resume wake handoff when a wake target already exists,
  while non-fast-path planned receipts continue stored receipt-local side
  effects without replanning.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage`
  - `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- Expected outcomes:
  - Active-member Linq and Telegram webhook ingress bypasses receipt wrapping
    while non-active-member receipt-local behavior remains intact.
  - Focused hosted-web dispatch and idempotency coverage stays green.
- Completed outcomes:
  - All three focused hosted-web webhook suites passed after the fast-path
    service split and retry-safety regressions were added.
  - `pnpm exec tsc -p apps/web/tsconfig.json --pretty false` passed.
Completed: 2026-04-18
