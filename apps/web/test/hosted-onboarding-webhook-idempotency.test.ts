import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  buildHostedLinqAffirmativeReactionMessageEvent: vi.fn(),
  claimHostedLinqOnboardingLinkNotice: vi.fn(),
  claimHostedLinqQuotaReplyNotice: vi.fn(),
  markHostedLinqOnboardingLinkNoticeSent: vi.fn(),
  releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn(),
  releaseHostedLinqQuotaReplyNoticeClaim: vi.fn(),
  claimHostedLinqDeliveryProviderDispatchTx: vi.fn(),
  ensureHostedMemberForPhoneResolutionTx: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  getPrisma: vi.fn(),
  handleHostedGroupJoinOfferReaction: vi.fn(),
  incrementHostedLinqInboundDailyState: vi.fn(),
  incrementHostedLinqOutboundDailyState: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  lookupHostedMemberCoreByPendingLinqParticipantContact: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedMailboxItemOwnerById: vi.fn(),
  readHostedMemberHomeLinqRoute: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedLinqDailyState: vi.fn(),
  readHostedLinqDeliveryProviderDispatchIntentTx: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  checkHostedAiUsageGate: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
  sendHostedLinqReadReceipt: vi.fn(),
  stageHostedLinqGroupParticipantContext: vi.fn(),
  stageHostedLinqGroupReactionContext: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithSourceMessageTx: (input: {
    envelope: unknown;
    tx: unknown;
  }) =>
    mocks.appendHostedMailboxEnvelopeTx({
      envelope: input.envelope,
      tx: input.tx,
    }),
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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
  ensureHostedMemberForPhoneResolutionTx:
    mocks.ensureHostedMemberForPhoneResolutionTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx:
    mocks.acquireHostedMemberHomeLinqRouteLockTx,
  countHostedMemberHomeLinqBindingsByRecipientPhone:
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  lookupHostedMemberRoutingByHomeLinqChatId: mocks.lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberCoreByPendingLinqParticipantContact:
    mocks.lookupHostedMemberCoreByPendingLinqParticipantContact,
  readHostedMemberHomeLinqRoute: mocks.readHostedMemberHomeLinqRoute,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
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

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    claimHostedLinqDeliveryProviderDispatchTx: mocks.claimHostedLinqDeliveryProviderDispatchTx,
    readHostedLinqDeliveryProviderDispatchIntentTx:
      mocks.readHostedLinqDeliveryProviderDispatchIntentTx,
  };
});

vi.mock("@/src/lib/hosted-groups/join-offer-reaction", () => ({
  handleHostedGroupJoinOfferReaction: mocks.handleHostedGroupJoinOfferReaction,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context", () => ({
  buildHostedLinqAffirmativeReactionMessageEvent:
    mocks.buildHostedLinqAffirmativeReactionMessageEvent,
  stageHostedLinqGroupReactionContext:
    mocks.stageHostedLinqGroupReactionContext,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq-participant-context", () => ({
  stageHostedLinqGroupParticipantContextTx:
    mocks.stageHostedLinqGroupParticipantContext,
}));

