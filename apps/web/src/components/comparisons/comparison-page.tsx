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

  return (
    <article aria-labelledby={titleId}>
      <header className="bg-[#2a2520] px-5 pb-14 pt-14 text-[#f5f0e8] sm:px-8 sm:pb-18 sm:pt-18 lg:px-12 lg:pb-20 lg:pt-20">
        <div className="mx-auto max-w-[1080px]">
          <nav aria-label="Breadcrumb" className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#c4a882]">
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
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
                Murph comparison guide
              </p>
              <h1
                className="mt-5 max-w-[11ch] text-balance font-serif text-[clamp(3.15rem,7vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.045em]"
                id={titleId}
              >
                Murph vs {comparison.name}
              </h1>
            </div>

            <div className="border-t border-[#c4a882]/45 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#c4a882]">
                The relationship · {RELATIONSHIP_LABELS[comparison.relationship]}
              </p>
              <p className="mt-4 text-balance font-serif text-[clamp(1.55rem,3vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f5f0e8]">
                {comparison.headline}
              </p>
            </div>
          </div>

          <dl className="mt-11 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[#c4a882]/35 pt-5 text-[0.72rem] leading-5 text-[#f5f0e8]/60 sm:grid-cols-4 sm:gap-x-8">
            <div>
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Published by</dt>
              <dd className="mt-1">
                <Link className="underline decoration-[#c4a882]/50 underline-offset-4 hover:text-[#f5f0e8]" href="/compare#methodology">
                  Murph editorial research
                </Link>
              </dd>
            </div>
            <div>
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Evidence</dt>
              <dd className="mt-1">{comparison.sources.length} competitor sources</dd>
            </div>
            <div>
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Reviewed</dt>
              <dd className="mt-1">
                <time dateTime={comparison.lastVerified}>{reviewedLabel}</time>
              </dd>
            </div>
            <div>
              <dt className="font-mono uppercase tracking-[0.1em] text-[#c4a882]">Commercial</dt>
              <dd className="mt-1">No affiliate links</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="bg-[#f5f0e8] px-5 py-14 text-[#2d3436] sm:px-8 sm:py-18 lg:px-12 lg:py-22">
        <div className="mx-auto grid max-w-[1080px] gap-16 lg:gap-22">
          <section aria-labelledby={`${titleId}-answer`} className="grid gap-7 border-b border-[#c4a882]/35 pb-14 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-18">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#5a6e32]">
                The short answer
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-answer`}
              >
                Should you choose Murph or {comparison.name}?
              </h2>
            </div>
            <div className="max-w-[66ch]">
              <p className="text-pretty font-serif text-[clamp(1.25rem,2vw,1.55rem)] font-semibold leading-[1.42] tracking-[-0.012em] text-[#2d3436]">
                {comparison.bottomLine}
              </p>
              <p className="mt-5 text-[0.98rem] leading-7 text-[#665d4c]">
                {comparison.overview}
              </p>
            </div>
          </section>

          <section aria-labelledby={`${titleId}-fit`} className="grid gap-8">
            <div className="max-w-[62ch]">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                Best fit
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-fit`}
              >
                Start with the job you need done
              </h2>
              <p className="mt-4 text-[0.98rem] leading-7 text-[#4d4533]">
                {comparison.bestFor}
              </p>
            </div>

            <div className="grid border-y border-[#c4a882]/35 md:grid-cols-2">
              <div className="py-7 md:pr-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
                  Choose Murph when
                </p>
                <p className="mt-3 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseMurph}
                </p>
              </div>
              <div className="border-t border-[#c4a882]/35 py-7 md:border-l md:border-t-0 md:pl-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
                  Choose {comparison.name} when
                </p>
                <p className="mt-3 text-[0.95rem] leading-7 text-[#4d4533]">
                  {comparison.chooseCompetitor}
                </p>
              </div>
            </div>

            {comparison.useTogether ? (
              <div className="border-l-2 border-[#7a8c6e] bg-[#ebdfc6]/60 px-6 py-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
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
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                Side by side
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-table`}
              >
                What is actually different
              </h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-[#665d4c]">
                This table compares product shape and current capabilities, not medical outcomes or a universal winner.
              </p>
            </div>
            <ComparisonTable comparison={comparison} />
          </section>

          <section aria-labelledby={`${titleId}-tradeoffs`} className="grid gap-7 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                Look twice
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
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
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                Common questions
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                id={`${titleId}-faq`}
              >
                Murph and {comparison.name}
              </h2>
            </div>
            <div className="divide-y divide-[#c4a882]/35 border-y border-[#c4a882]/35">
              {comparison.faqs.map((faq) => (
                <section className="grid gap-3 py-7 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-12" key={faq.question}>
                  <h3 className="font-serif text-[1.2rem] font-semibold leading-snug">
                    {faq.question}
                  </h3>
                  <p className="text-[0.95rem] leading-7 text-[#4d4533]">
                    {faq.answer}
                  </p>
                </section>
              ))}
            </div>
          </section>

          <section aria-labelledby={sourceSectionId} className="grid gap-7 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                Evidence
              </p>
              <h2
                className="mt-3 font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
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
              <li className="grid grid-cols-[2rem_1fr] gap-3 py-4" id={`${titleId}-source-01`}>
                <span className="font-mono text-[10px] leading-6 text-[#736a58]">01</span>
                <Link
                  className="w-fit text-[0.9rem] leading-6 text-[#2d3436] underline decoration-[#c4a882] underline-offset-4 transition-colors hover:text-[#5a6e32]"
                  href="/"
                >
                  Murph public product description
                </Link>
              </li>
              <li className="grid grid-cols-[2rem_1fr] gap-3 py-4" id={`${titleId}-source-02`}>
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
                  className="grid grid-cols-[2rem_1fr] gap-3 py-4"
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
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#736a58]">
                  Keep comparing
                </p>
                <h2
                  className="mt-3 font-serif text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                  id={`${titleId}-related`}
                >
                  Related Murph comparisons
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-[#736a58]">
                        Murph vs
                      </span>
                      <span className="mt-2 block font-serif text-[1.4rem] font-semibold transition-colors group-hover:text-[#5a6e32]">
                        {entry.name}
                      </span>
                      <span className="mt-2 block text-[0.84rem] leading-6 text-[#665d4c]">
                        {entry.headline}
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
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#c4a882]">
                  The relationship matters
                </p>
                <h2 className="mt-3 font-serif text-[clamp(1.7rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
                  Bring the whole picture into one conversation.
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
