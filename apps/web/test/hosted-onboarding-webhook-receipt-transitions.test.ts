import assert from "node:assert/strict";

import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
} from "@murphai/hosted-execution";
import { beforeEach, describe, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      encryptionKey: "test-hosted-contact-privacy-key",
      encryptionKeyVersion: "v1",
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      sessionCookieName: "hosted_session",
      sessionTtlDays: 30,
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
        message: "Welcome aboard",
        replyToMessageId: "msg_123",
        sourceEventId: "evt_123",
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

  it("stores sparse Linq dispatch payloads from creation time and preserves them when sent", () => {
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

    if ("dispatch" in dispatchEffect.payload) {
      throw new Error("Expected a sparse dispatch payload reference.");
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

    if ("dispatch" in nextEffect.payload) {
      throw new Error("Expected a sparse dispatch payload reference.");
    }

    assert.equal(nextEffect.status, "sent");
    assert.equal(nextEffect.payload.storage, "reference");
    assert.equal(nextEffect.payload.phoneLookupKey, "hbidx:phone:v1:test");
    const linqEvent = nextEffect.payload.linqEvent as Record<string, unknown>;
    const linqData = linqEvent.data as Record<string, unknown>;
    const linqMessage = linqData.message as Record<string, unknown>;
    const linqReply = linqMessage.reply_to as Record<string, unknown>;

    assert.equal(linqEvent.unused, undefined);
    assert.equal(typeof linqData.chat_id, "string");
    assert.match(linqData.chat_id as string, /^hbid:linq\.chat:v1:/);
    assert.equal(typeof linqData.from, "string");
    assert.match(linqData.from as string, /^hbid:linq\.from:v1:/);
    assert.equal(typeof linqData.recipient_phone, "string");
    assert.match(linqData.recipient_phone as string, /^hbid:linq\.recipient:v1:/);
    assert.equal(typeof linqMessage.id, "string");
    assert.match(linqMessage.id as string, /^hbid:linq\.message:v1:/);
    assert.equal(typeof linqReply.message_id, "string");
    assert.match(linqReply.message_id as string, /^hbid:linq\.message:v1:/);
    assert.deepEqual(nextEffect.result, { dispatched: true });
  });

  it("stores sparse Telegram snapshots from creation time and preserves them when sent", () => {
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
        botUserId: "999",
        eventId: "evt_tg_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        telegramUpdate: {
          update_id: 123,
          message: {
            animation: {
              file_id: "anim_123",
              file_name: "anim.gif",
              file_size: 10,
              file_unique_id: "uniq_anim_123",
              mime_type: "image/gif",
              secret: "drop",
            },
            caption: "hello",
            chat: {
              first_name: "Jane",
              id: 456,
              type: "private",
              username: "jane",
              unused: "drop",
            },
            contact: {
              first_name: "Jane",
              phone_number: "+15551234567",
              secret: "drop",
              user_id: 456,
              vcard: "BEGIN:VCARD",
            },
            date: 1711454400,
            document: {
              file_id: "doc_123",
              file_name: "file.pdf",
              file_size: 42,
              file_unique_id: "uniq_doc_123",
              mime_type: "application/pdf",
              secret: "drop",
            },
            from: {
              first_name: "Jane",
              id: 456,
              is_bot: false,
              username: "jane",
              unused: true,
            },
            message_id: 789,
            photo: [
              {
                file_id: "photo_123",
                file_name: "photo.jpg",
                file_size: 12,
                file_unique_id: "uniq_photo_123",
                height: 100,
                mime_type: "image/jpeg",
                width: 200,
                unused: "drop",
              },
            ],
            reply_to_message: {
              chat: {
                id: 456,
                type: "private",
              },
              date: 1711454300,
              from: {
                first_name: "Bot",
                id: 999,
                is_bot: true,
              },
              message_id: 700,
              text: "prior",
              unused: "drop",
            },
            sender_business_bot: {
              first_name: "Bot",
              id: 999,
              is_bot: true,
            },
            text: "hello",
            unknown_field: "drop",
          },
        },
        userId: "member_123",
      }),
    });

    if ("dispatch" in dispatchEffect.payload) {
      throw new Error("Expected a sparse dispatch payload reference.");
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

    if ("dispatch" in nextEffect.payload) {
      throw new Error("Expected a sparse dispatch payload reference.");
    }

    assert.deepEqual(nextEffect.payload.telegramUpdate, {
      business_message: null,
      message: {
        animation: {
          file_id: "anim_123",
          file_name: "anim.gif",
          file_size: 10,
          file_unique_id: "uniq_anim_123",
          mime_type: "image/gif",
        },
        audio: null,
        caption: "hello",
        chat: {
          first_name: "Jane",
          id: 456,
          type: "private",
          username: "jane",
        },
        contact: {
          first_name: "Jane",
          phone_number: "+15551234567",
          user_id: 456,
          vcard: "BEGIN:VCARD",
        },
        date: 1711454400,
        direct_messages_topic: null,
        document: {
          file_id: "doc_123",
          file_name: "file.pdf",
          file_size: 42,
          file_unique_id: "uniq_doc_123",
          mime_type: "application/pdf",
        },
        from: {
          first_name: "Jane",
          id: 456,
          is_bot: false,
          username: "jane",
        },
        location: null,
        message_id: 789,
        photo: [
          {
            file_id: "photo_123",
            file_name: "photo.jpg",
            file_size: 12,
            file_unique_id: "uniq_photo_123",
            height: 100,
            mime_type: "image/jpeg",
            width: 200,
          },
        ],
        poll: null,
        quote: null,
        reply_to_message: {
          chat: {
            id: 456,
            type: "private",
          },
          contact: null,
          date: 1711454300,
          from: {
            first_name: "Bot",
            id: 999,
            is_bot: true,
          },
          location: null,
          message_id: 700,
          poll: null,
          quote: null,
          sender_business_bot: null,
          sender_chat: null,
          text: "prior",
          venue: null,
        },
        sender_business_bot: {
          first_name: "Bot",
          id: 999,
          is_bot: true,
        },
        sender_chat: null,
        sticker: null,
        text: "hello",
        venue: null,
        video: null,
        video_note: null,
        voice: null,
      },
      update_id: 123,
    });
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
