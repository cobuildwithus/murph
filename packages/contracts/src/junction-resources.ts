export type JunctionTimeseriesNormalizationMode =
  | "daily_aggregate"
  | "hourly_or_session_feature"
  | "note_tags"
  | "sparse_reading";

export type JunctionTimeseriesHistoryWindow = "dense_timeseries" | "summary_history";

export interface JunctionTimeseriesResourcePolicy {
  readonly enabledByDefault: boolean;
  readonly historyWindow: JunctionTimeseriesHistoryWindow;
  readonly normalizationMode: JunctionTimeseriesNormalizationMode;
  readonly resource: string;
}

// Static, code-owned resource policy shared by config admission, fetch-window
// selection, and the importer. The ordering of default-enabled entries is the
// established runtime default and must remain stable. Opt-ins are appended so
// existing members and hosted runtimes do not begin fetching them implicitly.
export const JUNCTION_TIMESERIES_RESOURCE_POLICIES = Object.freeze([
  {
    resource: "blood_oxygen",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "stress_level",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "hrv",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "respiratory_rate",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "vo2_max",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "body_temperature_delta",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "body_temperature",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "basal_body_temperature",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "caffeine",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "water",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "mindfulness_minutes",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "heart_rate_recovery_one_minute",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "sleep_breathing_disturbance",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "afib_burden",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "glucose",
    enabledByDefault: true,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "blood_pressure",
    enabledByDefault: true,
    normalizationMode: "sparse_reading",
    historyWindow: "summary_history",
  },
  {
    resource: "note",
    enabledByDefault: true,
    normalizationMode: "note_tags",
    historyWindow: "summary_history",
  },
  {
    resource: "steps",
    enabledByDefault: false,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "distance",
    enabledByDefault: false,
    normalizationMode: "daily_aggregate",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "calories_active",
    enabledByDefault: false,
    normalizationMode: "hourly_or_session_feature",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "heartrate",
    enabledByDefault: false,
    normalizationMode: "hourly_or_session_feature",
    historyWindow: "dense_timeseries",
  },
  {
    resource: "weight",
    enabledByDefault: false,
    normalizationMode: "sparse_reading",
    historyWindow: "summary_history",
  },
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
