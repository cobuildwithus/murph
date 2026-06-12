import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workoutSessionSchema } from "@murphai/contracts";
import * as coreRuntime from "@murphai/core";
import { test } from "vitest";

import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
  importDeviceProviderSnapshot,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  resolveJunctionOrigin,
  type DeviceBatchImportPayload,
  type WearableRawIngestReceipt,
} from "../src/index.ts";

function assertWorkoutSessionsMatchContract(events: readonly { fields?: { workout?: unknown } }[]): void {
  for (const event of events) {
    if (event.fields?.workout === undefined) {
      continue;
    }

    const result = workoutSessionSchema.safeParse(event.fields.workout);
    assert.equal(
      result.success,
      true,
      result.success ? undefined : `workout contract paths: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
}

function readRawReceiptArtifact(payload: DeviceBatchImportPayload): WearableRawIngestReceipt {
  const artifact = payload.rawArtifacts?.find((entry) => entry.role.startsWith("wearable-raw-receipt:"));
  assert.ok(artifact);
  const receipt = artifact.content as WearableRawIngestReceipt;
  assert.equal(artifact.role, `wearable-raw-receipt:${receipt.id}`);
  return receipt;
}

function assertJsonOmits(value: unknown, forbiddenValues: readonly string[]): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const forbidden of forbiddenValues) {
    assert.equal(text.includes(forbidden), false, `unexpected raw value retained: ${forbidden}`);
  }
}

async function makeTempDirectory(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

function assertCompactSummaryObservationFields(fields: Record<string, unknown> | undefined): void {
  assert.ok(fields);
  assert.equal(fields.observationGrain, "summary");
  for (const key of [
    "aggregationWindow",
    "statistic",
    "sampleCount",
    "firstSampleAt",
    "lastSampleAt",
    "minValue",
    "maxValue",
    "minObservedAt",
  ]) {
    assert.equal(Object.hasOwn(fields, key), false, `${key} should stay out of canonical observation fields`);
  }
}

function findJunctionCompactTimeseriesArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.rawArtifacts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-daily-${resourceSlug}:`));
}

function assertNoFullJunctionTimeseriesArtifacts(payload: DeviceBatchImportPayload): void {
  assert.equal(
    (payload.rawArtifacts ?? []).some((artifact) =>
      /^junction-timeseries-(?!daily-|reading-blood-pressure:)/u.test(artifact.role)
    ),
    false,
  );
}

function findJunctionBloodPressureReadingArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.rawArtifacts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-blood-pressure:"));
}

function makeJunctionDefaultTimeseriesSample(resource: string): Record<string, unknown> {
  const base = { sourceProviderSlug: "oura", timestamp: "2026-04-22T12:00:00Z" };

  if (resource === "blood_pressure") {
    return { ...base, systolic: 120, diastolic: 76 };
  }

  const plausibleValues: Record<string, number> = {
    body_temperature: 36.6,
    basal_body_temperature: 36.6,
    body_temperature_delta: -0.4,
    caffeine: 0.095,
    glucose: 5.5,
  };

  return { ...base, value: plausibleValues[resource] ?? 1 };
}

function assertEventRawArtifactRolesExist(payload: DeviceBatchImportPayload): void {
  const stagedRoles = new Set((payload.rawArtifacts ?? []).map((artifact) => artifact.role));
  for (const event of payload.events ?? []) {
    for (const role of event.rawArtifactRoles ?? []) {
      assert.equal(stagedRoles.has(role), true, `missing raw artifact role: ${role}`);
    }
  }
}

function makeJunctionCronometerMealSnapshot(options: {
  chickenCalories?: number;
  chickenProtein?: number;
} = {}) {
  return {
    accountId: "junction-account-hash-1",
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2019-08-24T00:00:00.000Z",
    windowEnd: "2019-08-24T23:59:59.999Z",
    summaries: {
      meal: [{
        date: "2019-08-24",
        created_at: "2023-02-27T20:31:24+00:00",
        data: {
          "Chicken coquet starter": {
            energy: {
              unit: "kcal",
              value: options.chickenCalories ?? 400,
            },
            macros: {
              carbs: 75,
              fats: {
                saturated: 98,
                total: 100,
              },
              // Junction documents the British spelling.
              fibre: 3,
              protein: options.chickenProtein ?? 10,
              sugar: 25,
            },
          },
          "Coffee, black, 1 tbsp(s)": {
            energy: { unit: "kcal", value: 0 },
            macros: { carbs: 0, fats: { total: 0 }, protein: 0, sugar: 0 },
          },
        },
        id: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        name: "Dinner",
        provider_id: "123456",
        source: { app_id: "cronometer", provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T18:30:00Z",
        updated_at: "2023-02-28T01:22:38+00:00",
      }],
    },
  };
}

test("resolveJunctionOrigin accepts Junction attribution aliases", () => {
  const slugCases: Array<[string, Record<string, unknown>]> = [
    ["sourceProviderSlug", { sourceProviderSlug: "oura" }],
    ["source_provider_slug", { source_provider_slug: "oura" }],
    ["sourceProvider", { sourceProvider: "oura" }],
    ["source_provider", { source_provider: "oura" }],
    ["provider", { provider: "oura" }],
    ["providerSlug", { providerSlug: "oura" }],
    ["provider_slug", { provider_slug: "oura" }],
    ["source.provider", { source: { provider: "oura" } }],
    ["source.slug", { source: { slug: "oura" } }],
    ["source.provider_slug", { source: { provider_slug: "oura" } }],
    ["source.providerSlug", { source: { providerSlug: "oura" } }],
    ["provider.provider", { provider: { provider: "oura" } }],
    ["provider.name", { provider: { name: "oura" } }],
  ];

  for (const [label, record] of slugCases) {
    assert.equal(resolveJunctionOrigin(record).sourceProviderSlug, "oura", label);
  }
  assert.equal(
    resolveJunctionOrigin({
      provider: "junction",
      source: { provider: "oura" },
    }).sourceProviderSlug,
    "oura",
    "later real source provider is not masked by aggregator provider",
  );

  assert.equal(resolveJunctionOrigin({}, { groupedSourceSlug: "polar" }).sourceProviderSlug, "polar");
  assert.equal(resolveJunctionOrigin({ provider: { name: "Oura Ring" } }).sourceProviderSlug, undefined);

  const origin = resolveJunctionOrigin({
    source_type: "ring",
    source: {
      device_id: "raw-ring-device",
      app_id: "raw-oura-app",
    },
  }, {
    groupedSourceSlug: "oura",
  });

  assert.equal(origin.sourceProviderSlug, "oura");
  assert.equal(origin.sourceType, "ring");
  assert.match(origin.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(origin.sourceInstanceId?.includes("raw-ring-device"), false);
  assert.equal(origin.sourceInstanceId?.includes("raw-oura-app"), false);

  const flatOrigin = resolveJunctionOrigin({
    sourceProviderSlug: "withings",
    sourceDeviceId: "raw-scale-device",
    source_app_id: "raw-withings-app",
  });
  assert.equal(flatOrigin.sourceProviderSlug, "withings");
  assert.match(flatOrigin.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(flatOrigin.sourceInstanceId?.includes("raw-scale-device"), false);
  assert.equal(flatOrigin.sourceInstanceId?.includes("raw-withings-app"), false);
});

test("Junction snapshot adapter preserves aggregator identity and upstream source provenance", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_01",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-22T23:59:59.000Z",
      connections: [
        {
          id: "source-oura",
          sourceProviderSlug: "oura",
          sourceName: "Oura Ring",
          sourceType: "ring",
          sourceDeviceId: "device-oura-ring-1",
          sourceAppId: "app-oura-cloud-1",
          originConfidence: "high",
        },
        {
          id: "source-withings",
          sourceProviderSlug: "withings",
          sourceName: "Withings",
          sourceType: "scale",
        },
        {
          id: "source-dexcom",
          sourceProviderSlug: "dexcom_v3",
          sourceName: "Dexcom",
          sourceType: "cgm",
        },
      ],
      summaries: {
        profile: {
          connectionId: "source-oura",
          displayName: "Oura profile",
        },
        activity: [
          {
            connectionId: "source-oura",
            observedAt: "2026-04-22T12:00:00Z",
            steps: 7200,
          },
          {
            connectionId: "source-withings",
            observedAt: "2026-04-22T12:00:00Z",
            steps: 7100,
          },
        ],
        sleep: [{
          connectionId: "source-oura",
          id: "sleep-a",
          observedAt: "2026-04-22T07:00:00+00:00",
          startAt: "2026-04-21T23:00:00+00:00",
          endAt: "2026-04-22T07:00:00+00:00",
          sleepScore: 88,
          totalSleepMinutes: 430,
        }],
        sleep_cycle: [{
          connectionId: "source-oura",
          observedAt: "2026-04-22T07:00:00+00:00",
          stage_count: 4,
        }],
        workouts: [{
          connectionId: "source-oura",
          id: "workout-a",
          startAt: "2026-04-22T10:00:00+00:00",
          endAt: "2026-04-22T10:45:00+00:00",
          activityType: "run",
          distanceKm: 7.2,
        }],
        body: [{
          connectionId: "source-withings",
          observedAt: "2026-04-22 17:00:00",
          timestampSemantics: "floating",
          timeZoneOffsetMinutes: null,
          weight_kg: 82.4,
        }],
      },
      timeseries: {
        heartrate: [{
          connectionId: "source-oura",
          timestamp: "2026-04-22T07:15:00+00:00",
          value: 54,
        }],
        blood_oxygen: [{
          connectionId: "source-oura",
          timestamp: "2026-04-22 07:16:00",
          timestampSemantics: "floating",
          value: 97,
        }],
        stress_level: [{
          connectionId: "source-oura",
          timestamp: "2026-04-22T12:00:00Z",
          stressLevel: 18,
        }],
        glucose: [{
          connectionId: "source-dexcom",
          timestamp: "2026-04-22T07:16:00Z",
          value: 5.6,
        }],
      },
    },
  });

  assert.equal(payload.provider, "junction");
  assert.equal(payload.accountId, "junction-account-hash-1");
  assert.deepEqual(payload.provenance?.summaryResources, [
    "profile",
    "activity",
    "sleep",
    "sleep_cycle",
    "workouts",
    "body",
  ]);
  assert.deepEqual(payload.provenance?.timeseriesResources, [
    "blood_oxygen",
    "stress_level",
    "glucose",
  ]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role.includes("heartrate")), false);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "glucose").length, 1);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen").length, 1);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);

  const observations = payload.events ?? [];
  const samples = payload.samples ?? [];
  assert.ok(observations.length >= 5);
  assert.equal(samples.length, 0);
  assert.ok(observations.every((event) => event.externalRef?.system === "junction"));
  assert.ok(observations.every((event) => !event.externalRef?.resourceType.includes(":")));

  const stepEvents = observations.filter((event) => event.fields?.metric === "daily-steps");
  assert.deepEqual(stepEvents.map((event) => event.dataOrigin?.sourceProviderSlug).sort(), ["oura", "withings"]);
  const sourceInstanceId = stepEvents.find((event) => event.dataOrigin?.sourceProviderSlug === "oura")?.dataOrigin?.sourceInstanceId;
  assert.match(sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/);
  assert.equal(sourceInstanceId?.includes("device-oura-ring-1"), false);
  assert.equal(sourceInstanceId?.includes("app-oura-cloud-1"), false);
  assert.ok(stepEvents.every((event) => event.externalRef?.resourceType.startsWith("junction-")));
  assert.ok(stepEvents.every((event) => event.externalRef?.resourceType !== "oura"));

  const bodyEvent = observations.find((event) => event.fields?.metric === "weight");
  assert.equal(bodyEvent?.dataOrigin?.sourceProviderSlug, "withings");
  assert.equal(bodyEvent?.dataOrigin?.observedAtRaw, "2026-04-22 17:00:00");
  assert.equal(bodyEvent?.dataOrigin?.timeZoneOffsetMinutes, null);
  assert.equal(bodyEvent?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(bodyEvent?.occurredAt, "2026-04-22T23:59:59.000Z");
  assert.notEqual(bodyEvent?.occurredAt, "2026-04-22T17:00:00.000Z");

  const floatingSample = samples.find((sample) => sample.stream === "spo2");
  assert.equal(floatingSample, undefined);
  const stressEvent = observations.find((event) => event.fields?.metric === "stress-level");
  assert.equal(stressEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assertCompactSummaryObservationFields(stressEvent?.fields);
  assert.equal(stressEvent?.fields?.value, 18);

  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
});

test("Junction normalizer compacts stress level timeseries into daily average facts", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T08:00:00Z", stressLevel: 18 },
              { timestamp: "2026-04-22T16:00:00Z", value: 42 },
              { timestamp: "2026-04-22T20:00:00Z", score: 60 },
              { timestamp: "2026-04-23T08:00:00Z", stress: { average: 21 } },
              { timestamp: "2026-04-23T09:00:00Z", stressLevel: 120 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const stressEvents = payload.events?.filter((event) => event.fields?.metric === "stress-level") ?? [];
  const dayOne = stressEvents.find((event) => event.dayKey === "2026-04-22");
  const dayTwo = stressEvents.find((event) => event.dayKey === "2026-04-23");

  assert.deepEqual(payload.provenance?.summaryResources, []);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["stress_level"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 2);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.equal(stressEvents.length, 2);
  assert.equal(dayOne?.dataOrigin?.sourceProviderSlug, "garmin");
  assert.equal(dayOne?.dataOrigin?.sourceType, "watch");
  assertCompactSummaryObservationFields(dayOne?.fields);
  assert.equal(dayOne?.fields?.unit, "score");
  assert.equal(dayOne?.fields?.value, 40);
  assertCompactSummaryObservationFields(dayTwo?.fields);
  assert.equal(dayTwo?.fields?.value, 21);
});

