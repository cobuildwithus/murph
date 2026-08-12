// Keep the established default order stable. Opt-ins stay explicit so adding
// an importer path never widens existing members' collection implicitly.
export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = Object.freeze([
  "blood_oxygen",
  "stress_level",
  "hrv",
  "respiratory_rate",
  "vo2_max",
  "body_temperature_delta",
  "body_temperature",
  "basal_body_temperature",
  "caffeine",
  "water",
  "mindfulness_minutes",
  "heart_rate_recovery_one_minute",
  "sleep_breathing_disturbance",
  "afib_burden",
  "glucose",
  "blood_pressure",
  "note",
] as const);

export const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = Object.freeze([
  "steps",
  "distance",
  "calories_active",
  "heartrate",
  "weight",
] as const);

export const JUNCTION_KNOWN_TIMESERIES_RESOURCES = Object.freeze([
  ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  ...JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
] as const);

export type JunctionTimeseriesResource =
  (typeof JUNCTION_KNOWN_TIMESERIES_RESOURCES)[number];

export const JUNCTION_ALLOWED_TIMESERIES_RESOURCES = Object.freeze([
  ...JUNCTION_KNOWN_TIMESERIES_RESOURCES,
]);

export const JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES = Object.freeze([
  "blood_pressure",
  "note",
  "weight",
] as const satisfies readonly JunctionTimeseriesResource[]);

// Every default summary resource is sparse event/daily-grain data: profile is
// a single current snapshot per source, menstrual_cycle is roughly 13 cycles
// per member-year with small dated sub-arrays, and electrocardiogram is a
// bounded recording-summary resource. Raw ECG voltage remains excluded.
export const JUNCTION_DEFAULT_SUMMARY_RESOURCES = Object.freeze([
  "activity",
  "sleep",
  "sleep_cycle",
  "workouts",
  "body",
  "meal",
  "profile",
  "menstrual_cycle",
  "electrocardiogram",
] as const);

export const JUNCTION_OPT_IN_SUMMARY_RESOURCES = Object.freeze([] as const);
export const JUNCTION_RAW_ONLY_SUMMARY_RESOURCES = Object.freeze([] as const);

export const JUNCTION_ALLOWED_SUMMARY_RESOURCES = Object.freeze([
  ...JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  ...JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  ...JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
] as const);

export function normalizeJunctionResourceName(value: unknown): string | null {
  const resource = normalizeJunctionResourceSlug(value);
  switch (resource) {
    case "heart_rate":
      return "heartrate";
    case "meals":
      return "meal";
    case "stress":
    case "stresslevel":
      return "stress_level";
    case "body_weight":
      return "weight";
    case "sleep_cycle":
    case "hypnogram":
      return "sleep_cycle";
    case "spo2":
    case "blood_oxygen_saturation":
      return "blood_oxygen";
    case "vo2max":
      return "vo2_max";
    case "heart_rate_variability":
      return "hrv";
    case "blood_glucose":
      return "glucose";
    default:
      return resource;
  }
}

function normalizeJunctionResourceSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}
