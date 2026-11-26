import { metricInfo, metricNames } from "./metrics";
import { dayNumber, isDate, median } from "./shared";
import type { DailySample, Metric } from "./types";

const OUTLIER_WINDOW_RADIUS_DAYS = 45;

export function canonicalProvider(provider: string): string {
  const key = provider.trim().toLowerCase().replace(/[-_ ]+/gu, " ");
  switch (key) {
    case "apple health":
    case "apple healthkit":
    case "apple health kit": return "apple";
    case "google health": return "google";
    default: return key;
  }
}

function providerRank(provider: string, priority: readonly string[]): number {
  const index = priority.indexOf(provider);
  return index < 0 ? priority.length : index;
}

function cleanMetric(rows: readonly DailySample[], today: string, metric: Metric): DailySample[] {
  const rule = metricInfo(metric);
  const days = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    if (row.metric !== metric || !isDate(row.date) || row.date > today) continue;
    if (!Number.isFinite(row.value) || row.value < rule.min || row.value > rule.max) continue;
    const provider = canonicalProvider(row.provider);
    if (!provider) continue;
    let sources = days.get(row.date);
    if (!sources) {
      sources = new Map();
      days.set(row.date, sources);
    }
    // Conflicting totals from a single source have no authoritative winner.
    const previous = sources.get(provider);
    sources.set(provider, previous === undefined || previous === row.value ? row.value : null);
  }

  const selected: DailySample[] = [];
  for (const date of [...days.keys()].sort()) {
    const sources = days.get(date)!;
    const providers = [...sources.keys()].sort((a, b) => providerRank(a, rule.priority) - providerRank(b, rule.priority)
      || (a < b ? -1 : a > b ? 1 : 0));
    for (const provider of providers) {
      const value = sources.get(provider);
      if (value == null) continue;
      selected.push({ metric, date, provider, value });
      break;
    }
  }

  if (!rule.physiological) return selected;
  const dates = selected.map(point => dayNumber(point.date));
  const values = selected.map(point => point.value);
  let start = 0;
  let end = 0;
  return selected.filter((point, index) => {
    const day = dates[index];
    while (dates[start] < day - OUTLIER_WINDOW_RADIUS_DAYS) start++;
    while (end < dates.length && dates[end] <= day + OUTLIER_WINDOW_RADIUS_DAYS) end++;
    const nearby = values.slice(start, end);
    const center = median(nearby);
    const cutoff = 6 * median(nearby.map(value => Math.abs(value - center)));
    return Math.abs(point.value - center) <= cutoff;
  });
}

/** Pick one whole-day observation per metric before estimating its dispersion. */
export function cleanDaily(rows: readonly DailySample[], today: string): DailySample[] {
  if (!isDate(today)) return [];
  return metricNames.flatMap(metric => cleanMetric(rows, today, metric));
}
