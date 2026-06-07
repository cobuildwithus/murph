# Pulse Trial Start Paid Pulse

Last verified: 2026-05-13

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
6. Retrieve the Stripe subscription with `items.data.price`, `latest_invoice`,
   and `latest_invoice.payment_intent` expanded.
7. Confirm the Stripe customer matches the billing ref.
8. If Stripe already shows a paid, non-`subscription_create` invoice for the
   same Pulse subscription, run invoice-paid reconciliation and return
   `started` only if local state becomes paid Pulse.
9. If the same subscription is already in a payment-needed state from a prior
   early-conversion attempt, return `payment_required` from the latest invoice
   hosted payment URL without mutating the subscription again.
10. Reject unsupported Stripe states before mutation.
11. Update the subscription with `trial_end: "now"`.
12. Inspect the expanded latest invoice returned by Stripe.
13. Return `started` only after invoice-paid reconciliation writes
    `currentBillingPhase: "paid"`.
14. Return `payment_required` only when the latest invoice is payable by the
    user through a Stripe-hosted URL.
15. Return `billing_pending` when Stripe has accepted the trial-end request and
    the invoice is created or open but automatic collection or webhook
    reconciliation is still pending.

The Stripe update should be small:

```ts
stripe.subscriptions.update(subscriptionId, {
  expand: ["items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
  payment_behavior: "allow_incomplete",
  trial_end: "now",
}, {
  idempotencyKey,
});
```

Use a deterministic idempotency key based on:

- member id
- Stripe subscription id
- command name, such as `start-paid-pulse`
- current trial end timestamp
- configured Pulse recurring price id

Do not include metadata in this update. If metadata needs cleanup, do it only
after invoice-paid reconciliation proves the subscription is paid.

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
billing state and the usage gate continues to deny once trial credits are
exhausted.

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
  past-due/payment-failed policy and the usage gate should not open paid Pulse
  allowance.

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
  marked legacy hosted AI usage metered items when present, and calls Stripe
  with `trial_end: "now"` plus a deterministic idempotency key.
- Payment recovery: `payment_required` is returned only with a Stripe-hosted
  payment URL for the same subscription/customer and never grants paid
  allowance.
- Pending billing: open or created invoices awaiting automatic Stripe
  collection return `billing_pending` and do not grant paid allowance.
- Reconciliation: paid allowance opens only after a paid, non-initial invoice is
  reconciled; `customer.subscription.updated` and payment failures alone remain
  denied.

## Stripe Sandbox Acceptance

Use a Test Clock flow:

1. Create a canonical Pulse Trial subscription through Checkout.
2. Verify the subscription is `trialing` and has the Pulse recurring price.
3. Simulate exhausted trial usage in local state.
4. Click `Start Pulse`.
5. Verify Stripe receives `trial_end=now`.
6. Verify Stripe creates the first paid Pulse invoice and starts a new billing
   period.
7. Verify the app returns `billing_pending` while the invoice is open or
   collection is awaiting Stripe.
8. Verify successful payment produces `invoice.paid`.
9. Verify local billing ref converges to paid Pulse.
10. Verify hosted AI allowance becomes normal paid Pulse allowance.
11. Repeat with a card requiring authentication or failed payment.
12. Verify the app shows `Finish payment` and does not grant paid allowance
    until Stripe reports payment success.

## Open Question

Confirm in Stripe sandbox whether the Hosted Invoice Page is the best recovery
surface for the rare on-session authentication failure after `trial_end=now`.
If Stripe does not reliably provide a usable hosted invoice URL for that case,
the second-choice design is to return a Billing Portal session for payment
method repair while keeping entitlement closed until `invoice.paid`.
