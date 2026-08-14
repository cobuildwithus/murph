import type { Metadata } from "next";

import type { HostedPublicReferralReward } from "./referral-program";
import { createMurphPageMetadata } from "../site-metadata";

export function buildReferralPageMetadata(
  rewards: readonly HostedPublicReferralReward[],
): Metadata {
  const signupAvailable = rewards.some(({ id }) => id === "signup-link");
  const groupAvailable = rewards.some(({ id }) => id !== "signup-link");
  const description = signupAvailable && groupAvailable
    ? "Share your referral link or start a new group with Murph. When a referral meets the rules, Murph adds extra usage automatically."
    : signupAvailable
    ? "Share your personal link with someone new to Murph. If they finish setup and the referral meets the rules, Murph adds extra usage."
    : groupAvailable
    ? "Share your personal link anytime. To earn extra usage, choose a group referral option and ask Murph before starting the group."
    : "Murph referral rewards are temporarily unavailable. Check back for current referral options.";

  return createMurphPageMetadata({
    title: rewards.length > 0
      ? "Murph referrals · Earn more Murph time"
      : "Murph referrals · Temporarily unavailable",
    description,
    alternates: {
      canonical: "/refer",
    },
    openGraph: {
      description,
      type: "website",
    },
    twitter: {
      description,
    },
  });
}
