export const JUNCTION_DEFAULT_SUMMARY_RESOURCES = Object.freeze([
  "profile",
  "activity",
  "sleep",
  "sleep_cycle",
  "workouts",
  "body",
] as const);

export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = Object.freeze([
  "steps",
  "distance",
  "calories_active",
  "heartrate",
  "hrv",
  "respiratory_rate",
  "blood_oxygen",
  "weight",
] as const);

export const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = Object.freeze([
  "glucose",
] as const);

export function normalizeJunctionResourceName(value: unknown): string | null {
  const resource = normalizeJunctionResourceSlug(value);
  switch (resource) {
    case "heart_rate":
      return "heartrate";
    case "body_weight":
      return "weight";
    case "sleep_cycle":
    case "hypnogram":
      return "sleep_cycle";
    case "spo2":
    case "blood_oxygen_saturation":
      return "blood_oxygen";
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
