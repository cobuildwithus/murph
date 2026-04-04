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
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      parts: [
        {
          type: "text",
          value: "Hello from Linq",
        },
      ],
    },
    traceId: "trace_123",
  }));
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
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_invalid",
        owner_handle: {
          handle: "+15559999999",
          id: "handle_owner_invalid",
          is_me: true,
          service: "SMS",
        },
      },
      id: "msg_invalid",
      sender_handle: {
        handle: "+15550000000",
        id: "handle_sender_invalid",
        service: "SMS",
      },
    },
    eventId: "evt_invalid",
  }));

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
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_stale",
        owner_handle: {
          handle: "+15559999999",
          id: "handle_owner_stale",
          is_me: true,
          service: "SMS",
        },
      },
      id: "msg_stale",
      sender_handle: {
        handle: "+15550000000",
        id: "handle_sender_stale",
        service: "SMS",
      },
    },
    eventId: "evt_stale",
  }));
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
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_bad_timestamp",
        owner_handle: {
          handle: "+15559999999",
          id: "handle_owner_bad_timestamp",
          is_me: true,
          service: "SMS",
        },
      },
      id: "msg_bad_timestamp",
      sender_handle: {
        handle: "+15550000000",
        id: "handle_sender_bad_timestamp",
        service: "SMS",
      },
    },
    eventId: "evt_bad_timestamp",
  }));
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
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_missing_secret",
        owner_handle: {
          handle: "+15559999999",
          id: "handle_owner_missing_secret",
          is_me: true,
          service: "SMS",
        },
      },
      id: "msg_missing_secret",
      sender_handle: {
        handle: "+15550000000",
        id: "handle_sender_missing_secret",
        service: "SMS",
      },
    },
    eventId: "evt_missing_secret",
  }));

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
    ...buildV2026MessageReceivedWebhook({
      data: {
        effect: {
          name: "slam",
          type: "bubble",
        },
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
    }),
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
      chat_id: "chat_123",
      direction: "inbound",
      from: "+15551234567",
      from_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
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
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_owner_123",
        is_me: true,
        service: "SMS",
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
      sent_at: "2026-03-25T09:59:59.000Z",
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
      chat_id: "chat_123",
      direction: "inbound",
      from: "+15551234567",
      from_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
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
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_owner_123",
        is_me: true,
        service: "SMS",
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
      sent_at: "2026-03-25T09:59:59.000Z",
      service: "SMS",
    },
    event_id: "evt_123",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  });
});

test("parseCanonicalLinqMessageReceivedEvent normalizes 2026-02-03 webhook payloads", () => {
  const event = parseCanonicalLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        is_group: false,
        owner_handle: {
          handle: "+15557654321",
          id: "550e8400-e29b-41d4-a716-446655440010",
          is_me: true,
          joined_at: "2026-04-04T01:00:00.000Z",
          service: "iMessage",
        },
      },
      direction: "inbound",
      id: "550e8400-e29b-41d4-a716-446655440001",
      parts: [
        {
          type: "link",
          value: "https://withmurph.ai",
        },
      ],
      sender_handle: {
        handle: "+15551234567",
        id: "550e8400-e29b-41d4-a716-446655440011",
        joined_at: "2026-04-04T01:00:00.000Z",
        service: "iMessage",
      },
      sent_at: "2026-04-04T01:02:00.000Z",
      service: "iMessage",
    },
    event_id: "evt_v2026",
    event_type: "message.received",
  });

  assert.deepEqual(summarizeLinqMessageReceivedEvent(event), {
    chatId: "550e8400-e29b-41d4-a716-446655440000",
    isFromMe: false,
    messageId: "550e8400-e29b-41d4-a716-446655440001",
    phoneNumber: "+15551234567",
    text: null,
  });

  assert.deepEqual(minimizeLinqWebhookEvent(event), {
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        is_group: false,
        owner_handle: {
          handle: "+15557654321",
          id: "550e8400-e29b-41d4-a716-446655440010",
          is_me: true,
          joined_at: "2026-04-04T01:00:00.000Z",
          service: "iMessage",
        },
      },
      chat_id: "550e8400-e29b-41d4-a716-446655440000",
      direction: "inbound",
      from: "+15551234567",
      from_handle: {
        handle: "+15551234567",
        id: "550e8400-e29b-41d4-a716-446655440011",
        joined_at: "2026-04-04T01:00:00.000Z",
        service: "iMessage",
      },
      is_from_me: false,
      message: {
        id: "550e8400-e29b-41d4-a716-446655440001",
        parts: [
          {
            type: "link",
            value: "https://withmurph.ai",
          },
        ],
      },
      recipient_handle: {
        handle: "+15557654321",
        id: "550e8400-e29b-41d4-a716-446655440010",
        is_me: true,
        joined_at: "2026-04-04T01:00:00.000Z",
        service: "iMessage",
      },
      recipient_phone: "+15557654321",
      received_at: "2026-04-04T01:02:00.000Z",
      sender_handle: {
        handle: "+15551234567",
        id: "550e8400-e29b-41d4-a716-446655440011",
        joined_at: "2026-04-04T01:00:00.000Z",
        service: "iMessage",
      },
      sent_at: "2026-04-04T01:02:00.000Z",
      service: "iMessage",
    },
    event_id: "evt_v2026",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
    webhook_version: "2026-02-03",
  });
});

