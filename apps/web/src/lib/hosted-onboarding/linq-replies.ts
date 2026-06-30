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
