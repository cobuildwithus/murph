import {
  ISO_DAY_MS,
  biomarkerSelectionKeys,
  createCustomMetricDefinition,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  resolveMetricInputKey,
  uniqueStrings,
} from "./catalog.ts";
import { formatMetricDisplayValue } from "./format.ts";
import { unitsEquivalent } from "./normalize.ts";
import { metricPointRecordIds } from "./record-ids.ts";
import type {
  MetricConfidence,
  MetricDefinition,
  MetricPoint,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionStatus,
  MetricSelectionWarning,
} from "./types.ts";
import { METRIC_POINT_SCHEMA_VERSION, METRIC_SELECTION_SCHEMA_VERSION } from "./types.ts";

export function selectMetricValue(input: {
  metricKey?: string;
  biomarkerKey?: string;
  now?: string;
  points: readonly MetricPoint[];
  policyOverride?: MetricSelectionPolicy;
}): MetricSelection {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const requestedMetricKey = input.metricKey !== undefined && input.metricKey !== null;
  const metricKey = requestedMetricKey ? resolveMetricInputKey(input.metricKey ?? "") : definitionFromBiomarker?.key ?? null;
  const biomarkerKeys = input.biomarkerKey
    ? biomarkerSelectionKeys(input.biomarkerKey, definitionFromBiomarker)
    : null;
  if (requestedMetricKey && !metricKey) {
    return emptySelection(createCustomMetricDefinition("unknown"), input.biomarkerKey ?? null, "no_data");
  }

  const points = input.points.filter((point) => {
    if (metricKey && point.metricKey !== metricKey) return false;
    if (biomarkerKeys && (!point.biomarkerKey || !biomarkerKeys.includes(point.biomarkerKey))) return false;
    return true;
  });
  const resolvedMetricKey = metricKey ?? points[0]?.metricKey ?? "unknown";
  const definition = resolveMetricDefinition(resolvedMetricKey) ?? createCustomMetricDefinition(resolvedMetricKey);
  const requestedBiomarkerKey = input.biomarkerKey ?? definition.biomarkerKey ?? null;

  if (points.length === 0) {
    return emptySelection(definition, requestedBiomarkerKey, "no_data");
  }

  const policy = input.policyOverride ?? definition.selectionPolicy;
  const policySelection = selectPointByPolicy(points, policy, definition);
  const selected = policySelection.point;
  if (!selected) {
    return emptySelection(
      definition,
      requestedBiomarkerKey,
      policySelection.status ?? "no_data",
      policySelection.warnings,
    );
  }

  const warnings = [
    ...(policySelection.warnings ?? []),
    ...collectSelectionWarnings({ definition, now: input.now, points, policy, selected }),
  ];
  const value = selected.canonicalValue ?? selected.value;
  const unit = selected.canonicalUnit ?? selected.unit ?? definition.displayUnit;

  return {
    biomarkerKey: selected.biomarkerKey ?? requestedBiomarkerKey,
    confidence: selected.confidence,
    effectiveDate: selected.effectiveDate,
    metricKey: selected.metricKey,
    observedAt: selected.observedAt,
    point: selected,
    provenance: {
      pointIds: policySelection.provenancePointIds ?? [selected.id],
      recordIds: policySelection.provenanceRecordIds ?? metricPointRecordIds(selected),
      sourceKinds: uniqueStrings(points.map((point) => point.source.kind)),
    },
    schemaVersion: METRIC_SELECTION_SCHEMA_VERSION,
    sourceLabel: selected.provenance.sourceLabel,
    status: warnings.some((warning) => warning.code === "SOURCE_STALE") ? "stale" : "ready",
    unit,
    value,
    valueLabel: formatMetricDisplayValue(selected, definition),
    warnings,
  };
}

export function emptySelection(
  definition: MetricDefinition,
  biomarkerKey: string | null,
  status: MetricSelectionStatus,
  warnings: MetricSelectionWarning[] = [],
): MetricSelection {
  return {
    biomarkerKey,
    confidence: "none",
    effectiveDate: null,
    metricKey: definition.key,
    observedAt: null,
    point: null,
    provenance: { pointIds: [], recordIds: [], sourceKinds: [] },
    schemaVersion: METRIC_SELECTION_SCHEMA_VERSION,
    sourceLabel: null,
    status,
    unit: definition.displayUnit,
    value: null,
    valueLabel: null,
    warnings,
  };
}

interface MetricPolicySelectionResult {
  point: MetricPoint | null;
  provenancePointIds?: string[];
  provenanceRecordIds?: string[];
  status?: MetricSelectionStatus;
  warnings?: MetricSelectionWarning[];
}

type DailyAggregateSelectionPolicy = Extract<MetricSelectionPolicy, { kind: "daily-aggregate" }>;

