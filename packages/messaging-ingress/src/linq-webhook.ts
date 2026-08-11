import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import {
  compactRecord,
  normalizeTextValue,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "./internal.ts";

export interface LinqWebhookEvent {
  api_version: string;
  event_id: string;
  created_at: string;
  webhook_version?: string | null;
  trace_id?: string | null;
  partner_id?: string | null;
  event_type: string;
  data: unknown;
}

export interface LinqMessageReceivedEvent extends LinqWebhookEvent {
  event_type: "message.received";
  data: LinqMessageReceivedData;
}

export interface LinqMessageEditedEvent extends LinqWebhookEvent {
  event_type: "message.edited";
  webhook_version: "2026-02-03";
  data: LinqMessageEditedData;
}

export interface LinqTypingIndicatorStartedEvent extends LinqWebhookEvent {
  event_type: "chat.typing_indicator.started";
  data: {
    chat_id: string;
  };
}

export interface LinqParticipantAddedEvent extends LinqWebhookEvent {
  event_type: "participant.added";
  data: LinqParticipantAddedData;
}

export interface LinqParticipantRemovedEvent extends LinqWebhookEvent {
  event_type: "participant.removed";
  data: LinqParticipantRemovedData;
}

export type LinqParticipantChangedEvent =
  | LinqParticipantAddedEvent
  | LinqParticipantRemovedEvent;

export interface LinqParticipantAddedData {
  added_at?: string;
  chat_id?: string;
  participant: LinqChatHandle;
}

export interface LinqParticipantRemovedData {
  chat_id?: string;
  participant: LinqChatHandle;
  removed_at?: string;
}

export interface LinqMessageEditedData {
  chat: LinqChatInfo;
  direction: "inbound" | "outbound";
  edited_at: string;
  id: string;
  part: {
    index: number;
    text: string;
  };
  sender_handle: LinqChatHandle;
}

export interface LinqMessageReceivedData {
  chat_id: string;
  chat?: LinqChatInfo | null;
  direction?: "inbound" | "outbound" | string | null;
  from: string;
  from_handle?: LinqChatHandle | null;
  preferred_service?: "iMessage" | "SMS" | "RCS" | string | null;
  recipient_handle?: LinqChatHandle | null;
  recipient_phone?: string | null;
  received_at?: string | null;
  is_from_me: boolean;
  service?: "iMessage" | "SMS" | "RCS" | string | null;
  sent_at?: string | null;
  sender_handle?: LinqChatHandle | null;
  message: LinqIncomingMessage;
}

export interface LinqChatInfo {
  id: string;
  is_group?: boolean | null;
  owner_handle?: LinqChatHandle | null;
}

export interface LinqChatHandle {
  id?: string | null;
  handle: string;
  is_me?: boolean | null;
  joined_at?: string | null;
  left_at?: string | null;
  service?: "iMessage" | "SMS" | "RCS" | string | null;
  status?: "active" | "left" | "removed" | string | null;
}

export interface LinqIncomingMessage {
  id: string;
  parts: LinqMessagePart[];
  effect?: {
    type?: "screen" | "bubble" | string | null;
    name?: string | null;
  } | null;
  reply_to?: {
    message_id?: string | null;
    part_index?: number | null;
  } | null;
}

export interface LinqTextPart {
  type: "text";
  value: string;
}

export interface LinqLinkPart {
  type: "link";
  value: string;
}

export interface LinqMediaPart {
  type: "media" | "voice_memo";
  url?: string | null;
  attachment_id?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  size?: number | null;
}

export interface LinqIMessageAppPart {
  type: "imessage_app";
  fallback_text?: string | null;
}

export type LinqMessagePart =
  | LinqTextPart
  | LinqLinkPart
  | LinqMediaPart
  | LinqIMessageAppPart;

export type LinqMessageReceivedPartsValueKind =
  | "array"
  | "boolean"
  | "missing"
  | "null"
  | "number"
  | "object"
  | "string";

export interface LinqMessageReceivedPartsInspection {
  compatibilityFallback: boolean;
  dataKind: LinqMessageReceivedPartsValueKind;
  messageKind: LinqMessageReceivedPartsValueKind;
  partCount: number | null;
  partKinds: string | null;
  partsKind: LinqMessageReceivedPartsValueKind;
  partsLocation: "data.message.parts" | "data.parts" | "unresolved";
  payloadShape: "current-top-level" | "legacy-nested" | "unresolved";
  topLevelActionPresent: boolean;
  nestedActionPresent: boolean;
  unsupportedPartCount: number;
}

type LinqWebhookHeaders = Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>;

export interface VerifyAndParseLinqWebhookRequestInput {
  headers: LinqWebhookHeaders;
  now?: Date | number;
  rawBody: Buffer | Uint8Array | ArrayBuffer | string;
  timestampToleranceMs?: number | null;
  webhookSecret: string;
}

export interface LinqMessageReceivedSummary {
  chatId: string;
  isFromMe: boolean;
  messageId: string;
  phoneNumber: string;
  text: string | null;
}

const DEFAULT_LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const LINQ_WEBHOOK_SIGNATURE_HEX_PATTERN = /^[a-f0-9]{64}$/iu;
const LINQ_WEBHOOK_TIMESTAMP_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d\d(?::?\d\d)?)$/u;
const LINQ_MESSAGE_EDITED_MAX_TEXT_CHARS = 10_000;

