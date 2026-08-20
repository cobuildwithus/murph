# Signup Notification Ownership

## Goal

Send the existing internal signup email exactly once from a real hosted member
activation, regardless of whether Starter enrollment, the Checkout success
return, Stripe webhook reconciliation, or Family invite acceptance completes
that activation first.

## Evidence

- The notification currently follows `welcomeEmailMemberId`, which is a
  member-facing email decision rather than activation proof.
- Starter enrollment and the Checkout success return can complete activation
  without invoking the internal notification.
- Standard paid Checkout can nominate a welcome email without activating a
  member, allowing an existing active member to be mislabeled as a new signup.
- Stripe's existing `activatedMemberId` also owns pending runtime-wake replay;
  a distinct transient outcome is required to prove activation happened now.
- Browser, Linq, and Telegram Family invite acceptance can activate a member
  immediately under an active Family plan without any later Stripe event.
- The notification sender already owns a durable per-member attempt claim and
  a stable provider idempotency key.

## Constraints

- Add no schema, queue, durable scheduler service, retry owner, or compatibility
  layer.
- Keep the internal email best-effort and outside database transactions.
- Register one native post-response task at the first post-commit boundary so
  provider latency and later post-commit failures cannot delay or erase it.
- Reuse canonical hosted access for both live eligibility and the atomic claim;
  do not add a Family-specific branch.
- Preserve customer welcome-email behavior and the existing per-member
  notification idempotency contract.
- Do not backfill or email historical members as part of this change.
- Keep production evidence and member/provider identifiers out of repository
  artifacts.

## Plan

1. Route the notification from the existing post-commit activation outcomes in
   Starter enrollment, Checkout success, Stripe reconciliation, and Family
   invite acceptance, registering one post-response task before other fallible
   effects.
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
- Reaches: existing Starter, Checkout-success, Stripe-reconciliation, and
  browser/Linq/Telegram Family-acceptance activation journeys; member-facing
  welcome behavior remains unchanged.
- Proof: focused owner tests distinguish newly committed activation from
  welcome-only billing and pending-wake replay, including Family activation.

## Product UX Walkthrough

- Walked Starter activation with and without a member welcome email: the
  internal email remains tied to activation, registers after commit, and does
  not hold the enrollment or current-inbound path open on Resend.
- Walked Checkout success for a new activation, a welcome-only standard
  payment, and a reused pending wake: only the new activation is eligible.
- Walked webhook-only and Family activation: one task serially processes each
  distinct newly activated member, canonical Family access is accepted, and the
  existing durable per-member claim deduplicates competing owners and replays.
- Walked browser, Linq, and Telegram Family invite acceptance under an already
  active Family plan: only the callback result that says activation committed
  carries the member id to the first post-commit boundary; accepted-invite
  replays carry no notification work.
- Walked provider failure and historical members: delivery remains best-effort
  with the existing provider idempotency key, and no backfill is introduced.
- Difference from plan: the implementation added an explicit transient
  `newlyActivatedMemberIds` outcome after review proved the existing runtime
  wake target was broader than a new activation. Exact-head review then proved
  the candidate had to be registered before other post-commit effects and use
  canonical access rather than direct billing status; the remediation reuses
  native `after()` and the existing access owner without new persisted state.
  The next full audit found Family invite acceptance as a separate activation
  owner; remediation carries the same transient activation proof through the
  three existing acceptance paths without adding another sender or state owner.

Result: Ready.

## Verification

- Focused notification, member-store, Starter, Checkout-success, Family,
  browser/Linq/Telegram Family acceptance, Stripe billing-event, and Stripe
  reconciliation tests passed (854 tests across 10 files).
- Hosted-web typecheck passed.
- Focused ESLint and `git diff --check` passed.
- Stripe billing-event and Checkout-completion owner tests prove the transient
  new-activation outcome stays empty for later payments and pending-wake replay.
- Sender/claim tests prove canonical Family access and one atomic attempt gate;
  scheduler coverage proves one deduplicated task with provider concurrency one.
- Checkout cleanup and Stripe runtime-recheck recovery tests prove registration
  happens before later failure and is not repeated by activation replay.
- Browser Family acceptance plus Linq and Telegram dispatch coverage proves
  first-activation registration, replay suppression, and registration before
  fallible wake or confirmation work.

## State

Status: active
Updated: 2026-08-20
