import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  normalizeLinqWebhookEvent: vi.fn(),
  parseLinqWebhookEvent: vi.fn(),
}));

vi.mock("@murphai/inboxd/connectors/linq/normalize", () => ({
  normalizeLinqWebhookEvent: mocks.normalizeLinqWebhookEvent,
}));

vi.mock("@murphai/messaging-ingress/linq-webhook", () => ({
  parseLinqWebhookEvent: mocks.parseLinqWebhookEvent,
}));

import {
  buildHostedLinqCapture,
  createHostedLinqAttachmentDownloadDriver,
  normalizeHostedLinqAttachmentUrl,
} from "../src/hosted-runtime/events/linq.ts";

type HostedLinqDispatch = HostedExecutionDispatchRequest & {
  event: Extract<HostedExecutionDispatchRequest["event"], { kind: "linq.message.received" }>;
}

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

describe("buildHostedLinqCapture", () => {
  it("normalizes the webhook event into a hosted capture", async () => {
    const dispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "evt_linq",
      linqEvent: {
        event_type: "message.received",
        id: "linq_123",
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    }) as HostedLinqDispatch;
    if (dispatch.event.kind !== "linq.message.received") {
      throw new Error("Expected Linq message dispatch.");
    }
    const parsedEvent = {
      parsed: true,
    };
    const capture = {
      accountId: "raw-recipient-phone",
      externalId: "linq:msg_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: "hello",
      thread: {
        id: "chat_123",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      attachments: [],
    };
    mocks.parseLinqWebhookEvent.mockReturnValue(parsedEvent);
    mocks.normalizeLinqWebhookEvent.mockResolvedValue(capture);

    await expect(buildHostedLinqCapture({
      ...dispatch,
      event: dispatch.event,
    })).resolves.toEqual({
      ...capture,
      accountId: "15551234567",
    });

    expect(mocks.parseLinqWebhookEvent).toHaveBeenCalledWith(JSON.stringify(dispatch.event.linqEvent));
    expect(mocks.normalizeLinqWebhookEvent).toHaveBeenCalledWith({
      attachmentDownloadTimeoutMs: 5_000,
      defaultAccountId: "15551234567",
      downloadDriver: expect.objectContaining({
        downloadUrl: expect.any(Function),
      }),
      event: parsedEvent,
    });
  });

  it("preserves the raw Linq message id for hosted reply threading", async () => {
    const dispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "evt_linq_raw_reply_id",
      linqEvent: {
        event_type: "message.received",
        message: {
          id: "hbid:linq.message:v1:opaque",
        },
      },
      linqMessageId: "msg_real_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    }) as HostedLinqDispatch;
    if (dispatch.event.kind !== "linq.message.received") {
      throw new Error("Expected Linq message dispatch.");
    }

    const capture = {
      accountId: "raw-recipient-phone",
      externalId: "linq:hbid:linq.message:v1:opaque",
      occurredAt: "2026-04-08T00:00:00.000Z",
      raw: {},
      source: "linq",
      text: "hello",
      thread: {
        id: "chat_123",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      attachments: [],
    };
    mocks.parseLinqWebhookEvent.mockReturnValue({ parsed: true });
    mocks.normalizeLinqWebhookEvent.mockResolvedValue(capture);

    await expect(buildHostedLinqCapture({
      ...dispatch,
      event: dispatch.event,
    })).resolves.toEqual({
      ...capture,
      accountId: "15551234567",
      externalId: "linq:msg_real_123",
    });
  });
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
