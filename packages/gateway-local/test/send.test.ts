import assert from "node:assert/strict";
import {
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  type GatewayConversation,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import { beforeEach, test, vi } from "vitest";

const {
  close,
  readMessageProviderReplyTarget,
  sync,
  syncAndReadSnapshot,
  LocalGatewayProjectionStore,
} = vi.hoisted(() => {
  const closeMock = vi.fn();
  const readMessageProviderReplyTargetMock = vi.fn();
  const syncMock = vi.fn();
  const syncAndReadSnapshotMock = vi.fn();
  return {
    close: closeMock,
    readMessageProviderReplyTarget: readMessageProviderReplyTargetMock,
    sync: syncMock,
    syncAndReadSnapshot: syncAndReadSnapshotMock,
    LocalGatewayProjectionStore: vi.fn(function LocalGatewayProjectionStoreMock() {
      return {
      close: closeMock,
      readMessageProviderReplyTarget: readMessageProviderReplyTargetMock,
      sync: syncMock,
      syncAndReadSnapshot: syncAndReadSnapshotMock,
      };
    }),
  };
});

vi.mock("../src/store.js", () => ({
  LocalGatewayProjectionStore,
}));

import { sendGatewayMessageLocal } from "../src/send.js";

const TEST_ROUTE_TOKEN = "gateway-local-route";
const TEST_SESSION_KEY = createGatewayConversationSessionKey(TEST_ROUTE_TOKEN);
const TEST_REPLY_TO_MESSAGE_ID = createGatewayOutboxMessageId(TEST_ROUTE_TOKEN, "seed-intent");

const TEST_EMAIL_CONVERSATION: GatewayConversation = {
  schema: "murph.gateway-conversation.v1",
  sessionKey: TEST_SESSION_KEY,
  title: "Email thread",
  titleSource: "channel",
  lastMessagePreview: "existing message",
  lastActivityAt: "2026-04-08T00:00:00.000Z",
  messageCount: 1,
  canSend: true,
  route: {
    channel: "email",
    identityId: "murph@example.com",
    participantId: "contact:alex",
    threadId: "thread-email",
    directness: "group",
    reply: {
      kind: "thread",
      target: "thread-email",
    },
  },
};

const TEST_LINQ_CONVERSATION: GatewayConversation = {
  schema: "murph.gateway-conversation.v1",
  sessionKey: TEST_SESSION_KEY,
  title: "Linq thread",
  titleSource: "channel",
  lastMessagePreview: "existing message",
  lastActivityAt: "2026-04-08T00:00:00.000Z",
  messageCount: 1,
  canSend: true,
  route: {
    channel: "linq",
    identityId: null,
    participantId: "contact:alex",
    threadId: "thread-linq",
    directness: "group",
    reply: {
      kind: "thread",
      target: "thread-linq",
    },
  },
};

const TEST_EMAIL_SNAPSHOT: GatewayProjectionSnapshot = {
  schema: "murph.gateway-projection-snapshot.v1",
  generatedAt: "2026-04-08T00:00:00.000Z",
  conversations: [TEST_EMAIL_CONVERSATION],
  messages: [],
  permissions: [],
};

const TEST_LINQ_SNAPSHOT: GatewayProjectionSnapshot = {
  schema: "murph.gateway-projection-snapshot.v1",
  generatedAt: "2026-04-08T00:00:00.000Z",
  conversations: [TEST_LINQ_CONVERSATION],
  messages: [],
  permissions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  syncAndReadSnapshot.mockResolvedValue(TEST_EMAIL_SNAPSHOT);
  sync.mockResolvedValue(undefined);
  close.mockReturnValue(undefined);
  readMessageProviderReplyTarget.mockReturnValue(null);
});

