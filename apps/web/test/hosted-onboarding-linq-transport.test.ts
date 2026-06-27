import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberHomeLinqRoute: vi.fn(),
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
import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
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
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
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
        currentInboundReply,
        prisma: {} as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

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

  it("does not block current inbound replies on delivery-attempt recording", async () => {
    let releaseAttempt!: () => void;
    const attemptPromise = new Promise<{ id: string }>((resolve) => {
      releaseAttempt = () => resolve({ id: "hld_123" });
    });
    const prisma = {
      hostedLinqDelivery: {
        create: vi.fn(() => attemptPromise),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqProviderEvent: {
        findMany: vi.fn().mockResolvedValue([]),
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
      expect(prisma.hostedLinqDelivery.create).toHaveBeenCalled();
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
            failedAt: null,
            failureCode: null,
            failureReason: null,
            status: "accepted",
          }),
          where: expect.objectContaining({
            deliveredAt: null,
            idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId),
            lastReceiptAt: null,
            skippedAt: null,
          }),
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

  it("releases AI usage quota notice claims when the egress guard skips delivery", async () => {
    const chatLookupKey = createHostedLinqChatLookupKey("chat-1");
    if (!chatLookupKey) {
      throw new Error("Expected test Linq chat lookup key.");
    }
    const prisma = {
      hostedLinqDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          acceptedAt: null,
          deliveredAt: null,
          failedAt: null,
          id: "hld_ai_usage_skip",
          lastReceiptAt: null,
          messageLookupKey: null,
          skippedAt: null,
          status: "attempted",
        }),
        update: vi.fn().mockResolvedValue({ id: "hld_ai_usage_skip" }),
        upsert: vi.fn().mockResolvedValue({ id: "hld_ai_usage_skip" }),
      },
      hostedLinqLine: {
        upsert: vi.fn().mockImplementation((input: { create: { phoneNumberLookupKey: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.create.phoneNumberLookupKey,
          })),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation((input: { where?: { phoneNumberLookupKey?: string } }) =>
          Promise.resolve({
            phoneNumberLookupKey: input.where?.phoneNumberLookupKey ?? "hbidx:phone:updated",
          })),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          linqChatLookupKey: chatLookupKey,
          linqLastInboundAt: new Date("2026-02-01T12:00:00.000Z"),
          linqRecipientPhoneLookupKey: null,
          pendingLinqChatLookupKey: null,
          pendingLinqLastInboundAt: null,
          pendingLinqRecipientPhoneLookupKey: null,
        }),
      },
    };
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
      sourceEventId: "event-ai-usage-skip",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeUndefined();

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(releaseHostedAiUsageLimitNotice).toHaveBeenCalledWith({
      memberId: "member-1",
      periodStart: "2026-03-01T00:00:00.000Z",
      prisma,
      sentAt: "2026-03-26T12:00:01.000Z",
    });
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

  it("revalidates current-inbound routed replies before provider delivery", async () => {
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
        currentInboundReply: {
          chatId: "chat-group-1",
          messageId: "message-1",
        },
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

  it("rejects current-inbound routed replies when authority names a different Linq chat", async () => {
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
        currentInboundReply: {
          chatId: "chat-group-b",
          messageId: "message-1",
        },
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
