import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildTrendComparison,
  formatTrendDeltaSummary,
  formatTrendDeltaUnit,
  nearFlatThresholdForUnit,
  type BrowserVaultMetricRowWithValue,
} from "../src/lib/browser-vault/trend-comparison";
import { resolveHealthCommonsBiomarkerDetail } from "../src/lib/health-commons/biomarker-detail";

test("formatTrendDeltaUnit returns percentage points for percentage units", () => {
  assert.equal(formatTrendDeltaUnit("%"), "percentage points");
  assert.equal(formatTrendDeltaUnit("percent"), "percentage points");
  assert.equal(formatTrendDeltaUnit("bpm"), "bpm");
  assert.equal(formatTrendDeltaUnit("ms"), "ms");
});

test("nearFlatThresholdForUnit returns unit-specific thresholds", () => {
  assert.equal(nearFlatThresholdForUnit("bpm"), 0.5);
  assert.equal(nearFlatThresholdForUnit("ml/kg/min"), 0.1);
  assert.equal(nearFlatThresholdForUnit("%"), 0.5);
  assert.equal(nearFlatThresholdForUnit("minutes"), 1);
  assert.equal(nearFlatThresholdForUnit("ms"), 0.01);
});

test("buildTrendComparison treats SpO₂ percent change inside threshold as flat", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("blood-oxygen-spo2");
  assert.ok(biomarker);

  const comparison = buildTrendComparison(
    buildDailyRows({ baselineValue: 96.7, currentValue: 97.1 }),
    biomarker,
  );

  assert.ok(comparison);
  assert.equal(comparison.direction, "flat");
  assert.equal(
    formatTrendDeltaSummary({
      comparison,
      precision: biomarker.valuePrecision,
      unit: biomarker.unit,
    }),
    "within 0.4 percentage points of baseline",
  );
});

test("buildTrendComparison classifies percent deltas from raw value, not rounded display", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("blood-oxygen-spo2");
  assert.ok(biomarker);

  // raw delta of 0.54% rounds to 0.5 but the threshold check uses raw value (>0.5)
  const comparison = buildTrendComparison(
    buildDailyRows({ baselineValue: 96.0, currentValue: 96.54 }),
    biomarker,
  );

  assert.ok(comparison);
  assert.equal(comparison.direction, "up");
  assert.equal(
    formatTrendDeltaSummary({
      comparison,
      precision: biomarker.valuePrecision,
      unit: biomarker.unit,
    }),
    "up 0.5 percentage points",
  );
});

test("buildTrendComparison treats modest VO₂max change as flat", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("estimated-vo2max");
  assert.ok(biomarker);

  const comparison = buildTrendComparison(
    buildDailyRows({ baselineValue: 45.0, currentValue: 45.14 }),
    biomarker,
  );

  assert.ok(comparison);
  assert.equal(comparison.direction, "flat");
  assert.equal(
    formatTrendDeltaSummary({
      comparison,
      precision: biomarker.valuePrecision,
      unit: biomarker.unit,
    }),
    "flat 0.1 ml/kg/min",
  );
});

test("buildTrendComparison treats 1-minute deep-sleep delta as flat", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("deep-sleep-minutes");
  assert.ok(biomarker);

  const comparison = buildTrendComparison(
    buildDailyRows({ baselineValue: 92, currentValue: 93 }),
    biomarker,
  );

  assert.ok(comparison);
  assert.equal(comparison.direction, "flat");
  assert.equal(
    formatTrendDeltaSummary({
      comparison,
      precision: biomarker.valuePrecision,
      unit: biomarker.unit,
    }),
    "flat 1 minutes",
  );
});

function buildDailyRows(
  input: { baselineValue: number; currentValue: number },
): BrowserVaultMetricRowWithValue[] {
  const latest = new Date("2026-04-23T00:00:00.000Z");

  return Array.from({ length: 37 }, (_, index) => {
    const date = new Date(latest);
    const daysBeforeLatest = 36 - index;
    date.setUTCDate(date.getUTCDate() - daysBeforeLatest);

    return {
      biomarkerKey: null,
      confidence: "high",
      context: {},
      date: date.toISOString().slice(0, 10),
      grain: "day",
      id: `row-${index}`,
      metricKey: "spo2",
      observedAt: `${date.toISOString().slice(0, 10)}T00:00:00.000Z`,
      pointIds: [`point-${index}`],
      recordIds: [`record-${index}`],
      rowSchema: "murph.browser-vault.metric-row",
      sourceFamily: "derived",
      sourceKind: "wearable-summary",
      sourceLabel: "Wearable summary",
      statistic: "value",
      unit: "%",
      value: index < 30 ? input.baselineValue : input.currentValue,
      valueLabel: String(index < 30 ? input.baselineValue : input.currentValue),
    } as BrowserVaultMetricRowWithValue;
  });
}
