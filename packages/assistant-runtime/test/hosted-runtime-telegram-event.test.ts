import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHostedExecutionTelegramMessageReceivedDispatch } from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  normalizeHostedTelegramMessage: vi.fn(),
  withHostedInboxPipeline: vi.fn(),
}));

vi.mock("@murphai/inboxd/connectors/telegram/normalize", () => ({
  normalizeHostedTelegramMessage: mocks.normalizeHostedTelegramMessage,
}));

vi.mock("../src/hosted-runtime/events/inbox-pipeline.ts", () => ({
  withHostedInboxPipeline: mocks.withHostedInboxPipeline,
}));

import {
  createHostedTelegramAttachmentDownloadDriver,
  ingestHostedTelegramMessage,
} from "../src/hosted-runtime/events/telegram.ts";

const originalFetch = globalThis.fetch;
const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const originalTelegramApiBaseUrl = process.env.TELEGRAM_API_BASE_URL;
const originalTelegramFileBaseUrl = process.env.TELEGRAM_FILE_BASE_URL;

function restoreFetch() {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
}

function setFetch(value: typeof globalThis.fetch | undefined) {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value,
    writable: true,
  });
}

function restoreTelegramEnv() {
  if (originalTelegramBotToken === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  }

  if (originalTelegramApiBaseUrl === undefined) {
    delete process.env.TELEGRAM_API_BASE_URL;
  } else {
    process.env.TELEGRAM_API_BASE_URL = originalTelegramApiBaseUrl;
  }

  if (originalTelegramFileBaseUrl === undefined) {
    delete process.env.TELEGRAM_FILE_BASE_URL;
  } else {
    process.env.TELEGRAM_FILE_BASE_URL = originalTelegramFileBaseUrl;
  }
}

afterEach(() => {
  vi.clearAllMocks();
  restoreFetch();
  restoreTelegramEnv();
});

describe("ingestHostedTelegramMessage", () => {
  it("normalizes the hosted message payload and persists it through the inbox pipeline", async () => {
    const dispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:00:00.000Z",
      telegramMessage: {
        attachments: [
          {
            fileId: "file_123",
            kind: "photo",
          },
        ],
        messageId: "tg_message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    const capture = {
      source: "telegram",
    };
    const processCapture = vi.fn(async () => {});

    mocks.normalizeHostedTelegramMessage.mockResolvedValue(capture);
    mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
      processCapture,
    }));

    await ingestHostedTelegramMessage("/tmp/assistant-runtime-telegram", dispatch);

    expect(mocks.normalizeHostedTelegramMessage).toHaveBeenCalledWith({
      accountId: "bot",
      downloadDriver: null,
      externalId: "evt_telegram",
      message: dispatch.event.telegramMessage,
      occurredAt: "2026-04-08T00:00:00.000Z",
      receivedAt: "2026-04-08T00:00:00.000Z",
    });
    expect(processCapture).toHaveBeenCalledWith(capture);
  });
});

describe("createHostedTelegramAttachmentDownloadDriver", () => {
  it("returns null when the token is missing or the configured base url is invalid", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(createHostedTelegramAttachmentDownloadDriver(), null);

    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_API_BASE_URL = "not a url";
    assert.equal(createHostedTelegramAttachmentDownloadDriver(), null);
  });

  it("gets Telegram file metadata with normalized base urls and trimmed tokens", async () => {
    process.env.TELEGRAM_BOT_TOKEN = " telegram-token ";
    process.env.TELEGRAM_API_BASE_URL = "https://api.telegram.example/";
    process.env.TELEGRAM_FILE_BASE_URL = "https://files.telegram.example/";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      assert.equal(
        String(input),
        "https://api.telegram.example/bottelegram-token/getFile?file_id=file_123",
      );

      return new Response(JSON.stringify({
        ok: true,
        result: {
          file_id: "file_123",
          file_path: "photos/cat.jpg",
        },
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedTelegramAttachmentDownloadDriver();
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).resolves.toEqual({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    });
  });

  it("surfaces Telegram API errors from getFile responses", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      description: "file lookup denied",
      ok: false,
    }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    }));
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedTelegramAttachmentDownloadDriver();
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).rejects.toThrow(
      "file lookup denied",
    );
  });

  it("downloads attachment bytes, strips leading slashes, and fails closed on bad responses", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_FILE_BASE_URL = "https://files.telegram.example/";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/photos/cat.jpg")) {
        return new Response(Uint8Array.from([4, 5, 6]), {
          status: 200,
        });
      }

      return new Response("bad gateway", {
        status: 502,
        statusText: "Bad Gateway",
      });
    });
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedTelegramAttachmentDownloadDriver();
    assert.ok(driver);

    await expect(driver.downloadFile("/photos/cat.jpg", undefined)).resolves.toEqual(
      Uint8Array.from([4, 5, 6]),
    );
    await expect(driver.downloadFile("/photos/fail.jpg", undefined)).rejects.toThrow(
      "Hosted Telegram attachment download failed with 502 Bad Gateway.",
    );
    assert.equal(String(fetchMock.mock.calls[0]?.[0]), "https://files.telegram.example/bottelegram-token/photos/cat.jpg");
  });
});
