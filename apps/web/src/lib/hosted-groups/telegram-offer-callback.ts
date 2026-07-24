import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildTelegramThreadId,
  type TelegramCallbackQueryLike,
} from "@murphai/messaging-ingress/telegram-webhook";

import { createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { resolveHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  answerHostedTelegramCallbackQueryBestEffort,
  HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA,
  HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA,
} from "../hosted-onboarding/telegram-client";
import {
  acceptHostedGroupOfferAffirmation,
  type HostedGroupOfferAffirmationKind,
} from "./group-offer-affirmation";
import { createHostedGroupOfferMessageLookupKeyReadCandidates } from "./offer-message-binding";

export type HostedTelegramGroupOfferCallbackResult = {
  handled: boolean;
  reason: string;
};

/**
 * Turns one inline-button tap into a group grant.
 *
 * The tapped message is the binding: the callback carries the exact chat and
 * message the button was attached to, which is the same identity the Linq
 * reaction path matches on, so no token is minted or trusted. Every check below
 * fails closed and the button simply does nothing.
 */
export async function handleHostedTelegramGroupOfferCallback(input: {
  callbackQuery: TelegramCallbackQueryLike;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedTelegramGroupOfferCallbackResult> {
  const { callbackQuery } = input;
  const kinds = readHostedTelegramGroupOfferCallbackKinds(callbackQuery.data);

  if (!kinds) {
    return { handled: false, reason: "unsupported-callback-data" };
  }

  const answer = async (text: string | null): Promise<void> => {
    await answerHostedTelegramCallbackQueryBestEffort({
      callbackQueryId: callbackQuery.id,
      ...(input.signal ? { signal: input.signal } : {}),
      text,
    });
  };

  // An inline-mode callback carries `inline_message_id` and no chat message, so
  // it can never be matched to a posted offer.
  const message = callbackQuery.message;
  if (!message) {
    await answer(null);
    return { handled: false, reason: "callback-without-chat-message" };
  }
  if (callbackQuery.from.is_bot === true) {
    await answer(null);
    return { handled: false, reason: "bot-actor" };
  }

  const telegramUserId = String(callbackQuery.from.id);
  const memberLookup = await resolveHostedMemberRoutingByTelegramUserId({
    prisma: input.prisma,
    telegramUserId,
  });
  if (memberLookup.status === "ambiguous") {
    await answer(null);
    return { handled: false, reason: "ambiguous-telegram-binding" };
  }
  const member = memberLookup.status === "found" ? memberLookup.lookup.core : null;
  if (!member) {
    await answer(HOSTED_TELEGRAM_GROUP_OFFER_UNLINKED_TEXT);
    return { handled: false, reason: "unlinked-telegram" };
  }
  if (isHostedMemberSuspended(member.suspendedAt)) {
    await answer(null);
    return { handled: false, reason: "suspended-member" };
  }
  if (!await readActiveHostedMemberAccess({ memberId: member.id, prisma: input.prisma })) {
    await answer(null);
    return { handled: false, reason: "inactive-member" };
  }

  const result = await acceptHostedGroupOfferAffirmation({
    affirmationEventId: buildHostedTelegramGroupOfferAffirmationEventId({
      chatId: String(message.chat.id),
      messageId: String(message.message_id),
      telegramUserId,
    }),
    channel: "telegram",
    kinds,
    memberId: member.id,
    messageLookupKeyReadCandidates: createHostedGroupOfferMessageLookupKeyReadCandidates({
      channel: "telegram",
      chatId: String(message.chat.id),
      messageId: String(message.message_id),
    }),
    now: new Date(),
    prisma: input.prisma,
    ...(input.signal ? { signal: input.signal } : {}),
    threadIdentityLookupKeyReadCandidates:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "telegram",
        threadId: buildTelegramThreadId(message),
      }),
  });

  if (result.status === "accepted") {
    await answer(
      result.kind === "join"
        ? HOSTED_TELEGRAM_GROUP_OFFER_JOINED_TEXT
        : HOSTED_TELEGRAM_GROUP_OFFER_ALLOWED_TEXT,
    );
    return { handled: true, reason: `accepted-telegram-group-${result.kind}` };
  }
  await answer(readHostedTelegramGroupOfferSkipText(result.reason));
  return { handled: false, reason: `skipped-telegram-group-offer:${result.reason}` };
}

/**
 * A tap can only ever accept the card its own button was attached to. Join and
 * permission buttons carry distinct data, so neither can cross over.
 */
function readHostedTelegramGroupOfferCallbackKinds(
  data: string | null | undefined,
): readonly HostedGroupOfferAffirmationKind[] | null {
  const normalized = data?.trim() ?? "";

  if (normalized === HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA) {
    return ["join"];
  }
  if (normalized === HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA) {
    return ["disclosure"];
  }
  return null;
}

/**
 * Scopes the affirmation to one actor on one exact message so a member's own
 * repeat taps stay idempotent for the disclosure grant.
 */
function buildHostedTelegramGroupOfferAffirmationEventId(input: {
  chatId: string;
  messageId: string;
  telegramUserId: string;
}): string {
  return `telegram:callback:${input.chatId}:${input.messageId}:${input.telegramUserId}`;
}

const HOSTED_TELEGRAM_GROUP_OFFER_JOINED_TEXT = "You're in.";
const HOSTED_TELEGRAM_GROUP_OFFER_ALLOWED_TEXT = "Done, that's shared.";
const HOSTED_TELEGRAM_GROUP_OFFER_UNLINKED_TEXT =
  "Message Murph directly first, then tap again.";

function readHostedTelegramGroupOfferSkipText(reason: string): string | null {
  if (reason === "launch_consent_missing") {
    return "Open Murph on the web once to accept the terms, then tap again.";
  }
  if (reason === "disclosure_grant_limit_reached") {
    return "That's already shared.";
  }
  if (reason === "not_a_member") {
    return "Join the group first.";
  }
  return null;
}
