import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compactWearableDaySummary,
  compactWearableDriftSummary,
  compactWearableLatestSummary,
  compactWearableList,
  compactWearableMetricSummary,
} from "../src/usecases/wearable-command-output.ts";

const SHORT_SLEEP_NOTE = "Only a provider-classified short sleep session is selected; this does not establish a complete night or identify a nap.";
const TIME_IN_BED_FALLBACK = "Used the selected sleep session duration because no explicit time-in-bed metric was available.";
const CONFLICT_NOTE = "Some metrics still conflict across providers: Steps.";

function metric(
  key: string,
  value: number | null,
  options: {
    conflictingProviders?: string[];
    fallbackFromMetric?: string;
    fallbackReason?: string;
    level?: "none" | "low" | "medium" | "high";
    provider?: string | null;
    unit?: string | null;
  } = {},
) {
  return {
    candidates: [{ candidateId: `candidate-${key}`, paths: ["ledger/events/2026/2026-04.jsonl"], recordIds: ["evt_01"] }],
    confidence: {
      candidateCount: 2,
      conflictingProviders: options.conflictingProviders ?? [],
      exactDuplicateCount: 1,
      level: options.level ?? "high",
    },
    metric: key,
    selection: {
      fallbackFromMetric: options.fallbackFromMetric ?? null,
      fallbackReason: options.fallbackReason ?? null,
      paths: ["ledger/events/2026/2026-04.jsonl"],
      provider: options.provider === undefined ? "oura" : options.provider,
      recordIds: ["evt_01"],
      title: "Synthetic metric",
      unit: options.unit === undefined ? null : options.unit,
      value,
    },
  };
}

function summaryConfidence(level: string, notes: string[] = []) {
  return {
    conflictingMetrics: [],
    level,
    lowConfidenceMetrics: [],
    notes,
    selectedProviders: ["oura"],
  };
}

function sleepNight(date: string, extraNotes: string[] = []) {
  return {
    date,
    hrv: metric("hrv", 51, { provider: "garmin", unit: "ms" }),
    notes: [
      "Selected evidence came from Oura, Garmin.",
      `Selected sleep window from Oura spanning ${date}T00:00:00.000Z to ${date}T07:00:00.000Z.`,
      "Selected total sleep: 420 min.",
      TIME_IN_BED_FALLBACK,
      ...extraNotes,
    ],
    provider: "oura",
    sleepEndAt: `${date}T07:00:00.000Z`,
    sleepLatencyMinutes: metric("sleepLatencyMinutes", 15, { level: "low", unit: "minutes" }),
    sleepScore: metric("sleepScore", null, { level: "none", provider: null }),
    sleepStartAt: `${date}T00:00:00.000Z`,
    sleepWindowProvider: "oura",
    spo2: metric("spo2", 0.97, { unit: "fraction" }),
    summaryConfidence: summaryConfidence(extraNotes.length > 0 ? "low" : "high", ["Selected evidence came from Oura, Garmin.", ...extraNotes]),
    timeInBedMinutes: metric("timeInBedMinutes", 430, {
      fallbackFromMetric: "sessionMinutes",
      fallbackReason: TIME_IN_BED_FALLBACK,
      unit: "minutes",
    }),
    totalSleepMinutes: metric("totalSleepMinutes", 420, { unit: "minutes" }),
  };
}

const activityDay = {
  activityTypes: ["running"],
  date: "2026-04-04",
  distanceKm: metric("distanceKm", 7.2, { unit: "km" }),
  notes: [
    "Selected evidence came from Oura, Garmin.",
    CONFLICT_NOTE,
    "Selected 1 activity session covering 45 min.",
    "Selected activity types: running.",
  ],
  sessionCount: metric("sessionCount", 1, { unit: "count" }),
  steps: metric("steps", 9_120, { conflictingProviders: ["garmin"], level: "medium", unit: "count" }),
  summaryConfidence: summaryConfidence("medium", ["Selected evidence came from Oura, Garmin.", CONFLICT_NOTE]),
  weightKg: metric("weightKg", 81.60000000000001, { provider: "withings", unit: "kg" }),
};

