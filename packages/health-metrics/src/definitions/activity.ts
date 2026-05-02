import type { MetricDefinition } from "../types.ts";

export const ACTIVITY_METRICS = [
  {
    aliases: ["daily-step-count", "daily_step_count", "step-count", "step_count", "steps"],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "activity",
    displayName: "Steps",
    displayUnit: "steps",
    key: "steps",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  },
  {
    aliases: ["sessionMinutes", "session_minutes", "activity-minutes"],
    biomarkerKey: null,
    canonicalUnit: "minutes",
    category: "activity",
    displayName: "Activity minutes",
    displayUnit: "minutes",
    key: "activity-minutes",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  },
  {
    aliases: ["cardio-fitness", "estimated-vo2max", "estimated_vo2max", "estimated_vo2_max", "vo2-max", "vo2_max", "vo2max"],
    biomarkerKey: "biomarker:estimated-vo2max",
    canonicalUnit: "mL/kg/min",
    category: "fitness",
    displayName: "Estimated VO2 max",
    displayUnit: "mL/kg/min",
    key: "estimated-vo2-max",
    selectionPolicy: { kind: "latest-device-estimate", staleAfterDays: 45 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 90, latestWindowDays: 14, minimumPoints: 2 },
    valuePrecision: 1,
  },
] satisfies readonly MetricDefinition[];
