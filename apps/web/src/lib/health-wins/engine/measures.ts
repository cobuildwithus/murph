import type { Measure } from "./types";

export const measures = {
  sleep_total_min: { source: "wearable", label: "sleep" },
  sleep_deep_min: { source: "wearable", label: "deep sleep" },
  sleep_score: { source: "wearable", label: "sleep score" },
  sleep_efficiency: { source: "wearable", label: "sleep efficiency" },
  rhr_bpm: { source: "wearable", label: "resting heart rate" },
  hrv_ms: { source: "wearable", label: "heart rate variability" },
  steps: { source: "wearable", label: "steps" },
  distance_km: { source: "wearable", label: "distance" },
  floors: { source: "wearable", label: "floors" },
  vo2max: { source: "wearable", label: "VO2 max" },
  hdl: { source: "labs", label: "HDL" },
  ldl: { source: "labs", label: "LDL" },
  triglycerides: { source: "labs", label: "triglycerides" },
  total_chol: { source: "labs", label: "total cholesterol" },
  hs_crp: { source: "labs", label: "hs-CRP" },
  insulin: { source: "labs", label: "insulin" },
  a1c: { source: "labs", label: "A1c" },
  glucose: { source: "labs", label: "glucose" },
} as const satisfies Record<Measure, { source: "wearable" | "labs"; label: string }>;

export function isMeasure(value: unknown): value is Measure {
  return typeof value === "string" && Object.hasOwn(measures, value);
}
