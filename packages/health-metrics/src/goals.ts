import { createCustomMetricDefinition, resolveMetricDefinition, resolveMetricInputKey } from "./catalog.ts";
import { formatNumber, formatTargetValue } from "./format.ts";
import { normalizeMetricValue, resolveComparableMetricPointValue } from "./normalize.ts";
import { listMetricPoints } from "./series.ts";
import { selectMetricValue } from "./selectors.ts";
import type {
  GoalMetricTarget,
  MetricDefinition,
  MetricGoalProgress,
  MetricPoint,
  MetricSelection,
  MetricSelectionWarning,
} from "./types.ts";

type RollingWindowGoalMetricTarget = GoalMetricTarget & {
  evaluation: Extract<GoalMetricTarget["evaluation"], { kind: "rolling-window" }>;
};

export function selectMetricGoalProgress(input: {
  goalId: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): MetricGoalProgress {
  const metricKey = resolveMetricInputKey(input.target.metricKey);
  if (!metricKey) {
    const definition = createCustomMetricDefinition("unknown", input.target.unit);
    return {
      currentValue: null,
      currentValueLabel: null,
      deltaToTarget: null,
      goalId: input.goalId,
      metricKey: definition.key,
      selectedPointIds: [],
      status: "no_data",
      targetId: input.target.targetId,
      targetValueLabel: formatTargetValue(input.target, definition),
      unit: input.target.unit,
      warnings: [],
    };
  }

  const definition = resolveMetricDefinition(metricKey) ?? createCustomMetricDefinition(metricKey, input.target.unit);
  const targetValueLabel = formatTargetValue(input.target, definition);
  const current = selectGoalMetricTargetValue({
    definition,
    metricKey,
    now: input.now,
    points: input.points,
    target: input.target,
  });

  if (current.value === null) {
    return {
      currentValue: null,
      currentValueLabel: null,
      deltaToTarget: null,
      goalId: input.goalId,
      metricKey,
      selectedPointIds: current.selectedPointIds,
      status: current.status,
      targetId: input.target.targetId,
      targetValueLabel,
      unit: input.target.unit,
      warnings: current.warnings,
    };
  }

  const comparableCurrent = normalizeGoalMetricCurrentForComparison({
    current,
    definition,
    metricKey,
  });
  const comparableTarget = normalizeGoalMetricTargetForComparison({
    definition,
    metricKey,
    target: input.target,
  });
  const warnings = [...current.warnings, ...comparableCurrent.warnings, ...comparableTarget.warnings];

  if (!comparableCurrent.supported || !comparableTarget.supported) {
    return {
      currentValue: comparableCurrent.value,
      currentValueLabel: comparableCurrent.value === current.value ? current.valueLabel : formatNumber(comparableCurrent.value, definition.valuePrecision),
      deltaToTarget: null,
      goalId: input.goalId,
      metricKey,
      selectedPointIds: current.selectedPointIds,
      status: "unsupported",
      targetId: input.target.targetId,
      targetValueLabel,
      unit: current.unit ?? comparableTarget.target.unit,
      warnings,
    };
  }

  const met = targetMet(comparableCurrent.value, comparableTarget.target);
  return {
    currentValue: comparableCurrent.value,
    currentValueLabel: comparableCurrent.value === current.value ? current.valueLabel : formatNumber(comparableCurrent.value, definition.valuePrecision),
    deltaToTarget: deltaForTarget(comparableCurrent.value, comparableTarget.target),
    goalId: input.goalId,
    metricKey,
    selectedPointIds: current.selectedPointIds,
    status: current.status === "stale" ? "stale" : met ? "met" : unmetGoalStatus(input.target),
    targetId: input.target.targetId,
    targetValueLabel,
    unit: current.unit ?? comparableTarget.target.unit,
    warnings,
  };
}

interface GoalMetricTargetValueSelection {
  selectedPointIds: string[];
  status: MetricGoalProgress["status"];
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: MetricSelectionWarning[];
}

function selectGoalMetricTargetValue(input: {
  definition: MetricDefinition;
  metricKey: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): GoalMetricTargetValueSelection {
  const target = input.target;
  switch (target.evaluation.kind) {
    case "rolling-window": {
      const rollingTarget: RollingWindowGoalMetricTarget = { ...target, evaluation: target.evaluation };
      return selectRollingWindowGoalMetricValue({
        definition: input.definition,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        target: rollingTarget,
      });
    }
    case "latest-lab":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: target.selectionPolicyOverride ?? { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: input.definition.selectionPolicy.staleAfterDays },
      }));
    case "selected-value":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: target.selectionPolicyOverride,
      }));
  }
}

