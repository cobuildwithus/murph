import Link from "next/link";

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

const GOAL_FAMILY_PREVIEW_SIZE = 4;
const GOAL_ROOT_PREVIEW_SIZE = 8;

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
  const needsRootDisclosure = roots.length > GOAL_ROOT_PREVIEW_SIZE;
  const previewRoots = needsRootDisclosure
    ? roots.slice(0, GOAL_ROOT_PREVIEW_SIZE)
    : roots;
  const remainingRoots = needsRootDisclosure
    ? roots.slice(GOAL_ROOT_PREVIEW_SIZE)
    : [];

  return (
    <div className="flex flex-col gap-7 pb-12 sm:gap-10">
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
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#736a58]">
              Goal library · {goals.length} practical{" "}
              {goals.length === 1 ? "guide" : "guides"}
            </span>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
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
            (other) => {
              const visual = getGoalCategoryVisual(other.slug);

              return (
                <Link
                  href={`/goals/${other.slug}`}
                  key={other.slug}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-black/[0.08] bg-[#fffdf8] px-3.5 text-sm font-medium text-[#635a48] transition-colors hover:border-black/[0.16] hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full bg-current",
                      visual.accentClassName,
                    )}
                  />
                  {other.label}
                </Link>
              );
            },
          )}
        </nav>
      </header>

      {roots.length > 0 ? (
        <div className="flex flex-col gap-3">
          <GoalRootDirectory
            ariaLabel={`${category.label} goals`}
            category={category}
            directory="root"
            roots={previewRoots}
          />
          {remainingRoots.length > 0 ? (
            <details
              className="group/category"
              data-goal-category-disclosure={category.slug}
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl border border-black/[0.07] bg-[#fffdf8] px-4 py-3 text-sm font-medium text-muted-foreground marker:hidden shadow-[0_1px_2px_rgba(45,52,54,0.025)] transition-[border-color,background-color,color] hover:border-black/[0.13] hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="group-open/category:hidden">
                  Show {remainingRoots.length} more
                </span>
                <span className="hidden group-open/category:inline">
                  Show fewer
                </span>
              </summary>
              <div className="pt-3">
                <GoalRootDirectory
                  ariaLabel={`${category.label} additional goals`}
                  category={category}
                  directory="root-more"
                  roots={remainingRoots}
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GoalRootDirectory({
  ariaLabel,
  category,
  directory,
  roots,
}: {
  ariaLabel: string;
  category: GoalCategory;
  directory: "root" | "root-more";
  roots: readonly GoalBrowseNode[];
}) {
  const standaloneOnly = roots.every((node) => node.children.length === 0);

  return (
    <ul
      aria-label={ariaLabel}
      className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3"
      data-goal-directory={directory}
      role="list"
    >
      {roots.map((node) =>
        node.children.length > 0 ? (
          <GoalFamily
            category={category}
            key={node.goal.key}
            node={node}
          />
        ) : (
          <StandaloneRootGoal
            fillRow={standaloneOnly}
            key={node.goal.key}
            goal={node.goal}
          />
        )
      )}
    </ul>
  );
}

function GoalFamily({
  category,
  node,
}: {
  category: GoalCategory;
  node: GoalBrowseNode;
}) {
  const { goal } = node;
  const headingId = `goal-family-${goal.routeId}`;
  const descendants = flattenGoalDescendants(node.children);
  const preview = descendants.slice(0, GOAL_FAMILY_PREVIEW_SIZE);
  const remaining = descendants.slice(GOAL_FAMILY_PREVIEW_SIZE);
  const visual = getGoalCategoryVisual(category.slug);

  return (
    <li
      className="min-w-0"
      data-goal-family={goal.routeId}
    >
      <section
        aria-labelledby={headingId}
        className="overflow-hidden rounded-[1.125rem] border border-black/[0.07] bg-[#fffdf8] shadow-[0_1px_2px_rgba(45,52,54,0.03)]"
      >
        <Link
          href={`/goals/${goal.routeId}`}
          className={cn(
            "flex min-h-17 w-full items-center border-b px-4 py-3.5 transition-[filter] hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring sm:px-5",
            visual.surfaceClassName,
            visual.borderClassName,
          )}
        >
          <h3
            id={headingId}
            className="font-serif text-lg font-semibold leading-snug tracking-[-0.015em] text-balance text-foreground sm:text-xl"
          >
            {goal.title}
          </h3>
        </Link>
        <GoalDescendantList
          directory="specific"
          entries={preview}
          labelledBy={headingId}
        />
        {remaining.length > 0 ? (
          <details
            className="group/disclosure border-t border-border/70"
            data-goal-disclosure={goal.routeId}
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center px-4 py-3 text-sm font-medium text-muted-foreground marker:hidden transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="group-open/disclosure:hidden">
                Show {remaining.length} more
              </span>
              <span className="hidden group-open/disclosure:inline">
                Show fewer
              </span>
            </summary>
            <GoalDescendantList
              directory="specific-more"
              entries={remaining}
              labelledBy={headingId}
            />
          </details>
        ) : null}
      </section>
    </li>
  );
}

function GoalDescendantList({
  directory,
  entries,
  labelledBy,
}: {
  directory: "specific" | "specific-more";
  entries: readonly GoalDirectoryEntry[];
  labelledBy: string;
}) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className={cn(
        "grid gap-px bg-border/70",
        entries.length === 1 ? "grid-cols-1" : "grid-cols-2",
        directory === "specific-more" && "border-t border-border/70",
      )}
      data-goal-directory={directory}
      role="list"
    >
      {entries.map((entry, index) => (
        <GoalDescendantNode
          entry={entry}
          key={entry.goal.key}
          spansColumns={entries.length > 1
            && entries.length % 2 === 1
            && index === entries.length - 1}
        />
      ))}
    </ul>
  );
}

function GoalDescendantNode({
  entry,
  spansColumns,
}: {
  entry: GoalDirectoryEntry;
  spansColumns: boolean;
}) {
  return (
    <li
      className={cn("min-w-0 bg-[#fffdf8]", spansColumns && "col-span-2")}
      data-goal-depth={entry.depth}
    >
      <Link
        href={`/goals/${entry.goal.routeId}`}
        className={cn(
          "group flex h-full min-h-14 w-full items-center px-4 py-3 transition-colors hover:bg-muted/25 hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring",
          entry.depth > 1 && "pl-7",
        )}
      >
        <span className="font-serif text-[1.0625rem] font-semibold leading-snug tracking-tight text-balance">
          {entry.goal.title}
        </span>
      </Link>
    </li>
  );
}

function StandaloneRootGoal({
  fillRow,
  goal,
}: {
  fillRow: boolean;
  goal: GoalIndexEntryModel;
}) {
  return (
    <li
      className={cn("min-w-0", fillRow && "self-stretch")}
      data-goal-root="standalone"
    >
      <Link
        href={`/goals/${goal.routeId}`}
        className={cn(
          "flex min-h-14 w-full items-center rounded-xl border border-black/[0.07] bg-[#fffdf8] px-3 py-3 font-serif text-[0.9375rem] font-semibold leading-snug tracking-tight text-balance text-foreground shadow-[0_1px_2px_rgba(45,52,54,0.025)] transition-[border-color,background-color,color] hover:border-black/[0.13] hover:bg-muted/20 hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring sm:min-h-16 sm:px-5 sm:py-3.5 sm:text-[1.0625rem]",
          fillRow && "h-full",
        )}
      >
        {goal.title}
      </Link>
    </li>
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
