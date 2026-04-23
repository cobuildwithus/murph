import assert from "node:assert/strict";

import { test } from "vitest";
import { normalizeWearableMetricValue } from "../src/device-providers/metric-catalog.ts";

import {
  canonicalizeDeviceBatchPayload,
  createDeviceProviderRegistry,
  prepareDeviceProviderSnapshotImport,
  resolveWearableCanonicalMetricKey,
  resolveWearableMetricTolerance,
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
  assert.equal(resolveWearableCanonicalMetricKey("energy-burned"), "activeCalories");
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

test("wearable metric normalization converts energy-burned and preserves WHOOP workout metrics", () => {
  assert.deepEqual(
    normalizeWearableMetricValue("energy-burned", 418.4, "kJ"),
    {
      key: "activeCalories",
      unit: "kcal",
      value: 100,
    },
  );
  assert.equal(
    normalizeWearableMetricValue("energy-burned", 418.4, null),
    null,
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
      metric: "activeCalories",
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

test("prepareDeviceProviderSnapshotImport emits raw envelopes and canonical wearable artifacts", async () => {
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

  const rawEnvelope = payload.rawIngestEnvelopes?.[0];
  const canonicalRecords = payload.canonicalWearableRecords ?? [];

  assert.ok(rawEnvelope);
  assert.equal(rawEnvelope?.connectionId, "conn_polar_01");
  assert.equal(rawEnvelope?.sourceKind, "webhook");
  assert.equal(rawEnvelope?.deliveryMode, "full_payload");
  assert.equal(canonicalRecords.length, 1);
  assert.equal(canonicalRecords[0]?.kind, "observation");
  assert.equal(canonicalRecords[0] && "metric" in canonicalRecords[0] ? canonicalRecords[0].metric : null, "steps");
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === `wearable-raw-envelope:${rawEnvelope?.id}`));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === `wearable-canonical-records:${rawEnvelope?.id}`));
});
