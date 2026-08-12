import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_SCHEMA,
  ID_PREFIXES,
  eventRevisionFromLifecycle,
  isDeletedEventLifecycle,
  serializeCompanionHrvRmssdObservation,
  workoutSessionSchema,
} from "@murphai/contracts";
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
  classifyJunctionSummaryNormalizationEvidence,
  identifyJunctionBloodPressureProviderRecords,
  importDeviceProviderSnapshot,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  resolveJunctionOrigin,
  type DeviceBatchImportPayload,
  type WearableRawIngestReceipt,
} from "../src/index.ts";

type StoredJsonlRecord = Awaited<ReturnType<typeof coreRuntime.readJsonlRecords>>[number];

test("Junction sleep normalization preserves explicit session identity without guessing unknown types", () => {
  const sleep = [
    { id: "main", type: "long_sleep" },
    { id: "nap", type: "nap" },
    { id: "unknown", type: "other" },
    { id: "missing" },
  ].map((entry, index) => ({
    ...entry,
    source: { provider: "oura", type: "wearable" },
    start: `2026-03-${String(10 + index).padStart(2, "0")}T01:00:00.000Z`,
    end: `2026-03-${String(10 + index).padStart(2, "0")}T02:00:00.000Z`,
  }));
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-03-16T10:00:00.000Z",
    summaries: { sleep },
  });
  const sessionTypes = payload.events
    ?.filter((event) => event.kind === "sleep_session")
    .map((event) => event.fields?.sleepType);

  assert.deepEqual(sessionTypes, ["main_sleep", "nap", undefined, undefined]);
});

function buildCompanionHrvRmssdSnapshotEntry(
  observation: Parameters<typeof serializeCompanionHrvRmssdObservation>[0],
) {
  return {
    admissionId: createHash("sha256")
      .update(serializeCompanionHrvRmssdObservation(observation))
      .digest("hex"),
    observation,
  };
}

type CompanionHrvRmssdObservation = Parameters<
  typeof serializeCompanionHrvRmssdObservation
>[0];

function buildCompanionOvernightHrvObservation(
  overrides: Partial<CompanionHrvRmssdObservation> = {},
): CompanionHrvRmssdObservation {
  return {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    nightDate: "2026-07-10",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 72,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    ...overrides,
  };
}

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
  const receipt = payload.ingestReceipt as WearableRawIngestReceipt | undefined;
  assert.ok(receipt);
  assert.equal(receipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
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

function latestLiveRecords(records: readonly StoredJsonlRecord[]): StoredJsonlRecord[] {
  const latestById = new Map<string, StoredJsonlRecord>();

  for (const record of records) {
    if (typeof record.id !== "string") {
      continue;
    }

    const existing = latestById.get(record.id);
    if (!existing || eventRevisionFromLifecycle(record.lifecycle) > eventRevisionFromLifecycle(existing.lifecycle)) {
      latestById.set(record.id, record);
    }
  }

  return [...latestById.values()].filter((record) => !isDeletedEventLifecycle(record.lifecycle));
}

function storedExternalRefResourceId(record: StoredJsonlRecord | undefined): string | undefined {
  const externalRef = record?.externalRef;
  if (!externalRef || typeof externalRef !== "object" || Array.isArray(externalRef)) {
    return undefined;
  }

  return typeof externalRef.resourceId === "string" ? externalRef.resourceId : undefined;
}

function storedExternalRefResourceType(record: StoredJsonlRecord | undefined): string | undefined {
  const externalRef = record?.externalRef;
  if (!externalRef || typeof externalRef !== "object" || Array.isArray(externalRef)) {
    return undefined;
  }

  return typeof externalRef.resourceType === "string" ? externalRef.resourceType : undefined;
}

function storedObservationValue(record: StoredJsonlRecord | undefined): unknown {
  if (!record || typeof record !== "object" || !("value" in record)) {
    return undefined;
  }

  return record.value;
}

function junctionFallbackSummaryResourceId(
  input: {
    observedAtRaw: string;
    resourceSlug: string;
    sourceProviderSlug: string;
    sourceType?: string;
    sourceInstanceId?: string;
  },
): string {
  return `${input.resourceSlug}-${createHash("sha256")
    .update(JSON.stringify([
      input.resourceSlug,
      input.sourceProviderSlug,
      input.sourceType,
      input.sourceInstanceId,
      input.observedAtRaw,
    ]))
    .digest("hex")
    .slice(0, 16)}`;
}

function junctionDailyTimeseriesResourceId(
  input: {
    dayKey: string;
    resource: string;
    resourceSlug: string;
    sourceProviderSlug: string;
    sourceType?: string;
    sourceInstanceId?: string;
  },
): string {
  return `${input.resourceSlug}-${createHash("sha256")
    .update(JSON.stringify([
      input.resourceSlug,
      input.sourceProviderSlug,
      input.sourceType,
      input.sourceInstanceId,
      `${input.dayKey}:${input.resource}:daily`,
    ]))
    .digest("hex")
    .slice(0, 16)}`;
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
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-daily-${resourceSlug}:`));
}

function assertNoFullJunctionTimeseriesArtifacts(payload: DeviceBatchImportPayload): void {
  assert.equal(
    (payload.evidenceParts ?? []).some((artifact) =>
      /^junction-timeseries-(?!daily-|reading-(?:blood-pressure|carbohydrates|insulin-injection|note):)/u.test(
        artifact.role,
      )
    ),
    false,
  );
}

function findJunctionBloodPressureReadingArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-blood-pressure:"));
}

function findJunctionNoteArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-note:"));
}

function findJunctionSparseMetabolicArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: "carbohydrates" | "insulin-injection",
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-reading-${resourceSlug}:`));
}

function makeJunctionDefaultTimeseriesSample(resource: string): Record<string, unknown> {
  const base = { sourceProviderSlug: "oura", timestamp: "2026-04-22T12:00:00Z" };

  if (resource === "blood_pressure") {
    return { ...base, systolic: 120, diastolic: 76 };
  }

  if (resource === "note") {
    return {
      ...base,
      start: base.timestamp,
      end: base.timestamp,
      tags: ["sauna"],
      value: "SENSITIVE_VALUE_SENTINEL",
    };
  }

  if (resource === "insulin_injection") {
    return {
      ...base,
      start: "2026-04-22T12:00:00Z",
      end: "2026-04-22T12:01:00Z",
      type: "rapid_acting",
      unit: "unit",
      value: 4,
    };
  }

  if (resource === "carbohydrates") {
    return {
      ...base,
      start: "2026-04-22T12:00:00Z",
      end: "2026-04-22T12:01:00Z",
      unit: "g",
      value: 25,
    };
  }

  const plausibleValues: Record<string, number> = {
    body_temperature: 36.6,
    basal_body_temperature: 36.6,
    body_temperature_delta: -0.4,
    caffeine: 0.095,
    glucose: 5.5,
  };

  return {
    ...base,
    ...(resource === "glucose" ? { unit: "mmol/L" } : {}),
    value: plausibleValues[resource] ?? 1,
  };
}

function assertEventRawArtifactRolesExist(payload: DeviceBatchImportPayload): void {
  const stagedRoles = new Set((payload.evidenceParts ?? []).map((artifact) => artifact.role));
  for (const event of payload.events ?? []) {
    for (const role of event.evidenceRoles ?? []) {
      assert.equal(stagedRoles.has(role), true, `missing evidence part role: ${role}`);
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
  const fallbackOrigin = resolveJunctionOrigin({}, {
    sourceProviderSlug: "garmin",
    sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(fallbackOrigin.sourceProviderSlug, "garmin");
  assert.equal(fallbackOrigin.sourceInstanceId, "source-aaaaaaaaaaaaaaaaaaaaaaaa");
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
          unit: "mmol/L",
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
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role.includes("heartrate")), false);
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
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction daily aggregates keep adjacent provider-local days distinct through core replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-stress-adjacent-local-days");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        stress_level: {
          groups: {
            garmin: [{
              data: [
                { timestamp: "2026-04-23T06:30:00.000Z", timezone_offset: -25_200, score: 44 },
                { timestamp: "2026-04-23T08:00:00.000Z", timezone_offset: -25_200, value: 44 },
              ],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    };
    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...firstImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveStressRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "stress-level",
    );

    assert.deepEqual(
      firstImport.events
        .filter((event) => event.kind === "observation" && event.metric === "stress-level")
        .map((event) => event.dayKey)
        .sort(),
      ["2026-04-22", "2026-04-23"],
    );
    assert.equal(liveStressRecords.length, 2);
    assert.deepEqual(liveStressRecords.map((record) => record.dayKey).sort(), ["2026-04-22", "2026-04-23"]);
    assert.equal(new Set(liveStressRecords.map((record) => record.id)).size, 2);
    assert.equal(new Set(liveStressRecords.map((record) => storedExternalRefResourceId(record))).size, 2);
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
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
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

test("Junction timeseries aggregates trust embedded offset timestamps before separate offset metadata", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-06-25T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-06-25T00:30:00+02:00", timezone_offset: -14_400, score: 44 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      glucose: {
        groups: {
          dexcom: [{
            data: [
              { timestamp: "2026-06-25T00:30:00+02:00", timezone_offset: -14_400, unit: "mmol/L", value: 5 },
            ],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });

  const stressEvent = payload.events?.find((event) => event.fields?.metric === "stress-level");
  const glucoseArtifact = findJunctionCompactTimeseriesArtifacts(payload, "glucose")[0];
  const glucoseTemporalShape = (glucoseArtifact?.content as Record<string, unknown>).temporalShape as
    Record<string, unknown>;

  assert.equal(stressEvent?.occurredAt, "2026-06-24T22:30:00.000Z");
  assert.equal(stressEvent?.dayKey, "2026-06-25");
  assert.equal(stressEvent?.dataOrigin?.timeZoneOffsetMinutes, -240);
  assert.equal(stressEvent?.dataOrigin?.timestampSemantics, "offset");
  assert.deepEqual(glucoseTemporalShape.hourlyBuckets, [{
    hour: 0,
    sampleCount: 1,
    meanValue: 90.091,
    minValue: 90.091,
    maxValue: 90.091,
  }]);
});

test("Junction daily aggregates repair legacy calendar-date resource ids through core replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-stress-calendar-date-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-24T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const legacyResourceId = junctionDailyTimeseriesResourceId({
      dayKey: "2026-06-24",
      resource: "stress_level",
      resourceSlug: "stress-level",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
    });
    const legacyImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      events: [{
        kind: "observation",
        occurredAt: "2026-06-25T03:30:00.000Z",
        recordedAt: "2026-06-25T03:30:00.000Z",
        dayKey: "2026-06-24",
        title: "Junction stress level",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-stress-level",
          resourceId: legacyResourceId,
          facet: "stress-level",
        },
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          observedAtRaw: "2026-06-24:stress_level:daily",
          timestampSemantics: "offset",
        },
        fields: {
          metric: "stress-level",
          observationGrain: "summary",
          value: 44,
          unit: "score",
        },
      }],
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: "2026-06-25T12:00:00.000Z",
          timeseries: {
            stress_level: {
              groups: {
                garmin: [{
                  data: [
                    {
                      calendar_date: "2026-06-25",
                      timestamp: "2026-06-24T23:30:00-04:00",
                      score: 44,
                    },
                  ],
                  source: { provider: "garmin", type: "watch" },
                }],
              },
            },
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...legacyImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveStressRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "stress-level",
    );
    const replayStress = replayImport.events.find(
      (event) => event.kind === "observation" && event.metric === "stress-level",
    );

    assert.equal(replayStress?.id, legacyImport.events[0]?.id);
    assert.equal(replayStress?.dayKey, "2026-06-25");
    assert.equal(liveStressRecords.length, 1);
    assert.equal(liveStressRecords[0]?.id, legacyImport.events[0]?.id);
    assert.equal(liveStressRecords[0]?.dayKey, "2026-06-25");
    assert.equal(
      storedExternalRefResourceId(liveStressRecords[0]),
      junctionDailyTimeseriesResourceId({
        dayKey: "2026-06-25",
        resource: "stress_level",
        resourceSlug: "stress-level",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      }),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction daily aggregates do not rewrite same-value adjacent days through legacy refs", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-stress-adjacent-legacy-ref");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-24T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const adjacentResourceId = junctionDailyTimeseriesResourceId({
      dayKey: "2026-06-24",
      resource: "stress_level",
      resourceSlug: "stress-level",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
    });
    const adjacentImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      events: [{
        kind: "observation",
        occurredAt: "2026-06-24T21:30:00.000Z",
        recordedAt: "2026-06-24T21:30:00.000Z",
        dayKey: "2026-06-24",
        title: "Junction stress level",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-stress-level",
          resourceId: adjacentResourceId,
          facet: "stress-level",
        },
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          observedAtRaw: "2026-06-24:stress_level:daily",
          timestampSemantics: "offset",
        },
        fields: {
          metric: "stress-level",
          observationGrain: "summary",
          value: 44,
          unit: "score",
        },
      }],
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: "2026-06-25T12:30:00.000Z",
          timeseries: {
            stress_level: {
              groups: {
                garmin: [{
                  data: [
                    {
                      timestamp: "2026-06-25T00:30:00+02:00",
                      timezone_offset: -14_400,
                      score: 44,
                    },
                  ],
                  source: { provider: "garmin", type: "watch" },
                }],
              },
            },
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...adjacentImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveStressRecords = latestLiveRecords(records)
      .filter((record) => record.kind === "observation" && record.metric === "stress-level")
      .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));
    const replayStress = replayImport.events.find(
      (event) => event.kind === "observation" && event.metric === "stress-level",
    );

    assert.notEqual(replayStress?.id, adjacentImport.events[0]?.id);
    assert.equal(liveStressRecords.length, 2);
    assert.deepEqual(liveStressRecords.map((record) => record.dayKey), ["2026-06-24", "2026-06-25"]);
    assert.equal(new Set(liveStressRecords.map((record) => record.id)).size, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction daily aggregates reserve proven legacy ids when adjacent primary keys collide", async () => {
  async function exercise(order: "corrected-first" | "adjacent-first") {
    const vaultRoot = await makeTempDirectory(`murph-junction-stress-legacy-primary-collision-${order}`);
    try {
      await coreRuntime.initializeVault({
        vaultRoot,
        createdAt: "2026-06-24T00:00:00.000Z",
        timezone: "America/New_York",
      });

      const legacyResourceId = junctionDailyTimeseriesResourceId({
        dayKey: "2026-06-24",
        resource: "stress_level",
        resourceSlug: "stress-level",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      });
      const correctedResourceId = junctionDailyTimeseriesResourceId({
        dayKey: "2026-06-25",
        resource: "stress_level",
        resourceSlug: "stress-level",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      });
      const legacyImport = await coreRuntime.importDeviceBatch({
        vaultRoot,
        provider: "junction",
        accountId: "junction-account-hash-1",
        importedAt: "2026-06-25T12:00:00.000Z",
        events: [{
          kind: "observation",
          occurredAt: "2026-06-24T22:30:00.000Z",
          recordedAt: "2026-06-24T22:30:00.000Z",
          dayKey: "2026-06-25",
          title: "Junction stress level",
          externalRef: {
            system: "junction",
            resourceType: "junction-garmin-stress-level",
            resourceId: legacyResourceId,
            facet: "stress-level",
          },
          dataOrigin: {
            version: 1,
            aggregatorProvider: "junction",
            sourceProviderSlug: "garmin",
            sourceType: "watch",
            observedAtRaw: "2026-06-24:stress_level:daily",
            timestampSemantics: "offset",
            timeZoneOffsetMinutes: -240,
          },
          fields: {
            metric: "stress-level",
            observationGrain: "summary",
            value: 44,
            unit: "score",
          },
        }],
      });
      const correctedSample = {
        timestamp: "2026-06-25T00:30:00+02:00",
        timezone_offset: -14_400,
        score: 44,
      };
      const adjacentSample = {
        timestamp: "2026-06-24T00:30:00+02:00",
        timezone_offset: -14_400,
        score: 44,
      };
      const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "junction",
          vaultRoot,
          snapshot: {
            accountId: "junction-account-hash-1",
            importedAt: "2026-06-25T12:30:00.000Z",
            timeseries: {
              stress_level: {
                groups: {
                  garmin: [{
                    data: order === "corrected-first"
                      ? [correctedSample, adjacentSample]
                      : [adjacentSample, correctedSample],
                    source: { provider: "garmin", type: "watch" },
                  }],
                },
              },
            },
          },
        },
        {
          corePort: coreRuntime,
        },
      );
      const records = (
        await Promise.all(
          [...new Set([...legacyImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
            coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
          ),
        )
      ).flat();
      const liveStressRecords = latestLiveRecords(records)
        .filter((record) => record.kind === "observation" && record.metric === "stress-level")
        .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));
      const legacyEventId = legacyImport.events[0]?.id;
      const correctedLiveRecord = liveStressRecords.find((record) => record.dayKey === "2026-06-25");
      const adjacentLiveRecord = liveStressRecords.find((record) => record.dayKey === "2026-06-24");

      assert.equal(liveStressRecords.length, 2);
      assert.equal(correctedLiveRecord?.id, legacyEventId);
      assert.equal(storedExternalRefResourceId(correctedLiveRecord), correctedResourceId);
      assert.notEqual(adjacentLiveRecord?.id, legacyEventId);
      assert.equal(storedExternalRefResourceId(adjacentLiveRecord), legacyResourceId);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  }

  await exercise("corrected-first");
  await exercise("adjacent-first");
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

test("Junction WHOOP workout summaries use provider offset local day across UTC midnight", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-06-25T12:00:00.000Z",
    summaries: {
      workouts: [{
        source: {
          provider: "whoop",
          type: "wearable",
        },
        id: "junction-whoop-run-offset-local-24",
        start: "2026-06-25T03:45:00.000Z",
        end: "2026-06-25T04:15:00.000Z",
        updated_at: "2026-06-25T04:20:00.000Z",
        timezone_offset: "-04:00",
        sport_name: "Run",
        workout_strain: 6.8,
      }],
    },
  });

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(workoutEvent?.occurredAt, "2026-06-25T03:45:00.000Z");
  assert.equal(workoutEvent?.dayKey, "2026-06-24");
  assert.equal(workoutEvent?.dataOrigin?.sourceProviderSlug, "whoop");
  assert.equal(workoutEvent?.dataOrigin?.timeZoneOffsetMinutes, -240);
});

test("Junction workout summaries derive provider day from computed start with provider offset", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-06-25T12:00:00.000Z",
    summaries: {
      workouts: [{
        source: {
          provider: "whoop",
          type: "wearable",
        },
        id: "junction-whoop-run-end-duration-offset-local-24",
        end: "2026-06-25T04:15:00.000Z",
        durationSeconds: 1800,
        updated_at: "2026-06-25T04:20:00.000Z",
        timezone_offset: "-04:00",
        sport_name: "Run",
      }],
    },
  });

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(workoutEvent?.occurredAt, "2026-06-25T03:45:00.000Z");
  assert.equal(workoutEvent?.dayKey, "2026-06-24");
  assert.equal(workoutEvent?.dataOrigin?.timeZoneOffsetMinutes, -240);
});

