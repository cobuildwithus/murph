import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, type DeviceDataOrigin } from "@murphai/contracts";
import { normalizeJunctionSnapshot } from "@murphai/importers";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildMetricProjection } from "../src/metrics/projection.ts";
import { createVaultReadModel, listEntities, readVault } from "../src/model.ts";
import { searchVaultRuntime } from "../src/query-projection.ts";
import { searchVault } from "../src/search.ts";
import {
  explainWearableDrift,
  summarizeWearableLatest,
  summarizeWearableMetricLatest,
  summarizeWearableMetricTrend,
  summarizeWearableSourceHealth,
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
  dataOrigin?: DeviceDataOrigin;
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
      ...(input.dataOrigin ? { dataOrigin: input.dataOrigin } : {}),
    },
  });
}

function makeActivitySession(input: {
  activityType?: string;
  endAt?: string;
  entityId: string;
  facet?: string | null;
  dayKey: string;
  durationMinutes: number;
  occurredAt?: string;
  recordedAt: string;
  provider?: string;
  dataOrigin?: DeviceDataOrigin;
  heartRateZones?: Array<{
    durationMinutes: number;
    label?: string;
    maxHeartRate?: number;
    minHeartRate?: number;
    zone?: number;
  }>;
  path?: string;
  resourceId?: string | null;
  resourceType?: string;
  startAt?: string;
  title?: string;
  workoutMetrics?: {
    activeCalories?: number;
    distanceKm?: number;
    maxHeartRate?: number;
    totalElevationGainMeters?: number;
    workoutStrain?: number;
  };
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "activity_session",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    path: input.path ?? `ledger/events/2026/${input.entityId}.jsonl`,
    title: input.title ?? `${input.provider ?? "garmin"} activity session`,
    attributes: {
      ...(input.activityType ? { activityType: input.activityType } : {}),
      dayKey: input.dayKey,
      durationMinutes: input.durationMinutes,
      ...(input.endAt ? { endAt: input.endAt } : {}),
      recordedAt: input.recordedAt,
      ...(input.startAt ? { startAt: input.startAt } : {}),
      externalRef: {
        facet: input.facet ?? null,
        system: input.provider ?? "garmin",
        resourceType: input.resourceType ?? "activity_session",
        resourceId: input.resourceId === undefined
          ? `${input.entityId}-resource`
          : input.resourceId,
      },
      ...(input.dataOrigin ? { dataOrigin: input.dataOrigin } : {}),
      ...(input.heartRateZones || input.workoutMetrics
        ? {
            workout: {
              ...(input.heartRateZones ? { heartRateZones: input.heartRateZones } : {}),
              ...(input.workoutMetrics ? { metrics: input.workoutMetrics } : {}),
            },
          }
        : {}),
    },
  });
}

