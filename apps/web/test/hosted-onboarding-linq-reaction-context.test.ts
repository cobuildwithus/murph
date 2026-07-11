import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  getHostedLinqReactionTargetMessage: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage: mocks.getHostedLinqReactionTargetMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity: mocks.readHostedThreadRouteByThreadIdentity,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import { stageHostedLinqGroupReactionContext } from "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction";
import { createPrismaClient } from "@/src/lib/prisma";

describe("stageHostedLinqGroupReactionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      containerMemberId: "member_group_1",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.getHostedLinqChatSummary.mockResolvedValue({
      handles: [{
        handle: "+15550000000",
        isMe: true,
        status: "active",
      }],
      isGroup: true,
    });
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
      chatId: "chat_group_1",
      id: "message_target_1",
      isFromMe: false,
      parts: [
        { type: "text", value: "first target part" },
        { type: "text", value: "second target part" },
      ],
      service: "iMessage",
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: false,
      item: { id: "mailbox_reaction_1" },
    });
  });

  it("stages exact-part reaction context without creating wake authority", async () => {
    const prisma = createPrismaStub();
    const result = await stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({
        partIndex: 1,
      }),
      prisma,
    });

    expect(result).toEqual({
      duplicate: false,
      mailboxItemId: "mailbox_reaction_1",
      status: "staged",
      userId: "member_group_1",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_group_1",
    });
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      eventId: "event_reaction_1",
      kind: "conversation.reaction",
      message: {
        channel: "linq",
        accountLookupKey: expect.any(String),
        linqMessage: {
          chatId: "chat_group_1",
          from: "+15551234567",
          isFromMe: false,
          messageId: "event_reaction_1",
          reactionEligible: false,
          threadIsDirect: false,
        },
        routeAuthority: {
          accountLookupKey: expect.any(String),
          channel: "linq",
          containerMemberId: "member_group_1",
          threadId: "chat_group_1",
        },
      },
      userId: "member_group_1",
    });
    const text = envelope.message.linqMessage.parts[0].value;
    expect(text).toContain("Action: added reaction like");
    expect(text).toContain("second target part");
    expect(text).not.toContain("first target part");
  });

  it("preserves a removal against the full target when no part index is supplied", async () => {
    const prisma = createPrismaStub();
    await stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({
        eventId: "event_reaction_removed_1",
        eventType: "reaction.removed",
        partIndex: null,
      }),
      prisma,
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const text = envelope.message.linqMessage.parts[0].value;
    expect(text).toContain("Action: removed reaction like");
    expect(text).toContain("first target part");
    expect(text).toContain("second target part");
  });

  it("fails closed for own reactions and unknown group routes", async () => {
    const prisma = createPrismaStub();
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ isFromMe: true }),
      prisma,
    })).resolves.toEqual({
      reason: "own_reaction",
      status: "ignored",
    });
    expect(mocks.readHostedThreadRouteByThreadIdentity).not.toHaveBeenCalled();

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ eventId: "event_reaction_no_route" }),
      prisma,
    })).resolves.toEqual({
      reason: "route_missing",
      status: "ignored",
    });
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical group has no unique self-owned line", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [{
        handle: "+15551111111",
        isMe: false,
        status: "active",
      }],
      isGroup: true,
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ eventId: "event_reaction_no_line" }),
      prisma,
    })).resolves.toEqual({
      reason: "missing_context",
      status: "ignored",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("rejects target identity and part-index mismatches", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
      chatId: "different_chat",
      id: "message_target_1",
      isFromMe: false,
      parts: [{ type: "text", value: "private target" }],
      service: "iMessage",
    });
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({}),
      prisma,
    })).resolves.toEqual({
      reason: "invalid_target",
      status: "ignored",
    });

    mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
      chatId: "chat_group_1",
      id: "message_target_1",
      isFromMe: false,
      parts: [{ type: "text", value: "private target" }],
      service: "iMessage",
    });
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ eventId: "event_reaction_bad_part", partIndex: 3 }),
      prisma,
    })).resolves.toEqual({
      reason: "invalid_target",
      status: "ignored",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("retries transient target reads and ignores permanent misses", async () => {
    const prisma = createPrismaStub();
    mocks.getHostedLinqReactionTargetMessage.mockRejectedValueOnce(
      new HostedOnboardingError({
        code: "LINQ_MESSAGE_READ_FAILED",
        httpStatus: 503,
        message: "temporary target read failure",
        retryable: true,
      }),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({}),
      prisma,
    })).rejects.toMatchObject({
      code: "LINQ_MESSAGE_READ_FAILED",
      retryable: true,
    });

    mocks.getHostedLinqReactionTargetMessage.mockRejectedValueOnce(
      new HostedOnboardingError({
        code: "LINQ_MESSAGE_READ_FAILED",
        httpStatus: 404,
        message: "target missing",
        retryable: false,
      }),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ eventId: "event_reaction_missing_target" }),
      prisma,
    })).resolves.toEqual({
      reason: "target_unavailable",
      status: "ignored",
    });
  });

  it("deduplicates before repeating the provider target read", async () => {
    const prisma = createPrismaStub();
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: "mailbox_existing_reaction",
    });

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({}),
      prisma,
    })).resolves.toEqual({
      duplicate: true,
      mailboxItemId: "mailbox_existing_reaction",
      status: "staged",
      userId: "member_group_1",
    });
    expect(mocks.getHostedLinqReactionTargetMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});

function buildReactionEvent(input: {
  eventId?: string;
  eventType?: "reaction.added" | "reaction.removed";
  isFromMe?: boolean;
  partIndex?: number | null;
}) {
  const event = parseHostedLinqProviderEvent({
    event: {
      api_version: "2026-02-03",
      created_at: "2026-07-10T12:00:00.000Z",
      data: {
        chat_id: "chat_group_1",
        from_handle: {
          handle: "+15551234567",
          is_me: input.isFromMe ?? false,
          service: "iMessage",
        },
        message_id: "message_target_1",
        part_index: input.partIndex === undefined ? 0 : input.partIndex,
        reacted_at: "2026-07-10T12:00:00.000Z",
        reaction_type: "like",
      },
      event_id: input.eventId ?? "event_reaction_1",
      event_type: input.eventType ?? "reaction.added",
    },
  });
  if (!event) {
    throw new Error("Expected a parsed reaction event.");
  }
  return event;
}

function createPrismaStub() {
  const prisma = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: vi.fn(async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
      callback(prisma)),
  });
  return prisma;
}
