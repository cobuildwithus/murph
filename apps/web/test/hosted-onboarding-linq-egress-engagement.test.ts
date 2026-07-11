import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  readHostedMemberRoutingPrivateState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", () => ({
  readHostedMemberRoutingPrivateState:
    mocks.readHostedMemberRoutingPrivateState,
}));

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import { POST as postHostedLinqEgressEngagement } from "../app/api/internal/hosted-runtime/linq-egress/engagement/route";

describe("hosted Linq egress authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member-1");
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
  });

  it("allows explicit signup welcome first contact for the bound runtime user", async () => {
    const prisma = createPrismaStub({
      identityPhone: "+15550100001",
      homeLinePhone: "+15550100099",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member-1",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100001",
      targetKind: "participant",
    })).resolves.toEqual({ targetOverride: null });

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
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-home",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-pending",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-other",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("allows same-user route authority only while the durable route still matches", async () => {
    const prisma = createPrismaStub({
      threadRouteContainerMemberId: "member-1",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-authorized",
      },
      target: "chat-authorized",
      targetKind: "thread",
    })).resolves.toEqual({ targetOverride: null });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-2",
        threadId: "chat-authorized",
      },
      target: "chat-authorized",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
    });
  });

  it("rejects same-user route authority when hosted member access is inactive", async () => {
    const prisma = createPrismaStub({
      activeMemberAccess: false,
      threadRouteContainerMemberId: "member-1",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-authorized",
      },
      target: "chat-authorized",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      httpStatus: 403,
    });

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();
  });

  it("rejects stale same-user route authority before durable home-route fallback", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-stale",
      },
      target: "chat-home",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
  });

  it("returns a current home-route override for stale bare Linq home targets", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
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
      homeRouteFallbackAllowed: true,
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-stale-home",
      targetKind: "explicit",
    })).resolves.toEqual({
      targetOverride: {
        target: "chat-current-home",
        targetKind: "thread",
      },
    });

    expect(mocks.readHostedMemberRoutingPrivateState).toHaveBeenCalledTimes(1);
  });

  it("keeps stale bare Linq targets strict without home-route proof", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
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

  it("keeps stale reply targets strict instead of returning a home-route override", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
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

  it("keeps stale explicit direct-recipient targets strict", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-current-home",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
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

  it("keeps direct route-authority target matching strict", () => {
    expect(assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: "chat-1",
      memberId: "member-1",
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-1",
      },
    })).toMatchObject({
      channel: "linq",
      containerMemberId: "member-1",
      threadId: "chat-1",
    });

    expect(() => assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: "chat-2",
      memberId: "member-1",
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:line-1",
        channel: "linq",
        containerMemberId: "member-1",
        threadId: "chat-1",
      },
    })).toThrow(/Linq egress route authority/u);
  });

  it("accepts old-runner currentInbound payloads for external thread egress authority", async () => {
    const prisma = createPrismaStub({
      homeChatId: "chat-home",
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await postHostedLinqEgressEngagement(
      new Request("https://internal.example.test/engagement", {
        body: JSON.stringify({
          currentInbound: {
            dedupeKey: "linq_external_event",
            eventId: "linq_external_event",
            mailboxItemId: "mailbox_external",
            occurredAt: "2026-06-01T12:00:00.000Z",
            replyToMessageId: "message_external",
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

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedLinqDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linqChatLookupKey: createRequiredLinqChatLookupKey("chat-external"),
        source: "hosted_runtime_linq_delivery",
        status: "attempted",
        targetKind: "thread",
      }),
      select: { id: true },
    });
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
    expect(prisma.hostedLinqDelivery.create).not.toHaveBeenCalled();
  });
});

function createPrismaStub(input: {
  activeMemberAccess?: boolean;
  homeChatId?: string;
  homeLinePhone?: string;
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
        phoneLookupKey: createRequiredPhoneLookupKey(input.identityPhone),
      }),
    },
    hostedMemberRouting: {
      findUnique: vi.fn().mockResolvedValue({
        linqChatIdEncrypted: input.homeChatId ? "encrypted-home-chat" : null,
        linqChatLookupKey: createRequiredLinqChatLookupKey(input.homeChatId),
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
    hostedThreadRoute: {
      findMany: vi.fn().mockResolvedValue(input.threadRouteContainerMemberId
        ? [buildHostedLinqRouteRow(input.threadRouteContainerMemberId)]
        : []),
    },
    hostedLinqDelivery: {
      create: vi.fn().mockResolvedValue({ id: "delivery-1" }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(null),
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
