import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  GatewayLocalOutboxSource,
  GatewayLocalProjectionSourceReader,
  GatewayLocalSessionSource,
} from "@murphai/gateway-core";
import {
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  gatewayConversationRouteFromBinding,
  resolveGatewayConversationRouteKey,
} from "@murphai/gateway-core";
import { openSqliteRuntimeDatabase, resolveGatewayRuntimePaths } from "@murphai/runtime-state/node";
import { afterEach, test } from "vitest";

import { LocalGatewayProjectionStore } from "../src/store.js";
import {
  listOpenPermissionsFromDatabase,
  respondToPermissionInDatabase,
} from "../src/store/permissions.js";
import {
  ensureGatewayStoreBaseSchema,
  readMeta,
  SNAPSHOT_GENERATED_AT_META_KEY,
  withGatewayImmediateTransaction,
  writeMeta,
} from "../src/store/schema.js";
import {
  clearCaptureSources,
  readCaptureAttachmentRows,
  readCaptureSourceRows,
  readGatewaySourceEventCount,
  replaceOutboxSources,
  replaceSessionSources,
  upsertCaptureSources,
} from "../src/store/source-sync.js";
import {
  readSnapshotState,
  rebuildSnapshotStateFrom,
} from "../src/store/snapshot-state.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("source-sync stores normalized capture rows and attachments", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    upsertCaptureSources(database, [
      {
        accountId: " email-account ",
        actor: {
          displayName: " Alex ",
          id: "contact:alex",
          isSelf: false,
        },
        attachments: [
          {
            attachmentId: "attachment-email-1",
            byteSize: 128,
            externalId: " provider-attachment-1 ",
            extractedText: "minutes",
            fileName: "notes.txt",
            kind: "document",
            mime: "text/plain",
            ordinal: 0,
            parseState: "parsed",
            transcriptText: null,
          },
        ],
        captureId: "capture-email-1",
        createdAt: "2026-04-08T00:00:05.000Z",
        envelopePath: "raw/email/envelope.json",
        eventId: "event-email-1",
        externalId: "email:provider-message-1",
        occurredAt: "2026-04-08T00:00:00.000Z",
        raw: {},
        source: "email",
        text: "Hello from email",
        thread: {
          id: "thread-email",
          isDirect: true,
          title: " Project Thread ",
        },
      },
      {
        actor: {
          displayName: "Murph",
          id: "telegram-user",
          isSelf: false,
        },
        attachments: [
          {
            attachmentId: "attachment-telegram-1",
            byteSize: null,
            externalId: null,
            extractedText: null,
            fileName: null,
            kind: "image",
            mime: "image/jpeg",
            ordinal: 0,
            parseState: null,
            transcriptText: null,
          },
        ],
        captureId: "capture-telegram-1",
        createdAt: "2026-04-08T00:01:05.000Z",
        envelopePath: "raw/telegram/envelope.json",
        eventId: "event-telegram-1",
        externalId: "telegram:ignored",
        occurredAt: "2026-04-08T00:01:00.000Z",
        raw: {
          message: {
            message_id: 4321,
          },
        },
        source: "telegram",
        text: "Hello from telegram",
        thread: {
          id: "thread-telegram",
          isDirect: false,
          title: "Telegram room",
        },
      },
    ]);

    const captureRows = readCaptureSourceRows(database);
    const attachmentRows = readCaptureAttachmentRows(database);

    assert.equal(readGatewaySourceEventCount(database, "capture"), 2);
    assert.deepEqual(
      captureRows.map((row) => ({
        actorDisplayName: row.actorDisplayName,
        identityId: row.identityId,
        providerMessageId: row.providerMessageId,
        source: row.source,
        threadTitle: row.threadTitle,
      })),
      [
        {
          actorDisplayName: "Alex",
          identityId: "email-account",
          providerMessageId: "provider-message-1",
          source: "email",
          threadTitle: "Project Thread",
        },
        {
          actorDisplayName: "Murph",
          identityId: null,
          providerMessageId: "4321",
          source: "telegram",
          threadTitle: "Telegram room",
        },
      ],
    );
    assert.deepEqual(
      attachmentRows.map((row) => ({
        attachmentId: row.attachmentId,
        captureId: row.captureId,
        kind: row.kind,
        parseState: row.parseState,
      })),
      [
        {
          attachmentId: attachmentRows[0]?.attachmentId,
          captureId: "capture-email-1",
          kind: "document",
          parseState: "parsed",
        },
        {
          attachmentId: attachmentRows[1]?.attachmentId,
          captureId: "capture-telegram-1",
          kind: "image",
          parseState: null,
        },
      ],
    );

    clearCaptureSources(database);
    assert.equal(readGatewaySourceEventCount(database, "capture"), 0);
    assert.equal(readCaptureAttachmentRows(database).length, 0);
  } finally {
    database.close();
  }
});

