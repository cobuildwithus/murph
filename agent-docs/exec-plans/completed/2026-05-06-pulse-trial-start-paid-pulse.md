# Pulse Trial Start Paid Pulse

Status: completed
Created: 2026-05-06
Updated: 2026-05-07

## Goal

- Implement the planned exhausted Pulse Trial conversion flow from
  `agent-docs/product-specs/pulse-trial-start-paid-pulse.md`.
- A trial user who exhausts included AI credits sees `Start Pulse plan`, can end
  the existing Pulse trial through Stripe, and receives paid Pulse allowance
  only after paid invoice reconciliation.

## Success criteria

- Home exhausted-trial banner uses `Start Pulse plan` and no longer routes
  primarily to Settings.
- Settings shows active Pulse Trial state and the same start-paid-Pulse action.
- A target-specific no-body route starts paid Pulse for eligible trial users.
- The service uses the existing Stripe subscription with `trial_end: "now"`,
  handles `started`, `billing_pending`, and `payment_required`, and does not
  grant paid allowance before paid invoice reconciliation.
- Focused tests cover route guards, service Stripe states, UI surfaces, and
  reconciliation/allowance boundaries.

## Scope

- In scope: `apps/web` billing route/service/UI/tests for exhausted Pulse Trial
  to paid Pulse.
- Out of scope: Edge upgrades, generic plan switching, Stripe schedules, custom
  Payment Element UI, DB schema changes unless implementation proves they are
  unavoidable.

## Constraints

- Technical constraints: Stripe remains billing authority; local entitlement
  changes only after paid invoice reconciliation; no runtime fallback.
- Product/process constraints: preserve unrelated dirty worktree edits and keep
  copy calm and billing-specific.

## Risks and mitigations

1. Risk: Granting paid Pulse on subscription `active` before invoice payment.
   Mitigation: Require paid non-initial invoice reconciliation for entitlement.
2. Risk: Failed payment repeat click gets rejected as non-trialing.
   Mitigation: Add explicit payment-recovery path that returns the latest
   Stripe-hosted payment URL without mutating again.
3. Risk: UI introduces Edge framing for trial exhaustion.
   Mitigation: Use `Start Pulse plan` copy and a dedicated Pulse Trial action.

## Tasks

1. Inspect current usage gate, billing service, route, settings, and tests.
2. Add trial-to-paid service and no-body route.
3. Update Home and Settings UI actions/copy.
4. Add focused service, route, UI, and reconciliation/allowance tests.
5. Run focused verification, lint/typecheck, and completion audit.

## Decisions

- Use the existing Stripe subscription and `trial_end: "now"`.
- Keep paid entitlement gated on `invoice.paid`/paid-invoice reconciliation.
- Return `billing_pending` for normal invoice/collection delay.

## Verification

- Commands to run: focused hosted billing/UI Vitest files, `pnpm --dir apps/web
  lint`, `pnpm --dir apps/web typecheck`, and `git diff --check`.
- Expected outcomes: focused tests pass; lint/typecheck pass or unrelated
  blockers are isolated with evidence.
Completed: 2026-05-07
