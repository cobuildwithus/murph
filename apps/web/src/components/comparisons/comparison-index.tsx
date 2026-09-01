import Link from "next/link";

import {
  ComparisonDirectory,
  type ComparisonDirectoryItem,
} from "@/src/components/comparisons/comparison-directory";
import {
  formatComparisonDate,
  type ComparisonEntry,
} from "@/src/lib/comparisons/types";

export function ComparisonIndex({ comparisons }: { comparisons: readonly ComparisonEntry[] }) {
  const lastVerified = comparisons.reduce(
    (latest, comparison) =>
      comparison.lastVerified > latest ? comparison.lastVerified : latest,
    comparisons[0]?.lastVerified ?? "2026-08-30",
  );
  const directoryItems: ComparisonDirectoryItem[] = comparisons.map(
    ({ aliases, category, headline, name, slug }) => ({
      aliases,
      category,
      headline,
      name,
      slug,
    }),
  );

  return (
    <main className="bg-[#f5f0e8] text-[#2d3436]">
      <header className="bg-[#2a2520] px-5 pb-14 pt-14 text-[#f5f0e8] sm:px-8 sm:pb-18 sm:pt-18 lg:px-12 lg:pb-20 lg:pt-20">
        <div className="mx-auto max-w-[1080px]">
          <h1 className="max-w-[11ch] text-balance font-serif text-[clamp(3.4rem,8vw,6.6rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
            Murph, compared clearly.
          </h1>
          <p className="mt-7 max-w-[61ch] text-pretty text-[1rem] leading-7 text-[#f5f0e8]/72 sm:text-[1.08rem]">
            Murph is a personal health assistant in familiar messaging. See where it overlaps with the tools you know—and where it does not.
          </p>
          <p className="mt-10 border-t border-[#c4a882]/35 pt-5 text-[0.74rem] leading-5 text-[#f5f0e8]/55">
            {comparisons.length} comparison guides
            {" · "}Official-source desk research
            {" · "}Reviewed <time dateTime={lastVerified}>{formatComparisonDate(lastVerified)}</time>
            {" · "}No affiliate links
          </p>
        </div>
      </header>

      <div className="px-5 py-14 sm:px-8 sm:py-18 lg:px-12 lg:py-22">
        <div className="mx-auto grid min-w-0 max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-18">
          <ComparisonDirectory comparisons={directoryItems} />

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <h2 className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              No universal winner
            </h2>
            <p className="max-w-[66ch] text-[0.98rem] leading-7 text-[#4d4533]">
              Wearables measure, clinicians diagnose and treat, and focused apps may go deeper on one job. Murph connects those pieces to decisions and follow-through. These guides make that boundary explicit.
            </p>
          </section>

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16" id="methodology">
            <h2 className="font-serif text-[clamp(1.6rem,3vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              How these guides are made
            </h2>
            <div className="grid max-w-[66ch] gap-4 text-[0.92rem] leading-7 text-[#4d4533]">
              <p>
                Product facts come from first-party product, support, pricing, legal, or storefront material. We label inference and do not claim hands-on testing that did not happen.
              </p>
              <p>
                Details change, so every guide shows its review date and sources. Murph claims follow our{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/about">
                  public product description
                </Link>
                {" "}and{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/legal/health-ai-safety-disclosure">
                  health AI safety disclosure
                </Link>
                . If a cited product changes, please{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/contact">
                  send a correction
                </Link>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
