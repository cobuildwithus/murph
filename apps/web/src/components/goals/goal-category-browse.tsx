import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalCategoryArtwork } from "@/src/components/goals/goal-visual";
import {
  GOAL_CATEGORIES,
  type GoalCategory,
} from "@/src/lib/goals/goal-categories";
import { GOAL_DIRECTORY_SECTION_DEFINITIONS } from "@/src/lib/goals/goal-directory-sections";
import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";

interface GoalDirectorySection {
  goals: GoalIndexEntryModel[];
  id: string;
  label: string;
}

const GOAL_DIRECTORY_GRID_CLASS_NAME =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3";
const MAX_GOALS_PER_DIRECTORY_SECTION = 12;


export function GoalCategoryBrowse({
  category,
  goals,
}: {
  category: GoalCategory;
  goals: readonly GoalIndexEntryModel[];
}) {
  const sections = groupGoalsByDirectorySection(category.slug, goals);
  const cardClassName = "h-full";

  return (
    <div
      className="flex flex-col gap-10 pb-12 sm:gap-12"
      data-goal-catalog={category.slug}
    >
      <div className="flex flex-col gap-7 sm:gap-10">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/goals" className="transition-colors hover:text-foreground">
            Goals
          </Link>
          <span className="px-2" aria-hidden="true">/</span>
          <span>{category.label}</span>
        </nav>
        <header className="border-b border-[#c4a882]/30 pb-8 sm:pb-10">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_7.5rem] sm:items-start sm:gap-8">
            <div className="min-w-0">
              <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
                {category.directoryTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-lg/8 text-pretty text-muted-foreground">
                {category.description}
              </p>
            </div>
            <GoalCategoryArtwork
              category={category.slug}
              className="order-first size-20 sm:order-none sm:size-[7.5rem] sm:justify-self-end"
              imageClassName="p-3"
            />
          </div>
          <nav
            aria-label="Other goal categories"
            className="mt-8 flex flex-wrap gap-2"
          >
            {GOAL_CATEGORIES.filter((other) => other.slug !== category.slug).map(
              (other) => (
                <Link
                  href={`/goals/${other.slug}`}
                  key={other.slug}
                  className="inline-flex min-h-9 items-center rounded-full border border-black/[0.08] bg-[#fffdf8] px-4 text-sm font-medium text-[#635a48] transition-colors hover:border-black/[0.16] hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                >
                  {other.label}
                </Link>
              ),
            )}
          </nav>
        </header>
      </div>

      <div
        className="flex flex-col gap-8 sm:gap-10"
        data-goal-sectioned-directory
      >
        {sections.map((section) => {
          const headingId = `goal-directory-${section.id}`;
          return (
            <section
              aria-labelledby={headingId}
              className="flex flex-col gap-4 sm:gap-5"
              data-goal-directory-section={section.id}
              key={section.id}
            >
              <h2
                className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
                id={headingId}
              >
                {section.label}
              </h2>
              <ul
                className={GOAL_DIRECTORY_GRID_CLASS_NAME}
                data-goal-directory="section"
                role="list"
              >
                {section.goals.map((goal) => (
                  <li
                    className="min-w-0"
                    data-goal-root="standalone"
                    key={goal.key}
                  >
                    <GoalBrowseCard
                      className={cardClassName}
                      href={`/goals/${goal.routeId}`}
                      illustrationSrc={resolveGoalIllustrationSrc(goal.routeId)}
                      title={goal.title}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
function groupGoalsByDirectorySection(
  category: GoalCategory["slug"],
  goals: readonly GoalIndexEntryModel[],
): GoalDirectorySection[] {
  const definitions = GOAL_DIRECTORY_SECTION_DEFINITIONS[category];
  const goalsByRouteId = new Map(goals.map((goal) => [goal.routeId, goal]));
  const assignedRouteIds = new Set<string>();
  const sections = definitions.flatMap((section) => {
    const sectionGoals = section.routeIds.flatMap((routeId) => {
      const goal = goalsByRouteId.get(routeId);
      if (!goal) {
        return [];
      }
      assignedRouteIds.add(routeId);
      return [goal];
    });
    return sectionGoals.length > 0
      ? [{ goals: sectionGoals, id: section.id, label: section.label }]
      : [];
  });
  const unassignedGoals = goals.filter(
    (goal) => !assignedRouteIds.has(goal.routeId),
  );

  const moreLabel = `More ${category === "life-stages" ? "life-stage" : category} goals`;
  const fallbackSections = Array.from(
    {
      length: Math.ceil(
        unassignedGoals.length / MAX_GOALS_PER_DIRECTORY_SECTION,
      ),
    },
    (_, index): GoalDirectorySection => ({
      goals: unassignedGoals.slice(
        index * MAX_GOALS_PER_DIRECTORY_SECTION,
        (index + 1) * MAX_GOALS_PER_DIRECTORY_SECTION,
      ),
      id: index === 0 ? "more" : `more-${index + 1}`,
      label: index === 0 ? moreLabel : `${moreLabel}, continued`,
    }),
  );

  return [...sections, ...fallbackSections];
}
