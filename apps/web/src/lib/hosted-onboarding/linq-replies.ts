export function buildHostedInviteReply(input: {
  activeSubscription: boolean;
  joinUrl: string;
}): string {
  return input.activeSubscription
    ? `Murph access is already active for this number.

Sign in here:
${input.joinUrl}`
    : `Welcome to Murph, your personal health assistant.

Verify your phone to finish signup here:
${input.joinUrl}`;
}

export function buildHostedDailyQuotaReply(): string {
  return "You have reached Murph's daily text limit of 100 messages. Try again tomorrow.";
}

export function buildHostedLinqConversationHomeRedirectReply(input: {
  homeRecipientPhone: string;
}): string {
  return `You're already set up with Murph.

Save this number and text me here instead:
${input.homeRecipientPhone}`;
}
