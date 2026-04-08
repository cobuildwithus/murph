# Hosted Latency Follow-ups

## Goal

Reduce avoidable UX latency in hosted flows by:
- moving slow hosted onboarding Linq reply sends off the webhook response path while preserving durable recovery,
- immediately draining newly queued hosted execution outbox rows for hosted share acceptance, and
- immediately draining newly queued hosted execution outbox rows for hosted device-sync wake events.

## Scope

- `apps/web` hosted onboarding webhook receipt engine, service, route, store, and tests
- new hosted-web cron recovery route and Vercel cron wiring for webhook receipt side effects
- hosted share acceptance and device-sync wake outbox drain follow-ups
- narrow doc updates for the new hosted-web internal cron surface and receipt recovery behavior

## Constraints

- Keep `execution_outbox` as the durable Cloudflare handoff boundary.
- Preserve hosted webhook receipt idempotency and reclaim semantics.
- Do not overwrite or revert unrelated in-flight hosted-web work.
- Keep the change additive and bounded to hosted latency behavior.

## Verification

- Focused hosted-web Vitest coverage for Linq/Telegram/webhook receipt/share/device-sync paths
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm test:coverage`

## Notes

- The first pass already fixed active-member Linq/Telegram dispatch pickup latency by draining newly queued outbox rows immediately after webhook receipt commit.
- This follow-up covers remaining request-path and cron-gated latency smells from the same review.
- Completed implementation:
  - Linq signup/quota webhook replies now defer receipt-owned side effects with `after()` and recover abandoned receipts through `/api/internal/hosted-onboarding/webhook-receipts/cron`.
  - Hosted share acceptance and hosted device-sync wake publishing now immediately best-effort drain just-enqueued outbox rows.
  - Hosted-web Vitest now seeds a local default `DATABASE_URL` during test setup so import-time Prisma initialization does not break repo verification.
- Verification completed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-share-service.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-webhook-receipt-cron.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-share-service.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/prisma-store-client.test.ts --no-coverage`
  - `pnpm typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web verify` currently fails for unrelated pre-existing syntax work in `src/components/hosted-onboarding/hosted-phone-auth.tsx:495`.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