test("Junction workout summaries derive computed start day from embedded end offset", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-06-25T12:00:00.000Z",
    summaries: {
      workouts: [{
        source: {
          provider: "whoop",
          type: "wearable",
        },
        id: "junction-whoop-run-end-duration-embedded-offset-local-24",
        end: "2026-06-25T00:15:00-04:00",
        durationSeconds: 1800,
        sport_name: "Run",
      }],
    },
  });

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(workoutEvent?.occurredAt, "2026-06-25T03:45:00.000Z");
  assert.equal(workoutEvent?.dayKey, "2026-06-24");
});

test("Junction workout summaries keep id-less fallback identity stable when correcting start day", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-workout-idless-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const startAt = "2026-06-25T03:45:00.000Z";
    const endAt = "2026-06-25T04:15:00.000Z";
    const legacyResourceId = junctionFallbackSummaryResourceId({
      resourceSlug: "workouts",
      sourceProviderSlug: "whoop",
      sourceType: "wearable",
      observedAtRaw: startAt,
    });
    const legacyImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      events: [{
        kind: "activity_session",
        occurredAt: startAt,
        recordedAt: endAt,
        dayKey: "2026-06-24",
        title: "Junction workout",
        externalRef: {
          system: "junction",
          resourceType: "junction-whoop-workouts",
          resourceId: legacyResourceId,
          facet: "session",
        },
        fields: {
          durationMinutes: 30,
          activityType: "run",
          workout: {
            sourceApp: "whoop",
            startedAt: startAt,
            endedAt: endAt,
            exercises: [],
          },
        },
      }],
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: "2026-06-25T12:00:00.000Z",
          summaries: {
            workouts: [{
              source: {
                provider: "whoop",
                type: "wearable",
              },
              start: startAt,
              end: endAt,
              timezone_offset: "-04:00",
              sport_name: "Run",
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...legacyImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveWorkoutRecords = latestLiveRecords(records).filter((record) => record.kind === "activity_session");

    assert.equal(replayImport.events.find((event) => event.kind === "activity_session")?.id, legacyImport.events[0]?.id);
    assert.equal(liveWorkoutRecords.length, 1);
    assert.equal(storedExternalRefResourceId(liveWorkoutRecords[0]), legacyResourceId);
    assert.equal(liveWorkoutRecords[0]?.dayKey, "2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction workout summaries trust embedded offset timestamps before separate offset metadata", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-06-25T12:00:00.000Z",
    summaries: {
      workouts: [{
        source: {
          provider: "whoop",
          type: "wearable",
        },
        id: "junction-whoop-run-embedded-offset",
        start: "2026-06-25T00:30:00+02:00",
        end: "2026-06-25T01:00:00+02:00",
        timezone_offset: "-04:00",
        sport_name: "Run",
      }],
    },
  });

  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(workoutEvent?.occurredAt, "2026-06-24T22:30:00.000Z");
  assert.equal(workoutEvent?.dayKey, "2026-06-25");
  assert.equal(workoutEvent?.dataOrigin?.timeZoneOffsetMinutes, -240);
});

test("Junction workout summaries trust calendar_date over offset-derived workout days", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-09-28T16:00:00.000Z",
    summaries: {
      workouts: [
        {
          calendar_date: "2026-09-27",
          date: "2026-09-27T00:00:00.000Z",
          id: "junction-whoop-calendar-start",
          sourceProviderSlug: "whoop_v2",
          sourceType: "wearable",
          start: "2026-09-28T05:45:00.000Z",
          end: "2026-09-28T06:15:00.000Z",
          timezone_offset: "-04:00",
          sport_name: "Run",
        },
        {
          calendar_date: "2026-09-27",
          date: "2026-09-27T00:00:00.000Z",
          id: "junction-whoop-calendar-computed-start",
          sourceProviderSlug: "whoop_v2",
          sourceType: "wearable",
          end: "2026-09-28T06:15:00.000Z",
          durationSeconds: 1800,
          timezone_offset: "-04:00",
          sport_name: "Run",
        },
      ],
    },
  });
  const workoutEvents = payload.events?.filter((event) => event.kind === "activity_session") ?? [];

  assert.equal(workoutEvents.length, 2);
  assert.deepEqual(workoutEvents.map((event) => event.dayKey), ["2026-09-27", "2026-09-27"]);
});

test("Junction workout summaries without provider offset defer canonical day to vault timezone", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-workout-local-day-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      summaries: {
        workouts: [{
          source: {
            provider: "whoop",
            type: "wearable",
          },
          id: "junction-whoop-run-no-offset-local-24",
          start: "2026-06-25T03:45:00.000Z",
          end: "2026-06-25T04:15:00.000Z",
          updated_at: "2026-06-25T04:20:00.000Z",
          sport_name: "Run",
          strain: 5.9,
        }],
      },
    };
    const payload = normalizeJunctionSnapshot(snapshot);
    const normalizedWorkout = payload.events?.find((event) => event.kind === "activity_session");
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
    const workoutEvent = result.events.find((event) => event.kind === "activity_session");

    assert.equal(normalizedWorkout?.dayKey, undefined);
    assert.equal(workoutEvent?.dayKey, "2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction activity summaries trust calendar_date over midnight UTC date offsets", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-09-28T16:00:00.000Z",
    summaries: {
      activity: [
        {
          calendar_date: "2026-09-27",
          date: "2026-09-27T00:00:00.000Z",
          id: "fixture-id-65",
          sourceProviderSlug: "whoop_v2",
          sourceType: "watch",
          steps: 1234,
          timezone_offset: -14400,
          updated_at: "2026-09-28T06:11:08.000Z",
        },
        {
          calendar_date: "2026-09-27",
          date: "2026-09-27T00:00:00.000Z",
          id: "junction-garmin-calendar-date-activity",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          steps: 5678,
          timezone_offset: -14400,
          updated_at: "2026-09-28T06:11:08.000Z",
        },
      ],
    },
  });

  const stepEvents = payload.events?.filter((event) => event.fields?.metric === "daily-steps") ?? [];

  assert.equal(stepEvents.length, 2);
  assert.deepEqual(
    stepEvents.map((event) => [event.dataOrigin?.sourceProviderSlug, event.dayKey]).sort(),
    [
      ["garmin", "2026-09-27"],
      ["whoop-v2", "2026-09-27"],
    ],
  );
});

test("Junction sleep summaries trust calendar_date and anchor occurrence to sleep end", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-09-28T16:00:00.000Z",
    summaries: {
      sleep: [{
        average_hrv: 62.77,
        bedtime_start: "2026-09-28T05:12:22.000Z",
        bedtime_stop: "2026-09-28T14:42:48.000Z",
        calendar_date: "2026-09-28",
        date: "2026-09-28T00:00:00.000Z",
        duration: 34225,
        id: "fixture-id-73",
        recovery_readiness_score: 65,
        score: 93,
        sourceProviderSlug: "whoop_v2",
        sourceType: "unknown",
        timezone_offset: -14400,
        updated_at: "2026-09-28T15:03:43.000Z",
      }],
    },
  });

  const sleepSession = payload.events?.find((event) => event.kind === "sleep_session");
  const sleepScore = payload.events?.find((event) => event.fields?.metric === "sleep-score");
  const readinessScore = payload.events?.find((event) => event.fields?.metric === "recovery-score");

  assert.equal(sleepSession?.dayKey, "2026-09-28");
  assert.equal(sleepSession?.occurredAt, "2026-09-28T14:42:48.000Z");
  assert.equal(sleepScore?.dayKey, "2026-09-28");
  assert.equal(sleepScore?.occurredAt, "2026-09-28T14:42:48.000Z");
  assert.equal(readinessScore?.dayKey, "2026-09-28");
});

test("Junction sleep summaries without provider offset derive canonical day from sleep end", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-local-day-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      summaries: {
        sleep: [{
          source: {
            provider: "whoop",
            type: "wearable",
          },
          id: "junction-whoop-sleep-no-offset-overnight-24",
          start: "2026-06-24T02:30:00.000Z",
          end: "2026-06-24T11:00:00.000Z",
          updated_at: "2026-06-24T11:30:00.000Z",
          sleep_score: 82,
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
    const sleepSession = result.events.find((event) => event.kind === "sleep_session");
    const sleepScore = result.events.find(
      (event) => event.kind === "observation" && event.metric === "sleep-score",
    );

    assert.equal(sleepSession?.dayKey, "2026-06-24");
    assert.equal(sleepScore?.dayKey, "2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
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
        unit: "mmol/L",
        value: 101,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-glucose"), false);
  assert.equal(
    payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-daily-glucose:no-valid-samples"),
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
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-meal"));
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
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
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
  const firstSnapshot = makeJunctionCronometerMealSnapshot({
    chickenCalories: 400,
    chickenProtein: 10,
  });
  const firstMeal = normalizeJunctionSnapshot(
    firstSnapshot,
  ).events?.find((event) => event.kind === "meal");
  const correctedMeal = normalizeJunctionSnapshot(
    makeJunctionCronometerMealSnapshot({ chickenCalories: 425, chickenProtein: 12 }),
  ).events?.find((event) => event.kind === "meal");

  assert.equal(firstMeal?.externalRef?.resourceId, correctedMeal?.externalRef?.resourceId);
  assert.equal(firstMeal?.fields?.mealId, correctedMeal?.fields?.mealId);
  assert.notDeepEqual(firstMeal?.fields?.nutrition, correctedMeal?.fields?.nutrition);

  const record = firstSnapshot.summaries.meal[0];
  const origin = resolveJunctionOrigin(record);
  assert.equal(
    firstMeal?.fields?.mealId,
    coreRuntime.deterministicContractId(ID_PREFIXES.meal, JSON.stringify([
      "junction-meal",
      origin.sourceProviderSlug,
      origin.sourceType ?? null,
      origin.sourceInstanceId ?? null,
      record.id,
    ])),
  );
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
    assert.ok(result.applied);
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
    const ingest = await coreRuntime.readIntegrationIngestById(vaultRoot, result.ingestId);
    assert.ok(ingest);
    assert.ok(ingest.record.parts.some((part) => part.role === "junction-summary-meal"));
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

test("Junction raw-only timeseries resources do not emit evidence parts", () => {
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
  const rawArtifactText = JSON.stringify(payload.evidenceParts ?? []);

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
    const rawRespiratoryRateArtifact = payload.evidenceParts?.find((artifact) =>
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
    assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
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

test("Junction normalizer keeps Apple Health SDNN separate from companion WHOOP RMSSD", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-07-13T12:00:00.000Z",
    summaries: {
      sleep: [{
        average_hrv: 64,
        bedtime_start: "2026-07-13T02:00:00.000Z",
        bedtime_stop: "2026-07-13T09:00:00.000Z",
        id: "apple-health-sleep-hrv",
        sourceProviderSlug: "apple_health_kit",
      }],
    },
    timeseries: {
      hrv: {
        groups: {
          apple_health_kit: [{
            data: [
              { timestamp: "2026-07-13T08:30:00.000Z", unit: "ms", value: 66 },
            ],
            source: { provider: "apple-health-kit", type: "healthkit" },
          }],
        },
      },
    },
    companionHrvRmssd: buildCompanionHrvRmssdSnapshotEntry(
      buildCompanionOvernightHrvObservation({ nightDate: "2026-07-13" }),
    ),
  });

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const sdnn = observations.filter((event) => event.fields?.metric === "hrv-sdnn");
  const companionPrv = observations.filter((event) =>
    event.fields?.metric === "whoop-ble-overnight-prv-rmssd"
  );

  assert.equal(sdnn.length, 2);
  assert.deepEqual(sdnn.map((event) => event.fields?.value).sort((left, right) =>
    Number(left) - Number(right)
  ), [64, 66]);
  assert.ok(sdnn.every((event) => event.dataOrigin?.sourceProviderSlug === "apple-health-kit"));
  assert.ok(sdnn.every((event) => event.externalRef?.facet === "hrv"));
  assert.equal(companionPrv.length, 1);
  assert.equal(companionPrv[0]?.fields?.value, 48.25);
  assert.equal(companionPrv[0]?.dataOrigin?.sourceProviderSlug, "whoop");
  assert.equal(observations.some((event) => event.fields?.metric === "hrv"), false);
});

test("Junction normalizer maps companion WHOOP overnight PRV to one estimated daily summary", () => {
  const observation = buildCompanionOvernightHrvObservation();
  const snapshotEntry = buildCompanionHrvRmssdSnapshotEntry(observation);
  const payload = normalizeJunctionSnapshot({
    accountId: "junction-account-hash-1",
    importedAt: "2026-07-10T13:46:00.000Z",
    companionHrvRmssd: snapshotEntry,
  });

  const event = payload.events?.find((entry) =>
    entry.fields?.metric === "whoop-ble-overnight-prv-rmssd"
  );
  assert.equal(event?.title, "Estimated WHOOP BLE scheduled overnight PRV (RMSSD)");
  assert.equal(event?.occurredAt, "2026-07-10T12:00:00.000Z");
  assert.equal(event?.dayKey, "2026-07-10");
  assert.equal(event?.timeZone, undefined);
  assert.equal(event?.fields?.value, 48.25);
  assert.equal(event?.fields?.unit, "ms");
  assert.equal(event?.fields?.observationGrain, "summary");
  assert.equal(event?.externalRef?.system, "whoop");
  assert.equal(event?.externalRef?.resourceType, "companion-overnight-hrv-rmssd");
  assert.equal(event?.externalRef?.resourceId, "2026-07-10");
  assert.equal(event?.externalRef?.facet, "whoop-ble-overnight-prv-rmssd");
  assert.match(
    event?.externalRef?.version ?? "",
    /^prv-rmssd-5m-mean-scheduled-0000-0800-local-v1:[a-f0-9]{64}$/u,
  );
  assert.equal(
    event?.externalRef?.version,
    `${COMPANION_HRV_RMSSD_METHOD_VERSION}:${snapshotEntry.admissionId}`,
  );
  assert.equal(event?.externalRefUpdatePolicy, "immutable");
  assert.equal(event?.dataOrigin?.aggregatorProvider, "murph-companion");
  assert.equal(event?.dataOrigin?.sourceProviderSlug, "whoop");
  assert.equal(event?.dataOrigin?.sourceType, "ble-pulse-interval");
  assert.equal(event?.dataOrigin?.observedAtRaw, "2026-07-10");
  assert.equal(event?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(event?.dataOrigin?.originConfidence, "medium");
  assert.equal(
    event?.dataOrigin?.normalizerVersion,
    "companion-overnight-hrv-rmssd-normalizer.v1",
  );
  assert.equal(payload.provenance?.companionHrvRmssdObservations, 1);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.deepEqual(payload.evidenceParts?.[0]?.content, observation);
  assertJsonOmits(payload.evidenceParts?.[0]?.content, [
    "captureStartedAt",
    "captureDurationMs",
    "captureEndUtcOffsetMinutes",
    "acceptedCoverageMs",
    "rrIntervals",
    "packetTimestamps",
    "windowRmssdMs",
    "deviceIdentifier",
  ]);
});

test("companion WHOOP overnight RMSSD replay keeps its phone-owned night across vault timezone changes", async () => {
  const vaultRoot = await makeTempDirectory("murph-companion-hrv-rmssd");

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-07-10T13:44:00.000Z",
      timezone: "America/New_York",
      vaultRoot,
    });
    const observation = buildCompanionOvernightHrvObservation({
      nightDate: "2026-11-01",
    });
    const input = {
      provider: "junction" as const,
      vaultRoot,
      connectionId: "conn-junction-companion",
      sourceKind: "webhook" as const,
      deliveryMode: "full_payload" as const,
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        accountId: "junction-account-hash-1",
        importedAt: "2026-11-01T13:46:00.000Z",
        companionHrvRmssd: buildCompanionHrvRmssdSnapshotEntry(observation),
      },
    };
    const admissionId = input.snapshot.companionHrvRmssd.admissionId;

    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );
    await coreRuntime.updateVaultSummary({
      vaultRoot,
      timezone: "UTC",
    });
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );

    for (const changedObservation of [
      { ...observation, rmssdMs: 49 },
      { ...observation, acceptedWindowCount: 73 },
    ]) {
      await assert.rejects(
        () => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
          {
            ...input,
            snapshot: {
              ...input.snapshot,
              companionHrvRmssd: {
                admissionId,
                observation: changedObservation,
              },
            },
          },
          { corePort: coreRuntime },
        ),
        (error: unknown) =>
          error instanceof TypeError
          && /admission identity did not match/u.test(error.message),
      );
    }

    const records = latestLiveRecords((await Promise.all(
      [...new Set([...first.eventShardPaths, ...replay.eventShardPaths])].map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ),
    )).flat());
    const hrvRecords = records.filter((record) =>
      storedExternalRefResourceType(record) === "companion-overnight-hrv-rmssd"
    );

    assert.equal(hrvRecords.length, 1);
    assert.equal(replay.applied, false);
    assert.equal(replay.events[0]?.id, first.events[0]?.id);
    assert.equal(hrvRecords[0]?.id, first.events[0]?.id);
    assert.equal(storedObservationValue(hrvRecords[0]), 48.25);
    assert.equal(hrvRecords[0]?.occurredAt, "2026-11-01T12:00:00.000Z");
    assert.equal(hrvRecords[0]?.dayKey, "2026-11-01");
    assert.equal(
      storedExternalRefResourceId(hrvRecords[0]),
      "2026-11-01",
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("companion WHOOP overnight RMSSD keeps one immutable fact per night", async () => {
  const vaultRoot = await makeTempDirectory("murph-companion-hrv-rmssd-nightly");

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-07-10T13:44:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    const firstObservation = buildCompanionOvernightHrvObservation();
    const changedSameNight = buildCompanionOvernightHrvObservation({ rmssdMs: 51.5 });
    const nextNight = buildCompanionOvernightHrvObservation({
      nightDate: "2026-07-11",
      rmssdMs: 50.75,
    });
    const inputFor = (observation: CompanionHrvRmssdObservation) => ({
      provider: "junction" as const,
      vaultRoot,
      connectionId: "conn-junction-companion-nightly",
      sourceKind: "webhook" as const,
      deliveryMode: "full_payload" as const,
      normalizerVersion: "junction-normalizer.v1",
      snapshot: {
        accountId: "junction-account-hash-nightly",
        importedAt: `${observation.nightDate}T13:00:00.000Z`,
        companionHrvRmssd: buildCompanionHrvRmssdSnapshotEntry(observation),
      },
    });

    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      inputFor(firstObservation),
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      inputFor(firstObservation),
      { corePort: coreRuntime },
    );
    await assert.rejects(
      () => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        inputFor(changedSameNight),
        { corePort: coreRuntime },
      ),
      (error: unknown) =>
        coreRuntime.isVaultError(error)
        && error.code === "EVENT_IMMUTABLE_EXTERNAL_REF_CONFLICT",
    );
    const next = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      inputFor(nextNight),
      { corePort: coreRuntime },
    );

    const records = latestLiveRecords((await Promise.all(
      [...new Set([
        ...first.eventShardPaths,
        ...replay.eventShardPaths,
        ...next.eventShardPaths,
      ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
    )).flat());
    const hrvRecords = records.filter((record) =>
      storedExternalRefResourceType(record) === "companion-overnight-hrv-rmssd"
    );

    assert.equal(replay.applied, false);
    assert.equal(hrvRecords.length, 2);
    assert.deepEqual(
      hrvRecords.map(storedObservationValue).sort((left, right) => Number(left) - Number(right)),
      [48.25, 50.75],
    );
    assert.deepEqual(
      hrvRecords.map(storedExternalRefResourceId).sort(),
      ["2026-07-10", "2026-07-11"],
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction normalizer uses vault timezone for UTC-only daily aggregate days", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-06-25T12:00:00.000Z",
      timeseries: {
        hrv: {
          groups: {
            whoop: [{
              data: [
                { timestamp: "2026-06-25T02:30:00.000Z", value: 70 },
              ],
              source: { provider: "whoop", type: "wearable" },
            }],
          },
        },
      },
    },
    { defaultTimeZone: "America/New_York" },
  );

  const hrvEvent = payload.events?.find((event) => event.fields?.metric === "hrv");
  const artifact = findJunctionCompactTimeseriesArtifacts(payload, "hrv")[0]?.content as
    | Record<string, unknown>
    | undefined;

  assert.equal(hrvEvent?.occurredAt, "2026-06-25T02:30:00.000Z");
  assert.equal(hrvEvent?.dayKey, "2026-06-24");
  assert.equal(hrvEvent?.dataOrigin?.observedAtRaw, "2026-06-24:hrv:daily");
  assert.equal(hrvEvent?.legacyExternalRefs?.length, 1);
  assert.notEqual(hrvEvent?.legacyExternalRefs?.[0]?.resourceId, hrvEvent?.externalRef?.resourceId);
  assert.deepEqual(artifact?.legacyDayKeys, ["2026-06-25"]);
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

test("Junction normalizer compacts dense CGM glucose into daily facts and bounded temporal shape", () => {
  // A full CGM day: 288 five-minute samples must reduce to one compact
  // daily-aggregate artifact plus five daily observations, never raw dumps.
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
  const standardDeviation = glucoseEvents.find(
    (event) => event.fields?.metric === "glucose-standard-deviation",
  );
  const coefficientOfVariation = glucoseEvents.find(
    (event) => event.fields?.metric === "glucose-coefficient-of-variation",
  );
  const artifacts = findJunctionCompactTimeseriesArtifacts(payload, "glucose");
  const artifactContent = artifacts[0]?.content as Record<string, unknown>;
  const temporalShape = artifactContent.temporalShape as Record<string, unknown>;
  const hourlyBuckets = temporalShape.hourlyBuckets as Array<Record<string, unknown>>;

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(glucoseEvents.length, 5);
  assert.equal(artifacts.length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  // Junction normalizes glucose to mmol/L; values convert to mg/dL.
  assert.equal(mean?.fields?.value, 108.1092);
  assert.equal(mean?.fields?.unit, "mg/dL");
  assert.equal(min?.fields?.value, 90.091);
  assert.equal(max?.fields?.value, 126.1274);
  assert.equal(standardDeviation?.fields?.value, 18.0182);
  assert.equal(standardDeviation?.fields?.unit, "mg/dL");
  assert.equal(coefficientOfVariation?.fields?.value, 16.6667);
  assert.equal(coefficientOfVariation?.fields?.unit, "%");
  assert.equal(mean?.dayKey, "2026-04-22");
  assert.equal(artifactContent.schema, "junction.glucose_daily_aggregate.v2");
  assert.equal(artifactContent.sampleCount, 288);
  assert.equal(artifactContent.minValue, 90.091);
  assert.equal(artifactContent.maxValue, 126.1274);
  assert.equal(temporalShape.schema, "junction.glucose_daily_temporal_shape.v1");
  assert.equal(temporalShape.varianceMethod, "population");
  assert.equal(temporalShape.hourlyBucketLimit, 24);
  assert.equal(temporalShape.serializedByteLimit, 4096);
  assert.equal(temporalShape.hourlyBucketsStatus, "complete");
  assert.equal(hourlyBuckets.length, 24);
  assert.ok(Buffer.byteLength(JSON.stringify(temporalShape), "utf8") <= 4096);
  assert.doesNotMatch(JSON.stringify(artifactContent), /"samples"|"data"\s*:/u);
});

test("Junction dense CGM import persists only one compact glucose aggregate and replays idempotently", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-dense-cgm-import");
  const nestedSentinel = "SENSITIVE_DENSE_CGM_NESTED_SENTINEL";
  const samples = Array.from({ length: 288 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 22, 0, 0, 0) + index * 5 * 60_000).toISOString(),
    unit: "mmol/L",
    value: index % 2 === 0 ? 5 : 7,
    ...(index === 137
      ? { provider_private: { nested: [{ value: nestedSentinel }] } }
      : {}),
  }));
  const snapshot = {
    accountId: "junction-account-hash-dense-cgm",
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: samples,
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  };

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });

    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );
    assert.equal(first.applied, true);
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    const ingest = await coreRuntime.readIntegrationIngestById(vaultRoot, first.ingestId);
    assert.ok(ingest);
    const aggregateParts = ingest.record.parts.filter((part) =>
      part.role.startsWith("junction-timeseries-daily-glucose:")
    );
    const aggregatePart = aggregateParts[0];
    assert.ok(aggregatePart);
    const aggregateContent = JSON.parse(aggregatePart.content) as Record<string, unknown>;
    const temporalShape = aggregateContent.temporalShape as Record<string, unknown>;
    const hourlyBuckets = temporalShape.hourlyBuckets;
    const eventRecords = (
      await Promise.all(
        first.eventShardPaths.map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const glucoseMetrics = new Set([
      "glucose",
      "lowest-glucose",
      "highest-glucose",
      "glucose-standard-deviation",
      "glucose-coefficient-of-variation",
    ]);
    const glucoseRecords = latestLiveRecords(eventRecords).filter((record) =>
      record.kind === "observation"
      && typeof record.metric === "string"
      && glucoseMetrics.has(record.metric)
    );
    const persistedText = JSON.stringify({
      events: eventRecords,
      ingest: ingest.record,
    });

    assert.equal(first.samples.length, 0);
    assert.deepEqual(first.sampleShardPaths, []);
    assert.equal(first.events.length, 5);
    assert.equal(first.events.every((event) => event.kind === "observation"), true);
    assert.equal(ingest.record.parts.length, 1);
    assert.equal(aggregateParts.length, 1);
    assert.match(
      aggregatePart.role,
      /^junction-timeseries-daily-glucose:2026-04-22:[a-f0-9]{16}$/u,
    );
    assert.equal(aggregateContent.schema, "junction.glucose_daily_aggregate.v2");
    assert.equal(aggregateContent.sampleCount, 288);
    assert.equal(Array.isArray(hourlyBuckets), true);
    assert.ok(Array.isArray(hourlyBuckets) && hourlyBuckets.length <= 24);
    assert.ok(Buffer.byteLength(JSON.stringify(temporalShape), "utf8") <= 4096);
    assert.equal(ingest.record.parts.some((part) => part.role === "provider-snapshot"), false);
    assert.equal(ingest.record.counts.sampleCount, 0);
    assert.deepEqual(ingest.record.outputs.sampleIds, []);
    assert.equal(ingest.record.counts.eventCount, 5);
    assert.equal(ingest.record.outputs.events.length, 5);
    assert.equal(glucoseRecords.length, 5);
    assert.deepEqual(
      ingest.record.outputs.events.map((output) => output.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
    assert.doesNotMatch(persistedText, /SENSITIVE_DENSE_CGM_NESTED_SENTINEL/u);
    assert.doesNotMatch(persistedText, /"(?:data|samples)"\s*:/u);

    assert.equal(replay.applied, false);
    assert.equal(replay.ingestId, null);
    assert.equal(replay.persistedEvidencePartCount, 0);
    assert.deepEqual(replay.samples, []);
    assert.deepEqual(
      replay.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
    assert.equal(
      (await coreRuntime.readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath })).length,
      1,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction glucose applies latest corrections and enforces the documented mmol/L contract", () => {
  const original = {
    id: "glucose-provider-row-old",
    source_device_id: "dexcom-device-old",
    timestamp: "2026-04-22T12:00:00Z",
    unit: "mmol/L",
    value: 5,
    private_provider_array: ["SENSITIVE_GLUCOSE_SENTINEL"],
  };
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [
              original,
              { ...original },
              {
                ...original,
                id: "glucose-provider-row-correction",
                source_device_id: "dexcom-device-correction",
                value: 0.5,
              },
              {
                timestamp: "2026-04-22T12:05:00Z",
                unit: "mg/dL",
                value: 5.5,
              },
              {
                timestamp: "2026-04-22T12:10:00Z",
                value: 5.5,
              },
            ],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });
  const glucoseEvents = (payload.events ?? []).filter((event) =>
    event.kind === "observation" && [
      "glucose",
      "lowest-glucose",
      "highest-glucose",
      "glucose-standard-deviation",
      "glucose-coefficient-of-variation",
    ].includes(String(event.fields?.metric))
  );
  const artifact = findJunctionCompactTimeseriesArtifacts(payload, "glucose")[0];
  const artifactContent = artifact?.content as Record<string, unknown>;
  const artifactText = JSON.stringify(payload.evidenceParts ?? []);

  assert.equal(glucoseEvents.length, 5);
  assert.equal(glucoseEvents.find((event) => event.fields?.metric === "glucose")?.fields?.value, 9.0091);
  assert.equal(glucoseEvents.find((event) => event.fields?.metric === "lowest-glucose")?.fields?.value, 9.0091);
  assert.equal(glucoseEvents.find((event) => event.fields?.metric === "highest-glucose")?.fields?.value, 9.0091);
  assert.equal(
    glucoseEvents.find((event) => event.fields?.metric === "glucose-standard-deviation")?.fields?.value,
    0,
  );
  assert.equal(
    glucoseEvents.find((event) => event.fields?.metric === "glucose-coefficient-of-variation")?.fields?.value,
    0,
  );
  assert.equal(artifactContent.sampleCount, 1);
  assert.equal(artifactContent.meanValue, 9.0091);
  assert.equal(payload.samples?.length ?? 0, 0);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.doesNotMatch(
    artifactText,
    /SENSITIVE_GLUCOSE_SENTINEL|private_provider_array|provider-row-(?:old|correction)|dexcom-device-(?:old|correction)/u,
  );
  assert.doesNotMatch(artifactText, /"samples"|"data"\s*:/u);
});

