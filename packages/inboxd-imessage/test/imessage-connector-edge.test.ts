import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";
import {
  createImessageConnector,
  loadImessageKitDriver,
  type ImessageKitMessageLike,
} from "../src/index.ts";
import type { InboundCapture, PersistedCapture } from "@murphai/inboxd";

const imessageMocks = vi.hoisted(() => ({
  closeCalls: 0,
  getMessagesResult: {
    messages: [] as Record<string, unknown>[],
    total: 0,
    unreadCount: 0,
  },
  lastWatcherEvents: undefined as
    | {
        onError?: (error: Error) => void;
        onMessage?: (message: Record<string, unknown>) => void | Promise<void>;
      }
    | undefined,
  startWatchingError: null as Error | null,
  stopWatchingCalls: 0,
}));

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: class {
    async getMessages() {
      return imessageMocks.getMessagesResult;
    }

    async listChats() {
      return [];
    }

    async startWatching(events?: {
      onError?: (error: Error) => void;
      onMessage?: (message: Record<string, unknown>) => void | Promise<void>;
    }) {
      imessageMocks.lastWatcherEvents = events;
      if (imessageMocks.startWatchingError) {
        throw imessageMocks.startWatchingError;
      }
    }

    stopWatching() {
      imessageMocks.stopWatchingCalls += 1;
    }

    async close() {
      imessageMocks.closeCalls += 1;
    }
  },
}));

function createPersistedCapture(capture: InboundCapture): PersistedCapture {
  return {
    captureId: `cap-${capture.externalId}`,
    eventId: `evt-${capture.externalId}`,
    auditId: `aud-${capture.externalId}`,
    envelopePath: `raw/inbox/${capture.source}/${capture.externalId}.json`,
    createdAt: capture.occurredAt,
    deduped: false,
  };
}

afterEach(() => {
  imessageMocks.closeCalls = 0;
  imessageMocks.getMessagesResult = {
    messages: [],
    total: 0,
    unreadCount: 0,
  };
  imessageMocks.lastWatcherEvents = undefined;
  imessageMocks.startWatchingError = null;
  imessageMocks.stopWatchingCalls = 0;
});

test("createImessageConnector hydrates ephemeral attachments and clears missing temporary paths", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "imessage-edge-"));
  const temporaryItemsDirectory = path.join(tempDirectory, "Library", "Messages", "TemporaryItems");
  const hydratedPath = path.join(temporaryItemsDirectory, "photo.jpg");
  const missingPath = path.join(temporaryItemsDirectory, "missing.jpg");
  await mkdir(temporaryItemsDirectory, { recursive: true });
  await writeFile(hydratedPath, new Uint8Array([1, 2, 3]));

  try {
    const emitted: InboundCapture[] = [];
    const connector = createImessageConnector({
      driver: {
        async getMessages() {
          return {
            messages: [
              {
                guid: "im-1",
                text: "temporary attachment",
                date: "2026-03-18T12:00:00.000Z",
                chatId: "chat-1",
                sender: "+15551234567",
                senderName: "Alice",
                isFromMe: false,
                attachments: [
                  {
                    id: "att-1",
                    filename: "photo.jpg",
                    mimeType: "image/jpeg",
                    path: hydratedPath,
                    size: 3,
                  },
                ],
              },
              {
                guid: "im-2",
                text: "missing temporary attachment",
                date: "2026-03-18T12:01:00.000Z",
                chatId: "chat-2",
                sender: "+15557654321",
                senderName: "Bob",
                isFromMe: false,
                attachments: [
                  {
                    id: "att-2",
                    filename: "missing.jpg",
                    mimeType: "image/jpeg",
                    path: missingPath,
                    size: 5,
                  },
                ],
              },
            ] satisfies ImessageKitMessageLike[],
          };
        },
        async startWatching() {},
        async listChats() {
          return [
            { id: "chat-1", displayName: "Alice", isGroup: false },
            { id: "chat-2", displayName: "Bob", isGroup: false },
          ];
        },
      },
      backfillLimit: 2,
    });

    await connector.backfill(null, async (capture: InboundCapture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    });

    assert.equal(emitted.length, 2);
    assert.deepEqual(Array.from(emitted[0]?.attachments[0]?.data ?? []), [1, 2, 3]);
    assert.equal(emitted[1]?.attachments[0]?.originalPath, null);
    assert.equal(emitted[1]?.attachments[0]?.data ?? null, null);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});

test("loadImessageKitDriver returns early for aborted watchers and keeps invalid-date messages sortable", async () => {
  const abortedController = new AbortController();
  abortedController.abort();

  const driver = await loadImessageKitDriver();
  const abortedHandle = await driver.startWatching({
    includeOwnMessages: true,
    signal: abortedController.signal,
    onMessage() {},
  });

  assert.equal(abortedHandle, undefined);

  imessageMocks.getMessagesResult = {
    messages: [
      {
        id: "msg-invalid-date",
        guid: "im-invalid-date",
        text: "hello",
        date: "not-a-date",
        chatId: "chat-1",
        sender: "+15551234567",
        senderName: "Alice",
        isFromMe: false,
        attachments: [],
      },
    ],
    total: 1,
    unreadCount: 1,
  };

  const page = await driver.getMessages({
    cursor: {
      occurredAt: "2026-03-18T12:00:00.000Z",
      externalId: "im-old",
    },
    includeOwnMessages: true,
    limit: 5,
  });

  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]?.guid, "im-invalid-date");
});

