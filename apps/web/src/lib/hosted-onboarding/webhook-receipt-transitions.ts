import { randomBytes } from "node:crypto";

import {
  buildHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import { isHostedOnboardingError } from "./errors";
import { serializeHostedExecutionOutboxPayload } from "../hosted-execution/outbox-payload";
import { serializeHostedWebhookReceiptState } from "./webhook-receipt-codec";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookEventPayload,
  HostedWebhookLinqMessageSideEffect,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptErrorState,
  HostedWebhookResponsePayload,
  HostedWebhookReceiptState,
  HostedWebhookReceiptStatus,
  HostedWebhookRevnetIssuanceSideEffect,
  HostedWebhookSideEffect,
  HostedWebhookSideEffectErrorState,
  HostedWebhookSideEffectResult,
} from "./webhook-receipt-types";

export function claimHostedWebhookReceipt(input: {
  eventPayload: HostedWebhookEventPayload;
  previousState?: HostedWebhookReceiptState | null;
  receivedAt: Date;
}): HostedWebhookReceiptClaim {
  return toHostedWebhookReceiptClaim(
    buildHostedWebhookReceiptState({
      attemptCount: Math.max(input.previousState?.attemptCount ?? 0, 0) + 1,
      attemptId: generateHostedWebhookReceiptAttemptId(),
      completedAt: null,
      eventPayload: mergeHostedWebhookEventPayload(
        input.eventPayload,
        input.previousState?.eventPayload ?? null,
      ),
      lastError: null,
      lastReceivedAt: input.receivedAt.toISOString(),
      plannedAt: input.previousState?.plannedAt ?? null,
      response: input.previousState?.response ?? null,
      sideEffects: input.previousState?.sideEffects ?? [],
      status: "processing",
    }),
  );
}

export function queueHostedWebhookReceiptSideEffects(
  currentState: HostedWebhookReceiptState,
  desiredSideEffects: readonly HostedWebhookSideEffect[],
  input?: {
    plannedAt: string;
    response: HostedWebhookResponsePayload;
  },
): HostedWebhookReceiptState {
  if (desiredSideEffects.length === 0) {
    return currentState;
  }

  return updateHostedWebhookReceiptState(currentState, {
    plannedAt: input?.plannedAt ?? currentState.plannedAt,
    response: input?.response ?? currentState.response,
    sideEffects: mergeHostedWebhookSideEffects(currentState.sideEffects, desiredSideEffects),
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
  result: HostedWebhookSideEffectResult,
  sentAt: string,
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) =>
    markHostedWebhookSideEffectSent(effect, result, sentAt),
  );
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
  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) => ({
    ...markHostedWebhookSideEffectSent(effect, input.result, input.sentAt),
    lastError: serializeHostedWebhookSideEffectError(input.error),
    status: "sent_unconfirmed",
  }));
}

export function markHostedWebhookReceiptSideEffectFailed(
  currentState: HostedWebhookReceiptState,
  effectId: string,
  error: unknown,
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptSideEffect(currentState, effectId, (effect) =>
    effect.status === "pending"
      ? {
          ...effect,
          lastError: serializeHostedWebhookSideEffectError(error),
          status: "pending",
        }
      : {
          ...effect,
          lastError: serializeHostedWebhookSideEffectError(error),
        },
  );
}

export function completeHostedWebhookReceipt(
  currentState: HostedWebhookReceiptState,
  input: {
    completedAt: string;
    eventPayload: HostedWebhookEventPayload;
  },
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptState(currentState, {
    completedAt: input.completedAt,
    eventPayload: mergeHostedWebhookEventPayload(input.eventPayload, currentState.eventPayload),
    lastError: null,
    lastReceivedAt: input.completedAt,
    status: "completed",
  });
}

