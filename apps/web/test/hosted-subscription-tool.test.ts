import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimSubscriptionAction: vi.fn(),
  createCheckout: vi.fn(),
  getPrisma: vi.fn(),
  issueInvite: vi.fn(),
  readBillingEligibilityState: vi.fn(),
  readMemberCoreState: vi.fn(),
  schedulePlanSwitch: vi.fn(),
  upgradePlan: vi.fn(),
  verifyBillingPlanQuote: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  claimHostedMailboxConversationSubscriptionAction:
    mocks.claimSubscriptionAction,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createCheckout,
}));
vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.issueInvite,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plan-change-service", () => ({
  upgradeHostedBillingPlan: mocks.upgradePlan,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitch: mocks.schedulePlanSwitch,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plan-quote", () => ({
  buildHostedBillingPlanQuoteState: vi.fn((input) => input),
  verifyHostedBillingPlanQuote: mocks.verifyBillingPlanQuote,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState:
    mocks.readBillingEligibilityState,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readMemberCoreState,
}));

import { handleHostedSubscriptionTool } from "@/src/lib/hosted-execution/subscription-tool";

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;

const PULSE_PLAN = {
  code: "launch_monthly",
  displayName: "Pulse",
  interval: "month",
  recurringAmountUsdCents: 800,
} as const;

describe("hosted subscription tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "prisma" });
    mocks.claimSubscriptionAction.mockResolvedValue("claimed");
    mocks.issueInvite.mockResolvedValue({ inviteCode: "invite_123" });
    mocks.readMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    });
    mocks.readBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      hasStripeCustomerId: false,
      hasStripeSubscriptionId: false,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
  });

  it("fails before billing when the accepted input has no action authority", async () => {
    mocks.claimSubscriptionAction.mockResolvedValue(null);

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "start_pulse_now",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_SUBSCRIPTION_INPUT_AUTHORITY_INVALID",
      httpStatus: 403,
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("routes the legacy Pulse action through ordinary Stripe Checkout", async () => {
    mocks.createCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://checkout.stripe.com/c/pay/cs_123",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "start_pulse_now",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "start_pulse_now",
      paymentUrl: "https://checkout.stripe.com/c/pay/cs_123",
      plan: PULSE_PLAN,
      status: "payment_required",
    });
    expect(mocks.issueInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
      prisma: { label: "prisma" },
    });
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      billingPlanCode: "launch_monthly",
      inviteCode: "invite_123",
      member: { id: "member_123", suspendedAt: null },
      prisma: { label: "prisma" },
    });
  });

  it.each([
    ["Edge", "launch_edge_monthly", "cs_edge"],
    ["Max", "launch_max_monthly", "cs_max"],
  ] as const)(
    "uses the same Checkout owner for a quoted Starter-to-%s change",
    async (_planName, targetPlanCode, sessionId) => {
      mocks.verifyBillingPlanQuote.mockReturnValue("now");
      mocks.createCheckout.mockResolvedValue({
        alreadyActive: false,
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      });

      await expect(handleHostedSubscriptionTool({
        memberId: "member_123",
        request: {
          action: "change_plan",
          assistantInputId: ASSISTANT_INPUT_ID,
          quoteId: `quote_${targetPlanCode}`,
          targetPlanCode,
        },
      })).resolves.toMatchObject({
        action: "change_plan",
        paymentUrl: `https://checkout.stripe.com/c/pay/${sessionId}`,
        plan: { code: targetPlanCode },
        status: "payment_required",
      });
      expect(mocks.createCheckout).toHaveBeenCalledWith({
        billingPlanCode: targetPlanCode,
        inviteCode: "invite_123",
        member: { id: "member_123", suspendedAt: null },
        prisma: { label: "prisma" },
      });
      expect(mocks.upgradePlan).not.toHaveBeenCalled();
      expect(mocks.schedulePlanSwitch).not.toHaveBeenCalled();
    },
  );

  it("keeps paid immediate upgrades on the existing upgrade owner", async () => {
    mocks.readBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    mocks.verifyBillingPlanQuote.mockReturnValue("immediate");
    mocks.upgradePlan.mockResolvedValue({ status: "already_on_plan" });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "quote_edge",
        targetPlanCode: "launch_edge_monthly",
      },
    })).resolves.toMatchObject({
      action: "change_plan",
      status: "no_action_required",
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});
