import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeTimerWake,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
} from "@murphai/hosted-execution";
import type {
  AssistantOutboxPreparedDispatchState,
} from "@murphai/assistant-engine";
import {
  getAssistantChannelAdapter,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryMedia,
  type HostedAssistantDeliveryPayload,
} from "@murphai/hosted-execution/side-effects";
import {
  buildHostedActionApprovalCycleOwnerKey,
  buildHostedActionApprovalOutcomeEffectId,
} from "@murphai/hosted-execution/action-approval";
import type {
  HostedPhoneCallResultDeliveryOutcomeRequest,
} from "@murphai/hosted-execution/phone-calls";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import type { AssistantOutboxIntent } from "@murphai/operator-config/assistant-cli-contracts";
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from "@murphai/runtime-state/assistant-generated-deliveries";
import type { HostedEmailSendRequest } from "../src/hosted-email.ts";
import type { HostedRuntimeLogPort } from "../src/hosted-runtime/platform.ts";

const mocks = vi.hoisted(() => ({
  applyAssistantVaultFileSendApprovalResult: vi.fn(),
  beginAssistantOutboxIntentMirrorDispatch: vi.fn(),
  beginAssistantOutboxIntentMirrorPreparedDispatch: vi.fn(),
  buildAssistantVaultFileSendApprovalRequest: vi.fn(),
  createAssistantOutboxIntent: vi.fn(),
  deferAssistantVaultFileApprovalCheck: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  findAssistantAutoReplyDeliveryIntentIds: vi.fn(),
  hasAssistantAutoReplyChannel: vi.fn(),
  hasPendingAssistantOutboxMessageVolumeReceipt: vi.fn(),
  listAssistantCronPendingDeliveryIntentIds: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  linqProviderFetchAttemptCount: vi.fn(() => 1),
  markAssistantOutboxIntentMirrorTerminalById: vi.fn(),
  markAssistantOutboxMessageVolumeReceiptRecorded: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  persistAssistantPrivateCompletionContinuityAfterDelivery: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readAssistantOutboxIntent: vi.fn(),
  readAssistantOutboxIntentMirrorState: vi.fn(),
  readAssistantVaultFileMedia: vi.fn(),
  readVerifiedAssistantVaultFileBytes: vi.fn(),
  readVerifiedAssistantVaultImageBytes: vi.fn(),
  resetAssistantOutboxPreparedDispatchById: vi.fn(),
  rescheduleAssistantOutboxMessageVolumeReceipt: vi.fn(),
  saveAssistantOutboxIntentIfUnchanged: vi.fn(),
  setLinqMessageReaction: vi.fn(),
  setTelegramMessageReaction: vi.fn(),
  sendLinqMessage: vi.fn(),
  sendLinqVoiceMemoMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendTelegramVoiceMemoMessage: vi.fn(),
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

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );
  return {
    ...actual,
    applyAssistantVaultFileSendApprovalResult:
      mocks.applyAssistantVaultFileSendApprovalResult,
    beginAssistantOutboxIntentMirrorDispatch:
      mocks.beginAssistantOutboxIntentMirrorDispatch,
    beginAssistantOutboxIntentMirrorPreparedDispatch:
      mocks.beginAssistantOutboxIntentMirrorPreparedDispatch,
    buildAssistantVaultFileSendApprovalRequest:
      mocks.buildAssistantVaultFileSendApprovalRequest,
    createAssistantOutboxIntent: mocks.createAssistantOutboxIntent,
    deferAssistantVaultFileApprovalCheck:
      mocks.deferAssistantVaultFileApprovalCheck,
    dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
    findAssistantAutoReplyDeliveryIntentIds:
      mocks.findAssistantAutoReplyDeliveryIntentIds,
    hasAssistantAutoReplyChannel: mocks.hasAssistantAutoReplyChannel,
    hasPendingAssistantOutboxMessageVolumeReceipt:
      mocks.hasPendingAssistantOutboxMessageVolumeReceipt,
    listAssistantCronPendingDeliveryIntentIds:
      mocks.listAssistantCronPendingDeliveryIntentIds,
    listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
    markAssistantOutboxIntentMirrorTerminalById:
      mocks.markAssistantOutboxIntentMirrorTerminalById,
    markAssistantOutboxMessageVolumeReceiptRecorded:
      mocks.markAssistantOutboxMessageVolumeReceiptRecorded,
    normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
    persistAssistantPrivateCompletionContinuityAfterDelivery:
      mocks.persistAssistantPrivateCompletionContinuityAfterDelivery,
    readAssistantAutomationState: mocks.readAssistantAutomationState,
    readAssistantOutboxIntent: mocks.readAssistantOutboxIntent,
    readAssistantOutboxIntentMirrorState:
      mocks.readAssistantOutboxIntentMirrorState,
    readAssistantVaultFileMedia: mocks.readAssistantVaultFileMedia,
    readVerifiedAssistantVaultFileBytes:
      mocks.readVerifiedAssistantVaultFileBytes,
    readVerifiedAssistantVaultImageBytes:
      mocks.readVerifiedAssistantVaultImageBytes,
    resetAssistantOutboxPreparedDispatchById:
      mocks.resetAssistantOutboxPreparedDispatchById,
    rescheduleAssistantOutboxMessageVolumeReceipt:
      mocks.rescheduleAssistantOutboxMessageVolumeReceipt,
    saveAssistantOutboxIntentIfUnchanged:
      mocks.saveAssistantOutboxIntentIfUnchanged,
    sendLinqMessage: mocks.sendLinqMessage,
    async sendTelegramMessage(
      ...args: Parameters<typeof actual.sendTelegramMessage>
    ) {
      if (
        args[1]?.env?.TELEGRAM_BOT_TOKEN
          === "telegram-actual-runtime-token"
      ) {
        return await actual.sendTelegramMessage(...args);
      }
      return await mocks.sendTelegramMessage(...args);
    },
    sendTelegramVoiceMemoMessage: mocks.sendTelegramVoiceMemoMessage,
    shouldDispatchAssistantOutboxIntent: mocks.shouldDispatchAssistantOutboxIntent,
  };
});

vi.mock("@murphai/assistant-engine/assistant-channel-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine/assistant-channel-runtime")>(
    "@murphai/assistant-engine/assistant-channel-runtime",
  );
  return {
    ...actual,
    async sendLinqMessage(
      ...args: Parameters<typeof actual.sendLinqMessage>
    ) {
      if (args[1]?.env?.LINQ_API_TOKEN === "linq-actual-runtime-token") {
        return await actual.sendLinqMessage(...args);
      }
      const providerFetch = args[1]?.fetchImplementation;
      if (!providerFetch) {
        throw new Error("Expected hosted Linq provider fetch boundary.");
      }
      for (
        let attempt = 0;
        attempt < mocks.linqProviderFetchAttemptCount();
        attempt += 1
      ) {
        const boundaryResponse = await providerFetch(
          "https://api.linq.example/test",
          { method: "POST" },
        );
        if (boundaryResponse instanceof Response && !boundaryResponse.ok) {
          throw new Error("Hosted Linq provider entry was denied.");
        }
      }
      return await mocks.sendLinqMessage(...args);
    },
    async sendLinqVoiceMemoMessage(
      ...args: Parameters<typeof actual.sendLinqVoiceMemoMessage>
    ) {
      const providerFetch = args[1]?.fetchImplementation;
      if (!providerFetch) {
        throw new Error("Expected hosted Linq provider fetch boundary.");
      }
      await providerFetch("https://api.linq.example/voice", {
        method: "POST",
      });
      return await mocks.sendLinqVoiceMemoMessage(...args);
    },
    async setLinqMessageReaction(
      ...args: Parameters<typeof actual.setLinqMessageReaction>
    ) {
      const providerFetch = args[1]?.fetchImplementation;
      if (!providerFetch) {
        throw new Error("Expected hosted Linq provider fetch boundary.");
      }
      await providerFetch("https://api.linq.example/reaction", {
        method: "POST",
      });
      return await mocks.setLinqMessageReaction(...args);
    },
    sendTelegramVoiceMemoMessage: mocks.sendTelegramVoiceMemoMessage,
  };
});

vi.mock("@murphai/operator-config/telegram-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@murphai/operator-config/telegram-runtime")
  >("@murphai/operator-config/telegram-runtime");
  return {
    ...actual,
    setTelegramMessageReaction: mocks.setTelegramMessageReaction,
  };
});

