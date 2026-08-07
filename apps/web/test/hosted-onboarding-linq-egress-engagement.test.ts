import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  assertHostedAssistantAskCompletionDeliveryAuthorityTx: vi.fn(),
  decryptHostedLinqLinePhoneNumber: vi.fn(),
  getPrisma: vi.fn(),
  decodeHostedMailboxStoredPayload: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  readHostedMemberRoutingPrivateState: vi.fn(),
  readHostedMemberIdentityPhoneNumber: vi.fn(),
  runWithHostedDomainRootUnwrapCache: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  assertHostedAssistantAskCompletionDeliveryAuthorityTx:
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx:
    mocks.acquireHostedMemberHomeLinqRouteLockTx,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-mailbox/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-mailbox/store")>(),
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithHostedDomainRootUnwrapCache:
    mocks.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", () => ({
  readHostedMemberIdentityPhoneNumber:
    mocks.readHostedMemberIdentityPhoneNumber,
  readHostedMemberRoutingPrivateState:
    mocks.readHostedMemberRoutingPrivateState,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/linq-line-phone-codec",
  async (importOriginal) => ({
    ...await importOriginal<typeof import(
      "@/src/lib/hosted-onboarding/linq-line-phone-codec"
    )>(),
    decryptHostedLinqLinePhoneNumber:
      mocks.decryptHostedLinqLinePhoneNumber,
  }),
);

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "@/src/lib/hosted-onboarding/messaging-state";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqDeliverySourceRefLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  encryptHostedLinqDeliveryParticipantPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-delivery-participant-phone-codec";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { POST as postHostedLinqEgressEngagement } from "../app/api/internal/hosted-runtime/linq-egress/engagement/route";

