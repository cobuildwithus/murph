import { randomBytes } from "node:crypto";

import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";
import { Prisma, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  buildHostedExecutionDispatchRef,
  serializeHostedExecutionOutboxPayload,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRef,
} from "../hosted-execution/outbox-payload";

export type HostedWebhookEventPayload = Prisma.InputJsonObject;

type HostedWebhookReceiptErrorState = {
  message: string;
  name: string;
};

type HostedWebhookSideEffectErrorState = {
  code: string | null;
  message: string;
  name: string;
  retryable: boolean | null;
};

type HostedWebhookSideEffectStatus = "pending" | "sent";

type HostedWebhookDispatchSideEffectPayload =
  | {
      dispatch: HostedExecutionDispatchRequest;
    }
  | {
      schemaVersion: string;
      dispatchRef: HostedExecutionDispatchRef;
      linqEvent?: Record<string, unknown> | null;
    };

export type HostedWebhookDispatchSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "hosted_execution_dispatch";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: HostedWebhookDispatchSideEffectPayload;
  result: {
    dispatched: true;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

export type HostedWebhookLinqMessageSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "linq_message_send";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: {
    chatId: string;
    inviteId: string | null;
    message: string;
  };
  result: {
    chatId: string | null;
    messageId: string | null;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

export type HostedWebhookSideEffect =
  | HostedWebhookDispatchSideEffect
  | HostedWebhookLinqMessageSideEffect;

type HostedWebhookReceiptStatus = "completed" | "failed" | "processing";

type HostedWebhookReceiptState = {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus | null;
};

export type HostedWebhookReceiptClaim = {
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  state: HostedWebhookReceiptState;
};

export type HostedWebhookSideEffectResult =
  | NonNullable<HostedWebhookDispatchSideEffect["result"]>
  | NonNullable<HostedWebhookLinqMessageSideEffect["result"]>;

export type HostedWebhookDispatchEnqueueInput = {
  dispatch: HostedExecutionDispatchRequest;
  eventId: string;
  nextPayloadJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  previousClaim: HostedWebhookReceiptClaim;
  prisma: PrismaClient;
  source: string;
};

type HostedWebhookReceiptHandlers = {
  afterSideEffectSent?: (input: {
    effect: HostedWebhookSideEffect;
    prisma: PrismaClient;
  }) => Promise<void>;
  enqueueDispatchEffect: (input: HostedWebhookDispatchEnqueueInput) => Promise<number>;
  performSideEffect: (
    effect: HostedWebhookSideEffect,
    options: {
      signal?: AbortSignal;
    },
  ) => Promise<HostedWebhookSideEffectResult>;
};

type HostedWebhookPlan<TResult> = {
  desiredSideEffects: HostedWebhookSideEffect[];
  response: TResult;
};

class HostedWebhookReceiptSideEffectDrainError extends Error {
  readonly claimedReceipt: HostedWebhookReceiptClaim;
  readonly cause: unknown;

  constructor(claimedReceipt: HostedWebhookReceiptClaim, cause: unknown) {
    super("Hosted webhook side-effect drain failed.");
    this.name = "HostedWebhookReceiptSideEffectDrainError";
    this.claimedReceipt = claimedReceipt;
    this.cause = cause;
  }
}

export async function runHostedWebhookWithReceipt<TResult>(input: {
  duplicateResponse: TResult;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  handlers: HostedWebhookReceiptHandlers;
  plan: () => Promise<HostedWebhookPlan<TResult>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<TResult> {
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
  });

  if (!claimedReceipt) {
    return input.duplicateResponse;
  }

  try {
    const plan = await input.plan();

    claimedReceipt = await queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects: plan.desiredSideEffects,
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });
    claimedReceipt = await drainHostedWebhookReceiptSideEffects({
      claimedReceipt,
      eventId: input.eventId,
      handlers: input.handlers,
      prisma: input.prisma,
      signal: input.signal,
      source: input.source,
    });

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: input.eventId,
      eventPayload: input.eventPayload,
      prisma: input.prisma,
      source: input.source,
    });

    return plan.response;
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;

    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: input.eventId,
      eventPayload: input.eventPayload,
      prisma: input.prisma,
      source: input.source,
    });
    throw failure;
  }
}

