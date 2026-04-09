import assert from "node:assert/strict";

import {
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import { beforeEach, test, vi } from "vitest";

const {
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  sendGatewayMessageLocal,
  waitForGatewayEventsLocal,
} = vi.hoisted(() => ({
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  listGatewayOpenPermissionsLocal: vi.fn(),
  pollGatewayEventsLocal: vi.fn(),
  respondToGatewayPermissionLocal: vi.fn(),
  sendGatewayMessageLocal: vi.fn(),
  waitForGatewayEventsLocal: vi.fn(),
}));

vi.mock("../src/store.js", () => ({
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
}));

vi.mock("../src/send.js", () => ({
  sendGatewayMessageLocal,
}));

import {
  createLocalGatewayService,
  fetchGatewayAttachmentsLocal,
  getGatewayConversationLocal,
  readGatewayMessagesLocal,
  sendGatewayMessage,
} from "../src/local-service.js";

const TEST_SESSION_KEY = createGatewayConversationSessionKey("gateway-local-route");
const TEST_SNAPSHOT: GatewayProjectionSnapshot = {
  schema: "murph.gateway-projection-snapshot.v1",
  generatedAt: "2026-04-08T00:00:00.000Z",
  conversations: [
    {
      schema: "murph.gateway-conversation.v1",
      sessionKey: TEST_SESSION_KEY,
      title: "Team thread",
      titleSource: "thread-title",
      lastMessagePreview: "hello there",
      lastActivityAt: "2026-04-08T00:01:00.000Z",
      messageCount: 2,
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
    },
  ],
  messages: [
    {
      schema: "murph.gateway-message.v1",
      messageId: createGatewayCaptureMessageId(
        "gateway-local-route",
        "capture-inbound-1",
      ),
      sessionKey: TEST_SESSION_KEY,
      direction: "inbound",
      createdAt: "2026-04-08T00:00:00.000Z",
      actorDisplayName: "Alex",
      text: "hello there",
      attachments: [
        {
          schema: "murph.gateway-attachment.v1",
          attachmentId: createGatewayAttachmentId(
            "gateway-local-route",
            "capture-inbound-1",
            "attachment-1",
          ),
          messageId: createGatewayCaptureMessageId(
            "gateway-local-route",
            "capture-inbound-1",
          ),
          kind: "image",
          mime: "image/jpeg",
          fileName: "photo.jpg",
          byteSize: 128,
          parseState: null,
          extractedText: null,
          transcriptText: null,
        },
      ],
    },
    {
      schema: "murph.gateway-message.v1",
      messageId: createGatewayOutboxMessageId(
        "gateway-local-route",
        "intent-outbound-1",
      ),
      sessionKey: TEST_SESSION_KEY,
      direction: "outbound",
      createdAt: "2026-04-08T00:01:00.000Z",
      actorDisplayName: "Murph",
      text: "sent reply",
      attachments: [],
    },
  ],
  permissions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  exportGatewayProjectionSnapshotLocal.mockResolvedValue(TEST_SNAPSHOT);
  listGatewayOpenPermissionsLocal.mockResolvedValue([{ requestId: "permission-1" }]);
  pollGatewayEventsLocal.mockResolvedValue({
    nextCursor: 1,
    live: true,
    events: [],
  });
  respondToGatewayPermissionLocal.mockResolvedValue({
    schema: "murph.gateway-permission-request.v1",
    requestId: "permission-1",
    sessionKey: TEST_SESSION_KEY,
    requestedAt: "2026-04-08T00:02:00.000Z",
    route: TEST_SNAPSHOT.conversations[0]?.route,
    excerpt: "Allow reply",
    status: "approved",
  });
  sendGatewayMessageLocal.mockResolvedValue({
    schema: "murph.gateway-send-message-result.v1",
    sessionKey: TEST_SESSION_KEY,
    messageId: "gwm_gateway-local-route_sent",
    queued: false,
    delivery: null,
  });
  waitForGatewayEventsLocal.mockResolvedValue({
    nextCursor: 2,
    live: true,
    events: [],
  });
});

test("snapshot-backed local helpers parse inputs before reading the projection snapshot", async () => {
  const conversation = await getGatewayConversationLocal("/vault/local", {
    sessionKey: TEST_SESSION_KEY,
  });
  const messages = await readGatewayMessagesLocal("/vault/local", {
    afterMessageId: null,
    oldestFirst: false,
    limit: 10,
    sessionKey: TEST_SESSION_KEY,
  });
  const attachments = await fetchGatewayAttachmentsLocal("/vault/local", {
    messageId: createGatewayCaptureMessageId(
      "gateway-local-route",
      "capture-inbound-1",
    ),
  });

  assert.equal(conversation?.sessionKey, TEST_SESSION_KEY);
  assert.deepEqual(messages.messages.map((message) => message.messageId), [
    createGatewayOutboxMessageId("gateway-local-route", "intent-outbound-1"),
    createGatewayCaptureMessageId("gateway-local-route", "capture-inbound-1"),
  ]);
  assert.deepEqual(attachments.map((attachment) => attachment.fileName), ["photo.jpg"]);
  assert.equal(exportGatewayProjectionSnapshotLocal.mock.calls.length, 3);
  assert.deepEqual(exportGatewayProjectionSnapshotLocal.mock.calls[0], [
    "/vault/local",
    {},
  ]);
});

