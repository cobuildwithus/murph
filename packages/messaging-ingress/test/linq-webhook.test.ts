import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { test } from "vitest";

import {
  assertLinqWebhookTimestampFresh,
  buildLinqMessageText,
  inspectLinqMessageReceivedParts,
  isLinqWebhookPayloadError,
  isLinqWebhookVerificationError,
  type LinqWebhookEvent,
  minimizeLinqMessageReceivedEvent,
  minimizeLinqWebhookEvent,
  parseLinqMessageEditedEvent,
  parseLinqMessageReceivedEvent,
  parseLinqParticipantChangedEvent,
  parseLinqTypingIndicatorStartedEvent,
  parseLinqWebhookEvent,
  readLinqRecipientLineHandle,
  readLinqWebhookHeader,
  parseRawLinqMessageReceivedEvent,
  resolveLinqWebhookOccurredAt,
  summarizeLinqMessageReceivedEvent,
  verifyAndParseLinqWebhookRequest,
} from "../src/linq-webhook.ts";

test("parseLinqTypingIndicatorStartedEvent keeps only the direct chat target", () => {
  const event = parseLinqTypingIndicatorStartedEvent(parseLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-08-09T12:00:00.000Z",
    data: {
      chat_id: "  chat_typing_123  ",
      ignored_provider_field: "ignored",
    },
    event_id: "evt_typing_123",
    event_type: "chat.typing_indicator.started",
  })));

  assert.deepEqual(event.data, {
    chat_id: "chat_typing_123",
  });
  assert.equal(event.created_at, "2026-08-09T12:00:00.000Z");
});

test("parseLinqTypingIndicatorStartedEvent rejects a missing chat target", () => {
  const event = parseLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-08-09T12:00:00.000Z",
    data: {},
    event_id: "evt_typing_invalid",
    event_type: "chat.typing_indicator.started",
  }));

  assert.throws(
    () => parseLinqTypingIndicatorStartedEvent(event),
    /chat_id is required/u,
  );
});

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
    now: 1711360800_000,
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

test("verifyAndParseLinqWebhookRequest rejects signatures with trailing junk after a valid digest", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_trailing_junk",
  }));
  const timestamp = "1711360800";
  const signature = `${signLinqWebhook("secret-123", payload, timestamp)}zz`;

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": timestamp,
        },
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Invalid Linq webhook signature/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects signatures with a dangling final nibble", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_dangling_nibble",
  }));
  const timestamp = "1711360800";
  const signature = `${signLinqWebhook("secret-123", payload, timestamp)}f`;

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": timestamp,
        },
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Invalid Linq webhook signature/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects duplicate signature headers instead of guessing", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_duplicate_signature",
  }));
  const timestamp = "1711360800";
  const signature = signLinqWebhook("secret-123", payload, timestamp);

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": [signature, signature],
          "x-webhook-timestamp": timestamp,
        },
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Duplicate Linq webhook x-webhook-signature header/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects duplicate signature arrays even when one entry is blank", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_duplicate_signature_blank",
  }));
  const timestamp = "1711360800";
  const signature = signLinqWebhook("secret-123", payload, timestamp);

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": [" ", signature],
          "x-webhook-timestamp": timestamp,
        },
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Duplicate Linq webhook x-webhook-signature header/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects duplicate timestamp headers instead of guessing", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_duplicate_timestamp",
  }));
  const timestamp = "1711360800";
  const signature = signLinqWebhook("secret-123", payload, timestamp);
  const headers = new Headers();
  headers.append("x-webhook-signature", signature);
  headers.append("x-webhook-timestamp", timestamp);
  headers.append("x-webhook-timestamp", timestamp);

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers,
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Duplicate Linq webhook x-webhook-timestamp header/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects duplicate timestamp arrays even when one entry is blank", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_duplicate_timestamp_blank",
  }));
  const timestamp = "1711360800";
  const signature = signLinqWebhook("secret-123", payload, timestamp);

  assert.throws(
    () =>
      verifyAndParseLinqWebhookRequest({
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": [" ", timestamp],
        },
        now: 1711360800_000,
        rawBody: payload,
        webhookSecret: "secret-123",
      }),
    /Duplicate Linq webhook x-webhook-timestamp header/u,
  );
});

