import { describe, expect, it } from "vitest";

import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
} from "../src/contracts.js";
import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "../src/builders.js";
import {
  parseHostedExecutionEvent,
  parseHostedWakeExecutionPayload,
  parseHostedWakeAppendResponse,
} from "../src/parsers.js";

describe("hosted wake contract parsers", () => {
  it("parses hosted wake append and quarantine responses", () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "email:test-message",
      identityId: "me@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw/test-message",
      selfAddress: "murph@example.com",
      userId: "user-123",
    });

    expect(parseHostedWakeAppendResponse({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "wake:conversation.message:email:test-message",
        id: "wake-123",
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        payloadBytes: 96,
        payloadCiphertext: "ciphertext:wake-123",
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "42",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: wake.userId,
      },
    })).toEqual({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: expect.objectContaining({
        id: "wake-123",
        kind: wake.kind,
        payloadBytes: 96,
        payloadCiphertext: "ciphertext:wake-123",
        seq: "42",
      }),
    });

  });

  it("parses hosted wake payloads using the canonical full-wake schema", () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq:schema-split",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            type: "text",
            value: "hi",
          },
        ],
      },
      occurredAt: "2026-04-17T00:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "user-123",
    });

    expect(parseHostedWakeExecutionPayload({
      decryptedPayload: wake,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: wake.userId,
    })).toEqual(wake);
  });

  it("parses email message wakes through the explicit message lane", () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "email:direct-message-lane",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw/direct-message-lane",
      selfAddress: "reply@example.com",
      userId: "user-123",
    });

    expect(parseHostedWakeExecutionPayload({
      decryptedPayload: wake,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: wake.userId,
    })).toEqual(wake);
  });

  it("rejects the removed gateway.message.send event kind", () => {
    expect(() => parseHostedExecutionEvent({
      clientRequestId: null,
      kind: "gateway.message.send",
      replyToMessageId: null,
      sessionKey: "session-123",
      text: "hi",
      userId: "user-123",
    })).toThrow(/Unsupported hosted execution event kind|must be one of/i);
  });
});