import {
  collectHostedAssistantDeliverySideEffects,
  createHostedAssistantProgressDeliveryDependencies,
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
  drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  queueHostedAssistantPendingMessageVolumeReceiptsForVault,
  resolveHostedAssistantOutboxNextWakeAt,
} from "../src/hosted-runtime/callbacks.ts";
import {
  HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
} from "../src/hosted-runtime/provider-fetch.ts";
import {
  buildHostedRuntimeResolvedLinqRoute,
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
const HOSTED_LINQ_RESPONSE_CARD = {
  kind: "daily_nutrition",
  localDate: "2026-08-06",
  mealCount: 1,
  totals: {
    calories: { mealCount: 1, total: 500 },
    carbsGrams: { mealCount: 1, total: 55 },
    fatGrams: { mealCount: 1, total: 18 },
    proteinGrams: { mealCount: 1, total: 35 },
  },
} as const;
const HOSTED_TELEGRAM_ROUTINE_CARD: NonNullable<
  HostedAssistantDeliveryPayload["card"]
> = {
  exercises: [{
    dose: "8 repetitions",
    estimatedSeconds: 45,
    images: [],
    instructions: ["Move slowly."],
    name: "Shoulder circles",
  }],
  footer: null,
  intensity: "Easy",
  kind: "exercise_routine",
  labels: {
    dose: "Dose",
    exercise: "Exercise",
    time: "Time",
    visualGuide: "Visual guide",
  },
  safety: "Stop if pain increases.",
  subtitle: null,
  title: "Short reset",
  totalSeconds: 60,
  transitionSeconds: 15,
  version: 1,
};
type HostedVoiceMemoDeliveryMedia = Extract<
  HostedAssistantDeliveryMedia,
  { kind: "voice_memo" }
>;

function createPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    answeredMailboxItemIds: [],
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

function createReplyBubbleEffects(input: {
  baseKey: string;
  channel: "linq" | "telegram";
  count: number;
  deliveryPhase?: "background_retry" | "foreground_current_turn";
  transportIdempotent?: boolean;
  turnId: string;
}) {
  const target = input.channel === "linq" ? "linq_chat_123" : "chat_123";
  return Array.from({ length: input.count }, (_, index) => {
    const isFinal = index === input.count - 1;
    return buildHostedAssistantDeliveryEffect({
      dedupeKey: `dedupe_${input.turnId}_${index}`,
      deliveryPhase: input.deliveryPhase ?? "foreground_current_turn",
      effectId: `intent_${input.turnId}_${index}`,
      payload: createPayload({
        bindingDeliveryKind: input.channel === "linq" ? "thread" : "participant",
        bindingDeliveryTarget: target,
        channel: input.channel,
        explicitTarget: input.channel === "linq" ? target : null,
        idempotencyKey: isFinal
          ? input.baseKey
          : `${input.baseKey}:bubble:${index}`,
        message: isFinal ? "Final bubble" : `Bubble ${index + 1}`,
        transportIdempotent: input.transportIdempotent ?? false,
        turnId: input.turnId,
      }),
    });
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

function buildClaimedLinqEngagementResult(request: {
  authorityCheckOnly: boolean;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  target?: string | null;
  targetKind?: "explicit" | "participant" | "thread" | null;
}) {
  return {
    ...(request.authorityCheckOnly === true
      ? {}
      : { providerDispatchClaimed: true }),
    resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request),
  };
}

async function assertLinqEngagementWithExistingProviderClaim(request: {
  authorityCheckOnly: boolean;
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  target?: string | null;
  targetKind?: "explicit" | "participant" | "thread" | null;
}) {
  if (request.authorityCheckOnly === true) {
    return { resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request) };
  }
  throw Object.assign(new Error("Hosted Linq provider dispatch is already started."), {
    code: "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED",
  });
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

function createPendingHostedDeliveryIntent(
  overrides: Record<string, unknown>,
) {
  return {
    actorId: "actor_1",
    bindingDelivery: null,
    channel: "telegram",
    createdAt: "2026-04-08T00:01:00.000Z",
    dedupeKey: "dedupe_intent",
    deliveryIdempotencyKey: "delivery-final",
    deliveryTransportIdempotent: false,
    explicitTarget: "chat_1",
    identityId: "identity_1",
    intentId: "intent_pending",
    lastError: null,
    message: "pending reply",
    nextAttemptAt: "2026-04-08T00:01:00.000Z",
    replyToMessageId: "message-one",
    sessionId: "session_1",
    status: "pending",
    subject: null,
    targetFingerprint: "target_chat_1",
    threadId: "thread_1",
    threadIsDirect: true,
    turnId: "turn_1",
    ...overrides,
  };
}

function createPreparedPreviousDispatchState(
  overrides: Partial<AssistantOutboxPreparedDispatchState> = {},
): AssistantOutboxPreparedDispatchState {
  return {
    attemptCount: 0,
    deliveryConfirmationPending: false,
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
  mocks.linqProviderFetchAttemptCount.mockReturnValue(1);
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
  mocks.hasPendingAssistantOutboxMessageVolumeReceipt.mockImplementation(
    (intent: AssistantOutboxIntent) =>
      intent.messageVolumeReceiptRecordedAt === null
      && intent.delivery !== null,
  );
  mocks.markAssistantOutboxMessageVolumeReceiptRecorded.mockImplementation(
    async ({ recordedAt }: { recordedAt: string }) => ({
      messageVolumeReceiptRecordedAt: recordedAt,
    }),
  );
  mocks.rescheduleAssistantOutboxMessageVolumeReceipt.mockResolvedValue({
    nextAttemptAt: "2026-08-15T19:22:00.000Z",
  });
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
  mocks.listAssistantCronPendingDeliveryIntentIds.mockResolvedValue([]);
  mocks.listAssistantOutboxIntents.mockResolvedValue([]);
  mocks.readAssistantVaultFileMedia.mockReturnValue(null);
  mocks.readVerifiedAssistantVaultFileBytes.mockResolvedValue(
    new Uint8Array([1, 2, 3]),
  );
  mocks.readVerifiedAssistantVaultImageBytes.mockResolvedValue(
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  );
  mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
    async ({ intent }) => ({ applied: true, intent }),
  );
  mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValue(null);
  mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue(null);
  mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set());
  mocks.hasAssistantAutoReplyChannel.mockReturnValue(true);
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

  it("pre-claims only an explicitly selected non-idempotent delivery effect", async () => {
    const selectedEffect = createEffect({ transportIdempotent: false });
    const unrelatedEffect = {
      ...createEffect({ transportIdempotent: false }),
      effectId: "intent_unrelated",
    };

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [selectedEffect, unrelatedEffect],
      selectedNonIdempotentEffectIds: [selectedEffect.effectId],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(preparation.preparedDispatches).toEqual([
      expect.objectContaining({
        intentId: selectedEffect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      }),
    ]);
    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: selectedEffect.effectId,
      }),
    );
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

  it("selects the matching Linq delivery context when preparing from multiple candidates", async () => {
    const otherRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:other",
      channel: "linq" as const,
      containerMemberId: "member_other",
      threadId: "linq_chat_other",
    };
    const matchingRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:match",
      channel: "linq" as const,
      containerMemberId: "member_match",
      threadId: "linq_chat_match",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_match",
      channel: "linq",
      explicitTarget: "ain_hashed_thread",
      replyToMessageId: "linq_message_match",
      transportIdempotent: true,
    });

    const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: [effect],
      linqDeliveryContexts: [
        {
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: null,
          replyToMessageId: "linq_message_other",
          routeAuthority: otherRouteAuthority,
          service: "iMessage",
          target: "linq_chat_other",
          threadIsDirect: true,
        },
        {
          directRecipientPhoneNumber: "+15550002",
          fromPhoneNumber: null,
          replyToMessageId: "linq_message_match",
          routeAuthority: matchingRouteAuthority,
          service: "iMessage",
          target: "linq_chat_match",
          threadIsDirect: true,
        },
      ],
      now: () => "2026-04-08T00:00:05.000Z",
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.beginAssistantOutboxIntentMirrorPreparedDispatch).toHaveBeenCalledWith({
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: true,
      externalThreadRouteAuthority: matchingRouteAuthority,
      externalThreadService: "iMessage",
      intentId: "intent_123",
      startedAt: "2026-04-08T00:00:05.000Z",
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(preparation.preparedDispatches[0]).toEqual(expect.objectContaining({
      linqDeliveryContext: expect.objectContaining({
        routeAuthority: matchingRouteAuthority,
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
          answeredMailboxItemIds: [],
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
          answeredMailboxItemIds: [],
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
        nativeReplyRequested: true,
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
    expect(sideEffects[0]?.payload).toMatchObject({
      nativeReplyRequested: true,
      replyToMessageId: "linq_message_1",
    });
    expect(sideEffects[1]?.payload).not.toHaveProperty("nativeReplyRequested");
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

  it("keeps a parked vault-file intent out of delivery when the approval port is missing", async () => {
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
      const storedIntent = {
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
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:00:00.000Z",
      };
      mocks.listAssistantOutboxIntents.mockImplementation(async () => [
        storedIntent,
      ]);
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);

      const sideEffects = await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort: null,
        includeBackgroundDueIntents: true,
        preferredIntentIds: ["intent_vault_file"],
        vaultRoot: "/tmp/vault",
      });

      expect(sideEffects).toEqual([]);
      expect(storedIntent).toMatchObject({
        intentId: "intent_vault_file",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "awaiting_approval",
      });
      expect(mocks.buildAssistantVaultFileSendApprovalRequest).not.toHaveBeenCalled();
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).not.toHaveBeenCalled();

      const wakeAt = await resolveHostedAssistantOutboxNextWakeAt({
        now: new Date("2026-04-08T00:00:00.000Z"),
        vaultRoot: "/tmp/vault",
      });

      expect(wakeAt).toBe("2026-04-08T00:01:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a due legacy approved vault-file intent to the existing preflight path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:02:00.000Z"));
    try {
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
      const storedIntent = {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_legacy_approved_vault_file",
        delivery: null,
        deliveryIdempotencyKey: "assistant-outbox:intent_legacy_approved",
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_legacy_approved",
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval" as const,
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:00:00.000Z",
      };
      const normalizedIntent = {
        ...storedIntent,
        nextAttemptAt: "2026-04-08T00:02:00.000Z",
        status: "pending" as const,
        updatedAt: "2026-04-08T00:02:00.000Z",
      };
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(),
        request: vi.fn(),
      };
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([storedIntent]);
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);

      const sideEffects = await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      });

      expect(sideEffects.map((effect) => effect.effectId)).toEqual([
        storedIntent.intentId,
      ]);
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).toHaveBeenCalledWith({
        expectedDedupeKey: storedIntent.dedupeKey,
        expectedStatus: "awaiting_approval",
        expectedUpdatedAt: storedIntent.updatedAt,
        intent: normalizedIntent,
        vault: "/tmp/vault",
      });
      expect(actionApprovalPort.read).not.toHaveBeenCalled();
      expect(actionApprovalPort.request).not.toHaveBeenCalled();
      expect(actionApprovalPort.consume).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminalizes due ownerless waits without starving a valid approval cycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:16:00.000Z"));
    try {
      const vaultFile = {
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      };
      const legacyIntents = Array.from({ length: 4 }, (_, index) => ({
        actorId: "actor_1",
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
        channel: "linq",
        createdAt: `2026-04-08T00:0${index}:00.000Z`,
        dedupeKey: `dedupe_legacy_ownerless_${index}`,
        delivery: null,
        deliveryIdempotencyKey: `assistant-outbox:intent_legacy_${index}`,
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: `intent_legacy_ownerless_${index}`,
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: `2026-04-08T00:10:0${index}.000Z`,
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval" as const,
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: `turn_legacy_${index}`,
        updatedAt: `2026-04-08T00:0${index}:00.000Z`,
      }));
      const approvalId = `haa_${"f".repeat(32)}`;
      const validIntent = {
        ...legacyIntents[0]!,
        createdAt: "2026-04-08T00:04:00.000Z",
        dedupeKey: "dedupe_valid_cycle",
        deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
          approvalId,
          expiresAt: "2026-04-08T00:15:00.000Z",
        }),
        intentId: "intent_valid_cycle",
        nextAttemptAt: "2026-04-08T00:10:04.000Z",
        turnId: "turn_valid_cycle",
        updatedAt: "2026-04-08T00:04:00.000Z",
      };
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(async () => ({
          approvalId,
          cycleOwnerKey: validIntent.deliveryIdempotencyKey,
          status: "expired" as const,
        })),
        request: vi.fn(),
      };
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
        ...legacyIntents,
        validIntent,
      ]);
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);
      mocks.buildAssistantVaultFileSendApprovalRequest.mockImplementation(
        (intent: { intentId: string }) => ({
          actionFingerprint: "a".repeat(64),
          actionId: `vault-file-send:${intent.intentId}`,
          actionKind: "vault.file.send.v1",
          presentation: {
            body: "Send a vault file.",
            title: "Send a file?",
          },
        }),
      );

      await expect(collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(actionApprovalPort.read).toHaveBeenCalledOnce();
      expect(actionApprovalPort.read).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: "vault-file-send:intent_valid_cycle",
        }),
      );
      const terminalLegacyIntents = mocks.saveAssistantOutboxIntentIfUnchanged
        .mock.calls.map(([request]) => request.intent)
        .filter((intent) => intent.status === "abandoned");
      expect(terminalLegacyIntents).toHaveLength(4);
      expect(terminalLegacyIntents).toEqual(expect.arrayContaining(
        legacyIntents.map((intent) => expect.objectContaining({
          intentId: intent.intentId,
          lastError: expect.objectContaining({
            code: "ASSISTANT_VAULT_FILE_APPROVAL_OWNER_INVALID",
          }),
          nextAttemptAt: null,
          status: "abandoned",
        })),
      ));

      mocks.listAssistantOutboxIntents.mockResolvedValueOnce(
        terminalLegacyIntents,
      );
      await expect(resolveHostedAssistantOutboxNextWakeAt({
        now: new Date("2026-04-08T00:16:00.000Z"),
        vaultRoot: "/tmp/vault",
      })).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("observes a denied vault-file approval without reopening it and abandons the parked intent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:02:00.000Z"));
    try {
      const vaultFile = {
        approvalId: `haa_${"a".repeat(32)}`,
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      };
      const storedIntent = {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_vault_file_denied",
        delivery: null,
        deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
          approvalId: vaultFile.approvalId,
          expiresAt: "2026-04-08T00:15:00.000Z",
        }),
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_vault_file_denied",
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: "2026-04-08T00:15:00.000Z",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:01:00.000Z",
      };
      const abandonedIntent = {
        ...storedIntent,
        lastError: {
          code: "ASSISTANT_VAULT_FILE_APPROVAL_DENIED",
          message: "Vault-file delivery was denied.",
        },
        nextAttemptAt: null,
        status: "abandoned",
        updatedAt: "2026-04-08T00:02:00.000Z",
      };
      const approvalRequest = {
        actionFingerprint: "a".repeat(64),
        actionId: "vault-file-send:denied",
        actionKind: "vault.file.send.v1",
        presentation: {
          body: "Send a vault file.",
          title: "Send a file?",
        },
      };
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(async () => ({
          approvalId: vaultFile.approvalId,
          cycleOwnerKey: storedIntent.deliveryIdempotencyKey,
          status: "denied" as const,
        })),
        request: vi.fn(),
      };
      const unrelatedPendingIntent = {
        ...storedIntent,
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_2" },
        createdAt: "2026-04-07T23:59:00.000Z",
        dedupeKey: "dedupe_unrelated_denied",
        explicitTarget: "linq_chat_2",
        intentId: "intent_unrelated_denied",
        media: [],
        message: "Older unrelated delivery.",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "pending" as const,
        threadId: "thread_2",
        turnId: "turn_unrelated",
      };
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
        unrelatedPendingIntent,
        storedIntent,
      ]);
      mocks.readAssistantVaultFileMedia.mockReturnValueOnce(vaultFile);
      mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValue(
        approvalRequest,
      );
      mocks.applyAssistantVaultFileSendApprovalResult.mockReturnValueOnce(
        abandonedIntent,
      );
      mocks.saveAssistantOutboxIntentIfUnchanged.mockResolvedValueOnce(
        { applied: true, intent: abandonedIntent },
      );

      await expect(collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredEffectIds: [buildHostedActionApprovalOutcomeEffectId({
          approvalGeneration: "b".repeat(64),
          approvalId: vaultFile.approvalId,
          expiresAt: "2026-04-08T00:15:00.000Z",
        })],
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(actionApprovalPort.read).toHaveBeenCalledWith(approvalRequest);
      expect(actionApprovalPort.request).not.toHaveBeenCalled();
      expect(mocks.applyAssistantVaultFileSendApprovalResult).toHaveBeenCalledWith({
        approval: {
          approvalId: vaultFile.approvalId,
          cycleOwnerKey: storedIntent.deliveryIdempotencyKey,
          status: "denied",
        },
        intent: storedIntent,
        now: new Date("2026-04-08T00:02:00.000Z"),
      });
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).toHaveBeenCalledWith({
        expectedDedupeKey: storedIntent.dedupeKey,
        expectedStatus: "awaiting_approval",
        expectedUpdatedAt: storedIntent.updatedAt,
        intent: abandonedIntent,
        vault: "/tmp/vault",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles one canonical causal approval before unrelated due work", async () => {
    const vaultFile = {
      approvalGeneration: null,
      approvalId: null,
      contentType: "application/zip",
      filename: "export.zip",
      kind: "vault_file" as const,
      ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/export.zip`,
      retireExportPacks: [{
        manifestSha256: "d".repeat(64),
        packId: "pack-one",
      }],
      sha256: "a".repeat(64),
      sizeBytes: 42,
    };
    const storedIntents = Array.from({ length: 5 }, (_, index) => ({
      actorId: "actor_1",
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
      channel: "linq",
      createdAt: `2026-04-08T00:0${index}:00.000Z`,
      dedupeKey: `dedupe_vault_file_${index}`,
      delivery: null,
      deliveryIdempotencyKey: `assistant-outbox:intent_vault_file_${index}`,
      deliveryTransportIdempotent: true,
      explicitTarget: "linq_chat_1",
      identityId: "identity_1",
      intentId: `intent_vault_file_${index}`,
      lastAttemptAt: null,
      lastError: null,
      media: [vaultFile],
      message: "Attached.",
      nextAttemptAt: index === 0 || index >= 3
        ? "2020-04-08T00:15:00.000Z"
        : "2030-04-08T00:15:00.000Z",
      replyToMessageId: "linq_message_1",
      sessionId: "session_1",
      status: "awaiting_approval" as const,
      subject: null,
      threadId: "thread_1",
      threadIsDirect: true,
      turnId: `turn_${index}`,
      updatedAt: `2026-04-08T00:0${index}:00.000Z`,
    }));
    const storedTemplate = storedIntents[0];
    if (!storedTemplate) {
      throw new Error("Expected a stored approval intent.");
    }
    const unrelatedPendingIntent = {
      ...storedTemplate,
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_2" },
      createdAt: "2026-04-07T23:59:00.000Z",
      dedupeKey: "dedupe_unrelated_causal",
      explicitTarget: "linq_chat_2",
      intentId: "intent_unrelated_causal",
      media: [],
      message: "Older unrelated delivery.",
      nextAttemptAt: "2026-04-08T00:00:00.000Z",
      status: "pending" as const,
      threadId: "thread_2",
      turnId: "turn_unrelated",
    };
    const unrelatedNewsletterRecipient = {
      ...unrelatedPendingIntent,
      actorId: null,
      bindingDelivery: null,
      channel: "email",
      dedupeKey: "dedupe_unrelated_newsletter_recipient",
      deliveryIdempotencyKey:
        "group-email-effect:automation_unrelated:2026-04-08T00:00:00.000Z:group_unrelated",
      deliveryTransportIdempotent: false,
      explicitTarget: serializeHostedEmailThreadTarget({
        groupId: "group_unrelated",
        recipientMemberId: "member_unrelated",
        subject: "Unrelated newsletter",
        targetKind: "group",
      }),
      identityId: null,
      intentId: "intent_unrelated_newsletter_recipient",
      message: "Unrelated newsletter.",
      replyToMessageId: null,
      threadId: null,
      threadIsDirect: false,
    };
    const selectedActionId = "vault-file-send:shared-approval-cycle";
    const approvalId = `haa_${"b".repeat(32)}`;
    const selectedEffectId = buildHostedActionApprovalOutcomeEffectId({
      approvalGeneration: "b".repeat(64),
      approvalId,
      expiresAt: "2026-04-08T00:30:00.000Z",
    });
    storedIntents[1] = {
      ...storedIntents[1]!,
      deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
        approvalId,
        expiresAt: "2026-04-08T00:15:00.000Z",
      }),
    };
    storedIntents[2] = {
      ...storedIntents[2]!,
      deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
        approvalId,
        expiresAt: "2026-04-08T00:30:00.000Z",
      }),
    };
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(async (request: { actionId: string }) =>
        request.actionId === selectedActionId
          ? {
              approvalGeneration: "b".repeat(64),
              approvalId,
              cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
                approvalId,
                expiresAt: "2026-04-08T00:30:00.000Z",
              }),
              status: "approved" as const,
            }
          : {
              approvalId: `haa_${"c".repeat(32)}`,
              approvalUrl: "https://murph.test/approve/pending",
              cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
                approvalId: `haa_${"c".repeat(32)}`,
                expiresAt: "2026-04-08T00:15:00.000Z",
              }),
              expiresAt: "2026-04-08T00:15:00.000Z",
              status: "pending" as const,
            }),
      request: vi.fn(),
    };
    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      unrelatedNewsletterRecipient,
      unrelatedPendingIntent,
      ...storedIntents,
    ]);
    mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);
    mocks.buildAssistantVaultFileSendApprovalRequest.mockImplementation(
      (intent: { intentId: string }) => ({
        actionFingerprint: "a".repeat(64),
        actionId: intent.intentId === "intent_vault_file_1"
          || intent.intentId === "intent_vault_file_2"
          ? selectedActionId
          : `vault-file-send:${intent.intentId}`,
        actionKind: "vault.file.send.v1",
        presentation: {
          body: "Send a vault file.",
          title: "Send a file?",
        },
      }),
    );
    mocks.applyAssistantVaultFileSendApprovalResult.mockImplementation(
      ({ approval, intent }) =>
        approval.status === "approved"
          ? {
              ...intent,
              nextAttemptAt: "2026-04-08T00:05:00.000Z",
              status: "pending",
              updatedAt: "2026-04-08T00:05:00.000Z",
            }
          : intent,
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      actionApprovalPort,
      includeBackgroundDueIntents: true,
      preferredEffectIds: [selectedEffectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(actionApprovalPort.read).toHaveBeenCalledTimes(1);
    expect(actionApprovalPort.read).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: selectedActionId }),
    );
    expect(sideEffects).toHaveLength(1);
    expect(sideEffects[0]?.effectId).toBe("intent_vault_file_2");
    expect(sideEffects[0]?.payload.media).toEqual([{
      approvalGeneration: null,
      approvalId: null,
      contentType: "application/zip",
      filename: "export.zip",
      kind: "vault_file",
      ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/export.zip`,
      sha256: "a".repeat(64),
      sizeBytes: 42,
    }]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();

    actionApprovalPort.read.mockClear();
    mocks.applyAssistantVaultFileSendApprovalResult.mockClear();
    mocks.listAssistantOutboxIntents.mockResolvedValueOnce(storedIntents);
    await expect(collectHostedAssistantDeliverySideEffects({
      actionApprovalPort,
      includeBackgroundDueIntents: true,
      preferredEffectIds: [buildHostedActionApprovalOutcomeEffectId({
        approvalGeneration: "c".repeat(64),
        approvalId,
        expiresAt: "2026-04-08T00:15:00.000Z",
      })],
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    })).resolves.toEqual([]);
    expect(actionApprovalPort.read).toHaveBeenCalledTimes(1);
    expect(mocks.applyAssistantVaultFileSendApprovalResult).not.toHaveBeenCalled();
  });

  it("defers one causal approval owner after a control-plane timeout", async () => {
    const approvalId = `haa_${"d".repeat(32)}`;
    const expiresAt = "2026-04-08T00:15:00.000Z";
    const storedIntent = {
      actorId: "actor_1",
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      dedupeKey: "dedupe_vault_file_timeout",
      delivery: null,
      deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
        approvalId,
        expiresAt,
      }),
      deliveryTransportIdempotent: true,
      explicitTarget: "linq_chat_1",
      identityId: "identity_1",
      intentId: "intent_vault_file_timeout",
      lastAttemptAt: null,
      lastError: null,
      media: [{
        approvalId,
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      }],
      message: "Attached.",
      nextAttemptAt: "2026-04-08T00:05:00.000Z",
      replyToMessageId: "linq_message_1",
      sessionId: "session_1",
      status: "awaiting_approval" as const,
      subject: null,
      threadId: "thread_1",
      threadIsDirect: true,
      turnId: "turn_1",
      updatedAt: "2026-04-08T00:00:00.000Z",
    };
    const deferredIntent = {
      ...storedIntent,
      nextAttemptAt: "2026-04-08T00:06:00.000Z",
      updatedAt: "2026-04-08T00:01:00.000Z",
    };
    const unrelatedPendingIntent = {
      ...storedIntent,
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_2" },
      createdAt: "2026-04-07T23:59:00.000Z",
      dedupeKey: "dedupe_unrelated_timeout",
      explicitTarget: "linq_chat_2",
      intentId: "intent_unrelated_timeout",
      media: [],
      message: "Older unrelated delivery.",
      nextAttemptAt: "2026-04-08T00:00:00.000Z",
      status: "pending" as const,
      threadId: "thread_2",
      turnId: "turn_unrelated",
    };
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn().mockRejectedValue(new Error("control timeout")),
      request: vi.fn(),
    };
    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      unrelatedPendingIntent,
      storedIntent,
    ]);
    mocks.readAssistantVaultFileMedia.mockReturnValue(storedIntent.media[0]);
    mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValue({
      actionFingerprint: "a".repeat(64),
      actionId: "vault-file-send:timeout",
      actionKind: "vault.file.send.v1",
      presentation: {
        body: "Send a vault file.",
        title: "Send a file?",
      },
    });
    mocks.deferAssistantVaultFileApprovalCheck.mockReturnValue(deferredIntent);
    mocks.saveAssistantOutboxIntentIfUnchanged.mockResolvedValueOnce(
      { applied: true, intent: deferredIntent },
    );

    await expect(collectHostedAssistantDeliverySideEffects({
      actionApprovalPort,
      includeBackgroundDueIntents: true,
      preferredEffectIds: [buildHostedActionApprovalOutcomeEffectId({
        approvalGeneration: "d".repeat(64),
        approvalId,
        expiresAt,
      })],
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    })).resolves.toEqual([]);

    expect(actionApprovalPort.read).toHaveBeenCalledTimes(1);
    expect(mocks.saveAssistantOutboxIntentIfUnchanged).toHaveBeenCalledWith({
      expectedDedupeKey: storedIntent.dedupeKey,
      expectedStatus: "awaiting_approval",
      expectedUpdatedAt: storedIntent.updatedAt,
      intent: deferredIntent,
      vault: "/tmp/vault",
    });

    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      unrelatedPendingIntent,
    ]);
    await expect(collectHostedAssistantDeliverySideEffects({
      actionApprovalPort,
      includeBackgroundDueIntents: true,
      preferredEffectIds: [buildHostedActionApprovalOutcomeEffectId({
        approvalGeneration: "e".repeat(64),
        approvalId: `haa_${"e".repeat(32)}`,
        expiresAt,
      })],
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    })).resolves.toEqual([]);
    expect(actionApprovalPort.read).toHaveBeenCalledTimes(1);
  });

  it("reconciles an older due approval ahead of newer approvals that are not due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:05:00.000Z"));
    try {
      const vaultFile = {
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      };
      const approvalIds = ["b", "c", "d", "e", "f"].map(
        (character) => `haa_${character.repeat(32)}`,
      );
      const storedIntents = Array.from({ length: 5 }, (_, index) => ({
        actorId: "actor_1",
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
        channel: "linq",
        createdAt: `2026-04-08T00:0${index}:00.000Z`,
        dedupeKey: `dedupe_vault_file_${index}`,
        delivery: null,
        deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
          approvalId: approvalIds[index]!,
          expiresAt: "2026-04-08T00:15:00.000Z",
        }),
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: `intent_vault_file_${index}`,
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: index === 0
          ? "2026-04-08T00:05:00.000Z"
          : "2026-04-08T00:15:00.000Z",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval" as const,
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: `turn_${index}`,
        updatedAt: `2026-04-08T00:0${index}:00.000Z`,
      }));
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(async (request: { actionId: string }) => {
          const index = Number(request.actionId.at(-1));
          const approvalId = approvalIds[index]!;
          return {
            approvalId,
            approvalUrl: "https://murph.test/approve/pending",
            cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
              approvalId,
              expiresAt: "2026-04-08T00:15:00.000Z",
            }),
            expiresAt: "2026-04-08T00:15:00.000Z",
            status: "pending" as const,
          };
        }),
        request: vi.fn(),
      };
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce(storedIntents);
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);
      mocks.buildAssistantVaultFileSendApprovalRequest.mockImplementation(
        (intent: { intentId: string }) => ({
          actionFingerprint: "a".repeat(64),
          actionId: `vault-file-send:${intent.intentId}`,
          actionKind: "vault.file.send.v1",
          presentation: {
            body: "Send a vault file.",
            title: "Send a file?",
          },
        }),
      );

      await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      });

      expect(actionApprovalPort.read).toHaveBeenCalledTimes(1);
      expect(actionApprovalPort.read).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "vault-file-send:intent_vault_file_0" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons an older approval cycle when its delayed causal wake observes a refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:16:00.000Z"));
    try {
      const approvalId = `haa_${"b".repeat(32)}`;
      const oldCycleOwnerKey = buildHostedActionApprovalCycleOwnerKey({
        approvalId,
        expiresAt: "2026-04-08T00:15:00.000Z",
      });
      const intent = {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        dedupeKey: "dedupe_old_approval_cycle",
        delivery: null,
        deliveryIdempotencyKey: oldCycleOwnerKey,
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: "intent_old_approval_cycle",
        lastAttemptAt: null,
        lastError: null,
        media: [
          {
            contentType: "application/pdf",
            filename: "report.pdf",
            kind: "vault_file" as const,
            ref: "documents/report.pdf",
            sha256: "a".repeat(64),
            sizeBytes: 42,
          },
        ],
        message: "Attached.",
        nextAttemptAt: "2026-04-08T00:15:00.000Z",
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval" as const,
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:01:00.000Z",
      };
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(async () => ({
          approvalGeneration: "c".repeat(64),
          approvalId,
          cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
            approvalId,
            expiresAt: "2026-04-08T00:30:00.000Z",
          }),
          status: "approved" as const,
        })),
        request: vi.fn(),
      };
      const supersededIntent = {
        ...intent,
        lastError: {
          code: "ASSISTANT_VAULT_FILE_APPROVAL_SUPERSEDED",
          message: "Vault-file delivery approval was superseded by a newer approval cycle.",
        },
        nextAttemptAt: null,
        status: "abandoned" as const,
        updatedAt: "2026-04-08T00:16:00.000Z",
      };
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([intent]);
      mocks.readAssistantVaultFileMedia.mockReturnValue(intent.media[0]);
      mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValue({
        actionFingerprint: "a".repeat(64),
        actionId: "vault-file-send:old-approval-cycle",
        actionKind: "vault.file.send.v1",
        presentation: {
          body: "Send a vault file.",
          title: "Send a file?",
        },
      });

      await expect(collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: false,
        preferredEffectIds: [buildHostedActionApprovalOutcomeEffectId({
          approvalGeneration: "d".repeat(64),
          approvalId,
          expiresAt: "2026-04-08T00:15:00.000Z",
        })],
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(actionApprovalPort.read).toHaveBeenCalledOnce();
      expect(mocks.applyAssistantVaultFileSendApprovalResult)
        .not.toHaveBeenCalled();
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).toHaveBeenCalledWith({
        expectedDedupeKey: intent.dedupeKey,
        expectedStatus: "awaiting_approval",
        expectedUpdatedAt: intent.updatedAt,
        intent: supersededIntent,
        vault: "/tmp/vault",
      });

      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([supersededIntent]);
      await expect(resolveHostedAssistantOutboxNextWakeAt({
        now: new Date("2026-04-08T00:16:00.000Z"),
        vaultRoot: "/tmp/vault",
      })).resolves.toBeNull();
      expect(actionApprovalPort.read).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains four superseded due approval owners before reconciling the current owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:16:00.000Z"));
    try {
      const approvalIds = ["b", "c", "d", "e", "f"].map(
        (character) => `haa_${character.repeat(32)}`,
      );
      const vaultFile = {
        contentType: "application/pdf",
        filename: "report.pdf",
        kind: "vault_file" as const,
        ref: "documents/report.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      };
      const storedIntents = approvalIds.map((approvalId, index) => ({
        actorId: "actor_1",
        bindingDelivery: { kind: "thread" as const, target: "linq_chat_1" },
        channel: "linq",
        createdAt: `2026-04-08T00:0${index}:00.000Z`,
        dedupeKey: `dedupe_approval_cycle_${index}`,
        delivery: null,
        deliveryIdempotencyKey: buildHostedActionApprovalCycleOwnerKey({
          approvalId,
          expiresAt: "2026-04-08T00:15:00.000Z",
        }),
        deliveryTransportIdempotent: true,
        explicitTarget: "linq_chat_1",
        identityId: "identity_1",
        intentId: `intent_approval_cycle_${index}`,
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "Attached.",
        nextAttemptAt: `2026-04-08T00:10:0${index}.000Z`,
        replyToMessageId: "linq_message_1",
        sessionId: "session_1",
        status: "awaiting_approval" as const,
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: `turn_${index}`,
        updatedAt: `2026-04-08T00:0${index}:00.000Z`,
      }));
      const actionApprovalPort = {
        consume: vi.fn(),
        read: vi.fn(async (request: { actionId: string }) => {
          const index = Number(request.actionId.at(-1));
          const approvalId = approvalIds[index]!;
          if (index === 4) {
            return {
              approvalGeneration: "f".repeat(64),
              approvalId,
              cycleOwnerKey: storedIntents[index]!.deliveryIdempotencyKey,
              status: "approved" as const,
            };
          }
          return {
            approvalId,
            approvalUrl: "https://murph.test/approve/refreshed",
            cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
              approvalId,
              expiresAt: "2026-04-08T00:30:00.000Z",
            }),
            expiresAt: "2026-04-08T00:30:00.000Z",
            status: "pending" as const,
          };
        }),
        request: vi.fn(),
      };
      mocks.readAssistantVaultFileMedia.mockReturnValue(vaultFile);
      mocks.buildAssistantVaultFileSendApprovalRequest.mockImplementation(
        (intent: { intentId: string }) => ({
          actionFingerprint: "a".repeat(64),
          actionId: `vault-file-send:${intent.intentId}`,
          actionKind: "vault.file.send.v1",
          presentation: {
            body: "Send a vault file.",
            title: "Send a file?",
          },
        }),
      );
      mocks.shouldDispatchAssistantOutboxIntent.mockImplementation((intent) =>
        intent.status === "pending" || intent.status === "retryable",
      );
      mocks.listAssistantOutboxIntents.mockResolvedValueOnce(storedIntents);

      await expect(collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(actionApprovalPort.read).toHaveBeenCalledTimes(4);
      const supersededIntents = mocks.saveAssistantOutboxIntentIfUnchanged.mock.calls
        .map(([request]) => request.intent);
      expect(supersededIntents).toHaveLength(4);
      expect(supersededIntents).toEqual(expect.arrayContaining(
        storedIntents.slice(0, 4).map((intent) => expect.objectContaining({
          intentId: intent.intentId,
          lastError: expect.objectContaining({
            code: "ASSISTANT_VAULT_FILE_APPROVAL_SUPERSEDED",
          }),
          nextAttemptAt: null,
          status: "abandoned",
        })),
      ));

      mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
        ...supersededIntents,
        storedIntents[4]!,
      ]);
      await expect(collectHostedAssistantDeliverySideEffects({
        actionApprovalPort,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(actionApprovalPort.read).toHaveBeenCalledTimes(5);
      expect(actionApprovalPort.read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actionId: "vault-file-send:intent_approval_cycle_4",
        }),
      );
      expect(mocks.applyAssistantVaultFileSendApprovalResult).toHaveBeenCalledOnce();
      expect(mocks.applyAssistantVaultFileSendApprovalResult).toHaveBeenCalledWith(
        expect.objectContaining({ intent: storedIntents[4] }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons a queued signup welcome when a foreground reply targets the same route", async () => {
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue({
      status: "abandoned",
    });
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
      onlyCurrentStatuses: ["pending", "retryable"],
      status: "abandoned",
      vault: "/tmp/vault",
    });
  });

  it.each([true, false])(
    "abandons a retryable signup welcome from durable later auto-reply evidence (background=%s)",
    async (includeBackgroundDueIntents) => {
      const welcome = createPendingHostedDeliveryIntent({
        actorId: "actor_member",
        bindingDelivery: { kind: "participant", target: "participant_member" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        deliveryIdempotencyKey: "signup-welcome:member_placeholder",
        explicitTarget: null,
        identityId: "identity_member",
        intentId: "intent_signup_welcome_retry",
        lastError: {
          code: "LINQ_API_REQUEST_FAILED",
          message: "Chat not found",
        },
        media: [],
        nextAttemptAt: "2026-04-08T00:30:00.000Z",
        replyToMessageId: null,
        status: "retryable",
        threadId: null,
        threadIsDirect: true,
        turnId: "turn_signup_welcome_retry",
      });
      const laterAutoReply = createPendingHostedDeliveryIntent({
        actorId: "actor_member",
        bindingDelivery: { kind: "thread", target: "thread_materialized" },
        channel: "linq",
        createdAt: "2026-04-08T00:10:00.000Z",
        deliveryIdempotencyKey: "reply_delivery_key",
        explicitTarget: "chat_materialized",
        identityId: "identity_member",
        intentId: "intent_later_auto_reply",
        media: [],
        nextAttemptAt: null,
        replyToMessageId: "message_inbound",
        status: "sent",
        threadId: "thread_materialized",
        threadIsDirect: true,
        turnId: "turn_later_auto_reply",
      });
      mocks.listAssistantOutboxIntents.mockResolvedValue([
        welcome,
        laterAutoReply,
      ]);
      mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(
        new Set(["intent_later_auto_reply"]),
      );
      mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
        (intent) => intent.status !== "sent",
      );
      mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue({
        ...welcome,
        lastError: {
          code: "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
          message: "Stale signup welcome suppressed.",
        },
        status: "abandoned",
      });

      await expect(collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents,
        preferredIntentIds: [],
        vaultRoot: "/tmp/vault",
      })).resolves.toEqual([]);

      expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
        }),
        intentId: "intent_signup_welcome_retry",
        onlyCurrentStatuses: ["pending", "retryable"],
        status: "abandoned",
        vault: "/tmp/vault",
      });
    },
  );

  it("keeps a signup welcome when its supersession claim loses to dispatch", async () => {
    const welcome = createPendingHostedDeliveryIntent({
      actorId: "actor_member",
      bindingDelivery: { kind: "participant", target: "participant_member" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: "signup-welcome:member_placeholder",
      explicitTarget: null,
      intentId: "intent_signup_welcome_claim_race",
      media: [],
      nextAttemptAt: "2026-04-08T00:30:00.000Z",
      replyToMessageId: null,
      status: "retryable",
      threadId: null,
      threadIsDirect: true,
    });
    const historicalReply = createPendingHostedDeliveryIntent({
      actorId: "actor_member",
      bindingDelivery: { kind: "thread", target: "thread_materialized" },
      channel: "linq",
      createdAt: "2026-04-08T00:10:00.000Z",
      explicitTarget: "chat_materialized",
      intentId: "intent_auto_reply_claim_race",
      media: [],
      status: "sent",
      threadId: "thread_materialized",
      threadIsDirect: true,
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      welcome,
      historicalReply,
    ]);
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(
      new Set(["intent_auto_reply_claim_race"]),
    );
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
      (intent) => intent.status !== "sent",
    );
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValue({
      ...welcome,
      lastAttemptAt: "2026-04-08T00:10:01.000Z",
      status: "sending",
    });

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_signup_welcome_claim_race",
    ]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledOnce();
  });

  it.each([
    {
      autoReply: true,
      label: "an older reply",
      replyOverrides: {
        createdAt: "2026-04-07T23:59:00.000Z",
      },
    },
    {
      autoReply: true,
      label: "a different direct recipient",
      replyOverrides: {
        actorId: "actor_other",
        bindingDelivery: { kind: "thread", target: "thread_other" },
        identityId: "identity_other",
        threadId: "thread_other",
      },
    },
    {
      autoReply: true,
      label: "a group reply from the same actor",
      replyOverrides: {
        bindingDelivery: { kind: "thread", target: "thread_group" },
        explicitTarget: "chat_group",
        threadId: "thread_group",
        threadIsDirect: false,
      },
    },
    {
      autoReply: false,
      label: "a non-auto-reply delivery",
      replyOverrides: {},
    },
  ])("keeps a signup welcome when durable history contains $label", async ({
    autoReply,
    replyOverrides,
  }) => {
    const welcome = createPendingHostedDeliveryIntent({
      actorId: "actor_member",
      bindingDelivery: { kind: "participant", target: "participant_member" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: "signup-welcome:member_placeholder",
      explicitTarget: null,
      intentId: "intent_signup_welcome_kept",
      media: [],
      nextAttemptAt: "2026-04-08T00:30:00.000Z",
      replyToMessageId: null,
      status: "retryable",
      threadId: null,
      threadIsDirect: true,
    });
    const historicalReply = createPendingHostedDeliveryIntent({
      actorId: "actor_member",
      bindingDelivery: { kind: "thread", target: "thread_materialized" },
      channel: "linq",
      createdAt: "2026-04-08T00:10:00.000Z",
      deliveryIdempotencyKey: "reply_delivery_key",
      explicitTarget: "chat_materialized",
      intentId: "intent_historical_reply",
      media: [],
      nextAttemptAt: null,
      replyToMessageId: "message_inbound",
      status: "sent",
      threadId: "thread_materialized",
      threadIsDirect: true,
      ...replyOverrides,
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      welcome,
      historicalReply,
    ]);
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(
      autoReply ? new Set(["intent_historical_reply"]) : new Set(),
    );
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
      (intent) => intent.status !== "sent",
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_signup_welcome_kept",
    ]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
  });

  it("does not eagerly abandon a sending signup welcome", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      createPendingHostedDeliveryIntent({
        actorId: "actor_member",
        bindingDelivery: { kind: "participant", target: "participant_member" },
        channel: "linq",
        createdAt: "2026-04-08T00:00:00.000Z",
        deliveryIdempotencyKey: "signup-welcome:member_placeholder",
        explicitTarget: null,
        intentId: "intent_signup_welcome_sending",
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        media: [],
        status: "sending",
        threadId: null,
        threadIsDirect: true,
      }),
      createPendingHostedDeliveryIntent({
        actorId: "actor_member",
        bindingDelivery: { kind: "thread", target: "thread_materialized" },
        channel: "linq",
        createdAt: "2026-04-08T00:10:00.000Z",
        explicitTarget: null,
        intentId: "intent_auto_reply_after_sending",
        media: [],
        status: "sent",
        threadId: "thread_materialized",
        threadIsDirect: true,
      }),
    ]);
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(
      new Set(["intent_auto_reply_after_sending"]),
    );
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
      (intent) => intent.status !== "sent",
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_signup_welcome_sending",
    ]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
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

  it("drains the durable scheduled-delivery cohort across passes while unrelated backlog stays capped", async () => {
    const buildIntent = (input: {
      createdAt: string;
      intentId: string;
      status: "pending" | "retryable";
    }) => ({
      actorId: `actor_${input.intentId}`,
      bindingDelivery: null,
      channel: "linq",
      createdAt: input.createdAt,
      dedupeKey: `dedupe_${input.intentId}`,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: true,
      explicitTarget: "h1_333333333333333333333333",
      identityId: "identity_1",
      intentId: input.intentId,
      lastError: input.status === "retryable"
        ? { code: "LINQ_API_REQUEST_FAILED", message: "Chat not found" }
        : null,
      message: `message ${input.intentId}`,
      nextAttemptAt: input.createdAt,
      replyToMessageId: null,
      sessionId: "session_1",
      status: input.status,
      subject: null,
      threadId: `thread_${input.intentId}`,
      threadIsDirect: true,
      turnId: `turn_${input.intentId}`,
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      buildIntent({
        createdAt: "2026-04-08T00:00:00.000Z",
        intentId: "intent_backlog_stale",
        status: "retryable",
      }),
      buildIntent({
        createdAt: "2026-04-08T00:00:30.000Z",
        intentId: "intent_backlog_fresh",
        status: "pending",
      }),
      buildIntent({
        createdAt: "2026-04-08T00:01:00.000Z",
        intentId: "intent_cron_a",
        status: "pending",
      }),
      buildIntent({
        createdAt: "2026-04-08T00:02:00.000Z",
        intentId: "intent_cron_b",
        status: "pending",
      }),
    ]);
    mocks.listAssistantCronPendingDeliveryIntentIds.mockResolvedValue([
      "intent_cron_a",
      "intent_cron_b",
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId).sort()).toEqual([
      "intent_backlog_fresh",
      "intent_cron_a",
      "intent_cron_b",
    ]);
    for (const effect of sideEffects) {
      expect(effect.deliveryPhase).toBe("background_retry");
    }

    // A later pass (for example after a foreground yield interrupted the
    // drain) re-derives the remaining cohort from durable cron owner state:
    // once the first reminder's job is reconciled sent, only the residual
    // cohort member is exempt from the backlog cap.
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      buildIntent({
        createdAt: "2026-04-08T00:00:00.000Z",
        intentId: "intent_backlog_stale",
        status: "retryable",
      }),
      buildIntent({
        createdAt: "2026-04-08T00:00:30.000Z",
        intentId: "intent_backlog_fresh",
        status: "pending",
      }),
      buildIntent({
        createdAt: "2026-04-08T00:02:00.000Z",
        intentId: "intent_cron_b",
        status: "pending",
      }),
    ]);
    mocks.listAssistantCronPendingDeliveryIntentIds.mockResolvedValue([
      "intent_cron_b",
    ]);

    const residualSideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(residualSideEffects.map((effect) => effect.effectId).sort()).toEqual([
      "intent_backlog_fresh",
      "intent_cron_b",
    ]);
  });

  it("drains authority-bearing scheduled children after the parent clears its cron reference", async () => {
    const buildIntent = (input: {
      authority?: boolean;
      createdAt: string;
      intentId: string;
      status: "pending" | "retryable";
    }) => ({
      actorId: `actor_${input.intentId}`,
      automationAuthority: input.authority
        ? {
            automationId: "automation_newsletter",
            expectedUpdatedAt: "2026-04-08T00:00:00.000Z",
          }
        : null,
      bindingDelivery: null,
      channel: "linq",
      createdAt: input.createdAt,
      dedupeKey: `dedupe_${input.intentId}`,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: true,
      explicitTarget: "h1_444444444444444444444444",
      identityId: "identity_1",
      intentId: input.intentId,
      lastError: input.status === "retryable"
        ? { code: "LINQ_API_REQUEST_FAILED", message: "Chat not found" }
        : null,
      message: `message ${input.intentId}`,
      nextAttemptAt: input.createdAt,
      replyToMessageId: null,
      sessionId: "session_1",
      status: input.status,
      subject: null,
      threadId: `thread_${input.intentId}`,
      threadIsDirect: true,
      turnId: `turn_${input.intentId}`,
    });
    const childA = buildIntent({
      authority: true,
      createdAt: "2026-04-08T00:01:00.000Z",
      intentId: "intent_child_a",
      status: "pending",
    });
    const childB = buildIntent({
      authority: true,
      createdAt: "2026-04-08T00:01:10.000Z",
      intentId: "intent_child_b",
      status: "pending",
    });
    const childC = buildIntent({
      authority: true,
      createdAt: "2026-04-08T00:01:20.000Z",
      intentId: "intent_child_c",
      status: "pending",
    });
    const backlogStale = buildIntent({
      createdAt: "2026-04-08T00:00:00.000Z",
      intentId: "intent_backlog_stale",
      status: "retryable",
    });
    const backlogFresh = buildIntent({
      createdAt: "2026-04-08T00:00:30.000Z",
      intentId: "intent_backlog_fresh",
      status: "pending",
    });
    // The parent manifest already sent, so the cron job no longer references
    // any delivery intent; the children are scheduled work only through their
    // copied automation authority.
    mocks.listAssistantCronPendingDeliveryIntentIds.mockResolvedValue([]);
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      backlogStale,
      backlogFresh,
      childA,
      childB,
      childC,
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId).sort()).toEqual([
      "intent_backlog_fresh",
      "intent_child_a",
      "intent_child_b",
      "intent_child_c",
    ]);
    for (const effect of sideEffects) {
      expect(effect.deliveryPhase).toBe("background_retry");
    }

    // After one child delivers and a foreground yield interrupts the rest,
    // a later selection still drains every remaining child together.
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      backlogStale,
      backlogFresh,
      childB,
      childC,
    ]);

    const residualSideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(residualSideEffects.map((effect) => effect.effectId).sort()).toEqual([
      "intent_backlog_fresh",
      "intent_child_b",
      "intent_child_c",
    ]);
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

  it("uses bubble ordinals when same-boundary bubble intents share a timestamp", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_base",
        deliveryIdempotencyKey: "delivery-final",
        intentId: "intent_m_base",
        message: "base final reply",
        replyToMessageId: "message-three",
        targetFingerprint: "target_chat_1_reply_three",
        turnId: "turn_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_bubble_1",
        deliveryIdempotencyKey: "delivery-final:bubble:1",
        intentId: "intent_a_bubble_1",
        message: "second bubble",
        replyToMessageId: "message-two",
        targetFingerprint: "target_chat_1_reply_two",
        turnId: "turn_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_bubble_0",
        deliveryIdempotencyKey: "delivery-final:bubble:0",
        intentId: "intent_z_bubble_0",
        message: "first bubble",
        replyToMessageId: "message-one",
        targetFingerprint: "target_chat_1_reply_one",
        turnId: "turn_bubbles",
      }),
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_m_base"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_z_bubble_0",
      "intent_a_bubble_1",
      "intent_m_base",
    ]);
  });

  it("orders composed segment bubble intents before their segment final reply", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_base",
        deliveryIdempotencyKey: "delivery-final",
        intentId: "intent_m_base",
        message: "base final reply",
        replyToMessageId: "message-three",
        targetFingerprint: "target_chat_1_reply_three",
        turnId: "turn_segment_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_segment_final",
        deliveryIdempotencyKey: "delivery-final:segment:0",
        intentId: "intent_a_segment_final",
        message: "segment final reply",
        replyToMessageId: "message-two",
        targetFingerprint: "target_chat_1_reply_two",
        turnId: "turn_segment_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_segment_bubble",
        deliveryIdempotencyKey: "delivery-final:segment:0:bubble:0",
        intentId: "intent_z_segment_bubble_0",
        message: "segment bubble reply",
        replyToMessageId: "message-one",
        targetFingerprint: "target_chat_1_reply_one",
        turnId: "turn_segment_bubbles",
      }),
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_m_base"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_z_segment_bubble_0",
      "intent_a_segment_final",
      "intent_m_base",
    ]);
  });

  it("orders fallback bubble intents before their same-turn null-key base reply", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_base",
        deliveryIdempotencyKey: null,
        intentId: "intent_m_base",
        message: "base final reply",
        replyToMessageId: "message-three",
        targetFingerprint: "target_chat_1_reply_three",
        turnId: "turn_fallback_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_bubble_1",
        deliveryIdempotencyKey: "assistant-bubble:turn_fallback_bubbles:bubble:1",
        intentId: "intent_a_bubble_1",
        message: "second fallback bubble",
        replyToMessageId: "message-two",
        targetFingerprint: "target_chat_1_reply_two",
        turnId: "turn_fallback_bubbles",
      }),
      createPendingHostedDeliveryIntent({
        dedupeKey: "dedupe_bubble_0",
        deliveryIdempotencyKey: "assistant-bubble:turn_fallback_bubbles:bubble:0",
        intentId: "intent_z_bubble_0",
        message: "first fallback bubble",
        replyToMessageId: "message-one",
        targetFingerprint: "target_chat_1_reply_one",
        turnId: "turn_fallback_bubbles",
      }),
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_m_base"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_z_bubble_0",
      "intent_a_bubble_1",
      "intent_m_base",
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

  it("does not let a parked vault-file approval hide its same-turn approval-link reply", async () => {
    const vaultFile = {
      contentType: "application/pdf",
      filename: "report.pdf",
      kind: "vault_file" as const,
      ref: "documents/report.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 42,
    };
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:01:00.000Z",
        dedupeKey: "dedupe_vault_file",
        delivery: null,
        deliveryIdempotencyKey:
          `hosted-turn-delivery-123:vault-file:haa_${"a".repeat(32)}`,
        deliveryTransportIdempotent: true,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_vault_file",
        lastAttemptAt: null,
        lastError: null,
        media: [vaultFile],
        message: "",
        nextAttemptAt: "2026-04-08T00:06:00.000Z",
        replyToMessageId: "message_1",
        sessionId: "session_1",
        status: "awaiting_approval",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:01:00.000Z",
      },
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "thread", target: "chat_1" },
        channel: "linq",
        createdAt: "2026-04-08T00:01:01.000Z",
        dedupeKey: "dedupe_approval_link",
        delivery: null,
        deliveryIdempotencyKey: "hosted-turn-delivery-123",
        deliveryTransportIdempotent: true,
        explicitTarget: "chat_1",
        identityId: "identity_1",
        intentId: "intent_approval_link",
        lastAttemptAt: null,
        lastError: null,
        media: [],
        message: "Approve here: https://withmurph.test/approve/haa_test",
        nextAttemptAt: "2026-04-08T00:01:01.000Z",
        replyToMessageId: "message_1",
        sessionId: "session_1",
        status: "pending",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
        updatedAt: "2026-04-08T00:01:01.000Z",
      },
    ]);
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(async () => ({
        approvalId: `haa_${"a".repeat(32)}`,
        approvalUrl: "https://withmurph.test/approve/haa_test",
        cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
          approvalId: `haa_${"a".repeat(32)}`,
          expiresAt: "2026-04-08T00:16:00.000Z",
        }),
        expiresAt: "2026-04-08T00:16:00.000Z",
        status: "pending" as const,
      })),
      request: vi.fn(),
    };
    mocks.readAssistantVaultFileMedia.mockImplementation((intent) =>
      intent.intentId === "intent_vault_file" ? vaultFile : null
    );
    mocks.buildAssistantVaultFileSendApprovalRequest.mockReturnValue({
      actionFingerprint: "a".repeat(64),
      actionId: "vault-file-send:approval-link-ordering",
      actionKind: "vault.file.send.v1",
      presentation: {
        body: "Send a vault file.",
        title: "Send a file?",
      },
    });

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      actionApprovalPort,
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_approval_link"],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_approval_link",
    ]);
    expect(actionApprovalPort.read).not.toHaveBeenCalled();
    expect(mocks.applyAssistantVaultFileSendApprovalResult).not.toHaveBeenCalled();
    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date("2026-04-08T00:01:01.000Z"),
      vaultRoot: "/tmp/vault",
    })).resolves.toBe("2026-04-08T00:01:01.000Z");
  });

  it("does not let a parked approval fallback hide an earlier approval-link retry", async () => {
    const parkedIntent = {
      actorId: "actor_1",
      bindingDelivery: { kind: "thread" as const, target: "chat_1" },
      channel: "linq",
      createdAt: "2026-04-08T00:01:00.000Z",
      dedupeKey: "dedupe_vault_file",
      deliveryIdempotencyKey: "approval-cycle",
      deliveryTransportIdempotent: true,
      explicitTarget: "chat_1",
      identityId: "identity_1",
      intentId: "intent_vault_file",
      lastError: null,
      message: "",
      nextAttemptAt: "2026-04-08T00:06:00.000Z",
      replyToMessageId: "message_1",
      sessionId: "session_1",
      status: "awaiting_approval" as const,
      threadId: "thread_1",
      threadIsDirect: true,
      turnId: "turn_1",
    };
    const approvalLinkIntent = {
      ...parkedIntent,
      createdAt: "2026-04-08T00:01:01.000Z",
      dedupeKey: "dedupe_approval_link",
      deliveryIdempotencyKey: "approval-link",
      intentId: "intent_approval_link",
      lastError: {
        code: "LINQ_TEMPORARY_FAILURE",
        message: "temporary provider failure",
      },
      message: "Approve here: https://withmurph.test/approve/haa_test",
      nextAttemptAt: "2026-04-08T00:01:31.000Z",
      status: "retryable" as const,
    };
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      parkedIntent,
      approvalLinkIntent,
    ]);

    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date("2026-04-08T00:01:01.000Z"),
      vaultRoot: "/tmp/vault",
    })).resolves.toBe("2026-04-08T00:01:31.000Z");

    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      parkedIntent,
      { ...approvalLinkIntent, nextAttemptAt: null, status: "sent" },
    ]);
    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date("2026-04-08T00:01:31.000Z"),
      vaultRoot: "/tmp/vault",
    })).resolves.toBe("2026-04-08T00:06:00.000Z");
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

  it("keeps tracked non-idempotent phone-call confirmation on its callback-only retry path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:02:00.000Z"));
    const deliveryIdempotencyKey =
      "phone-call-result:hpc_callback_retry:generation:3";
    const intent = createPendingHostedDeliveryIntent({
      delivery: createDelivery({
        idempotencyKey: deliveryIdempotencyKey,
        providerMessageId: "provider_phone_call_result",
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey,
      deliveryTransportIdempotent: false,
      intentId: "intent_phone_call_result_callback_retry",
      lastError: {
        code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        message: "delivery confirmation is still pending",
      },
      nextAttemptAt: "2026-04-08T00:02:00.000Z",
      status: "retryable",
    }) as AssistantOutboxIntent;
    mocks.listAssistantOutboxIntents.mockResolvedValue([intent]);
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
      (candidate) => candidate.intentId === intent.intentId,
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([
      expect.objectContaining({
        deliveryPhase: "background_retry",
        effectId: intent.intentId,
        payload: expect.objectContaining({
          idempotencyKey: deliveryIdempotencyKey,
          transportIdempotent: false,
        }),
      }),
    ]);
    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date(),
      vaultRoot: "/tmp/vault",
    })).resolves.toBe("2026-04-08T00:02:00.000Z");
    vi.useRealTimers();
  });

  it("schedules concrete reaction confirmation without blocking a preferred later reply", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:01:00.000Z"));
    const retainedReaction = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: ["mailbox_item_reaction"],
      bindingDelivery: { kind: "thread", target: "linq_chat_1" },
      channel: "linq",
      delivery: {
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_reaction",
        kind: "message-reaction",
        reaction: "heart",
        sentAt: "2026-04-08T00:00:30.000Z",
        target: "linq_chat_1",
        targetKind: "thread",
        targetMessageId: "linq_message_1",
      },
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: "assistant-outbox:intent_reaction",
      deliveryTransportIdempotent: false,
      explicitTarget: null,
      intentId: "intent_reaction",
      lastError: {
        code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        message: "delivery confirmation is still pending",
      },
      message: "",
      nextAttemptAt: "2026-04-08T00:02:00.000Z",
      operation: { kind: "message-reaction", reaction: "heart" },
      replyToMessageId: "linq_message_1",
      status: "retryable",
      threadId: "linq_chat_1",
      turnId: "turn_reaction",
    });
    const laterReply = createPendingHostedDeliveryIntent({
      bindingDelivery: { kind: "thread", target: "linq_chat_1" },
      channel: "linq",
      createdAt: "2026-04-08T00:01:01.000Z",
      deliveryIdempotencyKey: "assistant-outbox:intent_later_reply",
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: "intent_later_reply",
      message: "later reply",
      nextAttemptAt: "2026-04-08T00:01:01.000Z",
      replyToMessageId: "linq_message_1",
      threadId: "linq_chat_1",
      turnId: "turn_reaction",
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      retainedReaction,
      laterReply,
    ]);
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation(
      (intent) => intent.intentId === laterReply.intentId,
    );

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: false,
      preferredIntentIds: [laterReply.intentId],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      laterReply.intentId,
    ]);

    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      retainedReaction,
    ]);
    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date(),
      vaultRoot: "/tmp/vault",
    })).resolves.toBe("2026-04-08T00:02:00.000Z");
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

  it("collects a legacy accepted group-email parent through the generic effect boundary", async () => {
    const groupTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Weekly health note",
      targetKind: "group",
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: null,
        bindingDelivery: null,
        channel: "email",
        createdAt: "2026-07-12T13:00:00.000Z",
        dedupeKey: "dedupe_newsletter",
        deliveryIdempotencyKey:
          "group-newsletter:automation_123:2026-07-12T13:00:00.000Z:group_123",
        deliveryTransportIdempotent: true,
        emailHtml: "<p>Weekly</p>",
        explicitTarget: groupTarget,
        identityId: null,
        intentId: "intent_newsletter",
        lastError: null,
        message: "Weekly",
        newsletterAuthorizationProof: "a".repeat(64),
        nextAttemptAt: "2026-07-12T13:00:00.000Z",
        replyToMessageId: null,
        sessionId: "session_newsletter",
        status: "pending",
        subject: null,
        targetFingerprint: "target_group_123",
        threadId: null,
        threadIsDirect: false,
        turnId: "turn_newsletter",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects).toEqual([
      expect.objectContaining({
        effectId: "intent_newsletter",
        payload: expect.objectContaining({
          emailHtml: "<p>Weekly</p>",
          groupEmailAuthorizationProof: "a".repeat(64),
        }),
      }),
    ]);
  });

  it("does not select group-email recipients until their parent manifest is sent", async () => {
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation((intent) =>
      intent.status === "pending"
      || intent.status === "retryable"
      || intent.status === "sending"
    );
    const deliveryIdempotencyKey =
      "group-email-effect:automation_123:2026-07-12T13:00:00.000Z:group_123";
    const parentTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Weekly health note",
      targetKind: "group",
    });
    const childTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Weekly health note",
      targetKind: "group",
    });
    const shared = {
      actorId: null,
      bindingDelivery: null,
      channel: "email",
      deliveryIdempotencyKey,
      deliveryTransportIdempotent: true,
      identityId: null,
      lastError: null,
      media: [],
      nextAttemptAt: "2026-07-12T13:00:00.000Z",
      replyToMessageId: null,
      sessionId: "session_newsletter",
      subject: null,
      threadId: null,
      threadIsDirect: false,
      turnId: "turn_newsletter",
    } satisfies Partial<AssistantOutboxIntent>;
    const parent = {
      ...shared,
      createdAt: "2026-07-12T13:00:00.000Z",
      dedupeKey: "dedupe_newsletter_parent",
      explicitTarget: parentTarget,
      intentId: "intent_newsletter_parent",
      message: "Weekly",
      status: "retryable",
    };
    const child = {
      ...shared,
      createdAt: "2026-07-12T13:00:01.000Z",
      dedupeKey: "dedupe_newsletter_child",
      deliveryTransportIdempotent: false,
      explicitTarget: childTarget,
      intentId: "intent_newsletter_child",
      message: "Weekly",
      status: "pending",
    };
    mocks.listAssistantOutboxIntents.mockResolvedValue([parent, child]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });

    expect(sideEffects.map((effect) => effect.effectId)).toEqual([
      "intent_newsletter_parent",
    ]);

    mocks.listAssistantOutboxIntents.mockResolvedValue([
      { ...parent, status: "sent" },
      child,
    ]);
    const afterParentSent = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    });
    expect(afterParentSent.map((effect) => effect.effectId)).toEqual([
      "intent_newsletter_child",
    ]);
  });

  it("abandons group-email recipients whose parent manifest was not sent", async () => {
    mocks.shouldDispatchAssistantOutboxIntent.mockImplementation((intent) =>
      intent.status === "pending"
      || intent.status === "retryable"
      || intent.status === "sending"
    );
    const childTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Weekly health note",
      targetKind: "group",
    });
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: null,
        bindingDelivery: null,
        channel: "email",
        createdAt: "2026-07-12T13:00:01.000Z",
        dedupeKey: "dedupe_newsletter_child",
        deliveryIdempotencyKey:
          "group-email-effect:automation_123:2026-07-12T13:00:00.000Z:group_123",
        deliveryTransportIdempotent: false,
        explicitTarget: childTarget,
        identityId: null,
        intentId: "intent_newsletter_child",
        lastError: null,
        media: [],
        message: "Weekly",
        nextAttemptAt: "2026-07-12T13:00:00.000Z",
        replyToMessageId: null,
        sessionId: "session_newsletter",
        status: "pending",
        subject: null,
        threadId: null,
        threadIsDirect: false,
        turnId: "turn_newsletter",
      },
    ]);

    await expect(collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: "/tmp/vault",
    })).resolves.toEqual([]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: "ASSISTANT_GROUP_EMAIL_PARENT_UNAVAILABLE",
      }),
      intentId: "intent_newsletter_child",
      onlyCurrentStatuses: ["awaiting_approval", "pending", "retryable", "sending"],
      status: "abandoned",
      vault: "/tmp/vault",
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

  it("best-effort stops Linq typing after foreground drain returns missing-result", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(null),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
        deliveryStatus: "missing-result",
        retryable: false,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chats/linq_chat_123/typing");
    expect(init).toMatchObject({
      method: "DELETE",
    });
  });

  it("does not stop Linq typing when foreground drain confirms a sent message", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          providerThreadId: "linq_chat_123",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        status: "sent",
      }),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
      }),
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("pauses 1.5 seconds between confirmed Linq reply bubbles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
    try {
      const effects = createReplyBubbleEffects({
        baseKey: "delivery_bubbles",
        channel: "linq",
        count: 3,
        turnId: "turn_bubbles",
      });
      const effectById = new Map(effects.map((effect) => [effect.effectId, effect]));
      const dispatchedAt: number[] = [];
      mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
        async ({ intentId }) => createMirrorState({
          delivery: null,
          intentId,
          lastError: null,
          status: "pending",
        }),
      );
      mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) => {
        const effect = effectById.get(intentId);
        assert(effect);
        dispatchedAt.push(Date.now());
        return createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            idempotencyKey: effect.payload.idempotencyKey,
            providerThreadId: "linq_chat_123",
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          intentId,
          status: "sent",
        });
      });

      const drain = drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: effects,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(drain).resolves.toHaveLength(3);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(3);
      expect(dispatchedAt).toEqual([
        Date.parse("2026-04-08T00:00:00.000Z"),
        Date.parse("2026-04-08T00:00:01.500Z"),
        Date.parse("2026-04-08T00:00:03.000Z"),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      channel: "telegram" as const,
      deliveryPhase: "foreground_current_turn" as const,
      label: "Telegram reply bubbles",
    },
    {
      channel: "linq" as const,
      deliveryPhase: "background_retry" as const,
      label: "background Linq retries",
    },
  ])("does not pace $label", async ({ channel, deliveryPhase }) => {
    vi.useFakeTimers();
    try {
      const effects = createReplyBubbleEffects({
        baseKey: "unpaced_bubbles",
        channel,
        count: 2,
        deliveryPhase,
        turnId: `turn_unpaced_${channel}_${deliveryPhase}`,
      });
      mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
        async ({ intentId }) => createMirrorState({
          delivery: null,
          intentId,
          lastError: null,
          status: "pending",
        }),
      );
      mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) =>
        createDispatchResult({
          delivery: createDelivery({ idempotencyKey: `assistant-outbox:${intentId}` }),
          intentId,
          status: "sent",
        }));

      const drain = drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: effects,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await vi.advanceTimersByTimeAsync(0);

      await expect(drain).resolves.toHaveLength(2);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      firstIdempotencyKey: "assistant-outbox:intent_reply",
      firstMessage: "Reply before reaction",
      firstReplyToMessageId: "linq_message_123",
      label: "a Linq reply followed by a reaction",
      secondIdempotencyKey: "assistant-outbox:intent_reaction",
      secondMessage: "",
      secondReplyToMessageId: "linq_message_123",
    },
    {
      firstIdempotencyKey: "unrelated_first",
      firstMessage: "First unrelated message",
      firstReplyToMessageId: null,
      label: "unrelated Linq effects",
      secondIdempotencyKey: "unrelated_second",
      secondMessage: "Second unrelated message",
      secondReplyToMessageId: null,
    },
  ])("does not pace $label", async ({
    firstIdempotencyKey,
    firstMessage,
    firstReplyToMessageId,
    secondIdempotencyKey,
    secondMessage,
    secondReplyToMessageId,
  }) => {
    vi.useFakeTimers();
    try {
      const turnId = "turn_unpaced_adjacent_effects";
      const effects = [
        {
          idempotencyKey: firstIdempotencyKey,
          message: firstMessage,
          replyToMessageId: firstReplyToMessageId,
        },
        {
          idempotencyKey: secondIdempotencyKey,
          message: secondMessage,
          replyToMessageId: secondReplyToMessageId,
        },
      ].map((payload, index) => buildHostedAssistantDeliveryEffect({
        dedupeKey: `dedupe_unpaced_adjacent_${index}`,
        deliveryPhase: "foreground_current_turn",
        effectId: `intent_unpaced_adjacent_${index}`,
        payload: createPayload({
          bindingDeliveryKind: "thread",
          bindingDeliveryTarget: "linq_chat_123",
          channel: "linq",
          explicitTarget: "linq_chat_123",
          turnId,
          ...payload,
        }),
      }));
      mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
        async ({ intentId }) => createMirrorState({
          delivery: null,
          intentId,
          lastError: null,
          status: "pending",
        }),
      );
      mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) =>
        createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            providerThreadId: "linq_chat_123",
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          intentId,
          status: "sent",
        }));

      const drain = drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: effects,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await vi.advanceTimersByTimeAsync(0);

      await expect(drain).resolves.toHaveLength(2);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not pause after a failed Linq reply bubble", async () => {
    vi.useFakeTimers();
    try {
      const effects = createReplyBubbleEffects({
        baseKey: "failed_bubbles",
        channel: "linq",
        count: 2,
        turnId: "turn_failed_bubble",
      });
      const failedEffectId = effects[0]?.effectId;
      assert(failedEffectId);
      mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
        async ({ intentId }) => createMirrorState({
          delivery: null,
          intentId,
          lastError: null,
          status: "pending",
        }),
      );
      mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) => {
        if (intentId === failedEffectId) {
          const deliveryError = {
            code: "ASSISTANT_DELIVERY_FAILED",
            message: "terminal bubble failure",
          };
          return createDispatchResult(
            { intentId, lastError: deliveryError, status: "failed" },
            deliveryError,
          );
        }
        return createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            idempotencyKey: "failed_bubbles",
            providerThreadId: "linq_chat_123",
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          intentId,
          status: "sent",
        });
      });

      const drain = drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: effects,
        effectsPort: createHostedRuntimeEffectsPortStub(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await vi.advanceTimersByTimeAsync(0);

      await expect(drain).resolves.toHaveLength(2);
      expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets remaining prepared bubbles when the pacing pause is aborted", async () => {
    const abortController = new AbortController();
    const abortReason = new Error("lease expired during reply bubble pause");
    const effects = createReplyBubbleEffects({
      baseKey: "aborted_bubbles",
      channel: "linq",
      count: 2,
      transportIdempotent: true,
      turnId: "turn_aborted_bubbles",
    });
    const firstEffect = effects[0];
    const finalEffect = effects[1];
    assert(firstEffect);
    assert(finalEffect);
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
      async ({ intentId }) => createMirrorState({
        delivery: null,
        intentId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) =>
      createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "aborted_bubbles:bubble:0",
          providerThreadId: "linq_chat_123",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        intentId,
        status: "sent",
      }));

    const drain = drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [firstEffect, finalEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      preparedDispatches: [{
        intentId: finalEffect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
        }),
      }],
      signal: abortController.signal,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledOnce();

    abortController.abort(abortReason);

    await expect(drain).rejects.toBe(abortReason);
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledOnce();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: finalEffect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        vault: HOSTED_WAKE.vaultRoot,
      }),
    );
  });

  it("does not stop Linq typing for missing-result when a later same-target delivery sends in the same drain", async () => {
    const missingResultEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_missing",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_missing",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_missing",
        replyToMessageId: "linq_message_missing",
      }),
    });
    const sentEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_sent",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_sent",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_sent",
        replyToMessageId: "linq_message_sent",
      }),
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(
      async ({ intentId }) => {
        if (intentId === "intent_missing") {
          return createMirrorState(null);
        }
        return createMirrorState({
          delivery: null,
          intentId,
          lastError: null,
          status: "pending",
        });
      },
    );
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "assistant-outbox:intent_sent",
          providerThreadId: "linq_chat_123",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        intentId: "intent_sent",
        status: "sent",
      }),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [missingResultEffect, sentEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.deliveryStatus)).toEqual([
      "missing-result",
      "sent",
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not stop Linq typing when a later same-target reply sends in the same drain", async () => {
    const failedSegmentEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_segment",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_segment",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_segment",
        replyToMessageId: "linq_message_segment",
      }),
    });
    const finalReplyEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_final",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_final",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_final",
        replyToMessageId: "linq_message_final",
      }),
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    const deliveryError = {
      code: "ASSISTANT_DELIVERY_FAILED",
      message: "segment send failed",
    };
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) => {
      if (intentId === "intent_segment") {
        return createDispatchResult(
          {
            intentId,
            lastError: deliveryError,
            status: "failed",
          },
          deliveryError,
        );
      }
      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: `assistant-outbox:${intentId}`,
          providerThreadId: "linq_chat_123",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        intentId,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [failedSegmentEffect, finalReplyEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.deliveryStatus)).toEqual([
      "failed",
      "sent",
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not stop Linq typing when a later same-target delivery remains retryable", async () => {
    const failedSegmentEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_segment",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_segment",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_segment",
        replyToMessageId: "linq_message_segment",
      }),
    });
    const retryableEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_retryable",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_retryable",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_retryable",
        replyToMessageId: "linq_message_retryable",
      }),
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) => {
      if (intentId === "intent_segment") {
        const deliveryError = {
          code: "ASSISTANT_DELIVERY_FAILED",
          message: "segment send failed",
        };
        return createDispatchResult(
          {
            intentId,
            lastError: deliveryError,
            status: "failed",
          },
          deliveryError,
        );
      }
      const deliveryError = {
        code: "ASSISTANT_DELIVERY_UNAVAILABLE",
        message: "retry later",
      };
      return createDispatchResult(
        {
          intentId,
          lastError: deliveryError,
          status: "retryable",
        },
        deliveryError,
      );
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [failedSegmentEffect, retryableEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.deliveryStatus)).toEqual([
      "failed",
      "retryable",
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("stops Linq typing only for a failed target when another target sends in the same drain", async () => {
    const failedSegmentEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_segment",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_segment",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_failed",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_segment",
        replyToMessageId: "linq_message_segment",
      }),
    });
    const otherTargetEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_other",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_other",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_other",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_other",
        replyToMessageId: "linq_message_other",
      }),
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    const deliveryError = {
      code: "ASSISTANT_DELIVERY_FAILED",
      message: "segment send failed",
    };
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ intentId }) => {
      if (intentId === "intent_segment") {
        return createDispatchResult(
          {
            intentId,
            lastError: deliveryError,
            status: "failed",
          },
          deliveryError,
        );
      }
      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: `assistant-outbox:${intentId}`,
          providerThreadId: "linq_chat_other",
          target: "linq_chat_other",
          targetKind: "thread",
        }),
        intentId,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [failedSegmentEffect, otherTargetEffect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes.map((outcome) => outcome.deliveryStatus)).toEqual([
      "failed",
      "sent",
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chats/linq_chat_failed/typing");
    expect(String(url)).not.toContain("linq_chat_other");
    expect(init).toMatchObject({
      method: "DELETE",
    });
  });

  it.each([
    {
      expectedStatus: "sending",
      setup: (effect: ReturnType<typeof createEffect>) => {
        mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
          createMirrorState({
            intentId: effect.effectId,
            lastError: null,
            status: "sending",
          }),
        );
      },
    },
    {
      expectedStatus: "retryable",
      setup: () => {
        const deliveryError = {
          code: "ASSISTANT_DELIVERY_UNAVAILABLE",
          message: "retry later",
        };
        mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
          createDispatchResult(
            {
              lastError: deliveryError,
              status: "retryable",
            },
            deliveryError,
          ),
        );
      },
    },
    {
      expectedStatus: "pending",
      setup: () => {
        const deliveryError = {
          code: "ASSISTANT_DELIVERY_PENDING",
          message: "delivery is still pending",
        };
        mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
          createDispatchResult(
            {
              lastError: deliveryError,
              status: "pending",
            },
            deliveryError,
          ),
        );
      },
    },
  ])(
    "does not stop Linq typing for non-terminal $expectedStatus delivery outcomes",
    async ({ expectedStatus, setup }) => {
      const effect = createEffect({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
      });
      setup(effect);
      const providerFetch = vi.fn<typeof fetch>(async () =>
        new Response(null, { status: 204 }));

      const outcomes = await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });

      expect(outcomes).toEqual([
        expect.objectContaining({
          deliveryStatus: expectedStatus,
        }),
      ]);
      await flushHostedRuntimeCallbackTestMicrotasks();
      expect(providerFetch).not.toHaveBeenCalled();
    },
  );

  it("blocks a private Telegram rich card before provider entry when route authority is unavailable", async () => {
    const target = "telegram_direct_rich_blocked";
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: target,
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      card: HOSTED_TELEGRAM_ROUTINE_CARD,
      threadId: "hid_telegram_direct_rich_blocked",
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendTelegramRich({
          fallbackMessage: "Readable card fallback.",
          richMessage: { html: "<h2>Card</h2>" },
          target,
        });
        throw new Error("unreachable without live route authority");
      },
    );
    const providerFetch = vi.fn<typeof fetch>();

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
    });

    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("best-effort stops Linq typing after foreground drain fails and swallows cleanup errors", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const deliveryError = {
      code: "ASSISTANT_DELIVERY_FAILED",
      message: "provider send failed",
    };
    const providerFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("typing stop failed");
    });
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
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_FAILED",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chats/linq_chat_123/typing");
    expect(init).toMatchObject({
      method: "DELETE",
    });
  });

  it("best-effort stops Linq typing after foreground drain records an ambiguous failure", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const deliveryError = {
      code: "ASSISTANT_DELIVERY_AMBIGUOUS",
      message: "provider send may have landed",
    };
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult(
        {
          lastError: deliveryError,
          status: "abandoned",
        },
        deliveryError,
      ),
    );

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chats/linq_chat_123/typing");
    expect(init).toMatchObject({
      method: "DELETE",
    });
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
      deliveryTransportIdempotent: true,
      intentId: "intent_123",
      preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      resetAt: expect.any(Date),
      restoreDispatchState: {
        attemptCount: 0,
        deliveryConfirmationPending: false,
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

  it("does not stop Linq typing when a thrown pre-provider abort resets prepared delivery", async () => {
    const abortReason = new Error("lease expired before provider dispatch");
    const signal = {
      aborted: true,
      reason: abortReason,
    } as AbortSignal;
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      transportIdempotent: true,
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
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
    mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValueOnce({
      delivery: null,
      intentId: effect.effectId,
      lastError: null,
      status: "pending",
    });

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        preparedDispatches: [{
          intentId: effect.effectId,
          preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryTransportIdempotent: true,
          }),
        }],
        providerFetch,
        signal,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toBe(abortReason);

    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledOnce();
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("keeps capability-only Linq activity pre-provider for prepared-delivery reset", async () => {
    const abortReason = new Error("lease expired after Linq capability lookup");
    const abortController = new AbortController();
    const signal = abortController.signal;
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      card: HOSTED_LINQ_RESPONSE_CARD,
      channel: "linq",
      idempotencyKey: "assistant-outbox:capability-pre-provider-abort",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey:
            "assistant-outbox:capability-pre-provider-abort",
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
    mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValueOnce({
      delivery: null,
      intentId: effect.effectId,
      lastError: null,
      status: "pending",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          card: HOSTED_LINQ_RESPONSE_CARD,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          idempotencyKey:
            "assistant-outbox:capability-pre-provider-abort",
          message: "Nutrition summary",
          persistAppCardTextFallback: vi.fn(),
          target: "linq_chat_123",
          targetKind: "thread",
          threadIsDirect: true,
        });
        throw new Error("unreachable after capability abort");
      },
    );
    const providerFetch = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        abortController.abort(abortReason);
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      preparedDispatches: [{
        intentId: effect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch,
      signal,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toBe(abortReason);

    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledOnce();
    expect(providerFetch.mock.calls.some(([request]) =>
      new URL(String(request)).pathname.includes("/messages")
    )).toBe(false);
  });

  it("keeps a non-abort capability-entry yield immediately selectable without persisting fallback", async () => {
    const idempotencyKey = "assistant-outbox:capability-pre-provider-yield";
    let shouldYield = false;
    const persistAppCardTextFallback = vi.fn();
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      card: HOSTED_LINQ_RESPONSE_CARD,
      channel: "linq",
      idempotencyKey,
      threadIsDirect: true,
      transportIdempotent: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey: idempotencyKey,
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        { sendingStartedAt: "2026-04-08T00:00:05.000Z" },
      ),
    );
    mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValueOnce({
      delivery: null,
      deliveryIdempotencyKey: idempotencyKey,
      intentId: effect.effectId,
      lastError: null,
      status: "pending",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          card: HOSTED_LINQ_RESPONSE_CARD,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          idempotencyKey,
          message: "Nutrition summary",
          persistAppCardTextFallback,
          target: "linq_chat_123",
          targetKind: "thread",
          threadIsDirect: true,
        });
        throw new Error("unreachable after capability yield");
      },
    );
    const providerFetch = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        shouldYield = true;
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      preparedDispatches: [{
        intentId: effect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch,
      shouldYieldBackgroundDelivery: () => shouldYield,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([]);

    expect(persistAppCardTextFallback).not.toHaveBeenCalled();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledOnce();
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
      }),
    );
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("settles a rejected card and resets its persisted fallback identity after pre-fallback yield", async () => {
    const idempotencyKey = "assistant-outbox:card-rejected-before-fallback-yield";
    const fallbackIdempotencyKey = `${idempotencyKey}:fallback`;
    const events: string[] = [];
    let shouldYield = false;
    const persistAppCardTextFallback = vi.fn(async (fallback: {
      idempotencyKey: string;
    }) => {
      events.push(`persist:${fallback.idempotencyKey}`);
      shouldYield = true;
    });
    const recordDeliveryOutcome = vi.fn(async (request: {
      idempotencyKey?: string | null;
    }) => {
      events.push(`outcome:${request.idempotencyKey ?? "none"}`);
    });
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        `authority:${request.authorityCheckOnly ? "read" : "claim"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
      return buildClaimedLinqEngagementResult(request);
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      card: HOSTED_LINQ_RESPONSE_CARD,
      channel: "linq",
      idempotencyKey,
      threadIsDirect: true,
      transportIdempotent: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey: idempotencyKey,
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        { sendingStartedAt: "2026-04-08T00:00:05.000Z" },
      ),
    );
    mocks.resetAssistantOutboxPreparedDispatchById.mockResolvedValueOnce({
      delivery: null,
      deliveryIdempotencyKey: fallbackIdempotencyKey,
      intentId: effect.effectId,
      lastError: null,
      status: "pending",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          card: HOSTED_LINQ_RESPONSE_CARD,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          idempotencyKey,
          message: "Nutrition summary",
          persistAppCardTextFallback,
          target: "linq_chat_123",
          targetKind: "thread",
          threadIsDirect: true,
        });
        throw new Error("unreachable after fallback yield");
      },
    );
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        events.push("provider:capability");
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { message?: { parts?: Array<{ type?: string }> } }
        : {};
      if (body.message?.parts?.[0]?.type === "imessage_app") {
        events.push("provider:card");
        return new Response(JSON.stringify({ error: "unsupported app card" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      events.push("provider:text");
      return new Response(JSON.stringify({ message: { id: "unexpected" } }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      preparedDispatches: [{
        intentId: effect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch,
      shouldYieldBackgroundDelivery: () => shouldYield,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([]);

    expect(events).toEqual([
      `authority:read:${idempotencyKey}`,
      `authority:read:${idempotencyKey}`,
      "provider:capability",
      `authority:claim:${idempotencyKey}`,
      "provider:card",
      `outcome:${idempotencyKey}`,
      `persist:${fallbackIdempotencyKey}`,
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        idempotencyKey,
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledOnce();
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("best-effort stops Linq typing when delivery throws terminally", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const terminalError = Object.assign(new Error("terminal dispatch failure"), {
      code: "ASSISTANT_DELIVERY_FAILED",
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockRejectedValueOnce(terminalError);

    await expect(
      drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toBe(terminalError);

    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/chats/linq_chat_123/typing");
    expect(init).toMatchObject({
      method: "DELETE",
    });
  });

  it("does not stop Linq typing when a terminal throw leaves a same-target effect unprocessed", async () => {
    const failedEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_failed",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_failed",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_failed",
      }),
    });
    const unprocessedEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_unprocessed",
      deliveryPhase: "foreground_current_turn",
      effectId: "intent_unprocessed",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_unprocessed",
      }),
    });
    const terminalError = Object.assign(new Error("terminal dispatch failure"), {
      code: "ASSISTANT_DELIVERY_FAILED",
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockRejectedValueOnce(terminalError);

    await expect(
      drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [failedEffect, unprocessedEffect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toBe(terminalError);

    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not stop Linq typing when yield reset throws before later same-target work runs", async () => {
    const failedEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_failed",
      deliveryPhase: "background_retry",
      effectId: "intent_failed",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_failed",
        transportIdempotent: true,
      }),
    });
    const pendingEffect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe_pending",
      deliveryPhase: "background_retry",
      effectId: "intent_pending",
      payload: createPayload({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        idempotencyKey: "assistant-outbox:intent_pending",
        transportIdempotent: true,
      }),
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    const resetError = new Error("reset failed");
    let shouldYield = false;
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async () => {
      shouldYield = true;
      const deliveryError = {
        code: "ASSISTANT_DELIVERY_FAILED",
        message: "first send failed",
      };
      return createDispatchResult(
        {
          intentId: "intent_failed",
          lastError: deliveryError,
          status: "failed",
        },
        deliveryError,
      );
    });
    mocks.resetAssistantOutboxPreparedDispatchById.mockRejectedValueOnce(resetError);

    await expect(
      drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: [failedEffect, pendingEffect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        preparedDispatches: [{
          intentId: "intent_pending",
          preparedDispatchToken: "prepared-dispatch-token-pending",
          previousDispatchState: createPreparedPreviousDispatchState({
            deliveryTransportIdempotent: true,
          }),
        }],
        providerFetch,
        shouldYieldBackgroundDelivery: () => shouldYield,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toBe(resetError);

    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("does not stop Linq typing when delivery throws a retryable failure", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
    });
    const retryableError = Object.assign(new Error("retryable dispatch failure"), {
      code: "ASSISTANT_DELIVERY_UNAVAILABLE",
      context: {
        retryable: true,
      },
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }));
    mocks.dispatchAssistantOutboxIntent.mockRejectedValueOnce(retryableError);

    await expect(
      drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        forwardedEnv: {
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        providerFetch,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      }),
    ).rejects.toBe(retryableError);

    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(providerFetch).not.toHaveBeenCalled();
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
            deliveryTransportIdempotent: true,
          }),
        },
        {
          intentId: "intent_second",
          preparedDispatchToken: "prepared-dispatch-token-second",
          previousDispatchState: createPreparedPreviousDispatchState({
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
      deliveryTransportIdempotent: true,
      intentId: "intent_second",
      preparedDispatchToken: "prepared-dispatch-token-second",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
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
      deliveryTransportIdempotent: true,
      intentId: "intent_yield_before_dispatch",
      preparedDispatchToken: "prepared-dispatch-token-yield-before-dispatch",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
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
      deliveryTransportIdempotent: true,
      intentId: "intent_yield_at_provider_entry",
      preparedDispatchToken: "prepared-dispatch-token-yield-at-provider-entry",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState({
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
          previousDispatchState: createPreparedPreviousDispatchState(),
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
          previousDispatchState: createPreparedPreviousDispatchState(),
        }, {
          intentId: "intent_second",
          preparedDispatchToken: "prepared-dispatch-token-second",
          previousDispatchState: createPreparedPreviousDispatchState(),
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
      deliveryTransportIdempotent: false,
      intentId: "intent_first",
      preparedDispatchToken: "prepared-dispatch-token-first",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState(),
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(mocks.resetAssistantOutboxPreparedDispatchById).toHaveBeenCalledWith({
      deliveryTransportIdempotent: false,
      intentId: "intent_second",
      preparedDispatchToken: "prepared-dispatch-token-second",
      resetAt: expect.any(Date),
      restoreDispatchState: createPreparedPreviousDispatchState(),
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
        previousDispatchState: createPreparedPreviousDispatchState(),
      }, {
        intentId: "intent_second",
        preparedDispatchToken: "prepared-dispatch-token-second",
        previousDispatchState: createPreparedPreviousDispatchState(),
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
      trackMessageVolumeReceipt: false,
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
      trackMessageVolumeReceipt: false,
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
      trackMessageVolumeReceipt: false,
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

  it("preserves legacy Telegram group delivery without route authority", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "chat_123",
      threadId: "chat_123",
      threadIsDirect: false,
    });
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
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(assertLiveness).toHaveBeenCalledTimes(2);
    expect(assertExternalThreadRouteAuthority).not.toHaveBeenCalled();
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

  it.each([
    ["nutrition", HOSTED_LINQ_RESPONSE_CARD],
    ["routine", HOSTED_TELEGRAM_ROUTINE_CARD],
  ] as const)(
    "sends a private Telegram %s card through the hosted provider boundary",
    async (_label, card) => {
      const idempotencyKey = "assistant-outbox:intent_123";
      const responseText = "Readable card fallback.";
      const target = "telegram_direct_rich_123";
      const routeAuthority = {
        channel: "telegram" as const,
        containerMemberId: "member_123",
        threadId: target,
      };
      const effect = createEffect({
        actorId: null,
        answeredMailboxItemIds: [],
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: target,
        card,
        idempotencyKey,
        identityId: null,
        message: responseText,
        threadId: "hid_telegram_direct_rich_123",
        threadIsDirect: true,
      });
      const storedIntent = createPendingHostedDeliveryIntent({
        actorId: null,
        answeredMailboxItemIds: [],
        automationAuthority: null,
        bindingDelivery: { kind: "thread", target },
        card,
        channel: "telegram",
        deliveryIdempotencyKey: idempotencyKey,
        deliverySource: null,
        emailHtml: null,
        explicitTarget: null,
        externalThreadRouteAuthority: routeAuthority,
        identityId: null,
        intentId: effect.effectId,
        media: [],
        message: responseText,
        operation: null,
        reviewedAssistantAskCompletionExpiresAt: null,
        subject: null,
        threadId: "hid_telegram_direct_rich_123",
        threadIsDirect: true,
      }) as AssistantOutboxIntent;
      mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
        createMirrorState(storedIntent),
      );
      mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
        async ({ dependencies, dispatchHooks }) => {
          await dispatchHooks?.preflightDispatchIntent?.({
            intent: storedIntent,
            now: new Date("2026-04-08T00:00:30.000Z"),
            vault: HOSTED_WAKE.vaultRoot,
          });
          const delivery = await dependencies.sendTelegramRich({
            fallbackMessage: responseText,
            idempotencyKey,
            replyToMessageId: null,
            richMessage: { html: "<h2>Card</h2>" },
            target,
          });
          return createDispatchResult({
            delivery: createDelivery({
              idempotencyKey,
              messageLength: responseText.length,
              providerMessageId: delivery.providerMessageId,
              target: delivery.target,
              targetKind: "thread",
            }),
            status: "sent",
          });
        },
      );
      const assertExternalThreadRouteAuthority = vi.fn(
        async () => undefined,
      );
      const providerFetch = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toContain("/sendRichMessage");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          chat_id: target,
          rich_message: { html: "<h2>Card</h2>" },
        });
        return Response.json({
          ok: true,
          result: { message_id: 701 },
        });
      });

      await expect(drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertExternalThreadRouteAuthority,
        }),
        forwardedEnv: {},
        platformEnv: {
          TELEGRAM_API_BASE_URL: "https://telegram.example",
          TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
          TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
        },
        providerFetch,
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      })).resolves.toEqual([
        expect.objectContaining({
          deliveryStatus: "sent",
          providerMessageId: "701",
        }),
      ]);

      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledWith(
        routeAuthority,
        { signal: null },
      );
      expect(providerFetch).toHaveBeenCalledOnce();
    },
  );

  it("verifies private Telegram image bytes before provider dispatch and sends multipart", async () => {
    const fallbackDescription =
      "Morning light experiment progress. Direction context unavailable · mover sentiment is neutral.";
    const image = {
      alt: fallbackDescription,
      contentType: "image/webp" as const,
      filename: "generated-chart.webp",
      kind: "vault_image" as const,
      ref: "raw/captures/generated-chart.webp",
      sha256: "a".repeat(64),
      sizeBytes: 12,
      source: "gpt-image-2",
    };
    const effect = createEffect({ media: [image] });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const sendTelegramImage = dependencies.sendTelegramImage;
      if (!sendTelegramImage) {
        throw new Error("Expected hosted Telegram image transport.");
      }
      const delivery = await sendTelegramImage({
        media: [image],
        message: "Private chart",
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
    const providerFetch = vi.fn<typeof fetch>(async (_request, init) => {
      expect(init?.body).toBeInstanceOf(FormData);
      const entries = Object.fromEntries((init?.body as FormData).entries());
      expect(entries).toMatchObject({
        caption: `Private chart\n\n${fallbackDescription}`,
        chat_id: "chat_123",
      });
      expect(String(entries.caption).match(
        /Direction context unavailable · mover sentiment is neutral\./gu,
      )).toHaveLength(1);
      expect(entries.photo).toBeInstanceOf(File);
      expect((entries.photo as File).name).toBe("generated-chart.webp");
      expect((entries.photo as File).type).toBe("image/webp");
      return Response.json({
        ok: true,
        result: { message_id: 301 },
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        providerMessageId: "301",
      }),
    ]);

    expect(mocks.readVerifiedAssistantVaultImageBytes).toHaveBeenCalledWith({
      image,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });
    expect(
      mocks.readVerifiedAssistantVaultImageBytes.mock.invocationCallOrder[0],
    ).toBeLessThan(providerFetch.mock.invocationCallOrder[0] ?? 0);
  });

  it("fails a route-scoped Telegram group delivery before provider entry when live authority is unavailable", async () => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: "intent_123",
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: routeAuthority.threadId,
      });
      throw new Error("unreachable without live route authority");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      context: expect.objectContaining({ retryable: true }),
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("blocks a direct Telegram phone result when its live route authority is unavailable", async () => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_direct_123",
    };
    const idempotencyKey = "phone-call-result:hpc_revoked_direct";
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      idempotencyKey,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendTelegram({
        idempotencyKey,
        message: "Private phone-call result.",
        replyToMessageId: null,
        target: routeAuthority.threadId,
      });
      throw new Error("unreachable without live route authority");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      context: expect.objectContaining({ retryable: true }),
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      idempotencyKey: "phone-call-result:hpc_route_restored",
      notification: "result",
    },
    {
      idempotencyKey: "phone-call-result:hpc_route_restored:stop-settled",
      notification: "stop settlement",
    },
  ])("retries a direct Telegram phone-call $notification after its exact route is restored", async ({
    idempotencyKey,
  }) => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_direct_123",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      idempotencyKey,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: null,
        deliveryIdempotencyKey: idempotencyKey,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    let routeAuthorized = false;
    const routeRevoked = Object.assign(new Error("route revoked"), {
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      context: { retryable: false, status: 403 },
      retryable: false,
    });
    const assertExternalThreadRouteAuthority = vi.fn(async () => {
      if (!routeAuthorized) {
        throw routeRevoked;
      }
    });
    mocks.sendTelegramMessage.mockResolvedValue({
      providerMessageId: "provider_123",
      target: routeAuthority.threadId,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ dependencies }) => {
      const delivery = await dependencies.sendTelegram({
        idempotencyKey,
        message: "Private phone-call result.",
        replyToMessageId: null,
        target: routeAuthority.threadId,
      });
      return createDispatchResult({
        delivery: createDelivery({
          idempotencyKey,
          providerMessageId: delivery.providerMessageId,
          target: delivery.target,
        }),
        status: "sent",
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();

    routeAuthorized = true;
    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        target: routeAuthority.threadId,
      }),
    ]);

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("revalidates the exact Telegram group route immediately before provider entry", async () => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: "intent_123",
        lastError: null,
        status: "pending",
      }),
    );
    mocks.sendTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "provider_123",
      target: routeAuthority.threadId,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      expect(dependencies.telegramVoiceMemoRuntime).toMatchObject({
        authorityBoundTarget: routeAuthority.threadId,
      });
      const delivery = await dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: routeAuthority.threadId,
      });
      return createDispatchResult({
        delivery: createDelivery({
          providerMessageId: delivery.providerMessageId,
          target: delivery.target,
        }),
        status: "sent",
      });
    });
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledWith(
      routeAuthority,
      { signal: null },
    );
    expect(
      assertExternalThreadRouteAuthority.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.sendTelegramMessage.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: routeAuthority.threadId }),
      expect.objectContaining({ authorityBoundTarget: routeAuthority.threadId }),
    );
  });

  it("revalidates reviewed Assistant Ask authority at Telegram provider entry", async () => {
    const completionId = "aask_done_telegram_provider_entry";
    const expiresAt = "2099-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const reviewedAnswer = "Reviewed private answer.";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      idempotencyKey,
      message: reviewedAnswer,
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      bindingDelivery: {
        kind: "thread",
        target: routeAuthority.threadId,
      },
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      externalThreadRouteAuthority: routeAuthority,
      intentId: effect.effectId,
      media: [],
      message: reviewedAnswer,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.sendTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "provider_123",
      target: routeAuthority.threadId,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: reviewedAnswer,
          replyToMessageId: null,
          target: routeAuthority.threadId,
        });
        return createDispatchResult({
          delivery: createDelivery({
            idempotencyKey,
            messageLength: reviewedAnswer.length,
            providerMessageId: delivery.providerMessageId,
            target: delivery.target,
            targetKind: "thread",
          }),
          status: "sent",
        });
      },
    );
    const assertExternalThreadRouteAuthority = vi.fn(async () => ({}));

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledWith(
      routeAuthority,
      {
        assistantAskCompletion: {
          answeredMailboxItemIds: [completionId],
          assistantAskCompletionExpiresAt: expiresAt,
          assistantAskFallback: false,
          idempotencyKey,
        },
        signal: null,
      },
    );
    expect(
      assertExternalThreadRouteAuthority.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.sendTelegramMessage.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      {
        idempotencyKey,
        message: reviewedAnswer,
        replyToMessageId: null,
        target: routeAuthority.threadId,
      },
      expect.objectContaining({
        authorityBoundTarget: routeAuthority.threadId,
      }),
    );
  });

  it("revalidates a live private Assistant Ask completion at Telegram provider entry", async () => {
    const completionId = "aask_done_private_telegram_provider_entry";
    const expiresAt = "2099-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const responseText = "Exact private answer.";
    const target = "telegram_direct_123";
    const effect = createEffect({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      identityId: null,
      message: responseText,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: null,
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      subject: null,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.sendTelegramMessage.mockImplementationOnce(async (
      _request: unknown,
      dependencies: { fetchImplementation?: typeof fetch },
    ) => {
      await dependencies.fetchImplementation?.(
        "https://api.telegram.example/private",
        { method: "POST" },
      );
      return {
        providerMessageId: "provider_private_telegram_123",
        target,
      };
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: responseText,
          replyToMessageId: null,
          target,
        });
        const persistedDelivery = createDelivery({
          idempotencyKey,
          messageLength: responseText.length,
          providerMessageId: delivery.providerMessageId,
          target: delivery.target,
          targetKind: "thread",
        });
        return createDispatchResult({
          delivery: persistedDelivery,
          status: "sent",
        });
      },
    );
    const assertAssistantAskPrivateCompletionAuthority = vi.fn(
      async () => undefined,
    );
    const providerFetch = vi.fn<typeof fetch>();
    mocks.persistAssistantPrivateCompletionContinuityAfterDelivery
      .mockRejectedValueOnce(new Error("Synthetic local continuity interruption."));

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertAssistantAskPrivateCompletionAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(assertAssistantAskPrivateCompletionAuthority).toHaveBeenCalledWith(
      {
        answeredMailboxItemIds: [completionId],
        assistantAskCompletionExpiresAt: expiresAt,
        idempotencyKey,
        responseTextDigest: createHash("sha256")
          .update(responseText)
          .digest("hex"),
        route: {
          actorId: null,
          channel: "telegram",
          delivery: { kind: "thread", target },
          identityId: null,
          threadId: "hid_telegram_direct_123",
          threadIsDirect: true,
        },
      },
      { signal: null },
    );
    expect(
      assertAssistantAskPrivateCompletionAuthority.mock.invocationCallOrder[0],
    ).toBeLessThan(providerFetch.mock.invocationCallOrder[0] ?? 0);
    expect(
      providerFetch.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.persistAssistantPrivateCompletionContinuityAfterDelivery.mock
        .invocationCallOrder[0] ?? 0,
    );
    expect(
      mocks.persistAssistantPrivateCompletionContinuityAfterDelivery,
    ).toHaveBeenCalledWith({
      intent: expect.objectContaining({
        delivery: expect.objectContaining({
          providerMessageId: "provider_private_telegram_123",
        }),
        intentId: storedIntent.intentId,
        status: "sent",
      }),
      vault: HOSTED_WAKE.vaultRoot,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        level: "warn",
        message: "Hosted private completion continuity persistence failed.",
        phase: "outbox",
      }),
    );
  });

  it("pins private Telegram delivery against provider migration", async () => {
    const completionId = "aask_done_private_telegram_migration";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const target = "123";
    const responseText = "Exact private Telegram answer.";
    const effect = createEffect({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      identityId: null,
      message: responseText,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: null,
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
      subject: null,
      threadId: "hid_telegram_direct_123",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dependencies.sendTelegram({
          idempotencyKey,
          message: responseText,
          replyToMessageId: null,
          target,
        });
        throw new Error("unreachable after Telegram migration rejection");
      },
    );
    const assertAssistantAskPrivateCompletionAuthority = vi.fn(
      async () => undefined,
    );
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        description: "chat migrated",
        error_code: 400,
        ok: false,
        parameters: { migrate_to_chat_id: "456" },
      }), {
        headers: { "content-type": "application/json" },
        status: 400,
      })
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertAssistantAskPrivateCompletionAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE",
      deliveryMayHaveSucceeded: false,
      retryable: false,
    });
    expect(assertAssistantAskPrivateCompletionAuthority).toHaveBeenCalledTimes(2);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("revalidates private Telegram authority before an internal provider retry", async () => {
    const completionId = "aask_done_private_telegram_retry";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const target = "123";
    const responseText = "Exact private Telegram retry answer.";
    const effect = createEffect({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      identityId: null,
      message: responseText,
      threadId: "hid_telegram_direct_retry",
      threadIsDirect: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: null,
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: null,
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
      subject: null,
      threadId: "hid_telegram_direct_retry",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dependencies.sendTelegram({
          idempotencyKey,
          message: responseText,
          replyToMessageId: null,
          target,
        });
        throw new Error("unreachable after Telegram retry rejection");
      },
    );
    const assertAssistantAskPrivateCompletionAuthority = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new VaultCliError(
        "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_STALE",
        "Private Assistant Ask route changed before retry.",
        { retryable: false },
      ));
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        description: "retry later",
        error_code: 429,
        ok: false,
        parameters: { retry_after: 0 },
      }), {
        headers: { "content-type": "application/json" },
        status: 429,
      })
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertAssistantAskPrivateCompletionAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_STALE",
    });
    expect(assertAssistantAskPrivateCompletionAuthority).toHaveBeenCalledTimes(3);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("fails a private Linq completion when its live route authority is rejected", async () => {
    const completionId = "aask_done_private_linq_route_rejected";
    const expiresAt = "2099-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const responseText = "Exact private Linq answer.";
    const target = "linq_direct_123";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      channel: "linq",
      idempotencyKey,
      message: responseText,
      threadId: "hid_linq_direct_123",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: "actor_123",
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "linq",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: "identity_123",
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      subject: null,
      threadId: "hid_linq_direct_123",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          idempotencyKey,
          media: [],
          message: responseText,
          target,
          targetKind: "thread",
        });
        throw new Error("unreachable after private route rejection");
      },
    );
    mocks.linqProviderFetchAttemptCount.mockReturnValue(2);
    let authorityAttempt = 0;
    const assertAssistantAskPrivateCompletionAuthority = vi.fn(async () => {
      authorityAttempt += 1;
      if (authorityAttempt === 2) {
        return;
      }
      if (authorityAttempt === 3) {
        throw new VaultCliError(
          "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_STALE",
          "Private Assistant Ask route changed.",
          { retryable: false },
        );
      }
    });
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 })
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertAssistantAskPrivateCompletionAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_STALE",
    });
    expect(assertAssistantAskPrivateCompletionAuthority).toHaveBeenCalledTimes(3);
    expect([
      ...assertAssistantAskPrivateCompletionAuthority.mock.invocationCallOrder
        .map((order) => ({ kind: "authority", order })),
      ...providerFetch.mock.invocationCallOrder
        .map((order) => ({ kind: "provider", order })),
    ].sort((left, right) => left.order - right.order).map(({ kind }) => kind))
      .toEqual(["authority", "authority", "provider", "authority"]);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(
      mocks.persistAssistantPrivateCompletionContinuityAfterDelivery,
    ).not.toHaveBeenCalled();
  });

  it("does not re-home a missing private Linq thread", async () => {
    const completionId = "aask_done_private_linq_missing_thread";
    const expiresAt = "2099-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const responseText = "Exact private answer for the existing route.";
    const target = "linq_direct_stale";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      channel: "linq",
      idempotencyKey,
      message: responseText,
      threadId: "hid_linq_direct_stale",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: "actor_123",
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "linq",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: "identity_123",
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      subject: null,
      threadId: "hid_linq_direct_stale",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          directRecipientPhoneNumber: "+15550001001",
          fromPhoneNumber: "+15550001002",
          homeRouteFallbackAllowed: true,
          idempotencyKey,
          media: [],
          message: responseText,
          target,
          targetKind: "thread",
        });
        throw new Error("unreachable after missing private Linq route");
      },
    );
    const assertAssistantAskPrivateCompletionAuthority = vi.fn(
      async () => undefined,
    );
    const assertLinqRecentInboundEngagement = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      directRecipientPhoneNumber?: string | null;
      fromPhoneNumber?: string | null;
      target?: string | null;
      targetKind?: "explicit" | "participant" | "thread" | null;
    }) => buildClaimedLinqEngagementResult(request));
    const providerFetch = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.endsWith(`/chats/${target}/messages`)) {
        return new Response(JSON.stringify({ code: "CHAT_NOT_FOUND" }), {
          headers: { "content-type": "application/json" },
          status: 404,
        });
      }
      throw new Error(`Unexpected Linq recovery request: ${url}`);
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertAssistantAskPrivateCompletionAuthority,
        assertLinqRecentInboundEngagement,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      context: expect.objectContaining({ status: 404 }),
    });
    const providerUrls = providerFetch.mock.calls.map(([request]) =>
      String(request)
    );
    expect(
      providerUrls.filter((url) => url.endsWith(`/chats/${target}/messages`)),
    ).toHaveLength(1);
    expect(providerUrls).not.toContain(
      "https://api.linq.example/api/partner/v3/chats",
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("persists the group fallback when a private Linq completion crosses expiry", async () => {
    vi.useFakeTimers();
    const completionId = "aask_done_private_linq_expired_at_provider_entry";
    const expiresAt = "2026-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const responseText = "Private answer expiring at dispatch.";
    const target = "linq_direct_123";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      channel: "linq",
      idempotencyKey,
      message: responseText,
      threadId: "hid_linq_direct_123",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      actorId: "actor_123",
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target },
      card: null,
      channel: "linq",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      identityId: "identity_123",
      intentId: effect.effectId,
      media: [],
      message: responseText,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      subject: null,
      threadId: "hid_linq_direct_123",
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    const assertAssistantAskPrivateCompletionAuthority = vi.fn(
      async () => ({ assistantAskFallbackRequired: true }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:14:59.999Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        vi.setSystemTime(new Date(expiresAt));
        await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          idempotencyKey,
          media: [],
          message: responseText,
          target,
          targetKind: "thread",
        });
        throw new Error("unreachable after private completion expiry");
      },
    );

    try {
      vi.setSystemTime(new Date("2026-04-08T00:14:59.999Z"));
      await expect(drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertAssistantAskPrivateCompletionAuthority,
        }),
        forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      })).rejects.toMatchObject({
        code: "ASSISTANT_ASK_PRIVATE_COMPLETION_FALLBACK_PERSISTED",
        context: expect.objectContaining({ retryable: false }),
      });
      expect(assertAssistantAskPrivateCompletionAuthority).toHaveBeenCalledOnce();
      expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
      expect(mocks.saveAssistantOutboxIntentIfUnchanged).not.toHaveBeenCalled();
      expect(
        mocks.persistAssistantPrivateCompletionContinuityAfterDelivery,
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a reserved private completion key on a non-messaging outbox route", async () => {
    const completionId = "aask_done_private_wrong_channel";
    const idempotencyKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "email-thread",
      channel: "email",
      idempotencyKey,
      message: "This must never reach a provider.",
      threadIsDirect: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      automationAuthority: null,
      bindingDelivery: { kind: "thread", target: "email-thread" },
      card: null,
      channel: "email",
      deliveryIdempotencyKey: idempotencyKey,
      deliverySource: null,
      emailHtml: null,
      explicitTarget: null,
      externalThreadRouteAuthority: null,
      intentId: effect.effectId,
      media: [],
      message: "This must never reach a provider.",
      operation: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
      subject: null,
      threadIsDirect: true,
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    const failedIntent = {
      ...storedIntent,
      lastError: {
        code: "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_PROOF_INVALID",
        message: "Private Assistant Ask completion outbox proof is invalid.",
      },
      status: "failed" as const,
    };
    mocks.markAssistantOutboxIntentMirrorTerminalById.mockResolvedValueOnce(
      failedIntent,
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dispatchHooks }) => {
        const preflight = await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        expect(preflight).toEqual({
          action: "stop",
          intent: failedIntent,
        });
        return createDispatchResult(
          failedIntent,
          failedIntent.lastError,
        );
      },
    );
    const sendEmail = vi.fn(async () => undefined);

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
      forwardedEnv: {},
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryErrorCode:
          "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_PROOF_INVALID",
        deliveryStatus: "failed",
      }),
    ]);
    expect(
      mocks.markAssistantOutboxIntentMirrorTerminalById,
    ).toHaveBeenCalledWith(expect.objectContaining({
      intentId: storedIntent.intentId,
      onlyCurrentStatuses: ["pending", "retryable"],
      status: "failed",
    }));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("blocks a reviewed Telegram completion whose persisted route authority is missing", async () => {
    const completionId = "aask_done_telegram_missing_authority";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const reviewedAnswer = "Reviewed private answer that must not be sent.";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "telegram_group_123",
      idempotencyKey,
      message: reviewedAnswer,
      threadId: "telegram_group_123",
      threadIsDirect: false,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      bindingDelivery: {
        kind: "thread",
        target: "telegram_group_123",
      },
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      externalThreadRouteAuthority: null,
      intentId: effect.effectId,
      media: [],
      message: reviewedAnswer,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState(storedIntent),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendTelegram({
          idempotencyKey,
          message: reviewedAnswer,
          replyToMessageId: null,
          target: "telegram_group_123",
        });
        throw new Error("unreachable without reviewed completion authority");
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      context: expect.objectContaining({ retryable: false }),
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("retries a stale reviewed Telegram answer with the durable fixed fallback", async () => {
    const completionId = "aask_done_telegram_stale_authority";
    const expiresAt = "2099-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const reviewedAnswer = "Reviewed private answer that must not be sent.";
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      idempotencyKey,
      message: reviewedAnswer,
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
    });
    let storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      bindingDelivery: {
        kind: "thread",
        target: routeAuthority.threadId,
      },
      channel: "telegram",
      deliveryIdempotencyKey: idempotencyKey,
      externalThreadRouteAuthority: routeAuthority,
      intentId: effect.effectId,
      media: [],
      message: reviewedAnswer,
      operation: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
    }) as AssistantOutboxIntent;
    const mirrorReadMessages: string[] = [];
    mocks.readAssistantOutboxIntentMirrorState.mockImplementation(async () => {
      mirrorReadMessages.push(storedIntent.message);
      return createMirrorState(storedIntent);
    });
    mocks.readAssistantOutboxIntent.mockImplementation(async () => storedIntent);
    mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
      async ({ intent }) => {
        storedIntent = intent;
        return { applied: true, intent };
      },
    );
    mocks.sendTelegramMessage.mockResolvedValue({
      providerMessageId: "provider_safe_fallback",
      target: routeAuthority.threadId,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementation(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: storedIntent.message,
          replyToMessageId: null,
          target: routeAuthority.threadId,
        });
        return createDispatchResult({
          delivery: createDelivery({
            idempotencyKey,
            messageLength: storedIntent.message.length,
            providerMessageId: delivery.providerMessageId,
            target: delivery.target,
            targetKind: "thread",
          }),
          status: "sent",
        });
      },
    );
    const assertExternalThreadRouteAuthority = vi.fn(
      async (_authority: unknown, input?: {
        assistantAskCompletion?: {
          assistantAskFallback: boolean;
        } | null;
      }) => input?.assistantAskCompletion?.assistantAskFallback === true
        ? {}
        : { assistantAskFallbackRequired: true },
    );
    const drain = () => drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    await expect(drain()).rejects.toMatchObject({
      code: "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
    });

    expect(storedIntent).toMatchObject({
      media: [],
      message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
    });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    storedIntent = {
      ...storedIntent,
      status: "retryable",
      updatedAt: "2026-04-08T00:00:45.000Z",
    };

    await expect(drain()).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);
    expect(mirrorReadMessages).toEqual([
      reviewedAnswer,
      HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
    ]);
    expect(assertExternalThreadRouteAuthority.mock.calls.map(([, context]) =>
      context?.assistantAskCompletion?.assistantAskFallback
    )).toEqual([false, true]);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      {
        idempotencyKey,
        message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
        replyToMessageId: null,
        target: routeAuthority.threadId,
      },
      expect.objectContaining({
        authorityBoundTarget: routeAuthority.threadId,
      }),
    );
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: reviewedAnswer }),
      expect.anything(),
    );
  });

  it("carries the exact Telegram group route into image and reaction transports", async () => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "-100123456789",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: "intent_123",
        lastError: null,
        status: "pending",
      }),
    );
    mocks.setTelegramMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      target: routeAuthority.threadId,
      targetMessageId: "message_123",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        const setTelegramMessageReaction =
          dependencies.setTelegramMessageReaction;
        const sendTelegramImage = dependencies.sendTelegramImage;
        if (!setTelegramMessageReaction || !sendTelegramImage) {
          throw new Error("Expected hosted Telegram image and reaction transports.");
        }
        await setTelegramMessageReaction({
          reaction: "heart",
          target: routeAuthority.threadId,
          targetMessageId: "message_123",
        });
        await sendTelegramImage({
          media: [{
            alt: "Private chart",
            kind: "image",
            source: "test",
            url: "https://cdn.example.test/private.png",
          }],
          message: "Private chart",
          target: routeAuthority.threadId,
        });
        throw new Error("unreachable after migrated image target");
      },
    );
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        description: "group chat migrated",
        error_code: 400,
        ok: false,
        parameters: { migrate_to_chat_id: "-100987654321" },
      }, { status: 400 })
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE",
      deliveryMayHaveSucceeded: false,
      retryable: false,
    });

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(2);
    expect(mocks.setTelegramMessageReaction).toHaveBeenCalledWith(
      expect.objectContaining({ target: routeAuthority.threadId }),
      expect.objectContaining({ authorityBoundTarget: routeAuthority.threadId }),
    );
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { audience: "direct", threadIsDirect: true },
    { audience: "group", threadIsDirect: false },
  ])("blocks Telegram $audience provider entry when the live route owner revokes the composed target", async ({
    threadIsDirect,
  }) => {
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      threadId: routeAuthority.threadId,
      threadIsDirect,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: "intent_123",
        lastError: null,
        status: "pending",
      }),
    );
    const routeRevoked = Object.assign(new Error("route revoked"), {
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      context: { retryable: false, status: 403 },
      retryable: false,
    });
    const assertExternalThreadRouteAuthority = vi.fn()
      .mockRejectedValueOnce(routeRevoked);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendTelegram({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        replyToMessageId: null,
        target: routeAuthority.threadId,
      });
      throw new Error("unreachable after route revocation");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      retryable: false,
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("records tracked phone-call result provider entry and success before returning the outcome", async () => {
    const idempotencyKey =
      "phone-call-result:hpc_result_delivery:generation:2";
    const target = "telegram_result_delivery";
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: HOSTED_WAKE.wake.userId,
      threadId: target,
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      threadId: target,
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: "The call is complete.",
          replyToMessageId: null,
          target,
        });
        const acceptedDelivery = createDelivery({
          idempotencyKey,
          providerMessageId: delivery.providerMessageId,
          target,
          targetKind: "thread",
        });
        await dispatchHooks?.confirmTerminalIntent?.({
          intent: createPendingHostedDeliveryIntent({
            delivery: acceptedDelivery,
            deliveryConfirmationPending: true,
            deliveryIdempotencyKey: idempotencyKey,
            intentId: effect.effectId,
            status: "retryable",
          }) as AssistantOutboxIntent,
          outcome: {
            delivery: acceptedDelivery,
            deliveryError: null,
            status: "sent",
          },
          vault: HOSTED_WAKE.vaultRoot,
        });
        return createDispatchResult({
          delivery: acceptedDelivery,
          status: "sent",
        });
      },
    );
    const recordPhoneCallResultDeliveryOutcome = vi.fn(async () => undefined);
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>(async () => Response.json({
      ok: true,
      result: { message_id: 701 },
    }));

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
        recordPhoneCallResultDeliveryOutcome,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenNthCalledWith(1, {
      generation: 2,
      phoneCallId: "hpc_result_delivery",
      routeAuthority,
      status: "sending",
    }, { signal: null });
    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenNthCalledWith(2, {
      deliveryErrorCode: null,
      generation: 2,
      phoneCallId: "hpc_result_delivery",
      status: "sent",
    }, { signal: null });
    expect(
      recordPhoneCallResultDeliveryOutcome.mock.invocationCallOrder[0],
    ).toBeLessThan(providerFetch.mock.invocationCallOrder[0] ?? 0);
    expect(assertExternalThreadRouteAuthority).not.toHaveBeenCalled();
  });

  it("preserves a tracked phone-call result receipt when liveness fails after Telegram accepts it", async () => {
    const abortController = new AbortController();
    const idempotencyKey =
      "phone-call-result:hpc_result_delivery:generation:6";
    const target = "telegram_result_delivery";
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: HOSTED_WAKE.wake.userId,
      threadId: target,
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      threadId: target,
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.sendTelegramMessage.mockImplementationOnce(
      async (_request, dependencies) => {
        await dependencies.fetchImplementation?.(
          "https://telegram.example/bot-token/sendMessage",
          { method: "POST" },
        );
        abortController.abort(
          new Error("lease expired after Telegram accepted the result"),
        );
        return createDelivery({
          idempotencyKey,
          providerMessageId: "telegram_accepted_result",
          target,
          targetKind: "thread",
        });
      },
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: "The call is complete.",
          replyToMessageId: null,
          target,
        });
        const acceptedDelivery = createDelivery({
          idempotencyKey,
          providerMessageId: delivery.providerMessageId,
          target,
          targetKind: "thread",
        });
        await dispatchHooks?.confirmTerminalIntent?.({
          intent: createPendingHostedDeliveryIntent({
            delivery: acceptedDelivery,
            deliveryConfirmationPending: true,
            deliveryIdempotencyKey: idempotencyKey,
            intentId: effect.effectId,
            status: "retryable",
          }) as AssistantOutboxIntent,
          outcome: {
            delivery: acceptedDelivery,
            deliveryError: null,
            status: "sent",
          },
          vault: HOSTED_WAKE.vaultRoot,
        });
        return createDispatchResult({
          delivery: acceptedDelivery,
          status: "sent",
        });
      },
    );
    const recordPhoneCallResultDeliveryOutcome = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>(async () => {
      return Response.json({
        ok: true,
        result: { message_id: 706 },
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordPhoneCallResultDeliveryOutcome,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      signal: abortController.signal,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenNthCalledWith(1, {
      generation: 6,
      phoneCallId: "hpc_result_delivery",
      routeAuthority,
      status: "sending",
    }, { signal: abortController.signal });
    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenNthCalledWith(2, {
      deliveryErrorCode: null,
      generation: 6,
      phoneCallId: "hpc_result_delivery",
      status: "sent",
    }, { signal: abortController.signal });
  });

  it("keeps tracked phone-call result delivery retryable when provider-entry recording is unavailable", async () => {
    const idempotencyKey =
      "phone-call-result:hpc_result_delivery:generation:1";
    const target = "telegram_result_delivery";
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      threadId: target,
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: {
          channel: "telegram",
          containerMemberId: HOSTED_WAKE.wake.userId,
          threadId: target,
        },
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendTelegram({
          idempotencyKey,
          message: "The call is complete.",
          replyToMessageId: null,
          target,
        });
        throw new Error("unreachable after missing delivery recorder");
      },
    );
    const providerFetch = vi.fn<typeof fetch>();

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority: vi.fn(async () => undefined),
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_PHONE_CALL_RESULT_DELIVERY_OUTCOME_UNAVAILABLE",
      context: expect.objectContaining({ retryable: true }),
    });

    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("revalidates and resumes when provider-entry recording committed but its response was lost", async () => {
    const idempotencyKey =
      "phone-call-result:hpc_result_delivery:generation:5";
    const target = "telegram_result_delivery";
    const routeAuthority = {
      channel: "telegram" as const,
      containerMemberId: HOSTED_WAKE.wake.userId,
      threadId: target,
    };
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      threadId: target,
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: routeAuthority,
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementation(
      async ({ dependencies }) => {
        const delivery = await dependencies.sendTelegram({
          idempotencyKey,
          message: "The call is complete.",
          replyToMessageId: null,
          target,
        });
        return createDispatchResult({
          delivery: createDelivery({
            idempotencyKey,
            providerMessageId: delivery.providerMessageId,
            target,
            targetKind: "thread",
          }),
          status: "sent",
        });
      },
    );
    let providerEntryAttempts = 0;
    const recordPhoneCallResultDeliveryOutcome = vi.fn(
      async (request: HostedPhoneCallResultDeliveryOutcomeRequest) => {
        if (request.status === "sending") {
          providerEntryAttempts += 1;
          if (providerEntryAttempts === 1) {
            throw new VaultCliError(
              "HOSTED_CALLBACK_RESPONSE_LOST",
              "The committed callback response was lost.",
              { retryable: true },
            );
          }
        }
      },
    );
    const providerFetch = vi.fn<typeof fetch>(async () => Response.json({
      ok: true,
      result: { message_id: 702 },
    }));
    const drain = () => drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordPhoneCallResultDeliveryOutcome,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    await expect(drain()).rejects.toMatchObject({
      code: "ASSISTANT_PHONE_CALL_RESULT_DELIVERY_OUTCOME_RECORDING_FAILED",
    });
    expect(providerFetch).not.toHaveBeenCalled();

    await expect(drain()).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(recordPhoneCallResultDeliveryOutcome.mock.calls.filter(
      ([request]) => request.status === "sending",
    )).toHaveLength(2);
  });

  it("returns a tracked result to pending when exact Telegram route authority is revoked before provider entry", async () => {
    const idempotencyKey =
      "phone-call-result:hpc_result_delivery:generation:3";
    const target = "telegram_result_delivery";
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: target,
      idempotencyKey,
      threadId: target,
      threadIsDirect: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValueOnce(
      createMirrorState({
        delivery: null,
        externalThreadRouteAuthority: {
          channel: "telegram",
          containerMemberId: HOSTED_WAKE.wake.userId,
          threadId: target,
        },
        intentId: effect.effectId,
        lastError: null,
        status: "pending",
      }),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        try {
          await dependencies.sendTelegram({
            idempotencyKey,
            message: "The call is complete.",
            replyToMessageId: null,
            target,
          });
          throw new Error("unreachable after route revocation");
        } catch (error) {
          const deliveryError = mocks.normalizeAssistantDeliveryError(error);
          const intent = createPendingHostedDeliveryIntent({
            deliveryConfirmationPending: true,
            deliveryIdempotencyKey: idempotencyKey,
            intentId: effect.effectId,
            lastError: deliveryError,
            status: "retryable",
          }) as AssistantOutboxIntent;
          await dispatchHooks?.confirmTerminalIntent?.({
            intent,
            outcome: {
              delivery: null,
              deliveryError,
              status: "failed",
            },
            vault: HOSTED_WAKE.vaultRoot,
          });
          return createDispatchResult({
            ...intent,
            status: "failed",
          }, deliveryError);
        }
      },
    );
    const routeError = new VaultCliError(
      "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      "The Telegram route was revoked.",
      { retryable: false },
    );
    const recordPhoneCallResultDeliveryOutcome = vi.fn(
      async (request: HostedPhoneCallResultDeliveryOutcomeRequest) => {
        if (request.status === "sending") {
          throw routeError;
        }
      },
    );
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>();

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
        recordPhoneCallResultDeliveryOutcome,
      }),
      forwardedEnv: {},
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-actual-runtime-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryErrorCode: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        deliveryStatus: "failed",
      }),
    ]);

    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenCalledWith({
      deliveryErrorCode: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      generation: 3,
      phoneCallId: "hpc_result_delivery",
      status: "failed",
    }, { signal: null });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
    expect(assertExternalThreadRouteAuthority).not.toHaveBeenCalled();
  });

  it.each([
    {
      deliveryErrorCode: "ASSISTANT_DELIVERY_RETRY_EXHAUSTED",
      expectedStatus: "failed" as const,
      outboxStatus: "failed",
    },
    {
      deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
      expectedStatus: "failed" as const,
      outboxStatus: "failed",
    },
    {
      deliveryErrorCode: "ASSISTANT_TELEGRAM_TOKEN_REQUIRED",
      expectedStatus: "failed" as const,
      outboxStatus: "failed",
    },
    {
      deliveryErrorCode: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      expectedStatus: "failed" as const,
      outboxStatus: "failed",
    },
    {
      deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
      expectedStatus: "failed_ambiguous" as const,
      outboxStatus: "abandoned",
    },
  ])("records tracked phone-call $outboxStatus outcomes on the exact generation", async ({
    deliveryErrorCode,
    expectedStatus,
    outboxStatus,
  }) => {
    const effect = createEffect({
      idempotencyKey:
        "phone-call-result:hpc_result_delivery:generation:4",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dispatchHooks }) => {
        const deliveryError = {
          code: deliveryErrorCode,
          message: "bounded delivery failure",
        };
        const intent = createPendingHostedDeliveryIntent({
          deliveryConfirmationPending: true,
          deliveryIdempotencyKey:
            "phone-call-result:hpc_result_delivery:generation:4",
          intentId: effect.effectId,
          lastError: deliveryError,
          status: "retryable",
        }) as AssistantOutboxIntent;
        await dispatchHooks?.confirmTerminalIntent?.({
          intent,
          outcome: {
            delivery: null,
            deliveryError,
            status: expectedStatus,
          },
          vault: HOSTED_WAKE.vaultRoot,
        });
        return createDispatchResult({
          ...intent,
          status: outboxStatus,
        }, deliveryError);
      },
    );
    const recordPhoneCallResultDeliveryOutcome = vi.fn(async () => undefined);

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordPhoneCallResultDeliveryOutcome,
      }),
      forwardedEnv: {},
      platformEnv: {},
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryErrorCode,
        deliveryStatus: expectedStatus === "failed"
          ? "failed"
          : "failed_ambiguous",
      }),
    ]);

    expect(recordPhoneCallResultDeliveryOutcome).toHaveBeenCalledWith({
      deliveryErrorCode,
      generation: 4,
      phoneCallId: "hpc_result_delivery",
      status: expectedStatus,
    }, { signal: null });
  });

  it("records a successful Telegram message-volume receipt only after durable delivery persistence", async () => {
    const effect = createEffect();
    const delivery = createDelivery({
      providerMessageId: null,
      providerMessageIds: [
        "provider_message_volume_1",
        "provider_message_volume_2",
      ],
      sentAt: "2026-08-15T19:20:00.000Z",
    });
    const durableIntent = createPendingHostedDeliveryIntent({
      dedupeKey: "a".repeat(40),
      delivery,
      intentId: effect.effectId,
      messageVolumeReceiptRecordedAt: null,
      status: "sending",
    }) as AssistantOutboxIntent;
    const recordedAt = "2026-08-15T19:20:01.000Z";
    let resolveReceipt!: (value: { recordedAt: string }) => void;
    const pendingReceipt = new Promise<{ recordedAt: string }>((resolve) => {
      resolveReceipt = resolve;
    });
    const recordOutboundMessageVolumeReceipt = vi.fn(() => pendingReceipt);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({
      dispatchHooks,
      trackMessageVolumeReceipt,
    }) => {
      expect(trackMessageVolumeReceipt).toBe(true);
      expect(recordOutboundMessageVolumeReceipt).not.toHaveBeenCalled();
      await dispatchHooks?.persistDeliveredIntent?.({
        delivery,
        intent: durableIntent,
        vault: HOSTED_WAKE.vaultRoot,
      });
      return createDispatchResult({
        ...durableIntent,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordOutboundMessageVolumeReceipt,
      }),
      forwardedEnv: {},
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledTimes(1);
    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledWith({
      channel: "telegram",
      dedupeKey: durableIntent.dedupeKey,
    }, {
      signal: expect.any(AbortSignal),
    });
    expect(
      mocks.markAssistantOutboxMessageVolumeReceiptRecorded,
    ).not.toHaveBeenCalled();

    resolveReceipt({ recordedAt });
    await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();

    expect(mocks.markAssistantOutboxMessageVolumeReceiptRecorded).toHaveBeenCalledWith({
      channel: "telegram",
      dedupeKey: durableIntent.dedupeKey,
      intentId: durableIntent.intentId,
      recordedAt,
      vault: HOSTED_WAKE.vaultRoot,
    });
  });

  it("keeps successful delivery independent from message-volume receipt failures", async () => {
    const effect = createEffect();
    const delivery = createDelivery({
      providerMessageId: "provider_message_volume_failure",
      sentAt: "2026-08-15T19:21:00.000Z",
    });
    const durableIntent = createPendingHostedDeliveryIntent({
      dedupeKey: "b".repeat(40),
      delivery,
      intentId: effect.effectId,
      messageVolumeReceiptRecordedAt: null,
      status: "sending",
    }) as AssistantOutboxIntent;
    const recordOutboundMessageVolumeReceipt = vi.fn(async () => {
      throw new Error("receipt endpoint unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({
      dispatchHooks,
    }) => {
      await dispatchHooks?.persistDeliveredIntent?.({
        delivery,
        intent: durableIntent,
        vault: HOSTED_WAKE.vaultRoot,
      });
      return createDispatchResult({
        ...durableIntent,
        status: "sent",
      });
    });

    try {
      const outcomes = await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({
          recordOutboundMessageVolumeReceipt,
        }),
        forwardedEnv: {},
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
      await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();

      expect(outcomes).toEqual([
        expect.objectContaining({
          deliveryStatus: "sent",
          retryable: false,
        }),
      ]);
      expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledTimes(1);
      expect(
        mocks.markAssistantOutboxMessageVolumeReceiptRecorded,
      ).not.toHaveBeenCalled();
      expect(
        mocks.rescheduleAssistantOutboxMessageVolumeReceipt,
      ).toHaveBeenCalledWith({
        dedupeKey: durableIntent.dedupeKey,
        intentId: durableIntent.intentId,
        nextAttemptAt: expect.any(String),
        vault: HOSTED_WAKE.vaultRoot,
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted outbound message-volume receipt recording failed.",
        { errorName: "Error" },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("bounds overlapping pending message-volume receipt retries to eight", async () => {
    const pendingIntents = Array.from({ length: 10 }, (_, index) => {
      const dedupeKey = index.toString(16).padStart(40, "0");
      const intentId = `intent_message_volume_${index}`;
      return createPendingHostedDeliveryIntent({
        dedupeKey,
        delivery: createDelivery({
          idempotencyKey: `assistant-outbox:${intentId}`,
          providerMessageId: `provider_message_volume_${index}`,
          sentAt: `2026-08-15T19:${String(index).padStart(2, "0")}:00.000Z`,
        }),
        intentId,
        messageVolumeReceiptRecordedAt: null,
        status: "sent",
      }) as AssistantOutboxIntent;
    });
    const recordedAt = "2026-08-15T19:30:00.000Z";
    let releaseReceipts!: (value: { recordedAt: string }) => void;
    const pendingReceipt = new Promise<{ recordedAt: string }>((resolve) => {
      releaseReceipts = resolve;
    });
    const recordOutboundMessageVolumeReceipt = vi.fn(
      async (_request: { channel: "email" | "telegram"; dedupeKey: string }) =>
        pendingReceipt,
    );
    mocks.listAssistantOutboxIntents.mockResolvedValue(pendingIntents);
    mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(false);

    const collectionInput = {
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: {
        recordOutboundMessageVolumeReceipt,
      },
      vaultRoot: HOSTED_WAKE.vaultRoot,
    } as const;
    const [effects, overlappingEffects] = await Promise.all([
      collectHostedAssistantDeliverySideEffects(collectionInput),
      collectHostedAssistantDeliverySideEffects(collectionInput),
    ]);

    expect(effects).toEqual([]);
    expect(overlappingEffects).toEqual([]);
    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledTimes(8);
    releaseReceipts({ recordedAt });
    await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();

    expect(recordOutboundMessageVolumeReceipt.mock.calls.map(([request]) =>
      request.dedupeKey
    )).toEqual(pendingIntents.slice(0, 8).map((intent) => intent.dedupeKey));
    expect(mocks.markAssistantOutboxMessageVolumeReceiptRecorded).toHaveBeenCalledTimes(8);
    expect(mocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();

    mocks.listAssistantOutboxIntents.mockResolvedValue(pendingIntents.slice(8));
    await expect(queueHostedAssistantPendingMessageVolumeReceiptsForVault({
      effectsPort: collectionInput.messageVolumeReceiptPort,
      now: new Date("2026-08-15T19:31:00.000Z"),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).resolves.toBe(2);
    await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();

    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledTimes(10);
    expect(mocks.markAssistantOutboxMessageVolumeReceiptRecorded).toHaveBeenCalledTimes(10);
  });

  it("uses sent receipt deadlines without delaying outbound delivery wakes", async () => {
    const dueIntent = createPendingHostedDeliveryIntent({
      dedupeKey: "c".repeat(40),
      delivery: createDelivery({
        providerMessageId: "provider_message_volume_due",
      }),
      intentId: "intent_message_volume_due",
      messageVolumeReceiptRecordedAt: null,
      nextAttemptAt: "2026-08-15T19:39:00.000Z",
      status: "sent",
    }) as AssistantOutboxIntent;
    const futureIntent = createPendingHostedDeliveryIntent({
      dedupeKey: "d".repeat(40),
      delivery: createDelivery({
        providerMessageId: "provider_message_volume_future",
      }),
      intentId: "intent_message_volume_future",
      messageVolumeReceiptRecordedAt: null,
      nextAttemptAt: "2026-08-15T19:45:00.000Z",
      status: "sent",
    }) as AssistantOutboxIntent;
    const readyDeliveryIntent = createPendingHostedDeliveryIntent({
      dedupeKey: "e".repeat(40),
      delivery: null,
      intentId: "intent_ready_delivery",
      nextAttemptAt: "2026-08-15T19:38:00.000Z",
      status: "pending",
    }) as AssistantOutboxIntent;
    const recordOutboundMessageVolumeReceipt = vi.fn(async () => ({
      recordedAt: "2026-08-15T19:40:01.000Z",
    }));
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      dueIntent,
      futureIntent,
      readyDeliveryIntent,
    ]);

    await expect(resolveHostedAssistantOutboxNextWakeAt({
      now: new Date("2026-08-15T19:40:00.000Z"),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).resolves.toBe("2026-08-15T19:38:00.000Z");
    await expect(queueHostedAssistantPendingMessageVolumeReceiptsForVault({
      effectsPort: { recordOutboundMessageVolumeReceipt },
      now: new Date("2026-08-15T19:40:00.000Z"),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).resolves.toBe(1);

    await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledOnce();
    expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledWith({
      channel: "telegram",
      dedupeKey: dueIntent.dedupeKey,
    }, {
      signal: expect.any(AbortSignal),
    });
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
      answeredMailboxItemIds: ["mailbox_item_1"],
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
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({
      dependencies,
      dispatchHooks,
    }) => {
      const delivery = await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_123",
        targetMessageId: "linq_message_1",
      });
      const acceptedDelivery = {
        channel: "linq" as const,
        idempotencyKey: "assistant-outbox:intent_123",
        kind: "message-reaction" as const,
        reaction: delivery.reaction,
        sentAt: "2026-04-08T00:01:00.000Z",
        target: delivery.target,
        targetKind: "thread" as const,
        targetMessageId: delivery.targetMessageId,
      };
      const durableIntent = createPendingHostedDeliveryIntent({
        answeredMailboxItemIds: ["mailbox_item_1"],
        bindingDelivery: { kind: "thread", target: "linq_chat_123" },
        channel: "linq",
        delivery: acceptedDelivery,
        deliveryIdempotencyKey: "assistant-outbox:intent_123",
        explicitTarget: null,
        intentId: effect.effectId,
        message: "",
        operation: { kind: "message-reaction", reaction: "heart" },
        replyToMessageId: "linq_message_1",
        status: "sending",
      }) as AssistantOutboxIntent;
      await dispatchHooks?.persistDeliveredIntent?.({
        delivery: acceptedDelivery,
        intent: durableIntent,
        vault: HOSTED_WAKE.vaultRoot,
      });
      return createDispatchResult({
        ...durableIntent,
        delivery: acceptedDelivery,
        status: "sent",
      });
    });
    const providerFetch = vi.fn<typeof fetch>();

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(mocks.setLinqMessageReaction).toHaveBeenCalledWith({
      reaction: "heart",
      targetMessageId: "linq_message_1",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.any(String),
        answeredMailboxItemIds: ["mailbox_item_1"],
        attemptedAt: expect.any(String),
        idempotencyKey: "assistant-outbox:intent_123",
        intentId: effect.effectId,
        providerMessageId: null,
        providerTarget: "linq_chat_123",
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps an accepted Linq reaction receipt retryable when exact-consume confirmation fails", async () => {
    const effect = createEffect({
      answeredMailboxItemIds: ["mailbox_item_retryable"],
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_retryable",
      message: "",
      replyToMessageId: "linq_message_retryable",
      transportIdempotent: false,
    });
    mocks.setLinqMessageReaction.mockResolvedValueOnce({
      reaction: "heart",
      targetMessageId: "linq_message_retryable",
    });
    const recordDeliveryOutcome = vi.fn(async () => {
      throw new Error("Web confirmation unavailable");
    });
    let confirmationError: unknown = null;
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({
      dependencies,
      dispatchHooks,
    }) => {
      const delivery = await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_retryable",
        targetMessageId: "linq_message_retryable",
      });
      const acceptedDelivery = {
        channel: "linq" as const,
        idempotencyKey: "assistant-outbox:intent_123",
        kind: "message-reaction" as const,
        reaction: delivery.reaction,
        sentAt: "2026-04-08T00:01:00.000Z",
        target: delivery.target,
        targetKind: "thread" as const,
        targetMessageId: delivery.targetMessageId,
      };
      const durableIntent = createPendingHostedDeliveryIntent({
        answeredMailboxItemIds: ["mailbox_item_retryable"],
        bindingDelivery: { kind: "thread", target: "linq_chat_retryable" },
        channel: "linq",
        delivery: acceptedDelivery,
        deliveryIdempotencyKey: acceptedDelivery.idempotencyKey,
        explicitTarget: null,
        intentId: effect.effectId,
        message: "",
        operation: { kind: "message-reaction", reaction: "heart" },
        replyToMessageId: "linq_message_retryable",
        status: "sending",
      }) as AssistantOutboxIntent;
      try {
        await dispatchHooks?.persistDeliveredIntent?.({
          delivery: acceptedDelivery,
          intent: durableIntent,
          vault: HOSTED_WAKE.vaultRoot,
        });
      } catch (error) {
        confirmationError = error;
        return createDispatchResult({
          ...durableIntent,
          lastError: {
            code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
            message: "Accepted reaction exact-consume confirmation is pending.",
          },
          status: "retryable",
        }, {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "Accepted reaction exact-consume confirmation is pending.",
        });
      }

      throw new Error("Expected exact-consume confirmation to fail.");
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

    expect(confirmationError).toMatchObject({
      code: "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
      deliveryMayHaveSucceeded: true,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "retryable",
        retryable: true,
      }),
    ]);
    expect(mocks.setLinqMessageReaction).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.any(String),
        answeredMailboxItemIds: ["mailbox_item_retryable"],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("confirms a retained Linq reaction receipt after auto-reply is revoked without replaying provider or route authority", async () => {
    const effect = createEffect({
      answeredMailboxItemIds: ["mailbox_item_retry"],
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_retry",
      message: "",
      replyToMessageId: "linq_message_retry",
      transportIdempotent: false,
    });
    const acceptedDelivery = {
      channel: "linq" as const,
      idempotencyKey: "assistant-outbox:intent_123",
      kind: "message-reaction" as const,
      reaction: "heart" as const,
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "linq_chat_retry",
      targetKind: "thread" as const,
      targetMessageId: "linq_message_retry",
    };
    const storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: ["mailbox_item_retry"],
      bindingDelivery: { kind: "thread", target: "linq_chat_retry" },
      channel: "linq",
      delivery: acceptedDelivery,
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      explicitTarget: null,
      intentId: effect.effectId,
      message: "",
      operation: { kind: "message-reaction", reaction: "heart" },
      replyToMessageId: "linq_message_retry",
      status: "retryable",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(storedIntent),
    );
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(
      new Set([effect.effectId]),
    );
    mocks.hasAssistantAutoReplyChannel.mockReturnValue(false);
    mocks.readAssistantAutomationState.mockResolvedValue({ autoReply: [] });
    const assertRecentInbound = vi.fn(async () => {
      throw new Error("route authority must not be re-entered");
    });
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({
      dependencies,
      dispatchHooks,
    }) => {
      await expect(dispatchHooks?.preflightDispatchIntent?.({
        intent: storedIntent,
        now: new Date("2026-04-08T00:02:00.000Z"),
        vault: HOSTED_WAKE.vaultRoot,
      })).resolves.toEqual({ action: "continue" });
      const resolved = await dispatchHooks?.resolveDeliveredIntent?.({
        intent: storedIntent,
        vault: HOSTED_WAKE.vaultRoot,
      });
      expect(dependencies.setLinqMessageReaction).toBeDefined();
      return createDispatchResult({
        ...storedIntent,
        delivery: resolved,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
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
        deliveryStatus: "sent",
        retryable: false,
      }),
    ]);
    expect(assertRecentInbound).not.toHaveBeenCalled();
    expect(mocks.setLinqMessageReaction).not.toHaveBeenCalled();
    expect(mocks.findAssistantAutoReplyDeliveryIntentIds).not.toHaveBeenCalled();
    expect(mocks.readAssistantAutomationState).not.toHaveBeenCalled();
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).not.toHaveBeenCalled();
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: acceptedDelivery.sentAt,
        answeredMailboxItemIds: ["mailbox_item_retry"],
        attemptedAt: acceptedDelivery.sentAt,
        idempotencyKey: acceptedDelivery.idempotencyKey,
        intentId: effect.effectId,
        providerTarget: acceptedDelivery.target,
        target: acceptedDelivery.target,
        targetKind: "thread",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("blocks routed Linq reactions when the final provider claim loses route authority", async () => {
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
    const assertRecentInbound = vi.fn()
      .mockImplementationOnce(async (request) =>
        buildClaimedLinqEngagementResult(request)
      )
      .mockRejectedValueOnce(new Error("route revoked"));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.setLinqMessageReaction({
        reaction: "heart",
        target: "linq_chat_123",
        targetMessageId: "linq_message_1",
      });

      throw new Error("unreachable after egress authority failure");
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

    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    expect(assertRecentInbound.mock.calls.map(([request]) =>
      request.authorityCheckOnly
    )).toEqual([true, false]);
    expect(assertRecentInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: routeAuthority.threadId }),
      { signal: null },
    );
    expect(mocks.setLinqMessageReaction).not.toHaveBeenCalled();
  });

  it("fails closed when the Web response lacks the provider-claim protocol marker", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async (request) => ({
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request),
    }));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendLinq({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        target: "linq_chat_123",
        targetKind: "thread",
      });
      throw new Error("unreachable without the provider-claim marker");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_PROVIDER_DISPATCH_PROTOCOL_UNAVAILABLE",
    });

    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    expect(assertRecentInbound.mock.calls.map(([request]) =>
      request.authorityCheckOnly
    )).toEqual([true, false]);
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("fails closed before capability or provider access when Web lacks the canonical-route protocol", async () => {
    const assertRecentInbound = vi.fn(async () => ({}));
    const persistAppCardTextFallback = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>();
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
    });

    await expect(dependencies.sendLinq!({
      card: HOSTED_LINQ_RESPONSE_CARD,
      idempotencyKey: "assistant-outbox:legacy-web-card",
      message: "Private nutrition summary",
      persistAppCardTextFallback,
      target: "linq_chat_legacy",
      targetKind: "thread",
      threadIsDirect: true,
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_RESOLVED_ROUTE_PROTOCOL_UNAVAILABLE",
    });

    expect(assertRecentInbound).toHaveBeenCalledOnce();
    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityCheckOnly: true,
        target: "linq_chat_legacy",
        targetKind: "thread",
      }),
      { signal: null },
    );
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(persistAppCardTextFallback).not.toHaveBeenCalled();
    expect(recordDeliveryOutcome).not.toHaveBeenCalled();
  });

  it("blocks changed Linq health at provider entry before any provider message request", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      transportIdempotent: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      bindingDelivery: { kind: "thread", target: "linq_chat_123" },
      channel: "linq",
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: effect.effectId,
      message: "scheduled check-in",
    }) as AssistantOutboxIntent;
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      directRecipientPhoneNumber?: string | null;
      fromPhoneNumber?: string | null;
      target: string | null;
      targetKind?: "explicit" | "participant" | "thread" | null;
    }) => request.authorityCheckOnly
      ? { resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request) }
      : {
          deliveryBlockCode: "chat_critical" as const,
          resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request),
        });
    const providerFetch = vi.fn<typeof fetch>();
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:01:00.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_123",
          message: storedIntent.message,
          target: "linq_chat_123",
          targetKind: "thread",
        });
        throw new Error("unreachable after the provider-entry health block");
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_EGRESS_CHAT_CRITICAL",
    });

    expect(assertRecentInbound.mock.calls.map(([request]) =>
      request.authorityCheckOnly
    )).toEqual([true, false]);
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(providerFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/typing$/u),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("resolves an actorless scheduled private card through Web and sends one native app card", async () => {
    const idempotencyKey = "assistant-outbox:scheduled-private-nutrition-card";
    const resolvedRoute = buildHostedRuntimeResolvedLinqRoute({
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
      target: "linq_chat_home",
      targetKind: "thread",
    }, {
      conversationThreadId: "linq:member_123:phone_lookup_123:linq_chat_home",
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      target: "linq_chat_home",
      targetKind: "thread",
      threadIsDirect: true,
    });
    const assertRecentInbound = vi.fn(async (request) => {
      if (request.expectedResolvedRoute) {
        expect(request.expectedResolvedRoute).toEqual(resolvedRoute);
        expect(request.homeRouteFallbackAllowed).toBe(false);
        expect(request.target).toBe(resolvedRoute.target);
        expect(request.targetKind).toBe(resolvedRoute.targetKind);
      } else {
        expect(request).toMatchObject({
          authorityCheckOnly: true,
          directRecipientPhoneNumber: null,
          fromPhoneNumber: null,
          homeRouteFallbackAllowed: true,
          target: "linq_chat_stale_hint",
          targetKind: "thread",
        });
      }
      return {
        ...(request.authorityCheckOnly
          ? {}
          : { providerDispatchClaimed: true }),
        resolvedRoute,
      };
    });
    const providerMessageBodies: Array<{
      message?: {
        parts?: Array<{ type?: string; value?: string }>;
      };
    }> = [];
    const capabilityBodies: Array<{ address?: string; from?: string }> = [];
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        address?: string;
        from?: string;
        message?: {
          parts?: Array<{ type?: string; value?: string }>;
        };
      };
      if (url.pathname.endsWith("/capability/check_imessage")) {
        capabilityBodies.push(body);
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      providerMessageBodies.push(body);
      return new Response(JSON.stringify({ message: { id: "linq_card_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const persistAppCardTextFallback = vi.fn(async () => undefined);
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
    });
    const sendLinq = dependencies.sendLinq!;

    await expect(sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
      homeRouteFallbackAllowed: true,
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback,
      target: "linq_chat_stale_hint",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      providerMessageId: "linq_card_1",
      target: "linq_chat_home",
    });

    expect(assertRecentInbound.mock.calls.map(([request]) => ({
      authorityCheckOnly: request.authorityCheckOnly,
      hasExpectedRoute: Boolean(request.expectedResolvedRoute),
    }))).toEqual([
      { authorityCheckOnly: true, hasExpectedRoute: false },
      { authorityCheckOnly: true, hasExpectedRoute: true },
      { authorityCheckOnly: false, hasExpectedRoute: true },
    ]);
    expect(capabilityBodies).toEqual([{
      address: "+15550001",
      from: "+15550002",
    }]);
    expect(providerMessageBodies).toHaveLength(1);
    expect(providerMessageBodies[0]?.message?.parts).toEqual([
      expect.objectContaining({ type: "imessage_app" }),
    ]);
    expect(providerMessageBodies[0]?.message?.parts?.some((part) =>
      part.type === "text" || typeof part.value === "string"
    )).toBe(false);
    expect(persistAppCardTextFallback).not.toHaveBeenCalled();
    expect(recordDeliveryOutcome).toHaveBeenCalledOnce();
  });

  it("rechecks Linq authority after capability lookup before the card mutation", async () => {
    const idempotencyKey = "assistant-outbox:card-authority-revoked";
    const events: string[] = [];
    let authorityRevoked = false;
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        `authority:${request.authorityCheckOnly ? "read" : "claim"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
      return request.authorityCheckOnly || !authorityRevoked
        ? buildClaimedLinqEngagementResult(request)
        : {
            deliveryBlockCode: "chat_opted_out" as const,
            resolvedRoute: buildHostedRuntimeResolvedLinqRoute({
              ...request,
              target: null,
            }),
          };
    });
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    const providerFetch = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        events.push("provider:capability");
        authorityRevoked = true;
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      events.push("provider:message");
      return new Response(JSON.stringify({ message: { id: "unexpected" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    let capturedError: unknown;
    try {
      await dependencies.sendLinq({
        card: HOSTED_LINQ_RESPONSE_CARD,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        idempotencyKey,
        message: "Nutrition summary",
        persistAppCardTextFallback: vi.fn(),
        target: "linq_chat_123",
        targetKind: "thread",
        threadIsDirect: true,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(events).toEqual([
      `authority:read:${idempotencyKey}`,
      `authority:read:${idempotencyKey}`,
      "provider:capability",
      `authority:claim:${idempotencyKey}`,
    ]);
    expect(capturedError).toMatchObject({
      code: "ASSISTANT_LINQ_EGRESS_CHAT_OPTED_OUT",
    });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).not.toHaveBeenCalled();
  });

  it("claims the original Linq identity only after an unavailable capability fallback persists", async () => {
    const idempotencyKey = "assistant-outbox:card-capability-unavailable";
    const events: string[] = [];
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        `authority:${request.authorityCheckOnly ? "read" : "claim"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
      return buildClaimedLinqEngagementResult(request);
    });
    const recordDeliveryOutcome = vi.fn(async (request: {
      acceptedAt?: string | null;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        `outcome:${request.acceptedAt ? "accepted" : "failed"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
    });
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        events.push("provider:capability");
        return new Response(JSON.stringify({
          address: "+15550001",
          available: false,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
      };
      events.push(`provider:text:${body.message?.idempotency_key ?? "none"}`);
      expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
        .toBe(false);
      return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const persistAppCardTextFallback = vi.fn(async (fallback: {
      idempotencyKey: string;
    }) => {
      events.push(`persist:${fallback.idempotencyKey}`);
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback,
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      idempotencyKey,
      providerMessageId: "linq_text_1",
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(events).toEqual([
      `authority:read:${idempotencyKey}`,
      `authority:read:${idempotencyKey}`,
      "provider:capability",
      `persist:${idempotencyKey}`,
      `authority:claim:${idempotencyKey}`,
      `provider:text:${idempotencyKey}`,
      `outcome:accepted:${idempotencyKey}`,
    ]);
  });

  it("writes one bounded runtime log entry when a capability error selects text recovery", async () => {
    const idempotencyKey = "assistant-outbox:card-capability-error-log";
    const logWrite = vi.fn<HostedRuntimeLogPort["write"]>(async () => ({ loggedCount: 1 }));
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        return new Response("Forbidden", { status: 403 });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { parts?: Array<{ type?: string }> };
      };
      expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
        .toBe(false);
      return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)
        ),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      platform: { logPort: { write: logWrite } },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback: vi.fn(async () => undefined),
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      providerMessageId: "linq_text_1",
    });

    expect(logWrite).toHaveBeenCalledTimes(1);
    const entries = logWrite.mock.calls[0]?.[0]?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      component: "outbox",
      errorCode: "LINQ_API_REQUEST_FAILED",
      eventCode: "outbox.linq_app_card_fallback_error",
      level: "warn",
      phase: "outbox",
      redactedJson: {
        errorStatus: 403,
        fallbackKind: "text",
        reason: "capability_check_failed",
      },
    });
    const serializedEntry = JSON.stringify(entries[0]);
    expect(serializedEntry).not.toContain("+15550001");
    expect(serializedEntry).not.toContain("+15550002");
    expect(serializedEntry).not.toContain("linq_chat_123");
    expect(serializedEntry).not.toContain(idempotencyKey);
    expect(serializedEntry).not.toContain("linq-actual-runtime-token");
    expect(serializedEntry).not.toContain("Forbidden");
  });

  it("keeps text recovery ahead of a failing runtime log write after an app-card rejection", async () => {
    const idempotencyKey = "assistant-outbox:card-rejected-log-failure";
    const events: string[] = [];
    const logWrite = vi.fn<HostedRuntimeLogPort["write"]>(async () => {
      throw new Error("log endpoint unavailable");
    });
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
      };
      if (body.message?.parts?.some((part) => part.type === "imessage_app")) {
        events.push("provider:app-card");
        return new Response(JSON.stringify({ error: "unsupported app card" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      events.push(`provider:text:${body.message?.idempotency_key ?? "none"}`);
      return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const persistAppCardTextFallback = vi.fn(async (fallback: {
      idempotencyKey: string;
    }) => {
      events.push(`persist:${fallback.idempotencyKey}`);
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)
        ),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      platform: { logPort: { write: logWrite } },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback,
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      providerMessageId: "linq_text_1",
    });

    expect(events).toEqual([
      "provider:app-card",
      `persist:${idempotencyKey}:fallback`,
      `provider:text:${idempotencyKey}:fallback`,
    ]);
    expect(logWrite).toHaveBeenCalledTimes(1);
    const entries = logWrite.mock.calls[0]?.[0]?.entries ?? [];
    expect(entries[0]).toMatchObject({
      component: "outbox",
      errorCode: "LINQ_API_REQUEST_FAILED",
      eventCode: "outbox.linq_app_card_fallback_error",
      level: "warn",
      phase: "outbox",
      redactedJson: {
        errorStatus: 400,
        fallbackKind: "text",
        reason: "app_card_rejected",
      },
    });
    const serializedEntry = JSON.stringify(entries[0]);
    expect(serializedEntry).not.toContain("unsupported app card");
    expect(serializedEntry).not.toContain(idempotencyKey);
  });

  it("bounds a malformed capability response to a classification-only log entry", async () => {
    const idempotencyKey = "assistant-outbox:card-capability-malformed-json";
    const logWrite = vi.fn<HostedRuntimeLogPort["write"]>(async () => ({ loggedCount: 1 }));
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        return new Response("LEAKMARKER private provider prose", {
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { parts?: Array<{ type?: string }> };
      };
      expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
        .toBe(false);
      return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)
        ),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      platform: { logPort: { write: logWrite } },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback: vi.fn(async () => undefined),
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      providerMessageId: "linq_text_1",
    });

    expect(logWrite).toHaveBeenCalledTimes(1);
    const entries = logWrite.mock.calls[0]?.[0]?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      component: "outbox",
      errorCode: "LINQ_API_REQUEST_FAILED",
      eventCode: "outbox.linq_app_card_fallback_error",
      level: "warn",
      phase: "outbox",
      redactedJson: {
        fallbackKind: "text",
        reason: "capability_check_failed",
      },
    });
    const serializedEntry = JSON.stringify(entries[0]);
    expect(serializedEntry).not.toContain("LEAKMARKER");
    expect(serializedEntry).not.toContain("+15550001");
    expect(serializedEntry).not.toContain(idempotencyKey);
  });

  it("writes no runtime log entry for an expected unavailable capability result", async () => {
    const idempotencyKey = "assistant-outbox:card-capability-unavailable-silent";
    const logWrite = vi.fn<HostedRuntimeLogPort["write"]>(async () => ({ loggedCount: 1 }));
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({
          address: "+15550001",
          available: false,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { parts?: Array<{ type?: string }> };
      };
      expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
        .toBe(false);
      return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)
        ),
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      platform: { logPort: { write: logWrite } },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback: vi.fn(async () => undefined),
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      providerMessageId: "linq_text_1",
    });

    expect(logWrite).not.toHaveBeenCalled();
  });

  it("uses the persisted text fallback immediately after the first capability rate limit", async () => {
    vi.useFakeTimers();
    try {
      const idempotencyKey = "assistant-outbox:card-capability-rate-limited";
      const events: string[] = [];
      let capabilityRequestCount = 0;
      const assertRecentInbound = vi.fn(async (request: {
        authorityCheckOnly: boolean;
        idempotencyKey?: string | null;
      }) => {
        events.push(
          "authority:"
          + (request.authorityCheckOnly ? "read" : "claim")
          + ":"
          + (request.idempotencyKey ?? "none"),
        );
        return buildClaimedLinqEngagementResult(request);
      });
      const recordDeliveryOutcome = vi.fn(async (request: {
        acceptedAt?: string | null;
        idempotencyKey?: string | null;
      }) => {
        events.push(
          "outcome:"
          + (request.acceptedAt ? "accepted" : "failed")
          + ":"
          + (request.idempotencyKey ?? "none"),
        );
      });
      const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
        const url = new URL(String(request));
        if (url.pathname.endsWith("/capability/check_imessage")) {
          capabilityRequestCount += 1;
          events.push("provider:capability");
          return new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
            headers: {
              "content-type": "application/json",
              "retry-after": "30",
            },
            status: 429,
          });
        }
        const body = JSON.parse(String(init?.body)) as {
          message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
        };
        events.push("provider:text:" + (body.message?.idempotency_key ?? "none"));
        expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
          .toBe(false);
        return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
          headers: { "content-type": "application/json" },
        });
      });
      const persistAppCardTextFallback = vi.fn(async (fallback: {
        idempotencyKey: string;
      }) => {
        events.push("persist:" + fallback.idempotencyKey);
      });
      const dependencies = createHostedAssistantProgressDeliveryDependencies({
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertLinqRecentInboundEngagement: assertRecentInbound,
          recordLinqDeliveryOutcome: recordDeliveryOutcome,
        }),
        forwardedEnv: {
          LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
          LINQ_API_TOKEN: "linq-actual-runtime-token",
        },
        providerFetch,
      });
      assert.ok(dependencies.sendLinq);

      const delivery = dependencies.sendLinq({
        card: HOSTED_LINQ_RESPONSE_CARD,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        idempotencyKey,
        message: "Nutrition summary",
        persistAppCardTextFallback,
        target: "linq_chat_123",
        targetKind: "thread",
        threadIsDirect: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(capabilityRequestCount).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      await expect(delivery).resolves.toMatchObject({
        idempotencyKey,
        providerMessageId: "linq_text_1",
      });
      await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();
      expect(events).toEqual([
        "authority:read:" + idempotencyKey,
        "authority:read:" + idempotencyKey,
        "provider:capability",
        "persist:" + idempotencyKey,
        "authority:claim:" + idempotencyKey,
        "provider:text:" + idempotencyKey,
        "outcome:accepted:" + idempotencyKey,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: "response headers never arrive", mode: "headers" as const },
    { label: "the success body stalls", mode: "success_body" as const },
    { label: "the rate-limit body stalls", mode: "rate_limit_body" as const },
  ])("starts the persisted text fallback at the short capability deadline when $label", async ({
    mode,
  }) => {
    vi.useFakeTimers();
    try {
      const idempotencyKey = "assistant-outbox:card-capability-timeout";
      const events: string[] = [];
      const startedAt = Date.now();
      let capabilityAbortedAt: number | null = null;
      let capabilityBodyAborted = false;
      let capabilityRequestCount = 0;
      let textStartedAt: number | null = null;
      const assertRecentInbound = vi.fn(async (request: {
        authorityCheckOnly: boolean;
        idempotencyKey?: string | null;
      }) => {
        events.push(
          "authority:"
          + (request.authorityCheckOnly ? "read" : "claim")
          + ":"
          + (request.idempotencyKey ?? "none"),
        );
        return buildClaimedLinqEngagementResult(request);
      });
      const recordDeliveryOutcome = vi.fn(async (request: {
        acceptedAt?: string | null;
        idempotencyKey?: string | null;
      }) => {
        events.push(
          "outcome:"
          + (request.acceptedAt ? "accepted" : "failed")
          + ":"
          + (request.idempotencyKey ?? "none"),
        );
      });
      const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
        const url = new URL(String(request));
        if (url.pathname.endsWith("/capability/check_imessage")) {
          capabilityRequestCount += 1;
          events.push("provider:capability");
          assert.ok(init?.signal);
          if (mode === "headers") {
            return await new Promise<Response>((_resolve, reject) => {
              const rejectOnAbort = () => {
                capabilityAbortedAt = Date.now();
                reject(new DOMException("aborted", "AbortError"));
              };
              if (init.signal?.aborted) {
                rejectOnAbort();
                return;
              }
              init.signal?.addEventListener("abort", rejectOnAbort, { once: true });
            });
          }
          const responseBody = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(
                mode === "success_body" ? '{"available":' : '{"code":',
              ));
              const abortBody = () => {
                capabilityAbortedAt = Date.now();
                capabilityBodyAborted = true;
                controller.error(new DOMException("aborted", "AbortError"));
              };
              if (init.signal?.aborted) {
                abortBody();
                return;
              }
              init.signal?.addEventListener("abort", abortBody, { once: true });
            },
          });
          return new Response(responseBody, {
            headers: {
              "content-type": "application/json",
              ...(mode === "rate_limit_body" ? { "retry-after": "30" } : {}),
            },
            status: mode === "rate_limit_body" ? 429 : 200,
          });
        }
        textStartedAt = Date.now();
        const body = JSON.parse(String(init?.body)) as {
          message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
        };
        events.push("provider:text:" + (body.message?.idempotency_key ?? "none"));
        expect(body.message?.parts?.some((part) => part.type === "imessage_app"))
          .toBe(false);
        return new Response(JSON.stringify({ message: { id: "linq_text_1" } }), {
          headers: { "content-type": "application/json" },
        });
      });
      const persistAppCardTextFallback = vi.fn(async (fallback: {
        idempotencyKey: string;
      }) => {
        events.push("persist:" + fallback.idempotencyKey);
      });
      const dependencies = createHostedAssistantProgressDeliveryDependencies({
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertLinqRecentInboundEngagement: assertRecentInbound,
          recordLinqDeliveryOutcome: recordDeliveryOutcome,
        }),
        forwardedEnv: {
          LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
          LINQ_API_TOKEN: "linq-actual-runtime-token",
        },
        providerFetch,
      });
      assert.ok(dependencies.sendLinq);

      const delivery = dependencies.sendLinq({
        card: HOSTED_LINQ_RESPONSE_CARD,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        idempotencyKey,
        message: "Nutrition summary",
        persistAppCardTextFallback,
        target: "linq_chat_123",
        targetKind: "thread",
        threadIsDirect: true,
      });
      await vi.advanceTimersByTimeAsync(2_499);

      expect(capabilityRequestCount).toBe(1);
      expect(capabilityAbortedAt).toBeNull();
      expect(textStartedAt).toBeNull();
      expect(persistAppCardTextFallback).not.toHaveBeenCalled();
      expect(recordDeliveryOutcome).not.toHaveBeenCalled();
      expect(assertRecentInbound).toHaveBeenCalledTimes(2);
      expect(assertRecentInbound).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          authorityCheckOnly: true,
          idempotencyKey,
        }),
        { signal: null },
      );
      expect(assertRecentInbound).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          authorityCheckOnly: true,
          expectedResolvedRoute: expect.any(Object),
          idempotencyKey,
        }),
        { signal: null },
      );

      await vi.advanceTimersByTimeAsync(1);
      await expect(delivery).resolves.toMatchObject({
        idempotencyKey,
        providerMessageId: "linq_text_1",
      });
      await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

      expect(capabilityAbortedAt).toBe(startedAt + 2_500);
      expect(capabilityBodyAborted).toBe(mode !== "headers");
      expect(textStartedAt).toBe(startedAt + 2_500);
      expect(capabilityRequestCount).toBe(1);
      expect(providerFetch).toHaveBeenCalledTimes(2);
      expect(persistAppCardTextFallback).toHaveBeenCalledOnce();
      expect(assertRecentInbound).toHaveBeenCalledTimes(3);
      expect(assertRecentInbound).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          authorityCheckOnly: false,
          idempotencyKey,
        }),
        { signal: null },
      );
      expect(events).toEqual([
        "authority:read:" + idempotencyKey,
        "authority:read:" + idempotencyKey,
        "provider:capability",
        "persist:" + idempotencyKey,
        "authority:claim:" + idempotencyKey,
        "provider:text:" + idempotencyKey,
        "outcome:accepted:" + idempotencyKey,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a rejected Linq card before claiming and sending its fallback identity", async () => {
    const idempotencyKey = "assistant-outbox:card-rejected";
    const fallbackIdempotencyKey = `${idempotencyKey}:fallback`;
    const events: string[] = [];
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        `authority:${request.authorityCheckOnly ? "read" : "claim"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
      return buildClaimedLinqEngagementResult(request);
    });
    const recordedOutcomes: Array<{
      acceptedAt?: string | null;
      failureCode?: string | null;
      idempotencyKey?: string | null;
    }> = [];
    const recordDeliveryOutcome = vi.fn(async (request: {
      acceptedAt?: string | null;
      failureCode?: string | null;
      idempotencyKey?: string | null;
    }) => {
      recordedOutcomes.push(request);
      events.push(
        `outcome:${request.acceptedAt ? "accepted" : "failed"}:${
          request.idempotencyKey ?? "none"
        }`,
      );
    });
    let messageRequestCount = 0;
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        events.push("provider:capability");
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      messageRequestCount += 1;
      const body = JSON.parse(String(init?.body)) as {
        message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
      };
      const isCard = body.message?.parts?.some((part) =>
        part.type === "imessage_app"
      ) === true;
      events.push(
        `provider:${isCard ? "card" : "text"}:${
          body.message?.idempotency_key ?? "none"
        }`,
      );
      if (messageRequestCount === 1) {
        expect(isCard).toBe(true);
        return new Response(JSON.stringify({ error: "unsupported app card" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      expect(isCard).toBe(false);
      return new Response(JSON.stringify({ message: { id: "linq_text_fallback" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const persistAppCardTextFallback = vi.fn(async (fallback: {
      idempotencyKey: string;
    }) => {
      events.push(`persist:${fallback.idempotencyKey}`);
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
    });
    assert.ok(dependencies.sendLinq);

    await expect(dependencies.sendLinq({
      card: HOSTED_LINQ_RESPONSE_CARD,
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey,
      message: "Nutrition summary",
      persistAppCardTextFallback,
      target: "linq_chat_123",
      targetKind: "thread",
      threadIsDirect: true,
    })).resolves.toMatchObject({
      idempotencyKey: fallbackIdempotencyKey,
      providerMessageId: "linq_text_fallback",
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(events).toEqual([
      `authority:read:${idempotencyKey}`,
      `authority:read:${idempotencyKey}`,
      "provider:capability",
      `authority:claim:${idempotencyKey}`,
      `provider:card:${idempotencyKey}`,
      `outcome:failed:${idempotencyKey}`,
      `persist:${fallbackIdempotencyKey}`,
      `authority:claim:${fallbackIdempotencyKey}`,
      `provider:text:${fallbackIdempotencyKey}`,
      `outcome:accepted:${fallbackIdempotencyKey}`,
    ]);
    expect(recordedOutcomes).toEqual([
      expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        idempotencyKey,
      }),
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        idempotencyKey: fallbackIdempotencyKey,
      }),
    ]);
  });

  it("recovers a classified stale app-card chat under the promoted fallback identity", async () => {
    const idempotencyKey = "assistant-outbox:stale-card-chat";
    const fallbackIdempotencyKey = idempotencyKey + ":fallback";
    const events: string[] = [];
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_stale",
      card: HOSTED_LINQ_RESPONSE_CARD,
      channel: "linq",
      idempotencyKey,
      message: "Nutrition summary",
      threadIsDirect: true,
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        "authority:"
        + (request.authorityCheckOnly ? "read" : "claim")
        + ":"
        + (request.idempotencyKey ?? "none"),
      );
      return buildClaimedLinqEngagementResult(request);
    });
    const recordDeliveryOutcome = vi.fn(async (request: {
      acceptedAt?: string | null;
      failureCode?: string | null;
      idempotencyKey?: string | null;
    }) => {
      events.push(
        "outcome:"
        + (request.acceptedAt ? "accepted" : "failed")
        + ":"
        + (request.idempotencyKey ?? "none"),
      );
    });
    const persistAppCardTextFallback = vi.fn(async (fallback: {
      idempotencyKey: string;
    }) => {
      events.push("persist:" + fallback.idempotencyKey);
    });
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/capability/check_imessage")) {
        events.push("provider:capability");
        return new Response(JSON.stringify({
          address: "+15550001",
          available: true,
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as {
        message?: { idempotency_key?: string; parts?: Array<{ type?: string }> };
      };
      if (url.pathname.endsWith("/chats")) {
        events.push(
          "provider:create:" + (body.message?.idempotency_key ?? "none"),
        );
        return new Response(JSON.stringify({
          chat: {
            id: "linq_chat_recovered",
            message: { id: "linq_text_recovered" },
          },
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      const isCard = body.message?.parts?.some((part) =>
        part.type === "imessage_app"
      ) === true;
      events.push(
        "provider:"
        + (isCard ? "card" : "text")
        + ":"
        + (body.message?.idempotency_key ?? "none"),
      );
      return new Response(JSON.stringify({
        code: isCard ? "CHAT_NOT_FOUND" : "chat_not_found",
      }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        const delivery = await dependencies.sendLinq({
          card: HOSTED_LINQ_RESPONSE_CARD,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          homeRouteFallbackAllowed: true,
          idempotencyKey,
          message: "Nutrition summary",
          persistAppCardTextFallback,
          target: "linq_chat_stale",
          targetKind: "thread",
          threadIsDirect: true,
        });
        return createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            idempotencyKey: delivery.idempotencyKey,
            providerMessageId: delivery.providerMessageId,
            providerThreadId: delivery.providerThreadId,
            target: delivery.target,
            targetKind: delivery.targetKind ?? "thread",
          }),
          status: "sent",
        });
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        providerMessageId: "linq_text_recovered",
        providerThreadId: "linq_chat_recovered",
      }),
    ]);
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(events).toEqual([
      "authority:read:" + idempotencyKey,
      "authority:read:" + idempotencyKey,
      "provider:capability",
      "authority:claim:" + idempotencyKey,
      "provider:card:" + idempotencyKey,
      "outcome:failed:" + idempotencyKey,
      "persist:" + fallbackIdempotencyKey,
      "authority:claim:" + fallbackIdempotencyKey,
      "provider:text:" + fallbackIdempotencyKey,
      "provider:create:" + fallbackIdempotencyKey,
      "outcome:accepted:" + fallbackIdempotencyKey,
    ]);
    expect(recordDeliveryOutcome).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        idempotencyKey,
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        idempotencyKey: fallbackIdempotencyKey,
        providerMessageId: "linq_text_recovered",
        providerThreadId: "linq_chat_recovered",
      }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("preserves the accepted Linq primary checkpoint when yield blocks the rich-link request", async () => {
    const idempotencyKey = "assistant-outbox:rich-link-provider-yield";
    let shouldYield = false;
    const assertRecentInbound = vi.fn(async (request: {
      authorityCheckOnly: boolean;
      idempotencyKey?: string | null;
    }) => buildClaimedLinqEngagementResult(request));
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey,
      message: "Complete payment https://pay.example.test/session",
      transportIdempotent: true,
    });
    mocks.readAssistantOutboxIntentMirrorState.mockResolvedValue(
      createMirrorState(
        {
          delivery: null,
          deliveryConfirmationPending: false,
          deliveryIdempotencyKey: idempotencyKey,
          deliveryTransportIdempotent: true,
          intentId: effect.effectId,
          lastError: null,
          status: "sending",
        },
        { sendingStartedAt: "2026-04-08T00:00:05.000Z" },
      ),
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          idempotencyKey,
          message: "Complete payment https://pay.example.test/session",
          target: "linq_chat_123",
          targetKind: "thread",
        });
        throw new Error("unreachable after rich-link yield");
      },
    );
    const providerFetch = vi.fn<typeof fetch>(async (_request, init) => {
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { message?: { parts?: unknown[] } }
        : {};
      expect(body.message?.parts).toHaveLength(1);
      shouldYield = true;
      return new Response(JSON.stringify({
        message: { id: "linq_primary_accepted" },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_BASE_URL: "https://api.linq.example/api/partner/v3",
        LINQ_API_TOKEN: "linq-actual-runtime-token",
      },
      preparedDispatches: [{
        intentId: effect.effectId,
        preparedDispatchToken: PREPARED_DISPATCH_TOKEN,
        previousDispatchState: createPreparedPreviousDispatchState({
          deliveryTransportIdempotent: true,
        }),
      }],
      providerFetch,
      shouldYieldBackgroundDelivery: () => shouldYield,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
      deliveryMayHaveSucceeded: true,
      providerMessageIds: ["linq_primary_accepted"],
    });

    expect(providerFetch.mock.calls.filter(([request]) =>
      new URL(String(request)).pathname.endsWith("/messages")
    )).toHaveLength(1);
    expect(assertRecentInbound.mock.calls.map(([request]) => ({
      authorityCheckOnly: request.authorityCheckOnly,
      idempotencyKey: request.idempotencyKey,
    }))).toEqual([
      {
        authorityCheckOnly: true,
        idempotencyKey,
      },
      {
        authorityCheckOnly: false,
        idempotencyKey,
      },
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        idempotencyKey,
        providerMessageId: "linq_primary_accepted",
        providerMessageIds: ["linq_primary_accepted"],
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(mocks.resetAssistantOutboxPreparedDispatchById).not.toHaveBeenCalled();
  });

  it("carries distinct stable identities through hosted Linq voice transcript fallback", async () => {
    const answeredMailboxItemIds = ["mailbox_item_answered_1"];
    const effect = createEffect({
      answeredMailboxItemIds,
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      media: [createHostedVoiceMemoMedia({
        transcript: "Have you had any recent blood tests?",
      })],
      message: "",
      replyToMessageId: "linq_message_answered_1",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request));
    let releaseAcceptedFallbackOutcome: () => void = () => {};
    const acceptedFallbackOutcomeReleased = new Promise<void>((resolve) => {
      releaseAcceptedFallbackOutcome = resolve;
    });
    let markAcceptedFallbackOutcomeStarted: () => void = () => {};
    const acceptedFallbackOutcomeStarted = new Promise<void>((resolve) => {
      markAcceptedFallbackOutcomeStarted = resolve;
    });
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async (request) => {
      if (
        request.acceptedAt
        && request.idempotencyKey
          === "linq-voice-memo-transcript:assistant-outbox:intent_123"
      ) {
        markAcceptedFallbackOutcomeStarted();
        await acceptedFallbackOutcomeReleased;
      }
    });
    mocks.sendLinqMessage
      .mockResolvedValueOnce({
        providerMessageId: "linq_transcript_fallback",
        providerThreadId: "linq_chat_123",
        target: "linq_chat_123",
        targetKind: "thread" as const,
      });
    mocks.sendLinqVoiceMemoMessage.mockRejectedValueOnce(new VaultCliError(
      "LINQ_API_REQUEST_FAILED",
      "Linq rejected the voice memo.",
      {
        failureStage: "http",
        operation: "send_voice_memo",
        retryable: true,
        status: 503,
      },
    ));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const adapter = getAssistantChannelAdapter("linq");
      assert.ok(adapter);
      const delivery = await adapter.send({
        actorId: "actor_123",
        answeredMailboxItemIds,
        bindingDelivery: { kind: "thread", target: "linq_chat_123" },
        explicitTarget: null,
        idempotencyKey: "assistant-outbox:intent_123",
        identityId: "identity_123",
        media: [createHostedVoiceMemoMedia({
          transcript: "Have you had any recent blood tests?",
        })],
        message: "",
        replyToMessageId: "linq_message_answered_1",
        threadIsDirect: true,
      }, dependencies);
      return createDispatchResult({
        delivery,
        status: "sent",
      });
    });

    let deliverySettled = false;
    const deliveryPromise = drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    }).finally(() => {
      deliverySettled = true;
    });

    await acceptedFallbackOutcomeStarted;
    expect(deliverySettled).toBe(false);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        answeredMailboxItemIds,
        idempotencyKey:
          "linq-voice-memo-transcript:assistant-outbox:intent_123",
      }),
      { signal: expect.any(AbortSignal) },
    );
    releaseAcceptedFallbackOutcome();

    await expect(deliveryPromise).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(assertRecentInbound.mock.calls
      .map(([request]) => request)
      .filter((request) => request.authorityCheckOnly === false)
      .map((request) => request.idempotencyKey)).toEqual([
      "linq-voice-memo:intent_123",
      "linq-voice-memo-transcript:assistant-outbox:intent_123",
    ]);
    expect(assertRecentInbound.mock.calls
      .map(([request]) => request)
      .filter((request) => request.authorityCheckOnly === true)
      .map((request) => request.idempotencyKey)).toEqual([
      "linq-voice-memo:intent_123",
      "linq-voice-memo-transcript:assistant-outbox:intent_123",
    ]);
    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds,
        idempotencyKey:
          "linq-voice-memo-transcript:assistant-outbox:intent_123",
        replyToMessageId: "linq_message_answered_1",
      }),
      { signal: null },
    );
    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendLinqVoiceMemoMessage).toHaveBeenCalledTimes(1);
  });

  it("safely re-enters idempotent Linq text delivery after an existing provider claim", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      nativeReplyRequested: true,
      replyToMessageId: "linq_message_1",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(assertLinqEngagementWithExistingProviderClaim);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        idempotencyKey: "assistant-outbox:intent_123",
        message: "hello from hosted",
        nativeReplyRequested: true,
        replyToMessageId: "linq_message_1",
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

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
      }),
    ]);

    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeReplyRequested: true,
        replyToMessageId: "linq_message_1",
      }),
      expect.any(Object),
    );
  });

  it("durably supersedes a revoked reviewed answer and sends the fixed fallback once after retry", async () => {
    const completionId = "aask_done_revoked_before_dispatch";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const privateAnswer = "Private answer that must never reach the provider.";
    const privateMedia = [{
      alt: "Private answer attachment",
      kind: "image" as const,
      source: "reviewed-private-answer",
      url: "https://cdn.example.test/private/reviewed-answer.png",
    }];
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey,
      media: privateMedia,
      message: privateAnswer,
      transportIdempotent: true,
    });
    let storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      attemptCount: 0,
      bindingDelivery: { kind: "thread", target: "linq_chat_123" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: idempotencyKey,
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: effect.effectId,
      lastAttemptAt: null,
      media: privateMedia,
      message: privateAnswer,
      operation: null,
      preparedDispatchToken: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
      updatedAt: "2026-04-08T00:00:00.000Z",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntent.mockImplementation(async () => storedIntent);
    mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
      async ({ intent }) => {
        storedIntent = intent;
        return { applied: true, intent };
      },
    );
    const assertRecentInbound = vi.fn(async (request) => {
      const base = {
        resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request),
      };
      if (request.authorityCheckOnly) {
        return base;
      }
      return request.assistantAskFallback === true
        ? { ...base, providerDispatchClaimed: true }
        : { ...base, assistantAskFallbackRequired: true };
    });
    mocks.sendLinqMessage.mockResolvedValue({
      providerMessageId: "linq_message_safe_fallback",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    const dispatchAttempt = async ({ dependencies, dispatchHooks }: {
      dependencies: {
        sendLinq: (request: {
          answeredMailboxItemIds: string[];
          idempotencyKey: string;
          media: AssistantOutboxIntent["media"];
          message: string;
          target: string;
          targetKind: "thread";
        }) => Promise<{ providerMessageId?: string | null }>;
      };
      dispatchHooks?: {
        preflightDispatchIntent?: (input: {
          intent: AssistantOutboxIntent;
          now: Date;
          vault: string;
        }) => Promise<unknown>;
      };
    }) => {
      await dispatchHooks?.preflightDispatchIntent?.({
        intent: storedIntent,
        now: new Date("2026-04-08T00:00:30.000Z"),
        vault: HOSTED_WAKE.vaultRoot,
      });
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds: [completionId],
        idempotencyKey,
        media: storedIntent.media,
        message: storedIntent.message,
        target: "linq_chat_123",
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey,
          messageLength: storedIntent.message.length,
          providerMessageId: delivery.providerMessageId,
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        status: "sent",
      });
    };
    mocks.dispatchAssistantOutboxIntent
      .mockImplementationOnce(dispatchAttempt)
      .mockImplementationOnce(dispatchAttempt);
    const drain = () => drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(async () =>
        new Response(null, { status: 204 })
      ),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    await expect(drain()).rejects.toMatchObject({
      code: "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
    });
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(storedIntent).toMatchObject({
      media: [],
      message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
    });
    storedIntent = {
      ...storedIntent,
      status: "retryable",
      updatedAt: "2026-04-08T00:00:45.000Z",
    };

    await expect(drain()).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);
    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
        media: [],
      }),
      expect.any(Object),
    );
    expect(assertRecentInbound.mock.calls.map(([request]) => ({
      assistantAskFallback: request.assistantAskFallback,
      authorityCheckOnly: request.authorityCheckOnly,
    }))).toEqual([
      { assistantAskFallback: false, authorityCheckOnly: true },
      { assistantAskFallback: false, authorityCheckOnly: true },
      { assistantAskFallback: false, authorityCheckOnly: false },
      { assistantAskFallback: true, authorityCheckOnly: true },
      { assistantAskFallback: true, authorityCheckOnly: true },
      { assistantAskFallback: true, authorityCheckOnly: false },
    ]);
    expect(
      assertRecentInbound.mock.calls.some(([request]) =>
        "message" in request && request.message === privateAnswer
      ),
    ).toBe(false);
  });

  it("preserves reviewed completion media while completion authority remains live", async () => {
    const completionId = "aask_done_live_with_media";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const media = [{
      alt: "Consented group attachment",
      kind: "image" as const,
      source: "reviewed-completion",
      url: "https://cdn.example.test/group/reviewed-completion.png",
    }];
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey,
      media,
      message: "Consented answer with an attachment.",
      transportIdempotent: true,
    });
    const storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      attemptCount: 0,
      bindingDelivery: { kind: "thread", target: "linq_chat_123" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: idempotencyKey,
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: effect.effectId,
      lastAttemptAt: null,
      media,
      message: "Consented answer with an attachment.",
      operation: null,
      preparedDispatchToken: null,
      reviewedAssistantAskCompletionExpiresAt:
        "2099-04-08T00:15:00.000Z",
      updatedAt: "2026-04-08T00:00:00.000Z",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntent.mockResolvedValue(storedIntent);
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request));
    mocks.sendLinqMessage.mockResolvedValue({
      providerMessageId: "linq_message_live_media",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:00:30.000Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        const delivery = await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          idempotencyKey,
          media: storedIntent.media,
          message: storedIntent.message,
          target: "linq_chat_123",
          targetKind: "thread",
        });
        return createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            idempotencyKey,
            providerMessageId: delivery.providerMessageId,
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          status: "sent",
        });
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(async () =>
        new Response(null, { status: 204 })
      ),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(mocks.saveAssistantOutboxIntentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({ media }),
      expect.any(Object),
    );
    expect(assertRecentInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantAskFallback: false,
        authorityCheckOnly: false,
      }),
      { signal: null },
    );
  });

  it("sends only the fixed completion when mailbox retention deleted an expired reviewed answer", async () => {
    const completionId = "aask_done_retention_deleted";
    const expiresAt = "2026-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const privateAnswer = "Private queued answer removed at the retention boundary.";
    const privateMedia = [{
      alt: "Expired private answer attachment",
      kind: "image" as const,
      source: "reviewed-private-answer",
      url: "https://cdn.example.test/private/expired-reviewed-answer.png",
    }];
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey,
      media: privateMedia,
      message: privateAnswer,
      transportIdempotent: true,
    });
    let storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      attemptCount: 1,
      bindingDelivery: { kind: "thread", target: "linq_chat_123" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: idempotencyKey,
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: effect.effectId,
      lastAttemptAt: "2026-04-08T00:10:00.000Z",
      media: privateMedia,
      message: privateAnswer,
      operation: null,
      preparedDispatchToken: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      status: "retryable",
      updatedAt: "2026-04-08T00:10:01.000Z",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntent.mockImplementation(async () => storedIntent);
    mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
      async ({ intent }) => {
        storedIntent = intent;
        return { applied: true, intent };
      },
    );
    const assertRecentInbound = vi.fn(async (request: {
      assistantAskCompletionExpiresAt?: string | null;
      assistantAskFallback?: boolean | null;
      authorityCheckOnly: boolean;
    }) => {
      if (request.assistantAskCompletionExpiresAt !== undefined) {
        expect(request.assistantAskCompletionExpiresAt).toBe(expiresAt);
      }
      expect(request.assistantAskFallback).toBe(true);
      return buildClaimedLinqEngagementResult(request);
    });
    mocks.sendLinqMessage.mockResolvedValue({
      providerMessageId: "linq_message_retention_fallback",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date(expiresAt),
          vault: HOSTED_WAKE.vaultRoot,
        });
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date(expiresAt),
          vault: HOSTED_WAKE.vaultRoot,
        });
        const delivery = await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          idempotencyKey,
          media: storedIntent.media,
          message: storedIntent.message,
          target: "linq_chat_123",
          targetKind: "thread",
        });
        return createDispatchResult({
          delivery: createDelivery({
            channel: "linq",
            idempotencyKey,
            providerMessageId: delivery.providerMessageId,
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          status: "sent",
        });
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(async () =>
        new Response(null, { status: 204 })
      ),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "sent" }),
    ]);

    expect(storedIntent.message).toBe(
      HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
    );
    expect(storedIntent.media).toEqual([]);
    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
        media: [],
      }),
      expect.any(Object),
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: privateAnswer }),
      expect.any(Object),
    );
  });

  it("supersedes a reviewed answer when expiry crosses between preflight and provider entry", async () => {
    vi.useFakeTimers();
    const completionId = "aask_done_expired_at_provider_entry";
    const expiresAt = "2026-04-08T00:15:00.000Z";
    const idempotencyKey =
      createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
        completionId,
      );
    const privateAnswer = "Private answer that expired after preflight.";
    const privateMedia = [{
      alt: "Private answer expiring at dispatch",
      kind: "image" as const,
      source: "reviewed-private-answer",
      url: "https://cdn.example.test/private/expiring-reviewed-answer.png",
    }];
    const effect = createEffect({
      answeredMailboxItemIds: [completionId],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey,
      media: privateMedia,
      message: privateAnswer,
      transportIdempotent: true,
    });
    let storedIntent = createPendingHostedDeliveryIntent({
      answeredMailboxItemIds: [completionId],
      attemptCount: 0,
      bindingDelivery: { kind: "thread", target: "linq_chat_123" },
      channel: "linq",
      createdAt: "2026-04-08T00:00:00.000Z",
      deliveryIdempotencyKey: idempotencyKey,
      deliveryTransportIdempotent: true,
      explicitTarget: null,
      intentId: effect.effectId,
      lastAttemptAt: null,
      media: privateMedia,
      message: privateAnswer,
      operation: null,
      preparedDispatchToken: null,
      reviewedAssistantAskCompletionExpiresAt: expiresAt,
      updatedAt: "2026-04-08T00:00:00.000Z",
    }) as AssistantOutboxIntent;
    mocks.readAssistantOutboxIntent.mockImplementation(async () => storedIntent);
    mocks.saveAssistantOutboxIntentIfUnchanged.mockImplementation(
      async ({ intent }) => {
        storedIntent = intent;
        return { applied: true, intent };
      },
    );
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies, dispatchHooks }) => {
        await dispatchHooks?.preflightDispatchIntent?.({
          intent: storedIntent,
          now: new Date("2026-04-08T00:14:59.999Z"),
          vault: HOSTED_WAKE.vaultRoot,
        });
        vi.setSystemTime(new Date(expiresAt));
        await dependencies.sendLinq({
          answeredMailboxItemIds: [completionId],
          idempotencyKey,
          media: storedIntent.media,
          message: storedIntent.message,
          target: "linq_chat_123",
          targetKind: "thread",
        });
        throw new Error("unreachable after expiry supersession");
      },
    );

    try {
      vi.setSystemTime(new Date("2026-04-08T00:14:59.999Z"));
      await expect(drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertLinqRecentInboundEngagement: assertRecentInbound,
        }),
        forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      })).rejects.toMatchObject({
        code: "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
      });
      expect(storedIntent.message).toBe(
        HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
      );
      expect(storedIntent.media).toEqual([]);
      expect(assertRecentInbound).toHaveBeenCalledTimes(2);
      expect(assertRecentInbound).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          assistantAskFallback: false,
          authorityCheckOnly: true,
        }),
        { signal: null },
      );
      expect(assertRecentInbound).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          assistantAskFallback: false,
          authorityCheckOnly: true,
        }),
        { signal: null },
      );
      expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["reaction", "voice"] as const)(
    "keeps an already-started non-idempotent Linq %s delivery confirmation-pending",
    async (kind) => {
      const effect = createEffect({
        bindingDeliveryKind: "thread",
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        message: kind === "reaction" ? "" : "voice reply",
        replyToMessageId: "linq_message_1",
        transportIdempotent: false,
      });
      const assertRecentInbound = vi.fn(assertLinqEngagementWithExistingProviderClaim);
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
        if (kind === "reaction") {
          await dependencies.setLinqMessageReaction({
            reaction: "heart",
            target: "linq_chat_123",
            targetMessageId: "linq_message_1",
          });
        } else {
          await dependencies.sendLinqVoiceMemo({
            attachmentId: "attachment_voice_1",
            target: "linq_chat_123",
          });
        }
        throw new Error("unreachable after an existing non-idempotent claim");
      });

      await expect(drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({
          assertLinqRecentInboundEngagement: assertRecentInbound,
        }),
        forwardedEnv: { LINQ_API_TOKEN: "linq-token" },
        platformEnv: {},
        providerFetch: vi.fn<typeof fetch>(),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      })).rejects.toMatchObject({
        code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        deliveryMayHaveSucceeded: true,
      });

      expect(mocks.setLinqMessageReaction).not.toHaveBeenCalled();
      expect(mocks.sendLinqVoiceMemoMessage).not.toHaveBeenCalled();
    },
  );

  it("blocks Linq reactions when egress authority is rejected", async () => {
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

      throw new Error("unreachable after egress authority failure");
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

  it("sends signup welcome Linq egress authority with participant context", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      answeredMailboxItemIds: ["mailbox_item_answered_1", "mailbox_item_answered_2"],
      bindingDeliveryTarget: "+15550100001",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_link_message",
      providerMessageIds: ["linq_text_message", "linq_link_message"],
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "participant" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds: ["mailbox_item_answered_1", "mailbox_item_answered_2"],
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
          providerMessageIds: delivery.providerMessageIds,
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

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityCheckOnly: false,
        directRecipientPhoneNumber: "+15550100001",
        expectedResolvedRoute: expect.objectContaining({
          directRecipientPhoneNumber: "+15550100001",
          fromPhoneNumber: "+15550100099",
          target: "+15550100001",
          targetKind: "participant",
          threadIsDirect: true,
        }),
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

  it("requires signup welcome outcome recording without answered mailbox items", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      answeredMailboxItemIds: [],
      bindingDeliveryTarget: "+15550100001",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_link_message",
      providerMessageIds: ["linq_text_message", "linq_link_message"],
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "participant" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds: [],
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
          providerMessageIds: delivery.providerMessageIds,
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

    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        attemptedAt: expect.stringMatching(/Z$/u),
        directRecipientPhoneNumber: "+15550100001",
        failureCode: null,
        failureReason: null,
        fromPhoneNumber: "+15550100099",
        idempotencyKey: "signup-welcome:member_123",
        intentId: "intent_123",
        providerMessageId: "linq_link_message",
        providerMessageIds: ["linq_text_message", "linq_link_message"],
        providerTarget: null,
        providerThreadId: "linq_chat_123",
        target: null,
        targetKind: "participant",
        threadIsDirect: true,
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome.mock.calls[0]?.[0]).not.toHaveProperty(
      "answeredMailboxItemIds",
    );
  });

  it("requires malformed signup-welcome participant outcome recording", async () => {
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => {
      throw new Error("web callback unavailable");
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "participant" as const,
    });
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      providerFetch: vi.fn<typeof fetch>(),
    });
    const sendLinq = dependencies.sendLinq;
    assert.ok(sendLinq);

    await expect(sendLinq({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: "+15550100001",
      fromPhoneNumber: "+15550100099",
      idempotencyKey: "signup-welcome:member_123:retry",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      replyToMessageId: null,
      target: "+15550100001",
      targetKind: "participant",
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
      context: expect.objectContaining({ retryable: true }),
      deliveryMayHaveSucceeded: true,
    });
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
  });

  it("recovers a missing Linq egress target without replay-scoped route authority", async () => {
    const staleRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:stale",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_stale",
    };
    const staleWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_stale_replay",
      linqMessage: {
        chatId: "linq_chat_stale",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_stale",
        parts: [{ type: "text", value: "already consumed" }],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_stale",
      routeAuthority: staleRouteAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_stale",
      channel: "linq",
      idempotencyKey: "assistant-outbox:intent_123",
      message: "Current home route reminder.",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request) => ({
      ...buildClaimedLinqEngagementResult(request),
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
        conversationThreadId: "conversation-current",
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        target: "linq_chat_current",
        targetKind: "thread" as const,
        threadIsDirect: true,
      }),
    }));
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.sendLinqMessage
      .mockRejectedValueOnce(new VaultCliError(
        "LINQ_API_REQUEST_FAILED",
        "Linq chat was not found.",
        {
          failureStage: "http",
          linqFailureKind: "chat_not_found",
          method: "POST",
          operation: "send_message",
          path: "/chats/[chat]/messages",
          provider: "linq",
          status: 404,
        },
      ))
      .mockResolvedValueOnce({
        providerMessageId: "linq_message_recovered",
        providerThreadId: "linq_chat_recovered",
        target: "linq_chat_recovered",
        targetKind: "thread" as const,
      });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds: [],
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        homeRouteFallbackAllowed: true,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "Current home route reminder.",
        replyToMessageId: null,
        target: "linq_chat_stale",
        targetKind: "thread",
      });

      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "assistant-outbox:intent_123",
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
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: staleWake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: true,
        target: "linq_chat_stale",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(assertRecentInbound.mock.calls.map(([request]) => [
      request.authorityCheckOnly,
      request.homeRouteFallbackAllowed,
      request.target,
    ])).toEqual([
      [true, true, "linq_chat_stale"],
      [false, false, "linq_chat_current"],
    ]);
    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendLinqMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        target: "linq_chat_current",
        targetKind: "thread",
      }),
    );
    expect(mocks.sendLinqMessage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        target: "+15550100001",
        targetKind: "participant",
      }),
    );
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15550100002",
        providerTarget: "linq_chat_current",
        providerThreadId: "linq_chat_recovered",
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(recordDeliveryOutcome.mock.calls)).not.toContain(
      '"lineLookupKey"',
    );
  });

  it("records current-home provider failures without replay-scoped line authority", async () => {
    const staleWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_stale_failure_replay",
      linqMessage: {
        chatId: "linq_chat_stale_failure",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_stale_failure",
        parts: [{ type: "text", value: "already consumed" }],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_stale_failure",
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:stale-failure",
        channel: "linq",
        containerMemberId: "member_123",
        threadId: "linq_chat_stale_failure",
      },
      userId: "member_123",
    });
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_stale_failure",
      channel: "linq",
      idempotencyKey: "assistant-outbox:intent_current_home_failure",
      message: "Current home route reminder.",
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request) => ({
      ...buildClaimedLinqEngagementResult(request),
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
        conversationThreadId: "conversation-current-failure",
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        target: "linq_chat_current_failure",
        targetKind: "thread" as const,
        threadIsDirect: true,
      }),
    }));
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockRejectedValueOnce(Object.assign(
      new Error("provider rejected current route"),
      { code: "LINQ_PROVIDER_FAILED" },
    ));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          homeRouteFallbackAllowed: true,
          idempotencyKey: "assistant-outbox:intent_current_home_failure",
          message: "Current home route reminder.",
          replyToMessageId: null,
          target: "linq_chat_stale_failure",
          targetKind: "thread",
        });
      } catch {
        return createDispatchResult({ delivery: null, status: "failed" }, {
          code: "LINQ_PROVIDER_FAILED",
          message: "Provider send failed.",
        });
      }

      throw new Error("Expected Linq send to fail.");
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: staleWake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15550100002",
        target: "linq_chat_current_failure",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAt: expect.stringMatching(/Z$/u),
        failureCode: "LINQ_PROVIDER_FAILED",
        fromPhoneNumber: "+15550100002",
        providerTarget: "linq_chat_current_failure",
        target: "linq_chat_current_failure",
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(recordDeliveryOutcome.mock.calls)).not.toContain(
      '"lineLookupKey"',
    );
  });

  it("fails a fixed-source Linq notification instead of moving it to the current home route", async () => {
    const effect = createEffect({
      bindingDeliveryKind: null,
      bindingDeliveryTarget: null,
      channel: "linq",
      explicitTarget: "linq_source_chat_a",
      idempotencyKey: "usage-referral-reward:referral_1",
      threadIsDirect: true,
      transportIdempotent: true,
    });
    const authorityError = new VaultCliError(
      "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      "The fixed source conversation is no longer authorized.",
      { retryable: false },
    );
    const assertRecentInbound = vi.fn(async () => {
      throw authorityError;
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          answeredMailboxItemIds: [],
          homeRouteFallbackAllowed: false,
          idempotencyKey: "usage-referral-reward:referral_1",
          message: "Mission complete.",
          replyToMessageId: null,
          target: "linq_source_chat_a",
          targetKind: "explicit",
        });
      } catch (error) {
        return createDispatchResult({
          delivery: null,
          status: "failed",
        }, {
          code: error instanceof VaultCliError ? error.code : null,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw new Error("Expected fixed-source authority to fail.");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityCheckOnly: true,
        homeRouteFallbackAllowed: false,
        target: "linq_source_chat_a",
        targetKind: "explicit",
      }),
      { signal: null },
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(assertRecentInbound.mock.calls))
      .not.toContain("linq_current_home_b");
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
  });

  it("keeps Linq sends successful when delivery outcome recording fails", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      threadIsDirect: false,
      transportIdempotent: false,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => {
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
        assertLinqRecentInboundEngagement: async (request) => ({
          ...(request.authorityCheckOnly
            ? {}
            : { providerDispatchClaimed: true }),
          resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
            directRecipientPhoneNumber: null,
            threadIsDirect: false,
          }),
        }),
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
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: "thread",
        threadIsDirect: false,
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome.mock.calls[0]?.[0]).not.toHaveProperty(
      "directRecipientPhoneNumber",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted Linq delivery outcome recording failed.",
      { errorName: "Error" },
    );
    warnSpy.mockRestore();
  });

  it("surfaces accepted Linq outcome recording failures with answered mailbox ids for outbox retry", async () => {
    const answeredMailboxItemIds = [
      "mailbox_item_answered_1",
      "mailbox_item_answered_2",
    ];
    const effect = createEffect({
      answeredMailboxItemIds,
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: true,
    });
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >()
      .mockRejectedValueOnce(new Error("web callback unavailable"))
      .mockResolvedValueOnce(undefined);
    const effectsPort = createHostedRuntimeEffectsPortStub({
      recordLinqDeliveryOutcome: recordDeliveryOutcome,
    });
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    let outcomeRecordingError: unknown = null;
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          answeredMailboxItemIds,
          idempotencyKey: "assistant-outbox:intent_123",
          message: "reply",
          replyToMessageId: null,
          target: "linq_chat_123",
          targetKind: "thread",
        });
      } catch (error) {
        outcomeRecordingError = error;
        const deliveryError = {
          code: error instanceof VaultCliError ? error.code : null,
          message: error instanceof Error ? error.message : String(error),
        };
        return createDispatchResult({
          answeredMailboxItemIds,
          lastError: deliveryError,
          status: "retryable",
        }, deliveryError);
      }

      throw new Error("Expected required delivery outcome recording to fail.");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort,
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
        deliveryStatus: "retryable",
        retryable: true,
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(1);
    expect(outcomeRecordingError).toMatchObject({
      code: "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
      context: expect.objectContaining({ retryable: true }),
      deliveryMayHaveSucceeded: true,
    });

    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds,
        idempotencyKey: "assistant-outbox:intent_123",
        message: "reply",
        replyToMessageId: null,
        target: "linq_chat_123",
        targetKind: "thread",
      });

      return createDispatchResult({
        answeredMailboxItemIds,
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey: "assistant-outbox:intent_123",
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    const secondPass = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort,
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(secondPass).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerMessageId: "linq_message_sent",
      }),
    ]);
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledTimes(2);
    expect(recordDeliveryOutcome).toHaveBeenCalledTimes(2);
    expect(recordDeliveryOutcome.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        acceptedAt: expect.stringMatching(/Z$/u),
        answeredMailboxItemIds,
        providerMessageId: "linq_message_sent",
      }),
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

  it.each([
    {
      ambiguous: true,
      failureStage: "transport",
      method: "POST",
      path: "/attachments",
      status: undefined,
    },
    {
      ambiguous: true,
      failureStage: "http",
      method: "POST",
      path: "/attachments",
      status: 200,
    },
    {
      ambiguous: false,
      failureStage: "http",
      method: "POST",
      path: "/attachments",
      status: 400,
    },
    {
      ambiguous: false,
      failureStage: "http",
      method: "PUT",
      path: "[presigned-upload]",
      status: 503,
    },
  ] as const)(
    "classifies Linq attachment $method $failureStage status $status before the final message send",
    async ({ ambiguous, failureStage, method, path, status }) => {
      const effect = createEffect({
        bindingDeliveryTarget: "linq_chat_123",
        channel: "linq",
        explicitTarget: "linq_chat_123",
        transportIdempotent: true,
      });
      const diagnosticContext = {
        failureStage,
        method,
        operation: "create_attachment_upload",
        path,
        provider: "linq",
        retryable: false,
        ...(status === undefined ? {} : { status }),
      } satisfies Record<string, string | number | boolean | null>;
      const providerError = new VaultCliError(
        "LINQ_API_REQUEST_FAILED",
        "Linq attachment preparation failed.",
        diagnosticContext,
      );
      const recordDeliveryOutcome = vi.fn<
        NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
      >(async () => undefined);
      let capturedError: unknown = null;
      mocks.sendLinqMessage.mockRejectedValueOnce(providerError);
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
        try {
          await dependencies.sendLinq({
            idempotencyKey: "assistant-outbox:intent_123",
            message: "private image",
            replyToMessageId: null,
            target: "linq_chat_123",
            targetKind: "thread",
          });
        } catch (error) {
          capturedError = error;
          return createDispatchResult(
            {
              lastError: {
                code: providerError.code,
                message: providerError.message,
              },
              status: "failed",
            },
            {
              code: providerError.code,
              diagnosticContext,
              message: providerError.message,
            },
          );
        }

        throw new Error("Expected Linq attachment preparation to fail.");
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

      expect(capturedError).toBe(providerError);
      if (ambiguous) {
        expect(capturedError).toMatchObject({ deliveryMayHaveSucceeded: true });
      } else {
        expect(capturedError).not.toHaveProperty("deliveryMayHaveSucceeded");
      }
      expect(outcomes).toEqual([
        expect.objectContaining({
          deliveryStatus: "failed",
          retryable: false,
        }),
      ]);
      if (ambiguous) {
        expect(recordDeliveryOutcome).not.toHaveBeenCalled();
      } else {
        expect(recordDeliveryOutcome).toHaveBeenCalledWith(
          expect.objectContaining({
            failureCode: "LINQ_API_REQUEST_FAILED",
            providerMessageId: null,
          }),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      }
    },
  );

  it("records a card fallback failure under its durably promoted identity", async () => {
    const effect = createEffect({
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: false,
    });
    const providerError = Object.assign(
      new Error("Provider text fallback failed."),
      { code: "LINQ_PROVIDER_FAILED" },
    );
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => undefined);
    mocks.sendLinqMessage.mockImplementationOnce(async (...args) => {
      await args[1]?.persistAppCardTextFallback?.({
        idempotencyKey: "assistant-outbox:intent_123:fallback",
      });
      const fallbackFetch = args[1]?.appCardTextFallbackFetchImplementation;
      if (!fallbackFetch) {
        throw new Error("Expected hosted Linq fallback provider boundary.");
      }
      await fallbackFetch(
        "https://api.linq.example/chats/linq_chat_123/messages",
        { method: "POST" },
      );
      throw providerError;
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          card: {
            kind: "daily_nutrition",
            localDate: "2026-07-31",
            mealCount: 1,
            totals: {
              calories: { mealCount: 1, total: 500 },
              carbsGrams: { mealCount: 1, total: 55 },
              fatGrams: { mealCount: 1, total: 18 },
              proteinGrams: { mealCount: 1, total: 35 },
            },
          },
          idempotencyKey: "assistant-outbox:intent_123",
          message: "Nutrition summary",
          persistAppCardTextFallback,
          replyToMessageId: null,
          target: "linq_chat_123",
          targetKind: "thread",
          threadIsDirect: true,
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

      throw new Error("Expected Linq text fallback to fail.");
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
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "assistant-outbox:intent_123:fallback",
    });
    expect(recordDeliveryOutcome).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        failureCode: "ASSISTANT_LINQ_APP_CARD_REJECTED",
        idempotencyKey: "assistant-outbox:intent_123",
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        failureCode: "LINQ_PROVIDER_FAILED",
        idempotencyKey: "assistant-outbox:intent_123:fallback",
      }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("persists a recoverable Linq rich-link checkpoint before the retry settles", async () => {
    const answeredMailboxItemIds = ["mailbox_item_answered_1"];
    const effect = createEffect({
      answeredMailboxItemIds,
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      message: "Complete payment https://pay.example.test/session",
      transportIdempotent: false,
    });
    const providerError = Object.assign(
      new Error("Linq rich-link delivery failed after primary acceptance."),
      {
        code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        deliveryMayHaveSucceeded: true,
        providerMessageId: "linq_text_accepted",
        providerMessageIds: ["linq_text_accepted"],
        providerThreadId: "linq_chat_123",
        target: "linq_chat_123",
        targetKind: "thread",
      },
    );
    let releaseDeliveryOutcome: () => void = () => {};
    const deliveryOutcomeReleased = new Promise<void>((resolve) => {
      releaseDeliveryOutcome = resolve;
    });
    let markDeliveryOutcomeStarted: () => void = () => {};
    const deliveryOutcomeStarted = new Promise<void>((resolve) => {
      markDeliveryOutcomeStarted = resolve;
    });
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => {
      markDeliveryOutcomeStarted();
      await deliveryOutcomeReleased;
    });
    mocks.sendLinqMessage.mockRejectedValueOnce(providerError);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      try {
        await dependencies.sendLinq({
          answeredMailboxItemIds,
          idempotencyKey: "assistant-outbox:intent_123",
          message: "Complete payment https://pay.example.test/session",
          replyToMessageId: null,
          target: "linq_chat_123",
          targetKind: "thread",
        });
      } catch {
        return createDispatchResult({
          answeredMailboxItemIds,
          delivery: createDelivery({
            channel: "linq",
            providerMessageId: "linq_text_accepted",
            providerMessageIds: ["linq_text_accepted"],
            providerThreadId: "linq_chat_123",
            target: "linq_chat_123",
            targetKind: "thread",
          }),
          status: "retryable",
        }, {
          code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
          message: "Provider delivery requires deterministic recovery.",
        });
      }

      throw new Error("Expected Linq rich-link send to fail.");
    });

    let deliverySettled = false;
    const deliveryPromise = drainHostedPreparedAssistantDeliveries({
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
    }).finally(() => {
      deliverySettled = true;
    });

    await deliveryOutcomeStarted;
    await flushHostedRuntimeCallbackTestMicrotasks();
    expect(deliverySettled).toBe(false);
    releaseDeliveryOutcome();
    const outcomes = await deliveryPromise;

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "retryable",
        retryable: true,
      }),
    ]);
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAt: expect.stringMatching(/Z$/u),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        providerMessageId: "linq_text_accepted",
        providerMessageIds: ["linq_text_accepted"],
        providerThreadId: "linq_chat_123",
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome.mock.calls[0]?.[0])
      .not.toHaveProperty("answeredMailboxItemIds");
  });

  it("surfaces rich-link checkpoint recording failure before scheduling recovery", async () => {
    const answeredMailboxItemIds = ["mailbox_item_answered_1"];
    const providerError = Object.assign(
      new Error("Linq rich-link delivery failed after primary acceptance."),
      {
        code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        deliveryMayHaveSucceeded: true,
        providerMessageId: "linq_text_accepted",
        providerMessageIds: ["linq_text_accepted"],
        providerThreadId: "linq_chat_123",
        target: "linq_chat_123",
        targetKind: "thread",
      },
    );
    const recordDeliveryOutcome = vi.fn<
      NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>
    >(async () => {
      throw new Error("web callback unavailable");
    });
    mocks.sendLinqMessage.mockRejectedValueOnce(providerError);
    const dependencies = createHostedAssistantProgressDeliveryDependencies({
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      providerFetch: vi.fn<typeof fetch>(),
    });
    const sendLinq = dependencies.sendLinq;
    assert.ok(sendLinq);

    await expect(sendLinq({
      answeredMailboxItemIds,
      idempotencyKey: "assistant-outbox:intent_123",
      message: "Complete payment https://pay.example.test/session",
      replyToMessageId: null,
      target: "linq_chat_123",
      targetKind: "thread",
    })).rejects.toMatchObject({
      code: "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
      context: expect.objectContaining({ retryable: true }),
      deliveryMayHaveSucceeded: true,
    });
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAt: expect.stringMatching(/Z$/u),
        failureCode: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        providerMessageIds: ["linq_text_accepted"],
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(recordDeliveryOutcome.mock.calls[0]?.[0])
      .not.toHaveProperty("answeredMailboxItemIds");
  });

  it("checks egress authority for signup welcome Linq sends into existing threads", async () => {
    const effect = createEffect({
      actorId: "ain_blinded_member_phone",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      idempotencyKey: "signup-welcome:member_123",
      message: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      transportIdempotent: false,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "linq_chat_other",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15550002",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      replyToMessageId: "linq_message_other",
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

  it.each([
    [
      "transport",
      new VaultCliError(
        "LINQ_API_REQUEST_FAILED",
        "Linq request failed before a response was returned.",
        {
          failureStage: "transport",
          operation: "set_message_reaction",
          provider: "linq",
          retryable: false,
        },
      ),
    ],
    [
      "invalid success JSON",
      new SyntaxError("Linq success response contained invalid JSON."),
    ],
    [
      "incomplete success payload",
      new VaultCliError(
        "LINQ_API_REQUEST_FAILED",
        "Linq success response was missing required fields.",
        {
          failureStage: "http",
          operation: "set_message_reaction",
          provider: "linq",
          retryable: false,
        },
      ),
    ],
  ] as const)("marks post-dispatch Linq reaction %s errors as possibly committed", async (
    _failureKind,
    providerError,
  ) => {
    const effect = createEffect({
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    let capturedError: unknown = null;
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.setLinqMessageReaction.mockRejectedValueOnce(providerError);
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

      throw new Error("expected ambiguous Linq reaction failure");
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      forwardedEnv: {
        LINQ_API_TOKEN: "linq-token",
        OPENAI_API_KEY: "sk-runtime",
      },
      platformEnv: {},
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(capturedError).toMatchObject({ deliveryMayHaveSucceeded: true });
    expect(recordDeliveryOutcome).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
  });

  it("keeps an accepted Linq reaction receipt when liveness changes after the provider response", async () => {
    const effect = createEffect({
      answeredMailboxItemIds: ["mailbox_item_liveness"],
      channel: "linq",
      bindingDeliveryTarget: "linq_chat_123",
      message: "",
      replyToMessageId: "linq_message_1",
      transportIdempotent: false,
    });
    const assertLiveness = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("aborted after Linq reaction response"));
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
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(assertLiveness).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
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
      target: "linq_chat_current",
      targetKind: "thread",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      onAppCardFallbackError: expect.any(Function),
      signal: undefined,
    });
    const linqFetch = mocks.sendLinqMessage.mock.calls[0]?.[1]?.fetchImplementation;
    assert.equal(typeof linqFetch, "function");
    expect(providerFetch).toHaveBeenCalledWith("https://api.linq.example/test", {
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
    const assertRecentInbound = vi.fn(async (
      request: { authorityCheckOnly: boolean },
    ) => buildClaimedLinqEngagementResult(request));
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

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "linq_chat_current",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15550002",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      replyToMessageId: "linq_message_current",
      target: "linq_chat_current",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(assertRecentInbound.mock.calls.map(([request]) =>
      request.authorityCheckOnly
    )).toEqual([true, false]);
    expect(assertRecentInbound.mock.invocationCallOrder[0] ?? 0)
      .toBeLessThan(mocks.sendLinqMessage.mock.invocationCallOrder[0] ?? 0);
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
    const recordDeliveryOutcome = vi.fn(async () => undefined);
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
        idempotencyKey: "assistant-outbox:intent_123",
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
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
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
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550000001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550000001",
        fromPhoneNumber: "+15559990000",
        target: "linq_chat_a",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15559990000",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      replyToMessageId: "linq_message_a",
      target: "linq_chat_a",
      targetKind: "thread",
    }, {
      signal: null,
    });
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15559990000",
        idempotencyKey: "assistant-outbox:intent_123",
        target: "linq_chat_a",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15559990000",
        idempotencyKey: "assistant-outbox:intent_123",
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(recordDeliveryOutcome.mock.calls)).not.toContain(
      '"lineLookupKey"',
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_a",
      }),
    ]);
  });

  it("selects the matching reply context when rapid direct messages share a target", async () => {
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      answeredMailboxItemIds: [
        "mailbox_item_linq_old",
        "mailbox_item_linq_new",
      ],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_shared",
      channel: "linq",
      explicitTarget: "linq_chat_shared",
      replyToMessageId: "linq_message_new",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_shared",
      target: "linq_chat_shared",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds: [
          "mailbox_item_linq_old",
          "mailbox_item_linq_new",
        ],
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_shared",
        message: "reply to the latest message",
        replyToMessageId: "linq_message_new",
        target: "linq_chat_shared",
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
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      linqDeliveryContexts: [
        {
          directRecipientPhoneNumber: "+15550000001",
          fromPhoneNumber: "+15559990000",
          replyToMessageId: "linq_message_old",
          routeAuthority: null,
          service: "iMessage",
          target: "linq_chat_shared",
          threadIsDirect: true,
        },
        {
          directRecipientPhoneNumber: "+15550000001",
          fromPhoneNumber: "+15559990000",
          replyToMessageId: "linq_message_new",
          routeAuthority: null,
          service: "iMessage",
          target: "linq_chat_shared",
          threadIsDirect: true,
        },
      ],
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    for (const [request] of assertRecentInbound.mock.calls) {
      expect(request).toMatchObject({
        answeredMailboxItemIds: [
          "mailbox_item_linq_old",
          "mailbox_item_linq_new",
        ],
        replyToMessageId: "linq_message_new",
        target: "linq_chat_shared",
      });
    }
  });

  it("carries persisted answered mailbox proof when retrying without an inbound context", async () => {
    const answeredMailboxItemIds = [
      "mailbox_item_linq_retry_old",
      "mailbox_item_linq_retry_current",
    ];
    const effect = createEffect({
      answeredMailboxItemIds,
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_retry",
      channel: "linq",
      explicitTarget: "linq_chat_retry",
      replyToMessageId: "linq_message_retry_current",
      transportIdempotent: true,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.sendLinqMessage.mockResolvedValueOnce({
      providerMessageId: "linq_message_retry_sent",
      providerThreadId: "linq_chat_retry",
      target: "linq_chat_retry",
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        answeredMailboxItemIds,
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey: "assistant-outbox:intent_retry",
        message: "retry from the persisted outbox",
        replyToMessageId: "linq_message_retry_current",
        target: "linq_chat_retry",
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
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    for (const [request] of assertRecentInbound.mock.calls) {
      expect(request).toMatchObject({
        answeredMailboxItemIds,
        replyToMessageId: "linq_message_retry_current",
        target: "linq_chat_retry",
        targetKind: "thread",
      });
    }
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "linq_chat_other",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15550002",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      replyToMessageId: "linq_message_current",
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "linq_chat_current",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15550002",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_hashed_target",
      intentId: "intent_123",
      replyToMessageId: "linq_message_current",
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

      throw new Error("unreachable after egress authority failure");
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
      expect.objectContaining({ target: routeAuthority.threadId }),
      { signal: null },
    );
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      idempotencyKey: "phone-call-result:hpc_linq_route_restored",
      notification: "result",
    },
    {
      idempotencyKey: "phone-call-result:hpc_linq_route_restored:stop-settled",
      notification: "stop settlement",
    },
  ])("retries a direct Linq phone-call $notification after its exact route is restored", async ({
    idempotencyKey,
  }) => {
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_current",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_phone_result_restored",
      linqMessage: {
        chatId: routeAuthority.threadId,
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_current",
        parts: [{ type: "text", value: "hello on the routed wake" }],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "+15559990000",
      routeAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: routeAuthority.threadId,
      channel: "linq",
      explicitTarget: routeAuthority.threadId,
      idempotencyKey,
      transportIdempotent: true,
    });
    let routeAuthorized = false;
    const routeRevoked = Object.assign(new Error("route revoked"), {
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      context: { retryable: false, status: 403 },
      retryable: false,
    });
    const assertRecentInbound = vi.fn(async (request) => {
      if (!routeAuthorized) {
        throw routeRevoked;
      }
      return buildClaimedLinqEngagementResult(request);
    });
    mocks.sendLinqMessage.mockResolvedValue({
      providerMessageId: "linq_message_sent",
      providerThreadId: routeAuthority.threadId,
      target: routeAuthority.threadId,
      targetKind: "thread" as const,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: null,
        idempotencyKey,
        message: "Private phone-call result.",
        replyToMessageId: "linq_message_current",
        target: routeAuthority.threadId,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({
          channel: "linq",
          idempotencyKey,
          providerMessageId: delivery.providerMessageId,
          providerThreadId: delivery.providerThreadId,
          target: delivery.target,
          targetKind: delivery.targetKind,
        }),
        status: "sent",
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();

    routeAuthorized = true;
    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake,
    })).resolves.toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        target: routeAuthority.threadId,
      }),
    ]);

    expect(mocks.sendLinqMessage).toHaveBeenCalledTimes(1);
    expect(assertRecentInbound).toHaveBeenCalledTimes(3);
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
      read: vi.fn(),
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

      throw new Error("unreachable after egress authority failure");
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
      expect.objectContaining({ target: routeAuthority.threadId }),
      { signal: null },
    );
    expect(actionApprovalPort.request).not.toHaveBeenCalled();
    expect(actionApprovalPort.read).not.toHaveBeenCalled();
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
      read: vi.fn(),
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
    const providerFetch = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const publicInternetFetch = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch,
      publicInternetFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(actionApprovalPort.consume).toHaveBeenCalledWith({
      approvalGeneration: "b".repeat(64),
      consumerId: "assistant-outbox:intent_123",
      request: approvalRequest,
    });
    expect(actionApprovalPort.request).not.toHaveBeenCalled();
    expect(actionApprovalPort.read).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).toHaveBeenCalledWith({
      file: vaultFile,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });
    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    expect(mocks.readVerifiedAssistantVaultFileBytes.mock.invocationCallOrder[0])
      .toBeLessThan(assertRecentInbound.mock.invocationCallOrder[1]!);
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [vaultFile],
        target: "chat_123",
      }),
      expect.objectContaining({
        loadVaultFile: expect.any(Function),
        fetchImplementation: expect.any(Function),
        publicFetchImplementation: publicInternetFetch,
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

  it("does not consume vault-file approval after Linq re-homes the delivery target", async () => {
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
      bindingDeliveryTarget: "chat_old",
      channel: "linq",
      media: [vaultFile],
      transportIdempotent: true,
    });
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(),
      request: vi.fn(),
    };
    const assertRecentInbound = vi.fn(async (request) => ({
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
        conversationThreadId: "conversation-new",
        target: "chat_new",
        targetKind: "thread" as const,
        threadIsDirect: true,
      }),
    }));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          homeRouteFallbackAllowed: true,
          idempotencyKey: "assistant-outbox:intent_123",
          media: [vaultFile],
          message: "Attached.",
          replyToMessageId: null,
          target: "chat_old",
          targetKind: "thread",
        });
        throw new Error("Provider dispatch unexpectedly remained reachable.");
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      actionApprovalPort,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
      retryable: false,
    });

    expect(assertRecentInbound).toHaveBeenCalled();
    expect(actionApprovalPort.consume).not.toHaveBeenCalled();
    expect(mocks.readAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      approvedThreadIsDirect: true,
      label: "direct approval becomes a group thread",
      resolvedRoute: {
        conversationThreadId: "conversation_same",
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550100002",
        target: "chat_same",
        targetKind: "thread" as const,
        threadIsDirect: false,
      },
    },
    {
      approvedThreadIsDirect: false,
      label: "group approval becomes a direct thread",
      resolvedRoute: {
        conversationThreadId: "conversation_same",
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        target: "chat_same",
        targetKind: "thread" as const,
        threadIsDirect: true,
      },
    },
    {
      approvedThreadIsDirect: true,
      label: "thread approval becomes a participant send",
      resolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        target: "+15550100001",
        targetKind: "participant" as const,
        threadIsDirect: true,
      },
    },
  ])("does not consume vault-file approval when $label", async ({
    approvedThreadIsDirect,
    resolvedRoute,
  }) => {
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
      bindingDeliveryTarget: "chat_same",
      channel: "linq",
      explicitTarget: "chat_same",
      media: [vaultFile],
      threadIsDirect: approvedThreadIsDirect,
      transportIdempotent: true,
    });
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(),
      request: vi.fn(),
    };
    const assertRecentInbound = vi.fn(async () => ({ resolvedRoute }));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          idempotencyKey: "assistant-outbox:intent_123",
          media: [vaultFile],
          message: "Attached.",
          replyToMessageId: null,
          target: "chat_same",
          targetKind: "explicit",
        });
        throw new Error("Provider dispatch unexpectedly remained reachable.");
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      actionApprovalPort,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
      retryable: false,
    });

    expect(assertRecentInbound).toHaveBeenCalledTimes(1);
    expect(actionApprovalPort.consume).not.toHaveBeenCalled();
    expect(mocks.readAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it("does not consume vault-file approval for a redacted Linq target", async () => {
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
    const redactedTarget = "h1_111111111111111111111111";
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: redactedTarget,
      channel: "linq",
      explicitTarget: redactedTarget,
      media: [vaultFile],
      transportIdempotent: true,
    });
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(),
      request: vi.fn(),
    };
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
      async ({ dependencies }) => {
        await dependencies.sendLinq({
          homeRouteFallbackAllowed: true,
          idempotencyKey: "assistant-outbox:intent_123",
          media: [vaultFile],
          message: "Attached.",
          replyToMessageId: null,
          target: redactedTarget,
          targetKind: "thread",
        });
        throw new Error("Provider dispatch unexpectedly remained reachable.");
      },
    );

    await expect(drainHostedPreparedAssistantDeliveries({
      actionApprovalPort,
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub(),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
      retryable: false,
    });

    expect(actionApprovalPort.consume).not.toHaveBeenCalled();
    expect(mocks.readAssistantOutboxIntent).not.toHaveBeenCalled();
    expect(mocks.readVerifiedAssistantVaultFileBytes).not.toHaveBeenCalled();
    expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["denied", "ASSISTANT_VAULT_FILE_APPROVAL_DENIED"],
    ["expired", "ASSISTANT_VAULT_FILE_APPROVAL_EXPIRED"],
  ] as const)(
    "does not enter provider dispatch when vault-file approval consumption returns %s",
    async (approvalStatus, expectedCode) => {
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
          approvalId: vaultFile.approvalId,
          status: approvalStatus,
        })),
        read: vi.fn(),
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
      mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(
        async ({ dependencies }) => {
          await dependencies.sendLinq({
            idempotencyKey: "assistant-outbox:intent_123",
            media: [vaultFile],
            message: "Attached.",
            replyToMessageId: null,
            target: "chat_123",
            targetKind: "thread",
          });
          throw new Error("Provider dispatch unexpectedly remained reachable.");
        },
      );

      await expect(drainHostedPreparedAssistantDeliveries({
        actionApprovalPort,
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub(),
        providerFetch: vi.fn<typeof fetch>(
          async () => new Response(null, { status: 204 }),
        ),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      })).rejects.toMatchObject({ code: expectedCode });

      expect(actionApprovalPort.consume).toHaveBeenCalledWith({
        approvalGeneration: vaultFile.approvalGeneration,
        consumerId: "assistant-outbox:intent_123",
        request: approvalRequest,
      });
      expect(mocks.readVerifiedAssistantVaultFileBytes).not.toHaveBeenCalled();
      expect(mocks.sendLinqMessage).not.toHaveBeenCalled();
    },
  );

  it("uses providerFetch for hosted Linq voice memo deliveries when the runtime can intercept egress", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_current",
      channel: "linq",
      explicitTarget: "linq_chat_current",
      threadIsDirect: false,
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
    const assertRecentInbound = vi.fn(async (request) => ({
      ...buildClaimedLinqEngagementResult(request),
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
        directRecipientPhoneNumber: null,
        threadIsDirect: false,
      }),
    }));
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
    const recordDeliveryOutcome = vi.fn(async () => undefined);

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        assertLinqRecentInboundEngagement: assertRecentInbound,
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      providerFetch,
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });
    await drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort();

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
    expect(providerFetch).toHaveBeenCalledWith("https://api.linq.example/voice", {
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
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "linq-voice-memo:intent_123",
        providerMessageId: "linq_voice_sent",
        providerTarget: "linq_chat_current",
        providerThreadId: "linq_chat_current",
        target: "linq_chat_current",
        targetKind: "thread",
        threadIsDirect: false,
      }),
      { signal: expect.any(AbortSignal) },
    );
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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

  it("bypasses stale Linq context for proactive current-home voice memo fallback", async () => {
    const staleRouteAuthority = {
      accountLookupKey: "hbidx:phone:v1:stale-voice",
      channel: "linq" as const,
      containerMemberId: "member_123",
      threadId: "linq_chat_stale",
    };
    const staleWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_stale_voice_replay",
      linqMessage: {
        chatId: "linq_chat_stale",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_message_stale_voice",
        parts: [{ type: "text", value: "already consumed" }],
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_stale_voice",
      routeAuthority: staleRouteAuthority,
      userId: "member_123",
    });
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_stale",
      channel: "linq",
      explicitTarget: null,
      media: [createHostedVoiceMemoMedia()],
      replyToMessageId: null,
      threadIsDirect: true,
      transportIdempotent: false,
    });
    mocks.sendLinqVoiceMemoMessage.mockResolvedValueOnce({
      providerMessageId: "linq_voice_sent",
      providerThreadId: "linq_chat_current",
      target: "linq_chat_current",
      targetKind: "thread" as const,
    });
    const assertRecentInbound = vi.fn(async (request) => ({
      ...buildClaimedLinqEngagementResult(request),
      resolvedRoute: buildHostedRuntimeResolvedLinqRoute(request, {
        conversationThreadId: "conversation-current",
        directRecipientPhoneNumber: "+15550100001",
        fromPhoneNumber: "+15550100002",
        target: "linq_chat_current",
        targetKind: "thread" as const,
        threadIsDirect: true,
      }),
    }));
    const recordDeliveryOutcome = vi.fn(async () => undefined);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinqVoiceMemo({
        attachmentId: "attachment_voice_1",
        homeRouteFallbackAllowed: true,
        replyToMessageId: null,
        target: "linq_chat_stale",
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
        recordLinqDeliveryOutcome: recordDeliveryOutcome,
      }),
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: staleWake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: true,
        replyToMessageId: null,
        target: "linq_chat_stale",
        targetKind: "thread",
      }),
      { signal: null },
    );
    expect(assertRecentInbound.mock.calls.map(([request]) => [
      request.authorityCheckOnly,
      request.homeRouteFallbackAllowed,
      request.target,
    ])).toEqual([
      [true, true, "linq_chat_stale"],
      [false, false, "linq_chat_current"],
    ]);
    expect(mocks.sendLinqVoiceMemoMessage).toHaveBeenCalledWith({
      attachmentId: "attachment_voice_1",
      target: "linq_chat_current",
    }, expect.any(Object));
    expect(recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhoneNumber: "+15550100002",
        providerTarget: "linq_chat_current",
        target: "linq_chat_current",
        targetKind: "thread",
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(recordDeliveryOutcome.mock.calls)).not.toContain(
      '"lineLookupKey"',
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        target: "linq_chat_current",
      }),
    ]);
  });

  it("passes request reply anchors to hosted Linq voice memo authority checks", async () => {
    const effect = createEffect({
      actorId: "ain_hashed_actor",
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_stale",
      channel: "linq",
      explicitTarget: null,
      media: [createHostedVoiceMemoMedia()],
      replyToMessageId: "linq_message_reply",
      threadIsDirect: true,
      transportIdempotent: false,
    });
    mocks.sendLinqVoiceMemoMessage.mockResolvedValueOnce({
      providerMessageId: "linq_voice_sent",
      providerThreadId: "linq_chat_stale",
      target: "linq_chat_stale",
      targetKind: "thread" as const,
    });
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinqVoiceMemo({
        attachmentId: "attachment_voice_1",
        homeRouteFallbackAllowed: true,
        replyToMessageId: "linq_message_reply",
        target: "linq_chat_stale",
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
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(assertRecentInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        homeRouteFallbackAllowed: false,
        replyToMessageId: "linq_message_reply",
        target: "linq_chat_stale",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(assertRecentInbound).toHaveBeenCalledTimes(2);
    expect(assertRecentInbound.mock.calls.map(([request]) =>
      request.authorityCheckOnly
    )).toEqual([true, false]);
    expect(assertRecentInbound.mock.invocationCallOrder[0] ?? 0)
      .toBeLessThan(
        mocks.sendLinqVoiceMemoMessage.mock.invocationCallOrder[0] ?? 0,
      );
    expect(mocks.sendLinqVoiceMemoMessage).toHaveBeenCalledWith({
      attachmentId: "attachment_voice_1",
      target: "linq_chat_stale",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        providerThreadId: "linq_chat_stale",
        target: "linq_chat_stale",
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
        target: "linq_chat_123",
        targetKind: "thread",
      }),
      {
        signal: null,
      },
    );
    expect(JSON.stringify(effect.payload)).not.toContain("+15550001");
    expect(mocks.sendLinqMessage).toHaveBeenCalledWith({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550002",
      idempotencyKey: "assistant-outbox:intent_123",
      media: null,
      message: "hello from hosted",
      replyToMessageId: "linq_message_inbound_123",
      target: "linq_chat_123",
      targetKind: "thread",
    }, {
      env: {},
      fetchImplementation: expect.any(Function),
      onAppCardFallbackError: expect.any(Function),
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
      directRecipientPhoneNumber: "+15550001",
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
      onAppCardFallbackError: expect.any(Function),
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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
      directRecipientPhoneNumber: "+15550001",
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
      onAppCardFallbackError: expect.any(Function),
      signal: undefined,
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
  });

  it("stamps the prepared-outbox intent onto the app-card fallback log entry", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_fallback_log_intent",
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
    const logWrite = vi.fn<HostedRuntimeLogPort["write"]>(async () => ({ loggedCount: 1 }));
    mocks.sendLinqMessage.mockImplementationOnce(async (
      _request: unknown,
      dependencies: {
        onAppCardFallbackError?: (input: {
          error: unknown;
          reason: "app_card_rejected" | "capability_check_failed";
        }) => void;
      },
    ) => {
      dependencies.onAppCardFallbackError?.({
        error: new VaultCliError(
          "LINQ_API_REQUEST_FAILED",
          "Linq request POST /chats/[chat]/messages failed with HTTP 400.",
          { status: 400 },
        ),
        reason: "app_card_rejected",
      });
      return {
        providerMessageId: "linq_message_sent",
        providerThreadId: "linq_chat_current",
        target: "linq_chat_current",
        targetKind: "thread" as const,
      };
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendLinq({
        directRecipientPhoneNumber: null,
        fromPhoneNumber: "+15550002",
        idempotencyKey: `assistant-outbox:${effect.effectId}`,
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
        assertLinqRecentInboundEngagement: vi.fn(async (request) =>
          buildClaimedLinqEngagementResult(request)
        ),
      }),
      platform: { logPort: { write: logWrite } },
      providerFetch: vi.fn<typeof fetch>(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "linq",
        deliveryStatus: "sent",
      }),
    ]);
    expect(logWrite).toHaveBeenCalledTimes(1);
    const entries = logWrite.mock.calls[0]?.[0]?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      component: "outbox",
      errorCode: "LINQ_API_REQUEST_FAILED",
      eventCode: "outbox.linq_app_card_fallback_error",
      level: "warn",
      outboxIntentRef: effect.effectId,
      phase: "outbox",
      redactedJson: {
        errorStatus: 400,
        fallbackKind: "text",
        reason: "app_card_rejected",
      },
    });
    const serializedEntry = JSON.stringify(entries[0]);
    expect(serializedEntry).not.toContain("+15550001");
    expect(serializedEntry).not.toContain("+15550002");
    expect(serializedEntry).not.toContain("linq_chat_current");
  });

  it("checks egress authority for route-scoped Linq timer retries without prepared authority", async () => {
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
    const assertRecentInbound = vi.fn(async (request) =>
      buildClaimedLinqEngagementResult(request)
    );
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

    expect(assertRecentInbound).toHaveBeenLastCalledWith({
      authorityCheckOnly: false,
      directRecipientPhoneNumber: "+15550001",
      expectedResolvedRoute: {
        conversationThreadId: null,
        directRecipientPhoneNumber: "+15550001",
        fromPhoneNumber: "+15550002",
        target: "linq_chat_current",
        targetKind: "thread",
        threadIsDirect: true,
      },
      fromPhoneNumber: "+15550002",
      homeRouteFallbackAllowed: false,
      idempotencyKey: "assistant-outbox:intent_123",
      intentId: "intent_123",
      replyToMessageId: "linq_message_current",
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

  it.each([
    {
      currentTarget: "owner@example.test",
      label: "removes sender-controlled recipients",
      staleCc: ["attacker-cc@example.test"],
      staleTo: ["attacker@example.test"],
    },
    {
      currentTarget: "current@example.test",
      label: "replaces a stale owner address",
      staleCc: ["previous-cc@example.test"],
      staleTo: ["previous@example.test"],
    },
  ])("$label on a direct serialized email thread at provider entry", async ({
    currentTarget,
    staleCc,
    staleTo,
  }) => {
    const lastMessageId = "<message_parent_123@example.test>";
    const references = ["<message_root_123@example.test>"];
    const subject = "Hosted subject";
    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      cc: staleCc,
      lastMessageId,
      references,
      subject,
      to: staleTo,
    });
    const expectedHostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      cc: [],
      lastMessageId,
      references,
      subject,
      to: [currentTarget],
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: hostedEmailThreadTarget,
      channel: "email",
      explicitTarget: hostedEmailThreadTarget,
      idempotencyKey: "assistant-outbox:intent_123",
      identityId: "assistant@example.com",
      replyToMessageId: lastMessageId,
      subject,
      threadIsDirect: true,
    });
    const resolveCurrentVerifiedEmailRecipient = vi.fn(async () => currentTarget);
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
        replyToMessageId: lastMessageId,
        subject,
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
        resolveCurrentVerifiedEmailRecipient,
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(resolveCurrentVerifiedEmailRecipient).toHaveBeenCalledWith({
      signal: null,
    });
    expect(sendEmail).toHaveBeenCalledWith({
      html: null,
      idempotencyKey: "assistant-outbox:intent_123",
      message: "hello from hosted",
      groupEmailAuthorizationProof: null,
      planGroupFanout: true,
      replyToMessageId: lastMessageId,
      subject,
      target: expectedHostedEmailThreadTarget,
      targetKind: "thread",
    });
    const providerRequest = sendEmail.mock.calls[0]?.[0];
    expect(parseHostedEmailThreadTarget(providerRequest?.target)).toMatchObject({
      cc: [],
      lastMessageId,
      references: [...references, lastMessageId],
      subject,
      targetKind: "explicit",
      to: [currentTarget],
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "email",
        deliveryStatus: "sent",
        target: expectedHostedEmailThreadTarget,
      }),
    ]);
  });

  it.each([
    {
      currentTarget: "previous@example.test",
      label: "keeps an unchanged address",
    },
    {
      currentTarget: "current@example.test",
      label: "replaces a changed address",
    },
  ])("$label at direct email provider entry", async ({ currentTarget }) => {
    const effect = createEffect({
      bindingDeliveryKind: null,
      bindingDeliveryTarget: null,
      channel: "email",
      explicitTarget: "previous@example.test",
      threadId: null,
      threadIsDirect: true,
    });
    const resolveCurrentVerifiedEmailRecipient = vi.fn(async () => currentTarget);
    const sendEmail = vi.fn(async (request: HostedEmailSendRequest) =>
      createDelivery({
        channel: "email",
        ...request,
      })
    );
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        message: "Private meal closeout",
        target: "previous@example.test",
        targetKind: "explicit",
      });
      return createDispatchResult({
        delivery,
        status: "sent",
      });
    });

    const outcomes = await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        resolveCurrentVerifiedEmailRecipient,
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    });

    expect(resolveCurrentVerifiedEmailRecipient).toHaveBeenCalledWith({
      signal: null,
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      message: "Private meal closeout",
      target: currentTarget,
      targetKind: "explicit",
    }));
    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryChannel: "email",
        deliveryStatus: "sent",
        target: currentTarget,
      }),
    ]);
  });

  it.each([
    {
      label: "explicit direct email",
      target: "previous@example.test",
      targetKind: "explicit" as const,
    },
    {
      label: "direct serialized email thread",
      target: serializeHostedEmailThreadTarget({
        cc: ["attacker-cc@example.test"],
        lastMessageId: "<message_parent_123@example.test>",
        references: ["<message_root_123@example.test>"],
        subject: "Hosted subject",
        to: ["attacker@example.test"],
      }),
      targetKind: "thread" as const,
    },
  ])("fails closed before $label provider entry when verified email is cleared", async ({
    target,
    targetKind,
  }) => {
    const effect = createEffect({
      bindingDeliveryKind: targetKind === "thread" ? "thread" : null,
      bindingDeliveryTarget: targetKind === "thread" ? target : null,
      channel: "email",
      explicitTarget: target,
      threadId: null,
      threadIsDirect: true,
    });
    const sendEmail = vi.fn();
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Private meal closeout",
        target,
        targetKind,
      });
      throw new Error("unreachable without current email authority");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({
        resolveCurrentVerifiedEmailRecipient: vi.fn(async () => null),
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EMAIL_AUDIENCE_AUTHORITY_UNAVAILABLE",
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("persists one privacy-blind outbox child per planned group email recipient", async () => {
    const automationAuthority = {
      automationId: "automation_123",
      expectedUpdatedAt: "2026-07-12T11:00:00.000Z",
    };
    const automationContextReferences: NonNullable<
      AssistantOutboxIntent["automationContextReferences"]
    > = [
      { entityId: "exp_123", entityKind: "experiment" },
    ];
    const fanoutTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      actorId: "actor_123",
      answeredMailboxItemIds: ["mailbox_123"],
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fanoutTarget,
      channel: "email",
      explicitTarget: fanoutTarget,
      idempotencyKey: "assistant-outbox:intent_123",
      identityId: "identity_123",
      emailHtml: "<p>Group reply</p>",
      message: "Group reply",
      groupEmailAuthorizationProof: "a".repeat(64),
      subject: null,
      threadId: "thread_123",
      threadIsDirect: false,
    });
    const resolveCurrentVerifiedEmailRecipient = vi.fn(
      async () => "owner@example.test",
    );
    const sendEmail = vi.fn(async () => ({
      fanoutRecipientMemberIds: ["member_one", "member_two"],
      target: fanoutTarget,
    }));
    mocks.readAssistantOutboxIntent.mockResolvedValue({
      automationAuthority,
      automationContextReferences,
      intentId: "intent_123",
    } as AssistantOutboxIntent);
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        idempotencyKey: "assistant-outbox:intent_123",
        identityId: "identity_123",
        message: "Group reply",
        subject: null,
        target: fanoutTarget,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({ channel: "email", target: fanoutTarget }),
        status: "sent",
        transportResult: delivery,
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        resolveCurrentVerifiedEmailRecipient,
        sendEmail,
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(resolveCurrentVerifiedEmailRecipient).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      target: fanoutTarget,
      targetKind: "thread",
    }));
    expect(mocks.createAssistantOutboxIntent).toHaveBeenCalledTimes(2);
    const childInputs = mocks.createAssistantOutboxIntent.mock.calls.map((call) => call[0]);
    expect(childInputs.map((child) => child.dedupeToken)).toEqual([
      "hosted-email-group-recipient:intent_123:member_one",
      "hosted-email-group-recipient:intent_123:member_two",
    ]);
    expect(childInputs).toEqual(childInputs.map((child) => expect.objectContaining({
      actorId: "actor_123",
      answeredMailboxItemIds: ["mailbox_123"],
      automationAuthority,
      automationContextReferences,
      channel: "email",
      deliveryIdempotencyKey: "assistant-outbox:intent_123",
      deliveryTransportIdempotent: false,
      identityId: "identity_123",
      emailHtml: "<p>Group reply</p>",
      message: "Group reply",
      groupEmailAuthorizationProof: "a".repeat(64),
      subject: null,
      threadId: "thread_123",
      threadIsDirect: false,
      vault: HOSTED_WAKE.vaultRoot,
    })));
    expect(childInputs.map((child) =>
      parseHostedEmailThreadTarget(child.explicitTarget)?.recipientMemberId
    )).toEqual(["member_one", "member_two"]);
    expect(mocks.readAssistantOutboxIntent).toHaveBeenCalledWith(
      HOSTED_WAKE.vaultRoot,
      "intent_123",
    );
  });

  it("fails before recipient sends when the group email parent authority is unavailable", async () => {
    const fanoutTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fanoutTarget,
      channel: "email",
      explicitTarget: fanoutTarget,
      threadIsDirect: false,
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        message: "Group reply",
        target: fanoutTarget,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({ channel: "email", target: fanoutTarget }),
        status: "sent",
        transportResult: delivery,
      });
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        sendEmail: vi.fn(async () => ({
          fanoutRecipientMemberIds: ["member_one"],
          target: fanoutTarget,
        })),
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toMatchObject({
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(mocks.createAssistantOutboxIntent).not.toHaveBeenCalled();
  });

  it("does not recreate sent, ambiguous, or exhausted group-email recipients from the same parent attempt", async () => {
    const fanoutTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Group subject",
      targetKind: "group",
    });
    const deliveryIdempotencyKey =
      "group-email-effect:automation_123:2026-07-12T13:00:00.000Z:group_123";
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fanoutTarget,
      channel: "email",
      explicitTarget: fanoutTarget,
      idempotencyKey: deliveryIdempotencyKey,
      threadIsDirect: false,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValue({
      automationAuthority: {
        automationId: "automation_123",
        expectedUpdatedAt: "2026-07-12T11:00:00.000Z",
      },
      intentId: "intent_123",
    } as AssistantOutboxIntent);
    const existingRecipient = (
      memberId: string,
      status: "abandoned" | "failed" | "sent",
      errorCode: string | null,
    ) => ({
      deliveryIdempotencyKey,
      explicitTarget: serializeHostedEmailThreadTarget({
        groupId: "group_123",
        recipientMemberId: memberId,
        subject: "Group subject",
        targetKind: "group",
      }),
      lastError: errorCode ? { code: errorCode, message: "terminal" } : null,
      status,
      turnId: "turn_123",
    }) as AssistantOutboxIntent;
    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      existingRecipient("member_one", "sent", null),
      existingRecipient(
        "member_two",
        "abandoned",
        "ASSISTANT_DELIVERY_AMBIGUOUS",
      ),
      existingRecipient(
        "member_three",
        "failed",
        "ASSISTANT_DELIVERY_RETRY_EXHAUSTED",
      ),
    ]);
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        message: "Group reply",
        target: fanoutTarget,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({ channel: "email", target: fanoutTarget }),
        status: "sent",
        transportResult: delivery,
      });
    });

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        sendEmail: vi.fn(async () => ({
          fanoutRecipientMemberIds: ["member_one", "member_two", "member_three"],
          target: fanoutTarget,
        })),
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.createAssistantOutboxIntent).not.toHaveBeenCalled();

    mocks.listAssistantOutboxIntents.mockResolvedValueOnce([
      existingRecipient("member_one", "sent", null),
      existingRecipient(
        "member_two",
        "abandoned",
        "ASSISTANT_DELIVERY_AMBIGUOUS",
      ),
      existingRecipient(
        "member_three",
        "failed",
        "ASSISTANT_DELIVERY_RETRY_EXHAUSTED",
      ),
    ].map((intent) => ({ ...intent, turnId: "turn_previous" })));

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({
        sendEmail: vi.fn(async () => ({
          fanoutRecipientMemberIds: ["member_one", "member_two", "member_three"],
          target: fanoutTarget,
        })),
      }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.createAssistantOutboxIntent).toHaveBeenCalledTimes(2);
    expect(mocks.createAssistantOutboxIntent.mock.calls.map((call) =>
      parseHostedEmailThreadTarget(call[0].explicitTarget)?.recipientMemberId
    )).toEqual(["member_one", "member_two"]);
  });

  it("keeps partial group fanout intent persistence replayable", async () => {
    const fanoutTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fanoutTarget,
      channel: "email",
      explicitTarget: fanoutTarget,
      threadIsDirect: false,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValue({
      intentId: "intent_123",
    } as AssistantOutboxIntent);
    const sendEmail = vi.fn(async () => ({
      fanoutRecipientMemberIds: ["member_one", "member_two"],
      target: fanoutTarget,
    }));
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async ({ dependencies }) => {
      const delivery = await dependencies.sendEmail({
        message: "Group reply",
        target: fanoutTarget,
        targetKind: "thread",
      });
      return createDispatchResult({
        delivery: createDelivery({ channel: "email", target: fanoutTarget }),
        status: "sent",
        transportResult: delivery,
      });
    });
    const persistenceError = new Error("child intent persistence failed");
    mocks.createAssistantOutboxIntent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(persistenceError);

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    })).rejects.toBe(persistenceError);
    expect(persistenceError).toMatchObject({
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(mocks.createAssistantOutboxIntent.mock.calls.map(
      (call) => call[0].dedupeToken,
    )).toEqual([
      "hosted-email-group-recipient:intent_123:member_one",
      "hosted-email-group-recipient:intent_123:member_two",
    ]);

    mocks.createAssistantOutboxIntent.mockClear();
    mocks.createAssistantOutboxIntent.mockResolvedValue(undefined);
    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.createAssistantOutboxIntent.mock.calls.map(
      (call) => call[0].dedupeToken,
    )).toEqual([
      "hosted-email-group-recipient:intent_123:member_one",
      "hosted-email-group-recipient:intent_123:member_two",
    ]);
    expect(mocks.createAssistantOutboxIntent.mock.calls.every(
      (call) => call[0].automationAuthority === null,
    )).toBe(true);
  });

  it("marks a lost group-recipient email response as terminally ambiguous", async () => {
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: recipientTarget,
      channel: "email",
      explicitTarget: recipientTarget,
      threadIsDirect: false,
    });
    const sendEmail = vi.fn(async () => {
      throw new Error("hosted email response was lost");
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Group reply",
        target: recipientTarget,
        targetKind: "thread",
      });
      throw new Error("expected group-recipient ambiguity");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE",
      deliveryMayHaveSucceeded: true,
      retryable: false,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost group-email planner response replayable", async () => {
    const fanoutTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: fanoutTarget,
      channel: "email",
      explicitTarget: fanoutTarget,
      threadIsDirect: false,
    });
    const responseError = new Error("hosted email planner response was lost");
    const sendEmail = vi.fn(async () => {
      throw responseError;
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Group reply",
        target: fanoutTarget,
        targetKind: "thread",
      });
      throw new Error("expected planner response failure");
    });

    let capturedError: unknown = null;
    try {
      await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBe(responseError);
    expect(capturedError).toMatchObject({
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("preserves typed pre-provider group-recipient failures", async () => {
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: recipientTarget,
      channel: "email",
      explicitTarget: recipientTarget,
      threadIsDirect: false,
    });
    const preProviderError = Object.assign(new Error("provider entry was rejected"), {
      deliveryMayHaveSucceeded: false as const,
      retryable: true as const,
    });
    const sendEmail = vi.fn(async () => {
      throw preProviderError;
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Group reply",
        target: recipientTarget,
        targetKind: "thread",
      });
      throw new Error("expected typed pre-provider rejection");
    });

    let capturedError: unknown = null;
    try {
      await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBe(preProviderError);
    expect(capturedError).toMatchObject({
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("marks post-send group-recipient liveness loss as terminally ambiguous", async () => {
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: recipientTarget,
      channel: "email",
      explicitTarget: recipientTarget,
      threadIsDirect: false,
    });
    const assertLiveness = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("delivery authority expired after provider response"));
    const sendEmail = vi.fn(async () => ({
      delivery: {
        failedCount: 0,
        sentCount: 1,
        skippedCount: 0,
        status: "sent" as const,
      },
      target: recipientTarget,
    }));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Group reply",
        target: recipientTarget,
        targetKind: "thread",
      });
      throw new Error("expected post-send ambiguity");
    });

    await expect(drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      assertLiveness,
      effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
      vaultRoot: HOSTED_WAKE.vaultRoot,
      wake: HOSTED_WAKE.wake,
    })).rejects.toMatchObject({
      code: "ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE",
      deliveryMayHaveSucceeded: true,
      retryable: false,
    });
    expect(assertLiveness).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps a skipped group recipient outside provider ambiguity", async () => {
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Group subject",
      targetKind: "group",
    });
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: recipientTarget,
      channel: "email",
      explicitTarget: recipientTarget,
      threadIsDirect: false,
    });
    const livenessError = new Error("delivery authority expired after recipient skip");
    const assertLiveness = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(livenessError);
    const sendEmail = vi.fn(async () => ({
      delivery: {
        failedCount: 0,
        sentCount: 0,
        skippedCount: 1,
        status: "failed" as const,
      },
      target: recipientTarget,
    }));
    mocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ dependencies }) => {
      await dependencies.sendEmail({
        message: "Group reply",
        target: recipientTarget,
        targetKind: "thread",
      });
      throw new Error("expected post-skip liveness failure");
    });

    let capturedError: unknown = null;
    try {
      await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [effect],
        assertLiveness,
        effectsPort: createHostedRuntimeEffectsPortStub({ sendEmail }),
        vaultRoot: HOSTED_WAKE.vaultRoot,
        wake: HOSTED_WAKE.wake,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBe(livenessError);
    expect(capturedError).not.toHaveProperty("deliveryMayHaveSucceeded");
    expect(assertLiveness).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
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

  it("logs bounded Linq attachment diagnostics without provider request details", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "linq_chat_123",
      channel: "linq",
      explicitTarget: "linq_chat_123",
      transportIdempotent: true,
    });
    const deliveryError = {
      code: "LINQ_API_REQUEST_FAILED",
      diagnosticContext: {
        authorization: "Bearer <REDACTED_TOKEN>",
        failureStage: "transport",
        method: "PUT",
        operation: "create_attachment_upload",
        path: "https://uploads.example.test/private-object?signature=private",
        requestOrigin: "https://uploads.example.test",
        retryable: false,
        timedOut: true,
        transportErrorName: "AbortError",
      },
      message: "Linq attachment upload timed out.",
    };
    mocks.dispatchAssistantOutboxIntent.mockResolvedValueOnce(
      createDispatchResult(
        {
          lastError: deliveryError,
          status: "failed",
        },
        deliveryError,
      ),
    );

    await drainHostedPreparedAssistantDeliveries({
      assistantDeliveryEffects: [effect],
      wake: HOSTED_WAKE.wake,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      vaultRoot: HOSTED_WAKE.vaultRoot,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          deliveryErrorDetailFailureStage: "transport",
          deliveryErrorDetailMethod: "PUT",
          deliveryErrorDetailOperation: "create_attachment_upload",
          deliveryErrorDetailRetryable: false,
          deliveryErrorDetailTimedOut: true,
          deliveryErrorDetailTransportErrorName: "AbortError",
        }),
        message: "Hosted assistant delivery finished with failed status.",
      }),
    );
    const serializedLogs = JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls);
    expect(serializedLogs).not.toContain("REDACTED_TOKEN");
    expect(serializedLogs).not.toContain("private-object");
    expect(serializedLogs).not.toContain("uploads.example.test");
  });

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
