import * as z from "./zod-runtime.ts";

import { withContractMetadata } from "./schema-metadata.ts";
import {
  getHabitatAspectDefinition,
  getHabitatIndicatorDefinition,
  validateHabitatIndicatorValue,
  HABITAT_DOMAIN_IDS,
} from "./habitat-catalog.ts";
import {
  ADVERSE_EFFECT_SEVERITIES,
  ALLERGY_CRITICALITIES,
  ALLERGY_STATUSES,
  ASSESSMENT_SOURCES,
  AUDIT_ACTIONS,
  AUDIT_ACTORS,
  AUDIT_STATUSES,
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_RESULT_FLAGS,
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
  CONTRACT_ID_FORMAT,
  CONTRACT_SCHEMA_VERSION,
  CURRENT_VAULT_FORMAT_VERSION,
  ERROR_CODE_VALUES,
  EVENT_KINDS,
  EVENT_SOURCES,
  EXPERIMENT_PHASES,
  EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS,
  FOOD_STATUSES,
  FRONTMATTER_DOC_TYPES,
  GOAL_HORIZONS,
  GOAL_STATUSES,
  ID_PREFIXES,
  LEGACY_INBOX_CAPTURE_SCHEMA_VERSION,
  OBSERVATION_GRAINS,
  NUTRITION_CONFIDENCE_LEVELS,
  NUTRITION_PROVENANCE_SOURCES,
  PUBLIC_EVENT_WRITE_KINDS,
  RAW_ASSET_OWNER_KINDS,
  RAW_IMPORT_KINDS,
  PROTOCOL_STATUSES,
  RECIPE_STATUSES,
  REGIMEN_KINDS,
  REGIMEN_STATUSES,
  SUPPLEMENT_INGREDIENTS_MAX_ITEMS,
  WORKOUT_FORMAT_STATUSES,
  SAMPLE_QUALITIES,
  SAMPLE_SOURCES,
  SAMPLE_STREAMS,
  SLEEP_STAGES,
  TEST_RESULT_STATUSES,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "./constants.ts";
import { GENERIC_CONTRACT_ID_PATTERN, idPattern } from "./ids.ts";
import {
  isStrictIsoDate,
  isStrictIsoDateTime,
  isWritableIsoDateTime,
  isValidIanaTimeZone,
  WRITABLE_ISO_DATE_TIME_PATTERN,
} from "./time.ts";
import {
  allergyRelationLinkSchema,
  conditionRelationLinkSchema,
  eventRelationLinkSchema,
  familyRelationLinkSchema,
  foodRelationLinkSchema,
  geneticVariantRelationLinkSchema,
  goalRelationLinkSchema,
  recipeRelationLinkSchema,
  regimenRelationLinkSchema,
} from "./relation-links.ts";
import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
  healthCommonsActivitySessionEvidenceSchema,
  healthCommonsKeySchema,
  healthCommonsStableIdSchema,
} from "./health-commons.ts";
import { experimentRunScheduleIntentSchema } from "./schedule-intent.ts";

export {
  experimentRunScheduleIntentSchema,
  type ExperimentRunScheduleIntent,
  type ExperimentRunScheduleIntentKind,
} from "./schedule-intent.ts";

export type AssessmentSource = (typeof ASSESSMENT_SOURCES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type PublicWritableEventKind = (typeof PUBLIC_EVENT_WRITE_KINDS)[number];
export type EventSource = (typeof EVENT_SOURCES)[number];
export type ExperimentPhase = (typeof EXPERIMENT_PHASES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type RawAssetOwnerKind = (typeof RAW_ASSET_OWNER_KINDS)[number];
export type RawImportKind = (typeof RAW_IMPORT_KINDS)[number];
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
export type ConditionVerificationStatus = (typeof CONDITION_VERIFICATION_STATUSES)[number];
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];
export type FoodStatus = (typeof FOOD_STATUSES)[number];
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export type NutritionProvenanceSource = (typeof NUTRITION_PROVENANCE_SOURCES)[number];
export type NutritionConfidenceLevel = (typeof NUTRITION_CONFIDENCE_LEVELS)[number];
export type ProtocolStatus = (typeof PROTOCOL_STATUSES)[number];
export type RegimenKind = (typeof REGIMEN_KINDS)[number];
export type RegimenStatus = (typeof REGIMEN_STATUSES)[number];
export type SampleStream = (typeof SAMPLE_STREAMS)[number];
export type SampleSource = (typeof SAMPLE_SOURCES)[number];
export type SampleQuality = (typeof SAMPLE_QUALITIES)[number];
export type SleepStage = (typeof SLEEP_STAGES)[number];
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];
export type BloodTestFastingStatus = (typeof BLOOD_TEST_FASTING_STATUSES)[number];
export type BloodTestResultFlag = (typeof BLOOD_TEST_RESULT_FLAGS)[number];
export type ClinicalAssertionType = (typeof CLINICAL_ASSERTION_TYPES)[number];
export type ClinicalAssertionDomain = (typeof CLINICAL_ASSERTION_DOMAINS)[number];
export type ClinicalAssertionPolarity = (typeof CLINICAL_ASSERTION_POLARITIES)[number];
export type AdverseEffectSeverity = (typeof ADVERSE_EFFECT_SEVERITIES)[number];
export type VariantZygosity = (typeof VARIANT_ZYGOSITIES)[number];
export type VariantSignificance = (typeof VARIANT_SIGNIFICANCES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditActor = (typeof AUDIT_ACTORS)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type FileChangeOperation = (typeof FILE_CHANGE_OPERATIONS)[number];
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type ErrorCodeValue = (typeof ERROR_CODE_VALUES)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

const DAY_KEY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const RAW_PATH_PATTERN = "^raw/[A-Za-z0-9._/-]+$";
const RAW_ASSESSMENT_SOURCE_PATTERN = "^raw/assessments/[A-Za-z0-9._/-]+/source\\.json$";
const RELATIVE_PATH_PATTERN = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$";
const SINGLE_PATH_SEGMENT_PATTERN = "^[A-Za-z0-9._-]+$";
const IANA_TIME_ZONE_DESCRIPTION = "IANA time zone; runtime validates support with Intl.";
const SHA256_HEX_PATTERN = "^[a-f0-9]{64}$";
const SHA256_DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const DEVICE_DATA_ORIGIN_SLUG_PATTERN = "^[a-z0-9]+(?:[-_][a-z0-9]+)*$";
const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const UNIT_PATTERN = "^[A-Za-z0-9._/%^-]+$";
const GENERIC_CONTRACT_ID_REGEX = new RegExp(GENERIC_CONTRACT_ID_PATTERN);
const EXPERIMENT_SIGNAL_DIRECTIONS = ["increase", "decrease", "stabilize"] as const;
export const EXPERIMENT_OUTCOME_STATISTICS = [
  "latest",
  "count",
  "mean",
  "median",
  "min",
  "max",
  "sum",
] as const;
export type ExperimentOutcomeStatistic = (typeof EXPERIMENT_OUTCOME_STATISTICS)[number];
const EXPERIMENT_CHECKIN_CADENCES = ["none", "daily", "every_3_days", "weekly"] as const;
const EXPERIMENT_NOTIFICATION_STYLES = [
  "skip_by_default",
  "send_scheduled_summary",
] as const;
const EXPERIMENT_ADHERENCE_STATUSES = [
  "not_started",
  "behind",
  "on_track",
  "met_minimum",
  "met_target",
  "unknown",
] as const;
const EXPERIMENT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
const EXPERIMENT_CONTEXT_SEVERITIES = [
  "info",
  "potential_confounder",
  "safety",
  "blocking",
] as const;
const EXPERIMENT_DATA_COMPLETENESS_LEVELS = [
  "insufficient",
  "partial",
  "good",
] as const;
const EXPERIMENT_PROGRESS_PHASES = [
  "planned",
  "baseline",
  "intervention",
  "review_due",
  "completed",
  "paused",
  "abandoned",
] as const;
const EXPERIMENT_RECOMMENDATION_ACTIONS = ["skip", "remind", "summary", "review"] as const;
const EXPERIMENT_COVERAGE_STATUSES = [
  "no_wearable_data",
  "insufficient",
  "partial",
  "sufficient_for_progress",
  "ready_for_review",
] as const;
const EXPERIMENT_ANALYSIS_STATUSES = ["not_ready", "ready", "generated"] as const;
export const LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION = "murph.experiment-outcome.v1" as const;
export const EXPERIMENT_OUTCOME_SCHEMA_VERSION = "murph.experiment-outcome.v2" as const;
const EXPERIMENT_OUTCOME_SCHEMA_VERSIONS = [
  LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
] as const;
export const EXPERIMENT_PROGRESS_SCHEMA_VERSION = "murph.experiment-progress.v2" as const;
export const FAMILY_MEMBER_LIMITS = Object.freeze({
  title: 160,
  relationship: 120,
  condition: 160,
  conditionCode: 80,
  conditionSource: 240,
  note: 4000,
} as const);

export const GENETIC_VARIANT_LIMITS = Object.freeze({
  title: 160,
  gene: 40,
  inheritance: 120,
  note: 4000,
} as const);

function boundedString(minLength: number, maxLength: number): z.ZodString {
  return z.string().min(minLength).max(maxLength);
}

function patternedString(pattern: string, minLength?: number, maxLength?: number): z.ZodString {
  let schema = z.string();

  if (minLength !== undefined) {
    schema = schema.min(minLength);
  }

  if (maxLength !== undefined) {
    schema = schema.max(maxLength);
  }

  return schema.regex(new RegExp(pattern));
}

function isoDateTimeString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date-time" })
    .refine((value) => isStrictIsoDateTime(value), "Invalid ISO date-time string.");
}

function writableIsoDateTimeString(maxLength?: number): z.ZodType<string> {
  let schema = z.string();
  if (maxLength !== undefined) {
    schema = schema.max(maxLength);
  }

  return schema
    .regex(WRITABLE_ISO_DATE_TIME_PATTERN)
    .meta({ format: "date-time" })
    .refine((value) => isWritableIsoDateTime(value), "Invalid ISO date-time string.");
}

function isoDateString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date" })
    .refine((value) => isStrictIsoDate(value), "Invalid ISO date string.");
}

function timeZoneString(): z.ZodString;
function timeZoneString(options: { optional: true }): z.ZodOptional<z.ZodString>;
function timeZoneString(options: { optional?: boolean } = {}) {
  const schema = boundedString(3, 64)
    .refine(
      (value) => isValidIanaTimeZone(value),
      "Invalid IANA time zone.",
    )
    .describe(IANA_TIME_ZONE_DESCRIPTION);

  return options.optional ? schema.optional() : schema;
}

function integerSchema(minimum?: number, maximum?: number): z.ZodType<number> {
  let schema = z.number();

  if (minimum !== undefined) {
    schema = schema.min(minimum);
  }

  if (maximum !== undefined) {
    schema = schema.max(maximum);
  }

  return schema
    .meta({ type: "integer" })
    .refine((value) => Number.isInteger(value), "Expected an integer.");
}

function numberSchema(minimum?: number, maximum?: number): z.ZodNumber {
  let schema = z.number();

  if (minimum !== undefined) {
    schema = schema.min(minimum);
  }

  if (maximum !== undefined) {
    schema = schema.max(maximum);
  }

  return schema;
}

function uniqueArray<TSchema extends z.ZodTypeAny>(
  itemSchema: TSchema,
  options: {
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  } = {},
): z.ZodArray<TSchema> {
  let schema: z.ZodArray<TSchema> = z.array(itemSchema);

  if (options.minItems !== undefined) {
    schema = schema.min(options.minItems);
  }

  if (options.maxItems !== undefined) {
    schema = schema.max(options.maxItems);
  }

  if (options.uniqueItems) {
    schema = schema
      .meta({ uniqueItems: true })
      .superRefine((values, context) => {
        const serialized = values.map((value) => JSON.stringify(value));
        if (new Set(serialized).size !== serialized.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected unique array items.",
          });
        }
      });
  }

  return schema;
}

function idSchema(prefix: string): z.ZodString {
  return patternedString(idPattern(prefix));
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.object({}).catchall(jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.object({}).catchall(jsonValueSchema);

export const externalRefSchema = z
  .object({
    system: patternedString(SLUG_PATTERN),
    resourceType: patternedString(SLUG_PATTERN),
    resourceId: boundedString(1, 200),
    version: boundedString(1, 200).optional(),
    facet: patternedString(SLUG_PATTERN).optional(),
  })
  .strict();

const clinicalEvidenceRefBaseShape = {
  sourceLabel: boundedString(1, 240).optional(),
  page: integerSchema(1).optional(),
  chunkId: boundedString(1, 120).optional(),
  spanStart: integerSchema(0).optional(),
  spanEnd: integerSchema(0).optional(),
  excerpt: boundedString(1, 500).optional(),
  confidence: numberSchema(0, 1).optional(),
};

const clinicalEvidenceRefWithDocumentSchema = z
  .object({
    ...clinicalEvidenceRefBaseShape,
    sourceDocumentId: idSchema(ID_PREFIXES.document),
    rawRef: patternedString(RAW_PATH_PATTERN).optional(),
  })
  .strict();

const clinicalEvidenceRefWithRawSchema = z
  .object({
    ...clinicalEvidenceRefBaseShape,
    sourceDocumentId: idSchema(ID_PREFIXES.document).optional(),
    rawRef: patternedString(RAW_PATH_PATTERN),
  })
  .strict();

export const clinicalEvidenceRefSchema = z
  .union([clinicalEvidenceRefWithDocumentSchema, clinicalEvidenceRefWithRawSchema])
  .superRefine((value, context) => {
    if (
      value.spanStart !== undefined &&
      value.spanEnd !== undefined &&
      value.spanEnd < value.spanStart
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "spanEnd must be greater than or equal to spanStart.",
        path: ["spanEnd"],
      });
    }
  });

export const familyConditionHistoryEntrySchema = z
  .object({
    condition: boundedString(1, FAMILY_MEMBER_LIMITS.condition),
    code: boundedString(1, FAMILY_MEMBER_LIMITS.conditionCode).optional(),
    codeSystem: boundedString(1, 80).optional(),
    status: z.enum(["present", "absent", "possible", "unknown"]).default("present"),
    certainty: z.enum(["reported", "documented", "suspected", "denied", "unknown"]).optional(),
    onsetAge: numberSchema(0, 130).optional(),
    onsetText: boundedString(1, 160).optional(),
    deceasedCause: z.boolean().optional(),
    sourceLabel: boundedString(1, FAMILY_MEMBER_LIMITS.conditionSource).optional(),
    evidence: z.array(clinicalEvidenceRefSchema).max(20).optional(),
    note: boundedString(1, FAMILY_MEMBER_LIMITS.note).optional(),
  })
  .strict();

export const clinicalNoteSectionSchema = z
  .object({
    kind: z
      .enum([
        "chief_complaint",
        "hpi",
        "ros",
        "exam",
        "assessment",
        "plan",
        "instructions",
        "results",
        "other",
      ])
      .optional(),
    heading: boundedString(1, 120),
    text: boundedString(1, 12000),
  })
  .strict();

export const deviceDataOriginSchema = z
  .object({
    version: z.literal(1),
    aggregatorProvider: patternedString(DEVICE_DATA_ORIGIN_SLUG_PATTERN, 1, 80).optional(),
    sourceProviderSlug: patternedString(DEVICE_DATA_ORIGIN_SLUG_PATTERN, 1, 80).optional(),
    sourceType: patternedString(DEVICE_DATA_ORIGIN_SLUG_PATTERN, 1, 80).optional(),
    sourceInstanceId: patternedString(DEVICE_DATA_ORIGIN_SLUG_PATTERN, 1, 120).nullable().optional(),
    observedAtRaw: boundedString(1, 160).optional(),
    timeZoneOffsetMinutes: integerSchema(-24 * 60, 24 * 60).nullable().optional(),
    timestampSemantics: z.enum(["utc", "offset", "floating", "unknown"]).optional(),
    originConfidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
    normalizerVersion: boundedString(1, 120).optional(),
  })
  .strict();

export const nutritionDataSchema = z
  .object({
    calories: numberSchema(0).optional(),
    proteinGrams: numberSchema(0).optional(),
    carbsGrams: numberSchema(0).optional(),
    fatGrams: numberSchema(0).optional(),
    fiberGrams: numberSchema(0).optional(),
    waterGrams: numberSchema(0).optional(),
  })
  .strict();

