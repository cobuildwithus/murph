import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseHostedPlanUsageStatus } from "@murphai/hosted-execution/plan-usage";
import { parseHostedRuntimeSubscriptionToolRequest } from "@murphai/hosted-execution/subscription";

import {
  assertHostedBillingPlanSelectable,
  hasConfirmedHostedGroupMembership,
  resolveVisibleHostedBillingPlanCodes,
} from "@/src/lib/hosted-onboarding/billing-plan-eligibility";
import {
  canScheduleHostedBillingPlanChange,
  canUpgradeHostedBillingPlan,
  formatHostedBillingPrice,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedBillingPlanCodeForPlan,
  getHostedBillingPlanDefinition,
  listHostedBillingPlanPresentations,
  parseHostedBillingPlanCode,
  parseHostedPublicBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";

describe("hosted Core plan policy", () => {
  it("defines Core as a $3.50 Pulse-runtime plan with $2.80 of included AI cost", () => {
    expect(getHostedBillingPlanDefinition("launch_group_monthly")).toMatchObject({
      displayName: "Core",
      planCode: "pulse",
      recurringAmountUsdCents: 350,
    });
    expect(
      getHostedAiUsageMonthlyAllowanceUsdMicros("launch_group_monthly"),
    ).toBe(2_800_000n);
    expect(formatHostedBillingPrice(350)).toBe("$3.50");
    expect(formatHostedBillingPrice(800)).toBe("$8");
  });

  it("keeps Pulse as the canonical runtime-to-billing default", () => {
    expect(getHostedBillingPlanCodeForPlan("pulse")).toBe("launch_monthly");
  });

  it("keeps Core out of public signup catalogs and mutation parsing", () => {
    expect(
      listHostedBillingPlanPresentations().map((plan) => plan.code),
    ).toEqual(["launch_monthly", "launch_edge_monthly"]);
    expect(parseHostedBillingPlanCode("launch_group_monthly")).toBe(
      "launch_group_monthly",
    );
    expect(parseHostedPublicBillingPlanCode("launch_group_monthly")).toBeNull();
  });

  it("supports paid Core upgrades and period-end Core changes", () => {
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_group_monthly",
      currentCheckoutOffer: "standard",
      targetPlanCode: "launch_monthly",
    })).toBe(true);
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_group_monthly",
      currentCheckoutOffer: "standard",
      targetPlanCode: "launch_edge_monthly",
    })).toBe(true);
    expect(canScheduleHostedBillingPlanChange({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      stripeCustomerId: "cus_group",
      stripeSubscriptionId: "sub_group",
      suspendedAt: null,
      targetPlanCode: "launch_group_monthly",
    })).toBe(true);
    expect(canScheduleHostedBillingPlanChange({
      billingStatus: "active",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      stripeCustomerId: "cus_trial",
      stripeSubscriptionId: "sub_trial",
      suspendedAt: null,
      targetPlanCode: "launch_group_monthly",
    })).toBe(false);
  });

  it("shows Core only for eligible, current, or scheduled members", () => {
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: null,
      groupPlanConfigured: true,
      hasConfirmedGroupMembership: false,
      scheduledPlanCode: null,
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: null,
      groupPlanConfigured: true,
      hasConfirmedGroupMembership: true,
      scheduledPlanCode: null,
    })[0]).toBe("launch_group_monthly");
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_group_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      scheduledPlanCode: null,
    })[0]).toBe("launch_group_monthly");
    expect(resolveVisibleHostedBillingPlanCodes({
      currentPlanCode: "launch_monthly",
      groupPlanConfigured: false,
      hasConfirmedGroupMembership: false,
      scheduledPlanCode: "launch_group_monthly",
    })[0]).toBe("launch_group_monthly");
  });

  it("uses confirmed canonical membership as the authorization source", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "hgm_owner" })
      .mockResolvedValueOnce(null);
    const prisma = {
      hostedGroupMember: { findFirst },
    } as never;

    await expect(hasConfirmedHostedGroupMembership({
      memberId: "member_group",
      prisma,
    })).resolves.toBe(true);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      select: { id: true },
      where: {
        memberId: "member_group",
        OR: [{ role: "owner" }, { joinedAt: { not: null } }],
      },
    });
    await expect(assertHostedBillingPlanSelectable({
      memberId: "member_no_group",
      prisma,
      targetPlanCode: "launch_group_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
      message: "The Core plan is available while you're part of a Murph group.",
    });
  });

  it("accepts Group usage status and conversational Pulse upgrades", () => {
    const status = parseHostedPlanUsageStatus({
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-07-27T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_group_monthly",
      planName: "Group",
      recommendedAction: {
        kind: "change_plan",
        label: "Upgrade to Pulse ($8/month)",
        targetPlanCode: "launch_monthly",
        url: "https://example.test/settings#subscription",
      },
      remainingPercent: 0,
      status: "exhausted",
      subscriptionActionQuote: {
        action: "change_plan",
        expiresAt: "2026-07-27T00:10:00.000Z",
        label: "Upgrade to Pulse ($8/month)",
        monthlyPriceUsdCents: 800,
        quoteId: "quote_test_pulse",
        targetPlanCode: "launch_monthly",
        timing: "immediate",
      },
      usedPercent: 100,
    });

    expect(status.status).toBe("exhausted");
    if (status.status === "unavailable") {
      throw new Error("Expected an available Group usage status.");
    }
    expect(status.planName).toBe("Group");
    expect(parseHostedRuntimeSubscriptionToolRequest({
      action: "change_plan",
      quoteId: "quote_test_pulse",
      targetPlanCode: "launch_monthly",
    })).toEqual({
      action: "change_plan",
      quoteId: "quote_test_pulse",
      targetPlanCode: "launch_monthly",
    });
  });
});
