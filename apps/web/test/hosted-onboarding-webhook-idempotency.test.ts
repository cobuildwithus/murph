import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: vi.fn(),
  claimHostedLinqOnboardingLinkNotice: vi.fn(),
  claimHostedLinqQuotaReplyNotice: vi.fn(),
  markHostedLinqOnboardingLinkNoticeSent: vi.fn(),
  releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn(),
  releaseHostedLinqQuotaReplyNoticeClaim: vi.fn(),
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  ensureHostedMemberForPhoneTx: vi.fn(),
  getPrisma: vi.fn(),
  incrementHostedLinqInboundDailyState: vi.fn(),
  incrementHostedLinqOutboundDailyState: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  lookupHostedMemberRoutingByPendingLinqParticipantContact: vi.fn(),
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxItemOwnerById: vi.fn(),
  readHostedMemberHomeLinqRoute: vi.fn(),
  readHostedLinqDailyState: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  checkHostedAiUsageGate: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  sendHostedLinqReadReceipt: vi.fn(),
  nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(async (
    input: { context?: string; timeoutMs?: number; userId: string },
  ) => {
    void input;
    return {
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
      usageGateDenied: false,
    };
  }),
  nudgeHostedRunnerUserBestEffort: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffort: mocks.nudgeHostedRunnerUserBestEffort,
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  checkHostedAiUsageGate: mocks.checkHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
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
  lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx:
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince:
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone:
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  lookupHostedMemberRoutingByHomeLinqChatId: mocks.lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqParticipantContact:
    mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact,
  readHostedMemberHomeLinqRoute: mocks.readHostedMemberHomeLinqRoute,
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx: mocks.upsertHostedMemberPendingLinqBindingTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-daily-state")>(
    "@/src/lib/hosted-onboarding/linq-daily-state",
  );

  return {
    ...actual,
    claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
    claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
    markHostedLinqOnboardingLinkNoticeSent: mocks.markHostedLinqOnboardingLinkNoticeSent,
    incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
    incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
    readHostedLinqDailyState: mocks.readHostedLinqDailyState,
    releaseHostedLinqOnboardingLinkNoticeClaim: mocks.releaseHostedLinqOnboardingLinkNoticeClaim,
    releaseHostedLinqQuotaReplyNoticeClaim: mocks.releaseHostedLinqQuotaReplyNoticeClaim,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    buildHostedInviteReply: vi.fn(({ joinUrl }: { joinUrl: string }) => `invite:${joinUrl}`),
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    verifyAndParseHostedLinqWebhookRequest: mocks.verifyAndParseHostedLinqWebhookRequest,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    claimHostedLinqDeliveryProviderDispatchTx: mocks.claimHostedLinqDeliveryProviderDispatchTx,
  };
});

