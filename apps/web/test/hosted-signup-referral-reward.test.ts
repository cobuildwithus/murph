import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateHostedRandomPrefixedId: vi.fn(),
  lockHostedUsageCreditBeneficiaryTx: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-ledger", () => ({
  lockHostedUsageCreditBeneficiaryTx:
    mocks.lockHostedUsageCreditBeneficiaryTx,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination:
    mocks.resolveHostedAssistantNotificationDestination,
}));
vi.mock("@/src/lib/primitives", () => ({
  generateHostedRandomPrefixedId:
    mocks.generateHostedRandomPrefixedId,
}));

import {
  admitHostedSignupReferralActivation,
  admitPendingHostedSignupReferralActivations,
  isHostedSignupReferralRewardEnabled,
} from "@/src/lib/hosted-growth/signup-referral-reward";

const ACTIVATED_AT = new Date("2026-08-06T12:05:00.000Z");
const ATTRIBUTED_AT = new Date("2026-08-06T12:00:00.000Z");
const INTRODUCED_AT = new Date("2026-08-06T12:00:00.000Z");
const REFERRER_MEMBER_ID = "member_referrer";
const INTRODUCED_MEMBER_ID = "member_introduced";
const SOURCE_THREAD_ID = `hid_${"1".repeat(32)}`;

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

describe("hosted signup referral reward admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateHostedRandomPrefixedId.mockReturnValue("hur_signup_link");
    mocks.lockHostedUsageCreditBeneficiaryTx.mockResolvedValue({
      balanceUsdMicros: 0n,
      beneficiaryMemberId: REFERRER_MEMBER_ID,
      ledgerVersion: 0n,
    });
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "provider-thread" },
        identityId: null,
        threadId: SOURCE_THREAD_ID,
        threadIsDirect: true,
      },
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
    await expect(admitPendingHostedSignupReferralActivations({
      enabled: false,
      prisma: prisma as never,
    })).resolves.toEqual({ admitted: 0, failed: 0, scanned: 0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("admits activation evidence into the existing referral state machine", async () => {
    const {
      created,
      introducedMemberId,
      prisma,
      referrerMemberId,
      tx,
    } = createPrisma();

    await expect(admitHostedSignupReferralActivation({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "admitted",
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
        rewardUsdMicros: 2_000_000n,
        sourceConversationJson: {
          channel: "linq",
          threadId: SOURCE_THREAD_ID,
          threadIsDirect: true,
        },
        status: "target_bound",
        targetBoundAt: ATTRIBUTED_AT,
      }),
    ]);
    expect(mocks.generateHostedRandomPrefixedId).toHaveBeenCalledWith("hur");
    expect(mocks.lockHostedUsageCreditBeneficiaryTx).toHaveBeenCalledWith({
      beneficiaryMemberId: referrerMemberId,
      tx,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.hostedUsageReferral.aggregate).toHaveBeenCalledTimes(2);
  });

  it("does not create a second receipt when another referral path already owns the member", async () => {
    const { introducedMemberId, prisma, referrerMemberId, tx } = createPrisma({
      existingReferralId: "hur_existing",
    });

    await expect(admitHostedSignupReferralActivation({
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
  });

  it("records cap rejection without issuing a qualified receipt", async () => {
    const { created, introducedMemberId, prisma, referrerMemberId } =
      createPrisma({ aggregateTotal: 10_000_000n });

    await expect(admitHostedSignupReferralActivation({
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
  });

  it("does not reward a member for referring their own reconciled identity", async () => {
    const { created, prisma, referrerMemberId } = createPrisma({
      introducedMemberId: REFERRER_MEMBER_ID,
      referrerMemberId: REFERRER_MEMBER_ID,
    });

    await expect(admitHostedSignupReferralActivation({
      activatedAt: ACTIVATED_AT,
      introducedMemberId: referrerMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toMatchObject({ outcome: "disqualified" });
    expect(created[0]).toMatchObject({
      status: "disqualified",
      terminalReason: "signup_referral_self_attribution",
    });
  });

  it("admits credit evidence even when no direct celebration route exists", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(null);
    const { created, introducedMemberId, prisma, referrerMemberId } =
      createPrisma();

    await expect(admitHostedSignupReferralActivation({
      activatedAt: ACTIVATED_AT,
      introducedMemberId,
      prisma: prisma as never,
      referrerMemberId,
    })).resolves.toEqual({
      outcome: "admitted",
      referralId: "hur_signup_link",
    });
    expect(created[0]).toMatchObject({
      introducedMemberId,
      status: "target_bound",
    });
    expect(created[0]).not.toHaveProperty("sourceConversationJson");
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
