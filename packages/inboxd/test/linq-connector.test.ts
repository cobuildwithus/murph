import assert from "node:assert/strict";

import { test, vi } from "vitest";

import {
  normalizeHostedLinqConversationMessage,
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
  assert.deepEqual(capture.raw, {
    schema: "murph.linq-capture.v1",
    event_type: "message.received",
    event_id: "evt_123",
    chat_id: "chat_123",
    message_id: "msg_123",
    is_from_me: false,
    service: "SMS",
    text_part_count: 1,
    link_part_count: 0,
    media_part_count: 1,
    voice_memo_part_count: 0,
    reaction_eligible: false,
    attachments: [
      {
        type: "media",
        attachment_id: "att_1",
        mime_type: "image/jpeg",
        size: 4,
      },
    ],
  });
});

test("normalizeLinqWebhookEvent uses iMessage app fallback text without retaining card metadata", async () => {
  const capture = await normalizeLinqWebhookEvent({
    event: buildV2026LinqWebhookEvent({
      data: {
        parts: [{
          app: {
            bundle_id: "com.example.private",
            name: "Private app name",
          },
          fallback_text: "Completed the check-in",
          layout: {
            caption: "Private layout metadata",
          },
          type: "imessage_app",
          url: "https://example.test/private-capability",
        }],
        service: "iMessage",
      },
      eventId: "evt_imessage_app",
    }),
  });

  assert.equal(capture.text, "Completed the check-in");
  assert.deepEqual(capture.attachments, []);
  assert.equal(capture.raw.imessage_app_part_count, 1);
  assert.doesNotMatch(JSON.stringify(capture.raw), /private-capability|Private app name|Private layout metadata/u);
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

test("normalizeLinqWebhookEvent prefers recipient_phone over defaultAccountId when both are present", async () => {
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    event: buildV2026LinqWebhookEvent({
      data: {
        recipient_phone: "+15557654321",
      },
      eventId: "evt_recipient_phone_priority",
    }),
  });

  assert.equal(capture.accountId, "+15557654321");
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
      fileName: "attachment-part-1.amr",
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
  assert.equal(capture.accountId, "hbid:linq.recipient:v1:test");
  assert.equal(capture.thread.id, "chat_stored");
  assert.equal(capture.text, "Stored webhook snapshot");
  assert.deepEqual(capture.raw, {
    schema: "murph.linq-capture.v1",
    event_type: "message.received",
    event_id: "evt_stored",
    chat_id: "chat_stored",
    message_id: "hbid:linq.message:v1:test",
    is_from_me: false,
    service: "iMessage",
    text_part_count: 1,
    link_part_count: 0,
    media_part_count: 0,
    voice_memo_part_count: 0,
    reaction_eligible: true,
  });
});

test("normalizeLinqWebhookEvent prefers recipient_handle over chat.owner_handle when recipient_phone is absent", async () => {
  const canonical = {
    api_version: "v3",
    created_at: "2026-04-02T04:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_stored_precedence",
        owner_handle: {
          handle: "hbid:linq.owner:v1:test",
          id: "handle_owner_precedence",
          is_me: true,
          service: "iMessage",
        },
      },
      chat_id: "chat_stored_precedence",
      direction: "inbound",
      from: "hbid:linq.from:v1:test",
      from_handle: {
        handle: "hbid:linq.from:v1:test",
        id: "handle_sender_precedence",
        service: "iMessage",
      },
      is_from_me: false,
      message: {
        id: "hbid:linq.message.precedence:v1:test",
        parts: [],
      },
      recipient_handle: {
        handle: "hbid:linq.recipient:v1:test",
        id: "handle_recipient_precedence",
        is_me: true,
        service: "iMessage",
      },
      received_at: "2026-04-02T04:00:01.000Z",
      sender_handle: {
        handle: "hbid:linq.from:v1:test",
        id: "handle_sender_precedence",
        service: "iMessage",
      },
      service: "iMessage",
    },
    event_id: "evt_stored_precedence",
    event_type: "message.received",
  } as const;

  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    event: canonical,
  });

  assert.equal(capture.accountId, "hbid:linq.recipient:v1:test");
});

test("normalizeHostedLinqConversationMessage preserves hosted account ids and reply-thread message ids", async () => {
  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      async downloadUrl() {
        throw new Error("download should not run");
      },
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_real_123",
      parts: [
        {
          type: "text",
          value: "Stored hosted wake snapshot",
        },
      ],
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.equal(capture.accountId, "hbid:linq.recipient:v1:test");
  assert.equal(capture.externalId, "linq:msg_real_123");
  assert.equal(capture.thread.id, "chat_stored");
  assert.equal(capture.text, "Stored hosted wake snapshot");
});

