# Enable automatic tax for hosted Stripe Checkout

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Ensure hosted signup Checkout Sessions created through the Stripe API enable automatic tax and preserve the customer location needed for recurring subscription tax calculation.

## Success criteria

- Hosted billing Checkout Sessions include `automatic_tax.enabled = true`.
- The existing-customer Checkout flow persists the collected billing address back onto the Stripe customer for future invoices.
- Focused `apps/web` tests cover the updated Stripe request shape.

## Scope

- In scope:
  - `apps/web` hosted onboarding billing service request shape.
  - Focused hosted onboarding billing-service tests.
- Out of scope:
  - Stripe webhook reconciliation changes.
  - Billing portal or metering changes.
  - Broader hosted onboarding UX copy or product-policy changes.

## Constraints

- Technical constraints:
  - Preserve the existing hosted onboarding checkout flow and member/customer binding logic.
  - Avoid widening the change beyond the Stripe API request and direct tests unless verification forces it.
- Product/process constraints:
  - This is a billing-path change, so use the high-risk repo workflow with scoped verification and required audits.

## Risks and mitigations

1. Risk: Automatic tax on a reused Stripe customer can still fail future renewals if Checkout-collected address data is not persisted.
   Mitigation: Update the Checkout Session to save the address onto the passed customer during Checkout.
2. Risk: Touching billing flow code can regress hosted signup unexpectedly.
   Mitigation: Keep the diff narrow and add direct request-shape assertions in the existing billing-service tests.

## Tasks

1. Completed: updated the hosted onboarding Checkout Session create payload for automatic tax and customer address persistence.
2. Completed: extended hosted onboarding billing-service tests to assert the new Stripe request fields for fresh and existing customer flows.
3. Completed: ran scoped verification for `apps/web`, then the required coverage-write and final-review audits.

## Decisions

- Reused hosted Stripe customers should save Checkout-collected addresses back onto the customer via `customer_update.address = "auto"` so subscription renewals have a durable tax location.
- Keep the implementation at the Checkout request boundary instead of widening into billing reconciliation, because this task is about API-created subscription checkout configuration.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/test/hosted-onboarding-billing-service.test.ts`
- Expected outcomes:
  - TypeScript and focused `apps/web` verification pass for the touched billing files before audit closeout.
- Outcomes:
  - `pnpm typecheck` passed before and after the coverage-write test update.
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/test/hosted-onboarding-billing-service.test.ts` passed before and after the coverage-write test update.
  - Required `coverage-write` audit added request-shape assertions for the reused-customer checkout path only.
  - Required final review returned no findings; residual risk is limited to unverified live Stripe test-mode behavior outside repo-local automation.
Completed: 2026-04-15
