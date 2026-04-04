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

export type LinqMessagePart = LinqTextPart | LinqLinkPart | LinqMediaPart;

export interface LinqSendMessageResponse {
  chat_id?: string | null;
  message?: {
    id?: string | null;
  } | null;
}

export interface LinqCreateChatResponse {
  chat?: {
    id?: string | null;
    message?: {
      id?: string | null;
    } | null;
  } | null;
}

export interface LinqCreateWebhookSubscriptionResponse {
  id?: string | null;
  target_url?: string | null;
  signing_secret?: string | null;
  subscribed_events?: string[] | null;
  phone_numbers?: string[] | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LinqListPhoneNumbersResponse {
  phone_numbers?: Array<{
    phone_number?: string | null;
  }> | null;
}

export interface VerifyAndParseLinqWebhookRequestInput {
  headers: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>;
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

  const timestamp = readLinqWebhookHeader(input.headers, "x-webhook-timestamp");
  const signature = readLinqWebhookHeader(input.headers, "x-webhook-signature");

  if (!timestamp || !signature) {
    throw new LinqWebhookVerificationError("Missing Linq webhook signature headers.");
  }

  if (!verifyLinqWebhookSignature(webhookSecret, rawBody, timestamp, signature)) {
    throw new LinqWebhookVerificationError("Invalid Linq webhook signature.");
  }

