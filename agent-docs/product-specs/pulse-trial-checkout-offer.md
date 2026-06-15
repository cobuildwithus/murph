# Pulse Trial Checkout Offer Implementation Plan

Last verified: 2026-05-05

Status: Implemented locally

## Purpose

This plan specifies how to add a seven-day Pulse Trial on top of the current hosted Murph billing and hosted AI usage allowance system.

The durable decision is:

```ts
HostedBillingPlanCode = "launch_monthly" | "launch_edge_monthly";

HostedBillingCheckoutOffer =
  | "standard"
  | "pulse_trial_7d";
```

Pulse Trial is a checkout offer for Pulse. It is not a third hosted plan, not a free plan, and not a separate usage-budget system.

Success means:

- The hosted plan registry still has only Pulse and Edge.
- The join page no longer presents self-hosted Murph as a hosted "Free" plan.
- The Pulse Trial CTA creates a Stripe Checkout subscription for the existing Pulse price with a seven-day trial.
- Trial activation is metadata-gated and idempotent.
- The hosted billing ref records the current billing phase and trial boundaries.
- The existing hosted AI usage allowance resolver returns a 4.50 USD trial allowance during the trial and the normal Pulse allowance after Stripe converts the subscription to a paid cycle.
- A stale trial phase never falls back to the normal monthly Pulse allowance.
- No Cloudflare/runtime enforcement wiring is added by this plan. Cloudflare already checks the signed web usage gate before hosted runner invocation, so this plan treats the web gate response shape, denial reason, notice, and `retryAfter` as runtime-facing API.
- No-card auto Pulse Trial enrollment is the default hosted signup path when billing is configured and messaging setup is complete. Set `HOSTED_AUTO_PULSE_TRIAL_ENABLED=0` only to force card checkout fallback.
- The card-based trial CTA is release-gated by `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED=1`; the checkout backend remains safe with the flag off.

## Clean Target Model

Keep the implementation in three layers:

1. Product plan: Pulse and Edge only. This controls Stripe prices and normal monthly hosted AI allowance.
2. Checkout offer: `standard` or `pulse_trial_7d`. This controls Checkout Session construction and Stripe metadata.
3. Billing phase: `trial` or `paid`. This is persisted on the current billing ref and is the only phase signal the allowance resolver trusts.

The runtime allowance path should not call Stripe, parse Checkout metadata, or infer trial state from price ids. It should read the hosted member's persisted billing ref and fail closed when the phase fields are missing or inconsistent for a trial offer.

The core state machine is:

| Event | Current state | New state | Notes |
| --- | --- | --- | --- |
| Standard Checkout completed | inactive/incomplete | unchanged entitlement | Bind refs only; paid activation still waits for `invoice.paid`. |
| Pulse Trial Checkout completed | inactive/incomplete | active + `trial` | Only after metadata, ownership, subscription, and freshness checks pass. |
| Initial zero-dollar trial invoice paid | active + `trial` | active + `trial` | Ignore for paid entitlement and paid allowance. |
| Trial subscription update reports `active` before paid invoice | active + `trial` | active + `trial` | Refresh matching refs/dates only; do not promote phase. |
| First real paid invoice after trial | active + `trial` or inactive | active + `paid` | This is the only trial-to-paid transition. |
| Standard paid invoice | inactive/incomplete | active + `paid` | Existing paid behavior continues. |
| Payment failure, cancellation, unpaid, paused, or past due | active | existing inactive policy + no paid allowance | Preserve immutable trial-redemption fields. |
| Usage gate during expired stale trial | active + `trial` | deny | No calendar fallback, no monthly Pulse allowance. |

This lets the implementation avoid a background trial-expiration job. Stripe webhooks reconcile the billing result, while the usage gate denies stale trial access at decision time.

Stress testing produced four final hardening decisions that are part of the target shape:

- Billing phase is authoritative for usage allowance. `currentBillingPhase === "paid"` receives the normal paid plan allowance even if `currentCheckoutOffer` remains `pulse_trial_7d` for audit history.
- Trial allowance periods do not receive calendar fallback carryover, and denied stale-trial usage imports are marked as allowance-denied instead of remaining invisible.
- A delayed trial Checkout completion cannot overwrite an already paid phase or a redeemed trial marker.
- A later standard Pulse subscription after a canceled/redeemed trial is treated as standard paid billing when its current offer/subscription prove it is not the original trial conversion.

## Implemented Local Baseline

The current local checkout now has the Pulse Trial shape implemented on that foundation:

