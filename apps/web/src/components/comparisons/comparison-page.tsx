import Link from "next/link";

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
  const competitorNameParts = comparison.name.split(
    /(?<=[a-z0-9])(?=[A-Z][a-z])/u,
  );

  return (
    <article aria-labelledby={titleId}>
      <header className="bg-[#2a2520] px-5 pb-14 pt-14 text-[#f5f0e8] sm:px-8 sm:pb-18 sm:pt-18 lg:px-12 lg:pb-20 lg:pt-20">
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

          <div className="mt-10 grid gap-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)] lg:items-end lg:gap-18">
            <div>
              <h1
                className="max-w-[11ch] [overflow-wrap:anywhere] text-balance font-serif text-[clamp(3.15rem,7vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.045em]"
                id={titleId}
              >
                Murph vs{" "}
                {competitorNameParts.map((part, index) => (
                  <span key={`${part}-${index}`}>
                    {index > 0 ? <wbr /> : null}
                    {part}
                  </span>
                ))}
              </h1>
              <p className="mt-6 max-w-[46ch] text-[0.95rem] leading-7 text-[#f5f0e8]/65">
                Murph is a personal health assistant that works in familiar messaging.
              </p>
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
          <section aria-labelledby={`${titleId}-answer`} className="grid gap-7 border-b border-[#c4a882]/35 pb-14 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-18">
            <div>
              <h2
                className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-answer`}
              >
                Should you switch to Murph?
              </h2>
            </div>
            <div className="max-w-[66ch]">
              <p className="text-pretty font-serif text-[clamp(1.25rem,2vw,1.55rem)] font-semibold leading-[1.42] tracking-[-0.012em] text-[#2d3436]">
                {comparison.bottomLine}
              </p>
            </div>
          </section>

          <section aria-labelledby={`${titleId}-fit`} className="grid gap-8">
            <div className="max-w-[62ch]">
              <h2
                className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-fit`}
              >
                Which is a better fit?
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
              <div className="border-l-2 border-[#7a8c6e] bg-[#ebdfc6]/60 px-6 py-5">
                <p className="text-[0.82rem] font-semibold text-[#5a6e32]">
                  Using both
                </p>
                <p className="mt-2 max-w-[72ch] text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.useTogether}
                </p>
              </div>
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
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-lg font-normal leading-none text-[#736a58] transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
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

          <section className="bg-[#2a2520] px-7 py-9 text-[#f5f0e8] sm:px-10 sm:py-11">
            <div className="flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-[58ch]">
                <h2 className="font-serif text-[clamp(1.7rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
                  Keep what works. Bring the whole picture together.
                </h2>
                <p className="mt-4 text-[0.92rem] leading-7 text-[#f5f0e8]/70">
                  Murph helps connect the health context you already have, decide what to try next, and keep the practical work moving.
                </p>
              </div>
              <Link
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[#5a6e32] px-6 text-sm font-semibold text-[#f5f0e8] transition-colors hover:bg-[#485928]"
                href="/#pricing"
              >
                Meet Murph
              </Link>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
