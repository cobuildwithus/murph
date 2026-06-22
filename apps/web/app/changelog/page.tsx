import type { Metadata } from "next";
import { Link2 } from "lucide-react";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import {
  type ChangelogItem,
  listChangelogEditions,
} from "@/src/lib/changelog";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const DESCRIPTION =
  "See what is new in Murph, why it matters, and the simplest way to try each update.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Changelog · Murph",
  description: DESCRIPTION,
  alternates: {
    canonical: "/changelog",
  },
  openGraph: {
    type: "article",
  },
});

export default async function ChangelogPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const editions = listChangelogEditions();

  return (
    <>
      <main className="min-h-dvh bg-[#f5f0e8] text-[#2d3436] antialiased">
        <StickyNav authenticated={authenticated} githubStarCount={githubStarCount} />
        <section className="bg-[#1f241c] px-6 pt-32 pb-20 text-[#f5f0e8] sm:px-10 sm:pt-36 lg:px-16 lg:pt-44 lg:pb-28">
          <div className="mx-auto max-w-[1080px]">
            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="h-px w-12 bg-[#c4a882]/60" />
              <p className="font-mono text-[10px] font-medium text-[#c4a882] uppercase">
                Changelog
              </p>
            </div>
            <h1 className="mt-8 max-w-[14ch] font-serif text-5xl font-semibold leading-[1.05] text-balance sm:text-6xl lg:text-7xl">
              New in Murph.
            </h1>
            <p className="mt-8 max-w-[58ch] text-base leading-[1.75] text-[#f5f0e8]/70 sm:text-[17px]">
              Product updates in plain language, with a concrete way to try the
              ones that matter to you.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-[1080px] px-6 py-20 sm:px-10 sm:py-24 lg:px-0 lg:py-28">
          {editions.map((edition, editionIndex) => {
            const features = edition.items.filter((item) => item.kind === "feature");
            const improvements = edition.items.filter(
              (item) => item.kind === "improvement",
            );

            return (
              <section
                key={edition.id}
                aria-labelledby={`edition-${edition.id}`}
                className={editionIndex === 0 ? "" : "mt-24 border-t border-[#c4a882]/35 pt-24"}
              >
                <div className="grid gap-8 lg:grid-cols-[220px_1fr] lg:gap-14">
                  <div>
                    <time
                      className="font-mono text-[10px] font-medium text-[#736a58] uppercase"
                      dateTime={edition.publishedOn}
                    >
                      {formatEditionDate(edition.publishedOn)}
                    </time>
                    <h2
                      id={`edition-${edition.id}`}
                      className="mt-4 font-serif text-3xl font-semibold leading-[1.15]"
                    >
                      {edition.title}
                    </h2>
                    <p className="mt-4 text-[15px] leading-[1.65] text-[#5f584b]">
                      {edition.summary}
                    </p>
                  </div>

                  <div>
                    {features.length > 0 ? (
                      <ItemGroup label="New features" items={features} />
                    ) : null}
                    {improvements.length > 0 ? (
                      <div className={features.length > 0 ? "mt-12" : ""}>
                        <ItemGroup label="Under the hood" items={improvements} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function ItemGroup({ label, items }: { label: string; items: readonly ChangelogItem[] }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium text-[#3a4a1e] uppercase">
        {label}
      </p>
      <div className="mt-5 grid gap-5">
        {items.map((item) => (
          <article
            key={item.id}
            id={item.id}
            className="group scroll-mt-28 rounded-2xl border border-[#c4a882]/35 bg-[#fffcf6]/85 p-6 sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-medium text-[#736a58] uppercase">
                  {item.kind === "feature" ? "Feature" : "Improvement"}
                </p>
                <h3 className="mt-2 font-serif text-2xl font-semibold leading-[1.15] sm:text-[1.6rem]">
                  {item.title}
                </h3>
              </div>
              <a
                aria-label={`Permalink to ${item.title}`}
                className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#736a58] opacity-70 transition-[background-color,color,opacity] hover:bg-[#c4a882]/15 hover:text-[#3a4a1e] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a6e32]/40 group-hover:opacity-100"
                href={`#${item.id}`}
              >
                <Link2 aria-hidden="true" className="h-4 w-4" />
              </a>
            </div>
            <p className="mt-5 max-w-[66ch] text-base leading-[1.7] text-[#4d453b]">
              {item.summary}
            </p>
            {item.details ? (
              <p className="mt-3 max-w-[66ch] text-[15px] leading-[1.65] text-[#736a58]">
                {item.details}
              </p>
            ) : null}
            {item.tryIt ? <TryIt item={item} /> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function TryIt({ item }: { item: ChangelogItem }) {
  const tryIt = item.tryIt;
  if (!tryIt) {
    return null;
  }
  return (
    <div className="mt-6 border-t border-[#c4a882]/30 pt-5">
      <p className="font-mono text-[10px] font-medium text-[#3a4a1e] uppercase">
        Try it
      </p>
      {tryIt.prompt ? (
        <p className="mt-2 max-w-[60ch] font-mono text-[13px] leading-[1.6] text-[#344026]">
          “{tryIt.prompt}”
        </p>
      ) : null}
	      {tryIt.href ? (
	        <a
	          className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-[#3a4a1e] underline decoration-[#83945f]/60 underline-offset-4 hover:decoration-[#3a4a1e]"
	          href={tryIt.href}
	        >
          {tryIt.label}
        </a>
      ) : (
        <p className="mt-2 text-[13px] text-[#53613d]">{tryIt.label}</p>
      )}
    </div>
  );
}

function formatEditionDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}
