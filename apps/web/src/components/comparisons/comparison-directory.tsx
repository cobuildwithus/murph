"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ComparisonLogo } from "@/src/components/comparisons/comparison-logo";
import {
  COMPARISON_CATEGORIES,
  type ComparisonCategoryId,
} from "@/src/lib/comparisons/types";

export interface ComparisonDirectoryItem {
  aliases?: readonly string[];
  category: ComparisonCategoryId;
  headline: string;
  name: string;
  slug: string;
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function ComparisonDirectory({
  comparisons,
}: {
  comparisons: readonly ComparisonDirectoryItem[];
}) {
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizeSearchValue(query);
  const searching = normalizedQuery.length > 0;
  const filteredComparisons = useMemo(() => {
    if (!normalizedQuery) {
      return comparisons;
    }

    return comparisons.filter((comparison) => {
      const category = COMPARISON_CATEGORIES.find(
        (entry) => entry.id === comparison.category,
      );
      const searchableText = [
        comparison.name,
        comparison.headline,
        comparison.slug,
        ...(comparison.aliases ?? []),
        category?.label,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [comparisons, normalizedQuery]);

  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)] ${searching ? "gap-10" : "gap-14 sm:gap-16"}`}
      data-comparison-directory
    >
      <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 border-b border-[#c4a882]/40 ${searching ? "pb-6" : "pb-10"}`}>
        <div className="group block min-w-0 max-w-full">
          <label
            className="text-sm font-semibold text-[#5a6e32]"
            htmlFor="comparison-search"
          >
            Find your comparison
          </label>
          <span className="mt-3 flex items-center gap-4 border-b-2 border-[#2d3436] pb-3 transition-colors focus-within:border-[#5a6e32]">
            <svg
              aria-hidden="true"
              className="size-6 shrink-0 text-[#736a58]"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="m16.25 16.25 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent font-serif text-[clamp(1.35rem,3vw,2rem)] font-semibold tracking-[-0.025em] text-[#2d3436] outline-none placeholder:text-[#736a58] disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:appearance-none"
              disabled={!isHydrated}
              id="comparison-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="WHOOP, Oura, Apple Health..."
              ref={searchInputRef}
              type="search"
              value={query}
            />
            {normalizedQuery ? (
              <button
                aria-label="Clear comparison search"
                className="inline-flex min-h-6 shrink-0 items-center border-b border-[#c4a882] text-xs font-medium text-[#736a58] transition-colors hover:text-[#5a6e32]"
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                type="button"
              >
                Clear
              </button>
            ) : null}
            {normalizedQuery ? (
              <span
                aria-live="polite"
                className="shrink-0 text-xs text-[#736a58]"
              >
                {filteredComparisons.length} found
              </span>
            ) : null}
          </span>
        </div>

        <nav
          aria-label="Comparison categories"
          className="min-w-0 max-w-full"
          hidden={searching}
        >
          <ul className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {COMPARISON_CATEGORIES.map((category) => (
              <li key={category.id}>
                <a
                  className="block border-t border-[#c4a882]/35 pt-3 text-[0.84rem] leading-5 text-[#4d4533] transition-colors hover:text-[#5a6e32]"
                  href={`#category-${category.id}`}
                >
                  {category.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {filteredComparisons.length > 0 ? (
        COMPARISON_CATEGORIES.map((category) => {
          const categoryComparisons = filteredComparisons.filter(
            (comparison) => comparison.category === category.id,
          );

          if (categoryComparisons.length === 0) {
            return null;
          }

          return (
            <section
              aria-labelledby={`category-${category.id}-heading`}
              className="scroll-mt-24"
              id={`category-${category.id}`}
              key={category.id}
            >
              {searching ? (
                <h2
                  className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58]"
                  id={`category-${category.id}-heading`}
                >
                  {category.label}
                  <span aria-hidden="true" className="ml-2 text-[#b39a76]">
                    {categoryComparisons.length}
                  </span>
                </h2>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-end lg:gap-16">
                  <h2
                    className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                    id={`category-${category.id}-heading`}
                  >
                    {category.label}
                  </h2>
                  <p className="max-w-[62ch] text-[0.9rem] leading-6 text-[#665d4c]">
                    {category.description}
                  </p>
                </div>
              )}

              <ul
                className={`grid border-b border-[#c4a882]/35 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-3 ${searching ? "mt-3" : "mt-7"}`}
              >
                {categoryComparisons.map((comparison) => (
                  <li className="border-t border-[#c4a882]/35" key={comparison.slug}>
                    <Link
                      aria-label={`Compare Murph with ${comparison.name}`}
                      className="group flex min-h-[4.5rem] items-center gap-4 py-3.5 sm:min-h-24 sm:items-start sm:py-5"
                      href={`/compare/murph-vs-${comparison.slug}`}
                    >
                      <ComparisonLogo
                        className="size-11 shrink-0 rounded-xl border border-[#c4a882]/30 p-2 text-[#2d3436] sm:size-12"
                        decorative
                        imageClassName="max-h-7"
                        name={comparison.name}
                        slug={comparison.slug}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0 font-serif text-[1.15rem] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] transition-colors group-hover:text-[#5a6e32] sm:text-[1.25rem]">
                            {comparison.name}
                          </span>
                          <span aria-hidden="true" className="shrink-0 text-lg leading-none text-[#736a58] transition-transform group-hover:translate-x-1 group-hover:text-[#5a6e32]">
                            →
                          </span>
                        </span>
                        <span className="hidden text-[0.78rem] leading-5 text-[#665d4c] sm:line-clamp-2">
                          {comparison.headline}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <div className="border-y border-[#c4a882]/40 py-14 text-center">
          <p className="font-serif text-2xl font-semibold tracking-[-0.02em]">
            No comparison found.
          </p>
          <p className="mt-3 text-sm text-[#665d4c]">
            Try a product name, category, or a shorter search.
          </p>
        </div>
      )}
    </div>
  );
}
