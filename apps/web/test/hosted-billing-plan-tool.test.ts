import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeHostedActionApproval: vi.fn(),
  createHostedBillingPortalSession: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  getPrisma: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requestHostedActionApproval: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  scheduleHostedBillingPlanSwitchToPulse: vi.fn(),
  startHostedPulseTrialPaidPlan: vi.fn(),
  upgradeHostedBillingPlan: vi.fn(),
}));

vi.mock("@/src/lib/action-approvals", () => ({
  consumeHostedActionApproval: mocks.consumeHostedActionApproval,
  requestHostedActionApproval: mocks.requestHostedActionApproval,
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/billing-portal-service", () => ({
  createHostedBillingPortalSession: mocks.createHostedBillingPortalSession,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plan-change-service", () => ({
  upgradeHostedBillingPlan: mocks.upgradeHostedBillingPlan,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitchToPulse:
    mocks.scheduleHostedBillingPlanSwitchToPulse,
}));
vi.mock("@/src/lib/hosted-onboarding/billing-start-paid-pulse-service", () => ({
  startHostedPulseTrialPaidPlan: mocks.startHostedPulseTrialPaidPlan,
}));
vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedFamilyAccessForMember: mocks.readHostedFamilyAccessForMember,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl:
    mocks.requireHostedOnboardingPublicBaseUrl,
}));

import { handleHostedRuntimeBillingPlanTool } from
  "@/src/lib/hosted-execution/billing-plan-tool";

