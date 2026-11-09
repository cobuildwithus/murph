import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coreRuntime from "@murphai/core";
import { resolveMetricInputKey } from "@murphai/health-metrics";
import { test } from "vitest";

import {
  importDeviceProviderSnapshot,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
} from "../src/index.ts";

const DAY = "2026-02-01";
const START = `${DAY}T12:00:00.000Z`;
const END = `${DAY}T12:05:00.000Z`;
const TIMESTAMP = `${DAY}T12:02:00.000Z`;
const WORKOUT_END = `${DAY}T12:48:00.000Z`;

test("Junction activity summary evidence roles follow record identity across ordering and corrections", () => {
  for (const explicitId of [true, false]) {
    const records = [
      { provider: "garmin", type: "watch", device_id: "watch-a" },
      { provider: "garmin", type: "watch", device_id: "watch-b" },
      { provider: "garmin", type: "phone", device_id: "watch-a" },
      { provider: "fitbit", type: "watch", device_id: "watch-a" },
    ].map((source, index) => ({
      ...(explicitId ? { id: "shared-record-id" } : {}),
      date: DAY,
      source,
      steps: 1000 + index,
    }));
    const normalize = (activity: typeof records) => normalizeJunctionSnapshot({
      importedAt: "2026-02-02T00:00:00.000Z",
      summaries: { activity },
    });
    const first = normalize(records);
    const reordered = normalize([...records].reverse().map((record) => ({ ...record, steps: record.steps + 10 })));
    assert.equal(first.evidenceParts?.length, records.length);
    assert.equal(new Set(first.evidenceParts?.map((part) => part.role)).size, records.length);
    assert.deepEqual(
      first.evidenceParts?.map((part) => part.role).sort(),
      reordered.evidenceParts?.map((part) => part.role).sort(),
    );
    for (const payload of [first, reordered]) {
      assert.equal(payload.events?.length, records.length);
      for (const event of payload.events ?? []) {
        const role = `junction-summary-activity:${event.externalRef?.resourceId}`;
        assert.deepEqual(event.evidenceRoles, [role]);
        const content = payload.evidenceParts?.find((part) => part.role === role)?.content as Record<string, unknown>;
        assert.equal(content.steps, event.fields?.value);
        assert.equal(content.sourceProviderSlug, event.dataOrigin?.sourceProviderSlug);
        assert.equal(content.sourceType, event.dataOrigin?.sourceType);
        assert.equal(content.sourceInstanceId, event.dataOrigin?.sourceInstanceId);
      }
    }
    assert.doesNotMatch(JSON.stringify(first.evidenceParts), /watch-a|watch-b|device_id/u);
  }
});

test("Junction activity evidence splits envelopes and preserves resolved connection provenance", () => {
  for (const collectionKey of ["data", "results", "items", "records"]) {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-02-04T00:00:00.000Z",
      connections: [{
        id: "private-connection",
        source: { provider: "garmin", type: "watch", device_id: "private-device" },
      }],
      summaries: {
        activity: {
          connectionId: "private-connection",
          [collectionKey]: [
            { date: "2026-02-01", steps: 1000 },
            { date: "2026-02-02", steps: 2000 },
            { date: "2026-02-03", unrecognizedActivityField: 42 },
          ],
        },
      },
    });
    assert.equal(payload.events?.length, 2);
    assert.equal(payload.evidenceParts?.length, 3);
    const rawOnly = payload.evidenceParts?.find((part) =>
      (part.content as Record<string, unknown>).date === "2026-02-03"
    );
    assert.equal((rawOnly?.content as Record<string, unknown>).unrecognizedActivityField, 42);
    for (const part of payload.evidenceParts ?? []) {
      const content = part.content as Record<string, unknown>;
      assert.equal(content.sourceProviderSlug, "garmin");
      assert.equal(content.sourceType, "watch");
      assert.equal(content.sourceInstanceId, payload.events?.[0]?.dataOrigin?.sourceInstanceId);
      assert.equal(Object.hasOwn(content, collectionKey), false);
    }
    assert.doesNotMatch(JSON.stringify(payload.evidenceParts), /private-connection|private-device|connectionId|device_id/u);
  }
});

test("Junction three-day activity replay stores only the changed record and keeps audit evidence resolvable", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-activity-records-"));
  const importActivity = (importedAt: string, steps: number) =>
    importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>({
      provider: "junction",
      vaultRoot,
      snapshot: {
        accountId: "junction-activity-record-account",
        importedAt,
        windowStart: "2026-02-01T00:00:00.000Z",
        windowEnd: "2026-02-04T00:00:00.000Z",
        summaries: {
          activity: {
            source: { provider: "garmin", type: "watch", device_id: "watch-a" },
            data: [
              { date: "2026-02-01", steps: 1000 },
              { date: "2026-02-02", steps },
              { date: "2026-02-03", steps: 3000 },
            ],
          },
        },
      },
    }, { corePort: coreRuntime });
  try {
    await coreRuntime.initializeVault({ vaultRoot, createdAt: "2026-02-01T00:00:00.000Z" });
    const first = await importActivity("2026-02-04T00:00:00.000Z", 2000);
    const changed = await importActivity("2026-02-04T01:00:00.000Z", 2500);
    assert.equal(first.persistedEvidencePartCount, 3);
    assert.equal(changed.persistedEvidencePartCount, 1);
    assert.equal(changed.events.length, 3);
    assert.ok(changed.ingestId);
    const ingest = await coreRuntime.readIntegrationIngestById(vaultRoot, changed.ingestId);
    assert.ok(ingest);
    assert.equal(ingest.record.parts.length, 1);
    assert.equal(JSON.parse(ingest.record.parts[0]!.content).date, "2026-02-02");
    for (const event of changed.events) {
      const history = await coreRuntime.listIntegrationIngestsForEvent(vaultRoot, event.id);
      const contents = history.flatMap(({ record }) => {
        const output = record.outputs.events.find((candidate) => candidate.id === event.id);
        return (output?.roles ?? []).map((role) => {
          const part = record.parts.find((candidate) => candidate.role === role);
          assert.ok(part);
          return JSON.parse(part.content) as Record<string, unknown>;
        });
      });
      assert.ok(contents.length > 0);
      assert.ok(contents.every((content) => content.date === event.dayKey));
    }
    const replay = await importActivity("2026-02-04T02:00:00.000Z", 2500);
    assert.equal(replay.applied, false);
    assert.equal(replay.ingestId, null);
    assert.equal(replay.persistedEvidencePartCount, 0);
    assert.ok(first.ingestShardPath);
    assert.equal((await coreRuntime.readJsonlRecords({
      vaultRoot,
      relativePath: first.ingestShardPath,
    })).length, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

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
        { end: `${DAY}T11:30:00.000Z`, start: `${DAY}T11:00:00.000Z`, unit: "milliseconds", value: 1_800_000 },
        { end: `${DAY}T17:45:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "milliseconds", value: 2_700_000 },
      ]),
      stand_hour: source([
        { end: `${DAY}T11:00:00.000Z`, start: `${DAY}T10:00:00.000Z`, unit: "count", value: 1 },
        { end: `${DAY}T18:00:00.000Z`, start: `${DAY}T17:00:00.000Z`, unit: "count", value: 1 },
        { end: "2026-02-02T00:00:00.000Z", start: `${DAY}T23:00:00.000Z`, unit: "count", value: 1 },
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
        unit: "minutes",
        value: 48,
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
    ["stand-hours", { unit: "count", value: 3 }],
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
