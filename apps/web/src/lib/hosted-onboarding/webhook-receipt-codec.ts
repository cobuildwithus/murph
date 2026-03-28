import { randomBytes } from "node:crypto";

import {
  buildHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";
import { Prisma } from "@prisma/client";

import { isHostedOnboardingError } from "./errors";
import { serializeHostedExecutionOutboxPayload } from "../hosted-execution/outbox-payload";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookEventPayload,
  HostedWebhookLinqMessageSideEffect,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptErrorState,
  HostedWebhookReceiptState,
  HostedWebhookReceiptStatus,
  HostedWebhookSideEffect,
  HostedWebhookSideEffectErrorState,
  HostedWebhookSideEffectResult,
  HostedWebhookSideEffectStatus,
} from "./webhook-receipt-types";

export function buildHostedWebhookProcessingReceipt(input: {
  eventPayload: HostedWebhookEventPayload;
  previousState?: HostedWebhookReceiptState | null;
  receivedAt: Date;
}): HostedWebhookReceiptClaim {
  const state = buildHostedWebhookReceiptState({
    attemptCount: Math.max(input.previousState?.attemptCount ?? 0, 0) + 1,
    attemptId: generateHostedWebhookReceiptAttemptId(),
    completedAt: null,
    eventPayload: mergeHostedWebhookEventPayload(
      input.eventPayload,
      input.previousState?.eventPayload ?? null,
    ),
    lastError: null,
    lastReceivedAt: input.receivedAt.toISOString(),
    sideEffects: input.previousState?.sideEffects ?? [],
    status: "processing",
  });

  return {
    payloadJson: serializeHostedWebhookReceiptState(state),
    state,
  };
}

export function buildHostedWebhookReceiptState(input: {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
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
    sideEffects: input.sideEffects,
    status: input.status,
  };
}

export function serializeHostedWebhookReceiptState(
  receiptState: HostedWebhookReceiptState,
): Prisma.InputJsonValue {
  return {
    eventPayload: receiptState.eventPayload,
    receiptState: {
      attemptCount: Math.max(Math.trunc(receiptState.attemptCount), 1),
      attemptId: receiptState.attemptId ?? generateHostedWebhookReceiptAttemptId(),
      completedAt: receiptState.status === "completed" ? receiptState.completedAt : null,
      lastError: receiptState.status === "failed" ? receiptState.lastError : null,
      lastReceivedAt: receiptState.lastReceivedAt,
      sideEffects: receiptState.sideEffects.map((effect) => serializeHostedWebhookSideEffect(effect)),
      status: receiptState.status,
    },
  } satisfies Prisma.InputJsonObject;
}

export function readHostedWebhookReceiptState(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookReceiptState {
  const nestedState = toHostedWebhookReceiptObject(
    toHostedWebhookReceiptObject(payloadJson).receiptState,
  );
  const attemptId = readHostedWebhookReceiptString(nestedState.attemptId);
  const attemptCount = readHostedWebhookReceiptNumber(nestedState.attemptCount);
  const status = readHostedWebhookReceiptStatusValue(nestedState.status);

  return {
    attemptCount: Math.max(attemptCount, 0),
    attemptId,
    completedAt: readHostedWebhookReceiptString(nestedState.completedAt),
    eventPayload: readHostedWebhookReceiptEventPayload(payloadJson),
    lastError: readHostedWebhookReceiptError(nestedState.lastError),
    lastReceivedAt: readHostedWebhookReceiptString(nestedState.lastReceivedAt),
    sideEffects: readHostedWebhookReceiptSideEffects(nestedState.sideEffects),
    status,
  };
}

export function replaceHostedWebhookReceiptState(
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
    sideEffects: "sideEffects" in overrides ? overrides.sideEffects ?? [] : currentState.sideEffects,
    status: "status" in overrides ? overrides.status ?? null : currentState.status,
  });
}

