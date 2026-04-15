# Hosted Stripe Webhook Async Dispatch

## Goal

Make the hosted Stripe webhook acknowledge after durable Stripe fact/reconciliation work completes while moving best-effort RevNet and hosted-execution drain nudges onto a non-blocking background path.

## Scope

- `apps/web/app/api/hosted-onboarding/stripe/webhook/route.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- focused `apps/web/test/**` coverage for Stripe webhook behavior

## Constraints

- Keep durable Stripe recording and reconciliation inline.
- Preserve RevNet and hosted-execution nudges, but do not block the webhook response on them.
- Avoid unrelated billing or hosted-execution refactors.
- Preserve unrelated worktree edits.

## Verification

- focused `vitest` for Stripe webhook tests/routes
- `pnpm --dir apps/web typecheck`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
