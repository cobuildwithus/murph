import assert from "node:assert/strict";
import { resolveMetricInputKey } from "@murphai/health-metrics";
import { test } from "vitest";

import {
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
} from "../src/index.ts";

const DAY = "2026-02-01";
const START = `${DAY}T12:00:00.000Z`;
const END = `${DAY}T12:05:00.000Z`;
const TIMESTAMP = `${DAY}T12:02:00.000Z`;
const WORKOUT_END = `${DAY}T12:48:00.000Z`;

function grouped(
  provider: string,
  type: string,
  deviceId: string,
  data: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    groups: {
      [provider]: [{
        data,
        source: {
          device_id: deviceId,
          provider,
          type,
        },
      }],
    },
  };
}

function validActivitySnapshot(): Record<string, unknown> {
  const source = (data: readonly Record<string, unknown>[]) =>
    grouped("apple_health_kit", "watch", "watch-1", data);
  return {
    accountId: "junction-account-activity-1",
    importedAt: "2026-02-02T00:00:00.000Z",
    windowStart: `${DAY}T00:00:00.000Z`,
    windowEnd: "2026-02-02T00:00:00.000Z",
    timeseries: {
      calories_basal: source([
        { end: `${DAY}T12:00:00.000Z`, start: `${DAY}T00:00:00.000Z`, unit: "kcal", value: 700 },
        { end: `${DAY}T23:59:00.000Z`, start: `${DAY}T12:00:00.000Z`, unit: "kcal", value: 750 },
      ]),
      daylight_exposure: source([
        { end: `${DAY}T09:20:00.000Z`, start: `${DAY}T09:00:00.000Z`, unit: "s", value: 1200 },
        { end: `${DAY}T15:25:00.000Z`, start: `${DAY}T15:00:00.000Z`, unit: "s", value: 1500 },
      ]),
      fall: source([{
        end: END,
        id: "fall-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "count",
        value: 1,
      }]),
      floors_climbed: source([
        { end: `${DAY}T10:00:00.000Z`, start: `${DAY}T09:00:00.000Z`, unit: "count", value: 3 },
        { end: `${DAY}T18:00:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "count", value: 5 },
      ]),
      handwashing: source([{
        end: END,
        id: "handwashing-1",
        start: START,
        timestamp: TIMESTAMP,
        unit: "count",
        value: 1,
      }]),
      stand_duration: source([
        { end: `${DAY}T11:30:00.000Z`, start: `${DAY}T11:00:00.000Z`, unit: "seconds", value: 1800 },
        { end: `${DAY}T17:45:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "seconds", value: 2700 },
      ]),
      stand_hour: source([
        { end: `${DAY}T11:00:00.000Z`, start: `${DAY}T10:00:00.000Z`, unit: "count", value: 1 },
        { end: `${DAY}T18:00:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "count", value: 1 },
      ]),
      uv_exposure: source([
        { end: END, id: "uv-1", start: START, timestamp: `${DAY}T12:01:00.000Z`, unit: "index", value: 4 },
        { end: END, id: "uv-2", start: START, timestamp: `${DAY}T12:04:00.000Z`, unit: "index", value: 6 },
      ]),
      wheelchair_push: source([
        { end: `${DAY}T10:00:00.000Z`, start: `${DAY}T09:00:00.000Z`, unit: "count", value: 120 },
        { end: `${DAY}T18:00:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "count", value: 180 },
      ]),
      workout_distance: source([
        { end: END, sport: "running", start: START, timestamp: `${DAY}T12:01:00.000Z`, unit: "m", value: 1200, workout_id: "workout-run-1" },
        { end: END, sport: "running", start: START, timestamp: `${DAY}T12:04:00.000Z`, unit: "m", value: 800, workout_id: "workout-run-1" },
      ]),
      workout_duration: source([{
        end: WORKOUT_END,
        intensity: "medium",
        start: START,
        unit: "seconds",
        value: 2880,
      }]),
      workout_swimming_stroke: source([
        { end: END, sport: "swimming", start: START, timestamp: `${DAY}T12:01:00.000Z`, unit: "count", value: 20, workout_id: "workout-swim-1" },
        { end: END, sport: "swimming", start: START, timestamp: `${DAY}T12:04:00.000Z`, unit: "count", value: 17, workout_id: "workout-swim-1" },
      ]),
    },
  };
}

