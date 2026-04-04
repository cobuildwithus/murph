import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test, vi } from "vitest";

import {
  createLinqWebhookConnector,
  normalizeLinqWebhookEvent,
  type InboundCapture,
  type PersistedCapture,
} from "../src/index.ts";

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

test("normalizeLinqWebhookEvent builds direct chat captures and hydrates downloadable attachments", async () => {
  const capture = await normalizeLinqWebhookEvent({
    event: buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T10:00:05.000Z",
      data: {
        parts: [
          {
            type: "text",
            value: "Photo attached",
          },
          {
            type: "media",
            url: "https://cdn.example.test/photo.jpg",
            attachment_id: "att_1",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size: 4,
          },
        ],
        sent_at: "2026-03-24T10:00:00.000Z",
      },
    }),
    downloadDriver: {
      async downloadUrl(url) {
        assert.equal(url, "https://cdn.example.test/photo.jpg");
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
  });

  assert.equal(capture.externalId, "linq:msg_123");
  assert.equal(capture.accountId, "+15557654321");
  assert.equal(capture.thread.id, "chat_123");
  assert.equal(capture.thread.title, "+15551234567 ↔ +15557654321 (SMS)");
  assert.equal(capture.thread.isDirect, true);
  assert.equal(capture.actor.id, "+15551234567");
  assert.equal(capture.actor.displayName, null);
  assert.equal(capture.actor.isSelf, false);
  assert.equal(capture.text, "Photo attached");
  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.externalId, "att_1");
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.equal(capture.attachments[0]?.fileName, "photo.jpg");
  assert.equal(capture.attachments[0]?.mime, "image/jpeg");
  assert.equal(capture.attachments[0]?.data?.byteLength, 4);
  assert.equal(capture.raw.event_type, "message.received");
});

test("normalizeLinqWebhookEvent falls back to created_at when received_at is missing", async () => {
  const capture = await normalizeLinqWebhookEvent({
    event: buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T10:00:05.000Z",
      data: {
        chat: {
          id: "chat_missing_received_at",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_missing_received_at",
            is_me: true,
            service: "SMS",
          },
        },
        id: "msg_missing_received_at",
        parts: [
          {
            type: "text",
            value: "Fallback timestamp",
          },
        ],
        sent_at: null,
      },
      eventId: "evt_missing_received_at",
    }),
  });

  assert.equal(capture.externalId, "linq:msg_missing_received_at");
  assert.equal(capture.occurredAt, "2026-03-24T10:00:05.000Z");
  assert.equal(capture.receivedAt, "2026-03-24T10:00:05.000Z");
});

test("normalizeLinqWebhookEvent treats multiple media parts and voice memos as attachments", async () => {
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    downloadDriver: {
      async downloadUrl(url) {
        return new TextEncoder().encode(`downloaded:${url}`);
      },
    },
    event: {
      ...buildV2026LinqWebhookEvent({
        createdAt: "2026-04-02T04:00:00.000Z",
        data: {
          chat: {
            id: "chat_attachments",
            owner_handle: {
              handle: "+15557654321",
              id: "handle_owner_attachments",
              is_me: true,
              service: "iMessage",
            },
          },
          id: "msg_attachments",
          parts: [
            {
              filename: "photo-1.heic",
              mime_type: "image/heic",
              size: 1024,
              type: "media",
              url: "https://cdn.linqapp.com/media/photo-1.heic",
            },
            {
              filename: "photo-2.jpg",
              mime_type: "image/jpeg",
              size: 2048,
              type: "media",
              url: "https://cdn.linqapp.com/media/photo-2.jpg",
            },
            {
              attachment_id: "att_voice_1",
              mime_type: "audio/m4a",
              size: 4096,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/media/voice-1.m4a",
            },
          ],
          sender_handle: {
            handle: "+15551234567",
            id: "handle_sender_attachments",
            service: "iMessage",
          },
          sent_at: "2026-04-02T04:00:01.000Z",
          service: "iMessage",
        },
        eventId: "evt_attachments",
        traceId: "trace_attachments",
      }),
    },
  });

  assert.equal(capture.attachments.length, 3);
  assert.deepEqual(
    capture.attachments.map((attachment) => attachment.kind),
    ["image", "image", "audio"],
  );
  assert.deepEqual(
    capture.attachments.map((attachment) => attachment.fileName),
    ["photo-1.heic", "photo-2.jpg", "voice-1.m4a"],
  );
  assert.deepEqual(
    capture.attachments.map((attachment) => attachment.byteSize),
    [1024, 2048, 4096],
  );
  assert.equal(
    capture.attachments.every((attachment) => attachment.data instanceof Uint8Array),
    true,
  );
});

