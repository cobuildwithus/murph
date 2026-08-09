import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedOnboardingEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
}));

import { readHostedPersonalUsageCreditOfferCodes } from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";

describe("readHostedPersonalUsageCreditOfferCodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      stripeUsageCreditPriceIdsByOffer: {
        usage_10_usd: "price_usage_10",
        usage_25_usd: "price_usage_25",
        usage_5_usd: "price_usage_5",
      },
    });
  });

  it.each([
    "launch_monthly",
    "launch_edge_monthly",
  ] as const)("authorizes configured personal offers for paid %s", async (
    currentBillingPlanCode,
  ) => {
    const findUnique = vi.fn(async () => buildEligibleMember({
      billingRef: {
        ...buildEligibleMember().billingRef,
        currentBillingPlanCode,
      },
    }));

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_eligible",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([
      "usage_5_usd",
      "usage_10_usd",
      "usage_25_usd",
    ]);
  });

  it("returns no offers without configured Prices and avoids an unnecessary member read", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      stripeUsageCreditPriceIdsByOffer: {
        usage_10_usd: null,
        usage_25_usd: null,
        usage_5_usd: null,
      },
    });
    const findUnique = vi.fn(async () => buildEligibleMember());

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_no_prices",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns only the offers backed by configured Prices", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      stripeUsageCreditPriceIdsByOffer: {
        usage_10_usd: "price_usage_10",
        usage_25_usd: null,
        usage_5_usd: null,
      },
    });
    const findUnique = vi.fn(async () => buildEligibleMember());

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_partial_catalog",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual(["usage_10_usd"]);
  });

  it.each([
    [
      "a missing member",
      (): ReturnType<typeof buildEligibleMember> | null => null,
    ],
    ["inactive own billing", () => buildEligibleMember({
      billingStatus: HostedBillingStatus.canceled,
    })],
    ["a suspended payer", () => buildEligibleMember({
      suspendedAt: new Date("2026-07-16T18:00:00.000Z"),
    })],
  ] as const)("fails closed for %s", async (_label, buildMember) => {
    const findUnique = vi.fn(async () => buildMember());

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_ineligible",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([]);
  });

  it.each([
    ["there is no billing row", () => buildEligibleMember({ billingRef: null })],
    ["it retains a historical trial phase", () => {
      const member = buildEligibleMember();
      return buildEligibleMember({
        billingRef: {
          ...member.billingRef,
          currentBillingPhase: "trial",
          currentCheckoutOffer: "pulse_trial_7d",
        },
      });
    }],
    ["it retains an unsupported plan label", () => {
      const member = buildEligibleMember();
      return buildEligibleMember({
        billingRef: {
          ...member.billingRef,
          currentBillingPlanCode: "legacy_monthly",
        },
      });
    }],
    ["its historical customer binding is absent", () => {
      const member = buildEligibleMember();
      return buildEligibleMember({
        billingRef: {
          ...member.billingRef,
          stripeCustomerLookupKey: null,
        },
      });
    }],
    ["its historical subscription binding is absent", () => {
      const member = buildEligibleMember();
      return buildEligibleMember({
        billingRef: {
          ...member.billingRef,
          stripeSubscriptionLookupKey: null,
        },
      });
    }],
  ] as const)("authorizes Starter top-ups when %s", async (_label, buildMember) => {
    const findUnique = vi.fn(async () => buildMember());

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_starter",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([
      "usage_5_usd",
      "usage_10_usd",
      "usage_25_usd",
    ]);
  });

  it.each([
    { accountGroupsOwned: [{ id: "active_owned_group" }] },
    { accountGroupMemberships: [{ id: "active_group_membership" }] },
  ])("excludes active Family ownership or membership", async (memberOverride) => {
    const findUnique = vi.fn(async () => buildEligibleMember(memberOverride));

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_active_family",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([]);
  });

  it("allows inactive or unpaid group relationships by selecting only active group access", async () => {
    const findUnique = vi.fn(async () => buildEligibleMember());

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_inactive_family_relation",
      prisma: buildPrisma(findUnique),
    })).resolves.toHaveLength(3);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        accountGroupMemberships: expect.objectContaining({
          where: {
            group: {
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
            },
            status: "active",
          },
        }),
        accountGroupsOwned: expect.objectContaining({
          where: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
        }),
      }),
    }));
  });

  it("excludes synthetic thread-container members", async () => {
    const findUnique = vi.fn(async () => buildEligibleMember({
      threadContainer: { memberId: "member_thread_container" },
    }));

    await expect(readHostedPersonalUsageCreditOfferCodes({
      memberId: "member_thread_container",
      prisma: buildPrisma(findUnique),
    })).resolves.toEqual([]);
  });
});

function buildEligibleMember(overrides: Record<string, unknown> = {}) {
  return {
    accountGroupMemberships: [],
    accountGroupsOwned: [],
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      stripeCustomerLookupKey: "customer_lookup_key",
      stripeSubscriptionLookupKey: "subscription_lookup_key",
    },
    billingStatus: HostedBillingStatus.active,
    suspendedAt: null,
    threadContainer: null,
    ...overrides,
  };
}

function buildPrisma(findUnique: ReturnType<typeof vi.fn>) {
  return {
    hostedMember: { findUnique },
  } as never;
}