test("Junction stress level aggregates pass the canonical device import contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-stress-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      timeseries: {
        stress_level: {
          groups: {
            garmin: [{
              data: [
                { timestamp: "2026-04-22T08:00:00Z", value: 25 },
                { timestamp: "2026-04-22T16:00:00Z", value: 55 },
              ],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    };
    const payload = normalizeJunctionSnapshot(snapshot);

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const stressEvent = result.events.find((event) => event.kind === "observation");

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(stressEvent?.kind, "observation");
    assert.equal(stressEvent?.metric, "stress-level");
    assert.equal(stressEvent?.observationGrain, "summary");
    assert.equal(stressEvent?.value, 40);
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.ok(result.rawArtifacts.length >= 1);
    assert.notEqual(result.manifestPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction blood pressure readings pass the canonical device import contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-blood-pressure-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      timeseries: {
        blood_pressure: {
          groups: {
            omron: [{
              data: [
                { timestamp: "2026-04-22T08:05:00Z", systolic: 125, diastolic: 75, unit: "mmHg" },
              ],
              source: { provider: "omron", type: "cuff" },
            }],
          },
        },
      },
    };
    const payload = normalizeJunctionSnapshot(snapshot);

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const reading = result.events.find((event) => event.kind === "measurement");

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(reading?.kind, "measurement");
    assert.deepEqual(reading?.measurements, [
      { metric: "systolic-blood-pressure", value: 125, unit: "mmHg" },
      { metric: "diastolic-blood-pressure", value: 75, unit: "mmHg" },
    ]);
    assert.equal(findJunctionBloodPressureReadingArtifacts(payload).length, 1);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.ok(result.rawArtifacts.length >= 1);
    assert.notEqual(result.manifestPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction normalizer buckets stress level aggregates by provider local offset when present", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-23T06:30:00.000Z", timezone_offset: -25_200, score: 44 },
              { timestamp: "2026-04-23T08:00:00.000Z", timezone_offset: -25_200, value: 55 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const stressEvents = payload.events?.filter((event) => event.fields?.metric === "stress-level") ?? [];
  const localDayOne = stressEvents.find((event) => event.dayKey === "2026-04-22");
  const localDayTwo = stressEvents.find((event) => event.dayKey === "2026-04-23");

  assert.equal(stressEvents.length, 2);
  assert.equal(localDayOne?.fields?.value, 44);
  assert.equal(localDayOne?.occurredAt, "2026-04-23T06:30:00.000Z");
  assert.equal(localDayOne?.dataOrigin?.timeZoneOffsetMinutes, -420);
  assert.equal(localDayTwo?.fields?.value, 55);
  assert.equal(localDayTwo?.occurredAt, "2026-04-23T08:00:00.000Z");
  assert.equal(localDayTwo?.dataOrigin?.timeZoneOffsetMinutes, -420);
});

test("Junction normalizer keeps floating stress timestamps on their raw day despite offset metadata", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    windowStart: "2026-04-23T00:00:00.000Z",
    windowEnd: "2026-04-23T06:30:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-23T06:30:00.000", timezone_offset: -25_200, score: 44 },
              { date: "2026-04-23", timezone_offset: -25_200, value: 56 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const stressEvents = payload.events?.filter((event) => event.fields?.metric === "stress-level") ?? [];
  const rawDayEvent = stressEvents.find((event) => event.dayKey === "2026-04-23");

  assert.equal(stressEvents.length, 1);
  assert.equal(rawDayEvent?.fields?.value, 50);
  assertCompactSummaryObservationFields(rawDayEvent?.fields);
  assert.equal(rawDayEvent?.occurredAt, "2026-04-23T06:30:00.000Z");
  assert.equal(rawDayEvent?.dataOrigin?.timeZoneOffsetMinutes, -420);
  assert.equal(rawDayEvent?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(stressEvents.some((event) => event.dayKey === "2026-04-22"), false);
});

test("Junction snapshot adapter fails closed on glucose values outside the mmol/L window", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [
      {
        id: "source-dexcom",
        sourceProviderSlug: "dexcom_v3",
        sourceName: "Dexcom",
        sourceType: "cgm",
      },
    ],
    timeseries: {
      // mg/dL-scale value: Junction documents glucose timeseries in mmol/L,
      // so this fails the plausibility window instead of corrupting metrics.
      glucose: [{
        connectionId: "source-dexcom",
        timestamp: "2026-04-22T07:16:00Z",
        value: 101,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-glucose"), false);
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-daily-glucose:no-valid-samples"),
    true,
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction raw receipt hashing treats Date snapshot fields like ISO strings", async () => {
  const dateSnapshot = {
    importedAt: new Date("2026-04-22T12:00:00.000Z"),
    windowStart: new Date("2026-04-22T00:00:00.000Z"),
    windowEnd: new Date("2026-04-22T23:59:59.000Z"),
    summaries: {
      activity: [{
        observedAt: "2026-04-22T12:00:00.000Z",
        steps: 7200,
      }],
    },
  };
  const stringSnapshot = {
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: [{
        observedAt: "2026-04-22T12:00:00.000Z",
        steps: 7200,
      }],
    },
  };

  const withDates = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_date_hash",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: dateSnapshot,
  });
  const withStrings = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_date_hash",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: stringSnapshot,
  });
  const dateReceipt = readRawReceiptArtifact(withDates);
  const stringReceipt = readRawReceiptArtifact(withStrings);

  assert.equal(dateReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.equal(dateReceipt.observedAt, "2026-04-22T12:00:00.000Z");
  assert.equal(dateReceipt.payloadHash, stringReceipt.payloadHash);
  assert.equal(dateReceipt.id, stringReceipt.id);
  assert.equal(Object.hasOwn(dateReceipt, "payload"), false);
});

test("Junction normalizer accepts real nested source provider fields on timeseries entries", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      blood_oxygen: [{
        source: {
          provider: "oura",
          type: "ring",
          device_id: "ring-1",
          app_id: "oura-cloud",
        },
        timestamp: "2026-04-22T07:15:00Z",
        value: 97,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_oxygen"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction normalizer keeps grouped fallback source slugs when provider metadata is object-valued", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [{
      id: "source-oura",
      sourceProviderSlug: "oura",
      sourceType: "ring",
      sourceDeviceId: "raw-oura-ring",
    }],
    timeseries: {
      stress_level: {
        groups: {
          polar: [{
            provider: {
              id: "raw-provider-object",
            },
            source: {
              type: "watch",
              device_id: "raw-polar-watch",
            },
            data: [{
              connectionId: "source-oura",
              timestamp: "2026-04-22T12:45:00Z",
              value: 18,
            }],
          }],
        },
      },
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["stress_level"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction summary resource id stays stable when a same-id summary value changes", () => {
  const buildPayload = (steps: number) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        id: "daily-activity-1",
        sourceProviderSlug: "oura",
        sourceType: "ring",
        observedAt: "2026-04-22T12:00:00Z",
        steps,
        activeCalories: 320,
      }],
    },
  });

  const firstPayload = buildPayload(7200);
  const secondPayload = buildPayload(8100);
  const firstStepEvent = firstPayload.events?.find((event) => event.fields?.metric === "daily-steps");
  const secondStepEvent = secondPayload.events?.find((event) => event.fields?.metric === "daily-steps");
  const firstCaloriesEvent = firstPayload.events?.find((event) => event.fields?.metric === "active-calories");

  assert.match(firstStepEvent?.externalRef?.resourceId ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.equal(secondStepEvent?.externalRef?.resourceId, firstStepEvent?.externalRef?.resourceId);
  assert.equal(firstCaloriesEvent?.externalRef?.resourceId, firstStepEvent?.externalRef?.resourceId);
  assert.equal(firstStepEvent?.externalRef?.facet, "daily-steps");
  assert.equal(firstCaloriesEvent?.externalRef?.facet, "active-calories");
});

test("Junction summary resource id changes for same-provider explicit ids from different source instances", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [
        {
          id: "daily-activity-1",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        },
        {
          id: "daily-activity-1",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        },
      ],
    },
  });

  const stepEvents = payload.events?.filter((event) => event.fields?.metric === "daily-steps") ?? [];
  const resourceIds = stepEvents.map((event) => event.externalRef?.resourceId);

  assert.equal(stepEvents.length, 2);
  assert.deepEqual(stepEvents.map((event) => event.externalRef?.resourceType), [
    "junction-oura-activity",
    "junction-oura-activity",
  ]);
  assert.match(resourceIds[0] ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.match(resourceIds[1] ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.notEqual(resourceIds[0], resourceIds[1]);
});

test("Junction normalizer emits Cronometer meal events with summed nutrition totals", () => {
  const payload = normalizeJunctionSnapshot(makeJunctionCronometerMealSnapshot());
  const meal = payload.events?.find((event) => event.kind === "meal");
  const fields = meal?.fields as {
    ingredients?: string[];
    mealId?: string;
    nutrition?: {
      provenance?: Record<string, unknown>;
      totals?: Record<string, unknown>;
    };
  } | undefined;

  assert.ok(meal);
  assert.equal(meal.title, "Dinner");
  assert.equal(meal.occurredAt, "2019-08-24T18:30:00.000Z");
  assert.equal(meal.dayKey, "2019-08-24");
  assert.equal(meal.externalRef?.system, "junction");
  assert.equal(meal.externalRef?.resourceType, "junction-cronometer-meal");
  assert.equal(meal.externalRef?.facet, "meal");
  assert.equal(meal.dataOrigin?.aggregatorProvider, "junction");
  assert.equal(meal.dataOrigin?.sourceProviderSlug, "cronometer");
  assert.match(fields?.mealId ?? "", /^meal_[0-9A-HJKMNP-TV-Z]{26}$/u);
  assert.deepEqual(fields?.ingredients, [
    "Chicken coquet starter",
    "Coffee, black, 1 tbsp(s)",
  ]);
  assert.deepEqual(fields?.nutrition?.totals, {
    calories: 400,
    proteinGrams: 10,
    carbsGrams: 75,
    fatGrams: 100,
    fiberGrams: 3,
  });
  assert.deepEqual(fields?.nutrition?.provenance, {
    source: "database",
    confidence: "high",
    sourceDetail: "junction:cronometer:meal",
  });
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-meal"));
  assert.deepEqual(payload.provenance?.summaryResources, ["meal"]);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction normalizer emits direct meal nutrition totals when items are absent", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        date: "2019-08-24",
        energy: {
          unit: "kJ",
          value: 418.4,
        },
        id: "direct-totals-meal-1",
        ingredientNames: ["yogurt", "berries"],
        name: "Breakfast",
        nutrition: {
          totals: {
            carbsGrams: 20,
            fatGrams: 4,
            fiberGrams: 3,
            proteinGrams: 12,
          },
        },
        source: { provider: "cronometer", type: "app" },
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");
  const nutrition = meal?.fields?.nutrition as {
    totals?: Record<string, unknown>;
  } | undefined;

  assert.ok(meal);
  assert.equal(meal.title, "Breakfast");
  assert.equal(meal.occurredAt, "2019-08-24T00:00:00.000Z");
  assert.deepEqual(meal.fields?.ingredients, ["yogurt", "berries"]);
  assert.deepEqual(nutrition?.totals, {
    calories: 100,
    proteinGrams: 12,
    carbsGrams: 20,
    fatGrams: 4,
    fiberGrams: 3,
  });
});

test("Junction normalizer preserves name-only meal item ingredients", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        foodItems: [
          { name: "Plain yogurt" },
          { food_name: "Blueberries" },
          "Granola",
        ],
        id: "name-only-food-items-1",
        name: "Breakfast",
        nutrition: {
          totals: {
            calories: 350,
            carbsGrams: 48,
            fatGrams: 8,
            proteinGrams: 18,
          },
        },
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T08:00:00Z",
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");

  assert.equal(meal?.title, "Breakfast");
  assert.deepEqual(meal?.fields?.ingredients, ["Plain yogurt", "Blueberries", "Granola"]);
  assert.deepEqual((meal?.fields?.nutrition as { totals?: Record<string, unknown> } | undefined)?.totals, {
    calories: 350,
    proteinGrams: 18,
    carbsGrams: 48,
    fatGrams: 8,
  });
});

test("Junction normalizer keeps micros-only meal item ingredients", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: {
          Eggs: { energy: { unit: "kcal", value: 140 } },
          Multivitamin: { micros: { minerals: { iron: 8 } } },
        },
        id: "micros-only-item-1",
        name: "Breakfast",
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T08:00:00Z",
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");

  assert.deepEqual(meal?.fields?.ingredients, ["Eggs", "Multivitamin"]);
  assert.deepEqual((meal?.fields?.nutrition as { totals?: Record<string, unknown> } | undefined)?.totals, {
    calories: 140,
  });
});

test("Junction meal micronutrients and water land bounded on the meal event", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: {
          Salmon: {
            energy: { unit: "kcal", value: 320 },
            macros: { protein: 30, water: 80 },
            micros: {
              minerals: { sodium: 0.4, iron: 1.2 },
              trace_elements: { selenium: 38 },
              vitamins: { vitamin_d: 12.5, vitamin_b12: 4.6 },
            },
          },
          Spinach: {
            energy: { unit: "kcal", value: 25 },
            macros: { water: 90 },
            micros: {
              minerals: { iron: 2.7, magnesium: 79, calcium: 0, zinc: null },
              vitamins: { folic_acid: 0.19, made_up_nutrient: 99 },
            },
          },
        },
        id: "micros-meal-1",
        name: "Lunch",
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T12:30:00Z",
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");
  const nutrition = meal?.fields?.nutrition as {
    micros?: Record<string, unknown>;
    totals?: Record<string, unknown>;
  } | undefined;

  assert.ok(meal);
  // Water sums across items like the other macro totals.
  assert.deepEqual(nutrition?.totals, {
    calories: 345,
    proteinGrams: 30,
    waterGrams: 170,
  });
  // Only the documented micro keys land; zero/null entries and undocumented
  // keys stay out, and per-item values sum.
  assert.deepEqual(nutrition?.micros, {
    sodiumGrams: 0.4,
    ironMg: 3.9,
    magnesiumMg: 79,
    seleniumMcg: 38,
    vitaminB12Mcg: 4.6,
    vitaminDMcg: 12.5,
    folicAcidMg: 0.19,
  });
});

test("Junction direct meal micros win over summed item micros", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: {
          Bar: { micros: { minerals: { zinc: 2 } }, energy: { unit: "kcal", value: 200 } },
        },
        id: "direct-micros-meal-1",
        micros: {
          minerals: { zinc: 5 },
          vitamins: { vitamin_c: 60 },
        },
        name: "Snack",
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T15:00:00Z",
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");
  const nutrition = meal?.fields?.nutrition as { micros?: Record<string, unknown> } | undefined;

  assert.deepEqual(nutrition?.micros, {
    zincMg: 5,
    vitaminCMg: 60,
  });
});

test("Junction tier-2 summary events pass the canonical device import contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-tier2-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-05-02T12:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-05-02T00:00:00.000Z",
      summaries: {
        profile: {
          id: "profile-1",
          height: 172,
          birth_date: "1992-03-14",
          sex: "female",
          source: { provider: "apple_health_kit", type: "phone" },
          updated_at: "2026-04-20T09:00:00Z",
        },
        menstrual_cycle: [{
          id: "cycle-1",
          period_start: "2026-04-07",
          period_end: "2026-04-11",
          cycle_end: "2026-05-01",
          menstrual_flow: [{ date: "2026-04-07", flow: "medium" }],
          basal_body_temperature: [{ date: "2026-04-20", value: 36.61 }],
          ovulation_test: [{ date: "2026-04-19", test_result: "positive" }],
          source: { provider: "apple_health", type: "phone" },
        }],
        electrocardiogram: [{
          id: "ecg-1",
          session_start: "2026-04-22T18:00:00Z",
          voltage_sample_count: 15360,
          heart_rate_mean: 62,
          classification: "sinus_rhythm",
          source: { provider: "apple_health_kit", type: "watch" },
        }],
        meal: [{
          calendar_date: "2026-04-22",
          id: "meal-1",
          name: "Lunch",
          energy: { unit: "kcal", value: 500 },
          macros: { protein: 30, water: 200 },
          micros: { minerals: { iron: 4 }, vitamins: { vitamin_c: 30 } },
          source: { provider: "cronometer", type: "app" },
          timestamp: "2026-04-22T12:30:00Z",
        }],
      },
    };

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );

    const kinds = result.events.map((event) => event.kind).sort();
    // Cycle basal body temperature stays raw-only (canonical on the
    // dedicated timeseries), so the fixture's BBT sub-array adds no
    // observation here.
    assert.deepEqual(kinds, [
      "meal",
      "measurement",
      "measurement",
      "measurement",
      "note",
      "observation",
      "observation",
      "observation",
    ]);
    // The additive water/micros nutrition extension survives the canonical
    // core import path (including strict event-record contract validation)
    // end-to-end instead of being stripped on persist.
    const importedMeal = result.events.find((event) => event.kind === "meal") as
      | { nutrition?: { totals?: Record<string, unknown>; micros?: Record<string, unknown> } }
      | undefined;
    assert.equal(importedMeal?.nutrition?.totals?.waterGrams, 200);
    assert.deepEqual(importedMeal?.nutrition?.micros, {
      ironMg: 4,
      vitaminCMg: 30,
    });
    assert.ok(result.rawArtifacts.length >= 1);
    assert.notEqual(result.manifestPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction meal direct nutrition totals win over sparse item totals", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: [{
          energy: { unit: "kcal", value: 0 },
          macros: {
            fiber: 2,
            protein: 0,
          },
          name: "Chicken bowl",
        }],
        id: "sparse-items-with-direct-total-1",
        name: "Lunch",
        nutrition: {
          totals: {
            calories: 650,
            carbsGrams: 50,
            fatGrams: 20,
            proteinGrams: 42,
          },
        },
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T12:00:00Z",
      }],
    },
  });
  const meal = payload.events?.find((event) => event.kind === "meal");

  assert.deepEqual((meal?.fields?.nutrition as { totals?: Record<string, unknown> } | undefined)?.totals, {
    calories: 650,
    proteinGrams: 42,
    carbsGrams: 50,
    fatGrams: 20,
    fiberGrams: 2,
  });
});

