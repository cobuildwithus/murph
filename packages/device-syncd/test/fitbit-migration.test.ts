import { describe, expect, it } from "vitest";

import {
  buildDeviceSyncSourceCanonicalCoverageBoundaryKey,
  buildDeviceSyncSourceCanonicalCoverageFinalizedAtKey,
  countAvailableDeviceSyncSourceResources,
  isAvailableDeviceSyncSourceResource,
  isGoogleHealthFitbitMigrationCutoverReady,
  isGoogleHealthFitbitMigrationLegacyCoverageReady,
  resolveGoogleHealthFitbitMigrationSources,
} from "../src/fitbit-migration.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";

const FIRST_SEEN_AT = "2026-08-11T10:00:00.000Z";
const LAST_DATA_AT = "2026-08-12T04:00:01.000Z";
const COMPLETED_AT = "2026-08-12T03:59:00.000Z";
const LAST_SEEN_AT = "2026-08-12T04:00:02.000Z";

function summary(input: {
  activity?: boolean;
  activityBoundary?: string;
  activityFinalizedAt?: string;
  bloodPressure?: boolean;
  bloodPressureBoundary?: string;
  backfill?: boolean;
} = {}): Record<string, unknown> {
  return {
    ...(input.activity === undefined ? {} : { activity: input.activity }),
    ...(input.activityBoundary === undefined
      ? {}
      : { canonicalCoverageBoundary_activity: input.activityBoundary }),
    ...(input.activityFinalizedAt === undefined
      ? {}
      : { canonicalCoverageFinalizedAt_activity: input.activityFinalizedAt }),
    ...(input.bloodPressure === undefined
      ? {}
      : { blood_pressure: input.bloodPressure }),
    ...(input.bloodPressureBoundary === undefined
      ? {}
      : { canonicalCoverageBoundary_blood_pressure: input.bloodPressureBoundary }),
    ...(input.backfill ? { historicalBackfillCompletedAt: COMPLETED_AT } : {}),
  };
}

function sources(input: {
  claim?: boolean;
  legacyError?: string | null;
  legacyStatus?: string;
  legacySummary?: Record<string, unknown>;
  successorFirstSeenAt?: string | null;
  successorLastDataAt?: string | null;
  successorStatus?: string;
  successorSummary?: Record<string, unknown>;
} = {}) {
  return [
    {
      id: "legacy-source",
      lastErrorCode: input.claim
        ? DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
        : input.legacyError ?? null,
      lastSeenAt: LAST_SEEN_AT,
      resourceAvailabilitySummary: input.legacySummary ?? summary({
        activity: true,
        activityBoundary: "2026-08-11",
        activityFinalizedAt: LAST_DATA_AT,
      }),
      sourceProviderSlug: "fitbit",
      status: input.legacyStatus ?? "connected",
    },
    {
      firstSeenAt: input.successorFirstSeenAt ?? FIRST_SEEN_AT,
      lastDataAt: input.successorLastDataAt ?? LAST_DATA_AT,
      lastErrorCode: null,
      lastSeenAt: LAST_SEEN_AT,
      resourceAvailabilitySummary: input.successorSummary ?? summary({
        activity: true,
        backfill: true,
      }),
      sourceProviderSlug: "google_health",
      status: input.successorStatus ?? "connected",
    },
  ];
}

