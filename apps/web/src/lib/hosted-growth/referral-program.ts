import {
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY,
  isHostedSignupReferralRewardEnabled,
} from "./signup-referral-policy";
import { isHostedUsageReferralEnabled } from "./usage-referral-policy";

export type HostedPublicReferralRewardId =
  | "active-group"
  | "new-person-group"
  | "signup-link";

export interface HostedPublicReferralReward {
  availabilityLabel: string;
  description: string;
  estimatedUsageDays: number;
  id: HostedPublicReferralRewardId;
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
      "Share your stable link. A genuinely new completed signup can earn the fixed usage credit after Murph’s eligibility and rolling-limit checks pass.",
    estimatedUsageDays: 10,
    id: "signup-link",
    rewardUsdMicros: 2_000_000n,
    title: HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title,
  },
  {
    availabilityLabel: "Fresh iMessage group",
    description:
      "Tell Murph first, then make a fresh group with someone new. It completes after they set up their own Murph and join the conversation.",
    estimatedUsageDays: 10,
    id: "new-person-group",
    rewardUsdMicros: 2_000_000n,
    title: "Bring someone new to Murph",
  },
  {
    availabilityLabel: "Supported group chats",
    description:
      "Tell Murph first, then make the fresh group genuinely active: 15 human messages, including 8 from at least 2 other people, across at least 10 minutes.",
    estimatedUsageDays: 14,
    id: "active-group",
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

export function formatHostedPublicReferralRewardDays(
  estimatedUsageDays: number,
): string {
  return `${estimatedUsageDays} days of Murph`;
}
