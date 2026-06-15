# Auto Pulse Trial Review Fixes

## Goal

Resolve the accepted PR 173 review findings for the hosted auto Pulse Trial enrollment flow before merge.

## Constraints

- Keep the fix scoped to hosted billing/onboarding semantics and focused tests.
- Prevent Stripe metadata or customer lookup from making an orphan subscription authoritative over a member already bound to a different subscription.
- Keep subscription events conservative: invoices remain the proof that converts an expired trial to paid entitlement.
- Keep auto-trial retries compatible with orphan cleanup by making subscription-create idempotency scoped to one enrollment attempt.
- Reject auto-trial entitlement writes if the transaction-local locked row has already become paid, redeemed, or otherwise active outside the trial state.
- Preserve the rollout flag and billing-ready gates.
- Avoid expanding the billing freshness state machine unless a concrete same-subscription race requires it.

## Working Set

- `apps/web/src/lib/hosted-onboarding/stripe-billing-lookup.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-status.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`
- `apps/web/src/components/home/trial-billing-banner.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-auto-trial-island.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx`
- `apps/web/app/(dashboard)/home/page.tsx`
- `apps/web/test/hosted-onboarding-*.test.ts`
- `apps/web/test/home-trial-billing-banner.test.tsx`
- `apps/web/test/join-invite-page-view.test.ts`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/prompts/coverage-write.md`

## Verification Plan

- Focused hosted-onboarding Vitest coverage for orphan subscription lookup, resumed semantics, trial-will-end no-op behavior, auto-trial retry/idempotency, transaction-local paid-state rejection, billing-ready UI fallback, home trial recovery UI, and route constant reuse.
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web verify`
- Required completion audits for billing/trust-boundary, UI, coverage, and deep-review surfaces.
- Push the scoped commit and run the required PR ReviewGPT loop against the pushed PR head.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
