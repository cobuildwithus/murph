export const JUNCTION_RESOURCE_INVENTORY = Object.freeze([
  "activity",
  "sleep",
  "sleep_cycle",
  "workouts",
  "body",
  "meal",
  "profile",
  "menstrual_cycle",
  "electrocardiogram",
  "workout_stream",
  "steps",
  "distance",
  "calories_active",
  "heartrate",
  "blood_oxygen",
  "stress_level",
  "hrv",
  "respiratory_rate",
  "vo2_max",
  "weight",
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
  "body_mass_index",
  "calories_basal",
  "carbohydrates",
  "daylight_exposure",
  "electrocardiogram_voltage",
  "fall",
  "fat",
  "floors_climbed",
  "forced_expiratory_volume_1",
  "forced_vital_capacity",
  "handwashing",
  "heart_rate_alert",
  "inhaler_usage",
  "insulin_injection",
  "lean_body_mass",
  "peak_expiratory_flow_rate",
  "sleep_apnea_alert",
  "stand_duration",
  "stand_hour",
  "uv_exposure",
  "waist_circumference",
  "wheelchair_push",
  "workout_distance",
  "workout_duration",
  "workout_swimming_stroke",
] as const);

export type JunctionResourceName = (typeof JUNCTION_RESOURCE_INVENTORY)[number];

export const JUNCTION_SPARSE_CLINICAL_TIMESERIES_RESOURCES = Object.freeze([
  "heart_rate_alert",
  "sleep_apnea_alert",
  "fall",
  "forced_expiratory_volume_1",
  "forced_vital_capacity",
  "peak_expiratory_flow_rate",
  "inhaler_usage",
] as const satisfies readonly JunctionResourceName[]);

export type JunctionResourceCategory = "summary" | "timeseries" | "dedicated_stream";
export type JunctionResourceFrequency = "very_high" | "high" | "sparse";
export type JunctionResourceAdmission = "default" | "known" | "opt_in" | "excluded" | "dedicated";
export type JunctionResourceHistoryAnchor = "schedule_time" | "source_first_seen";
export type JunctionResourceRetention =
  | "canonical_per_record"
  | "canonical_aggregate"
  | "feature_envelope"
  | "evidence_only"
  | "excluded"
  | "dedicated_fetch";

export interface JunctionResourcePolicy {
  admission: JunctionResourceAdmission;
  category: JunctionResourceCategory;
  exclusionReason: string | null;
  frequency: JunctionResourceFrequency;
  historyAnchor: JunctionResourceHistoryAnchor;
  historyChunkDays: number;
  initialHistoryDays: number;
  retention: JunctionResourceRetention;
}

export const JUNCTION_DEFAULT_TIMESERIES_HISTORY_DAYS = 14;
export const JUNCTION_LONG_HISTORY_DAYS = 180;
export const JUNCTION_SPARSE_HISTORY_CHUNK_DAYS = 30;

function policy<
  const Category extends JunctionResourceCategory,
  const Frequency extends JunctionResourceFrequency,
  const Admission extends JunctionResourceAdmission,
  const Retention extends JunctionResourceRetention,
>(
  category: Category,
  frequency: Frequency,
  admission: Admission,
  retention: Retention,
  initialHistoryDays: number,
  historyChunkDays: number,
  exclusionReason: string | null = null,
  historyAnchor: JunctionResourceHistoryAnchor = "source_first_seen",
): Readonly<JunctionResourcePolicy & {
  admission: Admission;
  category: Category;
  frequency: Frequency;
  retention: Retention;
}> {
  return Object.freeze({
    admission,
    category,
    exclusionReason,
    frequency,
    historyAnchor,
    historyChunkDays,
    initialHistoryDays,
    retention,
  });
}

const summary = (retention: JunctionResourceRetention = "canonical_aggregate") =>
  policy("summary", "sparse", "default", retention, JUNCTION_LONG_HISTORY_DAYS, JUNCTION_LONG_HISTORY_DAYS);
const daily = (frequency: JunctionResourceFrequency) =>
  policy("timeseries", frequency, "default", "canonical_aggregate", JUNCTION_DEFAULT_TIMESERIES_HISTORY_DAYS, 1);
