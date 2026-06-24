import { describe, expect, it } from "vitest";

import {
  createGatewayConversationSessionKey,
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayPermissionRequest,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";

import {
  mergeGatewayPermissionOverrides,
  readGatewayPermissionOverrides,
  sameGatewayPermissionResolutionOverrides,
  type GatewayPermissionResolutionOverride,
} from "../src/gateway-projection-cache-permissions.js";
import { HostedGatewayProjectionCache } from "../src/gateway-projection-cache.ts";

const EMAIL_THREAD_SESSION_KEY = createGatewayConversationSessionKey(
  "channel:email|identity:identity-1|participant:participant-1|thread:thread-1",
);

function createCache(): HostedGatewayProjectionCache {
  return new HostedGatewayProjectionCache();
}

describe("HostedGatewayProjectionCache", () => {
  it("resolves permission requests and emits permission events through the shared event-log helper", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:00:00.000Z",
      conversations: [],
      messages: [],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_123",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    expect(await store.listOpenPermissions()).toHaveLength(1);

    const resolved = await store.respondToPermission({
      requestId: "perm_123",
      decision: "approve",
      note: "approved in test",
    });

    expect(resolved).toMatchObject({
      requestId: "perm_123",
      status: "approved",
      note: "approved in test",
    });
    expect(await store.listOpenPermissions()).toHaveLength(0);

    const events = await store.pollEvents({
      cursor: 0,
      kinds: ["permission.resolved"],
      limit: 10,
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });

    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      kind: "permission.resolved",
      permissionRequestId: "perm_123",
      sessionKey: EMAIL_THREAD_SESSION_KEY,
      summary: "approved in test",
    });
  });

  it("round-trips conversation and message reads from the DO-local projection cache", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-03T00:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Sensitive thread",
        titleSource: "alias",
        lastMessagePreview: "super secret preview",
        lastActivityAt: "2026-04-03T00:00:00.000Z",
        messageCount: 1,
        canSend: true,
        route: {
          channel: "email",
          identityId: "identity-1",
          participantId: "participant-1",
          threadId: "thread-1",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "reply-1",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "message-1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-04-03T00:00:00.000Z",
        actorDisplayName: "Alice",
        text: "super secret body",
        attachments: [],
      }],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm-1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Send a reply",
        status: "open",
        requestedAt: "2026-04-03T00:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const conversations = await store.listConversations();
    expect(conversations.conversations).toHaveLength(1);
    expect(conversations.conversations[0]?.title).toBe("Sensitive thread");

    const messages = await store.readMessages({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
      oldestFirst: true,
      limit: 10,
    });
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0]?.text).toBe("super secret body");
  });

  it("ignores replayed older snapshots after a newer projection was already stored", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:05:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        titleSource: "thread-title",
        lastMessagePreview: "newest message",
        lastActivityAt: "2026-03-30T21:05:00.000Z",
        messageCount: 1,
        canSend: true,
        route: {
          channel: "email",
          identityId: "murph@example.com",
          participantId: "contact:alex",
          threadId: "thread-123",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "thread-123",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "gwcm_new",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-03-30T21:05:00.000Z",
        actorDisplayName: "Alex",
        text: "newest message",
        attachments: [],
      }],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_older",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Already resolved",
        status: "approved",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: "2026-03-30T21:05:00.000Z",
        note: "approved already",
      }],
    });

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        titleSource: "thread-title",
        lastMessagePreview: "older message",
        lastActivityAt: "2026-03-30T21:00:00.000Z",
        messageCount: 0,
        canSend: true,
        route: {
          channel: "email",
          identityId: "murph@example.com",
          participantId: "contact:alex",
          threadId: "thread-123",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "thread-123",
          },
        },
      }],
      messages: [],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_older",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Already resolved",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const conversation = await store.getConversation({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });
    const messages = await store.readMessages({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
      oldestFirst: true,
    });
    const permissions = await store.listOpenPermissions({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });

    expect(conversation?.lastMessagePreview).toBe("newest message");
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0]?.messageId).toBe("gwcm_new");
    expect(permissions).toHaveLength(0);
  });

  it("accepts newer snapshots when generatedAt offsets sort lexically older", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-08T00:30:00+01:00",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        titleSource: "thread-title",
        lastMessagePreview: "offset older",
        lastActivityAt: "2026-04-08T00:30:00+01:00",
        messageCount: 1,
        canSend: true,
        route: {
          channel: "email",
          identityId: "identity-1",
          participantId: "participant-1",
          threadId: "thread-1",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "thread-1",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "message-offset-older",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-04-08T00:30:00+01:00",
        actorDisplayName: "Alex",
        text: "offset older",
        attachments: [],
      }],
      permissions: [],
    });

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-08T00:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        titleSource: "thread-title",
        lastMessagePreview: "utc newer",
        lastActivityAt: "2026-04-08T00:00:00.000Z",
        messageCount: 1,
        canSend: true,
        route: {
          channel: "email",
          identityId: "identity-1",
          participantId: "participant-1",
          threadId: "thread-1",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "thread-1",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "message-utc-newer",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-04-08T00:00:00.000Z",
        actorDisplayName: "Alex",
        text: "utc newer",
        attachments: [],
      }],
      permissions: [],
    });

    const conversation = await store.getConversation({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });
    const messages = await store.readMessages({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
      oldestFirst: true,
      limit: 10,
    });

    expect(conversation?.lastMessagePreview).toBe("utc newer");
    expect(messages.messages.map((message) => message.messageId)).toEqual([
      "message-utc-newer",
    ]);
  });

  it("keeps operator permission decisions applied across later runtime snapshots", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:00:00.000Z",
      conversations: [],
      messages: [],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_overlay",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const resolved = await store.respondToPermission({
      requestId: "perm_overlay",
      decision: "approve",
      note: "approved once",
    });

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:05:00.000Z",
      conversations: [],
      messages: [],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_overlay",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const conversationPermissions = await store.listOpenPermissions({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });
    const events = await store.pollEvents({
      cursor: 0,
      kinds: ["permission.resolved"],
      limit: 10,
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });

    expect(resolved?.status).toBe("approved");
    expect(conversationPermissions).toHaveLength(0);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      kind: "permission.resolved",
      permissionRequestId: "perm_overlay",
      summary: "approved once",
    });
  });

  it("treats identical permission retries as idempotent and preserves the original resolved timestamp", async () => {
    const store = createCache();

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:00:00.000Z",
      conversations: [],
      messages: [],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_idempotent",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const firstResolution = await store.respondToPermission({
      requestId: "perm_idempotent",
      decision: "approve",
      note: "same decision",
    });
    const secondResolution = await store.respondToPermission({
      requestId: "perm_idempotent",
      decision: "approve",
      note: "same decision",
    });
    const events = await store.pollEvents({
      cursor: 0,
      kinds: ["permission.resolved"],
      limit: 10,
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });

    expect(firstResolution?.resolvedAt).toBeTruthy();
    expect(secondResolution).toEqual(firstResolution);
    expect(events.events).toHaveLength(1);
  });

  it("keeps permission decisions local to the live cache instance instead of persisting a second authority", async () => {
    const store = createCache();
    const baseSnapshot = gatewayProjectionSnapshotSchema.parse({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-06T00:04:00.000Z",
      conversations: [],
      messages: [],
      permissions: [
        gatewayPermissionRequestSchema.parse({
          schema: "murph.gateway-permission-request.v1",
          requestId: "request-b",
          sessionKey: EMAIL_THREAD_SESSION_KEY,
          action: "send-message",
          description: "Second request",
          status: "open",
          requestedAt: "2026-04-06T00:00:00.000Z",
          resolvedAt: null,
          note: null,
        }),
        gatewayPermissionRequestSchema.parse({
          schema: "murph.gateway-permission-request.v1",
          requestId: "request-a",
          sessionKey: EMAIL_THREAD_SESSION_KEY,
          action: "send-message",
          description: "First request",
          status: "open",
          requestedAt: "2026-04-06T00:00:00.000Z",
          resolvedAt: null,
          note: null,
        }),
      ],
    });

    expect(await store.listOpenPermissions()).toEqual([]);
    await store.applySnapshot(baseSnapshot);
    await store.respondToPermission({
      requestId: "request-b",
      decision: "approve",
      note: "local only",
    });

    expect(await store.listOpenPermissions()).toHaveLength(1);

    const restartedStore = createCache();
    await restartedStore.applySnapshot(baseSnapshot);

    expect(await restartedStore.listOpenPermissions()).toHaveLength(2);
  });

  it("treats equivalent snapshots as no-op cache updates even when keys are reordered", async () => {
    const store = createCache();
    const baseSnapshot = gatewayProjectionSnapshotSchema.parse({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-07T00:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        titleSource: "thread-title",
        lastMessagePreview: "hello",
        lastActivityAt: "2026-04-07T00:00:00.000Z",
        messageCount: 1,
        canSend: true,
        route: {
          channel: "email",
          identityId: "identity-1",
          participantId: "participant-1",
          threadId: "thread-1",
          directness: "direct",
          reply: {
            kind: "thread",
            target: "thread-1",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "message-1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-04-07T00:00:00.000Z",
        actorDisplayName: "Alex",
        text: "hello",
        attachments: [],
      }],
      permissions: [],
    });

    await store.applySnapshot(baseSnapshot);

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-04-07T00:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        titleSource: "thread-title",
        title: "Thread",
        lastActivityAt: "2026-04-07T00:00:00.000Z",
        lastMessagePreview: "hello",
        messageCount: 1,
        canSend: true,
        route: {
          threadId: "thread-1",
          participantId: "participant-1",
          channel: "email",
          directness: "direct",
          identityId: "identity-1",
          reply: {
            target: "thread-1",
            kind: "thread",
          },
        },
      }],
      messages: [{
        schema: "murph.gateway-message.v1",
        messageId: "message-1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-04-07T00:00:00.000Z",
        actorDisplayName: "Alex",
        text: "hello",
        attachments: [],
      }],
      permissions: [],
    });

    const conversations = await store.listConversations();
    const messages = await store.readMessages({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
      oldestFirst: true,
      limit: 10,
    });

    expect(conversations.conversations).toHaveLength(1);
    expect(conversations.conversations[0]?.lastMessagePreview).toBe("hello");
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0]?.text).toBe("hello");
  });
});