export class LinqWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinqWebhookVerificationError";
  }
}

export class LinqWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinqWebhookPayloadError";
  }
}

export function isLinqWebhookVerificationError(error: unknown): error is LinqWebhookVerificationError {
  return error instanceof LinqWebhookVerificationError;
}

export function isLinqWebhookPayloadError(error: unknown): error is LinqWebhookPayloadError {
  return error instanceof LinqWebhookPayloadError;
}

export function verifyAndParseLinqWebhookRequest(
  input: VerifyAndParseLinqWebhookRequestInput,
): LinqWebhookEvent {
  const rawBody = normalizeLinqWebhookRawBody(input.rawBody);
  const webhookSecret = normalizeNullableString(input.webhookSecret);

  if (!webhookSecret) {
    throw new LinqWebhookVerificationError("Linq webhook secret is required.");
  }

  const timestamp = readSingleLinqWebhookHeader(input.headers, "x-webhook-timestamp");
  const signature = readSingleLinqWebhookHeader(input.headers, "x-webhook-signature");

  if (!timestamp || !signature) {
    throw new LinqWebhookVerificationError("Missing Linq webhook signature headers.");
  }

  if (!verifyLinqWebhookSignature(webhookSecret, rawBody, timestamp, signature)) {
    throw new LinqWebhookVerificationError("Invalid Linq webhook signature.");
  }

  assertLinqWebhookTimestampFresh(timestamp, {
    now: input.now,
    toleranceMs: resolveLinqWebhookTimestampToleranceMs(input.timestampToleranceMs),
  });

  return parseLinqWebhookEvent(rawBody);
}

export function parseLinqWebhookEvent(rawBody: Buffer | Uint8Array | ArrayBuffer | string): LinqWebhookEvent {
  const payloadText = normalizeLinqWebhookRawBody(rawBody);
  let payload: unknown;

  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    throw new LinqWebhookPayloadError(
      `Linq webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new LinqWebhookPayloadError("Linq webhook payload must be an object.");
  }

  const record = payload as Record<string, unknown>;
  const apiVersion = normalizeRequiredString(record.api_version, "Linq webhook api_version");
  const eventId = normalizeRequiredString(record.event_id, "Linq webhook event_id");
  const createdAt = normalizeRequiredString(record.created_at, "Linq webhook created_at");
  const eventType = normalizeRequiredString(record.event_type, "Linq webhook event_type");

  return {
    api_version: apiVersion,
    event_id: eventId,
    created_at: createdAt,
    event_type: eventType,
    webhook_version: normalizeNullableString(record.webhook_version) ?? undefined,
    trace_id: normalizeNullableString(record.trace_id),
    partner_id: normalizeNullableString(record.partner_id),
    data: record.data,
  };
}

export function inspectLinqMessageReceivedParts(
  event: LinqWebhookEvent,
): LinqMessageReceivedPartsInspection | null {
  if (event.event_type !== "message.received") {
    return null;
  }

  const dataKind = classifyLinqWebhookValueKind(event.data);
  if (dataKind !== "object") {
    return {
      compatibilityFallback: false,
      dataKind,
      messageKind: "missing",
      partCount: null,
      partKinds: null,
      partsKind: "missing",
      partsLocation: "unresolved",
      payloadShape: "unresolved",
      topLevelActionPresent: false,
      nestedActionPresent: false,
      unsupportedPartCount: 0,
    };
  }

  const data = event.data as Record<string, unknown>;
  const messageKind = classifyLinqWebhookValueKind(data.message);
  const nestedMessage = messageKind === "object"
    ? data.message as Record<string, unknown>
    : null;
  const payloadShape = isNormalizedLinqMessageReceivedData(event, data)
    ? "legacy-nested"
    : "current-top-level";
  const parts = payloadShape === "legacy-nested"
    ? nestedMessage?.parts
    : data.parts;
  const partsKind = classifyLinqWebhookValueKind(parts);
  const partInspection = inspectLinqMessagePartKinds(parts);

  return {
    compatibilityFallback: partsKind === "missing" || partsKind === "null",
    dataKind,
    messageKind,
    partCount: partInspection.partCount,
    partKinds: partInspection.partKinds,
    partsKind,
    partsLocation: payloadShape === "legacy-nested"
      ? "data.message.parts"
      : "data.parts",
    payloadShape,
    topLevelActionPresent: Object.hasOwn(data, "action"),
    nestedActionPresent: nestedMessage ? Object.hasOwn(nestedMessage, "action") : false,
    unsupportedPartCount: partInspection.unsupportedPartCount,
  };
}

export function verifyLinqWebhookSignature(
  secret: string,
  payload: Buffer | Uint8Array | ArrayBuffer | string,
  timestamp: string,
  signature: string,
): boolean {
  const normalizedPayload = normalizeLinqWebhookRawBody(payload);
  const normalizedSignature = normalizeLinqWebhookSignature(signature);

  if (!normalizedSignature) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${normalizedPayload}`)
    .digest("hex");
  const expectedDigest = Buffer.from(expected, "hex");
  const providedDigest = Buffer.from(normalizedSignature, "hex");

  if (expectedDigest.byteLength !== providedDigest.byteLength) {
    return false;
  }

  return timingSafeEqual(expectedDigest, providedDigest);
}

