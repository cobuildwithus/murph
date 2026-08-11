export const HOSTED_SIGNUP_REFERRAL_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";
export const HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED_ENV =
  "HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED";

/**
 * Persisted signup-link policy versions. Keep prior entries when the policy
 * changes so read-only projections and recovery continue to classify existing
 * receipts correctly without relying on an ID prefix or a second state owner.
 */
export const HOSTED_SIGNUP_REFERRAL_POLICY_VERSIONS = [
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
] as const;

export const HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY = {
  requirementsLabel:
    "A new member completed Murph setup through your referral link.",
  title: "Share your referral link",
} as const;

export function isHostedSignupReferralPolicyVersion(
  policyVersion: string,
): boolean {
  return HOSTED_SIGNUP_REFERRAL_POLICY_VERSIONS.some(
    (knownVersion) => knownVersion === policyVersion,
  );
}

export function isHostedSignupReferralRewardEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return source[HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED_ENV] === "1";
}
