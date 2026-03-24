import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";

import {
  createLinqWebhookConnector,
  normalizeLinqWebhookEvent,
  type InboundCapture,
  type PersistedCapture,
} from "../src/index.js";

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
    event: {
      api_version: "v3",
      event_id: "evt_123",
      created_at: "2026-03-24T10:00:05.000Z",
      event_type: "message.received",
      data: {
        chat_id: "chat_123",
        from: "+15551234567",
        recipient_phone: "+15557654321",
        received_at: "2026-03-24T10:00:00.000Z",
        is_from_me: false,
        service: "SMS",
        message: {
          id: "msg_123",
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
        },
      },
    },
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

test("createLinqWebhookConnector accepts signed webhook requests and emits captures", async () => {
  const port = await reservePort();
  const controller = new AbortController();
  const emitted: Array<{
    capture: InboundCapture;
    checkpoint: Record<string, unknown> | null | undefined;
  }> = [];

  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port,
    webhookSecret: "secret-123",
    fetchImplementation: async (url) => {
      assert.equal(url, "https://cdn.example.test/att_2.pdf");
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
        arrayBuffer: async () => Uint8Array.from([9, 8, 7, 6]).buffer,
      } as Response;
    },
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

    const payload = JSON.stringify({
      api_version: "v3",
      event_id: "evt_456",
      created_at: "2026-03-24T11:00:05.000Z",
      event_type: "message.received",
      data: {
        chat_id: "chat_456",
        from: "+15550001111",
        recipient_phone: "+15559990000",
        received_at: "2026-03-24T11:00:00.000Z",
        is_from_me: false,
        service: "iMessage",
        message: {
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
        },
      },
    });
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
