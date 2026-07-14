import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeHostedMailboxStoredPayload: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMailboxLiveItemById: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  readHostedMailboxRecentLiveConversationItemIds: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
  readHostedMailboxLiveItemById: mocks.readHostedMailboxLiveItemById,
  readHostedMailboxPayload: mocks.readHostedMailboxPayload,
  readHostedMailboxRecentLiveConversationItemIds:
    mocks.readHostedMailboxRecentLiveConversationItemIds,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import {
  isHostedTelegramDeliveryTargetAuthorizedTx,
} from "@/src/lib/hosted-onboarding/telegram-egress-authorization";

describe("hosted Telegram egress authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readActiveHostedMemberAccess.mockResolvedValue({ kind: "personal" });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "789:bot:123456:business:current:dm-topic:9",
    });
    mocks.readHostedMailboxPayload.mockResolvedValue(null);
    mocks.readHostedMailboxRecentLiveConversationItemIds.mockResolvedValue([]);
  });

  it("authorizes a persisted inbound reply target when a richer proactive route remains current", async () => {
    mockPersistedTelegramInbound({
      mailboxItemId: "mailbox_1",
      messageId: "42",
      threadId: "789:bot:123456",
    });
    mocks.readHostedMailboxRecentLiveConversationItemIds.mockResolvedValue(["mailbox_1"]);

    await expect(isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget: "789:bot:123456",
      memberId: "member_123",
      prisma: {} as never,
      replyToMessageId: "42",
    })).resolves.toBe(true);
  });

  it("rejects a target that is neither current nor bound to the persisted inbound reply", async () => {
    mockPersistedTelegramInbound({
      mailboxItemId: "mailbox_1",
      messageId: "42",
      threadId: "789:bot:123456",
    });
    mocks.readHostedMailboxRecentLiveConversationItemIds.mockResolvedValue(["mailbox_1"]);

    await expect(isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget: "former:bot:123456",
      memberId: "member_123",
      prisma: {} as never,
      replyToMessageId: "42",
    })).resolves.toBe(false);
  });

  it("rejects a different message on the exact persisted inbound target", async () => {
    mockPersistedTelegramInbound({
      mailboxItemId: "mailbox_1",
      messageId: "42",
      threadId: "789:bot:123456",
    });
    mocks.readHostedMailboxRecentLiveConversationItemIds.mockResolvedValue(["mailbox_1"]);

    await expect(isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget: "789:bot:123456",
      memberId: "member_123",
      prisma: {} as never,
      replyToMessageId: "43",
    })).resolves.toBe(false);
  });

  it("rejects every target when hosted access is inactive", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValue(null);

    await expect(isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget: "789:bot:123456:business:current:dm-topic:9",
      memberId: "member_123",
      prisma: {} as never,
      replyToMessageId: null,
    })).resolves.toBe(false);
    expect(mocks.readHostedMailboxRecentLiveConversationItemIds).not.toHaveBeenCalled();
  });

  it("authorizes a proactive send only against the current route", async () => {
    await expect(isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget: "789:bot:123456:business:current:dm-topic:9",
      memberId: "member_123",
      prisma: {} as never,
      replyToMessageId: null,
    })).resolves.toBe(true);
  });
});

function mockPersistedTelegramInbound(input: {
  mailboxItemId: string;
  messageId: string;
  threadId: string;
}): void {
  const occurredAt = "2026-07-14T12:00:00.000Z";
  mocks.readHostedMailboxLiveItemById.mockResolvedValue({
    consumedAt: null,
    createdAt: occurredAt,
    dedupeKey: "telegram-event-1",
    expiresAt: null,
    id: input.mailboxItemId,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt,
    payloadBytes: 1,
    payloadInlineCiphertext: "encrypted-mailbox-payload",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    updatedAt: occurredAt,
    userId: "member_123",
  });
  mocks.decodeHostedMailboxStoredPayload.mockResolvedValue({
    eventId: "telegram-event-1",
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: {
        messageId: input.messageId,
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: input.threadId,
      },
    },
    occurredAt,
    userId: "member_123",
  });
}