test("gateway local projection store rejects pre-cutover sqlite user_version values", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "murph-gateway-local-version-"));
  tempRoots.push(tempRoot);

  const databasePath = resolveGatewayRuntimePaths(tempRoot).gatewayDbPath;
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec("PRAGMA user_version = 4;");
  database.close();

  assert.throws(
    () => new LocalGatewayProjectionStore(tempRoot),
    /gateway local projection database schema version 4 is newer than supported version 1/u,
  );
});

test("snapshot rebuild derives conversations, merges self-captures into sent outbox rows, and persists metadata", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  const sessionSource: GatewayLocalSessionSource = {
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
  };
  const route = gatewayConversationRouteFromBinding(sessionSource.binding);
  const routeKey = resolveGatewayConversationRouteKey(route);
  assert.ok(routeKey);
  const routeSessionKey = createGatewayConversationSessionKey(routeKey);
  const outboxMessageId = createGatewayOutboxMessageId(
    routeKey,
    "intent-email-1",
  );

  replaceSessionSources(database, [sessionSource]);
  replaceOutboxSources(database, [
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
  ]);
  upsertCaptureSources(database, [
    {
      accountId: "murph@example.com",
      actor: {
        displayName: "Alex",
        id: "contact:alex",
        isSelf: false,
      },
      attachments: [],
      captureId: "capture-inbound-1",
      createdAt: "2026-04-08T00:00:10.000Z",
      envelopePath: "raw/email/inbound.json",
      eventId: "event-inbound-1",
      externalId: "email:provider-inbound-1",
      occurredAt: "2026-04-08T00:00:10.000Z",
      raw: {},
      source: "email",
      text: "Inbound hello",
      thread: {
        id: "thread-email",
        isDirect: true,
        title: "Inbox thread",
      },
    },
    {
      accountId: "murph@example.com",
      actor: {
        displayName: "Murph",
        id: "contact:alex",
        isSelf: true,
      },
      attachments: [
        {
          attachmentId: "attachment-outbound-1",
          byteSize: 256,
          externalId: "asset-1",
          extractedText: null,
          fileName: "photo.jpg",
          kind: "image",
          mime: "image/jpeg",
          ordinal: 0,
          parseState: null,
          transcriptText: null,
        },
      ],
      captureId: "capture-outbound-1",
      createdAt: "2026-04-08T00:01:06.000Z",
      envelopePath: "raw/email/outbound.json",
      eventId: "event-outbound-1",
      externalId: "email:provider-outbox-1",
      occurredAt: "2026-04-08T00:01:06.000Z",
      raw: {},
      source: "email",
      text: "Delivered echo",
      thread: {
        id: "thread-email",
        isDirect: true,
        title: "Inbox thread",
      },
    },
  ]);
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
    routeSessionKey,
    "send-message",
    "Approve the reply",
    "open",
    "2026-04-08T00:02:00.000Z",
    null,
    null,
  );

  try {
    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshotState = readSnapshotState(database);
    const snapshot = snapshotState.snapshot;

    assert.ok(snapshot);
    assert.equal(readMeta(database, SNAPSHOT_GENERATED_AT_META_KEY), snapshot.generatedAt);
    assert.equal(snapshot.conversations.length, 1);
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.permissions.length, 1);

    const [conversation] = snapshot.conversations;
    assert.equal(conversation?.sessionKey, routeSessionKey);
    assert.equal(conversation?.title, "Priority thread");
    assert.equal(conversation?.titleSource, "alias");
    assert.equal(conversation?.canSend, true);
    assert.equal(conversation?.messageCount, 2);

    const outboundMessage = snapshot.messages.find((message) => message.direction === "outbound");
    assert.ok(outboundMessage);
    assert.equal(outboundMessage.messageId, outboxMessageId);
    assert.equal(outboundMessage.actorDisplayName, "Murph");
    assert.equal(outboundMessage.text, "Queued body");
    assert.equal(outboundMessage.attachments.length, 1);
    assert.equal(outboundMessage.attachments[0]?.fileName, "photo.jpg");
  } finally {
    database.close();
  }
});

