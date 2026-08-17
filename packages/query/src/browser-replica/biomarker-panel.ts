import {
  normalizeMetricKey,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricTrend,
  type MetricConfidence,
  type MetricTrend,
} from "@murphai/health-metrics";
import type {
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
  BrowserVaultMetricSeriesCapableQueryClient as BrowserVaultMetricsCapableQueryClient,
} from "./shared.ts";
import { browserMetricRowToSeriesPoint } from "./metric-points.ts";

export const BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA = "murph.browser-vault-biomarker-panel";

export type BrowserVaultBiomarkerPanelStatus =
  | "ready"
  | "no_private_vault"
  | "no_data"
  | "missing_selection"
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
  biomarkerKey?: string | null;
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
  client: BrowserVaultMetricsCapableQueryClient | null;
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
  selection: BrowserVaultMetricSelectionRow | null;
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
  const selectionStatus = primary.selection?.status ?? "no_data";

  if (selectionStatus === "unsupported") {
    return {
      ...base,
      emptyState: { body: "Private tracking for this biomarker is not available yet.", title: "Biomarker unavailable" },
      primary,
      status: "unsupported",
      warnings,
    };
  }

  if (selectionStatus === "insufficient_data") {
    return {
      ...base,
      emptyState: { body: `Found ${primary.sampleCount} point${primary.sampleCount === 1 ? "" : "s"}. Murph waits for enough data before selecting a current value.`, title: "Not enough private data yet" },
      primary,
      status: "insufficient_data",
      warnings,
    };
  }

  if (selectionStatus === "no_data" || !primary.latest) {
    if (primary.sampleCount > 0) {
      return {
        ...base,
        context,
        emptyState: {
          body: `${input.label} has trend history, but no current value is available yet.`,
          title: "No current value yet",
        },
        primary,
        status: "missing_selection",
        warnings,
      };
    }

    return { ...base, emptyState: { body: `No ${input.label} values saved on this device yet.`, title: "No private values yet" }, status: "no_data", warnings };
  }

  return {
    ...base,
    context,
    primary,
    status: selectionStatus === "stale" ? "stale" : "ready",
    warnings,
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
  const selection = selectMetricSelectionForPanel(input);
  const definition = resolveMetricDefinition(input.metricKey);
  const unit = selection?.unit ?? latest?.unit ?? input.binding.unit ?? input.input.unit;
  const trendPoints = rows.map(browserMetricRowToSeriesPoint);
  return {
    binding: { metricKey: input.metricKey },
    label: input.binding.label ?? definition?.displayName ?? input.input.label,
    latest: metricSelectionToLatest(selection),
    sampleCount: rows.length,
    selection,
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

function selectMetricSelectionForPanel(input: {
  binding: BrowserVaultBiomarkerMetricBinding;
  metricKey: string;
  input: SelectBrowserVaultBiomarkerPanelInput;
}): BrowserVaultMetricSelectionRow | null {
  const client = input.input.client;
  if (!client) return null;

  const normalizedMetricKey = resolveMetricDefinition(input.metricKey)?.key ?? normalizeMetricKey(input.metricKey);
  const biomarkerKey = input.binding.biomarkerKey
    ?? (input.binding.role === "primary" || input.binding.role === undefined || input.binding.role === null ? input.input.biomarkerKey : null);

  if (biomarkerKey) {
    const byBiomarker = client.metricSelections.getByBiomarker(biomarkerKey);
    if (byBiomarker && byBiomarker.metricKey === normalizedMetricKey) return byBiomarker;

    const scoped = client.metricSelections.list({ metricKey: normalizedMetricKey, biomarkerKey }).at(0) ?? null;
    if (scoped) return scoped;
  }

  return client.metricSelections.get(normalizedMetricKey);
}

function metricSelectionToLatest(
  selection: BrowserVaultMetricSelectionRow | null,
): BrowserVaultBiomarkerMetricPanel["latest"] {
  if (!selection || (selection.status !== "ready" && selection.status !== "stale")) return null;
  if (typeof selection.value !== "number" || !Number.isFinite(selection.value)) return null;
  const date = selection.effectiveDate ?? selection.observedAt?.slice(0, 10) ?? null;
  if (!date) return null;
  return {
    confidence: selection.confidence,
    date,
    sourceLabel: selection.sourceLabel ?? "metric",
    unit: selection.unit,
    value: selection.value,
  };
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & { value: number };
function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue { return typeof row.value === "number" && Number.isFinite(row.value) }
function buildWarnings(input: { primary: BrowserVaultBiomarkerMetricPanel; trendDefaults: BrowserVaultBiomarkerTrendDefaults }): BrowserVaultBiomarkerPanelWarning[] {
  const warnings: BrowserVaultBiomarkerPanelWarning[] = input.primary.selection?.warnings.map((warning) => ({ code: warning.code, message: warning.message })) ?? [];
  if (input.primary.sampleCount > 0 && input.primary.sampleCount < input.trendDefaults.minimumPoints) warnings.push({ code: "LOW_SAMPLE_COUNT", message: `Only ${input.primary.sampleCount} private value${input.primary.sampleCount === 1 ? "" : "s"} found.` });
  return warnings;
}
function emptyStateForStatus(_status: BrowserVaultBiomarkerPanelStatus): BrowserVaultBiomarkerPanelEmptyState {
  return { body: "Connect a health device or import labs to see your personal trend here. Your data stays private.", title: "Biomarker unavailable" };
}
