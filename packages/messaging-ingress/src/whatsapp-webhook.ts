import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import {
  compactRecord,
  normalizeTextValue,
  sanitizeRawMetadata,
} from "./internal.ts";

type WhatsAppWebhookHeaders = Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>;

export interface VerifyAndParseWhatsAppWebhookRequestInput {
  appSecret: string;
  headers: WhatsAppWebhookHeaders;
  rawBody: Buffer | Uint8Array | ArrayBuffer | string;
}

export interface WhatsAppWebhookBody {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

export interface WhatsAppWebhookEntry {
  id?: string;
  changes?: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookChange {
  field?: string;
  value?: WhatsAppWebhookChangeValue;
}

export interface WhatsAppWebhookChangeValue {
  contacts?: WhatsAppWebhookContact[];
  messaging_product?: "whatsapp" | string;
  messages?: WhatsAppWebhookMessage[];
  metadata?: {
    display_phone_number?: string | null;
    phone_number_id?: string | null;
  } | null;
  statuses?: unknown[];
}

export interface WhatsAppWebhookContact {
  profile?: {
    name?: string | null;
  } | null;
  wa_id?: string | null;
}

export interface WhatsAppWebhookMessage {
  from?: string | null;
  id?: string | null;
  timestamp?: string | null;
  type?: string | null;
  text?: {
    body?: string | null;
  } | null;
}

export interface WhatsAppInboundText {
  contactProfileName: string | null;
  externalMessageId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  provider: "whatsapp";
  receivedAt: Date;
  sparseRaw: unknown;
  text: string;
}

const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";
const WHATSAPP_SIGNATURE_PATTERN = /^sha256=[a-f0-9]{64}$/iu;

export class WhatsAppWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppWebhookVerificationError";
  }
}

export class WhatsAppWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppWebhookPayloadError";
  }
}

export function isWhatsAppWebhookVerificationError(
  error: unknown,
): error is WhatsAppWebhookVerificationError {
  return error instanceof WhatsAppWebhookVerificationError;
}

export function isWhatsAppWebhookPayloadError(
  error: unknown,
): error is WhatsAppWebhookPayloadError {
  return error instanceof WhatsAppWebhookPayloadError;
}

export function verifyAndParseWhatsAppWebhookRequest(
  input: VerifyAndParseWhatsAppWebhookRequestInput,
): WhatsAppWebhookBody {
  const rawBody = normalizeWhatsAppWebhookRawBody(input.rawBody);
  const appSecret = normalizeTextValue(input.appSecret);

  if (!appSecret) {
    throw new WhatsAppWebhookVerificationError("WhatsApp app secret is required.");
  }

  const signature = readSingleWhatsAppWebhookHeader(input.headers, WHATSAPP_SIGNATURE_HEADER);
  if (!verifyWhatsAppWebhookSignature({
    appSecret,
    rawBody,
    signature,
  })) {
    throw new WhatsAppWebhookVerificationError("Invalid WhatsApp webhook signature.");
  }

  return parseWhatsAppWebhookBody(rawBody);
}

