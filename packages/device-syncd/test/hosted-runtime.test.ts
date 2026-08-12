import { describe, expect, it } from "vitest";

import * as hostedRuntime from "../src/hosted-runtime.ts";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  addJunctionHistoricalBackfillEvidence,
  canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  readJunctionHistoricalBackfillEvidence,
} from "../src/junction-historical-backfill-progress.ts";
import { DEVICE_SYNC_METADATA_MAX_STRING_LENGTH } from "../src/metadata.ts";
import {
  buildHostedExecutionDeviceSyncConnectLinkPath,
  isDeviceSyncCredentialIndependentImportJob as classifyCredentialIndependentImportJob,
  isHostedRuntimeIdShapedDiagnosticToken,
  mergeGuardedJunctionHistoricalBackfillMetadata,
  mergeHostedDeviceSyncConnectionMetadata,
  normalizeHostedDeviceSyncJobHints,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncDirtyAckRequest,
  parseHostedExecutionDeviceSyncWakeHint,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncDirtyPendingRequest,
  parseHostedExecutionDeviceSyncDirtyStateResponse,
  parseHostedExecutionDeviceSyncReconcileRequest,
  parseHostedExecutionDeviceSyncReconcileResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  resolveHostedDeviceSyncWakeContext,
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedRuntimeErrorText,
  serializeHostedExecutionDeviceSyncDirtyPayloadIdentity,
} from "../src/hosted-runtime.ts";
import { isJunctionCredentialIndependentInlineImportJob } from "../src/junction-inline-authority.ts";

function isDeviceSyncCredentialIndependentImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  provider?: string | null;
}): boolean {
  return classifyCredentialIndependentImportJob(
    input,
    input.provider === "junction"
      ? isJunctionCredentialIndependentInlineImportJob
      : undefined,
  );
}

describe("wearable import delay buckets", () => {
  it.each([
    ["2026-04-08T00:04:59.999Z", "under_5_minutes"],
    ["2026-04-08T00:05:00.000Z", "5_to_30_minutes"],
    ["2026-04-08T00:30:00.000Z", "30_minutes_to_2_hours"],
    ["2026-04-08T02:00:00.000Z", "2_to_24_hours"],
    ["2026-04-09T00:00:00.000Z", "over_24_hours"],
  ])("buckets event-to-provider delay ending at %s", (providerSentAt, expected) => {
    expect(hostedRuntime.bucketHostedDeviceSyncEventToProviderSendDelay({
      eventOccurredAt: "2026-04-08T00:00:00.000Z",
      providerSentAt,
    })).toBe(expected);
  });

  it("omits missing or negatively ordered event-to-provider delay", () => {
    expect(hostedRuntime.bucketHostedDeviceSyncEventToProviderSendDelay({
      eventOccurredAt: null,
      providerSentAt: "2026-04-08T00:00:00.000Z",
    })).toBeNull();
    expect(hostedRuntime.bucketHostedDeviceSyncEventToProviderSendDelay({
      eventOccurredAt: "2026-04-08T00:01:00.000Z",
      providerSentAt: "2026-04-08T00:00:00.000Z",
    })).toBeNull();
  });

  it("measures signed provider send to Murph receipt without pairing coalesced timestamps", () => {
    expect(hostedRuntime.measureHostedDeviceSyncProviderSendToWebhookMs({
      providerSentAt: "2026-04-08T00:03:00.000Z",
      webhookReceivedAt: "2026-04-08T00:04:30.000Z",
    })).toBe(90_000);
    expect(hostedRuntime.measureHostedDeviceSyncProviderSendToWebhookMs({
      providerSentAt: "2026-04-08T00:05:00.000Z",
      webhookReceivedAt: "2026-04-08T00:04:30.000Z",
    })).toBeNull();
    expect(hostedRuntime.measureHostedDeviceSyncProviderSendToWebhookMs({
      providerSentAt: null,
      webhookReceivedAt: "2026-04-08T00:04:30.000Z",
    })).toBeNull();
  });

  it("keeps the slowest bucket when webhook hints coalesce", () => {
    expect(hostedRuntime.mergeHostedDeviceSyncEventToProviderSendBuckets(
      "5_to_30_minutes",
      "2_to_24_hours",
    )).toBe("2_to_24_hours");
  });
});

describe("hosted device-sync dirty timing source parsing", () => {
  it("preserves exact, mixed, and legacy timing-source states independently of execution source", () => {
    const buildResource = (timingSourceProviderSlug: string | null | undefined) => ({
      count: 1,
      firstWebhookReceivedAt: "2026-04-08T00:04:00.000Z",
      jobKind: "reconcile",
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: null,
      ...(timingSourceProviderSlug === undefined ? {} : { timingSourceProviderSlug }),
      windowEnd: null,
      windowStart: null,
    });

    const parsed = parseHostedExecutionDeviceSyncDirtyStateResponse({
      connectionId: "dsc_timing_sources",
      dirtyRevision: "3",
      dirtyResources: [
        buildResource("garmin"),
        buildResource(null),
        buildResource(undefined),
      ],
      eventCount: "3",
      latestDirtyAt: "2026-04-08T00:04:00.000Z",
      processedRevision: "0",
      provider: "junction",
      resourceCategoryCounts: { reconcile: 3 },
      sourceProviderCounts: { unknown: 3 },
      userId: "member_timing_sources",
      windowEnd: null,
      windowStart: null,
    });

    expect(parsed?.dirtyResources[0]).toMatchObject({
      sourceProviderSlug: null,
      timingSourceProviderSlug: "garmin",
    });
    expect(parsed?.dirtyResources[1]).toMatchObject({
      sourceProviderSlug: null,
      timingSourceProviderSlug: null,
    });
    expect(parsed?.dirtyResources[2]).not.toHaveProperty("timingSourceProviderSlug");
  });
});

describe("isDeviceSyncCredentialIndependentImportJob", () => {
  it("preserves only executor-owned inline imports", () => {
    expect(classifyCredentialIndependentImportJob({
      kind: "resource",
      payload: {
        resource: "sleep",
        resourceCategory: "summary",
        webhookDataJson: JSON.stringify({ sourceProviderSlug: "garmin" }),
      },
      provider: "junction",
    })).toBe(false);

    for (const provider of ["oura", "strava", "whoop"]) {
      expect(isDeviceSyncCredentialIndependentImportJob({
        kind: "delete",
        payload: { resourceId: "deleted-resource" },
        provider,
      })).toBe(true);
    }

    expect(isDeviceSyncCredentialIndependentImportJob({
      kind: "resource",
      payload: {
        resource: "sleep",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify({ sourceProviderSlug: "garmin" }),
      },
      provider: "junction",
    })).toBe(true);
    expect(isDeviceSyncCredentialIndependentImportJob({
      kind: "resource",
      payload: { resource: "companion_health_metadata" },
      provider: "junction",
    })).toBe(true);
    expect(isDeviceSyncCredentialIndependentImportJob({
      kind: "resource",
      payload: { resource: "companion_hrv_rmssd" },
      provider: "junction",
    })).toBe(true);

    for (const input of [
      { kind: "delete", payload: {}, provider: "junction" },
      { kind: "deauthorize", payload: {}, provider: "strava" },
      { kind: "reconcile", payload: {}, provider: "oura" },
      {
        kind: "resource",
        payload: {
          resource: "sleep",
          resourceCategory: "summary",
          sourceProviderSlug: "garmin",
        },
        provider: "junction",
      },
      {
        kind: "resource",
        payload: {
          resource: "activity",
          resourceCategory: "summary",
          sourceProviderSlug: "garmin",
          webhookDataJson: JSON.stringify({
            records: [{ sourceProviderSlug: "fitbit" }],
            sourceProviderSlug: "garmin",
          }),
        },
        provider: "junction",
      },
      {
        kind: "resource",
        payload: {
          resource: "sleep_cycle",
          resourceCategory: "summary",
          sourceProviderSlug: "garmin",
          webhookDataJson: JSON.stringify({
            id: "sleep-cycle-without-stage-coverage",
            sourceProviderSlug: "garmin",
          }),
        },
        provider: "junction",
      },
      {
        kind: "resource",
        payload: {
          resource: "steps",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          webhookDataJson: "{}",
        },
        provider: "junction",
      },
    ]) {
      expect(isDeviceSyncCredentialIndependentImportJob(input)).toBe(false);
    }
  });
});

describe("hosted device-sync reconcile contract", () => {
  it("accepts only the bounded request and queued response shapes", () => {
    expect(parseHostedExecutionDeviceSyncReconcileRequest({
      connectionId: "dsc_123",
      memberEditConflictResolution: "keep_member",
    })).toEqual({
      connectionId: "dsc_123",
      memberEditConflictResolution: "keep_member",
    });
    expect(parseHostedExecutionDeviceSyncReconcileResponse({
      connectionId: "dsc_123",
      occurredAt: "2026-07-15T12:00:00.000Z",
      status: "queued",
    })).toEqual({
      connectionId: "dsc_123",
      occurredAt: "2026-07-15T12:00:00.000Z",
      status: "queued",
    });
    expect(() => parseHostedExecutionDeviceSyncReconcileRequest({
      action: "disconnect",
      connectionId: "dsc_123",
    })).toThrow(/action is not supported/u);
    expect(() => parseHostedExecutionDeviceSyncReconcileRequest({
      connectionId: "dsc_123",
      memberEditConflictResolution: "overwrite_everything",
    })).toThrow(/must be keep_member or use_provider/u);
    expect(() => parseHostedExecutionDeviceSyncReconcileResponse({
      connectionId: "dsc_123",
      occurredAt: "2026-07-15T12:00:00.000Z",
      status: "disconnected",
    })).toThrow(/status must be queued/u);
  });
});

describe("serializeHostedExecutionDeviceSyncDirtyPayloadIdentity", () => {
  const companionPayload = {
    eventType: "companion.health_metadata.v1",
    occurredAt: "2026-07-09T12:00:00.000Z",
    resource: "companion_health_metadata",
    resourceCategory: "summary",
    sourceProviderSlug: "apple-health-kit",
    webhookDataJson: JSON.stringify({ records: [{ recordId: "a".repeat(64) }] }),
  };

  it("ignores receipt time only for an exact companion health payload", () => {
    const retry = {
      ...companionPayload,
      occurredAt: "2026-07-09T12:05:00.000Z",
    };

    expect(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(companionPayload))
      .toBe(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(retry));
    expect(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity({
      ...companionPayload,
      eventType: "daily.data.steps.created",
    })).not.toBe(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity({
      ...retry,
      eventType: "daily.data.steps.created",
    }));
  });

  it("keeps companion batch content in the identity", () => {
    expect(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(companionPayload))
      .not.toBe(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity({
        ...companionPayload,
        webhookDataJson: JSON.stringify({ records: [{ recordId: "b".repeat(64) }] }),
      }));
  });
});