export function assertLinqWebhookTimestampFresh(
  timestamp: string,
  options: {
    now?: Date | number;
    toleranceMs?: number | null;
  } = {},
): void {
  if (options.toleranceMs == null) {
    return;
  }

  const toleranceMs = normalizeTimestampToleranceMs(options.toleranceMs);
  const timestampMs = parseLinqWebhookTimestamp(timestamp);
  const nowMs = normalizeNow(options.now);

  if (timestampMs == null) {
    throw new LinqWebhookVerificationError("Invalid Linq webhook timestamp.");
  }

  if (Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw new LinqWebhookVerificationError("Linq webhook timestamp is outside the allowed tolerance window.");
  }
}

export function readLinqWebhookHeader(
  headers: LinqWebhookHeaders,
  headerName: string,
): string | null {
  return readLinqWebhookHeaderValues(headers, headerName).values[0] ?? null;
}

export function parseRawLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== "message.received") {
    throw new TypeError("Linq webhook event does not contain a supported message.received payload.");
  }

  const data = toLinqObjectRecord(event.data, "Linq message.received data");
  const chat = parseRequiredChatInfo(data.chat);
  const senderHandle = parseRequiredChatHandle(data.sender_handle, "Linq message.received sender_handle");
  const ownerHandle = chat.owner_handle ?? undefined;
  const recipientHandle = parseOptionalChatHandle(data.recipient_handle) ?? ownerHandle;
  const parts = parseLinqMessageParts(data.parts);

  const createdAt = normalizeRequiredTimestamp(event.created_at, "Linq webhook created_at");
  const chatId = chat.id;
  const senderAddress = senderHandle.handle;
  const recipientPhone =
    normalizeNullableString(data.recipient_phone)
    ?? normalizeNullableString(recipientHandle?.handle);
  const direction = normalizeRequiredDirection(data.direction, "Linq message.received direction");
  const isFromMe = direction === "outbound";
  const service =
    normalizeNullableString(data.service)
    ?? normalizeNullableString(senderHandle.service)
    ?? normalizeNullableString(ownerHandle?.service)
    ?? normalizeRequiredString(data.service, "Linq message.received service");
  const preferredService = normalizeNullableString(data.preferred_service) ?? undefined;
  const sentAt =
    normalizeOptionalTimestamp(data.sent_at, "Linq message.received sent_at")
    ?? undefined;
  const receivedAt =
    normalizeOptionalTimestamp(data.received_at, "Linq message.received received_at")
    ?? sentAt
    ?? createdAt;

  return {
    ...event,
    event_type: "message.received",
    created_at: createdAt,
    webhook_version: normalizeNullableString(event.webhook_version ?? null) ?? undefined,
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      chat_id: chatId,
      chat,
      direction,
      from: senderAddress,
      from_handle: senderHandle,
      preferred_service: preferredService,
      recipient_handle: recipientHandle,
      recipient_phone: recipientPhone,
      received_at: receivedAt,
      is_from_me: isFromMe,
      sent_at: sentAt,
      sender_handle: senderHandle,
      service,
      message: {
        id: normalizeRequiredString(data.id, "Linq message.received message.id"),
        parts: parts.map((part, index) => parseLinqMessagePart(part, index)),
        effect: parseOptionalMessageEffect(data.effect),
        reply_to: parseOptionalReplyTo(data.reply_to),
      },
    },
  };
}

export function parseLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== "message.received") {
    throw new TypeError("Linq webhook event does not contain a supported message.received payload.");
  }

  const data = toLinqObjectRecord(event.data, "Linq message.received data");
  if (!isNormalizedLinqMessageReceivedData(event, data)) {
    return parseRawLinqMessageReceivedEvent(event);
  }

  return parseNormalizedLinqMessageReceivedEventData(event, data);
}

