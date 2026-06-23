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
  return dedupeEquivalentMetricRows(metricKeys.flatMap((metricKey) =>
    selectMetricSeries({
      duplicatePolicy: "keep-all",
      from: input.from,
      metricKey,
      points: input.points,
      to: input.to,
    }).rows.flatMap(toBrowserVaultMetricRow)
  ));
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly MetricPoint[];
  metricRowPointIds?: ReadonlySet<string>;
  requestedMetrics?: readonly BrowserVaultRequestedMetric[];
  selectionPoints?: readonly MetricPoint[];
}): BrowserVaultMetricSelectionRow[] {
  const requestedMetrics = normalizeRequestedMetrics(input.requestedMetrics, input.metricPoints);
  const selectionPoints = input.selectionPoints ?? input.metricPoints;
  return requestedMetrics.map((request) => {
    const selection = selectMetricValue({
      biomarkerKey: request.biomarkerKey ?? undefined,
      metricKey: request.metricKey,
      now: input.generatedAt,
      points: selectionPoints,
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
    biomarkerKey: point.biomarkerKey ?? null,
    comparator: point.comparator ?? null,
    confidence: point.confidence ?? "none",
    context: point.context ?? {},
    date: point.date,
    grain: point.grain ?? "day",
    id: `metric-row:${point.id ?? `${point.metricKey}:${point.date}`}`,
    metricKey: point.metricKey,
    observedAt: point.observedAt ?? `${point.date}T00:00:00.000Z`,
    pointIds: point.pointIds ?? (point.id ? [point.id] : []),
    recordIds: point.recordIds ?? [],
    rowSchema: BROWSER_VAULT_METRIC_ROW_SCHEMA,
    sourceFamily: point.sourceFamily ?? null,
    sourceKind: point.sourceKind ?? null,
    sourceLabel: point.sourceLabel ?? null,
    statistic: point.statistic ?? "value",
    unit: point.unit,
    value,
    valueLabel: point.valueLabel ?? null,
  }];
}

function dedupeEquivalentMetricRows(
  rows: readonly BrowserVaultMetricRow[],
): BrowserVaultMetricRow[] {
  const byEquivalentValue = new Map<string, BrowserVaultMetricRow>();

  for (const row of rows) {
    const key = [
      row.metricKey,
      row.date,
      row.unit,
      row.comparator,
      String(row.value),
      [...row.recordIds].sort().join(","),
    ].join("\u0000");
    const existing = byEquivalentValue.get(key);
    if (!existing) {
      byEquivalentValue.set(key, row);
      continue;
    }

    byEquivalentValue.set(key, {
      ...existing,
      pointIds: [...new Set([...existing.pointIds, ...row.pointIds])].sort(),
    });
  }

  return [...byEquivalentValue.values()];
}

export function browserMetricRowToSeriesPoint(row: BrowserVaultMetricRow): MetricSeriesPoint {
  return {
    biomarkerKey: row.biomarkerKey,
    comparator: row.comparator,
    confidence: row.confidence,
    context: row.context,
    date: row.date,
    grain: row.grain,
    id: row.id,
    metricKey: row.metricKey,
    observedAt: row.observedAt,
    pointIds: row.pointIds,
    recordIds: row.recordIds,
    sourceFamily: normalizeMetricSourceFamily(row.sourceFamily),
    sourceKind: row.sourceKind,
    sourceKinds: row.sourceKind ? [row.sourceKind] : [],
    sourceLabel: row.sourceLabel,
    statistic: row.statistic,
    unit: row.unit,
    value: row.value,
    valueLabel: row.valueLabel,
  };
}

function toBrowserVaultMetricSelectionRow(
  selection: MetricSelection,
  requestedMetric: BrowserVaultRequestedMetric,
  metricRowPointIds: ReadonlySet<string> | undefined,
): BrowserVaultMetricSelectionRow {
  const point = selection.point;
  const biomarkerKey = selection.biomarkerKey ?? requestedMetric.biomarkerKey ?? null;
  const selectedMetricRowId = point && (!metricRowPointIds || metricRowPointIds.has(point.id))
    ? `metric-row:metric-series:${point.id}`
    : null;
  return {
    biomarkerKey,
    confidence: selection.confidence,
    effectiveDate: selection.effectiveDate ?? point?.effectiveDate ?? null,
    id: browserVaultMetricSelectionId(selection.metricKey, biomarkerKey),
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

function browserVaultMetricSelectionId(metricKey: string, biomarkerKey: string | null): string {
  return `metric-selection:${metricKey}:${biomarkerKey ?? "none"}`;
}

function normalizeRequestedMetrics(
  requestedMetrics: readonly BrowserVaultRequestedMetric[] | undefined,
  metricPoints: readonly MetricPoint[],
): BrowserVaultRequestedMetric[] {
  const byKey = new Map<string, BrowserVaultRequestedMetric>();
  const inputs: readonly BrowserVaultRequestedMetric[] = requestedMetrics
    ?? metricPoints.map((point) => ({
      biomarkerKey: point.biomarkerKey,
      metricKey: point.metricKey,
    }));

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

function normalizeMetricSourceFamily(value: string | null): MetricSeriesPoint["sourceFamily"] {
  switch (value) {
    case "derived":
    case "event":
    case "sample":
      return value;
    default:
      return null;
  }
}
