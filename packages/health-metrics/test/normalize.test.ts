import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeLabResultMetricValue, normalizeMetricValue } from "../src/normalize.ts";

test("preserves declared exact units, missing-unit defaults, and mismatch warnings", () => {
  const metrics = [
    ["hba1c", "percent", "HbA1c"],
    ["egfr", "mL/min/1.73m^2", "eGFR"],
    ["hs-crp", "mg/L", "hs-CRP"],
    ["ferritin", "ng/mL", "Ferritin"],
    ["mean-corpuscular-hemoglobin", "pg", "Mean corpuscular hemoglobin"],
    ["mean-corpuscular-hemoglobin-concentration", "g/dL", "Mean corpuscular hemoglobin concentration"],
    ["mean-corpuscular-volume", "fL", "Mean corpuscular volume"],
    ["thyroid-stimulating-hormone", "mIU/L", "Thyroid-stimulating hormone"],
    ["alkaline-phosphatase", "U/L", "Alkaline phosphatase"],
    ["alt", "U/L", "ALT"],
    ["ast", "U/L", "AST"],
    ["ggt", "U/L", "GGT"],
  ] as const;

  for (const normalize of [normalizeMetricValue, normalizeLabResultMetricValue]) {
    for (const [metricKey, canonicalUnit, label] of metrics) {
      for (const unit of [null, canonicalUnit]) {
        assert.deepEqual(normalize({ metricKey, unit, value: 12.5 }), {
          canonicalUnit,
          canonicalValue: 12.5,
          unit: canonicalUnit,
          warnings: [],
        }, metricKey);
      }
      assert.deepEqual(normalize({ metricKey, unit: "unsupported", value: 12.5 }), {
        canonicalUnit: null,
        canonicalValue: null,
        unit: "unsupported",
        warnings: [{
          code: "UNIT_NOT_NORMALIZED",
          message: `${label} uses unsupported; expected ${canonicalUnit}.`,
        }],
      }, metricKey);
    }
  }
});

test("keeps canonical percentage defaults when the lab display unit is a percent symbol", () => {
  for (const normalize of [normalizeMetricValue, normalizeLabResultMetricValue]) {
    for (const metricKey of ["lymphocyte-percentage", "red-cell-distribution-width"]) {
      assert.deepEqual(normalize({ metricKey, unit: null, value: 12.5 }), {
        canonicalUnit: "percent",
        canonicalValue: 12.5,
        unit: "percent",
        warnings: [],
      });
    }
  }
});

test("normalizes body percentage keys even when they are custom lab-result metrics", () => {
  for (const metricKey of ["bone-mass-percentage", "body-fat-percentage", "body-water-percentage", "muscle-mass-percentage"]) {
    assert.deepEqual(normalizeLabResultMetricValue({ metricKey, unit: null, value: 12.5 }), {
      canonicalUnit: "percent",
      canonicalValue: 12.5,
      unit: "percent",
      warnings: [],
    });
  }
  assert.deepEqual(normalizeLabResultMetricValue({ metricKey: "body-fat-percentage", unit: "unsupported", value: 12.5 }), {
    canonicalUnit: null,
    canonicalValue: null,
    unit: "unsupported",
    warnings: [{ code: "UNIT_NOT_NORMALIZED", message: "Body Fat Percentage uses unsupported; expected percent." }],
  });
});

test("ignores missing and nonfinite values before conversion routing while retaining source units", () => {
  for (const normalize of [normalizeMetricValue, normalizeLabResultMetricValue]) {
    for (const metricKey of ["body-weight", "glucose", "bilirubin", "hba1c", "custom-metric"]) {
      for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.deepEqual(normalize({ metricKey, unit: "mmol_l", value }), {
          canonicalUnit: null,
          canonicalValue: null,
          unit: "mmol/L",
          warnings: [],
        });
      }
    }
    assert.deepEqual(normalize({ metricKey: "sleep_duration_hours", unit: null, value: null }), {
      canonicalUnit: null,
      canonicalValue: null,
      unit: "hours",
      warnings: [],
    });
  }
});

test("retains custom metric fallback for names that resemble object properties", () => {
  for (const normalize of [normalizeMetricValue, normalizeLabResultMetricValue]) {
    for (const metricKey of ["constructor", "__proto__", "hasOwnProperty"]) {
      assert.deepEqual(normalize({ metricKey, unit: "points", value: 4 }), {
        canonicalUnit: null,
        canonicalValue: null,
        unit: "points",
        warnings: [],
      });
      assert.deepEqual(normalize({ metricKey, unit: "g/L", value: 40 }), {
        canonicalUnit: "g/dL",
        canonicalValue: 4,
        unit: "g/L",
        warnings: [],
      });
    }
  }
});
