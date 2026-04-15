# Hosted Webhook Async Dispatch

## Goal

Make hosted onboarding webhooks acknowledge after the durable receipt/outbox write and move hosted execution dispatch nudges onto a non-blocking background path.

## Scope

- `apps/web/app/api/hosted-onboarding/linq/webhook/route.ts`
- `apps/web/app/api/hosted-onboarding/telegram/webhook/route.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- focused `apps/web/test/**` coverage for non-blocking dispatch behavior

## Constraints

- Keep `execution_outbox` as the durable dispatch owner.
- Preserve immediate best-effort dispatch nudges, but do not block webhook HTTP responses on them.
- Do not touch unrelated hosted execution retry semantics.
- Preserve unrelated worktree changes.

## Verification

- `pnpm test:diff apps/web`
- direct static review of webhook and route behavior
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