test("sendGatewayMessageLocal rejects calls without a configured local sender", async () => {
  await assert.rejects(
    sendGatewayMessageLocal({
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("configured local message sender"),
  );

  assert.equal(LocalGatewayProjectionStore.mock.calls.length, 0);
});

test("sendGatewayMessageLocal shapes the delivery request and result payload", async () => {
  const messageSender = {
    deliver: vi.fn(async (request: {
      bindingDelivery: { kind: "thread"; target: string };
      channel: string | null;
      dedupeToken: string | null;
      deliveryIdempotencyKey: string | null;
      dispatchMode: "immediate" | "queue-only";
      identityId: string | null;
      message: string;
      replyToMessageId: string | null;
      sessionId: string;
      threadId: string | null;
      threadIsDirect: boolean | null;
      turnId: string;
      vault: string;
    }) => ({
      delivery: {
        channel: request.channel ?? "email",
        idempotencyKey: request.deliveryIdempotencyKey,
        messageLength: request.message.length,
        sentAt: "2026-04-08T00:00:00.000Z",
        target: request.bindingDelivery.target,
        targetKind: request.bindingDelivery.kind,
      },
      deliveryErrorMessage: null,
      intentId: "intent-123",
      kind: "sent" as const,
    }),
  )};

  const result = await sendGatewayMessageLocal({
    clientRequestId: "  client-123  ",
    dispatchMode: "queue-only",
    messageSender,
    sessionKey: TEST_SESSION_KEY,
    text: "hello from local",
    vault: "/vault/local",
  });

  assert.equal(LocalGatewayProjectionStore.mock.calls.length, 1);
  assert.deepEqual(LocalGatewayProjectionStore.mock.calls[0], [
    "/vault/local",
    {
      sourceReader: undefined,
    },
  ]);
  assert.equal(syncAndReadSnapshot.mock.calls.length, 1);
  assert.equal(sync.mock.calls.length, 1);
  assert.equal(close.mock.calls.length, 1);
  assert.equal(messageSender.deliver.mock.calls.length, 1);
  assert.deepEqual({
    ...messageSender.deliver.mock.calls[0]?.[0],
    turnId: "<opaque>",
  }, {
    actorId: "contact:alex",
    bindingDelivery: {
      kind: "thread",
      target: "thread-email",
    },
    channel: "email",
    dedupeToken: "gateway-send:gateway-local-route:client-123",
    deliveryIdempotencyKey: "gateway-send:gateway-local-route:client-123",
    dispatchMode: "queue-only",
    identityId: "murph@example.com",
    message: "hello from local",
    replyToMessageId: null,
    sessionId: `gwds_${TEST_SESSION_KEY}`,
    threadId: "thread-email",
    threadIsDirect: false,
    turnId: "<opaque>",
    vault: "/vault/local",
  });
  assert.equal(result.sessionKey, TEST_SESSION_KEY);
  assert.equal(
    result.messageId,
    createGatewayOutboxMessageId(TEST_ROUTE_TOKEN, "intent-123"),
  );
  assert.equal(result.queued, false);
  assert.deepEqual(result.delivery, {
    channel: "email",
    idempotencyKey: "gateway-send:gateway-local-route:client-123",
    messageLength: 16,
    sentAt: "2026-04-08T00:00:00.000Z",
    target: "thread-email",
    targetKind: "thread",
  });
  assert.match(
    messageSender.deliver.mock.calls[0]?.[0]?.turnId ?? "",
    /^turn_[0-9a-f]{32}$/u,
  );
});

test("sendGatewayMessageLocal resolves supported reply-to message ids through the store", async () => {
  syncAndReadSnapshot.mockResolvedValue(TEST_LINQ_SNAPSHOT);
  readMessageProviderReplyTarget.mockImplementation((messageId: string) => {
    return messageId === TEST_REPLY_TO_MESSAGE_ID ? "provider-reply-1" : null;
  });
  const messageSender = {
    deliver: vi.fn(async (request: {
      actorId: string | null;
      bindingDelivery: { kind: "thread"; target: string };
      channel: string | null;
      dedupeToken: string | null;
      deliveryIdempotencyKey: string | null;
      dispatchMode: "immediate" | "queue-only";
      identityId: string | null;
      message: string;
      replyToMessageId: string | null;
      sessionId: string;
      threadId: string | null;
      threadIsDirect: boolean | null;
      turnId: string;
      vault: string;
    }) => ({
      delivery: {
        channel: request.channel ?? "linq",
        idempotencyKey: request.deliveryIdempotencyKey,
        messageLength: request.message.length,
        sentAt: "2026-04-08T00:00:00.000Z",
        target: request.bindingDelivery.target,
        targetKind: request.bindingDelivery.kind,
      },
      deliveryErrorMessage: null,
      intentId: "intent-456",
      kind: "sent" as const,
    }),
  )};

  const result = await sendGatewayMessageLocal({
    messageSender,
    replyToMessageId: TEST_REPLY_TO_MESSAGE_ID,
    sessionKey: TEST_SESSION_KEY,
    text: "reply in linq",
    vault: "/vault/local",
  });

  assert.equal(messageSender.deliver.mock.calls.length, 1);
  assert.deepEqual({
    ...messageSender.deliver.mock.calls[0]?.[0],
    turnId: "<opaque>",
  }, {
    actorId: "contact:alex",
    bindingDelivery: {
      kind: "thread",
      target: "thread-linq",
    },
    channel: "linq",
    dedupeToken: null,
    deliveryIdempotencyKey: null,
    dispatchMode: "immediate",
    identityId: null,
    message: "reply in linq",
    replyToMessageId: "provider-reply-1",
    sessionId: `gwds_${TEST_SESSION_KEY}`,
    threadId: "thread-linq",
    threadIsDirect: false,
    turnId: "<opaque>",
    vault: "/vault/local",
  });
  assert.match(
    messageSender.deliver.mock.calls[0]?.[0]?.turnId ?? "",
    /^turn_[0-9a-f]{32}$/u,
  );
  assert.equal(result.messageId, createGatewayOutboxMessageId(TEST_ROUTE_TOKEN, "intent-456"));
});
