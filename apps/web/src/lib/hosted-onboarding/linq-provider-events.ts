import type { Prisma } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqRecipientPhoneNumber,
} from "./linq";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString, sha256Hex } from "../primitives";

export const HOSTED_LINQ_PROVIDER_EVENT_TYPES = [
  "message.received",
  "message.delivered",
  "message.failed",
  "phone_number.status_updated",
] as const;

export type HostedLinqProviderEventType = typeof HOSTED_LINQ_PROVIDER_EVENT_TYPES[number];
export type HostedLinqProviderEventPhoneRole = "line" | "participant" | "unknown";
type HostedLinqProviderWebhookEvent = HostedLinqWebhookEvent & {
  event_type: HostedLinqProviderEventType;
};

export type ParsedHostedLinqProviderEvent = {
  apiVersion: string | null;
  deliveryStatus: "delivered" | "failed" | null;
  direction: string | null;
  eventId: string;
  eventType: HostedLinqProviderEventType;
  extractionJson: Prisma.InputJsonValue;
  failureCode: string | null;
  failureReason: string | null;
  linqChatLookupKey: string | null;
  messageIdSuffix: string | null;
  messageLookupKey: string | null;
  payloadHash: string | null;
  payloadSanitizedJson: Prisma.InputJsonValue;
  payloadShapeJson: Prisma.InputJsonValue;
  phoneNumber: string | null;
  phoneNumberHint: string | null;
  phoneNumberLookupKey: string | null;
  phoneNumberRole: HostedLinqProviderEventPhoneRole;
  providerCreatedAt: Date;
  providerReason: string | null;
  providerStatus: string | null;
  service: string | null;
  traceIdSuffix: string | null;
  webhookVersion: string | null;
};

const GENERIC_LINE_PHONE_PATHS = [
  ["phone_number"],
  ["phoneNumber"],
  ["line", "phone_number"],
  ["line", "phoneNumber"],
  ["line", "number"],
  ["phone_line", "phone_number"],
  ["phoneLine", "phoneNumber"],
  ["from_phone_number"],
  ["fromPhoneNumber"],
] as const;

const GENERIC_PARTICIPANT_PHONE_PATHS = [
  ["recipient_phone"],
  ["recipientPhone"],
  ["to"],
  ["to_phone_number"],
  ["toPhoneNumber"],
  ["recipient_handle", "handle"],
] as const;

export function parseHostedLinqProviderEvent(input: {
  event: HostedLinqWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent | null {
  const event = readHostedLinqProviderWebhookEvent(input.event);
  if (!event) {
    return null;
  }

  if (event.event_type === "message.received") {
    return parseHostedLinqMessageReceivedProviderEvent({
      event,
      rawBody: input.rawBody,
    });
  }

  return parseGenericHostedLinqProviderEvent({
    event,
    rawBody: input.rawBody,
  });
}

export function isHostedLinqProviderEventType(value: string): value is HostedLinqProviderEventType {
  return (HOSTED_LINQ_PROVIDER_EVENT_TYPES as readonly string[]).includes(value);
}

function parseHostedLinqMessageReceivedProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const linePhoneNumber = normalizePhoneNumber(resolveHostedLinqRecipientPhoneNumber(messageEvent));
  const messageId = normalizeNullableString(messageEvent.data.message.id);
  const chatId = normalizeNullableString(messageEvent.data.chat_id);
  const direction = normalizeNullableString(messageEvent.data.direction)
    ?? (messageEvent.data.is_from_me ? "outbound" : "inbound");

  return buildParsedProviderEvent({
    chatId,
    deliveryStatus: null,
    direction,
    event: input.event,
    extraction: {
      chatIdPresent: chatId !== null,
      extractionStrategy: "message.received-normalized",
      isFromMe: messageEvent.data.is_from_me,
      messageIdPresent: messageId !== null,
      phoneNumberRole: linePhoneNumber ? "line" : "unknown",
      servicePresent: Boolean(messageEvent.data.service),
    },
    failureCode: null,
    failureReason: null,
    messageId,
    phoneNumber: linePhoneNumber,
    phoneNumberRole: linePhoneNumber ? "line" : "unknown",
    providerReason: null,
    providerStatus: null,
    rawBody: input.rawBody,
    service: normalizeNullableString(messageEvent.data.service),
  });
}

function parseGenericHostedLinqProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const data = readRecord(input.event.data);
  const linePhoneNumber = normalizePhoneNumber(readFirstStringAtPaths(data, GENERIC_LINE_PHONE_PATHS));
  const participantPhoneNumber = normalizePhoneNumber(
    readFirstStringAtPaths(data, GENERIC_PARTICIPANT_PHONE_PATHS),
  );
  const phoneNumber = linePhoneNumber ?? participantPhoneNumber;
  const phoneNumberRole: HostedLinqProviderEventPhoneRole = linePhoneNumber
    ? "line"
    : participantPhoneNumber
      ? "participant"
      : "unknown";
  const chatId = readFirstStringAtPaths(data, [
    ["chat_id"],
    ["chatId"],
    ["chat", "id"],
  ] as const);
  const messageId = readFirstStringAtPaths(data, [
    ["message_id"],
    ["messageId"],
    ["message", "id"],
    ["id"],
  ] as const);
  const service = readFirstStringAtPaths(data, [
    ["service"],
    ["sender_handle", "service"],
    ["line", "service"],
  ] as const);
  const providerStatus = readFirstStringAtPaths(data, [
    ["status"],
    ["phone_number", "status"],
    ["line", "status"],
    ["state"],
  ] as const);
  const providerReason = readFirstStringAtPaths(data, [
    ["reason"],
    ["status_reason"],
    ["statusReason"],
    ["details"],
  ] as const);
  const failureCode = readFirstStringAtPaths(data, [
    ["code"],
    ["error_code"],
    ["errorCode"],
    ["failure_code"],
    ["failureCode"],
    ["error", "code"],
  ] as const);
  const failureReason = readFirstStringAtPaths(data, [
    ["failure_reason"],
    ["failureReason"],
    ["error", "message"],
    ["error", "detail"],
    ["reason"],
  ] as const);
  const deliveryStatus = input.event.event_type === "message.delivered"
    ? "delivered"
    : input.event.event_type === "message.failed"
      ? "failed"
      : null;

  return buildParsedProviderEvent({
    chatId,
    deliveryStatus,
    direction: readFirstStringAtPaths(data, [["direction"]] as const),
    event: input.event,
    extraction: {
      chatIdPresent: chatId !== null,
      extractionStrategy: "generic-operational-event",
      failureCodePresent: failureCode !== null,
      messageIdPresent: messageId !== null,
      phoneNumberPresent: phoneNumber !== null,
      phoneNumberRole,
      providerStatusPresent: providerStatus !== null,
      servicePresent: service !== null,
    },
    failureCode,
    failureReason,
    messageId,
    phoneNumber,
    phoneNumberRole,
    providerReason,
    providerStatus,
    rawBody: input.rawBody,
    service,
  });
}

