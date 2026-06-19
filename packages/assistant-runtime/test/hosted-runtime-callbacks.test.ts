import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import type {
  AssistantOutboxPreparedDispatchState,
} from "@murphai/assistant-engine";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryMedia,
  type HostedAssistantDeliveryPayload,
} from "@murphai/hosted-execution/side-effects";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import type { HostedEmailSendRequest } from "../src/hosted-email.ts";

const mocks = vi.hoisted(() => ({
  beginAssistantOutboxIntentMirrorDispatch: vi.fn(),
  beginAssistantOutboxIntentMirrorPreparedDispatch: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  markAssistantOutboxIntentMirrorTerminalById: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  readAssistantOutboxIntentMirrorState: vi.fn(),
  resetAssistantOutboxPreparedDispatchById: vi.fn(),
  sendLinqMessage: vi.fn(),
  sendLinqVoiceMemoMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendTelegramVoiceMemoMessage: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
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
  beginAssistantOutboxIntentMirrorDispatch:
    mocks.beginAssistantOutboxIntentMirrorDispatch,
  beginAssistantOutboxIntentMirrorPreparedDispatch:
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch,
  dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById:
    mocks.markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  readAssistantOutboxIntentMirrorState:
    mocks.readAssistantOutboxIntentMirrorState,
  resetAssistantOutboxPreparedDispatchById:
    mocks.resetAssistantOutboxPreparedDispatchById,
  sendLinqMessage: mocks.sendLinqMessage,
  sendTelegramMessage: mocks.sendTelegramMessage,
  sendTelegramVoiceMemoMessage: mocks.sendTelegramVoiceMemoMessage,
  sendWhatsAppMessage: mocks.sendWhatsAppMessage,
  shouldDispatchAssistantOutboxIntent: mocks.shouldDispatchAssistantOutboxIntent,
}));

vi.mock("@murphai/assistant-engine/assistant-channel-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine/assistant-channel-runtime")>(
    "@murphai/assistant-engine/assistant-channel-runtime",
  );
  return {
    ...actual,
    sendLinqMessage: mocks.sendLinqMessage,
    sendLinqVoiceMemoMessage: mocks.sendLinqVoiceMemoMessage,
    sendTelegramVoiceMemoMessage: mocks.sendTelegramVoiceMemoMessage,
  };
});

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  resolveHostedAssistantOutboxNextWakeAt,
} from "../src/hosted-runtime/callbacks.ts";
import {
  HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
} from "../src/hosted-runtime/provider-fetch.ts";
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
const PREPARED_DISPATCH_TOKEN = "prepared-dispatch-token-123";
type HostedVoiceMemoDeliveryMedia = Extract<
  HostedAssistantDeliveryMedia,
  { kind: "voice_memo" }
>;

function createPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    deliverySourceKey: null,
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    media: [],
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

