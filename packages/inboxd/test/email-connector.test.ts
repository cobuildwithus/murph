import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createHostedEmailThreadTarget,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murph/runtime-state";

import {
  createAgentmailApiPollDriver,
  createEmailPollConnector,
  normalizeAgentmailMessage,
  normalizeParsedEmailMessage,
  parseRawEmailMessage,
  type AgentmailFetch,
  type InboundCapture,
  type PersistedCapture,
} from "../src/index.ts";

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

test("normalizeAgentmailMessage builds direct email captures and hydrates downloadable attachments", async () => {
  const capture = await normalizeAgentmailMessage({
    accountAddress: "murph@example.test",
    message: {
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      message_id: "msg_123",
      timestamp: "2026-03-22T10:00:00.000Z",
      from: "Alice Example <alice@example.test>",
      to: ["murph@example.test"],
      subject: "Lunch summary",
      extracted_text: "See attached.",
      attachments: [
        {
          attachment_id: "att_1",
          filename: "summary.pdf",
          content_type: "application/pdf",
          size: 4,
        },
      ],
    },
    downloadDriver: {
      async downloadAttachment({ attachmentId, messageId }) {
        assert.equal(attachmentId, "att_1");
        assert.equal(messageId, "msg_123");
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
  });

  assert.equal(capture.externalId, "email:msg_123");
  assert.equal(capture.thread.id, "thread_123");
  assert.equal(capture.thread.title, "Lunch summary");
  assert.equal(capture.thread.isDirect, true);
  assert.equal(capture.actor.id, "alice@example.test");
  assert.equal(capture.actor.displayName, "Alice Example");
  assert.equal(capture.actor.isSelf, false);
  assert.equal(capture.text, "See attached.");
  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.externalId, "att_1");
  assert.equal(capture.attachments[0]?.kind, "document");
  assert.equal(capture.attachments[0]?.data?.byteLength, 4);
});

test("normalizeAgentmailMessage keeps direct-thread detection when the inbox address is unknown", async () => {
  const capture = await normalizeAgentmailMessage({
    accountAddress: null,
    message: {
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      message_id: "msg_direct",
      from: "Alice Example <alice@example.test>",
      to: ["murph@example.test"],
      cc: [],
      bcc: [],
      text: "Ping",
    },
  });

  assert.equal(capture.thread.isDirect, true);
});

test("normalizeAgentmailMessage prefers extracted reply content over full-thread text fallbacks", async () => {
  const capture = await normalizeAgentmailMessage({
    accountAddress: "murph@example.test",
    message: {
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      message_id: "msg_extracted",
      from: "Alice Example <alice@example.test>",
      to: ["murph@example.test"],
      text: "Newest reply\n\nOn Mon, Murph wrote: quoted history",
      extracted_html: "<p>Newest reply</p>",
      html: "<div>Newest reply</div><blockquote>quoted history</blockquote>",
    },
  });

  assert.equal(capture.text, "Newest reply");
});

test("createEmailPollConnector backfills unread AgentMail messages and marks them processed", async () => {
  const processedMessageIds: string[] = [];
  const emitted: Array<{ capture: InboundCapture; checkpoint: Record<string, unknown> | null | undefined }> = [];
  let unreadMessages = [
    {
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      message_id: "msg_1",
      timestamp: "2026-03-22T10:00:00.000Z",
      from: "Alice <alice@example.test>",
      to: ["murph@example.test"],
      extracted_text: "first message",
    },
    {
      inbox_id: "inbox_123",
      thread_id: "thread_123",
      message_id: "msg_2",
      timestamp: "2026-03-22T10:05:00.000Z",
      from: "Alice <alice@example.test>",
      to: ["murph@example.test"],
      extracted_text: "second message",
    },
  ];
  const connector = createEmailPollConnector({
    accountAddress: "murph@example.test",
    accountId: "inbox_123",
    backfillLimit: 10,
    driver: {
      inboxId: "inbox_123",
      async listUnreadMessages() {
        return [...unreadMessages];
      },
      async getMessage({ messageId }) {
        return {
          inbox_id: "inbox_123",
          thread_id: "thread_123",
          message_id: messageId,
          timestamp:
            messageId === "msg_1"
              ? "2026-03-22T10:00:00.000Z"
              : "2026-03-22T10:05:00.000Z",
          from: "Alice <alice@example.test>",
          to: ["murph@example.test"],
          extracted_text: `${messageId} body`,
        };
      },
      async markProcessed({ messageId }) {
        processedMessageIds.push(messageId);
        unreadMessages = unreadMessages.filter((message) => message.message_id !== messageId);
      },
      async downloadAttachment() {
        return null;
      },
    },
  });

  const cursor = await connector.backfill(null, async (capture, checkpoint) => {
    emitted.push({ capture, checkpoint });
    return createPersistedCapture(capture);
  });

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0]?.capture.externalId, "email:msg_1");
  assert.equal(emitted[1]?.capture.externalId, "email:msg_2");
  assert.deepEqual(processedMessageIds, ["msg_1", "msg_2"]);
  assert.deepEqual(cursor, {
    occurredAt: "2026-03-22T10:05:00.000Z",
    externalId: "email:msg_2",
    receivedAt: "2026-03-22T10:05:00.000Z",
    messageId: "msg_2",
    threadId: "thread_123",
  });
});

