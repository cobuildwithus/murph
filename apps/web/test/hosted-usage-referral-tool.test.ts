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
  } | null;
  status: "armed" | "canceled" | "superseded";
  terminalAt?: Date | null;
  terminalReason?: string | null;
};

const PERSONAL_SOURCE = {
  channel: "telegram" as const,
  threadId: `hid_${"1".repeat(32)}`,
  threadIsDirect: true,
};

const ACTIVE_PERSONAL_USAGE_STATUS = {
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
    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue(
      ACTIVE_PERSONAL_USAGE_STATUS,
    );
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
    const { peakTransactionQueries, prisma } = buildPrisma();

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
    expect(peakTransactionQueries()).toBe(1);
  });

  it("commits personal arm and cancel snapshots through the real usage-status graph", async () => {
    mocks.useRealUsageStatus = true;
    const { peakTransactionQueries, prisma, referrals } = buildPrisma();

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
      request: { action: "cancel_usage_referral" },
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

  it("builds snapshots after commit with one root-client query at a time", async () => {
    const { prisma, referrals, runQuery, transactionState } = buildPrisma();
    const projectionTransactionStates: boolean[] = [];
    mocks.readActiveHostedMemberAccess.mockImplementation(
      () => runQuery(() => true),
    );
    mocks.readHostedPersonalAiUsageStatus.mockImplementation(
      (input) => runQuery(() => {
        projectionTransactionStates.push(transactionState.open);
        expect(input.prisma).toBe(prisma);
        return ACTIVE_PERSONAL_USAGE_STATUS;
      }),
    );
    mocks.readHostedMemberAssistantModelPreference.mockImplementation(
      (input) => runQuery(() => {
        projectionTransactionStates.push(transactionState.open);
        expect(input.prisma).toBe(prisma);
        return { model: "gpt-5.6-terra" };
      }),
    );

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: { outcome: "read", referral: { active: null }, status: "ok" },
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
        referral: {
          active: { policyCode: "new_person_activation_v1", state: "armed" },
        },
        status: "ok",
      },
    });
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: {
          active: { policyCode: "new_person_activation_v1", state: "armed" },
        },
        status: "ok",
      },
    });
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "cancel_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        outcome: "canceled",
        referral: { active: null },
        status: "ok",
      },
    });

    expect(projectionTransactionStates).not.toContain(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(referrals).toHaveLength(1);
    expect(referrals[0]).toMatchObject({
      sourceConversationJson: null,
      status: "canceled",
      terminalReason: "referrer_canceled",
    });
  });

  it("acknowledges a committed arm when its response snapshot cannot refresh", async () => {
    const { prisma, referrals } = buildPrisma();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedPersonalAiUsageStatus
      .mockResolvedValueOnce(ACTIVE_PERSONAL_USAGE_STATUS)
      .mockRejectedValueOnce(new Error("Projection unavailable"));

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toEqual({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason:
          "usage_referral_arm_applied_snapshot_unavailable",
      },
    });
    expect(referrals).toHaveLength(1);
    expect(referrals[0]).toMatchObject({
      policyCode: "new_person_activation_v1",
      status: "armed",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted usage referral snapshot refresh failed after committed mutation.",
      { action: "arm_usage_referral", errorName: "Error" },
    );

    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue(
      ACTIVE_PERSONAL_USAGE_STATUS,
    );
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: {
          active: {
            policyCode: "new_person_activation_v1",
            state: "armed",
          },
        },
        status: "ok",
      },
    });

    consoleError.mockRestore();
  });

  it("acknowledges a committed cancel when its response snapshot cannot refresh", async () => {
    const { prisma, referrals } = buildPrisma();
    await handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCode: "new_person_activation_v1",
        sourceConversation: PERSONAL_SOURCE,
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedPersonalAiUsageStatus.mockRejectedValueOnce(
      new Error("Projection unavailable"),
    );

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "cancel_usage_referral" },
    })).resolves.toEqual({
      action: "cancel_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason:
          "usage_referral_cancel_applied_snapshot_unavailable",
      },
    });
    expect(referrals).toHaveLength(1);
    expect(referrals[0]).toMatchObject({
      status: "canceled",
      terminalReason: "referrer_canceled",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted usage referral snapshot refresh failed after committed mutation.",
      { action: "cancel_usage_referral", errorName: "Error" },
    );

    mocks.readHostedPersonalAiUsageStatus.mockResolvedValue(
      ACTIVE_PERSONAL_USAGE_STATUS,
    );
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: { active: null },
        status: "ok",
      },
    });

    consoleError.mockRestore();
  });
});

