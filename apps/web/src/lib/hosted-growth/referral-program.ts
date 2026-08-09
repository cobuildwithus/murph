import {
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY,
  isHostedSignupReferralRewardEnabled,
} from "./signup-referral-policy";
import { isHostedUsageReferralEnabled } from "./usage-referral-policy";

const HOSTED_PUBLIC_REFERRAL_USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

export type HostedPublicReferralRewardId =
  | "active-group"
  | "new-person-group"
  | "signup-link";

export interface HostedPublicReferralReward {
  availabilityLabel: string;
  description: string;
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
      "Share your stable link. If a genuinely new member completes setup and the referral passes eligibility and rolling-limit checks then, Murph applies the fixed usage credit automatically.",
    id: "signup-link",
    rewardUsdMicros: 2_000_000n,
    title: HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title,
  },
  {
    availabilityLabel: "Fresh iMessage group",
    description:
      "Tell Murph first, then make a fresh group with someone new. It completes after they set up their own Murph and join the conversation.",
    id: "new-person-group",
    rewardUsdMicros: 2_000_000n,
    title: "Bring someone new to Murph",
  },
  {
    availabilityLabel: "Supported group chats",
    description:
      "Tell Murph first, then make the fresh group genuinely active: 15 human messages, including 8 from at least 2 other people, across at least 10 minutes.",
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

export function formatHostedPublicReferralRewardValue(
  rewardUsdMicros: bigint,
): string {
  const cents = (rewardUsdMicros + 5_000n) / 10_000n;
  const value = HOSTED_PUBLIC_REFERRAL_USD_FORMATTER.format(
    Number(cents) / 100,
  );
  return `${value} of cost-weighted usage credit`;
}
