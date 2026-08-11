import type { Metadata } from "next";

import { CreatorsPageContent } from "@/src/components/creators/creators-page-content";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const CREATORS_METADATA_DESCRIPTION =
  "Turn podcasts, protocols, courses, and coaching into reviewed, personalized health guidance your community can follow together.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph for Health Creators · Put your expertise into practice",
  description: CREATORS_METADATA_DESCRIPTION,
  alternates: {
    canonical: "/creators",
  },
  openGraph: {
    type: "website",
  },
});

export default async function CreatorsPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
      />
      <CreatorsPageContent />
      <SiteFooter />
    </>
  );
}
