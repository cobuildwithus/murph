import type {
  BrowserVaultMetricDomain,
  BrowserVaultMetricRow,
  BrowserVaultQueryClient,
  BrowserVaultSourceHealthRow,
} from "./shared.ts";

export const BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA = "murph.browser-vault-biomarker-panel.v1";

export type BrowserVaultBiomarkerPanelStatus =
  | "ready"
  | "no_private_vault"
  | "no_data"
  | "insufficient_data"
  | "stale"
  | "unsupported"
  | "error";

export type BrowserVaultBiomarkerPanelWarningCode =
  | "LOW_SAMPLE_COUNT"
  | "MIXED_SOURCES"
  | "SOURCE_STALE";

export interface BrowserVaultBiomarkerMetricBinding {
  domain: BrowserVaultMetricDomain;
  label?: string | null;
  metric: string;
  preferred?: boolean | null;
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
  bindings: readonly BrowserVaultBiomarkerMetricBinding[];
  client: BrowserVaultQueryClient | null;
  generatedAt?: string;
  label: string;
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
  privacy: {
    containsPrivateHealthData: true;
    defaultShare: "private";
    shareRequiresExplicitAction: true;
  };
  schema: typeof BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA;
  sources: BrowserVaultBiomarkerPanelSource[];
  status: BrowserVaultBiomarkerPanelStatus;
  warnings: BrowserVaultBiomarkerPanelWarning[];
}

export interface BrowserVaultBiomarkerMetricPanel {
  binding: {
    domain: BrowserVaultMetricDomain;
    metric: string;
  };
  label: string;
  latest: {
    confidence: BrowserVaultMetricRow["confidence"];
    date: string;
    sourceLabel: string;
    unit: string | null;
    value: number;
  } | null;
  sampleCount: number;
  series: BrowserVaultBiomarkerSeriesPoint[];
  trend: BrowserVaultBiomarkerTrend | null;
  unit: string;
  valuePrecision: number;
}

