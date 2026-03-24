import * as z from "zod";

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
  CONDITION_CLINICAL_STATUSES,
  CONDITION_SEVERITIES,
  CONDITION_VERIFICATION_STATUSES,
  CONTRACT_ID_FORMAT,
  CONTRACT_SCHEMA_VERSION,
  ERROR_CODE_VALUES,
  EVENT_KINDS,
  EVENT_SOURCES,
  EXPERIMENT_PHASES,
  EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS,
  FRONTMATTER_DOC_TYPES,
  GOAL_HORIZONS,
  GOAL_STATUSES,
  ID_PREFIXES,
  PROFILE_SNAPSHOT_SOURCES,
  RAW_IMPORT_KINDS,
  RECIPE_STATUSES,
  REGIMEN_KINDS,
  REGIMEN_STATUSES,
  SAMPLE_QUALITIES,
  SAMPLE_SOURCES,
  SAMPLE_STREAMS,
  SLEEP_STAGES,
  TEST_RESULT_STATUSES,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "./constants.js";
import { GENERIC_CONTRACT_ID_PATTERN, idPattern } from "./ids.js";
import { isStrictIsoDate, isStrictIsoDateTime } from "./time.js";

export type AssessmentSource = (typeof ASSESSMENT_SOURCES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type EventSource = (typeof EVENT_SOURCES)[number];
export type ExperimentPhase = (typeof EXPERIMENT_PHASES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type RawImportKind = (typeof RAW_IMPORT_KINDS)[number];
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
export type ConditionVerificationStatus = (typeof CONDITION_VERIFICATION_STATUSES)[number];
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];
export type ProfileSnapshotSource = (typeof PROFILE_SNAPSHOT_SOURCES)[number];
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export type RegimenKind = (typeof REGIMEN_KINDS)[number];
export type RegimenStatus = (typeof REGIMEN_STATUSES)[number];
export type SampleStream = (typeof SAMPLE_STREAMS)[number];
export type SampleSource = (typeof SAMPLE_SOURCES)[number];
export type SampleQuality = (typeof SAMPLE_QUALITIES)[number];
export type SleepStage = (typeof SLEEP_STAGES)[number];
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];
export type BloodTestFastingStatus = (typeof BLOOD_TEST_FASTING_STATUSES)[number];
export type BloodTestResultFlag = (typeof BLOOD_TEST_RESULT_FLAGS)[number];
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
const RAW_DOCUMENT_PATH_PATTERN = "^raw/documents/[A-Za-z0-9._/-]+$";
const RAW_MEAL_PATH_PATTERN = "^raw/meals/[A-Za-z0-9._/-]+$";
const RAW_ASSESSMENT_SOURCE_PATTERN = "^raw/assessments/[A-Za-z0-9._/-]+/source\\.json$";
const RELATIVE_PATH_PATTERN = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$";
const SHA256_HEX_PATTERN = "^[a-f0-9]{64}$";
const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const UNIT_PATTERN = "^[A-Za-z0-9._/%-]+$";
export const FAMILY_MEMBER_LIMITS = Object.freeze({
  title: 160,
  relationship: 120,
  condition: 160,
  note: 4000,
} as const);

export const GENETIC_VARIANT_LIMITS = Object.freeze({
  title: 160,
  gene: 40,
  inheritance: 120,
  note: 4000,
} as const);

function withContractMetadata<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  id: string,
  title: string,
): TSchema {
  return schema.meta({
    $id: id,
    title,
  }) as TSchema;
}

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

