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
  computeOutboxSyncSignature,
  computeSessionSyncSignature,
  loadCaptureSyncState,
  readCaptureAttachmentRows,
  readCaptureSourceRows,
  replaceCaptureSourcesForCaptureIds,
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

beforeEach(() => {
  vi.clearAllMocks();
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
