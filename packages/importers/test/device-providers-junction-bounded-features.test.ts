import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "../src/index.ts";
import {
  JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA,
  JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
  buildJunctionBoundedFeatureIdentity,
  reduceJunctionElectrocardiogramVoltageRecords,
  reduceJunctionWorkoutStreamPayload,
  resolveJunctionBoundedFeatureRecords,
} from "../src/device-providers/junction-bounded-features.ts";

function assertNoSampleSizedValue(value: unknown): void {
  if (Array.isArray(value)) {
    assert.fail("bounded Junction evidence must not contain arrays");
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(
      ["data", "points", "samples", "stream", "timestamps", "heartrate"].includes(key),
      false,
      `bounded Junction evidence retained ${key}`,
    );
    assertNoSampleSizedValue(nested);
  }
}

function ecgSample(
  recordingId: string,
  index: number,
  startMs: number,
): Record<string, unknown> {
  return {
    recordingId,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "watch",
    sourceInstanceId: "watch-1",
    timestamp: new Date(startMs + index * 4).toISOString(),
    type: "lead_i",
    unit: "mV",
    value: ((index % 101) - 50) / 100,
  };
}

function ecgFeature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    schema: JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA,
    id: "ecg-1",
    recordingId: "ecg-1",
    sourceProviderSlug: "apple_health_kit",
    sourceType: "watch",
    sourceInstanceId: "watch-1",
    sessionStart: "2026-07-01T10:00:00.000Z",
    sessionEnd: "2026-07-01T10:01:00.000Z",
    durationSeconds: 60,
    voltageSampleCount: 15_000,
    voltageUnit: "mV",
    voltageMin: -0.4,
    voltageMax: 0.5,
    voltageMean: 0.02,
    voltageRms: 0.18,
    leadType: "lead_i",
    leadCount: 1,
    ...overrides,
  }).filter(([, value]) => value !== undefined));
}

function workoutFeature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    schema: JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
    id: "workout-1",
    workoutId: "workout-1",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "garmin-1",
    startAt: "2026-07-01T12:00:00.000Z",
    endAt: "2026-07-01T12:30:00.000Z",
    durationSeconds: 1_800,
    distanceMeters: 5_000,
    averageHeartRate: 130,
    maxHeartRate: 170,
    sampleCount: 1_000,
    ...overrides,
  }).filter(([, value]) => value !== undefined));
}

test("dense ECG input reduces to O(recordings) neutral events and compact evidence", () => {
  const start = Date.parse("2026-07-01T10:00:00.000Z");
  const samples = [
    ...Array.from({ length: 10_000 }, (_, index) => ecgSample("ecg-1", index, start)),
    ...Array.from({ length: 10_000 }, (_, index) => ecgSample("ecg-2", index, start + 60_000)),
  ];

  const features = reduceJunctionElectrocardiogramVoltageRecords(samples, {
    maxRecordings: 64,
    maxSamples: 100_000,
  });
  const normalized = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-02T00:00:00.000Z",
    timeseries: { electrocardiogram_voltage: features },
  });

  assert.equal(normalized.events?.length, 2);
  assert.equal(normalized.evidenceParts?.length, 2);
  assert.equal(normalized.evidenceParts?.some((part) => part.role === "provider-snapshot"), false);
  for (const part of normalized.evidenceParts ?? []) {
    assertNoSampleSizedValue(part.content);
    const content = part.content as Record<string, unknown>;
    assert.equal(content.schema, JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA);
    assert.equal(content.voltageSampleCount, 10_000);
    assert.equal(content.classification, undefined);
    assert.equal(content.rhythm, undefined);
    assert.equal(Buffer.byteLength(JSON.stringify(content), "utf8") < 16_384, true);
  }
  for (const event of normalized.events ?? []) {
    assert.equal(event.kind, "measurement");
    assert.equal(event.title, "Junction ECG");
    const measurements = event.fields?.measurements as Array<Record<string, unknown>> | undefined;
    const metricNames = (measurements ?? []).map((measurement) => measurement.metric);
    assert.deepEqual(metricNames, ["ecg-voltage-sample-count"]);
  }
});