function observationsByMetric(payload: DeviceBatchImportPayload): Map<string, NonNullable<DeviceBatchImportPayload["events"]>[number]> {
  return new Map((payload.events ?? []).flatMap((event) =>
    event.kind === "observation" && typeof event.fields?.metric === "string"
      ? [[event.fields.metric, event] as const]
      : []
  ));
}

test("Junction activity-resource slice emits bounded daily, hourly, and sparse facts", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-activity-1",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    snapshot: validActivitySnapshot(),
  });
  const observations = observationsByMetric(payload);
  const expected = new Map<string, { unit: string; value: number }>([
    ["basal-calories", { unit: "kcal", value: 1450 }],
    ["daylight-exposure-minutes", { unit: "minutes", value: 45 }],
    ["fall-count", { unit: "count", value: 1 }],
    ["floors-climbed", { unit: "count", value: 8 }],
    ["handwashing-count", { unit: "count", value: 1 }],
    ["stand-duration-minutes", { unit: "minutes", value: 75 }],
    ["stand-hours", { unit: "count", value: 2 }],
    ["uv-exposure-index", { unit: "index", value: 5 }],
    ["wheelchair-push-count", { unit: "count", value: 300 }],
    ["workout-distance-km", { unit: "km", value: 2 }],
    ["workout-minutes", { unit: "minutes", value: 48 }],
    ["swimming-stroke-count", { unit: "count", value: 37 }],
  ]);

  assert.equal(payload.events?.length, expected.size);
  assert.equal(observations.size, expected.size);
  for (const [metric, fact] of expected) {
    const observation = observations.get(metric);
    assert.ok(observation, metric);
    assert.equal(observation.fields?.value, fact.value, metric);
    assert.equal(observation.fields?.unit, fact.unit, metric);
    assert.equal(resolveMetricInputKey(metric), metric, metric);
    assert.ok(observation.externalRef?.resourceId, metric);
    assert.equal(observation.dataOrigin?.sourceProviderSlug, "apple-health-kit", metric);
    assert.equal(observation.dataOrigin?.sourceType, "watch", metric);
    assert.ok(observation.dataOrigin?.sourceInstanceId, metric);
  }
  assert.equal(observations.get("fall-count")?.fields?.observationGrain, "sample");
  const derivedMetrics = new Set([
    "handwashing-count",
    "swimming-stroke-count",
    "uv-exposure-index",
    "workout-distance-km",
    "workout-minutes",
  ]);
  for (const metric of expected.keys()) {
    if (metric === "fall-count") {
      continue;
    }
    assert.equal(
      observations.get(metric)?.fields?.observationGrain,
      derivedMetrics.has(metric) ? "derived_fact" : "summary",
      metric,
    );
  }

  const evidence = payload.evidenceParts ?? [];
  const dailyEvidence = evidence.filter((part) =>
    part.metadata?.resourceCategory === "timeseries_daily_aggregate"
  );
  const featureEvidence = evidence.filter((part) =>
    part.metadata?.resourceCategory === "timeseries_feature_aggregate"
  );
  const fallEvidence = evidence.filter((part) =>
    part.metadata?.resource === "fall"
    && part.metadata?.resourceCategory === "timeseries_reading"
  );
  assert.equal(dailyEvidence.length, 6);
  assert.equal(featureEvidence.length, 5);
  assert.equal(fallEvidence.length, 1);
  assert.ok(dailyEvidence.every((part) =>
    part.metadata?.retentionClass === "provider_evidence"
    && typeof (part.content as Record<string, unknown>).sumValue === "number"
  ));
  assert.ok(featureEvidence.every((part) =>
    part.metadata?.retentionClass === "provider_evidence"
    && (part.content as Record<string, unknown>).bucketKind === "hour"
  ));

  const workoutDistanceEvidence = featureEvidence.find((part) =>
    part.metadata?.resource === "workout_distance"
  )?.content as Record<string, unknown> | undefined;
  assert.equal(workoutDistanceEvidence?.sumValue, 2);

  assert.equal(evidence.some((part) => part.role === "provider-snapshot"), false);
  const retained = JSON.stringify(evidence);
  assert.doesNotMatch(retained, /"groups"|"data"|watch-1/u);
  assert.doesNotMatch(JSON.stringify({ events: payload.events, evidence }), /"[^"\n]*coverage[^"\n]*"/iu);
  assert.equal(payload.ingestReceipt?.rawArtifactCount, evidence.length);
});

