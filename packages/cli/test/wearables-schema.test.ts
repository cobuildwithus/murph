import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as coreRuntime from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";
import { test } from "vitest";

import {
  wearablesActivityListResultSchema,
  wearablesDayResultSchema,
  wearablesDriftResultSchema,
  wearablesLatestResultSchema,
  wearablesMetricLatestResultSchema,
  wearablesMetricTrendResultSchema,
} from "../src/commands/wearables.ts";

test("wearables activity schema preserves bounded workout features", () => {
  const parsed = wearablesActivityListResultSchema.parse({
    filters: {
      date: "2026-04-03",
      from: null,
      limit: 10,
      providers: ["garmin"],
      to: null,
    },
    items: [{
      activityAverageHeartRate: 106,
      date: "2026-04-03",
      minimumHeartRate: 52,
      provider: "garmin",
      workoutFeatures: [{
        activityType: "cycling",
        averageCadence: 90,
        averageHeartRate: 145,
        averagePowerWatts: 220,
        averageSpeedMps: 5,
        cadenceUnit: "rpm",
        provider: "garmin",
        splits: [],
        startedAt: "2026-04-03T18:00:00.000Z",
      }],
    }],
    count: 1,
    units: { activityAverageHeartRate: "bpm", minimumHeartRate: "bpm" },
    vault: "/tmp/example-vault",
  });

  const workout = parsed.items[0]?.workoutFeatures?.[0];
  assert.ok(workout && "splits" in workout);
  assert.deepEqual(workout.splits, []);
  assert.equal(parsed.items[0]?.activityAverageHeartRate, 106);
  assert.equal(parsed.items[0]?.minimumHeartRate, 52);
  assert.equal(parsed.items[0]?.provider, "garmin");
  assert.deepEqual(parsed.units, { activityAverageHeartRate: "bpm", minimumHeartRate: "bpm" });
  assert.equal(parsed.items[0]?.workoutFeatures?.[0]?.cadenceUnit, "rpm");
  assert.equal(parsed.items[0]?.workoutFeatures?.[0]?.averagePowerWatts, 220);
  assert.equal(parsed.items[0]?.workoutFeatures?.[0]?.averageSpeedMps, 5);
  assert.equal(
    Object.hasOwn(parsed.items[0]?.workoutFeatures?.[0] ?? {}, "averagePower"),
    false,
  );
  assert.equal(
    Object.hasOwn(parsed.items[0]?.workoutFeatures?.[0] ?? {}, "averageSpeed"),
    false,
  );
  assert.equal("vault" in parsed, false);
  const { splits: _splits, ...summaryWorkout } = workout;
  const summaryInput = {
    ...parsed,
    items: [{ ...parsed.items[0], workoutFeatures: [{ ...summaryWorkout, splitsOmitted: true }] }],
  };
  const summary = wearablesActivityListResultSchema.parse(summaryInput);
  assert.deepEqual(summary.items[0]?.workoutFeatures?.[0], { ...summaryWorkout, splitsOmitted: true });
  assert.equal(wearablesActivityListResultSchema.safeParse({
    ...parsed,
    items: [{ ...parsed.items[0], workoutFeatures: [summaryWorkout] }],
  }).success, false);
});

test("wearables day schema keeps fallback, conflict, low-confidence and unit details", () => {
  const parsed = wearablesDayResultSchema.parse({
    date: "2026-04-03",
    filters: {
      providers: [],
    },
    summary: {
      activity: {
        activityAverageHeartRate: 106,
        activityMinutes: 78,
        averageHeartRate: 76,
        confidence: "medium",
        highActivityMinutes: 5,
        lowActivityMinutes: 60,
        lowestHeartRate: 44,
        mediumActivityMinutes: 13,
        minimumHeartRate: 52,
        notes: ["Some metrics still conflict across providers: Steps."],
        provider: "garmin",
        steps: { confidence: "medium", conflictingProviders: ["oura"], value: 9_120 },
        walkingAverageHeartRate: 101,
      },
      confidence: "low",
      date: "2026-04-03",
      providers: ["garmin", "oura"],
      sleep: {
        confidence: "low",
        hrv: { provider: "garmin", value: 51 },
        lowestSpo2: 94,
        notes: [
          "Used sleep-session duration because total sleep minutes were unavailable.",
          "The selected sleep session is a tentative provider estimate and may change.",
        ],
        provider: "oura",
        sessionMinutes: 430,
        sleepEndAt: "2026-04-03T07:00:00.000Z",
        sleepLatencyMinutes: { confidence: "low", value: 15 },
        sleepStartAt: "2026-04-02T23:50:00.000Z",
        spo2: { unit: "fraction", value: 0.97 },
        totalSleepMinutes: { fallbackFromMetric: "sessionMinutes", value: 430 },
      },
      sourceHealth: [{
        conflictCount: 1,
        firstDate: "2026-04-03",
        lastDate: "2026-04-03",
        provider: "garmin",
        stalenessVsNewestDays: 2,
      }],
    },
    units: {
      activityAverageHeartRate: "bpm",
      lowestSpo2: "%",
      sessionMinutes: "minutes",
      steps: "count",
      totalSleepMinutes: "minutes",
    },
    vault: "/tmp/example-vault",
  });

  assert.equal(parsed.summary?.activity?.activityMinutes, 78);
  assert.equal(parsed.summary?.activity?.provider, "garmin");
  assert.equal(parsed.summary?.activity?.confidence, "medium");
  assert.deepEqual(parsed.summary?.activity?.steps, {
    confidence: "medium",
    conflictingProviders: ["oura"],
    value: 9_120,
  });
  assert.deepEqual(parsed.summary?.sleep?.hrv, { provider: "garmin", value: 51 });
  assert.deepEqual(parsed.summary?.sleep?.sleepLatencyMinutes, { confidence: "low", value: 15 });
  assert.deepEqual(parsed.summary?.sleep?.spo2, { unit: "fraction", value: 0.97 });
  assert.deepEqual(parsed.summary?.sleep?.totalSleepMinutes, {
    fallbackFromMetric: "sessionMinutes",
    value: 430,
  });
  assert.equal(parsed.summary?.sleep?.confidence, "low");
  assert.equal(parsed.summary?.confidence, "low");
  assert.equal(parsed.summary?.sourceHealth?.[0]?.stalenessVsNewestDays, 2);
  assert.equal(parsed.units?.totalSleepMinutes, "minutes");
  assert.equal("vault" in parsed, false);
});

