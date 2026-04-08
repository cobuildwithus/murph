import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, test, vi } from "vitest";

const {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
  openSqliteRuntimeDatabase,
  resolveInboxRuntimePaths,
} = vi.hoisted(() => ({
  listInboxCaptureMutations: vi.fn(),
  openInboxRuntime: vi.fn(),
  readInboxCaptureMutationHead: vi.fn(),
  openSqliteRuntimeDatabase: vi.fn(),
  resolveInboxRuntimePaths: vi.fn(),
}));

vi.mock("@murphai/inboxd/runtime", () => ({
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
}));

vi.mock("@murphai/runtime-state/node", () => ({
  openSqliteRuntimeDatabase,
  resolveInboxRuntimePaths,
}));

import {
  clearCaptureSources,
  computeOutboxSyncSignature,
  computeSessionSyncSignature,
  loadCaptureSyncState,
  readCaptureAttachmentRows,
  readCaptureSourceRows,
  readGatewaySourceEventCount,
  readOutboxSourceRows,
  readSessionSourceRows,
  replaceCaptureSourcesForCaptureIds,
  replaceOutboxSources,
  replaceSessionSources,
  upsertCaptureSources,
} from "../src/store/source-sync.js";
import { ensureGatewayStoreBaseSchema } from "../src/store/schema.js";