test("verifyAndParseLinqWebhookRequest rejects stale timestamps by default when tolerance is omitted", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_default_stale",
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
        webhookSecret: "secret-123",
      }),
    /allowed tolerance window/u,
  );
});

test("verifyAndParseLinqWebhookRequest treats null timestamp tolerance as an explicit freshness opt-out", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    eventId: "evt_stale_opt_out",
  }));
  const timestamp = "1711360800";

  const event = verifyAndParseLinqWebhookRequest({
    headers: {
      "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    now: 1711361400_000,
    rawBody: payload,
    timestampToleranceMs: null,
    webhookSecret: "secret-123",
  });

  assert.equal(event.event_id, "evt_stale_opt_out");
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

test("verifyAndParseLinqWebhookRequest accepts array-backed headers and ArrayBuffer payloads", () => {
  const payload = JSON.stringify(buildV2026MessageReceivedWebhook({
    data: {
      parts: [
        {
          type: "text",
          value: "Hello from buffer",
        },
      ],
    },
    eventId: "evt_buffer",
  }));
  const timestamp = "1711360800";

  const event = verifyAndParseLinqWebhookRequest({
    headers: {
      "X-Webhook-Signature": [signLinqWebhook("secret-123", payload, timestamp)],
      "x-webhook-timestamp": [timestamp],
    },
    now: 1711360800_000,
    rawBody: new TextEncoder().encode(payload).buffer,
    webhookSecret: "secret-123",
  });

  assert.equal(event.event_id, "evt_buffer");
  assert.equal(
    readLinqWebhookHeader({ "x-custom": [" value "] }, "X-Custom"),
    "value",
  );
  assert.equal(readLinqWebhookHeader({}, "x-missing"), null);
});

test("parseLinqWebhookEvent surfaces payload errors through the exported type guards", () => {
  assert.throws(() => parseLinqWebhookEvent("{"), (error: unknown) => {
    assert.equal(isLinqWebhookPayloadError(error), true);
    assert.equal(isLinqWebhookVerificationError(error), false);
    assert.match(String(error), /must be valid JSON/u);
    return true;
  });

  assert.throws(
    () => parseLinqWebhookEvent("null"),
    /Linq webhook payload must be an object/u,
  );
  assert.throws(
    () => assertLinqWebhookTimestampFresh("1711360800", { toleranceMs: -1 }),
    /non-negative finite number/u,
  );
  assert.doesNotThrow(() =>
    assertLinqWebhookTimestampFresh("1711360800", {
      now: 1711360800_000,
      toleranceMs: 0,
    }),
  );
});

test("parseLinqMessageReceivedEvent exposes summaries and minimizers", () => {
  const event = parseLinqMessageReceivedEvent({
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
            id: "att_123",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size_bytes: 1234,
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

test("parseLinqParticipantChangedEvent normalizes full and deprecated participant handles", () => {
  const added = parseLinqParticipantChangedEvent({
    api_version: "v3",
    created_at: "2026-07-29T01:00:00.000Z",
    event_id: "evt_participant_added",
    event_type: "participant.added",
    data: {
      added_at: "2026-07-29T00:59:59.000Z",
      chat_id: "chat_group",
      participant: {
        handle: "+15551234567",
        id: "handle_participant",
        joined_at: "2026-07-29T00:59:59.000Z",
        service: "iMessage",
        status: "active",
      },
    },
  });
  const removed = parseLinqParticipantChangedEvent({
    api_version: "v3",
    created_at: "2026-07-29T01:05:00.000Z",
    event_id: "evt_participant_removed",
    event_type: "participant.removed",
    data: {
      chat_id: "chat_group",
      handle: "person@example.test",
      removed_at: "2026-07-29T01:04:59.000Z",
      service: "SMS",
    },
  });

  assert.deepEqual(added.data, {
    added_at: "2026-07-29T00:59:59.000Z",
    chat_id: "chat_group",
    participant: {
      handle: "+15551234567",
      id: "handle_participant",
      is_me: undefined,
      joined_at: "2026-07-29T00:59:59.000Z",
      left_at: undefined,
      service: "iMessage",
      status: "active",
    },
  });
  assert.deepEqual(removed.data, {
    chat_id: "chat_group",
    participant: {
      handle: "person@example.test",
      service: "SMS",
    },
    removed_at: "2026-07-29T01:04:59.000Z",
  });
});

test("parseLinqParticipantChangedEvent rejects missing or conflicting event shapes", () => {
  assert.throws(
    () => parseLinqParticipantChangedEvent({
      api_version: "v3",
      created_at: "2026-07-29T01:00:00.000Z",
      event_id: "evt_missing_participant",
      event_type: "participant.added",
      data: { chat_id: "chat_group" },
    }),
    /participant or deprecated handle is required/u,
  );
  assert.throws(
    () => parseLinqParticipantChangedEvent({
      api_version: "v3",
      created_at: "2026-07-29T01:00:00.000Z",
      event_id: "evt_wrong_type",
      event_type: "message.received",
      data: {},
    }),
    /participant change payload/u,
  );
});

test("minimizeLinqMessageReceivedEvent sanitizes allowlisted message fields", () => {
  const event = parseLinqMessageReceivedEvent({
    ...buildV2026MessageReceivedWebhook({
      data: {
        parts: [
          {
            type: "text",
            value: "Replying to: /home/example/project",
          },
          {
            type: "link",
            value: "cookie: session=secret-token",
          },
        ],
        sender_handle: {
          handle: "C:\\temp\\murph\\sender.txt",
          id: "handle_sender_123",
          service: "SMS",
        },
      },
      eventId: "evt_sanitized_message",
    }),
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
      from: "<REDACTED_PATH>",
      from_handle: {
        handle: "<REDACTED_PATH>",
        id: "handle_sender_123",
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "Replying to: <REDACTED_PATH>",
          },
          {
            type: "link",
            value: "<REDACTED_SECRET>",
          },
        ],
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
        handle: "<REDACTED_PATH>",
        id: "handle_sender_123",
        service: "SMS",
      },
      sent_at: "2026-03-25T09:59:59.000Z",
      service: "SMS",
    },
    event_id: "evt_sanitized_message",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  });
});

test("parseRawLinqMessageReceivedEvent preserves explicit recipient fields on raw webhook payloads", () => {
  const event = parseRawLinqMessageReceivedEvent(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_legacy_recipient",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_legacy",
          is_me: true,
          service: "SMS",
        },
      },
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_recipient_legacy",
        is_me: true,
        service: "iMessage",
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_legacy",
        service: "iMessage",
      },
      service: "iMessage",
    },
    eventId: "evt_legacy_recipient",
  }));

  assert.equal(event.data.recipient_phone, "+15557654321");
  assert.ok(event.data.recipient_handle);
  assert.equal(event.data.recipient_handle.handle, "+15557654321");
  assert.equal(event.data.recipient_handle.id, "handle_recipient_legacy");
  assert.equal(event.data.recipient_handle.is_me, true);
  assert.equal(event.data.recipient_handle.service, "iMessage");
});