function isoDateString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date" })
    .refine((value) => isStrictIsoDate(value), "Invalid ISO date string.");
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
): z.ZodType<z.output<TSchema>[]> {
  let schema = z.array(itemSchema);

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

const activityStrengthExerciseBaseShape = {
  exercise: boundedString(1, 160),
  setCount: integerSchema(1),
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

const bloodTestResultComparatorSchema = z.enum(["<", "<=", ">", ">="]);

export const bloodTestReferenceRangeSchema = z
  .object({
    low: numberSchema().optional(),
    high: numberSchema().optional(),
    text: boundedString(1, 160).optional(),
  })
  .strict()
  .refine(
    (value) => value.low !== undefined || value.high !== undefined || value.text !== undefined,
    {
      message: "Blood-test reference ranges must include at least one boundary or a text range.",
    },
  );

export const bloodTestResultSchema = z
  .object({
    analyte: boundedString(1, 160),
    slug: patternedString(SLUG_PATTERN).optional(),
    value: numberSchema().optional(),
    textValue: boundedString(1, 160).optional(),
    comparator: bloodTestResultComparatorSchema.optional(),
    unit: boundedString(1, 64).optional(),
    flag: z.enum(BLOOD_TEST_RESULT_FLAGS).optional(),
    biomarkerSlug: patternedString(SLUG_PATTERN).optional(),
    referenceRange: bloodTestReferenceRangeSchema.optional(),
    note: boundedString(1, 240).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.value === undefined && value.textValue === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Blood-test results require either a numeric value or a textValue.",
        path: ["value"],
      });
    }
  });

const baseEventShape = {
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.event),
  id: idSchema(ID_PREFIXES.event),
  occurredAt: isoDateTimeString(),
  recordedAt: isoDateTimeString(),
  dayKey: patternedString(DAY_KEY_PATTERN),
  source: z.enum(EVENT_SOURCES),
  title: boundedString(1, 160),
} satisfies z.ZodRawShape;

const baseEventOptionalShape = {
  tags: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
  relatedIds: uniqueArray(patternedString(GENERIC_CONTRACT_ID_PATTERN), { uniqueItems: true }).optional(),
  rawRefs: uniqueArray(patternedString(RAW_PATH_PATTERN), { uniqueItems: true }).optional(),
  externalRef: externalRefSchema.optional(),
} satisfies z.ZodRawShape;

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
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.vault),
      vaultId: idSchema(ID_PREFIXES.vault),
      createdAt: isoDateTimeString(),
      title: boundedString(1, 120),
      timezone: boundedString(3, 64),
      idPolicy: z
        .object({
          format: z.literal(CONTRACT_ID_FORMAT),
          prefixes: z
            .object({
              allergy: z.literal(ID_PREFIXES.allergy),
              assessment: z.literal(ID_PREFIXES.assessment),
              audit: z.literal(ID_PREFIXES.audit),
              condition: z.literal(ID_PREFIXES.condition),
              document: z.literal(ID_PREFIXES.document),
              event: z.literal(ID_PREFIXES.event),
              experiment: z.literal(ID_PREFIXES.experiment),
              family: z.literal(ID_PREFIXES.family),
              goal: z.literal(ID_PREFIXES.goal),
              meal: z.literal(ID_PREFIXES.meal),
              pack: z.literal(ID_PREFIXES.pack),
              profileSnapshot: z.literal(ID_PREFIXES.profileSnapshot),
              provider: z.literal(ID_PREFIXES.provider),
              recipe: z.literal(ID_PREFIXES.recipe),
              regimen: z.literal(ID_PREFIXES.regimen),
              sample: z.literal(ID_PREFIXES.sample),
              transform: z.literal(ID_PREFIXES.transform),
              variant: z.literal(ID_PREFIXES.variant),
              vault: z.literal(ID_PREFIXES.vault),
            })
            .strict(),
        })
        .strict(),
      paths: z
        .object({
          allergiesRoot: z.literal("bank/allergies"),
          assessmentLedgerRoot: z.literal("ledger/assessments"),
          conditionsRoot: z.literal("bank/conditions"),
          coreDocument: z.literal("CORE.md"),
          familyRoot: z.literal("bank/family"),
          geneticsRoot: z.literal("bank/genetics"),
          goalsRoot: z.literal("bank/goals"),
          journalRoot: z.literal("journal"),
          experimentsRoot: z.literal("bank/experiments"),
          profileCurrentDocument: z.literal("bank/profile/current.md"),
          profileRoot: z.literal("bank/profile"),
          profileSnapshotsRoot: z.literal("ledger/profile-snapshots"),
          providersRoot: z.literal("bank/providers"),
          recipesRoot: z.literal("bank/recipes"),
          rawAssessmentsRoot: z.literal("raw/assessments"),
          rawRoot: z.literal("raw"),
          eventsRoot: z.literal("ledger/events"),
          regimensRoot: z.literal("bank/regimens"),
          samplesRoot: z.literal("ledger/samples"),
          auditRoot: z.literal("audit"),
          exportsRoot: z.literal("exports"),
        })
        .strict(),
      shards: z
        .object({
          assessments: z.literal("ledger/assessments/YYYY/YYYY-MM.jsonl"),
          events: z.literal("ledger/events/YYYY/YYYY-MM.jsonl"),
          profileSnapshots: z.literal("ledger/profile-snapshots/YYYY/YYYY-MM.jsonl"),
          samples: z.literal("ledger/samples/<stream>/YYYY/YYYY-MM.jsonl"),
          audit: z.literal("audit/YYYY/YYYY-MM.jsonl"),
        })
        .strict(),
    })
    .strict(),
  "@healthybob/contracts/vault-metadata.schema.json",
  "Healthy Bob Vault Metadata",
);