const sparseDaily = () =>
  policy(
    "timeseries",
    "sparse",
    "default",
    "canonical_aggregate",
    JUNCTION_LONG_HISTORY_DAYS,
    JUNCTION_SPARSE_HISTORY_CHUNK_DAYS,
    null,
    "schedule_time",
  );
const known = (frequency: JunctionResourceFrequency, retention: JunctionResourceRetention) =>
  policy("timeseries", frequency, "known", retention, JUNCTION_DEFAULT_TIMESERIES_HISTORY_DAYS, 1);
const excluded = (
  frequency: JunctionResourceFrequency,
  reason: string,
  retention: JunctionResourceRetention = "excluded",
) => policy("timeseries", frequency, "excluded", retention, 0, 0, reason);

export const JUNCTION_RESOURCE_POLICIES = Object.freeze({
  activity: summary(),
  sleep: summary(),
  sleep_cycle: summary(),
  workouts: summary(),
  body: summary(),
  meal: summary(),
  profile: summary(),
  menstrual_cycle: summary(),
  electrocardiogram: summary("canonical_per_record"),
  workout_stream: policy(
    "dedicated_stream",
    "high",
    "dedicated",
    "dedicated_fetch",
    0,
    0,
    "Requires a session-linked bounded feature fetch; generic summary and timeseries fetches are unsafe.",
  ),
  steps: known("high", "feature_envelope"),
  distance: known("high", "feature_envelope"),
  calories_active: known("very_high", "feature_envelope"),
  heartrate: known("very_high", "feature_envelope"),
  hrv: daily("high"),
  respiratory_rate: daily("high"),
  blood_oxygen: daily("high"),
  stress_level: daily("high"),
  vo2_max: sparseDaily(),
  weight: known("sparse", "canonical_per_record"),
  body_temperature_delta: sparseDaily(),
  body_temperature: sparseDaily(),
  basal_body_temperature: sparseDaily(),
  caffeine: sparseDaily(),
  water: daily("sparse"),
  mindfulness_minutes: daily("sparse"),
  heart_rate_recovery_one_minute: sparseDaily(),
  sleep_breathing_disturbance: sparseDaily(),
  afib_burden: sparseDaily(),
  glucose: daily("high"),
  blood_pressure: policy(
    "timeseries",
    "sparse",
    "default",
    "canonical_per_record",
    JUNCTION_LONG_HISTORY_DAYS,
    1,
  ),
  note: policy(
    "timeseries",
    "sparse",
    "default",
    "canonical_per_record",
    JUNCTION_LONG_HISTORY_DAYS,
    1,
    null,
    "schedule_time",
  ),
  body_mass_index: excluded("sparse", "No canonical per-reading importer is registered yet.", "canonical_per_record"),
  calories_basal: excluded("high", "No bounded aggregate importer is registered yet.", "feature_envelope"),
  carbohydrates: excluded("sparse", "No timed intake importer is registered yet.", "canonical_per_record"),
  daylight_exposure: excluded("high", "No bounded daylight feature importer is registered yet.", "feature_envelope"),
  electrocardiogram_voltage: excluded(
    "sparse",
    "Full ECG waveforms are intentionally excluded; only bounded derived features may be admitted.",
  ),
  fall: excluded("sparse", "No canonical safety-event importer is registered yet.", "canonical_per_record"),
  fat: excluded("sparse", "No canonical per-reading importer is registered yet.", "canonical_per_record"),
  floors_climbed: excluded("sparse", "No independent daily aggregate importer is registered yet.", "canonical_aggregate"),
  forced_expiratory_volume_1: excluded("sparse", "No canonical pulmonary measurement importer is registered yet.", "canonical_per_record"),
  forced_vital_capacity: excluded("sparse", "No canonical pulmonary measurement importer is registered yet.", "canonical_per_record"),
  handwashing: excluded("sparse", "No current product use justifies canonical retention."),
  heart_rate_alert: excluded("sparse", "No canonical alert-event importer is registered yet.", "canonical_per_record"),
  inhaler_usage: excluded("sparse", "No medication-use importer is registered yet.", "canonical_per_record"),
  insulin_injection: excluded("sparse", "No medication-administration importer is registered yet.", "canonical_per_record"),
  lean_body_mass: excluded("sparse", "No canonical per-reading importer is registered yet.", "canonical_per_record"),
  peak_expiratory_flow_rate: excluded("sparse", "No canonical pulmonary measurement importer is registered yet.", "canonical_per_record"),
  sleep_apnea_alert: excluded("sparse", "No canonical alert-event importer is registered yet.", "canonical_per_record"),
  stand_duration: excluded("high", "No bounded sedentary feature importer is registered yet.", "feature_envelope"),
  stand_hour: excluded("sparse", "No canonical interval aggregate importer is registered yet.", "canonical_aggregate"),
  uv_exposure: excluded("sparse", "No current product use justifies canonical retention."),
  waist_circumference: excluded("sparse", "No canonical per-reading importer is registered yet.", "canonical_per_record"),
  wheelchair_push: excluded("sparse", "No accessibility-aware aggregate importer is registered yet.", "feature_envelope"),
  workout_distance: excluded("high", "Requires a session-linked bounded workout feature importer.", "feature_envelope"),
  workout_duration: excluded("sparse", "Requires a session-linked workout importer.", "canonical_aggregate"),
  workout_swimming_stroke: excluded("high", "Requires a session-linked bounded swim feature importer.", "feature_envelope"),
} as const satisfies Record<JunctionResourceName, JunctionResourcePolicy>);

