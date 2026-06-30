import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createHostedLinqChat: vi.fn(),
  createHostedLinqChatLookupKey: vi.fn(),
  ensureHostedMemberForPhoneTx: vi.fn(),
  getPrisma: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  lookupHostedMemberRoutingByPendingLinqChatId: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  sendHostedLinqVoiceMemo: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
  uploadHostedLinqAttachment: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedLinqChatLookupKey: mocks.createHostedLinqChatLookupKey,
  readHostedPhoneHint: vi.fn((phoneNumber: string | null | undefined) => {
    if (!phoneNumber) {
      return null;
    }
    return `*** ${phoneNumber.slice(-4)}`;
  }),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) => `https://join.example.test/${inviteCode}`),
  issueHostedInviteTx: mocks.issueHostedInviteTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  createHostedLinqChat: mocks.createHostedLinqChat,
  sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  sendHostedLinqVoiceMemo: mocks.sendHostedLinqVoiceMemo,
  uploadHostedLinqAttachment: mocks.uploadHostedLinqAttachment,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByHomeLinqChatId: mocks.lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqChatId: mocks.lookupHostedMemberRoutingByPendingLinqChatId,
  upsertHostedMemberPendingLinqBindingTx: mocks.upsertHostedMemberPendingLinqBindingTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPhoneTx: mocks.ensureHostedMemberForPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
}));

type ServiceModule = typeof import("../src/lib/hosted-ops/onboarding-invites");
type RouteModule = typeof import("../app/api/ops/onboarding-invites/route");

