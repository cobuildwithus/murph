import type { Prisma } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  type HostedLinqWebhookEvent,
  type HostedLinqMessageReceivedEvent,
  requireHostedLinqMessageEditedEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqRecipientPhoneNumber,
} from "./linq";
import {
  sanitizeHostedOnboardingLogString,
  sanitizeHostedOnboardingProviderReason,
} from "./http";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqChatHealthStatus,
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString, sha256Hex } from "../primitives";

export const HOSTED_LINQ_PROVIDER_EVENT_TYPES = [
  "chat.group_icon_updated",
  "chat.group_icon_update_failed",
  "message.edited",
  "message.received",
  "message.sent",
  "message.delivered",
  "message.failed",
  "participant.added",
  "participant.removed",
  "phone_number.status_updated",
  "reaction.added",
  "reaction.removed",
] as const;

export type HostedLinqProviderEventType = typeof HOSTED_LINQ_PROVIDER_EVENT_TYPES[number];
export type HostedLinqProviderEventPhoneRole = "line" | "participant" | "unknown";
const HOSTED_LINQ_GROUP_ICON_FAILURE_CODES = new Set([3007, 5006, 5007]);
type HostedLinqProviderWebhookEvent = HostedLinqWebhookEvent & {
  event_type: HostedLinqProviderEventType;
};

export type HostedLinqProviderHealthEvent = {
  chat: {
    chatId: string;
    isGroup: boolean | null;
    linePhoneNumber: string | null;
    providerStatus: HostedLinqChatHealthStatus;
    providerUpdatedAt: Date;
    service: string | null;
  } | null;
  line: {
    eventId: string;
    phoneNumber: string;
    providerUpdatedAt: Date;
    reputationStatus: HostedLinqLineReputationStatus | null;
    serviceStatus: HostedLinqLineServiceStatus | null;
  } | null;
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
  linqChatId: string | null;
  linqMessageId: string | null;
  linqChatLookupKey: string | null;
  messageIdSuffix: string | null;
  messageLookupKey: string | null;
  messageLookupKeyReadCandidates: string[];
  payloadHash: string | null;
  payloadSanitizedJson: Prisma.InputJsonValue;
  payloadShapeJson: Prisma.InputJsonValue;
  phoneNumber: string | null;
  phoneNumberHint: string | null;
  phoneNumberLookupKey: string | null;
  phoneNumberRole: HostedLinqProviderEventPhoneRole;
  providerCreatedAt: Date;
  providerHealth?: HostedLinqProviderHealthEvent;
  providerReason: string | null;
  providerStatus: string | null;
  reactionCustomEmoji: string | null;
  reactionFromHandle: string | null;
  reactionIsFromMe: boolean | null;
  reactionPartIndex: number | null;
  reactionType: string | null;
  service: string | null;
  traceIdSuffix: string | null;
  webhookVersion: string | null;
};

