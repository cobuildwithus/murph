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

export default function MurphSafeSearchPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-4xl px-5 pt-24 pb-16 sm:px-8 sm:pt-32 sm:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">
            Is it Murph Safe?
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-serif text-2xl leading-tight tracking-[-0.02em] text-muted-foreground sm:text-3xl">
            What’s in it, what’s been tested, and what we still don’t know.
          </p>
        </div>

        <div className="mt-10">
          <MurphSafeSearchClient />
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 pb-20 text-center sm:px-8 sm:pb-24">
        <a
          href="/api/public/v1/openapi.json"
          referrerPolicy="no-referrer"
          className="inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          View the API specification
        </a>
      </section>
    </main>
  );
}