test("permission helpers filter open requests by session and rebuild snapshot state on response", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  const sessionKey = createGatewayConversationSessionKey("permission-route");
  const otherSessionKey = createGatewayConversationSessionKey("other-route");

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
    "permission-open",
    sessionKey,
    "send-message",
    "Allow the reply",
    "open",
    "2026-04-08T00:00:00.000Z",
    null,
    null,
  );
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
    "permission-approved",
    otherSessionKey,
    "send-message",
    "Already resolved",
    "approved",
    "2026-04-08T00:01:00.000Z",
    "2026-04-08T00:02:00.000Z",
    "done",
  );

  let rebuildCalls = 0;
  try {
    const listed = listOpenPermissionsFromDatabase(database, sessionKey);
    assert.deepEqual(
      listed.map((permission) => permission.requestId),
      ["permission-open"],
    );

    const resolved = respondToPermissionInDatabase(
      database,
      {
        decision: "deny",
        note: "  not now  ",
        requestId: "permission-open",
      },
      () => ({
        events: [],
        nextCursor: 0,
        snapshot: null,
      }),
      () => {
        rebuildCalls += 1;
      },
    );

    assert.equal(rebuildCalls, 1);
    assert.equal(resolved?.status, "denied");
    assert.equal(resolved?.note, "not now");
    assert.equal(
      database
        .prepare("SELECT status FROM gateway_permissions WHERE request_id = ?")
        .get("permission-open")?.status,
      "denied",
    );
  } finally {
    database.close();
  }
});

test("respondToPermissionInDatabase returns null without rebuilding when the request is missing", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  let rebuildCalls = 0;
  try {
    const resolved = respondToPermissionInDatabase(
      database,
      {
        decision: "approve",
        note: "ignored",
        requestId: "missing-request",
      },
      () => ({
        events: [],
        nextCursor: 0,
        snapshot: null,
      }),
      () => {
        rebuildCalls += 1;
      },
    );

    assert.equal(resolved, null);
    assert.equal(rebuildCalls, 0);
  } finally {
    database.close();
  }
});

test("snapshot rebuild ignores blank aliases and falls back to the latest thread title", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  replaceSessionSources(database, [
    {
      alias: "   ",
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
  ]);
  upsertCaptureSources(database, [
    {
      accountId: "murph@example.com",
      actor: {
        displayName: "Alex",
        id: "contact:alex",
        isSelf: false,
      },
      attachments: [],
      captureId: "capture-email-1",
      createdAt: "2026-04-08T00:00:05.000Z",
      envelopePath: "raw/email/envelope.json",
      eventId: "event-email-1",
      externalId: "email:provider-message-1",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "email",
      text: "Hello from email",
      thread: {
        id: "thread-email",
        isDirect: true,
        title: "  Team thread  ",
      },
    },
  ]);

  try {
    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshot = readSnapshotState(database).snapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.conversations[0]?.title, "Team thread");
    assert.equal(snapshot.conversations[0]?.titleSource, "thread-title");
  } finally {
    database.close();
  }
});

test("LocalGatewayProjectionStore syncs session and outbox sources into the runtime database", async () => {
  const vaultRoot = mkdtempSync(path.join(tmpdir(), "gateway-local-store-"));
  tempRoots.push(vaultRoot);

  const sourceReader: GatewayLocalProjectionSourceReader = {
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
        } satisfies GatewayLocalOutboxSource,
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
        } satisfies GatewayLocalSessionSource,
      ];
    },
  };

  const store = new LocalGatewayProjectionStore(vaultRoot, { sourceReader });
  try {
    const snapshot = await store.syncAndReadSnapshot();

    assert.equal(snapshot.conversations.length, 1);
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.conversations[0]?.title, "Priority thread");
    assert.equal(snapshot.messages[0]?.text, "Queued body");
    assert.equal(
      store.readMessageProviderReplyTarget(snapshot.messages[0]!.messageId),
      "provider-outbox-1",
    );
  } finally {
    store.close();
  }
});

test("schema helpers commit and roll back immediate transactions", async () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    database.exec("CREATE TABLE transaction_entries (value TEXT NOT NULL)");

    await withGatewayImmediateTransaction(database, async () => {
      database
        .prepare("INSERT INTO transaction_entries (value) VALUES (?)")
        .run("committed");
      writeMeta(database, "custom.value", "stored");
    });

    await assert.rejects(
      withGatewayImmediateTransaction(database, async () => {
        database
          .prepare("INSERT INTO transaction_entries (value) VALUES (?)")
          .run("rolled-back");
        throw new Error("rollback");
      }),
      /rollback/u,
    );

    assert.deepEqual(
      (
        database.prepare("SELECT value FROM transaction_entries ORDER BY rowid").all() as Array<{
          value: string;
        }>
      ).map((row) => ({ value: row.value })),
      [{ value: "committed" }],
    );
    assert.equal(readMeta(database, "custom.value"), "stored");
  } finally {
    database.close();
  }
});
