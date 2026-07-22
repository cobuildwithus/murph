import {
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  experimentOutcomeSchema,
  type ExperimentOutcome,
  type ExperimentOutcomeMetricPoint,
} from "@murphai/contracts";

import {
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricSeries,
  type MetricPoint,
  type MetricSeriesPoint,
} from "../metrics/index.ts";

/**
 * Reconstructs daily snapshots for v1 outcomes when the available evidence can
 * reproduce every saved summary exactly. Delete with v1 outcome support.
 */
export function upgradeLegacyExperimentOutcomeForBrowser(
  outcome: ExperimentOutcome,
  input: {
    browserSeriesPoints: readonly MetricSeriesPoint[];
    metricPoints: readonly MetricPoint[];
  },
): ExperimentOutcome {
  if (outcome.schemaVersion !== LEGACY_EXPERIMENT_OUTCOME_SCHEMA_VERSION) {
    return outcome;
  }

  const metricResults = outcome.metricResults.map((metric) => {
    if (metricSnapshotMatchesSavedResult(metric, [])) {
      return { ...metric, points: [] };
    }
    const metricKey = resolveMetricDefinitionForBiomarker(metric.biomarkerKey)?.key ??
      resolveMetricDefinition(metric.biomarkerKey.split(":").at(-1) ?? metric.biomarkerKey)?.key;
    if (!metricKey) {
      return null;
    }

    const pointsForMetric = input.metricPoints.filter((point) => point.metricKey === metricKey);
    const points = [
      snapshotSeriesPoints(
        input.browserSeriesPoints.filter((point) => point.metricKey === metricKey),
        outcome,
        metric,
      ),
      snapshotSeriesPoints(
        selectMetricSeries({ metricKey, points: pointsForMetric }).rows,
        outcome,
        metric,
      ),
      snapshotLegacySeriesPoints(pointsForMetric, outcome, metric),
    ].find((candidate) => metricSnapshotMatchesSavedResult(metric, candidate));

    return points ? { ...metric, points } : null;
  });
  if (metricResults.some((metric) => metric === null)) {
    return outcome;
  }

  return experimentOutcomeSchema.parse({
    ...outcome,
    metricResults,
    schema: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    schemaVersion: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  });
}

function snapshotSeriesPoints(
  points: readonly MetricSeriesPoint[],
  outcome: ExperimentOutcome,
  metric: ExperimentOutcome["metricResults"][number],
): ExperimentOutcomeMetricPoint[] {
  const byDate = new Map<string, MetricSeriesPoint & { value: number }>();
  for (const point of points.slice().sort(compareSeriesPoints)) {
    const value = point.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    byDate.set(point.date, { ...point, value });
  }
  return [...byDate.values()].flatMap((point) => {
    const phase = phaseForDate(point.date, outcome.windows);
    return phase
      ? [{
          date: point.date,
          phase,
          unit: unitForPhase(metric, phase),
          value: point.value,
        }]
      : [];
  });
}

function compareSeriesPoints(left: MetricSeriesPoint, right: MetricSeriesPoint): number {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  const leftObservedAt = left.observedAt ?? `${left.date}T00:00:00.000Z`;
  const rightObservedAt = right.observedAt ?? `${right.date}T00:00:00.000Z`;
  return leftObservedAt.localeCompare(rightObservedAt) ||
    (left.id ?? "").localeCompare(right.id ?? "");
}

function snapshotLegacySeriesPoints(
  points: readonly MetricPoint[],
  outcome: ExperimentOutcome,
  metric: ExperimentOutcome["metricResults"][number],
): ExperimentOutcomeMetricPoint[] {
  const byDate = new Map<string, MetricPoint[]>();
  for (const point of points) {
    if (!phaseForDate(point.effectiveDate, outcome.windows)) {
      continue;
    }
    byDate.set(point.effectiveDate, [...(byDate.get(point.effectiveDate) ?? []), point]);
  }

  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(
    ([date, datePoints]) => {
      const selected = datePoints
        .filter(hasLegacyDisplayValue)
        .sort(compareLegacyMetricPoints)[0];
      const value = selected?.canonicalValue ?? selected?.value;
      const phase = phaseForDate(date, outcome.windows);
      return selected && typeof value === "number" && Number.isFinite(value) && phase
        ? [{ date, phase, unit: unitForPhase(metric, phase), value }]
        : [];
    },
  );
}

export function metricSnapshotMatchesSavedResult(
  metric: ExperimentOutcome["metricResults"][number],
  points: readonly ExperimentOutcomeMetricPoint[],
): boolean {
  const baseline = points.filter((point) => point.phase === "baseline");
  const intervention = points.filter((point) => point.phase === "intervention");
  const baselineDays = metric.baseline?.daysWithData ?? metric.baselineDayCount;
  const baselineMean = metric.baseline ? metric.baseline.mean : metric.baselineMean;
  const interventionDays = metric.intervention?.daysWithData ?? metric.interventionDayCount;
  const interventionMean = metric.intervention
    ? metric.intervention.mean
    : metric.interventionMean;
  const calculatedBaselineMean = mean(baseline);
  const calculatedInterventionMean = mean(intervention);
  const deltaAbs = calculatedBaselineMean !== null && calculatedInterventionMean !== null
    ? round(calculatedInterventionMean - calculatedBaselineMean)
    : null;
  const deltaPct = calculatedBaselineMean !== null &&
      calculatedInterventionMean !== null &&
      calculatedBaselineMean !== 0
    ? round(
        ((calculatedInterventionMean - calculatedBaselineMean) /
          Math.abs(calculatedBaselineMean)) * 100,
      )
    : null;

  return baseline.length === baselineDays &&
    intervention.length === interventionDays &&
    calculatedBaselineMean === baselineMean &&
    calculatedInterventionMean === interventionMean &&
    deltaAbs === metric.deltaAbs &&
    deltaPct === metric.deltaPct;
}

function phaseForDate(
  date: string,
  windows: ExperimentOutcome["windows"],
): ExperimentOutcomeMetricPoint["phase"] | null {
  if (
    windows.baselineStart &&
    windows.baselineEnd &&
    date >= windows.baselineStart &&
    date <= windows.baselineEnd
  ) {
    return "baseline";
  }
  if (
    windows.interventionStart &&
    windows.interventionEnd &&
    date >= windows.interventionStart &&
    date <= windows.interventionEnd
  ) {
    return "intervention";
  }
  return null;
}

function unitForPhase(
  metric: ExperimentOutcome["metricResults"][number],
  phase: ExperimentOutcomeMetricPoint["phase"],
): string | null {
  return phase === "baseline"
    ? metric.baseline?.unit ?? metric.unit
    : metric.intervention?.unit ?? metric.unit;
}

function hasLegacyDisplayValue(point: MetricPoint): boolean {
  const value = point.canonicalValue ?? point.value;
  return typeof value === "number" && Number.isFinite(value);
}

function compareLegacyMetricPoints(left: MetricPoint, right: MetricPoint): number {
  const priorityDelta = legacySourcePriority(left) - legacySourcePriority(right);
  if (priorityDelta !== 0) return priorityDelta;
  if (left.observedAt !== right.observedAt) {
    return right.observedAt.localeCompare(left.observedAt);
  }
  return left.id.localeCompare(right.id);
}

function legacySourcePriority(point: MetricPoint): number {
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

function mean(points: readonly ExperimentOutcomeMetricPoint[]): number | null {
  return points.length === 0
    ? null
    : round(points.reduce((sum, point) => sum + point.value, 0) / points.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
