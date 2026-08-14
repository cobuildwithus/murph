import {
  createHostedEmailThreadTarget,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
  type HostedEmailThreadTarget,
} from "@murphai/runtime-state";

import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";
import { normalizeTextValue, sanitizeRawMetadata, toIsoTimestamp } from "../../shared.ts";
import type { ChatMessage } from "../chat/message.ts";
import { createInboundCaptureFromChatMessage } from "../chat/message.ts";
import {
  inferDirectEmailThreadFromParticipants,
  resolveEmailAddress,
} from "./directness.ts";
import type { ParsedEmailMessage } from "./parsed.ts";

export interface NormalizeParsedEmailMessageInput {
  accountAddress?: string | null;
  accountId?: string | null;
  message: ParsedEmailMessage;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  source?: string;
  threadIsDirect?: boolean | null;
  threadTarget?: string | null;
}

export async function normalizeParsedEmailMessage({
  accountAddress = null,
  accountId = null,
  message,
  selfAddresses = null,
  source = "email",
  threadIsDirect,
  threadTarget = null,
}: NormalizeParsedEmailMessageInput): Promise<InboundCapture> {
  const normalizedMessage = await toParsedEmailChatMessage({
    accountAddress,
    message,
    selfAddresses,
    threadIsDirect,
    threadTarget,
  });

  return createInboundCaptureFromChatMessage({
    accountId,
    message: normalizedMessage,
    source,
  });
}

export async function toParsedEmailChatMessage(input: {
  accountAddress?: string | null;
  message: ParsedEmailMessage;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  threadIsDirect?: boolean | null;
  threadTarget?: string | null;
}): Promise<ChatMessage> {
  const normalizedAccountAddress = resolveEmailAddress(input.accountAddress ?? null);
  const normalizedSelfAddresses = resolveParsedEmailSelfAddresses([
    normalizedAccountAddress,
    ...(input.selfAddresses ?? []),
  ]);
  const selfAddressSet = new Set(normalizedSelfAddresses.map((value) => value.toLowerCase()));
  const actorId = resolveEmailAddress(input.message.from ?? null);
  const actorDisplayName = resolveEmailDisplayName(input.message.from ?? null);
  const resolvedThreadTarget = resolveParsedEmailThreadTarget({
    message: input.message,
    selfAddresses: normalizedSelfAddresses,
    threadTarget: input.threadTarget ?? null,
  });

  return {
    attachments: buildParsedEmailAttachments(input.message.attachments),
    actor: {
      displayName: actorDisplayName,
      id: actorId,
      isSelf: actorId !== null && selfAddressSet.has(actorId.toLowerCase()),
    },
    externalId: `email:${input.message.messageId ?? input.message.rawHash.slice(0, 24)}`,
    occurredAt: toIsoTimestamp(input.message.occurredAt ?? new Date()),
    raw: sanitizeParsedEmailMessage(input.message),
    receivedAt: input.message.receivedAt ?? input.message.occurredAt ?? null,
    text: buildParsedEmailMessageText(input.message),
    thread: {
      id: serializeHostedEmailThreadTarget(resolvedThreadTarget),
      ...(input.threadIsDirect === null
        ? {}
        : {
            isDirect: typeof input.threadIsDirect === "boolean"
              ? input.threadIsDirect
              : inferDirectEmailThreadFromParticipants({
                  accountAddress: normalizedAccountAddress,
                  bcc: input.message.bcc,
                  cc: input.message.cc,
                  from: input.message.from,
                  selfAddresses: normalizedSelfAddresses,
                  to: input.message.to,
                }),
          }),
      title: normalizeTextValue(input.message.subject ?? null),
    },
  };
}

export function buildParsedEmailThreadTarget(input: {
  accountAddress?: string | null;
  message: ParsedEmailMessage;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  threadTarget?: string | null;
}): string {
  const normalizedAccountAddress = resolveEmailAddress(input.accountAddress ?? null);
  const normalizedSelfAddresses = resolveParsedEmailSelfAddresses([
    normalizedAccountAddress,
    ...(input.selfAddresses ?? []),
  ]);
  return serializeHostedEmailThreadTarget(
    resolveParsedEmailThreadTarget({
      message: input.message,
      selfAddresses: normalizedSelfAddresses,
      threadTarget: input.threadTarget ?? null,
    }),
  );
}

export function resolveParsedEmailThreadKey(input: {
  message: ParsedEmailMessage;
  rawMessageKey: string;
}): string {
  return (
    input.message.references[0] ??
    input.message.inReplyTo ??
    input.message.messageId ??
    input.rawMessageKey
  );
}