describe("mergeHostedDeviceSyncConnectionMetadata", () => {
  it("keeps newer blood-pressure source-coverage semantics immutable to older runtimes", () => {
    const metadata = { junctionBloodPressureHistoryBackfillCoverage: "v2|withings" };
    const coverage = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata,
      providerSlug: "omron",
      resource: "blood_pressure",
      version: 1,
    });

    expect(coverage).toBeNull();
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      metadata,
      "omron",
      "blood_pressure",
      1,
    )).toBe(false);
    expect(canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
      metadata,
      "blood_pressure",
      1,
    )).toBe(false);
    expect(addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: {},
      providerSlug: "__proto__",
      resource: "blood_pressure",
      version: 1,
    })).toBeNull();
  });

  it("preserves current local coverage without certifying legacy note semantics", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: { hostedOnly: true },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
        junctionNoteHistoryBackfillCoverage: "v1|oura",
      },
    });

    expect(result.metadata.hostedOnly).toBe(true);
    expect(result.metadata.junctionNoteHistoryBackfillCoverage).toBeUndefined();
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result.metadata,
      "omron",
      "blood_pressure",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result.metadata,
      "oura",
      "note",
      2,
    )).toBe(false);
    expect(result.preservedLocalProgress).toBe(true);
  });

  it("accepts hosted migration metadata after local state is published", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: { hostedOnly: true },
      localConnectionStateUnpublished: false,
      localMetadata: {
        junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
      },
    });

    expect(result).toEqual({
      metadata: { hostedOnly: true },
      preservedLocalProgress: false,
    });
  });

  it("unions hosted and unpublished local source coverage", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionBloodPressureHistoryBackfillCoverage: "v1|withings",
      },
    });

    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result.metadata,
      "omron",
      "blood_pressure",
      1,
    )).toBe(true);
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result.metadata,
      "withings",
      "blood_pressure",
      1,
    )).toBe(true);
    expect(result.preservedLocalProgress).toBe(true);
  });

  it("retains unpublished matrix coverage when hosted metadata fills the envelope", () => {
    const sharedMetadata = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`sharedFact${index}`, `value-${index}`]),
    );
    const coverage = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: sharedMetadata,
      providerSlug: "omron",
      resource: "caffeine",
      version: 1,
    });
    expect(coverage).not.toBeNull();
    if (!coverage) {
      throw new TypeError("Expected representable Junction coverage.");
    }

    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        ...sharedMetadata,
        concurrentHostedFact: "published",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        ...sharedMetadata,
        [coverage.metadataKey]: coverage.value,
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(Object.keys(result.metadata)).toHaveLength(16);
    expect(result.metadata.concurrentHostedFact).toBeUndefined();
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result.metadata,
      "omron",
      "caffeine",
      1,
    )).toBe(true);
    for (const [key, value] of Object.entries(sharedMetadata)) {
      expect(result.metadata[key]).toBe(value);
    }
  });

  it("compacts split coverage slots before merging a full hosted envelope", () => {
    const sharedMetadata = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`sharedFact${index}`, `value-${index}`]),
    );
    const bloodPressureMatrix = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: {},
      providerSlug: "omron",
      resource: "blood_pressure",
      version: 1,
    });
    const noteMatrix = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: {},
      providerSlug: "oura",
      resource: "note",
      version: 2,
    });
    expect(bloodPressureMatrix).not.toBeNull();
    expect(noteMatrix).not.toBeNull();
    if (!bloodPressureMatrix || !noteMatrix) {
      throw new TypeError("Expected representable Junction coverage.");
    }

    const cases = [
      {
        hostedCoverage: { junctionNoteHistoryBackfillCoverage: "v2|oura" },
        localCoverage: { junctionBloodPressureHistoryBackfillCoverage: "v1|omron" },
      },
      {
        hostedCoverage: { junctionBloodPressureHistoryBackfillCoverage: "v1|omron" },
        localCoverage: { junctionNoteHistoryBackfillCoverage: "v2|oura" },
      },
      {
        hostedCoverage: { junctionNoteHistoryBackfillCoverage: noteMatrix.value },
        localCoverage: { junctionBloodPressureHistoryBackfillCoverage: "v1|omron" },
      },
      {
        hostedCoverage: { junctionNoteHistoryBackfillCoverage: "v2|oura" },
        localCoverage: {
          junctionBloodPressureHistoryBackfillCoverage: bloodPressureMatrix.value,
        },
      },
      {
        hostedCoverage: { junctionNoteHistoryBackfillCoverage: noteMatrix.value },
        localCoverage: {
          junctionBloodPressureHistoryBackfillCoverage: bloodPressureMatrix.value,
        },
      },
      {
        hostedCoverage: {
          junctionBloodPressureHistoryBackfillCoverage: bloodPressureMatrix.value,
        },
        localCoverage: { junctionNoteHistoryBackfillCoverage: noteMatrix.value },
      },
    ];

    for (const { hostedCoverage, localCoverage } of cases) {
      for (const hostedCoverageFirst of [true, false]) {
        for (const localCoverageFirst of [true, false]) {
          const result = mergeHostedDeviceSyncConnectionMetadata({
            hostedMetadata: hostedCoverageFirst
              ? { ...hostedCoverage, ...sharedMetadata }
              : { ...sharedMetadata, ...hostedCoverage },
            localConnectionStateUnpublished: true,
            localMetadata: localCoverageFirst
              ? { ...localCoverage, ...sharedMetadata }
              : { ...sharedMetadata, ...localCoverage },
          });

          expect(result.preservedLocalProgress).toBe(true);
          expect(Object.keys(result.metadata)).toHaveLength(16);
          expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
            result.metadata,
            "omron",
            "blood_pressure",
            1,
          )).toBe(true);
          expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
            result.metadata,
            "oura",
            "note",
            2,
          )).toBe(true);
          for (const [key, value] of Object.entries(sharedMetadata)) {
            expect(result.metadata[key]).toBe(value);
          }
        }
      }
    }
  });

  it("keeps published source coverage when a bounded union cannot fit", () => {
    const hostedCoverage = `v1|${Array.from(
      { length: 12 },
      (_, index) => `h${index.toString().padStart(9, "0")}`,
    ).join(",")}`;
    const localCoverage = `v1|${Array.from(
      { length: 12 },
      (_, index) => `l${index.toString().padStart(9, "0")}`,
    ).join(",")}`;
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: { junctionBloodPressureHistoryBackfillCoverage: hostedCoverage },
      localConnectionStateUnpublished: true,
      localMetadata: { junctionBloodPressureHistoryBackfillCoverage: localCoverage },
    });

    expect(result.metadata.junctionBloodPressureHistoryBackfillCoverage).toBe(hostedCoverage);
    expect(result.preservedLocalProgress).toBe(false);
  });

  it("preserves current local Junction retry progress over hosted legacy completion", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        hostedOnly: true,
        junctionHistoricalBackfillStatus: "complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata).toEqual({
      hostedOnly: true,
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("accepts current hosted Junction completion over local legacy retry progress", () => {
    const hostedMetadata = {
      hostedOnly: true,
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    };
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata,
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillStatus: "retrying",
        junctionHistoricalBackfillEmptyAttempts: 3,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(false);
    expect(result.metadata).toEqual(hostedMetadata);
  });

  it("preserves newer unpublished local Junction retry metadata", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        hostedOnly: true,
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        localOnly: true,
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 2,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:15:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata).toEqual({
      hostedOnly: true,
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:15:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("keeps hosted Junction retry metadata when local retry progress is stale", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 2,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:15:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(false);
    expect(result.metadata).toEqual({
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:15:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("places preserved local Junction terminal progress before full hosted metadata", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [`hostedKey${index}`, `hosted-value-${index}`]),
      ),
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(Object.keys(result.metadata).slice(0, 5)).toEqual([
      "junctionHistoricalBackfillStatus",
      "junctionHistoricalBackfillEmptyAttempts",
      "junctionHistoricalBackfillLastEmptyAt",
      "junctionHistoricalBackfillWindowStart",
      "junctionHistoricalBackfillWindowEnd",
    ]);
  });

  it("preserves unpublished local complete progress ahead of hosted exhausted progress", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        hostedOnly: true,
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        localOnly: true,
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata).toEqual({
      hostedOnly: true,
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("keeps hosted complete progress ahead of unpublished local retry progress", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 3,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:30:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(false);
    expect(result.metadata).toEqual({
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("keeps hosted progress when local progress has already been published", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: false,
      localMetadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 2,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:15:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(false);
    expect(result.metadata).toEqual({
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    });
  });

  it("unions same-window Junction push evidence monotonically", () => {
    const hostedMetadata = {
      junctionHistoricalBackfillEvidence:
        "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1",
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    };
    const localMetadata = {
      ...hostedMetadata,
      junctionHistoricalBackfillEvidence:
        "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:2",
    };

    for (const localConnectionStateUnpublished of [true, false]) {
      const result = mergeHostedDeviceSyncConnectionMetadata({
        hostedMetadata,
        localConnectionStateUnpublished,
        localMetadata,
      });
      expect(result.metadata.junctionHistoricalBackfillEvidence).toBe(
        "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:3",
      );
    }
  });

  it("keeps evidence matching selected progress when hosted and local evidence windows differ", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillEvidence:
          "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1",
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence:
          "e2|2025-12-19T00:00:00.000Z|2026-03-19T00:00:00.000Z|garmin:2",
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata.junctionHistoricalBackfillStatus).toBe("coverage_v3_complete");
    expect(result.metadata.junctionHistoricalBackfillEvidence).toBe(
      "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1",
    );
  });

  it("marks selected local evidence unpublished when equal progress has stale hosted evidence", () => {
    const sharedProgress = {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-03-20T12:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
    };
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        ...sharedProgress,
        junctionHistoricalBackfillEvidence:
          "e2|2025-12-19T00:00:00.000Z|2026-03-19T00:00:00.000Z|garmin:1",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        ...sharedProgress,
        junctionHistoricalBackfillEvidence:
          "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:2",
      },
    });

    expect(result.preservedLocalProgress).toBe(true);
    expect(result.metadata.junctionHistoricalBackfillEvidence).toBe(
      "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:2",
    );
  });

  it("preserves opaque hosted evidence owned by selected future progress", () => {
    const opaqueEvidence = "future-hosted-evidence-format";
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        junctionHistoricalBackfillEvidence: opaqueEvidence,
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence:
          "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1",
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillWindowStart: "2025-12-20T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-03-20T00:00:00.000Z",
      },
    });

    expect(result.preservedLocalProgress).toBe(false);
    expect(result.metadata.junctionHistoricalBackfillStatus).toBe("coverage_v4_deferred");
    expect(result.metadata.junctionHistoricalBackfillEvidence).toBe(opaqueEvidence);
  });

  it("preserves unpublished opaque local progress owned by a future runtime", () => {
    const result = mergeHostedDeviceSyncConnectionMetadata({
      hostedMetadata: {
        hostedOnly: "current",
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      },
      localConnectionStateUnpublished: true,
      localMetadata: {
        junctionHistoricalBackfillEvidence: "e3|opaque-future-evidence",
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
        localOnly: "future",
      },
    });

    expect(result).toEqual({
      metadata: {
        hostedOnly: "current",
        junctionHistoricalBackfillEvidence: "e3|opaque-future-evidence",
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
        localOnly: "future",
      },
      preservedLocalProgress: true,
    });
  });

  it.each([
    ["wrong encoding version", "e1|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1"],
    ["wrong field count", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1|extra"],
    ["noncanonical start", "e2|2025-12-20T00:00:00Z|2026-03-20T00:00:00.000Z|garmin:1"],
    ["reversed window", "e2|2026-03-20T00:00:00.000Z|2025-12-20T00:00:00.000Z|garmin:1"],
    ["empty providers", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|"],
    ["malformed provider entry", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin"],
    ["duplicate provider", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1,garmin:2"],
    ["noncanonical provider order", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|oura:1,garmin:2"],
    ["zero mask", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:0"],
    ["fractional mask", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:1.5"],
    ["unknown mask bit", "e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|garmin:8"],
    ["oversized scalar", "x".repeat(DEVICE_SYNC_METADATA_MAX_STRING_LENGTH + 1)],
  ])("rejects malformed Junction push evidence: %s", (_label, value) => {
    expect(readJunctionHistoricalBackfillEvidence(value)).toBeNull();
  });

  it("fails closed when evidence additions cannot be encoded canonically or within metadata limits", () => {
    const windowStart = "2025-12-20T00:00:00.000Z";
    const windowEnd = "2026-03-20T00:00:00.000Z";
    expect(addJunctionHistoricalBackfillEvidence({
      existingValue: null,
      providerSlug: "garmin",
      resource: "sleep",
      windowStart: "2025-12-20T00:00:00Z",
      windowEnd,
    })).toBeNull();
    expect(addJunctionHistoricalBackfillEvidence({
      existingValue: null,
      providerSlug: "garmin",
      resource: "sleep",
      windowStart: windowEnd,
      windowEnd: windowStart,
    })).toBeNull();

    const nearLimitEvidence = [
      "e2",
      windowStart,
      windowEnd,
      Array.from({ length: 29 }, (_, index) => `p${String(index).padStart(3, "0")}:1`).join(","),
    ].join("|");
    expect(nearLimitEvidence).toHaveLength(DEVICE_SYNC_METADATA_MAX_STRING_LENGTH - 1);
    expect(readJunctionHistoricalBackfillEvidence(nearLimitEvidence)).not.toBeNull();
    expect(addJunctionHistoricalBackfillEvidence({
      existingValue: nearLimitEvidence,
      providerSlug: "zzzz",
      resource: "activity",
      windowStart,
      windowEnd,
    })).toBeNull();
  });

  it("rejects prototype-sensitive provider names in Junction push evidence", () => {
    for (const providerSlug of ["__proto__", "constructor", "prototype"]) {
      expect(
        readJunctionHistoricalBackfillEvidence(
          `e2|2025-12-20T00:00:00.000Z|2026-03-20T00:00:00.000Z|${providerSlug}:1`,
        ),
      ).toBeNull();
      expect(addJunctionHistoricalBackfillEvidence({
        existingValue: null,
        providerSlug,
        resource: "activity",
        windowStart: "2025-12-20T00:00:00.000Z",
        windowEnd: "2026-03-20T00:00:00.000Z",
      })).toBeNull();
    }
  });
});

describe("mergeGuardedJunctionHistoricalBackfillMetadata", () => {
  it("preserves blood-pressure source coverage during guarded replacement", () => {
    const result = mergeGuardedJunctionHistoricalBackfillMetadata({
      existingMetadata: {
        junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
        seedOnlyState: "discard",
      },
      replacementMetadata: {
        callbackOutcome: "complete",
      },
    });
    expect(result.callbackOutcome).toBe("complete");
    expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      result,
      "omron",
      "blood_pressure",
      1,
    )).toBe(true);
  });

  it("preserves opaque future historical state without retaining ordinary seed metadata", () => {
    expect(mergeGuardedJunctionHistoricalBackfillMetadata({
      existingMetadata: {
        junctionHistoricalBackfillEvidence: "e3|opaque-future-evidence",
        junctionHistoricalBackfillStatus: "coverage_v4_deferred",
        seedOnlyState: "discard",
      },
      replacementMetadata: {
        callbackOutcome: "complete",
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      },
    })).toEqual({
      callbackOutcome: "complete",
      junctionHistoricalBackfillEvidence: "e3|opaque-future-evidence",
      junctionHistoricalBackfillStatus: "coverage_v4_deferred",
    });
  });
});

describe("parseHostedExecutionDeviceSyncRuntimeApplyRequest", () => {
  it("rejects runtime apply request and response batches above the shared limit", () => {
    const connectionIds = Array.from(
      {
        length:
          hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT + 1,
      },
      (_, index) => `conn_${index}`,
    );

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: connectionIds.map((connectionId) => ({ connectionId })),
        userId: "user_123",
      })
    ).toThrowError(/runtime apply request updates must include no more than 100 entries/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: connectionIds.map((connectionId) => ({
          connection: null,
          connectionId,
          status: "missing",
          tokenUpdate: "missing",
          writeUpdate: "missing",
        })),
        userId: "user_123",
      })
    ).toThrowError(/runtime apply response updates must include no more than 100 entries/u);
  });

  it("caps each runtime apply update at 64 source projections", () => {
    const source = (index: number) => ({
      lastSeenAt: "2026-04-07T02:00:00.000Z",
      observedLastSeenAt: null,
      sourceInstanceKey: `source_${index}`,
      sourceProviderSlug: `provider_${index}`,
      status: "connected",
    });
    const boundedSources = Array.from(
      {
        length:
          hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_SOURCE_LIMIT,
      },
      (_, index) => source(index),
    );

    expect(parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [{ connectionId: "conn_123", sources: boundedSources }],
      userId: "user_123",
    }).updates[0]?.sources).toHaveLength(64);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [{
          connectionId: "conn_123",
          sources: [...boundedSources, source(boundedSources.length)],
        }],
        userId: "user_123",
      })
    ).toThrowError(/updates\[0\]\.sources must include no more than 64 entries/u);
  });

  it("parses staged dirty ack overlays on dirty-pending requests", () => {
    expect(
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          connectionId: "dsc_123",
          limit: 10,
          stagedDirtyAcks: [
            {
              connectionId: "dsc_123",
              processedDirtyPayloadIds: ["dsp_1", "dsp_2"],
              processedRevision: "42",
            },
          ],
        },
        "trusted-user",
      ),
    ).toEqual({
      connectionId: "dsc_123",
      limit: 10,
      stagedDirtyAcks: [
        {
          connectionId: "dsc_123",
          processedDirtyPayloadIds: ["dsp_1", "dsp_2"],
          processedRevision: "42",
        },
      ],
      userId: "trusted-user",
    });
  });

  it("rejects oversized staged dirty ack overlays on dirty-pending requests", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          stagedDirtyAcks: Array.from(
            {
              length:
                hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT + 1,
            },
            (_, index) => ({
              connectionId: `dsc_${index}`,
              processedRevision: "42",
            }),
          ),
        },
        "trusted-user",
      )
    ).toThrowError(/stagedDirtyAcks must include no more than 200 entries/u);

    expect(() =>
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          stagedDirtyAcks: [
            {
              connectionId: "dsc_1",
              processedDirtyPayloadIds: Array.from({ length: 3_000 }, (_, index) =>
                `dsp_left_${index}`
              ),
              processedRevision: "42",
            },
            {
              connectionId: "dsc_2",
              processedDirtyPayloadIds: Array.from({ length: 2_001 }, (_, index) =>
                `dsp_right_${index}`
              ),
              processedRevision: "43",
            },
          ],
        },
        "trusted-user",
      )
    ).toThrowError(/processedDirtyPayloadIds must include no more than 5000 total entries/u);
  });

  it("parses staged dirty ack overlays on dirty-ack requests", () => {
    expect(
      parseHostedExecutionDeviceSyncDirtyAckRequest(
        {
          connectionId: "dsc_current",
          processedDirtyPayloadIds: ["dsp_current"],
          processedRevision: "21",
          stagedDirtyAcks: [
            {
              connectionId: "dsc_next",
              processedDirtyPayloadIds: ["dsp_next_1", "dsp_next_2"],
              processedRevision: "22",
            },
          ],
          userId: "trusted-user",
        },
        "trusted-user",
      ),
    ).toEqual({
      connectionId: "dsc_current",
      processedDirtyPayloadIds: ["dsp_current"],
      processedRevision: "21",
      stagedDirtyAcks: [
        {
          connectionId: "dsc_next",
          processedDirtyPayloadIds: ["dsp_next_1", "dsp_next_2"],
          processedRevision: "22",
        },
      ],
      userId: "trusted-user",
    });
  });

  it("parses hosted runtime link and snapshot payloads with normalized timestamps", () => {
    expect(buildHostedExecutionDeviceSyncConnectLinkPath("oura/webhook")).toBe(
      "/api/internal/device-sync/connect-targets/oura%2Fwebhook/connect-link",
    );
    expect(
      parseHostedExecutionDeviceSyncConnectLinkResponse({
        authorizationUrl: "https://sync.example.test/oauth",
        expiresAt: "2026-04-07T00:00:00.000Z",
        provider: "oura",
        providerLabel: "Oura",
      }),
    ).toEqual({
      authorizationUrl: "https://sync.example.test/oauth",
      connectUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          connectionId: null,
          cursor: {
            createdAt: "2026-04-06T23:58:00+00:00",
            id: "conn_cursor",
          },
          limit: 4,
          provider: "oura",
        },
        "trusted-user",
      ),
    ).toEqual({
      connectionId: null,
      cursor: {
        createdAt: "2026-04-06T23:58:00.000Z",
        id: "conn_cursor",
      },
      includeCredentialMaterial: false,
      limit: 4,
      provider: "oura",
      userId: "trusted-user",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          includeCredentialMaterial: true,
          provider: "oura",
        },
        "trusted-user",
      ),
    ).toEqual({
      includeCredentialMaterial: true,
      provider: "oura",
      userId: "trusted-user",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-07T00:00:00+00:00",
              createdAt: "2026-04-06T23:59:59+00:00",
              displayName: "Oura User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                __proto__: "blocked",
                accountTier: "pro",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: null,
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "access-token",
                accessTokenExpiresAt: "2026-04-07T02:00:00+00:00",
                keyVersion: "kv_1",
                refreshToken: null,
                tokenVersion: 3,
              },
            },
          },
        ],
        generatedAt: "2026-04-07T00:00:00.000Z",
        nextCursor: {
          createdAt: "2026-04-06T23:59:59+00:00",
          id: "conn_123",
        },
        userId: "user_123",
      }),
    ).toEqual({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-06T23:59:59.000Z",
            displayName: "Oura User",
            externalAccountId: "oura-user-1",
            id: "conn_123",
            metadata: {
              accountTier: "pro",
            },
            provider: "oura",
            scopes: ["daily"],
            status: "active",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: "2026-04-07T02:00:00.000Z",
              keyVersion: "kv_1",
              refreshToken: null,
              tokenVersion: 3,
            },
          },
        },
      ],
      generatedAt: "2026-04-07T00:00:00.000Z",
      nextCursor: {
        createdAt: "2026-04-06T23:59:59.000Z",
        id: "conn_123",
      },
      userId: "user_123",
    });
  });

  it("rejects non-object and invalid hosted runtime snapshot requests", () => {
    for (const value of [null, "not-json-object", ["not-json-object"]]) {
      expect(() =>
        parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(value, "trusted-user"),
      ).toThrowError(/Hosted device-sync runtime snapshot request must be an object/u);
    }

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          includeCredentialMaterial: "true",
        },
        "trusted-user",
      ),
    ).toThrowError(
      /Hosted device-sync runtime snapshot request includeCredentialMaterial must be a boolean/u,
    );
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          userId: "other-user",
        },
        "trusted-user",
      ),
    ).toThrowError(/userId must match the authenticated hosted execution user/u);
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          cursor: {
            createdAt: "not-a-timestamp",
            id: "conn_123",
          },
        },
        "trusted-user",
      ),
    ).toThrowError(/snapshot request cursor.createdAt must be an ISO timestamp/u);
  });

  it("keeps only the supported internal projection paths", () => {
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH).toBe(
      "/api/internal/device-sync/runtime/snapshot",
    );
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH).toBe(
      "/api/internal/device-sync/runtime/apply",
    );
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT).toBe(32);
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT).toBe(64);
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT).toBe(
      hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
    );
    expect("buildHostedExecutionUserDeviceSyncRuntimePath" in hostedRuntime).toBe(false);
  });

  it("accepts a source snapshot produced before the arrival signal existed", () => {
    const buildSnapshot = (source: Record<string, unknown>) => ({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-07-01T08:00:00+00:00",
            createdAt: "2026-07-01T07:55:00+00:00",
            displayName: "Junction",
            externalAccountId: "junction-user-1",
            id: "conn_junction",
            metadata: {},
            provider: "junction",
            scopes: [],
            status: "active",
            updatedAt: "2026-07-01T08:01:00+00:00",
          },
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: null,
          },
          sources: [source],
        },
      ],
      generatedAt: "2026-07-01T08:02:00.000Z",
      userId: "member_123",
    });
    const legacySource = {
      displayName: null,
      firstSeenAt: "2026-07-01T08:00:00+00:00",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-01T08:01:00+00:00",
      resourceCount: 3,
      sourceInstanceKey: "src_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
    };

    // A runner-first deploy must still consume the older Web producer's
    // snapshot, or device sync stalls until Web catches up.
    const parsed = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
      buildSnapshot(legacySource),
    );
    expect(parsed.connections[0]?.sources?.[0]?.lastDataAt).toBeNull();
    expect(parsed.connections[0]?.sources?.[0]?.lifecycleEpoch).toBeUndefined();

    // A present-but-malformed value is still a contract violation.
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
        buildSnapshot({ ...legacySource, lastDataAt: "not-a-timestamp" }),
      )
    ).toThrow();
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
        buildSnapshot({ ...legacySource, lifecycleEpoch: null }),
      )
    ).toThrow(/lifecycleEpoch must be a positive integer/u);
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
        buildSnapshot({ ...legacySource, lifecycleEpoch: 0 }),
      )
    ).toThrow(/lifecycleEpoch must be a positive integer/u);

    const withArrival = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
      buildSnapshot({ ...legacySource, lastDataAt: "2026-07-01T07:59:00+00:00" }),
    );
    expect(withArrival.connections[0]?.sources?.[0]?.lastDataAt)
      .toBe("2026-07-01T07:59:00.000Z");
  });

  it("parses provider-config credential snapshots without token material", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-12T08:00:00+00:00",
            createdAt: "2026-04-12T07:55:00+00:00",
            displayName: "Junction",
            externalAccountId: "junction-user-1",
            id: "conn_junction",
            metadata: {
              accountTier: "team",
            },
            provider: "junction",
            scopes: [],
            setupExpiresAt: "2026-04-12T08:15:00+00:00",
            setupPhase: "pending_link",
            status: "active",
            updatedAt: "2026-04-12T08:01:00+00:00",
          },
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
            credentialMetadata: {
              Authorization: "Bearer secret",
              authHeader: "Bearer header-secret",
              clientUserId: "raw-client-user",
              clientUserIdHash: "hash_client_user",
              client: "raw-client",
              credentialNote: "Authorization: Bearer secret-token",
              hmacSecret: "secret",
              opaqueNote: "abc123def456ghi789jkl012mno345pq",
              owner: "raw-owner",
              ownerId: "raw-owner",
              sourceCount: 2,
              user: "raw-user",
              webhookSecret: "secret",
            },
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: null,
          },
        },
      ],
      generatedAt: "2026-04-12T08:02:00.000Z",
      userId: "user_123",
    });

    expect(parsed.connections[0]).toEqual({
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-12T08:00:00.000Z",
        createdAt: "2026-04-12T07:55:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-1",
        id: "conn_junction",
        metadata: {
          accountTier: "team",
        },
        provider: "junction",
        scopes: [],
        setupExpiresAt: "2026-04-12T08:15:00.000Z",
        setupPhase: "pending_link",
        status: "active",
        updatedAt: "2026-04-12T08:01:00.000Z",
      },
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {
          clientUserIdHash: "hash_client_user",
          sourceCount: 2,
        },
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
    });
  });

  it("parses OAuth, redacted OAuth, and none credential snapshots and none credential updates", () => {
    const localState = {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
    };
    const tokenBundle = {
      accessToken: "access-token",
      accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
      keyVersion: "kv_credential",
      refreshToken: "refresh-token",
      tokenVersion: 9,
    };

    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
              connectedAt: "2026-04-12T08:00:00.000Z",
              createdAt: "2026-04-12T07:55:00.000Z",
              displayName: "Oura",
              externalAccountId: "oura-user-credential",
              id: "conn_oauth_credential",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:01:00.000Z",
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle,
            },
            localState,
          },
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-12T08:05:00.000Z",
              createdAt: "2026-04-12T08:05:00.000Z",
              displayName: "Manual",
              externalAccountId: "manual-user-credential",
              id: "conn_none_credential",
              metadata: {},
              provider: "manual",
              scopes: [],
              status: "active",
              updatedAt: "2026-04-12T08:06:00.000Z",
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            localState,
          },
          {
            connection: {
              accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
              connectedAt: "2026-04-12T08:10:00.000Z",
              createdAt: "2026-04-12T08:10:00.000Z",
              displayName: "Redacted OAuth",
              externalAccountId: "redacted-oauth-user-credential",
              id: "conn_redacted_oauth_credential",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:11:00.000Z",
            },
            credential: {
              credentialMetadata: {
                safeCounter: 9,
                tokenHint: "blocked",
                tokenVersionNote: "blocked",
              },
              kind: "oauth_tokens_redacted",
              tokenVersion: 9,
            },
            localState,
          },
        ],
        generatedAt: "2026-04-12T08:07:00.000Z",
        userId: "user_123",
      }),
    ).toEqual({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
            connectedAt: "2026-04-12T08:00:00.000Z",
            createdAt: "2026-04-12T07:55:00.000Z",
            displayName: "Oura",
            externalAccountId: "oura-user-credential",
            id: "conn_oauth_credential",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-12T08:01:00.000Z",
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle,
          },
          localState,
        },
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-12T08:05:00.000Z",
            createdAt: "2026-04-12T08:05:00.000Z",
            displayName: "Manual",
            externalAccountId: "manual-user-credential",
            id: "conn_none_credential",
            metadata: {},
            provider: "manual",
            scopes: [],
            status: "active",
            updatedAt: "2026-04-12T08:06:00.000Z",
          },
          credential: {
            kind: "none",
            credentialMetadata: {},
          },
          localState,
        },
        {
          connection: {
            accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
            connectedAt: "2026-04-12T08:10:00.000Z",
            createdAt: "2026-04-12T08:10:00.000Z",
            displayName: "Redacted OAuth",
            externalAccountId: "redacted-oauth-user-credential",
            id: "conn_redacted_oauth_credential",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-12T08:11:00.000Z",
          },
          credential: {
            credentialMetadata: {
              safeCounter: 9,
            },
            kind: "oauth_tokens_redacted",
            tokenVersion: 9,
          },
          localState,
        },
      ],
      generatedAt: "2026-04-12T08:07:00.000Z",
      userId: "user_123",
    });

    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_none_credential",
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            observedTokenVersion: null,
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      updates: [
        {
          connectionId: "conn_none_credential",
          credential: {
            kind: "none",
            credentialMetadata: {},
          },
          observedTokenVersion: null,
        },
      ],
      userId: "user_123",
    });

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_redacted_oauth_credential",
            credential: {
              credentialMetadata: {},
              kind: "oauth_tokens_redacted",
              tokenVersion: 9,
            },
            observedTokenVersion: 9,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/credential\.kind is not supported for credential mutations/u);
  });

  it("accepts string error fields while keeping timestamp fields strict", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
          observedConnectedAt: "2026-04-06T20:00:00-04:00",
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toEqual({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
          observedConnectedAt: "2026-04-07T00:00:00.000Z",
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });
  });

  it("parses sanitized provider failure diagnostics on apply updates", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          failureDiagnostic: {
            accountStatus: "reauthorization_required",
            code: "WHOOP_TOKEN_REQUEST_FAILED",
            details: {
              providerHttpStatus: 400,
              providerHttpStatusText: "Bad Request",
              providerRequestAuthKind: "oauth_client_secret_body",
              providerRequestAuthPlacement: "body_parameters",
              providerRequestBodyFieldCount: 5,
              providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
              providerRequestBodyKind: "form_urlencoded",
              providerRequestContentType: "application_x_www_form_urlencoded",
              providerRequestCredentialPresent: true,
              providerRequestEndpointKind: "whoop_oauth_token",
              providerRequestMethod: "POST",
              providerRequestQueryParameterCount: 0,
              providerResponseErrorCode: "invalid_grant",
              providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              providerResponseErrorDescriptionFieldPresent: true,
              providerResponseErrorFieldPresent: true,
              providerResponseShapeKind: "json_object",
              providerOAuthErrorCode: "invalid_grant",
              providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              providerOAuthGrantType: "refresh_token",
              providerOAuthRequestBodyBuilderKind: "url_search_params_record",
              providerOAuthRequestClientAuthPlacement: "body_parameters",
              providerOAuthRequestClientCredentialPresent: true,
              providerOAuthRequestClientIdPresent: true,
              providerOAuthRequestContentType: "application_x_www_form_urlencoded",
              providerOAuthRequestDuplicateParameterCount: 0,
              providerOAuthRequestEncodingKind: "form_urlencoded",
              providerOAuthRequestHasDuplicateParameters: false,
              providerOAuthRequestMethod: "POST",
              providerOAuthRequestOfflineScopePresent: true,
              providerOAuthRequestParameterCount: 5,
              providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
              providerOAuthRequestRefreshCredentialPresent: true,
              providerOAuthRequestScopeCount: 1,
              providerOAuthRequestScopePresent: true,
              providerOAuthRequestScopeValue: "offline",
              providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
              providerOAuthResponseErrorDescriptionFieldPresent: true,
              providerOAuthResponseErrorFieldPresent: true,
              providerOAuthResponseShapeKind: "json_object",
            },
            retryable: false,
          },
          localState: {
            lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
            lastErrorMessage: "WHOOP token request failed.",
            lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
          },
          observedUpdatedAt: "2026-05-19T22:00:44.000Z",
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]).toMatchObject({
      connectionId: "conn_123",
      failureDiagnostic: {
        accountStatus: "reauthorization_required",
        code: "WHOOP_TOKEN_REQUEST_FAILED",
        details: {
          providerHttpStatus: 400,
          providerHttpStatusText: "Bad Request",
          providerRequestAuthKind: "oauth_client_secret_body",
          providerRequestAuthPlacement: "body_parameters",
          providerRequestBodyFieldCount: 5,
          providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
          providerRequestBodyKind: "form_urlencoded",
          providerRequestContentType: "application_x_www_form_urlencoded",
          providerRequestCredentialPresent: true,
          providerRequestEndpointKind: "whoop_oauth_token",
          providerRequestMethod: "POST",
          providerRequestQueryParameterCount: 0,
          providerResponseErrorCode: "invalid_grant",
          providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
          providerResponseErrorDescriptionFieldPresent: true,
          providerResponseErrorFieldPresent: true,
          providerResponseShapeKind: "json_object",
          providerOAuthErrorCode: "invalid_grant",
          providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
          providerOAuthGrantType: "refresh_token",
          providerOAuthRequestBodyBuilderKind: "url_search_params_record",
          providerOAuthRequestClientAuthPlacement: "body_parameters",
          providerOAuthRequestClientCredentialPresent: true,
          providerOAuthRequestClientIdPresent: true,
          providerOAuthRequestContentType: "application_x_www_form_urlencoded",
          providerOAuthRequestDuplicateParameterCount: 0,
          providerOAuthRequestEncodingKind: "form_urlencoded",
          providerOAuthRequestHasDuplicateParameters: false,
          providerOAuthRequestMethod: "POST",
          providerOAuthRequestOfflineScopePresent: true,
          providerOAuthRequestParameterCount: 5,
          providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
          providerOAuthRequestRefreshCredentialPresent: true,
          providerOAuthRequestScopeCount: 1,
          providerOAuthRequestScopePresent: true,
          providerOAuthRequestScopeValue: "offline",
          providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
          providerOAuthResponseErrorDescriptionFieldPresent: true,
          providerOAuthResponseErrorFieldPresent: true,
          providerOAuthResponseShapeKind: "json_object",
        },
        retryable: false,
      },
    });
  });

  it("drops id-shaped provider failure codes from deploy-skewed apply updates", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          failureDiagnostic: {
            accountStatus: "reauthorization_required",
            code: "WHOOP_TOKEN_REQUEST_FAILED",
            details: {
              providerResponseErrorCode: "00000000-0000-4000-8000-000000000003f",
              providerOAuthErrorCode: "invalid_grant",
              providerOAuthErrorDescription: "Refresh token expired.",
            },
            retryable: false,
          },
          localState: {},
          observedUpdatedAt: null,
        },
        {
          connectionId: "conn_456",
          failureDiagnostic: {
            accountStatus: "active",
            code: "PROVIDER_REQUEST_FAILED",
            details: {
              providerResponseErrorCode: "invalid_request",
              providerOAuthErrorCode: "a1".repeat(16),
              providerResponseErrorDescription: "Request rejected.",
            },
            retryable: true,
          },
          localState: {},
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });

    const firstDetails = parsed.updates[0]?.failureDiagnostic?.details ?? {};
    expect(firstDetails).toMatchObject({
      providerOAuthErrorCode: "invalid_grant",
      providerOAuthErrorDescription: "Refresh token expired.",
    });
    expect(firstDetails).not.toHaveProperty("providerResponseErrorCode");

    const secondDetails = parsed.updates[1]?.failureDiagnostic?.details ?? {};
    expect(secondDetails).toMatchObject({
      providerResponseErrorCode: "invalid_request",
      providerResponseErrorDescription: "Request rejected.",
    });
    expect(secondDetails).not.toHaveProperty("providerOAuthErrorCode");
  });

  it("normalizes timestamps and sanitizes secret-bearing local-state fields", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        occurredAt: "2026-04-12T10:15:00+10:00",
        updates: [
          {
            connectionId: "conn_01",
            localState: {
              lastErrorCode: "Authorization: Bearer secret-token",
              lastErrorMessage: "Provider rejected Bearer abcdefghijklmnop1234",
              lastSyncErrorAt: "2026-04-12T10:20:00+10:00",
            },
            observedTokenVersion: 1,
            observedUpdatedAt: null,
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-12T09:00:00+10:00",
                createdAt: "2026-04-12T08:00:00+10:00",
                displayName: "Morning sync",
                externalAccountId: "acct_01",
                id: "conn_01",
                metadata: {
                  nickname: "watch",
                },
                provider: "oura",
                scopes: ["daily"],
                status: "active",
                updatedAt: "2026-04-12T10:10:00+10:00",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
            },
          },
        ],
        userId: "user_01",
      }),
    ).toEqual({
      occurredAt: "2026-04-12T00:15:00.000Z",
      updates: [
        {
          connectionId: "conn_01",
          localState: {
            lastErrorCode: "Authorization: [redacted]",
            lastErrorMessage: "Provider rejected Bearer [redacted]",
            lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
          },
          observedTokenVersion: 1,
          observedUpdatedAt: null,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-11T23:00:00.000Z",
              createdAt: "2026-04-11T22:00:00.000Z",
              displayName: "Morning sync",
              externalAccountId: "acct_01",
              id: "conn_01",
              metadata: {
                nickname: "watch",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T00:10:00.000Z",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
        },
      ],
      userId: "user_01",
    });
  });

  it("keeps plain bearer-token phrasing while still redacting token-like values", () => {
    expect(
      sanitizeHostedRuntimeErrorText(
        "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
      ),
    ).toBe(
      "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
    );
    expect(sanitizeHostedRuntimeErrorText("bearer token expired")).toBe("bearer token expired");
    expect(
      sanitizeHostedRuntimeErrorText("Bearer abcdefghijklmnopqrst"),
    ).toBe("Bearer [redacted]");
    expect(
      sanitizeHostedRuntimeErrorText("Provider rejected Bearer abc12345"),
    ).toBe("Provider rejected Bearer [redacted]");
    expect(
      sanitizeHostedRuntimeErrorText("Provider rejected Bearer abcdefghijklmnop1234"),
    ).toBe("Provider rejected Bearer [redacted]");
    expect(
      sanitizeHostedRuntimeErrorText("Provider rejected Bearer abcdefghijklmnop-foo"),
    ).toBe("Provider rejected Bearer [redacted]");
    expect(
      sanitizeHostedRuntimeDiagnosticText("Bearer abcdefghijklmnopqrst"),
    ).toBe("Bearer [redacted]");

    expect(
      sanitizeHostedRuntimeErrorText(
        "authorization=Bearer expired-session-token",
      ),
    ).toBe("authorization=[redacted]");
    expect(
      sanitizeHostedRuntimeErrorText(
        "Failed for https://provider.example.test/users/example@example.test at /tmp/device-sync with +1 415 555 0100",
      ),
    ).toBe(
      "Failed for <redacted-url> at <redacted-path> with <redacted-phone>",
    );
    expect(
      sanitizeHostedRuntimeErrorText(
        "Oura API request failed for /v2/usercollection/daily_sleep; open '/tmp/device-sync/private.log'; notify 415-555-0100",
      ),
    ).toBe(
      "Oura API request failed for /v2/usercollection/daily_sleep; open '<redacted-path>'; notify <redacted-phone>",
    );
  });

  it("redacts secret-bearing error fields in runtime apply payloads and seeds", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=apply-secret",
            lastErrorMessage:
              "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00+00:00",
              createdAt: "2026-04-06T22:00:00+00:00",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
            },
            localState: {
              lastErrorCode: "refresh_token=seed-secret",
              lastErrorMessage:
                "authorization=Bearer seed-token refresh_token=seed-refresh eyJhbGciOiJIUzI1NiJ9.seed.payload",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toMatchObject({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=[redacted]",
            lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          seed: {
            localState: {
              lastErrorCode: "refresh_token=[redacted]",
              lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
            },
          },
        },
      ],
      userId: "user_123",
    });
  });

  it("sanitizes connection metadata updates before they reach durable runtime state", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            metadata: {
              "__proto__": "blocked",
              accountTier: "pro",
              attempts: 2,
              nested: {
                secret: "discarded",
              },
              nullValue: null,
              verbose: "x".repeat(257),
            },
          },
          connectionId: "conn_123",
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]?.connection?.metadata).toEqual({
      accountTier: "pro",
      attempts: 2,
      nullValue: null,
    });
  });

  it("parses credential apply mutations and fences credential changes", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
              credentialMetadata: {
                authHeader: "Bearer drop-me",
                client: "raw-client",
                clientUserId: "raw-client-user",
                clientUserIdHash: "hash_client_user",
                credentialNote: "Authorization: Bearer drop-me",
                opaqueNote: "abc123def456ghi789jkl012mno345pq",
                owner: "raw-owner",
                ownerId: "raw-owner",
                providerApiKey: "drop-me",
                user: "raw-user",
              },
            },
            observedTokenVersion: null,
          },
          {
            connectionId: "conn_clear_tokens",
            credential: {
              clearTokens: true,
              kind: "oauth_tokens",
            },
            observedTokenVersion: 8,
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      updates: [
        {
          connectionId: "conn_provider_config",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
            credentialMetadata: {
              clientUserIdHash: "hash_client_user",
            },
          },
          observedTokenVersion: null,
        },
        {
          connectionId: "conn_clear_tokens",
          credential: {
            clearTokens: true,
            kind: "oauth_tokens",
          },
          observedTokenVersion: 8,
        },
      ],
      userId: "user_123",
    });

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_clear_tokens",
            credential: {
              clearTokens: true,
              kind: "oauth_tokens",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
              tokenBundle: null,
            },
            observedTokenVersion: null,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/credential\.tokenBundle is not supported/u);
  });

  it("rejects legacy top-level tokenBundle fields in snapshots and seeds", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-12T08:00:00.000Z",
              createdAt: "2026-04-12T07:55:00.000Z",
              displayName: "Legacy Snapshot",
              externalAccountId: "legacy-snapshot",
              id: "conn_legacy_snapshot",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:01:00.000Z",
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            tokenBundle: {
              accessToken: "legacy-access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_legacy",
              refreshToken: null,
              tokenVersion: 1,
            },
          },
        ],
        generatedAt: "2026-04-12T08:07:00.000Z",
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_legacy_seed",
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-12T08:05:00.000Z",
                createdAt: "2026-04-12T08:05:00.000Z",
                displayName: "Legacy Seed",
                externalAccountId: "legacy-seed",
                id: "conn_legacy_seed",
                metadata: {},
                provider: "oura",
                scopes: ["daily"],
                status: "active",
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              tokenBundle: {
                accessToken: "legacy-seed-access-token",
                accessTokenExpiresAt: null,
                keyVersion: "kv_legacy_seed",
                refreshToken: null,
                tokenVersion: 1,
              },
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);
  });

  it("parses apply request and response payloads across seed, local-state, and token-bundle branches", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        occurredAt: "2026-04-07T00:00:00+00:00",
        updates: [
          {
            connection: {
              displayName: null,
              metadata: {
                keep: "value",
                nested: {
                  secret: "discarded",
                },
              },
              scopes: ["daily"],
              status: "disconnected",
            },
            connectionId: "conn_123",
            localState: {
              clearError: true,
              lastErrorCode: null,
              lastErrorMessage: "Sync failed",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: "2026-04-07T00:01:00+00:00",
              lastSyncStartedAt: "2026-04-07T00:00:30+00:00",
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            observedTokenVersion: null,
            observedUpdatedAt: null,
            sources: [
              {
                displayName: null,
                firstSeenAt: "2026-04-06T23:00:00+00:00",
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSeenAt: "2026-04-07T00:00:00+00:00",
                observedLastSeenAt: null,
                resourceAvailabilitySummary: {
                  activity: true,
                  heartrate: true,
                },
                sourceInstanceKey: "junction_garmin",
                sourceProviderSlug: "garmin",
                status: "connected",
              },
            ],
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-06T23:00:00+00:00",
                createdAt: "2026-04-06T22:00:00+00:00",
                displayName: "Seed User",
                externalAccountId: "oura-user-1",
                id: "conn_123",
                metadata: {
                  trace: "seed",
                },
                provider: "oura",
                scopes: ["daily"],
                status: "reauthorization_required",
                updatedAt: "2026-04-06T23:30:00+00:00",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "access-token",
                accessTokenExpiresAt: null,
                keyVersion: "kv_2",
                refreshToken: "refresh-token",
                tokenVersion: 5,
              },
            },
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      occurredAt: "2026-04-07T00:00:00.000Z",
      updates: [
        {
          connection: {
            displayName: null,
            metadata: {
              keep: "value",
            },
            scopes: ["daily"],
            status: "disconnected",
          },
          connectionId: "conn_123",
          localState: {
            clearError: true,
            lastErrorCode: null,
            lastErrorMessage: "Sync failed",
            lastSyncCompletedAt: null,
            lastSyncErrorAt: "2026-04-07T00:01:00.000Z",
            lastSyncStartedAt: "2026-04-07T00:00:30.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          sources: [
            {
              displayName: null,
              firstSeenAt: "2026-04-06T23:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-07T00:00:00.000Z",
              observedLastSeenAt: null,
              resourceAvailabilitySummary: {
                activity: true,
                heartrate: true,
              },
              sourceInstanceKey: "junction_garmin",
              sourceProviderSlug: "garmin",
              status: "connected",
            },
          ],
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00.000Z",
              createdAt: "2026-04-06T22:00:00.000Z",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                trace: "seed",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "reauthorization_required",
              updatedAt: "2026-04-06T23:30:00.000Z",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_2",
              refreshToken: "refresh-token",
              tokenVersion: 5,
            },
          },
        },
      ],
      userId: "user_123",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "missing",
            tokenUpdate: "skipped_version_mismatch",
            writeUpdate: "missing",
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: null,
          connectionId: "conn_123",
          status: "missing",
          tokenUpdate: "skipped_version_mismatch",
          writeUpdate: "missing",
        },
      ],
      userId: "user_123",
    });
  });

  it("rejects duplicate connection IDs and mismatched trusted user IDs", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
          },
          {
            connection: {
              status: "active",
            },
            connectionId: "conn_123",
            observedUpdatedAt: null,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/duplicate connectionId conn_123/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest(
        {
          updates: [
            {
              connectionId: "conn_123",
              localState: {
                clearError: true,
              },
              observedUpdatedAt: null,
            },
          ],
          userId: "user_123",
        },
        "trusted_user_456",
      ),
    ).toThrowError(/must match the authenticated hosted execution user/u);
  });

  it("rejects invalid hosted runtime enum and scalar fields", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "broken",
            tokenUpdate: "missing",
            writeUpdate: "missing",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "missing",
            tokenUpdate: "missing",
            writeUpdate: "legacy_inferred",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/writeUpdate is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connection: {
              status: "broken",
            },
            connectionId: "conn_123",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/connection\.status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              clearError: "yes",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/clearError must be a boolean/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            observedTokenVersion: 0,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion must be a positive integer/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              clearError: true,
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedUpdatedAt is required when connection or localState mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_1",
              refreshToken: null,
              tokenVersion: 1,
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);

    const seed = {
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-07T00:00:00.000Z",
        createdAt: "2026-04-07T00:00:00.000Z",
        displayName: "Seed User",
        externalAccountId: "ext_seed",
        id: "conn_seed",
        metadata: {},
        provider: "oura",
        scopes: ["daily"],
        status: "active" as const,
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
      credential: {
        kind: "none" as const,
        credentialMetadata: {},
      },
    };

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_seed",
            seed,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedUpdatedAt is required when connection or localState mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_seed",
            observedUpdatedAt: null,
            seed,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required when credential mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              lastSyncErrorAt: "not-a-timestamp",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/lastSyncErrorAt must be an ISO timestamp/u);
  });

  it("requires explicit writeUpdate values in runtime apply responses", () => {
    expect(parseHostedExecutionDeviceSyncRuntimeApplyResponse({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Applied",
            externalAccountId: "ext_applied",
            id: "conn_applied",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T02:00:00.000Z",
          },
          connectionId: "conn_applied",
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "applied",
        },
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Unchanged",
            externalAccountId: "ext_unchanged",
            id: "conn_unchanged",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T01:59:00.000Z",
          },
          connectionId: "conn_unchanged",
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "unchanged",
        },
        {
          connection: null,
          connectionId: "conn_missing",
          status: "missing",
          tokenUpdate: "missing",
          writeUpdate: "missing",
        },
      ],
      userId: "user_123",
    }).updates).toEqual([
      expect.objectContaining({
        connectionId: "conn_applied",
        writeUpdate: "applied",
      }),
      expect.objectContaining({
        connectionId: "conn_unchanged",
        writeUpdate: "unchanged",
      }),
      expect.objectContaining({
        connectionId: "conn_missing",
        writeUpdate: "missing",
      }),
    ]);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-07T00:00:00.000Z",
              createdAt: "2026-04-07T00:00:00.000Z",
              displayName: "Legacy",
              externalAccountId: "ext_legacy",
              id: "conn_legacy",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-07T02:00:00.000Z",
            },
            connectionId: "conn_legacy",
            status: "updated",
            tokenUpdate: "unchanged",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/writeUpdate must be a non-empty string/u);
  });

  it("normalizes hosted wake helpers without mutating the original hint payload", () => {
    const hint = {
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-07T00:10:00.000Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            objectId: "sleep_123",
          },
          priority: 90,
        },
        {
          kind: "reconcile",
          payload: {
            windowStart: "2026-04-06T00:00:00.000Z",
          },
        },
      ],
    };

    const context = resolveHostedDeviceSyncWakeContext({
      hint,
    });
    const normalized = normalizeHostedDeviceSyncJobHints(hint);

    expect(context).toEqual({
      connectionId: null,
      expectedConnectedAt: null,
      hint,
      provider: null,
    });
    expect(normalized).toEqual([
      {
        availableAt: "2026-04-07T00:10:00.000Z",
        dedupeKey: null,
        kind: "resource",
        maxAttempts: 3,
        payload: {
          objectId: "sleep_123",
        },
        priority: 90,
      },
      {
        kind: "reconcile",
        payload: {
          windowStart: "2026-04-06T00:00:00.000Z",
        },
      },
    ]);

    normalized[0]?.payload && ((normalized[0].payload.objectId as string) = "changed");

    expect(hint.jobs[0]?.payload).toEqual({
      objectId: "sleep_123",
    });
    expect(normalizeHostedDeviceSyncJobHints(null)).toEqual([]);
  });

  it("parses the hosted wake hint owner shape once", () => {
    const parsed = parseHostedExecutionDeviceSyncWakeHint({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
            occurredAt: "2026-04-09T00:00:30Z",
            resource: "glucose",
            resourceCategory: "timeseries",
            resourceId: "sleep_123",
            sourceProviderSlug: "dexcom_v3",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00Z",
      memberEditConflictResolution: "use_provider",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });

    expect(parsed).toEqual({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00.000Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
            occurredAt: "2026-04-09T00:00:30.000Z",
            resource: "glucose",
            resourceCategory: "timeseries",
            resourceId: "sleep_123",
            sourceProviderSlug: "dexcom_v3",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00.000Z",
      memberEditConflictResolution: "use_provider",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });
  });

  it("feeds the parsed owner shape into job-hint normalization", () => {
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          kind: "resource",
          payload: {
            resource: "activity",
            resourceCategory: "summary",
            resourceId: "abc",
            sourceProviderSlug: "oura",
            windowStart: "2026-04-08T00:00:00Z",
          },
        },
      ],
    });

    expect(normalizeHostedDeviceSyncJobHints(hint)).toEqual([
      {
        availableAt: "2026-04-09T00:00:00.000Z",
        kind: "resource",
        payload: {
          resource: "activity",
          resourceCategory: "summary",
          resourceId: "abc",
          sourceProviderSlug: "oura",
          windowStart: "2026-04-08T00:00:00.000Z",
        },
      },
    ]);
  });

  it("parses Junction historical backfill job hints", () => {
    const unresolvedIdentitiesJson = JSON.stringify({
      v: 1,
      i: Array.from({ length: 65 }, (_, index) =>
        `blood-pressure-${index.toString(16).padStart(16, "0")}`
      ),
    });
    const workoutStreamCursor = JSON.stringify({
      v: 1,
      i: [JSON.stringify(["garmin", "watch", "watch-1", "workout-1"])],
    });
    const timeseriesResourceCursor = JSON.stringify({
      v: 1,
      a: "body_mass_index",
      i: ["distance"],
    });
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          kind: "backfill",
          payload: {
            emptyBackfillAttempts: 2,
            historicalBackfill: true,
            historicalBackfillVersion: 2,
            historicalProviderRecordsSeen: true,
            historicalRecordsSeen: true,
            historicalUnresolvedProviderRecordIdentitiesJson: unresolvedIdentitiesJson,
            historicalUnresolvedProviderRecordCount: 65,
            historicalWindowStart: "2026-03-01T00:00:00Z",
            timeseriesCursor: "2026-04-02T00:00:00Z",
            timeseriesResourceCursor,
            workoutStreamCursor,
            windowEnd: "2026-04-03T00:00:00Z",
            windowStart: "2026-04-01T00:00:00Z",
          },
        },
        {
          kind: "reconcile",
          payload: {
            timeseriesResourceCursor: "heartrate",
            windowEnd: "2026-04-04T00:00:00Z",
            windowStart: "2026-04-03T00:00:00Z",
          },
        },
        {
          kind: "backfill",
          payload: {
            windowEnd: "2026-04-05T00:00:00Z",
            windowStart: "2026-04-04T00:00:00Z",
          },
        },
      ],
    });

    expect(hint?.jobs?.[0]?.payload).toEqual({
      emptyBackfillAttempts: 2,
      historicalBackfill: true,
      historicalBackfillVersion: 2,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      historicalUnresolvedProviderRecordIdentitiesJson: unresolvedIdentitiesJson,
      historicalUnresolvedProviderRecordCount: 65,
      historicalWindowStart: "2026-03-01T00:00:00.000Z",
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor,
      workoutStreamCursor,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    });
    expect(hint?.jobs?.[1]?.payload).toEqual({
      timeseriesResourceCursor: "heartrate",
      windowEnd: "2026-04-04T00:00:00.000Z",
      windowStart: "2026-04-03T00:00:00.000Z",
    });
    expect(hint?.jobs?.[2]?.payload).toEqual({
      windowEnd: "2026-04-05T00:00:00.000Z",
      windowStart: "2026-04-04T00:00:00.000Z",
    });

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "backfill",
            payload: {
              timeseriesCursor: "not-a-timestamp",
              windowEnd: "2026-04-03T00:00:00Z",
              windowStart: "2026-04-01T00:00:00Z",
            },
          },
        ],
      }),
    ).toThrow(/timeseriesCursor must be an ISO timestamp/i);
  });

  it("drops empty string payload fields from hosted wake job hints", () => {
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          kind: "resource",
          payload: {
            objectId: "",
            resource: "heartrate",
            resourceCategory: "timeseries",
            sourceProviderSlug: "",
            windowStart: "2026-04-08T00:00:00Z",
          },
        },
      ],
    });

    expect(hint?.jobs?.[0]?.payload).toEqual({
      resource: "heartrate",
      resourceCategory: "timeseries",
      windowStart: "2026-04-08T00:00:00.000Z",
    });
  });

  it("rejects invalid hosted wake job payloads, payload keys, and schedule timestamps", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "resource",
            payload: ["not", "an", "object"],
          },
        ],
      })
    ).toThrow(/payload/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "resource",
            payload: {
              refreshToken: "secret",
            },
          },
        ],
      }),
    ).toThrow(/payload\.refreshToken is not supported/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        nextReconcileAt: "tomorrow",
      }),
    ).toThrow(/nextReconcileAt must be an ISO timestamp/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        nextReconcileAt: "2026-04-09T00:00:00.000+25:00",
      }),
    ).toThrow(/nextReconcileAt must be an ISO timestamp/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            availableAt: "not-a-timestamp",
            kind: "resource",
          },
        ],
      }),
    ).toThrow(/availableAt must be an ISO timestamp/i);
  });
});