test("parseRawLinqMessageReceivedEvent falls back to an explicit raw recipient handle without changing service fallback", () => {
  const event = parseRawLinqMessageReceivedEvent(buildV2026MessageReceivedWebhook({
    data: {
      chat: {
        id: "chat_legacy_recipient_handle_only",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_legacy_service",
          is_me: true,
          service: "SMS",
        },
      },
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_recipient_legacy_only",
        is_me: true,
        service: "iMessage",
      },
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_legacy_only",
      },
    },
    eventId: "evt_legacy_recipient_handle_only",
  }));

  assert.equal(event.data.recipient_phone, "+15557654321");
  assert.ok(event.data.recipient_handle);
  assert.equal(event.data.recipient_handle.handle, "+15557654321");
  assert.equal(event.data.service, "SMS");
});

test("parseLinqMessageReceivedEvent normalizes 2026-02-03 webhook payloads", () => {
  const event = parseLinqMessageReceivedEvent({
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

test("parseLinqMessageReceivedEvent accepts canonical hosted snapshots", () => {
  const canonical = minimizeLinqMessageReceivedEvent(parseLinqMessageReceivedEvent({
    ...buildV2026MessageReceivedWebhook({
      data: {
        parts: [
          {
            type: "text",
            value: "Hello from storage",
          },
        ],
      },
      eventId: "evt_canonical",
      traceId: "trace_canonical",
    }),
  }));

  const event = parseLinqMessageReceivedEvent(canonical as never);

  assert.deepEqual(summarizeLinqMessageReceivedEvent(event), {
    chatId: "chat_123",
    isFromMe: false,
    messageId: "msg_123",
    phoneNumber: "+15551234567",
    text: "Hello from storage",
  });
});

test("parseLinqMessageReceivedEvent accepts audio media parts and preserves URLs in hosted minimization", () => {
  const event = parseLinqMessageReceivedEvent({
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
            id: "att_audio_123",
            filename: "voice-123.m4a",
            mime_type: "audio/m4a",
            size_bytes: 2048,
            type: "media",
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
      attachment_id: "att_audio_123",
      filename: "voice-123.m4a",
      mime_type: "audio/m4a",
      size: 2048,
      type: "media",
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
            attachment_id: "att_audio_123",
            filename: "voice-123.m4a",
            mime_type: "audio/m4a",
            size: 2048,
            type: "media",
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

test("parseLinqMessageReceivedEvent accepts camelCase media metadata in canonical snapshots", () => {
  const event = parseLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-04-23T06:17:45.000Z",
    data: {
      chat: {
        id: "chat_voice_camel",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_voice_camel",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: "chat_voice_camel",
      direction: "inbound",
      from: "+15551234567",
      is_from_me: false,
      message: {
        id: "msg_voice_camel",
        parts: [
          {
            attachmentId: "att_voice_camel",
            fileName: "voice-camel.m4a",
            mimeType: "audio/m4a",
            sizeBytes: 4096,
            type: "voice_memo",
            url: "https://cdn.linqapp.com/files/voice-camel.m4a",
          },
        ],
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_voice_camel",
        service: "iMessage",
      },
      service: "iMessage",
    },
    event_id: "evt_voice_camel",
    event_type: "message.received",
  } as never);

  assert.deepEqual(event.data.message.parts, [
    {
      attachment_id: "att_voice_camel",
      filename: "voice-camel.m4a",
      mime_type: "audio/m4a",
      size: 4096,
      type: "voice_memo",
      url: "https://cdn.linqapp.com/files/voice-camel.m4a",
    },
  ]);
});

test("parseLinqMessageReceivedEvent infers canonical outbound direction and hosted link minimization", () => {
  const event = parseLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "chat_outbound",
      },
      chat_id: "chat_outbound",
      from: "+15551230000",
      is_from_me: true,
      message: {
        id: "msg_outbound",
        parts: [
          {
            type: "link",
            value: "https://withmurph.ai/outbound",
          },
        ],
      },
      sender_handle: {
        handle: "+15551230000",
        id: "sender_outbound",
        service: "iMessage",
      },
    },
    event_id: "evt_outbound",
    event_type: "message.received",
  });

  assert.deepEqual(summarizeLinqMessageReceivedEvent(event), {
    chatId: "chat_outbound",
    isFromMe: true,
    messageId: "msg_outbound",
    phoneNumber: "+15551230000",
    text: null,
  });
  assert.equal(resolveLinqWebhookOccurredAt(event), "2026-04-04T01:02:03.000Z");
  assert.deepEqual(minimizeLinqMessageReceivedEvent(event), {
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "chat_outbound",
      },
      chat_id: "chat_outbound",
      direction: "outbound",
      from: "+15551230000",
      from_handle: {
        handle: "+15551230000",
        id: "sender_outbound",
        service: "iMessage",
      },
      is_from_me: true,
      message: {
        id: "msg_outbound",
        parts: [
          {
            type: "link",
            value: "https://withmurph.ai/outbound",
          },
        ],
      },
      received_at: "2026-04-04T01:02:03.000Z",
      recipient_phone: null,
      sender_handle: {
        handle: "+15551230000",
        id: "sender_outbound",
        service: "iMessage",
      },
      service: "iMessage",
    },
    event_id: "evt_outbound",
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  });
});

test("parseLinqMessageReceivedEvent prefers raw received_at over sent_at for occurredAt", () => {
  const event = parseLinqMessageReceivedEvent({
    ...buildV2026MessageReceivedWebhook({
      createdAt: "2026-04-04T01:02:03.000Z",
      data: {
        received_at: "2026-04-04T01:02:01.000Z",
        sent_at: "2026-04-04T01:01:59.000Z",
      },
      eventId: "evt_received_preferred",
    }),
  });

  assert.equal(event.data.received_at, "2026-04-04T01:02:01.000Z");
  assert.equal(event.data.sent_at, "2026-04-04T01:01:59.000Z");
  assert.equal(resolveLinqWebhookOccurredAt(event), "2026-04-04T01:02:01.000Z");
});

test("parseLinqMessageReceivedEvent falls back to raw sent_at when received_at is missing", () => {
  const event = parseLinqMessageReceivedEvent({
    ...buildV2026MessageReceivedWebhook({
      createdAt: "2026-04-04T01:02:03.000Z",
      data: {
        received_at: null,
        sent_at: "2026-04-04T01:01:59.000Z",
      },
      eventId: "evt_sent_fallback",
    }),
  });

  assert.equal(event.data.sent_at, "2026-04-04T01:01:59.000Z");
  assert.equal(event.data.received_at, "2026-04-04T01:01:59.000Z");
  assert.equal(resolveLinqWebhookOccurredAt(event), "2026-04-04T01:01:59.000Z");
});

test("parseLinqMessageReceivedEvent falls back to sender fields and sent_at when canonical timestamps are sparse", () => {
  const event = parseLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "chat_sparse",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_sparse",
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: "chat_sparse",
      from: "+15557654321",
      is_from_me: true,
      message: {
        id: "msg_sparse",
        parts: [],
      },
      sender_handle: {
        handle: "+15557654321",
        id: "sender_sparse",
        service: "SMS",
      },
      sent_at: "2026-04-04T01:01:59.000Z",
    },
    event_id: "evt_sparse",
    event_type: "message.received",
  });

  assert.equal(event.data.direction, "outbound");
  assert.ok(event.data.from_handle);
  assert.equal(event.data.from_handle.handle, "+15557654321");
  assert.equal(event.data.from_handle.id, "sender_sparse");
  assert.equal(event.data.from_handle.service, "SMS");
  assert.equal(event.data.recipient_phone, null);
  assert.equal(event.data.recipient_handle?.handle, "+15557654321");
  assert.equal(readLinqRecipientLineHandle(event.data), "+15557654321");
  assert.equal(event.data.service, "SMS");
  assert.equal(event.data.sent_at, "2026-04-04T01:01:59.000Z");
  assert.equal(event.data.received_at, "2026-04-04T01:01:59.000Z");
  assert.equal(resolveLinqWebhookOccurredAt(event), "2026-04-04T01:01:59.000Z");

  assert.throws(
    () =>
      resolveLinqWebhookOccurredAt({
        ...event,
        created_at: "   ",
        data: {
          ...event.data,
          received_at: "  ",
        },
      }),
    /occurredAt is required/u,
  );
});

