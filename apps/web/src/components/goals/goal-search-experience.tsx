"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalContactActionContents } from "@/src/components/goals/goal-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import type { GoalCategorySlug } from "@/src/lib/goals/goal-categories";
import {
  searchGoalItems,
  type GoalSearchItem,
} from "@/src/lib/goals/goal-search";
import {
  type MurphContactOption,
  withMurphContactOptionBody,
} from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GOAL_SEARCH_BATCH_SIZE = 16;
const GOAL_SEARCH_EXAMPLES = [
  "lower blood pressure",
  "run a 5K",
  "reduce stress",
  "build muscle",
] as const;

export interface GoalCategoryDirectoryEntry {
  count: number;
  label: string;
  slug: GoalCategorySlug;
}

export function GoalSearchExperience({
  categories,
  children,
  goals,
  startOption,
}: {
  categories: readonly GoalCategoryDirectoryEntry[];
  children: ReactNode;
  goals: readonly GoalSearchItem[];
  startOption: MurphContactOption;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const activeQuery = query.trim();
  const matches = useMemo(
    () => searchGoalItems(goals, activeQuery),
    [activeQuery, goals],
  );

  function clearSearch() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function applyExample(example: string) {
    if (inputRef.current) {
      inputRef.current.value = example;
    }
    setQuery(example);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-12 pb-12 sm:gap-14">
      <header className="border-b border-[#c4a882]/35 pb-10 sm:pb-12">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-balance text-[#2d3436] sm:text-5xl lg:text-6xl">
            Hey Murph, help me…
          </h1>
        </div>
        <div className="mx-auto mt-10 max-w-2xl">
          <div
            className="relative w-full"
            data-goal-search="full-width"
            role="search"
          >
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-5 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              aria-label="Search goals"
              autoCapitalize="none"
              autoComplete="off"
              className="border-border bg-card pl-13 pr-20 text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              enterKeyHint="search"
              inputSize="xl"
              maxLength={100}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="sleep through the night"
              spellCheck={false}
              type="search"
            />
            {query ? (
              <button
                aria-label="Clear goal search"
                className="absolute right-3 top-1/2 flex min-h-10 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                onClick={clearSearch}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            ) : null}
          </div>
          <p className="mt-4 text-center text-sm leading-6 text-muted-foreground">
            Try:{" "}
            {GOAL_SEARCH_EXAMPLES.map((example, index) => (
              <span key={example}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                <button
                  className="rounded-sm underline decoration-[#c4a882]/60 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => applyExample(example)}
                  type="button"
                >
                  {example}
                </button>
              </span>
            ))}
          </p>
        </div>
        <nav
          aria-label="Goal categories"
          className="mt-8 flex flex-wrap justify-center gap-2"
          data-goal-category-directory
        >
          {categories.map((category) => (
            <Link
              href={`/goals/${category.slug}`}
              key={category.slug}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-black/[0.08] bg-[#fffdf8] px-4 text-sm font-medium text-[#2d3436] transition-colors hover:border-black/[0.18] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
            >
              {category.label}
              <span className="text-[#736a58]">{category.count}</span>
            </Link>
          ))}
        </nav>
      </header>

      {activeQuery ? (
        <GoalSearchResults
          goals={matches}
          key={activeQuery}
          onClear={clearSearch}
          query={activeQuery}
          startOption={startOption}
        />
      ) : children}
    </div>
  );
}

function GoalSearchResults({
  goals,
  onClear,
  query,
  startOption,
}: {
  goals: readonly GoalSearchItem[];
  onClear: () => void;
  query: string;
  startOption: MurphContactOption;
}) {
  const [visibleGoalCount, setVisibleGoalCount] = useState(
    GOAL_SEARCH_BATCH_SIZE,
  );
  const visibleGoals = goals.slice(0, visibleGoalCount);
  const remainingGoalCount = goals.length - visibleGoals.length;
  const nextBatchSize = Math.min(GOAL_SEARCH_BATCH_SIZE, remainingGoalCount);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Search results
          </span>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {goals.length > 0
              ? `${goals.length} ${goals.length === 1 ? "goal" : "goals"} for “${query}”`
              : `Help with “${query}”`}
          </h2>
          <span aria-live="polite" className="sr-only" role="status">
            {goals.length > 0
              ? `${goals.length} ${goals.length === 1 ? "goal" : "goals"} found.`
              : "No exact guide found. Start with Murph is available."}
          </span>
        </div>
        <button
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={onClear}
          type="button"
        >
          Clear search
        </button>
      </div>
      {goals.length > 0 ? (
        <>
          <GoalSearchGrid goals={visibleGoals} />
          {remainingGoalCount > 0 ? (
            <button
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-black/[0.07] bg-[#fffdf8] px-4 py-3 text-sm font-medium text-muted-foreground transition-[border-color,background-color,color] hover:border-black/[0.13] hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
              data-goal-search-more
              onClick={() => {
                setVisibleGoalCount((count) => count + GOAL_SEARCH_BATCH_SIZE);
              }}
              type="button"
            >
              Show {nextBatchSize} more
            </button>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-border/80 bg-card px-6 py-10 text-center sm:px-10">
          <h3 className="font-serif text-xl font-semibold text-foreground">
            Start with Murph
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            There isn’t an exact guide for “{query}” yet. Send Murph your goal
            and build a plan together.
          </p>
          <MurphContactLink
            actionLabel={`Start with Murph about ${query}`}
            className={cn(
              buttonVariants({ size: "xl" }),
              "mt-6 w-full sm:w-auto",
            )}
            option={withMurphContactOptionBody(
              startOption,
              `Hey Murph, can you help me with this goal: ${query}?`,
            )}
          >
            <GoalContactActionContents label="Start with Murph" />
          </MurphContactLink>
        </div>
      )}
    </section>
  );
}

function GoalSearchGrid({
  goals,
}: {
  goals: readonly GoalSearchItem[];
}) {
  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4"
      data-goal-search-results="visible"
    >
      {goals.map((goal) => (
        <li className="min-w-0" key={goal.key}>
          <GoalBrowseCard
            className="h-full"
            href={`/goals/${goal.routeId}`}
            illustrationSrc={goal.illustrationSrc}
            prefetch={false}
            title={goal.title}
          />
        </li>
      ))}
    </ul>
  );
}
