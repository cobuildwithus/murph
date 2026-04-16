## Goal

Move hosted webhook dispatch enqueue ownership into the receipt persistence layer so transport handlers are transport-only.

## Why

- The prior cleanup made transaction ownership explicit, but the handler contract still carries dispatch-enqueue concerns.
- Hosted execution dispatch journaling is a persistence concern and should stay with the receipt engine/store transaction owner.
- Shrinking the handler surface makes the webhook boundary easier to reason about and reduces Prisma-aware cross-module contracts.

## Scope

- `apps/web/src/lib/hosted-onboarding/{webhook-receipt-engine,webhook-receipt-store,webhook-receipt-types,webhook-transport,webhook-receipts}.ts`
- `apps/web/src/lib/hosted-webhook-receipts.ts`
- Focused `apps/web/test/**` updates for webhook receipt and transport boundaries only.

## Guardrails

- Keep webhook product behavior unchanged.
- Preserve the active hosted onboarding debugging and identity work already in flight.
- Do not widen into Cloudflare dispatch or broader hosted execution semantics.

## Verification target

- Truthful scoped apps/web webhook tests covering Linq, Telegram, idempotency, and receipt transport boundaries.
- Call out broader apps/web typecheck or verify failures only when they are pre-existing and unrelated.

## Current status

- Implemented the boundary cleanup so dispatch enqueueing now lives in `webhook-receipt-store.ts` and transport handlers no longer expose `enqueueDispatch`.
- Updated the receipt engine to enqueue dispatch side effects inside the store-owned transaction path before queuing receipt-local side effects.
- Removed legacy public type/re-export surface tied to `HostedWebhookDispatchEnqueueInput` and adjusted the receipt cron test mock shape.

## Verification run

- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-telegram-dispatch.test.ts test/hosted-onboarding-webhook-idempotency.test.ts test/hosted-onboarding-webhook-receipt-cron.test.ts test/hosted-onboarding-linq-transport.test.ts --no-coverage`
- Failed, unrelated pre-existing issue: `pnpm --dir apps/web typecheck` due `src/lib/hosted-onboarding/authentication-service.ts(183,9)`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
