import assert from "node:assert/strict";

import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHostedLinqConversationCapture } from "@murphai/inboxd/connectors/hosted-conversation";

import {
  createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  normalizeHostedLinqAttachmentUrl,
  withHostedLinqAttachmentDownloadRetry,
} from "../src/hosted-runtime/events/linq.ts";

const originalLinqApiBaseUrl = process.env.LINQ_API_BASE_URL;
const originalLinqApiToken = process.env.LINQ_API_TOKEN;
const originalLinqAttachmentCdnBaseUrl = process.env.LINQ_ATTACHMENT_CDN_BASE_URL;

function createLogPlatform(logRequests: HostedRuntimeLogRequest[]) {
  return {
    logPort: {
      async write(request: HostedRuntimeLogRequest) {
        logRequests.push(request);
        return { loggedCount: request.entries.length };
      },
    },
  };
}

function createInjectedFetchLinqDriver(
  fetchImplementation: typeof fetch,
  options: {
    env?: NonNullable<Parameters<typeof createHostedLinqAttachmentDownloadDriver>[0]["env"]>;
    platform?: NonNullable<Parameters<typeof createHostedLinqAttachmentDownloadDriver>[0]["platform"]>;
  } = {},
) {
  const platform = options.platform ?? {};
  return createHostedLinqAttachmentDownloadDriver({
    ...(options.env ? { env: options.env } : {}),
    platform: {
      ...platform,
      providerFetch: platform.providerFetch ?? fetchImplementation,
      publicInternetFetch: platform.publicInternetFetch ?? fetchImplementation,
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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

  if (originalLinqAttachmentCdnBaseUrl === undefined) {
    delete process.env.LINQ_ATTACHMENT_CDN_BASE_URL;
  } else {
    process.env.LINQ_ATTACHMENT_CDN_BASE_URL = originalLinqAttachmentCdnBaseUrl;
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

  it("accepts an explicit local CDN base override for hosted-local attachment proof", () => {
    process.env.LINQ_ATTACHMENT_CDN_BASE_URL = "http://127.0.0.1:4011/attachment-downloads";

    assert.equal(
      normalizeHostedLinqAttachmentUrl("http://127.0.0.1:4011/attachment-downloads/att_voice.wav"),
      "http://127.0.0.1:4011/attachment-downloads/att_voice.wav",
    );
    assert.equal(
      normalizeHostedLinqAttachmentUrl("http://127.0.0.1:4011/other/att_voice.wav"),
      null,
    );
    assert.equal(
      normalizeHostedLinqAttachmentUrl("https://cdn.linqapp.com/uploads/photo.jpg"),
      null,
    );
  });

  it("ignores non-local CDN override values and keeps the default hosted CDN gate", () => {
    process.env.LINQ_ATTACHMENT_CDN_BASE_URL = "https://example.com/attachment-downloads";

    assert.equal(
      normalizeHostedLinqAttachmentUrl("https://example.com/attachment-downloads/att_voice.wav"),
      null,
    );
    assert.equal(
      normalizeHostedLinqAttachmentUrl("https://cdn.linqapp.com/uploads/photo.jpg"),
      "https://cdn.linqapp.com/uploads/photo.jpg",
    );
  });
});

describe("withHostedLinqAttachmentDownloadRetry", () => {
  it("retries short-lived hosted Linq CDN misses", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("not ready", { status: 404 });
      }
      return new Response(Uint8Array.from([9, 8, 7]), { status: 200 });
    });
    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    const retrying = withHostedLinqAttachmentDownloadRetry(driver, {
      retryDelaysMs: [0],
    });

    assert.ok(retrying);
    await expect(
      retrying.downloadUrl("https://cdn.linqapp.com/files/voice.m4a"),
    ).resolves.toEqual(Uint8Array.from([9, 8, 7]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("createHostedLinqAttachmentDownloadDriver", () => {
  it("rejects declared oversized hosted Linq attachment parts before fetching bytes", async () => {
    const fetchMock = vi.fn();

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart({
      attachmentId: "att_large_pdf",
      mimeType: "application/pdf",
      size: HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES + 1,
      type: "media",
      url: "https://cdn.linqapp.com/files/large.pdf",
    })).rejects.toThrow(
      `Hosted Linq attachment download exceeds ${HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES} bytes.`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted Linq attachment downloads whose content-length exceeds the cap", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("too large", {
        status: 200,
        headers: {
          "content-length": String(HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES + 1),
        },
      }));

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);

    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/large.pdf"),
    ).rejects.toThrow(
      `Hosted Linq attachment download exceeds ${HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES} bytes.`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects streamed hosted Linq attachment downloads once the body exceeds the cap", async () => {
    const chunk = new Uint8Array(HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES + 1);
    const fetchMock = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          },
        }),
        { status: 200 },
      ));

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);

    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/large.pdf"),
    ).rejects.toThrow(
      `Hosted Linq attachment download exceeds ${HOSTED_LINQ_ATTACHMENT_MAX_DOWNLOAD_BYTES} bytes.`,
    );
  });
});

