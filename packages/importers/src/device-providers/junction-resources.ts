import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
  type JunctionTimeseriesResourceName,
} from "@murphai/contracts";

export {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
};

export type JunctionTimeseriesResource = JunctionTimeseriesResourceName;

export function normalizeJunctionRawIdentityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

export function isJunctionRawDirectIdentityKey(key: string): boolean {
  const normalized = normalizeJunctionRawIdentityKey(key);
  return [
    "account",
    "client",
    "clientuser",
    "member",
    "owner",
    "patient",
    "person",
    "profile",
    "subject",
    "user",
  ].some((entity) => normalized.includes(`${entity}id`))
    || [
      "address",
      "addressline1",
      "addressline2",
      "birthdate",
      "city",
      "dateofbirth",
      "displayname",
      "dob",
      "familyname",
      "firstname",
      "fullname",
      "givenname",
      "lastname",
      "maidenname",
      "middlename",
      "postalcode",
      "preferredname",
      "state",
      "street",
      "streetaddress",
      "zipcode",
      "zip",
    ].includes(normalized)
    || [
      "account",
      "client",
      "clientuser",
      "member",
      "owner",
      "patient",
      "person",
      "profile",
      "subject",
      "user",
    ].some((entity) => normalized === `${entity}name`)
    || normalized.includes("email")
    || normalized.includes("phone");
}

export function isJunctionRawDirectIdentityContainerKey(key: string): boolean {
  const normalized = normalizeJunctionRawIdentityKey(key);
  return JUNCTION_RAW_DIRECT_IDENTITY_CONTAINER_KEYS.has(normalized);
}

const JUNCTION_RAW_DIRECT_IDENTITY_CONTAINER_KEYS = new Set([
  "account",
  "accounts",
  "client",
  "clients",
  "member",
  "members",
  "owner",
  "owners",
  "patient",
  "patients",
  "person",
  "people",
  "profile",
  "profiles",
  "subject",
  "subjects",
  "user",
  "users",
]);