test("parseLinqMessageReceivedEvent rejects canonical snapshots missing required chat fields", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        api_version: "v3",
        created_at: "2026-04-04T01:02:03.000Z",
        data: {
          chat: null,
          chat_id: "chat_missing",
          from: "+15551230000",
          is_from_me: false,
          message: {
            id: "msg_missing",
            parts: [],
          },
          sender_handle: {
            handle: "+15551230000",
          },
          service: "SMS",
        },
        event_id: "evt_missing_chat",
        event_type: "message.received",
      }),
    /chat is required/u,
  );

  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        api_version: "v3",
        created_at: "2026-04-04T01:02:03.000Z",
        data: {
          chat: {
            id: "chat_missing_sender",
          },
          chat_id: "chat_missing_sender",
          from: "+15551230000",
          is_from_me: false,
          message: {
            id: "msg_missing_sender",
            parts: [],
          },
          service: "SMS",
        },
        event_id: "evt_missing_sender",
        event_type: "message.received",
      }),
    /sender_handle is required/u,
  );
});

test("minimizeLinqWebhookEvent rejects canonical-looking snapshots missing required message fields", () => {
  assert.throws(
    () =>
      minimizeLinqWebhookEvent({
        api_version: "v3",
        created_at: "2026-04-04T01:02:03.000Z",
        data: {
          chat: {
            id: "chat_missing_fields",
            owner_handle: {
              handle: "+15557654321",
              id: "handle_owner_missing_fields",
              is_me: true,
              service: "SMS",
            },
          },
          is_from_me: false,
          message: {
            parts: [],
          },
          sender_handle: {
            handle: "+15551230000",
            id: "sender_missing_fields",
            service: "SMS",
          },
          service: "SMS",
        },
        event_id: "evt_missing_fields",
        event_type: "message.received",
      }),
    /chat_id is required|from is required|message\.id is required/u,
  );
});

