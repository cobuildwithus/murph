import assert from "node:assert/strict";

import { test } from "vitest";

import { wearablesDayResultSchema } from "../src/commands/wearables.ts";

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
        notes: [],
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
      sourceFamily: "event" | "sample" | "derived" | null;
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
      level: "medium",
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
      resolution: "none",
      sourceFamily: null,
      sourceKind: null,
      title: null,
      unit: null,
      value: null,
    },
    ...overrides,
  };
}
