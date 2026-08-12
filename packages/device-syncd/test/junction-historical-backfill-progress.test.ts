import { describe, expect, it } from "vitest";

import {
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  encodeJunctionHistoricalBackfillStatus,
  JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION,
  JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  mergeHostedJunctionHistoricalBackfillMetadata,
  readJunctionHistoricalBackfillEvidence,
  readJunctionHistoricalBackfillStatus,
} from "../src/junction-historical-backfill-progress.ts";

const WINDOW_START = "2025-12-20T00:00:00.000Z";
const WINDOW_END = "2026-03-20T00:00:00.000Z";

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

  it("merges sparse resource coverage independently, including weight", () => {
    const result = mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        [JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|omron",
        [JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|withings",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        [JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|oura",
        [JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|renpho",
      },
    });

    expect(result.metadata).toMatchObject({
      [JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|omron",
      [JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|oura",
      [JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY]: "v1|renpho,withings",
    });
    expect(result.preservedLocalProgress).toBe(true);
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
