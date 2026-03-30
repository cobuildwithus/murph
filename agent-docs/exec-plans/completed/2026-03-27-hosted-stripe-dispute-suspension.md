# 2026-03-27 Hosted Stripe Dispute Suspension

## Goal

Close the hosted Stripe ops gap for refunds and disputes by treating payment reversals as a suspension signal: suspend the hosted member, revoke live hosted sessions, and prevent any further activation dispatch or RevNet issuance from later Stripe events.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/session.ts`
- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- Focused hosted onboarding tests in `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Hosted onboarding docs only if the runtime contract meaning changes

## Constraints

- Reuse the existing hosted member/session model; avoid schema expansion unless strictly required.
- Preserve the current receipt-side-effect and idempotency flow for Stripe webhooks.
- Do not attempt onchain clawbacks; only stop future activation, access, and issuance.
- Preserve adjacent in-flight hosted onboarding and RevNet edits.

## Planned Changes

1. Handle Stripe refund and dispute webhook types in the existing Stripe webhook switch.
2. Resolve the impacted hosted member from Stripe object identifiers and mark them suspended.
3. Revoke active hosted sessions when suspension is applied.
4. Prevent suspended members from starting checkout, regaining session access, dispatching activation, or issuing RevNet from later paid events.
5. Add focused tests for refund/dispute suspension and the new guards.

## Verification

- Focused hosted onboarding tests during development
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents after implementation