test("raw receipt retention accepts only pre-reduced dense features", async () => {
  const start = Date.parse("2026-07-01T10:00:00.000Z");
  const rawSamples = [
    ...Array.from({ length: 10_000 }, (_, index) => ecgSample("ecg-1", index, start)),
    ...Array.from({ length: 10_000 }, (_, index) => ecgSample("ecg-2", index, start + 60_000)),
  ];
  assert.throws(() => normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { electrocardiogram_voltage: rawSamples },
  }), /feature was invalid/u);

  const features = reduceJunctionElectrocardiogramVoltageRecords(rawSamples, {
    maxRecordings: 64,
    maxSamples: 100_000,
  });
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-07-02T00:00:00.000Z",
      timeseries: {
        electrocardiogram_voltage: features,
        workout_stream: [workoutFeature()],
      },
    },
  });

  assert.equal(payload.evidenceParts?.some((part) => part.role === "provider-snapshot"), false);
  assert.equal(payload.events?.length, 3);
  const retained = JSON.stringify(payload.evidenceParts);
  assert.doesNotMatch(retained, /"(?:samples|points|stream|timestamps|heartrate)"\s*:/u);
  const featureParts = (payload.evidenceParts ?? []).filter((part) => {
    const content = part.content as Record<string, unknown> | undefined;
    return content?.schema === JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA
      || content?.schema === JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA;
  });
  assert.equal(featureParts.length, 3);
  for (const part of featureParts) {
    assertNoSampleSizedValue(part.content);
    assert.equal(Buffer.byteLength(JSON.stringify(part.content), "utf8") < 16_384, true);
  }
});

test("workout stream reduction is bounded by admitted samples and never preserves points", () => {
  const sampleCount = 20_000;
  const feature = reduceJunctionWorkoutStreamPayload({
    maxSamples: sampleCount,
    summary: {
      id: "workout-1",
      source: { provider: "garmin", type: "watch", device_id: "garmin-1" },
      start: "2026-07-01T12:00:00.000Z",
      end: "2026-07-01T12:30:00.000Z",
      sport: "run",
      updated_at: "2026-07-01T13:00:00.000Z",
    },
    stream: {
      time: Array.from({ length: sampleCount }, (_, index) => 1_783_000_000 + index),
      heartrate: Array.from({ length: sampleCount }, (_, index) => 80 + index % 101),
      distance: Array.from({ length: sampleCount }, (_, index) => index / 4),
    },
  });

  assert.equal(feature.schema, JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA);
  assert.equal(feature.sampleCount, sampleCount);
  assert.equal(feature.maxHeartRate, 180);
  assertNoSampleSizedValue(feature);

  assert.throws(() => reduceJunctionWorkoutStreamPayload({
    maxSamples: 1,
    summary: {
      id: "workout-1",
      sourceProviderSlug: "garmin",
      startAt: "2026-07-01T12:00:00.000Z",
      endAt: "2026-07-01T12:00:01.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_001],
      heartrate: [100, 100],
    },
  }), /1-1 timestamps/u);
});

test("workout features compose with the existing activity-session owner and correction identity", () => {
  const first = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { workout_stream: [workoutFeature()] },
  });
  const correction = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T01:00:00.000Z",
    timeseries: {
      workout_stream: [workoutFeature({
        averageHeartRate: 135,
        distanceMeters: 5_100,
      })],
    },
  });
  const replay = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { workout_stream: [workoutFeature(), workoutFeature()] },
  });

  const firstEvent = first.events?.[0];
  const correctionEvent = correction.events?.[0];
  assert.equal(first.events?.length, 1);
  assert.equal(first.evidenceParts?.length, 1);
  assert.equal(replay.events?.length, 1);
  assert.equal(replay.evidenceParts?.length, 1);
  assert.equal(firstEvent?.kind, "activity_session");
  const firstWorkout = firstEvent?.fields?.workout as Record<string, unknown> | undefined;
  assert.deepEqual(firstWorkout?.metrics, {
    averageHeartRate: 130,
    maxHeartRate: 170,
  });
  assert.equal(firstEvent?.externalRef?.resourceId, correctionEvent?.externalRef?.resourceId);
  assert.equal(first.evidenceParts?.some((part) => part.role === "provider-snapshot"), false);
  assertNoSampleSizedValue(first.evidenceParts?.[0]?.content);
});

