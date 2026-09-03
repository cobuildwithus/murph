import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";

export interface GoalSearchItem {
  goalPhrase: string;
  illustrationSrc?: string | null;
  key: string;
  routeId: string;
  searchText: string;
  title: string;
}

export function createGoalSearchItem(
  goal: GoalIndexEntryModel,
): GoalSearchItem {
  return {
    goalPhrase: goal.goalPhrase,
    key: goal.key,
    routeId: goal.routeId,
    searchText: normalizeGoalSearchText([
      goal.title,
      goal.summary,
      goal.goalPhrase,
      ...goal.aliases,
    ].join(" ")),
    title: goal.title,
  };
}

export function searchGoalItems(
  goals: readonly GoalSearchItem[],
  query: string,
): GoalSearchItem[] {
  const normalizedQuery = normalizeGoalSearchText(query);
  const terms = tokenizeGoalSearchText(normalizedQuery);

  if (terms.length === 0) {
    return [];
  }

  return goals
    .map((goal, index) => ({
      goal,
      index,
      score: rankGoalSearchItem(goal, normalizedQuery, terms),
    }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) =>
      (left.score ?? Number.MAX_SAFE_INTEGER)
        - (right.score ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    )
    .map(({ goal }) => goal);
}

function normalizeGoalSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\u2080-\u2089]/gu, (digit) =>
      String.fromCharCode("0".charCodeAt(0) + digit.charCodeAt(0) - 0x2080)
    )
    .toLowerCase()
    .trim();
}

function tokenizeGoalSearchText(value: string): string[] {
  return normalizeGoalSearchText(value).match(/[a-z0-9]+/gu) ?? [];
}

function rankGoalSearchItem(
  goal: GoalSearchItem,
  normalizedQuery: string,
  queryTerms: readonly string[],
): number | null {
  const searchTokens = tokenizeGoalSearchText(goal.searchText);
  if (
    !queryTerms.every((term) =>
      searchTokens.some((token) => token.startsWith(term))
    )
  ) {
    return null;
  }

  const normalizedTitle = normalizeGoalSearchText(goal.title);
  const normalizedGoalPhrase = normalizeGoalSearchText(goal.goalPhrase);
  if (normalizedTitle === normalizedQuery) {
    return 0;
  }
  if (normalizedGoalPhrase === normalizedQuery) {
    return 1;
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 2;
  }
  if (normalizedGoalPhrase.startsWith(normalizedQuery)) {
    return 3;
  }

  const titleTokens = tokenizeGoalSearchText(normalizedTitle);
  if (
    queryTerms.every((term) => titleTokens.some((token) => token === term))
  ) {
    return 4;
  }
  if (
    queryTerms.every((term) =>
      titleTokens.some((token) => token.startsWith(term))
    )
  ) {
    return 5;
  }
  return 6;
}
