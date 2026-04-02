import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { test } from "vitest";

import {
  minimizeLinqMessageReceivedEvent,
  minimizeLinqWebhookEvent,
  parseCanonicalLinqMessageReceivedEvent,
  summarizeLinqMessageReceivedEvent,
  verifyAndParseLinqWebhookRequest,
} from "../src/index.ts";

test("verifyAndParseLinqWebhookRequest validates the Linq signature envelope", () => {
  const payload = JSON.stringify({
    api_version: "v3",
    event_id: "evt_123",
    created_at: "2026-03-25T10:00:00.000Z",
    event_type: "message.received",
    trace_id: "trace_123",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      recipient_phone: "+15557654321",
      received_at: "2026-03-25T09:59:59.000Z",
      is_from_me: false,
      service: "SMS",
      message: {
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "Hello from Linq",
          },
        ],
      },
    },
  });
  const timestamp = "1711360800";
  const signature = signLinqWebhook("secret-123", payload, timestamp);

  const event = verifyAndParseLinqWebhookRequest({
    headers: new Headers({
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    }),
    rawBody: payload,
    webhookSecret: "secret-123",
  });

  assert.equal(event.event_id, "evt_123");
  assert.equal(event.event_type, "message.received");
  assert.equal(event.trace_id, "trace_123");
});

test("verifyAndParseLinqWebhookRequest rejects invalid signatures", () => {
  const payload = JSON.stringify({
    api_version: "v3",
    event_id: "evt_invalid",
    created_at: "2026-03-25T10:00:00.000Z",
    event_type: "message.received",
    data: {
      chat_id: "chat_invalid",
      from: "+15550000000",
      recipient_phone: "+15559999999",
      received_at: "2026-03-25T09:59:59.000Z",
      is_from_me: false,
      service: "SMS",
      message: {
        id: "msg_invalid",
        parts: [],
      },
    },
  });

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": "sha256=deadbeef",
          "x-webhook-timestamp": "1711360800",
        },
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Invalid Linq webhook signature/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects stale timestamps when a tolerance is configured", () => {
  const payload = JSON.stringify({
    api_version: "v3",
    event_id: "evt_stale",
    created_at: "2026-03-25T10:00:00.000Z",
    event_type: "message.received",
    data: {
      chat_id: "chat_stale",
      from: "+15550000000",
      recipient_phone: "+15559999999",
      received_at: "2026-03-25T09:59:59.000Z",
      is_from_me: false,
      service: "SMS",
      message: {
        id: "msg_stale",
        parts: [],
      },
    },
  });
  const timestamp = "1711360800";

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
          "x-webhook-timestamp": timestamp,
        },
        now: 1711361400_000,
        rawBody: payload,
        timestampToleranceMs: 60_000,
        webhookSecret: "secret-123",
      }),
    /allowed tolerance window/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects invalid timestamps when a tolerance is configured", () => {
  const payload = JSON.stringify({
    api_version: "v3",
    event_id: "evt_bad_timestamp",
    created_at: "2026-03-25T10:00:00.000Z",
    event_type: "message.received",
    data: {
      chat_id: "chat_bad_timestamp",
      from: "+15550000000",
      recipient_phone: "+15559999999",
      received_at: "2026-03-25T09:59:59.000Z",
      is_from_me: false,
      service: "SMS",
      message: {
        id: "msg_bad_timestamp",
        parts: [],
      },
    },
  });
  const timestamp = "not-a-timestamp";

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
          "x-webhook-timestamp": timestamp,
        },
        now: 1711360800_000,
        rawBody: payload,
        timestampToleranceMs: 60_000,
        webhookSecret: "secret-123",
      }),
    /Invalid Linq webhook timestamp/u,
  );
});

