"use client";

import { Search, X } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { Input } from "@/src/components/ui/input";
import {
  searchGoalItems,
  type GoalSearchItem,
} from "@/src/lib/goals/goal-search";

const GOAL_SEARCH_BATCH_SIZE = 16;

export function GoalSearchExperience({
  children,
  goals,
}: {
  children: ReactNode;
  goals: readonly GoalSearchItem[];
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

  return (
    <div className="flex flex-col gap-12 pb-12">
      <header className="border-b border-[#c4a882]/35 pb-10">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#736a58]">
          Health guides
        </span>
        <h1 className="mt-3 max-w-[12ch] font-serif text-[clamp(3rem,7vw,5rem)] font-semibold leading-[0.96] tracking-[-0.04em] text-balance text-[#2d3436]">
          Goals
        </h1>
        <p className="mt-5 max-w-[62ch] text-base/7 text-pretty text-[#635a48] sm:text-lg/8">
          Choose an outcome you care about. Every guide gives you a practical
          plan you can use on your own or carry out with Murph.
        </p>
        <div
          className="relative mt-8 w-full"
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
            className="border-[#c4a882]/45 bg-[#fffdf8] pl-13 pr-20 shadow-[0_1px_2px_rgba(45,52,54,0.03)] [&::-webkit-search-cancel-button]:hidden"
            inputSize="xl"
            maxLength={100}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="What do you want to improve?"
            spellCheck={false}
            type="search"
          />
          {query ? (
            <button
              aria-label="Clear goal search"
              className="absolute right-3 top-1/2 flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
              onClick={clearSearch}
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          ) : null}
        </div>
      </header>

      {activeQuery ? (
        <GoalSearchResults
          goals={matches}
          key={activeQuery}
          onClear={clearSearch}
          query={activeQuery}
        />
      ) : children}
    </div>
  );
}

function GoalSearchResults({
  goals,
  onClear,
  query,
}: {
  goals: readonly GoalSearchItem[];
  onClear: () => void;
  query: string;
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
            {goals.length} {goals.length === 1 ? "goal" : "goals"} for “{query}”
          </h2>
          <span aria-live="polite" className="sr-only" role="status">
            {goals.length} {goals.length === 1 ? "goal" : "goals"} found.
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
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <h3 className="font-serif text-xl font-semibold text-foreground">
            No goals matched
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a shorter search or a related outcome.
          </p>
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
            prefetch={false}
            title={goal.title}
          />
        </li>
      ))}
    </ul>
  );
}
