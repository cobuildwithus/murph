import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors linq-client's own attempt budget; the share module derives its
// pre-send deadline from that owner rather than restating the number.
const SEND_ATTEMPT_BUDGET_MS = 7_000;

const shareSendMocks = vi.hoisted(() => ({
  buildMurphHostedLinqContactCardVcf: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getHostedLinqChatHandles: vi.fn(),
  getHostedLinqContactCard: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
  shareHostedLinqContactCard: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/contact-privacy")
  >();
  const createStableHostedLinqChatLookupKey = (
    value: string | number | null | undefined,
  ): string | null => {
    const normalized = typeof value === "number" ? String(value) : value?.trim();
    return normalized ? `hbidx:linq-chat:v1:${normalized}` : null;
  };

  return {
    ...actual,
    createHostedLinqChatLookupKey: createStableHostedLinqChatLookupKey,
    createHostedLinqChatLookupKeyReadCandidates: (
      value: string | number | null | undefined,
    ): string[] => {
      const lookupKey = createStableHostedLinqChatLookupKey(value);
      return lookupKey ? [lookupKey] : [];
    },
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  HOSTED_LINQ_ATTACHMENT_SEND_ATTEMPT_TIMEOUT_MS: 7_000,
  getHostedLinqChatHandles: shareSendMocks.getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure: (error: unknown) =>
    Boolean(
      error
      && typeof error === "object"
      && (error as { details?: { phase?: string } }).details?.phase === "prepare",
    ),
  isHostedLinqIdempotencyKeyReuseFailure: (error: unknown) =>
    Boolean(
      error
      && typeof error === "object"
      && (error as { details?: { idempotencyKeyReuseConflict?: boolean } })
        .details?.idempotencyKeyReuseConflict === true,
    ),
  isHostedLinqUnconfirmedAcknowledgementFailure: (error: unknown) =>
    Boolean(
      error
      && typeof error === "object"
      && (error as { details?: { acknowledgementUnconfirmed?: boolean } })
        .details?.acknowledgementUnconfirmed === true,
    ),
  sendHostedLinqAttachmentMessage: shareSendMocks.sendHostedLinqAttachmentMessage,
  shareHostedLinqContactCard: shareSendMocks.shareHostedLinqContactCard,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card", () => ({
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE: "text/vcard",
  MURPH_CONTACT_CARD_VCF_FILE_NAME: "Murph.vcf",
  buildMurphHostedLinqContactCardVcf: shareSendMocks.buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto:
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto,
  getHostedLinqContactCard: shareSendMocks.getHostedLinqContactCard,
  resolveMurphHostedLinqContactCardBackupPhoneNumber:
    shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
}));

import {
  HOSTED_LINQ_PERSONALIZED_CONTACT_CARD_OPERATION_BUDGET_MS,
  isHostedLinqContactCardAutoShareEligible,
  releaseHostedLinqContactCardShareAttempt,
  reserveHostedLinqContactCardShareAttempt,
  resolveHostedLinqPersonalizedContactCardDeadlines,
  shareMurphHostedLinqNativeContactCardToChat,
  shareMurphHostedLinqContactCardVcfToChat,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";

describe("hosted Linq contact-card share reservations", () => {
  it("throttles repeat contact-card shares for 90 seconds, then allows a re-share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: new Date("2026-06-27T12:01:29.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });

    const nextAttempt = new Date("2026-06-27T12:01:30.000Z");
    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: nextAttempt,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
      attemptedAt: nextAttempt,
    });
  });

  it("releases only the matching unsent vCard reservation", async () => {
    const prisma = createContactCardSharePrismaStub();
    const attemptedAt = new Date("2026-06-27T12:00:00.000Z");

    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: attemptedAt,
      prisma: prisma.client,
    });
    await releaseHostedLinqContactCardShareAttempt({
      attemptedAt,
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toBeNull();
  });
});

describe("isHostedLinqContactCardAutoShareEligible", () => {
  it("allows iMessage threads regardless of direct or group shape", () => {
    expect(isHostedLinqContactCardAutoShareEligible({ service: "iMessage" })).toBe(true);
    expect(isHostedLinqContactCardAutoShareEligible({ service: " imessage " })).toBe(true);
  });

  it("rejects non-iMessage and unknown services", () => {
    expect(isHostedLinqContactCardAutoShareEligible({ service: "sms" })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: "rcs" })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: null })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: "" })).toBe(false);
  });
});