export const JUNCTION_SLEEP_SCORE_PATHS = Object.freeze([
  "sleepScore",
  "sleep_score",
  "score",
] as const);
export const JUNCTION_SLEEP_DURATION_MINUTE_PATHS = Object.freeze([
  "durationMinutes",
  "duration_minutes",
  "totalSleepMinutes",
  "total_sleep_minutes",
] as const);
export const JUNCTION_SLEEP_DURATION_SECOND_PATHS = Object.freeze([
  "durationSeconds",
  "duration_seconds",
  "duration",
  "total",
] as const);
export const JUNCTION_SLEEP_DURATION_MILLISECOND_PATHS = Object.freeze([
  "durationMillis",
  "duration_millis",
] as const);
export const JUNCTION_SLEEP_TOTAL_MINUTE_PATHS = Object.freeze([
  "totalSleepMinutes",
  "total_sleep_minutes",
  "asleep_minutes",
] as const);
export const JUNCTION_SLEEP_TOTAL_SECOND_PATHS = Object.freeze([
  "total",
] as const);
export const JUNCTION_SLEEP_DEEP_MINUTE_PATHS = Object.freeze([
  "deepMinutes",
  "deep_minutes",
] as const);
export const JUNCTION_SLEEP_DEEP_SECOND_PATHS = Object.freeze([
  "deep",
] as const);
export const JUNCTION_SLEEP_REM_MINUTE_PATHS = Object.freeze([
  "remMinutes",
  "rem_minutes",
] as const);
export const JUNCTION_SLEEP_REM_SECOND_PATHS = Object.freeze([
  "rem",
] as const);
export const JUNCTION_SLEEP_LIGHT_MINUTE_PATHS = Object.freeze([
  "lightMinutes",
  "light_minutes",
] as const);
export const JUNCTION_SLEEP_LIGHT_SECOND_PATHS = Object.freeze([
  "light",
] as const);
export const JUNCTION_SLEEP_AWAKE_MINUTE_PATHS = Object.freeze([
  "awakeMinutes",
  "awake_minutes",
] as const);
export const JUNCTION_SLEEP_AWAKE_SECOND_PATHS = Object.freeze([
  "awake",
] as const);
export const JUNCTION_SLEEP_TIME_IN_BED_MINUTE_PATHS = Object.freeze([
  "timeInBedMinutes",
  "time_in_bed_minutes",
  "inBedMinutes",
  "in_bed_minutes",
] as const);
export const JUNCTION_SLEEP_TIME_IN_BED_SECOND_PATHS = Object.freeze([
  "timeInBed",
  "time_in_bed",
  "inBed",
  "in_bed",
] as const);
export const JUNCTION_SLEEP_LATENCY_SECOND_PATHS = Object.freeze([
  "latencySeconds",
  "latency_seconds",
  "latency",
] as const);
export const JUNCTION_SLEEP_EFFICIENCY_RATIO_PATHS = Object.freeze([
  "sleepEfficiency",
  "sleep_efficiency",
  "efficiency",
] as const);
export const JUNCTION_SLEEP_CONSISTENCY_PATHS = Object.freeze([
  "sleepConsistency",
  "sleep_consistency",
] as const);
export const JUNCTION_SLEEP_PERFORMANCE_PATHS = Object.freeze([
  "sleepPerformance",
  "sleep_performance",
] as const);
export const JUNCTION_SLEEP_HRV_PATHS = Object.freeze([
  "hrv",
  "hrvRmssd",
  "hrv_rmssd",
  "average_hrv",
] as const);
export const JUNCTION_SLEEP_AVERAGE_HEART_RATE_PATHS = Object.freeze([
  "averageHeartRate",
  "average_heart_rate",
  "average_hr",
  "avg_hr",
  "hr_average",
] as const);
export const JUNCTION_SLEEP_LOWEST_HEART_RATE_PATHS = Object.freeze([
  "lowestHeartRate",
  "lowest_heart_rate",
  "min_hr",
  "hr_lowest",
] as const);
export const JUNCTION_SLEEP_RESTING_HEART_RATE_PATHS = Object.freeze([
  "restingHeartRate",
  "resting_heart_rate",
  "resting_hr",
  "rhr",
  "hr_resting",
] as const);
export const JUNCTION_SLEEP_RESPIRATORY_RATE_PATHS = Object.freeze([
  "respiratoryRate",
  "respiratory_rate",
] as const);
export const JUNCTION_SLEEP_SPO2_PATHS = Object.freeze([
  "spo2",
  "bloodOxygen",
  "blood_oxygen",
  "oxygen_saturation",
] as const);
export const JUNCTION_SLEEP_TEMPERATURE_PATHS = Object.freeze([
  "skin_temperature",
] as const);
export const JUNCTION_SLEEP_TEMPERATURE_DEVIATION_PATHS = Object.freeze([
  "temperatureDelta",
  "temperature_delta",
  "skin_temperature_delta",
] as const);
export const JUNCTION_SLEEP_START_TIMESTAMP_PATHS = Object.freeze([
  "start",
  "startAt",
  "start_at",
  "startTime",
  "start_time",
  "startTimestamp",
  "start_timestamp",
  "timeStart",
  "time_start",
  "bedtimeStart",
  "bedtime_start",
] as const);
export const JUNCTION_SLEEP_END_TIMESTAMP_PATHS = Object.freeze([
  "end",
  "endAt",
  "end_at",
  "endTime",
  "end_time",
  "endTimestamp",
  "end_timestamp",
  "timeEnd",
  "time_end",
  "bedtimeEnd",
  "bedtime_end",
  "bedtimeStop",
  "bedtime_stop",
] as const);
export const JUNCTION_SLEEP_STAGE_VALUE_PATHS = Object.freeze([
  "stage",
  "sleepStage",
  "sleep_stage",
  "sleepStageType",
  "sleep_stage_type",
  "stageType",
  "stage_type",
  "level",
  "state",
  "name",
  "type",
  "value",
] as const);
export type JunctionSleepStageValue = "awake" | "light" | "deep" | "rem" | "asleep_unspecified";
export function normalizeJunctionSleepStageValue(value: unknown): JunctionSleepStageValue | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    switch (value) {
      case 1:
        return "deep";
      case 2:
        return "light";
      case 3:
        return "rem";
      case 4:
        return "awake";
      default:
        return null;
    }
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (/^[+-]\d+$/u.test(trimmed)) {
    return null;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  switch (normalized) {
    case "asleep":
    case "asleep_unspecified":
    case "sleep":
    case "sleeping":
      return "asleep_unspecified";
    case "1":
      return "deep";
    case "2":
      return "light";
    case "3":
      return "rem";
    case "4":
      return "awake";
    case "awake":
    case "wake":
    case "waking":
    case "wakefulness":
      return "awake";
    case "light":
    case "light_sleep":
    case "core":
    case "core_sleep":
    case "n1":
    case "n2":
      return "light";
    case "deep":
    case "deep_sleep":
    case "slow_wave":
    case "slow_wave_sleep":
    case "sws":
    case "n3":
      return "deep";
    case "rem":
    case "rem_sleep":
    case "rapid_eye_movement":
    case "rapid_eye_movement_sleep":
      return "rem";
    default:
      return null;
  }
}
export const JUNCTION_SLEEP_STAGE_ARRAY_PATHS = Object.freeze([
  "stages",
  "sleepStages",
  "sleep_stages",
  "sleepLevels",
  "sleep_levels",
  "sleepCycle",
  "sleep_cycle",
  "hypnogram",
  "intervals",
  "segments",
  "stageIntervals",
  "stage_intervals",
  "levels",
  "records",
  "items",
  "data",
] as const);
export const JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS = Object.freeze([
  "durationMinutes",
  "duration_minutes",
  "durationInMinutes",
  "duration_in_minutes",
  "minutes",
] as const);
export const JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS = Object.freeze([
  "durationSeconds",
  "duration_seconds",
  "durationInSeconds",
  "duration_in_seconds",
  "duration",
] as const);
export const JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS = Object.freeze([
  "durationMillis",
  "duration_millis",
  "durationInMilliseconds",
  "duration_in_milliseconds",
  "durationMs",
  "duration_ms",
] as const);
export const JUNCTION_SLEEP_STAGE_DURATION_PATHS = Object.freeze([
  ...JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS,
  ...JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS,
  ...JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS,
] as const);
export const JUNCTION_SLEEP_STAGE_COUNT_PATHS = Object.freeze([
  "stageCount",
  "stage_count",
  "sleepStageCount",
  "sleep_stage_count",
] as const);
export const JUNCTION_SLEEP_SUMMARY_NUMBER_PATHS = Object.freeze([
  ...JUNCTION_SLEEP_SCORE_PATHS,
  ...JUNCTION_SLEEP_DURATION_MINUTE_PATHS,
  ...JUNCTION_SLEEP_DURATION_SECOND_PATHS,
  ...JUNCTION_SLEEP_DURATION_MILLISECOND_PATHS,
  ...JUNCTION_SLEEP_TOTAL_MINUTE_PATHS,
  ...JUNCTION_SLEEP_TOTAL_SECOND_PATHS,
  ...JUNCTION_SLEEP_DEEP_MINUTE_PATHS,
  ...JUNCTION_SLEEP_DEEP_SECOND_PATHS,
  ...JUNCTION_SLEEP_REM_MINUTE_PATHS,
  ...JUNCTION_SLEEP_REM_SECOND_PATHS,
  ...JUNCTION_SLEEP_LIGHT_MINUTE_PATHS,
  ...JUNCTION_SLEEP_LIGHT_SECOND_PATHS,
  ...JUNCTION_SLEEP_AWAKE_MINUTE_PATHS,
  ...JUNCTION_SLEEP_AWAKE_SECOND_PATHS,
  ...JUNCTION_SLEEP_LATENCY_SECOND_PATHS,
  ...JUNCTION_SLEEP_EFFICIENCY_RATIO_PATHS,
  ...JUNCTION_SLEEP_HRV_PATHS,
  ...JUNCTION_SLEEP_AVERAGE_HEART_RATE_PATHS,
  ...JUNCTION_SLEEP_LOWEST_HEART_RATE_PATHS,
  ...JUNCTION_SLEEP_RESTING_HEART_RATE_PATHS,
  ...JUNCTION_SLEEP_RESPIRATORY_RATE_PATHS,
  ...JUNCTION_SLEEP_SPO2_PATHS,
  ...JUNCTION_SLEEP_TEMPERATURE_PATHS,
  ...JUNCTION_SLEEP_TEMPERATURE_DEVIATION_PATHS,
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
