# Pulse Trial Start Paid Pulse

Last verified: 2026-07-25

Status: Implemented

## Goal

When a Pulse Trial user runs out of included trial AI usage before the trial
calendar ends, give them a clear way to start the paid Pulse plan immediately.

The product behavior is:

- Trial usage runs out.
- The Home banner shows a plain billing CTA: `Start Pulse`.
- The user confirms that their trial ends now and Pulse starts at `$8 / month`
  once billing is confirmed.
- Stripe ends the existing Pulse trial immediately and invoices the first paid
  Pulse month.
- Murph grants the normal paid Pulse allowance only after Stripe reconciliation
  observes the paid invoice state.

This is not an Edge upgrade path. It is an early conversion from Pulse Trial to
paid Pulse.

## Current State

Pulse Trial already exists as a checkout offer on the normal Pulse plan:

- plan: `launch_monthly`
- offer: `pulse_trial_7d`
- trial allowance: `4.50 USD` hosted AI usage
- paid Pulse allowance: `10.00 USD` hosted AI usage per month

The exhausted-trial path is implemented:

- `resolveHostedAiUsageGate` returns `allowed: false`,
  `reason: "ai_usage_limit_exceeded"`, and
  `userNotice.code: "trial_usage_limit_reached"` when trial usage is exhausted.
- `/home` renders the usage-limit banner and can call
  `POST /api/settings/billing/start-paid-pulse` through the hosted usage-limit
  action.
- Settings can also start the same flow.
- The route enforces hosted mutation-origin checks, requires the Murph hosted
  app session, rejects suspended or ineligible members, and delegates to
  `startHostedPulseTrialPaidPlan`.
- Murph grants the normal paid Pulse allowance only after Stripe reconciliation
  observes the paid invoice state.

## Product Policy

Use one CTA:

```txt
Start Pulse plan
```

Avoid copy like:

- `Upgrade to Edge`
- `Upgrade account`
- `Finish trial`
- `Finish payment`, unless Stripe has already created an invoice that requires
  payment or authentication

Recommended exhausted-trial banner:

- Title: `Trial credits are used up`
- Body: `Start your Pulse plan now to keep Murph replying.`
- CTA: `Start Pulse`

Recommended confirmation dialog:

- Title: `Start Pulse plan`
- Body: `Your trial ends now. Pulse starts at $8/month once billing is confirmed.`
- Primary action: `Start Pulse plan`
- Secondary action: `Cancel`

If Stripe returns a payment state that needs user action, the follow-up CTA can
be:

```txt
Finish payment
```

This distinction keeps the first click product-shaped and the payment-recovery
click Stripe-shaped.

## Stripe Constraints

Use the existing Stripe subscription. Do not create a second subscription, a
local trial-conversion invoice, or a local timer.

Stripe supports ending a trial early by updating the subscription with:

```ts
trial_end: "now"
```

Stripe's documented behavior is that ending a trial starts a new billing period
and generates the invoice for the subscription price. This spec uses Stripe's
legacy free-trial `trial_end` path because the existing Pulse Trial is created
through Checkout. Checkout Sessions collect a payment method by default for
subscription trials unless
`payment_method_collection=if_required` is set. Murph's Pulse Trial checkout
does not set `if_required`, so the normal path should already have a saved
payment method.

Relevant Stripe docs:

- Subscription free trials: https://docs.stripe.com/billing/subscriptions/trials/free-trials
- Update subscription API: https://docs.stripe.com/api/subscriptions/update
- Checkout free trials: https://docs.stripe.com/payments/checkout/free-trials
- Checkout Session create API: https://docs.stripe.com/api/checkout/sessions/create
- Hosted Invoice Page: https://docs.stripe.com/billing/invoices/hosted

## Backend Contract

The target-specific route is:

```txt
POST /api/settings/billing/start-paid-pulse
```

The first version accepts no request body. The route itself is the command.

The route must:

- enforce hosted mutation origin checks
- require the Murph hosted app session
- reject suspended members
- require active hosted access
- read the member billing ref
- require local Pulse Trial state
- call a dedicated trial conversion service
- return the conversion result

