## Title

Land the supplied hosted Stripe webhook pooler fix so webhook ingestion stops doing cross-client activation/reconciliation work inline.

## Goal

Apply the supplied hosted Stripe webhook patch as a narrow `apps/web` billing/onboarding fix that:

- defers webhook reconciliation after receipt persistence when the runtime provides `defer`
- keeps Stripe-event transactions DB-only by resolving canonical subscription status before the Prisma transaction
- removes hidden default-client reads from activation and RevNet confirmation paths
- preserves the existing hosted activation and wake semantics while reducing pooled Postgres transaction contention

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts`
- `apps/web/src/lib/hosted-onboarding/billing-success-service.ts`
- directly coupled clean tests needed to keep the changed interfaces type-safe:
  `apps/web/test/hosted-onboarding-billing-seam.test.ts`,
  `apps/web/test/hosted-onboarding-member-activation.test.ts`,
  `apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts`,
  `apps/web/test/hosted-onboarding-billing-success-service.test.ts`,
  `apps/web/test/hosted-onboarding-stripe-revnet-reconciliation.test.ts`,
  `apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts`

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated dirty-tree edits, especially existing `apps/web` test work and other active hosted/runtime rows.
- Do not widen into schema changes, new dependencies, or unrelated hosted onboarding behavior.
- Keep privacy guardrails intact: do not write personal identifiers into plans, logs, diffs, or commits.

## Verification

- planned: `pnpm typecheck`
- planned: `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts apps/web/src/lib/hosted-onboarding/billing-success-service.ts`
- planned: `git diff --check -- apps/web/src/lib/hosted-onboarding/webhook-service-stripe.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts apps/web/src/lib/hosted-onboarding/billing-success-service.ts`

## Notes

- The supplied patch was source-only, but repo-required verification exposed clean directly coupled tests that must be updated for the new activation and billing-policy signatures.
- This lane still does not take ownership of the pre-existing dirty `apps/web/test/**` files such as `hosted-onboarding-stripe-event-reconciliation.test.ts`; those remain out of scope unless later coordination changes.
- The main failure mode under repair is pooled Postgres transaction contention from mixing interactive transaction work with default Prisma client reads and Stripe API calls.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
