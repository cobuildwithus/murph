export const HOSTED_SIGNUP_REFERRAL_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";

export const HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY = {
  requirementsLabel:
    "A new member completed Murph setup through your referral link.",
  title: "Invite someone to Murph",
} as const;

export function isHostedSignupReferralPolicyVersion(
  policyVersion: string,
): boolean {
  return policyVersion === HOSTED_SIGNUP_REFERRAL_POLICY_VERSION;
}