// Bounded micronutrient totals keyed by the Junction meal-summary `micros`
// contract. Key suffixes carry the summary-unit contract used by the pinned
// Junction SDK. The separate Junction Sense column API can expose converted
// units and must not be used to reinterpret persisted meal-summary values.
export const MEAL_MICRONUTRIENT_DEFINITIONS = Object.freeze([
  { category: "mineral", key: "sodiumGrams", label: "Sodium", unit: "g" },
  { category: "mineral", key: "potassiumGrams", label: "Potassium", unit: "g" },
  { category: "mineral", key: "calciumMg", label: "Calcium", unit: "mg" },
  { category: "mineral", key: "phosphorusMg", label: "Phosphorus", unit: "mg" },
  { category: "mineral", key: "magnesiumMg", label: "Magnesium", unit: "mg" },
  { category: "mineral", key: "ironMg", label: "Iron", unit: "mg" },
  { category: "mineral", key: "zincMg", label: "Zinc", unit: "mg" },
  { category: "mineral", key: "fluorideMg", label: "Fluoride", unit: "mg" },
  { category: "mineral", key: "chlorideMg", label: "Chloride", unit: "mg" },
  { category: "trace_element", key: "chromiumMcg", label: "Chromium", unit: "mcg" },
  { category: "trace_element", key: "copperMg", label: "Copper", unit: "mg" },
  { category: "trace_element", key: "iodineMcg", label: "Iodine", unit: "mcg" },
  { category: "trace_element", key: "manganeseMg", label: "Manganese", unit: "mg" },
  { category: "trace_element", key: "molybdenumMcg", label: "Molybdenum", unit: "mcg" },
  { category: "trace_element", key: "seleniumMcg", label: "Selenium", unit: "mcg" },
  { category: "vitamin", key: "vitaminAMcg", label: "Vitamin A", unit: "mcg" },
  { category: "vitamin", key: "vitaminB1Mg", label: "Thiamin (B1)", unit: "mg" },
  { category: "vitamin", key: "riboflavinMg", label: "Riboflavin (B2)", unit: "mg" },
  { category: "vitamin", key: "niacinMg", label: "Niacin (B3)", unit: "mg" },
  { category: "vitamin", key: "pantothenicAcidMg", label: "Pantothenic acid (B5)", unit: "mg" },
  { category: "vitamin", key: "vitaminB6Mg", label: "Vitamin B6", unit: "mg" },
  { category: "vitamin", key: "biotinMcg", label: "Biotin (B7)", unit: "mcg" },
  { category: "vitamin", key: "vitaminB12Mcg", label: "Vitamin B12", unit: "mcg" },
  { category: "vitamin", key: "vitaminCMg", label: "Vitamin C", unit: "mg" },
  { category: "vitamin", key: "vitaminDMcg", label: "Vitamin D", unit: "mcg" },
  { category: "vitamin", key: "vitaminEMg", label: "Vitamin E", unit: "mg" },
  { category: "vitamin", key: "vitaminKMcg", label: "Vitamin K", unit: "mcg" },
  { category: "vitamin", key: "folicAcidMg", label: "Folic acid (B9)", unit: "mg" },
] as const);

export const MEAL_MICRONUTRIENT_KEYS = Object.freeze(
  MEAL_MICRONUTRIENT_DEFINITIONS.map(({ key }) => key),
);

export const mealMicronutrientsSchema = z
  .object(
    Object.fromEntries(
      MEAL_MICRONUTRIENT_KEYS.map((key) => [key, numberSchema(0).optional()]),
    ) as Record<(typeof MEAL_MICRONUTRIENT_KEYS)[number], z.ZodOptional<ReturnType<typeof numberSchema>>>,
  )
  .strict();

export const nutritionProvenanceSchema = z
  .object({
    source: z.enum(NUTRITION_PROVENANCE_SOURCES),
    confidence: z.enum(NUTRITION_CONFIDENCE_LEVELS).optional(),
    sourceDetail: boundedString(1, 240).optional(),
  })
  .strict();

export const foodNutritionSchema = z
  .object({
    perServing: nutritionDataSchema.optional(),
    provenance: nutritionProvenanceSchema.optional(),
  })
  .strict();

export const mealNutritionSchema = z
  .object({
    totals: nutritionDataSchema.optional(),
    micros: mealMicronutrientsSchema.optional(),
    provenance: nutritionProvenanceSchema.optional(),
  })
  .strict();

const activityStrengthExerciseBaseShape = {
  exercise: boundedString(1, 160),
  setCount: integerSchema(1, 150),
  repsPerSet: integerSchema(1),
  loadDescription: boundedString(1, 240).optional(),
} satisfies z.ZodRawShape;

const activityStrengthExerciseWithoutLoadSchema = z
  .object(activityStrengthExerciseBaseShape)
  .strict();

const activityStrengthExerciseWithLoadSchema = z
  .object({
    ...activityStrengthExerciseBaseShape,
    load: numberSchema(0),
    loadUnit: z.enum(["lb", "kg"]),
  })
  .strict();

export const activityStrengthExerciseSchema = z.union([
  activityStrengthExerciseWithoutLoadSchema,
  activityStrengthExerciseWithLoadSchema,
]);

export const workoutSetTypeSchema = z.enum(["normal", "warmup", "dropset", "failure"]);
export const workoutExerciseModeSchema = z.enum([
  "weight_reps",
  "bodyweight",
  "assisted_bodyweight",
  "weighted_bodyweight",
  "duration",
  "cardio",
]);
export const workoutLoadUnitSchema = z.enum(["lb", "kg"]);
export const storedMediaKindSchema = z.enum(["photo", "video", "gif", "image", "other"]);
export const eventAttachmentKindSchema = z.enum([
  "audio",
  "document",
  "gif",
  "image",
  "other",
  "photo",
  "video",
]);
export const bodyMeasurementTypeSchema = z.enum([
  "weight",
  "body_fat_pct",
  "waist",
  "neck",
  "shoulders",
  "chest",
  "biceps",
  "forearms",
  "abdomen",
  "hips",
  "thighs",
  "calves",
]);
export const bodyMeasurementUnitSchema = z.enum(["lb", "kg", "percent", "cm", "in"]);
export const measurementQualifierValueSchema = z.union([
  patternedString(SLUG_PATTERN),
  boundedString(1, 160),
  numberSchema(),
  z.boolean(),
]);
export const measurementQualifiersSchema = z.record(
  patternedString(SLUG_PATTERN),
  measurementQualifierValueSchema,
);
export const workoutWeightUnitPreferenceValueSchema = z.enum(["lb", "kg"]);
export const workoutBodyMeasurementUnitPreferenceValueSchema = z.enum(["cm", "in"]);

export const storedMediaSchema = z
  .object({
    kind: storedMediaKindSchema,
    relativePath: patternedString(RAW_PATH_PATTERN),
    mediaType: boundedString(1, 255).optional(),
    caption: boundedString(1, 4000).optional(),
  })
  .strict();

export const eventAttachmentSchema = z
  .object({
    role: boundedString(1, 160),
    kind: eventAttachmentKindSchema,
    relativePath: patternedString(RAW_PATH_PATTERN),
    mediaType: boundedString(1, 255),
    sha256: patternedString(SHA256_HEX_PATTERN, 64, 64),
    originalFileName: boundedString(1, 255),
  })
  .strict();

export const workoutSetSchema = z
  .object({
    order: integerSchema(1),
    type: workoutSetTypeSchema.optional(),
    note: boundedString(1, 400).optional(),
    reps: integerSchema(0).optional(),
    weight: numberSchema(0).optional(),
    weightUnit: workoutLoadUnitSchema.optional(),
    durationSeconds: integerSchema(0).optional(),
    distanceMeters: numberSchema(0).optional(),
    rpe: numberSchema(0, 10).optional(),
    bodyweightKg: numberSchema(0).optional(),
    assistanceKg: numberSchema(0).optional(),
    addedWeightKg: numberSchema(0).optional(),
  })
  .strict();

export const workoutExerciseSchema = z
  .object({
    name: boundedString(1, 160),
    sourceExerciseId: boundedString(1, 200).optional(),
    order: integerSchema(1),
    groupId: boundedString(1, 80).optional(),
    mode: workoutExerciseModeSchema.optional(),
    unitOverride: workoutLoadUnitSchema.optional(),
    note: boundedString(1, 4000).optional(),
    sets: z.array(workoutSetSchema).min(1).max(150),
  })
  .strict();

export const workoutSessionMetricsSchema = z
  .object({
    activeCalories: numberSchema(0).optional(),
    totalCalories: numberSchema(0).optional(),
    averageHeartRate: numberSchema(0).optional(),
    maxHeartRate: numberSchema(0).optional(),
    hrv: numberSchema(0).optional(),
    workoutStrain: numberSchema(0).optional(),
    percentRecorded: numberSchema(0).optional(),
    totalElevationGainMeters: numberSchema(0).optional(),
    altitudeChangeMeters: numberSchema().optional(),
    elevationHighMeters: numberSchema().optional(),
    elevationLowMeters: numberSchema().optional(),
    averageSpeedMps: numberSchema(0).optional(),
    maxSpeedMps: numberSchema(0).optional(),
    averagePowerWatts: numberSchema(0).optional(),
    maxPowerWatts: numberSchema(0).optional(),
    normalizedPowerWatts: numberSchema(0).optional(),
    weightedAveragePowerWatts: numberSchema(0).optional(),
    kilojoules: numberSchema(0).optional(),
  })
  .strict();

export const workoutHeartRateZoneSchema = z
  .object({
    zone: integerSchema(0, 20).optional(),
    label: boundedString(1, 80).optional(),
    minHeartRate: numberSchema(0).optional(),
    maxHeartRate: numberSchema(0).optional(),
    durationMinutes: numberSchema(0).optional(),
  })
  .strict();

export const workoutRouteMetadataSchema = z
  .object({
    routeId: boundedString(1, 200).optional(),
    routeName: boundedString(1, 160).optional(),
    mapId: boundedString(1, 200).optional(),
  })
  .strict();

export const workoutSessionSchema = z
  .object({
    sourceApp: patternedString(SLUG_PATTERN).optional(),
    sourceWorkoutId: boundedString(1, 200).optional(),
    sport: patternedString(SLUG_PATTERN, 1, 80).optional(),
    sportName: boundedString(1, 160).optional(),
    startedAt: isoDateTimeString().optional(),
    endedAt: isoDateTimeString().optional(),
    movingTimeMinutes: numberSchema(0).optional(),
    routineId: boundedString(1, 200).optional(),
    routineName: boundedString(1, 160).optional(),
    lastMemberActionId: z.string().length(36).uuid().optional(),
    sessionNote: boundedString(1, 4000).optional(),
    metrics: workoutSessionMetricsSchema.optional(),
    heartRateZones: z.array(workoutHeartRateZoneSchema).max(20).optional(),
    route: workoutRouteMetadataSchema.optional(),
    media: z.array(storedMediaSchema).max(10).optional(),
    exercises: z.array(workoutExerciseSchema).max(100),
  })
  .strict();

export const bodyMeasurementEntrySchema = z
  .object({
    type: bodyMeasurementTypeSchema,
    value: numberSchema(0),
    unit: bodyMeasurementUnitSchema,
    note: boundedString(1, 4000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const circumferenceTypes = new Set([
      "waist",
      "neck",
      "shoulders",
      "chest",
      "biceps",
      "forearms",
      "abdomen",
      "hips",
      "thighs",
      "calves",
    ]);

    if (value.type === "weight" && !["lb", "kg"].includes(value.unit)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Weight measurements must use lb or kg.',
        path: ["unit"],
      });
    }

    if (value.type === "body_fat_pct" && value.unit !== "percent") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Body-fat measurements must use percent.',
        path: ["unit"],
      });
    }

    if (circumferenceTypes.has(value.type) && !["cm", "in"].includes(value.unit)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Circumference measurements must use cm or in.',
        path: ["unit"],
      });
    }
  });

export const measurementEntrySchema = z
  .object({
    metric: patternedString(SLUG_PATTERN),
    value: numberSchema(),
    unit: patternedString(UNIT_PATTERN),
    qualifiers: measurementQualifiersSchema.optional(),
    note: boundedString(1, 4000).optional(),
  })
  .strict();

const goalMetricTargetComparatorSchema = z.enum(["<", "<=", ">", ">=", "between"]);
const goalMetricTargetEvaluationSchema = z.union([
  z.object({ kind: z.literal("selected-value") }).strict(),
  z.object({ kind: z.literal("latest-lab") }).strict(),
  z.object({
    kind: z.literal("rolling-window"),
    statistic: z.enum(["mean", "median"]),
    windowDays: integerSchema(1, 365),
  }).strict(),
]);

const goalMetricSelectionPolicySchema = z.union([
  z.object({
    kind: z.literal("latest-valid"),
    staleAfterDays: integerSchema(1, 3650).optional(),
  }).strict(),
  z.object({
    kind: z.literal("latest-lab"),
    preferCollectedAt: z.literal(true).default(true),
    preferFasting: z.boolean().optional(),
    staleAfterDays: integerSchema(1, 3650).optional(),
  }).strict(),
  z.object({
    kind: z.literal("daily-aggregate"),
    statistic: z.enum(["mean", "median", "min", "max", "sum", "count"]),
    latestWindowDays: integerSchema(1, 365).optional(),
    minimumPoints: integerSchema(1, 100_000).optional(),
    staleAfterDays: integerSchema(1, 3650).optional(),
  }).strict(),
  z.object({
    kind: z.literal("latest-device-estimate"),
    staleAfterDays: integerSchema(1, 3650).optional(),
  }).strict(),
  z.object({
    kind: z.literal("qualified-latest"),
    requiredQualifiers: measurementQualifiersSchema,
    staleAfterDays: integerSchema(1, 3650).optional(),
  }).strict(),
]);

export const goalMetricTargetSchema = z
  .object({
    targetId: patternedString(SLUG_PATTERN),
    kind: z.literal("metric"),
    metricKey: patternedString(SLUG_PATTERN),
    biomarkerKey: healthCommonsKeySchema.optional(),
    comparator: goalMetricTargetComparatorSchema,
    value: numberSchema(),
    unit: patternedString(UNIT_PATTERN),
    highValue: numberSchema().optional(),
    evaluation: goalMetricTargetEvaluationSchema.default({ kind: "selected-value" }),
    selectionPolicyOverride: goalMetricSelectionPolicySchema.optional(),
    startAt: isoDateString().optional(),
    targetAt: isoDateString().optional(),
    note: boundedString(1, 4000).optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.comparator === "between" && target.highValue === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Metric targets using between require highValue.",
        path: ["highValue"],
      });
    }
  });

export const workoutUnitPreferenceValuesSchema = z
  .object({
    weight: workoutWeightUnitPreferenceValueSchema.optional(),
    bodyMeasurement: workoutBodyMeasurementUnitPreferenceValueSchema.optional(),
  })
  .strict();

export const workoutTemplateSetSchema = z
  .object({
    order: integerSchema(1),
    type: workoutSetTypeSchema.optional(),
    targetReps: integerSchema(0).optional(),
    targetWeight: numberSchema(0).optional(),
    targetWeightUnit: workoutLoadUnitSchema.optional(),
    targetDurationSeconds: integerSchema(0).optional(),
    targetDistanceMeters: numberSchema(0).optional(),
    targetRpe: numberSchema(0, 10).optional(),
  })
  .strict();

export const workoutTemplateExerciseSchema = z
  .object({
    name: boundedString(1, 160),
    sourceExerciseId: boundedString(1, 200).optional(),
    order: integerSchema(1),
    groupId: boundedString(1, 80).optional(),
    mode: workoutExerciseModeSchema.optional(),
    unitOverride: workoutLoadUnitSchema.optional(),
    note: boundedString(1, 4000).optional(),
    plannedSets: z.array(workoutTemplateSetSchema).min(1).max(150),
  })
  .strict();

export const workoutTemplateSchema = z
  .object({
    routineNote: boundedString(1, 4000).optional(),
    exercises: z.array(workoutTemplateExerciseSchema).max(100),
  })
  .strict();

const bloodTestResultComparatorSchema = z.enum(["<", "<=", ">", ">="]);
const bloodTestReferenceRangeBaseSchema = z
  .object({
    low: numberSchema().optional(),
    high: numberSchema().optional(),
    text: boundedString(1, 160).optional(),
  })
  .strict();

export const bloodTestReferenceRangeSchema = z.union(
  [
    bloodTestReferenceRangeBaseSchema.extend({ low: numberSchema() }),
    bloodTestReferenceRangeBaseSchema.extend({ high: numberSchema() }),
    bloodTestReferenceRangeBaseSchema.extend({ text: boundedString(1, 160) }),
  ],
  {
    error: "Blood-test reference ranges must include at least one boundary or a text range.",
  },
);

