import type {
  HostedExecutionDispatchRequest,
  HostedWakeLinqMessageReceivedPayload,
  HostedWakeTelegramMessageReceivedPayload,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  buildHostedWakeLinqMessageReceivedPayload,
  buildHostedWakeTelegramMessageReceivedPayload,
} from "@murphai/hosted-execution";
import { Prisma } from "@prisma/client";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedWakeDispatchPayload,
  parseHostedWakeLinqMessageReceivedPayload,
  parseHostedWakeTelegramMessageReceivedPayload,
} from "@murphai/hosted-execution/parsers";

import {
  type HostedExecutionDispatchPayload,
  readHostedExecutionDispatchPayload,
} from "../hosted-execution/dispatch-payload";
import { hostedOnboardingError } from "./errors";

export interface HostedWebhookMessageWakeAppendPayload {
  eventId: string;
  kind: "linq.message.received" | "telegram.message.received";
  occurredAt: string;
  payload: HostedWakeLinqMessageReceivedPayload | HostedWakeTelegramMessageReceivedPayload;
  payloadSchema: typeof HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA;
  userId: string;
}

export type HostedWebhookDispatchSideEffectPayload =
  | HostedExecutionDispatchPayload
  | HostedWebhookMessageWakeAppendPayload;
export type HostedWebhookStoredDispatchSideEffectPayload =
  HostedWebhookDispatchSideEffectPayload;

export function createHostedWebhookDispatchSideEffectPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedWebhookDispatchSideEffectPayload {
  return {
    dispatch: parseHostedExecutionDispatchRequest(dispatch),
    storage: "inline",
  };
}

export function createHostedWebhookLinqMessageWakeAppendPayload(input: {
  eventId: string;
  linqEvent: Record<string, unknown>;
  linqMessageId?: string | null;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedWebhookMessageWakeAppendPayload {
  return {
    eventId: input.eventId,
    kind: "linq.message.received",
    occurredAt: input.occurredAt,
    payload: buildHostedWakeLinqMessageReceivedPayload({
      eventId: input.eventId,
      linqEvent: input.linqEvent,
      ...(input.linqMessageId === undefined ? {} : { linqMessageId: input.linqMessageId }),
      phoneLookupKey: input.phoneLookupKey,
    }),
    payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
    userId: input.userId,
  };
}

export function createHostedWebhookTelegramMessageWakeAppendPayload(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedWakeTelegramMessageReceivedPayload["telegramMessage"];
  userId: string;
}): HostedWebhookMessageWakeAppendPayload {
  return {
    eventId: input.eventId,
    kind: "telegram.message.received",
    occurredAt: input.occurredAt,
    payload: buildHostedWakeTelegramMessageReceivedPayload({
      eventId: input.eventId,
      telegramMessage: input.telegramMessage,
    }),
    payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
    userId: input.userId,
  };
}

export function readHostedWebhookStoredDispatchSideEffectPayload(
  value: unknown,
): HostedWebhookStoredDispatchSideEffectPayload | null {
  return readHostedExecutionDispatchPayload(value as Prisma.InputJsonValue | Prisma.JsonValue | null)
    ?? readHostedWebhookMessageWakeAppendPayload(value as Prisma.InputJsonValue | Prisma.JsonValue | null);
}

export function requireHostedWebhookStoredDispatchSideEffectPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
  effectId: string,
): HostedWebhookStoredDispatchSideEffectPayload {
  const storedPayload = readHostedWebhookStoredDispatchSideEffectPayload(payload);

  if (storedPayload) {
    return storedPayload;
  }

  throw hostedOnboardingError({
    code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_INVALID",
    message: `Hosted webhook dispatch side effect ${effectId} must use an inline hosted execution payload.`,
    httpStatus: 500,
    retryable: false,
  });
}

export function buildHostedWebhookDispatchFromPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
): HostedExecutionDispatchRequest | null {
  return "storage" in payload
    ? payload.storage === "inline"
      ? parseHostedExecutionDispatchRequest(payload.dispatch)
      : null
    : parseHostedWakeDispatchPayload({
      kind: payload.kind,
      occurredAt: payload.occurredAt,
      payloadJson: payload.payload,
      payloadSchema: payload.payloadSchema,
      userId: payload.userId,
    });
}

export function isHostedWebhookMessageWakeAppendPayload(
  payload: HostedWebhookDispatchSideEffectPayload | HostedWebhookStoredDispatchSideEffectPayload,
): payload is HostedWebhookMessageWakeAppendPayload {
  return !("storage" in payload);
}

function readHostedWebhookMessageWakeAppendPayload(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookMessageWakeAppendPayload | null {
  const record = toHostedWebhookObject(value);
  const kind = readHostedWebhookMessageWakeKind(record.kind);
  const eventId = readHostedWebhookText(record.eventId);
  const occurredAt = readHostedWebhookText(record.occurredAt);
  const payloadSchema = readHostedWebhookText(record.payloadSchema);
  const userId = readHostedWebhookText(record.userId);

  if (
    !kind
    || !eventId
    || !occurredAt
    || payloadSchema !== HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA
    || !userId
  ) {
    return null;
  }

  const payload = kind === "linq.message.received"
    ? parseHostedWakeLinqMessageReceivedPayload(record.payload)
    : parseHostedWakeTelegramMessageReceivedPayload(record.payload);

  return {
    eventId,
    kind,
    occurredAt,
    payload,
    payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
    userId,
  };
}

function toHostedWebhookObject(
  value: unknown,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readHostedWebhookMessageWakeKind(
  value: unknown,
): HostedWebhookMessageWakeAppendPayload["kind"] | null {
  return value === "linq.message.received" || value === "telegram.message.received"
    ? value
    : null;
}

function readHostedWebhookText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}
