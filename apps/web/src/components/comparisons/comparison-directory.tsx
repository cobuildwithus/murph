"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

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
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-14 sm:gap-16"
      data-comparison-directory
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 border-b border-[#c4a882]/40 pb-10">
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
          hidden={Boolean(normalizedQuery)}
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
              className="scroll-mt-6"
              id={`category-${category.id}`}
              key={category.id}
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-end lg:gap-16">
                <div>
                  <h2
                    className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]"
                    id={`category-${category.id}-heading`}
                  >
                    {category.label}
                  </h2>
                </div>
                <p className="max-w-[62ch] text-[0.9rem] leading-6 text-[#665d4c]">
                  {category.description}
                </p>
              </div>

              <ul className="mt-7 grid grid-cols-2 gap-x-5 border-b border-[#c4a882]/35 sm:gap-x-8 lg:grid-cols-3">
                {categoryComparisons.map((comparison) => (
                  <li className="border-t border-[#c4a882]/35" key={comparison.slug}>
                    <Link
                      aria-label={`Compare Murph with ${comparison.name}`}
                      className="group flex min-h-20 flex-col justify-center gap-3 py-4 sm:min-h-28 sm:justify-between sm:gap-4 sm:py-5"
                      href={`/compare/murph-vs-${comparison.slug}`}
                    >
                      <span>
                        <span className="block font-serif text-[1.15rem] font-semibold leading-tight tracking-[-0.02em] transition-colors group-hover:text-[#5a6e32] sm:text-[1.35rem]">
                          {comparison.name}
                        </span>
                      </span>
                      <span className="hidden items-end justify-between gap-4 text-[0.78rem] leading-5 text-[#665d4c] sm:flex">
                        <span className="line-clamp-2">{comparison.headline}</span>
                        <span aria-hidden="true" className="shrink-0 text-lg leading-none text-[#736a58] transition-transform group-hover:translate-x-1 group-hover:text-[#5a6e32]">
                          →
                        </span>
                      </span>
                      <span className="flex justify-end text-[#736a58] sm:hidden">
                        <span aria-hidden="true" className="text-base leading-none transition-transform group-hover:translate-x-1 group-hover:text-[#5a6e32]">
                          →
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
