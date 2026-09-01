import Link from "next/link";
import Image from "next/image";
import { ChevronDown } from "lucide-react";

import { ComparisonLogo } from "@/src/components/comparisons/comparison-logo";
import { ComparisonTable } from "@/src/components/comparisons/comparison-table";
import {
  formatComparisonDate,
  type ComparisonEntry,
} from "@/src/lib/comparisons/types";

const RELATIONSHIP_LABELS: Record<ComparisonEntry["relationship"], string> = {
  alternative: "Meaningful overlap",
  complement: "Usually complementary",
  "different-role": "Different primary job",
};

export function ComparisonArticle({
  comparison,
  related,
}: {
  comparison: ComparisonEntry;
  related: readonly ComparisonEntry[];
}) {
  const titleId = `comparison-${comparison.slug}`;
  const sourceSectionId = `${titleId}-sources`;
  const reviewedLabel = formatComparisonDate(comparison.lastVerified);

  return (
    <article aria-labelledby={titleId}>
      <header
        className="bg-[#2a2520] px-5 pb-14 pt-28 text-[#f5f0e8] sm:px-8 sm:pb-18 sm:pt-32 lg:px-12 lg:pb-20 lg:pt-36"
        data-comparison-hero
      >
        <div className="mx-auto max-w-[1080px]">
          <nav aria-label="Breadcrumb" className="text-[0.78rem] text-[#f5f0e8]/55">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link className="transition-colors hover:text-[#f5f0e8]" href="/">
                  Murph
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link className="transition-colors hover:text-[#f5f0e8]" href="/compare">
                  Comparisons
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-[#f5f0e8]/65">
                {comparison.name}
              </li>
            </ol>
          </nav>

          <div className="mt-9 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:items-end lg:gap-16">
            <div>
              <div className="flex items-center gap-2 sm:gap-4" aria-hidden="true">
                <span className="flex h-[clamp(68px,22vw,76px)] w-[clamp(105px,34vw,132px)] items-center justify-center rounded-2xl border border-[#c4a882]/25 bg-[#f5f0e8] px-4 sm:h-[88px] sm:w-[156px] sm:px-5">
                  <Image
                    alt=""
                    className="h-auto w-full"
                    height={24}
                    priority
                    src="/logo.svg"
                    width={107}
                  />
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#c4a882]/40 font-mono text-[0.58rem] font-semibold tracking-[0.08em] text-[#c4a882] sm:size-9 sm:text-[0.62rem]">
                  VS
                </span>
                <ComparisonLogo
                  className="h-[clamp(68px,22vw,76px)] w-[clamp(105px,34vw,132px)] rounded-2xl border border-[#c4a882]/25 bg-[#f5f0e8] p-3.5 text-[#2d3436] sm:h-[88px] sm:w-[156px] sm:p-5"
                  decorative
                  imageClassName="max-h-11"
                  name={comparison.name}
                  priority
                  slug={comparison.slug}
                />
              </div>
              <h1
                className="mt-7 max-w-[15ch] [overflow-wrap:anywhere] text-balance font-serif text-[clamp(2.7rem,6vw,4.8rem)] font-semibold leading-[0.94] tracking-[-0.04em]"
                id={titleId}
              >
                Murph vs {comparison.name}
              </h1>
            </div>

            <div className="border-t border-[#c4a882]/45 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
              <p className="text-[0.8rem] font-medium text-[#c4a882]">
                {RELATIONSHIP_LABELS[comparison.relationship]}
              </p>
              <p className="mt-4 text-balance font-serif text-[clamp(1.55rem,3vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f5f0e8]">
                {comparison.headline}
              </p>
            </div>
          </div>

          <p className="mt-10 border-t border-[#c4a882]/35 pt-5 text-[0.74rem] leading-5 text-[#f5f0e8]/55">
            Reviewed <time dateTime={comparison.lastVerified}>{reviewedLabel}</time>
            {" · "}{comparison.sources.length} official competitor sources
            {" · "}No affiliate links
            {" · "}
            <Link className="underline decoration-[#c4a882]/50 underline-offset-4 hover:text-[#f5f0e8]" href="/compare#methodology">
              How we research
            </Link>
          </p>
        </div>
      </header>

      <div className="bg-[#f5f0e8] px-5 py-14 text-[#2d3436] sm:px-8 sm:py-18 lg:px-12 lg:py-22">
        <div className="mx-auto grid max-w-[1080px] gap-16 lg:gap-22">
          <section aria-labelledby={`${titleId}-fit`} className="grid gap-8">
            <div className="max-w-[62ch]">
              <h2
                className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-fit`}
              >
                The short answer
              </h2>
            </div>

            <div className="grid border-y border-[#c4a882]/35 md:grid-cols-2">
              <div className="py-7 md:pr-8">
                <p className="text-[0.82rem] font-semibold text-[#5a6e32]">
                  Choose Murph
                </p>
                <p className="mt-3 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseMurph}
                </p>
              </div>
              <div className="border-t border-[#c4a882]/35 py-7 md:border-l md:border-t-0 md:pl-8">
                <p className="text-[0.82rem] font-semibold text-[#736a58]">
                  Choose {comparison.name}
                </p>
                <p className="mt-3 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseCompetitor}
                </p>
              </div>
            </div>

            {comparison.useTogether ? (
              <details className="group border-b border-[#c4a882]/35">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[0.86rem] font-semibold text-[#5a6e32] marker:content-none [&::-webkit-details-marker]:hidden">
                  Can Murph and {comparison.name} work together?
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="max-w-[72ch] pb-5 pr-8 text-[0.92rem] leading-7 text-[#4d4533]">
                  {comparison.useTogether}
                </p>
              </details>
            ) : null}
          </section>

          <section aria-labelledby={`${titleId}-table`} className="grid gap-7">
            <div className="max-w-[68ch]">
              <h2
                className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-table`}
              >
                Murph vs {comparison.name} at a glance
              </h2>
            </div>
            <ComparisonTable comparison={comparison} />
          </section>

          <section aria-labelledby={`${titleId}-tradeoffs`} className="grid gap-7 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <h2
                className="font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-tradeoffs`}
              >
                Material tradeoffs
              </h2>
            </div>
            <ul className="divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
              {comparison.tradeoffs.map((tradeoff) => (
                <li className="py-5 text-[0.95rem] leading-7 text-[#4d4533]" key={tradeoff}>
                  {tradeoff}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`${titleId}-faq`} className="grid gap-8">
            <div>
              <h2
                className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-faq`}
              >
                Common questions about Murph and {comparison.name}
              </h2>
            </div>
            <div className="divide-y divide-[#c4a882]/35 border-y border-[#c4a882]/35">
              {comparison.faqs.map((faq) => (
                <details className="group" key={faq.question}>
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 marker:content-none [&::-webkit-details-marker]:hidden">
                    <h3 className="font-serif text-[1.1rem] font-semibold leading-snug transition-colors group-hover:text-[#5a6e32]">
                      {faq.question}
                    </h3>
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 text-[#736a58] transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="max-w-[72ch] pb-6 pr-10 text-[0.95rem] leading-7 text-[#4d4533]">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <section aria-labelledby={sourceSectionId} className="grid gap-7 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <h2
                className="font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={sourceSectionId}
              >
                Official sources
              </h2>
              <p className="mt-4 max-w-[34ch] text-[0.84rem] leading-6 text-[#736a58]">
                Reviewed <time dateTime={comparison.lastVerified}>{reviewedLabel}</time>. This is official-source desk research, not hands-on product testing. Pricing and availability can change.
              </p>
              <p className="mt-3 max-w-[34ch] text-[0.84rem] leading-6 text-[#736a58]">
                Found an outdated detail?{" "}
                <Link
                  className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]"
                  href="/contact"
                >
                  Send a correction
                </Link>
                .
              </p>
            </div>
            <ol className="divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
              <li className="grid scroll-mt-24 grid-cols-[2rem_1fr] gap-3 py-4" id={`${titleId}-source-01`}>
                <span className="font-mono text-[10px] leading-6 text-[#736a58]">01</span>
                <Link
                  className="w-fit text-[0.9rem] leading-6 text-[#2d3436] underline decoration-[#c4a882] underline-offset-4 transition-colors hover:text-[#5a6e32]"
                  href="/"
                >
                  Murph public product description
                </Link>
              </li>
              <li className="grid scroll-mt-24 grid-cols-[2rem_1fr] gap-3 py-4" id={`${titleId}-source-02`}>
                <span className="font-mono text-[10px] leading-6 text-[#736a58]">02</span>
                <Link
                  className="w-fit text-[0.9rem] leading-6 text-[#2d3436] underline decoration-[#c4a882] underline-offset-4 transition-colors hover:text-[#5a6e32]"
                  href="/legal/health-ai-safety-disclosure"
                >
                  Murph health AI safety disclosure
                </Link>
              </li>
              {comparison.sources.map((source, index) => (
                <li
                  className="grid scroll-mt-24 grid-cols-[2rem_1fr] gap-3 py-4"
                  id={`${titleId}-source-${String(index + 3).padStart(2, "0")}`}
                  key={source.url}
                >
                  <span className="font-mono text-[10px] leading-6 text-[#736a58]">
                    {String(index + 3).padStart(2, "0")}
                  </span>
                  <a
                    className="w-fit text-[0.9rem] leading-6 text-[#2d3436] underline decoration-[#c4a882] underline-offset-4 transition-colors hover:text-[#5a6e32]"
                    href={source.url}
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ol>
          </section>

          {related.length > 0 ? (
            <section aria-labelledby={`${titleId}-related`} className="grid gap-7">
              <div>
                <h2
                  className="font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                  id={`${titleId}-related`}
                >
                  Compare Murph with similar tools
                </h2>
              </div>
              <ul className="grid border-y border-[#c4a882]/35 md:grid-cols-2">
                {related.map((entry, index) => (
                  <li
                    className={`border-[#c4a882]/35 ${index > 0 ? "border-t md:border-t-0" : ""} ${index % 2 === 1 ? "md:border-l" : ""}`}
                    key={entry.slug}
                  >
                    <Link
                      className="group block px-1 py-6 md:px-6"
                      href={`/compare/murph-vs-${entry.slug}`}
                    >
                      <span className="flex items-center justify-between gap-4 font-serif text-[1.4rem] font-semibold transition-colors group-hover:text-[#5a6e32]">
                        {entry.name}
                        <span aria-hidden="true" className="font-sans text-lg font-normal text-[#736a58] transition-transform group-hover:translate-x-1">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}
