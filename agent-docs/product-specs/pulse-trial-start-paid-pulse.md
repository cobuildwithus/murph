# Pulse Trial Start Paid Pulse

Last verified: 2026-05-06

Status: Planned

## Goal

When a Pulse Trial user runs out of included trial AI usage before the trial
calendar ends, give them a clear way to start the paid Pulse plan immediately.

The product behavior is:

- Trial usage runs out.
- The app shows a plain billing CTA: `Start Pulse plan`.
- The user confirms that their trial ends now and Pulse starts at `$8 / month`.
- Stripe ends the existing Pulse trial immediately and invoices the first paid
  Pulse month.
- Murph grants the normal paid Pulse allowance only after Stripe reconciliation
  observes the paid subscription state.

This is not an Edge upgrade path. It is an early conversion from Pulse Trial to
paid Pulse.

## Current State

Pulse Trial already exists as a checkout offer on the normal Pulse plan:

- plan: `launch_monthly`
- offer: `pulse_trial_7d`
- trial allowance: `2.50 USD` hosted AI usage
- paid Pulse allowance: `10.00 USD` hosted AI usage per month

The current exhausted-trial UX is incomplete:

- `resolveHostedAiUsageGate` returns `trial_usage_limit_reached`.
- `/home` renders a usage-limit banner for exhausted trial usage.
- The banner action currently routes to Settings.
- Settings displays trial status but does not offer a trial-to-paid action.
- The existing plan-upgrade service rejects trial users because it only supports
  paid Pulse to Edge.

That creates a dead end for a trial user who wants to pay now and keep Murph
replying.

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
- CTA: `Start Pulse plan`

Recommended confirmation dialog:

- Title: `Start Pulse plan`
- Body: `Your trial ends now. Pulse starts today at $8/month.`
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
and generates the invoice for the subscription price. Checkout Sessions collect
a payment method by default for subscription trials unless
`payment_method_collection=if_required` is set. Murph's Pulse Trial checkout
does not set `if_required`, so the normal path should already have a saved
payment method.

Relevant Stripe docs:

- Subscription trials: https://docs.stripe.com/billing/subscriptions/trials
- Update subscription API: https://docs.stripe.com/api/subscriptions/update
- Checkout free trials: https://docs.stripe.com/payments/checkout/free-trials
- Checkout Session create API: https://docs.stripe.com/api/checkout/sessions/create
- Hosted Invoice Page: https://docs.stripe.com/billing/invoices/hosted

## Backend Design

Add one target-specific route:

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
      status: "payment_required";
      billingPlanCode: "launch_monthly";
      paymentUrl: string;
    }
  | {
      status: "already_paid";
      billingPlanCode: "launch_monthly";
    };