test("verifyAndParseLinqWebhookRequest requires a configured webhook secret", () => {
  const payload = JSON.stringify({
    api_version: "v3",
    event_id: "evt_missing_secret",
    created_at: "2026-03-25T10:00:00.000Z",
    event_type: "message.received",
    data: {
      chat_id: "chat_missing_secret",
      from: "+15550000000",
      recipient_phone: "+15559999999",
      received_at: "2026-03-25T09:59:59.000Z",
      is_from_me: false,
      service: "SMS",
      message: {
        id: "msg_missing_secret",
        parts: [],
      },
    },
  });

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {},
        rawBody: payload,
        webhookSecret: "",
      }),
    /Linq webhook secret is required/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent exposes summaries and minimizers", () => {
  const event = parseCanonicalLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-03-25T10:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        effect: {
          name: "slam",
          type: "bubble",
        },
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "Hello",
          },
          {
            attachment_id: "att_123",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size: 1234,
            type: "media",
            url: "https://files.example.test/photo.jpg",
          },
        ],
        reply_to: {
          message_id: "msg_122",
          part_index: 0,
        },
      },
      recipient_phone: "+15557654321",
      received_at: "2026-03-25T09:59:59.000Z",
      service: "SMS",
    },
    event_id: "evt_123",
    event_type: "message.received",
  });

  assert.deepEqual(summarizeLinqMessageReceivedEvent(event), {
    chatId: "chat_123",
    isFromMe: false,
    messageId: "msg_123",
    phoneNumber: "+15551234567",
    text: "Hello",
  });

  assert.deepEqual(minimizeLinqMessageReceivedEvent(event), {
    api_version: "v3",
    created_at: "2026-03-25T10:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        effect: {
          name: "slam",
          type: "bubble",
        },
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "Hello",
          },
          {
            attachment_id: "att_123",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size: 1234,
            type: "media",
            url: "https://files.example.test/photo.jpg",
          },
        ],
        reply_to: {
          message_id: "msg_122",
          part_index: 0,
        },
      },
      received_at: "2026-03-25T09:59:59.000Z",
      recipient_phone: "+15557654321",
      service: "SMS",
    },
    event_id: "evt_123",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  });

  assert.deepEqual(minimizeLinqWebhookEvent(event), {
    api_version: "v3",
    created_at: "2026-03-25T10:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        effect: {
          name: "slam",
          type: "bubble",
        },
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "Hello",
          },
          {
            attachment_id: "att_123",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size: 1234,
            type: "media",
            url: "https://files.example.test/photo.jpg",
          },
        ],
        reply_to: {
          message_id: "msg_122",
          part_index: 0,
        },
      },
      received_at: "2026-03-25T09:59:59.000Z",
      recipient_phone: "+15557654321",
      service: "SMS",
    },
    event_id: "evt_123",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  });
});

test("parseCanonicalLinqMessageReceivedEvent accepts voice memos and preserves URLs in hosted minimization", () => {
  const event = parseCanonicalLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-04-02T04:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        id: "msg_123",
        parts: [
          {
            attachment_id: null,
            filename: null,
            mime_type: "audio/m4a",
            size: 2048,
            type: "voice_memo",
            url: "https://cdn.linqapp.com/media/voice-123.m4a",
          },
        ],
      },
      recipient_phone: "+15557654321",
      received_at: "2026-04-02T04:00:01.000Z",
      service: "iMessage",
    },
    event_id: "evt_123",
    event_type: "message.received",
    trace_id: "trace_123",
  });

  assert.deepEqual(event.data.message.parts, [
    {
      attachment_id: null,
      filename: null,
      mime_type: "audio/m4a",
      size: 2048,
      type: "voice_memo",
      url: "https://cdn.linqapp.com/media/voice-123.m4a",
    },
  ]);

  assert.deepEqual(minimizeLinqMessageReceivedEvent(event), {
    api_version: "v3",
    created_at: "2026-04-02T04:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        id: "msg_123",
        parts: [
          {
            attachment_id: null,
            filename: null,
            mime_type: "audio/m4a",
            size: 2048,
            type: "voice_memo",
            url: "https://cdn.linqapp.com/media/voice-123.m4a",
          },
        ],
      },
      received_at: "2026-04-02T04:00:01.000Z",
      recipient_phone: "+15557654321",
      service: "iMessage",
    },
    event_id: "evt_123",
    event_type: "message.received",
    partner_id: null,
    trace_id: "trace_123",
  });
});

test("parseCanonicalLinqMessageReceivedEvent rejects unknown part types", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        created_at: "2026-04-02T04:00:00.000Z",
        data: {
          chat_id: "chat_456",
          from: "+15551234567",
          is_from_me: false,
          message: {
            id: "msg_456",
            parts: [
              {
                type: "sticker",
              },
            ],
          },
        },
        event_id: "evt_456",
        event_type: "message.received",
      }),
    /type must be "text", "media", or "voice_memo"/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects a missing message object", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        event_id: "evt_missing_message",
        created_at: "2026-03-25T10:00:00.000Z",
        event_type: "message.received",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
        },
      }),
    /Linq message\.received message must be an object/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects non-array message parts", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        event_id: "evt_bad_parts",
        created_at: "2026-03-25T10:00:00.000Z",
        event_type: "message.received",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          message: {
            id: "msg_123",
            parts: "nope",
          },
        },
      }),
    /message\.parts must be an array/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects missing message ids", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        event_id: "evt_missing_id",
        created_at: "2026-03-25T10:00:00.000Z",
        event_type: "message.received",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          message: {
            parts: [],
          },
        },
      }),
    /message\.id is required/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects non-boolean is_from_me values", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        event_id: "evt_bad_is_from_me",
        created_at: "2026-03-25T10:00:00.000Z",
        event_type: "message.received",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: "false",
          message: {
            id: "msg_123",
            parts: [],
          },
        },
      }),
    /is_from_me must be a boolean/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects invalid timestamps", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        api_version: "v3",
        event_id: "evt_bad_timestamp",
        created_at: "not-a-date",
        event_type: "message.received",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          received_at: "also-not-a-date",
          message: {
            id: "msg_123",
            parts: [],
          },
        },
      }),
    /Invalid ISO timestamp: not-a-date/u,
  );
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}
