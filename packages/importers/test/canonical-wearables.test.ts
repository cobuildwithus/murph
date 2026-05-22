import assert from "node:assert/strict";

import { test } from "vitest";
import { normalizeWearableMetricValue } from "../src/device-providers/metric-catalog.ts";
import { pushDeletionObservation } from "../src/device-providers/shared-normalization.ts";

import {
  canonicalizeDeviceBatchPayload,
  createDeviceProviderRegistry,
  prepareDeviceProviderSnapshotImport,
  resolveWearableCanonicalMetricKey,
  resolveWearableMetricTolerance,
  type DeviceDataOrigin,
  type DeviceEventPayload,
  type DeviceProviderAdapter,
  type DeviceProviderSnapshotImportPayload,
  type NormalizedDeviceBatch,
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

test("canonicalizeDeviceBatchPayload preserves hashed account identity and maps sleep-stage samples", () => {
  const records = canonicalizeDeviceBatchPayload({
    provider: "oura",
    accountId: "oura-user-1",
    importedAt: "2026-04-20T12:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-04-20T12:00:00.000Z",
      dayKey: "2026-04-20",
      rawArtifactRoles: ["daily-activity"],
      fields: {
        metric: "daily-steps",
        unit: "count",
        value: 12345,
      },
    }],
    samples: [
      {
        stream: "heart_rate",
        unit: "bpm",
        dayKey: "2026-04-20",
        sample: {
          occurredAt: "2026-04-20T02:00:00.000Z",
          value: 56,
        },
      },
      {
        stream: "sleep_stage",
        unit: "minutes",
        dayKey: "2026-04-20",
        sample: {
          occurredAt: "2026-04-20T02:15:00.000Z",
          stage: "deep",
          durationMinutes: 95,
        },
      },
    ],
  }, {
    connectionId: "conn_01",
    normalizerVersion: "test-normalizer.v1",
    observedAt: "2026-04-20T12:05:00.000Z",
  });

  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.kind), ["observation", "sample", "sample"]);
  assert.deepEqual(records.map((record) => {
    switch (record.kind) {
      case "observation":
      case "sample":
        return record.metric;
      case "session":
        return record.sessionKind;
      case "tombstone":
        return "tombstone";
    }
  }), ["steps", "averageHeartRate", "deepMinutes"]);
  assert.ok(records.every((record) => !("accountId" in record.source)));
  assert.ok(records.every((record) => record.source.providerAccountIdHash?.length === 24));
  assert.ok(records.every((record) => record.source.dataSourceId.startsWith("wearable_source_")));
});