import { buildHostedInviteReply } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqChatLookupKey,
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
    mocks.getHostedLinqChatSummary.mockResolvedValue({
      handles: [],
      isGroup: false,
    });
    const linq = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
      "@/src/lib/hosted-onboarding/linq",
    );
    mocks.verifyAndParseHostedLinqWebhookRequest.mockImplementation((input: { rawBody: string }) =>
      linq.parseHostedLinqWebhookEvent(input.rawBody),
    );
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.claimHostedLinqDeliveryProviderDispatchTx.mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    });
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValue({
      reason: "accepted",
      status: "accepted",
    });
    mocks.buildHostedLinqAffirmativeReactionMessageEvent.mockResolvedValue(null);
    mocks.stageHostedLinqGroupParticipantContext.mockResolvedValue(false);
    mocks.stageHostedLinqGroupReactionContext.mockResolvedValue(false);
    mocks.markHostedLinqOnboardingLinkNoticeSent.mockResolvedValue(true);
    mocks.releaseHostedLinqOnboardingLinkNoticeClaim.mockResolvedValue(undefined);
    mocks.releaseHostedLinqQuotaReplyNoticeClaim.mockResolvedValue(undefined);
    mocks.readHostedLinqDailyState.mockResolvedValue(null);
    mocks.readHostedLinqDeliveryProviderDispatchIntentTx.mockResolvedValue(null);
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
    mocks.lookupHostedMemberCoreByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue(null);
    mocks.readHostedMemberRoutingState.mockImplementation(async () => {
      const route = await mocks.readHostedMemberHomeLinqRoute();

      return {
        hasPendingLinqRouteState: false,
        linqChatId: route?.linqChatId ?? null,
        linqChatLookupKey: createHostedLinqChatLookupKey(route?.linqChatId ?? null),
        linqHomeLineAssignedAt: null,
        linqRecipientPhone: route?.linqRecipientPhone ?? null,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(route?.linqRecipientPhone ?? null),
        memberId: route?.memberId ?? "member_123",
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: null,
        telegramUserId: null,
        telegramUserLookupKey: null,
      };
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
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });

  it("records message.sent without treating it as delivery or inbound work", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody({
          eventType: "message.sent",
          isFromMe: true,
          service: "SMS",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "recorded-linq-provider-event:message.sent",
    });

    expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: null,
          direction: "outbound",
          eventType: "message.sent",
          messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
          service: "SMS",
        }),
        skipDuplicates: true,
      }),
    );
    expect(prisma.hostedLinqAlert.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });

  it("coalesces routed participant additions without scheduling, sending, or waking", async () => {
    const prisma = createPrismaStub();
    const scheduleAfterResponse = vi.fn();
    let transactionOpen = false;
    const transactionImplementation = prisma.$transaction.getMockImplementation();
    prisma.$transaction.mockImplementation(async (callback) => {
      transactionOpen = true;
      try {
        return await transactionImplementation!(callback);
      } finally {
        transactionOpen = false;
      }
    });
    mocks.stageHostedLinqGroupParticipantContext.mockImplementation(async () => {
      expect(transactionOpen).toBe(true);
      return false;
    });
    prisma.hostedThreadRoute.findMany.mockResolvedValue([
      buildHostedThreadRouteRow("member_group_runtime_123"),
    ]);
    mocks.getPrisma.mockReturnValue(prisma);

    for (const [eventId, addedAt] of [
      ["evt_participant_added_123", "2026-03-26T12:00:00.000Z"],
      ["evt_participant_added_456", "2026-03-26T12:00:15.000Z"],
    ] as const) {
      await expect(handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            added_at: addedAt,
            chat_id: "chat_group_1",
            handle: "+15551234567",
          },
          eventId,
          eventType: "participant.added",
        }),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      })).resolves.toMatchObject({
        ignored: true,
        ok: true,
        reason: "recorded-linq-provider-event:participant.added",
      });
    }

    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.hostedLinqProviderEvent.createMany.mock.invocationCallOrder[0]!,
    );
    expect(prisma.hostedThreadRoute.updateMany).toHaveBeenLastCalledWith({
      data: { pendingParticipantAddition: true },
      where: expect.objectContaining({
        channel: "linq",
        containerMemberId: "member_group_runtime_123",
      }),
    });
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.stageHostedLinqGroupParticipantContext).toHaveBeenCalledTimes(2);
    expect(mocks.stageHostedLinqGroupParticipantContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          data: expect.objectContaining({
            chat_id: "chat_group_1",
            participant: expect.objectContaining({
              handle: "+15551234567",
            }),
          }),
          event_type: "participant.added",
        }),
        prisma,
        route: expect.objectContaining({
          containerMemberId: "member_group_runtime_123",
        }),
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("stages removals but does not re-stage duplicate additions", async () => {
    const prisma = createPrismaStub();
    const scheduleAfterResponse = vi.fn();
    prisma.hostedThreadRoute.findMany.mockResolvedValue([
      buildHostedThreadRouteRow("member_group_runtime_123"),
    ]);
    mocks.getPrisma.mockReturnValue(prisma);

    await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_group_1",
          handle: "+15551234567",
          removed_at: "2026-03-26T12:00:00.000Z",
        },
        eventId: "evt_participant_removed_123",
        eventType: "participant.removed",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    });

    prisma.hostedLinqProviderEvent.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_group_1",
          handle: "+15551234567",
        },
        eventId: "evt_participant_added_duplicate",
        eventType: "participant.added",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      reason: "duplicate-linq-provider-event",
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
    expect(mocks.stageHostedLinqGroupParticipantContext).toHaveBeenCalledTimes(1);
    expect(mocks.stageHostedLinqGroupParticipantContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          data: expect.objectContaining({
            chat_id: "chat_group_1",
            participant: expect.objectContaining({
              handle: "+15551234567",
            }),
          }),
          event_type: "participant.removed",
        }),
        prisma,
      }),
    );
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("records unbound and chatless additions without provisioning or scheduling", async () => {
    const prisma = createPrismaStub();
    const scheduleAfterResponse = vi.fn();
    mocks.getPrisma.mockReturnValue(prisma);

    await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_unbound_1",
          handle: "+15551234567",
        },
        eventId: "evt_participant_unbound",
        eventType: "participant.added",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    });
    await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqProviderWebhookBody({
        data: {
          handle: "+15557654321",
        },
        eventId: "evt_participant_chatless",
        eventType: "participant.added",
      }),
      scheduleAfterResponse,
      signature: null,
      timestamp: null,
    });

    expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedThreadRoute.updateMany).not.toHaveBeenCalled();
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedMemberForPhoneResolutionTx).not.toHaveBeenCalled();
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("dispatches Linq reaction.added events to the hosted group join-offer handler", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            chat_id: "chat_group_1",
            from_handle: { handle: "+15551234567", service: "iMessage" },
            line: { phone_number: "+15550000000" },
            message_id: "msg_offer_123",
            reaction_type: "like",
          },
          eventId: "evt_reaction_123",
          eventType: "reaction.added",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "accepted-linq-group-join-offer-reaction",
    });

    expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: createHostedLinqProviderEventLookupKey("evt_reaction_123"),
          eventType: "reaction.added",
        }),
        skipDuplicates: true,
      }),
    );
    expect(mocks.handleHostedGroupJoinOfferReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          eventId: "evt_reaction_123",
          eventType: "reaction.added",
          messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
          reactionFromHandle: "+15551234567",
          reactionType: "like",
        }),
        prisma,
      }),
    );
    expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("routes an affirmative private-chat reaction through the ordinary message planner", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValue({
      reason: "no_offer_match",
      status: "ignored",
    });
    const messageEvent = JSON.parse(buildLinqMessageWebhookBody({
      eventId: "evt_reaction_reply_123",
      isGroup: false,
      messageId: "evt_reaction_reply_123",
      service: "iMessage",
      text: "Reacted with a like reaction.",
    }));
    messageEvent.data.reply_to = { message_id: "msg_murph_123" };
    mocks.buildHostedLinqAffirmativeReactionMessageEvent.mockResolvedValue(messageEvent);
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
    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          message_id: "msg_murph_123",
          reaction_type: "like",
        },
        eventId: "evt_reaction_reply_123",
        eventType: "reaction.added",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.buildHostedLinqAffirmativeReactionMessageEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventId: "evt_reaction_reply_123",
        eventType: "reaction.added",
      }),
    });
    expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "evt_reaction_reply_123",
        kind: "conversation.message",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            affirmativeReaction: true,
            messageId: "evt_reaction_reply_123",
            reactionEligible: false,
            replyToMessageId: "msg_murph_123",
          }),
        }),
        userId: "member_123",
      }),
      tx: prisma,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("reenters the ordinary planner on a duplicate reaction after mailbox append fails", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    prisma.hostedLinqProviderEvent.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValue({
      reason: "no_offer_match",
      status: "ignored",
    });
    const messageEvent = JSON.parse(buildLinqMessageWebhookBody({
      eventId: "evt_reaction_reply_retry_123",
      isGroup: false,
      messageId: "evt_reaction_reply_retry_123",
      service: "iMessage",
      text: "Reacted with a like reaction.",
    }));
    messageEvent.data.reply_to = { message_id: "msg_murph_retry_123" };
    mocks.buildHostedLinqAffirmativeReactionMessageEvent.mockResolvedValue(messageEvent);
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
    mocks.appendHostedMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("mailbox append failed"),
    );
    const webhook = {
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          message_id: "msg_murph_retry_123",
          reaction_type: "like",
        },
        eventId: "evt_reaction_reply_retry_123",
        eventType: "reaction.added",
      }),
      signature: null,
      timestamp: null,
    };

    await expect(handleHostedOnboardingLinqWebhook(webhook)).rejects.toThrow(
      "mailbox append failed",
    );
    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.hostedLinqProviderEvent.createMany).toHaveBeenCalledTimes(2);
    expect(mocks.buildHostedLinqAffirmativeReactionMessageEvent).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("stages group reaction context without scheduling, sending, or waking", async () => {
    const prisma = createPrismaStub();
    const scheduleAfterResponse = vi.fn();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValue({
      reason: "unsupported_reaction",
      status: "ignored",
    });
    mocks.stageHostedLinqGroupReactionContext.mockResolvedValue(true);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            chat_id: "chat_group_1",
            custom_emoji: "😂",
            from: "+15551234567",
            message_id: "msg_group_123",
            reaction_type: "custom",
          },
          eventId: "evt_reaction_context_123",
          eventType: "reaction.added",
        }),
        scheduleAfterResponse,
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "staged-linq-group-reaction-context",
    });

    expect(mocks.stageHostedLinqGroupReactionContext).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventId: "evt_reaction_context_123",
        eventType: "reaction.added",
        linqChatId: "chat_group_1",
        linqMessageId: "msg_group_123",
      }),
      prisma,
    });
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not restage duplicate non-join reaction context", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    prisma.hostedLinqProviderEvent.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValue({
      reason: "unsupported_reaction",
      status: "ignored",
    });
    mocks.stageHostedLinqGroupReactionContext.mockResolvedValue(true);
    const webhook = {
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_group_1",
          custom_emoji: "😂",
          from: "+15551234567",
          message_id: "msg_group_123",
          reaction_type: "custom",
        },
        eventId: "evt_reaction_context_123",
        eventType: "reaction.added",
      }),
      signature: null,
      timestamp: null,
    };

    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      ignored: false,
      reason: "staged-linq-group-reaction-context",
    });
    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
    });
    expect(mocks.stageHostedLinqGroupReactionContext).toHaveBeenCalledTimes(1);
  });

  it("reruns duplicate Linq reaction.added events so a failed join-offer confirmation can retry", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    prisma.hostedLinqProviderEvent.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    let membershipExists = false;
    let membershipCreates = 0;
    let confirmationAttempts = 0;
    mocks.handleHostedGroupJoinOfferReaction.mockImplementation(async () => {
      if (!membershipExists) {
        membershipExists = true;
        membershipCreates += 1;
      }
      confirmationAttempts += 1;
      if (confirmationAttempts === 1) {
        throw new Error("confirmation send failed");
      }
      return {
        reason: "accepted",
        status: "accepted",
      };
    });
    const webhook = {
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_group_1",
          from_handle: { handle: "+15551234567", service: "iMessage" },
          line: { phone_number: "+15550000000" },
          message_id: "msg_offer_123",
          reaction_type: "like",
        },
        eventId: "evt_reaction_123",
        eventType: "reaction.added",
      }),
      signature: null,
      timestamp: null,
    };

    await expect(handleHostedOnboardingLinqWebhook(webhook)).rejects.toThrow(
      "confirmation send failed",
    );
    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      duplicate: true,
      ignored: false,
      ok: true,
      reason: "accepted-linq-group-join-offer-reaction",
    });

    expect(mocks.handleHostedGroupJoinOfferReaction).toHaveBeenCalledTimes(2);
    expect(confirmationAttempts).toBe(2);
    expect(membershipCreates).toBe(1);
  });

  it("skips a duplicate Linq join reaction after its terminal handling committed", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    prisma.hostedLinqProviderEvent.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.hostedLinqProviderEvent.findUnique.mockResolvedValueOnce({
      groupJoinOfferHandledAt: new Date("2026-03-26T12:01:00.000Z"),
    });
    let confirmationSends = 0;
    let confirmationSent = false;
    mocks.handleHostedGroupJoinOfferReaction.mockImplementation(async () => {
      if (!confirmationSent) {
        confirmationSent = true;
        confirmationSends += 1;
      }
      return {
        reason: "accepted",
        status: "accepted",
      };
    });
    const webhook = {
      rawBody: buildLinqProviderWebhookBody({
        data: {
          chat_id: "chat_group_1",
          from_handle: { handle: "+15551234567", service: "iMessage" },
          line: { phone_number: "+15550000000" },
          message_id: "msg_offer_123",
          reaction_type: "like",
        },
        eventId: "evt_reaction_123",
        eventType: "reaction.added",
      }),
      signature: null,
      timestamp: null,
    };

    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "accepted-linq-group-join-offer-reaction",
    });
    await expect(handleHostedOnboardingLinqWebhook(webhook)).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-linq-group-join-offer-reaction",
    });

    expect(mocks.handleHostedGroupJoinOfferReaction).toHaveBeenCalledTimes(1);
    expect(confirmationSends).toBe(1);
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
  });

  it("records Linq line status updates as alerts without product sends or wake handoff", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            changed_at: "2026-03-26T12:00:00.000Z",
            new_reputation: "AT_RISK",
            new_status: "FLAGGED",
            phone_number: "+15550000000",
            reason: "carrier review",
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
          providerServiceStatus: "FLAGGED",
        }),
      }),
    );
    expect(prisma.hostedLinqLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerReputationStatus: "AT_RISK",
        }),
      }),
    );
    expect(prisma.hostedLinqLine.updateMany.mock.calls.at(-1)?.[0].data)
      .not.toHaveProperty("healthStatus");
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
  });

  it.each([
    [
      "suspended member",
      "member_suspended",
      "ignored-linq-group-join-offer-member-suspended",
    ],
    [
      "target-group member",
      "already_group_member",
      "ignored-linq-group-join-offer-already-member",
    ],
  ] as const)(
    "consumes a %s join reaction without ordinary fallthrough",
    async (_label, reactionReason, responseReason) => {
      mocks.handleHostedGroupJoinOfferReaction.mockResolvedValueOnce({
        reason: reactionReason,
        status: "ignored",
      });
      const prisma = createPrismaStub();
      mocks.getPrisma.mockReturnValue(prisma);

      await expect(
        handleHostedOnboardingLinqWebhook({
          rawBody: buildLinqProviderWebhookBody({
            data: {
              chat_id: "chat_group_1",
              from_handle: { handle: "+15551234567", service: "iMessage" },
              line: { phone_number: "+15550000000" },
              message_id: "msg_offer_123",
              reaction_type: "like",
            },
            eventId: `evt_reaction_${reactionReason}`,
            eventType: "reaction.added",
          }),
          signature: null,
          timestamp: null,
        }),
      ).resolves.toMatchObject({
        ignored: true,
        ok: true,
        reason: responseReason,
      });

      expect(mocks.buildHostedLinqAffirmativeReactionMessageEvent)
        .not.toHaveBeenCalled();
      expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    },
  );

  it("consumes an unsupported-region join reaction without staging group work", async () => {
    // The refusal is a decided outcome for a reaction that targeted the canonical
    // offer, so the webhook must stop here rather than fall through to the generic
    // affirmative-reaction path and wake the group mailbox only to skip it.
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValueOnce({
      reason: "recipient_region_unsupported",
      status: "ignored",
    });
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            chat_id: "chat_group_1",
            from_handle: { handle: "+353871234567", service: "iMessage" },
            line: { phone_number: "+15550000000" },
            message_id: "msg_offer_123",
            reaction_type: "like",
          },
          eventId: "evt_reaction_region",
          eventType: "reaction.added",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "ignored-linq-group-join-offer-region-unsupported",
    });

    expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
  });

  it("consumes an unsupported-region join reaction removal without staging group context", async () => {
    // A removal from a refused region must not reach stageHostedLinqGroupReactionContext:
    // that persists the participant's phone and the removed reaction into group-owned
    // context, which a later group message consumes into the group runtime.
    mocks.handleHostedGroupJoinOfferReaction.mockResolvedValueOnce({
      reason: "recipient_region_unsupported",
      status: "ignored",
    });
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqProviderWebhookBody({
          data: {
            chat_id: "chat_group_1",
            from_handle: { handle: "+353871234567", service: "iMessage" },
            line: { phone_number: "+15550000000" },
            message_id: "msg_offer_123",
            reaction_type: "like",
          },
          eventId: "evt_reaction_region_removed",
          eventType: "reaction.removed",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "ignored-linq-group-join-offer-region-unsupported",
    });

    expect(mocks.stageHostedLinqGroupReactionContext).not.toHaveBeenCalled();
  });

  it("sends the signup link directly for an unsupported-prefix inactive member", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: null,
    });
    mocks.ensureHostedMemberForPhoneResolutionTx.mockResolvedValue({
      created: true,
      member: {
        billingStatus: HostedBillingStatus.not_started,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_first_contact",
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody({
          from: "+919876543210",
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

    expect(mocks.ensureHostedMemberForPhoneResolutionTx).toHaveBeenCalledWith({
      phoneNumber: "+919876543210",
      prisma,
    });
    expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        linqChatId: "chat_123",
        memberId: "member_123",
        participantContact: expect.objectContaining({
          kind: "phone",
          value: "+919876543210",
        }),
      }),
    );
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
  });

  it("honors an earlier group outreach after the phone becomes an active member", async () => {
    const prisma = createPrismaStub();
    const outreach = {
      groupJoinOutreach: {
        id: "hgrpjoa_active_member",
        offer: {
          group: {
            id: "hgrp_active_member",
            joinCode: "join_active_member",
            runtimeMember: { suspendedAt: null },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: null,
        },
      },
      groupJoinOutreachId: "hgrpjoa_active_member",
      id: "hld_active_member_opener",
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000000"),
    };
    prisma.hostedLinqDelivery.findMany.mockResolvedValueOnce([outreach]);
    prisma.hostedGroupJoinOutreach.findFirst.mockResolvedValue({
      offer: outreach.groupJoinOutreach.offer,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_active_member",
    });
    prisma.hostedInvite.findUnique.mockResolvedValue({
      inviteCode: "code_active_member",
    });
    const restorePublicBaseUrl = configureHostedPublicBaseUrlForTest();

    try {
      await expect(
        handleHostedOnboardingLinqWebhook({
          rawBody: buildLinqMessageWebhookBody({
            eventId: "evt_active_member_group_reply",
            service: "iMessage",
          }),
          signature: null,
          timestamp: null,
        }),
      ).resolves.toMatchObject({
        inviteCode: "code_active_member",
        joinUrl:
          "https://join.example.test/groups/join/join_active_member?invite=code_active_member",
        ok: true,
        reason: "sent-signup-link",
      });

      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: buildHostedInviteReply({
            joinUrl:
              "https://join.example.test/groups/join/join_active_member?invite=code_active_member",
          }),
        }),
      );
    } finally {
      restorePublicBaseUrl();
    }
  });

  it("uses ordinary onboarding after an inactive member already joined on the web", async () => {
    const prisma = createPrismaStub();
    const outreach = {
      groupJoinOutreach: {
        id: "hgrpjoa_web_joined",
        offer: {
          group: {
            id: "hgrp_web_joined",
            joinCode: "join_web_joined",
            runtimeMember: { suspendedAt: null },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: null,
        },
      },
      groupJoinOutreachId: "hgrpjoa_web_joined",
      id: "hld_web_joined_opener",
      linqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
      phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000000"),
    };
    prisma.hostedLinqDelivery.findMany.mockResolvedValueOnce([outreach]);
    prisma.hostedGroupMember.findUnique.mockResolvedValueOnce({
      id: "hgrpm_web_joined",
    });
    prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.not_started,
      suspendedAt: null,
      threadContainer: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.not_started,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_web_joined",
    });
    prisma.hostedInvite.findUnique.mockResolvedValue({
      inviteCode: "code_web_joined",
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody({
          eventId: "evt_web_joined_group_reply",
          service: "iMessage",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      inviteCode: "code_web_joined",
      joinUrl: "https://join.example.test/join/code_web_joined",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_web_joined",
        }),
      }),
    );
  });

  it("deduplicates overlapping unsupported-prefix signup link sends", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: null,
    });
    mocks.ensureHostedMemberForPhoneResolutionTx.mockResolvedValue({
      created: true,
      member: {
        billingStatus: HostedBillingStatus.not_started,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_first_contact",
    });
    const expectedIdempotencyKey =
      "linq-invite-signup:member_123:2026-03-26T00:00:00.000Z";
    const firstSourceRef = expectedIdempotencyKey;
    mocks.readHostedLinqDeliveryProviderDispatchIntentTx
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "hld_first_contact",
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        providerCorrelated: false,
        sourceRef: firstSourceRef,
      });
    mocks.claimHostedLinqDeliveryProviderDispatchTx
      .mockResolvedValueOnce({
        claimed: true,
        id: "hld_first_contact",
      })
      .mockResolvedValueOnce({
        claimed: false,
        id: "hld_first_contact",
        outcome: "completed",
      });

    const firstInboundResponse = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        eventId: "evt_first_contact_one",
        from: "+919876543210",
        messageId: "msg_first_contact_one",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });
    const laterInboundResponse = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        eventId: "evt_first_contact_two",
        from: "+919876543210",
        messageId: "msg_first_contact_two",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(firstInboundResponse).toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    expect(laterInboundResponse).toMatchObject({
      duplicate: true,
      ok: true,
      reason: "signup-link-already-sent",
    });
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledTimes(2);
    expect(mocks.claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: expectedIdempotencyKey,
        linqChatId: "chat_123",
        source: "hosted_webhook_side_effect",
        sourceRef: firstSourceRef,
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
      mocks.ensureHostedMemberForPhoneResolutionTx.mockResolvedValue({
        created: true,
        member: {
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          suspendedAt: null,
        },
      });
      mocks.issueHostedInviteTx.mockResolvedValue({
        id: "invite_123",
        inviteCode: "code_first_contact",
      });

      await expect(
        handleHostedOnboardingLinqWebhook({
          rawBody: buildLinqMessageWebhookBody({
            from: "+919876543210",
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

      expect(mocks.ensureHostedMemberForPhoneResolutionTx).toHaveBeenCalledWith({
        phoneNumber: "+919876543210",
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
      homeLineAssignedAt: null,
      linqChatId: "chat_123",
      memberId: "member_123",
      participantContact: expect.objectContaining({
        kind: "phone",
        value: "+15551234567",
      }),
      prisma,
      recipientPhone: "+15550000000",
    });
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(
      mocks.upsertHostedMemberHomeLinqBindingTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0],
    );
    expect(
      mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_123" }),
    );
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
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
    expect(response).not.toHaveProperty("wakeUserId");
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberSnapshot).not.toHaveBeenCalled();
  });

  it("rechecks inactive access under the route owner before routing", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.not_started,
        id: "member_123",
        suspendedAt: null,
      },
    });
    prisma.hostedMember.findUnique
      .mockResolvedValueOnce({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: null,
        threadContainer: null,
      })
      .mockResolvedValueOnce({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      });
    mocks.readHostedMemberHomeLinqRoute.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550000000",
      memberId: "member_123",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody(),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(3);
    const initialAccessReadOrder =
      prisma.hostedMember.findUnique.mock.invocationCallOrder[0]!;
    const exactAccessReadOrder =
      prisma.hostedMember.findUnique.mock.invocationCallOrder[1]!;
    const refreshedAccessReadOrder =
      prisma.hostedMember.findUnique.mock.invocationCallOrder[2]!;
    const reclassificationLockOrder =
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0]!;
    expect(initialAccessReadOrder).toBeLessThan(exactAccessReadOrder);
    expect(exactAccessReadOrder).toBeLessThan(reclassificationLockOrder);
    expect(reclassificationLockOrder).toBeLessThan(refreshedAccessReadOrder);
    expect(
      refreshedAccessReadOrder,
    ).toBeLessThan(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[1],
    );
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
  });

  it("attempts confirmation recovery after a rejected current Linq wake", async () => {
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
    const wakeError = new Error("Temporal signal rejected");
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(wakeError);

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody(),
      signature: null,
      timestamp: null,
    })).rejects.toBe(wakeError);

    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(
      mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
  });

  it("bounds a stalled current Linq wake before confirmation recovery", async () => {
    vi.useFakeTimers();
    try {
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
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => {}));

      const result = expect(handleHostedOnboardingLinqWebhook({
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      })).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);
      await result;

      expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort)
        .toHaveBeenCalledWith({
          memberId: "member_123",
          prisma,
          timeoutMs: 1,
        });
    } finally {
      vi.useRealTimers();
    }
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
        abortSignal: expect.any(AbortSignal),
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
    mocks.lookupHostedMemberCoreByPendingLinqParticipantContact.mockResolvedValue(null);
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
      routing: {
        hasTelegramUserBinding: false,
        linqChatId: "chat_123",
        memberId: "member_123",
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
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("dedupes active-member Linq replays before route redirect planning", async () => {
    const prisma = createPrismaStub();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_evt_123",
    });
    mocks.readHostedMemberRoutingState.mockImplementationOnce(async () => {
      throw new Error("duplicate active-member replays must not resolve route binding");
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildLinqMessageWebhookBody({
        eventId: "evt_123",
        messageId: "msg_replay",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: "evt_123",
      prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_123",
    });
  });
});