export function verifyWhatsAppWebhookSignature(input: {
  appSecret: string;
  rawBody: Buffer | Uint8Array | ArrayBuffer | string;
  signature: string | null | undefined;
}): boolean {
  const appSecret = normalizeTextValue(input.appSecret);
  const signature = normalizeTextValue(input.signature);

  if (!appSecret || !signature || !WHATSAPP_SIGNATURE_PATTERN.test(signature)) {
    return false;
  }

  const normalizedSignature = signature.toLowerCase();
  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(normalizeWhatsAppWebhookRawBody(input.rawBody))
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(normalizedSignature);

  return (
    expectedBuffer.byteLength === actualBuffer.byteLength
    && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function parseWhatsAppWebhookBody(
  rawBody: Buffer | Uint8Array | ArrayBuffer | string,
): WhatsAppWebhookBody {
  const payloadText = normalizeWhatsAppWebhookRawBody(rawBody);
  let payload: unknown;

  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    throw new WhatsAppWebhookPayloadError(
      `WhatsApp webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WhatsAppWebhookPayloadError("WhatsApp webhook payload must be an object.");
  }

  assertWhatsAppWebhookBodyShape(payload);
  return payload as WhatsAppWebhookBody;
}

export function parseWhatsAppInboundTexts(
  body: WhatsAppWebhookBody,
): WhatsAppInboundText[] {
  const messages: WhatsAppInboundText[] = [];

  for (const entry of optionalArray(body.entry)) {
    for (const change of optionalArray(entry.changes)) {
      const value = change.value;
      if (!value || value.messaging_product !== "whatsapp") {
        continue;
      }

      const contactsByWaId = buildWhatsAppContactsByWaId(optionalArray(value.contacts));
      const phoneNumberId = normalizeTextValue(value.metadata?.phone_number_id ?? null);

      for (const message of optionalArray(value.messages)) {
        if (message.type !== "text") {
          continue;
        }

        const externalMessageId = normalizeTextValue(message.id);
        const fromWaId = normalizeTextValue(message.from);
        const text = normalizeTextValue(message.text?.body ?? null);

        if (!externalMessageId || !fromWaId || !text) {
          continue;
        }

        messages.push({
          contactProfileName:
            normalizeTextValue(contactsByWaId.get(fromWaId)?.profile?.name ?? null),
          externalMessageId,
          fromWaId,
          phoneNumberId,
          provider: "whatsapp",
          receivedAt: parseWhatsAppMessageTimestamp(message.timestamp),
          sparseRaw: buildWhatsAppInboundSparseRaw({
            changeField: change.field,
            entryId: entry.id,
            message,
            phoneNumberId,
          }),
          text,
        });
      }
    }
  }

  return messages;
}

export function buildWhatsAppWebhookEventId(messageId: string): string {
  const normalized = normalizeTextValue(messageId);
  if (!normalized) {
    throw new TypeError("WhatsApp webhook message id is required.");
  }

  return `whatsapp:message:${normalized}`;
}

function buildWhatsAppContactsByWaId(
  contacts: readonly WhatsAppWebhookContact[],
): Map<string, WhatsAppWebhookContact> {
  const contactsByWaId = new Map<string, WhatsAppWebhookContact>();

  for (const contact of contacts) {
    const waId = normalizeTextValue(contact.wa_id ?? null);
    if (waId && !contactsByWaId.has(waId)) {
      contactsByWaId.set(waId, contact);
    }
  }

  return contactsByWaId;
}

function buildWhatsAppInboundSparseRaw(input: {
  changeField?: string | null;
  entryId?: string | null;
  message: WhatsAppWebhookMessage;
  phoneNumberId: string | null;
}): unknown {
  return sanitizeRawMetadata(compactRecord({
    changeField: normalizeTextValue(input.changeField ?? null) ?? undefined,
    entryId: normalizeTextValue(input.entryId ?? null) ?? undefined,
    id: normalizeTextValue(input.message.id ?? null) ?? undefined,
    phoneNumberId: input.phoneNumberId ?? undefined,
    timestamp: normalizeTextValue(input.message.timestamp ?? null) ?? undefined,
    type: normalizeTextValue(input.message.type ?? null) ?? undefined,
  }));
}

function parseWhatsAppMessageTimestamp(value: unknown): Date {
  const normalized = normalizeTextValue(value);
  if (normalized) {
    const seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const receivedAt = new Date(seconds * 1000);
      if (!Number.isNaN(receivedAt.valueOf())) {
        return receivedAt;
      }
    }
  }

  return new Date();
}

function assertWhatsAppWebhookBodyShape(payload: object): void {
  const body = payload as Record<string, unknown>;
  const entries = readOptionalUnknownArray(body, "entry", "entry");

  for (const [entryIndex, entry] of (entries ?? []).entries()) {
    const entryRecord = readUnknownRecord(entry, `entry[${entryIndex}]`);
    const changes = readOptionalUnknownArray(
      entryRecord,
      "changes",
      `entry[${entryIndex}].changes`,
    );

    for (const [changeIndex, change] of (changes ?? []).entries()) {
      const changeRecord = readUnknownRecord(
        change,
        `entry[${entryIndex}].changes[${changeIndex}]`,
      );
      const value = changeRecord.value;
      if (value === undefined || value === null) {
        continue;
      }

      const valueRecord = readUnknownRecord(
        value,
        `entry[${entryIndex}].changes[${changeIndex}].value`,
      );
      readOptionalUnknownArray(
        valueRecord,
        "contacts",
        `entry[${entryIndex}].changes[${changeIndex}].value.contacts`,
      );
      readOptionalUnknownArray(
        valueRecord,
        "messages",
        `entry[${entryIndex}].changes[${changeIndex}].value.messages`,
      );
      readOptionalUnknownArray(
        valueRecord,
        "statuses",
        `entry[${entryIndex}].changes[${changeIndex}].value.statuses`,
      );
    }
  }
}

function readOptionalUnknownArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new WhatsAppWebhookPayloadError(
      `WhatsApp webhook payload field ${path} must be an array when present.`,
    );
  }

  return value;
}

function readUnknownRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WhatsAppWebhookPayloadError(
      `WhatsApp webhook payload field ${path} must be an object.`,
    );
  }

  return value as Record<string, unknown>;
}

function optionalArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeWhatsAppWebhookRawBody(
  rawBody: Buffer | Uint8Array | ArrayBuffer | string,
): string {
  if (typeof rawBody === "string") {
    return rawBody;
  }

  if (rawBody instanceof ArrayBuffer) {
    return Buffer.from(rawBody).toString("utf8");
  }

  return Buffer.from(rawBody).toString("utf8");
}

function readSingleWhatsAppWebhookHeader(
  headers: WhatsAppWebhookHeaders,
  name: string,
): string | null {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name);
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.length === 1 ? value[0] ?? null : null;
    }

    return value ?? null;
  }

  return null;
}
