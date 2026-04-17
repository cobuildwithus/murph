import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
} from "../src/builders.js";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedWakeAppendResponse,
  parseHostedWakeQuarantineResponse,
} from "../src/parsers.js";

describe("hosted wake contract parsers", () => {
  it("parses hosted wake append and quarantine responses", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
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
        dedupeKey: "dispatch:email.message.received:email:test-message",
        id: "wake-123",
        kind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        payloadBytes: 128,
        payloadInlineCiphertext: null,
        payloadJson: dispatch,
        payloadRef: null,
        payloadSchema: "murph.hosted-wake-dispatch.v1",
        quarantineCode: null,
        quarantinedAt: null,
        seq: "42",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: dispatch.event.userId,
      },
    })).toEqual({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: expect.objectContaining({
        id: "wake-123",
        kind: dispatch.event.kind,
        seq: "42",
      }),
    });

    expect(parseHostedWakeQuarantineResponse({ quarantined: true })).toEqual({
      quarantined: true,
    });
  });

  it("rejects the removed gateway.message.send dispatch kind", () => {
    expect(() => parseHostedExecutionDispatchRequest({
      event: {
        clientRequestId: null,
        kind: "gateway.message.send",
        replyToMessageId: null,
        sessionKey: "session-123",
        text: "hi",
        userId: "user-123",
      },
      eventId: "gateway:test-message",
      occurredAt: "2026-04-17T00:00:00.000Z",
    })).toThrow(/Unsupported hosted execution event kind|must be one of/i);
  });
});
