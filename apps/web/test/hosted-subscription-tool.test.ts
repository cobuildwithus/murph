import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimSubscriptionAction: vi.fn(),
  continuePulse: vi.fn(),
  getPrisma: vi.fn(),
  readBillingEligibilityState: vi.fn(),
  readMemberCoreState: vi.fn(),
  schedulePlanSwitch: vi.fn(),
  startPulse: vi.fn(),
  startTrialPaidPlan: vi.fn(),
  upgradePlan: vi.fn(),
  verifyBillingPlanQuote: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  claimHostedMailboxConversationSubscriptionAction:
    mocks.claimSubscriptionAction,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-start-paid-pulse-service", () => ({
  continueHostedPulseTrialPaidPlan: mocks.continuePulse,
  startHostedPulseTrialPaidPlan: mocks.startPulse,
  startHostedTrialPaidPlan: mocks.startTrialPaidPlan,
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

import {
  handleHostedSubscriptionTool,
} from "@/src/lib/hosted-execution/subscription-tool";

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const PULSE_PLAN = {
  code: "launch_monthly",
  displayName: "Pulse",
  interval: "month",
  recurringAmountUsdCents: 800,
} as const;
const GROUP_PLAN = {
  code: "launch_group_monthly",
  displayName: "Group",
  interval: "month",
  recurringAmountUsdCents: 350,
} as const;
const EDGE_PLAN = {
  code: "launch_edge_monthly",
  displayName: "Edge",
  interval: "month",
  recurringAmountUsdCents: 2_000,
} as const;

describe("hosted subscription tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "prisma" });
    mocks.claimSubscriptionAction.mockResolvedValue("claimed");
    mocks.readMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    });
    mocks.readBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: new Date("2026-08-12T00:00:00.000Z"),
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    mocks.verifyBillingPlanQuote.mockReturnValue("at_trial_end");
  });

  it("rejects an action without live member-bound conversation authority before billing", async () => {
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

    expect(mocks.claimSubscriptionAction).toHaveBeenCalledWith({
      action: "start_pulse_now",
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_123",
      prisma: { label: "prisma" },
    });
    expect(mocks.continuePulse).not.toHaveBeenCalled();
    expect(mocks.startPulse).not.toHaveBeenCalled();
    expect(mocks.upgradePlan).not.toHaveBeenCalled();
  });

  it("rejects a different action already claimed by the same input before billing", async () => {
    mocks.claimSubscriptionAction.mockResolvedValue("conflict");

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "upgrade_edge",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_SUBSCRIPTION_INPUT_ACTION_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.claimSubscriptionAction).toHaveBeenCalledWith({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_123",
      prisma: { label: "prisma" },
    });
    expect(mocks.continuePulse).not.toHaveBeenCalled();
    expect(mocks.startPulse).not.toHaveBeenCalled();
    expect(mocks.upgradePlan).not.toHaveBeenCalled();
  });

  it("allows an idempotent replay of the action claimed by the same input", async () => {
    mocks.claimSubscriptionAction.mockResolvedValue("replayed");
    mocks.startPulse.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "start_pulse_now",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "start_pulse_now",
      plan: PULSE_PLAN,
      status: "completed",
    });

    expect(mocks.startPulse).toHaveBeenCalledTimes(1);
  });

  it("keeps a card-backed Pulse trial unchanged and returns no payment handoff", async () => {
    mocks.continuePulse.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: "continuing",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "continue_pulse",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "continue_pulse",
      plan: PULSE_PLAN,
      status: "no_action_required",
    });

    expect(mocks.continuePulse).toHaveBeenCalledWith({
      memberId: "member_123",
      paymentMethodContinuation: "conversation",
      prisma: { label: "prisma" },
    });
    expect(mocks.claimSubscriptionAction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.continuePulse.mock.invocationCallOrder[0]!,
    );
  });

  it("returns only the Stripe-hosted payment URL when Pulse needs payment details", async () => {
    mocks.startPulse.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "payment_required",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "start_pulse_now",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "start_pulse_now",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      plan: PULSE_PLAN,
      status: "payment_required",
    });

    expect(mocks.startPulse).toHaveBeenCalledWith({
      memberId: "member_123",
      paymentMethodContinuation: "conversation",
      prisma: { label: "prisma" },
    });
  });

  it("returns the authoritative effective time for a scheduled Group plan", async () => {
    mocks.startTrialPaidPlan.mockResolvedValue({
      effectiveAt: "2026-08-12T00:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "quote_group_123",
        targetPlanCode: "launch_group_monthly",
      },
    })).resolves.toEqual({
      action: "change_plan",
      effectiveAt: "2026-08-12T00:00:00.000Z",
      plan: GROUP_PLAN,
      status: "scheduled",
    });

    expect(mocks.verifyBillingPlanQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_123",
        quoteId: "quote_group_123",
        targetPlanCode: "launch_group_monthly",
      }),
    );
    expect(mocks.claimSubscriptionAction).toHaveBeenCalledWith({
      action: "change_plan",
      actionClaim: expect.stringMatching(
        /^change_plan:launch_group_monthly:[0-9a-f]{64}$/u,
      ),
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_123",
      prisma: { label: "prisma" },
    });
    expect(mocks.startTrialPaidPlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_group_monthly",
      timing: "at_trial_end",
    });
  });

  it("fails a stale Group quote before consuming conversation authority", async () => {
    mocks.verifyBillingPlanQuote.mockImplementationOnce(() => {
      throw Object.assign(new Error("Quote stale."), {
        code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
      });
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "quote_group_stale",
        targetPlanCode: "launch_group_monthly",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
    });

    expect(mocks.claimSubscriptionAction).not.toHaveBeenCalled();
    expect(mocks.startTrialPaidPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["started", "completed"],
    ["billing_pending", "pending"],
  ] as const)("maps Pulse %s to %s", async (billingStatus, responseStatus) => {
    mocks.startPulse.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: billingStatus,
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "start_pulse_now",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "start_pulse_now",
      plan: PULSE_PLAN,
      status: responseStatus,
    });
  });

  it("upgrades to Edge through the canonical plan-change owner", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "upgrade_edge",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "upgrade_edge",
      plan: EDGE_PLAN,
      status: "completed",
    });

    expect(mocks.upgradePlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_edge_monthly",
    });
  });

  it("returns the Edge Billing Portal URL while payment is pending", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "pending_payment",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "upgrade_edge",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "upgrade_edge",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      plan: EDGE_PLAN,
      status: "payment_required",
    });
  });

  it("treats an already-active Edge plan as no action required", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "upgrade_edge",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "upgrade_edge",
      plan: EDGE_PLAN,
      status: "no_action_required",
    });
  });
});