test("loadImessageKitDriver sorts valid messages across timestamps, keeps messages without cursors, and filters by external id at the same timestamp", async () => {
  imessageMocks.getMessagesResult = {
    messages: [
      {
        id: "msg-no-date",
        guid: "im-no-date",
        text: "missing date",
        date: null,
        chatId: "chat-1",
        sender: "+15550000001",
        senderName: "Null Date",
        isFromMe: false,
        attachments: [],
      },
      {
        id: "msg-late",
        guid: "im-late",
        text: "late",
        date: "2026-03-18T12:05:00.000Z",
        chatId: "chat-1",
        sender: "+15550000002",
        senderName: "Late",
        isFromMe: false,
        attachments: [],
      },
      {
        id: "msg-bravo",
        guid: "im-bravo",
        text: "same timestamp after cursor",
        date: "2026-03-18T12:02:00.000Z",
        chatId: "chat-1",
        sender: "+15550000003",
        senderName: "Bravo",
        isFromMe: false,
        attachments: [],
      },
      {
        id: "msg-early",
        guid: "im-early",
        text: "before cursor",
        date: "2026-03-18T11:59:00.000Z",
        chatId: "chat-1",
        sender: "+15550000004",
        senderName: "Early",
        isFromMe: false,
        attachments: [],
      },
      {
        id: "msg-alpha",
        guid: "im-alpha",
        text: "same timestamp as cursor",
        date: "2026-03-18T12:02:00.000Z",
        chatId: "chat-1",
        sender: "+15550000005",
        senderName: "Alpha",
        isFromMe: false,
        attachments: [],
      },
    ],
    total: 5,
    unreadCount: 5,
  };

  const driver = await loadImessageKitDriver();
  const page = await driver.getMessages({
    cursor: {
      occurredAt: "2026-03-18T12:02:00.000Z",
      externalId: "im-alpha",
    },
    includeOwnMessages: true,
    limit: 5,
  });

  assert.deepEqual(
    page.messages.map((message) => message.guid),
    ["im-no-date", "im-bravo", "im-late"],
  );
});

test("createImessageConnector leaves non-ephemeral, preloaded, oversized, and blank attachment paths unchanged", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "imessage-skip-"));
  const temporaryItemsDirectory = path.join(tempDirectory, "Library", "Messages", "TemporaryItems");
  const oversizedPath = path.join(temporaryItemsDirectory, "huge.mov");
  const preloadedPath = path.join(temporaryItemsDirectory, "cached.jpg");
  await mkdir(temporaryItemsDirectory, { recursive: true });

  try {
    const emitted: InboundCapture[] = [];
    const connector = createImessageConnector({
      driver: {
        async getMessages() {
          return {
            messages: [
              {
                guid: "im-skip-1",
                text: "attachment branches",
                date: "2026-03-18T12:03:00.000Z",
                chatId: "chat-3",
                sender: "+15559876543",
                senderName: "Carol",
                isFromMe: false,
                attachments: [
                  {
                    id: "att-non-ephemeral",
                    filename: "photo.jpg",
                    mimeType: "image/jpeg",
                    path: "/tmp/photo.jpg",
                    size: 3,
                  },
                  {
                    id: "att-preloaded",
                    filename: "cached.jpg",
                    mimeType: "image/jpeg",
                    path: preloadedPath,
                    size: 3,
                    data: new Uint8Array([9, 8, 7]),
                  },
                  {
                    id: "att-oversized",
                    filename: "huge.mov",
                    mimeType: "video/quicktime",
                    path: oversizedPath,
                    size: 30 * 1024 * 1024,
                  },
                  {
                    id: "att-blank-path",
                    filename: "note.txt",
                    mimeType: "text/plain",
                    path: null,
                    size: 4,
                  },
                ],
              },
            ] satisfies ImessageKitMessageLike[],
          };
        },
        async startWatching() {},
        async listChats() {
          return [{ id: "chat-3", displayName: "Carol", isGroup: false }];
        },
      },
      backfillLimit: 1,
    });

    await connector.backfill(null, async (capture: InboundCapture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.attachments[0]?.originalPath, "/tmp/photo.jpg");
    assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);
    assert.deepEqual(Array.from(emitted[0]?.attachments[1]?.data ?? []), [9, 8, 7]);
    assert.equal(emitted[0]?.attachments[1]?.originalPath, preloadedPath);
    assert.equal(emitted[0]?.attachments[2]?.originalPath, oversizedPath);
    assert.equal(emitted[0]?.attachments[2]?.data ?? null, null);
    assert.equal(emitted[0]?.attachments[3]?.originalPath, null);
    assert.equal(emitted[0]?.attachments[3]?.data ?? null, null);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});

test("loadImessageKitDriver closes the SDK after watcher errors", async () => {
  const driver = await loadImessageKitDriver();
  const controller = new AbortController();
  const handle = await driver.startWatching({
    includeOwnMessages: true,
    signal: controller.signal,
    onMessage() {},
  });

  imessageMocks.lastWatcherEvents?.onError?.(new Error("watch failed"));

  if (handle && typeof handle === "object" && "done" in handle) {
    const done = handle.done;
    if (!done) {
      throw new TypeError("Expected iMessage watch handle with a done promise.");
    }
    await assert.rejects(done, /watch failed/u);
  } else {
    throw new TypeError("Expected iMessage watch handle with a done promise.");
  }
  assert.equal(imessageMocks.stopWatchingCalls, 1);
  assert.equal(imessageMocks.closeCalls, 1);
});

test("loadImessageKitDriver closes the SDK when watcher setup throws", async () => {
  imessageMocks.startWatchingError = new Error("watch setup failed");

  const driver = await loadImessageKitDriver();
  const controller = new AbortController();

  await assert.rejects(
    driver.startWatching({
      includeOwnMessages: true,
      signal: controller.signal,
      onMessage() {},
    }),
    /watch setup failed/u,
  );
  assert.equal(imessageMocks.stopWatchingCalls, 0);
  assert.equal(imessageMocks.closeCalls, 1);
});
