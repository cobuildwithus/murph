import type { Prisma, PrismaClient } from "@prisma/client";
import {
  parseHostedExecutionGroupReactionEventText,
  readHostedExecutionConversationMessageText,
} from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendConsumedHostedGroupReactionMailboxEnvelopeTx: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  getHostedLinqReactionTargetMessage: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage:
    mocks.getHostedLinqReactionTargetMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/group-reaction-mailbox", () => ({
  appendConsumedHostedGroupReactionMailboxEnvelopeTx:
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
}));

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  buildHostedLinqAffirmativeReactionMessageEvent,
  stageHostedLinqGroupReactionContext,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context";

const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

beforeEach(() => {
  vi.clearAllMocks();
  configureHostedContactPrivacyKeyringForTest();
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
    containerMemberId: "member_group_123",
  });
  mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
  mocks.getHostedLinqChatSummary.mockResolvedValue({
    handles: [
      { handle: "+15550000000", isMe: true, status: "active" },
      { handle: "+15551234567", isMe: false, status: "active" },
    ],
    isGroup: true,
  });
  mocks.getHostedLinqReactionTargetMessage.mockResolvedValue({
    chatId: "chat_group_123",
    id: "message_target_123",
    isFromMe: false,
    parts: ["A useful group message"],
    service: "iMessage",
  });
  mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: {
      id: "mailbox_reaction_123",
      lane: "conversation",
      laneSeq: "41",
    },
  });
  mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:member_group_123",
  });
});

afterEach(() => {
  delete process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  clearHostedOnboardingEnvCache();
});

describe("stageHostedLinqGroupReactionContext", () => {
  it.each([
    ["laugh", undefined, "added", "laugh"],
    ["dislike", undefined, "added", "dislike"],
    ["emphasize", undefined, "added", "emphasize"],
    ["question", undefined, "added", "question"],
    ["custom", "😂", "added", "😂"],
    ["custom", "🔥", "added", "🔥"],
    ["heart", undefined, "removed", "heart"],
  ])(
    "persists %s %s as a consumed mailbox conversation item",
    async (reactionType, customEmoji, operation, expectedReaction) => {
      const eventType = operation === "removed"
        ? "reaction.removed"
        : "reaction.added";
      const prisma = createPrismaStub();

      await expect(stageHostedLinqGroupReactionContext({
        event: buildReactionEvent({
          customEmoji,
          eventType,
          reactionType,
        }),
        prisma,
      })).resolves.toBe(true);

      expect(
        mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
      ).toHaveBeenCalledTimes(1);
      const appendInput =
        mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0];
      const envelope = appendInput?.envelope;
      expect(envelope).toMatchObject({
        eventId: "group-reaction:event_reaction_123",
        kind: "conversation.message",
        message: {
          channel: "linq",
          linqMessage: {
            chatId: "chat_group_123",
            from: "group-reaction",
            isFromMe: false,
            messageId: "group-reaction:event_reaction_123",
            reactionEligible: false,
            replyToMessageId: "message_target_123",
            threadIsDirect: false,
          },
          routeAuthority: {
            channel: "linq",
            containerMemberId: "member_group_123",
            threadId: "chat_group_123",
          },
        },
        occurredAt: "2026-07-14T12:00:00.000Z",
        userId: "member_group_123",
      });
      const text = envelope
        ? readHostedExecutionConversationMessageText(envelope.message)
        : null;
      expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
        actor: "+15551234567",
        changes: [{
          operation,
          reaction: expectedReaction,
        }],
        channel: "linq",
        mode: "delta",
        schema: "murph.hosted-group-reaction.v1",
        targetMessageId: "message_target_123",
        targetText: "A useful group message",
      });
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        expectedUserId: "member_group_123",
        knownCheckpoint: {
          lane: "conversation",
          laneSeq: "41",
          userId: "member_group_123",
        },
        mailboxItemId: "mailbox_reaction_123",
        prisma,
      });
    },
  );

  it("persists the reaction even when target text cannot be fetched", async () => {
    mocks.getHostedLinqReactionTargetMessage.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({
        customEmoji: "😂",
        reactionType: "custom",
      }),
      prisma: createPrismaStub(),
    })).resolves.toBe(true);

    const envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      targetMessageId: "message_target_123",
      targetText: null,
    });
  });

  it("uses only the exact reacted part when the provider supplies it", async () => {
    mocks.getHostedLinqReactionTargetMessage.mockResolvedValueOnce({
      chatId: "chat_group_123",
      id: "message_target_123",
      parts: ["first part", "second part"],
    });

    await stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ partIndex: 1, reactionType: "laugh" }),
      prisma: createPrismaStub(),
    });

    const envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      targetText: "second part",
    });
    expect(envelope.message.linqMessage.replyToPartIndex).toBe(1);
  });

  it("rejects self echoes, missing routes, inactive containers, and direct chats", async () => {
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ isFromMe: true, reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      containerMemberId: "member_group_123",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    mocks.getHostedLinqChatSummary.mockResolvedValueOnce({
      handles: [
        { handle: "+15550000000", isMe: true, status: "active" },
        { handle: "+15551234567", isMe: false, status: "active" },
      ],
      isGroup: false,
    });
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma,
    })).resolves.toBe(false);

    expect(
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
    ).not.toHaveBeenCalled();
  });

  it("fails the webhook when the durable append or signal fails so a provider retry can replay it", async () => {
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("mailbox unavailable"),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma: createPrismaStub(),
    })).rejects.toThrow("mailbox unavailable");

    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("signal unavailable"),
    );
    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent({ reactionType: "laugh" }),
      prisma: createPrismaStub(),
    })).rejects.toThrow("signal unavailable");
  });
});

