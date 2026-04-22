import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

test("showWearableLatest forwards normalized surface filters to the shared query runtime", async () => {
  const readModel = { kind: "read-model" };
  const summarizeWearableLatest = vi.fn(() => ({ latestDate: "2026-04-04" }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadImporterRuntime: vi.fn(),
      loadIntegratedRuntime: vi.fn(async () => ({
        query: {
          readVault: vi.fn(async () => readModel),
          summarizeWearableLatest,
        },
      })),
    }),
  });

  const services = integratedServicesModule.createIntegratedVaultServices();
  const result = await services.query.showWearableLatest({
    vault: "./vault",
    requestId: null,
    date: "2026-04-04",
    providers: [" oura ", "oura"],
  });

  assert.deepEqual(summarizeWearableLatest.mock.calls, [[readModel, {
    date: "2026-04-04",
    from: undefined,
    to: undefined,
    providers: ["oura"],
  }]]);
  assert.deepEqual(result, {
    vault: "./vault",
    filters: {
      date: "2026-04-04",
      from: "2026-04-04",
      to: "2026-04-04",
      providers: ["oura"],
    },
    summary: {
      latestDate: "2026-04-04",
    },
  });
});

test("metric and drift wearable service methods use the shared assistant-aligned method names", async () => {
  const readModel = { kind: "read-model" };
  const summarizeWearableMetricLatest = vi.fn(() => ({ metric: "restingHeartRate" }));
  const summarizeWearableMetricTrend = vi.fn(() => ({ metric: "restingHeartRate", points: [] }));
  const explainWearableDrift = vi.fn(() => ({ windowDays: 7, signals: [] }));

  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.ts": () => ({
      createUnwiredMethod: vi.fn(),
      loadImporterRuntime: vi.fn(),
      loadIntegratedRuntime: vi.fn(async () => ({
        query: {
          readVault: vi.fn(async () => readModel),
          summarizeWearableMetricLatest,
          summarizeWearableMetricTrend,
          explainWearableDrift,
        },
      })),
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

  assert.deepEqual(summarizeWearableMetricLatest.mock.calls, [[readModel, "rhr", {
    date: undefined,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura", "garmin"],
    windowDays: 3,
  }]]);
  assert.deepEqual(summarizeWearableMetricTrend.mock.calls, [[readModel, "rhr", {
    date: undefined,
    from: "2026-04-01",
    to: "2026-04-04",
    providers: ["oura"],
    windowDays: 3,
  }]]);
  assert.deepEqual(explainWearableDrift.mock.calls, [[readModel, {
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
    vault: "./vault",
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
});