describe("Google Health Fitbit migration evidence", () => {
  it("keeps metadata out of public resource counts and validates coverage keys", () => {
    const value = summary({
      activity: true,
      activityBoundary: "2026-08-11",
      activityFinalizedAt: LAST_DATA_AT,
      backfill: true,
    });

    expect(countAvailableDeviceSyncSourceResources(value)).toBe(1);
    expect(buildDeviceSyncSourceCanonicalCoverageBoundaryKey("activity")).toBe(
      "canonicalCoverageBoundary_activity",
    );
    expect(buildDeviceSyncSourceCanonicalCoverageFinalizedAtKey("activity")).toBe(
      "canonicalCoverageFinalizedAt_activity",
    );
    expect(buildDeviceSyncSourceCanonicalCoverageBoundaryKey("bad resource")).toBeNull();
  });

  it.each([
    { expected: true, name: "boolean available", value: true },
    { expected: true, name: "string available", value: " AVAILABLE " },
    { expected: true, name: "object boolean available", value: { available: true } },
    { expected: true, name: "object status available", value: { status: "available" } },
    { expected: false, name: "boolean unavailable", value: false },
    { expected: false, name: "object boolean unavailable", value: { available: false } },
    { expected: false, name: "object status unavailable", value: { status: "not_granted" } },
  ])("recognizes $name resource evidence", ({ expected, value }) => {
    expect(isAvailableDeviceSyncSourceResource("activity", value)).toBe(expected);
  });

  it.each([
    {
      expected: false,
      legacyAccessTerminal: false,
      legacySummary: summary({ activity: true }),
      name: "available legacy resource without an accepted canonical boundary",
      successorSummary: summary({ activity: true }),
    },
    {
      expected: false,
      legacyAccessTerminal: false,
      legacySummary: summary({ activity: true, activityBoundary: "2026-08-11" }),
      name: "active daily authority without a post-close provider pull",
      successorSummary: summary({ activity: true }),
    },
    {
      expected: true,
      legacyAccessTerminal: false,
      legacySummary: summary({
        activity: true,
        activityBoundary: "2026-08-11",
        activityFinalizedAt: LAST_DATA_AT,
      }),
      name: "active daily authority with post-close finalization",
      successorSummary: summary({ activity: true }),
    },
    {
      expected: true,
      legacyAccessTerminal: false,
      legacySummary: summary({
        bloodPressure: true,
        bloodPressureBoundary: "2026-08-11T12:00:00.000Z",
      }),
      name: "interval authority uses its canonical end boundary",
      successorSummary: summary({ bloodPressure: true }),
    },
    {
      expected: false,
      legacyAccessTerminal: false,
      legacySummary: summary({
        activity: true,
        activityBoundary: "2026-08-11",
        activityFinalizedAt: LAST_DATA_AT,
      }),
      name: "successor cannot omit a legacy canonical resource",
      successorSummary: summary(),
    },
    {
      expected: true,
      legacyAccessTerminal: true,
      legacySummary: summary(),
      name: "provider-terminal legacy with no produced canonical facts",
      successorSummary: summary({ activity: true }),
    },
  ])("evaluates $name", ({ expected, ...input }) => {
    expect(isGoogleHealthFitbitMigrationLegacyCoverageReady(input)).toBe(expected);
  });
});

describe("Google Health Fitbit cutover readiness", () => {
  it("preserves truthful legacy and successor identities", () => {
    const resolved = resolveGoogleHealthFitbitMigrationSources([
      sources()[1]!,
      sources()[0]!,
    ]);

    expect(resolved.legacy?.sourceProviderSlug).toBe("fitbit");
    expect(resolved.successor?.sourceProviderSlug).toBe("google_health");
  });

  it.each([
    { expected: true, input: {}, name: "complete successor proof" },
    {
      expected: false,
      input: { successorLastDataAt: FIRST_SEEN_AT },
      name: "no fresh successor fact after authorization",
    },
    {
      expected: false,
      input: { successorSummary: summary({ activity: true }) },
      name: "historical provider pull not complete",
    },
    {
      expected: false,
      input: { successorStatus: "error" },
      name: "successor is not connected",
    },
    {
      expected: false,
      input: { claim: true },
      name: "disconnect claim owned by another attempt",
    },
    {
      allowedLegacyClaim: {
        lastSeenAt: LAST_SEEN_AT,
        sourceId: "legacy-source",
      },
      expected: true,
      input: { claim: true },
      name: "exact crash-recovery claim owner",
    },
    {
      expected: true,
      input: {
        legacyError: DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
        legacyStatus: "disconnected",
      },
      name: "provider-terminal legacy source",
    },
  ])("evaluates $name", ({ allowedLegacyClaim, expected, input }) => {
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      ...(allowedLegacyClaim ? { allowedLegacyClaim } : {}),
      sources: sources(input),
    })).toBe(expected);
  });
});