function buildParsedProviderEvent(input: {
  chatId: string | null;
  deliveryStatus: "delivered" | "failed" | null;
  direction: string | null;
  event: HostedLinqProviderWebhookEvent;
  extraction: Record<string, boolean | number | string | null>;
  failureCode: string | null;
  failureReason: string | null;
  messageId: string | null;
  phoneNumber: string | null;
  phoneNumberRole: HostedLinqProviderEventPhoneRole;
  providerReason: string | null;
  providerStatus: string | null;
  rawBody?: string | null;
  service: string | null;
}): ParsedHostedLinqProviderEvent {
  const providerCreatedAt = parseProviderCreatedAt(input.event.created_at);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const phoneNumberIsLine = input.phoneNumberRole === "line";
  const phoneNumberLookupKey = phoneNumberIsLine ? createHostedPhoneLookupKey(phoneNumber) : null;
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.chatId);
  const payloadShapeJson = toPrismaJson(buildHostedJsonShape(input.event));

  return {
    apiVersion: normalizeNullableString(input.event.api_version),
    deliveryStatus: input.deliveryStatus,
    direction: normalizeNullableString(input.direction),
    eventId: input.event.event_id,
    eventType: input.event.event_type,
    extractionJson: toPrismaJson({
      ...input.extraction,
      extractionVersion: 1,
    }),
    failureCode: normalizeSafeProviderText(input.failureCode),
    failureReason: normalizeSafeProviderText(input.failureReason),
    linqChatLookupKey,
    messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
    messageLookupKey,
    payloadHash: buildPayloadHash(input.rawBody, input.event),
    payloadSanitizedJson: toPrismaJson({
      api_version: normalizeNullableString(input.event.api_version),
      created_at: input.event.created_at,
      data_shape: payloadShapeJson,
      event_id_suffix: toHostedOnboardingLogIdSuffix(input.event.event_id),
      event_type: input.event.event_type,
      trace_id_suffix: toHostedOnboardingLogIdSuffix(input.event.trace_id),
      webhook_version: normalizeNullableString(input.event.webhook_version ?? null),
    }),
    payloadShapeJson,
    phoneNumber,
    phoneNumberHint: phoneNumberIsLine && phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
    phoneNumberRole: input.phoneNumberRole,
    providerCreatedAt,
    providerReason: normalizeSafeProviderText(input.providerReason),
    providerStatus: normalizeSafeProviderText(input.providerStatus),
    service: normalizeSafeProviderText(input.service),
    traceIdSuffix: toHostedOnboardingLogIdSuffix(input.event.trace_id),
    webhookVersion: normalizeNullableString(input.event.webhook_version ?? null),
  };
}

function readHostedLinqProviderWebhookEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqProviderWebhookEvent | null {
  const eventType = event.event_type;
  if (!isHostedLinqProviderEventType(eventType)) {
    return null;
  }

  return {
    ...event,
    event_type: eventType,
  };
}

function parseProviderCreatedAt(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function readFirstStringAtPaths(
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>,
): string | null {
  for (const path of paths) {
    const value = readStringAtPath(record, path);
    if (value) {
      return value;
    }
  }

  return null;
}

function readStringAtPath(record: Record<string, unknown> | null, path: readonly string[]): string | null {
  let value: unknown = record;
  for (const key of path) {
    const current = readRecord(value);
    if (!current) {
      return null;
    }
    value = current[key];
  }

  if (typeof value === "number") {
    return normalizeNullableString(String(value));
  }

  return typeof value === "string" ? normalizeNullableString(value) : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeSafeProviderText(value: string | null): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 160);
}

function buildPayloadHash(rawBody: string | null | undefined, event: HostedLinqWebhookEvent): string | null {
  try {
    return sha256Hex(rawBody ?? JSON.stringify(event));
  } catch {
    return null;
  }
}

function buildHostedJsonShape(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      item: value.length > 0 ? buildHostedJsonShape(value[0], depth + 1) : null,
    };
  }
  if (!value || typeof value !== "object") {
    return { kind: value === null ? "null" : typeof value };
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 40)
    .map(([key, entry]) => [key, buildHostedJsonShape(entry, depth + 1)] as const);

  return {
    kind: "object",
    keys: Object.fromEntries(entries),
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
