# Suppress Stripe renewal alert emails

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Stop internal positive-payment emails for ordinary Stripe subscription
  renewals without changing renewal billing, entitlement, or recovery behavior.

## Success criteria

- `invoice.paid` events with `billing_reason: subscription_cycle` and no
  canonical billing transition complete without sending or marking an email.
- Paid trial conversions, new subscriptions, paid subscription changes,
  threshold invoices, generic invoices, and fulfilled usage-credit payments
  retain their notifications.
- Focused payment-notification and reconciliation tests pass, along with the
  hosted Web typecheck and durable-doc checks.

## Scope

- In scope: payment-notification classification, focused regression coverage,
  and live notification contract documentation.
- Out of scope: Stripe invoice reconciliation, entitlement, receipt lifecycle,
  webhook subscriptions, failure alerts, refunds, disputes, and usage credits.

## Constraints

- Technical constraints: keep the existing receipt owner and do not add state,
  configuration, or a second event path.
- Product/process constraints: preserve privacy-safe email contents for every
  category that remains eligible; ordinary renewal silence is intentional.

## Risks and mitigations

1. Risk: suppressing the whole `invoice.paid` path could skip billing or runtime
   recovery.
   Mitigation: filter only the notification candidate after canonical
   reconciliation and prove the renewal receipt still completes.
2. Risk: tests that use renewal-shaped fixtures to exercise notification retry
   behavior could stop testing their intended boundary.
   Mitigation: keep those scenarios on explicit eligible billing reasons and
   add separate receipt-level renewal-silence coverage.

## Tasks

1. Suppress a `subscription_cycle` payment-notification candidate only when the
   existing canonical billing result reports no meaningful transition.
2. Add classifier and receipt-level regression tests for both renewal silence
   and paid trial-conversion delivery while preserving retry behavior.
3. Update the live architecture, security, reliability, and Web deployment
   contracts.
4. Run focused proof, review the diff, and complete the required PR gates.

## Decisions

- Treat Stripe `billing_reason: subscription_cycle` as ambiguous provider input.
  Suppress it unless the existing invoice owner reports one transient semantic
  positive-payment transition fact. Derive that fact from direct billing/access
  transitions or the Family owner's existing billing-mode/access-restoration
  sets; operational runtime-recheck membership is never notification authority.
  Keep `subscription_threshold` notifications because they represent recurring
  usage charges rather than the base subscription renewal.
- Product UX effort: Product change. The operator receives less routine noise;
  the paying member's billing and access behavior are unchanged.
- No schema or provider-subscription change is required.

## Verification

- Commands to run:
  - focused Vitest files for payment notification and Stripe reconciliation
  - hosted Web typecheck
  - `pnpm docs:drift`
  - `git diff --check`
- Expected outcomes: no-transition renewal events complete with no email call or
  sent marker; paid trial conversions send and mark exactly once; all other
  eligible payment categories and existing receipt retry behavior remain green.

## Progress

- [x] Suppress only no-transition `subscription_cycle` notification candidates.
- [x] Preserve paid trial-conversion eligibility and add receipt-level proof for
  both conversion delivery and renewal silence.
- [x] Update the live architecture, security, reliability, and deployment docs.
- [x] Accept the ReviewGPT finding that raw `subscription_cycle` suppression
  hid paid trial conversions. The first remediation reused the runtime-recheck
  list; round two proved that operational proxy incomplete across Family replay.
- [x] Pass 111 corrected focused tests, hosted Web typecheck, focused ESLint,
  docs drift, and diff hygiene.
- [x] Record the round-two requirement-level retrospective: both prior attempts
  inferred billing semantics from incomplete proxies. Replace the wake-list
  dependency with one transient semantic outcome from the existing invoice
  owner; add no durable state or new owner.
- [x] Prove the reduced design with 180 billing/receipt tests plus all 262 Family
  owner tests, including fresh and stale Family renewal silence, direct trial
  conversion, Family billing transition, access restoration, sent-marker, and
  replay behavior.
- [x] Complete exact-head CI and the final ReviewGPT gate. All four required
  checks passed. ReviewGPT identified that a retryable provider failure after a
  newly committed transition can lose the attempt-local notification fact; the
  user explicitly accepted that notification-only edge case to avoid adding
  retained receipt state in this change.
Completed: 2026-08-30
