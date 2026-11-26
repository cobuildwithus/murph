import { metricInfo, metricNames } from "./metrics";
import { isDate, median } from "./shared";
import type { DailySample, Metric } from "./types";

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

  if (!rule.physiological || selected.length === 0) return selected;
  const values = selected.map(point => point.value);
  const center = median(values);
  const cutoff = 6 * median(values.map(value => Math.abs(value - center)));
  return selected.filter(point => Math.abs(point.value - center) <= cutoff);
}

/** Pick one whole-day observation per metric before estimating its dispersion. */
export function cleanDaily(rows: readonly DailySample[], today: string): DailySample[] {
  if (!isDate(today)) return [];
  return metricNames.flatMap(metric => cleanMetric(rows, today, metric));
}
