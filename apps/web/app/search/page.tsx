import type { Metadata } from "next";

import { MurphSafeSearchClient } from "@/src/components/murph-safe/search-client";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

const SEARCH_DESCRIPTION =
  "Search food and supplement ingredients, nutrition, linked product tests, and known evidence gaps with Murph Safe.";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    alternates: { canonical: "/search" },
    description: SEARCH_DESCRIPTION,
    openGraph: { type: "website" },
    title: "Murph Safe | Food, supplement, and product test data",
  }),
  robots: { follow: true, index: true },
};

const EVIDENCE_BANDS = [
  {
    body: "Ingredients, serving sizes, and nutrition facts when the source provides them.",
    heading: "LABEL CONTENTS",
  },
  {
    body: "Reported measurements linked by UPC, source identity, or manual product review.",
    heading: "PRODUCT TESTS",
  },
  {
    body: "Missing tests, lots, methods, dates, and compatible screening thresholds stay visible.",
    heading: "KNOWN GAPS",
  },
] as const;

export default function MurphSafeSearchPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-6xl px-5 pt-16 pb-14 sm:px-8 sm:pt-24 sm:pb-20">
        <div className="max-w-4xl">
          <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
            FOOD · SUPPLEMENTS · PRODUCT TESTS
          </p>
          <h1 className="mt-5 font-serif text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">
            Is it Murph Safe?
          </h1>
          <p className="mt-6 max-w-3xl font-serif text-2xl leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
            What’s in it, what’s been tested, and what we still don’t know.
          </p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            Search a food or supplement to see its ingredients, nutrition,
            linked product tests, and the evidence that’s still missing.
          </p>
        </div>

        <div className="max-w-4xl">
          <MurphSafeSearchClient />
        </div>
      </section>

      <section aria-label="What Murph Safe shows" className="border-y border-border">
        <div className="mx-auto grid w-full max-w-6xl px-5 sm:px-8 md:grid-cols-3">
          {EVIDENCE_BANDS.map((band, index) => (
            <article
              key={band.heading}
              className={`py-8 md:min-h-48 md:py-10 ${index === 0 ? "" : "border-t border-border md:border-t-0 md:border-l md:pl-8"} ${index === EVIDENCE_BANDS.length - 1 ? "" : "md:pr-8"}`}
            >
              <h2 className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
                {band.heading}
              </h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-foreground sm:text-base">
                {band.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="agents-heading" className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-14 sm:px-8 sm:py-20 md:grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)] md:items-start">
        <div>
          <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
            FOR AGENTS
          </p>
          <h2 id="agents-heading" className="mt-3 font-serif text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
            One dataset. One contract.
          </h2>
        </div>
        <div className="max-w-2xl">
          <p className="text-base leading-7 text-muted-foreground">
            This search page uses the same normalized API available to agents.
            Read the OpenAPI specification for request and response schemas.
          </p>
          <a
            href="/api/public/v1/openapi.json"
            referrerPolicy="no-referrer"
            className="mt-5 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View the API specification
          </a>
        </div>
      </section>
    </main>
  );
}