test("createAgentmailApiPollDriver uses the AgentMail API routes for unread messages and attachment downloads", async () => {
  const requests: Array<{
    method: string;
    url: string;
  }> = [];
  const fetchImplementation: AgentmailFetch = async (url, init) => {
    requests.push({
      method: init.method,
      url,
    });

    if (url.endsWith("/messages?limit=2&ascending=true&labels=unread")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          count: 1,
          messages: [
            {
              inbox_id: "inbox_123",
              thread_id: "thread_123",
              message_id: "msg_1",
            },
          ],
        }),
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
          download_url: "https://download.example.test/att_1",
        }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => Uint8Array.from([9, 8, 7]).buffer,
    };
  };

  const driver = createAgentmailApiPollDriver({
    apiKey: "am_test_123",
    inboxId: "inbox_123",
    baseUrl: "https://mail.example.test/v0",
    fetchImplementation,
  });

  const messages = await driver.listUnreadMessages({ limit: 2 });
  const attachment = await driver.downloadAttachment({
    attachmentId: "att_1",
    messageId: "msg_1",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.message_id, "msg_1");
  assert.deepEqual(Array.from(attachment ?? []), [9, 8, 7]);
  assert.equal(
    requests[0]?.url,
    "https://mail.example.test/v0/inboxes/inbox_123/messages?limit=2&ascending=true&labels=unread",
  );
  assert.equal(
    requests[1]?.url,
    "https://mail.example.test/v0/inboxes/inbox_123/messages/msg_1/attachments/att_1",
  );
  assert.equal(requests[2]?.url, "https://download.example.test/att_1");
});


test("parseRawEmailMessage parses multipart email and normalizeParsedEmailMessage preserves hosted thread targets", async () => {
  const raw = [
    'From: Alice Example <alice@example.test>',
    'To: assistant@example.test',
    'Cc: Bob Example <bob@example.test>',
    'Subject: Weekly check-in',
    'Date: Thu, 26 Mar 2026 12:00:00 +0000',
    'Message-ID: <msg_123@example.test>',
    'In-Reply-To: <msg_122@example.test>',
    'References: <msg_100@example.test> <msg_122@example.test>',
    'Content-Type: multipart/mixed; boundary="boundary42"',
    '',
    '--boundary42',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Here is the latest update.',
    '--boundary42',
    'Content-Type: application/pdf; name="summary.pdf"',
    'Content-Disposition: attachment; filename="summary.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('pdf-data', 'utf8').toString('base64'),
    '--boundary42--',
    '',
  ].join('\r\n');

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed.messageId, '<msg_123@example.test>');
  assert.equal(parsed.inReplyTo, '<msg_122@example.test>');
  assert.deepEqual(parsed.references, ['<msg_100@example.test>', '<msg_122@example.test>']);
  assert.equal(parsed.text, 'Here is the latest update.');
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0]?.fileName, 'summary.pdf');

  const threadTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
    cc: ['bob@example.test'],
    lastMessageId: '<msg_122@example.test>',
    references: ['<msg_100@example.test>', '<msg_122@example.test>'],
    replyAliasAddress: 'assistant+reply@example.test',
    replyKey: 'reply_123',
    subject: 'Weekly check-in',
    to: ['alice@example.test'],
  }));
  const capture = await normalizeParsedEmailMessage({
    accountAddress: 'assistant@example.test',
    accountId: 'assistant@example.test',
    message: parsed,
    threadTarget,
  });

  assert.equal(capture.externalId, 'email:<msg_123@example.test>');
  assert.equal(capture.thread.id, threadTarget);
  assert.equal(capture.thread.title, 'Weekly check-in');
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.actor.id, 'alice@example.test');
  assert.equal(capture.actor.displayName, 'Alice Example');
  assert.equal(capture.actor.isSelf, false);
  assert.equal(capture.text, 'Here is the latest update.');
  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.kind, 'document');
  assert.equal(capture.attachments[0]?.fileName, 'summary.pdf');
  assert.equal(capture.attachments[0]?.byteSize, 'pdf-data'.length);
});

test("normalizeParsedEmailMessage treats the hosted stable alias as self and prefers Reply-To for first-contact thread targets", async () => {
  const raw = [
    'From: Alice Example <alice@example.test>',
    'Reply-To: Alice Replies <reply@example.test>, Team Replies <team@example.test>',
    'To: assistant+u-member_123@mail.example.test',
    'Subject: Hosted hello',
    'Message-ID: <msg_alias_123@example.test>',
    'Date: Thu, 26 Mar 2026 12:00:00 +0000',
    '',
    'Hello from the hosted stable alias path.',
    '',
  ].join('\r\n');

  const capture = await normalizeParsedEmailMessage({
    accountAddress: 'assistant@mail.example.test',
    accountId: 'assistant@mail.example.test',
    message: parseRawEmailMessage(raw),
    selfAddresses: ['assistant+u-member_123@mail.example.test'],
  });
  const threadTarget = parseHostedEmailThreadTarget(capture.thread.id);

  assert.equal(capture.thread.isDirect, true);
  assert.equal(capture.actor.id, 'alice@example.test');
  assert.equal(threadTarget?.to[0], 'reply@example.test');
  assert.deepEqual(threadTarget?.cc ?? [], ['team@example.test']);
});
