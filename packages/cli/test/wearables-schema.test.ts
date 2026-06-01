import assert from "node:assert/strict";

import { test } from "vitest";

import {
  wearablesDayResultSchema,
  wearablesDriftResultSchema,
  wearablesLatestResultSchema,
  wearablesMetricLatestResultSchema,
  wearablesMetricTrendResultSchema,
} from "../src/commands/wearables.ts";

test("wearables day schema preserves fallback selection metadata", () => {
  const parsed = wearablesDayResultSchema.parse({
    date: "2026-04-03",
    filters: {
      providers: [],
    },
    summary: {
      activity: null,
      bodyState: null,
      date: "2026-04-03",
      notes: [],
      providers: ["oura"],
      recovery: null,
      sleep: {
        averageHeartRate: resolvedMetric(),
        awakeMinutes: resolvedMetric(),
        date: "2026-04-03",
        deepMinutes: resolvedMetric(),
        hrv: resolvedMetric(),
        lightMinutes: resolvedMetric(),
        lowestHeartRate: resolvedMetric(),
        lowestSpo2: resolvedMetric({ metric: "lowestSpo2" }),
        notes: [],
        provider: "oura",
        remMinutes: resolvedMetric(),
        respiratoryRate: resolvedMetric(),
        sessionMinutes: resolvedMetric({
          selection: {
            fallbackFromMetric: "totalSleepMinutes",
            fallbackReason: "Used sleep-session duration because total sleep minutes were unavailable.",
            occurredAt: "2026-04-03T07:00:00.000Z",
            paths: ["ledger/events/2026/2026-04.jsonl"],
            provider: "oura",
            recordedAt: "2026-04-03T07:05:00.000Z",
            recordIds: ["evt_sleep_01"],
            resolution: "fallback",
            sourceFamily: "event",
            sourceKind: "sleep_session",
            title: "Overnight sleep",
            unit: "minutes",
            value: 430,
          },
        }),
        sleepConsistency: resolvedMetric(),
        sleepEfficiency: resolvedMetric(),
        sleepEndAt: "2026-04-03T07:00:00.000Z",
        sleepPerformance: resolvedMetric(),
        sleepScore: resolvedMetric(),
        sleepStartAt: "2026-04-02T23:50:00.000Z",
        sleepWindowProvider: "oura",
        spo2: resolvedMetric(),
        summaryConfidence: {
          conflictingMetrics: [],
          level: "medium",
          lowConfidenceMetrics: [],
          notes: [],
          selectedProviders: ["oura"],
        },
        timeInBedMinutes: resolvedMetric(),
        totalSleepMinutes: resolvedMetric(),
      },
      sourceHealth: [],
      summaryConfidence: "medium",
    },
    vault: "/tmp/example-vault",
  });

  assert.equal(
    parsed.summary?.sleep?.sessionMinutes.selection.fallbackReason,
    "Used sleep-session duration because total sleep minutes were unavailable.",
  );
  assert.equal(parsed.summary?.sleep?.sessionMinutes.selection.resolution, "fallback");
  assert.equal(parsed.summary?.sleep?.sessionMinutes.selection.fallbackFromMetric, "totalSleepMinutes");
  assert.equal(parsed.summary?.sleep?.lowestSpo2.metric, "lowestSpo2");
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
      activity: null,
      bodyState: null,
      day: {
        activity: null,
        bodyState: null,
        date: "2026-04-05",
        notes: ["Latest wearable day was sourced from oura."],
        providers: ["oura"],
        recovery: null,
        sleep: null,
        sourceHealth: [],
        summaryConfidence: "high",
      },
      latestDate: "2026-04-05",
      notes: ["Latest wearable day was sourced from oura."],
      providers: ["oura"],
      recovery: null,
      sleep: null,
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
        reasons: [],
      },
      date: "2026-04-05",
      delta: -3,
      max: 58,
      metric: "restingHeartRate",
      min: 55,
      notes: ["Resting heart rate improved over the recent window."],
      paths: ["derived/query/wearables.json"],
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
        reasons: [],
      },
      date: "2026-04-05",
      delta: 6,
      max: 48,
      metric: "hrv",
      min: 42,
      notes: ["HRV improved over the recent window."],
      paths: ["derived/query/wearables.json"],
      percentChange: 14.29,
      points: [
        {
          confidence: "high",
          date: "2026-04-03",
          paths: ["derived/query/wearables.json"],
          provider: "oura",
          recordedAt: "2026-04-03T07:05:00.000Z",
          recordIds: ["wearable_metric_00"],
          unit: "ms",
          value: 42,
        },
        {
          confidence: "high",
          date: "2026-04-05",
          paths: ["derived/query/wearables.json"],
          provider: "oura",
          recordedAt: "2026-04-05T07:05:00.000Z",
          recordIds: ["wearable_metric_01"],
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
      recordIds: ["wearable_metric_01"],
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
            reasons: [],
          },
          date: "2026-04-05",
          delta: 6,
          metric: "hrv",
          max: 48,
          min: 42,
          notes: ["HRV rose versus the baseline window."],
          paths: ["derived/query/wearables.json"],
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
          recordIds: ["wearable_metric_01"],
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
  assert.equal("vault" in latestParsed, false);
  assert.equal(metricLatestParsed.summary?.metric, "restingHeartRate");
  assert.equal("vault" in metricLatestParsed, false);
  assert.equal(metricTrendParsed.summary?.windowDays, 7);
  assert.equal("vault" in metricTrendParsed, false);
  assert.equal(driftParsed.summary?.signals[0]?.metric, "hrv");
  assert.equal("vault" in driftParsed, false);
});

function resolvedMetric(
  overrides: Partial<{
    candidates: Array<Record<string, unknown>>;
    confidence: {
      candidateCount: number;
      conflictingProviders: string[];
      exactDuplicateCount: number;
      level: "none" | "low" | "medium" | "high";
      reasons: string[];
    };
    metric: string;
    selection: {
      fallbackFromMetric: string | null;
      fallbackReason: string | null;
      occurredAt: string | null;
      paths: string[];
      provider: string | null;
      recordedAt: string | null;
      recordIds: string[];
      resolution: "direct" | "fallback" | "none";
      sourceFamily: "canonical" | "event" | "sample" | "derived" | null;
      sourceKind: string | null;
      title: string | null;
      unit: string | null;
      value: number | null;
    };
  }> = {},
) {
  return {
    candidates: [],
    confidence: {
      candidateCount: 1,
      conflictingProviders: [],
      exactDuplicateCount: 0,
      level: "medium" as const,
      reasons: [],
    },
    metric: "sleepTotalMinutes",
    selection: {
      fallbackFromMetric: null,
      fallbackReason: null,
      occurredAt: null,
      paths: [],
      provider: null,
      recordedAt: null,
      recordIds: [],
      resolution: "none" as const,
      sourceFamily: null,
      sourceKind: null,
      title: null,
      unit: null,
      value: null,
    },
    ...overrides,
  };
}
