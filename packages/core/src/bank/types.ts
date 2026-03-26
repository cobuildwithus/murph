import type { DateInput } from "../types.js";

export const GOAL_SCHEMA_VERSION = "hb.frontmatter.goal.v1";
export const GOAL_DOC_TYPE = "goal";
export const GOAL_STATUSES = ["active", "paused", "completed", "abandoned"] as const;
export const GOAL_HORIZONS = ["short_term", "medium_term", "long_term", "ongoing"] as const;

export const CONDITION_SCHEMA_VERSION = "hb.frontmatter.condition.v1";
export const CONDITION_DOC_TYPE = "condition";
export const CONDITION_CLINICAL_STATUSES = ["active", "inactive", "resolved"] as const;
export const CONDITION_VERIFICATION_STATUSES = [
  "unconfirmed",
  "provisional",
  "confirmed",
  "refuted",
] as const;
export const CONDITION_SEVERITIES = ["mild", "moderate", "severe"] as const;

export const ALLERGY_SCHEMA_VERSION = "hb.frontmatter.allergy.v1";
export const ALLERGY_DOC_TYPE = "allergy";
export const ALLERGY_STATUSES = ["active", "inactive", "resolved"] as const;
export const ALLERGY_CRITICALITIES = ["low", "high", "unable_to_assess"] as const;

export const PROTOCOL_SCHEMA_VERSION = "hb.frontmatter.protocol.v1";
export const PROTOCOL_DOC_TYPE = "protocol";
export const PROTOCOL_KINDS = ["medication", "supplement", "therapy", "habit"] as const;
export const PROTOCOL_STATUSES = ["active", "paused", "completed", "stopped"] as const;

export const RECIPE_SCHEMA_VERSION = "hb.frontmatter.recipe.v1";
export const RECIPE_DOC_TYPE = "recipe";
export const RECIPE_STATUSES = ["draft", "saved", "archived"] as const;

export const FOOD_SCHEMA_VERSION = "hb.frontmatter.food.v1";
export const FOOD_DOC_TYPE = "food";
export const FOOD_STATUSES = ["active", "archived"] as const;

export const GOALS_DIRECTORY = "bank/goals";
export const CONDITIONS_DIRECTORY = "bank/conditions";
export const ALLERGIES_DIRECTORY = "bank/allergies";
export const FOODS_DIRECTORY = "bank/foods";
export const RECIPES_DIRECTORY = "bank/recipes";
export const PROTOCOLS_DIRECTORY = "bank/protocols";

export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
export type ConditionVerificationStatus = (typeof CONDITION_VERIFICATION_STATUSES)[number];
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];
export type FoodStatus = (typeof FOOD_STATUSES)[number];
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];
export type ProtocolStatus = (typeof PROTOCOL_STATUSES)[number];

export interface FoodAutoLogDailyRule {
  time: string;
}

export interface FoodRecord {
  schemaVersion: typeof FOOD_SCHEMA_VERSION;
  docType: typeof FOOD_DOC_TYPE;
  foodId: string;
  slug: string;
  title: string;
  status: FoodStatus;
  summary?: string;
  kind?: string;
  brand?: string;
  vendor?: string;
  location?: string;
  serving?: string;
  aliases?: string[];
  ingredients?: string[];
  tags?: string[];
  note?: string;
  autoLogDaily?: FoodAutoLogDailyRule;
  relativePath: string;
  markdown: string;
}

export interface UpsertFoodInput {
  vaultRoot: string;
  foodId?: string;
  slug?: string;
  allowSlugRename?: boolean;
  title?: string;
  status?: FoodStatus;
  summary?: string;
  kind?: string;
  brand?: string;
  vendor?: string;
  location?: string;
  serving?: string;
  aliases?: string[];
  ingredients?: string[];
  tags?: string[];
  note?: string;
  autoLogDaily?: FoodAutoLogDailyRule | null;
}

export interface UpsertFoodResult {
  created: boolean;
  auditPath: string;
  record: FoodRecord;
}

export interface ReadFoodInput {
  vaultRoot: string;
  foodId?: string;
  slug?: string;
}

export interface SupplementIngredientRecord {
  compound: string;
  label?: string;
  amount?: number;
  unit?: string;
  active?: boolean;
  note?: string;
}