test("normalizeLinqWebhookEvent keeps metadata-only voice memo attachments when downloads fail", async () => {
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    downloadDriver: {
      async downloadUrl() {
        throw new Error("download failed");
      },
    },
    event: {
      ...buildV2026LinqWebhookEvent({
        createdAt: "2026-04-02T04:00:00.000Z",
        data: {
          chat: {
            id: "chat_voice",
            owner_handle: {
              handle: "+15557654321",
              id: "handle_owner_voice",
              is_me: true,
              service: "SMS",
            },
          },
          id: "msg_voice",
          parts: [
            {
              mime_type: "audio/amr",
              size: 512,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/media/voice-2.amr",
            },
          ],
        },
        eventId: "evt_voice",
      }),
    },
  });

  assert.deepEqual(capture.attachments, [
    {
      byteSize: 512,
      data: null,
      externalId: "part:1",
      fileName: "voice-2.amr",
      kind: "audio",
      mime: "audio/amr",
    },
  ]);
});

test("createLinqWebhookConnector accepts signed webhook requests and emits captures", async () => {
  const port = await reservePort();
  const controller = new AbortController();
  const emitted: Array<{
    capture: InboundCapture;
    checkpoint: Record<string, unknown> | null | undefined;
  }> = [];
  const fetchImplementation = vi.fn(async (url) => {
    assert.equal(url, "https://cdn.example.test/att_2.pdf");
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => Uint8Array.from([9, 8, 7, 6]).buffer,
    } as Response;
  });

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
    fetchImplementation,
  });

  const watchPromise = connector.watch(
    null,
    async (capture, checkpoint) => {
      emitted.push({ capture, checkpoint });
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  try {
    const listenerUrl = `http://127.0.0.1:${port}/hooks/linq`;
    await waitForWebhookListener(listenerUrl);

    const payload = JSON.stringify(buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T11:00:05.000Z",
      data: {
        chat: {
          id: "chat_456",
          owner_handle: {
            handle: "+15559990000",
            id: "handle_owner_456",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_456",
        parts: [
          {
            type: "text",
            value: "Webhook payload",
          },
          {
            type: "media",
            url: "https://cdn.example.test/att_2.pdf",
            attachment_id: "att_2",
            filename: "summary.pdf",
            mime_type: "application/pdf",
          },
        ],
        sender_handle: {
          handle: "+15550001111",
          id: "handle_sender_456",
          service: "iMessage",
        },
        sent_at: "2026-03-24T11:00:00.000Z",
        service: "iMessage",
      },
      eventId: "evt_456",
    }));
    const timestamp = "1711278000";
    const response = await fetch(listenerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
        "x-webhook-timestamp": timestamp,
      },
      body: payload,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      accepted: true,
      externalId: "linq:msg_456",
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.capture.externalId, "linq:msg_456");
    assert.equal(emitted[0]?.capture.accountId, "+15559990000");
    assert.equal(emitted[0]?.capture.thread.id, "chat_456");
    assert.equal(emitted[0]?.capture.thread.isDirect, true);
    assert.equal(emitted[0]?.capture.text, "Webhook payload");
    assert.equal(emitted[0]?.capture.attachments[0]?.kind, "document");
    assert.deepEqual(Array.from(emitted[0]?.capture.attachments[0]?.data ?? []), [9, 8, 7, 6]);
    assert.equal(fetchImplementation.mock.calls.length, 1);
  } finally {
    controller.abort();
    await watchPromise;
    await connector.close?.();
  }
});

