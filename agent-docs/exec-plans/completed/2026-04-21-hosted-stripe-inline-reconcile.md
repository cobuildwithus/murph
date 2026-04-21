## Title

Keep hosted Stripe webhook reconciliation inline so signup activation does not stall behind deferred post-response work.

## Goal

Make the Stripe webhook path reliably append billing and `member.activated` ingress during the request itself, so signup can finish even when the browser `billing/success` callback fails or races.

## Scope

- `apps/web/app/api/hosted-onboarding/stripe/webhook/route.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts`
- focused hosted-web webhook coverage under `apps/web/test/**`

## Constraints

- Preserve the existing recorded-event-first/idempotent webhook flow.
- Keep webhook response semantics the same for duplicates and signature failures.
- Do not broaden into billing-plan, invite-stage, or Cloudflare control-plane changes unless the inline webhook fix forces it.
- Preserve overlapping dirty-tree edits outside this hosted-onboarding webhook slice.

## Verification

- passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-stripe-route.test.ts --coverage.enabled=false`
- passed: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- failed for unrelated pre-existing reason: `pnpm test:diff apps/web/app/api/hosted-onboarding/stripe/webhook/route.ts apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-stripe-route.test.ts`
  - current blocker: `apps/web/test/experiment-header.test.ts > shows protocol days at the top level without counting baseline days`
  - reason unrelated to this diff: the failure is in the hosted experiments header expectation and reproduces without touching the Stripe webhook/auth files

## Notes

- Live debugging evidence:
  - Vercel production logged `POST /api/hosted-onboarding/billing/success` returning `500` on 2026-04-21 around 03:12.
  - Cloudflare showed no corresponding `murph-hosted` execution activity in the same window.
  - The architecture doc expects Stripe webhook ingress to commit billing plus inline `member.activated` ingress, which the current `after(...)` deferral violates.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
