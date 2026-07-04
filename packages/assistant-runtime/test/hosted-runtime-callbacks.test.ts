import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeLatencyTraceRequest,
} from "@murphai/hosted-execution/runtime-control";
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
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import type { HostedEmailSendRequest } from "../src/hosted-email.ts";

const mocks = vi.hoisted(() => ({
  applyAssistantVaultFileSendApprovalResult: vi.fn(),
  beginAssistantOutboxIntentMirrorDispatch: vi.fn(),
  beginAssistantOutboxIntentMirrorPreparedDispatch: vi.fn(),
  buildAssistantVaultFileSendApprovalRequest: vi.fn(),
  deferAssistantVaultFileApprovalCheck: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  findAssistantAutoReplyDeliveryIntentIds: vi.fn(),
  hasAssistantAutoReplyChannel: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  markAssistantOutboxIntentMirrorTerminalById: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  readAssistantAutoReplyIntentProvenance: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readAssistantOutboxIntent: vi.fn(),
  readAssistantOutboxIntentMirrorState: vi.fn(),
  readAssistantVaultFileMedia: vi.fn(),
  readVerifiedAssistantVaultFileBytes: vi.fn(),
  resetAssistantOutboxPreparedDispatchById: vi.fn(),
  saveAssistantOutboxIntentIfUnchanged: vi.fn(),
  setLinqMessageReaction: vi.fn(),
  setTelegramMessageReaction: vi.fn(),
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
  applyAssistantVaultFileSendApprovalResult:
    mocks.applyAssistantVaultFileSendApprovalResult,
  beginAssistantOutboxIntentMirrorDispatch:
    mocks.beginAssistantOutboxIntentMirrorDispatch,
  beginAssistantOutboxIntentMirrorPreparedDispatch:
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch,
  buildAssistantVaultFileSendApprovalRequest:
    mocks.buildAssistantVaultFileSendApprovalRequest,
  deferAssistantVaultFileApprovalCheck:
    mocks.deferAssistantVaultFileApprovalCheck,
  dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
  findAssistantAutoReplyDeliveryIntentIds:
    mocks.findAssistantAutoReplyDeliveryIntentIds,
  hasAssistantAutoReplyChannel: mocks.hasAssistantAutoReplyChannel,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById:
    mocks.markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  readAssistantAutoReplyIntentProvenance:
    mocks.readAssistantAutoReplyIntentProvenance,
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  readAssistantOutboxIntent: mocks.readAssistantOutboxIntent,
  readAssistantOutboxIntentMirrorState:
    mocks.readAssistantOutboxIntentMirrorState,
  readAssistantVaultFileMedia: mocks.readAssistantVaultFileMedia,
  readVerifiedAssistantVaultFileBytes:
    mocks.readVerifiedAssistantVaultFileBytes,
  resetAssistantOutboxPreparedDispatchById:
    mocks.resetAssistantOutboxPreparedDispatchById,
  saveAssistantOutboxIntentIfUnchanged:
    mocks.saveAssistantOutboxIntentIfUnchanged,
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
    setLinqMessageReaction: mocks.setLinqMessageReaction,
    sendTelegramVoiceMemoMessage: mocks.sendTelegramVoiceMemoMessage,
  };
});

