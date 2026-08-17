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

function assertNoSampleSizedValue(value: unknown, splitArray = false): void {
  if (Array.isArray(value)) {
    assert.equal(splitArray, true, "bounded Junction evidence retained a raw array");
    assert.equal(value.length <= 64, true);
    for (const entry of value) {
      assertNoSampleSizedValue(entry);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(
      [
        "data", "points", "samples", "stream", "timestamps", "heartrate",
        "heart_rate", "distance", "cadence", "power", "velocity_smooth",
        "lat", "latitude", "lng", "longitude",
      ].includes(key),
      false,
      `bounded Junction evidence retained ${key}`,
    );
    assertNoSampleSizedValue(nested, key === "splits");
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
    splits: [],
    version: "2026-07-01T13:00:00.000Z",
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
  }), /exceeded its feature cardinality/u);

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
      time_start: "2026-07-01T12:00:00.000Z",
      time_end: "2026-07-01T12:30:00.000Z",
      sport: "run",
      updated_at: "2026-07-01T13:00:00.000Z",
    },
    stream: {
      time: Array.from({ length: sampleCount }, (_, index) => 1_783_000_000 + index),
      heartrate: Array.from({ length: sampleCount }, (_, index) => 80 + index % 101),
      cadence: Array.from({ length: sampleCount }, (_, index) => 160 + index % 21),
      distance: Array.from({ length: sampleCount }, (_, index) => index / 4),
      power: Array.from({ length: sampleCount }, (_, index) => 150 + index % 101),
      velocity_smooth: Array.from({ length: sampleCount }, (_, index) => 2 + index % 3),
    },
  });

  assert.ok(feature);
  assert.equal(feature.schema, JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA);
  assert.equal(feature.sampleCount, sampleCount);
  assert.equal(feature.maxHeartRate, 180);
  assert.equal(feature.maxCadence, 180);
  assert.equal(feature.cadenceUnit, "steps-per-minute");
  assert.equal(feature.maxPower, 250);
  assert.equal(feature.maxSpeed, 4);
  assert.equal((feature.splits as unknown[]).length, 4);
  assert.equal(feature.startAt, "2026-07-01T12:00:00.000Z");
  assert.equal(feature.endAt, "2026-07-01T12:30:00.000Z");
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

test("workout stream reduction preserves heart-rate halves and cycling cadence semantics", () => {
  const feature = reduceJunctionWorkoutStreamPayload({
    maxSamples: 4,
    summary: {
      id: "ride-1",
      sourceProviderSlug: "garmin",
      sport: "road_cycling",
      updated_at: "2026-07-01T13:00:00.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_010, 1_783_000_070, 1_783_000_100],
      heart_rate: [100, 120, 160, 180],
      cadence: [80, 90, 100, 110],
      power: [200, 220, 260, 300],
      velocity_smooth: [5, 6, 7, 8],
    },
  });
  assert.ok(feature);

  assert.equal(feature.averageHeartRate, 140);
  assert.equal(feature.maxHeartRate, 180);
  assert.equal(feature.firstHalfAverageHeartRate, 110);
  assert.equal(feature.secondHalfAverageHeartRate, 170);
  assert.equal(feature.averageCadence, 95);
  assert.equal(feature.maxCadence, 110);
  assert.equal(feature.cadenceUnit, "rpm");
  assert.equal(feature.averagePower, 245);
  assert.equal(feature.maxPower, 300);
  assert.equal(feature.averageSpeed, 6.5);
  assert.equal(feature.maxSpeed, 8);
});

