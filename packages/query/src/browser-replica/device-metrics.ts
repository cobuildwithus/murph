import { type BrowserVaultMetricRow, type BrowserVaultQueryClient } from "./shared.ts";

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

// Matches the biomarker panel's freshness window so "Out of date" means the
// same thing on every private surface.
const DEVICE_METRIC_STALE_AFTER_DAYS = 7;
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
  client: BrowserVaultQueryClient,
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
    stale: isStaleDeviceReading(latest.date, client.replica.generatedAt),
  };
}

function isStaleDeviceReading(latestDate: string, generatedAt: string): boolean {
  const latest = Date.parse(`${latestDate}T00:00:00.000Z`);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(latest) || !Number.isFinite(generated)) {
    return false;
  }

  return (generated - latest) / MILLISECONDS_PER_DAY > DEVICE_METRIC_STALE_AFTER_DAYS;
}
