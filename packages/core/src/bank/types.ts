import {
  ALLERGY_CRITICALITIES as CONTRACT_ALLERGY_CRITICALITIES,
  ALLERGY_STATUSES as CONTRACT_ALLERGY_STATUSES,
  CONDITION_CLINICAL_STATUSES as CONTRACT_CONDITION_CLINICAL_STATUSES,
  CONDITION_SEVERITIES as CONTRACT_CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES as CONTRACT_CONDITION_VERIFICATION_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  FOOD_STATUSES as CONTRACT_FOOD_STATUSES,
  FRONTMATTER_DOC_TYPES,
  GOAL_HORIZONS as CONTRACT_GOAL_HORIZONS,
  GOAL_STATUSES as CONTRACT_GOAL_STATUSES,
  PROTOCOL_KINDS as CONTRACT_PROTOCOL_KINDS,
  PROTOCOL_STATUSES as CONTRACT_PROTOCOL_STATUSES,
  RECIPE_STATUSES as CONTRACT_RECIPE_STATUSES,
  WORKOUT_FORMAT_STATUSES as CONTRACT_WORKOUT_FORMAT_STATUSES,
  type WorkoutTemplate,
  type MarkdownDocumentEnvelope as ContractMarkdownDocumentEnvelope,
  type StoredMarkdownDocument as ContractStoredMarkdownDocument,
} from "@murphai/contracts";

import type { DateInput } from "../types.ts";

export const GOAL_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.goalFrontmatter;
export const GOAL_DOC_TYPE = FRONTMATTER_DOC_TYPES.goal;
export const GOAL_STATUSES = CONTRACT_GOAL_STATUSES;
export const GOAL_HORIZONS = CONTRACT_GOAL_HORIZONS;

export const CONDITION_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.conditionFrontmatter;
export const CONDITION_DOC_TYPE = FRONTMATTER_DOC_TYPES.condition;
export const CONDITION_CLINICAL_STATUSES = CONTRACT_CONDITION_CLINICAL_STATUSES;
export const CONDITION_VERIFICATION_STATUSES = CONTRACT_CONDITION_VERIFICATION_STATUSES;
export const CONDITION_SEVERITIES = CONTRACT_CONDITION_SEVERITIES;

export const ALLERGY_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.allergyFrontmatter;
export const ALLERGY_DOC_TYPE = FRONTMATTER_DOC_TYPES.allergy;
export const ALLERGY_STATUSES = CONTRACT_ALLERGY_STATUSES;
export const ALLERGY_CRITICALITIES = CONTRACT_ALLERGY_CRITICALITIES;

export const PROTOCOL_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.protocolFrontmatter;
export const PROTOCOL_DOC_TYPE = FRONTMATTER_DOC_TYPES.protocol;
export const PROTOCOL_KINDS = CONTRACT_PROTOCOL_KINDS;
export const PROTOCOL_STATUSES = CONTRACT_PROTOCOL_STATUSES;

export const RECIPE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.recipeFrontmatter;
export const RECIPE_DOC_TYPE = FRONTMATTER_DOC_TYPES.recipe;
export const RECIPE_STATUSES = CONTRACT_RECIPE_STATUSES;

export const FOOD_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.foodFrontmatter;
export const FOOD_DOC_TYPE = FRONTMATTER_DOC_TYPES.food;
export const FOOD_STATUSES = CONTRACT_FOOD_STATUSES;

export const WORKOUT_FORMAT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.workoutFormatFrontmatter;
export const WORKOUT_FORMAT_DOC_TYPE = FRONTMATTER_DOC_TYPES.workoutFormat;
export const WORKOUT_FORMAT_STATUSES = CONTRACT_WORKOUT_FORMAT_STATUSES;

export const GOALS_DIRECTORY = "bank/goals";
export const CONDITIONS_DIRECTORY = "bank/conditions";
export const ALLERGIES_DIRECTORY = "bank/allergies";
export const FOODS_DIRECTORY = "bank/foods";
export const RECIPES_DIRECTORY = "bank/recipes";
export const PROTOCOLS_DIRECTORY = "bank/protocols";
export const WORKOUT_FORMATS_DIRECTORY = "bank/workout-formats";

export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
export type ConditionVerificationStatus = (typeof CONDITION_VERIFICATION_STATUSES)[number];
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];
export type FoodStatus = (typeof FOOD_STATUSES)[number];
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export type WorkoutFormatStatus = (typeof WORKOUT_FORMAT_STATUSES)[number];
export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];
export type ProtocolStatus = (typeof PROTOCOL_STATUSES)[number];

export type MarkdownRegistryDocumentEnvelope = ContractMarkdownDocumentEnvelope;

export type StoredMarkdownRegistryEntity<TEntity> = ContractStoredMarkdownDocument<
  TEntity,
  MarkdownRegistryDocumentEnvelope
>;

export interface FoodAutoLogDailyRule {
  time: string;
}

export interface WorkoutFormatRecord {
  schemaVersion: typeof WORKOUT_FORMAT_SCHEMA_VERSION;
  docType: typeof WORKOUT_FORMAT_DOC_TYPE;
  workoutFormatId: string;
  slug: string;
  title: string;
  status: WorkoutFormatStatus;
  summary?: string;
  activityType: string;
  durationMinutes?: number;
  distanceKm?: number;
  template: WorkoutTemplate;
  tags?: string[];
  note?: string;
  templateText?: string;
  relativePath: string;
  markdown: string;
}