```

Use `payment_required` only when Stripe has an invoice or hosted payment surface
for the user to complete. Otherwise return a typed retryable billing error.

## Eligibility

Local eligibility means:

- `currentBillingPlanCode` is `launch_monthly`
- `currentBillingPhase` is `trial`
- `currentCheckoutOffer` is `pulse_trial_7d`
- hosted member has active access
- hosted member is not suspended
- billing ref has Stripe customer and subscription refs

Stripe eligibility means:

- subscription customer matches the local billing ref customer
- subscription id matches the local billing ref subscription
- subscription status is `trialing`
- subscription has no `pending_update`
- subscription has no attached schedule
- subscription is not canceled, incomplete, incomplete expired, unpaid, paused,
  or past due
- subscription is the canonical Pulse subscription shape for this product

Canonical Pulse subscription shape for this MVP:

- exactly one configured Pulse recurring price
- exactly one configured Pulse metered usage price when metering is enabled
- no unknown active subscription items
- no duplicate known items
- recurring item quantity is `1`
- metered usage item has no quantity
- monthly interval only

Reject unsupported Stripe states with a safe conflict error and support-oriented
copy. Do not reinterpret Dashboard-created schedules, unknown subscription
items, cancellation flows, or dunning states in this feature.

## Service Algorithm

Add a dedicated service, for example:

```ts
async function startHostedPulseTrialPaidPlan(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedPulseTrialStartPaidResult>;
```

Algorithm:

1. Load hosted member core state and billing ref.
2. Require active, non-suspended member state.
3. Require local Pulse Trial billing state.
4. Require Stripe customer and subscription refs.
5. Load the configured Pulse recurring and usage price ids.
6. Retrieve the Stripe subscription with `items.data.price` and
   `latest_invoice` expanded.
7. Confirm the Stripe customer matches the billing ref.
8. If Stripe is already active on Pulse and local state has not caught up, run
   subscription reconciliation and return `already_paid` or `started` depending
   on the reconciled result.
9. Reject unsupported Stripe states before mutation.
10. Update the subscription with `trial_end: "now"`.
11. If Stripe returns an active paid Pulse subscription with no pending payment
    problem, run local subscription reconciliation and return `started`.
12. If Stripe returns a payment problem with a hosted invoice URL, return
    `payment_required` with that URL.
13. Otherwise return a safe retryable billing error.

The Stripe update should be small:

```ts
stripe.subscriptions.update(subscriptionId, {
  expand: ["items.data.price", "latest_invoice"],
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
- configured Pulse recurring and usage price ids

Do not include metadata in this update. If metadata needs cleanup, do it only
after Stripe shows the subscription is actually active and paid.

## Payment Behavior

Prefer `payment_behavior: "allow_incomplete"` for the first version.

Reasoning:

- It asks Stripe to attempt the transition and create the invoice.
- It lets Stripe move the subscription into a payment-needed state if the card
  fails or requires authentication.
- It keeps Murph from granting paid allowance until reconciliation sees the paid
  Stripe result.
- It avoids pending-update semantics for a command whose purpose is to end the
  trial now.

Do not use `pending_if_incomplete` in the first version. It supports
`trial_end`, but pending update expiry and metered usage behavior are more
complex than needed for trial-to-paid Pulse.

If Stripe returns a hosted invoice URL, send the user there. Stripe's Hosted
Invoice Page is the lowest-complexity payment recovery surface for this MVP.
Do not build custom Payment Element or PaymentIntent confirmation UI unless the
hosted invoice path proves insufficient.

## Local Entitlement Boundary

The switch request must not directly grant paid Pulse allowance.

It only asks Stripe to end the trial and start billing.

Local entitlement changes happen only through the existing Stripe
reconciliation path:

- `invoice.paid`
- `customer.subscription.updated`
- explicit inline reconciliation after Stripe returns an applied active
  subscription

The normal paid Pulse allowance starts only when local billing ref writes:

```txt
currentBillingPlanCode = launch_monthly
currentBillingPhase = paid
```

If payment is required or pending, the member remains in trial or blocked
billing state and the usage gate continues to deny once trial credits are
exhausted.

## Webhook And Reconciliation Requirements

The existing reconciliation path should remain the source of truth, but this
feature needs focused checks around early trial ending:

- `customer.subscription.updated` for a trialing subscription ending early must
  not grant paid allowance before payment succeeds.
- `invoice.paid` for the first non-zero Pulse invoice after an early trial end
  must write `currentBillingPhase: "paid"`.
- Reconciliation must identify Pulse from configured Pulse recurring and usage
  price ids even if historical `checkoutOffer` metadata remains
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

Use:

- title: `Trial credits are used up`
- body: `Start your Pulse plan now to keep Murph replying.`
- action: `Start Pulse plan`

Do not route exhausted trial users to Settings as the primary action.

### Settings Billing Card

For active Pulse Trial users, show:

- current plan: `Pulse trial`
- price helper: `Then $8 / month`
- action: `Start Pulse plan`

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

- usage gate still returns `trial_usage_limit_reached` when trial credits are
  exhausted
- home banner renders `Start Pulse plan` for exhausted trial credits
- home banner does not route exhausted trial users to Settings as the primary
  action
- settings renders `Start Pulse plan` for active Pulse Trial
- route accepts no command body
- route preserves origin, app-session, active-member, and suspended-member
  checks
- route rejects non-trial, non-Pulse, missing Stripe refs, inactive, and
  suspended states
- service rejects Stripe customer mismatch
- service rejects non-`trialing` Stripe subscription states before mutation
- service rejects pending updates and attached schedules
- service rejects unknown, duplicate, missing, or mismatched subscription items
- service calls Stripe subscription update with `trial_end: "now"`
- service uses a deterministic idempotency key
- service returns `payment_required` only with a Stripe payment URL
- service does not directly write paid allowance on payment-required results
- successful Stripe result reconciles to paid Pulse
- `invoice.paid` after early trial end writes paid Pulse
- `customer.subscription.updated` alone does not incorrectly grant paid
  allowance while payment is unresolved
- usage allowance remains trial-limited before payment and becomes paid Pulse
  only after reconciliation

## Stripe Sandbox Acceptance

Use a Test Clock flow:

1. Create a canonical Pulse Trial subscription through Checkout.
2. Verify the subscription is `trialing` and has the Pulse recurring and usage
   prices.
3. Simulate exhausted trial usage in local state.
4. Click `Start Pulse plan`.
5. Verify Stripe receives `trial_end=now`.
6. Verify Stripe creates the first paid Pulse invoice and starts a new billing
   period.
7. Verify successful payment produces `invoice.paid`.
8. Verify local billing ref converges to paid Pulse.
9. Verify hosted AI allowance becomes normal paid Pulse allowance.
10. Repeat with a card requiring authentication or failed payment.
11. Verify the app shows `Finish payment` and does not grant paid allowance
    until Stripe reports payment success.

## Open Question

Confirm in Stripe sandbox whether the Hosted Invoice Page is the best recovery
surface for the rare on-session authentication failure after `trial_end=now`.
If Stripe does not reliably provide a usable hosted invoice URL for that case,
the second-choice design is to return a Billing Portal session for payment
method repair while keeping entitlement closed until `invoice.paid`.
