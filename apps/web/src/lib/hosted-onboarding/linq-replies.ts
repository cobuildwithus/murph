import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";

import { HOSTED_LINQ_DAILY_TEXT_LIMIT } from "./linq-daily-state";

export function buildHostedInviteReply(input: {
  joinUrl: string;
  seed?: string | null;
}): string {
  return renderUserFacingMessage({
    context: {
      joinUrl: input.joinUrl,
    },
    key: "linq.invite_signup",
    seed: input.seed ?? input.joinUrl,
  }).text;
}

export function buildHostedDailyQuotaReply(input: {
  seed?: string | null;
} = {}): string {
  return renderUserFacingMessage({
    context: {
      dailyTextLimit: HOSTED_LINQ_DAILY_TEXT_LIMIT,
    },
    key: "linq.daily_quota",
    seed: input.seed ?? `daily-quota:${HOSTED_LINQ_DAILY_TEXT_LIMIT}`,
  }).text;
}

export function buildHostedLinqConversationHomeRedirectReply(input: {
  homeRecipientPhone: string;
  seed?: string | null;
}): string {
  return renderUserFacingMessage({
    context: {
      homeRecipientPhone: input.homeRecipientPhone,
    },
    key: "linq.home_redirect",
    seed: input.seed ?? input.homeRecipientPhone,
  }).text;
}

export type HostedLinqGroupLeaveResult =
  | "already_left"
  | "evidence_conflict"
  | "group_not_found"
  | "left"
  | "member_unresolved"
  | "owner_cannot_leave";

export function buildHostedLinqGroupLeaveResultReply(
  result: HostedLinqGroupLeaveResult,
): string {
  switch (result) {
    case "left":
    case "already_left":
      return "You're out of this group. Your active membership and shares are off, and any remaining cleanup of the group's shared copy will keep running.";
    case "owner_cannot_leave":
      return "I couldn't remove you because you're the group owner. The group needs a different owner or must be dissolved first; that control isn't available in this chat yet.";
    case "evidence_conflict":
      return "I couldn't safely match that leave request, so I made no change. Please send a fresh “remove me from this group” message.";
    case "member_unresolved":
      return "I couldn't verify which member sent that request, so I made no change. Please send a fresh “remove me from this group” message from your linked contact.";
    case "group_not_found":
      return "I couldn't find an active Murph group for this chat, so nothing changed.";
  }
}
