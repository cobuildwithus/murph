import assert from "node:assert/strict";

import { buildHostedExecutionLinqMessageReceivedDispatch } from "@murph/hosted-execution";
import { describe, it } from "vitest";

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

  it("minimizes dispatch payloads after a dispatch side effect is marked sent", () => {
    const dispatchEffect = createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: "evt_123",
        linqEvent: {
          chat_id: "chat_123",
          event_id: "evt_123",
          event_type: "message.received",
        },
        normalizedPhoneNumber: "+15551234567",
        occurredAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      }),
    });

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

    assert.equal(nextEffect.status, "sent");
    if ("dispatch" in nextEffect.payload) {
      throw new Error("Expected a minimized dispatch payload reference.");
    }

    assert.equal(nextEffect.payload.storage, "reference");
    assert.deepEqual(nextEffect.result, { dispatched: true });
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
