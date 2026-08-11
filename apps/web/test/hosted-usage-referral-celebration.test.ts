import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  readHostedMemberAssistantPreferences: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));
vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  readHostedMemberAssistantPreferences:
    mocks.readHostedMemberAssistantPreferences,
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

import {
  reconcileHostedUsageReferralRewardAfterCommit,
} from "@/src/lib/hosted-growth/usage-referral";

const REWARDED_AT = new Date("2026-08-06T12:00:00.000Z");
const GROUP_DESTINATION = {
  conversationShape: "thread-container" as const,
  externalThreadRouteAuthority: {
    accountLookupKey: "blinded-account-key",
    channel: "linq" as const,
    containerMemberId: "member_group",
    threadId: "provider-group-thread",
  },
  route: {
    actorId: null,
    channel: "linq" as const,
    delivery: {
      kind: "thread" as const,
      target: "provider-group-thread",
    },
    identityId: `hid_${"1".repeat(32)}`,
    threadId: `hid_${"2".repeat(32)}`,
    threadIsDirect: false,
  },
};

function createPrisma() {
  const rewardedReferral = {
    beneficiaryMemberId: "member_group",
    celebrationQueuedAt: null,
    policyCode: "active_group_v1",
    policyVersion: "hosted-usage-referral-2026-07-v1",
    referrerMemberId: "member_referrer",
    rewardUsdMicros: 2_750_000n,
    rewardedAt: REWARDED_AT,
    sourceConversationJson: null,
    status: "rewarded",
  };
  const findUnique = vi.fn().mockImplementation(async (input: {
    select: { rewardUsdMicros?: boolean };
  }) =>
    input.select.rewardUsdMicros
      ? rewardedReferral
      : {
          beneficiaryMemberId: rewardedReferral.beneficiaryMemberId,
          referrerMemberId: rewardedReferral.referrerMemberId,
          status: rewardedReferral.status,
        }
  );
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    hostedUsageReferral: { findUnique, updateMany },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };
  return { findUnique, prisma, updateMany };
}

describe("hosted usage referral celebration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        dedupeKey:
          "assistant.notification.requested:usage-referral-reward:hur_group",
        id: "mailbox_group_notice",
        lane: "conversation",
        laneSeq: 11n,
      },
    });
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      persona: null,
      personality: {
        detail: null,
        humor: null,
        push: null,
        unhinged: null,
      },
      tone: null,
      voice: null,
    });
    mocks.resolveHostedAssistantNotificationDestination
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(GROUP_DESTINATION);
  });

  it("keeps a delayed notice bound to the persisted reward day estimate", async () => {
    const { findUnique, prisma, updateMany } = createPrisma();

    await expect(reconcileHostedUsageReferralRewardAfterCommit({
      prisma: prisma as never,
      referralId: "hur_group",
    })).resolves.toBeNull();

    await expect(reconcileHostedUsageReferralRewardAfterCommit({
      prisma: prisma as never,
      referralId: "hur_group",
    })).resolves.toEqual({
      eventId:
        "assistant.notification.requested:usage-referral-reward:hur_group",
      linqChatId: "provider-group-thread",
      mailboxItemId: "mailbox_group_notice",
      source: "linq",
      userId: "member_group",
      wakeMailboxCheckpoint: {
        lane: "conversation",
        laneSeq: 11n,
      },
    });

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ rewardUsdMicros: true }),
    }));
    expect(updateMany).toHaveBeenCalledWith({
      data: { updatedAt: expect.any(Date) },
      where: {
        celebrationQueuedAt: null,
        id: "hur_group",
        status: "rewarded",
      },
    });
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      ?.envelope;
    expect(envelope?.notification.instructions).toContain(
      "about 12 more days of Murph usage for this room",
    );
    expect(envelope?.notification.instructions).toContain(
      'Final message: include "about 12 more days of Murph usage for this room" exactly',
    );
    expect(envelope?.notification.instructions).not.toContain(
      "about 14 more days of Murph usage",
    );
  });
});