export function mergeHostedWebhookSideEffects(
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

export function replaceHostedWebhookSideEffects(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  effectId: string,
  mutate: (effect: HostedWebhookSideEffect) => HostedWebhookSideEffect,
): HostedWebhookSideEffect[] {
  return currentSideEffects.map((effect) => effect.effectId === effectId ? mutate(effect) : effect);
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

export function markHostedWebhookSideEffectSent(
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
    default:
      return effect;
  }
}

export function serializeHostedWebhookReceiptError(error: unknown): HostedWebhookReceiptErrorState {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
    };
  }

  return {
    message: "Unknown hosted webhook failure.",
    name: "UnknownError",
  };
}

export function serializeHostedWebhookSideEffectError(error: unknown): HostedWebhookSideEffectErrorState {
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

export function toHostedWebhookReceiptObject(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    return payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
  }

  if (payloadJson === null || payloadJson === undefined) {
    return {};
  }

  return {
    payload: payloadJson,
  };
}

export function toHostedWebhookReceiptRecord(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function toHostedWebhookReceiptJsonInput(
  value: HostedWebhookReceiptClaim["payloadJson"],
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null
    ? Prisma.JsonNull
    : value as Prisma.InputJsonValue;
}

export function readHostedWebhookDispatchPayloadDispatch(
  payload: HostedWebhookDispatchSideEffect["payload"],
): HostedExecutionDispatchRequest | null {
  return "dispatch" in payload
    ? payload.dispatch
    : null;
}

export function requireHostedWebhookDispatchEffectDispatch(
  effect: HostedWebhookDispatchSideEffect,
): HostedExecutionDispatchRequest {
  const dispatch = readHostedWebhookDispatchPayloadDispatch(effect.payload);

  if (!dispatch) {
    throw new Error(`Hosted webhook dispatch side effect ${effect.effectId} no longer carries a dispatch payload.`);
  }

  return dispatch;
}

function readHostedWebhookReceiptEventPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookEventPayload {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    const payloadObject = payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
    const nestedEventPayload = payloadObject.eventPayload;

    if (nestedEventPayload && typeof nestedEventPayload === "object" && !Array.isArray(nestedEventPayload)) {
      return nestedEventPayload as HostedWebhookEventPayload;
    }
  }

  return {};
}

function readHostedWebhookReceiptError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        message,
        name,
      }
    : null;
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

function readHostedWebhookReceiptSideEffects(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sideEffects: HostedWebhookSideEffect[] = [];

  for (const candidate of value) {
    const parsed = readHostedWebhookSideEffect(candidate);
    if (parsed) {
      sideEffects.push(parsed);
    }
  }

  return sideEffects;
}

function readHostedWebhookReceiptNumber(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(Math.trunc(value), 0)
    : 0;
}

function readHostedWebhookReceiptString(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedWebhookReceiptStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptStatus | null {
  return value === "completed" || value === "failed" || value === "processing"
    ? value
    : null;
}

function readHostedWebhookSideEffectStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectStatus | null {
  return value === "pending" || value === "sent"
    ? value
    : null;
}

function readHostedWebhookSideEffectError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        code: readHostedWebhookReceiptString(errorObject.code),
        message,
        name,
        retryable:
          typeof errorObject.retryable === "boolean"
            ? errorObject.retryable
            : null,
      }
    : null;
}

function serializeHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
): Prisma.InputJsonObject {
  return {
    attemptCount: effect.attemptCount,
    effectId: effect.effectId,
    kind: effect.kind,
    lastAttemptAt: effect.lastAttemptAt,
    lastError: effect.lastError,
    payload: effect.payload as unknown as Prisma.InputJsonValue,
    result: effect.result as unknown as Prisma.InputJsonValue,
    sentAt: effect.sentAt,
    status: effect.status,
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookSideEffect(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookSideEffect | null {
  const effectObject = toHostedWebhookReceiptObject(value);
  const effectId = readHostedWebhookReceiptString(effectObject.effectId);
  const kind = readHostedWebhookReceiptString(effectObject.kind);
  const status = readHostedWebhookSideEffectStatusValue(effectObject.status);

  if (!effectId || !kind || !status) {
    return null;
  }

  const attemptCount = readHostedWebhookReceiptNumber(effectObject.attemptCount);
  const lastAttemptAt = readHostedWebhookReceiptString(effectObject.lastAttemptAt);
  const lastError = readHostedWebhookSideEffectError(effectObject.lastError);
  const sentAt = readHostedWebhookReceiptString(effectObject.sentAt);
  const payload = toHostedWebhookReceiptObject(effectObject.payload);
  const result = toHostedWebhookReceiptObject(effectObject.result);

  switch (kind) {
    case "hosted_execution_dispatch": {
      const dispatchPayload = payload.dispatch;

      if (dispatchPayload && typeof dispatchPayload === "object" && !Array.isArray(dispatchPayload)) {
        return {
          attemptCount,
          effectId,
          kind,
          lastAttemptAt,
          lastError,
          payload: {
            dispatch: dispatchPayload as unknown as HostedExecutionDispatchRequest,
          },
          result: result.dispatched === true ? { dispatched: true } : null,
          sentAt,
          status,
        };
      }

      const dispatchRef = readHostedExecutionDispatchRef(
        payload,
        {
          eventId: "",
          eventKind: "",
          occurredAt: null,
          userId: "",
        },
      );

      if (!dispatchRef) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          schemaVersion: payload.schemaVersion as string,
          dispatchRef,
          linqEvent: toHostedWebhookReceiptRecord(payload.linqEvent),
          telegramUpdate: toHostedWebhookReceiptRecord(payload.telegramUpdate),
        },
        result: result.dispatched === true ? { dispatched: true } : null,
        sentAt,
        status,
      };
    }
    case "linq_message_send": {
      const chatId = readHostedWebhookReceiptString(payload.chatId);
      const message = readHostedWebhookReceiptString(payload.message);

      if (!chatId || !message) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          chatId,
          inviteId: readHostedWebhookReceiptString(payload.inviteId),
          message,
        },
        result:
          Object.keys(result).length === 0
            ? null
            : {
                chatId: readHostedWebhookReceiptString(result.chatId),
                messageId: readHostedWebhookReceiptString(result.messageId),
              },
        sentAt,
        status,
      };
    }
    default:
      return null;
  }
}

function readHostedWebhookSideEffectRetryable(error: Error): boolean | null {
  return "retryable" in error && typeof error.retryable === "boolean"
    ? error.retryable
    : null;
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
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
      return {
        ...desiredEffect,
        attemptCount: currentDispatchEffect.attemptCount,
        lastAttemptAt: currentDispatchEffect.lastAttemptAt,
        lastError: currentDispatchEffect.status === "sent" ? null : currentDispatchEffect.lastError,
        payload: currentDispatchEffect.status === "sent" ? currentDispatchEffect.payload : desiredEffect.payload,
        result: currentDispatchEffect.status === "sent" ? currentDispatchEffect.result : null,
        sentAt: currentDispatchEffect.status === "sent" ? currentDispatchEffect.sentAt : null,
        status: currentDispatchEffect.status === "sent" ? "sent" : "pending",
      };
    }
    case "linq_message_send": {
      const currentLinqEffect = currentEffect as HostedWebhookLinqMessageSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentLinqEffect.attemptCount,
        lastAttemptAt: currentLinqEffect.lastAttemptAt,
        lastError: currentLinqEffect.status === "sent" ? null : currentLinqEffect.lastError,
        result: currentLinqEffect.status === "sent" ? currentLinqEffect.result : null,
        sentAt: currentLinqEffect.status === "sent" ? currentLinqEffect.sentAt : null,
        status: currentLinqEffect.status === "sent" ? "sent" : "pending",
      };
    }
    default:
      return desiredEffect;
  }
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
    };
  }

  if (dispatch.event.kind === "telegram.message.received") {
    return {
      dispatchRef: buildHostedExecutionDispatchRef(dispatch),
      schemaVersion: serializedDispatch.schemaVersion as string,
      telegramUpdate: { ...dispatch.event.telegramUpdate },
    };
  }

  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: serializedDispatch.schemaVersion as string,
  };
}
