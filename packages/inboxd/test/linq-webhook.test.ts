import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { test } from "vitest";

import {
  parseCanonicalLinqMessageReceivedEvent,
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
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signature,
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
          "x-webhook-timestamp": "1711360800",
          "x-webhook-signature": "sha256=deadbeef",
        },
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Invalid Linq webhook signature/u,
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
    /created_at must be a valid timestamp/u,
  );
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `sha256=${signature}`;
}
