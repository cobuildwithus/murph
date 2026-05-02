import {
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricTrend,
  type MetricConfidence,
  type MetricTrend,
} from "@murphai/health-metrics";
import type {
  BrowserVaultMetricRow,
  BrowserVaultQueryClient,
} from "./shared.ts";
import { browserMetricRowToSeriesPoint } from "./metric-points.ts";

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
  label?: string | null;
  role?: "context" | "primary" | "secondary" | null;
  source?: string | null;
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
  privateMetricBindings?: readonly BrowserVaultBiomarkerMetricBinding[];
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

export type BrowserVaultBiomarkerTrend = MetricTrend;

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

  const primaryBinding = resolvePrimaryMetricBinding(input);
  const metricKey = input.metricKey ?? primaryBinding?.metricKey ?? resolveMetricDefinitionForBiomarker(input.biomarkerKey)?.key ?? null;
  if (!metricKey) {
    return { ...base, emptyState: { body: "Private tracking for this biomarker is not available yet.", title: "Biomarker unavailable" }, status: "unsupported" };
  }

  const primary = buildMetricPanel({ binding: primaryBinding ?? { metricKey, role: "primary" }, input, metricKey });
  const context = resolveContextMetricBindings(input, metricKey).map((binding) => buildMetricPanel({ binding, input, metricKey: binding.metricKey }));
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
    context,
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

function resolvePrimaryMetricBinding(input: SelectBrowserVaultBiomarkerPanelInput): BrowserVaultBiomarkerMetricBinding | null {
  return input.privateMetricBindings?.find((binding) => binding.role === "primary")
    ?? input.privateMetricBindings?.find((binding) => binding.role !== "context")
    ?? input.privateMetricBindings?.[0]
    ?? null;
}

function resolveContextMetricBindings(
  input: SelectBrowserVaultBiomarkerPanelInput,
  primaryMetricKey: string,
): BrowserVaultBiomarkerMetricBinding[] {
  return (input.privateMetricBindings ?? [])
    .filter((binding) => binding.role === "context" || binding.role === "secondary")
    .filter((binding) => binding.metricKey !== primaryMetricKey);
}

function buildMetricPanel(input: {
  binding: BrowserVaultBiomarkerMetricBinding;
  metricKey: string;
  input: SelectBrowserVaultBiomarkerPanelInput;
}): BrowserVaultBiomarkerMetricPanel {
  const rows = (input.input.client?.metrics.series({ metricKey: input.metricKey }) ?? [])
    .filter(hasNumericMetricValue)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = rows.at(-1) ?? null;
  const definition = resolveMetricDefinition(input.metricKey);
  const unit = latest?.unit ?? input.binding.unit ?? input.input.unit;
  const trendPoints = rows.map(browserMetricRowToSeriesPoint);
  return {
    binding: { metricKey: input.metricKey },
    label: input.binding.label ?? definition?.displayName ?? input.input.label,
    latest: latest ? { confidence: latest.confidence, date: latest.date, sourceLabel: latest.sourceLabel ?? latest.sourceKind ?? "metric", unit: latest.unit, value: latest.value } : null,
    sampleCount: rows.length,
    series: rows.map((row) => ({ confidence: row.confidence, date: row.date, unit: row.unit, value: row.value })),
    trend: selectMetricTrend({
      metricKey: input.metricKey,
      points: trendPoints,
      policy: input.input.trendDefaults,
      unit,
      valuePrecision: input.input.valuePrecision,
    }),
    unit,
    valuePrecision: input.input.valuePrecision,
  };
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & { value: number };
function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue { return typeof row.value === "number" && Number.isFinite(row.value) }
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
function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) return false;
  return now.getTime() - observed.getTime() > days * ISO_DAY_MS;
}
