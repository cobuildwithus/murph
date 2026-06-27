import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberHomeLinqRoute: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) => `https://join.test/${inviteCode}`),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  buildHostedDailyQuotaReply: vi.fn(() => "daily-quota"),
  buildHostedInviteReply: vi.fn(() => "invite-reply"),
  buildHostedLinqConversationHomeRedirectReply: vi.fn(({ homeRecipientPhone }: { homeRecipientPhone: string }) => `redirect:${homeRecipientPhone}`),
  sendHostedLinqChatMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  claimHostedLinqOnboardingLinkNotice: vi.fn().mockResolvedValue(true),
  claimHostedLinqQuotaReplyNotice: vi.fn().mockResolvedValue(true),
  readHostedLinqDailyState: vi.fn(),
  releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn().mockResolvedValue(undefined),
  releaseHostedLinqQuotaReplyNoticeClaim: vi.fn().mockResolvedValue(undefined),
  resolveHostedLinqDayUtc: vi.fn((value: Date | string) => {
    const occurredAt = value instanceof Date ? value : new Date(value);

    return new Date(Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth(),
      occurredAt.getUTCDate(),
    ));
  }),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >("@/src/lib/hosted-execution/usage-allowance");
  return {
    ...actual,
    claimHostedAiUsageLimitNotice: vi.fn().mockResolvedValue(true),
    releaseHostedAiUsageLimitNotice: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  releaseHostedAiUsageLimitNotice,
} from "@/src/lib/hosted-execution/usage-allowance";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  readHostedLinqDailyState,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";

