import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus } from "@prisma/client";

const transportBoundaryMocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  shareMurphHostedLinqNativeContactCardToChat: vi.fn().mockResolvedValue({
    status: "sent",
  }),
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    transportBoundaryMocks.acquireHostedLinqChatOwnershipLockTx,
}));

// Keep this mock self-contained: importing the actual module here can expose
// this mocked namespace to another serialized file in the CI Vitest project.
vi.mock("@/src/lib/hosted-onboarding/linq-contact-card-share", () => ({
  isHostedLinqContactCardAutoShareEligible: (input: { service: string | null }) =>
    input.service?.trim().toLowerCase() === "imessage",
  shareMurphHostedLinqNativeContactCardToChat:
    transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-routing/thread-route-store")
  >("@/src/lib/hosted-routing/thread-route-store");
  return {
    ...actual,
    readHostedThreadRouteByThreadIdentity:
      transportBoundaryMocks.readHostedThreadRouteByThreadIdentity,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  createHostedLinqChat: vi.fn().mockResolvedValue({
    chatId: "chat-created",
    messageId: "provider-message-created",
  }),
  getHostedLinqChatHandles: vi.fn(),
  isHostedLinqAttachmentSendPrepareFailure: vi.fn(() => false),
  sendHostedLinqAttachmentMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: vi.fn(async () => null),
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) => `https://join.test/${inviteCode}`),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  buildHostedDailyQuotaReply: vi.fn(() => "daily-quota"),
  buildHostedInviteReply: vi.fn(() => "invite-reply"),
  buildHostedLinqConversationHomeRedirectReply: vi.fn(({ homeRecipientPhone }: { homeRecipientPhone: string }) => `redirect:${homeRecipientPhone}`),
  sendHostedLinqChatMessage: vi.fn().mockResolvedValue({
    chatId: "chat-1",
    messageId: "provider-message-1",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: vi.fn(() => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  })),
  requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://join.test"),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-daily-state")
  >("@/src/lib/hosted-onboarding/linq-daily-state");
  return {
    ...actual,
    claimHostedLinqOnboardingLinkNotice: vi.fn().mockResolvedValue(true),
    claimHostedLinqQuotaReplyNotice: vi.fn().mockResolvedValue(true),
    markHostedLinqOnboardingLinkNoticeSent: vi.fn().mockResolvedValue(true),
    releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn().mockResolvedValue(undefined),
    releaseHostedLinqQuotaReplyNoticeClaim: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    claimHostedLinqDeliveryProviderDispatchTx: vi.fn().mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    }),
    markHostedLinqDeliveryAcceptedTx: vi.fn().mockResolvedValue({
      deliveryStatus: "accepted",
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    }),
    markHostedLinqDeliverySendFailedTx: vi.fn(actual.markHostedLinqDeliverySendFailedTx),
    readHostedLinqDeliveryProviderDispatchIntentTx: vi.fn().mockResolvedValue(null),
    recordHostedLinqDeliveryAttemptTx: vi.fn(actual.recordHostedLinqDeliveryAttemptTx),
    resolveHostedLinqInviteSignupDispatchEffectIdTx: vi.fn(
      async (input: { effectId: string }) => input.effectId,
    ),
  };
});

vi.mock("@/src/lib/hosted-execution/usage-limit-notice-claim", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    startAuthorizedHostedAiUsageLimitNoticeDispatchTx: vi.fn(
      async (input: {
        memberId: string;
        periodStart: Date;
        usageCreditLedgerVersion: bigint;
      }) => ({
        idempotencyKey: actual.buildHostedAiUsageGateNoticeIdempotencyKey(input),
        providerIdempotencyKey: "ai-usage-attempt:hld_usage_notice",
        status: "claimed" as const,
      }),
    ),
  };
});