export interface BrowserVaultBiomarkerSeriesPoint {
  confidence: BrowserVaultMetricRow["confidence"];
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

export interface BrowserVaultBiomarkerPanelWarning {
  code: BrowserVaultBiomarkerPanelWarningCode;
  message: string;
}

export interface BrowserVaultBiomarkerPanelEmptyState {
  body: string;
  title: string;
}

const DEFAULT_STALE_AFTER_DAYS = 7;
const ISO_DAY_MS = 24 * 60 * 60 * 1000;

export function selectBrowserVaultBiomarkerPanel(
  input: SelectBrowserVaultBiomarkerPanelInput,
): BrowserVaultBiomarkerPanel {
  const generatedAt = input.generatedAt ?? input.client?.replica.generatedAt ?? input.now ?? new Date().toISOString();
  const base = createBasePanel(input, generatedAt);

  if (!input.client) {
    return {
      ...base,
      emptyState: emptyStateForStatus("no_private_vault"),
      status: "no_private_vault",
    };
  }

  const primaryBinding = selectPrimaryBinding(input.bindings);
  if (!primaryBinding) {
    return {
      ...base,
      emptyState: {
        body: "This biomarker is public, but it does not have a private browser-vault metric binding yet.",
        title: "Private trend unavailable",
      },
      status: "unsupported",
    };
  }

  const primary = buildMetricPanel({
    binding: primaryBinding,
    input,
  });
  const context = input.bindings
    .filter((binding) => binding !== primaryBinding && isMetricBindingUsable(binding))
    .map((binding) => buildMetricPanel({ binding, input }))
    .filter((panel) => panel.sampleCount > 0);
  const sources = buildSources({
    domain: primaryBinding.domain,
    now: input.now ?? generatedAt,
    sourceHealthRows: input.client.replica.sourceHealthRows,
    staleAfterDays: input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
  });
  const warnings = buildWarnings({ context, primary, sources, trendDefaults: input.trendDefaults });

  if (primary.sampleCount === 0) {
    return {
      ...base,
      emptyState: {
        body: `No ${input.label} values were found in the current browser-vault snapshot.`,
        title: "No private values yet",
      },
      sources,
      status: "no_data",
      warnings,
    };
  }

  if (primary.sampleCount < input.trendDefaults.minimumPoints) {
    return {
      ...base,
      emptyState: {
        body: `Found ${primary.sampleCount} point${primary.sampleCount === 1 ? "" : "s"}. Murph waits for at least ${input.trendDefaults.minimumPoints} before summarizing a trend.`,
        title: "Not enough private data yet",
      },
      primary,
      sources,
      status: "insufficient_data",
      warnings,
    };
  }

  const stale = isPrimarySeriesStale({
    now: input.now ?? generatedAt,
    primary,
    staleAfterDays: input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
  });

  return {
    ...base,
    context,
    primary,
    sources,
    status: stale ? "stale" : "ready",
    warnings: stale
      ? [
          ...warnings,
          {
            code: "SOURCE_STALE",
            message: `Latest ${input.label} value is older than ${input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS} days.`,
          },
        ]
      : warnings,
  };
}

function createBasePanel(
  input: SelectBrowserVaultBiomarkerPanelInput,
  generatedAt: string,
): BrowserVaultBiomarkerPanel {
  return {
    biomarkerKey: input.biomarkerKey,
    context: [],
    generatedAt,
    primary: null,
    privacy: {
      containsPrivateHealthData: true,
      defaultShare: "private",
      shareRequiresExplicitAction: true,
    },
    schema: BROWSER_VAULT_BIOMARKER_PANEL_SCHEMA,
    sources: [],
    status: "error",
    warnings: [],
  };
}

function selectPrimaryBinding(
  bindings: readonly BrowserVaultBiomarkerMetricBinding[],
): BrowserVaultBiomarkerMetricBinding | null {
  return bindings.find((binding) => binding.preferred && isMetricBindingUsable(binding))
    ?? bindings.find((binding) => binding.role === "primary" && isMetricBindingUsable(binding))
    ?? bindings.find(isMetricBindingUsable)
    ?? null;
}

function isMetricBindingUsable(binding: BrowserVaultBiomarkerMetricBinding): boolean {
  return binding.metric.trim().length > 0;
}

function buildMetricPanel(input: {
  binding: BrowserVaultBiomarkerMetricBinding;
  input: SelectBrowserVaultBiomarkerPanelInput;
}): BrowserVaultBiomarkerMetricPanel {
  const rows = input.input.client?.metrics
    .series({ domain: input.binding.domain, metric: input.binding.metric })
    .filter(hasNumericMetricValue)
    .sort((left, right) => left.date.localeCompare(right.date)) ?? [];
  const latest = rows.at(-1) ?? null;
  const unit = input.binding.unit ?? latest?.unit ?? input.input.unit;

  return {
    binding: {
      domain: input.binding.domain,
      metric: input.binding.metric,
    },
    label: input.binding.label ?? input.input.label,
    latest: latest
      ? {
          confidence: latest.confidence,
          date: latest.date,
          sourceLabel: latest.sourceKind ?? latest.sourceFamily ?? "wearable summary",
          unit: latest.unit,
          value: latest.value,
        }
      : null,
    sampleCount: rows.length,
    series: rows.map((row) => ({
      confidence: row.confidence,
      date: row.date,
      unit: row.unit,
      value: row.value,
    })),
    trend: buildTrend(rows, input.input.trendDefaults, input.input.unit, input.input.valuePrecision),
    unit,
    valuePrecision: input.input.valuePrecision,
  };
}

function buildTrend(
  rows: readonly BrowserVaultMetricRowWithValue[],
  trendDefaults: BrowserVaultBiomarkerTrendDefaults,
  unit: string,
  valuePrecision: number,
): BrowserVaultBiomarkerTrend | null {
  const latest = rows.at(-1);
  if (!latest) {
    return null;
  }

  const currentStart = subtractIsoDays(latest.date, trendDefaults.latestWindowDays - 1);
  const baselineStart = subtractIsoDays(currentStart, trendDefaults.comparisonWindowDays);
  const currentRows = rows.filter((row) => row.date >= currentStart && row.date <= latest.date);
  const baselineRows = rows.filter((row) => row.date >= baselineStart && row.date < currentStart);

  if (currentRows.length === 0 || baselineRows.length < trendDefaults.minimumPoints) {
    return null;
  }

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
    direction: Math.abs(directionDelta) <= flatThreshold + 1e-9
      ? "flat"
      : directionDelta < 0
        ? "down"
        : "up",
    label: `${trendDefaults.latestWindowDays}-day ${trendDefaults.aggregation} vs prior ${trendDefaults.comparisonWindowDays} days`,
    latestWindowDays: trendDefaults.latestWindowDays,
  };
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & {
  value: number;
};

function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue {
  return typeof row.value === "number" && Number.isFinite(row.value);
}

function aggregateMetricRows(
  rows: readonly BrowserVaultMetricRowWithValue[],
  aggregation: BrowserVaultBiomarkerTrendDefaults["aggregation"],
): number {
  const values = rows.map((row) => row.value);

  if (aggregation === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
  }

  return sorted[midpoint] ?? 0;
}

function buildSources(input: {
  domain: BrowserVaultMetricDomain;
  now: string;
  sourceHealthRows: readonly BrowserVaultSourceHealthRow[];
  staleAfterDays: number;
}): BrowserVaultBiomarkerPanelSource[] {
  return input.sourceHealthRows
    .filter((source) => sourceHasDomain(source, input.domain))
    .map((source) => ({
      displayName: source.providerDisplayName,
      freshness: source.latestRecordedAt
        ? isOlderThanDays(source.latestRecordedAt, input.now, input.staleAfterDays)
          ? "stale"
          : "fresh"
        : "never_synced",
      latestRecordedAt: source.latestRecordedAt,
    }));
}

function sourceHasDomain(source: BrowserVaultSourceHealthRow, domain: BrowserVaultMetricDomain): boolean {
  if (domain === "activity") {
    return source.activityDays > 0;
  }
  if (domain === "body_state") {
    return source.bodyStateDays > 0;
  }
  if (domain === "recovery") {
    return source.recoveryDays > 0;
  }
  return source.sleepNights > 0;
}

function buildWarnings(input: {
  context: readonly BrowserVaultBiomarkerMetricPanel[];
  primary: BrowserVaultBiomarkerMetricPanel;
  sources: readonly BrowserVaultBiomarkerPanelSource[];
  trendDefaults: BrowserVaultBiomarkerTrendDefaults;
}): BrowserVaultBiomarkerPanelWarning[] {
  const warnings: BrowserVaultBiomarkerPanelWarning[] = [];

  if (
    input.primary.sampleCount > 0
    && input.primary.sampleCount < input.trendDefaults.minimumPoints
  ) {
    warnings.push({
      code: "LOW_SAMPLE_COUNT",
      message: `Only ${input.primary.sampleCount} private value${input.primary.sampleCount === 1 ? "" : "s"} found.`,
    });
  }

  if (input.sources.length > 1) {
    warnings.push({
      code: "MIXED_SOURCES",
      message: "Multiple source summaries are present; query selection has already resolved the displayed value.",
    });
  }

  if (input.sources.some((source) => source.freshness === "stale")) {
    warnings.push({
      code: "SOURCE_STALE",
      message: "At least one source is stale relative to the selected window.",
    });
  }

  return warnings;
}

function isPrimarySeriesStale(input: {
  now: string;
  primary: BrowserVaultBiomarkerMetricPanel;
  staleAfterDays: number;
}): boolean {
  const latestDate = input.primary.latest?.date;
  return latestDate ? isOlderThanDays(latestDate, input.now, input.staleAfterDays) : false;
}

function emptyStateForStatus(
  status: BrowserVaultBiomarkerPanelStatus,
): BrowserVaultBiomarkerPanelEmptyState {
  return {
    body: "Sync a browser-vault replica to see your own trend here. Nothing from this card is public.",
    title: "Private trend unavailable",
  };
}

function roundMetricValue(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function nearFlatThresholdForUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();

  if (normalized === "bpm") {
    return 0.5;
  }

  if (normalized === "ml/kg/min") {
    return 0.1;
  }

  if (isPercentageUnit(unit)) {
    return 0.5;
  }

  if (normalized === "minutes") {
    return 1;
  }

  return 0.01;
}

function isPercentageUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase();
  return normalized === "%" || normalized === "percent" || normalized.includes("percentage");
}

function subtractIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);

  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) {
    return false;
  }

  return now.getTime() - observed.getTime() > days * ISO_DAY_MS;
}