test("workout stream splits interpolate fixed boundaries and omit partial starts", () => {
  const run = reduceJunctionWorkoutStreamPayload({
    maxSamples: 10,
    summary: {
      id: "run-1",
      sourceProviderSlug: "garmin",
      sport: "running",
      updated_at: "2026-07-01T13:00:00.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_100, 1_783_000_200, 1_783_000_300],
      distance: [200, 900, 1_100, 2_100],
      heartrate: [100, 120, 140, 160],
      cadence: [160, 170, 180, 190],
      power: [200, 220, 240, 260],
      lat: [41.88, 41.8805, 41.881, 41.8815],
      lng: [-87.63, -87.6295, -87.629, -87.6285],
    },
  });
  assert.ok(run);
  const runSplits = run.splits as Array<Record<string, unknown>>;

  assert.equal(runSplits.length, 1);
  assert.equal(runSplits[0]?.index, 2);
  assert.equal(runSplits[0]?.distanceMeters, 1_000);
  assert.equal(runSplits[0]?.durationSeconds, 140);
  assert.equal(runSplits[0]?.averageHeartRate, 140);
  assert.equal(runSplits[0]?.averageCadence, 180);
  assert.equal(runSplits[0]?.cadenceUnit, "steps-per-minute");
  assert.equal(runSplits[0]?.averagePower, 240);
  assertNoSampleSizedValue(run);

  const swim = reduceJunctionWorkoutStreamPayload({
    maxSamples: 4,
    summary: {
      id: "swim-1",
      sourceProviderSlug: "garmin",
      sport: "pool_swimming",
      updated_at: "2026-07-01T14:00:00.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_060, 1_783_000_120],
      distance: [0, 100, 200],
      heartrate: [100, 110, 120],
    },
  });
  assert.ok(swim);
  assert.deepEqual(
    (swim.splits as Array<Record<string, unknown>>).map((split) => [
      split.index,
      split.distanceMeters,
      split.durationSeconds,
    ]),
    [[1, 100, 60], [2, 100, 60]],
  );

  const capped = reduceJunctionWorkoutStreamPayload({
    maxSamples: 66,
    summary: {
      id: "long-run-1",
      sourceProviderSlug: "garmin",
      sport: "running",
      updated_at: "2026-07-01T15:00:00.000Z",
    },
    stream: {
      time: Array.from({ length: 66 }, (_, index) => 1_783_000_000 + index * 300),
      distance: Array.from({ length: 66 }, (_, index) => index * 1_000),
      heartrate: Array.from({ length: 66 }, () => 130),
    },
  });
  assert.ok(capped);
  assert.equal((capped.splits as unknown[]).length, 64);
  assertNoSampleSizedValue(capped);
});

test("workout features normalize rich compact metrics and split measurements", () => {
  const normalized = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: {
      workout_stream: [workoutFeature({
        firstHalfAverageHeartRate: 125,
        secondHalfAverageHeartRate: 135,
        averageCadence: 174,
        maxCadence: 188,
        cadenceUnit: "steps-per-minute",
        averagePower: 220,
        maxPower: 310,
        averageSpeed: 3.2,
        maxSpeed: 4.7,
        splits: [{
          index: 1,
          distanceMeters: 1_000,
          durationSeconds: 300,
          endedAt: "2026-07-01T12:05:00.000Z",
          averageHeartRate: 128,
          averageCadence: 172,
          cadenceUnit: "steps-per-minute",
          averagePower: 215,
        }],
      })],
    },
  });

  assert.deepEqual(normalized.events?.[0]?.fields?.measurements, [
    { metric: "workout-minutes", unit: "minutes", value: 30 },
    { metric: "workout-distance-km", unit: "km", value: 5 },
    { metric: "average-heart-rate", unit: "bpm", value: 130 },
    { metric: "max-heart-rate", unit: "bpm", value: 170 },
    { metric: "first-half-average-workout-heart-rate", unit: "bpm", value: 125 },
    { metric: "second-half-average-workout-heart-rate", unit: "bpm", value: 135 },
    {
      metric: "average-workout-cadence",
      unit: "steps-per-minute",
      value: 174,
    },
    { metric: "max-workout-cadence", unit: "steps-per-minute", value: 188 },
    { metric: "average-workout-power", unit: "watt", value: 220 },
    { metric: "max-workout-power", unit: "watt", value: 310 },
    { metric: "average-workout-speed", unit: "mps", value: 3.2 },
    { metric: "max-workout-speed", unit: "mps", value: 4.7 },
  ]);
  assert.deepEqual(normalized.events?.[1]?.fields?.measurements, [
    { metric: "workout-split-duration", unit: "seconds", value: 300 },
    { metric: "workout-split-distance", unit: "meter", value: 1_000 },
    { metric: "average-workout-split-heart-rate", unit: "bpm", value: 128 },
    {
      metric: "average-workout-split-cadence",
      unit: "steps-per-minute",
      value: 172,
    },
    { metric: "average-workout-split-power", unit: "watt", value: 215 },
  ]);
  assertNoSampleSizedValue(normalized.evidenceParts?.[0]?.content);
});

