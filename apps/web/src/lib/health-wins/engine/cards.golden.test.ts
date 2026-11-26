import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

import { encodePolyline } from "../../game/progress/route-geometry";
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
  activity_route: ["route_map"],
  activity_splits: ["splits"],
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

afterEach(() => vi.unstubAllEnvs());

it("exports one synthetic card of every rendered shape", () => {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "v1:" + Buffer.alloc(32, 37).toString("base64"));
  const recording: RecordedActivity = {
    id: "a013dd82-5f77-4dba-91d5-bb32734bb164", kind: "cold_plunge",
    startedAt: "2036-11-18T09:13:00Z", elapsedSec: 180, movingSec: 180, timerSec: 240,
  };
  const context = { day: "2036-11-18", hour: 9, units: "metric" } as const;
  const timedCards = [recording, { ...recording, heartRate: {
    lowBpm: 71, avgBpm: 85, peakBpm: 109, perMinute: [79, null, 99],
  } }].flatMap(activity => buildRecordedCards(activity, context).candidates.map(candidate => candidate.variants[0].spec));
  const walk: RecordedActivity = {
    id: "238bba63-f944-4fe7-a508-295fe7789afa", kind: "walk",
    startedAt: "2037-03-12T14:09:00Z", elapsedSec: 810, movingSec: 750,
    route: {
      distanceM: 1250, climbM: 16,
      splits: [{ distanceM: 1000, seconds: 600 }, { distanceM: 250, seconds: 150 }],
      // A synthetic grid in open ocean.
      paths: [encodePolyline([[-140, 0.0002], [-139.997, 0.0002], [-139.997, 0.0012]])],
    },
  };
  const routeCards = buildRecordedCards(walk, { day: "2037-03-12", hour: 14, units: "metric" })
    .candidates.map(candidate => candidate.variants[0].spec);
  const cards = [...generateHealthWins(syntheticInput()), ...timedCards, ...routeCards];
  for (const [kind, charts] of Object.entries(chartsByKind)) {
    expect(cards.filter(card => card.kind === kind).map(card => card.chart.type).sort(), kind).toEqual(charts);
  }
  const json = JSON.stringify(cards, null, 2) + "\n";
  if (process.env.UPDATE_HEALTH_WINS_GOLDEN === "1") writeFileSync(goldenFile, json);
  expect(cards).toEqual(JSON.parse(readFileSync(goldenFile, "utf8")));
});

it("uses ISO days and months for every chart date and human dates in copy", () => {
  function checkChartFields(chart: object, path: string) {
    for (const [key, value] of Object.entries(chart)) {
      const field = `${path}.${key}`;
      if (key === "missedOn" && value === null) continue;
      if (["date", "start", "end", "missedOn"].includes(key)) {
        expect(value, field).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      } else if (key === "month" || (key === "highlight" && typeof value === "string")) {
        expect(value, field).toMatch(/^\d{4}-\d{2}$/u);
      } else if (value !== null && typeof value === "object") {
        checkChartFields(value, field);
      } else if (typeof value === "string") {
        expect(value, field).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
      }
    }
  }

  const cards: CardSpec[] = JSON.parse(readFileSync(goldenFile, "utf8"));
  for (const { chart, ...card } of cards) {
    checkChartFields(chart, `${card.kind}.chart`);
    expect(JSON.stringify(card), card.kind).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  }
});