function metricSelectionToGoalTargetValue(selection: MetricSelection): GoalMetricTargetValueSelection {
  if (!selection.point || selection.value === null) {
    const unitUnsupported = selection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED");
    return {
      selectedPointIds: [],
      status: selection.status === "unsupported" || unitUnsupported ? "unsupported" : "no_data",
      unit: selection.unit,
      value: null,
      valueLabel: null,
      warnings: selection.warnings,
    };
  }

  return {
    selectedPointIds: selection.provenance.pointIds,
    status: selection.status === "stale" ? "stale" : "not_met",
    unit: selection.unit,
    value: selection.value,
    valueLabel: selection.valueLabel,
    warnings: selection.warnings,
  };
}

function unmetGoalStatus(target: GoalMetricTarget): MetricGoalProgress["status"] {
  return target.evaluation.kind === "rolling-window" && target.startAt && target.targetAt
    ? "behind"
    : "not_met";
}

function selectRollingWindowGoalMetricValue(input: {
  definition: MetricDefinition;
  metricKey: string;
  now?: string;
  points: readonly MetricPoint[];
  target: RollingWindowGoalMetricTarget;
}): GoalMetricTargetValueSelection {
  const evaluation = input.target.evaluation;
  const requiresCanonicalUnit = input.definition.canonicalUnit !== null;

  const listedPoints = listMetricPoints({
    biomarkerKey: input.target.biomarkerKey,
    metricKey: input.metricKey,
    points: input.points,
  });
  const candidates = listedPoints.filter((point) => {
    if (!resolveComparableMetricPointValue(point, input.definition)) return false;
    if (input.target.startAt && point.effectiveDate < input.target.startAt) return false;
    if (input.target.targetAt && point.effectiveDate > input.target.targetAt) return false;
    return true;
  });

  const rawCandidates = listedPoints.filter((point) => {
    if (point.value === null || !Number.isFinite(point.value)) return false;
    if (input.target.startAt && point.effectiveDate < input.target.startAt) return false;
    if (input.target.targetAt && point.effectiveDate > input.target.targetAt) return false;
    return true;
  });
  const requestedAnchorDate = input.now ? input.now.slice(0, 10) : rawCandidates.at(-1)?.effectiveDate ?? candidates.at(-1)?.effectiveDate ?? null;
  const anchorDate = requestedAnchorDate && input.target.targetAt && requestedAnchorDate > input.target.targetAt
    ? input.target.targetAt
    : requestedAnchorDate;
  if (!anchorDate) {
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const windowStart = subtractIsoDays(anchorDate, evaluation.windowDays - 1);
  const windowPoints = candidates.filter((point) => point.effectiveDate >= windowStart && point.effectiveDate <= anchorDate);
  const rawWindowPoints = rawCandidates.filter((point) =>
    point.effectiveDate >= windowStart &&
    point.effectiveDate <= anchorDate
  );
  const unnormalizedWindowPoints = requiresCanonicalUnit
    ? rawWindowPoints.filter((point) => resolveComparableMetricPointValue(point, input.definition) === null)
    : [];
  if (windowPoints.length === 0) {
    if (unnormalizedWindowPoints.length > 0) {
      return {
        selectedPointIds: unnormalizedWindowPoints.map((point) => point.id),
        status: "unsupported",
        unit: input.definition.canonicalUnit ?? input.target.unit,
        value: null,
        valueLabel: null,
        warnings: [{
          code: "UNIT_NOT_NORMALIZED",
          message: `${input.definition.displayName} rolling window includes values that could not be normalized to ${input.definition.canonicalUnit}.`,
        }],
      };
    }
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const values = windowPoints.flatMap((point) => {
    const comparable = resolveComparableMetricPointValue(point, input.definition);
    return comparable ? [comparable.value] : [];
  });
  const value = evaluation.statistic === "median" ? median(values) : mean(values);
  const precision = input.definition.valuePrecision;
  const latestPointDate = windowPoints
    .map((point) => point.effectiveDate)
    .sort()
    .at(-1) ?? anchorDate;
  const warnings = collectRollingWindowWarnings({
    definition: input.definition,
    latestPointDate,
    now: input.now,
    target: input.target,
    windowDays: evaluation.windowDays,
    windowPoints,
  });
  if (unnormalizedWindowPoints.length > 0) {
    warnings.push({
      code: "UNIT_NOT_NORMALIZED",
      message: `${input.definition.displayName} rolling window includes values that could not be normalized to ${input.definition.canonicalUnit}.`,
    });
    return {
      selectedPointIds: [...windowPoints, ...unnormalizedWindowPoints].map((point) => point.id),
      status: "unsupported",
      unit: input.definition.canonicalUnit ?? input.target.unit,
      value: null,
      valueLabel: null,
      warnings,
    };
  }
  return {
    selectedPointIds: windowPoints.map((point) => point.id),
    status: warnings.some((warning) => warning.code === "SOURCE_STALE") ? "stale" : "behind",
    unit: requiresCanonicalUnit ? input.definition.canonicalUnit : windowPoints.at(-1)?.canonicalUnit ?? windowPoints.at(-1)?.unit ?? input.target.unit,
    value,
    valueLabel: formatNumber(value, precision),
    warnings,
  };
}

function collectRollingWindowWarnings(input: {
  definition: MetricDefinition;
  latestPointDate: string;
  now?: string;
  target: GoalMetricTarget;
  windowDays: number;
  windowPoints: readonly MetricPoint[];
}): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  if (input.windowPoints.length < input.windowDays) {
    warnings.push({
      code: "LOW_SAMPLE_COUNT",
      message: `Only ${input.windowPoints.length} point${input.windowPoints.length === 1 ? "" : "s"} were available for ${input.definition.displayName}.`,
    });
  }

  const staleAfterDays = input.target.selectionPolicyOverride?.staleAfterDays ?? input.definition.selectionPolicy.staleAfterDays;
  if (input.now && staleAfterDays !== undefined) {
    const ageDays = daysBetween(input.latestPointDate, input.now.slice(0, 10));
    if (ageDays !== null && ageDays > staleAfterDays) {
      warnings.push({ code: "SOURCE_STALE", message: `${input.definition.displayName} rolling window is ${ageDays} days old.` });
    }
  }

  return warnings;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0;
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

interface ComparableGoalMetricTarget {
  comparator: GoalMetricTarget["comparator"];
  highValue?: number;
  unit: string;
  value: number;
}

interface NormalizedGoalMetricTargetForComparison {
  supported: boolean;
  target: ComparableGoalMetricTarget;
  warnings: MetricSelectionWarning[];
}

interface NormalizedGoalMetricCurrentForComparison {
  supported: boolean;
  unit: string | null;
  value: number;
  warnings: MetricSelectionWarning[];
}

function normalizeGoalMetricCurrentForComparison(input: {
  current: GoalMetricTargetValueSelection;
  definition: MetricDefinition;
  metricKey: string;
}): NormalizedGoalMetricCurrentForComparison {
  const normalizedValue = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.current.unit,
    value: input.current.value,
  });
  const requiresCanonicalUnit = input.definition.canonicalUnit !== null;
  return {
    supported: !requiresCanonicalUnit || normalizedValue.canonicalValue !== null,
    unit: normalizedValue.canonicalUnit ?? normalizedValue.unit ?? input.current.unit,
    value: normalizedValue.canonicalValue ?? input.current.value ?? 0,
    warnings: normalizedValue.warnings,
  };
}

