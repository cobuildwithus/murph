import { describe, expect, it } from "vitest";

import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage,
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  canRepresentJunctionExtendedTimeseriesHistoryBackfillCoverage,
  encodeJunctionHistoricalBackfillStatus,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION,
  mergeHostedJunctionHistoricalBackfillMetadata,
  readJunctionHistoricalBackfillEvidence,
  readJunctionHistoricalBackfillStatus,
  removeJunctionExtendedTimeseriesHistoryBackfillCoverage,
} from "../src/junction-historical-backfill-progress.ts";
import { JUNCTION_CONNECT_SOURCE_TARGETS } from "../src/config/junction-connect-sources.ts";
import {
  DEVICE_SYNC_METADATA_MAX_STRING_LENGTH,
  mergeStoredDeviceSyncMetadataPatch,
} from "../src/metadata.ts";

const WINDOW_START = "2025-12-20T00:00:00.000Z";
const WINDOW_END = "2026-03-20T00:00:00.000Z";

describe("Junction extended-history coverage reset", () => {
  it("removes only the selected source and resource matrix bit", () => {
    const metadata = addCoverage(
      addCoverage(
        addCoverage({}, "apple_health_kit", "weight"),
        "withings",
        "weight",
      ),
      "apple_health_kit",
      "caffeine",
    );

    const reset = removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata,
      providerSlug: "apple_health_kit",
      resource: "weight",
      version: 1,
    });

    expect(reset).not.toBeNull();
    if (!reset) {
      throw new TypeError("Expected current matrix coverage to be resettable.");
    }
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "apple_health_kit",
      "weight",
      1,
    )).toBe(false);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "withings",
      "weight",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "apple_health_kit",
      "caffeine",
      1,
    )).toBe(true);
  });

  it("leaves malformed and future matrix encodings unchanged", () => {
    const current = addCoverage({}, "apple_health_kit", "caffeine");
    const matrixKey = Object.keys(current)[0];
    const matrixValue = matrixKey ? current[matrixKey] : null;
    expect(typeof matrixValue).toBe("string");
    if (!matrixKey || typeof matrixValue !== "string") {
      throw new TypeError("Expected current matrix coverage.");
    }
    const future = {
      ...current,
      [matrixKey]: matrixValue.replace(/^m1\|/u, "m3|"),
    };
    const malformed = { [matrixKey]: "not-a-coverage-matrix" };

    expect(removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: future,
      providerSlug: "apple_health_kit",
      resource: "caffeine",
      version: 1,
    })).toBeNull();
    expect(removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: malformed,
      providerSlug: "apple_health_kit",
      resource: "caffeine",
      version: 1,
    })).toBeNull();
    expect(future[matrixKey]).toBe(matrixValue.replace(/^m1\|/u, "m3|"));
    expect(malformed[matrixKey]).toBe("not-a-coverage-matrix");
  });
});

describe("Junction historical backfill progress versions", () => {
  it("writes coverage v3 while continuing to read legacy v2 progress", () => {
    expect(JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION).toBe(3);
    expect(encodeJunctionHistoricalBackfillStatus("complete")).toBe("coverage_v3_complete");
    expect(readJunctionHistoricalBackfillStatus("coverage_v2_retrying")).toEqual({
      coverageVersion: 2,
      status: "retrying",
    });
    expect(canCurrentRuntimeMutateJunctionHistoricalBackfillProgress({
      junctionHistoricalBackfillStatus: "coverage_v2_complete",
    })).toBe(true);
    expect(canCurrentRuntimeMutateJunctionHistoricalBackfillProgress({
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
    })).toBe(true);
  });

  it("leaves future coverage versions opaque and immutable", () => {
    expect(canCurrentRuntimeMutateJunctionHistoricalBackfillProgress({
      junctionHistoricalBackfillStatus: "coverage_v4_deferred",
    })).toBe(false);

    const opaqueEvidence = "e3|opaque-future-evidence";
    const result = mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence:
          `e2|${WINDOW_START}|${WINDOW_END}|garmin:1`,
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillWindowStart: WINDOW_START,
        junctionHistoricalBackfillWindowEnd: WINDOW_END,
      },
    });

    expect(result).toEqual({
      metadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
      },
      preservedLocalProgress: false,
    });

    expect(mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
      },
    })).toEqual({
      metadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
      },
      preservedLocalProgress: true,
    });
  });
});