test("normalizeHostedLinqConversationMessage preserves hosted group thread identity across senders", async () => {
  const first = await normalizeHostedLinqConversationMessage({
    accountId: "hbidx:phone:v1:route-account",
    linqMessage: {
      chatId: "chat_group_stored",
      from: "+15551110000",
      isFromMe: false,
      messageId: "msg_group_a",
      parts: [
        {
          type: "text",
          value: "first",
        },
      ],
      threadIsDirect: false,
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });
  const second = await normalizeHostedLinqConversationMessage({
    accountId: "hbidx:phone:v1:route-account",
    linqMessage: {
      chatId: "chat_group_stored",
      from: "+15552220000",
      isFromMe: false,
      messageId: "msg_group_b",
      parts: [
        {
          type: "text",
          value: "second",
        },
      ],
      threadIsDirect: false,
    },
    occurredAt: "2026-04-02T04:01:01.000Z",
  });

  assert.equal(first.accountId, second.accountId);
  assert.equal(first.thread.id, second.thread.id);
  assert.equal(first.thread.isDirect, false);
  assert.equal(second.thread.isDirect, false);
  assert.notEqual(first.actor.id, second.actor.id);
});

test("normalizeHostedLinqConversationMessage preserves reply metadata and metadata-only attachments when downloads fail", async () => {
  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      async downloadUrl(url) {
        assert.equal(url, "https://cdn.example.test/voice-note.m4a");
        throw new Error("download failed");
      },
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_reply_media_123",
      parts: [
        {
          type: "text",
          value: "See attached reply",
        },
        {
          attachmentId: "voice_att_1",
          fileName: "voice-note.m4a",
          mimeType: "audio/m4a",
          size: 4096,
          type: "voice_memo",
          url: "https://cdn.example.test/voice-note.m4a",
        },
      ],
      replyToMessageId: "msg_parent_123",
      replyToPartIndex: 1,
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.equal(capture.accountId, "hbid:linq.recipient:v1:test");
  assert.equal(capture.externalId, "linq:msg_reply_media_123");
  assert.equal(capture.thread.id, "chat_stored");
  assert.equal(capture.thread.title, "hbid:linq.from:v1:test (iMessage)");
  assert.equal(capture.text, "See attached reply");
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 4096,
      data: null,
      externalId: "voice_att_1",
      fileName: "voice-note.m4a",
      kind: "audio",
      mime: "audio/m4a",
    },
  ]);
  assert.deepEqual(capture.raw, {
    schema: "murph.linq-capture.v1",
    event_type: "message.received",
    chat_id: "chat_stored",
    message_id: "msg_reply_media_123",
    is_from_me: false,
    service: "iMessage",
    reply_to_message_id: "msg_parent_123",
    reply_to_part_index: 1,
    text_part_count: 1,
    link_part_count: 0,
    media_part_count: 0,
    voice_memo_part_count: 1,
    reaction_eligible: false,
    attachments: [
      {
        type: "voice_memo",
        attachment_id: "voice_att_1",
        mime_type: "audio/m4a",
        size: 4096,
      },
    ],
  });
});

test("normalizeHostedLinqConversationMessage hydrates metadata-only voice memos through downloadPart", async () => {
  const downloadPart = vi.fn(async (part: {
    attachmentId?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    type: "media" | "voice_memo";
    url?: string | null;
  }) => {
    assert.deepEqual(part, {
      attachmentId: "voice_att_download_part",
      fileName: "voice-note.m4a",
      mimeType: "audio/m4a",
      size: 4096,
      type: "voice_memo",
      url: null,
    });
    return Uint8Array.from([7, 8, 9]);
  });

  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      downloadPart,
      async downloadUrl() {
        throw new Error("downloadUrl should not run without a voice memo url");
      },
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_download_part_123",
      parts: [
        {
          attachmentId: "voice_att_download_part",
          fileName: "voice-note.m4a",
          mimeType: "audio/m4a",
          size: 4096,
          type: "voice_memo",
        },
      ],
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.equal(downloadPart.mock.calls.length, 1);
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 4096,
      data: Uint8Array.from([7, 8, 9]),
      externalId: "voice_att_download_part",
      fileName: "voice-note.m4a",
      kind: "audio",
      mime: "audio/m4a",
    },
  ]);
});

test("normalizeHostedLinqConversationMessage keeps generated hydrated voice filenames generic", async () => {
  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      async downloadPart() {
        return Uint8Array.from([7, 8, 9]);
      },
      async downloadUrl() {
        throw new Error("downloadUrl should not run without a voice memo url");
      },
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_download_part_private_id_123",
      parts: [
        {
          attachmentId: "voice_att_private_provider_id",
          mimeType: "audio/m4a",
          size: 4096,
          type: "voice_memo",
        },
      ],
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.deepEqual(capture.attachments, [
    {
      byteSize: 4096,
      data: Uint8Array.from([7, 8, 9]),
      externalId: "voice_att_private_provider_id",
      fileName: "voice-memo-part-1.m4a",
      kind: "audio",
      mime: "audio/m4a",
    },
  ]);
});