- `apps/web/src/lib/hosted-onboarding/billing-plans.ts` defines only `launch_monthly` and `launch_edge_monthly`.
- `billing-plans.ts` stores included hosted AI usage allowances by plan: Pulse is 10.00 USD micros and Edge is 25.00 USD micros.
- `apps/web/src/lib/hosted-onboarding/billing-service.ts` creates Stripe Checkout Sessions in `subscription` mode with the plan recurring line item, session metadata, subscription metadata, card payment methods, and a deterministic Stripe idempotency key that includes the checkout offer and trial policy inputs.
- `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts` binds Stripe customer/subscription refs on standard `checkout.session.completed`, activates paid subscriptions from `invoice.paid`, records subscription period markers from subscription events, and has one metadata-gated Pulse Trial activation path for Stripe trialing subscriptions.
- `apps/web/src/lib/hosted-onboarding/stripe-billing-status.ts` deliberately keeps subscription webhook writes conservative: Stripe `trialing` maps to hosted `active`, but subscription events that would make an inactive Murph member active are written as `incomplete` unless the member was already active.
- `apps/web/prisma/schema.prisma` has `HostedMemberBillingRef` with Stripe customer/subscription refs, current plan code, current period start/end, current billing phase, current checkout offer, immutable trial redemption metadata, trial start/end markers, and last Stripe event freshness.
- `apps/web/src/lib/hosted-execution/usage-allowance.ts` prices imported platform AI usage, skips member-provided credentials for allowance spend, maintains `HostedAiUsagePeriod`, resolves trial allowances from persisted trial state, and denies stale/malformed trial state instead of using the calendar-month fallback.
- `apps/web/app/api/internal/hosted-execution/usage/gate/route.ts` exposes the allowance decision over a signed internal web callback, and `apps/cloudflare/src/user-runner.ts` calls that gate before starting hosted workspace invocation.
- `apps/web/src/components/hosted-onboarding/join-invite-stage-server.tsx` renders Pulse Trial, Pulse, and Edge as the pricing grid; the self-hosting GitHub link is secondary below the grid.

## External Stripe Constraints

Use only stable, non-preview Stripe subscription and Checkout behavior:

- Stripe Checkout Session creation supports `mode: "subscription"` and `subscription_data.trial_period_days`.
- Stripe subscriptions can start with trial days, and Stripe creates a zero-dollar trial invoice while delaying the first paid invoice until trial end.
- Stripe Checkout in subscription mode saves the payment method by default, which is the desired behavior for automatic Pulse conversion.
- Stripe recommends webhook-backed fulfillment, with the landing/success page used as an immediate reconciliation path rather than the only source of truth.
- Stripe idempotency keys compare request parameters for a key, so trial and standard checkout requests must not share the same idempotency key.

References:

- Stripe Checkout Session API: https://docs.stripe.com/api/checkout/sessions/create
- Stripe subscription trials: https://docs.stripe.com/billing/subscriptions/trials
- Stripe Checkout fulfillment: https://docs.stripe.com/checkout/fulfillment
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests

## Non-Goals

Do not add:

- `free`, `trial`, or `launch_trial_monthly` to `HOSTED_BILLING_PLAN_CODES`.
- A separate Stripe product for the trial.
- A separate Stripe price for the trial.
- A separate usage-budget table.
- A separate hosted entitlement system.
- Runtime usage-gate enforcement wiring in Cloudflare or assistant runtime. Existing Cloudflare gate enforcement is in scope only as a contract to preserve and test.
- A no-payment-method trial flow. Keep card collection up front so the trial can convert automatically.
- A cron or queue whose only job is to expire trials. Stale trial denial belongs in the allowance resolver; Stripe webhook reconciliation handles conversion or failure.

## Product Surface

### Join Page

Replace the current self-hosted "Free" card with a Pulse Trial card:

- Name: `Pulse Trial`
- Price: `$0 for 7 days`
- Price detail: `Then $8/month`
- Billing disclosure: `Card required. Then $8/month unless canceled.`
- CTA: `Start 7-day trial`

Keep the existing Pulse and Edge paid cards:

- Pulse standard checkout remains immediate `$8/month`.
- Edge standard checkout remains immediate `$20/month`.

Move the GitHub/self-hosting CTA below the pricing grid as a secondary text link:

```md
Want to self-host? View Murph on GitHub.
```

The product reason is that self-hosted Murph is still visible, but it is no longer presented as a hosted onboarding plan.

Keep the copy factual rather than promotional: state duration, card requirement, post-trial price, cancellation implication, and hosted AI allowance plainly. Do not reintroduce a hosted "Free" plan label.

Render the card-based trial CTA only as enabled when `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED=1`. The checkout service also enforces the same flag server-side, so a crafted request cannot start a card-based trial checkout while rollout is disabled.

### Client/API Shape

Keep the public checkout request narrow. The browser should only send a checkout offer for the trial case:

```ts
interface HostedBillingCheckoutRequest {
  billingPlanCode?: HostedBillingPlanCode;
  checkoutOffer?: "pulse_trial_7d";
  inviteCode: string;
}
```

The server resolves missing `checkoutOffer` to the internal `standard` offer before metadata/idempotency construction. This preserves existing clients and prevents a plain Pulse checkout request from silently becoming a trial. Do not require or encourage clients to send `checkoutOffer: "standard"`.

The trial CTA must explicitly send:

```ts
{
  billingPlanCode: "launch_monthly",
  checkoutOffer: "pulse_trial_7d",
}
```

Reject unsupported combinations:

| Plan | Offer | Result |
| --- | --- | --- |
| `launch_monthly` | missing | Immediate Pulse checkout |
| `launch_monthly` | `pulse_trial_7d` | Seven-day Pulse Trial checkout |
| `launch_edge_monthly` | missing | Immediate Edge checkout |
| `launch_edge_monthly` | `pulse_trial_7d` | Reject with a typed 400-class checkout error |

Reject `checkoutOffer: "standard"` at the public route if it is sent explicitly. `standard` is an internal resolved value and Stripe metadata value, not a public browser API option.

## Durable Types And Constants

Add small offer and phase primitives near the existing billing-plan module unless the implementation discovers a stronger local owner:

