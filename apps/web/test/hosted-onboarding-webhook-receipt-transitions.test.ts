import assert from "node:assert/strict";

import { Prisma } from "@prisma/client";
import { beforeEach, describe, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        },
        readVersions: ["v1"],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment",
      stripePriceIdsByPlan: {
        launch_annual: "price_annual_123",
        launch_monthly: "price_monthly_123",
      },
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
  markHostedWebhookReceiptSideEffectSentUnconfirmed,
  queueHostedWebhookReceiptSideEffects,
} from "../src/lib/hosted-onboarding/webhook-receipt-transitions";
import { isHostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptErrorState,
  serializeHostedWebhookReceiptSideEffect,
} from "../src/lib/hosted-onboarding/webhook-receipt-codec";
import {
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookReceiptState,
} from "../src/lib/hosted-onboarding/webhook-receipt-types";

describe("hosted webhook receipt transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores planning metadata even when planning produces no side effects", () => {
    const nextState = queueHostedWebhookReceiptSideEffects(buildReceiptState(), [], {
      plannedAt: "2026-03-26T12:01:00.000Z",
    });

    assert.equal(nextState.plannedAt, "2026-03-26T12:01:00.000Z");
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
      result: { delivered: true as const },
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

  it("fails closed on legacy Linq side-effect terminal result payloads", () => {
    const sideEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat_123",
      inviteId: "invite_123",
      replyToMessageId: "msg_123",
      sourceEventId: "evt_legacy",
      template: "invite_signup",
    });

    assert.throws(
      () =>
        markHostedWebhookReceiptSideEffectSentUnconfirmed(
          buildReceiptState({ sideEffects: [sideEffect] }),
          sideEffect.effectId,
          {
            error: new Error("sent but not confirmed"),
            result: {
              chatId: "chat_123",
              messageId: "msg_123",
            } as never,
            sentAt: "2026-03-26T12:00:30.000Z",
          },
        ),
      /invalid terminal result/u,
    );
  });

  it("fails closed when a persisted Linq side effect is missing the new typed payload columns", () => {
    const sideEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat_123",
      inviteId: "invite_123",
      replyToMessageId: "msg_123",
      sourceEventId: "evt_123",
      template: "invite_signup",
    });
    if (!("inviteId" in sideEffect.payload)) {
      throw new Error("Expected an invite-backed Linq side effect.");
    }
    const persistedState = serializeHostedWebhookReceiptStateRecords(buildReceiptState());

    try {
      readHostedWebhookReceiptState({
        receipt: persistedState.receipt,
        sideEffects: [{
          attemptCount: sideEffect.attemptCount,
          effectId: sideEffect.effectId,
          kind: sideEffect.kind,
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          payloadJson: {
            inviteId: sideEffect.payload.inviteId,
            replyToMessageId: sideEffect.payload.replyToMessageId,
          },
          resultJson: null,
          sentAt: null,
          status: sideEffect.status,
        }],
      });
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

});

function buildReceiptState(
  overrides: Partial<HostedWebhookReceiptState> = {},
): HostedWebhookReceiptState {
  return {
    attemptCount: 1,
    attemptId: "attempt_123",
    completedAt: null,
    lastError: null,
    lastReceivedAt: "2026-03-26T12:00:00.000Z",
    plannedAt: null,
    sideEffects: [],
    status: "processing",
    ...overrides,
  };
}

function serializeHostedWebhookReceiptStateRecords(
  state: HostedWebhookReceiptState,
): Parameters<typeof readHostedWebhookReceiptState>[0] {
  return {
    receipt: {
      attemptCount: state.attemptCount,
      attemptId: state.attemptId,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
      ...serializeHostedWebhookReceiptErrorState(state.lastError),
      lastReceivedAt: new Date(state.lastReceivedAt),
      plannedAt: state.plannedAt ? new Date(state.plannedAt) : null,
      status: state.status,
    },
    sideEffects: state.sideEffects.map((effect) =>
      normalizeSerializedSideEffectForRead(effect.effectId, serializeHostedWebhookReceiptSideEffect(effect))
    ),
  };
}

function normalizeSerializedSideEffectForRead(
  effectId: string,
  effect: ReturnType<typeof serializeHostedWebhookReceiptSideEffect>,
): NonNullable<Parameters<typeof readHostedWebhookReceiptState>[0]["sideEffects"]>[number] {
  const resultJson: Prisma.InputJsonValue | null =
    effect.resultJson === Prisma.DbNull
      ? null
      : effect.resultJson as Prisma.InputJsonValue;

  return {
    effectId,
    ...effect,
    payloadJson: effect.payloadJson as Prisma.InputJsonValue,
    resultJson,
  };
}