test("normalizeHostedLinqConversationMessage prefers downloadPart for url-backed attachments", async () => {
  const downloadUrl = vi.fn(async (url: string) => {
    assert.equal(url, "https://cdn.example.test/voice-note.m4a");
    throw new Error("downloadUrl should not run when downloadPart is available");
  });
  const downloadPart = vi.fn(async (part: {
    attachmentId?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    type: "media" | "voice_memo";
    url?: string | null;
  }) => {
    assert.deepEqual(part, {
      attachmentId: "voice_att_download_url_first",
      fileName: "voice-note.m4a",
      mimeType: "audio/m4a",
      size: 4096,
      type: "voice_memo",
      url: "https://cdn.example.test/voice-note.m4a",
    });
    return Uint8Array.from([1, 2, 3]);
  });

  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      downloadPart,
      downloadUrl,
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_download_url_first_123",
      parts: [
        {
          attachmentId: "voice_att_download_url_first",
          fileName: "voice-note.m4a",
          mimeType: "audio/m4a",
          size: 4096,
          type: "voice_memo",
          url: "https://cdn.example.test/voice-note.m4a",
        },
      ],
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.equal(downloadPart.mock.calls.length, 1);
  assert.equal(downloadUrl.mock.calls.length, 0);
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 4096,
      data: Uint8Array.from([1, 2, 3]),
      externalId: "voice_att_download_url_first",
      fileName: "voice-note.m4a",
      kind: "audio",
      mime: "audio/m4a",
    },
  ]);
});

test("normalizeHostedLinqConversationMessage uses downloadUrl when downloadPart is unavailable", async () => {
  const downloadUrl = vi.fn(async (url: string) => {
    assert.equal(url, "https://cdn.example.test/voice-note.m4a");
    return Uint8Array.from([4, 5, 6]);
  });

  const capture = await normalizeHostedLinqConversationMessage({
    accountId: "hbid:linq.recipient:v1:test",
    attachmentDownloadTimeoutMs: 5_000,
    downloadDriver: {
      downloadUrl,
    },
    linqMessage: {
      chatId: "chat_stored",
      from: "hbid:linq.from:v1:test",
      isFromMe: false,
      messageId: "msg_download_fallback_123",
      parts: [
        {
          attachmentId: "voice_att_download_fallback",
          fileName: "voice-note.m4a",
          mimeType: "audio/m4a",
          size: 4096,
          type: "voice_memo",
          url: "https://cdn.example.test/voice-note.m4a",
        },
      ],
      service: "iMessage",
    },
    occurredAt: "2026-04-02T04:00:01.000Z",
  });

  assert.equal(downloadUrl.mock.calls.length, 1);
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 4096,
      data: Uint8Array.from([4, 5, 6]),
      externalId: "voice_att_download_fallback",
      fileName: "voice-note.m4a",
      kind: "audio",
      mime: "audio/m4a",
    },
  ]);
});

test("normalizeHostedLinqConversationMessage bounds concurrent downloads with one deadline", async () => {
  vi.useFakeTimers();

  try {
    const started: string[] = [];
    const aborted: string[] = [];
    const downloadPart = vi.fn(async (part: {
      attachmentId?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      size?: number | null;
      type: "media" | "voice_memo";
      url?: string | null;
    }, signal?: AbortSignal) => {
      const attachmentId = part.attachmentId ?? "missing";
      started.push(attachmentId);
      return await new Promise<Uint8Array>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted.push(attachmentId);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    });

    const capturePromise = normalizeHostedLinqConversationMessage({
      accountId: "hbid:linq.recipient:v1:test",
      attachmentDownloadTimeoutMs: 10,
      downloadDriver: {
        downloadPart,
        async downloadUrl() {
          throw new Error("downloadUrl should not run when downloadPart is available");
        },
      },
      linqMessage: {
        chatId: "chat_stored",
        from: "hbid:linq.from:v1:test",
        isFromMe: false,
        messageId: "msg_multi_timeout_123",
        parts: [
          {
            attachmentId: "voice_att_one",
            mimeType: "audio/m4a",
            type: "voice_memo",
          },
          {
            attachmentId: "voice_att_two",
            mimeType: "audio/m4a",
            type: "voice_memo",
          },
          {
            attachmentId: "media_att_three",
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            type: "media",
          },
        ],
        service: "iMessage",
      },
      occurredAt: "2026-04-02T04:00:01.000Z",
    });

    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(started, ["voice_att_one", "voice_att_two"]);

    await vi.advanceTimersByTimeAsync(10);
    const capture = await capturePromise;

    assert.deepEqual(aborted.sort(), ["voice_att_one", "voice_att_two"]);
    assert.equal(downloadPart.mock.calls.length, 2);
    assert.deepEqual(
      capture.attachments.map((attachment) => ({
        data: attachment.data,
        externalId: attachment.externalId,
      })),
      [
        { data: null, externalId: "voice_att_one" },
        { data: null, externalId: "voice_att_two" },
        { data: null, externalId: "media_att_three" },
      ],
    );
  } finally {
    vi.useRealTimers();
  }
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
          fileName: "attachment-part-2",
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
          fileName: "voice-memo-part-4.amr",
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
              attachment_id: "voice_private_id_only",
              mime_type: "audio/m4a",
              type: "voice_memo",
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

  assert.equal(aborted, false);
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
        fileName: "voice-memo-part-1.wav",
        kind: "audio",
      },
      {
        data: null,
        fileName: "voice-memo-part-2.m4a",
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