test("bounded features reuse existing ECG and workout summary identities", () => {
  const summaries = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    summaries: {
      electrocardiogram: [{
        id: "ecg-1",
        sourceProviderSlug: "apple_health_kit",
        sourceInstanceId: "watch-1",
        sourceType: "watch",
        sessionStart: "2026-07-01T10:00:00.000Z",
        voltageSampleCount: 14_500,
        heartRateMean: 64,
        classification: "sinus_rhythm",
      }],
      workouts: [{
        id: "workout-1",
        sourceProviderSlug: "garmin",
        sourceInstanceId: "garmin-1",
        sourceType: "watch",
        startAt: "2026-07-01T12:00:00.000Z",
        endAt: "2026-07-01T12:30:00.000Z",
        sport: "run",
        activeCalories: 320,
        averagePowerWatts: 215,
      }],
    },
  });
  const features = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T01:00:00.000Z",
    timeseries: {
      electrocardiogram_voltage: [ecgFeature()],
      workout_stream: [workoutFeature()],
    },
  });

  const summaryEcg = summaries.events?.find((event) => event.kind === "measurement");
  const featureEcg = features.events?.find((event) => event.kind === "measurement");
  const summaryWorkout = summaries.events?.find((event) => event.kind === "activity_session");
  const featureWorkout = features.events?.find((event) => event.kind === "activity_session");
  assert.equal(summaryEcg?.externalRef?.resourceId, featureEcg?.externalRef?.resourceId);
  assert.equal(summaryWorkout?.externalRef?.resourceId, featureWorkout?.externalRef?.resourceId);
});

test("stable ECG recording ids own correction identity without diagnostic synthesis", () => {
  const first = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { electrocardiogram_voltage: [ecgFeature()] },
  });
  const correction = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T01:00:00.000Z",
    timeseries: { electrocardiogram_voltage: [ecgFeature({
      voltageMean: 0.03,
      voltageRms: 0.19,
    })] },
  });

  assert.equal(first.events?.[0]?.externalRef?.resourceId, correction.events?.[0]?.externalRef?.resourceId);
  assert.equal(JSON.stringify(first.events).includes("classification"), false);
  assert.equal(JSON.stringify(first.events).includes("rhythm"), false);
});

test("bounded feature identity requires workout ids and conflicts fail closed", () => {
  const idless = workoutFeature({
    id: undefined,
    workoutId: undefined,
  });
  assert.throws(
    () => buildJunctionBoundedFeatureIdentity("workout_stream", idless),
    /lacked identity/u,
  );

  assert.throws(() => resolveJunctionBoundedFeatureRecords("workout_stream", [
    workoutFeature(),
    workoutFeature({ distanceMeters: 5_100 }),
  ]), /conflicting feature/u);
  assert.throws(() => resolveJunctionBoundedFeatureRecords("electrocardiogram_voltage", [
    ecgFeature(),
    ecgFeature({ voltageMean: 0.03 }),
  ]), /conflicting feature/u);

  assert.throws(() => resolveJunctionBoundedFeatureRecords("workout_stream", [
    workoutFeature(),
    workoutFeature({ workoutId: "workout-2" }),
  ]), /conflicting stable identifiers/u);

  assert.throws(() => resolveJunctionBoundedFeatureRecords("workout_stream", [
    workoutFeature({ rawPointEnvelope: { 0: { heartRate: 120 } } }),
  ]), /feature was invalid/u);
});