describe("hosted Linq egress authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member-1");
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx.mockResolvedValue(
      undefined,
    );
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(null);
    mocks.runWithHostedDomainRootUnwrapCache.mockImplementation(
      async (run: () => Promise<unknown>) => run(),
    );
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(null);
    mocks.decryptHostedLinqLinePhoneNumber.mockImplementation(
      (ciphertext: string) => ciphertext,
    );
  });

  it("allows explicit signup welcome first contact for the bound runtime user", async () => {
    const prisma = createPrismaStub({
      identityPhone: "+15550100001",
      homeLinePhone: "+15550100099",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-1",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100001",
      targetKind: "participant",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    expect(prisma.hostedMemberIdentity.findUnique).toHaveBeenCalledWith({
      select: { phoneLookupKey: true },
      where: { memberId: "member-1" },
    });
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalledWith({
      select: { linqRecipientPhoneLookupKey: true },
      where: { memberId: "member-1" },
    });
    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
  });

  it("rejects first contact without signup-welcome authority", async () => {
    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-2",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(createPrismaStub({
        identityPhone: "+15550100001",
        homeLinePhone: "+15550100099",
      })),
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("rejects participant sends without signup-welcome idempotency even when identity and source line match", async () => {
    const prisma = createPrismaStub({
      identityPhone: "+15550100001",
      homeLinePhone: "+15550100099",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100099",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100100",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100099",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100002",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("allows thread sends only when the target matches home or pending Linq routing", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
      pendingChatId: "chat-pending",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-home",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-pending",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-other",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("uses a same-member durable route for replies but not current-home sends", async () => {
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-authorized",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: false });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-authorized",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    const foreignRoutePrisma = createPrismaStub({
      threadRouteContainerMemberId: "member-2",
    });
    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(foreignRoutePrisma),
      target: "chat-authorized",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
    expect(foreignRoutePrisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-participant sends before route resolution when member access is inactive", async () => {
    const prisma = createPrismaStub({
      activeMemberAccess: false,
      threadRouteContainerMemberId: "member-1",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-authorized",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      httpStatus: 403,
    });

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();
  });

  it("uses the live home route without a runner authority hint", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-home",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalled();
  });

  it("returns a current home-route override for stale bare Linq home targets", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const memberPhoneLookupKey = createRequiredPhoneLookupKey(memberPhone);
    if (!memberPhoneLookupKey) {
      throw new Error("Expected a member phone lookup key.");
    }
    const expectedRoute = resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat-current-home",
      memberId: "member-1",
      messaging: resolveHostedMemberMessagingState({
        identity: { phoneLookupKey: memberPhoneLookupKey },
        routing: { linqChatId: "chat-current-home" },
      }),
    });
    if (!expectedRoute?.threadId) {
      throw new Error("Expected a canonical direct conversation locator.");
    }
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-home",
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-stale-home",
      targetKind: "explicit",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: {
        conversationThreadId: expectedRoute.threadId,
        target: "chat-current-home",
        targetKind: "thread",
      },
      threadIsDirect: true,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMemberIdentity.findUnique).toHaveBeenCalledOnce();
  });

  it("returns a participant route when a fallback-key recovery proves the current home chat is stale", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValueOnce(memberPhone);
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          "assistant-outbox:intent_123",
        )
        ? buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-current-home"),
          })
        : null
    );
    mockPersistedLinqInbound({
      chatId: "chat-current-home",
      dedupeKey: "linq:message-stale-direct-chat",
      mailboxItemId: "mailbox-stale-direct-chat",
      messageId: "message-stale-direct-chat",
      occurredAt: "2026-08-06T12:00:00.000Z",
      prisma,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-stale-direct-chat"],
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "message-stale-direct-chat",
      target: "chat-current-home",
      targetKind: "thread",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: {
        fromPhoneNumber: homeLinePhone,
        target: memberPhone,
        targetKind: "participant",
      },
      threadIsDirect: true,
    });
  });

  it("keeps an ordinary card fallback on its persisted inbound thread", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
    });
    mockPersistedLinqInbound({
      chatId: "chat-original-fallback",
      dedupeKey: "linq:message-original-fallback",
      mailboxItemId: "mailbox-original-fallback",
      messageId: "message-original-fallback",
      occurredAt: "2026-08-06T12:00:00.000Z",
      prisma,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-original-fallback"],
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey: "assistant-outbox:intent_ordinary:fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "message-original-fallback",
      target: "chat-original-fallback",
      targetKind: "thread",
    })).resolves.toEqual({
      targetOverride: null,
      threadIsDirect: true,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
  });

  it("does not re-home an ordinary card fallback without persisted inbound selectors", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: [],
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey: "assistant-outbox:intent_ordinary:fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: null,
      target: "chat-original-fallback",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("keeps an already-persisted replacement thread instead of rematerializing a participant chat", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          "assistant-outbox:intent_123",
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          "assistant-outbox:intent_123:stale-chat-fallback",
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-current-home"),
          phoneNumberLookupKey: createRequiredPhoneLookupKey(homeLinePhone),
        });
      }
      return null;
    });
    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-stale-direct-chat"],
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "message-stale-direct-chat",
      target: "chat-current-home",
      targetKind: "thread",
    })).resolves.toEqual({
      exactFallbackRouteMatched: true,
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: null,
      threadIsDirect: true,
    });
  });

  it("reacquires the participant request after provider acceptance but before local completion", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-materialized-fallback",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return {
          id: "delivery-fallback",
          linqChatLookupKey: null,
          memberId: "member-1",
          participantPhoneEncrypted:
            encryptHostedLinqDeliveryParticipantPhoneNumber({
              deliveryId: "delivery-fallback",
              phoneNumber: memberPhone,
            }),
          participantPhoneLookupKey:
            createRequiredPhoneLookupKey(memberPhone),
          phoneNumberLookupKey: createRequiredPhoneLookupKey(homeLinePhone),
          source: "hosted_runtime_linq_delivery",
          targetKind: "participant",
        };
      }
      return null;
    });
    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-stale-direct-chat"],
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "message-stale-direct-chat",
      target: "chat-rejected-card",
      targetKind: "thread",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: {
        fromPhoneNumber: homeLinePhone,
        target: memberPhone,
        targetKind: "participant",
      },
      threadIsDirect: true,
    });
  });

  it("keeps an already-claimed participant fallback after the home chat changes", async () => {
    const claimedLinePhone = "+15550100099";
    const currentHomeLinePhone = "+15550100098";
    const claimedMemberPhone = "+15550100001";
    const currentMemberPhone = "+15550100002";
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
      homeLinePhone: currentHomeLinePhone,
      identityPhone: currentMemberPhone,
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: null,
          memberId: "member-1",
          participantPhoneEncrypted:
            encryptHostedLinqDeliveryParticipantPhoneNumber({
              deliveryId: "delivery-card",
              phoneNumber: claimedMemberPhone,
            }),
          participantPhoneLookupKey:
            createRequiredPhoneLookupKey(claimedMemberPhone),
          phoneNumberLookupKey: createRequiredPhoneLookupKey(claimedLinePhone),
          targetKind: "participant",
        });
      }
      return null;
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: "chat-newer-home",
      linqRecipientPhone: currentHomeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(
      currentMemberPhone,
    );
    prisma.hostedLinqLine.findUnique.mockResolvedValue({
      phoneNumberEncrypted: claimedLinePhone,
      phoneNumberLookupKey: createRequiredPhoneLookupKey(claimedLinePhone),
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: claimedLinePhone,
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: claimedMemberPhone,
      targetKind: "participant",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(claimedLinePhone),
      targetOverride: null,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: claimedLinePhone,
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: currentMemberPhone,
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: "+15550100100",
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: claimedMemberPhone,
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("keeps an already-claimed thread fallback after the home chat changes", async () => {
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
    });
    let fallbackOutcome: "accepted" | "failed" = "accepted";
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          ...(fallbackOutcome === "accepted"
            ? {
                acceptedAt: new Date("2026-08-06T12:00:01.000Z"),
                messageLookupKey: "message-fallback",
                status: "accepted",
              }
            : {
                failedAt: new Date("2026-08-06T12:00:01.000Z"),
                failureCode: "LINQ_API_REQUEST_FAILED",
                status: "failed",
              }),
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-frozen-fallback"),
        });
      }
      return null;
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: "chat-newer-home",
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });

    const assertFrozenFallbackRoute = () =>
      assertHostedLinqRecentInboundEngagementForRuntime({
        authorityCheckOnly: true,
        homeRouteFallbackAllowed: true,
        idempotencyKey: fallbackIdempotencyKey,
        memberId: "member-1",
        prisma: asRuntimeEngagementPrisma(prisma),
        target: "chat-frozen-fallback",
        targetKind: "thread",
      });
    await expect(assertFrozenFallbackRoute()).resolves.toEqual({
      exactFallbackRouteMatched: true,
      targetOverride: null,
      threadIsDirect: true,
    });
    fallbackOutcome = "failed";
    await expect(assertFrozenFallbackRoute()).resolves.toEqual({
      exactFallbackRouteMatched: true,
      targetOverride: null,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-newer-home",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("fails closed for a legacy participant claim without its recipient snapshot", async () => {
    const homeLinePhone = "+15550100099";
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-rejected-card",
      homeLinePhone,
      identityPhone: "+15550100002",
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: null,
          phoneNumberLookupKey: createRequiredPhoneLookupKey(homeLinePhone),
          targetKind: "participant",
        });
      }
      return null;
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey: fallbackIdempotencyKey,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-rejected-card",
      targetKind: "thread",
    })).resolves.toEqual({
      routeDisposition: "unavailable",
      targetOverride: null,
      threadIsDirect: true,
    });
  });

  it("keeps the stale current-home card route unchanged without a durable participant route", async () => {
    const homeLinePhone = "+15550100099";
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          "assistant-outbox:intent_123",
        )
        ? buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-current-home"),
          })
        : null
    );

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-current-home",
      targetKind: "thread",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: null,
      threadIsDirect: true,
    });
  });

  it("authorizes only the exact Web-derived participant route for fallback dispatch", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: "chat-current-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(memberPhone);
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          "assistant-outbox:intent_123",
        )
        ? buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-current-home"),
          })
        : null
    );

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: homeLinePhone,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: memberPhone,
      targetKind: "participant",
    })).resolves.toEqual({
      linePhoneNumberLookupKey:
        createRequiredPhoneLookupKey(homeLinePhone),
      targetOverride: null,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: homeLinePhone,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100002",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-newer-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      fromPhoneNumber: homeLinePhone,
      idempotencyKey:
        "assistant-outbox:intent_123:stale-chat-fallback",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: memberPhone,
      targetKind: "participant",
    })).resolves.toMatchObject({
      routeDisposition: "superseded",
      targetOverride: {
        target: "chat-newer-home",
        targetKind: "thread",
      },
    });
  });

  it.each([
    {
      identityPhone: undefined,
      label: "email-only",
    },
    {
      identityPhone: "+15550100001",
      label: "dual-identity",
    },
  ])("uses the canonical email participant for a $label home route", async ({
    identityPhone,
  }) => {
    const contactLookupKey = "hbidx:email:v1:current-home";
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: contactLookupKey,
      userId: "member-1",
    });
    const expectedConversationThreadId =
      hashHostedAssistantConversationIdentifier(
        identifierBlind,
        "chat-current-email-home",
      );
    const prisma = createPrismaStub({
      homeChatId: "chat-current-email-home",
      homeParticipantContactKind: "email",
      homeParticipantContactLookupKey: contactLookupKey,
      ...(identityPhone ? { identityPhone } : {}),
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-email-home",
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: true,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-stale-home",
      targetKind: "explicit",
    })).resolves.toEqual({
      targetOverride: {
        conversationThreadId: expectedConversationThreadId,
        target: "chat-current-email-home",
        targetKind: "thread",
      },
      threadIsDirect: true,
    });

    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
  });

  it("does not retarget a stale bare Linq target at provider entry", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      homeRouteFallbackAllowed: true,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-stale-non-home",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
  });

  it("does not replace a fixed referral source with the current Linq home route", async () => {
    const prisma = createPrismaStub({
      homeChatId: "linq_current_home_b",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      homeRouteFallbackAllowed: false,
      idempotencyKey: "usage-referral-reward:referral_1",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "linq_source_chat_a",
      targetKind: "explicit",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      retryable: false,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
  });

  it("keeps stale reply targets strict instead of returning a home-route override", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-reply",
      target: "chat-stale-home",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
  });

  it("allows an exact answered direct inbound after its home chat binding changes", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    mockPersistedLinqInbound({
      chatId: "chat-inbound",
      dedupeKey: "linq-event-current",
      mailboxItemId: "mailbox-current",
      messageId: "linq-message-current",
      occurredAt: "2026-07-14T00:02:47.000Z",
      prisma,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-current"],
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-current",
      target: "chat-inbound",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledWith({
      dedupeKey: "linq-event-current",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
      mailboxItemId: "mailbox-current",
      occurredAt: "2026-07-14T00:02:47.000Z",
      payloadCiphertext: null,
      payloadInlineCiphertext: "encrypted-mailbox-payload",
      payloadSchema: "murph.hosted-mailbox-item-payload.v1",
      prisma: asRuntimeEngagementPrisma(prisma),
      userId: "member-1",
    });
    expect(prisma.hostedMailboxPayload.findMany).not.toHaveBeenCalled();
  });

  it("allows retry authority from persisted answered mailbox ids without current inbound context", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    mockPersistedLinqInbound({
      chatId: "chat-inbound",
      dedupeKey: "linq-event-retry",
      mailboxItemId: "mailbox-retry",
      messageId: "linq-message-retry",
      occurredAt: "2026-07-14T00:04:47.000Z",
      prisma,
      threadIsDirect: true,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          answeredMailboxItemIds: ["mailbox-retry"],
          authorityCheckOnly: true,
          replyToMessageId: "linq-message-retry",
          target: "chat-inbound",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedMailboxItem.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
  });

  it("recovers exact direct-inbound authority when the runtime mailbox sidecar is missing", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    mockPersistedLinqInbound({
      chatId: "chat-inbound",
      dedupeKey: "linq-event-recovered",
      mailboxItemId: "mailbox-recovered",
      messageId: "linq-message-recovered",
      occurredAt: "2026-07-14T00:06:47.000Z",
      prisma,
      threadIsDirect: true,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-recovered",
      target: "chat-inbound",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null, threadIsDirect: true });

    expect(prisma.hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: { laneSeq: "desc" },
      select: expect.any(Object),
      take: 100,
      where: expect.objectContaining({
        kind: "conversation.message",
        lane: "conversation",
        userId: "member-1",
      }),
    });
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
  });

  it("keeps recovered group mailbox rows unauthorized without a live route", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    mockPersistedLinqInbound({
      chatId: "chat-former-group",
      dedupeKey: "linq-event-former-group",
      mailboxItemId: "mailbox-former-group",
      messageId: "linq-message-former-group",
      occurredAt: "2026-07-14T00:07:47.000Z",
      prisma,
      threadIsDirect: false,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-former-group",
      target: "chat-former-group",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("batches the maximum answered and recent mailbox authority scan", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    const occurredAt = "2026-07-14T00:08:47.000Z";
    const answeredMailboxItemIds = Array.from(
      { length: 100 },
      (_, index) => `mailbox-answered-${index}`,
    );
    const answeredRows = answeredMailboxItemIds.map((mailboxItemId, index) =>
      buildPersistedLinqMailboxItem({
        dedupeKey: `linq-event-answered-${index}`,
        mailboxItemId,
        occurredAt,
        payloadRef: `hosted-mailbox-payload:${mailboxItemId}`,
      }));
    const recentRows = Array.from(
      { length: 100 },
      (_, index) => buildPersistedLinqMailboxItem({
        dedupeKey: `linq-event-recent-${index}`,
        mailboxItemId: `mailbox-recent-${index}`,
        occurredAt,
        payloadRef: `hosted-mailbox-payload:mailbox-recent-${index}`,
      }),
    );
    const candidates = [...answeredRows].reverse().concat(recentRows);
    prisma.hostedMailboxItem.findMany
      .mockResolvedValueOnce(answeredRows)
      .mockResolvedValueOnce(recentRows);
    prisma.hostedMailboxPayload.findMany.mockResolvedValue(
      candidates.map((item) => ({
        mailboxItemId: item.id,
        payloadCiphertext: `sidecar:${item.id}`,
      })),
    );

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds,
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-unmatched",
      target: "chat-unmatched",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedMailboxItem.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMailboxPayload.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.runWithHostedDomainRootUnwrapCache).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMailboxItem.findMany).toHaveBeenNthCalledWith(1, {
      select: expect.any(Object),
      where: {
        createdAt: { gt: expect.any(Date) },
        id: { in: answeredMailboxItemIds },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) } },
        ],
      },
    });
    expect(prisma.hostedMailboxItem.findMany).toHaveBeenNthCalledWith(2, {
      orderBy: { laneSeq: "desc" },
      select: expect.any(Object),
      take: 100,
      where: {
        createdAt: { gt: expect.any(Date) },
        kind: "conversation.message",
        lane: "conversation",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) } },
        ],
        userId: "member-1",
      },
    });
    expect(prisma.hostedMailboxPayload.findMany).toHaveBeenCalledWith({
      select: {
        mailboxItemId: true,
        payloadCiphertext: true,
      },
      where: {
        mailboxItem: {
          createdAt: { gt: expect.any(Date) },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: expect.any(Date) } },
          ],
        },
        mailboxItemId: {
          in: candidates.map((item) => item.id),
        },
        userId: "member-1",
      },
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(200);
    expect(mocks.decodeHostedMailboxStoredPayload.mock.calls.map(
      ([decodeInput]) => decodeInput.mailboxItemId,
    )).toEqual(candidates.map((item) => item.id));
    expect(mocks.decodeHostedMailboxStoredPayload.mock.calls.map(
      ([decodeInput]) => decodeInput.payloadCiphertext,
    )).toEqual(candidates.map((item) => `sidecar:${item.id}`));

    const answeredQuery = prisma.hostedMailboxItem.findMany.mock.calls[0][0];
    const recentQuery = prisma.hostedMailboxItem.findMany.mock.calls[1][0];
    const payloadQuery = prisma.hostedMailboxPayload.findMany.mock.calls[0][0];
    expect(answeredQuery.where.createdAt.gt).toEqual(
      recentQuery.where.createdAt.gt,
    );
    expect(answeredQuery.where.OR[1].expiresAt.gt).toBe(
      recentQuery.where.OR[1].expiresAt.gt,
    );
    expect(payloadQuery.where.mailboxItem).toEqual({
      createdAt: answeredQuery.where.createdAt,
      OR: answeredQuery.where.OR,
    });
    // Pinned independently of the source constant: this scan must never reach
    // past the mailbox retention window, or it would look for rows the
    // retention sweep has already deleted.
    expect(
      answeredQuery.where.OR[1].expiresAt.gt.getTime()
      - answeredQuery.where.createdAt.gt.getTime(),
    ).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("keeps malformed refs outside payload reads and foreign rows outside decrypts", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    const malformedMemberItem = buildPersistedLinqMailboxItem({
      dedupeKey: "linq-event-malformed-sidecar",
      mailboxItemId: "mailbox-malformed-sidecar",
      occurredAt: "2026-07-14T00:09:47.000Z",
      payloadRef: "hosted-mailbox-payload:mailbox-other",
    });
    const foreignMemberItem = buildPersistedLinqMailboxItem({
      dedupeKey: "linq-event-foreign-sidecar",
      mailboxItemId: "mailbox-foreign-sidecar",
      occurredAt: "2026-07-14T00:09:48.000Z",
      payloadRef: "hosted-mailbox-payload:mailbox-foreign-sidecar",
      userId: "member-2",
    });
    prisma.hostedMailboxItem.findMany
      .mockResolvedValueOnce([malformedMemberItem, foreignMemberItem])
      .mockResolvedValueOnce([]);

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: [
        foreignMemberItem.id,
        malformedMemberItem.id,
      ],
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: "linq-message-unmatched",
      target: "chat-unmatched",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedMailboxPayload.findMany).not.toHaveBeenCalled();
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(1);
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxItemId: malformedMemberItem.id,
        payloadCiphertext: null,
        payloadInlineCiphertext: null,
        userId: "member-1",
      }),
    );
  });

  it.each([
    {
      label: "another member",
      mailboxUserId: "member-2",
      persistedChatId: "chat-inbound",
      persistedMessageId: "linq-message-current",
      requestedChatId: "chat-inbound",
      requestedMessageId: "linq-message-current",
      threadIsDirect: true,
    },
    {
      label: "a group thread",
      mailboxUserId: "member-1",
      persistedChatId: "chat-inbound",
      persistedMessageId: "linq-message-current",
      requestedChatId: "chat-inbound",
      requestedMessageId: "linq-message-current",
      threadIsDirect: false,
    },
    {
      label: "unknown directness",
      mailboxUserId: "member-1",
      persistedChatId: "chat-inbound",
      persistedMessageId: "linq-message-current",
      requestedChatId: "chat-inbound",
      requestedMessageId: "linq-message-current",
      threadIsDirect: null,
    },
    {
      label: "a different target",
      mailboxUserId: "member-1",
      persistedChatId: "chat-other",
      persistedMessageId: "linq-message-current",
      requestedChatId: "chat-inbound",
      requestedMessageId: "linq-message-current",
      threadIsDirect: true,
    },
    {
      label: "a different provider reply",
      mailboxUserId: "member-1",
      persistedChatId: "chat-inbound",
      persistedMessageId: "linq-message-other",
      requestedChatId: "chat-inbound",
      requestedMessageId: "linq-message-current",
      threadIsDirect: true,
    },
    {
      label: "a missing provider reply anchor",
      mailboxUserId: "member-1",
      persistedChatId: "chat-inbound",
      persistedMessageId: "linq-message-current",
      requestedChatId: "chat-inbound",
      requestedMessageId: null,
      threadIsDirect: true,
    },
  ])("rejects answered mailbox proof for $label", async ({
    mailboxUserId,
    persistedChatId,
    persistedMessageId,
    requestedChatId,
    requestedMessageId,
    threadIsDirect,
  }) => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    mockPersistedLinqInbound({
      chatId: persistedChatId,
      dedupeKey: "linq-event-current",
      mailboxItemId: "mailbox-current",
      messageId: persistedMessageId,
      occurredAt: "2026-07-14T00:02:47.000Z",
      prisma,
      threadIsDirect,
      userId: mailboxUserId,
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds: ["mailbox-current"],
      authorityCheckOnly: false,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      replyToMessageId: requestedMessageId,
      target: requestedChatId,
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("rejects unbounded answered mailbox authority payloads", async () => {
    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          answeredMailboxItemIds: Array.from(
            { length: 101 },
            (_, index) => `mailbox-${index}`,
          ),
          authorityCheckOnly: true,
          replyToMessageId: "linq-message-current",
          target: "chat-inbound",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_IDS_TOO_MANY",
      },
    });
  });

  it("keeps stale explicit direct-recipient targets strict", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550100001",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-stale-home",
      targetKind: "explicit",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
  });

  it.each([
    { authorityCheckOnly: undefined, label: "missing" },
    { authorityCheckOnly: "false", label: "non-boolean" },
  ])("rejects $label authorityCheckOnly", async ({ authorityCheckOnly }) => {
    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          ...(authorityCheckOnly === undefined ? {} : { authorityCheckOnly }),
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_EGRESS_AUTHORITY_CHECK_ONLY_INVALID",
      },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("requires an explicit idempotency key even when retired currentInbound proof is supplied", async () => {
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          currentInbound: {
            dedupeKey: "linq-event-retired",
            eventId: "linq-event-retired",
            mailboxItemId: "mailbox-retired",
            occurredAt: "2026-07-14T00:02:47.000Z",
            replyToMessageId: "linq-message-retired",
            target: "chat-external",
          },
          target: "chat-external",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_PROVIDER_DISPATCH_IDEMPOTENCY_REQUIRED",
      },
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("accepts a voice transcript fallback identity after route authority", async () => {
    const observedOrder: string[] = [];
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockImplementationOnce(async () => {
      observedOrder.push("member-home");
    });
    mocks.acquireHostedLinqChatOwnershipLockTx.mockImplementationOnce(async () => {
      observedOrder.push("chat");
    });
    prisma.hostedLinqDelivery.createMany.mockImplementationOnce(async () => {
      observedOrder.push("provider-dispatch");
      return { count: 1 };
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey:
            "linq-voice-memo-transcript:assistant-outbox:intent-home",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: true,
    });
    expect(observedOrder).toEqual([
      "member-home",
      "chat",
      "provider-dispatch",
    ]);
    expect(prisma.hostedLinqDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
          "linq-voice-memo-transcript:assistant-outbox:intent-home",
        ),
        sourceRef: createHostedLinqDeliverySourceRefLookupKey(
          "linq-voice-memo-transcript:assistant-outbox:intent-home",
        ),
        status: "provider_dispatch_started",
      })],
      skipDuplicates: true,
    });
  });

  it("terminalizes the exact app-card predecessor before claiming its fallback", async () => {
    const observedOrder: string[] = [];
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const predecessorLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      predecessorIdempotencyKey,
    );
    const fallbackLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      fallbackIdempotencyKey,
    );
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey === predecessorLookupKey
        ? buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-stale"),
          })
        : null
    );
    prisma.hostedLinqDelivery.updateMany.mockImplementationOnce(async () => {
      observedOrder.push("terminalize-card");
      return { count: 1 };
    });
    prisma.hostedLinqDelivery.createMany.mockImplementationOnce(async () => {
      observedOrder.push("claim-fallback");
      return { count: 1 };
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: fallbackIdempotencyKey,
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            predecessorIdempotencyKey,
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: true,
    });
    expect(observedOrder).toEqual([
      "terminalize-card",
      "claim-fallback",
    ]);
    expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        failedAt: expect.any(Date),
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        status: "failed",
      }),
      where: expect.objectContaining({
        id: "delivery-card",
        status: "provider_dispatch_started",
      }),
    });
    expect(prisma.hostedLinqDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        idempotencyKey: fallbackLookupKey,
        sourceRef: createHostedLinqDeliverySourceRefLookupKey("intent_123"),
        status: "provider_dispatch_started",
      })],
      skipDuplicates: true,
    });
  });

  it("terminalizes a thread-card predecessor before claiming participant fallback materialization", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const prisma = createPrismaStub({
      homeChatId: "chat-stale-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const predecessorLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      predecessorIdempotencyKey,
    );
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey === predecessorLookupKey
        ? buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-stale-home"),
          })
        : null
    );
    prisma.hostedLinqDelivery.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.hostedLinqDelivery.createMany.mockResolvedValueOnce({ count: 1 });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: "chat-stale-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(memberPhone);
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          fromPhoneNumber: homeLinePhone,
          idempotencyKey: fallbackIdempotencyKey,
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            predecessorIdempotencyKey,
          target: memberPhone,
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        status: "failed",
      }),
      where: expect.objectContaining({
        targetKind: "thread",
      }),
    });
    expect(prisma.hostedLinqDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(
          fallbackIdempotencyKey,
        ),
        linqChatLookupKey: null,
        memberId: "member-1",
        participantPhoneEncrypted: expect.any(String),
        participantPhoneLookupKey:
          createRequiredPhoneLookupKey(memberPhone),
        targetKind: "participant",
      })],
      skipDuplicates: true,
    });
  });

  it("re-enters an existing participant fallback claim after the home chat changes", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    const fallbackRow = buildHostedRuntimeProviderDispatchRow({
      linqChatLookupKey: null,
      memberId: "member-1",
      participantPhoneEncrypted:
        encryptHostedLinqDeliveryParticipantPhoneNumber({
          deliveryId: "delivery-card",
          phoneNumber: memberPhone,
        }),
      participantPhoneLookupKey: createRequiredPhoneLookupKey(memberPhone),
      phoneNumberLookupKey: createRequiredPhoneLookupKey(homeLinePhone),
      targetKind: "participant",
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return {
          ...buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
          }),
          failedAt: new Date("2026-08-06T12:00:01.000Z"),
          failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
          status: "failed",
        };
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return fallbackRow;
      }
      return null;
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: "chat-newer-home",
      linqRecipientPhone: homeLinePhone,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(memberPhone);
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          fromPhoneNumber: homeLinePhone,
          homeRouteFallbackAllowed: true,
          idempotencyKey: fallbackIdempotencyKey,
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            predecessorIdempotencyKey,
          target: memberPhone,
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED",
      },
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("re-enters an existing thread fallback claim after the home chat changes", async () => {
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
    });
    const fallbackRow = buildHostedRuntimeProviderDispatchRow({
      linqChatLookupKey: createHostedLinqChatLookupKey("chat-frozen-fallback"),
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return {
          ...buildHostedRuntimeProviderDispatchRow({
            linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
          }),
          failedAt: new Date("2026-08-06T12:00:01.000Z"),
          failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
          status: "failed",
        };
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return fallbackRow;
      }
      return null;
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          homeRouteFallbackAllowed: true,
          idempotencyKey: fallbackIdempotencyKey,
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            predecessorIdempotencyKey,
          target: "chat-frozen-fallback",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED",
      },
    });
    expect(mocks.readHostedMemberRoutingPrivateState).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledOnce();
    expect(prisma.hostedLinqDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linqChatLookupKey:
            createHostedLinqChatLookupKey("chat-frozen-fallback"),
          targetKind: "thread",
        }),
      }),
    );
  });

  it("rejects an app-card fallback that does not derive from its predecessor", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: "assistant-outbox:intent_other:fallback",
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            "assistant-outbox:intent_123",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_APP_CARD_FALLBACK_TRANSITION_INVALID",
      },
    });
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("rejects an app-card predecessor owned by another runtime intent", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const predecessorLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      predecessorIdempotencyKey,
    );
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) =>
      where.idempotencyKey === predecessorLookupKey
        ? buildHostedRuntimeProviderDispatchRow({
            sourceRef: createHostedLinqDeliverySourceRefLookupKey(
              "intent_other",
            ),
          })
        : null
    );
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: `${predecessorIdempotencyKey}:fallback`,
          intentId: "intent_123",
          providerDispatchPredecessorIdempotencyKey:
            predecessorIdempotencyKey,
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_APP_CARD_FALLBACK_PREDECESSOR_INVALID",
      },
    });
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("revalidates Assistant Ask authority before claiming provider dispatch", async () => {
    const observedOrder: string[] = [];
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
      .mockImplementationOnce(async () => {
        observedOrder.push("assistant-ask-authority");
      });
    prisma.hostedLinqDelivery.createMany.mockImplementationOnce(async () => {
      observedOrder.push("provider-dispatch");
      return { count: 1 };
    });
    mocks.getPrisma.mockReturnValue(prisma);
    const completionId = "aask_done_authorized";
    const idempotencyKey = "reviewed-assistant-ask-completion:authorized";

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          answeredMailboxItemIds: [completionId],
          assistantAskCompletionExpiresAt: "2026-07-16T12:10:00.000Z",
          assistantAskFallback: false,
          authorityCheckOnly: false,
          idempotencyKey,
          target: "chat-authorized-group",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: false,
    });
    expect(
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
    ).toHaveBeenCalledWith({
      answeredMailboxItemIds: [completionId],
      assistantAskCompletionExpiresAt: "2026-07-16T12:10:00.000Z",
      assistantAskFallback: false,
      boundRuntimeMemberId: "member-1",
      idempotencyKey,
      tx: expect.objectContaining({
        hostedLinqDelivery: prisma.hostedLinqDelivery,
      }),
    });
    expect(observedOrder).toEqual([
      "assistant-ask-authority",
      "provider-dispatch",
    ]);
  });

  it("keeps legacy Assistant Ask Linq egress compatible without an anchor", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: "assistant-ask-completion:legacy",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: true,
    });
    expect(
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
    ).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      assistantAskCompletionExpiresAt: undefined,
      assistantAskFallback: undefined,
      boundRuntimeMemberId: "member-1",
      idempotencyKey: "assistant-ask-completion:legacy",
      tx: expect.objectContaining({
        hostedLinqDelivery: prisma.hostedLinqDelivery,
      }),
    });
    expect(prisma.hostedLinqDelivery.createMany).toHaveBeenCalledTimes(1);
  });

  it.each(["revoked", "expired"])(
    "does not claim provider dispatch when Assistant Ask authority is %s",
    async () => {
      const prisma = createPrismaStub({
        threadRouteContainerMemberId: "member-1",
      });
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
        .mockResolvedValueOnce({ assistantAskFallbackRequired: true });
      mocks.getPrisma.mockReturnValue(prisma);

      const response = await postHostedLinqEgressEngagement(
        new Request("https://internal.example.test/engagement", {
          body: JSON.stringify({
            answeredMailboxItemIds: ["aask_done_stale"],
            assistantAskCompletionExpiresAt: "2026-07-16T12:10:00.000Z",
            assistantAskFallback: false,
            authorityCheckOnly: false,
            idempotencyKey: "reviewed-assistant-ask-completion:stale",
            target: "chat-authorized-group",
            targetKind: "thread",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        assistantAskFallbackRequired: true,
        ok: true,
        threadIsDirect: false,
      });
      expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    },
  );

  it("claims provider dispatch for an already-fixed Assistant Ask fallback", async () => {
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          answeredMailboxItemIds: ["aask_done_safe"],
          assistantAskCompletionExpiresAt: "2026-07-16T12:10:00.000Z",
          assistantAskFallback: true,
          authorityCheckOnly: false,
          idempotencyKey: "reviewed-assistant-ask-completion:safe",
          target: "chat-authorized-group",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
      threadIsDirect: false,
    });
    expect(
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      assistantAskFallback: true,
    }));
    expect(prisma.hostedLinqDelivery.createMany).toHaveBeenCalledTimes(1);
  });

  it("does not claim provider dispatch when the completion anchor is missing", async () => {
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
      .mockRejectedValueOnce(hostedOnboardingError({
        code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
        httpStatus: 403,
        message: "Hosted Assistant Ask delivery authority is no longer valid.",
        retryable: false,
      }));
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          answeredMailboxItemIds: [],
          authorityCheckOnly: false,
          idempotencyKey: "reviewed-assistant-ask-completion:missing-anchor",
          target: "chat-authorized-group",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ASSISTANT_ASK_DELIVERY_AUTHORITY_MISMATCH",
        retryable: false,
      },
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("checks route authority without claiming provider dispatch", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          idempotencyKey: "assistant-outbox:authority-only",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("reports an existing exact provider-dispatch fence during an authority-only check", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    prisma.hostedLinqDelivery.findUnique.mockResolvedValue(
      buildHostedRuntimeProviderDispatchRow(),
    );
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          idempotencyKey: "assistant-outbox:intent_123",
          intentId: "intent_123",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchStarted: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("reports an exact accepted fallback route during an authority-only check", async () => {
    const predecessorIdempotencyKey = "assistant-outbox:intent_123";
    const fallbackIdempotencyKey =
      `${predecessorIdempotencyKey}:stale-chat-fallback`;
    const prisma = createPrismaStub({
      homeChatId: "chat-newer-home",
    });
    prisma.hostedLinqDelivery.findUnique.mockImplementation(async ({ where }) => {
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(
          predecessorIdempotencyKey,
        )
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          linqChatLookupKey: createHostedLinqChatLookupKey("chat-rejected-card"),
        });
      }
      if (
        where.idempotencyKey
        === createHostedLinqDeliveryIdempotencyLookupKey(fallbackIdempotencyKey)
      ) {
        return buildHostedRuntimeProviderDispatchRow({
          acceptedAt: new Date("2026-08-06T12:00:01.000Z"),
          linqChatLookupKey:
            createHostedLinqChatLookupKey("chat-frozen-fallback"),
          messageLookupKey: "message-fallback",
          status: "accepted",
        });
      }
      return null;
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          homeRouteFallbackAllowed: true,
          idempotencyKey: fallbackIdempotencyKey,
          intentId: "intent_123",
          target: "chat-frozen-fallback",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exactFallbackRouteMatched: true,
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("returns direct audience authority with a current home-route override", async () => {
    const homeLinePhone = "+15550100099";
    const memberPhone = "+15550100001";
    const memberPhoneLookupKey = createRequiredPhoneLookupKey(memberPhone);
    if (!memberPhoneLookupKey) {
      throw new Error("Expected a member phone lookup key.");
    }
    const expectedRoute = resolveHostedMemberAssistantNotificationRoute({
      linqChatId: "chat-current-home",
      memberId: "member-1",
      messaging: resolveHostedMemberMessagingState({
        identity: { phoneLookupKey: memberPhoneLookupKey },
        routing: { linqChatId: "chat-current-home" },
      }),
    });
    if (!expectedRoute?.threadId) {
      throw new Error("Expected a canonical direct conversation locator.");
    }
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
      homeLinePhone,
      identityPhone: memberPhone,
    });
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-home",
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          homeRouteFallbackAllowed: true,
          target: "chat-stale-home",
          targetKind: "explicit",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      targetOverride: {
        conversationThreadId: expectedRoute.threadId,
        target: "chat-current-home",
        targetKind: "thread",
      },
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("returns recovery posture for an at-risk existing chat without claiming dispatch", async () => {
    const prisma = createPrismaStub({ homeChatId: "chat-home" });
    prisma.hostedLinqChatHealth.findFirst.mockResolvedValueOnce({
      linqChatLookupKey: createRequiredLinqChatLookupKey("chat-home"),
      phoneNumberLookupKey: "line-health",
      providerObservedAt: new Date("2026-07-29T16:00:00.000Z"),
      providerStatus: "AT_RISK",
      providerUpdatedAt: new Date("2026-07-29T15:59:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryPosture: "recover",
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("returns a typed block before the existing provider-dispatch claim", async () => {
    const prisma = createPrismaStub({ homeChatId: "chat-home" });
    prisma.hostedLinqChatHealth.findFirst.mockResolvedValueOnce({
      linqChatLookupKey: createRequiredLinqChatLookupKey("chat-home"),
      phoneNumberLookupKey: "line-health",
      providerObservedAt: new Date("2026-07-29T16:00:00.000Z"),
      providerStatus: "OPTED_OUT",
      providerUpdatedAt: new Date("2026-07-29T15:59:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: "assistant-outbox:health-block",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryBlockCode: "chat_opted_out",
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
    expect(mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx)
      .not.toHaveBeenCalled();
  });

  it("uses the persisted direct-route line when chat attribution and sender are absent", async () => {
    const homeLinePhone = "+15550100009";
    const homeLineLookupKey = createRequiredPhoneLookupKey(homeLinePhone);
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
      homeLinePhone,
    });
    prisma.hostedLinqChatHealth.findFirst.mockResolvedValueOnce({
      linqChatLookupKey: createRequiredLinqChatLookupKey("chat-home"),
      phoneNumberLookupKey: null,
      providerObservedAt: new Date("2026-07-29T16:00:00.000Z"),
      providerStatus: "HEALTHY",
      providerUpdatedAt: new Date("2026-07-29T15:59:00.000Z"),
    });
    prisma.hostedLinqLine.findFirst.mockResolvedValueOnce({
      egressPolicy: "enabled",
      healthStatus: "healthy",
      phoneNumberLookupKey: homeLineLookupKey,
      providerReputationStatus: "HEALTHY",
      providerServiceStatus: "FLAGGED",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: "assistant-outbox:route-line-health-block",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryBlockCode: "line_flagged",
      ok: true,
      threadIsDirect: true,
    });
    expect(prisma.hostedLinqLine.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phoneNumberLookupKey: { in: [homeLineLookupKey] },
        },
      }),
    );
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("reports an already-active provider claim without erasing its state", async () => {
    const attemptedAt = new Date("2026-06-01T12:00:00.000Z");
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    prisma.hostedLinqDelivery.findUnique.mockResolvedValueOnce({
      acceptedAt: null,
      attemptedAt,
      deliveredAt: null,
      failedAt: null,
      id: "delivery-active",
      lastReceiptAt: null,
      messageLookupKey: null,
      phoneNumberLookupKey: null,
      retryAfterAt: null,
      skippedAt: null,
      source: "hosted_runtime_linq_delivery",
      status: "provider_dispatch_started",
    });
    prisma.hostedLinqDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: false,
          idempotencyKey: "assistant-outbox:intent-active",
          target: "chat-home",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({
        code: "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED",
      }),
    });
    expect(prisma.hostedLinqDelivery.createMany).not.toHaveBeenCalled();
  });

  it("rejects a home-route override when that resolved chat became a group route", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });
    prisma.hostedThreadRoute.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildHostedLinqRouteRow("member-container")]);
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValueOnce({
      linqChatId: "chat-current-home",
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          authorityCheckOnly: true,
          homeRouteFallbackAllowed: true,
          target: "chat-stale-home",
          targetKind: "explicit",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      },
    });
    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });
});

