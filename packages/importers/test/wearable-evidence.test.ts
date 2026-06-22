import assert from "node:assert/strict";

import { test } from "vitest";
import { normalizeWearableMetricValue } from "../src/device-providers/metric-catalog.ts";
import { pushDeletionObservation } from "../src/device-providers/shared-normalization.ts";

import {
  createDeviceProviderRegistry,
  prepareDeviceProviderSnapshotImport,
  resolveWearableCanonicalMetricKey,
  resolveWearableMetricTolerance,
  type DeviceBatchImportPayload,
  type DeviceEventPayload,
  type DeviceProviderAdapter,
  type DeviceProviderSnapshotImportPayload,
  type NormalizedDeviceBatch,
  type WearableRawIngestReceipt,
} from "../src/index.ts";

function makeTestDeviceProviderAdapter<TSnapshot>(
  adapter: Pick<DeviceProviderAdapter<TSnapshot>, "provider" | "normalizeSnapshot"> &
    Partial<Omit<DeviceProviderAdapter<TSnapshot>, "provider" | "normalizeSnapshot">>,
): DeviceProviderAdapter<TSnapshot> {
  return {
    displayName: adapter.provider,
    transportModes: ["scheduled_poll"],
    normalization: {
      metricFamilies: ["activity"],
      snapshotParser: "passthrough",
    },
    sourcePriorityHints: {
      defaultPriority: 50,
      metricFamilies: {},
    },
    ...adapter,
  };
}

function readRawReceiptArtifact(payload: DeviceBatchImportPayload): WearableRawIngestReceipt {
  const receipt = payload.ingestReceipt as WearableRawIngestReceipt | undefined;
  assert.ok(receipt);
  assert.equal(receipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  return receipt;
}

test("wearable metric catalog resolves current hyphenated and sample aliases", () => {
  assert.equal(resolveWearableCanonicalMetricKey("activity-score"), "activityScore");
  assert.equal(resolveWearableCanonicalMetricKey("daily-steps"), "steps");
  assert.equal(resolveWearableCanonicalMetricKey("sleep-total-minutes"), "totalSleepMinutes");
  assert.equal(resolveWearableCanonicalMetricKey("resting-heart-rate"), "restingHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("heart_rate"), "averageHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("estimated_vo2_max"), "estimatedVo2Max");
  assert.equal(resolveWearableCanonicalMetricKey("vo2max"), "estimatedVo2Max");
  assert.equal(resolveWearableCanonicalMetricKey("cardio_fitness"), "estimatedVo2Max");
  assert.equal(resolveWearableCanonicalMetricKey("cardiorespiratory_fitness"), "estimatedVo2Max");
  assert.equal(resolveWearableCanonicalMetricKey("energy-burned"), "totalCalories");
  assert.equal(resolveWearableCanonicalMetricKey("max-heart-rate"), "maxHeartRate");
  assert.equal(resolveWearableCanonicalMetricKey("workout-strain"), "workoutStrain");
  assert.equal(resolveWearableCanonicalMetricKey("percent-recorded"), "percentRecorded");
  assert.equal(resolveWearableCanonicalMetricKey("altitude-gain"), "totalElevationGainMeters");
  assert.equal(resolveWearableCanonicalMetricKey("altitude-change"), "altitudeChangeMeters");
  assert.equal(resolveWearableMetricTolerance("day-strain"), 0.5);
});

test("wearable metric normalization converts energy-burned to total calories", () => {
  assert.deepEqual(
    normalizeWearableMetricValue("energy-burned", 418.4, "kJ"),
    {
      key: "totalCalories",
      unit: "kcal",
      value: 100,
    },
  );
  assert.deepEqual(
    normalizeWearableMetricValue("energy-burned", 418.4, null),
    {
      key: "totalCalories",
      unit: "kcal",
      value: 418.4,
    },
  );
});

test("prepareDeviceProviderSnapshotImport emits raw receipt artifacts without side-channel wearable records", async () => {
  const registry = createDeviceProviderRegistry([
    makeTestDeviceProviderAdapter({
      provider: "polar",
      normalizeSnapshot(snapshot): NormalizedDeviceBatch {
        return {
          provider: "polar",
          accountId: "polar-user-1",
          importedAt: "2026-04-20T09:00:00.000Z",
          source: "device",
          events: [{
            kind: "observation",
            occurredAt: "2026-04-20T09:00:00.000Z",
            dayKey: "2026-04-20",
            evidenceRoles: ["daily-summary"],
            dataOrigin: {
              version: 1,
              aggregatorProvider: "junction",
              sourceProviderSlug: "polar",
              sourceType: "watch",
              sourceInstanceId: "source-polar-watch-1",
            },
            fields: {
              metric: "daily-steps",
              unit: "count",
              value: 8123,
            },
          }],
          evidenceParts: [{
            role: "daily-summary",
            fileName: "daily-summary.json",
            content: snapshot,
          }],
        };
      },
    }),
  ]);

  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "polar",
    snapshot: {
      daily_summary: {
        steps: 8123,
      },
    },
    connectionId: "conn_polar_01",
    userId: "user_01",
    sourceKind: "webhook",
    deliveryMode: "full_payload",
    resourceType: "daily_summary",
    resourceId: "summary_2026_04_20",
  } satisfies DeviceProviderSnapshotImportPayload, {
    providerRegistry: registry,
  });

  const rawReceipt = readRawReceiptArtifact(payload);

  assert.equal(rawReceipt.connectionId, "conn_polar_01");
  assert.equal(rawReceipt.sourceKind, "webhook");
  assert.equal(rawReceipt.deliveryMode, "full_payload");
  assert.equal(rawReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.equal(Object.hasOwn(rawReceipt, "payload"), false);
  assert.deepEqual(rawReceipt.rawArtifactRoles, ["daily-summary"]);
  assert.equal(rawReceipt.rawArtifactCount, 1);
  assert.equal(Object.hasOwn(payload, "rawIngestReceipts"), false);
  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
  assert.equal(Object.hasOwn(payload.provenance ?? {}, "canonicalWearableRecordCount"), false);
  assert.deepEqual(payload.provenance?.wearableRawReceipt, {
    id: rawReceipt.id,
    deliveryMode: "full_payload",
    payloadHash: rawReceipt.payloadHash,
    sourceKind: "webhook",
  });
});

