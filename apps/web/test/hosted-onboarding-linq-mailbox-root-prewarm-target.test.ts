import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMocks = vi.hoisted(() => ({
  hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >();
  return {
    ...actual,
    readActiveHostedMemberAccess: accessMocks.readActiveHostedMemberAccess,
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    hasActiveHostedCryptoDomainRootsForUserTx:
      accessMocks.hasActiveHostedCryptoDomainRootsForUserTx,
  };
});

import {
  parseHostedLinqWebhookEvent,
  requireHostedLinqTypingIndicatorStartedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
  resolveHostedLinqTypingPrewarmMemberId,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";

function buildMessageEvent(input: {
  chatIsGroup?: boolean;
  contact?: string;
  isFromMe?: boolean;
} = {}) {
  return parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-07-26T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_prewarm_target",
        ...(input.chatIsGroup === undefined
          ? {}
          : { is_group: input.chatIsGroup }),
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_prewarm_target",
          is_me: true,
          service: "sms",
        },
      },
      direction: input.isFromMe ? "outbound" : "inbound",
      id: "msg_prewarm_target",
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: input.contact ?? "+15555550123",
        id: "handle_sender_prewarm_target",
        service: "sms",
      },
      sent_at: "2026-07-26T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_prewarm_target",
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));
}

function buildTypingEvent() {
  return requireHostedLinqTypingIndicatorStartedEvent(
    parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3",
      created_at: "2026-08-09T12:00:00.000Z",
      data: {
        chat_id: "chat_prewarm_target",
      },
      event_id: "evt_typing_prewarm_target",
      event_type: "chat.typing_indicator.started",
    })),
  );
}

function buildPrisma(input: {
  emailMemberIds?: string[];
  homeMemberIds?: string[];
  pendingMemberIds?: string[];
  phoneMemberIds?: string[];
} = {}) {
  const hostedMemberIdentity = {
    findMany: vi.fn(async () =>
      (input.phoneMemberIds ?? []).map((memberId) => ({ memberId }))
    ),
  };
  const hostedMemberEmailAuthorization = {
    findMany: vi.fn(async () =>
      (input.emailMemberIds ?? []).map((memberId) => ({ memberId }))
    ),
  };
  const hostedMemberRouting = {
    findMany: vi.fn(async ({ where }) => {
      const memberIds = "linqChatLookupKey" in where
        ? input.homeMemberIds ?? []
        : input.pendingMemberIds ?? [];
      return memberIds.map((memberId) => ({ memberId }));
    }),
  };

  return {
    hostedMemberEmailAuthorization,
    hostedMemberIdentity,
    hostedMemberRouting,
  };
}

describe("hosted Linq mailbox-root prewarm target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessMocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    accessMocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(true);
  });

  it("uses narrow phone and home-chat lookups for an active direct member", async () => {
    const prisma = buildPrisma({
      phoneMemberIds: ["member_direct"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBe("member_direct");

    expect(prisma.hostedMemberIdentity.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        phoneLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:phone:/u),
          ]),
        },
      },
    });
    expect(prisma.hostedMemberRouting.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        linqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:/u),
          ]),
        },
      },
    });
    expect(accessMocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_direct",
      prisma,
    });
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx)
      .toHaveBeenCalledWith({
        tx: prisma,
        userId: "member_direct",
      });
  });

  it("resolves typing only through an established eligible home chat", async () => {
    const prisma = buildPrisma({
      homeMemberIds: ["member_typing"],
      phoneMemberIds: ["member_unrelated"],
    });

    await expect(resolveHostedLinqTypingPrewarmMemberId({
      event: buildTypingEvent(),
      prisma: prisma as never,
    })).resolves.toBe("member_typing");

    expect(prisma.hostedMemberRouting.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        linqChatLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:linq-chat:/u),
          ]),
        },
      },
    });
    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
    expect(accessMocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_typing",
      prisma,
    });
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx)
      .toHaveBeenCalledWith({
        tx: prisma,
        userId: "member_typing",
      });
  });

  it("fails typing prewarm closed for missing, ambiguous, or ineligible home chats", async () => {
    const missingPrisma = buildPrisma();
    await expect(resolveHostedLinqTypingPrewarmMemberId({
      event: buildTypingEvent(),
      prisma: missingPrisma as never,
    })).resolves.toBeNull();
    expect(accessMocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();

    const ambiguousPrisma = buildPrisma({
      homeMemberIds: ["member_one", "member_two"],
    });
    await expect(resolveHostedLinqTypingPrewarmMemberId({
      event: buildTypingEvent(),
      prisma: ambiguousPrisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
      retryable: true,
    });

    accessMocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    const inactivePrisma = buildPrisma({
      homeMemberIds: ["member_inactive"],
    });
    await expect(resolveHostedLinqTypingPrewarmMemberId({
      event: buildTypingEvent(),
      prisma: inactivePrisma as never,
    })).resolves.toBeNull();
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
  });

  it("uses only verified email blind indexes for an active email participant", async () => {
    const prisma = buildPrisma({
      emailMemberIds: ["member_email"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ contact: "person@example.com" }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBe("member_email");

    expect(prisma.hostedMemberEmailAuthorization.findMany).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        verifiedEmailLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:email:/u),
          ]),
        },
        verifiedEmailVerifiedAt: {
          not: null,
        },
      },
    });
    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("fails the speculative prewarm closed on an ambiguous identity lookup", async () => {
    const prisma = buildPrisma({
      phoneMemberIds: ["member_one", "member_two"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent(),
      prisma: prisma as never,
      threadRoute: null,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      retryable: true,
    });

    expect(accessMocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
  });

  it("deduplicates lookup-key rotation matches for the same member", async () => {
    const prisma = buildPrisma({
      phoneMemberIds: ["member_direct", "member_direct"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent(),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBe("member_direct");
  });

  it("fails closed when the current home-chat owner differs from identity", async () => {
    const prisma = buildPrisma({
      homeMemberIds: ["member_home_owner"],
      phoneMemberIds: ["member_identity"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBeNull();

    expect(accessMocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();
  });

  it("falls back to a pending contact only when identity and home chat are absent", async () => {
    const prisma = buildPrisma({
      pendingMemberIds: ["member_pending"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBe("member_pending");

    expect(prisma.hostedMemberRouting.findMany).toHaveBeenCalledTimes(2);
    expect(accessMocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_pending",
      prisma,
    });
  });

  it("uses an established group route without speculative identity lookup", async () => {
    const prisma = buildPrisma();

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: true }),
      prisma: prisma as never,
      threadRoute: {
        containerMemberId: "member_group_container",
      },
    })).resolves.toBe("member_group_container");

    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findMany).not.toHaveBeenCalled();
  });

  it("skips inactive members and members without the complete root set", async () => {
    const prisma = buildPrisma({
      phoneMemberIds: ["member_direct"],
    });
    accessMocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBeNull();
    expect(accessMocks.hasActiveHostedCryptoDomainRootsForUserTx).not.toHaveBeenCalled();

    accessMocks.readActiveHostedMemberAccess.mockResolvedValueOnce(true);
    accessMocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValueOnce(false);
    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBeNull();
  });

  it("does not speculate for a new group or an own message", async () => {
    const prisma = buildPrisma({
      phoneMemberIds: ["member_direct"],
    });

    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: true }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBeNull();
    await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
      event: buildMessageEvent({ chatIsGroup: false, isFromMe: true }),
      prisma: prisma as never,
      threadRoute: null,
    })).resolves.toBeNull();

    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findMany).not.toHaveBeenCalled();
  });
});
