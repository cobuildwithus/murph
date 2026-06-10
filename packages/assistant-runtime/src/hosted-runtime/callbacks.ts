import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPhase,
} from "@murphai/hosted-execution/side-effects";
import {
  beginAssistantOutboxIntentMirrorDispatch,
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  normalizeAssistantDeliveryError,
  sendTelegramMessage,
  sendWhatsAppMessage,
  readAssistantOutboxIntentMirrorState,
  resetAssistantOutboxPreparedDispatchById,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantHostedProgressDeliveryDependencies,
} from "@murphai/assistant-engine";
import type {
  AssistantOutboxIntent,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import type {
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";
import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
  buildHostedWhatsAppChannelEnv,
} from "./channel-activity.ts";
import {
  sendHostedProviderLinqMessage,
} from "../hosted-provider-effects.ts";
import {
  buildHostedAssistantLinqDeliveryContextFromWake,
  resolveHostedAssistantLinqDeliveryContextForRequest,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import {
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";

const HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS = 1;
const HOSTED_ASSISTANT_DELIVERY_BOUNDARY = "hosted_runtime_outbox";
const HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS = 2 * 60 * 1000;
const HOSTED_IDEMPOTENT_SENDING_RETRY_MS = 10 * 60 * 1000;

type HostedAssistantDeliveryDetails = Record<string, boolean | null | string>;

export interface CollectHostedAssistantDeliverySideEffectsInput {
  includeBackgroundDueIntents: boolean;
  preferredIntentIds?: readonly string[];
  vaultRoot: string;
}

export async function collectHostedAssistantDeliverySideEffects(
  input: CollectHostedAssistantDeliverySideEffectsInput,
): Promise<HostedAssistantDeliveryEffect[]> {
  const request = {
    includeBackgroundDueIntents: input.includeBackgroundDueIntents,
    preferredIntentIds: input.preferredIntentIds ?? [],
    vaultRoot: input.vaultRoot,
  };
  const now = new Date();
  const intents = await listAssistantOutboxIntents(request.vaultRoot);
  const preferredIntentOrder = new Map(
    request.preferredIntentIds.map((intentId, index) => [intentId, index] as const),
  );

  const candidates: AssistantOutboxIntent[] = [];
  for (const intent of intents) {
    const preparedIdempotentSending =
      isHostedPreparedIdempotentSendingIntent(intent);
    if (intent.status === "sending") {
      const mirrorState = await readAssistantOutboxIntentMirrorState({
        intentId: intent.intentId,
        now,
        sendingGraceMs: HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS,
        vault: request.vaultRoot,
      });
      if (!preparedIdempotentSending && !mirrorState.sendingPastGraceWindow) {
        continue;
      }
      if (!intent.deliveryTransportIdempotent) {
        continue;
      }
    }

    if (
      intent.status === "retryable"
      && !intent.deliveryTransportIdempotent
      && intent.lastError?.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
    ) {
      continue;
    }

    if (
      !preparedIdempotentSending
      && !shouldDispatchAssistantOutboxIntent(intent, now)
    ) {
      continue;
    }

    candidates.push(intent);
  }

  const foregroundCandidates = candidates
    .filter((intent) => preferredIntentOrder.has(intent.intentId))
    .sort((left, right) =>
      readPreferredHostedAssistantDeliveryIntentOrder(left, preferredIntentOrder)
      - readPreferredHostedAssistantDeliveryIntentOrder(right, preferredIntentOrder)
      || compareHostedAssistantDeliveryCandidateIntents(left, right)
    );
  const backgroundCandidates = request.includeBackgroundDueIntents
    ? candidates
        .filter((intent) => !preferredIntentOrder.has(intent.intentId))
        .sort(compareHostedAssistantDeliveryCandidateIntents)
    : [];
  const cappedBackgroundCandidates = backgroundCandidates.slice(
    0,
    Math.max(
      0,
      HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS - foregroundCandidates.length,
    ),
  );
  const effects = [
    ...foregroundCandidates.map((intent) =>
      buildHostedAssistantDeliveryEffectFromIntent(intent, "foreground_current_turn")
    ),
    ...cappedBackgroundCandidates.map((intent) =>
      buildHostedAssistantDeliveryEffectFromIntent(intent, "background_retry")
    ),
  ];

  return effects;
}

function buildHostedAssistantDeliveryEffectFromIntent(
  intent: AssistantOutboxIntent,
  deliveryPhase: HostedAssistantDeliveryPhase,
): HostedAssistantDeliveryEffect {
  return buildHostedAssistantDeliveryEffect({
    dedupeKey: intent.dedupeKey,
    deliveryPhase,
    effectId: intent.intentId,
    payload: buildHostedAssistantDeliveryPayloadFromIntent(intent),
  });
}

function readPreferredHostedAssistantDeliveryIntentOrder(
  intent: AssistantOutboxIntent,
  preferredIntentOrder: ReadonlyMap<string, number>,
): number {
  return preferredIntentOrder.get(intent.intentId) ?? Number.MAX_SAFE_INTEGER;
}

function compareHostedAssistantDeliveryCandidateIntents(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  const priorityDelta =
    readHostedAssistantDeliveryCandidatePriority(left)
    - readHostedAssistantDeliveryCandidatePriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta =
    readHostedAssistantDeliveryCandidateCreatedAt(left)
      .localeCompare(readHostedAssistantDeliveryCandidateCreatedAt(right));
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return left.intentId.localeCompare(right.intentId);
}

function readHostedAssistantDeliveryCandidatePriority(
  intent: AssistantOutboxIntent,
): number {
  switch (intent.status) {
    case "pending":
      return 0;
    case "retryable":
      return 1;
    case "sending":
      return 2;
    default:
      return 3;
  }
}

function readHostedAssistantDeliveryCandidateCreatedAt(
  intent: AssistantOutboxIntent,
): string {
  return typeof intent.createdAt === "string" ? intent.createdAt : "";
}

export async function resolveHostedAssistantOutboxNextWakeAt(input: {
  now?: Date;
  vaultRoot: string;
}): Promise<string | null> {
  const now = input.now ?? new Date();
  const intents = await listAssistantOutboxIntents(input.vaultRoot);
  let wakeAt: string | null = null;

  for (const intent of intents) {
    const candidate = resolveHostedAssistantOutboxIntentWakeAt(intent, now);
    if (!candidate) {
      continue;
    }
    if (!wakeAt || candidate < wakeAt) {
      wakeAt = candidate;
    }
  }

  return wakeAt;
}

function resolveHostedAssistantOutboxIntentWakeAt(
  intent: AssistantOutboxIntent,
  now: Date,
): string | null {
  switch (intent.status) {
    case "pending":
    case "retryable": {
      if (
        intent.status === "retryable"
        && !intent.deliveryTransportIdempotent
        && intent.lastError?.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
      ) {
        return null;
      }
      const nextAttemptMs = intent.nextAttemptAt ? Date.parse(intent.nextAttemptAt) : Number.NaN;
      if (!Number.isFinite(nextAttemptMs) || nextAttemptMs <= now.getTime()) {
        return now.toISOString();
      }
      return new Date(nextAttemptMs).toISOString();
    }
    case "sending": {
      if (isHostedPreparedIdempotentSendingIntent(intent)) {
        return now.toISOString();
      }
      const startedAtMs = intent.lastAttemptAt ? Date.parse(intent.lastAttemptAt) : Number.NaN;
      if (!Number.isFinite(startedAtMs)) {
        return intent.deliveryTransportIdempotent ? now.toISOString() : null;
      }
      const delayMs = intent.deliveryTransportIdempotent
        ? HOSTED_IDEMPOTENT_SENDING_RETRY_MS
        : HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS;
      const wakeMs = startedAtMs + delayMs;
      if (wakeMs <= now.getTime() && !intent.deliveryTransportIdempotent) {
        return null;
      }
      return new Date(Math.max(wakeMs, now.getTime())).toISOString();
    }
    default:
      return null;
  }
}

function isHostedPreparedIdempotentSendingIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.status === "sending"
    && intent.deliveryTransportIdempotent === true
    && typeof intent.deliveryIdempotencyKey === "string"
    && intent.deliveryIdempotencyKey.trim().length > 0
    && !intent.delivery
    && intent.deliveryConfirmationPending !== true;
}

export async function prepareHostedAssistantDeliveryEffectsForDispatch(input: {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  now?: () => string;
  vaultRoot: string;
}): Promise<void> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  for (const effect of input.assistantDeliveryEffects) {
    await beginAssistantOutboxIntentMirrorDispatch({
      deliveryIdempotencyKey: effect.payload.idempotencyKey,
      deliveryTransportIdempotent: effect.payload.transportIdempotent,
      intentId: effect.effectId,
      startedAt,
      vault: input.vaultRoot,
    });
  }
}

export function createHostedAssistantProgressDeliveryDependencies(input: {
  forwardedEnv?: Readonly<Record<string, string>>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal | null;
  userEnv?: Readonly<Record<string, string>>;
  wake?: HostedRuntimeEvent | null;
}): AssistantHostedProgressDeliveryDependencies {
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;

  return {
    ...(input.signal ? { signal: input.signal } : {}),
    sendLinq: createHostedAssistantLinqSendDependency({
      linqEnv,
      linqDeliveryContext: input.linqDeliveryContext
        ?? (input.wake ? buildHostedAssistantLinqDeliveryContextFromWake(input.wake) : null),
      providerFetch: input.providerFetch ?? null,
      signal: input.signal ?? null,
    }),
  };
}

export async function drainHostedPreparedAssistantDeliveries(input: {
  allowPreparedSending?: boolean;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  assertLiveness?: () => Promise<void>;
  forwardedEnv?: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal | null;
  userEnv?: Readonly<Record<string, string>>;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome[]> {
  const telegramEnv = buildHostedTelegramChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;
  const whatsAppEnv = buildHostedWhatsAppChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const outcomes: HostedAssistantDeliveryOutcome[] = [];
  for (const assistantDeliveryEffect of input.assistantDeliveryEffects) {
    assertHostedDeliveryLiveness(input.signal);
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: assistantDeliveryEffect.fingerprint,
        effectId: assistantDeliveryEffect.effectId,
        extra: {
          deliveryPhase: assistantDeliveryEffect.deliveryPhase,
          eventType: assistantDeliveryEffect.deliveryPhase === "foreground_current_turn"
            ? "assistant.delivery.foreground_started"
            : "assistant.delivery.background_started",
        },
        userId: input.wake.userId,
      }),
      wake: input.wake,
      message: assistantDeliveryEffect.deliveryPhase === "foreground_current_turn"
        ? "Hosted assistant foreground delivery starting."
        : "Hosted assistant background delivery starting.",
      phase: "outbox",
      userId: input.wake.userId,
    });
    outcomes.push(await deliverHostedPreparedAssistantDelivery({
      wake: input.wake,
      effectsPort: input.effectsPort,
      allowPreparedSending: input.allowPreparedSending === true,
      assertLiveness: input.assertLiveness,
      assistantDeliveryEffect,
      signal: input.signal ?? null,
      linqEnv,
      telegramEnv,
      whatsAppEnv,
      providerFetch: input.providerFetch ?? null,
      userId: input.wake.userId,
      vaultRoot: input.vaultRoot,
    }));
    assertHostedDeliveryLiveness(input.signal);
  }

  return outcomes;
}