function createBloodTestResultSchema(slugSchema: z.ZodType<string>) {
  const baseSchema = z
    .object({
      analyte: boundedString(1, 160),
      slug: slugSchema.optional(),
      value: numberSchema().optional(),
      textValue: boundedString(1, 160).optional(),
      comparator: bloodTestResultComparatorSchema.optional(),
      unit: boundedString(1, 64).optional(),
      flag: z.enum(BLOOD_TEST_RESULT_FLAGS).optional(),
      biomarkerSlug: slugSchema.optional(),
      referenceRange: bloodTestReferenceRangeSchema.optional(),
      note: boundedString(1, 240).optional(),
    })
    .strict();

  return z.union(
    [
      baseSchema.extend({ value: numberSchema() }),
      baseSchema.extend({ textValue: boundedString(1, 160) }),
    ],
    {
      error: "Blood-test results require either a numeric value or a textValue.",
    },
  );
}

export const bloodTestResultSchema = createBloodTestResultSchema(
  patternedString(SLUG_PATTERN),
);

function optionalWritableTextSchema(maxLength: number): z.ZodType<string | null | undefined> {
  return z.union([boundedString(1, maxLength), z.literal(""), z.null()]).optional();
}

function optionalWritableNumberSchema(minimum?: number): z.ZodType<number | "" | null | undefined> {
  return z.union([numberSchema(minimum), z.literal(""), z.null()]).optional();
}

function optionalWritableEnumSchema<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
): z.ZodType<TValues[number] | "" | null | undefined> {
  return z.union([z.enum(values), z.literal(""), z.null()]).optional();
}

function optionalWritableIdSchema(prefix: string): z.ZodType<string | "" | null | undefined> {
  return z.union([idSchema(prefix), z.literal(""), z.null()]).optional();
}

function optionalNullableArraySchema<TSchema extends z.ZodTypeAny>(
  itemSchema: TSchema,
): z.ZodType<Array<z.infer<TSchema>> | null | undefined> {
  return z.union([z.array(itemSchema), z.null()]).optional();
}

const bloodTestImportReferenceRangeBaseSchema = z
  .object({
    low: optionalWritableNumberSchema(),
    high: optionalWritableNumberSchema(),
    text: optionalWritableTextSchema(160),
  })
  .strict();

const bloodTestImportReferenceRangeSchema = z.union(
  [
    bloodTestImportReferenceRangeBaseSchema.extend({ low: numberSchema() }),
    bloodTestImportReferenceRangeBaseSchema.extend({ high: numberSchema() }),
    bloodTestImportReferenceRangeBaseSchema.extend({ text: boundedString(1, 160) }),
    z.null(),
  ],
  {
    error: "Blood-test reference ranges must include at least one boundary or a text range.",
  },
);

const bloodTestImportResultBaseSchema = z
  .object({
    analyte: boundedString(1, 160),
    slug: optionalWritableTextSchema(160),
    value: optionalWritableNumberSchema(),
    textValue: optionalWritableTextSchema(160),
    comparator: optionalWritableEnumSchema(["<", "<=", ">", ">="]),
    unit: optionalWritableTextSchema(64),
    flag: optionalWritableEnumSchema(BLOOD_TEST_RESULT_FLAGS),
    biomarkerSlug: optionalWritableTextSchema(160),
    referenceRange: bloodTestImportReferenceRangeSchema.optional(),
    note: optionalWritableTextSchema(240),
  })
  .strict();

const bloodTestImportResultSchema = z.union(
  [
    bloodTestImportResultBaseSchema.extend({ value: numberSchema() }),
    bloodTestImportResultBaseSchema.extend({ textValue: boundedString(1, 160) }),
  ],
  {
    error: "Blood-test results require either a numeric value or a textValue.",
  },
);

export const eventSourceSchema = z.enum(EVENT_SOURCES);
export const publicEventWriteKindSchema = z.enum(PUBLIC_EVENT_WRITE_KINDS);

const writableTimestampStringSchema = z.union([isoDateString(), writableIsoDateTimeString()]);
const optionalWritableTimestampStringSchema = z
  .union([writableTimestampStringSchema, z.literal(""), z.null()])
  .optional();

const writableEventCommonPayloadShape = {
  eventId: optionalWritableIdSchema(ID_PREFIXES.event),
  occurredAt: writableTimestampStringSchema,
  recordedAt: z.union([writableTimestampStringSchema, z.null()]).optional(),
  timeZone: z.union([timeZoneString(), z.null()]).optional(),
  source: optionalWritableEnumSchema(EVENT_SOURCES),
  title: boundedString(1, 160),
  note: optionalWritableTextSchema(4000),
  tags: z.union([z.array(boundedString(1, 80)).max(32), z.null()]).optional(),
  links: optionalNullableArraySchema(eventRelationLinkSchema),
  rawRefs: optionalNullableArraySchema(patternedString(RAW_PATH_PATTERN)),
  externalRef: externalRefSchema.optional(),
} satisfies z.ZodRawShape;

export const bloodTestImportPayloadSchema = withContractMetadata(
  z
    .object({
      ...writableEventCommonPayloadShape,
      testName: boundedString(1, 160),
      resultStatus: optionalWritableEnumSchema(TEST_RESULT_STATUSES),
      summary: optionalWritableTextSchema(1000),
      specimenType: optionalWritableTextSchema(64),
      labName: optionalWritableTextSchema(160),
      labPanelId: optionalWritableTextSchema(120),
      collectedAt: optionalWritableTimestampStringSchema,
      reportedAt: optionalWritableTimestampStringSchema,
      fastingStatus: optionalWritableEnumSchema(BLOOD_TEST_FASTING_STATUSES),
      results: z.union([z.array(bloodTestImportResultSchema).min(1).max(500), z.null()]).optional(),
    })
    .strict(),
  "@murphai/contracts/blood-test-import-payload.schema.json",
  "Murph Blood Test Import Payload",
);

const workoutImportPayloadBaseShape = {
  kind: z.literal("activity_session").optional(),
  title: boundedString(1, 240).optional(),
  note: boundedString(1, 4000).optional(),
  text: boundedString(1, 4000).optional(),
  occurredAt: isoDateTimeString().optional(),
  source: eventSourceSchema.optional(),
  activityType: patternedString(SLUG_PATTERN).optional(),
  durationMinutes: integerSchema(1, 24 * 60).optional(),
  distanceKm: numberSchema(0).optional(),
  rawRefs: uniqueArray(patternedString(RELATIVE_PATH_PATTERN), { uniqueItems: true }).optional(),
  externalRef: externalRefSchema.optional(),
  relatedIds: uniqueArray(patternedString(GENERIC_CONTRACT_ID_PATTERN), { uniqueItems: true }).optional(),
  tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
  timeZone: timeZoneString({ optional: true }),
  links: uniqueArray(eventRelationLinkSchema, { uniqueItems: true }).optional(),
  strengthExercises: z.array(activityStrengthExerciseSchema).min(1).max(100).optional(),
  workout: workoutSessionSchema.optional(),
} satisfies z.ZodRawShape;

const workoutImportPayloadObjectSchema = z
  .object(workoutImportPayloadBaseShape)
  .strict();

export const workoutImportPayloadSchema = withContractMetadata(
  z.union([workoutImportPayloadObjectSchema, workoutSessionSchema]),
  "@murphai/contracts/workout-import-payload.schema.json",
  "Murph Workout Import Payload",
);

export const encounterDiagnosisSchema = z
  .object({
    text: boundedString(1, 240),
    code: boundedString(1, 80).optional(),
    codeSystem: boundedString(1, 80).optional(),
    status: z.enum(["active", "inactive", "resolved", "history", "rule_out", "unknown"]).optional(),
    certainty: z.enum(["documented", "suspected", "ruled_out", "unknown"]).optional(),
    note: boundedString(1, 1000).optional(),
  })
  .strict();

const baseEventShape = {
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.event),
  id: idSchema(ID_PREFIXES.event),
  occurredAt: isoDateTimeString(),
  recordedAt: isoDateTimeString(),
  dayKey: patternedString(DAY_KEY_PATTERN),
  source: eventSourceSchema,
  title: boundedString(1, 160),
} satisfies z.ZodRawShape;

const eventLifecycleSchema = z
  .object({
    revision: integerSchema(1),
    state: z.enum(["deleted"]).optional(),
  })
  .strict();

const baseEventOptionalShape = {
  tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
  links: uniqueArray(eventRelationLinkSchema, { uniqueItems: true }).optional(),
  rawRefs: uniqueArray(patternedString(RAW_PATH_PATTERN), { uniqueItems: true }).optional(),
  evidence: z.array(clinicalEvidenceRefSchema).max(50).optional(),
  attachments: uniqueArray(eventAttachmentSchema, { uniqueItems: true }).optional(),
  externalRef: externalRefSchema.optional(),
  dataOrigin: deviceDataOriginSchema.optional(),
  lifecycle: eventLifecycleSchema.optional(),
  timeZone: timeZoneString({ optional: true }),
} satisfies z.ZodRawShape;

const experimentLinkShape = {
  experimentId: idSchema(ID_PREFIXES.experiment).optional(),
  experimentSlug: patternedString(SLUG_PATTERN).optional(),
} satisfies z.ZodRawShape;
const experimentContextSeveritySchema = z.enum(EXPERIMENT_CONTEXT_SEVERITIES);
const experimentSessionStatusSchema = z.enum(["completed", "partial", "missed", "skipped"]);
const experimentConfounderValueSchema = z.union([
  boundedString(1, 240),
  numberSchema(),
  z.boolean(),
  z.null(),
]);
const experimentConfounderMapSchema = z.record(z.string(), experimentConfounderValueSchema);
const experimentConfounderSchema = z.union([
  uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }),
  experimentConfounderMapSchema,
]);
const experimentSessionFieldValueSchema = z.union([
  boundedString(1, 240),
  numberSchema(),
  z.boolean(),
  z.null(),
]);
const experimentSessionFieldsSchema = z.record(
  healthCommonsStableIdSchema,
  experimentSessionFieldValueSchema,
);

function eventSchema<const TKind extends EventKind, TExtra extends z.ZodRawShape>(
  kind: TKind,
  extraShape: TExtra,
) {
  return z
    .object({
      ...baseEventShape,
      kind: z.literal(kind),
      note: boundedString(1, 4000).optional(),
      ...baseEventOptionalShape,
      ...extraShape,
    })
    .strict();
}

const eventImportJsonlRowBaseShape = {
  occurredAt: writableTimestampStringSchema,
  recordedAt: z.union([writableTimestampStringSchema, z.null()]).optional(),
  source: optionalWritableEnumSchema(EVENT_SOURCES),
  title: boundedString(1, 160),
  note: optionalWritableTextSchema(4000),
  tags: optionalNullableArraySchema(patternedString(SLUG_PATTERN)),
  links: optionalNullableArraySchema(eventRelationLinkSchema),
  rawRefs: optionalNullableArraySchema(patternedString(RAW_PATH_PATTERN)),
  evidence: optionalNullableArraySchema(clinicalEvidenceRefSchema),
  attachments: uniqueArray(eventAttachmentSchema, { uniqueItems: true }).optional(),
  externalRef: externalRefSchema.optional(),
  dataOrigin: deviceDataOriginSchema.optional(),
  timeZone: z.union([timeZoneString(), z.null()]).optional(),
} satisfies z.ZodRawShape;

function eventImportJsonlRowSchema<
  const TKind extends PublicWritableEventKind,
  TExtra extends z.ZodRawShape,
>(
  kind: TKind,
  extraShape: TExtra,
) {
  return z
    .object({
      ...eventImportJsonlRowBaseShape,
      kind: z.literal(kind),
      ...extraShape,
    })
    .strict();
}

const symptomEventFieldsShape = {
  symptom: boundedString(1, 120),
  intensity: integerSchema(0, 10),
  bodySite: boundedString(1, 120).optional(),
} satisfies z.ZodRawShape;

const noteEventFieldsShape = {
  ...experimentLinkShape,
  note: boundedString(1, 4000),
  noteType: boundedString(1, 120).optional(),
  reportedGender: z.enum(["female", "male", "other"]).optional(),
  authoredAt: isoDateTimeString().optional(),
  signedAt: isoDateTimeString().optional(),
  author: boundedString(1, 160).optional(),
  providerId: idSchema(ID_PREFIXES.provider).optional(),
  facility: boundedString(1, 160).optional(),
  encounterId: idSchema(ID_PREFIXES.event).optional(),
  sections: z.array(clinicalNoteSectionSchema).min(1).max(50).optional(),
} satisfies z.ZodRawShape;

const observationEventFieldsShape = {
  metric: patternedString(SLUG_PATTERN),
  queryVisibility: z.enum(["default"]).optional(),
  qualifiers: measurementQualifiersSchema.optional(),
  value: numberSchema(),
  visibility: z.enum(["display"]).optional(),
  canonicalFact: z.literal(true).optional(),
  observationGrain: z.enum(OBSERVATION_GRAINS).optional(),
  unit: patternedString(UNIT_PATTERN),
} satisfies z.ZodRawShape;

const clinicalAssertionEventFieldsShape = {
  assertion: z.enum(CLINICAL_ASSERTION_TYPES),
  domain: z.enum(CLINICAL_ASSERTION_DOMAINS).optional(),
  polarity: z.enum(CLINICAL_ASSERTION_POLARITIES).optional(),
  subject: boundedString(1, 240).optional(),
  assertionText: boundedString(1, 1000).optional(),
  bodySite: boundedString(1, 120).optional(),
  code: boundedString(1, 80).optional(),
  codeSystem: boundedString(1, 80).optional(),
  assertedOn: isoDateString(),
  sourceLabel: boundedString(1, 240).optional(),
} satisfies z.ZodRawShape;

const exposureEventFieldsShape = {
  exposureType: boundedString(1, 160),
  substance: boundedString(1, 160),
  duration: boundedString(1, 120).optional(),
  ...experimentLinkShape,
} satisfies z.ZodRawShape;

const measurementEventFieldsShape = {
  measurements: z.array(measurementEntrySchema).min(1).max(25),
  media: z.array(storedMediaSchema).max(10).optional(),
} satisfies z.ZodRawShape;

const testEventFieldsShape = {
  testName: boundedString(1, 160),
  resultStatus: z.enum(TEST_RESULT_STATUSES),
  summary: boundedString(1, 4000).optional(),
  testCategory: boundedString(1, 64).optional(),
  specimenType: boundedString(1, 64).optional(),
  labName: boundedString(1, 160).optional(),
  labPanelId: boundedString(1, 120).optional(),
  collectedAt: isoDateTimeString().optional(),
  reportedAt: isoDateTimeString().optional(),
  fastingStatus: z.enum(BLOOD_TEST_FASTING_STATUSES).optional(),
  results: z.array(bloodTestResultSchema).min(1).max(500).optional(),
} satisfies z.ZodRawShape;

const medicationIntakeEventFieldsShape = {
  medicationName: boundedString(1, 160),
  dose: numberSchema(0),
  unit: patternedString(UNIT_PATTERN),
} satisfies z.ZodRawShape;

const supplementIntakeEventFieldsShape = {
  supplementName: boundedString(1, 160),
  dose: numberSchema(0),
  unit: patternedString(UNIT_PATTERN),
  ...experimentLinkShape,
} satisfies z.ZodRawShape;

const activitySessionEventFieldsShape = {
  activityType: patternedString(SLUG_PATTERN),
  durationMinutes: integerSchema(1).optional(),
  distanceKm: numberSchema(0).optional(),
  ...experimentLinkShape,
  workout: workoutSessionSchema,
} satisfies z.ZodRawShape;

const bodyMeasurementEventFieldsShape = {
  measurements: z.array(bodyMeasurementEntrySchema).min(1).max(25),
  media: z.array(storedMediaSchema).max(10).optional(),
} satisfies z.ZodRawShape;

const sleepSessionEventFieldsShape = {
  startAt: isoDateTimeString(),
  endAt: isoDateTimeString(),
  durationMinutes: integerSchema(1),
  sleepType: z.enum(["main_sleep", "nap"]).optional(),
} satisfies z.ZodRawShape;

const interventionSessionEventFieldsShape = {
  interventionType: patternedString(SLUG_PATTERN),
  durationMinutes: integerSchema(1).optional(),
  protocolId: idSchema(ID_PREFIXES.protocol).optional(),
  regimenId: idSchema(ID_PREFIXES.regimen).optional(),
  ...experimentLinkShape,
  sessionStatus: experimentSessionStatusSchema.optional(),
  sessionLocalDate: isoDateString().optional(),
  scheduledLocalDate: isoDateString().optional(),
  timing: boundedString(1, 120).optional(),
  temperatureC: numberSchema(0, 200).optional(),
  afterExercise: z.boolean().optional(),
  symptoms: uniqueArray(boundedString(1, 160), { maxItems: 25, uniqueItems: true }).optional(),
  confounders: experimentConfounderSchema.optional(),
  fields: experimentSessionFieldsSchema.optional(),
} satisfies z.ZodRawShape;

