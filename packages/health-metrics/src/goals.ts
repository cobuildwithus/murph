import { createCustomMetricDefinition, resolveMetricDefinition, resolveMetricInputKey } from "./catalog.ts";
import { formatNumber, formatTargetValue } from "./format.ts";
import { buildMetricSeries } from "./series.ts";
import { selectMetricValue } from "./selectors.ts";
import type {
  GoalMetricTarget,
  MetricDefinition,
  MetricGoalProgress,
  MetricPoint,
  MetricSelection,
  MetricSelectionWarning,
} from "./types.ts";

export function selectMetricGoalProgress(input: {
  goalId: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): MetricGoalProgress {
  const metricKey = resolveMetricInputKey(input.target.metricKey);
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
      selectedPointIds: [],
      status: current.status,
      targetId: input.target.targetId,
      targetValueLabel,
      unit: input.target.unit,
      warnings: current.warnings,
    };
  }

  const met = targetMet(current.value, input.target);
  return {
    currentValue: current.value,
    currentValueLabel: current.valueLabel,
    deltaToTarget: deltaForTarget(current.value, input.target),
    goalId: input.goalId,
    metricKey,
    selectedPointIds: current.selectedPointIds,
    status: current.status === "stale" ? "stale" : met ? "met" : unmetGoalStatus(input.target),
    targetId: input.target.targetId,
    targetValueLabel,
    unit: current.unit ?? input.target.unit,
    warnings: current.warnings,
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
  switch (input.target.evaluation.kind) {
    case "rolling-window":
      return selectRollingWindowGoalMetricValue(input);
    case "latest-lab":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: input.target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: input.definition.selectionPolicy.staleAfterDays },
      }));
    case "selected-value":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: input.target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: input.target.selectionPolicyOverride,
      }));
  }
}

function metricSelectionToGoalTargetValue(selection: MetricSelection): GoalMetricTargetValueSelection {
  if (!selection.point || selection.value === null) {
    return {
      selectedPointIds: [],
      status: selection.status === "unsupported" ? "unsupported" : "no_data",
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
  target: GoalMetricTarget;
}): GoalMetricTargetValueSelection {
  const evaluation = input.target.evaluation;
  if (evaluation.kind !== "rolling-window") {
    return metricSelectionToGoalTargetValue(selectMetricValue({
      biomarkerKey: input.target.biomarkerKey,
      metricKey: input.metricKey,
      now: input.now,
      points: input.points,
      policyOverride: input.target.selectionPolicyOverride,
    }));
  }

  const candidates = buildMetricSeries({
    biomarkerKey: input.target.biomarkerKey,
    metricKey: input.metricKey,
    points: input.points,
  }).filter((point) => {
    const value = point.canonicalValue ?? point.value;
    if (value === null || !Number.isFinite(value)) return false;
    if (input.target.startAt && point.effectiveDate < input.target.startAt) return false;
    if (input.target.targetAt && point.effectiveDate > input.target.targetAt) return false;
    return true;
  });

  const requestedAnchorDate = input.now ? input.now.slice(0, 10) : candidates.at(-1)?.effectiveDate ?? null;
  const anchorDate = requestedAnchorDate && input.target.targetAt && requestedAnchorDate > input.target.targetAt
    ? input.target.targetAt
    : requestedAnchorDate;
  if (!anchorDate) {
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const windowStart = subtractIsoDays(anchorDate, evaluation.windowDays - 1);
  const windowPoints = candidates.filter((point) => point.effectiveDate >= windowStart && point.effectiveDate <= anchorDate);
  if (windowPoints.length === 0) {
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const values = windowPoints.flatMap((point) => {
    const value = point.canonicalValue ?? point.value;
    return value === null || !Number.isFinite(value) ? [] : [value];
  });
  const value = evaluation.statistic === "median" ? median(values) : mean(values);
  const precision = input.definition.valuePrecision;
  return {
    selectedPointIds: windowPoints.map((point) => point.id),
    status: "behind",
    unit: windowPoints.at(-1)?.canonicalUnit ?? windowPoints.at(-1)?.unit ?? input.target.unit,
    value,
    valueLabel: formatNumber(value, precision),
    warnings: [],
  };
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

function targetMet(value: number, target: GoalMetricTarget): boolean {
  switch (target.comparator) {
    case "<": return value < target.value;
    case "<=": return value <= target.value;
    case ">": return value > target.value;
    case ">=": return value >= target.value;
    case "between": return target.highValue !== undefined && value >= target.value && value <= target.highValue;
  }
}

function deltaForTarget(value: number, target: GoalMetricTarget): number | null {
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
