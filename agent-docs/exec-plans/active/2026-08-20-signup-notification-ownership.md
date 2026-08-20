# Signup Notification Ownership

## Goal

Send the existing internal signup email exactly once from a real hosted member
activation, regardless of whether Starter enrollment, the Checkout success
return, or Stripe webhook reconciliation completes that activation first.

## Evidence

- The notification currently follows `welcomeEmailMemberId`, which is a
  member-facing email decision rather than activation proof.
- Starter enrollment and the Checkout success return can complete activation
  without invoking the internal notification.
- Standard paid Checkout can nominate a welcome email without activating a
  member, allowing an existing active member to be mislabeled as a new signup.
- Stripe's existing `activatedMemberId` also owns pending runtime-wake replay;
  a distinct transient outcome is required to prove activation happened now.
- The notification sender already owns a durable per-member attempt claim and
  a stable provider idempotency key.

## Constraints

- Add no schema, queue, scheduler, retry owner, or compatibility layer.
- Keep the internal email best-effort and outside database transactions.
- Preserve customer welcome-email behavior and the existing per-member
  notification idempotency contract.
- Do not backfill or email historical members as part of this change.
- Keep production evidence and member/provider identifiers out of repository
  artifacts.

## Plan

1. Route the notification from the existing post-commit activation outcomes in
   Starter enrollment, Checkout success, and Stripe reconciliation.
2. Stop using `welcomeEmailMemberId` as notification eligibility; include every
   distinct activated member reported by a Family Stripe outcome.
3. Add focused regression coverage for true activation, replay/idempotent
   ownership, suppressed or absent welcome email, Family activation, and the
   non-activating standard Checkout case.
4. Run focused hosted-web tests, typecheck, privacy/scope review, exact-head
   ReviewGPT gates, and required PR CI.

## Product UX

Effort: Patch.

- Outcome: operators receive one internal email for a genuine hosted signup,
  without later payments or activation-wake replays being mislabeled.
- Reaches: existing Starter, Checkout-success, and Stripe-reconciliation
  activation journeys; member-facing welcome behavior remains unchanged.
- Proof: focused owner tests distinguish newly committed activation from
  welcome-only billing and pending-wake replay, including Family activation.

## Product UX Walkthrough

- Walked Starter activation with and without a member welcome email: the
  internal email remains tied to activation and runs after commit.
- Walked Checkout success for a new activation, a welcome-only standard
  payment, and a reused pending wake: only the new activation is eligible.
- Walked webhook-only and Family activation: each newly activated member is
  eligible once, while the existing durable per-member claim deduplicates
  competing owners and replays.
- Walked provider failure and historical members: delivery remains best-effort
  with the existing provider idempotency key, and no backfill is introduced.
- Difference from plan: the implementation added an explicit transient
  `newlyActivatedMemberIds` outcome after review proved the existing runtime
  wake target was broader than a new activation.

Result: Ready.

## Verification

- Focused notification, Starter, Checkout-success, Stripe billing-event, and
  Stripe reconciliation tests passed (253 tests).
- Hosted-web typecheck passed.
- Focused ESLint and `git diff --check` passed.
- Stripe billing-event and Checkout-completion owner tests prove the transient
  new-activation outcome stays empty for later payments and pending-wake replay.

## State

Status: active
Updated: 2026-08-20
