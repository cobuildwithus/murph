import { describe, expect, it } from "vitest";

import { gatewayDeliveryTargetKindValues } from "@murphai/gateway-core";

import {
  buildHostedAssistantDeliveryEffect,
  buildHostedAssistantDeliveryFailedRecord,
  buildHostedAssistantDeliveryPendingRecord,
  buildHostedAssistantDeliverySendingRecord,
  buildHostedAssistantDeliverySentRecord,
  type HostedAssistantDeliveryMedia,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantMessageDeliveryReceipt,
  sameHostedAssistantDeliveryAttempt,
  sameHostedAssistantDeliveryFailure,
  sameHostedAssistantDeliveryReceipt,
  sameHostedAssistantDeliverySideEffectIdentity,
  hostedAssistantDeliveryTargetKindValues,
  parseHostedAssistantDeliveryRecord,
  parseHostedAssistantDeliverySideEffect,
  parseHostedAssistantDeliverySideEffects,
} from "../src/side-effects.ts";

function createHostedAssistantDeliveryPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor-1",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat-1",
    channel: "telegram",
    deliverySourceKey: null,
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent-1",
    identityId: "identity-1",
    media: [],
    message: "hello from hosted execution",
    subject: null,
    replyToMessageId: null,
    sessionId: "session-1",
    threadId: "thread-1",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn-1",
    ...overrides,
  };
}

function createHostedAssistantDeliveryAttempt(
  overrides: Partial<Parameters<typeof buildHostedAssistantDeliverySendingRecord>[0]["attempt"]> = {},
) {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent-1",
    messageLength: 27,
    providerMessageId: "provider-message-1",
    providerThreadId: "provider-thread-1",
    startedAt: "2026-04-08T00:00:00.000Z",
    target: "chat-1",
    targetKind: "participant" as const,
    ...overrides,
  };
}

function createHostedAssistantDeliveryFailure(
  overrides: Partial<Parameters<typeof buildHostedAssistantDeliveryFailedRecord>[0]["failure"]> = {},
) {
  return {
    code: "ASSISTANT_DELIVERY_FAILED",
    failedAt: "2026-04-08T00:00:10.000Z",
    message: "delivery failed",
    ...overrides,
  };
}

function createHostedAssistantDeliveryReceipt(
  overrides: Partial<HostedAssistantMessageDeliveryReceipt> = {},
): HostedAssistantMessageDeliveryReceipt {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent-1",
    messageLength: 27,
    providerMessageId: "provider-message-1",
    providerThreadId: "provider-thread-1",
    sentAt: "2026-04-08T00:00:05.000Z",
    target: "chat-1",
    targetKind: "participant" as const,
    ...overrides,
  };
}

