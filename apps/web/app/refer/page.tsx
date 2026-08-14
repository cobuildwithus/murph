import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { HomepageAuthRuntimeProvider } from "@/src/components/hosted-onboarding/homepage-auth-runtime-provider";
import { ReferralPageContent } from "@/src/components/referrals/referral-page-content";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import {
  getAvailableHostedPublicReferralRewards,
} from "@/src/lib/hosted-growth/referral-program";
import { buildReferralPageMetadata } from "@/src/lib/hosted-growth/referral-page-metadata";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { StickyNav } from "../sticky-nav";

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