export const eventRecordSchema = withContractMetadata(
  z.discriminatedUnion("kind", [
    eventSchema("document", {
      documentId: idSchema(ID_PREFIXES.document),
      documentPath: patternedString(RAW_DOCUMENT_PATH_PATTERN),
      mimeType: boundedString(3, 120),
      providerId: idSchema(ID_PREFIXES.provider).optional(),
    }),
    eventSchema("encounter", {
      encounterType: boundedString(1, 160),
      location: boundedString(1, 160).optional(),
      providerId: idSchema(ID_PREFIXES.provider).optional(),
    }),
    eventSchema("meal", {
      mealId: idSchema(ID_PREFIXES.meal),
      photoPaths: uniqueArray(patternedString(RAW_MEAL_PATH_PATTERN), { uniqueItems: true }),
      audioPaths: z.array(patternedString(RAW_MEAL_PATH_PATTERN)),
    }),
    eventSchema("symptom", {
      symptom: boundedString(1, 120),
      intensity: integerSchema(0, 10),
      bodySite: boundedString(1, 120).optional(),
    }),
    z
      .object({
        ...baseEventShape,
        kind: z.literal("note"),
        ...baseEventOptionalShape,
        note: boundedString(1, 4000),
      })
      .strict(),
    eventSchema("observation", {
      metric: patternedString(SLUG_PATTERN),
      value: numberSchema(),
      unit: patternedString(UNIT_PATTERN),
    }),
    eventSchema("experiment_event", {
      experimentId: idSchema(ID_PREFIXES.experiment),
      experimentSlug: patternedString(SLUG_PATTERN),
      phase: z.enum(EXPERIMENT_PHASES),
    }),
    eventSchema("medication_intake", {
      medicationName: boundedString(1, 160),
      dose: numberSchema(0),
      unit: patternedString(UNIT_PATTERN),
    }),
    eventSchema("procedure", {
      procedure: boundedString(1, 160),
      status: boundedString(1, 64),
    }),
    eventSchema("supplement_intake", {
      supplementName: boundedString(1, 160),
      dose: numberSchema(0),
      unit: patternedString(UNIT_PATTERN),
    }),
    eventSchema("test", {
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
    }),
    eventSchema("activity_session", {
      activityType: patternedString(SLUG_PATTERN),
      durationMinutes: integerSchema(1),
      distanceKm: numberSchema(0).optional(),
      strengthExercises: z.array(activityStrengthExerciseSchema).min(1).max(50).optional(),
    }),
    eventSchema("sleep_session", {
      startAt: isoDateTimeString(),
      endAt: isoDateTimeString(),
      durationMinutes: integerSchema(1),
    }),
    eventSchema("adverse_effect", {
      substance: boundedString(1, 160),
      effect: boundedString(1, 160),
      severity: z.enum(ADVERSE_EFFECT_SEVERITIES),
    }),
    eventSchema("exposure", {
      exposureType: boundedString(1, 160),
      substance: boundedString(1, 160),
      duration: boundedString(1, 120).optional(),
    }),
  ]),
  "@healthybob/contracts/event-record.schema.json",
  "Healthy Bob Event Record",
);

