import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

test("showWearableLatest forwards normalized surface filters to the shared query runtime", async () => {
  const summarizeWearableLatestRuntime = vi.fn(async () => ({
    latestDate: "2026-04-04",
    day: {
      date: "2026-04-04",
      providers: ["whoop"],
      summaryConfidence: "high",
      sleep: {
        date: "2026-04-04",
        summaryConfidence: {
          conflictingMetrics: [],
          level: "high",
          lowConfidenceMetrics: [],
          notes: [],
          selectedProviders: ["whoop"],
        },
        totalSleepMinutes: {
          metric: "totalSleepMinutes",
          candidates: [{
            candidateId: "candidate_01",
            externalRef: {
              resourceId: "provider-resource-01",
            },
            paths: ["ledger/events/2026/2026-04.jsonl"],
            recordIds: ["evt_sleep_01"],
          }],
          confidence: {
            candidateCount: 1,
            conflictingProviders: [],
            exactDuplicateCount: 0,
            level: "high",
            reasons: ["Selected WHOOP sleep summary."],
          },
          selection: {
            dataOrigin: {
              provider: "whoop",
              ingestSessionId: "import_session_01",
            },
            paths: ["ledger/events/2026/2026-04.jsonl"],
            provider: "whoop",
            recordIds: ["evt_sleep_01"],
            unit: "minutes",
            value: 420,
          },
        },
        sleepScore: {
          metric: "sleepScore",
          candidates: [],
          confidence: {
            candidateCount: 0,
            conflictingProviders: [],
            exactDuplicateCount: 0,
            level: "none",
            reasons: [],
          },
          selection: {
            provider: null,
            value: null,
          },
        },
      },
    },
    sleep: {
      date: "2026-04-04",
      summaryConfidence: {
        conflictingMetrics: [],
        level: "high",
        lowConfidenceMetrics: [],
        notes: [],
        selectedProviders: ["whoop"],
      },
      totalSleepMinutes: {
        metric: "totalSleepMinutes",
        candidates: [{
          candidateId: "candidate_01",
          externalRef: {
            resourceId: "provider-resource-01",
          },
          paths: ["ledger/events/2026/2026-04.jsonl"],
          recordIds: ["evt_sleep_01"],
        }],
        confidence: {
          candidateCount: 1,
          conflictingProviders: [],
          exactDuplicateCount: 0,
          level: "high",
          reasons: ["Selected WHOOP sleep summary."],
        },
        selection: {
          dataOrigin: {
            provider: "whoop",
            ingestSessionId: "import_session_01",
          },
          paths: ["ledger/events/2026/2026-04.jsonl"],
          provider: "whoop",
          recordIds: ["evt_sleep_01"],
          unit: "minutes",
          value: 420,
        },
      },
    },
  }));
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    summarizeWearableLatestRuntime,
  }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadCoreRuntime,
      loadImporterRuntime,
      loadQueryRuntime,
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const result = await services.query.showWearableLatest({
    vault: "./vault",
    requestId: null,
    date: "2026-04-04",
    providers: [" oura ", "oura"],
  });

  assert.deepEqual(summarizeWearableLatestRuntime.mock.calls, [["./vault", {
    date: "2026-04-04",
    from: undefined,
    to: undefined,
    providers: ["oura"],
  }]]);
  assert.deepEqual(result, {
    filters: {
      date: "2026-04-04",
      from: "2026-04-04",
      to: "2026-04-04",
      providers: ["oura"],
    },
    summary: {
      latestDate: "2026-04-04",
      day: {
        date: "2026-04-04",
        providers: ["whoop"],
        summaryConfidence: "high",
        sleep: {
          date: "2026-04-04",
          summaryConfidence: {
            level: "high",
            selectedProviders: ["whoop"],
          },
          totalSleepMinutes: {
            confidence: "high",
            metric: "totalSleepMinutes",
            provider: "whoop",
            unit: "minutes",
            value: 420,
          },
        },
      },
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("selection"), false);
  assert.equal(serialized.includes("candidates"), false);
  assert.equal(serialized.includes("paths"), false);
  assert.equal(serialized.includes("recordIds"), false);
  assert.equal(serialized.includes("reasons"), false);
  assert.equal(serialized.includes("candidate_01"), false);
  assert.equal(serialized.includes("provider-resource-01"), false);
  assert.equal(serialized.includes("import_session_01"), false);
  assert.equal(serialized.includes("dataOrigin"), false);
  assert.equal(serialized.includes("ledger/events"), false);
  assert.equal(serialized.includes("evt_sleep_01"), false);
  assert.equal(serialized.includes("sleepScore"), false);
  assert.equal(Object.hasOwn(result.summary as Record<string, unknown>, "sleep"), false);
  assert.equal(loadQueryRuntime.mock.calls.length, 1);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});

test("wearable day and drift outputs compact verbose metric envelopes", async () => {
  const verboseDaySummary = {
    date: "2026-04-04",
    providers: ["whoop"],
    summaryConfidence: "high",
    sleep: {
      date: "2026-04-04",
      summaryConfidence: {
        conflictingMetrics: [],
        level: "high",
        lowConfidenceMetrics: [],
        notes: [],
        selectedProviders: ["whoop"],
      },
      totalSleepMinutes: {
        metric: "totalSleepMinutes",
        candidates: [{
          candidateId: "candidate_01",
          paths: ["ledger/events/2026/2026-04.jsonl"],
          recordIds: ["evt_sleep_01"],
        }],
        confidence: {
          candidateCount: 1,
          conflictingProviders: [],
          exactDuplicateCount: 0,
          level: "high",
          reasons: ["Selected WHOOP sleep summary."],
        },
        selection: {
          dataOrigin: {
            provider: "whoop",
          },
          paths: ["ledger/events/2026/2026-04.jsonl"],
          provider: "whoop",
          recordIds: ["evt_sleep_01"],
          unit: "minutes",
          value: 420,
        },
      },
      sleepScore: {
        metric: "sleepScore",
        candidates: [],
        confidence: {
          candidateCount: 0,
          conflictingProviders: [],
          exactDuplicateCount: 0,
          level: "none",
          reasons: [],
        },
        selection: {
          provider: null,
          value: null,
        },
      },
    },
  };
  const summarizeWearableDayRuntime = vi.fn(async () => verboseDaySummary);
  const explainWearableDriftRuntime = vi.fn(async () => ({
    latest: {
      activity: {
        date: "2026-04-04",
        summaryConfidence: {
          level: "high",
        },
      },
      day: verboseDaySummary,
      latestDate: "2026-04-04",
      providers: ["whoop"],
      sleep: verboseDaySummary.sleep,
      sourceHealth: [],
    },
    notes: [],
    signals: [],
    windowDays: 7,
  }));
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    explainWearableDriftRuntime,
    summarizeWearableDayRuntime,
  }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadCoreRuntime,
      loadImporterRuntime,
      loadQueryRuntime,
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const day = await services.query.showWearableDay({
    vault: "./vault",
    requestId: null,
    date: "2026-04-04",
  });
  const drift = await services.query.showWearableDrift({
    vault: "./vault",
    requestId: null,
  });

  assert.deepEqual(day.summary?.sleep, {
    date: "2026-04-04",
    summaryConfidence: {
      level: "high",
      selectedProviders: ["whoop"],
    },
    totalSleepMinutes: {
      confidence: "high",
      metric: "totalSleepMinutes",
      provider: "whoop",
      unit: "minutes",
      value: 420,
    },
  });
  assert.equal(Object.hasOwn(drift.summary?.latest as Record<string, unknown>, "sleep"), false);
  assert.equal(Object.hasOwn(drift.summary?.latest as Record<string, unknown>, "activity"), false);
  assert.equal(Object.hasOwn(drift.summary?.latest as Record<string, unknown>, "sourceHealth"), false);

  for (const compactOutput of [day, drift]) {
    const serialized = JSON.stringify(compactOutput);
    assert.equal(serialized.includes("selection"), false);
    assert.equal(serialized.includes("candidates"), false);
    assert.equal(serialized.includes("paths"), false);
    assert.equal(serialized.includes("recordIds"), false);
    assert.equal(serialized.includes("reasons"), false);
    assert.equal(serialized.includes("dataOrigin"), false);
    assert.equal(serialized.includes("sleepScore"), false);
  }
  assert.equal(loadQueryRuntime.mock.calls.length, 2);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});