test("canonicalizeDeviceBatchPayload separates Junction upstream origins without changing externalRef system", () => {
  const baseOrigin = {
    version: 1,
    aggregatorProvider: "junction",
    sourceProviderSlug: "oura",
    sourceType: "ring",
    sourceInstanceId: "source-oura-ring-a",
  } satisfies DeviceDataOrigin;
  const events: DeviceEventPayload[] = [
    {
      kind: "observation",
      occurredAt: "2026-04-21T06:00:00.000Z",
      dayKey: "2026-04-21",
      externalRef: {
        system: "junction",
        resourceType: "junction-oura-sleep",
        resourceId: "junction-sleep-1",
        facet: "sleep-score",
      },
      dataOrigin: {
        ...baseOrigin,
        observedAtRaw: "2026-04-21T06:00:00+00:00",
        timeZoneOffsetMinutes: 0,
        timestampSemantics: "offset",
        originConfidence: "high",
        normalizerVersion: "junction-normalizer.v1",
      },
      fields: {
        metric: "sleep-score",
        unit: "score",
        value: 82,
      },
    },
    {
      kind: "observation",
      occurredAt: "2026-04-21T06:05:00.000Z",
      dayKey: "2026-04-21",
      externalRef: {
        system: "junction",
        resourceType: "junction-oura-sleep",
        resourceId: "junction-sleep-2",
        facet: "sleep-score",
      },
      dataOrigin: {
        ...baseOrigin,
        sourceInstanceId: "source-oura-ring-b",
      },
      fields: {
        metric: "sleep-score",
        unit: "score",
        value: 79,
      },
    },
    {
      kind: "observation",
      occurredAt: "2026-04-21T17:00:00.000Z",
      dayKey: "2026-04-21",
      externalRef: {
        system: "junction",
        resourceType: "junction-oura-workout",
        resourceId: "junction-workout-1",
        facet: "steps",
      },
      dataOrigin: {
        ...baseOrigin,
      },
      fields: {
        metric: "daily-steps",
        unit: "count",
        value: 6400,
      },
    },
    {
      kind: "observation",
      occurredAt: "2026-04-21T18:00:00.000Z",
      dayKey: "2026-04-21",
      externalRef: {
        system: "junction",
        resourceType: "junction-oura-sleep",
        resourceId: "junction-sleep-3",
        facet: "sleep-score",
      },
      dataOrigin: {
        ...baseOrigin,
        sourceInstanceId: "source-oura-ring-companion",
      },
      fields: {
        metric: "sleep-score",
        unit: "score",
        value: 84,
      },
    },
    {
      kind: "observation",
      occurredAt: "2026-04-21T19:00:00.000Z",
      dayKey: "2026-04-21",
      externalRef: {
        system: "junction",
        resourceType: "junction-withings-body",
        resourceId: "junction-body-1",
        facet: "weight",
      },
      dataOrigin: {
        version: 1,
        aggregatorProvider: "junction",
        sourceProviderSlug: "withings",
        sourceType: "scale",
        sourceInstanceId: "source-withings-scale-a",
        timestampSemantics: "utc",
        normalizerVersion: "junction-normalizer.v1",
      },
      fields: {
        metric: "weight",
        unit: "kg",
        value: 82.4,
      },
    },
  ];

  const records = canonicalizeDeviceBatchPayload({
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-21T18:00:00.000Z",
    events,
  }, {
    connectionId: "conn_junction_01",
    normalizerVersion: "junction-normalizer.v1",
    observedAt: "2026-04-21T18:05:00.000Z",
  });

  assert.equal(records.length, 5);
  assert.ok(records.every((record) => record.source.provider === "junction"));
  assert.ok(records.every((record) => record.source.externalRef?.system === "junction"));
  assert.deepEqual(records.map((record) => record.source.externalRef?.resourceType), [
    "junction-oura-sleep",
    "junction-oura-sleep",
    "junction-oura-workout",
    "junction-oura-sleep",
    "junction-withings-body",
  ]);
  assert.equal(records[0]?.source.origin?.sourceProviderSlug, "oura");
  assert.equal(records[0]?.source.origin?.version, 1);
  assert.equal(records[0]?.source.origin?.sourceInstanceId, "source-oura-ring-a");
  assert.equal(records[0]?.source.origin?.observedAtRaw, "2026-04-21T06:00:00+00:00");
  assert.equal(records[0]?.source.origin?.timeZoneOffsetMinutes, 0);
  assert.equal(records[0]?.source.origin?.timestampSemantics, "offset");
  assert.equal(records[0]?.source.origin?.originConfidence, "high");
  assert.equal(records[0]?.source.origin?.normalizerVersion, "junction-normalizer.v1");
  assert.equal(records[4]?.source.origin?.sourceProviderSlug, "withings");
  assert.ok(records.every((record) => !record.source.externalRef?.resourceType.includes(":")));
  assert.notEqual(records[0]?.source.dataSourceId, records[1]?.source.dataSourceId);
  assert.equal(records[0]?.source.dataSourceId, records[2]?.source.dataSourceId);
  assert.notEqual(records[0]?.source.dataSourceId, records[3]?.source.dataSourceId);
  assert.notEqual(records[0]?.source.dataSourceId, records[4]?.source.dataSourceId);

  const serializedTransportFields = JSON.stringify(records.map((record) => ({
    id: record.id,
    providerResourceId: record.source.providerResourceId,
    providerResourceType: record.source.providerResourceType,
    externalRef: record.source.externalRef,
  })));
  assert.ok(!serializedTransportFields.includes("source-oura-ring-a"));
  assert.ok(!serializedTransportFields.includes("source-oura-ring-b"));
  assert.ok(!serializedTransportFields.includes("source-oura-ring-companion"));
  assert.ok(!serializedTransportFields.includes("source-withings-scale-a"));
});

