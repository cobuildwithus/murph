import { beforeEach, describe, expect, it, vi } from "vitest";

const ORDINARY_POLICY_VERSION = "hosted-usage-referral-2026-07-v1";

const mocks = vi.hoisted(() => ({
  hasHostedRuntimeActiveAccess: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  readHostedGroupFundingRecoveryStatus: vi.fn(),
  readHostedGroupUsageStatus: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
  useRealUsageStatus: false,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  readHostedGroupFundingRecoveryStatus:
    mocks.readHostedGroupFundingRecoveryStatus,
  readHostedGroupUsageStatus: mocks.readHostedGroupUsageStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  resolveHostedMemberRoutingByTelegramUserId:
    mocks.resolveHostedMemberRoutingByTelegramUserId,
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

import {
  handleHostedUsageReferralGroupTool,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  isHostedUsageReferralEnabled,
} from "@/src/lib/hosted-growth/usage-referral-policy";

type ReferralState = {
  armedAt: Date;
  beneficiaryMemberId: string;
  expiresAt: Date;
  id: string;
  policyCode: "active_group_v1" | "new_person_activation_v1";
  policyVersion: string;
  referrerMemberId: string;
  rewardUsdMicros: bigint;
  sourceConversationJson?: {
    channel: "linq" | "telegram";
    linqService?: "imessage" | "rcs" | "sms";
    threadId: string;
    threadIsDirect: boolean;
  } | null;
  status: "armed" | "canceled" | "superseded" | "target_bound";
  terminalAt?: Date | null;
  terminalReason?: string | null;
};

const PERSONAL_SOURCE = {
  channel: "linq" as const,
  linqService: "imessage" as const,
  threadId: `hid_${"1".repeat(32)}`,
  threadIsDirect: true,
};
const TELEGRAM_PERSONAL_SOURCE = {
  channel: "telegram" as const,
  threadId: `hid_${"2".repeat(32)}`,
  threadIsDirect: true,
};
const TELEGRAM_GROUP_SOURCE = {
  channel: "telegram" as const,
  threadId: `hid_${"3".repeat(32)}`,
  threadIsDirect: false,
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
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
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
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: {
        core: { id: "member_referrer" },
      },
      status: "found",
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
      request: {
        action: "read_usage_referral",
        sourceConversation: PERSONAL_SOURCE,
      },
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

  it("offers both group referral options to a healthy personal member", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      action: "read_usage_referral",
      result: {
        outcome: "read",
        referral: {
          activeMissions: [],
          availablePolicies: [
            {
              code: "new_person_activation_v1",
              requirementsLabel:
                "Bring one new person into a fresh Murph group. Murph handles setup, and the reward is earned once they join the conversation with their own Murph.",
              rewardLabel:
                "about 10 more days of Murph usage for your Murph",
            },
            {
              code: "active_group_v1",
              requirementsLabel:
                "Start a fresh group and make it genuinely active, with multiple people actually talking.",
              rewardLabel:
                "about 14 more days of Murph usage for your Murph",
            },
          ],
        },
        status: "ok",
      },
    });
  });

  it("frames personal referral rewards as days of Murph usage", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        referral: {
          availablePolicies: [
            {
              code: "new_person_activation_v1",
              requirementsLabel:
                "Bring one new person into a fresh Murph group. Murph handles setup, and the reward is earned once they join the conversation with their own Murph.",
              rewardLabel:
                "about 10 more days of Murph usage for your Murph",
            },
            {
              code: "active_group_v1",
              rewardLabel:
                "about 14 more days of Murph usage for your Murph",
            },
          ],
        },
      },
    });
  });

  it("frames group referral rewards as days of Murph usage", async () => {
    const { prisma } = buildPrisma({
      containerMemberId: "member_group",
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_group",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: TELEGRAM_GROUP_SOURCE,
        telegramSenderHandles: ["123456789"],
      },
    })).resolves.toMatchObject({
      result: {
        referral: {
          availablePolicies: [{
            code: "active_group_v1",
            rewardLabel:
              "about 14 more days of Murph usage for this room",
          }],
        },
        status: "ok",
      },
    });
    expect(mocks.hasHostedRuntimeActiveAccess).toHaveBeenCalledWith(
      "member_group",
      { prisma },
    );
    expect(mocks.readHostedGroupFundingRecoveryStatus).not.toHaveBeenCalled();
    expect(mocks.readHostedGroupUsageStatus).not.toHaveBeenCalled();
  });

  it("keeps an active mission bound to its persisted reward", async () => {
    const { prisma, referrals } = buildPrisma();
    referrals.push({
      armedAt: new Date("2026-07-29T12:00:00.000Z"),
      beneficiaryMemberId: "member_personal",
      expiresAt: new Date("2030-08-05T12:00:00.000Z"),
      id: "hur_frozen_reward",
      policyCode: "active_group_v1",
      policyVersion: ORDINARY_POLICY_VERSION,
      referrerMemberId: "member_personal",
      rewardUsdMicros: 2_750_000n,
      sourceConversationJson: PERSONAL_SOURCE,
      status: "armed",
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: {
          activeMissions: [{
            policyCode: "active_group_v1",
            rewardLabel:
              "about 12 more days of Murph usage for your Murph",
          }],
          availablePolicies: [{
            code: "new_person_activation_v1",
            rewardLabel:
              "about 10 more days of Murph usage for your Murph",
          }],
        },
        status: "ok",
      },
    });
  });

  it("offers only the provider-neutral mission from Telegram", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: TELEGRAM_PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: {
          availablePolicies: [
            {
              code: "active_group_v1",
            },
          ],
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
        policyCodes: ["new_person_activation_v1"],
        sourceConversation: TELEGRAM_PERSONAL_SOURCE,
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

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: ["active_group_v1"],
        sourceConversation: TELEGRAM_PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        referral: {
          activeMissions: [{
            policyCode: "active_group_v1",
            state: "armed",
          }],
        },
        status: "ok",
      },
    });
  });

  it.each([
    { linqService: "sms" as const, title: "SMS" },
    { linqService: "rcs" as const, title: "RCS" },
    { linqService: null, title: "unknown Linq service" },
  ])("offers only the provider-neutral mission from $title", async ({
    linqService,
  }) => {
    const { prisma } = buildPrisma();
    const sourceConversation = {
      channel: "linq" as const,
      ...(linqService ? { linqService } : {}),
      threadId: `hid_${"9".repeat(32)}`,
      threadIsDirect: true,
    };

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation,
      },
    })).resolves.toMatchObject({
      result: {
        referral: {
          availablePolicies: [{ code: "active_group_v1" }],
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
        policyCodes: ["new_person_activation_v1"],
        sourceConversation,
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

  it("does not arm a personal mission without a trusted source conversation", async () => {
    const { prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: ["new_person_activation_v1"],
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

  it("atomically arms and idempotently repeats an exact policy set", async () => {
    const { prisma, referrals } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: [
          "new_person_activation_v1",
          "active_group_v1",
        ],
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        referral: {
          activeMissions: [
            {
              destinationKind: "personal",
              policyCode: "new_person_activation_v1",
              state: "armed",
            },
            {
              destinationKind: "personal",
              policyCode: "active_group_v1",
              state: "armed",
            },
          ],
        },
      },
    });

    expect(referrals).toHaveLength(2);
    expect(referrals[0]).toMatchObject({
      beneficiaryMemberId: "member_personal",
      policyCode: "new_person_activation_v1",
      referrerMemberId: "member_personal",
      sourceConversationJson: {
        channel: "linq",
        threadId: PERSONAL_SOURCE.threadId,
        threadIsDirect: true,
      },
      status: "armed",
    });
    expect(referrals[1]).toMatchObject({
      beneficiaryMemberId: "member_personal",
      policyCode: "active_group_v1",
      referrerMemberId: "member_personal",
      sourceConversationJson: {
        channel: "linq",
        threadId: PERSONAL_SOURCE.threadId,
        threadIsDirect: true,
      },
      status: "armed",
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: [
          "new_person_activation_v1",
          "active_group_v1",
        ],
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        referral: {
          activeMissions: [
            { policyCode: "new_person_activation_v1" },
            { policyCode: "active_group_v1" },
          ],
        },
        status: "ok",
      },
    });
    expect(referrals).toHaveLength(2);

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "cancel_usage_referral",
        policyCode: "new_person_activation_v1",
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "canceled",
        referral: {
          activeMissions: [{
            policyCode: "active_group_v1",
            state: "armed",
          }],
        },
        status: "ok",
      },
    });
    expect(referrals[0]?.status).toBe("canceled");
    expect(referrals[1]?.status).toBe("armed");
  });

  it.each([
    {
      buildInput: { referrerRewardTotal: 5_500_000n },
      label: "combined reward capacity",
    },
    {
      buildInput: { inProgressCount: 2 },
      label: "the remaining in-progress slot",
    },
  ])("leaves both unarmed when $label fits only one", async ({
    buildInput,
  }) => {
    const { prisma, referrals } = buildPrisma(buildInput);

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: [
          "new_person_activation_v1",
          "active_group_v1",
        ],
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toEqual({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "usage_referral_selection_requires_one",
      },
    });
    expect(referrals).toHaveLength(0);
  });

  it("suppresses and rejects a policy already armed for another destination", async () => {
    const { prisma, referrals } = buildPrisma();
    referrals.push({
      armedAt: new Date("2026-07-29T12:00:00.000Z"),
      beneficiaryMemberId: "member_other_destination",
      expiresAt: new Date("2030-08-05T12:00:00.000Z"),
      id: "hur_other_destination",
      policyCode: "active_group_v1",
      policyVersion: ORDINARY_POLICY_VERSION,
      referrerMemberId: "member_personal",
      rewardUsdMicros: 3_500_000n,
      sourceConversationJson: null,
      status: "armed",
    });

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "read_usage_referral",
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: {
          activeMissions: [],
          availablePolicies: [{ code: "new_person_activation_v1" }],
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
        policyCodes: ["active_group_v1"],
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toEqual({
      action: "arm_usage_referral",
      result: {
        referral: null,
        status: "unavailable",
        unavailableReason: "usage_referral_not_available",
      },
    });
    expect(referrals).toHaveLength(1);
    expect(referrals[0]?.beneficiaryMemberId).toBe(
      "member_other_destination",
    );
  });

  it("serializes every database query inside the arm transaction", async () => {
    const { peakTransactionQueries, prisma } = buildPrisma();

    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: ["new_person_activation_v1"],
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
        policyCodes: ["new_person_activation_v1"],
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
        policyCode: "new_person_activation_v1",
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
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: { action: "read_usage_referral" },
    })).resolves.toMatchObject({
      result: {
        outcome: "read",
        referral: { activeMissions: [] },
        status: "ok",
      },
    });
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "arm_usage_referral",
        policyCodes: ["new_person_activation_v1"],
        sourceConversation: PERSONAL_SOURCE,
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "armed",
        referral: {
          activeMissions: [{
            policyCode: "new_person_activation_v1",
            state: "armed",
          }],
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
          activeMissions: [{
            policyCode: "new_person_activation_v1",
            state: "armed",
          }],
        },
        status: "ok",
      },
    });
    await expect(handleHostedUsageReferralGroupTool({
      enabled: true,
      memberId: "member_personal",
      prisma: prisma as never,
      request: {
        action: "cancel_usage_referral",
        policyCode: "new_person_activation_v1",
      },
    })).resolves.toMatchObject({
      result: {
        outcome: "canceled",
        referral: { activeMissions: [] },
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
        policyCodes: ["new_person_activation_v1"],
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
          activeMissions: [{
            policyCode: "new_person_activation_v1",
            state: "armed",
          }],
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
        policyCodes: ["new_person_activation_v1"],
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
      request: {
        action: "cancel_usage_referral",
        policyCode: "new_person_activation_v1",
      },
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
        referral: { activeMissions: [] },
        status: "ok",
      },
    });

    consoleError.mockRestore();
  });
});