function createHostedVoiceMemoMedia(
  overrides: Partial<HostedVoiceMemoDeliveryMedia> = {},
): HostedVoiceMemoDeliveryMedia {
  return {
    filename: "memo.mp3",
    kind: "voice_memo",
    mimeType: "audio/mpeg",
    modelId: "eleven_multilingual_v2",
    sizeBytes: 128,
    source: "elevenlabs",
    transcript: "Short memo",
    transportRefs: {
      linq: {
        attachmentId: "attachment_voice_1",
      },
    },
    url: null,
    voiceId: "voice_murph",
    ...overrides,
  };
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

function createPreparedPreviousDispatchState(
  overrides: Partial<AssistantOutboxPreparedDispatchState> = {},
): AssistantOutboxPreparedDispatchState {
  return {
    attemptCount: 0,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: "assistant-outbox:intent_123",
    deliveryTransportIdempotent: false,
    lastAttemptAt: null,
    lastError: null,
    nextAttemptAt: null,
    preparedDispatchToken: null,
    status: "pending",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValue(null);
  mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue(null);
  mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(true);
  mocks.beginAssistantOutboxIntentMirrorPreparedDispatch.mockResolvedValue({
    intent: {
      attemptCount: 1,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: false,
      lastAttemptAt: "2026-04-08T00:00:00.000Z",
      lastError: null,
      nextAttemptAt: null,
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      status: "sending",
    },
    ownsDispatch: true,
    preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
    previousDispatchState: {
      attemptCount: 0,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: false,
      lastAttemptAt: null,
      lastError: null,
      nextAttemptAt: null,
      preparedDispatchToken: null,
      status: "pending",
    },
  });
});

describe("hosted runtime callbacks", () => {
  it("does not pre-claim arbitrary non-idempotent delivery effects before provider dispatch", async () => {
    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [createEffect({ transportIdempotent: false })],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation).toEqual({
      preparedDispatches: [],
    });
    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).not.toHaveBeenCalled();
  });

  it("pre-claims non-idempotent voice memo delivery effects before provider dispatch", async () => {
    const previousDispatchState = createPreparedPreviousDispatchState();
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch.mockResolvedValueOnce({
      intent: {
        ...previousDispatchState,
        attemptCount: 1,
        lastAttemptAt: "2026-04-08T00:00:05.000Z",
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        status: "sending",
      },
      ownsDispatch: true,
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      previousDispatchState,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [
        createEffect({
          channel: "linq",
          media: [createHostedVoiceMemoMedia()],
          transportIdempotent: false,
        }),
      ],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: false,
      intentId: "intent_123",
      startedAt: "2026-04-08T00:00:05.000Z",
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(preparation).toEqual({
      preparedDispatches: [
        {
          intentId: "intent_123",
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState,
        },
      ],
    });
  });

  it("pre-claims non-idempotent signup welcome delivery effects before provider dispatch", async () => {
    const previousDispatchState = createPreparedPreviousDispatchState({
      deliveryIdempotencyKey: "signup-welcome:member_placeholder",
    });
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch.mockResolvedValueOnce({
      intent: {
        ...previousDispatchState,
        attemptCount: 1,
        lastAttemptAt: "2026-04-08T00:00:05.000Z",
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        status: "sending",
      },
      ownsDispatch: true,
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      previousDispatchState,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [
        createEffect({
          idempotencyKey: "signup-welcome:member_placeholder",
          message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          transportIdempotent: false,
        }),
      ],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "signup-welcome:member_placeholder",
      deliveryTransportIdempotent: false,
      intentId: "intent_123",
      startedAt: "2026-04-08T00:00:05.000Z",
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(preparation).toEqual({
      preparedDispatches: [
        {
          intentId: "intent_123",
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState,
        },
      ],
    });
  });

  it("does not pre-claim prefix-only non-canonical signup welcome delivery effects", async () => {
    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [
        createEffect({
          idempotencyKey: "signup-welcome:member_placeholder:retry",
          message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
          transportIdempotent: false,
        }),
        createEffect({
          idempotencyKey: "signup-welcome:member_placeholder",
          message: "Fixed setup reminder.",
          transportIdempotent: false,
        }),
      ],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation).toEqual({
      preparedDispatches: [],
    });
    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).not.toHaveBeenCalled();
  });

  it("does not record prepared dispatch ownership for rows owned by another batch", async () => {
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch.mockResolvedValueOnce({
      intent: {
        attemptCount: 1,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_123",
        deliveryTransportIdempotent: true,
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        lastError: null,
        nextAttemptAt: null,
        preparedDispatchToken: "other-prepared-dispatch-token",
        status: "sending",
      },
      ownsDispatch: false,
      preparedDispatchToken: null,
      previousDispatchState: {
        attemptCount: 1,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_123",
        deliveryTransportIdempotent: true,
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        lastError: null,
        nextAttemptAt: null,
        preparedDispatchToken: "other-prepared-dispatch-token",
        status: "sending",
      },
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [createEffect({ transportIdempotent: true })],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation).toEqual({
      preparedDispatches: [],
    });
  });

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
        media: [
          {
            kind: "image",
            url: "https://cdn.example.test/dead-bug/setup.png",
            alt: "Dead bug setup",
            source: "dead-bug-setup",
          },
        ],
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_1",
        effectId: "intent_1",
        payload: {
          actorId: "actor_1",
          bindingDeliveryKind: "participant",
          bindingDeliveryTarget: "chat_1",
          channel: "telegram",
          deliverySourceKey: null,
          explicitTarget: null,
          idempotencyKey: "assistant-outbox:intent_1",
          identityId: "identity_1",
          media: [
            {
              kind: "image",
              url: "https://cdn.example.test/dead-bug/setup.png",
              alt: "Dead bug setup",
              source: "dead-bug-setup",
            },
          ],
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

  it("trusts the persisted transport idempotency flag for Linq effects", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "linq",
        dedupeKey: "dedupe_linq",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: "linq-thread",
        identityId: "identity_1",
        intentId: "intent_linq",
        message: "hello linq",
        replyToMessageId: null,
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_linq",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.payload).toMatchObject({
      channel: "linq",
      idempotencyKey: "assistant-outbox:intent_linq",
      transportIdempotent: false,
    });
  });

  it("abandons a queued signup welcome when a foreground reply targets the same route", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: null,
        bindingDelivery: { kind: "thread", target: "thread_1" },
        channel: "telegram",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_signup_welcome",
        deliveryIdempotencyKey: "signup-welcome:member_placeholder",
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: null,
        intentId: "intent_signup_welcome",
        lastError: null,
        media: [],
        message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
        nextAttemptAt: null,
        replyToMessageId: null,
        sessionId: "session_signup_welcome",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_signup_welcome",
      },
      {
        actorId: null,
        bindingDelivery: { kind: "thread", target: "thread_1" },
        channel: "telegram",
        createdAt: "2026-04-08T00:00:05.000Z",
        dedupeKey: "dedupe_foreground",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: null,
        intentId: "intent_foreground",
        lastError: null,
        media: [],
        message: "foreground reply",
        nextAttemptAt: null,
        replyToMessageId: "message_1",
        sessionId: "session_foreground",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_foreground",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: ["intent_foreground"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.effectId).toBe("intent_foreground");
    expect(sideEffects[0]?.deliveryPhase).toBe("foreground_current_turn");
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
      }),
      intentId: "intent_signup_welcome",
      status: "abandoned",
      vault: "/tmp/vault",
    });
  });

  it("prefers fresh pending deliveries over stale retryable deliveries at the hosted effect cap", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_stale",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_stale",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_111111111111111111111111",
        identityId: "identity_1",
        intentId: "intent_stale",
        lastError: {
          code: "LINQ_API_REQUEST_FAILED",
          message: "Chat not found",
        },
        message: "stale reply",
        nextAttemptAt: "2026-04-08T00:00:01.000Z",
        replyToMessageId: "old-message",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_stale",
      },
      {
        actorId: "actor_fresh",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_fresh",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_222222222222222222222222",
        identityId: "identity_1",
        intentId: "intent_fresh",
        lastError: null,
        message: "fresh reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "fresh-message",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_fresh",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.effectId).toBe("intent_fresh");
    expect(sideEffects[0]?.deliveryPhase).toBe("background_retry");
    expect(sideEffects[0]?.payload.message).toBe("fresh reply");
  });

  it("uses all preferred current-turn deliveries before older due backlog", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_old",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_old",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_111111111111111111111111",
        identityId: "identity_1",
        intentId: "intent_old",
        lastError: null,
        message: "old pending reply",
        nextAttemptAt: "2026-04-08T00:00:00.000Z",
        replyToMessageId: "old-message",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_old",
      },
      {
        actorId: "actor_fresh",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_fresh",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_222222222222222222222222",
        identityId: "identity_1",
        intentId: "intent_fresh",
        lastError: null,
        message: "fresh current-turn reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "fresh-message",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_fresh",
      },
      {
        actorId: "actor_fresh_2",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_fresh_2",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_333333333333333333333333",
        identityId: "identity_1",
        intentId: "intent_fresh_2",
        lastError: null,
        message: "second current-turn reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "fresh-message-2",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_fresh_2",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: ["intent_fresh_2", "intent_fresh"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_fresh_2",
      "intent_fresh",
    ]);
    expect(sideEffects.map((effect) => effect.deliveryPhase)).toEqual([
      "foreground_current_turn",
      "foreground_current_turn",
    ]);
    expect(sideEffects.map((effect) => effect.payload.message)).toEqual([
      "second current-turn reply",
      "fresh current-turn reply",
    ]);
  });

  it("dispatches earlier same-turn steered segments before the preferred final reply", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: null,
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
    ]);
    expect(sideEffects.map((effect) => effect.deliveryPhase)).toEqual([
      "foreground_current_turn",
      "foreground_current_turn",
    ]);
    expect(sideEffects.map((effect) => effect.payload.replyToMessageId)).toEqual([
      "message-one",
      "message-two",
    ]);
  });

  it("uses steered segment ordinals when same-boundary intents share a timestamp", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment_1",
        deliveryIdempotencyKey: "delivery-final:segment:1",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_a_segment_1",
        lastError: null,
        message: "second steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_m_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-three",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_three",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment_0",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_z_segment_0",
        lastError: null,
        message: "first steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_m_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_z_segment_0",
      "intent_a_segment_1",
      "intent_m_final",
    ]);
  });

  it("uses steered segment ordinals before timestamps for same-boundary intents", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_segment_0",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: null,
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
    ]);
  });

  it("dispatches fallback-key steered segments before same-boundary final replies", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_segment_0",
        deliveryIdempotencyKey: "assistant-segment:turn_steered:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: null,
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
    ]);
  });

  it("does not treat unrelated same-boundary segment-looking keys as steered predecessors", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_older",
        deliveryIdempotencyKey: "custom-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_older",
        lastError: null,
        message: "older same-boundary reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_custom_segment",
        deliveryIdempotencyKey: "custom:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_custom_segment",
        lastError: null,
        message: "later custom-key reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_older",
    ]);
  });

  it("keeps retryable same-turn predecessors before pending final replies", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
    ]);
  });

  it("holds later same-turn replies while an earlier same-boundary predecessor is not due", async () => {
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation((intent) =>
      intent.intentId !== "intent_segment"
    );
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:11:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([]);
  });

  it("holds background replies while an earlier same-boundary predecessor is not due", async () => {
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation((intent) =>
      intent.intentId !== "intent_segment"
    );
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:11:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([]);
  });

  it("orders due background same-boundary retryable predecessors before pending final replies", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
    ]);
  });

  it("does not block preferred replies behind confirmation-pending predecessors with no wake path", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "delivery confirmation is still pending",
        },
        message: "ambiguous earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_final",
    ]);
  });

  it("collects stale non-idempotent sending predecessors before later same-boundary replies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        delivery: null,
        deliveryConfirmationPending: true,
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        lastError: null,
        message: "stale sending earlier steered segment",
        nextAttemptAt: null,
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "sending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: true,
          deliveryIdempotencyKey: "delivery-final:segment:0",
          deliveryTransportIdempotent: false,
          intentId: "intent_segment",
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: true,
          sendingStartedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
    ]);
    vi.useRealTimers();
  });

  it("does not promote same-turn Linq replies from another delivery source", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_first_source",
        deliveryIdempotencyKey: "delivery-first-source",
        deliverySource: {
          kind: "linq",
          fromPhoneNumber: "+15550000001",
        },
        deliveryTransportIdempotent: true,
        explicitTarget: "+15550009999",
        identityId: "identity_1",
        intentId: "intent_first_source",
        lastError: null,
        message: "first source reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: null,
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_same_linq_recipient",
        threadId: "linq-thread",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_second_source",
        deliveryIdempotencyKey: "delivery-second-source",
        deliverySource: {
          kind: "linq",
          fromPhoneNumber: "+15550000002",
        },
        deliveryTransportIdempotent: true,
        explicitTarget: "+15550009999",
        identityId: "identity_1",
        intentId: "intent_second_source",
        lastError: null,
        message: "second source reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: null,
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_same_linq_recipient",
        threadId: "linq-thread",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_second_source"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_second_source",
    ]);
    expect(sideEffects[0]?.payload.deliverySourceKey).toBe("linq:+15550000002");
  });

  it("preserves preferred order for multiple same-turn delivery boundaries", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_first_boundary",
        deliveryIdempotencyKey: "delivery-first-boundary",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_first_boundary",
        lastError: null,
        message: "first boundary reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_second_boundary",
        deliveryIdempotencyKey: "delivery-second-boundary",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_2",
        identityId: "identity_1",
        intentId: "intent_second_boundary",
        lastError: null,
        message: "second boundary reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_2",
        threadId: "thread_2",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: ["intent_second_boundary", "intent_first_boundary"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_second_boundary",
      "intent_first_boundary",
    ]);
  });

  it("does not group delivery boundaries by delimiter-colliding field values", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram\u0000identity_1",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_other",
        deliveryIdempotencyKey: "delivery-other:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: null,
        intentId: "intent_other_boundary",
        lastError: null,
        message: "other boundary reply",
        nextAttemptAt: "2026-04-08T00:00:00.000Z",
        replyToMessageId: "message-other",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_other",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "preferred boundary reply",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-final",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_final",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_final",
    ]);
  });

  it("does not promote malformed same-turn intents for another target", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_foreign",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:00:59.000Z",
        dedupeKey: "dedupe_foreign",
        deliveryIdempotencyKey: "delivery-foreign",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_2",
        identityId: "identity_1",
        intentId: "intent_foreign",
        lastError: null,
        message: "foreign same-turn reply",
        nextAttemptAt: "2026-04-08T00:00:59.000Z",
        replyToMessageId: "message-foreign",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_2",
        threadId: "thread_2",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: null,
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_final"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_segment",
      "intent_final",
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
      collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    });
  });

  it("collects stale non-idempotent sending intents for outbox reconciliation", async () => {
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
        lastError: null,
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        status: "sending",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          intentId: "intent_1",
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: true,
          sendingStartedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([
      expect.objectContaining({
        deliveryPhase: "background_retry",
        effectId: "intent_1",
      }),
    ]);
  });

  it("collects prepared idempotent sending intents without waiting for stale-send timeout", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_linq",
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_linq",
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_linq",
        lastAttemptAt: "2026-04-08T00:00:01.000Z",
        lastError: null,
        message: "hello linq",
        nextAttemptAt: null,
        replyToMessageId: null,
        sessionId: "session_1",
        status: "sending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_linq",
      },
    ]);
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey: "assistant-outbox:intent_linq",
          deliveryTransportIdempotent: true,
          intentId: "intent_linq",
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: false,
          sendingStartedAt: "2026-04-08T00:00:01.000Z",
        },
      ),
    );
    mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(false);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]).toEqual(expect.objectContaining({
      deliveryPhase: "background_retry",
      effectId: "intent_linq",
      payload: expect.objectContaining({
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_linq",
        transportIdempotent: true,
      }),
    }));
  });

  it("schedules prepared idempotent sending intents after the retry delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:10.000Z"));
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_linq",
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_linq",
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_linq",
        lastAttemptAt: "2026-04-08T00:00:01.000Z",
        lastError: null,
        message: "hello linq",
        nextAttemptAt: null,
        replyToMessageId: null,
        sessionId: "session_1",
        status: "sending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_linq",
      },
    ]);

    const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: "/tmp/vault",
    });

    expect(wakeAt).toBe("2026-04-08T00:10:01.000Z");
    vi.useRealTimers();
  });

  it("keeps non-idempotent sending intents awake until stale reconciliation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:02:30.000Z"));
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "chat_1" },
        channel: "telegram",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_telegram",
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_telegram",
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_telegram",
        lastAttemptAt: "2026-04-08T00:00:01.000Z",
        lastError: null,
        message: "hello telegram",
        nextAttemptAt: null,
        replyToMessageId: null,
        sessionId: "session_1",
        status: "sending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_telegram",
      },
    ]);

    const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: "/tmp/vault",
    });

    expect(wakeAt).toBe("2026-04-08T00:10:01.000Z");
    vi.useRealTimers();
  });

  it("schedules same-boundary wake from the earlier blocked predecessor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:01:00.000Z"));
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_segment",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_segment",
        lastError: {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "earlier steered segment",
        nextAttemptAt: "2026-04-08T00:11:00.000Z",
        replyToMessageId: "message-one",
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        targetFingerprint: "target_chat_1_reply_one",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
      {
        actorId: "actor_1",
        bindingDelivery: null,
        channel: "telegram",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        deliveryIdempotencyKey: "delivery-final",
        deliveryTransportIdempotent: false,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_final",
        lastError: null,
        message: "later final reply",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message-two",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        targetFingerprint: "target_chat_1_reply_two",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_steered",
      },
    ]);

    const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: "/tmp/vault",
    });

    expect(wakeAt).toBe("2026-04-08T00:11:00.000Z");
    vi.useRealTimers();
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

  it("does not send a voice memo again while its prepared mirror state is in flight", async () => {
    const effect = createEffect({
      channel: "linq",
      media: [createHostedVoiceMemoMedia()],
      transportIdempotent: false,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: false,
          intentId: effect.effectId,
          lastAttemptAt: "2026-04-08T00:00:05.000Z",
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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
    expect(mocks.sendLinqVoiceMemoMessage).not.toHaveBeenCalled();
  });

  it("resets a prepared sending intent to immediate pending when abort happens before provider dispatch", async () => {
    const abortReason = new Error("lease expired before provider dispatch");
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const newerPreparedAt = "2026-04-08T00:00:06.000Z";
    let signalAborted = false;
    const signal = {
      get aborted() {
        return signalAborted;
      },
      get reason() {
        return abortReason;
      },
    } as AbortSignal;
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      payload: createPayload({ transportIdempotent: true }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: newerPreparedAt,
        },
      ),
    );
    const effectsPort = createHostedRuntimeEffectsPortStub();
    mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValueOnce({
      delivery: null,
      intentId: "intent_123",
      lastError: null,
      status: "pending",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      expect(request).toEqual(expect.objectContaining({
        allowPreparedSending: true,
        intentId: "intent_123",
        preparedDispatch: {
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: true,
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        },
      }));
      signalAborted = true;
      return createDispatchResult(
        {
          lastError: {
            code: "ASSISTANT_DELIVERY_ABORTED",
            message: "lease expired before provider dispatch",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_ABORTED",
          message: "lease expired before provider dispatch",
        },
      );
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort,
      preparedDispatches: [{
        intentId: "intent_123",
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: {
          attemptCount: 0,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: true,
          lastAttemptAt: null,
          lastError: null,
          nextAttemptAt: null,
          preparedDispatchToken: null,
          status: "pending",
        },
      }],
      providerFetch: vi.fn<typeof fetch>(),
      signal,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({
      deliveryErrorCode: "ASSISTANT_DELIVERY_ABORTED",
      deliveryStatus: "pending",
      effectId: "intent_123",
      retryable: true,
    });
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: true,
      intentId: "intent_123",
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      resetAt: expect.any(Date),
      restoreDispatchState: {
        attemptCount: 0,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_123",
        deliveryTransportIdempotent: true,
        lastAttemptAt: null,
        lastError: null,
        nextAttemptAt: null,
        preparedDispatchToken: null,
        status: "pending",
      },
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("throws after pre-provider abort when owned prepared reset is a no-op", async () => {
    const abortReason = new Error("lease expired before no-op reset");
    const preparedAt = "2026-04-08T00:00:05.000Z";
    let signalAborted = false;
    const signal = {
      get aborted() {
        return signalAborted;
      },
      get reason() {
        return abortReason;
      },
    } as AbortSignal;
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      payload: createPayload({ transportIdempotent: true }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async () => {
      signalAborted = true;
      return createDispatchResult(
        {
          lastError: {
            code: "ASSISTANT_DELIVERY_ABORTED",
            message: "lease expired before no-op reset",
          },
          status: "retryable",
        },
        {
          code: "ASSISTANT_DELIVERY_ABORTED",
          message: "lease expired before no-op reset",
        },
      );
    });

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        preparedDispatches: [{
          intentId: "intent_123",
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryTransportIdempotent: true,
          }),
        }],
        providerFetch: vi.fn<typeof fetch>(),
        signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toThrow("lease expired before no-op reset");

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: true,
      intentId: "intent_123",
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryTransportIdempotent: true,
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("keeps foreground sending state after abort once provider dispatch was entered", async () => {
    const abortController = new AbortController();
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_123",
      payload: createPayload(),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: false,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    mocks.sendTelegramMessage.mockImplementationOnce(async () => {
      abortController.abort(new Error("lease expired after provider dispatch"));
      return createDelivery();
    });
    const effectsPort = createHostedRuntimeEffectsPortStub();
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      await request.dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: "chat_123",
      });
      return createDispatchResult({
        delivery: createDelivery(),
        status: "sent",
      });
    });

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [effect],
        effectsPort,
        preparedDispatches: [{
          intentId: "intent_123",
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState: createPreparedPreviousDispatchState(),
        }],
        providerFetch: vi.fn<typeof fetch>(),
        signal: abortController.signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toThrow("lease expired after provider dispatch");

    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("waits on unowned sending state instead of resetting successors without a prepared timestamp", async () => {
    const abortController = new AbortController();
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_first",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_first",
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_second",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_second",
        replyToMessageId: "message-two",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
          deliveryTransportIdempotent: false,
          intentId: "intent_first",
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [firstEffect, secondEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      signal: abortController.signal,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sending",
        effectId: "intent_first",
        retryable: true,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("resets unprocessed prepared successors after provider-entered abort", async () => {
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const newerPreparedAt = "2026-04-08T00:00:06.000Z";
    const secondPreviousDispatchState = {
      attemptCount: 2,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: "assistant-outbox:intent_second",
      deliveryTransportIdempotent: false,
      lastAttemptAt: "2026-04-08T00:00:00.000Z",
      lastError: {
        code: "TELEGRAM_TEMPORARY_FAILURE",
        message: "temporary provider failure",
      },
      nextAttemptAt: "2026-04-08T00:00:05.000Z",
      preparedDispatchToken: null,
      status: "retryable" as const,
    };
    const abortController = new AbortController();
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_first",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_first",
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_second",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_second",
        replyToMessageId: "message-two",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(async ({ intentId }) =>
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: `assistant-outbox:${intentId}`,
          deliveryTransportIdempotent: false,
          intentId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: intentId === "intent_second" ? newerPreparedAt : preparedAt,
        },
      ),
    );
    mocks.sendTelegramMessage.mockImplementationOnce(async () => {
      abortController.abort(new Error("lease expired after first provider dispatch"));
      return createDelivery();
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      await request.dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_first",
        message: "hello from hosted",
        replyToMessageId: null,
        target: "chat_123",
      });
      return createDispatchResult({
        delivery: createDelivery(),
        intentId: "intent_first",
        status: "sent",
      });
    });

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [firstEffect, secondEffect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        preparedDispatches: [{
          intentId: "intent_first",
          preparedDispatchToken: "prepared-dispatch-token-first",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryIdempotencyKey: "assistant-outbox:intent_first",
          }),
        }, {
          intentId: "intent_second",
          preparedDispatchToken: "prepared-dispatch-token-second",
          previousDispatchState: secondPreviousDispatchState,
        }],
        providerFetch: vi.fn<typeof fetch>(),
        signal: abortController.signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toThrow("lease expired after first provider dispatch");

    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_second",
      deliveryTransportIdempotent: false,
      intentId: "intent_second",
      preparedDispatchToken: "prepared-dispatch-token-second",
      resetAt: expect.any(Date),
      restoreDispatchState: secondPreviousDispatchState,
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("resets current and successor prepared effects after pre-provider abort", async () => {
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const newerPreparedAt = "2026-04-08T00:00:06.000Z";
    const abortController = new AbortController();
    abortController.abort(new Error("lease expired before provider dispatch"));
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_first",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_first",
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_second",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_second",
        replyToMessageId: "message-two",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(async ({ intentId }) =>
      createMirrorState(
        {
          delivery: intentId === "intent_second" ? createDelivery() : null,
          deliveryIdempotencyKey: `assistant-outbox:${intentId}`,
          deliveryTransportIdempotent: false,
          intentId,
          lastError: null,
          status: intentId === "intent_second" ? "sent" : "sending",
        },
        {
          sendingStartedAt: intentId === "intent_first" ? newerPreparedAt : preparedAt,
        },
      ),
    );

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [firstEffect, secondEffect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        preparedDispatches: [{
          intentId: "intent_first",
          preparedDispatchToken: "prepared-dispatch-token-first",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryIdempotencyKey: "assistant-outbox:intent_first",
          }),
        }, {
          intentId: "intent_second",
          preparedDispatchToken: "prepared-dispatch-token-second",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryIdempotencyKey: "assistant-outbox:intent_second",
          }),
        }],
        providerFetch: vi.fn<typeof fetch>(),
        signal: abortController.signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toThrow("lease expired before provider dispatch");

    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledTimes(2);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_first",
      deliveryTransportIdempotent: false,
      intentId: "intent_first",
      preparedDispatchToken: "prepared-dispatch-token-first",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryIdempotencyKey: "assistant-outbox:intent_first",
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_second",
      deliveryTransportIdempotent: false,
      intentId: "intent_second",
      preparedDispatchToken: "prepared-dispatch-token-second",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryIdempotencyKey: "assistant-outbox:intent_second",
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("blocks later same-turn foreground delivery after retryable predecessor failure", async () => {
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const retryAt = "2099-04-08T00:05:00.000Z";
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_first",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_first",
        replyToMessageId: "message-one",
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_second",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_second",
        replyToMessageId: "message-two",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(async ({ intentId }) => {
      if (intentId === "intent_first") {
        return createMirrorState({
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
          deliveryTransportIdempotent: false,
          intentId: "intent_first",
          lastError: {
            code: "TELEGRAM_TEMPORARY_FAILURE",
            message: "temporary provider failure",
          },
          nextAttemptAt: retryAt,
          status: "retryable",
        });
      }
      return createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_second",
          deliveryTransportIdempotent: false,
          intentId: "intent_second",
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: preparedAt,
        },
      );
    });
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult(
        {
          intentId: "intent_first",
          lastError: {
            code: "TELEGRAM_TEMPORARY_FAILURE",
            message: "temporary provider failure",
          },
          status: "retryable",
        },
        {
          code: "TELEGRAM_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
      ),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [firstEffect, secondEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.effectId)).toEqual(["intent_first"]);
    expect(outcomes[0]?.deliveryStatus).toBe("retryable");
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("does not block a different actor after retryable foreground failure", async () => {
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_first",
      payload: createPayload({
        actorId: "actor_1",
        idempotencyKey: "assistant-outbox:intent_first",
        replyToMessageId: "message-one",
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_second",
      payload: createPayload({
        actorId: "actor_2",
        idempotencyKey: "assistant-outbox:intent_second",
        replyToMessageId: "message-two",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
          deliveryTransportIdempotent: false,
          intentId: "intent_first",
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent
      .mockResolvedValueOnce(
        createDispatchResult(
          {
            intentId: "intent_first",
            lastError: {
              code: "TELEGRAM_TEMPORARY_FAILURE",
              message: "temporary provider failure",
            },
            status: "retryable",
          },
          {
            code: "TELEGRAM_TEMPORARY_FAILURE",
            message: "temporary provider failure",
          },
        ),
      )
      .mockResolvedValueOnce(
        createDispatchResult({
          delivery: createDelivery(),
          intentId: "intent_second",
          status: "sent",
        }),
      );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [firstEffect, secondEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      preparedDispatches: [{
        intentId: "intent_first",
        preparedDispatchToken: "prepared-dispatch-token-first",
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
        }),
      }, {
        intentId: "intent_second",
        preparedDispatchToken: "prepared-dispatch-token-second",
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryIdempotencyKey: "assistant-outbox:intent_second",
        }),
      }],
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.effectId)).toEqual([
      "intent_first",
      "intent_second",
    ]);
    expect(outcomes.map((outcome) => outcome.deliveryStatus)).toEqual([
      "retryable",
      "sent",
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("keeps foreground Linq sending state after abort once provider dispatch was entered", async () => {
    const abortController = new AbortController();
    const preparedAt = "2026-04-08T00:00:05.000Z";
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_123",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        explicitTarget: "linq_chat_123",
        transportIdempotent: true,
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_123",
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    mocks.sendLinqMessage.mockImplementationOnce(async () => {
      abortController.abort(new Error("lease expired after Linq provider dispatch"));
      return createDelivery({
        channel: "linq",
        providerMessageId: "linq_message_123",
        providerThreadId: "linq_chat_123",
        target: "linq_chat_123",
        targetKind: "thread",
      });
    });
    const effectsPort = createHostedRuntimeEffectsPortStub();
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      await request.dependencies.sendLinq({
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: "linq_chat_123",
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({ channel: "linq" }),
        status: "sent",
      });
    });

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [effect],
        effectsPort,
        preparedDispatches: [{
          intentId: "intent_123",
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryTransportIdempotent: true,
          }),
        }],
        providerFetch: vi.fn<typeof fetch>(),
        signal: abortController.signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toThrow("lease expired after Linq provider dispatch");

    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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
    vi.useRealTimers();
  });

  it("retries a stale idempotent sending intent without prepared ownership", async () => {
    const effect = createEffect({ transportIdempotent: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          deliveryTransportIdempotent: true,
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      preparedDispatches: [],
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    const dispatchRequest = mocks.dispatchAssistantOutboxIntent.mock.calls[0]?.[0];
    expect(dispatchRequest).toEqual({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

  it("delegates stale non-idempotent sending records to outbox reconciliation", async () => {
    const effect = createEffect({ transportIdempotent: false });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
    const deliveryError = {
      code: "ASSISTANT_DELIVERY_AMBIGUOUS",
      message: "stale non-idempotent delivery could not be confirmed",
    };
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          intentId: effect.effectId,
          lastAttemptAt: "2026-04-08T00:00:00.000Z",
          lastError: null,
          status: "sending",
        },
        {
          sendingPastGraceWindow: true,
          sendingStartedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult(
        {
          lastError: deliveryError,
          status: "failed",
        },
        deliveryError,
      ),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

  it("labels delivery start and sent logs with dispatch event types", async () => {
    const foregroundEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_123",
      payload: createPayload(),
    });
    const backgroundEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_456",
      deliveryPhase: "background_retry",
      effectId: "intent_456",
      payload: createPayload(),
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [foregroundEffect, backgroundEffect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          deliveryPhase: "foreground_current_turn",
          eventType: "assistant.delivery.foreground_started",
        }),
        message: "Hosted assistant foreground delivery starting.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          deliveryPhase: "background_retry",
          eventType: "assistant.delivery.background_started",
        }),
        message: "Hosted assistant background delivery starting.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          deliveryPhase: "foreground_current_turn",
          eventType: "assistant.delivery.sent",
        }),
        message: "Hosted assistant delivery sent.",
      }),
    );
  });

  it("routes Telegram deliveries through the shared Telegram runtime with Telegram-only env", async () => {
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
    const assertLiveness = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>();

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      assertLiveness,
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertLiveness).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith({
      idempotencyKey: "assistant-outbox:intent_123",
      message: "hello from hosted",
      replyToMessageId: null,
      target: "chat_123",
    }, {
      env: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      fetchImplementation: providerFetch,
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
  });

  it("routes Telegram voice memo deliveries through the shared runtime with Telegram and ElevenLabs env", async () => {
    const effect = createEffect({
      media: [
        createHostedVoiceMemoMedia({
          sizeBytes: null,
          transportRefs: {
            telegram: {
              sendMode: "generate_at_delivery",
            },
          },
        }),
      ],
      message: "",
      transportIdempotent: false,
    });
    mocks.sendTelegramVoiceMemoMessage.mockResolvedValueOnce({
      providerMessageId: "telegram_voice_sent",
      target: "chat_123",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendTelegramVoiceMemo({
        filename: "memo.mp3",
        modelId: "eleven_multilingual_v2",
        replyToMessageId: null,
        target: "chat_123",
        transcript: "Short memo",
        voiceId: "voice_murph",
      });

      return createDispatchResult({
        delivery: createDelivery({
          providerMessageId: delivery.providerMessageId,
          target: delivery.target,
        }),
        status: "sent",
      });
    });
    const providerFetch = vi.fn<typeof fetch>();

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      forwardedEnv: {
        ELEVENLABS_API_KEY: "elevenlabs-sentinel",
        LINQ_API_TOKEN: "linq-token",
        MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
        MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.sendTelegramVoiceMemoMessage).toHaveBeenCalledWith({
      filename: "memo.mp3",
      modelId: "eleven_multilingual_v2",
      replyToMessageId: null,
      target: "chat_123",
      transcript: "Short memo",
      voiceId: "voice_murph",
    }, {
      env: {
        ELEVENLABS_API_KEY: "elevenlabs-sentinel",
        MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
        MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      fetchImplementation: providerFetch,
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "telegram",
        deliveryStatus: "sent",
        providerMessageId: "telegram_voice_sent",
        retryable: false,
      }),
    ]);
  });

  it("fails closed instead of using ambient fetch when hosted outbox provider fetch is missing", async () => {
    const effect = createEffect();
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: "chat_123",
      });
      throw new Error("unreachable");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      platformEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("uses providerFetch for hosted Linq deliveries when the runtime can intercept egress", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_direct_provider_fetch",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the current wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "ain_hashed_thread",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      transportIdempotent: true,
    });
    const providerFetch = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        status: 204,
      });
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_materialized",
      target: "linq_chat_materialized",
      targetKind: "participant",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        media: [
          {
            kind: "image",
            url: "https://cdn.example.test/dead-bug/setup.png",
            alt: "Dead bug setup",
            source: "dead-bug-setup",
          },
        ],
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "ain_hashed_thread",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      fromPhoneNumber: "+15550002",
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      media: [
        {
          kind: "image",
          url: "https://cdn.example.test/dead-bug/setup.png",
          alt: "Dead bug setup",
          source: "dead-bug-setup",
        },
      ],
      message: "hello from hosted",
      replyToMessageId: "linq_message_current",
      target: "+15550001",
      targetKind: "participant",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    const linqFetch = mocks.sendLinqMessage.mock.calls[0]?.[1]?.fetchImplementation;
    assert.equal(typeof linqFetch, "function");
    await linqFetch("https://api.linq.example/test", {
      headers: {},
      method: "POST",
    });
    expect(providerFetch).toHaveBeenCalledWith("https://api.linq.example/test", {
      headers: {},
      method: "POST",
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerMessageId: "linq_message_sent",
        providerThreadId: "linq_chat_materialized",
        target: "linq_chat_materialized",
      }),
    ]);
  });

  it("uses providerFetch for hosted Linq voice memo deliveries when the runtime can intercept egress", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: false,
    });
    const providerFetch = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        status: 204,
      });
    });
    mocks.sendLinqVoiceMemoMessage.mockResolvedValueOnce({
      providerMessageId: "linq_voice_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinqVoiceMemo({
        attachmentId: "attachment_voice_1",
        target: "linq_chat_current",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.sendLinqVoiceMemoMessage).toHaveBeenCalledWith({
      attachmentId: "attachment_voice_1",
      target: "linq_chat_current",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    const linqFetch =
      mocks.sendLinqVoiceMemoMessage.mock.calls[0]?.[1]?.fetchImplementation;
    assert.equal(typeof linqFetch, "function");
    await linqFetch("https://api.linq.example/voice", {
      headers: {},
      method: "POST",
    });
    expect(providerFetch).toHaveBeenCalledWith("https://api.linq.example/voice", {
      headers: {},
      method: "POST",
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerMessageId: "linq_voice_sent",
        providerThreadId: "linq_chat_current",
        target: "linq_chat_current",
      }),
    ]);
  });

  it("sends hosted Linq voice memos to the same-wake concrete chat target", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_voice_target",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the current wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_123",
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "ain_hashed_thread",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      media: [createHostedVoiceMemoMedia()],
      replyToMessageId: "linq_message_current",
      transportIdempotent: false,
    });
    mocks.sendLinqVoiceMemoMessage.mockResolvedValueOnce({
      providerMessageId: "linq_voice_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinqVoiceMemo({
        attachmentId: "attachment_voice_1",
        replyToMessageId: "linq_message_current",
        target: "ain_hashed_thread",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(mocks.sendLinqVoiceMemoMessage).toHaveBeenCalledWith({
      attachmentId: "attachment_voice_1",
      target: "linq_chat_current",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerThreadId: "linq_chat_current",
        target: "linq_chat_current",
      }),
    ]);
  });

  it("routes WhatsApp deliveries through the shared WhatsApp runtime with platform env and provider fetch", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "whatsapp_thread_123",
      channel: "whatsapp",
      explicitTarget: "whatsapp_thread_123",
    });
    const providerFetch = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 204,
    }));
    mocks.sendWhatsAppMessage.mockResolvedValueOnce({
      providerMessageId: "whatsapp_message_123",
      providerThreadId: "whatsapp_thread_123",
      target: "whatsapp_thread_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendWhatsApp({
        message: "hello from hosted",
        replyToMessageId: "whatsapp_inbound_123",
        target: "whatsapp_thread_123",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "whatsapp",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        WHATSAPP_ACCESS_TOKEN: "forwarded-whatsapp-token",
      },
      platformEnv: {
        WHATSAPP_ACCESS_TOKEN: "platform-whatsapp-token",
        WHATSAPP_API_BASE_URL: "https://graph.whatsapp.example",
        WHATSAPP_GRAPH_VERSION: "v20.0",
        WHATSAPP_PHONE_NUMBER_ID: "phone_number_123",
      },
      providerFetch,
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.sendWhatsAppMessage).toHaveBeenCalledWith({
      message: "hello from hosted",
      replyToMessageId: "whatsapp_inbound_123",
      target: "whatsapp_thread_123",
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: "platform-whatsapp-token",
        WHATSAPP_API_BASE_URL: "https://graph.whatsapp.example",
        WHATSAPP_GRAPH_VERSION: "v20.0",
        WHATSAPP_PHONE_NUMBER_ID: "phone_number_123",
      },
      fetchImplementation: providerFetch,
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "whatsapp",
        deliveryStatus: "sent",
        providerMessageId: "whatsapp_message_123",
        providerThreadId: "whatsapp_thread_123",
        target: "whatsapp_thread_123",
      }),
    ]);
  });

  it("attaches same-wake Linq direct recipient context without checkpointing it", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_123",
      linqMessage: {
        chatId: "linq_chat_123",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_inbound_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_123",
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: true,
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_123",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: "linq_message_inbound_123",
        target: "linq_chat_123",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_123",
      media: null,
      message: "hello from hosted",
      replyToMessageId: "linq_message_inbound_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("does not use same-wake contact fields as Linq sender authority", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_hashed_target",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the current wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "ain_hashed_thread",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      transportIdempotent: true,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "ain_hashed_thread",
        targetKind: "thread",
      });

      throw new Error("Linq recovery without an explicit sender should fail.");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_LINQ_RECOVERY_SENDER_REQUIRED",
      context: expect.objectContaining({
        retryable: false,
      }),
    });

    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(JSON.stringify(effect.payload)).not.toContain("+15559990000");
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("materializes same-wake Linq direct targets when explicit sender authority is present", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_hashed_target_sender",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the current wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "ain_hashed_thread",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      transportIdempotent: true,
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_materialized",
      target: "linq_chat_materialized",
      targetKind: "participant" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550002",
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "ain_hashed_thread",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(JSON.stringify(effect.payload)).not.toContain("+15559990000");
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      fromPhoneNumber: "+15550002",
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      media: null,
      message: "hello from hosted",
      replyToMessageId: "linq_message_current",
      target: "+15550001",
      targetKind: "participant",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("routes hosted email thread deliveries through the shared effects port", async () => {
    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: "<message_parent_123@example.test>",
      references: ["<message_root_123@example.test>"],
      subject: "Hosted subject",
      to: ["sender@example.test"],
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: hostedEmailThreadTarget,
      channel: "email",
      explicitTarget: hostedEmailThreadTarget,
      idempotencyKey: "assistant-outbox:intent_123",
      identityId: "assistant@example.com",
      replyToMessageId: "<message_parent_123@example.test>",
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
        idempotencyKey: "assistant-outbox:intent_123",
        // Regression: hosted bindings carry a privacy-blinded identity. The
        // hosted dispatch boundary must not forward it to the email transport.
        identityId: "hid_0123456789abcdef0123456789abcdef",
        message: "hello from hosted",
        replyToMessageId: "<message_parent_123@example.test>",
        subject: "Hosted subject",
        target: hostedEmailThreadTarget,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(sendEmail).toHaveBeenCalledWith({
      idempotencyKey: "assistant-outbox:intent_123",
      message: "hello from hosted",
      replyToMessageId: "<message_parent_123@example.test>",
      subject: "Hosted subject",
      target: hostedEmailThreadTarget,
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
      drainHostedPreparedAssistantDeliveries({
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

  it("keeps non-idempotent confirmation-pending retries in local retryable state", async () => {
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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
  });

  it("returns missing-result when the committed outbox intent disappeared", async () => {
    const effect = createEffect();
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(null),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
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

      const outcomes = await drainHostedPreparedAssistantDeliveries({
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
      drainHostedPreparedAssistantDeliveries({
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
      drainHostedPreparedAssistantDeliveries({
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
        message: "Hosted assistant delivery threw.",
      }),
    );
  });
});