test("canonicalizeDeviceBatchPayload keys Junction data sources by upstream source provider slug", () => {
  const records = canonicalizeDeviceBatchPayload({
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-22T12:00:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-04-22T06:00:00.000Z",
        dayKey: "2026-04-22",
        externalRef: {
          system: "junction",
          resourceType: "junction-oura-sleep",
          resourceId: "junction-summary-oura",
          facet: "steps",
        },
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "oura",
          sourceType: "cloud-provider",
        },
        fields: {
          metric: "daily-steps",
          unit: "count",
          value: 7200,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-22T06:00:00.000Z",
        dayKey: "2026-04-22",
        externalRef: {
          system: "junction",
          resourceType: "junction-withings-activity",
          resourceId: "junction-summary-withings",
          facet: "steps",
        },
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "withings",
          sourceType: "cloud-provider",
        },
        fields: {
          metric: "daily-steps",
          unit: "count",
          value: 7100,
        },
      },
    ],
  }, {
    connectionId: "conn_junction_01",
    normalizerVersion: "junction-normalizer.v1",
    observedAt: "2026-04-22T12:05:00.000Z",
  });

  assert.equal(records.length, 2);
  assert.equal(records[0]?.source.provider, "junction");
  assert.equal(records[1]?.source.provider, "junction");
  assert.equal(records[0]?.source.connectionId, "conn_junction_01");
  assert.equal(records[1]?.source.connectionId, "conn_junction_01");
  assert.equal(records[0]?.source.providerAccountIdHash, records[1]?.source.providerAccountIdHash);
  assert.equal(records[0]?.source.origin?.aggregatorProvider, "junction");
  assert.equal(records[1]?.source.origin?.aggregatorProvider, "junction");
  assert.equal(records[0]?.source.origin?.sourceProviderSlug, "oura");
  assert.equal(records[1]?.source.origin?.sourceProviderSlug, "withings");
  assert.notEqual(records[0]?.source.dataSourceId, records[1]?.source.dataSourceId);
  assert.ok(records.every((record) => record.source.externalRef?.system === "junction"));
  assert.deepEqual(records.map((record) => record.source.externalRef?.resourceType), [
    "junction-oura-sleep",
    "junction-withings-activity",
  ]);
  assert.ok(records.every((record) => !record.source.externalRef?.resourceType.includes(":")));
});

