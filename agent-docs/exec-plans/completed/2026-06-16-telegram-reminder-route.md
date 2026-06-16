# Telegram Reminder Route Delivery

## Goal

Fix scheduled Telegram reminders that fire but fail to send because the queued outbox intent loses its deliverable Telegram route.

## Constraints

- Keep the delivery architecture simple: cron validates a route, notification turns materialize it, outbox dispatches it.
- Do not add retries or special-case scheduler behavior for a route propagation bug.
- Preserve existing Linq and email delivery semantics.

## Plan

1. Trace thread-only Telegram cron routes through notification delivery and outbox intent creation.
2. Add a focused regression proving a queued notification retains a Telegram thread binding.
3. Patch the smallest ownership boundary that preserves the route.
4. Run focused assistant-engine tests and typecheck.
5. Run required completion audits and finish with a scoped commit.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-delivery-service.test.ts`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts`
- Passed: `pnpm --filter @murphai/assistant-engine typecheck`
- Passed: `pnpm --filter @murphai/assistant-engine... build`
- Passed: `git diff --check`
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