test("minimizeLinqWebhookEvent omits unsupported event data without forcing message parsing", () => {
  assert.deepEqual(
    minimizeLinqWebhookEvent({
      api_version: "v3",
      created_at: "2026-04-04T01:02:03.000Z",
      data: {
        note: "keep",
      },
      event_id: "evt_passthrough",
      event_type: "conversation.updated",
      partner_id: null,
      trace_id: null,
      webhook_version: "2026-02-03",
    }),
    {
      api_version: "v3",
      created_at: "2026-04-04T01:02:03.000Z",
      event_id: "evt_passthrough",
      event_type: "conversation.updated",
      partner_id: null,
      trace_id: null,
      webhook_version: "2026-02-03",
    },
  );
});

test("parseLinqMessageReceivedEvent rejects unknown part types", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
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
    /type must be "text", "media", "link", "voice_memo", or "imessage_app"/u,
  );
});

test("parseLinqMessageReceivedEvent normalizes absent or null message parts to empty", () => {
  const currentEvent = buildV2026MessageReceivedWebhook({
    data: {
      parts: undefined,
    },
    eventId: "evt_missing_current_parts",
  });
  const legacyEvent: LinqWebhookEvent = {
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "chat_legacy_missing_parts",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_legacy",
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: "chat_legacy_missing_parts",
      from: "+15551230000",
      from_handle: {
        handle: "+15551230000",
        id: "handle_sender_legacy",
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: "msg_legacy_missing_parts",
        parts: null,
      },
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_owner_legacy",
        is_me: true,
        service: "SMS",
      },
      service: "SMS",
    },
    event_id: "evt_missing_legacy_parts",
    event_type: "message.received",
    webhook_version: "2025-01-01",
  };

  assert.deepEqual(parseLinqMessageReceivedEvent(currentEvent).data.message.parts, []);
  assert.deepEqual(parseLinqMessageReceivedEvent(legacyEvent).data.message.parts, []);
  assert.deepEqual(inspectLinqMessageReceivedParts(currentEvent), {
    compatibilityFallback: true,
    dataKind: "object",
    messageKind: "missing",
    nestedActionPresent: false,
    partCount: null,
    partKinds: null,
    partsKind: "missing",
    partsLocation: "data.parts",
    payloadShape: "current-top-level",
    topLevelActionPresent: false,
    unsupportedPartCount: 0,
  });
  assert.deepEqual(inspectLinqMessageReceivedParts(legacyEvent), {
    compatibilityFallback: true,
    dataKind: "object",
    messageKind: "object",
    nestedActionPresent: false,
    partCount: null,
    partKinds: null,
    partsKind: "null",
    partsLocation: "data.message.parts",
    payloadShape: "legacy-nested",
    topLevelActionPresent: false,
    unsupportedPartCount: 0,
  });
});