test("canonicalizeDeviceBatchPayload preserves sample origins and falls back from sparse record origins", () => {
  const payloadOrigin = {
    version: 1,
    aggregatorProvider: "junction",
    sourceProviderSlug: "oura",
    sourceType: "ring",
    observedAtRaw: "2026-04-22T07:00:00+00:00",
    timeZoneOffsetMinutes: 0,
    timestampSemantics: "offset",
    originConfidence: "high",
    normalizerVersion: "junction-normalizer.v1",
  } satisfies DeviceDataOrigin;
  const records = canonicalizeDeviceBatchPayload({
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-22T12:00:00.000Z",
    dataOrigin: payloadOrigin,
    samples: [
      {
        stream: "heart_rate",
        unit: "bpm",
        dayKey: "2026-04-22",
        externalRef: {
          system: "junction",
          resourceType: "junction-oura-heartrate",
          resourceId: "junction-hr-1",
        },
        dataOrigin: {
          version: 1,
        },
        sample: {
          occurredAt: "2026-04-22T07:00:00.000Z",
          value: 54,
        },
      },
      {
        stream: "sleep_stage",
        unit: "minutes",
        dayKey: "2026-04-22",
        externalRef: {
          system: "junction",
          resourceType: "junction-oura-sleep",
          resourceId: "junction-sleep-stage-1",
          facet: "deep",
        },
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          sourceInstanceId: "source-oura-ring-stage",
          observedAtRaw: "2026-04-22 07:15:00",
          timeZoneOffsetMinutes: null,
          timestampSemantics: "floating",
          originConfidence: "medium",
          normalizerVersion: "junction-normalizer.v1",
        },
        sample: {
          occurredAt: "2026-04-22T07:15:00.000Z",
          stage: "deep",
          durationMinutes: 22,
        },
      },
    ],
  }, {
    connectionId: "conn_junction_01",
    normalizerVersion: "junction-normalizer.v1",
    observedAt: "2026-04-22T12:05:00.000Z",
  });

  assert.equal(records.length, 2);
  assert.equal(records[0]?.kind, "sample");
  assert.equal(records[0]?.source.origin?.sourceProviderSlug, "oura");
  assert.equal(records[0]?.source.origin?.observedAtRaw, "2026-04-22T07:00:00+00:00");
  assert.equal(records[0]?.source.origin?.timestampSemantics, "offset");
  assert.equal(records[0]?.source.origin?.originConfidence, "high");
  assert.equal(records[1]?.kind, "sample");
  assert.equal(records[1]?.source.origin?.sourceInstanceId, "source-oura-ring-stage");
  assert.equal(records[1]?.source.origin?.observedAtRaw, "2026-04-22 07:15:00");
  assert.equal(records[1]?.source.origin?.timeZoneOffsetMinutes, null);
  assert.equal(records[1]?.source.origin?.timestampSemantics, "floating");
  assert.equal(records[1]?.source.origin?.originConfidence, "medium");
});

test("wearable metric normalization converts energy-burned to total calories and preserves WHOOP workout metrics", () => {
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

  const records = canonicalizeDeviceBatchPayload({
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-04-20T12:00:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "energy-burned",
          unit: "kJ",
          value: 418.4,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "max-heart-rate",
          unit: "bpm",
          value: 168,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "workout-strain",
          unit: "whoop_strain",
          value: 11.1,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "percent-recorded",
          unit: "%",
          value: 99,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "altitude-gain",
          unit: "meter",
          value: 42,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-04-20T18:00:00.000Z",
        dayKey: "2026-04-20",
        fields: {
          metric: "altitude-change",
          unit: "meter",
          value: 33,
        },
      },
    ],
  });

  const observationMetrics = records
    .filter((record) => record.kind === "observation")
    .map((record) => ({
      metric: record.metric,
      unit: record.unit,
      value: record.value,
    }));

  assert.deepEqual(observationMetrics, [
    {
      metric: "totalCalories",
      unit: "kcal",
      value: 100,
    },
    {
      metric: "maxHeartRate",
      unit: "bpm",
      value: 168,
    },
    {
      metric: "workoutStrain",
      unit: "whoop_strain",
      value: 11.1,
    },
    {
      metric: "percentRecorded",
      unit: "%",
      value: 99,
    },
    {
      metric: "totalElevationGainMeters",
      unit: "meter",
      value: 42,
    },
    {
      metric: "altitudeChangeMeters",
      unit: "meter",
      value: 33,
    },
  ]);
});