function buildPrisma(input: {
  beneficiaryRewardTotal?: bigint;
  containerMemberId?: string;
  inProgressCount?: number;
  referrerRewardTotal?: bigint;
} = {}): {
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

  const matchesReferral = (
    referral: ReferralState,
    where?: {
      beneficiaryMemberId?: string;
      expiresAt?: { gt?: Date };
      policyCode?:
        | ReferralState["policyCode"]
        | { in?: readonly ReferralState["policyCode"][] };
      referrerMemberId?: string;
      status?: string | { in?: readonly string[] };
    },
  ): boolean => {
    if (!where) {
      return true;
    }
    if (
      where.beneficiaryMemberId
      && referral.beneficiaryMemberId !== where.beneficiaryMemberId
    ) {
      return false;
    }
    if (where.policyCode) {
      if (
        typeof where.policyCode === "string"
        && referral.policyCode !== where.policyCode
      ) {
        return false;
      }
      if (
        typeof where.policyCode === "object"
        && where.policyCode.in
        && !where.policyCode.in.includes(referral.policyCode)
      ) {
        return false;
      }
    }
    if (
      where.referrerMemberId
      && referral.referrerMemberId !== where.referrerMemberId
    ) {
      return false;
    }
    if (where.expiresAt?.gt && referral.expiresAt <= where.expiresAt.gt) {
      return false;
    }
    if (
      typeof where.status === "string"
      && referral.status !== where.status
    ) {
      return false;
    }
    if (
      typeof where.status === "object"
      && where.status.in
      && !where.status.in.includes(referral.status)
    ) {
      return false;
    }
    return true;
  };
  const referralDelegate = {
    aggregate: vi.fn(async (query: {
      where?: {
        beneficiaryMemberId?: string;
        referrerMemberId?: string;
      };
    }) => runQuery(() => ({
      _sum: {
        rewardUsdMicros: query.where?.beneficiaryMemberId
          ? input.beneficiaryRewardTotal ?? null
          : input.referrerRewardTotal ?? null,
      },
    }))),
    count: vi.fn(async () =>
      runQuery(() => input.inProgressCount ?? 0)
    ),
    create: vi.fn(async (input: { data: ReferralState }) => runQuery(() => {
      referrals.push({ ...input.data });
      return referrals.at(-1);
    })),
    findFirst: vi.fn(async (
      input?: { where?: Parameters<typeof matchesReferral>[1] },
    ) => runQuery(() =>
      [...referrals]
        .reverse()
        .find((referral) => matchesReferral(referral, input?.where))
        ?? null
    )),
    findMany: vi.fn(async (
      input?: {
        select?: {
          expiresAt?: boolean;
          policyCode?: boolean;
          policyVersion?: boolean;
          rewardUsdMicros?: boolean;
          status?: boolean;
        };
        where?: Parameters<typeof matchesReferral>[1];
      },
    ) => runQuery(() =>
      referrals
        .filter((referral) => matchesReferral(referral, input?.where))
        .map((referral) =>
          input?.select
            ? {
                ...(input.select.expiresAt
                  ? { expiresAt: referral.expiresAt }
                  : {}),
                ...(input.select.policyCode
                  ? { policyCode: referral.policyCode }
                  : {}),
                ...(input.select.policyVersion
                  ? { policyVersion: referral.policyVersion }
                  : {}),
                ...(input.select.rewardUsdMicros
                  ? { rewardUsdMicros: referral.rewardUsdMicros }
                  : {}),
                ...(input.select.status ? { status: referral.status } : {}),
              }
            : referral
        )
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
      findUnique: vi.fn(async (query: {
        where: { memberId: string };
      }) => runQuery(() =>
        query.where.memberId === input.containerMemberId
          ? { memberId: input.containerMemberId }
          : null
      )),
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
