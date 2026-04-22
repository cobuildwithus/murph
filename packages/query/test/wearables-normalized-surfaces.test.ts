import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  explainWearableDrift,
  summarizeWearableLatest,
  summarizeWearableMetricLatest,
  summarizeWearableMetricTrend,
} from "../src/wearables.ts";

function makeEntity(
  overrides: Partial<CanonicalEntity> & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    entityId: overrides.entityId,
    primaryLookupId: overrides.primaryLookupId ?? overrides.entityId,
    lookupIds: overrides.lookupIds ?? [overrides.entityId],
    family: overrides.family,
    recordClass: overrides.recordClass,
    kind: overrides.kind,
    status: overrides.status ?? null,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    path: overrides.path ?? `ledger/events/${overrides.entityId}.jsonl`,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    attributes: overrides.attributes ?? {},
    frontmatter: overrides.frontmatter ?? null,
    links: overrides.links ?? [],
    relatedIds: overrides.relatedIds ?? [],
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    tags: overrides.tags ?? [],
  };
}

function makeObservation(input: {
  entityId: string;
  metric: string;
  value: number;
  unit: string;
  dayKey: string;
  occurredAt: string;
  recordedAt: string;
  provider?: string;
  resourceType?: string;
  path?: string;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "observation",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    path: input.path ?? `ledger/events/2026/${input.entityId}.jsonl`,
    title: `${input.provider ?? "oura"} ${input.metric}`,
    attributes: {
      dayKey: input.dayKey,
      recordedAt: input.recordedAt,
      metric: input.metric,
      value: input.value,
      unit: input.unit,
      externalRef: {
        system: input.provider ?? "oura",
        resourceType: input.resourceType ?? "summary",
        resourceId: `${input.entityId}-resource`,
      },
    },
  });
}

function makeVault(entities: readonly CanonicalEntity[]) {
  return createVaultReadModel({
    entities,
    metadata: null,
    vaultRoot: "/virtual/wearables-normalized",
  });
}

test("latest and metric-latest surfaces stay structured and respect dayKey semantics", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_rhr_01",
      metric: "resting-heart-rate",
      value: 57,
      unit: "bpm",
      dayKey: "2026-04-01",
      occurredAt: "2026-04-01T06:00:00Z",
      recordedAt: "2026-04-01T06:15:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_02",
      metric: "resting-heart-rate",
      value: 55,
      unit: "bpm",
      dayKey: "2026-04-02",
      occurredAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:10:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_03",
      metric: "resting-heart-rate",
      value: 52,
      unit: "bpm",
      dayKey: "2026-04-03",
      occurredAt: "2026-04-03T06:00:00Z",
      recordedAt: "2026-04-03T06:10:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_04",
      metric: "resting-heart-rate",
      value: 50,
      unit: "bpm",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-03T23:30:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
      path: "ledger/events/2026/rhr-latest.jsonl",
    }),
    makeObservation({
      entityId: "evt_temp_03",
      metric: "temperature-deviation",
      value: 0.4,
      unit: "celsius",
      dayKey: "2026-04-03",
      occurredAt: "2026-04-03T06:00:00Z",
      recordedAt: "2026-04-03T06:20:00Z",
    }),
    makeObservation({
      entityId: "evt_temp_04",
      metric: "temperature-deviation",
      value: 0.2,
      unit: "celsius",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-03T23:30:00Z",
      recordedAt: "2026-04-04T06:15:00Z",
    }),
  ]);

  const latest = summarizeWearableLatest(vault);
  const rhr = summarizeWearableMetricLatest(vault, "rhr", { windowDays: 2 });
  const skinTemp = summarizeWearableMetricLatest(vault, "skin-temp", { windowDays: 2 });

  assert.equal(latest?.latestDate, "2026-04-04");
  assert.equal(latest?.day.date, "2026-04-04");
  assert.equal(latest?.recovery?.restingHeartRate.selection.value, 50);
  assert.deepEqual(latest?.providers, ["oura"]);

  assert.equal(rhr?.metric, "restingHeartRate");
  assert.equal(rhr?.requestedMetric, "rhr");
  assert.equal(rhr?.resolvedAlias, "rhr");
  assert.equal(rhr?.date, "2026-04-04");
  assert.equal(rhr?.provider, "oura");
  assert.equal(rhr?.unit, "bpm");
  assert.equal(rhr?.value, 50);
  assert.equal(rhr?.recordedAt, "2026-04-04T06:05:00Z");
  assert.deepEqual(rhr?.recordIds, ["evt_rhr_04"]);
  assert.deepEqual(rhr?.paths, ["ledger/events/2026/rhr-latest.jsonl"]);
  assert.deepEqual(rhr?.recentWindow, {
    average: 51,
    count: 2,
    from: "2026-04-03",
    max: 52,
    min: 50,
    to: "2026-04-04",
  });
  assert.deepEqual(rhr?.priorWindow, {
    average: 56,
    count: 2,
    from: "2026-04-01",
    max: 57,
    min: 55,
    to: "2026-04-02",
  });
  assert.equal(rhr?.delta, -5);
  assert.equal(rhr?.percentChange, -8.93);
  assert.equal(rhr?.confidence.level, "high");

  assert.equal(skinTemp?.metric, "temperatureDeviation");
  assert.equal(skinTemp?.resolvedAlias, "skin-temp");
  assert.equal(skinTemp?.value, 0.2);
});

