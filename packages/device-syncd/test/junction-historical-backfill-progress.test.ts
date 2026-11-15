import { describe, expect, it } from "vitest";

import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage,
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  canRepresentJunctionExtendedTimeseriesHistoryBackfillCoverage,
  encodeJunctionHistoricalBackfillStatus,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSIONS,
  JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION,
  mergeHostedJunctionHistoricalBackfillMetadata,
  readJunctionHistoricalBackfillEvidence,
  readJunctionHistoricalBackfillStatus,
  removeJunctionExtendedTimeseriesHistoryBackfillCoverage,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
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
      version: historyCoverageVersion("weight"),
    });

    expect(reset).not.toBeNull();
    if (!reset) {
      throw new TypeError("Expected current matrix coverage to be resettable.");
    }
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "apple_health_kit",
      "weight",
      historyCoverageVersion("weight"),
    )).toBe(false);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "withings",
      "weight",
      historyCoverageVersion("weight"),
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      reset,
      "apple_health_kit",
      "caffeine",
      historyCoverageVersion("caffeine"),
    )).toBe(true);
  });

  it("leaves malformed and future matrix encodings unchanged", () => {
    const current = addCoverage({}, "apple_health_kit", "weight");
    const matrixKey = Object.keys(current)[0];
    const matrixValue = matrixKey ? current[matrixKey] : null;
    expect(typeof matrixValue).toBe("string");
    if (!matrixKey || typeof matrixValue !== "string") {
      throw new TypeError("Expected current matrix coverage.");
    }
    const future = {
      ...current,
      [matrixKey]: matrixValue.replace(/^m3\|/u, "m4|"),
    };
    const malformed = { [matrixKey]: "not-a-coverage-matrix" };

    expect(removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: future,
      providerSlug: "apple_health_kit",
      resource: "weight",
      version: historyCoverageVersion("weight"),
    })).toBeNull();
    expect(removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: malformed,
      providerSlug: "apple_health_kit",
      resource: "weight",
      version: historyCoverageVersion("weight"),
    })).toBeNull();
    expect(future[matrixKey]).toBe(matrixValue.replace(/^m3\|/u, "m4|"));
    expect(malformed[matrixKey]).toBe("not-a-coverage-matrix");
  });
});