function buildHostedRuntimeProviderDispatchRow(
  overrides: {
    acceptedAt?: Date | null;
    failedAt?: Date | null;
    failureCode?: string | null;
    linqChatLookupKey?: string | null;
    memberId?: string | null;
    participantPhoneEncrypted?: string | null;
    participantPhoneLookupKey?: string | null;
    phoneNumberLookupKey?: string | null;
    sourceRef?: string | null;
    messageLookupKey?: string | null;
    status?: string;
    targetKind?: "participant" | "thread";
  } = {},
) {
  return {
    acceptedAt: null,
    attemptedAt: new Date("2026-08-06T12:00:00.000Z"),
    deliveredAt: null,
    failureCode: null,
    failedAt: null,
    groupJoinOutreachId: null,
    groupJoinReplyOccurredAt: null,
    id: "delivery-card",
    lastReceiptAt: null,
    linqChatLookupKey: createHostedLinqChatLookupKey("chat-home"),
    memberId: null,
    messageLookupKey: null,
    participantPhoneEncrypted: null,
    participantPhoneLookupKey: null,
    phoneNumberLookupKey: null,
    retryAfterAt: null,
    skippedAt: null,
    source: "hosted_runtime_linq_delivery",
    sourceRef: createHostedLinqDeliverySourceRefLookupKey("intent_123"),
    status: "provider_dispatch_started",
    targetKind: "thread",
    template: null,
    updatedAt: new Date("2026-08-06T12:00:00.000Z"),
    ...overrides,
  };
}

