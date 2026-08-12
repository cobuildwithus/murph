import { describe, expect, it } from "vitest";

import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_RESOURCE_INVENTORY,
  JUNCTION_RESOURCE_POLICIES,
  JUNCTION_SPARSE_HISTORY_CHUNK_DAYS,
} from "../src/junction-resources.ts";

describe("Junction wearable resource policy", () => {
  it("gives every independently inventoried resource exactly one policy", () => {
    expect(JUNCTION_RESOURCE_INVENTORY).toHaveLength(57);
    expect(new Set(JUNCTION_RESOURCE_INVENTORY).size).toBe(57);
    expect(Object.keys(JUNCTION_RESOURCE_POLICIES).sort()).toEqual(
      [...JUNCTION_RESOURCE_INVENTORY].sort(),
    );
    expect(
      JUNCTION_RESOURCE_INVENTORY.filter((resource) =>
        JUNCTION_RESOURCE_POLICIES[resource].category === "timeseries"
      ),
    ).toHaveLength(47);
    expect(
      JUNCTION_RESOURCE_INVENTORY.filter((resource) =>
        JUNCTION_RESOURCE_POLICIES[resource].category !== "timeseries"
      ),
    ).toHaveLength(10);
  });

  it("derives the existing admitted resource surfaces from policy", () => {
    expect(JUNCTION_DEFAULT_SUMMARY_RESOURCES).toEqual([
      "activity",
      "sleep",
      "sleep_cycle",
      "workouts",
      "body",
      "meal",
      "profile",
      "menstrual_cycle",
      "electrocardiogram",
    ]);
    expect(JUNCTION_ALLOWED_SUMMARY_RESOURCES).toEqual(JUNCTION_DEFAULT_SUMMARY_RESOURCES);
    expect(JUNCTION_DEFAULT_TIMESERIES_RESOURCES).toHaveLength(19);
    expect(JUNCTION_ALLOWED_TIMESERIES_RESOURCES).toEqual(
      JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
    );
    expect(JUNCTION_KNOWN_TIMESERIES_RESOURCES).toHaveLength(24);
  });

  it("keeps dedicated and waveform resources out of generic fetch paths", () => {
    expect(JUNCTION_RESOURCE_POLICIES.workout_stream).toMatchObject({
      admission: "dedicated",
      category: "dedicated_stream",
      retention: "dedicated_fetch",
    });
    expect(JUNCTION_RESOURCE_POLICIES.electrocardiogram_voltage).toMatchObject({
      admission: "excluded",
      retention: "excluded",
    });
    expect(JUNCTION_RESOURCE_POLICIES.electrocardiogram_voltage.exclusionReason).toMatch(
      /Full ECG waveforms are intentionally excluded/u,
    );
    expect(JUNCTION_ALLOWED_SUMMARY_RESOURCES).not.toContain("workout_stream");
    expect(JUNCTION_ALLOWED_TIMESERIES_RESOURCES).not.toContain("electrocardiogram_voltage");
  });

  it("selects only compact supported sparse resources for long history", () => {
    expect(JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES).toEqual([
      "vo2_max",
      "body_temperature_delta",
      "body_temperature",
      "basal_body_temperature",
      "caffeine",
      "heart_rate_recovery_one_minute",
      "sleep_breathing_disturbance",
      "afib_burden",
      "blood_pressure",
      "note",
      "carbohydrates",
      "insulin_injection",
    ]);
    for (const resource of JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES) {
      const policy = JUNCTION_RESOURCE_POLICIES[resource];
      expect(policy.admission).toBe("default");
      expect(policy.frequency).toBe("sparse");
      expect(policy.initialHistoryDays).toBe(180);
      expect(policy.retention).not.toBe("feature_envelope");
    }
    for (const resource of JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES.filter(
      (candidate) => candidate !== "blood_pressure" && candidate !== "note",
    )) {
      expect(JUNCTION_RESOURCE_POLICIES[resource].historyChunkDays).toBe(
        JUNCTION_SPARSE_HISTORY_CHUNK_DAYS,
      );
      expect(JUNCTION_RESOURCE_POLICIES[resource].historyAnchor).toBe("schedule_time");
    }
    expect(JUNCTION_RESOURCE_POLICIES.blood_pressure.historyChunkDays).toBe(1);
    expect(JUNCTION_RESOURCE_POLICIES.blood_pressure.historyAnchor).toBe("source_first_seen");
    expect(JUNCTION_RESOURCE_POLICIES.note.historyChunkDays).toBe(1);
    expect(JUNCTION_RESOURCE_POLICIES.note.historyAnchor).toBe("schedule_time");
    expect(JUNCTION_RESOURCE_POLICIES.carbohydrates.retention).toBe("canonical_per_record");
    expect(JUNCTION_RESOURCE_POLICIES.insulin_injection.retention).toBe("canonical_per_record");
    expect(JUNCTION_RESOURCE_POLICIES.glucose.initialHistoryDays).toBe(14);
    expect(JUNCTION_RESOURCE_POLICIES.glucose.retention).toBe("canonical_aggregate");
    expect(JUNCTION_RESOURCE_POLICIES.heartrate.admission).toBe("known");
  });

  it("requires a rationale for every excluded or dedicated resource", () => {
    for (const policy of Object.values(JUNCTION_RESOURCE_POLICIES)) {
      if (policy.admission === "excluded" || policy.admission === "dedicated") {
        expect(policy.exclusionReason?.trim().length).toBeGreaterThan(0);
      } else {
        expect(policy.exclusionReason).toBeNull();
      }
    }
  });
});