function createCapture(
  captureId: string,
  overrides: Partial<{
    accountId: string | null;
    actorDisplayName: string | null;
    actorId: string;
    attachments: Array<{
      attachmentId: string;
      byteSize: number | null;
      externalId: string | null;
      extractedText: string | null;
      fileName: string | null;
      kind: "document" | "image";
      mime: string | null;
      ordinal: number;
      parseState: string | null;
      transcriptText: string | null;
    }>;
    externalId: string | null;
    occurredAt: string;
    text: string | null;
    threadId: string;
    threadTitle: string | null;
  }> = {},
) {
  return {
    accountId: overrides.accountId ?? "murph@example.com",
    actor: {
      displayName: overrides.actorDisplayName ?? "Alex",
      id: overrides.actorId ?? "contact:alex",
      isSelf: false,
    },
    attachments: overrides.attachments ?? [],
    captureId,
    createdAt: overrides.occurredAt ?? "2026-04-08T00:00:05.000Z",
    envelopePath: `raw/email/${captureId}.json`,
    eventId: `event-${captureId}`,
    externalId: overrides.externalId ?? `email:${captureId}`,
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

function createRuntimeCaptureDatabase(rows: Array<{ captureId: string; createdAt: string }>) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE capture (
      capture_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `);
  const insert = database.prepare(
    "INSERT INTO capture (capture_id, created_at) VALUES (?, ?)",
  );
  for (const row of rows) {
    insert.run(row.captureId, row.createdAt);
  }
  return database;
}

function createRuntimeCaptureReader(rows: Array<{ captureId: string; createdAt: string }>) {
  return {
    close: vi.fn(),
    prepare() {
      return {
        all() {
          return rows;
        },
      };
    },
  };
}

function createSessionSource(
  sessionId: string,
  overrides: Partial<{
    actorId: string | null;
    alias: string | null;
    channel: string | null;
    identityId: string | null;
    threadId: string | null;
    threadIsDirect: boolean | null;
    updatedAt: string;
  }> = {},
) {
  return {
    alias: overrides.alias ?? "Alias",
    binding: {
      actorId: overrides.actorId ?? "contact:alex",
      channel: overrides.channel ?? "email",
      conversationKey: null,
      delivery: {
        kind: "thread" as const,
        target: overrides.threadId ?? "thread-email",
      },
      identityId: overrides.identityId ?? "murph@example.com",
      threadId: overrides.threadId ?? "thread-email",
      threadIsDirect: overrides.threadIsDirect ?? true,
    },
    sessionId,
    updatedAt: overrides.updatedAt ?? "2026-04-08T00:00:00.000Z",
  };
}

function createOutboxSource(
  intentId: string,
  overrides: Partial<{
    actorId: string | null;
    channel: string | null;
    identityId: string | null;
    providerMessageId: string | null;
    providerThreadId: string | null;
    replyToMessageId: string | null;
    sentAt: string | null;
    status: "pending" | "sent" | "failed";
    threadId: string | null;
    threadIsDirect: boolean | null;
    updatedAt: string;
  }> = {},
) {
  const threadId = overrides.threadId ?? "thread-email";
  const updatedAt = overrides.updatedAt ?? "2026-04-08T00:00:00.000Z";
  const sentAt = overrides.sentAt ?? null;
  return {
    actorId: overrides.actorId ?? "contact:alex",
    bindingDelivery: {
      kind: "thread" as const,
      target: threadId,
    },
    channel: overrides.channel ?? "email",
    createdAt: updatedAt,
    delivery:
      overrides.providerMessageId || overrides.providerThreadId || sentAt
        ? {
            channel: overrides.channel ?? "email",
            idempotencyKey: `gateway-send:${intentId}`,
            messageLength: 5,
            providerMessageId: overrides.providerMessageId ?? null,
            providerThreadId: overrides.providerThreadId ?? threadId,
            sentAt: sentAt ?? updatedAt,
            target: threadId,
            targetKind: "thread" as const,
          }
        : null,
    identityId: overrides.identityId ?? "murph@example.com",
    intentId,
    message: `message-${intentId}`,
    replyToMessageId: overrides.replyToMessageId ?? null,
    sentAt,
    status: overrides.status ?? "pending",
    threadId,
    threadIsDirect: overrides.threadIsDirect ?? true,
    updatedAt,
  };
}

beforeEach(() => {
  listInboxCaptureMutations.mockReset();
  openInboxRuntime.mockReset();
  readInboxCaptureMutationHead.mockReset();
  openSqliteRuntimeDatabase.mockReset();
  resolveInboxRuntimePaths.mockReset();
  resolveInboxRuntimePaths.mockReturnValue({
    inboxDbPath: "/tmp/mock-inbox.sqlite",
  });
});

test("computeSessionSyncSignature is order-insensitive and normalizes alias whitespace", () => {
  const left = computeSessionSyncSignature([
    {
      alias: "  Alpha  ",
      binding: {
        actorId: "contact:alpha",
        channel: "email",
        conversationKey: null,
        delivery: {
          kind: "thread",
          target: "thread-a",
        },
        identityId: "murph@example.com",
        threadId: "thread-a",
        threadIsDirect: true,
      },
      sessionId: "session-a",
      updatedAt: "2026-04-08T00:00:00.000Z",
    },
    {
      alias: "   ",
      binding: {
        actorId: "contact:beta",
        channel: "email",
        conversationKey: null,
        delivery: {
          kind: "thread",
          target: "thread-b",
        },
        identityId: "murph@example.com",
        threadId: "thread-b",
        threadIsDirect: true,
      },
      sessionId: "session-b",
      updatedAt: "2026-04-08T00:01:00.000Z",
    },
  ]);

  const right = computeSessionSyncSignature([
    {
      alias: null,
      binding: {
        actorId: "contact:beta",
        channel: "email",
        conversationKey: null,
        delivery: {
          kind: "thread",
          target: "thread-b",
        },
        identityId: "murph@example.com",
        threadId: "thread-b",
        threadIsDirect: true,
      },
      sessionId: "session-b",
      updatedAt: "2026-04-08T00:01:00.000Z",
    },
    {
      alias: "Alpha",
      binding: {
        actorId: "contact:alpha",
        channel: "email",
        conversationKey: null,
        delivery: {
          kind: "thread",
          target: "thread-a",
        },
        identityId: "murph@example.com",
        threadId: "thread-a",
        threadIsDirect: true,
      },
      sessionId: "session-a",
      updatedAt: "2026-04-08T00:00:00.000Z",
    },
  ]);

  assert.equal(left, right);
});

test("computeOutboxSyncSignature is order-insensitive and trims blank reply-to ids", () => {
  const left = computeOutboxSyncSignature([
    {
      actorId: "contact:alpha",
      bindingDelivery: {
        kind: "thread",
        target: "thread-a",
      },
      channel: "email",
      createdAt: "2026-04-08T00:00:00.000Z",
      delivery: null,
      identityId: "murph@example.com",
      intentId: "intent-a",
      message: "hello",
      replyToMessageId: "   ",
      sentAt: null,
      status: "pending",
      threadId: "thread-a",
      threadIsDirect: true,
      updatedAt: "2026-04-08T00:00:00.000Z",
    },
    {
      actorId: "contact:beta",
      bindingDelivery: {
        kind: "thread",
        target: "thread-b",
      },
      channel: "email",
      createdAt: "2026-04-08T00:02:00.000Z",
      delivery: {
        channel: "email",
        idempotencyKey: "gateway-send:req-b",
        messageLength: 5,
        providerMessageId: "provider-b",
        providerThreadId: "thread-b",
        sentAt: "2026-04-08T00:02:05.000Z",
        target: "thread-b",
        targetKind: "thread",
      },
      identityId: "murph@example.com",
      intentId: "intent-b",
      message: "world",
      replyToMessageId: "provider-1",
      sentAt: "2026-04-08T00:02:05.000Z",
      status: "sent",
      threadId: "thread-b",
      threadIsDirect: true,
      updatedAt: "2026-04-08T00:02:05.000Z",
    },
  ]);

  const right = computeOutboxSyncSignature([
    {
      actorId: "contact:beta",
      bindingDelivery: {
        kind: "thread",
        target: "thread-b",
      },
      channel: "email",
      createdAt: "2026-04-08T00:02:00.000Z",
      delivery: {
        channel: "email",
        idempotencyKey: "gateway-send:req-b",
        messageLength: 5,
        providerMessageId: "provider-b",
        providerThreadId: "thread-b",
        sentAt: "2026-04-08T00:02:05.000Z",
        target: "thread-b",
        targetKind: "thread",
      },
      identityId: "murph@example.com",
      intentId: "intent-b",
      message: "changed but ignored",
      replyToMessageId: "provider-1",
      sentAt: "2026-04-08T00:02:05.000Z",
      status: "sent",
      threadId: "thread-b",
      threadIsDirect: true,
      updatedAt: "2026-04-08T00:02:05.000Z",
    },
    {
      actorId: "contact:alpha",
      bindingDelivery: {
        kind: "thread",
        target: "thread-a",
      },
      channel: "email",
      createdAt: "2026-04-08T00:00:00.000Z",
      delivery: null,
      identityId: "murph@example.com",
      intentId: "intent-a",
      message: "different text",
      replyToMessageId: null,
      sentAt: null,
      status: "pending",
      threadId: "thread-a",
      threadIsDirect: true,
      updatedAt: "2026-04-08T00:00:00.000Z",
    },
  ]);

  assert.equal(left, right);
});

test("replaceCaptureSourcesForCaptureIds replaces only targeted captures and refreshes attachments once", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    upsertCaptureSources(database, [
      createCapture("capture-a", {
        attachments: [
          {
            attachmentId: "attachment-a-1",
            byteSize: 10,
            externalId: "provider-a-1",
            extractedText: null,
            fileName: "old.txt",
            kind: "document",
            mime: "text/plain",
            ordinal: 0,
            parseState: null,
            transcriptText: null,
          },
        ],
        text: "old-a",
      }),
      createCapture("capture-b", {
        attachments: [
          {
            attachmentId: "attachment-b-1",
            byteSize: 20,
            externalId: "provider-b-1",
            extractedText: null,
            fileName: "keep.txt",
            kind: "document",
            mime: "text/plain",
            ordinal: 0,
            parseState: null,
            transcriptText: null,
          },
        ],
        text: "keep-b",
      }),
    ]);

    replaceCaptureSourcesForCaptureIds(
      database,
      ["capture-a", "capture-a"],
      [
        createCapture("capture-a", {
          attachments: [
            {
              attachmentId: "attachment-a-2",
              byteSize: 30,
              externalId: "provider-a-2",
              extractedText: null,
              fileName: "new.txt",
              kind: "document",
              mime: "text/plain",
              ordinal: 0,
              parseState: "parsed",
              transcriptText: null,
            },
          ],
          text: "new-a",
        }),
      ],
    );

    assert.deepEqual(
      readCaptureSourceRows(database).map((row) => ({
        captureId: row.sourceRecordId,
        text: row.text,
      })),
      [
        { captureId: "capture-a", text: "new-a" },
        { captureId: "capture-b", text: "keep-b" },
      ],
    );
    assert.deepEqual(
      readCaptureAttachmentRows(database)
        .map((row) => ({
          captureId: row.captureId,
          fileName: row.fileName,
          parseState: row.parseState,
        }))
        .sort((left, right) => left.captureId.localeCompare(right.captureId)),
      [
        {
          captureId: "capture-a",
          fileName: "new.txt",
          parseState: "parsed",
        },
        {
          captureId: "capture-b",
          fileName: "keep.txt",
          parseState: null,
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("clearCaptureSources removes only capture-backed rows and attachments", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    upsertCaptureSources(database, [
      createCapture("capture-a", {
        attachments: [
          {
            attachmentId: "attachment-a-1",
            byteSize: 10,
            externalId: "provider-a-1",
            extractedText: null,
            fileName: "capture.txt",
            kind: "document",
            mime: "text/plain",
            ordinal: 0,
            parseState: null,
            transcriptText: null,
          },
        ],
      }),
    ]);
    replaceSessionSources(database, [createSessionSource("session-a")]);
    replaceOutboxSources(database, [createOutboxSource("intent-a")]);

    clearCaptureSources(database);

    assert.equal(readGatewaySourceEventCount(database, "capture"), 0);
    assert.equal(readCaptureAttachmentRows(database).length, 0);
    assert.equal(readGatewaySourceEventCount(database, "session"), 1);
    assert.equal(readGatewaySourceEventCount(database, "outbox"), 1);
  } finally {
    database.close();
  }
});

test("loadCaptureSyncState returns noop when the capture head cursor is unchanged", async () => {
  readInboxCaptureMutationHead.mockResolvedValue(7);

  const result = await loadCaptureSyncState("/vault/local", 7);

  assert.deepEqual(result, {
    kind: "noop",
    headCursor: 7,
  });
  assert.equal(listInboxCaptureMutations.mock.calls.length, 0);
  assert.equal(openInboxRuntime.mock.calls.length, 0);
});

test("loadCaptureSyncState rebuilds when no cursor is stored or when the head cursor regresses", async () => {
  const runtime = {
    close: vi.fn(),
    getCapture(captureId: string) {
      return createCapture(captureId, {
        occurredAt:
          captureId === "capture-a"
            ? "2026-04-08T00:00:00.000Z"
            : "2026-04-08T00:01:00.000Z",
      });
    },
  };

  openSqliteRuntimeDatabase.mockReturnValueOnce(
    createRuntimeCaptureReader([
      { captureId: "capture-a", createdAt: "2026-04-08T00:00:00.000Z" },
      { captureId: "capture-b", createdAt: "2026-04-08T00:01:00.000Z" },
    ]),
  );
  openInboxRuntime.mockResolvedValue(runtime);

  readInboxCaptureMutationHead.mockResolvedValueOnce(4);
  const rebuildFromNull = await loadCaptureSyncState("/vault/local", null);
  assert.equal(rebuildFromNull.kind, "rebuild");
  assert.equal(rebuildFromNull.headCursor, 4);
  assert.deepEqual(
    rebuildFromNull.captures.map((capture) => capture.captureId),
    ["capture-a", "capture-b"],
  );

  openSqliteRuntimeDatabase.mockReturnValueOnce(
    createRuntimeCaptureReader([
      { captureId: "capture-a", createdAt: "2026-04-08T00:00:00.000Z" },
      { captureId: "capture-b", createdAt: "2026-04-08T00:01:00.000Z" },
    ]),
  );
  readInboxCaptureMutationHead.mockResolvedValueOnce(2);
  const rebuildFromRegression = await loadCaptureSyncState("/vault/local", 5);
  assert.equal(rebuildFromRegression.kind, "rebuild");
  assert.equal(rebuildFromRegression.headCursor, 2);
  assert.deepEqual(
    rebuildFromRegression.captures.map((capture) => capture.captureId),
    ["capture-a", "capture-b"],
  );

  assert.equal(listInboxCaptureMutations.mock.calls.length, 0);
  assert.equal(runtime.close.mock.calls.length, 2);
});

test("loadCaptureSyncState falls back to a full rebuild when incremental mutations cannot be read", async () => {
  const runtimeDatabase = createRuntimeCaptureDatabase([
    { captureId: "capture-b", createdAt: "2026-04-08T00:01:00.000Z" },
    { captureId: "capture-a", createdAt: "2026-04-08T00:00:00.000Z" },
  ]);

  readInboxCaptureMutationHead.mockResolvedValue(5);
  listInboxCaptureMutations.mockResolvedValue([]);
  openSqliteRuntimeDatabase.mockReturnValue(runtimeDatabase);
  openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
    getCapture(captureId: string) {
      return captureId === "capture-a"
        ? createCapture("capture-a", { occurredAt: "2026-04-08T00:00:00.000Z" })
        : captureId === "capture-b"
          ? createCapture("capture-b", { occurredAt: "2026-04-08T00:01:00.000Z" })
          : null;
    },
  });

  const result = await loadCaptureSyncState("/vault/local", 3);

  assert.equal(result.kind, "rebuild");
  assert.equal(result.headCursor, 5);
  assert.deepEqual(
    result.captures.map((capture) => capture.captureId),
    ["capture-a", "capture-b"],
  );
});

test("loadCaptureSyncState returns incremental changes in mutation cursor order", async () => {
  readInboxCaptureMutationHead.mockResolvedValue(6);
  listInboxCaptureMutations
    .mockResolvedValueOnce([
      { captureId: "capture-a", cursor: 4 },
      { captureId: "capture-a", cursor: 5 },
      { captureId: "capture-b", cursor: 6 },
    ])
    .mockResolvedValueOnce([]);
  openInboxRuntime.mockResolvedValue({
    close: vi.fn(),
    getCapture(captureId: string) {
      return createCapture(captureId, {
        occurredAt:
          captureId === "capture-a"
            ? "2026-04-08T00:00:00.000Z"
            : "2026-04-08T00:01:00.000Z",
      });
    },
  });

  const result = await loadCaptureSyncState("/vault/local", 3);

  assert.deepEqual(result, {
    kind: "incremental",
    changedCaptureIds: ["capture-a", "capture-b"],
    captures: [
      createCapture("capture-a", { occurredAt: "2026-04-08T00:00:00.000Z" }),
      createCapture("capture-b", { occurredAt: "2026-04-08T00:01:00.000Z" }),
    ],
    headCursor: 6,
  });
  assert.deepEqual(listInboxCaptureMutations.mock.calls[0]?.[0], {
    afterCursor: 3,
    limit: 500,
    vaultRoot: "/vault/local",
  });
});

test("loadCaptureSyncState rebuilds on an empty later mutation page and omits missing captures in incremental reads", async () => {
  openSqliteRuntimeDatabase.mockReturnValueOnce(
    createRuntimeCaptureReader([
      { captureId: "capture-a", createdAt: "2026-04-08T00:00:00.000Z" },
    ]),
  );

  readInboxCaptureMutationHead.mockResolvedValueOnce(8);
  listInboxCaptureMutations
    .mockResolvedValueOnce([{ captureId: "capture-a", cursor: 6 }])
    .mockResolvedValueOnce([]);
  openInboxRuntime.mockResolvedValueOnce({
    close: vi.fn(),
    getCapture(captureId: string) {
      return captureId === "capture-a" ? createCapture("capture-a") : null;
    },
  });

  const rebuildResult = await loadCaptureSyncState("/vault/local", 5);
  assert.equal(rebuildResult.kind, "rebuild");
  assert.equal(rebuildResult.headCursor, 8);
  assert.deepEqual(
    rebuildResult.captures.map((capture) => capture.captureId),
    ["capture-a"],
  );

  readInboxCaptureMutationHead.mockResolvedValueOnce(8);
  listInboxCaptureMutations.mockResolvedValueOnce([
    { captureId: "capture-a", cursor: 6 },
    { captureId: "capture-missing", cursor: 8 },
  ]);
  const incrementalRuntime = {
    close: vi.fn(),
    getCapture(captureId: string) {
      return captureId === "capture-a" ? createCapture("capture-a") : null;
    },
  };
  openInboxRuntime.mockResolvedValueOnce(incrementalRuntime);

  const incrementalResult = await loadCaptureSyncState("/vault/local", 5);
  assert.deepEqual(incrementalResult, {
    kind: "incremental",
    changedCaptureIds: ["capture-a", "capture-missing"],
    captures: [createCapture("capture-a")],
    headCursor: 8,
  });
  assert.equal(incrementalRuntime.close.mock.calls.length, 1);
});

test("capture upserts normalize provider ids across sources and fall back when telegram ids are invalid", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    upsertCaptureSources(database, [
      createCapture("capture-email", {
        accountId: " account-email ",
        externalId: " email:provider-email ",
      }),
      createCapture("capture-email-empty", {
        accountId: " account-empty ",
        externalId: "   ",
      }),
      {
        ...createCapture("capture-linq", {
          accountId: " account-linq ",
          externalId: " linq:provider-linq ",
          threadId: "thread-linq",
        }),
        source: "linq" as const,
      },
      {
        ...createCapture("capture-custom", {
          actorId: "contact:custom",
          externalId: "  provider-custom  ",
          threadId: "thread-custom",
        }),
        accountId: null,
        source: "custom",
      },
      {
        ...createCapture("capture-telegram-edited", {
          externalId: "telegram:ignored",
          threadId: "thread-telegram-edited",
        }),
        accountId: null,
        raw: {
          edited_message: {
            message_id: 9001,
          },
        },
        source: "telegram" as const,
      },
      {
        ...createCapture("capture-telegram-channel", {
          externalId: "telegram:ignored",
          threadId: "thread-telegram-channel",
        }),
        accountId: null,
        raw: {
          channel_post: {
            message_id: 42,
          },
        },
        source: "telegram" as const,
      },
      {
        ...createCapture("capture-telegram-invalid", {
          externalId: "telegram:ignored",
          threadId: "thread-telegram-invalid",
        }),
        accountId: null,
        raw: {
          message: {
            message_id: "not-a-number",
          },
        },
        source: "telegram" as const,
      },
    ]);

    assert.deepEqual(
      readCaptureSourceRows(database).map((row) => ({
        captureId: row.sourceRecordId,
        identityId: row.identityId,
        providerMessageId: row.providerMessageId,
      })),
      [
        {
          captureId: "capture-custom",
          identityId: null,
          providerMessageId: "provider-custom",
        },
        {
          captureId: "capture-email",
          identityId: "account-email",
          providerMessageId: "provider-email",
        },
        {
          captureId: "capture-email-empty",
          identityId: "account-empty",
          providerMessageId: null,
        },
        {
          captureId: "capture-linq",
          identityId: "account-linq",
          providerMessageId: "provider-linq",
        },
        {
          captureId: "capture-telegram-channel",
          identityId: null,
          providerMessageId: "42",
        },
        {
          captureId: "capture-telegram-edited",
          identityId: null,
          providerMessageId: "9001",
        },
        {
          captureId: "capture-telegram-invalid",
          identityId: null,
          providerMessageId: null,
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("capture, session, and outbox replacements skip rows that cannot resolve a route key", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    upsertCaptureSources(database, [
      createCapture("capture-invalid", {
        actorId: "   ",
        threadId: "   ",
      }),
    ]);
    assert.equal(readGatewaySourceEventCount(database, "capture"), 0);
    assert.equal(readCaptureAttachmentRows(database).length, 0);

    replaceSessionSources(database, [
      createSessionSource("session-invalid", {
        actorId: "   ",
        channel: "email",
        threadId: "   ",
        threadIsDirect: true,
      }),
    ]);
    assert.deepEqual(readSessionSourceRows(database), []);

    replaceOutboxSources(database, [
      createOutboxSource("intent-invalid", {
        actorId: "   ",
        channel: "email",
        threadId: "   ",
        threadIsDirect: true,
      }),
    ]);
    assert.deepEqual(readOutboxSourceRows(database), []);
  } finally {
    database.close();
  }
});
