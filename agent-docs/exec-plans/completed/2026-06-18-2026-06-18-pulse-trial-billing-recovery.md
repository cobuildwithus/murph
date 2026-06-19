# Pulse Trial Billing Recovery

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Prevent exhausted no-card Pulse Trial members from falling into a dead billing state:
  `/home` must keep showing the trial usage-limit action when the canonical
  usage ledger is over the trial cap, and Start Pulse must route no-card trials
  to a recoverable Stripe payment-method setup path instead of returning a
  generic Stripe-unavailable error.

## Success criteria

- Usage-gate reads cannot allow AI/home access just because
  `hosted_ai_usage_period.spent_usd_micros` lags behind counted usage rows.
- Start Pulse detects a trial subscription with no payment method before trying
  `trial_end: "now"` and returns a user-actionable payment URL.
- Existing paid-conversion and payment-required recovery paths keep their
  current behavior.
- Focused hosted-web tests cover both regressions.

## Scope

- In scope:
  - Hosted AI usage allowance read/resolve behavior.
  - Existing Start Pulse service and button response contract.
  - Focused hosted-web tests for the two production failure modes.
- Out of scope:
  - Manual repair for the already-fixed member.
  - New persisted tables or broad billing refactors.
  - Public homepage/marketing redesign.

## Constraints

- Technical constraints:
  - Keep `apps/web` as the canonical owner of hosted billing and usage facts.
  - Do not add a second usage source of truth; reconcile against the existing
    immutable `hosted_ai_usage` ledger.
  - Keep Stripe customer/subscription/payment identifiers out of docs, fixtures,
    and committed examples.
- Product/process constraints:
  - Prefer the smallest durable flow over speculative billing abstractions.
  - Preserve the no-card auto-trial product path.

## Risks and mitigations

1. Risk: Recomputing usage spend on every home render could add query cost.
   Mitigation: Use one bounded indexed aggregate for the current period only,
   and keep writes on the existing period row path.
2. Risk: Stripe payment-method setup could create parallel subscriptions.
   Mitigation: Prefer a customer billing portal/session for the existing
   customer/subscription instead of creating a new Checkout subscription.

## Tasks

1. Inspect current usage-gate and Start Pulse tests/helpers.
2. Add ledger-backed usage spend reconciliation for current-period decisions.
3. Add no-card trial payment-method setup handling before trial conversion.
4. Add focused tests for stale aggregate and no-card trial conversion.
5. Run focused verification, required audits, and final review.

## Decisions

- Use the existing Stripe customer portal helper if present; otherwise add the
  narrowest service-local portal session call needed for this flow.

## Verification

- Commands run:
  - `pnpm install --frozen-lockfile`
  - `pnpm --dir apps/web prisma:generate`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts`
    passed with 65 tests.
  - `pnpm --dir apps/web typecheck:prepared`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web test:prepared` passed with 2,587 tests and 7 skips.
  - `pnpm --dir apps/web verify`
  - `git diff --check`
- Audits:
  - `security-privacy-review`: no actionable findings.
  - `coverage-write`: added customer-level default payment method coverage.
  - `deep-review`: no actionable production-breaking findings; noted live Stripe
    portal/test-clock proof as the remaining integration risk.
Completed: 2026-06-18
