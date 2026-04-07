import { randomBytes } from "node:crypto";

import { isHostedOnboardingError } from "./errors";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookLinqMessageSideEffect,
  HostedWebhookReceiptErrorState,
  HostedWebhookReceiptState,
  HostedWebhookReceiptStatus,
  HostedWebhookRevnetIssuanceSideEffect,
  HostedWebhookSideEffect,
  HostedWebhookSideEffectErrorState,
  HostedWebhookSideEffectResult,
} from "./webhook-receipt-types";

export function claimHostedWebhookReceipt(input: {
  previousState?: HostedWebhookReceiptState | null;
  receivedAt: Date;
}): HostedWebhookReceiptState {
  return buildHostedWebhookReceiptState({
    attemptCount: Math.max(input.previousState?.attemptCount ?? 0, 0) + 1,
    attemptId: generateHostedWebhookReceiptAttemptId(),
    completedAt: null,
    lastError: null,
    lastReceivedAt: input.receivedAt.toISOString(),
    plannedAt: input.previousState?.plannedAt ?? null,
    sideEffects: input.previousState?.sideEffects ?? [],
    status: "processing",
  });
}

export function queueHostedWebhookReceiptSideEffects(
  currentState: HostedWebhookReceiptState,
  desiredSideEffects: readonly HostedWebhookSideEffect[],
  input: {
    plannedAt: string;
  },
): HostedWebhookReceiptState {
  const nextSideEffects =
    desiredSideEffects.length === 0
      ? currentState.sideEffects
      : mergeHostedWebhookSideEffects(currentState.sideEffects, desiredSideEffects);

  if (nextSideEffects === currentState.sideEffects && input.plannedAt === currentState.plannedAt) {
    return currentState;
  }

  return updateHostedWebhookReceiptState(currentState, {
    plannedAt: input.plannedAt,
    sideEffects: nextSideEffects,
  });
}

export function startHostedWebhookReceiptSideEffect(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  startedAt: string,
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) => ({
    ...effect,
    attemptCount: effect.attemptCount + 1,
    lastAttemptAt: startedAt,
    lastError: null,
  }));
}

export function markHostedWebhookReceiptSideEffectSent(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  _result: HostedWebhookSideEffectResult,
  _sentAt: string,
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptState(currentState, {
    sideEffects: currentState.sideEffects.filter((effect) => effect.effectId !== effectId),
  });
}

export function markHostedWebhookReceiptSideEffectSentUnconfirmed(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  input: {
    error: unknown;
    result: HostedWebhookSideEffectResult;
    sentAt: string;
  },
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) => {
    const lastError = serializeHostedWebhookSideEffectError(input.error);

    switch (effect.kind) {
      case "hosted_execution_dispatch":
        return {
          ...effect,
          lastError,
          result: readHostedWebhookDispatchSideEffectResult(input.result),
          sentAt: input.sentAt,
          status: "sent_unconfirmed",
        } satisfies HostedWebhookDispatchSideEffect;
      case "linq_message_send":
        return {
          ...effect,
          lastError,
          result: readHostedWebhookLinqMessageSideEffectResult(input.result),
          sentAt: input.sentAt,
          status: "sent_unconfirmed",
        } satisfies HostedWebhookLinqMessageSideEffect;
      case "revnet_invoice_issue":
        return {
          ...effect,
          lastError,
          result: readHostedWebhookRevnetIssuanceSideEffectResult(input.result),
          sentAt: input.sentAt,
          status: "sent_unconfirmed",
        } satisfies HostedWebhookRevnetIssuanceSideEffect;
    }
  });
}

export function markHostedWebhookReceiptSideEffectFailed(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  error: unknown,
): HostedWebhookReceiptState {
  const lastError = serializeHostedWebhookSideEffectError(error);

  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) => ({
    ...effect,
    lastError,
  }));
}

export function completeHostedWebhookReceipt(
  currentState: HostedWebhookReceiptState,
  input: {
    completedAt: string;
  },
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptState(currentState, {
    completedAt: input.completedAt,
    lastError: null,
    lastReceivedAt: input.completedAt,
    sideEffects: [],
    status: "completed",
  });
}