import { buildHostedInviteReply } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
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
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    });
    mocks.markHostedLinqOnboardingLinkNoticeSent.mockResolvedValue(true);
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockResolvedValue(undefined);
    mocks.releaseHostedLinqQuotaReplyNoticeClaim.mockResolvedValue(undefined);
    mocks.readHostedLinqDailyState.mockResolvedValue(null);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
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
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        id: "mailbox_evt_123",
      },
    });
    mocks.readHostedMailboxItemOwnerById.mockResolvedValue({
      id: "mailbox_evt_123",
      userId: "member_123",
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "provider_msg_123",
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.nudgeHostedRunnerUserBestEffort.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockImplementation(async (input) => ({
      ...await mocks.nudgeHostedRunnerUserBestEffortResult(input),
      usageGateDenied: false,
    }));
    mocks.checkHostedAiUsageGate.mockResolvedValue({
      allowed: true,
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 100_000n,
      memberId: "member_123",
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      remainingUsdMicros: 100_000n,
      spentUsdMicros: 0n,
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue(null);
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
      reason: "recorded-linq-provider-event:message.delivered",
    });

    expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_123"),
          eventType: "message.delivered",
        }),
        skipDuplicates: true,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });

  it("records failed Linq message receipts as alerts without product sends or wake handoff", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            error: {
              code: "30007",
              message: "carrier filtered",
            },
            message_id: "msg_failed_123",
            phone_number: "+15550000000",
            service: "sms",
          },
          eventId: "evt_failed_123",
          eventType: "message.failed",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "recorded-linq-provider-event:message.failed",
    });

    expect(prisma.hostedLinqAlert.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_failed_123"),
          kind: "message_failed",
          status: "pending",
        }),
        skipDuplicates: true,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
  });

  it("records Linq line status updates as alerts without product sends or wake handoff", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            phone_number: "+15550000000",
            reason: "carrier review",
            status: "flagged",
          },
          eventId: "evt_status_123",
          eventType: "phone_number.status_updated",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "recorded-linq-provider-event:phone_number.status_updated",
    });

    expect(prisma.hostedLinqLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "unhealthy",
          providerReason: "[redacted]",
          providerStatus: "flagged",
        }),
      }),
    );
    expect(prisma.hostedLinqAlert.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_status_123"),
          kind: "phone_number_status_updated",
          status: "pending",
        }),
        skipDuplicates: true,
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
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
        idempotencyKey: "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z",
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
    expect(mocks.markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markHostedLinqOnboardingLinkNoticeSent.mock.invocationCallOrder[0],
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
  });

  it("uses member/day delivery admission for overlapping first-contact signup link sends", async () => {
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
    mocks.claimHostedLinqDeliveryProviderDispatchTx
      .mockResolvedValueOnce({
        claimed: true,
        id: "hld_first_contact",
      })
      .mockResolvedValueOnce({
        claimed: false,
        id: "hld_first_contact",
      });

    await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        eventId: "evt_first_contact_one",
        messageId: "msg_first_contact_one",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        eventId: "evt_first_contact_two",
        messageId: "msg_first_contact_two",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    const expectedIdempotencyKey = "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledTimes(2);
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: expectedIdempotencyKey,
        linqChatId: "chat_123",
        source: "hosted_webhook_side_effect",
        sourceRef: expectedIdempotencyKey,
        targetKind: "thread",
        template: "invite_signup",
      }),
    );
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: expectedIdempotencyKey,
        linqChatId: "chat_123",
        source: "hosted_webhook_side_effect",
        sourceRef: expectedIdempotencyKey,
        targetKind: "thread",
        template: "invite_signup",
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: expectedIdempotencyKey,
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_first_contact",
        }),
        replyToMessageId: "msg_first_contact_one",
      }),
    );
  });

  it("treats stale generated local crypto identity rows as a first contact miss", async () => {
    const previousHostedCryptoEnv = process.env.HOSTED_CRYPTO_ENV;
    process.env.HOSTED_CRYPTO_ENV = "local";
    try {
      const prisma = createPrismaStub();
      mocks.getPrisma.mockReturnValue(prisma);
      mocks.lookupHostedMemberIdentityByPhoneNumber.mockRejectedValue(
        new Error("Hosted domain root envelope authority signature verification failed."),
      );
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
        ok: true,
        reason: "sent-signup-link",
      });

      expect(mocks.ensureHostedMemberForPhoneTx).toHaveBeenCalledWith({
        phoneNumber: "+15551234567",
        prisma,
      });
    } finally {
      restoreEnvValue("HOSTED_CRYPTO_ENV", previousHostedCryptoEnv);
    }
  });

  it("still fails closed on stale hosted crypto identity rows outside local dev", async () => {
    const previousHostedCryptoEnv = process.env.HOSTED_CRYPTO_ENV;
    process.env.HOSTED_CRYPTO_ENV = "development";
    try {
      const prisma = createPrismaStub();
      mocks.getPrisma.mockReturnValue(prisma);
      mocks.lookupHostedMemberIdentityByPhoneNumber.mockRejectedValue(
        new Error("Hosted domain root envelope authority signature verification failed."),
      );

      await expect(
        handleHostedOnboardingLinqWebhook({
          rawBody: buildLinqMessageWebhookBody({
            service: "iMessage",
          }),
          signature: null,
          timestamp: null,
        }),
      ).rejects.toThrow("Hosted domain root envelope authority signature verification failed.");
    } finally {
      restoreEnvValue("HOSTED_CRYPTO_ENV", previousHostedCryptoEnv);
    }
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
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550000000",
      memberId: "member_123",
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
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
    expect(response).not.toHaveProperty("wakeUserId");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberSnapshot).not.toHaveBeenCalled();
  });

  it("does not let message.received observability failures block the active-member planner", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scheduledTasks: Array<() => Promise<void>> = [];
    const prisma = createPrismaStub();
    prisma.hostedLinqProviderEvent.createMany.mockRejectedValueOnce(
      new Error("provider event insert failed"),
    );
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550000000",
      memberId: "member_123",
    });

    try {
      await expect(handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody(),
        scheduleAfterResponse: (task) => {
          scheduledTasks.push(task);
        },
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-active-member",
      });

      expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        expectedUserId: "member_123",
        mailboxItemId: "mailbox_evt_123",
      });
      expect(prisma.hostedLinqProviderEvent.createMany).not.toHaveBeenCalled();

      await Promise.all(scheduledTasks.map((task) => task()));

      expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "Hosted Linq provider event sidecar ingestion failed.",
        expect.objectContaining({
          errorName: "Error",
          eventIdSuffix: "vt_123",
          eventType: "message.received",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("uses the home Linq chat route when the sender contact no longer matches the member identity", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);
    mocks.lookupHostedMemberRoutingByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550000000",
      memberId: "member_123",
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        from: "icloud-handle@example.test",
        service: "imessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_123",
      prisma,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      tx: prisma,
      envelope: expect.objectContaining({
        eventId: "evt_123",
        userId: "member_123",
      }),
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not count or wake duplicate active-member Linq event ids", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550000000",
      memberId: "member_123",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_evt_123",
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });
});