test("parseLinqMessageReceivedEvent retains only iMessage app fallback content", () => {
  const rawEvent = buildV2026MessageReceivedWebhook({
    data: {
      parts: [{
        app: {
          bundle_id: "com.example.private",
          name: "Private app name",
        },
        fallback_text: "Completed the check-in",
        layout: {
          caption: "Private card metadata",
        },
        type: "imessage_app",
        url: "https://example.test/private-capability",
      }],
    },
    eventId: "evt_imessage_app",
  });
  const event = parseLinqMessageReceivedEvent(rawEvent);

  assert.deepEqual(event.data.message.parts, [{
    fallback_text: "Completed the check-in",
    type: "imessage_app",
  }]);
  assert.equal(buildLinqMessageText(event.data.message.parts), "Completed the check-in");
  assert.deepEqual(inspectLinqMessageReceivedParts(rawEvent), {
    compatibilityFallback: false,
    dataKind: "object",
    messageKind: "missing",
    nestedActionPresent: false,
    partCount: 1,
    partKinds: "imessage_app",
    partsKind: "array",
    partsLocation: "data.parts",
    payloadShape: "current-top-level",
    topLevelActionPresent: false,
    unsupportedPartCount: 0,
  });
  assert.deepEqual(
    (minimizeLinqMessageReceivedEvent(event).data as { message: { parts: unknown[] } })
      .message.parts,
    [{
      fallback_text: "Completed the check-in",
      type: "imessage_app",
    }],
  );
  assert.equal(buildLinqMessageText([{ type: "imessage_app" }]), "[iMessage app]");
});

