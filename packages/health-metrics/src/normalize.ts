import { createCustomMetricDefinition, normalizeMetricKey, resolveMetricDefinition } from "./catalog.ts";
import type { MetricSelectionWarning, MetricValueNormalization } from "./types.ts";

const HOUR_INTENT_DURATION_ALIASES = new Set([
  "sleep-duration-hours",
  "sleep_duration_hours",
  "sleep-hours",
  "sleep_hours",
  "total-sleep-hours",
  "total_sleep_hours",
].map(normalizeMetricKey));

export function normalizeMetricValue(input: {
  metricKey: string;
  unit: string | null;
  value: number | null;
}): MetricValueNormalization {
  const definition = resolveMetricDefinition(input.metricKey) ?? createCustomMetricDefinition(input.metricKey, input.unit);
  const unit = normalizeUnit(input.unit) ?? inferUnitFromMetricAlias(input.metricKey);

  if (input.value === null || !Number.isFinite(input.value)) {
    return { canonicalUnit: null, canonicalValue: null, unit, warnings: [] };
  }

  switch (definition.key) {
    case "albumin":
      return normalizeAlbumin(input.value, unit);
    case "body-weight":
      return normalizeWeight(input.value, unit);
    case "waist-circumference":
      return normalizeLengthCentimeters(input.value, unit, definition.displayName);
    case "body-fat-percentage":
    case "hba1c":
    case "lymphocyte-percentage":
    case "red-cell-distribution-width":
      return normalizePercent(input.value, unit, definition.displayName);
    case "creatinine":
      return normalizeCreatinine(input.value, unit);
    case "egfr":
      return normalizeExactUnit(input.value, unit, "mL/min/1.73m^2", definition.displayName);
    case "glucose":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 18.0182, definition.displayName);
    case "ldl-c":
    case "hdl-c":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 38.67, definition.displayName);
    case "triglycerides":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 88.57, definition.displayName);
    case "apob":
      return normalizeApoB(input.value, unit);
    case "hs-crp":
      return normalizeExactUnit(input.value, unit, "mg/L", definition.displayName);
    case "ferritin":
      return normalizeExactUnit(input.value, unit, "ng/mL", definition.displayName);
    case "mean-corpuscular-volume":
      return normalizeExactUnit(input.value, unit, "fL", definition.displayName);
    case "white-blood-cell-count":
      return normalizeExactUnit(input.value, unit, "10^3/uL", definition.displayName);
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

function inferUnitFromMetricAlias(metricKey: string): string | null {
  return HOUR_INTENT_DURATION_ALIASES.has(normalizeMetricKey(metricKey)) ? "hours" : null;
}

export function normalizeUnit(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
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
    g_l: "g/L",
    "g/l": "g/L",
    g_dl: "g/dL",
    "g/dl": "g/dL",
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
    "ml/min/1.73 m2": "mL/min/1.73m^2",
    "ml/min/1.73 m^2": "mL/min/1.73m^2",
    min: "minutes",
    mins: "minutes",
    minute: "minutes",
    minutes: "minutes",
    mmol_l: "mmol/L",
    "mmol/l": "mmol/L",
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
    k_ul: "10^3/uL",
    "k/ul": "10^3/uL",
    umol_l: "umol/L",
    "umol/l": "umol/L",
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
