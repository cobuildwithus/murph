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

test("showWearableSleepPattern forwards the normalized window and preserves every caveat", async () => {
  const notes = Array.from({ length: 10 }, (_, index) => `sleep caveat ${index + 1}`);
  const timeZones = [
    "Africa/Cairo",
    "America/Chicago",
    "America/Los_Angeles",
    "America/New_York",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Europe/London",
    "UTC",
  ];
  const sourceFreshness = timeZones.map((_, index) => ({
    lastSleepEvidenceDate: "2026-07-10",
    provider: `provider-${index + 1}`,
    stalenessVsNewestDays: index,
    stalenessVsNowDays: index + 1,
  }));
  const numericPattern = {
    average: null,
    count: 0,
    median: null,
    standardDeviation: null,
  };
  const clockPattern = {
    count: 0,
    medianLocalMinutes: null,
    medianLocalTime: null,
    standardDeviationMinutes: null,
  };
  const summary = {
    allSourcesStale: false,
    asOfDate: "2026-07-16",
    asOfInstant: "2026-07-16T12:00:00.000Z",
    awakeMinutes: numericPattern,
    bedtime: clockPattern,
    conflictingNightCount: 0,
    coveragePercent: 0,
    expectedNightCount: 28,
    excludedNapOnlyDateCount: 0,
    reportingTimeZoneFallbackNightCount: 0,
    from: "2026-06-13",
    lateArrivingNightCount: 0,
    latestRecordedAt: null,
    latestSleepEndAt: null,
    latestNightAgeDays: null,
    latestNightDate: null,
    midpoint: clockPattern,
    missingNightCount: 28,
    notes,
    overlappingNightCount: 0,
    providerMix: true,
    providers: sourceFreshness.map((source) => source.provider),
    reportingTimeZone: "America/New_York",
    reportingTimeZoneSource: "user_filter" as const,
    sameDateSessionSuppressedCount: 0,
    sessionDurationMinutes: numericPattern,
    sleepLatencyMinutes: numericPattern,
    sourceFreshness,
    staleAfterDays: 2,
    suppressedExactDuplicateCount: 0,
    timeZones,
    timingTimeZoneMode: "per_night_canonical_with_reporting_fallback",
    timingOmittedNightCount: 0,
    to: "2026-07-10",
    totalSleepMinutes: numericPattern,
    unknownSleepTypeNightCount: 0,
    validNightCount: 0,
    wakeTime: clockPattern,
    weekdayWeekendMidpointDriftMinutes: null,
    weekdayWeekendMidpointSampleCounts: {
      weekday: 0,
      weekend: 0,
    },
  };
  const summarizeWearableSleepPatternRuntime = vi.fn(async () => summary);
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    summarizeWearableSleepPatternRuntime,
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
  const result = await services.query.showWearableSleepPattern({
    vault: "./vault",
    requestId: null,
    from: "2026-06-13",
    providers: [" oura ", "oura"],
    timeZone: "America/New_York",
    to: "2026-07-10",
  });

  assert.deepEqual(summarizeWearableSleepPatternRuntime.mock.calls, [["./vault", {
    date: undefined,
    from: "2026-06-13",
    providers: ["oura"],
    timeZone: "America/New_York",
    to: "2026-07-10",
    windowDays: 28,
  }]]);
  assert.deepEqual(result.filters, {
    date: null,
    from: "2026-06-13",
    providers: ["oura"],
    timeZone: "America/New_York",
    to: "2026-07-10",
    windowDays: 28,
  });
  assert.equal(result.summary.notes.length, 10);
  assert.equal(result.summary.sourceFreshness.length, 9);
  assert.equal(result.summary.timeZones.length, 9);
  assert.deepEqual(result.summary, summary);
  assert.equal(loadQueryRuntime.mock.calls.length, 1);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});

test("showPersonalPatterns forwards one shared date window to the query runtime", async () => {
  const report = {
    asOfDate: "2026-08-06",
    cells: [],
    factors: [],
    lagDays: 1 as const,
    notes: [],
    outcomes: [],
    repeatableCellCount: 0,
    testedCellCount: 0,
    windowDays: 90,
  };
  const buildPersonalPatternReportRuntime = vi.fn(async () => report);
  const loadCoreRuntime = vi.fn();
  const loadImporterRuntime = vi.fn();
  const loadQueryRuntime = vi.fn(async () => ({
    buildPersonalPatternReportRuntime,
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
  const result = await services.query.showPersonalPatterns({
    date: "2026-08-06",
    requestId: null,
    vault: "./vault",
    windowDays: 90,
  });

  assert.deepEqual(buildPersonalPatternReportRuntime.mock.calls, [["./vault", {
    asOf: "2026-08-06",
    windowDays: 90,
  }]]);
  assert.deepEqual(result, {
    filters: {
      date: "2026-08-06",
      windowDays: 90,
    },
    report,
  });
  assert.equal(loadQueryRuntime.mock.calls.length, 1);
  assert.equal(loadCoreRuntime.mock.calls.length, 0);
  assert.equal(loadImporterRuntime.mock.calls.length, 0);
});
