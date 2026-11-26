import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";

import { generateHealthWins, type CardKind, type CardSpec, type DailySample, type HealthWinsInput } from "./index";
import { buildRecordedCards } from "./recorded";
import type { RecordedActivity } from "./types";

const goldenFile = new URL("./fixtures/cards.golden.json", import.meta.url);
const chartsByKind = {
  trend_change: ["trend"],
  threshold_count: ["bars"],
  streak: ["bars"],
  best_month: ["monthly_bars"],
  personal_record: ["record"],
  cumulative: ["map"],
  percentile: ["percentile"],
  lab_change: ["lab_trend"],
  lab_range: ["gauge"],
  experiment_result: ["two_bars"],
  game_climb: ["ladder", "skyline"],
  game_streak: ["week_dots"],
  sessions: ["sessions"],
  activity_heart_rate: ["heart_rate"],
  activity_time: ["duration"],
} satisfies { [K in CardKind]: Extract<CardSpec, { kind: K }>["chart"]["type"][] };

function syntheticInput(): HealthWinsInput {
  const daily: DailySample[] = [
    { metric: "steps", date: "2036-09-23", provider: "garmin", value: 11580 },
    { metric: "steps", date: "2036-11-06", provider: "garmin", value: 7300 },
    { metric: "distance_km", date: "2036-11-06", provider: "garmin", value: 5.4 },
    { metric: "distance_km", date: "2036-11-09", provider: "garmin", value: 5.4 },
  ];
  for (let month = 6; month <= 11; month++) {
    for (let day = 1; day <= 16; day++) {
      const date = `2036-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      daily.push({ metric: "floors", date, provider: "garmin", value: month + 3 });
      if (month === 11) daily.push({ metric: "rhr_bpm", date, provider: "garmin", value: 54 });
      if (month >= 8) {
        const usualNight = day % 2 === 0 ? 441 : 425;
        const novemberNight = day === 1 ? 455 : 492;
        daily.push({ metric: "sleep_total_min", date, provider: "garmin", value: month === 11 ? novemberNight : usualNight });
      }
    }
  }
  return {
    member: { today: "2036-11-18", age: 39, sex: "female", wearableProvider: "garmin" },
    daily,
    rank: metric => metric === "restingHeartRate" ? {
      betterShare: 83, group: "Women 30 to 39", source: "Synthetic resting heart rate reference",
      cuts: [{ percentile: 10, value: 51 }, { percentile: 50, value: 63 }, { percentile: 90, value: 75 }],
      lowerIsBetter: true,
    } : null,
    labs: [
      { analyte: "ldl", value: 125, unit: "mg/dL", date: "2036-03-04", fasting: false },
      { analyte: "ldl", value: 121, unit: "mg/dL", date: "2036-07-12", fasting: false },
      { analyte: "ldl", value: 106, unit: "mg/dL", date: "2036-11-06", fasting: false },
      { analyte: "glucose", value: 93, unit: "mg/dL", date: "2035-12-18", referenceRange: { low: 72, high: 98 } },
    ],
    sessions: [
      { type: "walk", date: "2036-11-02", minutes: 18 },
      { type: "walk", date: "2036-11-08", minutes: 24 },
      { type: "walk", date: "2036-11-14", minutes: 35 },
    ],
    experiments: [{
      slug: "pencil-puzzles", title: "Pencil puzzles before dinner", metric: "sleep_score",
      baseline: { start: "2036-10-01", end: "2036-10-07" },
      intervention: { start: "2036-10-08", end: "2036-10-14" },
      baselineMean: 74, interventionMean: 77.5, expectedDirection: "increase", adherence: { done: 6, target: 7 },
    }],
    games: [{
      exercise: "squats", total: 74, unit: "reps",
      landmarksPassed: [{ id: "hollywood-sign", height: 45 }],
      next: { id: "christ-the-redeemer", height: 125, toGo: 51 },
      bestStreak: {
        days: 3, start: "2036-11-07", end: "2036-11-11", missedOn: "2036-11-12",
        calendar: [
          { date: "2036-11-06", state: "missed" },
          { date: "2036-11-07", state: "posted" },
          { date: "2036-11-08", state: "no_game" },
          { date: "2036-11-10", state: "posted" },
          { date: "2036-11-11", state: "posted" },
          { date: "2036-11-12", state: "missed" },
        ],
      },
    }, {
      exercise: "planks", total: 14, unit: "seconds", landmarksPassed: [], next: null, bestStreak: null,
    }],
  };
}

it("exports one synthetic card of every rendered shape", () => {
  const recording: RecordedActivity = {
    id: "a013dd82-5f77-4dba-91d5-bb32734bb164", kind: "cold_plunge",
    startedAt: "2036-11-18T09:13:00Z", elapsedSec: 180, movingSec: 180, timerSec: 240,
  };
  const context = { day: "2036-11-18", hour: 9, units: "metric" } as const;
  const timedCards = [recording, { ...recording, heartRate: {
    lowBpm: 71, avgBpm: 85, peakBpm: 109, perMinute: [79, null, 99],
  } }].flatMap(activity => buildRecordedCards(activity, context).candidates.map(candidate => candidate.variants[0].spec));
  const cards = [...generateHealthWins(syntheticInput()), ...timedCards];
  for (const [kind, charts] of Object.entries(chartsByKind)) {
    expect(cards.filter(card => card.kind === kind).map(card => card.chart.type).sort(), kind).toEqual(charts);
  }
  const json = JSON.stringify(cards, null, 2) + "\n";
  expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  if (process.env.UPDATE_HEALTH_WINS_GOLDEN === "1") writeFileSync(goldenFile, json);
  expect(cards).toEqual(JSON.parse(readFileSync(goldenFile, "utf8")));
});
