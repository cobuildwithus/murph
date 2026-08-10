export const HOSTED_USAGE_REFERRALS_ENABLED_ENV =
  "HOSTED_USAGE_REFERRALS_ENABLED";

export const HOSTED_USAGE_REFERRAL_POLICY_VERSION =
  "hosted-usage-referral-2026-07-v1";

export function isHostedUsageReferralEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_USAGE_REFERRALS_ENABLED_ENV] === "1";
}