```ts
export const HOSTED_PUBLIC_BILLING_CHECKOUT_OFFERS = [
  "pulse_trial_7d",
] as const;

export type HostedPublicBillingCheckoutOffer =
  (typeof HOSTED_PUBLIC_BILLING_CHECKOUT_OFFERS)[number];

export const HOSTED_INTERNAL_BILLING_CHECKOUT_OFFERS = [
  "standard",
  "pulse_trial_7d",
] as const;

export type HostedBillingCheckoutOffer =
  (typeof HOSTED_INTERNAL_BILLING_CHECKOUT_OFFERS)[number];

export const HOSTED_BILLING_PHASES = [
  "trial",
  "paid",
] as const;

export type HostedBillingPhase = (typeof HOSTED_BILLING_PHASES)[number];

export const HOSTED_PULSE_TRIAL_OFFER = "pulse_trial_7d" as const;
export const HOSTED_PULSE_TRIAL_DAYS = 7;
export const HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS = 4_500_000n;
export const HOSTED_PULSE_TRIAL_POLICY_VERSION =
  "pulse-trial-2026-05-05-v1";

export const HOSTED_PULSE_TRIAL_POLICIES = {
  [HOSTED_PULSE_TRIAL_POLICY_VERSION]: {
    durationDays: HOSTED_PULSE_TRIAL_DAYS,
    usageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  },
} as const;
```

Keep the offer registry separate from `HOSTED_BILLING_PLAN_CODES` so every plan-dependent call site continues to mean "paid hosted plan", not "checkout marketing variant".

Use the public offer parser only at the browser/API boundary. After validation, resolve to the internal offer type and use that internal value for metadata, idempotency, tests, and billing writes.

## Data Model

Add a minimal phase layer to `HostedMemberBillingRef`.

```prisma
model HostedMemberBillingRef {
  memberId                      String       @unique @map("member_id")
  stripeCustomerLookupKey       String?      @unique @map("stripe_customer_lookup_key")
  stripeCustomerIdEncrypted     String?      @map("stripe_customer_id_encrypted")
  stripeSubscriptionLookupKey   String?      @unique @map("stripe_subscription_lookup_key")
  stripeSubscriptionIdEncrypted String?      @map("stripe_subscription_id_encrypted")
  currentBillingPlanCode        String?      @map("current_billing_plan_code")
  currentBillingPhase           String?      @map("current_billing_phase")
  currentCheckoutOffer          String?      @map("current_checkout_offer")
  pulseTrialRedeemedAt          DateTime?    @map("pulse_trial_redeemed_at")
  pulseTrialPolicyVersion       String?      @map("pulse_trial_policy_version")
  currentPeriodStart            DateTime?    @map("current_period_start")
  currentPeriodEnd              DateTime?    @map("current_period_end")
  currentTrialStartedAt         DateTime?    @map("current_trial_started_at")
  currentTrialEndsAt            DateTime?    @map("current_trial_ends_at")
  lastStripeEventCreatedAt      DateTime?    @map("last_stripe_event_created_at")
  createdAt                     DateTime     @default(now()) @map("created_at")
  updatedAt                     DateTime     @updatedAt @map("updated_at")
  member                        HostedMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@map("hosted_member_billing_ref")
}
```

Use strings rather than Prisma enums. That matches the existing billing-ref style, avoids broad enum churn, and keeps future Stripe metadata values from forcing schema migrations.

Migration shape:

```sql
ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "current_billing_phase" TEXT,
  ADD COLUMN "current_checkout_offer" TEXT,
  ADD COLUMN "pulse_trial_redeemed_at" TIMESTAMP(3),
  ADD COLUMN "pulse_trial_policy_version" TEXT,
  ADD COLUMN "current_trial_started_at" TIMESTAMP(3),
  ADD COLUMN "current_trial_ends_at" TIMESTAMP(3);
```

`pulseTrialRedeemedAt` is the one-trial-only marker. It is intentionally not a `current*` field and must not be cleared when subscriptions are canceled, replaced, or converted to paid. Do not store an extra raw Stripe subscription id for redemption; the current encrypted subscription ref remains the Stripe binding for the active subscription.

Set `pulseTrialRedeemedAt` and `pulseTrialPolicyVersion` only from a valid Pulse Trial Checkout completion in the same transaction that grants trial access. All later billing writes must preserve existing non-null redemption fields. The usage resolver should look up the persisted policy version in the server policy table; if the policy version is unknown, deny rather than guessing a limit.

Do not add a new index in the first implementation. All planned reads are by member id through the existing one-to-one billing ref. Add an index only if a later reconciliation job needs to scan trial expirations.

Update these projections/writes:

- `HostedMemberStripeBillingRefSnapshot`
- `HostedMemberStripeBillingRefWriteInput`
- `projectHostedMemberStripeBillingRefSnapshot`
- `buildHostedMemberBillingRefCreateData`
- `buildHostedMemberBillingRefUpdateData`
- `writeHostedMemberStripeBillingTx`
- `writeHostedMemberStripeBillingRefIfFreshTx`
- any hosted account export/delete fixture coverage and privacy tests that serialize billing refs

## Checkout Session Creation

### Offer Resolution

Add a checkout-offer resolver before calling `requireHostedStripeCheckoutConfig`.

Inputs:

- requested plan code, defaulting to Pulse
- requested public checkout offer, where missing resolves to internal `standard`
- existing billing ref
- current hosted member billing status

