import { addDaysToIsoDate } from "@murphai/contracts";
import type { RawHealthPoint } from "../../device-sync/companion-numbers";
import type { HealthMetric, Rec } from "./contract";
import type { DayAmount } from "./registry";

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
    { id: "after-dinner", metric: "steps", title: "Walk after dinner", detail: "A 20 min walk is 2,000 steps",
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
/** D4: exactly the 28 dates before joining. */
export function healthBaseline(daily: readonly HealthDay[], joinedOn: string): number | null {
  return coveredMean(daily, addDaysToIsoDate(joinedOn, -28), addDaysToIsoDate(joinedOn, -1), 20);
}

export function healthMean14(daily: readonly HealthDay[], on: string): number | null {
  return coveredMean(daily, addDaysToIsoDate(on, -13), on, 10);
}

function coveredMean(daily: readonly HealthDay[], from: string, through: string, minimum: number): number | null {
  const values = daily.filter(point => point.date >= from && point.date <= through).map(point => point.value);
  if (values.length < minimum) return null;
  // Center the sum so identical readings exactly on a percentile cut stay on it.
  const first = values[0];
  return first + values.reduce((sum, value) => sum + (value - first), 0) / values.length;
}
