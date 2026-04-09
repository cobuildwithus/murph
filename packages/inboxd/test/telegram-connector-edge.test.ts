import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  createTelegramApiPollDriver,
  createTelegramBotApiPollDriver,
  createTelegramPollConnector,
  readTelegramUpdateCheckpoint,
  type TelegramApiClient,
  type TelegramPollDriver,
} from "../src/index.ts";
import type { TelegramUpdateLike } from "@murphai/messaging-ingress/telegram-webhook";

function assertWatcherHandle(
  watcher: Awaited<ReturnType<TelegramPollDriver["startWatching"]>>,
): asserts watcher is { done: Promise<void>; close: () => Promise<void> | void } {
  if (!watcher || typeof watcher === "function") {
    throw new TypeError("Expected Telegram watcher handle object.");
  }
  assert.equal(typeof watcher.close, "function");
  assert.ok(watcher.done instanceof Promise);
}

function readMessages(
  page: Awaited<ReturnType<TelegramPollDriver["getMessages"]>>,
): TelegramUpdateLike[] {
  return Array.isArray(page) ? page : page.messages;
}

function readNextCursor(
  page: Awaited<ReturnType<TelegramPollDriver["getMessages"]>>,
) {
  return Array.isArray(page) ? undefined : page.nextCursor;
}

test("createTelegramApiPollDriver handles absent webhook helpers and missing download tokens", async () => {
  const driver = createTelegramApiPollDriver({
    api: {
      token: "",
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getUpdates() {
        return [];
      },
      async getFile(fileId: string) {
        assert.equal(fileId, "file-1");
        return {
          file_id: fileId,
          file_path: "docs/file.txt",
        };
      },
    } as unknown as TelegramApiClient,
  });

  await driver.deleteWebhook?.({ dropPendingUpdates: true });
  assert.equal(await driver.getWebhookInfo?.(), null);
  await assert.rejects(
    driver.downloadFile("docs/file.txt"),
    /require a bot token or a custom downloadFile implementation/u,
  );
});

