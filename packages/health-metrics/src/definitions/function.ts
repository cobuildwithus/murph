import type { MetricDefinition } from "../types.ts";

// Protocol-specific keys keep different variants and units out of one series.
const combineStations = [
  ["grip-strength", "Grip strength", "kg", 1], ["broad-jump", "Standing broad jump", "cm", 1],
  ["single-leg-10s", "Single-leg hold", "s", 1], ["tandem-10s", "Tandem hold", "s", 1],
  ["sppb-balance", "Standing balance score", "points", 0], ["sitting-rising", "Sitting-rising score", "points", 1],
  ["pushups-max", "Toe push-ups", "reps", 0], ["pushups-knees", "Knee push-ups", "reps", 0],
  ["pushups-wall", "Wall push-ups", "reps", 0], ["pullups-max", "Pull-ups", "reps", 0],
  ["chair-stand-30s", "30-second chair stands", "reps", 0], ["squats-max", "Bodyweight squats", "reps", 0],
  ["step-3min", "Three-minute step test recovery pulse", "bpm", 0],
  ["march-2min", "Two-minute march", "steps", 0], ["seated-reach", "Seated reach", "cm", 1],
] as const;

export const FUNCTION_METRICS = [
  ...combineStations.map(([key, displayName, canonicalUnit, valuePrecision]): MetricDefinition => ({
    key, displayName, canonicalUnit, valuePrecision, displayUnit: canonicalUnit, aliases: [],
    category: "fitness", biomarkerKey: null, selectionPolicy: { kind: "latest-valid", staleAfterDays: 84 },
  })),
  {
    aliases: [
      "adl-count",
      "adl-limitation-count",
      "activities-of-daily-living-limitations",
      "daily-living-limitation-count",
    ],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "function",
    displayName: "ADL limitation count",
    displayUnit: "limitations",
    key: "adl-limitation-count",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 365 },
    valuePrecision: 0,
  },
  {
    aliases: [
      "iadl-count",
      "iadl-limitation-count",
      "instrumental-adl-limitation-count",
      "instrumental-activities-of-daily-living-limitations",
    ],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "function",
    displayName: "IADL limitation count",
    displayUnit: "limitations",
    key: "iadl-limitation-count",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 365 },
    valuePrecision: 0,
  },
  {
    aliases: [
      "disability-count",
      "functional-limitation-count",
      "mobility-count",
      "mobility-limitation-count",
      "physical-function-limitation-count",
    ],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "function",
    displayName: "Mobility limitation count",
    displayUnit: "limitations",
    key: "mobility-limitation-count",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 365 },
    valuePrecision: 0,
  },
  {
    aliases: [
      "frailty-count",
      "frailty-symptom-count",
      "frailty_symptom_count",
    ],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "function",
    displayName: "Frailty symptom count",
    displayUnit: "symptoms",
    key: "frailty-symptom-count",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 365 },
    valuePrecision: 0,
  },
] satisfies readonly MetricDefinition[];
