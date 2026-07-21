import { ACTIVITY_METRICS } from "./definitions/activity.ts";
import { BODY_METRICS } from "./definitions/body.ts";
import { FUNCTION_METRICS } from "./definitions/function.ts";
import {
  EXPERIMENT_SESSION_METRICS,
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
} from "./experiment-session-metrics.ts";
import { LAB_METRICS } from "./definitions/labs.ts";
import { PROXY_METRICS } from "./definitions/proxy.ts";
import { RECOVERY_METRICS } from "./definitions/recovery.ts";
import { SLEEP_METRICS } from "./definitions/sleep.ts";
import { VITAL_METRICS } from "./definitions/vitals.ts";
import { guessValuePrecision, humanizeMetricKey } from "./format.ts";
import type { MetricDefinition } from "./types.ts";

export const DEFAULT_STALE_AFTER_DAYS = 90;
export const ISO_DAY_MS = 24 * 60 * 60 * 1000;

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  ...RECOVERY_METRICS,
  ...VITAL_METRICS,
  ...ACTIVITY_METRICS,
  ...SLEEP_METRICS,
  ...EXPERIMENT_SESSION_METRICS,
  ...BODY_METRICS,
  ...FUNCTION_METRICS,
  ...PROXY_METRICS,
  ...LAB_METRICS,
];

const DEFINITIONS_BY_KEY = new Map(METRIC_DEFINITIONS.map((definition) => [definition.key, definition]));
const DEFINITIONS_BY_ALIAS = new Map<string, MetricDefinition>();
const PRIMARY_METRIC_BY_BIOMARKER = new Map<string, MetricDefinition>();

for (const definition of METRIC_DEFINITIONS) {
  for (const alias of [definition.key, ...definition.aliases]) {
    DEFINITIONS_BY_ALIAS.set(normalizeMetricKey(alias), definition);
  }
  if (definition.biomarkerKey && !PRIMARY_METRIC_BY_BIOMARKER.has(definition.biomarkerKey)) {
    PRIMARY_METRIC_BY_BIOMARKER.set(definition.biomarkerKey, definition);
  }
  for (const biomarkerAlias of definition.biomarkerAliases ?? []) {
    if (!PRIMARY_METRIC_BY_BIOMARKER.has(biomarkerAlias)) {
      PRIMARY_METRIC_BY_BIOMARKER.set(biomarkerAlias, definition);
    }
  }
}

export function listMetricDefinitions(): MetricDefinition[] {
  return METRIC_DEFINITIONS.slice();
}

export function normalizeMetricKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[_\s/]+/gu, "-")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function resolveMetricDefinition(value: string): MetricDefinition | null {
  const key = normalizeMetricKey(value);
  return DEFINITIONS_BY_KEY.get(key) ?? DEFINITIONS_BY_ALIAS.get(key) ?? null;
}

export function resolveMetricInputKey(value: string): string {
  return resolveMetricDefinition(value)?.key ?? normalizeMetricKey(value);
}

export function resolveMetricDefinitionForBiomarker(biomarkerKey: string): MetricDefinition | null {
  return PRIMARY_METRIC_BY_BIOMARKER.get(biomarkerKey) ?? null;
}

function resolveBiomarkerMetricInput(value: string): {
  candidateBiomarkerKey: string;
  definition: MetricDefinition | null;
} {
  const normalized = value.trim().toLowerCase();
  const slug = normalized.split(":").at(-1) ?? normalized;
  const candidateBiomarkerKey = normalized.startsWith("biomarker:")
    ? normalized
    : `biomarker:${slug}`;
  return {
    candidateBiomarkerKey,
    definition:
      resolveMetricDefinitionForBiomarker(candidateBiomarkerKey) ??
      resolveMetricDefinition(slug),
  };
}

export function resolveCanonicalBiomarkerKey(value: string): string {
  const { candidateBiomarkerKey, definition } = resolveBiomarkerMetricInput(value);
  return definition?.biomarkerKey ?? candidateBiomarkerKey;
}

export type ExperimentPrimaryMetricCaptureIssue =
  | "missing_primary_biomarker"
  | "unsupported_primary_biomarker"
  | "uncapturable_primary_biomarker";

export interface ExperimentPrimaryMetricCaptureAssessment {
  canonicalBiomarkerKey: string | null;
  issue: ExperimentPrimaryMetricCaptureIssue | null;
  matchingSessionFieldIds: string[];
  metricKey: string | null;
  requiresSessionField: boolean;
}

/**
 * Resolve the primary metric and, for subjective/session-owned metrics, prove
 * that the run declares exactly one canonical capture field. Multiple aliases
 * are ambiguous just like a missing field: either shape would make active-run
 * logging and outcome analysis disagree about the source of truth.
 */
export function assessExperimentPrimaryMetricCapture(input: {
  primaryBiomarkerKey: string | null | undefined;
  sessionFields: readonly string[] | null | undefined;
}): ExperimentPrimaryMetricCaptureAssessment {
  const normalizedBiomarkerKey = input.primaryBiomarkerKey?.trim().toLowerCase() ?? "";
  if (!normalizedBiomarkerKey) {
    return {
      canonicalBiomarkerKey: null,
      issue: "missing_primary_biomarker",
      matchingSessionFieldIds: [],
      metricKey: null,
      requiresSessionField: false,
    };
  }

  const { candidateBiomarkerKey, definition } = resolveBiomarkerMetricInput(normalizedBiomarkerKey);
  if (!definition) {
    return {
      canonicalBiomarkerKey: candidateBiomarkerKey,
      issue: "unsupported_primary_biomarker",
      matchingSessionFieldIds: [],
      metricKey: null,
      requiresSessionField: false,
    };
  }

  const canonicalBiomarkerKey = definition.biomarkerKey ?? candidateBiomarkerKey;
  const sessionMetric = resolveExperimentSessionMetricSpecForBiomarker(
    canonicalBiomarkerKey,
  );
  if (!sessionMetric) {
    return {
      canonicalBiomarkerKey,
      issue: null,
      matchingSessionFieldIds: [],
      metricKey: definition.key,
      requiresSessionField: false,
    };
  }

  const matchingSessionFieldIds = (input.sessionFields ?? []).filter(
    (fieldId) => resolveExperimentSessionMetricSpec(fieldId)?.key === sessionMetric.key,
  );
  return {
    canonicalBiomarkerKey,
    issue: matchingSessionFieldIds.length === 1
      ? null
      : "uncapturable_primary_biomarker",
    matchingSessionFieldIds,
    metricKey: definition.key,
    requiresSessionField: true,
  };
}

export function createCustomMetricDefinition(metricKey: string, unit: string | null = null): MetricDefinition {
  const normalizedKey = normalizeMetricKey(metricKey);
  return {
    aliases: [],
    biomarkerKey: null,
    canonicalUnit: null,
    category: "custom",
    displayName: humanizeMetricKey(normalizedKey),
    displayUnit: unit,
    key: normalizedKey,
    selectionPolicy: { kind: "latest-valid", staleAfterDays: DEFAULT_STALE_AFTER_DAYS },
    valuePrecision: unit ? guessValuePrecision(unit) : 0,
  };
}

export function biomarkerSelectionKeys(
  biomarkerKey: string,
  definition: MetricDefinition | null,
): string[] {
  return uniqueStrings([
    biomarkerKey,
    ...(definition?.biomarkerKey ? [definition.biomarkerKey] : []),
  ]);
}

export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