test("prepareDeviceProviderSnapshotImport preserves timestamp origin semantics on compact facts", async () => {
  const registry = createDeviceProviderRegistry([
    makeTestDeviceProviderAdapter({
      provider: "junction",
      normalizeSnapshot(snapshot): NormalizedDeviceBatch {
        return {
          provider: "junction",
          accountId: "junction-user-1",
          importedAt: "2026-04-22T09:00:00.000Z",
          source: "device",
          events: [{
            kind: "observation",
            occurredAt: "2026-04-22T09:00:00.000Z",
            dayKey: "2026-04-22",
            externalRef: {
              system: "junction",
              resourceType: "junction-withings-body",
              resourceId: "body-2026-04-22",
              facet: "weight",
            },
            dataOrigin: {
              version: 1,
              aggregatorProvider: "junction",
              sourceProviderSlug: "withings",
              sourceType: "scale",
              observedAtRaw: "2026-04-22 17:00:00",
              timeZoneOffsetMinutes: null,
              timestampSemantics: "floating",
              originConfidence: "medium",
              normalizerVersion: "junction-normalizer.v2",
            },
            fields: {
              metric: "weight",
              unit: "kg",
              value: 82.4,
            },
          }],
          evidenceParts: [{
            role: "body-summary",
            fileName: "body-summary.json",
            content: snapshot,
          }],
        };
      },
    }),
  ]);

  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot: {
      body_summary: {
        weight_kg: 82.4,
      },
    },
    connectionId: "conn_junction_01",
    userId: "user_01",
    sourceKind: "poll",
    deliveryMode: "full_payload",
    resourceType: "junction-withings-body",
    resourceId: "body-2026-04-22",
    normalizerVersion: "junction-normalizer.v2",
  } satisfies DeviceProviderSnapshotImportPayload, {
    providerRegistry: registry,
  });

  const eventOrigin = payload.events?.[0]?.dataOrigin;
  const rawReceipt = readRawReceiptArtifact(payload);

  assert.equal(eventOrigin?.aggregatorProvider, "junction");
  assert.equal(eventOrigin?.sourceProviderSlug, "withings");
  assert.equal(eventOrigin?.observedAtRaw, "2026-04-22 17:00:00");
  assert.equal(eventOrigin?.timeZoneOffsetMinutes, null);
  assert.equal(eventOrigin?.timestampSemantics, "floating");
  assert.equal(eventOrigin?.originConfidence, "medium");
  assert.equal(eventOrigin?.normalizerVersion, "junction-normalizer.v2");
  assert.equal(payload.provenance?.normalizerVersion, "junction-normalizer.v2");
  assert.equal(rawReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
});

