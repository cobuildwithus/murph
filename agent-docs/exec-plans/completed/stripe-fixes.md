I did a static review of the landed upgrade path. The overall direction is good: no second subscription, authenticated route, direct Stripe subscription update, inline reconciliation through existing webhook billing code, then usage-gate refresh and runner nudge. That matches the architecture we wanted.

I would fix two correctness issues before I’d be comfortable calling this production-safe.

## Verdict

The implementation is close, but I’d treat these as must-fix:

1. **Retry/race bug:** if Stripe is already upgraded to Edge but local billing state is still Pulse, the service can no longer recover.
2. **Pulse Trial bug:** trial users can trigger the Edge upgrade path and can land in an impossible local state: `launch_edge_monthly` + Pulse Trial phase/offer, which the usage gate denies.

There are also a few medium-priority cleanup items around one-shot usage notices, local reconciliation verification, and Stripe error observability.

---

## What looks good

The route is clean: CSRF origin check, app session auth, suspended-member guard, small JSON body, explicit `launch_edge_monthly` target validation, and a narrow call into `upgradeHostedBillingPlan`. 

The service uses the existing billing model instead of creating a parallel local plan store. It reads hosted member core state, reads `HostedMemberBillingRef`, resolves configured Pulse/Edge Stripe prices through the existing runtime config, updates the existing subscription, then runs existing local billing reconciliation via `applyStripeSubscriptionUpdated`. 

The subscription item update is conservative: it finds the current recurring item by known Pulse price ID, swaps it to the Edge recurring price, finds the usage item by known Pulse usage price ID when present, swaps it to the Edge usage price, and does not delete unknown items. That is the right default for composability with future add-ons. 

The UI hookup is also simple. `UpgradeToEdgeButton` posts to `/api/settings/billing/upgrade-plan`, refreshes on `upgraded` / `already_on_plan`, and redirects to Billing Portal on `pending_payment`.  The settings action disables “Manage subscription” while upgrade is pending, which prevents obvious double-actions. 

Tests cover the main happy path, unsupported target, inactive/suspended members, missing Stripe IDs, customer mismatch, pending payment fallback, usage item addition, idempotency key shape, and unknown-item preservation.  Route tests cover auth, CSRF, suspended member, bad target, and successful call-through. 

---

## Must-fix 1: retry/race bug when Stripe is already Edge but local state is still Pulse

Current flow:

1. Read local `billingRef.currentBillingPlanCode`.
2. If local plan is Edge, return `already_on_plan`.
3. Otherwise assert local Pulse → Edge is allowed.
4. Retrieve Stripe subscription.
5. Build update items by finding the **current Pulse price items** in the retrieved Stripe subscription.
6. Call `stripe.subscriptions.update`.
7. Only after the update, call `isHostedStripeSubscriptionAppliedPlan`.

The problem is step 5. If a prior request already updated Stripe to Edge but failed after the Stripe mutation and before local reconciliation, or if two upgrade requests race and the second retrieves after the first Stripe update, the local billing ref still says Pulse but the Stripe subscription no longer contains the Pulse price item. `buildHostedBillingPlanUpgradeSubscriptionItems` then throws `HOSTED_BILLING_SUBSCRIPTION_ITEM_NOT_FOUND` instead of reconciling the already-upgraded Stripe subscription. 

That is exactly the kind of failure mode we need to handle because Stripe mutations are outside the DB transaction. The service should be idempotent across “Stripe succeeded, local failed.”

Minimal fix: after retrieving and customer-checking the subscription, check whether the subscription already has the target Edge plan before looking for Pulse items.

```ts
const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
  expand: ["items.data.price"],
});

assertHostedStripeSubscriptionMatchesCustomer({
  stripeCustomerId,
  subscription,
});

if (isHostedStripeSubscriptionAppliedPlan({
  subscription,
  targetPriceId: targetConfig.priceId,
  targetUsagePriceId: targetConfig.usagePriceId,
})) {
  await reconcileAppliedHostedBillingPlanUpgrade({
    memberId: input.memberId,
    now,
    prisma,
    stripeSubscriptionId,
    subscription,
  });

  return {
    billingPlanCode: targetPlanCode,
    status: "upgraded",
  };
}

const updateItems = buildHostedBillingPlanUpgradeSubscriptionItems(...);
```

Add a regression test:

```ts
test("recovers when Stripe is already Edge but local billing ref still says Pulse", async () => {
  mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
    customer: "cus_123",
    items: [
      ["si_recurring", "price_edge_recurring"],
      ["si_usage", "price_edge_usage"],
    ],
    metadata: {
      billingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
    },
    status: "active",
  }));

  await expect(upgradeHostedBillingPlan({
    memberId: "member_123",
    targetPlanCode: "launch_edge_monthly",
  })).resolves.toEqual({
    billingPlanCode: "launch_edge_monthly",
    status: "upgraded",
  });

  expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalled();
});
```

