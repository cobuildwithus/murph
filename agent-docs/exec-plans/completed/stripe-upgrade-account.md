I reviewed the repo path end-to-end. I could not live-browse Stripe’s current docs in this environment, so the Stripe-specific guidance below is based on Stripe’s stable subscription-update and Billing Portal APIs, plus your installed Stripe SDK version, which is `stripe@^20.4.1` in `apps/web/package.json`. 

## Recommendation

Build this as a small, authenticated **plan-change service** that updates the customer’s existing Stripe subscription from Pulse to Edge. Do **not** reuse onboarding Checkout, and do **not** create a second subscription.

The cleanest architecture is:

1. Add `POST /api/settings/billing/upgrade-plan`.
2. Add a narrow service like `upgradeHostedBillingPlan(...)`.
3. Use `stripe.subscriptions.update(...)` to swap the existing Pulse recurring and usage subscription items to the Edge prices.
4. Keep Stripe webhooks as the canonical source of billing state.
5. Optionally do an inline reconciliation after Stripe confirms the update, so the user unblocks immediately.
6. Reuse the existing usage gate; it already raises the current period limit when `currentBillingPlanCode` becomes `launch_edge_monthly`.

This is minimal, composable, and avoids introducing a parallel local billing model.

---

## Current implementation review

You already have the core ingredients.

Pulse and Edge are already modeled centrally in `billing-plans.ts`. Pulse is `launch_monthly`, Edge is `launch_edge_monthly`, and each plan has both a recurring Stripe price env key and a usage price env key. The allowance mapping is also already there: Pulse gets `10_000_000n` USD micros and Edge gets `25_000_000n`. 

Your current Stripe checkout path is onboarding-specific. `createHostedBillingCheckout` requires an invite, handles trial/standard offers, creates a new `mode: "subscription"` Checkout Session, and returns `alreadyActive: true` when the member is already active.  That is exactly why it should not be used for upgrades.

Your runtime/env layer already resolves the configured Stripe price IDs by plan through `requireHostedStripeCheckoutConfig({ billingPlanCode })`, including usage prices when `aiUsageBillingMode === "stripe_meter"`.  The env loader reads those plan price IDs from the centralized plan definitions. 