describe("createHostedLinqAttachmentDownloadDriver", () => {
  it("returns null when fetch is unavailable", () => {
    assert.equal(createHostedLinqAttachmentDownloadDriver({
      platform: null,
    }), null);
  });

  it("does not fall back to ambient fetch when hosted provider fetch is missing", () => {
    assert.equal(createHostedLinqAttachmentDownloadDriver({
      platform: createLogPlatform([]),
    }), null);
  });

  it("fails closed when public attachment fetch is missing", () => {
    const providerFetch = vi.fn<typeof fetch>();

    assert.equal(createHostedLinqAttachmentDownloadDriver({
      platform: {
        ...createLogPlatform([]),
        providerFetch,
      },
    }), null);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("uses provider fetch for metadata and public fetch for downloaded bytes", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const providerFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://api.linqapp.com/api/partner/v3/attachments/att_image_123") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "https://cdn.linqapp.com/files/fresh-image.png",
        }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      }

      throw new Error(`Unexpected provider fetch url: ${url}`);
    });
    const publicInternetFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://cdn.linqapp.com/files/fresh-image.png") {
        const headers = new Headers(init?.headers);
        assert.equal(headers.has("x-hosted-runtime-attempt-id"), false);
        assert.equal(headers.has("x-hosted-runtime-lease-generation"), false);
        assert.equal(headers.has("x-hosted-runtime-workspace-version"), false);
        assert.equal(headers.has("x-hosted-runner-bound-user-id"), false);
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
      }

      throw new Error(`Unexpected public fetch url: ${url}`);
    });

    const driver = createHostedLinqAttachmentDownloadDriver({
      platform: {
        ...createLogPlatform([]),
        providerFetch,
        publicInternetFetch,
      },
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart({
      attachmentId: "att_image_123",
      mimeType: "image/png",
      type: "media",
    }, undefined)).resolves.toEqual(Uint8Array.from([1, 2, 3]));

    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(publicInternetFetch).toHaveBeenCalledTimes(1);
  });

  it("uses explicit hosted env for metadata lookup without ambient Linq env", async () => {
    delete process.env.LINQ_API_BASE_URL;
    delete process.env.LINQ_API_TOKEN;
    delete process.env.LINQ_ATTACHMENT_CDN_BASE_URL;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://host.docker.internal:4011/attachments/att_local_env") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer explicit-linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "http://host.docker.internal:4011/attachment-downloads/att_local_env.pdf",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "http://host.docker.internal:4011/attachment-downloads/att_local_env.pdf") {
        return new Response(Uint8Array.from([21, 22, 23]), { status: 200 });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch, {
      env: {
        LINQ_API_BASE_URL: "http://host.docker.internal:4011",
        LINQ_API_TOKEN: "explicit-linq-token",
      },
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart({
      attachmentId: "att_local_env",
      mimeType: "application/pdf",
      type: "media",
    }, undefined)).resolves.toEqual(Uint8Array.from([21, 22, 23]));
  });

  it("uses public fetch for direct attachment downloads when available", async () => {
    const providerFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("provider fetch should not be used for direct attachment bytes");
    });
    const publicInternetFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("x-hosted-runtime-attempt-id"), false);
      assert.equal(headers.has("x-hosted-runtime-lease-generation"), false);
      assert.equal(headers.has("x-hosted-runtime-workspace-version"), false);
      assert.equal(headers.has("x-hosted-runner-bound-user-id"), false);
      if (url === "https://cdn.linqapp.com/files/direct-url.png") {
        return new Response(Uint8Array.from([4, 5, 6]), { status: 200 });
      }

      if (url === "https://cdn.linqapp.com/files/direct-part.png") {
        return new Response(Uint8Array.from([7, 8, 9]), { status: 200 });
      }

      throw new Error(`Unexpected public fetch url: ${url}`);
    });

    const driver = createHostedLinqAttachmentDownloadDriver({
      platform: {
        ...createLogPlatform([]),
        providerFetch,
        publicInternetFetch,
      },
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/direct-url.png", undefined),
    ).resolves.toEqual(Uint8Array.from([4, 5, 6]));
    await expect(driver.downloadPart({
      attachmentId: "att_direct_image",
      mimeType: "image/png",
      type: "media",
      url: "https://cdn.linqapp.com/files/direct-part.png",
    }, undefined)).resolves.toEqual(Uint8Array.from([7, 8, 9]));

    expect(providerFetch).not.toHaveBeenCalled();
    expect(publicInternetFetch).toHaveBeenCalledTimes(2);
  });

  it("skips unsupported urls without hitting fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);

    await expect(driver.downloadUrl("https://example.com/not-linq", undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs direct hosted Linq attachment downloads without raw locators", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(Uint8Array.from([7, 8, 9]), { status: 200 }));

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch, {
      platform: createLogPlatform(logRequests),
    });
    assert.ok(driver);

    await expect(
      driver.downloadUrl("https://cdn.linqapp.com/files/ok.bin", undefined),
    ).resolves.toEqual(Uint8Array.from([7, 8, 9]));

    expect(logRequests).toHaveLength(1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    expect(entry.eventCode).toBe("mailbox.linq_attachment_download_finished");
    expect(entry.level).toBe("info");
    expect(entry.redactedJson).toMatchObject({
      byteCountBucket: "1-99k",
      cdnBaseKind: "default",
      directFetchAttempted: true,
      directFetchSucceeded: true,
      directLocatorAllowed: true,
      directLocatorPresent: true,
      operation: "downloadUrl",
      result: "succeeded",
    });
    const serializedLog = JSON.stringify(entry.redactedJson);
    expect(serializedLog).not.toContain("cdn.linqapp.com");
    expect(serializedLog).not.toContain("ok.bin");
  });

  it("logs local override metadata failures without raw attachment identifiers", async () => {
    process.env.LINQ_API_BASE_URL = "http://127.0.0.1:4011";
    process.env.LINQ_API_TOKEN = "linq-token";
    process.env.LINQ_ATTACHMENT_CDN_BASE_URL = "http://127.0.0.1:4011/attachment-downloads";

    const logRequests: HostedRuntimeLogRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "http://127.0.0.1:4011/attachments/att_voice_private");
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.authorization,
        "Bearer linq-token",
      );
      throw new TypeError("fetch failed");
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch, {
      platform: createLogPlatform(logRequests),
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart({
      attachmentId: "att_voice_private",
      mimeType: "audio/mp4",
      size: 38_000,
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/voice.m4a",
    }, undefined)).rejects.toThrow("Hosted Linq attachment metadata lookup failed.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logRequests).toHaveLength(1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    expect(entry.eventCode).toBe("mailbox.linq_attachment_download_finished");
    expect(entry.errorCode).toBe("metadata_fetch_failed");
    expect(entry.level).toBe("info");
    expect(entry.redactedJson).toMatchObject({
      apiBaseKind: "local",
      apiConfigured: true,
      attachmentKeyPresent: true,
      cdnBaseKind: "local_override",
      declaredSizeBucket: "1-99k",
      directFetchAttempted: false,
      directFetchSucceeded: false,
      directLocatorAllowed: false,
      directLocatorPresent: true,
      failureCode: "metadata_fetch_failed",
      errorCause: "fetch failed",
      errorDetailPresent: true,
      errorRetryable: true,
      metadataLocatorAllowed: false,
      metadataLocatorPresent: false,
      metadataLookupAttempted: true,
      metadataStatus: null,
      mimeCategory: "audio/mp4",
      operation: "downloadPart",
      partKind: "voice_memo",
      result: "failed",
    });
    const serializedLog = JSON.stringify(entry.redactedJson);
    expect(serializedLog).not.toContain("att_voice_private");
    expect(serializedLog).not.toContain("cdn.linqapp.com");
    expect(serializedLog).not.toContain("4011");
    expect(serializedLog).not.toContain("voice.m4a");
    expect(serializedLog).not.toContain("linq-token");
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

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
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

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_voice_123",
      mimeType: "audio/m4a",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/stale-voice.m4a",
    }, undefined)).resolves.toEqual(Uint8Array.from([4, 5, 6]));
  });

  it("refreshes hosted attachment downloads when the direct URL stalls", async () => {
    vi.useFakeTimers();
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const providerFetch = vi.fn<typeof fetch>(async (input, init) => {
      assert.equal(
        String(input),
        "https://api.linqapp.com/api/partner/v3/attachments/att_voice_stalled_direct",
      );
      expect(init?.signal?.aborted).toBe(false);
      return new Response(JSON.stringify({
        download_url: "https://cdn.linqapp.com/files/fresh-stalled-voice.m4a",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const publicInternetFetch = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url === "https://cdn.linqapp.com/files/stalled-voice.m4a") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }

      assert.equal(url, "https://cdn.linqapp.com/files/fresh-stalled-voice.m4a");
      expect(init?.signal?.aborted).toBe(false);
      return Promise.resolve(new Response(Uint8Array.from([6, 5, 4]), { status: 200 }));
    });

    const driver = createHostedLinqAttachmentDownloadDriver({
      platform: {
        providerFetch,
        publicInternetFetch,
      },
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    const downloadPromise = driver.downloadPart({
      attachmentId: "att_voice_stalled_direct",
      mimeType: "audio/m4a",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/stalled-voice.m4a",
    }, undefined);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(downloadPromise).resolves.toEqual(Uint8Array.from([6, 5, 4]));
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(publicInternetFetch).toHaveBeenCalledTimes(2);
  });

  it("downloads hosted voice memos from an explicit local CDN override after metadata lookup", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";
    process.env.LINQ_ATTACHMENT_CDN_BASE_URL = "http://127.0.0.1:4011/attachment-downloads";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://api.linqapp.com/api/partner/v3/attachments/att_voice_local") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "http://127.0.0.1:4011/attachment-downloads/att_voice_local.wav",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "http://127.0.0.1:4011/attachment-downloads/att_voice_local.wav") {
        return new Response(Uint8Array.from([10, 11, 12]), { status: 200 });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_voice_local",
      mimeType: "audio/wav",
      type: "voice_memo",
    }, undefined)).resolves.toEqual(Uint8Array.from([10, 11, 12]));
  });

  it("accepts trusted local metadata download urls that share the Linq API origin", async () => {
    process.env.LINQ_API_BASE_URL = "http://host.docker.internal:4011";
    process.env.LINQ_API_TOKEN = "linq-token";
    delete process.env.LINQ_ATTACHMENT_CDN_BASE_URL;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://host.docker.internal:4011/attachments/att_voice_local_origin") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url:
            "http://host.docker.internal:4011/attachment-downloads/att_voice_local_origin.wav",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (url === "http://host.docker.internal:4011/attachment-downloads/att_voice_local_origin.wav") {
        return new Response(Uint8Array.from([13, 14, 15]), { status: 200 });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_voice_local_origin",
      mimeType: "audio/wav",
      type: "voice_memo",
    }, undefined)).resolves.toEqual(Uint8Array.from([13, 14, 15]));
  });

  it("falls back to the original direct-download error when metadata returns an untrusted local url", async () => {
    process.env.LINQ_API_BASE_URL = "http://host.docker.internal:4011";
    process.env.LINQ_API_TOKEN = "linq-token";
    const logRequests: HostedRuntimeLogRequest[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://cdn.linqapp.com/files/stale-invalid-origin.m4a") {
        return new Response("forbidden", {
          status: 403,
          statusText: "Forbidden",
        });
      }

      if (url === "http://host.docker.internal:4011/attachments/att_invalid_origin") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "http://example.com/attachment-downloads/att_invalid_origin.wav",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch, {
      platform: createLogPlatform(logRequests),
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_invalid_origin",
      mimeType: "audio/wav",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/stale-invalid-origin.m4a",
    }, undefined)).rejects.toThrow(
      "Hosted Linq attachment download failed with 403 Forbidden.",
    );
    expect(logRequests).toHaveLength(1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    expect(entry.eventCode).toBe("mailbox.linq_attachment_download_finished");
    expect(entry.errorCode).toBe("download_http_status");
    expect(entry.redactedJson).toMatchObject({
      directFetchAttempted: true,
      directFetchSucceeded: false,
      downloadStatus: 403,
      errorDetailPresent: true,
      errorMessage: "Hosted execution authorization failed.",
      errorRetryable: true,
      failureCode: "download_http_status",
      metadataLocatorAllowed: false,
      metadataLocatorPresent: true,
      metadataLookupAttempted: true,
      metadataStatus: 200,
      result: "failed",
    });
  });

  it("logs redacted direct-download diagnostics when attachment id is missing", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      assert.equal(String(input), "https://cdn.linqapp.com/files/missing-key.m4a");
      return new Response("not found", {
        status: 404,
        statusText: "Not Found",
      });
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch, {
      platform: createLogPlatform(logRequests),
    });
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      mimeType: "audio/m4a",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/missing-key.m4a",
    }, undefined)).rejects.toThrow(
      "Hosted Linq attachment download failed with 404 Not Found.",
    );

    expect(logRequests).toHaveLength(1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    expect(entry.eventCode).toBe("mailbox.linq_attachment_download_finished");
    expect(entry.errorCode).toBe("download_http_status");
    expect(entry.redactedJson).toMatchObject({
      directFetchAttempted: true,
      directFetchSucceeded: false,
      downloadStatus: 404,
      errorDetailPresent: true,
      errorMessage: "Hosted execution rejected an invalid request.",
      errorRetryable: true,
      failureCode: "download_http_status",
      metadataLookupAttempted: false,
      result: "failed",
    });
    const serializedLog = JSON.stringify(entry.redactedJson);
    expect(serializedLog).not.toContain("missing-key.m4a");
    expect(serializedLog).not.toContain("cdn.linqapp.com");
  });

  it("falls back to the original direct-download error when metadata returns a local url outside the attachment path", async () => {
    process.env.LINQ_API_BASE_URL = "http://host.docker.internal:4011";
    process.env.LINQ_API_TOKEN = "linq-token";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://cdn.linqapp.com/files/stale-invalid-path.m4a") {
        return new Response("forbidden", {
          status: 403,
          statusText: "Forbidden",
        });
      }

      if (url === "http://host.docker.internal:4011/attachments/att_invalid_path") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "http://host.docker.internal:4011/other/att_invalid_path.wav",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_invalid_path",
      mimeType: "audio/wav",
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/stale-invalid-path.m4a",
    }, undefined)).rejects.toThrow(
      "Hosted Linq attachment download failed with 403 Forbidden.",
    );
  });

  it("returns null when metadata download lookup receives an invalid url string", async () => {
    process.env.LINQ_API_BASE_URL = "http://host.docker.internal:4011";
    process.env.LINQ_API_TOKEN = "linq-token";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://host.docker.internal:4011/attachments/att_invalid_url") {
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.authorization,
          "Bearer linq-token",
        );
        return new Response(JSON.stringify({
          download_url: "::not-a-url::",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    await expect(driver.downloadPart?.({
      attachmentId: "att_invalid_url",
      mimeType: "audio/wav",
      type: "voice_memo",
    }, undefined)).resolves.toBeNull();
  });

  it("relays aborts from the caller signal into metadata lookup downloads", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error(String(init.signal?.reason ?? "aborted"))),
          { once: true },
        );
      }));

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    const controller = new AbortController();
    const downloadPromise = driver.downloadPart?.({
      attachmentId: "att_abort_relay",
      mimeType: "audio/wav",
      type: "voice_memo",
    }, controller.signal);

    controller.abort("caller aborted");

    await expect(downloadPromise).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("returns null immediately when metadata lookup starts with an already-aborted signal", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error("already aborted");
    });

    const driver = createInjectedFetchLinqDriver(fetchMock as typeof fetch);
    assert.ok(driver);
    assert.ok(driver.downloadPart);

    const controller = new AbortController();
    controller.abort("already aborted");

    await expect(driver.downloadPart?.({
      attachmentId: "att_already_aborted",
      mimeType: "audio/wav",
      type: "voice_memo",
    }, controller.signal)).resolves.toBeNull();
  });

  it("retries hosted voice memo metadata lag before degrading to descriptor-only capture", async () => {
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const providerFetch = vi.fn<typeof fetch>(async (input) => {
      assert.equal(
        String(input),
        "https://api.linqapp.com/api/partner/v3/attachments/att_voice_lag",
      );
      if (providerFetch.mock.calls.length === 1) {
        return new Response("not ready", { status: 404 });
      }

      return new Response(JSON.stringify({
        download_url: "https://cdn.linqapp.com/files/voice-lag.m4a",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    });
    const publicInternetFetch = vi.fn<typeof fetch>(async (input) => {
      assert.equal(String(input), "https://cdn.linqapp.com/files/voice-lag.m4a");
      return new Response(Uint8Array.from([9, 8, 7]), { status: 200 });
    });
    const driver = createHostedLinqAttachmentDownloadDriver({
      platform: {
        providerFetch,
        publicInternetFetch,
      },
    });
    const retrying = withHostedLinqAttachmentDownloadRetry(driver, {
      retryDelaysMs: [0],
    });

    const capture = await normalizeHostedLinqConversationCapture({
      accountId: "hbidx:phone:v1:test",
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: retrying,
      linqMessage: {
        chatId: "chat_voice",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_voice_metadata_lag",
        parts: [
          {
            attachmentId: "att_voice_lag",
            mimeType: "audio/m4a",
            type: "voice_memo",
          },
        ],
      },
      occurredAt: "2026-04-23T06:17:45.000Z",
    });

    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(publicInternetFetch).toHaveBeenCalledTimes(1);
    expect(capture.attachments).toHaveLength(1);
    expect(capture.attachments[0]?.data).toEqual(Uint8Array.from([9, 8, 7]));
    expect(capture.attachments[0]?.kind).toBe("audio");
  });

  it("retries hosted voice memo metadata timeout before degrading to descriptor-only capture", async () => {
    vi.useFakeTimers();
    process.env.LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
    process.env.LINQ_API_TOKEN = "linq-token";

    const providerFetch = vi.fn<typeof fetch>((input, init) => {
      assert.equal(
        String(input),
        "https://api.linqapp.com/api/partner/v3/attachments/att_voice_timeout",
      );
      if (providerFetch.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }

      return Promise.resolve(new Response(JSON.stringify({
        download_url: "https://cdn.linqapp.com/files/voice-timeout.m4a",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }));
    });
    const publicInternetFetch = vi.fn<typeof fetch>(async (input) => {
      assert.equal(String(input), "https://cdn.linqapp.com/files/voice-timeout.m4a");
      return new Response(Uint8Array.from([7, 8, 9]), { status: 200 });
    });
    const driver = createHostedLinqAttachmentDownloadDriver({
      platform: {
        providerFetch,
        publicInternetFetch,
      },
    });
    const retrying = withHostedLinqAttachmentDownloadRetry(driver, {
      retryDelaysMs: [0],
    });

    const capturePromise = normalizeHostedLinqConversationCapture({
      accountId: "hbidx:phone:v1:test",
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: retrying,
      linqMessage: {
        chatId: "chat_voice",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_voice_metadata_timeout",
        parts: [
          {
            attachmentId: "att_voice_timeout",
            mimeType: "audio/m4a",
            type: "voice_memo",
          },
        ],
      },
      occurredAt: "2026-04-23T06:17:45.000Z",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    const capture = await capturePromise;

    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(publicInternetFetch).toHaveBeenCalledTimes(1);
    expect(capture.attachments).toHaveLength(1);
    expect(capture.attachments[0]?.data).toEqual(Uint8Array.from([7, 8, 9]));
    expect(capture.attachments[0]?.kind).toBe("audio");
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
