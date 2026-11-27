import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { addDays } from "../game/time";
import type { BoardDayValue, BoardNumber } from "../game/board-numbers";

export const factors = ["restingHeartRate", "sleepTime", "steps", "cardioFitness", "bedtime"] as const;
export type Factor = typeof factors[number];
export const factorInfo = {
  restingHeartRate: { title: "Resting heart rate", icon: "heart", unit: "bpm", board: "restingHeartRate", metric: "rhr_bpm" },
  sleepTime: { title: "Sleep duration", icon: "sleep", unit: "minutes", board: "sleep", metric: "sleep_total_min" },
  steps: { title: "Steps", icon: "steps", unit: "steps a day", board: "steps", metric: "steps" },
  cardioFitness: { title: "Cardio fitness", icon: "fitness", unit: "mL/kg/min", board: "vo2Max", metric: "vo2max" },
  bedtime: { title: "Bedtime", icon: "bedtime", unit: "minutes", board: null, metric: null },
} as const;
export type Reading = Pick<Extract<BoardNumber, { state: "available" }>, "state" | "daily" | "stale"> | { state: "pending" | "not_shared" };

export function bedtimePoint(date: string, at: string, timeZone: string) {
  const { hour, minute } = formatTimeZoneDateTimeParts(new Date(at), timeZone);
  // Noon anchors a sleep night. Midnight is continuous with the preceding evening.
  return { date, value: (hour < 12 ? hour + 24 : hour) * 60 + minute };
}

export function dailyReading(points: BoardDayValue[], today: string, age = 7): Reading {
  const from = addDays(today, -89);
  const daily = points.filter(p => p.date >= from && p.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const latest = daily.at(-1);
  return latest ? { state: "available", daily, stale: latest.date < addDays(today, -age) } : { state: "pending" };
}

export function formatReading(factor: Factor, value: number) {
  if (factor === "sleepTime") return `${Math.floor(Math.round(value) / 60)}h ${Math.round(value) % 60}m`;
  if (factor === "bedtime") {
    const minutes = Math.round(value) % 1440, hour = Math.floor(minutes / 60);
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: factor === "cardioFitness" ? 1 : 0 });
}
const dateLabel = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function workingRow(factor: Factor, since: string, today: string, reading: Reading, cheered: boolean) {
  const { title, unit: changeUnit } = factorInfo[factor];
  if (reading.state !== "available") return { factor, title, cheered, state: reading.state === "not_shared" ? "notShared" as const : "pending" as const };
  const from = addDays(today, -89);
  const series = reading.daily.filter(p => p.date >= since && p.date >= from && p.date <= today);
  const start = series[0], latest = series.at(-1);
  if (!start || !latest) return { factor, title, cheered, state: "pending" as const };
  const partial = since < from;
  const delta = Number((latest.value - start.value).toFixed(factor === "cardioFitness" ? 1 : 0));
  const change = partial ? "" : (delta > 0 ? "+" : delta < 0 ? "−" : "") + Math.abs(delta).toLocaleString("en-US");
  return { factor, title, since, series, partial, cheered, stale: reading.stale,
    startText: partial ? "Since " + dateLabel(since) : dateLabel(start.date) + " · " + formatReading(factor, start.value),
    latestText: (latest.date === today ? "Today" : dateLabel(latest.date)) + " · " + formatReading(factor, latest.value),
    change, changeUnit, better: !partial && (factor === "restingHeartRate" ? delta < 0 : factor !== "bedtime" && delta > 0) };
}