export function parseLinqMessageEditedEvent(
  event: LinqWebhookEvent,
): LinqMessageEditedEvent {
  if (event.event_type !== "message.edited") {
    throw new TypeError("Linq webhook event does not contain a supported message.edited payload.");
  }
  if (event.webhook_version !== "2026-02-03") {
    throw new TypeError('Linq message.edited webhook_version must be "2026-02-03".');
  }

  const data = toLinqObjectRecord(event.data, "Linq message.edited data");
  const chatRecord = toLinqObjectRecord(data.chat, "Linq message.edited chat");
  const part = toLinqObjectRecord(data.part, "Linq message.edited part");
  const partIndex = normalizeNullableInteger(part.index);
  if (partIndex === null || partIndex < 0 || partIndex > 2_147_483_647) {
    throw new TypeError("Linq message.edited part.index must be a non-negative int32.");
  }
  if (
    typeof part.text !== "string"
    || part.text.length === 0
    || part.text.length > LINQ_MESSAGE_EDITED_MAX_TEXT_CHARS
  ) {
    throw new TypeError(
      `Linq message.edited part.text must contain 1-${LINQ_MESSAGE_EDITED_MAX_TEXT_CHARS} characters.`,
    );
  }

  const editedAt = normalizeRequiredTimezoneTimestamp(
    data.edited_at,
    "Linq message.edited edited_at",
  );

  return {
    ...event,
    created_at: normalizeRequiredTimezoneTimestamp(
      event.created_at,
      "Linq webhook created_at",
    ),
    event_type: "message.edited",
    webhook_version: "2026-02-03",
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      chat: {
        id: normalizeRequiredString(chatRecord.id, "Linq message.edited chat.id"),
        is_group: normalizeLinqIsGroupFlag(chatRecord.is_group),
        owner_handle: parseOptionalChatHandle(chatRecord.owner_handle) ?? undefined,
      },
      direction: normalizeRequiredDirection(
        data.direction,
        "Linq message.edited direction",
      ),
      edited_at: editedAt,
      id: normalizeRequiredString(data.id, "Linq message.edited id"),
      part: {
        index: partIndex,
        text: part.text,
      },
      sender_handle: parseRequiredChatHandle(
        data.sender_handle,
        "Linq message.edited sender_handle",
      ),
    },
  };
}

export function parseLinqTypingIndicatorStartedEvent(
  event: LinqWebhookEvent,
): LinqTypingIndicatorStartedEvent {
  if (event.event_type !== "chat.typing_indicator.started") {
    throw new TypeError(
      "Linq webhook event does not contain a supported chat.typing_indicator.started payload.",
    );
  }

  const data = toLinqObjectRecord(
    event.data,
    "Linq chat.typing_indicator.started data",
  );
  const chatId = typeof data.chat_id === "string"
    ? data.chat_id.trim()
    : "";
  if (!chatId) {
    throw new TypeError(
      "Linq chat.typing_indicator.started chat_id is required.",
    );
  }

  return {
    ...event,
    created_at: normalizeRequiredTimestamp(
      event.created_at,
      "Linq webhook created_at",
    ),
    event_type: "chat.typing_indicator.started",
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      chat_id: chatId,
    },
  };
}

export function parseLinqParticipantChangedEvent(
  event: LinqWebhookEvent,
): LinqParticipantChangedEvent {
  if (
    event.event_type !== "participant.added"
    && event.event_type !== "participant.removed"
  ) {
    throw new TypeError(
      "Linq webhook event does not contain a supported participant change payload.",
    );
  }

  const data = toLinqObjectRecord(event.data, `Linq ${event.event_type} data`);
  const participant = parseOptionalChatHandle(data.participant)
    ?? parseDeprecatedLinqParticipantHandle(data.handle, data.service);
  if (!participant) {
    throw new TypeError(
      `Linq ${event.event_type} participant or deprecated handle is required.`,
    );
  }
  const chatId = normalizeNullableString(data.chat_id) ?? undefined;
  const changedAtField = event.event_type === "participant.added"
    ? "added_at"
    : "removed_at";
  const changedAt = normalizeOptionalTimestamp(
    data[changedAtField],
    `Linq ${event.event_type} ${changedAtField}`,
  ) ?? undefined;

  if (event.event_type === "participant.added") {
    return {
      ...event,
      created_at: normalizeRequiredTimestamp(
        event.created_at,
        "Linq webhook created_at",
      ),
      event_type: "participant.added",
      trace_id: normalizeNullableString(event.trace_id ?? null),
      partner_id: normalizeNullableString(event.partner_id ?? null),
      data: {
        ...(changedAt ? { added_at: changedAt } : {}),
        ...(chatId ? { chat_id: chatId } : {}),
        participant,
      },
    };
  }

  return {
    ...event,
    created_at: normalizeRequiredTimestamp(
      event.created_at,
      "Linq webhook created_at",
    ),
    event_type: "participant.removed",
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      ...(chatId ? { chat_id: chatId } : {}),
      participant,
      ...(changedAt ? { removed_at: changedAt } : {}),
    },
  };
}