test("parseCanonicalLinqMessageReceivedEvent accepts voice memos and preserves URLs in hosted minimization", () => {
  const event = parseCanonicalLinqMessageReceivedEvent({
    ...buildV2026MessageReceivedWebhook({
      createdAt: "2026-04-02T04:00:00.000Z",
      data: {
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_123",
            is_me: true,
            service: "iMessage",
          },
        },
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
        sender_handle: {
          handle: "+15551234567",
          id: "handle_sender_123",
          service: "iMessage",
        },
        sent_at: "2026-04-02T04:00:01.000Z",
        service: "iMessage",
      },
      traceId: "trace_123",
    }),
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
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: "chat_123",
      direction: "inbound",
      from: "+15551234567",
      from_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "iMessage",
      },
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
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_owner_123",
        is_me: true,
        service: "iMessage",
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "iMessage",
      },
      sent_at: "2026-04-02T04:00:01.000Z",
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
        ...buildV2026MessageReceivedWebhook({
          data: {
            chat: {
              id: "chat_456",
              owner_handle: {
                handle: "+15557654321",
                id: "handle_owner_456",
                is_me: true,
                service: "SMS",
              },
            },
            id: "msg_456",
            parts: [
              {
                type: "sticker",
              },
            ],
          },
          eventId: "evt_456",
        }),
      }),
    /type must be "text", "media", "link", or "voice_memo"/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects payloads without message parts in either webhook shape", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
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
            parts: undefined,
          },
          eventId: "evt_missing_message",
        }),
      }),
    /message\.parts must be an array/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects non-array message parts", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          data: {
            parts: "nope",
          },
          eventId: "evt_bad_parts",
        }),
      }),
    /message\.parts must be an array/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects missing message ids", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          data: {
            id: undefined,
          },
          eventId: "evt_missing_id",
        }),
      }),
    /message\.id is required/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects invalid directions", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          data: {
            direction: "sideways",
          },
          eventId: "evt_bad_direction",
        }),
      }),
    /direction must be "inbound" or "outbound"/u,
  );
});

test("parseCanonicalLinqMessageReceivedEvent rejects invalid timestamps", () => {
  assert.throws(
    () =>
      parseCanonicalLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          createdAt: "not-a-date",
          data: {
            sent_at: "also-not-a-date",
          },
          eventId: "evt_bad_timestamp",
        }),
      }),
    /Invalid ISO timestamp: (not-a-date|also-not-a-date)/u,
  );
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}

function buildV2026MessageReceivedWebhook(input: {
  createdAt?: string;
  data?: Record<string, unknown>;
  eventId?: string;
  traceId?: string | null;
} = {}): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-25T10:00:00.000Z",
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
      sent_at: "2026-03-25T09:59:59.000Z",
      service: "SMS",
      ...(input.data ?? {}),
    },
    event_id: input.eventId ?? "evt_123",
    event_type: "message.received",
    trace_id: input.traceId ?? undefined,
  };
}
