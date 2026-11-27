import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

import { encodePolyline } from "../../game/progress/route-geometry";
import { addDays } from "../../game/time";
import { buildGameResultCard } from "./game-result";
import { detectHealthWins, type CardKind, type CardSpec, type DailySample, type HealthWinsInput } from "./index";
import { newestHealthWinsFirst } from "./ranking";
import { buildRecordedCards } from "./recorded";
import type { RecordedActivity } from "./types";

const goldenFile = new URL("./fixtures/cards.golden.json", import.meta.url);
const chartsByKind = {
  trend_change: ["trend"],
  threshold_count: ["bars"],
  streak: ["bars", "bars"],
  best_month: ["monthly_bars", "monthly_bars"],
  month_total: ["tally", "tally"],
  personal_record: ["record"],
  cumulative: ["map"],
  percentile: ["percentile"],
  lab_change: ["lab_trend"],
  lab_range: ["gauge"],
  experiment_result: ["two_bars"],
  game_climb: ["ladder", "skyline"],
  game_streak: ["week_dots"],
  game_result: ["game_result"],
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
      if (month <= 7 && day <= 13) daily.push({ metric: "steps", date, provider: "garmin", value: 6300 });
      // A month of tracked distance before the year-to-date total; the same every day, so no record.
      if (month <= 10 && day <= 6) daily.push({ metric: "distance_km", date, provider: "garmin", value: 5.4 });
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
      lowerIsBetter: true, referenceKey: "oura_sleeping_hr",
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
      exercise: "squats", total: 74, unit: "reps", latestDay: "2036-11-11",
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
      exercise: "planks", total: 14, unit: "seconds", latestDay: "2036-10-22", landmarksPassed: [], next: null, bestStreak: null,
    }],
  };
}

afterEach(() => vi.unstubAllEnvs());

function detectDietWins() {
  function days(month: string, first: number, last: number, proteinG: number, fiberG: number) {
    return Array.from({ length: last - first + 1 }, (_, offset) => ({
      date: `${month}-${String(first + offset).padStart(2, "0")}`, proteinG, fiberG,
    }));
  }
  return detectHealthWins({
    member: { today: "2036-11-28", age: null, sex: null, wearableProvider: null },
    meals: [
      ...days("2036-08", 1, 25, 174, 21),
      ...days("2036-09", 1, 25, 186, 22),
      ...days("2036-10", 1, 24, 205, 20),
      ...days("2036-10", 25, 25, 220, 10),
      ...days("2036-11", 1, 10, 190, 12),
      ...days("2036-11", 11, 16, 190, 33.25),
      ...days("2036-11", 17, 28, 190, 12),
    ],
  });
}

it("exports synthetic examples of every rendered shape", () => {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "v1:" + Buffer.alloc(32, 37).toString("base64"));
  const recording: RecordedActivity = {
    id: "a013dd82-5f77-4dba-91d5-bb32734bb164", kind: "cold_plunge",
    startedAt: "2036-11-18T09:13:00Z", elapsedSec: 180, movingSec: 180, timerSec: 240,
  };
  const context = { day: "2036-11-18", hour: 9, units: "metric" } as const;
  const timed = [recording, { ...recording, heartRate: {
    lowBpm: 71, avgBpm: 85, peakBpm: 109, perMinute: [79, null, 99],
  } }].flatMap(activity => buildRecordedCards(activity, context).candidates);
  const walk: RecordedActivity = {
    id: "238bba63-f944-4fe7-a508-295fe7789afa", kind: "walk",
    startedAt: "2037-03-12T14:09:00Z", elapsedSec: 810, movingSec: 750,
    heartRate: { lowBpm: 97, avgBpm: 114, peakBpm: 126 },
    route: {
      distanceM: 1250, climbM: 16,
      splits: [{ distanceM: 1000, seconds: 600 }, { distanceM: 250, seconds: 150 }],
      // A synthetic grid in open ocean.
      paths: [encodePolyline([[-140, 0.0002], [-139.997, 0.0002], [-139.997, 0.0012]])],
    },
  };
  const route = buildRecordedCards(walk, { day: "2037-03-12", hour: 14, units: "metric" }).candidates;
  const recorded = [...timed, ...route];
  for (const candidate of recorded) expect(candidate).not.toHaveProperty("achievement");
  const detected = detectHealthWins(syntheticInput());
  expect(Object.fromEntries(detected.achievements)).toEqual({
    "trend_change:sleep_total_min:2036-11": { kind: "trend_change", subject: "sleep_total_min", period: "2036-11" },
    "best_month:floors:2036-11": { kind: "best_month", subject: "floors", period: "2036-11" },
    "personal_record:steps:20360923": { kind: "personal_record", subject: "steps", period: "2036-09-23" },
    "lab-change-ldl-20361106": { kind: "lab_change", subject: "ldl", period: "2036-11-06" },
    "threshold_count:sleep_total_min:2036-11": { kind: "threshold_count", subject: "sleep_total_min", period: "2036-11" },
    "sessions:walk:2036-11": { kind: "sessions", subject: "walk", period: "2036-11" },
    "experiment_result:pencil-puzzles:20361008:sleep_score": {
      kind: "experiment_result", subject: "pencil-puzzles", period: "2036-10-08",
    },
  });
  const diet = detectDietWins();
  for (const card of diet.cards) expect(card).not.toHaveProperty("measure");
  expect(Object.fromEntries(diet.achievements)).toEqual({
    "best_month:protein_g:2036-11": { kind: "best_month", subject: "protein_g", period: "2036-11" },
  });
  const gameResult = buildGameResultCard({
    gameId: "g_canal_loop", contest: "Walk the canal path", lengthDays: 9, startDate: "2036-11-04",
    players: [
      { memberId: "m_indigo", firstName: "Luma", score: 8, won: true },
      { memberId: "m_topaz", firstName: "Oriel", score: 6, won: false },
    ],
    stake: { kind: "dare", item: "wear a paper crown to brunch" },
  });
  const cards = [
    ...newestHealthWinsFirst(detected.selected),
    ...recorded.map(candidate => candidate.variants[0].spec),
    ...newestHealthWinsFirst(diet.selected),
    gameResult,
  ];
  expect(cards).toHaveLength(23);
  for (const [kind, charts] of Object.entries(chartsByKind)) {
    expect(cards.filter(card => card.kind === kind).map(card => card.chart.type).sort(), kind).toEqual(charts);
  }
  const json = JSON.stringify(cards, null, 2) + "\n";
  if (process.env.UPDATE_HEALTH_WINS_GOLDEN === "1") writeFileSync(goldenFile, json);
  expect(cards).toEqual(JSON.parse(readFileSync(goldenFile, "utf8")));
});