test("Junction meal ids stay stable when provider meal nutrition changes", () => {
  const firstMeal = normalizeJunctionSnapshot(
    makeJunctionCronometerMealSnapshot({ chickenCalories: 400, chickenProtein: 10 }),
  ).events?.find((event) => event.kind === "meal");
  const correctedMeal = normalizeJunctionSnapshot(
    makeJunctionCronometerMealSnapshot({ chickenCalories: 425, chickenProtein: 12 }),
  ).events?.find((event) => event.kind === "meal");

  assert.equal(firstMeal?.externalRef?.resourceId, correctedMeal?.externalRef?.resourceId);
  assert.equal(firstMeal?.fields?.mealId, correctedMeal?.fields?.mealId);
  assert.notDeepEqual(firstMeal?.fields?.nutrition, correctedMeal?.fields?.nutrition);
});

test("Junction meal ids prefer Junction summary ids over provider id aliases", () => {
  const buildMeal = (input: { calories: number; junctionId: string; timestamp: string; title: string }) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-22T12:00:00.000Z",
      summaries: {
        meal: [{
          calendar_date: "2019-08-24",
          data: {
            entree: {
              energy: { unit: "kcal", value: input.calories },
            },
          },
          id: input.junctionId,
          name: input.title,
          provider_id: "provider-meal-alias-1",
          source: { provider: "cronometer", type: "app" },
          timestamp: input.timestamp,
        }],
      },
    }).events?.find((event) => event.kind === "meal");

  const firstMeal = buildMeal({
    calories: 400,
    junctionId: "junction-row-1",
    timestamp: "2019-08-24T18:30:00Z",
    title: "Dinner",
  });
  const correctedMeal = buildMeal({
    calories: 425,
    junctionId: "junction-row-2",
    timestamp: "2019-08-24T18:45:00Z",
    title: "Dinner corrected",
  });

  assert.notEqual(firstMeal?.externalRef?.resourceId, correctedMeal?.externalRef?.resourceId);
  assert.notEqual(firstMeal?.fields?.mealId, correctedMeal?.fields?.mealId);
  assert.notEqual(firstMeal?.occurredAt, correctedMeal?.occurredAt);
  assert.notDeepEqual(firstMeal?.fields?.nutrition, correctedMeal?.fields?.nutrition);
});

test("Junction meal ids use provider meal id aliases only when Junction id is absent", () => {
  const buildMeal = (input: { calories: number; timestamp: string; title: string }) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-22T12:00:00.000Z",
      summaries: {
        meal: [{
          calendar_date: "2019-08-24",
          data: {
            entree: {
              energy: { unit: "kcal", value: input.calories },
            },
          },
          name: input.title,
          provider_id: "provider-meal-alias-1",
          source: { provider: "cronometer", type: "app" },
          timestamp: input.timestamp,
        }],
      },
    }).events?.find((event) => event.kind === "meal");

  const firstMeal = buildMeal({
    calories: 400,
    timestamp: "2019-08-24T18:30:00Z",
    title: "Dinner",
  });
  const correctedMeal = buildMeal({
    calories: 425,
    timestamp: "2019-08-24T18:45:00Z",
    title: "Dinner corrected",
  });

  assert.equal(firstMeal?.externalRef?.resourceId, correctedMeal?.externalRef?.resourceId);
  assert.equal(firstMeal?.fields?.mealId, correctedMeal?.fields?.mealId);
  assert.notEqual(firstMeal?.occurredAt, correctedMeal?.occurredAt);
  assert.notDeepEqual(firstMeal?.fields?.nutrition, correctedMeal?.fields?.nutrition);
});

test("Junction no-id meal external refs include fallback title identity", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [
        {
          calendar_date: "2019-08-24",
          data: { entree: { energy: { unit: "kcal", value: 100 } } },
          name: "Breakfast",
          source: { provider: "cronometer", type: "app" },
          timestamp: "2019-08-24T08:00:00Z",
        },
        {
          calendar_date: "2019-08-24",
          data: { entree: { energy: { unit: "kcal", value: 200 } } },
          name: "Lunch",
          source: { provider: "cronometer", type: "app" },
          timestamp: "2019-08-24T08:00:00Z",
        },
      ],
    },
  });
  const meals = payload.events?.filter((event) => event.kind === "meal") ?? [];

  assert.equal(meals.length, 2);
  assert.notEqual(meals[0]?.externalRef?.resourceId, meals[1]?.externalRef?.resourceId);
  assert.notEqual(meals[0]?.fields?.mealId, meals[1]?.fields?.mealId);
});

test("Junction duplicate no-id meal fallbacks get distinct identities", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [
        {
          data: { snack: { energy: { unit: "kcal", value: 140 } } },
          name: "Snack",
          source: { provider: "cronometer", type: "app" },
          timestamp: "2019-08-24T15:00:00Z",
        },
        {
          data: { snack: { energy: { unit: "kcal", value: 220 } } },
          name: "Snack",
          source: { provider: "cronometer", type: "app" },
          timestamp: "2019-08-24T15:00:00Z",
        },
      ],
    },
  });
  const meals = payload.events?.filter((event) => event.kind === "meal") ?? [];

  assert.equal(meals.length, 2);
  assert.equal(meals[0]?.title, "Snack");
  assert.equal(meals[1]?.title, "Snack");
  assert.notEqual(meals[0]?.externalRef?.resourceId, meals[1]?.externalRef?.resourceId);
  assert.notEqual(meals[0]?.fields?.mealId, meals[1]?.fields?.mealId);
});

test("Junction meal data arrays stay meal-internal food items", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: [
          {
            energy: { unit: "kcal", value: 120 },
            name: "Eggs",
          },
          {
            energy: { unit: "kcal", value: 80 },
            name: "Toast",
          },
        ],
        id: "meal-data-array-1",
        name: "Breakfast plate",
        nutrition: {
          totals: {
            carbsGrams: 15,
            fatGrams: 9,
            proteinGrams: 18,
          },
        },
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T08:00:00Z",
      }],
    },
  });
  const meals = payload.events?.filter((event) => event.kind === "meal") ?? [];
  const nutrition = meals[0]?.fields?.nutrition as {
    totals?: Record<string, unknown>;
  } | undefined;

  assert.equal(meals.length, 1);
  assert.equal(meals[0]?.title, "Breakfast plate");
  assert.deepEqual(meals[0]?.fields?.ingredients, ["Eggs", "Toast"]);
  assert.deepEqual(nutrition?.totals, {
    calories: 200,
    proteinGrams: 18,
    carbsGrams: 15,
    fatGrams: 9,
  });
});

test("Junction meal data arrays keep food items with ids and timestamps meal-internal", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: [{
        calendar_date: "2019-08-24",
        data: [
          {
            energy: { unit: "kcal", value: 180 },
            id: "food-row-1",
            name: "Yogurt",
            timestamp: "2019-08-24T08:05:00Z",
          },
          {
            energy: { unit: "kcal", value: 120 },
            id: "food-row-2",
            name: "Granola",
            timestamp: "2019-08-24T08:10:00Z",
          },
        ],
        id: "meal-with-item-row-identities-1",
        name: "Breakfast",
        source: { provider: "cronometer", type: "app" },
        timestamp: "2019-08-24T08:00:00Z",
      }],
    },
  });
  const meals = payload.events?.filter((event) => event.kind === "meal") ?? [];

  assert.equal(meals.length, 1);
  assert.equal(meals[0]?.title, "Breakfast");
  assert.deepEqual(meals[0]?.fields?.ingredients, ["Yogurt", "Granola"]);
  assert.deepEqual((meals[0]?.fields?.nutrition as { totals?: Record<string, unknown> } | undefined)?.totals, {
    calories: 300,
  });
});

test("Junction meal import writes canonical nutrition into a vault", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-meal-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: makeJunctionCronometerMealSnapshot(),
      },
      { corePort: coreRuntime },
    );
    const mealEvent = result.events.find((event) => event.kind === "meal");

    assert.ok(mealEvent);
    if (mealEvent.kind !== "meal") {
      throw new Error("expected a meal event");
    }
    assert.match(mealEvent.mealId, /^meal_[0-9A-HJKMNP-TV-Z]{26}$/u);
    assert.deepEqual(mealEvent.ingredients, ["Chicken coquet starter", "Coffee, black, 1 tbsp(s)"]);
    assert.equal(mealEvent.nutrition?.totals?.calories, 400);
    assert.equal(mealEvent.nutrition?.totals?.proteinGrams, 10);
    assert.equal(mealEvent.nutrition?.provenance?.sourceDetail, "junction:cronometer:meal");
    assert.ok(result.rawArtifacts.some((artifact) => artifact.relativePath.includes("junction-summary-meal")));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction summary resource id for explicit ids includes provider, source type, and source instance provenance", () => {
  const buildPayload = (summary: {
    sourceProviderSlug: string;
    sourceType: string;
    sourceInstanceId: string;
  }) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        id: "daily-activity-1",
        sourceProviderSlug: summary.sourceProviderSlug,
        sourceType: summary.sourceType,
        sourceInstanceId: summary.sourceInstanceId,
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
    },
  }).events?.find((event) => event.fields?.metric === "daily-steps");

  const baseEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "ring",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const providerVariantEvent = buildPayload({
    sourceProviderSlug: "polar",
    sourceType: "ring",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const sourceTypeVariantEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "watch",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const sourceInstanceVariantEvent = buildPayload({
    sourceProviderSlug: "oura",
    sourceType: "ring",
    sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.match(baseEvent?.externalRef?.resourceId ?? "", /^activity-[a-f0-9]{16}$/u);
  assert.notEqual(providerVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
  assert.notEqual(sourceTypeVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
  assert.notEqual(sourceInstanceVariantEvent?.externalRef?.resourceId, baseEvent?.externalRef?.resourceId);
});

test("Junction raw-only timeseries is dropped when a same-key value changes", () => {
  const buildPayload = (value: number) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value,
      }],
    },
  });

  const firstPayload = buildPayload(72);
  const correctedPayload = buildPayload(91);

  assert.equal(firstPayload.samples?.length ?? 0, 0);
  assert.equal(correctedPayload.samples?.length ?? 0, 0);
  assert.deepEqual(firstPayload.events, []);
  assert.deepEqual(correctedPayload.events, []);
  assert.deepEqual(firstPayload.provenance?.timeseriesResources, []);
  assert.deepEqual(correctedPayload.provenance?.timeseriesResources, []);
  assertNoFullJunctionTimeseriesArtifacts(firstPayload);
  assertNoFullJunctionTimeseriesArtifacts(correctedPayload);
});

test("Junction raw-only timeseries source device changes are dropped", () => {
  const buildPayload = (sourceDeviceId: string) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId,
        timestamp: "2026-04-22T07:16:00Z",
        value: 72,
      }],
    },
  });

  const firstPayload = buildPayload("ring-a");
  const secondPayload = buildPayload("ring-b");

  assert.equal(firstPayload.samples?.length ?? 0, 0);
  assert.equal(secondPayload.samples?.length ?? 0, 0);
  assert.deepEqual(firstPayload.events, []);
  assert.deepEqual(secondPayload.events, []);
  assert.deepEqual(firstPayload.provenance?.timeseriesResources, []);
  assert.deepEqual(secondPayload.provenance?.timeseriesResources, []);
  assertNoFullJunctionTimeseriesArtifacts(firstPayload);
  assertNoFullJunctionTimeseriesArtifacts(secondPayload);
});

