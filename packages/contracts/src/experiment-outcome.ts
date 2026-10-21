import * as z from "./zod-runtime.ts";
import { EXPERIMENT_STATUSES, ID_PREFIXES } from "./constants.ts";
import {
  healthCommonsActivitySessionEvidenceSchema,
  healthCommonsKeySchema,
  healthCommonsStableIdSchema,
} from "./health-commons.ts";
import {
  boundedString,
  patternedString,
  isoDateTimeString,
  isoDateString,
  integerSchema,
  numberSchema,
  uniqueArray,
  idSchema,
} from "./schema-primitives.ts";

const SHA256_DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";

export const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export const UNIT_PATTERN = "^[A-Za-z0-9._/%^-]+$";

export const EXPERIMENT_SIGNAL_DIRECTIONS = ["increase", "decrease", "stabilize"] as const;

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

export const EXPERIMENT_ADHERENCE_STATUSES = [
  "not_started",
  "behind",
  "on_track",
  "met_minimum",
  "met_target",
  "unknown",
] as const;

export const EXPERIMENT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

const EXPERIMENT_DATA_COMPLETENESS_LEVELS = [
  "insufficient",
  "partial",
  "good",
] as const;

export const LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION = "murph.experiment-outcome.v1" as const;

export const EXPERIMENT_OUTCOME_SCHEMA_VERSION = "murph.experiment-outcome.v2" as const;

const EXPERIMENT_OUTCOME_SCHEMA_VERSIONS = [
  LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
] as const;

export const commonsProtocolRefSchema = z
  .object({
    key: healthCommonsKeySchema,
    pageRevisionId: z.string().startsWith("sha256:"),
    runSpecRevisionId: z.string().startsWith("sha256:"),
    testPlanId: healthCommonsStableIdSchema.optional(),
  })
  .strict();

export const sha256DigestSchema = patternedString(SHA256_DIGEST_PATTERN);

export const protocolRefSchema = z
  .object({
    protocolId: idSchema(ID_PREFIXES.protocol),
    protocolRevisionId: sha256DigestSchema,
    effectiveSpecHash: sha256DigestSchema,
  })
  .strict();

export const protocolFrequencySchema = z
  .object({
    sessionsPerDay: numberSchema(0).optional(),
    sessionsPerWeek: numberSchema(0).optional(),
  })
  .strict();

export const protocolNonnegativeRangeSchema = z
  .object({
    min: numberSchema(0).optional(),
    max: numberSchema(0).optional(),
    target: numberSchema(0).optional(),
  })
  .strict();

export const protocolTemperatureRangeSchema = z
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

export const experimentWindowSummarySchema = z
  .object({
    baselineEnd: isoDateString().nullable(),
    baselineStart: isoDateString().nullable(),
    interventionEnd: isoDateString().nullable(),
    interventionStart: isoDateString().nullable(),
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

export type ExperimentOutcome = z.infer<typeof experimentOutcomeSchema>;