vi.mock("@murphai/operator-config/telegram-runtime", () => ({
  setTelegramMessageReaction: mocks.setTelegramMessageReaction,
}));

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort,
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
  const { answeredCoverage = null, ...rest } = overrides;

  return {
    actorId: "actor_123",
    answeredCoverage,
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
    ...rest,
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
    transcript: null,
    transport: {
      attachmentId: "attachment_voice_1",
      kind: "linq_attachment",
    },
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

async function flushHostedRuntimeCallbackTestMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
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
  deliveryError: {
    code: string | null;
    diagnosticContext?: Record<string, boolean | number | string | null>;
    message: string;
  } | null = null,
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
  mocks.applyAssistantVaultFileSendApprovalResult.mockImplementation(
    ({ intent }) => intent,
  );
  mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValue({
    actionFingerprint: "a".repeat(64),
    actionId: "intent_123",
    actionKind: "vault.file.send.v1",
    presentation: {
      body: "Send a vault file.",
      title: "Send a file?",
    },
  });
  mocks.deferAssistantVaultFileApprovalCheck.mockImplementation(
    ({ intent }) => intent,
  );
  mocks.dispatchAssistantOutboxIntent.mockResolvedValue(
    createDispatchResult({
      delivery: createDelivery(),
      status: "sent",
    }),
  );
  mocks.normalizeAssistantDeliveryError.mockImplementation((
    error: Error & {
      code?: string | null;
      diagnosticContext?: Record<string, boolean | number | string | null>;
    },
  ) => ({
    code: error.code ?? null,
    ...(error.diagnosticContext ? { diagnosticContext: error.diagnosticContext } : {}),
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
  mocks.readAssistantOutboxIntent.mockResolvedValue(null);
  mocks.readAssistantVaultFileMedia.mockReturnValue(null);
  mocks.readVerifiedAssistantVaultFileBytes.mockResolvedValue(
    new Uint8Array([1, 2, 3]),
  );
  mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
    async ({ intent }) => intent,
  );
  mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValue(null);
  mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue(null);
  mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set());
  mocks.hasAssistantAutoReplyChannel.mockReturnValue(true);
  mocks.readAssistantAutoReplyIntentProvenance.mockResolvedValue(null);
  mocks.readAssistantAutomationState.mockResolvedValue({ autoReply: [{ channel: "telegram" }] });
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

  it("pre-claims non-idempotent Linq reaction effects before provider dispatch", async () => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [effect],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation.preparedDispatches).toEqual([
      expect.objectContaining({
        intentId: "intent_123",
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      }),
    ]);
    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: false,
      intentId: "intent_123",
      startedAt: "2026-04-08T00:00:05.000Z",
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("persists Linq route authority when preparing a route-scoped delivery", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      replyToMessageId: "linq_message_1",
      transportIdempotent: true,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [effect],
      linqDeliveryContext: {
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: null,
        replyToMessageId: "linq_message_1",
        routeAuthority,
        service: "iMessage",
        target: "linq_chat_123",
        threadIsDirect: true,
      },
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: true,
      externalThreadRouteAuthority: routeAuthority,
      externalThreadService: "iMessage",
      intentId: "intent_123",
      startedAt: "2026-04-08T00:00:05.000Z",
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(preparation.preparedDispatches[0]).toEqual(expect.objectContaining({
      linqDeliveryContext: expect.objectContaining({
        routeAuthority,
        service: "iMessage",
      }),
    }));
  });

  it("restores Linq route authority from a prepared retry intent", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };
    mocks.beginAssistantOutboxIntentMirrorPreparedDispatch.mockResolvedValueOnce({
      intent: {
        attemptCount: 2,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: "assistant-outbox:intent_123",
        deliveryTransportIdempotent: true,
        externalThreadRouteAuthority: routeAuthority,
        externalThreadService: "iMessage",
        lastAttemptAt: "2026-04-08T00:05:00.000Z",
        lastError: null,
        nextAttemptAt: null,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        status: "sending",
      },
      ownsDispatch: true,
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      previousDispatchState: createPreparedPreviousDispatchState({
        deliveryTransportIdempotent: true,
        status: "retryable",
      }),
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      replyToMessageId: "linq_message_1",
      threadIsDirect: true,
      transportIdempotent: true,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [effect],
      now: () => "2026-04-08T00:05:00.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation.preparedDispatches[0]).toEqual(expect.objectContaining({
      linqDeliveryContext: {
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        replyToMessageId: "linq_message_1",
        routeAuthority,
        service: "iMessage",
        target: "linq_chat_123",
        threadIsDirect: true,
      },
    }));
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

  it("does not pre-claim non-canonical signup welcome delivery effects", async () => {
    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [
        createEffect({
          idempotencyKey: "signup-welcome:member_placeholder:retry",
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

  it("collects dispatchable effects with reactions before same-boundary replies", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "chat_1" },
        channel: "telegram",
        dedupeKey: "dedupe_1",
        deliveryIdempotencyKey: "assistant-segment:turn_1:0",
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
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "chat_1" },
        channel: "telegram",
        dedupeKey: "dedupe_reaction",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_reaction",
        media: [],
        message: "",
        operation: {
          kind: "message-reaction",
          reaction: "heart",
          targetMessageId: "message_1",
        },
        replyToMessageId: "message_1",
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_reaction"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_reaction",
        deliveryPhase: "foreground_current_turn",
        effectId: "intent_reaction",
        payload: {
          actorId: "actor_1",
          answeredCoverage: null,
          bindingDeliveryKind: "participant",
          bindingDeliveryTarget: "chat_1",
          channel: "telegram",
          deliverySourceKey: null,
          explicitTarget: null,
          idempotencyKey: "assistant-outbox:intent_reaction",
          identityId: "identity_1",
          media: [],
          message: "",
          subject: null,
          replyToMessageId: "message_1",
          sessionId: "session_1",
          threadId: "thread_1",
          threadIsDirect: true,
          transportIdempotent: true,
          turnId: "turn_1",
        },
      }),
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_1",
        deliveryPhase: "foreground_current_turn",
        effectId: "intent_1",
        payload: {
          actorId: "actor_1",
          answeredCoverage: null,
          bindingDeliveryKind: "participant",
          bindingDeliveryTarget: "chat_1",
          channel: "telegram",
          deliverySourceKey: null,
          explicitTarget: null,
          idempotencyKey: "assistant-segment:turn_1:0",
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

  it("collects non-idempotent Linq reactions after same-boundary replies", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        dedupeKey: "dedupe_reaction",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_reaction",
        media: [],
        message: "",
        operation: {
          kind: "message-reaction",
          reaction: "heart",
          targetMessageId: "linq_message_1",
        },
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        dedupeKey: "dedupe_reply",
        deliveryIdempotencyKey: "assistant-segment:turn_1:0",
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_reply",
        media: [],
        message: "hello from hosted",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_reaction", "intent_reply"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_reply",
      "intent_reaction",
    ]);
    expect(sideEffects.map((effect) => effect.payload.transportIdempotent)).toEqual([
      false,
      false,
    ]);
  });

  it("hydrates answered coverage from auto-reply intent provenance", async () => {
    const answeredCoverage = {
      lane: "conversation" as const,
      laneSeq: "42",
    };
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        dedupeKey: "dedupe_reply",
        deliveryIdempotencyKey: "assistant-segment:turn_1:0",
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_reply",
        media: [],
        message: "hello from hosted",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);
    mocks.readAssistantAutoReplyIntentProvenance.mockResolvedValueOnce({
      answeredCoverage,
      intentId: "intent_reply",
      recordedAt: "2026-04-08T00:00:00.000Z",
      schema: "murph.assistant-auto-reply-intent-provenance.v1",
      turnId: "turn_1",
    });

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_reply"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.payload.answeredCoverage).toEqual(answeredCoverage);
    expect(mocks.readAssistantAutoReplyIntentProvenance).toHaveBeenCalledWith({
      intentId: "intent_reply",
      vault: "/tmp/vault",
    });
  });

  it("abandons superseded hosted auto-reply same-boundary foreground replies", async () => {
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set(["intent_initial", "intent_final"]),
    );
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        attemptCount: 0,
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_initial",
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: `sha256:${"1".repeat(64)}`,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_initial",
        lastAttemptAt: null,
        lastError: null,
        media: [],
        message: "reply before active input",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        operation: null,
        preparedDispatchToken: null,
        replyToMessageId: "linq_message_1",
        sentAt: null,
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_active",
      },
      {
        actorId: "actor_1",
        attemptCount: 0,
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_final",
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: `sha256:${"2".repeat(64)}`,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_final",
        lastAttemptAt: null,
        lastError: null,
        media: [],
        message: "reply after active input",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        operation: null,
        preparedDispatchToken: null,
        replyToMessageId: "linq_message_2",
        sentAt: null,
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_active",
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
    expect(sideEffects[0]?.payload.message).toBe("reply after active input");
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: "ASSISTANT_SUPERSEDED_AUTO_REPLY_DELIVERY_SUPPRESSED",
      }),
      intentId: "intent_initial",
      status: "abandoned",
      vault: "/tmp/vault",
    });
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

  it("durably parks preferred vault-file intents when the hosted approval port is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
    try {
      const vaultFile = {
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      };
      let storedIntent = {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_vault_file",
        delivery: null,
        deliveryIdempotencyKey: "assistant-outbox:intent_vault_file",
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_vault_file",
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: null,
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:00:00.000Z",
      };
      const deferredIntent = {
        ...storedIntent,
        lastError: {
          code: "ASSISTANT_VAULT_FILE_APPROVAL_CHECK_DEFERRED",
          diagnosticContext: {
            assistantDeliveryFailureClass: "blocked",
            assistantDeliveryResumeTrigger: "approval_state_change",
            retryable: false,
          },
          message: "Secure vault-file approval could not be checked yet.",
        },
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "awaiting_approval",
        updatedAt: "2026-04-08T00:00:00.000Z",
      };
      mocks.listAssistantOutboxIntents.mockImplementation(async () => [
        storedIntent,
      ]);
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);
      mocks.deferAssistantVaultFileApprovalCheck.mockImplementationOnce(
        ({ intent, now }) => {
          expect(intent).toBe(storedIntent);
          expect(now.toISOString()).toBe("2026-04-08T00:00:00.000Z");
          return deferredIntent;
        },
      );
      mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementationOnce(
        async ({ expectedDedupeKey, expectedStatus, expectedUpdatedAt, intent, vault }) => {
          expect(expectedDedupeKey).toBe("dedupe_vault_file");
          expect(expectedStatus).toBe("pending");
          expect(expectedUpdatedAt).toBe("2026-04-08T00:00:00.000Z");
          expect(vault).toBe("/tmp/vault");
          storedIntent = intent;
          return intent;
        },
      );

      const sideEffects = await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort: null,
        includeBackgroundDueIntents: true,
        preferredIntentIds: ["intent_vault_file"],
        vaultRoot: "/tmp/vault",
      });

      expect(sideEffects).toEqual([]);
      expect(storedIntent).toMatchObject({
        intentId: "intent_vault_file",
        lastError: {
          code: "ASSISTANT_VAULT_FILE_APPROVAL_CHECK_DEFERRED",
        },
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "awaiting_approval",
      });
      expect(mocks.buildAssistantVaultFileSendApprovalRequest).not.toHaveBeenCalled();
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).toHaveBeenCalledTimes(1);

      const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
        now: new Date("2026-04-08T00:00:00.000Z"),
        vaultRoot: "/tmp/vault",
      });

      expect(wakeAt).toBe("2026-04-08T00:01:00.000Z");
    } finally {
      vi.useRealTimers();
    }
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

  it("orders background delivery candidates by instant when createdAt offsets differ", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_later",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_later",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_222222222222222222222222",
        identityId: "identity_1",
        intentId: "intent_later",
        lastError: null,
        message: "later instant",
        nextAttemptAt: "2026-04-08T00:00:00.000Z",
        replyToMessageId: "later-message",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_2",
        threadIsDirect: true,
        turnId: "turn_later",
      },
      {
        actorId: "actor_earlier",
        bindingDelivery: null,
        channel: "linq",
        createdAt: "2026-04-08T00:30:00+01:00",
        dedupeKey: "dedupe_earlier",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: true,
        explicitTarget: "h1_111111111111111111111111",
        identityId: "identity_1",
        intentId: "intent_earlier",
        lastError: null,
        message: "earlier instant",
        nextAttemptAt: "2026-04-08T00:30:00+01:00",
        replyToMessageId: "earlier-message",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_earlier",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.effectId).toBe("intent_earlier");
    expect(sideEffects[0]?.payload.message).toBe("earlier instant");
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

  it("preserves overdue retryable next attempts as stable wakes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:01:30.000Z"));
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
        lastError: {
          code: "LINQ_TEMPORARY_FAILURE",
          message: "temporary provider failure",
        },
        message: "hello linq",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: null,
        sessionId: "session_1",
        status: "retryable",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_linq",
      },
    ]);

    const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: "/tmp/vault",
    });

    expect(wakeAt).toBe("2026-04-08T00:01:00.000Z");
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

  it("terminally fails disabled auto-reply delivery before dispatch", async () => {
    const effect = createEffect();
    const disabledError = {
      code: "ASSISTANT_DELIVERY_CHANNEL_DISABLED",
      message: "Assistant auto-reply delivery over telegram is disabled.",
    };
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set([effect.effectId]));
    mocks.hasAssistantAutoReplyChannel.mockReturnValue(false);
    mocks.readAssistantAutomationState.mockResolvedValue({ autoReply: [] });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        channel: "telegram",
        delivery: null,
        intentId: effect.effectId,
        lastError: null,
        status: "retryable",
        turnId: "turn_123",
      }),
    );
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue({
      delivery: null,
      intentId: effect.effectId,
      lastError: disabledError,
      status: "failed",
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_CHANNEL_DISABLED",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "failed",
        vault: HOSTED_WAKE.vaultRoot,
      }),
    );
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("uses receipt-derived legacy auto-reply provenance before dispatch", async () => {
    const effect = createEffect();
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set([effect.effectId]));
    mocks.hasAssistantAutoReplyChannel.mockReturnValue(false);
    mocks.readAssistantAutomationState.mockResolvedValue({ autoReply: [] });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        channel: "telegram",
        delivery: null,
        intentId: effect.effectId,
        lastError: null,
        status: "retryable",
        turnId: "turn_123",
      }),
    );
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue({
      delivery: null,
      intentId: effect.effectId,
      lastError: {
        code: "ASSISTANT_DELIVERY_CHANNEL_DISABLED",
        message: "Assistant auto-reply delivery over telegram is disabled.",
      },
      status: "failed",
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes[0]).toMatchObject({
      deliveryErrorCode: "ASSISTANT_DELIVERY_CHANNEL_DISABLED",
      deliveryStatus: "failed",
      retryable: false,
    });
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

  it("resets remaining prepared background deliveries when foreground work appears after an accepted outcome", async () => {
    const firstEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_first",
      deliveryPhase: "background_retry",
      effectId: "intent_first",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_first",
        transportIdempotent: true,
      }),
    });
    const secondEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_second",
      deliveryPhase: "background_retry",
      effectId: "intent_second",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_second",
        transportIdempotent: true,
      }),
    });
    let shouldYield = false;
    const yieldedCounts: number[] = [];
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
          deliveryTransportIdempotent: true,
          intentId: firstEffect.effectId,
          lastError: null,
          status: "sending",
        },
        {
          sendingStartedAt: "2026-04-08T00:00:05.000Z",
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      expect(request).toEqual(expect.objectContaining({
        allowPreparedSending: true,
        intentId: "intent_first",
        preparedDispatch: {
          deliveryIdempotencyKey: "assistant-outbox:intent_first",
          deliveryTransportIdempotent: true,
          preparedDispatchToken: "prepared-dispatch-token-first",
        },
      }));
      shouldYield = true;
      return createDispatchResult({
        delivery: createDelivery({
          idempotencyKey: "assistant-outbox:intent_first",
        }),
        intentId: "intent_first",
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [firstEffect, secondEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      onBackgroundDeliveryYield: ({ yieldedEffectCount }) => {
        yieldedCounts.push(yieldedEffectCount);
      },
      preparedDispatches: [
        {
          intentId: "intent_first",
          preparedDispatchToken: "prepared-dispatch-token-first",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryIdempotencyKey: "assistant-outbox:intent_first",
            deliveryTransportIdempotent: true,
          }),
        },
        {
          intentId: "intent_second",
          preparedDispatchToken: "prepared-dispatch-token-second",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryIdempotencyKey: "assistant-outbox:intent_second",
            deliveryTransportIdempotent: true,
          }),
        },
      ],
      providerFetch: vi.fn<typeof fetch>(),
      shouldYieldBackgroundDelivery: () => shouldYield,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        effectId: "intent_first",
      }),
    ]);
    expect(yieldedCounts).toEqual([1]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.readAssistantOutboxIntentMirrorState).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_second",
      deliveryTransportIdempotent: true,
      intentId: "intent_second",
      preparedDispatchToken: "prepared-dispatch-token-second",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryIdempotencyKey: "assistant-outbox:intent_second",
        deliveryTransportIdempotent: true,
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("resets the current prepared background delivery when foreground work appears before outbox dispatch", async () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_yield_before_dispatch",
      deliveryPhase: "background_retry",
      effectId: "intent_yield_before_dispatch",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_yield_before_dispatch",
        transportIdempotent: true,
      }),
    });
    const yieldedCounts: number[] = [];
    let yieldChecks = 0;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_yield_before_dispatch",
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

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      onBackgroundDeliveryYield: ({ yieldedEffectCount }) => {
        yieldedCounts.push(yieldedEffectCount);
      },
      preparedDispatches: [{
        intentId: "intent_yield_before_dispatch",
        preparedDispatchToken: "prepared-dispatch-token-yield-before-dispatch",
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryIdempotencyKey: "assistant-outbox:intent_yield_before_dispatch",
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch: vi.fn<typeof fetch>(),
      shouldYieldBackgroundDelivery: () => {
        yieldChecks += 1;
        return yieldChecks >= 2;
      },
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([]);
    expect(yieldedCounts).toEqual([1]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_yield_before_dispatch",
      deliveryTransportIdempotent: true,
      intentId: "intent_yield_before_dispatch",
      preparedDispatchToken: "prepared-dispatch-token-yield-before-dispatch",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryIdempotencyKey: "assistant-outbox:intent_yield_before_dispatch",
        deliveryTransportIdempotent: true,
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("rethrows provider-entry foreground yield without persisting a delivery failure", async () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_yield_at_provider_entry",
      deliveryPhase: "background_retry",
      effectId: "intent_yield_at_provider_entry",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
        transportIdempotent: true,
      }),
    });
    const yieldedCounts: number[] = [];
    let yieldChecks = 0;
    let providerEntryYieldWasRethrown = false;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
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
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      expect(request).toEqual(expect.objectContaining({
        allowPreparedSending: true,
        intentId: "intent_yield_at_provider_entry",
        preparedDispatch: {
          deliveryIdempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
          deliveryTransportIdempotent: true,
          preparedDispatchToken: "prepared-dispatch-token-yield-at-provider-entry",
        },
      }));
      try {
        await request.dependencies.sendTelegram({
          idempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
          message: "hello from hosted",
          replyToMessageId: null,
          target: "chat_123",
        });
      } catch (error) {
        providerEntryYieldWasRethrown =
          request.dispatchHooks?.shouldRethrowDispatchError?.({
            error,
            intent: {
              intentId: "intent_yield_at_provider_entry",
            },
            vault: HOSTED_WAKE.vaultRoot,
          }) === true;
        if (providerEntryYieldWasRethrown) {
          throw error;
        }
        return createDispatchResult(
          {
            lastError: {
              code: "HOSTED_BACKGROUND_DELIVERY_YIELDED",
              message: "Hosted background delivery yielded to fresh foreground input.",
            },
            status: "retryable",
          },
          {
            code: "HOSTED_BACKGROUND_DELIVERY_YIELDED",
            message: "Hosted background delivery yielded to fresh foreground input.",
          },
        );
      }
      throw new Error("expected provider-entry foreground yield");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      onBackgroundDeliveryYield: ({ yieldedEffectCount }) => {
        yieldedCounts.push(yieldedEffectCount);
      },
      preparedDispatches: [{
        intentId: "intent_yield_at_provider_entry",
        preparedDispatchToken: "prepared-dispatch-token-yield-at-provider-entry",
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryIdempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch: vi.fn<typeof fetch>(),
      shouldYieldBackgroundDelivery: () => {
        yieldChecks += 1;
        return yieldChecks >= 3;
      },
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([]);
    expect(providerEntryYieldWasRethrown).toBe(true);
    expect(yieldedCounts).toEqual([1]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
      deliveryTransportIdempotent: true,
      intentId: "intent_yield_at_provider_entry",
      preparedDispatchToken: "prepared-dispatch-token-yield-at-provider-entry",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
        deliveryIdempotencyKey: "assistant-outbox:intent_yield_at_provider_entry",
        deliveryTransportIdempotent: true,
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("leaves unprepared provider-entry foreground yield retryable in the outbox", async () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_unprepared_yield_at_provider_entry",
      deliveryPhase: "background_retry",
      effectId: "intent_unprepared_yield_at_provider_entry",
      payload: createPayload({
        idempotencyKey: "assistant-outbox:intent_unprepared_yield_at_provider_entry",
        transportIdempotent: false,
      }),
    });
    let yieldChecks = 0;
    let providerEntryYieldWasRethrown = true;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(
        {
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_unprepared_yield_at_provider_entry",
          deliveryTransportIdempotent: false,
          intentId: effect.effectId,
          lastError: null,
          status: "pending",
        },
        {
          sendingStartedAt: null,
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async (request) => {
      expect(request).toEqual(expect.objectContaining({
        intentId: "intent_unprepared_yield_at_provider_entry",
      }));
      expect(request).not.toHaveProperty("allowPreparedSending");
      expect(request).not.toHaveProperty("preparedDispatch");
      try {
        await request.dependencies.sendTelegram({
          idempotencyKey: "assistant-outbox:intent_unprepared_yield_at_provider_entry",
          message: "hello from hosted",
          replyToMessageId: null,
          target: "chat_123",
        });
      } catch (error) {
        providerEntryYieldWasRethrown =
          request.dispatchHooks?.shouldRethrowDispatchError?.({
            error,
            intent: {
              intentId: "intent_unprepared_yield_at_provider_entry",
            },
            vault: HOSTED_WAKE.vaultRoot,
          }) === true;
        expect(providerEntryYieldWasRethrown).toBe(false);
        return createDispatchResult(
          {
            intentId: "intent_unprepared_yield_at_provider_entry",
            lastError: {
              code: "HOSTED_BACKGROUND_DELIVERY_YIELDED",
              diagnosticContext: {
                retryable: true,
              },
              message: "Hosted background delivery yielded to fresh foreground input.",
            },
            nextAttemptAt: "2026-04-08T00:00:30.000Z",
            status: "retryable",
          },
          {
            code: "HOSTED_BACKGROUND_DELIVERY_YIELDED",
            diagnosticContext: {
              retryable: true,
            },
            message: "Hosted background delivery yielded to fresh foreground input.",
          },
        );
      }
      throw new Error("expected provider-entry foreground yield");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      shouldYieldBackgroundDelivery: () => {
        yieldChecks += 1;
        return yieldChecks === 3;
      },
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "HOSTED_BACKGROUND_DELIVERY_YIELDED",
        deliveryStatus: "retryable",
        effectId: "intent_unprepared_yield_at_provider_entry",
        retryable: true,
      }),
    ]);
    expect(providerEntryYieldWasRethrown).toBe(false);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
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
          diagnosticContext: {
            code: "TELEGRAM_TEMPORARY_FAILURE",
            description: "Forbidden: bot was blocked by the user",
            errorCode: 403,
            operation: "Telegram Bot API setMessageReaction",
            retryable: false,
            status: 403,
            target: "telegram:chat:123456789",
          },
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
    expect(outcomes[0]?.deliveryErrorDetails).toMatchObject({
      code: "TELEGRAM_TEMPORARY_FAILURE",
      description: "Forbidden: bot was blocked by the user",
      errorCode: 403,
      operation: "Telegram Bot API setMessageReaction",
      retryable: false,
      status: 403,
      target: "[redacted-telegram-target:chat]",
    });
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it.each([
    { channel: "linq", transportIdempotent: false },
    { channel: "telegram", transportIdempotent: true },
  ] as const)(
    "does not block the same-turn reply after a retryable $channel reaction-only failure",
    async ({ channel, transportIdempotent }) => {
      const retryAt = "2099-04-08T00:05:00.000Z";
      const reactionEffect = buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_reaction",
        deliveryPhase: "foreground_current_turn",
        effectId: "intent_reaction",
        payload: createPayload({
          channel,
          idempotencyKey: "assistant-outbox:intent_reaction",
          message: "",
          replyToMessageId: "message-one",
          transportIdempotent,
        }),
      });
      const messageEffect = buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_message",
        deliveryPhase: "foreground_current_turn",
        effectId: "intent_message",
        payload: createPayload({
          channel,
          idempotencyKey: "assistant-outbox:intent_message",
          message: "hello from hosted",
          replyToMessageId: "message-one",
        }),
      });
      mocks.readAssistantOutboxIntentMirrorState.mockImplementation(async ({ intentId }) => {
        if (intentId === "intent_reaction") {
          return createMirrorState({
            delivery: null,
            deliveryIdempotencyKey: "assistant-outbox:intent_reaction",
            deliveryTransportIdempotent: true,
            intentId: "intent_reaction",
            lastError: {
              code: "TELEGRAM_TEMPORARY_FAILURE",
              message: "temporary provider failure",
            },
            nextAttemptAt: retryAt,
            status: "retryable",
          });
        }
        return createMirrorState({
          delivery: null,
          deliveryIdempotencyKey: "assistant-outbox:intent_message",
          deliveryTransportIdempotent: false,
          intentId: "intent_message",
          lastError: null,
          status: "pending",
        });
      });
      mocks.dispatchAssistantOutboxIntent
        .mockResolvedValueOnce(
          createDispatchResult(
            {
              intentId: "intent_reaction",
              lastError: {
                code: "TELEGRAM_TEMPORARY_FAILURE",
                message: "temporary provider failure",
              },
              status: "retryable",
            },
            {
              code: "TELEGRAM_TEMPORARY_FAILURE",
              diagnosticContext: {
                code: "TELEGRAM_TEMPORARY_FAILURE",
                description: "Too Many Requests: retry later",
                errorCode: 429,
                operation: "Telegram Bot API setMessageReaction",
                retryable: true,
                status: 429,
                target: "telegram:chat:123456789",
              },
              message: "temporary provider failure",
            },
          ),
        )
        .mockResolvedValueOnce(
          createDispatchResult({
            delivery: createDelivery({
              idempotencyKey: "assistant-outbox:intent_message",
            }),
            intentId: "intent_message",
            status: "sent",
          }),
        );

      const outcomes = await drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [reactionEffect, messageEffect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });

      expect(outcomes.map((outcome) => outcome.effectId)).toEqual([
        "intent_reaction",
        "intent_message",
      ]);
      expect(outcomes[0]?.deliveryStatus).toBe("retryable");
      expect(outcomes[1]?.deliveryStatus).toBe("sent");
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
      expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
    },
  );

  it("does not block the same-turn reply after an ambiguous non-idempotent Linq reaction", async () => {
    const reactionEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_reaction",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_reaction",
      payload: createPayload({
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_reaction",
        message: "",
        replyToMessageId: "linq_message_1",
        transportIdempotent: false,
      }),
    });
    const messageEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_message",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_message",
      payload: createPayload({
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_message",
        message: "fallback reply",
        replyToMessageId: "linq_message_1",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: null,
        deliveryIdempotencyKey: "assistant-outbox:intent_reaction",
        deliveryTransportIdempotent: false,
        intentId: "intent_reaction",
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult(
        {
          intentId: "intent_reaction",
          lastError: {
            code: "ASSISTANT_DELIVERY_AMBIGUOUS",
            message: "Ambiguous Linq reaction delivery.",
          },
          status: "abandoned",
        },
        {
          code: "ASSISTANT_DELIVERY_AMBIGUOUS",
          message: "Ambiguous Linq reaction delivery.",
        },
      ),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [reactionEffect, messageEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.effectId)).toEqual([
      "intent_reaction",
      "intent_message",
    ]);
    expect(outcomes[0]?.deliveryStatus).toBe("failed_ambiguous");
    expect(outcomes[1]?.deliveryStatus).toBe("sent");
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("preserves provider diagnostics from persisted mirror failures", async () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_reaction",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_reaction",
      payload: createPayload({
        channel: "telegram",
        idempotencyKey: "assistant-outbox:intent_reaction",
        replyToMessageId: "message-one",
      }),
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: null,
        deliveryIdempotencyKey: "assistant-outbox:intent_reaction",
        deliveryTransportIdempotent: false,
        intentId: "intent_reaction",
        lastError: {
          code: "ASSISTANT_TELEGRAM_REACTION_FAILED",
          diagnosticContext: {
            code: "ASSISTANT_TELEGRAM_REACTION_FAILED",
            description: "Forbidden: reaction is unavailable.",
            errorCode: 403,
            operation: "Telegram Bot API setMessageReaction",
            retryable: false,
            status: 403,
            target: "telegram:chat:123456789",
          },
          message:
            "Telegram Bot API setMessageReaction failed with HTTP 403; Telegram error_code 403; description: Forbidden: reaction is unavailable.",
        },
        status: "failed",
      }),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      deliveryChannel: "telegram",
      deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_FAILED",
      deliveryErrorDetails: {
        code: "ASSISTANT_TELEGRAM_REACTION_FAILED",
        description: "Forbidden: reaction is unavailable.",
        errorCode: 403,
        operation: "Telegram Bot API setMessageReaction",
        retryable: false,
        status: 403,
        target: "[redacted-telegram-target:chat]",
      },
      deliveryStatus: "failed",
      retryable: false,
      target: "chat_123",
      targetKind: "participant",
    });
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
      dispatchHooks: expect.objectContaining({
        preflightDispatchIntent: expect.any(Function),
      }),
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
      dispatchHooks: expect.objectContaining({
        preflightDispatchIntent: expect.any(Function),
      }),
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
      dispatchHooks: expect.objectContaining({
        preflightDispatchIntent: expect.any(Function),
      }),
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

  it("routes persisted Telegram reaction intents without payload operations", async () => {
    const effect = createEffect({
      message: "",
      replyToMessageId: "message_1",
      transportIdempotent: true,
    });
    expect(effect.payload).not.toHaveProperty("operation");
    mocks.setTelegramMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      target: "chat_123",
      targetMessageId: "message_1",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.setTelegramMessageReaction({
        reaction: "heart",
        target: "chat_123",
        targetMessageId: "message_1",
      });

      return createDispatchResult({
        delivery: {
          channel: "telegram",
          idempotencyKey: "assistant-outbox:intent_123",
          kind: "message-reaction",
          reaction: delivery.reaction,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: delivery.target,
          targetKind: "participant",
          targetMessageId: delivery.targetMessageId,
        },
        status: "sent",
      });
    });
    const providerFetch = vi.fn<typeof fetch>();

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(mocks.setTelegramMessageReaction).toHaveBeenCalledWith({
      reaction: "heart",
      target: "chat_123",
      targetMessageId: "message_1",
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

  it("routes persisted Linq reaction intents without payload operations", async () => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    expect(effect.payload).not.toHaveProperty("operation");
    mocks.setLinqMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      targetMessageId: "linq_message_1",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_123",
        targetMessageId: "linq_message_1",
      });

      return createDispatchResult({
        delivery: {
          channel: "linq",
          idempotencyKey: "assistant-outbox:intent_123",
          kind: "message-reaction",
          reaction: delivery.reaction,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: delivery.target,
          targetKind: "thread",
          targetMessageId: delivery.targetMessageId,
        },
        status: "sent",
      });
    });
    const providerFetch = vi.fn<typeof fetch>();

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(mocks.setLinqMessageReaction).toHaveBeenCalledWith({
      reaction: "heart",
      targetMessageId: "linq_message_1",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
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

  it("blocks routed Linq reactions when route authority is revoked", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_reaction_revoked",
      linqMessage: {
        chatId: "linq_chat_123",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_1",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_123",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async () => {
      throw new Error("route revoked");
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_123",
        targetMessageId: "linq_message_1",
      });

      throw new Error("unreachable after engagement assertion failure");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake,
    })).rejects.toThrow("route revoked");

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({ routeAuthority }),
      { signal: null },
    );
    expect(mocks.setLinqMessageReaction).not.toHaveBeenCalled();
  });

  it("blocks Linq reactions when recent inbound engagement is missing", async () => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async () => {
      throw new Error("recent inbound required");
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_123",
        targetMessageId: "linq_message_1",
      });

      throw new Error("unreachable after engagement assertion failure");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toThrow("recent inbound required");

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        engagementKind: "requires_recent_inbound",
        idempotencyKey: "assistant-outbox:intent_123",
        intentId: "intent_123",
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(mocks.setLinqMessageReaction).not.toHaveBeenCalled();
  });

  it("marks signup welcome Linq sends as first-contact engagement", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      bindingDeliveryTarget: "+15550100001",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "participant" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
        replyToMessageId: null,
        target: "+15550100001",
        targetKind: "participant",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "signup-welcome:member_123",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: null,
        engagementKind: "first_contact",
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        target: "+15550100001",
        targetKind: "participant",
      }),
      {
        signal: null,
      },
    );
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15550100099",
        target: "+15550100001",
        targetKind: "participant",
      }),
      expect.any(Object),
    );
  });

  it("records hosted runtime Linq delivery outcomes after provider acceptance", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      bindingDeliveryTarget: "+15550100001",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "participant" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
        replyToMessageId: null,
        target: "+15550100001",
        targetKind: "participant",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "signup-welcome:member_123",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        attemptedAt: expect.stringMatching(/Z$/u),
        failureCode: null,
        failureReason: null,
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        intentId: "intent_123",
        providerMessageId: "linq_message_sent",
        providerTarget: null,
        providerThreadId: "linq_chat_123",
        routeAuthority: null,
        target: null,
        targetKind: "participant",
      }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps Linq sends successful when delivery outcome recording fails", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: false,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recordDeliveryOutcome = vi.fn(async () => {
      throw new Error("web callback unavailable");
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "reply",
        replyToMessageId: null,
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerMessageId: "linq_message_sent",
      }),
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted Linq delivery outcome recording failed.",
      { errorName: "Error" },
    );
    warnSpy.mockRestore();
  });

  it("keeps coverage-bearing Linq sends retryable until accepted outcomes record", async () => {
    const answeredCoverage = {
      lane: "conversation" as const,
      laneSeq: "42",
    };
    const effect = createEffect({
      answeredCoverage,
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: false,
    });
    const recordDeliveryOutcome = vi.fn(async () => {
      throw new Error("web callback unavailable");
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_123",
          message: "reply",
          replyToMessageId: null,
          target: "linq_chat_123",
          targetKind: "thread",
        });
      } catch (error) {
        expect((error as { deliveryMayHaveSucceeded?: boolean }).deliveryMayHaveSucceeded)
          .toBe(true);
        return createDispatchResult(
          {
            delivery: null,
            lastError: {
              code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
              message: "Accepted Linq delivery outcome could not be recorded.",
            },
            status: "retryable",
          },
          {
            code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
            message: "Accepted Linq delivery outcome could not be recorded.",
          },
        );
      }

      throw new Error("Expected coverage-bearing Linq send to await outcome recording.");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        deliveryStatus: "retryable",
      }),
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        answeredCoverage,
        providerMessageId: "linq_message_sent",
      }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("does not let one hung Linq outcome write block later outcome writes", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const recordDeliveryOutcome = vi.fn<
        NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
      >()
        .mockImplementationOnce(async () => await new Promise<void>(() => {}))
        .mockResolvedValueOnce(undefined);
      const effectsPort = createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      });

      mocks.sendLinqMessage.mockResolvedValueOnce({
        providerMessageId: "linq_message_first",
        providerThreadId: "linq_chat_1",
        target: "linq_chat_1",
        targetKind: "thread" as const,
      });
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
        const delivery = await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_1",
          message: "first",
          replyToMessageId: null,
          target: "linq_chat_1",
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

      await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [createEffect({
          bindingDeliveryTarget: "linq_chat_1",
          channel: "linq",
          explicitTarget: "linq_chat_1",
          transportIdempotent: false,
        })],
        effectsPort,
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await flushHostedRuntimeCallbackTestMicrotasks();
      expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);

      mocks.sendLinqMessage.mockResolvedValueOnce({
        providerMessageId: "linq_message_second",
        providerThreadId: "linq_chat_2",
        target: "linq_chat_2",
        targetKind: "thread" as const,
      });
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
        const delivery = await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_2",
          message: "second",
          replyToMessageId: null,
          target: "linq_chat_2",
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

      await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [createEffect({
          bindingDeliveryTarget: "linq_chat_2",
          channel: "linq",
          explicitTarget: "linq_chat_2",
          transportIdempotent: false,
        })],
        effectsPort,
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await flushHostedRuntimeCallbackTestMicrotasks();

      expect(recordDeliveryOutcome).toHaveBeenCalledTimes(2);
      expect(recordDeliveryOutcome.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          providerMessageId: "linq_message_second",
        }),
      );

      await vi.advanceTimersByTimeAsync(2_000);
      await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();
      expect(warnSpy).toHaveBeenCalledWith(
        "Hosted Linq delivery outcome recording timed out.",
        { timeoutMs: 2_000 },
      );
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("records Linq provider send failures without raw provider details", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: false,
    });
    const providerError = Object.assign(
      new Error("provider_msg_private failed for +15550109999 with private reply text"),
      { code: "LINQ_PROVIDER_FAILED" },
    );
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => undefined);
    mocks.sendLinqMessage.mockRejectedValueOnce(providerError);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_123",
          message: "private reply text",
          replyToMessageId: null,
          target: "linq_chat_123",
          targetKind: "thread",
        });
      } catch {
        return createDispatchResult({
          delivery: null,
          status: "failed",
        }, {
          code: "LINQ_PROVIDER_FAILED",
          message: "Provider send failed.",
        });
      }

      throw new Error("Expected Linq send to fail.");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "LINQ_PROVIDER_FAILED",
        deliveryStatus: "failed",
      }),
    ]);
    const outcomeRequest = recordDeliveryOutcome.mock.calls[0]?.[0];
    expect(outcomeRequest).toEqual(
      expect.objectContaining({
        attemptedAt: expect.stringMatching(/Z$/u),
        failedAt: expect.stringMatching(/Z$/u),
        failureCode: "LINQ_PROVIDER_FAILED",
        failureReason: null,
        idempotencyKey: "assistant-outbox:intent_123",
        providerMessageId: null,
        providerThreadId: null,
        target: "linq_chat_123",
        targetKind: "thread",
      }),
    );
    expect(outcomeRequest).not.toHaveProperty("acceptedAt");
    expect(recordDeliveryOutcome.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });
    const recordedOutcome = JSON.stringify(outcomeRequest);
    expect(recordedOutcome).not.toContain("provider_msg_private");
    expect(recordedOutcome).not.toContain("+15550109999");
    expect(recordedOutcome).not.toContain("private reply text");
  });

  it("requires recent inbound proof for signup welcome Linq sends into existing threads", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
        replyToMessageId: null,
        target: "linq_chat_123",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "signup-welcome:member_123",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: null,
        engagementKind: "requires_recent_inbound",
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15550100099",
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
  });

  it("does not reuse mismatched routed Linq authority for reactions", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_123",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_reaction_target_mismatch",
      linqMessage: {
        chatId: "linq_chat_123",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_1",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_123",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.setLinqMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      targetMessageId: "linq_message_other",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_other",
        targetMessageId: "linq_message_other",
      });

      return createDispatchResult({
        delivery: {
          channel: "linq",
          idempotencyKey: "assistant-outbox:intent_123",
          kind: "message-reaction",
          reaction: delivery.reaction,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: delivery.target,
          targetKind: "thread",
          targetMessageId: delivery.targetMessageId,
        },
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      directRecipientPhoneNumber: null,
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      routeAuthority: null,
      target: "linq_chat_other",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(mocks.setLinqMessageReaction).toHaveBeenCalledWith({
      reaction: "heart",
      targetMessageId: "linq_message_other",
    }, expect.any(Object));
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_other",
      }),
    ]);
  });

  it("marks post-dispatch Linq reaction transport errors as possibly committed", async () => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    let capturedError: unknown = null;
    mocks.setLinqMessageReaction.mockRejectedValueOnce(
      new VaultCliError(
        "LINQ_API_REQUEST_FAILED",
        "Linq request POST /messages/linq_message_1/reactions failed before a response was returned.",
        {
          failureStage: "transport",
          operation: "set_message_reaction",
          provider: "linq",
          retryable: false,
        },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.setLinqMessageReaction({
          reaction: "heart",
          target: "linq_chat_123",
          targetMessageId: "linq_message_1",
        });
      } catch (error) {
        capturedError = error;
        return createDispatchResult(
          {
            intentId: "intent_123",
            lastError: {
              code: "ASSISTANT_DELIVERY_AMBIGUOUS",
              message: "Ambiguous Linq reaction delivery.",
            },
            status: "abandoned",
          },
          {
            code: "ASSISTANT_DELIVERY_AMBIGUOUS",
            message: "Ambiguous Linq reaction delivery.",
          },
        );
      }

      throw new Error("expected Linq reaction transport failure");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(capturedError).toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      deliveryMayHaveSucceeded: true,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
  });

  it("marks post-success Linq reaction liveness aborts as possibly committed", async () => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    let capturedError: unknown = null;
    const assertLiveness = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("aborted after Linq reaction response"));
    mocks.setLinqMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      targetMessageId: "linq_message_1",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.setLinqMessageReaction({
          reaction: "heart",
          target: "linq_chat_123",
          targetMessageId: "linq_message_1",
        });
      } catch (error) {
        capturedError = error;
        return createDispatchResult(
          {
            intentId: "intent_123",
            lastError: {
              code: "ASSISTANT_DELIVERY_AMBIGUOUS",
              message: "Ambiguous Linq reaction delivery.",
            },
            status: "abandoned",
          },
          {
            code: "ASSISTANT_DELIVERY_AMBIGUOUS",
            message: "Ambiguous Linq reaction delivery.",
          },
        );
      }

      throw new Error("expected post-success Linq reaction liveness failure");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      assertLiveness,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertLiveness).toHaveBeenCalledTimes(2);
    expect(capturedError).toMatchObject({
      deliveryMayHaveSucceeded: true,
      message: "aborted after Linq reaction response",
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
  });

  it("provides hosted Telegram voice memo runtime env and provider fetch without an all-in-one sender", async () => {
    const effect = createEffect({
      media: [
        createHostedVoiceMemoMedia({
          transport: {
            generation: {
              kind: "elevenlabs_speech",
              modelId: "eleven_multilingual_v2",
              outputFormat: "mp3_44100_128",
              text: "Short memo",
              voiceId: "voice_murph",
            },
            kind: "telegram_generation",
          },
        }),
      ],
      message: "",
      transportIdempotent: false,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      expect("sendTelegramVoiceMemo" in dependencies).toBe(false);
      expect(dependencies.telegramVoiceMemoRuntime).toMatchObject({
        env: {
          ELEVENLABS_API_KEY: "elevenlabs-sentinel",
          MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
          MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
          TELEGRAM_API_BASE_URL: "https://api.telegram.example",
          TELEGRAM_BOT_TOKEN: "telegram-token",
          TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
        },
      });
      expect(typeof dependencies.telegramVoiceMemoRuntime?.fetchImplementation)
        .toBe("function");
      await dependencies.telegramVoiceMemoRuntime!.fetchImplementation!(
        "https://api.elevenlabs.io/v1/text-to-speech/voice_murph",
        { method: "POST" },
      );

      return createDispatchResult({
        delivery: createDelivery({
          providerMessageId: "telegram_voice_sent",
          target: "chat_123",
        }),
        status: "sent",
      });
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "audio/mpeg",
        },
        status: 200,
      })
    );

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

    expect(providerFetch).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice_murph",
      { method: "POST" },
    );
    expect(mocks.sendTelegramVoiceMemoMessage).not.toHaveBeenCalled();
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
    const assertRecentInbound = vi.fn(async () => undefined);
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: "+15550001",
        routeAuthority: null,
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
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
      target: "linq_chat_current",
      targetKind: "thread",
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

  it("revalidates routed Linq authority before provider egress", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_routed_provider_fetch",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the routed wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      directRecipientPhoneNumber: "+15550001",
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      routeAuthority,
      target: "linq_chat_current",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(assertRecentInbound.mock.invocationCallOrder[0] ?? 0)
      .toBeLessThan(mocks.sendLinqMessage.mock.invocationCallOrder[0] ?? 0);
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("records Linq egress guard latency without blocking provider egress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00.000Z"));
    try {
      const effect = createEffect({
        actorId: "ain_hashed_actor",
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_current",
        channel: "linq",
        explicitTarget: "linq_chat_current",
        replyToMessageId: "linq_message_current",
        transportIdempotent: true,
      });
      const assertRecentInbound = vi.fn(async () => {
        vi.setSystemTime(new Date("2026-06-29T12:00:00.017Z"));
      });
      const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
      const latencyTraceRecord = vi.fn(async (request: HostedRuntimeLatencyTraceRequest) => {
        latencyTraceRequests.push(request);
        return {
          matchedCount: 1,
          recorded: true,
          unmatchedCount: 0,
        };
      });
      mocks.sendLinqMessage.mockResolvedValueOnce({
        providerMessageId: "linq_message_sent",
        providerThreadId: "linq_chat_current",
        target: "linq_chat_current",
        targetKind: "thread" as const,
      });
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
        const delivery = await dependencies.sendLinq({
          directRecipientPhoneNumber: null,
          fromPhoneNumber: null,
          idempotencyKey: "assistant-outbox:intent_hashed_target",
          message: "hello from hosted",
          replyToMessageId: "linq_message_current",
          target: "linq_chat_current",
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
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertLinqRecentInboundEngagement: assertRecentInbound,
        }),
        linqEgressLatencyTrace: {
          assistantInputIds: ["input_latency_1"],
          latencyTracePort: {
            record: latencyTraceRecord,
          },
          runtimeAttemptId: "attempt_latency_1",
        },
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });

      expect(latencyTraceRequests).toEqual([
        {
          event: {
            assistantInputIds: ["input_latency_1"],
            at: "2026-06-29T12:00:00.017Z",
            phaseBreakdown: {
              provider: {
                linqEgressGuardMs: 17,
              },
              schemaVersion: 1,
            },
            providerRequestOrdinal: 0,
            runtimeAttemptId: "attempt_latency_1",
            source: "linq",
            type: "provider_started",
          },
        },
      ]);
      expect(assertRecentInbound.mock.invocationCallOrder[0] ?? 0)
        .toBeLessThan(latencyTraceRecord.mock.invocationCallOrder[0] ?? 0);
      expect(latencyTraceRecord.mock.invocationCallOrder[0] ?? 0)
        .toBeLessThan(mocks.sendLinqMessage.mock.invocationCallOrder[0] ?? 0);
      expect(outcomes).toEqual([
        expect.objectContaining({
          deliveryChannel: "linq",
          deliveryStatus: "sent",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects routed Linq authority from the matching delivery context", async () => {
    const matchingRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:account_a",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_a",
    };
    const otherRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:account_b",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_b",
    };
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_a",
      channel: "linq",
      explicitTarget: "linq_chat_a",
      replyToMessageId: "linq_message_a",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_a",
      target: "linq_chat_a",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_a",
        target: "linq_chat_a",
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      linqDeliveryContexts: [
        {
          directRecipientPhoneNumber: "+15550000002",
          fromPhoneNumber: "+15559990000",
          replyToMessageId: "linq_message_b",
          routeAuthority: otherRouteAuthority,
          service: "iMessage",
          target: "linq_chat_b",
          threadIsDirect: true,
        },
        {
          currentInbound: {
            dedupeKey: "evt_linq_current",
            eventId: "evt_linq_current",
            mailboxItemId: "mailbox_item_linq_current",
            occurredAt: "2026-04-08T00:00:00.000Z",
            replyToMessageId: "linq_message_a",
            target: "linq_chat_a",
          },
          directRecipientPhoneNumber: "+15550000001",
          fromPhoneNumber: "+15559990000",
          replyToMessageId: "linq_message_a",
          routeAuthority: matchingRouteAuthority,
          service: "iMessage",
          target: "linq_chat_a",
          threadIsDirect: true,
        },
      ],
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      currentInbound: {
        dedupeKey: "evt_linq_current",
        eventId: "evt_linq_current",
        mailboxItemId: "mailbox_item_linq_current",
        occurredAt: "2026-04-08T00:00:00.000Z",
        replyToMessageId: "linq_message_a",
        target: "linq_chat_a",
      },
      directRecipientPhoneNumber: "+15550000001",
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: "+15559990000",
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      routeAuthority: matchingRouteAuthority,
      target: "linq_chat_a",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15559990000",
        target: "linq_chat_a",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_a",
      }),
    ]);
  });

  it("does not reuse mismatched routed Linq authority for provider egress", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_routed_target_mismatch",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the routed wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_other",
      target: "linq_chat_other",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_other",
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      directRecipientPhoneNumber: null,
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      routeAuthority: null,
      target: "linq_chat_other",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "linq_chat_other",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_other",
      }),
    ]);
  });

  it("uses the same-wake Linq target when replyTo recovers a non-routed send", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_non_routed_target_mismatch",
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
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_other",
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      directRecipientPhoneNumber: "+15550001",
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      routeAuthority: null,
      target: "linq_chat_current",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        target: "linq_chat_other",
      }),
      expect.any(Object),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_current",
      }),
    ]);
  });

  it("blocks routed Linq provider egress when route authority is revoked", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_routed_revoked",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the routed wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async () => {
      throw new Error("route revoked");
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
        targetKind: "thread",
      });

      throw new Error("unreachable after engagement assertion failure");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toThrow("route revoked");

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({ routeAuthority }),
      { signal: null },
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("authorizes routed Linq sends before vault-file approval or reads", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_media_revoked",
      linqMessage: {
        chatId: "linq_chat_current",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [
          {
            type: "text",
            value: "hello on the routed wake",
          },
        ],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const media = {
      approvalGeneration: "b".repeat(64),
      approvalId: `haa_${"a".repeat(32)}`,
      contentType: "application/pdf",
      filename: "report.pdf",
      kind: "vault_file" as const,
      ref: "derived/report.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 42,
    };
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      media: [media],
      transportIdempotent: true,
    });
    const actionApprovalPort = {
      consume: vi.fn(),
      request: vi.fn(async () => ({
        approvalGeneration: "b".repeat(64),
        approvalId: "approval_123",
        status: "approved" as const,
      })),
    };
    const assertRecentInbound = vi.fn(async () => {
      throw new Error("route revoked before media work");
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        media: [media],
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
        targetKind: "thread",
      });

      throw new Error("unreachable after engagement assertion failure");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      actionApprovalPort,
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toThrow("route revoked before media work");

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({ routeAuthority }),
      { signal: null },
    );
    expect(actionApprovalPort.request).not.toHaveBeenCalled();
    expect(mocks.readAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("consumes approved vault-file actions before hosted Linq delivery", async () => {
    const vaultFile = {
      approvalGeneration: "b".repeat(64),
      approvalId: `haa_${"a".repeat(32)}`,
      contentType: "application/pdf",
      filename: "report.pdf",
      kind: "vault_file" as const,
      ref: "documents/report.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 42,
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "chat_123",
      channel: "linq",
      media: [vaultFile],
      transportIdempotent: true,
    });
    const approvalRequest = {
      actionFingerprint: "a".repeat(64),
      actionId: "vault-file-send:approved",
      actionKind: "vault.file.send.v1",
      presentation: {
        body: "Send a vault file.",
        title: "Send a file?",
      },
      returnContactKind: "text" as const,
    };
    const actionApprovalPort = {
      consume: vi.fn(async () => ({
        approvalGeneration: "b".repeat(64),
        approvalId: `haa_${"a".repeat(32)}`,
        status: "approved" as const,
      })),
      request: vi.fn(),
    };
    mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValueOnce(
      approvalRequest,
    );
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      media: [vaultFile],
    });
    mocks.readAssistantVaultFileMedia.mockReturnValueOnce(vaultFile);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_vault_file_sent",
      providerThreadId: "chat_123",
      target: "chat_123",
      targetKind: "thread",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        idempotencyKey: "assistant-outbox:intent_123",
        media: [vaultFile],
        message: "Attached.",
        replyToMessageId: null,
        target: "chat_123",
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
      actionApprovalPort,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 204 }),
      ),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(actionApprovalPort.consume).toHaveBeenCalledWith({
      approvalGeneration: "b".repeat(64),
      consumerId: "assistant-outbox:intent_123",
      request: approvalRequest,
    });
    expect(actionApprovalPort.request).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).toHaveBeenCalledWith({
      file: vaultFile,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [vaultFile],
        target: "chat_123",
      }),
      expect.objectContaining({
        loadVaultFile: expect.any(Function),
      }),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerMessageId: "linq_vault_file_sent",
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
    const assertRecentInbound = vi.fn(async () => undefined);
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
    const assertRecentInbound = vi.fn(async () => undefined);
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: "+15550001",
        routeAuthority: null,
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
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
    const assertRecentInbound = vi.fn(async () => undefined);
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: "+15550001",
        routeAuthority: null,
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
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

  it("sends to the recovered same-wake Linq chat without using contact fields as sender authority", async () => {
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
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: "+15550001",
        routeAuthority: null,
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(JSON.stringify(effect.payload)).not.toContain("+15559990000");
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      media: null,
      message: "hello from hosted",
      replyToMessageId: "linq_message_current",
      target: "linq_chat_current",
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

  it("keeps recovered same-wake Linq chat targets even when explicit sender authority is present", async () => {
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
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    const assertRecentInbound = vi.fn(async () => undefined);
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        routeAuthority: null,
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(JSON.stringify(effect.payload)).not.toContain("+15559990000");
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      fromPhoneNumber: "+15550002",
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      media: null,
      message: "hello from hosted",
      replyToMessageId: "linq_message_current",
      target: "linq_chat_current",
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

  it("shares the Linq contact card after an eligible delivered iMessage intent", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_contact_card",
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
        service: "iMessage",
        threadIsDirect: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    let resolveShare: () => void = () => {};
    const sharePromise = new Promise<void>((resolve) => {
      resolveShare = resolve;
    });
    const maybeShareLinqContactCardAfterOutbound = vi.fn(() => sharePromise);
    const providerFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550002",
        idempotencyKey: "assistant-outbox:intent_hashed_target",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
        targetKind: "thread",
      });
      const deliveryRecord = createDelivery({
        channel: "linq",
        providerMessageId: delivery.providerMessageId,
        providerThreadId: delivery.providerThreadId,
        target: delivery.target,
        targetKind: delivery.targetKind,
      });
      return createDispatchResult({
        delivery: deliveryRecord,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        maybeShareLinqContactCardAfterOutbound,
      }),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(maybeShareLinqContactCardAfterOutbound).toHaveBeenCalledWith({
      authority: routeAuthority,
      chatId: "linq_chat_current",
      service: "iMessage",
      threadIsDirect: true,
    }, {
      signal: null,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
    resolveShare();
    await Promise.resolve();
  });

  it("uses prepared Linq route authority for timer-wake contact-card sharing", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      replyToMessageId: "linq_message_current",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    const maybeShareLinqContactCardAfterOutbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_retry_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from retry",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
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
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        maybeShareLinqContactCardAfterOutbound,
      }),
      preparedDispatches: [{
        intentId: "intent_123",
        linqDeliveryContext: {
          directRecipientPhoneNumber: null,
          fromPhoneNumber: null,
          replyToMessageId: "linq_message_current",
          routeAuthority,
          service: "iMessage",
          target: "linq_chat_current",
          threadIsDirect: true,
        },
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
          status: "retryable",
        }),
      }],
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(maybeShareLinqContactCardAfterOutbound).toHaveBeenCalledWith({
      authority: routeAuthority,
      chatId: "linq_chat_current",
      service: "iMessage",
      threadIsDirect: true,
    }, {
      signal: null,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("uses recent-inbound engagement for route-scoped Linq timer retries without prepared authority", async () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_123",
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      payload: createPayload({
        actorId: "ain_hashed_actor",
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_current",
        channel: "linq",
        explicitTarget: "linq_chat_current",
        replyToMessageId: "linq_message_current",
        threadIsDirect: true,
        transportIdempotent: true,
      }),
    });
    const assertRecentInbound = vi.fn(async () => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from retry",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
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
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_retry_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      preparedDispatches: [{
        intentId: "intent_123",
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
          status: "retryable",
        }),
      }],
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith({
      directRecipientPhoneNumber: null,
      engagementKind: "requires_recent_inbound",
      fromPhoneNumber: null,
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      routeAuthority: null,
      target: "linq_chat_current",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("logs Linq contact-card callback failures without failing the sent outcome", async () => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_contact_card_failed",
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
        service: "iMessage",
        threadIsDirect: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const maybeShareLinqContactCardAfterOutbound = vi.fn(async () => {
      throw new Error("callback failed");
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_linq",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
        targetKind: "thread",
      });
      const deliveryRecord = createDelivery({
        channel: "linq",
        providerMessageId: delivery.providerMessageId,
        providerThreadId: delivery.providerThreadId,
        target: delivery.target,
        targetKind: delivery.targetKind,
      });
      return createDispatchResult({
        delivery: deliveryRecord,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        maybeShareLinqContactCardAfterOutbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });
    await Promise.resolve();

    expect(maybeShareLinqContactCardAfterOutbound).toHaveBeenCalledWith({
      authority: routeAuthority,
      chatId: "linq_chat_current",
      service: "iMessage",
      threadIsDirect: true,
    }, {
      signal: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(expect.objectContaining({
      component: "assistant-delivery",
      details: expect.objectContaining({
        chatIdSuffix: "urrent",
        errorMessage: "callback failed",
        operation: "share_contact_card",
        phase: "after_outbound",
        provider: "linq",
      }),
      level: "warn",
    }));
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("skips contact-card sharing for non-iMessage Linq deliveries", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_contact_card_sms",
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
        service: "SMS",
        threadIsDirect: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      userId: "member_123",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      transportIdempotent: true,
    });
    const maybeShareLinqContactCardAfterOutbound = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendLinq({
        idempotencyKey: "assistant-outbox:intent_linq",
        message: "hello from hosted",
        replyToMessageId: "linq_message_current",
        target: "linq_chat_current",
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerThreadId: "linq_chat_current",
        }),
        status: "sent",
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        maybeShareLinqContactCardAfterOutbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(maybeShareLinqContactCardAfterOutbound).not.toHaveBeenCalled();
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