test("createLinqWebhookConnector fails closed before starting when the webhook secret is missing", () => {
  assert.throws(
    () =>
      createLinqWebhookConnector({
        accountId: "default",
        host: "127.0.0.1",
        path: "/hooks/linq",
        port: 9911,
        webhookSecret: null as unknown as string,
      }),
    /Linq webhook secret is required/u,
  );
});

test("createLinqWebhookConnector still accepts a webhook when attachment download fails", async () => {
  const port = await reservePort();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];
  const fetchImplementation = vi.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  }) as Response);

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
    fetchImplementation,
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  try {
    const listenerUrl = `http://127.0.0.1:${port}/hooks/linq`;
    await waitForWebhookListener(listenerUrl);

    const payload = JSON.stringify(buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T11:00:05.000Z",
      data: {
        chat: {
          id: "chat_456",
          owner_handle: {
            handle: "+15559990000",
            id: "handle_owner_456",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_456",
        parts: [
          {
            type: "media",
            url: "https://cdn.example.test/att_2.pdf",
            attachment_id: "att_2",
            filename: "summary.pdf",
            mime_type: "application/pdf",
          },
        ],
        sender_handle: {
          handle: "+15550001111",
          id: "handle_sender_456",
          service: "iMessage",
        },
        sent_at: "2026-03-24T11:00:00.000Z",
        service: "iMessage",
      },
      eventId: "evt_download_failure",
    }));
    const timestamp = "1711278000";
    const response = await fetch(listenerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
        "x-webhook-timestamp": timestamp,
      },
      body: payload,
    });

    assert.equal(response.status, 202);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.externalId, "linq:msg_456");
    assert.equal(emitted[0]?.attachments[0]?.externalId, "att_2");
    assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);
    assert.equal(fetchImplementation.mock.calls.length, 1);
  } finally {
    controller.abort();
    await watchPromise;
    await connector.close?.();
  }
});

test("createLinqWebhookConnector waits for successful attachment downloads that resolve within the timeout", async () => {
  const port = await reservePort();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];
  let resolveDownload: ((response: Response) => void) | null = null;
  let downloadStarted = false;
  let emitCalled = false;

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
    attachmentDownloadTimeoutMs: 100,
    fetchImplementation: vi.fn(async (_url, _init) => {
      downloadStarted = true;
      return await new Promise<Response>((resolve) => {
        resolveDownload = resolve;
      });
    }),
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitCalled = true;
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  try {
    const listenerUrl = `http://127.0.0.1:${port}/hooks/linq`;
    await waitForWebhookListener(listenerUrl);

    const payload = JSON.stringify(buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T11:00:05.000Z",
      data: {
        chat: {
          id: "chat_delayed_download",
          owner_handle: {
            handle: "+15559990000",
            id: "handle_owner_delayed_download",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_delayed_download",
        parts: [
          {
            type: "media",
            url: "https://cdn.example.test/att_2.pdf",
            attachment_id: "att_2",
            filename: "summary.pdf",
            mime_type: "application/pdf",
          },
        ],
        sender_handle: {
          handle: "+15550001111",
          id: "handle_sender_delayed_download",
          service: "iMessage",
        },
        sent_at: "2026-03-24T11:00:00.000Z",
        service: "iMessage",
      },
      eventId: "evt_delayed_download",
    }));
    const timestamp = "1711278000";
    const responsePromise = fetch(listenerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
        "x-webhook-timestamp": timestamp,
      },
      body: payload,
    });

    await vi.waitFor(() => {
      assert.equal(downloadStarted, true);
    });
    await delay(25);
    assert.equal(emitCalled, false);

    resolveDownload?.({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => Uint8Array.from([4, 3, 2, 1]).buffer,
    } as Response);

    const response = await responsePromise;
    assert.equal(response.status, 202);
    assert.equal(emitted.length, 1);
    assert.deepEqual(Array.from(emitted[0]?.attachments[0]?.data ?? []), [4, 3, 2, 1]);
  } finally {
    controller.abort();
    await watchPromise;
    await connector.close?.();
  }
});