test("Junction raw-only timeseries resources do not emit raw artifacts", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value: 72,
      }],
      heartrate: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceDeviceId: "ring-a",
        timestamp: "2026-04-22T07:16:00Z",
        value: 54,
      }],
    },
  });

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.deepEqual(payload.events ?? [], []);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction normalizer drops grouped raw-only dense timeseries payloads", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    timeseries: {
      steps: {
        groups: {
          oura: [{
            data: [{
              end: "2026-04-22T14:57:24+00:00",
              start: "2026-04-22T14:30:52+00:00",
              unit: "count",
              value: 123,
            }],
            source: {
              provider: "oura",
              type: "ring",
              name: "Oura Ring",
              device_id: "device-oura-ring-1",
              app_id: "app-oura-cloud-1",
            },
          }],
        },
      },
      distance: {
        groups: {
          oura: [{
            data: [{
              end: "2026-04-22T14:57:24+00:00",
              start: "2026-04-22T14:30:52+00:00",
              unit: "m",
              value: 5.6,
            }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
      heartrate: {
        groups: {
          oura: [{
            data: [{
              timestamp: "2026-04-22T14:30:52+00:00",
              unit: "bpm",
              value: 70,
            }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, []);

  const samples = payload.samples ?? [];
  const rawArtifactText = JSON.stringify(payload.rawArtifacts ?? []);

  assert.equal(samples.length, 0);
  assert.deepEqual(payload.events, []);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.doesNotMatch(rawArtifactText, /Oura Ring|device-oura-ring-1|app-oura-cloud-1/u);
  assert.doesNotMatch(rawArtifactText, /"provider":"oura"|"type":"ring"/u);
  assert.doesNotMatch(rawArtifactText, /"value":123|"value":5.6|"value":70/u);
});

test("Junction normalizer compacts respiratory rate timeseries into daily average facts", async () => {
  const respiratoryRateUnits = [
    undefined,
    "bpm",
    "rpm",
    "breaths/min",
    "breaths/minute",
    "breaths per minute",
    "breaths_per_minute",
  ] as const;

  for (const unit of respiratoryRateUnits) {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      connectionId: "conn-junction-garmin",
      sourceKind: "poll",
      deliveryMode: "scheduled_reconcile",
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        importedAt: "2026-04-22T12:00:00.000Z",
        timeseries: {
          respiratory_rate: {
            groups: {
              garmin: [{
                data: [
                  {
                    timestamp: "2026-04-22T07:15:00Z",
                    ...(unit === undefined ? {} : { unit }),
                    value: 14.8,
                  },
                  {
                    timestamp: "2026-04-22T07:45:00Z",
                    ...(unit === undefined ? {} : { unit }),
                    value: 15.2,
                  },
                ],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          },
        },
      },
    });

    const event = payload.events?.find((entry) => entry.fields?.metric === "respiratory-rate");
    const rawRespiratoryRateArtifact = payload.rawArtifacts?.find((artifact) =>
      artifact.role === "junction-timeseries-respiratory-rate"
    );

    assert.deepEqual(payload.provenance?.timeseriesResources, ["respiratory_rate"]);
    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(event?.kind, "observation");
    assert.equal(event?.dayKey, "2026-04-22");
    assert.equal(event?.fields?.observationGrain, "summary");
    assert.equal(event?.fields?.value, 15);
    assert.equal(event?.fields?.unit, "breaths_per_minute");
    assert.equal(event?.dataOrigin?.sourceProviderSlug, "garmin");
    assert.equal(rawRespiratoryRateArtifact, undefined);
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "respiratory-rate").length, 1);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  }
});

test("Junction normalizer compacts HRV timeseries into daily average facts", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      hrv: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T02:30:00Z", unit: "rmssd", value: 44 },
              { timestamp: "2026-04-22T05:30:00Z", unit: "rmssd", value: 52 },
              { timestamp: "2026-04-23T03:00:00Z", unit: "rmssd", value: 61 },
              { timestamp: "2026-04-23T04:00:00Z", unit: "rmssd", value: 1200 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const hrvEvents = payload.events?.filter((event) => event.fields?.metric === "hrv") ?? [];
  const dayOne = hrvEvents.find((event) => event.dayKey === "2026-04-22");
  const dayTwo = hrvEvents.find((event) => event.dayKey === "2026-04-23");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["hrv"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "hrv").length, 2);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.equal(hrvEvents.length, 2);
  assert.equal(dayOne?.fields?.value, 48);
  assert.equal(dayOne?.fields?.unit, "ms");
  assert.equal(dayOne?.fields?.observationGrain, "summary");
  assert.equal(dayOne?.dataOrigin?.sourceProviderSlug, "garmin");
  // 1200 is out of plausible range and must not skew the day-two average.
  assert.equal(dayTwo?.fields?.value, 61);
});

test("Junction normalizer compacts VO2 max interval timeseries into daily facts", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      vo2_max: {
        groups: {
          garmin: [{
            data: [
              {
                start: "2026-04-22T00:00:00Z",
                end: "2026-04-22T15:30:00Z",
                unit: "mL/kg/min",
                value: 46.2,
              },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const vo2Event = payload.events?.find((event) => event.fields?.metric === "estimated-vo2-max");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["vo2_max"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "vo2-max").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.equal(vo2Event?.kind, "observation");
  assert.equal(vo2Event?.dayKey, "2026-04-22");
  assert.equal(vo2Event?.fields?.observationGrain, "summary");
  assert.equal(vo2Event?.fields?.value, 46.2);
  assert.equal(vo2Event?.fields?.unit, "ml/kg/min");
  assert.equal(vo2Event?.dataOrigin?.sourceProviderSlug, "garmin");
});

test("Junction normalizer compacts tier-1 timeseries resources into bounded daily facts", () => {
  const cases: readonly {
    resource: string;
    resourceSlug: string;
    metric: string;
    unit: string;
    expectedValue: number;
    values: readonly number[];
    implausibleValue: number;
  }[] = [
    {
      resource: "body_temperature_delta",
      resourceSlug: "body-temperature-delta",
      metric: "temperature-deviation",
      unit: "celsius",
      // Negative wrist-temperature deviations are valid and must average.
      expectedValue: -0.75,
      values: [-1, -0.5],
      implausibleValue: 9,
    },
    {
      resource: "body_temperature",
      resourceSlug: "body-temperature",
      metric: "temperature",
      unit: "celsius",
      expectedValue: 36.8,
      values: [36.5, 37.1],
      implausibleValue: 65,
    },
    {
      resource: "basal_body_temperature",
      resourceSlug: "basal-body-temperature",
      metric: "basal-body-temperature",
      unit: "celsius",
      expectedValue: 36.7,
      values: [36.7],
      implausibleValue: 20,
    },
    {
      // Junction documents caffeine in grams; the daily SUM lands in mg.
      resource: "caffeine",
      resourceSlug: "caffeine",
      metric: "caffeine",
      unit: "mg",
      expectedValue: 158,
      values: [0.095, 0.063],
      implausibleValue: 3,
    },
    {
      resource: "water",
      resourceSlug: "water",
      metric: "water",
      unit: "ml",
      expectedValue: 1000,
      values: [400, 600],
      implausibleValue: 50_000,
    },
    {
      resource: "mindfulness_minutes",
      resourceSlug: "mindfulness-minutes",
      metric: "mindfulness-minutes",
      unit: "minutes",
      expectedValue: 25,
      values: [10, 15],
      implausibleValue: 2000,
    },
    {
      resource: "heart_rate_recovery_one_minute",
      resourceSlug: "heart-rate-recovery-one-minute",
      metric: "heart-rate-recovery-one-minute",
      unit: "bpm",
      expectedValue: 32,
      values: [30, 34],
      implausibleValue: 400,
    },
    {
      resource: "sleep_breathing_disturbance",
      resourceSlug: "sleep-breathing-disturbance",
      metric: "sleep-breathing-disturbance",
      unit: "count",
      expectedValue: 12,
      values: [12],
      implausibleValue: 999,
    },
    {
      resource: "afib_burden",
      resourceSlug: "afib-burden",
      metric: "afib-burden",
      unit: "%",
      expectedValue: 3,
      values: [3],
      implausibleValue: 250,
    },
  ];

  for (const testCase of cases) {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        [testCase.resource]: {
          groups: {
            apple_health_kit: [{
              data: [
                ...testCase.values.map((value, index) => ({
                  start: `2026-04-22T0${index}:30:00Z`,
                  end: `2026-04-22T0${index}:45:00Z`,
                  value,
                })),
                // Outside the plausibility window; must not skew the day.
                {
                  start: "2026-04-22T06:30:00Z",
                  end: "2026-04-22T06:45:00Z",
                  value: testCase.implausibleValue,
                },
              ],
              source: { provider: "apple_health_kit", type: "watch" },
            }],
          },
        },
      },
    });

    const event = payload.events?.find((entry) => entry.fields?.metric === testCase.metric);

    assert.deepEqual(payload.provenance?.timeseriesResources, [testCase.resource], testCase.resource);
    assert.equal(payload.samples?.length ?? 0, 0, testCase.resource);
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, testCase.resourceSlug).length, 1, testCase.resource);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.equal(event?.kind, "observation", testCase.resource);
    assert.equal(event?.dayKey, "2026-04-22", testCase.resource);
    assert.equal(event?.fields?.observationGrain, "summary", testCase.resource);
    assert.equal(event?.fields?.value, testCase.expectedValue, testCase.resource);
    assert.equal(event?.fields?.unit, testCase.unit, testCase.resource);
    assert.equal(event?.dataOrigin?.sourceProviderSlug, "apple-health-kit", testCase.resource);
  }
});

test("Junction normalizer compacts dense CGM glucose timeseries into daily mean/min/max facts", () => {
  // A full CGM day: 288 five-minute samples must reduce to one compact
  // daily-aggregate artifact plus three daily observations, never raw dumps.
  const samples = Array.from({ length: 288 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 22, 0, 0, 0) + index * 5 * 60_000).toISOString(),
    unit: "mmol/L",
    value: index % 2 === 0 ? 5 : 7,
  }));

  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [
              ...samples,
              // mg/dL-scale value despite the documented mmol/L
              // normalization: outside the window, dropped fail-closed.
              { timestamp: "2026-04-22T12:02:00Z", unit: "mmol/L", value: 100 },
            ],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });

  const glucoseEvents = payload.events ?? [];
  const mean = glucoseEvents.find((event) => event.fields?.metric === "glucose");
  const min = glucoseEvents.find((event) => event.fields?.metric === "lowest-glucose");
  const max = glucoseEvents.find((event) => event.fields?.metric === "highest-glucose");
  const artifacts = findJunctionCompactTimeseriesArtifacts(payload, "glucose");
  const artifactContent = artifacts[0]?.content as Record<string, unknown>;

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(glucoseEvents.length, 3);
  assert.equal(artifacts.length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  // Junction normalizes glucose to mmol/L; values convert to mg/dL.
  assert.equal(mean?.fields?.value, 108.1092);
  assert.equal(mean?.fields?.unit, "mg/dL");
  assert.equal(min?.fields?.value, 90.091);
  assert.equal(max?.fields?.value, 126.1274);
  assert.equal(mean?.dayKey, "2026-04-22");
  assert.equal(artifactContent.sampleCount, 288);
  assert.equal(artifactContent.minValue, 90.091);
  assert.equal(artifactContent.maxValue, 126.1274);
  // Size bound: a whole CGM day stays one sub-kilobyte compact artifact.
  assert.ok(JSON.stringify(artifactContent).length < 1024);
});

test("Junction normalizer lands sparse paired blood pressure readings as measurement events", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_pressure: {
        groups: {
          omron: [{
            data: [
              { timestamp: "2026-04-22T08:05:00Z", systolic: 125, diastolic: 75, unit: "mmHg" },
              // Same-second second reading: paired values are part of the
              // reading identity, so it must not collapse into the first.
              { timestamp: "2026-04-22T08:05:00Z", systolic: 118, diastolic: 79, unit: "mmHg" },
              // Implausible pairs fail closed: systolic must exceed
              // diastolic and both must sit inside their windows.
              { timestamp: "2026-04-22T22:00:00Z", systolic: 80, diastolic: 95, unit: "mmHg" },
              { timestamp: "2026-04-22T22:10:00Z", systolic: 350, diastolic: 75, unit: "mmHg" },
            ],
            source: { provider: "omron", type: "cuff" },
          }],
        },
      },
    },
  });

  const readings = (payload.events ?? []).filter((event) => event.kind === "measurement");
  const firstMeasurements = readings[0]?.fields?.measurements;

  assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_pressure"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(readings.length, 2);
  assert.equal(findJunctionBloodPressureReadingArtifacts(payload).length, 2);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.deepEqual(firstMeasurements, [
    { metric: "systolic-blood-pressure", value: 125, unit: "mmHg" },
    { metric: "diastolic-blood-pressure", value: 75, unit: "mmHg" },
  ]);
  assert.equal(readings[0]?.occurredAt, "2026-04-22T08:05:00.000Z");
  assert.equal(readings[0]?.dayKey, "2026-04-22");
  assert.equal(readings[0]?.dataOrigin?.sourceProviderSlug, "omron");
  assert.ok(readings.every((event) => event.externalRef?.system === "junction"));
  // Distinct same-second readings keep distinct identities.
  assert.notEqual(readings[0]?.externalRef?.resourceId, readings[1]?.externalRef?.resourceId);
  const artifactText = JSON.stringify(findJunctionBloodPressureReadingArtifacts(payload));
  assert.doesNotMatch(artifactText, /"value":350|"systolic":350|"diastolic":95/u);
});

test("Junction blood pressure evidence is replay- and order-idempotent", () => {
  const reading = (timestamp: string, systolic: number, diastolic: number) =>
    ({ timestamp, systolic, diastolic, unit: "mmHg" });
  const snapshot = (data: object[]) => normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_pressure: {
        groups: { omron: [{ data, source: { provider: "omron", type: "cuff" } }] },
      },
    },
  });
  const first = reading("2026-04-22T08:05:00Z", 125, 75);
  const second = reading("2026-04-22T20:30:00Z", 118, 79);

  // Exact duplicate rows inside one payload collapse to one event and one
  // raw artifact instead of staging duplicate evidence.
  const withDuplicate = snapshot([first, { ...first }, second]);
  assert.equal(
    (withDuplicate.events ?? []).filter((event) => event.kind === "measurement").length,
    2,
  );
  assert.equal(findJunctionBloodPressureReadingArtifacts(withDuplicate).length, 2);

  // Reordering the same readings yields identical raw roles: the role
  // derives from the reading identity, never the payload index, so replays
  // stage identical evidence for the externalRef-deduped event.
  const ordered = snapshot([first, second]);
  const reversed = snapshot([second, first]);
  const roles = (payload: ReturnType<typeof normalizeJunctionSnapshot>) =>
    findJunctionBloodPressureReadingArtifacts(payload).map((artifact) => artifact.role).sort();
  assert.deepEqual(roles(ordered), roles(reversed));
});

test("Junction normalizer keeps compact evidence when every blood pressure reading is implausible", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_pressure: {
        groups: {
          omron: [{
            data: [
              { timestamp: "2026-04-22T08:05:00Z", systolic: 80, diastolic: 95, unit: "mmHg" },
            ],
            source: { provider: "omron", type: "cuff" },
          }],
        },
      },
    },
  });

  const artifacts = findJunctionBloodPressureReadingArtifacts(payload);

  assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_pressure"]);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.role, "junction-timeseries-reading-blood-pressure:no-valid-samples");
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.doesNotMatch(JSON.stringify(artifacts), /"systolic":80|"diastolic":95/u);
});

test("Junction normalizer derives display-grade blood oxygen facts from timeseries unit aliases", async () => {
  const bloodOxygenUnits = [
    undefined,
    "spo2",
    "sp_o2",
    "sp-o2",
    "blood_oxygen",
    "oxygen_saturation",
    "percent",
    "percentage",
    "spo2_percent",
  ] as const;

  for (const unit of bloodOxygenUnits) {
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      connectionId: "conn-junction-garmin",
      sourceKind: "poll",
      deliveryMode: "scheduled_reconcile",
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        importedAt: "2026-04-22T12:00:00.000Z",
        timeseries: {
          blood_oxygen: {
            groups: {
              garmin: [{
                data: [{
                  timestamp: "2026-04-22T07:15:00Z",
                  ...(unit === undefined ? {} : { unit }),
                  value: 97.2,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          },
        },
      },
    });

    const meanEvent = payload.events?.find((entry) => entry.fields?.metric === "spo2");
    const minimumEvent = payload.events?.find((entry) => entry.fields?.metric === "lowest-spo2");
    const [compactArtifact] = findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen");
    const compactArtifactContent = compactArtifact?.content as Record<string, unknown> | undefined;
    const compactArtifactText = JSON.stringify(compactArtifactContent ?? {});

    assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_oxygen"]);
    assert.equal(payload.samples?.length ?? 0, 0);
    assert.ok(compactArtifact);
    assert.equal(compactArtifactContent?.sampleCount, 1);
    assert.equal(compactArtifactContent?.meanValue, 97.2);
    assert.equal(compactArtifactContent?.minValue, 97.2);
    assert.equal(Object.hasOwn(compactArtifactContent ?? {}, "data"), false);
    assert.equal(Object.hasOwn(compactArtifactContent ?? {}, "records"), false);
    assert.equal(Object.hasOwn(compactArtifactContent ?? {}, "items"), false);
    assert.equal(Buffer.byteLength(compactArtifactText, "utf8") < 16_384, true);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.equal(meanEvent?.fields?.value, 97.2);
    assert.equal(meanEvent?.fields?.unit, "%");
    assertCompactSummaryObservationFields(meanEvent?.fields);
    assert.equal(meanEvent?.dataOrigin?.sourceProviderSlug, "garmin");
    assert.equal(minimumEvent?.fields?.value, 97.2);
    assertCompactSummaryObservationFields(minimumEvent?.fields);
  }
});

test("Junction compact timeseries with no valid samples avoids provider-snapshot fallback", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-garmin",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-22T12:00:00.000Z",
      timeseries: {
        blood_oxygen: {
          groups: {
            garmin: [{
              data: [
                { timestamp: "2026-04-22T07:15:00Z", value: 120 },
                { timestamp: "2026-04-22T07:45:00Z", value: "not-a-number" },
              ],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    },
  });

  const [compactArtifact] = findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen");
  const compactArtifactContent = compactArtifact?.content as Record<string, unknown> | undefined;
  const rawArtifactText = JSON.stringify(payload.rawArtifacts ?? []);

  assert.ok(compactArtifact);
  assert.equal(compactArtifactContent?.status, "no_valid_samples");
  assert.equal(compactArtifactContent?.sampleCount, 0);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertJsonOmits(rawArtifactText, [
    "\"value\":120",
    "not-a-number",
    "\"data\"",
    "\"records\"",
    "\"items\"",
  ]);
});

test("Junction normalizer compacts blood oxygen timeseries into daily average and minimum facts", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T07:15:00Z", unit: "percent", value: 97.2 },
              { timestamp: "2026-04-22T07:45:00Z", unit: "percent", value: 92.5 },
              { timestamp: "2026-04-22T08:15:00Z", unit: "percent", value: 98.1 },
              { timestamp: "2026-04-23T07:15:00Z", unit: "percent", value: 96.4 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const events = payload.events ?? [];
  const dayOneMean = events.find((event) =>
    event.dayKey === "2026-04-22" && event.fields?.metric === "spo2"
  );
  const dayOneMinimum = events.find((event) =>
    event.dayKey === "2026-04-22" && event.fields?.metric === "lowest-spo2"
  );
  const dayTwoMean = events.find((event) =>
    event.dayKey === "2026-04-23" && event.fields?.metric === "spo2"
  );
  const bloodOxygenEvents = events.filter((event) =>
    event.fields?.metric === "spo2" || event.fields?.metric === "lowest-spo2"
  );

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(bloodOxygenEvents.length, 4);
  assert.equal(dayOneMean?.fields?.value, 95.9333);
  assertCompactSummaryObservationFields(dayOneMean?.fields);
  assert.equal(dayOneMinimum?.fields?.value, 92.5);
  assertCompactSummaryObservationFields(dayOneMinimum?.fields);
  assert.equal(dayTwoMean?.fields?.value, 96.4);
  assertCompactSummaryObservationFields(dayTwoMean?.fields);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen").length, 2);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction blood oxygen aggregates pass the canonical device import contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-blood-oxygen-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      timeseries: {
        blood_oxygen: {
          groups: {
            garmin: [{
              data: [
                { timestamp: "2026-04-22T07:15:00Z", unit: "percent", value: 97 },
                { timestamp: "2026-04-22T07:45:00Z", unit: "percent", value: 93 },
              ],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    };
    const payload = normalizeJunctionSnapshot(snapshot);

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const observationEvents = result.events.filter((event) => event.kind === "observation");
    const spo2Event = observationEvents.find((event) => event.metric === "spo2");
    const lowestSpo2Event = observationEvents.find((event) => event.metric === "lowest-spo2");

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(spo2Event?.observationGrain, "summary");
    assert.equal(spo2Event?.value, 95);
    assert.equal(lowestSpo2Event?.observationGrain, "summary");
    assert.equal(lowestSpo2Event?.value, 93);
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen").length, 1);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.ok(result.rawArtifacts.length >= 1);
    assert.notEqual(result.manifestPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction normalizer derives blood oxygen aggregates from aliases and skips invalid samples", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T07:15:00Z", spo2: 0.972 },
              { timestamp: "2026-04-22T07:45:00Z", bloodOxygen: 94.6 },
              { timestamp: "2026-04-22T08:15:00Z", oxygen_saturation: 120 },
              { timestamp: "2026-04-22T08:45:00Z", value: 0 },
            ],
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          }],
        },
      },
    },
  });

  const bloodOxygenEvents = payload.events?.filter((event) =>
    event.fields?.metric === "spo2" || event.fields?.metric === "lowest-spo2"
  ) ?? [];
  const meanEvent = bloodOxygenEvents.find((event) => event.fields?.metric === "spo2");
  const minimumEvent = bloodOxygenEvents.find((event) => event.fields?.metric === "lowest-spo2");

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(bloodOxygenEvents.length, 2);
  assert.equal(meanEvent?.fields?.value, 95.9);
  assertCompactSummaryObservationFields(meanEvent?.fields);
  assert.equal(meanEvent?.dataOrigin?.sourceProviderSlug, "garmin");
  assert.equal(meanEvent?.dataOrigin?.sourceType, "watch");
  assert.equal(minimumEvent?.fields?.value, 94.6);
  assertCompactSummaryObservationFields(minimumEvent?.fields);
});