const experimentContextEventFieldsShape = {
  experimentId: idSchema(ID_PREFIXES.experiment),
  experimentSlug: patternedString(SLUG_PATTERN),
  contextType: patternedString(SLUG_PATTERN),
  severity: experimentContextSeveritySchema.optional(),
} satisfies z.ZodRawShape;

const symptomEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema("symptom", symptomEventFieldsShape);
const noteEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema("note", noteEventFieldsShape);
const observationEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "observation",
  observationEventFieldsShape,
);
const clinicalAssertionEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "clinical_assertion",
  clinicalAssertionEventFieldsShape,
);
const exposureEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "exposure",
  exposureEventFieldsShape,
);
const measurementEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "measurement",
  measurementEventFieldsShape,
);
const testEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "test",
  testEventFieldsShape,
);
const medicationIntakeEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "medication_intake",
  medicationIntakeEventFieldsShape,
);
const supplementIntakeEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "supplement_intake",
  supplementIntakeEventFieldsShape,
);
const activitySessionEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "activity_session",
  {
    ...activitySessionEventFieldsShape,
    durationMinutes: integerSchema(1),
  },
);
const activitySessionEventImportDecisionPayloadSchema = eventImportJsonlRowSchema(
  "activity_session",
  activitySessionEventFieldsShape,
);
const bodyMeasurementEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "body_measurement",
  bodyMeasurementEventFieldsShape,
);
const sleepSessionEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "sleep_session",
  sleepSessionEventFieldsShape,
);
const interventionSessionEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "intervention_session",
  interventionSessionEventFieldsShape,
);
const experimentContextEventImportJsonlRowPayloadSchema = eventImportJsonlRowSchema(
  "experiment_context",
  experimentContextEventFieldsShape,
);

export const publicEventImportJsonlRowPayloadSchemasByKind = Object.freeze({
  symptom: symptomEventImportJsonlRowPayloadSchema,
  note: noteEventImportJsonlRowPayloadSchema,
  observation: observationEventImportJsonlRowPayloadSchema,
  clinical_assertion: clinicalAssertionEventImportJsonlRowPayloadSchema,
  exposure: exposureEventImportJsonlRowPayloadSchema,
  measurement: measurementEventImportJsonlRowPayloadSchema,
  test: testEventImportJsonlRowPayloadSchema,
  medication_intake: medicationIntakeEventImportJsonlRowPayloadSchema,
  supplement_intake: supplementIntakeEventImportJsonlRowPayloadSchema,
  activity_session: activitySessionEventImportJsonlRowPayloadSchema,
  body_measurement: bodyMeasurementEventImportJsonlRowPayloadSchema,
  sleep_session: sleepSessionEventImportJsonlRowPayloadSchema,
  intervention_session: interventionSessionEventImportJsonlRowPayloadSchema,
  experiment_context: experimentContextEventImportJsonlRowPayloadSchema,
});

export const publicEventImportJsonlRowPayloadSchema = z.discriminatedUnion("kind", [
  symptomEventImportJsonlRowPayloadSchema,
  noteEventImportJsonlRowPayloadSchema,
  observationEventImportJsonlRowPayloadSchema,
  clinicalAssertionEventImportJsonlRowPayloadSchema,
  exposureEventImportJsonlRowPayloadSchema,
  measurementEventImportJsonlRowPayloadSchema,
  testEventImportJsonlRowPayloadSchema,
  medicationIntakeEventImportJsonlRowPayloadSchema,
  supplementIntakeEventImportJsonlRowPayloadSchema,
  activitySessionEventImportJsonlRowPayloadSchema,
  bodyMeasurementEventImportJsonlRowPayloadSchema,
  sleepSessionEventImportJsonlRowPayloadSchema,
  interventionSessionEventImportJsonlRowPayloadSchema,
  experimentContextEventImportJsonlRowPayloadSchema,
]);

export const versionedExternalRefSchema = externalRefSchema.extend({
  version: writableIsoDateTimeString(200),
});

const eventImportDecisionPayloadSchema = z.discriminatedUnion("kind", [
  symptomEventImportJsonlRowPayloadSchema,
  noteEventImportJsonlRowPayloadSchema,
  observationEventImportJsonlRowPayloadSchema,
  clinicalAssertionEventImportJsonlRowPayloadSchema,
  exposureEventImportJsonlRowPayloadSchema,
  measurementEventImportJsonlRowPayloadSchema,
  testEventImportJsonlRowPayloadSchema,
  medicationIntakeEventImportJsonlRowPayloadSchema,
  supplementIntakeEventImportJsonlRowPayloadSchema,
  activitySessionEventImportDecisionPayloadSchema,
  bodyMeasurementEventImportJsonlRowPayloadSchema,
  sleepSessionEventImportJsonlRowPayloadSchema,
  interventionSessionEventImportJsonlRowPayloadSchema,
  experimentContextEventImportJsonlRowPayloadSchema,
]);

export const expectedLatestEventSchema = z
  .object({
    eventId: idSchema(ID_PREFIXES.event),
    lifecycleRevision: z.number().int().positive(),
  })
  .strict();

export const eventImportUpsertDecisionSchema = z
  .object({
    action: z.literal("upsert"),
    payload: eventImportDecisionPayloadSchema,
    expectedLatest: expectedLatestEventSchema.optional(),
  })
  .strict();

export const eventImportRetractionDecisionSchema = z
  .object({
    action: z.literal("retract"),
    externalRef: versionedExternalRefSchema,
    reason: boundedString(1, 240),
    evidence: z.array(clinicalEvidenceRefSchema).max(50).optional(),
  })
  .strict();

export const eventImportDecisionSchema = z.discriminatedUnion("action", [
  eventImportUpsertDecisionSchema,
  eventImportRetractionDecisionSchema,
]);

const baseSampleShape = {
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.sample),
  id: idSchema(ID_PREFIXES.sample),
  recordedAt: isoDateTimeString(),
  dayKey: patternedString(DAY_KEY_PATTERN),
  source: z.enum(SAMPLE_SOURCES),
  quality: z.enum(SAMPLE_QUALITIES),
} satisfies z.ZodRawShape;

const baseSampleOptionalShape = {
  externalRef: externalRefSchema.optional(),
  dataOrigin: deviceDataOriginSchema.optional(),
  timeZone: timeZoneString({ optional: true }),
} satisfies z.ZodRawShape;

function sampleSchema<const TStream extends SampleStream, TExtra extends z.ZodRawShape>(
  stream: TStream,
  extraShape: TExtra,
) {
  return z
    .object({
      ...baseSampleShape,
      stream: z.literal(stream),
      ...baseSampleOptionalShape,
      ...extraShape,
    })
    .strict();
}

export const vaultMetadataSchema = withContractMetadata(
  z
    .object({
      formatVersion: z.literal(CURRENT_VAULT_FORMAT_VERSION),
      vaultId: idSchema(ID_PREFIXES.vault),
      createdAt: isoDateTimeString(),
      title: boundedString(1, 120),
      timezone: timeZoneString(),
    })
    .strict(),
  "@murphai/contracts/vault-metadata.schema.json",
  "Murph Vault Metadata",
);

export const eventRecordSchema = withContractMetadata(
  z.discriminatedUnion("kind", [
    eventSchema("document", {
      documentId: idSchema(ID_PREFIXES.document),
      mimeType: boundedString(3, 120),
      providerId: idSchema(ID_PREFIXES.provider).optional(),
    }),
    eventSchema("clinical_assertion", clinicalAssertionEventFieldsShape),
    eventSchema("encounter", {
      encounterType: boundedString(1, 160),
      location: boundedString(1, 160).optional(),
      providerId: idSchema(ID_PREFIXES.provider).optional(),
      clinician: boundedString(1, 160).optional(),
      facility: boundedString(1, 160).optional(),
      reasonForVisit: boundedString(1, 1000).optional(),
      assessmentText: boundedString(1, 4000).optional(),
      planText: boundedString(1, 4000).optional(),
      instructionsText: boundedString(1, 4000).optional(),
      followUpText: boundedString(1, 4000).optional(),
      diagnoses: z.array(encounterDiagnosisSchema).min(1).max(50).optional(),
    }),
    eventSchema("meal", {
      mealId: idSchema(ID_PREFIXES.meal),
      ingredients: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      nutrition: mealNutritionSchema.optional(),
    }),
    eventSchema("symptom", symptomEventFieldsShape),
    z
      .object({
        ...baseEventShape,
        kind: z.literal("note"),
        ...baseEventOptionalShape,
        ...noteEventFieldsShape,
      })
      .strict(),
    eventSchema("observation", observationEventFieldsShape),
    eventSchema("measurement", measurementEventFieldsShape),
    eventSchema("experiment_event", {
      experimentId: idSchema(ID_PREFIXES.experiment),
      experimentSlug: patternedString(SLUG_PATTERN),
      phase: z.enum(EXPERIMENT_PHASES),
    }),
    eventSchema("experiment_context", experimentContextEventFieldsShape),
    eventSchema("immunization", {
      vaccineName: boundedString(1, 160),
      manufacturer: boundedString(1, 160).optional(),
      lotNumber: boundedString(1, 120).optional(),
      route: boundedString(1, 80).optional(),
      site: boundedString(1, 80).optional(),
      series: boundedString(1, 120).optional(),
      targetDiseases: uniqueArray(boundedString(1, 120), { maxItems: 25, uniqueItems: true }).optional(),
    }),
    eventSchema("medication_intake", medicationIntakeEventFieldsShape),
    eventSchema("procedure", {
      procedure: boundedString(1, 160),
      status: boundedString(1, 64),
    }),
    eventSchema("supplement_intake", supplementIntakeEventFieldsShape),
    eventSchema("test", testEventFieldsShape),
    eventSchema("activity_session", activitySessionEventFieldsShape),
    eventSchema("body_measurement", bodyMeasurementEventFieldsShape),
    eventSchema("sleep_session", sleepSessionEventFieldsShape),
    eventSchema("intervention_session", interventionSessionEventFieldsShape),
    eventSchema("adverse_effect", {
      substance: boundedString(1, 160),
      effect: boundedString(1, 160),
      severity: z.enum(ADVERSE_EFFECT_SEVERITIES),
      ...experimentLinkShape,
    }),
    eventSchema("exposure", exposureEventFieldsShape),
  ]),
  "@murphai/contracts/event-record.schema.json",
  "Murph Event Record",
);

export const sampleRecordSchema = withContractMetadata(
  z.discriminatedUnion("stream", [
    sampleSchema("heart_rate", {
      value: integerSchema(0),
      unit: z.literal("bpm"),
    }),
    sampleSchema("spo2", {
      value: numberSchema(0),
      unit: z.literal("%"),
    }),
    sampleSchema("hrv", {
      value: numberSchema(0),
      unit: z.literal("ms"),
    }),
    sampleSchema("steps", {
      value: integerSchema(0),
      unit: z.literal("count"),
    }),
    sampleSchema("sleep_stage", {
      stage: z.enum(SLEEP_STAGES),
      startAt: isoDateTimeString(),
      endAt: isoDateTimeString(),
      durationMinutes: integerSchema(1),
      unit: z.literal("stage"),
    }),
    sampleSchema("respiratory_rate", {
      value: numberSchema(0),
      unit: z.literal("breaths_per_minute"),
    }),
    sampleSchema("temperature", {
      value: numberSchema(),
      unit: z.literal("celsius"),
    }),
    sampleSchema("glucose", {
      value: numberSchema(0),
      unit: z.literal("mg_dL"),
    }),
  ]),
  "@murphai/contracts/sample-record.schema.json",
  "Murph Sample Record",
);

export const metricSampleQualifierValueSchema = z.union([
  boundedString(1, 240),
  numberSchema(),
  z.boolean(),
  z.null(),
]);

export const metricSampleQualifiersSchema = z.record(
  patternedString(SLUG_PATTERN, 1, 80),
  metricSampleQualifierValueSchema,
);

export const metricSampleRecordSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.metricSample),
      id: idSchema(ID_PREFIXES.sample),
      metric: patternedString(SLUG_PATTERN, 1, 120),
      value: numberSchema(),
      unit: patternedString(UNIT_PATTERN, 1, 80),
      recordedAt: isoDateTimeString(),
      dayKey: patternedString(DAY_KEY_PATTERN),
      source: z.enum(SAMPLE_SOURCES),
      quality: z.enum(SAMPLE_QUALITIES),
      qualifiers: metricSampleQualifiersSchema.optional(),
      externalRef: externalRefSchema.optional(),
      dataOrigin: deviceDataOriginSchema.optional(),
      timeZone: timeZoneString({ optional: true }),
    })
    .strict(),
  "@murphai/contracts/metric-sample-record.schema.json",
  "Murph Metric Sample Record",
);

export const auditRecordSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.audit),
      id: idSchema(ID_PREFIXES.audit),
      action: z.enum(AUDIT_ACTIONS),
      status: z.enum(AUDIT_STATUSES),
      occurredAt: isoDateTimeString(),
      actor: z.enum(AUDIT_ACTORS),
      commandName: boundedString(1, 160),
      summary: boundedString(1, 4000),
      targetIds: uniqueArray(boundedString(1, 255), { uniqueItems: true }).optional(),
      errorCode: z.enum(ERROR_CODE_VALUES).optional(),
      changes: z.array(
        z
          .object({
            path: patternedString(RELATIVE_PATH_PATTERN),
            op: z.enum(FILE_CHANGE_OPERATIONS),
          })
          .strict(),
      ),
    })
    .strict(),
  "@murphai/contracts/audit-record.schema.json",
  "Murph Audit Record",
);

const INBOX_CAPTURE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_-]*$";
const INBOX_ATTACHMENT_ID_PATTERN = "^att_[A-Za-z0-9][A-Za-z0-9_-]*_[0-9]{2}$";
const INBOX_CAPTURE_ATTACHMENT_KIND_VALUES = ["image", "audio", "video", "document", "other"] as const;
const INBOX_RETENTION_ATTACHMENT_KIND_VALUES = ["image", "audio", "video"] as const;
const HEX_SHA256_PATTERN = "^[a-f0-9]{64}$";
export const INBOX_CAPTURE_TEXT_MAX_LENGTH = 20_000;
export const INBOX_CAPTURE_TEXT_MAX_BYTES = 64 * 1024 * 1024;

const inboxCaptureThreadSchema = z
  .object({
    id: boundedString(1, 4000),
    title: boundedString(1, 4000).nullable().optional(),
    isDirect: z.boolean().nullable(),
  })
  .strict();

const inboxCaptureActorSchema = z
  .object({
    id: boundedString(1, 255).nullable().optional(),
    displayName: boundedString(1, 255).nullable().optional(),
    isSelf: z.boolean(),
  })
  .strict();

const inboxCaptureAttachmentSchema = z
  .object({
    attachmentId: patternedString(INBOX_ATTACHMENT_ID_PATTERN),
    ordinal: integerSchema(1),
    externalId: boundedString(1, 255).nullable().optional(),
    kind: z.enum(INBOX_CAPTURE_ATTACHMENT_KIND_VALUES),
    mime: boundedString(1, 255).nullable().optional(),
    originalPath: z.null().optional(),
    fileName: boundedString(1, 255).nullable().optional(),
    byteSize: integerSchema(0).nullable().optional(),
    storedPath: patternedString(RELATIVE_PATH_PATTERN).nullable().optional(),
    sha256: patternedString(HEX_SHA256_PATTERN).nullable().optional(),
  })
  .strict();

const inboxCaptureTextContentSchema = z
  .object({
    storedPath: patternedString(RELATIVE_PATH_PATTERN),
    byteSize: integerSchema(1, INBOX_CAPTURE_TEXT_MAX_BYTES),
    sha256: patternedString(HEX_SHA256_PATTERN),
  })
  .strict();

const inboxCaptureRecordFields = {
      captureId: patternedString(INBOX_CAPTURE_ID_PATTERN),
      identityKey: boundedString(1, 1024),
      eventId: idSchema(ID_PREFIXES.event),
      auditId: idSchema(ID_PREFIXES.audit).optional(),
      source: boundedString(1, 160),
      accountId: boundedString(1, 255).nullable().optional(),
      externalId: boundedString(1, 255),
      thread: inboxCaptureThreadSchema,
      actor: inboxCaptureActorSchema,
      occurredAt: isoDateTimeString(),
      recordedAt: isoDateTimeString(),
      receivedAt: isoDateTimeString().nullable().optional(),
      raw: jsonObjectSchema,
      sourceDirectory: patternedString(RELATIVE_PATH_PATTERN),
      rawRefs: uniqueArray(patternedString(RELATIVE_PATH_PATTERN), { uniqueItems: true }),
      attachments: z.array(inboxCaptureAttachmentSchema),
      // Stamped when retention expires this capture's message content. Two jobs:
      // it distinguishes a capture whose content carriers were checked and
      // retired from one that has not reached the deadline, and it is the
      // idempotence marker that stops the sweep from reconsidering the same
      // record every pass. This includes attachment-only captures because
      // parser derivatives can contain message content even when the capture
      // has no inline text. Shared by both schema versions so legacy captures
      // can be redacted through the same path. Additive and optional, so
      // records written before retention existed stay valid.
      textRetiredAt: isoDateTimeString().optional(),
} as const;

