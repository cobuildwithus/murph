import { addDaysToIsoDate } from "@murphai/contracts";
import type { CompanionHealthSeries, RawHealthPoint } from "../../device-sync/companion-numbers";
import type { Amount, Health, HealthMetric, Measure, SavedHealth } from "./contract";
import type { StoredAward } from "./awards";
import { HEALTH_RECS, healthAgeTitle, healthMean14, healthMedalFace, healthWinText } from "./health";
import { formatAmount, formatNumber } from "./format";
import { rankAge, agePercentile, type AgeProfile } from "./norms";

export interface HealthMetricInput {
  id: HealthMetric["id"];
  daily: RawHealthPoint[];
  baseline: number | null;
  step: number;
  direction: number;
  wins: StoredAward[];
}
const labels = { restingHeartRate: "Resting HR", steps: "Steps", sleep: "Sleep", vo2Max: "VO2 max" } as const;
const units = { restingHeartRate: "bpm", steps: "steps", sleep: "seconds", vo2Max: "mL/kg/min" } as const;

export function healthView(input: {
  joinedOn: string; today: string; snapshot: CompanionHealthSeries | null;
  profile: AgeProfile; metrics: HealthMetricInput[]; sums: Measure[];
}): Health {
  const from = addDaysToIsoDate(input.today, -6);
  const recent = new Set(input.metrics.filter(metric => metric.daily.some(point => point.date >= from && point.date <= input.today)).map(metric => metric.id));
  const wearable = recent.has("restingHeartRate") || recent.has("vo2Max");
  const metrics = input.metrics.map((metric): HealthMetric => ({
    ...healthMetricView(metric, input.joinedOn, input.today, input.profile),
    access: recent.has(metric.id) ? "ok" : wearable && metric.id !== "steps" ? "off"
      : metric.daily.length ? "ok" : "missing",
  }));
  const available = input.metrics.filter(metric => metric.daily.length > 0);
  const winCount = input.metrics.reduce((sum, metric) => sum + metric.wins.length, 0);
  if (!input.snapshot && winCount === 0) return { joinedOn: input.joinedOn, today: input.today,
    state: "notConnected", savedAt: null, winCount: 0, metrics: [], sums: [], recs: [] };
  const state: Health["state"] = !input.snapshot ? "notConnected"
    : input.snapshot.freshness === "stale" ? "stale"
    : available.length === 1 && available[0].id === "steps" ? "noWearable"
    : input.joinedOn === input.today && winCount === 0 ? "connectedToday" : "ok";
  return { joinedOn: input.joinedOn, today: input.today, state, savedAt: input.snapshot?.savedAt ?? null,
    winCount, metrics, sums: input.sums,
    recs: metrics.flatMap((metric, index) => metric.baseline !== null
      && healthMean14(metric.id, input.metrics[index].daily, input.today) !== null && metric.direction !== "better" ? HEALTH_RECS[metric.id] : []) };
}

