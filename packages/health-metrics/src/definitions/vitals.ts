import type { MetricDefinition } from "../types.ts";

export const VITAL_METRICS = [
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
