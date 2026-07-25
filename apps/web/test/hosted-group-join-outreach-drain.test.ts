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
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

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

  // Each of these is a refusal that must never reach the provider. Proving them
  // together is what keeps an unsolicited or duplicate cold thread from becoming
  // possible while the happy-path test stays green.
  const refusals: readonly {
    arrange: () => void;
    expected: { kind: "deferred" | "skipped"; reason: string };
    name: string;
    stub?: Parameters<typeof createPrismaStub>[0];
  }[] = [
    {
      arrange: () => {
        mocks.lookupMember.mockResolvedValue({
          core: { id: "hbm_existing", suspendedAt: null },
        });
      },
      expected: { kind: "skipped", reason: "recipient_now_member" },
      name: "the recipient already has an account",
    },
    {
      arrange: () => {},
      expected: { kind: "skipped", reason: "recipient_already_outreached" },
      name: "the recipient already has a cold thread for another group",
      stub: { priorAttempt: { id: "hgrpjoa_earlier" } },
    },
    {
      arrange: () => {
        mocks.decideSendWindow.mockReturnValue({
          kind: "defer",
          nextAttemptAt: new Date("2026-07-25T13:00:00.000Z"),
          reason: "recipient_quiet_hours",
        });
      },
      expected: { kind: "deferred", reason: "recipient_quiet_hours" },
      name: "the recipient is inside quiet hours",
    },
    {
      arrange: () => {
        mocks.listHealthyLines.mockResolvedValue([]);
      },
      expected: { kind: "deferred", reason: "no_healthy_line" },
      name: "no healthy line can send",
    },
    {
      arrange: () => {
        mocks.claimDelivery.mockResolvedValue({ claimed: false, retryAt: null });
      },
      expected: { kind: "deferred", reason: "delivery_in_flight" },
      name: "a delivery attempt is already in flight",
    },
    {
      arrange: () => {
        mocks.readParticipantPhone.mockReturnValue(null);
      },
      expected: { kind: "skipped", reason: "participant_phone_unreadable" },
      name: "the stored participant phone cannot be read",
    },
    {
      arrange: () => {},
      expected: { kind: "skipped", reason: "offer_revoked" },
      name: "the offer was revoked after enqueue",
      stub: { offerRevokedAt: new Date("2026-07-24T15:00:00.000Z") },
    },
  ];

  for (const refusal of refusals) {
    it(`refuses without a provider call when ${refusal.name}`, async () => {
      refusal.arrange();
      const { prisma, updateMany } = createPrismaStub(refusal.stub);

      await expect(drainOneHostedGroupJoinOutreach({
        now: NOW,
        prisma,
      })).resolves.toEqual({
        ...refusal.expected,
        outreachId: "hgrpjoa_opaque",
      });

      expect(mocks.createChat).not.toHaveBeenCalled();
      expect(mocks.assertParticipantAuthority).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining(
            refusal.expected.kind === "skipped"
              ? { skipReason: refusal.expected.reason }
              : { lastDeferralReason: refusal.expected.reason },
          ),
        }),
      );
    });
  }

  it("persists the exact next attempt instant for a quiet-hours deferral", async () => {
    const nextAttemptAt = new Date("2026-07-25T13:00:00.000Z");
    mocks.decideSendWindow.mockReturnValue({
      kind: "defer",
      nextAttemptAt,
      reason: "recipient_quiet_hours",
    });
    const { prisma, updateMany } = createPrismaStub();

    await drainOneHostedGroupJoinOutreach({ now: NOW, prisma });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeferralReason: "recipient_quiet_hours",
          nextAttemptAt,
        }),
      }),
    );
  });

  it("retries a retryable provider failure instead of abandoning the recipient", async () => {
    mocks.createChat.mockRejectedValue(new Error("provider unavailable"));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 1 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_retry",
    });

    expect(mocks.markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterAt: expect.any(Date) }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDeferralReason: "provider_retry" }),
      }),
    );
  });

  it("stops retrying a provider rejection that cannot succeed", async () => {
    mocks.createChat.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_LINQ_SEND_REJECTED",
      httpStatus: 400,
      message: "Provider rejected the recipient.",
      retryable: false,
    }));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 1 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "skipped",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_rejected",
    });

    expect(mocks.markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterAt: null }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skipReason: "provider_rejected" }),
      }),
    );
  });

  it("stops after the provider attempt ceiling", async () => {
    mocks.createChat.mockRejectedValue(new Error("provider unavailable"));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 5 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "skipped",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_attempt_limit",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skipReason: "provider_attempt_limit" }),
      }),
    );
  });

  it("reports idle without touching the provider when nothing is due", async () => {
    const { prisma } = createPrismaStub({ due: null });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({ kind: "idle" });

    expect(mocks.createChat).not.toHaveBeenCalled();
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

function createPrismaStub(options?: {
  attemptCount?: number;
  due?: null;
  offerRevokedAt?: Date;
  priorAttempt?: { id: string } | null;
}): {
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
        revokedAt: options?.offerRevokedAt ?? null,
      })),
    },
    hostedGroupJoinOutreach: {
      // The drain reads three different shapes through findFirst: the due row,
      // this participant's prior cold attempt, and the newest attempt anywhere
      // for global pacing. Distinguish them by the predicate each one uses.
      findFirst: vi.fn(async (input: {
        where: Record<string, unknown>;
      }) => {
        if ("nextAttemptAt" in input.where) {
          return options?.due === null ? null : dueOutreach;
        }
        if ("participantPhoneLookupKey" in input.where) {
          return options?.priorAttempt ?? null;
        }
        return null;
      }),
      findUnique: vi.fn(async () => ({
        attemptCount: options?.attemptCount ?? 1,
      })),
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