Rules:

- Existing active billing still returns `alreadyActive`.
- Existing suspended members still cannot start checkout.
- Existing members that have `pulseTrialRedeemedAt != null` cannot start another trial, even if their current subscription changed or was canceled. Return a typed error that the UI can treat as "use standard Pulse checkout".
- `pulse_trial_7d` is valid only for `launch_monthly`.
- the internally resolved `standard` offer is valid for Pulse and Edge.

The existing message-channel and consent gates should stay before checkout creation.

### Metadata

Every Checkout Session and resulting subscription should carry the same server-derived metadata map. Do not copy trial duration, usage limit, policy version, or member identity from arbitrary request body fields:

```ts
const checkoutMetadata = {
  memberId,
  billingPlanCode: "launch_monthly",
  checkoutOffer: "pulse_trial_7d",
  trialPolicyVersion: "pulse-trial-2026-05-05-v1",
  trialDurationDays: "7",
  trialUsageLimitUsdMicros: "4500000",
};
```

For standard checkout, include:

```ts
const checkoutMetadata = {
  memberId,
  billingPlanCode,
  checkoutOffer: "standard",
};
```

Do not include member email, phone, wallet, or other sensitive identity values in Stripe metadata.

Treat trial metadata as audit and reconciliation context, not as the usage allowance source of truth. The allowance resolver should use persisted billing-ref fields and the server-side policy table keyed by `pulseTrialPolicyVersion`.

### Stripe Request

For trial checkout, reuse the existing Pulse recurring price:

```ts
await stripe.checkout.sessions.create({
  cancel_url,
  client_reference_id: memberId,
  customer: existingCustomerId,
  customer_email: verifiedEmailIfNoCustomer,
  line_items: buildHostedBillingCheckoutLineItems(pulsePriceId),
  metadata: checkoutMetadata,
  mode: "subscription",
  payment_method_types: ["card"],
  subscription_data: {
    metadata: checkoutMetadata,
    trial_period_days: 7,
  },
  success_url,
}, {
  idempotencyKey,
});
```

Keep `payment_method_types: ["card"]`. Do not set `payment_method_collection: "if_required"` for this offer because the intended product behavior is automatic conversion to paid Pulse after seven days.

### Idempotency Key

The current idempotency key includes member, invite, plan, line items, and customer/email binding. Extend it with an offer policy binding:

```ts
function deriveHostedBillingCheckoutOfferBindingKey(input: {
  checkoutOffer: HostedBillingCheckoutOffer;
  trialDurationDays?: number | null;
  trialPolicyVersion?: string | null;
  trialUsageLimitUsdMicros?: bigint | null;
}): string;
```

Return a short hash-backed binding such as `offer:<12-char-sha256>`, built only from server-derived offer policy values. This keeps Stripe idempotency keys compact while still changing the key when the trial policy changes.

Include this binding in the key:

```txt
hosted-billing-checkout:<memberId>:<inviteCode>:<planCode>:<offerBinding>:<lineItems>:<customerBinding>
```

This prevents these collisions:

- standard Pulse vs Pulse Trial with the same Pulse price
- Pulse Trial policy v1 vs any later trial policy with different days or allowance
- email-bound checkout vs later durable customer-bound checkout

## Trial Activation

This is the highest-risk implementation slice.

Current paid checkout behavior should remain:

- `checkout.session.completed` binds Stripe refs and checkout email only.
- `invoice.paid` remains the normal paid-cycle source of truth and activation source.
- subscription events remain conservative and should not newly activate a previously inactive member.

Add one narrow exception: metadata-gated Pulse Trial activation on `checkout.session.completed`.

Implement one shared `applyPulseTrialCheckoutCompletedTx` path and call it from both the Stripe webhook handler and the checkout success reconciliation route. The success route may provide immediate browser reconciliation, but it must not duplicate or weaken the webhook entitlement checks.

Activation is allowed only when all checks pass:

- `session.status === "complete"`
- `session.mode === "subscription"`
- `session.client_reference_id === member.id`
- `session.metadata.memberId === member.id`
- `session.metadata.billingPlanCode === "launch_monthly"`
- `session.metadata.checkoutOffer === "pulse_trial_7d"`
- `session.metadata.trialPolicyVersion === HOSTED_PULSE_TRIAL_POLICY_VERSION`
- a subscription object is available by expansion or retrieval
- `subscription.id` matches the session subscription id
- `subscription.customer` matches the session customer id when both are present
- `subscription.status === "trialing"`
- `subscription.trial_end` exists and is in the future relative to the event time
- subscription period markers are valid and contain the trial window
- the member is not suspended and not in a blocked billing status
- the member has not already redeemed a Pulse Trial (`pulseTrialRedeemedAt` is null)

Ownership check must be stricter than metadata alone:

- collect candidate member ids from `session.metadata.memberId`, `session.client_reference_id`, the Stripe customer lookup, and the Stripe subscription lookup
- require the non-null candidates to resolve to exactly one member id
- if the customer or subscription is already bound to a different member, fail closed and do not activate or bind refs
- if metadata and existing Stripe refs disagree, fail closed and leave repair to an operator path

If the checkout event only carries a subscription id, retrieve that subscription before attempting trial activation. Keep the retrieval gated behind trial metadata so standard checkout does not add a new Stripe API call.