test("Junction activity-resource slice fails closed on malformed units and values", () => {
  const source = (data: readonly Record<string, unknown>[]) =>
    grouped("apple_health_kit", "watch", "watch-1", data);
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-02-02T00:00:00.000Z",
    timeseries: {
      calories_basal: source([{ end: END, start: START, unit: "count", value: 700 }]),
      daylight_exposure: source([{ end: END, start: START, unit: "min", value: -1 }]),
      fall: source([{ end: END, start: START, timestamp: TIMESTAMP, unit: "count", value: 0 }]),
      floors_climbed: source([{ end: END, start: START, unit: "count", value: 1.5 }]),
      handwashing: source([{ start: START, timestamp: TIMESTAMP, unit: "minutes", value: 1 }]),
      stand_duration: source([{ end: END, start: START, unit: "count", value: 10 }]),
      stand_hour: source([{ end: END, start: START, unit: "count", value: 1.5 }]),
      uv_exposure: source([{ end: END, start: START, timestamp: TIMESTAMP, unit: "%", value: 5 }]),
      wheelchair_push: source([{ end: END, start: START, unit: "count", value: -1 }]),
      workout_distance: source([{ timestamp: TIMESTAMP, unit: "count", value: 1200 }]),
      workout_duration: source([{ end: START, start: END, timestamp: TIMESTAMP, unit: "count", value: 48 }]),
      workout_swimming_stroke: source([{ end: END, start: START, timestamp: TIMESTAMP, unit: "count", value: 2.5, workout_id: "workout-swim-1" }]),
    },
  });

  assert.deepEqual(payload.events, []);
  assert.ok((payload.evidenceParts ?? []).every((part) => {
    const content = part.content as Record<string, unknown>;
    return content.status === "no_valid_samples"
      && part.metadata?.artifactClass === "compact_provider_timeseries_aggregate";
  }));
  assert.doesNotMatch(JSON.stringify(payload.evidenceParts ?? []), /"groups"|"data"|watch-1/u);
});

test("Junction rejected fall rows do not fall back to retaining provider arrays", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-fall-invalid-1",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    snapshot: {
      importedAt: "2026-02-02T00:00:00.000Z",
      timeseries: {
        fall: grouped("apple_health_kit", "watch", "watch-1", [{
          end: END,
          start: START,
          timestamp: TIMESTAMP,
          unit: "count",
          value: 0,
        }]),
      },
    },
  });

  assert.deepEqual(payload.events, []);
  assert.equal(payload.evidenceParts?.length ?? 0, 0);
  assert.equal(payload.ingestReceipt?.rawArtifactCount, 0);
});

test("Junction fall and workout hourly identities are stable across replay and input ordering", () => {
  const source = (data: readonly Record<string, unknown>[]) =>
    grouped("apple_health_kit", "watch", "watch-1", data);
  const fallRows = [
    { end: END, id: "fall-1", start: START, timestamp: TIMESTAMP, unit: "count", value: 1 },
    { end: END, id: "fall-1", start: START, timestamp: TIMESTAMP, unit: "count", value: 1 },
    { end: END, id: "fall-2", start: START, timestamp: TIMESTAMP, unit: "count", value: 1 },
  ];
  const distanceRows = [
    { end: END, sport: "running", start: START, timestamp: `${DAY}T12:01:00.000Z`, unit: "m", value: 1200, workout_id: "workout-run-1" },
    { end: END, sport: "running", start: START, timestamp: `${DAY}T12:04:00.000Z`, unit: "m", value: 800, workout_id: "workout-run-1" },
  ];
  const build = (falls: readonly Record<string, unknown>[], distances: readonly Record<string, unknown>[]) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-02-02T00:00:00.000Z",
      timeseries: {
        fall: source(falls),
        workout_distance: source(distances),
      },
    });

  const first = build(fallRows, distanceRows);
  const replay = build([...fallRows].reverse(), [...distanceRows].reverse());
  const identity = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .map((event) => ({
      facet: event.externalRef?.facet,
      metric: event.fields?.metric,
      resourceId: event.externalRef?.resourceId,
      value: event.fields?.value,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  assert.deepEqual(identity(first), identity(replay));
  assert.equal(first.events?.filter((event) => event.fields?.metric === "fall-count").length, 2);
  assert.equal(first.events?.filter((event) => event.fields?.metric === "workout-distance-km").length, 1);
  assert.equal(
    first.events?.find((event) => event.fields?.metric === "workout-distance-km")?.fields?.value,
    2,
  );
});
