import type { Prisma, PrismaClient } from "@prisma/client";
import {
  parseHostedExecutionGroupReactionEventText,
  readHostedExecutionConversationMessageText,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendConsumedHostedGroupReactionMailboxEnvelopeTx: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/group-reaction-mailbox", () => ({
  appendConsumedHostedGroupReactionMailboxEnvelopeTx:
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  handleHostedTelegramGroupReactionWebhook,
} from "@/src/lib/hosted-onboarding/telegram-group-reactions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
    containerMemberId: "member_telegram_group",
  });
  mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
  mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockResolvedValue({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: {
      id: "mailbox_telegram_reaction",
      lane: "conversation",
      laneSeq: "17",
    },
  });
  mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:member_telegram_group",
  });
});

describe("handleHostedTelegramGroupReactionWebhook", () => {
  it("persists every added and removed per-user reaction as one consumed conversation item", async () => {
    const prisma = createPrismaStub();

    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message_reaction: {
          chat: { id: -100123, type: "supergroup" },
          date: 1_785_000_000,
          message_id: 91,
          new_reaction: [
            { emoji: "😂", type: "emoji" },
            { type: "paid" },
          ],
          old_reaction: [
            { emoji: "❤", type: "emoji" },
            { custom_emoji_id: "custom-old", type: "custom_emoji" },
          ],
          user: {
            first_name: "Alice",
            id: 42,
            username: "alice",
          },
        },
        update_id: 123,
      }),
    })).resolves.toEqual({
      ok: true,
      reason: "durable-telegram-group-reaction",
    });

    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "telegram",
      prisma,
      threadId: "-100123",
    });
    const appendInput =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0];
    const envelope = appendInput?.envelope;
    expect(envelope).toMatchObject({
      eventId: "group-reaction:telegram:update:123",
      kind: "conversation.message",
      message: {
        channel: "telegram",
        routeAuthority: {
          channel: "telegram",
          containerMemberId: "member_telegram_group",
          threadId: "-100123",
        },
        telegramMessage: {
          from: "group-reaction",
          messageId: "group-reaction:telegram:update:123",
          threadId: "-100123",
          threadIsDirect: false,
        },
      },
      occurredAt: "2026-07-25T17:20:00.000Z",
      userId: "member_telegram_group",
    });
    const text = envelope
      ? readHostedExecutionConversationMessageText(envelope.message)
      : null;
    expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
      actor: null,
      changes: [
        { operation: "removed", reaction: "❤" },
        { operation: "removed", reaction: "custom_emoji:custom-old" },
        { operation: "added", reaction: "😂" },
        { operation: "added", reaction: "paid" },
      ],
      channel: "telegram",
      mode: "delta",
      schema: "murph.hosted-group-reaction.v1",
      targetMessageId: "91",
      targetText: null,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_telegram_group",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "17",
        userId: "member_telegram_group",
      },
      mailboxItemId: "mailbox_telegram_reaction",
      prisma,
    });
  });

  it("persists complete anonymous count snapshots, including custom, paid, unknown, and empty sets", async () => {
    const prisma = createPrismaStub();
    await handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message_reaction_count: {
          chat: { id: -100123, type: "group" },
          date: 1_785_000_001,
          message_id: 92,
          reactions: [
            { total_count: 4, type: { emoji: "🤣", type: "emoji" } },
            {
              total_count: 2,
              type: { custom_emoji_id: "custom-new", type: "custom_emoji" },
            },
            { total_count: 1, type: { type: "paid" } },
            { total_count: 3, type: { future_id: "future", type: "future" } },
          ],
        },
        update_id: 124,
      }),
    });

    let envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    let text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
      actor: null,
      changes: [
        { count: 4, operation: "snapshot", reaction: "🤣" },
        {
          count: 2,
          operation: "snapshot",
          reaction: "custom_emoji:custom-new",
        },
        { count: 1, operation: "snapshot", reaction: "paid" },
        {
          count: 3,
          operation: "snapshot",
          reaction: "unknown:{\"future_id\":\"future\",\"type\":\"future\"}",
        },
      ],
      channel: "telegram",
      mode: "snapshot",
      schema: "murph.hosted-group-reaction.v1",
      targetMessageId: "92",
      targetText: null,
    });

    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockClear();
    await handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message_reaction_count: {
          chat: { id: -100123, type: "group" },
          date: 1_785_000_002,
          message_id: 92,
          reactions: [],
        },
        update_id: 125,
      }),
    });
    envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      changes: [],
      mode: "snapshot",
      targetMessageId: "92",
    });
  });

  it("keeps anonymous administrators unattributed", async () => {
    const prisma = createPrismaStub();
    await handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message_reaction: {
          actor_chat: { id: -1009, title: "Anonymous admin" },
          chat: { id: -100123, type: "supergroup" },
          date: 1_785_000_000,
          message_id: 91,
          new_reaction: [{ emoji: "🔥", type: "emoji" }],
          old_reaction: [],
        },
        update_id: 126,
      }),
    });

    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "telegram",
      prisma,
      threadId: "-100123",
    });
    const envelope =
      mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mock.calls[0]?.[0]
        .envelope;
    const text = readHostedExecutionConversationMessageText(envelope.message);
    expect(parseHostedExecutionGroupReactionEventText(text)).toMatchObject({
      actor: null,
    });
  });

  it("returns null for ordinary updates and ignores invalid, private, unavailable, or inactive reaction routes", async () => {
    const prisma = createPrismaStub();
    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 1,
        },
        update_id: 200,
      }),
    })).resolves.toBeNull();

    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: JSON.stringify({
        message_reaction: {
          chat: { id: 42, type: "private" },
          date: 1_785_000_000,
          message_id: 1,
          new_reaction: [{ emoji: "❤", type: "emoji" }],
          old_reaction: [],
        },
        update_id: 201,
      }),
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "invalid-telegram-group-reaction-update",
    });

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce(null);
    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: buildSimpleReactionBody(202),
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "telegram-group-reaction-route-unavailable",
    });

    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
      containerMemberId: "member_telegram_group",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);
    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma,
      rawBody: buildSimpleReactionBody(203),
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "telegram-group-reaction-route-unavailable",
    });
  });

  it("reports mailbox duplicates and retries synchronous signal failures", async () => {
    mocks.appendConsumedHostedGroupReactionMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_telegram_reaction",
        lane: "conversation",
        laneSeq: "17",
      },
    });
    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma: createPrismaStub(),
      rawBody: buildSimpleReactionBody(300),
    })).resolves.toEqual({
      duplicate: true,
      ok: true,
      reason: "durable-telegram-group-reaction",
    });

    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("signal unavailable"),
    );
    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma: createPrismaStub(),
      rawBody: buildSimpleReactionBody(301),
    })).rejects.toThrow("signal unavailable");
  });

  it("schedules signaling after the response when a scheduler is available", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("signal unavailable"),
    );

    await expect(handleHostedTelegramGroupReactionWebhook({
      prisma: createPrismaStub(),
      rawBody: buildSimpleReactionBody(400),
      scheduleAfterResponse(task) {
        scheduled.push(task);
      },
    })).resolves.toMatchObject({ ok: true });

    expect(scheduled).toHaveLength(1);
    await expect(scheduled[0]!()).resolves.toBeUndefined();
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "hosted-onboarding.telegram-group-reaction-signal-failed",
      { errorName: "Error" },
    );
  });
});

function buildSimpleReactionBody(updateId: number): string {
  return JSON.stringify({
    message_reaction: {
      chat: { id: -100123, type: "group" },
      date: 1_785_000_000,
      message_id: 91,
      new_reaction: [{ emoji: "❤", type: "emoji" }],
      old_reaction: [],
      user: { first_name: "Alice", id: 42 },
    },
    update_id: updateId,
  });
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