export function buildLinqMessageText(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
): string | null {
  const values = (parts ?? [])
    .filter((part): part is LinqTextPart | LinqIMessageAppPart =>
      part.type === "text" || part.type === "imessage_app"
    )
    .map((part) => part.type === "text"
      ? normalizeTextValue(part.value)
      : normalizeTextValue(part.fallback_text) ?? "[iMessage app]")
    .filter((value): value is string => value !== null);

  return values.length > 0 ? values.join("\n") : null;
}

export function summarizeLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): LinqMessageReceivedSummary {
  return {
    chatId: event.data.chat_id,
    isFromMe: event.data.is_from_me,
    messageId: event.data.message.id,
    phoneNumber: event.data.from,
    text: buildLinqMessageText(event.data.message.parts),
  };
}

export function readLinqRecipientLineHandle(
  data: LinqMessageReceivedData | null | undefined,
): string | null {
  if (!data) {
    return null;
  }

  return normalizeNullableString(data.recipient_phone)
    ?? normalizeNullableString(data.recipient_handle?.handle)
    ?? normalizeNullableString(data.chat?.owner_handle?.handle);
}

export function resolveLinqWebhookOccurredAt(event: LinqMessageReceivedEvent): string {
  const occurredAt = normalizeTextValue(event.data.received_at ?? event.created_at);

  if (!occurredAt) {
    throw new TypeError("Linq webhook occurredAt is required.");
  }

  return occurredAt;
}

export function minimizeLinqWebhookEvent(event: LinqWebhookEvent): Record<string, unknown> {
  return sanitizeRawMetadata(pickMinimizedLinqWebhookEvent(event)) as Record<string, unknown>;
}

export function minimizeLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): Record<string, unknown> {
  return minimizeLinqWebhookEvent(event);
}

function pickMinimizedLinqWebhookEvent(event: LinqWebhookEvent): Record<string, unknown> {
  const messageEvent =
    event.event_type === "message.received"
      ? parseLinqMessageReceivedEvent(event)
      : null;
  const editedEvent =
    event.event_type === "message.edited"
      ? parseLinqMessageEditedEvent(event)
      : null;

  return compactRecord({
    api_version: event.api_version,
    event_id: event.event_id,
    event_type: event.event_type,
    created_at: event.created_at,
    webhook_version: event.webhook_version,
    trace_id: event.trace_id,
    partner_id: event.partner_id,
    data: messageEvent
      ? pickLinqMessageReceivedData(messageEvent.data)
      : editedEvent
        ? pickLinqMessageEditedData(editedEvent.data)
        : undefined,
  });
}

function normalizeLinqWebhookRawBody(value: Buffer | Uint8Array | ArrayBuffer | string): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }

  return Buffer.from(value).toString("utf8");
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseDeprecatedLinqParticipantHandle(
  handle: unknown,
  service: unknown,
): LinqChatHandle | null {
  const normalizedHandle = normalizeNullableString(handle);
  if (!normalizedHandle) {
    return null;
  }
  const normalizedService = normalizeNullableString(service);
  return {
    handle: normalizedHandle,
    ...(normalizedService ? { service: normalizedService } : {}),
  };
}

function normalizeLinqIsGroupFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  // Provider type drift defense: a stringly-typed flag must not silently demote a group
  // chat to "unknown" (and thereby look more direct than it is).
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new LinqWebhookPayloadError(`${label} is required.`);
  }

  return normalized;
}

function parseLinqWebhookTimestamp(value: string): number | null {
  const normalized = normalizeNullableString(value);

  if (!normalized || !/^-?\d+$/u.test(normalized)) {
    return null;
  }

  const timestampSeconds = Number.parseInt(normalized, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return null;
  }

  return timestampSeconds * 1000;
}

function normalizeNow(value: Date | number | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return Date.now();
}

function normalizeTimestampToleranceMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Linq webhook timestamp tolerance must be a non-negative finite number.");
  }

  return value;
}

function normalizeLinqWebhookSignature(signature: string): string | null {
  const normalized = signature.trim().replace(/^sha256=/iu, "").trim().toLowerCase();
  return LINQ_WEBHOOK_SIGNATURE_HEX_PATTERN.test(normalized) ? normalized : null;
}

function resolveLinqWebhookTimestampToleranceMs(value: number | null | undefined): number | null {
  if (value === null) {
    return null;
  }

  return value ?? DEFAULT_LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS;
}

