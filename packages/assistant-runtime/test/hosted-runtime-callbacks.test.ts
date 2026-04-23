import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPayload,
} from "@murphai/hosted-execution/side-effects";
import type { HostedEmailSendRequest } from "../src/hosted-email.ts";

const mocks = vi.hoisted(() => ({
  createAssistantDeliveryAmbiguousError: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  markAssistantOutboxIntentMirrorTerminalById: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  readAssistantOutboxIntentMirrorState: vi.fn(),
  sendTelegramMessage: vi.fn(),
  shouldDispatchAssistantOutboxIntent: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("@murphai/assistant-engine", () => ({
  createAssistantDeliveryAmbiguousError:
    mocks.createAssistantDeliveryAmbiguousError,
  dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById:
    mocks.markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  readAssistantOutboxIntentMirrorState:
    mocks.readAssistantOutboxIntentMirrorState,
  sendTelegramMessage: mocks.sendTelegramMessage,
  shouldDispatchAssistantOutboxIntent: mocks.shouldDispatchAssistantOutboxIntent,
}));

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
} from "../src/hosted-runtime/callbacks.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const HOSTED_WAKE = {
  wake: buildHostedExecutionRuntimeTimerWake({
    eventId: "evt_123",
    occurredAt: "2026-04-08T00:00:00.000Z",
    triggerKind: "runtime_timer",
    userId: "member_123",
  }),
  vaultRoot: "/tmp/hosted-vault",
} as const;

function createPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    message: "hello from hosted",
    subject: null,
    replyToMessageId: null,
    sessionId: "session_123",
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
    ...overrides,
  };
}

function createEffect(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
) {
  return buildHostedAssistantDeliveryEffect({
    dedupeKey: "dedupe_123",
    effectId: "intent_123",
    payload: createPayload(overrides),
  });
}

function createDelivery(overrides: Record<string, unknown> = {}) {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent_123",
    messageLength: 17,
    providerMessageId: "provider_123",
    providerThreadId: "thread_123",
    sentAt: "2026-04-08T00:01:00.000Z",
    target: "chat_123",
    targetKind: "participant" as const,
    ...overrides,
  };
}

function createMirrorState(
  intentOverrides: Record<string, unknown> | null,
  overrides: {
    sendingPastGraceWindow?: boolean;
    sendingStartedAt?: string | null;
  } = {},
) {
  return {
    intent: intentOverrides,
    sendingPastGraceWindow: overrides.sendingPastGraceWindow ?? false,
    sendingStartedAt: overrides.sendingStartedAt ?? null,
  };
}

function createDispatchResult(
  intentOverrides: Record<string, unknown>,
  deliveryError: { code: string | null; message: string } | null = null,
) {
  return {
    deliveryError,
    intent: {
      delivery: null,
      intentId: "intent_123",
      lastError: deliveryError,
      status: "pending",
      ...intentOverrides,
    },
    session: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAssistantDeliveryAmbiguousError.mockImplementation((cause?: { message?: string }) => ({
    code: "ASSISTANT_DELIVERY_AMBIGUOUS",
    message: cause?.message ?? "ambiguous",
    retryable: false,
  }));
  mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
    createDispatchResult({
      delivery: createDelivery(),
      status: "sent",
    }),
  );
  mocks.normalizeAssistantDeliveryError.mockImplementation((error: Error & { code?: string | null }) => ({
    code: error.code ?? null,
    message: error.message,
  }));
  mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
    createMirrorState({
      delivery: null,
      intentId: "intent_123",
      lastError: null,
      status: "pending",
    }),
  );
  mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(true);
});

