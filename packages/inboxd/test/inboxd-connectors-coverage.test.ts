import {
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildParsedEmailThreadTarget,
  resolveParsedEmailThreadKey,
} from "../src/connectors/email/normalize-parsed.ts";
import { normalizeHostedTelegramMessage } from "../src/connectors/telegram/normalize.ts";

import type {
  InboundAttachment,
  ParsedEmailMessage,
} from "../src/index.ts";
import {
  createInboundCaptureFromChatMessage,
  normalizeLinqWebhookEvent,
  normalizeParsedEmailMessage,
  normalizeTelegramUpdate,
  readRawEmailHeaderValue,
  splitEmailAddressList,
} from "../src/index.ts";
import { buildV2026LinqWebhookEvent } from "./linq-test-helpers.ts";

test("createInboundCaptureFromChatMessage preserves nullable chat fields", () => {
  const attachments: InboundAttachment[] = [
    {
      byteSize: 4,
      data: new Uint8Array([1, 2, 3, 4]),
      externalId: "att-1",
      fileName: "photo.jpg",
      kind: "image",
      mime: "image/jpeg",
    },
  ];

  const capture = createInboundCaptureFromChatMessage({
    source: "telegram",
    message: {
      externalId: "msg-2",
      thread: {
        id: "thread-1",
      },
      actor: {
        isSelf: true,
      },
      occurredAt: "2026-04-08T10:00:00.000Z",
      text: null,
      attachments,
      raw: {
        schema: "test",
      },
    },
  });

  assert.deepEqual(capture, {
    source: "telegram",
    externalId: "msg-2",
    accountId: null,
    thread: {
      id: "thread-1",
      title: null,
      isDirect: undefined,
    },
    actor: {
      id: null,
      displayName: null,
      isSelf: true,
    },
    occurredAt: "2026-04-08T10:00:00.000Z",
    receivedAt: null,
    text: null,
    attachments,
    raw: {
      schema: "test",
    },
  });
});

test("splitEmailAddressList preserves quoted commas and readRawEmailHeaderValue rejects repeated headers", () => {
  assert.deepEqual(
    splitEmailAddressList(
      '"Doe, Jane" <jane@example.test>, =?UTF-8?Q?Jos=C3=A9?= <jose@example.test>',
    ),
    [
      '"Doe, Jane" <jane@example.test>',
      "José <jose@example.test>",
    ],
  );

  const repeatedHeaderValue = readRawEmailHeaderValue([
    "Subject: First value",
    "Subject: Second value",
    "",
    "body",
  ].join("\r\n"), "subject");
  assert.deepEqual(repeatedHeaderValue, {
    repeated: true,
    value: null,
  });

  const singleHeaderValue = readRawEmailHeaderValue([
    "Subject: =?UTF-8?Q?Ol=C3=A1?=",
    "",
    "body",
  ].join("\r\n"), "subject");
  assert.deepEqual(singleHeaderValue, {
    repeated: false,
    value: "Olá",
  });
});

