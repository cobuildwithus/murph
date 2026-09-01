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

const SECTION_HEADING =
  "font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]";

function HeroLockup({ comparison }: { comparison: ComparisonEntry }) {
  const tile =
    "flex size-[84px] shrink-0 items-center justify-center rounded-2xl border border-[#c4a882]/30 bg-[#f5f0e8] p-4 sm:size-[104px] sm:rounded-[1.25rem] sm:p-5 lg:size-[124px] lg:p-6";

  return (
    <div
      aria-hidden="true"
      className="order-first flex items-center gap-3 sm:gap-4 lg:order-none lg:justify-self-end"
    >
      <span className={tile}>
        <Image
          alt=""
          className="h-auto w-full max-w-[72%]"
          height={44}
          priority
          src="/logo-mark.svg"
          width={65}
        />
      </span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#c4a882]/45 font-mono text-[0.58rem] font-medium uppercase tracking-[0.1em] text-[#c4a882] sm:size-9 sm:text-[0.62rem]">
        vs
      </span>
      <ComparisonLogo
        className={`${tile} text-[#2d3436]`}
        decorative
        imageClassName="max-h-10 sm:max-h-12 lg:max-h-14"
        name={comparison.name}
        priority
        slug={comparison.slug}
      />
    </div>
  );
}

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
        className="bg-[#2a2520] px-5 pb-12 pt-28 text-[#f5f0e8] sm:px-8 sm:pb-14 sm:pt-32 lg:px-12 lg:pb-16 lg:pt-36"
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

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
                {RELATIONSHIP_LABELS[comparison.relationship]}
              </p>
              <h1
                className="mt-4 max-w-[16ch] [overflow-wrap:anywhere] text-balance font-serif text-[clamp(2.5rem,5.5vw,4.25rem)] font-semibold leading-[0.96] tracking-[-0.04em]"
                id={titleId}
              >
                Murph vs {comparison.name}
              </h1>
              <p className="mt-5 max-w-[36ch] text-balance font-serif text-[clamp(1.2rem,2.1vw,1.55rem)] font-medium leading-[1.3] tracking-[-0.015em] text-[#f5f0e8]/80">
                {comparison.headline}
              </p>
            </div>
            <HeroLockup comparison={comparison} />
          </div>

          <p className="mt-10 border-t border-[#c4a882]/35 pt-5 text-[0.74rem] leading-5 text-[#f5f0e8]/55">
            Reviewed <time dateTime={comparison.lastVerified}>{reviewedLabel}</time>
            {" · "}{comparison.sources.length} official {comparison.name} sources
            {" · "}No affiliate links
            {" · "}
            <Link className="underline decoration-[#c4a882]/50 underline-offset-4 hover:text-[#f5f0e8]" href="/compare#methodology">
              How we research
            </Link>
          </p>
        </div>
      </header>

      <div className="bg-[#f5f0e8] px-5 py-14 text-[#2d3436] sm:px-8 sm:py-16 lg:px-12 lg:py-20">
        <div className="mx-auto grid max-w-[1080px] gap-16 lg:gap-20">
          <section aria-labelledby={`${titleId}-fit`} className="grid gap-7">
            <h2 className={SECTION_HEADING} id={`${titleId}-fit`}>
              The short answer
            </h2>

            <div className="grid border-y border-[#c4a882]/35 md:grid-cols-2">
              <div className="py-6 md:pr-8">
                <p className="text-[0.82rem] font-semibold text-[#5a6e32]">
                  Choose Murph
                </p>
                <p className="mt-2.5 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseMurph}
                </p>
              </div>
              <div className="border-t border-[#c4a882]/35 py-6 md:border-l md:border-t-0 md:pl-8">
                <p className="text-[0.82rem] font-semibold text-[#736a58]">
                  Choose {comparison.name}
                </p>
                <p className="mt-2.5 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseCompetitor}
                </p>
              </div>
            </div>

            {comparison.useTogether ? (
              <details className="group -mt-7 border-b border-[#c4a882]/35">
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

          <section aria-labelledby={`${titleId}-table`} className="grid gap-6">
            <h2 className={SECTION_HEADING} id={`${titleId}-table`}>
              Murph vs {comparison.name} at a glance
            </h2>
            <ComparisonTable comparison={comparison} />
          </section>

          <section aria-labelledby={`${titleId}-tradeoffs`} className="grid gap-6 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <h2 className={SECTION_HEADING} id={`${titleId}-tradeoffs`}>
              Material tradeoffs
            </h2>
            <ul className="divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
              {comparison.tradeoffs.map((tradeoff) => (
                <li className="py-5 text-[0.95rem] leading-7 text-[#4d4533]" key={tradeoff}>
                  {tradeoff}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`${titleId}-faq`} className="grid gap-7">
            <h2 className={SECTION_HEADING} id={`${titleId}-faq`}>
              Common questions about Murph and {comparison.name}
            </h2>
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

          <section aria-labelledby={sourceSectionId} className="grid gap-6 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <h2 className={SECTION_HEADING} id={sourceSectionId}>
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
            <section aria-labelledby={`${titleId}-related`} className="grid gap-6">
              <h2 className={SECTION_HEADING} id={`${titleId}-related`}>
                Compare Murph with similar tools
              </h2>
              <ul className="grid border-y border-[#c4a882]/35 md:grid-cols-2">
                {related.map((entry, index) => (
                  <li
                    className={`border-[#c4a882]/35 ${index > 0 ? "border-t md:border-t-0" : ""} ${index >= 2 ? "md:border-t" : ""} ${index % 2 === 1 ? "md:border-l" : ""}`}
                    key={entry.slug}
                  >
                    <Link
                      className="group flex items-center gap-4 py-4 md:px-5 md:py-5"
                      href={`/compare/murph-vs-${entry.slug}`}
                    >
                      <ComparisonLogo
                        className="size-11 shrink-0 rounded-xl border border-[#c4a882]/30 p-2 text-[#2d3436]"
                        decorative
                        imageClassName="max-h-7"
                        name={entry.name}
                        slug={entry.slug}
                      />
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-4 font-serif text-[1.25rem] font-semibold leading-tight tracking-[-0.02em] transition-colors group-hover:text-[#5a6e32]">
                        <span className="min-w-0 [overflow-wrap:anywhere]">Murph vs {entry.name}</span>
                        <span aria-hidden="true" className="shrink-0 font-sans text-lg font-normal text-[#736a58] transition-transform group-hover:translate-x-1">→</span>
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
