import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  normalizeLinqWebhookEvent,
  toLinqChatMessage,
} from "../src/index.ts";

import { buildV2026LinqWebhookEvent } from "./linq-test-helpers.ts";

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
            id: "att_1",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size_bytes: 4,
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
              size_bytes: 1024,
              type: "media",
              url: "https://cdn.linqapp.com/media/photo-1.heic",
            },
            {
              filename: "photo-2.jpg",
              mime_type: "image/jpeg",
              size_bytes: 2048,
              type: "media",
              url: "https://cdn.linqapp.com/media/photo-2.jpg",
            },
            {
              id: "att_voice_1",
              mime_type: "audio/m4a",
              size_bytes: 4096,
              type: "media",
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
              id: "att_voice_2",
              mime_type: "audio/amr",
              size_bytes: 512,
              type: "media",
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
      externalId: "att_voice_2",
      fileName: "voice-2.amr",
      kind: "audio",
      mime: "audio/amr",
    },
  ]);
});

test("normalizeLinqWebhookEvent accepts minimized canonical Linq events from hosted storage", async () => {
  const canonical = {
    api_version: "v3",
    created_at: "2026-04-02T04:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_stored",
        owner_handle: {
          handle: "hbid:linq.recipient:v1:test",
          id: "handle_owner_stored",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: "chat_stored",
      direction: "inbound",
      from: "hbid:linq.from:v1:test",
      from_handle: {
        handle: "hbid:linq.from:v1:test",
        id: "handle_sender_stored",
        service: "iMessage",
      },
      is_from_me: false,
      message: {
        id: "hbid:linq.message:v1:test",
        parts: [
          {
            type: "text",
            value: "Stored webhook snapshot",
          },
        ],
      },
      received_at: "2026-04-02T04:00:01.000Z",
      sender_handle: {
        handle: "hbid:linq.from:v1:test",
        id: "handle_sender_stored",
        service: "iMessage",
      },
      service: "iMessage",
    },
    event_id: "evt_stored",
    event_type: "message.received",
  } as const;

  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    event: canonical,
  });

  assert.equal(capture.externalId, "linq:hbid:linq.message:v1:test");
  assert.equal(capture.accountId, "hbidx:phone:v1:test");
  assert.equal(capture.thread.id, "chat_stored");
  assert.equal(capture.text, "Stored webhook snapshot");
  assert.equal(capture.raw.event_type, "message.received");
});

test("toLinqChatMessage validates stable message and chat ids", async () => {
  await assert.rejects(
    () =>
      toLinqChatMessage({
        event: buildV2026LinqWebhookEvent({
          data: {
            chat_id: "chat_missing_message_id",
            message: {
              id: "   ",
              parts: [],
            },
          },
        }) as never,
      }),
    /stable message id/u,
  );

  await assert.rejects(
    () =>
      toLinqChatMessage({
        event: buildV2026LinqWebhookEvent({
          data: {
            chat_id: "  ",
            message: {
              id: "msg_missing_chat_id",
              parts: [],
            },
          },
        }) as never,
      }),
    /stable chat id/u,
  );
});

test("toLinqChatMessage infers filenames, kinds, byte sizes, and timestamp fallbacks", async () => {
  const now = new Date("2026-04-03T01:02:03.000Z");
  vi.useFakeTimers();
  vi.setSystemTime(now);

  try {
    const message = await toLinqChatMessage({
      event: buildV2026LinqWebhookEvent({
        createdAt: "   ",
        data: {
          chat_id: "chat_inference",
          from: "   ",
          message: {
            id: "msg_inference",
            parts: [
              {
                attachment_id: "media_1",
                size: -1,
                type: "media",
                url: "https://cdn.example.test/report.pdf",
              },
              {
                mime_type: "video/mp4",
                size: Number.NaN,
                type: "media",
                url: "not a url",
              },
              {
                filename: "notes.txt",
                size: 12.8,
                type: "media",
              },
              {
                attachment_id: "voice_1",
                mime_type: "audio/amr",
                type: "voice_memo",
              },
              {
                mime_type: "application/octet-stream",
                type: "voice_memo",
              },
            ],
          },
          recipient_phone: "   ",
          received_at: "   ",
          service: "   ",
        },
      }) as never,
      downloadDriver: {
        async downloadUrl(url) {
          if (url.endsWith("report.pdf")) {
            return new Uint8Array([1, 2, 3]);
          }

          throw new Error(`unexpected download: ${url}`);
        },
      },
    });

    assert.equal(message.thread.title, null);
    assert.equal(message.occurredAt, now.toISOString());
    assert.equal(message.receivedAt, null);
    assert.deepEqual(
      message.attachments.map((attachment) => ({
        byteSize: attachment.byteSize,
        externalId: attachment.externalId,
        fileName: attachment.fileName,
        kind: attachment.kind,
      })),
      [
        {
          byteSize: 3,
          externalId: "media_1",
          fileName: "report.pdf",
          kind: "document",
        },
        {
          byteSize: null,
          externalId: "part:2",
          fileName: null,
          kind: "video",
        },
        {
          byteSize: 12,
          externalId: "part:3",
          fileName: "notes.txt",
          kind: "document",
        },
        {
          byteSize: null,
          externalId: "voice_1",
          fileName: "voice-memo-voice_1.amr",
          kind: "audio",
        },
        {
          byteSize: null,
          externalId: "part:5",
          fileName: "voice-memo-part-5.m4a",
          kind: "audio",
        },
      ],
    );
  } finally {
    vi.useRealTimers();
  }
});

test("toLinqChatMessage uses service-only thread titles and timed-out downloads degrade to metadata", async () => {
  let aborted = false;

  const message = await toLinqChatMessage({
    event: buildV2026LinqWebhookEvent({
      data: {
        chat_id: "chat_service_only",
        from: "   ",
        message: {
          id: "msg_service_only",
          parts: [
            {
              attachment_id: "voice_timeout",
              mime_type: "audio/wav",
              type: "voice_memo",
              url: "https://cdn.example.test/voice-timeout",
            },
            {
              attachment_id: "other_attachment",
              filename: "archive.bin",
              type: "media",
            },
          ],
        },
        recipient_phone: "   ",
        service: "iMessage",
      },
    }) as never,
    attachmentDownloadTimeoutMs: 0,
    downloadDriver: {
      async downloadUrl(_url, signal) {
        return await new Promise<Uint8Array>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
    },
  });

  assert.equal(aborted, true);
  assert.equal(message.thread.title, "iMessage");
  assert.deepEqual(
    message.attachments.map((attachment) => ({
      data: attachment.data,
      fileName: attachment.fileName,
      kind: attachment.kind,
    })),
    [
      {
        data: null,
        fileName: "voice-timeout",
        kind: "audio",
      },
      {
        data: null,
        fileName: "archive.bin",
        kind: "other",
      },
    ],
  );
});
