// These resources are part of the runtime configuration contract shared by
// device-syncd and the Junction importer. Keep the list in the lower contracts
// package so boot-time config readers do not import the turn-scoped importer
// graph just to merge required defaults.
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
