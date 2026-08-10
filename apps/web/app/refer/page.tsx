import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { HomepageAuthRuntimeProvider } from "@/src/components/hosted-onboarding/homepage-auth-runtime-provider";
import { ReferralPageContent } from "@/src/components/referrals/referral-page-content";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import {
  getAvailableHostedPublicReferralRewards,
  type HostedPublicReferralReward,
} from "@/src/lib/hosted-growth/referral-program";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

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

export function generateMetadata(): Metadata {
  return buildReferralPageMetadata(
    getAvailableHostedPublicReferralRewards(),
  );
}

export default async function ReferPage() {
  const rewards = getAvailableHostedPublicReferralRewards();
  const [{ authenticated, authenticatedMember }, githubStarCount] =
    await Promise.all([
      getHostedPageAuthSnapshot(),
      getMurphGithubStarCount(),
    ]);

  return (
    <HomepageAuthRuntimeProvider
      authenticated={authenticated}
      authenticatedDestination="/refer"
    >
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
        preloadAuthPanel
      />
      <ReferralPageContent
        authenticated={authenticated}
        identityKey={authenticatedMember?.id ?? null}
        rewards={rewards}
      />
      <SiteFooter />
    </HomepageAuthRuntimeProvider>
  );
}