test("Junction glucose temporal shape distinguishes days with identical daily mean, min, and max", () => {
  const makePayload = (values: readonly number[]) => normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: values.map((value, hour) => ({
              timestamp: `2026-04-22T${String(hour).padStart(2, "0")}:00:00Z`,
              unit: "mmol/L",
              value,
            })),
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });
  const first = makePayload([5, 7, 5, 7]);
  const second = makePayload([5, 5, 7, 7]);
  const dailyFields = (payload: DeviceBatchImportPayload) => (payload.events ?? [])
    .filter((event) => ["glucose", "lowest-glucose", "highest-glucose"].includes(String(event.fields?.metric)))
    .map((event) => [event.fields?.metric, event.fields?.value]);
  const temporalShape = (payload: DeviceBatchImportPayload) => {
    const artifact = findJunctionCompactTimeseriesArtifacts(payload, "glucose")[0];
    return (artifact?.content as Record<string, unknown>).temporalShape;
  };

  assert.deepEqual(dailyFields(first), dailyFields(second));
  assert.notDeepEqual(temporalShape(first), temporalShape(second));
  assert.equal(first.samples?.length ?? 0, 0);
  assert.equal(second.samples?.length ?? 0, 0);
  assertNoFullJunctionTimeseriesArtifacts(first);
  assertNoFullJunctionTimeseriesArtifacts(second);
});

test("Junction normalizer applies latest sparse metabolic corrections as compact non-meal facts", async () => {
  const insulin = {
    id: "insulin-provider-row-old",
    source_device_id: "apple-phone-old",
    start: "2026-04-22T12:05:00-05:00",
    end: "2026-04-22T12:06:00-05:00",
    type: "rapid_acting",
    unit: "unit",
    value: 4,
    delivery_mode: "bolus",
    delivery_form: "standard",
    bolus_purpose: "meal",
    private_provider_array: ["SENSITIVE_INSULIN_SENTINEL"],
  };
  const correctedInsulin = {
    ...insulin,
    id: "insulin-provider-row-correction",
    source_device_id: "apple-phone-correction",
    end: "2026-04-22T12:07:00-05:00",
    value: 2,
  };
  const carbohydrate = {
    id: "carbohydrate-provider-row-old",
    source_device_id: "apple-phone-old",
    start: "2026-04-22T12:00:00-05:00",
    end: "2026-04-22T12:01:00-05:00",
    unit: "g",
    value: 35,
    private_provider_array: ["SENSITIVE_CARBOHYDRATE_SENTINEL"],
  };
  const correctedCarbohydrate = {
    ...carbohydrate,
    id: "carbohydrate-provider-row-correction",
    source_device_id: "apple-phone-correction",
    end: "2026-04-22T12:02:00-05:00",
    value: 40,
  };
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-metabolic",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        insulin_injection: {
          groups: {
            apple_health_kit: [{
              data: [insulin, { ...insulin }, correctedInsulin],
              source: { provider: "apple_health_kit", type: "phone" },
            }],
          },
        },
        carbohydrates: {
          groups: {
            apple_health_kit: [{
              data: [carbohydrate, { ...carbohydrate }, correctedCarbohydrate],
              source: { provider: "apple_health_kit", type: "phone" },
            }],
          },
        },
      },
    },
  });
  const medications = (payload.events ?? []).filter((event) => event.kind === "medication_intake");
  const carbohydrateEvents = (payload.events ?? []).filter(
    (event) => event.kind === "observation" && event.fields?.metric === "carbohydrate-intake",
  );
  const insulinArtifacts = findJunctionSparseMetabolicArtifacts(payload, "insulin-injection");
  const carbohydrateArtifacts = findJunctionSparseMetabolicArtifacts(payload, "carbohydrates");
  const artifactText = JSON.stringify(payload.evidenceParts ?? []);

  assert.deepEqual(payload.provenance?.timeseriesResources, ["insulin_injection", "carbohydrates"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(medications.length, 1);
  assert.equal(medications[0]?.fields?.dose, 2);
  assert.equal(medications[0]?.occurredAt, "2026-04-22T17:05:00.000Z");
  assert.equal(medications[0]?.dayKey, "2026-04-22");
  assert.equal(medications[0]?.fields?.medicationName, "Insulin (rapid acting)");
  assert.equal(medications[0]?.fields?.unit, "unit");
  assert.equal(medications[0]?.dataOrigin?.sourceProviderSlug, "apple-health-kit");
  assert.equal(carbohydrateEvents.length, 1);
  assert.equal(carbohydrateEvents[0]?.occurredAt, "2026-04-22T17:00:00.000Z");
  assert.equal(carbohydrateEvents[0]?.fields?.observationGrain, "sample");
  assert.equal(carbohydrateEvents[0]?.fields?.value, 40);
  assert.equal(carbohydrateEvents[0]?.fields?.unit, "g");
  assert.equal((payload.events ?? []).some((event) => event.kind === "meal"), false);
  assert.equal(insulinArtifacts.length, 1);
  assert.equal(carbohydrateArtifacts.length, 1);
  assert.deepEqual(insulinArtifacts[0]?.content, {
    schema: "junction.insulin_injection_reading.v1",
    provider: "junction",
    resource: "insulin_injection",
    dayKey: "2026-04-22",
    sourceProviderSlug: "apple-health-kit",
    sourceType: "phone",
    sourceInstanceId: medications[0]?.dataOrigin?.sourceInstanceId,
    occurredAt: "2026-04-22T17:05:00.000Z",
    endAt: "2026-04-22T17:07:00.000Z",
    recordedAt: "2026-04-22T17:05:00.000Z",
    insulinType: "rapid-acting",
    deliveryMode: "bolus",
    deliveryForm: "standard",
    bolusPurpose: "meal",
    dose: 2,
    unit: "unit",
  });
  assert.deepEqual(carbohydrateArtifacts[0]?.content, {
    schema: "junction.carbohydrate_reading.v1",
    provider: "junction",
    resource: "carbohydrates",
    dayKey: "2026-04-22",
    sourceProviderSlug: "apple-health-kit",
    sourceType: "phone",
    sourceInstanceId: carbohydrateEvents[0]?.dataOrigin?.sourceInstanceId,
    occurredAt: "2026-04-22T17:00:00.000Z",
    endAt: "2026-04-22T17:02:00.000Z",
    recordedAt: "2026-04-22T17:00:00.000Z",
    value: 40,
    unit: "g",
  });
  assert.ok(insulinArtifacts.every((artifact) => Buffer.byteLength(JSON.stringify(artifact.content), "utf8") < 2048));
  assert.ok(carbohydrateArtifacts.every((artifact) =>
    Buffer.byteLength(JSON.stringify(artifact.content), "utf8") < 2048
  ));
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.doesNotMatch(artifactText, /SENSITIVE_(?:INSULIN|CARBOHYDRATE)_SENTINEL|private_provider_array/u);
  assert.doesNotMatch(artifactText, /provider-row-(?:old|correction)|apple-phone-(?:old|correction)/u);
  assert.doesNotMatch(artifactText, /"samples"|"data"\s*:/u);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.deepEqual(readRawReceiptArtifact(payload).rawArtifactRoles.sort(), [
    ...insulinArtifacts.map((artifact) => artifact.role),
    ...carbohydrateArtifacts.map((artifact) => artifact.role),
  ].sort());
});