function selectPointByPolicy(
  points: readonly MetricPoint[],
  policy: MetricSelectionPolicy,
  definition: MetricDefinition,
): MetricPolicySelectionResult {
  const numericPoints = points.filter(hasDisplayableValue);
  switch (policy.kind) {
    case "qualified-latest":
      return { point: sortedLatest(numericPoints.filter((point) => qualifiersMatch(point, policy.requiredQualifiers))).at(0) ?? null };
    case "daily-aggregate":
      return selectDailyAggregatePoint(numericPoints, policy, definition);
    case "latest-lab": {
      const labPoints = numericPoints.filter((point) => point.source.kind === "test-result");
      return { point: sortedLatest(labPoints, { preferFasting: policy.preferFasting }).at(0) ?? null };
    }
    case "latest-device-estimate":
    case "latest-valid":
      return { point: sortedLatest(numericPoints).at(0) ?? null };
  }
}

function selectDailyAggregatePoint(
  points: readonly MetricPoint[],
  policy: DailyAggregateSelectionPolicy,
  definition: MetricDefinition,
): MetricPolicySelectionResult {
  const latest = sortedLatest(points).at(0) ?? null;
  if (!latest) {
    return { point: null };
  }

  const latestWindowDays = Math.max(1, policy.latestWindowDays ?? 1);
  const anchorDate = latest.effectiveDate;
  const windowStart = subtractIsoDays(anchorDate, latestWindowDays - 1);
  const candidates = points.filter((point) => point.effectiveDate >= windowStart && point.effectiveDate <= anchorDate);
  const minimumPoints = policy.minimumPoints ?? 0;

  const useCanonicalValues = policy.statistic !== "count" && definition.canonicalUnit !== null;
  const values = candidates
    .map((point) => useCanonicalValues ? point.canonicalValue : pointNumericValue(point))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const warnings: MetricSelectionWarning[] = [];

  if (useCanonicalValues && candidates.some((point) => point.value !== null && point.canonicalValue === null)) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `${definition.displayName} daily aggregate excluded values that could not be normalized to ${definition.canonicalUnit}.`,
    });
  }
  if (candidates.some((point) => point.comparator)) {
    warnings.push({
      code: "COMPARATOR_VALUE",
      message: `${definition.displayName} daily aggregate included at least one comparator value.`,
    });
  }

  const availablePointCount = policy.statistic === "count" ? candidates.length : values.length;
  if (minimumPoints > 0 && availablePointCount < minimumPoints) {
    return {
      point: null,
      status: "insufficient_data",
      warnings: [{
        code: "LOW_SAMPLE_COUNT",
        message: `Only ${availablePointCount} point${availablePointCount === 1 ? "" : "s"} were available for ${definition.displayName}; ${minimumPoints} required.`,
      }, ...warnings],
    };
  }

  if (values.length === 0 && policy.statistic !== "count") {
    return { point: null, warnings };
  }

  const value = policy.statistic === "count"
    ? candidates.length
    : aggregateMetricValues(values, policy.statistic);
  const sourceLabel = uniqueStrings(candidates.map((point) => point.provenance.sourceLabel)).join(", ") || latest.provenance.sourceLabel;
  const recordIds = uniqueStrings(candidates.flatMap(metricPointRecordIds));
  const unit = policy.statistic === "count"
    ? "count"
    : useCanonicalValues
      ? definition.canonicalUnit
      : latest.canonicalUnit ?? latest.unit ?? definition.displayUnit;
  const aggregateIsCanonical = policy.statistic === "count" || useCanonicalValues || latest.canonicalUnit !== null || !definition.canonicalUnit;

  return {
    point: {
      biomarkerKey: latest.biomarkerKey ?? definition.biomarkerKey,
      canonicalUnit: aggregateIsCanonical ? unit : null,
      canonicalValue: aggregateIsCanonical ? value : null,
      comparator: null,
      confidence: lowestMetricConfidence(candidates.map((point) => point.confidence)),
      context: {
        ...latest.context,
        aggregatePointCount: candidates.length,
        aggregation: policy.statistic,
        latestWindowDays,
        windowEnd: anchorDate,
        windowStart,
      },
      effectiveDate: anchorDate,
      grain: latestWindowDays === 1 ? "day" : "window",
      id: `metric-point:selection:${definition.key}:${windowStart}:${anchorDate}:${policy.statistic}`,
      metricKey: definition.key,
      observedAt: latest.observedAt,
      provenance: {
        dataOrigin: null,
        externalRef: null,
        labName: uniqueStrings(candidates.map((point) => point.provenance.labName)).at(0) ?? null,
        provider: uniqueStrings(candidates.map((point) => point.provenance.provider)).at(0) ?? null,
        rawRefs: uniqueStrings(candidates.flatMap((point) => point.provenance.rawRefs)),
        sourceLabel,
      },
      recordedAt: null,
      reportedAt: null,
      schemaVersion: METRIC_POINT_SCHEMA_VERSION,
      source: {
        family: "derived",
        kind: "metric-selection-summary",
        path: "",
        recordId: `metric-selection-summary:${definition.key}:${windowStart}:${anchorDate}:${policy.statistic}`,
        resultIndex: null,
      },
      statistic: policy.statistic,
      textValue: null,
      unit,
      value,
    },
    provenancePointIds: uniqueStrings(candidates.map((point) => point.id)),
    provenanceRecordIds: recordIds,
    warnings,
  };
}