const GENERIC_LINE_PHONE_PATHS = [
  ["phone_number"],
  ["phoneNumber"],
  ["chat", "owner_handle", "handle"],
  ["chat", "ownerHandle", "handle"],
  ["sender_handle", "handle"],
  ["senderHandle", "handle"],
  ["from_handle", "handle"],
  ["fromHandle", "handle"],
  ["from"],
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

export function parseHostedLinqProviderHealthEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqProviderHealthEvent {
  const data = readRecord(event.data);
  const chat = readRecord(data?.chat);
  const chatHealth = readRecord(chat?.health_status);
  const chatStatus = parseHostedLinqChatHealthStatus(chatHealth?.status);
  const chatId = normalizeNullableString(
    readStringAtPath(chat, ["id"])
      ?? readStringAtPath(data, ["chat_id"]),
  );
  const chatUpdatedAt = parseProviderDate(
    readStringAtPath(chatHealth, ["updated_at"]),
  ) ?? parseProviderDate(event.created_at);
  const linePhoneNumber = normalizePhoneNumber(
    readStringAtPath(chat, ["owner_handle", "handle"])
      ?? readStringAtPath(data, ["phone_number"]),
  );

  const lineServiceStatus = event.event_type === "phone_number.status_updated"
    ? parseHostedLinqLineServiceStatus(
        readProviderStatusValue(data?.new_status),
      )
    : null;
  const lineReputationStatus =
    event.event_type === "phone_number.status_updated"
      ? parseHostedLinqLineReputationStatus(
          readProviderStatusValue(data?.new_reputation)
            ?? readProviderStatusValue(data?.new_health_status),
        )
      : null;
  const linePhone = event.event_type === "phone_number.status_updated"
    ? normalizePhoneNumber(readStringAtPath(data, ["phone_number"]))
    : null;
  const lineUpdatedAt = parseProviderDate(
    readStringAtPath(data, ["changed_at"]),
  ) ?? parseProviderDate(readStringAtPath(data, ["updated_at"]))
    ?? parseProviderDate(event.created_at);

  return {
    chat: chatStatus && chatId && chatUpdatedAt
      ? {
          chatId,
          isGroup: typeof chat?.is_group === "boolean"
            ? chat.is_group
            : null,
          linePhoneNumber,
          providerStatus: chatStatus,
          providerUpdatedAt: chatUpdatedAt,
          service: normalizeNullableString(
            readStringAtPath(chat, ["service"]),
          ),
        }
      : null,
    line:
      event.event_type === "phone_number.status_updated"
      && linePhone
      && lineUpdatedAt
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

const HOSTED_LINQ_PROVIDER_TIMESTAMP_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d\d(?::?\d\d)?)$/u;

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

  if (event.event_type === "message.edited") {
    return parseHostedLinqMessageEditedProviderEvent({
      event,
      rawBody: input.rawBody,
    });
  }

  if (
    event.event_type === "chat.group_icon_updated"
    || event.event_type === "chat.group_icon_update_failed"
  ) {
    return parseHostedLinqGroupIconProviderEvent({
      event,
      rawBody: input.rawBody,
    });
  }

  if (event.event_type === "reaction.added" || event.event_type === "reaction.removed") {
    return parseHostedLinqReactionProviderEvent({
      event,
      rawBody: input.rawBody,
    });
  }

  if (event.event_type === "participant.added" || event.event_type === "participant.removed") {
    return parseHostedLinqParticipantProviderEvent({
      event,
      rawBody: input.rawBody,
    });
  }

  return parseGenericHostedLinqProviderEvent({
    event,
    rawBody: input.rawBody,
  });
}

function parseHostedLinqGroupIconProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const data = readRecord(input.event.data);
  const chatId = readFirstStringAtPaths(data, [
    ["chat_id"],
    ["chatId"],
    ["chat", "id"],
  ] as const);
  const failed = input.event.event_type === "chat.group_icon_update_failed";
  const rawFailureCode = failed
    ? readFirstIntegerAtPaths(data, [
        ["error_code"],
        ["errorCode"],
        ["error", "code"],
      ] as const)
    : null;
  const failureCode = rawFailureCode !== null
    && HOSTED_LINQ_GROUP_ICON_FAILURE_CODES.has(rawFailureCode)
      ? String(rawFailureCode)
      : null;
  const providerCreatedAt = parseProviderDate(readFirstStringAtPaths(data, [
    failed ? ["failed_at"] : ["updated_at"],
    failed ? ["failedAt"] : ["updatedAt"],
  ] as const));

  return buildParsedProviderEvent({
    chatId,
    deliveryStatus: null,
    direction: null,
    event: input.event,
    extraction: {
      chatIdPresent: chatId !== null,
      extractionStrategy: "group-icon-outcome",
      failureCodePresent: failureCode !== null,
      iconValuesRetained: false,
      phoneNumberRole: "unknown",
      providerTimestampPresent: providerCreatedAt !== null,
      servicePresent: false,
    },
    failureCode,
    failureReason: null,
    messageId: null,
    phoneNumber: null,
    phoneNumberRole: "unknown",
    providerCreatedAt,
    providerHealth: { chat: null, line: null },
    providerReason: null,
    providerStatus: failed ? "failed" : "updated",
    rawBody: input.rawBody,
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionType: null,
    service: null,
  });
}

function parseHostedLinqMessageEditedProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const editEvent = requireHostedLinqMessageEditedEvent(input.event);
  const lineHandle = editEvent.data.chat.owner_handle ?? null;
  const linePhoneNumber = normalizePhoneNumber(lineHandle?.handle);

  return buildParsedProviderEvent({
    chatId: editEvent.data.chat.id,
    deliveryStatus: null,
    direction: editEvent.data.direction,
    event: input.event,
    extraction: {
      chatIdPresent: true,
      extractionStrategy: "message.edited-normalized",
      messageIdPresent: true,
      partIndexPresent: true,
      phoneNumberRole: linePhoneNumber ? "line" : "unknown",
      servicePresent: Boolean(lineHandle?.service),
    },
    failureCode: null,
    failureReason: null,
    messageId: editEvent.data.id,
    phoneNumber: linePhoneNumber,
    phoneNumberRole: linePhoneNumber ? "line" : "unknown",
    providerCreatedAt: new Date(editEvent.data.edited_at),
    providerReason: null,
    providerStatus: null,
    rawBody: input.rawBody,
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionType: null,
    service: normalizeNullableString(lineHandle?.service),
  });
}

function parseHostedLinqParticipantProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const data = readRecord(input.event.data);
  const chatId = readFirstStringAtPaths(data, [
    ["chat_id"],
    ["chatId"],
    ["chat", "id"],
  ] as const);
  const service = readFirstStringAtPaths(data, [
    ["participant", "service"],
    ["participant_handle", "service"],
    ["participantHandle", "service"],
    ["service"],
  ] as const);
  const changedAt = parseProviderDate(readFirstStringAtPaths(data, [
    input.event.event_type === "participant.added" ? ["added_at"] : ["removed_at"],
    input.event.event_type === "participant.added" ? ["addedAt"] : ["removedAt"],
  ] as const));

  return buildParsedProviderEvent({
    chatId,
    deliveryStatus: null,
    direction: null,
    event: input.event,
    extraction: {
      chatIdPresent: chatId !== null,
      extractionStrategy: "participant-event",
      phoneNumberRole: "unknown",
      servicePresent: service !== null,
    },
    failureCode: null,
    failureReason: null,
    messageId: null,
    phoneNumber: null,
    phoneNumberRole: "unknown",
    providerCreatedAt: changedAt,
    providerReason: null,
    providerStatus: null,
    rawBody: input.rawBody,
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionType: null,
    service,
  });
}

export function isHostedLinqProviderEventType(value: string): value is HostedLinqProviderEventType {
  return (HOSTED_LINQ_PROVIDER_EVENT_TYPES as readonly string[]).includes(value);
}

export function isHostedLinqAffirmativeReaction(input: {
  customEmoji?: string | null;
  eventType: string;
  reactionType?: string | null;
}): boolean {
  if (input.eventType !== "reaction.added") {
    return false;
  }
  const reactionType = normalizeReactionToken(input.reactionType);
  if (
    reactionType === "like"
    || reactionType === "love"
    || reactionType === "thumbs_up"
    || reactionType === "thumbsup"
    || reactionType === "heart"
  ) {
    return true;
  }

  const customEmoji = normalizeReactionEmoji(input.customEmoji);
  return customEmoji === "👍" || customEmoji === "❤";
}

function parseHostedLinqMessageReceivedProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const messageId = normalizeNullableString(messageEvent.data.message.id);
  const chatId = normalizeNullableString(messageEvent.data.chat_id);
  const direction = normalizeNullableString(messageEvent.data.direction)
    ?? (messageEvent.data.is_from_me ? "outbound" : "inbound");
  const linePhoneNumber = resolveHostedLinqMessageReceivedLinePhoneNumber({
    direction,
    event: messageEvent,
  });

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
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionType: null,
    service: normalizeNullableString(messageEvent.data.service),
  });
}