test("createLinqWebhookConnector acknowledges webhooks promptly even when attachment downloads hang", async () => {
  const port = await reservePort();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
    attachmentDownloadTimeoutMs: 25,
    fetchImplementation: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  try {
    const listenerUrl = `http://127.0.0.1:${port}/hooks/linq`;
    await waitForWebhookListener(listenerUrl);

    const payload = JSON.stringify(buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T11:00:05.000Z",
      data: {
        chat: {
          id: "chat_456",
          owner_handle: {
            handle: "+15559990000",
            id: "handle_owner_456",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_abort_download",
        parts: [
          {
            type: "media",
            url: "https://cdn.example.test/att_2.pdf",
            attachment_id: "att_2",
            filename: "summary.pdf",
            mime_type: "application/pdf",
          },
        ],
        sender_handle: {
          handle: "+15550001111",
          id: "handle_sender_456",
          service: "iMessage",
        },
        sent_at: "2026-03-24T11:00:00.000Z",
        service: "iMessage",
      },
      eventId: "evt_abort_download",
    }));
    const timestamp = "1711278000";
    const responsePromise = fetch(listenerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
        "x-webhook-timestamp": timestamp,
      },
      body: payload,
    });

    const response = await Promise.race([
      responsePromise,
      delay(500).then(() => {
        throw new Error("Timed out waiting for Linq webhook response.");
      }),
    ]);

    assert.equal(response.status, 202);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.externalId, "linq:msg_abort_download");
    assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);
  } finally {
    controller.abort();
    await watchPromise;
    await connector.close?.();
  }
});

test("createLinqWebhookConnector rejects signed payloads that fail strict Linq message validation", async () => {
  const port = await reservePort();
  const controller = new AbortController();

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => createPersistedCapture(capture),
    controller.signal,
  );

  try {
    const listenerUrl = `http://127.0.0.1:${port}/hooks/linq`;
    await waitForWebhookListener(listenerUrl);

    const payload = JSON.stringify(buildV2026LinqWebhookEvent({
      createdAt: "2026-03-24T11:00:05.000Z",
      data: {
        chat: {
          id: "chat_456",
          owner_handle: {
            handle: "+15559990000",
            id: "handle_owner_456",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_456",
        parts: "not-an-array",
        sender_handle: {
          handle: "+15550001111",
          id: "handle_sender_456",
          service: "iMessage",
        },
        sent_at: "2026-03-24T11:00:00.000Z",
      },
      eventId: "evt_bad_parts",
    }));
    const timestamp = "1711278000";
    const response = await fetch(listenerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
        "x-webhook-timestamp": timestamp,
      },
      body: payload,
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /message\.parts must be an array/u);
  } finally {
    controller.abort();
    await watchPromise;
    await connector.close?.();
  }
});

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not resolve ephemeral Linq test port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `sha256=${signature}`;
}

function buildV2026LinqWebhookEvent(input: {
  createdAt?: string;
  data?: Record<string, unknown>;
  eventId?: string;
  traceId?: string | null;
} = {}): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-24T10:00:05.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
          service: "SMS",
        },
      },
      direction: "inbound",
      id: "msg_123",
      parts: [],
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
      sent_at: "2026-03-24T10:00:00.000Z",
      service: "SMS",
      ...(input.data ?? {}),
    },
    event_id: input.eventId ?? "evt_123",
    event_type: "message.received",
    trace_id: input.traceId ?? undefined,
  };
}

async function waitForWebhookListener(url: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(25);
  }

  throw new Error(`Timed out waiting for Linq webhook listener at ${url}.`);
}
