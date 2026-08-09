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
    ? "Share Murph with friends and earn more AI usage when a new member completes setup or a qualifying fresh group becomes active."
    : signupAvailable
    ? "Share Murph with friends and earn more AI usage when a genuinely new member completes setup through your referral link."
    : groupAvailable
    ? "Start a qualifying fresh group with Murph and earn more AI usage when the mission completes."
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