function readSingleLinqWebhookHeader(
  headers: LinqWebhookHeaders,
  headerName: string,
): string | null {
  const { rawValueCount, values } = readLinqWebhookHeaderValues(headers, headerName);

  if (rawValueCount === 0) {
    return null;
  }

  if (rawValueCount > 1 || values[0]?.includes(",")) {
    throw new LinqWebhookVerificationError(`Duplicate Linq webhook ${headerName} header.`);
  }

  return values[0] ?? null;
}

function readLinqWebhookHeaderValues(
  headers: LinqWebhookHeaders,
  headerName: string,
): {
  rawValueCount: number;
  values: string[];
} {
  const expectedHeader = headerName.toLowerCase();
  let rawValueCount = 0;
  const values: string[] = [];

  if (headers instanceof Headers) {
    headers.forEach((value, candidateName) => {
      if (candidateName.toLowerCase() !== expectedHeader) {
        return;
      }

      rawValueCount += 1;
      const normalized = normalizeNullableString(value);
      if (normalized) {
        values.push(normalized);
      }
    });

    return {
      rawValueCount,
      values,
    };
  }

  for (const [candidateName, value] of Object.entries(headers)) {
    if (candidateName.toLowerCase() !== expectedHeader) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        rawValueCount += 1;
        const normalized = normalizeNullableString(entry);
        if (normalized) {
          values.push(normalized);
        }
      }
      continue;
    }

    rawValueCount += 1;
    const normalized = normalizeNullableString(value);
    if (normalized) {
      values.push(normalized);
    }
  }

  return {
    rawValueCount,
    values,
  };
}

function toLinqObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function normalizeRequiredTimestamp(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return toIsoTimestamp(normalized);
}

function normalizeOptionalTimestamp(value: unknown, label: string): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? toIsoTimestamp(normalized) : null;
}

