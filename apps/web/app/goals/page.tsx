import type { Metadata } from "next";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalCategoryArtwork } from "@/src/components/goals/goal-visual";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  GOAL_CATEGORIES,
  getGoalCategory,
} from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import {
  listHealthCommonsGoalsByCategory,
  listTopLevelGoals,
  searchHealthCommonsGoals,
} from "@/src/lib/health-commons/goal-projections";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

const GOALS_DESCRIPTION =
  "Clear, research-backed guides for the health and fitness goals people care about most.";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const query = readSearchQuery(await searchParams);

  return createMurphPageMetadata({
    alternates: { canonical: "/goals" },
    description: GOALS_DESCRIPTION,
    robots: query ? MURPH_NOINDEX_PAGE_ROBOTS : MURPH_INDEXABLE_PAGE_ROBOTS,
    title: query ? `Search health goals | Murph` : "Health Goals | Murph",
  });
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = readSearchQuery(await searchParams);
  const matches = query ? searchHealthCommonsGoals(query) : [];

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
        <form
          action="/goals"
          className="mt-8 flex w-full flex-col gap-3 sm:flex-row"
          data-goal-search="full-width"
          role="search"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-5 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search goals"
              className="border-[#c4a882]/45 bg-[#fffdf8] pl-13 shadow-[0_1px_2px_rgba(45,52,54,0.03)]"
              defaultValue={query}
              inputSize="xl"
              name="q"
              placeholder="Search goals"
            />
          </div>
          <Button className="sm:min-w-32" size="xl" type="submit">
            Search
          </Button>
        </form>
      </header>

      {query ? (
        <GoalSearchResults goals={matches} query={query} />
      ) : (
        <div className="flex flex-col gap-16">
          {GOAL_CATEGORIES.map((category) => {
            const categoryGoals = listHealthCommonsGoalsByCategory(category.slug);
            const featuredGoals = selectCategoryPreviewGoals(
              categoryGoals,
              category.featuredRouteIds,
            );

            if (categoryGoals.length === 0) {
              return null;
            }

            return (
              <section
                className="flex scroll-mt-28 flex-col gap-6"
                id={category.slug}
                key={category.slug}
              >
                <div className="flex items-end justify-between gap-5 border-b border-[#c4a882]/30 pb-5">
                  <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                    <GoalCategoryArtwork
                      category={category.slug}
                      className="size-16 rounded-xl sm:size-20 sm:rounded-2xl"
                    />
                    <div className="min-w-0">
                      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                        <Link
                          href={`/goals/${category.slug}`}
                          className="transition-colors hover:text-primary"
                        >
                          {category.label}
                        </Link>
                      </h2>
                      <p className="mt-1 max-w-2xl text-sm/6 text-pretty text-muted-foreground">
                        {category.description}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/goals/${category.slug}`}
                    className="group hidden shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                  >
                    View all {categoryGoals.length}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform motion-safe:group-hover:translate-x-1"
                    />
                  </Link>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                  {featuredGoals.map((goal) => (
                    <li className="min-w-0" key={goal.key}>
                      <GoalBrowseCard
                        category={category.slug}
                        categoryLabel={category.label}
                        className="h-full"
                        href={`/goals/${goal.routeId}`}
                        outcomeKind={goal.outcomeKind}
                        summary={goal.summary}
                        title={goal.title}
                      />
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/goals/${category.slug}`}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:hidden"
                >
                  View all {categoryGoals.length} {category.label.toLowerCase()} goals
                </Link>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GoalSearchResults({
  goals,
  query,
}: {
  goals: GoalIndexEntryModel[];
  query: string;
}) {
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
        </div>
        <Link
          href="/goals"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear search
        </Link>
      </div>
      {goals.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {goals.map((goal) => {
            const category = getGoalCategory(goal.category);
            return (
              <li className="min-w-0" key={goal.key}>
                <GoalBrowseCard
                  category={goal.category}
                  categoryLabel={category?.label ?? goal.category}
                  className="h-full"
                  href={`/goals/${goal.routeId}`}
                  outcomeKind={goal.outcomeKind}
                  summary={goal.summary}
                  title={goal.title}
                />
              </li>
            );
          })}
        </ul>
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

function selectCategoryPreviewGoals(
  goals: readonly GoalIndexEntryModel[],
  featuredRouteIds: readonly string[],
): GoalIndexEntryModel[] {
  const goalsByRouteId = new Map(goals.map((goal) => [goal.routeId, goal]));
  const featured = featuredRouteIds.flatMap((routeId) => {
    const goal = goalsByRouteId.get(routeId);
    return goal ? [goal] : [];
  });
  const topLevel = listTopLevelGoals(goals);
  const topLevelKeys = new Set(topLevel.map((goal) => goal.key));
  const selected = [
    ...featured,
    ...topLevel,
    ...goals.filter((goal) => !topLevelKeys.has(goal.key)),
  ];
  const unique = [...new Map(selected.map((goal) => [goal.key, goal])).values()];
  return unique.slice(0, 4);
}

function readSearchQuery(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const value = searchParams.q;
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 100) ?? "";
}
