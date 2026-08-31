# Suppress Stripe renewal alert emails

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Stop internal positive-payment emails for ordinary Stripe subscription
  renewals without changing renewal billing, entitlement, or recovery behavior.

## Success criteria

- `invoice.paid` events with `billing_reason: subscription_cycle` produce no
  payment-notification candidate and complete their receipt without sending or
  marking an email.
- New subscriptions, paid subscription changes, threshold invoices, generic
  invoices, and fulfilled usage-credit payments retain their notifications.
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

1. Map `subscription_cycle` to no payment-notification candidate.
2. Add classifier and receipt-level regression tests while preserving coverage
   for eligible invoice categories and retry behavior.
3. Update the live architecture, security, reliability, and Web deployment
   contracts.
4. Run focused proof, review the diff, and complete the required PR gates.

## Decisions

- Treat every Stripe `billing_reason: subscription_cycle` invoice as silent
  notification input. Do not add transition exceptions or cross-receipt state;
  keep `subscription_threshold` notifications because they represent recurring
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
- Expected outcomes: renewal events complete with no email call or sent marker;
  all eligible payment categories and existing receipt retry behavior remain
  green.

## Progress

- [x] Suppress `subscription_cycle` notification candidates.
- [x] Preserve explicit eligible-invoice coverage and add renewal-silence proof.
- [x] Update the live architecture, security, reliability, and deployment docs.
- [x] Pass 109 focused tests, hosted Web typecheck, focused ESLint, docs drift,
  and diff hygiene.
- [x] Record the deletion-first anomaly retrospective and return the reduced
  candidate to exact-head CI and the final ReviewGPT gate.
