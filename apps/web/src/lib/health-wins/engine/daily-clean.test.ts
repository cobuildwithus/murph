import { describe, expect, it } from "vitest";

import { dailyAchievements } from "./daily-achievements";
import { cleanDaily } from "./daily-clean";
import type { DailySample, Metric } from "./types";

const today = "2032-03-25";

function point(metric: Metric, provider: string, day: number, value: number): DailySample {
  return { metric, provider, date: `2032-03-${String(day).padStart(2, "0")}`, value };
}

function history(metric: Metric, days: number, valueAt: (i: number) => number): DailySample[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (days - 1 - i));
    return { metric, provider: "garmin", date: date.toISOString().slice(0, 10), value: valueAt(i) };
  });
}

describe("daily data quality", () => {
  it.each<[Metric, string[], number]>([
    ["sleep_total_min", ["whoop", "oura", "garmin", "apple"], 430],
    ["sleep_deep_min", ["whoop", "oura", "garmin", "apple"], 75],
    ["sleep_score", ["whoop", "oura", "garmin", "apple"], 83],
    ["rhr_bpm", ["whoop", "oura", "garmin", "apple"], 61],
    ["hrv_ms", ["whoop", "oura", "garmin", "apple"], 42],
    ["distance_km", ["apple", "google", "garmin"], 3],
    ["steps", ["whoop", "garmin", "google", "apple"], 7_234],
  ])("selects one provider for %s in fixed priority order", (metric, providers, start) => {
    const available = providers.map((provider, index) => point(metric, provider, 4, start + index));
    for (let index = 0; index < available.length; index++) {
      expect(cleanDaily(available.slice(index).reverse(), today)).toEqual([available[index]]);
    }
  });

  it("keeps one whole steps total per day, including a recorded zero", () => {
    const first = point("steps", "whoop", 2, 16_307);
    const second = point("steps", "whoop", 3, 0);
    const third = point("steps", "garmin", 4, 5_612);
    const rows = [point("steps", "Apple Health", 2, 23_436), third, second, first,
      point("steps", "garmin", 3, 111), point("steps", "whoop", 4, 100_000)];
    expect(cleanDaily(rows, today)).toEqual([first, second, third]);
  });

  it("retains the measured device and resolves duplicate source days independently of order", () => {
    const rows = [point("rhr_bpm", "Apple-Watch", 6, 73), point("rhr_bpm", "apple watch", 6, 74),
      point("rhr_bpm", "Apple-Health-Kit", 6, 66), point("rhr_bpm", "Apple-Watch", 7, 71),
      point("rhr_bpm", "apple watch", 7, 71)];
    const expected = [point("rhr_bpm", "apple", 6, 66), point("rhr_bpm", "apple watch", 7, 71)];
    expect(cleanDaily(rows, today)).toEqual(expected);
    expect(cleanDaily(rows.reverse(), today)).toEqual(expected);
  });

  it.each<[Metric, number, number]>([
    ["sleep_total_min", 180, 840], ["sleep_deep_min", 0, 300], ["sleep_score", 0, 100],
    ["rhr_bpm", 30, 120], ["hrv_ms", 5, 250], ["steps", 0, 60_000],
    ["distance_km", 0, 60], ["floors", 0, 400],
  ])("includes the limits and rejects out-of-bounds %s observations", (metric, low, high) => {
    const rows = [low - 1, low, high, high + 1, NaN, Infinity].map((value, index) => point(metric, "garmin", index + 1, value));
    expect(cleanDaily(rows, today).map(row => row.value)).toEqual([low, high]);
  });

  it.each<[Metric, number]>([
    ["sleep_total_min", 510], ["sleep_deep_min", 85], ["sleep_score", 80], ["rhr_bpm", 63], ["hrv_ms", 47],
  ])("drops physiological %s points strictly beyond six median absolute deviations", (metric, base) => {
    const values = [-1, -1, 0, 0, 0, 1, 1, 6, 7].map(offset => base + offset);
    const rows = values.map((value, index) => point(metric, "garmin", index + 1, value));
    expect(cleanDaily(rows, today).map(row => row.value)).toEqual(values.slice(0, -1));
    const flat = [base, base, base, base + 1].map((value, index) => point(metric, "garmin", index + 1, value));
    expect(cleanDaily(flat, today)).toEqual(flat.slice(0, -1));
  });

  it("preserves a sustained rise in sleep duration in both the monthly count and the streak", () => {
    const daily = history("sleep_total_min", 365, i => i < 340 ? 410 + (i * 11) % 51 : 495 + (i * 7) % 31);
    const cards = dailyAchievements("sleep_total_min", cleanDaily(daily, today), today).map(({ card }) => card);
    expect(cards.find(card => card.kind === "threshold_count")?.title.number).toBe("25 of 25 nights");
    expect(cards.find(card => card.kind === "streak")?.chart.highlight).toEqual({
      start: "2032-03-01", end: today,
    });
  });

  it("keeps a gradual decline in resting heart rate after a long steady baseline", () => {
    const rows = history("rhr_bpm", 365, i => {
      const trainingWeeks = Math.max(0, Math.floor((i - 245) / 7));
      return 70 + (i % 3) - trainingWeeks;
    });
    expect(cleanDaily(rows, today)).toEqual(rows);
  });

  it("trims an isolated long night in a steady month", () => {
    const rows = history("sleep_total_min", 30, i => i === 14 ? 795 : 433 + (i % 9));
    expect(cleanDaily(rows, today)).toEqual(rows.filter((_, i) => i !== 14));
  });

  it("includes observations exactly 45 calendar days away in either direction", () => {
    const rows = history("rhr_bpm", 93, i => i === 46 ? 90 : 60);
    const middle = rows[46];
    expect(cleanDaily([rows[1], middle, rows[91]], today)).not.toContainEqual(middle);
    expect(cleanDaily([rows[0], middle, rows[91]], today)).toContainEqual(middle);
    expect(cleanDaily([rows[1], middle, rows[92]], today)).toContainEqual(middle);
  });

  it.each<[Metric, number[]]>([
    ["steps", [3_010, 3_038, 3_055, 3_065, 18_900]],
    ["distance_km", [3, 3.2, 3.1, 2.8, 21.7]],
    ["floors", [8, 10, 12, 11, 83]],
  ])("retains a large valid %s activity day", (metric, values) => {
    const rows = values.map((value, index) => point(metric, "garmin", index + 1, value));
    expect(cleanDaily(rows, today)).toEqual(rows);
  });

  it("treats a partial night as missing and accepts a valid whole-day fallback", () => {
    const rows = [point("sleep_total_min", "whoop", 2, 142), point("sleep_total_min", "whoop", 3, 157),
      point("sleep_total_min", "oura", 3, 497)];
    expect(cleanDaily(rows, today)).toEqual([rows[2]]);
  });

  it("ignores invalid and future dates before estimating the median", () => {
    const valid = point("rhr_bpm", "oura", 9, 69);
    const rows = [valid, point("rhr_bpm", "oura", 26, 42), { ...valid, date: "2032-02-30", value: 42 }];
    expect(cleanDaily(rows, today)).toEqual([valid]);
  });
});