function createPrismaStub(input: {
  activeMemberAccess?: boolean;
  homeChatId?: string;
  homeLinePhone?: string;
  homeParticipantContactKind?: "email" | "phone" | null;
  homeParticipantContactLookupKey?: string | null;
  identityPhone?: string;
  pendingChatId?: string;
  threadRouteContainerMemberId?: string;
}) {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(input.activeMemberAccess === false
        ? null
        : {
            accountGroupMemberships: [],
            billingStatus: "active",
            suspendedAt: null,
            threadContainer: null,
          }),
    },
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue({
        memberId: "member-1",
        phoneLookupKey: createRequiredPhoneLookupKey(input.identityPhone),
        phoneNumberEncrypted: input.identityPhone ? "encrypted-identity-phone" : null,
      }),
    },
    hostedMemberRouting: {
      findUnique: vi.fn().mockResolvedValue({
        linqChatIdEncrypted: input.homeChatId ? "encrypted-home-chat" : null,
        linqChatLookupKey: createRequiredLinqChatLookupKey(input.homeChatId),
        linqParticipantContactKind:
          input.homeParticipantContactKind ?? null,
        linqParticipantContactLookupKey:
          input.homeParticipantContactLookupKey ?? null,
        linqRecipientPhoneEncrypted: input.homeLinePhone ? "encrypted-home-line" : null,
        linqRecipientPhoneLookupKey: createRequiredPhoneLookupKey(input.homeLinePhone),
        memberId: "member-1",
        pendingLinqChatIdEncrypted: input.pendingChatId ? "encrypted-pending-chat" : null,
        pendingLinqChatLookupKey: createRequiredLinqChatLookupKey(input.pendingChatId),
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: null,
      }),
    },
    hostedMailboxItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hostedMailboxPayload: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hostedThreadRoute: {
      findMany: vi.fn().mockResolvedValue(input.threadRouteContainerMemberId
        ? [buildHostedLinqRouteRow(input.threadRouteContainerMemberId)]
        : []),
    },
    hostedLinqChatHealth: {
      findFirst: vi.fn().mockResolvedValue({
        linqChatLookupKey: "chat-default",
        phoneNumberLookupKey: "line-default",
        providerObservedAt: new Date("2026-07-29T16:00:00.000Z"),
        providerStatus: "HEALTHY",
        providerUpdatedAt: new Date("2026-07-29T15:59:00.000Z"),
      }),
    },
    hostedLinqDelivery: {
      create: vi.fn().mockResolvedValue({ id: "delivery-1" }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    hostedLinqLine: {
      findFirst: vi.fn().mockResolvedValue({
        egressPolicy: "enabled",
        healthStatus: "healthy",
        phoneNumberLookupKey: "line-default",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      }),
      findUnique: vi.fn().mockResolvedValue(input.homeLinePhone
        ? {
            phoneNumberEncrypted: input.homeLinePhone,
            phoneNumberLookupKey:
              createRequiredPhoneLookupKey(input.homeLinePhone),
          }
        : null),
      findMany: vi.fn().mockResolvedValue(input.homeLinePhone
        ? [{
            phoneNumberLookupKey:
              createRequiredPhoneLookupKey(input.homeLinePhone),
          }]
        : []),
      update: vi.fn().mockResolvedValue({
        phoneNumberLookupKey:
          createRequiredPhoneLookupKey(input.homeLinePhone) ?? "line-default",
      }),
      upsert: vi.fn().mockResolvedValue({
        phoneNumberLookupKey:
          createRequiredPhoneLookupKey(input.homeLinePhone) ?? "line-default",
      }),
    },
  };
  const transaction = vi.fn(async (
    operation: (tx: typeof prisma) => Promise<unknown>,
  ) => operation(prisma));

  return {
    ...prisma,
    $transaction: transaction,
  };
}

