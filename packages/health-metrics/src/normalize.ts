import {
  createCustomMetricDefinition,
  normalizeMetricKey,
  resolveLabResultMetricDefinition,
  resolveMetricDefinition,
} from "./catalog.ts";
import type {
  MetricDefinition,
  MetricPoint,
  MetricSelectionWarning,
  MetricValueNormalization,
} from "./types.ts";

const HOUR_INTENT_DURATION_ALIASES = new Set([
  "sleep-duration-hours",
  "sleep_duration_hours",
  "sleep-hours",
  "sleep_hours",
  "total-sleep-hours",
  "total_sleep_hours",
].map(normalizeMetricKey));

interface MetricValueNormalizationInput {
  metricKey: string;
  unit: string | null;
  value: number | null;
}

export function normalizeMetricValue(input: MetricValueNormalizationInput): MetricValueNormalization {
  return normalizeMetricValueForScope(input, false);
}

/** Applies the expanded lab catalog only to test-result-owned values. */
export function normalizeLabResultMetricValue(input: MetricValueNormalizationInput): MetricValueNormalization {
  return normalizeMetricValueForScope(input, true);
}

function normalizeMetricValueForScope(
  input: MetricValueNormalizationInput,
  labResult: boolean,
): MetricValueNormalization {
  const definition = (labResult
    ? resolveLabResultMetricDefinition(input.metricKey)
    : resolveMetricDefinition(input.metricKey))
    ?? createCustomMetricDefinition(input.metricKey, input.unit);
  const unit = normalizeUnit(input.unit) ?? inferUnitFromMetricAlias(input.metricKey);

  if (input.value === null || !Number.isFinite(input.value)) {
    return { canonicalUnit: null, canonicalValue: null, unit, warnings: [] };
  }

  switch (definition.key) {
    case "albumin":
      return normalizeAlbumin(input.value, unit);
    case "body-weight":
    case "lean-body-mass":
      return normalizeWeight(input.value, unit);
    case "waist-circumference":
      return normalizeLengthCentimeters(input.value, unit, definition.displayName);
    case "bone-mass-percentage":
    case "body-fat-percentage":
    case "body-water-percentage":
    case "hba1c":
    case "lymphocyte-percentage":
    case "muscle-mass-percentage":
    case "red-cell-distribution-width":
      return normalizePercent(input.value, unit, definition.displayName);
    case "creatinine":
      return normalizeCreatinine(input.value, unit);
    case "blood-urea-nitrogen":
      return normalizeBloodUreaNitrogen(input.value, unit);
    case "egfr":
      return normalizeExactUnit(input.value, unit, "mL/min/1.73m^2", definition.displayName);
    case "glucose":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 18.0182, definition.displayName);
    case "ldl-c":
    case "hdl-c":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 38.67, definition.displayName);
    case "triglycerides":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 88.57, definition.displayName);
    case "calcium":
    case "serum-calcium":
    case "total-calcium":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 4, definition.displayName);
    case "cholesterol":
    case "cholesterol-total":
    case "total-cholesterol":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 38.67, definition.displayName);
    case "serum-uric-acid":
    case "urate":
    case "uric-acid":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 16.812, definition.displayName);
    case "bilirubin":
    case "bilirubin-total":
    case "total-bilirubin":
      return normalizeMicromolarMassConcentration(input.value, unit, 17.1, definition.displayName);
    case "apob":
      return normalizeApoB(input.value, unit);
    case "hs-crp":
      return normalizeExactUnit(input.value, unit, "mg/L", definition.displayName);
    case "ferritin":
      return normalizeExactUnit(input.value, unit, "ng/mL", definition.displayName);
    case "mean-corpuscular-hemoglobin":
      return normalizeExactUnit(input.value, unit, "pg", definition.displayName);
    case "mean-corpuscular-hemoglobin-concentration":
      return normalizeExactUnit(input.value, unit, "g/dL", definition.displayName);
    case "mean-corpuscular-volume":
      return normalizeExactUnit(input.value, unit, "fL", definition.displayName);
    case "thyroid-stimulating-hormone":
      return normalizeExactUnit(input.value, unit, "mIU/L", definition.displayName);
    case "white-blood-cell-count":
      return normalizeCellCount(input.value, unit, definition.displayName);
    case "alkaline-phosphatase":
    case "alt":
    case "ast":
    case "ggt":
      return normalizeExactUnit(input.value, unit, "U/L", definition.displayName);
    case "deep-sleep-minutes":
    case "rem-sleep-minutes":
    case "sleep-duration-variability-minutes":
    case "sleep-midpoint-variability-minutes":
    case "total-sleep-minutes":
      return normalizeDurationMinutes(input.value, unit, definition.displayName);
    default: {
      if (definition.canonicalUnit === null) {
        const commonCustomValue = normalizeCommonCustomValue(input.value, unit);
        if (commonCustomValue) return commonCustomValue;
      }
      const canonicalUnit = definition.canonicalUnit && (!unit || unitsEquivalent(unit, definition.canonicalUnit))
        ? definition.canonicalUnit
        : null;
      return {
        canonicalUnit,
        canonicalValue: canonicalUnit ? input.value : null,
        unit: unit ?? definition.displayUnit,
        warnings: canonicalUnit || !definition.canonicalUnit
          ? []
          : [unitWarning(definition.displayName, unit, definition.canonicalUnit)],
      };
    }
  }
}