it("links a ranked lab draw and leaves a wearable percentile unlinked", () => {
  const { member } = syntheticInput();
  const { cards, achievements } = detectHealthWins({
    member,
    labs: [{ analyte: "hdl", value: 93, date: member.today, unit: "mg/dL" }],
    daily: [{ metric: "vo2max", value: 55, date: member.today, provider: "garmin" }],
    rank: () => ({
      betterShare: 87, group: "Synthetic cohort", source: "Synthetic observations",
      cuts: [{ percentile: 50, value: 47 }], lowerIsBetter: false,
    }),
  });
  expect(cards.filter(card => card.kind === "percentile")).toHaveLength(2);
  expect(Object.fromEntries(achievements)).toEqual({
    "percentile-hdl-20361118": { kind: "lab_percentile", subject: "hdl", period: member.today },
  });
});

it("identifies one experiment across cards for different measured outcomes", () => {
  const { member, experiments } = syntheticInput();
  const seed = experiments![0];
  const { cards, achievements } = detectHealthWins({
    member, experiments: [seed, { ...seed, metric: "steps", baselineMean: 5700, interventionMean: 6500 }],
  });
  const expected = { kind: "experiment_result", subject: seed.slug, period: seed.intervention.start };
  expect(cards.map(card => achievements.get(card.id))).toEqual([expected, expected]);
  expect(new Set(cards.map(card => card.id)).size).toBe(2);
});

it("keys the best distance month to the winning month in the history", () => {
  const { member, daily } = syntheticInput();
  const distances: DailySample[] = daily!.filter(row => row.metric === "floors").map(row => ({
    ...row, metric: "distance_km", value: row.date.startsWith("2036-08") ? 9 : 3,
  }));
  const { cards, achievements } = detectHealthWins({ member, daily: distances });
  const best = cards.find(card => card.kind === "best_month")!;
  expect(achievements.get(best.id)).toEqual({ kind: "best_month", subject: "distance_km", period: "2036-08" });
});

it("keeps streaks unlinked as the observation window rolls or earlier nights arrive", () => {
  const { member } = syntheticInput();
  const daily: DailySample[] = Array.from({ length: 96 }, (_, index) => ({
    metric: "sleep_total_min", date: addDays(member.today, index - 95), value: 495, provider: "garmin",
  }));
  const windows = [
    { today: addDays(member.today, -1), nights: daily, expectedStart: daily[0].date },
    { today: member.today, nights: daily.slice(-30), expectedStart: addDays(member.today, -29) },
    { today: member.today, nights: daily, expectedStart: daily[0].date },
  ];
  for (const { today, nights, expectedStart } of windows) {
    const { cards, achievements } = detectHealthWins({ member: { ...member, today }, daily: nights });
    const streak = cards.find(card => card.kind === "streak");
    expect(streak?.chart.highlight).toEqual({ start: expectedStart, end: today });
    expect(achievements.has(streak!.id)).toBe(false);
  }
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
