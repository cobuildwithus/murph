import {
  METRIC_POINT_SCHEMA_VERSION,
  extractMetricPoints,
  formatMetricDisplayValue,
  resolveBrowserMetricBinding,
  resolveMetricDefinition,
  selectMetricValue,
  type MetricPointSource,
  type MetricSourceFamily,
  type MetricPoint,
  type MetricSelection,
} from "../metrics/index.ts";
import type {
  BrowserVaultMetricDomain,
  BrowserVaultMetricPoint,
  BrowserVaultMetricPointFilters,
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
} from "./shared.ts";
import type { CanonicalEntity } from "../canonical-entities.ts";

export const BROWSER_VAULT_METRIC_POINT_SCHEMA = "murph.browser-vault.metric-point" as const;
export const BROWSER_VAULT_METRIC_SELECTION_SCHEMA = "murph.browser-vault.metric-selection" as const;

interface MetricPointObjectInput {
  readonly generatedAt?: string;
  readonly lookbackDays?: number;
  readonly metricRows: readonly BrowserVaultMetricRow[];
  readonly vault?: { readonly entities: readonly CanonicalEntity[] };
}

type MetricPointInput = readonly BrowserVaultMetricRow[] | MetricPointObjectInput;

type MetricSelectionPointInput = MetricPoint | BrowserVaultMetricPoint;

const ISO_DAY_MS = 24 * 60 * 60 * 1000;

export function resolveBrowserVaultMetricKey(input: {
  domain: BrowserVaultMetricDomain | string;
  metric: string;
}): string | null {
  return resolveBrowserMetricBinding(input)?.key ?? null;
}

export function resolveBrowserVaultMetricPointBiomarkerKey(metricKey: string): string | null {
  return resolveMetricDefinition(metricKey)?.biomarkerKey ?? null;
}

export function createBrowserVaultMetricPointRecords(input: MetricPointInput): MetricPoint[] {
  if (!isMetricPointObjectInput(input)) {
    return extractMetricPoints({ metricRows: input });
  }

  const metricPoints = extractMetricPoints({ metricRows: input.metricRows, vault: input.vault });
  return filterMetricPointsByLookback(metricPoints, {
    generatedAt: input.generatedAt ?? null,
    lookbackDays: input.lookbackDays ?? null,
  });
}

export function createBrowserVaultMetricPoints(input: MetricPointInput): BrowserVaultMetricPoint[] {
  return createBrowserVaultMetricPointRecords(input).flatMap(toBrowserVaultMetricPoint);
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly MetricSelectionPointInput[];
}): BrowserVaultMetricSelectionRow[] {
  const metricPoints = input.metricPoints.flatMap((point) => {
    const normalized = toMetricPointRecord(point);
    return normalized ? [normalized] : [];
  });
  const metricKeys = [...new Set(metricPoints.map((point) => point.metricKey))].sort();
  return metricKeys.flatMap((metricKey) => {
    const selection = selectMetricValue({
      metricKey,
      now: input.generatedAt,
      points: metricPoints,
    });
    return selection.point ? [toBrowserVaultMetricSelectionRow(selection)] : [];
  });
}

export function metricPointMatchesFilters(
  point: BrowserVaultMetricPoint,
  filters: BrowserVaultMetricPointFilters,
): boolean {
  if (filters.metricKey && point.metricKey !== filters.metricKey) return false;
  if (filters.biomarkerKey && point.biomarkerKey !== filters.biomarkerKey) return false;
  if (filters.from && point.date < filters.from) return false;
  if (filters.to && point.date > filters.to) return false;
  return true;
}

export function browserVaultMetricPointToMetricRow(input: {
  binding: { domain: BrowserVaultMetricDomain; metric: string };
  point: BrowserVaultMetricPoint;
}): BrowserVaultMetricRow {
  return {
    confidence: input.point.confidence,
    date: input.point.date,
    domain: input.binding.domain,
    id: `metric-point-row:${input.point.id}`,
    metric: input.binding.metric,
    recordIds: input.point.recordIds.slice(),
    sourceFamily: input.point.sourceFamily,
    sourceKind: input.point.sourceLabel ?? input.point.sourceKind,
    unit: input.point.unit,
    value: input.point.value,
  };
}

