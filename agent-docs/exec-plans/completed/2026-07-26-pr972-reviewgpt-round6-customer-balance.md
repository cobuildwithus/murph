# PR 972 ReviewGPT Round 6 Customer-Balance Provenance

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Keep Stripe customer-balance credit from an immediate Family reduction valid
  for a later current-period seat or tier increase.
- Pause the Family automatically when a required later invoice consumed that
  credit and the original payment that created the reduction credit is then
  fully refunded.

## Required Retrospective

Round 5 selected immediate `always_invoice` writes for every aggregate Family
quantity change so Stripe, rather than local state, owns the complete economic
chronology. That correction made a reduction credit available on the Customer
invoice balance. Round 6 proved that the recurring financial reader still
consumed only direct InvoicePayment allocations: a later positive invoice paid
entirely from the carried balance had no direct charge reference, so refunding
the original growth payment did not revoke the re-established entitlement.

The requirement-level decision is that a Family reduction credit remains valid
paid authority while the payment credited by that reduction remains valid. A
full refund of the source payment invalidates the carried value. When Stripe's
aggregate Customer balance later applies that value to a required entitlement
invoice, Murph must fail closed because Stripe does not assign individual
credit-source buckets within the balance.

The selected correction extends the existing bounded Stripe read with the two
canonical provider edges already emitted by Stripe:

1. A reduction proration line names the original credited invoice.
2. The immutable CustomerBalanceTransaction ledger names each invoice that
   creates, applies, or reverses Customer invoice balance.

No local provenance table, metadata protocol, queue, or additional state owner
is added. Within a same-second or mixed-credit ambiguity, invalid Family credit
is consumed first so reconciliation cannot preserve entitlement on value that
may already have been returned.

## Scope

- Add a provider-faithful recurring-financial regression for paid growth,
  immediate reduction credit, balance-funded re-establishment with no positive
  InvoicePayment, and a full source-charge refund.
- Read a bounded current-period Customer balance ledger only when a fully
  refunded invoice is the credited source of a Family reduction.
- Attribute invalid carried credit conservatively through applications and
  reversals, and block a required invoice that consumes it.
- Keep unrelated Customer balance adjustments valid and preserve direct-charge
  refund and dispute behavior.
- Update the durable Family billing contract and PR retrospective evidence.

## Constraints

- Stripe remains the only provider-side financial source of truth.
- Preserve immediate downgrade/reduction credit UX and payment-gated positive
  changes.
- Do not add persisted provenance or another reconciliation owner.
- Keep reads and replay explicitly bounded and fail closed on ambiguous invalid
  funding.
- Do not start a later ReviewGPT round until the round-6 remediation head is
  committed, pushed, and verified.

## Verification Plan

1. Focused recurring-financial lookup tests, including partial-refund and
   ledger-reversal controls.
2. Scoped lint/typecheck and `git diff --check`.
3. Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
4. Inspect the exact pushed diff and update PR #972 with the retrospective,
   customer-balance affected surface, verification proof, and current review
   status.

## Outcome

- Round 6 returned `RETROSPECTIVE_REQUIRED` on head `692bdc67` with one high,
  review-induced finding: a balance-funded re-establishment lost the refund
  provenance of the payment that created its reduction credit.
- The requirement decision preserves immediate reduction credit as valid paid
  authority only while its credited source payment remains valid. A fully
  refunded source taints its carried value; required entitlement invoices that
  retain that value fail closed.
- The recurring financial reader now follows Stripe's credited-invoice edge
  and bounded CustomerBalanceTransaction ledger only when a fully refunded
  source makes that proof necessary. No local provenance state was added.
- Provider-faithful regressions cover partial refund, full refund, and balance
  unapplication followed by fresh direct payment.

## Verification Evidence

- Focused Stripe lookup suite: 62 tests passed.
- Focused four-file web suite: 325 tests passed.
- Prepared web typecheck, scoped ESLint, and `git diff --check`: passed.
- Canonical `pnpm test:diff`: passed in Blacksmith Testbox
  `tbx_01kygs4g3g0gx8k7wqceqbh29j`.
- Canonical `pnpm verify:acceptance`: passed in Blacksmith Testbox
  `tbx_01kygs8vaqe1djbcyerr0c2shy`, including the web production build and
  workspace/app verification.
Completed: 2026-07-26
