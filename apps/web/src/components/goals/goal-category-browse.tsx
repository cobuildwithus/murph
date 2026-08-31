import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GoalCategoryArtwork, GoalOutcomeMark } from "@/src/components/goals/goal-visual";
import { PageHeader } from "@/src/components/ui/page-header";
import type { GoalCategory } from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";

export function GoalCategoryBrowse({
  category,
  goals,
}: {
  category: GoalCategory;
  goals: readonly GoalIndexEntryModel[];
}) {
  const rows = flattenGoalBrowseRows(goals);

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

      {rows.length > 0 ? (
        <section className="flex flex-col gap-5">
          <div className="border-b border-border/70 pb-3">
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Browse {category.label.toLowerCase()} goals
            </h2>
          </div>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
            {rows.map((row) => (
              <li key={row.goal.key}>
                <GoalBrowseRow category={category} {...row} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function GoalBrowseRow({
  category,
  depth,
  goal,
  parentTitle,
}: {
  category: GoalCategory;
  depth: number;
  goal: GoalIndexEntryModel;
  parentTitle: string | null;
}) {
  return (
    <Link
      href={`/goals/${goal.routeId}`}
      className="group flex items-start justify-between gap-5 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <GoalOutcomeMark
          category={category.slug}
          className="mt-0.5 size-9"
          outcomeKind={goal.outcomeKind}
        />
        <div
          className={
            depth > 0
              ? "min-w-0 border-l border-border pl-4 sm:ml-5"
              : "min-w-0"
          }
        >
          {parentTitle ? (
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Related to {parentTitle}
            </span>
          ) : null}
          <h3 className="font-serif text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg">
            {goal.title}
          </h3>
          <p className="mt-1 max-w-3xl text-sm/6 text-pretty text-muted-foreground">
            {goal.summary}
          </p>
        </div>
      </div>
      <ArrowRight
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
        aria-hidden="true"
      />
    </Link>
  );
}

function flattenGoalBrowseRows(
  goals: readonly GoalIndexEntryModel[],
): Array<{
  depth: number;
  goal: GoalIndexEntryModel;
  parentTitle: string | null;
}> {
  const goalKeys = new Set(goals.map((goal) => goal.key));
  const childrenByParent = new Map<string, GoalIndexEntryModel[]>();
  for (const goal of goals) {
    if (!goal.parentGoalKey || !goalKeys.has(goal.parentGoalKey)) {
      continue;
    }
    const children = childrenByParent.get(goal.parentGoalKey) ?? [];
    children.push(goal);
    childrenByParent.set(goal.parentGoalKey, children);
  }

  const rows: Array<{
    depth: number;
    goal: GoalIndexEntryModel;
    parentTitle: string | null;
  }> = [];
  const visited = new Set<string>();

  const visit = (
    goal: GoalIndexEntryModel,
    depth: number,
    parentTitle: string | null,
  ) => {
    if (visited.has(goal.key)) {
      return;
    }
    visited.add(goal.key);
    rows.push({ depth, goal, parentTitle });
    for (const child of childrenByParent.get(goal.key) ?? []) {
      visit(child, depth + 1, goal.title);
    }
  };

  for (const goal of goals) {
    if (!goal.parentGoalKey || !goalKeys.has(goal.parentGoalKey)) {
      visit(goal, 0, null);
    }
  }
  for (const goal of goals) {
    visit(goal, 0, null);
  }

  return rows;
}
