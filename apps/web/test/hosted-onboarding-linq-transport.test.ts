import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus } from "@prisma/client";

const transportBoundaryMocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  listHostedLinqHealthyProactiveLines: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedLinqIncomingLineState: vi.fn(),
  readHostedLinqReceiptCorrelatedRecoveryLineTx: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  reserveHostedLinqHealthyProactiveLineTx: vi.fn(),
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
  acquireHostedMemberHomeLinqRouteLockTx:
    transportBoundaryMocks.acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState:
    transportBoundaryMocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    transportBoundaryMocks.lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberCoreState: vi.fn(async () => null),
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber:
    transportBoundaryMocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-home-routing", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-home-routing")
  >("@/src/lib/hosted-onboarding/linq-home-routing");
  return {
    ...actual,
    reserveHostedLinqHealthyProactiveLineTx:
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-line-store")
  >("@/src/lib/hosted-onboarding/linq-line-store");
  return {
    // The per-line daily new-conversation budget is behaviour under test here,
    // so the real claim runs against the stateful line rows in
    // createHostedLinqLineCapacityPrisma.
    claimHostedLinqProactiveConversationCapacityTx:
      actual.claimHostedLinqProactiveConversationCapacityTx,
    listHostedLinqHealthyProactiveLines:
      transportBoundaryMocks.listHostedLinqHealthyProactiveLines,
    readHostedLinqIncomingLineState:
      transportBoundaryMocks.readHostedLinqIncomingLineState,
    readHostedLinqReceiptCorrelatedRecoveryLineTx:
      transportBoundaryMocks.readHostedLinqReceiptCorrelatedRecoveryLineTx,
  };
});

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
    readHostedLinqDailyState: vi.fn().mockResolvedValue(null),
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
    readHostedLinqDeliveryProviderDispatchIntentsTx: vi.fn().mockResolvedValue([]),
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
  readHostedLinqDailyState,
  releaseHostedLinqOnboardingLinkNoticeClaim,
  releaseHostedLinqQuotaReplyNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  readHostedLinqDeliveryProviderDispatchIntentTx,
  readHostedLinqDeliveryProviderDispatchIntentsTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx as startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  buildHostedLinqGroupLineRecoveryAttemptEffectId,
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoveryMessage,
  buildHostedLinqGroupLineRecoverySourceRef,
} from "@/src/lib/hosted-onboarding/linq-group-line-recovery";
import { issueHostedLinqGroupEmailRecoveryToken } from "@/src/lib/hosted-onboarding/linq-group-setup";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";
import { requireHostedOnboardingLinqConfig } from "@/src/lib/hosted-onboarding/runtime";