export type JunctionTimeseriesResourceName = {
  [Resource in JunctionResourceName]:
    (typeof JUNCTION_RESOURCE_POLICIES)[Resource]["category"] extends "timeseries"
      ? Resource
      : never;
}[JunctionResourceName];

function resourcesWhere(
  predicate: (policy: JunctionResourcePolicy, resource: JunctionResourceName) => boolean,
): readonly JunctionResourceName[] {
  return Object.freeze(
    JUNCTION_RESOURCE_INVENTORY.filter((resource) =>
      predicate(JUNCTION_RESOURCE_POLICIES[resource], resource)
    ),
  );
}

export const JUNCTION_DEFAULT_SUMMARY_RESOURCES = resourcesWhere((entry) =>
  entry.category === "summary" && entry.admission === "default"
);
export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries" && entry.admission === "default"
);
export const JUNCTION_KNOWN_TIMESERIES_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries" && (entry.admission === "default" || entry.admission === "known")
);
export const JUNCTION_TIMESERIES_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries"
);
export const JUNCTION_OPT_IN_SUMMARY_RESOURCES = resourcesWhere((entry) =>
  entry.category === "summary" && entry.admission === "opt_in"
);
export const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries" && entry.admission === "opt_in"
);
export const JUNCTION_RAW_ONLY_SUMMARY_RESOURCES = resourcesWhere((entry) =>
  entry.category === "summary" && entry.retention === "evidence_only"
);
export const JUNCTION_ALLOWED_SUMMARY_RESOURCES = resourcesWhere((entry) =>
  entry.category === "summary" && (entry.admission === "default" || entry.admission === "opt_in")
);
export const JUNCTION_ALLOWED_TIMESERIES_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries" && (entry.admission === "default" || entry.admission === "opt_in")
);
export const JUNCTION_KNOWN_WEBHOOK_RESOURCES = JUNCTION_RESOURCE_INVENTORY;
export const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES = resourcesWhere((entry) =>
  entry.category === "timeseries"
  && entry.admission === "default"
  && entry.initialHistoryDays > JUNCTION_DEFAULT_TIMESERIES_HISTORY_DAYS
);

export function getJunctionResourcePolicy(
  resource: string,
): JunctionResourcePolicy | null {
  if (!JUNCTION_RESOURCE_INVENTORY.includes(resource as JunctionResourceName)) {
    return null;
  }
  return JUNCTION_RESOURCE_POLICIES[resource as JunctionResourceName];
}
