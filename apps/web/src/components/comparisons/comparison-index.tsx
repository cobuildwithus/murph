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
  const citationCount = comparisons.reduce(
    (total, comparison) => total + comparison.sources.length,
    0,
  );
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
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
            Murph comparison guides
          </p>
          <div className="mt-5 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end lg:gap-18">
            <div>
              <h1 className="max-w-[11ch] text-balance font-serif text-[clamp(3.4rem,8vw,6.6rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
                Murph, compared clearly.
              </h1>
              <p className="mt-7 max-w-[61ch] text-pretty text-[1rem] leading-7 text-[#f5f0e8]/72 sm:text-[1.08rem]">
                Find out where Murph overlaps with the health tools you know, where it does not, and when using both makes more sense than choosing one.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6 border-t border-[#c4a882]/45 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div>
                <p className="font-serif text-[clamp(3rem,6vw,4.8rem)] font-semibold leading-none tracking-[-0.05em]">
                  {comparisons.length}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#c4a882]">
                  comparison guides
                </p>
              </div>
              <div>
                <p className="font-serif text-[clamp(3rem,6vw,4.8rem)] font-semibold leading-none tracking-[-0.05em]">
                  {citationCount}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#c4a882]">
                  official-source citations
                </p>
              </div>
            </div>
          </div>

          <dl className="mt-11 flex flex-wrap gap-x-8 gap-y-3 border-t border-[#c4a882]/35 pt-5 text-[0.72rem] text-[#f5f0e8]/60">
            <div className="flex gap-2">
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Method</dt>
              <dd>Official-source desk research</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Reviewed</dt>
              <dd>
                <time dateTime={lastVerified}>{formatComparisonDate(lastVerified)}</time>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Commercial</dt>
              <dd>No affiliate links</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="px-5 py-14 sm:px-8 sm:py-18 lg:px-12 lg:py-22">
        <div className="mx-auto grid min-w-0 max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-18">
          <ComparisonDirectory comparisons={directoryItems} />

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <h2 className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              No universal winner
            </h2>
            <div className="grid max-w-[66ch] gap-4 text-[0.98rem] leading-7 text-[#4d4533]">
              <p>
                A wearable can measure your body better than Murph because Murph is not a wearable. A clinician can diagnose and treat in ways Murph cannot. A focused training or nutrition app may go deeper on its one job.
              </p>
              <p>
                Murph is strongest when the problem is connecting those separate pieces, remembering the context behind them, deciding what to try, and following through over time. These guides make that boundary explicit.
              </p>
            </div>
          </section>

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16" id="methodology">
            <h2 className="font-serif text-[clamp(1.6rem,3vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              How these guides are made
            </h2>
            <div className="grid max-w-[66ch] gap-4 text-[0.92rem] leading-7 text-[#4d4533]">
              <p>
                Every product fact comes from current first-party product, support, pricing, legal, or storefront material. We label inference, avoid outcome rankings, and do not claim hands-on testing that did not happen.
              </p>
              <p>
                Prices, availability, integrations, and regulated features change quickly. Each guide shows its review date and links to the underlying sources so you can check the current position before buying or making a health decision.
              </p>
              <p>
                Murph claims follow our{" "}
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