When the confirmed command discovers that the existing subscription has no
default payment method, the route issues a short-lived HttpOnly continuation
claim bound to the authenticated member and app session, then returns Stripe's
payment-method-update Billing Portal URL. Stripe cancel/back returns to ordinary
Settings. Only Stripe's successful flow completion returns to the marked
Settings URL, and Settings automatically repeats the protected POST after the
server validates that claim. The marker is not billing authority by itself; a
plain or forged GET must remain read-only. The first accepted automatic POST
clears the claim. Existing Stripe idempotency makes overlapping valid
continuations converge on the same subscription mutation.

Payment-method continuation is an explicit, default-off service input. The
Settings start route issues the existing session-bound `start_pulse_now`
claim; the exact-action continuation route is its sole automatic consumer.
Conversational `start_pulse_now` and `continue_pulse` calls select a
signed conversational return whose action is derived from the service's
existing transition timing. The URL contains the action, expiry, and HMAC but
no member identifier. After Stripe reports successful flow completion, an
authenticated bridge verifies the HMAC against the signed-in member and issues
the HttpOnly continuation claim bound to that member, app session, and exact
action. Cancel/back and invalid, expired, copied-to-another-member, or unsigned
returns go to ordinary Settings without a claim or subscription mutation.

The marked Settings page repeats one protected same-origin POST. That route
reads the exact action only from the bound claim and dispatches to the existing
start-now or continue-at-trial-end service; the marker and client cannot select
an action. Completed, continuing, and billing-pending results clear the claim.
If Stripe has not exposed the newly saved method yet, Settings shows a terminal
status instead of opening another automatic portal loop; an explicit retry may
reuse the still-short-lived exact-action claim and returned Stripe URL. A
surviving claim from one action can never change the other action's timing.

While the automatic continuation is starting or waiting for billing, Settings
shows one busy status and suppresses every other Start Pulse action. A terminal
automatic failure exposes one manual retry; Stripe can reopen only from that
new user click, so a propagation delay cannot create an automatic portal loop.

Suggested response:

```ts
type HostedPulseTrialStartPaidResult =
  | {
      status: "started";
      billingPlanCode: "launch_monthly";
    }
  | {
      status: "billing_pending";
      billingPlanCode: "launch_monthly";
    }
  | {
      status: "payment_required";
      billingPlanCode: "launch_monthly";
      paymentUrl: string;
    };
```

Use `payment_required` only when Stripe has an invoice or hosted payment surface
for the user to complete. Use `billing_pending` when Stripe has accepted the
trial-end request and created or opened the invoice, but automatic collection or
webhook reconciliation has not finished yet.

## Eligibility

Local eligibility means:

- `currentBillingPlanCode` is `launch_monthly`
- `currentBillingPhase` is `trial`
- `currentCheckoutOffer` is `pulse_trial_7d`
- hosted member has active access
- hosted member is not suspended
- billing ref has Stripe customer and subscription refs

Stripe mutation eligibility means:

- subscription customer matches the local billing ref customer
- subscription id matches the local billing ref subscription
- subscription status is `trialing`
- subscription has no `pending_update`
- subscription has no attached schedule
- subscription is not canceled, incomplete, incomplete expired, unpaid, paused,
  or past due
- subscription is the canonical Pulse subscription shape for this product

Stripe payment-recovery eligibility means:

- subscription customer and id still match the local billing ref
- the subscription is the same Pulse Trial subscription after a prior
  `start-paid-pulse` attempt
- Stripe shows an open or payment-needed latest invoice for the same
  subscription and customer
- the invoice exposes a usable Stripe-hosted payment URL

Payment-recovery states bypass mutation eligibility and must not call
`subscriptions.update` again.

Canonical Pulse subscription shape for this MVP:

- exactly one configured Pulse recurring price
- no unknown active licensed subscription items
- no duplicate known items
- recurring item quantity is `1`
- monthly interval only
- legacy hosted AI usage metered items with the retired usage-price marker and
  without quantities may be deleted as part of the trial-end update

