import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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
    })).resolves.toBeUndefined();

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
    })).resolves.toBeUndefined();

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "chat-pending",
      targetKind: "thread",
    })).resolves.toBeUndefined();

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

  it("allows same-user route authority without a DB route assertion", async () => {
    const prisma = createPrismaStub({});

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
    })).resolves.toBeUndefined();

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
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
      code: "HOSTED_LINQ_EGRESS_ACCESS_REQUIRED",
      httpStatus: 403,
    });

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalled();
  });

  it("falls back to the durable home route when same-user route authority is stale", async () => {
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
    })).resolves.toBeUndefined();

    expect(prisma.hostedThreadRoute.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        linqRecipientPhoneLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqRecipientPhoneLookupKey: true,
      },
      where: { memberId: "member-1" },
    });
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
  });
});

function createPrismaStub(input: {
  activeMemberAccess?: boolean;
  homeChatId?: string;
  homeLinePhone?: string;
  identityPhone?: string;
  pendingChatId?: string;
}) {
  return {
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
        linqChatLookupKey: createRequiredLinqChatLookupKey(input.homeChatId),
        linqRecipientPhoneLookupKey: createRequiredPhoneLookupKey(input.homeLinePhone),
        pendingLinqChatLookupKey: createRequiredLinqChatLookupKey(input.pendingChatId),
        pendingLinqRecipientPhoneLookupKey: null,
      }),
    },
    hostedThreadRoute: {
      findMany: vi.fn().mockResolvedValue([]),
    },
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