const sourceNote = "Oura has workout detail metrics on activity sessions.";
const daySummary = {
  activity: activityDay,
  bodyState: null,
  date: "2026-04-04",
  notes: [...activityDay.notes, ...sleepNight("2026-04-04", [SHORT_SLEEP_NOTE]).notes, sourceNote],
  providers: ["garmin", "oura"],
  recovery: null,
  sleep: sleepNight("2026-04-04", [SHORT_SLEEP_NOTE]),
  sourceHealth: [{
    activityDays: 1,
    bodyStateDays: 0,
    candidateMetrics: 20,
    conflictCount: 1,
    exactDuplicatesSuppressed: 0,
    firstDate: "2026-04-04",
    lastDate: "2026-04-04",
    latestRecordedAt: "2026-04-04T23:00:00.000Z",
    metricsContributed: ["distanceKm", "steps"],
    notes: [sourceNote],
    provider: "oura",
    providerDisplayName: "Oura",
    recoveryDays: 0,
    selectedMetrics: 12,
    sleepNights: 1,
    stalenessVsNewestDays: 0,
  }],
  summaryConfidence: "low",
};

test("day output keeps values, differing providers, conflicts, low confidence, fallbacks and units", () => {
  const { units, value } = compactWearableDaySummary(daySummary);

  assert.deepEqual(value, {
    activity: {
      activityTypes: ["running"],
      confidence: "medium",
      distanceKm: 7.2,
      notes: [CONFLICT_NOTE],
      provider: "oura",
      sessionCount: 1,
      steps: { confidence: "medium", conflictingProviders: ["garmin"], value: 9_120 },
      weightKg: { provider: "withings", value: 81.6 },
    },
    confidence: "low",
    date: "2026-04-04",
    providers: ["garmin", "oura"],
    sleep: {
      confidence: "low",
      hrv: { provider: "garmin", value: 51 },
      notes: [TIME_IN_BED_FALLBACK, SHORT_SLEEP_NOTE],
      provider: "oura",
      sleepEndAt: "2026-04-04T07:00:00.000Z",
      sleepLatencyMinutes: { confidence: "low", value: 15 },
      sleepStartAt: "2026-04-04T00:00:00.000Z",
      spo2: { unit: "fraction", value: 0.97 },
      timeInBedMinutes: { fallbackFromMetric: "sessionMinutes", value: 430 },
      totalSleepMinutes: 420,
    },
    sourceHealth: [{
      activityDays: 1,
      conflictCount: 1,
      firstDate: "2026-04-04",
      lastDate: "2026-04-04",
      latestRecordedAt: "2026-04-04T23:00:00.000Z",
      notes: [sourceNote],
      provider: "oura",
      sleepNights: 1,
    }],
  });
  // Every bare or unit-less value has a unit; an off-legend unit stays inline.
  assert.deepEqual(units, {
    distanceKm: "km",
    hrv: "ms",
    sessionCount: "count",
    sleepLatencyMinutes: "minutes",
    steps: "count",
    timeInBedMinutes: "minutes",
    totalSleepMinutes: "minutes",
    weightKg: "kg",
  });
  const serialized = JSON.stringify(value);
  for (const removed of ["candidates", "selection", "paths", "recordIds", "summaryConfidence", "selectedProviders", "Selected "]) {
    assert.equal(serialized.includes(removed), false, removed);
  }
});

test("latest output keeps only notes the day does not already carry", () => {
  const { units, value } = compactWearableLatestSummary({
    activity: activityDay,
    day: daySummary,
    latestDate: "2026-04-04",
    notes: [
      "Latest wearable summary is joined on local day 2026-04-04.",
      ...daySummary.notes,
      "Latest body-state summary date 2026-04-01 differs from the joined wearable latest day 2026-04-04.",
    ],
    providers: ["garmin", "oura", "withings"],
    sourceHealth: daySummary.sourceHealth,
  });

  assert.deepEqual(value?.notes, [
    "Latest body-state summary date 2026-04-01 differs from the joined wearable latest day 2026-04-04.",
  ]);
  assert.deepEqual(Object.keys(value ?? {}).sort(), ["day", "latestDate", "notes", "providers"]);
  assert.equal(units?.totalSleepMinutes, "minutes");
});

test("lists move notes shared by every item to the list once", () => {
  const list = compactWearableList([
    sleepNight("2026-04-04", [SHORT_SLEEP_NOTE]),
    sleepNight("2026-04-03"),
  ]);

  assert.deepEqual(list.notes, [TIME_IN_BED_FALLBACK]);
  assert.deepEqual(list.items.map((item) => item.notes), [[SHORT_SLEEP_NOTE], undefined]);
  assert.deepEqual(list.items.map((item) => item.date), ["2026-04-04", "2026-04-03"]);
  assert.equal(list.items[1]?.totalSleepMinutes, 420);
  assert.equal(list.units?.totalSleepMinutes, "minutes");

  const single = compactWearableList([sleepNight("2026-04-04")]);
  assert.equal(single.notes, undefined);
  assert.deepEqual(single.items[0]?.notes, [TIME_IN_BED_FALLBACK]);
});