describe("hosted assistant delivery contracts", () => {
  it("reuses gateway-owned delivery target kinds", () => {
    expect(hostedAssistantDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues);
  });

  it("parses canonical assistant-delivery side effects", () => {
    const media = [
      {
        alt: "Dead bug setup",
        kind: "image" as const,
        source: "dead-bug-setup",
        url: "https://cdn.example.test/dead-bug/setup.png",
      },
      {
        filename: "memo.mp3",
        kind: "voice_memo" as const,
        mimeType: "audio/mpeg" as const,
        modelId: "eleven_multilingual_v2",
        sizeBytes: 128,
        source: "elevenlabs" as const,
        transcript: "Short memo.",
        transportRefs: {
          linq: {
            attachmentId: "attachment_voice_1",
          },
        },
        url: null,
        voiceId: "voice_murph",
      },
    ];
    const payload = [{
      deliveryPhase: "foreground_current_turn",
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload({ media }),
    }];

    expect(parseHostedAssistantDeliverySideEffects(payload)).toEqual(payload);
  });

  it("parses Telegram assistant-delivery voice memo media without audio bytes", () => {
    const payload = createHostedAssistantDeliveryPayload({
      media: [{
        filename: "memo.mp3",
        kind: "voice_memo",
        mimeType: "audio/mpeg",
        modelId: "eleven_multilingual_v2",
        sizeBytes: null,
        source: "elevenlabs",
        transcript: "Short memo.",
        transportRefs: {
          telegram: {
            sendMode: "generate_at_delivery",
          },
        },
        url: null,
        voiceId: "voice_murph",
      }],
      message: "",
    });

    expect(
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe-1",
        effectId: "intent-1",
        payload,
      }).payload,
    ).toEqual(payload);
  });

  it("rejects assistant-delivery voice memo media without a transport ref", () => {
    expect(() =>
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe-1",
        effectId: "intent-1",
        payload: createHostedAssistantDeliveryPayload({
          media: [{
            filename: "memo.mp3",
            kind: "voice_memo",
            mimeType: "audio/mpeg",
            modelId: "eleven_multilingual_v2",
            sizeBytes: 128,
            source: "elevenlabs",
            transcript: "Short memo.",
            transportRefs: {},
            url: null,
            voiceId: "voice_murph",
          } as unknown as HostedAssistantDeliveryMedia],
        }),
      }),
    ).toThrow("payload.media[0].transportRefs must include linq or telegram.");
  });

  it("rejects assistant-delivery voice memo URL media", () => {
    expect(() =>
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe-1",
        effectId: "intent-1",
        payload: createHostedAssistantDeliveryPayload({
          media: [{
            filename: "memo.mp3",
            kind: "voice_memo",
            mimeType: "audio/mpeg",
            modelId: "eleven_multilingual_v2",
            sizeBytes: 128,
            source: "elevenlabs",
            transcript: "Short memo.",
            transportRefs: {
              linq: {
                attachmentId: "attachment_voice_1",
              },
            },
            url: "https://cdn.example.test/memo.mp3",
            voiceId: "voice_murph",
          } as unknown as HostedAssistantDeliveryMedia],
        }),
      }),
    ).toThrow("payload.media[0].url must be null.");
  });

  it("parses media-only assistant delivery with an empty message", () => {
    const payload = createHostedAssistantDeliveryPayload({
      media: [{
        filename: "memo.mp3",
        kind: "voice_memo",
        mimeType: "audio/mpeg",
        modelId: "eleven_multilingual_v2",
        sizeBytes: 128,
        source: "elevenlabs",
        transcript: "Short memo.",
        transportRefs: {
          linq: {
            attachmentId: "attachment_voice_1",
          },
        },
        url: null,
        voiceId: "voice_murph",
      }],
      message: "",
    });

    expect(
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe-1",
        effectId: "intent-1",
        payload,
      }).payload,
    ).toEqual(payload);
  });

  it("rejects assistant-delivery side-effect media without HTTPS URLs", () => {
    expect(() =>
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe-1",
        effectId: "intent-1",
        payload: createHostedAssistantDeliveryPayload({
          media: [{
            alt: null,
            kind: "image",
            source: null,
            url: "http://cdn.example.test/dead-bug/setup.png",
          }],
        }),
      }),
    ).toThrow("payload.media[0].url must use HTTPS");
  });

  it("builds canonical effects and sending records with only the canonical effect id", () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-1",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent-1",
      payload: createHostedAssistantDeliveryPayload(),
    });
    expect(effect.deliveryPhase).toBe("foreground_current_turn");
    const record = buildHostedAssistantDeliverySendingRecord({
      attempt: createHostedAssistantDeliveryAttempt({
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-12T00:00:00.000Z",
        target: null,
        targetKind: null,
      }),
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
    });

    expect(effect).toEqual({
      deliveryPhase: "foreground_current_turn",
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    });
    expect(record).toEqual({
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-12T00:00:00.000Z",
        target: null,
        targetKind: null,
      },
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      recordedAt: "2026-04-12T00:00:00.000Z",
      state: "sending",
    });
  });

  it("parses sent assistant delivery records with gateway-owned target kinds", () => {
    const record = parseHostedAssistantDeliveryRecord({
      delivery: {
        channel: "email",
        idempotencyKey: "idem-1",
        messageLength: 42,
        providerMessageId: null,
        providerThreadId: null,
        sentAt: "2026-04-08T00:00:00.000Z",
        target: "alice@example.com",
        targetKind: "participant",
      },
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(record.state).toBe("sent");
    if (record.state !== "sent") {
      throw new Error("Expected a sent assistant delivery record.");
    }

    expect(record.delivery.targetKind).toBe("participant");
  });

  it("builds and parses pending, sending, sent, and failed records", () => {
    const pending = buildHostedAssistantDeliveryPendingRecord({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });
    const sending = buildHostedAssistantDeliverySendingRecord({
      attempt: createHostedAssistantDeliveryAttempt(),
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
    });
    const sent = buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe-1",
      delivery: createHostedAssistantDeliveryReceipt(),
      effectId: "intent-1",
    });
    const failed = buildHostedAssistantDeliveryFailedRecord({
      attempt: createHostedAssistantDeliveryAttempt(),
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      failure: createHostedAssistantDeliveryFailure(),
    });
    const ambiguous = buildHostedAssistantDeliveryFailedRecord({
      attempt: createHostedAssistantDeliveryAttempt({
        providerMessageId: null,
        providerThreadId: null,
      }),
      dedupeKey: "dedupe-2",
      effectId: "intent-2",
      failure: createHostedAssistantDeliveryFailure({
        code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      }),
      state: "failed_ambiguous",
    });

    expect(parseHostedAssistantDeliveryRecord(pending)).toEqual(pending);
    expect(parseHostedAssistantDeliveryRecord(sending)).toEqual(sending);
    expect(parseHostedAssistantDeliveryRecord(sent)).toEqual(sent);
    expect(parseHostedAssistantDeliveryRecord(failed)).toEqual(failed);
    expect(parseHostedAssistantDeliveryRecord(ambiguous)).toEqual(ambiguous);
  });

  it("rejects removed prepared assistant delivery records", () => {
    expect(() =>
      parseHostedAssistantDeliveryRecord({
        effectId: "effect_prepared",
        fingerprint: "dedupe_prepared",
        kind: "assistant.delivery",
        recordedAt: "2026-04-08T00:00:00.000Z",
        state: "prepared",
      }),
    ).toThrow("Unsupported hosted assistant delivery record state: prepared");
  });

  it("parses individual side effects and rejects unsupported kinds", () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      payload: createHostedAssistantDeliveryPayload(),
    });

    expect(parseHostedAssistantDeliverySideEffect(effect)).toEqual(effect);
    expect(() =>
      parseHostedAssistantDeliverySideEffect({
        effectId: "intent-1",
        fingerprint: "dedupe-1",
        kind: "unsupported.kind",
        payload: createHostedAssistantDeliveryPayload(),
      }),
    ).toThrow("Unsupported hosted assistant delivery kind");
  });

  it("compares hosted side-effect identities, attempts, failures, and receipts", () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      payload: createHostedAssistantDeliveryPayload(),
    });
    const sameEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      payload: createHostedAssistantDeliveryPayload({
        message: "changed payload is ignored for identity equality",
      }),
    });
    const differentEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-2",
      effectId: "intent-2",
      payload: createHostedAssistantDeliveryPayload(),
    });
    const attempt = createHostedAssistantDeliveryAttempt();
    const sameAttempt = createHostedAssistantDeliveryAttempt();
    const differentAttempt = createHostedAssistantDeliveryAttempt({
      providerThreadId: "provider-thread-2",
    });
    const failure = createHostedAssistantDeliveryFailure();
    const sameFailure = createHostedAssistantDeliveryFailure();
    const differentFailure = createHostedAssistantDeliveryFailure({
      failedAt: "2026-04-08T00:01:00.000Z",
    });
    const receipt = createHostedAssistantDeliveryReceipt();
    const sameReceipt = createHostedAssistantDeliveryReceipt();
    const differentReceipt = createHostedAssistantDeliveryReceipt({
      target: "chat-2",
    });

    expect(sameHostedAssistantDeliverySideEffectIdentity(effect, sameEffect)).toBe(true);
    expect(sameHostedAssistantDeliverySideEffectIdentity(effect, differentEffect)).toBe(false);
    expect(sameHostedAssistantDeliveryAttempt(attempt, sameAttempt)).toBe(true);
    expect(sameHostedAssistantDeliveryAttempt(attempt, differentAttempt)).toBe(false);
    expect(sameHostedAssistantDeliveryFailure(failure, sameFailure)).toBe(true);
    expect(sameHostedAssistantDeliveryFailure(failure, differentFailure)).toBe(false);
    expect(sameHostedAssistantDeliveryReceipt(receipt, sameReceipt)).toBe(true);
    expect(sameHostedAssistantDeliveryReceipt(receipt, differentReceipt)).toBe(false);
  });
});
