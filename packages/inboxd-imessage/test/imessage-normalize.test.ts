import assert from "node:assert/strict";

import { test } from "vitest";

import {
  normalizeImessageAttachment,
  normalizeImessageMessage,
} from "../src/normalize.ts";

test("normalizeImessageMessage does not treat dateRead as receivedAt", () => {
  const capture = normalizeImessageMessage({
    message: {
      guid: "im-read-only",
      chatGuid: "chat-read-only",
      date: "2026-03-13T10:00:00.000Z",
      dateRead: "2026-03-13T10:05:00.000Z",
    },
  });

  assert.equal(capture.receivedAt, null);
});

test("normalizeImessageMessage prefers received and delivered timestamps over read timestamps", () => {
  const fromReceived = normalizeImessageMessage({
    message: {
      guid: "im-received",
      chatGuid: "chat-received",
      date: "2026-03-13T10:00:00.000Z",
      dateReceived: "2026-03-13T10:01:00.000Z",
      dateDelivered: "2026-03-13T10:02:00.000Z",
      dateRead: "2026-03-13T10:03:00.000Z",
    },
  });
  const fromDelivered = normalizeImessageMessage({
    message: {
      guid: "im-delivered",
      chatGuid: "chat-delivered",
      date: "2026-03-13T10:00:00.000Z",
      dateDelivered: "2026-03-13T10:02:00.000Z",
      dateRead: "2026-03-13T10:03:00.000Z",
    },
  });
  const fallbackAfterInvalid = normalizeImessageMessage({
    message: {
      guid: "im-fallback",
      chatGuid: "chat-fallback",
      date: "2026-03-13T10:00:00.000Z",
      dateReceived: "",
      dateDelivered: "2026-03-13T10:04:00.000Z",
    },
  });

  assert.equal(fromReceived.receivedAt, "2026-03-13T10:01:00.000Z");
  assert.equal(fromDelivered.receivedAt, "2026-03-13T10:02:00.000Z");
  assert.equal(fallbackAfterInvalid.receivedAt, "2026-03-13T10:04:00.000Z");
});

test("normalizeImessageAttachment and normalizeImessageMessage cover attachment kinds, direct-chat heuristics, and missing identifier failures", () => {
  assert.deepEqual(
    normalizeImessageAttachment({
      guid: "att-audio",
      transferName: "voice-note.m4a",
      mimeType: "audio/mpeg",
      size: 12,
      data: new Uint8Array([1, 2]),
    }),
    {
      externalId: "att-audio",
      kind: "audio",
      mime: "audio/mpeg",
      originalPath: null,
      fileName: "voice-note.m4a",
      byteSize: 12,
      data: new Uint8Array([1, 2]),
    },
  );

  const capture = normalizeImessageMessage({
    accountId: null,
    chat: {
      participantCount: 3,
      title: "Project Group",
    },
    message: {
      guid: "imessage-1",
      date: "2026-04-08T12:00:00.000Z",
      chatId: "chat-1",
      from: "+15551230000",
      senderName: "Casey",
      fromMe: true,
      attributedBody: "Group update",
      attachments: [
        {
          id: "att-doc",
          filename: "notes.pdf",
          mime: "application/pdf",
          type: "document",
          path: "/tmp/notes.pdf",
          byteSize: 20,
        },
      ],
    },
  });

  assert.equal(capture.accountId, null);
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.thread.title, "Project Group");
  assert.equal(capture.actor.id, "+15551230000");
  assert.equal(capture.actor.displayName, "Casey");
  assert.equal(capture.actor.isSelf, true);
  assert.equal(capture.text, "Group update");
  assert.equal(capture.attachments[0]?.kind, "document");
  assert.equal(capture.attachments[0]?.originalPath, "/tmp/notes.pdf");

  assert.throws(
    () =>
      normalizeImessageMessage({
        message: {
          chatId: "chat-1",
        },
      }),
    /stable external id/u,
  );
  assert.throws(
    () =>
      normalizeImessageMessage({
        message: {
          guid: "imessage-no-thread",
        },
      }),
    /stable thread id/u,
  );
});

test("normalizeImessageMessage trims text, allowlists raw fields, and redacts sensitive metadata", () => {
  const capture = normalizeImessageMessage({
    message: {
      guid: "im-raw-1",
      chatGuid: "chat-raw-1",
      text: "  hello from raw  ",
      date: new Date("2026-03-13T10:00:00.000Z"),
      displayName: "Friend",
      authorization: "Bearer <AUTH_SECRET>",
      attachments: [
        {
          guid: "att-raw-1",
          fileName: "photo.heic",
          path: "/Users/<REDACTED_USER>/Library/Messages/Attachments/photo.heic",
          mimeType: "image/heic",
          api_key: "<API_KEY>",
        },
      ],
      nested: {
        childKey: new Date("2026-03-13T10:00:01.000Z"),
      },
    },
    chat: {
      participantCount: 3,
    },
  });

  assert.equal(capture.text, "hello from raw");
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.raw.display_name, "Friend");
  assert.equal(capture.raw.date, "2026-03-13T10:00:00.000Z");
  assert.deepEqual(capture.raw.attachments, [
    {
      guid: "att-raw-1",
      file_name: "photo.heic",
      path: "<REDACTED_PATH>",
      mime_type: "image/heic",
    },
  ]);
  assert.equal("authorization" in capture.raw, false);
  assert.equal("nested" in capture.raw, false);
});

test("normalizeImessageMessage treats non-string text payloads as null", () => {
  const malformedMessage = JSON.parse(
    JSON.stringify({
      guid: "im-raw-2",
      chatGuid: "chat-raw-2",
      text: 42,
      date: "2026-03-13T10:02:00.000Z",
    }),
  );

  const capture = normalizeImessageMessage({
    message: malformedMessage,
  });

  assert.equal(capture.text, null);
});
