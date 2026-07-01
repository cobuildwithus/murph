import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createHostedLinqChat: vi.fn(),
  createHostedLinqChatLookupKey: vi.fn(),
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: vi.fn(),
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  ensureHostedMemberForPhoneTx: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  lookupHostedMemberRoutingByPendingLinqChatId: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedLinqAssignableHomeLineByPhone: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  sendHostedLinqVoiceMemo: vi.fn(),
  syncHostedLinqConfiguredLinesTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  readHostedLinqAssignableHomeLineByPhone: mocks.readHostedLinqAssignableHomeLineByPhone,
  syncHostedLinqConfiguredLinesTx: mocks.syncHostedLinqConfiguredLinesTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx:
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince:
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone:
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  lookupHostedMemberRoutingByHomeLinqChatId: mocks.lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqChatId: mocks.lookupHostedMemberRoutingByPendingLinqChatId,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqRecipientPhoneTx: mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberPendingLinqBindingTx: mocks.upsertHostedMemberPendingLinqBindingTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPhoneTx: mocks.ensureHostedMemberForPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
}));

type ServiceModule = typeof import("../src/lib/hosted-ops/onboarding-invites");
type RouteModule = typeof import("../app/api/ops/onboarding-invites/route");

let service: ServiceModule;
let route: RouteModule;
type MockedTx = {
  hostedMemberRouting: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  transaction: true;
};
type MockedPrisma = {
  $transaction: ReturnType<typeof vi.fn>;
  hostedInvite: {
    updateMany: ReturnType<typeof vi.fn>;
  };
};

let prisma: MockedPrisma;
let tx: MockedTx;
let routingState: {
  linqChatId: string | null;
  linqHomeLineAssignedAt: Date | null;
  linqRecipientPhone: string | null;
  pendingLinqChatId: string | null;
  pendingLinqParticipantContact: null;
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: null;
} | null;

