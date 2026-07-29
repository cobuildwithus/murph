import type { HostedLinqWebhookEvent } from "./linq";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqChatHealthStatus,
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

export type HostedLinqProviderHealthEvent = {
  chat: {
    chatId: string;
    linePhoneNumber: string | null;
    providerStatus: HostedLinqChatHealthStatus;
    providerUpdatedAt: Date;
  } | null;
  line: {
    eventId: string;
    phoneNumber: string;
    providerUpdatedAt: Date;
    reputationStatus: HostedLinqLineReputationStatus | null;
    serviceStatus: HostedLinqLineServiceStatus | null;
  } | null;
};

export function parseHostedLinqProviderHealthEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqProviderHealthEvent {
  const data = readRecord(event.data);
  const chat = readRecord(data?.chat);
  const chatHealth = readRecord(chat?.health_status);
  const chatStatus = parseHostedLinqChatHealthStatus(chatHealth?.status);
  const chatId = normalizeNullableString(
    readString(chat?.id) ?? readString(data?.chat_id),
  );
  const chatUpdatedAt = parseProviderDate(chatHealth?.updated_at)
    ?? parseProviderDate(event.created_at);
  const linePhoneNumber = normalizePhoneNumber(
    readNestedString(chat, ["owner_handle", "handle"])
      ?? readString(data?.phone_number),
  );

  const lineServiceStatus = event.event_type === "phone_number.status_updated"
    ? parseHostedLinqLineServiceStatus(readProviderStatusValue(data?.new_status))
    : null;
  const lineReputationStatus = event.event_type === "phone_number.status_updated"
    ? parseHostedLinqLineReputationStatus(
        readProviderStatusValue(data?.new_reputation)
          ?? readProviderStatusValue(data?.new_health_status),
      )
    : null;
  const linePhone = event.event_type === "phone_number.status_updated"
    ? normalizePhoneNumber(readString(data?.phone_number))
    : null;
  const lineUpdatedAt = parseProviderDate(data?.changed_at)
    ?? parseProviderDate(data?.updated_at)
    ?? parseProviderDate(event.created_at);

  return {
    chat: chatStatus && chatId && chatUpdatedAt
      ? {
          chatId,
          linePhoneNumber,
          providerStatus: chatStatus,
          providerUpdatedAt: chatUpdatedAt,
        }
      : null,
    line:
      linePhone
      && lineUpdatedAt
      && (lineServiceStatus || lineReputationStatus)
        ? {
            eventId: event.event_id,
            phoneNumber: linePhone,
            providerUpdatedAt: lineUpdatedAt,
            reputationStatus: lineReputationStatus,
            serviceStatus: lineServiceStatus,
          }
        : null,
  };
}

function readProviderStatusValue(value: unknown): string | null {
  return readString(value) ?? readString(readRecord(value)?.status);
}

function parseProviderDate(value: unknown): Date | null {
  const normalized = normalizeNullableString(readString(value));
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readNestedString(
  record: Record<string, unknown> | null,
  path: readonly string[],
): string | null {
  let current: unknown = record;
  for (const key of path) {
    const currentRecord = readRecord(current);
    if (!currentRecord) {
      return null;
    }
    current = currentRecord[key];
  }
  return readString(current);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}