test("Junction sparse metabolic identity follows every documented compound-key coordinate", () => {
  const sameKeyOriginal = {
    id: "provider-row-original",
    source_device_id: "phone-original",
    start: "2026-04-22T12:00:00Z",
    end: "2026-04-22T12:01:00Z",
    unit: "g",
    value: 10,
  };
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      carbohydrates: {
        groups: {
          apple_health_kit: [
            {
              data: [
                sameKeyOriginal,
                {
                  ...sameKeyOriginal,
                  id: "provider-row-correction",
                  source_device_id: "phone-correction",
                  value: 20,
                },
                {
                  ...sameKeyOriginal,
                  id: "provider-row-next-timestamp",
                  start: "2026-04-22T12:05:00Z",
                  end: "2026-04-22T12:06:00Z",
                  value: 30,
                },
              ],
              source: { provider: "apple_health_kit", type: "phone" },
            },
            {
              data: [{ ...sameKeyOriginal, id: "provider-row-watch", value: 40 }],
              source: { provider: "apple_health_kit", type: "watch" },
            },
          ],
          cronometer: [{
            data: [{ ...sameKeyOriginal, id: "provider-row-cronometer", value: 50 }],
            source: { provider: "cronometer", type: "phone" },
          }],
        },
      },
      insulin_injection: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "provider-row-insulin",
              source_device_id: "phone-original",
              start: "2026-04-22T12:00:00Z",
              end: "2026-04-22T12:01:00Z",
              type: "rapid_acting",
              unit: "unit",
              value: 2,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
    },
  });
  const carbohydrateEvents = (payload.events ?? []).filter(
    (event) => event.kind === "observation" && event.fields?.metric === "carbohydrate-intake",
  );
  const insulinEvents = (payload.events ?? []).filter(
    (event) => event.kind === "medication_intake",
  );

  assert.deepEqual(
    carbohydrateEvents.map((event) => event.fields?.value).sort((left, right) =>
      Number(left) - Number(right)
    ),
    [20, 30, 40, 50],
  );
  assert.equal(
    new Set(carbohydrateEvents.map((event) => event.externalRef?.resourceId)).size,
    4,
  );
  assert.deepEqual(
    carbohydrateEvents.map((event) => [
      event.dataOrigin?.sourceProviderSlug,
      event.dataOrigin?.sourceType,
      event.occurredAt,
    ]).sort(),
    [
      ["apple-health-kit", "phone", "2026-04-22T12:00:00.000Z"],
      ["apple-health-kit", "phone", "2026-04-22T12:05:00.000Z"],
      ["apple-health-kit", "watch", "2026-04-22T12:00:00.000Z"],
      ["cronometer", "phone", "2026-04-22T12:00:00.000Z"],
    ],
  );
  assert.equal(insulinEvents.length, 1);
  assert.equal(insulinEvents[0]?.occurredAt, "2026-04-22T12:00:00.000Z");
  assert.notEqual(
    insulinEvents[0]?.externalRef?.resourceId,
    carbohydrateEvents.find((event) => event.fields?.value === 20)?.externalRef?.resourceId,
  );
});

test("Junction sparse metabolic resources fail closed without retaining invalid provider arrays", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        insulin_injection: [
          {
            start: "2026-04-22T12:05:00Z",
            end: "2026-04-22T12:06:00Z",
            type: "rapid_acting",
            unit: "units",
            value: 4,
            private: "SENSITIVE_INVALID_INSULIN_UNIT",
          },
          {
            start: "2026-04-22T12:05:00Z",
            end: "2026-04-22T12:06:00Z",
            unit: "unit",
            value: 4,
            private: "SENSITIVE_INVALID_INSULIN_TYPE",
          },
          {
            timestamp: "2026-04-22T12:05:00Z",
            end: "2026-04-22T12:06:00Z",
            type: "rapid_acting",
            unit: "unit",
            value: 4,
            private: "SENSITIVE_INVALID_INSULIN_START",
          },
          {
            start: "2026-04-22T12:05:00Z",
            end: "2026-04-22T12:04:00Z",
            type: "rapid_acting",
            unit: "unit",
            value: 4,
            private: "SENSITIVE_INVALID_INSULIN_INTERVAL",
          },
          {
            start: "2026-04-22T12:05:00Z",
            end: "2026-04-22T12:06:00Z",
            type: "rapid_acting",
            unit: "unit",
            value: -1,
            private: "SENSITIVE_INVALID_INSULIN_VALUE",
          },
        ],
        carbohydrates: [
          {
            start: "2026-04-22T12:00:00Z",
            end: "2026-04-22T12:01:00Z",
            unit: "grams",
            value: 25,
            private: "SENSITIVE_INVALID_CARBOHYDRATE_UNIT",
          },
          {
            timestamp: "2026-04-22T12:00:00Z",
            end: "2026-04-22T12:01:00Z",
            unit: "g",
            value: 25,
            private: "SENSITIVE_INVALID_CARBOHYDRATE_START",
          },
          {
            start: "2026-04-22T12:00:00Z",
            end: "2026-04-22T11:59:00Z",
            unit: "g",
            value: 25,
            private: "SENSITIVE_INVALID_CARBOHYDRATE_INTERVAL",
          },
          {
            start: "2026-04-22T12:00:00Z",
            end: "2026-04-22T12:01:00Z",
            unit: "g",
            value: -1,
            private: "SENSITIVE_INVALID_CARBOHYDRATE_VALUE",
          },
        ],
      },
    },
  });
  const insulinArtifacts = findJunctionSparseMetabolicArtifacts(payload, "insulin-injection");
  const carbohydrateArtifacts = findJunctionSparseMetabolicArtifacts(payload, "carbohydrates");
  const artifactText = JSON.stringify(payload.evidenceParts ?? []);

  assert.deepEqual(payload.events, []);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(insulinArtifacts[0]?.role, "junction-timeseries-reading-insulin-injection:no-valid-samples");
  assert.equal(carbohydrateArtifacts[0]?.role, "junction-timeseries-reading-carbohydrates:no-valid-samples");
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.doesNotMatch(artifactText, /SENSITIVE_INVALID|"value":-1|"data"|"items"|"records"/u);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction Libre wall times require a zone and exactly one UTC instant", () => {
  const snapshot = {
    importedAt: "2023-09-28T12:00:00.000Z",
    timeseries: {
      insulin_injection: {
        groups: {
          freestyle_libre: [{
            data: [{
              start: "2023-09-27T08:00:00+00:00",
              end: "2023-09-27T08:00:00+00:00",
              type: "rapid_acting",
              unit: "unit",
              value: 2,
              private_provider_array: ["SENSITIVE_LIBRE_INSULIN_SENTINEL"],
            }],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
      carbohydrates: {
        groups: {
          abbott_libreview: [{
            data: [{
              start: "2023-09-27T07:00:00+00:00",
              end: "2023-09-27T07:00:00+00:00",
              unit: "g",
              value: 25,
              private_provider_array: ["SENSITIVE_LIBRE_CARBOHYDRATE_SENTINEL"],
            }],
            source: { provider: "abbott_libreview", type: "cgm" },
          }],
        },
      },
    },
  };
  const zoned = normalizeJunctionSnapshot(snapshot, { defaultTimeZone: "America/Chicago" });
  const unzoned = normalizeJunctionSnapshot(snapshot);
  const nonexistentDstWallTime = normalizeJunctionSnapshot({
    importedAt: "2026-03-09T12:00:00.000Z",
    timeseries: {
      carbohydrates: {
        groups: {
          freestyle_libre: [{
            data: [{
              start: "2026-03-08T02:30:00+00:00",
              end: "2026-03-08T02:45:00+00:00",
              unit: "g",
              value: 20,
              private_provider_array: ["SENSITIVE_LIBRE_DST_SENTINEL"],
            }],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
    },
  }, { defaultTimeZone: "America/Chicago" });
  const ambiguousDstWallTime = normalizeJunctionSnapshot({
    importedAt: "2026-11-02T12:00:00.000Z",
    timeseries: {
      carbohydrates: {
        groups: {
          freestyle_libre: [{
            data: [{
              start: "2026-11-01T01:30:00",
              end: "2026-11-01T01:45:00",
              unit: "g",
              value: 20,
              private_provider_array: ["SENSITIVE_LIBRE_OVERLAP_SENTINEL"],
            }],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
    },
  }, { defaultTimeZone: "America/Chicago" });
  const explicitDstOverlap = normalizeJunctionSnapshot({
    importedAt: "2026-11-02T12:00:00.000Z",
    timeseries: {
      carbohydrates: {
        groups: {
          freestyle_libre: [{
            data: [
              {
                start: "2026-11-01T01:30:00-05:00",
                end: "2026-11-01T01:40:00-05:00",
                unit: "g",
                value: 10,
              },
              {
                start: "2026-11-01T01:30:00-06:00",
                end: "2026-11-01T01:40:00-06:00",
                unit: "g",
                value: 20,
              },
            ],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
    },
  });
  const medication = zoned.events?.find((event) => event.kind === "medication_intake");
  const carbohydrate = zoned.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "carbohydrate-intake",
  );
  const zonedArtifactText = JSON.stringify(zoned.evidenceParts ?? []);
  const unzonedArtifactText = JSON.stringify(unzoned.evidenceParts ?? []);

  assert.equal(medication?.occurredAt, "2023-09-27T13:00:00.000Z");
  assert.equal(medication?.dayKey, "2023-09-27");
  assert.equal(medication?.timeZone, "America/Chicago");
  assert.equal(medication?.dataOrigin?.observedAtRaw, "2023-09-27T08:00:00+00:00");
  assert.equal(medication?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(carbohydrate?.occurredAt, "2023-09-27T12:00:00.000Z");
  assert.equal(carbohydrate?.dayKey, "2023-09-27");
  assert.equal(carbohydrate?.timeZone, "America/Chicago");
  assert.equal(carbohydrate?.dataOrigin?.observedAtRaw, "2023-09-27T07:00:00+00:00");
  assert.equal(carbohydrate?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(zoned.samples?.length ?? 0, 0);
  assert.equal(zoned.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.doesNotMatch(zonedArtifactText, /SENSITIVE_LIBRE|private_provider_array|"samples"|"data"\s*:/u);
  assertNoFullJunctionTimeseriesArtifacts(zoned);

  assert.deepEqual(unzoned.events, []);
  assert.equal(unzoned.samples?.length ?? 0, 0);
  assert.equal(
    findJunctionSparseMetabolicArtifacts(unzoned, "insulin-injection")[0]?.role,
    "junction-timeseries-reading-insulin-injection:no-valid-samples",
  );
  assert.equal(
    findJunctionSparseMetabolicArtifacts(unzoned, "carbohydrates")[0]?.role,
    "junction-timeseries-reading-carbohydrates:no-valid-samples",
  );
  assert.doesNotMatch(unzonedArtifactText, /SENSITIVE_LIBRE|private_provider_array|"samples"|"data"\s*:/u);
  assertNoFullJunctionTimeseriesArtifacts(unzoned);

  assert.deepEqual(nonexistentDstWallTime.events, []);
  assert.equal(nonexistentDstWallTime.samples?.length ?? 0, 0);
  assert.equal(
    findJunctionSparseMetabolicArtifacts(nonexistentDstWallTime, "carbohydrates")[0]?.role,
    "junction-timeseries-reading-carbohydrates:no-valid-samples",
  );
  assert.doesNotMatch(
    JSON.stringify(nonexistentDstWallTime.evidenceParts ?? []),
    /SENSITIVE_LIBRE_DST|private_provider_array|"samples"|"data"\s*:/u,
  );
  assertNoFullJunctionTimeseriesArtifacts(nonexistentDstWallTime);

  assert.deepEqual(ambiguousDstWallTime.events, []);
  assert.equal(ambiguousDstWallTime.samples?.length ?? 0, 0);
  assert.equal(
    findJunctionSparseMetabolicArtifacts(ambiguousDstWallTime, "carbohydrates")[0]?.role,
    "junction-timeseries-reading-carbohydrates:no-valid-samples",
  );
  assert.doesNotMatch(
    JSON.stringify(ambiguousDstWallTime.evidenceParts ?? []),
    /SENSITIVE_LIBRE_OVERLAP|private_provider_array|"samples"|"data"\s*:/u,
  );
  assertNoFullJunctionTimeseriesArtifacts(ambiguousDstWallTime);

  const explicitOverlapEvents = explicitDstOverlap.events?.filter(
    (event) => event.kind === "observation" && event.fields?.metric === "carbohydrate-intake",
  ) ?? [];
  assert.deepEqual(
    explicitOverlapEvents.map((event) => event.occurredAt).sort(),
    ["2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"],
  );
  assert.ok(explicitOverlapEvents.every((event) =>
    event.dataOrigin?.timestampSemantics === "offset"
  ));
  assertNoFullJunctionTimeseriesArtifacts(explicitDstOverlap);
});

test("Junction Libre explicit overlap offsets preserve both instants through correction and replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-libre-overlap");
  const makeSnapshot = (input: {
    carbohydrateEnd: string;
    carbohydrateValue: number;
    importedAt: string;
    insulinDose: number;
    insulinEnd: string;
    rowSuffix: string;
  }) => ({
    accountId: "junction-account-libre-overlap",
    importedAt: input.importedAt,
    timeseries: {
      carbohydrates: {
        groups: {
          freestyle_libre: [{
            data: [{
              id: `carbohydrate-${input.rowSuffix}`,
              source_device_id: `libre-${input.rowSuffix}`,
              start: "2026-11-01T01:30:00-05:00",
              end: input.carbohydrateEnd,
              unit: "g",
              value: input.carbohydrateValue,
            }],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
      insulin_injection: {
        groups: {
          freestyle_libre: [{
            data: [{
              id: `insulin-${input.rowSuffix}`,
              source_device_id: `libre-${input.rowSuffix}`,
              start: "2026-11-01T01:30:00-06:00",
              end: input.insulinEnd,
              type: "rapid_acting",
              delivery_mode: "bolus",
              unit: "unit",
              value: input.insulinDose,
            }],
            source: { provider: "freestyle_libre", type: "cgm" },
          }],
        },
      },
    },
  });
  const firstSnapshot = makeSnapshot({
    carbohydrateEnd: "2026-11-01T01:40:00-05:00",
    carbohydrateValue: 20,
    importedAt: "2026-11-02T12:00:00.000Z",
    insulinDose: 2,
    insulinEnd: "2026-11-01T01:45:00-06:00",
    rowSuffix: "original",
  });
  const correctedSnapshot = makeSnapshot({
    carbohydrateEnd: "2026-11-01T01:42:00-05:00",
    carbohydrateValue: 25,
    importedAt: "2026-11-02T13:00:00.000Z",
    insulinDose: 3,
    insulinEnd: "2026-11-01T01:47:00-06:00",
    rowSuffix: "correction",
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-11-01T00:00:00.000Z",
      timezone: "America/Chicago",
    });
    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: firstSnapshot },
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: firstSnapshot },
      { corePort: coreRuntime },
    );
    const correction = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: correctedSnapshot },
      { corePort: coreRuntime },
    );
    const correctedPayload = normalizeJunctionSnapshot(correctedSnapshot);
    const carbohydrate = correction.events.find(
      (event) => event.kind === "observation" && event.metric === "carbohydrate-intake",
    );
    const insulin = correction.events.find((event) => event.kind === "medication_intake");
    const carbohydrateArtifact = findJunctionSparseMetabolicArtifacts(
      correctedPayload,
      "carbohydrates",
    )[0]?.content as Record<string, unknown> | undefined;
    const insulinArtifact = findJunctionSparseMetabolicArtifacts(
      correctedPayload,
      "insulin-injection",
    )[0]?.content as Record<string, unknown> | undefined;

    assert.equal(carbohydrate?.occurredAt, "2026-11-01T06:30:00.000Z");
    assert.equal(carbohydrate?.dayKey, "2026-11-01");
    assert.equal(carbohydrate?.dataOrigin?.timestampSemantics, "offset");
    assert.equal(insulin?.occurredAt, "2026-11-01T07:30:00.000Z");
    assert.equal(insulin?.dayKey, "2026-11-01");
    assert.equal(insulin?.dataOrigin?.timestampSemantics, "offset");
    assert.equal(carbohydrateArtifact?.endAt, "2026-11-01T06:42:00.000Z");
    assert.equal(insulinArtifact?.endAt, "2026-11-01T07:47:00.000Z");
    assert.equal(replay.applied, false);
    assert.equal(correction.applied, true);
    assert.deepEqual(
      correction.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction metabolic facts replay and apply provider corrections under stable identities", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-metabolic-import");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: [{
          id: "glucose-provider-row-old",
          sourceProviderSlug: "dexcom",
          sourceType: "cgm",
          sourceDeviceId: "dexcom-device-old",
          timestamp: "2026-04-22T12:00:00Z",
          unit: "mmol/L",
          value: 5,
        }],
        insulin_injection: [{
          id: "insulin-provider-row-old",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "phone",
          sourceDeviceId: "apple-phone-old",
          start: "2026-04-22T17:05:00Z",
          end: "2026-04-22T17:06:00Z",
          type: "rapid_acting",
          delivery_mode: "bolus",
          unit: "unit",
          value: 4,
        }],
        carbohydrates: [{
          id: "carbohydrate-provider-row-old",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "phone",
          sourceDeviceId: "apple-phone-old",
          start: "2026-04-22T17:00:00Z",
          end: "2026-04-22T17:01:00Z",
          unit: "g",
          value: 35,
        }],
      },
    };
    const correctedSnapshot = {
      ...snapshot,
      importedAt: "2026-04-23T13:00:00.000Z",
      timeseries: {
        glucose: [{
          ...snapshot.timeseries.glucose[0],
          id: "glucose-provider-row-correction",
          sourceDeviceId: "dexcom-device-correction",
          value: 7,
        }],
        insulin_injection: [{
          ...snapshot.timeseries.insulin_injection[0],
          id: "insulin-provider-row-correction",
          sourceDeviceId: "apple-phone-correction",
          end: "2026-04-22T17:07:00Z",
          value: 2,
        }],
        carbohydrates: [{
          ...snapshot.timeseries.carbohydrates[0],
          id: "carbohydrate-provider-row-correction",
          sourceDeviceId: "apple-phone-correction",
          end: "2026-04-22T17:02:00Z",
          value: 40,
        }],
      },
    };
    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );
    const correction = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: correctedSnapshot },
      { corePort: coreRuntime },
    );
    const records = (
      await Promise.all(
        [...new Set([
          ...first.eventShardPaths,
          ...replay.eventShardPaths,
          ...correction.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const metabolicObservationMetrics = new Set([
      "carbohydrate-intake",
      "glucose",
      "lowest-glucose",
      "highest-glucose",
      "glucose-standard-deviation",
      "glucose-coefficient-of-variation",
    ]);
    const liveMetabolicRecords = latestLiveRecords(records).filter((record) =>
      record.kind === "medication_intake" ||
      (
        record.kind === "observation"
        && typeof record.metric === "string"
        && metabolicObservationMetrics.has(record.metric)
      )
    );
    const medication = correction.events.find((event) => event.kind === "medication_intake");
    const carbohydrate = correction.events.find(
      (event) => event.kind === "observation" && event.metric === "carbohydrate-intake",
    );
    const glucose = correction.events.find(
      (event) => event.kind === "observation" && event.metric === "glucose",
    );

    assert.equal(first.events.some((event) => event.kind === "meal"), false);
    assert.equal(medication?.kind, "medication_intake");
    if (medication?.kind === "medication_intake") {
      assert.equal(medication.medicationName, "Insulin (rapid acting)");
      assert.equal(medication.dose, 2);
      assert.equal(medication.unit, "unit");
    }
    assert.equal(carbohydrate?.kind, "observation");
    if (carbohydrate?.kind === "observation") {
      assert.equal(carbohydrate.observationGrain, "sample");
      assert.equal(carbohydrate.value, 40);
      assert.equal(carbohydrate.unit, "g");
    }
    assert.equal(glucose?.kind, "observation");
    if (glucose?.kind === "observation") {
      assert.equal(glucose.observationGrain, "summary");
      assert.equal(glucose.value, 126.1274);
      assert.equal(glucose.unit, "mg/dL");
    }
    assert.equal(replay.applied, false);
    assert.equal(correction.applied, true);
    assert.deepEqual(
      replay.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
    assert.deepEqual(
      correction.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
    assert.equal(liveMetabolicRecords.length, 7);
    assert.equal(new Set(liveMetabolicRecords.map((record) => record.id)).size, 7);
    assert.deepEqual(
      liveMetabolicRecords
        .filter((record) =>
          record.kind === "medication_intake" ||
          (record.kind === "observation" && record.metric === "carbohydrate-intake")
        )
        .map((record) => record.kind === "medication_intake" ? record.dose : record.value)
        .sort((left, right) => Number(left) - Number(right)),
      [2, 40],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
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

test("Junction normalizer lands Oura note tags without retaining note text", async () => {
  const snapshot = {
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      note: {
        groups: {
          oura: [{
            data: [
              {
                start: "2026-04-22T18:05:00+02:00",
                end: "2026-04-22T18:10:00+02:00",
                tags: ["Sauna", "late meal", "Sauna"],
                unit: "text",
                value: "SENSITIVE_VALUE_SENTINEL_A",
              },
              {
                start: "2026-04-22T18:05:00+02:00",
                end: "2026-04-22T18:10:00+02:00",
                tags: ["Alcohol"],
                unit: "text",
                value: "SENSITIVE_VALUE_SENTINEL_B",
              },
            ],
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
    },
  };
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-oura",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot,
  });
  const tagEvents = (payload.events ?? []).filter((event) => event.kind === "intervention_session");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["note"]);
  assert.deepEqual(
    tagEvents.map((event) => event.fields?.interventionType).sort(),
    ["alcohol", "late-meal", "sauna"],
  );
  assert.ok(tagEvents.every((event) => event.fields?.sessionStatus === "completed"));
  assert.ok(tagEvents.every((event) => event.dayKey === "2026-04-22"));
  assert.ok(tagEvents.every((event) => event.dataOrigin?.sourceProviderSlug === "oura"));
  assert.equal(new Set(tagEvents.map((event) => event.externalRef?.resourceId)).size, 2);
  assert.equal(new Set(tagEvents.map((event) => event.externalRef?.facet)).size, 3);
  assert.equal(findJunctionNoteArtifacts(payload).length, 2);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.doesNotMatch(JSON.stringify(payload.evidenceParts), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /SENSITIVE_VALUE_SENTINEL/u,
  );
});

test("Junction exposes repair-stable opaque identities for blood pressure provider rows", () => {
  const snapshot = (entry: Record<string, unknown>) => ({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_pressure: [{
        ...entry,
        sourceProviderSlug: "omron",
        sourceType: "cuff",
        sourceInstanceId: "primary",
      }],
    },
  });
  const malformed = snapshot({
    id: "provider-row-needing-repair",
    timestamp: "2026-04-22T08:05:00Z",
    systolic: 125,
  });
  const repaired = snapshot({
    id: "provider-row-needing-repair",
    timestamp: "2026-04-22T08:10:00Z",
    systolic: 124,
    diastolic: 78,
  });
  const malformedEvidence = identifyJunctionBloodPressureProviderRecords(malformed);
  const repairedEvidence = identifyJunctionBloodPressureProviderRecords(repaired);
  const repairedEvent = normalizeJunctionSnapshot(repaired).events?.[0];

  assert.equal(malformedEvidence.providerRecordCount, 1);
  assert.deepEqual(
    repairedEvidence.repairStableExternalRefResourceIds,
    malformedEvidence.repairStableExternalRefResourceIds,
  );
  assert.equal(
    repairedEvent?.externalRef?.resourceId,
    malformedEvidence.repairStableExternalRefResourceIds[0],
  );
  assert.deepEqual(
    identifyJunctionBloodPressureProviderRecords(snapshot({
      timestamp: "2026-04-22T08:05:00Z",
      systolic: 125,
    })).repairStableExternalRefResourceIds,
    [null],
  );
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
  // evidence part instead of staging duplicate evidence.
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
  const rawArtifactText = JSON.stringify(payload.evidenceParts ?? []);

  assert.ok(compactArtifact);
  assert.equal(compactArtifactContent?.status, "no_valid_samples");
  assert.equal(compactArtifactContent?.sampleCount, 0);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
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
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
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
  const rawReceiptText = JSON.stringify(rawReceipt);
  const rawArtifactText = JSON.stringify(payload.evidenceParts);
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
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role.startsWith("wearable-raw-receipt:")), false);
  assert.deepEqual(rawReceipt.rawArtifactRoles, [
    "junction-summary-profile",
    "junction-summary-activity",
  ]);
  assert.equal(rawReceipt.rawArtifactCount, 2);
  assert.equal(rawReceipt.rawArtifactRoles.some((role) => role.startsWith("wearable-raw-receipt:")), false);
  assertJsonOmits(rawReceiptText, [...rawIdentifierSentinels, "\"sourceProviderSlug\"", "\"sourceType\"", "\"value\":123"]);
  assertJsonOmits(rawArtifactText, rawIdentifierSentinels);
  assert.match(rawReceiptText, /"provider":"junction"/u);
  assert.match(rawArtifactText, /"sourceProviderSlug":"oura"/u);
  assert.match(rawArtifactText, /"sourceType":"ring"/u);
  assert.doesNotMatch(rawArtifactText, /"value":123/u);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction importer compacts floating-timestamp glucose records without retaining raw samples", async () => {
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
            sourceProviderSlug: "abbott_libreview",
            timestamp: "2023-09-27T07:48:00+00:00",
            unit: "mmol/L",
            value: 5.5,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            timestamp: "2023-09-27T08:03:00+00:00",
            unit: "mmol/L",
            value: 6.5,
          },
        ],
      },
    },
  });

  const glucoseSamples = payload.samples?.filter((sample) => sample.stream === "glucose") ?? [];
  const glucoseEvents = payload.events?.filter((event) =>
    event.kind === "observation" &&
    [
      "glucose",
      "lowest-glucose",
      "highest-glucose",
      "glucose-standard-deviation",
      "glucose-coefficient-of-variation",
    ].includes(String(event.fields?.metric))
  ) ?? [];
  const mean = glucoseEvents.find((event) => event.fields?.metric === "glucose");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(glucoseEvents.length, 5);
  assert.equal(mean?.occurredAt, "2023-09-27T00:00:00.000Z");
  assert.equal(mean?.dayKey, "2023-09-27");
  assert.equal(mean?.fields?.value, 108.1092);
  assert.equal(mean?.dataOrigin?.timestampSemantics, "floating");
  assert.equal(glucoseSamples.length, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "glucose").length, 1);
  assert.equal(
    payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-daily-glucose:no-valid-samples"),
    false,
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
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

  const bodyArtifact = payload.evidenceParts?.find((artifact) => artifact.role === "junction-summary-body");
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
  const respiratoryArtifact = payload.evidenceParts?.find((artifact) =>
    artifact.role === "junction-timeseries-respiratory-rate"
  );

  assert.equal(stepEvent?.fields?.value, 7200);
  assert.equal(stepEvent?.occurredAt, "2026-05-20T12:00:00.000Z");
  assert.equal(stepEvent?.dataOrigin?.sourceProviderSlug, "garmin");
  assert.equal(stepEvent?.dataOrigin?.sourceType, "watch");
  assert.equal(sleepSession?.fields?.durationMinutes, 480);
  assert.equal(sleepSession?.occurredAt, "2026-05-20T10:00:00.000Z");
  assert.equal(sleepScore?.fields?.value, 82);
  assert.equal(respiratoryRate?.fields?.value, 14.8);
  assert.equal(respiratoryRate?.dayKey, "2026-05-20");
  assert.deepEqual(payload.provenance?.summaryResources, ["activity", "sleep"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["respiratory_rate"]);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep"));
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
    "note",
    "carbohydrates",
    "insulin_injection",
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
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-profile"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-menstrual-cycle"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
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
  assert.equal(findJunctionSparseMetabolicArtifacts(payload, "insulin-injection").length, 1);
  assert.equal(findJunctionSparseMetabolicArtifacts(payload, "carbohydrates").length, 1);
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
  assert.ok(sparseProfilePayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-profile"));
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
          { date: "2026-04-28", test_result: "positive" },
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
  const rawCycleArtifact = payload.evidenceParts?.find((artifact) =>
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
    value: 1,
    unit: "result",
    qualifiers: { result: "positive" },
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
  assertJsonOmits(JSON.stringify(payload.evidenceParts), [
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
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
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
  // The full event time is pinned to the provider's updated_at — never the
  // sync window — so reconciles don't revise the spine and month-boundary
  // syncs can't duplicate the profile.
  assert.equal(demographics?.occurredAt, "2026-04-20T09:00:00.000Z");
  assert.equal(demographics?.dayKey, "2026-04-20");
  assert.equal(height?.occurredAt, "2026-04-20T09:00:00.000Z");
  assertEventRawArtifactRolesExist(payload);

  // A profile with no provider timestamp at all stays raw-only: inventing
  // an event time from the sync window would drift per sync.
  const noTimestampPayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-22T11:00:00.000Z",
    summaries: {
      profile: {
        id: "profile-no-timestamp",
        height: 181,
        source: { provider: "oura", type: "ring" },
      },
    },
  });
  assert.equal((noTimestampPayload.events ?? []).length, 0);
  assert.ok(noTimestampPayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-profile"));

  // The raw profile artifact stays identity-sanitized even though the
  // normalized events carry the structured fields.
  const profileArtifact = payload.evidenceParts?.find((artifact) => artifact.role === "junction-summary-profile");
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

test("Junction menstrual cycles land explicit provider length fields when end dates are absent", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "cycle-explicit-lengths",
        period_start: "2026-04-07",
        period_length_days: 5,
        cycle_length_days: 28,
        source: { provider: "apple_health", type: "phone" },
      }, {
        // No period_start at all: cycle_start anchors the explicit length.
        id: "cycle-start-only",
        cycle_start: "2026-05-05",
        cycle_length_days: 200, // implausible (>120) — must drop
        period_length_days: 4,
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });
  const observations = (payload.events ?? []).filter((event) => event.kind === "observation");
  const byKey = new Map(observations.map((event) => [`${event.fields?.metric}:${event.dayKey}`, event]));

  assert.equal(byKey.get("period-length-days:2026-04-07")?.fields?.value, 5);
  assert.equal(byKey.get("cycle-length-days:2026-04-07")?.fields?.value, 28);
  assert.equal(byKey.get("period-length-days:2026-05-05")?.fields?.value, 4);
  assert.equal(byKey.has("cycle-length-days:2026-05-05"), false);
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
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-electrocardiogram"));
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
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-workout-stream"), false);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-workout-distance"), false);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-workout-swimming-stroke"), false);
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

  const rawArtifactText = JSON.stringify(payload.evidenceParts);

  assert.deepEqual(payload.provenance?.summaryResources, []);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.ok(payload.ingestReceipt);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role.startsWith("wearable-raw-receipt:")), false);
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
  const unsupportedArtifactText = JSON.stringify(unsupportedPayload.evidenceParts);

  assert.equal(unsupportedReceipt.payloadHash, emptyReceipt.payloadHash);
  assert.equal(unsupportedReceipt.id, emptyReceipt.id);
  assert.deepEqual(unsupportedPayload.provenance?.summaryResources, []);
  assert.deepEqual(unsupportedPayload.provenance?.timeseriesResources, []);
  assert.equal(unsupportedPayload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
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
  const mixedArtifactText = JSON.stringify(mixedPayload.evidenceParts);

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
        unit: "mmol/L",
        value: 5.6,
      }],
    },
  });

  const glucoseEvent = payload.events?.find((event) => event.fields?.metric === "glucose");

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "glucose").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-garmin-hypnogram"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "average-heart-rate"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "weight"), false);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "active-calories"), false);
  // blood_glucose canonicalizes to the supported glucose resource.
  assert.equal(glucoseEvent?.fields?.value, 100.9019);
});

test("Junction sleep_cycle normalizer emits compact sleep-stage observations", () => {
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
        start: "2026-05-20T02:00:00+00:00",
        end: "2026-05-20T04:30:00+00:00",
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
        start: "2026-05-20T05:00:00+00:00",
        end: "2026-05-20T05:20:00+00:00",
        stages: [{
          startAt: "2026-05-20T05:00:00+00:00",
          endAt: "2026-05-20T05:20:00+00:00",
          stage: "core",
        }],
      }],
    },
  });
  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const rawSleepCycleArtifact = payload.evidenceParts?.find((artifact) =>
    artifact.role === "junction-summary-sleep-cycle"
  );
  const rawSleepCycleArtifactText = JSON.stringify(rawSleepCycleArtifact?.content);

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(
    payload.evidenceParts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assert.equal(rawSleepCycleArtifact?.role, "junction-summary-sleep-cycle");
  assert.doesNotMatch(rawSleepCycleArtifactText, /raw-oura-ring-1/u);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 8);
  assert.deepEqual(observations.map((event) => event.fields?.metric), [
    "sleep-light-minutes",
    "sleep-rem-minutes",
    "sleep-deep-minutes",
    "sleep-awake-minutes",
    "sleep-light-minutes",
    "sleep-awake-minutes",
    "sleep-deep-minutes",
    "sleep-rem-minutes",
  ]);
  assert.deepEqual(observations.map((event) => event.fields?.value), [30, 30, 75, 15, 20, 0, 0, 0]);
  assert.ok(observations.every((event) => event.fields?.unit === "minutes"));
  assert.ok(observations.every((event) => event.fields?.observationGrain === "summary"));
  assert.ok(observations.every((event) => event.externalRef?.system === "junction"));
  assert.ok(observations.every((event) => event.externalRef?.version === undefined));
  assert.ok(observations.every((event) =>
    event.dataOrigin?.normalizerVersion === "junction-sleep-stage-cycle-fallback.v1"
  ));
  assert.equal(observations.some((event) => event.externalRef?.resourceType.includes("hypnogram")), false);
  assert.deepEqual([...new Set(observations.map((event) => event.externalRef?.resourceType))].sort(), [
    "junction-garmin-sleep",
    "junction-oura-sleep",
  ]);
  assert.ok(observations.slice(0, 4).every((event) => event.dataOrigin?.sourceProviderSlug === "oura"));
  assert.ok(observations.slice(0, 4).every((event) => event.dataOrigin?.sourceType === "ring"));
  assert.equal(observations[4]?.dataOrigin?.sourceProviderSlug, "garmin");
});

