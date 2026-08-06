import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedUsageCreditGrantTx: vi.fn(),
  generateHostedRandomPrefixedId: vi.fn(),
  lockHostedUsageCreditBeneficiaryTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-grant", () => ({
  appendHostedUsageCreditGrantTx:
    mocks.appendHostedUsageCreditGrantTx,
}));
vi.mock("@/src/lib/hosted-execution/usage-credit-ledger", () => ({
  lockHostedUsageCreditBeneficiaryTx:
    mocks.lockHostedUsageCreditBeneficiaryTx,
}));
vi.mock("@/src/lib/primitives", () => ({
  generateHostedRandomPrefixedId:
    mocks.generateHostedRandomPrefixedId,
}));

import {
  isHostedSignupReferralRewardEnabled,
  recoverPendingHostedSignupReferralRewards,
  settleHostedSignupReferralReward,
} from "@/src/lib/hosted-growth/signup-referral-reward";

const ACTIVATED_AT = new Date("2026-08-06T12:05:00.000Z");
const ATTRIBUTED_AT = new Date("2026-08-06T12:00:00.000Z");
const INTRODUCED_AT = new Date("2026-08-06T12:00:00.000Z");
const REFERRER_MEMBER_ID = "member_referrer";
const INTRODUCED_MEMBER_ID = "member_introduced";

function createPrisma(input: {
  aggregateTotal?: bigint;
  existingReferralId?: string | null;
  introducedMemberId?: string;
  referrerMemberId?: string;
  referrerRows?: Array<{ referrerMemberId: string }>;
  suspendedIntroduced?: boolean;
  suspendedReferrer?: boolean;
} = {}) {
  const introducedMemberId =
    input.introducedMemberId ?? INTRODUCED_MEMBER_ID;
  const referrerMemberId = input.referrerMemberId ?? REFERRER_MEMBER_ID;
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(
      input.referrerRows ?? [{ referrerMemberId }],
    ),
    hostedInvite: {
      findFirst: vi.fn().mockResolvedValue({ createdAt: ATTRIBUTED_AT }),
    },
    hostedMailboxItem: {
      findFirst: vi.fn().mockResolvedValue({ occurredAt: ACTIVATED_AT }),
    },
    hostedMember: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === introducedMemberId
          ? {
              createdAt: INTRODUCED_AT,
              suspendedAt: input.suspendedIntroduced ? ACTIVATED_AT : null,
            }
          : {
              suspendedAt: input.suspendedReferrer ? ACTIVATED_AT : null,
            }
      ),
    },
    hostedUsageReferral: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { rewardUsdMicros: input.aggregateTotal ?? 0n },
      }),
      create: vi.fn(async ({ data }: {
        data: Record<string, unknown>;
      }) => {
        created.push(data);
        return data;
      }),
      findFirst: vi.fn().mockResolvedValue(
        input.existingReferralId
          ? { id: input.existingReferralId }
          : null,
      ),
    },
  };
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };
  return {
    created,
    introducedMemberId,
    prisma,
    referrerMemberId,
    tx,
  };
}

