import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { HomepageAuthRuntimeProvider } from "@/src/components/hosted-onboarding/homepage-auth-runtime-provider";
import { ReferralPageContent } from "@/src/components/referrals/referral-page-content";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const REFERRAL_METADATA_DESCRIPTION =
  "Share Murph with friends and earn more AI usage when a new member completes setup or a qualifying fresh group becomes active.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph referrals · Earn more Murph time",
  description: REFERRAL_METADATA_DESCRIPTION,
  alternates: {
    canonical: "/refer",
  },
  openGraph: {
    description: REFERRAL_METADATA_DESCRIPTION,
    type: "website",
  },
  twitter: {
    description: REFERRAL_METADATA_DESCRIPTION,
  },
});

export default async function ReferPage() {
  const [{ authenticated, authenticatedMember }, githubStarCount] =
    await Promise.all([
      getHostedPageAuthSnapshot(),
      getMurphGithubStarCount(),
    ]);

  return (
    <HomepageAuthRuntimeProvider authenticated={authenticated}>
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
        preloadAuthPanel
      />
      <ReferralPageContent
        authenticated={authenticated}
        identityKey={authenticatedMember?.id ?? null}
      />
      <SiteFooter />
    </HomepageAuthRuntimeProvider>
  );
}
