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
      scheduledBillingPlanCode: "launch_monthly";
      effectiveAt: string;
    }
  | {
      status: "scheduled";
      scheduledBillingPlanCode: "launch_monthly";
      effectiveAt: string;
    };
```

Add a narrow eligibility helper:

```ts
function canSwitchHostedBillingPlanToPulse(input: {
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
}): boolean;
```

Eligible means:

- `currentBillingPlanCode` is `launch_edge_monthly`
- `currentBillingPhase` is `paid`
- hosted member has active access
- hosted member is not suspended
- billing ref has Stripe customer and subscription refs

Do not separately reject historical Pulse trial checkout-offer metadata when `currentBillingPhase` is `paid`. Converted trial subscriptions may preserve the historical offer, and the billing phase is the entitlement signal.

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
7. Reject if the Stripe subscription is not active, has `cancel_at_period_end`, has a pending update, or lacks a valid future current-period end.
8. Confirm the canonical Stripe items represent exactly the v1 hosted Edge subscription shape. Price ids should be treated as more authoritative than subscription metadata for plan detection.
9. Inspect the subscription's attached schedule, if any.
10. If an active app-authored schedule already switches the same subscription from Edge to Pulse at the same period end with the expected phases, persist any missing pending display fields and return `already_scheduled`.
11. If another active schedule is attached, reject with a safe "billing change already scheduled" error and direct the user to support. Do not update, release, or reinterpret Dashboard-created, Portal-created, or otherwise unknown schedules in the first version.
12. Otherwise create a subscription schedule from the subscription using `from_subscription`.
13. Retrieve the created schedule.
14. Update the schedule with all current and future phases required by Stripe:
    - current phase: Edge recurring item plus Edge metered usage item, ending at the current period end
    - next phase: Pulse recurring item plus Pulse metered usage item, starting at current period end
15. Preserve current phase or default fields from Stripe that must remain set.
16. Set `end_behavior: "release"`.
17. Set top-level schedule update `proration_behavior: "none"`.
18. Set future phase `proration_behavior: "none"`.
19. Set future phase metadata:
    - `memberId`
    - `billingPlanCode: "launch_monthly"`
    - `checkoutOffer: "standard"`
    - empty values for trial metadata keys that must be cleared
20. Store the returned schedule id and pending display fields in the local billing read model only after Stripe returns the updated schedule.

Important schedule rules:

- Include both recurring and metered usage prices in each phase.
- Do not set quantity on metered usage items.
- Do not use `end_behavior: "cancel"` for downgrades.
- Do not mutate the subscription directly while a schedule owns the pending change.
- While a switch is pending, the first version should reject additional in-app plan changes rather than trying to merge intents.
- Treat the initial request as scheduling only. It must not call the subscription event reconciler or update current entitlement fields.

First version supports only canonical hosted subscriptions with exactly the known hosted plan items:

- one configured Edge recurring price
- one configured Edge metered usage price

Reject subscriptions with unknown active items, duplicate known items, missing usage price when metering is enabled, mismatched usage type, non-month recurring intervals, or unsupported quantities. Do not silently preserve unknown add-ons into the future phase; add-on preservation can be added later as a separate plan-change capability.

Schedule creation is a two-step Stripe operation because `from_subscription` cannot be combined with phase values. The service must be retry-safe across:

- creating or idempotently recovering a schedule from the subscription
- updating the schedule with app metadata and phases
- writing local pending display fields

Use a deterministic Stripe idempotency key based on member id, subscription id, target switch, and subscription current period end.

If Stripe schedule creation succeeded but local persistence failed, a repeat request must detect the compatible attached schedule, persist the pending display fields, and return `already_scheduled`.

If schedule creation succeeded but phase update failed, a repeat request must either recover the same app-created schedule through the same idempotency key and finish the update, or reject with an operator-repair conflict. Do not leave the user behind an attached but unconfigured schedule with no recovery path.

## Local Read Model

Add only Stripe-derived pending display fields to `HostedMemberBillingRef`:

- `stripeSubscriptionScheduleLookupKey`
- `stripeSubscriptionScheduleIdEncrypted`
- `scheduledBillingPlanCode`
- `scheduledBillingEffectiveAt`

These fields are not the source of billing truth. They exist so settings can show scheduled state without querying Stripe on every request.

Clear all four fields when the matching schedule is released, completed, canceled, aborted, no longer attached, no longer compatible, or when subscription reconciliation writes the current plan as Pulse.

The current entitlement source remains:

- current Stripe subscription state
- webhook reconciliation into `currentBillingPlanCode`
- current period fields
- current billing phase

Do not add a local downgrade timer, cron, or app-owned transition state machine.

## Webhooks And Reconciliation

Entitlement changes must come from Stripe subscription reconciliation, not from the switch request.

Keep `customer.subscription.updated` and invoice reconciliation as the path that changes current plan and usage allowance.

Add subscription schedule event handling only for matching pending display cleanup and refresh:

- `subscription_schedule.released`, `subscription_schedule.completed`, `subscription_schedule.canceled`, and `subscription_schedule.aborted`: clear pending fields only when the schedule lookup key matches the local pending schedule.
- `subscription_schedule.updated`: refresh pending fields only when the lookup key already matches and the schedule still represents the same Edge-to-Pulse switch; otherwise clear pending fields.
- `subscription_schedule.created`: do not create local pending state by default. The switch request writes pending display fields, and retrying the request can self-heal if the local write failed.
- `subscription_schedule.expiring`: ignore for this feature.

When the scheduled phase starts and Stripe updates the subscription to Pulse:

- subscription reconciliation updates `currentBillingPlanCode` to `launch_monthly`
- pending schedule fields are cleared
- usage allowance resolves to Pulse
- runner nudges happen after committed entitlement change, not during the initial schedule request

Plan detection should prefer configured Stripe price ids over subscription metadata. Metadata is useful correlation, but price ids should decide the current paid plan when both are available.

Do not create local pending state from a schedule webhook based only on Stripe metadata.

This feature should update only the central subscription reconciliation needed to detect Pulse from configured recurring and usage price ids after the scheduled phase applies, even if metadata is missing or stale. Do not do a broad global plan-detection refactor in this feature.

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
- show next price from the hosted plan registry: `Then $8 / month`
- hide `Switch to Pulse`
- keep `Manage subscription` for invoices, billing details, and payment methods
- do not imply Stripe Portal can reverse or cancel the scheduled switch
- show a short support line for users who want to keep Edge

Confirmation dialog:

- follow `DESIGN.md`: cream surface, warm hairline borders, no shadow treatment, no nested cards
- use `outline` or quiet secondary styling for the switch action
- keep primary sage for forward upgrades, not for the quieter switch-to-Pulse action

Avoid adding a second complex pricing component. A flat row or short muted status line is enough.

## Reversal

Do not include in-app reversal in the first version.

If a user wants to keep Edge after scheduling the switch, direct them to support. Support releases the Stripe schedule. Pending local display fields clear only after the matching `subscription_schedule.released` webhook or manual reconciliation confirms the release.

Do not expose `Manage subscription` as the reversal path. Do not add a `Keep Edge` route until the product explicitly wants a second billing mutation.

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
- non-active Stripe subscription states reject
- `cancel_at_period_end` rejects
- pending update rejects
- missing, duplicate, unknown, or mismatched subscription items reject
- Stripe provider errors map to safe retryable errors with operation names
- schedule request does not call subscription reconciliation or write current entitlement fields
- service creates schedule from subscription with deterministic idempotency key
- service updates phases with Edge current prices and Pulse future prices
- top-level and future phase proration behavior are `none`
- retry after schedule-created/local-write-failed self-heals
- pending display fields are written only after successful schedule update
- schedule lifecycle webhooks clear or refresh only matching pending fields
- settings renders Edge, Switch to Pulse, pending switch, and Pulse after reconciliation
- `customer.subscription.updated` with Pulse price ids updates local current plan to Pulse
- usage allowance remains Edge before phase start and becomes Pulse after reconciliation

Stripe sandbox acceptance:

- create a canonical Edge test subscription with exactly Edge recurring and Edge metered usage items
- schedule switch to Pulse at period end
- verify schedule has two phases and `end_behavior: "release"`
- verify no duplicate base or usage items
- verify current-period usage bills under Edge pricing
- advance with Stripe Test Clock
- verify next period starts with Pulse recurring and Pulse usage prices
- verify schedule releases or completes and the subscription continues as Pulse
- verify webhook replay converges local settings, billing ref, and allowance

Deployment checks:

- production has both recurring price env vars
- production has both usage price env vars when Stripe metering is enabled
- webhook endpoint includes subscription and schedule events
- backend deploy lands before UI exposure
- consider a feature flag or server-side allowlist for first production test

## Open Questions

- Do existing Pulse and Edge usage prices share the same Stripe billing meter, and does test-clock usage rate exactly as expected at the phase boundary?
- Should existing one-click upgrade be simplified later so webhook reconciliation is the only entitlement write path?
