import {
  createCustomMetricDefinition,
  normalizeMetricKey,
  resolveMetricDefinition,
  selectMetricSeries,
  selectMetricValue,
  type MetricPoint,
  type MetricSelection,
  type MetricSeriesPoint,
} from "../metrics/index.ts";
import type {
  BrowserVaultMetricFilters,
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
} from "./shared.ts";

export const BROWSER_VAULT_METRIC_ROW_SCHEMA = "murph.browser-vault.metric-row.v1" as const;
export const BROWSER_VAULT_METRIC_SELECTION_SCHEMA = "murph.browser-vault.metric-selection.v1" as const;

export interface BrowserVaultRequestedMetric {
  biomarkerKey?: string | null;
  metricKey: string;
}

export function toBrowserVaultMetricRows(input: {
  from?: string;
  points: readonly MetricPoint[];
  to?: string;
}): BrowserVaultMetricRow[] {
  const metricKeys = [...new Set(input.points.map((point) => point.metricKey))].sort();
  return metricKeys.flatMap((metricKey) =>
    selectMetricSeries({
      duplicatePolicy: "selection-policy",
      from: input.from,
      metricKey,
      points: input.points,
      to: input.to,
    }).rows.flatMap(toBrowserVaultMetricRow)
  );
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly MetricPoint[];
  metricRowPointIds?: ReadonlySet<string>;
  requestedMetrics?: readonly BrowserVaultRequestedMetric[];
}): BrowserVaultMetricSelectionRow[] {
  const requestedMetrics = normalizeRequestedMetrics(input.requestedMetrics, input.metricPoints);
  return requestedMetrics.map((request) => {
    const selection = selectMetricValue({
      biomarkerKey: request.biomarkerKey ?? undefined,
      metricKey: request.metricKey,
      now: input.generatedAt,
      points: input.metricPoints,
    });
    return toBrowserVaultMetricSelectionRow(selection, request, input.metricRowPointIds);
  });
}

export function metricRowMatchesFilters(row: BrowserVaultMetricRow, filters: BrowserVaultMetricFilters): boolean {
  const metricKey = filters.metricKey ? resolveMetricKey(filters.metricKey) : null;
  if (metricKey && row.metricKey !== metricKey) return false;
  if (filters.biomarkerKey && row.biomarkerKey !== filters.biomarkerKey) return false;
  if (filters.grain && row.grain !== filters.grain) return false;
  if (filters.from && row.date < filters.from) return false;
  if (filters.to && row.date > filters.to) return false;
  return true;
}

function toBrowserVaultMetricRow(point: MetricSeriesPoint): BrowserVaultMetricRow[] {
  const value = point.value;
  if (value === null) return [];

  return [{
    biomarkerKey: point.biomarkerKey,
    confidence: point.confidence,
    context: point.context,
    date: point.date,
    grain: point.grain,
    id: `metric-row:${point.id}`,
    metricKey: point.metricKey,
    observedAt: point.observedAt,
    pointIds: point.pointIds,
    recordIds: point.recordIds,
    rowSchema: BROWSER_VAULT_METRIC_ROW_SCHEMA,
    sourceFamily: point.sourceFamily,
    sourceKind: point.sourceKind,
    sourceLabel: point.sourceLabel,
    statistic: point.statistic,
    unit: point.unit,
    value,
    valueLabel: point.valueLabel,
  }];
}

function toBrowserVaultMetricSelectionRow(
  selection: MetricSelection,
  requestedMetric: BrowserVaultRequestedMetric,
  metricRowPointIds: ReadonlySet<string> | undefined,
): BrowserVaultMetricSelectionRow {
  const point = selection.point;
  const selectedMetricRowId = point && (!metricRowPointIds || metricRowPointIds.has(point.id))
    ? `metric-row:metric-series:${point.id}`
    : null;
  return {
    biomarkerKey: selection.biomarkerKey ?? requestedMetric.biomarkerKey ?? null,
    confidence: selection.confidence,
    effectiveDate: selection.effectiveDate ?? point?.effectiveDate ?? null,
    id: `metric-selection:${selection.metricKey}`,
    metricKey: selection.metricKey,
    observedAt: selection.observedAt ?? point?.observedAt ?? null,
    pointIds: selection.provenance.pointIds,
    recordIds: selection.provenance.recordIds,
    selectedMetricRowId,
    selectionSchema: BROWSER_VAULT_METRIC_SELECTION_SCHEMA,
    sourceLabel: selection.sourceLabel,
    status: selection.status,
    unit: selection.unit,
    value: selection.value,
    valueLabel: selection.valueLabel,
    warnings: selection.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  };
}

function normalizeRequestedMetrics(
  requestedMetrics: readonly BrowserVaultRequestedMetric[] | undefined,
  metricPoints: readonly MetricPoint[],
): BrowserVaultRequestedMetric[] {
  const byKey = new Map<string, BrowserVaultRequestedMetric>();
  const inputs: readonly BrowserVaultRequestedMetric[] = [
    ...metricPoints.map((point) => ({
      biomarkerKey: point.biomarkerKey,
      metricKey: point.metricKey,
    })),
    ...(requestedMetrics ?? []),
  ];

  for (const input of inputs) {
    const metricKey = resolveMetricKey(input.metricKey);
    if (!metricKey) continue;
    const definition = resolveMetricDefinition(metricKey) ?? createCustomMetricDefinition(metricKey);
    const biomarkerKey = input.biomarkerKey ?? definition.biomarkerKey ?? null;
    byKey.set(`${metricKey}\u001f${biomarkerKey ?? ""}`, { metricKey, biomarkerKey });
  }

  return [...byKey.values()].sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey) || (left.biomarkerKey ?? "").localeCompare(right.biomarkerKey ?? "")
  );
}

function resolveMetricKey(value: string): string {
  return resolveMetricDefinition(value)?.key ?? normalizeMetricKey(value);
}
