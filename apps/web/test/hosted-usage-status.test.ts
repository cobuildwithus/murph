import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedAiUsageGate: vi.fn(),
  readHostedMemberBillingEligibilityState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: () => "https://example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readHostedMemberBillingEligibilityState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

import {
  projectHostedPersonalAiUsageStatus,
  readHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import type {
  HostedAiUsageGateDecisionWithSource,
} from "@/src/lib/hosted-execution/usage-allowance";

const NOW = new Date("2026-07-03T12:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-07-11T00:00:00.000Z");

describe("readHostedPersonalAiUsageStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
  });

  it("returns an evidence-backed trial forecast and server-selected Pulse action", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_trial",
      limitUsdMicros: 4_500_000n,
      remainingUsdMicros: 2_250_000n,
      spentUsdMicros: 2_250_000n,
    }));
    const prisma = buildPrisma(new Date("2026-07-01T12:00:00.000Z"));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_usage_1",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      accessKind: "trial",
      forecast: {
        estimatedDaysRemaining: 2,
        estimatedExhaustionAt: "2026-07-05T12:00:00.000Z",
      },
      generatedAt: NOW.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      periodKind: "trial",
      periodStart: PERIOD_START.toISOString(),
      planCode: "launch_monthly",
      planName: "Pulse Trial",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse now ($8/month)",
        url: "https://example.test/settings#subscription",
      },
      remainingPercent: 50,
      status: "active",
      usedPercent: 50,
    });
  });

  it("recommends Edge for a paid Pulse member only after the usage threshold", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_2",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    });

    expect(result).toMatchObject({
      accessKind: "paid",
      planName: "Pulse",
      recommendedAction: {
        kind: "upgrade_edge",
      },
      remainingPercent: 15,
      status: "active",
      usedPercent: 85,
    });
    expect(JSON.stringify(result)).not.toMatch(/UsdMicros|token|dollar/iu);
  });

  it("returns current Edge terms for an explicit request below the recommendation threshold", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_explicit_edge",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "upgrade_edge",
        label: "Upgrade to Edge ($20/month)",
      },
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberBillingEligibilityState).toHaveBeenCalledTimes(1);
  });

  it("returns current Pulse terms for an explicit trial request below the recommendation threshold", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_trial",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_explicit_pulse",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "start_pulse_now",
        label: "Start Pulse now ($8/month)",
      },
      usedPercent: 10,
    });
  });

  it("omits the quote field for callers that keep the original empty request shape", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_legacy_shape",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    });

    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(result).toMatchObject({
      recommendedAction: null,
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it.each([
    [
      "thresholded paid usage",
      buildDecision({
        allowanceSource: "direct_paid_member_plan",
        limitUsdMicros: 10_000_000n,
        remainingUsdMicros: 1_500_000n,
        spentUsdMicros: 8_500_000n,
      }),
      {
        recommendedAction: null,
        status: "active",
        usedPercent: 85,
      },
    ],
    [
      "trial conversion",
      buildDecision({
        allowed: false,
        allowanceSource: "direct_trial",
        reason: "trial_expired_pending_billing",
        spentUsdMicros: 0n,
      }),
      {
        reason: "trial_conversion_pending",
        recommendedAction: null,
        status: "unavailable",
      },
    ],
  ] as const)(
    "avoids action-state fanout for legacy %s without an action URL",
    async (_caseName, decision, expected) => {
      mocks.readHostedAiUsageGate.mockResolvedValue(decision);

      const result = await readHostedPersonalAiUsageStatus({
        memberId: "member_usage_legacy_no_url",
        now: NOW,
        prisma: buildPrisma(null) as never,
        publicBaseUrl: null,
      });

      expect(result).toMatchObject(expected);
      expect(result).not.toHaveProperty("subscriptionActionQuote");
      expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
      expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
    },
  );

  it("does not recommend an upgrade when the billing action is ineligible", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: null,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_legacy",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: null,
      status: "active",
    });
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "does not recommend an upgrade with incomplete Stripe billing references",
    async (hasStripeCustomerId, hasStripeSubscriptionId) => {
      mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        hasStripeCustomerId,
        hasStripeSubscriptionId,
      });
      mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
        allowanceSource: "direct_paid_member_plan",
        limitUsdMicros: 10_000_000n,
        remainingUsdMicros: 1_500_000n,
        spentUsdMicros: 8_500_000n,
      }));

      await expect(readHostedPersonalAiUsageStatus({
        includeSubscriptionActionQuote: true,
        memberId: "member_usage_incomplete",
        now: NOW,
        prisma: buildPrisma(null) as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toMatchObject({
        recommendedAction: null,
        subscriptionActionQuote: null,
        usedPercent: 85,
      });
    },
  );

  it("keeps exhausted paid usage available when billing action state cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedMemberBillingEligibilityState.mockRejectedValueOnce(
      new Error("private billing read failed"),
    );
    const prisma = buildPrisma(null);

    try {
      await expect(projectHostedPersonalAiUsageStatus({
        decision: buildDecision({
          remainingUsdMicros: 0n,
          spentUsdMicros: 10_000_000n,
        }),
        memberId: "member_usage_action_failure",
        now: NOW,
        prisma: prisma as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toMatchObject({
        recommendedAction: null,
        remainingPercent: 0,
        status: "exhausted",
        usedPercent: 100,
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted plan usage action resolution failed.",
        {
          accessKind: "paid",
          errorName: "Error",
          planCode: "launch_monthly",
        },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /member_usage_action_failure|private billing read failed/u,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("does not invent a higher-plan action for Edge or a personal action for Family", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 24_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_edge",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      accessKind: "paid",
      planName: "Edge",
      recommendedAction: null,
      subscriptionActionQuote: null,
    });

    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "family_sponsored_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 500_000n,
      spentUsdMicros: 9_500_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_family",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      accessKind: "family_sponsored",
      planName: "Family",
      recommendedAction: null,
      subscriptionActionQuote: null,
    });
  });

  it("represents zero and exhausted usage without percentage overflow", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      remainingUsdMicros: 10_000_000n,
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_zero",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      forecast: null,
      remainingPercent: 100,
      status: "active",
      usedPercent: 0,
    });

    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      remainingUsdMicros: 0n,
      spentUsdMicros: 12_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_exhausted",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      forecast: null,
      remainingPercent: 0,
      status: "exhausted",
      usedPercent: 100,
    });
  });

  it("omits a forecast until at least one full day of usage is observed", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      remainingUsdMicros: 5_000_000n,
      spentUsdMicros: 5_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_early",
      now: NOW,
      prisma: buildPrisma(new Date("2026-07-03T00:00:00.000Z")) as never,
    })).resolves.toMatchObject({
      forecast: null,
      recommendedAction: null,
    });
  });

  it("omits a forecast when the projected date is outside the JavaScript date range", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 24_999_999n,
      spentUsdMicros: 1n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_low_spend",
      now: NOW,
      prisma: buildPrisma(new Date(NOW.getTime() - (4 * 24 * 60 * 60 * 1_000))) as never,
    })).resolves.toMatchObject({
      forecast: null,
      status: "active",
    });
  });

  it("keeps personal billing details unavailable to thread-container runtimes", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "thread_container",
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "thread_runtime",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "group_not_supported",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
    expect(prisma.hostedAiUsage.findFirst).not.toHaveBeenCalled();
  });

  it("returns no subscription quote for inactive hosted access", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      reason: "hosted_access_inactive",
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_inactive",
      now: NOW,
      prisma: buildPrisma(null) as never,
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "hosted_access_inactive",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it("returns a conversion path for an ended trial without inventing usage", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "trial_expired_pending_billing",
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_trial_ended",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse now ($8/month)",
        url: "https://example.test/settings#subscription",
      },
      subscriptionActionQuote: {
        action: "start_pulse_now",
        label: "Start Pulse now ($8/month)",
      },
      status: "unavailable",
    });
  });

  it("does not recommend trial conversion without complete billing references", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: false,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "trial_expired_pending_billing",
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_trial_incomplete",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
  });

  it("keeps trial conversion available when billing action state cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockRejectedValueOnce(
      new Error("private billing read failed"),
    );

    try {
      await expect(projectHostedPersonalAiUsageStatus({
        decision: buildDecision({
          allowed: false,
          allowanceSource: "direct_trial",
          reason: "trial_expired_pending_billing",
          spentUsdMicros: 0n,
        }),
        memberId: "member_trial_action_failure",
        now: NOW,
        prisma: buildPrisma(null) as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toEqual({
        generatedAt: NOW.toISOString(),
        reason: "trial_conversion_pending",
        recommendedAction: null,
        status: "unavailable",
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted plan usage action resolution failed.",
        {
          accessKind: "trial",
          errorName: "Error",
          planCode: "launch_monthly",
        },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /member_trial_action_failure|private billing read failed/u,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("projects an already-resolved exhausted allowance without re-reading it", async () => {
    const decision = buildDecision({
      remainingUsdMicros: 0n,
      spentUsdMicros: 10_000_000n,
    });

    await expect(projectHostedPersonalAiUsageStatus({
      decision,
      memberId: "member_usage",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: {
        kind: "upgrade_edge",
        label: "Upgrade to Edge ($20/month)",
        url: "https://example.test/settings#subscription",
      },
      remainingPercent: 0,
      status: "exhausted",
      usedPercent: 100,
    });
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
  });

});

function buildPrisma(firstUsageAt: Date | null) {
  return {
    hostedAiUsage: {
      findFirst: vi.fn(async () => firstUsageAt
        ? { occurredAt: firstUsageAt }
        : null),
    },
  };
}

function buildDecision(input: {
  allowed?: boolean;
  allowanceSource?:
    | "direct_paid_member_plan"
    | "direct_trial"
    | "family_sponsored_plan"
    | "thread_container";
  billingPlanCode?: "launch_edge_monthly" | "launch_monthly";
  limitUsdMicros?: bigint;
  reason?:
    | "hosted_access_inactive"
    | "trial_expired_pending_billing";
  remainingUsdMicros?: bigint;
  spentUsdMicros?: bigint;
} = {}): HostedAiUsageGateDecisionWithSource {
  const allowed = input.allowed ?? true;
  const common = {
    allowanceSource: input.allowanceSource ?? "direct_paid_member_plan",
    billingPlanCode: input.billingPlanCode ?? "launch_monthly",
    limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
    memberId: "member_usage",
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    remainingUsdMicros: input.remainingUsdMicros ?? 5_000_000n,
    spentUsdMicros: input.spentUsdMicros ?? 5_000_000n,
  };
  return allowed
    ? {
        ...common,
        allowed: true,
      }
    : {
        ...common,
        allowed: false,
        reason: input.reason ?? "hosted_access_inactive",
        retryAfter: PERIOD_END,
        userNotice: null,
      };
}