Use the Stripe webhook event `created` timestamp for webhook dispatch freshness. The success-route reconciliation path should not move `lastStripeEventCreatedAt` backward if a fresher subscription event already arrived.

Add a narrow `trial-checkout-entitlement` freshness policy for this path. It may activate the member when all are true:

- the trial metadata and ownership checks above pass
- the current member billing status is `not_started`, `incomplete`, or already `active`
- any current Stripe customer/subscription refs either match the session/subscription or are missing
- any fresher billing-ref fields are preserved and `lastStripeEventCreatedAt` is not reduced

Write billing state through the existing billing policy path, extended with phase and redemption fields:

```ts
await writeHostedMemberStripeBillingTx({
  billingStatus: HostedBillingStatus.active,
  canonicalBillingStatus: HostedBillingStatus.active,
  currentBillingPlanCode: "launch_monthly",
  currentBillingPhase: "trial",
  currentCheckoutOffer: "pulse_trial_7d",
  currentPeriodStart,
  currentPeriodEnd,
  currentTrialStartedAt,
  currentTrialEndsAt,
  pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
  pulseTrialRedeemedAt: currentTrialStartedAt,
  dispatchContext,
  member,
  stripeCustomerId,
  stripeSubscriptionId,
  tx,
});
```

Then call `activateHostedMemberForPositiveSourceTx` with a checkout-trial dispatch context only if the member was not already active. Do not rely on `skipIfBillingAlreadyActive` to suppress duplicate activation across different Stripe source ids; either harden that helper to no-op when the member is already active or skip the helper explicitly in the trial conversion path.

Implementation note: this changes the prior architecture statement that `invoice.paid` is the only positive Stripe entitlement source. `ARCHITECTURE.md` and `apps/web/README.md` now describe the single metadata-gated trial exception.

## Subscription And Invoice Reconciliation

### Subscription Updates

When handling `customer.subscription.created` or `customer.subscription.updated`, derive a billing phase snapshot:

```ts
type HostedStripeSubscriptionBillingSnapshot = {
  currentBillingPlanCode?: string | null;
  currentBillingPhase?: "trial" | "paid" | null;
  currentCheckoutOffer?: HostedBillingCheckoutOffer | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  currentTrialStartedAt?: Date | null;
  currentTrialEndsAt?: Date | null;
};
```

Rules:

- If `subscription.status === "trialing"` and metadata says `pulse_trial_7d`, write phase `trial`.
- If `subscription.status === "active"` and the matching billing ref is already phase `paid`, preserve phase `paid` and refresh the matching paid period markers.
- If `subscription.status === "active"` and the matching billing ref is phase `trial`, refresh matching refs and period/trial dates only; do not promote to `paid`.
- If `subscription.status === "active"` and the matching billing ref has no trial offer/redeemed marker, write phase `paid`.
- Only `invoice.paid` for an accepted non-trial paid invoice may transition the same subscription from phase `trial` to phase `paid`.
- If the subscription is canceled, unpaid, incomplete, paused, or past due, clear `currentBillingPhase` only when the write is fresh and the current subscription id matches. Preserve Stripe refs and event freshness.
- Preserve `currentCheckoutOffer` from metadata when present. If invoice or subscription events lack the offer but the current billing ref already has `pulse_trial_7d` for the same subscription, preserve it.
- Preserve `pulseTrialRedeemedAt` and `pulseTrialPolicyVersion` across subscription changes. Preserve current trial start/end history while the same subscription is still current, even after conversion to paid, unless the subscription id changes.

### Invoice Paid

When the trial converts, `invoice.paid` should:

- ignore the initial zero-dollar trial invoice for entitlement purposes when the canonical subscription is still `trialing` or the invoice represents the initial trial invoice; do not activate as paid and do not transition phase to `paid`
- accept a trial conversion invoice only after resolving the canonical subscription, confirming it matches the invoice subscription, confirming the subscription is `active`, and confirming the invoice is not the subscription-create trial invoice
- remain the paid-cycle source of truth
- write `billingStatus = active`
- write `currentBillingPhase = "paid"`
- preserve or write `currentCheckoutOffer = "pulse_trial_7d"` for converted trial subscriptions
- write the new paid period start/end from the canonical subscription
- clear stale block state by naturally moving the allowance resolver into the new paid period
- skip `activateHostedMemberForPositiveSourceTx` when the member was already active from Pulse Trial; if trial activation was missed and the member is still inactive when the first real paid invoice is accepted, use the normal paid activation path

### Invoice Payment Failed

When the first paid invoice after trial fails:

- keep the existing billing-status policy for payment failures
- write the latest Stripe period and phase data from the canonical subscription when available
- do not grant the paid Pulse allowance while the member is not active or is stale in trial phase
- surface the existing inactive access decision through the usage gate

## Usage Allowance Semantics

Add trial awareness to the existing allowance period resolver. Do not create a new budget table.

The resolver should make decisions from local persisted state only:

- hosted member billing status
- billing ref plan code
- billing ref phase
- billing ref offer
- trial start/end fields
- paid period start/end fields
- immutable trial-redemption marker for legacy-compatibility checks
- server-side trial policy table keyed by `pulseTrialPolicyVersion`

It should not retrieve Stripe objects or parse Stripe metadata on the hot path.

### Normal Paid Behavior

Return the normal monthly allowance only when `currentBillingPhase === "paid"`.

For paid Pulse:

