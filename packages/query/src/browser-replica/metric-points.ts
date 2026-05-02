import type {
  BrowserVaultMetricDomain,
  BrowserVaultMetricPoint,
  BrowserVaultMetricPointFilters,
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
} from "./shared.ts";

export const BROWSER_VAULT_METRIC_POINT_SCHEMA = "murph.browser-vault.metric-point.v1" as const;
export const BROWSER_VAULT_METRIC_SELECTION_SCHEMA = "murph.browser-vault.metric-selection.v1" as const;

interface SupportedWearableMetricDefinition {
  readonly biomarkerKey: string;
  readonly displayName: string;
  readonly metric: string;
  readonly metricKey: string;
  readonly primaryDomain: BrowserVaultMetricDomain;
  readonly sourceDomains: readonly BrowserVaultMetricDomain[];
  readonly staleAfterDays: number;
  readonly unit: string;
  readonly valuePrecision: number;
}

const SUPPORTED_WEARABLE_METRIC_DEFINITIONS: readonly SupportedWearableMetricDefinition[] = [
  {
    biomarkerKey: "biomarker:resting-heart-rate",
    displayName: "Resting heart rate",
    metric: "restingHeartRate",
    metricKey: "resting-heart-rate",
    primaryDomain: "recovery",
    sourceDomains: ["recovery"],
    staleAfterDays: 14,
    unit: "bpm",
    valuePrecision: 0,
  },
  {
    biomarkerKey: "biomarker:hrv-rmssd",
    displayName: "HRV",
    metric: "hrv",
    metricKey: "hrv-rmssd",
    primaryDomain: "recovery",
    sourceDomains: ["recovery", "sleep"],
    staleAfterDays: 14,
    unit: "ms",
    valuePrecision: 0,
  },
  {
    biomarkerKey: "biomarker:deep-sleep-minutes",
    displayName: "Deep sleep",
    metric: "deepMinutes",
    metricKey: "deep-sleep-minutes",
    primaryDomain: "sleep",
    sourceDomains: ["sleep"],
    staleAfterDays: 14,
    unit: "minutes",
    valuePrecision: 0,
  },
  {
    biomarkerKey: "biomarker:rem-sleep-minutes",
    displayName: "REM sleep",
    metric: "remMinutes",
    metricKey: "rem-sleep-minutes",
    primaryDomain: "sleep",
    sourceDomains: ["sleep"],
    staleAfterDays: 14,
    unit: "minutes",
    valuePrecision: 0,
  },
];

const SUPPORTED_BY_METRIC_KEY = new Map(
  SUPPORTED_WEARABLE_METRIC_DEFINITIONS.map((definition) => [definition.metricKey, definition]),
);

export function resolveBrowserVaultMetricKey(input: {
  domain: BrowserVaultMetricDomain | string;
  metric: string;
}): string | null {
  const domain = parseBrowserVaultMetricDomain(input.domain);
  if (!domain) {
    return null;
  }

  const definition = SUPPORTED_WEARABLE_METRIC_DEFINITIONS.find((candidate) =>
    candidate.metric === input.metric && candidate.sourceDomains.includes(domain)
  );

  return definition?.metricKey ?? null;
}

export function resolveBrowserVaultMetricPointBiomarkerKey(metricKey: string): string | null {
  return SUPPORTED_BY_METRIC_KEY.get(metricKey)?.biomarkerKey ?? null;
}

