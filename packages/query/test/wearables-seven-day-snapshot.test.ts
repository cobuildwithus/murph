import assert from "node:assert/strict";

import { METRIC_POINT_SCHEMA_VERSION, type MetricPoint } from "@murphai/health-metrics";
import { test } from "vitest";

import {
  buildWearableSevenDaySnapshot,
  resolveWearableSevenDaySnapshotWindow,
  type WearableSevenDaySnapshotBundle,
} from "../src/wearables/seven-day-snapshot.ts";
import { resolveMetric } from "../src/wearables/selection.ts";
import type {
  WearableMetricCandidate,
  WearableMetricKey,
  WearableResolvedMetric,
  WearableSleepNight,
  WearableSleepSessionType,
} from "../src/wearables/types.ts";

function resolvedMetric(input: {
  date: string;
  metric: WearableMetricKey;
  provider?: string;
  unit?: string;
  value?: number;
}): WearableResolvedMetric {
  if (input.value === undefined) {
    return resolveMetric(input.metric, []);
  }
  const provider = input.provider ?? "fixture-provider";
  const candidate: WearableMetricCandidate = {
    candidateId: `${provider}:${input.metric}:${input.date}`,
    date: input.date,
    externalRef: null,
    metric: input.metric,
    occurredAt: `${input.date}T12:00:00.000Z`,
    paths: [],
    provider,
    recordedAt: `${input.date}T12:05:00.000Z`,
    recordIds: [],
    sourceFamily: "event",
    sourceKind: "observation",
    title: null,
    unit: input.unit ?? null,
    value: input.value,
  };
  return resolveMetric(input.metric, [candidate]);
}

function makeSleepNight(input: {
  date: string;
  endAt: string;
  sleepType?: WearableSleepSessionType;
  startAt: string;
  timeZone?: string | null;
  totalSleepMinutes: number;
}): WearableSleepNight {
  const metric = (metricKey: WearableMetricKey, value?: number, unit?: string) =>
    resolvedMetric({ date: input.date, metric: metricKey, unit, value });
  const sessionMinutes = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 60_000;

  return {
    averageHeartRate: metric("averageHeartRate"),
    awakeMinutes: metric("awakeMinutes"),
    date: input.date,
    deepMinutes: metric("deepMinutes"),
    hrv: metric("hrv"),
    lightMinutes: metric("lightMinutes"),
    lowestHeartRate: metric("lowestHeartRate"),
    lowestSpo2: metric("lowestSpo2"),
    notes: [],
    provider: "fixture-provider",
    remMinutes: metric("remMinutes"),
    respiratoryRate: metric("respiratoryRate"),
    sessionMinutes: metric("sessionMinutes", sessionMinutes, "minutes"),
    sleepConsistency: metric("sleepConsistency"),
    sleepEfficiency: metric("sleepEfficiency"),
    sleepEndAt: input.endAt,
    sleepLatencyMinutes: metric("sleepLatencyMinutes"),
    sleepPerformance: metric("sleepPerformance"),
    sleepScore: metric("sleepScore"),
    sleepStartAt: input.startAt,
    sleepType: input.sleepType ?? "main_sleep",
    sleepWindowProvider: "fixture-provider",
    spo2: metric("spo2"),
    summaryConfidence: {
      conflictingMetrics: [],
      level: "high",
      lowConfidenceMetrics: [],
      notes: [],
      selectedProviders: ["fixture-provider"],
    },
    timeInBedMinutes: metric("timeInBedMinutes", sessionMinutes, "minutes"),
    timeZone: input.timeZone === undefined ? "UTC" : input.timeZone,
    totalSleepMinutes: metric(
      "totalSleepMinutes",
      input.totalSleepMinutes,
      "minutes",
    ),
  };
}

function hrvSdnnPoint(date: string, value: number): MetricPoint {
  return {
    biomarkerKey: "biomarker:hrv-sdnn",
    canonicalUnit: "ms",
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: date,
    grain: "day",
    id: `hrv-sdnn:${date}`,
    metricKey: "hrv-sdnn",
    observedAt: `${date}T12:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: "fixture-provider",
      rawRefs: [],
      sourceLabel: "Fixture HRV",
    },
    recordedAt: `${date}T12:05:00.000Z`,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "event",
      kind: "observation",
      path: "",
      recordId: `hrv-sdnn:${date}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: "ms",
    value,
  };
}