test("prepareDeviceProviderSnapshotImport keeps raw receipt identity stable across replayed payloads", async () => {
  let importCounter = 0;
  const registry = createDeviceProviderRegistry([
    makeTestDeviceProviderAdapter({
      provider: "polar",
      normalizeSnapshot(snapshot): NormalizedDeviceBatch {
        importCounter += 1;
        return {
          provider: "polar",
          accountId: "polar-user-1",
          importedAt: `2026-04-20T12:00:0${importCounter}.000Z`,
          source: "device",
          events: [{
            kind: "observation",
            occurredAt: "2026-04-20T09:00:00.000Z",
            dayKey: "2026-04-20",
            evidenceRoles: ["daily-summary"],
            fields: {
              metric: "daily-steps",
              unit: "count",
              value: 8123,
            },
          }],
          evidenceParts: [{
            role: "daily-summary",
            fileName: "daily-summary.json",
            content: snapshot,
          }],
        };
      },
    }),
  ]);
  const request = {
    provider: "polar",
    snapshot: {
      daily_summary: {
        steps: 8123,
      },
    },
    accountId: "polar-user-1",
    connectionId: "conn_polar_01",
    resourceType: "daily_summary",
    resourceId: "summary_2026_04_20",
  } satisfies DeviceProviderSnapshotImportPayload;

  const first = await prepareDeviceProviderSnapshotImport(request, { providerRegistry: registry });
  const second = await prepareDeviceProviderSnapshotImport(request, { providerRegistry: registry });
  const firstReceipt = readRawReceiptArtifact(first);
  const secondReceipt = readRawReceiptArtifact(second);

  assert.equal(firstReceipt.id, secondReceipt.id);
  assert.equal(firstReceipt.observedAt, "2026-04-20T09:00:00.000Z");
  assert.equal(secondReceipt.observedAt, "2026-04-20T09:00:00.000Z");
  assert.equal(firstReceipt.payloadHash, secondReceipt.payloadHash);
  assert.equal(first.importedAt, second.importedAt);
  assert.deepEqual(
    first.evidenceParts?.map((artifact) => artifact.fileName),
    second.evidenceParts?.map((artifact) => artifact.fileName),
  );
});

test("pushDeletionObservation bounds deletion artifact names while preserving event content", () => {
  const events: DeviceEventPayload[] = [];
  const evidenceParts: NonNullable<NormalizedDeviceBatch["evidenceParts"]> = [];
  const longResourceType = `${"activity_".repeat(16)}end`;
  const longSourceEventType = `${"webhook.delete.".repeat(12)}end`;

  pushDeletionObservation(events, evidenceParts, {
    makeExternalRef: (resourceType, resourceId, occurredAt, facet) => ({
      facet,
      observedAt: occurredAt,
      resourceId,
      resourceType,
      system: "polar",
    }),
    occurredAt: "2026-04-20T09:00:00.000Z",
    provider: "polar",
    providerDisplayName: "Polar",
    resourceId: "summary_2026_04_20",
    resourceType: longResourceType,
    sourceEventType: longSourceEventType,
  });

  assert.equal(evidenceParts.length, 1);
  assert.ok((evidenceParts[0]?.fileName.length ?? 0) < 160);
  assert.match(evidenceParts[0]?.fileName ?? "", /^deletion-/u);
  assert.equal(
    (evidenceParts[0]?.content as { resourceType?: string } | undefined)?.resourceType,
    longResourceType,
  );
  assert.equal(
    (events[0]?.fields as { sourceEventType?: string } | undefined)?.sourceEventType,
    longSourceEventType,
  );
});