This one matters a lot. Without it, one failed post-Stripe local reconciliation can leave the user unable to self-heal through the same button.

---

## Must-fix 2: trial users can upgrade into an invalid Edge + Pulse Trial state

The service allows any active hosted member with local `currentBillingPlanCode === "launch_monthly"` to upgrade. It does not check billing phase or checkout offer. 

That means a Pulse Trial user can go to Settings and click “Upgrade to Edge,” because Settings shows upgrade based only on `currentBillingPlanCode === "launch_monthly"`. 

The upgrade then spreads existing subscription metadata:

```ts
metadata: {
  ...subscription.metadata,
  billingPlanCode: targetPlanCode,
  memberId: input.memberId,
}
```

If the subscription was created from `pulse_trial_7d`, this preserves `checkoutOffer: "pulse_trial_7d"` and trial metadata while changing `billingPlanCode` to Edge. 

Your Stripe subscription billing-phase logic treats a `trialing` subscription with Pulse Trial metadata as `currentBillingPhase: "trial"` and `currentCheckoutOffer: "pulse_trial_7d"`.  Then the usage allowance code sees trial phase / Pulse Trial offer, but `billingPlanCode` is now Edge. `resolveHostedPulseTrialAllowancePeriod` requires trial billing plan code to be `launch_monthly`; otherwise it returns a denied “trial expired / pending billing” state. 

So a trial user can pay/upgrade and still be blocked.

Minimal fix for now: **reject active trial upgrades**. Only allow paid Pulse → Edge until you intentionally design trial conversion.

```ts
import {
  HOSTED_PULSE_TRIAL_OFFER,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
} from "./billing-plans";

function assertHostedBillingPlanUpgradeSourceState(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
}) {
  const phase = parseHostedBillingPhase(input.billingRef?.currentBillingPhase);
  const offer = parseHostedBillingCheckoutOffer(input.billingRef?.currentCheckoutOffer);

  if (phase === "trial" || (offer === HOSTED_PULSE_TRIAL_OFFER && phase !== "paid")) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TRIAL_UNSUPPORTED",
      httpStatus: 409,
      message: "Finish trial billing before upgrading to Edge.",
    });
  }
}
```

Call that after reading `billingRef` and before Stripe mutation.

Also update Settings display so the button only shows for paid/non-trial Pulse, not every `launch_monthly` billing ref. Pass `currentBillingPhase` and `currentCheckoutOffer` into `HostedBillingSettings`, or derive a `canUpgradeToEdge` boolean server-side.

Longer-term, if you want “trial → paid Edge now,” do it explicitly: end the Stripe trial, charge immediately, clear/supersede trial metadata, and test the resulting `currentBillingPhase === "paid"` state. That is a bigger feature.

---

## High-priority cleanup: do not preserve trial metadata blindly

Even for paid users, preserving all old subscription metadata is a little too loose:

```ts
metadata: {
  ...subscription.metadata,
  billingPlanCode: targetPlanCode,
  memberId: input.memberId,
}
```

This is especially risky for `checkoutOffer`, `trialDurationDays`, `trialPolicyVersion`, and `trialUsageLimitUsdMicros`. 

Create a small metadata builder:

```ts
function buildHostedBillingPlanUpgradeSubscriptionMetadata(input: {
  memberId: string;
  targetPlanCode: "launch_edge_monthly";
  subscriptionMetadata: Stripe.Metadata | null | undefined;
}): Record<string, string> {
  return {
    memberId: input.memberId,
    billingPlanCode: input.targetPlanCode,
    checkoutOffer: "standard",
  };
}
```

If you need to preserve support/debug metadata, whitelist keys. Do not spread all subscription metadata into the new plan state.

This will also make `applyStripeSubscriptionUpdated` less likely to infer trial phase from stale metadata. 

---

## Medium: the service returns `upgraded` without verifying local reconciliation actually took

After Stripe returns an applied Edge subscription, the service calls:

```ts
await prisma.$transaction(async (tx) => {
  await applyStripeSubscriptionUpdated(...);
});

await resolveHostedAiUsageGate(...);
await nudgeHostedRunnerUserBestEffortResult(...);

return { status: "upgraded" };
```

But `applyStripeSubscriptionUpdated` returns `void`, and the service ignores whether the billing ref actually became Edge.  `writeHostedMemberStripeBillingTx` can no-op stale writes in some cases, and `applyStripeSubscriptionUpdated` can no-op if it cannot find the member. 