describe("sanitizeHostedRuntimeDiagnosticText", () => {
  it("classifies standalone id-shaped diagnostic tokens", () => {
    expect(isHostedRuntimeIdShapedDiagnosticToken("00000000-0000-4000-8000-000000000003")).toBe(true);
    expect(isHostedRuntimeIdShapedDiagnosticToken("a1".repeat(16))).toBe(true);
    expect(isHostedRuntimeIdShapedDiagnosticToken("invalid_request")).toBe(false);
    expect(isHostedRuntimeIdShapedDiagnosticToken("value_error.date")).toBe(false);
    expect(isHostedRuntimeIdShapedDiagnosticToken("ERR_42")).toBe(false);
    expect(isHostedRuntimeIdShapedDiagnosticToken("2026-07-04T09:15:00Z")).toBe(false);
    expect(isHostedRuntimeIdShapedDiagnosticToken("v1.2.3")).toBe(false);
  });

  it("masks long opaque tokens in place instead of dropping the whole text", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "Team 00000000-0000-4000-8000-000000000003 is not configured for sleep_cycle.",
      ),
    ).toBe("Team <redacted-id> is not configured for sleep_cycle.");
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "record 00000000-0000-4000-8000-000000000003 was rejected upstream.",
      ),
    ).toBe("record <redacted-token> was rejected upstream.");
  });

  it("masks colon-form identifier assignments and truncates equals-assignment tails", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("request rejected for user_id: hbm_abc123xyz upstream"),
    ).toBe("request rejected for user_id: <redacted-id> upstream");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request rejected for user_id: hbm_abc123/Jane-Doe upstream"),
    ).toBe("request rejected for user_id: <redacted-id> upstream");
    const quotedValue = sanitizeHostedRuntimeDiagnosticText('request rejected for user_id: "Jane Doe" upstream');
    expect(quotedValue).toBe("request rejected for user_id: <redacted-id> upstream");
    expect(quotedValue ?? "").not.toContain("Jane");
    expect(quotedValue ?? "").not.toContain("Doe");
    expect(
      sanitizeHostedRuntimeDiagnosticText("user_id=1234 rejected"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("user_id=abcdef+tail rejected"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("request rejected for user_id: hbm_abc123, display_name=Jane Doe upstream"),
    ).toBe("request rejected for user_id: <redacted-id>");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request rejected for user_id: hbm_abc123, display_name = Jane Doe upstream"),
    ).toBe("request rejected for user_id: <redacted-id>");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request rejected for user_id: hbm_abc123, display_name: Jane Doe upstream"),
    ).toBe("request rejected for user_id: <redacted-id>");
    expect(
      sanitizeHostedRuntimeDiagnosticText("display_name: Jane Doe cannot access sleep_cycle"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("user: Jane Doe cannot access sleep_cycle"),
    ).toBe("user: <redacted-id>");
    expect(
      sanitizeHostedRuntimeDiagnosticText("Jane Doe cannot access sleep_cycle"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("Jane Doe not found"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("User Jane Doe not found"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("Patient Jane Doe not found"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("Jane Doe"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("detail: Jane Doe"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("Provider reason: Refresh token expired. Reconnect WHOOP."),
    ).toBe("Provider reason: Refresh token expired. Reconnect WHOOP.");
  });

  it("masks token phrases while keeping prose token labels", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("refresh token abc123 leaked"),
    ).toBe("refresh token <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("refresh token abcdefghijklmnopqrst leaked"),
    ).toBe("refresh token <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("refresh token: abcdefghijklmnopqrst expired"),
    ).toBe("refresh token: <redacted-token> expired");
    expect(
      sanitizeHostedRuntimeDiagnosticText("api key abcdefghijklmnop leaked"),
    ).toBe("api key <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("api key secretvalue leaked"),
    ).toBe("api key <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("client secret abcdefghijklmnop leaked"),
    ).toBe("client secret <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("refresh token secretvalue leaked"),
    ).toBe("refresh token <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("generic token abcdefghijklmnop leaked"),
    ).toBe("generic token <redacted-token> leaked");
    expect(
      sanitizeHostedRuntimeDiagnosticText("session token expired"),
    ).toBe("session token expired");
  });

  it("redacts whole authorization header values for any scheme", () => {
    const authorizationHeader = `${"Author"}ization:`;
    const proxyAuthorizationHeader = `Proxy-${"Author"}ization:`;
    const basicCredential = ["dXNl", "cjpw", "YXNz"].join("");
    const digestScheme = ["Dig", "est"].join("");

    expect(
      sanitizeHostedRuntimeErrorText(
        `${proxyAuthorizationHeader} ${digestScheme} username="user", response="token" rejected`,
      ),
    ).toBe(`${proxyAuthorizationHeader} [redacted]`);
    expect(
      sanitizeHostedRuntimeErrorText(
        `${authorizationHeader} ${digestScheme} username = "user", response = "token" rejected`,
      ),
    ).toBe(`${authorizationHeader} [redacted]`);
    expect(
      sanitizeHostedRuntimeErrorText(
        `${authorizationHeader} AWS4-HMAC-SHA256 Credential=test; SignedHeaders=host;x-test; Signature=abcdef rejected`,
      ),
    ).toBe(`${authorizationHeader} [redacted]`);
    expect(
      sanitizeHostedRuntimeErrorText(
        `Request failed\n${authorizationHeader} Basic ${basicCredential}\nRetryable`,
      ),
    ).toBe(`Request failed ${authorizationHeader} [redacted] Retryable`);
    expect(
      sanitizeHostedRuntimeErrorText(
        `Request failed\r${authorizationHeader} Basic ${basicCredential}\rRetryable`,
      ),
    ).toBe(`Request failed ${authorizationHeader} [redacted] Retryable`);
    expect(
      sanitizeHostedRuntimeErrorText(
        `Proxy-${"Author"}ization=${basicCredential} refresh_token=refresh-secret`,
      ),
    ).toBe("Proxy-Authorization=[redacted] refresh_token=[redacted]");
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        `Privy request failed: ${authorizationHeader} Basic ${basicCredential}`,
      ),
    ).toBe(`Privy request failed: ${authorizationHeader} [redacted]`);
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        `Privy request failed: ${proxyAuthorizationHeader} ${digestScheme} username="user", response="token" rejected`,
      ),
    ).toBe("Privy request failed:");
  });

  it("keeps plain bracketed prose and truncates validation suffixes", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("Provider returned [timeout] while checking sleep_cycle"),
    ).toBe("Provider returned [timeout] while checking sleep_cycle");
    expect(
      sanitizeHostedRuntimeDiagnosticText("see [option] and [other] words"),
    ).toBe("see [option] and [other] words");
    expect(
      sanitizeHostedRuntimeDiagnosticText("see [docs] for details"),
    ).toBe("see [docs] for details");

    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "Datetimes provided to dates should have zero time [type=date_from_datetime_inexact]",
      ),
    ).toBe("Datetimes provided to dates should have zero time");
    expect(
      sanitizeHostedRuntimeDiagnosticText("rejected [input_value='Jane Doe', input_type=str]"),
    ).toBe("rejected");
  });

  it("truncates bracketed assignment, colon, and comma segments", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("Validation failed [user_id=1234, display_name=Jane Doe]"),
    ).toBe("Validation failed");
    expect(
      sanitizeHostedRuntimeDiagnosticText("Validation failed [display_name: Jane]"),
    ).toBe("Validation failed");
    expect(
      sanitizeHostedRuntimeDiagnosticText("failed [display_name=Jane"),
    ).toBe("failed");
    expect(
      sanitizeHostedRuntimeDiagnosticText("Validation failed [context [field] display_name=Jane]"),
    ).toBe("Validation failed");
    expect(
      sanitizeHostedRuntimeDiagnosticText("failed [outer [inner] a, b]"),
    ).toBe("failed");
    expect(
      sanitizeHostedRuntimeDiagnosticText("[display_name=Jane]"),
    ).toBeNull();
  });

  it("still fails closed on raw structured payload dumps", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText('unexpected body {"detail": "sleep_cycle disabled"}'),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("{id: abc123, detail: disabled}"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText('["junction-user-1"]'),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("[junction-user-1, Jane Doe]"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText("[12345]"),
    ).toBeNull();
    expect(
      sanitizeHostedRuntimeDiagnosticText('{user_id:"junction-user-1", display_name:"Alice"}'),
    ).toBeNull();
  });

  it("masks explicit id-noun phrases and truncates camel-case team assignments", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("user id hbm_abc123xyz is blocked upstream"),
    ).toBe("user id <redacted-id> is blocked upstream");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request denied for teamId=hbm_abc123xyz"),
    ).toBe("request denied for");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request denied for team-id = hbm_abc123xyz"),
    ).toBe("request denied for");
  });

  it("masks id-shaped values regardless of quoting or bracketing", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText('User "junction-user-1" is not configured'),
    ).toBe('User "<redacted-id>" is not configured');
    expect(
      sanitizeHostedRuntimeDiagnosticText("provider returned [junction-user-1] for the request"),
    ).toBe("provider returned [<redacted-token>] for the request");
    expect(
      sanitizeHostedRuntimeDiagnosticText("retry after 2026-07-04T09:15:00Z with limit 250 on v1.2.3"),
    ).toBe("retry after 2026-07-04T09:15:00Z with limit 250 on v1.2.3");
    expect(
      sanitizeHostedRuntimeDiagnosticText("request from 203.0.113.42 denied"),
    ).toBe("request from <redacted-ip> denied");
  });

  it("truncates quoted echoed input values", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("rejected [input_value='user junction-user-1', input_type=str]"),
    ).toBe("rejected");
    const quotedInput = sanitizeHostedRuntimeDiagnosticText("rejected [input_value='Jane Doe', input_type=str]");
    expect(quotedInput).toBe("rejected");
    expect(quotedInput ?? "").not.toContain("Doe");
    const mixedQuoteInput = sanitizeHostedRuntimeDiagnosticText(
      "rejected [input_value=\"Jane's device\", input_type=str]",
    );
    expect(mixedQuoteInput).toBe("rejected");
    expect(mixedQuoteInput ?? "").not.toContain("Jane");
    expect(mixedQuoteInput ?? "").not.toContain("device");
  });

  it("strips default-ignorable format characters before masking", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("user junction-\u200Buser-1 denied"),
    ).toBe("user <redacted-id> denied");
    const sanitized = sanitizeHostedRuntimeDiagnosticText("access\u200B_token=secretvalue");
    expect(sanitized).toBeNull();
    expect(sanitized ?? "").not.toContain("secretvalue");
    const bidiSecret = sanitizeHostedRuntimeDiagnosticText("access\u2066_token=secretvalue");
    expect(bidiSecret).toBeNull();
    expect(bidiSecret ?? "").not.toContain("secretvalue");
    const bidiIdentifier = sanitizeHostedRuntimeDiagnosticText('user\u2066_id="Jane Doe"');
    expect(bidiIdentifier).toBeNull();
    expect(bidiIdentifier ?? "").not.toContain("Jane");
    expect(bidiIdentifier ?? "").not.toContain("Doe");
  });

  it("fails closed when a structured dump starts beyond the length cap", () => {
    const prefix = "safe provider explanation ".repeat(24).trim();
    const sanitized = sanitizeHostedRuntimeDiagnosticText(`${prefix} {"debug":"dump"}`);
    // Soundness beats prefix salvage: a structured dump anywhere in the
    // normalized pre-mask diagnostic fails the whole value closed.
    expect(sanitized).toBeNull();
  });

  it("masks long tokens that would straddle the diagnostic length cap", () => {
    const filler = "safe words ".repeat(48).trim();
    const token = "a1".repeat(50);
    const sanitized = sanitizeHostedRuntimeDiagnosticText(`${filler} ${token}`);
    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toContain("a1a1a1");
    expect(sanitized?.length).toBeLessThanOrEqual(512);
  });

  it("truncates echoed validation input values inside bracket suffixes", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "Input should be a valid date [type=value_error, input_value=junction-user-1, input_type=str]",
      ),
    ).toBe("Input should be a valid date");
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "Input should be valid [type=value_error, input_value=Jane Doe, input_type=str]",
      ),
    ).toBe("Input should be valid");
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "Input should be a valid date [type=value_error, input_value='Jane Doe', input_type=str]",
      ),
    ).toBe("Input should be a valid date");
  });

  it("masks id-shaped identifier phrases while keeping plain words", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText("user hbm_abc123xyz is not configured"),
    ).toBe("user <redacted-id> is not configured");
    expect(
      sanitizeHostedRuntimeDiagnosticText("user hbm_abc123/Jane-Doe is blocked upstream"),
    ).toBe("user <redacted-id> is blocked upstream");
    expect(
      sanitizeHostedRuntimeDiagnosticText("user profile summaries are disabled for this team"),
    ).toBe("user profile summaries are disabled for this team");
  });

  it("masks multiple unsafe spans in one string", () => {
    expect(
      sanitizeHostedRuntimeDiagnosticText(
        "user 0123456789abcdef0123456789abcdef01 denied; retry as 00000000-0000-4000-8000-000000000003",
      ),
    ).toBe("user <redacted-id> denied; retry as <redacted-token>");
  });
});

describe("member-owned provider runtime snapshot config", () => {
  it("parses the bounded invocation-scoped provider config", () => {
    expect(parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
      connections: [],
      generatedAt: "2026-08-10T00:00:00.000Z",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
      userId: "member_123",
    })).toEqual({
      connections: [],
      generatedAt: "2026-08-10T00:00:00.000Z",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
      userId: "member_123",
    });
  });

  it("rejects control-plane-only webhook secrets", () => {
    expect(() => parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
      connections: [],
      generatedAt: "2026-08-10T00:00:00.000Z",
      providerConfigs: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
          webhookSigningSecret: "must-stay-on-web",
        },
      },
      userId: "member_123",
    })).toThrow(/webhookSigningSecret/u);
  });
});
