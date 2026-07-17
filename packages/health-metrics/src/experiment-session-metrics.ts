import type { MetricDefinition } from "./types.ts";

export interface ExperimentSessionMetricSpec {
  aliases: readonly string[];
  biomarkerKey: string;
  canonicalUnit: string;
  category?: MetricDefinition["category"];
  displayName: string;
  key: string;
  maximum: number;
  minimum: number;
  valuePrecision: number;
  valueType: "number";
}

export type ExperimentSessionMetricValue = string | number | boolean | null;

export const EXPERIMENT_SESSION_METRIC_SPECS = [
  {
    aliases: [
      "bedtime-delay",
      "bedtime_delay",
      "bedtime-delay-minutes",
      "bedtime_delay_minutes",
    ],
    biomarkerKey: "biomarker:bedtime-delay",
    canonicalUnit: "minutes",
    displayName: "Bedtime delay",
    key: "bedtime-delay",
    maximum: 720,
    minimum: 0,
    valuePrecision: 0,
    valueType: "number",
  },
  {
    aliases: [
      "sleep-onset-latency",
      "sleep_onset_latency",
      "sleep-onset-latency-minutes",
      "sleep_onset_latency_minutes",
      "estimated-sleep-onset-minutes",
      "estimated_sleep_onset_minutes",
      "estimated-sleep-onset-latency-minutes",
      "estimated_sleep_onset_latency_minutes",
    ],
    biomarkerKey: "biomarker:sleep-onset-latency",
    canonicalUnit: "minutes",
    displayName: "Sleep onset latency",
    key: "sleep-onset-latency",
    maximum: 720,
    minimum: 0,
    valuePrecision: 0,
    valueType: "number",
  },
  {
    aliases: [
      "daytime-sleepiness",
      "daytime_sleepiness",
      "daytime-sleepiness-0-10",
      "daytime_sleepiness_0_10",
      "daytime-sleepiness-next-day",
      "daytime_sleepiness_next_day",
    ],
    biomarkerKey: "biomarker:daytime-sleepiness",
    canonicalUnit: "score",
    displayName: "Daytime sleepiness",
    key: "daytime-sleepiness",
    maximum: 10,
    minimum: 0,
    valuePrecision: 1,
    valueType: "number",
  },
  {
    aliases: [
      "sleep-quality",
      "sleep_quality",
      "sleep-quality-0-10",
      "sleep_quality_0_10",
      "subjective-sleep-quality",
      "subjective_sleep_quality",
      "subjective-sleep-quality-next-morning",
      "subjective_sleep_quality_next_morning",
    ],
    biomarkerKey: "biomarker:sleep-quality",
    canonicalUnit: "score",
    displayName: "Subjective sleep quality",
    key: "subjective-sleep-quality",
    maximum: 10,
    minimum: 0,
    valuePrecision: 1,
    valueType: "number",
  },
  {
    aliases: [
      "pre-sleep-arousal",
      "pre_sleep_arousal",
      "pre-sleep-arousal-0-10",
      "pre_sleep_arousal_0_10",
      "pre-bed-wiredness-0-10",
      "pre_bed_wiredness_0_10",
    ],
    biomarkerKey: "biomarker:pre-sleep-arousal",
    canonicalUnit: "score",
    displayName: "Pre-sleep arousal",
    key: "pre-sleep-arousal",
    maximum: 10,
    minimum: 0,
    valuePrecision: 1,
    valueType: "number",
  },
  {
    aliases: [
      "muscle-soreness-score",
      "muscle_soreness_score",
      "soreness-score",
      "soreness_score",
    ],
    biomarkerKey: "biomarker:muscle-soreness-score",
    canonicalUnit: "score",
    category: "recovery",
    displayName: "Muscle soreness",
    key: "muscle-soreness-score",
    maximum: 10,
    minimum: 0,
    valuePrecision: 1,
    valueType: "number",
  },
  {
    aliases: [
      "wake-after-sleep-onset",
      "wake_after_sleep_onset",
      "wake-after-sleep-onset-minutes",
      "wake_after_sleep_onset_minutes",
      "waso",
      "waso-minutes",
    ],
    biomarkerKey: "biomarker:wake-after-sleep-onset",
    canonicalUnit: "minutes",
    displayName: "Wake after sleep onset",
    key: "wake-after-sleep-onset",
    maximum: 720,
    minimum: 0,
    valuePrecision: 0,
    valueType: "number",
  },
] as const satisfies readonly ExperimentSessionMetricSpec[];

export const EXPERIMENT_SESSION_METRICS: readonly MetricDefinition[] =
  EXPERIMENT_SESSION_METRIC_SPECS.map((spec) => ({
    aliases: spec.aliases,
    biomarkerKey: spec.biomarkerKey,
    canonicalUnit: spec.canonicalUnit,
    category: "category" in spec ? spec.category : "sleep",
    displayName: spec.displayName,
    displayUnit: spec.canonicalUnit,
    key: spec.key,
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 30 },
    trendPolicy: {
      aggregation: "mean",
      comparisonWindowDays: 30,
      latestWindowDays: 7,
      minimumPoints: 3,
    },
    valuePrecision: spec.valuePrecision,
  }));

const SESSION_METRIC_BY_ALIAS = new Map<string, ExperimentSessionMetricSpec>();
const SESSION_METRIC_BY_BIOMARKER = new Map<string, ExperimentSessionMetricSpec>();

for (const spec of EXPERIMENT_SESSION_METRIC_SPECS) {
  SESSION_METRIC_BY_BIOMARKER.set(spec.biomarkerKey.toLowerCase(), spec);
  for (const alias of [spec.key, ...spec.aliases]) {
    SESSION_METRIC_BY_ALIAS.set(normalizeSessionMetricIdentity(alias), spec);
  }
}

export function resolveExperimentSessionMetricSpec(
  fieldId: string,
): ExperimentSessionMetricSpec | null {
  return SESSION_METRIC_BY_ALIAS.get(normalizeSessionMetricIdentity(fieldId)) ?? null;
}

export function resolveExperimentSessionMetricSpecForBiomarker(
  biomarkerKey: string,
): ExperimentSessionMetricSpec | null {
  return SESSION_METRIC_BY_BIOMARKER.get(biomarkerKey.trim().toLowerCase()) ?? null;
}

export function experimentSessionMetricIsDeclared(input: {
  biomarkerKey: string;
  sessionFields: readonly string[] | null | undefined;
}): boolean {
  const primarySpec = resolveExperimentSessionMetricSpecForBiomarker(input.biomarkerKey);
  if (!primarySpec) {
    return false;
  }

  return (input.sessionFields ?? []).filter(
    (fieldId) => resolveExperimentSessionMetricSpec(fieldId)?.key === primarySpec.key,
  ).length === 1;
}

export function validateExperimentSessionMetricValue(input: {
  fieldId: string;
  value: ExperimentSessionMetricValue;
}): { success: true } | { success: false; message: string } {
  const spec = resolveExperimentSessionMetricSpec(input.fieldId);
  if (!spec) {
    return { success: true };
  }

  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return {
      success: false,
      message: `${input.fieldId} must be a finite number.`,
    };
  }

  if (input.value < spec.minimum || input.value > spec.maximum) {
    return {
      success: false,
      message: `${input.fieldId} must be between ${spec.minimum} and ${spec.maximum} ${spec.canonicalUnit}.`,
    };
  }

  return { success: true };
}

function normalizeSessionMetricIdentity(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[_\s/]+/gu, "-")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
