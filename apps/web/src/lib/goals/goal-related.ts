import type { GoalIndexEntryModel } from "./goal-models";

export const GOAL_RELATED_LIMIT = 6;

/**
 * Picks the goals a reader is most likely to want next: the broader parent,
 * then more specific children, then siblings, then the category's other
 * top-level goals with featured ones first. The current goal is never
 * included.
 */
export function selectRelatedGoals(
  goal: Pick<GoalIndexEntryModel, "key" | "parentGoalKey">,
  categoryGoals: readonly GoalIndexEntryModel[],
  featuredRouteIds: readonly string[] = [],
  limit = GOAL_RELATED_LIMIT,
): GoalIndexEntryModel[] {
  const keys = new Set(categoryGoals.map((candidate) => candidate.key));
  const featuredRanks = new Map(
    featuredRouteIds.map((routeId, index) => [routeId, index]),
  );
  const parent = categoryGoals.filter(
    (candidate) => goal.parentGoalKey !== null && candidate.key === goal.parentGoalKey,
  );
  const children = categoryGoals.filter(
    (candidate) => candidate.parentGoalKey === goal.key,
  );
  const siblings = goal.parentGoalKey === null
    ? []
    : categoryGoals.filter(
      (candidate) => candidate.parentGoalKey === goal.parentGoalKey,
    );
  const roots = categoryGoals
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      candidate.parentGoalKey === null || !keys.has(candidate.parentGoalKey)
    )
    .sort((left, right) =>
      (featuredRanks.get(left.candidate.routeId) ?? Number.POSITIVE_INFINITY)
        - (featuredRanks.get(right.candidate.routeId) ?? Number.POSITIVE_INFINITY)
      || left.index - right.index
    )
    .map(({ candidate }) => candidate);

  const seen = new Set([goal.key]);
  const related: GoalIndexEntryModel[] = [];
  for (const candidate of [...parent, ...children, ...siblings, ...roots]) {
    if (related.length >= limit) {
      break;
    }
    if (seen.has(candidate.key)) {
      continue;
    }
    seen.add(candidate.key);
    related.push(candidate);
  }

  return related;
}
