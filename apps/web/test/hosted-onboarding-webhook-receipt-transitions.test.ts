import assert from "node:assert/strict";

import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
} from "@murphai/hosted-execution";
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

import {
  getHostedWebhookSideEffect,
  markHostedWebhookReceiptSideEffectFailed,
  markHostedWebhookReceiptSideEffectSent,
  queueHostedWebhookReceiptSideEffects,
} from "../src/lib/hosted-onboarding/webhook-receipt-transitions";
import { isHostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptState,
} from "../src/lib/hosted-onboarding/webhook-receipt-codec";
import { buildHostedWebhookDispatchFromPayload } from "../src/lib/hosted-onboarding/webhook-receipt-dispatch";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookReceiptState,
} from "../src/lib/hosted-onboarding/webhook-receipt-types";

describe("hosted webhook receipt transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores planning metadata even when planning produces no side effects", () => {
    const response = {
      ignored: true,
      ok: true,
      reason: "no-trigger",
    };

    const nextState = queueHostedWebhookReceiptSideEffects(buildReceiptState(), [], {
      plannedAt: "2026-03-26T12:01:00.000Z",
      response,
    });

    assert.equal(nextState.plannedAt, "2026-03-26T12:01:00.000Z");
    assert.deepEqual(nextState.response, response);
    assert.deepEqual(nextState.sideEffects, []);
  });

  it("preserves a terminal side-effect status when recording a follow-up failure", () => {
    const sideEffect = {
      ...createHostedWebhookLinqMessageSideEffect({
        chatId: "chat_123",
        inviteId: "invite_123",
        replyToMessageId: "msg_123",
        sourceEventId: "evt_123",
        template: "invite_signup",
      }),
      lastError: {
        code: null,
        message: "Delivery is still pending provider confirmation.",
        name: "Error",
        retryable: true,
      },
      result: {
        chatId: "chat_123",
        messageId: "out_123",
      },
      sentAt: "2026-03-26T12:00:30.000Z",
      status: "sent_unconfirmed" as const,
    };

    const nextState = markHostedWebhookReceiptSideEffectFailed(
      buildReceiptState({ sideEffects: [sideEffect] }),
      sideEffect.effectId,
      new Error("Delivery confirmation timed out."),
    );
    const nextEffect = getHostedWebhookSideEffect(nextState, sideEffect.effectId);

    assert.equal(nextEffect.status, "sent_unconfirmed");
    assert.equal(nextEffect.lastError?.message, "Delivery confirmation timed out.");
  });

  it("stores pending Linq dispatch payloads from creation time and preserves them when sent", () => {
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: "evt_123",
        linqEvent: {
          api_version: "2026-03-26",
          created_at: "2026-03-26T12:00:00.000Z",
          data: {
            chat_id: "chat_123",
            from: "+15551234567",
            is_from_me: false,
            message: {
              effect: {
                ignored: "value",
                name: "confetti",
                type: "animation",
              },
              id: "msg_123",
              parts: [
                {
                  type: "text",
                  value: "hello",
                },
                {
                  attachment_id: "att_123",
                  filename: "photo.jpg",
                  mime_type: "image/jpeg",
                  size: 123,
                  type: "image",
                  url: "https://example.test/photo.jpg",
                },
              ],
              reply_to: {
                message_id: "msg_parent",
                part_index: 1,
                unused: true,
              },
            },
            received_at: "2026-03-26T12:00:00.000Z",
            recipient_phone: "+15550000000",
            service: "imessage",
          },
          event_id: "evt_123",
          event_type: "message.received",
          partner_id: "partner_123",
          trace_id: "trace_123",
          unused: "discard-me",
        },
        occurredAt: "2026-03-26T12:00:00.000Z",
        phoneLookupKey: "hbidx:phone:v1:test",
        userId: "member_123",
      }),
    });

    if (!("dispatch" in dispatchEffect.payload)) {
      throw new Error("Expected an in-memory pending dispatch payload.");
    }

    const nextState = markHostedWebhookReceiptSideEffectSent(
      buildReceiptState({ sideEffects: [dispatchEffect] }),
      dispatchEffect.effectId,
      { dispatched: true },
      "2026-03-26T12:00:30.000Z",
    );
    const nextEffect = getHostedWebhookSideEffect(nextState, dispatchEffect.effectId);

    assert.equal(nextEffect.kind, "hosted_execution_dispatch");
    if (nextEffect.kind !== "hosted_execution_dispatch") {
      throw new Error("Expected a hosted execution dispatch side effect.");
    }

    if (!("dispatch" in nextEffect.payload)) {
      throw new Error("Expected an in-memory pending dispatch payload.");
    }

    assert.equal(nextEffect.status, "sent");
    assert.equal(nextEffect.payload.storage, "pending");
    const rebuiltDispatch = buildHostedWebhookDispatchFromPayload(nextEffect.payload);
    assert.equal(rebuiltDispatch?.event.kind, "linq.message.received");
    if (rebuiltDispatch?.event.kind !== "linq.message.received") {
      throw new Error("Expected a pending Linq dispatch payload.");
    }

    const linqData = rebuiltDispatch.event.linqEvent.data as {
      chat_id: string;
      from: string;
      recipient_phone: string;
    };
    assert.equal(rebuiltDispatch.event.phoneLookupKey, "hbidx:phone:v1:test");
    assert.equal(linqData.chat_id, "chat_123");
    assert.equal(linqData.from, "+15551234567");
    assert.equal(linqData.recipient_phone, "+15550000000");
    assert.deepEqual(nextEffect.result, { dispatched: true });
  });

  it("persists only staged Linq dispatch refs through receipt serialization", () => {
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: "evt_123",
        linqEvent: {
          api_version: "v1",
          created_at: "2026-03-26T12:00:00.000Z",
          data: {
            chat_id: "chat_123",
            from: "+15551234567",
            is_from_me: false,
            message: {
              id: "msg_123",
              parts: [
                {
                  type: "text",
                  value: "hello",
                },
              ],
            },
            received_at: "2026-03-26T12:00:00.000Z",
            recipient_phone: "+15550000000",
            service: "imessage",
          },
          event_id: "evt_123",
          event_type: "message.received",
        },
        occurredAt: "2026-03-26T12:00:00.000Z",
        phoneLookupKey: "hbidx:phone:v1:test",
        userId: "member_123",
      }),
    });
    const stagedEffect = {
      ...dispatchEffect,
      payload: {
        dispatchRef: {
          eventId: "evt_123",
          eventKind: "linq.message.received" as const,
          occurredAt: "2026-03-26T12:00:00.000Z",
          userId: "member_123",
        },
        payloadRef: {
          key: "dispatch/staged-linq-123",
        },
        schemaVersion: "murph.execution-outbox.v2" as const,
        storage: "reference" as const,
      },
    };

    const persistedState = readHostedWebhookReceiptState(
      serializeHostedWebhookReceiptState(
        buildReceiptState({ sideEffects: [stagedEffect] }),
      ),
    );
    const persistedEffect = getHostedWebhookSideEffect(persistedState, stagedEffect.effectId);

    assert.equal(persistedEffect.kind, "hosted_execution_dispatch");
    if (persistedEffect.kind !== "hosted_execution_dispatch") {
      throw new Error("Expected a hosted execution dispatch side effect.");
    }

    assert.equal(persistedEffect.payload.storage, "reference");
    assert.equal("phoneLookupKey" in persistedEffect.payload, false);
    const rebuiltDispatch = buildHostedWebhookDispatchFromPayload(persistedEffect.payload);
    assert.equal(rebuiltDispatch, null);
  });

  it("fails closed when a persisted Linq side effect still uses the removed plaintext payload shape", () => {
    const sideEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat_123",
      inviteId: "invite_123",
      replyToMessageId: "msg_123",
      sourceEventId: "evt_123",
      template: "invite_signup",
    });
    const payloadJson = {
      eventPayload: {},
      receiptState: {
        attemptCount: 1,
        attemptId: "attempt_123",
        completedAt: null,
        lastError: null,
        lastReceivedAt: null,
        plannedAt: null,
        response: null,
        sideEffects: [
          {
            attemptCount: sideEffect.attemptCount,
            effectId: sideEffect.effectId,
            kind: sideEffect.kind,
            lastAttemptAt: sideEffect.lastAttemptAt,
            lastError: sideEffect.lastError,
            payload: {
              chatId: "chat_123",
              inviteId: "invite_123",
              message: "legacy plaintext invite body",
              replyToMessageId: "msg_123",
            },
            result: null,
            sentAt: sideEffect.sentAt,
            status: sideEffect.status,
          },
        ],
        status: "processing",
      },
    } satisfies Prisma.InputJsonValue;

    try {
      readHostedWebhookReceiptState(payloadJson);
      assert.fail("Expected plaintext Linq payloads to fail closed.");
    } catch (error) {
      assert.equal(isHostedOnboardingError(error), true);
      if (!isHostedOnboardingError(error)) {
        throw error;
      }

      assert.equal(error.code, "WEBHOOK_SIDE_EFFECT_PAYLOAD_INVALID");
      assert.match(error.message, /invalid or legacy payload shape/u);
    }
  });

  it("stores pending Telegram dispatch payloads from creation time and preserves them when sent", () => {
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
        eventId: "evt_tg_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        telegramMessage: {
          attachments: [
            {
              fileId: "photo_123",
              fileName: "photo.jpg",
              fileSize: 12,
              fileUniqueId: "uniq_photo_123",
              height: 100,
              kind: "photo",
              mimeType: "image/jpeg",
              width: 200,
            },
            {
              fileId: "doc_123",
              fileName: "file.pdf",
              fileSize: 42,
              fileUniqueId: "uniq_doc_123",
              kind: "document",
              mimeType: "application/pdf",
            },
            {
              fileId: "anim_123",
              fileName: "anim.gif",
              fileSize: 10,
              fileUniqueId: "uniq_anim_123",
              kind: "animation",
              mimeType: "image/gif",
            },
          ],
          mediaGroupId: "album_7",
          messageId: "789",
          schema: "murph.hosted-telegram-message.v1",
          text: "[shared contact]",
          threadId: "456:business:biz_123:topic:9",
        },
        userId: "member_123",
      }),
    });

    if (!("dispatch" in dispatchEffect.payload)) {
      throw new Error("Expected an in-memory pending dispatch payload.");
    }

    const nextState = markHostedWebhookReceiptSideEffectSent(
      buildReceiptState({ sideEffects: [dispatchEffect] }),
      dispatchEffect.effectId,
      { dispatched: true },
      "2026-03-26T12:00:30.000Z",
    );
    const nextEffect = getHostedWebhookSideEffect(nextState, dispatchEffect.effectId);

    assert.equal(nextEffect.kind, "hosted_execution_dispatch");
    if (nextEffect.kind !== "hosted_execution_dispatch") {
      throw new Error("Expected a hosted execution dispatch side effect.");
    }

    if (!("dispatch" in nextEffect.payload)) {
      throw new Error("Expected an in-memory pending dispatch payload.");
    }

    assert.equal(nextEffect.payload.storage, "pending");
    const rebuiltDispatch = buildHostedWebhookDispatchFromPayload(nextEffect.payload);
    assert.equal(rebuiltDispatch?.event.kind, "telegram.message.received");
    if (rebuiltDispatch?.event.kind !== "telegram.message.received") {
      throw new Error("Expected a pending Telegram dispatch payload.");
    }

    assert.equal(rebuiltDispatch.event.telegramMessage.schema, "murph.hosted-telegram-message.v1");
    assert.equal(rebuiltDispatch.event.telegramMessage.messageId, "789");
    assert.equal(rebuiltDispatch.event.telegramMessage.text, "[shared contact]");
    assert.equal(rebuiltDispatch.event.telegramMessage.threadId, "456:business:biz_123:topic:9");
    assert.equal(rebuiltDispatch.event.telegramMessage.attachments?.length, 3);
  });
});

function buildReceiptState(
  overrides: Partial<HostedWebhookReceiptState> = {},
): HostedWebhookReceiptState {
  return {
    attemptCount: 1,
    attemptId: "attempt_123",
    completedAt: null,
    eventPayload: {
      eventType: "message.received",
    },
    lastError: null,
    lastReceivedAt: "2026-03-26T12:00:00.000Z",
    plannedAt: null,
    response: null,
    sideEffects: [],
    status: "processing",
    ...overrides,
  };
}