export interface UpsertWorkoutFormatInput {
  vaultRoot: string;
  workoutFormatId?: string;
  slug?: string;
  allowSlugRename?: boolean;
  title?: string;
  status?: WorkoutFormatStatus;
  summary?: string;
  activityType?: string;
  durationMinutes?: number;
  distanceKm?: number;
  template?: WorkoutTemplate;
  tags?: string[];
  note?: string;
  templateText?: string;
}

export interface UpsertWorkoutFormatResult {
  created: boolean;
  auditPath: string;
  record: WorkoutFormatRecord;
}

export interface ReadWorkoutFormatInput {
  vaultRoot: string;
  workoutFormatId?: string;
  slug?: string;
}

export type FoodLinkType = "related_protocol";

export interface FoodLink {
  type: FoodLinkType;
  targetId: string;
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
  attachedProtocolIds?: string[];
  links: FoodLink[];
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
  attachedProtocolIds?: string[];
  links?: FoodLink[];
  autoLogDaily?: FoodAutoLogDailyRule | null;
}

export interface UpsertFoodResult {
  created: boolean;
  auditPath: string;
  record: FoodRecord;
}

export interface DeleteFoodInput {
  vaultRoot: string;
  foodId?: string;
  slug?: string;
}

export interface DeleteFoodResult {
  foodId: string;
  relativePath: string;
  deleted: true;
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

export type RecipeLinkType = "supports_goal" | "addresses_condition";

export interface RecipeLink {
  type: RecipeLinkType;
  targetId: string;
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
  links: RecipeLink[];
  relativePath: string;
  markdown: string;
}

export interface UpsertRecipeInput {
  vaultRoot: string;
  recipeId?: string;
  allowSlugRename?: boolean;
  slug?: string;
  title?: string;
  status?: RecipeStatus;
  summary?: string;
  cuisine?: string;
  dishType?: string;
  source?: string;
  servings?: number | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  tags?: string[];
  ingredients?: string[];
  steps?: string[];
  relatedGoalIds?: string[];
  relatedConditionIds?: string[];
  links?: RecipeLink[];
}

export interface UpsertRecipeResult {
  created: boolean;
  auditPath: string;
  record: RecipeRecord;
}

export interface DeleteRecipeInput {
  vaultRoot: string;
  recipeId?: string;
  slug?: string;
}

export interface DeleteRecipeResult {
  recipeId: string;
  relativePath: string;
  deleted: true;
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

export type GoalLinkType = "parent_goal" | "related_goal" | "related_experiment";

export interface GoalLink {
  type: GoalLinkType;
  targetId: string;
}

export interface GoalEntity {
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
  links: GoalLink[];
}

export type GoalStoredDocument = StoredMarkdownRegistryEntity<GoalEntity>;

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
  links?: GoalLink[];
  domains?: string[];
}

export interface UpsertGoalResult {
  created: boolean;
  auditPath: string;
  record: GoalStoredDocument;
}

export interface ReadGoalInput {
  vaultRoot: string;
  goalId?: string;
  slug?: string;
}

export type ConditionLinkType = "related_goal" | "related_protocol";

export interface ConditionLink {
  type: ConditionLinkType;
  targetId: string;
}

export interface ConditionEntity {
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
  links: ConditionLink[];
}

export type ConditionStoredDocument = StoredMarkdownRegistryEntity<ConditionEntity>;

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
  links?: ConditionLink[];
  note?: string;
}

export interface UpsertConditionResult {
  created: boolean;
  auditPath: string;
  record: ConditionStoredDocument;
}

export interface ReadConditionInput {
  vaultRoot: string;
  conditionId?: string;
  slug?: string;
}

export type AllergyLinkType = "related_condition";

export interface AllergyLink {
  type: AllergyLinkType;
  targetId: string;
}

export interface AllergyEntity {
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
  links: AllergyLink[];
}

export type AllergyStoredDocument = StoredMarkdownRegistryEntity<AllergyEntity>;

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
  links?: AllergyLink[];
  note?: string;
}

export type ProtocolLinkType = "supports_goal" | "addresses_condition" | "related_protocol";

export interface ProtocolLink {
  type: ProtocolLinkType;
  targetId: string;
}

export interface UpsertAllergyResult {
  created: boolean;
  auditPath: string;
  record: AllergyStoredDocument;
}

export interface ReadAllergyInput {
  vaultRoot: string;
  allergyId?: string;
  slug?: string;
}

export interface ProtocolItemEntity {
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
  relatedProtocolIds?: string[];
  links: ProtocolLink[];
  group: string;
}

export type ProtocolItemStoredDocument = StoredMarkdownRegistryEntity<ProtocolItemEntity>;

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
  relatedProtocolIds?: string[];
  links?: ProtocolLink[];
  group?: string;
}

export interface UpsertProtocolItemResult {
  created: boolean;
  auditPath: string;
  record: ProtocolItemStoredDocument;
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
  record: ProtocolItemStoredDocument;
}