export function failHostedWebhookReceipt(
  currentState: HostedWebhookReceiptState,
  input: {
    error: unknown;
    failedAt: string;
  },
): HostedWebhookReceiptState {
  const lastError = serializeHostedWebhookReceiptError(input.error);
  const nextState = updateHostedWebhookReceiptState(currentState, {
    completedAt: null,
    lastError,
    lastReceivedAt: input.failedAt,
    status: "failed",
  });

  if (lastError.retryable === false) {
    return updateHostedWebhookReceiptState(nextState, {
      sideEffects: nextState.sideEffects.filter((effect) => effect.status === "sent_unconfirmed"),
    });
  }

  return nextState;
}

export function getHostedWebhookSideEffect(
  state: HostedWebhookReceiptState,
  effectId: string,
): HostedWebhookSideEffect {
  const effect = state.sideEffects.find((candidate) => candidate.effectId === effectId);

  if (!effect) {
    throw new Error(`Hosted webhook side effect ${effectId} was not found.`);
  }

  return effect;
}

function buildHostedWebhookReceiptState(input: {
  attemptCount: number;
  attemptId: string;
  completedAt: string | null;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string;
  plannedAt: string | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus;
}): HostedWebhookReceiptState {
  return {
    attemptCount: Math.max(Math.trunc(input.attemptCount), 1),
    attemptId: input.attemptId,
    completedAt: input.status === "completed" ? input.completedAt : null,
    lastError: input.status === "failed" ? input.lastError : null,
    lastReceivedAt: input.lastReceivedAt,
    plannedAt: input.plannedAt,
    sideEffects: input.sideEffects,
    status: input.status,
  };
}

function updateHostedWebhookReceiptState(
  currentState: HostedWebhookReceiptState,
  overrides: Partial<HostedWebhookReceiptState>,
): HostedWebhookReceiptState {
  return buildHostedWebhookReceiptState({
    attemptCount: "attemptCount" in overrides ? Math.max(overrides.attemptCount ?? 0, 0) : currentState.attemptCount,
    attemptId: "attemptId" in overrides ? overrides.attemptId ?? currentState.attemptId : currentState.attemptId,
    completedAt: "completedAt" in overrides ? overrides.completedAt ?? null : currentState.completedAt,
    lastError: "lastError" in overrides ? overrides.lastError ?? null : currentState.lastError,
    lastReceivedAt: "lastReceivedAt" in overrides
      ? overrides.lastReceivedAt ?? currentState.lastReceivedAt
      : currentState.lastReceivedAt,
    plannedAt: "plannedAt" in overrides ? overrides.plannedAt ?? null : currentState.plannedAt,
    sideEffects: "sideEffects" in overrides ? overrides.sideEffects ?? [] : currentState.sideEffects,
    status: "status" in overrides ? overrides.status ?? currentState.status : currentState.status,
  });
}

function updateHostedWebhookReceiptSideEffect(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  mutate: (effect: HostedWebhookSideEffect) => HostedWebhookSideEffect,
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptState(currentState, {
    sideEffects: currentState.sideEffects.map((effect) =>
      effect.effectId === effectId ? mutate(effect) : effect,
    ),
  });
}

function mergeHostedWebhookSideEffects(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  desiredSideEffects: readonly HostedWebhookSideEffect[],
): HostedWebhookSideEffect[] {
  const remainingEffects = new Map(
    currentSideEffects.map((effect) => [effect.effectId, effect] as const),
  );
  const mergedEffects: HostedWebhookSideEffect[] = [];

  for (const desiredEffect of desiredSideEffects) {
    const currentEffect = remainingEffects.get(desiredEffect.effectId);
    remainingEffects.delete(desiredEffect.effectId);
    mergedEffects.push(
      currentEffect
        ? mergeHostedWebhookSideEffect(currentEffect, desiredEffect)
        : desiredEffect,
    );
  }

  for (const currentEffect of currentSideEffects) {
    if (remainingEffects.has(currentEffect.effectId)) {
      mergedEffects.push(currentEffect);
    }
  }

  return mergedEffects;
}

function readHostedWebhookDispatchSideEffectResult(
  value: HostedWebhookSideEffectResult,
): NonNullable<HostedWebhookDispatchSideEffect["result"]> {
  if ("dispatched" in value && value.dispatched === true) {
    return value;
  }

  throw new Error("Hosted webhook dispatch side effect received an invalid terminal result.");
}

function readHostedWebhookLinqMessageSideEffectResult(
  value: HostedWebhookSideEffectResult,
): NonNullable<HostedWebhookLinqMessageSideEffect["result"]> {
  if ("chatId" in value && "messageId" in value) {
    return value;
  }

  throw new Error("Hosted webhook Linq message side effect received an invalid terminal result.");
}

