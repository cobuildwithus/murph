import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver,
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

function createAmbientFetchTelegramDriver(
  options: Parameters<typeof createHostedTelegramAttachmentDownloadDriver>[0] = {},
) {
  return createHostedTelegramAttachmentDownloadDriver({
    ...options,
    allowAmbientFetchForLocalRuntime: true,
  });
}

afterEach(() => {
  restoreFetch();
  restoreTelegramEnv();
});

describe("createHostedTelegramAttachmentDownloadDriver", () => {
  it("returns null when the token is missing or the configured base url is invalid", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(createAmbientFetchTelegramDriver(), null);

    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_API_BASE_URL = "not a url";
    assert.equal(createAmbientFetchTelegramDriver(), null);
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

    const driver = createAmbientFetchTelegramDriver();
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

    const driver = createAmbientFetchTelegramDriver();
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).rejects.toThrow(
      "file lookup denied",
    );
  });

  it("uses the provided fetch implementation for metadata and attachment downloads", async () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    setFetch(rawGlobalFetch as typeof globalThis.fetch);

    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/getFile?file_id=file_123")) {
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
      }

      if (url.endsWith("/photos/cat.jpg")) {
        return new Response(Uint8Array.from([7, 8, 9]), {
          status: 200,
        });
      }

      return new Response(null, {
        status: 500,
      });
    });

    const driver = createHostedTelegramAttachmentDownloadDriver({
      env: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      fetchImplementation: fetchImplementation as typeof fetch,
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).resolves.toEqual({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    });
    await expect(driver.downloadFile("/photos/cat.jpg", undefined)).resolves.toEqual(
      Uint8Array.from([7, 8, 9]),
    );

    expect(rawGlobalFetch).not.toHaveBeenCalled();
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.telegram.example/bottelegram-token/getFile?file_id=file_123",
      "https://files.telegram.example/bottelegram-token/photos/cat.jpg",
    ]);
  });

  it("fails closed when provider fetch is explicitly unavailable", () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    setFetch(rawGlobalFetch as typeof globalThis.fetch);

    assert.equal(createHostedTelegramAttachmentDownloadDriver({
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    }), null);
    expect(rawGlobalFetch).not.toHaveBeenCalled();
  });

  it("does not fall back to ambient fetch unless local ambient fetch is explicit", () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    setFetch(rawGlobalFetch as typeof globalThis.fetch);

    assert.equal(createHostedTelegramAttachmentDownloadDriver({
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    }), null);
    expect(rawGlobalFetch).not.toHaveBeenCalled();
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

    const driver = createAmbientFetchTelegramDriver();
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

describe("createHostedTelegramEffectsAttachmentDownloadDriver", () => {
  it("returns null until both Telegram file effects are available", () => {
    assert.equal(createHostedTelegramEffectsAttachmentDownloadDriver({
      effectsPort: null,
    }), null);
    assert.equal(createHostedTelegramEffectsAttachmentDownloadDriver({
      effectsPort: {
        async getTelegramFile() {
          return null;
        },
      },
    }), null);
  });

  it("adapts Telegram file effects to the inbox driver shape", async () => {
    const getTelegramFile = vi.fn(async () => ({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    }));
    const downloadTelegramFile = vi.fn(async () => ({
      bytesBase64: Buffer.from(Uint8Array.from([1, 2, 3])).toString("base64"),
      contentType: null,
      fileName: "cat.jpg",
      sha256: "sha256",
    }));

    const driver = createHostedTelegramEffectsAttachmentDownloadDriver({
      effectsPort: {
        downloadTelegramFile,
        getTelegramFile,
      },
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123")).resolves.toEqual({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    });
    await expect(driver.downloadFile("photos/cat.jpg")).resolves.toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    expect(getTelegramFile).toHaveBeenCalledWith({
      fileId: "file_123",
    });
    expect(downloadTelegramFile).toHaveBeenCalledWith({
      filePath: "photos/cat.jpg",
    });
  });
});
