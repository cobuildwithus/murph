import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedMemberBillingEligibilityState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readHostedMemberBillingEligibilityState,
}));

import { readHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";

const NOW = new Date("2026-04-09T12:00:00.000Z");
const TRIAL_START = new Date("2026-04-01T12:00:00.000Z");
const TRIAL_END = new Date("2026-04-08T12:00:00.000Z");

describe("hosted plan usage production gate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
  });

  it("projects a Start Pulse path from the real paused expired-trial gate", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
    });

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_trial",
      now: NOW,
      prisma: buildPrisma({
        billingStatus: HostedBillingStatus.paused,
        suspendedAt: null,
      }) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      availablePlans: [
        {
          code: "launch_monthly",
          displayName: "Pulse",
          monthlyPriceUsdCents: 800,
          selectable: true,
        },
      ],
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedPlanCode: "launch_monthly",
      recommendedAction: {
        kind: "change_plan",
        label: "Start Pulse now ($8/month)",
        targetPlanCode: "launch_monthly",
        url: "https://example.test/settings#subscription",
      },
      status: "unavailable",
    });
  });

  it.each([
    {
      billingStatus: HostedBillingStatus.canceled,
      name: "canceled",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.paused,
      name: "suspended",
      suspendedAt: new Date("2026-04-09T11:00:00.000Z"),
    },
  ])("keeps $name trial access generic and action-free", async ({
    billingStatus,
    suspendedAt,
  }) => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus,
      suspendedAt,
    });

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_trial",
      now: NOW,
      prisma: buildPrisma({ billingStatus, suspendedAt }) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "hosted_access_inactive",
      recommendedAction: null,
      status: "unavailable",
    });
  });
});

function buildPrisma(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt: Date | null;
}) {
  return {
    hostedAccountGroupMembership: {
      findFirst: vi.fn(async () => null),
    },
    hostedGroupMember: {
      findFirst: vi.fn(async () => null),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          currentPeriodEnd: TRIAL_END,
          currentPeriodStart: TRIAL_START,
          currentTrialEndsAt: TRIAL_END,
          currentTrialStartedAt: TRIAL_START,
          pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
          pulseTrialRedeemedAt: null,
        },
        billingStatus: input.billingStatus,
        id: "member_trial",
        suspendedAt: input.suspendedAt,
        threadContainer: null,
      })),
    },
  };
}
