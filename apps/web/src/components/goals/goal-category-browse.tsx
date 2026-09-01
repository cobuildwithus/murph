import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import {
  GoalCategoryArtwork,
  getGoalCategoryVisual,
} from "@/src/components/goals/goal-visual";
import {
  GOAL_CATEGORIES,
  type GoalCategory,
} from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import { cn } from "@/src/lib/utils";

interface GoalBrowseNode {
  children: GoalBrowseNode[];
  goal: GoalIndexEntryModel;
}

interface GoalDirectoryEntry {
  depth: number;
  goal: GoalIndexEntryModel;
}

const GOAL_DIRECTORY_GRID_CLASS_NAME =
  "grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4";

export function GoalCategoryBrowse({
  category,
  goals,
}: {
  category: GoalCategory;
  goals: readonly GoalIndexEntryModel[];
}) {
  const roots = prioritizeFeaturedGoalTree(
    buildGoalBrowseTree(goals),
    category.featuredRouteIds,
  );
  const families = roots.filter((node) => node.children.length > 0);
  const standalone = roots
    .filter((node) => node.children.length === 0)
    .map((node) => node.goal);
  const cardClassName = cn(
    "h-full",
    getGoalCategoryVisual(category.slug).hoverSurfaceClassName,
  );

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

      {families.map((family) => (
        <GoalFamilySection
          cardClassName={cardClassName}
          family={family}
          key={family.goal.key}
        />
      ))}

      {standalone.length > 0 ? (
        <section
          aria-labelledby={families.length > 0 ? "goal-standalone-heading" : undefined}
          className="flex flex-col gap-4 sm:gap-5"
        >
          {families.length > 0 ? (
            <h2
              className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
              id="goal-standalone-heading"
            >
              More {category.label.toLowerCase()} goals
            </h2>
          ) : null}
          <ul
            aria-label={families.length > 0 ? undefined : `${category.label} goals`}
            className={GOAL_DIRECTORY_GRID_CLASS_NAME}
            data-goal-directory="root"
            role="list"
          >
            {standalone.map((goal) => (
              <li className="min-w-0" data-goal-root="standalone" key={goal.key}>
                <GoalBrowseCard
                  className={cardClassName}
                  href={`/goals/${goal.routeId}`}
                  title={goal.title}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function GoalFamilySection({
  cardClassName,
  family,
}: {
  cardClassName: string;
  family: GoalBrowseNode;
}) {
  const { goal } = family;
  const headingId = `goal-family-${goal.routeId}`;
  const descendants = flattenGoalDescendants(family.children);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 sm:gap-5"
      data-goal-family={goal.routeId}
    >
      <h2
        className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
        id={headingId}
      >
        <Link
          href={`/goals/${goal.routeId}`}
          className="group inline-flex items-center gap-2.5 rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f0e8]"
        >
          {goal.title}
          <ArrowRight
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-[transform,color] group-hover:text-primary motion-safe:group-hover:translate-x-1"
          />
        </Link>
      </h2>
      <ul
        aria-labelledby={headingId}
        className={GOAL_DIRECTORY_GRID_CLASS_NAME}
        data-goal-directory="family"
        role="list"
      >
        {descendants.map((entry) => (
          <li
            className="min-w-0"
            data-goal-depth={entry.depth}
            key={entry.goal.key}
          >
            <GoalBrowseCard
              className={cardClassName}
              href={`/goals/${entry.goal.routeId}`}
              title={entry.goal.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function flattenGoalDescendants(
  nodes: readonly GoalBrowseNode[],
  depth = 1,
): GoalDirectoryEntry[] {
  return nodes.flatMap((node) => [
    { depth, goal: node.goal },
    ...flattenGoalDescendants(node.children, depth + 1),
  ]);
}

function buildGoalBrowseTree(
  goals: readonly GoalIndexEntryModel[],
): GoalBrowseNode[] {
  const goalsByKey = new Map(goals.map((goal) => [goal.key, goal]));
  const childrenByParent = new Map<string, GoalIndexEntryModel[]>();

  for (const goal of goals) {
    if (!goal.parentGoalKey || !goalsByKey.has(goal.parentGoalKey)) {
      continue;
    }
    const children = childrenByParent.get(goal.parentGoalKey) ?? [];
    children.push(goal);
    childrenByParent.set(goal.parentGoalKey, children);
  }

  const visited = new Set<string>();
  const materialize = (goal: GoalIndexEntryModel): GoalBrowseNode | null => {
    if (visited.has(goal.key)) {
      return null;
    }
    visited.add(goal.key);
    const children = (childrenByParent.get(goal.key) ?? [])
      .map(materialize)
      .filter((child): child is GoalBrowseNode => child !== null);

    return { children, goal };
  };

  const roots: GoalBrowseNode[] = [];
  const rootGoals = goals.filter(
    (goal) => !goal.parentGoalKey || !goalsByKey.has(goal.parentGoalKey),
  );

  for (const goal of [...rootGoals, ...goals]) {
    const node = materialize(goal);
    if (node) {
      roots.push(node);
    }
  }

  return roots;
}

function prioritizeFeaturedGoalTree(
  nodes: readonly GoalBrowseNode[],
  featuredRouteIds: readonly string[],
): GoalBrowseNode[] {
  const featuredRanks = new Map(
    featuredRouteIds.map((routeId, index) => [routeId, index]),
  );
  const prioritizeNodes = (
    currentNodes: readonly GoalBrowseNode[],
  ): GoalBrowseNode[] =>
    currentNodes
      .map((node, index) => {
        const prioritizedNode = {
          ...node,
          children: prioritizeNodes(node.children),
        };

        return {
          index,
          node: prioritizedNode,
          rank: findFeaturedRank(prioritizedNode, featuredRanks),
        };
      })
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ node }) => node);

  return prioritizeNodes(nodes);
}

function findFeaturedRank(
  node: GoalBrowseNode,
  featuredRanks: ReadonlyMap<string, number>,
): number {
  let rank = featuredRanks.get(node.goal.routeId) ?? Number.POSITIVE_INFINITY;

  for (const child of node.children) {
    rank = Math.min(rank, findFeaturedRank(child, featuredRanks));
  }

  return rank;
}
