import { describe, expect, it } from "vitest";

import {
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_TIMESERIES_RESOURCE_POLICIES,
  JUNCTION_WIDE_CHUNK_TIMESERIES_RESOURCES,
  resolveJunctionTimeseriesResourcePolicy,
  usesJunctionTimeseriesIntervalStartOwnership,
} from "../src/junction-resources.ts";

const EXPECTED_DEFAULTS = [
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
  "steps",
  "distance",
  "calories_active",
  "heartrate",
  "weight",
  "forced_expiratory_volume_1",
  "forced_vital_capacity",
  "heart_rate_alert",
  "inhaler_usage",
  "peak_expiratory_flow_rate",
  "sleep_apnea_alert",
  "fall",
];

const EXPECTED_NEW_SPARSE_OPT_INS = [
  "body_mass_index",
  "carbohydrates",
  "fat",
  "insulin_injection",
  "lean_body_mass",
  "waist_circumference",
];

const EXPECTED_SPARSE_CLINICAL_DEFAULTS = [
  "forced_expiratory_volume_1",
  "forced_vital_capacity",
  "heart_rate_alert",
  "inhaler_usage",
  "peak_expiratory_flow_rate",
  "sleep_apnea_alert",
  "fall",
];

const EXPECTED_NEXT_OPT_INS = [
  "calories_basal",
  "daylight_exposure",
  "floors_climbed",
  "handwashing",
  "stand_duration",
  "stand_hour",
  "uv_exposure",
  "wheelchair_push",
  "workout_distance",
  "workout_duration",
  "workout_swimming_stroke",
];

const EXPECTED_NEXT_DAILY_AGGREGATES = [
  "calories_basal",
  "daylight_exposure",
  "floors_climbed",
  "stand_duration",
  "stand_hour",
  "wheelchair_push",
];

const EXPECTED_NEXT_SESSION_FEATURES = [
  "handwashing",
  "uv_exposure",
  "workout_distance",
  "workout_duration",
  "workout_swimming_stroke",
];

const EXPECTED_DENSE_FEATURE_OPT_INS = [
  "electrocardiogram_voltage",
  "workout_stream",
];

const EXPECTED_OPT_IN = [
  ...EXPECTED_NEW_SPARSE_OPT_INS,
  ...EXPECTED_NEXT_OPT_INS,
  ...EXPECTED_DENSE_FEATURE_OPT_INS,
];