export interface RecipeRecord {
  schemaVersion: typeof RECIPE_SCHEMA_VERSION;
  docType: typeof RECIPE_DOC_TYPE;
  recipeId: string;
  slug: string;
  title: string;
  status: RecipeStatus;
  summary?: string;
  cuisine?: string;
  dishType?: string;
  source?: string;
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  tags?: string[];
  ingredients?: string[];
  steps?: string[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  relativePath: string;
  markdown: string;
}

export interface UpsertRecipeInput {
  vaultRoot: string;
  recipeId?: string;
  slug?: string;
  title?: string;
  status?: RecipeStatus;
  summary?: string;
  cuisine?: string;
  dishType?: string;
  source?: string;
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  tags?: string[];
  ingredients?: string[];
  steps?: string[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
}

export interface UpsertRecipeResult {
  created: boolean;
  auditPath: string;
  record: RecipeRecord;
}

export interface ReadRecipeInput {
  vaultRoot: string;
  recipeId?: string;
  slug?: string;
}

export interface GoalWindow {
  startAt: string;
  targetAt?: string;
}

export interface GoalRecord {
  schemaVersion: typeof GOAL_SCHEMA_VERSION;
  docType: typeof GOAL_DOC_TYPE;
  goalId: string;
  slug: string;
  title: string;
  status: GoalStatus;
  horizon: GoalHorizon;
  priority: number;
  window: GoalWindow;
  parentGoalId?: string | null;
  relatedGoalIds?: string[];
  relatedExperimentIds?: string[];
  domains?: string[];
  relativePath: string;
  markdown: string;
}

export interface UpsertGoalInput {
  vaultRoot: string;
  goalId?: string;
  slug?: string;
  title?: string;
  status?: GoalStatus;
  horizon?: GoalHorizon;
  priority?: number;
  window?: {
    startAt?: DateInput;
    targetAt?: DateInput;
  };
  parentGoalId?: string | null;
  relatedGoalIds?: string[];
  relatedExperimentIds?: string[];
  domains?: string[];
}

export interface UpsertGoalResult {
  created: boolean;
  auditPath: string;
  record: GoalRecord;
}

export interface ReadGoalInput {
  vaultRoot: string;
  goalId?: string;
  slug?: string;
}

export interface ConditionRecord {
  schemaVersion: typeof CONDITION_SCHEMA_VERSION;
  docType: typeof CONDITION_DOC_TYPE;
  conditionId: string;
  slug: string;
  title: string;
  clinicalStatus: ConditionClinicalStatus;
  verificationStatus?: ConditionVerificationStatus;
  assertedOn?: string;
  resolvedOn?: string;
  severity?: ConditionSeverity;
  bodySites?: string[];
  relatedGoalIds?: string[];
  relatedProtocolIds?: string[];
  note?: string;
  relativePath: string;
  markdown: string;
}

export interface UpsertConditionInput {
  vaultRoot: string;
  conditionId?: string;
  slug?: string;
  title?: string;
  clinicalStatus?: ConditionClinicalStatus;
  verificationStatus?: ConditionVerificationStatus;
  assertedOn?: DateInput;
  resolvedOn?: DateInput;
  severity?: ConditionSeverity;
  bodySites?: string[];
  relatedGoalIds?: string[];
  relatedProtocolIds?: string[];
  note?: string;
}

export interface UpsertConditionResult {
  created: boolean;
  auditPath: string;
  record: ConditionRecord;
}

export interface ReadConditionInput {
  vaultRoot: string;
  conditionId?: string;
  slug?: string;
}

export interface AllergyRecord {
  schemaVersion: typeof ALLERGY_SCHEMA_VERSION;
  docType: typeof ALLERGY_DOC_TYPE;
  allergyId: string;
  slug: string;
  title: string;
  substance: string;
  status: AllergyStatus;
  criticality?: AllergyCriticality;
  reaction?: string;
  recordedOn?: string;
  relatedConditionIds?: string[];
  note?: string;
  relativePath: string;
  markdown: string;
}

export interface UpsertAllergyInput {
  vaultRoot: string;
  allergyId?: string;
  slug?: string;
  title?: string;
  substance?: string;
  status?: AllergyStatus;
  criticality?: AllergyCriticality;
  reaction?: string;
  recordedOn?: DateInput;
  relatedConditionIds?: string[];
  note?: string;
}

export interface UpsertAllergyResult {
  created: boolean;
  auditPath: string;
  record: AllergyRecord;
}

export interface ReadAllergyInput {
  vaultRoot: string;
  allergyId?: string;
  slug?: string;
}

export interface ProtocolItemRecord {
  schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
  docType: typeof PROTOCOL_DOC_TYPE;
  protocolId: string;
  slug: string;
  title: string;
  kind: ProtocolKind;
  status: ProtocolStatus;
  startedOn: string;
  stoppedOn?: string;
  substance?: string;
  dose?: number;
  unit?: string;
  schedule?: string;
  brand?: string;
  manufacturer?: string;
  servingSize?: string;
  ingredients?: SupplementIngredientRecord[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  group: string;
  relativePath: string;
  markdown: string;
}

export interface UpsertProtocolItemInput {
  vaultRoot: string;
  protocolId?: string;
  slug?: string;
  allowSlugRename?: boolean;
  title?: string;
  kind?: ProtocolKind;
  status?: ProtocolStatus;
  startedOn?: DateInput;
  stoppedOn?: DateInput;
  substance?: string;
  dose?: number;
  unit?: string;
  schedule?: string;
  brand?: string;
  manufacturer?: string;
  servingSize?: string;
  ingredients?: SupplementIngredientRecord[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  group?: string;
}

export interface UpsertProtocolItemResult {
  created: boolean;
  auditPath: string;
  record: ProtocolItemRecord;
}

export interface ReadProtocolItemInput {
  vaultRoot: string;
  protocolId?: string;
  slug?: string;
  group?: string;
}

export interface StopProtocolItemInput {
  vaultRoot: string;
  protocolId?: string;
  slug?: string;
  group?: string;
  stoppedOn?: DateInput;
}

export interface StopProtocolItemResult {
  auditPath: string;
  record: ProtocolItemRecord;
}