function parseHostedLinqReactionProviderEvent(input: {
  event: HostedLinqProviderWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent {
  const data = readRecord(input.event.data);
  const chatId = readFirstStringAtPaths(data, [
    ["chat_id"],
    ["chatId"],
    ["chat", "id"],
  ] as const);
  const messageId = readFirstStringAtPaths(data, [
    ["message_id"],
    ["messageId"],
    ["message", "id"],
  ] as const);
  const linePhoneNumber = normalizePhoneNumber(readFirstStringAtPaths(data, [
    ["phone_number"],
    ["phoneNumber"],
    ["line", "phone_number"],
    ["line", "phoneNumber"],
    ["phone_line", "phone_number"],
    ["phoneLine", "phoneNumber"],
  ] as const));
  const reactionType = readFirstStringAtPaths(data, [
    ["reaction_type"],
    ["reactionType"],
    ["reaction", "type"],
    ["type"],
  ] as const);
  const reactionCustomEmoji = readFirstStringAtPaths(data, [
    ["custom_emoji"],
    ["customEmoji"],
    ["emoji"],
    ["reaction", "custom_emoji"],
    ["reaction", "customEmoji"],
    ["reaction", "emoji"],
  ] as const);
  const reactionFromHandle = readFirstHandleAtPaths(data, [
    ["from"],
    ["from_handle"],
    ["fromHandle"],
    ["sender_handle"],
    ["senderHandle"],
    ["actor", "handle"],
    ["reactor", "handle"],
  ] as const);
  const rawReactionIsFromMe = data?.is_from_me;
  const reactionIsFromMe = typeof rawReactionIsFromMe === "boolean"
    ? rawReactionIsFromMe
    : null;
  const reactionPartIndex = readFirstIntegerAtPaths(data, [
    ["part_index"],
    ["partIndex"],
    ["reaction", "part_index"],
    ["reaction", "partIndex"],
  ] as const);
  const service = readFirstStringAtPaths(data, [
    ["service"],
    ["from_handle", "service"],
    ["fromHandle", "service"],
    ["sender_handle", "service"],
    ["reaction", "service"],
  ] as const);
  const reactedAt = parseProviderDate(readFirstStringAtPaths(data, [
    ["reacted_at"],
    ["reactedAt"],
    ["created_at"],
    ["createdAt"],
  ] as const));

  return buildParsedProviderEvent({
    chatId,
    deliveryStatus: null,
    direction: null,
    event: input.event,
    extraction: {
      chatIdPresent: chatId !== null,
      customEmojiPresent: reactionCustomEmoji !== null,
      extractionStrategy: "reaction-event",
      fromHandlePresent: reactionFromHandle !== null,
      isFromMePresent: reactionIsFromMe !== null,
      messageIdPresent: messageId !== null,
      partIndexPresent: reactionPartIndex !== null,
      phoneNumberRole: linePhoneNumber ? "line" : "unknown",
      reactionTypePresent: reactionType !== null,
      servicePresent: service !== null,
    },
    failureCode: null,
    failureReason: null,
    messageId,
    phoneNumber: linePhoneNumber,
    phoneNumberRole: linePhoneNumber ? "line" : "unknown",
    providerCreatedAt: reactedAt,
    providerReason: null,
    providerStatus: null,
    rawBody: input.rawBody,
    reactionCustomEmoji,
    reactionFromHandle,
    reactionIsFromMe,
    reactionPartIndex,
    reactionType,
    service,
  });
}

function resolveHostedLinqMessageReceivedLinePhoneNumber(input: {
  direction: string | null;
  event: HostedLinqMessageReceivedEvent;
}): string | null {
  if (input.direction === "outbound" || input.event.data.is_from_me) {
    return resolveHostedLinqOutboundMessageLinePhoneNumber(input.event);
  }

  return normalizePhoneNumber(resolveHostedLinqRecipientPhoneNumber(input.event));
}

function resolveHostedLinqOutboundMessageLinePhoneNumber(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  const ownerPhoneNumber = normalizePhoneNumber(event.data.chat?.owner_handle?.handle);
  if (ownerPhoneNumber) {
    return ownerPhoneNumber;
  }

  if (event.data.sender_handle?.is_me === true) {
    const senderPhoneNumber = normalizePhoneNumber(event.data.sender_handle.handle);
    if (senderPhoneNumber) {
      return senderPhoneNumber;
    }
  }

  if (event.data.from_handle?.is_me === true) {
    const fromHandlePhoneNumber = normalizePhoneNumber(event.data.from_handle.handle);
    if (fromHandlePhoneNumber) {
      return fromHandlePhoneNumber;
    }
  }

  return null;
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
    ["new_status"],
    ["new_status", "status"],
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
  const providerCreatedAt = input.event.event_type === "phone_number.status_updated"
    ? parseProviderDate(readFirstStringAtPaths(data, [
      ["changed_at"],
      ["changedAt"],
      ["updated_at"],
      ["updatedAt"],
    ] as const))
    : input.event.event_type === "message.sent"
      ? parseProviderDate(readFirstStringAtPaths(data, [
        ["sent_at"],
        ["sentAt"],
        ["message", "sent_at"],
        ["message", "sentAt"],
      ] as const))
      : null;
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
    direction: readFirstStringAtPaths(data, [["direction"]] as const)
      ?? (input.event.event_type === "message.sent" ? "outbound" : null),
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
    providerCreatedAt,
    providerReason,
    providerStatus,
    rawBody: input.rawBody,
    reactionCustomEmoji: null,
    reactionFromHandle: null,
    reactionType: null,
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
  providerCreatedAt?: Date | null;
  providerHealth?: HostedLinqProviderHealthEvent;
  providerReason: string | null;
  providerStatus: string | null;
  rawBody?: string | null;
  reactionCustomEmoji: string | null;
  reactionFromHandle: string | null;
  reactionIsFromMe?: boolean | null;
  reactionPartIndex?: number | null;
  reactionType: string | null;
  service: string | null;
}): ParsedHostedLinqProviderEvent {
  const providerCreatedAt = input.providerCreatedAt ?? parseProviderCreatedAt(input.event.created_at);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const phoneNumberIsLine = input.phoneNumberRole === "line";
  const phoneNumberLookupKey = phoneNumberIsLine ? createHostedPhoneLookupKey(phoneNumber) : null;
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const messageLookupKeyReadCandidates = createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  const linqChatId = normalizeNullableString(input.chatId);
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
    failureCode: normalizeSafeProviderToken(input.failureCode),
    failureReason: normalizeProviderFreeText(input.failureReason),
    linqChatId,
    linqMessageId: normalizeNullableString(input.messageId),
    linqChatLookupKey,
    messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
    messageLookupKey,
    messageLookupKeyReadCandidates,
    payloadHash: buildPayloadHash(input.rawBody, input.event),
    // `payloadShapeJson` below is the canonical shape; embedding a second copy
    // here stored the same diagnostic twice for every provider event.
    payloadSanitizedJson: toPrismaJson({
      api_version: normalizeNullableString(input.event.api_version),
      created_at: providerCreatedAt.toISOString(),
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
    providerHealth:
      input.providerHealth ?? parseHostedLinqProviderHealthEvent(input.event),
    providerReason: normalizeProviderFreeText(input.providerReason),
    providerStatus: normalizeSafeProviderToken(input.providerStatus),
    reactionCustomEmoji: normalizeSafeProviderToken(input.reactionCustomEmoji),
    reactionFromHandle: normalizeNullableString(input.reactionFromHandle),
    reactionIsFromMe: input.reactionIsFromMe ?? null,
    reactionPartIndex: input.reactionPartIndex ?? null,
    reactionType: normalizeSafeProviderToken(input.reactionType),
    service: normalizeSafeProviderToken(input.service),
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
  return parseProviderDate(value) ?? new Date(0);
}

function parseProviderDate(value: string | null): Date | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  if (!HOSTED_LINQ_PROVIDER_TIMESTAMP_TIMEZONE_PATTERN.test(normalized)) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
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

function readFirstHandleAtPaths(
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>,
): string | null {
  for (const path of paths) {
    const value = readValueAtPath(record, path);
    if (typeof value === "string") {
      const normalized = normalizeNullableString(value);
      if (normalized) {
        return normalized;
      }
    }
    const nested = readRecord(value);
    const handle = nested ? readStringAtPath(nested, ["handle"]) : null;
    if (handle) {
      return handle;
    }
  }

  return null;
}

function readFirstIntegerAtPaths(
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>,
): number | null {
  for (const path of paths) {
    const value = readValueAtPath(record, path);
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function readValueAtPath(record: Record<string, unknown> | null, path: readonly string[]): unknown {
  let value: unknown = record;
  for (const key of path) {
    const current = readRecord(value);
    if (!current) {
      return null;
    }
    value = current[key];
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeReactionToken(value: string | null | undefined): string | null {
  return normalizeNullableString(value)?.toLowerCase().replace(/[\s-]+/gu, "_") ?? null;
}

function normalizeReactionEmoji(value: string | null | undefined): string | null {
  return normalizeNullableString(value)
    ?.replace(/[\uFE0E\uFE0F]/gu, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "") ?? null;
}

function normalizeSafeProviderToken(value: string | null): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  return sanitizeHostedOnboardingLogString(normalized, 160);
}

function normalizeProviderFreeText(value: string | null): string | null {
  return sanitizeHostedOnboardingProviderReason(normalizeNullableString(value));
}

function readProviderStatusValue(value: unknown): string | null {
  return typeof value === "string"
    ? normalizeNullableString(value)
    : readStringAtPath(readRecord(value), ["status"]);
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
    return { kind: "max_depth" };
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

  const entries = Object.values(value as Record<string, unknown>);

  return {
    kind: "object",
    keyCount: entries.length,
    sampleValues: entries
      .slice(0, 40)
      .map((entry) => buildHostedJsonShape(entry, depth + 1)),
    truncated: entries.length > 40,
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