export function resolveComparableMetricPointValue(
  point: MetricPoint,
  definition: MetricDefinition,
): { unit: string | null; value: number } | null {
  if (point.source.kind === "test-result" && point.unit === null) {
    return null;
  }

  if (definition.canonicalUnit !== null) {
    const hasCanonicalEvidence = point.canonicalUnit !== null || point.canonicalValue !== null;
    if (hasCanonicalEvidence) {
      if (
        point.canonicalUnit === null
        || !unitsEquivalent(point.canonicalUnit, definition.canonicalUnit)
        || point.canonicalValue === null
        || !Number.isFinite(point.canonicalValue)
      ) {
        return null;
      }
      return { unit: definition.canonicalUnit, value: point.canonicalValue };
    }

    if (point.value !== null && Number.isFinite(point.value) && point.unit !== null) {
      if (unitsEquivalent(point.unit, definition.canonicalUnit)) {
        return { unit: definition.canonicalUnit, value: point.value };
      }
      return point.source.family === "derived"
        ? { unit: point.unit, value: point.value }
        : null;
    }

    // Derived summaries are schema-typed by their producer even when legacy
    // points predate duplicated canonical fields. Raw evidence is not.
    if (point.source.family !== "derived") return null;
  }

  const value = point.canonicalValue ?? point.value;
  if (value === null || !Number.isFinite(value)) return null;
  return {
    unit: point.canonicalUnit ?? point.unit ?? definition.displayUnit,
    value,
  };
}

function inferUnitFromMetricAlias(metricKey: string): string | null {
  return HOUR_INTENT_DURATION_ALIASES.has(normalizeMetricKey(metricKey)) ? "hours" : null;
}

