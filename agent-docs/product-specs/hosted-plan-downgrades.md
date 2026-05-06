# Hosted Plan Downgrades

Last verified: 2026-05-06

## Goal

Add a clean Edge-to-Pulse plan switch that relies on Stripe for billing state, timing, invoices, and future subscription changes.

The product behavior is:

- Edge users can switch to Pulse from settings.
- The switch is scheduled for the next renewal, not applied immediately.
- Edge access remains active through the current paid billing period.
- Pulse access begins only after Stripe applies the scheduled phase.
- Murph stores only a small Stripe-derived read model for display and reconciliation.

## Current State

The app currently supports only Pulse-to-Edge in-app upgrades.

- `POST /api/settings/billing/upgrade-plan` accepts only `launch_edge_monthly`.
- `upgradeHostedBillingPlan` is upgrade-shaped and only permits `launch_monthly -> launch_edge_monthly`.
- `/settings` computes and renders only `canUpgradeToEdge`.
- `Manage subscription` opens Stripe Customer Portal for payment methods, invoices, and other Stripe-managed account work.

There is no explicit app-owned Edge-to-Pulse path today.

## First-Version Scope

Keep the first version intentionally narrow.

Build exactly one transition:

- Edge paid subscription to Pulse at renewal.

Do not build:

- a generic plan-transition engine
- arbitrary `targetPlanCode` routing
- in-app schedule reversal
- Customer Portal plan switching
- local timers or cron-based entitlement changes

Future plan changes can generalize after this path is proven in Stripe test clocks and production.

## Stripe Constraints

Use Stripe as the source of truth, but do not use Customer Portal plan switching for this plan switch.

Stripe Customer Portal supports scheduled downgrades in general, but current Stripe docs say subscriptions using usage-based billing can be canceled in the portal but cannot be updated there. Murph plans include a recurring item and a metered usage item, so Portal subscription updates are not a clean fit.

`subscription_update_confirm` is also not a fit because Stripe currently allows only one item in that flow and says subscriptions with multiple items cannot be updated through it.

Stripe Subscription Schedules are the correct Stripe-owned primitive for this behavior. They are designed for future subscription changes, including downgrades, and phase metadata updates the underlying subscription metadata when a phase starts.

Relevant Stripe docs:

- Customer Portal configuration: https://docs.stripe.com/customer-management/configure-portal
- Customer Portal limitations: https://docs.stripe.com/customer-management
- Portal deep links: https://docs.stripe.com/customer-management/portal-deep-links
- Subscription schedules: https://docs.stripe.com/billing/subscriptions/subscription-schedules

## Product Policy

Supported transition:

- `launch_edge_monthly -> launch_monthly`

Unsupported transitions:

- Pulse to Pulse
- Edge to Edge
- trial-state switches
- switches without a Stripe customer and subscription
- switches while a conflicting Stripe schedule is already attached

Downgrade timing:

- Always schedule at current period end.
- Do not issue immediate prorated credits or immediate allowance reductions.
- Do not reduce usage allowance until Stripe applies the Pulse phase and the webhook reconciliation updates the local billing read model.

User-facing language:

- Prefer "Switch to Pulse" over "Downgrade."
- Confirmation title: "Switch to Pulse at renewal."
- Confirmation body: "You will keep Edge until <date>. Pulse starts after this billing period at $8/month."
- Pending state: "Pulse starts on <date>. Edge remains active until then."

## Backend Design

Add a single-purpose route:

```txt
POST /api/settings/billing/switch-to-pulse
```

The first version does not need a request body. The route itself is the command.

The route must:

- enforce hosted mutation origin checks
- require the Murph hosted app session
- reject suspended members
- read the member billing ref
- validate Edge-to-Pulse eligibility
- call the billing schedule service
- return scheduled switch state

Suggested response:

```ts
type HostedBillingPlanSwitchResult =
  | {
      status: "already_scheduled";
      currentPlanCode: "launch_edge_monthly";
      scheduledPlanCode: "launch_monthly";
      effectiveAt: string;
    }
  | {
      status: "scheduled";
      currentPlanCode: "launch_edge_monthly";
      scheduledPlanCode: "launch_monthly";
      effectiveAt: string;
    };
```

Add a narrow eligibility helper:

```ts
function canSwitchHostedBillingPlanToPulse(input: {
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
}): boolean;
```

Eligible means:

- `currentBillingPlanCode` is `launch_edge_monthly`
- `currentBillingPhase` is `paid`
- current state is not a Pulse trial state

The service should still verify Stripe directly before scheduling. Local eligibility is a display and early-reject hint, not the final authority.

## Stripe Schedule Service

Implement a dedicated service instead of extending the existing upgrade-shaped service with broad transition logic.

Suggested service:

```ts
async function scheduleHostedBillingPlanSwitchToPulse(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedBillingPlanSwitchResult>;
```

Algorithm:

1. Load member core state and billing ref.
2. Require active access and paid Edge local state.
3. Require Stripe customer and subscription ids.
4. Load Stripe plan config for Edge and Pulse, including recurring and usage price ids.
5. Retrieve the Stripe subscription with `items.data.price` expanded.
6. Confirm the subscription customer matches the billing ref customer.
7. Confirm the canonical Stripe items represent Edge. Price ids should be treated as more authoritative than subscription metadata for plan detection.
8. Inspect the subscription's attached schedule, if any.
9. If an active compatible schedule already switches Edge to Pulse at the same period end, return `already_scheduled`.
10. If another active schedule is attached, reject with a safe "billing change already scheduled" error and direct the user to support or Stripe management. Do not merge app intent into an unknown schedule.
11. Otherwise create a subscription schedule from the subscription using `from_subscription`.
12. Update the schedule with two phases:
    - current phase: Edge recurring item plus Edge metered usage item, ending at the current period end
    - next phase: Pulse recurring item plus Pulse metered usage item, starting at current period end