function metricSummary(overrides: Record<string, unknown> = {}) {
  return {
    confidence: { candidateCount: 2, conflictingProviders: [], exactDuplicateCount: 1, level: "high" },
    date: "2026-04-04",
    delta: null,
    max: 52,
    metric: "hrv",
    min: 44,
    notes: [
      "Selected evidence came from Oura.",
      "Not enough earlier hrv days were available for a prior-window comparison.",
    ],
    paths: ["ledger/events/2026/2026-04.jsonl"],
    percentChange: null,
    priorWindow: { average: null, count: 0, from: null, max: null, min: null, to: null },
    provider: "oura",
    recentWindow: { average: 48.5, count: 2, from: "2026-04-03", max: 52, min: 44, to: "2026-04-04" },
    recordedAt: "2026-04-04T07:00:00.000Z",
    recordIds: ["evt_01"],
    requestedMetric: "hrv",
    resolvedAlias: null,
    summaryKind: "sleep",
    unit: "ms",
    value: 52,
    windowDays: 7,
    ...overrides,
  };
}

test("metric summaries drop echoes and keep gap notes, conflicts and differing trend points", () => {
  assert.deepEqual(compactWearableMetricSummary(metricSummary({
    confidence: { candidateCount: 2, conflictingProviders: ["garmin"], exactDuplicateCount: 0, level: "medium" },
    points: [
      { confidence: "medium", date: "2026-04-04", paths: [], provider: "oura", recordedAt: "2026-04-04T07:00:00.000Z", recordIds: [], unit: "ms", value: 52 },
      { confidence: "high", date: "2026-04-03", paths: [], provider: "garmin", recordedAt: "2026-04-03T07:00:00.000Z", recordIds: [], unit: "ms", value: 44 },
    ],
  })), {
    confidence: "medium",
    conflictingProviders: ["garmin"],
    date: "2026-04-04",
    max: 52,
    metric: "hrv",
    min: 44,
    notes: ["Not enough earlier hrv days were available for a prior-window comparison."],
    points: [
      { confidence: "medium", date: "2026-04-04", value: 52 },
      { date: "2026-04-03", provider: "garmin", value: 44 },
    ],
    priorWindow: { count: 0 },
    provider: "oura",
    recentWindow: { average: 48.5, count: 2, from: "2026-04-03", max: 52, min: 44, to: "2026-04-04" },
    recordedAt: "2026-04-04T07:00:00.000Z",
    summaryKind: "sleep",
    unit: "ms",
    value: 52,
  });
});

test("drift returns its signals and notes without the latest bundle", () => {
  const shared = TIME_IN_BED_FALLBACK;
  const drift = compactWearableDriftSummary({
    latest: { day: daySummary, latestDate: "2026-04-04", notes: [sourceNote], providers: ["oura"] },
    notes: [sourceNote, "Compared recent and prior 7-day wearable windows across the default sleep, recovery, and body signals."],
    signals: [
      metricSummary({ notes: ["Selected evidence came from Oura.", shared, "Compared recent 7 hrv days (2026-03-29 to 2026-04-04) against prior 7 days (2026-03-22 to 2026-03-28)."] }),
      metricSummary({ metric: "sleepScore", notes: [shared, "Not enough earlier sleep score days were available for a prior-window comparison."], unit: "%", value: 80 }),
    ],
    windowDays: 7,
  });

  assert.equal(Object.hasOwn(drift ?? {}, "latest"), false);
  assert.deepEqual(drift?.notes, [
    "Compared recent and prior 7-day wearable windows across the default sleep, recovery, and body signals.",
    shared,
  ]);
  const signals = drift?.signals as Array<Record<string, unknown>>;
  assert.deepEqual(signals.map((signal) => signal.notes), [
    undefined,
    ["Not enough earlier sleep score days were available for a prior-window comparison."],
  ]);
  assert.equal(signals.every((signal) => !Object.hasOwn(signal, "recordedAt")), true);
  assert.equal(drift?.windowDays, 7);
});
