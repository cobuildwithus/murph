import { addDaysToIsoDate } from "@murphai/contracts";
import type { RawHealthPoint } from "../../device-sync/companion-numbers";
import type { HealthMetric, MedalFace, Rec } from "./contract";
import { formatNumber } from "./format";
import type { Candidate, DayAmount } from "./registry";
import { agePercentile, rankAge, type AgeProfile } from "./norms";

export type HealthDay = Pick<RawHealthPoint, "date" | "value">;

/** The replica normalizes sleep to minutes. Progress uses seconds everywhere below here. */
export function progressHealthDays(metric: HealthMetric["id"], daily: readonly RawHealthPoint[]): RawHealthPoint[] {
  return daily.map(point => ({ ...point, value: metric === "sleep" ? point.value * 60 : point.value }));
}

/** Sums use only the retained, observed dates since joining, never invented zero days. */
export function healthSums(metric: "steps" | "sleep", daily: readonly HealthDay[], joinedOn: string, today: string): DayAmount[] {
  const from = [joinedOn, addDaysToIsoDate(today, -364)].sort().at(-1)!;
  return daily.filter(point => point.date >= from && point.date <= today)
    .map(point => ({ measureId: metric, date: point.date, amount: point.value }));
}

export const HEALTH_RECS: Record<HealthMetric["id"], Rec[]> = {
  restingHeartRate: [
    { id: "cardio", metric: "restingHeartRate", title: "Start a cardio game", detail: "Make time to move",
      task: "30 min of cardio every day", category: "move", icon: "heart" },
  ],
  steps: [
    { id: "after-dinner", metric: "steps", title: "Walk after dinner", detail: "20 min is about 2,000 steps",
      task: "Walk 20 min after dinner every day", category: "move", icon: "walk" },
    { id: "stairs", metric: "steps", title: "Take the stairs", detail: "Every time, all week",
      task: "Take the stairs every day", category: "move", icon: "stairs" },
    { id: "walk-calls", metric: "steps", title: "Walk your calls", detail: "Take one call a day on foot",
      task: "Take one call on foot every day", category: "move", icon: "phone" },
  ],
  sleep: [
    { id: "lights-out", metric: "sleep", title: "Lights out by 11", detail: "Make room for sleep",
      task: "Lights out by 11 every night", category: "calm", icon: "sleep" },
    { id: "no-phone", metric: "sleep", title: "No phone in bed", detail: "Also for sleep",
      task: "No phone in bed every night", category: "calm", icon: "phone" },
    { id: "morning-walk", metric: "sleep", title: "Morning walk", detail: "Daylight early helps sleep",
      task: "Walk 20 min every morning", category: "move", icon: "sun" },
  ],
};
export interface HealthAchievementContext {
  metric: HealthMetric["id"];
  joinedOn: string;
  baseline: number;
  means: RawHealthPoint[];
  profile: AgeProfile;
  step: number;
  direction: number;
}

export function healthSteps(context: HealthAchievementContext): Candidate[] {
  const { metric, baseline, step, direction, joinedOn } = context;
  const levels = heldHealthLevels(context.means.map(point => ({ date: point.date,
    value: Math.floor((point.value - baseline) * direction / step) })), joinedOn);
  const candidates: Candidate[] = [];
  let best = 0;
  for (const point of levels) {
    for (let level = best + 1; level <= point.value; level++) {
      candidates.push({ key: `health:${metric}:${level}`, kind: "health", measureId: metric,
        subjectMemberId: null, on: point.date,
        data: { level, baseline, value: baseline + direction * level * step,
          title: healthWinText(metric, level * step), amount: level * step,
          face: healthMedalFace(metric, level * step),
          detail: "held a week", page: "health", evaluator: 1 } });
    }
    best = Math.max(best, point.value);
  }
  return candidates;
}

export function healthAgeShare(context: HealthAchievementContext): Candidate[] {
  if (context.metric === "sleep") return [];
  const candidates: Candidate[] = [];
  for (const threshold of [25, 100 / 3, 50]) {
    const levels = context.means.flatMap(point => {
      const baseline = rankAge(context.metric, context.baseline, context.profile, point.source);
      const current = rankAge(context.metric, point.value, context.profile, point.source);
      if (!baseline || !current) return [];
      return [{ date: point.date, value: agePercentile(context.metric, baseline) < threshold
        && agePercentile(context.metric, current) >= threshold ? 1 : 0 }];
    });
    const held = heldHealthLevels(levels, context.joinedOn).find(point => point.value === 1);
    if (held) candidates.push({ key: `healthAge:${context.metric}:${threshold}`, kind: "healthAge",
      measureId: context.metric, subjectMemberId: null, on: held.date,
      data: { percentile: threshold, face: { delta: { icon: "age", text: threshold === 50 ? "half" : threshold === 25 ? "1 in 4" : "1 in 3" } },
        detail: `${context.profile.sex === "female" ? "women" : "men"} your age`, page: "health", evaluator: 1,
        title: healthAgeTitle(threshold) } });
  }
  return candidates;
}

export function healthAgeTitle(percentile: number): string {
  return `Beat ${percentile === 50 ? "half" : percentile === 25 ? "1 in 4" : "1 in 3"}`;
}

export function healthWinText(metric: HealthMetric["id"], amount: number): string {
  switch (metric) {
    case "restingHeartRate": return `Resting HR down ${formatNumber(amount, "compact")} bpm`;
    case "steps": return `Steps up ${formatNumber(amount, "compact")} a day`;
    case "sleep": return `Sleep up ${formatNumber(amount / 60, "compact")} min`;
  }
}

/** Earned and next medals use the same metric-specific face. */
export function healthMedalFace(metric: HealthMetric["id"], amount: number): MedalFace {
  const text = metric === "sleep" ? `+${formatNumber(amount / 60, "compact")}m`
    : `${metric === "restingHeartRate" ? "↓" : "+"}${formatNumber(amount, "compact")}`;
  return { delta: { icon: metric === "restingHeartRate" ? "heart" : metric, text } };
}

/** D4: exactly the 28 dates before joining. */
export function healthBaseline(daily: readonly HealthDay[], joinedOn: string): number | null {
  return coveredMean(daily, addDaysToIsoDate(joinedOn, -28), addDaysToIsoDate(joinedOn, -1), 20);
}

/** D5: only observed endpoints with ten of their fourteen dates have a mean. */
export function healthMeans(daily: readonly HealthDay[]): HealthDay[] {
  return daily.flatMap(point => {
    const value = healthMean14(daily, point.date);
    return value === null ? [] : [{ date: point.date, value }];
  });
}

export function healthMean14(daily: readonly HealthDay[], on: string): number | null {
  return coveredMean(daily, addDaysToIsoDate(on, -13), on, 10);
}

/** Both step levels and age crossings must hold across five observed dates in a week. */
export function heldHealthLevels(levels: readonly HealthDay[], joinedOn: string): HealthDay[] {
  const sinceJoin = levels.filter(point => point.date >= joinedOn);
  return sinceJoin.flatMap(point => {
    const from = addDaysToIsoDate(point.date, -6);
    if (from < joinedOn) return [];
    const week = sinceJoin.filter(day => day.date >= from && day.date <= point.date);
    return week.length < 5 ? [] : [{ date: point.date, value: Math.min(...week.map(day => day.value)) }];
  });
}

function coveredMean(daily: readonly HealthDay[], from: string, through: string, minimum: number): number | null {
  const values = daily.filter(point => point.date >= from && point.date <= through).map(point => point.value);
  return values.length < minimum ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
