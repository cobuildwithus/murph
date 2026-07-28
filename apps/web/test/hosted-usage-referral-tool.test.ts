import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveHostedMemberAccess: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
  useRealUsageStatus: false,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/hosted-execution/usage-status")>();
  return {
    ...actual,
    readHostedPersonalAiUsageStatus: (
      input: Parameters<typeof actual.readHostedPersonalAiUsageStatus>[0],
    ) =>
      mocks.useRealUsageStatus
        ? actual.readHostedPersonalAiUsageStatus(input)
        : mocks.readHostedPersonalAiUsageStatus(input),
  };
});

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
}));

import {
  handleHostedUsageReferralGroupTool,
  isHostedUsageReferralEnabled,
} from "@/src/lib/hosted-growth/usage-referral";

type ReferralState = {
  armedAt: Date;
  beneficiaryMemberId: string;
  expiresAt: Date;
  id: string;
  policyCode: "active_group_v1" | "new_person_activation_v1";
  referrerMemberId: string;
  rewardUsdMicros: bigint;
  sourceConversationJson?: {
    channel: "linq" | "telegram";
    threadId: string;
    threadIsDirect: boolean;
  };
  status: "armed" | "canceled" | "superseded";
};

const PERSONAL_SOURCE = {
  channel: "telegram" as const,
  threadId: `hid_${"1".repeat(32)}`,
  threadIsDirect: true,
};

describe("hosted usage referral tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRealUsageStatus = false;
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedAiUsageGate.mockResolvedValue({
      allowed: true,
      allowanceSource: "direct_trial",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      memberId: "member_personal",
      periodEnd: new Date("2026-08-04T00:00:00.000Z"),
      periodStart: new Date("2026-07-28T00:00:00.000Z"),
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 9_000_000n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-terra",
    });
    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-07-26T12:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse",
      recommendedAction: null,
      remainingPercent: 95,
      status: "active",
      usedPercent: 5,
    });
  });

  it("fails closed until production explicitly enables referrals", async () => {
    expect(isHostedUsageReferralEnabled({})).toBe(false);
    expect(isHostedUsageReferralEnabled({
      HOSTED_USAGE_REFERRALS_ENABLED: "true",
    })).toBe(false);
    expect(isHostedUsageReferralEnabled({
      HOSTED_USAGE_REFERRALS_ENABLED: "1",
    })).toBe(true);

    const { prisma } = buildPrisma();
    await expect(handleHostedUsageReferralGroupTool({
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toEqual({
      action: "read_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "usage_referral_not_available",
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("offers both missions to a healthy personal member", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      action: "read_usage_referral",
      result: {
        outcome: "read",
        referral: {
          active: null,
          availablePolicies: [
            {
              code: "new_person_activation_v1",
              rewardLabel:
                "about 100 more messages on the model your Murph is using now",
            },
            {
              code: "active_group_v1",
              requirementsLabel:
                "Start a fresh group and make it genuinely active, with multiple people actually talking.",
              rewardLabel:
                "about 140 more messages on the model your Murph is using now",
            },
          ],
        },
        status: "ok",
      },
    });
  });

  it("resolves approximate reward capacity from the current personal model", async () => {
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-sol",
    });
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        referral: {
          availablePolicies: [
            {
              code: "new_person_activation_v1",
              rewardLabel:
                "about 50 more messages on the model your Murph is using now",
            },
            {
              code: "active_group_v1",
              rewardLabel:
                "about 70 more messages on the model your Murph is using now",
            },
          ],
        },
      },
    });
  });

  it("does not arm a personal mission without a trusted source conversation", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
      },
    })).resolves.toEqual({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "usage_referral_not_available",
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("freezes the personal destination and supersedes only the older unbound mission", async () => {
    const { prisma, referrals } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      action: "arm_usage_referral",
      result: {
        outcome: "armed",
        referral: {
          active: {
            destinationKind: "personal",
            policyCode: "new_person_activation_v1",
            state: "armed",
          },
        },
        status: "ok",
      },
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "active_group_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        referral: {
          active: {
            destinationKind: "personal",
            policyCode: "active_group_v1",
            state: "armed",
          },
        },
      },
    });

    expect(referrals).toHaveLength(2);
    expect(referrals[0]).toMatchObject({
      beneficiaryMemberId: "member_personal",
      policyCode: "new_person_activation_v1",
      referrerMemberId: "member_personal",
      status: "superseded",
    });
    expect(referrals[1]).toMatchObject({
      beneficiaryMemberId: "member_personal",
      policyCode: "active_group_v1",
      referrerMemberId: "member_personal",
      sourceConversationJson: PERSONAL_SOURCE,
      status: "armed",
    });
  });

  it("serializes every database query inside the arm transaction", async () => {
    const { prisma } = buildPrisma({ guardTransactionQueries: true });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      action: "arm_usage_referral",
      result: {
        outcome: "armed",
        status: "ok",
      },
    });
  });

  it("commits personal arm and cancel snapshots through the real usage-status graph", async () => {
    mocks.useRealUsageStatus = true;
    const { peakTransactionQueries, prisma, referrals } = buildPrisma({
      guardTransactionQueries: true,
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        status: "ok",
      },
    });
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "cancel_usage_referral",
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "canceled",
        status: "ok",
      },
    });

    expect(referrals).toHaveLength(1);
    expect(referrals[0]?.status).toBe("canceled");
    expect(peakTransactionQueries()).toBe(1);
  });
});