Minimal improvement: after inline reconciliation, read the billing ref or inspect the usage gate result.

```ts
const gate = await resolveHostedAiUsageGate({
  memberId: input.memberId,
  now,
  prisma,
});

if (gate.billingPlanCode !== targetPlanCode) {
  console.warn("Hosted plan upgrade applied in Stripe but local billing did not reflect target plan.", {
    memberIdSuffix: input.memberId.slice(-6),
    targetPlanCode,
    resolvedPlanCode: gate.billingPlanCode,
  });
}
```

Better: extract a helper that returns the post-reconciliation billing snapshot and assert it is Edge before telling the UI “upgraded.” Since webhooks remain canonical, I would not add a complicated new state unless you need it. A warning plus the retry/race fix may be enough.

---

## Medium: Pulse limit notice can suppress future Edge limit notice in the same period

This landed stack also added one-shot usage-limit notices. Linq now calls `claimHostedAiUsageLimitNotice` before sending an AI usage gate notice; if the period already has `limitNoticeSentAt`, it suppresses the notice. 

The upgrade service intentionally calls `resolveHostedAiUsageGate` after local reconciliation so the current period limit is raised from Pulse to Edge.  But the period notice timestamp is not plan/limit scoped. So this sequence can happen:

1. Pulse user hits Pulse limit.
2. Murph sends “upgrade to Edge.”
3. `limitNoticeSentAt` is set.
4. User upgrades to Edge.
5. Same period limit becomes Edge.
6. User later hits Edge limit.
7. Linq suppresses the Edge limit notice because `limitNoticeSentAt` is already set.

That may be intentional anti-spam behavior, but it is probably not what you want. The Edge limit is a different limit with different copy.

Minimal fix: when the usage period plan/limit is upgraded, clear `limitNoticeSentAt`.

Conceptually inside the period update path:

```ts
const limitIncreased = current.limitUsdMicros < resolved.limitUsdMicros;

data: {
  billingPlanCode: resolved.billingPlanCode,
  limitUsdMicros: resolved.limitUsdMicros,
  periodEnd: resolved.periodEnd,
  blockedAt: current.spentUsdMicros >= resolved.limitUsdMicros
    ? current.blockedAt ?? input.now
    : null,
  limitNoticeSentAt: limitIncreased ? null : current.limitNoticeSentAt,
  updatedAt: input.now,
}
```

More robust long-term: store a `limitNoticeKey` such as `${billingPlanCode}:${limitUsdMicros}:${periodStart}` rather than a bare timestamp.

---

## Medium: generic Stripe error mapping is safe but operationally too opaque

`callHostedStripePlanUpgradeOperation` catches every Stripe error and converts it into the same retryable `HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE` 502. 

That is safe for user-facing messages, but it erases useful distinctions:

* subscription not found
* invalid pending update parameters
* payment behavior not supported for current subscription state
* customer/subscription deleted
* Stripe temporary outage

I would keep the user message generic, but preserve sanitized operational detail in `details` or logs:

```ts
catch (error) {
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
    httpStatus: 502,
    message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
    retryable: true,
    details: describeSafeStripePlanChangeError(error),
  });
}
```

Do not include full Stripe object IDs or customer email. A sanitized `type`, `code`, `statusCode`, and `requestIdPresent` is enough.

---

## Maintainability nit: split “billing plan config” from “checkout config”

The service uses `requireHostedStripeCheckoutConfig` for a non-checkout plan mutation.  Functionally this works, but the name now leaks onboarding checkout semantics into plan changes.

I’d introduce:

```ts
requireHostedStripeBillingPlanConfig({ billingPlanCode })
```

Then have both checkout and upgrade call it. That keeps future billing operations from importing a “checkout” helper when they are not checkout.

This is not urgent, but it is exactly the kind of small naming seam that keeps the architecture clean as plan changes, add-ons, and usage-based pricing grow.

---

## Suggested minimal patch order

1. Add “Stripe already Edge” recovery before building Pulse item updates.
2. Reject trial / non-paid Pulse Trial upgrade attempts.
3. Replace metadata spreading with a small explicit metadata builder.
4. Add tests for:

   * local Pulse + Stripe already Edge recovers without `subscriptions.update`
   * Pulse Trial upgrade is rejected
   * trial metadata is not preserved into Edge metadata
   * period notice timestamp is cleared when limit increases, if you accept that behavior
5. Optionally verify post-reconciliation plan code before returning `upgraded`.

After those, the architecture is in good shape: narrow route, narrow service, Stripe as source of truth, existing webhook reconciliation, existing allowance gate, and no extra database model.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
