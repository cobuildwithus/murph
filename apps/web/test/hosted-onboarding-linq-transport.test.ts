import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus } from "@prisma/client";

const transportBoundaryMocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    transportBoundaryMocks.acquireHostedLinqChatOwnershipLockTx,
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

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card-share", () => ({
  maybeShareHostedLinqContactCardAfterOutboundForRuntime: vi.fn().mockResolvedValue({
    action: "skip",
    reason: "recent_attempt",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: vi.fn(() => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  })),
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
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    }),
    markHostedLinqDeliverySendFailedTx: vi.fn(actual.markHostedLinqDeliverySendFailedTx),
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
      async (input: { memberId: string; periodStart: Date }) => ({
        idempotencyKey: actual.buildHostedAiUsageGateNoticeIdempotencyKey(input),
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
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  markHostedLinqOnboardingLinkNoticeSent,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";
import {
  maybeShareHostedLinqContactCardAfterOutboundForRuntime,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx as startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
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
    vi.mocked(startHostedAiUsageLimitNoticeDispatchTx)
      .mockImplementation(async (input) => {
        await input.prisma.$transaction(async (prisma) => {
          await input.assertDispatchAuthority?.(prisma);
        });
        return {
          idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey(input),
          status: "claimed",
        };
      });
    vi.mocked(markHostedLinqDeliveryAcceptedTx).mockResolvedValue({
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

  it("shares the contact card after an eligible invite-signup side effect", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).toHaveBeenCalledWith({
      boundUserId: "member-1",
      chatId: "chat-1",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      prisma,
      signal: undefined,
    });
  });

  it("does not dispatch a signup link when its exact active invite is absent", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
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

  it("does not share the contact card after a quota side effect with validated route authority", async () => {
    const route = buildAuthorizedLinqRouteFixture({
      memberId: "member-1",
      threadId: "chat-1",
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      routeAuthority: route.authority,
      sourceEventId: "event-contact-card-authorized",
      template: "daily_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: route.prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).not.toHaveBeenCalled();
  });

  it("does not wait for contact-card sharing before completing side-effect delivery", async () => {
    vi.mocked(maybeShareHostedLinqContactCardAfterOutboundForRuntime)
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-detached",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toBeDefined();

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).toHaveBeenCalledTimes(1);
  });

  it("rejects routed side effects when authority targets a different chat", async () => {
    const route = buildAuthorizedLinqRouteFixture({
      memberId: "member-1",
      threadId: "chat-other",
    });
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
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
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).not.toHaveBeenCalled();
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
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).not.toHaveBeenCalled();
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

  it("does not let contact-card share failures release successful notice claims", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(maybeShareHostedLinqContactCardAfterOutboundForRuntime)
      .mockRejectedValueOnce(new Error("share failed"));
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "iMessage",
      sourceEventId: "event-contact-card-fail",
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
      ).resolves.toBeDefined();

      expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
      expect(releaseHostedLinqQuotaReplyNoticeClaim).not.toHaveBeenCalled();
      expect(releaseHostedLinqOnboardingLinkNoticeClaim).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          "Hosted Linq contact-card side-effect share failed.",
          expect.objectContaining({
            chatIdSuffix: "chat-1",
            errorMessage: "share failed",
            operation: "share_contact_card",
            provider: "linq",
            template: "invite_signup",
          }),
        );
      });
    } finally {
      warnSpy.mockRestore();
    }
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
        idempotencyKey: expectedIdempotencyKey,
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
      sourceRef: expectedIdempotencyKey,
      targetKind: "thread",
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
    expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime).not.toHaveBeenCalled();
    expect(claimHostedLinqQuotaReplyNotice).not.toHaveBeenCalled();
  });

  it("validates route authority before starting an AI usage quota dispatch", async () => {
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

  it("keeps claimed AI usage quota replies period-scoped across source events and notice codes", () => {
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
      noticeCode: "edge_usage_limit_reached",
      occurredAt: "2026-03-26T12:30:00.000Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-ai-usage-2",
      template: "ai_usage_quota",
    });
    const expectedIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
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
      source: "hosted_webhook_side_effect",
      sourceRef: effect.effectId,
      status: "provider_dispatch_started",
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
      source: "hosted_webhook_side_effect",
      sourceRef: effect.effectId,
      status: "provider_dispatch_started",
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
  input: { inviteAuthorized?: boolean } = {},
) {
  const transactionClient = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
    hostedInvite: {
      findUnique: vi.fn(async (query: { select?: { id?: boolean } }) =>
        query.select?.id
          ? input.inviteAuthorized === false ? null : { id: "invite-1" }
          : { inviteCode: "invite-code" }
      ),
      update: vi.fn().mockResolvedValue({}),
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
