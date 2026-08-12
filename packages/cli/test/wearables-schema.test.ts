import assert from "node:assert/strict";

import { test } from "vitest";

import {
  wearablesDayResultSchema,
  wearablesDriftResultSchema,
  wearablesLatestResultSchema,
  wearablesMetricLatestResultSchema,
  wearablesMetricTrendResultSchema,
} from "../src/commands/wearables.ts";

test("wearables day schema preserves compact fallback metadata", () => {
  const parsed = wearablesDayResultSchema.parse({
    date: "2026-04-03",
    filters: {
      providers: [],
    },
    summary: {
      activity: {
        activityMinutes: compactResolvedMetric({ metric: "activityMinutes", unit: "minutes", value: 78 }),
        averageHeartRate: compactResolvedMetric({ metric: "averageHeartRate", unit: "bpm", value: 76 }),
        date: "2026-04-03",
        highActivityMinutes: compactResolvedMetric({ metric: "highActivityMinutes", unit: "minutes", value: 5 }),
        lowActivityMinutes: compactResolvedMetric({ metric: "lowActivityMinutes", unit: "minutes", value: 60 }),
        lowestHeartRate: compactResolvedMetric({ metric: "lowestHeartRate", unit: "bpm", value: 44 }),
        mediumActivityMinutes: compactResolvedMetric({ metric: "mediumActivityMinutes", unit: "minutes", value: 13 }),
        summaryConfidence: {
          level: "high",
        },
        walkingAverageHeartRate: compactResolvedMetric({ metric: "walkingAverageHeartRate", unit: "bpm", value: 101 }),
      },
      date: "2026-04-03",
      providers: ["oura"],
      sleep: {
        date: "2026-04-03",
        lowestSpo2: compactResolvedMetric({ metric: "lowestSpo2", value: 94 }),
        provider: "oura",
        sessionMinutes: resolvedMetric({
          fallbackFromMetric: "totalSleepMinutes",
          fallbackReason: "Used sleep-session duration because total sleep minutes were unavailable.",
          occurredAt: "2026-04-03T07:00:00.000Z",
          provider: "oura",
          recordedAt: "2026-04-03T07:05:00.000Z",
          sourceKind: "sleep_session",
          title: "Overnight sleep",
          unit: "minutes",
          value: 430,
        }),
        sleepEndAt: "2026-04-03T07:00:00.000Z",
        sleepLatencyMinutes: compactResolvedMetric({ metric: "sleepLatencyMinutes", unit: "minutes", value: 15 }),
        sleepStartAt: "2026-04-02T23:50:00.000Z",
        sleepWindowProvider: "oura",
        summaryConfidence: {
          level: "medium",
          selectedProviders: ["oura"],
        },
      },
      summaryConfidence: "medium",
    },
    vault: "/tmp/example-vault",
  });

  assert.equal(parsed.summary?.activity?.activityMinutes?.value, 78);
  assert.equal(parsed.summary?.activity?.lowActivityMinutes?.value, 60);
  assert.equal(parsed.summary?.activity?.mediumActivityMinutes?.value, 13);
  assert.equal(parsed.summary?.activity?.highActivityMinutes?.value, 5);
  assert.equal(parsed.summary?.activity?.averageHeartRate?.value, 76);
  assert.equal(parsed.summary?.activity?.walkingAverageHeartRate?.value, 101);
  assert.equal(parsed.summary?.activity?.lowestHeartRate?.value, 44);
  assert.equal(parsed.summary?.sleep?.sleepLatencyMinutes?.value, 15);
  assert.equal(
    parsed.summary?.sleep?.sessionMinutes?.fallbackReason,
    "Used sleep-session duration because total sleep minutes were unavailable.",
  );
  assert.equal(parsed.summary?.sleep?.sessionMinutes?.fallbackFromMetric, "totalSleepMinutes");
  assert.equal(parsed.summary?.sleep?.lowestSpo2?.metric, "lowestSpo2");
  assert.equal("vault" in parsed, false);
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
        date: "2026-04-05",
        notes: ["Latest wearable day was sourced from oura."],
        providers: ["oura"],
        summaryConfidence: "high",
      },
      latestDate: "2026-04-05",
      notes: ["Latest wearable day was sourced from oura."],
      providers: ["oura"],
      sleep: {
        date: "2026-04-05",
        summaryConfidence: {
          level: "high",
        },
      },
      sourceHealth: [],
    },
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
      confidence: {
        candidateCount: 1,
        conflictingProviders: [],
        exactDuplicateCount: 0,
        level: "high",
        reasons: ["Selected Oura recovery summary."],
      },
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
      requestedMetric: "resting-heart-rate",
      resolvedAlias: "resting-heart-rate",
      summaryKind: "recovery",
      unit: "bpm",
      value: 55,
      windowDays: 7,
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
      confidence: {
        candidateCount: 1,
        conflictingProviders: [],
        exactDuplicateCount: 0,
        level: "high",
      },
      date: "2026-04-05",
      delta: 6,
      max: 48,
      metric: "hrv",
      min: 42,
      notes: ["HRV improved over the recent window."],
      percentChange: 14.29,
      points: [
        {
          confidence: "high",
          date: "2026-04-03",
          provider: "oura",
          recordedAt: "2026-04-03T07:05:00.000Z",
          unit: "ms",
          value: 42,
        },
        {
          confidence: "high",
          date: "2026-04-05",
          provider: "oura",
          recordedAt: "2026-04-05T07:05:00.000Z",
          unit: "ms",
          value: 48,
        },
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
      requestedMetric: "hrv",
      resolvedAlias: null,
      summaryKind: "sleep",
      unit: "ms",
      value: 48,
      windowDays: 7,
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
          confidence: {
            candidateCount: 1,
            conflictingProviders: [],
            exactDuplicateCount: 0,
            level: "high",
          },
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
          recordedAt: "2026-04-05T07:05:00.000Z",
          requestedMetric: "hrv",
          resolvedAlias: null,
          summaryKind: "sleep",
          unit: "ms",
          value: 48,
          windowDays: 7,
        },
      ],
      windowDays: 7,
    },
    vault: "/tmp/example-vault",
  });

  assert.equal(latestParsed.summary?.day.date, "2026-04-05");
  assert.equal(Object.hasOwn(latestParsed.summary as Record<string, unknown>, "sleep"), false);
  assert.equal(Object.hasOwn(latestParsed.summary as Record<string, unknown>, "sourceHealth"), false);
  assert.equal("vault" in latestParsed, false);
  assert.equal(metricLatestParsed.summary?.metric, "restingHeartRate");
  assert.equal(
    Object.hasOwn(metricLatestParsed.summary as Record<string, unknown>, "paths"),
    false,
  );
  assert.equal(
    Object.hasOwn(metricLatestParsed.summary as Record<string, unknown>, "recordIds"),
    false,
  );
  assert.equal(
    Object.hasOwn(metricLatestParsed.summary?.confidence as Record<string, unknown>, "reasons"),
    false,
  );
  assert.equal("vault" in metricLatestParsed, false);
  assert.equal(metricTrendParsed.summary?.windowDays, 7);
  assert.equal("vault" in metricTrendParsed, false);
  assert.equal(driftParsed.summary?.signals[0]?.metric, "hrv");
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

function resolvedMetric(
  overrides: Partial<{
    candidateCount: number;
    confidence: "none" | "low" | "medium" | "high";
    conflictingProviders: string[];
    exactDuplicateCount: number;
    fallbackFromMetric: string | null;
    fallbackReason: string | null;
    metric: string;
    occurredAt: string | null;
    provider: string | null;
    recordedAt: string | null;
    sourceKind: string | null;
    title: string | null;
    unit: string | null;
    value: number | null;
  }> = {},
) {
  return {
    confidence: "medium" as const,
    metric: "sleepTotalMinutes",
    value: null,
    ...overrides,
  };
}

function compactResolvedMetric(overrides: Partial<ReturnType<typeof resolvedMetric>> = {}) {
  return resolvedMetric({
    confidence: "high",
    metric: "sleepTotalMinutes",
    provider: "oura",
    unit: "minutes",
    value: 430,
    ...overrides,
  });
}
