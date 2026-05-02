import {
  resolveMetricDefinitionForBiomarker,
  type MetricConfidence,
} from "@murphai/health-metrics";
import type {
  BrowserVaultMetricRow,
  BrowserVaultQueryClient,
} from "./shared.ts";

export const BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA = "murph.browser-vault-biomarker-panel";

export type BrowserVaultBiomarkerPanelStatus =
  | "ready"
  | "no_private_vault"
  | "no_data"
  | "insufficient_data"
  | "stale"
  | "unsupported"
  | "error";

export type BrowserVaultBiomarkerPanelWarningCode =
  | "COMPARATOR_VALUE"
  | "LOW_SAMPLE_COUNT"
  | "MIXED_SOURCES"
  | "SOURCE_STALE"
  | "UNIT_NOT_NORMALIZED"
  | "METHOD_CHANGED";

export interface BrowserVaultBiomarkerMetricBinding {
  metricKey: string;
  role?: "context" | "primary" | "secondary" | null;
  unit?: string | null;
}

export interface BrowserVaultBiomarkerTrendDefaults {
  aggregation: "mean" | "median";
  comparisonWindowDays: number;
  latestWindowDays: number;
  minimumPoints: number;
}

export interface SelectBrowserVaultBiomarkerPanelInput {
  biomarkerKey: string;
  client: BrowserVaultQueryClient | null;
  generatedAt?: string;
  label: string;
  metricKey?: string;
  now?: string;
  staleAfterDays?: number;
  trendDefaults: BrowserVaultBiomarkerTrendDefaults;
  unit: string;
  valuePrecision: number;
}

export interface BrowserVaultBiomarkerPanel {
  biomarkerKey: string;
  context: BrowserVaultBiomarkerMetricPanel[];
  emptyState?: BrowserVaultBiomarkerPanelEmptyState;
  generatedAt: string;
  primary: BrowserVaultBiomarkerMetricPanel | null;
  privacy: { containsPrivateHealthData: true; defaultShare: "private"; shareRequiresExplicitAction: true };
  schema: typeof BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA;
  sources: BrowserVaultBiomarkerPanelSource[];
  status: BrowserVaultBiomarkerPanelStatus;
  warnings: BrowserVaultBiomarkerPanelWarning[];
}

export interface BrowserVaultBiomarkerMetricPanel {
  binding: { metricKey: string };
  label: string;
  latest: { confidence: MetricConfidence; date: string; sourceLabel: string; unit: string | null; value: number } | null;
  sampleCount: number;
  series: BrowserVaultBiomarkerSeriesPoint[];
  trend: BrowserVaultBiomarkerTrend | null;
  unit: string;
  valuePrecision: number;
}

export interface BrowserVaultBiomarkerSeriesPoint {
  confidence: MetricConfidence;
  date: string;
  unit: string | null;
  value: number;
}

export interface BrowserVaultBiomarkerTrend {
  aggregation: BrowserVaultBiomarkerTrendDefaults["aggregation"];
  baselineValue: number;
  comparisonWindowDays: number;
  currentValue: number;
  delta: number;
  direction: "down" | "flat" | "up";
  label: string;
  latestWindowDays: number;
}

export interface BrowserVaultBiomarkerPanelSource {
  displayName: string;
  freshness: "fresh" | "never_synced" | "stale";
  latestRecordedAt: string | null;
}

export interface BrowserVaultBiomarkerPanelWarning { code: BrowserVaultBiomarkerPanelWarningCode; message: string }
export interface BrowserVaultBiomarkerPanelEmptyState { body: string; title: string }

const DEFAULT_STALE_AFTER_DAYS = 7;
const ISO_DAY_MS = 24 * 60 * 60 * 1000;

