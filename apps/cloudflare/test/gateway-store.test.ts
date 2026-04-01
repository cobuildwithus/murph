import { describe, expect, it } from "vitest";

import { HostedGatewayProjectionStore } from "../src/gateway-store.ts";

const EMAIL_THREAD_SESSION_KEY =
  "gwcs_eyJraW5kIjoiY29udmVyc2F0aW9uIiwicm91dGVUb2tlbiI6ImQ3ZTZiMDU4Y2MzZWZmMWQ5NzNjZGM5YTM0ZjVjNGJjYWU3YzQxNjBlNzRjY2MwZmIyZDU5NGU3ZGEyYjkzNmQiLCJ2ZXJzaW9uIjoyfQ";

function createState(options?: {
  onPut?: (key: string, value: unknown) => Promise<void> | void;
}) {
  const values = new Map<string, unknown>();

  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        await options?.onPut?.(key, value);
        values.set(key, value);
      },
    },
  };
}

describe("HostedGatewayProjectionStore", () => {
  it("resolves permission requests and emits permission events through the shared event-log helper", async () => {
    const store = new HostedGatewayProjectionStore(createState());

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

  it("ignores replayed older snapshots after a newer projection was already stored", async () => {
    const store = new HostedGatewayProjectionStore(createState());

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:05:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
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

  it("serializes snapshot writes and permission responses so newer projections are not clobbered", async () => {
    let releaseSnapshotWrite: (() => void) | null = null;
    let markSnapshotWriteBlocked!: () => void;
    const snapshotWriteSeen = new Promise<void>((resolve) => {
      markSnapshotWriteBlocked = resolve;
    });
    const store = new HostedGatewayProjectionStore(createState({
      async onPut(key, value) {
        if (
          key === "gateway.snapshot"
          && releaseSnapshotWrite === null
          && typeof value === "object"
          && value !== null
          && "conversations" in value
          && Array.isArray(value.conversations)
          && value.conversations[0]
          && typeof value.conversations[0] === "object"
          && value.conversations[0] !== null
          && "lastMessagePreview" in value.conversations[0]
          && value.conversations[0].lastMessagePreview === "newest message"
        ) {
          const releasePromise = new Promise<void>((resolve) => {
            releaseSnapshotWrite = resolve;
          });
          markSnapshotWriteBlocked();
          await releasePromise;
        }
      },
    }));

    await store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:00:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        lastMessagePreview: "older message",
        lastActivityAt: "2026-03-30T21:00:00.000Z",
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
        messageId: "gwcm_old",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        direction: "inbound",
        createdAt: "2026-03-30T21:00:00.000Z",
        actorDisplayName: "Alex",
        text: "older message",
        attachments: [],
      }],
      permissions: [{
        schema: "murph.gateway-permission-request.v1",
        requestId: "perm_lock",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    const applyingSnapshot = store.applySnapshot({
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: "2026-03-30T21:05:00.000Z",
      conversations: [{
        schema: "murph.gateway-conversation.v1",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        title: "Thread",
        lastMessagePreview: "newest message",
        lastActivityAt: "2026-03-30T21:05:00.000Z",
        messageCount: 2,
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
        requestId: "perm_lock",
        sessionKey: EMAIL_THREAD_SESSION_KEY,
        action: "send-message",
        description: "Need operator approval",
        status: "open",
        requestedAt: "2026-03-30T21:00:00.000Z",
        resolvedAt: null,
        note: null,
      }],
    });

    await snapshotWriteSeen;
    const resolvingPermission = store.respondToPermission({
      requestId: "perm_lock",
      decision: "approve",
      note: "approved after refresh",
    });

    releaseSnapshotWrite?.();
    await applyingSnapshot;
    await resolvingPermission;

    const conversation = await store.getConversation({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });
    const permissions = await store.listOpenPermissions({
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });
    const events = await store.pollEvents({
      cursor: 0,
      kinds: ["permission.resolved"],
      limit: 10,
      sessionKey: EMAIL_THREAD_SESSION_KEY,
    });

    expect(conversation?.lastMessagePreview).toBe("newest message");
    expect(permissions).toHaveLength(0);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      kind: "permission.resolved",
      permissionRequestId: "perm_lock",
      summary: "approved after refresh",
    });
  });
});