function mockPersistedLinqInbound(input: {
  chatId: string;
  dedupeKey: string;
  mailboxItemId: string;
  messageId: string;
  occurredAt: string;
  prisma: ReturnType<typeof createPrismaStub>;
  threadIsDirect: boolean | null;
  userId?: string;
}) {
  const userId = input.userId ?? "member-1";
  input.prisma.hostedMailboxItem.findMany.mockResolvedValue([
    buildPersistedLinqMailboxItem({
      dedupeKey: input.dedupeKey,
      mailboxItemId: input.mailboxItemId,
      occurredAt: input.occurredAt,
      userId,
    }),
  ]);
  mocks.decodeHostedMailboxStoredPayload.mockResolvedValue({
    eventId: input.dedupeKey,
    kind: "conversation.message",
    message: {
      channel: "linq",
      contactKind: "phone",
      contactLookupKey: "hbidx:phone:v1:contact",
      linqMessage: {
        chatId: input.chatId,
        from: "+15550100001",
        isFromMe: false,
        messageId: input.messageId,
        parts: [{ type: "text", value: "hello" }],
        threadIsDirect: input.threadIsDirect,
      },
      ...(input.threadIsDirect === false
        ? {
            routeAuthority: {
              channel: "linq",
              containerMemberId: userId,
              threadId: input.chatId,
            },
          }
        : {}),
    },
    occurredAt: input.occurredAt,
    userId,
  });
}

