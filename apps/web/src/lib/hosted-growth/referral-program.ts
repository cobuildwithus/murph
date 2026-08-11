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
 * the focused contract test keeps these exact reward values and referral
 * thresholds aligned with the durable referral policy.
 */
export const HOSTED_PUBLIC_REFERRAL_REWARDS = [
  {
    availabilityLabel: "Personal referral link",
    description:
      "Share your personal link with someone new to Murph. If they finish setup and the referral meets the rules, Murph adds more usage to your personal Murph.",
    id: "signup-link",
    policyCode: "new_person_activation_v1",
    policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 2_000_000n,
    title: HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title,
  },
  {
    availabilityLabel: "New iMessage group",
    description:
      "Tell Murph first, then create a new iMessage group with someone new to Murph. The reward comes after they finish setup and join the conversation.",
    id: "new-person-group",
    policyCode: "new_person_activation_v1",
    policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 2_000_000n,
    title: "Bring someone new to Murph",
  },
  {
    availabilityLabel: "New group conversation",
    description:
      "Tell Murph first, then start a new group. It needs 15 messages over at least 10 minutes, with at least 8 from two or more people besides you.",
    id: "active-group",
    policyCode: "active_group_v1",
    policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
    rewardUsdMicros: 3_500_000n,
    title: "Start a group conversation",
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