const legacyInboxCaptureRecordSchema = z
  .object({
    schemaVersion: z.literal(LEGACY_INBOX_CAPTURE_SCHEMA_VERSION),
    ...inboxCaptureRecordFields,
    text: boundedString(1, INBOX_CAPTURE_TEXT_MAX_LENGTH).nullable().optional(),
    envelopePath: patternedString(RELATIVE_PATH_PATTERN),
  })
  .strict();

const currentInboxCaptureRecordSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.inboxCapture),
    ...inboxCaptureRecordFields,
    text: boundedString(1, INBOX_CAPTURE_TEXT_MAX_LENGTH).nullable().optional(),
    textContent: inboxCaptureTextContentSchema.optional(),
  })
  .strict();

export const inboxCaptureRecordSchema = withContractMetadata(
  z.discriminatedUnion("schemaVersion", [
    legacyInboxCaptureRecordSchema,
    currentInboxCaptureRecordSchema,
  ]),
  "@murphai/contracts/inbox-capture-record.schema.json",
  "Murph Inbox Capture Record",
);

export const inboxAttachmentRetentionRecordSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.inboxAttachmentRetention),
      captureId: patternedString(INBOX_CAPTURE_ID_PATTERN),
      attachmentId: patternedString(INBOX_ATTACHMENT_ID_PATTERN),
      ordinal: integerSchema(1),
      kind: z.enum(INBOX_RETENTION_ATTACHMENT_KIND_VALUES),
      mime: boundedString(1, 255).nullable().optional(),
      fileName: boundedString(1, 255).nullable().optional(),
      byteSize: integerSchema(0).nullable().optional(),
      storedPath: patternedString(RELATIVE_PATH_PATTERN),
      sha256: patternedString(HEX_SHA256_PATTERN),
      captureOccurredAt: isoDateTimeString(),
      recordedAt: isoDateTimeString(),
      purgedAt: isoDateTimeString(),
      reason: z.literal("inbox_media_retention"),
    })
    .strict(),
  "@murphai/contracts/inbox-attachment-retention-record.schema.json",
  "Murph Inbox Attachment Retention Record",
);


export const coreFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.coreFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.core),
      vaultId: idSchema(ID_PREFIXES.vault),
      title: boundedString(1, 160),
      timezone: timeZoneString(),
      updatedAt: isoDateTimeString(),
      activeExperimentSlugs: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-core.schema.json",
  "Murph CORE Frontmatter",
);

export const journalDayFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.journalDayFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.journalDay),
      dayKey: patternedString(DAY_KEY_PATTERN),
      eventIds: uniqueArray(idSchema(ID_PREFIXES.event), { uniqueItems: true }),
      sampleStreams: uniqueArray(z.enum(SAMPLE_STREAMS), { uniqueItems: true }),
    })
    .strict(),
  "@murphai/contracts/frontmatter-journal-day.schema.json",
  "Murph Journal Day Frontmatter",
);

export const commonsProtocolRefSchema = z
  .object({
    key: healthCommonsKeySchema,
    pageRevisionId: z.string().startsWith("sha256:"),
    runSpecRevisionId: z.string().startsWith("sha256:"),
    testPlanId: healthCommonsStableIdSchema.optional(),
  })
  .strict();

const sha256DigestSchema = patternedString(SHA256_DIGEST_PATTERN);

export const protocolRefSchema = z
  .object({
    protocolId: idSchema(ID_PREFIXES.protocol),
    protocolRevisionId: sha256DigestSchema,
    effectiveSpecHash: sha256DigestSchema,
  })
  .strict();

const protocolFrequencySchema = z
  .object({
    sessionsPerDay: numberSchema(0).optional(),
    sessionsPerWeek: numberSchema(0).optional(),
  })
  .strict();

const protocolNonnegativeRangeSchema = z
  .object({
    min: numberSchema(0).optional(),
    max: numberSchema(0).optional(),
    target: numberSchema(0).optional(),
  })
  .strict();

const protocolTemperatureRangeSchema = z
  .object({
    min: numberSchema().optional(),
    max: numberSchema().optional(),
    target: numberSchema().optional(),
  })
  .strict();

export const protocolActivitySessionEvidenceSchema =
  healthCommonsActivitySessionEvidenceSchema;

export const effectiveProtocolSnapshotSchema = z
  .object({
    effectiveSpecHash: sha256DigestSchema,
    doseSignature: boundedString(1, 240),
    modality: boundedString(1, 160).optional(),
    activitySessionEvidence: protocolActivitySessionEvidenceSchema.optional(),
    frequency: protocolFrequencySchema.optional(),
    durationMinutes: protocolNonnegativeRangeSchema.optional(),
    temperatureC: protocolTemperatureRangeSchema.optional(),
    targetSessions: integerSchema(0).optional(),
    minimumUsefulSessions: integerSchema(0).optional(),
    stopConditions: z.array(boundedString(1, 4000)).max(50).optional(),
  })
  .strict();

export const protocolEffectiveSpecSchema = z
  .object({
    doseSignature: boundedString(1, 240),
    modality: boundedString(1, 160).optional(),
    activitySessionEvidence: protocolActivitySessionEvidenceSchema.optional(),
    frequency: protocolFrequencySchema.optional(),
    durationMinutes: protocolNonnegativeRangeSchema.optional(),
    temperatureC: protocolTemperatureRangeSchema.optional(),
    targetSessions: integerSchema(0).optional(),
    minimumUsefulSessions: integerSchema(0).optional(),
    instructions: z.array(boundedString(1, 4000)).max(100).optional(),
    stopConditions: z.array(boundedString(1, 4000)).max(50).optional(),
    notes: z.array(boundedString(1, 4000)).max(50).optional(),
  })
  .strict();

export const protocolLineageSchema = z
  .object({
    sourceKind: z.enum(["health_commons_protocol", "protocol"]),
    parentProtocolRef: protocolRefSchema.optional(),
    notes: z.array(boundedString(1, 4000)).max(50).optional(),
  })
  .strict()
  .superRefine((lineage, context) => {
    if (lineage.sourceKind !== "protocol") {
      return;
    }

    if (lineage.parentProtocolRef === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Protocol lineage requires parentProtocolRef when sourceKind is protocol.",
        path: ["parentProtocolRef"],
      });
    }
  });

export const protocolDiffEntrySchema = z
  .object({
    path: boundedString(1, 240),
    op: z.enum(["add", "remove", "replace"]),
    before: jsonValueSchema.optional(),
    after: jsonValueSchema.optional(),
    reason: boundedString(1, 4000).optional(),
  })
  .strict();

export const protocolPersonalizationSchema = z
  .object({
    target: boundedString(1, 240).optional(),
    constraints: jsonObjectSchema.optional(),
    preferences: jsonObjectSchema.optional(),
    rationale: z.array(boundedString(1, 4000)).max(50).optional(),
    notes: z.array(boundedString(1, 4000)).max(50).optional(),
  })
  .strict();

export const experimentRunLoggingSchema = z
  .object({
    sessionFields: uniqueArray(healthCommonsStableIdSchema, { minItems: 1, uniqueItems: true }),
    confounderFields: uniqueArray(healthCommonsStableIdSchema, { uniqueItems: true }).optional(),
  })
  .strict();

export const experimentRunBaselineSchema = z
  .object({
    mode: z.enum(["prospective", "retrospective", "omitted"]),
    source: z.enum(["wearable_history", "manual_measurements"]).optional(),
    start: isoDateString().optional(),
    end: isoDateString().optional(),
  })
  .strict();

const experimentAdherenceLocalTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Expected a 24-hour HH:MM time.");

export const experimentAdherenceCalendarSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("daily"),
      timeZone: timeZoneString(),
      localTime: experimentAdherenceLocalTimeSchema.optional(),
      targetCountPerDay: integerSchema(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("weekdays"),
      timeZone: timeZoneString(),
      weekdays: uniqueArray(integerSchema(0, 6), {
        minItems: 1,
        maxItems: 7,
        uniqueItems: true,
      }),
      localTime: experimentAdherenceLocalTimeSchema.optional(),
      targetCountPerDay: integerSchema(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicitDates"),
      timeZone: timeZoneString(),
      dates: z.array(
        z
          .object({
            localDate: isoDateString(),
            label: boundedString(1, 160).optional(),
            localTime: experimentAdherenceLocalTimeSchema.optional(),
            targetCount: integerSchema(1).optional(),
          })
          .strict(),
      )
        .min(1)
        .max(100)
        .superRefine((dates, ctx) => {
          const seen = new Set<string>();
          dates.forEach((date, index) => {
            if (seen.has(date.localDate)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Duplicate explicit adherence date.",
                path: [index, "localDate"],
              });
              return;
            }
            seen.add(date.localDate);
          });
        }),
    })
    .strict(),
]);

export const experimentAdherenceGraceSchema = z.union([
  z.object({ hours: numberSchema(0) }).strict(),
  z.object({ days: numberSchema(0) }).strict(),
]);

export const experimentAdherenceEvidenceRuleSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("linkedEventCount"),
        eventKind: z.enum([
          "intervention_session",
          "supplement_intake",
          "medication_intake",
          "activity_session",
          "measurement",
        ]),
        missing: z.enum(["missed_after_grace", "assumed_after_grace", "unknown"]),
        activityKind: boundedString(1, 80).optional(),
        activityKinds: uniqueArray(boundedString(1, 80), {
          minItems: 1,
          maxItems: 16,
          uniqueItems: true,
        }).optional(),
        minimumDurationMinutes: integerSchema(1).optional(),
        partialCredit: numberSchema(0, 1).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("metricThreshold"),
        metricKey: boundedString(1, 160),
        op: z.enum([">=", "<=", "==", "between"]),
        value: numberSchema().optional(),
        min: numberSchema().optional(),
        max: numberSchema().optional(),
        missing: z.enum(["unknown", "failed_after_grace"]),
      })
      .strict()
      .superRefine((rule, context) => {
        if (rule.op === "between") {
          if (rule.min === undefined || rule.max === undefined) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "metricThreshold between requires min and max.",
              path: ["min"],
            });
          }
          if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "metricThreshold min must be less than or equal to max.",
              path: ["max"],
            });
          }
          return;
        }

        if (rule.value === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "metricThreshold requires value unless op is between.",
            path: ["value"],
          });
        }
        if (rule.min !== undefined || rule.max !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "metricThreshold min/max are only valid with op between.",
            path: ["min"],
          });
        }
      }),
    z
      .object({
        kind: z.literal("metricPresence"),
        metricKey: boundedString(1, 160),
        missing: z.enum(["missed_after_grace", "unknown"]),
      })
      .strict(),
  ]);

export const experimentAdherenceTargetSchema = z
  .object({
    targetId: patternedString(SLUG_PATTERN),
    label: boundedString(1, 160),
    phase: z.enum(["baseline", "intervention", "run"]),
    calendar: experimentAdherenceCalendarSchema.optional(),
    evidence: experimentAdherenceEvidenceRuleSchema,
    grace: experimentAdherenceGraceSchema.optional(),
    rollup: z
      .object({
        targetCompletions: integerSchema(0).optional(),
        minimumUsefulCompletions: integerSchema(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.calendar === undefined && target.evidence.kind !== "linkedEventCount") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "calendar is required unless evidence is linkedEventCount.",
        path: ["calendar"],
      });
    }
    if (target.evidence.kind === "linkedEventCount") {
      if (
        target.evidence.activityKind !== undefined &&
        target.evidence.activityKinds !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Use activityKind or activityKinds, not both.",
          path: ["evidence", "activityKinds"],
        });
      }
      if (
        (
          target.evidence.activityKind !== undefined ||
          target.evidence.activityKinds !== undefined ||
          target.evidence.minimumDurationMinutes !== undefined
        ) &&
        target.evidence.eventKind !== "activity_session"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Activity matching fields require activity_session evidence.",
          path: ["evidence", "eventKind"],
        });
      }
    }
    if (
      target.evidence.kind === "linkedEventCount" &&
      target.evidence.missing === "assumed_after_grace" &&
      target.evidence.eventKind !== "intervention_session"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assumed_after_grace requires intervention_session evidence.",
        path: ["evidence", "missing"],
      });
    }
  });

export const experimentAdherenceTargetsSchema = uniqueArray(experimentAdherenceTargetSchema, {
  maxItems: 8,
  uniqueItems: true,
}).superRefine((targets, context) => {
  const seen = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (seen.has(target.targetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Experiment adherence target ids must be unique.",
        path: [index, "targetId"],
      });
    }
    seen.add(target.targetId);
  }
});

export const experimentRunPlanSchema = z
  .object({
    baseline: experimentRunBaselineSchema.optional(),
    baselineStart: isoDateString().optional(),
    baselineEnd: isoDateString().optional(),
    interventionStart: isoDateString().optional(),
    interventionEnd: isoDateString().optional(),
    adherenceTargets: experimentAdherenceTargetsSchema.optional(),
    modality: boundedString(1, 160).optional(),
    schedule: experimentRunScheduleIntentSchema.optional(),
    dose: boundedString(1, 160).optional(),
    sessionsPerWeek: numberSchema(0).optional(),
    targetSessions: integerSchema(0).optional(),
    minimumUsefulSessions: integerSchema(0).optional(),
    logging: experimentRunLoggingSchema.optional(),
    stopConditions: z.array(boundedString(1, 4000)).optional(),
  })
  .strict();

export const experimentExpectedDirectionSchema = z
  .object({
    biomarkerKey: healthCommonsKeySchema,
    direction: z.enum(EXPERIMENT_SIGNAL_DIRECTIONS),
  })
  .strict();

export const experimentExpectedDirectionsSchema = z.array(experimentExpectedDirectionSchema).max(50);

export const experimentMeasurementRoleSchema = z.enum(["baseline", "followup"]);

export const experimentMeasurementKindSchema = z.enum([
  "lab_panel",
  "wearable_summary",
  "manual_measurement",
  "text",
  "photo",
  "document",
]);

export const experimentMeasurementAnchorRecordIdSchema = patternedString(
  "^(?:(?:evt|sample|batch|metric_sample)_[A-Za-z0-9][A-Za-z0-9_-]*|sample-summary:[0-9]{4}-[0-9]{2}-[0-9]{2}:[A-Za-z0-9_-]+:[A-Za-z0-9_.%/-]+|sample-summary:[A-Za-z0-9_-]+:[0-9]{4}-[0-9]{2}-[0-9]{2})$",
);

export const experimentMeasurementAnchorSchema = z
  .object({
    role: experimentMeasurementRoleSchema,
    kind: experimentMeasurementKindSchema,
    recordId: experimentMeasurementAnchorRecordIdSchema,
    biomarkerKeys: uniqueArray(healthCommonsKeySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    observedOn: isoDateString().optional(),
  })
  .strict();

export const experimentMeasurementAnchorsSchema = z.array(experimentMeasurementAnchorSchema).max(50);

export const experimentPlannedMeasurementSchema = z
  .object({
    role: experimentMeasurementRoleSchema,
    kind: experimentMeasurementKindSchema,
    biomarkerKeys: uniqueArray(healthCommonsKeySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    targetWindow: z
      .object({
        start: isoDateString(),
        end: isoDateString(),
      })
      .strict(),
  })
  .strict()
  .superRefine((measurement, context) => {
    if (measurement.targetWindow.start > measurement.targetWindow.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Planned measurement targetWindow.start must be before or equal to targetWindow.end.",
        path: ["targetWindow", "end"],
      });
    }
  });

export const experimentPlannedMeasurementsSchema = z.array(experimentPlannedMeasurementSchema).max(50);

export const experimentMetricOutcomeCaptureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("measurement"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session_field"),
      fieldId: healthCommonsStableIdSchema,
      unit: patternedString(UNIT_PATTERN).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("derived_metric"),
      sourceMetricKey: patternedString(SLUG_PATTERN),
    })
    .strict(),
]);

export const experimentPrimaryOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("metric"),
      key: healthCommonsKeySchema,
      label: boundedString(1, 160).optional(),
      statistic: z.enum(EXPERIMENT_OUTCOME_STATISTICS).optional(),
      capture: experimentMetricOutcomeCaptureSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("structured_review"),
      key: healthCommonsKeySchema,
      label: boundedString(1, 160).optional(),
    })
    .strict(),
]);