export function createHostedWebhookDispatchSideEffect(input: {
  dispatch: HostedExecutionDispatchRequest;
}): HostedWebhookDispatchSideEffect {
  return {
    attemptCount: 0,
    effectId: `dispatch:${input.dispatch.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      dispatch: input.dispatch,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
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

  return dispatch.event.kind === "linq.message.received"
    ? {
        dispatchRef: buildHostedExecutionDispatchRef(dispatch),
        linqEvent: { ...dispatch.event.linqEvent },
        schemaVersion: serializedDispatch.schemaVersion as string,
      }
    : {
        dispatchRef: buildHostedExecutionDispatchRef(dispatch),
        schemaVersion: serializedDispatch.schemaVersion as string,
      };
}

export function createHostedWebhookLinqMessageSideEffect(input: {
  chatId: string;
  inviteId: string | null;
  message: string;
  sourceEventId: string;
}): HostedWebhookLinqMessageSideEffect {
  return {
    attemptCount: 0,
    effectId: `linq-message:${input.sourceEventId}`,
    kind: "linq_message_send",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      chatId: input.chatId,
      inviteId: input.inviteId,
      message: input.message,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
}

async function recordHostedWebhookReceipt(input: {
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  const now = new Date();
  const receipt = buildHostedWebhookProcessingReceipt({
    eventPayload: input.eventPayload,
    receivedAt: now,
  });

  try {
    await input.prisma.hostedWebhookReceipt.create({
      data: {
        source: input.source,
        eventId: input.eventId,
        firstReceivedAt: now,
        payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
      },
    });
    return receipt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reclaimHostedWebhookReceipt(input, now);
    }

    throw error;
  }
}

async function reclaimHostedWebhookReceipt(
  input: {
    eventId: string;
    eventPayload: HostedWebhookEventPayload;
    prisma: PrismaClient;
    source: string;
  },
  receivedAt: Date,
): Promise<HostedWebhookReceiptClaim | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!existingReceipt) {
      const receipt = buildHostedWebhookProcessingReceipt({
        eventPayload: input.eventPayload,
        receivedAt,
      });
      try {
        await input.prisma.hostedWebhookReceipt.create({
          data: {
            source: input.source,
            eventId: input.eventId,
            firstReceivedAt: receivedAt,
            payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
          },
        });
        return receipt;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }

        throw error;
      }
    }

    const existingState = readHostedWebhookReceiptState(existingReceipt.payloadJson);

    if (existingState.status === "completed" || existingState.status === "processing") {
      return null;
    }

    const nextReceipt = buildHostedWebhookProcessingReceipt({
      eventPayload: input.eventPayload,
      previousState: existingState,
      receivedAt,
    });
    const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
      where: {
        source: input.source,
        eventId: input.eventId,
        payloadJson: {
          equals: existingReceipt.payloadJson ?? Prisma.JsonNull,
        },
      },
      data: {
        payloadJson: toHostedWebhookReceiptJsonInput(nextReceipt.payloadJson),
      },
    });

    if (updatedReceipt.count === 1) {
      return nextReceipt;
    }
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_CLAIM_FAILED",
    message: "Hosted webhook receipt could not be claimed safely for processing.",
    httpStatus: 503,
    retryable: true,
  });
}

async function markHostedWebhookReceiptCompleted(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "completed",
  });
}

async function markHostedWebhookReceiptFailed(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    error: input.error,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "failed",
  });
}

async function queueHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  desiredSideEffects: HostedWebhookSideEffect[];
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  if (input.desiredSideEffects.length === 0) {
    return input.claimedReceipt;
  }

  return updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate(currentState) {
      return replaceHostedWebhookReceiptState(currentState, {
        sideEffects: mergeHostedWebhookSideEffects(currentState.sideEffects, input.desiredSideEffects),
      });
    },
    prisma: input.prisma,
    source: input.source,
  });
}

async function drainHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (const queuedEffect of currentClaim.state.sideEffects) {
    if (queuedEffect.status === "sent") {
      continue;
    }

    const startedAt = new Date().toISOString();
    currentClaim = await updateHostedWebhookReceiptClaim({
      claimedReceipt: currentClaim,
      eventId: input.eventId,
      mutate(currentState) {
        return replaceHostedWebhookReceiptState(currentState, {
          sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, queuedEffect.effectId, (effect) => ({
            ...effect,
            attemptCount: effect.attemptCount + 1,
            lastAttemptAt: startedAt,
            lastError: null,
          })),
        });
      },
      prisma: input.prisma,
      source: input.source,
    });

    const effect = getHostedWebhookSideEffect(currentClaim.state, queuedEffect.effectId);

    try {
      if (effect.kind === "hosted_execution_dispatch") {
        currentClaim = await markHostedWebhookDispatchEffectQueued({
          claimedReceipt: currentClaim,
          dispatchEffect: effect,
          enqueueDispatchEffect: input.handlers.enqueueDispatchEffect,
          eventId: input.eventId,
          prisma: input.prisma,
          sentAt: new Date().toISOString(),
          source: input.source,
        });
        continue;
      }

      const result = await input.handlers.performSideEffect(effect, {
        signal: input.signal,
      });
      const sentAt = new Date().toISOString();
      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate(currentState) {
          return replaceHostedWebhookReceiptState(currentState, {
            sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, effect.effectId, (currentEffect) =>
              markHostedWebhookSideEffectSent(currentEffect, result, sentAt),
            ),
          });
        },
        prisma: input.prisma,
        source: input.source,
      });

      if (input.handlers.afterSideEffectSent) {
        await input.handlers.afterSideEffectSent({
          effect,
          prisma: input.prisma,
        });
      }
    } catch (error) {
      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate(currentState) {
          return replaceHostedWebhookReceiptState(currentState, {
            sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, effect.effectId, (currentEffect) => ({
              ...currentEffect,
              lastError: serializeHostedWebhookSideEffectError(error),
              status: "pending",
            })),
          });
        },
        prisma: input.prisma,
        source: input.source,
      });
      throw new HostedWebhookReceiptSideEffectDrainError(currentClaim, error);
    }
  }

  return currentClaim;
}

async function markHostedWebhookDispatchEffectQueued(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  dispatchEffect: HostedWebhookDispatchSideEffect;
  enqueueDispatchEffect: HostedWebhookReceiptHandlers["enqueueDispatchEffect"];
  eventId: string;
  prisma: PrismaClient;
  sentAt: string;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextState = replaceHostedWebhookReceiptState(currentClaim.state, {
      sideEffects: replaceHostedWebhookSideEffects(
        currentClaim.state.sideEffects,
        input.dispatchEffect.effectId,
        (currentEffect) => markHostedWebhookSideEffectSent(currentEffect, { dispatched: true }, input.sentAt),
      ),
    });
    const nextClaim: HostedWebhookReceiptClaim = {
      payloadJson: serializeHostedWebhookReceiptState(nextState),
      state: nextState,
    };
    const updatedCount = await input.enqueueDispatchEffect({
      dispatch: requireHostedWebhookDispatchEffectDispatch(input.dispatchEffect),
      eventId: input.eventId,
      nextPayloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
      previousClaim: currentClaim,
      prisma: input.prisma,
      source: input.source,
    });

    if (updatedCount === 1) {
      return nextClaim;
    }

    const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!latestReceipt) {
      break;
    }

    currentClaim = {
      payloadJson: latestReceipt.payloadJson,
      state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    };
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}

async function updateHostedWebhookReceiptStatus(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error?: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
  status: "completed" | "failed";
}): Promise<void> {
  const receivedAt = new Date().toISOString();
  await updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate(currentState) {
      return replaceHostedWebhookReceiptState(currentState, {
        completedAt: input.status === "completed" ? receivedAt : null,
        eventPayload: mergeHostedWebhookEventPayload(
          input.eventPayload,
          currentState.eventPayload,
        ),
        lastError:
          input.status === "failed"
            ? serializeHostedWebhookReceiptError(input.error)
            : null,
        lastReceivedAt: receivedAt,
        status: input.status,
      });
    },
    prisma: input.prisma,
    source: input.source,
  });
}

function buildHostedWebhookProcessingReceipt(input: {
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

function buildHostedWebhookReceiptState(input: {
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

function serializeHostedWebhookReceiptState(
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

function readHostedWebhookReceiptState(
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

function serializeHostedWebhookReceiptError(error: unknown): HostedWebhookReceiptErrorState {
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

function readHostedWebhookReceiptDrainError(
  error: unknown,
): HostedWebhookReceiptSideEffectDrainError | null {
  return error instanceof HostedWebhookReceiptSideEffectDrainError
    ? error
    : null;
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}

function replaceHostedWebhookReceiptState(
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

function replaceHostedWebhookSideEffects(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  effectId: string,
  mutate: (effect: HostedWebhookSideEffect) => HostedWebhookSideEffect,
): HostedWebhookSideEffect[] {
  return currentSideEffects.map((effect) => effect.effectId === effectId ? mutate(effect) : effect);
}

function getHostedWebhookSideEffect(
  state: HostedWebhookReceiptState,
  effectId: string,
): HostedWebhookSideEffect {
  const effect = state.sideEffects.find((candidate) => candidate.effectId === effectId);

  if (!effect) {
    throw new Error(`Hosted webhook side effect ${effectId} was not found.`);
  }

  return effect;
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
    default:
      return effect;
  }
}

async function updateHostedWebhookReceiptClaim(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  mutate: (currentState: HostedWebhookReceiptState) => HostedWebhookReceiptState;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextState = input.mutate(currentClaim.state);
    const nextClaim: HostedWebhookReceiptClaim = {
      payloadJson: serializeHostedWebhookReceiptState(nextState),
      state: nextState,
    };
    const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
      where: {
        source: input.source,
        eventId: input.eventId,
        payloadJson: {
          equals: currentClaim.payloadJson ?? Prisma.JsonNull,
        },
      },
      data: {
        payloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
      },
    });

    if (updatedReceipt.count === 1) {
      return nextClaim;
    }

    const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!latestReceipt) {
      break;
    }

    currentClaim = {
      payloadJson: latestReceipt.payloadJson,
      state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    };
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}

function requireHostedWebhookDispatchEffectDispatch(
  effect: HostedWebhookDispatchSideEffect,
): HostedExecutionDispatchRequest {
  const dispatch = readHostedWebhookDispatchPayloadDispatch(effect.payload);

  if (!dispatch) {
    throw new Error(`Hosted webhook dispatch side effect ${effect.effectId} no longer carries a dispatch payload.`);
  }

  return dispatch;
}

function toHostedWebhookReceiptRecord(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toHostedWebhookReceiptObject(
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

function toHostedWebhookReceiptJsonInput(
  value: HostedWebhookReceiptClaim["payloadJson"],
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null
    ? Prisma.JsonNull
    : value as Prisma.InputJsonValue;
}