test("metric-trend and drift surfaces return compact structured bundles", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_rhr_01",
      metric: "resting-heart-rate",
      value: 58,
      unit: "bpm",
      dayKey: "2026-04-01",
      occurredAt: "2026-04-01T06:00:00Z",
      recordedAt: "2026-04-01T06:15:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_02",
      metric: "resting-heart-rate",
      value: 55,
      unit: "bpm",
      dayKey: "2026-04-02",
      occurredAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:10:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_03",
      metric: "resting-heart-rate",
      value: 53,
      unit: "bpm",
      dayKey: "2026-04-03",
      occurredAt: "2026-04-03T06:00:00Z",
      recordedAt: "2026-04-03T06:10:00Z",
    }),
    makeObservation({
      entityId: "evt_rhr_04",
      metric: "resting-heart-rate",
      value: 51,
      unit: "bpm",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
    }),
    makeObservation({
      entityId: "evt_temp_01",
      metric: "temperature-deviation",
      value: 0.6,
      unit: "celsius",
      dayKey: "2026-04-01",
      occurredAt: "2026-04-01T06:00:00Z",
      recordedAt: "2026-04-01T06:12:00Z",
    }),
    makeObservation({
      entityId: "evt_temp_02",
      metric: "temperature-deviation",
      value: 0.3,
      unit: "celsius",
      dayKey: "2026-04-02",
      occurredAt: "2026-04-02T06:00:00Z",
      recordedAt: "2026-04-02T06:12:00Z",
    }),
    makeObservation({
      entityId: "evt_temp_03",
      metric: "temperature-deviation",
      value: 0.2,
      unit: "celsius",
      dayKey: "2026-04-03",
      occurredAt: "2026-04-03T06:00:00Z",
      recordedAt: "2026-04-03T06:12:00Z",
    }),
    makeObservation({
      entityId: "evt_temp_04",
      metric: "temperature-deviation",
      value: 0.1,
      unit: "celsius",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:12:00Z",
    }),
  ]);

  const trend = summarizeWearableMetricTrend(vault, "restingHeartRate", { windowDays: 2 });
  const drift = explainWearableDrift(vault, { windowDays: 2 });

  assert.equal(trend?.metric, "restingHeartRate");
  assert.equal(trend?.points.length, 2);
  assert.deepEqual(trend?.points.map((point) => point.date), ["2026-04-04", "2026-04-03"]);
  assert.deepEqual(trend?.points.map((point) => point.value), [51, 53]);

  assert.equal(drift?.windowDays, 2);
  assert.equal(drift?.latest.latestDate, "2026-04-04");
  assert.equal(drift?.signals.length, 10);
  assert.equal(
    drift?.signals.some((signal) => signal.metric === "restingHeartRate" && signal.value === 51),
    true,
  );
  assert.equal(
    drift?.signals.some((signal) => signal.metric === "temperatureDeviation" && signal.value === 0.1),
    true,
  );
  assert.equal(
    drift?.signals.some((signal) => signal.metric === "recoveryScore" && signal.value === null),
    true,
  );
  assert.equal(
    drift?.notes.some((note) => note.includes("Compared recent and prior 2-day wearable windows")),
    true,
  );
});