export function selectBrowserVaultBiomarkerPanel(input: SelectBrowserVaultBiomarkerPanelInput): BrowserVaultBiomarkerPanel {
  const generatedAt = input.generatedAt ?? input.client?.replica.generatedAt ?? input.now ?? new Date().toISOString();
  const base = createBasePanel(input, generatedAt);
  if (!input.client) return { ...base, emptyState: emptyStateForStatus("no_private_vault"), status: "no_private_vault" };

  const metricKey = input.metricKey ?? resolveMetricDefinitionForBiomarker(input.biomarkerKey)?.key ?? null;
  if (!metricKey) {
    return { ...base, emptyState: { body: "Private tracking for this biomarker is not available yet.", title: "Biomarker unavailable" }, status: "unsupported" };
  }

  const primary = buildMetricPanel({ input, metricKey });
  const warnings = buildWarnings({ primary, trendDefaults: input.trendDefaults });
  if (primary.sampleCount === 0) {
    return { ...base, emptyState: { body: `No ${input.label} values were found in the current browser-vault snapshot.`, title: "No private values yet" }, status: "no_data", warnings };
  }
  if (primary.sampleCount < input.trendDefaults.minimumPoints) {
    return { ...base, emptyState: { body: `Found ${primary.sampleCount} point${primary.sampleCount === 1 ? "" : "s"}. Murph waits for at least ${input.trendDefaults.minimumPoints} before summarizing a trend.`, title: "Not enough private data yet" }, primary, status: "insufficient_data", warnings };
  }

  const stale = isPrimarySeriesStale({ now: input.now ?? generatedAt, primary, staleAfterDays: input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS });
  return {
    ...base,
    primary,
    status: stale ? "stale" : "ready",
    warnings: stale ? [...warnings, { code: "SOURCE_STALE", message: `Latest ${input.label} value is older than ${input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS} days.` }] : warnings,
  };
}

function createBasePanel(input: SelectBrowserVaultBiomarkerPanelInput, generatedAt: string): BrowserVaultBiomarkerPanel {
  return {
    biomarkerKey: input.biomarkerKey,
    context: [],
    generatedAt,
    primary: null,
    privacy: { containsPrivateHealthData: true, defaultShare: "private", shareRequiresExplicitAction: true },
    schema: BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA,
    sources: (input.client?.replica.sourceHealthRows ?? []).map((row) => ({
      displayName: row.providerDisplayName,
      freshness: row.latestRecordedAt === null ? "never_synced" : row.stalenessVsNewestDays !== null && row.stalenessVsNewestDays > DEFAULT_STALE_AFTER_DAYS ? "stale" : "fresh",
      latestRecordedAt: row.latestRecordedAt,
    })),
    status: "error",
    warnings: [],
  };
}

function buildMetricPanel(input: { metricKey: string; input: SelectBrowserVaultBiomarkerPanelInput }): BrowserVaultBiomarkerMetricPanel {
  const rows = (input.input.client?.metrics.series({ metricKey: input.metricKey }) ?? [])
    .filter(hasNumericMetricValue)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = rows.at(-1) ?? null;
  const unit = latest?.unit ?? input.input.unit;
  return {
    binding: { metricKey: input.metricKey },
    label: input.input.label,
    latest: latest ? { confidence: latest.confidence, date: latest.date, sourceLabel: latest.sourceLabel ?? latest.sourceKind ?? "metric", unit: latest.unit, value: latest.value } : null,
    sampleCount: rows.length,
    series: rows.map((row) => ({ confidence: row.confidence, date: row.date, unit: row.unit, value: row.value })),
    trend: buildTrend(rows, input.input.trendDefaults, input.input.unit, input.input.valuePrecision),
    unit,
    valuePrecision: input.input.valuePrecision,
  };
}

