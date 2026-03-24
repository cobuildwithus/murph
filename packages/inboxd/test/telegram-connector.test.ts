import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

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

test("normalizeTelegramUpdate allowlists raw update metadata and drops secret-bearing extras", async () => {
  const capture = await normalizeTelegramUpdate({
    update: {
      update_id: 124,
      authorization: "Bearer <AUTH_SECRET>",
      message: {
        message_id: 18,
        date: 1_773_397_201,
        text: "Secret-free update",
        cookie: "session=<COOKIE_SECRET>",
        chat: {
          id: 42,
          type: "private",
          first_name: "Alice",
          session: "<SESSION_ID>",
        },
        from: {
          id: 111,
          first_name: "Alice",
          api_key: "<API_KEY>",
        },
        business_connection_id: "biz-42",
        direct_messages_topic: {
          topic_id: 8,
          title: "Priority",
          secret: "<DM_TOPIC_SECRET>",
        },
        media_group_id: "album-7",
        reply_to_message: {
          message_id: 17,
          text: "Earlier message",
          chat: {
            id: 42,
            type: "private",
            first_name: "Alice",
          },
          from: {
            id: 111,
            first_name: "Alice",
          },
        },
        photo: [
          {
            file_id: "photo-2",
            file_unique_id: "photo-unique-2",
            file_size: 64,
            width: 64,
            height: 64,
            secret: "<PHOTO_SECRET>",
          },
        ],
      },
    },
  });

  assert.equal(capture.raw.update_id, 124);
  assert.equal("authorization" in capture.raw, false);
  const messageRaw = capture.raw.message as Record<string, unknown>;
  assert.ok(messageRaw);
  assert.equal(messageRaw.text, "Secret-free update");
  assert.equal("cookie" in messageRaw, false);
  assert.equal(messageRaw.business_connection_id, "biz-42");
  assert.equal(messageRaw.media_group_id, "album-7");
  assert.deepEqual(messageRaw.direct_messages_topic, {
    topic_id: 8,
    title: "Priority",
  });
  assert.deepEqual(messageRaw.chat, {
    id: 42,
    type: "private",
    first_name: "Alice",
  });
  assert.deepEqual(messageRaw.from, {
    id: 111,
    first_name: "Alice",
  });
  assert.deepEqual(messageRaw.photo, [
    {
      file_id: "photo-2",
      file_unique_id: "photo-unique-2",
      file_size: 64,
      width: 64,
      height: 64,
    },
  ]);
  assert.deepEqual(messageRaw.reply_to_message, {
    message_id: 17,
    text: "Earlier message",
    chat: {
      id: 42,
      type: "private",
      first_name: "Alice",
    },
    from: {
      id: 111,
      first_name: "Alice",
    },
    sender_chat: null,
    sender_business_bot: null,
    quote: null,
    contact: null,
    location: null,
    venue: null,
    poll: null,
  });
});

test("normalizeTelegramUpdate supports business chats, direct-message topics, and fallback non-text payloads", async () => {
  const businessCapture = await normalizeTelegramUpdate({
    update: {
      update_id: 125,
      business_message: {
        message_id: 19,
        business_connection_id: "biz-42",
        date: 1_773_397_202,
        text: "Business hello",
        chat: {
          id: 42,
          type: "private",
          first_name: "Alice",
        },
        from: {
          id: 111,
          first_name: "Alice",
        },
      },
    },
  });

  assert.equal(businessCapture.thread.id, "42:business:biz-42");
  assert.equal(businessCapture.thread.isDirect, true);
  assert.equal(businessCapture.text, "Business hello");

  const directMessagesCapture = await normalizeTelegramUpdate({
    update: {
      update_id: 126,
      message: {
        message_id: 20,
        date: 1_773_397_203,
        chat: {
          id: -100555,
          type: "supergroup",
          title: "Channel inbox",
          is_direct_messages: true,
        },
        direct_messages_topic: {
          topic_id: 9,
          title: "Priority",
        },
        from: {
          id: 222,
          first_name: "Bob",
        },
        poll: {
          question: "How are you feeling?",
          options: [
            { text: "Great" },
            { text: "Tired" },
          ],
        },
      },
    },
  });

  assert.equal(directMessagesCapture.thread.id, "-100555:dm-topic:9");
  assert.equal(directMessagesCapture.thread.title, "Channel inbox / Priority");
  assert.equal(directMessagesCapture.thread.isDirect, true);
  assert.equal(
    directMessagesCapture.text,
    "Shared poll: How are you feeling? [Great | Tired]",
  );
});

