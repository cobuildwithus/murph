import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionCursorState,
  parseHostedExecutionConversationMessagePayload,
  parseHostedExecutionEvent,
  parseHostedIngressEnvelope,
  parseHostedRunAcquireRequest,
  parseHostedRunAcquireResponse,
  parseHostedRunCommitRequest,
  parseHostedRunCommitResponse,
  parseHostedRunFinalizeRequest,
  parseHostedRunFinalizeResponse,
  parseHostedRunLogRequest,
  parseHostedRunLogResponse,
  parseHostedRunReleaseFinalizeRequest,
  parseHostedRunReleaseFinalizeResponse,
  parseHostedRunStatusRequest,
  parseHostedRunStatusResponse,
  parseHostedIngressAppendResponse,
  parseHostedIngressPayload,
  parseHostedIngressEvent,
} from "../src/parsers.ts";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "../src/builders.ts";
import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
} from "../src/contracts.ts";

const TEST_SNAPSHOT_REF = {
  hash: "hash-1",
  key: "bundles/vault/hash-1.bundle.json",
  size: 128,
  updatedAt: "2026-04-17T00:00:01.000Z",
} as const;

function createHostedRunRecord(status = "committed_needs_finalize") {
  return {
    acquiredAt: "2026-04-17T00:00:00.000Z",
    attempt: 1,
    committedAt: "2026-04-17T00:00:02.000Z",
    createdAt: "2026-04-17T00:00:00.000Z",
    errorClass: null,
    errorCode: null,
    eventCount: 1,
    eventKinds: ["device-sync.wake"],
    eventSeqs: ["24"],
    executorKind: "cloudflare-container",
    failedAt: null,
    finalSnapshotRef: TEST_SNAPSHOT_REF,
    finalizedAt: "2026-04-17T00:00:03.000Z",
    id: "run-1",
    inputCommittedSeq: "24",
    inputCursorVersion: "4",
    inputSnapshotRef: TEST_SNAPSHOT_REF,
    nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
    nextRuntimeWakeReason: "assistant.run",
    outputCommittedSeq: "25",
    outputCursorVersion: "5",
    preparedAt: "2026-04-17T00:00:01.000Z",
    preparedSnapshotRef: TEST_SNAPSHOT_REF,
    redactedSummary: { stage: "prepared" },
    startedAt: "2026-04-17T00:00:00.500Z",
    status,
    triggerKind: "runtime_timer",
    updatedAt: "2026-04-17T00:00:03.000Z",
    userId: "member-1",
    ingressEventIds: ["wake-1"],
  } as const;
}

