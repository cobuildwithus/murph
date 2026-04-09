import assert from "node:assert/strict";
import { test } from "vitest";
import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";

import {
  buildEmailMessageText,
  createAgentmailApiPollDriver,
  inferAttachmentKind,
  inferDirectEmailThreadFromParticipants,
  normalizeParsedEmailMessage,
  parseRawEmailMessage,
  readRawEmailHeaderValue,
  splitEmailAddressList,
  type AgentmailFetch,
  type ParsedEmailMessage,
} from "../src/index.ts";

test("email helpers cover participant heuristics, attachment kinds, and text fallbacks", () => {
  assert.equal(
    inferDirectEmailThreadFromParticipants({
      accountAddress: "assistant@example.test",
      from: "assistant@example.test",
      to: ["alice@example.test", "bob@example.test"],
    }),
    false,
  );
  assert.equal(
    inferDirectEmailThreadFromParticipants({
      from: "alice@example.test",
      to: ["bob@example.test", "carol@example.test"],
    }),
    false,
  );
  assert.equal(
    inferDirectEmailThreadFromParticipants({
      accountAddress: "assistant@example.test",
      to: ["not-an-email"],
    }),
    true,
  );

  assert.equal(inferAttachmentKind({ content_type: "audio/mpeg", filename: null }), "audio");
  assert.equal(inferAttachmentKind({ content_type: "video/mp4", filename: null }), "video");
  assert.equal(inferAttachmentKind({ content_type: "application/zip", filename: "archive.zip" }), "other");

  assert.equal(
    buildEmailMessageText({
      extractedText: null,
      extractedHtml: "<style>body{}</style><p>Hello<br>there</p>",
      text: null,
      html: null,
      preview: null,
    }),
    "Hello\nthere",
  );
  assert.equal(
    buildEmailMessageText({
      extractedText: "  ",
      extractedHtml: null,
      text: "  ",
      html: null,
      preview: "Preview fallback",
    }),
    "Preview fallback",
  );
});

test("createAgentmailApiPollDriver validates configuration and optional routes", async () => {
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: " ",
        inboxId: "inbox_123",
        fetchImplementation: async () => {
          throw new Error("unreachable");
        },
      }),
    /API key/u,
  );
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: "am_test_123",
        inboxId: " ",
        fetchImplementation: async () => {
          throw new Error("unreachable");
        },
      }),
    /inbox id/u,
  );
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: "am_test_123",
        inboxId: "inbox_123",
        baseUrl: "   ",
        fetchImplementation: async () => {
          throw new Error("unreachable");
        },
      }),
    /base URL/u,
  );

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    assert.throws(
      () =>
        createAgentmailApiPollDriver({
          apiKey: "am_test_123",
          inboxId: "inbox_123",
        }),
      /fetch support/u,
    );
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
  }

  const requests: Array<{ method: string; url: string; body?: string }> = [];
  const fetchImplementation: AgentmailFetch = async (url, init) => {
    requests.push({
      method: init.method,
      url,
      body: init.body,
    });

    if (url.endsWith("/messages?limit=1&ascending=true&labels=unread")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ message_id: "msg_1" }] }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    if (url.endsWith("/messages/msg_1")) {
      if (init.method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: "msg_1", thread_id: "thread_1" }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ message_id: "msg_1", labels: ["read", "processed"] }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    if (url.endsWith("/attachments/att_1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          attachment_id: "att_1",
          download_url: "  ",
        }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    if (url.endsWith("/threads/thread_1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ thread_id: "thread_1", subject: "Lunch" }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    if (url.endsWith("/messages/msg_error")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => JSON.stringify({ detail: "try again later" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    throw new Error(`Unexpected request ${init.method} ${url}`);
  };

  const driver = createAgentmailApiPollDriver({
    apiKey: "am_test_123",
    inboxId: "inbox_123",
    baseUrl: "https://mail.example.test/v0/",
    fetchImplementation,
  });

  const unread = await driver.listUnreadMessages({ limit: 0 });
  const message = await driver.getMessage?.({ messageId: "msg_1" });
  await driver.markProcessed({ messageId: "msg_1" });
  const attachment = await driver.downloadAttachment({
    attachmentId: "att_1",
    messageId: "msg_1",
  });
  const thread = await driver.getThread?.({ threadId: "thread_1" });

  assert.deepEqual(unread, [{ message_id: "msg_1" }]);
  assert.deepEqual(message, { message_id: "msg_1", thread_id: "thread_1" });
  assert.equal(attachment, null);
  assert.deepEqual(thread, { thread_id: "thread_1", subject: "Lunch" });
  assert.deepEqual(
    requests.map((request) => [request.method, request.url, request.body] as const),
    [
      ["GET", "https://mail.example.test/v0/inboxes/inbox_123/messages?limit=1&ascending=true&labels=unread", undefined],
      ["GET", "https://mail.example.test/v0/inboxes/inbox_123/messages/msg_1", undefined],
      [
        "PATCH",
        "https://mail.example.test/v0/inboxes/inbox_123/messages/msg_1",
        JSON.stringify({
          add_labels: ["read", "processed"],
          remove_labels: ["unread"],
        }),
      ],
      ["GET", "https://mail.example.test/v0/inboxes/inbox_123/messages/msg_1/attachments/att_1", undefined],
      ["GET", "https://mail.example.test/v0/threads/thread_1", undefined],
    ],
  );

  assert.ok(driver.getMessage);
  await assert.rejects(
    driver.getMessage({ messageId: "msg_error" }),
    /try again later/u,
  );
});

