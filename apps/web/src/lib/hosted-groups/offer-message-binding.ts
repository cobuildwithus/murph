import "server-only";

import {
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedTelegramMessageLookupKey,
  createHostedTelegramMessageLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { toHostedOnboardingLogIdSuffix } from "../hosted-onboarding/logging";

/**
 * Chat channels that can carry a one-tap group offer. Each one binds an offer
 * to the exact provider message that advertised it, so the affirmation that
 * arrives later can only ever match the card the member actually saw.
 */
export type HostedGroupOfferChannel = "linq" | "telegram";

/**
 * Linq message ids are provider-global. Telegram message ids repeat across
 * chats, so a Telegram binding is only unique together with its chat.
 */
export type HostedGroupOfferMessageBinding =
  | { channel: "linq"; messageId: string | null | undefined }
  | {
      channel: "telegram";
      chatId: string | null | undefined;
      messageId: string | null | undefined;
    };

export function createHostedGroupOfferMessageLookupKey(
  binding: HostedGroupOfferMessageBinding,
): string | null {
  return binding.channel === "linq"
    ? createHostedLinqMessageLookupKey(binding.messageId)
    : createHostedTelegramMessageLookupKey({
        chatId: binding.chatId,
        messageId: binding.messageId,
      });
}

export function createHostedGroupOfferMessageLookupKeyReadCandidates(
  binding: HostedGroupOfferMessageBinding,
): string[] {
  return binding.channel === "linq"
    ? createHostedLinqMessageLookupKeyReadCandidates(binding.messageId)
    : createHostedTelegramMessageLookupKeyReadCandidates({
        chatId: binding.chatId,
        messageId: binding.messageId,
      });
}

export function readHostedGroupOfferMessageIdSuffix(
  binding: HostedGroupOfferMessageBinding,
): string | null {
  return toHostedOnboardingLogIdSuffix(binding.messageId);
}
