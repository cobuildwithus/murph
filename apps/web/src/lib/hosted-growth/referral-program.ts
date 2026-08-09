import {
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY,
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
  isHostedSignupReferralRewardEnabled,
} from "./signup-referral-policy";
import {
  formatHostedReferralRewardUsageDays,
} from "./referral-reward-days";
import {
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
  isHostedUsageReferralEnabled,
} from "./usage-referral-policy";

export type HostedPublicReferralRewardId =
  | "active-group"
  | "new-person-group"
  | "signup-link";

export interface HostedPublicReferralReward {
  availabilityLabel: string;
  description: string;
  id: HostedPublicReferralRewardId;
  policyCode: "active_group_v1" | "new_person_activation_v1";
  policyVersion: string;
  rewardUsdMicros: bigint;
  title: string;
}

/**
 * Public referral-program projection. Runtime accounting remains authoritative;
 * the focused contract test keeps these exact reward values and mission
 * thresholds aligned with the durable referral policy.
 */
export const HOSTED_PUBLIC_REFERRAL_REWARDS = [
  {
    availabilityLabel: "Personal referral link",
    description:
      "Share your stable link. A genuinely new completed signup can earn more days of Murph usage after Murph’s eligibility and rolling-limit checks pass.",
    id: "signup-link",
    policyCode: "new_person_activation_v1",
    policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 2_000_000n,
    title: HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title,
  },
  {
    availabilityLabel: "Fresh iMessage group",
    description:
      "Tell Murph first, then make a fresh group with someone new. It completes after they set up their own Murph and join the conversation.",
    id: "new-person-group",
    policyCode: "new_person_activation_v1",
    policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 2_000_000n,
    title: "Bring someone new to Murph",
  },
  {
    availabilityLabel: "Supported group chats",
    description:
      "Tell Murph first, then make the fresh group genuinely active: 15 human messages, including 8 from at least 2 other people, across at least 10 minutes.",
    id: "active-group",
    policyCode: "active_group_v1",
    policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 3_500_000n,
    title: "Start an active group",
  },
] as const satisfies readonly HostedPublicReferralReward[];

export function getAvailableHostedPublicReferralRewards(
  source: Readonly<Record<string, string | undefined>> = process.env,
): readonly HostedPublicReferralReward[] {
  const signupRewardsEnabled = isHostedSignupReferralRewardEnabled(source);
  const groupRewardsEnabled = isHostedUsageReferralEnabled(source);

  return HOSTED_PUBLIC_REFERRAL_REWARDS.filter((reward) =>
    reward.id === "signup-link"
      ? signupRewardsEnabled
      : groupRewardsEnabled
  );
}

export function formatHostedPublicReferralRewardValue(
  reward: Pick<
    HostedPublicReferralReward,
    "policyCode" | "policyVersion" | "rewardUsdMicros"
  >,
): string {
  return formatHostedReferralRewardUsageDays({
    ...reward,
    sentenceCase: true,
  });
}