test("newer workout features authoritatively withdraw omitted split facets", () => {
  const split = {
    index: 1,
    distanceMeters: 1_000,
    durationSeconds: 300,
    endedAt: "2026-07-01T12:05:00.000Z",
    averageHeartRate: 130,
    averageCadence: 174,
    cadenceUnit: "steps-per-minute",
    averagePower: 220,
  };
  const first = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { workout_stream: [workoutFeature({ splits: [split] })] },
  });
  const correction = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T01:00:00.000Z",
    timeseries: {
      workout_stream: [workoutFeature({
        splits: [],
        version: "2026-07-01T14:00:00.000Z",
      })],
    },
  });

  assert.equal(first.events?.length, 2);
  assert.equal(first.events?.[1]?.externalRef?.facet, "workout-stream-split-1");
  assert.deepEqual(first.authoritativeEventSets?.[0]?.facetPrefixes, [
    "workout-stream-feature",
    "workout-stream-split",
  ]);
  assert.deepEqual(first.authoritativeEventSets?.[0]?.currentFacets, [
    "workout-stream-feature",
    "workout-stream-split-1",
  ]);
  assert.deepEqual(correction.authoritativeEventSets?.[0]?.currentFacets, [
    "workout-stream-feature",
  ]);
  assert.equal(
    first.authoritativeEventSets?.[0]?.resourceId,
    correction.authoritativeEventSets?.[0]?.resourceId,
  );
  assert.equal(correction.authoritativeEventSets?.[0]?.version, "2026-07-01T14:00:00.000Z");
});

test("workout stream reduction skips a record when any present metric has invalid cardinality", () => {
  const completeHeartRateOnlyFeature = reduceJunctionWorkoutStreamPayload({
    maxSamples: 3,
    summary: {
      id: "workout-1",
      sourceProviderSlug: "garmin",
      startAt: "2026-07-01T12:00:00.000Z",
      endAt: "2026-07-01T12:00:02.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_001, 1_783_000_002],
      heartrate: [100, 110, 120],
    },
  });
  assert.ok(completeHeartRateOnlyFeature);
  assert.equal(completeHeartRateOnlyFeature.averageHeartRate, 110);
  assert.equal(completeHeartRateOnlyFeature.maxHeartRate, 120);
  assert.equal(completeHeartRateOnlyFeature.distanceMeters, undefined);

  const malformedDistanceFeature = reduceJunctionWorkoutStreamPayload({
    maxSamples: 3,
    summary: {
      id: "workout-1",
      sourceProviderSlug: "garmin",
      startAt: "2026-07-01T12:00:00.000Z",
      endAt: "2026-07-01T12:00:02.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_001, 1_783_000_002],
      heartrate: [100, 110, 120],
      distance: [0, 10],
    },
  });
  assert.equal(malformedDistanceFeature, undefined);

  const malformedHeartRateFeature = reduceJunctionWorkoutStreamPayload({
    maxSamples: 3,
    summary: {
      id: "workout-1",
      sourceProviderSlug: "garmin",
      startAt: "2026-07-01T12:00:00.000Z",
      endAt: "2026-07-01T12:00:02.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_001, 1_783_000_002],
      heartrate: [100, 110],
      distance: [0, 10, 20],
    },
  });
  assert.equal(malformedHeartRateFeature, undefined);

  assert.throws(() => reduceJunctionWorkoutStreamPayload({
    maxSamples: 3,
    summary: {
      id: "workout-1",
      sourceProviderSlug: "garmin",
      startAt: "2026-07-01T12:00:00.000Z",
      endAt: "2026-07-01T12:00:02.000Z",
    },
    stream: {
      time: [1_783_000_000, 1_783_000_001, 1_783_000_002],
      cadence: [80, 82, 84],
    },
  }), /no supported metrics/u);
});

test("workout features use one independent compact measurement correction identity", () => {
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
        startAt: "2026-07-01T12:05:00.000Z",
        endAt: "2026-07-01T12:35:00.000Z",
      })],
    },
  });
  const replay = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { workout_stream: [workoutFeature(), workoutFeature()] },
  });
  const distinct = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T02:00:00.000Z",
    timeseries: {
      workout_stream: [workoutFeature({
        id: "workout-2",
        workoutId: "workout-2",
        startAt: "2026-07-01T12:05:00.000Z",
        endAt: "2026-07-01T12:35:00.000Z",
      })],
    },
  });

  const firstEvent = first.events?.[0];
  const correctionEvent = correction.events?.[0];
  assert.equal(first.events?.length, 1);
  assert.equal(first.evidenceParts?.length, 1);
  assert.equal(replay.events?.length, 1);
  assert.equal(replay.evidenceParts?.length, 1);
  assert.equal(firstEvent?.kind, "measurement");
  assert.deepEqual(firstEvent?.fields?.measurements, [
    { metric: "workout-minutes", unit: "minutes", value: 30 },
    { metric: "workout-distance-km", unit: "km", value: 5 },
    { metric: "average-heart-rate", unit: "bpm", value: 130 },
    { metric: "max-heart-rate", unit: "bpm", value: 170 },
  ]);
  assert.equal(firstEvent?.externalRef?.resourceId, correctionEvent?.externalRef?.resourceId);
  assert.notEqual(firstEvent?.externalRef?.resourceId, distinct.events?.[0]?.externalRef?.resourceId);
  assert.equal(first.evidenceParts?.some((part) => part.role === "provider-snapshot"), false);
  assertNoSampleSizedValue(first.evidenceParts?.[0]?.content);
});

