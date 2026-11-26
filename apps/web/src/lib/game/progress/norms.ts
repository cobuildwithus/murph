import tables from "./age-norms.json";
import labTables from "./lab-norms.json";
import type { COMPANION_HEALTH_METRICS } from "../../device-sync/companion-numbers";

export type LabNormMetric = "hdlCholesterol" | "triglycerides" | "ldlCholesterol" | "totalCholesterol"
  | "hsCrp" | "fastingInsulin" | "hba1c";
type Metric = keyof typeof COMPANION_HEALTH_METRICS | LabNormMetric;
type Direction = "lower" | "higher";
const wearableDirection: Partial<Record<Metric, Direction>> = {
  restingHeartRate: "lower", steps: "higher", vo2Max: "higher",
};
export interface NormRow {
  metric: string;
  sex: string;
  ageFrom: number;
  ageTo: number;
  measured?: string;
  source: string;
  percentiles: Readonly<Record<string, number | undefined>>;
  unit?: string;
  betterDirection?: string;
}
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
  betterDirection?: Direction;
  unit?: string;
}

export function heartRateMethod(source: string | null) {
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

function referenceRow(metric: Metric, { age, sex }: AgeProfile, source: string | null, rows?: readonly NormRow[]): NormRow | null {
  if (metric === "sleep") return null;
  const method = metric === "restingHeartRate" ? heartRateMethod(source) : null;
  if (metric === "restingHeartRate" && !method) return null;
  if (age === null || age < 18 || sex === null) return null;
  const reference: readonly NormRow[] = rows ?? (wearableDirection[metric] ? tables : labTables);
  const measured = method === "sleep" ? "sleep" : undefined;
  const matches = reference.filter(table => table.metric === metric && table.sex === sex
    && table.ageFrom <= age && age <= table.ageTo
    && table.measured === measured);
  return matches.length === 1 && matches[0].source.trim() ? matches[0] : null;
}

/** Rank a canonical-unit value in its demographic and measurement stratum. */
export function rankAge(metric: Metric, value: number, profile: AgeProfile, source: string | null, rows?: readonly NormRow[]): AgeRank | null {
  if (!Number.isFinite(value)) return null;
  const table = referenceRow(metric, profile, source, rows);
  if (!table) return null;
  const direction = table.betterDirection ?? wearableDirection[metric];
  if (direction !== "higher" && direction !== "lower") return null;
  const lowerIsBetter = direction === "lower";
  const published = publishedCuts(table);
  if (!published) return null;
  // The outer NHANES lab cuts can rest on as few as one to three people in a stratum.
  const cuts = wearableDirection[metric] ? published : published.filter(cut => cut.percentile >= 5 && cut.percentile <= 95);
  const lower = cuts[0].value, upper = cuts[cuts.length - 1].value;
  if (upper <= lower) return null;
  const top = [1, 5, 10, 25].find(tier => {
    const threshold = cuts.find(cut => cut.percentile === (lowerIsBetter ? tier : 100 - tier));
    return threshold !== undefined && (lowerIsBetter ? value <= threshold.value : value >= threshold.value);
  }) ?? null;
  const low = Math.min(lower, value), high = Math.max(upper, value);
  const people = table.sex === "female" ? "Women" : "Men";
  return { top, value, lower: low, upper: high, position: (value - low) / (high - low), cuts,
    group: table.ageTo >= 100 ? `${people} ${table.ageFrom} and over` : `${people} ${table.ageFrom} to ${table.ageTo}`,
    ...(table.betterDirection && { betterDirection: direction }), ...(table.unit && { unit: table.unit }),
    source: table.source };
}

function publishedCuts(table: NormRow): AgeRank["cuts"] | null {
  const cuts = Object.entries(table.percentiles).flatMap(([key, value]) =>
    value === undefined ? [] : [{ percentile: Number(key), value }]).sort((a, b) => a.percentile - b.percentile);
  return cuts.length < 5 || !cuts.some(cut => cut.percentile === 50)
    || cuts.some((cut, index) => !Number.isFinite(cut.percentile) || cut.percentile < 0 || cut.percentile > 100
      || !Number.isFinite(cut.value) || index > 0 && cuts[index - 1].value > cut.value) ? null : cuts;
}

export function rankLowerIsBetter(metric: Metric, rank: AgeRank): boolean {
  return (rank.betterDirection ?? wearableDirection[metric]) === "lower";
}

/** For tied cutoffs, only claim the share the observation beats across the full tie. */
export function rankBetterShare(metric: Metric, rank: AgeRank): number {
  if (!rankLowerIsBetter(metric, rank)) {
    const firstEqual = rank.cuts.find(cut => cut.value === rank.value);
    if (firstEqual) return firstEqual.percentile;
  }
  // Remove binary interpolation noise at whole-percent boundaries (e.g. 73.99999999999999).
  return Number(agePercentile(metric, rank).toPrecision(14));
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
  return rankLowerIsBetter(metric, rank) ? 100 - percentile : percentile;
}