```ts
limitUsdMicros = 10_000_000n;
periodStart = billingRef.currentPeriodStart ?? calendarMonthStart;
periodEnd = billingRef.currentPeriodEnd ?? calendarMonthEnd;
```

For paid Edge:

```ts
limitUsdMicros = 25_000_000n;
periodStart = billingRef.currentPeriodStart ?? calendarMonthStart;
periodEnd = billingRef.currentPeriodEnd ?? calendarMonthEnd;
```

Temporary legacy compatibility is allowed only for pre-existing active paid members whose billing ref predates the phase fields and has no trial offer or `pulseTrialRedeemedAt`. That legacy branch should be removed after existing billing refs have been touched by fresh Stripe events or a one-time repair/migration.

If `currentCheckoutOffer === "pulse_trial_7d"` and phase is missing, malformed, or neither `trial` nor `paid`, deny instead of falling through to calendar Pulse.

### Trial Behavior

For active Pulse Trial:

```ts
trialPolicy = requireHostedPulseTrialPolicy(pulseTrialPolicyVersion);
billingPlanCode = "launch_monthly";
billingPhase = "trial";
checkoutOffer = "pulse_trial_7d";
limitUsdMicros = trialPolicy.usageLimitUsdMicros;
periodStart = currentTrialStartedAt;
periodEnd = currentTrialEndsAt;
```

The trial period should be keyed by the trial start. It should not use the calendar-month fallback, and trial start/end fields are required entitlement data. Current Stripe period markers may be validating/supporting data, but they are not fallback trial dates.

The resolver should require:

- phase is `trial`
- offer is `pulse_trial_7d`
- plan is Pulse
- `pulseTrialPolicyVersion` resolves to a known server-side policy
- `currentTrialStartedAt` and `currentTrialEndsAt` are present
- trial start is before trial end
- the usage/check time is inside the trial interval

If these checks fail because the trial is expired or malformed, fail closed. Do not return the normal Pulse allowance.

The 4.50 USD trial allowance is a pre-invocation start gate after usage import, not an exact token-level prepaid cap. One allowed hosted run can exceed the remaining trial balance before its usage is imported; the next invocation must be denied once imported spend reaches or exceeds the limit.

### Stale Trial Guard

The critical edge case:

```ts
if (
  billingRef.currentBillingPhase === "trial" &&
  billingRef.currentTrialEndsAt &&
  now >= billingRef.currentTrialEndsAt
) {
  deny without falling back to calendar Pulse;
}
```

Also deny when phase is `trial` but `currentTrialEndsAt` is missing or malformed. Missing trial boundaries are an invalid entitlement state, not permission to use a calendar fallback.

The denied response should use an explicit runtime-facing reason:

```ts
reason: "trial_expired_pending_billing"
```

Return a future `retryAfter`, never the already-expired trial end. A reasonable first value is `now + 15 minutes`, matching a reconciliation/backoff posture without tight retry loops. Also return a user notice code/message such as:

```ts
noticeCode: "trial_conversion_pending"
userNotice: "Your trial has ended and billing is being updated. Try again shortly."
```

`resolveHostedAiUsageAllowancePeriod` should return a denied/stale-trial union before any `HostedAiUsagePeriod` upsert, limit upgrade, or fallback-period carryover. Do not create or upgrade a calendar Pulse period when billing phase is `trial` and `now >= currentTrialEndsAt`.

### Existing Period Reuse

`HostedAiUsagePeriod` uses `(memberId, periodStart)` as the primary key. Trial and paid periods naturally stay separate because:

- trial period start is trial start
- first paid period start is the Stripe period start after trial conversion

Do not upgrade a trial period's limit from 4.50 USD to 10.00 USD. The paid conversion should create or resolve a distinct paid period.

### Fallback Period Carryover

The current resolver can move calendar fallback usage into a later Stripe billing period when billing markers arrive. For the first Pulse Trial implementation, keep that carryover only for paid billing-marker arrival:

- Do not migrate calendar fallback usage into trial periods.
- Require valid trial boundaries before trial activation and trial allowance access.
- Do not carry post-trial usage into a paid Pulse period until billing phase is `paid`.
- Do not migrate trial usage into the paid period after conversion.

This preserves trial spend as trial spend and prevents delayed Stripe webhooks from accidentally granting paid allowance.

## Implementation Sequence

Implement in this order to keep the diff reviewable:

1. Add checkout offer and phase constants/parsers to the hosted billing owner module.
2. Add Prisma fields and migration on `HostedMemberBillingRef`.
3. Extend billing-ref snapshots and write helpers to read/write phase, offer, and trial dates.
4. Extend checkout route/client types to accept only the public trial offer and resolve missing offer to internal `standard`.
5. Add checkout offer resolution in `createHostedBillingCheckout`.
6. Add trial metadata and `subscription_data.trial_period_days` for `pulse_trial_7d`.
7. Add offer policy data to the Stripe idempotency key.
8. Add metadata-gated trial activation from `checkout.session.completed` and success-route reconciliation through the shared helper.
9. Extend subscription and invoice billing snapshots to write phase transitions without letting subscription events promote trial to paid.
10. Make `resolveHostedAiUsageAllowancePeriod` phase-aware and stale-trial aware before period upsert/carryover.
11. Add stale trial, initial trial invoice, subscription-before-paid-invoice, duplicate-redemption, and ownership-conflict tests.
12. Add a server-side enablement flag for rendering the Pulse Trial CTA.
13. Update the join page to replace the Free card with Pulse Trial and move GitHub to a secondary link, with the CTA hidden or disabled until the backend trial path is deployed and tested.
14. Update durable current-state docs after the behavior lands: `ARCHITECTURE.md`, `apps/web/README.md`, and any testing map entry that names the new verification surface.

