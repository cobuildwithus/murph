import assert from "node:assert/strict";

import {
  createGatewayConversationSessionKey,
  type GatewayConversation,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import { beforeEach, test, vi } from "vitest";

const {
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
} = vi.hoisted(() => ({
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  listGatewayOpenPermissionsLocal: vi.fn(),
  pollGatewayEventsLocal: vi.fn(),
  respondToGatewayPermissionLocal: vi.fn(),
  waitForGatewayEventsLocal: vi.fn(),
}));

vi.mock("../src/store.js", () => ({
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
}));

import {
  listGatewayConversationsLocal,
  listGatewayOpenPermissionsLocalWrapper,
  pollGatewayEventsLocalWrapper,
  respondToGatewayPermissionLocalWrapper,
  waitGatewayEventsLocal,
} from "../src/local-service.js";

const TEST_SESSION_KEY = createGatewayConversationSessionKey("gateway-local-route");

const TEST_CONVERSATION: GatewayConversation = {
  schema: "murph.gateway-conversation.v1",
  sessionKey: TEST_SESSION_KEY,
  title: "Local thread",
  titleSource: "channel",
  lastMessagePreview: "hello from local",
  lastActivityAt: "2026-04-08T00:00:00.000Z",
  messageCount: 1,
  canSend: true,
  route: {
    channel: "email",
    identityId: "murph@example.com",
    participantId: "contact:alex",
    threadId: "thread-labs",
    directness: "group",
    reply: {
      kind: "thread",
      target: "thread-labs",
    },
  },
};

const TEST_SNAPSHOT: GatewayProjectionSnapshot = {
  schema: "murph.gateway-projection-snapshot.v1",
  generatedAt: "2026-04-08T00:00:00.000Z",
  conversations: [TEST_CONVERSATION],
  messages: [],
  permissions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  exportGatewayProjectionSnapshotLocal.mockResolvedValue(TEST_SNAPSHOT);
  listGatewayOpenPermissionsLocal.mockResolvedValue([
    {
      schema: "murph.gateway-permission-request.v1",
      requestId: "request-1",
      sessionKey: TEST_SESSION_KEY,
      action: "send-message",
      description: "approve local send",
      status: "open",
      requestedAt: "2026-04-08T00:00:00.000Z",
      resolvedAt: null,
      note: null,
    },
  ]);
  pollGatewayEventsLocal.mockResolvedValue({
    events: [],
    nextCursor: 9,
    live: false,
  });
  respondToGatewayPermissionLocal.mockResolvedValue(null);
  waitForGatewayEventsLocal.mockResolvedValue({
    events: [],
    nextCursor: 11,
    live: true,
  });
});

test("listGatewayConversationsLocal reads a snapshot with default parsed input", async () => {
  const result = await listGatewayConversationsLocal("/vault/local");

  assert.deepEqual(exportGatewayProjectionSnapshotLocal.mock.calls[0], ["/vault/local", {}]);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0]?.sessionKey, TEST_SESSION_KEY);
  assert.equal(result.conversations[0]?.route.channel, "email");
});

test("local service wrappers parse defaults and forward inputs to the store layer", async () => {
  const openPermissions = await listGatewayOpenPermissionsLocalWrapper("/vault/local");
  const pollEvents = await pollGatewayEventsLocalWrapper("/vault/local");
  const waitEvents = await waitGatewayEventsLocal("/vault/local");
  const permission = await respondToGatewayPermissionLocalWrapper("/vault/local", {
    decision: "approve",
    note: "looks good",
    requestId: "request-1",
  });

  assert.deepEqual(listGatewayOpenPermissionsLocal.mock.calls[0], [
    "/vault/local",
    {
      sessionKey: null,
    },
    {},
  ]);
  assert.deepEqual(pollGatewayEventsLocal.mock.calls[0], [
    "/vault/local",
    {
      cursor: 0,
      kinds: [],
      limit: 50,
      sessionKey: null,
    },
    {},
  ]);
  assert.deepEqual(waitForGatewayEventsLocal.mock.calls[0], [
    "/vault/local",
    {
      cursor: 0,
      kinds: [],
      limit: 50,
      sessionKey: null,
      timeoutMs: 30000,
    },
    {},
  ]);
  assert.deepEqual(respondToGatewayPermissionLocal.mock.calls[0], [
    "/vault/local",
    {
      decision: "approve",
      note: "looks good",
      requestId: "request-1",
    },
    {},
  ]);
  assert.equal(openPermissions.length, 1);
  assert.equal(pollEvents.live, false);
  assert.equal(waitEvents.live, true);
  assert.equal(permission, null);
});