test("parseRawEmailMessage handles repeated headers, quoted address lists, and inline attachments", async () => {
  const repeatedSubjectRaw = [
    "Subject: First",
    "Subject: Second",
    "",
    "Body",
  ].join("\r\n");
  assert.deepEqual(readRawEmailHeaderValue(repeatedSubjectRaw, "subject"), {
    repeated: true,
    value: null,
  });
  assert.deepEqual(
    splitEmailAddressList('"Alice, Example" <alice@example.test>, Bob <bob@example.test>'),
    ['"Alice, Example" <alice@example.test>', "Bob <bob@example.test>"],
  );

  const raw = [
    "From: Alice Example <alice@example.test>",
    "Reply-To: reply@example.test, assistant@example.test, teammate@example.test, teammate@example.test",
    "To: assistant@example.test, teammate@example.test",
    "Cc: teammate@example.test, helper@example.test",
    "Subject: =?utf-8?Q?Daily_=26_status?=",
    "Message-ID: msg-inline-123@example.test",
    "References: ref-inline-001@example.test",
    'Content-Type: multipart/mixed; boundary="inline42"',
    "",
    "--inline42",
    'Content-Type: text/html; charset="utf-8"',
    "",
    "<p>Status update</p>",
    "--inline42",
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: inline; filename="note.txt"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Line=201",
    "--inline42--",
    "",
  ].join("\r\n");

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed.subject, "Daily & status");
  assert.equal(parsed.messageId, "msg-inline-123@example.test");
  assert.deepEqual(parsed.references, ["ref-inline-001@example.test"]);
  assert.equal(parsed.html, "<p>Status update</p>");
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0]?.fileName, "note.txt");
  assert.equal(new TextDecoder().decode(parsed.attachments[0]?.data ?? new Uint8Array()), "Line 1");

  const capture = await normalizeParsedEmailMessage({
    accountAddress: "assistant@example.test",
    accountId: "assistant@example.test",
    message: parsed,
    selfAddresses: ["assistant@example.test", "teammate@example.test"],
  });
  const threadTarget = parseHostedEmailThreadTarget(capture.thread.id);

  assert.equal(capture.thread.isDirect, false);
  assert.equal(threadTarget?.to[0], "reply@example.test");
  assert.deepEqual(threadTarget?.cc, ["helper@example.test"]);
});

test("normalizeParsedEmailMessage falls back to deterministic external ids when the message id is missing", async () => {
  const message: ParsedEmailMessage = {
    attachments: [],
    bcc: [],
    cc: [],
    from: "Alice Example <alice@example.test>",
    headers: {},
    html: null,
    inReplyTo: null,
    messageId: null,
    occurredAt: "2026-03-26T12:00:00.000Z",
    rawHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    rawSize: 42,
    receivedAt: null,
    references: [],
    replyTo: [],
    subject: "Fallback id",
    text: "Hello",
    to: ["assistant@example.test"],
  };

  const capture = await normalizeParsedEmailMessage({
    accountAddress: "assistant@example.test",
    accountId: "assistant@example.test",
    message,
  });

  assert.equal(capture.externalId, "email:1234567890abcdef12345678");
});
