import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeLogEntry,
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver,
  withHostedTelegramAttachmentDownloadLogging,
} from "../src/hosted-runtime/events/telegram.ts";

const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const originalTelegramApiBaseUrl = process.env.TELEGRAM_API_BASE_URL;
const originalTelegramFileBaseUrl = process.env.TELEGRAM_FILE_BASE_URL;

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
  restoreTelegramEnv();
});

describe("createHostedTelegramAttachmentDownloadDriver", () => {
  it("returns null when the token is missing or the configured base url is invalid", () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation,
    }), null);

    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_API_BASE_URL = "not a url";
    assert.equal(createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation,
    }), null);
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
    const driver = createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation: fetchMock as typeof fetch,
    });
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
    const driver = createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation: fetchMock as typeof fetch,
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).rejects.toThrow(
      "file lookup denied",
    );
  });

  it("uses the provided fetch implementation for metadata and attachment downloads", async () => {
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

    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.telegram.example/bottelegram-token/getFile?file_id=file_123",
      "https://files.telegram.example/bottelegram-token/photos/cat.jpg",
    ]);
  });

  it("fails closed when provider fetch is explicitly unavailable", () => {
    assert.equal(createHostedTelegramAttachmentDownloadDriver({
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    }), null);
  });

  it("does not fall back to ambient fetch when provider fetch is omitted at runtime", () => {
    const originalFetch = globalThis.fetch;
    const rawGlobalFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("raw global fetch should not be used");
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: rawGlobalFetch,
      writable: true,
    });

    try {
      assert.equal(Reflect.apply(createHostedTelegramAttachmentDownloadDriver, undefined, [{
        env: {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
      }]), null);
      expect(rawGlobalFetch).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
        writable: true,
      });
    }
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
    const driver = createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation: fetchMock as typeof fetch,
    });
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

describe("withHostedTelegramAttachmentDownloadLogging", () => {
  function createLogPort() {
    const logged: HostedRuntimeLogEntry[] = [];
    return {
      entries: () => logged,
      platform: {
        logPort: {
          write: async (request: HostedRuntimeLogRequest) => {
            logged.push(...request.entries);
            return { loggedCount: request.entries.length };
          },
        },
      },
    };
  }

  it("logs a durable warn when no download driver is available", async () => {
    const logPort = createLogPort();

    expect(withHostedTelegramAttachmentDownloadLogging(null, logPort.platform)).toBeNull();

    await vi.waitFor(() => {
      expect(logPort.entries()).toHaveLength(1);
    });
    expect(logPort.entries()[0]).toMatchObject({
      component: "mailbox",
      errorCode: "driver_unavailable",
      eventCode: "mailbox.telegram_attachment_download_finished",
      level: "warn",
      phase: "import",
      redactedJson: {
        failureCode: "driver_unavailable",
        result: "not_downloaded",
      },
    });
  });

  it("logs success per driver call and passes results through", async () => {
    const logPort = createLogPort();
    const driver = withHostedTelegramAttachmentDownloadLogging({
      downloadFile: async () => Uint8Array.from([1, 2, 3]),
      getFile: async () => ({ file_id: "file_123", file_path: "documents/file.pdf" }),
    }, logPort.platform);
    assert.ok(driver);

    await expect(driver.getFile("file_123")).resolves.toEqual({
      file_id: "file_123",
      file_path: "documents/file.pdf",
    });
    await expect(driver.downloadFile("documents/file.pdf")).resolves.toEqual(
      Uint8Array.from([1, 2, 3]),
    );

    expect(logPort.entries()).toEqual([
      expect.objectContaining({
        eventCode: "mailbox.telegram_attachment_download_finished",
        level: "info",
        redactedJson: { operation: "getFile", result: "succeeded" },
      }),
      expect.objectContaining({
        level: "info",
        redactedJson: { operation: "downloadFile", result: "succeeded" },
      }),
    ]);
  });

  it("logs the failure code and status before rethrowing driver errors", async () => {
    const logPort = createLogPort();
    const failure = Object.assign(
      new Error("Hosted Telegram file lookup failed with HTTP 400."),
      { status: 400 },
    );
    const driver = withHostedTelegramAttachmentDownloadLogging({
      downloadFile: async () => Uint8Array.from([]),
      getFile: async () => {
        throw failure;
      },
    }, logPort.platform);
    assert.ok(driver);

    await expect(driver.getFile("file_123")).rejects.toBe(failure);

    expect(logPort.entries()).toEqual([
      expect.objectContaining({
        errorCode: "download_fetch_failed",
        level: "warn",
        redactedJson: {
          failureCode: "download_fetch_failed",
          failureStatus: 400,
          operation: "getFile",
          result: "failed",
        },
      }),
    ]);
  });

  it("stays silent without a log port", async () => {
    const driver = withHostedTelegramAttachmentDownloadLogging({
      downloadFile: async () => Uint8Array.from([]),
      getFile: async () => ({ file_id: "file_123" }),
    }, null);
    assert.ok(driver);

    await expect(driver.getFile("file_123")).resolves.toEqual({ file_id: "file_123" });
  });
});