function buildLinqMessageWebhookBody(input: {
  eventId?: string;
  eventType?: string;
  from?: string;
  isGroup?: boolean;
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
        ...(input.isGroup === undefined ? {} : { is_group: input.isGroup }),
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
    $queryRaw: vi.fn().mockResolvedValue([{ id: "member_123" }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    // Inbound planning consults pending pre-member group-join outreach to
    // recover the originating group. This fixture has no outreach rows.
    hostedGroupJoinOutreach: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    hostedGroupMember: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedLinqAlert: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedLinqDelivery: {
      create: vi.fn().mockResolvedValue({ id: "hld_random" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: "hld_123" }),
    },
    hostedLinqFirstContactAdmissionDecision: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedLinqLine: {
      findMany: vi.fn(async (query: { where?: { phoneNumberLookupKey?: { in?: string[] } } }) => {
        const phoneNumber = "+15550000000";
        // The assignable pool contains exactly the incoming line: the
        // whole-pool list query (no lookup-key filter) and the by-phone query
        // both resolve to it.
        const lookupKeyFilter = query.where?.phoneNumberLookupKey?.in;
        if (lookupKeyFilter) {
          const lookupKeys = new Set(lookupKeyFilter);
          if (
            !createHostedPhoneLookupKeyReadCandidates(phoneNumber).some((lookupKey) =>
              lookupKeys.has(lookupKey)
            )
          ) {
            return [];
          }
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
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hostedInvite: {
      findUnique: vi.fn().mockResolvedValue({
        inviteCode: "code_first_contact",
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    hostedMember: {
      // Unified access read (readActiveHostedMemberAccess): member_123 is a
      // direct-paid active member with no sponsorships.
      findUnique: vi.fn().mockResolvedValue({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      }),
    },
    hostedMemberRouting: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedThreadRoute: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as const;

  return prisma;
}

function buildHostedThreadRouteRow(containerMemberId: string) {
  const memberCore = {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-03-26T00:00:00.000Z"),
    id: containerMemberId,
    suspendedAt: null,
    updatedAt: new Date("2026-03-26T00:00:00.000Z"),
  };
  return {
    channel: "linq",
    container: {
      member: memberCore,
      owner: {
        accountGroupMemberships: [],
        ...memberCore,
        id: "member_owner_123",
      },
    },
    containerMemberId,
  };
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function configureHostedPublicBaseUrlForTest(): () => void {
  const previous = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
  process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL =
    "https://join.example.test";
  clearHostedOnboardingRuntimeCache();
  return () => {
    restoreEnvValue("HOSTED_ONBOARDING_PUBLIC_BASE_URL", previous);
    clearHostedOnboardingRuntimeCache();
  };
}

function clearHostedOnboardingRuntimeCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}