test("normalized wearable surfaces honor provider filters before selecting latest values", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_oura_rhr_04",
      metric: "resting-heart-rate",
      value: 50,
      unit: "bpm",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
      provider: "oura",
    }),
    makeObservation({
      entityId: "evt_oura_temp_04",
      metric: "temperature-deviation",
      value: 0.2,
      unit: "celsius",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:10:00Z",
      provider: "oura",
    }),
    makeObservation({
      entityId: "evt_whoop_rhr_04",
      metric: "resting-heart-rate",
      value: 60,
      unit: "bpm",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
      provider: "whoop",
    }),
    makeObservation({
      entityId: "evt_whoop_rhr_05",
      metric: "resting-heart-rate",
      value: 61,
      unit: "bpm",
      dayKey: "2026-04-05",
      occurredAt: "2026-04-05T06:00:00Z",
      recordedAt: "2026-04-05T06:05:00Z",
      provider: "whoop",
    }),
    makeObservation({
      entityId: "evt_whoop_temp_05",
      metric: "temperature-deviation",
      value: 0.6,
      unit: "celsius",
      dayKey: "2026-04-05",
      occurredAt: "2026-04-05T06:00:00Z",
      recordedAt: "2026-04-05T06:10:00Z",
      provider: "whoop",
    }),
  ]);

  const latest = summarizeWearableLatest(vault, { providers: ["oura"] });
  const metricLatest = summarizeWearableMetricLatest(vault, "rhr", {
    providers: ["whoop"],
    windowDays: 1,
  });
  const metricTrend = summarizeWearableMetricTrend(vault, "rhr", {
    providers: ["whoop"],
    windowDays: 2,
  });
  const drift = explainWearableDrift(vault, {
    providers: ["whoop"],
    windowDays: 1,
  });

  assert.equal(latest?.latestDate, "2026-04-04");
  assert.equal(latest?.day.date, "2026-04-04");
  assert.deepEqual(latest?.providers, ["oura"]);
  assert.equal(latest?.recovery?.restingHeartRate.selection.provider, "oura");
  assert.equal(latest?.recovery?.restingHeartRate.selection.value, 50);

  assert.equal(metricLatest?.date, "2026-04-05");
  assert.equal(metricLatest?.provider, "whoop");
  assert.equal(metricLatest?.value, 61);
  assert.deepEqual(metricLatest?.recordIds, ["evt_whoop_rhr_05"]);

  assert.deepEqual(
    metricTrend?.points.map((point) => ({
      date: point.date,
      provider: point.provider,
      value: point.value,
    })),
    [
      {
        date: "2026-04-05",
        provider: "whoop",
        value: 61,
      },
      {
        date: "2026-04-04",
        provider: "whoop",
        value: 60,
      },
    ],
  );

  assert.equal(drift?.latest.latestDate, "2026-04-05");
  assert.deepEqual(drift?.latest.providers, ["whoop"]);
  assert.equal(
    drift?.signals.some(
      (signal) =>
        signal.metric === "restingHeartRate"
        && signal.provider === "whoop"
        && signal.value === 61,
    ),
    true,
  );
});
