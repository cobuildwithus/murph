import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

test("showWearableLatest forwards normalized surface filters to the shared query runtime", async () => {
  const summarizeWearableLatestRuntime = vi.fn(async () => ({
    latestDate: "2026-04-04",
    sleep: {
      totalSleepMinutes: {
        candidates: [{
          candidateId: "candidate_01",
          externalRef: {
            resourceId: "provider-resource-01",
          },
          paths: ["ledger/events/2026/2026-04.jsonl"],
          recordIds: ["evt_sleep_01"],
        }],
        selection: {
          paths: ["ledger/events/2026/2026-04.jsonl"],
          provider: "whoop",
          recordIds: ["evt_sleep_01"],
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
      sleep: {
        totalSleepMinutes: {
          selection: {
            provider: "whoop",
            value: 420,
          },
        },
      },
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("candidate_01"), false);
  assert.equal(serialized.includes("provider-resource-01"), false);
  assert.equal(serialized.includes("ledger/events"), false);
  assert.equal(serialized.includes("evt_sleep_01"), false);
  assert.equal(loadQueryRuntime.mock.calls.length, 1);
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
