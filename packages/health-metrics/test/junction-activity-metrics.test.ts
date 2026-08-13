import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeMetricValue,
  resolveMetricDefinition,
  resolveMetricInputKey,
} from "../src/index.ts";

const JUNCTION_ACTIVITY_METRICS = [
  ["calories_basal", "basal-calories", "kcal"],
  ["daylight_exposure", "daylight-exposure-minutes", "minutes"],
  ["fall", "fall-count", "count"],
  ["floors_climbed", "floors-climbed", "count"],
  ["handwashing", "handwashing-count", "count"],
  ["stand_duration", "stand-duration-minutes", "minutes"],
  ["stand_hour", "stand-hours", "count"],
  ["uv_exposure", "uv-exposure-index", "index"],
  ["wheelchair_push", "wheelchair-push-count", "count"],
  ["workout_distance", "workout-distance-km", "km"],
  ["workout_duration", "workout-minutes", "minutes"],
  ["workout_swimming_stroke", "swimming-stroke-count", "count"],
] as const;

test("Junction activity resource names resolve through the shared metric catalog", () => {
  for (const [input, key, unit] of JUNCTION_ACTIVITY_METRICS) {
    assert.equal(resolveMetricInputKey(input), key, input);
    assert.equal(resolveMetricDefinition(key)?.canonicalUnit, unit, input);
  }
});

test("Junction activity metric units remain canonical for query projection", () => {
  for (const [, metricKey, unit] of JUNCTION_ACTIVITY_METRICS) {
    const normalized = normalizeMetricValue({ metricKey, unit, value: 1 });
    assert.equal(normalized.canonicalUnit, unit, metricKey);
    assert.equal(normalized.canonicalValue, 1, metricKey);
    assert.deepEqual(normalized.warnings, [], metricKey);
  }
});