describe("hosted wake parser contracts", () => {
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

  it("parses runtime wake projections on the hosted execution cursor", () => {
    expect(parseHostedExecutionCursorState({
      committedSeq: "12",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      nextSeq: "13",
      snapshotRef: TEST_SNAPSHOT_REF,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "4",
    })).toEqual({
      committedSeq: "12",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      nextSeq: "13",
      snapshotRef: TEST_SNAPSHOT_REF,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "4",
    });
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

  it("parses hosted run acquire, commit, and finalize contracts", () => {
    const run = createHostedRunRecord("finalizing");

    expect(parseHostedRunAcquireRequest({
      executorKind: "cloudflare-container",
      limit: 5,
      now: "2026-04-17T00:00:00.000Z",
      triggerKind: "runtime_timer",
    })).toEqual({
      executorKind: "cloudflare-container",
      limit: 5,
      now: "2026-04-17T00:00:00.000Z",
      triggerKind: "runtime_timer",
    });

    expect(() => parseHostedRunAcquireRequest({
      executorKind: "unsupported" as never,
    })).toThrow(/Unsupported hosted run executorKind/i);

    expect(() => parseHostedRunAcquireRequest({
      triggerKind: "unsupported" as never,
    })).toThrow(/Unsupported hosted run triggerKind/i);

    expect(parseHostedRunAcquireResponse({
      acquired: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run,
      runToken: "run_token_123",
    })).toEqual({
      acquired: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run,
      runToken: "run_token_123",
    });

    expect(parseHostedRunCommitRequest({
      eventResults: [
        {
          quarantineCode: null,
          state: "completed",
          ingressEventId: "wake-1",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: true,
      nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      outputCommittedSeq: "25",
      preparedSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      eventResults: [
        {
          quarantineCode: null,
          state: "completed",
          ingressEventId: "wake-1",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: true,
      nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      outputCommittedSeq: "25",
      preparedSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(() => parseHostedRunCommitRequest({
      expectedCursorVersion: "4",
      eventResults: [
        {
          state: "queued" as never,
          ingressEventId: "wake-1",
        },
      ],
      outputCommittedSeq: "25",
      preparedSnapshotRef: {
        checkpoint: "run-1",
      } as never,
      runId: "run-1",
      runToken: "run_token_123",
    })).toThrow(/must be completed or quarantined/i);

    expect(parseHostedRunCommitResponse({
      committed: true,
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:02.000Z",
        userId: "member-1",
        version: "5",
      },
      needsFinalize: true,
      run,
    })).toEqual({
      committed: true,
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:02.000Z",
        userId: "member-1",
        version: "5",
      },
      needsFinalize: true,
      run,
    });

    expect(parseHostedRunFinalizeRequest({
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      nextRuntimeWakeAt: "2026-04-17T03:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      redactedSummary: { stage: "finalized" },
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      nextRuntimeWakeAt: "2026-04-17T03:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      redactedSummary: { stage: "finalized" },
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunFinalizeResponse({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      finalized: true,
      run,
    })).toEqual({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      finalized: true,
      run,
    });

    expect(parseHostedRunReleaseFinalizeRequest({
      failureClass: "hosted_run_finalize_retryable",
      failureCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      failureClass: "hosted_run_finalize_retryable",
      failureCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunReleaseFinalizeResponse({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      released: true,
      run,
    })).toEqual({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      released: true,
      run,
    });
  });

  it("parses hosted run log and status contracts", () => {
    const run = createHostedRunRecord();

    expect(parseHostedRunLogRequest({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      redacted: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      redacted: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(() => parseHostedRunLogRequest({
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      runId: "run-1",
    })).toThrow("Hosted run log request runToken must be a non-empty string.");

    expect(parseHostedRunLogResponse({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        redacted: { stage: "prepared" },
        runId: "run-1",
        userId: "member-1",
      },
    })).toEqual({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        redacted: { stage: "prepared" },
        runId: "run-1",
        userId: "member-1",
      },
    });

    expect(parseHostedRunStatusRequest({
      includeLogs: true,
      limit: 3,
      runId: "run-1",
    })).toEqual({
      includeLogs: true,
      limit: 3,
      runId: "run-1",
    });

    expect(parseHostedRunStatusResponse({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      logs: [
        {
          at: "2026-04-17T00:00:00.000Z",
          component: "runtime",
          createdAt: "2026-04-17T00:00:00.000Z",
          id: "log-1",
          level: "info",
          message: "prepared snapshot",
          phase: "prepare",
          redacted: { stage: "prepared" },
          runId: "run-1",
          userId: "member-1",
        },
      ],
      pendingIngressEventCount: 0,
      run,
      runs: [run],
    })).toEqual({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      logs: [
        {
          at: "2026-04-17T00:00:00.000Z",
          component: "runtime",
          createdAt: "2026-04-17T00:00:00.000Z",
          id: "log-1",
          level: "info",
          message: "prepared snapshot",
          phase: "prepare",
          redacted: { stage: "prepared" },
          runId: "run-1",
          userId: "member-1",
        },
      ],
      pendingIngressEventCount: 0,
      run,
      runs: [run],
    });

    expect(() => parseHostedRunStatusResponse({
      cursor: {
        committedSeq: "25",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:03.000Z",
        userId: "member-1",
        version: "6",
      },
      pendingIngressEventCount: 0,
      run: {
        ...run,
        status: "queued" as never,
      },
    })).toThrow(/Unsupported hosted run status/i);
  });

  it("covers null and invalid branches in extracted run-control parsers", () => {
    expect(parseHostedRunAcquireRequest({
      attestationRef: null,
      executorCodeDigest: null,
      executorKind: null,
      limit: null,
      now: null,
      signedResultRef: null,
      triggerKind: null,
    })).toEqual({
      attestationRef: null,
      executorCodeDigest: null,
      executorKind: null,
      limit: null,
      now: null,
      signedResultRef: null,
      triggerKind: null,
    });

    expect(parseHostedRunLogResponse({
      log: null,
      logged: false,
    })).toEqual({
      log: null,
      logged: false,
    });

    expect(parseHostedRunStatusRequest({
      includeLogs: null,
      limit: null,
      runId: null,
    })).toEqual({
      includeLogs: null,
      limit: null,
      runId: null,
    });

    expect(() => parseHostedRunLogRequest({
      component: "runtime",
      level: "verbose" as never,
      message: "prepared snapshot",
      phase: "prepare",
      runId: "run-1",
    })).toThrow(/Unsupported hosted run log level/i);
  });

  it("rejects wake payloads that do not serialize the full wake contract", () => {
    expect(() => parseHostedIngressPayload({
      decryptedPayload: {
        channel: "email",
        identityId: "assistant@example.com",
        rawMessageKey: "raw_123",
      },
      kind: "conversation.message",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
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

    expect(parseHostedIngressPayload({
      decryptedPayload: wake,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: wake.userId,
    })).toEqual(wake);
  });

  it("parses hosted execution wakes across the supported wake kinds", () => {
    const occurredAt = "2026-04-17T00:00:00.000Z";

    expect(parseHostedIngressEnvelope({
      eventId: "wake_member",
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
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member-1",
      occurredAt,
    }));

    expect(parseHostedIngressEnvelope({
      eventId: "wake_notification",
      kind: "assistant.notification.requested",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:member-1",
        deliveryIdempotencyKey: "signup-welcome:member-1",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15550002222",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt,
      userId: "member-1",
    })).toEqual(buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "wake_notification",
      memberId: "member-1",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:member-1",
        deliveryIdempotencyKey: "signup-welcome:member-1",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send exactly the signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15550002222",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15550002222",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
      },
      occurredAt,
    }));

    expect(parseHostedIngressEnvelope({
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

    expect(() => parseHostedIngressEnvelope({
      eventId: "wake_cron",
      kind: "unsupported.kind",
      occurredAt,
      userId: "member-1",
    })).toThrow(/wake kind/i);

    expect(parseHostedIngressEnvelope({
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

    expect(() =>
      parseHostedIngressEnvelope({
        eventId: "wake_bad",
        kind: "unsupported.event",
        occurredAt,
        userId: "member-1",
      }),
    ).toThrow(/Hosted execution wake kind is invalid/i);
  });

  it("parses vault share events through the event contract", () => {
    expect(parseHostedExecutionEvent({
      kind: "vault.share.accepted",
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
      userId: "user_123",
    })).toEqual({
      kind: "vault.share.accepted",
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
      userId: "user_123",
    });
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

    expect(parseHostedExecutionConversationMessagePayload({
      channel: "linq",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            attachmentId: "att_123",
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            size: 42,
            type: "media",
            url: "https://example.test/photo.jpg",
          },
          {
            type: "voice_memo",
          },
        ],
        replyToMessageId: "msg_122",
        replyToPartIndex: 0,
        service: "SMS",
      },
      phoneLookupKey: "phone_lookup_123",
    })).toEqual({
      channel: "linq",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            attachmentId: "att_123",
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            size: 42,
            type: "media",
            url: "https://example.test/photo.jpg",
          },
          {
            type: "voice_memo",
          },
        ],
        replyToMessageId: "msg_122",
        replyToPartIndex: 0,
        service: "SMS",
      },
      phoneLookupKey: "phone_lookup_123",
    });

    expect(() =>
      parseHostedExecutionConversationMessagePayload({
        channel: "linq",
        linqMessage: {
          chatId: "chat_123",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [{
            type: "unsupported",
          }],
        },
        phoneLookupKey: "phone_lookup_123",
      }),
    ).toThrow(/type must be "text", "link", "media", or "voice_memo"/i);

    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram_payload",
      occurredAt: "2026-04-17T00:00:00.000Z",
      telegramMessage: {
        messageId: "message_123",
        replyContextPreview: "Replying to: Earlier message",
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread_123",
      },
      userId: "member-1",
    });

    expect(parseHostedIngressPayload({
      decryptedPayload: telegramWake,
      kind: telegramWake.kind,
      occurredAt: telegramWake.occurredAt,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: telegramWake.userId,
    })).toEqual(telegramWake);

    expect(() =>
      parseHostedIngressEvent({
        behavior: "unexpected",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: null,
        id: "wake_123",
        kind: "member.channels.updated",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
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
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member-1",
      occurredAt: "2026-04-17T00:00:00.000Z",
    });

    expect(parseHostedIngressPayload({
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toEqual(memberWake);

    expect(() => parseHostedIngressPayload({
      decryptedPayload: memberWake,
      kind: "member.channels.updated",
      occurredAt: memberWake.occurredAt,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload kind must match/i);

    expect(() => parseHostedIngressPayload({
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: "2026-04-17T01:00:00.000Z",
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: memberWake.userId,
    })).toThrow(/payload occurredAt must match/i);

    expect(() => parseHostedIngressPayload({
      decryptedPayload: memberWake,
      kind: memberWake.kind,
      occurredAt: memberWake.occurredAt,
      payloadSchema: "murph.hosted-ingress-system.v1" as never,
      userId: memberWake.userId,
    })).toThrow(/execution payload schema/i);
  });

  it("rejects wake records whose payload schema is not the canonical execution schema", () => {
    expect(() => parseHostedIngressEvent({
      behavior: "ordered",
      createdAt: "2026-04-17T00:00:00.000Z",
      id: "wake_bad_schema",
      kind: "member.activated",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payloadBytes: 32,
      payloadCiphertext: "ciphertext:member",
      payloadSchema: "murph.hosted-ingress-conversation-message.v1",
      seq: "1",
      updatedAt: "2026-04-17T00:00:00.000Z",
      userId: "member-1",
    })).toThrow(/Unsupported hosted wake payload schema/i);
  });
});