export const experimentAnalysisPlanSchema = z
  .object({
    primaryBiomarkerKey: healthCommonsKeySchema.optional(),
    primaryOutcome: experimentPrimaryOutcomeSchema.optional(),
    secondaryBiomarkerKeys: uniqueArray(healthCommonsKeySchema, { uniqueItems: true }).optional(),
    desiredDirection: z.enum(EXPERIMENT_SIGNAL_DIRECTIONS).optional(),
    expectedDirections: experimentExpectedDirectionsSchema.optional(),
    measurementAnchors: experimentMeasurementAnchorsSchema.optional(),
    plannedMeasurements: experimentPlannedMeasurementsSchema.optional(),
    notes: z.array(boundedString(1, 4000)).optional(),
  })
  .strict()
  .superRefine((analysisPlan, context) => {
    if (analysisPlan.primaryOutcome !== undefined && analysisPlan.primaryBiomarkerKey !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use primaryOutcome for new records or primaryBiomarkerKey for legacy records, not both.",
        path: ["primaryBiomarkerKey"],
      });
    }

    if (analysisPlan.primaryOutcome?.kind === "structured_review") {
      const outcomeKey = analysisPlan.primaryOutcome.key;
      const baselineRecordIds = new Set(
        (analysisPlan.measurementAnchors ?? [])
          .filter(
            (anchor) =>
              anchor.role === "baseline" &&
              anchor.biomarkerKeys.includes(outcomeKey),
          )
          .map((anchor) => anchor.recordId),
      );
      for (const [index, anchor] of (analysisPlan.measurementAnchors ?? []).entries()) {
        if (
          anchor.role === "followup" &&
          anchor.biomarkerKeys.includes(outcomeKey) &&
          baselineRecordIds.has(anchor.recordId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Structured review baseline and follow-up evidence must use distinct records.",
            path: ["measurementAnchors", index, "recordId"],
          });
        }
      }
    }

    const seen = new Set<string>();
    for (const [index, entry] of (analysisPlan.expectedDirections ?? []).entries()) {
      if (seen.has(entry.biomarkerKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate expected direction.",
          path: ["expectedDirections", index, "biomarkerKey"],
        });
      }
      seen.add(entry.biomarkerKey);
    }

    const seenAnchors = new Set<string>();
    for (const [index, anchor] of (analysisPlan.measurementAnchors ?? []).entries()) {
      const key = `${anchor.role}\u0000${anchor.kind}\u0000${anchor.recordId}`;
      if (seenAnchors.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate measurement anchor.",
          path: ["measurementAnchors", index, "recordId"],
        });
      }
      seenAnchors.add(key);
    }

    const seenPlannedMeasurements = new Set<string>();
    for (const [index, planned] of (analysisPlan.plannedMeasurements ?? []).entries()) {
      const key = [
        planned.role,
        planned.kind,
        planned.targetWindow.start,
        planned.targetWindow.end,
        [...planned.biomarkerKeys].sort().join("|"),
      ].join("\u0000");
      if (seenPlannedMeasurements.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate planned measurement.",
          path: ["plannedMeasurements", index, "targetWindow"],
        });
      }
      seenPlannedMeasurements.add(key);
    }
  });

export const experimentAssistantSupportSchema = z
  .object({
    reminderPolicy: healthCommonsStableIdSchema.optional(),
    reminderOptionId: healthCommonsStableIdSchema.optional(),
    remindersEnabled: z.boolean().optional(),
    checkInCadence: z.enum(EXPERIMENT_CHECKIN_CADENCES).optional(),
    notificationStyle: z.enum(EXPERIMENT_NOTIFICATION_STYLES).optional(),
    missedLogFollowup: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES).optional(),
    weeklyDigestEnabled: z.boolean().optional(),
  })
  .strict();

export const experimentOnboardingSafetySchema = z
  .object({
    cautionLevel: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS).optional(),
    disposition: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS).optional(),
    positiveQuestionIds: uniqueArray(healthCommonsStableIdSchema, { uniqueItems: true }).optional(),
    notes: z.array(boundedString(1, 4000)).optional(),
  })
  .strict();

export const experimentOnboardingCaptureSchema = z
  .object({
    completedAt: isoDateTimeString().optional(),
    setupAnswers: jsonObjectSchema.optional(),
    safety: experimentOnboardingSafetySchema.optional(),
    contextNotes: z.array(boundedString(1, 4000)).optional(),
  })
  .strict();

export const experimentOutcomeTrackingSchema = z
  .object({
    latestOutcomeId: boundedString(1, 160).optional(),
    readyForReviewAt: isoDateTimeString().optional(),
    finalAnalysisStatus: z.enum(EXPERIMENT_ANALYSIS_STATUSES).optional(),
  })
  .strict();

export const experimentOutcomeRefSchema = z
  .object({
    outcomeId: boundedString(1, 160),
    generatedAt: isoDateTimeString().optional(),
    relativePath: patternedString(RELATIVE_PATH_PATTERN).optional(),
  })
  .strict();

export const experimentMetricPeriodSummarySchema = z
  .object({
    mean: z.number().nullable(),
    daysWithData: integerSchema(0),
    totalDays: integerSchema(0),
    unit: patternedString(UNIT_PATTERN).nullable(),
  })
  .strict();

export const experimentMetricResultSchema = z
  .object({
    baselineDayCount: integerSchema(0),
    baselineMean: z.number().nullable(),
    biomarkerKey: healthCommonsKeySchema,
    completeness: z.enum(EXPERIMENT_DATA_COMPLETENESS_LEVELS),
    deltaAbs: z.number().nullable(),
    deltaPct: z.number().nullable(),
    expectedDirection: z.enum(EXPERIMENT_SIGNAL_DIRECTIONS).nullable(),
    interventionDayCount: integerSchema(0),
    interventionMean: z.number().nullable(),
    label: boundedString(1, 160),
    movedAsExpected: z.boolean().nullable(),
    statistic: z.enum(EXPERIMENT_OUTCOME_STATISTICS).optional(),
    unit: patternedString(UNIT_PATTERN).nullable(),
    baseline: experimentMetricPeriodSummarySchema.optional(),
    intervention: experimentMetricPeriodSummarySchema.optional(),
  })
  .strict();

export const experimentOutcomeMetricPointSchema = z
  .object({
    date: isoDateString(),
    phase: z.enum(["baseline", "intervention"]),
    unit: patternedString(UNIT_PATTERN).nullable(),
    value: z.number(),
  })
  .strict();

export const experimentOutcomeMetricResultSchema = experimentMetricResultSchema
  .extend({
    points: z.array(experimentOutcomeMetricPointSchema).max(366).optional(),
  })
  .strict();

const experimentStructuredReviewEvidenceSchema = z
  .object({
    kinds: uniqueArray(experimentMeasurementKindSchema, {
      maxItems: 4,
      uniqueItems: true,
    }),
    recordIds: uniqueArray(experimentMeasurementAnchorRecordIdSchema, {
      maxItems: 50,
      uniqueItems: true,
    }),
  })
  .strict();

export const experimentStructuredReviewResultSchema = z
  .object({
    kind: z.literal("structured_review"),
    key: healthCommonsKeySchema,
    label: boundedString(1, 160),
    status: z.enum(["missing", "baseline_only", "followup_only", "ready_for_review"]),
    baseline: experimentStructuredReviewEvidenceSchema,
    followup: experimentStructuredReviewEvidenceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const expectedStatus =
      result.baseline.recordIds.length > 0 && result.followup.recordIds.length > 0
        ? "ready_for_review"
        : result.baseline.recordIds.length > 0
          ? "baseline_only"
          : result.followup.recordIds.length > 0
            ? "followup_only"
            : "missing";
    if (result.status !== expectedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structured review status must match its baseline and follow-up evidence.",
        path: ["status"],
      });
    }

    const baselineIds = new Set(result.baseline.recordIds);
    const duplicateIndex = result.followup.recordIds.findIndex((recordId) =>
      baselineIds.has(recordId)
    );
    if (duplicateIndex >= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structured review baseline and follow-up evidence must use distinct records.",
        path: ["followup", "recordIds", duplicateIndex],
      });
    }
  });

export const experimentProgressMetricSignalSchema = z
  .object({
    biomarkerKey: healthCommonsKeySchema,
    label: boundedString(1, 160),
    unit: patternedString(UNIT_PATTERN).nullable(),
    baselineMean: z.number().nullable(),
    currentInterventionMean: z.number().nullable(),
    deltaAbs: z.number().nullable(),
    expectedDirection: z.enum(EXPERIMENT_SIGNAL_DIRECTIONS).nullable(),
    movedAsExpected: z.boolean().nullable(),
    confidence: z.enum(EXPERIMENT_CONFIDENCE_LEVELS),
    reason: boundedString(1, 4000),
    baselineDaysAvailable: integerSchema(0),
    interventionDaysAvailable: integerSchema(0),
  })
  .strict();

export const experimentWindowSummarySchema = z
  .object({
    baselineEnd: isoDateString().nullable(),
    baselineStart: isoDateString().nullable(),
    interventionEnd: isoDateString().nullable(),
    interventionStart: isoDateString().nullable(),
  })
  .strict();

const experimentProgressReadinessReasonSchema = z.enum([
  "missing_run_plan",
  "missing_baseline_window",
  "missing_intervention_window",
  "missing_analysis_plan",
  "missing_primary_biomarker",
  "missing_metric_window",
  "unsupported_primary_biomarker",
  "uncapturable_primary_biomarker",
]);

const experimentProgressReadinessSchema = z
  .object({
    status: z.enum(["ready", "incomplete"]),
    blockingReasons: z.array(experimentProgressReadinessReasonSchema),
  })
  .strict();

export const experimentProgressSnapshotSchema = z
  .object({
    schemaVersion: z.literal(EXPERIMENT_PROGRESS_SCHEMA_VERSION),
    schema: z.literal(EXPERIMENT_PROGRESS_SCHEMA_VERSION).optional(),
    asOf: isoDateString(),
    adherence: z
      .object({
        completedSessions: integerSchema(0),
        assumedSessions: integerSchema(0).optional(),
        evidence: z
          .object({
            eventKind: z.enum(["activity_session", "intervention_session"]),
            activityKind: boundedString(1, 80).optional(),
            activityKinds: uniqueArray(boundedString(1, 80), {
              minItems: 1,
              maxItems: 16,
              uniqueItems: true,
            }).optional(),
            minimumDurationMinutes: integerSchema(1).optional(),
          })
          .strict()
          .optional(),
        confirmedSessions: integerSchema(0).optional(),
        expectedSessionsByNow: integerSchema(0).nullable(),
        loggedSessions: integerSchema(0).optional(),
        minimumUsefulSessions: integerSchema(0).nullable(),
        partialSessions: integerSchema(0).optional(),
        sensedSessions: integerSchema(0).optional(),
        sessionEventIds: uniqueArray(idSchema(ID_PREFIXES.event), { uniqueItems: true }).optional(),
        status: z.enum(EXPERIMENT_ADHERENCE_STATUSES),
        targetSessions: integerSchema(0).nullable(),
      })
      .strict(),
    confounders: z.array(boundedString(1, 4000)).max(100),
    dataCoverage: z
      .object({
        activityProviders: z.array(boundedString(1, 160)).max(20).optional(),
        baselineDaysAvailable: integerSchema(0),
        interventionDaysAvailable: integerSchema(0),
        primaryBiomarkerKey: healthCommonsKeySchema.nullable().optional(),
        primaryMetricDaysAvailable: integerSchema(0),
        status: z.enum(EXPERIMENT_COVERAGE_STATUSES),
        wearableProviders: z.array(boundedString(1, 160)).max(20),
      })
      .strict(),
    dayInRun: integerSchema(1).nullable(),
    setupReadiness: experimentProgressReadinessSchema,
    analysisReadiness: experimentProgressReadinessSchema,
    experiment: z
      .object({
        id: idSchema(ID_PREFIXES.experiment),
        slug: patternedString(SLUG_PATTERN),
        status: z.enum(EXPERIMENT_STATUSES),
        title: boundedString(1, 160),
      })
      .strict(),
    phase: z.enum(EXPERIMENT_PROGRESS_PHASES),
    commonsProtocolRef: commonsProtocolRefSchema.nullable(),
    protocolRef: protocolRefSchema.nullable().optional(),
    recommendation: z
      .object({
        action: z.enum(EXPERIMENT_RECOMMENDATION_ACTIONS),
        reason: boundedString(1, 4000),
        shouldNotifyUser: z.boolean(),
      })
      .strict(),
    signals: z.array(experimentMetricResultSchema).max(50),
    earlySignals: z.array(experimentProgressMetricSignalSchema).max(50).optional(),
    windows: experimentWindowSummarySchema,
  })
  .strict();

export const experimentOutcomeSchema = z
  .object({
    schemaVersion: z.enum(EXPERIMENT_OUTCOME_SCHEMA_VERSIONS),
    schema: z.enum(EXPERIMENT_OUTCOME_SCHEMA_VERSIONS).optional(),
    outcomeId: boundedString(1, 160).optional(),
    generatedAt: isoDateTimeString().optional(),
    adherenceSummary: z
      .object({
        adherenceLevel: z.enum(["unknown", "low", "partial", "good"]).optional(),
        completedSessions: integerSchema(0),
        minimumUsefulSessions: integerSchema(0).nullable(),
        status: z.enum(EXPERIMENT_ADHERENCE_STATUSES),
        targetSessions: integerSchema(0).nullable(),
      })
      .strict(),
    asOf: isoDateString(),
    conclusion: z
      .object({
        caveats: z.array(boundedString(1, 4000)).max(50),
        headline: boundedString(1, 240),
        plainLanguage: boundedString(1, 4000),
      })
      .strict(),
    confidence: z
      .object({
        level: z.enum(EXPERIMENT_CONFIDENCE_LEVELS),
        reasons: z.array(boundedString(1, 4000)).max(50),
      })
      .strict(),
    confounders: z.array(boundedString(1, 4000)).max(100),
    experiment: z
      .object({
        id: idSchema(ID_PREFIXES.experiment),
        slug: patternedString(SLUG_PATTERN),
        status: z.enum(EXPERIMENT_STATUSES),
        title: boundedString(1, 160),
      })
      .strict(),
    commonsProtocolRef: commonsProtocolRefSchema.nullable(),
    effectiveProtocolSnapshot: effectiveProtocolSnapshotSchema.nullable().optional(),
    metricResults: z.array(experimentOutcomeMetricResultSchema).max(50),
    structuredReview: experimentStructuredReviewResultSchema.optional(),
    protocolRef: protocolRefSchema.nullable().optional(),
    windows: experimentWindowSummarySchema,
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.schema !== undefined && outcome.schema !== outcome.schemaVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Experiment outcome schema must match schemaVersion.",
        path: ["schema"],
      });
    }

    if (
      outcome.schemaVersion === LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION &&
      outcome.structuredReview !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Legacy experiment outcomes cannot contain a structured review result.",
        path: ["structuredReview"],
      });
    }

    for (const [metricIndex, metric] of outcome.metricResults.entries()) {
      if (outcome.schemaVersion === LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION) {
        if (metric.points !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Legacy experiment outcomes cannot contain daily point snapshots.",
            path: ["metricResults", metricIndex, "points"],
          });
        }
        continue;
      }

      if (metric.points === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Current experiment outcomes must contain a daily point snapshot.",
          path: ["metricResults", metricIndex, "points"],
        });
        continue;
      }

      const baselinePoints = metric.points.filter((point) => point.phase === "baseline");
      const interventionPoints = metric.points.filter((point) => point.phase === "intervention");
      const baselineMean = metric.baseline ? metric.baseline.mean : metric.baselineMean;
      const interventionMean = metric.intervention
        ? metric.intervention.mean
        : metric.interventionMean;
      validateExperimentOutcomeMetricPointDates({
        context,
        metricIndex,
        points: metric.points,
      });
      validateExperimentOutcomeMetricPointWindow({
        context,
        daysWithData: metric.baseline?.daysWithData ?? metric.baselineDayCount,
        mean: baselineMean,
        metricIndex,
        phase: "baseline",
        points: baselinePoints,
        statistic: metric.statistic ?? "mean",
        unit: metric.baseline?.unit ?? metric.unit,
      });
      validateExperimentOutcomeMetricPointWindow({
        context,
        daysWithData: metric.intervention?.daysWithData ?? metric.interventionDayCount,
        mean: interventionMean,
        metricIndex,
        phase: "intervention",
        points: interventionPoints,
        statistic: metric.statistic ?? "mean",
        unit: metric.intervention?.unit ?? metric.unit,
      });
      validateExperimentOutcomeMetricDelta({
        baselineMean,
        baselineUnit: metric.baseline?.unit ?? metric.unit,
        context,
        deltaAbs: metric.deltaAbs,
        deltaPct: metric.deltaPct,
        interventionMean,
        interventionUnit: metric.intervention?.unit ?? metric.unit,
        metricIndex,
        statistic: metric.statistic ?? "mean",
      });
    }
  });

