import type { MetricDefinition } from "../types.ts";

export const VITAL_METRICS = [
  {
    aliases: ["systolic-bp", "systolic_bp", "sbp", "systolic"],
    biomarkerKey: "biomarker:systolic-blood-pressure",
    canonicalUnit: "mmHg",
    category: "vital",
    displayName: "Systolic blood pressure",
    displayUnit: "mmHg",
    key: "systolic-blood-pressure",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 0,
  },
  {
    aliases: ["diastolic-bp", "diastolic_bp", "dbp", "diastolic"],
    biomarkerKey: "biomarker:diastolic-blood-pressure",
    canonicalUnit: "mmHg",
    category: "vital",
    displayName: "Diastolic blood pressure",
    displayUnit: "mmHg",
    key: "diastolic-blood-pressure",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 0,
  },
  {
    aliases: ["blood-oxygen", "blood_oxygen", "oxygen-saturation", "oxygen_saturation", "spo2", "sp-o2"],
    biomarkerKey: "biomarker:blood-oxygen-spo2",
    canonicalUnit: "percent",
    category: "vital",
    displayName: "Blood oxygen",
    displayUnit: "%",
    key: "spo2",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 1,
  },
] satisfies readonly MetricDefinition[];
