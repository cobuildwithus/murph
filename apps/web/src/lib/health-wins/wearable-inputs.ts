import { addDaysToIsoDate } from "@murphai/contracts";
import { normalizeMetricValue, resolveWearableProviderDescriptor } from "@murphai/health-metrics";
import type { BrowserVaultMetricRow, BrowserVaultMetricSeriesCapableQueryClient } from "@murphai/query/browser-replica-client";
import { COMPANION_HEALTH_METRICS } from "../device-sync/companion-numbers";
import { heartRateWindowSource } from "../game/progress/norms";
import { canonicalProvider, metricInfo, type DailySample, type Metric } from "./engine";

export const WIN_METRIC_KEYS: Record<Metric, string> = {
  sleep_total_min: COMPANION_HEALTH_METRICS.sleep.key,
  sleep_deep_min: "deep-sleep-minutes",
  sleep_score: "sleep-score",
  sleep_efficiency: "sleep-efficiency",
  rhr_bpm: COMPANION_HEALTH_METRICS.restingHeartRate.key,
  hrv_ms: "hrv-rmssd",
  steps: COMPANION_HEALTH_METRICS.steps.key,
  distance_km: "distance-km",
  floors: "floors-climbed",
  vo2max: COMPANION_HEALTH_METRICS.vo2Max.key,
};

interface MetricSource {
  provider: string;
  method: string;
  days: Map<string, number | null>;
}

function recordDay(group: MetricSource, date: string, value: number) {
  const previous = group.days.get(date);
  group.days.set(date, previous === undefined || previous === value ? value : null);
}

function isOnFootDistance(provider: string, row: BrowserVaultMetricRow): boolean {
  // Apple's daily distance counts walking and running. Workout rollups may also count rides or swims.
  if (provider !== "apple" && provider !== "apple watch") return false;
  return row.context.sourceKind !== "activity-session-aggregate" && row.context.sourceKind !== "activity-session-day-rollup";
}

/** Pick a single comparable provider and measurement method across the retained history.
 * Two conflicting observations for a single provider/method/day cannot establish a daily value. */
export function retainedDailySamples(metric: Metric, rows: BrowserVaultMetricRow[]): DailySample[] {
  const { min, max, priority } = metricInfo(metric);
  const groups = new Map<string, MetricSource>();
  for (const row of rows) {
    if (row.statistic !== "value" || row.comparator != null || row.context.sleepType === "nap" || !row.sourceLabel || !row.unit) continue;
    const provider = canonicalProvider(row.sourceLabel);
    if (!priority.includes(provider) && !resolveWearableProviderDescriptor(provider)) continue;
    if (metric === "distance_km" && !isOnFootDistance(provider, row)) continue;
    const value = normalizeMetricValue({ metricKey: row.metricKey, unit: row.unit, value: row.value }).canonicalValue;
    if (value === null || !Number.isFinite(value) || value < min || value > max) continue;
    const method = typeof row.context.measurementMethodKey === "string" ? row.context.measurementMethodKey : "";
    const key = JSON.stringify([provider, method]);
    let group = groups.get(key);
    if (!group) {
      group = { provider, method, days: new Map() };
      groups.set(key, group);
    }
    recordDay(group, row.date, value);
  }
  const rank = (provider: string) => priority.includes(provider) ? priority.indexOf(provider) : priority.length;
  const usable = [...groups.values()].map(group => ({
    ...group, coverage: [...group.days.values()].filter(value => value !== null).length,
  })).filter(group => group.coverage > 0);
  const [winner] = usable.sort((a, b) => rank(a.provider) - rank(b.provider)
    || b.coverage - a.coverage || a.provider.localeCompare(b.provider) || a.method.localeCompare(b.method));
  if (!winner) return [];
  return [...winner.days].flatMap(([date, value]) => value === null ? [] : [{ metric, provider: winner.provider, value, date }]);
}

export function readHealthWinWearables(
  client: BrowserVaultMetricSeriesCapableQueryClient, today: string, stepsThrough: string,
  metrics?: readonly Metric[],
) {
  let complete = true;
  let observed = false;
  const from = addDaysToIsoDate(today, -364);
  const requested = metrics ?? Object.keys(WIN_METRIC_KEYS) as Metric[];
  const daily = requested.flatMap(metric => {
    try {
      // An unsettled step day counts as observed in See yours, but cannot supply a detector value.
      const to = metric === "steps" && !metrics ? stepsThrough : today;
      const rows = client.metrics.series({
        metricKey: WIN_METRIC_KEYS[metric], from, to, grain: "day",
      });
      observed ||= rows.length > 0;
      return retainedDailySamples(metric, metric === "steps" ? rows.filter(row => row.date <= stepsThrough) : rows);
    } catch {
      // A missing bucket for one measure does not erase the other measures.
      complete = false;
      return [];
    }
  });
  const wearableProvider = heartRateWindowSource(
    daily.filter(row => row.metric === "rhr_bpm").map(row => ({ date: row.date, source: row.provider })),
    from, today,
  );
  return { daily, wearableProvider, complete, observed };
}