13. Set `end_behavior: "release"`.
14. Set future phase `proration_behavior: "none"`.
15. Set future phase metadata:
    - `memberId`
    - `billingPlanCode: "launch_monthly"`
    - `checkoutOffer: "standard"`
    - empty values for trial metadata keys that must be cleared
16. Store the returned schedule id and pending display fields in the local billing read model.

Important schedule rules:

- Include both recurring and metered usage prices in each phase.
- Do not set quantity on metered usage items.
- Do not use `end_behavior: "cancel"` for downgrades.
- Do not mutate the subscription directly while a schedule owns the pending change.
- While a switch is pending, the first version should reject additional in-app plan changes rather than trying to merge intents.
- Treat the initial request as scheduling only. It must not call the subscription event reconciler or update current entitlement fields.

## Local Read Model

Add only Stripe-derived pending display fields to `HostedMemberBillingRef`:

- `stripeSubscriptionScheduleLookupKey`
- `stripeSubscriptionScheduleIdEncrypted`
- `scheduledBillingPlanCode`
- `scheduledBillingEffectiveAt`

These fields are not the source of billing truth. They exist so settings can show scheduled state without querying Stripe on every request.

The current entitlement source remains:

- current Stripe subscription state
- webhook reconciliation into `currentBillingPlanCode`
- current period fields
- current billing phase

Do not add a local downgrade timer, cron, or app-owned transition state machine.

## Webhooks And Reconciliation

Entitlement changes must come from Stripe subscription reconciliation, not from the switch request.

Keep `customer.subscription.updated` and invoice reconciliation as the path that changes current plan and usage allowance.

Add subscription schedule event handling only for pending display state:

- `subscription_schedule.created`
- `subscription_schedule.updated`
- `subscription_schedule.released`
- `subscription_schedule.completed`
- `subscription_schedule.canceled`
- `subscription_schedule.aborted`

When the scheduled phase starts and Stripe updates the subscription to Pulse:

- subscription reconciliation updates `currentBillingPlanCode` to `launch_monthly`
- pending schedule fields are cleared
- usage allowance resolves to Pulse
- runner nudges happen after committed entitlement change, not during the initial schedule request

Plan detection should prefer configured Stripe price ids over subscription metadata. Metadata is useful correlation, but price ids should decide the current paid plan when both are available.

## Settings UI

The Billing card should stay a single calm summary surface.

When current plan is Edge and no switch is pending:

- show current plan: Edge
- show price: `$20 / month`
- show action: `Switch to Pulse`
- keep `Manage subscription`

When switch is pending:

- show current plan: Edge
- show status: `Pulse starts on <date>. Edge remains active until then.`
- show next price: `Then $8 / month`
- hide `Switch to Pulse`
- keep `Manage subscription`

Confirmation dialog:

- follow `DESIGN.md`: cream surface, warm hairline borders, no shadow treatment, no nested cards
- use `outline` or quiet secondary styling for the switch action
- keep primary sage for forward upgrades, not for the quieter switch-to-Pulse action

Avoid adding a second complex pricing component. A flat row or short muted status line is enough.

## Reversal

Do not include in-app reversal in the first version.

If a user wants to keep Edge after scheduling the switch, direct them to support or Stripe management. A later in-app reversal can be added only after the schedule path is proven. That later reversal must release the Stripe schedule and clear local pending display fields only after Stripe confirms the release.

## Verification

Unit and integration tests:

- route schedules Edge-to-Pulse without accepting arbitrary target plans
- route preserves CSRF, auth, and suspended-member checks
- service creates a schedule from the active subscription
- schedule phases include both recurring and metered usage prices
- metered item has no quantity
- future phase metadata sets Pulse and clears trial metadata
- duplicate request returns `already_scheduled`
- conflicting attached schedule rejects without mutation
- customer mismatch rejects
- missing Stripe refs reject
- trial state rejects
- Stripe provider errors map to safe retryable errors with operation names
- schedule request does not call subscription reconciliation or write current entitlement fields
- settings renders Edge, Switch to Pulse, pending switch, and Pulse after reconciliation
- `customer.subscription.updated` with Pulse price ids updates local current plan to Pulse
- out-of-order older Stripe events do not overwrite fresher billing state
- usage allowance remains Edge before phase start and becomes Pulse after reconciliation

Stripe sandbox acceptance:

- create an Edge test subscription with recurring and metered usage items
- schedule switch to Pulse at period end
- verify no duplicate base or usage items
- verify current-period usage bills under Edge pricing
- advance with Stripe Test Clock
- verify next period starts with Pulse recurring and Pulse usage prices
- verify webhook replay converges local settings and allowance

Deployment checks:

- production has both recurring price env vars
- production has both usage price env vars when Stripe metering is enabled
- webhook endpoint includes subscription and schedule events
- backend deploy lands before UI exposure
- consider a feature flag or server-side allowlist for first production test

## Open Questions

- Do existing Pulse and Edge usage prices share the same Stripe billing meter, and does test-clock usage rate exactly as expected at the phase boundary?
- Should existing one-click upgrade be simplified later so webhook reconciliation is the only entitlement write path?
- Should plan detection be changed globally to prefer Stripe price ids over metadata as a prerequisite to implementing scheduled switches?
