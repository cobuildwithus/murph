import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqAttachmentDownloadDriver,
  normalizeHostedLinqAttachmentUrl,
} from "../src/hosted-runtime/events/linq.ts";

const originalFetch = globalThis.fetch;

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
  restoreFetch();
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
});
