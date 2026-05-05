import { HOSTED_LINQ_DAILY_TEXT_LIMIT } from "./linq-daily-state";

export function buildHostedInviteReply(input: {
  joinUrl: string;
}): string {
  return `Welcome to Murph, your personal health assistant.

Verify your phone to finish signup here:
${input.joinUrl}`;
}

export function buildHostedDailyQuotaReply(): string {
  return `You have reached Murph's daily text limit of ${HOSTED_LINQ_DAILY_TEXT_LIMIT} messages. Try again tomorrow.`;
}

export function buildHostedLinqConversationHomeRedirectReply(input: {
  homeRecipientPhone: string;
}): string {
  return `You're already set up with Murph.

Save this number and text me here instead:
${input.homeRecipientPhone}`;
}
