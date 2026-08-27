# Stripe payment notification email

Status: active
Updated: 2026-08-27

## Goal

Deliver one privacy-safe internal email for every verified positive Stripe
payment event Murph observes, including subscription starts and renewals, paid
plan change prorations, recurring or metered invoices, and one-time or
automatic usage-credit purchases.

Success means:

- the existing Stripe receipt remains the only reconciliation and retry owner;
- one logical positive payment produces one operator email across webhook
  duplication, reconciliation retry, and response loss;
- email failure cannot revoke or duplicate billing, entitlement, usage credit,
  activation wake, or provider effects;
- zero-dollar invoices and non-payment lifecycle events remain silent; and
- email content contains only amount, currency, payment category, event type,
  event time, live/test mode, and an opaque Stripe event reference.

## Scope

- In scope: positive `invoice.paid` amounts; fulfilled usage-credit Checkout
  and saved-card PaymentIntent events; the shared operational Resend transport;
  receipt-local sent state; migrations, docs, and focused proof.
- Out of scope: customer identity or contact details in email; zero-dollar
  invoices; refunds, disputes, and failed payments, which retain their existing
  owners; a plan downgrade that only schedules a future price and collects no
  money. The first later positive invoice at the downgraded price is in scope.

## Product UX Plan

Effort: Feature.

- Outcome: operators learn promptly and reliably whenever Murph receives a
  positive payment, without mistaking account activation for revenue.
- Entry and promise: a verified Stripe webhook enters the existing durable
  receipt workflow; after canonical billing or usage-credit reconciliation,
  Murph sends one plain-text operational email before completing that receipt.
- Affected people: an operator receiving the shared alert channel; a paying
  member whose payment and entitlement must remain unchanged even if operator
  email delivery retries; an existing member whose first paid subscription is
  not a new signup.
- Privacy: the operator sees the amount, currency, payment class, provider event
  reference, event time, and mode, but no member/customer identifier, contact
  detail, checkout contents, or raw provider payload.
- Recovery: configured Resend failures keep the exact Stripe receipt retryable;
  a receipt-local sent marker plus provider idempotency prevents duplicate mail
  after provider success or receipt-finalization failure. An unconfigured
  operational channel leaves the already-committed billing result intact while
  keeping notification delivery pending on that receipt until configuration is
  restored. An activation mailbox pointer is retained on that receipt in the
  activation transaction, so a rejected first wake plus a provider, marker, or
  completion failure still retries the exact target through the existing
  activation-wake owner. The notification and existing post-canonical effects
  are independent attempts within the same receipt: neither failure suppresses
  the other; an unmarked notification keeps the receipt retryable, and after it
  is marked the other effect retains its existing retry and poison behavior.
- Proof: provider-shaped positive invoice, usage Checkout, asynchronous Checkout,
  and saved-card events reach one email; zero-dollar and unrelated events do not;
  send failure retries; marked success does not resend after finalization loss.

## Plan

1. Inventory the current positive-payment event shapes and durable receipt
   completion boundary.
2. Add a narrow privacy-safe payment-email formatter/sender using the shared
   operational Resend configuration.
3. Add an additive receipt-local sent marker and send only after canonical
   payment reconciliation succeeds.
4. Add focused unit, reconciliation, schema, and migration coverage for event
   classification, privacy, retry, and replay behavior.
5. Update the live architecture, security, reliability, and Web deployment
   contract.
6. Run focused hosted-Web tests, typecheck/lint, provider and billing guards,
   exact-head CI, the preliminary Product UX/coverage ReviewGPT pass, and the
   final sensitive ReviewGPT gate.

## Deployment

Deploy the additive database column before or with the Web release. The old Web
build ignores the nullable field; the new build treats null as unsent and marks
only newly reconciled positive-payment receipts. Existing completed historical
receipts are not replayed or backfilled.

## Product UX Walkthrough

- Existing-member upgrade: a positive `subscription_update` invoice sends an
  operator email labeled `subscription change`; it does not reuse the new-signup
  label or rerun member welcome effects.
- Renewal and recurring usage: positive `subscription_cycle` and
  `subscription_threshold` invoices send `recurring subscription` and
  `recurring usage invoice` respectively.
- Usage recovery: a fulfilled synchronous or asynchronous Checkout, or the
  exact saved-card PaymentIntent owner, sends one `usage credit` email after the
  canonical grant. Runtime recheck and sponsorship work remain independent
  receipt obligations, so a failure on either side cannot suppress attempting
  the other.
- Replay and recovery: provider failure keeps delivery pending on the existing
  receipt; provider success followed by receipt-finalization loss does not
  resend because the local marker and provider idempotency converge. A first
  paid activation still receives its exact mailbox wake during an operator
  email outage; later reconciliation remains idempotent and cannot append a
  second activation.
- Privacy and absence: email includes only payment metadata and an opaque event
  reference. Zero-dollar invoices, unpaid Checkout, unrelated PaymentIntents,
  and no-charge scheduled downgrades remain silent.

The walkthrough is Ready: the plain-text output is directly asserted in unit
tests, the receipt ordering and retries are asserted in reconciliation tests,
and no visual surface or screenshot proof applies.

## Progress

- [x] Confirmed the current MRR gap came from a successful existing-member
  payment that intentionally did not qualify as a new signup.
- [x] Mapped subscription and usage-credit positive-payment event owners.
- [x] Implement the receipt-owned notification and additive migration.
- [x] Complete focused verification and the Product UX walkthrough: focused
  payment/reconciliation tests passed, migration/schema tests passed, Prisma
  validation passed, Web typecheck passed, and the full Web verifier passed
  11,199 tests across 801 files, lint with zero errors, dev smoke, and the
  production build.
- [x] Resolve the final ReviewGPT activation finding at the existing wake
  boundary: the unsent notification stage now signals every exact activation
  mailbox target before provider delivery or sent-marker persistence. Focused
  proof covers both failures, retry, and the no-duplicate-activation path.
  ReviewGPT round 2 correctly required a retrospective after the first tactical
  placement covered provider failure but not marker-write failure; the recorded
  decision moved the handoff to the whole stage boundary without adding state,
  a queue, or another owner. The separate preliminary
  suggestion to suppress later-refunded positive invoice events is intentionally
  out of scope after the operator clarified that every observed positive payment
  event should notify.
- [x] Resolve ReviewGPT round 3's overlapping-failure finding without new
  state or another owner: the existing `activationResultJson` pointer is now
  retained on the Stripe receipt in the same transaction as activation,
  canonical replay restores rather than clears it, and every positive-payment
  retry re-signals that exact target even when the email marker already exists.
  One table-driven owner test directly covers a rejected first wake combined
  independently with provider, marker, and completion failure; all three
  retries reuse the original pointer without a second activation.
- [x] Resolve ReviewGPT round 4's post-effect ordering finding without a queue,
  table, or second owner: payment notification and existing post-canonical work
  are now independent attempts in the same receipt. A usage-credit sponsorship
  failure and a terminal legacy cleanup case both prove that a successful email
  is marked first. Overlap tests prove an email outage still attempts each
  existing effect, remains notification-retryable until marked, then resumes
  the effect's original completion or poison policy without duplicating a
  refund.
- [ ] Push the exact candidate, run CI and ReviewGPT, resolve findings, and
  close the plan.
