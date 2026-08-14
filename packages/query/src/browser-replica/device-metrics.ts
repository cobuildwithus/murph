import { resolveMetricDefinition } from "@murphai/health-metrics";

import {
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSeriesCapableQueryClient as BrowserVaultMetricsCapableQueryClient,
} from "./shared.ts";

/**
 * Provenance kinds produced by wearable/device pipelines. Manual entries
 * ("observation", "measurement"), lab values ("test-result"), and any other
 * source never carry these kinds, so a summary derived through this filter
 * cannot present non-device data as a device reading.
 */
export const BROWSER_VAULT_DEVICE_METRIC_SOURCE_KINDS = Object.freeze([
  "activity-summary",
  "sleep-summary",
  "wearable-summary",
] as const);

const DEVICE_SOURCE_KINDS: ReadonlySet<string> = new Set(
  BROWSER_VAULT_DEVICE_METRIC_SOURCE_KINDS,
);

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BrowserVaultDeviceMetricSummary {
  firstDate: string;
  latest: {
    confidence: BrowserVaultMetricRow["confidence"];
    date: string;
    sourceLabel: string | null;
    unit: string | null;
    value: number;
  };
  metricKey: string;
  readingCount: number;
  stale: boolean;
}

/**
 * Device-only projection for one metric: the same wearable-derived row set
 * decides inclusion, the latest value, the reading count, the history span,
 * and staleness. Returns null when no device-derived reading exists.
 */
export function selectBrowserVaultDeviceMetricSummary(
  client: BrowserVaultMetricsCapableQueryClient,
  metricKey: string,
): BrowserVaultDeviceMetricSummary | null {
  const rows = client.metrics.series({ metricKey })
    .filter((row): row is BrowserVaultMetricRow & { value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value)
    )
    .filter((row) => row.sourceKind !== null && DEVICE_SOURCE_KINDS.has(row.sourceKind))
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = rows.at(-1);
  const first = rows[0];
  if (!latest || !first) {
    return null;
  }

  return {
    firstDate: first.date,
    latest: {
      confidence: latest.confidence,
      date: latest.date,
      sourceLabel: latest.sourceLabel,
      unit: latest.unit,
      value: latest.value,
    },
    metricKey,
    readingCount: rows.length,
    stale: isStaleDeviceReading(metricKey, latest.date, client.replica.generatedAt),
  };
}

/**
 * Freshness policy stays owned by the metric catalog: the threshold comes from
 * the metric definition's selection policy (14 days for daily recovery
 * metrics, 45 for estimated VO2 max, none for metrics without a policy), and
 * the age comparison mirrors the catalog's calendar-day semantics. Only the
 * evaluated date is device-scoped.
 */
function isStaleDeviceReading(
  metricKey: string,
  latestDate: string,
  generatedAt: string,
): boolean {
  const staleAfterDays = resolveMetricDefinition(metricKey)?.selectionPolicy.staleAfterDays;
  if (staleAfterDays === undefined) {
    return false;
  }

  const latest = Date.parse(`${latestDate.slice(0, 10)}T00:00:00.000Z`);
  const generated = Date.parse(`${generatedAt.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(latest) || !Number.isFinite(generated)) {
    return false;
  }

  return Math.floor((generated - latest) / MILLISECONDS_PER_DAY) > staleAfterDays;
}