export const sampleRecordSchema = withContractMetadata(
  z.discriminatedUnion("stream", [
    sampleSchema("heart_rate", {
      value: integerSchema(0),
      unit: z.literal("bpm"),
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
  "@healthybob/contracts/sample-record.schema.json",
  "Healthy Bob Sample Record",
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
      targetIds: uniqueArray(patternedString(GENERIC_CONTRACT_ID_PATTERN), { uniqueItems: true }).optional(),
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
  "@healthybob/contracts/audit-record.schema.json",
  "Healthy Bob Audit Record",
);

export const coreFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.coreFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.core),
      vaultId: idSchema(ID_PREFIXES.vault),
      title: boundedString(1, 160),
      timezone: boundedString(3, 64),
      updatedAt: isoDateTimeString(),
      activeExperimentSlugs: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-core.schema.json",
  "Healthy Bob CORE Frontmatter",
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
  "@healthybob/contracts/frontmatter-journal-day.schema.json",
  "Healthy Bob Journal Day Frontmatter",
);

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
    })
    .strict(),
  "@healthybob/contracts/frontmatter-experiment.schema.json",
  "Healthy Bob Experiment Frontmatter",
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
  "@healthybob/contracts/frontmatter-provider.schema.json",
  "Healthy Bob Provider Frontmatter",
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
    })
    .strict(),
  "@healthybob/contracts/frontmatter-recipe.schema.json",
  "Healthy Bob Recipe Frontmatter",
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
  "@healthybob/contracts/assessment-response.schema.json",
  "Healthy Bob Assessment Response",
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

export const rawImportManifestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.rawImportManifest),
    importId: patternedString(GENERIC_CONTRACT_ID_PATTERN),
    importKind: z.enum(RAW_IMPORT_KINDS),
    importedAt: isoDateTimeString(),
    source: boundedString(1, 160).nullable(),
    rawDirectory: patternedString(RAW_PATH_PATTERN),
    artifacts: uniqueArray(rawImportManifestArtifactSchema, { uniqueItems: true }),
    provenance: jsonObjectSchema,
  })
  .strict();

export const profileSnapshotSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.profileSnapshot),
      id: idSchema(ID_PREFIXES.profileSnapshot),
      recordedAt: isoDateTimeString(),
      source: z.enum(PROFILE_SNAPSHOT_SOURCES),
      sourceAssessmentIds: uniqueArray(idSchema(ID_PREFIXES.assessment), { uniqueItems: true }).optional(),
      sourceEventIds: uniqueArray(idSchema(ID_PREFIXES.event), { uniqueItems: true }).optional(),
      profile: jsonObjectSchema,
    })
    .strict(),
  "@healthybob/contracts/profile-snapshot.schema.json",
  "Healthy Bob Profile Snapshot",
);

export const profileCurrentFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter),
      docType: z.literal(FRONTMATTER_DOC_TYPES.profileCurrent),
      snapshotId: idSchema(ID_PREFIXES.profileSnapshot),
      updatedAt: isoDateTimeString(),
      sourceAssessmentIds: uniqueArray(idSchema(ID_PREFIXES.assessment), { uniqueItems: true }).optional(),
      sourceEventIds: uniqueArray(idSchema(ID_PREFIXES.event), { uniqueItems: true }).optional(),
      topGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-profile-current.schema.json",
  "Healthy Bob Profile Current Frontmatter",
);

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
      domains: uniqueArray(patternedString(SLUG_PATTERN), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-goal.schema.json",
  "Healthy Bob Goal Frontmatter",
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
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-condition.schema.json",
  "Healthy Bob Condition Frontmatter",
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
      note: boundedString(1, 4000).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-allergy.schema.json",
  "Healthy Bob Allergy Frontmatter",
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
        ingredients: z.array(supplementIngredientSchema).optional(),
        relatedGoalIds: uniqueArray(idSchema(ID_PREFIXES.goal), { uniqueItems: true }).optional(),
        relatedConditionIds: uniqueArray(idSchema(ID_PREFIXES.condition), { uniqueItems: true }).optional(),
      })
      .strict();
  })(),
  "@healthybob/contracts/frontmatter-regimen.schema.json",
  "Healthy Bob Regimen Frontmatter",
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
      deceased: z.boolean().optional(),
      note: boundedString(1, FAMILY_MEMBER_LIMITS.note).optional(),
      relatedVariantIds: uniqueArray(idSchema(ID_PREFIXES.variant), { uniqueItems: true }).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-family-member.schema.json",
  "Healthy Bob Family Member Frontmatter",
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
      note: boundedString(1, GENETIC_VARIANT_LIMITS.note).optional(),
    })
    .strict(),
  "@healthybob/contracts/frontmatter-genetic-variant.schema.json",
  "Healthy Bob Genetic Variant Frontmatter",
);

