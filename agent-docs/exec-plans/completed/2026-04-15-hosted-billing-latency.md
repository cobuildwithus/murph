## Goal

Reduce hosted billing checkout latency in `apps/web` without weakening billing correctness, invite/auth validation, or Stripe webhook reconciliation.

## Scope

- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/test/hosted-onboarding-billing-service.test.ts`

## Guardrails

- Preserve the current billing correctness model for Stripe webhook matching.
- Do not remove the local Stripe customer binding required for `invoice.paid` lookup.
- Keep invite ownership and messaging-gate behavior intact.
- Prefer deleting redundant synchronous work over adding new abstraction.

## Plan

1. Slim the checkout hot path to the minimum required invite/member data.
2. Remove redundant synchronous Stripe customer updates from checkout.
3. Add focused tests covering the retained and removed behaviors.
4. Run truthful scoped verification for `apps/web`, then required audits and commit.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