function normalizeGoalMetricTargetForComparison(input: {
  definition: MetricDefinition;
  metricKey: string;
  target: GoalMetricTarget;
}): NormalizedGoalMetricTargetForComparison {
  const warnings: MetricSelectionWarning[] = [];
  const normalizedValue = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.target.unit,
    value: input.target.value,
  });
  warnings.push(...normalizedValue.warnings);

  const requiresCanonicalUnit = input.definition.canonicalUnit !== null;
  let supported = !requiresCanonicalUnit || normalizedValue.canonicalValue !== null;
  const comparableTarget: ComparableGoalMetricTarget = {
    comparator: input.target.comparator,
    unit: normalizedValue.canonicalUnit ?? normalizedValue.unit ?? input.target.unit,
    value: normalizedValue.canonicalValue ?? input.target.value,
  };

  if (input.target.comparator === "between") {
    if (input.target.highValue === undefined) {
      supported = false;
      warnings.push({
        code: "UNIT_NOT_NORMALIZED",
        message: `${input.definition.displayName} target range is missing highValue.`,
      });
    } else {
      const normalizedHighValue = normalizeMetricValue({
        metricKey: input.metricKey,
        unit: input.target.unit,
        value: input.target.highValue,
      });
      warnings.push(...normalizedHighValue.warnings);
      if (requiresCanonicalUnit && normalizedHighValue.canonicalValue === null) {
        supported = false;
      }
      comparableTarget.highValue = normalizedHighValue.canonicalValue ?? input.target.highValue;
    }
  }

  return {
    supported,
    target: comparableTarget,
    warnings,
  };
}

function targetMet(value: number, target: ComparableGoalMetricTarget): boolean {
  switch (target.comparator) {
    case "<": return value < target.value;
    case "<=": return value <= target.value;
    case ">": return value > target.value;
    case ">=": return value >= target.value;
    case "between": return target.highValue !== undefined && value >= target.value && value <= target.highValue;
  }
}

function deltaForTarget(value: number, target: ComparableGoalMetricTarget): number | null {
  switch (target.comparator) {
    case "<":
    case "<=":
      return value - target.value;
    case ">":
    case ">=":
      return target.value - value;
    case "between":
      if (target.highValue === undefined) return null;
      if (value < target.value) return target.value - value;
      if (value > target.highValue) return value - target.highValue;
      return 0;
  }
}

function subtractIsoDays(value: string, days: number): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(leftDate: string, rightDate: string): number | null {
  const left = Date.parse(`${leftDate.slice(0, 10)}T00:00:00.000Z`);
  const right = Date.parse(`${rightDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.floor((right - left) / (24 * 60 * 60 * 1000));
}
