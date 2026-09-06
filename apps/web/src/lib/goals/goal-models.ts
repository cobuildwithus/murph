import type {
  HealthCommonsWebGoalIndexEntry,
  HealthCommonsWebGoalPage,
} from "@murphai/health-commons/goal-runtime";

import type { GoalCategorySlug } from "./goal-categories";

export type GoalOutcomeKind = HealthCommonsWebGoalIndexEntry["outcomeKind"];

export interface GoalIndexEntryModel {
  aliases: string[];
  category: GoalCategorySlug;
  goalPhrase: string;
  key: string;
  outcomeKind: GoalOutcomeKind;
  parentGoalKey: string | null;
  routeId: string;
  startPrompt: string;
  summary: string;
  title: string;
}

export interface GoalPageModel extends GoalIndexEntryModel {
  body: string;
  indexable: boolean;
  sources: HealthCommonsWebGoalPage["sources"];
}

export interface GoalRouteResolution {
  canonicalRouteId: string;
  entry: GoalIndexEntryModel;
  isAlias: boolean;
}
