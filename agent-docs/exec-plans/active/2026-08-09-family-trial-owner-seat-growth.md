# Family trial owner seat growth

Status: active
Created: 2026-08-09

## Goal

- Let an active Family owner add paid capacity when that owner legitimately
  retained a separate personal Pulse trial during Family checkout.
- Preserve the direct-subscription rejection for invited non-owner members.

## Success criteria

- A regression reproduces an active personal-trial owner with an independently
  active Family subscription and proves capacity growth reaches Stripe.
- Invite acceptance still rejects a non-owner with a live direct subscription.
- Focused Family billing tests, web typecheck, required review gates, and exact
  PR-head CI pass.

## Constraints

- Reuse the existing owner lock, Family billing projection, and Stripe capacity
  update path.
- Add no schema, durable state, background process, or production mutation.
- Keep direct-subscription authority checks fail-closed for sponsored non-owner
  members.

## Tasks

1. Completed: add the failing capacity-growth regression.
2. Completed: apply the smallest owner-only guard correction.
3. Completed: run focused proof and inspect the complete diff.
4. Pending: complete the required ReviewGPT and CI workflow, resolve findings, and close
   this plan through `scripts/finish-task`.

## Verification

- Live Stripe subscription search confirms the Family and direct-trial
  subscriptions use distinct subscription and customer objects, and the Family
  subscription has two billed seats.
- Live Stripe events in the failure window contain the original Family checkout
  lifecycle only; no subscription update occurred during the failed add-seat
  action.
- The focused regression failed before the fix with
  `HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED` and passed after the fix.
- `hosted-family-plan.test.ts`: 173 tests passed.
- `pnpm --filter @murphai/hosted-web typecheck`: passed.
- Exact-head ReviewGPT and CI: pending.
