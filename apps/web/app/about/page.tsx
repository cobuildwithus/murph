import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { PublicTrustPageContent } from "@/src/components/public/public-trust-page";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { ABOUT_MURPH_CONTENT } from "@/src/lib/public-trust-pages";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/about",
  },
  description:
    "What Murph does, who the personal health AI is for, how it is built, and the boundaries around its educational health guidance.",
  openGraph: {
    type: "website",
  },
  title: "About Murph",
});

export default async function AboutPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <main className="min-h-dvh bg-[#f5f0e8] antialiased">
        <StickyNav authenticated={authenticated} darkTop githubStarCount={githubStarCount} />
        <PublicTrustPageContent content={ABOUT_MURPH_CONTENT} />
      </main>
      <SiteFooter />
    </>
  );
}