function sortedLatest(
  points: readonly MetricPoint[],
  options: { preferFasting?: boolean } = {},
): MetricPoint[] {
  return points.slice().sort((left, right) => compareMetricPointsForSelection(left, right, options));
}

function compareMetricPointsForSelection(
  left: MetricPoint,
  right: MetricPoint,
  options: { preferFasting?: boolean } = {},
): number {
  if (options.preferFasting) {
    const fastingDelta = fastingRank(right) - fastingRank(left);
    if (fastingDelta !== 0) return fastingDelta;
  }

  if (left.effectiveDate !== right.effectiveDate) return right.effectiveDate.localeCompare(left.effectiveDate);

  const priorityDelta = sourcePriority(left) - sourcePriority(right);
  if (priorityDelta !== 0) return priorityDelta;

  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  return left.id.localeCompare(right.id);
}

function sourcePriority(point: MetricPoint): number {
  switch (point.source.kind) {
    case "test-result": return 0;
    case "measurement": return 1;
    case "wearable-summary": return 3;
    case "activity-summary": return 4;
    case "sleep-summary": return 5;
    case "sample-summary": return 6;
    default: return 7;
  }
}

function fastingRank(point: MetricPoint): number {
  return point.context.fastingStatus === "fasting" ? 1 : 0;
}

function hasDisplayableValue(point: MetricPoint): boolean {
  const value = point.canonicalValue ?? point.value;
  return typeof value === "number" && Number.isFinite(value);
}

function qualifiersMatch(point: MetricPoint, required: Record<string, string | number | boolean>): boolean {
  const qualifiers = point.context.qualifiers ?? {};
  return Object.entries(required).every(([key, value]) => qualifiers[key] === value);
}

function pointNumericValue(point: MetricPoint): number | null {
  return point.canonicalValue ?? point.value;
}

function aggregateMetricValues(values: readonly number[], statistic: DailyAggregateSelectionPolicy["statistic"]): number {
  switch (statistic) {
    case "count":
      return values.length;
    case "max":
      return Math.max(...values);
    case "mean":
      return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
    case "median":
      return median(values);
    case "min":
      return Math.min(...values);
    case "sum":
      return Number(values.reduce((sum, value) => sum + value, 0).toFixed(4));
  }
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2).toFixed(4))
    : sorted[midpoint] ?? 0;
}

function lowestMetricConfidence(values: readonly MetricConfidence[]): MetricConfidence {
  const rank: Record<MetricConfidence, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  return values.reduce<MetricConfidence>((worst, value) => rank[value] < rank[worst] ? value : worst, "high");
}

function subtractIsoDays(value: string, days: number): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value.slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function collectSelectionWarnings(input: {
  definition: MetricDefinition;
  now?: string;
  policy: MetricSelectionPolicy;
  points: readonly MetricPoint[];
  selected: MetricPoint;
}): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  if (input.selected.comparator) {
    warnings.push({ code: "COMPARATOR_VALUE", message: "Selected value includes a lab comparator." });
  }
  if (input.definition.canonicalUnit && !input.selected.canonicalUnit) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `${input.definition.displayName} could not be normalized to ${input.definition.canonicalUnit}.`,
    });
  } else if (
    input.definition.canonicalUnit
    && input.selected.canonicalUnit
    && !unitsEquivalent(input.selected.canonicalUnit, input.definition.canonicalUnit)
  ) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `${input.definition.displayName} is normalized as ${input.selected.canonicalUnit}; expected ${input.definition.canonicalUnit}.`,
    });
  }

  const staleAfterDays = input.policy.staleAfterDays;
  if (input.now && staleAfterDays !== undefined) {
    const ageDays = daysBetween(input.selected.effectiveDate, input.now.slice(0, 10));
    if (ageDays !== null && ageDays > staleAfterDays) {
      warnings.push({ code: "SOURCE_STALE", message: `${input.definition.displayName} is ${ageDays} days old.` });
    }
  }

  const sourceKinds = uniqueStrings(input.points.map((point) => point.source.kind));
  if (sourceKinds.length > 1) {
    warnings.push({ code: "MIXED_SOURCES", message: "Metric points come from multiple source kinds." });
  }

  const methods = uniqueStrings(input.points.map((point) => typeof point.context.measurementMethodKey === "string" ? point.context.measurementMethodKey : null));
  if (methods.length > 1) {
    warnings.push({ code: "METHOD_CHANGED", message: "Measurement method changed across the selected metric history." });
  }

  return warnings;
}

function daysBetween(leftDate: string, rightDate: string): number | null {
  const left = Date.parse(`${leftDate.slice(0, 10)}T00:00:00.000Z`);
  const right = Date.parse(`${rightDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.floor((right - left) / ISO_DAY_MS);
}
