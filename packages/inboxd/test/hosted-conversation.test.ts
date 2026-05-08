import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  normalizeHostedLinqConversationMessage: vi.fn(),
  normalizeHostedTelegramMessage: vi.fn(),
  normalizeParsedEmailMessage: vi.fn(),
  parseRawEmailMessage: vi.fn(),
}));

vi.mock("../src/connectors/linq/normalize.ts", () => ({
  normalizeHostedLinqConversationMessage:
    mocks.normalizeHostedLinqConversationMessage,
}));

vi.mock("../src/connectors/telegram/normalize.ts", () => ({
  normalizeHostedTelegramMessage: mocks.normalizeHostedTelegramMessage,
}));

vi.mock("../src/connectors/email/normalize-parsed.ts", () => ({
  normalizeParsedEmailMessage: mocks.normalizeParsedEmailMessage,
}));

vi.mock("../src/connectors/email/parsed.ts", () => ({
  parseRawEmailMessage: mocks.parseRawEmailMessage,
}));

import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
  normalizeHostedWhatsAppConversationCapture,
} from "../src/connectors/hosted-conversation.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hosted conversation connector barrel", () => {
  it("forwards hosted Linq and Telegram captures to their normalizers", async () => {
    const linqCapture = { source: "linq" };
    const telegramCapture = { source: "telegram" };
    const linqInput = {
      accountId: "15551234567",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "linq_message_123",
        parts: [{ type: "text" as const, value: "hello" }],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    };
    const telegramInput = {
      accountId: "bot",
      externalId: "evt_telegram",
      message: {
        messageId: "tg_message_123",
        text: "hello",
        threadId: "thread_123",
      },
      occurredAt: "2026-04-08T00:01:00.000Z",
    };
    mocks.normalizeHostedLinqConversationMessage.mockResolvedValueOnce(linqCapture);
    mocks.normalizeHostedTelegramMessage.mockResolvedValueOnce(telegramCapture);

    const linqResult = await normalizeHostedLinqConversationCapture(linqInput);
    const telegramResult = await normalizeHostedTelegramConversationCapture(
      telegramInput,
    );

    expect(mocks.normalizeHostedLinqConversationMessage).toHaveBeenCalledWith(
      linqInput,
    );
    expect(mocks.normalizeHostedTelegramMessage).toHaveBeenCalledWith(
      telegramInput,
    );
    assert.equal(linqResult, linqCapture);
    assert.equal(telegramResult, telegramCapture);
  });

  it("parses hosted email raw bytes before normalizing the email capture", async () => {
    const parsedMessage = {
      attachments: [],
      bcc: [],
      cc: [],
      from: "sender@example.com",
      headers: {},
      html: null,
      inReplyTo: null,
      messageId: "<message@example.com>",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawHash: "raw_hash_123",
      rawSize: 4,
      receivedAt: "2026-04-08T00:00:00.000Z",
      references: [],
      replyTo: [],
      subject: "Subject",
      text: "hello",
      to: ["assistant@example.com"],
    };
    const emailCapture = { source: "email" };
    const rawMessage = Uint8Array.from([1, 2, 3, 4]);
    mocks.parseRawEmailMessage.mockReturnValueOnce(parsedMessage);
    mocks.normalizeParsedEmailMessage.mockResolvedValueOnce(emailCapture);

    const result = await normalizeHostedEmailConversationCapture({
      accountAddress: "assistant@example.com",
      accountId: "assistant@example.com",
      rawMessage,
      selfAddresses: ["assistant@example.com"],
      source: "email",
      threadTarget: null,
    });

    expect(mocks.parseRawEmailMessage).toHaveBeenCalledWith(rawMessage);
    expect(mocks.normalizeParsedEmailMessage).toHaveBeenCalledWith({
      accountAddress: "assistant@example.com",
      accountId: "assistant@example.com",
      message: parsedMessage,
      selfAddresses: ["assistant@example.com"],
      source: "email",
      threadTarget: null,
    });
    assert.equal(result, emailCapture);
  });

  it("normalizes hosted WhatsApp text messages with sparse provider metadata", async () => {
    const capture = await normalizeHostedWhatsAppConversationCapture({
      accountId: "phone-number-id",
      externalId: "whatsapp:wamid.test",
      message: {
        fromWaId: "15551234567",
        messageId: "wamid.test",
        phoneNumberId: "phone-number-id",
        text: "CHECKIN",
        threadId: "15551234567",
      },
      occurredAt: "2026-04-08T00:02:00.000Z",
    });

    expect(capture).toMatchObject({
      accountId: "phone-number-id",
      actor: {
        displayName: null,
        id: "15551234567",
        isSelf: false,
      },
      attachments: [],
      externalId: "whatsapp:wamid.test",
      occurredAt: "2026-04-08T00:02:00.000Z",
      raw: {
        message_id: "wamid.test",
        phone_number_id: "phone-number-id",
        schema: "murph.whatsapp-capture.v1",
      },
      receivedAt: "2026-04-08T00:02:00.000Z",
      source: "whatsapp",
      text: "CHECKIN",
      thread: {
        id: "15551234567",
        isDirect: true,
        title: null,
      },
    });
  });
});
