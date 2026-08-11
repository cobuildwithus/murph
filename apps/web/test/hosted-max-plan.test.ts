import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  parseHostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";
import {
  parseHostedRuntimeSubscriptionToolRequest,
  parseHostedRuntimeSubscriptionToolResponse,
} from "@murphai/hosted-execution/subscription";

import { isHostedMemberSolModelEligible } from "@/src/lib/hosted-onboarding/assistant-model-preference";
import {
  canScheduleHostedBillingPlanChange,
  canUpgradeHostedBillingPlan,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedBillingPlanDefinition,
  isHostedBillingPlanChangePortalConfigured,
  readHostedBillingPlanChangePortalConfigurationId,
  resolveConfiguredHostedBillingPlanCodes,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  resolveVisibleHostedBillingPlanCodes,
} from "@/src/lib/hosted-onboarding/billing-plan-eligibility";

describe("Murph Max billing plan", () => {
  it("defines Max as a $50 direct plan with the existing premium runtime entitlement", () => {
    expect(getHostedBillingPlanDefinition("launch_max_monthly")).toEqual({
      badge: "New",
      code: "launch_max_monthly",
      displayName: "Max",
      interval: "month",
      planChangePortalConfigurationIdEnvKey:
        "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MAX_MONTHLY",
      planCode: "edge",
      priceIdEnvKey:
        "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
      recurringAmountUsdCents: 5_000,
    });
    expect(getHostedAiUsageMonthlyAllowanceUsdMicros("launch_max_monthly"))
      .toBe(40_000_000n);
  });

  it("fails closed until the exact Max plan-change portal is configured", () => {
    expect(isHostedBillingPlanChangePortalConfigured(
      "launch_max_monthly",
      {},
    )).toBe(false);
    expect(readHostedBillingPlanChangePortalConfigurationId(
      "launch_max_monthly",
      {
        HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MAX_MONTHLY:
          "  bpc_max  ",
      },
    )).toBe("bpc_max");
  });

  it("discovers Max only when its Stripe price is configured", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge",
        launch_max_monthly: null,
        launch_monthly: "price_pulse",
      },
    })).toEqual([
      "launch_monthly",
      "launch_edge_monthly",
    ]);

    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge",
        launch_max_monthly: "price_max",
        launch_monthly: "price_pulse",
      },
    })).toEqual([
      "launch_monthly",
      "launch_edge_monthly",
      "launch_max_monthly",
    ]);
  });

  it("supports immediate upgrades into Max and period-end downgrades out of it", () => {
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      targetPlanCode: "launch_max_monthly",
    })).toBe(true);
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      targetPlanCode: "launch_max_monthly",
    })).toBe(true);
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      targetPlanCode: "launch_max_monthly",
    })).toBe(false);

    const maxBillingState = {
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_max_monthly",
      currentCheckoutOffer: "standard",
      stripeCustomerId: "cus_max",
      stripeSubscriptionId: "sub_max",
      suspendedAt: null,
    } as const;
    expect(canScheduleHostedBillingPlanChange({
      ...maxBillingState,
      targetPlanCode: "launch_edge_monthly",
    })).toBe(true);
    expect(canScheduleHostedBillingPlanChange({
      ...maxBillingState,
      targetPlanCode: "launch_monthly",
    })).toBe(true);
  });

  it("fails closed in Settings until Max is configured, while retaining active and scheduled Max states", () => {
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_edge_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      maxPlanConfigured: false,
      scheduledPlanCode: null,
    })).toEqual([
      "launch_monthly",
      "launch_edge_monthly",
    ]);
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_edge_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      maxPlanConfigured: true,
      scheduledPlanCode: null,
    })).toEqual([
      "launch_monthly",
      "launch_edge_monthly",
      "launch_max_monthly",
    ]);
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_max_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      maxPlanConfigured: false,
      scheduledPlanCode: null,
    })).toContain("launch_max_monthly");
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_edge_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      maxPlanConfigured: false,
      scheduledPlanCode: "launch_max_monthly",
    })).toContain("launch_max_monthly");
  });

  it("keeps Sol available to active paid Max members", () => {
    expect(isHostedMemberSolModelEligible({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_max_monthly",
      isThreadContainerMember: false,
      suspendedAt: null,
    })).toBe(true);
  });

  it("accepts Max in the assistant plan-usage and subscription contracts", () => {
    expect(parseHostedPlanUsageStatus({
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-08-07T20:00:00.000Z",
      periodEnd: "2026-09-07T20:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-08-07T20:00:00.000Z",
      planCode: "launch_max_monthly",
      planName: "Max",
      recommendedAction: null,
      remainingPercent: 100,
      status: "active",
      subscriptionActionQuote: null,
      usedPercent: 0,
    })).toMatchObject({
      planCode: "launch_max_monthly",
      planName: "Max",
    });

    expect(parseHostedRuntimeSubscriptionToolRequest({
      action: "change_plan",
      quoteId: "quote_max",
      targetPlanCode: "launch_max_monthly",
    })).toEqual({
      action: "change_plan",
      quoteId: "quote_max",
      targetPlanCode: "launch_max_monthly",
    });

    expect(parseHostedRuntimeSubscriptionToolResponse({
      action: "change_plan",
      plan: {
        code: "launch_max_monthly",
        displayName: "Max",
        interval: "month",
        recurringAmountUsdCents: 5_000,
      },
      status: "completed",
    })).toMatchObject({
      plan: {
        code: "launch_max_monthly",
        displayName: "Max",
      },
      status: "completed",
    });
  });
});
