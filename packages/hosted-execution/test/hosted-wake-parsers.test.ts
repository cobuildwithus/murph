import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionCursorState,
  parseHostedWakeAppendResponse,
  parseHostedWakeCommitRequest,
  parseHostedWakeCommitResponse,
  parseHostedWakeExecutionPayload,
  parseHostedWakeFetchResponse,
  parseHostedWakeQuarantineRequest,
  parseHostedWakeTerminalResponse,
} from "../src/parsers.ts";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "../src/builders.ts";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
} from "../src/contracts.ts";
import {
  parseHostedExecutionConversationMessagePayload,
  parseHostedExecutionWake,
  parseHostedWakeAppendRequest,
  parseHostedWakeRecord,
  parseHostedWakeStatusResponse,
} from "../src/parsers.ts";

const TEST_SNAPSHOT_REF = {
  hash: "hash-1",
  key: "bundles/vault/hash-1.bundle.json",
  size: 128,
  updatedAt: "2026-04-17T00:00:01.000Z",
} as const;

describe("hosted wake parser contracts", () => {
  it("parses hosted wake batch responses with bigint-string cursor fields", () => {
    const parsed = parseHostedWakeFetchResponse({
      cursor: {
        committedSeq: "12",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "13",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      wakes: [
        {
          behavior: "coalescing",
          coalescingKey: "member.channels.updated:member-1",
          fetchProof: "wake-1:12:proof",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "member.channels.updated:test",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 64,
          payloadCiphertext: "ciphertext:wake-1",
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
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
      fetchProof: "wake-1:12:proof",
      kind: "member.channels.updated",
      payloadBytes: 64,
      payloadCiphertext: "ciphertext:wake-1",
      seq: "12",
    });
  });

  it("exposes only the opaque execution payload transport on the public wake record contract", () => {
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
          fetchProof: "wake-1:12:proof",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "member.channels.updated:test",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 128,
          payloadCiphertext: "opaque-ciphertext",
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          quarantineCode: null,
          quarantinedAt: null,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
    });

    expect(parsedFetch.wakes[0]).toMatchObject({
      fetchProof: "wake-1:12:proof",
      payloadBytes: 128,
      payloadCiphertext: "opaque-ciphertext",
    });
    expect(parsedFetch.wakes[0]).not.toHaveProperty("payloadJson");
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
        payloadCiphertext: "opaque-ciphertext",
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "12",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member-1",
      },
    });

    expect(parsedAppend.wake).toMatchObject({
      payloadBytes: 128,
      payloadCiphertext: "opaque-ciphertext",
    });
    expect(parsedAppend.wake).not.toHaveProperty("payloadJson");
    expect(parsedAppend.wake).not.toHaveProperty("payloadInlineCiphertext");
    expect(parsedAppend.wake).not.toHaveProperty("payloadRef");
  });

  it("rejects legacy fetched payload transport fields", () => {
    expect(() => parseHostedWakeRecord({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake-legacy-json",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadJson: {
        legacy: true,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      seq: "12",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/payloadJson/i);

    expect(() => parseHostedWakeRecord({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake-legacy-inline",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadInlineCiphertext: "inline-ciphertext",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      seq: "12",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/payloadInlineCiphertext/i);

    expect(() => parseHostedWakeRecord({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake-legacy-ref",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadRef: "wake_payload_1",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      seq: "12",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/payloadRef/i);
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

  it("rejects invalid snapshotRef shapes in hosted wake cursor contracts", () => {
    expect(() => parseHostedExecutionCursorState({
      committedSeq: "12",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "13",
      snapshotRef: {
        checkpoint: "wake_12",
      },
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "4",
    })).toThrow(/snapshotRef/i);
  });

  it("rejects fetched wake records that omit fetch proofs", () => {
    expect(() => parseHostedWakeFetchResponse({
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
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
    })).toThrow(/fetchProof/i);
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

  it("parses hosted wake commit requests and quarantine requests", () => {
    expect(parseHostedWakeCommitRequest({
      committedSeq: "24",
      expectedVersion: "8",
      snapshotRef: TEST_SNAPSHOT_REF,
    })).toEqual({
      committedSeq: "24",
      expectedVersion: "8",
      snapshotRef: TEST_SNAPSHOT_REF,
    });

    expect(parseHostedWakeQuarantineRequest({
      fetchProof: "proof_24",
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_24",
      wakeSeq: "24",
    })).toEqual({
      fetchProof: "proof_24",
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
  });

  it("rejects invalid hosted wake commit request snapshot refs", () => {
    expect(() => parseHostedWakeCommitRequest({
      committedSeq: "24",
      expectedVersion: "8",
      snapshotRef: {
        checkpoint: "wake_24",
      },
    })).toThrow(/snapshotRef/i);
  });

  it("parses hosted wake terminal responses", () => {
    expect(parseHostedWakeTerminalResponse({
      recorded: true,
    })).toEqual({
      recorded: true,
    });
  });

  it("rejects wake payloads that do not serialize the full wake contract", () => {
    expect(() => parseHostedWakeExecutionPayload({
      decryptedPayload: {
        channel: "email",
        identityId: "assistant@example.com",
        rawMessageKey: "raw_123",
      },
      kind: "conversation.message",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: "member-1",
    })).toThrow(/kind/i);
  });

  it("parses canonical full wake payloads into conversation wakes", () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
      userId: "member-1",
    });

    expect(parseHostedWakeExecutionPayload({
      decryptedPayload: wake,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: wake.userId,
    })).toEqual(wake);
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

    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram_payload",
      occurredAt: "2026-04-17T00:00:00.000Z",
      telegramMessage: {
        messageId: "message_123",
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread_123",
      },
      userId: "member-1",
    });

    expect(parseHostedWakeExecutionPayload({
      decryptedPayload: telegramWake,
      kind: telegramWake.kind,
      occurredAt: telegramWake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: telegramWake.userId,
    })).toEqual(telegramWake);

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
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "1",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "member-1",
      }),
    ).toThrow(/Unsupported hosted wake behavior/i);
  });

  it("parses full wake payloads and rejects record metadata mismatches", () => {
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
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toEqual(memberWake);

    expect(() => parseHostedWakeExecutionPayload({
      decryptedPayload: memberWake,
      kind: "member.channels.updated",
      occurredAt: memberWake.occurredAt,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload kind must match/i);

    expect(() => parseHostedWakeExecutionPayload({
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: "2026-04-17T01:00:00.000Z",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload occurredAt must match/i);

    expect(() => parseHostedWakeExecutionPayload({
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadSchema: "murph.hosted-wake-system.v1" as never,
      userId: memberWake.userId,
    })).toThrow(/execution payload schema/i);
  });

  it("rejects wake records that still use the removed legacy message payload schema", () => {
    expect(() => parseHostedWakeRecord({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake_legacy",
      kind: "conversation.message",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadBytes: 32,
      payloadCiphertext: "ciphertext:legacy",
      payloadSchema: "murph.hosted-wake-message.v1",
      seq: "1",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/Unsupported hosted wake payload schema/i);
  });

  it("rejects wake records whose payload schema is not the canonical execution schema", () => {
    expect(() => parseHostedWakeRecord({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake_bad_schema",
      kind: "member.activated",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadBytes: 32,
      payloadCiphertext: "ciphertext:member",
      payloadSchema: "murph.hosted-wake-conversation-message.v1",
      seq: "1",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/Unsupported hosted wake payload schema/i);
  });

  it("parses wake status responses with canonical wakeState input", () => {
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
      wakeState: null,
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
      pendingWakeCount: 0,
      wakeState: null,
    });
  });

  it("rejects the removed dispatchState input alias for wake status responses", () => {
    expect(() => parseHostedWakeStatusResponse({
      cursor: {
        committedSeq: "1",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "2",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "1",
      },
      dispatchState: "queued",
      pendingWakeCount: 0,
    })).toThrow(/dispatchState is no longer supported/i);
  });

  it("returns canonical wakeState output when wakeState is present", () => {
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
      wakeState: "queued",
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
      pendingWakeCount: 0,
      wakeState: "queued",
    });
  });

  it("parses replacement metadata for superseded coalesced wake events", () => {
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
      pendingWakeCount: 0,
      replacedByEventId: "evt_new",
      wakeState: "replaced",
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
      pendingWakeCount: 0,
      replacedByEventId: "evt_new",
      wakeState: "replaced",
    });
  });
});