import {
  createHostedLinqChat,
} from "@/src/lib/hosted-onboarding/linq-client";
import {
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  HOSTED_LINQ_DAILY_TEXT_LIMIT,
  HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
  markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  readHostedLinqDeliveryProviderDispatchIntentTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx as startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  buildHostedLinqInviteSignupDeliverySourceRef,
  parseHostedLinqInviteSignupDeliverySourceRef,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";
import { requireHostedOnboardingLinqConfig } from "@/src/lib/hosted-onboarding/runtime";

const usageTransactionPrisma = {};
const usagePrisma = {
  $transaction: vi.fn(async (
    operation: (prisma: typeof usageTransactionPrisma) => Promise<unknown>,
  ) => operation(usageTransactionPrisma)),
  hostedLinqDelivery: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
};

describe("hosted Linq webhook transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportBoundaryMocks.acquireHostedLinqChatOwnershipLockTx.mockResolvedValue(undefined);
    transportBoundaryMocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
    vi.mocked(sendHostedLinqChatMessage).mockResolvedValue({
      chatId: "chat-1",
      messageId: "provider-message-1",
    });
    vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockResolvedValue({
      claimed: true,
      id: "hld_claimed",
    });
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx).mockResolvedValue(
      null,
    );
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockImplementation(async (input) => {
        await input.prisma.$transaction(async (prisma) => {
          await input.assertDispatchAuthority?.(prisma);
        });
        return {
          idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey(input),
          providerIdempotencyKey: "ai-usage-attempt:hld_usage_notice",
          status: "claimed",
        };
      });
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValue({
      deliveryStatus: "accepted",
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    vi.mocked(requireHostedOnboardingLinqConfig).mockReturnValue({
      apiBaseUrl: "https://linq.example.test/api/partner/v3",
      apiToken: "linq-token",
    });
  });

  it("sends the planner-chosen home phone with a chat+home-line stable effect id", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(effect.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith(expect.objectContaining({
      homeRecipientPhone: "+15555550100",
    }));
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: effect.effectId,
        message: "redirect:+15555550100",
        replyToMessageId: "message-1",
      }),
    );
  });

  it("does not share the contact card after provider acceptance alone", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-provider-accepted",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toMatchObject({ sentCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat-1",
      message: "invite-reply",
    }));
    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).not.toHaveBeenCalled();
  });

  it("commits accepted group reply context before the provider fence returns", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-reply",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    const scheduledTasks: Array<() => Promise<void>> = [];

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        scheduleAfterResponse: (task) => {
          scheduledTasks.push(task);
        },
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(scheduledTasks).toHaveLength(0);
    expect(markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: expect.objectContaining({
        $queryRaw: expect.any(Function),
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 15_000 },
    );
    expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalled();
    const claimInput = vi.mocked(claimHostedLinqDeliveryProviderDispatchTx)
      .mock.calls[0]?.[0];
    expect(parseHostedLinqInviteSignupDeliverySourceRef(
      claimInput?.sourceRef,
    )).toEqual({
      effectId: effect.effectId,
      groupJoinReplyContext: {
        outreachId: "hgrpjoa-1",
        repliedAt: "2026-03-26T12:00:00.000Z",
      },
    });
    expect(markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledTimes(1);
    expect(prisma.hostedGroupJoinOutreach.updateMany).toHaveBeenCalledWith({
      data: {
        repliedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
      where: {
        id: "hgrpjoa-1",
        repliedAt: null,
        sentAt: { not: null },
        skippedAt: null,
      },
    });
  });

  it("commits a failed group provider attempt before surfacing the error", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(
      new Error("send failed"),
    );
    vi.mocked(markHostedLinqDeliverySendFailedTx).mockResolvedValueOnce();
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-provider-failed",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-provider-failed",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    const scheduleAfterResponse = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          scheduleAfterResponse,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("send failed");
    } finally {
      errorSpy.mockRestore();
    }

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 15_000 },
    );
    expect(markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: "send failed",
        idempotencyKey: effect.effectId,
        prisma: expect.objectContaining({
          $queryRaw: expect.any(Function),
        }),
      }),
    );
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(prisma.hostedGroupJoinOutreach.updateMany).not.toHaveBeenCalled();
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
  });

  it("rolls back before provider entry when the full request budget no longer remains", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-provider-budget",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-provider-budget",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    const performanceNow = vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(3_001);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).rejects.toMatchObject({
        code: "HOSTED_LINQ_PROVIDER_FENCE_BUDGET_EXHAUSTED",
        httpStatus: 503,
        retryable: true,
      });
    } finally {
      errorSpy.mockRestore();
      performanceNow.mockRestore();
    }

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 15_000 },
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
  });

  it("rolls back the group provider fence when accepted correlation fails", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockRejectedValueOnce(
      new Error("correlation failed"),
    );
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-correlation-failed",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-correlation-failed",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("correlation failed");
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
    expect(prisma.hostedGroupJoinOutreach.updateMany).not.toHaveBeenCalled();
  });

  it("returns the exact retry deadline while a signup delivery is still in flight", async () => {
    const retryAt = new Date("2026-03-26T12:15:00.000Z");
    vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockResolvedValueOnce({
      claimed: false,
      id: "hld_in_flight",
      retryAt,
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-in-flight",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: createInviteSignupPrismaFixture() as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_in_flight",
        retryAt,
        template: "invite_signup",
      }],
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("gives different group reply events independent provider identities", async () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-a",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-a",
      sourceEventId: "event-a",
      template: "invite_signup",
    });
    const laterEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-b",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:01:00.000Z",
      replyToMessageId: "message-b",
      sourceEventId: "event-b",
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [firstEffect, laterEffect],
      }),
    ).resolves.toMatchObject({ sentCount: 2 });

    expect(firstEffect.effectId).not.toBe(laterEffect.effectId);
    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: firstEffect.effectId }),
    );
    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: laterEffect.effectId }),
    );
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
  });

  it("recovers the original group signup payload for a retry of the same inbound", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group-b",
      groupJoinOutreachId: "hgrpjoa-b",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:01:00.000Z",
      replyToMessageId: "message-a",
      sourceEventId: "event-a",
      template: "invite_signup",
    });
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx).mockResolvedValueOnce({
      providerCorrelated: false,
      sourceRef: buildHostedLinqInviteSignupDeliverySourceRef({
        effectId: effect.effectId,
        groupJoinOutreachId: "hgrpjoa-a",
        groupJoinRepliedAt: "2026-03-26T12:00:00.000Z",
      }),
    });
    const prisma = createInviteSignupPrismaFixture({
      groupJoinCode: "join-group-a",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toMatchObject({ sentCount: 1 });

    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: effect.effectId,
        sourceRef: buildHostedLinqInviteSignupDeliverySourceRef({
          effectId: effect.effectId,
          groupJoinOutreachId: "hgrpjoa-a",
          groupJoinRepliedAt: "2026-03-26T12:00:00.000Z",
        }),
      }),
    );
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: effect.effectId,
        message: "invite-reply",
        replyToMessageId: "message-a",
      }),
    );
    expect(buildHostedInviteReply).toHaveBeenCalledWith({
      joinUrl:
        "https://join.test/groups/join/join-group-a?invite=invite-code",
      seed: effect.effectId,
    });
  });

  it("recovers a persisted group intent when current lookup finds no group", async () => {
    const originalEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group-a",
      groupJoinOutreachId: "hgrpjoa-a",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-a",
      sourceEventId: "event-a",
      template: "invite_signup",
    });
    const retryEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-a",
      sourceEventId: "event-a",
      template: "invite_signup",
    });
    const persistedSourceRef =
      buildHostedLinqInviteSignupDeliverySourceRef({
        effectId: originalEffect.effectId,
        groupJoinOutreachId: "hgrpjoa-a",
        groupJoinRepliedAt: "2026-03-26T12:00:00.000Z",
      });
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx)
      .mockResolvedValue({
        providerCorrelated: false,
        sourceRef: persistedSourceRef,
      });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: createInviteSignupPrismaFixture({
          groupJoinCode: "join-group-a",
        }) as never,
        sideEffects: [retryEffect],
      }),
    ).resolves.toMatchObject({ sentCount: 1 });

    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: originalEffect.effectId,
        sourceRef: persistedSourceRef,
      }),
    );
    expect(buildHostedInviteReply).toHaveBeenCalledWith({
      joinUrl:
        "https://join.test/groups/join/join-group-a?invite=invite-code",
      seed: originalEffect.effectId,
    });
  });

  it("does not claim a group-aware signup delivery after its outreach authority is gone", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-deleted",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-deleted",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture({
      groupReplyAuthorized: false,
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "invite_signup",
      }],
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.hostedGroupJoinOutreach.findUnique).toHaveBeenCalledWith({
      select: {
        groupId: true,
        offerId: true,
        repliedAt: true,
        sentAt: true,
        skippedAt: true,
      },
      where: { id: "hgrpjoa-deleted" },
    });
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("reopens group context and daily suppression when acceptance replays its lone buffered failure", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "failed",
      reopenOnboardingLink: {
        groupJoinReplyContext: {
          outreachId: "hgrpjoa-failed",
          repliedAt: "2026-03-26T12:00:00.000Z",
      },
      memberId: "member-1",
      occurredAt: "2026-03-26T00:00:00.000Z",
      releaseDailySuppression: true,
    },
      restoreOnboardingLink: null,
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-failed",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-reply-failed",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    const scheduleAfterResponse = vi.fn();

    await drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      scheduleAfterResponse,
      sideEffects: [effect],
    });

    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T00:00:00.000Z",
      prisma: expect.any(Object),
    });
    expect(prisma.hostedGroupJoinOutreach.updateMany).toHaveBeenCalledWith({
      data: { repliedAt: null },
      where: {
        id: "hgrpjoa-failed",
        repliedAt: new Date("2026-03-26T12:00:00.000Z"),
        sentAt: { not: null },
        skippedAt: null,
      },
    });
  });

  it("awaits one share when accepted-milestone replay finds an earlier delivered receipt", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat-1",
        memberId: "member-1",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "iMessage",
      },
    });
    const shareControl: { resolve?: () => void } = {};
    const pendingShare = new Promise<{ status: "sent" }>((resolve) => {
      shareControl.resolve = () => resolve({ status: "sent" });
    });
    transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat
      .mockReturnValueOnce(pendingShare);
    const scheduledTasks: Array<() => Promise<void>> = [];
    const scheduleAfterResponse = vi.fn((task: () => Promise<void>) => {
      scheduledTasks.push(task);
    });
    const signal = new AbortController().signal;
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-replayed-delivery",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        scheduleAfterResponse,
        sideEffects: [effect],
        signal,
      }),
    ).resolves.toMatchObject({ sentCount: 1 });

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(scheduledTasks).toHaveLength(1);
    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).not.toHaveBeenCalled();

    const [scheduledTask] = scheduledTasks;
    if (!scheduledTask) {
      throw new Error("Expected an accepted-milestone task.");
    }
    let milestoneSettled = false;
    const milestoneTask = scheduledTask().finally(() => {
      milestoneSettled = true;
    });

    await vi.waitFor(() => {
      expect(
        transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
      ).toHaveBeenCalledTimes(1);
    });
    expect(milestoneSettled).toBe(false);
    const resolveShare = shareControl.resolve;
    if (!resolveShare) {
      throw new Error("Expected the contact-card share to start.");
    }
    resolveShare();
    await expect(milestoneTask).resolves.toBeUndefined();
    expect(milestoneSettled).toBe(true);
    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat-1",
      memberId: "member-1",
      prisma,
    }));
    const [shareInput] =
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat.mock.calls[0] ?? [];
    expect(shareInput).not.toHaveProperty("signal");
  });

  it("shares a replayed delivered fallback once in its newly created chat", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat-created",
        memberId: "member-1",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "iMessage",
      },
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      assignedRecipientPhone: "+15550100001",
      inviteId: "invite-1",
      memberId: "member-1",
      memberPhone: "+15551234567",
      occurredAt: "2026-03-26T12:00:00.000Z",
      sourceEventId: "event-contact-card-fallback-replayed-delivery",
      template: "invite_signup_fallback",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toMatchObject({ sentCount: 1 });

    await vi.waitFor(() => {
      expect(
        transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
      ).toHaveBeenCalledTimes(1);
    });
    expect(createHostedLinqChat).toHaveBeenCalledTimes(1);
    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat-created",
      memberId: "member-1",
    }));
  });

  it("does not share a replayed delivered signup over SMS", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat-1",
        memberId: "member-1",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "sms",
      },
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-contact-card-sms-replayed-delivery",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toMatchObject({ sentCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).not.toHaveBeenCalled();
  });

  it("skips a replayed delivered contact-card share inside a transaction", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat-1",
        memberId: "member-1",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "iMessage",
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-transaction-replayed-delivery",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();
    Reflect.deleteProperty(prisma, "$transaction");

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).resolves.toMatchObject({ sentCount: 1 });
      await new Promise((resolve) => setImmediate(resolve));

      expect(
        transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
      ).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Hosted Linq contact-card share skipped inside a transaction.",
        expect.objectContaining({ chatIdSuffix: expect.any(String) }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("does not delay, fail, or retry the signup reply when a replayed card share fails", async () => {
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValueOnce({
      deliveryStatus: "delivered",
      reopenOnboardingLink: null,
      restoreOnboardingLink: {
        linqChatId: "chat-1",
        memberId: "member-1",
        occurredAt: "2026-03-26T00:00:00.000Z",
        service: "iMessage",
      },
    });
    const shareControl: { reject?: (error: Error) => void } = {};
    const pendingShare = new Promise<never>((_resolve, reject) => {
      shareControl.reject = reject;
    });
    transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat.mockReturnValueOnce(
      pendingShare,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-share-fail-replayed-delivery",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).resolves.toMatchObject({ sentCount: 1 });
      expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(
          transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
        ).toHaveBeenCalledTimes(1);
      });
      const rejectShare = shareControl.reject;
      if (!rejectShare) {
        throw new Error("Expected the contact-card share to start.");
      }
      rejectShare(new Error("share failed"));

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          "Hosted Linq contact-card share failed.",
          expect.objectContaining({ operation: "share_contact_card" }),
        );
      });
      expect(
        transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
      ).toHaveBeenCalledTimes(1);
      expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not dispatch a signup link when its exact active invite is absent", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      sourceEventId: "event-deleted-member",
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture({ inviteAuthorized: false });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "invite_signup",
      }],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), "member-1");
    expect(prisma.hostedInvite.findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: "invite-1",
        member: { suspendedAt: null },
        memberId: "member-1",
      },
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.hostedInvite.findUnique.mock.invocationCallOrder[0] ?? 0);
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(prisma.hostedGroupJoinOutreach.updateMany).not.toHaveBeenCalled();
  });

  it("does not create a fallback signup chat when its exact active invite is absent", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      assignedRecipientPhone: "+15550100001",
      inviteId: "invite-1",
      memberId: "member-1",
      memberPhone: "+15551234567",
      occurredAt: "2026-03-26T12:00:00.000Z",
      sourceEventId: "event-deleted-member-fallback",
      template: "invite_signup_fallback",
    });
    const prisma = createInviteSignupPrismaFixture({ inviteAuthorized: false });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "invite_signup_fallback",
      }],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), "member-1");
    expect(prisma.hostedInvite.findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: "invite-1",
        member: { suspendedAt: null },
        memberId: "member-1",
      },
    });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.hostedInvite.findUnique.mock.invocationCallOrder[0] ?? 0);
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("rejects routed side effects when authority targets a different chat", async () => {
    const route = buildAuthorizedLinqRouteFixture({
      memberId: "member-1",
      threadId: "chat-other",
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: route.authority,
      sourceEventId: "event-contact-card-wrong-chat",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: route.prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(route.prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: route.prisma,
    });
  });

  it("rejects routed side effects when authority targets a different member", async () => {
    const route = buildAuthorizedLinqRouteFixture({
      memberId: "member-other",
      threadId: "chat-1",
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: route.authority,
      sourceEventId: "event-contact-card-wrong-member",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: route.prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(route.prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: route.prisma,
    });
  });

  it("rejects a route-less personal side effect after the chat becomes a durable group route", async () => {
    const transactionClient = {};
    const prisma = {
      $transaction: vi.fn(async (
        operation: (tx: typeof transactionClient) => Promise<unknown>,
      ) => operation(transactionClient)),
    };
    transportBoundaryMocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      channel: "linq",
      container: {},
      containerMemberId: "member-thread-container",
      owner: {},
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-stale-personal-side-effect",
      template: "daily_quota",
    });

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transportBoundaryMocks.acquireHostedLinqChatOwnershipLockTx)
      .toHaveBeenCalledWith({
        chatId: "chat-1",
        tx: transactionClient,
      });
    expect(transportBoundaryMocks.readHostedThreadRouteByThreadIdentity)
      .toHaveBeenCalledWith({
        channel: "linq",
        prisma: transactionClient,
        threadId: "chat-1",
    });
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("yields a stable effect id for repeat wrong-chat inbounds and a fresh id when the home line changes", () => {
    const baseInput = {
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      template: "conversation_home_redirect" as const,
    };

    const firstRedirect = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
    });
    const secondRedirectSameHome = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      replyToMessageId: "message-2",
      sourceEventId: "event-2",
    });
    const redirectAfterHomeLineChange = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      homeRecipientPhone: "+15555550200",
      replyToMessageId: "message-3",
      sourceEventId: "event-3",
    });

    expect(firstRedirect.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
    expect(secondRedirectSameHome.effectId).toBe(firstRedirect.effectId);
    expect(redirectAfterHomeLineChange.effectId).not.toBe(firstRedirect.effectId);
    expect(redirectAfterHomeLineChange.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
  });

  it("keeps the redirect effect id stable when the contact-privacy keyring rotates", () => {
    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: HOME_REDIRECT_TEST_KEYRING_ENTRIES,
    });
    let firstRedirect;
    try {
      firstRedirect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-1",
        homeRecipientPhone: "+15555550100",
        memberId: "member-1",
        replyToMessageId: "message-1",
        sourceEventId: "event-1",
        template: "conversation_home_redirect",
      });
    } finally {
      restoreV1();
    }

    const restoreV2 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: HOME_REDIRECT_TEST_KEYRING_ENTRIES,
    });
    let secondRedirect;
    try {
      secondRedirect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-1",
        homeRecipientPhone: "+15555550100",
        memberId: "member-1",
        replyToMessageId: "message-2",
        sourceEventId: "event-2",
        template: "conversation_home_redirect",
      });
    } finally {
      restoreV2();
    }

    expect(secondRedirect.effectId).toBe(firstRedirect.effectId);
  });

  it("waits for the durable provider-dispatch fence before sending", async () => {
    let releaseDispatchFence!: () => void;
    vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseDispatchFence = () => resolve({
          claimed: true,
          id: "hld_123",
        });
      }),
    );
    const prisma = {};
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    const drainPromise = drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    });

    await vi.waitFor(() => {
      expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalled();
    });
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();

    releaseDispatchFence();
    await drainPromise;
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: effect.effectId,
        message: "daily-quota",
      }),
    );
    await vi.waitFor(() => {
      expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: effect.effectId,
          linqChatId: "chat-1",
          messageId: "provider-message-1",
        }),
      );
    });
  });

  it("delivers legacy invite_signin side effects as invite signup replies", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "legacy-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const effect = {
      effectId: "linq-message:event-legacy",
      payload: {
        chatId: "chat-1",
        inviteId: "invite-1",
        replyToMessageId: "message-1",
        template: "invite_signin",
      },
    } as const;

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: effect.effectId,
        message: "invite-reply",
        replyToMessageId: "message-1",
      }),
    );
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      data: {
        sentAt: expect.any(Date),
      },
      where: {
        id: "invite-1",
      },
    });
    expect(claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
  });

  it("starts AI usage quota replies through the delivery row before provider send", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      periodStart: "2026-03-01T00:00:00.000Z",
      usageCreditLedgerVersion: 0n,
    });

    expect(effect.effectId).toBe(expectedIdempotencyKey);
    expect(effect.payload).toMatchObject({
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: "ai-usage-attempt:hld_usage_notice",
        message: "usage-limit",
        replyToMessageId: "message-1",
      }),
    );
    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith(expect.objectContaining({
      assertDispatchAuthority: expect.any(Function),
      attemptedAt: new Date("2026-03-26T12:00:01.000Z"),
      memberId: "member-1",
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "message-1",
        routeAuthority: null,
        target: "chat-1",
      },
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      prisma: usagePrisma,
      source: "hosted_webhook_side_effect",
      sourceRef: "event-ai-usage",
      targetKind: "thread",
      usageCreditLedgerVersion: 0n,
    }));
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    const [configValidationOrder] = vi.mocked(requireHostedOnboardingLinqConfig)
      .mock.invocationCallOrder;
    const [dispatchStartedOrder] = vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mock.invocationCallOrder;
    const [providerSendOrder] = vi.mocked(sendHostedLinqChatMessage)
      .mock.invocationCallOrder;
    expect(configValidationOrder).toBeDefined();
    expect(dispatchStartedOrder).toBeDefined();
    expect(providerSendOrder).toBeDefined();
    expect(Number(configValidationOrder)).toBeLessThan(Number(dispatchStartedOrder));
    expect(Number(dispatchStartedOrder)).toBeLessThan(Number(providerSendOrder));
    expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith({
      idempotencyKey: expectedIdempotencyKey,
      linqChatId: "chat-1",
      messageId: "provider-message-1",
      prisma: expect.anything(),
    });
    expect(claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
    expect(
      transportBoundaryMocks.shareMurphHostedLinqNativeContactCardToChat,
    ).not.toHaveBeenCalled();
  });

  it("consumes legacy persisted AI usage claims without a ledger version as epoch zero", async () => {
    const effect = {
      effectId: buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: "member-1",
        periodStart: "2026-03-01T00:00:00.000Z",
        usageCreditLedgerVersion: 0n,
      }),
      payload: {
        chatId: "chat-1",
        claimToken: {
          periodStart: "2026-03-01T00:00:00.000Z",
          sentAt: "2026-03-26T12:00:01.000Z",
        },
        memberId: "member-1",
        message: "usage-limit",
        noticeCode: "pulse_upgrade_edge" as const,
        occurredAt: "2026-03-26T12:00:00.000Z",
        replyToMessageId: "message-1",
        sourceEventId: "event-ai-usage-legacy",
        template: "ai_usage_quota" as const,
      },
    };

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: usagePrisma as never,
      sideEffects: [effect],
    })).resolves.toEqual({ sentCount: 1, skipped: [] });

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: "event-ai-usage-legacy",
        usageCreditLedgerVersion: 0n,
      }),
    );
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
  });

  it("rejects malformed present ledger versions in persisted AI usage claims", async () => {
    const effect = {
      effectId: "ai-usage-gate:legacy-persisted-effect",
      payload: {
        chatId: "chat-1",
        claimToken: {
          periodStart: "2026-03-01T00:00:00.000Z",
          sentAt: "2026-03-26T12:00:01.000Z",
          usageCreditLedgerVersion: "01",
        },
        memberId: "member-1",
        message: "usage-limit",
        noticeCode: "pulse_upgrade_edge" as const,
        occurredAt: "2026-03-26T12:00:00.000Z",
        replyToMessageId: "message-1",
        sourceEventId: "event-ai-usage-malformed",
        template: "ai_usage_quota" as const,
      },
    };

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: usagePrisma as never,
      sideEffects: [effect],
    })).rejects.toThrow(
      "Hosted AI usage-limit claim ledger version must be a non-negative integer.",
    );

    expect(startHostedAiUsageLimitNoticeDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("validates route authority before starting an AI usage quota dispatch", async () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: {
        accountLookupKey: createHostedPhoneLookupKey("+15550000000"),
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "another-chat",
      },
      sourceEventId: "event-ai-usage-first",
      template: "ai_usage_quota",
    });

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: usagePrisma as never,
      sideEffects: [firstEffect],
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledOnce();
    expect(requireHostedOnboardingLinqConfig).toHaveBeenCalledOnce();
    expect(recordHostedLinqDeliveryAttemptTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();

    const retryEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:16:00.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:16:00.000Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-ai-usage-retry",
      template: "ai_usage_quota",
    });

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: usagePrisma as never,
      sideEffects: [retryEffect],
    })).resolves.toBeDefined();

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
  });

  it("keeps AI usage quota delivery provider-correlated when accepted persistence fails after send", async () => {
    const acceptedError = new Error("acceptance write failed");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(markHostedLinqDeliveryAcceptedTx)
      .mockRejectedValueOnce(acceptedError);
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      periodStart: "2026-03-01T00:00:00.000Z",
      usageCreditLedgerVersion: 0n,
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: usagePrisma as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("acceptance write failed");
    } finally {
      warnSpy.mockRestore();
    }

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledWith({
      idempotencyKey: expectedIdempotencyKey,
      linqChatId: "chat-1",
      messageId: "provider-message-1",
      prisma: expect.anything(),
    });
    const [dispatchStartedOrder] = vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mock.invocationCallOrder;
    const [providerSendOrder] = vi.mocked(sendHostedLinqChatMessage)
      .mock.invocationCallOrder;
    const [acceptedOrder] = vi.mocked(markHostedLinqDeliveryAcceptedTx)
      .mock.invocationCallOrder;
    expect(Number(dispatchStartedOrder)).toBeLessThan(Number(providerSendOrder));
    expect(Number(providerSendOrder)).toBeLessThan(Number(acceptedOrder));
  });

  it("skips already-claimed AI usage quota replies before provider dispatch", async () => {
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockResolvedValueOnce({ status: "already_notified" });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("treats a fresh current AI usage quota delivery row as in-flight", async () => {
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockResolvedValueOnce({ status: "in_flight" });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [
        {
          effectId: effect.effectId,
          reason: "notice_in_flight",
          template: "ai_usage_quota",
        },
      ],
    });

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("treats terminal Telegram usage quota failures as already owned", async () => {
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockResolvedValueOnce({ status: "already_notified" });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [
        {
          effectId: effect.effectId,
          reason: "notice_already_claimed",
          template: "ai_usage_quota",
        },
      ],
    });

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("skips AI usage quota replies already delivered under the current delivery key", async () => {
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockResolvedValueOnce({ status: "already_notified" });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [
        {
          effectId: effect.effectId,
          reason: "notice_already_claimed",
          template: "ai_usage_quota",
        },
      ],
    });

    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
  });

  it("sends AI usage quota replies from the delivery row", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 1,
      skipped: [],
    });

    expect(startHostedAiUsageLimitNoticeDispatchTx).toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).toHaveBeenCalled();
    expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalled();
  });

  it("keys AI usage quota replies by capacity epoch across crossing and gate retries", () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-1",
      template: "ai_usage_quota",
    });
    const secondEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:30:01.000Z",
        usageCreditLedgerVersion: "2",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "edge_usage_limit_reached",
      occurredAt: "2026-03-26T12:30:00.000Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-ai-usage-2",
      template: "ai_usage_quota",
    });
    const firstIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      usageCreditLedgerVersion: 0n,
    });
    const firstRetryEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:01:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:01:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-gate-retry",
      template: "ai_usage_quota",
    });
    const secondIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      usageCreditLedgerVersion: 2n,
    });

    expect(firstEffect.effectId).toBe(firstIdempotencyKey);
    expect(firstRetryEffect.effectId).toBe(firstIdempotencyKey);
    expect(secondEffect.effectId).toBe(secondIdempotencyKey);
    expect(secondEffect.effectId).not.toBe(firstEffect.effectId);
    expect(firstEffect.payload).toMatchObject({
      sourceEventId: "event-ai-usage-1",
    });
    expect(firstRetryEffect.payload).toMatchObject({
      sourceEventId: "event-ai-usage-gate-retry",
    });
    expect(secondEffect.payload).toMatchObject({
      sourceEventId: "event-ai-usage-2",
    });
  });

  it("keys invite signup replies by member/day notice identity", () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-invite-1",
      template: "invite_signup",
    });
    const sameDayEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T23:59:59.000Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-invite-2",
      template: "invite_signup",
    });
    const laterEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-27T12:00:00.000Z",
      replyToMessageId: "message-3",
      sourceEventId: "event-invite-3",
      template: "invite_signup",
    });

    expect(firstEffect.effectId).toBe("linq-invite-signup:member-1:2026-03-26T00:00:00.000Z");
    expect(sameDayEffect.effectId).toBe(firstEffect.effectId);
    expect(laterEffect.effectId).toBe("linq-invite-signup:member-1:2026-03-27T00:00:00.000Z");
  });

  it("creates fallback signup chats without thread-authority delivery", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      assignedRecipientPhone: "+15550100001",
      inviteId: "invite-1",
      memberId: "member-1",
      memberPhone: "+15551234567",
      occurredAt: "2026-03-26T12:00:00.000Z",
      sourceEventId: "event-fallback-invite",
      template: "invite_signup_fallback",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(expect.objectContaining({
      attemptedAt: expect.any(Date),
      idempotencyKey: effect.effectId,
      phoneNumber: "+15550100001",
      prisma,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: buildHostedLinqInviteSignupDeliverySourceRef({
        effectId: effect.effectId,
      }),
      status: "attempted",
      targetKind: "participant",
      template: "invite_signup_fallback",
    }));
    expect(createHostedLinqChat).toHaveBeenCalledWith({
      from: "+15550100001",
      idempotencyKey: effect.effectId,
      message: "invite-reply",
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
  });

  it("does not release usage-period sent markers when AI usage quota delivery fails", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("send failed");

    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date("2026-03-26T12:00:01.000Z"),
      failureCode: "linq_usage_limit_dispatch_retryable",
      idempotencyKey: effect.effectId,
      prisma: usagePrisma,
    });
    expect(releaseHostedLinqQuotaReplyNoticeClaim).not.toHaveBeenCalled();
  });

  it("does not release AI usage quota notice claims when no claim token was captured", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: null,
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "trial_conversion_pending",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-unclaimed",
      template: "ai_usage_quota",
    });

    expect(effect.effectId).toBe("linq-message:event-ai-usage-unclaimed");

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("send failed");

    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: effect.effectId,
        linqChatId: "chat-1",
        status: "provider_dispatch_started",
      }),
    );
    expect(startHostedAiUsageLimitNoticeDispatchTx).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).not.toHaveBeenCalled();
  });

  it("replays trial-conversion notices through provider idempotency", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: null,
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "trial_conversion_pending",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-unclaimed",
      template: "ai_usage_quota",
    });

    await drainHostedLinqSideEffectsDirect({
      prisma: {} as never,
      sideEffects: [effect],
    });
    await drainHostedLinqSideEffectsDirect({
      prisma: {} as never,
      sideEffects: [effect],
    });

    expect(startHostedAiUsageLimitNoticeDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: effect.effectId }),
    );
  });

  it("requires claim tokens when constructing AI usage-limit quota side effects", () => {
    expect(() => createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: null,
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-missing-claim",
      template: "ai_usage_quota",
    } as never)).toThrow("require AI usage claim metadata");
  });

  it("rejects claim tokens when constructing trial conversion quota side effects", () => {
    expect(() => createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "trial_conversion_pending",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-extra-claim",
      template: "ai_usage_quota",
    } as never)).toThrow("must not include AI usage claim metadata");
  });

  it("logs safe structured Linq side-effect details when delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValue(Object.assign(
      new Error("send failed"),
      {
        code: "LINQ_SEND_FAILED",
        details: {
          failureStage: "http",
          status: 502,
        },
        retryable: true,
      },
    ));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: {} as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("send failed");

      expect(errorSpy).toHaveBeenCalledWith(
        "Hosted Linq side-effect delivery failed.",
        expect.objectContaining({
          effectIdSuffix: "vent-1",
          failureStage: "http",
          hasIdempotencyKey: true,
          hasReplyToMessageId: true,
          operation: "send_message",
          provider: "linq",
          errorMessage: "send failed",
          retryable: true,
          status: 502,
          template: "daily_quota",
        }),
      );
      expect(claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
        memberId: "member-1",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma: {},
      });
      expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
        memberId: "member-1",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma: {},
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("revalidates routed daily quota replies before provider delivery", async () => {
    const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!accountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-group-1",
      dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: {
        accountLookupKey,
        channel: "linq",
        containerMemberId: "member-thread-container-1",
        threadId: "chat-group-1",
      },
      sourceEventId: "event-route-daily-quota",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
  });

  it("revalidates routed replies before provider delivery", async () => {
    const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!accountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockResolvedValue({ id: "hld_route_current" }),
      },
      hostedLinqProviderEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-group-1",
      dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: {
        accountLookupKey,
        channel: "linq",
        containerMemberId: "member-thread-container-1",
        threadId: "chat-group-1",
      },
      sourceEventId: "event-route-current-daily-quota",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
  });

  it("rejects routed replies when authority names a different Linq chat", async () => {
    const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!accountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockResolvedValue({ id: "hld_route_mismatch" }),
      },
      hostedLinqProviderEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-group-b",
      dailyTextLimit: HOSTED_LINQ_GROUP_DAILY_TEXT_LIMIT,
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: {
        accountLookupKey,
        channel: "linq",
        containerMemberId: "member-thread-container-1",
        threadId: "chat-group-a",
      },
      sourceEventId: "event-route-mismatch-daily-quota",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-thread-container-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
  });

  it("logs claimed AI usage quota source event suffixes separately from period-scoped effect ids", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(Object.assign(
      new Error("send failed"),
      {
        code: "LINQ_SEND_FAILED",
        retryable: true,
      },
    ));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-source-123456",
      template: "ai_usage_quota",
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: usagePrisma as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("send failed");

      expect(errorSpy).toHaveBeenCalledWith(
        "Hosted Linq side-effect delivery failed.",
        expect.objectContaining({
          effectIdSuffix: effect.effectId.slice(-6),
          sourceEventIdSuffix: "123456",
          template: "ai_usage_quota",
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("claims daily quota notices before delivery and skips already-claimed notices", async () => {
    vi.mocked(claimHostedLinqQuotaReplyNotice).mockResolvedValueOnce(false);
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: {},
    });
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not mark invite signup notices sent when delivery fails", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("send failed");

    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(expect.objectContaining({
      attemptedAt: expect.any(Date),
      idempotencyKey: effect.effectId,
      linqChatId: "chat-1",
      prisma,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_webhook_side_effect",
      sourceRef: buildHostedLinqInviteSignupDeliverySourceRef({
        effectId: effect.effectId,
      }),
      status: "attempted",
      targetKind: "thread",
      template: "invite_signup",
    }));
    expect(claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(markHostedLinqOnboardingLinkNoticeSent).not.toHaveBeenCalled();
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });

  it("fails invite signup delivery rows before throwing so webhook retries can send", async () => {
    const scheduledTasks: Array<() => Promise<void>> = [];
    let providerDispatchFailed = false;
    let providerDispatchAttempted = false;
    vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockImplementation(async () => {
      if (providerDispatchAttempted && !providerDispatchFailed) {
        return {
          claimed: false,
          id: "hld_claimed",
        };
      }

      providerDispatchAttempted = true;
      providerDispatchFailed = false;
      return {
        claimed: true,
        id: "hld_claimed",
      };
    });
    vi.mocked(sendHostedLinqChatMessage)
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce({
        chatId: "chat-1",
        messageId: "provider-message-retry",
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqDelivery: {
        create: vi.fn().mockResolvedValue({ id: "hld_claimed" }),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockImplementation((input: { data?: { status?: string } }) => {
          if (input.data?.status === "failed") {
            providerDispatchFailed = true;
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      hostedLinqProviderEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          scheduleAfterResponse: (task) => {
            scheduledTasks.push(task);
          },
          sideEffects: [effect],
        }),
      ).rejects.toThrow("send failed");

      expect(providerDispatchFailed).toBe(true);
      expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "failed",
          }),
          where: expect.objectContaining({
            idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId),
          }),
        }),
      );
      expect(scheduledTasks).toHaveLength(0);

      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          scheduleAfterResponse: (task) => {
            scheduledTasks.push(task);
          },
          sideEffects: [effect],
        }),
      ).resolves.toBeDefined();

      expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
      expect(sendHostedLinqChatMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          idempotencyKey: effect.effectId,
          message: "invite-reply",
        }),
      );
      expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
        data: {
          sentAt: expect.any(Date),
        },
        where: {
          id: "invite-1",
        },
      });
    } finally {
      errorSpy.mockRestore();
      vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockResolvedValue({
        claimed: true,
        id: "hld_claimed",
      });
    }
  });
});