test("createTelegramApiPollDriver rewrites webhook conflicts before failing the watch loop", async () => {
  let attempts = 0;
  const driver = createTelegramApiPollDriver({
    api: {
      token: "bot-token",
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getUpdates() {
        attempts += 1;
        throw new Error("409 Conflict: active webhook");
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
  assertWatcherHandle(watcher);

  await assert.rejects(
    watcher.done,
    /blocked by an active webhook/u,
  );
  assert.equal(attempts, 1);
});

test("createTelegramBotApiPollDriver creates a Bot API-backed driver with explicit roots", () => {
  const driver = createTelegramBotApiPollDriver({
    token: "bot-token",
    apiBaseUrl: "https://bot.example.test/api",
    fileBaseUrl: "https://files.example.test/file",
    batchSize: 25,
    timeoutSeconds: 15,
  });

  assert.equal(typeof driver.getMe, "function");
  assert.equal(typeof driver.getMessages, "function");
  assert.equal(typeof driver.startWatching, "function");
  assert.equal(typeof driver.downloadFile, "function");
});

test("createTelegramPollConnector normalizes blank account ids to the default connector id", () => {
  const connector = createTelegramPollConnector({
    source: "telegram-alt",
    accountId: "   ",
    downloadAttachments: false,
    driver: {
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getMessages() {
        return [];
      },
      async startWatching() {
        return undefined;
      },
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
      async downloadFile() {
        throw new Error("downloadFile should not be called in this test");
      },
    },
  });

  assert.equal(connector.id, "telegram-alt:default");
  assert.equal(connector.accountId, null);
});

test("createTelegramApiPollDriver sorts message updates, filters non-message updates, and clamps invalid cursors", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const driver = createTelegramApiPollDriver({
    api: {
      token: "bot-token",
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getUpdates(input: Record<string, unknown> | undefined) {
        requests.push(input as Record<string, unknown>);
        return [
          {
            update_id: 9,
            business_message: {
              message_id: 19,
              date: 1_773_400_050,
              text: "business",
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
          {
            update_id: 7,
            inline_query: {
              id: "inline-7",
              from: {
                id: 111,
                is_bot: false,
                first_name: "Alice",
              },
              query: "ignored",
              offset: "",
            },
          },
          {
            update_id: 8,
            message: {
              message_id: 18,
              date: 1_773_400_040,
              text: "message",
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
        ];
      },
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
    } as unknown as TelegramApiClient,
    batchSize: 0,
    allowedUpdates: null,
  });

  const messages = await driver.getMessages({
    cursor: { updateId: 7.5 },
    limit: 250,
  });

  assert.deepEqual(requests, [
    {
      offset: 0,
      limit: 100,
      timeout: 0,
      allowed_updates: undefined,
    },
  ]);
  assert.equal(readTelegramUpdateCheckpoint({ updateId: 9.5 }), null);
  assert.deepEqual(readMessages(messages).map((update) => update.update_id), [8, 9]);
  assert.deepEqual(readNextCursor(messages), { updateId: 9 });
});

test("createTelegramApiPollDriver closes retry backoff cleanly for non-Error polling failures", async () => {
  vi.useFakeTimers();

  let attempts = 0;
  const driver = createTelegramApiPollDriver({
    api: {
      token: "bot-token",
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getUpdates() {
        attempts += 1;
        throw "socket hangup";
      },
      async getFile() {
        throw new Error("getFile should not be called in this test");
      },
    } as unknown as TelegramApiClient,
  });

  try {
    const watcher = await driver.startWatching({
      cursor: null,
      onMessage: async () => {
        throw new Error("onMessage should not be called in this test");
      },
      signal: new AbortController().signal,
    });
    assertWatcherHandle(watcher);

    await Promise.resolve();
    await watcher.close();
    assert.equal(attempts, 1);
  } finally {
    vi.useRealTimers();
  }
});

test("createTelegramApiPollDriver falls back to the default retry delay when retry-after is missing or invalid", async () => {
  vi.useFakeTimers();

  const runScenario = async (error: Error) => {
    let attempts = 0;
    const controller = new AbortController();
    const driver = createTelegramApiPollDriver({
      api: {
        token: "bot-token",
        async getMe() {
          return {
            id: 999,
            username: "murph_bot",
          };
        },
        async getUpdates() {
          attempts += 1;
          if (attempts === 1) {
            throw error;
          }

          controller.abort();
          return [];
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
      signal: controller.signal,
    });
    assertWatcherHandle(watcher);

    await vi.advanceTimersByTimeAsync(1000);
    await watcher.done;
    assert.equal(attempts, 2);
  };

  try {
    await runScenario(new Error("500 Internal Server Error"));
    await runScenario(new Error("429 Too Many Requests: retry after 0"));
  } finally {
    vi.useRealTimers();
  }
});

test("createTelegramApiPollDriver downloads remote files and surfaces HTTP failures", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; signalAborted: boolean }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      signalAborted: init?.signal?.aborted ?? false,
    });

    if (url.includes("bad.txt")) {
      return new Response("bad gateway", {
        status: 502,
        statusText: "Bad Gateway",
      });
    }

    return new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
      },
    });
  }) as typeof fetch;

  try {
    const driver = createTelegramApiPollDriver({
      api: {
        token: "bot-token",
        async getMe() {
          return {
            id: 999,
            username: "murph_bot",
          };
        },
        async getUpdates() {
          return [];
        },
        async getFile(fileId: string) {
          return {
            file_id: fileId,
            file_path: fileId === "bad" ? "docs/bad.txt" : "docs/good.txt",
          };
        },
      } as unknown as TelegramApiClient,
      fileBaseUrl: "https://files.example.test/file/",
    });

    const goodFile = await driver.getFile("good");
    const data = await driver.downloadFile(goodFile.file_path!);
    assert.deepEqual(data, new Uint8Array([7, 8, 9]));

    const badFile = await driver.getFile("bad");
    await assert.rejects(
      driver.downloadFile(badFile.file_path!),
      /502 Bad Gateway/u,
    );

    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "https://files.example.test/file/botbot-token/docs/good.txt",
        "https://files.example.test/file/botbot-token/docs/bad.txt",
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createTelegramApiPollDriver treats invalid file base URLs as untrusted for local file paths", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called for rejected local file paths");
  }) as typeof fetch;

  try {
    const driver = createTelegramApiPollDriver({
      api: {
        token: "bot-token",
        async getMe() {
          return {
            id: 999,
            username: "murph_bot",
          };
        },
        async getUpdates() {
          return [];
        },
        async getFile(fileId: string) {
          assert.equal(fileId, "file-1");
          return {
            file_id: fileId,
            file_path: "/tmp/telegram/file.txt",
          };
        },
      } as unknown as TelegramApiClient,
      fileBaseUrl: "::not-a-valid-url::",
    });

    const file = await driver.getFile("file-1");
    await assert.rejects(
      driver.downloadFile(file.file_path!),
      /untrusted Bot API file base URL/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
