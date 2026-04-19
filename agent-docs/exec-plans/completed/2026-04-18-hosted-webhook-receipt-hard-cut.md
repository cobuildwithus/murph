## Goal

Remove `HostedWebhookReceipt` lifecycle ownership from the remaining hosted Linq webhook/control-plane paths in `apps/web`, replacing receipt-owned behavior with direct deterministic sends plus canonical post-send finalization, and keep ignored-event replay behavior with the smallest dedicated marker if that contract still needs preserving.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/linq/control-plane.ts`
- `apps/web/src/lib/hosted-webhook-receipts.ts`
- `apps/web/app/api/internal/hosted-onboarding/webhook-receipts/cron/route.ts`
- `apps/web/prisma/**`
- directly related `apps/web` tests only

## Constraints

- Preserve unrelated `apps/web` work already in the tree, especially active onboarding auth/pricing lanes.
- Keep the hosted web control plane as the canonical owner of durable state; do not move product truth into execution/runtime mirrors.
- Prefer deterministic Linq idempotency keys plus invite reuse over rebuilding retry journals.
- If ignored Linq replays must stay ignored after a later binding appears, replace receipt rows with the smallest dedicated marker model instead of preserving the receipt engine.
- Do not inspect or log env contents.

## Verification

- Focused `apps/web` tests covering Linq webhook/control-plane direct handling and any surviving ignored-marker behavior
- Focused Prisma/schema tests for the receipt removal or marker replacement
- `apps/web` lint/typecheck for the touched slice

## Status

- Completed the hosted Linq ingress hard cut with a single-row webhook ingress gate keyed by `source + eventId`.
- Removed live receipt-engine sources, the webhook-receipt cron route, and the Vercel cron entry for that route.
- Preserved retry safety by checkpointing the planned Linq response/side effects/finalization in the ingress gate row instead of reintroducing receipt side-effect tables.

## Verification Results

- `pnpm --dir apps/web exec prisma generate`
- `pnpm --dir apps/web exec tsc --noEmit --pretty false`
- `pnpm exec vitest run apps/web/test/hosted-onboarding-linq-route.test.ts --config apps/web/vitest.config.ts`
- `pnpm exec vitest run apps/web/test/linq-control-plane.test.ts --config apps/web/vitest.config.ts`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