describe("gateway permission overrides", () => {
  it("returns the existing snapshot when an override adds no new state", () => {
    const permission = createGatewayPermissionOverrideTestPermission();
    const snapshot = createGatewayPermissionOverrideTestSnapshot(permission, {
      generatedAt: permission.resolvedAt ?? "2026-04-06T00:05:00.000Z",
    });

    const merged = mergeGatewayPermissionOverrides(snapshot, [
      createGatewayPermissionOverrideTestOverride(permission),
    ]);

    expect(merged).toBe(snapshot);
  });

  it("still advances snapshot freshness when a matching override is newer", () => {
    const permission = createGatewayPermissionOverrideTestPermission();
    const snapshot = createGatewayPermissionOverrideTestSnapshot(permission, {
      generatedAt: "2026-04-06T00:04:00.000Z",
    });

    const merged = mergeGatewayPermissionOverrides(snapshot, [
      createGatewayPermissionOverrideTestOverride(permission),
    ]);

    expect(merged).not.toBe(snapshot);
    expect(merged).toEqual(
      createGatewayPermissionOverrideTestSnapshot(permission, {
        generatedAt: permission.resolvedAt ?? "2026-04-06T00:05:00.000Z",
      }),
    );
    expect(merged?.permissions[0]).toEqual(permission);
  });

  it("advances snapshot freshness by instant when override offsets sort lexically older", () => {
    const permission = createGatewayPermissionOverrideTestPermission({
      resolvedAt: "2026-04-06T00:00:00.000Z",
    });
    const snapshot = createGatewayPermissionOverrideTestSnapshot(permission, {
      generatedAt: "2026-04-06T00:30:00+01:00",
    });

    const merged = mergeGatewayPermissionOverrides(snapshot, [
      createGatewayPermissionOverrideTestOverride(permission),
    ]);

    expect(merged).not.toBe(snapshot);
    expect(merged?.generatedAt).toBe("2026-04-06T00:00:00.000Z");
    expect(merged?.permissions[0]).toEqual(permission);
  });

  it("sorts overrides and normalizes blank notes", () => {
    const parsed = readGatewayPermissionOverrides([
      {
        note: "",
        requestId: "request-b",
        resolvedAt: "2026-04-06T00:10:00.000Z",
        status: "approved",
      },
      {
        note: "kept",
        requestId: "request-a",
        resolvedAt: "2026-04-06T00:09:00.000Z",
        status: "denied",
      },
    ]);

    expect(parsed).toEqual([
      {
        note: "kept",
        requestId: "request-a",
        resolvedAt: "2026-04-06T00:09:00.000Z",
        status: "denied",
      },
      {
        note: null,
        requestId: "request-b",
        resolvedAt: "2026-04-06T00:10:00.000Z",
        status: "approved",
      },
    ]);
    expect(sameGatewayPermissionResolutionOverrides(parsed, [...parsed])).toBe(true);
    expect(
      sameGatewayPermissionResolutionOverrides(parsed, [
        { ...parsed[0]!, note: "changed" },
        parsed[1]!,
      ]),
    ).toBe(false);
  });

  it("fails closed on malformed cache-state input with the renamed error text", () => {
    expect(() => readGatewayPermissionOverrides({})).toThrow(
      "gateway projection cache state is invalid.",
    );
  });
});