Your webhook pipeline is strong. Stripe webhooks are verified, persisted idempotently, then reconciled asynchronously.  The reconciliation layer already handles `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.  The subscription-update handler reads the canonical Stripe subscription, resolves the current plan from subscription metadata or price IDs, and writes the local billing ref. 

The usage-limit behavior is also already set up for upgrades. The Linq webhook calls `resolveHostedAiUsageGate`; when the gate denies usage with a notice, Murph replies with the exact user-facing usage-limit message.  The home page also reads the same gate and shows a usage-limit banner when the member is out of included usage. 

Most importantly: your usage allowance code already supports upgrade unblocking. The tests show that when the current plan becomes `launch_edge_monthly`, the current usage period limit is raised from Pulse to Edge without lowering spend, and `blockedAt` is cleared when spend is below the new Edge limit.  So the upgrade feature should not implement new quota logic. It should only update Stripe and let `currentBillingPlanCode` flow through the existing billing ref.

---

## Primary Stripe flow

Use Stripe’s existing subscription update API:

```ts
await stripe.subscriptions.update(subscriptionId, {
  items: [
    { id: pulseRecurringItem.id, price: edgeRecurringPriceId, quantity: 1 },
    { id: pulseUsageItem.id, price: edgeUsagePriceId },
  ],
  metadata: {
    ...subscription.metadata,
    memberId,
    billingPlanCode: "launch_edge_monthly",
  },
  proration_behavior: "always_invoice",
  payment_behavior: "pending_if_incomplete",
  expand: ["items.data.price", "latest_invoice.payment_intent"],
}, {
  idempotencyKey,
});
```

Use the **Subscription API** as the primary path because the user asked for one-click upgrade. Use the **Billing Portal** only as a fallback for payment/SCA issues. Your existing portal route creates a generic portal session for “Manage subscription,” but it is not currently an upgrade flow. 

Do **not** use Stripe Checkout for this. Checkout is already your new-subscription/onboarding path, and your service intentionally blocks active members from starting a new checkout. 

---

## New service

Create:

```txt
apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts
```

Public API:

```ts
export async function upgradeHostedBillingPlan(input: {
  memberId: string;
  targetPlanCode: HostedBillingPlanCode;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<HostedBillingPlanUpgradeResult>
```

Result shape:

```ts
type HostedBillingPlanUpgradeResult =
  | {
      status: "already_on_plan";
      billingPlanCode: "launch_edge_monthly";
    }
  | {
      status: "upgraded";
      billingPlanCode: "launch_edge_monthly";
    }
  | {
      status: "pending_payment";
      billingPlanCode: "launch_monthly";
      billingPortalUrl: string;
    };
```

Keep the allowed transition explicit:

```ts
function assertHostedBillingPlanUpgradeAllowed(input: {
  currentPlanCode: HostedBillingPlanCode;
  targetPlanCode: HostedBillingPlanCode;
}) {
  if (
    input.currentPlanCode === "launch_monthly" &&
    input.targetPlanCode === "launch_edge_monthly"
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_UPGRADE_UNSUPPORTED",
    httpStatus: 400,
    message: "This plan change is not supported.",
  });
}
```

That policy function is where future transitions belong. Don’t scatter plan transition logic through routes or UI.

---

## Service behavior

The service should:

1. Read the member and billing ref.
2. Require active, non-suspended access.
3. Require current plan `launch_monthly`.
4. Return `already_on_plan` if already Edge.
5. Require `stripeCustomerId` and `stripeSubscriptionId` from `HostedMemberBillingRef`.
6. Retrieve the Stripe subscription.
7. Verify the Stripe subscription’s customer matches the local `stripeCustomerId`.
8. Resolve Edge recurring and usage price IDs using your existing plan config.
9. Build a conservative subscription-item update.
10. Update Stripe with idempotency.
11. If Stripe says the update applied cleanly, reconcile locally or wait for webhook.
12. Nudge the hosted runner best-effort so a previously blocked runner does not wait until the old `retryAfter`.

The billing ref already stores the Stripe customer/subscription IDs and current billing plan/phase/period.  You should continue treating that as the local snapshot, not introduce a new local “plan” table for MVP.

---

## Subscription item matching

Do not assume item order. Match by known price IDs.

Use current plan price IDs and target plan price IDs from `billing-plans.ts` / `requireHostedStripeCheckoutConfig`.  

Conceptually:

```ts
const currentPlan = "launch_monthly";
const targetPlan = "launch_edge_monthly";

const currentConfig = requireHostedStripeCheckoutConfig({
  billingPlanCode: currentPlan,
});

const targetConfig = requireHostedStripeCheckoutConfig({
  billingPlanCode: targetPlan,
});

const recurringItem = subscription.items.data.find(
  (item) => item.price.id === currentConfig.priceId
);

const usageItem = currentConfig.usagePriceId
  ? subscription.items.data.find(
      (item) => item.price.id === currentConfig.usagePriceId
    )
  : null;
```

Then:

```ts
const items: Stripe.SubscriptionUpdateParams.Item[] = [
  {
    id: recurringItem.id,
    price: targetConfig.priceId,
    quantity: 1,
  },
];

if (targetConfig.usagePriceId) {
  if (usageItem) {
    items.push({
      id: usageItem.id,
      price: targetConfig.usagePriceId,
    });
  } else {
    items.push({
      price: targetConfig.usagePriceId,
    });
  }
}
```

Only delete known old Murph billing items if needed. Do not delete unknown subscription items; those might become future add-ons.

---

## Payment behavior

For “one click,” use:

```ts
proration_behavior: "always_invoice"
```

That charges the prorated upgrade immediately instead of waiting until the next billing cycle.

For payment behavior, I would use:

```ts
payment_behavior: "pending_if_incomplete"
```

This avoids granting Edge if the payment cannot complete. If Stripe needs SCA/3DS or payment fails, the subscription update remains pending rather than fully applied. In that case, return `pending_payment` and create a Billing Portal session as fallback.

A simpler but harsher alternative is:

```ts
payment_behavior: "error_if_incomplete"
```

That keeps state cleaner, but it will fail the one-click flow more often for cards that require confirmation.

Given your priority is maintainable architecture, I would choose `pending_if_incomplete` and only grant local Edge entitlement after the Stripe subscription is actually updated.

---

## Metadata

When updating the subscription, set metadata:

```ts
metadata: {
  ...subscription.metadata,
  memberId,
  billingPlanCode: "launch_edge_monthly",
}
```

Your webhook logic can already resolve plan from subscription metadata first, then fall back to subscription item price IDs.  Keeping metadata updated makes support and reconciliation easier.

Do not use checkout metadata here. This is not checkout.

---

## Local entitlement update

Canonical source should remain Stripe webhooks. The existing `customer.subscription.updated` path is already the right source of truth. It fetches the canonical subscription and writes the billing snapshot through `writeHostedMemberStripeBillingTx`.  

For better UX, add an optional inline reconciliation after the Stripe call succeeds:

```ts
if (stripeSubscriptionIsAppliedEdge(updatedSubscription)) {
  await prisma.$transaction(async (tx) => {
    await applyStripeSubscriptionUpdated(
      updatedSubscription,
      buildInlinePlanUpgradeDispatchContext(now, updatedSubscription.id),
      tx
    );
  });

  await resolveHostedAiUsageGate({
    memberId,
    prisma,
    now,
  });

  await nudgeHostedRunnerUserBestEffortResult({
    context: "billing.plan-upgrade",
    userId: memberId,
  });
}
```

The inline reconciliation should call the same policy/write path as the webhook; do not duplicate billing-ref write logic. The reason to call `resolveHostedAiUsageGate` after reconciliation is that it already updates the current usage period limit from Pulse to Edge.  

The runner nudge matters because the Cloudflare runner can schedule itself for the old retry time when the usage gate blocks invocation.  If the user upgrades right after being blocked, you want Murph to wake again without waiting until the old monthly reset.

---

## New route

Add:

```txt
apps/web/app/api/settings/billing/upgrade-plan/route.ts
```

Shape:

```ts
export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);

  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const body = await request.json().catch(() => ({}));
  const targetPlanCode = parseHostedBillingPlanCode(body.targetPlanCode);

  if (targetPlanCode !== "launch_edge_monthly") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TARGET_INVALID",
      httpStatus: 400,
      message: "targetPlanCode must be launch_edge_monthly.",
    });
  }

  const result = await upgradeHostedBillingPlan({
    memberId: auth.member.id,
    targetPlanCode,
  });

  return jsonOk(result);
});
```

This should mirror your existing settings billing portal route: CSRF origin check, hosted app session, suspension check, JSON error wrapper. 

---

## UI hookup

Change the Pulse usage-limit banner from a plain link to settings into a direct client action.

Right now `UsageLimitBanner` maps `pulse_upgrade_edge` to “Upgrade to Edge,” but the button is just a `Link href="/settings"`.  Replace that action with a small client component:

```tsx
<UpgradeToEdgeButton />
```

Client behavior:

```ts
const response = await requestHostedOnboardingJson<UpgradePlanResponse>({
  method: "POST",
  url: "/api/settings/billing/upgrade-plan",
  body: {
    targetPlanCode: "launch_edge_monthly",
  },
});