test("Junction sleep_cycle fills missing sleep summary stages without duplicating cross-midnight stages", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-07-01T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-garmin-1",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        timeZone: "America/New_York",
        observedAt: "2026-07-01T11:00:00.000Z",
        start: "2026-07-01T03:30:00.000Z",
        end: "2026-07-01T11:00:00.000Z",
        stages: [
          {
            start: "2026-07-01T03:30:00.000Z",
            end: "2026-07-01T03:45:00.000Z",
            stage: "light",
          },
          {
            start: "2026-07-01T03:45:00.000Z",
            end: "2026-07-01T04:15:00.000Z",
            stage: "deep",
          },
          {
            start: "2026-07-01T04:15:00.000Z",
            end: "2026-07-01T05:00:00.000Z",
            stage: "light",
          },
          {
            start: "2026-07-01T05:00:00.000Z",
            end: "2026-07-01T06:30:00.000Z",
            stage: "rem",
          },
          {
            start: "2026-07-01T06:30:00.000Z",
            end: "2026-07-01T10:30:00.000Z",
            stage: "light",
          },
          {
            start: "2026-07-01T10:30:00.000Z",
            end: "2026-07-01T10:45:00.000Z",
            stage: "awake",
          },
          {
            start: "2026-07-01T10:45:00.000Z",
            end: "2026-07-01T11:00:00.000Z",
            stage: "light",
          },
        ],
      }],
      sleep: [{
        id: "sleep-garmin-1",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        timeZone: "America/New_York",
        bedtime_start: "2026-06-30T23:30:00-04:00",
        bedtime_stop: "2026-07-01T07:00:00-04:00",
        deep: 3600,
        rem: 5400,
        light: 18000,
      }],
    },
  });
  const stageMetricNames = new Set([
    "sleep-awake-minutes",
    "sleep-light-minutes",
    "sleep-deep-minutes",
    "sleep-rem-minutes",
  ]);
  const stageObservations = (payload.events ?? []).filter((event) =>
    event.kind === "observation" &&
    typeof event.fields?.metric === "string" &&
    stageMetricNames.has(event.fields.metric)
  );
  const stageObservationsFor = (metric: string) =>
    stageObservations.filter((event) => event.fields?.metric === metric);

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(
    payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"),
    true,
  );
  const positiveStageObservations = stageObservations.filter((event) => Number(event.fields?.value ?? 0) > 0);
  assert.deepEqual(positiveStageObservations.map((event) => event.fields?.metric).sort(), [
    "sleep-awake-minutes",
    "sleep-deep-minutes",
    "sleep-light-minutes",
    "sleep-rem-minutes",
  ]);
  assert.ok(positiveStageObservations.every((event) => event.externalRef?.version === undefined));

  const positiveDeepObservations = stageObservationsFor("sleep-deep-minutes")
    .filter((event) => Number(event.fields?.value ?? 0) > 0);
  assert.equal(positiveDeepObservations.length, 1);
  assert.equal(positiveDeepObservations[0]?.externalRef?.resourceType, "junction-garmin-sleep");
  assert.equal(positiveDeepObservations[0]?.dataOrigin?.normalizerVersion, "junction-sleep-stage-summary.v1");
  assert.equal(positiveDeepObservations[0]?.fields?.value, 60);

  const awakeObservations = stageObservationsFor("sleep-awake-minutes");
  assert.equal(awakeObservations.length, 1);
  assert.ok(awakeObservations.every((event) => event.externalRef?.resourceType === "junction-garmin-sleep"));
  assert.ok(awakeObservations.every((event) =>
    event.dataOrigin?.normalizerVersion === "junction-sleep-stage-cycle-fallback.v1"
  ));
  assert.deepEqual(
    awakeObservations.map((event) => [event.dayKey, event.fields?.value]).sort(),
    [
      ["2026-07-01", 15],
    ],
  );
});

test("Junction sleep_cycle normalizer vectorizes parallel offset stage arrays", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-06-25T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-garmin-parallel-1",
          session_start: "2026-06-25T02:00:00.000Z",
          session_end: "2026-06-25T03:00:00.000Z",
          source_provider: "garmin",
          source_type: "watch",
          stage_start_offset_second: [0, 900, 1800, 2700],
          stage_end_offset_second: [900, 1800, 2700, 3600],
          stage_type: [2, 3, 4, 1],
          time_zone: "America/New_York",
        }],
      },
    },
    { defaultTimeZone: "America/New_York" },
  );
  const observations = (payload.events?.filter((event) =>
    event.kind === "observation" && Number(event.fields?.value ?? 0) > 0
  ) ?? []);

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 4);
  assert.deepEqual(observations.map((event) => event.fields?.metric), [
    "sleep-light-minutes",
    "sleep-rem-minutes",
    "sleep-awake-minutes",
    "sleep-deep-minutes",
  ]);
  assert.deepEqual(observations.map((event) => event.fields?.value), [15, 15, 15, 15]);
  assert.deepEqual(observations.map((event) => event.dayKey), [
    "2026-06-24",
    "2026-06-24",
    "2026-06-24",
    "2026-06-24",
  ]);
  assert.ok(observations.every((event) => event.timeZone === "America/New_York"));
  assert.ok(observations.every((event) => event.externalRef?.resourceType === "junction-garmin-sleep"));
  assert.deepEqual(observations.map((event) => event.externalRef?.facet), [
    "sleep-light-minutes",
    "sleep-rem-minutes",
    "sleep-awake-minutes",
    "sleep-deep-minutes",
  ]);
});