test("normalizeParsedEmailMessage builds fallback thread targets, dedupes reply-all recipients, and falls back to raw-hash external ids", async () => {
  const message: ParsedEmailMessage = {
    attachments: [
      {
        contentDisposition: "inline",
        contentId: "cid-photo",
        contentTransferEncoding: "base64",
        contentType: "image/png",
        data: new Uint8Array([1, 2, 3]),
        fileName: "photo.png",
      },
    ],
    bcc: [],
    cc: [
      "assistant@example.test",
      "Team Example <team@example.test>",
      "reply@example.test",
    ],
    from: "Assistant Alias <assistant+alias@example.test>",
    headers: {
      "x-trace-id": "trace-1",
    },
    html: "<p>Inline <strong>photo</strong> attached</p>",
    inReplyTo: "<prior@example.test>",
    messageId: null,
    occurredAt: "2026-04-08T11:30:00.000Z",
    rawHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    rawSize: 512,
    receivedAt: "2026-04-08T11:31:00.000Z",
    references: ["<root@example.test>", ""],
    replyTo: [
      "Reply Desk <reply@example.test>",
      "Team Example <team@example.test>",
      "assistant@example.test",
      "Reply Desk <reply@example.test>",
    ],
    subject: "  Inbox coverage  ",
    text: null,
    to: [
      "Customer Example <customer@example.test>",
      "assistant+alias@example.test",
    ],
  };

  const capture = await normalizeParsedEmailMessage({
    accountAddress: "assistant@example.test",
    accountId: "acct-email",
    message,
    selfAddresses: [
      "assistant+alias@example.test",
      "assistant@example.test",
      "ASSISTANT@example.test",
    ],
    source: "email-import",
    threadTarget: "not-a-valid-thread-target",
  });
  const threadTarget = parseHostedEmailThreadTarget(capture.thread.id);

  assert.equal(capture.source, "email-import");
  assert.equal(capture.accountId, "acct-email");
  assert.equal(capture.externalId, "email:0123456789abcdef01234567");
  assert.equal(capture.thread.title, "Inbox coverage");
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.actor.id, "assistant+alias@example.test");
  assert.equal(capture.actor.displayName, "Assistant Alias");
  assert.equal(capture.actor.isSelf, true);
  assert.equal(capture.receivedAt, "2026-04-08T11:31:00.000Z");
  assert.equal(capture.text, "Inline photo attached");
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.equal(capture.attachments[0]?.externalId, "cid-photo");
  assert.equal(capture.attachments[0]?.byteSize, 3);
  assert.deepEqual(threadTarget?.to, ["reply@example.test"]);
  assert.deepEqual(threadTarget?.cc, [
    "team@example.test",
    "customer@example.test",
  ]);
  assert.deepEqual(threadTarget?.references, [
    "<root@example.test>",
    "<prior@example.test>",
  ]);
  assert.equal(threadTarget?.subject, "Inbox coverage");
  assert.deepEqual(capture.raw, {
    attachment_count: 1,
    cc_count: 3,
    has_from: true,
    has_html: true,
    has_in_reply_to: true,
    has_subject: true,
    header_count: 1,
    raw_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    raw_size: 512,
    reference_count: 1,
    reply_to_count: 4,
    schema: "murph.email-parsed-capture.v1",
    to_count: 2,
  });
});

test("parsed email thread metadata exposes stable input keys and private reply targets", () => {
  const message: ParsedEmailMessage = {
    attachments: [],
    bcc: [],
    cc: ["team@example.test"],
    from: "Sender <sender@example.test>",
    headers: {},
    html: null,
    inReplyTo: "<prior@example.test>",
    messageId: "<current@example.test>",
    occurredAt: null,
    rawHash: "0".repeat(64),
    rawSize: 256,
    receivedAt: null,
    references: ["<root@example.test>", "<prior@example.test>"],
    replyTo: [],
    subject: "Threaded update",
    text: "hello",
    to: ["assistant@example.test"],
  };
  const threadTarget = parseHostedEmailThreadTarget(
    buildParsedEmailThreadTarget({
      accountAddress: "assistant@example.test",
      message,
    }),
  );

  assert.equal(
    resolveParsedEmailThreadKey({ message, rawMessageKey: "raw_123" }),
    "<root@example.test>",
  );
  assert.deepEqual(threadTarget?.to, ["sender@example.test"]);
  assert.deepEqual(threadTarget?.cc, ["team@example.test"]);
  assert.deepEqual(threadTarget?.references, [
    "<root@example.test>",
    "<prior@example.test>",
    "<current@example.test>",
  ]);
  assert.equal(threadTarget?.lastMessageId, "<current@example.test>");
  assert.equal(threadTarget?.subject, "Threaded update");
});