describe("buildHostedLinqAffirmativeReactionMessageEvent", () => {
  it.each([
    ["like", undefined, "Reacted with a like reaction."],
    ["heart", undefined, "Reacted with a heart reaction."],
    ["custom", "👍", "Reacted with 👍."],
    ["custom", "❤", "Reacted with ❤."],
  ])(
    "keeps qualifying %s additions on the ordinary durable reply path",
    async (reactionType, customEmoji, expectedText) => {
      await expect(buildHostedLinqAffirmativeReactionMessageEvent({
        event: buildReactionEvent({ customEmoji, reactionType }),
      })).resolves.toMatchObject({
        data: {
          message: {
            id: "event_reaction_123",
            parts: [{ type: "text", value: expectedText }],
            reply_to: { message_id: "message_target_123" },
          },
        },
        event_id: "event_reaction_123",
        event_type: "message.received",
      });
    },
  );

  it("leaves laughs and removals on the consumed context-only path", async () => {
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent({ reactionType: "laugh" }),
    })).resolves.toBeNull();
    await expect(buildHostedLinqAffirmativeReactionMessageEvent({
      event: buildReactionEvent({
        eventType: "reaction.removed",
        reactionType: "heart",
      }),
    })).resolves.toBeNull();
  });
});

function buildReactionEvent(input: {
  customEmoji?: string;
  eventType?: "reaction.added" | "reaction.removed";
  isFromMe?: boolean;
  partIndex?: number;
  reactionType?: string;
} = {}) {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-07-14T12:00:00.000Z",
      data: {
        chat_id: "chat_group_123",
        custom_emoji: input.customEmoji,
        from: "+15551234567",
        is_from_me: input.isFromMe ?? false,
        message_id: "message_target_123",
        part_index: input.partIndex,
        reaction_type: input.reactionType ?? "like",
      },
      event_id: "event_reaction_123",
      event_type: input.eventType ?? "reaction.added",
      trace_id: "trace_reaction_123",
      webhook_version: "2026-02-03",
    } as HostedLinqWebhookEvent,
  });
  if (!parsed) {
    throw new Error("Expected reaction provider event to parse.");
  }
  return parsed;
}

function createPrismaStub(): PrismaClient {
  const transactionClient = {} as Prisma.TransactionClient;
  return Object.assign(Object.create(null), {
    $transaction: vi.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  }) as PrismaClient;
}

function configureHostedContactPrivacyKeyringForTest(): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}