describe("hosted runtime billing plan tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge",
        launch_monthly: "price_pulse",
      },
    });
    mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      suspendedAt: null,
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });
    const approved = {
      approvalGeneration: "a".repeat(64),
      approvalId: `haa_${"b".repeat(32)}`,
      status: "approved" as const,
    };
    mocks.requestHostedActionApproval.mockResolvedValue(approved);
    mocks.consumeHostedActionApproval.mockResolvedValue(approved);
  });

  it("returns canonical configured prices and eligibility without Stripe ids", async () => {
    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "read_status" },
    })).resolves.toEqual({
      action: "read_status",
      result: {
        billingStatus: "active",
        canStartPaidPulse: false,
        canSwitchToPulseAtRenewal: false,
        canUpgradeToEdge: true,
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        planPresentations: [
          {
            code: "launch_monthly",
            displayName: "Pulse",
            interval: "month",
            recurringAmountUsdCents: 800,
          },
          {
            code: "launch_edge_monthly",
            displayName: "Edge",
            interval: "month",
            recurringAmountUsdCents: 2_000,
          },
        ],
        portalAvailable: true,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
        sponsoredFamilyAccess: false,
      },
    });
  });

  it("does not advertise Edge when its canonical Stripe plan is not configured", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      stripePriceIdsByPlan: {
        launch_edge_monthly: null,
        launch_monthly: "price_pulse",
      },
    });
    const response = await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "read_status" },
    });
    expect(response).toMatchObject({
      result: {
        canUpgradeToEdge: false,
        planPresentations: [{ code: "launch_monthly" }],
      },
    });
  });

  it("does not advertise direct mutations to sponsored members", async () => {
    mocks.readHostedFamilyAccessForMember.mockResolvedValueOnce({
      groupId: "family_group",
      status: "active",
    });
    const response = await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "read_status" },
    });
    expect(response).toMatchObject({
      result: {
        canStartPaidPulse: false,
        canSwitchToPulseAtRenewal: false,
        canUpgradeToEdge: false,
        sponsoredFamilyAccess: true,
      },
    });
  });

  it("does not advertise Edge without active own billing and Stripe readiness", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const response = await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "read_status" },
    });
    expect(response).toMatchObject({
      result: { canUpgradeToEdge: false },
    });
  });

  it("does not advertise the portal to a suspended member", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: "active",
      suspendedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const response = await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "read_status" },
    });
    expect(response).toMatchObject({
      result: {
        canStartPaidPulse: false,
        canSwitchToPulseAtRenewal: false,
        canUpgradeToEdge: false,
        portalAvailable: false,
      },
    });
  });

  it("returns canonical paid-Pulse terms without approval or mutation for preview", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });

    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "start_paid_pulse", confirmed: false },
    })).resolves.toEqual({
      action: "start_paid_pulse",
      result: {
        presentation: {
          body: expect.stringContaining(
            "The trial ends now and Stripe will attempt the first subscription invoice immediately.",
          ),
          title: "Start paid Pulse?",
        },
        status: "confirmation_required",
      },
    });
    expect(mocks.requestHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.consumeHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
  });

  it("maps canonical billing no-ops and payment handoffs truthfully", async () => {
    mocks.upgradeHostedBillingPlan.mockResolvedValueOnce({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });
    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    })).resolves.toMatchObject({
      result: { status: "unchanged" },
    });

    mocks.startHostedPulseTrialPaidPlan.mockResolvedValueOnce({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/payment",
      status: "payment_required",
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });
    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "start_paid_pulse", confirmed: true },
    })).resolves.toEqual({
      action: "start_paid_pulse",
      result: {
        billingPlanCode: "launch_monthly",
        status: "browser_handoff",
        url: "https://billing.stripe.test/payment",
      },
    });
  });

  it("does not report stale inactive billing projections as unchanged", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: null,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });

    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_ACTION_UNAVAILABLE",
    });
    expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  });

  it("forwards the approved billing period to both canonical plan mutations", async () => {
    mocks.upgradeHostedBillingPlan.mockResolvedValueOnce({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });
    await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    });
    expect(mocks.upgradeHostedBillingPlan).toHaveBeenCalledWith({
      expectedCurrentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      memberId: "member_current",
      targetPlanCode: "launch_edge_monthly",
    });

    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });
    mocks.scheduleHostedBillingPlanSwitchToPulse.mockResolvedValueOnce({
      effectiveAt: "2026-09-01T00:00:00.000Z",
      scheduledBillingPlanCode: "launch_monthly",
      status: "scheduled",
    });
    await handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "switch_to_pulse_at_renewal", confirmed: true },
    });
    expect(mocks.scheduleHostedBillingPlanSwitchToPulse).toHaveBeenCalledWith({
      expectedCurrentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      memberId: "member_current",
    });
  });

  it("returns a canonical approval handoff without mutating billing", async () => {
    mocks.requestHostedActionApproval.mockResolvedValueOnce({
      approvalId: `haa_${"c".repeat(32)}`,
      approvalUrl: "https://withmurph.ai/approve/pending",
      expiresAt: "2026-07-10T16:15:00.000Z",
      status: "pending",
    });

    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: {
        action: "upgrade_to_edge",
        confirmed: true,
        returnContactKind: "text",
      },
    })).resolves.toEqual({
      action: "upgrade_to_edge",
      result: {
        approvalUrl: "https://withmurph.ai/approve/pending",
        expiresAt: "2026-07-10T16:15:00.000Z",
        status: "approval_required",
      },
    });

    expect(mocks.requestHostedActionApproval).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member_current",
      request: expect.objectContaining({
        actionKind: "billing.plan.upgrade-to-edge.v1",
        presentation: expect.objectContaining({
          body: expect.stringContaining("$20.00 USD per month"),
        }),
        returnContactKind: "text",
      }),
    }));
    expect(mocks.consumeHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  });

  it.each(["denied", "expired"] as const)(
    "does not mutate when approval is %s",
    async (status) => {
      mocks.requestHostedActionApproval.mockResolvedValueOnce({
        approvalId: `haa_${"d".repeat(32)}`,
        status,
      });

      await expect(handleHostedRuntimeBillingPlanTool({
        memberId: "member_current",
        request: { action: "upgrade_to_edge", confirmed: true },
      })).resolves.toMatchObject({
        result: {
          status: status === "denied" ? "approval_denied" : "approval_expired",
        },
      });
      expect(mocks.consumeHostedActionApproval).not.toHaveBeenCalled();
      expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
    },
  );

  it("does not mutate when an approved challenge expires during consume", async () => {
    mocks.consumeHostedActionApproval.mockResolvedValueOnce({
      approvalId: `haa_${"b".repeat(32)}`,
      status: "expired",
    });

    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    })).resolves.toMatchObject({ result: { status: "approval_expired" } });
    expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  });

  it("lets only one simultaneous execution consume approval and mutate", async () => {
    const approvalId = `haa_${"b".repeat(32)}`;
    const approved = {
      approvalGeneration: "a".repeat(64),
      approvalId,
      status: "approved" as const,
    };
    let winningConsumerId: string | null = null;
    mocks.requestHostedActionApproval.mockResolvedValue(approved);
    mocks.consumeHostedActionApproval.mockImplementation(async (input) => {
      const consumerId = input.request.consumerId;
      if (winningConsumerId === null) {
        winningConsumerId = consumerId;
        return approved;
      }
      return { approvalId, status: "expired" as const };
    });
    mocks.upgradeHostedBillingPlan.mockResolvedValue({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    const outcomes = await Promise.all([
      handleHostedRuntimeBillingPlanTool({
        memberId: "member_current",
        request: { action: "upgrade_to_edge", confirmed: true },
      }),
      handleHostedRuntimeBillingPlanTool({
        memberId: "member_current",
        request: { action: "upgrade_to_edge", confirmed: true },
      }),
    ]);

    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upgrade_to_edge",
        result: expect.objectContaining({ status: "applied" }),
      }),
      expect.objectContaining({
        action: "upgrade_to_edge",
        result: expect.objectContaining({ status: "approval_expired" }),
      }),
    ]));
    const consumerIds = mocks.consumeHostedActionApproval.mock.calls.map(
      ([call]) => call.request.consumerId,
    );
    expect(new Set(consumerIds).size).toBe(2);
    expect(mocks.upgradeHostedBillingPlan).toHaveBeenCalledTimes(1);
  });

  it("returns an already-applied upgrade unchanged without replaying approval", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_member",
      stripeSubscriptionId: "sub_member",
    });

    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    })).resolves.toMatchObject({ result: { status: "unchanged" } });
    expect(mocks.requestHostedActionApproval).not.toHaveBeenCalled();
    expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  });

  it("rejects direct billing mutations for sponsored members even when confirmed", async () => {
    mocks.readHostedFamilyAccessForMember.mockResolvedValueOnce({
      groupId: "family_group",
      status: "active",
    });
    await expect(handleHostedRuntimeBillingPlanTool({
      memberId: "member_current",
      request: { action: "upgrade_to_edge", confirmed: true },
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_DIRECT_MUTATION_SPONSORED_UNSUPPORTED",
    });
    expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  });
});
