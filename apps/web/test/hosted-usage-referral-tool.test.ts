import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveHostedMemberAccess: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  readHostedPersonalAiUsageStatus: mocks.readHostedPersonalAiUsageStatus,
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
  status: "armed" | "superseded";
};

describe("hosted usage referral tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
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
              rewardLabel: "$2 of Murph usage",
            },
            {
              code: "active_group_v1",
              rewardLabel: "$3.50 of Murph usage",
            },
          ],
        },
        status: "ok",
      },
    });
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
      status: "armed",
    });
  });
});

function buildPrisma(): {
  prisma: Record<string, unknown>;
  referrals: ReferralState[];
} {
  const referrals: ReferralState[] = [];
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
    updateMany: vi.fn(async () => {
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
    ) => callback(prisma)),
    hostedThreadContainer: {
      findUnique: vi.fn(async () => null),
    },
    hostedUsageReferral: referralDelegate,
  };
  return { prisma, referrals };
}