let service: ServiceModule;
let route: RouteModule;
let prisma: {
  $transaction: ReturnType<typeof vi.fn>;
  hostedInvite: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  hostedOpsOnboardingVoiceMemoSend: {
    createMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};
const tx = { transaction: true };

describe("hosted ops onboarding invites", () => {
  beforeAll(async () => {
    service = await import("../src/lib/hosted-ops/onboarding-invites");
    route = await import("../app/api/ops/onboarding-invites/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedOpsOnboardingVoiceMemoSend: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: "voice_claim_123" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedLinqChatLookupKey.mockImplementation((chatId: string | null | undefined) =>
      chatId ? `lookup:${chatId}` : null
    );
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15557654321"],
    });
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.ensureHostedMemberForPhoneTx.mockResolvedValue({ id: "member_123" });
    mocks.issueHostedInviteTx.mockResolvedValue(inviteRow({ sentAt: null }));
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      routing: {
        memberId: "member_123",
      },
    });
    mocks.lookupHostedMemberRoutingByPendingLinqChatId.mockResolvedValue(null);
    mocks.sendHostedLinqChatMessage.mockResolvedValue(undefined);
    mocks.createHostedLinqChat.mockResolvedValue({
      chatId: "chat_created",
      messageId: "message_open",
    });
    mocks.upsertHostedMemberPendingLinqBindingTx.mockResolvedValue(undefined);
    mocks.uploadHostedLinqAttachment.mockResolvedValue({ attachmentId: "attachment_123" });
    mocks.sendHostedLinqVoiceMemo.mockResolvedValue(undefined);
  });

  it("sends an invite link to an existing Linq chat and returns masked phone hints", async () => {
    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-123",
    });

    expect(mocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma: tx,
    });
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_existing",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_existing",
      idempotencyKey: expect.stringMatching(
        /^ops-onboarding-invite:invite:[a-f0-9]{64}$/u,
      ),
      message: "Murph setup link:\nhttps://join.example.test/invite_code\n\nReply here when you are in.",
    });
    const idempotencyKey = readIdempotencyKey(mocks.sendHostedLinqChatMessage);
    expect(idempotencyKey).not.toContain("chat_existing");
    expect(idempotencyKey).not.toContain("+15551234567");
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.updateMany).toHaveBeenCalledWith({
      data: {
        sentAt: expect.any(Date),
      },
      where: {
        id: "invite_123",
        sentAt: null,
      },
    });
    expect(result).toMatchObject({
      chatId: "chat_existing",
      deliveryMode: "existing_chat",
      inviteId: "invite_123",
      memberId: "member_123",
      newChatCreated: false,
      recipientPhoneHint: "*** 4567",
      textMessageSent: true,
      voiceMemo: {
        requested: false,
        sent: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("+15551234567");
  });

  it("allows existing-chat sends through a pending Linq chat route for the same member", async () => {
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue(null);
    mocks.lookupHostedMemberRoutingByPendingLinqChatId.mockResolvedValue({
      routing: {
        memberId: "member_123",
      },
    });

    await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_pending",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-pending",
    });

    expect(mocks.lookupHostedMemberRoutingByPendingLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_pending",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_pending",
    }));
  });

  it("rejects existing-chat sends when the Linq route is not bound to the recipient member", async () => {
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      routing: {
        memberId: "member_other",
      },
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-wrong-route",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_LINQ_CHAT_NOT_BOUND",
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.updateMany).not.toHaveBeenCalled();
  });

  it("creates a new Linq chat with a non-link opener before sending the invite link", async () => {
    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      newChatOpeningMessage: "Hey, I am sending the Murph setup link next.",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-456",
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledWith({
      from: "+15557654321",
      idempotencyKey: expect.stringMatching(
        /^ops-onboarding-invite:open:[a-f0-9]{64}$/u,
      ),
      message: "Hey, I am sending the Murph setup link next.",
      to: ["+15551234567"],
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith({
      chatId: "chat_created",
      idempotencyKey: expect.stringMatching(
        /^ops-onboarding-invite:invite:[a-f0-9]{64}$/u,
      ),
      message: "Murph setup link:\nhttps://join.example.test/invite_code\n\nReply here when you are in.",
    });
    const openIdempotencyKey = readIdempotencyKey(mocks.createHostedLinqChat);
    const inviteIdempotencyKey = readIdempotencyKey(mocks.sendHostedLinqChatMessage);
    expect(openIdempotencyKey).not.toContain("+15557654321");
    expect(openIdempotencyKey).not.toContain("+15551234567");
    expect(inviteIdempotencyKey).not.toContain("chat_created");
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledWith({
      linqChatId: "chat_created",
      memberId: "member_123",
      prisma: tx,
      recipientPhone: "+15557654321",
    });
    expect(
      mocks.upsertHostedMemberPendingLinqBindingTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      chatId: "chat_created",
      deliveryMode: "new_chat",
      linqFromPhoneHint: "*** 4321",
      newChatCreated: true,
      openerMessageId: "message_open",
      recipientPhoneHint: "*** 4567",
    });
    expect(JSON.stringify(result)).not.toContain("+15557654321");
  });

  it("rejects a new chat sender that is not a configured hosted Linq conversation phone", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15550000000"],
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-unauthorized-from",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
    });

    expect(mocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("rejects a new chat opener that includes a URL before issuing an invite", async () => {
    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      newChatOpeningMessage: "Go to https://example.test first",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-789",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_NEW_CHAT_OPENER_HAS_LINK",
    });

    expect(mocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("changes the new-chat opener idempotency key when a failed retry targets a different recipient", async () => {
    mocks.createHostedLinqChat
      .mockRejectedValueOnce(new Error("provider timed out after creating chat"))
      .mockResolvedValueOnce({
        chatId: "chat_created_b",
        messageId: "message_open_b",
      });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-open",
    })).rejects.toThrow("provider timed out after creating chat");

    await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15559876543",
      requestId: "request-retry-open",
    });

    const firstKey = readIdempotencyKey(mocks.createHostedLinqChat, 0);
    const secondKey = readIdempotencyKey(mocks.createHostedLinqChat, 1);

    expect(firstKey).toMatch(/^ops-onboarding-invite:open:[a-f0-9]{64}$/u);
    expect(secondKey).toMatch(/^ops-onboarding-invite:open:[a-f0-9]{64}$/u);
    expect(secondKey).not.toBe(firstKey);
    expect(firstKey).not.toContain("+15551234567");
    expect(secondKey).not.toContain("+15559876543");
  });

  it("changes the invite text idempotency key when a post-send failed retry targets a different chat", async () => {
    prisma.hostedInvite.updateMany.mockRejectedValueOnce(new Error("database went away"));

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-invite",
    })).rejects.toThrow("database went away");

    await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_other",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-invite",
    });

    const firstKey = readIdempotencyKey(mocks.sendHostedLinqChatMessage, 0);
    const secondKey = readIdempotencyKey(mocks.sendHostedLinqChatMessage, 1);

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenNthCalledWith(2, {
      chatId: "chat_other",
      idempotencyKey: expect.stringMatching(
        /^ops-onboarding-invite:invite:[a-f0-9]{64}$/u,
      ),
      message: "Murph setup link:\nhttps://join.example.test/invite_code\n\nReply here when you are in.",
    });
    expect(secondKey).not.toBe(firstKey);
    expect(firstKey).not.toContain("chat_existing");
    expect(secondKey).not.toContain("chat_other");
  });

  it("sends an optional voice memo after the setup link is sent", async () => {
    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice",
      voiceMemo: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/x-m4a",
        extension: "m4a",
        sizeBytes: 3,
      },
    });

    expect(prisma.hostedOpsOnboardingVoiceMemoSend.createMany).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        linqChatLookupKey: "lookup:chat_existing",
        memberId: "member_123",
        requestId: "request-voice",
      },
      skipDuplicates: true,
    });
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    });
    expect(mocks.sendHostedLinqVoiceMemo).toHaveBeenCalledWith({
      attachmentId: "attachment_123",
      chatId: "chat_existing",
    });
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.update).toHaveBeenCalledWith({
      data: {
        failedAt: null,
        sentAt: expect.any(Date),
      },
      where: {
        id: expect.any(String),
      },
    });
    expect(result.voiceMemo).toEqual({
      error: null,
      requested: true,
      sent: true,
    });
  });

  it("does not resend a native voice memo while the same request id is still in flight", async () => {
    prisma.hostedOpsOnboardingVoiceMemoSend.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.hostedOpsOnboardingVoiceMemoSend.findFirst.mockResolvedValueOnce({
      failedAt: null,
      id: "voice_claim_123",
      sendAttemptedAt: null,
      sentAt: null,
      updatedAt: new Date(),
    });

    const voiceMemo = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a" as const,
      extension: "m4a",
      sizeBytes: 3,
    };

    await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-replay",
      voiceMemo,
    });
    const replay = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-replay",
      voiceMemo,
    });

    expect(prisma.hostedOpsOnboardingVoiceMemoSend.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.findFirst).toHaveBeenCalledWith({
      select: {
        failedAt: true,
        id: true,
        sendAttemptedAt: true,
        sentAt: true,
        updatedAt: true,
      },
      where: {
        linqChatLookupKey: "lookup:chat_existing",
        memberId: "member_123",
        requestId: "request-voice-replay",
      },
    });
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqVoiceMemo).toHaveBeenCalledTimes(1);
    expect(replay.voiceMemo).toEqual({
      error: "Voice memo delivery is already pending for this setup link request.",
      requested: true,
      sent: false,
    });
  });

  it("retries a native voice memo after a pre-send upload failure", async () => {
    prisma.hostedOpsOnboardingVoiceMemoSend.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.hostedOpsOnboardingVoiceMemoSend.findFirst.mockResolvedValueOnce({
      failedAt: new Date("2026-06-29T10:00:00.000Z"),
      id: "voice_claim_123",
      sendAttemptedAt: null,
      sentAt: null,
      updatedAt: new Date("2026-06-29T10:00:00.000Z"),
    });
    mocks.uploadHostedLinqAttachment.mockRejectedValueOnce(
      new Error("provider rejected upload"),
    );

    const voiceMemo = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a" as const,
      extension: "m4a",
      sizeBytes: 3,
    };

    const first = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-upload-retry",
      voiceMemo,
    });
    const retry = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-upload-retry",
      voiceMemo,
    });

    expect(first.voiceMemo).toEqual({
      error: "Voice memo delivery failed after the setup link was sent.",
      requested: true,
      sent: false,
    });
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: expect.any(Date),
      },
      where: {
        id: expect.any(String),
        sendAttemptedAt: null,
        sentAt: null,
      },
    });
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: null,
        updatedAt: expect.any(Date),
      },
      where: expect.objectContaining({
        id: "voice_claim_123",
        sendAttemptedAt: null,
        sentAt: null,
      }),
    });
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqVoiceMemo).toHaveBeenCalledTimes(1);
    expect(retry.voiceMemo).toEqual({
      error: null,
      requested: true,
      sent: true,
    });
  });

  it("reclaims stale pre-send voice memo claims without duplicating fresh claims", async () => {
    prisma.hostedOpsOnboardingVoiceMemoSend.createMany.mockResolvedValueOnce({ count: 0 });
    prisma.hostedOpsOnboardingVoiceMemoSend.findFirst.mockResolvedValueOnce({
      failedAt: null,
      id: "voice_claim_stale",
      sendAttemptedAt: null,
      sentAt: null,
      updatedAt: new Date("2026-06-29T10:00:00.000Z"),
    });

    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-stale",
      voiceMemo: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/x-m4a",
        extension: "m4a",
        sizeBytes: 3,
      },
    });

    expect(prisma.hostedOpsOnboardingVoiceMemoSend.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: null,
        updatedAt: expect.any(Date),
      },
      where: expect.objectContaining({
        id: "voice_claim_stale",
        sendAttemptedAt: null,
        sentAt: null,
      }),
    });
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqVoiceMemo).toHaveBeenCalledTimes(1);
    expect(result.voiceMemo).toEqual({
      error: null,
      requested: true,
      sent: true,
    });
  });

  it("does not resend a confirmed native voice memo replay", async () => {
    prisma.hostedOpsOnboardingVoiceMemoSend.createMany.mockResolvedValueOnce({ count: 0 });
    prisma.hostedOpsOnboardingVoiceMemoSend.findFirst.mockResolvedValueOnce({
      failedAt: null,
      id: "voice_claim_sent",
      sendAttemptedAt: new Date("2026-06-29T10:00:00.000Z"),
      sentAt: new Date("2026-06-29T10:00:01.000Z"),
      updatedAt: new Date("2026-06-29T10:00:01.000Z"),
    });

    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-sent",
      voiceMemo: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/x-m4a",
        extension: "m4a",
        sizeBytes: 3,
      },
    });

    expect(mocks.uploadHostedLinqAttachment).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqVoiceMemo).not.toHaveBeenCalled();
    expect(result.voiceMemo).toEqual({
      error: null,
      requested: true,
      sent: true,
    });
  });

  it("does not retry a native voice memo after the provider send boundary was reached", async () => {
    prisma.hostedOpsOnboardingVoiceMemoSend.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.hostedOpsOnboardingVoiceMemoSend.findFirst.mockResolvedValueOnce({
      failedAt: new Date("2026-06-29T10:00:01.000Z"),
      id: "voice_claim_send_attempted",
      sendAttemptedAt: new Date("2026-06-29T10:00:00.000Z"),
      sentAt: null,
      updatedAt: new Date("2026-06-29T10:00:01.000Z"),
    });
    mocks.sendHostedLinqVoiceMemo.mockRejectedValueOnce(
      new Error("provider timed out after send request"),
    );

    const voiceMemo = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a" as const,
      extension: "m4a",
      sizeBytes: 3,
    };

    const first = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-send-attempted",
      voiceMemo,
    });
    const retry = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-send-attempted",
      voiceMemo,
    });

    expect(first.voiceMemo).toEqual({
      error: "Voice memo delivery failed after the setup link was sent.",
      requested: true,
      sent: false,
    });
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: expect.any(Date),
      },
      where: {
        id: expect.any(String),
        sendAttemptedAt: {
          not: null,
        },
        sentAt: null,
      },
    });
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqVoiceMemo).toHaveBeenCalledTimes(1);
    expect(retry.voiceMemo).toEqual({
      error: "Voice memo delivery is already pending for this setup link request.",
      requested: true,
      sent: false,
    });
  });

  it("returns a partial warning when voice delivery fails after the setup link", async () => {
    mocks.uploadHostedLinqAttachment.mockRejectedValue(new Error("provider rejected upload"));

    const result = await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-voice-fail",
      voiceMemo: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/x-m4a",
        extension: "m4a",
        sizeBytes: 3,
      },
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalled();
    expect(prisma.hostedInvite.updateMany).toHaveBeenCalled();
    expect(prisma.hostedOpsOnboardingVoiceMemoSend.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: expect.any(Date),
      },
      where: {
        id: expect.any(String),
        sendAttemptedAt: null,
        sentAt: null,
      },
    });
    expect(result.voiceMemo).toEqual({
      error: "Voice memo delivery failed after the setup link was sent.",
      requested: true,
      sent: false,
    });
  });

  it("normalizes route voice memo files without passing the original filename through", async () => {
    const formData = new FormData();
    formData.set("deliveryMode", "existing_chat");
    formData.set("linqChatId", "chat_existing");
    formData.set("recipientPhoneNumber", "+15551234567");
    formData.set("requestId", "request-route");
    formData.set(
      "voiceMemo",
      new File([new Uint8Array([4, 5])], "local-personal-recording.m4a", {
        type: "audio/mp4",
      }),
    );

    const response = await route.POST(new Request("https://app.example.test/api/ops/onboarding-invites", {
      body: formData,
      method: "POST",
    }));
    const payload = await response.json() as unknown;

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(
      expect.any(Request),
      { requireMutationOrigin: true },
    );
    expect(mocks.uploadHostedLinqAttachment).toHaveBeenCalledWith({
      bytes: new Uint8Array([4, 5]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("local-personal-recording");
  });

  it("rejects declared oversized voice memo forms before parsing multipart data", async () => {
    const response = await route.POST(new Request("https://app.example.test/api/ops/onboarding-invites", {
      body: "",
      headers: {
        "content-length": String(route.HOSTED_OPS_ONBOARDING_FORM_BODY_MAX_BYTES + 1),
        "content-type": "multipart/form-data; boundary=oversized",
      },
      method: "POST",
    }));
    const payload = await response.json() as { error?: { code?: string } };

    expect(response.status).toBe(413);
    expect(payload.error?.code).toBe("HOSTED_OPS_ONBOARDING_FORM_TOO_LARGE");
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.uploadHostedLinqAttachment).not.toHaveBeenCalled();
  });

  it("rejects streamed oversized voice memo forms before parsing multipart data", async () => {
    const response = await route.POST(new Request("https://app.example.test/api/ops/onboarding-invites", {
      body: createBodyStream(route.HOSTED_OPS_ONBOARDING_FORM_BODY_MAX_BYTES + 1),
      headers: {
        "content-type": "multipart/form-data; boundary=oversized",
      },
      method: "POST",
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    const payload = await response.json() as { error?: { code?: string } };

    expect(response.status).toBe(413);
    expect(payload.error?.code).toBe("HOSTED_OPS_ONBOARDING_FORM_TOO_LARGE");
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.uploadHostedLinqAttachment).not.toHaveBeenCalled();
  });
});

function inviteRow(input: {
  sentAt: Date | null;
}) {
  return {
    channel: "linq",
    createdAt: new Date("2026-06-29T10:00:00.000Z"),
    expiresAt: new Date("2026-06-30T10:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite_code",
    memberId: "member_123",
    sentAt: input.sentAt,
  };
}

function createBodyStream(byteLength: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(byteLength));
      controller.close();
    },
  });
}

function readIdempotencyKey(
  mock: { mock: { calls: Array<Array<unknown>> } },
  callIndex = 0,
): string {
  const input = mock.mock.calls[callIndex]?.[0] as {
    idempotencyKey?: unknown;
  } | undefined;

  if (typeof input?.idempotencyKey !== "string") {
    throw new Error("Expected mocked call to include an idempotency key.");
  }

  return input.idempotencyKey;
}
