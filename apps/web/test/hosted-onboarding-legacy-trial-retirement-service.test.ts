import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedMemberStripeBillingRef: vi.fn(),
  retireHostedLegacyPulseTrialToStarter: vi.fn(),
  retrieveHostedPulseTrialCleanupTarget: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef:
    mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup", () => ({
  isHostedLegacyPulseTrialRetirableStatus: (status: string) => (
    ["canceled", "incomplete", "incomplete_expired", "paused", "trialing"]
      .includes(status)
  ),
  retireHostedLegacyPulseTrialToStarter:
    mocks.retireHostedLegacyPulseTrialToStarter,
  retrieveHostedPulseTrialCleanupTarget:
    mocks.retrieveHostedPulseTrialCleanupTarget,
}));

import {
  HostedLegacyPulseTrialCandidateCountChangedError,
  HostedLegacyPulseTrialRetirementBlockedError,
  runHostedLegacyPulseTrialRetirement,
} from "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement";

const PRICE_ID = "price_pulse";
const stripe = { subscriptions: {} } as Pick<Stripe, "subscriptions">;

describe("runHostedLegacyPulseTrialRetirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedMemberStripeBillingRef.mockImplementation(
      async ({ memberId }: { memberId: string }) => ({
        stripeCustomerId: `customer_${memberId}`,
        stripeSubscriptionId: `subscription_${memberId}`,
      }),
    );
    mocks.retireHostedLegacyPulseTrialToStarter.mockResolvedValue(true);
  });

  it("reports aggregate provider state without mutating during dry-run", async () => {
    const prisma = buildPrisma([
      { currentBillingPhase: "trial", memberId: "member_a" },
      { currentBillingPhase: null, memberId: "member_b" },
      { currentBillingPhase: "paid", memberId: "member_paid" },
    ]);
    mocks.retrieveHostedPulseTrialCleanupTarget
      .mockResolvedValueOnce({ status: "trialing" })
      .mockResolvedValueOnce(null);

    await expect(runHostedLegacyPulseTrialRetirement({
      apply: false,
      priceId: PRICE_ID,
      prisma,
      stripe,
      stripeMode: "live",
    })).resolves.toEqual({
      alreadyRetiredCount: 0,
      candidateCount: 2,
      missingProviderCount: 1,
      mode: "dry-run",
      retiredCount: 0,
      stripeMode: "live",
      subscriptionStatusCounts: { trialing: 1 },
    });

    expect(mocks.retireHostedLegacyPulseTrialToStarter).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.findMany).toHaveBeenCalledWith({
      orderBy: { memberId: "asc" },
      select: {
        currentBillingPhase: true,
        memberId: true,
      },
      where: {
        OR: [
          { currentBillingPhase: "trial" },
          { currentCheckoutOffer: "pulse_trial_7d" },
        ],
        stripeSubscriptionLookupKey: { not: null },
      },
    });
  });

  it("preflights every candidate before applying under the existing owner", async () => {
    const prisma = buildPrisma([
      { currentBillingPhase: "trial", memberId: "member_a" },
      { currentBillingPhase: "trial", memberId: "member_b" },
    ]);
    mocks.retrieveHostedPulseTrialCleanupTarget
      .mockResolvedValueOnce({ status: "paused" })
      .mockResolvedValueOnce({ status: "canceled" });
    mocks.retireHostedLegacyPulseTrialToStarter
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(runHostedLegacyPulseTrialRetirement({
      apply: true,
      expectedCandidates: 2,
      priceId: PRICE_ID,
      prisma,
      stripe,
      stripeMode: "test",
    })).resolves.toEqual({
      alreadyRetiredCount: 1,
      candidateCount: 2,
      missingProviderCount: 0,
      mode: "apply",
      retiredCount: 1,
      stripeMode: "test",
      subscriptionStatusCounts: { canceled: 1, paused: 1 },
    });

    expect(mocks.retireHostedLegacyPulseTrialToStarter).toHaveBeenCalledTimes(2);
    expect(mocks.retrieveHostedPulseTrialCleanupTarget).toHaveBeenNthCalledWith(
      1,
      {
        expectedCustomerId: "customer_member_a",
        memberId: "member_a",
        priceId: PRICE_ID,
        stripe,
        subscriptionId: "subscription_member_a",
      },
    );
    expect(mocks.retireHostedLegacyPulseTrialToStarter).toHaveBeenNthCalledWith(
      1,
      {
        memberId: "member_a",
        priceId: PRICE_ID,
        prisma,
        stripe,
      },
    );
    expect(
      mocks.retrieveHostedPulseTrialCleanupTarget.mock.invocationCallOrder[1],
    ).toBeLessThan(
      mocks.retireHostedLegacyPulseTrialToStarter.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects a changed count before provider reads or mutation", async () => {
    const prisma = buildPrisma([
      { currentBillingPhase: "trial", memberId: "member_a" },
    ]);

    await expect(runHostedLegacyPulseTrialRetirement({
      apply: true,
      expectedCandidates: 2,
      priceId: PRICE_ID,
      prisma,
      stripe,
      stripeMode: "live",
    })).rejects.toEqual(
      new HostedLegacyPulseTrialCandidateCountChangedError(2, 1),
    );

    expect(mocks.readHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.retrieveHostedPulseTrialCleanupTarget).not.toHaveBeenCalled();
    expect(mocks.retireHostedLegacyPulseTrialToStarter).not.toHaveBeenCalled();
  });

  it("fails the whole preflight before mutation when any candidate may be paid", async () => {
    const prisma = buildPrisma([
      { currentBillingPhase: "trial", memberId: "member_a" },
      { currentBillingPhase: "trial", memberId: "member_b" },
    ]);
    mocks.retrieveHostedPulseTrialCleanupTarget
      .mockResolvedValueOnce({ status: "canceled" })
      .mockResolvedValueOnce({ status: "active" });

    await expect(runHostedLegacyPulseTrialRetirement({
      apply: true,
      expectedCandidates: 2,
      priceId: PRICE_ID,
      prisma,
      stripe,
      stripeMode: "live",
    })).rejects.toBeInstanceOf(HostedLegacyPulseTrialRetirementBlockedError);

    expect(mocks.retireHostedLegacyPulseTrialToStarter).not.toHaveBeenCalled();
  });

  it("fails closed when a candidate identity cannot be read", async () => {
    const prisma = buildPrisma([
      { currentBillingPhase: "trial", memberId: "member_a" },
    ]);
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(null);

    await expect(runHostedLegacyPulseTrialRetirement({
      apply: false,
      priceId: PRICE_ID,
      prisma,
      stripe,
      stripeMode: "live",
    })).rejects.toBeInstanceOf(HostedLegacyPulseTrialRetirementBlockedError);

    expect(mocks.retrieveHostedPulseTrialCleanupTarget).not.toHaveBeenCalled();
    expect(mocks.retireHostedLegacyPulseTrialToStarter).not.toHaveBeenCalled();
  });
});

function buildPrisma(rows: Array<{
  currentBillingPhase: string | null;
  memberId: string;
}>): PrismaClient {
  return {
    hostedMemberBillingRef: {
      findMany: vi.fn(async () => rows),
    },
  } as unknown as PrismaClient;
}