test("Junction activity heart-rate facts survive persistence, query compaction, and CLI parsing", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-cli-junction-activity-heart-rate-"));

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-08-09T00:00:00.000Z",
      timezone: "UTC",
    });
    await importDeviceProviderSnapshot(
      {
        provider: "junction",
        sourceKind: "poll",
        deliveryMode: "scheduled_reconcile",
        vaultRoot,
        snapshot: {
          importedAt: "2026-08-11T12:00:00.000Z",
          summaries: {
            activity: [{
              id: "activity-heart-rate-cli-boundary",
              observed_at: "2026-08-11T12:00:00.000Z",
              average_heart_rate: 106,
              minimum_heart_rate: 52,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
      { corePort: coreRuntime },
    );

    const services = createIntegratedVaultServices();
    const compactDay = await services.query.showWearableDay({
      vault: vaultRoot,
      date: "2026-08-11",
      providers: [],
      requestId: "test-junction-activity-heart-rate-cli-boundary",
    });
    const parsed = wearablesDayResultSchema.parse(compactDay);

    assert.equal(parsed.summary?.activity?.activityAverageHeartRate, 106);
    assert.equal(parsed.summary?.activity?.minimumHeartRate, 52);
    assert.equal(parsed.summary?.activity?.provider, "garmin");
    assert.equal(parsed.units?.activityAverageHeartRate, "bpm");
    assert.equal(parsed.units?.minimumHeartRate, "bpm");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("additive wearables schemas stay compact and metric-aware", () => {
  const latestParsed = wearablesLatestResultSchema.parse({
    filters: {
      date: null,
      from: null,
      providers: [],
      to: null,
    },
    summary: {
      day: {
        activity: {
          activityAverageHeartRate: 106,
          minimumHeartRate: 52,
          provider: "oura",
        },
        date: "2026-04-05",
        providers: ["oura"],
      },
      latestDate: "2026-04-05",
      notes: ["Latest body-state summary date 2026-04-01 differs from the joined wearable latest day 2026-04-05."],
      providers: ["oura"],
      sleep: {
        date: "2026-04-05",
      },
      sourceHealth: [],
    },
    units: { activityAverageHeartRate: "bpm", minimumHeartRate: "bpm" },
    vault: "/tmp/example-vault",
  });

  const metricLatestParsed = wearablesMetricLatestResultSchema.parse({
    filters: {
      date: null,
      from: null,
      metric: "resting-heart-rate",
      providers: [],
      to: null,
      windowDays: 7,
    },
    summary: {
      confidence: "medium",
      conflictingProviders: ["garmin"],
      date: "2026-04-05",
      delta: -3,
      paths: ["derived/query/wearables.json"],
      max: 58,
      metric: "restingHeartRate",
      min: 55,
      notes: ["Resting heart rate improved over the recent window."],
      percentChange: -5.17,
      priorWindow: {
        average: 58,
        count: 2,
        from: "2026-04-01",
        max: 59,
        min: 57,
        to: "2026-04-02",
      },
      provider: "oura",
      recentWindow: {
        average: 55,
        count: 2,
        from: "2026-04-04",
        max: 56,
        min: 54,
        to: "2026-04-05",
      },
      recordedAt: "2026-04-05T07:05:00.000Z",
      recordIds: ["wearable_metric_01"],
      summaryKind: "recovery",
      unit: "bpm",
      value: 55,
    },
    vault: "/tmp/example-vault",
  });

  const metricTrendParsed = wearablesMetricTrendResultSchema.parse({
    filters: {
      date: null,
      from: null,
      metric: "hrv",
      providers: [],
      to: null,
      windowDays: 7,
    },
    summary: {
      date: "2026-04-05",
      delta: 6,
      max: 48,
      metric: "hrv",
      min: 42,
      notes: ["HRV improved over the recent window."],
      percentChange: 14.29,
      points: [
        { confidence: "low", date: "2026-04-03", provider: "garmin", value: 42 },
        { date: "2026-04-05", value: 48 },
      ],
      priorWindow: {
        average: 42,
        count: 1,
        from: "2026-04-03",
        max: 42,
        min: 42,
        to: "2026-04-03",
      },
      provider: "oura",
      recentWindow: {
        average: 48,
        count: 1,
        from: "2026-04-05",
        max: 48,
        min: 48,
        to: "2026-04-05",
      },
      recordedAt: "2026-04-05T07:05:00.000Z",
      summaryKind: "sleep",
      unit: "ms",
      value: 48,
    },
    vault: "/tmp/example-vault",
  });

  const driftParsed = wearablesDriftResultSchema.parse({
    filters: {
      date: null,
      from: null,
      providers: [],
      to: null,
      windowDays: 7,
    },
    summary: {
      latest: latestParsed.summary,
      notes: ["HRV improved meaningfully over the recent window."],
      signals: [
        {
          date: "2026-04-05",
          delta: 6,
          metric: "hrv",
          max: 48,
          min: 42,
          notes: ["HRV rose versus the baseline window."],
          percentChange: 14.29,
          priorWindow: {
            average: 42,
            count: 1,
            from: "2026-04-03",
            max: 42,
            min: 42,
            to: "2026-04-03",
          },
          provider: "oura",
          recentWindow: {
            average: 48,
            count: 1,
            from: "2026-04-05",
            max: 48,
            min: 48,
            to: "2026-04-05",
          },
          summaryKind: "sleep",
          unit: "ms",
          value: 48,
        },
      ],
      windowDays: 7,
    },
    vault: "/tmp/example-vault",
  });

  assert.equal(latestParsed.summary?.day.date, "2026-04-05");
  assert.equal(latestParsed.summary?.day.activity?.activityAverageHeartRate, 106);
  assert.equal(latestParsed.summary?.day.activity?.minimumHeartRate, 52);
  assert.equal(latestParsed.units?.minimumHeartRate, "bpm");
  assert.equal(Object.hasOwn(latestParsed.summary as Record<string, unknown>, "sleep"), false);
  assert.equal(Object.hasOwn(latestParsed.summary as Record<string, unknown>, "sourceHealth"), false);
  assert.equal("vault" in latestParsed, false);
  assert.equal(metricLatestParsed.summary?.metric, "restingHeartRate");
  assert.equal(metricLatestParsed.summary?.confidence, "medium");
  assert.deepEqual(metricLatestParsed.summary?.conflictingProviders, ["garmin"]);
  assert.equal(
    Object.hasOwn(metricLatestParsed.summary as Record<string, unknown>, "paths"),
    false,
  );
  assert.equal(
    Object.hasOwn(metricLatestParsed.summary as Record<string, unknown>, "recordIds"),
    false,
  );
  assert.equal("vault" in metricLatestParsed, false);
  assert.deepEqual(metricTrendParsed.summary?.points, [
    { confidence: "low", date: "2026-04-03", provider: "garmin", value: 42 },
    { date: "2026-04-05", value: 48 },
  ]);
  assert.equal("vault" in metricTrendParsed, false);
  assert.equal(driftParsed.summary?.signals[0]?.metric, "hrv");
  assert.equal(Object.hasOwn(driftParsed.summary as Record<string, unknown>, "latest"), false);
  assert.equal("vault" in driftParsed, false);
});

test("wearables schemas reject unresolved full metric envelopes", () => {
  const parsed = wearablesDayResultSchema.safeParse({
    date: "2026-04-03",
    filters: {
      providers: [],
    },
    summary: {
      date: "2026-04-03",
      providers: ["oura"],
      sleep: {
        date: "2026-04-03",
        sessionMinutes: {
          candidates: [],
          confidence: {
            candidateCount: 1,
            conflictingProviders: [],
            exactDuplicateCount: 0,
            level: "high",
            reasons: ["Selected Oura sleep summary."],
          },
          metric: "sessionMinutes",
          selection: {
            paths: ["ledger/events/2026/2026-04.jsonl"],
            provider: "oura",
            recordIds: ["evt_sleep_01"],
            unit: "minutes",
            value: 430,
          },
        },
        summaryConfidence: {
          level: "high",
        },
      },
      summaryConfidence: "high",
    },
  });

  assert.equal(parsed.success, false);
});