test("Junction summary normalization evidence uses canonical importer semantics", () => {
  const window = {
    importedAt: "2026-06-26T00:00:00.000Z",
    windowStart: "2026-06-24T00:00:00.000Z",
    windowEnd: "2026-06-26T00:00:00.000Z",
  };

  const evidence = classifyJunctionSummaryNormalizationEvidence({
    ...window,
    summaries: {
      activity: [{
        date: "2026-06-25T00:00:00.000Z",
        calories_active: 412,
        sourceProviderSlug: "oura",
      }],
      sleep: [{
        awakeMinutes: 15,
        deepMinutes: 15,
        end: "2026-06-25T03:00:00.000Z",
        lightMinutes: 15,
        remMinutes: 15,
        recovery_readiness_score: 82,
        sourceProviderSlug: "oura",
        start: "2026-06-25T02:00:00.000Z",
      }],
      sleep_cycle: [
        {
          id: "sleep-cycle-oura-parallel-evidence",
          session_start: "2026-06-25T02:00:00.000Z",
          session_end: "2026-06-25T03:00:00.000Z",
          sourceProviderSlug: "oura",
          stage_start_offset_second: [0, 900, 1800, 2700],
          stage_end_offset_second: [900, 1800, 2700, 3600],
          stage_type: [2, 3, 4, 1],
        },
        {
          id: "sleep-cycle-stage-count-only",
          session_end: "2026-06-25T03:00:00.000Z",
          session_start: "2026-06-25T02:00:00.000Z",
          sourceProviderSlug: "fitbit",
          stageCount: 4,
        },
      ],
    },
  });

  assert.deepEqual(evidence, [
    { resource: "activity", sourceProviderSlug: "oura" },
    { resource: "sleep", sourceProviderSlug: "oura" },
    { resource: "sleep_cycle", sourceProviderSlug: "oura" },
  ]);
});

test("Junction summary normalization evidence uses canonical event time or calendar-day ownership", () => {
  const snapshot = {
    importedAt: "2026-06-28T00:00:00.000Z",
    windowStart: "2026-06-25T00:00:00.000Z",
    windowEnd: "2026-06-26T00:00:00.000Z",
    summaries: {
      activity: [
        {
          calories_active: 100,
          date: "2026-06-24T23:59:59.999Z",
          sourceProviderSlug: "polar",
        },
        {
          calories_active: 200,
          date: "2026-06-25T00:00:00.000Z",
          sourceProviderSlug: "oura",
        },
        {
          calories_active: 300,
          date: "2026-06-26T00:00:00.000Z",
          sourceProviderSlug: "fitbit",
        },
        {
          calories_active: 400,
          date: "2026-06-26T00:00:00.001Z",
          sourceProviderSlug: "garmin",
        },
        {
          calories_active: 500,
          date: "2026-06-25",
          sourceProviderSlug: "withings",
        },
        {
          calories_active: 600,
          date: "2026-06-26",
          sourceProviderSlug: "polar",
        },
      ],
    },
  };

  assert.deepEqual(
    classifyJunctionSummaryNormalizationEvidence(snapshot, {
      windowStart: "2026-06-25T00:00:00.000Z",
      windowEnd: "2026-06-26T00:00:00.000Z",
    }),
    [
      { resource: "activity", sourceProviderSlug: "oura" },
      { resource: "activity", sourceProviderSlug: "withings" },
    ],
  );

  const invalidWindows = [
    {
      windowStart: "invalid",
      windowEnd: "2026-06-26T00:00:00.000Z",
    },
    {
      windowStart: "2026-06-25T00:00:00.000Z",
      windowEnd: "invalid",
    },
    {
      windowStart: "2026-06-25T00:00:00.000Z",
      windowEnd: "2026-06-25T00:00:00.000Z",
    },
    {
      windowStart: "2026-06-26T00:00:00.000Z",
      windowEnd: "2026-06-25T00:00:00.000Z",
    },
  ];

  for (const invalidWindow of invalidWindows) {
    assert.deepEqual(
      classifyJunctionSummaryNormalizationEvidence(snapshot, invalidWindow),
      [],
    );
  }
});

test("Junction Apple HealthKit zeroed sleep summary preserves awake and derives generic asleep total", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-07T18:53:32.000Z",
      summaries: {
        sleep: [{
          id: "apple-healthkit-zeroed-sleep",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "unknown",
          bedtime_start: "2026-07-07T08:17:04+00:00",
          bedtime_stop: "2026-07-07T14:02:56+00:00",
          duration: 20752,
          total: 0,
          deep: 0,
          rem: 0,
          light: 0,
          awake: 1110,
          efficiency: 0,
          created_at: "2026-07-07T18:53:32+00:00",
        }],
        sleep_cycle: [{
          id: "apple-healthkit-generic-asleep-cycle",
          sleep_id: "apple-healthkit-zeroed-sleep",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "unknown",
          session_start: "2026-07-07T08:17:04+00:00",
          session_end: "2026-07-07T14:02:56+00:00",
          stage_start_offset_second: [
            0,
            5148,
            5358,
            6259,
            6319,
            6439,
            6529,
            9230,
            9320,
            9890,
            10100,
            14061,
            14091,
            14421,
            14451,
            16161,
            16221,
            16401,
            16431,
            19552,
            19792,
            19912,
            19972,
          ],
          stage_end_offset_second: [
            5148,
            5358,
            6259,
            6319,
            6439,
            6529,
            9230,
            9320,
            9890,
            10100,
            14061,
            14091,
            14421,
            14451,
            16161,
            16221,
            16401,
            16431,
            19552,
            19792,
            19912,
            19972,
            20752,
          ],
          stage_type: [-1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1, 4, -1],
          created_at: "2026-07-07T18:53:32+00:00",
        }],
      },
    },
    { defaultTimeZone: "America/New_York" },
  );

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValues = (metric: string) =>
    observations.filter((event) => event.fields?.metric === metric).map((event) => event.fields?.value);
  const metrics = observations.map((event) => event.fields?.metric);

  assert.equal(payload.events?.some((event) => event.kind === "sleep_session"), true);
  assert.deepEqual(metricValues("sleep-total-minutes"), [327.3667]);
  assert.deepEqual(metricValues("sleep-awake-minutes"), [18.5]);
  assert.equal(metrics.includes("sleep-efficiency"), false);
  assert.equal(metrics.includes("sleep-deep-minutes"), false);
  assert.equal(metrics.includes("sleep-rem-minutes"), false);
  assert.equal(metrics.includes("sleep-light-minutes"), false);
  assert.ok(
    observations
      .filter((event) => event.fields?.metric === "sleep-total-minutes")
      .every((event) => event.dataOrigin?.normalizerVersion === "junction-sleep-unspecified-total.v1"),
  );
});

test("Junction Apple HealthKit string negative-one stages derive generic asleep total", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep: [{
          id: "apple-healthkit-zeroed-string-stage-sleep",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "unknown",
          bedtime_start: "2026-07-08T00:00:00+00:00",
          bedtime_stop: "2026-07-08T02:00:00+00:00",
          duration: 7200,
          total: 0,
          deep: 0,
          rem: 0,
          light: 0,
          awake: 900,
          efficiency: 0,
          created_at: "2026-07-08T12:00:00+00:00",
        }],
        sleep_cycle: [{
          id: "apple-healthkit-string-generic-asleep-cycle",
          sleep_id: "apple-healthkit-zeroed-string-stage-sleep",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "unknown",
          session_start: "2026-07-08T00:00:00+00:00",
          session_end: "2026-07-08T02:00:00+00:00",
          stage_start_offset_second: [0, 3600, 4500],
          stage_end_offset_second: [3600, 4500, 7200],
          stage_type: ["-1", "4", "-1"],
          time_zone: "UTC",
          created_at: "2026-07-08T12:00:00+00:00",
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValues = (metric: string) =>
    observations.filter((event) => event.fields?.metric === metric).map((event) => event.fields?.value);
  const metrics = observations.map((event) => event.fields?.metric);

  assert.deepEqual(metricValues("sleep-total-minutes"), [105]);
  assert.deepEqual(metricValues("sleep-awake-minutes"), [15]);
  assert.equal(metrics.includes("sleep-efficiency"), false);
  assert.equal(metrics.includes("sleep-deep-minutes"), false);
  assert.equal(metrics.includes("sleep-rem-minutes"), false);
  assert.equal(metrics.includes("sleep-light-minutes"), false);
  assert.ok(
    observations
      .filter((event) => event.fields?.metric === "sleep-total-minutes")
      .every((event) => event.dataOrigin?.normalizerVersion === "junction-sleep-unspecified-total.v1"),
  );
});

test("Junction sleep_cycle generic asleep total includes explicit detailed asleep intervals", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "apple-healthkit-mixed-generic-detailed-cycle",
          sourceProviderSlug: "apple_health_kit",
          sourceType: "unknown",
          session_start: "2026-07-08T00:00:00+00:00",
          session_end: "2026-07-08T08:00:00+00:00",
          stage_start_offset_second: [0, 7200, 10800, 25200],
          stage_end_offset_second: [7200, 10800, 25200, 28800],
          stage_type: [-1, 1, 2, 4],
          time_zone: "UTC",
          created_at: "2026-07-08T12:00:00+00:00",
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metricValues = (metric: string) =>
    observations.filter((event) => event.fields?.metric === metric).map((event) => event.fields?.value);
  const positiveMetricValues = (metric: string) =>
    metricValues(metric).filter((value) => typeof value === "number" && value > 0);

  assert.deepEqual(metricValues("sleep-total-minutes"), [420]);
  assert.deepEqual(positiveMetricValues("sleep-deep-minutes"), [60]);
  assert.deepEqual(positiveMetricValues("sleep-light-minutes"), [240]);
  assert.deepEqual(positiveMetricValues("sleep-awake-minutes"), [60]);
  assert.deepEqual(positiveMetricValues("sleep-rem-minutes"), []);
  assert.ok(
    observations
      .filter((event) => event.fields?.metric === "sleep-total-minutes")
      .every((event) => event.dataOrigin?.normalizerVersion === "junction-sleep-unspecified-total.v1"),
  );
});

test("Junction sleep_cycle numeric unknown stage does not create generic total for non-Apple sources", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "garmin-unknown-stage-cycle",
          sourceProviderSlug: "garmin",
          sourceType: "unknown",
          session_start: "2026-07-08T00:00:00+00:00",
          session_end: "2026-07-08T02:00:00+00:00",
          stage_start_offset_second: [0, 3600],
          stage_end_offset_second: [3600, 7200],
          stage_type: [-1, 4],
          time_zone: "UTC",
          created_at: "2026-07-08T12:00:00+00:00",
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metrics = observations.map((event) => event.fields?.metric);

  assert.equal(metrics.includes("sleep-total-minutes"), false);
  assert.equal(metrics.includes("sleep-deep-minutes"), false);
  assert.equal(metrics.includes("sleep-light-minutes"), false);
  assert.equal(metrics.includes("sleep-rem-minutes"), false);
});

test("Junction sleep_cycle string negative-one stage does not create stage facts for non-Apple sources", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "garmin-string-unknown-stage-cycle",
          sourceProviderSlug: "garmin",
          sourceType: "unknown",
          session_start: "2026-07-08T00:00:00+00:00",
          session_end: "2026-07-08T02:00:00+00:00",
          stage_start_offset_second: [0, 3600],
          stage_end_offset_second: [3600, 7200],
          stage_type: ["-1", "4"],
          time_zone: "UTC",
          created_at: "2026-07-08T12:00:00+00:00",
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metrics = observations.map((event) => event.fields?.metric);

  assert.equal(metrics.includes("sleep-total-minutes"), false);
  assert.equal(metrics.includes("sleep-deep-minutes"), false);
  assert.equal(metrics.includes("sleep-light-minutes"), false);
  assert.equal(metrics.includes("sleep-rem-minutes"), false);
});

test("Junction Apple sleep_cycle parentless generic asleep fragments stay raw-only", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          source_provider: "apple_health_kit",
          source_type: "unknown",
          time_zone: "UTC",
          data: [{
            start: "2026-07-08T00:00:00.000Z",
            end: "2026-07-08T01:00:00.000Z",
            stage_type: -1,
          }],
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );
  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const metrics = observations.map((event) => event.fields?.metric);

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(
    payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"),
    true,
  );
  assert.equal(metrics.includes("sleep-total-minutes"), false);
  assert.equal(metrics.includes("sleep-awake-minutes"), false);
  assert.equal(metrics.includes("sleep-light-minutes"), false);
  assert.equal(metrics.includes("sleep-deep-minutes"), false);
  assert.equal(metrics.includes("sleep-rem-minutes"), false);
});

test("Junction Apple sleep_cycle parented generic asleep envelope emits total", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-07-08T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "apple-healthkit-parented-generic-cycle",
          source_provider: "apple_health_kit",
          source_type: "unknown",
          start: "2026-07-08T00:00:00.000Z",
          end: "2026-07-08T01:00:00.000Z",
          time_zone: "UTC",
          data: [{
            start: "2026-07-08T00:00:00.000Z",
            end: "2026-07-08T01:00:00.000Z",
            stage_type: -1,
          }],
        }],
      },
    },
    { defaultTimeZone: "UTC" },
  );
  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];
  const totalObservations = observations.filter((event) => event.fields?.metric === "sleep-total-minutes");

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(totalObservations.length, 1);
  assert.equal(totalObservations[0]?.fields?.value, 60);
  assert.equal(totalObservations[0]?.dataOrigin?.sourceProviderSlug, "apple-health-kit");
  assert.equal(
    totalObservations[0]?.dataOrigin?.normalizerVersion,
    "junction-sleep-unspecified-total.v1",
  );
});

test("Junction sleep_cycle direct intervals use timezone for local sleep-stage day", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: {
        sleep_cycle: [
          {
            id: "sleep-cycle-parent-zone-1",
            source_provider: "whoop",
            source_type: "wearable",
            time_zone: "America/New_York",
            start: "2026-01-02T04:30:00.000Z",
            end: "2026-01-02T05:00:00.000Z",
            stages: [{
              start: "2026-01-02T04:30:00.000Z",
              end: "2026-01-02T05:00:00.000Z",
              stage: "light",
            }],
          },
          {
            id: "sleep-cycle-default-zone-1",
            source_provider: "garmin",
            source_type: "watch",
            start: "2026-01-02T04:30:00.000Z",
            end: "2026-01-02T05:00:00.000Z",
            stages: [{
              start: "2026-01-02T04:30:00.000Z",
              end: "2026-01-02T05:00:00.000Z",
              stage: "deep",
            }],
          },
        ],
      },
    },
    { defaultTimeZone: "America/New_York" },
  );
  const observations = (payload.events?.filter((event) =>
    event.kind === "observation" && Number(event.fields?.value ?? 0) > 0
  ) ?? []);

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((event) => event.fields?.metric), [
    "sleep-light-minutes",
    "sleep-deep-minutes",
  ]);
  assert.deepEqual(observations.map((event) => event.dayKey), ["2026-01-02", "2026-01-02"]);
  assert.equal(observations[0]?.timeZone, "America/New_York");
  assert.equal(observations[1]?.timeZone, "UTC");
});

test("Junction sleep_cycle sums sub-minute stage intervals before rounding", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-01-02T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-sub-minute-1",
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start: "2026-01-02T00:00:00.000Z",
        end: "2026-01-02T00:01:00.000Z",
        stages: [
          {
            start: "2026-01-02T00:00:00.000Z",
            end: "2026-01-02T00:00:30.000Z",
            stage: "light",
          },
          {
            start: "2026-01-02T00:00:30.000Z",
            end: "2026-01-02T00:01:00.000Z",
            stage: "light",
          },
        ],
      }],
    },
  });
  const observations = (payload.events?.filter((event) =>
    event.kind === "observation" && Number(event.fields?.value ?? 0) > 0
  ) ?? []);

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.fields?.metric, "sleep-light-minutes");
  assert.equal(observations[0]?.fields?.value, 1);
});

test("Junction sleep_cycle anchors one stage interval crossing local midnight to the sleep window", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-stage-split-midnight");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-02T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const snapshot = {
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-single-cross-midnight-1",
          source_provider: "garmin",
          source_type: "watch",
          time_zone: "America/New_York",
          start: "2026-01-02T04:30:00.000Z",
          end: "2026-01-02T05:30:00.000Z",
          stages: [{
            start: "2026-01-02T04:30:00.000Z",
            end: "2026-01-02T05:30:00.000Z",
            stage: "light",
          }],
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = (payload.events ?? [])
      .filter((event) => event.kind === "observation" && event.fields?.metric === "sleep-light-minutes")
      .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 1);
    assert.deepEqual(
      observations.map((event) => [event.dayKey, event.fields?.value]),
      [
        ["2026-01-02", 60],
      ],
    );

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
    const importedLightEvents = result.events
      .filter((event) => event.kind === "observation" && event.metric === "sleep-light-minutes")
      .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));

    assert.equal(result.samples.length, 0);
    assert.equal(importedLightEvents.length, 1);
    assert.deepEqual(importedLightEvents.map((event) => event.dayKey), ["2026-01-02"]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle uses stable UTC day when nullable offset is absent", () => {
  const payload = normalizeJunctionSnapshot(
    {
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-null-offset-midnight-1",
          source_provider: "garmin",
          source_type: "watch",
          timezone_offset: null,
          start: "2026-01-02T04:30:00.000Z",
          end: "2026-01-02T05:30:00.000Z",
          stages: [{
            start: "2026-01-02T04:30:00.000Z",
            end: "2026-01-02T05:30:00.000Z",
            stage: "light",
          }],
        }],
      },
    },
    { defaultTimeZone: "America/New_York" },
  );
  const observations = (payload.events ?? [])
    .filter((event) => event.kind === "observation" && event.fields?.metric === "sleep-light-minutes")
    .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 1);
  assert.deepEqual(
    observations.map((event) => [event.dayKey, event.fields?.value]),
    [
      ["2026-01-02", 60],
    ],
  );
});

test("Junction sleep_cycle identity ignores mutable vault default timezone without provider zone", () => {
  const snapshot = {
    importedAt: "2026-01-02T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-null-offset-replay-1",
        source_provider: "garmin",
        source_type: "watch",
        timezone_offset: null,
        start: "2026-01-02T04:30:00.000Z",
        end: "2026-01-02T05:30:00.000Z",
        stages: [{
          start: "2026-01-02T04:30:00.000Z",
          end: "2026-01-02T05:30:00.000Z",
          stage: "light",
        }],
      }],
    },
  };
  const newYorkPayload = normalizeJunctionSnapshot(snapshot, { defaultTimeZone: "America/New_York" });
  const utcPayload = normalizeJunctionSnapshot(snapshot, { defaultTimeZone: "UTC" });
  const newYorkObservation = newYorkPayload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );
  const utcObservation = utcPayload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );

  assert.equal(newYorkObservation?.dayKey, "2026-01-02");
  assert.equal(utcObservation?.dayKey, "2026-01-02");
  assert.equal(newYorkObservation?.externalRef?.resourceId, utcObservation?.externalRef?.resourceId);
  assert.equal(newYorkObservation?.fields?.value, 60);
  assert.equal(utcObservation?.fields?.value, 60);
});

