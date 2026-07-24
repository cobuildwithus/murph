import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertParticipantAuthority: vi.fn(),
  claimDelivery: vi.fn(),
  claimLineCapacity: vi.fn(),
  createChat: vi.fn(),
  decideSendWindow: vi.fn(),
  listHealthyLines: vi.fn(),
  lookupMember: vi.fn(),
  markDeliveryAccepted: vi.fn(),
  markDeliveryFailed: vi.fn(),
  readParticipantPhone: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedLinqChatLookupKey: (value: string | null | undefined) =>
    value ? `chat:${value}` : null,
  createHostedLinqMessageLookupKey: (value: string | null | undefined) =>
    value ? `message:${value}` : null,
  createHostedPhoneLookupKeyReadCandidates: (value: string) =>
    [`phone:${value}`],
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  claimHostedLinqDeliveryProviderDispatchTx: mocks.claimDelivery,
  markHostedLinqDeliveryAcceptedTx: mocks.markDeliveryAccepted,
  markHostedLinqDeliverySendFailedTx: mocks.markDeliveryFailed,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  claimHostedLinqProactiveConversationCapacityTx: mocks.claimLineCapacity,
  listHostedLinqHealthyProactiveLines: mocks.listHealthyLines,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  createHostedLinqChat: mocks.createChat,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-egress-engagement", () => ({
  assertHostedLinqGroupJoinOutreachParticipantEgressAuthority:
    mocks.assertParticipantAuthority,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupMember,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-store", () => ({
  readHostedGroupJoinOutreachParticipantPhone: mocks.readParticipantPhone,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-window", () => ({
  decideHostedGroupJoinOutreachSendWindow: mocks.decideSendWindow,
}));

import {
  buildHostedGroupJoinOutreachMessage,
  drainOneHostedGroupJoinOutreach,
} from "@/src/lib/hosted-groups/group-join-outreach-drain";

const NOW = new Date("2026-07-24T16:00:00.000Z");
const LINE = {
  activeMemberLimit: null,
  assignmentWeight: 100,
  maxNewConversationsPerDay: 20,
  phoneNumber: "+15550000001",
  phoneNumberHint: "•••0001",
  phoneNumberLookupKey: "line_lookup_1",
  proactiveConversationCount: 0,
  proactiveConversationDayUtc: new Date("2026-07-24T00:00:00.000Z"),
};

describe("hosted group join outreach drain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertParticipantAuthority.mockResolvedValue(undefined);
    mocks.claimDelivery.mockResolvedValue({
      claimed: true,
      id: "hld_opaque",
    });
    mocks.claimLineCapacity.mockResolvedValue(true);
    mocks.createChat.mockResolvedValue({
      chatId: "chat_direct_opaque",
      messageId: "message_opaque",
    });
    mocks.decideSendWindow.mockReturnValue({ kind: "send_now" });
    mocks.listHealthyLines.mockResolvedValue([LINE]);
    mocks.lookupMember.mockResolvedValue(null);
    mocks.markDeliveryAccepted.mockResolvedValue({
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markDeliveryFailed.mockResolvedValue(undefined);
    mocks.readParticipantPhone.mockReturnValue("+15551234567");
  });

  it("sends one paced, link-free, group-specific first outreach", async () => {
    const { prisma } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "sent",
      outreachId: "hgrpjoa_opaque",
    });

    expect(mocks.claimLineCapacity).toHaveBeenCalledWith({
      dayUtc: new Date("2026-07-24T00:00:00.000Z"),
      limit: 20,
      phoneNumberLookupKey: "line_lookup_1",
      prisma: expect.anything(),
    });
    expect(mocks.assertParticipantAuthority).toHaveBeenCalledWith({
      fromPhoneNumber: "+15550000001",
      idempotencyKey: "group-join-outreach:hgrpjoa_opaque",
      outreachId: "hgrpjoa_opaque",
      prisma,
      targetPhoneNumber: "+15551234567",
    });
    expect(mocks.createChat).toHaveBeenCalledTimes(1);
    const send = mocks.createChat.mock.calls[0]?.[0] as {
      message: string;
    } | undefined;
    expect(send?.message).toContain("Training circle");
    expect(send?.message).toMatch(/reply here/iu);
    expect(send?.message).not.toMatch(/https?:|www\./iu);
  });

  it("defers durably without a provider call when every line is at cap", async () => {
    mocks.claimLineCapacity.mockResolvedValue(false);
    const { prisma, updateMany } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "line_capacity_exhausted",
    });

    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeferralReason: "line_capacity_exhausted",
        }),
      }),
    );
  });

  it("never lets a URL-shaped group name enter first-contact copy", () => {
    expect(buildHostedGroupJoinOutreachMessage("https://example.test/join"))
      .toBe("You liked the invite to this group. Reply here and I'll help you join.");
  });

  it("keeps forbidden punctuation and links out of first-contact copy", () => {
    const message = buildHostedGroupJoinOutreachMessage("Sunday Sleep Crew");
    expect(message).toBe(
      "You liked the invite to Sunday Sleep Crew. Reply here and I'll help you join.",
    );
    expect(message).not.toContain("—");
    expect(message).not.toMatch(/https?:\/\//u);
  });
});

function createPrismaStub(): {
  prisma: Parameters<typeof drainOneHostedGroupJoinOutreach>[0]["prisma"];
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const dueOutreach = {
    attemptCount: 0,
    dispatchStartedAt: null,
    groupId: "hgrp_opaque",
    id: "hgrpjoa_opaque",
    offerId: "hgrpjo_opaque",
    participantPhoneEncrypted: "encrypted",
    participantPhoneLookupKey: "participant_lookup_1",
    phoneNumberLookupKey: null,
    requestedAt: NOW,
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    hostedGroupJoinOffer: {
      findUnique: vi.fn(async () => ({
        group: {
          displayName: "Training circle",
          id: "hgrp_opaque",
          joinCode: "join_opaque",
          runtimeMemberId: "hbm_runtime",
        },
        groupId: "hgrp_opaque",
        revokedAt: null,
      })),
    },
    hostedGroupJoinOutreach: {
      findFirst: vi.fn(async (input: {
        where: Record<string, unknown>;
      }) => "nextAttemptAt" in input.where ? dueOutreach : null),
      findUnique: vi.fn(async () => ({ attemptCount: 1 })),
      update: vi.fn(async () => dueOutreach),
      updateMany,
    },
  };
  const prisma = {
    $transaction: vi.fn(async <T>(
      run: (transaction: typeof tx) => Promise<T>,
    ) => run(tx)),
  } as never;
  return { prisma, updateMany };
}
