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
import type {
  MetricDefinition,
  MetricPoint,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionStatus,
  MetricSelectionWarning,
} from "./types.ts";
import { METRIC_SELECTION_SCHEMA_VERSION } from "./types.ts";

export function selectMetricValue(input: {
  metricKey?: string;
  biomarkerKey?: string;
  now?: string;
  points: readonly MetricPoint[];
  policyOverride?: MetricSelectionPolicy;
}): MetricSelection {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const metricKey = input.metricKey ? resolveMetricInputKey(input.metricKey) : definitionFromBiomarker?.key ?? null;
  const biomarkerKeys = input.biomarkerKey
    ? biomarkerSelectionKeys(input.biomarkerKey, definitionFromBiomarker)
    : null;
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

  const selected = selectPointByPolicy(points, input.policyOverride ?? definition.selectionPolicy);
  if (!selected) {
    return emptySelection(definition, requestedBiomarkerKey, "no_data");
  }

  const warnings = collectSelectionWarnings({ definition, now: input.now, points, selected });
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
      pointIds: [selected.id],
      recordIds: [selected.source.recordId],
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
    warnings: [],
  };
}

function selectPointByPolicy(points: readonly MetricPoint[], policy: MetricSelectionPolicy): MetricPoint | null {
  const numericPoints = points.filter(hasDisplayableValue);
  switch (policy.kind) {
    case "qualified-latest":
      return sortedLatest(numericPoints.filter((point) => qualifiersMatch(point, policy.requiredQualifiers))).at(0) ?? null;
    case "latest-lab": {
      const labPoints = numericPoints.filter((point) => point.source.kind === "test-result" || point.source.family === "event");
      const candidates = labPoints.length > 0 ? labPoints : numericPoints;
      return sortedLatest(candidates, { preferFasting: policy.preferFasting }).at(0) ?? null;
    }
    case "latest-device-estimate":
    case "latest-valid":
      return sortedLatest(numericPoints).at(0) ?? null;
  }
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

function collectSelectionWarnings(input: {
  definition: MetricDefinition;
  now?: string;
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

  const staleAfterDays = input.definition.selectionPolicy.staleAfterDays;
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
