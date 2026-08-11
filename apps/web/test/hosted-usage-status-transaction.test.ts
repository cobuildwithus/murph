import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    stripePriceIdsByPlan: {
      launch_group_monthly: null,
    },
  }),
  isHostedBillingPlanSelectionAvailable: async () => true,
}));

import {
  projectHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import type {
  HostedAiUsageGateDecisionWithSource,
} from "@/src/lib/hosted-execution/usage-allowance";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const PERIOD_START = new Date("2026-07-28T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-04T00:00:00.000Z");

describe("hosted usage status transaction reads", () => {
  it("serializes the action quote graph on an interactive transaction client", async () => {
    const queryGuard = createSingleQueryGuard();
    const prisma = {
      hostedGroupMember: {
        findFirst: () => queryGuard.run(async () => null),
      },
      hostedAiUsage: {
        findFirst: () => queryGuard.run(async () => null),
      },
      hostedUsageCreditEntry: {
        aggregate: () => queryGuard.run(async () => ({
          _sum: { amountUsdMicros: -9_000_000n },
        })),
        findFirst: () => queryGuard.run(async () => null),
      },
      hostedMember: {
        findUnique: () => queryGuard.run(async () => ({
          billingStatus: "active",
          createdAt: PERIOD_START,
          id: "member_usage_transaction",
          suspendedAt: null,
          updatedAt: NOW,
        })),
      },
      hostedMemberBillingRef: {
        findUnique: () => queryGuard.run(async () => ({
          currentBillingPhase: null,
          currentBillingPlanCode: null,
          currentCheckoutOffer: null,
          stripeCustomerLookupKey: null,
          stripeSubscriptionLookupKey: null,
        })),
      },
    };

    await expect(projectHostedPersonalAiUsageStatus({
      decision: buildTrialDecision(),
      memberId: "member_usage_transaction",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: {
        kind: "change_plan",
      },
      status: "active",
      usedPercent: 90,
    });
    expect(queryGuard.peak()).toBe(1);
  });
});

function buildTrialDecision(): HostedAiUsageGateDecisionWithSource {
  return {
    allowed: true,
    allowanceSource: "direct_starter",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: "member_usage_transaction",
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    planResetAt: null,
    remainingUsdMicros: 1_000_000n,
    spentUsdMicros: 9_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 1n,
  };
}

function createSingleQueryGuard(): {
  peak: () => number;
  run: <Result>(operation: () => Promise<Result>) => Promise<Result>;
} {
  let active = 0;
  let peak = 0;

  return {
    peak: () => peak,
    run: async <Result>(operation: () => Promise<Result>) => {
      if (active !== 0) {
        throw new Error("Concurrent transaction query started.");
      }
      active += 1;
      peak = Math.max(peak, active);
      try {
        await Promise.resolve();
        return await operation();
      } finally {
        active -= 1;
      }
    },
  };
}