test("parseLinqMessageReceivedEvent rejects non-array message parts", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          data: {
            parts: "nope",
          },
          eventId: "evt_bad_parts",
        }),
      }),
    /message\.parts must be an array, null, or absent/u,
  );
});

test("parseLinqMessageReceivedEvent rejects missing message ids", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
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

test("parseLinqMessageReceivedEvent rejects invalid directions", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          data: {
            direction: "sideways",
          },
          eventId: "evt_bad_direction",
        }),
      }),
    /direction must be "inbound" or "outbound"/u,
  );

  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        api_version: "v3",
        created_at: "2026-04-04T01:02:03.000Z",
        data: {
          chat: {
            id: "chat_missing_direction",
            owner_handle: {
              handle: "+15557654321",
              id: "handle_owner_missing_direction",
              is_me: true,
              service: "SMS",
            },
          },
          chat_id: "chat_missing_direction",
          from: "+15551230000",
          message: {
            id: "msg_missing_direction",
            parts: [],
          },
          sender_handle: {
            handle: "+15551230000",
            id: "sender_missing_direction",
            service: "SMS",
          },
        },
        event_id: "evt_missing_direction",
        event_type: "message.received",
      }),
    /is_from_me must be a boolean/u,
  );

  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        api_version: "v3",
        created_at: "2026-04-04T01:02:03.000Z",
        data: {
          chat: {
            id: "chat_mismatched_direction",
            owner_handle: {
              handle: "+15557654321",
              id: "handle_owner_mismatched_direction",
              is_me: true,
              service: "SMS",
            },
          },
          chat_id: "chat_mismatched_direction",
          direction: "outbound",
          from: "+15551230000",
          is_from_me: false,
          message: {
            id: "msg_mismatched_direction",
            parts: [],
          },
          sender_handle: {
            handle: "+15551230000",
            id: "sender_mismatched_direction",
            service: "SMS",
          },
          service: "SMS",
        },
        event_id: "evt_mismatched_direction",
        event_type: "message.received",
      }),
    /must match direction/u,
  );
});

test("parseLinqMessageReceivedEvent rejects invalid timestamps", () => {
  assert.throws(
    () =>
      parseLinqMessageReceivedEvent({
        ...buildV2026MessageReceivedWebhook({
          createdAt: "not-a-date",
          data: {
            sent_at: "also-not-a-date",
          },
          eventId: "evt_bad_timestamp",
        }),
      }),
    /Invalid ISO timestamp: (not-a-date|also-not-a-date) \(missing time zone\)/u,
  );
});