## Test Plan

Focused tests to add or update:

- `hosted-onboarding-billing-plans.test.ts`
  - parses `standard` and `pulse_trial_7d`
  - rejects unknown checkout offers
  - confirms plan codes remain exactly Pulse and Edge
- `hosted-onboarding-billing-service.test.ts`
  - standard Pulse request has no `trial_period_days`
  - Pulse Trial request includes trial metadata and `trial_period_days: 7`
  - Edge trial is rejected
  - prior trial redemption is rejected from immutable `pulseTrialRedeemedAt`, even after cancellation or replacement subscription
  - idempotency key differs between standard Pulse and Pulse Trial
  - idempotency key differs when trial policy version or limit changes
- `hosted-onboarding-billing-checkout-route.test.ts`
  - route validates `checkoutOffer`
  - route defaults missing offer to `standard`
  - route rejects explicit public `checkoutOffer: "standard"`
- `join-invite-islands.test.ts` and/or server component tests
  - Pulse Trial card renders instead of Free
  - GitHub is a secondary self-host link
  - trial CTA sends `checkoutOffer: "pulse_trial_7d"`
  - trial card includes duration, post-trial price, card-required disclosure, and cancel-before-charge disclosure
- `hosted-onboarding-stripe-checkout-completed.test.ts`
  - trial checkout activates only when metadata and subscription status are valid
  - standard checkout still only binds refs
  - wrong member metadata does not activate
  - customer/subscription binding conflict does not activate or rebind
  - missing or non-trialing subscription does not activate
  - duplicate checkout-completed events are idempotent
  - stale-but-valid checkout completion can activate through the `trial-checkout-entitlement` policy without moving `lastStripeEventCreatedAt` backward
- `hosted-onboarding-billing-success-service.test.ts`
  - success reconciliation uses the same shared trial checkout helper as the webhook path
  - success reconciliation can activate a valid expanded trial session without weakening metadata or ownership checks
  - success reconciliation does not bypass member/session ownership checks
- `hosted-onboarding-stripe-billing-events.test.ts`
  - trial subscription writes phase `trial`
  - initial zero-dollar trial invoice does not activate paid access or transition phase to `paid`
  - subscription `active` event before the first real paid invoice does not transition trial phase to `paid`
  - subscription `active` event after real paid conversion preserves phase `paid`
  - conversion invoice writes phase `paid`
  - conversion invoice is rejected when the invoice subscription and canonical subscription disagree
  - conversion invoice is rejected when it is the initial subscription-create trial invoice
  - trial conversion invoice skips duplicate activation when the member is already trial-active
  - payment failure after trial does not grant active paid allowance
  - stale older subscription event cannot overwrite fresher paid state
- `hosted-onboarding-member-store.test.ts`
  - billing-ref write helpers persist and project the new fields
- `hosted-execution-usage-allowance.test.ts`
  - active Pulse Trial receives 4.50 USD micros limit
  - member-provided credentials still do not count against trial allowance
  - trial usage over 4.50 USD is denied
  - expired trial with stale billing phase is denied before period upsert and does not fall back to 10.00 USD
  - trial phase with unknown `pulseTrialPolicyVersion` is denied before period upsert
  - trial phase with missing trial end is denied before period upsert
  - stale trial denial returns `trial_expired_pending_billing`, future `retryAfter`, and a user notice
  - phase missing/malformed for `pulse_trial_7d` denies instead of using calendar Pulse
  - paid conversion uses the normal Pulse allowance in a distinct paid period
  - trial usage is not migrated into the paid period
- web route and Cloudflare runner gate tests
  - `/api/internal/hosted-execution/usage/gate` serializes the stale-trial reason, notice, and future retry time
  - Cloudflare accepts the new reason string and schedules a sane future retry without exposing sensitive billing details
- hosted privacy/account-data tests
  - new billing-ref fields are included or intentionally omitted according to the existing export/delete contract
- migration/privacy foundation tests
  - migration adds only nullable billing-ref fields

Expected verification for the implementation change:

- If the diff is app-only and `pnpm test:diff <paths>` truthfully covers the touched files, run that.
- Otherwise use the hosted-web acceptance lane required for `apps/web` changes, normally `pnpm --dir apps/web verify` or root `pnpm verify:acceptance` depending on final scope.
- Run direct local Stripe proof with the repo's `pnpm dev` Stripe listener when credentials are available: start a Pulse Trial checkout, complete test card checkout, confirm the member activates in trial phase, then simulate or wait for the paid conversion in Stripe test mode.

## Rollout Plan