function bundle(): WearableSevenDaySnapshotBundle {
  const activityDays = [
    ["2026-08-17", 100],
    ["2026-08-18", 100],
    ["2026-08-19", 100],
    ["2026-08-24", 200],
    ["2026-08-26", 300],
    ["2026-08-30", 400],
  ].map(([date, value]) => ({
    date: date as string,
    steps: resolvedMetric({
      date: date as string,
      metric: "steps",
      unit: "count",
      value: value as number,
    }),
  }));
  const recoveryDays = [
    ["2026-08-17", 55, 30],
    ["2026-08-18", 55, 30],
    ["2026-08-19", 55, 30],
    ["2026-08-24", 60, 40],
    ["2026-08-25", 61, 50],
    ["2026-08-26", 62, 60],
  ].map(([date, restingHeartRate, hrv]) => ({
    date: date as string,
    hrv: resolvedMetric({
      date: date as string,
      metric: "hrv",
      unit: "ms",
      value: hrv as number,
    }),
    restingHeartRate: resolvedMetric({
      date: date as string,
      metric: "restingHeartRate",
      unit: "bpm",
      value: restingHeartRate as number,
    }),
  }));

  return {
    activityDays,
    recoveryDays,
    sleepNights: [
      makeSleepNight({
        date: "2026-08-24",
        endAt: "2026-08-25T15:00:00.000Z",
        startAt: "2026-08-25T07:00:00.000Z",
        timeZone: "America/Los_Angeles",
        totalSleepMinutes: 420,
      }),
      makeSleepNight({
        date: "2026-08-26",
        endAt: "2026-08-26T20:00:00.000Z",
        sleepType: "nap",
        startAt: "2026-08-26T19:00:00.000Z",
        timeZone: "America/Los_Angeles",
        totalSleepMinutes: 60,
      }),
    ],
  };
}

test("daily sleep totals survive missing clock times without admitting naps or unfinished sessions", () => {
  const base = makeSleepNight({
    date: "2026-08-28",
    startAt: "2026-08-27T23:00:00.000Z",
    endAt: "2026-08-28T07:00:00.000Z",
    totalSleepMinutes: 420,
  });
  const durationOnly = { ...base, sleepStartAt: null, sleepEndAt: null };
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: {
      activityDays: [], recoveryDays: [],
      sleepNights: [
        durationOnly,
        { ...durationOnly, date: "2026-08-27", sleepType: "nap" },
        { ...base, date: "2026-08-29", sleepEndAt: "2026-08-31T07:00:00.000Z" },
      ],
    },
    filters: { metricKeys: ["total-sleep-minutes"], now: "2026-08-30T08:00:00.000Z", timeZone: "UTC" },
  });
  assert.equal(snapshot.metrics[0]?.values[snapshot.days.indexOf("2026-08-28")], 420);
  assert.equal(snapshot.metrics[0]?.observedDayCount, 1);
});

test("a morning snapshot compares completed local days instead of unfinished steps", () => {
  const activityDays = Array.from({ length: 15 }, (_, index) => {
    const date = `2026-08-${16 + index}`;
    return { date, steps: resolvedMetric({ date, metric: "steps", unit: "count", value: index === 14 ? 200 : 10_000 }) };
  });
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: { activityDays, recoveryDays: [], sleepNights: [] },
    filters: { metricKeys: ["steps"], now: "2026-08-30T08:00:00.000Z", timeZone: "UTC" },
  });
  assert.equal(snapshot.to, "2026-08-29");
  assert.equal(snapshot.metrics[0]?.average, 10_000);
  assert.equal(snapshot.metrics[0]?.trend.direction, "steady");
  assert.equal(snapshot.metrics[0]?.trend.delta, 0);
});

test("completed-day bounds follow the reporting zone across midnight and year changes", () => {
  const window = resolveWearableSevenDaySnapshotWindow({
    now: "2027-01-01T04:00:00.000Z", timeZone: "America/New_York", to: "2027-01-03",
  });
  assert.equal(window.asOfDate, "2026-12-31");
  assert.equal(window.to, "2026-12-30");
  assert.equal(window.from, "2026-12-24");
});

test("seven-day snapshots keep exact local calendar slots and explicit HRV methods", () => {
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: bundle(),
    filters: {
      metricKeys: [
        "steps",
        "total-sleep-minutes",
        "resting-heart-rate",
        "hrv-rmssd",
        "hrv-sdnn",
      ],
      now: "2026-09-01T02:00:00.000Z",
      timeZone: "America/Los_Angeles",
      to: "2026-09-02",
    },
    metricPoints: [
      hrvSdnnPoint("2026-08-17", 60),
      hrvSdnnPoint("2026-08-18", 60),
      hrvSdnnPoint("2026-08-19", 60),
      hrvSdnnPoint("2026-08-24", 80),
      hrvSdnnPoint("2026-08-25", 90),
      hrvSdnnPoint("2026-08-26", 100),
    ],
  });

  assert.equal(snapshot.asOfDate, "2026-08-31");
  assert.equal(snapshot.to, "2026-08-30");
  assert.deepEqual(snapshot.days, [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ]);

  const steps = snapshot.metrics.find((metric) => metric.metricKey === "steps");
  assert.deepEqual(steps?.values, [200, null, 300, null, null, null, 400]);
  assert.equal(steps?.average, 300);
  assert.equal(steps?.trend.direction, "higher");

  const sleep = snapshot.metrics.find((metric) => metric.metricKey === "total-sleep-minutes");
  assert.deepEqual(sleep?.values, [null, 420, null, null, null, null, null]);

  const rmssd = snapshot.metrics.find((metric) => metric.metricKey === "hrv-rmssd");
  const sdnn = snapshot.metrics.find((metric) => metric.metricKey === "hrv-sdnn");
  assert.deepEqual(rmssd?.values.slice(0, 3), [40, 50, 60]);
  assert.deepEqual(sdnn?.values.slice(0, 3), [80, 90, 100]);
});