function validateExperimentOutcomeMetricPointDates(input: {
  context: z.RefinementCtx;
  metricIndex: number;
  points: Array<z.infer<typeof experimentOutcomeMetricPointSchema>>;
}): void {
  const dates = new Set<string>();
  for (const [pointIndex, point] of input.points.entries()) {
    if (dates.has(point.date)) {
      input.context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Experiment outcome metric point dates must be unique.",
        path: ["metricResults", input.metricIndex, "points", pointIndex, "date"],
      });
    }
    dates.add(point.date);
  }
}

export function summarizeExperimentOutcomeValues(
  points: readonly { date: string; value: number }[],
  statistic: ExperimentOutcomeStatistic = "mean",
): number | null {
  const finitePoints = points.filter((point) => Number.isFinite(point.value));
  if (finitePoints.length === 0) {
    return null;
  }

  const values = finitePoints.map((point) => point.value);
  let summary: number;
  switch (statistic) {
    case "count":
      summary = values.reduce((sum, value) => sum + value, 0);
      break;
    case "latest":
      summary = [...finitePoints]
        .sort((left, right) => left.date.localeCompare(right.date))
        .at(-1)!.value;
      break;
    case "median": {
      const sorted = [...values].sort((left, right) => left - right);
      const midpoint = Math.floor(sorted.length / 2);
      summary = sorted.length % 2 === 0
        ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
        : sorted[midpoint]!;
      break;
    }
    case "min":
      summary = Math.min(...values);
      break;
    case "max":
      summary = Math.max(...values);
      break;
    case "sum":
      summary = values.reduce((sum, value) => sum + value, 0);
      break;
    case "mean":
      summary = values.reduce((sum, value) => sum + value, 0) / values.length;
      break;
  }

  return Math.round(summary * 100) / 100;
}

function validateExperimentOutcomeMetricPointWindow(input: {
  context: z.RefinementCtx;
  daysWithData: number;
  mean: number | null;
  metricIndex: number;
  phase: "baseline" | "intervention";
  points: Array<z.infer<typeof experimentOutcomeMetricPointSchema>>;
  statistic: ExperimentOutcomeStatistic;
  unit: string | null;
}): void {
  if (input.points.length !== input.daysWithData) {
    input.context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Experiment outcome ${input.phase} point count must match daysWithData.`,
      path: ["metricResults", input.metricIndex, "points"],
    });
  }

  const summary = summarizeExperimentOutcomeValues(input.points, input.statistic);
  const pointUnits = new Set(input.points.map((point) => point.unit));
  const incompatibleUnits = input.statistic !== "count" && pointUnits.size > 1;
  if (summary !== input.mean && !(incompatibleUnits && input.mean === null)) {
    input.context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Experiment outcome ${input.phase} point summary must match the saved summary.`,
      path: ["metricResults", input.metricIndex, "points"],
    });
  }
  if (
    !(incompatibleUnits && input.unit === null) &&
    input.points.some((point) => point.unit !== input.unit)
  ) {
    input.context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Experiment outcome ${input.phase} point units must match the saved summary.`,
      path: ["metricResults", input.metricIndex, "points"],
    });
  }
}

function validateExperimentOutcomeMetricDelta(input: {
  baselineMean: number | null;
  baselineUnit: string | null;
  context: z.RefinementCtx;
  deltaAbs: number | null;
  deltaPct: number | null;
  interventionMean: number | null;
  interventionUnit: string | null;
  metricIndex: number;
  statistic: ExperimentOutcomeStatistic;
}): void {
  const unitsCompatible =
    input.statistic === "count" ||
    input.baselineUnit === input.interventionUnit;
  const deltaAbs = unitsCompatible &&
      input.baselineMean !== null &&
      input.interventionMean !== null
    ? Math.round((input.interventionMean - input.baselineMean) * 100) / 100
    : null;
  const deltaPct = unitsCompatible &&
      input.baselineMean !== null &&
      input.interventionMean !== null &&
      input.baselineMean !== 0
    ? Math.round(
        ((input.interventionMean - input.baselineMean) / Math.abs(input.baselineMean)) * 10_000,
      ) / 100
    : null;
  if (deltaAbs !== input.deltaAbs || deltaPct !== input.deltaPct) {
    input.context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Experiment outcome metric deltas must match the saved window means.",
      path: ["metricResults", input.metricIndex, "deltaAbs"],
    });
  }
}

export const experimentFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.experimentFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.experiment),
      experimentId: idSchema(ID_PREFIXES.experiment),
      slug: patternedString(SLUG_PATTERN),
      status: z.enum(EXPERIMENT_STATUSES),
      title: boundedString(1, 160),
      startedOn: isoDateString(),
      endedOn: isoDateString().optional(),
      hypothesis: boundedString(1, 4000).optional(),
      tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
      commonsProtocolRef: commonsProtocolRefSchema.optional(),
      protocolRef: protocolRefSchema.optional(),
      effectiveProtocolSnapshot: effectiveProtocolSnapshotSchema.optional(),
      runPlan: experimentRunPlanSchema.optional(),
      analysisPlan: experimentAnalysisPlanSchema.optional(),
      onboarding: experimentOnboardingCaptureSchema.optional(),
      assistantSupport: experimentAssistantSupportSchema.optional(),
      outcome: experimentOutcomeTrackingSchema.optional(),
      outcomeRef: experimentOutcomeRefSchema.optional(),
    })
    .strict()
    .superRefine((frontmatter, context) => {
      if (frontmatter.protocolRef !== undefined && frontmatter.commonsProtocolRef === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Protocol-backed experiment frontmatter requires a commonsProtocolRef.",
          path: ["commonsProtocolRef"],
        });
      }

      if (frontmatter.commonsProtocolRef !== undefined && frontmatter.effectiveProtocolSnapshot === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Commons protocol-backed experiment frontmatter requires an effectiveProtocolSnapshot.",
          path: ["effectiveProtocolSnapshot"],
        });
        return;
      }

      if (
        frontmatter.protocolRef !== undefined &&
        frontmatter.effectiveProtocolSnapshot !== undefined &&
        frontmatter.protocolRef.effectiveSpecHash !==
        frontmatter.effectiveProtocolSnapshot.effectiveSpecHash
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Protocol-backed experiment effectiveSpecHash values must match.",
          path: ["effectiveProtocolSnapshot", "effectiveSpecHash"],
        });
      }
    }),
  "@murphai/contracts/frontmatter-experiment.schema.json",
  "Murph Experiment Frontmatter",
);

export const providerFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.providerFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.provider),
      providerId: idSchema(ID_PREFIXES.provider),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: boundedString(1, 64).optional(),
      specialty: boundedString(1, 160).optional(),
      organization: boundedString(1, 160).optional(),
      location: boundedString(1, 160).optional(),
      website: boundedString(1, 240).optional(),
      phone: boundedString(1, 64).optional(),
      note: boundedString(1, 4000).optional(),
      aliases: uniqueArray(boundedString(1, 160), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-provider.schema.json",
  "Murph Provider Frontmatter",
);

export const foodFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.foodFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.food),
      foodId: idSchema(ID_PREFIXES.food),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.enum(FOOD_STATUSES),
      summary: boundedString(1, 4000).optional(),
      kind: boundedString(1, 160).optional(),
      brand: boundedString(1, 160).optional(),
      vendor: boundedString(1, 160).optional(),
      location: boundedString(1, 160).optional(),
      serving: boundedString(1, 160).optional(),
      nutrition: foodNutritionSchema.optional(),
      aliases: uniqueArray(boundedString(1, 160), { uniqueItems: true }).optional(),
      ingredients: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
      attachedRegimenIds: uniqueArray(idSchema(ID_PREFIXES.regimen), {
        maxItems: 32,
        uniqueItems: true,
      }).optional(),
      links: uniqueArray(foodRelationLinkSchema, { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-food.schema.json",
  "Murph Food Frontmatter",
);

export const recipeFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.recipeFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.recipe),
      recipeId: idSchema(ID_PREFIXES.recipe),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.enum(RECIPE_STATUSES),
      summary: boundedString(1, 4000).optional(),
      cuisine: boundedString(1, 160).optional(),
      dishType: boundedString(1, 160).optional(),
      source: boundedString(1, 240).optional(),
      servings: numberSchema(0).optional(),
      prepTimeMinutes: integerSchema(0).optional(),
      cookTimeMinutes: integerSchema(0).optional(),
      totalTimeMinutes: integerSchema(0).optional(),
      tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
      ingredients: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      steps: uniqueArray(boundedString(1, 4000), { maxItems: 100 }).optional(),
      relatedGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
      relatedConditionIds: uniqueArray(idSchema(ID_PREFIXES.condition), { uniqueItems: true }).optional(),
      links: uniqueArray(recipeRelationLinkSchema, { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-recipe.schema.json",
  "Murph Recipe Frontmatter",
);

export const workoutFormatFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.workoutFormatFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.workoutFormat),
      workoutFormatId: idSchema(ID_PREFIXES.workoutFormat),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.enum(WORKOUT_FORMAT_STATUSES),
      summary: boundedString(1, 4000).optional(),
      activityType: patternedString(SLUG_PATTERN),
      durationMinutes: integerSchema(1, 24 * 60).optional(),
      distanceKm: numberSchema(0, 1_000).optional(),
      template: workoutTemplateSchema,
      tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
      templateText: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-workout-format.schema.json",
  "Murph Workout Format Frontmatter",
);

const HABITAT_INDICATOR_ID_PATTERN = "^[a-z0-9]+(?:_[a-z0-9]+)*$";

const habitatStoredIndicatorValueSchema = z.union([
  z.string().max(400),
  z.number(),
  z.boolean(),
]);

export const habitatFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.habitatFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.habitat),
      habitatId: idSchema(ID_PREFIXES.habitat),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.literal("active"),
      domain: z.enum(HABITAT_DOMAIN_IDS),
      aspect: patternedString(SLUG_PATTERN),
      indicators: z.record(
        patternedString(HABITAT_INDICATOR_ID_PATTERN),
        habitatStoredIndicatorValueSchema,
      ),
      indicatorRecordedAt: z
        .record(patternedString(HABITAT_INDICATOR_ID_PATTERN), isoDateString())
        .optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const aspect = getHabitatAspectDefinition(value.aspect);

      if (!aspect) {
        context.addIssue({
          code: "custom",
          path: ["aspect"],
          message: `Unknown habitat aspect "${value.aspect}".`,
        });
        return;
      }

      if (value.slug !== value.aspect) {
        context.addIssue({
          code: "custom",
          path: ["slug"],
          message: `Habitat slug must match aspect "${value.aspect}".`,
        });
      }

      if (aspect.domain !== value.domain) {
        context.addIssue({
          code: "custom",
          path: ["domain"],
          message: `Habitat aspect "${value.aspect}" belongs to domain "${aspect.domain}".`,
        });
      }

      for (const [indicatorId, indicatorValue] of Object.entries(value.indicators)) {
        const definition = getHabitatIndicatorDefinition(value.aspect, indicatorId);

        if (!definition) {
          context.addIssue({
            code: "custom",
            path: ["indicators", indicatorId],
            message: `Indicator "${indicatorId}" is not part of habitat aspect "${value.aspect}".`,
          });
          continue;
        }

        if (!value.indicatorRecordedAt?.[indicatorId]) {
          context.addIssue({
            code: "custom",
            path: ["indicatorRecordedAt", indicatorId],
            message: `Indicator "${indicatorId}" requires a recordedAt date.`,
          });
        }

        const issue = validateHabitatIndicatorValue(definition, indicatorValue);
        if (issue) {
          context.addIssue({
            code: "custom",
            path: ["indicators", indicatorId],
            message: issue,
          });
        }
      }

      for (const indicatorId of Object.keys(value.indicatorRecordedAt ?? {})) {
        const definition = getHabitatIndicatorDefinition(value.aspect, indicatorId);

        if (!definition) {
          context.addIssue({
            code: "custom",
            path: ["indicatorRecordedAt", indicatorId],
            message: `Indicator timestamp "${indicatorId}" is not part of habitat aspect "${value.aspect}".`,
          });
          continue;
        }

        if (!(indicatorId in value.indicators)) {
          context.addIssue({
            code: "custom",
            path: ["indicatorRecordedAt", indicatorId],
            message: `Indicator timestamp "${indicatorId}" has no stored indicator value.`,
          });
        }
      }
    }),
  "@murphai/contracts/frontmatter-habitat.schema.json",
  "Murph Habitat Frontmatter",
);

export const assessmentResponseSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.assessmentResponse),
      id: idSchema(ID_PREFIXES.assessment),
      assessmentType: patternedString(SLUG_PATTERN),
      recordedAt: isoDateTimeString(),
      source: z.enum(ASSESSMENT_SOURCES),
      rawPath: patternedString(RAW_ASSESSMENT_SOURCE_PATTERN),
      title: boundedString(1, 160).optional(),
      questionnaireSlug: patternedString(SLUG_PATTERN).optional(),
      responses: jsonObjectSchema,
      relatedIds: uniqueArray(patternedString(GENERIC_CONTRACT_ID_PATTERN), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/assessment-response.schema.json",
  "Murph Assessment Response",
);

export const rawImportManifestArtifactSchema = z
  .object({
    role: boundedString(1, 160),
    relativePath: patternedString(RAW_PATH_PATTERN),
    originalFileName: boundedString(1, 255),
    mediaType: boundedString(1, 255),
    byteSize: integerSchema(0),
    sha256: patternedString(SHA256_HEX_PATTERN, 64, 64),
  })
  .strict();

const RAW_ASSET_OWNER_KINDS_REQUIRING_PARTITION = new Set<RawAssetOwnerKind>([
  "device_batch",
  "sample_batch",
  "workout_batch",
]);

export const rawAssetOwnerSchema = z
  .object({
    kind: z.enum(RAW_ASSET_OWNER_KINDS),
    id: z.string(),
    partition: patternedString(SINGLE_PATH_SEGMENT_PATTERN).optional(),
  })
  .strict()
  .superRefine((owner, context) => {
    const requiresPartition = RAW_ASSET_OWNER_KINDS_REQUIRING_PARTITION.has(owner.kind);
    const hasGenericId = GENERIC_CONTRACT_ID_REGEX.test(owner.id);

    if (!hasGenericId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Raw asset owner id must match ${GENERIC_CONTRACT_ID_PATTERN}.`,
        path: ["id"],
      });
    }

    if (requiresPartition && owner.partition === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Raw asset owner kind "${owner.kind}" requires partition.`,
        path: ["partition"],
      });
    }

    if (!requiresPartition && owner.partition !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Raw asset owner kind "${owner.kind}" must not include partition.`,
        path: ["partition"],
      });
    }
  });

export const rawImportManifestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.rawImportManifest),
    importId: z.string().refine(
      (value) => GENERIC_CONTRACT_ID_REGEX.test(value),
      `Invalid raw import id. Expected ${GENERIC_CONTRACT_ID_PATTERN}.`,
    ),
    importKind: z.enum(RAW_IMPORT_KINDS),
    importedAt: isoDateTimeString(),
    source: boundedString(1, 160).nullable(),
    owner: rawAssetOwnerSchema,
    rawDirectory: patternedString(RAW_PATH_PATTERN),
    artifacts: uniqueArray(rawImportManifestArtifactSchema, { uniqueItems: true }),
    provenance: jsonObjectSchema,
  })
  .strict();

export const goalFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.goalFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.goal),
      goalId: idSchema(ID_PREFIXES.goal),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.enum(GOAL_STATUSES),
      horizon: z.enum(GOAL_HORIZONS),
      priority: integerSchema(1, 10),
      window: z
        .object({
          startAt: isoDateString(),
          targetAt: isoDateString().optional(),
        })
        .strict(),
      parentGoalId: z.union([idSchema(ID_PREFIXES.goal), z.null()]).optional(),
      relatedGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
      relatedExperimentIds: uniqueArray(idSchema(ID_PREFIXES.experiment), { uniqueItems: true }).optional(),
      links: uniqueArray(goalRelationLinkSchema, { uniqueItems: true }).optional(),
      domains: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
      metricTargets: uniqueArray(goalMetricTargetSchema, { maxItems: 20, uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-goal.schema.json",
  "Murph Goal Frontmatter",
);

export const conditionFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.conditionFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.condition),
      conditionId: idSchema(ID_PREFIXES.condition),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES),
      verificationStatus: z.enum(CONDITION_VERIFICATION_STATUSES).optional(),
      assertedOn: isoDateString().optional(),
      resolvedOn: isoDateString().optional(),
      severity: z.enum(CONDITION_SEVERITIES).optional(),
      bodySites: uniqueArray(boundedString(1, 120), { uniqueItems: true }).optional(),
      relatedGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
      relatedRegimenIds: uniqueArray(idSchema(ID_PREFIXES.regimen), { uniqueItems: true }).optional(),
      links: uniqueArray(conditionRelationLinkSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-condition.schema.json",
  "Murph Condition Frontmatter",
);