test("bounded features cannot replace complete ECG and workout summaries", () => {
  const normalized = normalizeJunctionSnapshot({
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
    timeseries: {
      electrocardiogram_voltage: [ecgFeature()],
      workout_stream: [workoutFeature()],
    },
  });

  const measurements = normalized.events?.filter((event) => event.kind === "measurement") ?? [];
  const summaryEcg = measurements.find((event) => event.title?.includes("sinus rhythm"));
  const featureEcg = measurements.find((event) => event.title === "Junction ECG");
  const summaryWorkout = normalized.events?.find((event) => event.kind === "activity_session");
  const featureWorkout = measurements.find(
    (event) => event.title === "Junction workout stream features",
  );
  assert.notEqual(summaryEcg?.externalRef?.resourceId, featureEcg?.externalRef?.resourceId);
  assert.notEqual(summaryWorkout?.externalRef?.resourceId, featureWorkout?.externalRef?.resourceId);
  const workout = summaryWorkout?.fields?.workout as Record<string, unknown> | undefined;
  const workoutMetrics = workout?.metrics as Record<string, unknown> | undefined;
  assert.equal(workoutMetrics?.activeCalories, 320);
  assert.equal(workoutMetrics?.averagePowerWatts, 215);
});

test("stable ECG recording ids own correction identity without diagnostic synthesis", () => {
  const first = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T00:00:00.000Z",
    timeseries: { electrocardiogram_voltage: [ecgFeature()] },
  });
  const correction = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T01:00:00.000Z",
    timeseries: { electrocardiogram_voltage: [ecgFeature({
      sessionStart: "2026-07-01T10:05:00.000Z",
      sessionEnd: "2026-07-01T10:06:00.000Z",
      voltageMean: 0.03,
      voltageRms: 0.19,
    })] },
  });
  const distinct = normalizeJunctionSnapshot({
    importedAt: "2026-07-02T02:00:00.000Z",
    timeseries: { electrocardiogram_voltage: [ecgFeature({
      id: "ecg-2",
      recordingId: "ecg-2",
      sessionStart: "2026-07-01T10:05:00.000Z",
      sessionEnd: "2026-07-01T10:06:00.000Z",
    })] },
  });

  assert.equal(first.events?.[0]?.externalRef?.resourceId, correction.events?.[0]?.externalRef?.resourceId);
  assert.notEqual(first.events?.[0]?.externalRef?.resourceId, distinct.events?.[0]?.externalRef?.resourceId);
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
  assert.notEqual(
    buildJunctionBoundedFeatureIdentity("workout_stream", workoutFeature()),
    buildJunctionBoundedFeatureIdentity(
      "workout_stream",
      workoutFeature({ sourceInstanceId: "garmin-2" }),
    ),
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

  assert.throws(() => resolveJunctionBoundedFeatureRecords("workout_stream", [
    workoutFeature({ sport: { slug: "run" } }),
  ]), /feature was invalid/u);
  assert.throws(() => resolveJunctionBoundedFeatureRecords("workout_stream", [
    workoutFeature({ sampleCount: 100_001 }),
  ]), /feature was invalid/u);
  assert.throws(() => resolveJunctionBoundedFeatureRecords(
    "workout_stream",
    Array.from({ length: 33 }, (_, index) => workoutFeature({
      id: `workout-${index}`,
      workoutId: `workout-${index}`,
    })),
  ), /feature cardinality/u);
  assert.throws(() => resolveJunctionBoundedFeatureRecords(
    "electrocardiogram_voltage",
    Array.from({ length: 65 }, (_, index) => ecgFeature({
      id: `ecg-${index}`,
      recordingId: `ecg-${index}`,
    })),
  ), /feature cardinality/u);
});
