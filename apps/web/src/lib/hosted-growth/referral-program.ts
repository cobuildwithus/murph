import {
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY,
} from "./signup-referral-policy";

export type HostedPublicReferralRewardId =
  | "active-group"
  | "new-person-group"
  | "signup-link";

export interface HostedPublicReferralReward {
  approximateMessageCount: number;
  availabilityLabel: string;
  description: string;
  id: HostedPublicReferralRewardId;
  title: string;
}

/**
 * Public referral-program projection. Runtime accounting remains authoritative;
 * the focused contract test keeps these approximate message labels and mission
 * thresholds aligned with the durable referral policy.
 */
export const HOSTED_PUBLIC_REFERRAL_REWARDS = [
  {
    approximateMessageCount: 100,
    availabilityLabel: "Personal referral link",
    description:
      "Share your stable link. When a genuinely new member completes Murph setup through it, the reward is added automatically.",
    id: "signup-link",
    title: HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY.title,
  },
  {
    approximateMessageCount: 100,
    availabilityLabel: "Fresh iMessage group",
    description:
      "Ask Murph to start the mission, then make a fresh group with someone new. It completes after they set up their own Murph and join the conversation.",
    id: "new-person-group",
    title: "Bring someone new to Murph",
  },
  {
    approximateMessageCount: 140,
    availabilityLabel: "Supported group chats",
    description:
      "Ask Murph to start the mission, then make a fresh group genuinely active: 15 human messages, including 8 from at least 2 other people, across at least 10 minutes.",
    id: "active-group",
    title: "Start an active group",
  },
] as const satisfies readonly HostedPublicReferralReward[];

export function formatApproximateReferralMessages(
  approximateMessageCount: number,
): string {
  return `About ${approximateMessageCount} more messages`;
}
