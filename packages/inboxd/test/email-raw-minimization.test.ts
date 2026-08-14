import { describe, expect, it } from "vitest";

import { toAgentmailChatMessage } from "../src/connectors/email/normalize.ts";
import { toParsedEmailChatMessage } from "../src/connectors/email/normalize-parsed.ts";

describe("email raw metadata minimization", () => {
  it("keeps AgentMail body text for the capture while storing only summarized raw metadata", async () => {
    const chatMessage = await toAgentmailChatMessage({
      message: {
        inbox_id: "inbox_123",
        thread_id: "thread_123",
        message_id: "message_123",
        labels: ["unread", "important"],
        timestamp: "2026-04-01T10:00:00.000Z",
        from: "Alice Example <alice@example.com>",
        to: ["bob@example.com"],
        cc: ["carol@example.com"],
        bcc: ["dave@example.com"],
        reply_to: ["reply@example.com"],
        subject: "Sensitive subject line",
        preview: "Preview body",
        text: "Plain text body",
        html: "<p>HTML body</p>",
        extracted_text: "Extracted text body",
        extracted_html: "<p>Extracted HTML body</p>",
        attachments: [
          {
            attachment_id: "attachment_123",
            content_disposition: "attachment",
            content_id: "cid-123",
            content_type: "application/pdf",
            filename: "lab-results.pdf",
            size: 321,
          },
        ],
        in_reply_to: "message_prev",
        references: ["message_prev", "message_root"],
        headers: {
          authorization: "Bearer secret-token",
          "x-mailer": "Mailer",
        },
        created_at: "2026-04-01T09:59:00.000Z",
        updated_at: "2026-04-01T10:01:00.000Z",
        size: 999,
      },
    });

    expect(chatMessage.text).toBe("Extracted text body");
    expect(chatMessage.raw).toEqual({
      schema: "murph.email-agentmail-capture.v1",
      timestamp: "2026-04-01T10:00:00.000Z",
      created_at: "2026-04-01T09:59:00.000Z",
      updated_at: "2026-04-01T10:01:00.000Z",
      size: 999,
      label_count: 2,
      to_count: 1,
      cc_count: 1,
      bcc_count: 1,
      reply_to_count: 1,
      reference_count: 2,
      attachment_count: 1,
      has_subject: true,
      has_preview: true,
      has_text: true,
      has_html: true,
      has_extracted_text: true,
      has_extracted_html: true,
      has_in_reply_to: true,
      header_count: 2,
    });

    for (const forbiddenKey of [
      "attachments",
      "bcc",
      "cc",
      "extracted_html",
      "extracted_text",
      "from",
      "headers",
      "html",
      "inbox_id",
      "message_id",
      "preview",
      "references",
      "reply_to",
      "subject",
      "text",
      "thread_id",
      "to",
    ]) {
      expect(chatMessage.raw).not.toHaveProperty(forbiddenKey);
    }
  });

  it("keeps parsed-email threading inputs out of raw metadata while preserving the message text", async () => {
    const chatMessage = await toParsedEmailChatMessage({
      message: {
        attachments: [
          {
            contentDisposition: "attachment",
            contentId: "cid-123",
            contentTransferEncoding: "base64",
            contentType: "text/plain",
            data: new Uint8Array([65, 66, 67]),
            fileName: "notes.txt",
          },
        ],
        bcc: ["dave@example.com"],
        cc: ["carol@example.com"],
        from: "Alice Example <alice@example.com>",
        headers: {
          date: "Tue, 01 Apr 2026 10:00:00 +0000",
          "message-id": "<message-123@example.com>",
        },
        html: "<p>HTML body</p>",
        inReplyTo: "<message-prev@example.com>",
        messageId: "<message-123@example.com>",
        occurredAt: "2026-04-01T10:00:00.000Z",
        rawHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        rawSize: 2048,
        receivedAt: "2026-04-01T10:00:01.000Z",
        references: ["<message-root@example.com>", "<message-prev@example.com>"],
        replyTo: ["reply@example.com"],
        subject: "Sensitive subject line",
        text: "Plain text body",
        to: ["bob@example.com"],
      },
    });

    expect(chatMessage.text).toBe("Plain text body");
    expect(chatMessage.raw).toEqual({
      schema: "murph.email-parsed-capture.v1",
      raw_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      raw_size: 2048,
      attachment_count: 1,
      to_count: 1,
      cc_count: 1,
      bcc_count: 1,
      reply_to_count: 1,
      reference_count: 2,
      header_count: 2,
      has_message_id: true,
      has_in_reply_to: true,
      has_from: true,
      has_subject: true,
      has_text: true,
      has_html: true,
    });

    for (const forbiddenKey of [
      "attachments",
      "bcc",
      "cc",
      "from",
      "headers",
      "html",
      "in_reply_to",
      "message_id",
      "references",
      "reply_to",
      "subject",
      "text",
      "to",
    ]) {
      expect(chatMessage.raw).not.toHaveProperty(forbiddenKey);
    }
  });
});