function resolveParsedEmailThreadTarget(input: {
  message: ParsedEmailMessage;
  selfAddresses: ReadonlyArray<string>;
  threadTarget: string | null;
}): HostedEmailThreadTarget {
  const existing = parseHostedEmailThreadTarget(input.threadTarget);
  if (existing) {
    return existing;
  }

  const replyRecipients = input.message.replyTo
    .map((value) => resolveEmailAddress(value))
    .filter((value): value is string => value !== null);
  const replyRecipient = replyRecipients[0] ?? resolveEmailAddress(input.message.from ?? null);
  const cc = collectReplyAllRecipients({
    primaryRecipient: replyRecipient,
    recipients: [...replyRecipients.slice(1), ...input.message.to, ...input.message.cc],
    selfAddresses: input.selfAddresses,
  });

  return createHostedEmailThreadTarget({
    cc,
    lastMessageId: input.message.messageId,
    references: [...input.message.references, input.message.inReplyTo, input.message.messageId].filter(
      (value): value is string => Boolean(value && value.trim()),
    ),
    subject: normalizeTextValue(input.message.subject ?? null),
    to: replyRecipient ? [replyRecipient] : [],
  });
}

function collectReplyAllRecipients(input: {
  primaryRecipient: string | null;
  recipients: ReadonlyArray<string | null | undefined>;
  selfAddresses: ReadonlyArray<string>;
}): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  const selfAddressSet = new Set(input.selfAddresses.map((value) => value.toLowerCase()));

  for (const value of input.recipients) {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized) {
      continue;
    }

    if (selfAddressSet.has(normalized.toLowerCase())) {
      continue;
    }

    if (input.primaryRecipient !== null && normalized === input.primaryRecipient) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    recipients.push(normalized);
  }

  return recipients;
}

function resolveParsedEmailSelfAddresses(
  values: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const value of values) {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    addresses.push(normalized);
  }

  return addresses;
}

function buildParsedEmailAttachments(
  attachments: ParsedEmailMessage["attachments"],
): InboundAttachment[] {
  return attachments.map((attachment) => ({
    byteSize: attachment.data?.byteLength ?? null,
    data: attachment.data,
    externalId: attachment.contentId,
    fileName: attachment.fileName,
    kind: inferAttachmentKind({
      content_type: attachment.contentType,
      filename: attachment.fileName,
    }),
    mime: attachment.contentType,
  }));
}

function sanitizeParsedEmailMessage(message: ParsedEmailMessage): Record<string, unknown> {
  return sanitizeRawMetadata(compactRecord({
    schema: "murph.email-parsed-capture.v1",
    raw_hash: message.rawHash,
    raw_size: message.rawSize,
    attachment_count: countArrayEntries(message.attachments),
    to_count: countNormalizedEntries(message.to),
    cc_count: countNormalizedEntries(message.cc),
    bcc_count: countNormalizedEntries(message.bcc),
    reply_to_count: countNormalizedEntries(message.replyTo),
    reference_count: countNormalizedEntries(message.references),
    header_count: countRecordEntries(message.headers),
    has_message_id: truthyFlag(message.messageId),
    has_in_reply_to: truthyFlag(message.inReplyTo),
    has_from: truthyFlag(message.from),
    has_subject: truthyFlag(message.subject),
    has_text: truthyFlag(message.text),
    has_html: truthyFlag(message.html),
  })) as Record<string, unknown>;
}

function truthyFlag(value: string | null | undefined): boolean | undefined {
  return normalizeTextValue(value) ? true : undefined;
}

function countNormalizedEntries(
  values: ReadonlyArray<string | null | undefined> | null | undefined,
): number | undefined {
  const count = (values ?? []).filter((value) => normalizeTextValue(value) !== null).length;
  return count > 0 ? count : undefined;
}

function countArrayEntries(
  values: ReadonlyArray<unknown> | null | undefined,
): number | undefined {
  const count = values?.length ?? 0;
  return count > 0 ? count : undefined;
}

function countRecordEntries(
  value: Record<string, unknown> | null | undefined,
): number | undefined {
  const count = value ? Object.keys(value).length : 0;
  return count > 0 ? count : undefined;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function buildParsedEmailMessageText(message: ParsedEmailMessage): string | null {
  return (
    normalizeTextValue(message.text) ??
    normalizeTextValue(stripHtml(message.html)) ??
    null
  );
}

function resolveEmailDisplayName(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  const angleIndex = normalized.indexOf("<");
  if (angleIndex <= 0) {
    return null;
  }

  const candidate = normalized.slice(0, angleIndex).trim().replace(/^"|"$/gu, "");
  return candidate.length > 0 ? candidate : null;
}

function inferAttachmentKind(attachment: {
  content_type?: string | null;
  filename?: string | null;
}): InboundAttachment["kind"] {
  const mime = String(attachment.content_type ?? "").toLowerCase();
  const fileName = String(attachment.filename ?? "").toLowerCase();

  if (mime.startsWith("image/") || /\.(gif|heic|heif|jpe?g|png|webp)$/u.test(fileName)) {
    return "image";
  }
  if (mime.startsWith("audio/") || /\.(aac|m4a|mp3|wav)$/u.test(fileName)) {
    return "audio";
  }
  if (mime.startsWith("video/") || /\.(m4v|mov|mp4|webm)$/u.test(fileName)) {
    return "video";
  }
  if (
    mime === "application/pdf" ||
    /\.(csv|docx?|pdf|rtf|txt|xls|xlsx)$/u.test(fileName)
  ) {
    return "document";
  }

  return "other";
}

function stripHtml(value: string | null | undefined): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}
