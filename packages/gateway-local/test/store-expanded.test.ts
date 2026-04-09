import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
  type GatewayLocalProjectionSourceReader,
} from "@murphai/gateway-core";
import { afterEach, beforeEach, test, vi } from "vitest";

const { loadCaptureSyncState, waitForGatewayEventsByPolling } = vi.hoisted(() => ({
  loadCaptureSyncState: vi.fn(),
  waitForGatewayEventsByPolling: vi.fn(),
}));

vi.mock("../src/store/source-sync.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/source-sync.js")>(
    "../src/store/source-sync.js",
  );
  return {
    ...actual,
    loadCaptureSyncState,
  };
});

vi.mock("@murphai/gateway-core", async () => {
  const actual = await vi.importActual<typeof import("@murphai/gateway-core")>(
    "@murphai/gateway-core",
  );
  return {
    ...actual,
    waitForGatewayEventsByPolling,
  };
});

import {
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  LocalGatewayProjectionStore,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
} from "../src/store.js";
import {
  ensureGatewayStoreBaseSchema,
  readMeta,
  readNumericMeta,
  writeMeta,
} from "../src/store/schema.js";
import {
  computeOutboxSyncSignature,
  computeSessionSyncSignature,
} from "../src/store/source-sync.js";
import {
  openSqliteRuntimeDatabase,
  resolveGatewayRuntimePaths,
} from "@murphai/runtime-state/node";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createVaultRoot() {
  const vaultRoot = mkdtempSync(path.join(tmpdir(), "gateway-local-store-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

function openGatewayDatabase(vaultRoot: string) {
  return openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath);
}

function createCapture(
  captureId: string,
  overrides: Partial<{
    actorDisplayName: string;
    actorId: string;
    occurredAt: string;
    providerMessageId: string;
    text: string;
    threadId: string;
    threadTitle: string;
  }> = {},
) {
  return {
    accountId: "murph@example.com",
    actor: {
      displayName: overrides.actorDisplayName ?? "Alex",
      id: overrides.actorId ?? "contact:alex",
      isSelf: false,
    },
    attachments: [],
    captureId,
    createdAt: overrides.occurredAt ?? "2026-04-08T00:00:05.000Z",
    envelopePath: `raw/email/${captureId}.json`,
    eventId: `event-${captureId}`,
    externalId: `email:${overrides.providerMessageId ?? captureId}`,
    occurredAt: overrides.occurredAt ?? "2026-04-08T00:00:00.000Z",
    raw: {},
    source: "email" as const,
    text: overrides.text ?? `text-${captureId}`,
    thread: {
      id: overrides.threadId ?? "thread-email",
      isDirect: true,
      title: overrides.threadTitle ?? "Thread title",
    },
  };
}

function createSourceReader(): GatewayLocalProjectionSourceReader {
  return {
    async listOutboxSources() {
      return [
        {
          actorId: "contact:alex",
          bindingDelivery: {
            kind: "thread",
            target: "thread-email",
          },
          channel: "email",
          createdAt: "2026-04-08T00:01:00.000Z",
          delivery: {
            channel: "email",
            idempotencyKey: "gateway-send:req-1",
            messageLength: 11,
            providerMessageId: "provider-outbox-1",
            providerThreadId: "thread-email",
            sentAt: "2026-04-08T00:01:05.000Z",
            target: "thread-email",
            targetKind: "thread",
          },
          identityId: "murph@example.com",
          intentId: "intent-email-1",
          message: "Queued body",
          replyToMessageId: null,
          sentAt: "2026-04-08T00:01:05.000Z",
          status: "sent",
          threadId: "thread-email",
          threadIsDirect: true,
          updatedAt: "2026-04-08T00:01:05.000Z",
        },
      ];
    },
    async listSessionSources() {
      return [
        {
          alias: "Priority thread",
          binding: {
            actorId: "contact:alex",
            channel: "email",
            conversationKey: null,
            delivery: {
              kind: "thread",
              target: "thread-email",
            },
            identityId: "murph@example.com",
            threadId: "thread-email",
            threadIsDirect: true,
          },
          sessionId: "session-email-1",
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      ];
    },
  };
}

test("LocalGatewayProjectionStore preserves the stored snapshot when sync is a full noop", async () => {
  const vaultRoot = createVaultRoot();
  const sourceReader = createSourceReader();

  loadCaptureSyncState.mockResolvedValueOnce({
    captures: [],
    headCursor: 5,
    kind: "rebuild",
  });
  loadCaptureSyncState.mockResolvedValueOnce({
    headCursor: 5,
    kind: "noop",
  });

  const store = new LocalGatewayProjectionStore(vaultRoot, { sourceReader });
  try {
    const firstSnapshot = await store.syncAndReadSnapshot();
    const secondSnapshot = await store.syncAndReadSnapshot();

    assert.equal(firstSnapshot.conversations.length, 1);
    assert.equal(firstSnapshot.messages.length, 1);
    assert.equal(secondSnapshot.generatedAt, firstSnapshot.generatedAt);
    assert.equal(loadCaptureSyncState.mock.calls[0]?.[0], vaultRoot);
    assert.equal(loadCaptureSyncState.mock.calls[0]?.[1], null);
    assert.equal(loadCaptureSyncState.mock.calls[1]?.[1], 5);

    const database = openGatewayDatabase(vaultRoot);
    try {
      assert.equal(readNumericMeta(database, "captures.cursor"), 5);
      assert.equal(readMeta(database, "captures.initialized"), "1");
      assert.equal(readMeta(database, "captures.empty"), "1");
      assert.ok(readMeta(database, "sessions.signature"));
      assert.ok(readMeta(database, "outbox.signature"));
    } finally {
      database.close();
    }
  } finally {
    store.close();
  }
});

test("LocalGatewayProjectionStore rebuilds an empty snapshot when sync is noop and no snapshot exists yet", async () => {
  const vaultRoot = createVaultRoot();
  const emptySessionSignature = computeSessionSyncSignature([]);
  const emptyOutboxSignature = computeOutboxSyncSignature([]);

  const database = openGatewayDatabase(vaultRoot);
  try {
    ensureGatewayStoreBaseSchema(database);
    writeMeta(database, "sessions.signature", emptySessionSignature);
    writeMeta(database, "outbox.signature", emptyOutboxSignature);
  } finally {
    database.close();
  }

  loadCaptureSyncState.mockResolvedValueOnce({
    headCursor: 0,
    kind: "noop",
  });

  const store = new LocalGatewayProjectionStore(vaultRoot);
  try {
    const snapshot = await store.syncAndReadSnapshot();

    assert.equal(snapshot.conversations.length, 0);
    assert.equal(snapshot.messages.length, 0);
    assert.equal(snapshot.permissions.length, 0);
    assert.ok(snapshot.generatedAt);

    const reopenedDatabase = openGatewayDatabase(vaultRoot);
    try {
      assert.equal(readMeta(reopenedDatabase, "sessions.signature"), emptySessionSignature);
      assert.equal(readMeta(reopenedDatabase, "outbox.signature"), emptyOutboxSignature);
    } finally {
      reopenedDatabase.close();
    }
  } finally {
    store.close();
  }
});

test("LocalGatewayProjectionStore applies incremental capture updates and exposes store wrappers", async () => {
  const vaultRoot = createVaultRoot();

  loadCaptureSyncState.mockResolvedValueOnce({
    captures: [createCapture("capture-1", { providerMessageId: "provider-message-1" })],
    headCursor: 10,
    kind: "rebuild",
  });
  loadCaptureSyncState.mockResolvedValueOnce({
    captures: [
      createCapture("capture-1", {
        occurredAt: "2026-04-08T00:02:00.000Z",
        providerMessageId: "provider-message-2",
        text: "updated-text",
      }),
    ],
    changedCaptureIds: ["capture-1"],
    headCursor: 11,
    kind: "incremental",
  });

  const store = new LocalGatewayProjectionStore(vaultRoot);
  try {
    const firstSnapshot = await store.syncAndReadSnapshot();
    const secondSnapshot = await store.syncAndReadSnapshot();
    const captureMessageId = secondSnapshot.messages[0]?.messageId;

    assert.equal(firstSnapshot.messages[0]?.text, "text-capture-1");
    assert.equal(secondSnapshot.messages[0]?.text, "updated-text");
    assert.ok(captureMessageId);
    assert.equal(
      store.readMessageProviderReplyTarget(captureMessageId),
      "provider-message-2",
    );
    assert.equal(store.readMessageProviderReplyTarget("missing-message"), null);

    const sessionKey = secondSnapshot.conversations[0]?.sessionKey;
    assert.ok(sessionKey);

    const database = openGatewayDatabase(vaultRoot);
    try {
      database.prepare(`
        INSERT INTO gateway_permissions (
          request_id,
          session_key,
          action,
          description,
          status,
          requested_at,
          resolved_at,
          note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "permission-1",
        sessionKey,
        "send-message",
        "Approve the reply",
        "open",
        "2026-04-08T00:03:00.000Z",
        null,
        null,
      );
    } finally {
      database.close();
    }

    const allOpenPermissions = store.listOpenPermissions();
    const openPermissions = store.listOpenPermissions({ sessionKey });
    const resolvedPermission = store.respondToPermission({
      decision: "approve",
      note: "  ship it  ",
      requestId: "permission-1",
    });
    const polled = store.pollEvents();

    assert.deepEqual(
      allOpenPermissions.map((permission) => permission.requestId),
      ["permission-1"],
    );
    assert.deepEqual(
      openPermissions.map((permission) => permission.requestId),
      ["permission-1"],
    );
    assert.equal(resolvedPermission?.status, "approved");
    assert.equal(resolvedPermission?.note, "ship it");
    assert.ok(polled.events.some((event) => event.permissionRequestId === "permission-1"));
  } finally {
    store.close();
  }
});

test("top-level local store helpers sync, read, respond, and wait with the runtime store", async () => {
  const vaultRoot = createVaultRoot();
  const dependencies = {
    sourceReader: createSourceReader(),
  };

  loadCaptureSyncState.mockResolvedValueOnce({
    captures: [createCapture("capture-wrapper-1", { providerMessageId: "wrapper-provider-1" })],
    headCursor: 20,
    kind: "rebuild",
  });

  const snapshot = await exportGatewayProjectionSnapshotLocal(vaultRoot, dependencies);
  const sessionKey = snapshot.conversations[0]?.sessionKey;
  assert.ok(sessionKey);

  const database = openGatewayDatabase(vaultRoot);
  try {
    database.prepare(`
      INSERT INTO gateway_permissions (
        request_id,
        session_key,
        action,
        description,
        status,
        requested_at,
        resolved_at,
        note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "permission-wrapper-1",
      sessionKey,
      "send-message",
      "Approve the reply",
      "open",
      "2026-04-08T00:04:00.000Z",
      null,
      null,
    );
  } finally {
    database.close();
  }

  loadCaptureSyncState.mockResolvedValue({
    headCursor: 20,
    kind: "noop",
  });
  waitForGatewayEventsByPolling.mockImplementation(async (poll, input, options) => {
    assert.equal(options.intervalMs, DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS);
    return poll({
      cursor: Math.max(0, input?.cursor ?? 0),
    });
  });

  const permissions = await listGatewayOpenPermissionsLocal(
    vaultRoot,
    { sessionKey },
    dependencies,
  );
  const resolvedPermission = await respondToGatewayPermissionLocal(
    vaultRoot,
    {
      decision: "deny",
      note: "  not now  ",
      requestId: "permission-wrapper-1",
    },
    dependencies,
  );
  const pollResult = await pollGatewayEventsLocal(vaultRoot, { cursor: 0 }, dependencies);
  const waited = await waitForGatewayEventsLocal(
    vaultRoot,
    { cursor: pollResult.nextCursor - 1, timeoutMs: 0 },
    dependencies,
  );

  assert.deepEqual(
    permissions.map((permission) => permission.requestId),
    ["permission-wrapper-1"],
  );
  assert.equal(resolvedPermission?.status, "denied");
  assert.equal(resolvedPermission?.note, "not now");
  assert.equal(waitForGatewayEventsByPolling.mock.calls.length, 1);
  assert.ok(pollResult.events.length >= 1);
  assert.ok(waited.events.length >= 1);
});

test("schema meta helpers reject invalid numeric values and delete null writes", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    writeMeta(database, "numeric.invalid", "Infinity");
    writeMeta(database, "delete.me", "present");
    writeMeta(database, "delete.me", null);

    assert.equal(readNumericMeta(database, "numeric.invalid"), null);
    assert.equal(readMeta(database, "delete.me"), null);
  } finally {
    database.close();
  }
});