test("Junction snapshot import minimizes grouped source identifiers in raw receipts", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-22T12:00:00.000Z",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-22T23:59:59.000Z",
      connections: [
        {
          id: "connection-oura-raw",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          name: "Connection Oura Ring",
          display_name: "Connection Display Oura Ring",
          sourceDeviceId: "connection-device-oura-ring-1",
          sourceAppId: "connection-app-oura-cloud-1",
        },
      ],
      summaries: {
        profile: {
          connectionId: "connection-oura-raw",
          sourceProviderSlug: "oura",
          sourceType: "ring",
          displayName: "Profile Oura Ring",
        },
        activity: [{
          connectionId: "activity-connection-raw",
          providerConnectionId: "activity-provider-connection-raw",
          sourceId: "activity-source-raw",
          sourceInstanceId: "activity-source-instance-raw",
          sourceProviderSlug: "oura",
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
          appID: "activity-app-id-acronym",
          deviceID: "activity-device-id-acronym",
          "source-app-id": "activity-source-app-id-dashed",
          sourceDeviceID: "activity-source-device-id-acronym",
        }],
      },
      timeseries: {
        steps: {
          groups: {
            oura: [{
              data: [{
                end: "2026-04-22T14:57:24+00:00",
                start: "2026-04-22T14:30:52+00:00",
                unit: "count",
                value: 123,
                connection_id: "timeseries-connection-raw",
                source_id: "timeseries-source-raw",
                source_instance_id: "timeseries-source-instance-raw",
              }],
              source: {
                id: "nested-source-id-raw",
                uuid: "nested-source-uuid-raw",
                provider: "oura",
                type: "ring",
                name: "Timeseries Oura Ring",
                appID: "timeseries-app-id-acronym",
                device_id: "timeseries-device-oura-ring-1",
                deviceID: "timeseries-device-id-acronym",
                app_id: "timeseries-app-oura-cloud-1",
                "source-app-id": "timeseries-source-app-id-dashed",
                sourceDeviceID: "timeseries-source-device-id-acronym",
                providerDetails: "kept-non-identity-detail",
              },
              provider: {
                id: "nested-provider-id-raw",
                name: "Nested Provider Oura Ring",
                display_name: "Nested Provider Display Oura Ring",
              },
            }],
          },
        },
      },
    },
  });

  const rawReceipt = readRawReceiptArtifact(payload);
  const rawReceiptArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === `wearable-raw-receipt:${rawReceipt.id}`
  );
  const rawReceiptText = JSON.stringify(rawReceipt);
  const rawReceiptArtifactText = JSON.stringify(rawReceiptArtifact?.content);
  const rawArtifactText = JSON.stringify(payload.rawArtifacts);
  const rawIdentifierSentinels = [
    "Timeseries Oura Ring",
    "timeseries-device-oura-ring-1",
    "timeseries-device-id-acronym",
    "timeseries-app-oura-cloud-1",
    "timeseries-app-id-acronym",
    "timeseries-source-app-id-dashed",
    "timeseries-source-device-id-acronym",
    "nested-source-id-raw",
    "nested-source-uuid-raw",
    "nested-provider-id-raw",
    "Nested Provider Oura Ring",
    "Nested Provider Display Oura Ring",
    "Connection Oura Ring",
    "Connection Display Oura Ring",
    "connection-device-oura-ring-1",
    "connection-app-oura-cloud-1",
    "Profile Oura Ring",
    "activity-connection-raw",
    "activity-provider-connection-raw",
    "activity-source-raw",
    "activity-source-instance-raw",
    "activity-app-id-acronym",
    "activity-device-id-acronym",
    "activity-source-app-id-dashed",
    "activity-source-device-id-acronym",
    "timeseries-connection-raw",
    "timeseries-source-raw",
    "timeseries-source-instance-raw",
  ];

  assert.equal(Object.hasOwn(rawReceipt, "payload"), false);
  assert.equal(rawReceipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.ok(rawReceiptArtifact);
  assert.deepEqual(rawReceipt.rawArtifactRoles, [
    "junction-summary-profile",
    "junction-summary-activity",
  ]);
  assert.equal(rawReceipt.rawArtifactCount, 2);
  assert.equal(rawReceipt.rawArtifactRoles.some((role) => role.startsWith("wearable-raw-receipt:")), false);
  assertJsonOmits(rawReceiptText, [...rawIdentifierSentinels, "\"sourceProviderSlug\"", "\"sourceType\"", "\"value\":123"]);
  assert.equal(rawReceiptArtifact?.content, rawReceipt);
  assertJsonOmits(rawReceiptArtifactText, [...rawIdentifierSentinels, "\"sourceProviderSlug\"", "\"sourceType\"", "\"value\":123"]);
  assertJsonOmits(rawArtifactText, rawIdentifierSentinels);
  assert.match(rawReceiptText, /"provider":"junction"/u);
  assert.match(rawArtifactText, /"sourceProviderSlug":"oura"/u);
  assert.match(rawArtifactText, /"sourceType":"ring"/u);
  assert.doesNotMatch(rawArtifactText, /"value":123/u);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction importer drops floating-timestamp glucose records without retaining raw samples", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2023-09-27T12:00:00.000Z",
      windowStart: "2023-09-27T00:00:00.000Z",
      windowEnd: "2023-09-27T23:59:59.000Z",
      timeseries: {
        glucose: [
          {
            sourceProviderSlug: "freestyle_libre",
            timestamp: "2023-09-27T07:48:00+00:00",
            value: 101,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            timestamp: "2023-09-27T07:48:00+00:00",
            value: 102,
          },
        ],
      },
    },
  });

  const glucoseSamples = payload.samples?.filter((sample) => sample.stream === "glucose") ?? [];
  const glucoseArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-timeseries-glucose"
  );

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(glucoseSamples.length, 0);
  assert.equal(glucoseArtifact, undefined);
  assert.equal(
    payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-daily-glucose:no-valid-samples"),
    true,
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.doesNotMatch(JSON.stringify(payload.rawArtifacts), /"value":101|"value":102/u);
  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
});

test("Junction importer skips source-specific floating summary records instead of using window fallback", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2023-09-27T12:00:00.000Z",
      windowStart: "2023-09-27T00:00:00.000Z",
      windowEnd: "2023-09-27T23:59:59.000Z",
      summaries: {
        body: [
          {
            sourceProviderSlug: "freestyle_libre",
            observedAt: "2023-09-27T07:48:00+00:00",
            weight_kg: 82,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            observedAt: "2023-09-27T07:48:00+00:00",
            weight_kg: 83,
          },
        ],
      },
    },
  });

  const bodyArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-body");
  assert.deepEqual(payload.provenance?.summaryResources, ["body"]);
  assert.deepEqual(payload.events, []);
  assert.ok(bodyArtifact);
  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
});

test("Junction normalizer does not use source-specific floating timestamps as window times", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2023-09-27T12:00:00.000Z",
    windowStart: "2023-09-27T00:00:00.000Z",
    windowEnd: "2023-09-27T23:59:59.000Z",
    timeseries: {
      weight: [{
        sourceProviderSlug: "abbott_libreview",
        timestamp: "2023-09-27T07:48:00+00:00",
        value: 82,
      }],
    },
  });

  assert.equal(payload.events?.some((event) => event.fields?.metric === "weight"), false);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction normalizer resolves nested source and provider slug origin fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: {
        source: {
          provider: "oura",
          type: "ring",
          device_id: "raw-ring-device",
          app_id: "raw-oura-app",
        },
        data: [{
          observedAt: "2026-04-22T12:00:00Z",
          steps: 7200,
        }],
      },
      body: [{
        provider_slug: "withings",
        source_type: "scale",
        observedAt: "2026-04-22T12:30:00Z",
        weight_kg: 82.4,
      }],
    },
    timeseries: {
      heartrate: {
        groups: {
          polar: [{
            provider: {
              id: "raw-provider-object",
            },
            source: {
              type: "watch",
              device_id: "raw-polar-watch",
            },
            data: [{
              timestamp: "2026-04-22T12:45:00Z",
              value: 61,
            }],
          }],
        },
      },
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(stepEvent?.dataOrigin?.sourceType, "ring");
  assert.match(stepEvent?.dataOrigin?.sourceInstanceId ?? "", /^source-[a-f0-9]{24}$/u);
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId?.includes("raw-ring-device"), false);
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId?.includes("raw-oura-app"), false);

  const bodyEvent = payload.events?.find((event) => event.fields?.metric === "weight");
  assert.equal(bodyEvent?.dataOrigin?.sourceProviderSlug, "withings");
  assert.equal(bodyEvent?.dataOrigin?.sourceType, "scale");

  assert.equal(payload.samples?.length ?? 0, 0);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction normalizer unwraps object-valued data envelopes into usable records", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      activity: {
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        observedAt: "2026-05-20T12:00:00Z",
        data: {
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
          sleepScore: 82,
        },
      },
    },
    timeseries: {
      respiratory_rate: {
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        timestamp: "2026-05-20T07:15:00Z",
        data: {
          value: 14.8,
        },
      },
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  const sleepSession = payload.events?.find((event) => event.kind === "sleep_session");
  const sleepScore = payload.events?.find((event) => event.fields?.metric === "sleep-score");
  const respiratoryRate = payload.events?.find((event) => event.fields?.metric === "respiratory-rate");
  const respiratoryArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-timeseries-respiratory-rate"
  );

  assert.equal(stepEvent?.fields?.value, 7200);
  assert.equal(stepEvent?.occurredAt, "2026-05-20T12:00:00.000Z");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "garmin");
  assert.equal(stepEvent?.dataOrigin?.sourceType, "watch");
  assert.equal(sleepSession?.fields?.durationMinutes, 480);
  assert.equal(sleepSession?.occurredAt, "2026-05-20T02:00:00.000Z");
  assert.equal(sleepScore?.fields?.value, 82);
  assert.equal(respiratoryRate?.fields?.value, 14.8);
  assert.equal(respiratoryRate?.dayKey, "2026-05-20");
  assert.deepEqual(payload.provenance?.summaryResources, ["activity", "sleep"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["respiratory_rate"]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep"));
  assert.equal(respiratoryArtifact, undefined);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "respiratory-rate").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction normalizer unwraps meals envelopes into individual records", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      meal: {
        meals: [
          {
            calendar_date: "2019-08-24",
            data: { entree: { energy: { unit: "kcal", value: 100 } } },
            id: "meal-envelope-1",
            name: "Breakfast",
            source: { provider: "cronometer", type: "app" },
            timestamp: "2019-08-24T08:00:00Z",
          },
          {
            calendar_date: "2019-08-24",
            data: { entree: { energy: { unit: "kcal", value: 200 } } },
            id: "meal-envelope-2",
            name: "Lunch",
            source: { provider: "cronometer", type: "app" },
            timestamp: "2019-08-24T12:00:00Z",
          },
        ],
      },
    },
  });

  const meals = payload.events?.filter((event) => event.kind === "meal") ?? [];

  assert.deepEqual(meals.map((event) => event.title), ["Breakfast", "Lunch"]);
  assert.deepEqual(
    meals.map((event) => event.fields?.nutrition).map((nutrition) =>
      (nutrition as { totals?: { calories?: number } } | undefined)?.totals?.calories
    ),
    [100, 200],
  );
});

test("Junction normalizer defaults to the documented resource allowlist", () => {
  assert.deepEqual([...JUNCTION_DEFAULT_SUMMARY_RESOURCES], [
    "activity",
    "sleep",
    "sleep_cycle",
    "workouts",
    "body",
    "meal",
    "profile",
    "menstrual_cycle",
    "electrocardiogram",
  ]);
  assert.deepEqual([...JUNCTION_DEFAULT_TIMESERIES_RESOURCES], [
    "blood_oxygen",
    "stress_level",
    "hrv",
    "respiratory_rate",
    "vo2_max",
    "body_temperature_delta",
    "body_temperature",
    "basal_body_temperature",
    "caffeine",
    "water",
    "mindfulness_minutes",
    "heart_rate_recovery_one_minute",
    "sleep_breathing_disturbance",
    "afib_burden",
    "glucose",
    "blood_pressure",
  ]);
  assert.deepEqual([...JUNCTION_OPT_IN_SUMMARY_RESOURCES], []);
  assert.deepEqual([...JUNCTION_OPT_IN_TIMESERIES_RESOURCES], []);
  assert.deepEqual([...JUNCTION_RAW_ONLY_SUMMARY_RESOURCES], []);
  assert.deepEqual([...JUNCTION_ALLOWED_SUMMARY_RESOURCES], [
    ...JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  ]);
  assert.deepEqual([...JUNCTION_ALLOWED_TIMESERIES_RESOURCES], [...JUNCTION_DEFAULT_TIMESERIES_RESOURCES]);

  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: Object.fromEntries(JUNCTION_DEFAULT_SUMMARY_RESOURCES.map((resource) => [
      resource,
      {
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 1,
      },
    ])),
    timeseries: Object.fromEntries(JUNCTION_DEFAULT_TIMESERIES_RESOURCES.map((resource) => [
      resource,
      [makeJunctionDefaultTimeseriesSample(resource)],
    ])),
  });

  assert.equal(payload.provider, "junction");
  assert.deepEqual(payload.provenance?.summaryResources, JUNCTION_DEFAULT_SUMMARY_RESOURCES);
  assert.deepEqual(payload.provenance?.timeseriesResources, JUNCTION_DEFAULT_TIMESERIES_RESOURCES);
  assert.equal((JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes("heartrate"), false);
  assert.equal((JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes("weight"), false);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-profile"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-menstrual-cycle"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  for (const dailyResourceSlug of [
    "blood-oxygen",
    "hrv",
    "respiratory-rate",
    "vo2-max",
    "body-temperature-delta",
    "body-temperature",
    "basal-body-temperature",
    "caffeine",
    "water",
    "mindfulness-minutes",
    "heart-rate-recovery-one-minute",
    "sleep-breathing-disturbance",
    "afib-burden",
    "glucose",
  ]) {
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, dailyResourceSlug).length, 1, dailyResourceSlug);
  }
  assert.equal(findJunctionBloodPressureReadingArtifacts(payload).length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.ok(payload.events?.every((event) => event.externalRef?.system === "junction"));
  assert.equal(payload.events?.some((event) => event.fields?.metric === "weight"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "active-calories"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "distance"), false);
  assert.equal(payload.samples?.length ?? 0, 0);

  const sparseProfilePayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        sourceProviderSlug: "oura",
        displayName: "profile display name should not be retained",
      },
    },
  });

  assert.deepEqual(sparseProfilePayload.provenance?.summaryResources, ["profile"]);
  assert.ok(sparseProfilePayload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-profile"));
  assert.equal(sparseProfilePayload.events?.length ?? 0, 0);
});

