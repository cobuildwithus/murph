import type { ReactNode } from "react";
import { Link2 } from "lucide-react";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import {
  buildChangelogItemPath,
  type ChangelogEdition,
  type ChangelogItem,
} from "@/src/lib/changelog";

import { TryItButton } from "./try-it-button";

export type ResolvedChangelogTryIt = {
  authenticated: boolean;
  label: string;
  options: MurphContactOption[];
  prompt?: string | null;
};

const EMPTY_TRY_IT_BY_ITEM_ID = new Map<string, ResolvedChangelogTryIt>();
const EMPTY_VISUALS: Readonly<Record<string, ReactNode>> = {};

export function ChangelogEditionSection({
  buildItemHref = buildChangelogItemPath,
  edition,
  isFirst = false,
  tryItByItemId = EMPTY_TRY_IT_BY_ITEM_ID,
  visuals = EMPTY_VISUALS,
}: {
  buildItemHref?: (itemId: string) => string;
  edition: ChangelogEdition;
  isFirst?: boolean;
  tryItByItemId?: ReadonlyMap<string, ResolvedChangelogTryIt>;
  visuals?: Readonly<Record<string, ReactNode>>;
}) {
  const features = edition.items.filter((item) => item.kind === "feature");
  const improvements = edition.items.filter(
    (item) => item.kind === "improvement",
  );

  return (
    <section
      aria-labelledby={`edition-${edition.id}`}
      className={isFirst ? "" : "mt-20 border-t border-[#c4a882]/35 pt-20"}
    >
      <div className="grid items-start gap-10 lg:grid-cols-[240px_1fr] lg:gap-16">
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <time
            className="font-mono text-[10px] font-medium text-[#736a58] uppercase tracking-[0.18em]"
            dateTime={edition.publishedOn}
          >
            {formatEditionDate(edition.publishedOn)}
          </time>
          <h2
            id={`edition-${edition.id}`}
            className="mt-3 font-serif text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-balance"
          >
            {edition.title}
          </h2>
          <p className="mt-3 max-w-[36ch] text-[14.5px] leading-[1.6] text-pretty text-[#5f584b]">
            {edition.summary}
          </p>
        </div>

        <div className="min-w-0">
          {features.length > 0 ? (
            <ItemGroup
              items={features}
              label="New features"
              buildItemHref={buildItemHref}
              tryItByItemId={tryItByItemId}
              visuals={visuals}
            />
          ) : null}
          {improvements.length > 0 ? (
            <div className={features.length > 0 ? "mt-10" : ""}>
              <ItemGroup
                items={improvements}
                label="Improvements"
                buildItemHref={buildItemHref}
                tryItByItemId={tryItByItemId}
                visuals={visuals}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ItemGroup({
  buildItemHref,
  items,
  label,
  tryItByItemId,
  visuals,
}: {
  buildItemHref: (itemId: string) => string;
  items: readonly ChangelogItem[];
  label: string;
  tryItByItemId: ReadonlyMap<string, ResolvedChangelogTryIt>;
  visuals: Readonly<Record<string, ReactNode>>;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium text-[#3a4a1e] uppercase tracking-[0.18em]">
        {label}
      </p>
      <div className="mt-4 grid gap-4">
        {items.map((item) => {
          const resolved = tryItByItemId.get(item.id);
          return (
            <article
              key={item.id}
              id={item.id}
              className="group/card relative min-w-0 scroll-mt-28 rounded-2xl border border-[#c4a882]/35 bg-[#fffcf6]/85 p-6 transition-colors duration-200 ease-out hover:border-[#c4a882]/55 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-medium text-[#736a58] uppercase tracking-[0.18em]">
                    {item.kind === "feature" ? "Feature" : "Improvement"}
                  </p>
                  <h3 className="mt-2 font-serif text-[1.5rem] font-semibold leading-[1.15] tracking-tight text-balance sm:text-[1.6rem]">
                    {item.title}
                  </h3>
                </div>
                <a
                  aria-label={`Permalink to ${item.title}`}
                  className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#736a58] opacity-0 transition-[background-color,color,opacity] hover:bg-[#c4a882]/15 hover:text-[#3a4a1e] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a6e32]/40 group-hover/card:opacity-100"
                  href={buildItemHref(item.id)}
                >
                  <Link2 aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-4 max-w-[66ch] text-[15.5px] leading-[1.65] text-pretty text-[#4d453b]">
                {item.summary}
              </p>
              {item.details ? (
                <p className="mt-2.5 max-w-[66ch] text-[14.5px] leading-[1.6] text-pretty text-[#736a58]">
                  {item.details}
                </p>
              ) : null}
              {visuals[item.id] ?? null}
              {item.tryIt && resolved ? (
                <TryIt item={item} resolved={resolved} />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TryIt({
  item,
  resolved,
}: {
  item: ChangelogItem;
  resolved: ResolvedChangelogTryIt;
}) {
  const tryIt = item.tryIt;
  if (!tryIt) {
    return null;
  }

  return (
    <div className="mt-5 flex justify-end border-t border-[#c4a882]/30 pt-5">
      <div>
        {tryIt.href ? (
          <a
            href={tryIt.href}
            className="group/try inline-flex items-center gap-1.5 rounded-full border border-[#3a4a1e]/15 bg-[#3a4a1e] px-3 py-1.5 text-[13px] font-medium text-[#f5f0e8] outline-none transition-[background-color,color] duration-150 ease-out hover:bg-[#2d3a16] focus-visible:ring-2 focus-visible:ring-[#5a6e32]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffcf6] active:scale-[0.97]"
          >
            {tryIt.label}
            <span
              aria-hidden="true"
              className="text-xs leading-none transition-transform duration-150 ease-out group-hover/try:translate-x-0.5"
            >
              →
            </span>
          </a>
        ) : (
          <TryItButton
            authenticated={resolved.authenticated}
            label={resolved.label}
            options={resolved.options}
            prompt={resolved.prompt}
          />
        )}
      </div>
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