function makeSleepSession(input: {
  entityId: string;
  dayKey: string;
  durationMinutes: number;
  occurredAt: string;
  recordedAt: string;
  startAt: string;
  endAt: string;
  provider?: string;
  path?: string;
  title?: string;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "sleep_session",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    path: input.path ?? `ledger/events/2026/${input.entityId}.jsonl`,
    title: input.title ?? `${input.provider ?? "oura"} overnight sleep`,
    attributes: {
      dayKey: input.dayKey,
      durationMinutes: input.durationMinutes,
      endAt: input.endAt,
      recordedAt: input.recordedAt,
      startAt: input.startAt,
      externalRef: {
        system: input.provider ?? "oura",
        resourceType: "sleep_session",
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

function makeVaultFromJunctionSnapshot(snapshot: Parameters<typeof normalizeJunctionSnapshot>[0]) {
  const payload = normalizeJunctionSnapshot(snapshot);
  const events = (payload.events ?? []).map((event, index) =>
    makeEntity({
      entityId: `evt_junction_${index}`,
      family: "event",
      kind: event.kind,
      recordClass: "ledger",
      occurredAt: event.occurredAt,
      date: event.dayKey ?? null,
      title: event.title ?? null,
      attributes: {
        dayKey: event.dayKey,
        recordedAt: event.recordedAt,
        timeZone: event.timeZone,
        source: event.source,
        externalRef: event.externalRef,
        dataOrigin: event.dataOrigin,
        ...(event.fields ?? {}),
      },
    })
  );
  const samples = (payload.samples ?? []).map((sample, index) =>
    makeEntity({
      entityId: `sample_junction_${index}`,
      family: "sample",
      kind: sample.stream,
      recordClass: "ledger",
      occurredAt: sample.sample.occurredAt ?? sample.sample.startAt ?? sample.recordedAt ?? null,
      date: sample.dayKey ?? null,
      stream: sample.stream,
      title: sample.stream,
      attributes: {
        dayKey: sample.dayKey,
        recordedAt: sample.recordedAt,
        timeZone: sample.timeZone,
        source: sample.source,
        quality: sample.quality,
        unit: sample.unit,
        externalRef: sample.externalRef,
        dataOrigin: sample.dataOrigin,
        ...sample.sample,
      },
    })
  );

  return makeVault([...events, ...samples]);
}

test("Junction Oura lowest sleep heart rate backs resting-heart-rate biomarker projection", () => {
  const vault = makeVaultFromJunctionSnapshot({
    importedAt: "2026-06-05T12:00:00.000Z",
    summaries: {
      sleep: [{
        source: {
          provider: "oura",
          type: "ring",
        },
        id: "oura-sleep-without-explicit-rhr",
        calendar_date: "2026-06-05",
        bedtime_start: "2026-06-05T02:00:00+00:00",
        bedtime_stop: "2026-06-05T10:00:00+00:00",
        duration: 28800,
        total: 25200,
        hr_lowest: 45,
        hr_average: 50,
        average_hrv: 40,
        respiratory_rate: 14,
      }],
    },
  });

  const latestSleep = summarizeWearableLatest(vault)?.sleep;
  const latestRecovery = summarizeWearableLatest(vault)?.recovery;
  const projection = buildMetricProjection(vault);
  const restingHeartRatePoints = projection.metricPoints.filter((point) =>
    point.metricKey === "resting-heart-rate"
  );

  assert.equal(latestSleep?.lowestHeartRate.selection.value, 45);
  assert.equal(latestRecovery?.restingHeartRate.selection.value, 45);
  assert.equal(latestRecovery?.restingHeartRate.selection.resolution, "fallback");
  assert.equal(latestRecovery?.restingHeartRate.selection.fallbackFromMetric, "lowestHeartRate");
  assert.deepEqual(restingHeartRatePoints.map((point) => point.value), [45]);
  assert.equal(restingHeartRatePoints[0]?.source.kind, "wearable-summary");
  assert.equal(restingHeartRatePoints[0]?.biomarkerKey, "biomarker:resting-heart-rate");
});

test("Junction Oura explicit resting heart rate takes precedence over lowest sleep heart rate", () => {
  const vault = makeVaultFromJunctionSnapshot({
    importedAt: "2026-06-05T12:00:00.000Z",
    summaries: {
      sleep: [{
        source: {
          provider: "oura",
          type: "ring",
        },
        id: "oura-sleep-with-explicit-rhr",
        calendar_date: "2026-06-05",
        bedtime_start: "2026-06-05T02:00:00+00:00",
        bedtime_stop: "2026-06-05T10:00:00+00:00",
        duration: 28800,
        total: 25200,
        hr_lowest: 45,
        hr_resting: 52,
        hr_average: 54,
        average_hrv: 41,
        respiratory_rate: 14,
      }],
    },
  });

  const latestSleep = summarizeWearableLatest(vault)?.sleep;
  const latestRecovery = summarizeWearableLatest(vault)?.recovery;
  const projection = buildMetricProjection(vault);
  const restingHeartRatePoints = projection.metricPoints.filter((point) =>
    point.metricKey === "resting-heart-rate"
  );

  assert.equal(latestSleep?.lowestHeartRate.selection.value, 45);
  assert.equal(latestRecovery?.restingHeartRate.selection.value, 52);
  assert.equal(latestRecovery?.restingHeartRate.selection.resolution, "direct");
  assert.equal(latestRecovery?.restingHeartRate.selection.fallbackFromMetric, null);
  assert.deepEqual(restingHeartRatePoints.map((point) => point.value), [52]);
});

test("metric evidence labels an aggregator record with its public source provider", () => {
  const vault = makeVault([
    makeObservation({
      dataOrigin: {
        aggregatorProvider: "junction",
        originConfidence: "high",
        sourceProviderSlug: "garmin",
        version: 1,
      },
      dayKey: "2026-06-05",
      entityId: "evt_public_source_sleep_deep_01",
      metric: "sleep-deep-minutes",
      occurredAt: "2026-06-05T10:00:00.000Z",
      provider: "junction",
      recordedAt: "2026-06-05T10:01:00.000Z",
      unit: "minutes",
      value: 95,
    }),
  ]);

  const deepSleep = buildMetricProjection(vault).wearableMetricRows.find((row) =>
    row.metricKey === "deep-sleep-minutes"
  );

  assert.equal(deepSleep?.provider, "garmin");
  assert.deepEqual(deepSleep?.dataOrigin, {
    aggregatorProvider: "junction",
    originConfidence: "high",
    sourceProviderSlug: "garmin",
    version: 1,
  });
  assert.equal(deepSleep?.sourceLabel, "Garmin");
});

test("wearable activity projection emits workout count and zone-minute metric points", () => {
  const vault = makeVault([
    makeEntity({
      entityId: "evt_hr_zone_workout_01",
      family: "event",
      kind: "activity_session",
      recordClass: "ledger",
      occurredAt: "2026-04-08T12:00:00Z",
      date: "2026-04-08",
      title: "Garmin interval session",
      attributes: {
        dayKey: "2026-04-08",
        durationMinutes: 35,
        recordedAt: "2026-04-08T12:45:00Z",
        externalRef: {
          system: "garmin",
          resourceType: "activity_session",
          resourceId: "evt_hr_zone_workout_01-resource",
        },
        workout: {
          heartRateZones: [{
            durationMinutes: 20,
            label: "Zone 2",
            maxHeartRate: 140,
            minHeartRate: 120,
            zone: 2,
          }],
        },
      },
    }),
  ]);

  const projection = buildMetricProjection(vault);
  const workoutCount = projection.metricPoints.find((point) =>
    point.metricKey === "workout-count"
  );
  const zoneMinutes = projection.metricPoints.find((point) =>
    point.metricKey === "heart-rate-zone-2-minutes"
  );

  assert.equal(workoutCount?.value, 1);
  assert.equal(zoneMinutes?.value, 20);
  assert.equal(zoneMinutes?.context.zone, 2);
  assert.equal(zoneMinutes?.context.zoneLabel, "Zone 2");
  assert.equal("maxHeartRate" in (zoneMinutes?.context ?? {}), false);
  assert.equal("minHeartRate" in (zoneMinutes?.context ?? {}), false);
});

test("heart-rate-zone projection combines distinct sessions without false provider attribution", () => {
  const vault = makeVault([
    makeActivitySession({
      entityId: "evt_junction_garmin_activity_01",
      dayKey: "2026-04-08",
      durationMinutes: 30,
      occurredAt: "2026-04-08T12:00:00Z",
      recordedAt: "2026-04-08T12:35:00Z",
      provider: "junction",
      title: "Junction Garmin run",
      dataOrigin: {
        version: 1,
        aggregatorProvider: "junction",
        sourceProviderSlug: "garmin",
        originConfidence: "high",
      },
      heartRateZones: [{
        durationMinutes: 11,
        label: "Garmin Zone 2",
        zone: 2,
      }],
    }),
    makeActivitySession({
      entityId: "evt_junction_apple_activity_01",
      dayKey: "2026-04-08",
      durationMinutes: 45,
      occurredAt: "2026-04-08T13:00:00Z",
      recordedAt: "2026-04-08T13:50:00Z",
      provider: "junction",
      title: "Junction Apple workout",
      dataOrigin: {
        version: 1,
        aggregatorProvider: "junction",
        sourceProviderSlug: "apple-health",
        originConfidence: "high",
      },
      heartRateZones: [{
        durationMinutes: 23,
        label: "Apple Zone 2",
        zone: 2,
      }],
    }),
  ]);

  const latest = summarizeWearableLatest(vault);
  const projection = buildMetricProjection(vault);
  const zoneRow = projection.wearableMetricRows.find((row) =>
    row.metricKey === "heart-rate-zone-2-minutes"
  );
  assert.equal(latest?.activity?.sessionMinutes.selection.value, 75);
  assert.equal(latest?.activity?.sessionCount.selection.value, 2);
  assert.equal(latest?.activity?.sessionMinutes.selection.provider, "multiple");
  assert.deepEqual(latest?.activity?.heartRateZones, [{
    durationMinutes: 34,
    zone: 2,
  }]);
  assert.ok(zoneRow);
  assert.ok(zoneRow.context);
  assert.equal(zoneRow?.value, 34);
  assert.equal(zoneRow?.dataOrigin, null);
  assert.deepEqual(
    [...(zoneRow?.recordIds ?? [])].sort(),
    ["evt_junction_apple_activity_01", "evt_junction_garmin_activity_01"],
  );
  assert.deepEqual(
    [...(zoneRow.context.contributingRecordIds as string[])].sort(),
    ["evt_junction_apple_activity_01", "evt_junction_garmin_activity_01"],
  );
});

test("daily workout rollup adds distinct sessions and suppresses an imported mirror", () => {
  const run = {
    activityType: "Running",
    dayKey: "2026-02-14",
    durationMinutes: 73,
    endAt: "2026-02-14T13:13:00.000Z",
    occurredAt: "2026-02-14T12:00:00.000Z",
    startAt: "2026-02-14T12:00:00.000Z",
    workoutMetrics: {
      activeCalories: 731,
      distanceKm: 11.46,
      maxHeartRate: 176,
      totalElevationGainMeters: 241,
      workoutStrain: 13,
    },
  } as const;
  const vault = makeVault([
    makeActivitySession({
      ...run,
      entityId: "evt_garmin_run",
      provider: "garmin",
      recordedAt: "2026-02-14T13:14:00.000Z",
    }),
    makeActivitySession({
      ...run,
      dataOrigin: {
        aggregatorProvider: "junction",
        originConfidence: "high",
        sourceInstanceId: "garmin-watch",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        version: 1,
      },
      entityId: "evt_junction_garmin_run_mirror",
      provider: "junction",
      recordedAt: "2026-02-14T13:15:00.000Z",
    }),
    makeActivitySession({
      activityType: "Functional strength training",
      dayKey: "2026-02-14",
      durationMinutes: 10,
      endAt: "2026-02-14T18:10:00.000Z",
      entityId: "evt_garmin_strength",
      occurredAt: "2026-02-14T18:00:00.000Z",
      provider: "garmin",
      recordedAt: "2026-02-14T18:11:00.000Z",
      startAt: "2026-02-14T18:00:00.000Z",
      workoutMetrics: {
        activeCalories: 80,
        maxHeartRate: 172,
        workoutStrain: 6,
      },
    }),
  ]);

  const activity = summarizeWearableLatest(vault)?.activity;
  const points = buildMetricProjection(vault).metricPoints;
  const point = (key: string) => points.find((candidate) => candidate.metricKey === key)?.value;

  assert.equal(activity?.sessionMinutes.selection.value, 83);
  assert.equal(activity?.sessionCount.selection.value, 2);
  assert.deepEqual(activity?.activityTypes, ["Functional strength training", "Running"]);
  assert.equal(activity?.activeCalories.selection.value, 811);
  assert.equal(activity?.distanceKm.selection.value, 11.46);
  assert.equal(activity?.totalElevationGainMeters.selection.value, 241);
  assert.equal(activity?.maxHeartRate.selection.value, 176);
  assert.equal(activity?.workoutStrain.selection.value, 13);
  assert.equal(point("workout-minutes"), 83);
  assert.equal(point("workout-count"), 2);
  assert.equal(point("activity-minutes"), undefined);
});

test("unadmitted Junction timeseries stay out of default query/search and wearable summaries", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-junction-raw-timeseries-query-"));
  const unadmittedTimeseriesSnapshot = {
    importedAt: "2026-05-20T12:00:00.000Z",
    timeseries: {
      experimental_raw: [{
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        timestamp: "2026-05-20T08:00:00Z",
        unit: "bpm",
        value: 61,
      }],
    },
  };
  const rawOnlyPayload = normalizeJunctionSnapshot(unadmittedTimeseriesSnapshot);

  assert.deepEqual(rawOnlyPayload.events, []);
  assert.deepEqual(rawOnlyPayload.samples ?? [], []);
  assert.deepEqual(rawOnlyPayload.evidenceParts ?? [], []);

  try {
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
        createdAt: "2026-05-20T00:00:00.000Z",
        title: "Junction unadmitted timeseries query vault",
        timezone: "UTC",
      })}\n`,
      "utf8",
    );

    const persistedRawVault = await readVault(vaultRoot);
    assert.deepEqual(listEntities(persistedRawVault, { families: ["event"] }), []);
    assert.deepEqual(listEntities(persistedRawVault, { families: ["sample"] }), []);
    assert.equal(searchVault(persistedRawVault, "heart rate").total, 0);
    assert.equal((await searchVaultRuntime(vaultRoot, "heart rate")).total, 0);
    assert.equal(summarizeWearableLatest(persistedRawVault, { providers: ["garmin"] }), null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }

  const compactSummaryVault = makeVaultFromJunctionSnapshot({
    ...unadmittedTimeseriesSnapshot,
    summaries: {
      activity: [{
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        observedAt: "2026-05-20T12:00:00Z",
        steps: 7200,
      }],
    },
  });
  const latest = summarizeWearableLatest(compactSummaryVault, { providers: ["garmin"] });

  assert.equal(latest?.latestDate, "2026-05-20");
  assert.equal(latest?.activity?.steps.selection.value, 7200);
});

test("Junction hourly features remain independently queryable without becoming day summaries", () => {
  const snapshot = {
    importedAt: "2026-05-20T12:00:00.000Z",
    timeseries: {
      heartrate: [
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T08:00:00Z",
          unit: "bpm",
          value: 61,
        },
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T09:00:00Z",
          unit: "bpm",
          value: 72,
        },
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T10:15:00Z",
          sessionId: "workout-1",
          sessionStart: "2026-05-20T10:00:00Z",
          sessionEnd: "2026-05-20T11:00:00Z",
          unit: "bpm",
          value: 90,
        },
      ],
      calories_active: [
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T08:15:00Z",
          unit: "kcal",
          value: 100,
        },
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T09:15:00Z",
          unit: "kcal",
          value: 200,
        },
        {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          timestamp: "2026-05-20T10:15:00Z",
          sessionId: "workout-1",
          sessionStart: "2026-05-20T10:00:00Z",
          sessionEnd: "2026-05-20T11:00:00Z",
          unit: "kcal",
          value: 50,
        },
      ],
    },
  };
  const payload = normalizeJunctionSnapshot(snapshot);
  const vault = makeVaultFromJunctionSnapshot(snapshot);
  const sleepVault = makeVaultFromJunctionSnapshot({
    ...snapshot,
    summaries: {
      sleep: [{
        source: { provider: "garmin", type: "watch" },
        id: "garmin-sleep-1",
        calendar_date: "2026-05-20",
        bedtime_start: "2026-05-20T02:00:00Z",
        bedtime_stop: "2026-05-20T07:00:00Z",
        duration: 18000,
        total: 16200,
        hr_lowest: 45,
        hr_average: 50,
      }],
    },
  });
  const latest = summarizeWearableLatest(vault, { providers: ["garmin"] });
  const heartRateSummary = summarizeWearableMetricLatest(vault, "max-heart-rate", {
    providers: ["garmin"],
    windowDays: 1,
  });
  const projection = buildMetricProjection(vault);
  const maxHeartRatePoints = projection.metricPoints
    .filter((point) => point.metricKey === "max-heart-rate")
    .flatMap((point) => typeof point.value === "number" ? [point.value] : [])
    .sort((left, right) => left - right);
  const activeCaloriePoints = projection.metricPoints
    .filter((point) => point.metricKey === "active-calories")
    .flatMap((point) => typeof point.value === "number" ? [point.value] : [])
    .sort((left, right) => left - right);

  assert.equal(payload.events?.length, 12);
  assert.deepEqual(payload.samples ?? [], []);
  assert.ok(payload.events?.every((event) => event.fields?.observationGrain === "derived_fact"));
  assert.equal(listEntities(vault, { families: ["event"] }).length, 12);
  assert.equal(latest, null);
  assert.equal(heartRateSummary?.value, null);
  assert.equal(heartRateSummary?.recentWindow.count, 0);
  assert.deepEqual(maxHeartRatePoints, [61, 72, 90]);
  assert.deepEqual(activeCaloriePoints, [50, 100, 200]);
  assert.equal(summarizeWearableLatest(sleepVault)?.sleep?.averageHeartRate.selection.value, 50);
  assert.equal(summarizeWearableLatest(sleepVault)?.sleep?.lowestHeartRate.selection.value, 45);
});

test("latest surface sees Junction Garmin object data envelopes as usable summaries", () => {
  const vault = makeVaultFromJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      activity: {
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        observedAt: "2026-05-20T12:00:00Z",
        data: {
          calories_active: 640,
          calories_total: 2400,
          distance: 7500,
          steps: 7200,
        },
      },
      sleep: {
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        observedAt: "2026-05-20T10:00:00Z",
        data: {
          id: "sleep-object-envelope",
          bedtime_start: "2026-05-20T02:00:00+00:00",
          bedtime_stop: "2026-05-20T10:00:00+00:00",
          duration: 28800,
          efficiency: 0.97,
          recovery_readiness_score: 74,
          total: 25200,
          sleepScore: 82,
        },
      },
    },
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-05-20T13:00:00Z", unit: "%", value: 36 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const latest = summarizeWearableLatest(vault, { providers: ["garmin"] });
  const stressLevel = summarizeWearableMetricLatest(vault, "stress-level", { providers: ["garmin"], windowDays: 1 });

  assert.equal(latest?.latestDate, "2026-05-20");
  assert.equal(latest?.activity?.steps.selection.value, 7200);
  assert.equal(latest?.activity?.activeCalories.selection.value, 640);
  assert.equal(latest?.activity?.totalCalories.selection.value, 2400);
  assert.equal(latest?.activity?.distanceKm.selection.value, 7.5);
  assert.equal(latest?.activity?.steps.selection.provider, "garmin");
  assert.equal(latest?.sleep?.sleepScore.selection.value, 82);
  assert.equal(latest?.sleep?.totalSleepMinutes.selection.value, 420);
  assert.equal(latest?.sleep?.sleepEfficiency.selection.value, 97);
  assert.equal(latest?.recovery?.recoveryScore.selection.value, 74);
  assert.equal(latest?.recovery?.stressLevel.selection.value, 36);
  assert.equal(stressLevel?.metric, "stressLevel");
  assert.equal(stressLevel?.value, 36);
  assert.deepEqual(latest?.providers, ["garmin"]);
});

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

test("latest surface stays joined to the latest sleep-backed local day instead of mixing newer activity-only dates", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_sleep_score_04",
      metric: "sleep-score",
      value: 88,
      unit: "%",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:15:00Z",
    }),
    makeObservation({
      entityId: "evt_recovery_04",
      metric: "recovery-score",
      value: 74,
      unit: "%",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:10:00Z",
    }),
    makeObservation({
      entityId: "evt_steps_05",
      metric: "daily-steps",
      value: 11234,
      unit: "count",
      dayKey: "2026-04-05",
      occurredAt: "2026-04-05T18:00:00Z",
      recordedAt: "2026-04-05T18:05:00Z",
    }),
  ]);

  const latest = summarizeWearableLatest(vault);

  assert.equal(latest?.latestDate, "2026-04-04");
  assert.equal(latest?.day.date, "2026-04-04");
  assert.equal(latest?.sleep?.sleepScore.selection.value, 88);
  assert.equal(latest?.recovery?.recoveryScore.selection.value, 74);
  assert.equal(latest?.activity, null);
  assert.equal(
    latest?.notes.some((note) => note.includes("Latest wearable summary is joined on local day 2026-04-04")),
    true,
  );
  assert.equal(
    latest?.notes.some((note) => note.includes("Latest activity summary date 2026-04-05 differs")),
    true,
  );
});

test("activity surfaces keep explicit activity observations and convert energy-burned into total calories", () => {
  const vault = makeVault([
    makeObservation({
      entityId: "evt_whoop_energy",
      metric: "energy-burned",
      value: 418.4,
      unit: "kJ",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
    makeObservation({
      entityId: "evt_whoop_max_hr",
      metric: "max-heart-rate",
      value: 168,
      unit: "bpm",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
    makeObservation({
      entityId: "evt_whoop_strain",
      metric: "workout-strain",
      value: 11.1,
      unit: "whoop_strain",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
    makeObservation({
      entityId: "evt_whoop_recorded",
      metric: "percent-recorded",
      value: 99,
      unit: "%",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
    makeObservation({
      entityId: "evt_whoop_gain",
      metric: "altitude-gain",
      value: 42,
      unit: "meter",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
    makeObservation({
      entityId: "evt_whoop_change",
      metric: "altitude-change",
      value: 33,
      unit: "meter",
      dayKey: "2026-04-06",
      occurredAt: "2026-04-06T18:00:00Z",
      recordedAt: "2026-04-06T18:05:00Z",
      provider: "whoop",
      resourceType: "workout",
    }),
  ]);

  const latest = summarizeWearableLatest(vault);
  const energy = summarizeWearableMetricLatest(vault, "energy-burned", { windowDays: 1 });
  const maxHeartRate = summarizeWearableMetricLatest(vault, "max-heart-rate", { windowDays: 1 });

  assert.equal(latest?.activity?.activeCalories.selection.value, null);
  assert.equal(latest?.activity?.totalCalories.selection.value, 100);
  assert.equal(latest?.activity?.totalCalories.selection.unit, "kcal");
  assert.equal(latest?.activity?.maxHeartRate.selection.value, 168);
  assert.equal(latest?.activity?.workoutStrain.selection.value, 11.1);
  assert.equal(latest?.activity?.percentRecorded.selection.value, 99);
  assert.equal(latest?.activity?.totalElevationGainMeters.selection.value, 42);
  assert.equal(latest?.activity?.altitudeChangeMeters.selection.value, 33);

  assert.equal(energy?.metric, "totalCalories");
  assert.equal(energy?.resolvedAlias, "energy-burned");
  assert.equal(energy?.summaryKind, "activity");
  assert.equal(energy?.unit, "kcal");
  assert.equal(energy?.value, 100);

  assert.equal(maxHeartRate?.metric, "maxHeartRate");
  assert.equal(maxHeartRate?.summaryKind, "activity");
  assert.equal(maxHeartRate?.unit, "bpm");
  assert.equal(maxHeartRate?.value, 168);
});

test("Junction expanded summaries project into wearable activity, sleep, and body surfaces", () => {
  const vault = makeVaultFromJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      activity: [{
        source: { provider: "garmin", type: "watch" },
        id: "activity-expanded-fields",
        date: "2026-05-20T00:00:00Z",
        steps: 9400,
        floors_climbed: 18,
        vo2_max: 48.5,
        total_elevation_gain: 320,
        elevation_change: -12,
        percent_recorded: 0.95,
        heart_rate: {
          avg_bpm: 76,
          avg_walking_bpm: 101,
          min_bpm: 44,
        },
        high: 5,
        low: 60,
        medium: 13,
      }],
      sleep: [{
        source: { provider: "garmin", type: "watch" },
        id: "sleep-expanded-fields",
        bedtime_start: "2026-05-20T02:00:00Z",
        bedtime_stop: "2026-05-20T10:00:00Z",
        duration: 28800,
        latency: 600,
        time_in_bed: 30000,
        sleep_consistency: 91,
        sleep_performance: 88,
      }],
      body: [{
        source: { provider: "garmin", type: "scale" },
        id: "body-expanded-fields",
        date: "2026-05-20T08:00:00Z",
        body_temperature: 36.7,
        lean_body_mass_kilogram: 40.1,
        waist_circumference_centimeter: 86.36,
      }],
    },
  });

  const latest = summarizeWearableLatest(vault);
  const activityMinutes = summarizeWearableMetricLatest(vault, "activity-minutes", { windowDays: 1 });
  const lowActivityMinutes = summarizeWearableMetricLatest(vault, "low-activity-minutes", { windowDays: 1 });
  const activityAverageHeartRate = summarizeWearableMetricLatest(vault, "activity-average-heart-rate", { windowDays: 1 });
  const activityLowestHeartRate = summarizeWearableMetricTrend(vault, "activity-lowest-heart-rate", { windowDays: 1 });
  const walkingAverageHeartRate = summarizeWearableMetricLatest(vault, "walking-average-heart-rate", { windowDays: 1 });
  const sleepLatency = summarizeWearableMetricLatest(vault, "sleep-latency-minutes", { windowDays: 1 });
  const leanBodyMass = summarizeWearableMetricLatest(vault, "lean-body-mass", { windowDays: 1 });
  const waistCircumference = summarizeWearableMetricLatest(vault, "waist-circumference", { windowDays: 1 });
  const projection = buildMetricProjection(vault);

  assert.equal(latest?.activity?.steps.selection.value, 9400);
  assert.equal(latest?.activity?.activityMinutes.selection.value, 78);
  assert.equal(latest?.activity?.lowActivityMinutes.selection.value, 60);
  assert.equal(latest?.activity?.mediumActivityMinutes.selection.value, 13);
  assert.equal(latest?.activity?.highActivityMinutes.selection.value, 5);
  assert.equal(latest?.activity?.averageHeartRate.selection.value, 76);
  assert.equal(latest?.activity?.walkingAverageHeartRate.selection.value, 101);
  assert.equal(latest?.activity?.lowestHeartRate.selection.value, 44);
  assert.equal(latest?.activity?.floorsClimbed.selection.value, 18);
  assert.equal(latest?.activity?.estimatedVo2Max.selection.value, 48.5);
  assert.equal(latest?.activity?.totalElevationGainMeters.selection.value, 320);
  assert.equal(latest?.activity?.altitudeChangeMeters.selection.value, -12);
  assert.equal(latest?.activity?.percentRecorded.selection.value, 95);
  assert.equal(latest?.sleep?.timeInBedMinutes.selection.value, 500);
  assert.equal(latest?.sleep?.sleepLatencyMinutes.selection.value, 10);
  assert.equal(latest?.sleep?.averageHeartRate.selection.value, null);
  assert.equal(latest?.sleep?.lowestHeartRate.selection.value, null);
  assert.equal(latest?.recovery?.restingHeartRate.selection.value, null);
  assert.equal(latest?.sleep?.sleepConsistency.selection.value, 91);
  assert.equal(latest?.sleep?.sleepPerformance.selection.value, 88);
  assert.equal(latest?.bodyState?.leanBodyMassKg.selection.value, 40.1);
  assert.equal(latest?.bodyState?.temperature.selection.value, 36.7);
  assert.equal(latest?.bodyState?.waistCircumference.selection.value, 86.36);
  assert.equal(activityMinutes?.summaryKind, "activity");
  assert.equal(activityMinutes?.value, 78);
  assert.equal(lowActivityMinutes?.summaryKind, "activity");
  assert.equal(lowActivityMinutes?.value, 60);
  assert.equal(activityAverageHeartRate?.metric, "averageHeartRate");
  assert.equal(activityAverageHeartRate?.resolvedAlias, "activity-average-heart-rate");
  assert.equal(activityAverageHeartRate?.summaryKind, "activity");
  assert.equal(activityAverageHeartRate?.value, 76);
  assert.equal(activityLowestHeartRate?.metric, "lowestHeartRate");
  assert.equal(activityLowestHeartRate?.resolvedAlias, "activity-lowest-heart-rate");
  assert.equal(activityLowestHeartRate?.summaryKind, "activity");
  assert.equal(activityLowestHeartRate?.value, 44);
  assert.equal(activityLowestHeartRate?.points[0]?.value, 44);
  assert.equal(activityLowestHeartRate?.notes.some((note) => note.startsWith("No ")), false);
  assert.equal(walkingAverageHeartRate?.summaryKind, "activity");
  assert.equal(walkingAverageHeartRate?.value, 101);
  assert.equal(sleepLatency?.summaryKind, "sleep");
  assert.equal(sleepLatency?.value, 10);
  assert.equal(leanBodyMass?.metric, "leanBodyMassKg");
  assert.equal(leanBodyMass?.summaryKind, "bodyState");
  assert.equal(leanBodyMass?.value, 40.1);
  assert.equal(waistCircumference?.metric, "waistCircumference");
  assert.equal(waistCircumference?.summaryKind, "bodyState");
  assert.equal(waistCircumference?.value, 86.36);
  const projectedActivitySummaryValue = (metricKey: string) =>
    projection.metricPoints.find((point) =>
      point.metricKey === metricKey && point.source.kind === "activity-summary"
    )?.value;
  assert.equal(projectedActivitySummaryValue("activity-minutes"), 78);
  assert.equal(projectedActivitySummaryValue("low-activity-minutes"), 60);
  assert.equal(projectedActivitySummaryValue("medium-activity-minutes"), 13);
  assert.equal(projectedActivitySummaryValue("high-activity-minutes"), 5);
  assert.equal(projectedActivitySummaryValue("average-heart-rate"), 76);
  assert.equal(projectedActivitySummaryValue("walking-average-heart-rate"), 101);
  assert.equal(projectedActivitySummaryValue("lowest-heart-rate"), 44);
});

test("Junction body composition facts remain distinct across wearable and canonical metric queries", () => {
  const vault = makeVaultFromJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      body: [{
        source: { provider: "withings", type: "scale" },
        id: "body-composition-queryable",
        date: "2026-05-20T08:00:00Z",
        bone_mass_percentage: 4.2,
        muscle_mass_percentage: 61.8,
        visceral_fat_index: 7,
        water_percentage: 54.6,
      }],
    },
  });

  const bodyState = summarizeWearableLatest(vault)?.bodyState;
  const boneMass = summarizeWearableMetricLatest(vault, "bone_mass_percentage", { windowDays: 1 });
  const muscleMass = summarizeWearableMetricLatest(vault, "muscle-mass-percentage", { windowDays: 1 });
  const visceralFat = summarizeWearableMetricLatest(vault, "visceral_fat_index", { windowDays: 1 });
  const bodyWater = summarizeWearableMetricLatest(vault, "water_percentage", { windowDays: 1 });
  const compositionMetricKeys = new Set([
    "body-water-percentage",
    "bone-mass-percentage",
    "muscle-mass-percentage",
    "visceral-fat-index",
  ]);
  const metricPoints = buildMetricProjection(vault).metricPoints
    .filter((point) => compositionMetricKeys.has(point.metricKey))
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey));

  assert.equal(bodyState?.boneMassPercentage.selection.value, 4.2);
  assert.equal(bodyState?.boneMassPercentage.selection.unit, "%");
  assert.equal(bodyState?.boneMassPercentage.selection.provider, "withings");
  assert.equal(bodyState?.muscleMassPercentage.selection.value, 61.8);
  assert.equal(bodyState?.bodyWaterPercentage.selection.value, 54.6);
  assert.equal(bodyState?.visceralFatIndex.selection.value, 7);
  assert.equal(bodyState?.visceralFatIndex.selection.unit, "index");
  assert.deepEqual(
    [boneMass, muscleMass, visceralFat, bodyWater].map((summary) => ({
      metric: summary?.metric,
      provider: summary?.provider,
      summaryKind: summary?.summaryKind,
      unit: summary?.unit,
      value: summary?.value,
    })),
    [
      { metric: "boneMassPercentage", provider: "withings", summaryKind: "bodyState", unit: "%", value: 4.2 },
      { metric: "muscleMassPercentage", provider: "withings", summaryKind: "bodyState", unit: "%", value: 61.8 },
      { metric: "visceralFatIndex", provider: "withings", summaryKind: "bodyState", unit: "index", value: 7 },
      { metric: "bodyWaterPercentage", provider: "withings", summaryKind: "bodyState", unit: "%", value: 54.6 },
    ],
  );
  assert.deepEqual(
    metricPoints.map((point) => ({
      canonicalUnit: point.canonicalUnit,
      metricKey: point.metricKey,
      provider: point.provenance.provider,
      sourceKind: point.source.kind,
      value: point.value,
    })),
    [
      { canonicalUnit: "percent", metricKey: "body-water-percentage", provider: "withings", sourceKind: "wearable-summary", value: 54.6 },
      { canonicalUnit: "percent", metricKey: "bone-mass-percentage", provider: "withings", sourceKind: "wearable-summary", value: 4.2 },
      { canonicalUnit: "percent", metricKey: "muscle-mass-percentage", provider: "withings", sourceKind: "wearable-summary", value: 61.8 },
      { canonicalUnit: "index", metricKey: "visceral-fat-index", provider: "withings", sourceKind: "wearable-summary", value: 7 },
    ],
  );
  assert.ok(metricPoints.every((point) => (point.provenance.dataOrigin as DeviceDataOrigin | null)?.aggregatorProvider === "junction"));
  assert.ok(metricPoints.every((point) => (point.provenance.dataOrigin as DeviceDataOrigin | null)?.sourceProviderSlug === "withings"));
});

test("metric latest and trend surfaces keep derived sleep and aggregate-backed points", () => {
  const vault = makeVault([
    makeSleepSession({
      entityId: "evt_sleep_04",
      dayKey: "2026-04-04",
      durationMinutes: 465,
      occurredAt: "2026-04-03T22:30:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
      startAt: "2026-04-03T22:30:00Z",
      endAt: "2026-04-04T06:15:00Z",
    }),
    makeObservation({
      entityId: "evt_sleep_deep_04",
      metric: "sleep-deep-minutes",
      value: 100,
      unit: "minutes",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:05:00Z",
      resourceType: "sleep",
    }),
    makeObservation({
      entityId: "evt_sleep_light_04",
      metric: "sleep-light-minutes",
      value: 200,
      unit: "minutes",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:06:00Z",
      resourceType: "sleep",
    }),
    makeObservation({
      entityId: "evt_sleep_rem_04",
      metric: "sleep-rem-minutes",
      value: 120,
      unit: "minutes",
      dayKey: "2026-04-04",
      occurredAt: "2026-04-04T06:00:00Z",
      recordedAt: "2026-04-04T06:07:00Z",
      resourceType: "sleep",
    }),
    makeActivitySession({
      entityId: "evt_run_05",
      dayKey: "2026-04-05",
      durationMinutes: 20,
      occurredAt: "2026-04-05T07:00:00Z",
      recordedAt: "2026-04-05T07:30:00Z",
      title: "Garmin running session",
    }),
    makeActivitySession({
      entityId: "evt_cycle_05",
      dayKey: "2026-04-05",
      durationMinutes: 35,
      occurredAt: "2026-04-05T12:00:00Z",
      recordedAt: "2026-04-05T12:45:00Z",
      title: "Garmin cycling session",
    }),
  ]);

  const totalSleep = summarizeWearableMetricTrend(vault, "totalSleepMinutes", { windowDays: 1 });
  const timeInBed = summarizeWearableMetricLatest(vault, "timeInBedMinutes", { windowDays: 1 });
  const sleepSessionMinutes = summarizeWearableMetricTrend(vault, "sessionMinutes", { windowDays: 1 });
  const workoutMinutes = summarizeWearableMetricTrend(vault, "workout-minutes", { windowDays: 1 });
  const sessionCount = summarizeWearableMetricLatest(vault, "sessionCount", { windowDays: 1 });

  assert.equal(totalSleep?.value, 420);
  assert.equal(totalSleep?.points[0]?.value, 420);
  assert.equal(totalSleep?.provider, "oura");
  assert.equal(
    totalSleep?.notes.some((note) => note.includes("Derived total sleep from selected deep, light, and REM stage minutes")),
    true,
  );
  assert.equal(
    totalSleep?.notes.some((note) => note.includes("Used the selected sleep session duration because no direct total-sleep metric was available.")),
    false,
  );

  assert.equal(timeInBed?.value, 465);
  assert.equal(
    timeInBed?.notes.some((note) => note.includes("Used the selected sleep session duration because no explicit time-in-bed metric was available.")),
    true,
  );

  assert.equal(sleepSessionMinutes?.value, 465);
  assert.equal(sleepSessionMinutes?.points[0]?.value, 465);
  assert.equal(sleepSessionMinutes?.provider, "oura");

  assert.equal(workoutMinutes?.metric, "sessionMinutes");
  assert.equal(workoutMinutes?.resolvedAlias, "workout-minutes");
  assert.equal(workoutMinutes?.value, 55);
  assert.equal(workoutMinutes?.points[0]?.value, 55);
  assert.equal(workoutMinutes?.provider, "garmin");

  assert.equal(sessionCount?.value, 2);
  assert.equal(sessionCount?.provider, "garmin");
});

test("allowlisted workout session metrics project without raw workout details", () => {
  const vault = makeVault([
    makeEntity({
      entityId: "evt_workout_metrics_01",
      family: "event",
      kind: "activity_session",
      recordClass: "ledger",
      occurredAt: "2026-04-08T12:00:00Z",
      date: "2026-04-08",
      title: "Garmin trail run",
      attributes: {
        dayKey: "2026-04-08",
        distanceKm: 8.2,
        durationMinutes: 42,
        recordedAt: "2026-04-08T12:50:00Z",
        externalRef: {
          system: "garmin",
          resourceType: "activity_session",
          resourceId: "evt_workout_metrics_01-resource",
        },
        workout: {
          sourceApp: "garmin",
          sourceWorkoutId: "workout-01",
          startedAt: "2026-04-08T12:00:00Z",
          endedAt: "2026-04-08T12:42:00Z",
          sessionNote: "Garmin trail run",
          metrics: {
            activeCalories: 320,
            totalCalories: 355,
            averageHeartRate: 145,
            maxHeartRate: 175,
            hrv: 44,
            workoutStrain: 12.4,
            percentRecorded: 97,
            totalElevationGainMeters: 88,
            altitudeChangeMeters: -12,
            elevationHighMeters: 314.5,
            elevationLowMeters: 125.2,
            averageSpeedMps: 3.1,
            maxSpeedMps: 5.4,
            averagePowerWatts: 215,
            maxPowerWatts: 540,
            normalizedPowerWatts: 235,
            weightedAveragePowerWatts: 230,
            kilojoules: 420,
          },
          exercises: [],
        },
      },
    }),
  ]);

  const latest = summarizeWearableLatest(vault, { providers: ["garmin"] });
  const activeCalories = summarizeWearableMetricLatest(vault, "active-calories", { providers: ["garmin"] });
  const maxHeartRate = summarizeWearableMetricLatest(vault, "max-heart-rate", { providers: ["garmin"] });
  const projection = buildMetricProjection(vault);
  const sourceHealth = summarizeWearableSourceHealth(vault, { providers: ["garmin"] });
  const workoutDetailNote = sourceHealth[0]?.notes.find((note) =>
    note.includes("workout detail metrics on activity sessions")
  );
  const pointValue = (metricKey: string) =>
    projection.metricPoints.find((point) => point.metricKey === metricKey)?.value ?? null;

  assert.equal(latest?.activity?.sessionMinutes.selection.value, 42);
  assert.equal(latest?.activity?.sessionCount.selection.value, 1);
  assert.equal(latest?.activity?.activeCalories.selection.value, 320);
  assert.equal(latest?.activity?.distanceKm.selection.value, 8.2);
  assert.equal(latest?.activity?.totalCalories.selection.value, null);
  assert.equal(latest?.activity?.maxHeartRate.selection.value, 175);
  assert.equal(latest?.activity?.workoutStrain.selection.value, 12.4);
  assert.equal(latest?.activity?.percentRecorded.selection.value, null);
  assert.equal(latest?.activity?.totalElevationGainMeters.selection.value, 88);
  assert.equal(latest?.activity?.altitudeChangeMeters.selection.value, null);
  assert.equal(activeCalories?.value, 320);
  assert.equal(maxHeartRate?.value, 175);
  assert.equal(pointValue("active-calories"), 320);
  assert.equal(pointValue("distance-km"), 8.2);
  assert.equal(pointValue("elevation-gain-meters"), 88);
  assert.equal(pointValue("max-heart-rate"), 175);
  assert.equal(pointValue("workout-strain"), 12.4);
  assert.equal(pointValue("total-calories"), null);
  assert.equal(sourceHealth[0]?.metricsContributed.includes("averagePowerWatts"), false);
  assert.ok(workoutDetailNote);
  assert.match(workoutDetailNote, /averagePowerWatts/u);
  assert.match(workoutDetailNote, /elevationHighMeters/u);
  assert.match(workoutDetailNote, /kilojoules/u);
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
  assert.equal(drift?.signals.length, 2);
  assert.equal(
    drift?.signals.some((signal) => signal.metric === "restingHeartRate" && signal.value === 51),
    true,
  );
  assert.equal(
    drift?.signals.some((signal) => signal.metric === "temperatureDeviation" && signal.value === 0.1),
    true,
  );
  assert.equal(drift?.signals.some((signal) => signal.value === null), false);
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