export const allergyFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.allergyFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.allergy),
      allergyId: idSchema(ID_PREFIXES.allergy),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      substance: boundedString(1, 160),
      status: z.enum(ALLERGY_STATUSES),
      criticality: z.enum(ALLERGY_CRITICALITIES).optional(),
      reaction: boundedString(1, 160).optional(),
      recordedOn: isoDateString().optional(),
      relatedConditionIds: uniqueArray(idSchema(ID_PREFIXES.condition), { uniqueItems: true }).optional(),
      links: uniqueArray(allergyRelationLinkSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-allergy.schema.json",
  "Murph Allergy Frontmatter",
);

export const protocolFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.protocolFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.protocol),
      protocolId: idSchema(ID_PREFIXES.protocol),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, 160),
      status: z.enum(PROTOCOL_STATUSES),
      commonsProtocolRef: commonsProtocolRefSchema,
      lineage: protocolLineageSchema,
      diff: z.array(protocolDiffEntrySchema).max(100),
      effectiveSpec: protocolEffectiveSpecSchema,
      personalization: protocolPersonalizationSchema,
      effectiveSpecHash: sha256DigestSchema,
      protocolRevisionId: sha256DigestSchema,
    })
    .strict(),
  "@murphai/contracts/frontmatter-protocol.schema.json",
  "Murph Protocol Frontmatter",
);

export const regimenFrontmatterSchema = withContractMetadata(
  (() => {
    const supplementIngredientSchema = z
      .object({
        compound: boundedString(1, 160),
        label: boundedString(1, 160).optional(),
        amount: numberSchema(0).optional(),
        unit: patternedString(UNIT_PATTERN).optional(),
        active: z.boolean().optional(),
        note: boundedString(1, 4000).optional(),
      })
      .strict();

    return z
      .object({
        schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.regimenFrontmatter),
        docType: z.literal(FRONTMATTER_DOC_TYPES.regimen),
        regimenId: idSchema(ID_PREFIXES.regimen),
        slug: patternedString(SLUG_PATTERN),
        title: boundedString(1, 160),
        kind: z.enum(REGIMEN_KINDS),
        status: z.enum(REGIMEN_STATUSES),
        startedOn: isoDateString(),
        stoppedOn: isoDateString().optional(),
        substance: boundedString(1, 160).optional(),
        dose: numberSchema(0).optional(),
        unit: patternedString(UNIT_PATTERN).optional(),
        schedule: boundedString(1, 160).optional(),
        brand: boundedString(1, 160).optional(),
        manufacturer: boundedString(1, 160).optional(),
        servingSize: boundedString(1, 160).optional(),
        note: boundedString(1, 4000).optional(),
        ingredients: z.array(supplementIngredientSchema).max(SUPPLEMENT_INGREDIENTS_MAX_ITEMS).optional(),
        relatedGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
        relatedConditionIds: uniqueArray(idSchema(ID_PREFIXES.condition), { uniqueItems: true }).optional(),
        relatedRegimenIds: uniqueArray(idSchema(ID_PREFIXES.regimen), { uniqueItems: true }).optional(),
        links: uniqueArray(regimenRelationLinkSchema, { uniqueItems: true }).optional(),
      })
      .strict();
  })(),
  "@murphai/contracts/frontmatter-regimen.schema.json",
  "Murph Regimen Frontmatter",
);

export const familyMemberFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.familyMemberFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.familyMember),
      familyMemberId: idSchema(ID_PREFIXES.family),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, FAMILY_MEMBER_LIMITS.title),
      relationship: boundedString(1, FAMILY_MEMBER_LIMITS.relationship),
      conditions: uniqueArray(boundedString(1, FAMILY_MEMBER_LIMITS.condition), { uniqueItems: true }).optional(),
      conditionHistory: z.array(familyConditionHistoryEntrySchema).max(100).optional(),
      deceased: z.boolean().optional(),
      note: boundedString(1, FAMILY_MEMBER_LIMITS.note).optional(),
      relatedVariantIds: uniqueArray(idSchema(ID_PREFIXES.variant), { uniqueItems: true }).optional(),
      links: uniqueArray(familyRelationLinkSchema, { uniqueItems: true }).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-family-member.schema.json",
  "Murph Family Member Frontmatter",
);

export const geneticVariantFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.geneticVariant),
      variantId: idSchema(ID_PREFIXES.variant),
      slug: patternedString(SLUG_PATTERN),
      title: boundedString(1, GENETIC_VARIANT_LIMITS.title),
      gene: boundedString(1, GENETIC_VARIANT_LIMITS.gene),
      zygosity: z.enum(VARIANT_ZYGOSITIES).optional(),
      significance: z.enum(VARIANT_SIGNIFICANCES).optional(),
      inheritance: boundedString(1, GENETIC_VARIANT_LIMITS.inheritance).optional(),
      sourceFamilyMemberIds: uniqueArray(idSchema(ID_PREFIXES.family), { uniqueItems: true }).optional(),
      links: uniqueArray(geneticVariantRelationLinkSchema, { uniqueItems: true }).optional(),
      note: boundedString(1, GENETIC_VARIANT_LIMITS.note).optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-genetic-variant.schema.json",
  "Murph Genetic Variant Frontmatter",
);

export type ExternalRef = z.infer<typeof externalRefSchema>;
export type VersionedExternalRef = z.infer<typeof versionedExternalRefSchema>;
export type PublicEventImportJsonlRowPayload = z.infer<typeof publicEventImportJsonlRowPayloadSchema>;
export type EventImportUpsertDecision = z.infer<typeof eventImportUpsertDecisionSchema>;
export type EventImportRetractionDecision = z.infer<typeof eventImportRetractionDecisionSchema>;
export type EventImportDecision = z.infer<typeof eventImportDecisionSchema>;
export type DeviceDataOrigin = z.infer<typeof deviceDataOriginSchema>;
export type NutritionData = z.infer<typeof nutritionDataSchema>;
export type NutritionProvenance = z.infer<typeof nutritionProvenanceSchema>;
export type FoodNutrition = z.infer<typeof foodNutritionSchema>;
export type MealNutrition = z.infer<typeof mealNutritionSchema>;
export type MealMicronutrients = z.infer<typeof mealMicronutrientsSchema>;
export type MealMicronutrientKey = (typeof MEAL_MICRONUTRIENT_KEYS)[number];
export type ActivityStrengthExercise = z.infer<typeof activityStrengthExerciseSchema>;
export type WorkoutSetType = z.infer<typeof workoutSetTypeSchema>;
export type WorkoutExerciseMode = z.infer<typeof workoutExerciseModeSchema>;
export type WorkoutLoadUnit = z.infer<typeof workoutLoadUnitSchema>;
export type StoredMediaKind = z.infer<typeof storedMediaKindSchema>;
export type StoredMedia = z.infer<typeof storedMediaSchema>;
export type EventAttachmentKind = z.infer<typeof eventAttachmentKindSchema>;
export type EventAttachment = z.infer<typeof eventAttachmentSchema>;
export type RawAssetOwner = z.infer<typeof rawAssetOwnerSchema>;
export type BodyMeasurementType = z.infer<typeof bodyMeasurementTypeSchema>;
export type BodyMeasurementUnit = z.infer<typeof bodyMeasurementUnitSchema>;
export type BodyMeasurementEntry = z.infer<typeof bodyMeasurementEntrySchema>;
export type MeasurementQualifierValue = z.infer<typeof measurementQualifierValueSchema>;
export type MeasurementQualifiers = z.infer<typeof measurementQualifiersSchema>;
export type MeasurementEntry = z.infer<typeof measurementEntrySchema>;
export type EncounterDiagnosis = z.infer<typeof encounterDiagnosisSchema>;
export type WorkoutWeightUnitPreferenceValue = z.infer<typeof workoutWeightUnitPreferenceValueSchema>;
export type WorkoutBodyMeasurementUnitPreferenceValue = z.infer<
  typeof workoutBodyMeasurementUnitPreferenceValueSchema
>;
export type WorkoutUnitPreferenceValues = z.infer<typeof workoutUnitPreferenceValuesSchema>;
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type WorkoutSessionMetrics = z.infer<typeof workoutSessionMetricsSchema>;
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
export type WorkoutImportPayload = z.infer<typeof workoutImportPayloadSchema>;
export type WorkoutTemplateSet = z.infer<typeof workoutTemplateSetSchema>;
export type WorkoutTemplateExercise = z.infer<typeof workoutTemplateExerciseSchema>;
export type WorkoutTemplate = z.infer<typeof workoutTemplateSchema>;
export type BloodTestReferenceRange = z.infer<typeof bloodTestReferenceRangeSchema>;
export type BloodTestResultRecord = z.infer<typeof bloodTestResultSchema>;
export type BloodTestImportPayload = z.infer<typeof bloodTestImportPayloadSchema>;
export type VaultMetadata = z.infer<typeof vaultMetadataSchema>;
export type DocumentEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "document" }>;
export type MealEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "meal" }>;
export type SymptomEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "symptom" }>;
export type NoteEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "note" }>;
export type ObservationEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "observation" }>;
export type MeasurementEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "measurement" }>;
export type ExperimentEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "experiment_event" }>;
export type MedicationIntakeEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "medication_intake" }>;
export type SupplementIntakeEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "supplement_intake" }>;
export type ActivitySessionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "activity_session" }>;
export type BodyMeasurementEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "body_measurement" }>;
export type SleepSessionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "sleep_session" }>;
export type InterventionSessionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "intervention_session" }>;
export type ClinicalAssertionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "clinical_assertion" }>;
export type ClinicalEvidenceRef = z.infer<typeof clinicalEvidenceRefSchema>;
export type ClinicalNoteSection = z.infer<typeof clinicalNoteSectionSchema>;
export type EncounterEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "encounter" }>;
export type ImmunizationEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "immunization" }>;
export type ProcedureEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "procedure" }>;
export type TestEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "test" }>;
export type AdverseEffectEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "adverse_effect" }>;
export type ExposureEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "exposure" }>;
export type FamilyConditionHistoryEntry = z.infer<typeof familyConditionHistoryEntrySchema>;
export type EventRecord = z.infer<typeof eventRecordSchema>;
export type HeartRateSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "heart_rate" }>;
export type Spo2SampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "spo2" }>;
export type HrvSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "hrv" }>;
export type StepsSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "steps" }>;
export type SleepStageSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "sleep_stage" }>;
export type RespiratoryRateSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "respiratory_rate" }>;
export type TemperatureSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "temperature" }>;
export type GlucoseSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "glucose" }>;
export type SampleRecord = z.infer<typeof sampleRecordSchema>;
export type MetricSampleQualifierValue = z.infer<typeof metricSampleQualifierValueSchema>;
export type MetricSampleQualifiers = z.infer<typeof metricSampleQualifiersSchema>;
export type MetricSampleRecord = z.infer<typeof metricSampleRecordSchema>;
export type AuditRecord = z.infer<typeof auditRecordSchema>;
export type InboxCaptureAttachmentRecord = z.infer<typeof inboxCaptureAttachmentSchema>;
export type InboxCaptureRecord = z.infer<typeof inboxCaptureRecordSchema>;
export type InboxAttachmentRetentionRecord = z.infer<typeof inboxAttachmentRetentionRecordSchema>;
export type CoreFrontmatter = z.infer<typeof coreFrontmatterSchema>;
export type JournalDayFrontmatter = z.infer<typeof journalDayFrontmatterSchema>;
export type CommonsProtocolRef = z.infer<typeof commonsProtocolRefSchema>;
export type ProtocolRef = z.infer<typeof protocolRefSchema>;
export type ProtocolActivitySessionEvidence = z.infer<
  typeof protocolActivitySessionEvidenceSchema
>;
export type EffectiveProtocolSnapshot = z.infer<typeof effectiveProtocolSnapshotSchema>;
export type ProtocolEffectiveSpec = z.infer<typeof protocolEffectiveSpecSchema>;
export type ProtocolLineage = z.infer<typeof protocolLineageSchema>;
export type ProtocolDiffEntry = z.infer<typeof protocolDiffEntrySchema>;
export type ProtocolPersonalization = z.infer<typeof protocolPersonalizationSchema>;
export type ExperimentAdherenceCalendar = z.infer<typeof experimentAdherenceCalendarSchema>;
export type ExperimentAdherenceGrace = z.infer<typeof experimentAdherenceGraceSchema>;
export type ExperimentAdherenceEvidenceRule = z.infer<typeof experimentAdherenceEvidenceRuleSchema>;
export type ExperimentAdherenceTarget = z.infer<typeof experimentAdherenceTargetSchema>;
export type ExperimentRunLogging = z.infer<typeof experimentRunLoggingSchema>;
export type ExperimentRunPlan = z.infer<typeof experimentRunPlanSchema>;
export type ExperimentMeasurementRole = z.infer<typeof experimentMeasurementRoleSchema>;
export type ExperimentMeasurementKind = z.infer<typeof experimentMeasurementKindSchema>;
export type ExperimentMeasurementAnchor = z.infer<typeof experimentMeasurementAnchorSchema>;
export type ExperimentPlannedMeasurement = z.infer<typeof experimentPlannedMeasurementSchema>;
export type ExperimentMetricOutcomeCapture = z.infer<typeof experimentMetricOutcomeCaptureSchema>;
export type ExperimentPrimaryOutcome = z.infer<typeof experimentPrimaryOutcomeSchema>;
export type ExperimentAnalysisPlan = z.infer<typeof experimentAnalysisPlanSchema>;
export type ExperimentOnboardingSafety = z.infer<typeof experimentOnboardingSafetySchema>;
export type ExperimentOnboardingCapture = z.infer<typeof experimentOnboardingCaptureSchema>;
export type ExperimentAssistantSupport = z.infer<typeof experimentAssistantSupportSchema>;
export type ExperimentOutcomeTracking = z.infer<typeof experimentOutcomeTrackingSchema>;
export type ExperimentOutcomeRef = z.infer<typeof experimentOutcomeRefSchema>;
export type ExperimentMetricPeriodSummary = z.infer<typeof experimentMetricPeriodSummarySchema>;
export type ExperimentMetricResult = z.infer<typeof experimentMetricResultSchema>;
export type ExperimentStructuredReviewResult = z.infer<
  typeof experimentStructuredReviewResultSchema
>;
export type ExperimentOutcomeMetricPoint = z.infer<typeof experimentOutcomeMetricPointSchema>;
export type ExperimentOutcomeMetricResult = z.infer<typeof experimentOutcomeMetricResultSchema>;
export type ExperimentProgressMetricSignal = z.infer<typeof experimentProgressMetricSignalSchema>;
export type ExperimentWindowSummary = z.infer<typeof experimentWindowSummarySchema>;
export type ExperimentProgressSnapshot = z.infer<typeof experimentProgressSnapshotSchema>;
export type ExperimentOutcome = z.infer<typeof experimentOutcomeSchema>;
export type ExperimentFrontmatter = z.infer<typeof experimentFrontmatterSchema>;
export type ProviderFrontmatter = z.infer<typeof providerFrontmatterSchema>;
export type HabitatFrontmatter = z.infer<typeof habitatFrontmatterSchema>;
export type FoodFrontmatter = z.infer<typeof foodFrontmatterSchema>;
export type RecipeFrontmatter = z.infer<typeof recipeFrontmatterSchema>;
export type WorkoutFormatFrontmatter = z.infer<typeof workoutFormatFrontmatterSchema>;
export type AssessmentResponseRecord = z.infer<typeof assessmentResponseSchema>;
export type RawImportManifestArtifact = z.infer<typeof rawImportManifestArtifactSchema>;
export type RawImportManifest = z.infer<typeof rawImportManifestSchema>;
export type GoalFrontmatter = z.infer<typeof goalFrontmatterSchema>;
export type ConditionFrontmatter = z.infer<typeof conditionFrontmatterSchema>;
export type AllergyFrontmatter = z.infer<typeof allergyFrontmatterSchema>;
export type ProtocolFrontmatter = z.infer<typeof protocolFrontmatterSchema>;
export type RegimenFrontmatter = z.infer<typeof regimenFrontmatterSchema>;
export type SupplementIngredientFrontmatter = NonNullable<RegimenFrontmatter["ingredients"]>[number];
export type FamilyMemberFrontmatter = z.infer<typeof familyMemberFrontmatterSchema>;
export type GeneticVariantFrontmatter = z.infer<typeof geneticVariantFrontmatterSchema>;