function buildPrisma(input: {
  guardTransactionQueries?: boolean;
} = {}): {
  peakTransactionQueries: () => number;
  prisma: Record<string, unknown>;
  referrals: ReferralState[];
} {
  const referrals: ReferralState[] = [];
  const transactionQueryTracker = { active: 0, peak: 0 };
  const referralDelegate = {
    aggregate: vi.fn(async () => ({ _sum: { rewardUsdMicros: null } })),
    count: vi.fn(async () => 0),
    create: vi.fn(async (input: {
      data: ReferralState;
    }) => {
      referrals.push({ ...input.data });
      return referrals.at(-1);
    }),
    findFirst: vi.fn(async () =>
      [...referrals]
        .reverse()
        .find((referral) => referral.status === "armed")
        ?? null
    ),
    update: vi.fn(async (input: {
      data: Partial<ReferralState>;
      where: { id: string };
    }) => {
      const referral = referrals.find((candidate) =>
        candidate.id === input.where.id
      );
      if (!referral) {
        throw new Error("Referral was not found.");
      }
      Object.assign(referral, input.data);
      return referral;
    }),
    updateMany: vi.fn(async (input: {
      data?: { status?: ReferralState["status"] | "expired" };
    }) => {
      if (input.data?.status !== "superseded") {
        return { count: 0 };
      }
      let count = 0;
      for (const referral of referrals) {
        if (referral.status === "armed") {
          referral.status = "superseded";
          count += 1;
        }
      }
      return { count };
    }),
  };
  const prisma = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{
      balanceUsdMicros: 0n,
      beneficiaryMemberId: "member_personal",
      ledgerVersion: 0n,
    }]),
    $transaction: vi.fn(async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) => callback(
      input.guardTransactionQueries
        ? createSingleQueryTransactionClient(prisma, transactionQueryTracker)
        : prisma,
    )),
    hostedAiUsage: {
      findFirst: vi.fn(async () => null),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingStatus: "active",
        createdAt: new Date("2026-07-28T00:00:00.000Z"),
        id: "member_personal",
        suspendedAt: null,
        updatedAt: new Date("2026-07-28T12:00:00.000Z"),
      })),
    },
    hostedMemberBillingRef: {
      findUnique: vi.fn(async () => ({
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        stripeCustomerLookupKey: "customer_lookup",
        stripeSubscriptionLookupKey: "subscription_lookup",
      })),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async () => null),
    },
    hostedUsageReferral: referralDelegate,
  };
  return {
    peakTransactionQueries: () => transactionQueryTracker.peak,
    prisma,
    referrals,
  };
}

function createSingleQueryTransactionClient(
  prisma: Record<string, unknown>,
  tracker: { active: number; peak: number },
): Record<string, unknown> {
  const guard = async <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    if (tracker.active !== 0) {
      throw new Error("Concurrent transaction query started.");
    }
    tracker.active += 1;
    tracker.peak = Math.max(tracker.peak, tracker.active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return await operation();
    } finally {
      tracker.active -= 1;
    }
  };

  return {
    $executeRaw: (...args: never[]) =>
      guard(() =>
        (prisma.$executeRaw as (...args: never[]) => Promise<unknown>)(...args)
      ),
    $queryRaw: (...args: never[]) =>
      guard(() =>
        (prisma.$queryRaw as (...args: never[]) => Promise<unknown>)(...args)
      ),
    ...Object.fromEntries([
      "hostedAiUsage",
      "hostedMember",
      "hostedMemberBillingRef",
      "hostedThreadContainer",
      "hostedUsageReferral",
    ].map((delegateName) => {
      const delegate = prisma[delegateName] as Record<
        string,
        (...args: never[]) => Promise<unknown>
      >;
      return [
        delegateName,
        Object.fromEntries(
          Object.entries(delegate).map(([key, operation]) => [
            key,
            (...args: never[]) => guard(() => operation(...args)),
          ]),
        ),
      ];
    })),
  };
}
