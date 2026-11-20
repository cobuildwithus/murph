import tables from "./age-norms.json";
import type { COMPANION_HEALTH_METRICS } from "../../device-sync/companion-numbers";

type Metric = keyof typeof COMPANION_HEALTH_METRICS;
export interface AgeProfile { age: number | null; sex: "female" | "male" | null }
export interface AgeRank {
  top: number | null;
  value: number;
  lower: number;
  upper: number;
  position: number;
  cuts: { percentile: number; value: number }[];
  group: string;
  source: string;
}

function heartRateMethod(source: string | null) {
  const device = source?.trim().toLowerCase();
  if (device === "apple watch") return "appleWatch";
  return ["whoop", "oura", "garmin"].includes(device ?? "") ? "sleep" : null;
}

/** A mean can use a device reference table only if every contributing day used that method. */
export function heartRateWindowSource(daily: readonly { date: string; source: string | null }[], from: string, to: string) {
  const points = daily.filter(point => point.date >= from && point.date <= to);
  const source = points[0]?.source ?? null;
  const method = heartRateMethod(source);
  return method && points.every(point => heartRateMethod(point.source) === method) ? source : null;
}

/** Port of iOS AgeRankEngine.rank, including its original-device requirement. */
export function rankAge(metric: Metric, value: number, profile: AgeProfile, source: string | null): AgeRank | null {
  if (metric === "sleep" || !Number.isFinite(value) || profile.age === null || profile.age < 18 || profile.sex === null) return null;
  const method = metric === "restingHeartRate" ? heartRateMethod(source) : null;
  if (metric === "restingHeartRate" && !method) return null;
  const matches = tables.filter(table => table.metric === metric && table.sex === profile.sex
    && table.ageFrom <= profile.age! && profile.age! <= table.ageTo
    && table.measured === (method === "sleep" ? "sleep" : undefined));
  if (matches.length !== 1 || !matches[0].source.trim()) return null;
  const table = matches[0];
  const cuts = publishedCuts(table);
  if (!cuts) return null;
  const lower = cuts[0].value, upper = cuts[cuts.length - 1].value;
  if (upper <= lower) return null;
  const top = [1, 5, 10, 25].find(tier => {
    const threshold = cuts.find(cut => cut.percentile === (metric === "restingHeartRate" ? tier : 100 - tier));
    return threshold !== undefined && (metric === "restingHeartRate" ? value <= threshold.value : value >= threshold.value);
  }) ?? null;
  const low = Math.min(lower, value), high = Math.max(upper, value);
  const people = profile.sex === "female" ? "Women" : "Men";
  return { top, value, lower: low, upper: high, position: (value - low) / (high - low), cuts,
    group: table.ageTo >= 100 ? `${people} ${table.ageFrom} and over` : `${people} ${table.ageFrom} to ${table.ageTo}`,
    source: table.source };
}

function publishedCuts(table: typeof tables[number]): AgeRank["cuts"] | null {
  const cuts = Object.entries(table.percentiles).map(([key, value]) => ({ percentile: Number(key), value }))
    .filter(cut => Number.isFinite(cut.percentile)).sort((a, b) => a.percentile - b.percentile);
  return cuts.length < 5 || !cuts.some(cut => cut.percentile === 50)
    || cuts.some((cut, index) => !Number.isFinite(cut.value) || index > 0 && cuts[index - 1].value > cut.value) ? null : cuts;
}

/** Interpolate only inside the published cutoffs; endpoints retain their published percentile. */
export function agePercentile(metric: Metric, rank: AgeRank): number {
  const { cuts, value } = rank;
  let percentile = cuts[0].percentile;
  for (let i = 1; i < cuts.length; i++) {
    const previous = cuts[i - 1], next = cuts[i];
    if (value >= next.value) { percentile = next.percentile; continue; }
    if (value > previous.value) percentile = previous.percentile
      + (next.percentile - previous.percentile) * (value - previous.value) / (next.value - previous.value);
    break;
  }
  return metric === "restingHeartRate" ? 100 - percentile : percentile;
}
