import assert from "node:assert/strict";

import { test } from "vitest";

import {
  normalizeWearableMetricValue,
  resolveWearableCanonicalMetricKey,
  resolveWearableMetricCatalogEntry,
  resolveWearableMetricTolerance,
} from "../src/device-providers/metric-catalog.ts";

test("metric catalog resolves aliases and returns catalog metadata", () => {
  assert.equal(resolveWearableCanonicalMetricKey(" active_calories "), "activeCalories");
  assert.equal(resolveWearableCanonicalMetricKey("temperature-deviation"), "temperatureDeviation");
  assert.equal(resolveWearableCanonicalMetricKey("not-a-real-metric"), null);

  assert.deepEqual(resolveWearableMetricCatalogEntry("session_minutes"), {
    aliases: ["duration", "session_minutes"],
    defaultRecordKind: "activity_session",
    defaultUnit: "minutes",
    key: "sessionMinutes",
    tolerance: 5,
  });
  assert.equal(resolveWearableMetricCatalogEntry("not-a-real-metric"), null);
  assert.equal(resolveWearableMetricTolerance("weight"), 0.2);
  assert.equal(resolveWearableMetricTolerance("not-a-real-metric"), 0);
});

test("metric catalog normalizes unit conversions across importer-supported branches", () => {
  assert.equal(normalizeWearableMetricValue("active_calories", 90, "kcal")?.value, 90);
  assert.equal(normalizeWearableMetricValue("active_calories", 90, null)?.value, 90);
  assert.equal(normalizeWearableMetricValue("active_calories", 90, "joules"), null);

  assert.deepEqual(normalizeWearableMetricValue("distance", 1000, "meter"), {
    key: "distanceKm",
    unit: "km",
    value: 1,
  });
  assert.deepEqual(normalizeWearableMetricValue("distance", 2, "miles"), {
    key: "distanceKm",
    unit: "km",
    value: 3.2187,
  });
  assert.deepEqual(normalizeWearableMetricValue("distance", 5, "km"), {
    key: "distanceKm",
    unit: "km",
    value: 5,
  });
  assert.deepEqual(normalizeWearableMetricValue("floors-climbed", 18, "count"), {
    key: "floorsClimbed",
    unit: "count",
    value: 18,
  });

  assert.deepEqual(normalizeWearableMetricValue("body_temperature", 98.6, "fahrenheit"), {
    key: "temperature",
    unit: "celsius",
    value: 37,
  });
  assert.deepEqual(normalizeWearableMetricValue("temperature_delta", 0.4, "celsius"), {
    key: "temperatureDeviation",
    unit: "celsius",
    value: 0.4,
  });

  assert.deepEqual(normalizeWearableMetricValue("weight", 180, "pounds"), {
    key: "weightKg",
    unit: "kg",
    value: 81.6466,
  });
  assert.deepEqual(normalizeWearableMetricValue("weight", 70, null), {
    key: "weightKg",
    unit: "kg",
    value: 70,
  });
  assert.deepEqual(normalizeWearableMetricValue("waist-circumference", 86.36, "cm"), {
    key: "waistCircumference",
    unit: "cm",
    value: 86.36,
  });
  assert.deepEqual(normalizeWearableMetricValue("lean-body-mass", 40.1, "kg"), {
    key: "leanBodyMassKg",
    unit: "kg",
    value: 40.1,
  });
  assert.deepEqual(normalizeWearableMetricValue("lean-body-mass", 100, "pounds"), {
    key: "leanBodyMassKg",
    unit: "kg",
    value: 45.3592,
  });
  assert.equal(normalizeWearableMetricValue("weight", 70, "stone"), null);

  assert.deepEqual(normalizeWearableMetricValue("altitude_gain", 1.5, "kilometers"), {
    key: "totalElevationGainMeters",
    unit: "meter",
    value: 1500,
  });
  assert.deepEqual(normalizeWearableMetricValue("altitude_change", 10, "feet"), {
    key: "altitudeChangeMeters",
    unit: "meter",
    value: 3.048,
  });
  assert.deepEqual(normalizeWearableMetricValue("altitude_change", 1, "miles"), {
    key: "altitudeChangeMeters",
    unit: "meter",
    value: 1609.344,
  });
  assert.deepEqual(normalizeWearableMetricValue("altitude_change", 12, "yards"), {
    key: "altitudeChangeMeters",
    unit: "meter",
    value: 12,
  });
});

test("metric catalog resolves the Junction tier-1 timeseries metric keys", () => {
  // Every metric the Junction tier-1 timeseries importer emits must resolve,
  // or the wearables candidate path silently drops the observations.
  const junctionEmittedMetrics: readonly [string, string][] = [
    ["temperature-deviation", "temperatureDeviation"],
    ["temperature", "temperature"],
    ["basal-body-temperature", "basalBodyTemperature"],
    ["caffeine", "caffeine"],
    ["water", "water"],
    ["mindfulness-minutes", "mindfulnessMinutes"],
    ["heart-rate-recovery-one-minute", "heartRateRecoveryOneMinute"],
    ["sleep-breathing-disturbance", "sleepBreathingDisturbance"],
    ["afib-burden", "afibBurden"],
    ["glucose", "glucose"],
    ["lowest-glucose", "lowestGlucose"],
    ["highest-glucose", "highestGlucose"],
    ["systolic-blood-pressure", "systolicBloodPressure"],
    ["diastolic-blood-pressure", "diastolicBloodPressure"],
  ];

  for (const [metric, expectedKey] of junctionEmittedMetrics) {
    assert.equal(resolveWearableCanonicalMetricKey(metric), expectedKey, metric);
  }

  assert.deepEqual(normalizeWearableMetricValue("basal-body-temperature", 98.06, "fahrenheit"), {
    key: "basalBodyTemperature",
    unit: "celsius",
    value: 36.7,
  });
  assert.deepEqual(normalizeWearableMetricValue("systolic-blood-pressure", 125, "mmHg"), {
    key: "systolicBloodPressure",
    unit: "mmHg",
    value: 125,
  });
  assert.deepEqual(normalizeWearableMetricValue("glucose", 99.1001, "mg/dL"), {
    key: "glucose",
    unit: "mg/dL",
    value: 99.1001,
  });
});

test("metric catalog resolves Junction activity and sleep summary fidelity keys", () => {
  const junctionSummaryMetrics: readonly [string, string][] = [
    ["activity-minutes", "activityMinutes"],
    ["low-activity-minutes", "lowActivityMinutes"],
    ["medium-activity-minutes", "mediumActivityMinutes"],
    ["high-activity-minutes", "highActivityMinutes"],
    ["average-heart-rate", "averageHeartRate"],
    ["walking-average-heart-rate", "walkingAverageHeartRate"],
    ["lowest-heart-rate", "lowestHeartRate"],
    ["sleep-latency-minutes", "sleepLatencyMinutes"],
  ];

  for (const [metric, expectedKey] of junctionSummaryMetrics) {
    assert.equal(resolveWearableCanonicalMetricKey(metric), expectedKey, metric);
  }
});

test("metric catalog rejects unsupported metrics and non-finite values", () => {
  assert.equal(normalizeWearableMetricValue("unknown_metric", 10, "count"), null);
  assert.equal(normalizeWearableMetricValue("steps", Number.NaN, "count"), null);
  assert.deepEqual(normalizeWearableMetricValue("steps", 1234, "count"), {
    key: "steps",
    unit: "count",
    value: 1234,
  });
});
