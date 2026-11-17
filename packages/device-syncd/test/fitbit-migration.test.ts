import { describe, expect, it } from "vitest";

import {
  isDeviceSyncSourceResourceAvailabilityMetadataKey,
  isGoogleHealthFitbitMigrationCutoverReady,
  resolveGoogleHealthFitbitMigrationSources,
} from "../src/fitbit-migration.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";

const LAST_SEEN_AT = "2026-08-12T04:00:02.000Z";

function sources(input: {
  claim?: boolean;
  legacyError?: string | null;
  legacyStatus?: string;
  successorStatus?: string;
} = {}) {
  return [
    {
      id: "legacy-source",
      lastErrorCode: input.claim
        ? DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
        : input.legacyError ?? null,
      lastSeenAt: LAST_SEEN_AT,
      sourceProviderSlug: "fitbit",
      status: input.legacyStatus ?? "connected",
    },
    {
      sourceProviderSlug: "google_health",
      status: input.successorStatus ?? "connected",
    },
  ];
}

describe("Google Health Fitbit source replacement", () => {
  it("preserves distinct source identities", () => {
    const resolved = resolveGoogleHealthFitbitMigrationSources([
      sources()[1]!, sources()[0]!,
    ]);
    expect(resolved.legacy?.sourceProviderSlug).toBe("fitbit");
    expect(resolved.successor?.sourceProviderSlug).toBe("google_health");
  });

  it("excludes old migration metadata from resource counts", () => {
    for (const key of [
      "historicalBackfillCompletedAt",
      "canonicalCoverageBoundary_activity",
      "canonicalCoverageFinalizedAt_activity",
      "sourceInstanceKeyFallback",
    ]) {
      expect(isDeviceSyncSourceResourceAvailabilityMetadataKey(key)).toBe(true);
    }
    expect(isDeviceSyncSourceResourceAvailabilityMetadataKey("activity")).toBe(false);
  });

  it("requires only a connected successor and active legacy authority", () => {
    expect(isGoogleHealthFitbitMigrationCutoverReady({ sources: sources() })).toBe(true);
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      sources: sources({ successorStatus: "error" }),
    })).toBe(false);
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      sources: sources({ claim: true }),
    })).toBe(false);
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      allowedLegacyClaim: { lastSeenAt: LAST_SEEN_AT, sourceId: "legacy-source" },
      sources: sources({ claim: true }),
    })).toBe(true);
  });

  it("recognizes terminal Fitbit only while the successor remains connected", () => {
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      sources: sources({
        legacyError: DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
        legacyStatus: "disconnected",
      }),
    })).toBe(true);
    expect(isGoogleHealthFitbitMigrationCutoverReady({
      sources: sources({
        legacyError: DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
        legacyStatus: "disconnected",
        successorStatus: "disconnected",
      }),
    })).toBe(false);
  });
});