describe("shareMurphHostedLinqNativeContactCardToChat", () => {
  beforeEach(() => {
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);
    shareSendMocks.getHostedLinqContactCard.mockResolvedValue({
      firstName: "Murph",
      imageUrl: null,
      imageUrlPresent: true,
      isActive: true,
      lastName: null,
      phoneNumber: "+15557770000",
    });
    shareSendMocks.shareHostedLinqContactCard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a matching active line card with an explicitly absent image before sharing", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const signal = new AbortController().signal;

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
      signal,
    })).resolves.toEqual({ status: "sent" });

    expect(shareSendMocks.getHostedLinqChatHandles).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal,
    });
    expect(shareSendMocks.getHostedLinqContactCard).toHaveBeenCalledWith({
      phoneNumber: "+15557770000",
      signal,
    });
    expect(shareSendMocks.shareHostedLinqContactCard).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal,
    });
    expect(prisma.rows).toEqual([
      expect.objectContaining({
        lastContactCardShareAttemptedAt: now,
        memberId: "member_123",
      }),
    ]);
  });

  it("uses the only active self handle when a stale self handle is also present", async () => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValueOnce([
      { handle: "+15556660000", isMe: true, status: "inactive" },
      { handle: "+15557770000", isMe: true, status: " ACTIVE " },
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({ status: "sent" });

    expect(shareSendMocks.getHostedLinqContactCard).toHaveBeenCalledWith({
      phoneNumber: "+15557770000",
    });
    expect(shareSendMocks.shareHostedLinqContactCard).toHaveBeenCalledOnce();
  });

  it("skips an imaged line card without reserving or invoking native share", async () => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqContactCard.mockResolvedValueOnce({
      firstName: "Murph",
      imageUrl: "https://assets.example.invalid/line-card.png",
      imageUrlPresent: true,
      isActive: true,
      lastName: null,
      phoneNumber: "+15557770000",
    });

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      status: "skipped",
      reason: "line_card_has_image",
    });

    expect(prisma.model.findMany).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty roster", []],
    [
      "zero active self handles",
      [
        { handle: "+15556660000", isMe: true, status: "inactive" },
        { handle: "+15550000001", isMe: false, status: "active" },
      ],
    ],
    [
      "an unresolvable active self handle",
      [{ handle: "unresolvable-handle", isMe: true, status: "active" }],
    ],
    [
      "multiple active self handles",
      [
        { handle: "+15557770000", isMe: true, status: "active" },
        { handle: "+15558880000", isMe: true, status: "active" },
      ],
    ],
  ])("skips as line_card_unverified for %s", async (_label, handles) => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValueOnce(handles);

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      status: "skipped",
      reason: "line_card_unverified",
    });

    expect(shareSendMocks.getHostedLinqContactCard).not.toHaveBeenCalled();
    expect(prisma.model.findMany).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it.each([
    ["the line card is missing", null],
    [
      "the line card is inactive",
      {
        firstName: "Murph",
        imageUrl: null,
        imageUrlPresent: true,
        isActive: false,
        lastName: null,
        phoneNumber: "+15557770000",
      },
    ],
    [
      "the line card phone does not match",
      {
        firstName: "Murph",
        imageUrl: null,
        imageUrlPresent: true,
        isActive: true,
        lastName: null,
        phoneNumber: "+15557770001",
      },
    ],
    [
      "the image_url field was omitted",
      {
        firstName: "Murph",
        imageUrl: null,
        imageUrlPresent: false,
        isActive: true,
        lastName: null,
        phoneNumber: "+15557770000",
      },
    ],
  ])("skips as line_card_unverified when %s", async (_label, lineCard) => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqContactCard.mockResolvedValueOnce(lineCard);

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      status: "skipped",
      reason: "line_card_unverified",
    });

    expect(prisma.model.findMany).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("skips as line_card_unverified when the line-card read throws", async () => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqContactCard.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      status: "skipped",
      reason: "line_card_unverified",
    });

    expect(prisma.model.findMany).not.toHaveBeenCalled();
    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("reports already_shared for a recent reservation without invoking native share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      now: new Date("2026-07-24T12:00:45.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ status: "already_shared" });

    expect(shareSendMocks.getHostedLinqContactCard).toHaveBeenCalledWith({
      phoneNumber: "+15557770000",
    });
    expect(shareSendMocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("keeps the reservation when the native share fails ambiguously", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const error = new Error("native share maybe delivered");
    shareSendMocks.shareHostedLinqContactCard.mockRejectedValueOnce(error);

    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({ status: "failed", reason: "send_failed", error });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toEqual(now);
    await expect(shareMurphHostedLinqNativeContactCardToChat({
      chatId: "chat_123",
      memberId: "member_123",
      now: new Date("2026-07-24T12:00:45.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ status: "already_shared" });
    expect(shareSendMocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(1);
  });
});

describe("shareMurphHostedLinqContactCardVcfToChat", () => {
  beforeEach(() => {
    shareSendMocks.buildMurphHostedLinqContactCardVcf.mockReturnValue(
      "BEGIN:VCARD\r\nEND:VCARD\r\n",
    );
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue(null);
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);
    shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber
      .mockResolvedValue("+15558880000");
    shareSendMocks.sendHostedLinqAttachmentMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "msg_1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends the vcf using the chat's own line and the caller's idempotency prefix", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "sent" });

    expect(shareSendMocks.buildMurphHostedLinqContactCardVcf).toHaveBeenCalledWith({
      backupPhoneNumber: "+15558880000",
      phoneNumber: "+15557770000",
      photo: null,
    });
    expect(shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber)
      .toHaveBeenCalledWith(
        expect.objectContaining({ excludePhoneNumber: "+15557770000" }),
      );
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        contentType: "text/vcard",
        fileName: "Murph.vcf",
        // Keyed to the reservation instant so retries of one reservation
        // dedupe while a later requested re-share is a distinct send.
        idempotencyKey: `group-contact-card:chat_123:${now.getTime()}`,
      }),
    );
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toEqual(now);
  });

  it("fetches and embeds a caller-provided generated contact photo", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    const photo = {
      base64: "aGVsbG8=",
      type: "JPEG" as const,
    };
    const signal = new AbortController().signal;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto
      .mockResolvedValueOnce(photo);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl,
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
      shareKey: "input_first",
      signal,
    })).resolves.toEqual({ status: "sent" });

    // The photo fetch is a pre-send phase, so it carries the composed pre-send
    // deadline rather than the caller signal itself. The caller signal still
    // aborts it, and the send below still gets the caller signal unbounded.
    const [photoCall] = shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto
      .mock.calls as [[{ imageUrl: string; signal: AbortSignal }]];
    expect(photoCall[0].imageUrl).toBe(imageUrl);
    expect(photoCall[0].signal).toBeInstanceOf(AbortSignal);
    expect(photoCall[0].signal).not.toBe(signal);
    expect(shareSendMocks.buildMurphHostedLinqContactCardVcf).toHaveBeenCalledWith({
      backupPhoneNumber: "+15558880000",
      phoneNumber: "+15557770000",
      photo,
    });
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "personalized-contact-card:chat_123:input_first",
      }),
    );
  });

  it("does not send a personalized card when its generated photo is unavailable", async () => {
    const prisma = createContactCardSharePrismaStub();
    const canonicalAt = new Date("2026-07-24T12:00:00.000Z");
    const personalizedAt = new Date("2026-07-24T12:00:45.000Z");
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: canonicalAt,
      prisma: prisma.client,
    });
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto
      .mockResolvedValueOnce(null);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl,
      memberId: "member_123",
      now: personalizedAt,
      prisma: prisma.client as never,
      shareKey: "input_first",
    })).resolves.toEqual({
      status: "skipped",
      reason: "photo_unavailable",
    });

    expect(shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto)
      .toHaveBeenCalledWith({ imageUrl, signal: expect.any(AbortSignal) });
    expect(shareSendMocks.buildMurphHostedLinqContactCardVcf).not.toHaveBeenCalled();
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
    // The canonical reservation is untouched and the personalized attempt
    // wrote no row of its own.
    expect(prisma.rows).toEqual([
      expect.objectContaining({
        lastContactCardShareAttemptedAt: canonicalAt,
      }),
    ]);
  });

  it("keys a personalized send on its accepted request, not on wall-clock time", async () => {
    const prisma = createContactCardSharePrismaStub();
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "aGVsbG8=",
      type: "JPEG",
    });
    const share = (now: Date, shareKey: string) =>
      shareMurphHostedLinqContactCardVcfToChat({
        chatId: "chat_123",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl,
        memberId: "member_123",
        now,
        prisma: prisma.client as never,
        shareKey,
      });
    const sentKeys = () =>
      shareSendMocks.sendHostedLinqAttachmentMessage.mock.calls
        .map((call) => call[0]?.idempotencyKey);

    await expect(share(new Date("2026-07-24T12:00:00.000Z"), "input_first"))
      .resolves.toEqual({ status: "sent" });
    // A replay of the same accepted request long after the old 90s window —
    // an image generation alone may run for minutes — must still present the
    // provider with the identical key, so only one card can exist.
    await expect(share(new Date("2026-07-24T12:05:00.000Z"), "input_first"))
      .resolves.toEqual({ status: "sent" });
    // A different accepted request is a new intent, not a duplicate.
    await expect(share(new Date("2026-07-24T12:05:10.000Z"), "input_second"))
      .resolves.toEqual({ status: "sent" });

    expect(sentKeys()).toEqual([
      "personalized-contact-card:chat_123:input_first",
      "personalized-contact-card:chat_123:input_first",
      "personalized-contact-card:chat_123:input_second",
    ]);
    // No wall-clock reservation row is written for personalized sends, so the
    // table cannot grow one row per request.
    expect(prisma.rows).toHaveLength(0);
  });

  it("keeps the canonical share on its reservation-keyed identity", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "sent" });
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now: new Date("2026-07-24T12:00:45.000Z"),
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "already_shared" });

    expect(shareSendMocks.sendHostedLinqAttachmentMessage)
      .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        idempotencyKey: `group-contact-card:chat_123:${now.getTime()}`,
      }));
    expect(prisma.rows).toHaveLength(1);
  });

  it("reads only a personalized replay's provider key conflict as already sent", async () => {
    const prisma = createContactCardSharePrismaStub();
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "aGVsbG8=",
      type: "JPEG",
    });
    const personalizedShare = () =>
      shareMurphHostedLinqContactCardVcfToChat({
        chatId: "chat_123",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl,
        memberId: "member_123",
        prisma: prisma.client as never,
        shareKey: "input_first",
      });

    const conflict = Object.assign(new Error("conflict"), {
      details: { idempotencyKeyReuseConflict: true, status: 409 },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(conflict);
    await expect(personalizedShare()).resolves.toEqual({
      status: "already_shared",
    });

    // A canonical reservation key does not identify this accepted request.
    const canonicalPrisma = createContactCardSharePrismaStub();
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(conflict);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_456",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: canonicalPrisma.client as never,
    })).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: conflict,
    });

    const otherFailure = Object.assign(new Error("boom"), {
      details: { status: 409 },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(otherFailure);
    await expect(personalizedShare()).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: otherFailure,
    });
  });

  it("places the pre-send deadline so the send and its reconciliation still fit", () => {
    // Not a claim about the caller's own window — the route boundary owns that
    // and proves it. This pins the derivation: reaching the pre-send deadline
    // is the admission check, so whatever is left must cover both attempts.
    const { operationDeadlineAt, preSendDeadlineAt } =
      resolveHostedLinqPersonalizedContactCardDeadlines(0);

    expect(operationDeadlineAt).toBe(
      HOSTED_LINQ_PERSONALIZED_CONTACT_CARD_OPERATION_BUDGET_MS,
    );
    expect(operationDeadlineAt - preSendDeadlineAt).toBe(2 * SEND_ATTEMPT_BUDGET_MS);
  });

  it("reports an unresolved acknowledgement as unconfirmed only per request", async () => {
    const prisma = createContactCardSharePrismaStub();
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "aGVsbG8=",
      type: "JPEG",
    });
    const personalizedShare = () =>
      shareMurphHostedLinqContactCardVcfToChat({
        chatId: "chat_123",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl,
        memberId: "member_123",
        prisma: prisma.client as never,
        shareKey: "input_first",
      });

    const unconfirmed = Object.assign(new Error("acknowledgement unconfirmed"), {
      details: { acknowledgementUnconfirmed: true },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(unconfirmed);
    await expect(personalizedShare()).resolves.toEqual({ status: "unconfirmed" });

    const canonicalPrisma = createContactCardSharePrismaStub();
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValueOnce(unconfirmed);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_456",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: canonicalPrisma.client as never,
    })).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: unconfirmed,
    });

    // Nothing was proven undelivered, so the canonical reservation stays.
    expect(canonicalPrisma.rows[0]?.lastContactCardShareAttemptedAt)
      .not.toBeNull();
  });

  it("rejects a partial personalized composer input before provider work", async () => {
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl:
        "https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/avatar.jpg",
      memberId: "member_123",
      prisma: createContactCardSharePrismaStub().client as never,
    } as never)).rejects.toThrow(/imageUrl and shareKey must be provided together/u);

    expect(shareSendMocks.getHostedLinqChatHandles).not.toHaveBeenCalled();
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("refuses a personalized card when the current Murph line is stale or ambiguous", async () => {
    const prisma = createContactCardSharePrismaStub();
    const imageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "aGVsbG8=",
      type: "JPEG",
    });
    const share = () =>
      shareMurphHostedLinqContactCardVcfToChat({
        chatId: "chat_123",
        idempotencyKeyPrefix: "personalized-contact-card",
        imageUrl,
        memberId: "member_123",
        prisma: prisma.client as never,
        shareKey: "input_first",
      });

    // Only an inactive self handle: the card would carry a dead line.
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValueOnce([
      { handle: "+15556660000", isMe: true, status: "inactive" },
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);
    await expect(share()).resolves.toEqual({
      status: "skipped",
      reason: "line_unresolved",
    });

    // Two active self handles: which one is current is unprovable here.
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValueOnce([
      { handle: "+15556660000", isMe: true, status: "active" },
      { handle: "+15557770000", isMe: true, status: "active" },
    ]);
    await expect(share()).resolves.toEqual({
      status: "skipped",
      reason: "line_unresolved",
    });

    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("skips as provider_unavailable when the roster is empty or unreadable", async () => {
    const prisma = createContactCardSharePrismaStub();

    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([]);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "provider_unavailable" });

    shareSendMocks.getHostedLinqChatHandles.mockRejectedValue(new Error("provider down"));
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "provider_unavailable" });

    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("skips as line_unresolved without reserving when no own handle is present", async () => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "line_unresolved" });

    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("reports already_shared inside the 90-second throttle without sending again", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "sent" });
    expect(prisma.rows).toEqual([
      expect.objectContaining({
        lastContactCardShareAttemptedAt: now,
        memberId: "member_123",
      }),
    ]);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now: new Date("2026-07-24T12:00:45.000Z"),
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "already_shared" });

    expect(shareSendMocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation for an ambiguous message-send failure", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const error = new Error("send maybe delivered");
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValue(error);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "failed", reason: "send_failed", error });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toEqual(now);
  });

  it("releases the reservation when the failure provably happened before the send", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const prepareFailure = Object.assign(new Error("upload failed"), {
      details: { phase: "prepare" },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValue(prepareFailure);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: prepareFailure,
    });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toBeNull();
  });
});

