import { ArrowRight } from "lucide-react";
import Link from "next/link";

import {
  GoalCategoryArtwork,
  getGoalCategoryVisual,
} from "@/src/components/goals/goal-visual";
import { PageHeader } from "@/src/components/ui/page-header";
import type { GoalCategory } from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import { cn } from "@/src/lib/utils";

interface GoalBrowseNode {
  children: GoalBrowseNode[];
  goal: GoalIndexEntryModel;
}

export function GoalCategoryBrowse({
  category,
  goals,
}: {
  category: GoalCategory;
  goals: readonly GoalIndexEntryModel[];
}) {
  const roots = buildGoalBrowseTree(goals);
  const hasFamilies = roots.some((node) => node.children.length > 0);

  return (
    <div className="flex flex-col gap-10 pb-12">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/goals" className="transition-colors hover:text-foreground">
          Goals
        </Link>
        <span className="px-2" aria-hidden="true">/</span>
        <span>{category.label}</span>
      </nav>
      <div className="flex flex-col gap-6 border-b border-border/70 pb-9 sm:flex-row sm:items-center">
        <GoalCategoryArtwork
          category={category.slug}
          className="size-24 sm:size-28"
          imageClassName="p-3"
        />
        <PageHeader
          eyebrow="Goal library"
          title={`${category.label} goals`}
          description={category.description}
        >
          <p className="mt-3 text-xs text-muted-foreground">
            {goals.length} practical {goals.length === 1 ? "guide" : "guides"}
          </p>
        </PageHeader>
      </div>

      {roots.length > 0 ? (
        <section className="flex flex-col gap-5">
          <div className="border-b border-border/70 pb-3">
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Browse {category.label.toLowerCase()} goals
            </h2>
          </div>

          {hasFamilies ? (
            <ul className="space-y-7" role="list">
              {roots.map((node) =>
                node.children.length > 0 ? (
                  <GoalFamily
                    key={node.goal.key}
                    category={category}
                    node={node}
                  />
                ) : (
                  <StandaloneRootGoal key={node.goal.key} goal={node.goal} />
                )
              )}
            </ul>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
              {roots.map(({ goal }) => (
                <StandaloneGoalCard key={goal.key} goal={goal} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
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
  const specificGoalCount = countDescendants(node);
  const visual = getGoalCategoryVisual(category.slug);

  return (
    <li>
      <section
        aria-labelledby={headingId}
        className="overflow-hidden rounded-[1.5rem] border border-black/[0.07] bg-[#fffdf8] shadow-[0_1px_2px_rgba(45,52,54,0.03)]"
        data-goal-family={goal.routeId}
      >
        <Link
          href={`/goals/${goal.routeId}`}
          className={cn(
            "group relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 overflow-hidden px-5 py-6 transition-[filter] hover:brightness-[0.985] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring sm:px-7 sm:py-7",
            visual.surfaceClassName,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -right-16 -top-24 size-52 rounded-full border opacity-10",
              visual.accentClassName,
              visual.borderClassName,
            )}
          />
          <div className="relative min-w-0">
            <h3
              id={headingId}
              className="font-serif text-2xl font-semibold leading-tight tracking-[-0.02em] text-balance text-foreground sm:text-3xl"
            >
              {goal.title}
            </h3>
            <p className="mt-2 max-w-3xl text-sm/6 text-pretty text-foreground/75 sm:text-base/7">
              {goal.summary}
            </p>
            <span
              className={cn(
                "mt-4 inline-flex rounded-full border bg-white/55 px-3 py-1 text-[11px] font-medium",
                visual.accentClassName,
                visual.borderClassName,
              )}
            >
              {specificGoalCount} specific {specificGoalCount === 1 ? "goal" : "goals"}
            </span>
          </div>
          <ArrowRight
            aria-hidden="true"
            className="relative mt-1 size-5 shrink-0 text-foreground/55 transition-transform motion-safe:group-hover:translate-x-1"
          />
        </Link>

        <div className="border-t border-black/[0.06] p-4 sm:p-5">
          <div className="mb-3 px-1">
            <p className="text-sm font-medium text-foreground">
              Specific goals
            </p>
          </div>
          <ul className="grid items-start gap-2 sm:grid-cols-2 xl:grid-cols-3" role="list">
            {node.children.map((child) => (
              <SpecificGoalCard key={child.goal.key} node={child} depth={1} />
            ))}
          </ul>
        </div>
      </section>
    </li>
  );
}

function SpecificGoalCard({
  depth,
  node,
}: {
  depth: number;
  node: GoalBrowseNode;
}) {
  const { goal } = node;

  return (
    <li className="min-w-0" data-goal-depth={depth}>
      <div className="overflow-hidden rounded-xl border border-black/[0.07] bg-white/55 transition-[border-color,box-shadow] hover:border-black/[0.13] hover:shadow-[0_10px_28px_-24px_rgba(45,52,54,0.35)]">
        <Link
          href={`/goals/${goal.routeId}`}
          className="group grid min-h-[8.5rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <div className="min-w-0">
            <h4 className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance text-foreground">
              {goal.title}
            </h4>
            <p className="mt-1.5 line-clamp-3 text-sm/5 text-pretty text-muted-foreground">
              {goal.summary}
            </p>
          </div>
          <ArrowRight
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
          />
        </Link>

        {node.children.length > 0 ? (
          <ul
            aria-label={`More specific goals for ${goal.title}`}
            className="divide-y divide-border/60 border-t border-border/60 bg-muted/[0.14]"
            role="list"
          >
            {node.children.map((child) => (
              <NestedGoalLink
                key={child.goal.key}
                node={child}
                depth={depth + 1}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function NestedGoalLink({
  depth,
  node,
}: {
  depth: number;
  node: GoalBrowseNode;
}) {
  const { goal } = node;

  return (
    <li data-goal-depth={depth}>
      <Link
        href={`/goals/${goal.routeId}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <p className="font-serif text-base font-semibold leading-snug tracking-tight text-foreground">
            {goal.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs/5 text-muted-foreground">
            {goal.summary}
          </p>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
        />
      </Link>
      {node.children.length > 0 ? (
        <ul className="border-t border-border/60" role="list">
          {node.children.map((child) => (
            <NestedGoalLink key={child.goal.key} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function StandaloneGoalCard({
  goal,
}: {
  goal: GoalIndexEntryModel;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={`/goals/${goal.routeId}`}
        className="group grid h-full min-h-[9rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-black/[0.07] bg-[#fffdf8] px-4 py-4 transition-[border-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-black/[0.13] hover:shadow-[0_12px_30px_-25px_rgba(45,52,54,0.35)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]"
      >
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance text-foreground">
            {goal.title}
          </h3>
          <p className="mt-1.5 line-clamp-3 text-sm/5 text-pretty text-muted-foreground">
            {goal.summary}
          </p>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
        />
      </Link>
    </li>
  );
}

function StandaloneRootGoal({ goal }: { goal: GoalIndexEntryModel }) {
  return (
    <li>
      <Link
        href={`/goals/${goal.routeId}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 rounded-[1.5rem] border border-black/[0.07] bg-[#fffdf8] px-5 py-6 shadow-[0_1px_2px_rgba(45,52,54,0.03)] transition-[border-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-black/[0.13] hover:shadow-[0_16px_34px_-28px_rgba(45,52,54,0.35)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] sm:px-7 sm:py-7"
      >
        <div className="min-w-0">
          <h3 className="font-serif text-2xl font-semibold leading-tight tracking-[-0.02em] text-balance text-foreground sm:text-3xl">
            {goal.title}
          </h3>
          <p className="mt-2 max-w-3xl text-sm/6 text-pretty text-muted-foreground sm:text-base/7">
            {goal.summary}
          </p>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
        />
      </Link>
    </li>
  );
}

function countDescendants(node: GoalBrowseNode): number {
  return node.children.reduce(
    (count, child) => count + 1 + countDescendants(child),
    0,
  );
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