function buildPersistedLinqMailboxItem(input: {
  dedupeKey: string;
  mailboxItemId: string;
  occurredAt: string;
  payloadRef?: string | null;
  userId?: string;
}) {
  return {
    createdAt: new Date(input.occurredAt),
    dedupeKey: input.dedupeKey,
    expiresAt: null,
    id: input.mailboxItemId,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
    occurredAt: new Date(input.occurredAt),
    payloadInlineCiphertext: input.payloadRef
      ? null
      : "encrypted-mailbox-payload",
    payloadRef: input.payloadRef ?? null,
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    userId: input.userId ?? "member-1",
  };
}

function buildHostedLinqRouteRow(containerMemberId: string) {
  const routeTimestamp = new Date("2026-06-01T00:00:00.000Z");
  return {
    channel: "linq",
    container: {
      member: {
        billingStatus: "inactive",
        createdAt: routeTimestamp,
        id: containerMemberId,
        suspendedAt: null,
        updatedAt: routeTimestamp,
      },
      owner: {
        accountGroupMemberships: [],
        billingStatus: "active",
        createdAt: routeTimestamp,
        id: "owner-1",
        suspendedAt: null,
        updatedAt: routeTimestamp,
      },
    },
    containerMemberId,
  };
}

function asRuntimeEngagementPrisma(
  prisma: ReturnType<typeof createPrismaStub>,
): Parameters<typeof assertHostedLinqRecentInboundEngagementForRuntime>[0]["prisma"] {
  return prisma as never;
}

function createRequiredPhoneLookupKey(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const lookupKey = createHostedPhoneLookupKey(value);
  if (!lookupKey) {
    throw new Error("Expected phone lookup key.");
  }
  return lookupKey;
}

function createRequiredLinqChatLookupKey(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const lookupKey = createHostedLinqChatLookupKey(value);
  if (!lookupKey) {
    throw new Error("Expected Linq chat lookup key.");
  }
  return lookupKey;
}