describe("hosted signup referral rewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedUsageCreditGrantTx.mockResolvedValue({});
    mocks.generateHostedRandomPrefixedId.mockReturnValue("hur_signup_link");
    mocks.lockHostedUsageCreditBeneficiaryTx.mockResolvedValue({
      balanceUsdMicros: 0n,
      beneficiaryMemberId: REFERRER_MEMBER_ID,
      ledgerVersion: 0n,
    });
  });

  it("is disabled unless the exact rollout gate is set", async () => {
    expect(isHostedSignupReferralRewardEnabled({})).toBe(false);
    expect(isHostedSignupReferralRewardEnabled({
      HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED: "true",
    })).toBe(false);
    expect(isHostedSignupReferralRewardEnabled({
      HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED: "1",
    })).toBe(true);

    const { prisma } = createPrisma();
    await expect(recoverPendingHostedSignupReferralRewards({
      enabled: false,
      prisma: prisma as never,
    })).resolves.toEqual({ failed: 0, rewarded: 0, scanned: 0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("atomically writes the standard referral receipt and usage grant", async () => {
    const {
      created,
      introducedMemberId,
      prisma,
      referrerMemberId,
      tx,
    } = createPrisma();

    await expect(settleHostedSignupReferralReward({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "rewarded",
      referralId: "hur_signup_link",
    });

    expect(created).toEqual([
      expect.objectContaining({
        armedAt: INTRODUCED_AT,
        beneficiaryMemberId: referrerMemberId,
        introducedMemberId,
        policyCode: "new_person_activation_v1",
        policyVersion:
          "hosted-signup-referral-activation-2026-08-v1",
        qualifiedAt: ACTIVATED_AT,
        referrerMemberId,
        rewardedAt: ACTIVATED_AT,
        rewardUsdMicros: 2_000_000n,
        status: "rewarded",
        targetBoundAt: ATTRIBUTED_AT,
        terminalAt: ACTIVATED_AT,
      }),
    ]);
    expect(created[0]).not.toHaveProperty("sourceConversationJson");
    expect(created[0]).not.toHaveProperty("celebrationQueuedAt");
    expect(mocks.generateHostedRandomPrefixedId).toHaveBeenCalledWith("hur");
    expect(mocks.lockHostedUsageCreditBeneficiaryTx).toHaveBeenCalledWith({
      beneficiaryMemberId: referrerMemberId,
      tx,
    });
    expect(mocks.appendHostedUsageCreditGrantTx).toHaveBeenCalledWith({
      effectiveAt: ACTIVATED_AT,
      grantUsdMicros: 2_000_000n,
      lockedBeneficiary: expect.objectContaining({
        beneficiaryMemberId: REFERRER_MEMBER_ID,
      }),
      semanticSourceKey:
        "hosted-usage-credit:referral:hur_signup_link:grant:v1",
      source: {
        kind: "referral",
        referralId: "hur_signup_link",
      },
      tx,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.hostedUsageReferral.aggregate).toHaveBeenCalledTimes(2);
  });

  it("does not create a second receipt when another referral path owns the member", async () => {
    const { introducedMemberId, prisma, referrerMemberId, tx } = createPrisma({
      existingReferralId: "hur_existing",
    });

    await expect(settleHostedSignupReferralReward({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "already_processed",
      referralId: "hur_existing",
    });
    expect(tx.hostedUsageReferral.create).not.toHaveBeenCalled();
    expect(tx.hostedUsageReferral.aggregate).not.toHaveBeenCalled();
    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("fails closed when attribution becomes ambiguous under lock", async () => {
    const { introducedMemberId, prisma, referrerMemberId, tx } = createPrisma({
      referrerRows: [
        { referrerMemberId },
        { referrerMemberId: "member_other_referrer" },
      ],
    });

    await expect(settleHostedSignupReferralReward({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "ambiguous_attribution",
      referralId: null,
    });
    expect(tx.hostedUsageReferral.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("records cap rejection without granting usage", async () => {
    const { created, introducedMemberId, prisma, referrerMemberId } =
      createPrisma({ aggregateTotal: 10_000_000n });

    await expect(settleHostedSignupReferralReward({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "disqualified",
      referralId: "hur_signup_link",
    });
    expect(created[0]).toMatchObject({
      introducedMemberId,
      status: "disqualified",
      terminalReason: "signup_referral_referrer_reward_cap_reached",
    });
    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });

  it("does not reward a member for referring their own reconciled identity", async () => {
    const { created, prisma, referrerMemberId } = createPrisma({
      introducedMemberId: REFERRER_MEMBER_ID,
      referrerMemberId: REFERRER_MEMBER_ID,
    });

    await expect(settleHostedSignupReferralReward({
      activatedAt: ACTIVATED_AT,
      introducedMemberId: referrerMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toMatchObject({ outcome: "disqualified" });
    expect(created[0]).toMatchObject({
      status: "disqualified",
      terminalReason: "signup_referral_self_attribution",
    });
    expect(mocks.appendHostedUsageCreditGrantTx).not.toHaveBeenCalled();
  });
});