export function healthMetricView(metric: HealthMetricInput, joinedOn: string, today: string, profile: AgeProfile): HealthMetric {
  const current = healthMean14(metric.id, metric.daily, today);
  const change = current !== null && metric.baseline !== null ? current - metric.baseline : null;
  const direction = change === null || change === 0 ? "flat" : change * metric.direction > 0 ? "better" : "worse";
  const highest = Math.max(0, ...metric.wins.filter(award => award.kind === "health").map(award => award.data.level as number));
  const target = metric.baseline === null ? null : metric.baseline + metric.direction * (highest + 1) * metric.step;
  const source = metric.daily.at(-1)?.source ?? null;
  const daily: HealthMetric["daily"] = [];
  const values = new Map(metric.daily.map(point => [point.date, point.value]));
  // Preserve gaps explicitly for the chart, within the replica's one-year window.
  const from = [addDaysToIsoDate(joinedOn, -28), addDaysToIsoDate(today, -364)].sort().at(-1)!;
  for (let day = from; day <= today; day = addDaysToIsoDate(day, 1)) {
    daily.push([day, values.get(day) ?? null]);
  }
  return { id: metric.id, label: labels[metric.id], unit: units[metric.id],
    access: metric.daily.length ? "ok" : "missing", direction,
    headline: healthHeadline(metric.id, change),
    daily, baseline: metric.baseline === null ? null : healthAmount(metric.id, metric.baseline),
    wins: metric.wins.map(award => {
      const amount = award.data.amount as number;
      const share = award.data.percentile === 50 ? "half" : award.data.percentile === 25 ? "1 in 4" : "1 in 3";
      const age = award.kind === "healthAge";
      const title = age ? healthAgeTitle(award.data.percentile as number) : metric.id === "restingHeartRate" ? `Down ${formatNumber(amount, "compact")}`
        : metric.id === "steps" ? `${formatNumber(amount, "compact")} more`
        : `Up ${metric.id === "sleep" ? `${formatNumber(amount / 60, "compact")} min` : formatNumber(amount, "compact", 1)}`;
      const detail = age ? award.data.detail as string : "";
      return { medalId: award.id, on: award.on, text: age ? `${title}${share === "half" ? " of" : ""} ${detail}` : healthWinText(metric.id, amount),
        face: age ? { delta: { icon: "age", text: share } } : healthMedalFace(metric.id, amount, award.data.value as number),
        title, detail };
    }),
    next: target === null ? null : { title: metric.wins.length ? "Next" : "Next win", detail:
      `${direction === "worse" ? "Back to " : ""}${healthAmountText(metric.id, target, false)}`,
      face: healthMedalFace(metric.id, (highest + 1) * metric.step, target) },
    age: healthAgeView(metric.id, metric.baseline, current, source, profile, joinedOn) };
}

export function savedHealthView(joinedOn: string, today: string, metrics: HealthMetricInput[]): SavedHealth {
  return { joinedOn, today, winCount: metrics.reduce((count, metric) => count + metric.wins.length, 0),
    metrics: metrics.map(metric => {
      const { id, label, unit, baseline, wins, next } = healthMetricView(metric, joinedOn, today, { age: null, sex: null });
      const held = metric.wins.filter(award => award.kind === "health")
        .sort((a, b) => (b.data.level as number) - (a.data.level as number))[0];
      return { id, label, unit, baseline, wins, next,
        headline: held ? healthHeadline(id, metric.direction * (held.data.amount as number)) : null };
    }) };
}

function healthHeadline(metric: HealthMetric["id"], change: number | null): string {
  return change === null ? "Not enough data yet" : change === 0 ? "No change yet"
    : `${change > 0 ? "Up" : "Down"} ${healthAmountText(metric, Math.abs(change), true)}`;
}

function healthAgeView(metric: HealthMetric["id"], baseline: number | null, current: number | null,
  source: string | null, profile: AgeProfile, joinedOn: string): HealthMetric["age"] {
  if (current === null || baseline === null) return null;
  const rank = rankAge(metric, current, profile, source), previous = rankAge(metric, baseline, profile, source);
  if (!rank || !previous) return null;
  const percentile = agePercentile(metric, rank), who = profile.sex === "female" ? "women" : "men";
  return { percentile,
    text: `${metric === "restingHeartRate" ? "Lower than" : metric === "steps" ? "More steps than" : "Higher than"} ${formatNumber(percentile, "compact")} of 100 ${who} your age`,
    current: healthAmount(metric, current),
    typical: healthAmount(metric, rank.cuts.find(cut => cut.percentile === 50)!.value),
    previous: { percentile: agePercentile(metric, previous), amount: healthAmount(metric, baseline), on: joinedOn } };
}

function healthAmount(metric: HealthMetric["id"], value: number): Amount {
  return formatAmount(value, units[metric], metric === "sleep" ? "clock" : "compact");
}

function healthAmountText(metric: HealthMetric["id"], value: number, delta: boolean): string {
  if (metric === "sleep") {
    return delta ? `${formatNumber(value / 60, "compact")} min` : healthAmount(metric, value).text;
  }
  const number = healthAmount(metric, value).text;
  return metric === "restingHeartRate" ? `${number} bpm` : metric === "steps" ? `${number} a day` : number;
}
