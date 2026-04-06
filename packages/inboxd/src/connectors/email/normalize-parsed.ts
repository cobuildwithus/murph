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
  buildEmailMessageText,
  inferAttachmentKind,
  inferDirectEmailThreadFromParticipants,
  resolveEmailAddress,
  resolveEmailDisplayName,
} from "./normalize.ts";
import type { ParsedEmailMessage } from "./parsed.ts";

export interface NormalizeParsedEmailMessageInput {
  accountAddress?: string | null;
  accountId?: string | null;
  message: ParsedEmailMessage;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  source?: string;
  threadTarget?: string | null;
}

export async function normalizeParsedEmailMessage({
  accountAddress = null,
  accountId = null,
  message,
  selfAddresses = null,
  source = "email",
  threadTarget = null,
}: NormalizeParsedEmailMessageInput): Promise<InboundCapture> {
  const normalizedMessage = await toParsedEmailChatMessage({
    accountAddress,
    message,
    selfAddresses,
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
    text: buildEmailMessageText({
      html: input.message.html,
      text: input.message.text,
    }),
    thread: {
      id: serializeHostedEmailThreadTarget(resolvedThreadTarget),
      isDirect: inferDirectEmailThreadFromParticipants({
        accountAddress: normalizedAccountAddress,
        cc: input.message.cc,
        from: input.message.from,
        selfAddresses: normalizedSelfAddresses,
        to: input.message.to,
      }),
      title: normalizeTextValue(input.message.subject ?? null),
    },
  };
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
    replyAliasAddress: null,
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
  return sanitizeRawMetadata({
    attachments: message.attachments.map((attachment) => ({
      content_disposition: attachment.contentDisposition,
      content_id: attachment.contentId,
      content_transfer_encoding: attachment.contentTransferEncoding,
      content_type: attachment.contentType,
      file_name: attachment.fileName,
      size: attachment.data?.byteLength ?? null,
    })),
    bcc: message.bcc,
    cc: message.cc,
    from: message.from,
    headers: message.headers,
    html: message.html,
    in_reply_to: message.inReplyTo,
    message_id: message.messageId,
    raw_hash: message.rawHash,
    raw_size: message.rawSize,
    references: message.references,
    reply_to: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: message.to,
  }) as Record<string, unknown>;
}
