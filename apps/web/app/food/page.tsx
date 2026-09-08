import type { Metadata } from "next";

import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const FOOD_DESCRIPTION =
  "Compare branded food labels by calories, protein, sugar, fat, ingredients, and linked lab evidence.";
const FOOD_OPEN_GRAPH_IMAGE = {
  alt: "Murph food label comparison",
  height: 630,
  type: "image/jpeg",
  url: "/food/opengraph-image.jpg",
  width: 1200,
} as const;

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    alternates: { canonical: "/food" },
    description: FOOD_DESCRIPTION,
    openGraph: {
      images: [FOOD_OPEN_GRAPH_IMAGE],
      type: "website",
      url: "/food",
    },
    title: "Compare food labels and ingredients | Murph",
    twitter: { images: [FOOD_OPEN_GRAPH_IMAGE] },
  }),
  keywords: [
    "food label comparison",
    "compare nutrition facts",
    "food ingredients",
    "product lab tests",
  ],
  referrer: "no-referrer",
  robots: { follow: true, index: true },
};

export default async function FoodPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const brandfetchClientId = process.env.BRANDFETCH_CLIENT_ID?.trim() || null;

  return (
    <>
      <StickyNav
        authenticated={authenticated}
        githubStarCount={githubStarCount}
        splitUnauthenticatedAuth={false}
        unauthenticatedAuthLabel="Ask Murph"
      />
      <FoodLabelLab brandfetchClientId={brandfetchClientId} />
      <SiteFooter wide />
    </>
  );
}