describe("hosted Linq webhook transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendHostedLinqChatMessage).mockResolvedValue(undefined);
  });

  it("keys signup-link side effects by member, UTC day, and invite", () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });
    const sameDayEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T23:59:59.000Z",
      processingOwnerToken: "owner-2",
      replyToMessageId: "message-2",
      sourceEventId: "event-2",
      template: "invite_signup",
    });
    const nextDayEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-27T00:00:00.000Z",
      processingOwnerToken: "owner-3",
      replyToMessageId: "message-3",
      sourceEventId: "event-3",
      template: "invite_signup",
    });

    expect(firstEffect.effectId).toBe("linq-invite-signup:member-1:2026-03-26:invite-1");
    expect(sameDayEffect.effectId).toBe(firstEffect.effectId);
    expect(nextDayEffect.effectId).toBe("linq-invite-signup:member-1:2026-03-27:invite-1");
  });

  it("uses the stored redirect phone fallback when current routing is unavailable", async () => {
    vi.mocked(readHostedMemberRoutingState).mockResolvedValue(null);
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
    ).resolves.toBeUndefined();

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith({
      homeRecipientPhone: "+15555550100",
    });
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: effect.effectId,
        message: "redirect:+15555550100",
        replyToMessageId: "message-1",
      }),
    );
  });

  it("prefers the latest routing phone over the stored redirect fallback", async () => {
    vi.mocked(readHostedMemberRoutingState).mockResolvedValue({
      linqChatId: "home-chat-1",
      linqRecipientPhone: "+15555550200",
      memberId: "member-1",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });
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
    ).resolves.toBeUndefined();

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith({
      homeRecipientPhone: "+15555550200",
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
    ).resolves.toBeUndefined();

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

  it("does not mark the daily quota notice when sending an AI usage quota reply", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
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
      noticeCode: "pulse_upgrade_edge",
      periodStart: "2026-03-01T00:00:00.000Z",
    });

    expect(effect.effectId).toBe(expectedIdempotencyKey);
    expect(effect.payload).toMatchObject({
      sourceEventId: "event-ai-usage",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        idempotencyKey: expectedIdempotencyKey,
        message: "usage-limit",
        replyToMessageId: "message-1",
      }),
    );
    expect(claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
  });

  it("keeps claimed AI usage quota replies period-scoped across source events", () => {
    const firstEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
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
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:30:00.000Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-ai-usage-2",
      template: "ai_usage_quota",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      noticeCode: "pulse_upgrade_edge",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(firstEffect.effectId).toBe(expectedIdempotencyKey);
    expect(secondEffect.effectId).toBe(expectedIdempotencyKey);
    expect(firstEffect.payload).toMatchObject({
      sourceEventId: "event-ai-usage-1",
    });
    expect(secondEffect.payload).toMatchObject({
      sourceEventId: "event-ai-usage-2",
    });
  });

  it("releases AI usage quota notice claims when delivery fails", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
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
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("send failed");

    expect(releaseHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma: {},
      sentAt: "2026-03-26T12:00:01.000Z",
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

    expect(releaseHostedAiUsageLimitNotice).not.toHaveBeenCalled();
    expect(releaseHostedLinqQuotaReplyNoticeClaim).not.toHaveBeenCalled();
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
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-group-1",
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
          prisma: {} as never,
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
    ).resolves.toBeUndefined();

    expect(claimHostedLinqQuotaReplyNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: {},
    });
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("consumes invite signup effects without sending when another request already delivered them", async () => {
    vi.mocked(claimHostedLinqOnboardingLinkNotice).mockResolvedValueOnce(false);
    vi.mocked(readHostedLinqDailyState).mockResolvedValueOnce({
      onboardingLinkSentAt: new Date("2026-03-26T12:00:00.500Z"),
    } as never);
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
      },
      hostedLinqFirstContactEventReceipt: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(readHostedLinqDailyState).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(prisma.hostedLinqFirstContactEventReceipt.updateMany).toHaveBeenCalledWith({
      data: {
        processingOwnerToken: null,
        status: "consumed",
      },
      where: {
        eventId: "event-1",
        processingOwnerToken: "owner-1",
        status: "processing",
        updatedAt: {
          gte: expect.any(Date),
        },
      },
    });
  });

  it("does not consume skipped invite signup effects from stale invite delivery proof", async () => {
    vi.mocked(claimHostedLinqOnboardingLinkNotice).mockResolvedValueOnce(false);
    vi.mocked(readHostedLinqDailyState).mockResolvedValueOnce({
      onboardingLinkSentAt: new Date("2026-03-26T12:00:00.500Z"),
    } as never);
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          sentAt: new Date("2026-03-25T12:00:00.000Z"),
        }),
      },
      hostedLinqFirstContactEventReceipt: {
        updateMany: vi.fn(),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
      retryable: true,
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(prisma.hostedLinqFirstContactEventReceipt.updateMany).not.toHaveBeenCalled();
  });

  it("releases invite signup notice claims when delivery fails", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqFirstContactEventReceipt: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          eventId: "event-1",
          processingOwnerToken: "owner-1",
          status: "processing",
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
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

    expect(claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: expect.any(Date),
    });
    const claimSentAt = vi.mocked(claimHostedLinqOnboardingLinkNotice).mock.calls[0]?.[0]?.sentAt;
    expect(claimSentAt).toBeInstanceOf(Date);
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: claimSentAt,
    });
    expect(prisma.hostedLinqFirstContactEventReceipt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });

  it("keeps invite signup send fences when sentAt persistence fails after delivery", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockRejectedValueOnce(new Error("sentAt failed")),
      },
      hostedLinqFirstContactEventReceipt: {
        deleteMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          eventId: "event-1",
          processingOwnerToken: "owner-1",
          status: "processing",
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("sentAt failed");

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).not.toHaveBeenCalled();
    expect(prisma.hostedLinqFirstContactEventReceipt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqFirstContactEventReceipt.updateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps invite signup send fences when event consume fails after delivery", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviteCode: "invite-code",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqFirstContactEventReceipt: {
        deleteMany: vi.fn(),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockRejectedValueOnce(new Error("consume failed")),
        findUnique: vi.fn().mockResolvedValue({
          eventId: "event-1",
          processingOwnerToken: "owner-1",
          status: "processing",
          updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      processingOwnerToken: "owner-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "invite_signup",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("consume failed");

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).not.toHaveBeenCalled();
    expect(prisma.hostedLinqFirstContactEventReceipt.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps invite signup processing receipts when delivery cleanup cannot release the daily claim", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    vi.mocked(releaseHostedLinqOnboardingLinkNoticeClaim).mockRejectedValueOnce(new Error("release failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const prisma = {
        hostedInvite: {
          findUnique: vi.fn().mockResolvedValue({
            inviteCode: "invite-code",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        hostedLinqFirstContactEventReceipt: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            eventId: "event-1",
            processingOwnerToken: "owner-1",
            status: "processing",
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          }),
        },
      };
      const effect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-1",
        inviteId: "invite-1",
        memberId: "member-1",
        occurredAt: "2026-03-26T12:00:00.000Z",
        processingOwnerToken: "owner-1",
        replyToMessageId: "message-1",
        sourceEventId: "event-1",
        template: "invite_signup",
      });

      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).rejects.toThrow("release failed");

      expect(releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
        memberId: "member-1",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
        sentAt: vi.mocked(claimHostedLinqOnboardingLinkNotice).mock.calls[0]?.[0]?.sentAt,
      });
      expect(prisma.hostedLinqFirstContactEventReceipt.deleteMany).not.toHaveBeenCalled();
      expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
