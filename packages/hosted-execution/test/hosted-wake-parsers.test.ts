import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionCursorState,
  parseHostedWakeAppendResponse,
  parseHostedWakeCommitResponse,
  parseHostedWakeExecutionPayload,
  parseHostedWakeFetchResponse,
} from "../src/parsers.ts";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionVaultShareAcceptedWake,
  buildHostedWakeEmailMessageReceivedPayload,
  buildHostedWakeTelegramMessageReceivedPayload,
} from "../src/builders.ts";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
} from "../src/contracts.ts";
import {
  parseHostedExecutionConversationMessagePayload,
  parseHostedExecutionWake,
  parseHostedWakeAppendRequest,
  parseHostedWakeEmailMessageReceivedPayload,
  parseHostedWakeRecord,
  parseHostedWakeStatusResponse,
} from "../src/parsers.ts";

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

  it("rejects system payloads that carry a conversation wake", () => {
    expect(() => parseHostedWakeExecutionPayload({
      kind: "conversation.message",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadJson: buildHostedExecutionConversationMessageWake({
        eventId: "evt_email",
        message: {
          channel: "email",
          identityId: "assistant@example.com",
          rawMessageKey: "raw_123",
        },
        occurredAt: "2026-04-17T00:00:00.000Z",
        userId: "member-1",
      }),
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      userId: "member-1",
    })).toThrow(/system payload schema/i);
  });

  it("parses direct message wake payloads into conversation wakes", () => {
    const occurredAt = "2026-04-17T00:00:00.000Z";

    expect(parseHostedWakeExecutionPayload({
      kind: "conversation.message",
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
      eventId: "evt_email",
      kind: "conversation.message",
      message: {
        channel: "email",
        identityId: "assistant@example.com",
        rawMessageKey: "raw_123",
        selfAddress: "reply@example.com",
      },
      occurredAt,
      userId: "member-1",
    });
  });

  it("parses hosted execution wakes across the supported wake kinds", () => {
    const occurredAt = "2026-04-17T00:00:00.000Z";

    expect(parseHostedExecutionWake({
      eventId: "wake_member",
      firstContact: null,
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      occurredAt,
      userId: "member-1",
    })).toEqual(buildHostedExecutionMemberActivatedWake({
      eventId: "wake_member",
      firstContact: null,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member-1",
      occurredAt,
    }));

    expect(parseHostedExecutionWake({
      eventId: "wake_member_channels",
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      occurredAt,
      userId: "member-1",
    })).toEqual(buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "wake_member_channels",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      memberId: "member-1",
      occurredAt,
    }));

    expect(parseHostedExecutionWake({
      eventId: "wake_cron",
      kind: "assistant.cron.tick",
      occurredAt,
      reason: "device-sync",
      userId: "member-1",
    })).toEqual(buildHostedExecutionAssistantCronTickWake({
      eventId: "wake_cron",
      occurredAt,
      reason: "device-sync",
      userId: "member-1",
    }));

    expect(parseHostedExecutionWake({
      eventId: "wake_share",
      kind: "vault.share.accepted",
      occurredAt,
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
      userId: "member-1",
    })).toEqual(buildHostedExecutionVaultShareAcceptedWake({
      eventId: "wake_share",
      memberId: "member-1",
      occurredAt,
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
    }));
  });

  it("parses direct wake payload helpers and rejects invalid wake contract inputs", () => {
    expect(parseHostedExecutionConversationMessagePayload({
      channel: "email",
      identityId: null,
      rawMessageKey: "raw_123",
      selfAddress: null,
    })).toEqual({
      channel: "email",
      identityId: null,
      rawMessageKey: "raw_123",
      selfAddress: null,
    });

    expect(() =>
      parseHostedExecutionConversationMessagePayload({
        channel: "sms",
      }),
    ).toThrow(/channel is invalid/i);

    expect(parseHostedWakeExecutionPayload({
      kind: "conversation.message",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadJson: buildHostedWakeTelegramMessageReceivedPayload({
        eventId: "evt_telegram_payload",
        telegramMessage: {
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread_123",
        },
      }),
      payloadSchema: HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
      userId: "member-1",
    })).toEqual({
      eventId: "evt_telegram_payload",
      kind: "conversation.message",
      message: {
        channel: "telegram",
        telegramMessage: {
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread_123",
        },
      },
      occurredAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    });

    expect(() =>
      parseHostedWakeEmailMessageReceivedPayload({
        channel: "telegram",
        eventId: "evt_email_payload",
        identityId: null,
        rawMessageKey: "raw_123",
      }),
    ).toThrow(/must be email/i);

    expect(() =>
      parseHostedWakeAppendRequest({}),
    ).toThrow(/must include wake/i);

    expect(() =>
      parseHostedWakeRecord({
        behavior: "unexpected",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: null,
        id: "wake_123",
        kind: "member.channels.updated",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "1",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member-1",
      }),
    ).toThrow(/Unsupported hosted wake behavior/i);
  });

  it("parses system payload wake records and rejects mismatches", () => {
    const memberWake = buildHostedExecutionMemberActivatedWake({
      eventId: "wake_member_system",
      firstContact: null,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member-1",
      occurredAt: "2026-04-17T00:00:00.000Z",
    });

    expect(parseHostedWakeExecutionPayload({
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadJson: memberWake,
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toEqual(memberWake);

    expect(() => parseHostedWakeExecutionPayload({
      kind: "member.channels.updated",
      occurredAt: memberWake.occurredAt,
      payloadJson: memberWake,
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload kind must match/i);

    expect(() => parseHostedWakeExecutionPayload({
      kind: memberWake.kind,
      occurredAt: "2026-04-17T01:00:00.000Z",
      payloadJson: memberWake,
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload occurredAt must match/i);

    expect(() => parseHostedWakeExecutionPayload({
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadJson: memberWake,
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/requires conversation\.message kind/i);
  });

  it("parses wake status responses with optional dispatch state", () => {
    expect(parseHostedWakeStatusResponse({
      cursor: {
        committedSeq: "1",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "1",
      },
      dispatchState: null,
      pendingWakeCount: 0,
    })).toEqual({
      cursor: {
        committedSeq: "1",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "1",
      },
      dispatchState: null,
      pendingWakeCount: 0,
    });
  });
});
