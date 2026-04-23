import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHostedLinqConversationCapture } from "@murphai/inboxd/connectors/hosted-conversation";

import {
  createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  normalizeHostedLinqAttachmentUrl,
} from "../src/hosted-runtime/events/linq.ts";

const originalFetch = globalThis.fetch;
const originalLinqApiBaseUrl = process.env.LINQ_API_BASE_URL;
const originalLinqApiToken = process.env.LINQ_API_TOKEN;

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

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  restoreFetch();
  if (originalLinqApiBaseUrl === undefined) {
    delete process.env.LINQ_API_BASE_URL;
  } else {
    process.env.LINQ_API_BASE_URL = originalLinqApiBaseUrl;
  }

  if (originalLinqApiToken === undefined) {
    delete process.env.LINQ_API_TOKEN;
  } else {
    process.env.LINQ_API_TOKEN = originalLinqApiToken;
  }
});

describe("normalizeHostedLinqAttachmentUrl", () => {
  it("accepts only non-empty https urls on the Linq CDN host", () => {
    assert.equal(
      normalizeHostedLinqAttachmentUrl(" https://cdn.linqapp.com/uploads/photo.jpg "),
      "https://cdn.linqapp.com/uploads/photo.jpg",
    );
    assert.equal(normalizeHostedLinqAttachmentUrl(""), null);
    assert.equal(normalizeHostedLinqAttachmentUrl("http://cdn.linqapp.com/file"), null);
    assert.equal(normalizeHostedLinqAttachmentUrl("https://example.com/file"), null);
    assert.equal(normalizeHostedLinqAttachmentUrl(null), null);
  });
});

describe("createHostedLinqAttachmentDownloadDriver", () => {
  it("returns null when fetch is unavailable", () => {
    setFetch(undefined);
    assert.equal(createHostedLinqAttachmentDownloadDriver(), null);
  });

  it("skips unsupported urls without hitting fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedLinqAttachmentDownloadDriver();
    assert.ok(driver);

    await expect(driver.downloadUrl("https://example.com/not-linq", undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads bytes from the Linq CDN and surfaces fetch failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/ok.bin")) {
        return new Response(Uint8Array.from([7, 8, 9]), { status: 200 });
      }

      return new Response("bad gateway", {
        status: 502,
        statusText: "Bad Gateway",
      });
    });
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedLinqAttachmentDownloadDriver();
    assert.ok(driver);

    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/ok.bin", undefined),
    ).resolves.toEqual(Uint8Array.from([7, 8, 9]));
    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/fail.bin", undefined),
    ).rejects.toThrow(
      "Hosted Linq attachment download failed with 502 Bad Gateway.",
    );
  });

  it("refreshes hosted attachment downloads through the Linq API when the direct URL fails", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://cdn.linqapp.com/files/stale-voice.m4a") {
        return new Response("forbidden", {
          status: 403,
          statusText: "Forbidden",
        });
      }

      if (url === "https://api.linqapp.com/api/partner/v3/attachments/att_voice_123") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "https://cdn.linqapp.com/files/fresh-voice.m4a",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "https://cdn.linqapp.com/files/fresh-voice.m4a") {
        return new Response(Uint8Array.from([4, 5, 6]), { status: 200 });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
    setFetch(fetchMock as typeof globalThis.fetch);

    const driver = createHostedLinqAttachmentDownloadDriver();
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_voice_123",
      mimeType: "audio/m4a",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/stale-voice.m4a",
    }, undefined)).resolves.toEqual(Uint8Array.from([4, 5, 6]));
  });

  it("gives hosted voice memo downloads enough time to finish", async () => {
    vi.useFakeTimers();

    const capturePromise = normalizeHostedLinqConversationCapture({
      accountId: "hbidx:phone:v1:test",
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: {
        async downloadUrl(_url, signal) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 6_000);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });

          return Uint8Array.from([9, 8, 7]);
        },
      },
      linqMessage: {
        chatId: "chat_voice",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_voice",
        parts: [
          {
            attachmentId: "att_voice_456",
            mimeType: "audio/m4a",
            type: "voice_memo",
            url: "https://cdn.linqapp.com/files/voice.m4a",
          },
        ],
      },
      occurredAt: "2026-04-23T06:17:45.000Z",
    });

    await vi.advanceTimersByTimeAsync(6_000);
    const capture = await capturePromise;

    expect(capture.attachments).toHaveLength(1);
    expect(capture.attachments[0]?.data).toEqual(Uint8Array.from([9, 8, 7]));
    expect(capture.attachments[0]?.kind).toBe("audio");
  });
});