export function browserVaultMetricSeries(input: {
  biomarkerKey?: string;
  from?: string;
  metricKey?: string;
  points: readonly BrowserVaultMetricPoint[];
  to?: string;
}): BrowserVaultMetricPoint[] {
  return input.points
    .filter((point) => !input.metricKey || point.metricKey === input.metricKey)
    .filter((point) => !input.biomarkerKey || point.biomarkerKey === input.biomarkerKey)
    .filter((point) => !input.from || point.date >= input.from)
    .filter((point) => !input.to || point.date <= input.to)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

function toBrowserVaultMetricPoint(point: MetricPoint): BrowserVaultMetricPoint[] {
  const value = point.canonicalValue ?? point.value;
  if (value === null) return [];
  const definition = resolveMetricDefinition(point.metricKey);

  return [{
    biomarkerKey: point.biomarkerKey,
    canonicalUnit: point.canonicalUnit,
    canonicalValue: point.canonicalValue,
    comparator: point.comparator,
    confidence: point.confidence,
    context: point.context,
    date: point.effectiveDate,
    effectiveDate: point.effectiveDate,
    grain: point.grain,
    id: point.id,
    metricKey: point.metricKey,
    observedAt: point.observedAt,
    pointSchema: BROWSER_VAULT_METRIC_POINT_SCHEMA,
    provenance: { ...point.provenance },
    recordedAt: point.recordedAt,
    recordIds: [point.source.recordId],
    reportedAt: point.reportedAt,
    schemaVersion: point.schemaVersion,
    source: { ...point.source },
    sourceFamily: point.source.family,
    sourceKind: point.source.kind,
    sourceLabel: point.provenance.sourceLabel,
    sourceMetricRowId: `${point.source.recordId}:${point.source.kind}:${point.source.resultIndex ?? 0}`,
    statistic: point.statistic,
    textValue: point.textValue,
    unit: point.canonicalUnit ?? point.unit,
    value,
    valueLabel: formatMetricDisplayValue(point, definition),
  }];
}

function toMetricPointRecord(point: MetricSelectionPointInput): MetricPoint | null {
  if (isMetricPointRecord(point)) {
    return point;
  }

  const value = typeof point.value === "number" && Number.isFinite(point.value)
    ? point.value
    : null;
  if (value === null) {
    return null;
  }

  const source = readBrowserMetricPointSource(point);
  const provenance = {
    dataOrigin: null,
    externalRef: null,
    labName: null,
    provider: null,
    rawRefs: [],
    sourceLabel: point.sourceLabel,
  };

  return {
    biomarkerKey: point.biomarkerKey,
    canonicalUnit: point.canonicalUnit ?? null,
    canonicalValue: point.canonicalValue ?? null,
    comparator: point.comparator ?? null,
    confidence: point.confidence,
    context: {},
    effectiveDate: point.effectiveDate ?? point.date,
    grain: point.grain,
    id: point.id,
    metricKey: point.metricKey,
    observedAt: point.observedAt,
    provenance,
    recordedAt: point.recordedAt ?? null,
    reportedAt: point.reportedAt ?? null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source,
    statistic: point.statistic,
    textValue: point.textValue ?? null,
    unit: point.unit,
    value,
  };
}

function isMetricPointRecord(point: MetricSelectionPointInput): point is MetricPoint {
  return point.schemaVersion === METRIC_POINT_SCHEMA_VERSION
    && typeof point.source === "object"
    && point.source !== null
    && typeof point.provenance === "object"
    && point.provenance !== null;
}

function isMetricPointObjectInput(input: MetricPointInput): input is MetricPointObjectInput {
  return "metricRows" in input;
}

function readBrowserMetricPointSource(point: BrowserVaultMetricPoint): MetricPointSource {
  return {
    family: readMetricSourceFamily(point.sourceFamily),
    kind: point.sourceKind ?? "wearable-summary",
    path: "",
    recordId: point.recordIds[0] ?? point.sourceMetricRowId,
    resultIndex: null,
  };
}

function readMetricSourceFamily(value: string | null): MetricSourceFamily {
  return value === "event" || value === "sample" || value === "derived" ? value : "derived";
}

function filterMetricPointsByLookback(
  points: readonly MetricPoint[],
  input: {
    generatedAt: string | null;
    lookbackDays: number | null;
  },
): MetricPoint[] {
  if (!input.generatedAt || typeof input.lookbackDays !== "number") {
    return points.slice();
  }

  return points.filter((point) =>
    !isOlderThanDays(point.observedAt, input.generatedAt ?? "", input.lookbackDays ?? 0)
  );
}

function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) return false;
  return now.getTime() - observed.getTime() > days * ISO_DAY_MS;
}

function toBrowserVaultMetricSelectionRow(selection: MetricSelection): BrowserVaultMetricSelectionRow {
  const point = selection.point;
  if (!point || selection.value === null || !selection.valueLabel) {
    throw new TypeError("Browser metric selection rows require a selected numeric point.");
  }

  return {
    biomarkerKey: selection.biomarkerKey,
    confidence: selection.confidence,
    date: selection.effectiveDate ?? point.effectiveDate,
    effectiveDate: selection.effectiveDate ?? point.effectiveDate,
    id: `metric-selection:${selection.metricKey}`,
    metricKey: selection.metricKey,
    observedAt: selection.observedAt ?? point.observedAt,
    pointIds: selection.provenance.pointIds,
    recordIds: selection.provenance.recordIds,
    selectionSchema: BROWSER_VAULT_METRIC_SELECTION_SCHEMA,
    sourceLabel: selection.sourceLabel,
    status: selection.status === "stale" ? "stale" : "ready",
    unit: selection.unit,
    value: selection.value,
    valueLabel: selection.valueLabel,
    warnings: selection.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  };
}
