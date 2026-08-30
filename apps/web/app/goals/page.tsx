import type { Metadata } from "next";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { PageHeader } from "@/src/components/ui/page-header";
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
    <div className="flex flex-col gap-10 pb-12">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader
          eyebrow="Guides"
          title="Goals"
          description="Choose an outcome you care about. Every guide gives you a practical plan you can use on your own or carry out with Murph."
        />
        <form action="/goals" className="flex w-full gap-2 sm:w-auto" role="search">
          <Input
            aria-label="Search goals"
            defaultValue={query}
            name="q"
            placeholder="Search goals"
            className="min-w-0 flex-1 sm:w-64"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {query ? (
        <GoalSearchResults goals={matches} query={query} />
      ) : (
        <div className="flex flex-col gap-12">
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
              <section key={category.slug} className="flex flex-col gap-5">
                <div className="flex items-end justify-between gap-4 border-b border-border/70 pb-4">
                  <div>
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
                  <Link
                    href={`/goals/${category.slug}`}
                    className="hidden shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
                  >
                    View all {categoryGoals.length}
                  </Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {featuredGoals.map((goal) => (
                    <GoalBrowseCard
                      key={goal.key}
                      categoryLabel={category.label}
                      href={`/goals/${goal.routeId}`}
                      summary={goal.summary}
                      title={goal.title}
                    />
                  ))}
                </div>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {goals.map((goal) => {
            const category = getGoalCategory(goal.category);
            return (
              <GoalBrowseCard
                key={goal.key}
                categoryLabel={category?.label ?? goal.category}
                href={`/goals/${goal.routeId}`}
                summary={goal.summary}
                title={goal.title}
              />
            );
          })}
        </div>
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
