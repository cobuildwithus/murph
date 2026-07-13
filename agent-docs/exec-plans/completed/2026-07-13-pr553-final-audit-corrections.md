# PR 553 Final Audit Corrections

## Goal

Resolve the three validated exact-head final-audit findings for PR 553:

1. Keep billing and Family control-plane requests alive through the bounded
   canonical Stripe operation and return its typed outcome.
2. Give every top-level Family invite issuance/acceptance transaction that can
   perform a live Stripe fence the existing Stripe-aware transaction budget.
3. Preserve the Settings invite auto-add `pending_payment` result and navigate
   the owner to the existing Family-scoped billing portal handoff.

## Constraints

- Keep mutation transports non-retrying and preserve exact-action approval.
- Keep live Stripe capacity reads under the existing owner/member locks.
- Reuse the canonical transaction and portal owners; add no new persisted state,
  queues, or retry machinery.
- Keep all changes isolated to PR 553 and require a new final ReviewGPT audit on
  the exact corrected head.

## Working Set

- `packages/hosted-execution/src/runtime-control.ts`
- `apps/cloudflare/src/runtime-platform/{billing-plan-tool-port,family-plan-tool-port,platform-factory}.ts`
- `apps/cloudflare/src/runner-outbound/web-control.ts`
- focused Cloudflare control-plane tests
- `apps/web/src/lib/hosted-onboarding/{shared,hosted-member-billing-store,family-plan,webhook-service}.ts`
- `apps/web/app/api/settings/billing/family/invite/route.ts`
- `apps/web/src/components/settings/hosted-family-settings-actions.tsx`
- focused Family route, component, transaction, and webhook tests

## Verification Plan

- Focused tests for both control-plane hops using the dedicated budget and no
  retry, long-running Family invite transactions, and Settings portal handoff.
- Relevant package/app typechecks and required diff verification.
- Parent security/privacy, coverage, simplification, and deep-review passes.
- Scoped commit and push, exact-head CI, then one final published ReviewGPT
  0.5.106 audit on the corrected head.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