test("Junction sleep_cycle keeps same-stage day aggregates distinct across timezones", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-stage-midnight");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-02T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const snapshot = {
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cross-midnight-1",
          source_provider: "garmin",
          source_type: "watch",
          time_zone: "America/New_York",
          start: "2026-01-02T04:30:00.000Z",
          end: "2026-01-02T05:40:00.000Z",
          stages: [
            {
              start: "2026-01-02T04:30:00.000Z",
              end: "2026-01-02T04:50:00.000Z",
              stage: "light",
            },
            {
              start: "2026-01-02T04:50:00.000Z",
              end: "2026-01-02T05:10:00.000Z",
              stage: "awake",
            },
            {
              start: "2026-01-02T05:10:00.000Z",
              end: "2026-01-02T05:40:00.000Z",
              stage: "light",
            },
          ],
        }, {
          id: "sleep-cross-midnight-utc-1",
          source_provider: "garmin",
          source_type: "watch",
          time_zone: "UTC",
          start: "2026-01-01T23:30:00.000Z",
          end: "2026-01-02T00:40:00.000Z",
          stages: [
            {
              start: "2026-01-01T23:30:00.000Z",
              end: "2026-01-01T23:50:00.000Z",
              stage: "light",
            },
            {
              start: "2026-01-01T23:50:00.000Z",
              end: "2026-01-02T00:10:00.000Z",
              stage: "awake",
            },
            {
              start: "2026-01-02T00:10:00.000Z",
              end: "2026-01-02T00:40:00.000Z",
              stage: "light",
            },
          ],
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = (payload.events ?? [])
      .filter((event) => event.kind === "observation" && event.fields?.metric === "sleep-light-minutes")
      .sort((left, right) =>
        `${left.timeZone}:${left.dayKey}`.localeCompare(`${right.timeZone}:${right.dayKey}`)
      );

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 2);
    assert.deepEqual(
      observations.map((event) => [event.timeZone, event.dayKey, event.fields?.value]),
      [
        ["America/New_York", "2026-01-02", 50],
        ["UTC", "2026-01-02", 50],
      ],
    );
    assert.equal(new Set(observations.map((event) => event.externalRef?.resourceId)).size, 2);

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
    const importedLightEvents = result.events
      .filter((event) => event.kind === "observation" && event.metric === "sleep-light-minutes")
      .sort((left, right) =>
        `${left.timeZone}:${left.dayKey}`.localeCompare(`${right.timeZone}:${right.dayKey}`)
      );
    const records = (
      await Promise.all(
        result.eventShardPaths.map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const liveLightRecords = latestLiveRecords(records)
      .filter((record) => record.kind === "observation" && record.metric === "sleep-light-minutes")
      .sort((left, right) =>
        `${left.timeZone}:${left.dayKey}`.localeCompare(`${right.timeZone}:${right.dayKey}`)
      );

    assert.equal(importedLightEvents.length, 2);
    assert.deepEqual(
      importedLightEvents.map((event) => [event.timeZone, event.dayKey]),
      [
        ["America/New_York", "2026-01-02"],
        ["UTC", "2026-01-02"],
      ],
    );
    assert.equal(new Set(importedLightEvents.map((event) => event.id)).size, 2);
    assert.equal(liveLightRecords.length, 2);
    assert.deepEqual(
      liveLightRecords.map((record) => [record.timeZone, record.dayKey]),
      [
        ["America/New_York", "2026-01-02"],
        ["UTC", "2026-01-02"],
      ],
    );
    assert.equal(new Set(liveLightRecords.map((record) => record.id)).size, 2);
    assert.equal(new Set(liveLightRecords.map((record) => storedExternalRefResourceId(record))).size, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction hypnogram alias without parent identity stays raw-only", async () => {
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

  const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(observations.length, 0);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(Object.hasOwn(payload, "canonicalWearableRecords"), false);
});

test("Junction sleep_cycle compacts large stage timelines before core import", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-compact");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const stageValues = ["light", "rem", "deep", "awake"] as const;
    const stageStart = Date.parse("2026-05-20T00:00:00.000Z");
    const stages = Array.from({ length: 1004 }, (_, index) => {
      const start = new Date(stageStart + index * 60_000).toISOString();
      const end = new Date(stageStart + (index + 1) * 60_000).toISOString();
      return {
        start,
        end,
        stage: stageValues[index % stageValues.length],
      };
    });
    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-dense-stage-1",
          source_provider: "garmin",
          source_type: "watch",
          time_zone: "UTC",
          start: "2026-05-20T00:00:00.000Z",
          end: new Date(stageStart + stages.length * 60_000).toISOString(),
          stages,
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 4);
    assert.deepEqual(observations.map((event) => event.fields?.value), [251, 251, 251, 251]);

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

    assert.equal(result.samples.length, 0);
    assert.equal(result.events.length, 4);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle top-level stage interval arrays without parent identity stay raw-only", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-top-level-raw");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const stageValues = ["light", "rem", "deep", "awake"] as const;
    const stageStart = Date.parse("2026-05-20T00:00:00.000Z");
    const stages = Array.from({ length: 1004 }, (_, index) => {
      const start = new Date(stageStart + index * 60_000).toISOString();
      const end = new Date(stageStart + (index + 1) * 60_000).toISOString();
      return {
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start,
        end,
        stage: stageValues[index % stageValues.length],
      };
    });
    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        sleep_cycle: stages,
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(payload.events?.length ?? 0, 0);
    assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

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

    assert.equal(result.samples.length, 0);
    assert.equal(result.events.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle direct webhook envelopes collect nested stages once", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-direct-envelope");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-webhook-1",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          time_zone: "UTC",
          data: [{
            id: "sleep-cycle-1",
            stages: [{
              startAt: "2026-05-20T00:00:00.000Z",
              endAt: "2026-05-20T00:45:00.000Z",
              stage: "deep",
            }],
          }],
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 0);
    assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...firstImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    assert.equal(firstImport.events.length, 0);
    assert.equal(replayImport.events.length, 0);
    assert.equal(latestLiveRecords(records).length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction hypnogram data without parent identity stays raw-only before core import", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-hypnogram-compact");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const stageValues = ["light", "rem", "deep", "awake"] as const;
    const stageStart = Date.parse("2026-05-20T00:00:00.000Z");
    const stages = Array.from({ length: 1004 }, (_, index) => {
      const start = new Date(stageStart + index * 60_000).toISOString();
      const end = new Date(stageStart + (index + 1) * 60_000).toISOString();
      return {
        start,
        end,
        stage: stageValues[index % stageValues.length],
      };
    });
    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        hypnogram: {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          time_zone: "UTC",
          data: stages,
        },
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = payload.events?.filter((event) => event.kind === "observation") ?? [];

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 0);
    assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

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

    assert.equal(result.samples.length, 0);
    assert.equal(result.events.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction hypnogram data without parent timestamps stays raw-only across replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-hypnogram-replay-identity");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const snapshot = (
      importedAt: string,
      data: Array<{ start: string; end: string; stage: string }>,
    ) => ({
      importedAt,
      summaries: {
        hypnogram: {
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          time_zone: "UTC",
          data,
        },
      },
    });
    const lightInterval = {
      start: "2026-05-20T00:00:00.000Z",
      end: "2026-05-20T00:20:00.000Z",
      stage: "light",
    };
    const remInterval = {
      start: "2026-05-20T00:20:00.000Z",
      end: "2026-05-20T00:30:00.000Z",
      stage: "rem",
    };
    const firstPayload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot: snapshot("2026-05-20T18:00:00.000Z", [lightInterval]),
    });
    const replayPayload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot: snapshot("2026-05-21T18:00:00.000Z", [lightInterval, remInterval]),
    });

    assert.equal(firstPayload.samples?.length ?? 0, 0);
    assert.equal(replayPayload.samples?.length ?? 0, 0);
    assert.equal(firstPayload.events?.length ?? 0, 0);
    assert.equal(replayPayload.events?.length ?? 0, 0);
    assert.ok(firstPayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
    assert.ok(replayPayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshot("2026-05-20T18:00:00.000Z", [lightInterval]),
      },
      {
        corePort: coreRuntime,
      },
    );
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshot("2026-05-21T18:00:00.000Z", [lightInterval, remInterval]),
      },
      {
        corePort: coreRuntime,
      },
    );

    assert.equal(firstImport.samples.length, 0);
    assert.equal(replayImport.samples.length, 0);
    assert.equal(firstImport.events.length, 0);
    assert.equal(replayImport.events.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle data envelopes without parent ids stay raw-only", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-bound-identity");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        sleep_cycle: [
          {
            source_provider: "garmin",
            source_type: "watch",
            time_zone: "UTC",
            data: [{
              start: "2026-05-20T00:00:00.000Z",
              end: "2026-05-20T00:30:00.000Z",
              stage: "light",
            }],
          },
          {
            source_provider: "garmin",
            source_type: "watch",
            time_zone: "UTC",
            data: [{
              start: "2026-05-20T01:00:00.000Z",
              end: "2026-05-20T01:30:00.000Z",
              stage: "light",
            }],
          },
        ],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const observations = (payload.events ?? [])
      .filter((event) => event.kind === "observation" && event.fields?.metric === "sleep-light-minutes")
      .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(observations.length, 0);
    assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

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

    assert.equal(result.samples.length, 0);
    assert.equal(result.events.filter((event) =>
      event.kind === "observation" && event.metric === "sleep-light-minutes"
    ).length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle parentless full and partial replays do not mint canonical stage facts", async () => {
  const intervalA = {
    start: "2026-05-20T00:00:00.000Z",
    end: "2026-05-20T00:30:00.000Z",
    stage: "light",
  };
  const intervalB = {
    start: "2026-05-20T01:00:00.000Z",
    end: "2026-05-20T01:30:00.000Z",
    stage: "light",
  };
  const scenarios = [
    { label: "partials before full", batches: [[intervalA], [intervalB], [intervalA, intervalB]] },
    { label: "full before partial", batches: [[intervalA, intervalB], [intervalA]] },
  ];

  for (const scenario of scenarios) {
    const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-overlap");
    try {
      await coreRuntime.initializeVault({
        vaultRoot,
        createdAt: "2026-05-20T00:00:00.000Z",
        timezone: "UTC",
      });

      const imports = [];
      for (const [index, data] of scenario.batches.entries()) {
        imports.push(await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
          {
            provider: "junction",
            vaultRoot,
            snapshot: {
              importedAt: new Date(Date.parse("2026-05-20T18:00:00.000Z") + index * 60_000).toISOString(),
              summaries: {
                sleep_cycle: [{
                  source_provider: "garmin",
                  source_type: "watch",
                  time_zone: "UTC",
                  data,
                }],
              },
            },
          },
          {
            corePort: coreRuntime,
          },
        ));
      }

      assert.ok(imports.every((result) => result.samples.length === 0), scenario.label);
      assert.ok(imports.every((result) => result.events.length === 0), scenario.label);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  }
});

test("Junction sleep_cycle parented partial replays cannot overwrite complete compact facts", async () => {
  const intervalA = {
    start: "2026-05-20T00:00:00.000Z",
    end: "2026-05-20T00:30:00.000Z",
    stage: "light",
  };
  const intervalB = {
    start: "2026-05-20T00:30:00.000Z",
    end: "2026-05-20T01:00:00.000Z",
    stage: "light",
  };
  const snapshot = (
    importedAt: string,
    stages: Array<{ start: string; end: string; stage: string }>,
  ) => ({
    importedAt,
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-parented-overlap-1",
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T01:00:00.000Z",
        stages,
      }],
    },
  });
  const scenarios = [
    {
      label: "full before partial retry",
      batches: [[intervalA, intervalB], [intervalA]],
    },
    {
      label: "partial before full before partial retry",
      batches: [[intervalA], [intervalA, intervalB], [intervalA]],
    },
  ];

  for (const scenario of scenarios) {
    const vaultRoot = await makeTempDirectory("murph-junction-parented-sleep-cycle-overlap");
    try {
      await coreRuntime.initializeVault({
        vaultRoot,
        createdAt: "2026-05-20T00:00:00.000Z",
        timezone: "UTC",
      });

      const imports = [];
      for (const [index, stages] of scenario.batches.entries()) {
        imports.push(await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
          {
            provider: "junction",
            vaultRoot,
            snapshot: snapshot(
              new Date(Date.parse("2026-05-20T18:00:00.000Z") + index * 60_000).toISOString(),
              stages,
            ),
          },
          {
            corePort: coreRuntime,
          },
        ));
      }

      assert.deepEqual(
        imports.map((result) => result.events.filter((event) =>
          event.kind === "observation" && event.metric === "sleep-light-minutes"
        ).length),
        scenario.batches.map((stages) => stages.length === 2 ? 1 : 0),
        scenario.label,
      );

      const records = (
        await Promise.all(
          [...new Set(imports.flatMap((result) => result.eventShardPaths))]
            .map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
        )
      ).flat();
      const liveLightRecords = latestLiveRecords(records).filter(
        (record) => record.kind === "observation" && record.metric === "sleep-light-minutes",
      );

      assert.equal(liveLightRecords.length, 1, scenario.label);
      assert.equal(storedObservationValue(liveLightRecords[0]), 60, scenario.label);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  }
});

test("Junction sleep_cycle parented rescores zero disappeared stage facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-parented-sleep-cycle-rescore");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const snapshot = (
      importedAt: string,
      stages: Array<{ start: string; end: string; stage: string }>,
    ) => ({
      importedAt,
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-parented-rescore-1",
          source_provider: "garmin",
          source_type: "watch",
          time_zone: "UTC",
          start: "2026-05-20T00:00:00.000Z",
          end: "2026-05-20T01:00:00.000Z",
          stages,
        }],
      },
    });
    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshot("2026-05-20T18:00:00.000Z", [
          {
            start: "2026-05-20T00:00:00.000Z",
            end: "2026-05-20T00:30:00.000Z",
            stage: "light",
          },
          {
            start: "2026-05-20T00:30:00.000Z",
            end: "2026-05-20T01:00:00.000Z",
            stage: "rem",
          },
        ]),
      },
      {
        corePort: coreRuntime,
      },
    );
    const rescoreImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshot("2026-05-20T18:01:00.000Z", [
          {
            start: "2026-05-20T00:00:00.000Z",
            end: "2026-05-20T01:00:00.000Z",
            stage: "light",
          },
        ]),
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...firstImport.eventShardPaths, ...rescoreImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveObservations = latestLiveRecords(records).filter((record) => record.kind === "observation");
    const liveLight = liveObservations.find((record) => record.metric === "sleep-light-minutes");
    const liveRem = liveObservations.find((record) => record.metric === "sleep-rem-minutes");

    assert.equal(storedObservationValue(liveLight), 60);
    assert.equal(storedObservationValue(liveRem), 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep summary supersedes prior sleep_cycle fallback stage facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-summary-cycle-owner");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const sleepCycleEntry = {
      id: "sleep-cycle-summary-owner-1",
      source_provider: "garmin",
      source_type: "watch",
      time_zone: "UTC",
      start: "2026-05-20T00:00:00.000Z",
      end: "2026-05-20T01:00:00.000Z",
      stages: [{
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T01:00:00.000Z",
        stage: "deep",
      }],
    };
    const cycleOnlyImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:00:00.000Z",
          summaries: {
            sleep_cycle: [sleepCycleEntry],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const summaryOwnedImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:01:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-owner-1",
              source_provider: "garmin",
              source_type: "watch",
              bedtime_start: "2026-05-20T00:00:00.000Z",
              bedtime_stop: "2026-05-20T01:00:00.000Z",
              deep: 3600,
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...cycleOnlyImport.eventShardPaths, ...summaryOwnedImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );
    const summaryDeep = liveDeepRecords.find((record) =>
      storedExternalRefResourceType(record) === "junction-garmin-sleep"
    );

    assert.equal(liveDeepRecords.length, 1);
    assert.equal(storedObservationValue(summaryDeep), 60);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle fallback cannot overwrite prior sleep summary stage facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-cycle-cannot-clobber-summary");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const summaryImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:00:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-priority-owner-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "UTC",
              bedtime_start: "2026-05-20T00:00:00.000Z",
              bedtime_stop: "2026-05-20T01:30:00.000Z",
              deep: 5400,
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const cycleImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:01:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-priority-owner-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "UTC",
              start: "2026-05-20T00:00:00.000Z",
              end: "2026-05-20T01:30:00.000Z",
              stages: [
                {
                  start: "2026-05-20T00:00:00.000Z",
                  end: "2026-05-20T01:15:00.000Z",
                  stage: "deep",
                },
                {
                  start: "2026-05-20T01:15:00.000Z",
                  end: "2026-05-20T01:30:00.000Z",
                  stage: "light",
                },
              ],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...summaryImport.eventShardPaths, ...cycleImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );
    const returnedDeep = cycleImport.events.find((event) =>
      event.kind === "observation" && event.metric === "sleep-deep-minutes"
    );

    assert.equal(liveDeepRecords.length, 1);
    assert.equal(storedObservationValue(liveDeepRecords[0]), 90);
    assert.equal(returnedDeep, undefined);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep summary supersedes cross-midnight sleep_cycle fallback stage facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-summary-cross-midnight-owner");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-02T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const cycleImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-01-02T12:00:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-summary-cross-midnight-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "America/New_York",
              start: "2026-01-02T04:30:00.000Z",
              end: "2026-01-02T05:30:00.000Z",
              stages: [{
                start: "2026-01-02T04:30:00.000Z",
                end: "2026-01-02T05:30:00.000Z",
                stage: "light",
              }],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const summaryImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-01-02T12:01:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-cross-midnight-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "America/New_York",
              bedtime_start: "2026-01-02T04:30:00.000Z",
              bedtime_stop: "2026-01-02T05:30:00.000Z",
              light: 3600,
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...cycleImport.eventShardPaths, ...summaryImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveLightRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-light-minutes",
    );

    assert.equal(liveLightRecords.length, 1);
    assert.equal(liveLightRecords[0]?.dayKey, "2026-01-02");
    assert.equal(storedObservationValue(liveLightRecords[0]), 60);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep stage identity ignores timezone representation drift for the same window", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-stage-timezone-representation");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-02T00:00:00.000Z",
      timezone: "UTC",
    });

    const summaryImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-01-02T12:00:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-timezone-drift-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "America/New_York",
              bedtime_start: "2026-01-02T04:30:00.000Z",
              bedtime_stop: "2026-01-02T06:00:00.000Z",
              deep: 5400,
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const cycleImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-01-02T12:01:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-timezone-drift-1",
              source_provider: "garmin",
              source_type: "watch",
              start: "2026-01-02T04:30:00.000Z",
              end: "2026-01-02T06:00:00.000Z",
              stages: [
                {
                  start: "2026-01-02T04:30:00.000Z",
                  end: "2026-01-02T05:45:00.000Z",
                  stage: "deep",
                },
                {
                  start: "2026-01-02T05:45:00.000Z",
                  end: "2026-01-02T06:00:00.000Z",
                  stage: "light",
                },
              ],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...summaryImport.eventShardPaths, ...cycleImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );
    const summaryDeep = summaryImport.events.find((event) =>
      event.kind === "observation" && event.metric === "sleep-deep-minutes"
    );
    const returnedDeep = cycleImport.events.find((event) =>
      event.kind === "observation" && event.metric === "sleep-deep-minutes"
    );

    assert.equal(liveDeepRecords.length, 1);
    assert.equal(storedObservationValue(liveDeepRecords[0]), 90);
    assert.equal(storedExternalRefResourceId(liveDeepRecords[0]), summaryDeep?.externalRef?.resourceId);
    assert.equal(returnedDeep, undefined);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle and hypnogram aliases collapse same-window stage facts deterministically", async () => {
  const sleepCycleEntry = {
    id: "sleep-cycle-alias-window-1",
    source_provider: "garmin",
    source_type: "watch",
    time_zone: "America/New_York",
    start: "2026-01-02T04:30:00.000Z",
    end: "2026-01-02T05:30:00.000Z",
    stages: [{
      start: "2026-01-02T04:30:00.000Z",
      end: "2026-01-02T05:30:00.000Z",
      stage: "light",
    }],
  };
  const hypnogramEntry = {
    id: "hypnogram-alias-window-1",
    source_provider: "garmin",
    source_type: "watch",
    start: "2026-01-02T04:30:00.000Z",
    end: "2026-01-02T05:30:00.000Z",
    stages: [{
      start: "2026-01-02T04:30:00.000Z",
      end: "2026-01-02T05:30:00.000Z",
      stage: "light",
    }],
  };
  const buildSnapshot = (aliasFirst: boolean) => ({
    importedAt: "2026-01-02T12:00:00.000Z",
    summaries: aliasFirst
      ? {
        hypnogram: [hypnogramEntry],
        sleep_cycle: [sleepCycleEntry],
      }
      : {
        sleep_cycle: [sleepCycleEntry],
        hypnogram: [hypnogramEntry],
      },
  });

  const payloads = [
    normalizeJunctionSnapshot(buildSnapshot(false), { defaultTimeZone: "UTC" }),
    normalizeJunctionSnapshot(buildSnapshot(true), { defaultTimeZone: "UTC" }),
  ];

  for (const payload of payloads) {
    const observations = (payload.events ?? []).filter((event) => event.kind === "observation");
    const lightRecords = observations.filter((event) => event.fields?.metric === "sleep-light-minutes");

    assert.equal(lightRecords.length, 1);
    assert.equal(lightRecords[0]?.timeZone, "America/New_York");
    assert.equal(lightRecords[0]?.fields?.value, 60);
    assert.equal(observations.length, 4);
  }

  const firstLight = payloads[0]?.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );
  const secondLight = payloads[1]?.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );

  assert.equal(firstLight?.externalRef?.resourceId, secondLight?.externalRef?.resourceId);
  assert.equal(firstLight?.timeZone, secondLight?.timeZone);
  assert.equal(firstLight?.dayKey, secondLight?.dayKey);
});