function createGatewayPermissionOverrideTestPermission(
  overrides: Partial<GatewayPermissionRequest> = {},
): GatewayPermissionRequest {
  return gatewayPermissionRequestSchema.parse({
    schema: "murph.gateway-permission-request.v1",
    requestId: "request-a",
    sessionKey: "session-a",
    action: "send-message",
    description: "Allow sending a message",
    status: "approved",
    requestedAt: "2026-04-06T00:00:00.000Z",
    resolvedAt: "2026-04-06T00:05:00.000Z",
    note: "kept",
    ...overrides,
  });
}

function createGatewayPermissionOverrideTestSnapshot(
  permission: GatewayPermissionRequest,
  overrides: Partial<GatewayProjectionSnapshot> = {},
): GatewayProjectionSnapshot {
  return gatewayProjectionSnapshotSchema.parse({
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-06T00:05:00.000Z",
    conversations: [],
    messages: [],
    permissions: [permission],
    ...overrides,
  });
}

function createGatewayPermissionOverrideTestOverride(
  permission: GatewayPermissionRequest,
): GatewayPermissionResolutionOverride {
  const status: GatewayPermissionResolutionOverride["status"] =
    permission.status === "open" ? "approved" : permission.status;

  return {
    note: permission.note,
    requestId: permission.requestId,
    resolvedAt: permission.resolvedAt ?? "2026-04-06T00:05:00.000Z",
    status,
  };
}
