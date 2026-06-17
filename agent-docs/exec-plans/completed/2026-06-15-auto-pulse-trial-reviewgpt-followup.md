# Auto Pulse Trial ReviewGPT Follow-up

## Goal

Close the remaining ReviewGPT findings on PR #173 before handoff.

Success criteria:
- auto Pulse Trial retries do not create another live Stripe subscription when a same-customer same-member Pulse Trial subscription already exists
- cleanup failure does not encourage client retry into another create path
- auto Pulse Trial UI and service enforce the existing messaging-channel precondition before billing/activation
- focused hosted-onboarding tests, `apps/web` typecheck, and required web verification pass or have documented unrelated blockers

## Scope

- `apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`
- `apps/web/src/lib/hosted-onboarding/billing-start-preconditions.ts`
- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- `apps/web/src/components/hosted-onboarding/join-invite-stage-server.tsx`
- matching hosted-onboarding tests

## Constraints

- Preserve the existing checkout messaging invariant.
- Do not create durable attempt state unless the existing Stripe/customer primitives are insufficient.
- Keep retry behavior conservative when cleanup cannot be proven.

## Plan

1. Share the billing-start messaging precondition between checkout and auto-trial enrollment.
2. Reconcile existing same-customer Pulse Trial subscriptions before creating a fresh auto-trial subscription.
3. Add regression coverage for retry recovery and missing messaging channel.
4. Run focused tests, typecheck, web verify, and ReviewGPT again.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