Reject unsupported Stripe states with a safe conflict error and support-oriented
copy. Do not reinterpret Dashboard-created schedules, unknown subscription
items, cancellation flows, or dunning states in this feature.

For payment-recovery states, retrieve or expand the latest invoice and return
`payment_required` only when the invoice belongs to the same subscription and
customer and exposes a usable Stripe-hosted payment URL.

## Service Algorithm

The dedicated service is:

```ts
async function startHostedPulseTrialPaidPlan(input): Promise<HostedPulseTrialStartPaidResult>;
```

Algorithm:

1. Load hosted member core state and billing ref.
2. Require active, non-suspended member state.
3. Require local Pulse Trial billing state.
4. Require Stripe customer and subscription refs.
5. Load the configured Pulse recurring price id.
6. Retrieve the Stripe subscription with its customer, recurring items, and
   latest invoice expanded. Read the invoice's current allocations through
   Stripe InvoicePayments rather than the legacy single-PaymentIntent field.
7. Confirm the Stripe customer matches the billing ref.
8. Resolve one typed tender. Subscription defaults are authoritative during an
   ordinary attempt; a customer default may replace them only after the exact
   short-lived, signed Billing Portal continuation proves the user just
   completed payment-method recovery. Keep PaymentMethods (`pm_`) separate from
   legacy Sources (`card_` or `src_`).
9. If the same subscription already exposes the exact paid, actionable,
   processing, or terminal invoice from an earlier attempt, reconcile or return
   that state without starting another mutation.
10. Enter the existing member Stripe mutation lock, re-read the local owner and
    canonical Stripe subscription, and fail if either changed.
11. For an active trial, update the typed tender and `trial_end: "now"` in the
    supported subscription update, then require a new exact invoice.
12. For a paused trial, first update the subscription with
    `default_payment_method` or `default_source`, re-retrieve it, and prove the
    typed tender is attached. Then call Resume with only Resume-supported
    parameters. Never pass a tender to Resume and never call `invoices.pay`.
13. Classify the exact resulting invoice through the shared collection
    projector. A pending response must name the Stripe object, advancing event,
    and bounded deadline.
14. Before any positive local projection, reconcile current-period collection,
    successful cumulative refunds, and outstanding disputes from canonical
    Stripe objects.
15. Return `started` only after that financial guard and invoice/subscription
    reconciliation write paid Pulse. Return a Stripe-hosted recovery URL for
    payment-required states; classify voided, uncollectible, failed, expired,
    or unproved outcomes as terminal rather than indefinite pending.

The Stripe update should be small:

```ts
stripe.subscriptions.update(subscriptionId, {
  default_payment_method: tender.id, // or default_source for a legacy Source
  expand: ["customer", "items.data.price", "latest_invoice"],
  payment_behavior: "allow_incomplete",
  trial_end: "now",
}, {
  idempotencyKey,
});
```

Paused Resume is deliberately separate:

```ts
await stripe.subscriptions.update(subscriptionId, {
  default_payment_method: tender.id, // or default_source
});

await stripe.subscriptions.resume(subscriptionId, {
  billing_cycle_anchor: "now",
  expand: ["customer", "items.data.price", "latest_invoice"],
}, {
  idempotencyKey,
});
```

Each mutation key binds the member, subscription, operation, trial end, Pulse
price, and a hash of the canonical provider state immediately before that
operation. An ambiguous retry against unchanged state reuses the same key. A
voided invoice, expired pending update, changed tender, applied item state, or
other terminal provider change rotates the scope and therefore creates a new
attempt key. Do not add wall-clock entropy: that would duplicate a mutation
after a network-ambiguous commit.

The update may clear only the known trial-extension transition marker. Metadata
is routing/audit context, never collection or entitlement authority.

## Payment Behavior

Prefer `payment_behavior: "allow_incomplete"` for the first version.

Reasoning:

- It asks Stripe to attempt the transition and create the invoice.
- It lets Stripe move the subscription into a payment-needed state if the card
  fails or requires authentication.
- It keeps Murph from granting paid allowance until invoice-paid reconciliation
  proves the paid Stripe result.