1. Apply the nullable Prisma migration first.
2. Deploy web support for offer parsing, metadata, shared trial activation, phase writes, immutable redemption, invoice/subscription reconciliation, and phase-aware allowance with the trial CTA still hidden or disabled.
3. Verify standard Pulse and Edge checkout still work after the web deploy.
4. Verify the signed usage gate still allows an active paid member and denies a synthetic stale-trial member with a future `retryAfter`.
5. Enable the Pulse Trial CTA only after the backend support is live.
6. Keep the standard Pulse checkout path available throughout rollout.
7. Run one test-mode checkout against the production-like Stripe account with test keys or a staging environment.
8. Confirm Stripe metadata on the Checkout Session and Subscription.
9. Confirm `HostedMemberBillingRef` has phase `trial`, offer `pulse_trial_7d`, immutable redemption fields, trial start/end, and Pulse plan code.
10. Confirm the usage gate returns the trial allowance before imported model spend reaches 4.50 USD.
11. Confirm a synthetic over-limit period denies before the next invocation without granting paid Pulse allowance.
12. Confirm the initial trial invoice does not activate paid access.
13. Confirm the first real paid invoice updates phase to `paid` and resolves the normal Pulse allowance.

No Cloudflare deploy is required for this plan if the existing runner continues to treat denial reasons as opaque strings and honors the web-provided `retryAfter`. A Cloudflare deploy is required only if implementation changes runner-side status copy, reason parsing, or usage-gate transport behavior.

## Stress Test And Simplifications

| Scenario | Risk | Required behavior |
| --- | --- | --- |
| Standard Pulse checkout and Pulse Trial checkout use the same Stripe price | Stripe idempotency collision | Offer policy binding must be in the idempotency key. |
| User double-clicks trial CTA | Duplicate sessions or mixed state | Same request shape reuses the same idempotency key; webhook/success activation is idempotent. |
| User completes Checkout but success redirect never reaches Murph | Trial never activates | Webhook path must perform the same metadata-gated activation. |
| Stripe webhook arrives after success route | Duplicate activation | Shared trial helper checks current active state before activation; billing ref writes remain freshness-gated. |
| Stripe initial trial invoice emits `invoice.paid` | Paid access activates before payment | Ignore the trial invoice for paid activation and phase transition; only checkout-completed may trial-activate. |
| Subscription update arrives before checkout completed | Incomplete member might become active too broadly | Subscription event remains conservative; only metadata-gated checkout completion activates trial. |
| Subscription becomes `active` before paid invoice reconciliation | Paid allowance unlocks too early | Preserve trial phase until the first real paid invoice is accepted. |
| Checkout completion is older than a subscription event | Trial activation blocked by freshness | Use the narrow `trial-checkout-entitlement` freshness policy and preserve fresher ref fields. |
| Trial checkout metadata is missing or tampered | Wrong entitlement | Do not activate; only bind safe refs if ownership checks pass. |
| Stripe customer/subscription lookup conflicts with metadata member | Cross-account entitlement | Require candidate member ids to agree exactly; fail closed on conflict. |
| Trial ends but `invoice.paid` is delayed | User receives 10.00 USD Pulse allowance early | Trial phase resolver denies or remains capped; no calendar fallback. |
| First paid invoice fails | Access and allowance ambiguity | Billing state follows existing payment-failure policy; no paid allowance while inactive/stale. |
| Trial canceled during trial | Lingering active access | Fresh subscription cancellation clears/updates phase and billing status through existing policy. |
| Existing active paid member requests trial | Unintended free period | Existing active billing returns `alreadyActive`; no trial creation. |
| Prior trial user requests another trial | Abuse | Block when billing ref records immutable `pulseTrialRedeemedAt`, regardless of current subscription. |
| Edge trial requested | Product ambiguity | Reject. Trial is Pulse-only. |
| Member-provided model credentials are used during trial | User's own spend counts against Murph allowance | Keep existing `credentialSource === "member"` non-counting behavior. |
| Unknown hosted platform model is used | Free unpriced model spend | Keep fail-closed pricing for platform credentials. |
| Calendar fallback period exists before trial markers are written | Spend moves into wrong period | Do not carry fallback usage into trial periods; require trial boundaries before trial access. |
| One invocation exceeds remaining trial allowance before usage import | Product expects exact prepaid cap | Document and test this as a next-invocation start gate, not a token-level mid-run cutoff. |

The main simplification is to keep "trial" as a phase on the existing Pulse subscription instead of creating new product, plan, entitlement, or budget tables. The only new persisted state is the phase/offer/trial boundary plus immutable redemption marker needed to make checkout and allowance decisions deterministic.

## Acceptance Criteria

The implementation is complete when:

- `HOSTED_BILLING_PLAN_CODES` still contains only `launch_monthly` and `launch_edge_monthly`.
- The public checkout API accepts only missing offer or `checkoutOffer: "pulse_trial_7d"`; the server resolves missing offer to internal `standard`.
- Pulse Trial Checkout Sessions reuse the existing Pulse price and include seven trial days.
- Trial and standard checkout idempotency keys cannot collide.
- `checkout.session.completed` activates only valid Pulse Trial sessions.
- initial trial invoices do not activate paid access, and only a real paid invoice converts trial phase to paid.
- `HostedMemberBillingRef` persists plan, phase, offer, period, trial boundaries, and immutable Pulse Trial redemption.
- The usage allowance resolver returns 4.50 USD micros for active trial periods and 10.00 USD micros only for paid Pulse periods or the explicit legacy paid-member branch.
- Expired stale trial state denies before period upsert/carryover, returns a future retry, and never falls back to monthly Pulse.
- The join page presents Pulse Trial, Pulse, and Edge as hosted choices, with self-hosting as a secondary GitHub link.
- Durable docs and tests are updated with the final current-state behavior.