function buildLinqMessageWebhookBody(input: {
  eventId?: string;
  eventType?: string;
  from?: string;
  isFromMe?: boolean;
  messageId?: string;
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
      id: input.messageId ?? "msg_123",
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
    event_id: input.eventId ?? "evt_123",
    event_type: input.eventType ?? "message.received",
  });
}

function buildLinqProviderWebhookBody(input: {
  data: Record<string, unknown>;
  eventId: string;
  eventType: string;
}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: input.data,
    event_id: input.eventId,
    event_type: input.eventType,
    trace_id: "trace_provider_123",
    webhook_version: "2026-02-03",
  });
}

function createPrismaStub() {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    hostedLinqAlert: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedLinqDelivery: {
      create: vi.fn().mockResolvedValue({ id: "hld_random" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: "hld_123" }),
    },
    hostedLinqLine: {
      findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
        const phoneNumber = "+15550000000";
        const lookupKeys = new Set(query.where?.phoneNumberLookupKey?.in ?? []);
        if (
          !createHostedPhoneLookupKeyReadCandidates(phoneNumber).some((lookupKey) =>
            lookupKeys.has(lookupKey)
          )
        ) {
          return [];
        }
        return [{
          activeMemberLimit: null,
          assignmentWeight: 1,
          maxNewConversationsPerDay: null,
          phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(phoneNumber),
          phoneNumberHint: "*** 0000",
          phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber),
        }];
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
        Promise.resolve({
          phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
        })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
        Promise.resolve({
          phoneNumberLookupKey: input.create.phoneNumberLookupKey,
        })),
    },
    hostedLinqProviderEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hostedInvite: {
      findUnique: vi.fn().mockResolvedValue({
        inviteCode: "code_first_contact",
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    hostedMemberRouting: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedThreadRoute: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as const;

  return prisma;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