export function normalizeUnit(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  const lower = normalized.toLowerCase().replaceAll("µ", "u").replaceAll("μ", "u");
  const aliases: Record<string, string> = {
    "%": "percent",
    beats_per_minute: "bpm",
    bpm: "bpm",
    count: "count",
    counts: "count",
    "breaths/min": "breaths/min",
    "breaths/minute": "breaths/min",
    breaths_per_minute: "breaths/min",
    celsius: "degC",
    degc: "degC",
    "deg c": "degC",
    "degree c": "degC",
    "degrees c": "degC",
    "degrees celsius": "degC",
    fl: "fL",
    calc: "ratio",
    ratio: "ratio",
    g_l: "g/L",
    "g/l": "g/L",
    g_dl: "g/dL",
    "g/dl": "g/dL",
    "g/dl (calc)": "g/dL",
    kg: "kg",
    h: "hours",
    hr: "hours",
    hrs: "hours",
    hour: "hours",
    hours: "hours",
    kilogram: "kg",
    kilograms: "kg",
    cm: "cm",
    centimeter: "cm",
    centimeters: "cm",
    in: "in",
    inch: "in",
    inches: "in",
    "kg/m2": "kg/m^2",
    "kg/m^2": "kg/m^2",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    mg_dl: "mg/dL",
    "mg/dl": "mg/dL",
    mg_l: "mg/L",
    "mg/l": "mg/L",
    mm_hg: "mmHg",
    "mm hg": "mmHg",
    mmhg: "mmHg",
    "ml/kg/min": "mL/kg/min",
    "ml/min/1.73m2": "mL/min/1.73m^2",
    "ml/min/1.73m^2": "mL/min/1.73m^2",
    "ml/min/1.73": "mL/min/1.73m^2",
    "ml/min/1.73 m2": "mL/min/1.73m^2",
    "ml/min/1.73 m^2": "mL/min/1.73m^2",
    "ml/min/1.73sq m": "mL/min/1.73m^2",
    min: "minutes",
    mins: "minutes",
    minute: "minutes",
    minutes: "minutes",
    mmol_l: "mmol/L",
    "mmol/l": "mmol/L",
    miu_l: "mIU/L",
    "miu/l": "mIU/L",
    ms: "ms",
    ng_ml: "ng/mL",
    "ng/ml": "ng/mL",
    pct: "percent",
    percent: "percent",
    percentage: "percent",
    score: "score",
    iu_l: "U/L",
    "iu/l": "U/L",
    u_l: "U/L",
    "u/l": "U/L",
    "10^3/ul": "10^3/uL",
    "10*3/ul": "10^3/uL",
    "10^9/l": "10^3/uL",
    "x10^9/l": "10^3/uL",
    "x10e3/ul": "10^3/uL",
    "x10^3/ul": "10^3/uL",
    "thousand/ul": "10^3/uL",
    "thousands/ul": "10^3/uL",
    k_ul: "10^3/uL",
    "k/ul": "10^3/uL",
    "10^6/ul": "10^6/uL",
    "10*6/ul": "10^6/uL",
    "10^12/l": "10^6/uL",
    "x10^12/l": "10^6/uL",
    "x10e6/ul": "10^6/uL",
    "x10^6/ul": "10^6/uL",
    "cells/ul": "cells/uL",
    umol_l: "umol/L",
    "umol/l": "umol/L",
    uiu_ml: "mIU/L",
    "uiu/ml": "mIU/L",
    "µiu/ml": "mIU/L",
    "μiu/ml": "mIU/L",
  };
  const alias = Object.prototype.hasOwnProperty.call(aliases, lower)
    ? aliases[lower]
    : undefined;
  return alias ?? normalized;
}

export function unitsEquivalent(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizeUnit(left);
  const normalizedRight = normalizeUnit(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

function normalizeWeight(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "kg")) {
    return { canonicalUnit: "kg", canonicalValue: value, unit: unit ?? "kg", warnings: [] };
  }
  if (unitsEquivalent(unit, "lb")) {
    return { canonicalUnit: "kg", canonicalValue: Number((value * 0.45359237).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("Body weight", unit, "kg")] };
}

function normalizeLengthCentimeters(value: number, unit: string | null, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "cm")) {
    return { canonicalUnit: "cm", canonicalValue: value, unit: unit ?? "cm", warnings: [] };
  }
  if (unitsEquivalent(unit, "in")) {
    return { canonicalUnit: "cm", canonicalValue: Number((value * 2.54).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "cm")] };
}

function normalizeDurationMinutes(value: number, unit: string | null, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "minutes")) {
    return { canonicalUnit: "minutes", canonicalValue: value, unit: unit ?? "minutes", warnings: [] };
  }
  if (unitsEquivalent(unit, "hours")) {
    return { canonicalUnit: "minutes", canonicalValue: Number((value * 60).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "minutes")] };
}

function normalizeCommonCustomValue(
  value: number,
  unit: string | null,
): MetricValueNormalization | null {
  if (unitsEquivalent(unit, "g/dL")) {
    return { canonicalUnit: "g/dL", canonicalValue: value, unit, warnings: [] };
  }
  if (unitsEquivalent(unit, "g/L")) {
    return {
      canonicalUnit: "g/dL",
      canonicalValue: Number((value / 10).toFixed(4)),
      unit,
      warnings: [],
    };
  }
  if (unitsEquivalent(unit, "10^3/uL")) {
    return normalizeCellCount(value, unit, "Lab result");
  }
  if (unitsEquivalent(unit, "cells/uL")) {
    return normalizeCellCount(value, unit, "Lab result");
  }
  return null;
}

