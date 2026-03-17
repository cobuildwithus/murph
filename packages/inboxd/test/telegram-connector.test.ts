import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  DEFAULT_TELEGRAM_ALLOWED_UPDATES,
  createTelegramApiPollDriver,
  createTelegramPollConnector,
  normalizeTelegramUpdate,
} from "../src/index.js";
import type {
  InboundCapture,
  PersistedCapture,
  TelegramApiClient,
  TelegramPollDriver,
  TelegramUpdateLike,
} from "../src/index.js";

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

test("normalizeTelegramUpdate builds thread-aware captures and hydrates downloadable attachments", async () => {
  const capture = await normalizeTelegramUpdate({
    update: {
      update_id: 123,
      message: {
        message_id: 17,
        date: 1_773_397_200,
        message_thread_id: 5,
        text: "Lunch pic",
        chat: {
          id: -100123,
          type: "supergroup",
          title: "Meals",
        },
        from: {
          id: 111,
          first_name: "Alice",
          last_name: "Example",
        },
        photo: [
          {
            file_id: "thumb-1",
            file_unique_id: "thumb-unique-1",
            file_size: 12,
            width: 32,
            height: 32,
          },
          {
            file_id: "photo-1",
            file_unique_id: "photo-unique-1",
            file_size: 48,
            width: 128,
            height: 128,
          },
        ],
      },
    },
    botUser: {
      id: 999,
      username: "healthybob_bot",
    },
    downloadDriver: {
      async getFile(fileId) {
        assert.equal(fileId, "photo-1");
        return {
          file_id: fileId,
          file_path: "photos/file_1.jpg",
        };
      },
      async downloadFile(filePath) {
        assert.equal(filePath, "photos/file_1.jpg");
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
  });

  assert.equal(capture.externalId, "update:123");
  assert.equal(capture.thread.id, "-100123:topic:5");
  assert.equal(capture.thread.title, "Meals");
  assert.equal(capture.actor.id, "111");
  assert.equal(capture.actor.displayName, "Alice Example");
  assert.equal(capture.actor.isSelf, false);
  assert.equal(capture.text, "Lunch pic");
  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.externalId, "photo-unique-1");
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.equal(capture.attachments[0]?.fileName, "photo-photo-unique-1.jpg");
  assert.equal(capture.attachments[0]?.data?.byteLength, 4);
});

test("createTelegramPollConnector backfills in update order and emits Telegram update checkpoints", async () => {
  const emitted: Array<{ capture: InboundCapture; checkpoint?: Record<string, unknown> | null }> = [];
  let watcher:
    | ((update: TelegramUpdateLike) => Promise<void>)
    | null = null;
  let closeCount = 0;
  let deleteWebhookCalls = 0;

  const driver: TelegramPollDriver = {
    async getMe() {
      return {
        id: 999,
        username: "healthybob_bot",
      };
    },
    async getMessages({ cursor }) {
      if (cursor) {
        return [];
      }

      return [
        {
          update_id: 6,
          message: {
            message_id: 200,
            date: 1_773_397_140,
            text: "second",
            chat: {
              id: 10,
              type: "private",
              first_name: "Bob",
            },
            from: {
              id: 111,
              first_name: "Bob",
            },
          },
        },
        {
          update_id: 5,
          message: {
            message_id: 199,
            date: 1_773_397_200,
            text: "first",
            chat: {
              id: 10,
              type: "private",
              first_name: "Bob",
            },
            from: {
              id: 111,
              first_name: "Bob",
            },
          },
        },
      ];
    },
    async startWatching(input) {
      watcher = input.onMessage as typeof watcher;
      return {
        async close() {
          closeCount += 1;
        },
      };
    },
    async getFile() {
      throw new Error("getFile should not be called when downloadAttachments is disabled");
    },
    async downloadFile() {
      throw new Error("downloadFile should not be called when downloadAttachments is disabled");
    },
    async deleteWebhook() {
      deleteWebhookCalls += 1;
    },
    async getWebhookInfo() {
      return {
        url: "",
      };
    },
  };

  const connector = createTelegramPollConnector({
    driver,
    downloadAttachments: false,
  });

  const nextCursor = await connector.backfill(null, async (capture, checkpoint) => {
    emitted.push({ capture, checkpoint });
    return createPersistedCapture(capture);
  });

  assert.equal(connector.id, "telegram:bot");
  assert.equal(deleteWebhookCalls, 1);
  assert.deepEqual(
    emitted.map((entry) => entry.capture.externalId),
    ["update:5", "update:6"],
  );
  assert.deepEqual(
    emitted.map((entry) => entry.checkpoint),
    [{ updateId: 5 }, { updateId: 6 }],
  );
  assert.deepEqual(nextCursor, { updateId: 6 });

  const controller = new AbortController();
  const running = connector.watch(null, async (capture, checkpoint) => {
    emitted.push({ capture, checkpoint });
    return createPersistedCapture(capture);
  }, controller.signal);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await watcher?.({
    update_id: 7,
    message: {
      message_id: 201,
      date: 1_773_397_320,
      text: "third",
      chat: {
        id: 10,
        type: "private",
        first_name: "Bob",
      },
      from: {
        id: 111,
        first_name: "Bob",
      },
    },
  });
  controller.abort();
  await running;

  assert.equal(deleteWebhookCalls, 1);
  assert.equal(closeCount, 1);
  assert.deepEqual(emitted.at(-1)?.checkpoint, { updateId: 7 });
});

test("createTelegramApiPollDriver delegates Bot API calls through the grammY Api shape", async () => {
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteWebhookCalls: Array<Record<string, unknown>> = [];
  let getMeCalls = 0;
  let getFileCalls = 0;
  let getWebhookInfoCalls = 0;
  const downloadRequests: string[] = [];

  const driver = createTelegramApiPollDriver({
    api: {
      token: "bot-token",
      async getMe() {
        getMeCalls += 1;
        return {
          id: 999,
          username: "healthybob_bot",
        };
      },
      async getUpdates(input) {
        updateCalls.push(input ?? {});
        return [
          {
            update_id: 43,
            message: {
              message_id: 1,
              date: 1_773_397_200,
              text: "hello",
              chat: {
                id: 10,
                type: "private",
                first_name: "Bob",
              },
              from: {
                id: 111,
                first_name: "Bob",
              },
            },
          },
        ];
      },
      async getFile(fileId) {
        getFileCalls += 1;
        assert.equal(fileId, "file-1");
        return {
          file_id: fileId,
          file_path: "docs/file.txt",
        };
      },
      async deleteWebhook(input) {
        deleteWebhookCalls.push(input ?? {});
        return true;
      },
      async getWebhookInfo() {
        getWebhookInfoCalls += 1;
        return {
          url: "https://example.invalid/webhook",
        };
      },
    } as unknown as TelegramApiClient,
    batchSize: 5,
    downloadFile: async (filePath) => {
      downloadRequests.push(filePath);
      return new Uint8Array([9, 8, 7]);
    },
  });

  const bot = await driver.getMe();
  assert.equal((bot as { username?: string }).username, "healthybob_bot");

  const updates = await driver.getMessages({
    cursor: { updateId: 42 },
    limit: 1,
  });
  assert.deepEqual(updates.map((update) => update.update_id), [43]);
  assert.deepEqual(updateCalls, [
    {
      offset: 43,
      limit: 1,
      timeout: 0,
      allowed_updates: [...DEFAULT_TELEGRAM_ALLOWED_UPDATES],
    },
  ]);

  const file = await driver.getFile("file-1");
  assert.equal(file.file_path, "docs/file.txt");
  const downloaded = await driver.downloadFile("docs/file.txt");
  assert.deepEqual(downloaded, new Uint8Array([9, 8, 7]));
  assert.deepEqual(downloadRequests, ["docs/file.txt"]);

  await driver.deleteWebhook?.({ dropPendingUpdates: true });
  assert.deepEqual(deleteWebhookCalls, [{ drop_pending_updates: true }]);

  const webhookInfo = await driver.getWebhookInfo?.();
  assert.equal(webhookInfo?.url, "https://example.invalid/webhook");

  assert.equal(getMeCalls, 1);
  assert.equal(getFileCalls, 1);
  assert.equal(getWebhookInfoCalls, 1);
});

test("createTelegramPollConnector backfills page-by-page so cursors advance after persisted captures", async () => {
  const seenCursors: Array<Record<string, unknown> | null | undefined> = [];
  const emitted: string[] = [];

  const connector = createTelegramPollConnector({
    driver: {
      async getMe() {
        return { id: 999, username: "healthybob_bot" };
      },
      async getMessages({ cursor }) {
        seenCursors.push(cursor);
        const updateId = cursor && typeof cursor.updateId === "number" ? cursor.updateId : null;

        if (updateId === null) {
          return [
            {
              update_id: 1,
              message: {
                message_id: 1,
                date: 1_773_397_100,
                text: "one",
                chat: { id: 10, type: "private", first_name: "Bob" },
                from: { id: 111, first_name: "Bob" },
              },
            },
            {
              update_id: 2,
              message: {
                message_id: 2,
                date: 1_773_397_101,
                text: "two",
                chat: { id: 10, type: "private", first_name: "Bob" },
                from: { id: 111, first_name: "Bob" },
              },
            },
          ];
        }

        if (updateId === 2) {
          return [
            {
              update_id: 3,
              message: {
                message_id: 3,
                date: 1_773_397_102,
                text: "three",
                chat: { id: 10, type: "private", first_name: "Bob" },
                from: { id: 111, first_name: "Bob" },
              },
            },
          ];
        }

        return [];
      },
      async startWatching() {},
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
      async downloadFile() {
        throw new Error("downloadFile should not be called in this test");
      },
    },
    downloadAttachments: false,
    backfillLimit: 3,
    resetWebhookOnStart: false,
  });

  const cursor = await connector.backfill(null, async (capture, checkpoint) => {
    emitted.push(capture.externalId);
    assert.ok(checkpoint);
    return createPersistedCapture(capture);
  });

  assert.deepEqual(seenCursors, [null, { updateId: 2 }]);
  assert.deepEqual(emitted, ["update:1", "update:2", "update:3"]);
  assert.deepEqual(cursor, { updateId: 3 });
});

test("createTelegramPollConnector surfaces async polling failures from the watcher", async () => {
  const connector = createTelegramPollConnector({
    driver: {
      async getMe() {
        return { id: 999, username: "healthybob_bot" };
      },
      async getMessages() {
        return [];
      },
      async startWatching() {
        return {
          done: Promise.resolve().then(() => {
            throw new Error("watch loop failed");
          }),
          async close() {},
        };
      },
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
      async downloadFile() {
        throw new Error("downloadFile should not be called in this test");
      },
    },
    downloadAttachments: false,
    resetWebhookOnStart: false,
  });

  await assert.rejects(
    connector.watch(
      null,
      async (capture) => createPersistedCapture(capture),
      new AbortController().signal,
    ),
    /watch loop failed/u,
  );
});

test("createTelegramApiPollDriver reads local Bot API file paths directly", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "telegram-file-"));
  const filePath = path.join(tempDirectory, "file.txt");
  const originalFetch = globalThis.fetch;

  await writeFile(filePath, new Uint8Array([4, 5, 6]));

  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called for local Bot API file paths");
  }) as typeof fetch;

  try {
    const driver = createTelegramApiPollDriver({
      api: {
        token: "bot-token",
        async getMe() {
          return {
            id: 999,
            username: "healthybob_bot",
          };
        },
        async getUpdates() {
          return [];
        },
        async getFile(fileId) {
          assert.equal(fileId, "file-1");
          return {
            file_id: fileId,
            file_path: filePath,
          };
        },
      } as unknown as TelegramApiClient,
    });

    const file = await driver.getFile("file-1");
    const data = await driver.downloadFile(file.file_path!);

    assert.deepEqual(data, new Uint8Array([4, 5, 6]));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