describe("hosted runtime callbacks", () => {
  it("collects dispatchable effects with the committed payload contract", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "chat_1" },
        channel: "telegram",
        dedupeKey: "dedupe_1",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_1",
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects("/tmp/vault");

    expect(sideEffects).toEqual([
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_1",
        effectId: "intent_1",
        payload: {
          actorId: "actor_1",
          bindingDeliveryKind: "participant",
          bindingDeliveryTarget: "chat_1",
          channel: "telegram",
          explicitTarget: null,
          idempotencyKey: "assistant-outbox:intent_1",
          identityId: "identity_1",
          message: "hello 1",
          subject: null,
          replyToMessageId: null,
          sessionId: "session_1",
          threadId: "thread_1",
          threadIsDirect: true,
          transportIdempotent: false,
          turnId: "turn_1",
        },
      }),
    ]);
  });

  it("rejects hosted email participant routes before collecting committed delivery effects", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "user@example.com" },
        channel: "email",
        dedupeKey: "dedupe_email_participant",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "assistant@example.com",
        intentId: "intent_email_participant",
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    await expect(
      collectHostedAssistantDeliverySideEffects("/tmp/vault"),
    ).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    });
  });

  it("returns sent without re-dispatching when the outbox mirror already has a sent record", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: createDelivery(),
        intentId: effect.effectId,
        lastError: null,
        status: "sent",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("returns missing-result when the outbox mirror marks a delivery sent without a receipt", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: null,
        intentId: effect.effectId,
        lastError: null,
        status: "sent",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
        deliveryStatus: "missing-result",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("waits on an in-flight sending mirror state instead of dispatching again", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        intentId: effect.effectId,
        lastError: null,
        status: "sending",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sending",
        retryable: true,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("re-dispatches an idempotent stale sending mirror state instead of abandoning it", async () => {
    const effect = createEffect({ transportIdempotent: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: true,
          sendingStartedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledWith({
      dependencies: expect.any(Object),
      intentId: effect.effectId,
      now: expect.any(Date),
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    );
    vi.useRealTimers();
  });

  it("surfaces terminal failed mirror state without dispatching again", async () => {
    const effect = createEffect({ transportIdempotent: false });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        intentId: effect.effectId,
        lastError: {
          code: "ASSISTANT_DELIVERY_FAILED",
          message: "telegram rejected the message",
        },
        status: "failed",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_FAILED",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("returns retryable without dispatching when the mirror scheduled a later retry", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        intentId: effect.effectId,
        lastError: {
          code: "ASSISTANT_DELIVERY_UNAVAILABLE",
          message: "provider retry scheduled",
        },
        status: "retryable",
      }),
    );
    mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(false);

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_UNAVAILABLE",
        deliveryStatus: "retryable",
        retryable: true,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("ages a stale non-idempotent sending record into terminal ambiguity", async () => {
    const effect = createEffect({ transportIdempotent: false });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: true,
          sendingStartedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "abandoned",
        vault: HOSTED_WAKE.vaultRoot,
      }),
    );
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns failed_ambiguous from an abandoned portable outbox mirror without dispatching again", async () => {
    const effect = createEffect({ transportIdempotent: false });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: createDelivery({
          cleanupMessages: [{ messageId: "1001", target: "123" }],
          cleanupTargetAliases: ["123"],
          providerMessageIds: ["1001"],
          target: "456",
        }),
        intentId: effect.effectId,
        lastError: {
          code: "ASSISTANT_DELIVERY_AMBIGUOUS",
          message: "mirror abandoned the delivery",
        },
        status: "abandoned",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        cleanupMessages: [{ messageId: "1001", target: "123" }],
        cleanupTargetAliases: ["123"],
        deliveryStatus: "failed_ambiguous",
        providerMessageIds: ["1001"],
        retryable: false,
        target: "456",
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("dispatches due effects through the shared outbox mirror flow", async () => {
    const effect = createEffect();
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
      createDispatchResult({
        delivery: createDelivery(),
        status: "sent",
      }),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledWith({
      dependencies: expect.any(Object),
      intentId: effect.effectId,
      now: expect.any(Date),
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    );
  });

  it("routes Telegram deliveries through the shared Telegram runtime with platform-backed env", async () => {
    const effect = createEffect();
    mocks.sendTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "provider_123",
      target: "chat_123",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: "chat_123",
      });

      return createDispatchResult({
        delivery: createDelivery({
          providerMessageId: delivery.providerMessageId,
          target: delivery.target,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      forwardedEnv: {
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith({
      idempotencyKey: "assistant-outbox:intent_123",
      message: "hello from hosted",
      replyToMessageId: null,
      target: "chat_123",
    }, {
      env: {
        OPENAI_API_KEY: "sk-runtime",
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
  });

  it("routes hosted email thread deliveries through the shared effects port", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "thread_123",
      channel: "email",
      explicitTarget: "thread_123",
      identityId: "assistant@example.com",
      subject: "Hosted subject",
    });
    const sendEmail = vi.fn(async (request: HostedEmailSendRequest) =>
      createDelivery({
        channel: "email",
        ...request,
      })
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        identityId: "assistant@example.com",
        message: "hello from hosted",
        subject: "Hosted subject",
        target: "thread_123",
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery,
        status: "sent",
      });
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(sendEmail).toHaveBeenCalledWith({
      identityId: "assistant@example.com",
      message: "hello from hosted",
      subject: "Hosted subject",
      target: "thread_123",
      targetKind: "thread",
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "email",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("rejects hosted email participant routes before dispatching", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "participant",
      bindingDeliveryTarget: "user@example.com",
      channel: "email",
      explicitTarget: null,
      identityId: "assistant@example.com",
    });

    await expect(
      drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        wake: HOSTED_WAKE.wake,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    });
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("promotes non-idempotent confirmation-pending retries into abandoned terminal state", async () => {
    const effect = createEffect({ transportIdempotent: false });
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
      createDispatchResult(
        {
          lastError: {
            code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
            message: "telegram timeout",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "telegram timeout",
        },
      ),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "abandoned",
      }),
    );
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    );
  });

  it("keeps an ambiguous confirmation-pending outcome when mirror sync logging is best effort", async () => {
    const effect = createEffect({ transportIdempotent: false });
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
      createDispatchResult(
        {
          delivery: createDelivery({
            cleanupMessages: [{ messageId: "1001", target: "123" }],
            cleanupTargetAliases: ["123"],
            providerMessageIds: ["1001"],
            target: "456",
          }),
          lastError: {
            code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
            message: "telegram timeout",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "telegram timeout",
        },
      ),
    );
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockRejectedValueOnce(
      new Error("mirror write failed"),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        cleanupMessages: [{ messageId: "1001", target: "123" }],
        cleanupTargetAliases: ["123"],
        deliveryStatus: "failed_ambiguous",
        providerMessageIds: ["1001"],
        retryable: false,
        target: "456",
      }),
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted assistant delivery local mirror update failed.",
      }),
    );
  });

  it("keeps idempotent confirmation-pending retries retryable instead of abandoning them", async () => {
    const effect = createEffect({ transportIdempotent: true });
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
      createDispatchResult(
        {
          lastError: {
            code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
            message: "telegram timeout",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "telegram timeout",
        },
      ),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "retryable",
        retryable: true,
      }),
    );
  });

  it("keeps idempotent failures retryable on the shared outbox mirror", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "thread_123",
      channel: "linq",
      explicitTarget: "thread_123",
      transportIdempotent: true,
    });
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
      createDispatchResult(
        {
          lastError: {
            code: "ASSISTANT_DELIVERY_UNAVAILABLE",
            message: "linq temporarily unavailable",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_UNAVAILABLE",
          message: "linq temporarily unavailable",
        },
      ),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "retryable",
        retryable: true,
      }),
    );
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
  });

  it("returns missing-result when the committed outbox intent disappeared", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(null),
    );

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
        deliveryStatus: "missing-result",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it.each([
    {
      deliveryError: {
        code: "ASSISTANT_DELIVERY_FAILED",
        message: "failed",
      },
      expectedStatus: "failed",
      inputStatus: "failed",
      retryable: false,
    },
    {
      deliveryError: {
        code: "ASSISTANT_DELIVERY_UNAVAILABLE",
        message: "sending",
      },
      expectedStatus: "sending",
      inputStatus: "sending",
      retryable: true,
    },
    {
      deliveryError: {
        code: "ASSISTANT_DELIVERY_UNAVAILABLE",
        message: "pending",
      },
      expectedStatus: "pending",
      inputStatus: "pending",
      retryable: true,
    },
    {
      deliveryError: {
        code: "ASSISTANT_DELIVERY_AMBIGUOUS",
        message: "abandoned",
      },
      expectedStatus: "failed_ambiguous",
      inputStatus: "abandoned",
      retryable: false,
    },
    {
      deliveryError: {
        code: "ASSISTANT_DELIVERY_UNAVAILABLE",
        message: "unsupported",
      },
      expectedStatus: "missing-result",
      inputStatus: "unsupported",
      retryable: false,
    },
  ])(
    "maps dispatched %s outbox states into hosted delivery outcomes",
    async ({ deliveryError, expectedStatus, inputStatus, retryable }) => {
      const effect = createEffect();
      mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
        createDispatchResult(
          {
            lastError: deliveryError,
            status: inputStatus,
          },
          deliveryError,
        ),
      );

      const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        wake: HOSTED_WAKE.wake,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
      });

      expect(outcomes).toEqual([
        expect.objectContaining({
          deliveryErrorCode: inputStatus === "unsupported" ? "ASSISTANT_DELIVERY_MISSING_RESULT" : deliveryError.code,
          deliveryStatus: expectedStatus,
          retryable,
        }),
      ]);
    },
  );

  it("rethrows outbox dispatch failures with effect details attached", async () => {
    const effect = createEffect();
    mocks.dispatchAssistantOutboxIntent.mockRejectedValue(new Error("boom"));

    await expect(
      drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        wake: HOSTED_WAKE.wake,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        effectFingerprint: effect.fingerprint,
        effectId: effect.effectId,
        userId: HOSTED_WAKE.wake.userId,
      }),
      message: "boom",
    });
  });

  it("logs retryable dispatch context when the shared email dependency rejects participant targets", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "thread_123",
      channel: "email",
      explicitTarget: "thread_123",
      identityId: "assistant@example.com",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendEmail({
          identityId: "assistant@example.com",
          message: "hello from hosted",
          subject: null,
          target: "thread_123",
          targetKind: "participant",
        });
      } catch {
        throw {
          context: {
            retryable: true,
          },
          message: "delivery unavailable",
        };
      }
      throw new Error("expected shared email dependency to reject participant targets");
    });

    await expect(
      drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        wake: HOSTED_WAKE.wake,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        effectFingerprint: effect.fingerprint,
        effectId: effect.effectId,
        userId: HOSTED_WAKE.wake.userId,
      }),
      message: "delivery unavailable",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          retryable: true,
        }),
        message: "Hosted assistant delivery threw during post-commit delivery.",
      }),
    );
  });
});
