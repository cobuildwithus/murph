import type {
  HealthCommonsWebGoalIndexEntry,
  HealthCommonsWebGoalPage,
} from "@murphai/health-commons/runtime";
import {
  getGeneratedHealthCommonsWebGoalIndex,
  loadGeneratedHealthCommonsWebGoalPage,
} from "@murphai/health-commons/runtime";

import {
  isGoalCategorySlug,
  type GoalCategorySlug,
} from "@/src/lib/goals/goal-categories";
import type {
  GoalIndexEntryModel,
  GoalPageModel,
  GoalRouteResolution,
} from "@/src/lib/goals/goal-models";

export interface ResolvedHealthCommonsGoalPage {
  goal: GoalPageModel;
  route: GoalRouteResolution;
}

export function listHealthCommonsGoalEntries(): GoalIndexEntryModel[] {
  return getGeneratedHealthCommonsWebGoalIndex().goals.map(toGoalIndexEntryModel);
}

export function listHealthCommonsGoalRouteParams(): { goalId: string }[] {
  return listHealthCommonsGoalEntries().map((goal) => ({ goalId: goal.routeId }));
}

export function listHealthCommonsGoalRouteAliases(): string[] {
  return getGeneratedHealthCommonsWebGoalIndex().goals.flatMap((entry) => {
    const page = loadGeneratedHealthCommonsWebGoalPage({ routeId: entry.routeId });
    if (!page) {
      throw new Error(`Missing generated goal page for route: ${entry.routeId}.`);
    }
    return page.route.aliases;
  });
}

export function listHealthCommonsGoalsByCategory(
  category: GoalCategorySlug,
): GoalIndexEntryModel[] {
  return listHealthCommonsGoalEntries().filter((goal) => goal.category === category);
}

export function searchHealthCommonsGoals(query: string): GoalIndexEntryModel[] {
  const terms = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
  const goals = listHealthCommonsGoalEntries();

  if (terms.length === 0) {
    return goals;
  }

  return goals.filter((goal) => {
    const searchable = normalizeSearchText([
      goal.title,
      goal.summary,
      goal.goalPhrase,
      ...goal.aliases,
    ].join(" "));

    return terms.every((term) => searchable.includes(term));
  });
}

export function resolveHealthCommonsGoalPage(
  requestedRouteId: string,
): ResolvedHealthCommonsGoalPage | null {
  const page = loadGeneratedHealthCommonsWebGoalPage({ routeId: requestedRouteId });
  if (!page) {
    return null;
  }

  const entry = getGeneratedHealthCommonsWebGoalIndex().goals.find(
    (candidate) => candidate.key === page.key,
  );
  if (!entry) {
    return null;
  }

  const model = toGoalPageModel(entry, page);
  const normalizedRequest = normalizeRouteId(requestedRouteId);

  return {
    goal: model,
    route: {
      canonicalRouteId: model.routeId,
      entry: model,
      isAlias: normalizedRequest !== model.routeId,
    },
  };
}

export function listTopLevelGoals(
  goals: readonly GoalIndexEntryModel[],
): GoalIndexEntryModel[] {
  const keys = new Set(goals.map((goal) => goal.key));
  return goals.filter((goal) => !goal.parentGoalKey || !keys.has(goal.parentGoalKey));
}

function toGoalPageModel(
  entry: HealthCommonsWebGoalIndexEntry,
  page: HealthCommonsWebGoalPage,
): GoalPageModel {
  return {
    ...toGoalIndexEntryModel(entry),
    aliases: uniqueStrings([...entry.aliases, ...page.aliases]),
    body: page.body,
    indexable: page.goal.indexable,
    routeId: page.route.routeId,
    startPrompt: page.goal.startPrompt,
  };
}

function toGoalIndexEntryModel(
  entry: HealthCommonsWebGoalIndexEntry,
): GoalIndexEntryModel {
  if (!isGoalCategorySlug(entry.category)) {
    throw new Error(`Unsupported generated goal category: ${entry.category}.`);
  }

  return {
    aliases: entry.aliases,
    category: entry.category,
    goalPhrase: entry.goalPhrase,
    key: entry.key,
    outcomeKind: entry.outcomeKind,
    parentGoalKey: entry.parentGoalKey,
    routeId: entry.routeId,
    startPrompt: entry.startPrompt,
    summary: entry.summary,
    title: entry.title,
  };
}

function normalizeRouteId(value: string): string {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
