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

export const REGIMEN_SCHEMA_VERSION = "hb.frontmatter.regimen.v1";
export const REGIMEN_DOC_TYPE = "regimen";
export const REGIMEN_KINDS = ["medication", "supplement", "therapy", "habit"] as const;
export const REGIMEN_STATUSES = ["active", "paused", "completed", "stopped"] as const;

export const GOALS_DIRECTORY = "bank/goals";
export const CONDITIONS_DIRECTORY = "bank/conditions";
export const ALLERGIES_DIRECTORY = "bank/allergies";
export const REGIMENS_DIRECTORY = "bank/regimens";

export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
export type ConditionVerificationStatus = (typeof CONDITION_VERIFICATION_STATUSES)[number];
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];
export type RegimenKind = (typeof REGIMEN_KINDS)[number];
export type RegimenStatus = (typeof REGIMEN_STATUSES)[number];

export interface SupplementIngredientRecord {
  compound: string;
  label?: string;
  amount?: number;
  unit?: string;
  active?: boolean;
  note?: string;
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
  relatedRegimenIds?: string[];
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
  relatedRegimenIds?: string[];
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

export interface RegimenItemRecord {
  schemaVersion: typeof REGIMEN_SCHEMA_VERSION;
  docType: typeof REGIMEN_DOC_TYPE;
  regimenId: string;
  slug: string;
  title: string;
  kind: RegimenKind;
  status: RegimenStatus;
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

export interface UpsertRegimenItemInput {
  vaultRoot: string;
  regimenId?: string;
  slug?: string;
  title?: string;
  kind?: RegimenKind;
  status?: RegimenStatus;
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

export interface UpsertRegimenItemResult {
  created: boolean;
  auditPath: string;
  record: RegimenItemRecord;
}

export interface ReadRegimenItemInput {
  vaultRoot: string;
  regimenId?: string;
  slug?: string;
  group?: string;
}

export interface StopRegimenItemInput {
  vaultRoot: string;
  regimenId?: string;
  slug?: string;
  group?: string;
  stoppedOn?: DateInput;
}

export interface StopRegimenItemResult {
  auditPath: string;
  record: RegimenItemRecord;
}