function normalizeCellCount(
  value: number,
  unit: string | null,
  label: string,
): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "10^3/uL")) {
    return {
      canonicalUnit: "10^3/uL",
      canonicalValue: value,
      unit: unit ?? "10^3/uL",
      warnings: [],
    };
  }
  if (unitsEquivalent(unit, "cells/uL")) {
    return {
      canonicalUnit: "10^3/uL",
      canonicalValue: Number((value / 1_000).toFixed(4)),
      unit,
      warnings: [],
    };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "10^3/uL")] };
}

function normalizeAlbumin(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "g/dL")) {
    return { canonicalUnit: "g/dL", canonicalValue: value, unit: unit ?? "g/dL", warnings: [] };
  }
  if (unitsEquivalent(unit, "g/L")) {
    return { canonicalUnit: "g/dL", canonicalValue: Number((value / 10).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("Albumin", unit, "g/dL")] };
}

function normalizePercent(value: number, unit: string | null, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "percent")) {
    return { canonicalUnit: "percent", canonicalValue: value, unit: unit ?? "percent", warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "percent")] };
}

function normalizeApoB(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "mg/dL")) {
    return { canonicalUnit: "mg/dL", canonicalValue: value, unit: unit ?? "mg/dL", warnings: [] };
  }
  if (unitsEquivalent(unit, "g/L")) {
    return { canonicalUnit: "mg/dL", canonicalValue: Number((value * 100).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("ApoB", unit, "mg/dL")] };
}

function normalizeCreatinine(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "mg/dL")) {
    return { canonicalUnit: "mg/dL", canonicalValue: value, unit: unit ?? "mg/dL", warnings: [] };
  }
  if (unitsEquivalent(unit, "umol/L")) {
    return { canonicalUnit: "mg/dL", canonicalValue: Number((value / 88.42).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("Creatinine", unit, "mg/dL")] };
}

function normalizeBloodUreaNitrogen(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "mg/dL")) {
    return { canonicalUnit: "mg/dL", canonicalValue: value, unit: unit ?? "mg/dL", warnings: [] };
  }
  if (unitsEquivalent(unit, "mmol/L")) {
    return { canonicalUnit: "mg/dL", canonicalValue: Number((value / 0.357).toFixed(4)), unit, warnings: [] };
  }
  return {
    canonicalUnit: null,
    canonicalValue: null,
    unit,
    warnings: [unitWarning("Blood urea nitrogen", unit, "mg/dL")],
  };
}

function normalizeMassConcentration(
  value: number,
  unit: string | null,
  canonicalUnit: "mg/dL",
  mmolToMgDl: number,
  label: string,
): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, canonicalUnit)) {
    return { canonicalUnit, canonicalValue: value, unit: unit ?? canonicalUnit, warnings: [] };
  }
  if (unitsEquivalent(unit, "mmol/L")) {
    return { canonicalUnit, canonicalValue: Number((value * mmolToMgDl).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, canonicalUnit)] };
}

function normalizeMicromolarMassConcentration(
  value: number,
  unit: string | null,
  micromolesPerMgDl: number,
  label: string,
): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "mg/dL")) {
    return { canonicalUnit: "mg/dL", canonicalValue: value, unit: unit ?? "mg/dL", warnings: [] };
  }
  if (unitsEquivalent(unit, "umol/L")) {
    return {
      canonicalUnit: "mg/dL",
      canonicalValue: Number((value / micromolesPerMgDl).toFixed(4)),
      unit,
      warnings: [],
    };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "mg/dL")] };
}

function normalizeExactUnit(value: number, unit: string | null, expectedUnit: string, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, expectedUnit)) {
    return { canonicalUnit: expectedUnit, canonicalValue: value, unit: unit ?? expectedUnit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, expectedUnit)] };
}

function unitWarning(label: string, unit: string | null, expectedUnit: string): MetricSelectionWarning {
  return {
    code: "UNIT_NOT_NORMALIZED",
    message: `${label} uses ${unit ?? "an unknown unit"}; expected ${expectedUnit}.`,
  };
}