type ContactCardShareRow = {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
  memberId: string;
};

type FindManyArgs = {
  where: {
    linqChatLookupKey: {
      in: readonly string[];
    };
  };
};

type UpdateManyArgs = {
  data: {
    lastContactCardShareAttemptedAt?: Date | null;
    memberId?: string;
  };
  where: {
    lastContactCardShareAttemptedAt?: Date;
    linqChatLookupKey?: string;
    memberId?: string;
    OR?: readonly [
      { lastContactCardShareAttemptedAt: null },
      { lastContactCardShareAttemptedAt: { lte: Date } },
    ];
  };
};

function createContactCardSharePrismaStub() {
  const rows: ContactCardShareRow[] = [];
  const model = {
    findMany: vi.fn(async (args: FindManyArgs) =>
      rows
        .filter((row) =>
          args.where.linqChatLookupKey.in.includes(row.linqChatLookupKey)
        )
        .map((row) => ({
          lastContactCardShareAttemptedAt: row.lastContactCardShareAttemptedAt,
          linqChatLookupKey: row.linqChatLookupKey,
        }))),
    create: vi.fn(async (args: {
      data: {
        lastContactCardShareAttemptedAt: Date;
        linqChatLookupKey: string;
        memberId: string;
      };
    }) => {
      const row: ContactCardShareRow = { ...args.data };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async (args: UpdateManyArgs) => {
      let count = 0;
      for (const row of rows) {
        if (!rowMatchesUpdate(row, args.where)) {
          continue;
        }
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    }),
  };

  return {
    client: {
      hostedLinqContactCardShare: model,
    },
    model,
    rows,
  };
}

function rowMatchesUpdate(
  row: ContactCardShareRow,
  where: UpdateManyArgs["where"],
): boolean {
  if (where.linqChatLookupKey && row.linqChatLookupKey !== where.linqChatLookupKey) {
    return false;
  }
  if (where.memberId && row.memberId !== where.memberId) {
    return false;
  }
  if (
    where.lastContactCardShareAttemptedAt
    && row.lastContactCardShareAttemptedAt?.getTime()
      !== where.lastContactCardShareAttemptedAt.getTime()
  ) {
    return false;
  }
  if (!where.OR) {
    return true;
  }
  const [, stale] = where.OR;
  return row.lastContactCardShareAttemptedAt === null
    || (
      row.lastContactCardShareAttemptedAt !== null
      && row.lastContactCardShareAttemptedAt <= stale.lastContactCardShareAttemptedAt.lte
    );
}