test("prepareDeviceProviderSnapshotImport emits raw receipts and in-memory canonical wearable records", async () => {
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
            rawArtifactRoles: ["daily-summary"],
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
          rawArtifacts: [{
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

  const rawReceipt = payload.rawIngestReceipts?.[0];
  const canonicalRecords = payload.canonicalWearableRecords ?? [];

  assert.ok(rawReceipt);
  assert.equal(rawReceipt?.connectionId, "conn_polar_01");
  assert.equal(rawReceipt?.sourceKind, "webhook");
  assert.equal(rawReceipt?.deliveryMode, "full_payload");
  assert.equal(rawReceipt?.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.equal(Object.hasOwn(rawReceipt, "payload"), false);
  assert.deepEqual(rawReceipt?.rawArtifactRoles, ["daily-summary"]);
  assert.equal(rawReceipt?.rawArtifactCount, 1);
  assert.equal(canonicalRecords.length, 1);
  assert.equal(canonicalRecords[0]?.kind, "observation");
  assert.equal(canonicalRecords[0] && "metric" in canonicalRecords[0] ? canonicalRecords[0].metric : null, "steps");
  assert.equal(canonicalRecords[0]?.source.origin?.version, 1);
  assert.equal(canonicalRecords[0]?.source.origin?.sourceProviderSlug, "polar");
  assert.equal(canonicalRecords[0]?.source.origin?.sourceInstanceId, "source-polar-watch-1");
  assert.equal(canonicalRecords[0]?.source.rawReceiptId, rawReceipt?.id);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === `wearable-raw-receipt:${rawReceipt?.id}`));
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-canonical-records:")),
    false,
  );
});

test("prepareDeviceProviderSnapshotImport preserves timestamp origin semantics in canonical provenance", async () => {
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
          rawArtifacts: [{
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

  const recordOrigin = payload.canonicalWearableRecords?.[0]?.source.origin;
  assert.equal(payload.canonicalWearableRecords?.[0]?.source.normalizerVersion, "junction-normalizer.v2");
  assert.equal(recordOrigin?.aggregatorProvider, "junction");
  assert.equal(recordOrigin?.sourceProviderSlug, "withings");
  assert.equal(recordOrigin?.observedAtRaw, "2026-04-22 17:00:00");
  assert.equal(recordOrigin?.timeZoneOffsetMinutes, null);
  assert.equal(recordOrigin?.timestampSemantics, "floating");
  assert.equal(recordOrigin?.originConfidence, "medium");
  assert.equal(recordOrigin?.normalizerVersion, "junction-normalizer.v2");
  assert.equal(payload.provenance?.normalizerVersion, "junction-normalizer.v2");

  const rawReceipt = payload.rawIngestReceipts?.[0];
  assert.ok(rawReceipt);
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-canonical-records:")),
    false,
  );
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
            rawArtifactRoles: ["daily-summary"],
            fields: {
              metric: "daily-steps",
              unit: "count",
              value: 8123,
            },
          }],
          rawArtifacts: [{
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
  const firstReceipt = first.rawIngestReceipts?.[0];
  const secondReceipt = second.rawIngestReceipts?.[0];

  assert.ok(firstReceipt);
  assert.ok(secondReceipt);
  assert.equal(firstReceipt.id, secondReceipt.id);
  assert.equal(firstReceipt.observedAt, "2026-04-20T09:00:00.000Z");
  assert.equal(secondReceipt.observedAt, "2026-04-20T09:00:00.000Z");
  assert.equal(first.importedAt, second.importedAt);
  assert.deepEqual(
    first.rawArtifacts?.map((artifact) => artifact.fileName),
    second.rawArtifacts?.map((artifact) => artifact.fileName),
  );
});

test("pushDeletionObservation bounds deletion artifact names while preserving event content", () => {
  const events: DeviceEventPayload[] = [];
  const rawArtifacts: NonNullable<NormalizedDeviceBatch["rawArtifacts"]> = [];
  const longResourceType = `${"activity_".repeat(16)}end`;
  const longSourceEventType = `${"webhook.delete.".repeat(12)}end`;

  pushDeletionObservation(events, rawArtifacts, {
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

  assert.equal(rawArtifacts.length, 1);
  assert.ok((rawArtifacts[0]?.fileName.length ?? 0) < 160);
  assert.match(rawArtifacts[0]?.fileName ?? "", /^deletion-/u);
  assert.equal(
    (rawArtifacts[0]?.content as { resourceType?: string } | undefined)?.resourceType,
    longResourceType,
  );
  assert.equal(
    (events[0]?.fields as { sourceEventType?: string } | undefined)?.sourceEventType,
    longSourceEventType,
  );
});