test("sendGatewayMessage forwards parsed input and service dependencies to the local sender", async () => {
  const dependencies = {
    dispatchMode: "queue-only" as const,
    messageSender: { deliver: vi.fn() },
    sourceReader: {
      listOutboxSources: vi.fn(),
      listSessionSources: vi.fn(),
    },
  };

  const result = await sendGatewayMessage(
    "/vault/local",
    {
      clientRequestId: "  request-1  ",
      replyToMessageId: undefined,
      sessionKey: TEST_SESSION_KEY,
      text: "hello from service",
    },
    dependencies,
  );

  assert.deepEqual(sendGatewayMessageLocal.mock.calls[0], [
    {
      clientRequestId: "  request-1  ",
      dispatchMode: "queue-only",
      messageSender: dependencies.messageSender,
      replyToMessageId: null,
      sessionKey: TEST_SESSION_KEY,
      sourceReader: dependencies.sourceReader,
      text: "hello from service",
      vault: "/vault/local",
    },
  ]);
  assert.equal(result.messageId, "gwm_gateway-local-route_sent");
});

test("createLocalGatewayService forwards wrapper calls to the local store and sender seams", async () => {
  const dependencies = {
    dispatchMode: "queue-only" as const,
    messageSender: { deliver: vi.fn() },
    sourceReader: {
      listOutboxSources: vi.fn(),
      listSessionSources: vi.fn(),
    },
  };
  const service = createLocalGatewayService("/vault/local", dependencies);

  const conversation = await service.getConversation({
    sessionKey: TEST_SESSION_KEY,
  });
  const conversations = await service.listConversations({
    channel: "email",
    limit: 10,
  });
  const messages = await service.readMessages({
    afterMessageId: null,
    limit: 10,
    oldestFirst: false,
    sessionKey: TEST_SESSION_KEY,
  });
  const attachments = await service.fetchAttachments({
    messageId: createGatewayCaptureMessageId(
      "gateway-local-route",
      "capture-inbound-1",
    ),
  });
  const permissions = await service.listOpenPermissions({
    sessionKey: TEST_SESSION_KEY,
  });
  const permission = await service.respondToPermission({
    requestId: "permission-1",
    decision: "approve",
  });
  const pollResult = await service.pollEvents({
    cursor: 0,
    limit: 5,
  });
  const waitResult = await service.waitForEvents({
    cursor: 0,
    limit: 5,
    timeoutMs: 10,
  });
  const sendResult = await service.sendMessage({
    clientRequestId: "request-2",
    sessionKey: TEST_SESSION_KEY,
    text: "service send",
  });

  assert.deepEqual(listGatewayOpenPermissionsLocal.mock.calls[0], [
    "/vault/local",
    { sessionKey: TEST_SESSION_KEY },
    dependencies,
  ]);
  assert.deepEqual(respondToGatewayPermissionLocal.mock.calls[0], [
    "/vault/local",
    { requestId: "permission-1", decision: "approve" },
    dependencies,
  ]);
  assert.deepEqual(pollGatewayEventsLocal.mock.calls[0], [
    "/vault/local",
    { cursor: 0, kinds: [], limit: 5, sessionKey: null },
    dependencies,
  ]);
  assert.deepEqual(waitForGatewayEventsLocal.mock.calls[0], [
    "/vault/local",
    { cursor: 0, kinds: [], limit: 5, sessionKey: null, timeoutMs: 10 },
    dependencies,
  ]);
  assert.deepEqual(sendGatewayMessageLocal.mock.calls[0], [
    {
      clientRequestId: "request-2",
      dispatchMode: "queue-only",
      messageSender: dependencies.messageSender,
      replyToMessageId: null,
      sessionKey: TEST_SESSION_KEY,
      sourceReader: dependencies.sourceReader,
      text: "service send",
      vault: "/vault/local",
    },
  ]);
  assert.equal(conversation?.sessionKey, TEST_SESSION_KEY);
  assert.equal(conversations.conversations[0]?.sessionKey, TEST_SESSION_KEY);
  assert.equal(messages.messages.length, 2);
  assert.equal(attachments[0]?.fileName, "photo.jpg");
  assert.equal(permissions[0]?.requestId, "permission-1");
  assert.ok(permission);
  assert.equal(permission.requestId, "permission-1");
  assert.equal(pollResult.nextCursor, 1);
  assert.equal(waitResult.nextCursor, 2);
  assert.equal(sendResult.messageId, "gwm_gateway-local-route_sent");
});
