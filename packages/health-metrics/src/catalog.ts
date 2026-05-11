import { ACTIVITY_METRICS } from "./definitions/activity.ts";
import { BODY_METRICS } from "./definitions/body.ts";
import { FUNCTION_METRICS } from "./definitions/function.ts";
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
