import type { Metadata } from "next";

import { ClubsPageContent } from "@/src/components/clubs/clubs-page-content";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const CLUBS_METADATA_DESCRIPTION =
  "Run club challenges in iMessage with automatic scoring from the supported wearables members already use, no spreadsheets required.";
const CLUBS_OPEN_GRAPH_IMAGE = {
  alt: "You run the club. Murph runs the challenge.",
  height: 630,
  type: "image/png",
  url: "/clubs/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph for Clubs · Run community fitness challenges",
  description: CLUBS_METADATA_DESCRIPTION,
  alternates: {
    canonical: "/clubs",
  },
  openGraph: {
    images: [CLUBS_OPEN_GRAPH_IMAGE],
    type: "website",
  },
  twitter: {
    images: [CLUBS_OPEN_GRAPH_IMAGE],
  },
});

export default async function ClubsPage() {
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
      <ClubsPageContent />
      <SiteFooter />
    </>
  );
}