export function failHostedWebhookReceipt(
  currentState: HostedWebhookReceiptState,
  input: {
    error: unknown;
    eventPayload: HostedWebhookEventPayload;
    failedAt: string;
  },
): HostedWebhookReceiptState {
  return updateHostedWebhookReceiptState(currentState, {
    completedAt: null,
    eventPayload: mergeHostedWebhookEventPayload(input.eventPayload, currentState.eventPayload),
    lastError: serializeHostedWebhookReceiptError(input.error),
    lastReceivedAt: input.failedAt,
    status: "failed",
  });
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

export function toHostedWebhookReceiptClaim(
  state: HostedWebhookReceiptState,
): HostedWebhookReceiptClaim {
  return {
    payloadJson: serializeHostedWebhookReceiptState(state),
    state,
  };
}

function buildHostedWebhookReceiptState(input: {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
  plannedAt: string | null;
  response: HostedWebhookResponsePayload | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus | null;
}): HostedWebhookReceiptState {
  return {
    attemptCount: Math.max(Math.trunc(input.attemptCount), 1),
    attemptId: input.attemptId,
    completedAt: input.status === "completed" ? input.completedAt : null,
    eventPayload: input.eventPayload,
    lastError: input.status === "failed" ? input.lastError : null,
    lastReceivedAt: input.lastReceivedAt,
    plannedAt: input.plannedAt,
    response: input.response,
    sideEffects: input.sideEffects,
    status: input.status,
  };
}

function updateHostedWebhookReceiptState(
  currentState: HostedWebhookReceiptState,
  overrides: Partial<HostedWebhookReceiptState>,
): HostedWebhookReceiptState {
  return buildHostedWebhookReceiptState({
    attemptCount: "attemptCount" in overrides ? overrides.attemptCount ?? 0 : currentState.attemptCount,
    attemptId: "attemptId" in overrides ? overrides.attemptId ?? null : currentState.attemptId,
    completedAt: "completedAt" in overrides ? overrides.completedAt ?? null : currentState.completedAt,
    eventPayload: "eventPayload" in overrides ? overrides.eventPayload ?? {} : currentState.eventPayload,
    lastError: "lastError" in overrides ? overrides.lastError ?? null : currentState.lastError,
    lastReceivedAt: "lastReceivedAt" in overrides ? overrides.lastReceivedAt ?? null : currentState.lastReceivedAt,
    plannedAt: "plannedAt" in overrides ? overrides.plannedAt ?? null : currentState.plannedAt,
    response: "response" in overrides ? overrides.response ?? null : currentState.response,
    sideEffects: "sideEffects" in overrides ? overrides.sideEffects ?? [] : currentState.sideEffects,
    status: "status" in overrides ? overrides.status ?? null : currentState.status,
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

function mergeHostedWebhookEventPayload(
  eventPayload: HostedWebhookEventPayload,
  previousEventPayload: HostedWebhookEventPayload | null,
): HostedWebhookEventPayload {
  return {
    ...(previousEventPayload ?? {}),
    ...eventPayload,
  };
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

function mergeHostedWebhookSideEffect(
  currentEffect: HostedWebhookSideEffect,
  desiredEffect: HostedWebhookSideEffect,
): HostedWebhookSideEffect {
  if (currentEffect.kind !== desiredEffect.kind) {
    return desiredEffect;
  }

  switch (desiredEffect.kind) {
    case "hosted_execution_dispatch": {
      const currentDispatchEffect = currentEffect as HostedWebhookDispatchSideEffect;
      const terminalStatus = readHostedWebhookSideEffectTerminalStatus(currentDispatchEffect.status);
      return {
        ...desiredEffect,
        attemptCount: currentDispatchEffect.attemptCount,
        lastAttemptAt: currentDispatchEffect.lastAttemptAt,
        lastError: terminalStatus === "sent" ? null : currentDispatchEffect.lastError,
        payload: terminalStatus ? currentDispatchEffect.payload : desiredEffect.payload,
        result: terminalStatus ? currentDispatchEffect.result : null,
        sentAt: terminalStatus ? currentDispatchEffect.sentAt : null,
        status: terminalStatus ?? "pending",
      };
    }
    case "linq_message_send": {
      const currentLinqEffect = currentEffect as HostedWebhookLinqMessageSideEffect;
      const terminalStatus = readHostedWebhookSideEffectTerminalStatus(currentLinqEffect.status);
      return {
        ...desiredEffect,
        attemptCount: currentLinqEffect.attemptCount,
        lastAttemptAt: currentLinqEffect.lastAttemptAt,
        lastError: terminalStatus === "sent" ? null : currentLinqEffect.lastError,
        result: terminalStatus ? currentLinqEffect.result : null,
        sentAt: terminalStatus ? currentLinqEffect.sentAt : null,
        status: terminalStatus ?? "pending",
      };
    }
    case "revnet_invoice_issue": {
      const currentRevnetEffect = currentEffect as HostedWebhookRevnetIssuanceSideEffect;
      const terminalStatus = readHostedWebhookSideEffectTerminalStatus(currentRevnetEffect.status);
      return {
        ...desiredEffect,
        attemptCount: currentRevnetEffect.attemptCount,
        lastAttemptAt: currentRevnetEffect.lastAttemptAt,
        lastError: terminalStatus === "sent" ? null : currentRevnetEffect.lastError,
        result: terminalStatus ? currentRevnetEffect.result : null,
        sentAt: terminalStatus ? currentRevnetEffect.sentAt : null,
        status: terminalStatus ?? "pending",
      };
    }
    default:
      return desiredEffect;
  }
}

function readHostedWebhookSideEffectTerminalStatus(
  status: HostedWebhookSideEffect["status"],
): Exclude<HostedWebhookSideEffect["status"], "pending"> | null {
  return status === "sent" || status === "sent_unconfirmed"
    ? status
    : null;
}

function markHostedWebhookSideEffectSent(
  effect: HostedWebhookSideEffect,
  result: HostedWebhookSideEffectResult,
  sentAt: string,
): HostedWebhookSideEffect {
  switch (effect.kind) {
    case "hosted_execution_dispatch": {
      const dispatch = readHostedWebhookDispatchPayloadDispatch(effect.payload);

      return {
        ...effect,
        lastError: null,
        payload: dispatch ? minimizeHostedWebhookDispatchPayload(dispatch) : effect.payload,
        result: result as HostedWebhookDispatchSideEffect["result"],
        sentAt,
        status: "sent",
      };
    }
    case "linq_message_send":
      return {
        ...effect,
        lastError: null,
        result: result as HostedWebhookLinqMessageSideEffect["result"],
        sentAt,
        status: "sent",
      };
    case "revnet_invoice_issue":
      return {
        ...effect,
        lastError: null,
        result: result as HostedWebhookRevnetIssuanceSideEffect["result"],
        sentAt,
        status: "sent",
      };
    default:
      return effect;
  }
}

function serializeHostedWebhookReceiptError(error: unknown): HostedWebhookReceiptErrorState {
  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      retryable: error.retryable ?? null,
    };
  }

  if (error instanceof Error) {
    return {
      code: null,
      message: error.message,
      name: error.name,
      retryable: null,
    };
  }

  if (typeof error === "string") {
    return {
      code: null,
      message: error,
      name: "Error",
      retryable: null,
    };
  }

  return {
    code: null,
    message: "Unknown hosted webhook failure.",
    name: "UnknownError",
    retryable: null,
  };
}

function serializeHostedWebhookSideEffectError(error: unknown): HostedWebhookSideEffectErrorState {
  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      retryable: error.retryable ?? null,
    };
  }

  if (error instanceof Error) {
    return {
      code: null,
      message: error.message,
      name: error.name,
      retryable: readHostedWebhookSideEffectRetryable(error),
    };
  }

  if (typeof error === "string") {
    return {
      code: null,
      message: error,
      name: "Error",
      retryable: null,
    };
  }

  return {
    code: null,
    message: "Unknown hosted side-effect failure.",
    name: "UnknownError",
    retryable: null,
  };
}

function readHostedWebhookSideEffectRetryable(error: Error): boolean | null {
  return "retryable" in error && typeof error.retryable === "boolean"
    ? error.retryable
    : null;
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}

function readHostedWebhookDispatchPayloadDispatch(
  payload: HostedWebhookDispatchSideEffect["payload"],
): HostedExecutionDispatchRequest | null {
  return "dispatch" in payload
    ? payload.dispatch
    : null;
}

function minimizeHostedWebhookDispatchPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedWebhookDispatchSideEffect["payload"] {
  const serializedDispatch = serializeHostedExecutionOutboxPayload(dispatch);

  if (dispatch.event.kind === "linq.message.received") {
    return {
      dispatchRef: buildHostedExecutionDispatchRef(dispatch),
      linqEvent: { ...dispatch.event.linqEvent },
      schemaVersion: serializedDispatch.schemaVersion as string,
      storage: "reference",
    };
  }

  if (dispatch.event.kind === "telegram.message.received") {
    return {
      dispatchRef: buildHostedExecutionDispatchRef(dispatch),
      schemaVersion: serializedDispatch.schemaVersion as string,
      storage: "reference",
      telegramUpdate: { ...dispatch.event.telegramUpdate },
    };
  }

  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: serializedDispatch.schemaVersion as string,
    storage: "reference",
  };
}
