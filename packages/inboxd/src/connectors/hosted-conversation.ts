import type { InboundCapture } from "../contracts/capture.ts";
import { createInboundCaptureFromChatMessage } from "./chat/message.ts";
import {
  normalizeParsedEmailMessage,
  type NormalizeParsedEmailMessageInput,
} from "./email/normalize-parsed.ts";
import { parseRawEmailMessage } from "./email/parsed.ts";
import {
  normalizeHostedLinqConversationMessage,
  type LinqAttachmentDownloadDriver,
  type NormalizeHostedLinqConversationMessageInput,
} from "./linq/normalize.ts";
import {
  normalizeHostedTelegramMessage,
  type NormalizeHostedTelegramMessageInput,
  type TelegramAttachmentDownloadDriver,
} from "./telegram/normalize.ts";
import {
  normalizeTextValue,
  toIsoTimestamp,
} from "../shared-runtime.ts";

export type {
  LinqAttachmentDownloadDriver,
  NormalizeHostedLinqConversationMessageInput,
  NormalizeHostedTelegramMessageInput,
  TelegramAttachmentDownloadDriver,
};

export type NormalizeHostedEmailConversationInput = Omit<
  NormalizeParsedEmailMessageInput,
  "message"
> & {
  rawMessage: Uint8Array | ArrayBuffer | string;
};

export interface NormalizeHostedWhatsAppConversationInput {
  accountId?: string | null;
  externalId: string;
  message: {
    fromWaId: string;
    messageId: string;
    phoneNumberId?: string | null;
    text: string;
    threadId: string;
  };
  occurredAt: string;
  receivedAt?: string | null;
  source?: string;
}

export async function normalizeHostedLinqConversationCapture(
  input: NormalizeHostedLinqConversationMessageInput,
): Promise<InboundCapture> {
  return normalizeHostedLinqConversationMessage(input);
}

export async function normalizeHostedTelegramConversationCapture(
  input: NormalizeHostedTelegramMessageInput,
): Promise<InboundCapture> {
  return normalizeHostedTelegramMessage(input);
}

export async function normalizeHostedWhatsAppConversationCapture({
  accountId = "cloud-api",
  externalId,
  message,
  occurredAt,
  receivedAt = null,
  source = "whatsapp",
}: NormalizeHostedWhatsAppConversationInput): Promise<InboundCapture> {
  return createInboundCaptureFromChatMessage({
    accountId: normalizeTextValue(accountId) ?? "cloud-api",
    message: {
      actor: {
        displayName: null,
        id: normalizeTextValue(message.fromWaId),
        isSelf: false,
      },
      attachments: [],
      externalId,
      occurredAt: toIsoTimestamp(occurredAt),
      raw: buildHostedWhatsAppRawMetadata(message),
      receivedAt: receivedAt ? toIsoTimestamp(receivedAt) : toIsoTimestamp(occurredAt),
      text: normalizeTextValue(message.text),
      thread: {
        id: message.threadId,
        isDirect: true,
        title: null,
      },
    },
    source,
  });
}

export async function normalizeHostedEmailConversationCapture({
  rawMessage,
  ...input
}: NormalizeHostedEmailConversationInput): Promise<InboundCapture> {
  return normalizeParsedEmailMessage({
    ...input,
    message: parseRawEmailMessage(rawMessage),
  });
}

function buildHostedWhatsAppRawMetadata(
  message: NormalizeHostedWhatsAppConversationInput["message"],
): Record<string, unknown> {
  return {
    message_id: message.messageId,
    phone_number_id: message.phoneNumberId ?? null,
    schema: "murph.whatsapp-capture.v1",
  };
}