export function createBrowserVaultMetricPoints(
  metricRows: readonly BrowserVaultMetricRow[],
): BrowserVaultMetricPoint[] {
  return metricRows
    .flatMap((row) => {
      const metricKey = resolveBrowserVaultMetricKey(row);
      const definition = metricKey ? SUPPORTED_BY_METRIC_KEY.get(metricKey) : null;

      if (!definition || typeof row.value !== "number" || !Number.isFinite(row.value)) {
        return [];
      }

      const unit = row.unit ?? definition.unit;
      const observedAt = metricRowObservedAt(row);
      const sourceLabel = metricPointSourceLabel(row);

      return [{
        biomarkerKey: definition.biomarkerKey,
        confidence: row.confidence,
        date: row.date,
        grain: "day",
        id: `metric-point:${definition.metricKey}:${row.date}:${row.id}`,
        metricKey: definition.metricKey,
        observedAt,
        pointSchema: BROWSER_VAULT_METRIC_POINT_SCHEMA,
        recordIds: row.recordIds.slice(),
        sourceFamily: row.sourceFamily,
        sourceKind: row.sourceKind,
        sourceLabel,
        sourceMetricRowId: row.id,
        statistic: "value",
        unit,
        value: row.value,
        valueLabel: formatMetricValue(row.value, definition.valuePrecision),
      } satisfies BrowserVaultMetricPoint];
    })
    .sort(compareMetricPointsByDateDesc);
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly BrowserVaultMetricPoint[];
}): BrowserVaultMetricSelectionRow[] {
  const rows: BrowserVaultMetricSelectionRow[] = [];

  for (const definition of SUPPORTED_WEARABLE_METRIC_DEFINITIONS) {
    const points = input.metricPoints
      .filter((point) => point.metricKey === definition.metricKey)
      .sort(compareMetricPointsByDateDesc);
    const selected = points[0] ?? null;

    if (!selected) {
      continue;
    }

    const stale = isOlderThanDays(
      selected.observedAt,
      input.generatedAt,
      definition.staleAfterDays,
    );

    rows.push({
      biomarkerKey: definition.biomarkerKey,
      confidence: selected.confidence,
      date: selected.date,
      id: `metric-selection:${definition.metricKey}`,
      metricKey: definition.metricKey,
      observedAt: selected.observedAt,
      pointIds: [selected.id],
      recordIds: selected.recordIds.slice(),
      selectionSchema: BROWSER_VAULT_METRIC_SELECTION_SCHEMA,
      sourceLabel: selected.sourceLabel,
      status: stale ? "stale" : "ready",
      unit: selected.unit,
      value: selected.value,
      valueLabel: selected.valueLabel,
      warnings: stale
        ? [{
            code: "SOURCE_STALE",
            message: `${definition.displayName} has not synced in the last ${definition.staleAfterDays} days.`,
          }]
        : [],
    });
  }

  return rows;
}

export function metricPointMatchesFilters(
  point: BrowserVaultMetricPoint,
  filters: BrowserVaultMetricPointFilters,
): boolean {
  if (filters.metricKey && point.metricKey !== filters.metricKey) {
    return false;
  }

  if (filters.biomarkerKey && point.biomarkerKey !== filters.biomarkerKey) {
    return false;
  }

  if (filters.from && point.date < filters.from) {
    return false;
  }

  if (filters.to && point.date > filters.to) {
    return false;
  }

  return true;
}

export function browserVaultMetricPointToMetricRow(input: {
  binding: {
    domain: BrowserVaultMetricDomain;
    metric: string;
  };
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

function compareMetricPointsByDateDesc(
  left: BrowserVaultMetricPoint,
  right: BrowserVaultMetricPoint,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  if (left.observedAt !== right.observedAt) {
    return right.observedAt.localeCompare(left.observedAt);
  }

  return left.id.localeCompare(right.id);
}

function metricRowObservedAt(row: BrowserVaultMetricRow): string {
  return row.date.includes("T") ? row.date : `${row.date}T00:00:00.000Z`;
}

function metricPointSourceLabel(row: BrowserVaultMetricRow): string | null {
  const sourceKind = row.sourceKind?.trim();

  if (sourceKind && sourceKind !== "summary") {
    return formatWords(sourceKind);
  }

  if (sourceKind === "summary") {
    return "Wearable summary";
  }

  const sourceFamily = row.sourceFamily?.trim();
  return sourceFamily ? formatWords(sourceFamily) : "Wearable summary";
}

function formatMetricValue(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString();
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);

  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) {
    return false;
  }

  return now.getTime() - observed.getTime() > days * 24 * 60 * 60 * 1000;
}

function parseBrowserVaultMetricDomain(value: string): BrowserVaultMetricDomain | null {
  if (value === "activity" || value === "body_state" || value === "recovery" || value === "sleep") {
    return value;
  }

  return null;
}
