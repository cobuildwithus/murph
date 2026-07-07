import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >();

  return {
    ...original,
    readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
  };
});

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

describe("hosted Linq egress engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member-1");
  });

  it("allows explicit signup welcome first contact for the bound runtime user", async () => {
    const prisma = createPrismaStub({
      identityPhone: "+15550100001",
      homeLinePhone: "+15550100099",
    });

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      engagementKind: "first_contact",
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
      engagementKind: "first_contact",
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
      code: "HOSTED_LINQ_FIRST_CONTACT_AUTHORITY_MISMATCH",
      httpStatus: 403,
    });
  });

  it("allows participant replies only when participant identity and source line match", async () => {
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
    })).resolves.toBeUndefined();

    await expect(assertHostedLinqRecentInboundEngagementForRuntime({
      fromPhoneNumber: "+15550100100",
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
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

  it("preserves route-authority validation for bound external threads", async () => {
    const prisma = createPrismaStub({
      routeThreadId: "chat-authorized",
      routeContainerMemberId: "member-1",
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
    })).resolves.toBeUndefined();

    expect(prisma.hostedThreadRoute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: "linq",
        }),
      }),
    );
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: asRuntimeEngagementPrisma(prisma),
    });

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

  it("accepts old-runner currentInbound payloads for external thread engagement assertions", async () => {
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
          engagementKind: "requires_recent_inbound",
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
  homeChatId?: string;
  homeLinePhone?: string;
  identityPhone?: string;
  pendingChatId?: string;
  routeContainerMemberId?: string;
  routeThreadId?: string;
}) {
  return {
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
      findMany: vi.fn().mockResolvedValue(input.routeThreadId
        ? [buildThreadRouteRow({
            containerMemberId: input.routeContainerMemberId ?? "member-1",
          })]
        : []),
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

function buildThreadRouteRow(input: {
  containerMemberId: string;
}) {
  return {
    channel: "linq",
    container: {
      member: buildMemberAccessRecord(input.containerMemberId),
      owner: buildMemberAccessRecord("owner-1"),
    },
    containerMemberId: input.containerMemberId,
  };
}

function buildMemberAccessRecord(id: string) {
  return {
    accountGroupMemberships: [],
    billingStatus: "active",
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    id,
    suspendedAt: null,
    threadContainer: null,
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
  };
}
