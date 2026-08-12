export const JUNCTION_WEARABLE_TAG_NOTE_TYPE = "junction_wearable_tags" as const;
export const JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET = "wearable-tags" as const;

// This contracts-owned policy is shared by runtime configuration and the
// importer. Keep established defaults stable and additions explicit so adding
// canonicalization never widens collection implicitly.
export type JunctionTimeseriesNormalizationMode =
  | "daily_aggregate"
  | "hourly_or_session_feature"
  | "note_tags"
  | "sparse_alert"
  | "sparse_intervention"
  | "sparse_observation"
  | "sparse_reading";

export type JunctionTimeseriesHistoryWindow = "dense_timeseries" | "summary_history";

export interface JunctionTimeseriesResourcePolicy {
  readonly enabledByDefault: boolean;
  readonly fetchChunkDays: number;
  readonly historyWindow: JunctionTimeseriesHistoryWindow;
  readonly normalizationMode: JunctionTimeseriesNormalizationMode;
  readonly resource: string;
}

// Static, code-owned resource policy shared by config admission, fetch-window
// selection, webhook recognition, and importer sanitization. Default entries
// retain their established order. Opt-ins are appended so existing members and
// hosted runtimes do not begin fetching them implicitly.
export const JUNCTION_TIMESERIES_RESOURCE_POLICIES = Object.freeze([
  { resource: "blood_oxygen", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "stress_level", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "hrv", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "respiratory_rate", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "vo2_max", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "body_temperature_delta", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "body_temperature", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "basal_body_temperature", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "caffeine", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "water", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "mindfulness_minutes", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "heart_rate_recovery_one_minute", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "sleep_breathing_disturbance", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "afib_burden", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "glucose", enabledByDefault: true, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "blood_pressure", enabledByDefault: true, normalizationMode: "sparse_reading", historyWindow: "summary_history", fetchChunkDays: 1 },
  { resource: "note", enabledByDefault: true, normalizationMode: "note_tags", historyWindow: "summary_history", fetchChunkDays: 1 },
  { resource: "steps", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "distance", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "calories_active", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "heartrate", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "weight", enabledByDefault: false, normalizationMode: "sparse_reading", historyWindow: "summary_history", fetchChunkDays: 1 },
  { resource: "body_mass_index", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "carbohydrates", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "fat", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "forced_expiratory_volume_1", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "forced_vital_capacity", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "heart_rate_alert", enabledByDefault: false, normalizationMode: "sparse_alert", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "inhaler_usage", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "insulin_injection", enabledByDefault: false, normalizationMode: "sparse_intervention", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "lean_body_mass", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "peak_expiratory_flow_rate", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "sleep_apnea_alert", enabledByDefault: false, normalizationMode: "sparse_alert", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "waist_circumference", enabledByDefault: false, normalizationMode: "sparse_observation", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "calories_basal", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "daylight_exposure", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "fall", enabledByDefault: false, normalizationMode: "sparse_alert", historyWindow: "summary_history", fetchChunkDays: 30 },
  { resource: "floors_climbed", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "handwashing", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "stand_duration", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "stand_hour", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "uv_exposure", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "wheelchair_push", enabledByDefault: false, normalizationMode: "daily_aggregate", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "workout_distance", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "workout_duration", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
  { resource: "workout_swimming_stroke", enabledByDefault: false, normalizationMode: "hourly_or_session_feature", historyWindow: "dense_timeseries", fetchChunkDays: 1 },
] as const satisfies readonly JunctionTimeseriesResourcePolicy[]);

export type JunctionTimeseriesResource =
  (typeof JUNCTION_TIMESERIES_RESOURCE_POLICIES)[number]["resource"];

function selectJunctionTimeseriesResources(
  predicate: (policy: (typeof JUNCTION_TIMESERIES_RESOURCE_POLICIES)[number]) => boolean,
): JunctionTimeseriesResource[] {
  return JUNCTION_TIMESERIES_RESOURCE_POLICIES
    .filter(predicate)
    .map((policy) => policy.resource);
}

export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = Object.freeze(
  selectJunctionTimeseriesResources((policy) => policy.enabledByDefault),
);

export const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = Object.freeze(
  selectJunctionTimeseriesResources((policy) => !policy.enabledByDefault),
);

export const JUNCTION_KNOWN_TIMESERIES_RESOURCES = Object.freeze(
  selectJunctionTimeseriesResources(() => true),
);

export const JUNCTION_ALLOWED_TIMESERIES_RESOURCES = Object.freeze([
  ...JUNCTION_KNOWN_TIMESERIES_RESOURCES,
]);

export const JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES = Object.freeze(
  selectJunctionTimeseriesResources((policy) => policy.historyWindow === "summary_history"),
);

export const JUNCTION_WIDE_CHUNK_TIMESERIES_RESOURCES = Object.freeze(
  selectJunctionTimeseriesResources((policy) => policy.fetchChunkDays > 1),
);

const JUNCTION_TIMESERIES_POLICY_BY_RESOURCE = new Map<
  string,
  JunctionTimeseriesResourcePolicy
>(JUNCTION_TIMESERIES_RESOURCE_POLICIES.map((policy) => [policy.resource, policy]));

export function resolveJunctionTimeseriesResourcePolicy(
  value: unknown,
): JunctionTimeseriesResourcePolicy | null {
  const resource = normalizeJunctionResourceName(value);
  return resource ? JUNCTION_TIMESERIES_POLICY_BY_RESOURCE.get(resource) ?? null : null;
}

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
    case "body_fat":
      return "fat";
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