function buildTrend(rows: readonly BrowserVaultMetricRowWithValue[], trendDefaults: BrowserVaultBiomarkerTrendDefaults, unit: string, valuePrecision: number): BrowserVaultBiomarkerTrend | null {
  const latest = rows.at(-1);
  if (!latest) return null;
  const currentStart = subtractIsoDays(latest.date, trendDefaults.latestWindowDays - 1);
  const baselineStart = subtractIsoDays(currentStart, trendDefaults.comparisonWindowDays);
  const currentRows = rows.filter((row) => row.date >= currentStart && row.date <= latest.date);
  const baselineRows = rows.filter((row) => row.date >= baselineStart && row.date < currentStart);
  if (currentRows.length === 0 || baselineRows.length < trendDefaults.minimumPoints) return null;
  const currentValue = aggregateMetricRows(currentRows, trendDefaults.aggregation);
  const baselineValue = aggregateMetricRows(baselineRows, trendDefaults.aggregation);
  const delta = currentValue - baselineValue;
  const directionDelta = isPercentageUnit(unit) ? delta : roundMetricValue(delta, valuePrecision);
  const flatThreshold = nearFlatThresholdForUnit(unit);
  return {
    aggregation: trendDefaults.aggregation,
    baselineValue,
    comparisonWindowDays: trendDefaults.comparisonWindowDays,
    currentValue,
    delta,
    direction: Math.abs(directionDelta) <= flatThreshold + 1e-9 ? "flat" : directionDelta < 0 ? "down" : "up",
    label: `${trendDefaults.latestWindowDays}-day ${trendDefaults.aggregation} vs prior ${trendDefaults.comparisonWindowDays} days`,
    latestWindowDays: trendDefaults.latestWindowDays,
  };
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & { value: number };
function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue { return typeof row.value === "number" && Number.isFinite(row.value) }
function aggregateMetricRows(rows: readonly BrowserVaultMetricRowWithValue[], aggregation: BrowserVaultBiomarkerTrendDefaults["aggregation"]): number {
  const values = rows.map((row) => row.value);
  if (aggregation === "mean") return values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2 : sorted[midpoint] ?? 0;
}
function buildWarnings(input: { primary: BrowserVaultBiomarkerMetricPanel; trendDefaults: BrowserVaultBiomarkerTrendDefaults }): BrowserVaultBiomarkerPanelWarning[] {
  const warnings: BrowserVaultBiomarkerPanelWarning[] = [];
  if (input.primary.sampleCount > 0 && input.primary.sampleCount < input.trendDefaults.minimumPoints) warnings.push({ code: "LOW_SAMPLE_COUNT", message: `Only ${input.primary.sampleCount} private value${input.primary.sampleCount === 1 ? "" : "s"} found.` });
  return warnings;
}
function isPrimarySeriesStale(input: { now: string; primary: BrowserVaultBiomarkerMetricPanel; staleAfterDays: number }): boolean {
  const latestDate = input.primary.latest?.date;
  return latestDate ? isOlderThanDays(latestDate, input.now, input.staleAfterDays) : false;
}
function emptyStateForStatus(_status: BrowserVaultBiomarkerPanelStatus): BrowserVaultBiomarkerPanelEmptyState {
  return { body: "Connect a health device or import labs to see your personal trend here. Your data stays private.", title: "Biomarker unavailable" };
}
function roundMetricValue(value: number, precision: number): number { return Number(value.toFixed(precision)) }
function nearFlatThresholdForUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "bpm") return 0.5;
  if (normalized === "ml/kg/min") return 0.1;
  if (isPercentageUnit(unit)) return 0.5;
  if (normalized === "minutes") return 1;
  return 0.01;
}
function isPercentageUnit(unit: string): boolean { const normalized = unit.trim().toLowerCase(); return normalized === "%" || normalized === "percent" || normalized.includes("percentage") }
function subtractIsoDays(date: string, days: number): string { const parsed = new Date(`${date}T00:00:00.000Z`); parsed.setUTCDate(parsed.getUTCDate() - days); return parsed.toISOString().slice(0, 10) }
function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) return false;
  return now.getTime() - observed.getTime() > days * ISO_DAY_MS;
}
