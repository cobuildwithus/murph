import {
  buildMetricSeries,
  formatMetricDisplayValue,
  resolveMetricDefinition,
  selectMetricValue,
  type MetricPoint,
  type MetricSelection,
} from "../metrics/index.ts";
import type {
  BrowserVaultMetricFilters,
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
} from "./shared.ts";

export const BROWSER_VAULT_METRIC_ROW_SCHEMA = "murph.browser-vault.metric-row" as const;
export const BROWSER_VAULT_METRIC_SELECTION_SCHEMA = "murph.browser-vault.metric-selection" as const;

export function toBrowserVaultMetricRows(input: {
  from?: string;
  points: readonly MetricPoint[];
  to?: string;
}): BrowserVaultMetricRow[] {
  return buildMetricSeries({
    from: input.from,
    points: input.points,
    to: input.to,
  }).flatMap(toBrowserVaultMetricRow);
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly MetricPoint[];
}): BrowserVaultMetricSelectionRow[] {
  const metricKeys = [...new Set(input.metricPoints.map((point) => point.metricKey))].sort();
  return metricKeys.flatMap((metricKey) => {
    const definition = resolveMetricDefinition(metricKey);
    if (!definition) return [];
    const selection = selectMetricValue({ metricKey, now: input.generatedAt, points: input.metricPoints });
    return selection.point ? [toBrowserVaultMetricSelectionRow(selection)] : [];
  });
}

export function metricRowMatchesFilters(row: BrowserVaultMetricRow, filters: BrowserVaultMetricFilters): boolean {
  if (filters.metricKey && row.metricKey !== filters.metricKey) return false;
  if (filters.biomarkerKey && row.biomarkerKey !== filters.biomarkerKey) return false;
  if (filters.grain && row.grain !== filters.grain) return false;
  if (filters.from && row.date < filters.from) return false;
  if (filters.to && row.date > filters.to) return false;
  return true;
}

function toBrowserVaultMetricRow(point: MetricPoint): BrowserVaultMetricRow[] {
  const value = point.canonicalValue ?? point.value;
  if (value === null) return [];
  const definition = resolveMetricDefinition(point.metricKey);

  return [{
    biomarkerKey: point.biomarkerKey,
    confidence: point.confidence,
    context: point.context,
    date: point.effectiveDate,
    grain: point.grain,
    id: `metric-row:${point.id}`,
    metricKey: point.metricKey,
    observedAt: point.observedAt,
    pointIds: [point.id],
    recordIds: [point.source.recordId],
    rowSchema: BROWSER_VAULT_METRIC_ROW_SCHEMA,
    sourceFamily: point.source.family,
    sourceKind: point.source.kind,
    sourceLabel: point.provenance.sourceLabel,
    statistic: point.statistic,
    unit: point.canonicalUnit ?? point.unit,
    value,
    valueLabel: formatMetricDisplayValue(point, definition),
  }];
}

function toBrowserVaultMetricSelectionRow(selection: MetricSelection): BrowserVaultMetricSelectionRow {
  const point = selection.point;
  if (!point || selection.value === null || !selection.valueLabel) {
    throw new TypeError("Browser metric selection rows require a selected numeric point.");
  }

  return {
    biomarkerKey: selection.biomarkerKey,
    confidence: selection.confidence,
    effectiveDate: selection.effectiveDate ?? point.effectiveDate,
    id: `metric-selection:${selection.metricKey}`,
    metricKey: selection.metricKey,
    observedAt: selection.observedAt ?? point.observedAt,
    pointIds: selection.provenance.pointIds,
    recordIds: selection.provenance.recordIds,
    selectedMetricRowId: `metric-row:${point.id}`,
    selectionSchema: BROWSER_VAULT_METRIC_SELECTION_SCHEMA,
    sourceLabel: selection.sourceLabel,
    status: selection.status,
    unit: selection.unit,
    value: selection.value,
    valueLabel: selection.valueLabel,
    warnings: selection.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  };
}
