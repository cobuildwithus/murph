import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimSubscriptionAction: vi.fn(),
  continuePulse: vi.fn(),
  getPrisma: vi.fn(),
  readBillingState: vi.fn(),
  readMember: vi.fn(),
  schedulePlan: vi.fn(),
  startPulse: vi.fn(),
  startTrialPlan: vi.fn(),
  upgradePlan: vi.fn(),
  verifyQuote: vi.fn(),
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
  startHostedTrialPaidPlan: mocks.startTrialPlan,
  startHostedPulseTrialPaidPlan: mocks.startPulse,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-change-service", () => ({
  upgradeHostedBillingPlan: mocks.upgradePlan,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitch: mocks.schedulePlan,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-quote", () => ({
  buildHostedBillingPlanQuoteState: vi.fn((input) => input),
  verifyHostedBillingPlanQuote: mocks.verifyQuote,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readBillingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readMember,
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
const EDGE_PLAN = {
  code: "launch_edge_monthly",
  displayName: "Edge",
  interval: "month",
  recurringAmountUsdCents: 2_000,
} as const;
const GROUP_PLAN = {
  code: "launch_group_monthly",
  displayName: "Group",
  interval: "month",
  recurringAmountUsdCents: 350,
} as const;

describe("hosted subscription tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "prisma" });
    mocks.claimSubscriptionAction.mockResolvedValue("claimed");
    mocks.readBillingState.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_group_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingPlanCode: null,
    });
    mocks.readMember.mockResolvedValue({
      billingStatus: "active",
      suspendedAt: null,
    });
    mocks.verifyQuote.mockReturnValue("immediate");
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

  it("upgrades Group to Pulse through the canonical plan-change owner", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: "upgraded",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "upgrade_pulse",
        assistantInputId: ASSISTANT_INPUT_ID,
      },
    })).resolves.toEqual({
      action: "upgrade_pulse",
      plan: PULSE_PLAN,
      status: "completed",
    });

    expect(mocks.upgradePlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_monthly",
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

  it("returns the Edge Stripe payment URL when payment action is required", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "payment_required",
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

  it("keeps a processing Edge invoice as pending without a payment URL", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: "processing",
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
      status: "pending",
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

  it("starts an explicitly quoted Group trial immediately on the same plan service", async () => {
    mocks.verifyQuote.mockReturnValue("now");
    mocks.startTrialPlan.mockResolvedValue({
      billingPlanCode: "launch_group_monthly",
      status: "started",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "signed-group-quote",
        targetPlanCode: "launch_group_monthly",
      },
    })).resolves.toEqual({
      action: "change_plan",
      plan: GROUP_PLAN,
      status: "completed",
    });

    expect(mocks.startTrialPlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_group_monthly",
      timing: "now",
    });
    expect(mocks.claimSubscriptionAction).toHaveBeenCalledWith({
      action: "change_plan",
      actionClaim: expect.stringMatching(
        /^change_plan:launch_group_monthly:[0-9a-f]{64}$/u,
      ),
      assistantInputId: ASSISTANT_INPUT_ID,
      memberId: "member_123",
      prisma: { label: "prisma" },
    });
  });

  it("schedules an explicitly quoted Group trial choice on the same plan service", async () => {
    mocks.verifyQuote.mockReturnValue("at_trial_end");
    mocks.startTrialPlan.mockResolvedValue({
      effectiveAt: "2026-08-02T04:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "signed-group-trial-quote",
        targetPlanCode: "launch_group_monthly",
      },
    })).resolves.toEqual({
      action: "change_plan",
      plan: GROUP_PLAN,
      status: "completed",
    });
    expect(mocks.startTrialPlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_group_monthly",
      timing: "at_trial_end",
    });
    expect(mocks.schedulePlan).not.toHaveBeenCalled();
  });

  it("dispatches a quoted period-end downgrade through the generic switch owner", async () => {
    mocks.verifyQuote.mockReturnValue("period_end");
    mocks.schedulePlan.mockResolvedValue({
      billingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "signed-downgrade-quote",
        targetPlanCode: "launch_group_monthly",
      },
    })).resolves.toMatchObject({
      action: "change_plan",
      plan: GROUP_PLAN,
      status: "completed",
    });
    expect(mocks.schedulePlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_group_monthly",
    });
  });

  it("dispatches a quoted Group to Pulse upgrade through the generic upgrade owner", async () => {
    mocks.upgradePlan.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      status: "upgraded",
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "signed-upgrade-quote",
        targetPlanCode: "launch_monthly",
      },
    })).resolves.toMatchObject({
      action: "change_plan",
      plan: PULSE_PLAN,
      status: "completed",
    });
    expect(mocks.upgradePlan).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "prisma" },
      targetPlanCode: "launch_monthly",
    });
  });

  it("rejects a stale quote before consuming conversation authority or billing", async () => {
    mocks.verifyQuote.mockImplementation(() => {
      throw new Error("stale quote");
    });

    await expect(handleHostedSubscriptionTool({
      memberId: "member_123",
      request: {
        action: "change_plan",
        assistantInputId: ASSISTANT_INPUT_ID,
        quoteId: "stale-quote",
        targetPlanCode: "launch_monthly",
      },
    })).rejects.toThrow("stale quote");

    expect(mocks.claimSubscriptionAction).not.toHaveBeenCalled();
    expect(mocks.startTrialPlan).not.toHaveBeenCalled();
    expect(mocks.schedulePlan).not.toHaveBeenCalled();
    expect(mocks.upgradePlan).not.toHaveBeenCalled();
  });
});
