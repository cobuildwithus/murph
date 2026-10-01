import type { GoalSearchItem } from "./goal-search";

export const GOAL_SEARCH_INDEX_PATH = "/api/goals/search-index";

export interface GoalSearchIndexPayload {
  goals: GoalSearchItem[];
}

export function isGoalSearchIndexPayload(
  value: unknown,
): value is GoalSearchIndexPayload {
  if (typeof value !== "object" || value === null || !("goals" in value)) {
    return false;
  }
  const goals = (value as { goals: unknown }).goals;
  return Array.isArray(goals)
    && goals.every((goal) =>
      typeof goal === "object"
      && goal !== null
      && typeof (goal as { routeId?: unknown }).routeId === "string"
      && typeof (goal as { goalPhrase?: unknown }).goalPhrase === "string"
      && typeof (goal as { searchText?: unknown }).searchText === "string"
      && typeof (goal as { title?: unknown }).title === "string"
      && typeof (goal as { key?: unknown }).key === "string");
}