test("Junction sleep summary does not suppress sleep_cycle facts for a different coverage window", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-summary-window-mismatch");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const sleepCycleEntry = {
      id: "sleep-cycle-window-mismatch-1",
      source_provider: "garmin",
      source_type: "watch",
      time_zone: "UTC",
      start: "2026-05-20T00:00:00.000Z",
      end: "2026-05-20T07:00:00.000Z",
      stages: [{
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T07:00:00.000Z",
        stage: "deep",
      }],
    };
    const cycleOnlyImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:00:00.000Z",
          summaries: {
            sleep_cycle: [sleepCycleEntry],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const mixedWindowImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:01:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-window-mismatch-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "UTC",
              bedtime_start: "2026-05-19T23:50:00.000Z",
              bedtime_stop: "2026-05-20T07:10:00.000Z",
              deep: 26400,
            }],
            sleep_cycle: [sleepCycleEntry],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...cycleOnlyImport.eventShardPaths, ...mixedWindowImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );

    assert.equal(liveDeepRecords.length, 2);
    assert.equal(new Set(liveDeepRecords.map((record) => storedExternalRefResourceId(record))).size, 2);
    assert.deepEqual(liveDeepRecords.map((record) => storedObservationValue(record)).sort(), [420, 440]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep summary only owns sleep_cycle facts with exact source and window identity", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-summary-exact-owner");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-07-01T00:00:00.000Z",
      timezone: "UTC",
    });

    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-07-01T18:00:00.000Z",
          summaries: {
            sleep: [
              {
                date: "2026-07-01",
                deep: 3600,
                id: "sleep-summary-day-only-1",
                source_provider: "garmin",
                source_type: "watch",
              },
              {
                bedtime_start: "2026-07-01T04:00:00.000Z",
                bedtime_stop: "2026-07-01T05:00:00.000Z",
                deep: 3600,
                id: "sleep-summary-under-sourced-1",
                source_provider: "garmin",
                source_type: "watch",
              },
            ],
            sleep_cycle: [
              {
                end: "2026-07-01T02:30:00.000Z",
                id: "sleep-cycle-day-only-summary-peer-1",
                source_provider: "garmin",
                source_type: "watch",
                stages: [{
                  end: "2026-07-01T02:30:00.000Z",
                  stage: "deep",
                  start: "2026-07-01T02:00:00.000Z",
                }],
                start: "2026-07-01T02:00:00.000Z",
              },
              {
                end: "2026-07-01T05:00:00.000Z",
                id: "sleep-cycle-sourced-peer-1",
                source_device_id: "garmin-watch-1",
                source_provider: "garmin",
                source_type: "watch",
                stages: [{
                  end: "2026-07-01T05:00:00.000Z",
                  stage: "deep",
                  start: "2026-07-01T04:00:00.000Z",
                }],
                start: "2026-07-01T04:00:00.000Z",
              },
            ],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        result.eventShardPaths.map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );

    assert.equal(liveDeepRecords.length, 4);
    assert.equal(new Set(liveDeepRecords.map((record) => storedExternalRefResourceId(record))).size, 4);
    assert.deepEqual(liveDeepRecords.map((record) => storedObservationValue(record)).sort(), [30, 60, 60, 60]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep summary stage aliases supersede pre-canonical summary facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-summary-stage-alias");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const snapshot = {
      importedAt: "2026-05-20T18:00:00.000Z",
      summaries: {
        sleep: [{
          id: "sleep-summary-stage-alias-1",
          source_provider: "garmin",
          source_type: "watch",
          bedtime_start: "2026-05-20T00:00:00.000Z",
          bedtime_stop: "2026-05-20T01:00:00.000Z",
          deep: 3600,
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const deepEvent = (payload.events ?? []).find((event) =>
      event.kind === "observation" && event.fields?.metric === "sleep-deep-minutes"
    );
    assert.ok(deepEvent);
    assert.equal(deepEvent.externalRef?.resourceType, "junction-garmin-sleep");
    assert.equal(deepEvent.legacyExternalRefs?.[0]?.resourceType, "junction-garmin-sleep");
    const legacyExternalRef = deepEvent.legacyExternalRefs?.[0];
    assert.ok(legacyExternalRef);

    const legacyImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: payload.provider,
      accountId: payload.accountId,
      importedAt: payload.importedAt,
      events: [{
        ...deepEvent,
        externalRef: legacyExternalRef,
        legacyExternalRefs: undefined,
      }],
      evidenceParts: (payload.evidenceParts ?? []).map((part) => ({
        role: part.role,
        fileName: part.fileName,
        mediaType: part.mediaType,
        content: part.content,
      })),
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...legacyImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );
    const replayDeepEvent = replayImport.events.find((event) =>
      event.kind === "observation" && event.metric === "sleep-deep-minutes"
    );

    assert.equal(replayDeepEvent?.id, legacyImport.events[0]?.id);
    assert.equal(liveDeepRecords.length, 1);
    assert.equal(storedExternalRefResourceType(liveDeepRecords[0]), "junction-garmin-sleep");
    assert.equal(storedObservationValue(liveDeepRecords[0]), 60);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep summary and sleep_cycle share UTC fallback stage identity", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-stage-utc-fallback");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const cycleImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:00:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-utc-fallback-1",
              source_provider: "garmin",
              source_type: "watch",
              start: "2026-05-20T00:00:00.000Z",
              end: "2026-05-20T01:00:00.000Z",
              stages: [{
                start: "2026-05-20T00:00:00.000Z",
                end: "2026-05-20T01:00:00.000Z",
                stage: "deep",
              }],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const summaryImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:01:00.000Z",
          summaries: {
            sleep: [{
              id: "sleep-summary-utc-fallback-1",
              source_provider: "garmin",
              source_type: "watch",
              bedtime_start: "2026-05-20T00:00:00.000Z",
              bedtime_stop: "2026-05-20T01:00:00.000Z",
              deep: 3600,
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...cycleImport.eventShardPaths, ...summaryImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveDeepRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-deep-minutes",
    );

    assert.equal(liveDeepRecords.length, 1);
    assert.equal(storedExternalRefResourceType(liveDeepRecords[0]), "junction-garmin-sleep");
    assert.equal(storedObservationValue(liveDeepRecords[0]), 60);
    assert.equal(liveDeepRecords[0]?.timeZone, "UTC");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep_cycle clips parent-window intervals and rejects overlapping coverage", () => {
  const clippedPayload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-clipped-window-1",
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T01:00:00.000Z",
        stages: [{
          start: "2026-05-19T23:50:00.000Z",
          end: "2026-05-20T01:00:00.000Z",
          stage: "light",
        }],
      }],
    },
  });
  const clippedLight = clippedPayload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );

  assert.equal(clippedPayload.samples?.length ?? 0, 0);
  assert.equal(clippedLight?.fields?.value, 60);

  const overlappingPayload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-overlapping-window-1",
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T01:00:00.000Z",
        stages: [
          {
            start: "2026-05-20T00:00:00.000Z",
            end: "2026-05-20T00:40:00.000Z",
            stage: "light",
          },
          {
            start: "2026-05-20T00:30:00.000Z",
            end: "2026-05-20T01:00:00.000Z",
            stage: "rem",
          },
        ],
      }],
    },
  });

  assert.equal(overlappingPayload.samples?.length ?? 0, 0);
  assert.equal(overlappingPayload.events?.length ?? 0, 0);
  assert.ok(overlappingPayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));

  const fullThenOverlappingPayload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep_cycle: [{
        id: "sleep-cycle-full-then-overlapping-window-1",
        source_provider: "garmin",
        source_type: "watch",
        time_zone: "UTC",
        start: "2026-05-20T00:00:00.000Z",
        end: "2026-05-20T01:00:00.000Z",
        stages: [
          {
            start: "2026-05-20T00:00:00.000Z",
            end: "2026-05-20T01:00:00.000Z",
            stage: "light",
          },
          {
            start: "2026-05-20T00:30:00.000Z",
            end: "2026-05-20T00:45:00.000Z",
            stage: "deep",
          },
        ],
      }],
    },
  });

  assert.equal(fullThenOverlappingPayload.samples?.length ?? 0, 0);
  assert.equal(fullThenOverlappingPayload.events?.length ?? 0, 0);
  assert.ok(fullThenOverlappingPayload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
});

test("Junction sleep_cycle no-window direct fragments cannot overwrite complete facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-direct-sleep-cycle-fragment");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });

    const completeImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:00:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-direct-fragment-1",
              source_provider: "garmin",
              source_type: "watch",
              time_zone: "UTC",
              start: "2026-05-20T00:00:00.000Z",
              end: "2026-05-20T01:00:00.000Z",
              stages: [{
                start: "2026-05-20T00:00:00.000Z",
                end: "2026-05-20T01:00:00.000Z",
                stage: "light",
              }],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const directFragmentImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          importedAt: "2026-05-20T18:01:00.000Z",
          summaries: {
            sleep_cycle: [{
              id: "sleep-cycle-direct-fragment-1",
              sourceProviderSlug: "garmin",
              sourceType: "watch",
              time_zone: "UTC",
              data: [{
                id: "sleep-cycle-direct-fragment-1",
                stages: [{
                  startAt: "2026-05-20T00:00:00.000Z",
                  endAt: "2026-05-20T00:30:00.000Z",
                  stage: "light",
                }],
              }],
            }],
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const records = (
      await Promise.all(
        [...new Set([...completeImport.eventShardPaths, ...directFragmentImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveLightRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "sleep-light-minutes",
    );

    assert.equal(directFragmentImport.events.length, 0);
    assert.equal(liveLightRecords.length, 1);
    assert.equal(storedObservationValue(liveLightRecords[0]), 60);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction sleep-stage observations keep stable replay identity with parent offset metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sleep-stage-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const snapshot = {
      accountId: "junction-account-hash-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      summaries: {
        sleep_cycle: [{
          id: "sleep-cycle-parent-offset-1",
          source: {
            provider: "whoop",
            type: "wearable",
          },
          start: "2026-06-25T02:30:00.000Z",
          end: "2026-06-25T03:00:00.000Z",
          timezone_offset: "-04:00",
          stages: [{
            start: "2026-06-25T02:30:00.000Z",
            end: "2026-06-25T03:00:00.000Z",
            stage: "light",
          }],
        }],
      },
    };
    const payload = await prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot,
      snapshot,
    });
    const event = (payload.events ?? []).find((entry) =>
      entry.kind === "observation" && entry.fields?.metric === "sleep-light-minutes"
    );

    assert.ok(event);
    assert.equal(event.kind, "observation");
    assert.equal(event.fields?.metric, "sleep-light-minutes");
    assert.equal(event.dayKey, "2026-06-24");
    assert.equal(event.timeZone, undefined);
    assert.equal(payload.samples?.length ?? 0, 0);
    const evidenceParts = (payload.evidenceParts ?? []).map((part) => ({
      role: part.role,
      fileName: part.fileName,
      mediaType: part.mediaType,
      content: part.content,
    }));

    const legacyImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: payload.provider,
      accountId: payload.accountId,
      importedAt: payload.importedAt,
      events: [{
        ...event,
        dayKey: "2026-06-25",
      }],
      evidenceParts,
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    );
    const [eventShardPath] = legacyImport.eventShardPaths;
    assert.ok(eventShardPath);
    const eventRecords = await coreRuntime.readJsonlRecords({
      vaultRoot,
      relativePath: eventShardPath,
    });

    const replayLightEvent = replayImport.events.find((entry) =>
      entry.kind === "observation" && entry.metric === "sleep-light-minutes"
    );
    const liveRecords = latestLiveRecords(eventRecords);
    const lightRecord = liveRecords.find((record) =>
      record.kind === "observation" && record.metric === "sleep-light-minutes"
    );

    assert.equal(replayLightEvent?.id, legacyImport.events[0]?.id);
    assert.equal(liveRecords.filter((record) => record.kind === "observation").length, 4);
    assert.equal(lightRecord?.dayKey, "2026-06-24");
    assert.equal(lightRecord?.timeZone, undefined);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
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
    payload.evidenceParts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
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

  const profileArtifact = payload.evidenceParts?.find((artifact) => artifact.role === "junction-summary-profile");
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
  assert.equal(sleepSessions[0]?.occurredAt, "2026-05-20T10:00:00.000Z");
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
        zone: 2,
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

  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-workouts"));
});

test("Junction normalizer maps numeric workout heart-rate zone buckets by array index", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      workouts: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "numeric-hr-zones-workout",
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          sport: {
            name: "Run",
          },
          hr_zones: [300, 600, 900, 120, 60, 30],
        },
      ],
    },
  });

  const workoutSessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  const workout = workoutSessionSchema.parse(workoutSessions[0]?.fields?.workout);

  assert.deepEqual(workout.heartRateZones, [
    { zone: 0, durationMinutes: 5 },
    { zone: 1, durationMinutes: 10 },
    { zone: 2, durationMinutes: 15 },
    { zone: 3, durationMinutes: 2 },
    { zone: 4, durationMinutes: 1 },
    { zone: 5, durationMinutes: 0.5 },
  ]);
});

test("Junction normalizer maps sparse numeric workout heart-rate zone buckets by array index", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      workouts: [
        {
          source: {
            provider: "garmin",
            type: "watch",
          },
          id: "sparse-numeric-hr-zones-workout",
          time_start: "2026-05-20T12:00:00+00:00",
          time_end: "2026-05-20T12:30:00+00:00",
          sport: {
            name: "Run",
          },
          hr_zones: [300, 600, null, 120, 0, 30],
        },
      ],
    },
  });

  const workoutSessions = payload.events?.filter((event) => event.kind === "activity_session") ?? [];
  const workout = workoutSessionSchema.parse(workoutSessions[0]?.fields?.workout);

  assert.deepEqual(workout.heartRateZones, [
    { zone: 0, durationMinutes: 5 },
    { zone: 1, durationMinutes: 10 },
    { zone: 3, durationMinutes: 2 },
    { zone: 4, durationMinutes: 0 },
    { zone: 5, durationMinutes: 0.5 },
  ]);
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
  const stageMetricNames = new Set([
    "sleep-awake-minutes",
    "sleep-light-minutes",
    "sleep-deep-minutes",
    "sleep-rem-minutes",
  ]);

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
  assert.ok(observations
    .filter((event) => typeof event.fields?.metric === "string" && stageMetricNames.has(event.fields.metric))
    .every((event) => event.externalRef?.resourceType === "junction-oura-sleep"));
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
        high: 5,
        low: 60,
        medium: 13,
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
  const activityMinutes = observations.find(
    (event) => event.fields?.metric === "activity-minutes",
  );
  const rawBodyArtifact = payload.evidenceParts?.find((artifact) => artifact.role === "junction-summary-body");

  assert.equal(activityMinutes?.fields?.value, 78);
  assert.equal(activityMinutes?.fields?.unit, "minutes");
  assert.equal(activityMinutes?.externalRef?.facet, "activity-minutes");
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

test("Junction normalizer rejects incomplete or invalid daily activity minute buckets", () => {
  const invalidBuckets = [
    {
      daily_movement: 600,
      duration_active_second: 600,
      low: 20,
      medium: 10,
    },
    { low: 20, medium: -1, high: 10 },
    { low: 20, medium: 10, high: "Infinity" },
    { low: 1440, medium: 1, high: 0 },
  ];
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      activity: invalidBuckets.map((buckets, index) => ({
        ...buckets,
        source: { provider: "garmin", type: "watch" },
        id: `invalid-intensity-buckets-${index}`,
        date: "2026-05-21T00:00:00+00:00",
      })),
    },
  });

  assert.equal(payload.events?.some((event) => event.fields?.metric === "activity-minutes"), false);
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

  const profileArtifact = payload.evidenceParts?.find((artifact) => artifact.role === "junction-summary-profile");
  assert.deepEqual(profileArtifact?.content, {
    sourceProviderSlug: "oura",
    sourceType: "cloud-provider",
  });
});