test("normalizeTelegramUpdate rejects unsupported edited Telegram updates", async () => {
  await assert.rejects(
    () =>
      normalizeTelegramUpdate({
        update: {
          update_id: 127,
          edited_message: {
            message_id: 21,
            date: 1_773_397_204,
            text: "typo fix",
            chat: {
              id: 42,
              type: "private",
              first_name: "Alice",
            },
            from: {
              id: 111,
              first_name: "Alice",
            },
          } as TelegramUpdateLike["message"],
        } as TelegramUpdateLike,
      }),
    /supported message payload/u,
  );
});

test("normalizeTelegramUpdate does not treat third-party bot senders as self without bot identity context", async () => {
  const capture = await normalizeTelegramUpdate({
    update: {
      update_id: 128,
      message: {
        message_id: 22,
        date: 1_773_397_205,
        text: "Helpful automation",
        chat: {
          id: -100321,
          type: "supergroup",
          title: "Meals",
        },
        from: {
          id: 777,
          first_name: "Notifier",
          is_bot: true,
        },
      },
    },
    botUser: null,
  });

  assert.equal(capture.actor.id, "777");
  assert.equal(capture.actor.displayName, "Notifier");
  assert.equal(capture.actor.isSelf, false);
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
        return {
          messages: [],
        };
      }

      return {
        messages: [
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
        ],
      };
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
  assert.deepEqual(updates.messages.map((update) => update.update_id), [43]);
  assert.deepEqual(updates.nextCursor, { updateId: 43 });
  assert.deepEqual(updateCalls, [
    {
      offset: 43,
      limit: 1,
      timeout: 0,
      allowed_updates: ["message", "business_message"],
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

test("createTelegramApiPollDriver retries transient polling failures before resuming the watch loop", async () => {
  vi.useFakeTimers();

  let attempts = 0;
  const deliveredUpdateIds: number[] = [];
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
        attempts += 1;
        if (attempts === 1) {
          throw new Error("429 Too Many Requests: retry after 1");
        }

        return [
          {
            update_id: 88,
            message: {
              message_id: 8,
              date: 1_773_397_240,
              text: "after retry",
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
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
    } as unknown as TelegramApiClient,
  });

  const controller = new AbortController();
  const watcher = await driver.startWatching({
    cursor: null,
    onMessage: async (update) => {
      deliveredUpdateIds.push(update.update_id);
      controller.abort();
    },
    signal: controller.signal,
  });

  try {
    await vi.advanceTimersByTimeAsync(1000);
    await watcher.done;

    assert.equal(attempts, 2);
    assert.deepEqual(deliveredUpdateIds, [88]);
  } finally {
    vi.useRealTimers();
  }
});

test("createTelegramApiPollDriver stops retrying fatal 4xx polling failures", async () => {
  let attempts = 0;
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
        attempts += 1;
        throw new Error("400 Bad Request: offset must be non-negative");
      },
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
    } as unknown as TelegramApiClient,
  });

  const watcher = await driver.startWatching({
    cursor: null,
    onMessage: async () => {
      throw new Error("onMessage should not be called in this test");
    },
    signal: new AbortController().signal,
  });

  await assert.rejects(
    watcher.done,
    /400 Bad Request: offset must be non-negative/u,
  );
  assert.equal(attempts, 1);
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
          return {
            messages: [
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
            ],
          };
        }

        if (updateId === 2) {
          return {
            messages: [
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
            ],
          };
        }

        return {
          messages: [],
        };
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

test("createTelegramPollConnector advances raw cursors even when a page emits no normalized messages", async () => {
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
          return {
            messages: [],
            nextCursor: { updateId: 5 },
          };
        }

        if (updateId === 5) {
          return {
            messages: [
              {
                update_id: 6,
                message: {
                  message_id: 6,
                  date: 1_773_397_103,
                  text: "after ignored page",
                  chat: { id: 10, type: "private", first_name: "Bob" },
                  from: { id: 111, first_name: "Bob" },
                },
              },
            ],
            nextCursor: { updateId: 6 },
          };
        }

        return {
          messages: [],
        };
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

  assert.deepEqual(seenCursors, [null, { updateId: 5 }, { updateId: 6 }]);
  assert.deepEqual(emitted, ["update:6"]);
  assert.deepEqual(cursor, { updateId: 6 });
});

test("createTelegramPollConnector surfaces async polling failures from the watcher", async () => {
  const connector = createTelegramPollConnector({
    driver: {
      async getMe() {
        return { id: 999, username: "healthybob_bot" };
      },
      async getMessages() {
        return {
          messages: [],
        };
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