test("Junction normalizer maps menstrual cycle summaries to cycle and daily facets", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-02T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "cycle-1",
        created_at: "2026-04-01T12:00:00Z",
        updated_at: "2026-05-01T12:00:00Z",
        cycle_end: "2026-05-01",
        period_start: "2026-04-07",
        period_end: "2026-04-11",
        menstrual_flow: [
          { date: "2026-04-07", flow: "light" },
          { date: "2026-04-10", flow: "medium" },
          { date: "2026-04-11", flow: "unspecified" },
        ],
        basal_body_temperature: [
          { date: "2026-04-20", value: 36.61 },
          { date: "2026-04-21", value: 98.2 },
        ],
        ovulation_test: [
          { date: "2026-04-19", test_result: "luteinizing_hormone_surge" },
          // Same-day second test with a different result must keep its own
          // identity (the classic negative-then-surge pattern).
          { date: "2026-04-19", test_result: "negative" },
          { date: "2026-04-22", test_result: "indeterminate" },
        ],
        home_pregnancy_test: [
          { date: "2026-04-28", test_result: "negative" },
        ],
        detected_deviations: [
          { date: "2026-04-30", deviation: "irregular_menstrual_cycles" },
        ],
        sexual_activity: [{ date: "2026-04-13", protection_used: true }],
        source: {
          provider: "apple_health",
          type: "phone",
          sourceAppID: "raw-cycle-source-app",
          sourceName: "raw-cycle-source-name",
        },
      }, {
        id: "cycle-2-predicted",
        is_predicted: true,
        period_start: "2026-05-05",
        period_end: "2026-05-09",
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });
  const events = payload.events ?? [];
  const observationByMetric = new Map(
    events
      .filter((event) => event.kind === "observation")
      .map((event) => [event.fields?.metric, event]),
  );
  const measurementEvents = events.filter((event) => event.kind === "measurement");
  const readMeasurement = (event: (typeof events)[number] | undefined) =>
    (event?.fields?.measurements as Array<Record<string, unknown>> | undefined)?.[0];
  const rawCycleArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-summary-menstrual-cycle"
  );

  assert.deepEqual(payload.provenance?.summaryResources, ["menstrual_cycle"]);

  const periodLength = observationByMetric.get("period-length-days");
  assert.equal(periodLength?.fields?.value, 5);
  assert.equal(periodLength?.fields?.unit, "days");
  assert.equal(periodLength?.occurredAt, "2026-04-07T00:00:00.000Z");
  assert.equal(periodLength?.dayKey, "2026-04-07");
  assert.equal(periodLength?.externalRef?.system, "junction");
  assert.equal(periodLength?.externalRef?.resourceType, "junction-apple-health-menstrual-cycle");
  assert.equal(periodLength?.externalRef?.facet, "period-length-days");
  assert.equal(periodLength?.dataOrigin?.sourceProviderSlug, "apple-health");
  assert.equal(observationByMetric.get("cycle-length-days")?.fields?.value, 25);

  // Basal body temperature stays raw-only on the cycle summary: the
  // dedicated basal_body_temperature daily timeseries is the canonical seam
  // for the metric, so the sub-array must land no observations here.
  assert.equal(
    events.filter((event) => event.fields?.metric === "basal-body-temperature").length,
    0,
  );

  // Unspecified flow and indeterminate test results stay raw-only.
  const flowEvents = measurementEvents.filter((event) => event.title === "Junction menstrual flow");
  assert.equal(flowEvents.length, 2);
  assert.deepEqual(readMeasurement(flowEvents[0]), {
    metric: "menstrual-flow",
    value: 1,
    unit: "score",
    qualifiers: { flow: "light" },
  });
  assert.deepEqual(readMeasurement(flowEvents[1])?.qualifiers, { flow: "medium" });
  assert.equal(flowEvents[0]?.dayKey, "2026-04-07");
  // Result-bearing facet: same-day flow changes keep distinct identities.
  assert.equal(flowEvents[0]?.externalRef?.facet, "menstrual-flow-light-2026-04-07");

  const ovulationEvents = measurementEvents.filter((event) => event.title === "Junction ovulation test");
  // Two same-day tests with different results land as two events with
  // distinct result-bearing facets; the indeterminate row stays raw-only.
  assert.equal(ovulationEvents.length, 2);
  assert.deepEqual(readMeasurement(ovulationEvents[0]), {
    metric: "ovulation-test",
    value: 1,
    unit: "result",
    qualifiers: { result: "luteinizing_hormone_surge" },
  });
  assert.deepEqual(readMeasurement(ovulationEvents[1]), {
    metric: "ovulation-test",
    value: 0,
    unit: "result",
    qualifiers: { result: "negative" },
  });
  assert.notEqual(ovulationEvents[0]?.externalRef?.facet, ovulationEvents[1]?.externalRef?.facet);
  assert.equal(ovulationEvents[0]?.externalRef?.facet?.includes("luteinizing"), true);

  const pregnancyEvent = measurementEvents.find((event) => event.title === "Junction pregnancy test");
  assert.deepEqual(readMeasurement(pregnancyEvent), {
    metric: "pregnancy-test",
    value: 0,
    unit: "result",
    qualifiers: { result: "negative" },
  });

  const deviationEvent = measurementEvents.find((event) => event.title === "Junction cycle deviation");
  assert.deepEqual(readMeasurement(deviationEvent), {
    metric: "menstrual-cycle-deviation",
    value: 1,
    unit: "flag",
    qualifiers: { deviation: "irregular_menstrual_cycles" },
  });
  assert.equal(
    deviationEvent?.externalRef?.facet,
    "menstrual-cycle-deviation-irregular-menstrual-cycles-2026-04-30",
  );

  // Predicted cycles are forecasts and must not become normalized facts.
  assert.equal(
    events.some((event) => event.occurredAt?.startsWith("2026-05-05")),
    false,
  );
  // Sexual activity is deliberately unmapped and basal body temperature is
  // canonical on the dedicated timeseries; both stay raw-only here.
  assert.equal(events.length, 8);

  assert.match(JSON.stringify(rawCycleArtifact?.content), /period_start/u);
  assert.match(JSON.stringify(rawCycleArtifact?.content), /menstrual_flow/u);
  assert.match(JSON.stringify(rawCycleArtifact?.content), /protection_used/u);
  assertJsonOmits(JSON.stringify(payload.rawArtifacts), [
    "raw-cycle-source-app",
    "raw-cycle-source-name",
  ]);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction normalizer maps electrocardiogram summaries to per-recording events", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    summaries: {
      electrocardiogram: [{
        id: "ecg-1",
        session_start: "2026-04-22T18:00:00Z",
        session_end: "2026-04-22T18:00:30Z",
        voltage_sample_count: 15360,
        heart_rate_mean: 62,
        sampling_frequency_hz: 512,
        classification: "sinus_rhythm",
        time_zone: "Europe/London",
        updated_at: "2026-04-22T18:05:00Z",
        source: { provider: "apple_health_kit", type: "watch" },
      }, {
        id: "ecg-2",
        session_start: "2026-04-23T08:00:00Z",
        voltage_sample_count: 15360,
        classification: "inconclusive",
        inconclusive_cause: "poor_reading",
        source: { provider: "apple_health_kit", type: "watch" },
      }],
    },
  });
  const events = payload.events ?? [];
  const [first, second] = events;
  const firstMeasurements = first?.fields?.measurements as Array<Record<string, unknown>> | undefined;
  const secondMeasurements = second?.fields?.measurements as Array<Record<string, unknown>> | undefined;

  assert.deepEqual(payload.provenance?.summaryResources, ["electrocardiogram"]);
  assert.equal(events.length, 2);
  assert.equal(first?.kind, "measurement");
  assert.equal(first?.title, "Junction ECG (sinus rhythm)");
  assert.equal(first?.occurredAt, "2026-04-22T18:00:00.000Z");
  assert.equal(first?.dayKey, "2026-04-22");
  assert.equal(first?.timeZone, "Europe/London");
  assert.equal(first?.externalRef?.system, "junction");
  assert.equal(first?.externalRef?.resourceType, "junction-apple-health-kit-electrocardiogram");
  assert.equal(first?.externalRef?.facet, "ecg-recording");
  assert.deepEqual(firstMeasurements, [
    {
      metric: "ecg-heart-rate-mean",
      value: 62,
      unit: "bpm",
      qualifiers: { classification: "sinus_rhythm" },
    },
    {
      metric: "ecg-voltage-sample-count",
      value: 15360,
      unit: "count",
      qualifiers: { classification: "sinus_rhythm" },
    },
  ]);

  assert.equal(second?.title, "Junction ECG (inconclusive)");
  assert.deepEqual(secondMeasurements, [{
    metric: "ecg-voltage-sample-count",
    value: 15360,
    unit: "count",
    qualifiers: {
      classification: "inconclusive",
      "inconclusive-cause": "poor_reading",
    },
  }]);
  assert.notEqual(first?.externalRef?.resourceId, second?.externalRef?.resourceId);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
  assertEventRawArtifactRolesExist(payload);
});

test("Junction normalizer maps profile summaries to height and demographics", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T11:00:00.000Z",
    summaries: {
      profile: {
        id: "profile-1",
        height: 183,
        birth_date: "1990-05-14",
        sex: "female",
        wheelchair_use: true,
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "apple_health_kit", type: "phone" },
      },
    },
  });
  const events = payload.events ?? [];
  const height = events.find((event) => event.fields?.metric === "height");
  const demographics = events.find((event) => event.kind === "note");

  assert.deepEqual(payload.provenance?.summaryResources, ["profile"]);
  assert.equal(events.length, 2);
  assert.equal(height?.kind, "observation");
  assert.equal(height?.fields?.value, 183);
  assert.equal(height?.fields?.unit, "cm");
  assert.equal(height?.title, "Junction height");
  assert.equal(height?.externalRef?.resourceType, "junction-apple-health-kit-profile");
  assert.equal(height?.externalRef?.facet, "height");
  assert.equal(
    demographics?.note,
    "Birth date: 1990-05-14. Biological sex: female. Wheelchair use: yes.",
  );
  assert.equal(demographics?.title, "Junction profile");
  assert.equal(demographics?.externalRef?.facet, "profile-demographics");
  assert.equal(demographics?.externalRef?.resourceId, height?.externalRef?.resourceId);
  assert.equal(demographics?.recordedAt, "2026-04-20T09:00:00.000Z");
  assertEventRawArtifactRolesExist(payload);

  // The raw profile artifact stays identity-sanitized even though the
  // normalized events carry the structured fields.
  const profileArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-profile");
  assertJsonOmits(JSON.stringify(profileArtifact?.content), ["1990-05-14", "183"]);

  // An "unknown" sex enum value carries no information and stays raw-only.
  const unknownSexPayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: { id: "profile-2", sex: "unknown", source: { provider: "oura", type: "ring" } },
    },
  });
  assert.equal(unknownSexPayload.events?.length ?? 0, 0);
});

test("Junction oversized menstrual deviation strings land with capped facet and qualifier", () => {
  const oversizedDeviation = "a".repeat(200);
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-02T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "cycle-long-deviation",
        period_start: "2026-04-07",
        detected_deviations: [{ date: "2026-04-30", deviation: oversizedDeviation }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });
  const deviationEvent = payload.events?.find((event) => event.title === "Junction cycle deviation");
  const measurement = (
    deviationEvent?.fields?.measurements as Array<Record<string, unknown>> | undefined
  )?.[0];
  const qualifiers = measurement?.qualifiers as Record<string, string> | undefined;

  assert.ok(deviationEvent);
  // The facet slug is hard-capped at 80 characters so attacker- or
  // provider-controlled deviation text cannot mint unbounded external refs.
  assert.equal(
    deviationEvent?.externalRef?.facet,
    `menstrual-cycle-deviation-${"a".repeat(80)}-2026-04-30`,
  );
  assert.equal(qualifiers?.deviation, "a".repeat(80));
});

test("Junction ECG summaries drop negative metrics and cap qualifier lengths", () => {
  const oversizedClassification = `c${"x".repeat(120)}`;
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    summaries: {
      electrocardiogram: [{
        id: "ecg-negative",
        session_start: "2026-04-22T18:00:00Z",
        heart_rate_mean: -62,
        voltage_sample_count: -15360,
        classification: "sinus_rhythm",
        source: { provider: "apple_health_kit", type: "watch" },
      }, {
        id: "ecg-implausible-hr",
        session_start: "2026-04-22T20:00:00Z",
        heart_rate_mean: 400,
        voltage_sample_count: 15360,
        classification: "sinus_rhythm",
        source: { provider: "apple_health_kit", type: "watch" },
      }, {
        id: "ecg-long-classification",
        session_start: "2026-04-23T08:00:00Z",
        heart_rate_mean: 64,
        classification: oversizedClassification,
        source: { provider: "apple_health_kit", type: "watch" },
      }, {
        id: "ecg-empty",
        session_start: "2026-04-23T09:00:00Z",
        source: { provider: "apple_health_kit", type: "watch" },
      }, {
        // No session_start: the recording moment cannot be invented from
        // the sync window, so the row stays raw-only.
        id: "ecg-no-session-start",
        heart_rate_mean: 70,
        classification: "sinus_rhythm",
        source: { provider: "apple_health_kit", type: "watch" },
      }],
    },
  });
  const events = payload.events ?? [];

  // Negative numerics drop, but the classification is still the clinically
  // meaningful fact: the recording lands as a categorical flag instead of
  // going raw-only. A record with neither classification nor numerics
  // (ecg-empty) stays raw-only.
  assert.equal(events.length, 3);
  const classificationOnlyMeasurements = events[0]?.fields?.measurements as
    | Array<Record<string, unknown>>
    | undefined;
  assert.equal(classificationOnlyMeasurements?.length, 1);
  assert.equal(classificationOnlyMeasurements?.[0]?.metric, "ecg-recording");
  assert.equal(classificationOnlyMeasurements?.[0]?.value, 1);
  assert.equal(
    (classificationOnlyMeasurements?.[0]?.qualifiers as Record<string, string> | undefined)?.classification,
    "sinus_rhythm",
  );

  // Plausibility window: a 400 bpm mean is sensor noise — the HR measurement
  // drops while the sample count still lands for the same recording.
  const implausibleHrMeasurements = events[1]?.fields?.measurements as
    | Array<Record<string, unknown>>
    | undefined;
  assert.equal(implausibleHrMeasurements?.length, 1);
  assert.equal(implausibleHrMeasurements?.[0]?.metric, "ecg-voltage-sample-count");

  const measurement = (
    events[2]?.fields?.measurements as Array<Record<string, unknown>> | undefined
  )?.[0];
  const qualifiers = measurement?.qualifiers as Record<string, string> | undefined;
  assert.equal(measurement?.metric, "ecg-heart-rate-mean");
  assert.equal(measurement?.value, 64);
  assert.equal(qualifiers?.classification, oversizedClassification.slice(0, 80));
  assert.equal(qualifiers?.classification?.length, 80);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
});

