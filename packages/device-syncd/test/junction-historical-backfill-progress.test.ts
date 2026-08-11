import { describe, expect, it } from "vitest";

import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage,
  canCurrentRuntimeMutateJunctionHistoricalBackfillProgress,
  encodeJunctionHistoricalBackfillStatus,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION,
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

describe("Junction sparse daily history coverage", () => {
  it("packs independent resource coverage into one source-scoped metadata value", () => {
    const caffeine = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      existingValue: null,
      providerSlug: "omron",
      resource: "caffeine",
      version: 1,
    });
    const afibAndCaffeine = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      existingValue: caffeine,
      providerSlug: "omron",
      resource: "afib_burden",
      version: 1,
    });
    const coverage = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      existingValue: afibAndCaffeine,
      providerSlug: "oura",
      resource: "water",
      version: 1,
    });

    expect(coverage).toBe("v1|omron:17,oura:512");
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
      "v2|omron:17",
      "caffeine",
      1,
    )).toBe(false);
  });

  it("unions unpublished local resource bits without losing hosted coverage", () => {
    expect(mergeHostedJunctionHistoricalBackfillMetadata({
      hostedMetadata: {
        junctionSparseDailyTimeseriesHistoryBackfillCoverage: "v1|omron:1",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionSparseDailyTimeseriesHistoryBackfillCoverage:
          "v1|omron:16,oura:512",
      },
    })).toEqual({
      metadata: {
        junctionSparseDailyTimeseriesHistoryBackfillCoverage:
          "v1|omron:17,oura:512",
      },
      preservedLocalProgress: true,
    });
  });
});
