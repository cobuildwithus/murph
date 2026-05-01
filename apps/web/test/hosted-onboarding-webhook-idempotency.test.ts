import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimHostedLinqOnboardingLinkNotice: vi.fn(),
  claimHostedLinqQuotaReplyNotice: vi.fn(),
  ensureHostedMemberForPhoneTx: vi.fn(),
  getPrisma: vi.fn(),
  incrementHostedLinqInboundDailyState: vi.fn(),
  incrementHostedLinqOutboundDailyState: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  nudgeHostedRunnerUserBestEffort: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) => `https://join.example.test/join/${inviteCode}`),
  issueHostedInviteTx: mocks.issueHostedInviteTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  ensureHostedMemberForPhoneTx: mocks.ensureHostedMemberForPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx: mocks.upsertHostedMemberPendingLinqBindingTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    buildHostedInviteReply: vi.fn(({ joinUrl }: { joinUrl: string }) => `invite:${joinUrl}`),
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
    verifyAndParseHostedLinqWebhookRequest: mocks.verifyAndParseHostedLinqWebhookRequest,
  };
});

import { buildHostedInviteReply } from "@/src/lib/hosted-onboarding/linq";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

describe("hosted onboarding Linq webhook hard-cut flows", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const linq = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
      "@/src/lib/hosted-onboarding/linq",
    );
    mocks.verifyAndParseHostedLinqWebhookRequest.mockImplementation((input: { rawBody: string }) =>
      linq.parseHostedLinqWebhookEvent(input.rawBody),
    );
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue({
      dayUtc: new Date("2026-03-26T00:00:00.000Z"),
      inboundCount: 1,
      memberId: "member_123",
      onboardingLinkSentAt: null,
      outboundCount: 0,
      quotaReplySentAt: null,
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(undefined);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({ eventId: "evt_123" });
    mocks.sendHostedLinqChatMessage.mockResolvedValue(undefined);
    mocks.nudgeHostedRunnerUserBestEffort.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.upsertHostedMemberHomeLinqBindingTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberPendingLinqBindingTx.mockResolvedValue(undefined);
  });

  it("ignores non-message Linq webhooks without direct sends or wake handoff", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody({
          eventType: "message.delivered",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "message.delivered",
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });

  it("sends the signup link directly for an inactive member and finalizes without receipt state", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: null,
    });
    mocks.ensureHostedMemberForPhoneTx.mockResolvedValue({
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      suspendedAt: null,
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_first_contact",
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody({
          service: "iMessage",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      inviteCode: "code_first_contact",
      joinUrl: "https://join.example.test/join/code_first_contact",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma,
    });
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_123",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: "linq-message:evt_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_first_contact",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      data: {
        sentAt: expect.any(Date),
      },
      where: {
        id: "invite_123",
      },
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
  });

  it("appends and hands off the active-member wake without any direct Linq send", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      id: "member_123",
      routing: {
        linqChatId: "chat_123",
        linqRecipientPhone: "+15550000000",
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_123",
      memberId: "member_123",
      prisma,
      recipientPhone: "+15550000000",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      tx: prisma,
      envelope: expect.objectContaining({
        eventId: "evt_123",
        kind: "conversation.message",
        occurredAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
        message: expect.objectContaining({
          channel: "linq",
          linqMessage: expect.objectContaining({
            messageId: "msg_123",
          }),
        }),
      }),
    });
    expect(mocks.nudgeHostedRunnerUserBestEffort).toHaveBeenCalledWith({
      context: "webhook:linq",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(response).not.toHaveProperty("wakeUserId");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });
});

function buildLinqMessageWebhookBody(input: {
  eventType?: string;
  from?: string;
  isFromMe?: boolean;
  service?: string;
  text?: string;
} = {}): string {
  const service = input.service ?? "sms";

  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_123",
          is_me: true,
          service,
        },
      },
      direction: input.isFromMe ? "outbound" : "inbound",
      id: "msg_123",
      parts: [
        {
          type: "text",
          value: input.text ?? "hello",
        },
      ],
      sender_handle: {
        handle: input.from ?? "+15551234567",
        id: "handle_sender_123",
        service,
      },
      sent_at: "2026-03-26T12:00:00.000Z",
      service,
    },
    event_id: "evt_123",
    event_type: input.eventType ?? "message.received",
  });
}

function createPrismaStub() {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    hostedInvite: {
      findUnique: vi.fn().mockResolvedValue({
        inviteCode: "code_first_contact",
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
  } as const;

  return prisma;
}
