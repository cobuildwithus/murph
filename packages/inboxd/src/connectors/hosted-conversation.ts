import type { InboundCapture } from "../contracts/capture.ts";
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

export async function normalizeHostedEmailConversationCapture({
  rawMessage,
  ...input
}: NormalizeHostedEmailConversationInput): Promise<InboundCapture> {
  return normalizeParsedEmailMessage({
    ...input,
    message: parseRawEmailMessage(rawMessage),
  });
}