describe("Junction historical backfill evidence versions", () => {
  it("writes and reads e2 evidence", () => {
    const encoded = addJunctionHistoricalBackfillEvidence({
      existingValue: null,
      providerSlug: "garmin",
      resource: "sleep",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(encoded).toBe(`e2|${WINDOW_START}|${WINDOW_END}|garmin:2`);
    expect(readJunctionHistoricalBackfillEvidence(encoded)).toEqual({
      resourcesByProvider: { garmin: 2 },
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });
  });

  it("does not reinterpret legacy e1 or future e3 evidence", () => {
    expect(readJunctionHistoricalBackfillEvidence(
      `e1|${WINDOW_START}|${WINDOW_END}|garmin:2`,
    )).toBeNull();
    expect(readJunctionHistoricalBackfillEvidence(
      `e3|${WINDOW_START}|${WINDOW_END}|garmin:2`,
    )).toBeNull();
  });
});

describe("Junction extended timeseries history coverage", () => {
  it("packs independent resource coverage into one source-scoped metadata value", () => {
    const coverage = addCoverage(
      addCoverage(
        addCoverage({}, "omron", "caffeine"),
        "omron",
        "afib_burden",
      ),
      "oura",
      "water",
    );
    const encoded = coverage.junctionBloodPressureHistoryBackfillCoverage;

    expect(typeof encoded).toBe("string");
    if (typeof encoded !== "string") {
      throw new TypeError("Expected encoded Junction extended-history coverage.");
    }
    expect(encoded).toHaveLength(195);
    expect(encoded.length).toBeLessThanOrEqual(DEVICE_SYNC_METADATA_MAX_STRING_LENGTH);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      coverage,
      "omron",
      "afib_burden",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      coverage,
      "oura",
      "caffeine",
      1,
    )).toBe(false);
    expect(canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionBloodPressureHistoryBackfillCoverage: `m3|${"0".repeat(192)}` },
      "caffeine",
      1,
    )).toBe(false);
  });

  it("reopens legacy note v1 while accepting the deployed v2 generation", () => {
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionNoteHistoryBackfillCoverage: "v1|oura" },
      "oura",
      "note",
      2,
    )).toBe(false);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionNoteHistoryBackfillCoverage: "v2|oura" },
      "oura",
      "note",
      2,
    )).toBe(true);
  });

  it("keeps deployed m1 coordinates until the first body coordinate requires m2", () => {
    const deployed = addCoverage(
      addCoverage({}, "omron", "caffeine"),
      "withings",
      "water",
    );
    const deployedValue = deployed.junctionBloodPressureHistoryBackfillCoverage;
    expect(deployedValue).toMatch(/^m1\|/u);
    expect(deployedValue).toHaveLength(195);

    const migrated = addCoverage(deployed, "withings", "weight");
    const migratedValue = migrated.junctionBloodPressureHistoryBackfillCoverage;
    expect(migratedValue).toMatch(/^m2\|/u);
    expect(migratedValue).toHaveLength(206);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      migrated,
      "omron",
      "caffeine",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      migrated,
      "withings",
      "water",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      migrated,
      "withings",
      "weight",
      1,
    )).toBe(true);
  });

  it("unions unpublished local resource bits without losing hosted coverage", () => {
    const result = mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: addCoverage({}, "omron", "afib_burden"),
      localConnectionStateUnpublished: true,
      localMetadata: addCoverage(
        addCoverage({}, "omron", "caffeine"),
        "oura",
        "water",
      ),
    });

    expect(result.preservedLocalProgress).toBe(true);
    for (const [providerSlug, resource] of [
      ["omron", "afib_burden"],
      ["omron", "caffeine"],
      ["oura", "water"],
    ] as const) {
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        result.metadata,
        providerSlug,
        resource,
        1,
      )).toBe(true);
    }
  });

  it("zero-extends the pre-metabolic m2 matrix on its next write", () => {
    const previousBytes = new Uint8Array(136);
    previousBytes[1] = 1 << 3; // source slot 0 (whoop), resource slot 11 (water)
    const previous = {
      junctionBloodPressureHistoryBackfillCoverage:
        `m2|${Buffer.from(previousBytes).toString("base64url")}`,
    };

    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      previous,
      "whoop_v2",
      "water",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      previous,
      "whoop_v2",
      "carbohydrates",
      1,
    )).toBe(false);

    const upgraded = addCoverage(previous, "whoop_v2", "carbohydrates");
    expect(upgraded.junctionBloodPressureHistoryBackfillCoverage).toHaveLength(206);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      upgraded,
      "whoop_v2",
      "water",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      upgraded,
      "whoop_v2",
      "carbohydrates",
      1,
    )).toBe(true);
  });

  it("fits every supported source and extended resource in one metadata scalar", () => {
    const resources = [
      "blood_pressure",
      "note",
      "afib_burden",
      "basal_body_temperature",
      "body_temperature",
      "body_temperature_delta",
      "caffeine",
      "heart_rate_recovery_one_minute",
      "mindfulness_minutes",
      "sleep_breathing_disturbance",
      "vo2_max",
      "water",
      "weight",
      "fat",
      "body_mass_index",
      "lean_body_mass",
      "waist_circumference",
      "carbohydrates",
      "insulin_injection",
    ] as const;
    let metadata: Record<string, unknown> = {};

    for (const { providerSlug } of JUNCTION_CONNECT_SOURCE_TARGETS) {
      for (const resource of resources) {
        metadata = addCoverage(metadata, providerSlug, resource);
      }
    }

    expect(Object.keys(metadata)).toEqual([
      "junctionBloodPressureHistoryBackfillCoverage",
    ]);
    expect(metadata.junctionBloodPressureHistoryBackfillCoverage).toHaveLength(206);
    for (const { providerSlug } of JUNCTION_CONNECT_SOURCE_TARGETS) {
      for (const resource of resources) {
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          metadata,
          providerSlug,
          resource,
          historyCoverageVersion(resource),
        )).toBe(true);
      }
    }
  });

  it("unions maximum hosted and local matrices without losing a covered pair", () => {
    const resources = [
      "blood_pressure",
      "note",
      "afib_burden",
      "basal_body_temperature",
      "body_temperature",
      "body_temperature_delta",
      "caffeine",
      "heart_rate_recovery_one_minute",
      "mindfulness_minutes",
      "sleep_breathing_disturbance",
      "vo2_max",
      "water",
      "weight",
      "fat",
      "body_mass_index",
      "lean_body_mass",
      "waist_circumference",
      "carbohydrates",
      "insulin_injection",
    ] as const;
    let hostedMetadata: Record<string, unknown> = {};
    let localMetadata: Record<string, unknown> = {};

    for (const [sourceIndex, { providerSlug }] of JUNCTION_CONNECT_SOURCE_TARGETS.entries()) {
      for (const [resourceIndex, resource] of resources.entries()) {
        if ((sourceIndex + resourceIndex) % 2 === 0) {
          hostedMetadata = addCoverage(hostedMetadata, providerSlug, resource);
        } else {
          localMetadata = addCoverage(localMetadata, providerSlug, resource);
        }
      }
    }

    const result = mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata,
      localConnectionStateUnpublished: true,
      localMetadata,
    });
    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata.junctionBloodPressureHistoryBackfillCoverage).toHaveLength(206);
    for (const { providerSlug } of JUNCTION_CONNECT_SOURCE_TARGETS) {
      for (const resource of resources) {
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          result.metadata,
          providerSlug,
          resource,
          historyCoverageVersion(resource),
        )).toBe(true);
      }
    }
  });

  it("updates a full legacy metadata envelope without evicting another owner", () => {
    const existing = {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: WINDOW_START,
      junctionHistoricalBackfillWindowEnd: WINDOW_END,
      junctionHistoricalBackfillEvidence: `e2|${WINDOW_START}|${WINDOW_END}|omron:1`,
      junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
      junctionNoteHistoryBackfillCoverage: "v1|oura",
      junctionProfileSummaryCheckedAt: WINDOW_END,
      junctionSkippedResourceTotal: 1,
      junctionSkippedSummaryTotal: 1,
      junctionSkippedTimeseriesTotal: 1,
      junctionSkippedResourceJobCount: 1,
      junctionSkippedResourceLastAt: WINDOW_END,
      junctionSkippedResourceLast: "timeseries:caffeine:400",
      junctionSkippedResourceLastDetail: "provider rejected request",
    };
    const update = requireCoverageUpdate(existing, "omron", "caffeine");
    const merged = mergeStoredDeviceSyncMetadataPatch(existing, {
      [update.metadataKey]: update.value,
    });

    expect(Object.keys(existing)).toHaveLength(16);
    expect(Object.keys(merged)).toHaveLength(16);
    expect(Object.keys(existing).every((key) => Object.hasOwn(merged, key))).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "omron",
      "blood_pressure",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "oura",
      "note",
      2,
    )).toBe(false);
    expect(merged.junctionNoteHistoryBackfillCoverage).toBe("v1|oura");
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "omron",
      "caffeine",
      1,
    )).toBe(true);
  });

  it("rejects a full metadata envelope without a reusable coverage slot", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`capacityFact${index}`, index]),
    );

    expect(canRepresentJunctionExtendedTimeseriesHistoryBackfillCoverage(
      metadata,
      "omron",
      "caffeine",
      1,
    )).toBe(false);
    expect(addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata,
      providerSlug: "omron",
      resource: "caffeine",
      version: 1,
    })).toBeNull();
  });

  it("adds the first coverage slot when one metadata entry remains", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`capacityFact${index}`, index]),
    );
    const update = requireCoverageUpdate(metadata, "omron", "caffeine");
    const merged = mergeStoredDeviceSyncMetadataPatch(metadata, {
      [update.metadataKey]: update.value,
    });

    expect(Object.keys(merged)).toHaveLength(16);
    expect(Object.keys(metadata).every((key) => Object.hasOwn(merged, key))).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "omron",
      "caffeine",
      1,
    )).toBe(true);
  });
});

function addCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
): Record<string, unknown> {
  const update = requireCoverageUpdate(metadata, providerSlug, resource);
  return { ...metadata, [update.metadataKey]: update.value };
}

function requireCoverageUpdate(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
) {
  const update = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata,
    providerSlug,
    resource,
    version: historyCoverageVersion(resource),
  });
  expect(update).not.toBeNull();
  if (!update) {
    throw new TypeError("Expected representable Junction extended-history coverage.");
  }
  return update;
}

function historyCoverageVersion(resource: string): number {
  return resource === "note" ? 2 : 1;
}