test("Junction partial profiles land height-only and reject non-boolean wheelchair use", () => {
  const heightOnlyPayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        id: "profile-height-only",
        height: 175,
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "oura", type: "ring" },
      },
    },
  });
  const heightOnlyEvents = heightOnlyPayload.events ?? [];

  // A height-only profile still lands the observation without a hollow
  // demographics note.
  assert.equal(heightOnlyEvents.length, 1);
  assert.equal(heightOnlyEvents[0]?.kind, "observation");
  assert.equal(heightOnlyEvents[0]?.fields?.metric, "height");
  assert.equal(heightOnlyEvents[0]?.fields?.value, 175);

  // Non-boolean wheelchair_use values (string "true", numeric 1) never coerce
  // into a wheelchair segment.
  const coercedWheelchairPayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        id: "profile-coerced-wheelchair",
        birth_date: "1990-05-14",
        wheelchair_use: "true",
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "apple_health_kit", type: "phone" },
      },
    },
  });
  const demographics = coercedWheelchairPayload.events?.find((event) => event.kind === "note");

  assert.equal(demographics?.note, "Birth date: 1990-05-14.");
});

test("Junction normalizer ignores unsupported timeseries and workout stream resources", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      workout_stream: [{
        id: "workout-stream-1",
        timestamp: "2026-04-22T18:00:00Z",
        cadence: 86,
      }],
    },
    timeseries: {
      workout_distance: [{
        timestamp: "2026-04-22T18:00:00Z",
        value: 1200,
      }],
      workout_swimming_stroke: [{
        timestamp: "2026-04-22T18:00:00Z",
        value: "freestyle",
      }],
    },
  });

  assert.deepEqual(payload.provenance?.summaryResources, []);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-workout-stream"), false);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-workout-distance"), false);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-timeseries-workout-swimming-stroke"), false);
});

test("Junction import receipt does not retain unsupported-only clinical summaries", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-22T12:00:00.000Z",
      summaries: {
        clinical_note: [{
          id: "clinical-note-1",
          classification: "unsupported_clinical_value",
        }],
      },
      timeseries: {
        electrocardiogram_voltage: [{
          timestamp: "2026-04-22T18:00:00Z",
          value: 0.2,
        }],
      },
    },
  });

  const rawArtifactText = JSON.stringify(payload.rawArtifacts);

  assert.deepEqual(payload.provenance?.summaryResources, []);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.rawArtifacts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("wearable-raw-receipt:")));
  assert.doesNotMatch(rawArtifactText, /unsupported_clinical_value|electrocardiogram_voltage/u);
});

test("Junction raw receipt hash ignores unsupported-only resources", async () => {
  const emptyPayload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-22T12:00:00.000Z",
    },
  });
  const unsupportedPayload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-22T12:00:00.000Z",
      summaries: {
        clinical_note: [{ classification: "unsupported_clinical_value" }],
        workout_stream: [{ cadence: 86 }],
      },
      timeseries: {
        electrocardiogram_voltage: [{ timestamp: "2026-04-22T18:00:00Z", value: 0.2 }],
        heartrate: [{ timestamp: "2026-04-22T18:00:00Z", value: 64 }],
        workout_distance: [{ timestamp: "2026-04-22T18:00:00Z", value: 1200 }],
      },
    },
  });

  const emptyReceipt = readRawReceiptArtifact(emptyPayload);
  const unsupportedReceipt = readRawReceiptArtifact(unsupportedPayload);
  const unsupportedArtifactText = JSON.stringify(unsupportedPayload.rawArtifacts);

  assert.equal(unsupportedReceipt.payloadHash, emptyReceipt.payloadHash);
  assert.equal(unsupportedReceipt.id, emptyReceipt.id);
  assert.deepEqual(unsupportedPayload.provenance?.summaryResources, []);
  assert.deepEqual(unsupportedPayload.provenance?.timeseriesResources, []);
  assert.equal(unsupportedPayload.rawArtifacts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assertJsonOmits(unsupportedArtifactText, [
    "unsupported_clinical_value",
    "workout_stream",
    "electrocardiogram_voltage",
    "heartrate",
    "workout_distance",
    "\"value\":64",
    "\"value\":1200",
  ]);
});

test("Junction raw receipt hash ignores unsupported resources mixed with supported resources", async () => {
  const supportedSnapshot = {
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
    },
  };
  const supportedPayload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: supportedSnapshot,
  });
  const mixedPayload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      ...supportedSnapshot,
      summaries: {
        ...supportedSnapshot.summaries,
        clinical_note: [{ classification: "unsupported_clinical_value" }],
        workout_stream: [{ cadence: 86 }],
      },
      timeseries: {
        heartrate: [{ timestamp: "2026-04-22T18:00:00Z", value: 64 }],
        workout_distance: [{ timestamp: "2026-04-22T18:00:00Z", value: 1200 }],
      },
    },
  });

  const supportedReceipt = readRawReceiptArtifact(supportedPayload);
  const mixedReceipt = readRawReceiptArtifact(mixedPayload);
  const mixedArtifactText = JSON.stringify(mixedPayload.rawArtifacts);

  assert.equal(mixedReceipt.payloadHash, supportedReceipt.payloadHash);
  assert.equal(mixedReceipt.id, supportedReceipt.id);
  assert.deepEqual(mixedPayload.provenance?.summaryResources, ["activity"]);
  assert.deepEqual(mixedPayload.provenance?.timeseriesResources, []);
  assertJsonOmits(mixedArtifactText, [
    "unsupported_clinical_value",
    "workout_stream",
    "heartrate",
    "workout_distance",
    "\"value\":64",
    "\"value\":1200",
  ]);
});

test("Junction normalizer canonicalizes documented resource aliases before allowlisting", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      hypnogram: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-04-22T07:00:00Z",
        stageCount: 5,
      }],
    },
    timeseries: {
      heart_rate: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:10:00Z",
        value: 61,
      }],
      body_weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-22T07:15:00Z",
        body_weight: 82.1,
      }],
      calories_active: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:20:00Z",
        calories: 123,
      }],
      blood_glucose: [{
        sourceProviderSlug: "dexcom",
        timestamp: "2026-04-22T07:25:00Z",
        value: 5.6,
      }],
    },
  });

  const glucoseEvent = payload.events?.find((event) => event.fields?.metric === "glucose");

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "glucose").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-garmin-hypnogram"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "average-heart-rate"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "weight"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "active-calories"), false);
  // blood_glucose canonicalizes to the supported glucose resource.
  assert.equal(glucoseEvent?.fields?.value, 100.9019);
});

test("Junction sleep_cycle normalizer emits structured sleep-stage samples", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-oura-1",
        source: {
          provider: "oura",
          type: "ring",
          device_id: "raw-oura-ring-1",
        },
        observedAt: "2026-05-20T10:00:00Z",
        stages: [
          {
            start: "2026-05-20T02:00:00+00:00",
            end: "2026-05-20T02:30:00+00:00",
            stage: "light",
          },
          {
            start_time: "2026-05-20T02:30:00+00:00",
            end_time: "2026-05-20T03:00:00+00:00",
            level: "REM",
          },
          {
            startAt: "2026-05-20T03:00:00+00:00",
            durationSeconds: 3600,
            sleep_stage: "slow_wave_sleep",
          },
          {
            startAt: "2026-05-20T04:00:00+00:00",
            durationMinutes: 15,
            value: "wake",
          },
          {
            endAt: "2026-05-20T04:30:00+00:00",
            durationMillis: 900000,
            name: "N3",
          },
        ],
      }],
      hypnogram: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-05-20T11:00:00Z",
        stages: [{
          startAt: "2026-05-20T05:00:00+00:00",
          endAt: "2026-05-20T05:20:00+00:00",
          stage: "core",
        }],
      }],
    },
  });
  const samples = payload.samples ?? [];
  const rawSleepCycleArtifact = payload.rawArtifacts?.find((artifact) =>
    artifact.role === "junction-summary-sleep-cycle"
  );
  const rawSleepCycleArtifactText = JSON.stringify(rawSleepCycleArtifact?.content);

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(
    payload.rawArtifacts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assert.equal(rawSleepCycleArtifact?.role, "junction-summary-sleep-cycle");
  assert.doesNotMatch(rawSleepCycleArtifactText, /raw-oura-ring-1/u);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(samples.length, 6);
  assert.deepEqual(samples.map((sample) => sample.stream), [
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
    "sleep_stage",
  ]);
  assert.deepEqual(samples.map((sample) => sample.unit), ["stage", "stage", "stage", "stage", "stage", "stage"]);
  assert.deepEqual(samples.map((sample) => sample.sample.stage), ["light", "rem", "deep", "awake", "deep", "light"]);
  assert.deepEqual(samples.map((sample) => sample.sample.durationMinutes), [30, 30, 60, 15, 15, 20]);
  assert.equal(samples[0]?.sample.startAt, "2026-05-20T02:00:00.000Z");
  assert.equal(samples[0]?.sample.endAt, "2026-05-20T02:30:00.000Z");
  assert.equal(samples[2]?.sample.endAt, "2026-05-20T04:00:00.000Z");
  assert.equal(samples[4]?.sample.startAt, "2026-05-20T04:15:00.000Z");
  assert.equal(samples[4]?.sample.endAt, "2026-05-20T04:30:00.000Z");
  assert.ok(samples.every((sample) => sample.externalRef?.system === "junction"));
  assert.equal(samples.some((sample) => sample.externalRef?.resourceType.includes("hypnogram")), false);
  assert.deepEqual([...new Set(samples.map((sample) => sample.externalRef?.resourceType))].sort(), [
    "junction-garmin-sleep-cycle",
    "junction-oura-sleep-cycle",
  ]);
  assert.ok(samples.slice(0, 5).every((sample) => sample.dataOrigin?.sourceProviderSlug === "oura"));
  assert.ok(samples.slice(0, 5).every((sample) => sample.dataOrigin?.sourceType === "ring"));
  assert.equal(samples[5]?.dataOrigin?.sourceProviderSlug, "garmin");
});

test("Junction hypnogram alias emits canonical sleep-stage records", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-sleep-stage",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-05-20T12:00:00.000Z",
      summaries: {
        hypnogram: {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          data: [
            {
              start_time: "2026-05-20T01:00:00+00:00",
              end_time: "2026-05-20T01:12:00+00:00",
              value: "awake",
            },
            {
              start_time: "2026-05-20T01:12:00+00:00",
              end_time: "2026-05-20T01:42:00+00:00",
              stage: "deep",
            },
          ],
        },
      },
    },
  });

  const samples = payload.samples ?? [];

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.unit), ["stage", "stage"]);
  assert.deepEqual(samples.map((sample) => sample.sample.stage), ["awake", "deep"]);
  assert.deepEqual(samples.map((sample) => sample.sample.durationMinutes), [12, 30]);
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(samples.some((sample) => sample.externalRef?.resourceType.includes("hypnogram")), false);
  assert.ok(samples.every((sample) => sample.externalRef?.system === "junction"));
  assert.ok(samples.every((sample) => sample.externalRef?.resourceType === "junction-garmin-sleep-cycle"));
  assert.ok(samples.every((sample) => sample.dataOrigin?.sourceProviderSlug === "garmin"));
  assert.ok(samples.every((sample) => sample.dataOrigin?.sourceType === "watch"));
  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
});

test("Junction normalizer merges canonical and alias resource payloads before import", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        sourceProviderSlug: "garmin",
        observedAt: "2026-04-22T07:00:00Z",
        stageCount: 4,
      }],
      hypnogram: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T08:00:00Z",
        stageCount: 5,
      }],
    },
    timeseries: {
      weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-22T07:15:00Z",
        value: 82,
      }],
      body_weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2026-04-23T07:15:00Z",
        body_weight: 81.5,
      }],
      calories_active: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22T07:20:00Z",
        unit: "calories",
        value: 123,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assert.equal(
    payload.rawArtifacts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.events?.filter((event) => event.fields?.metric === "weight").length, 0);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "active-calories"), false);
});

test("Junction normalizer does not inherit device attribution from non-unique provider slug fallback", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    connections: [
      {
        id: "source-oura-ring-a",
        sourceProviderSlug: "oura",
        sourceDeviceId: "device-a",
      },
      {
        id: "source-oura-ring-b",
        sourceProviderSlug: "oura",
        sourceDeviceId: "device-b",
      },
    ],
    summaries: {
      activity: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
      profile: {
        sourceProviderSlug: "oura",
        displayName: "profile display name should not be retained",
      },
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(stepEvent?.dataOrigin?.sourceInstanceId, undefined);

  const profileArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-profile");
  assert.deepEqual(profileArtifact?.content, {
    sourceProviderSlug: "oura",
  });
});

test("Junction normalizer treats day-only timestamps as floating wall dates", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T23:59:59.000Z",
    summaries: {
      activity: [{
        sourceProviderSlug: "oura",
        day: "2026-04-22",
        steps: 7200,
      }],
    },
    timeseries: {
      steps: [{
        sourceProviderSlug: "oura",
        day: "2026-04-22",
        value: 72,
      }],
    },
  });

  const stepEvent = payload.events?.find((event) => event.fields?.metric === "daily-steps");
  assert.equal(stepEvent?.occurredAt, "2026-04-22T23:59:59.000Z");
  assert.equal(stepEvent?.dayKey, "2026-04-22");
  assert.equal(stepEvent?.dataOrigin?.observedAtRaw, "2026-04-22");
  assert.equal(stepEvent?.dataOrigin?.timestampSemantics, "floating");
  assert.notEqual(stepEvent?.occurredAt, "2026-04-22T00:00:00.000Z");

  const stepSample = payload.samples?.find((sample) => sample.stream === "steps");
  assert.equal(stepSample, undefined);
});