test("metric and drift wearable service methods use the shared assistant-aligned method names", async () => {
  const summarizeWearableMetricLatestRuntime = vi.fn(async () => ({ metric: "restingHeartRate" }));
  const summarizeWearableMetricTrendRuntime = vi.fn(async () => ({ metric: "restingHeartRate", points: [] }));
  const explainWearableDriftRuntime = vi.fn(async () => ({ windowDays: 7, signals: [] }));
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    summarizeWearableMetricLatestRuntime,
    summarizeWearableMetricTrendRuntime,
    explainWearableDriftRuntime,
  }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadCoreRuntime,
      loadImporterRuntime,
      loadQueryRuntime,
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const metricLatest = await services.query.showWearableMetricLatest({
    vault: "./vault",
    requestId: null,
    metric: " rhr ",
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura", "oura", "garmin"],
    windowDays: 3,
  });
  const metricTrend = await services.query.showWearableMetricTrend({
    vault: "./vault",
    requestId: null,
    metric: "rhr",
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura"],
    windowDays: 3,
  });
  const drift = await services.query.showWearableDrift({
    vault: "./vault",
    requestId: null,
    providers: ["oura"],
  });

  assert.deepEqual(summarizeWearableMetricLatestRuntime.mock.calls, [["./vault", "rhr", {
    date: undefined,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura", "garmin"],
    windowDays: 3,
  }]]);
  assert.deepEqual(summarizeWearableMetricTrendRuntime.mock.calls, [["./vault", "rhr", {
    date: undefined,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura"],
    windowDays: 3,
  }]]);
  assert.deepEqual(explainWearableDriftRuntime.mock.calls, [["./vault", {
    date: undefined,
    from: undefined,
    to: undefined,
    providers: ["oura"],
    windowDays: 7,
  }]]);

  assert.deepEqual(metricLatest.filters, {
    date: null,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura", "garmin"],
    metric: "rhr",
    windowDays: 3,
  });
  assert.deepEqual(metricTrend.filters, {
    date: null,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura"],
    metric: "rhr",
    windowDays: 3,
  });
  assert.deepEqual(drift, {
    filters: {
      date: null,
      from: null,
      to: null,
      providers: ["oura"],
      windowDays: 7,
    },
    summary: {
      windowDays: 7,
      signals: [],
    },
  });
  assert.equal(loadQueryRuntime.mock.calls.length, 3);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});

test("wearable services preserve explicit blank provider filters as empty runtime filters", async () => {
  const summarizeWearableDayRuntime = vi.fn(async () => null);
  const summarizeWearableLatestRuntime = vi.fn(async () => null);
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    summarizeWearableDayRuntime,
    summarizeWearableLatestRuntime,
  }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadCoreRuntime,
      loadImporterRuntime,
      loadQueryRuntime,
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const latest = await services.query.showWearableLatest({
    vault: "./vault",
    requestId: null,
    providers: [" "],
  });
  const day = await services.query.showWearableDay({
    vault: "./vault",
    requestId: null,
    date: "2026-04-04",
    providers: [" "],
  });

  assert.deepEqual(summarizeWearableLatestRuntime.mock.calls, [["./vault", {
    date: undefined,
    from: undefined,
    to: undefined,
    providers: [],
  }]]);
  assert.deepEqual(summarizeWearableDayRuntime.mock.calls, [["./vault", "2026-04-04", {
    providers: [],
  }]]);
  assert.deepEqual(latest.filters.providers, []);
  assert.deepEqual(day.filters.providers, []);
  assert.equal(loadQueryRuntime.mock.calls.length, 2);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});
