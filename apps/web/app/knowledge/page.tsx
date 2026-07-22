import type { Metadata } from "next";
import Link from "next/link";

import { ComparisonSection } from "@/src/components/knowledge/comparison-section";
import { DeepCarouselSection } from "@/src/components/knowledge/deep-carousel-section";
import { KnowledgeGraphSection } from "@/src/components/knowledge/knowledge-graph-section";
import { KnowledgeHero } from "@/src/components/knowledge/knowledge-hero";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  title: "What Murph knows",
  description:
    "Why Murph beats a general chatbot for health: open health skills built from current research and kept up to date, evidence graded for quality, your own data and context, and deep coverage of sleep, food, training, sauna, and more.",
  alternates: {
    canonical: "/knowledge",
  },
  openGraph: {
    description:
      "Open health skills built from thousands of graded studies and kept up to date, across sleep, food, training, sauna, recovery, and more.",
    type: "website",
  },
});

function ClosingCta() {
  return (
    <section className="bg-[#f5f0e8] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 border-t border-[#c4a882]/30 pt-14 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
            Get started
          </span>
          <h2 className="mt-5 max-w-[18ch] font-serif text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#2d3436]">
            Start with whatever you&rsquo;re working on.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[0.9375rem] leading-[1.7] text-[#635a48]">
            Text Murph a question, a meal photo, or a goal. It answers from
            current research, remembers what you tell it, and checks back in.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <Link
            className="inline-flex items-center gap-2 rounded-full bg-[#2d3436] px-5 py-2.5 text-[0.875rem] font-medium text-[#f5f0e8] transition-colors hover:bg-[#3a4044]"
            href="/"
          >
            Start with Murph
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            className="text-[0.8125rem] text-[#736a58] underline-offset-4 hover:underline"
            href="/changelog"
          >
            New skills and research land every week
          </Link>
        </div>
      </div>
    </section>
  );
}

export default async function KnowledgePage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        <StickyNav
          authenticated={authenticated}
          githubStarCount={githubStarCount}
          preloadAuthPanel
        />
        <KnowledgeHero />
        <ComparisonSection />
        <DeepCarouselSection />
        <KnowledgeGraphSection />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