  assertLinqWebhookTimestampFresh(timestamp, {
    now: input.now,
    toleranceMs: input.timestampToleranceMs,
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

export function verifyLinqWebhookSignature(
  secret: string,
  payload: Buffer | Uint8Array | ArrayBuffer | string,
  timestamp: string,
  signature: string,
): boolean {
  const normalizedPayload = normalizeLinqWebhookRawBody(payload);
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${normalizedPayload}`)
    .digest("hex");
  const normalizedSignature = signature.replace(/^sha256=/iu, "").trim().toLowerCase();

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalizedSignature, "hex"));
  } catch {
    return false;
  }
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
  headers: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  headerName: string,
): string | null {
  if (headers instanceof Headers) {
    return normalizeNullableString(headers.get(headerName));
  }

  const expectedHeader = headerName.toLowerCase();
  for (const [candidateName, value] of Object.entries(headers)) {
    if (candidateName.toLowerCase() !== expectedHeader) {
      continue;
    }

    if (Array.isArray(value)) {
      return normalizeNullableString(value[0]);
    }

    return normalizeNullableString(value);
  }

  return null;
}

export function requireLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== "message.received") {
    throw new TypeError("Linq webhook event does not contain a supported message.received payload.");
  }

  const data = toLinqObjectRecord(event.data, "Linq message.received data");
  const chat = parseRequiredChatInfo(data.chat);
  const senderHandle = parseRequiredChatHandle(data.sender_handle, "Linq message.received sender_handle");
  const recipientHandle = chat.owner_handle ?? undefined;
  const parts = data.parts;

  if (!Array.isArray(parts)) {
    throw new TypeError("Linq message.received message.parts must be an array.");
  }

  const createdAt = normalizeRequiredTimestamp(event.created_at, "Linq webhook created_at");
  const chatId = chat.id;
  const senderAddress = senderHandle.handle;
  const recipientPhone = normalizeNullableString(recipientHandle?.handle);
  const direction = normalizeRequiredDirection(data.direction, "Linq message.received direction");
  const isFromMe = direction === "outbound";
  const service =
    normalizeNullableString(data.service)
    ?? normalizeNullableString(senderHandle.service)
    ?? normalizeNullableString(recipientHandle?.service)
    ?? normalizeRequiredString(data.service, "Linq message.received service");
  const preferredService = normalizeNullableString(data.preferred_service) ?? undefined;
  const occurredAt =
    normalizeOptionalTimestamp(data.sent_at, "Linq message.received sent_at")
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
      received_at: occurredAt,
      is_from_me: isFromMe,
      sent_at: normalizeOptionalTimestamp(data.sent_at, "Linq message.received sent_at") ?? undefined,
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

export function parseCanonicalLinqMessageReceivedEvent(
  event: LinqWebhookEvent,
): LinqMessageReceivedEvent {
  if (event.event_type !== "message.received") {
    throw new TypeError("Linq webhook event does not contain a supported message.received payload.");
  }

  const data = toLinqObjectRecord(event.data, "Linq message.received data");
  if (!isCanonicalLinqMessageReceivedData(data)) {
    return requireLinqMessageReceivedEvent(event);
  }

  return parseCanonicalLinqMessageReceivedEventFromCanonicalData(event, data);
}

export function buildLinqMessageText(
  parts: ReadonlyArray<LinqMessagePart> | null | undefined,
): string | null {
  const values = (parts ?? [])
    .filter((part): part is Extract<LinqMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => normalizeTextValue(part.value))
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

export function resolveLinqWebhookOccurredAt(event: LinqMessageReceivedEvent): string {
  const occurredAt = normalizeTextValue(event.data.received_at ?? event.created_at);

  if (!occurredAt) {
    throw new TypeError("Linq webhook occurredAt is required.");
  }

  return occurredAt;
}

export function minimizeLinqWebhookEvent(event: LinqWebhookEvent): Record<string, unknown> {
  const messageEvent =
    event.event_type === "message.received"
      ? isCanonicalLinqMessageReceivedData(event.data)
        ? (event as LinqMessageReceivedEvent)
        : parseCanonicalLinqMessageReceivedEvent(event)
      : null;

  return sanitizeRawMetadata(
    compactRecord({
      api_version: event.api_version,
      event_id: event.event_id,
      event_type: event.event_type,
      created_at: event.created_at,
      webhook_version: event.webhook_version,
      trace_id: event.trace_id,
      partner_id: event.partner_id,
      data: messageEvent ? pickLinqMessageReceivedData(messageEvent.data) : event.data,
    }),
  ) as Record<string, unknown>;
}

export function minimizeLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): Record<string, unknown> {
  return compactRecord({
    api_version: event.api_version,
    created_at: event.created_at,
    webhook_version: event.webhook_version,
    data: compactRecord({
      chat: pickLinqChatInfo(event.data.chat),
      chat_id: event.data.chat_id,
      direction: event.data.direction,
      from: event.data.from,
      from_handle: pickLinqChatHandle(event.data.from_handle),
      is_from_me: event.data.is_from_me,
      message: compactRecord({
        effect: pickLinqMessageEffect(event.data.message.effect),
        id: event.data.message.id,
        parts: event.data.message.parts.map((part) => pickHostedLinqMessagePart(part)),
        reply_to: pickLinqReplyTo(event.data.message.reply_to),
      }),
      preferred_service: event.data.preferred_service,
      received_at: event.data.received_at,
      recipient_handle: pickLinqChatHandle(event.data.recipient_handle),
      recipient_phone: event.data.recipient_phone,
      service: event.data.service,
      sent_at: event.data.sent_at,
      sender_handle: pickLinqChatHandle(event.data.sender_handle),
    }),
    event_id: event.event_id,
    event_type: event.event_type,
    partner_id: event.partner_id,
    trace_id: event.trace_id,
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

function normalizeRequiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
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

  if (type === "text") {
    return {
      type,
      value: normalizeRequiredString(
        record.value,
        `Linq message.received message.parts[${index}] value`,
      ),
    };
  }

  if (type === "link") {
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
        ?? normalizeNullableString(record.attachment_id),
      filename: normalizeNullableString(record.filename),
      mime_type: normalizeNullableString(record.mime_type),
      size:
        normalizeNullableNumber(record.size_bytes)
        ?? normalizeNullableNumber(record.size),
    };
  }

  throw new TypeError(
    `Linq message.received message.parts[${index}] type must be "text", "media", "link", or "voice_memo".`,
  );
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
    is_group: typeof record.is_group === "boolean" ? record.is_group : undefined,
    owner_handle: parseOptionalChatHandle(record.owner_handle) ?? undefined,
  };
}

function parseCanonicalLinqMessageReceivedEventFromCanonicalData(
  event: LinqWebhookEvent,
  data: Record<string, unknown>,
): LinqMessageReceivedEvent {
  const chat = parseRequiredChatInfo(data.chat);
  const message = toLinqObjectRecord(data.message, "Linq message.received message");
  const parts = message.parts;
  if (!Array.isArray(parts)) {
    throw new TypeError("Linq message.received message.parts must be an array.");
  }

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
      recipient_phone: normalizeNullableString(data.recipient_phone) ?? normalizeNullableString(recipientHandle?.handle),
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

function isCanonicalLinqMessageReceivedData(value: unknown): value is LinqMessageReceivedData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Boolean(
    record.message
      && typeof record.message === "object"
      && !Array.isArray(record.message)
      && "parts" in (record.message as Record<string, unknown>),
  );
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
      id: data.message.id,
      parts: data.message.parts.map((part) => pickLinqMessagePart(part)),
      effect: data.message.effect ?? undefined,
      reply_to: data.message.reply_to ?? undefined,
    }),
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

  return compactRecord({
    type: part.type,
    url: part.url,
    attachment_id: part.attachment_id,
    filename: part.filename,
    mime_type: part.mime_type,
    size: part.size,
  });
}

function pickHostedLinqMessagePart(part: LinqMessagePart): Record<string, unknown> {
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

  return compactRecord({
    attachment_id: part.attachment_id,
    filename: part.filename,
    mime_type: part.mime_type,
    size: part.size,
    type: part.type,
    url: part.url,
  });
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
