import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeLogEntry,
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";

import {
  normalizeHostedTelegramConversationCapture,
} from "@murphai/inboxd/connectors/hosted-conversation";

import {
  createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver,
  logHostedTelegramAttachmentDownloadUnavailable,
  withHostedTelegramAttachmentDownloadLogging,
  withHostedTelegramAttachmentDownloadRetry,
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
      error_code: 400,
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

    await expect(driver.getFile("file_123", undefined)).rejects.toMatchObject({
      message: "file lookup denied",
      status: 400,
      statusCode: 400,
    });
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
    await expect(driver.downloadFile("/photos/fail.jpg", undefined)).rejects.toMatchObject({
      message: "Hosted Telegram attachment download failed with 502 Bad Gateway.",
      status: 502,
      statusCode: 502,
    });
    assert.equal(String(fetchMock.mock.calls[0]?.[0]), "https://files.telegram.example/bottelegram-token/photos/cat.jpg");
  });

  it("rejects Telegram attachment downloads that exceed the byte limit while streaming", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_FILE_BASE_URL = "https://files.telegram.example/";

    const fetchMock = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
    }));
    const driver = createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation: fetchMock as typeof fetch,
      maxDownloadBytes: 2,
    });
    assert.ok(driver);

    await expect(driver.downloadFile("/documents/large.pdf", undefined)).rejects.toMatchObject({
      context: {
        failureStage: "download_limit",
        retryable: false,
        status: 413,
      },
      status: 413,
      statusCode: 413,
    });
  });

  it("preserves HTTP status on Telegram API response failures", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";

    const fetchMock = vi.fn(async () => new Response("unavailable", {
      status: 503,
      statusText: "Service Unavailable",
    }));
    const driver = createHostedTelegramAttachmentDownloadDriver({
      fetchImplementation: fetchMock as typeof fetch,
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123", undefined)).rejects.toMatchObject({
      message: "Hosted Telegram API request failed with 503 Service Unavailable.",
      status: 503,
      statusCode: 503,
    });
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
    const controller = new AbortController();
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

    await expect(driver.getFile("file_123", controller.signal)).resolves.toEqual({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    });
    await expect(driver.downloadFile("photos/cat.jpg", controller.signal)).resolves.toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    expect(getTelegramFile).toHaveBeenCalledWith(
      { fileId: "file_123" },
      { signal: controller.signal },
    );
    expect(downloadTelegramFile).toHaveBeenCalledWith(
      { filePath: "photos/cat.jpg" },
      { signal: controller.signal },
    );
  });
});

describe("withHostedTelegramAttachmentDownloadRetry", () => {
  it("retries transient Telegram getFile failures before returning metadata", async () => {
    const firstFailure = Object.assign(new Error("Bad Gateway"), {
      status: 502,
      statusCode: 502,
    });
    const getFile = vi.fn()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce({
        file_id: "file_123",
        file_path: "documents/lab.pdf",
      });
    const driver = withHostedTelegramAttachmentDownloadRetry({
      downloadFile: async () => Uint8Array.from([]),
      getFile,
    }, {
      retryDelaysMs: [0],
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123")).resolves.toEqual({
      file_id: "file_123",
      file_path: "documents/lab.pdf",
    });
    expect(getFile).toHaveBeenCalledTimes(2);
  });

  it("does not retry terminal Telegram API failures", async () => {
    const failure = Object.assign(new Error("Bad Request"), {
      status: 400,
      statusCode: 400,
    });
    const getFile = vi.fn(async () => {
      throw failure;
    });
    const driver = withHostedTelegramAttachmentDownloadRetry({
      downloadFile: async () => Uint8Array.from([]),
      getFile,
    }, {
      retryDelaysMs: [0, 0],
    });
    assert.ok(driver);

    await expect(driver.getFile("file_123")).rejects.toBe(failure);
    expect(getFile).toHaveBeenCalledTimes(1);
  });

  it("does not retry aborted attachment downloads", async () => {
    const failure = new DOMException("Aborted", "AbortError");
    const downloadFile = vi.fn(async () => {
      throw failure;
    });
    const driver = withHostedTelegramAttachmentDownloadRetry({
      downloadFile,
      getFile: async () => ({ file_id: "file_123" }),
    }, {
      retryDelaysMs: [0, 0],
    });
    assert.ok(driver);

    await expect(driver.downloadFile("documents/lab.pdf")).rejects.toBe(failure);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for the next retry when the caller aborts", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const failure = new TypeError("fetch failed");
      const getFile = vi.fn(async () => {
        throw failure;
      });
      const driver = withHostedTelegramAttachmentDownloadRetry({
        downloadFile: async () => Uint8Array.from([]),
        getFile,
      }, {
        retryDelaysMs: [10_000],
      });
      assert.ok(driver);

      const promise = driver.getFile("file_123", controller.signal);
      await Promise.resolve();

      expect(getFile).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      controller.abort();

      await expect(promise).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(getFile).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Telegram PDF attachments metadata-only after retry exhaustion", async () => {
    const failure = Object.assign(new Error("Bad Gateway"), {
      status: 502,
      statusCode: 502,
    });
    const getFile = vi.fn(async () => {
      throw failure;
    });
    const downloadFile = vi.fn(async () => Uint8Array.from([1, 2, 3]));
    const driver = withHostedTelegramAttachmentDownloadRetry({
      downloadFile,
      getFile,
    }, {
      retryDelaysMs: [0, 0],
    });

    const capture = await normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver: driver,
      externalId: "evt_pdf",
      message: {
        attachments: [
          {
            fileId: "file_pdf",
            fileName: "lab-results.pdf",
            fileSize: 123_456,
            fileUniqueId: "file_pdf_unique",
            kind: "document",
            mimeType: "application/pdf",
          },
        ],
        messageId: "123",
        text: null,
        threadId: "chat_123",
      },
      occurredAt: "2026-06-15T22:41:25.000Z",
      receivedAt: "2026-06-15T22:41:25.000Z",
    });

    expect(getFile).toHaveBeenCalledTimes(3);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(capture.attachments).toHaveLength(1);
    expect(capture.attachments[0]).toMatchObject({
      byteSize: 123_456,
      externalId: "file_pdf_unique",
      fileName: "lab-results.pdf",
      kind: "document",
      mime: "application/pdf",
    });
    expect(capture.attachments[0]?.data).toBeUndefined();
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

  it("does not log as a wrapper-construction side effect when no driver is available", async () => {
    const logPort = createLogPort();

    expect(withHostedTelegramAttachmentDownloadLogging(null, logPort.platform)).toBeNull();
    expect(logPort.entries()).toEqual([]);
  });

  it("logs a durable warn when an attachment needs a missing driver", async () => {
    const logPort = createLogPort();

    await logHostedTelegramAttachmentDownloadUnavailable(logPort.platform);

    expect(logPort.entries()).toHaveLength(1);
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

  it("prefers provider-effect upstream status over wrapper transport status", async () => {
    const logPort = createLogPort();
    const failure = Object.assign(
      new Error("Hosted provider effect request failed with 502."),
      {
        context: { status: 400 },
        status: 502,
        statusCode: 502,
      },
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

  it("classifies DOMException aborts as download_aborted", async () => {
    const logPort = createLogPort();
    const failure = new DOMException("Aborted", "AbortError");
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
        errorCode: "download_aborted",
        level: "warn",
        redactedJson: {
          failureCode: "download_aborted",
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
