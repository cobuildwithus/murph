import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeMetricValue,
  resolveMetricDefinition,
  resolveMetricInputKey,
} from "../src/index.ts";

const JUNCTION_SPARSE_METRICS = [
  ["carbohydrates", "carbohydrates", "g"],
  ["forced_expiratory_volume_1", "forced-expiratory-volume-1", "L"],
  ["forced_vital_capacity", "forced-vital-capacity", "L"],
  ["peak_expiratory_flow_rate", "peak-expiratory-flow-rate", "L/min"],
  ["heart_rate_alert", "heart-rate-alert", "count"],
  ["inhaler_usage", "inhaler-usage", "count"],
  ["sleep_apnea_alert", "sleep-apnea-alert", "count"],
] as const;

test("Junction sparse metrics resolve through the shared query catalog", () => {
  for (const [input, key, unit] of JUNCTION_SPARSE_METRICS) {
    assert.equal(resolveMetricInputKey(input), key);
    assert.equal(resolveMetricDefinition(key)?.canonicalUnit, unit);
  }
  assert.equal(resolveMetricInputKey("fat"), "body-fat-percentage");
  assert.equal(resolveMetricInputKey("body_mass_index"), "bmi");
  assert.equal(resolveMetricInputKey("lean_body_mass"), "lean-body-mass");
  assert.equal(resolveMetricInputKey("waist_circumference"), "waist-circumference");
});


test("Junction sparse observation units normalize for query projection", () => {
  const cases = [
    ["bmi", "kg_m2", "kg/m^2"],
    ["body-fat-percentage", "%", "percent"],
    ["carbohydrates", "g", "g"],
    ["forced-expiratory-volume-1", "L", "L"],
    ["forced-vital-capacity", "L", "L"],
    ["peak-expiratory-flow-rate", "L/min", "L/min"],
    ["heart-rate-alert", "count", "count"],
    ["inhaler-usage", "count", "count"],
    ["sleep-apnea-alert", "count", "count"],
    ["lean-body-mass", "kg", "kg"],
    ["waist-circumference", "cm", "cm"],
  ] as const;

  for (const [metricKey, unit, canonicalUnit] of cases) {
    const normalized = normalizeMetricValue({ metricKey, unit, value: 1 });
    assert.equal(normalized.canonicalUnit, canonicalUnit, metricKey);
    assert.equal(normalized.canonicalValue, 1, metricKey);
    assert.deepEqual(normalized.warnings, [], metricKey);
  }
});