describe("hosted ops onboarding invites", () => {
  beforeAll(async () => {
    service = await import("../src/lib/hosted-ops/onboarding-invites");
    route = await import("../app/api/ops/onboarding-invites/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    routingState = null;
    tx = {
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: null,
          linqRecipientPhoneLookupKey: null,
          pendingLinqChatLookupKey: null,
        }),
      },
      transaction: true,
    };
    prisma = {
      $transaction: vi.fn(async (callback: (transaction: MockedTx) => Promise<unknown>) =>
        callback(tx),
      ),
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedLinqChatLookupKey.mockImplementation((chatId: string | null | undefined) =>
      chatId ? `lookup:${chatId}` : null
    );
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: null,
    });
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(
      buildHomeLine("+15557654321"),
    );
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.ensureHostedMemberForPhoneTx.mockResolvedValue({ id: "member_123" });
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        id: "member_123",
      },
      identity: {
        memberId: "member_123",
      },
      matchedBy: "phoneNumber",
    });
    mocks.issueHostedInviteTx.mockResolvedValue(inviteRow({ sentAt: null }));
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      routing: {
        memberId: "member_123",
      },
    });
    mocks.lookupHostedMemberRoutingByPendingLinqChatId.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockImplementation(async () => routingState);
    mocks.sendHostedLinqChatMessage.mockResolvedValue(undefined);
    mocks.createHostedLinqChat.mockResolvedValue({
      chatId: "chat_created",
      messageId: "message_open",
    });
    mocks.syncHostedLinqConfiguredLinesTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockImplementation(
      async (input: { homeLineAssignedAt?: Date; recipientPhone: string }) => {
        routingState = {
          linqChatId: null,
          linqHomeLineAssignedAt: input.homeLineAssignedAt ?? null,
          linqRecipientPhone: input.recipientPhone,
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId: null,
        };
      },
    );
    mocks.upsertHostedMemberPendingLinqBindingTx.mockImplementation(
      async (input: { linqChatId: string; recipientPhone: string | null }) => {
        routingState = {
          ...(routingState ?? {
            linqChatId: null,
            linqHomeLineAssignedAt: null,
            linqRecipientPhone: null,
            pendingLinqParticipantContact: null,
            telegramThreadId: null,
          }),
          pendingLinqChatId: input.linqChatId,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: input.recipientPhone,
        };
      },
    );
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

    expect(mocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_existing",
      prisma: tx,
    });
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma: tx,
    });
    expect(
      mocks.lookupHostedMemberRoutingByHomeLinqChatId.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.issueHostedInviteTx.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      mocks.lookupHostedMemberIdentityByPhoneNumber.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.issueHostedInviteTx.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
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
      prisma: tx,
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
      code: "HOSTED_OPS_ONBOARDING_RECIPIENT_PHONE_NOT_BOUND",
    });

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma: tx,
    });
    expect(mocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.updateMany).not.toHaveBeenCalled();
  });

  it("rejects existing-chat sends without creating a member when the recipient phone has no identity", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "existing_chat",
      linqChatId: "chat_existing",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-missing-phone-identity",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_RECIPIENT_PHONE_NOT_BOUND",
    });

    expect(mocks.ensureHostedMemberForPhoneTx).not.toHaveBeenCalled();
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledWith({
      prisma: tx,
    });
    expect(mocks.readHostedLinqAssignableHomeLineByPhone).toHaveBeenCalledWith({
      phoneNumber: "+15557654321",
      prisma: tx,
    });
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledWith({
      now: expect.any(Date),
      prisma: tx,
      recipientPhones: ["+15557654321"],
    });
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledWith({
      prisma: tx,
      recipientPhones: ["+15557654321"],
      since: expect.any(Date),
    });
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledTimes(1);
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledTimes(1);
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: tx,
      recipientPhone: "+15557654321",
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
      mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.createHostedLinqChat.mock.invocationCallOrder[0],
    );
    expect(
      mocks.createHostedLinqChat.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.upsertHostedMemberPendingLinqBindingTx.mock.invocationCallOrder[0],
    );
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

  it("does not hold the assignment transaction open while creating a Linq chat", async () => {
    const events: string[] = [];
    prisma.$transaction
      .mockImplementationOnce(async (callback: (transaction: MockedTx) => Promise<unknown>) => {
        events.push("owner:start");
        const result = await callback(tx);
        events.push("owner:commit");
        return result;
      })
      .mockImplementationOnce(async (callback: (transaction: MockedTx) => Promise<unknown>) => {
        events.push("binding:start");
        const result = await callback(tx);
        events.push("binding:commit");
        return result;
      });
    mocks.createHostedLinqChat.mockImplementationOnce(async () => {
      events.push("provider:create");
      return {
        chatId: "chat_created",
        messageId: "message_open",
      };
    });

    await service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-provider-outside-tx",
    });

    expect(events).toEqual([
      "owner:start",
      "owner:commit",
      "provider:create",
      "binding:start",
      "binding:commit",
    ]);
  });

  it("rejects a new chat sender that is not a configured hosted Linq conversation phone", async () => {
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(null);

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-unauthorized-from",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledWith({
      prisma: tx,
    });
    expect(mocks.readHostedLinqAssignableHomeLineByPhone).toHaveBeenCalledWith({
      phoneNumber: "+15557654321",
      prisma: tx,
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
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("rejects a new chat sender that has exhausted its daily new-conversation cap", async () => {
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(
      buildHomeLine("+15557654321", {
        maxNewConversationsPerDay: 1,
      }),
    );
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([["+15557654321", 1]]),
    );

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-cap-exhausted",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_CAPACITY_EXHAUSTED",
      httpStatus: 429,
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
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("rejects a new chat sender whose active line capacity is consumed by a reservation", async () => {
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(
      buildHomeLine("+15557654321", {
        activeMemberLimit: 1,
      }),
    );
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([["+15557654321", 1]]),
    );

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-active-cap-reserved",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_CAPACITY_EXHAUSTED",
      httpStatus: 429,
    });

    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledWith({
      now: expect.any(Date),
      prisma: tx,
      recipientPhones: ["+15557654321"],
    });
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledWith({
      prisma: tx,
      recipientPhones: ["+15557654321"],
      since: expect.any(Date),
    });
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("does not reuse an uncounted home-line reservation after the daily cap is exhausted", async () => {
    routingState = {
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhone: "+15557654321",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
    };
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(
      buildHomeLine("+15557654321", {
        maxNewConversationsPerDay: 1,
      }),
    );
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([["+15557654321", 1]]),
    );

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-uncounted-reservation",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_CAPACITY_EXHAUSTED",
      httpStatus: 429,
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledWith({
      prisma: tx,
      recipientPhones: ["+15557654321"],
      since: expect.any(Date),
    });
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
  });

  it("rejects new-chat sends for members that already have a home Linq chat", async () => {
    tx.hostedMemberRouting.findUnique.mockResolvedValue({
      linqChatLookupKey: "lookup:existing-home-chat",
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-member-home-bound",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_MEMBER_ALREADY_HOME_CHAT_BOUND",
      httpStatus: 409,
    });

    expect(tx.hostedMemberRouting.findUnique).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      select: {
        linqChatLookupKey: true,
        pendingLinqChatLookupKey: true,
      },
    });
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
  });

  it("rejects new-chat sends for members that already have a pending Linq chat", async () => {
    tx.hostedMemberRouting.findUnique.mockResolvedValue({
      linqChatLookupKey: null,
      linqRecipientPhoneLookupKey: "+lookup:reserved",
      pendingLinqChatLookupKey: "lookup:pending-chat",
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-member-pending-bound",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_MEMBER_ALREADY_HOME_CHAT_BOUND",
      httpStatus: 409,
    });

    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
  });

  it("does not write pending route state when Linq chat creation fails", async () => {
    mocks.createHostedLinqChat.mockResolvedValueOnce({
      chatId: null,
      messageId: null,
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-create-missing-chat",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_CHAT_CREATE_FAILED",
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: tx,
      recipientPhone: "+15557654321",
    });
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the open-chat idempotency key stable across overlapping requests for the same reservation", async () => {
    mocks.createHostedLinqChat
      .mockResolvedValueOnce({
        chatId: null,
        messageId: null,
      })
      .mockResolvedValueOnce({
        chatId: "chat_created_retry",
        messageId: "message_open_retry",
      });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-create-missing-chat-a",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_CHAT_CREATE_FAILED",
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-create-missing-chat-b",
    })).resolves.toMatchObject({
      chatId: "chat_created_retry",
      deliveryMode: "new_chat",
      newChatCreated: true,
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(readIdempotencyKey(mocks.createHostedLinqChat, 1)).toBe(
      readIdempotencyKey(mocks.createHostedLinqChat, 0),
    );
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledTimes(1);
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledTimes(2);
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a bare new-chat reservation after its sender line is disabled", async () => {
    routingState = {
      linqChatId: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqRecipientPhone: "+15557654321",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
    };
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(null);

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-disabled-bare-reservation",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
    });

    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
  });

  it("does not reuse a previous-day bare new-chat reservation after the daily cap is exhausted", async () => {
    routingState = {
      linqChatId: null,
      linqHomeLineAssignedAt: new Date("2026-03-25T12:00:00.000Z"),
      linqRecipientPhone: "+15557654321",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
    };
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(
      buildHomeLine("+15557654321", {
        maxNewConversationsPerDay: 1,
      }),
    );
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([["+15557654321", 1]]),
    );

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-previous-day-bare-reservation",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_CAPACITY_EXHAUSTED",
      httpStatus: 429,
    });

    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalled();
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
  });

  it("can replace a failed bare new-chat reservation with a different sender line", async () => {
    routingState = {
      linqChatId: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqRecipientPhone: "+15550000000",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
    };
    tx.hostedMemberRouting.findUnique.mockResolvedValue({
      linqChatLookupKey: null,
      linqRecipientPhoneLookupKey: "+lookup:old-reservation",
      pendingLinqChatLookupKey: null,
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-replace-bare-reservation",
    })).resolves.toMatchObject({
      chatId: "chat_created",
      deliveryMode: "new_chat",
      newChatCreated: true,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      homeLineAssignedAt: expect.any(Date),
      memberId: "member_123",
      prisma: tx,
      recipientPhone: "+15557654321",
    });
    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
  });

  it("does not runtime-sync env-configured Linq lines during new-chat assignment", async () => {
    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(null);
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15557654321"],
      linqMaxActiveMembersPerConversationPhone: 250,
    });

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-cutover-sync",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
    });

    expect(mocks.syncHostedLinqConfiguredLinesTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma: tx,
    });
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
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

    routingState = null;
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

  it("reuses an existing pending Linq chat when retrying a new-chat invite send", async () => {
    mocks.sendHostedLinqChatMessage
      .mockRejectedValueOnce(new Error("provider timed out after sending invite"))
      .mockResolvedValueOnce(undefined);

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-pending-chat",
    })).rejects.toThrow("provider timed out after sending invite");

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-pending-chat",
    })).resolves.toMatchObject({
      chatId: "chat_created",
      deliveryMode: "new_chat",
      newChatCreated: false,
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(readIdempotencyKey(mocks.sendHostedLinqChatMessage, 1)).toBe(
      readIdempotencyKey(mocks.sendHostedLinqChatMessage, 0),
    );
  });

  it("does not reuse an existing pending Linq chat after its sender line is disabled", async () => {
    mocks.sendHostedLinqChatMessage
      .mockRejectedValueOnce(new Error("provider timed out after sending invite"));

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-disabled-pending-chat",
    })).rejects.toThrow("provider timed out after sending invite");

    mocks.readHostedLinqAssignableHomeLineByPhone.mockResolvedValue(null);

    await expect(service.sendHostedOpsOnboardingInvite({
      deliveryMode: "new_chat",
      linqFromPhoneNumber: "+15557654321",
      recipientPhoneNumber: "+15551234567",
      requestId: "request-retry-disabled-pending-chat",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
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
    expect(result.voiceMemo).toEqual({
      error: null,
      requested: true,
      sent: true,
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
    expect(mocks.sendHostedLinqVoiceMemo).not.toHaveBeenCalled();
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

  it("rejects declared oversized onboarding invite forms before parsing multipart data", async () => {
    const response = await route.POST(new Request("https://app.example.test/api/ops/onboarding-invites", {
      body: "",
      headers: {
        "content-length": String(oversizedOpsOnboardingFormBodyLength()),
        "content-type": "multipart/form-data; boundary=oversized",
      },
      method: "POST",
    }));
    const payload = await response.json() as { error?: { code?: string } };

    expect(response.status).toBe(413);
    expect(payload.error?.code).toBe("HOSTED_OPS_ONBOARDING_FORM_TOO_LARGE");
    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("rejects streamed oversized onboarding invite forms before parsing multipart data", async () => {
    const response = await route.POST(new Request("https://app.example.test/api/ops/onboarding-invites", {
      body: createBodyStream(oversizedOpsOnboardingFormBodyLength()),
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

function buildHomeLine(
  phoneNumber: string,
  overrides: Partial<{
    activeMemberLimit: number | null;
    assignmentWeight: number;
    maxNewConversationsPerDay: number | null;
  }> = {},
) {
  return {
    activeMemberLimit: overrides.activeMemberLimit ?? null,
    assignmentWeight: overrides.assignmentWeight ?? 100,
    maxNewConversationsPerDay: overrides.maxNewConversationsPerDay ?? null,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey: `lookup:${phoneNumber}`,
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

function oversizedOpsOnboardingFormBodyLength(): number {
  return service.HOSTED_OPS_ONBOARDING_VOICE_MEMO_MAX_BYTES
    + (256 * 1024)
    + 1;
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
