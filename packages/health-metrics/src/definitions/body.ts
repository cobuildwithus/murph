import type { MetricDefinition } from "../types.ts";

export const BODY_METRICS = [
  {
    aliases: ["weight", "body_weight", "bodyWeight", "bodyweight", "weightKg"],
    biomarkerKey: null,
    canonicalUnit: "kg",
    category: "body",
    displayName: "Body weight",
    displayUnit: "kg",
    key: "body-weight",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 1,
  },
  {
    aliases: ["body_fat", "bodyFat", "body_fat_pct", "body-fat-pct", "bodyFatPercentage", "body_fat_percentage"],
    biomarkerKey: null,
    canonicalUnit: "percent",
    category: "body",
    displayName: "Body fat",
    displayUnit: "percent",
    key: "body-fat-percentage",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 1,
  },
] satisfies readonly MetricDefinition[];