const usageHostedLinqDelivery = {
  findUnique: vi.fn().mockResolvedValue({ id: "hld_usage_notice" }),
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
};
const usageHostedLinqDeliveryMessage = {
  createMany: vi.fn().mockResolvedValue({ count: 1 }),
};
const usageHostedLinqProviderEvent = {
  findMany: vi.fn().mockResolvedValue([]),
};
const usageTransactionPrisma = {
  hostedLinqDelivery: usageHostedLinqDelivery,
  hostedLinqDeliveryMessage: usageHostedLinqDeliveryMessage,
  hostedLinqProviderEvent: usageHostedLinqProviderEvent,
};
const usagePrisma = {
  $transaction: vi.fn(async (
    operation: (prisma: typeof usageTransactionPrisma) => Promise<unknown>,
  ) => operation(usageTransactionPrisma)),
  hostedLinqDelivery: usageHostedLinqDelivery,
  hostedLinqDeliveryMessage: usageHostedLinqDeliveryMessage,
  hostedLinqProviderEvent: usageHostedLinqProviderEvent,
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
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx).mockResolvedValue(
      [],
    );
    transportBoundaryMocks.acquireHostedMemberHomeLinqRouteLockTx
      .mockResolvedValue(undefined);
    transportBoundaryMocks.lookupHostedMemberIdentityByPhoneNumber
      .mockResolvedValue({ core: { id: "member-1" } });
    transportBoundaryMocks.lookupHostedMemberByVerifiedEmailAddress
      .mockResolvedValue({ core: { id: "member-1" } });
    transportBoundaryMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
      linqRecipientPhone: "+15550100000",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
    });
    const incomingLineLookupKey = createHostedPhoneLookupKey("+15550100000");
    const backupLineLookupKey = createHostedPhoneLookupKey("+15550100042");
    if (!incomingLineLookupKey || !backupLineLookupKey) {
      throw new Error("Expected hosted Linq recovery line lookup keys.");
    }
    transportBoundaryMocks.readHostedLinqIncomingLineState.mockResolvedValue({
      kind: "hard_blocked",
      phoneNumberLookupKey: incomingLineLookupKey,
    });
    transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx
      .mockResolvedValue({
        kind: "reserved",
        reservation: {
          assignedAt: new Date("2026-03-26T12:00:00.000Z"),
          line: {
            activeMemberLimit: null,
            assignmentWeight: 100,
            maxNewConversationsPerDay: null,
            phoneNumber: "+15550100042",
            phoneNumberHint: "+0042",
            phoneNumberLookupKey: backupLineLookupKey,
            proactiveConversationCount: null,
            proactiveConversationDayUtc: null,
          },
          proactiveConversationReserved: true,
        },
      });
    transportBoundaryMocks.listHostedLinqHealthyProactiveLines.mockResolvedValue([
      {
        activeMemberLimit: null,
        assignmentWeight: 100,
        maxNewConversationsPerDay: null,
        phoneNumber: "+15550100042",
        phoneNumberHint: "+0042",
        phoneNumberLookupKey: backupLineLookupKey,
        proactiveConversationCount: null,
        proactiveConversationDayUtc: null,
      },
    ]);
    transportBoundaryMocks.readHostedLinqReceiptCorrelatedRecoveryLineTx
      .mockResolvedValue({
        phoneNumber: "+15550100042",
        phoneNumberLookupKey: backupLineLookupKey,
      });
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
      occurredAt: "2026-03-26T12:00:00.000Z",
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
    expect(effect.payload).toMatchObject({
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
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

  it("commits accepted group delivery with the exact reply time before the provider fence returns", async () => {
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
    expect(claimInput).toEqual(expect.objectContaining({
      groupJoinOutreachId: "hgrpjoa-1",
      groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
      sourceRef: effect.effectId,
    }));
    expect(markHostedLinqOnboardingLinkNoticeSent).toHaveBeenCalledTimes(1);
    expect(prisma.hostedGroupJoinOutreach.updateMany).not.toHaveBeenCalled();
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

  it("leaves uncorrelated recovery provider errors in flight", async () => {
    vi.mocked(createHostedLinqChat).mockRejectedValueOnce(
      new Error("provider replay timed out"),
    );
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: "+15551234567",
      },
      sourceEventId: "event-group-line-recovery-timeout",
      template: "group_line_recovery",
      threadId: "chat-group-replay-timeout",
    });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      })).rejects.toThrow("provider replay timed out");

      expect(markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
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

  it.each(["invite_signup", "invite_signup_fallback"] as const)(
    "makes no provider call when a repeated %s partial resolves to its completed delivery row",
    async (template) => {
      vi.mocked(claimHostedLinqDeliveryProviderDispatchTx).mockResolvedValueOnce({
        claimed: false,
        id: "hld_partial_signup",
        outcome: "completed",
      });
      const effect = template === "invite_signup"
        ? createHostedWebhookLinqMessageSideEffect({
            chatId: "chat-1",
            inviteId: "invite-1",
            memberId: "member-1",
            occurredAt: "2026-03-26T12:00:00.000Z",
            replyToMessageId: "message-1",
            sourceEventId: "event-partial-replay",
            template,
          })
        : createHostedWebhookLinqMessageSideEffect({
            assignedRecipientPhone: "+15550100001",
            inviteId: "invite-1",
            memberId: "member-1",
            memberPhone: "+15551234567",
            occurredAt: "2026-03-26T12:00:00.000Z",
            sourceEventId: "event-partial-replay",
            template,
          });

      await expect(drainHostedLinqSideEffectsDirect({
        prisma: createInviteSignupPrismaFixture() as never,
        sideEffects: [effect],
      })).resolves.toEqual({
        sentCount: 0,
        skipped: [{
          effectId: effect.effectId,
          reason: "notice_already_claimed",
          template,
        }],
      });

      expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expect(createHostedLinqChat).not.toHaveBeenCalled();
    },
  );

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
      id: "hld_persisted_group_reply",
      groupJoinOutreachId: "hgrpjoa-a",
      groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
      lastProviderEventId: null,
      phoneNumberLookupKey: null,
      providerCorrelated: false,
      sourceRef: effect.effectId,
      status: "attempted",
      targetKind: "thread",
      template: "invite_signup",
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
        groupJoinOutreachId: "hgrpjoa-a",
        groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
        idempotencyKey: effect.effectId,
        sourceRef: effect.effectId,
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
    const persistedSourceRef = originalEffect.effectId;
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx)
      .mockResolvedValue({
        id: "hld_persisted_group_reply",
        groupJoinOutreachId: "hgrpjoa-a",
        groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
        lastProviderEventId: null,
        phoneNumberLookupKey: null,
        providerCorrelated: false,
        sourceRef: persistedSourceRef,
        status: "attempted",
        targetKind: "thread",
        template: "invite_signup",
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
        groupJoinOutreachId: "hgrpjoa-a",
        groupJoinReplyOccurredAt: new Date("2026-03-26T12:00:00.000Z"),
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
    expect(prisma.hostedGroupJoinOutreach.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hgrpjoa-deleted",
        }),
      }),
    );
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("retries planning when web membership appears before group-link dispatch", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      groupJoinCode: "join-group",
      groupJoinOutreachId: "hgrpjoa-web-joined",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      service: "sms",
      sourceEventId: "event-group-web-joined",
      threadIsDirect: true,
      template: "invite_signup",
    });
    const prisma = createInviteSignupPrismaFixture({
      existingGroupMembership: true,
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_GROUP_JOIN_MEMBERSHIP_CHANGED",
      retryable: true,
    });

    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not dispatch a newly planned generic link after a group link wins the member lock", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      inviteId: "invite-1",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-generic-planned-before-group-accepted",
      template: "invite_signup",
    });
    vi.mocked(readHostedLinqDailyState).mockResolvedValueOnce({
      onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
    } as never);
    const prisma = createInviteSignupPrismaFixture();

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      }),
    ).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_already_claimed",
        template: "invite_signup",
      }],
    });

    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), "member-1");
    expect(readHostedLinqDailyState).toHaveBeenCalledWith({
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: expect.any(Object),
    });
    expect(
      prisma.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(readHostedLinqDailyState).mock.invocationCallOrder[0] ?? 0,
    );
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
    expect(prisma.hostedGroupJoinOutreach.updateMany).not.toHaveBeenCalled();
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

  it("deduplicates wrong-chat redirects per UTC day and resets the next day", () => {
    const baseInput = {
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      template: "conversation_home_redirect" as const,
    };

    const firstRedirect = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      occurredAt: "2026-03-26T00:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
    });
    const secondRedirectSameHome = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      occurredAt: "2026-03-26T23:59:59.999Z",
      replyToMessageId: "message-2",
      sourceEventId: "event-2",
    });
    const replayedFirstRedirect = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      occurredAt: "2026-03-26T00:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
    });
    const redirectOnNextDay = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      occurredAt: "2026-03-27T00:00:00.000Z",
      replyToMessageId: "message-3",
      sourceEventId: "event-3",
    });
    const redirectAfterHomeLineChange = createHostedWebhookLinqMessageSideEffect({
      ...baseInput,
      homeRecipientPhone: "+15555550200",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-4",
      sourceEventId: "event-4",
    });

    expect(firstRedirect.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
    expect(secondRedirectSameHome.effectId).toBe(firstRedirect.effectId);
    expect(replayedFirstRedirect.effectId).toBe(firstRedirect.effectId);
    expect(redirectOnNextDay.effectId).not.toBe(firstRedirect.effectId);
    expect(redirectOnNextDay.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
    expect(redirectAfterHomeLineChange.effectId).not.toBe(firstRedirect.effectId);
    expect(redirectAfterHomeLineChange.effectId).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/);
  });

  it("keeps the redirect effect id stable when the contact-privacy keyring rotates", () => {
    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { v1: HOME_REDIRECT_TEST_KEYRING_ENTRIES.v1 },
    });
    let firstRedirect;
    try {
      firstRedirect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-1",
        homeRecipientPhone: "+15555550100",
        memberId: "member-1",
        occurredAt: "2026-03-26T12:00:00.000Z",
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
        occurredAt: "2026-03-26T12:00:00.000Z",
        replyToMessageId: "message-2",
        sourceEventId: "event-2",
        template: "conversation_home_redirect",
      });
    } finally {
      restoreV2();
    }

    expect(secondRedirect.effectId).toBe(firstRedirect.effectId);
  });

  it("keeps the private email recovery effect id stable when the contact-privacy keyring rotates", () => {
    const recoveryInput = {
      assignedRecipientPhone: "+15550100000",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "email",
        value: "unknown-sender@example.com",
      },
      recoveryToken: "murph_linq_group_email_v1.token",
      template: "group_email_recovery",
      threadId: "chat-group-email-rotation",
    } as const;

    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { v1: HOME_REDIRECT_TEST_KEYRING_ENTRIES.v1 },
    });
    let firstRecovery;
    let firstLookupKey;
    try {
      firstLookupKey = createHostedLinqParticipantContact({
        kind: "email",
        value: recoveryInput.participantContact.value,
      })?.lookupKey;
      firstRecovery = createHostedWebhookLinqMessageSideEffect({
        ...recoveryInput,
        sourceEventId: "event-group-email-rotation-1",
      });
    } finally {
      restoreV1();
    }

    const restoreV2 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: HOME_REDIRECT_TEST_KEYRING_ENTRIES,
    });
    let secondRecovery;
    let secondLookupKey;
    try {
      secondLookupKey = createHostedLinqParticipantContact({
        kind: "email",
        value: recoveryInput.participantContact.value,
      })?.lookupKey;
      secondRecovery = createHostedWebhookLinqMessageSideEffect({
        ...recoveryInput,
        sourceEventId: "event-group-email-rotation-2",
      });
    } finally {
      restoreV2();
    }

    // The rotation has to actually move the blind index, otherwise the
    // stability assertion below would pass for the wrong reason.
    expect(firstLookupKey).toEqual(expect.any(String));
    expect(secondLookupKey).not.toBe(firstLookupKey);
    expect(secondRecovery.effectId).toBe(firstRecovery.effectId);
    expect(secondRecovery.effectId)
      .toMatch(/^linq-group-email-recovery:[0-9a-f]{32}$/u);
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
    const resetAt = "2026-03-26T12:15:00.000Z";
    const afterPlanResetEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        planResetAt: resetAt,
        sentAt: "2026-03-26T12:45:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "edge_usage_limit_reached",
      occurredAt: "2026-03-26T12:45:00.000Z",
      replyToMessageId: "message-3",
      sourceEventId: "event-ai-usage-after-reset",
      template: "ai_usage_quota",
    });
    const afterPlanResetIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: "member-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      planResetAt: resetAt,
      usageCreditLedgerVersion: 0n,
    });

    expect(firstEffect.effectId).toBe(firstIdempotencyKey);
    expect(firstRetryEffect.effectId).toBe(firstIdempotencyKey);
    expect(secondEffect.effectId).toBe(secondIdempotencyKey);
    expect(secondEffect.effectId).not.toBe(firstEffect.effectId);
    expect(afterPlanResetEffect.effectId).toBe(afterPlanResetIdempotencyKey);
    expect(afterPlanResetEffect.effectId).not.toBe(firstEffect.effectId);
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
      sourceRef: effect.effectId,
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

  it("renders the backup sender and reserves stale-event capacity at dispatch time", async () => {
    vi.useFakeTimers();
    const dispatchNow = new Date("2026-03-27T12:00:00.000Z");
    vi.setSystemTime(dispatchNow);
    const recoveryPhone = "+15550100042";
    const memberPhone = "+15551234567";
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const expectedMessage = buildHostedLinqGroupLineRecoveryMessage({
      backupPhoneNumber: recoveryPhone,
      seed: effect.effectId,
    });
    const expectedSourceRef = buildHostedLinqGroupLineRecoverySourceRef({
      effectId: effect.effectId,
      sourceEventId: "event-group-line-recovery",
    });

    try {
      await expect(
        drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        }),
      ).resolves.toEqual({ sentCount: 1, skipped: [] });

      expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: effect.effectId,
          phoneNumber: recoveryPhone,
          prisma,
          reclaimStalePreProviderAttempt: true,
          source: "hosted_webhook_side_effect",
          sourceRef: expectedSourceRef,
          status: "attempted",
          targetKind: "participant",
          template: "group_line_recovery",
        }),
      );
      expect(createHostedLinqChat).toHaveBeenCalledWith({
        from: recoveryPhone,
        idempotencyKey: effect.effectId,
        message: expectedMessage,
        signal: undefined,
        to: [memberPhone],
      });
      expect(countOccurrences(expectedMessage, recoveryPhone)).toBe(1);
      expect(transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx)
        .toHaveBeenCalledWith(expect.objectContaining({
          now: dispatchNow,
          prisma,
        }));
      expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("durably records recovery acceptance before returning provider success", async () => {
    const recoveryPhone = "+15550100042";
    const memberPhone = "+15551234567";
    const scheduleAfterResponse = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery-correlation",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const effectLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId);
    const recoveryLookupKey = createHostedPhoneLookupKey(recoveryPhone);
    if (!effectLookupKey || !recoveryLookupKey) {
      throw new Error("Expected recovery delivery lookup keys.");
    }
    const sourceRef = buildHostedLinqGroupLineRecoverySourceRef({
      effectId: effect.effectId,
      sourceEventId: "event-group-line-recovery-correlation",
    });
    vi.mocked(markHostedLinqDeliveryAcceptedTx)
      .mockRejectedValueOnce(new Error("accepted milestone unavailable"));

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      scheduleAfterResponse,
      sideEffects: [effect],
    })).rejects.toThrow("accepted milestone unavailable");

    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(markHostedLinqDeliverySendFailedTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).toHaveBeenCalledTimes(1);

    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .mockResolvedValue([{
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld-group-recovery-correlation",
        idempotencyLookupKey: effectLookupKey,
        lastProviderEventId: null,
        phoneNumberLookupKey: recoveryLookupKey,
        providerCorrelated: false,
        sourceRef,
        status: "attempted",
        targetKind: "participant",
        template: "group_line_recovery",
      }]);

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      scheduleAfterResponse,
      sideEffects: [effect],
    })).resolves.toEqual({ sentCount: 1, skipped: [] });

    expect(scheduleAfterResponse).not.toHaveBeenCalled();
    expect(createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(createHostedLinqChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: effect.effectId }),
    );
    expect(createHostedLinqChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: effect.effectId }),
    );
    expect(markHostedLinqDeliveryAcceptedTx).toHaveBeenCalledTimes(2);
  });

  it("revalidates a verified email participant before private recovery", async () => {
    const participantEmail = "member@example.test";
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "email",
        value: participantEmail,
      },
      sourceEventId: "event-group-line-recovery-email",
      template: "group_line_recovery",
      threadId: "chat-group-email",
    });

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    })).resolves.toEqual({ sentCount: 1, skipped: [] });

    expect(
      transportBoundaryMocks.lookupHostedMemberByVerifiedEmailAddress,
    ).toHaveBeenCalledWith({
      address: participantEmail,
      prisma,
    });
    expect(
      transportBoundaryMocks.lookupHostedMemberIdentityByPhoneNumber,
    ).not.toHaveBeenCalled();
    expect(createHostedLinqChat).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [participantEmail],
      }),
    );
  });

  it("keeps one recovery instruction when failure is followed by retry and late delivery", async () => {
    const incomingPhone = "+15550100000";
    const backupPhone = "+15550100042";
    const memberPhone = "+15551234567";
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const baseEffect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery-1",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const secondEffect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:01:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery-2",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const thirdEffect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:02:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery-3",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const baseEffectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const secondAttemptEffectId =
      buildHostedLinqGroupLineRecoveryAttemptEffectId({
        attempt: 2,
        effectId: baseEffectId,
      });
    const baseLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(baseEffectId);
    const secondLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(secondAttemptEffectId);
    const backupLookupKey = createHostedPhoneLookupKey(backupPhone);
    if (!baseLookupKey || !secondLookupKey || !backupLookupKey) {
      throw new Error("Expected group-line recovery attempt lookup keys.");
    }
    const firstSourceRef = buildHostedLinqGroupLineRecoverySourceRef({
      effectId: baseEffectId,
      sourceEventId: "event-group-line-recovery-1",
    });
    const secondSourceRef = buildHostedLinqGroupLineRecoverySourceRef({
      effectId: baseEffectId,
      sourceEventId: "event-group-line-recovery-2",
    });
    const expectedMessage = buildHostedLinqGroupLineRecoveryMessage({
      backupPhoneNumber: backupPhone,
      seed: baseEffectId,
    });
    const failedBaseIntent = {
      attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
      groupJoinOutreachId: null,
      groupJoinReplyOccurredAt: null,
      id: "hld-group-recovery-1",
      idempotencyLookupKey: baseLookupKey,
      lastProviderEventId: "hbidx:linq-provider-event:recovery-failed-1",
      phoneNumberLookupKey: backupLookupKey,
      providerCorrelated: true,
      sourceRef: firstSourceRef,
      status: "failed",
      targetKind: "participant",
      template: "group_line_recovery",
    };

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [baseEffect],
    })).resolves.toEqual({ sentCount: 1, skipped: [] });
    expect(createHostedLinqChat).toHaveBeenCalledWith({
      from: backupPhone,
      idempotencyKey: baseEffectId,
      message: expectedMessage,
      signal: undefined,
      to: [memberPhone],
    });
    expect(
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
    ).toHaveBeenCalledTimes(1);

    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .mockResolvedValue([failedBaseIntent]);
    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [baseEffect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: baseEffect.effectId,
        reason: "notice_target_unauthorized",
        template: "group_line_recovery",
      }],
    });
    expect(createHostedLinqChat).toHaveBeenCalledTimes(1);
    expect(
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
    ).toHaveBeenCalledTimes(1);

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [secondEffect],
    })).resolves.toEqual({ sentCount: 1, skipped: [] });
    expect(createHostedLinqChat).toHaveBeenLastCalledWith({
      from: backupPhone,
      idempotencyKey: secondAttemptEffectId,
      message: expectedMessage,
      signal: undefined,
      to: [memberPhone],
    });
    expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: secondAttemptEffectId,
        sourceRef: secondSourceRef,
      }),
    );
    expect(createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
    ).toHaveBeenCalledTimes(1);
    expect(
      transportBoundaryMocks.readHostedLinqReceiptCorrelatedRecoveryLineTx,
    ).toHaveBeenCalledWith({
      expectedFailureReceiptEventId:
        "hbidx:linq-provider-event:recovery-failed-1",
      phoneNumberLookupKey: backupLookupKey,
      prisma,
    });

    const liveSecondIntent = {
      ...failedBaseIntent,
      attemptedAt: new Date("2026-03-26T12:01:00.000Z"),
      id: "hld-group-recovery-2",
      idempotencyLookupKey: secondLookupKey,
      providerCorrelated: false,
      sourceRef: secondSourceRef,
      status: "attempted",
    };
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .mockResolvedValue([failedBaseIntent, liveSecondIntent]);
    const retryAt = new Date("2026-03-26T12:16:00.000Z");
    vi.mocked(claimHostedLinqDeliveryProviderDispatchTx)
      .mockResolvedValueOnce({
        claimed: false,
        id: "hld-group-recovery-2",
        retryAt,
      });
    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [thirdEffect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: thirdEffect.effectId,
        reason: "notice_in_flight",
        retryAt,
        template: "group_line_recovery",
      }],
    });
    expect(createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
    ).toHaveBeenCalledTimes(1);

    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .mockResolvedValue([
        {
          ...failedBaseIntent,
          status: "delivered",
        },
        {
          ...liveSecondIntent,
          providerCorrelated: true,
          status: "accepted",
        },
      ]);
    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [thirdEffect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: thirdEffect.effectId,
        reason: "notice_already_claimed",
        template: "group_line_recovery",
      }],
    });
    expect(createHostedLinqChat).toHaveBeenCalledTimes(2);
    expect(
      transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not replace an unhealthy pinned recovery sender", async () => {
    const incomingPhone = "+15550100000";
    const backupPhone = "+15550100042";
    const memberPhone = "+15551234567";
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      occurredAt: "2026-03-26T12:01:00.000Z",
      participantContact: {
        kind: "phone",
        value: memberPhone,
      },
      sourceEventId: "event-group-line-recovery-2",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    const baseEffectId = buildHostedLinqGroupLineRecoveryEffectId({
      incomingRecipientPhone: incomingPhone,
      memberId: "member-1",
      threadId: "chat-group-1",
    });
    const baseLookupKey =
      createHostedLinqDeliveryIdempotencyLookupKey(baseEffectId);
    const backupLookupKey = createHostedPhoneLookupKey(backupPhone);
    if (!baseLookupKey || !backupLookupKey) {
      throw new Error("Expected group-line recovery lookup keys.");
    }
    vi.mocked(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .mockResolvedValue([{
        attemptedAt: new Date("2026-03-26T12:00:00.000Z"),
        groupJoinOutreachId: null,
        groupJoinReplyOccurredAt: null,
        id: "hld-group-recovery-1",
        idempotencyLookupKey: baseLookupKey,
        lastProviderEventId: "hbidx:linq-provider-event:recovery-failed-1",
        phoneNumberLookupKey: backupLookupKey,
        providerCorrelated: true,
        sourceRef: buildHostedLinqGroupLineRecoverySourceRef({
          effectId: baseEffectId,
          sourceEventId: "event-group-line-recovery-1",
        }),
        status: "failed",
        targetKind: "participant",
        template: "group_line_recovery",
      }]);
    transportBoundaryMocks.readHostedLinqReceiptCorrelatedRecoveryLineTx
      .mockResolvedValue(null);

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "group_line_recovery",
      }],
    });
    expect(transportBoundaryMocks.readHostedLinqReceiptCorrelatedRecoveryLineTx)
      .toHaveBeenCalledWith({
        expectedFailureReceiptEventId:
          "hbidx:linq-provider-event:recovery-failed-1",
        phoneNumberLookupKey: backupLookupKey,
        prisma,
      });
    expect(transportBoundaryMocks.reserveHostedLinqHealthyProactiveLineTx)
      .not.toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).not.toHaveBeenCalled();
  });

  it("does not dispatch group-line recovery after transport-time access revocation", async () => {
    const memberLock = vi.fn().mockResolvedValue([{ id: "member-1" }]);
    const memberAccessRead = vi.fn().mockResolvedValue({
      accountGroupMemberships: [],
      billingRef: null,
      billingStatus: HostedBillingStatus.not_started,
      suspendedAt: new Date("2026-03-26T12:00:01.000Z"),
      threadContainer: null,
    });
    const prisma = {
      $queryRaw: memberLock,
      hostedMember: {
        findUnique: memberAccessRead,
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: "+15551234567",
      },
      sourceEventId: "event-group-line-recovery",
      template: "group_line_recovery",
      threadId: "chat-group-1",
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
        template: "group_line_recovery",
      }],
    });

    expect(memberLock).toHaveBeenCalled();
    expect(memberAccessRead).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "member-1" },
    }));
    expect(memberLock.mock.invocationCallOrder[0]).toBeLessThan(
      memberAccessRead.mock.invocationCallOrder[0]!,
    );
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      arrange: () => {
        transportBoundaryMocks.lookupHostedMemberIdentityByPhoneNumber
          .mockResolvedValue({ core: { id: "member-other" } });
      },
      label: "participant identity changes",
    },
    {
      arrange: () => {
        transportBoundaryMocks.readHostedMemberRoutingState.mockResolvedValue({
          linqChatId: null,
          linqHomeLineAssignedAt: new Date("2026-03-26T12:00:00.000Z"),
          linqRecipientPhone: "+15550100099",
          pendingLinqChatId: null,
          pendingLinqParticipantContact: null,
          pendingLinqRecipientPhone: null,
        });
      },
      label: "assigned line changes",
    },
    {
      arrange: () => {
        const incomingLineLookupKey =
          createHostedPhoneLookupKey("+15550100000");
        if (!incomingLineLookupKey) {
          throw new Error("Expected incoming recovery line lookup key.");
        }
        transportBoundaryMocks.readHostedLinqIncomingLineState
          .mockResolvedValue({
            kind: "at_risk",
            phoneNumberLookupKey: incomingLineLookupKey,
          });
      },
      label: "incoming line is no longer hard-blocked",
    },
  ])("does not dispatch group-line recovery when $label", async ({ arrange }) => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "member-1" }]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      incomingRecipientPhone: "+15550100000",
      memberId: "member-1",
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "phone",
        value: "+15551234567",
      },
      sourceEventId: "event-group-line-recovery",
      template: "group_line_recovery",
      threadId: "chat-group-1",
    });
    arrange();

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "group_line_recovery",
      }],
    });
    expect(readHostedLinqDeliveryProviderDispatchIntentsTx)
      .not.toHaveBeenCalled();
    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).not.toHaveBeenCalled();
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

  it("preserves an AI usage quota rich-link partial delivery as terminal", async () => {
    const partialFailureMessage =
      "Linq rich-link delivery could not confirm both provider messages after the primary request was accepted.";
    vi.mocked(sendHostedLinqChatMessage).mockRejectedValueOnce(Object.assign(
      new Error(partialFailureMessage),
      {
        code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        deliveryMayHaveSucceeded: true,
        providerMessageId: "msg_text",
        providerMessageIds: ["msg_text"],
        providerThreadId: "chat-1",
        retryable: false,
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
      message:
        "Usage details:\nhttps://pay.example.test/checkout/session_123",
      noticeCode: "pulse_upgrade_edge",
      occurredAt: "2026-03-26T12:00:00.000Z",
      replyToMessageId: "message-1",
      sourceEventId: "event-ai-usage-partial",
      template: "ai_usage_quota",
    });

    await expect(
      drainHostedLinqSideEffectsDirect({
        prisma: usagePrisma as never,
        sideEffects: [effect],
      }),
    ).rejects.toThrow(partialFailureMessage);

    expect(markHostedLinqDeliveryAcceptedTx).not.toHaveBeenCalled();
    expect(markHostedLinqDeliverySendFailedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date("2026-03-26T12:00:01.000Z"),
      failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      failureReason: partialFailureMessage,
      idempotencyKey: effect.effectId,
      linqChatId: "chat-1",
      messageIds: ["msg_text"],
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
      noticeCode: "billing_inactive",
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

  it("replays billing-inactive notices through provider idempotency", async () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: null,
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "billing_inactive",
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

  it("rejects claim tokens when constructing billing-inactive quota side effects", () => {
    expect(() => createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      claimToken: {
        periodStart: "2026-03-01T00:00:00.000Z",
        sentAt: "2026-03-26T12:00:01.000Z",
        usageCreditLedgerVersion: "0",
      },
      memberId: "member-1",
      message: "usage-limit",
      noticeCode: "billing_inactive",
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
      sourceRef: effect.effectId,
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

  describe("unknown-group private email recovery line budget", () => {
    const recoveryLinePhone = "+15550100000";
    const unknownSenderEmail = "unknown-sender@example.com";
    const dispatchNow = new Date("2026-03-27T12:00:00.000Z");
    const dispatchDayUtc = new Date("2026-03-27T00:00:00.000Z");

    function arrangeAssignableRecoveryLine(): string {
      const lookupKey = createHostedPhoneLookupKey(recoveryLinePhone);
      if (!lookupKey) {
        throw new Error("Expected a private recovery line lookup key.");
      }
      transportBoundaryMocks.readHostedLinqIncomingLineState.mockResolvedValue({
        kind: "assignable",
        phoneNumberLookupKey: lookupKey,
      });
      return lookupKey;
    }

    // Dispatch re-opens the token to reject links that expired while the
    // webhook sat in a backlog, so this fixture carries a real sealed token
    // rather than a placeholder.
    function buildGroupEmailRecoveryEffect(
      sourceEventId: string,
      observedAt = "2026-03-27T11:59:00.000Z",
    ) {
      return createHostedWebhookLinqMessageSideEffect({
        assignedRecipientPhone: recoveryLinePhone,
        occurredAt: observedAt,
        participantContact: {
          kind: "email",
          value: unknownSenderEmail,
        },
        recoveryToken: issueHostedLinqGroupEmailRecoveryToken({
          chatId: "chat-group-email-budget",
          now: new Date(observedAt),
          observedAt,
          participantEmail: unknownSenderEmail,
          recipientPhone: recoveryLinePhone,
        }),
        sourceEventId,
        template: "group_email_recovery",
        threadId: "chat-group-email-budget",
      });
    }

    it("claims one new-conversation budget slot before opening the private chat", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 10,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-budget-claimed",
      );

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({ sentCount: 1, skipped: [] });

        expect(createHostedLinqChat).toHaveBeenCalledWith(
          expect.objectContaining({
            from: recoveryLinePhone,
            idempotencyKey: effect.effectId,
            to: [unknownSenderEmail],
          }),
        );
        expect(line.proactiveConversationCount).toBe(4);
        expect(line.proactiveConversationDayUtc).toEqual(dispatchDayUtc);
        // The claim must stay bound to the dispatch UTC day and to a healthy,
        // egress-enabled line, exactly like every other proactive opener.
        expect(prisma.hostedLinqLine.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              egressPolicy: "enabled",
              healthStatus: "healthy",
              phoneNumberLookupKey: lookupKey,
              proactiveConversationCount: { lt: 10 },
              proactiveConversationDayUtc: dispatchDayUtc,
            }),
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not spend another line slot for a correlated private recovery replay", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 10,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-correlated-replay",
      );
      vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx)
        .mockResolvedValueOnce({
          groupJoinOutreachId: null,
          groupJoinReplyOccurredAt: null,
          id: "hld_group_email_correlated",
          lastProviderEventId: "provider-event-correlated",
          phoneNumberLookupKey: lookupKey,
          providerCorrelated: true,
          sourceRef: effect.effectId,
          status: "accepted",
          targetKind: "participant",
          template: "group_email_recovery",
        });

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: effect.effectId,
            reason: "notice_already_claimed",
            template: "group_email_recovery",
          }],
        });

        expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
        expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
        expect(createHostedLinqChat).not.toHaveBeenCalled();
        expect(line.proactiveConversationCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reuses the original line slot while a private recovery is in flight", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const retryAt = new Date("2026-03-27T12:15:00.000Z");
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 10,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-in-flight-replay",
      );
      vi.mocked(readHostedLinqDeliveryProviderDispatchIntentTx)
        .mockResolvedValueOnce({
          groupJoinOutreachId: null,
          groupJoinReplyOccurredAt: null,
          id: "hld_group_email_in_flight",
          lastProviderEventId: null,
          phoneNumberLookupKey: lookupKey,
          providerCorrelated: false,
          sourceRef: effect.effectId,
          status: "attempted",
          targetKind: "participant",
          template: "group_email_recovery",
        });
      vi.mocked(claimHostedLinqDeliveryProviderDispatchTx)
        .mockResolvedValueOnce({
          claimed: false,
          id: "hld_group_email_in_flight",
          retryAt,
        });

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: effect.effectId,
            reason: "notice_in_flight",
            retryAt,
            template: "group_email_recovery",
          }],
        });

        expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
        expect(claimHostedLinqDeliveryProviderDispatchTx).toHaveBeenCalledTimes(1);
        expect(createHostedLinqChat).not.toHaveBeenCalled();
        expect(line.proactiveConversationCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("skips a recovery link whose token expired before dispatch without spending line budget", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 10,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      // Two days of backlog: the token's 24-hour life is anchored to the
      // provider's observed send time so plan retries stay byte-identical, so a
      // late redelivery carries a link that is already dead on arrival.
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-token-expired",
        "2026-03-25T11:59:00.000Z",
      );

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: effect.effectId,
            reason: "notice_target_unauthorized",
            template: "group_email_recovery",
          }],
        });

        expect(createHostedLinqChat).not.toHaveBeenCalled();
        // Freshness is checked before the capacity claim, so a link that cannot
        // work never burns a slot the line could have spent on a live one.
        expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
        expect(line.proactiveConversationCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("still sends a recovery link whose token is inside its lifetime at dispatch", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 10,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      // Issued 23.5 hours before dispatch: still inside the window, so the
      // freshness guard must let an aged-but-live link through rather than
      // rejecting anything that did not arrive immediately.
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-token-fresh",
        "2026-03-26T12:30:00.000Z",
      );

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({ sentCount: 1, skipped: [] });

        expect(createHostedLinqChat).toHaveBeenCalledWith(
          expect.objectContaining({
            from: recoveryLinePhone,
            idempotencyKey: effect.effectId,
            to: [unknownSenderEmail],
          }),
        );
        expect(line.proactiveConversationCount).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("skips the private chat once the line is at its daily new-conversation limit", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 3,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = buildGroupEmailRecoveryEffect(
        "event-group-email-budget-exhausted",
      );

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: effect.effectId,
            reason: "notice_target_unauthorized",
            template: "group_email_recovery",
          }],
        });

        expect(createHostedLinqChat).not.toHaveBeenCalled();
        expect(claimHostedLinqDeliveryProviderDispatchTx)
          .not.toHaveBeenCalled();
        expect(line.proactiveConversationCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("still answers in the group when the line is at its daily new-conversation limit", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { line, prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 3,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 3,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-group-email-budget",
        occurredAt: "2026-03-27T11:59:00.000Z",
        replyToMessageId: "message-group-1",
        sourceEventId: "event-group-setup-at-limit",
        template: "group_setup",
      });

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({ sentCount: 1, skipped: [] });

        // The setup link replies into the existing group chat, so it must not
        // consume the budget that only bounds newly opened conversations.
        expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            chatId: "chat-group-email-budget",
            idempotencyKey: effect.effectId,
          }),
        );
        expect(createHostedLinqChat).not.toHaveBeenCalled();
        expect(prisma.hostedLinqLine.updateMany).not.toHaveBeenCalled();
        expect(line.proactiveConversationCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("renders canonical privacy-safe rotating group setup copy", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(dispatchNow);
      const lookupKey = arrangeAssignableRecoveryLine();
      const { prisma } = createHostedLinqLineCapacityPrisma({
        maxNewConversationsPerDay: 3,
        phoneNumberLookupKey: lookupKey,
        proactiveConversationCount: 0,
        proactiveConversationDayUtc: dispatchDayUtc,
      });
      const effect = createHostedWebhookLinqMessageSideEffect({
        chatId: "chat-group-inactive-sender",
        occurredAt: "2026-03-27T11:59:00.000Z",
        replyToMessageId: "message-group-inactive-sender",
        sourceEventId: "event-group-inactive-sender",
        template: "group_setup",
      });

      try {
        await expect(drainHostedLinqSideEffectsDirect({
          prisma: prisma as never,
          sideEffects: [effect],
        })).resolves.toEqual({ sentCount: 1, skipped: [] });

        expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            chatId: "chat-group-inactive-sender",
            idempotencyKey: effect.effectId,
            message: expect.stringMatching(
              /(?:active on Murph|active Murph member)/iu,
            ),
            replyToMessageId: "message-group-inactive-sender",
          }),
        );
        const sentMessage = vi.mocked(sendHostedLinqChatMessage).mock.calls[0]?.[0]
          .message;
        expect(sentMessage).toContain("https://join.test/groups/start");
        expect(sentMessage).not.toContain(
          "someone in this chat needs to finish setting up Murph",
        );
        expect(sentMessage).not.toMatch(
          /\b(?:account|access|billing|payment|subscription|trial|you|your)\b/iu,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/**
 * One managed line row with the subset of `hostedLinqLine` behaviour the real
 * `claimHostedLinqProactiveConversationCapacityTx` depends on: the conditional
 * same-day increment and the new-day reset. Line-eligibility predicates are
 * accepted but not re-implemented; tests assert on the recorded `where` instead.
 */
function createHostedLinqLineCapacityPrisma(input: {
  maxNewConversationsPerDay: number | null;
  phoneNumberLookupKey: string;
  proactiveConversationCount: number | null;
  proactiveConversationDayUtc: Date | null;
}) {
  const line = {
    maxNewConversationsPerDay: input.maxNewConversationsPerDay,
    phoneNumberLookupKey: input.phoneNumberLookupKey,
    proactiveConversationCount: input.proactiveConversationCount,
    proactiveConversationDayUtc: input.proactiveConversationDayUtc,
  };
  const hostedLinqLine = {
    findUnique: vi.fn(async ({ where }: {
      where: { phoneNumberLookupKey: string };
    }) => (
      where.phoneNumberLookupKey === line.phoneNumberLookupKey
        ? { maxNewConversationsPerDay: line.maxNewConversationsPerDay }
        : null
    )),
    updateMany: vi.fn(async ({ data, where }: {
      data: {
        proactiveConversationCount?: { increment: number } | number;
        proactiveConversationDayUtc?: Date;
      };
      where: {
        OR?: Array<{ proactiveConversationDayUtc?: null | { not: Date } }>;
        phoneNumberLookupKey: string;
        proactiveConversationCount?: { lt: number };
        proactiveConversationDayUtc?: Date;
      };
    }) => {
      if (where.phoneNumberLookupKey !== line.phoneNumberLookupKey) {
        return { count: 0 };
      }
      const sameDay = where.proactiveConversationDayUtc === undefined
        || line.proactiveConversationDayUtc?.getTime()
          === where.proactiveConversationDayUtc.getTime();
      const underLimit = where.proactiveConversationCount === undefined
        || (line.proactiveConversationCount ?? 0)
          < where.proactiveConversationCount.lt;
      const startsNewDay = Boolean(where.OR?.some((predicate) => (
        predicate.proactiveConversationDayUtc === null
          ? line.proactiveConversationDayUtc === null
          : Boolean(predicate.proactiveConversationDayUtc?.not)
            && line.proactiveConversationDayUtc?.getTime()
              !== predicate.proactiveConversationDayUtc?.not?.getTime()
      )));
      if (
        where.OR === undefined
          ? !(sameDay && underLimit)
          : !startsNewDay
      ) {
        return { count: 0 };
      }
      if (typeof data.proactiveConversationCount === "number") {
        line.proactiveConversationCount = data.proactiveConversationCount;
      } else if (data.proactiveConversationCount?.increment) {
        line.proactiveConversationCount =
          (line.proactiveConversationCount ?? 0)
          + data.proactiveConversationCount.increment;
      }
      if (data.proactiveConversationDayUtc) {
        line.proactiveConversationDayUtc = data.proactiveConversationDayUtc;
      }
      return { count: 1 };
    }),
  };

  return {
    line,
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedLinqLine,
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
    },
  };
}

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
    existingGroupMembership?: boolean;
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
      findFirst: vi.fn().mockResolvedValue(
        input.groupReplyAuthorized === false
          ? null
          : {
              offer: {
                group: {
                  id: "hgrp-runtime",
                  joinCode: input.groupJoinCode ?? "join-group",
                  runtimeMember: { suspendedAt: null },
                  runtimeMemberId: "member-runtime",
                },
                revokedAt: null,
              },
            },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedGroupMember: {
      findUnique: vi.fn().mockResolvedValue(
        input.existingGroupMembership ? { id: "hgrpm-existing" } : null,
      ),
    },
    hostedLinqDelivery: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hostedGroupJoinOffer: {
      findUnique: vi.fn().mockResolvedValue({
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

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
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