test("normalizeTelegramUpdate rejects unsupported payloads and normalizeHostedTelegramMessage infers multiple hosted attachment kinds", async () => {
  await assert.rejects(
    () =>
      normalizeTelegramUpdate({
        update: {
          update_id: 301,
        },
      }),
    /supported message payload/u,
  );

  const hosted = await normalizeHostedTelegramMessage({
    externalId: "evt-hosted-telegram-attachments",
    message: {
      messageId: "31",
      threadId: "-100555:topic:1",
      attachments: [
        {
          fileId: "doc-1",
          fileName: "lab.pdf",
          fileUniqueId: "doc-unique-1",
          kind: "document",
          mimeType: "application/pdf",
        },
        {
          fileId: "audio-1",
          fileUniqueId: "audio-unique-1",
          kind: "audio",
        },
        {
          fileId: "voice-1",
          fileUniqueId: "voice-unique-1",
          kind: "voice",
        },
        {
          fileId: "video-1",
          fileUniqueId: "video-unique-1",
          kind: "video",
        },
        {
          fileId: "video-note-1",
          fileUniqueId: "video-note-unique-1",
          kind: "video_note",
        },
        {
          fileId: "animation-1",
          fileUniqueId: "animation-unique-1",
          kind: "animation",
        },
        {
          fileId: "sticker-1",
          fileUniqueId: "sticker-unique-1",
          kind: "sticker",
        },
      ],
      text: "attachments",
    },
    occurredAt: "2026-04-08T12:30:00.000Z",
    downloadDriver: {
      async getFile(fileId) {
        return {
          file_id: fileId,
          file_path: `${fileId}.bin`,
        };
      },
      async downloadFile(filePath) {
        return new TextEncoder().encode(filePath);
      },
    },
  });

  assert.deepEqual(
    hosted.attachments.map((attachment) => attachment.kind),
    ["document", "audio", "audio", "video", "video", "video", "image"],
  );
  assert.deepEqual(
    hosted.attachments.map((attachment) => attachment.fileName),
    [
      "lab.pdf",
      "audio-audio-unique-1.bin",
      "voice-voice-unique-1.ogg",
      "video-video-unique-1.mp4",
      "video-note-video-note-unique-1.mp4",
      "animation-animation-unique-1.mp4",
      "sticker-sticker-unique-1.webp",
    ],
  );
  assert.equal(
    hosted.attachments.every((attachment) => attachment.data instanceof Uint8Array),
    true,
  );
});

test("normalizeTelegramUpdate collects non-photo attachment specs without downloads", async () => {
  const capture = await normalizeTelegramUpdate({
    update: {
      update_id: 302,
      message: {
        message_id: 32,
        date: 1_773_400_020,
        text: "mixed attachments",
        chat: {
          id: 55,
          type: "private",
          first_name: "Taylor",
        },
        from: {
          id: 222,
          first_name: "Taylor",
        },
        document: {
          file_id: "doc-2",
          file_unique_id: "doc-unique-2",
          mime_type: "application/pdf",
          file_name: "report.pdf",
        },
        audio: {
          file_id: "audio-2",
          file_unique_id: "audio-unique-2",
        },
        voice: {
          file_id: "voice-2",
          file_unique_id: "voice-unique-2",
        },
        video: {
          file_id: "video-2",
          file_unique_id: "video-unique-2",
        },
        animation: {
          file_id: "animation-2",
          file_unique_id: "animation-unique-2",
        },
        sticker: {
          file_id: "sticker-2",
          file_unique_id: "sticker-unique-2",
        },
      },
    },
  });

  assert.deepEqual(
    capture.attachments.map((attachment) => ({
      fileName: attachment.fileName,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
    })),
    [
      { fileName: "report.pdf", kind: "document", mime: "application/pdf" },
      { fileName: "audio-audio-unique-2.bin", kind: "audio", mime: "audio/mpeg" },
      { fileName: "voice-voice-unique-2.ogg", kind: "audio", mime: "audio/ogg" },
      { fileName: "video-video-unique-2.mp4", kind: "video", mime: "video/mp4" },
      { fileName: "animation-animation-unique-2.mp4", kind: "video", mime: "video/mp4" },
      { fileName: "sticker-sticker-unique-2.webp", kind: "image", mime: null },
    ],
  );
  assert.equal(
    capture.attachments.every((attachment) => attachment.data === undefined),
    true,
  );
});

test("normalizeLinqWebhookEvent keeps voice attachments when downloads fail", async () => {
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    downloadDriver: {
      async downloadUrl() {
        throw new Error("download failed");
      },
    },
    event: buildV2026LinqWebhookEvent({
      data: {
        chat: {
          id: "chat-voice",
          owner_handle: {
            handle: "+15557654321",
            id: "handle-owner-voice",
            is_me: true,
            service: "SMS",
          },
        },
        id: "msg-voice",
        parts: [
          {
            id: "att-voice",
            mime_type: "audio/amr",
            size_bytes: 512,
            type: "media",
            url: "https://cdn.example.test/voice.amr",
          },
        ],
        sender_handle: {
          handle: "+15551234567",
          id: "handle-sender-voice",
          service: "SMS",
        },
      },
      eventId: "evt-voice",
    }) as never,
  });

  assert.equal(capture.accountId, "+15557654321");
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 512,
      data: null,
      externalId: "att-voice",
      fileName: "attachment-part-1.amr",
      kind: "audio",
      mime: "audio/amr",
    },
  ]);
});