test("trend direction compares the displayed mean with the prior seven days", () => {
  const activityDays = [
    ["2026-08-17", 100],
    ["2026-08-18", 100],
    ["2026-08-19", 100],
    ["2026-08-20", 100],
    ["2026-08-21", 100],
    ["2026-08-22", 100],
    ["2026-08-23", 100],
    ["2026-08-24", 700],
    ["2026-08-25", 600],
    ["2026-08-26", 500],
    ["2026-08-27", 400],
    ["2026-08-28", 300],
    ["2026-08-29", 200],
    ["2026-08-30", 100],
  ].map(([date, value]) => ({
    date: date as string,
    steps: resolvedMetric({
      date: date as string,
      metric: "steps",
      unit: "count",
      value: value as number,
    }),
  }));
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: { activityDays, recoveryDays: [], sleepNights: [] },
    filters: {
      metricKeys: ["steps"],
      timeZone: "UTC",
      to: "2026-08-30",
    },
    metricPoints: [],
  });

  assert.deepEqual(snapshot.metrics[0]?.values, [700, 600, 500, 400, 300, 200, 100]);
  assert.equal(snapshot.metrics[0]?.average, 400);
  assert.equal(snapshot.metrics[0]?.trend.priorAverage, 100);
  assert.equal(snapshot.metrics[0]?.trend.direction, "higher");
});

test("seven-day trends remain unavailable when either calendar window is too sparse", () => {
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: {
      activityDays: [
        {
          date: "2026-08-23",
          steps: resolvedMetric({ date: "2026-08-23", metric: "steps", unit: "count", value: 100 }),
        },
        {
          date: "2026-08-30",
          steps: resolvedMetric({ date: "2026-08-30", metric: "steps", unit: "count", value: 200 }),
        },
      ],
      recoveryDays: [],
      sleepNights: [],
    },
    filters: {
      metricKeys: ["steps"],
      now: "2026-08-31T12:00:00.000Z",
      timeZone: "UTC",
    },
  });

  assert.deepEqual(snapshot.metrics[0]?.values, [null, null, null, null, null, null, 200]);
  assert.equal(snapshot.metrics[0]?.average, 200);
  assert.equal(snapshot.metrics[0]?.trend.priorAverage, 100);
  assert.equal(snapshot.metrics[0]?.trend.direction, "not_enough_data");
});

test("seven-day snapshots preserve all-missing rows without inventing zeros", () => {
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: { activityDays: [], recoveryDays: [], sleepNights: [] },
    filters: {
      metricKeys: [
        "steps",
        "total-sleep-minutes",
        "resting-heart-rate",
        "hrv-rmssd",
        "hrv-sdnn",
      ],
      now: "2026-08-30T12:00:00.000Z",
      timeZone: "UTC",
    },
  });

  assert.equal(snapshot.metrics.length, 5);
  for (const metric of snapshot.metrics) {
    assert.deepEqual(metric.values, [null, null, null, null, null, null, null]);
    assert.equal(metric.average, null);
    assert.equal(metric.observedDayCount, 0);
    assert.equal(metric.trend.direction, "not_enough_data");
  }
});

test("seven-day snapshots report steady only with enough equal-window evidence", () => {
  const activityDays = [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
  ].map((date) => ({
    date,
    steps: resolvedMetric({ date, metric: "steps", unit: "count", value: 100 }),
  }));
  const snapshot = buildWearableSevenDaySnapshot({
    bundle: { activityDays, recoveryDays: [], sleepNights: [] },
    filters: {
      metricKeys: ["steps"],
      now: "2026-08-30T12:00:00.000Z",
      timeZone: "UTC",
    },
  });

  assert.equal(snapshot.metrics[0]?.observedDayCount, 3);
  assert.equal(snapshot.metrics[0]?.trend.priorObservedDayCount, 3);
  assert.equal(snapshot.metrics[0]?.trend.delta, 0);
  assert.equal(snapshot.metrics[0]?.trend.direction, "steady");
});

test("seven-day window validation rejects invalid zones and generic HRV keys", () => {
  assert.throws(
    () => resolveWearableSevenDaySnapshotWindow({ timeZone: "not/a-zone" }),
    /Invalid IANA reporting time zone/u,
  );
  assert.throws(
    () => buildWearableSevenDaySnapshot({
      bundle: { activityDays: [], recoveryDays: [], sleepNights: [] },
      filters: { metricKeys: ["hrv" as never], now: "2026-08-30T12:00:00.000Z" },
    }),
    /Unsupported wearable seven-day metric/u,
  );
});
