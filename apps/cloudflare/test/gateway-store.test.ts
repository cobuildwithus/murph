import { describe, expect, it } from "vitest";

import {
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayPermissionRequest,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";

import { buildHostedStorageAad } from "../src/crypto-context.ts";
import {
  decryptHostedBundle,
  encryptHostedBundle,
  type HostedCipherEnvelope,
} from "../src/crypto.ts";
import {
  mergeGatewayPermissionOverrides,
  readGatewayPermissionOverrides,
  sameGatewayPermissionResolutionOverrides,
  type GatewayPermissionResolutionOverride,
} from "../src/gateway-store-permissions.js";
import { HostedGatewayProjectionStore } from "../src/gateway-store.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.js";

const EMAIL_THREAD_SESSION_KEY =
  "gwcs_eyJraW5kIjoiY29udmVyc2F0aW9uIiwicm91dGVUb2tlbiI6ImQ3ZTZiMDU4Y2MzZWZmMWQ5NzNjZGM5YTM0ZjVjNGJjYWU3YzQxNjBlNzRjY2MwZmIyZDU5NGU3ZGEyYjkzNmQiLCJ2ZXJzaW9uIjoyfQ";
const GATEWAY_STATE_STORAGE_AAD = buildHostedStorageAad({
  key: "gateway.state",
  purpose: "gateway-store",
  record: "state",
});
const TEST_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const TEST_CRYPTO = {
  key: TEST_KEY,
  keyId: "v1",
  keysById: {
    v1: TEST_KEY,
  },
};

function createState(options?: {
  initialValues?: Record<string, unknown>;
  onPut?: (key: string, value: unknown) => Promise<void> | void;
}) {
  const values = new Map<string, unknown>(
    Object.entries(options?.initialValues ?? {}),
  );

  const state: DurableObjectStateLike = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async getAlarm(): Promise<number | null> {
        return null;
      },
      async put<T>(key: string, value: T): Promise<void> {
        await options?.onPut?.(key, value);
        values.set(key, value);
      },
      async setAlarm(): Promise<void> {},
    },
  };

  return {
    state,
    values,
  };
}

function createStore(options?: Parameters<typeof createState>[0]) {
  const { state, values } = createState(options);

  return {
    state,
    store: new HostedGatewayProjectionStore(state, TEST_CRYPTO),
    values,
  };
}

describe("HostedGatewayProjectionStore", () => {
  it("resolves permission requests and emits permission events through the shared event-log helper", async () => {
    const { store } = createStore();

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

  it("encrypts durable gateway state and round-trips conversation and message reads", async () => {
    const { store, values } = createStore();

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

    const rawState = values.get("gateway.state") as HostedCipherEnvelope | undefined;
    expect(rawState).toBeTruthy();
    expect(rawState).toHaveProperty("ciphertext");
    expect(values.has("gateway.snapshot")).toBe(false);
    expect(values.has("gateway.events")).toBe(false);
    expect(values.has("gateway.next-cursor")).toBe(false);
    expect(values.has("gateway.permission-overrides")).toBe(false);
    expect(JSON.stringify(rawState)).not.toContain("super secret preview");
    expect(JSON.stringify(rawState)).not.toContain("super secret body");

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
    const { store } = createStore();

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

  it("serializes snapshot writes and permission responses so newer projections are not clobbered", async () => {
    let releaseSnapshotWrite!: () => void;
    let snapshotWriteBlocked = false;
    let markSnapshotWriteBlocked!: () => void;
    const snapshotWriteSeen = new Promise<void>((resolve) => {
      markSnapshotWriteBlocked = resolve;
    });
    const { store } = createStore({
      async onPut(key, value) {
        if (key !== "gateway.state" || snapshotWriteBlocked) {
          return;
        }

        const plaintext = await decryptHostedBundle({
          aad: GATEWAY_STATE_STORAGE_AAD,
          envelope: value as HostedCipherEnvelope,
          expectedKeyId: TEST_CRYPTO.keyId,
          key: TEST_CRYPTO.key,
          keysById: TEST_CRYPTO.keysById,
          scope: "gateway-store",
        });
        const record = JSON.parse(new TextDecoder().decode(plaintext)) as {
          baseSnapshot?: {
            conversations?: Array<{
              lastMessagePreview?: string;
            }>;
          } | null;
        };

        if (
          record.baseSnapshot?.conversations?.[0]?.lastMessagePreview === "newest message"
        ) {
          const releasePromise = new Promise<void>((resolve) => {
            releaseSnapshotWrite = resolve;
          });
          snapshotWriteBlocked = true;
          markSnapshotWriteBlocked();
          await releasePromise;
        }
      },
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
        titleSource: "thread-title",
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

    if (!snapshotWriteBlocked) {
      throw new Error("Expected the snapshot write lock to install a release callback.");
    }
    releaseSnapshotWrite();
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

  it("keeps operator permission decisions applied across later runtime snapshots", async () => {
    const { store } = createStore();

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
    const { store } = createStore();

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

  it("fails closed when encrypted gateway state is malformed after decryption", async () => {
    const encryptedInvalidState = await encryptHostedBundle({
      aad: GATEWAY_STATE_STORAGE_AAD,
      key: TEST_CRYPTO.key,
      keyId: TEST_CRYPTO.keyId,
      plaintext: new TextEncoder().encode(JSON.stringify({
        baseSnapshot: null,
        events: [],
        nextCursor: 0,
        permissionOverrides: [{
          requestId: "perm_invalid",
          status: "approved",
        }],
        schema: "murph.hosted-gateway-state.v1",
      })),
      scope: "gateway-store",
    });
    const { store } = createStore({
      initialValues: {
        "gateway.state": encryptedInvalidState,
      },
    });

    await expect(store.listOpenPermissions()).rejects.toThrow(
      "gateway.state storage is invalid.",
    );
  });

  it("normalizes persisted permission overrides on read without rewriting equivalent state", async () => {
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
    const encryptedState = await encryptHostedBundle({
      aad: GATEWAY_STATE_STORAGE_AAD,
      key: TEST_CRYPTO.key,
      keyId: TEST_CRYPTO.keyId,
      plaintext: new TextEncoder().encode(JSON.stringify({
        baseSnapshot,
        events: [],
        nextCursor: 0,
        permissionOverrides: [
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
        ],
        schema: "murph.hosted-gateway-state.v1",
      })),
      scope: "gateway-store",
    });
    const writes: string[] = [];
    const { store } = createStore({
      initialValues: {
        "gateway.state": encryptedState,
      },
      onPut(key) {
        writes.push(key);
      },
    });

    expect(await store.listOpenPermissions()).toEqual([]);

    await store.applySnapshot(baseSnapshot);

    expect(writes).toEqual([]);
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
