import type { GoalCategorySlug } from "./goal-categories";

export interface GoalIndexEntryModel {
  aliases: string[];
  category: GoalCategorySlug;
  goalPhrase: string;
  key: string;
  parentGoalKey: string | null;
  routeId: string;
  startPrompt: string;
  summary: string;
  title: string;
}

export interface GoalPageModel extends GoalIndexEntryModel {
  body: string;
  indexable: boolean;
}

export interface GoalRouteResolution {
  canonicalRouteId: string;
  entry: GoalIndexEntryModel;
  isAlias: boolean;
}
