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
  sendHostedLinqChatMessage: vi.fn().mockResolvedValue({
    chatId: "chat-1",
    messageId: "provider-message-1",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  claimHostedLinqOnboardingLinkNotice: vi.fn().mockResolvedValue(true),
  claimHostedLinqQuotaReplyNotice: vi.fn().mockResolvedValue(true),
  releaseHostedLinqOnboardingLinkNoticeClaim: vi.fn().mockResolvedValue(undefined),
  releaseHostedLinqQuotaReplyNoticeClaim: vi.fn().mockResolvedValue(undefined),
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
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";

describe("hosted Linq webhook transport", () => {
  const currentInboundReply = {
    chatId: "chat-1",
    messageId: "message-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
        currentInboundReply,
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

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

  it("does not block current inbound replies on delivery-attempt recording", async () => {
    let releaseAttempt!: () => void;
    const attemptPromise = new Promise<{ id: string }>((resolve) => {
      releaseAttempt = () => resolve({ id: "hld_123" });
    });
    const prisma = {
      hostedLinqDelivery: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn(() => attemptPromise),
      },
      hostedLinqProviderEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    let drainResolved = false;
    const drainPromise = drainHostedLinqSideEffectsDirect({
      currentInboundReply,
      prisma: prisma as never,
      sideEffects: [effect],
    }).then(() => {
      drainResolved = true;
    });

    await vi.waitFor(() => {
      expect(prisma.hostedLinqDelivery.upsert).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: effect.effectId,
          message: "daily-quota",
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drainResolved).toBe(true);
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();

    releaseAttempt();
    await drainPromise;
    await vi.waitFor(() => {
      expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "accepted",
          }),
          where: expect.objectContaining({
            deliveredAt: null,
            failedAt: null,
            idempotencyKey: effect.effectId,
            skippedAt: null,
          }),
        }),
      );
    });
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
        currentInboundReply,
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(buildHostedLinqConversationHomeRedirectReply).toHaveBeenCalledWith(expect.objectContaining({
      homeRecipientPhone: "+15555550200",
    }));
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
        currentInboundReply,
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
        currentInboundReply,
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
        currentInboundReply,
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
        currentInboundReply,
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
          currentInboundReply,
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
          currentInboundReply,
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

  it("releases invite signup notice claims when delivery fails", async () => {
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(new Error("send failed"));
    const prisma = {
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
        currentInboundReply,
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow("send failed");

    expect(claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });
});
