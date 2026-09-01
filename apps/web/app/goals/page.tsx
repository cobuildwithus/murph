import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalSearchExperience } from "@/src/components/goals/goal-search-experience";
import { GoalCategoryArtwork } from "@/src/components/goals/goal-visual";
import { GOAL_CATEGORIES } from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import { createGoalSearchItem } from "@/src/lib/goals/goal-search";
import {
  listHealthCommonsGoalEntries,
  listTopLevelGoals,
} from "@/src/lib/health-commons/goal-projections";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

const GOALS_DESCRIPTION =
  "Clear, research-backed guides for the health and fitness goals people care about most.";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: { canonical: "/goals" },
  description: GOALS_DESCRIPTION,
  openGraph: { type: "website", url: "/goals" },
  robots: MURPH_INDEXABLE_PAGE_ROBOTS,
  title: "Health Goals | Murph",
});

export default function GoalsPage() {
  const goals = listHealthCommonsGoalEntries();
  const searchGoals = goals.map((goal) => createGoalSearchItem(goal));

  return (
    <GoalSearchExperience goals={searchGoals}>
      <div className="flex flex-col gap-16">
        {GOAL_CATEGORIES.map((category) => {
          const categoryGoals = goals.filter(
            (goal) => goal.category === category.slug,
          );
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
              <ul
                className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4"
                data-goal-preview={category.slug}
              >
                {featuredGoals.map((goal) => (
                  <li className="min-w-0" key={goal.key}>
                    <GoalBrowseCard
                      className="h-full"
                      href={`/goals/${goal.routeId}`}
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
    </GoalSearchExperience>
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
