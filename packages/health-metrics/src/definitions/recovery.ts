import type { MetricDefinition } from "../types.ts";

export const RECOVERY_METRICS = [
  {
    aliases: ["rhr", "resting_heart_rate", "restingHeartRate", "resting-pulse"],
    biomarkerKey: "biomarker:resting-heart-rate",
    canonicalUnit: "bpm",
    category: "recovery",
    displayName: "Resting heart rate",
    displayUnit: "bpm",
    key: "resting-heart-rate",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 0,
  },
  {
    aliases: ["hrv", "hrv_rmssd", "rmssd", "heart-rate-variability", "heart_rate_variability"],
    biomarkerKey: "biomarker:hrv-rmssd",
    canonicalUnit: "ms",
    category: "recovery",
    displayName: "HRV",
    displayUnit: "ms",
    key: "hrv-rmssd",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 7 },
    valuePrecision: 0,
  },
  {
    aliases: ["readinessScore", "readiness_score", "recovery-score", "recoveryScore"],
    biomarkerKey: null,
    canonicalUnit: "score",
    category: "recovery",
    displayName: "Readiness score",
    displayUnit: "score",
    key: "readiness-score",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  },
] satisfies readonly MetricDefinition[];
