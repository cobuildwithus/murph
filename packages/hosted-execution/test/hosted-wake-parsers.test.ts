import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionCursorState,
  parseHostedWakeAppendResponse,
  parseHostedWakeCommitResponse,
  parseHostedWakeDispatchPayload,
  parseHostedWakeFetchResponse,
} from "../src/parsers.ts";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedWakeEmailMessageReceivedPayload,
  buildHostedWakeLinqMessageReceivedPayload,
} from "../src/builders.ts";
import {
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
} from "../src/contracts.ts";

describe("hosted wake parser contracts", () => {
  it("parses hosted wake batch responses with bigint-string cursor fields", () => {
    const parsed = parseHostedWakeFetchResponse({
      cursor: {
        committedSeq: "12",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "13",
        snapshotRef: {
          kind: "bundle",
          ref: "bundle-1",
        },
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      wakes: [
        {
          behavior: "coalescing",
          coalescingKey: "member.channels.updated:member-1",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "member.channels.updated:test",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadJson: {
            eventId: "evt_123",
          },
          payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
          quarantineCode: null,
          quarantinedAt: null,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
    });

    expect(parsed.cursor.version).toBe("4");
    expect(parsed.wakes[0]).toMatchObject({
      behavior: "coalescing",
      kind: "member.channels.updated",
      payloadJson: {
        eventId: "evt_123",
      },
      seq: "12",
    });
  });

  it("omits payload transport details from the public wake record contract", () => {
    const parsedFetch = parseHostedWakeFetchResponse({
      cursor: {
        committedSeq: "12",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "13",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      wakes: [
        {
          behavior: "ordered",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "member.channels.updated:test",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 128,
          payloadInlineCiphertext: "inline-ciphertext",
          payloadJson: {
            eventId: "evt_123",
          },
          payloadRef: "payload-ref-1",
          payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
          quarantineCode: null,
          quarantinedAt: null,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
    });

    expect(parsedFetch.wakes[0]).not.toHaveProperty("payloadBytes");
    expect(parsedFetch.wakes[0]).not.toHaveProperty("payloadInlineCiphertext");
    expect(parsedFetch.wakes[0]).not.toHaveProperty("payloadRef");

    const parsedAppend = parseHostedWakeAppendResponse({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "member.channels.updated:test",
        id: "wake-1",
        kind: "member.channels.updated",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadBytes: 128,
        payloadInlineCiphertext: "inline-ciphertext",
        payloadJson: {
          eventId: "evt_123",
        },
        payloadRef: "payload-ref-1",
        payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "12",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member-1",
      },
    });

    expect(parsedAppend.wake).not.toHaveProperty("payloadBytes");
    expect(parsedAppend.wake).not.toHaveProperty("payloadInlineCiphertext");
    expect(parsedAppend.wake).not.toHaveProperty("payloadRef");
  });

  it("rejects invalid bigint strings in hosted wake responses", () => {
    expect(() => parseHostedExecutionCursorState({
      committedSeq: "not-a-bigint",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "2",
      snapshotRef: null,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "1",
    })).toThrow(/committedSeq/i);
  });

  it("parses cursor commit responses", () => {
    const parsed = parseHostedWakeCommitResponse({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:05.000Z",
        userId: "member-1",
        version: "8",
      },
    });

    expect(parsed).toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:05.000Z",
        userId: "member-1",
        version: "8",
      },
    });
  });

  it("rejects message payloads labeled as system wakes", () => {
    expect(() => parseHostedWakeDispatchPayload({
      kind: "email.message.received",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadJson: {
        event: {
          kind: "email.message.received",
          identityId: "assistant@example.com",
          rawMessageKey: "raw_123",
          userId: "member-1",
        },
        eventId: "evt_email",
        occurredAt: "2026-04-17T00:00:00.000Z",
      },
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      userId: "member-1",
    })).toThrow(/system payload schema/i);
  });

  it("parses direct message wake payloads into runtime dispatches", () => {
    const expected = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "evt_linq",
      linqEvent: {
        id: "msg_123",
      },
      linqMessageId: "msg_123",
      occurredAt: "2026-04-17T00:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "member-1",
    });

    expect(parseHostedWakeDispatchPayload({
      kind: "linq.message.received",
      occurredAt: expected.occurredAt,
      payloadJson: buildHostedWakeLinqMessageReceivedPayload({
        eventId: expected.eventId,
        linqEvent: expected.event.linqEvent,
        linqMessageId: expected.event.linqMessageId,
        phoneLookupKey: expected.event.phoneLookupKey,
      }),
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: expected.event.userId,
    })).toEqual(expected);
  });

  it("parses email direct wake payloads into runtime dispatches", () => {
    const occurredAt = "2026-04-17T00:00:00.000Z";

    expect(parseHostedWakeDispatchPayload({
      kind: "email.message.received",
      occurredAt,
      payloadJson: buildHostedWakeEmailMessageReceivedPayload({
        eventId: "evt_email",
        identityId: "assistant@example.com",
        rawMessageKey: "raw_123",
        selfAddress: "reply@example.com",
      }),
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: "member-1",
    })).toEqual({
      event: {
        identityId: "assistant@example.com",
        kind: "email.message.received",
        rawMessageKey: "raw_123",
        selfAddress: "reply@example.com",
        userId: "member-1",
      },
      eventId: "evt_email",
      occurredAt,
    });
  });
});