describe("Junction timeseries resource policy", () => {
  it("derives unique exact known/default/opt-in/allowed projections", () => {
    const names = JUNCTION_TIMESERIES_RESOURCE_POLICIES.map((entry) => entry.resource);
    expect(new Set(names).size).toBe(names.length);
    expect(JUNCTION_KNOWN_TIMESERIES_RESOURCES).toEqual(names);
    expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).toEqual(EXPECTED_DEFAULTS);
    expect(JUNCTION_OPT_IN_TIMESERIES_RESOURCES).toEqual(EXPECTED_OPT_IN);
    expect(JUNCTION_ALLOWED_TIMESERIES_RESOURCES).toEqual([
      ...EXPECTED_DEFAULTS,
      ...EXPECTED_OPT_IN,
    ]);
  });

  it("keeps the remaining sparse slice off by default with extended bounded history", () => {
    expect(JUNCTION_WIDE_CHUNK_TIMESERIES_RESOURCES).toEqual(EXPECTED_NEW_SPARSE_OPT_INS);
    for (const resource of EXPECTED_NEW_SPARSE_OPT_INS) {
      expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).not.toContain(resource);
      expect(JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES).toContain(resource);
      expect(resolveJunctionTimeseriesResourcePolicy(resource)).toMatchObject({
        enabledByDefault: false,
        fetchChunkDays: 30,
        historyWindow: "summary_history",
      });
    }
    for (const resource of EXPECTED_SPARSE_CLINICAL_DEFAULTS) {
      expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).toContain(resource);
      expect(JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES).toContain(resource);
      expect(resolveJunctionTimeseriesResourcePolicy(resource)).toMatchObject({
        enabledByDefault: true,
        fetchChunkDays: 1,
        historyWindow: "summary_history",
        maxCanonicalRecordsPerWindow: 100,
        maxSamplesPerWindow: 128,
      });
    }
    expect(resolveJunctionTimeseriesResourcePolicy("blood_oxygen")).toMatchObject({
      enabledByDefault: true,
      fetchChunkDays: 1,
      historyWindow: "dense_timeseries",
    });
    for (const resource of EXPECTED_DENSE_FEATURE_OPT_INS) {
      expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).not.toContain(resource);
      expect(JUNCTION_LONG_HISTORY_TIMESERIES_RESOURCES).not.toContain(resource);
      expect(JUNCTION_WIDE_CHUNK_TIMESERIES_RESOURCES).not.toContain(resource);
    }
    expect(resolveJunctionTimeseriesResourcePolicy("electrocardiogram_voltage")).toMatchObject({
      enabledByDefault: false,
      fetchChunkDays: 1,
      historyWindow: "dense_timeseries",
      maxRecordsPerWindow: 64,
      maxSamplesPerWindow: 100_000,
      normalizationMode: "ecg_recording_feature",
    });
    expect(resolveJunctionTimeseriesResourcePolicy("workout_stream")).toMatchObject({
      enabledByDefault: false,
      fetchChunkDays: 1,
      fetchMode: "workout_stream",
      historyWindow: "dense_timeseries",
      maxRecordsPerWindow: 32,
      maxSamplesPerRecord: 100_000,
      normalizationMode: "workout_stream_feature",
    });
  });

  it("keeps the activity slice exact-opt-in with policy-owned compact storage modes", () => {
    for (const resource of EXPECTED_NEXT_OPT_INS) {
      expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).not.toContain(resource);
    }
    for (const resource of EXPECTED_NEXT_DAILY_AGGREGATES) {
      expect(resolveJunctionTimeseriesResourcePolicy(resource)).toMatchObject({
        enabledByDefault: false,
        fetchChunkDays: 1,
        historyWindow: "dense_timeseries",
        normalizationMode: "daily_aggregate",
      });
    }
    for (const resource of EXPECTED_NEXT_SESSION_FEATURES) {
      expect(resolveJunctionTimeseriesResourcePolicy(resource)).toMatchObject({
        enabledByDefault: false,
        fetchChunkDays: 1,
        historyWindow: "dense_timeseries",
        normalizationMode: "hourly_or_session_feature",
      });
    }
    expect(resolveJunctionTimeseriesResourcePolicy("fall")).toMatchObject({
      enabledByDefault: true,
      fetchChunkDays: 1,
      historyWindow: "summary_history",
      maxCanonicalRecordsPerWindow: 100,
      maxSamplesPerWindow: 128,
      normalizationMode: "sparse_alert",
    });
    expect(usesJunctionTimeseriesIntervalStartOwnership(
      resolveJunctionTimeseriesResourcePolicy("steps"),
    )).toBe(true);
    expect(usesJunctionTimeseriesIntervalStartOwnership(
      resolveJunctionTimeseriesResourcePolicy("workout_duration"),
    )).toBe(true);
    expect(usesJunctionTimeseriesIntervalStartOwnership(
      resolveJunctionTimeseriesResourcePolicy("fall"),
    )).toBe(false);
  });

  it("fails closed for unknown names and preserves public aliases", () => {
    expect(resolveJunctionTimeseriesResourcePolicy("not_a_junction_resource")).toBeNull();
    expect(resolveJunctionTimeseriesResourcePolicy("body_fat")?.resource).toBe("fat");
    expect(resolveJunctionTimeseriesResourcePolicy("body_weight")?.resource).toBe("weight");
  });
});