async function deliverHostedPreparedAssistantDelivery(input: {
  allowPreparedSending: boolean;
  wake: HostedRuntimeEvent;
  effectsPort: HostedRuntimeEffectsPort;
  assertLiveness?: () => Promise<void>;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  signal: AbortSignal | null;
  linqEnv: NodeJS.ProcessEnv;
  telegramEnv: NodeJS.ProcessEnv;
  whatsAppEnv: NodeJS.ProcessEnv;
  providerFetch: typeof fetch | null;
  userId: string;
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryOutcome> {
  const now = new Date();
  const mirrorState = await readAssistantOutboxIntentMirrorState({
    intentId: input.assistantDeliveryEffect.effectId,
    now,
    sendingGraceMs: HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS,
    vault: input.vaultRoot,
  });
  let providerDispatchEntered = false;
  try {
    assertHostedDeliveryLiveness(input.signal);
    const mirrorOutcome = await maybeResolveHostedAssistantDeliveryFromMirror({
      allowPreparedSending: input.allowPreparedSending,
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      mirrorState,
      now,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    if (mirrorOutcome) {
      return mirrorOutcome;
    }

    assertHostedDeliveryLiveness(input.signal);
    assertSupportedHostedAssistantDeliveryPayload(input.assistantDeliveryEffect.payload);
    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendEmail: async (request) => {
          if (request.targetKind === "participant") {
            throw new VaultCliError(
              "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
              "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
            );
          }

          await assertHostedDeliveryLiveNow(input);
          providerDispatchEntered = true;
          // The binding identityId is a privacy-blinded conversation identifier,
          // never a sender address. Hosted email always sends from the
          // config-owned sender, so it is intentionally not forwarded.
          const result = await input.effectsPort.sendEmail({
            idempotencyKey: request.idempotencyKey ?? null,
            message: request.message,
            replyToMessageId: request.replyToMessageId ?? null,
            subject: request.subject ?? null,
            target: request.target,
            targetKind: request.targetKind,
          });
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendTelegram: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
            env: input.telegramEnv,
            fetchImplementation: input.providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant Telegram delivery");
          providerDispatchEntered = true;
          const result = await sendTelegramMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendLinq: createHostedAssistantLinqSendDependency({
          assertLiveness: input.assertLiveness,
          linqEnv: input.linqEnv,
          linqDeliveryContext: input.wake
            ? buildHostedAssistantLinqDeliveryContextFromWake(input.wake)
            : null,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          providerFetch: input.providerFetch,
          signal: input.signal,
        }),
        sendWhatsApp: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
            env: input.whatsAppEnv,
            fetchImplementation: input.providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant WhatsApp delivery");
          providerDispatchEntered = true;
          const result = await sendWhatsAppMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
      },
      intentId: input.assistantDeliveryEffect.effectId,
      now,
      ...(input.allowPreparedSending ? { allowPreparedSending: true } : {}),
      vault: input.vaultRoot,
    });
    const resetDispatchResult = await maybeResetHostedPreparedDeliveryAfterPreProviderAbort({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      mirrorState,
      providerDispatchEntered,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
    if (resetDispatchResult) {
      return await buildHostedAssistantDeliveryDispatchResult({
        assistantDeliveryEffect: input.assistantDeliveryEffect,
        dispatchResult: resetDispatchResult,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
    assertHostedDeliveryLiveness(input.signal);
    return await buildHostedAssistantDeliveryDispatchResult({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    if (shouldResetHostedPreparedDeliveryOnPreProviderAbort({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      mirrorState,
      providerDispatchEntered,
      signal: input.signal,
    })) {
      await resetAssistantOutboxPreparedDispatchById({
        deliveryIdempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey,
        deliveryTransportIdempotent: input.assistantDeliveryEffect.payload.transportIdempotent,
        intentId: input.assistantDeliveryEffect.effectId,
        preparedAt: mirrorState.sendingStartedAt,
        resetAt: new Date(),
        vault: input.vaultRoot,
      });
    }
    const enrichedError = attachHostedAssistantDeliveryDispatchDetails(error, {
      effectId: input.assistantDeliveryEffect.effectId,
      fingerprint: input.assistantDeliveryEffect.fingerprint,
      userId: input.userId,
    });
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.assistantDeliveryEffect.fingerprint,
        effectId: input.assistantDeliveryEffect.effectId,
        extra: {
          failureDomain: "delivery",
          retryable: readHostedAssistantDeliveryRetryableFlag(error),
        },
        userId: input.userId,
      }),
      wake: input.wake,
      error: enrichedError,
      message: "Hosted assistant delivery threw.",
      phase: "outbox",
      userId: input.userId,
    });
    throw enrichedError;
  }
}

async function maybeResetHostedPreparedDeliveryAfterPreProviderAbort(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  dispatchResult: Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>>;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  providerDispatchEntered: boolean;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>> | null> {
  if (!shouldResetHostedPreparedDeliveryOnPreProviderAbort({
    assistantDeliveryEffect: input.assistantDeliveryEffect,
    mirrorState: input.mirrorState,
    providerDispatchEntered: input.providerDispatchEntered,
    signal: input.signal,
  })) {
    return null;
  }

  const reset = await resetAssistantOutboxPreparedDispatchById({
    deliveryIdempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey,
    deliveryTransportIdempotent: input.assistantDeliveryEffect.payload.transportIdempotent,
    intentId: input.assistantDeliveryEffect.effectId,
    preparedAt: input.mirrorState.sendingStartedAt,
    resetAt: new Date(),
    vault: input.vaultRoot,
  });
  if (!reset) {
    return null;
  }

  return {
    ...input.dispatchResult,
    deliveryError: reset.lastError ?? input.dispatchResult.deliveryError,
    intent: reset,
  };
}

function shouldResetHostedPreparedDeliveryOnPreProviderAbort(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  providerDispatchEntered: boolean;
  signal: AbortSignal | null;
}): boolean {
  return input.signal?.aborted === true
    && input.mirrorState.sendingStartedAt !== null
    && !input.mirrorState.intent?.delivery
    && input.mirrorState.intent?.deliveryConfirmationPending !== true
    && !input.providerDispatchEntered;
}

function createHostedAssistantLinqSendDependency(input: {
  assertLiveness?: () => Promise<void>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqEnv: NodeJS.ProcessEnv;
  onProviderDispatchEntered?: () => void;
  providerFetch: typeof fetch | null;
  signal: AbortSignal | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinq"]> {
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const deliveryContext = resolveHostedAssistantLinqDeliveryContextForRequest({
      context: input.linqDeliveryContext ?? null,
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    });
    const directRecipientPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.directRecipientPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.directRecipientPhoneNumber);
    const fromPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.fromPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.fromPhoneNumber);
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.linqEnv,
      fetchImplementation: input.providerFetch,
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq delivery");
    input.onProviderDispatchEntered?.();
    const result = await sendHostedProviderLinqMessage({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: request.idempotencyKey ?? null,
      media: request.media ?? null,
      message: request.message,
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    }, dependencies);
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
}

function normalizeHostedLinqDirectRecipient(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.startsWith("+") ? normalized : null;
}

function mergeHostedAssistantLinqSignals(
  first: AbortSignal | null,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) {
    return second;
  }
  if (!second || first === second) {
    return first;
  }
  return AbortSignal.any([first, second]);
}

async function assertHostedDeliveryLiveNow(input: {
  assertLiveness?: () => Promise<void>;
  signal: AbortSignal | null;
}): Promise<void> {
  assertHostedDeliveryLiveness(input.signal);
  await input.assertLiveness?.();
  assertHostedDeliveryLiveness(input.signal);
}

function assertHostedDeliveryLiveness(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Hosted assistant delivery was aborted.");
}

async function maybeResolveHostedAssistantDeliveryFromMirror(input: {
  allowPreparedSending?: boolean;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  now: Date;
  userId: string;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome | null> {
  const intent = input.mirrorState.intent;
  if (!intent) {
    const missingResult = {
      code: "ASSISTANT_DELIVERY_MISSING_RESULT",
      message: "The assistant outbox mirror did not contain the committed delivery intent.",
    };
    emitHostedAssistantDeliveryDispatchOutcome({
      deliveryError: missingResult,
      deliveryStatus: "missing-result",
      wake: input.wake,
      effect: input.assistantDeliveryEffect,
      retryable: false,
      userId: input.userId,
    });
    return buildHostedAssistantDeliveryOutcome({
      deliveryErrorCode: missingResult.code,
      deliveryErrorMessage: missingResult.message,
      deliveryStatus: "missing-result",
      effect: input.assistantDeliveryEffect,
      retryable: false,
    });
  }

  switch (intent.status) {
    case "sent": {
      if (!intent.delivery) {
        return buildHostedAssistantDeliveryOutcome({
          deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
          deliveryErrorMessage: "The assistant outbox mirror marked the delivery sent without a receipt.",
          deliveryStatus: "missing-result",
          effect: input.assistantDeliveryEffect,
          retryable: false,
        });
      }
      emitHostedAssistantDeliveryDispatchSuccess({
        delivery: intent.delivery,
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        delivery: intent.delivery,
        deliveryStatus: "sent",
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "failed": {
      const failure = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded a terminal delivery failure.",
        lastError: intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: failure,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: failure.code,
        deliveryErrorMessage: failure.message,
        deliveryStatus: "failed",
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "abandoned": {
      const ambiguousError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded an abandoned delivery attempt.",
        lastError: intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        delivery: intent.delivery ?? null,
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "retryable": {
      if (shouldDispatchAssistantOutboxIntent(intent, input.now)) {
        return null;
      }
      const retryableError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror scheduled the next retry attempt.",
        lastError: intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: retryableError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: retryableError.code,
        deliveryErrorMessage: retryableError.message,
        deliveryStatus: "retryable",
        effect: input.assistantDeliveryEffect,
        retryable: true,
      });
    }
    case "sending": {
      if (input.allowPreparedSending === true) {
        return null;
      }
      if (!input.mirrorState.sendingPastGraceWindow) {
        emitHostedAssistantDeliveryDispatchOutcome({
          deliveryError: null,
          deliveryStatus: "sending",
          wake: input.wake,
          effect: input.assistantDeliveryEffect,
          retryable: true,
          userId: input.userId,
        });
        return buildHostedAssistantDeliveryOutcome({
          deliveryStatus: "sending",
          effect: input.assistantDeliveryEffect,
          retryable: true,
        });
      }

      if (isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)) {
        return null;
      }

      const confirmationPending = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage:
          "The assistant outbox mirror remained in sending state past the confirmation grace window.",
        lastError: intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: confirmationPending,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: confirmationPending.code,
        deliveryErrorMessage: confirmationPending.message,
        deliveryStatus: "sending",
        delivery: intent.delivery ?? null,
        effect: input.assistantDeliveryEffect,
        retryable: true,
      });
    }
    default:
      return null;
  }
}

function emitHostedAssistantDeliveryDispatchSuccess(input: {
  delivery: AssistantChannelDelivery;
  wake: HostedRuntimeEvent;
  effect: HostedAssistantDeliveryEffect;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: buildHostedAssistantDeliveryDetails({
      effectFingerprint: input.effect.fingerprint,
      effectId: input.effect.effectId,
      extra: {
        deliveryChannel: input.delivery.channel,
        deliveryPhase: input.effect.deliveryPhase,
        deliveryStatus: "sent",
        eventType: "assistant.delivery.sent",
        failureDomain: "delivery",
        retryable: false,
        targetKind: input.delivery.targetKind,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    message: "Hosted assistant delivery sent.",
    phase: "outbox",
    userId: input.userId,
  });
}

function emitHostedAssistantDeliveryDispatchOutcome(input: {
  deliveryError: { code: string | null; message: string } | null;
  deliveryStatus:
    | "failed"
    | "failed_ambiguous"
    | "missing-result"
    | "retryable"
    | "sending";
  wake: HostedRuntimeEvent;
  effect: HostedAssistantDeliveryEffect;
  retryable: boolean;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: buildHostedAssistantDeliveryDetails({
      effectFingerprint: input.effect.fingerprint,
      effectId: input.effect.effectId,
      extra: {
        deliveryErrorCode: input.deliveryError?.code ?? null,
        deliveryErrorMessage: input.deliveryError?.message ?? null,
        deliveryPhase: input.effect.deliveryPhase,
        deliveryStatus: input.deliveryStatus,
        failureDomain: "delivery",
        retryable: input.retryable,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    level: input.retryable ? "warn" : "error",
    message: `Hosted assistant delivery finished with ${input.deliveryStatus} status.`,
    phase: "outbox",
    userId: input.userId,
  });
}

async function buildHostedAssistantDeliveryDispatchResult(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  dispatchResult: Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>>;
  userId: string;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome> {
  const { assistantDeliveryEffect, dispatchResult } = input;
  const delivery = dispatchResult.intent.delivery
    ? assistantChannelDeliverySchema.parse(dispatchResult.intent.delivery)
    : null;

  if (dispatchResult.intent.status === "sent" && delivery) {
    emitHostedAssistantDeliveryDispatchSuccess({
      delivery,
      wake: input.wake,
      effect: assistantDeliveryEffect,
      userId: input.userId,
    });
    return buildHostedAssistantDeliveryOutcome({
      delivery,
      deliveryStatus: "sent",
      effect: assistantDeliveryEffect,
      retryable: false,
    });
  }

  const deliveryError = dispatchResult.deliveryError
    ? normalizeAssistantDeliveryError(dispatchResult.deliveryError)
    : normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror did not produce a delivery result.",
        lastError: dispatchResult.intent.lastError,
      });

  switch (dispatchResult.intent.status) {
    case "failed":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "failed",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    case "retryable":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "retryable",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "sending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "sending",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "pending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "pending",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "abandoned": {
      const ambiguousError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded an abandoned delivery attempt.",
        lastError: dispatchResult.intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        delivery,
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    }
    default:
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
        deliveryErrorMessage: "The assistant outbox mirror did not return a supported delivery state.",
        deliveryStatus: "missing-result",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
  }
}

function buildHostedAssistantDeliveryPayloadFromIntent(
  intent: Pick<
    AssistantOutboxIntent,
    | "actorId"
    | "bindingDelivery"
    | "channel"
    | "deliveryIdempotencyKey"
    | "deliveryTransportIdempotent"
    | "explicitTarget"
    | "identityId"
    | "intentId"
    | "media"
    | "message"
    | "subject"
    | "replyToMessageId"
    | "sessionId"
    | "threadId"
    | "threadIsDirect"
    | "turnId"
  >,
): HostedAssistantDeliveryPayload {
  const payload = {
    actorId: intent.actorId ?? null,
    bindingDeliveryKind: intent.bindingDelivery?.kind ?? null,
    bindingDeliveryTarget: intent.bindingDelivery?.target ?? null,
    channel: intent.channel ?? null,
    explicitTarget: intent.explicitTarget ?? null,
    idempotencyKey: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
    identityId: intent.identityId ?? null,
    media: intent.media ?? [],
    message: intent.message,
    subject: intent.subject ?? null,
    replyToMessageId: intent.replyToMessageId ?? null,
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    transportIdempotent: intent.deliveryTransportIdempotent,
    turnId: intent.turnId,
  };

  assertSupportedHostedAssistantDeliveryPayload(payload);
  return payload;
}

function isHostedDeliveryTransportIdempotent(
  effect: Pick<HostedAssistantDeliveryEffect, "payload">,
): boolean {
  return effect.payload.transportIdempotent;
}

function attachHostedAssistantDeliveryDispatchDetails(
  error: unknown,
  input: {
    effectId: string;
    fingerprint: string;
    userId: string;
  },
): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }

  const existingDetails = "details" in error && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : null;
  Object.assign(error, {
    details: {
      ...(existingDetails ?? {}),
      ...buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.fingerprint,
        effectId: input.effectId,
        userId: input.userId,
      }),
    },
  });
  return error;
}

function buildHostedAssistantDeliveryOutcome(input: {
  delivery?: AssistantChannelDelivery | null;
  deliveryErrorCode?: string | null;
  deliveryErrorMessage?: string | null;
  deliveryStatus: HostedAssistantDeliveryOutcome["deliveryStatus"];
  effect: HostedAssistantDeliveryEffect;
  retryable: boolean;
}): HostedAssistantDeliveryOutcome {
  const cleanupMessages = readAssistantDeliveryCleanupMessages(input.delivery ?? null);
  const cleanupTargetAliases = readAssistantDeliveryCleanupTargetAliases(
    input.delivery ?? null,
  );
  return {
    deliveryChannel: input.delivery?.channel ?? null,
    deliveryErrorCode: input.deliveryErrorCode ?? null,
    deliveryErrorMessage: input.deliveryErrorMessage ?? null,
    deliveryStatus: input.deliveryStatus,
    effectFingerprint: input.effect.fingerprint,
    effectId: input.effect.effectId,
    journalMethod: null,
    journalStatus: null,
    ...(cleanupMessages && cleanupMessages.length > 0
      ? {
          cleanupMessages: cleanupMessages.map((cleanupMessage) => ({ ...cleanupMessage })),
        }
      : {}),
    ...(cleanupTargetAliases && cleanupTargetAliases.length > 0
      ? {
          cleanupTargetAliases: [...cleanupTargetAliases],
        }
      : {}),
    providerMessageId: input.delivery?.providerMessageId ?? null,
    ...(input.delivery?.providerMessageIds && input.delivery.providerMessageIds.length > 0
      ? {
          providerMessageIds: [...input.delivery.providerMessageIds],
        }
      : {}),
    providerThreadId: input.delivery?.providerThreadId ?? null,
    retryable: input.retryable,
    target: input.delivery?.target ?? null,
    targetKind: input.delivery?.targetKind ?? null,
  };
}

function readAssistantDeliveryCleanupMessages(
  delivery: AssistantChannelDelivery | null,
): Array<{ messageId: string; target: string }> | null {
  if (!delivery || !("cleanupMessages" in delivery) || !Array.isArray(delivery.cleanupMessages)) {
    return null;
  }

  const cleanupMessages = Array.from(
    new Map(
      delivery.cleanupMessages.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const messageId =
          "messageId" in entry && typeof entry.messageId === "string"
            ? entry.messageId.trim()
            : "";
        const target =
          "target" in entry && typeof entry.target === "string"
            ? entry.target.trim()
            : "";
        if (messageId.length === 0 || target.length === 0) {
          return [];
        }

        return [[`${target}\u0000${messageId}`, { messageId, target }] as const];
      }),
    ).values(),
  );

  return cleanupMessages.length > 0 ? cleanupMessages : null;
}

function readAssistantDeliveryCleanupTargetAliases(
  delivery: AssistantChannelDelivery | null,
): readonly string[] | null {
  if (!delivery || !("cleanupTargetAliases" in delivery) || !Array.isArray(delivery.cleanupTargetAliases)) {
    return null;
  }

  return delivery.cleanupTargetAliases;
}

function normalizeHostedAssistantDeliveryMirrorFailure(input: {
  fallbackMessage: string;
  lastError: { code: string | null; message: string } | null;
}): {
  code: string | null;
  message: string;
} {
  return {
    code: input.lastError?.code ?? null,
    message: input.lastError?.message ?? input.fallbackMessage,
  };
}

function assertSupportedHostedAssistantDeliveryPayload(
  payload: Pick<
    HostedAssistantDeliveryPayload,
    "bindingDeliveryKind" | "channel" | "explicitTarget"
  >,
): void {
  if (payload.channel !== "email") {
    return;
  }

  if (
    payload.explicitTarget
    || payload.bindingDeliveryKind === "thread"
    || payload.bindingDeliveryKind === null
  ) {
    return;
  }

  throw new VaultCliError(
    "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
  );
}

function readHostedAssistantDeliveryRetryableFlag(error: unknown): boolean | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }

  if (
    "context" in error
    && error.context
    && typeof error.context === "object"
    && "retryable" in error.context
    && typeof error.context.retryable === "boolean"
  ) {
    return error.context.retryable;
  }

  return null;
}

function buildHostedAssistantDeliveryDetails(input: {
  effectFingerprint?: string;
  effectId: string;
  extra?: HostedAssistantDeliveryDetails;
  userId: string;
}): HostedAssistantDeliveryDetails {
  return {
    assistantDeliveryBoundary: HOSTED_ASSISTANT_DELIVERY_BOUNDARY,
    ...(input.effectFingerprint ? { effectFingerprint: input.effectFingerprint } : {}),
    effectId: input.effectId,
    userId: input.userId,
    ...(input.extra ?? {}),
  };
}