function normalizeRequiredTimezoneTimestamp(value: unknown, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  if (!LINQ_WEBHOOK_TIMESTAMP_TIMEZONE_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must include a timezone.`);
  }
  return toIsoTimestamp(normalized);
}

function normalizeRequiredDirection(
  value: unknown,
  label: string,
): "inbound" | "outbound" {
  const normalized = normalizeRequiredString(value, label);

  if (normalized !== "inbound" && normalized !== "outbound") {
    throw new TypeError(`${label} must be "inbound" or "outbound".`);
  }

  return normalized;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseLinqMessagePart(part: unknown, index: number): LinqMessagePart {
  const record = toLinqObjectRecord(part, `Linq message.received message.parts[${index}]`);
  const type = normalizeRequiredString(record.type, `Linq message.received message.parts[${index}] type`);

  if (type === "text" || type === "link") {
    return {
      type,
      value: normalizeRequiredString(
        record.value,
        `Linq message.received message.parts[${index}] value`,
      ),
    };
  }

  if (type === "media" || type === "voice_memo") {
    return {
      type,
      url: normalizeNullableString(record.url),
      attachment_id:
        normalizeNullableString(record.id)
        ?? normalizeNullableString(record.attachment_id)
        ?? normalizeNullableString(record.attachmentId),
      filename:
        normalizeNullableString(record.filename)
        ?? normalizeNullableString(record.fileName),
      mime_type:
        normalizeNullableString(record.mime_type)
        ?? normalizeNullableString(record.mimeType),
      size:
        normalizeNullableNumber(record.size_bytes)
        ?? normalizeNullableNumber(record.sizeBytes)
        ?? normalizeNullableNumber(record.size),
    };
  }

  if (type === "imessage_app") {
    return {
      type,
      fallback_text: normalizeNullableString(record.fallback_text),
    };
  }

  throw new TypeError(
    `Linq message.received message.parts[${index}] type must be "text", "media", "link", "voice_memo", or "imessage_app".`,
  );
}

function parseLinqMessageParts(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Linq message.received message.parts must be an array, null, or absent.");
  }
  return value;
}

function parseOptionalMessageEffect(value: unknown): LinqIncomingMessage["effect"] {
  if (value == null) {
    return null;
  }

  const record = toLinqObjectRecord(value, "Linq message.received message.effect");
  return {
    name: normalizeNullableString(record.name),
    type: normalizeNullableString(record.type),
  };
}

function parseOptionalReplyTo(value: unknown): LinqIncomingMessage["reply_to"] {
  if (value == null) {
    return null;
  }

  const record = toLinqObjectRecord(value, "Linq message.received message.reply_to");
  return {
    message_id: normalizeNullableString(record.message_id),
    part_index: normalizeNullableInteger(record.part_index),
  };
}

function normalizeNullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseOptionalChatInfo(value: unknown): LinqChatInfo | null {
  if (value == null) {
    return null;
  }

  const record = toLinqObjectRecord(value, "Linq message.received chat");
  return {
    id: normalizeRequiredString(record.id, "Linq message.received chat.id"),
    is_group: normalizeLinqIsGroupFlag(record.is_group),
    owner_handle: parseOptionalChatHandle(record.owner_handle) ?? undefined,
  };
}

function parseNormalizedLinqMessageReceivedEventData(
  event: LinqWebhookEvent,
  data: Record<string, unknown>,
): LinqMessageReceivedEvent {
  const chat = parseRequiredChatInfo(data.chat);
  const message = toLinqObjectRecord(data.message, "Linq message.received message");
  const parts = parseLinqMessageParts(message.parts);

  const createdAt = normalizeRequiredTimestamp(event.created_at, "Linq webhook created_at");
  const senderHandle = parseRequiredChatHandle(
    data.sender_handle ?? data.from_handle,
    "Linq message.received sender_handle",
  );
  const fromHandle = parseOptionalChatHandle(data.from_handle) ?? senderHandle;
  const recipientHandle = parseOptionalChatHandle(data.recipient_handle) ?? chat.owner_handle ?? undefined;
  const isFromMe = parseCanonicalLinqIsFromMe(data);
  const direction = parseCanonicalLinqDirection(data, isFromMe);
  const sentAt =
    normalizeOptionalTimestamp(data.sent_at, "Linq message.received sent_at")
    ?? undefined;
  const receivedAt =
    normalizeOptionalTimestamp(data.received_at, "Linq message.received received_at")
    ?? sentAt
    ?? createdAt;
  const service =
    normalizeNullableString(data.service)
    ?? normalizeNullableString(senderHandle.service)
    ?? normalizeNullableString(fromHandle.service)
    ?? normalizeNullableString(recipientHandle?.service)
    ?? normalizeRequiredString(data.service, "Linq message.received service");

  return {
    ...event,
    event_type: "message.received",
    created_at: createdAt,
    webhook_version: normalizeNullableString(event.webhook_version ?? null) ?? undefined,
    trace_id: normalizeNullableString(event.trace_id ?? null),
    partner_id: normalizeNullableString(event.partner_id ?? null),
    data: {
      chat_id: normalizeRequiredString(data.chat_id, "Linq message.received chat_id"),
      chat,
      direction,
      from: normalizeRequiredString(data.from, "Linq message.received from"),
      from_handle: fromHandle,
      preferred_service: normalizeNullableString(data.preferred_service) ?? undefined,
      recipient_handle: recipientHandle,
      recipient_phone: normalizeNullableString(data.recipient_phone),
      received_at: receivedAt,
      is_from_me: isFromMe,
      sent_at: sentAt,
      sender_handle: senderHandle,
      service,
      message: {
        id: normalizeRequiredString(message.id, "Linq message.received message.id"),
        parts: parts.map((part, index) => parseLinqMessagePart(part, index)),
        effect: parseOptionalMessageEffect(message.effect),
        reply_to: parseOptionalReplyTo(message.reply_to),
      },
    },
  };
}

function isNormalizedLinqMessageReceivedData(
  event: LinqWebhookEvent,
  value: unknown,
): value is LinqMessageReceivedData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }

  return event.webhook_version === "2025-01-01"
    || Object.hasOwn(record, "chat_id")
    || Object.hasOwn(record, "is_from_me")
    || Object.hasOwn(message, "parts");
}

function parseCanonicalLinqIsFromMe(data: Record<string, unknown>): boolean {
  if (typeof data.is_from_me !== "boolean") {
    const direction = normalizeNullableString(data.direction);
    if (direction === "inbound") {
      return false;
    }
    if (direction === "outbound") {
      return true;
    }
    throw new TypeError('Linq message.received is_from_me must be a boolean.');
  }

  return data.is_from_me;
}

function parseCanonicalLinqDirection(
  data: Record<string, unknown>,
  isFromMe: boolean,
): "inbound" | "outbound" {
  const direction = normalizeNullableString(data.direction);
  if (!direction) {
    return isFromMe ? "outbound" : "inbound";
  }

  const normalizedDirection = normalizeRequiredDirection(
    direction,
    "Linq message.received direction",
  );
  if ((normalizedDirection === "outbound") !== isFromMe) {
    throw new TypeError("Linq message.received is_from_me must match direction.");
  }

  return normalizedDirection;
}

function parseRequiredChatInfo(value: unknown): LinqChatInfo {
  const chat = parseOptionalChatInfo(value);

  if (!chat) {
    throw new TypeError("Linq message.received chat is required.");
  }

  return chat;
}

function parseOptionalChatHandle(value: unknown): LinqChatHandle | null {
  if (value == null) {
    return null;
  }

  const record = toLinqObjectRecord(value, "Linq chat handle");
  return {
    id: normalizeNullableString(record.id) ?? undefined,
    handle: normalizeRequiredString(record.handle, "Linq chat handle.handle"),
    is_me: typeof record.is_me === "boolean" ? record.is_me : undefined,
    joined_at: normalizeOptionalTimestamp(record.joined_at, "Linq chat handle.joined_at") ?? undefined,
    left_at: normalizeOptionalTimestamp(record.left_at, "Linq chat handle.left_at") ?? undefined,
    service: normalizeNullableString(record.service) ?? undefined,
    status: normalizeNullableString(record.status) ?? undefined,
  };
}

function parseRequiredChatHandle(value: unknown, label: string): LinqChatHandle {
  const handle = parseOptionalChatHandle(value);

  if (!handle) {
    throw new TypeError(`${label} is required.`);
  }

  return handle;
}

function pickLinqMessageReceivedData(data: LinqMessageReceivedData): Record<string, unknown> {
  return compactRecord({
    chat: pickLinqChatInfo(data.chat),
    chat_id: data.chat_id,
    direction: data.direction,
    from: data.from,
    from_handle: pickLinqChatHandle(data.from_handle),
    preferred_service: data.preferred_service,
    recipient_handle: pickLinqChatHandle(data.recipient_handle),
    recipient_phone: data.recipient_phone,
    received_at: data.received_at,
    is_from_me: data.is_from_me,
    service: data.service,
    sent_at: data.sent_at,
    sender_handle: pickLinqChatHandle(data.sender_handle),
    message: compactRecord({
      effect: pickLinqMessageEffect(data.message.effect),
      id: data.message.id,
      parts: data.message.parts.map((part) => pickLinqMessagePart(part)),
      reply_to: pickLinqReplyTo(data.message.reply_to),
    }),
  });
}

function pickLinqMessageEditedData(data: LinqMessageEditedData): Record<string, unknown> {
  return compactRecord({
    chat: pickLinqChatInfo(data.chat),
    direction: data.direction,
    edited_at: data.edited_at,
    id: data.id,
    part: compactRecord({
      index: data.part.index,
    }),
    sender_handle: pickLinqChatHandle(data.sender_handle),
  });
}

function pickLinqMessagePart(part: LinqMessagePart): Record<string, unknown> {
  if (part.type === "text") {
    return compactRecord({
      type: part.type,
      value: part.value,
    });
  }

  if (part.type === "link") {
    return compactRecord({
      type: part.type,
      value: part.value,
    });
  }

  if (part.type === "imessage_app") {
    return compactRecord({
      fallback_text: part.fallback_text,
      type: part.type,
    });
  }

  return compactRecord({
    type: part.type,
    url: part.url,
    attachment_id: part.attachment_id,
    filename: part.filename,
    mime_type: part.mime_type,
    size: part.size,
  });
}

function classifyLinqWebhookValueKind(value: unknown): LinqMessageReceivedPartsValueKind {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return "string";
  }
  return "object";
}

function inspectLinqMessagePartKinds(value: unknown): {
  partCount: number | null;
  partKinds: string | null;
  unsupportedPartCount: number;
} {
  if (!Array.isArray(value)) {
    return {
      partCount: null,
      partKinds: null,
      unsupportedPartCount: 0,
    };
  }

  const kinds = new Set<string>();
  let unsupportedPartCount = 0;
  for (const part of value) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      kinds.add("invalid-entry");
      unsupportedPartCount += 1;
      continue;
    }

    const type = (part as Record<string, unknown>).type;
    if (
      type === "text"
      || type === "link"
      || type === "media"
      || type === "voice_memo"
      || type === "imessage_app"
    ) {
      kinds.add(type);
      continue;
    }

    kinds.add(typeof type === "string" ? "unsupported" : "missing-type");
    unsupportedPartCount += 1;
  }

  return {
    partCount: value.length,
    partKinds: kinds.size > 0 ? [...kinds].sort().join(",") : null,
    unsupportedPartCount,
  };
}

function pickLinqChatInfo(value: LinqChatInfo | null | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    id: value.id,
    is_group: value.is_group,
    owner_handle: pickLinqChatHandle(value.owner_handle),
  });
}

function pickLinqChatHandle(value: LinqChatHandle | null | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    handle: value.handle,
    id: value.id,
    is_me: value.is_me,
    joined_at: value.joined_at,
    left_at: value.left_at,
    service: value.service,
    status: value.status,
  });
}

function pickLinqMessageEffect(value: LinqIncomingMessage["effect"]): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    name: value.name,
    type: value.type,
  });
}

function pickLinqReplyTo(value: LinqIncomingMessage["reply_to"]): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    message_id: value.message_id,
    part_index: value.part_index,
  });
}
