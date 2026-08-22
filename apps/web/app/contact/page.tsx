import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { PublicTrustPageContent } from "@/src/components/public/public-trust-page";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { CONTACT_MURPH_CONTENT } from "@/src/lib/public-trust-pages";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/contact",
  },
  description:
    "Contact Murph for account, billing, privacy, security, connected-service, and product support, with guidance for keeping support messages safe.",
  openGraph: {
    type: "website",
  },
  title: "Contact Murph",
});

export default async function ContactPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <main className="min-h-dvh bg-[#f5f0e8] antialiased">
        <StickyNav authenticated={authenticated} darkTop githubStarCount={githubStarCount} />
        <PublicTrustPageContent content={CONTACT_MURPH_CONTENT} />
      </main>
      <SiteFooter />
    </>
  );
}