test("parseLinqMessageEditedEvent validates the v2026 replacement contract", () => {
  const event = parseLinqMessageEditedEvent(buildMessageEditedWebhook());

  assert.equal(event.event_type, "message.edited");
  assert.equal(event.data.chat.id, "chat_edit");
  assert.equal(event.data.direction, "inbound");
  assert.equal(event.data.id, "msg_edit");
  assert.deepEqual(event.data.part, {
    index: 1,
    text: "corrected text",
  });
  assert.equal(event.data.sender_handle.handle, "+15551234567");
});

test("minimizeLinqWebhookEvent keeps edit correlation but drops replacement text", () => {
  const minimized = minimizeLinqWebhookEvent(buildMessageEditedWebhook());

  assert.equal(JSON.stringify(minimized).includes("corrected text"), false);
  assert.deepEqual((minimized.data as Record<string, unknown>).part, {
    index: 1,
  });
});

test.each([
  {
    mutate(event: LinqWebhookEvent) {
      event.webhook_version = "2025-01-01";
    },
    pattern: /webhook_version/u,
  },
  {
    mutate(event: LinqWebhookEvent) {
      (event.data as { part: { index: number } }).part.index = -1;
    },
    pattern: /non-negative int32/u,
  },
  {
    mutate(event: LinqWebhookEvent) {
      (event.data as { part: { text: string } }).part.text = "";
    },
    pattern: /1-10000 characters/u,
  },
  {
    mutate(event: LinqWebhookEvent) {
      (event.data as { part: { text: string } }).part.text = "x".repeat(10_001);
    },
    pattern: /1-10000 characters/u,
  },
  {
    mutate(event: LinqWebhookEvent) {
      (event.data as { edited_at: string }).edited_at = "2026-07-28T18:00:01";
    },
    pattern: /must include a timezone/u,
  },
])("parseLinqMessageEditedEvent rejects malformed edit payloads", ({ mutate, pattern }) => {
  const event = buildMessageEditedWebhook();
  mutate(event);
  assert.throws(() => parseLinqMessageEditedEvent(event), pattern);
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}

function buildMessageEditedWebhook(): LinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: "2026-07-28T18:00:02.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_edit",
        is_group: false,
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_edit",
          is_me: true,
          service: "iMessage",
        },
      },
      direction: "inbound",
      edited_at: "2026-07-28T18:00:01.000Z",
      id: "msg_edit",
      part: {
        index: 1,
        text: "corrected text",
      },
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_edit",
        is_me: false,
        service: "iMessage",
      },
    },
    event_id: "evt_edit",
    event_type: "message.edited",
  };
}

function buildV2026MessageReceivedWebhook(input: {
  createdAt?: string;
  data?: Record<string, unknown>;
  eventId?: string;
  traceId?: string | null;
} = {}): LinqWebhookEvent {
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

test("parseLinqMessageReceivedEvent coerces stringly-typed is_group flags", () => {
  const buildPayload = (isGroup: unknown) => ({
    api_version: "v3",
    created_at: "2026-04-04T01:02:03.000Z",
    data: {
      chat: {
        id: "chat_flag_drift",
        is_group: isGroup,
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_flag_drift",
          is_me: true,
          service: "iMessage",
        },
      },
      direction: "inbound",
      id: "msg_flag_drift",
      parts: [
        {
          type: "text",
          value: "hello",
        },
      ],
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_flag_drift",
        service: "iMessage",
      },
      sent_at: "2026-04-04T01:02:00.000Z",
      service: "iMessage",
    },
    event_id: "evt_flag_drift",
    event_type: "message.received",
  });

  assert.equal(
    parseLinqMessageReceivedEvent(buildPayload("True")).data.chat?.is_group,
    true,
  );
  assert.equal(
    parseLinqMessageReceivedEvent(buildPayload("false")).data.chat?.is_group,
    false,
  );
  assert.equal(
    parseLinqMessageReceivedEvent(buildPayload(1)).data.chat?.is_group,
    undefined,
  );
  assert.equal(
    parseLinqMessageReceivedEvent(buildPayload("yes")).data.chat?.is_group,
    undefined,
  );
});
