import { describe, expect, it } from "vitest";
import { Prisma, type Prisma as PrismaNamespace } from "@prisma/client";

import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptSideEffect,
} from "@/src/lib/hosted-onboarding/webhook-receipt-codec";
import { createHostedWebhookLinqMessageSideEffect } from "@/src/lib/hosted-onboarding/webhook-receipt-types";

const RECEIVED_AT = new Date("2026-04-12T00:00:00.000Z");

function buildReceiptRecord() {
  return {
    attemptCount: 1,
    attemptId: "attempt-1",
    completedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorName: null,
    lastErrorRetryable: null,
    lastReceivedAt: RECEIVED_AT,
    plannedAt: null,
    status: "processing",
  };
}

function buildLinqSideEffectRecord(
  resultJson: PrismaNamespace.InputJsonValue | PrismaNamespace.JsonValue | null,
) {
  return {
    attemptCount: 0,
    effectId: "effect-1",
    kind: "linq_message_send",
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorName: null,
    lastErrorRetryable: null,
    payloadJson: {
      chatId: "chat-1",
      replyToMessageId: null,
      template: "daily_quota",
    },
    resultJson,
    sentAt: null,
    status: "pending",
  };
}

describe("readHostedWebhookReceiptState", () => {
  it("reads Linq side effects in the delivered-only shape", () => {
    const state = readHostedWebhookReceiptState({
      receipt: buildReceiptRecord(),
      sideEffects: [buildLinqSideEffectRecord({ delivered: true })],
    });

    expect(state.sideEffects).toHaveLength(1);
    const [sideEffect] = state.sideEffects;
    expect(sideEffect?.kind).toBe("linq_message_send");

    if (!sideEffect || sideEffect.kind !== "linq_message_send") {
      throw new Error("Expected a Linq side effect.");
    }

    expect(sideEffect.result).toEqual({ delivered: true });
  });

  it("fails closed on legacy Linq side-effect result payloads", () => {
    expect(() => readHostedWebhookReceiptState({
      receipt: buildReceiptRecord(),
      sideEffects: [buildLinqSideEffectRecord({
        chatId: "chat-1",
        messageId: "message-1",
      })],
    })).toThrow("Hosted webhook Linq message side effect result is invalid.");
  });

  it("round-trips redirect payloads with both member routing and fallback phone state", () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      homeRecipientPhone: "+15555550100",
      memberId: "member-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "conversation_home_redirect",
    });
    const serialized = serializeHostedWebhookReceiptSideEffect(effect);
    const resultJson =
      serialized.resultJson === Prisma.DbNull
        ? null
        : serialized.resultJson as PrismaNamespace.InputJsonValue | PrismaNamespace.JsonValue | null;

    const state = readHostedWebhookReceiptState({
      receipt: buildReceiptRecord(),
      sideEffects: [
        {
          effectId: effect.effectId,
          ...serialized,
          resultJson,
        },
      ],
    });

    expect(state.sideEffects).toEqual([
      expect.objectContaining({
        kind: "linq_message_send",
        payload: {
          chatId: "chat-1",
          homeRecipientPhone: "+15555550100",
          memberId: "member-1",
          replyToMessageId: "message-1",
          template: "conversation_home_redirect",
        },
      }),
    ]);
  });

  it("serializes daily quota payloads without unrelated invite or member fields", () => {
    const effect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat-1",
      replyToMessageId: "message-1",
      sourceEventId: "event-1",
      template: "daily_quota",
    });

    expect(serializeHostedWebhookReceiptSideEffect(effect).payloadJson).toEqual({
      chatId: "chat-1",
      replyToMessageId: "message-1",
      template: "daily_quota",
    });
  });
});
