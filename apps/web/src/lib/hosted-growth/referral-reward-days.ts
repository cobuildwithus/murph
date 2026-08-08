/**
 * User-facing reward copy is expressed as days of typical usage, assuming an
 * average member sends about this many messages per day. Accounting still
 * runs on message-equivalent credit; only labels divide by this.
 */
export const HOSTED_USAGE_REFERRAL_ASSUMED_MESSAGES_PER_DAY = 10;

export function computeHostedUsageReferralRewardDays(
  approximateMessageCount: number,
): number {
  return Math.round(
    approximateMessageCount / HOSTED_USAGE_REFERRAL_ASSUMED_MESSAGES_PER_DAY,
  );
}