test("Junction normalizer only emits complete sleep and workout sessions", () => {
  const longProviderWorkoutId = `garmin-workout-${"x".repeat(220)}`;
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sleep-doc",
          bedtime_start: "2026-05-20T02:00:00+00:00",
          bedtime_stop: "2026-05-20T10:00:00+00:00",
          duration: 28800,
          sleepScore: 82,
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sleep-incomplete",
          date: "2026-05-21T10:00:00+00:00",
          bedtime_start: "2026-05-21T02:00:00+00:00",
          sleepScore: 78,
        },
      ],
      workouts: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          provider_id: longProviderWorkoutId,
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          moving_time: 1800,
          sport: {
            name: "Trail Run",
          },
          distance: 5000,
          calories: 320,
          total_calories: 355,
          average_hr: 145,
          max_hr: 175,
          total_elevation_gain: 125,
          elev_high: 314.5,
          elev_low: 125.2,
          average_speed: 2.7,
          max_speed: 5.2,
          average_watts: 215,
          max_watts: 540,
          normalized_power: 235,
          weighted_average_watts: 230,
          kilojoules: 420,
          hr_zones: [
            {
              zone: 1,
              label: "Warmup",
              min: 100,
              max: 120,
              duration: 600,
            },
            {
              zone: 2,
              label: "Zone 2",
              min_bpm: 121,
              max_bpm: 140,
              duration_seconds: 900,
            },
            120,
          ],
          route: {
            id: "route-forest-loop",
            name: "Forest Loop",
          },
          map: {
            id: "map-forest-loop",
            summary_polyline: "encoded-route-polyline",
          },
          start_latlng: [37.1, -122.1],
          end_latlng: [37.2, -122.2],
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-incomplete",
          observedAt: "2026-05-20T15:00:00+00:00",
          sport: {
            name: "Walk",
          },
          distance: 1000,
          calories: 90,
          average_hr: 101,
        },
      ],
    },
  });

  assertWorkoutSessionsMatchContract(payload.events ?? []);

  const sleepSessions = payload.events?.filter((event) => event.kind === "sleep_session") ?? [];
  assert.equal(sleepSessions.length, 1);
  assert.equal(sleepSessions[0]?.occurredAt, "2026-05-20T02:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.startAt, "2026-05-20T02:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.endAt, "2026-05-20T10:00:00.000Z");
  assert.equal(sleepSessions[0]?.fields?.durationMinutes, 480);

  const sleepScoreEvents = payload.events?.filter((event) => event.fields?.metric === "sleep-score") ?? [];
  assert.equal(sleepScoreEvents.length, 2);

  const workoutSessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  assert.equal(workoutSessions.length, 1);
  assert.equal(workoutSessions[0]?.fields?.activityType, "trail-run");
  assert.equal(workoutSessions[0]?.fields?.durationMinutes, 30);
  assert.equal(workoutSessions[0]?.fields?.distanceKm, 5);
  assert.equal("activeCalories" in (workoutSessions[0]?.fields ?? {}), false);
  assert.equal("averageHeartRate" in (workoutSessions[0]?.fields ?? {}), false);
  assert.equal("maxHeartRate" in (workoutSessions[0]?.fields ?? {}), false);
  assert.equal("totalCalories" in (workoutSessions[0]?.fields ?? {}), false);
  assert.deepEqual(workoutSessions[0]?.fields?.workout, {
    sourceApp: "garmin",
    sourceWorkoutId: longProviderWorkoutId.slice(0, 200),
    sport: "trail-run",
    sportName: "Trail Run",
    startedAt: "2026-05-20T12:00:00.000Z",
    endedAt: "2026-05-20T12:30:00.000Z",
    movingTimeMinutes: 30,
    sessionNote: "Trail Run",
    metrics: {
      activeCalories: 320,
      totalCalories: 355,
      averageHeartRate: 145,
      maxHeartRate: 175,
      totalElevationGainMeters: 125,
      elevationHighMeters: 314.5,
      elevationLowMeters: 125.2,
      averageSpeedMps: 2.7,
      maxSpeedMps: 5.2,
      averagePowerWatts: 215,
      maxPowerWatts: 540,
      normalizedPowerWatts: 235,
      weightedAveragePowerWatts: 230,
      kilojoules: 420,
    },
    heartRateZones: [
      {
        zone: 1,
        label: "Warmup",
        minHeartRate: 100,
        maxHeartRate: 120,
        durationMinutes: 10,
      },
      {
        zone: 2,
        label: "Zone 2",
        minHeartRate: 121,
        maxHeartRate: 140,
        durationMinutes: 15,
      },
      {
        zone: 3,
        durationMinutes: 2,
      },
    ],
    route: {
      routeId: "route-forest-loop",
      routeName: "Forest Loop",
      mapId: "map-forest-loop",
    },
    exercises: [],
  });

  const workoutMetrics = payload.events?.filter((event) =>
    event.kind === "observation" && event.externalRef?.resourceType === "junction-garmin-workouts"
  ) ?? [];
  assert.deepEqual(workoutMetrics, []);

  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-sleep"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "junction-summary-workouts"));
});

test("Junction workout detail normalization stays within workout contract bounds", () => {
  const longSportName = `Mountain ${"Technical ".repeat(20)}Run`;
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      workouts: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-contract-bounds",
          time_start: "2026-05-20T12:00:00+00:00",
          moving_time: 1800,
          sport: {
            name: longSportName,
          },
          hr_zones: Array.from({ length: 25 }, (_, index) => ({
            label: `Zone ${index + 1}`,
            duration: 60,
          })),
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-sparse-zones",
          time_start: "2026-05-21T12:00:00+00:00",
          moving_time: 1800,
          sport: {
            name: "Run",
          },
          hr_zones: [
            ...Array.from({ length: 24 }, () => ({})),
            { duration: 60 },
          ],
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-end-derived",
          time_end: "2026-05-22T12:30:00+00:00",
          moving_time: 1800,
          sport_type: "Virtual Ride",
        },
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "workout-elapsed-duration",
          time_start: "2026-05-23T12:00:00+00:00",
          time_end: "2026-05-23T12:45:00+00:00",
          moving_time: 1800,
          sport_type: "Gravel Ride",
          calories: -10,
          total_calories: -20,
          average_hr: -1,
          max_hr: -2,
          total_elevation_gain: -3,
          elevation_change: -12,
          average_speed: -4,
          max_speed: -5,
          average_watts: -6,
          max_watts: -7,
          normalized_power: -8,
          weighted_average_watts: -9,
          kilojoules: -10,
          hr_zones: [{
            min: -100,
            max: -90,
            duration: 60,
          }],
        },
      ],
    },
  });

  assertWorkoutSessionsMatchContract(payload.events ?? []);

  const workoutSessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  const workout = workoutSessionSchema.parse(workoutSessions[0]?.fields?.workout);
  const sparseZoneWorkout = workoutSessionSchema.parse(workoutSessions[1]?.fields?.workout);
  const endDerivedSession = workoutSessions[2];
  const endDerivedWorkout = workoutSessionSchema.parse(endDerivedSession?.fields?.workout);
  const elapsedDurationSession = workoutSessions[3];
  const elapsedDurationWorkout = workoutSessionSchema.parse(elapsedDurationSession?.fields?.workout);

  assert.ok((workout.sport?.length ?? 0) <= 80);
  assert.match(workout.sport ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.equal(workout.heartRateZones?.length, 20);
  assert.equal(workout.heartRateZones?.at(-1)?.zone, 20);
  assert.equal(sparseZoneWorkout.heartRateZones?.length, 1);
  assert.equal(sparseZoneWorkout.heartRateZones?.[0]?.zone, 20);
  assert.equal(endDerivedSession?.occurredAt, "2026-05-22T12:00:00.000Z");
  assert.equal(endDerivedSession?.fields?.durationMinutes, 30);
  assert.equal(endDerivedWorkout.startedAt, "2026-05-22T12:00:00.000Z");
  assert.equal(endDerivedWorkout.endedAt, "2026-05-22T12:30:00.000Z");
  assert.equal(endDerivedWorkout.sport, "virtual-ride");
  assert.equal(endDerivedWorkout.sportName, "Virtual Ride");
  assert.equal(elapsedDurationSession?.fields?.durationMinutes, 45);
  assert.equal(elapsedDurationWorkout.movingTimeMinutes, 30);
  assert.equal(elapsedDurationWorkout.sport, "gravel-ride");
  assert.deepEqual(elapsedDurationWorkout.metrics, {
    altitudeChangeMeters: -12,
  });
  assert.deepEqual(elapsedDurationWorkout.heartRateZones, [{
    zone: 1,
    durationMinutes: 1,
  }]);
});

test("Junction normalizer maps documented sleep summary scalar fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [
        {
          source: {
            provider: "oura",
            type: "ring",
          },
          id: "sleep-documented-fields",
          bedtime_start: "2026-05-20T02:00:00+00:00",
          bedtime_stop: "2026-05-20T10:00:00+00:00",
          duration: 28800,
          total: 25200,
          deep: 5400,
          rem: 7200,
          light: 12600,
          awake: 1800,
          time_in_bed: 30000,
          efficiency: 0.97,
          sleep_consistency: 91,
          sleep_performance: 88,
          average_hrv: 42,
          hr_average: 54,
          hr_lowest: 43,
          hr_resting: 50,
          recovery_readiness_score: 82,
          respiratory_rate: 14.2,
          skin_temperature: 36.5,
          temperature_delta: -0.2,
        },
      ],
    },
  });

  const sleepSession = payload.events?.find((event) => event.kind === "sleep_session");
  assert.equal(sleepSession?.fields?.durationMinutes, 480);

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValue = (metric: string) =>
    observations.find((event) => event.fields?.metric === metric)?.fields?.value;

  assert.equal(metricValue("sleep-total-minutes"), 420);
  assert.equal(metricValue("sleep-deep-minutes"), 90);
  assert.equal(metricValue("sleep-rem-minutes"), 120);
  assert.equal(metricValue("sleep-light-minutes"), 210);
  assert.equal(metricValue("sleep-awake-minutes"), 30);
  assert.equal(metricValue("time-in-bed-minutes"), 500);
  assert.equal(metricValue("sleep-efficiency"), 97);
  assert.equal(metricValue("sleep-consistency"), 91);
  assert.equal(metricValue("sleep-performance"), 88);
  assert.equal(metricValue("hrv"), 42);
  assert.equal(metricValue("average-heart-rate"), 54);
  assert.equal(metricValue("lowest-heart-rate"), 43);
  assert.equal(metricValue("resting-heart-rate"), 50);
  assert.equal(metricValue("readiness-score"), 82);
  assert.equal(metricValue("respiratory-rate"), 14.2);
  assert.equal(metricValue("temperature"), 36.5);
  assert.equal(metricValue("temperature-deviation"), -0.2);
  assert.ok(observations.every((event) => event.fields?.observationGrain === "summary"));
  assert.ok(observations.every((event) => event.externalRef?.resourceType === "junction-oura-sleep"));
});

test("Junction normalizer maps documented activity and body summary scalar fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      activity: [{
        source: {
          provider: "garmin",
          type: "watch",
        },
        id: "activity-documented-fields",
        date: "2026-05-20T00:00:00+00:00",
        calories_active: 640,
        calories_total: 2400,
        distance: 7500,
        floors_climbed: 18,
        total_elevation_gain: 320,
        elevation_change: -12,
        vo2_max: 48.5,
        percent_recorded: 0.95,
        day_strain: 10.4,
        workout_strain: 8.8,
        heart_rate: {
          max_bpm: 148,
          resting_bpm: 52,
        },
        steps: 9400,
      }],
      body: [{
        source: {
          provider: "withings",
          type: "scale",
        },
        id: "body-documented-fields",
        date: "2026-05-20T08:00:00+00:00",
        body_mass_index: 22.3,
        fat: 30,
        lean_body_mass_kilogram: 40.1,
        waist_circumference_centimeter: 86.36,
        body_temperature: 36.7,
        weight: 80,
      }],
    },
  });

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValue = (metric: string) =>
    observations.find((event) => event.fields?.metric === metric)?.fields?.value;
  const rawBodyArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-body");

  assert.equal(metricValue("daily-steps"), 9400);
  assert.equal(metricValue("active-calories"), 640);
  assert.equal(metricValue("total-calories"), 2400);
  assert.equal(metricValue("distance-km"), 7.5);
  assert.equal(metricValue("floors-climbed"), 18);
  assert.equal(metricValue("estimated-vo2-max"), 48.5);
  assert.equal(metricValue("total-elevation-gain-meters"), 320);
  assert.equal(metricValue("altitude-change-meters"), -12);
  assert.equal(metricValue("percent-recorded"), 95);
  assert.equal(metricValue("day-strain"), 10.4);
  assert.equal(metricValue("workout-strain"), 8.8);
  assert.equal(metricValue("max-heart-rate"), 148);
  assert.equal(metricValue("resting-heart-rate"), 52);
  assert.equal(metricValue("weight"), 80);
  assert.equal(metricValue("bmi"), 22.3);
  assert.equal(metricValue("body-fat-percentage"), 30);
  assert.equal(metricValue("waist-circumference"), 86.36);
  assert.equal(metricValue("lean-body-mass"), 40.1);
  assert.equal(metricValue("temperature"), 36.7);
  assert.match(JSON.stringify(rawBodyArtifact?.content), /"lean_body_mass_kilogram":40.1/u);
  assert.ok(observations.every((event) => event.fields?.observationGrain === "summary"));
});

test("Junction recovery readiness score preserves source-specific semantics", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [
        {
          source: { provider: "oura", type: "ring" },
          id: "oura-readiness",
          date: "2026-05-20T08:00:00+00:00",
          recovery_readiness_score: 82,
        },
        {
          source: { provider: "whoop", type: "strap" },
          id: "whoop-recovery",
          date: "2026-05-20T08:00:00+00:00",
          recovery_readiness_score: 67,
        },
      ],
    },
  });

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  assert.ok(observations.some((event) =>
    event.fields?.metric === "readiness-score"
    && event.fields.value === 82
    && event.externalRef?.resourceType === "junction-oura-sleep"
  ));
  assert.ok(observations.some((event) =>
    event.fields?.metric === "recovery-score"
    && event.fields.value === 67
    && event.externalRef?.resourceType === "junction-whoop-sleep"
  ));
});

test("Junction workout provider IDs drive stable summary external refs", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      workouts: [
        {
          source: { provider: "garmin" },
          provider_id: "provider-workout-stable",
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          provider_id: "provider-workout-stable",
          time_start: "2026-05-21T12:00:00+00:00",
          time_end: "2026-05-21T12:45:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          providerWorkoutId: "provider-camel-workout-stable",
          time_start: "2026-05-22T12:00:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          providerWorkoutId: "provider-camel-workout-stable",
          time_start: "2026-05-23T12:00:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          activity_id: "activity-workout-stable",
          time_start: "2026-05-24T12:00:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          activity_id: "activity-workout-stable",
          time_start: "2026-05-25T12:00:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          resource_id: "resource-workout-stable",
          time_start: "2026-05-26T12:00:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          resource_id: "resource-workout-stable",
          time_start: "2026-05-27T12:00:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          external_id: "external-workout-stable",
          time_start: "2026-05-28T12:00:00+00:00",
          moving_time: 1800,
          sport: { name: "Run" },
        },
        {
          source: { provider: "garmin" },
          external_id: "external-workout-stable",
          time_start: "2026-05-29T12:00:00+00:00",
          moving_time: 2700,
          sport: { name: "Run" },
        },
      ],
    },
  });

  assertWorkoutSessionsMatchContract(payload.events ?? []);

  const sessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  assert.equal(sessions.length, 10);
  assert.equal(sessions[0]?.externalRef?.resourceId, sessions[1]?.externalRef?.resourceId);
  assert.equal(sessions[2]?.externalRef?.resourceId, sessions[3]?.externalRef?.resourceId);
  assert.equal(sessions[4]?.externalRef?.resourceId, sessions[5]?.externalRef?.resourceId);
  assert.equal(sessions[6]?.externalRef?.resourceId, sessions[7]?.externalRef?.resourceId);
  assert.equal(sessions[8]?.externalRef?.resourceId, sessions[9]?.externalRef?.resourceId);
  assert.equal(
    workoutSessionSchema.parse(sessions[2]?.fields?.workout).sourceWorkoutId,
    "provider-camel-workout-stable",
  );
  assert.equal(
    workoutSessionSchema.parse(sessions[4]?.fields?.workout).sourceWorkoutId,
    "activity-workout-stable",
  );
});

test("Junction normalizer ignores aggregator provider and ambiguous type provenance fields", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      activity: [{
        provider: "junction",
        observedAt: "2026-04-22T12:00:00Z",
        steps: 7200,
      }],
      workouts: [{
        sourceProviderSlug: "oura",
        observedAt: "2026-04-22T12:00:00Z",
        type: "run",
        durationMinutes: 42,
        distanceKm: 7.2,
      }],
      profile: {
        provider: "junction",
        providerSlug: "oura",
        type: "profile",
        sourceProviderSlug: "junction",
        sourceType: "cloud-provider",
      },
    },
  });

  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-junction-activity"), false);

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");
  assert.equal(workoutEvent?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(workoutEvent?.dataOrigin?.sourceType, undefined);
  assert.equal(workoutEvent?.fields?.activityType, "run");
  assert.equal(workoutEvent?.externalRef?.resourceType, "junction-oura-workouts");

  const profileArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "junction-summary-profile");
  assert.deepEqual(profileArtifact?.content, {
    sourceProviderSlug: "oura",
    sourceType: "cloud-provider",
  });
});