export type ExternalRef = z.infer<typeof externalRefSchema>;
export type ActivityStrengthExercise = z.infer<typeof activityStrengthExerciseSchema>;
export type BloodTestReferenceRange = z.infer<typeof bloodTestReferenceRangeSchema>;
export type BloodTestResultRecord = z.infer<typeof bloodTestResultSchema>;
export type VaultMetadata = z.infer<typeof vaultMetadataSchema>;
export type DocumentEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "document" }>;
export type MealEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "meal" }>;
export type SymptomEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "symptom" }>;
export type NoteEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "note" }>;
export type ObservationEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "observation" }>;
export type ExperimentEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "experiment_event" }>;
export type MedicationIntakeEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "medication_intake" }>;
export type SupplementIntakeEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "supplement_intake" }>;
export type ActivitySessionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "activity_session" }>;
export type SleepSessionEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "sleep_session" }>;
export type EncounterEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "encounter" }>;
export type ProcedureEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "procedure" }>;
export type TestEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "test" }>;
export type AdverseEffectEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "adverse_effect" }>;
export type ExposureEventRecord = Extract<z.infer<typeof eventRecordSchema>, { kind: "exposure" }>;
export type EventRecord = z.infer<typeof eventRecordSchema>;
export type HeartRateSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "heart_rate" }>;
export type HrvSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "hrv" }>;
export type StepsSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "steps" }>;
export type SleepStageSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "sleep_stage" }>;
export type RespiratoryRateSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "respiratory_rate" }>;
export type TemperatureSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "temperature" }>;
export type GlucoseSampleRecord = Extract<z.infer<typeof sampleRecordSchema>, { stream: "glucose" }>;
export type SampleRecord = z.infer<typeof sampleRecordSchema>;
export type AuditRecord = z.infer<typeof auditRecordSchema>;
export type CoreFrontmatter = z.infer<typeof coreFrontmatterSchema>;
export type JournalDayFrontmatter = z.infer<typeof journalDayFrontmatterSchema>;
export type ExperimentFrontmatter = z.infer<typeof experimentFrontmatterSchema>;
export type ProviderFrontmatter = z.infer<typeof providerFrontmatterSchema>;
export type RecipeFrontmatter = z.infer<typeof recipeFrontmatterSchema>;
export type AssessmentResponseRecord = z.infer<typeof assessmentResponseSchema>;
export type RawImportManifestArtifact = z.infer<typeof rawImportManifestArtifactSchema>;
export type RawImportManifest = z.infer<typeof rawImportManifestSchema>;
export type ProfileSnapshotRecord = z.infer<typeof profileSnapshotSchema>;
export type ProfileCurrentFrontmatter = z.infer<typeof profileCurrentFrontmatterSchema>;
export type GoalFrontmatter = z.infer<typeof goalFrontmatterSchema>;
export type ConditionFrontmatter = z.infer<typeof conditionFrontmatterSchema>;
export type AllergyFrontmatter = z.infer<typeof allergyFrontmatterSchema>;
export type RegimenFrontmatter = z.infer<typeof regimenFrontmatterSchema>;
export type SupplementIngredientFrontmatter = NonNullable<RegimenFrontmatter["ingredients"]>[number];
export type FamilyMemberFrontmatter = z.infer<typeof familyMemberFrontmatterSchema>;
export type GeneticVariantFrontmatter = z.infer<typeof geneticVariantFrontmatterSchema>;