if (response.status === "upgraded" || response.status === "already_on_plan") {
  router.refresh();
  return;
}

if (response.status === "pending_payment") {
  window.location.assign(response.billingPortalUrl);
}
```

You can also render the same button in the Settings billing card next to “Manage subscription.” The existing settings action already has the right client-side pattern for POSTing and redirecting to Stripe. 

Keep `edge_enable_usage_based_pricing` separate. That notice currently advertises a different feature: enabling usage-based pricing for Edge.  Don’t mix it into Pulse → Edge upgrade.

---

## Billing Portal fallback

Keep your existing generic portal route, but optionally add a helper that creates a targeted portal session for payment/plan-management fallback:

```ts
const session = await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: new URL("/home", request.url).toString(),
});
```

If you want Stripe-hosted plan changes later, configure a Portal subscription-update flow and create sessions with `flow_data`. That is simpler operationally but not truly one-click, and it depends on Dashboard configuration. For this feature, Portal should be the fallback, not the primary path.

---

## Tests to add

Add service tests for:

1. Rejects suspended member.
2. Rejects inactive / non-active billing status.
3. Rejects missing `stripeCustomerId` or `stripeSubscriptionId`.
4. Returns `already_on_plan` for Edge.
5. Rejects unsupported transitions.
6. Builds correct `stripe.subscriptions.update` item payload for Pulse recurring + usage → Edge recurring + usage.
7. Uses an idempotency key.
8. Does not delete unknown subscription items.
9. Returns `pending_payment` when Stripe returns a pending update / incomplete payment state.
10. After applied update, local billing ref becomes `launch_edge_monthly`, and `resolveHostedAiUsageGate` allows a user who has spent between the Pulse and Edge limits.

You already have an allowance test proving the last part at the usage layer; add the upgrade service integration around it. 

Add route tests mirroring `settings-billing-portal-route.test.ts`: unauthenticated, CSRF/origin failure, suspended member, valid upgrade response. 

Add UI tests for the banner/button: when notice code is `pulse_upgrade_edge`, clicking calls `/api/settings/billing/upgrade-plan`; when success, refreshes or returns to home.

---

## Operational setup

Make sure all environments have:

```txt
HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY
HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_EDGE_MONTHLY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

The plan env keys already exist in the centralized plan definitions. 

Also confirm the webhook endpoint is subscribed to:

```txt
customer.subscription.updated
invoice.paid
invoice.payment_failed
```

Your code already has handlers for these event types. 

---

## Why this is the right shape

This keeps the architecture small:

* Stripe remains the billing source of truth.
* Existing `HostedMemberBillingRef` remains the local billing snapshot.
* Existing webhook reconciliation remains canonical.
* Existing usage gate remains canonical for allowance logic.
* Existing home/SMS path remains unchanged except the button now does something.
* No new database migration is needed for MVP.
* No second subscription.
* No duplicate checkout path.
* No new “plan state” subsystem.

The one feature-specific thing you add is a composable plan-change service with one allowed transition: `launch_monthly` → `launch_edge_monthly`.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