describe("Junction historical backfill progress versions", () => {
  it("writes coverage v4 while continuing to read older progress", () => {
    expect(JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION).toBe(4);
    expect(encodeJunctionHistoricalBackfillStatus("complete")).toBe("coverage_v4_complete");
    expect(readJunctionHistoricalBackfillStatus("coverage_v2_retrying")).toEqual({
      coverageVersion: 2,
      status: "retrying",
    });
    for (const status of ["coverage_v2_complete", "coverage_v3_complete", "coverage_v4_complete"]) {
      expect(canCurrentRuntimeMutateJunctionHistoricalBackfillProgress({
        junctionHistoricalBackfillStatus: status,
      })).toBe(true);
    }
  });

  it("leaves future coverage versions opaque and immutable", () => {
    expect(canCurrentRuntimeMutateJunctionHistoricalBackfillProgress({
      junctionHistoricalBackfillStatus: "coverage_v5_deferred",
    })).toBe(false);

    const opaqueEvidence = "e3|opaque-future-evidence";
    const result = mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v5_deferred",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence:
          `e2|${WINDOW_START}|${WINDOW_END}|garmin:1`,
        junctionHistoricalBackfillStatus: "coverage_v4_complete",
        junctionHistoricalBackfillWindowStart: WINDOW_START,
        junctionHistoricalBackfillWindowEnd: WINDOW_END,
      },
    });

    expect(result).toEqual({
      metadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v5_deferred",
      },
      preservedLocalProgress: false,
    });

    expect(mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v4_retrying",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v5_deferred",
      },
    })).toEqual({
      metadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v5_deferred",
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
    expect(encoded.startsWith("m3|")).toBe(true);
    expect(encoded).toHaveLength(211);
    expect(encoded.length).toBeLessThanOrEqual(DEVICE_SYNC_METADATA_MAX_STRING_LENGTH);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      coverage,
      "omron",
      "afib_burden",
      historyCoverageVersion("afib_burden"),
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      coverage,
      "oura",
      "caffeine",
      historyCoverageVersion("caffeine"),
    )).toBe(false);
    expect(canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionBloodPressureHistoryBackfillCoverage: `m4|${"0".repeat(192)}` },
      "caffeine",
      historyCoverageVersion("caffeine"),
    )).toBe(false);
  });

  it("reopens prior legacy generations while accepting current resource generations", () => {
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionNoteHistoryBackfillCoverage: "v2|oura" },
      "oura",
      "note",
      historyCoverageVersion("note"),
    )).toBe(false);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionNoteHistoryBackfillCoverage: "v3|oura" },
      "oura",
      "note",
      historyCoverageVersion("note"),
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionBloodPressureHistoryBackfillCoverage: "v1|omron" },
      "omron",
      "blood_pressure",
      historyCoverageVersion("blood_pressure"),
    )).toBe(false);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      { junctionBloodPressureHistoryBackfillCoverage: "v2|omron" },
      "omron",
      "blood_pressure",
      historyCoverageVersion("blood_pressure"),
    )).toBe(true);
  });

  it("reopens every current resource when coverage uses the pre-180-day packed generation", () => {
    expect(JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSIONS).toEqual([
      ["blood_pressure", 2],
      ["note", 3],
      ["afib_burden", 2],
      ["basal_body_temperature", 2],
      ["body_temperature", 2],
      ["body_temperature_delta", 2],
      ["caffeine", 2],
      ["heart_rate_recovery_one_minute", 2],
      ["mindfulness_minutes", 2],
      ["sleep_breathing_disturbance", 2],
      ["vo2_max", 2],
      ["water", 2],
      ["weight", 3],
    ]);

    let current: Record<string, unknown> = {};
    for (const [resource] of JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSIONS) {
      current = addCoverage(current, "garmin", resource);
    }
    const matrixKey = Object.keys(current)[0];
    const currentValue = matrixKey ? current[matrixKey] : null;
    expect(typeof currentValue).toBe("string");
    if (!matrixKey || typeof currentValue !== "string") {
      throw new TypeError("Expected current packed Junction history coverage.");
    }
    const prior = {
      [matrixKey]: currentValue.replace(/^m3\|/u, "m1|"),
    };

    for (const [resource, version] of JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSIONS) {
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        prior,
        "garmin",
        resource,
        version,
      )).toBe(false);
      expect(canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
        prior,
        resource,
        version,
      )).toBe(true);
    }

    const currentCaffeine = addCoverage(prior, "garmin", "caffeine");
    expect(String(currentCaffeine[matrixKey]).startsWith("m3|")).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      currentCaffeine,
      "garmin",
      "caffeine",
      historyCoverageVersion("caffeine"),
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      currentCaffeine,
      "garmin",
      "water",
      historyCoverageVersion("water"),
    )).toBe(false);
  });

  it("reads the prior packed generation without its weight column", () => {
    let current: Record<string, unknown> = {};
    for (const [providerSlug, resource] of [
      ["withings", "weight"], ["withings", "blood_pressure"], ["garmin", "weight"], ["garmin", "vo2_max"],
    ] as const) {
      current = addCoverage(current, providerSlug, resource);
    }
    const prior = toPriorMatrixGeneration(current);

    // Weight was certified while fetched weight rows were being dropped.
    for (const [providerSlug, resource, covered] of [
      ["withings", "weight", false], ["garmin", "weight", false],
      ["withings", "blood_pressure", true], ["garmin", "vo2_max", true],
    ] as const) {
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        prior, providerSlug, resource, historyCoverageVersion(resource),
      ), `${providerSlug} ${resource}`).toBe(covered);
      expect(canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
        prior, resource, historyCoverageVersion(resource),
      )).toBe(true);
    }

    // Re-reading one source's weight writes the current generation and keeps
    // every bit that still stands.
    const reread = addCoverage(prior, "withings", "weight");
    expect(Object.values(reread).every((value) => String(value).startsWith("m3|"))).toBe(true);
    for (const [providerSlug, resource, covered] of [
      ["withings", "weight", true], ["garmin", "weight", false],
      ["withings", "blood_pressure", true], ["garmin", "vo2_max", true],
    ] as const) {
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        reread, providerSlug, resource, historyCoverageVersion(resource),
      ), `${providerSlug} ${resource}`).toBe(covered);
    }
  });

  it("keeps a re-read weight bit when the other side still holds the prior generation", () => {
    const hosted = toPriorMatrixGeneration(
      addCoverage(addCoverage({}, "withings", "weight"), "withings", "blood_pressure"),
    );
    const reread = addCoverage(hosted, "withings", "weight");

    for (const [hostedMetadata, localMetadata, weightCovered] of [
      // The runner re-read weight; Web still holds what the last generation wrote.
      [hosted, reread, true],
      // Web already holds the re-read; a stale local copy cannot retire it.
      [reread, hosted, true],
      // Neither side has re-read it.
      [hosted, hosted, false],
    ] as const) {
      const merged = mergeHostedJunctionHistoricalBackfillMetadata({
        hostedMetadata, localConnectionStateUnpublished: true, localMetadata,
      }).metadata;
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        merged, "withings", "weight", historyCoverageVersion("weight"),
      )).toBe(weightCovered);
      expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        merged, "withings", "blood_pressure", historyCoverageVersion("blood_pressure"),
      )).toBe(true);
    }
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
        historyCoverageVersion(resource),
      )).toBe(true);
    }
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
    expect(metadata.junctionBloodPressureHistoryBackfillCoverage).toHaveLength(211);
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
    expect(result.metadata.junctionBloodPressureHistoryBackfillCoverage).toHaveLength(211);
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
      junctionHistoricalBackfillStatus: "coverage_v4_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: WINDOW_START,
      junctionHistoricalBackfillWindowEnd: WINDOW_END,
      junctionHistoricalBackfillEvidence: `e2|${WINDOW_START}|${WINDOW_END}|omron:1`,
      junctionBloodPressureHistoryBackfillCoverage: "v2|omron",
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
      historyCoverageVersion("blood_pressure"),
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "oura",
      "note",
      historyCoverageVersion("note"),
    )).toBe(false);
    expect(merged.junctionNoteHistoryBackfillCoverage).toBe("v1|oura");
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      merged,
      "omron",
      "caffeine",
      historyCoverageVersion("caffeine"),
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
      historyCoverageVersion("caffeine"),
    )).toBe(false);
    expect(addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata,
      providerSlug: "omron",
      resource: "caffeine",
      version: historyCoverageVersion("caffeine"),
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
      historyCoverageVersion("caffeine"),
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

/** The same bits as the last envelope generation stored them. */
function toPriorMatrixGeneration(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    typeof value === "string" ? value.replace(/^m3\|/u, "m2|") : value,
  ]));
}

function historyCoverageVersion(resource: string): number {
  const version = resolveJunctionExtendedTimeseriesHistoryBackfillVersion(resource);
  if (version === null) {
    throw new TypeError(`Expected Junction extended-history version for ${resource}.`);
  }
  return version;
}

it("merges unpublished history coverage without evicting hosted completion markers", () => {
  const progress = {
    junctionProfileSummaryCheckedAt: "2026-04-03T14:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 2,
    junctionReconcileProofV1: "synthetic-proof",
    junctionTemporalSweepV1: "synthetic-sweep",
  };
  const hostedMetadata = {
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`diagnostic${index}`, index])),
    ...progress,
  };
  const localMetadata = addCoverage({}, "omron", "caffeine");
  const result = mergeHostedJunctionHistoricalBackfillMetadata({
    hostedMetadata, localMetadata, localConnectionStateUnpublished: true,
  });
  expect(result.metadata).toMatchObject(progress);
  expect(Object.keys(result.metadata)).toHaveLength(16);
  expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
    result.metadata, "omron", "caffeine", historyCoverageVersion("caffeine"),
  )).toBe(true);
});