function buildAuthorizedLinqRouteFixture(input: {
  memberId: string;
  threadId: string;
}) {
  const accountLookupKey = createHostedPhoneLookupKey("+15550000000");
  if (!accountLookupKey) {
    throw new Error("Expected test account lookup key.");
  }
  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey,
    channel: "linq",
    threadId: input.threadId,
  });
  if (!threadLookupKey) {
    throw new Error("Expected test thread lookup key.");
  }
  const memberState = {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-03-26T00:00:00.000Z"),
    id: input.memberId,
    suspendedAt: null,
    updatedAt: new Date("2026-03-26T00:00:00.000Z"),
  };
  const memberAccessState = {
    ...memberState,
    accountGroupMemberships: [],
  };

  return {
    authority: {
      accountLookupKey,
      channel: "linq" as const,
      containerMemberId: input.memberId,
      threadId: input.threadId,
    },
    prisma: {
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValueOnce([
          {
            channel: "linq",
            container: {
              member: memberState,
              owner: memberAccessState,
            },
            containerMemberId: input.memberId,
            threadLookupKey,
          },
        ]),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          ...memberAccessState,
          threadContainer: {
            owner: memberAccessState,
          },
        }),
      },
      hostedThreadContainerParticipant: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  };
}

function createInviteSignupPrismaFixture(
  input: {
    groupJoinCode?: string;
    groupReplyAuthorized?: boolean;
    inviteAuthorized?: boolean;
  } = {},
) {
  const transactionClient = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
    hostedInvite: {
      findUnique: vi.fn(async (query: { select?: { id?: boolean } }) =>
        query.select?.id
          ? input.inviteAuthorized === false ? null : { id: "invite-1" }
          : { inviteCode: "invite-code" }
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    hostedGroupJoinOutreach: {
      findUnique: vi.fn().mockResolvedValue(
        input.groupReplyAuthorized === false
          ? null
          : {
              groupId: "group-1",
              offerId: "offer-1",
              repliedAt: null,
              sentAt: new Date("2026-03-26T11:00:00.000Z"),
              skippedAt: null,
            },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedGroupJoinOffer: {
      findUnique: vi.fn().mockResolvedValue({
        groupId: "group-1",
        revokedAt: null,
        group: {
          joinCode: input.groupJoinCode ?? "join-group",
          runtimeMember: { suspendedAt: null },
          runtimeMemberId: "member-runtime",
        },
      }),
    },
  };
  return {
    ...transactionClient,
    $transaction: vi.fn(async (
      operation: (prisma: typeof transactionClient) => Promise<unknown>,
    ) => operation(transactionClient)),
  };
}

const HOME_REDIRECT_TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