- It avoids pending-update semantics for a command whose purpose is to end the
  trial now.

Do not use `pending_if_incomplete` in the first version. It supports
`trial_end`, but Stripe pending-update semantics are a worse fit for this
feature because the product intent is to end the trial now and let Stripe own
invoice collection. Pending updates also have expiry and partial-application
behavior that is more complex than needed for trial-to-paid Pulse.

Paused subscriptions use Stripe Resume after the typed tender has been attached
and verified through a normal subscription update. Resume owns automatic
invoice collection. Murph must not manually pay the new invoice, because that
would introduce a second charge attempt and a second interpretation of the
same transition.

If Stripe returns a hosted invoice URL for a payment-needed invoice, send the
user there. Stripe's Hosted Invoice Page is the lowest-complexity payment
recovery surface for this MVP. Inspect the invoice PaymentIntent status for
diagnostics and tests, but do not build custom Payment Element or PaymentIntent
confirmation UI unless the hosted invoice path proves insufficient.

## Local Entitlement Boundary

The switch request must not directly grant paid Pulse allowance.

It only asks Stripe to end the trial and start billing.

For this feature, local paid entitlement changes happen only through the
invoice-paid Stripe reconciliation path:

- `invoice.paid`
- explicit inline reconciliation of a paid, non-`subscription_create` invoice for
  the same subscription

The normal paid Pulse allowance starts only when local billing ref writes:

```txt
currentBillingPlanCode = launch_monthly
currentBillingPhase = paid
```

If payment is required or pending, the member remains in trial or blocked
billing state. A still-valid in-window trial remains subject to its enforced
included-usage limit; the crossing operation may finish, but subsequent
usage-bearing work blocks. Malformed or expired trial access continues to fail
closed until billing reconciliation advances the phase.

After local reconciliation writes paid Pulse, best-effort nudge the hosted
runner with a billing-specific context. Never nudge on `payment_required` or
`billing_pending`, and never use the nudge as entitlement proof.

## Webhook And Reconciliation Requirements

The existing reconciliation path should remain the source of truth, but this
feature needs focused checks around early trial ending:

- `customer.subscription.updated` for a trialing subscription ending early may
  refresh subscription refs and period metadata, but must not grant paid
  allowance before payment succeeds.
- `invoice.paid` for the first non-zero Pulse invoice after an early trial end
  must write `currentBillingPhase: "paid"`.
- Reconciliation must identify Pulse from configured Pulse recurring price ids
  even if historical `checkoutOffer` metadata remains
  `pulse_trial_7d`.
- Trial redemption metadata can remain for audit history; paid phase is the
  entitlement signal.
- If a payment fails, local billing status should reflect the existing
  past-due/payment-failed policy and allowance accounting should not open a paid
  Pulse period.

No new local state machine, timer, cron, or pending-conversion enum is required.

## UI Surfaces

### Home Usage-Limit Banner

For `trial_usage_limit_reached`, render the same billing button pattern as the
paid Pulse usage-limit banner, but target `start-paid-pulse`.

UI must branch on `userNotice.code`; do not add a new denied reason for
exhausted trial credits.

Use:

- title: `Trial credits are used up`
- body: `Start your Pulse plan now to keep Murph replying.`
- action: `Start Pulse`

Do not route exhausted trial users to Settings as the primary action.

### Settings Billing Card

For active Pulse Trial users, show:

- current plan: `Pulse trial`
- price helper: `Then $8 / month`
- action: `Start Pulse plan`

Settings must pass `currentCheckoutOffer` into `HostedBillingSettings` and
render `Pulse trial` only when `currentBillingPhase === "trial"` and
`currentCheckoutOffer === "pulse_trial_7d"`. Do not add a trial plan to the plan
registry.

After successful reconciliation, show normal paid Pulse:

- current plan: `Pulse`
- price helper: `$8 / month`
- paid Pulse actions, including Edge upgrade when eligible

If payment is required, show concise recovery copy:

```txt
Payment is needed to start Pulse.
```

CTA:

```txt
Finish payment
```

