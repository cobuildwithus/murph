import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  buildHostedUsageReferralRewardLabel: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));
vi.mock(
  "@/src/lib/hosted-routing/assistant-notification-destination",
  async (importOriginal) => ({
    ...await importOriginal<
      typeof import("@/src/lib/hosted-routing/assistant-notification-destination")
    >(),
    resolveHostedAssistantNotificationDestination:
      mocks.resolveHostedAssistantNotificationDestination,
  }),
);
vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  buildHostedUsageReferralRewardLabel:
    mocks.buildHostedUsageReferralRewardLabel,
}));

import {
  appendHostedSignupReferralRewardNotice,
  buildHostedSignupReferralRewardNoticeWake,
} from "@/src/lib/hosted-growth/signup-referral-notification";

const REWARDED_AT = new Date("2026-08-06T12:00:00.000Z");
const SIGNUP_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";
const DIRECT_LINQ_DESTINATION = {
  conversationShape: "direct-member" as const,
  externalThreadRouteAuthority: null,
  route: {
    actorId: null,
    channel: "linq" as const,
    delivery: {
      kind: "thread" as const,
      target: "provider-direct-thread",
    },
    identityId: `hid_${"1".repeat(32)}`,
    threadId: `hid_${"2".repeat(32)}`,
    threadIsDirect: true,
  },
};

function createPrisma(input: {
  destinationAvailable?: boolean;
  queuedCount?: number;
} = {}) {
  const updateMany = vi.fn().mockResolvedValue({
    count: input.queuedCount ?? 1,
  });
  const tx = {
    hostedUsageReferral: { updateMany },
  };
  const prisma = {
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
    hostedUsageReferral: {
      findUnique: vi.fn().mockResolvedValue({
        beneficiaryMemberId: "member_referrer",
        celebrationQueuedAt: null,
        policyCode: "new_person_activation_v1",
        policyVersion: SIGNUP_POLICY_VERSION,
        referrerMemberId: "member_referrer",
        rewardUsdMicros: 2_750_000n,
        rewardedAt: REWARDED_AT,
        status: "rewarded",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(
    input.destinationAvailable === false
      ? null
      : DIRECT_LINQ_DESTINATION,
  );
  return { prisma, tx, updateMany };
}

describe("hosted signup referral reward notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        dedupeKey:
          "assistant.notification.requested:usage-referral-reward:hur_signup",
        id: "mailbox_signup_notice",
        lane: "system",
        laneSeq: 7n,
      },
    });
    mocks.buildHostedUsageReferralRewardLabel.mockReturnValue(
      "about 12 more days of Murph usage for your Murph",
    );
  });

  it("builds one concise, identity-safe completion message", () => {
    const wake = buildHostedSignupReferralRewardNoticeWake({
      beneficiaryMemberId: "member_referrer",
      destination: DIRECT_LINQ_DESTINATION,
      notificationKey: "usage-referral-reward:hur_signup",
      rewardLabel: "about 12 more days of Murph usage for your Murph",
      rewardedAt: REWARDED_AT,
    });

    expect(wake.notification.route.delivery).toEqual({
      kind: "explicit",
      target: "provider-direct-thread",
    });
    expect(wake.notification.externalThreadRouteAuthority).toEqual({
      channel: "linq",
      containerMemberId: "member_referrer",
      threadId: "provider-direct-thread",
    });
    expect(wake.notification.instructions).toContain(
      "someone completed Murph setup through their referral link",
    );
    expect(wake.notification.instructions).toContain(
      "already received about 12 more days of Murph usage for your Murph",
    );
    expect(wake.notification.instructions).toContain(
      'Final message: include "about 12 more days of Murph usage for your Murph" exactly',
    );
    expect(wake.notification.instructions).toContain(
      "Do not identify, name, or guess who joined",
    );
    expect(wake.notification.instructions).toContain(
      "Do not ask the member to complete another step",
    );
    expect(wake.notification.instructions).not.toContain(
      "Do not mention dollars",
    );
  });

  it("queues the notice and marks the existing receipt atomically", async () => {
    const { prisma, tx, updateMany } = createPrisma();

    await expect(appendHostedSignupReferralRewardNotice({
      prisma: prisma as never,
      referralId: "hur_signup",
    })).resolves.toEqual({
      eventId:
        "assistant.notification.requested:usage-referral-reward:hur_signup",
      linqChatId: "provider-direct-thread",
      mailboxItemId: "mailbox_signup_notice",
      source: "linq",
      userId: "member_referrer",
      wakeMailboxCheckpoint: {
        lane: "system",
        laneSeq: 7n,
      },
    });

    expect(
      mocks.resolveHostedAssistantNotificationDestination,
    ).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_referrer",
      prisma,
    });
    expect(
      mocks.buildHostedUsageReferralRewardLabel,
    ).toHaveBeenCalledExactlyOnceWith({
      destinationKind: "personal",
      policyCode: "new_person_activation_v1",
      policyVersion: SIGNUP_POLICY_VERSION,
      rewardUsdMicros: 2_750_000n,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId:
          "assistant.notification.requested:usage-referral-reward:hur_signup",
      }),
      tx,
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        celebrationQueuedAt: expect.any(Date),
        sourceConversationJson: expect.anything(),
      },
      where: {
        beneficiaryMemberId: "member_referrer",
        celebrationQueuedAt: null,
        id: "hur_signup",
        policyVersion: SIGNUP_POLICY_VERSION,
        referrerMemberId: "member_referrer",
        rewardedAt: REWARDED_AT,
        status: "rewarded",
      },
    });
  });

  it("retries a route-less notice with the persisted reward amount", async () => {
    const { prisma } = createPrisma({ destinationAvailable: false });

    await expect(appendHostedSignupReferralRewardNotice({
      prisma: prisma as never,
      referralId: "hur_signup",
    })).resolves.toBeNull();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedUsageReferral.updateMany).toHaveBeenCalledWith({
      data: { updatedAt: expect.any(Date) },
      where: {
        celebrationQueuedAt: null,
        id: "hur_signup",
        status: "rewarded",
      },
    });

    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue(
      DIRECT_LINQ_DESTINATION,
    );
    await expect(appendHostedSignupReferralRewardNotice({
      prisma: prisma as never,
      referralId: "hur_signup",
    })).resolves.toEqual(expect.objectContaining({
      mailboxItemId: "mailbox_signup_notice",
    }));

    expect(mocks.buildHostedUsageReferralRewardLabel).toHaveBeenCalledWith({
      destinationKind: "personal",
      policyCode: "new_person_activation_v1",
      policyVersion: SIGNUP_POLICY_VERSION,
      rewardUsdMicros: 2_750_000n,
    });
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      ?.envelope;
    expect(envelope?.notification.instructions).toContain(
      "about 12 more days of Murph usage for your Murph",
    );
  });

  it("fails closed if another worker wins the notice fence", async () => {
    const { prisma } = createPrisma({ queuedCount: 0 });

    await expect(appendHostedSignupReferralRewardNotice({
      prisma: prisma as never,
      referralId: "hur_signup",
    })).rejects.toThrow(
      "Hosted signup-referral notice lost its rewarded referral.",
    );
  });
});
