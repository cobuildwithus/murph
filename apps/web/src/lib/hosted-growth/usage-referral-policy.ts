export const HOSTED_USAGE_REFERRALS_ENABLED_ENV =
  "HOSTED_USAGE_REFERRALS_ENABLED";

export function isHostedUsageReferralEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_USAGE_REFERRALS_ENABLED_ENV] === "1";
}
