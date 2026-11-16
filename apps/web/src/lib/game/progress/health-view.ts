import { addDaysToIsoDate } from "@murphai/contracts";
import type { CompanionHealthSeries, RawHealthPoint } from "../../device-sync/companion-numbers";
import type { Amount, Health, HealthMetric, Measure } from "./contract";
import type { StoredAward } from "./awards";
import { HEALTH_RECS, healthMean14 } from "./health";
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
  const who = profile.sex === "female" ? "women" : "men";
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
      const title = age ? `Beat ${share}` : metric.id === "restingHeartRate" ? `Down ${amount}`
        : metric.id === "steps" ? `${amount.toLocaleString("en-US")} more`
        : `Up ${metric.id === "sleep" ? `${amount / 60} min` : amount}`;
      const text = age ? share : `${metric.id === "restingHeartRate" ? "↓" : "+"}${metric.id === "sleep" ? `${amount / 60}m`
        : metric.id === "steps" && amount >= 1000 ? `${amount / 1000}k` : amount}`;
      return { medalId: award.id, on: award.on, text: award.data.title as string,
        face: { delta: { icon: age ? "age" : metric.id === "restingHeartRate" ? "heart" : metric.id, text } },
        title, detail: age ? `${who} your age` : "" };
    }),
    next: target === null ? null : { title: metric.wins.length ? "Next" : "Next win", detail:
      `${direction === "worse" ? "Back to " : ""}${healthAmountText(metric.id, target, false)}` },
    age: healthAgeView(metric.id, metric.baseline, current, source, profile, joinedOn) };
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
    text: `${metric === "restingHeartRate" ? "Lower than" : metric === "steps" ? "More steps than" : "Higher than"} ${Math.round(percentile)} of 100 ${who} your age`,
    current: healthAmount(metric, current),
    typical: metric === "restingHeartRate" ? healthAmount(metric, rank.cuts.find(cut => cut.percentile === 50)!.value) : null,
    previous: { percentile: agePercentile(metric, previous), amount: healthAmount(metric, baseline), on: joinedOn } };
}

function healthAmount(metric: HealthMetric["id"], value: number): Amount {
  const minutes = Math.round(value / 60);
  const text = metric === "sleep" ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`
    : value.toLocaleString("en-US", { maximumFractionDigits: metric === "vo2Max" ? 1 : 0 });
  return { value, text, unit: units[metric] };
}

function healthAmountText(metric: HealthMetric["id"], value: number, delta: boolean): string {
  if (metric === "sleep") {
    const minutes = Math.round(value / 60);
    return delta ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")} a night`;
  }
  const number = value.toLocaleString("en-US", { maximumFractionDigits: metric === "vo2Max" ? 1 : 0 });
  return metric === "restingHeartRate" ? `${number} bpm` : metric === "steps" ? `${number} a day` : number;
}