function buildPrisma(): {
  peakTransactionQueries: () => number;
  prisma: Record<string, unknown>;
  referrals: ReferralState[];
  runQuery: <T>(query: () => T | Promise<T>) => Promise<T>;
  transactionState: {
    open: boolean;
    rootQueryInFlight: boolean;
    txQueryInFlight: boolean;
  };
} {
  const referrals: ReferralState[] = [];
  const transactionQueryTracker = { active: 0, peak: 0 };
  const transactionState = {
    open: false,
    rootQueryInFlight: false,
    txQueryInFlight: false,
  };

  const runQuery = async <T>(query: () => T | Promise<T>): Promise<T> => {
    const queryState = transactionState.open
      ? "txQueryInFlight"
      : "rootQueryInFlight";
    if (transactionState[queryState]) {
      throw new TypeError(
        transactionState.open
          ? "Concurrent transaction query"
          : "Concurrent root-client query",
      );
    }
    transactionState[queryState] = true;
    if (transactionState.open) {
      transactionQueryTracker.active += 1;
      transactionQueryTracker.peak = Math.max(
        transactionQueryTracker.peak,
        transactionQueryTracker.active,
      );
    }
    try {
      await Promise.resolve();
      return await query();
    } finally {
      if (transactionState.open) {
        transactionQueryTracker.active -= 1;
      }
      transactionState[queryState] = false;
    }
  };

  const referralDelegate = {
    aggregate: vi.fn(async () => runQuery(
      () => ({ _sum: { rewardUsdMicros: null } }),
    )),
    count: vi.fn(async () => runQuery(() => 0)),
    create: vi.fn(async (input: { data: ReferralState }) => runQuery(() => {
      referrals.push({ ...input.data });
      return referrals.at(-1);
    })),
    findFirst: vi.fn(async () => runQuery(() =>
      [...referrals]
        .reverse()
        .find((referral) => referral.status === "armed")
        ?? null
    )),
    update: vi.fn(async (input: {
      data: Partial<ReferralState> & { sourceConversationJson?: unknown };
      where: { id: string };
    }) => runQuery(() => {
      const referral = referrals.find(
        (candidate) => candidate.id === input.where.id,
      );
      if (!referral) {
        throw new TypeError("Referral not found");
      }
      Object.assign(referral, input.data, {
        ...(Object.hasOwn(input.data, "sourceConversationJson")
          ? { sourceConversationJson: null }
          : {}),
      });
      return referral;
    })),
    updateMany: vi.fn(async (input: {
      data: Omit<Partial<ReferralState>, "status"> & { status?: string };
    }) => runQuery(() => {
      if (input.data.status === "expired") {
        return { count: 0 };
      }
      let count = 0;
      for (const referral of referrals) {
        if (referral.status !== "armed") {
          continue;
        }
        Object.assign(referral, input.data, {
          ...(Object.hasOwn(input.data, "sourceConversationJson")
            ? { sourceConversationJson: null }
            : {}),
        });
        count += 1;
      }
      return { count };
    })),
  };
  const prisma = {
    $executeRaw: vi.fn(async () => runQuery(() => 1)),
    $queryRaw: vi.fn(async () => runQuery(() => [{
      balanceUsdMicros: 0n,
      beneficiaryMemberId: "member_personal",
      ledgerVersion: 0n,
    }])),
    $transaction: vi.fn(async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) => {
      if (transactionState.open) {
        throw new TypeError("Concurrent nested transactions are not supported");
      }
      transactionState.open = true;
      try {
        return await callback(prisma);
      } finally {
        transactionState.open = false;
      }
    }),
    hostedAiUsage: {
      findFirst: vi.fn(async () => runQuery(() => null)),
    },
    hostedMember: {
      findUnique: vi.fn(async () => runQuery(() => ({
        billingStatus: "active",
        createdAt: new Date("2026-07-28T00:00:00.000Z"),
        id: "member_personal",
        suspendedAt: null,
        updatedAt: new Date("2026-07-28T12:00:00.000Z"),
      }))),
    },
    hostedMemberBillingRef: {
      findUnique: vi.fn(async () => runQuery(() => ({
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        stripeCustomerLookupKey: "customer_lookup",
        stripeSubscriptionLookupKey: "subscription_lookup",
      }))),
    },
    hostedThreadContainer: {
      findUnique: vi.fn(async () => runQuery(() => null)),
    },
    hostedUsageReferral: referralDelegate,
  };
  return {
    peakTransactionQueries: () => transactionQueryTracker.peak,
    prisma,
    referrals,
    runQuery,
    transactionState,
  };
}
