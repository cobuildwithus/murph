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

function createSnapshot(
  conversation: GatewayConversation | null,
): GatewayProjectionSnapshot {
  return {
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:00:00.000Z",
    conversations: conversation ? [conversation] : [],
    messages: [],
    permissions: [],
  };
}

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

test("sendGatewayMessageLocal rejects invalid session ids before reading the store", async () => {
  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      sessionKey: "invalid-session-key",
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_INVALID_RUNTIME_ID",
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

test("sendGatewayMessageLocal marks direct threads as direct deliveries", async () => {
  syncAndReadSnapshot.mockResolvedValue(
    createSnapshot({
      ...TEST_EMAIL_CONVERSATION,
      route: {
        ...TEST_EMAIL_CONVERSATION.route,
        directness: "direct",
      },
    }),
  );
  const messageSender = {
    deliver: vi.fn(async (_input: { threadIsDirect?: boolean | null }) => ({
      delivery: null,
      deliveryErrorMessage: null,
      intentId: "intent-direct",
      kind: "queued" as const,
    })),
  };

  await sendGatewayMessageLocal({
    messageSender,
    sessionKey: TEST_SESSION_KEY,
    text: "hello direct",
    vault: "/vault/local",
  });

  assert.equal(messageSender.deliver.mock.calls[0]?.[0]?.threadIsDirect, true);
});

test("sendGatewayMessageLocal keeps thread directness nullable for unknown routes", async () => {
  syncAndReadSnapshot.mockResolvedValue(
    createSnapshot({
      ...TEST_EMAIL_CONVERSATION,
      route: {
        ...TEST_EMAIL_CONVERSATION.route,
        directness: "unknown",
      },
    }),
  );
  const messageSender = {
    deliver: vi.fn(async (_input: { threadIsDirect?: boolean | null }) => ({
      delivery: null,
      deliveryErrorMessage: null,
      intentId: "intent-unknown",
      kind: "queued" as const,
    })),
  };

  await sendGatewayMessageLocal({
    messageSender,
    sessionKey: TEST_SESSION_KEY,
    text: "hello unknown",
    vault: "/vault/local",
  });

  assert.equal(messageSender.deliver.mock.calls[0]?.[0]?.threadIsDirect, null);
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

test("sendGatewayMessageLocal rejects missing conversations", async () => {
  syncAndReadSnapshot.mockResolvedValue(createSnapshot(null));

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_SESSION_NOT_FOUND" &&
      error.message.includes(TEST_SESSION_KEY),
  );

  assert.equal(sync.mock.calls.length, 0);
  assert.equal(close.mock.calls.length, 1);
});

test("sendGatewayMessageLocal rejects conversations without send permission", async () => {
  syncAndReadSnapshot.mockResolvedValue(
    createSnapshot({
      ...TEST_EMAIL_CONVERSATION,
      canSend: false,
    }),
  );

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("does not have a routable reply target"),
  );

  assert.equal(sync.mock.calls.length, 0);
  assert.equal(close.mock.calls.length, 1);
});

test("sendGatewayMessageLocal rejects conversations missing a delivery target", async () => {
  syncAndReadSnapshot.mockResolvedValue(
    createSnapshot({
      ...TEST_EMAIL_CONVERSATION,
      route: {
        channel: null,
        identityId: null,
        participantId: null,
        threadId: null,
        directness: "unknown",
        reply: {
          kind: null,
          target: null,
        },
      },
    }),
  );

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("missing a delivery target"),
  );

  assert.equal(sync.mock.calls.length, 0);
  assert.equal(close.mock.calls.length, 1);
});

test("sendGatewayMessageLocal surfaces delivery failures from the local sender", async () => {
  const messageSender = {
    deliver: vi.fn(async () => ({
      delivery: null,
      deliveryErrorMessage: "provider delivery failed",
      intentId: "intent-failed",
      kind: "failed" as const,
    })),
  };

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message === "provider delivery failed",
  );

  assert.equal(sync.mock.calls.length, 0);
  assert.equal(close.mock.calls.length, 1);
});

test("sendGatewayMessageLocal falls back to a default delivery failure message", async () => {
  const messageSender = {
    deliver: vi.fn(async () => ({
      delivery: null,
      deliveryErrorMessage: null,
      intentId: "intent-failed",
      kind: "failed" as const,
    })),
  };

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message === "Gateway delivery failed.",
  );
});

test("sendGatewayMessageLocal returns successfully when the post-delivery sync fails", async () => {
  sync.mockRejectedValueOnce(new Error("sync failed after send"));
  const messageSender = {
    deliver: vi.fn(async () => ({
      delivery: null,
      deliveryErrorMessage: null,
      intentId: "intent-queued",
      kind: "queued" as const,
    })),
  };

  const result = await sendGatewayMessageLocal({
    messageSender,
    sessionKey: TEST_SESSION_KEY,
    text: "hello from local",
    vault: "/vault/local",
  });

  assert.equal(result.messageId, createGatewayOutboxMessageId(TEST_ROUTE_TOKEN, "intent-queued"));
  assert.equal(result.queued, true);
  assert.equal(result.delivery, null);
  assert.equal(sync.mock.calls.length, 1);
  assert.equal(close.mock.calls.length, 1);
});

test("sendGatewayMessageLocal rejects reply-to on unsupported channels", async () => {
  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      replyToMessageId: TEST_REPLY_TO_MESSAGE_ID,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("reply-to is not supported for email"),
  );

  assert.equal(readMessageProviderReplyTarget.mock.calls.length, 0);
});

test("sendGatewayMessageLocal rejects reply-to when the route channel is missing", async () => {
  syncAndReadSnapshot.mockResolvedValue(
    createSnapshot({
      ...TEST_EMAIL_CONVERSATION,
      route: {
        ...TEST_EMAIL_CONVERSATION.route,
        channel: null,
      },
    }),
  );

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      replyToMessageId: TEST_REPLY_TO_MESSAGE_ID,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("reply-to is not supported for this channel"),
  );

  assert.equal(readMessageProviderReplyTarget.mock.calls.length, 0);
});

test("sendGatewayMessageLocal rejects invalid reply-to ids", async () => {
  syncAndReadSnapshot.mockResolvedValue(TEST_LINQ_SNAPSHOT);

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      replyToMessageId: "invalid-message-id",
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_INVALID_RUNTIME_ID",
  );

  assert.equal(readMessageProviderReplyTarget.mock.calls.length, 0);
});

test("sendGatewayMessageLocal rejects reply-to ids from other sessions", async () => {
  const otherReplyToMessageId = createGatewayOutboxMessageId("another-route", "seed-intent");
  syncAndReadSnapshot.mockResolvedValue(TEST_LINQ_SNAPSHOT);

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      replyToMessageId: otherReplyToMessageId,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_INVALID_RUNTIME_ID" &&
      error.message.includes("did not belong to the requested session key"),
  );

  assert.equal(readMessageProviderReplyTarget.mock.calls.length, 0);
});

test("sendGatewayMessageLocal rejects reply-to ids without a stable provider target", async () => {
  syncAndReadSnapshot.mockResolvedValue(TEST_LINQ_SNAPSHOT);

  await assert.rejects(
    sendGatewayMessageLocal({
      messageSender: { deliver: vi.fn() },
      replyToMessageId: TEST_REPLY_TO_MESSAGE_ID,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from local",
      vault: "/vault/local",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION" &&
      error.message.includes("stable provider message id"),
  );

  assert.deepEqual(readMessageProviderReplyTarget.mock.calls[0], [TEST_REPLY_TO_MESSAGE_ID]);
});
