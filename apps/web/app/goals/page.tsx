import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import {
  GoalSearchExperience,
  type GoalCategoryDirectoryEntry,
} from "@/src/components/goals/goal-search-experience";
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
  const sections = GOAL_CATEGORIES.flatMap((category) => {
    const categoryGoals = goals.filter(
      (goal) => goal.category === category.slug,
    );
    if (categoryGoals.length === 0) {
      return [];
    }

    return [{
      category,
      featuredGoals: selectCategoryPreviewGoals(
        categoryGoals,
        category.featuredRouteIds,
      ),
      goals: categoryGoals,
    }];
  });
  const directory: GoalCategoryDirectoryEntry[] = sections.map((section) => ({
    count: section.goals.length,
    label: section.category.label,
    slug: section.category.slug,
  }));

  return (
    <GoalSearchExperience categories={directory} goals={searchGoals}>
      <div className="flex flex-col gap-14 sm:gap-16">
        {sections.map(({ category, featuredGoals, goals: categoryGoals }) => {
          return (
            <section
              className="flex scroll-mt-28 flex-col gap-5 sm:gap-6"
              id={category.slug}
              key={category.slug}
            >
              <div className="flex items-end justify-between gap-5 border-b border-[#c4a882]/30 pb-5">
                <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                  <GoalCategoryArtwork
                    category={category.slug}
                    className="size-14 rounded-xl sm:size-16 sm:rounded-2xl"
                  />
                  <div className="min-w-0">
                    <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
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
                className="group inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:hidden"
              >
                View all {categoryGoals.length} {category.label.toLowerCase()} goals
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </section>
          );
        })}
        <GoalsClosingSection />
      </div>
    </GoalSearchExperience>
  );
}

function GoalsClosingSection() {
  return (
    <section
      className="border-t border-[#c4a882]/30 pt-12 sm:pt-14"
      data-goal-closing
    >
      <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <h2 className="max-w-[22ch] font-serif text-[clamp(1.6rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-balance text-[#2d3436]">
            Murph can help with goals that aren’t written up yet.
          </h2>
          <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-[1.7] text-pretty text-[#635a48]">
            Tell Murph what you’re working on in your own words. It answers from
            current research, builds a plan with you, and checks back in.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <Link
            className="inline-flex items-center gap-2 rounded-full bg-[#2d3436] px-5 py-2.5 text-[0.875rem] font-medium text-[#f5f0e8] transition-colors hover:bg-[#3a4044]"
            href="/"
          >
            Start with Murph
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            className="text-[0.8125rem] text-[#736a58] underline-offset-4 hover:underline"
            href="/goals/methodology"
          >
            How these guides are made
          </Link>
        </div>
      </div>
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
