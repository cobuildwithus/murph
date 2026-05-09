import { createCustomMetricDefinition, resolveMetricDefinition } from "./catalog.ts";
import type { MetricSelectionWarning, MetricValueNormalization } from "./types.ts";

export function normalizeMetricValue(input: {
  metricKey: string;
  unit: string | null;
  value: number | null;
}): MetricValueNormalization {
  const definition = resolveMetricDefinition(input.metricKey) ?? createCustomMetricDefinition(input.metricKey, input.unit);
  const unit = normalizeUnit(input.unit);

  if (input.value === null || !Number.isFinite(input.value)) {
    return { canonicalUnit: null, canonicalValue: null, unit, warnings: [] };
  }

  switch (definition.key) {
    case "body-weight":
      return normalizeWeight(input.value, unit);
    case "body-fat-percentage":
    case "hba1c":
      return normalizePercent(input.value, unit, definition.displayName);
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
    case "alt":
    case "ast":
    case "ggt":
      return normalizeExactUnit(input.value, unit, "U/L", definition.displayName);
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
    g_l: "g/L",
    "g/l": "g/L",
    kg: "kg",
    kilogram: "kg",
    kilograms: "kg",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    mg_dl: "mg/dL",
    "mg/dl": "mg/dL",
    mg_l: "mg/L",
    "mg/l": "mg/L",
    "ml/kg/min": "mL/kg/min",
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
