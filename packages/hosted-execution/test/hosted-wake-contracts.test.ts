import { describe, expect, it } from "vitest";

import {
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
} from "../src/contracts.js";
import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedWakeEmailMessageReceivedPayload,
  buildHostedWakeLinqMessageReceivedPayload,
} from "../src/builders.js";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedWakeDispatchPayload,
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
        payloadJson: dispatch,
        payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
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

  it("parses hosted wake payloads using the explicit message/system schema split", () => {
    const dispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq:schema-split",
      linqEvent: {
        parts: [
          {
            type: "text",
            value: "hi",
          },
        ],
      },
      linqMessageId: "msg_123",
      occurredAt: "2026-04-17T00:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "user-123",
    });

    expect(parseHostedWakeDispatchPayload({
      kind: dispatch.event.kind,
      occurredAt: dispatch.occurredAt,
      payloadJson: buildHostedWakeLinqMessageReceivedPayload({
        eventId: dispatch.eventId,
        linqEvent: dispatch.event.linqEvent,
        linqMessageId: dispatch.event.linqMessageId,
        phoneLookupKey: dispatch.event.phoneLookupKey,
      }),
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: dispatch.event.userId,
    })).toEqual(dispatch);
  });

  it("parses email message wakes through the explicit message lane", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email:direct-message-lane",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw/direct-message-lane",
      selfAddress: "reply@example.com",
      userId: "user-123",
    });

    expect(parseHostedWakeDispatchPayload({
      kind: dispatch.event.kind,
      occurredAt: dispatch.occurredAt,
      payloadJson: buildHostedWakeEmailMessageReceivedPayload({
        eventId: dispatch.eventId,
        identityId: dispatch.event.identityId,
        rawMessageKey: dispatch.event.rawMessageKey,
        selfAddress: dispatch.event.selfAddress,
      }),
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: dispatch.event.userId,
    })).toEqual(dispatch);
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