function readHostedWebhookRevnetIssuanceSideEffectResult(
  value: HostedWebhookSideEffectResult,
): NonNullable<HostedWebhookRevnetIssuanceSideEffect["result"]> {
  if ("handled" in value && value.handled === true) {
    return value;
  }

  throw new Error("Hosted webhook Revnet issuance side effect received an invalid terminal result.");
}

function mergeHostedWebhookSideEffect(
  currentEffect: HostedWebhookSideEffect,
  desiredEffect: HostedWebhookSideEffect,
): HostedWebhookSideEffect {
  if (currentEffect.kind !== desiredEffect.kind) {
    return desiredEffect;
  }

  if (currentEffect.status !== "sent_unconfirmed") {
    return {
      ...desiredEffect,
      attemptCount: currentEffect.attemptCount,
      lastAttemptAt: currentEffect.lastAttemptAt,
      lastError: currentEffect.lastError,
      sentAt: currentEffect.sentAt,
      status: currentEffect.status,
    };
  }

  switch (desiredEffect.kind) {
    case "hosted_execution_dispatch": {
      const currentDispatchEffect = currentEffect as HostedWebhookDispatchSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentDispatchEffect.attemptCount,
        lastAttemptAt: currentDispatchEffect.lastAttemptAt,
        lastError: currentDispatchEffect.lastError,
        payload: currentDispatchEffect.payload,
        result: currentDispatchEffect.result,
        sentAt: currentDispatchEffect.sentAt,
        status: "sent_unconfirmed",
      };
    }
    case "linq_message_send": {
      const currentLinqEffect = currentEffect as HostedWebhookLinqMessageSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentLinqEffect.attemptCount,
        lastAttemptAt: currentLinqEffect.lastAttemptAt,
        lastError: currentLinqEffect.lastError,
        payload: currentLinqEffect.payload,
        result: currentLinqEffect.result,
        sentAt: currentLinqEffect.sentAt,
        status: "sent_unconfirmed",
      };
    }
    case "revnet_invoice_issue": {
      const currentRevnetEffect = currentEffect as HostedWebhookRevnetIssuanceSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentRevnetEffect.attemptCount,
        lastAttemptAt: currentRevnetEffect.lastAttemptAt,
        lastError: currentRevnetEffect.lastError,
        payload: currentRevnetEffect.payload,
        result: currentRevnetEffect.result,
        sentAt: currentRevnetEffect.sentAt,
        status: "sent_unconfirmed",
      };
    }
    default:
      return desiredEffect;
  }
}

function serializeHostedWebhookReceiptError(error: unknown): HostedWebhookReceiptErrorState {
  return serializeHostedWebhookErrorState<HostedWebhookReceiptErrorState>({
    error,
    unknownMessage: "Unknown hosted webhook failure.",
  });
}

function serializeHostedWebhookSideEffectError(error: unknown): HostedWebhookSideEffectErrorState {
  return serializeHostedWebhookErrorState<HostedWebhookSideEffectErrorState>({
    error,
    deriveRetryable: readHostedWebhookSideEffectRetryable,
    unknownMessage: "Unknown hosted side-effect failure.",
  });
}

function serializeHostedWebhookErrorState<
  TErrorState extends HostedWebhookReceiptErrorState | HostedWebhookSideEffectErrorState,
>(input: {
  error: unknown;
  deriveRetryable?: (error: Error) => boolean | null;
  unknownMessage: string;
}): TErrorState {
  const { error } = input;

  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      retryable: error.retryable ?? null,
    } as TErrorState;
  }

  if (error instanceof Error) {
    return {
      code: null,
      message: error.message,
      name: error.name,
      retryable: input.deriveRetryable?.(error) ?? null,
    } as TErrorState;
  }

  if (typeof error === "string") {
    return {
      code: null,
      message: error,
      name: "Error",
      retryable: null,
    } as TErrorState;
  }

  return {
    code: null,
    message: input.unknownMessage,
    name: "UnknownError",
    retryable: null,
  } as TErrorState;
}

function readHostedWebhookSideEffectRetryable(error: Error): boolean | null {
  return "retryable" in error && typeof error.retryable === "boolean"
    ? error.retryable
    : null;
}

export function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}