If payment is required only because the trial subscription has no saved payment
method, the member's existing confirmation remains the authorization to start
Pulse. Completing Stripe's payment-method form is the final required
interaction: the successful Stripe return automatically starts Pulse and shows
a short status message while billing settles. Canceling or backing out returns
to Settings without starting billing, and must not loop back into Stripe.

## Non-Goals

Do not add:

- an Edge upgrade path for exhausted trial credits
- a generic plan-switch endpoint
- a second Stripe subscription
- a separate Stripe product or price for trial conversion
- a local invoice table
- custom Payment Element UI
- a local trial-conversion state machine
- cron-based trial conversion
- runtime fallbacks that grant paid allowance before Stripe reconciliation

## Required Tests

- UX: exhausted trial usage produces `reason: "ai_usage_limit_exceeded"` with
  `userNotice.code: "trial_usage_limit_reached"`, renders `Start Pulse` on Home
  and Settings, and does not route primarily to Settings.
- Route guards: the route accepts no body and preserves origin, app-session,
  active-member, suspended-member, and local Pulse Trial eligibility checks.
- Stripe safety: the service verifies customer/subscription match, rejects
  unsupported states, schedules, and noncanonical licensed items, drops only
  marked legacy hosted AI usage metered items when present, attaches the exact
  typed tender through a supported subscription update, uses only documented
  Resume parameters, never manually pays the resulting invoice, and scopes
  each idempotency key to the canonical provider state.
- Payment recovery: `payment_required` is returned only with a Stripe-hosted
  payment URL for the same subscription/customer and never grants paid
  allowance. A missing-card Billing Portal flow uses separate cancel and
  successful-completion return URLs; conversational completion first verifies
  the short-lived member/action-bound signed return, and every automatic
  continuation requires the short-lived member/session/action-bound claim.
  A return marker without the claim performs no POST.
- Pending billing: open or created invoices awaiting automatic Stripe
  collection return `billing_pending` only with the exact awaited object,
  advancing event, and deadline; terminal invoice states never remain pending.
- Reconciliation: paid allowance opens only after a paid, non-initial invoice is
  reconciled and the canonical current-period refund/dispute guard remains
  healthy; `customer.subscription.updated` and payment failures alone remain
  denied.

## Stripe Sandbox Acceptance

Use a Test Clock flow:

1. Create a canonical Pulse Trial subscription through Checkout.
2. Verify the subscription is `trialing` and has the Pulse recurring price.
3. Simulate exhausted trial usage in local state.
4. Click `Start Pulse`.
5. For a subscription without a default payment method, complete Stripe's
   payment-method form and verify the app resumes without another click; repeat
   with cancel/back and verify no billing mutation or redirect loop occurs.
   Repeat from private-chat `start_pulse_now` and `continue_pulse` links and
   verify each resumes only its original timing; copied, expired, and tampered
   return URLs must remain inert.
6. Verify Stripe receives `trial_end=now`.
7. Verify Stripe creates the first paid Pulse invoice and starts a new billing
   period.
8. Verify the app returns `billing_pending` while the invoice is open or
   collection is awaiting Stripe.
9. Verify successful payment produces `invoice.paid`.
10. Verify local billing ref converges to paid Pulse.
11. Verify hosted AI allowance becomes normal paid Pulse allowance.
12. Repeat with a card requiring authentication or failed payment.
13. Verify the app shows `Finish payment` and does not grant paid allowance
    until Stripe reports payment success.
14. Repeat from a paused trial with the card saved only on the Customer and
    confirm Murph attaches it to the Subscription before Resume.
15. Repeat with a legacy `card_`/`src_` default and confirm it is written only
    through `default_source`.
16. Let a pending Resume expire or its invoice become void/uncollectible,
    confirm the attempt becomes terminal, then retry and confirm the provider
    state creates a fresh key without a duplicate charge.

## Recovery Surface

Use the exact Hosted Invoice Page when Stripe exposes one for the outstanding
invoice. Otherwise create a session from the dedicated payment-recovery Billing
Portal configuration. Both paths keep entitlement closed until canonical
financial reconciliation proves the current period paid and unreversed.
