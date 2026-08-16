import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_SCHEMA,
  ID_PREFIXES,
  JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET,
  JUNCTION_WEARABLE_TAG_NOTE_TYPE,
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
  JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES,
  JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY,
  JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_DAY,
  JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_IMPORT,
  classifyJunctionSummaryNormalizationEvidence,
  identifyJunctionBloodPressureProviderRecords,
  importDeviceProviderSnapshot,
  JunctionSparseCalendarRepairNormalizationError,
  normalizeJunctionSnapshot,
  prepareDeviceProviderSnapshotImport,
  resolveJunctionOrigin,
  type DeviceBatchImportPayload,
  type WearableRawIngestReceipt,
} from "../src/index.ts";
import { buildJunctionTemporalFeatures } from "../src/device-providers/junction-timeseries-features.ts";
import { assertJunctionTimeseriesOutputBounds } from "../src/device-providers/junction-timeseries-fidelity.ts";

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

interface JunctionMenstrualCycleEvidence {
  schema: "junction.menstrual_cycle_evidence.v1";
  cycleCount: number;
  factCount: number;
  omittedCycleCount: number;
  omittedFactCount: number;
  cycles: Array<Record<string, unknown>>;
  facts: Array<{
    cycleRecordHash: string;
    date: string;
    kind: string;
    value?: string | number | boolean;
  }>;
}

function readJunctionMenstrualCycleEvidence(
  payload: Pick<DeviceBatchImportPayload, "evidenceParts">,
): JunctionMenstrualCycleEvidence {
  const artifact = payload.evidenceParts?.find((candidate) =>
    candidate.role === "junction-summary-menstrual-cycle"
  );
  assert.ok(artifact);
  const evidence = artifact.content as JunctionMenstrualCycleEvidence;
  assert.equal(evidence.schema, "junction.menstrual_cycle_evidence.v1");
  return evidence;
}

async function readHostedSmokeActivityRow(source: "garmin" | "oura"): Promise<Record<string, unknown>> {
  const fixture = JSON.parse(await readFile(
    new URL("../../vault-usecases/fixtures/junction-wearables-hosted-smoke.sanitized.json", import.meta.url),
    "utf8",
  )) as {
    rawArtifacts: Array<{ relativePath: string; content: Array<Record<string, unknown>> }>;
  };
  const artifact = fixture.rawArtifacts.find((candidate) =>
    candidate.relativePath === `hosted-smoke/${source}/01-junction-summary-activity.json`
  );
  assert.ok(artifact?.content[0]);
  return artifact.content[0];
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

function storedExternalRefField(
  record: StoredJsonlRecord | undefined,
  field: "facet" | "version",
): string | undefined {
  const externalRef = record?.externalRef;
  if (!externalRef || typeof externalRef !== "object" || Array.isArray(externalRef)) {
    return undefined;
  }
  return typeof externalRef[field] === "string" ? externalRef[field] : undefined;
}

function storedDataOriginObservedAtRaw(record: StoredJsonlRecord | undefined): string | undefined {
  const dataOrigin = record?.dataOrigin;
  if (!dataOrigin || typeof dataOrigin !== "object" || Array.isArray(dataOrigin)) {
    return undefined;
  }
  return typeof dataOrigin.observedAtRaw === "string" ? dataOrigin.observedAtRaw : undefined;
}

function storedObservationValue(record: StoredJsonlRecord | undefined): unknown {
  if (!record || typeof record !== "object" || !("value" in record)) {
    return undefined;
  }

  return record.value;
}

function storedMeasurements(
  record: StoredJsonlRecord,
): Array<{ metric?: string; qualifiers?: Record<string, unknown> }> {
  if (!Array.isArray(record.measurements)) {
    return [];
  }

  return record.measurements.flatMap((measurement) => {
    if (!measurement || typeof measurement !== "object" || Array.isArray(measurement)) {
      return [];
    }

    return [{
      metric: "metric" in measurement && typeof measurement.metric === "string"
        ? measurement.metric
        : undefined,
      qualifiers: "qualifiers" in measurement
        && measurement.qualifiers !== null
        && typeof measurement.qualifiers === "object"
        && !Array.isArray(measurement.qualifiers)
        ? measurement.qualifiers
        : undefined,
    }];
  });
}

function storedSourceInstanceId(record: StoredJsonlRecord | undefined): string | undefined {
  const dataOrigin = record?.dataOrigin;
  if (!dataOrigin || typeof dataOrigin !== "object" || Array.isArray(dataOrigin)) {
    return undefined;
  }
  return typeof dataOrigin.sourceInstanceId === "string"
    ? dataOrigin.sourceInstanceId
    : undefined;
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

function allPermutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) {
    return [[...values]];
  }
  return values.flatMap((value, index) =>
    allPermutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) =>
      [value, ...rest]
    )
  );
}

function normalizeCompleteTemporalSourceDay<T extends Record<string, unknown>>(
  snapshot: T,
  dayKey: string,
  revisionAt = "2026-04-24T12:00:00.000Z",
  defaultTimeZone = "UTC",
): DeviceBatchImportPayload {
  const timeseries = snapshot.timeseries;
  const resources = timeseries && typeof timeseries === "object"
    ? Object.keys(timeseries)
    : ["blood_oxygen"];
  return normalizeJunctionSnapshot(snapshot, {
    completeSourceDay: {
      connectionId: "junction-test-connection",
      dayKey,
      resources,
      revisionAt,
      timeZone: defaultTimeZone,
    },
    defaultTimeZone,
  });
}

function findJunctionCompactTimeseriesArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-daily-${resourceSlug}:`));
}

function findJunctionTemporalFeatureArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) =>
      artifact.role.startsWith(`junction-timeseries-temporal-${resourceSlug}:`)
    );
}

function findJunctionTimeseriesFeatureArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-features-${resourceSlug}:`));
}

function findJunctionIntervalReadingArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-reading-${resourceSlug}:`));
}

interface JunctionTestMeasurement {
  metric?: unknown;
  qualifiers?: unknown;
  unit?: unknown;
  value?: unknown;
}

function readJunctionEventMeasurements(
  event: { fields?: Record<string, unknown> } | undefined,
): JunctionTestMeasurement[] {
  const measurements = event?.fields?.measurements;
  if (!Array.isArray(measurements)) return [];
  return measurements.flatMap((measurement) =>
    measurement && typeof measurement === "object" && !Array.isArray(measurement)
      ? [measurement as JunctionTestMeasurement]
      : []
  );
}

function assertNoFullJunctionTimeseriesArtifacts(payload: DeviceBatchImportPayload): void {
  assert.equal(
    (payload.evidenceParts ?? []).some((artifact) =>
      /^junction-timeseries-(?!daily-|features?-|temporal-|reading-(?:blood-pressure|note|weight|caffeine|water|mindfulness-minutes):)/u.test(
        artifact.role,
      )
    ),
    false,
  );
  assert.equal(
    (payload.evidenceParts ?? []).some((artifact) => artifact.role === "provider-snapshot"),
    false,
  );
}

function findJunctionFeatureTimeseriesArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-feature-${resourceSlug}:`));
}

function findJunctionBodyReadingArtifacts(
  payload: DeviceBatchImportPayload,
  resourceSlug: string,
) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith(`junction-timeseries-reading-${resourceSlug}:`));
}

function findJunctionBloodPressureReadingArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-blood-pressure:"));
}

function findJunctionNoteArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-note:"));
}

function findJunctionWeightReadingArtifacts(payload: DeviceBatchImportPayload) {
  return (payload.evidenceParts ?? [])
    .filter((artifact) => artifact.role.startsWith("junction-timeseries-reading-weight:"));
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

  if (resource === "caffeine" || resource === "water" || resource === "mindfulness_minutes") {
    const unit = resource === "caffeine" ? "g" : resource === "water" ? "mL" : "min";
    return {
      sourceProviderSlug: "oura",
      start: "2026-04-22T12:00:00Z",
      end: "2026-04-22T12:15:00Z",
      unit,
      value: resource === "caffeine" ? 0.095 : 1,
    };
  }

  if (resource === "steps") {
    return { ...base, unit: "count", value: 1_000 };
  }

  if (resource === "distance") {
    return { ...base, unit: "m", value: 1_000 };
  }

  if (resource === "calories_active") {
    return { ...base, unit: "kcal", value: 100 };
  }

  if (resource === "heartrate") {
    return { ...base, unit: "bpm", value: 72 };
  }

  if (resource === "weight") {
    return { ...base, unit: "kg", value: 75 };
  }

  const plausibleValues: Record<string, number> = {
    body_temperature: 36.6,
    basal_body_temperature: 36.6,
    body_temperature_delta: -0.4,
    glucose: 5.5,
  };

  return { ...base, value: plausibleValues[resource] ?? 1 };
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
    "heartrate",
    "blood_oxygen",
    "stress_level",
    "glucose",
  ]);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-activity"));
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "heartrate").length, 1);
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

test("Junction sparse stress aggregates pass core without temporal claims", async () => {
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
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
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
    const stressEvent = observationEvents.find((event) => event.metric === "stress-level");
    const variationEvent = observationEvents.find(
      (event) => event.metric === "stress-mean-absolute-successive-difference",
    );
    const records = (
      await Promise.all(
        [...new Set([...result.eventShardPaths, ...replay.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveVariationRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation"
        && record.metric === "stress-mean-absolute-successive-difference",
    );

    assert.equal(payload.samples?.length ?? 0, 0);
    assert.equal(stressEvent?.kind, "observation");
    assert.equal(stressEvent?.metric, "stress-level");
    assert.equal(stressEvent?.observationGrain, "summary");
    assert.equal(stressEvent?.value, 40);
    assert.equal(variationEvent, undefined);
    assert.equal(liveVariationRecords.length, 0);
    assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "stress-level").length, 1);
    assertNoFullJunctionTimeseriesArtifacts(payload);
    assertEventRawArtifactRolesExist(payload);
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction equal-time permutations produce one identical canonical temporal fact", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-stress-equal-time-replay");
  const samples = [
    { timestamp: "2026-04-22T08:00:00Z", value: 0 },
    { timestamp: "2026-04-22T08:00:00+00:00", value: 100 },
    { timestamp: "2026-04-22T08:01:00Z", value: 0 },
    { timestamp: "2026-04-22T08:02:00Z", value: 100 },
  ] as const;
  const snapshot = (data: readonly Record<string, unknown>[]) => ({
    accountId: "junction-account-hash-1",
    importedAt: "2026-04-22T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data,
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const imports = [];
    for (const permutation of allPermutations(samples)) {
      imports.push(
        await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
          {
            completeSourceDay: {
              connectionId: "junction-test-connection",
              dayKey: "2026-04-22",
              resources: ["stress_level"],
              revisionAt: "2026-04-24T12:00:00.000Z",
              timeZone: "UTC",
            },
            provider: "junction",
            vaultRoot,
            snapshot: snapshot(permutation),
          },
          { corePort: coreRuntime },
        ),
      );
    }
    const first = imports[0];
    assert.ok(first);
    type ImportedEvent = (typeof first.events)[number];
    type ImportedObservation = Extract<ImportedEvent, { kind: "observation" }>;
    const variation = (events: readonly ImportedEvent[]) => events.find(
      (event): event is ImportedObservation => event.kind === "observation"
        && event.metric === "stress-mean-absolute-successive-difference",
    );
    const firstVariation = variation(first.events);
    const records = (
      await Promise.all(
        [...new Set(imports.flatMap((result) => result.eventShardPaths))].map(
          (relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath }),
        ),
      )
    ).flat();
    const liveVariationRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation"
        && record.metric === "stress-mean-absolute-successive-difference",
    );

    assert.equal(firstVariation?.value, 75);
    for (const replay of imports.slice(1)) {
      const replayVariation = variation(replay.events);
      assert.equal(replayVariation?.value, 75);
      assert.equal(firstVariation?.id, replayVariation?.id);
      assert.deepEqual(firstVariation?.qualifiers, replayVariation?.qualifiers);
    }
    assert.equal(firstVariation?.qualifiers?.sampleCount, 3);
    assert.equal(firstVariation?.qualifiers?.qualifyingPairCount, 2);
    assert.equal(firstVariation?.dataOrigin?.originConfidence, "medium");
    assert.equal(liveVariationRecords.length, 1);
    assert.equal(storedObservationValue(liveVariationRecords[0]), 75);
    assertNoFullJunctionTimeseriesArtifacts(normalizeJunctionSnapshot(snapshot(samples)));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction complete vault days replace temporal source facets without retracting base facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-temporal-authority");
  const source = (provider: string, values: readonly number[]) => ({
    data: values.map((value, index) => ({
      timestamp: new Date(Date.UTC(2026, 3, 22, 8, index)).toISOString(),
      value,
    })),
    source: { provider, type: "watch" },
  });
  const importDay = (groups: Record<string, unknown[]>, revisionAt: string) =>
    importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        completeSourceDay: {
          connectionId: "junction-test-connection",
          dayKey: "2026-04-22",
          resources: ["stress_level"],
          revisionAt,
          timeZone: "UTC",
        },
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: revisionAt,
          timeseries: { stress_level: { groups } },
        },
      },
      { corePort: coreRuntime },
    );

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const ordinary = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      {
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: "2026-04-24T11:00:00.000Z",
          timeseries: {
            stress_level: {
              groups: {
                garmin: [source("garmin", [20, 30, 70, 80])],
                oura: [source("oura", [25, 35, 65, 75])],
              },
            },
          },
        },
      },
      { corePort: coreRuntime },
    );
    assert.equal(
      ordinary.events.filter((event) =>
        event.kind === "observation" && event.metric === "stress-level"
      ).length,
      2,
    );
    const populated = await importDay({
      garmin: [source("garmin", [20, 30, 70, 80])],
      oura: [source("oura", [25, 35, 65, 75])],
    }, "2026-04-24T12:00:00.000Z");
    const oneSource = await importDay({
      garmin: [source("garmin", [20, 30, 70, 80])],
    }, "2026-04-25T12:00:00.000Z");
    const empty = await importDay({}, "2026-04-26T12:00:00.000Z");
    const records = (
      await Promise.all(
        [...new Set([
          ...ordinary.eventShardPaths,
          ...populated.eventShardPaths,
          ...oneSource.eventShardPaths,
          ...empty.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const live = latestLiveRecords(records).filter((record) => record.kind === "observation");
    const liveTemporal = live.filter((record) =>
      typeof record.metric === "string"
      && record.metric.startsWith("stress-")
      && record.metric !== "stress-level"
    );
    const liveBase = live.filter((record) => record.metric === "stress-level");

    assert.equal(populated.events.filter((event) =>
      event.kind === "observation" && event.metric?.startsWith("stress-")
        && event.metric !== "stress-level"
    ).length, 4);
    assert.equal(oneSource.events.filter((event) =>
      event.kind === "observation" && event.metric?.startsWith("stress-")
        && event.metric !== "stress-level"
    ).length, 2);
    assert.equal(populated.events.filter((event) =>
      event.kind === "observation" && event.metric === "stress-level"
    ).length, 0);
    assert.equal(oneSource.events.filter((event) =>
      event.kind === "observation" && event.metric === "stress-level"
    ).length, 0);
    assert.equal(empty.events.length, 0);
    assert.equal(liveTemporal.length, 0);
    assert.equal(liveBase.length, 2);
    assert.deepEqual(
      liveBase.map((record) => eventRevisionFromLifecycle(record.lifecycle)),
      [1, 1],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction facet-only vault-day pulls never revise ordinary provider-day facts across source offsets", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-facet-only-ordinary-guard");
  const offsetRows = (values: readonly [number, number, number, number]) => [
    { timestamp: "2026-04-22T06:00:00.000Z", timezone_offset: -25_200, value: values[0] },
    { timestamp: "2026-04-22T06:05:00.000Z", timezone_offset: -25_200, value: values[1] },
    { timestamp: "2026-04-22T10:00:00.000Z", timezone_offset: -25_200, value: values[2] },
    { timestamp: "2026-04-22T10:05:00.000Z", timezone_offset: -25_200, value: values[3] },
  ];
  const snapshotFor = (rows: readonly Record<string, unknown>[], importedAt: string) => ({
    accountId: "junction-account-hash-1",
    importedAt,
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{ data: rows, source: { provider: "garmin", type: "watch" } }],
        },
      },
    },
  });
  const runImport = (
    rows: readonly Record<string, unknown>[],
    importedAt: string,
    completeSourceDay?: { dayKey: string },
  ) => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      ...(completeSourceDay
        ? {
            completeSourceDay: {
              connectionId: "junction-test-connection",
              dayKey: completeSourceDay.dayKey,
              resources: ["stress_level"],
              revisionAt: importedAt,
              timeZone: "America/Chicago",
            },
          }
        : {}),
      provider: "junction",
      vaultRoot,
      snapshot: snapshotFor(rows, importedAt),
    },
    { corePort: coreRuntime },
  );

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-21T00:00:00.000Z",
      timezone: "America/Chicago",
    });

    // Seed the calendar-day owner's full provider-day facts: the Los Angeles
    // source offset splits the rows across provider days 04-21 and 04-22.
    const seeded = await runImport(offsetRows([20, 30, 70, 80]), "2026-04-23T11:00:00.000Z");
    const seededOrdinary = seeded.events.filter((event) =>
      event.kind === "observation" && event.metric === "stress-level"
    );
    assert.deepEqual(
      seededOrdinary.map((event) => event.dayKey).sort(),
      ["2026-04-21", "2026-04-22"],
    );
    const seededEnvelopeIds = seeded.events
      .filter((event) => event.kind === "measurement")
      .map((event) => event.id)
      .sort();

    // The authorized Chicago vault-day pull covers only part of each provider
    // day; it must publish temporal facets without revising any ordinary fact.
    const temporal = await runImport(
      offsetRows([20, 30, 70, 80]),
      "2026-04-24T12:00:00.000Z",
      { dayKey: "2026-04-22" },
    );
    assert.equal(temporal.events.filter((event) =>
      event.kind === "observation" && event.metric === "stress-level"
    ).length, 0);
    assert.equal(temporal.events.filter((event) => event.kind === "measurement").length, 0);
    assert.equal(
      temporal.events.filter((event) =>
        event.kind === "observation"
        && typeof event.metric === "string"
        && event.metric.startsWith("stress-")
        && event.metric !== "stress-level"
      ).length > 0,
      true,
    );

    const records = (
      await Promise.all(
        [...new Set([...seeded.eventShardPaths, ...temporal.eventShardPaths])].map(
          (relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath }),
        ),
      )
    ).flat();
    const live = latestLiveRecords(records);
    const liveOrdinary = live.filter((record) =>
      record.kind === "observation" && record.metric === "stress-level"
    );
    assert.deepEqual(
      liveOrdinary
        .map((record) => [
          record.dayKey,
          storedObservationValue(record),
          eventRevisionFromLifecycle(record.lifecycle),
        ])
        .sort(),
      [["2026-04-21", 25, 1], ["2026-04-22", 75, 1]],
    );
    const liveEnvelopeIds = live
      .filter((record) => record.kind === "measurement")
      .map((record) => record.id)
      .sort();
    assert.deepEqual(liveEnvelopeIds, seededEnvelopeIds);
    assert.equal(
      live.filter((record) =>
        record.kind === "measurement"
        && eventRevisionFromLifecycle(record.lifecycle) !== 1
      ).length,
      0,
    );

    // The calendar-day owner remains able to update its ordinary facts later.
    const corrected = await runImport(offsetRows([20, 30, 90, 90]), "2026-04-25T11:00:00.000Z");
    const correctedRecords = (
      await Promise.all(
        [...new Set(corrected.eventShardPaths)].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const correctedLive = latestLiveRecords([...records, ...correctedRecords]).filter(
      (record) => record.kind === "observation"
        && record.metric === "stress-level"
        && record.dayKey === "2026-04-22",
    );
    assert.equal(correctedLive.length, 1);
    assert.equal(storedObservationValue(correctedLive[0]), 90);
    assert.equal(eventRevisionFromLifecycle(correctedLive[0]?.lifecycle) > 1, true);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction complete source days reject lossy rows before the canonical write", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-temporal-lossy-rows");
  const validRows = [
    { timestamp: "2026-04-22T07:00:00.000Z", value: 20 },
    { timestamp: "2026-04-22T07:05:00.000Z", value: 30 },
    { timestamp: "2026-04-22T19:00:00.000Z", value: 70 },
    { timestamp: "2026-04-22T19:05:00.000Z", value: 80 },
  ];
  const importDay = (rows: readonly Record<string, unknown>[], revisionAt: string) =>
    importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        completeSourceDay: {
          connectionId: "junction-test-connection",
          dayKey: "2026-04-22",
          resources: ["stress_level"],
          revisionAt,
          timeZone: "UTC",
        },
        provider: "junction",
        vaultRoot,
        snapshot: {
          accountId: "junction-account-hash-1",
          importedAt: revisionAt,
          timeseries: {
            stress_level: {
              groups: {
                garmin: [{ data: rows, source: { provider: "garmin", type: "watch" } }],
              },
            },
          },
        },
      },
      { corePort: coreRuntime },
    );
  const liveFacets = async (imports: Array<{ eventShardPaths: readonly string[] }>) => {
    const records = (
      await Promise.all(
        [...new Set(imports.flatMap((entry) => entry.eventShardPaths))].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    return latestLiveRecords(records).filter((record) =>
      record.kind === "observation"
      && typeof record.metric === "string"
      && record.metric.startsWith("stress-")
      && record.metric !== "stress-level"
    );
  };

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });

    const seeded = await importDay(validRows, "2026-04-24T12:00:00.000Z");
    const seededFacets = await liveFacets([seeded]);
    assert.equal(seededFacets.length, 3);

    const lossyShapes: ReadonlyArray<readonly Record<string, unknown>[]> = [
      [...validRows, { timestamp: "2026-04-22T20:00:00.000Z" }],
      [...validRows, { timestamp: "not-a-timestamp", value: 50 }],
      [...validRows, { value: 55 }],
    ];
    for (const rows of lossyShapes) {
      await assert.rejects(
        importDay(rows, "2026-04-24T13:00:00.000Z"),
        (error: unknown) =>
          (error as { code?: string; retryable?: boolean }).code
            === "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION"
          && (error as { retryable?: boolean }).retryable === true,
      );
      const unchanged = await liveFacets([seeded]);
      assert.equal(unchanged.length, 3);
      assert.deepEqual(
        unchanged.map((record) => eventRevisionFromLifecycle(record.lifecycle)),
        [1, 1, 1],
      );
    }

    const emptied = await importDay([], "2026-04-24T14:00:00.000Z");
    assert.equal((await liveFacets([seeded, emptied])).length, 0);

    const repopulated = await importDay(validRows, "2026-04-24T15:00:00.000Z");
    const replaced = await liveFacets([seeded, emptied, repopulated]);
    assert.equal(replaced.length, 3);
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
    },
  });

  const stressEvent = payload.events?.find((event) => event.fields?.metric === "stress-level");

  assert.equal(stressEvent?.occurredAt, "2026-06-24T22:30:00.000Z");
  assert.equal(stressEvent?.dayKey, "2026-06-25");
  assert.equal(stressEvent?.dataOrigin?.timeZoneOffsetMinutes, -240);
  assert.equal(stressEvent?.dataOrigin?.timestampSemantics, "offset");
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
                      id: "stress-corrected-1",
                      calendar_date: "2026-06-25",
                      timestamp: "2026-06-24T23:30:00-04:00",
                      updatedAt: "2026-06-25T12:00:00.000Z",
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
        id: "stress-corrected-1",
        timestamp: "2026-06-25T00:30:00+02:00",
        timezone_offset: -14_400,
        updatedAt: "2026-06-25T12:30:00.000Z",
        score: 44,
      };
      const adjacentSample = {
        id: "stress-adjacent-1",
        timestamp: "2026-06-24T00:30:00+02:00",
        timezone_offset: -14_400,
        updatedAt: "2026-06-25T12:30:00.000Z",
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

test("Junction date-only dense readings remain daily facts without fabricated clock time", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [{
              date: "2026-04-23",
              recordedAt: "2026-04-23T12:00:00Z",
              unit: "mmol/L",
              value: 5.5,
            }],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [{ date: "2026-04-23", unit: "percent", value: 88 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-23T06:30:00.000", score: 44 },
              { date: "2026-04-23", value: 56 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });
  const dailyValue = (metric: string) => payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === metric
  )?.fields?.value;
  const featureArtifact = (resourceSlug: string) =>
    findJunctionTimeseriesFeatureArtifacts(payload, resourceSlug)[0]?.content as {
      coverage?: { estimatedCoverageMinutes?: number; observedSpanMinutes?: number };
      features?: Record<string, number>;
      firstSampleAt?: string;
      hourlyBuckets?: Array<unknown[] | null>;
      lastSampleAt?: string;
      sampleCount?: number;
    };
  const featureMetrics = (resource: string) => {
    const event = payload.events?.find((candidate) =>
      candidate.kind === "measurement"
      && candidate.externalRef?.facet === "features"
      && candidate.title === `Junction ${resource.replaceAll("_", " ")} temporal features`
    );
    return readJunctionEventMeasurements(event).map((measurement) => measurement.metric).sort();
  };

  assert.equal(dailyValue("glucose"), 99.1001);
  assert.equal(dailyValue("spo2"), 88);
  assert.equal(dailyValue("stress-level"), 50);

  const glucose = featureArtifact("glucose");
  assert.equal(glucose.sampleCount, 0);
  assert.deepEqual(glucose.features, {});
  assert.equal(glucose.coverage?.estimatedCoverageMinutes, 0);
  assert.equal(glucose.coverage?.observedSpanMinutes, 0);
  assert.equal(glucose.firstSampleAt, undefined);
  assert.equal(glucose.lastSampleAt, undefined);
  assert.equal(glucose.hourlyBuckets?.length, 24);
  assert.equal(glucose.hourlyBuckets?.every((bucket) => bucket === null), true);
  assert.deepEqual(featureMetrics("glucose"), [
    "glucose-estimated-coverage-minutes",
    "glucose-observed-span-minutes",
  ]);

  const bloodOxygen = featureArtifact("blood-oxygen");
  assert.equal(bloodOxygen.sampleCount, 0);
  assert.deepEqual(bloodOxygen.features, {});
  assert.equal(bloodOxygen.firstSampleAt, undefined);
  assert.equal(bloodOxygen.lastSampleAt, undefined);
  assert.equal(bloodOxygen.hourlyBuckets?.every((bucket) => bucket === null), true);
  assert.deepEqual(featureMetrics("blood_oxygen"), [
    "spo2-estimated-coverage-minutes",
    "spo2-observed-span-minutes",
  ]);

  const stress = featureArtifact("stress-level");
  assert.equal(stress.sampleCount, 1);
  assert.equal(stress.features?.peakLocalHour, 6);
  assert.equal(stress.firstSampleAt, "2026-04-23T06:30:00.000Z");
  assert.equal(stress.lastSampleAt, "2026-04-23T06:30:00.000Z");
  assert.equal(stress.hourlyBuckets?.[0], null);
  assert.equal(stress.hourlyBuckets?.[6]?.[0], 1);
  assert.equal(featureMetrics("stress_level").includes("stress-peak-local-hour"), true);
});

test("Junction date-only stress publishes zero temporal coverage", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [{ date: "2026-04-23", value: 56 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });
  const daily = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "stress-level"
  );
  const feature = findJunctionTimeseriesFeatureArtifacts(payload, "stress-level")[0]?.content as {
    coverage?: { estimatedCoverageMinutes?: number; observedSpanMinutes?: number };
    features?: Record<string, number>;
    hourlyBuckets?: Array<unknown[] | null>;
    sampleCount?: number;
  };
  const featureEvent = payload.events?.find((event) =>
    event.kind === "measurement" && event.externalRef?.facet === "features"
  );

  assert.equal(daily?.fields?.value, 56);
  assert.equal(feature.sampleCount, 0);
  assert.deepEqual(feature.features, {});
  assert.equal(feature.coverage?.estimatedCoverageMinutes, 0);
  assert.equal(feature.coverage?.observedSpanMinutes, 0);
  assert.equal(feature.hourlyBuckets?.every((bucket) => bucket === null), true);
  assert.deepEqual(
    readJunctionEventMeasurements(featureEvent).map((measurement) => measurement.metric).sort(),
    ["stress-estimated-coverage-minutes", "stress-observed-span-minutes"],
  );
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
  // Only the documented micro keys land; explicit zero stays distinguishable
  // from the null/absent and undocumented fields, and per-item values sum.
  assert.deepEqual(nutrition?.micros, {
    sodiumGrams: 0.4,
    calciumMg: 0,
    ironMg: 3.9,
    magnesiumMg: 79,
    seleniumMcg: 38,
    vitaminB12Mcg: 4.6,
    vitaminDMcg: 12.5,
    folicAcidMg: 0.19,
  });
  assert.equal(Object.hasOwn(nutrition?.micros ?? {}, "zincMg"), false);
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
          gender: "other",
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
    const importedProfile = result.events.find((event) => event.kind === "note") as
      | { reportedGender?: string }
      | undefined;
    assert.equal(importedProfile?.reportedGender, "other");
    assert.ok(result.evidencePartCount >= 1);
    assert.notEqual(result.ingestShardPath, "");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction summary completeness facts roundtrip and replay without samples", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-summary-completeness");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });
    const input = {
      provider: "junction" as const,
      vaultRoot,
      snapshot: {
        accountId: "junction-account-hash-summary-completeness",
        importedAt: "2026-05-21T12:00:00.000Z",
        summaries: {
          profile: {
            id: "profile-summary-completeness",
            gender: "other",
            updated_at: "2026-05-20T09:00:00Z",
            source: { provider: "apple_health_kit", type: "phone" },
          },
          activity: [{
            id: "activity-summary-completeness",
            date: "2026-05-20T00:00:00Z",
            low: 84,
            medium: 15,
            high: 29,
            heart_rate: {
              avg_bpm: 72,
              avg_walking_bpm: 83,
              min_bpm: 44,
            },
            source: { provider: "garmin", type: "watch" },
          }],
          sleep: [{
            id: "sleep-summary-completeness",
            bedtime_start: "2026-05-20T02:00:00Z",
            bedtime_stop: "2026-05-20T10:00:00Z",
            latency: 1080,
            source: { provider: "oura", type: "ring" },
          }],
          menstrual_cycle: [{
            id: "cycle-summary-completeness",
            period_start: "2026-05-01",
            cervical_mucus: [{ date: "2026-05-12", quality: "watery" }],
            intermenstrual_bleeding: [{ date: "2026-05-13" }],
            home_progesterone_test: [{ date: "2026-05-14", test_result: "negative" }],
            contraceptive: [{ date: "2026-05-15", type: "oral" }],
            sexual_activity: [{ date: "2026-05-16", protection_used: true }],
            source: { provider: "apple_health", type: "phone" },
          }],
        },
      },
    };

    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );
    const observations = new Map(
      first.events
        .filter((event) => event.kind === "observation")
        .map((event) => [event.metric, event.value]),
    );
    const measurements = first.events
      .filter((event) => event.kind === "measurement")
      .flatMap((event) => event.measurements ?? []);
    const profile = first.events.find((event) => event.kind === "note") as
      | { reportedGender?: string }
      | undefined;

    assert.equal(observations.get("activity-minutes"), 128);
    assert.equal(observations.get("low-activity-minutes"), 84);
    assert.equal(observations.get("medium-activity-minutes"), 15);
    assert.equal(observations.get("high-activity-minutes"), 29);
    assert.equal(observations.get("activity-average-heart-rate"), 72);
    assert.equal(observations.get("walking-average-heart-rate"), 83);
    assert.equal(observations.get("minimum-heart-rate"), 44);
    assert.equal(observations.get("sleep-latency-minutes"), 18);
    assert.equal(profile?.reportedGender, "other");
    assert.deepEqual(
      measurements.map((measurement) => measurement.metric).sort(),
      [
        "cervical-mucus",
        "contraceptive-use",
        "gender",
        "intermenstrual-bleeding",
        "progesterone-test",
        "sexual-activity",
      ],
    );
    assert.equal(first.samples.length, 0);
    assert.equal(replay.samples.length, 0);
    assert.equal(replay.applied, false);
    assert.deepEqual(
      replay.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
    assert.doesNotMatch(JSON.stringify(first.events), /cervical_mucus|sexual_activity/u);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction production-shaped activity minutes roundtrip exactly for Garmin and Oura", async () => {
  const [garmin, oura] = await Promise.all([
    readHostedSmokeActivityRow("garmin"),
    readHostedSmokeActivityRow("oura"),
  ]);
  const snapshot = {
    importedAt: "2026-09-29T00:00:00.000Z",
    summaries: { activity: [garmin, oura] },
  };
  const normalized = normalizeJunctionSnapshot(snapshot);
  const normalizedValue = (sourceProviderSlug: string, metric: string) =>
    normalized.events?.find((event) =>
      event.dataOrigin?.sourceProviderSlug === sourceProviderSlug
      && event.fields?.metric === metric
    )?.fields?.value;

  assert.equal(normalizedValue("garmin", "low-activity-minutes"), 84);
  assert.equal(normalizedValue("garmin", "medium-activity-minutes"), 15);
  assert.equal(normalizedValue("garmin", "high-activity-minutes"), 29);
  assert.equal(normalizedValue("garmin", "activity-minutes"), 128);
  assert.equal(normalizedValue("oura", "low-activity-minutes"), 55);
  assert.equal(normalizedValue("oura", "medium-activity-minutes"), 231);
  assert.equal(normalizedValue("oura", "high-activity-minutes"), 23);
  assert.equal(normalizedValue("oura", "activity-minutes"), 309);
  assert.equal(normalized.samples?.length ?? 0, 0);

  const vaultRoot = await makeTempDirectory("murph-junction-production-activity-minutes");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-09-29T00:00:00.000Z",
      timezone: "UTC",
    });
    const input = { provider: "junction" as const, vaultRoot, snapshot };
    const first = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      input,
      { corePort: coreRuntime },
    );
    const importedValue = (sourceProviderSlug: string, metric: string) => {
      const event = first.events.find((candidate) =>
        candidate.dataOrigin?.sourceProviderSlug === sourceProviderSlug
        && candidate.kind === "observation"
        && candidate.metric === metric
      );
      return event?.kind === "observation" ? event.value : undefined;
    };

    assert.equal(importedValue("garmin", "activity-minutes"), 128);
    assert.equal(importedValue("oura", "activity-minutes"), 309);
    assert.equal(first.samples.length, 0);
    assert.equal(replay.samples.length, 0);
    assert.equal(replay.applied, false);
    assert.deepEqual(
      replay.events.map((event) => event.id).sort(),
      first.events.map((event) => event.id).sort(),
    );
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

test("Junction steps and distance stay provider-partitioned and summary-independent", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    summaries: {
      activity: [{
        sourceProviderSlug: "oura",
        sourceType: "ring",
        sourceInstanceId: "summary-ring",
        observedAt: "2026-04-22T23:00:00Z",
        steps: 9000,
        distanceMeters: 7000,
      }],
    },
    timeseries: {
      steps: {
        groups: {
          oura: [
            {
              data: [
                { timestamp: "2026-04-22T07:10:00Z", unit: "count", value: 100 },
                { timestamp: "2026-04-22T18:10:00Z", unit: "count", value: 200 },
                { timestamp: "2026-04-23T07:10:00Z", unit: "count", value: 300 },
              ],
              source: { provider: "oura", type: "ring", device_id: "ring-a" },
            },
            {
              data: [
                { timestamp: "2026-04-22T20:10:00Z", unit: "count", value: 400 },
              ],
              source: { provider: "oura", type: "ring", device_id: "ring-b" },
            },
          ],
          garmin: [{
            data: [
              { timestamp: "2026-04-22T12:10:00Z", unit: "count", value: 50 },
            ],
            source: { provider: "garmin", type: "watch", device_id: "watch-a" },
          }],
        },
      },
      distance: {
        groups: {
          oura: [
            {
              data: [
                { timestamp: "2026-04-22T07:10:00Z", unit: "m", value: 1000 },
                { timestamp: "2026-04-22T18:10:00Z", unit: "km", value: 0.5 },
              ],
              source: { provider: "oura", type: "ring", device_id: "ring-a" },
            },
            {
              data: [
                { timestamp: "2026-04-22T20:10:00Z", unit: "km", value: 2 },
              ],
              source: { provider: "oura", type: "ring", device_id: "ring-b" },
            },
          ],
          garmin: [{
            data: [
              { timestamp: "2026-04-22T12:10:00Z", unit: "mi", value: 1 },
            ],
            source: { provider: "garmin", type: "watch", device_id: "watch-a" },
          }],
        },
      },
    },
  });

  const stepArtifacts = findJunctionCompactTimeseriesArtifacts(payload, "steps")
    .map((artifact) => artifact.content as Record<string, unknown>);
  const distanceArtifacts = findJunctionCompactTimeseriesArtifacts(payload, "distance")
    .map((artifact) => artifact.content as Record<string, unknown>);
  const stepEvents = (payload.events ?? []).filter((event) =>
    event.externalRef?.resourceType.endsWith("-steps")
  );
  const distanceEvents = (payload.events ?? []).filter((event) =>
    event.externalRef?.resourceType.endsWith("-distance")
  );

  assert.deepEqual(payload.provenance?.summaryResources, ["activity"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["steps", "distance"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(stepArtifacts.length, 4);
  assert.equal(distanceArtifacts.length, 3);
  assert.equal(stepEvents.length, 4);
  assert.equal(distanceEvents.length, 3);
  assert.ok(
    (payload.events ?? []).some((event) =>
      event.externalRef?.resourceType.endsWith("-activity")
      && event.fields?.metric === "daily-steps"
    ),
  );
  assert.deepEqual(
    stepArtifacts
      .map((content) => ({
        dayKey: content.dayKey,
        provider: content.sourceProviderSlug,
        sumValue: content.sumValue,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    [
      { dayKey: "2026-04-22", provider: "garmin", sumValue: 50 },
      { dayKey: "2026-04-22", provider: "oura", sumValue: 300 },
      { dayKey: "2026-04-22", provider: "oura", sumValue: 400 },
      { dayKey: "2026-04-23", provider: "oura", sumValue: 300 },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
  assert.deepEqual(
    distanceArtifacts
      .map((content) => ({
        provider: content.sourceProviderSlug,
        sumValue: content.sumValue,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    [
      { provider: "garmin", sumValue: 1.6093 },
      { provider: "oura", sumValue: 1.5 },
      { provider: "oura", sumValue: 2 },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
  assert.ok(
    [...stepArtifacts, ...distanceArtifacts].every((content) =>
      typeof content.sourceInstanceId === "string"
      && /^source-[a-f0-9]{24}$/u.test(content.sourceInstanceId)
    ),
  );
  assert.equal(
    new Set(
      stepArtifacts.map((content) => `${content.sourceProviderSlug}:${content.sourceInstanceId}`),
    ).size,
    3,
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction heart rate and active calories emit only bounded UTC-hour features", async () => {
  const snapshot = {
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      heartrate: {
        groups: {
          oura: [{
            data: [
              { timestamp: "2026-04-22T07:10:00Z", unit: "bpm", value: 60, rawSecret: "RAW_FEATURE_SENTINEL" },
              { timestamp: "2026-04-22T07:40:00Z", unit: "bpm", value: 72, rawSecret: "RAW_FEATURE_SENTINEL" },
              { timestamp: "2026-04-22T08:10:00Z", unit: "bpm", value: 80, rawSecret: "RAW_FEATURE_SENTINEL" },
            ],
            source: { provider: "oura", type: "ring", device_id: "raw-ring-id", name: "Raw Ring Name" },
          }],
          garmin: [{
            data: [
              {
                timestamp: "2026-04-22T07:20:00Z",
                unit: "bpm",
                value: 90,
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
              {
                timestamp: "2026-04-22T09:15:00Z",
                unit: "bpm",
                value: 100,
                sessionId: "workout-1",
                sessionStart: "2026-04-22T09:00:00Z",
                sessionEnd: "2026-04-22T10:00:00Z",
                sessionType: "run",
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
              {
                timestamp: "2026-04-22T09:45:00Z",
                unit: "bpm",
                value: 120,
                sessionId: "workout-1",
                sessionStart: "2026-04-22T09:00:00Z",
                sessionEnd: "2026-04-22T10:00:00Z",
                sessionType: "run",
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
            ],
            source: { provider: "garmin", type: "watch", device_id: "raw-watch-id" },
          }],
        },
      },
      calories_active: {
        groups: {
          oura: [{
            data: [
              {
                timestamp: "2026-04-22T07:05:00Z",
                start: "2026-04-22T07:00:00Z",
                end: "2026-04-22T07:10:00Z",
                unit: "kcal",
                value: 10,
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
              {
                timestamp: "2026-04-22T07:55:00Z",
                start: "2026-04-22T07:50:00Z",
                end: "2026-04-22T08:00:00Z",
                unit: "kcal",
                value: 15,
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
            ],
            source: { provider: "oura", type: "ring", device_id: "raw-ring-id" },
          }],
          garmin: [{
            data: [
              {
                timestamp: "2026-04-22T09:10:00Z",
                unit: "kcal",
                value: 20,
                sessionId: "workout-1",
                sessionStart: "2026-04-22T09:00:00Z",
                sessionEnd: "2026-04-22T10:00:00Z",
                sessionType: "run",
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
              {
                timestamp: "2026-04-22T09:50:00Z",
                unit: "kcal",
                value: 30,
                sessionId: "workout-1",
                sessionStart: "2026-04-22T09:00:00Z",
                sessionEnd: "2026-04-22T10:00:00Z",
                sessionType: "run",
                rawSecret: "RAW_FEATURE_SENTINEL",
              },
            ],
            source: { provider: "garmin", type: "watch", device_id: "raw-watch-id" },
          }],
        },
      },
    },
  };
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot,
  });

  const heartRateArtifacts = findJunctionFeatureTimeseriesArtifacts(payload, "heartrate")
    .map((artifact) => artifact.content as Record<string, unknown>);
  const calorieArtifacts = findJunctionFeatureTimeseriesArtifacts(payload, "calories-active")
    .map((artifact) => artifact.content as Record<string, unknown>);
  const heartRateEvents = (payload.events ?? []).filter((event) =>
    ["average-heart-rate", "lowest-heart-rate", "max-heart-rate"].includes(
      String(event.fields?.metric),
    )
  );
  const calorieEvents = (payload.events ?? []).filter((event) =>
    event.fields?.metric === "active-calories"
  );
  const workoutHeartRateHour = heartRateArtifacts.find((content) =>
    content.bucketStartAt === "2026-04-22T09:00:00.000Z"
    && content.sourceProviderSlug === "garmin"
  );
  const firstHeartRateHour = heartRateArtifacts.find((content) =>
    content.bucketStartAt === "2026-04-22T07:00:00.000Z"
    && content.sourceProviderSlug === "oura"
  );
  const sameHourHeartRateProviders = heartRateArtifacts
    .filter((content) => content.bucketStartAt === "2026-04-22T07:00:00.000Z")
    .map((content) => content.sourceProviderSlug)
    .sort();
  const workoutCaloriesHour = calorieArtifacts.find((content) =>
    content.bucketStartAt === "2026-04-22T09:00:00.000Z"
    && content.sourceProviderSlug === "garmin"
  );

  assert.deepEqual(payload.provenance?.timeseriesResources, ["heartrate", "calories_active"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(heartRateArtifacts.length, 4);
  assert.equal(calorieArtifacts.length, 2);
  assert.equal(heartRateEvents.length, 12);
  assert.equal(calorieEvents.length, 2);
  assert.equal(firstHeartRateHour?.sampleCount, 2);
  assert.equal(firstHeartRateHour?.meanValue, 66);
  assert.equal(firstHeartRateHour?.minValue, 60);
  assert.equal(firstHeartRateHour?.maxValue, 72);
  assert.deepEqual(sameHourHeartRateProviders, ["garmin", "oura"]);
  assert.ok(heartRateArtifacts.every((content) => content.bucketKind === "hour"));
  assert.ok(calorieArtifacts.every((content) => content.bucketKind === "hour"));
  assert.equal(workoutHeartRateHour?.meanValue, 110);
  assert.equal(workoutCaloriesHour?.sumValue, 50);
  assert.ok(heartRateArtifacts.every((content) => !("sessionId" in content)));
  assert.ok(calorieArtifacts.every((content) => !("sessionId" in content)));
  assert.ok(
    [...heartRateEvents, ...calorieEvents].every((event) =>
      Date.parse(event.occurredAt) <= Date.parse(snapshot.importedAt)
    ),
  );
  assert.ok(
    heartRateEvents.every((event) => event.fields?.observationGrain === "derived_fact"),
  );
  assert.ok(
    calorieEvents.every((event) => event.fields?.observationGrain === "derived_fact"),
  );
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assertJsonOmits(payload.evidenceParts, [
    "RAW_FEATURE_SENTINEL",
    "Raw Ring Name",
    "raw-ring-id",
    "raw-watch-id",
    '"value":60',
    '"value":72',
    '"value":90',
    '"value":100',
    '"value":120',
  ]);
});

test("Junction dense timeseries keep adjacent UTC import buckets complete and replay-order stable", async () => {
  const normalizeWindow = async (input: {
    heartRate: number;
    steps: number;
    timestamp: string;
    windowEnd: string;
    windowStart: string;
  }) => prepareDeviceProviderSnapshotImport({
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: {
      importedAt: input.windowEnd,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
      timeseries: {
        steps: [{
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sourceInstanceId: "watch-1",
          timestamp: input.timestamp,
          timezoneOffset: -25_200,
          unit: "count",
          value: input.steps,
        }],
        heartrate: [{
          sessionEnd: "2026-04-23T01:00:00.000Z",
          sessionId: "cross-midnight-workout",
          sessionStart: "2026-04-22T23:00:00.000Z",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sourceInstanceId: "watch-1",
          timestamp: input.timestamp,
          unit: "bpm",
          value: input.heartRate,
        }],
      },
    },
  });
  const first = await normalizeWindow({
    heartRate: 90,
    steps: 100,
    timestamp: "2026-04-22T23:30:00.000Z",
    windowEnd: "2026-04-23T00:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
  });
  const second = await normalizeWindow({
    heartRate: 110,
    steps: 200,
    timestamp: "2026-04-23T00:30:00.000Z",
    windowEnd: "2026-04-24T00:00:00.000Z",
    windowStart: "2026-04-23T00:00:00.000Z",
  });

  const selectEvents = (payload: Awaited<ReturnType<typeof normalizeWindow>>) =>
    (payload.events ?? []).filter((event) =>
      event.fields?.metric === "daily-steps"
      || event.fields?.metric === "average-heart-rate"
    );
  const firstEvents = selectEvents(first);
  const secondEvents = selectEvents(second);
  const identity = (event: (typeof firstEvents)[number]) => JSON.stringify(event.externalRef);
  const forwardIdentities = [...firstEvents, ...secondEvents].map(identity).sort();
  const reverseIdentities = [...secondEvents, ...firstEvents].map(identity).sort();

  assert.deepEqual(
    firstEvents
      .map((event) => [event.fields?.metric, event.dayKey])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    [["average-heart-rate", "2026-04-22"], ["daily-steps", "2026-04-22"]],
  );
  assert.deepEqual(
    secondEvents
      .map((event) => [event.fields?.metric, event.dayKey])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    [["average-heart-rate", "2026-04-23"], ["daily-steps", "2026-04-23"]],
  );
  assert.equal(new Set(forwardIdentities).size, 4);
  assert.deepEqual(forwardIdentities, reverseIdentities);
  assert.ok([...firstEvents, ...secondEvents].every((event) => event.timeZone === "UTC"));
  assert.deepEqual(
    [first, second].flatMap((payload) =>
      findJunctionFeatureTimeseriesArtifacts(payload, "heartrate")
        .map((artifact) => (artifact.content as Record<string, unknown>).bucketKind)
    ),
    ["hour", "hour"],
  );
});

test("Junction daily aggregates preserve floating provider days at closed UTC boundaries", () => {
  const firstSnapshot = {
    importedAt: "2026-04-23T00:00:00.000Z",
    windowEnd: "2026-04-23T00:00:00.000Z",
    windowStart: "2026-04-22T00:00:00.000Z",
    timeseries: {
      steps: [
        { day: "2026-04-22", sourceProviderSlug: "oura", unit: "count", value: 10 },
        { timestamp: "2026-04-22T18:30:00", sourceProviderSlug: "oura", unit: "count", value: 20 },
        { timestamp: "2026-04-22T22:00:00Z", sourceProviderSlug: "oura", unit: "count", value: 30 },
      ],
      distance: [
        { day: "2026-04-22", sourceProviderSlug: "oura", unit: "m", value: 1000 },
        { timestamp: "2026-04-22T18:30:00", sourceProviderSlug: "oura", unit: "m", value: 2000 },
        { timestamp: "2026-04-22T22:00:00Z", sourceProviderSlug: "oura", unit: "m", value: 3000 },
      ],
    },
  };
  const secondSnapshot = {
    importedAt: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-04-24T00:00:00.000Z",
    windowStart: "2026-04-23T00:00:00.000Z",
    timeseries: {
      steps: [{
        timestamp: "2026-04-22T23:30:00-02:00",
        sourceProviderSlug: "oura",
        unit: "count",
        value: 40,
      }],
      distance: [{
        timestamp: "2026-04-22T23:30:00-02:00",
        sourceProviderSlug: "oura",
        unit: "m",
        value: 4000,
      }],
    },
  };
  const first = normalizeJunctionSnapshot(firstSnapshot);
  const firstReplay = normalizeJunctionSnapshot(firstSnapshot);
  const second = normalizeJunctionSnapshot(secondSnapshot);
  const selectedEvents = (payload: ReturnType<typeof normalizeJunctionSnapshot>) =>
    (payload.events ?? []).filter((event) =>
      event.fields?.metric === "daily-steps"
      || event.fields?.metric === "distance-km"
    );
  const firstEvents = selectedEvents(first);
  const secondEvents = selectedEvents(second);
  const eventIdentity = (event: (typeof firstEvents)[number]) =>
    JSON.stringify(event.externalRef);

  assert.deepEqual(
    firstEvents
      .map((event) => ({
        dayKey: event.dayKey,
        metric: event.fields?.metric,
        occurredAt: event.occurredAt,
        timeZone: event.timeZone,
        value: event.fields?.value,
      }))
      .sort((left, right) => String(left.metric).localeCompare(String(right.metric))),
    [
      {
        dayKey: "2026-04-22",
        metric: "daily-steps",
        occurredAt: "2026-04-22T23:59:59.999Z",
        timeZone: "UTC",
        value: 60,
      },
      {
        dayKey: "2026-04-22",
        metric: "distance-km",
        occurredAt: "2026-04-22T23:59:59.999Z",
        timeZone: "UTC",
        value: 6,
      },
    ],
  );
  assert.deepEqual(
    secondEvents
      .map((event) => ({
        dayKey: event.dayKey,
        metric: event.fields?.metric,
        occurredAt: event.occurredAt,
        value: event.fields?.value,
      }))
      .sort((left, right) => String(left.metric).localeCompare(String(right.metric))),
    [
      {
        dayKey: "2026-04-23",
        metric: "daily-steps",
        occurredAt: "2026-04-23T01:30:00.000Z",
        value: 40,
      },
      {
        dayKey: "2026-04-23",
        metric: "distance-km",
        occurredAt: "2026-04-23T01:30:00.000Z",
        value: 4,
      },
    ],
  );
  assert.deepEqual(firstEvents.map(eventIdentity), selectedEvents(firstReplay).map(eventIdentity));
  assert.equal(
    new Set([...firstEvents, ...secondEvents].map(eventIdentity)).size,
    4,
  );
});

test("Junction weight readings are compact, replay-stable, distinct, and canonically queryable", async () => {
  const garminReadings = [
    { id: "reading-a", timestamp: "2026-04-22T08:05:00Z", unit: "kg", value: 80, rawSecret: "RAW_WEIGHT_SENTINEL" },
  ];
  const snapshot = (input: {
    reverse: boolean;
    withingsIdlessWeight: number;
    withingsReadingAWeight: number;
  }) => {
    const withingsReadings = [
      { id: "reading-a", timestamp: "2026-04-22T08:05:00Z", unit: "kg", value: input.withingsReadingAWeight, rawSecret: "RAW_WEIGHT_SENTINEL" },
      { id: "reading-a", timestamp: "2026-04-22T08:05:00Z", unit: "kg", value: input.withingsReadingAWeight, rawSecret: "RAW_WEIGHT_SENTINEL" },
      { id: "reading-b", timestamp: "2026-04-22T08:05:00Z", unit: "kg", value: 80, rawSecret: "RAW_WEIGHT_SENTINEL" },
      { timestamp: "2026-04-22T08:05:00Z", unit: "kg", value: input.withingsIdlessWeight, rawSecret: "RAW_WEIGHT_SENTINEL" },
    ];
    return {
      accountId: "junction-account-hash-1",
      importedAt: "2026-04-24T12:00:00.000Z",
      timeseries: {
        weight: {
          groups: {
            withings: [{
              data: input.reverse ? [...withingsReadings].reverse() : withingsReadings,
              source: { provider: "withings", type: "scale", device_id: "scale-a" },
            }],
            garmin: [{
              data: input.reverse ? [...garminReadings].reverse() : garminReadings,
              source: { provider: "garmin", type: "scale", device_id: "scale-b" },
            }],
          },
        },
      },
    };
  };
  const orderedSnapshot = snapshot({
    reverse: false,
    withingsIdlessWeight: 82,
    withingsReadingAWeight: 80,
  });
  const reversedSnapshot = snapshot({
    reverse: true,
    withingsIdlessWeight: 82,
    withingsReadingAWeight: 80,
  });
  const correctedSnapshot = snapshot({
    reverse: true,
    withingsIdlessWeight: 83,
    withingsReadingAWeight: 81,
  });
  const ordered = normalizeJunctionSnapshot(orderedSnapshot);
  const reversed = normalizeJunctionSnapshot(reversedSnapshot);
  const corrected = normalizeJunctionSnapshot(correctedSnapshot);
  const weightEvents = (ordered.events ?? []).filter((event) => event.kind === "measurement");
  const externalResourceIds = (payload: ReturnType<typeof normalizeJunctionSnapshot>) =>
    (payload.events ?? [])
      .filter((event) => event.kind === "measurement")
      .map((event) => event.externalRef?.resourceId)
      .sort();
  const evidenceRoles = (payload: ReturnType<typeof normalizeJunctionSnapshot>) =>
    findJunctionWeightReadingArtifacts(payload).map((artifact) => artifact.role).sort();
  const readingValues = weightEvents
    .map((event) => (
      event.fields?.measurements as Array<Record<string, unknown>> | undefined
    )?.[0]?.value)
    .sort((left, right) => Number(left) - Number(right));

  assert.deepEqual(ordered.provenance?.timeseriesResources, ["weight"]);
  assert.equal(ordered.samples?.length ?? 0, 0);
  assert.equal(weightEvents.length, 4);
  assert.equal(findJunctionWeightReadingArtifacts(ordered).length, 4);
  assert.deepEqual(readingValues, [80, 80, 80, 82]);
  assert.equal(new Set(externalResourceIds(ordered)).size, 4);
  assert.deepEqual(externalResourceIds(ordered), externalResourceIds(reversed));
  assert.deepEqual(externalResourceIds(ordered), externalResourceIds(corrected));
  assert.deepEqual(evidenceRoles(ordered), evidenceRoles(reversed));
  assert.deepEqual(evidenceRoles(ordered), evidenceRoles(corrected));
  assert.ok(weightEvents.every((event) => event.dataOrigin?.sourceProviderSlug));
  assertNoFullJunctionTimeseriesArtifacts(ordered);
  assertEventRawArtifactRolesExist(ordered);
  assertJsonOmits(ordered.evidenceParts, ["RAW_WEIGHT_SENTINEL"]);
  assert.ok(
    findJunctionWeightReadingArtifacts(ordered).every((artifact) =>
      JSON.stringify(artifact.content).length < 1024
    ),
  );

  const vaultRoot = await makeTempDirectory("murph-junction-weight-queryable");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-22T00:00:00.000Z",
      timezone: "UTC",
    });
    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: orderedSnapshot },
      { corePort: coreRuntime },
    );
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: reversedSnapshot },
      { corePort: coreRuntime },
    );
    const correctedImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot: correctedSnapshot },
      { corePort: coreRuntime },
    );
    const importedWeightIds = (events: typeof firstImport.events) => events
      .filter((event) => event.kind === "measurement")
      .map((event) => event.id)
      .sort();
    const availability = await coreRuntime.readCanonicalEventAvailabilityInterruptible({ vaultRoot });

    assert.deepEqual(importedWeightIds(firstImport.events), importedWeightIds(replayImport.events));
    assert.deepEqual(importedWeightIds(firstImport.events), importedWeightIds(correctedImport.events));
    assert.ok(correctedImport.events.some((event) =>
      event.kind === "measurement"
      && event.dataOrigin?.sourceProviderSlug === "withings"
      && event.measurements[0]?.value === 81
    ));
    assert.ok(correctedImport.events.some((event) =>
      event.kind === "measurement"
      && event.dataOrigin?.sourceProviderSlug === "withings"
      && event.measurements[0]?.value === 83
    ));
    assert.equal(availability.interrupted, false);
    assert.equal(availability.latestBodyMeasurementOccurredAt, "2026-04-22T08:05:00.000Z");
    assert.equal(availability.latestBodyMeasurementDayKey, "2026-04-22");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction timeseries reject malformed or implausible samples without retaining them", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      steps: [
        {
          sourceProviderSlug: "oura",
          timestamp: "2026-04-22T08:05:00Z",
          unit: "count",
          value: 1_000_001,
          rawSecret: "REJECTED_STEPS_SENTINEL",
        },
        {
          sourceProviderSlug: "oura",
          timestamp: "not-a-timestamp",
          unit: "count",
          value: 10,
          rawSecret: "MALFORMED_STEPS_TIMESTAMP_SENTINEL",
        },
      ],
      distance: [
        {
          sourceProviderSlug: "oura",
          timestamp: "2026-04-22T08:05:00Z",
          unit: "km",
          value: 1001,
          rawSecret: "REJECTED_DISTANCE_SENTINEL",
        },
        {
          sourceProviderSlug: "oura",
          unit: "km",
          value: 1,
          rawSecret: "MISSING_DISTANCE_TIMESTAMP_SENTINEL",
        },
      ],
      calories_active: [
        {
          sourceProviderSlug: "oura",
          timestamp: "2026-04-22T08:05:00Z",
          unit: "kcal",
          value: 20_001,
          rawSecret: "REJECTED_CALORIES_SENTINEL",
        },
        {
          sourceProviderSlug: "oura",
          timestamp: "not-a-timestamp",
          unit: "kcal",
          value: 5,
          rawSecret: "MALFORMED_CALORIES_TIMESTAMP_SENTINEL",
        },
      ],
      heartrate: [
        {
          sourceProviderSlug: "oura",
          timestamp: "2026-04-22T08:05:00Z",
          unit: "bpm",
          value: 301,
          rawSecret: "REJECTED_HEARTRATE_SENTINEL",
        },
        {
          sourceProviderSlug: "oura",
          unit: "bpm",
          value: 60,
          rawSecret: "MISSING_HEARTRATE_TIMESTAMP_SENTINEL",
        },
      ],
      weight: [
        {
          sourceProviderSlug: "withings",
          timestamp: "2026-04-22T08:05:00Z",
          unit: "kg",
          value: 501,
          rawSecret: "REJECTED_WEIGHT_SENTINEL",
        },
        {
          sourceProviderSlug: "withings",
          timestamp: "not-a-timestamp",
          unit: "kg",
          value: 80,
          rawSecret: "MALFORMED_WEIGHT_TIMESTAMP_SENTINEL",
        },
      ],
    },
  });

  assert.deepEqual(
    payload.provenance?.timeseriesResources,
    ["steps", "distance", "calories_active", "heartrate", "weight"],
  );
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "steps").length, 1);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "distance").length, 1);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "calories-active").length, 1);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "heartrate").length, 1);
  assert.equal(findJunctionWeightReadingArtifacts(payload).length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertJsonOmits(payload.evidenceParts, [
    "REJECTED_STEPS_SENTINEL",
    "REJECTED_DISTANCE_SENTINEL",
    "REJECTED_CALORIES_SENTINEL",
    "REJECTED_HEARTRATE_SENTINEL",
    "REJECTED_WEIGHT_SENTINEL",
    "MALFORMED_STEPS_TIMESTAMP_SENTINEL",
    "MISSING_DISTANCE_TIMESTAMP_SENTINEL",
    "MALFORMED_CALORIES_TIMESTAMP_SENTINEL",
    "MISSING_HEARTRATE_TIMESTAMP_SENTINEL",
    "MALFORMED_WEIGHT_TIMESTAMP_SENTINEL",
    '"value":1000001',
    '"value":1001',
    '"value":20001',
    '"value":301',
    '"value":501',
  ]);
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

test("Junction normalizer compacts dense CGM glucose timeseries into daily mean/min/max facts", () => {
  // A full CGM day: 288 five-minute samples must reduce to one compact daily
  // aggregate, one bounded feature envelope, and derived facts, never raw dumps.
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

  const glucoseEvents = payload.events?.filter((event) =>
    ["glucose", "lowest-glucose", "highest-glucose"].includes(String(event.fields?.metric))
  ) ?? [];
  const mean = glucoseEvents.find((event) => event.fields?.metric === "glucose");
  const min = glucoseEvents.find((event) => event.fields?.metric === "lowest-glucose");
  const max = glucoseEvents.find((event) => event.fields?.metric === "highest-glucose");
  const artifacts = findJunctionCompactTimeseriesArtifacts(payload, "glucose");
  const featureArtifacts = findJunctionTimeseriesFeatureArtifacts(payload, "glucose");
  const artifactContent = artifacts[0]?.content as Record<string, unknown>;
  const featureContent = featureArtifacts[0]?.content as Record<string, unknown>;

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(glucoseEvents.length, 3);
  assert.equal(artifacts.length, 1);
  assert.equal(featureArtifacts.length, 1);
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
  assert.equal(featureContent.schema, "junction.timeseries_feature_envelope.v1");
  assert.equal(featureContent.sampleCount, 288);
  assert.equal((featureContent.hourlyBuckets as unknown[]).length, 24);
  assert.ok(JSON.stringify(featureContent).length < 16 * 1024);
});

test("Junction normalizer preserves official point and interval timeseries shapes without raw samples", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseriesWindowKind: "calendar_day",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [{ timestamp: "2026-04-22T05:10:00-04:00", unit: "mmol/L", value: 5.5 }],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [{ timestamp: "2026-04-22T06:20:00-04:00", unit: "percent", value: 0.975 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      stress_level: {
        groups: {
          garmin: [{
            data: [{ timestamp: "2026-04-22T07:30:00-04:00", unit: "score", value: 72 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      caffeine: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "caffeine-record-1",
              start: "2026-04-22T08:15:30-04:00",
              end: "2026-04-22T08:18:00-04:00",
              unit: "g",
              value: 0.095,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
      water: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "water-record-1",
              start: "2026-04-22T09:05:00-04:00",
              end: "2026-04-22T09:09:30-04:00",
              unit: "mL",
              value: 250,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
      mindfulness_minutes: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "mindfulness-record-1",
              start: "2026-04-22T21:00:00-04:00",
              end: "2026-04-22T21:10:00-04:00",
              unit: "min",
              value: 10,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
    },
  });

  const dailyValue = (metric: string): unknown =>
    payload.events?.find((event) =>
      event.kind === "observation"
      && event.fields?.observationGrain === "summary"
      && event.fields.metric === metric
    )?.fields?.value;
  const intervalMeasurement = (metric: string) =>
    payload.events?.find((event) =>
      event.kind === "measurement"
      && readJunctionEventMeasurements(event).some((measurement) => measurement.metric === metric)
    );

  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.provenance?.timeseriesWindowKind, "calendar_day");
  assert.equal(dailyValue("glucose"), 99.1001);
  assert.equal(dailyValue("spo2"), 97.5);
  assert.equal(dailyValue("stress-level"), 72);
  assert.equal(dailyValue("caffeine"), 95);
  assert.equal(dailyValue("water"), 250);
  assert.equal(dailyValue("mindfulness-minutes"), 10);
  for (const resourceSlug of ["glucose", "blood-oxygen", "stress-level"]) {
    const [artifact] = findJunctionTimeseriesFeatureArtifacts(payload, resourceSlug);
    const content = artifact?.content as Record<string, unknown> | undefined;
    assert.equal(content?.schema, "junction.timeseries_feature_envelope.v1", resourceSlug);
    assert.equal(content?.sampleCount, 1, resourceSlug);
    assert.equal((content?.hourlyBuckets as unknown[] | undefined)?.length, 24, resourceSlug);
  }

  const expectedIntervals = [
    {
      metric: "caffeine",
      resourceSlug: "caffeine",
      startAt: "2026-04-22T12:15:30.000Z",
      endAt: "2026-04-22T12:18:00.000Z",
      durationSeconds: 150,
      providerUnit: "g",
      value: 95,
      unit: "mg",
    },
    {
      metric: "water",
      resourceSlug: "water",
      startAt: "2026-04-22T13:05:00.000Z",
      endAt: "2026-04-22T13:09:30.000Z",
      durationSeconds: 270,
      providerUnit: "mL",
      value: 250,
      unit: "ml",
    },
    {
      metric: "mindfulness-minutes",
      resourceSlug: "mindfulness-minutes",
      startAt: "2026-04-23T01:00:00.000Z",
      endAt: "2026-04-23T01:10:00.000Z",
      durationSeconds: 600,
      providerUnit: "min",
      value: 10,
      unit: "minutes",
    },
  ] as const;

  for (const expected of expectedIntervals) {
    const event = intervalMeasurement(expected.metric);
    const measurement = readJunctionEventMeasurements(event)
      .find((entry) => entry.metric === expected.metric);
    const [artifact] = findJunctionIntervalReadingArtifacts(payload, expected.resourceSlug);
    const content = artifact?.content as Record<string, unknown> | undefined;

    assert.equal(event?.occurredAt, expected.startAt, expected.metric);
    assert.equal(event?.dayKey, "2026-04-22", expected.metric);
    assert.equal(measurement?.value, expected.value, expected.metric);
    assert.equal(measurement?.unit, expected.unit, expected.metric);
    assert.deepEqual(measurement?.qualifiers, {
      "interval-start-at": expected.startAt,
      "interval-end-at": expected.endAt,
      "interval-duration-seconds": expected.durationSeconds,
      "provider-unit": expected.providerUnit,
    }, expected.metric);
    assert.equal(content?.schema, "junction.interval_reading.v1", expected.metric);
    assert.equal(content?.startAt, expected.startAt, expected.metric);
    assert.equal(content?.endAt, expected.endAt, expected.metric);
    assert.equal(content?.durationSeconds, expected.durationSeconds, expected.metric);
    assert.equal(content?.value, expected.value, expected.metric);
  }
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction precise sparse windows retain intervals without publishing partial daily sums", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T10:00:00.000Z",
    timeseriesWindowKind: "precise",
    windowStart: "2026-04-22T08:00:00.000Z",
    windowEnd: "2026-04-22T10:00:00.000Z",
    timeseries: {
      water: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "water-record-precise-1",
              start: "2026-04-22T09:00:00.000Z",
              end: "2026-04-22T09:01:00.000Z",
              unit: "mL",
              value: 250,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
    },
  });

  const waterEvents = (payload.events ?? []).filter((event) =>
    readJunctionEventMeasurements(event).some((measurement) => measurement.metric === "water")
  );
  assert.equal(payload.provenance?.timeseriesWindowKind, "precise");
  assert.equal(waterEvents.length, 1);
  assert.equal(waterEvents[0]?.kind, "measurement");
  assert.equal(
    payload.events?.some((event) =>
      event.kind === "observation" && event.fields?.metric === "water"
    ),
    false,
  );
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "water").length, 0);
  assert.equal(findJunctionIntervalReadingArtifacts(payload, "water").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
});

test("Junction glucose fidelity distinguishes equal daily mean/min/max days with different shape", () => {
  const normalize = (samples: readonly { timestamp: string; value: number }[]) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: {
          groups: {
            dexcom: [{
              data: samples.map((sample) => ({ ...sample, unit: "mmol/L" })),
              source: { provider: "dexcom", type: "cgm" },
            }],
          },
        },
      },
    });
  const overnightShape = normalize([
    { timestamp: "2026-04-22T00:00:00Z", value: 3.5 },
    { timestamp: "2026-04-22T00:05:00Z", value: 7 },
    { timestamp: "2026-04-22T00:10:00Z", value: 7 },
    { timestamp: "2026-04-22T00:15:00Z", value: 10.5 },
  ]);
  const daytimeShape = normalize([
    { timestamp: "2026-04-22T12:00:00Z", value: 3.5 },
    { timestamp: "2026-04-22T12:05:00Z", value: 10.5 },
    { timestamp: "2026-04-22T12:10:00Z", value: 3.5 },
    { timestamp: "2026-04-22T12:15:00Z", value: 10.5 },
  ]);
  const dailyFacts = (payload: DeviceBatchImportPayload) =>
    (payload.events ?? [])
      .filter((event) =>
        event.kind === "observation"
        && event.fields?.observationGrain === "summary"
        && ["glucose", "lowest-glucose", "highest-glucose"].includes(String(event.fields.metric))
      )
      .map((event) => ({
        metric: event.fields?.metric,
        value: event.fields?.value,
        resourceId: event.externalRef?.resourceId,
      }))
      .sort((left, right) => String(left.metric).localeCompare(String(right.metric)));
  const featureContent = (payload: DeviceBatchImportPayload) =>
    findJunctionTimeseriesFeatureArtifacts(payload, "glucose")[0]?.content as {
      features?: Record<string, number>;
      hourlyBuckets?: unknown[];
    };
  const overnight = featureContent(overnightShape);
  const daytime = featureContent(daytimeShape);

  assert.deepEqual(dailyFacts(overnightShape), dailyFacts(daytimeShape));
  assert.equal(overnight.features?.observedInRangePercent, 50);
  assert.equal(daytime.features?.observedInRangePercent, 0);
  assert.equal(overnight.features?.estimatedBelowRangeMinutes, 5);
  assert.equal(overnight.features?.estimatedAboveRangeMinutes, 0);
  assert.equal(daytime.features?.estimatedBelowRangeMinutes, 10);
  assert.equal(daytime.features?.estimatedAboveRangeMinutes, 5);
  assert.equal(overnight.features?.estimatedTimeInRangePercent, 66.67);
  assert.equal(daytime.features?.estimatedTimeInRangePercent, 0);
  assert.notEqual(
    overnight.features?.coefficientOfVariationPercent,
    daytime.features?.coefficientOfVariationPercent,
  );
  assert.notEqual(
    overnight.features?.observedMaxRiseRate,
    daytime.features?.observedMaxRiseRate,
  );
  assert.equal(overnight.features?.ratePairCount, 3);
  assert.equal(daytime.features?.ratePairCount, 3);
  assert.ok((daytime.features?.observedMaxFallRate ?? 0) > 0);
  assert.equal(overnight.features?.excursionCount, 2);
  assert.equal(daytime.features?.excursionCount, 4);
  assert.equal(overnight.features?.overnightSampleCount, 4);
  assert.equal(daytime.features?.overnightSampleCount, 0);
  assert.notDeepEqual(overnight.hourlyBuckets, daytime.hourlyBuckets);
  const featureEvent = overnightShape.events?.find((event) =>
    event.kind === "measurement" && event.externalRef?.facet === "features"
  );
  const queryableMetric = readJunctionEventMeasurements(featureEvent).find((measurement) =>
    measurement.metric === "glucose-estimated-time-in-range-percent"
  );
  const queryableBelowRange = readJunctionEventMeasurements(featureEvent).find((measurement) =>
    measurement.metric === "glucose-estimated-time-below-range-minutes"
  );
  const queryableAboveRange = readJunctionEventMeasurements(featureEvent).find((measurement) =>
    measurement.metric === "glucose-estimated-time-above-range-minutes"
  );
  assert.equal(queryableMetric?.value, 66.67);
  assert.equal(queryableBelowRange?.value, 5);
  assert.equal(queryableAboveRange?.value, 0);
  assert.equal(
    (queryableMetric?.qualifiers as Record<string, unknown>)?.["feature-policy-version"],
    "junction.glucose_feature_envelope.v1",
  );
});

test("Junction blood oxygen fidelity separates an isolated low artifact from repeated lows", () => {
  const normalize = (samples: readonly { timestamp: string; value: number }[]) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        blood_oxygen: {
          groups: {
            garmin: [{
              data: samples.map((sample) => ({ ...sample, unit: "percent" })),
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    });
  const isolated = normalize([
    { timestamp: "2026-04-22T01:00:00Z", value: 88 },
    { timestamp: "2026-04-22T01:05:00Z", value: 97 },
  ]);
  const repeated = normalize([
    { timestamp: "2026-04-22T01:00:00Z", value: 88 },
    { timestamp: "2026-04-22T01:05:00Z", value: 87 },
    { timestamp: "2026-04-22T01:10:00Z", value: 91 },
    { timestamp: "2026-04-22T01:15:00Z", value: 97 },
    { timestamp: "2026-04-22T03:00:00Z", value: 89 },
    { timestamp: "2026-04-22T03:05:00Z", value: 88 },
  ]);
  const feature = (payload: DeviceBatchImportPayload) =>
    findJunctionTimeseriesFeatureArtifacts(payload, "blood-oxygen")[0]?.content as {
      episodes?: { totalCount?: number };
      features?: Record<string, number>;
    };

  assert.equal(feature(isolated).features?.below90ReadingCount, 1);
  assert.equal(feature(isolated).features?.below92ReadingCount, 1);
  assert.equal(feature(isolated).features?.below90EstimatedMinutes, 0);
  assert.equal(feature(isolated).features?.below92EstimatedMinutes, 0);
  assert.equal(feature(repeated).features?.below90ReadingCount, 4);
  assert.equal(feature(repeated).features?.below92ReadingCount, 5);
  assert.equal(feature(repeated).features?.below90EpisodeCount, 2);
  assert.equal(feature(repeated).features?.below92EpisodeCount, 2);
  assert.equal(feature(repeated).features?.below90EstimatedMinutes, 10);
  assert.equal(feature(repeated).features?.below92EstimatedMinutes, 15);
  assert.equal(feature(repeated).features?.longestBelow90EstimatedMinutes, 5);
  assert.equal(feature(repeated).features?.longestBelow92EstimatedMinutes, 10);
  assert.equal(feature(repeated).episodes?.totalCount, 2);
});

test("Junction dense feature buckets use the vault timezone for UTC timestamps", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [{ timestamp: "2026-04-22T00:05:00Z", unit: "mmol/L", value: 5.5 }],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  }, { defaultTimeZone: "America/New_York" });
  const artifact = findJunctionTimeseriesFeatureArtifacts(payload, "glucose")[0]?.content as {
    dayKey?: string;
    hourlyBuckets?: Array<unknown[] | null>;
  };

  assert.equal(artifact.dayKey, "2026-04-21");
  assert.equal(artifact.hourlyBuckets?.[20]?.[0], 1);
  assert.equal(artifact.hourlyBuckets?.[0], null);
});

test("Junction dense feature envelopes retain coverage-only hourly buckets", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [
              { timestamp: "2026-04-22T00:59:00Z", unit: "mmol/L", value: 5.5 },
              { timestamp: "2026-04-22T02:00:00Z", unit: "mmol/L", value: 6 },
            ],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });
  const artifact = findJunctionTimeseriesFeatureArtifacts(payload, "glucose")[0]?.content as {
    hourlyBuckets?: Array<Array<number | null> | null>;
  };

  assert.deepEqual(artifact.hourlyBuckets?.[1]?.slice(0, 5), [0, null, null, null, 14]);
});

test("Junction stress fidelity preserves episode, recovery, and time-of-day differences", () => {
  const normalize = (samples: readonly { timestamp: string; value: number }[]) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        stress_level: {
          groups: {
            garmin: [{
              data: samples.map((sample) => ({ ...sample, unit: "score" })),
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    });
  const morning = normalize([
    { timestamp: "2026-04-22T08:00:00Z", value: 70 },
    { timestamp: "2026-04-22T08:10:00Z", value: 75 },
    { timestamp: "2026-04-22T08:20:00Z", value: 35 },
  ]);
  const evening = normalize([
    { timestamp: "2026-04-22T18:00:00Z", value: 70 },
    { timestamp: "2026-04-22T18:10:00Z", value: 75 },
    { timestamp: "2026-04-22T18:20:00Z", value: 35 },
    { timestamp: "2026-04-22T21:00:00Z", value: 80 },
    { timestamp: "2026-04-22T21:05:00Z", value: 85 },
    { timestamp: "2026-04-22T21:15:00Z", value: 30 },
  ]);
  const feature = (payload: DeviceBatchImportPayload) =>
    findJunctionTimeseriesFeatureArtifacts(payload, "stress-level")[0]?.content as {
      features?: Record<string, number>;
      hourlyBuckets?: unknown[];
    };

  assert.equal(feature(morning).features?.elevatedEpisodeCount, 1);
  assert.equal(feature(morning).features?.peakLocalHour, 8);
  assert.equal(feature(morning).features?.medianObservedRecoveryLatencyMinutes, 10);
  assert.equal(feature(evening).features?.elevatedEpisodeCount, 2);
  assert.equal(feature(evening).features?.peakLocalHour, 21);
  assert.equal(feature(evening).features?.medianObservedRecoveryLatencyMinutes, 10);
  assert.ok((feature(evening).features?.eveningAverage ?? 0) > 0);
  assert.notDeepEqual(feature(morning).hourlyBuckets, feature(evening).hourlyBuckets);
});

test("Junction timeseries fidelity deduplicates exact provider records before aggregation", () => {
  const glucose = { timestamp: "2026-04-22T08:00:00Z", unit: "mmol/L", value: 5.5 };
  const water = {
    id: "water-record-1",
    start: "2026-04-22T09:00:00Z",
    end: "2026-04-22T09:01:00Z",
    unit: "mL",
    value: 250,
  };
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [glucose, { ...glucose }],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
      water: {
        groups: {
          apple_health_kit: [{
            data: [water, { ...water }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      },
    },
  });
  const glucoseDaily = findJunctionCompactTimeseriesArtifacts(payload, "glucose")[0]?.content as
    Record<string, unknown>;
  const glucoseFeature = findJunctionTimeseriesFeatureArtifacts(payload, "glucose")[0]?.content as
    Record<string, unknown>;
  const waterDaily = findJunctionCompactTimeseriesArtifacts(payload, "water")[0]?.content as
    Record<string, unknown>;
  const waterEvents = (payload.events ?? []).filter((event) =>
    event.kind === "measurement"
    && readJunctionEventMeasurements(event).some((measurement) => measurement.metric === "water")
  );

  assert.equal(glucoseDaily.sampleCount, 1);
  assert.equal(glucoseDaily.duplicateSampleCount, 1);
  assert.equal(glucoseFeature.sampleCount, 1);
  assert.equal(glucoseFeature.duplicateSampleCount, 1);
  assert.equal(waterDaily.sampleCount, 1);
  assert.equal(waterDaily.meanValue, 250);
  assert.equal(waterDaily.duplicateSampleCount, 1);
  assert.equal(waterEvents.length, 1);
  assert.equal(findJunctionIntervalReadingArtifacts(payload, "water").length, 1);
});

test("Junction sparse interval revisions keep the daily sum aligned with the timed event", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      water: {
        groups: {
          garmin: [{
            data: [
              {
                id: "water-record-1",
                start: "2026-04-22T09:00:00Z",
                end: "2026-04-22T09:01:00Z",
                recordedAt: "2026-04-22T10:00:00Z",
                unit: "mL",
                value: 250,
              },
              {
                id: "water-record-1",
                start: "2026-04-22T09:00:00Z",
                end: "2026-04-22T09:02:00Z",
                recordedAt: "2026-04-22T11:00:00Z",
                unit: "mL",
                value: 300,
              },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });
  const daily = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "water"
  );
  const timed = payload.events?.find((event) =>
    event.kind === "measurement"
    && readJunctionEventMeasurements(event).some((measurement) => measurement.metric === "water")
  );
  const dailyArtifact = findJunctionCompactTimeseriesArtifacts(payload, "water")[0]?.content as
    Record<string, unknown>;

  assert.equal(readJunctionEventMeasurements(timed)[0]?.value, 300);
  assert.equal(daily?.fields?.value, 300);
  assert.equal(dailyArtifact.sampleCount, 1);
  assert.equal(dailyArtifact.meanValue, 300);
  assert.equal(findJunctionIntervalReadingArtifacts(payload, "water").length, 1);
  assert.equal(daily?.externalRef?.version, undefined);
  assert.equal(daily?.externalRefUpdatePolicy, undefined);
  assert.equal(timed?.externalRef?.version, "2026-04-22T11:00:00.000Z");
  assert.equal(timed?.externalRefUpdatePolicy, undefined);
});

test("Junction sparse intervals keep start-day ownership across local midnight", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      mindfulness_minutes: {
        groups: {
          apple_health_kit: [{
            data: [{
              id: "mindfulness-cross-midnight-1",
              start: "2026-04-22T23:55:00-04:00",
              end: "2026-04-23T00:05:00-04:00",
              unit: "min",
              value: 10,
            }],
            source: { provider: "apple_health_kit", type: "watch" },
          }],
        },
      },
    },
  });
  const daily = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "mindfulness-minutes"
  );
  const timed = payload.events?.find((event) =>
    event.kind === "measurement"
    && readJunctionEventMeasurements(event).some((measurement) =>
      measurement.metric === "mindfulness-minutes"
    )
  );
  const dailyArtifact = findJunctionCompactTimeseriesArtifacts(payload, "mindfulness-minutes")[0]
    ?.content as Record<string, unknown> | undefined;

  assert.equal(readJunctionEventMeasurements(timed)[0]?.value, 10);
  assert.equal(timed?.dayKey, "2026-04-22");
  assert.equal(daily?.fields?.value, 10);
  assert.equal(daily?.dayKey, "2026-04-22");
  assert.equal(dailyArtifact?.dayKey, "2026-04-22");
  assert.equal(dailyArtifact?.sampleCount, 1);
});

test("Junction dense stable-ID revisions select one newest reading per payload", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data: [
              {
                id: "glucose-record-1",
                timestamp: "2026-04-22T08:00:00Z",
                recordedAt: "2026-04-22T09:00:00Z",
                unit: "mmol/L",
                value: 5,
              },
              {
                id: "glucose-record-1",
                timestamp: "2026-04-22T08:00:00Z",
                recordedAt: "2026-04-22T10:00:00Z",
                unit: "mmol/L",
                value: 7,
              },
            ],
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });
  const daily = payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "glucose"
  );
  const dailyArtifact = findJunctionCompactTimeseriesArtifacts(payload, "glucose")[0]?.content as
    Record<string, unknown>;
  const featureArtifact = findJunctionTimeseriesFeatureArtifacts(payload, "glucose")[0]?.content as
    Record<string, unknown>;
  const featureEvent = payload.events?.find((event) => event.externalRef?.facet === "features");

  assert.equal(daily?.fields?.value, 126.1274);
  assert.equal(dailyArtifact.sampleCount, 1);
  assert.equal(dailyArtifact.meanValue, 126.1274);
  assert.equal(featureArtifact.sampleCount, 1);
  assert.equal(daily?.externalRef?.version, undefined);
  assert.equal(daily?.externalRefUpdatePolicy, undefined);
  assert.equal(featureEvent?.externalRef?.version, undefined);
  assert.equal(featureEvent?.externalRefUpdatePolicy, undefined);
});

test("Junction stable-ID fidelity conflicts without an authoritative revision fail closed", () => {
  const cases = [
    {
      resource: "glucose",
      records: [
        { id: "shared-reading", timestamp: "2026-04-22T08:00:00Z", unit: "mmol/L", value: 5 },
        { id: "shared-reading", timestamp: "2026-04-22T08:00:00Z", unit: "mmol/L", value: 7 },
      ],
    },
    {
      resource: "water",
      records: [
        {
          id: "shared-reading",
          start: "2026-04-22T08:00:00Z",
          end: "2026-04-22T08:01:00Z",
          unit: "mL",
          value: 250,
        },
        {
          id: "shared-reading",
          start: "2026-04-22T08:00:00Z",
          end: "2026-04-22T08:02:00Z",
          unit: "mL",
          value: 300,
        },
      ],
    },
  ] as const;

  for (const testCase of cases) {
    for (const records of [testCase.records, [...testCase.records].reverse()]) {
      assert.throws(
        () => normalizeJunctionSnapshot({
          importedAt: "2026-04-23T12:00:00.000Z",
          timeseries: {
            [testCase.resource]: {
              groups: {
                garmin: [{
                  data: records,
                  source: { provider: "garmin", type: "watch" },
                }],
              },
            },
          },
        }),
        new RegExp(
          `Junction ${testCase.resource} stable-id records with different bodies require distinct explicit provider revisions`,
          "u",
        ),
      );
    }
  }
});

test("Junction stable-ID fidelity conflicts at one provider revision fail closed", () => {
  assert.throws(
    () => normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: {
          groups: {
            dexcom: [{
              data: [
                {
                  id: "shared-reading",
                  timestamp: "2026-04-22T08:00:00Z",
                  updatedAt: "2026-04-22T10:00:00Z",
                  unit: "mmol/L",
                  value: 5,
                },
                {
                  id: "shared-reading",
                  timestamp: "2026-04-22T08:00:00Z",
                  updatedAt: "2026-04-22T10:00:00Z",
                  unit: "mmol/L",
                  value: 7,
                },
              ],
              source: { provider: "dexcom", type: "cgm" },
            }],
          },
        },
      },
    }),
    /different bodies require distinct explicit provider revisions/u,
  );
});

test("Junction sparse stable-ID equality includes provider-day metadata", () => {
  const representations = [
    {
      id: "shared-offset-reading",
      start: "2026-04-22T23:30:00-04:00",
      end: "2026-04-22T23:31:00-04:00",
      timezone_offset: -14_400,
      unit: "mL",
      value: 250,
    },
    {
      id: "shared-offset-reading",
      start: "2026-04-23T03:30:00Z",
      end: "2026-04-23T03:31:00Z",
      unit: "mL",
      value: 250,
    },
  ];

  for (const sourceVersion of [undefined, "2026-04-23T04:00:00Z"]) {
    const versionedRepresentations = representations.map((representation) => ({
      ...representation,
      updatedAt: sourceVersion,
    }));
    for (const records of [versionedRepresentations, [...versionedRepresentations].reverse()]) {
      assert.throws(
        () => normalizeJunctionSnapshot({
          importedAt: "2026-04-24T12:00:00.000Z",
          timeseries: {
            water: {
              groups: {
                garmin: [{
                  data: records,
                  source: { provider: "garmin", type: "watch" },
                }],
              },
            },
          },
        }),
        /Junction water stable-id records with different bodies require distinct explicit provider revisions/u,
      );
    }
  }
});

test("Junction sparse stable-ID revisions select newer provider-day metadata in either order", () => {
  const olderOffsetBody = {
    id: "shared-offset-revision",
    start: "2026-04-22T23:30:00-04:00",
    end: "2026-04-22T23:31:00-04:00",
    timezone_offset: -14_400,
    updatedAt: "2026-04-23T04:00:00Z",
    unit: "mL",
    value: 250,
  };
  const newerUtcBody = {
    id: "shared-offset-revision",
    start: "2026-04-23T03:30:00Z",
    end: "2026-04-23T03:31:00Z",
    updatedAt: "2026-04-23T05:00:00Z",
    unit: "mL",
    value: 250,
  };

  for (const records of [
    [olderOffsetBody, newerUtcBody],
    [newerUtcBody, olderOffsetBody],
  ]) {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-04-24T12:00:00.000Z",
      timeseries: {
        water: {
          groups: {
            garmin: [{
              data: records,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    });
    const timed = payload.events?.find((event) =>
      event.kind === "measurement"
      && readJunctionEventMeasurements(event).some((measurement) => measurement.metric === "water")
    );

    assert.equal(timed?.dayKey, "2026-04-23");
    assert.equal(timed?.dataOrigin?.observedAtRaw, "2026-04-23T03:30:00Z");
    assert.equal(timed?.dataOrigin?.timestampSemantics, "utc");
    assert.equal(timed?.externalRef?.version, "2026-04-23T05:00:00.000Z");
  }
});

test("Junction sparse cross-day revisions report both affected provider days", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-sparse-cross-day-revision");
  const snapshotFor = (input: {
    end: string;
    importedAt: string;
    start: string;
    updatedAt: string;
  }) => ({
    accountId: "junction-account-sparse-cross-day-revision",
    importedAt: input.importedAt,
    timeseriesWindowKind: "precise" as const,
    timeseries: {
      water: {
        groups: {
          garmin: [{
            data: [{
              id: "water-cross-day-revision",
              start: input.start,
              end: input.end,
              updatedAt: input.updatedAt,
              unit: "mL",
              value: 250,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-20T00:00:00.000Z",
      vaultRoot,
    });
    await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshotFor({
          start: "2026-04-21T23:30:00Z",
          end: "2026-04-21T23:31:00Z",
          updatedAt: "2026-04-22T01:00:00Z",
          importedAt: "2026-04-22T12:00:00Z",
        }),
      },
      { corePort: coreRuntime },
    );
    const correctionSnapshot = snapshotFor({
      start: "2026-04-22T00:30:00Z",
      end: "2026-04-22T00:31:00Z",
      updatedAt: "2026-04-22T02:00:00Z",
      importedAt: "2026-04-22T13:00:00Z",
    });
    const correction = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      {
        provider: "junction",
        vaultRoot,
        snapshot: correctionSnapshot,
      },
      { corePort: coreRuntime },
    );
    const retry = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: correctionSnapshot },
      { corePort: coreRuntime },
    );

    for (const result of [correction, retry]) {
      assert.deepEqual(result.affectedEventDayKeys, ["2026-04-21", "2026-04-22"]);
    }
    assert.equal(correction.events[0]?.dayKey, "2026-04-22");
    assert.equal(retry.applied, false);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction projected account source identity keeps revisions on one sparse spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-account-source-alias-revision");
  const sourceInstanceId = "source-aaaaaaaaaaaaaaaaaaaaaaaa";
  const snapshotFor = (input: {
    dayKey: string;
    importedAt: string;
    updatedAt: string;
    value: number;
  }) => ({
    accountId: "junction-account-source-alias-revision",
    importedAt: input.importedAt,
    timeseriesWindowKind: "precise" as const,
    timeseries: {
      water: [{
        calendarDate: input.dayKey,
        end: `${input.dayKey}T08:01:00.000Z`,
        id: "water-account-source-alias-revision",
        sourceInstanceId,
        sourceProviderSlug: "apple_health_kit",
        sourceType: "phone",
        start: `${input.dayKey}T08:00:00.000Z`,
        updatedAt: input.updatedAt,
        value: input.value,
      }],
    },
  });

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-20T00:00:00.000Z",
      vaultRoot,
    });
    const first = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >({
      provider: "junction",
      vaultRoot,
      snapshot: snapshotFor({
        dayKey: "2026-04-21",
        importedAt: "2026-04-22T12:00:00.000Z",
        updatedAt: "2026-04-22T08:00:00.000Z",
        value: 250,
      }),
    }, { corePort: coreRuntime });
    const correction = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >({
      provider: "junction",
      vaultRoot,
      snapshot: snapshotFor({
        dayKey: "2026-04-22",
        importedAt: "2026-04-23T12:00:00.000Z",
        updatedAt: "2026-04-23T08:00:00.000Z",
        value: 300,
      }),
    }, { corePort: coreRuntime });
    const staleReplay = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >({
      provider: "junction",
      vaultRoot,
      snapshot: snapshotFor({
        dayKey: "2026-04-21",
        importedAt: "2026-04-24T12:00:00.000Z",
        updatedAt: "2026-04-22T08:00:00.000Z",
        value: 250,
      }),
    }, { corePort: coreRuntime });

    assert.equal(first.events[0]?.id, correction.events[0]?.id);
    assert.equal(correction.events[0]?.lifecycle?.revision, 2);
    assert.deepEqual(correction.affectedEventDayKeys, ["2026-04-21", "2026-04-22"]);
    assert.deepEqual(correction.affectedSparseCalendarTargets?.map((target) => target.dayKey), [
      "2026-04-21",
      "2026-04-22",
    ]);
    assert.equal(staleReplay.applied, false);
    assert.equal(staleReplay.affectedSparseCalendarTargets, undefined);

    const records = latestLiveRecords((await Promise.all(
      [...new Set([...first.eventShardPaths, ...correction.eventShardPaths])].map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ),
    )).flat()).filter((record) =>
      record.kind === "measurement"
      && typeof record.externalRef === "object"
      && record.externalRef !== null
      && !Array.isArray(record.externalRef)
      && record.externalRef.facet === "interval"
    );
    assert.equal(records.length, 1);
    assert.equal(records[0]?.dayKey, "2026-04-22");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction routine calendar and corrected interval converge on one persisted source spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-shared-writer-source-identity");
  const sourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: "jxn_src_hosted_connection_apple_health",
    sourceProviderSlug: "apple_health",
  }).sourceInstanceId;
  assert.ok(sourceInstanceId);
  const accountId = "junction-account-shared-writer-source-identity";
  const recordFor = (input: {
    dayKey: string;
    updatedAt: string;
    value: number;
  }) => ({
    calendarDate: input.dayKey,
    end: `${input.dayKey}T08:01:00.000Z`,
    id: "water-shared-writer-source-identity",
    sourceInstanceId,
    sourceProviderSlug: "apple_health",
    sourceType: "phone",
    start: `${input.dayKey}T08:00:00.000Z`,
    updatedAt: input.updatedAt,
    value: input.value,
  });
  const importSnapshot = (snapshot: Record<string, unknown>) =>
    importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-20T00:00:00.000Z",
      vaultRoot,
    });
    const routine = await importSnapshot({
      accountId,
      importedAt: "2026-04-22T12:00:00.000Z",
      timeseriesWindowKind: "calendar_day",
      windowStart: "2026-04-21T00:00:00.000Z",
      windowEnd: "2026-04-22T00:00:00.000Z",
      timeseries: {
        water: [recordFor({
          dayKey: "2026-04-21",
          updatedAt: "2026-04-22T08:00:00.000Z",
          value: 250,
        })],
      },
    });
    const correctionSnapshot = {
      accountId,
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseriesWindowKind: "precise",
      timeseries: {
        water: [recordFor({
          dayKey: "2026-04-22",
          updatedAt: "2026-04-23T08:00:00.000Z",
          value: 300,
        })],
      },
    };
    const correction = await importSnapshot(correctionSnapshot);
    const repairedD1 = await importSnapshot({
      accountId,
      importedAt: "2026-04-23T13:00:00.000Z",
      timeseriesWindowKind: "calendar_day",
      windowStart: "2026-04-21T00:00:00.000Z",
      windowEnd: "2026-04-22T00:00:00.000Z",
      timeseries: {
        water: [{
          authoritativeEmptyCalendarSet: true,
          calendarDate: "2026-04-21",
          date: "2026-04-21",
          sourceInstanceId,
          sourceProviderSlug: "apple_health",
          sourceType: "phone",
          value: 0,
        }],
      },
    });
    const repairedD2 = await importSnapshot({
      accountId,
      importedAt: "2026-04-23T13:01:00.000Z",
      timeseriesWindowKind: "calendar_day",
      windowStart: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-23T00:00:00.000Z",
      timeseries: { water: correctionSnapshot.timeseries.water },
    });
    const staleReplay = await importSnapshot({
      accountId,
      importedAt: "2026-04-24T12:00:00.000Z",
      timeseriesWindowKind: "precise",
      timeseries: {
        water: [recordFor({
          dayKey: "2026-04-21",
          updatedAt: "2026-04-22T08:00:00.000Z",
          value: 250,
        })],
      },
    });

    const routineDaily = routine.events.find((event) =>
      event.kind === "observation"
      && event.metric === "water"
    );
    const repairedD1Daily = repairedD1.events.find((event) =>
      event.kind === "observation"
      && event.metric === "water"
    );
    assert.ok(routineDaily);
    assert.ok(repairedD1Daily);
    assert.equal(repairedD1Daily?.id, routineDaily?.id);
    assert.equal(
      repairedD1Daily?.kind === "observation" ? repairedD1Daily.value : undefined,
      0,
    );
    assert.deepEqual(correction.affectedEventDayKeys, ["2026-04-21", "2026-04-22"]);
    assert.equal(staleReplay.applied, false);
    assert.equal(staleReplay.affectedSparseCalendarTargets, undefined);

    const allRecords = (await Promise.all(
      [...new Set([
        ...routine.eventShardPaths,
        ...correction.eventShardPaths,
        ...repairedD1.eventShardPaths,
        ...repairedD2.eventShardPaths,
      ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
    )).flat();
    const live = latestLiveRecords(allRecords);
    const liveIntervals = live.filter((record) =>
      record.kind === "measurement"
      && typeof record.externalRef === "object"
      && record.externalRef !== null
      && !Array.isArray(record.externalRef)
      && record.externalRef.facet === "interval"
    );
    const liveDaily = live.filter((record) =>
      record.kind === "observation"
      && record.metric === "water"
    );
    assert.equal(liveIntervals.length, 1);
    assert.equal(liveIntervals[0]?.dayKey, "2026-04-22");
    assert.equal(liveDaily.length, 2);
    assert.equal(
      live.every((record) => storedSourceInstanceId(record) === sourceInstanceId),
      true,
    );
    assert.deepEqual(
      liveDaily.map((record) => [record.dayKey, storedObservationValue(record)]).sort(),
      [["2026-04-21", 0], ["2026-04-22", 300]],
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction authoritative empty sparse days clear the prior retained daily sum", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-empty-sparse-calendar-day");
  const snapshotFor = (records: readonly Record<string, unknown>[], importedAt: string) => ({
    accountId: "junction-account-empty-sparse-calendar-day",
    importedAt,
    timeseriesWindowKind: "calendar_day" as const,
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-23T00:00:00.000Z",
    timeseries: { water: records },
  });

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-20T00:00:00.000Z",
      vaultRoot,
    });
    const populated = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshotFor([{
          calendarDate: "2026-04-22",
          date: "2026-04-22",
          end: "2026-04-22T08:01:00.000Z",
          id: "water-empty-day-baseline",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          start: "2026-04-22T08:00:00.000Z",
          value: 250,
        }], "2026-04-23T12:00:00.000Z"),
      },
      { corePort: coreRuntime },
    );
    const cleared = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshotFor([{
          authoritativeEmptyCalendarSet: true,
          calendarDate: "2026-04-22",
          date: "2026-04-22",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          value: 0,
        }], "2026-04-23T13:00:00.000Z"),
      },
      { corePort: coreRuntime },
    );

    const populatedWater = populated.events.find((event) =>
      event.kind === "observation" && event.metric === "water"
    );
    const clearedWater = cleared.events.find((event) =>
      event.kind === "observation" && event.metric === "water"
    );
    assert.equal(
      populatedWater?.kind === "observation" ? populatedWater.value : undefined,
      250,
    );
    assert.equal(
      clearedWater?.kind === "observation" ? clearedWater.value : undefined,
      0,
    );
    assert.equal(clearedWater?.id, populatedWater?.id);
    const preparedEmpty = normalizeJunctionSnapshot(snapshotFor([{
      authoritativeEmptyCalendarSet: true,
      calendarDate: "2026-04-22",
      date: "2026-04-22",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      value: 0,
    }], "2026-04-23T13:00:00.000Z"));
    assert.ok(preparedEmpty.evidenceParts?.some((part) => {
      const content = part.content;
      return typeof content === "object"
        && content !== null
        && "status" in content
        && content.status === "authoritative_empty_calendar_set"
        && "sampleCount" in content
        && content.sampleCount === 0;
    }));
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction strict sparse calendar repairs reject mixed valid and malformed rows before import", async () => {
  const baseSnapshot = {
    accountId: "junction-account-strict-sparse-calendar-day",
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseriesWindowKind: "calendar_day" as const,
    strictSparseCalendarRepair: {
      dayKey: "2026-04-22",
      resource: "water" as const,
      sourceProviderSlug: "garmin",
      sourceType: "watch",
    },
    windowStart: "2026-04-22T00:00:00.000Z",
    windowEnd: "2026-04-23T00:00:00.000Z",
  };
  const valid = {
    calendarDate: "2026-04-22",
    end: "2026-04-22T08:01:00.000Z",
    id: "water-strict-valid",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    start: "2026-04-22T08:00:00.000Z",
    value: 250,
  };

  assert.throws(
    () => normalizeJunctionSnapshot({
      ...baseSnapshot,
      timeseries: {
        water: [valid, {
          ...valid,
          id: "water-strict-malformed",
          start: undefined,
        }],
      },
    }),
    (error: unknown) =>
      error instanceof JunctionSparseCalendarRepairNormalizationError
      && error.code === "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION"
      && error.retryable,
  );
  await assert.rejects(
    prepareDeviceProviderSnapshotImport({
      provider: "junction",
      vaultRoot: "/tmp/unused-strict-calendar-repair",
      snapshot: {
        ...baseSnapshot,
        timeseries: {
          water: [valid, {
            ...valid,
            id: "water-strict-malformed-before-core",
            value: "not-a-number",
          }],
        },
      },
    }),
    JunctionSparseCalendarRepairNormalizationError,
  );

  const complete = normalizeJunctionSnapshot({
    ...baseSnapshot,
    timeseries: {
      water: [valid, {
        ...valid,
        end: "2026-04-22T09:01:00.000Z",
        id: "water-strict-second-valid",
        start: "2026-04-22T09:00:00.000Z",
        value: 125,
      }],
    },
  });
  const daily = complete.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === "water"
  );
  assert.equal(daily?.fields && "value" in daily.fields ? daily.fields.value : undefined, 375);

  assert.doesNotThrow(() => normalizeJunctionSnapshot({
    ...baseSnapshot,
    timeseries: {
      water: [{
        authoritativeEmptyCalendarSet: true,
        calendarDate: "2026-04-22",
        date: "2026-04-22",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        value: 0,
      }],
    },
  }));
});

test("Junction unversioned calendar aggregates reconcile through the serialized event spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-unversioned-fidelity-correction");
  const inputFor = (value: number) => ({
    provider: "junction" as const,
    vaultRoot,
    snapshot: {
      accountId: "junction-account-unversioned-fidelity",
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: {
          groups: {
            dexcom: [{
              data: [
                {
                  id: "glucose-reading-1",
                  timestamp: "2026-04-22T08:00:00Z",
                  unit: "mmol/L",
                  value,
                },
                {
                  id: "glucose-reading-2",
                  timestamp: "2026-04-22T08:05:00Z",
                  unit: "mmol/L",
                  value: 10,
                },
              ],
              source: { provider: "dexcom", type: "cgm" },
            }],
          },
        },
      },
    },
  });

  try {
    await coreRuntime.initializeVault({
      createdAt: "2026-04-22T00:00:00.000Z",
      vaultRoot,
    });
    await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      inputFor(5),
      { corePort: coreRuntime },
    );
    const correction = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      inputFor(7),
      { corePort: coreRuntime },
    );
    assert.equal(correction.applied, true);
    assert.equal(
      correction.events.some((event) =>
        event.kind === "observation"
        && event.metric === "glucose"
        && event.value === 153.1547
      ),
      true,
    );
    assert.equal(
      correction.events.some((event) =>
        event.kind === "measurement" && event.externalRef?.facet === "features"
      ),
      true,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction fidelity value aliases preserve temporal shape through normalization", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_oxygen: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T08:00:00Z", oxygenSaturation: 0.91 },
              { timestamp: "2026-04-22T08:05:00Z", oxygen_saturation: 0.97 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T09:00:00Z", averageStressLevel: 50 },
              { timestamp: "2026-04-22T09:05:00Z", stressLevelValue: 80 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
      mindfulness_minutes: {
        groups: {
          garmin: [{
            data: [{
              start: "2026-04-22T10:00:00Z",
              end: "2026-04-22T10:05:00Z",
              mindfulnessMinutes: 5,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  });

  const dailyValue = (metric: string): unknown => payload.events?.find((event) =>
    event.kind === "observation" && event.fields?.metric === metric
  )?.fields?.value;
  assert.equal(dailyValue("spo2"), 94);
  assert.equal(dailyValue("stress-level"), 65);
  assert.equal(dailyValue("mindfulness-minutes"), 5);
  assert.equal(findJunctionTimeseriesFeatureArtifacts(payload, "blood-oxygen").length, 1);
  assert.equal(findJunctionTimeseriesFeatureArtifacts(payload, "stress-level").length, 1);
  assert.equal(findJunctionIntervalReadingArtifacts(payload, "mindfulness-minutes").length, 1);
});

test("Junction dense feature corrections revise one event instead of leaving optional facts stale", () => {
  const normalize = (data: readonly Record<string, unknown>[]) => normalizeJunctionSnapshot({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      glucose: {
        groups: {
          dexcom: [{
            data,
            source: { provider: "dexcom", type: "cgm" },
          }],
        },
      },
    },
  });
  const rich = normalize([
    { timestamp: "2026-04-22T12:00:00Z", unit: "mmol/L", value: 5 },
    { timestamp: "2026-04-22T12:05:00Z", unit: "mmol/L", value: 7 },
  ]);
  const corrected = normalize([
    { timestamp: "2026-04-22T12:00:00Z", unit: "mmol/L", value: 5 },
  ]);
  const featureEvent = (payload: DeviceBatchImportPayload) => payload.events?.find((event) =>
    event.kind === "measurement" && event.externalRef?.facet === "features"
  );
  const metrics = (payload: DeviceBatchImportPayload) => readJunctionEventMeasurements(featureEvent(payload))
    .map((measurement) => measurement.metric);

  assert.deepEqual(featureEvent(rich)?.externalRef, featureEvent(corrected)?.externalRef);
  assert.ok(metrics(rich).includes("glucose-estimated-time-in-range-percent"));
  assert.ok(metrics(rich).includes("glucose-observed-max-rise-rate"));
  assert.equal(metrics(corrected).includes("glucose-estimated-time-in-range-percent"), false);
  assert.equal(metrics(corrected).includes("glucose-observed-max-rise-rate"), false);
});

test("Junction timeseries fidelity caps episode evidence deterministically", () => {
  const records = Array.from({ length: 14 }, (_, index) => {
    const lowAt = Date.UTC(2026, 3, 22, 0, index * 30);
    return [
      { timestamp: new Date(lowAt).toISOString(), unit: "percent", value: 88 },
      { timestamp: new Date(lowAt + 5 * 60_000).toISOString(), unit: "percent", value: 97 },
    ];
  }).flat();
  const normalize = (data: readonly Record<string, unknown>[]) =>
    normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        blood_oxygen: {
          groups: {
            garmin: [{
              data,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    });
  const forward = findJunctionTimeseriesFeatureArtifacts(normalize(records), "blood-oxygen")[0]?.content as {
    episodes?: { retainedCount?: number; retained?: unknown[]; totalCount?: number; truncatedCount?: number };
  };
  const reversed = findJunctionTimeseriesFeatureArtifacts(normalize([...records].reverse()), "blood-oxygen")[0]
    ?.content as typeof forward;

  assert.equal(forward.episodes?.totalCount, 14);
  assert.equal(forward.episodes?.retainedCount, 12);
  assert.equal(forward.episodes?.truncatedCount, 2);
  assert.deepEqual(forward, reversed);
});

test("Junction timeseries fidelity fails closed at explicit response and source/day bounds", () => {
  const tooManyGlucose = Array.from({ length: 1_441 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 22, 0, 0, index)).toISOString(),
    unit: "mmol/L",
    value: 5.5,
  }));
  assert.throws(
    () => normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: {
          groups: {
            dexcom: [{
              data: tooManyGlucose,
              source: { provider: "dexcom", type: "cgm" },
            }],
          },
        },
      },
    }),
    /source\/day has 1441 records; maximum admitted is 1440/u,
  );

  const tooManyWaterIntervals = Array.from({ length: 129 }, (_, index) => {
    const startMs = Date.UTC(2026, 3, 22, 8, 0, index);
    return {
      id: `water-record-${index}`,
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + 30_000).toISOString(),
      unit: "mL",
      value: 1,
    };
  });
  assert.throws(
    () => normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        water: {
          groups: {
            apple_health_kit: [{
              data: tooManyWaterIntervals,
              source: { provider: "apple_health_kit", type: "phone" },
            }],
          },
        },
      },
    }),
    /source\/day has 129 records; maximum admitted is 128/u,
  );

  const oversizedResponse = Array.from({ length: 2_049 }, (_, index) => ({
    id: `water-response-record-${index}`,
    start: new Date(Date.UTC(2020, 0, 1 + index, 8)).toISOString(),
    end: new Date(Date.UTC(2020, 0, 1 + index, 8, 1)).toISOString(),
    unit: "mL",
    value: 1,
  }));
  assert.throws(
    () => normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        water: {
          groups: {
            apple_health_kit: [{
              data: oversizedResponse,
              source: { provider: "apple_health_kit", type: "phone" },
            }],
          },
        },
      },
    }),
    /response has 2049 records; maximum admitted is 2048/u,
  );
});

test("Junction timeseries fidelity fails closed at the normalized output bound", () => {
  const glucose = Array.from({ length: 2_501 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2018, 0, 1 + index, 8)).toISOString(),
    unit: "mmol/L",
    value: 5.5,
  }));

  assert.throws(
    () => normalizeJunctionSnapshot({
      importedAt: "2026-04-23T12:00:00.000Z",
      timeseries: {
        glucose: {
          groups: {
            dexcom: [{
              data: glucose,
              source: { provider: "dexcom", type: "cgm" },
            }],
          },
        },
      },
    }),
    /normalization produced 10004 events; maximum admitted is 10000/u,
  );
  assert.throws(
    () => assertJunctionTimeseriesOutputBounds({
      eventCount: 10_000,
      evidencePartCount: 10_001,
    }),
    /normalization produced 10001 evidence parts; maximum admitted is 10000/u,
  );
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

test("Junction normalizer lands note tags on one neutral, revision-stable spine", async () => {
  const snapshot = (entries: readonly Record<string, unknown>[]) => ({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      note: {
        groups: {
          oura: [{
            data: entries,
            source: { provider: "oura", type: "ring" },
          }],
        },
      },
    },
  });
  const initialSnapshot = snapshot([
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
  ]);
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn-junction-oura",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: initialSnapshot,
  });
  const noteEvents = (payload.events ?? []).filter((event) => event.kind === "note");
  const changed = normalizeJunctionSnapshot(snapshot([{
    start: "2026-04-22T18:05:00+02:00",
    end: "2026-04-22T18:10:00+02:00",
    tags: ["Headache"],
    value: "SENSITIVE_VALUE_SENTINEL_C",
  }]));
  const cleared = normalizeJunctionSnapshot(snapshot([{
    start: "2026-04-22T18:05:00+02:00",
    end: "2026-04-22T18:10:00+02:00",
    tags: [],
    value: "SENSITIVE_VALUE_SENTINEL_D",
  }]));
  const missingTags = normalizeJunctionSnapshot(snapshot([{
    start: "2026-04-22T18:05:00+02:00",
    end: "2026-04-22T18:10:00+02:00",
    value: "SENSITIVE_VALUE_SENTINEL_E",
  }]));
  const stableInitial = normalizeJunctionSnapshot(snapshot([{
    id: "provider-note-1",
    start: "2026-04-22T18:05:00+02:00",
    tags: ["Sauna"],
    value: "SENSITIVE_VALUE_SENTINEL_F",
  }]));
  const stableChanged = normalizeJunctionSnapshot(snapshot([{
    id: "provider-note-1",
    start: "2026-04-22T19:05:00+02:00",
    tags: ["Headache"],
    value: "SENSITIVE_VALUE_SENTINEL_G",
  }]));
  const changedNote = changed.events?.find((event) => event.kind === "note");
  const clearedNote = cleared.events?.find((event) => event.kind === "note");
  const stableInitialNote = stableInitial.events?.find((event) => event.kind === "note");
  const stableChangedNote = stableChanged.events?.find((event) => event.kind === "note");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["note"]);
  assert.equal(noteEvents.length, 1);
  assert.equal((payload.events ?? []).some((event) => event.kind === "intervention_session"), false);
  assert.equal(noteEvents[0]?.fields?.noteType, JUNCTION_WEARABLE_TAG_NOTE_TYPE);
  assert.equal(noteEvents[0]?.note, "Wearable tags");
  assert.deepEqual(noteEvents[0]?.tags, ["alcohol", "late-meal", "sauna"]);
  assert.equal(noteEvents[0]?.dayKey, "2026-04-22");
  assert.equal(noteEvents[0]?.dataOrigin?.sourceProviderSlug, "oura");
  assert.equal(noteEvents[0]?.externalRef?.facet, JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET);
  assert.match(noteEvents[0]?.externalRef?.resourceId ?? "", /^note-[a-f0-9]{16}$/u);
  assert.equal(findJunctionNoteArtifacts(payload).length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);

  // Source + timestamp is the bounded fallback spine when Junction omits an
  // upstream note id. A changed or cleared tag set revises that same note.
  assert.deepEqual(changedNote?.externalRef, noteEvents[0]?.externalRef);
  assert.deepEqual(clearedNote?.externalRef, noteEvents[0]?.externalRef);
  assert.deepEqual(changedNote?.tags, ["headache"]);
  assert.deepEqual(clearedNote?.tags, []);
  assert.equal(changed.events?.some((event) => event.kind === "intervention_session"), false);
  assert.equal(cleared.events?.some((event) => event.kind === "intervention_session"), false);
  assert.equal(findJunctionNoteArtifacts(changed).length, 1);
  assert.equal(findJunctionNoteArtifacts(cleared).length, 1);

  // A free-text-only row with no tag field stays out of canonical storage. An
  // explicit provider id wins over mutable timestamps for later revisions.
  assert.deepEqual(missingTags.events, []);
  assert.equal(findJunctionNoteArtifacts(missingTags).length, 0);
  assert.deepEqual(stableChangedNote?.externalRef, stableInitialNote?.externalRef);
  assert.deepEqual(stableInitialNote?.tags, ["sauna"]);
  assert.deepEqual(stableChangedNote?.tags, ["headache"]);
  assert.notEqual(stableChangedNote?.occurredAt, stableInitialNote?.occurredAt);
  assert.equal(stableChanged.events?.some((event) => event.kind === "intervention_session"), false);
  assert.equal(
    stableInitialNote?.externalRef?.resourceId,
    createHash("sha256")
      .update(JSON.stringify(["junction-oura-note", "ring", undefined, "provider-note-1"]))
      .digest("hex")
      .slice(0, 16),
  );

  assert.doesNotMatch(JSON.stringify(payload), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(JSON.stringify(changed), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(JSON.stringify(cleared), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(JSON.stringify(missingTags), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(JSON.stringify(stableInitial), /SENSITIVE_VALUE_SENTINEL/u);
  assert.doesNotMatch(JSON.stringify(stableChanged), /SENSITIVE_VALUE_SENTINEL/u);
});

test("Junction note ids remain scoped to their same-provider source instance", () => {
  const snapshot = (firstSourceTags: readonly string[]) => ({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      note: [{
        id: "provider-local-note-1",
        sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
        sourceProviderSlug: "oura",
        sourceType: "ring",
        start: "2026-04-22T18:05:00.000Z",
        tags: firstSourceTags,
      }, {
        id: "provider-local-note-1",
        sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
        sourceProviderSlug: "oura",
        sourceType: "ring",
        start: "2026-04-22T18:05:00.000Z",
        tags: ["sauna"],
      }],
    },
  });
  const initial = normalizeJunctionSnapshot(snapshot(["headache"]));
  const edited = normalizeJunctionSnapshot(snapshot([]));
  const initialNotes = initial.events?.filter((event) => event.kind === "note") ?? [];
  const editedNotes = edited.events?.filter((event) => event.kind === "note") ?? [];

  assert.equal(initialNotes.length, 2);
  assert.equal(findJunctionNoteArtifacts(initial).length, 2);
  assert.equal(new Set(initialNotes.map((event) => event.externalRef?.resourceId)).size, 2);
  assert.deepEqual(
    initialNotes.map((event) => event.dataOrigin?.sourceInstanceId).sort(),
    ["source-aaaaaaaaaaaaaaaaaaaaaaaa", "source-bbbbbbbbbbbbbbbbbbbbbbbb"],
  );
  assert.deepEqual(
    editedNotes.map((event) => event.externalRef?.resourceId).sort(),
    initialNotes.map((event) => event.externalRef?.resourceId).sort(),
  );
  assert.deepEqual(
    editedNotes.find((event) =>
      event.dataOrigin?.sourceInstanceId === "source-aaaaaaaaaaaaaaaaaaaaaaaa"
    )?.tags,
    [],
  );
  assert.deepEqual(
    editedNotes.find((event) =>
      event.dataOrigin?.sourceInstanceId === "source-bbbbbbbbbbbbbbbbbbbbbbbb"
    )?.tags,
    ["sauna"],
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
    }, { defaultTimeZone: "UTC" });

    const meanEvent = payload.events?.find((entry) => entry.fields?.metric === "spo2");
    const minimumEvent = payload.events?.find((entry) => entry.fields?.metric === "lowest-spo2");
    const [compactArtifact] = findJunctionCompactTimeseriesArtifacts(payload, "blood-oxygen");
    const [temporalArtifact] = findJunctionTemporalFeatureArtifacts(payload, "blood-oxygen");
    const compactArtifactContent = compactArtifact?.content as Record<string, unknown> | undefined;
    const temporalArtifactContent = temporalArtifact?.content as Record<string, unknown> | undefined;
    const compactArtifactText = JSON.stringify(compactArtifactContent ?? {});

    assert.deepEqual(payload.provenance?.timeseriesResources, ["blood_oxygen"]);
    assert.equal(payload.samples?.length ?? 0, 0);
    assert.ok(compactArtifact);
    assert.equal(compactArtifactContent?.sampleCount, 1);
    assert.equal(temporalArtifact, undefined);
    assert.equal(temporalArtifactContent, undefined);
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

test("Junction temporal reducers require two distinct instants", () => {
  const result = buildJunctionTemporalFeatures({
    resource: "blood_oxygen",
    samples: [
      {
        recordedAt: "2026-04-22T07:00:00Z",
        value: 88,
      },
      {
        recordedAt: "2026-04-22T07:00:00+00:00",
        value: 88,
      },
    ],
  });

  assert.deepEqual(result, { observations: [], status: "insufficient_samples" });
});

test("Junction SpO2 runs split at established-cadence gaps without inferring duration", () => {
  const result = buildJunctionTemporalFeatures({
    resource: "blood_oxygen",
    samples: [
      { recordedAt: "2026-04-22T07:00:00Z", value: 88 },
      { recordedAt: "2026-04-22T07:01:00Z", value: 88 },
      { recordedAt: "2026-04-22T18:00:00Z", value: 88 },
      { recordedAt: "2026-04-22T18:01:00Z", value: 88 },
    ],
  });

  assert.equal(result.status, "complete");
  if (result.status !== "complete" || result.envelope.kind !== "blood_oxygen") {
    assert.fail("expected complete blood oxygen temporal features");
  }
  assert.equal(result.envelope.sampleIntervalSeconds, 60);
  assert.equal(result.envelope.belowThresholdRunCount, 2);
  assert.equal(result.envelope.longestBelowThresholdSampleCount, 2);
  assert.ok(result.observations.every((observation) => observation.unit !== "seconds"));
});

test("Junction sparse samples retain literal burden but suppress continuity claims", () => {
  const bloodOxygen = buildJunctionTemporalFeatures({
    resource: "blood_oxygen",
    samples: [
      { recordedAt: "2026-04-22T07:00:00Z", value: 88 },
      { recordedAt: "2026-04-22T19:00:00Z", value: 88 },
    ],
  });
  const stress = buildJunctionTemporalFeatures({
    resource: "stress_level",
    samples: [
      { localMinuteOfDay: 420, recordedAt: "2026-04-22T07:00:00Z", value: 20 },
      { localMinuteOfDay: 1_140, recordedAt: "2026-04-22T19:00:00Z", value: 80 },
    ],
  });

  assert.equal(bloodOxygen.status, "complete");
  if (bloodOxygen.status !== "complete" || bloodOxygen.envelope.kind !== "blood_oxygen") {
    assert.fail("expected literal blood oxygen sample burden");
  }
  assert.deepEqual(
    bloodOxygen.observations.map((observation) => observation.metric),
    ["spo2-samples-below-90-percent"],
  );
  assert.equal(bloodOxygen.envelope.qualifyingPairCount, 0);
  assert.equal(bloodOxygen.envelope.belowThresholdRunCount, undefined);
  assert.equal(bloodOxygen.observations[0]?.confidence, "low");
  assert.equal(bloodOxygen.observations[0]?.qualifiers.sampleCount, 2);
  assert.equal(bloodOxygen.observations[0]?.qualifiers.thresholdSampleCount, 2);
  assert.deepEqual(stress, { observations: [], status: "insufficient_temporal_evidence" });
});

test("Junction stress runs compare against the unrounded daily mean", () => {
  const result = buildJunctionTemporalFeatures({
    resource: "stress_level",
    samples: [
      { recordedAt: "2026-04-22T07:00:00Z", value: 50 },
      { recordedAt: "2026-04-22T07:01:00Z", value: 50.0001 },
      { recordedAt: "2026-04-22T07:02:00Z", value: 50.0001 },
    ],
  });

  assert.equal(result.status, "complete");
  if (result.status !== "complete" || result.envelope.kind !== "stress_level") {
    assert.fail("expected complete stress temporal features");
  }
  assert.equal(result.envelope.aboveDailyMeanRunCount, 1);
});

test("Junction equal-time samples collapse deterministically before reduction", () => {
  const bloodOxygenSamples = [
    { recordedAt: "2026-04-22T07:00:00Z", value: 88 },
    { recordedAt: "2026-04-22T07:00:00+00:00", value: 96 },
    { recordedAt: "2026-04-22T07:01:00Z", value: 88 },
    { recordedAt: "2026-04-22T07:02:00Z", value: 88 },
  ];
  const stressSamples = [
    { recordedAt: "2026-04-22T07:00:00Z", value: 0 },
    { recordedAt: "2026-04-22T07:00:00+00:00", value: 100 },
    { recordedAt: "2026-04-22T07:01:00Z", value: 0 },
    { recordedAt: "2026-04-22T07:02:00Z", value: 100 },
  ];
  const bloodOxygenResults = allPermutations(bloodOxygenSamples).map((samples) =>
    buildJunctionTemporalFeatures({ resource: "blood_oxygen", samples })
  );
  const stressResults = allPermutations(stressSamples).map((samples) =>
    buildJunctionTemporalFeatures({ resource: "stress_level", samples })
  );

  for (const result of bloodOxygenResults.slice(1)) {
    assert.deepEqual(result, bloodOxygenResults[0]);
  }
  for (const result of stressResults.slice(1)) {
    assert.deepEqual(result, stressResults[0]);
  }
  const bloodOxygen = bloodOxygenResults[0];
  const stress = stressResults[0];
  assert.equal(bloodOxygen?.status, "complete");
  assert.equal(stress?.status, "complete");
  if (
    bloodOxygen?.status !== "complete"
    || bloodOxygen.envelope.kind !== "blood_oxygen"
    || stress?.status !== "complete"
    || stress.envelope.kind !== "stress_level"
  ) {
    assert.fail("expected deterministic temporal feature envelopes");
  }
  assert.equal(bloodOxygen.envelope.sampleCount, 3);
  assert.equal(bloodOxygen.envelope.belowThresholdSampleCount, 2);
  assert.equal(bloodOxygen.envelope.belowThresholdRunCount, 1);
  assert.equal(bloodOxygen.envelope.longestBelowThresholdSampleCount, 2);
  assert.equal(stress.envelope.sampleCount, 3);
  assert.equal(stress.envelope.qualifyingPairCount, 2);
  assert.equal(stress.envelope.meanAbsoluteSuccessiveDifference, 75);
});

test("Junction blood oxygen features distinguish an isolated low sample from a sustained run", () => {
  const buildPayload = (values: readonly number[]) => normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      blood_oxygen: {
        groups: {
          garmin: [{
            data: values.map((value, index) => ({
              timestamp: new Date(Date.UTC(2026, 3, 22, 7, index)).toISOString(),
              unit: "percent",
              value,
            })),
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, "2026-04-22", "2026-04-24T12:00:00.000Z", "America/Chicago");
  const isolated = buildPayload([88, 94, 94, 94, 94, 100]);
  const sustained = buildPayload([88, 88, 88, 100, 100, 100]);
  const featureValue = (payload: DeviceBatchImportPayload, metric: string) =>
    payload.events?.find((event) => event.fields?.metric === metric)?.fields?.value;
  const [isolatedArtifact] = findJunctionTemporalFeatureArtifacts(isolated, "blood-oxygen");
  const [sustainedArtifact] = findJunctionTemporalFeatureArtifacts(sustained, "blood-oxygen");
  const isolatedContent = isolatedArtifact?.content as Record<string, unknown>;
  const sustainedContent = sustainedArtifact?.content as Record<string, unknown>;

  // Ordinary daily facts stay with the calendar-day owner; the facet-only
  // temporal import publishes only the bounded temporal shape.
  assert.equal(featureValue(isolated, "spo2"), undefined);
  assert.equal(featureValue(sustained, "spo2"), undefined);
  assert.equal(featureValue(isolated, "lowest-spo2"), undefined);
  assert.equal(featureValue(sustained, "lowest-spo2"), undefined);
  assert.equal(featureValue(isolated, "spo2-samples-below-90-percent"), 16.6667);
  assert.equal(featureValue(sustained, "spo2-samples-below-90-percent"), 50);
  assert.equal(featureValue(isolated, "spo2-below-90-run-count"), 0);
  assert.equal(featureValue(isolated, "spo2-longest-below-90-sample-count"), 0);
  assert.equal(featureValue(sustained, "spo2-longest-below-90-sample-count"), 3);
  assert.equal(isolatedContent.schema, "junction.timeseries_temporal_features.v2");
  assert.equal(sustainedContent.status, "complete");
  assert.ok(Buffer.byteLength(JSON.stringify(isolatedContent), "utf8") < 2_048);
  assert.ok(Buffer.byteLength(JSON.stringify(sustainedContent), "utf8") < 2_048);
  assert.equal(isolated.samples?.length ?? 0, 0);
  assert.equal(sustained.samples?.length ?? 0, 0);
  assert.doesNotMatch(JSON.stringify([isolatedContent, sustainedContent]), /"samples"|"timestamps"/u);
});

test("Junction stress features preserve local-day runs, variation, and daypart shape", () => {
  const payload = normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-22T11:00:00Z", timezone_offset: -18_000, value: 20 },
              { timestamp: "2026-04-22T11:05:00Z", timezone_offset: -18_000, value: 80 },
              { timestamp: "2026-04-22T17:00:00Z", timezone_offset: -18_000, value: 30 },
              { timestamp: "2026-04-22T23:00:00Z", timezone_offset: -18_000, value: 70 },
              { timestamp: "2026-04-22T23:05:00Z", timezone_offset: -18_000, value: 90 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, "2026-04-22", "2026-04-24T12:00:00.000Z", "America/Chicago");
  const featureEvents = (payload.events ?? []).filter((event) =>
    String(event.fields?.metric).startsWith("stress-")
    && event.fields?.metric !== "stress-level"
  );
  const featureValue = (metric: string) =>
    featureEvents.find((event) => event.fields?.metric === metric)?.fields?.value;
  const [artifact] = findJunctionTemporalFeatureArtifacts(payload, "stress-level");
  const artifactContent = artifact?.content as Record<string, unknown>;

  assert.equal(payload.events?.find((event) => event.fields?.metric === "stress-level"), undefined);
  assert.equal(featureEvents.length, 3);
  assert.ok(featureEvents.every((event) => event.dayKey === "2026-04-22"));
  assert.equal(featureValue("stress-above-daily-mean-run-count"), 1);
  assert.equal(featureValue("stress-mean-absolute-successive-difference"), 40);
  assert.equal(featureValue("stress-evening-minus-morning-score"), 30);
  assert.ok(featureEvents.every((event) => event.dataOrigin?.originConfidence === "medium"));
  assert.ok(featureEvents.every((event) => {
    const qualifiers = event.fields?.qualifiers as Record<string, unknown> | undefined;
    return qualifiers?.derived === true
      && qualifiers.evidenceMethod
        === "distinct-instant-mean-median-gap-2.5x-absolute-cap.v2"
      && qualifiers.sampleCount === 5
      && qualifiers.qualifyingPairCount === 2;
  }));
  assert.equal(artifactContent.status, "complete");
  assert.ok(Buffer.byteLength(JSON.stringify(artifactContent), "utf8") < 2_048);
  assert.ok(
    Buffer.byteLength(JSON.stringify(artifactContent.features), "utf8")
      <= JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES,
  );
  assert.ok(featureEvents.every((event) => Buffer.byteLength(JSON.stringify(event), "utf8") < 2_048));
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction stress features use the vault timezone while ordinary daily facts keep provider-calendar identity", () => {
  const buildPayload = (utcSuffix: "Z" | "+00:00") => normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              {
                timestamp: `2026-04-23T13:00:00${utcSuffix}`,
                timezone_offset: -25_200,
                value: 20,
              },
              {
                timestamp: `2026-04-23T13:05:00${utcSuffix}`,
                timezone_offset: -25_200,
                value: 30,
              },
              {
                timestamp: `2026-04-24T01:00:00${utcSuffix}`,
                timezone_offset: -25_200,
                value: 70,
              },
              {
                timestamp: `2026-04-24T01:05:00${utcSuffix}`,
                timezone_offset: -25_200,
                value: 80,
              },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, "2026-04-23", "2026-04-24T12:00:00.000Z", "America/Los_Angeles");
  const canonical = buildPayload("+00:00");
  const zulu = buildPayload("Z");
  const ordinaryCanonical = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-23T13:00:00+00:00", timezone_offset: -25_200, value: 20 },
              { timestamp: "2026-04-23T13:05:00+00:00", timezone_offset: -25_200, value: 30 },
              { timestamp: "2026-04-24T01:00:00+00:00", timezone_offset: -25_200, value: 70 },
              { timestamp: "2026-04-24T01:05:00+00:00", timezone_offset: -25_200, value: 80 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, { defaultTimeZone: "America/Los_Angeles" });
  const eventByMetric = (payload: DeviceBatchImportPayload, metric: string) =>
    payload.events?.find((event) => event.fields?.metric === metric);
  const canonicalFeature = eventByMetric(canonical, "stress-evening-minus-morning-score");
  const zuluFeature = eventByMetric(zulu, "stress-evening-minus-morning-score");
  const [canonicalArtifact] = findJunctionTemporalFeatureArtifacts(canonical, "stress-level");
  const [zuluArtifact] = findJunctionTemporalFeatureArtifacts(zulu, "stress-level");

  assert.equal(eventByMetric(canonical, "stress-level"), undefined);
  assert.equal(eventByMetric(zulu, "stress-level"), undefined);
  assert.deepEqual(
    ordinaryCanonical.events
      ?.filter((event) => event.fields?.metric === "stress-level")
      .map((event) => [event.dayKey, event.fields?.value]),
    [
      ["2026-04-23", 25],
      ["2026-04-24", 75],
    ],
  );
  assert.equal(canonicalFeature?.dayKey, "2026-04-23");
  assert.equal(canonicalFeature?.fields?.value, 50);
  assert.equal(zuluFeature?.dayKey, "2026-04-23");
  assert.equal(zuluFeature?.fields?.value, 50);
  assert.equal(canonicalFeature?.externalRef?.resourceId, zuluFeature?.externalRef?.resourceId);
  assert.equal(canonicalArtifact?.role, zuluArtifact?.role);
  assertNoFullJunctionTimeseriesArtifacts(canonical);
});

test("Junction stress features apply vault timezone to +00:00 timestamps without migrating ordinary identity", () => {
  const buildPayload = (utcSuffix: "Z" | "+00:00") => normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: `2026-04-23T13:00:00${utcSuffix}`, value: 20 },
              { timestamp: `2026-04-23T13:05:00${utcSuffix}`, value: 30 },
              { timestamp: `2026-04-24T01:00:00${utcSuffix}`, value: 70 },
              { timestamp: `2026-04-24T01:05:00${utcSuffix}`, value: 80 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, "2026-04-23", "2026-04-24T12:00:00.000Z", "America/Los_Angeles");
  const canonical = buildPayload("+00:00");
  const zulu = buildPayload("Z");
  const ordinaryCanonical = normalizeJunctionSnapshot({
    importedAt: "2026-04-24T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              { timestamp: "2026-04-23T13:00:00+00:00", value: 20 },
              { timestamp: "2026-04-23T13:05:00+00:00", value: 30 },
              { timestamp: "2026-04-24T01:00:00+00:00", value: 70 },
              { timestamp: "2026-04-24T01:05:00+00:00", value: 80 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, { defaultTimeZone: "America/Los_Angeles" });
  const eventByMetric = (payload: DeviceBatchImportPayload, metric: string) =>
    payload.events?.find((event) => event.fields?.metric === metric);
  const canonicalFeature = eventByMetric(canonical, "stress-evening-minus-morning-score");
  const zuluFeature = eventByMetric(zulu, "stress-evening-minus-morning-score");
  const [canonicalArtifact] = findJunctionTemporalFeatureArtifacts(canonical, "stress-level");
  const [zuluArtifact] = findJunctionTemporalFeatureArtifacts(zulu, "stress-level");

  assert.equal(eventByMetric(canonical, "stress-level"), undefined);
  assert.equal(eventByMetric(zulu, "stress-level"), undefined);
  assert.deepEqual(
    ordinaryCanonical.events
      ?.filter((event) => event.fields?.metric === "stress-level")
      .map((event) => [event.dayKey, event.fields?.value]),
    [
      ["2026-04-23", 25],
      ["2026-04-24", 75],
    ],
  );
  assert.equal(canonicalFeature?.dayKey, "2026-04-23");
  assert.equal(canonicalFeature?.fields?.value, 50);
  assert.equal(zuluFeature?.dayKey, "2026-04-23");
  assert.equal(zuluFeature?.fields?.value, 50);
  assert.equal(canonicalFeature?.externalRef?.resourceId, zuluFeature?.externalRef?.resourceId);
  assert.equal(canonicalArtifact?.role, zuluArtifact?.role);
  assertNoFullJunctionTimeseriesArtifacts(canonical);
});

test("Junction stress features order floating provider-local timestamps without persisting them", () => {
  const payload = normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      stress_level: [{
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22 07:00:00",
        timestampSemantics: "floating",
        value: 20,
      }, {
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22 07:05:00",
        timestampSemantics: "floating",
        value: 20,
      }, {
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22 19:00:00",
        timestampSemantics: "floating",
        value: 80,
      }, {
        sourceProviderSlug: "garmin",
        timestamp: "2026-04-22 19:05:00",
        timestampSemantics: "floating",
        value: 80,
      }],
    },
  }, "2026-04-22");
  const [artifact] = findJunctionTemporalFeatureArtifacts(payload, "stress-level");
  const artifactContent = artifact?.content as Record<string, unknown>;

  assert.equal(
    payload.events?.find((event) => event.fields?.metric === "stress-evening-minus-morning-score")
      ?.fields?.value,
    60,
  );
  assert.equal(artifactContent.status, "complete");
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.doesNotMatch(JSON.stringify(artifactContent.features), /2026-04-22|07:00|19:00/u);
});

test("Junction temporal feature import accepts the dense fidelity bound and rejects overflow", () => {
  const buildSamples = (length: number) => Array.from({ length }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 1) + index * 10_000).toISOString(),
    value: index % 2 === 0 ? 20 : 80,
  }));
  const buildPayload = (data: readonly Record<string, unknown>[]) => normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-08T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data,
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  }, "2026-04-01");
  const atLimitPayload = buildPayload(buildSamples(1_440));
  const temporalFeatureEvents = (payload: DeviceBatchImportPayload) => payload.events?.filter((event) =>
    String(event.fields?.metric).startsWith("stress-")
    && event.fields?.metric !== "stress-level"
  ) ?? [];
  const atLimitArtifacts = findJunctionTemporalFeatureArtifacts(atLimitPayload, "stress-level");

  assert.equal(
    atLimitPayload.events?.filter((event) => event.fields?.metric === "stress-level").length,
    0,
  );
  assert.ok(temporalFeatureEvents(atLimitPayload).length >= 1);
  assert.equal(atLimitArtifacts.length, 1);
  assert.ok(atLimitArtifacts.some((artifact) => {
    const content = artifact.content as Record<string, unknown>;
    return content.sampleCount === 1_440
      && content.status === "complete"
      && Object.hasOwn(content, "features")
      && Buffer.byteLength(JSON.stringify(content), "utf8") < 2_048;
  }));
  assert.equal(atLimitPayload.samples?.length ?? 0, 0);

  assert.throws(
    () => buildPayload(buildSamples(1_441)),
    /maximum admitted is 1440/u,
  );
});

test("Junction temporal source day rejects an over-bound sibling day without partial facts", () => {
  const overBoundDaySamples = Array.from({ length: 1_441 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 22) + index * 10_000).toISOString(),
    value: index % 2 === 0 ? 20 : 80,
  }));
  const healthyDaySamples = [
    { timestamp: "2026-04-23T07:00:00Z", value: 20 },
    { timestamp: "2026-04-23T07:05:00Z", value: 30 },
    { timestamp: "2026-04-23T19:00:00Z", value: 70 },
    { timestamp: "2026-04-23T19:05:00Z", value: 80 },
  ];
  const buildPayload = (data: readonly Record<string, unknown>[], dayKey: string) =>
    normalizeCompleteTemporalSourceDay({
      importedAt: "2026-04-24T12:00:00.000Z",
      timeseries: {
        stress_level: {
          groups: {
            garmin: [{
              data,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        },
      },
    }, dayKey);

  assert.throws(
    () => buildPayload([...overBoundDaySamples, ...healthyDaySamples], "2026-04-22"),
    /maximum admitted is 1440/u,
  );

  const healthyPayload = buildPayload(healthyDaySamples, "2026-04-23");
  const healthyArtifacts = findJunctionTemporalFeatureArtifacts(healthyPayload, "stress-level");
  assert.equal(healthyArtifacts.length, 1);
  assert.equal(
    (healthyArtifacts[0]?.content as Record<string, unknown> | undefined)?.status,
    "complete",
  );
  assert.equal(healthyPayload.samples?.length ?? 0, 0);
});

test("Junction temporal feature output cap is enforced across sources without adding artifacts", () => {
  const buildPayload = (providers: readonly string[]) => normalizeCompleteTemporalSourceDay({
    importedAt: "2026-04-23T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: Object.fromEntries(
          providers.map((provider) => [
            provider,
            [{
              data: [
                { timestamp: "2026-04-22T11:00:00Z", timezone_offset: -18_000, value: 20 },
                { timestamp: "2026-04-22T11:05:00Z", timezone_offset: -18_000, value: 30 },
                { timestamp: "2026-04-22T23:00:00Z", timezone_offset: -18_000, value: 70 },
                { timestamp: "2026-04-22T23:05:00Z", timezone_offset: -18_000, value: 80 },
              ],
              source: { provider, type: "wearable" },
            }],
          ]),
        ),
      },
    },
  }, "2026-04-22");
  const payload = buildPayload(["fitbit", "garmin", "oura", "polar"]);
  const reordered = buildPayload(["polar", "oura", "garmin", "fitbit"]);
  const featureEvents = payload.events?.filter((event) =>
    String(event.fields?.metric).startsWith("stress-")
    && event.fields?.metric !== "stress-level"
  ) ?? [];
  const artifacts = findJunctionTemporalFeatureArtifacts(payload, "stress-level");
  const statuses = artifacts.map((artifact) =>
    (artifact.content as Record<string, unknown>).status
  );
  const featureSignatures = (value: DeviceBatchImportPayload) => (value.events ?? [])
    .filter((event) =>
      String(event.fields?.metric).startsWith("stress-")
      && event.fields?.metric !== "stress-level"
    )
    .map((event) => `${event.dataOrigin?.sourceProviderSlug}:${String(event.fields?.metric)}`)
    .sort();

  assert.equal(payload.events?.filter((event) => event.fields?.metric === "stress-level").length, 0);
  assert.equal(featureEvents.length, 9);
  assert.ok(featureEvents.length <= JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY);
  assert.equal(artifacts.length, 4);
  assert.equal(statuses.filter((status) => status === "complete").length, 3);
  assert.equal(statuses.filter((status) => status === "suppressed_output_cap").length, 1);
  assert.deepEqual(featureSignatures(reordered), featureSignatures(payload));
  assert.equal(payload.samples?.length ?? 0, 0);
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
  assert.deepEqual(rawReceipt.rawArtifactRoles.slice(0, 2), [
    "junction-summary-profile",
    "junction-summary-activity",
  ]);
  assert.equal(
    rawReceipt.rawArtifactRoles.some((role) => role.startsWith("junction-timeseries-daily-steps:")),
    true,
  );
  assert.equal(rawReceipt.rawArtifactCount, 3);
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
            value: 5.5,
          },
          {
            sourceProviderSlug: "abbott_libreview",
            timestamp: "2023-09-27T08:03:00+00:00",
            value: 6.5,
          },
        ],
      },
    },
  });

  const glucoseSamples = payload.samples?.filter((sample) => sample.stream === "glucose") ?? [];
  const glucoseEvents = payload.events?.filter((event) =>
    event.kind === "observation" &&
    ["glucose", "lowest-glucose", "highest-glucose"].includes(String(event.fields?.metric))
  ) ?? [];
  const mean = glucoseEvents.find((event) => event.fields?.metric === "glucose");

  assert.deepEqual(payload.provenance?.timeseriesResources, ["glucose"]);
  assert.equal(glucoseEvents.length, 3);
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

test("Junction weight uses its reading timestamp rather than the sync window", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2023-09-27T12:00:00.000Z",
    windowStart: "2023-09-27T00:00:00.000Z",
    windowEnd: "2023-09-27T23:59:59.000Z",
    timeseries: {
      weight: [{
        sourceProviderSlug: "withings",
        timestamp: "2023-09-27T07:48:00+00:00",
        value: 82,
      }],
    },
  });

  const measurement = payload.events?.find((event) => event.kind === "measurement");
  const weight = (
    measurement?.fields?.measurements as Array<Record<string, unknown>> | undefined
  )?.[0];

  assert.deepEqual(weight, { metric: "weight", value: 82, unit: "kg" });
  assert.equal(measurement?.occurredAt, "2023-09-27T07:48:00.000Z");
  assert.deepEqual(payload.provenance?.timeseriesResources, ["weight"]);
  assert.equal(findJunctionWeightReadingArtifacts(payload).length, 1);
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
    "steps",
    "distance",
    "calories_active",
    "heartrate",
    "weight",
  ]);
  assert.deepEqual([...JUNCTION_OPT_IN_SUMMARY_RESOURCES], []);
  assert.deepEqual([...JUNCTION_OPT_IN_TIMESERIES_RESOURCES], [
    "body_mass_index",
    "carbohydrates",
    "fat",
    "forced_expiratory_volume_1",
    "forced_vital_capacity",
    "heart_rate_alert",
    "inhaler_usage",
    "insulin_injection",
    "lean_body_mass",
    "peak_expiratory_flow_rate",
    "sleep_apnea_alert",
    "waist_circumference",
    "calories_basal",
    "daylight_exposure",
    "fall",
    "floors_climbed",
    "handwashing",
    "stand_duration",
    "stand_hour",
    "uv_exposure",
    "wheelchair_push",
    "workout_distance",
    "workout_duration",
    "workout_swimming_stroke",
    "electrocardiogram_voltage",
    "workout_stream",
  ]);
  assert.deepEqual([...JUNCTION_RAW_ONLY_SUMMARY_RESOURCES], []);
  assert.deepEqual([...JUNCTION_ALLOWED_SUMMARY_RESOURCES], [
    ...JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  ]);
  assert.deepEqual([...JUNCTION_ALLOWED_TIMESERIES_RESOURCES], [
    ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
    ...JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  ]);

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
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "steps").length, 1);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "distance").length, 1);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "calories-active").length, 1);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "heartrate").length, 1);
  assert.equal(findJunctionWeightReadingArtifacts(payload).length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assertEventRawArtifactRolesExist(payload);
  assert.ok(payload.events?.every((event) => event.externalRef?.system === "junction"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "active-calories"));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "distance-km"));
  assert.ok(payload.events?.some((event) => (
    event.fields?.measurements as Array<{ metric?: string }> | undefined
  )?.some((measurement) => measurement.metric === "weight")));
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
          // A documented ovulation-only result must remain evidence-only in
          // the pregnancy-test context.
          { date: "2026-04-29", test_result: "estrogen_surge" },
        ],
        home_progesterone_test: [
          { date: "2026-04-24", test_result: "positive" },
          { date: "2026-04-25", test_result: "indeterminate" },
          // A documented ovulation-only result must remain evidence-only in
          // the progesterone-test context.
          { date: "2026-04-26", test_result: "luteinizing_hormone_surge" },
        ],
        cervical_mucus: [
          { date: "2026-04-18", quality: "watery" },
          { date: "2026-04-18", quality: "egg_white" },
          { date: "2026-04-19", quality: "unknown" },
        ],
        intermenstrual_bleeding: [{ date: "2026-04-15" }],
        contraceptive: [
          { date: "2026-04-12", type: "oral" },
          { date: "2026-04-13", type: "unspecified" },
        ],
        detected_deviations: [
          { date: "2026-04-30", deviation: "irregular_menstrual_cycles" },
        ],
        sexual_activity: [
          { date: "2026-04-13", protection_used: true },
          { date: "2026-04-13", protection_used: false },
        ],
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
    value: 2,
    unit: "score",
    qualifiers: { flow: "medium" },
  });
  assert.deepEqual(readMeasurement(flowEvents[1])?.qualifiers, { flow: "light" });
  assert.equal(flowEvents[0]?.dayKey, "2026-04-10");
  // Opaque semantic facets preserve simultaneously reported same-day facts
  // without exposing their values or remapping siblings after insertion.
  assert.match(flowEvents[0]?.externalRef?.facet ?? "", /^menstrual-flow-2026-04-10-[a-f0-9]{16}$/u);
  assert.equal(flowEvents[0]?.externalRef?.facet?.includes("medium"), false);

  const ovulationEvents = measurementEvents.filter((event) => event.title === "Junction ovulation test");
  // Two same-day tests with different results land as two events with
  // distinct opaque semantic facets; the indeterminate row stays raw-only.
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
  assert.match(ovulationEvents[0]?.externalRef?.facet ?? "", /^ovulation-test-2026-04-19-[a-f0-9]{16}$/u);
  assert.equal(ovulationEvents[0]?.externalRef?.facet?.includes("surge"), false);

  const pregnancyEvent = measurementEvents.find((event) => event.title === "Junction pregnancy test");
  assert.deepEqual(readMeasurement(pregnancyEvent), {
    metric: "pregnancy-test",
    value: 1,
    unit: "result",
    qualifiers: { result: "positive" },
  });

  const cervicalMucusEvents = measurementEvents.filter((event) =>
    event.title === "Junction cervical mucus"
  );
  assert.equal(cervicalMucusEvents.length, 2);
  const wateryCervicalMucusEvent = cervicalMucusEvents.find((event) =>
    readMeasurement(event)?.qualifiers &&
    (readMeasurement(event)?.qualifiers as Record<string, unknown>).quality === "watery"
  );
  assert.deepEqual(readMeasurement(wateryCervicalMucusEvent), {
    metric: "cervical-mucus",
    value: 1,
    unit: "observation",
    qualifiers: { quality: "watery" },
  });
  assert.notEqual(
    cervicalMucusEvents[0]?.externalRef?.facet,
    cervicalMucusEvents[1]?.externalRef?.facet,
  );

  const bleedingEvent = measurementEvents.find((event) =>
    event.title === "Junction intermenstrual bleeding"
  );
  assert.deepEqual(readMeasurement(bleedingEvent), {
    metric: "intermenstrual-bleeding",
    value: 1,
    unit: "event",
    qualifiers: { bleeding: "intermenstrual" },
  });
  assert.equal(bleedingEvent?.dayKey, "2026-04-15");

  const progesteroneEvent = measurementEvents.find((event) =>
    event.title === "Junction progesterone test"
  );
  assert.deepEqual(readMeasurement(progesteroneEvent), {
    metric: "progesterone-test",
    value: 1,
    unit: "result",
    qualifiers: { result: "positive" },
  });

  const contraceptiveEvent = measurementEvents.find((event) =>
    event.title === "Junction contraceptive use"
  );
  assert.deepEqual(readMeasurement(contraceptiveEvent), {
    metric: "contraceptive-use",
    value: 1,
    unit: "event",
    qualifiers: { type: "oral" },
  });

  const sexualActivityEvents = measurementEvents.filter((event) =>
    event.title === "Junction sexual activity"
  );
  assert.equal(sexualActivityEvents.length, 2);
  const protectedSexualActivityEvent = sexualActivityEvents.find((event) =>
    readMeasurement(event)?.qualifiers &&
    (readMeasurement(event)?.qualifiers as Record<string, unknown>)["protection-used"] === true
  );
  const unprotectedSexualActivityEvent = sexualActivityEvents.find((event) =>
    readMeasurement(event)?.qualifiers &&
    (readMeasurement(event)?.qualifiers as Record<string, unknown>)["protection-used"] === false
  );
  assert.deepEqual(readMeasurement(protectedSexualActivityEvent), {
    metric: "sexual-activity",
    value: 1,
    unit: "event",
    qualifiers: { "protection-used": true },
  });
  assert.deepEqual(readMeasurement(unprotectedSexualActivityEvent)?.qualifiers, {
    "protection-used": false,
  });
  assert.notEqual(
    protectedSexualActivityEvent?.externalRef?.facet,
    unprotectedSexualActivityEvent?.externalRef?.facet,
  );

  const deviationEvent = measurementEvents.find((event) => event.title === "Junction cycle deviation");
  assert.deepEqual(readMeasurement(deviationEvent), {
    metric: "menstrual-cycle-deviation",
    value: 1,
    unit: "flag",
    qualifiers: { deviation: "irregular_menstrual_cycles" },
  });
  assert.match(
    deviationEvent?.externalRef?.facet ?? "",
    /^menstrual-cycle-deviation-2026-04-30-[a-f0-9]{16}$/u,
  );

  // Predicted cycles are forecasts and must not become normalized facts.
  assert.equal(
    events.some((event) => event.occurredAt?.startsWith("2026-05-05")),
    false,
  );
  // Basal body temperature remains canonical only on its dedicated
  // timeseries. Unknown/unspecified categorical values and indeterminate
  // tests remain evidence-only.
  assert.equal(events.length, 15);
  assert.equal(payload.samples?.length ?? 0, 0);

  const cycleEvidence = readJunctionMenstrualCycleEvidence(payload);
  const evidenceText = JSON.stringify(cycleEvidence);
  assert.equal(cycleEvidence.cycleCount, 2);
  assert.equal(cycleEvidence.omittedCycleCount, 0);
  assert.ok(cycleEvidence.factCount > 0);
  assert.match(String(cycleEvidence.cycles[0]?.recordHash), /^[a-f0-9]{16}$/u);
  assert.ok(cycleEvidence.facts.some((fact) =>
    fact.kind === "home_pregnancy_test" && fact.value === "estrogen_surge"
  ));
  assert.ok(cycleEvidence.facts.some((fact) =>
    fact.kind === "home_progesterone_test" && fact.value === "luteinizing_hormone_surge"
  ));
  assert.doesNotMatch(evidenceText, /"menstrual_flow":\[/u);
  assert.doesNotMatch(evidenceText, /"sexual_activity":\[/u);
  assertJsonOmits(evidenceText, [
    "cycle-1",
    "cycle-2-predicted",
    "raw-cycle-source-app",
    "raw-cycle-source-name",
  ]);
  assertEventRawArtifactRolesExist(payload);
});

test("Junction normalizer preserves dated menstrual categorical facts without inventing certainty", () => {
  const oversizedContraceptiveType = `type-${"x".repeat(120)}`;
  const snapshot = {
    importedAt: "2026-05-02T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "cycle-categorical-facts",
        period_start: "2026-04-07",
        cervical_mucus: [
          { date: "2026-04-16", quality: "egg_white" },
          { date: "2026-04-17", quality: "unknown" },
        ],
        intermenstrual_bleeding: [{ date: "2026-04-18" }],
        contraceptive: [
          { date: "2026-04-08", type: oversizedContraceptiveType },
          { date: "2026-04-09", type: "unknown" },
        ],
        home_progesterone_test: [
          { date: "2026-04-23", test_result: "positive" },
          { date: "2026-04-24", test_result: "indeterminate" },
        ],
        sexual_activity: [
          { date: "2026-04-13", protection_used: false },
          { date: "2026-04-13" },
          // Non-boolean values are not coerced into certainty.
          { date: "2026-04-14", protection_used: "false" },
        ],
        source: { provider: "apple_health", type: "phone" },
      }, {
        id: "cycle-categorical-facts-predicted",
        is_predicted: true,
        period_start: "2026-05-05",
        cervical_mucus: [{ date: "2026-05-10", quality: "watery" }],
        intermenstrual_bleeding: [{ date: "2026-05-11" }],
        contraceptive: [{ date: "2026-05-12", type: "oral" }],
        home_progesterone_test: [{ date: "2026-05-13", test_result: "positive" }],
        sexual_activity: [{ date: "2026-05-14", protection_used: true }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  };
  const payload = normalizeJunctionSnapshot(snapshot);
  const events = payload.events ?? [];
  const measurementEvents = events.filter((event) => event.kind === "measurement");
  const readMeasurement = (event: (typeof events)[number] | undefined) =>
    (event?.fields?.measurements as Array<Record<string, unknown>> | undefined)?.[0];
  const eventsForMetric = (metric: string) => measurementEvents.filter((event) =>
    readMeasurement(event)?.metric === metric
  );

  const cervicalMucusEvents = eventsForMetric("cervical-mucus");
  assert.equal(cervicalMucusEvents.length, 1);
  assert.deepEqual(readMeasurement(cervicalMucusEvents[0]), {
    metric: "cervical-mucus",
    value: 1,
    unit: "observation",
    qualifiers: { quality: "egg_white" },
  });

  const intermenstrualBleedingEvent = eventsForMetric("intermenstrual-bleeding")[0];
  assert.deepEqual(readMeasurement(intermenstrualBleedingEvent), {
    metric: "intermenstrual-bleeding",
    value: 1,
    unit: "event",
    qualifiers: { bleeding: "intermenstrual" },
  });

  assert.equal(eventsForMetric("contraceptive-use").length, 0);

  const progesteroneEvents = eventsForMetric("progesterone-test");
  assert.equal(progesteroneEvents.length, 1);
  assert.deepEqual(readMeasurement(progesteroneEvents[0]), {
    metric: "progesterone-test",
    value: 1,
    unit: "result",
    qualifiers: { result: "positive" },
  });

  const sexualActivityEvents = eventsForMetric("sexual-activity");
  assert.equal(sexualActivityEvents.length, 2);
  const explicitlyUnprotected = sexualActivityEvents.find((event) =>
    (readMeasurement(event)?.qualifiers as Record<string, unknown> | undefined)?.["protection-used"] === false
  );
  const protectionUnspecified = sexualActivityEvents.find((event) =>
    Object.keys((readMeasurement(event)?.qualifiers as Record<string, unknown> | undefined) ?? {}).length === 0
  );
  assert.deepEqual(readMeasurement(explicitlyUnprotected), {
    metric: "sexual-activity",
    value: 1,
    unit: "event",
    qualifiers: { "protection-used": false },
  });
  assert.deepEqual(readMeasurement(protectionUnspecified), {
    metric: "sexual-activity",
    value: 1,
    unit: "event",
    qualifiers: {},
  });

  assert.equal(events.length, 5);
  assert.ok(events.every((event) => event.dataOrigin?.sourceProviderSlug === "apple-health"));
  assert.equal(events.some((event) => event.dayKey?.startsWith("2026-05")), false);
  assertEventRawArtifactRolesExist(payload);

  // Replay from a later sync window keeps the provider/date/category identity
  // stable instead of minting replacement facts.
  const replayPayload = normalizeJunctionSnapshot({
    ...snapshot,
    importedAt: "2026-06-02T12:00:00.000Z",
  });
  assert.deepEqual(
    replayPayload.events?.map((event) => event.externalRef),
    events.map((event) => event.externalRef),
  );
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
        gender: "other",
        wheelchair_use: true,
        created_at: "2026-04-19T09:00:00Z",
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "apple_health_kit", type: "phone" },
      },
    },
  });
  const events = payload.events ?? [];
  const height = events.find((event) => event.fields?.metric === "height");
  const gender = events.find((event) => event.title === "Junction gender");
  const demographics = events.find((event) => event.kind === "note");
  const genderMeasurement = (
    gender?.fields?.measurements as Array<Record<string, unknown>> | undefined
  )?.[0];

  assert.deepEqual(payload.provenance?.summaryResources, ["profile"]);
  assert.equal(events.length, 3);
  assert.equal(height?.kind, "observation");
  assert.equal(height?.fields?.value, 183);
  assert.equal(height?.fields?.unit, "cm");
  assert.equal(height?.title, "Junction height");
  assert.equal(height?.externalRef?.resourceType, "junction-apple-health-kit-profile");
  assert.equal(height?.externalRef?.facet, "height");
  assert.equal(gender?.kind, "measurement");
  assert.deepEqual(genderMeasurement, {
    metric: "gender",
    value: 1,
    unit: "recording",
    qualifiers: { gender: "other" },
  });
  assert.equal(gender?.externalRef?.facet, "gender");
  assert.equal(gender?.externalRef?.resourceId, height?.externalRef?.resourceId);
  assert.equal(gender?.dataOrigin?.sourceProviderSlug, "apple-health-kit");
  assert.equal(
    demographics?.note,
    "Birth date: 1990-05-14. Reported gender: other. Biological sex: female. Wheelchair use: yes.",
  );
  assert.equal(demographics?.note?.includes("Gender"), false);
  assert.equal(demographics?.title, "Junction profile");
  assert.equal(demographics?.externalRef?.facet, "profile-demographics");
  assert.equal(demographics?.externalRef?.resourceId, height?.externalRef?.resourceId);
  assert.equal(demographics?.recordedAt, "2026-04-19T09:00:00.000Z");
  // The semantic occurrence is pinned to created_at while externalRef.version
  // remains updated_at, so a source revision orders correctly without moving
  // an otherwise unchanged profile across event shards.
  assert.equal(demographics?.occurredAt, "2026-04-19T09:00:00.000Z");
  assert.equal(demographics?.dayKey, "2026-04-19");
  assert.equal(height?.occurredAt, "2026-04-19T09:00:00.000Z");
  assert.equal(demographics?.externalRef?.version, "2026-04-20T09:00:00.000Z");
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
  assert.deepEqual(profileArtifact?.content, {
    gender: "other",
    sourceProviderSlug: "apple-health-kit",
    sourceType: "phone",
    stableResourceId: height?.externalRef?.resourceId,
    updatedAt: "2026-04-20T09:00:00.000Z",
  });

  // Unknown enum values carry no canonical sex or gender information, but
  // remain bounded in the sanitized source evidence.
  const unknownSexPayload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        id: "profile-2",
        sex: "unknown",
        gender: "unknown",
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "oura", type: "ring" },
      },
    },
  });
  const unknownProfileArtifact = unknownSexPayload.evidenceParts?.find(
    (artifact) => artifact.role === "junction-summary-profile",
  );
  assert.equal(unknownSexPayload.events?.length ?? 0, 0);
  assert.equal((unknownProfileArtifact?.content as { gender?: unknown })?.gender, "unknown");
  assertEventRawArtifactRolesExist(unknownSexPayload);
});

test("Junction future profile gender values stay bounded and evidence-only", () => {
  const oversizedGender = `gender-${"x".repeat(120)}`;
  const snapshot = {
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        gender: oversizedGender,
        source_device_id: "profile-source-instance-proof",
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "oura", type: "ring" },
      },
    },
  };
  const payload = normalizeJunctionSnapshot(snapshot);
  assert.equal(payload.events?.length ?? 0, 0);
  assertEventRawArtifactRolesExist(payload);
  const genderArtifact = payload.evidenceParts?.find(
    (artifact) => artifact.role === "junction-summary-profile",
  );
  assert.deepEqual(genderArtifact?.content, {
    gender: oversizedGender.slice(0, 80),
    sourceProviderSlug: "oura",
    sourceInstanceId: genderArtifact?.content
      ? (genderArtifact.content as { sourceInstanceId?: string }).sourceInstanceId
      : undefined,
    sourceType: "ring",
    stableResourceId: genderArtifact?.content
      ? (genderArtifact.content as { stableResourceId?: string }).stableResourceId
      : undefined,
    updatedAt: "2026-04-20T09:00:00.000Z",
  });

  const replayPayload = normalizeJunctionSnapshot({
    summaries: { profile: genderArtifact?.content },
    importedAt: "2026-05-22T12:00:00.000Z",
  });
  assert.equal(replayPayload.events?.length ?? 0, 0);
  const replayArtifact = replayPayload.evidenceParts?.find(
    (artifact) => artifact.role === "junction-summary-profile",
  );
  const secondReplayPayload = normalizeJunctionSnapshot({
    summaries: { profile: replayArtifact?.content },
    importedAt: "2026-06-22T12:00:00.000Z",
  });
  assert.deepEqual(replayArtifact?.content, genderArtifact?.content);
  assert.equal(secondReplayPayload.events?.length ?? 0, 0);
});

test("Junction profile identity canonicalizes timestamp spellings without changing explicit ids", () => {
  const normalizeProfile = (updatedAt: string, id?: string) => normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        ...(id ? { id } : {}),
        gender: "other",
        updated_at: updatedAt,
        source: { provider: "oura", type: "ring" },
      },
    },
  }).events?.[0];
  const equivalentTimestamps = [
    "2026-04-20T09:00:00Z",
    "2026-04-20T09:00:00.000Z",
    "2026-04-20T04:00:00-05:00",
  ];
  const noIdEvents = equivalentTimestamps.map((updatedAt) => normalizeProfile(updatedAt));
  const explicitIdEvents = equivalentTimestamps.map((updatedAt) =>
    normalizeProfile(updatedAt, "profile-stable-id")
  );

  assert.equal(new Set(noIdEvents.map((event) => event?.externalRef?.resourceId)).size, 1);
  assert.equal(new Set(explicitIdEvents.map((event) => event?.externalRef?.resourceId)).size, 1);
  assert.equal(explicitIdEvents.every((event) => event?.legacyExternalRefs === undefined), true);
  assert.deepEqual(
    noIdEvents.map((event) => event?.dataOrigin?.observedAtRaw),
    equivalentTimestamps.map(() => "2026-04-20T09:00:00.000Z"),
  );
});

test("Junction no-id profile facets declare their persisted-predecessor migration shape", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-04-22T12:00:00.000Z",
    summaries: {
      profile: {
        birth_date: "1990-05-14",
        gender: "other",
        height: 181,
        sex: "female",
        updated_at: "2026-04-20T09:00:00Z",
        source: { provider: "oura", type: "ring" },
      },
    },
  });
  const events = payload.events ?? [];

  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.externalRef?.facet).sort(),
    ["gender", "height", "profile-demographics"],
  );
  assert.equal(events.every((event) => event.legacyExternalRefs === undefined), true);
  assert.equal(events.every((event) =>
    event.dataOrigin?.normalizerVersion === "junction-no-id-profile.v1"
  ), true);
});

test("Junction no-id profile migration claims updated-at identities and retains member edits", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-profile-no-id-migration");
  const createdAt = "2026-05-01T09:00:00.000Z";
  const firstUpdatedAt = "2026-05-20T09:00:00.000Z";
  const secondUpdatedAt = "2026-05-22T09:00:00.000Z";
  const thirdUpdatedAt = "2026-05-23T09:00:00.000Z";
  const profile = (input: { createdAt?: string; height: number; updatedAt: string }) => ({
    importedAt: input.updatedAt,
    summaries: {
      profile: {
        ...(input.createdAt ? { created_at: input.createdAt } : {}),
        updated_at: input.updatedAt,
        height: input.height,
        gender: "other",
        source_device_id: "stable-profile-source",
        source: { provider: "oura", type: "ring" },
      },
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const canonicalFirstPayload = normalizeJunctionSnapshot(profile({
      createdAt,
      height: 180,
      updatedAt: firstUpdatedAt,
    }));
    const updatedAtIdentityPayload = normalizeJunctionSnapshot(profile({
      height: 180,
      updatedAt: firstUpdatedAt,
    }));
    const legacyEvents = (canonicalFirstPayload.events ?? []).map((event) => {
      const updatedAtIdentity = updatedAtIdentityPayload.events?.find((candidate) =>
        candidate.externalRef?.facet === event.externalRef?.facet
      );
      assert.ok(updatedAtIdentity?.externalRef);
      const { evidenceRoles: _evidenceRoles, ...eventWithoutEvidence } = event;
      const { version: _legacyVersion, ...legacyExternalRef } = updatedAtIdentity.externalRef;
      return {
        ...eventWithoutEvidence,
        occurredAt: updatedAtIdentity.occurredAt,
        recordedAt: updatedAtIdentity.recordedAt,
        dayKey: updatedAtIdentity.dayKey,
        externalRef: legacyExternalRef,
        dataOrigin: {
          ...event.dataOrigin,
          observedAtRaw: firstUpdatedAt,
          normalizerVersion: "junction-normalizer.v1",
        },
      };
    });
    const first = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-05-20T10:00:00.000Z",
      events: legacyEvents,
    });
    const legacyHeight = first.events.find((event) =>
      event.kind === "observation" && event.metric === "height"
    );
    assert.ok(legacyHeight);
    assert.equal(legacyHeight.externalRef?.version, undefined);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: {
        ...legacyHeight,
        note: "member-corrected height",
        source: "manual",
        value: 179,
      },
    });

    const currentSnapshot = profile({
      createdAt,
      height: 181,
      updatedAt: secondUpdatedAt,
    });
    const currentPayload = normalizeJunctionSnapshot(currentSnapshot);
    assert.ok(currentPayload.events?.every((event) =>
      event.legacyExternalRefs === undefined
      && event.dataOrigin?.normalizerVersion === "junction-no-id-profile.v1"
    ));
    const update = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: currentSnapshot },
      { corePort: coreRuntime },
    );
    const secondReplay = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: currentSnapshot },
      { corePort: coreRuntime },
    );
    const thirdSnapshot = profile({
      createdAt,
      height: 182,
      updatedAt: thirdUpdatedAt,
    });
    const nextUpdate = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: thirdSnapshot },
      { corePort: coreRuntime },
    );
    const thirdReplay = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: thirdSnapshot },
      { corePort: coreRuntime },
    );
    const records = (
      await Promise.all(
        [...new Set([
          ...first.eventShardPaths,
          ...update.eventShardPaths,
          ...nextUpdate.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const live = latestLiveRecords(records);
    const liveHeight = live.find((event) => event.id === legacyHeight.id);
    const currentHeight = currentPayload.events?.find((event) =>
      event.kind === "observation" && event.fields?.metric === "height"
    );

    assert.equal(live.length, 3);
    assert.equal(liveHeight?.source, "manual");
    assert.equal(storedObservationValue(liveHeight), 179);
    assert.equal(
      storedExternalRefResourceId(liveHeight),
      currentHeight?.externalRef?.resourceId,
    );
    assert.equal(storedExternalRefField(liveHeight, "version"), secondUpdatedAt);
    assert.equal(storedDataOriginObservedAtRaw(liveHeight), createdAt);
    assert.ok(records.some((event) =>
      event.id === legacyHeight.id
      && event.source === "device"
      && storedObservationValue(event) === 181
      && storedExternalRefResourceId(event) === currentHeight?.externalRef?.resourceId
      && storedExternalRefField(event, "version") === secondUpdatedAt
    ));
    assert.ok(records.some((event) =>
      event.id === legacyHeight.id
      && event.source === "device"
      && storedObservationValue(event) === 182
      && storedExternalRefField(event, "version") === thirdUpdatedAt
    ));
    assert.equal(secondReplay.applied, false);
    assert.equal(nextUpdate.applied, true);
    assert.equal(thirdReplay.applied, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction future menstrual enum values stay bounded and evidence-only", () => {
  const oversizedDeviation = "a".repeat(200);
  const oversizedQuality = "q".repeat(200);
  const oversizedContraceptiveType = "t".repeat(200);
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-02T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "cycle-long-deviation",
        period_start: "2026-04-07",
        cervical_mucus: [{ date: "2026-04-18", quality: oversizedQuality }],
        contraceptive: [{ date: "2026-04-19", type: oversizedContraceptiveType }],
        detected_deviations: [{ date: "2026-04-30", deviation: oversizedDeviation }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });
  assert.equal(payload.events?.length ?? 0, 0);
  assert.equal(payload.samples?.length ?? 0, 0);

  const evidence = readJunctionMenstrualCycleEvidence(payload);
  assert.deepEqual(
    evidence.facts.map((fact) => [fact.kind, fact.value]),
    [
      ["detected_deviation", "a".repeat(80)],
      ["contraceptive", "t".repeat(80)],
      ["cervical_mucus", "q".repeat(80)],
    ],
  );
});

test("Junction menstrual cycles keep legacy scalar lengths evidence-only", () => {
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
  assert.equal(payload.events?.length ?? 0, 0);

  const evidence = readJunctionMenstrualCycleEvidence(payload);
  assert.equal(evidence.cycleCount, 2);
  assert.ok(evidence.cycles.some((cycle) =>
    cycle.periodStart === "2026-04-07" &&
    cycle.legacyPeriodLengthDays === 5 &&
    cycle.legacyCycleLengthDays === 28
  ));
  assert.ok(evidence.cycles.some((cycle) =>
    cycle.legacyCycleStart === "2026-05-05" &&
    cycle.legacyPeriodLengthDays === 4 &&
    cycle.legacyCycleLengthDays === 200
  ));
  assertJsonOmits(evidence, ["cycle-explicit-lengths", "cycle-start-only"]);
});

test("Junction menstrual canonicalization rejects impossible dates and accepts leap day", async () => {
  const snapshot = {
    importedAt: "2024-03-03T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "invalid-calendar-cycle",
        updated_at: "2024-03-03T09:00:00Z",
        period_start: "2024-02-30",
        period_end: "2024-03-02",
        cervical_mucus: [{ date: "2024-02-30", quality: "watery" }],
        source: { provider: "apple_health", type: "phone" },
      }, {
        id: "valid-leap-cycle",
        updated_at: "2024-03-03T09:00:00Z",
        period_start: "2024-02-29",
        period_end: "2024-03-02",
        cervical_mucus: [{ date: "2024-02-29", quality: "egg_white" }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  };
  const payload = normalizeJunctionSnapshot(snapshot);
  const evidence = readJunctionMenstrualCycleEvidence(payload);

  assert.equal(payload.events?.some((event) => event.dayKey === "2024-02-30"), false);
  assert.equal(payload.events?.some((event) => event.occurredAt.startsWith("2024-03-01")), false);
  assert.ok(payload.events?.some((event) =>
    event.dayKey === "2024-02-29" && event.fields?.metric === "period-length-days"
  ));
  assert.ok(payload.events?.some((event) =>
    event.dayKey === "2024-02-29" && JSON.stringify(event.fields).includes("egg_white")
  ));
  assert.ok(evidence.facts.some((fact) => fact.date === "2024-02-30"));

  const vaultRoot = await makeTempDirectory("murph-junction-strict-cycle-dates");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2024-03-03T00:00:00.000Z",
      timezone: "UTC",
    });
    const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      { provider: "junction", vaultRoot, snapshot },
      { corePort: coreRuntime },
    );
    assert.equal(result.events.some((event) => event.dayKey === "2024-02-30"), false);
    assert.ok(result.events.some((event) => event.dayKey === "2024-02-29"));
    assert.equal(result.samples.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction corrected profile and cycle snapshots retract omitted sensitive facets", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-authoritative-summary-corrections");
  const snapshot = (corrected: boolean) => ({
    importedAt: corrected ? "2026-05-22T12:00:00.000Z" : "2026-05-21T12:00:00.000Z",
    summaries: {
      profile: {
        id: "stable-profile",
        gender: corrected ? "unknown" : "other",
        updated_at: corrected ? "2026-05-22T09:00:00Z" : "2026-05-21T09:00:00Z",
        source: { provider: "apple_health_kit", type: "phone" },
      },
      menstrual_cycle: [{
        id: "stable-cycle",
        updated_at: corrected ? "2026-05-22T10:00:00Z" : "2026-05-21T10:00:00Z",
        period_start: "2026-05-01",
        home_pregnancy_test: [{
          date: "2026-05-18",
          test_result: corrected ? "positive" : "negative",
        }],
        cervical_mucus: corrected
          ? [{ date: "2026-05-12", quality: "egg_white" }]
          : [
              { date: "2026-05-12", quality: "egg_white" },
              { date: "2026-05-12", quality: "watery" },
            ],
        contraceptive: corrected
          ? []
          : [{ date: "2026-05-15", type: "oral" }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-20T00:00:00.000Z",
      timezone: "UTC",
    });
    const importSnapshot = (corrected: boolean) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        { provider: "junction", vaultRoot, snapshot: snapshot(corrected) },
        { corePort: coreRuntime },
      );
    const first = await importSnapshot(false);
    const correction = await importSnapshot(true);
    const replay = await importSnapshot(true);
    const firstPregnancy = first.events.find((event) => event.title === "Junction pregnancy test");
    const correctedPregnancy = correction.events.find((event) => event.title === "Junction pregnancy test");
    const records = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...correction.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const live = latestLiveRecords(records);
    const liveMeasurements = live.filter((record) => record.kind === "measurement");

    assert.equal(
      live.some((record) => record.kind === "note" && record.title === "Junction profile"),
      false,
    );
    assert.deepEqual(
      liveMeasurements
        .flatMap(storedMeasurements)
        .filter((measurement) => measurement.metric === "pregnancy-test")
        .map((measurement) => measurement.qualifiers?.result),
      ["positive"],
    );
    assert.deepEqual(
      liveMeasurements
        .flatMap(storedMeasurements)
        .filter((measurement) => measurement.metric === "cervical-mucus")
        .map((measurement) => measurement.qualifiers?.quality),
      ["egg_white"],
    );
    assert.equal(
      liveMeasurements.some((record) =>
        storedMeasurements(record).some((measurement) => measurement.metric === "contraceptive-use")
      ),
      false,
    );
    assert.equal(first.samples.length, 0);
    assert.equal(correction.samples.length, 0);
    assert.equal(replay.samples.length, 0);
    assert.ok(firstPregnancy?.id);
    assert.notEqual(correctedPregnancy?.id, firstPregnancy.id);
    assert.equal(eventRevisionFromLifecycle(correctedPregnancy?.lifecycle), 1);
    assert.ok(records.some((record) =>
      record.id === firstPregnancy.id && isDeletedEventLifecycle(record.lifecycle)
    ));
    assert.equal(correction.applied, true);
    assert.equal(replay.applied, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction menstrual corrections retire legacy home-progesterone facets", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-legacy-progesterone-facets");
  const cycle = (input: { result?: string; updatedAt: string }) => ({
    importedAt: input.updatedAt,
    summaries: {
      menstrual_cycle: [{
        id: "stable-cycle-legacy-progesterone",
        updated_at: input.updatedAt,
        period_start: "2026-05-01",
        home_progesterone_test: input.result
          ? [{ date: "2026-05-14", test_result: input.result }]
          : [],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const legacyPayload = normalizeJunctionSnapshot(cycle({
      result: "positive",
      updatedAt: "2026-05-20T09:00:00.000Z",
    }));
    const positive = legacyPayload.events?.find((event) =>
      event.title === "Junction progesterone test"
    );
    assert.ok(positive?.externalRef?.facet);
    const legacyPositive = {
      ...positive,
      externalRef: {
        ...positive.externalRef,
        facet: positive.externalRef.facet.replace(/^progesterone-test/u, "home-progesterone-test"),
      },
    };
    const legacyUnknown = {
      ...legacyPositive,
      occurredAt: "2026-05-15T00:00:00.000Z",
      dayKey: "2026-05-15",
      externalRef: {
        ...legacyPositive.externalRef,
        facet: "home-progesterone-test-unknown-2026-05-15",
      },
      fields: {
        ...legacyPositive.fields,
        measurements: [{
          metric: "home-progesterone-test",
          value: 0,
          unit: "result",
          qualifiers: { result: "unknown" },
        }],
      },
    };
    const { evidenceRoles: _positiveEvidenceRoles, ...legacyPositiveWithoutEvidence } = legacyPositive;
    const { evidenceRoles: _unknownEvidenceRoles, ...legacyUnknownWithoutEvidence } = legacyUnknown;
    const first = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-05-20T10:00:00.000Z",
      events: [legacyPositiveWithoutEvidence, legacyUnknownWithoutEvidence],
    });
    const correctedSnapshot = cycle({
      result: "negative",
      updatedAt: "2026-05-21T09:00:00.000Z",
    });
    const correction = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: correctedSnapshot },
      { corePort: coreRuntime },
    );
    const replay = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: correctedSnapshot },
      { corePort: coreRuntime },
    );
    const records = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...correction.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const live = latestLiveRecords(records);

    assert.equal(live.some((event) =>
      storedExternalRefField(event, "facet")?.startsWith("home-progesterone-test")
    ), false);
    assert.deepEqual(
      live.flatMap(storedMeasurements)
        .filter((measurement) => measurement.metric === "progesterone-test")
        .map((measurement) => measurement.qualifiers?.result),
      ["negative"],
    );
    assert.equal(replay.applied, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction legacy progesterone omissions retain member-authored revisions", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-edited-legacy-progesterone");
  const snapshot = (updatedAt: string) => ({
    importedAt: updatedAt,
    summaries: {
      menstrual_cycle: [{
        id: "stable-cycle-edited-legacy-progesterone",
        updated_at: updatedAt,
        period_start: "2026-05-01",
        home_progesterone_test: [{ date: "2026-05-14", test_result: "positive" }],
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const normalized = normalizeJunctionSnapshot(snapshot("2026-05-20T09:00:00.000Z"));
    const current = normalized.events?.find((event) =>
      event.title === "Junction progesterone test"
    );
    assert.ok(current?.externalRef?.facet);
    const legacy = {
      ...current,
      externalRef: {
        ...current.externalRef,
        facet: current.externalRef.facet.replace(/^progesterone-test/u, "home-progesterone-test"),
      },
    };
    const { evidenceRoles: _legacyEvidenceRoles, ...legacyWithoutEvidence } = legacy;
    const first = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-05-20T10:00:00.000Z",
      events: [legacyWithoutEvidence],
    });
    const importedLegacy = first.events[0];
    assert.ok(importedLegacy);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: { ...importedLegacy, note: "member context", source: "manual" },
    });

    const omission = {
      importedAt: "2026-05-21T09:00:00.000Z",
      summaries: {
        menstrual_cycle: [{
          id: "stable-cycle-edited-legacy-progesterone",
          updated_at: "2026-05-21T09:00:00.000Z",
          period_start: "2026-05-01",
          home_progesterone_test: [],
          source: { provider: "apple_health", type: "phone" },
        }],
      },
    };
    const update = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >(
      { provider: "junction", vaultRoot, snapshot: omission },
      { corePort: coreRuntime },
    );
    const records = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...update.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveEdited = latestLiveRecords(records).find((event) => event.id === importedLegacy.id);

    assert.equal(liveEdited?.note, "member context");
    assert.equal(liveEdited?.source, "manual");
    assert.ok(records.some((event) =>
      event.id === importedLegacy.id && isDeletedEventLifecycle(event.lifecycle)
    ));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction profile revisions preserve an unchanged member-edited gender while updating height", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-profile-member-edit");
  const snapshot = (input: { gender: string; height: number; updatedAt: string }) => ({
    importedAt: input.updatedAt,
    summaries: {
      profile: {
        id: "stable-profile-member-edit",
        created_at: "2026-05-01T09:00:00Z",
        updated_at: input.updatedAt,
        gender: input.gender,
        height: input.height,
        source: { provider: "apple_health_kit", type: "phone" },
      },
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const importSnapshot = (input: { gender: string; height: number; updatedAt: string }) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        { provider: "junction", vaultRoot, snapshot: snapshot(input) },
        { corePort: coreRuntime },
      );
    const first = await importSnapshot({
      gender: "male",
      height: 180,
      updatedAt: "2026-05-20T09:00:00.000Z",
    });
    const demographics = first.events.find((event) => event.kind === "note");
    assert.ok(demographics);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: {
        ...demographics,
        note: "Reported gender: female.",
        reportedGender: "female",
        source: "manual",
      },
    });

    const update = await importSnapshot({
      gender: "male",
      height: 181,
      updatedAt: "2026-05-21T09:00:00.000Z",
    });
    const records = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...update.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const live = latestLiveRecords(records);
    const liveDemographics = live.find((event) => event.id === demographics.id);
    const liveHeight = live.find((event) => event.kind === "observation" && event.metric === "height");

    assert.equal(storedObservationValue(liveHeight), 181);
    assert.equal(liveDemographics?.reportedGender, "female");
    assert.equal(liveDemographics?.source, "manual");
    assert.equal(storedExternalRefField(liveDemographics, "version"), "2026-05-20T09:00:00.000Z");
    assert.equal(storedDataOriginObservedAtRaw(liveDemographics), "2026-05-01T09:00:00.000Z");
    assert.ok(records.some((event) =>
      event.id === demographics.id
      && event.source === "device"
      && storedExternalRefField(event, "version") === "2026-05-21T09:00:00.000Z"
    ), "the provider ordering baseline advances behind the retained member revision");

    const nextUpdate = await importSnapshot({
      gender: "other",
      height: 182,
      updatedAt: "2026-05-22T09:00:00.000Z",
    });
    const replay = await importSnapshot({
      gender: "other",
      height: 182,
      updatedAt: "2026-05-22T09:00:00.000Z",
    });
    const afterUpdate = (
      await Promise.all(
        [...new Set([
          ...first.eventShardPaths,
          ...update.eventShardPaths,
          ...nextUpdate.eventShardPaths,
        ])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    assert.equal(
      storedObservationValue(
        latestLiveRecords(afterUpdate).find((event) =>
          event.kind === "observation" && event.metric === "height"
        ),
      ),
      182,
    );
    assert.equal(
      latestLiveRecords(afterUpdate).find((event) => event.id === demographics.id)?.reportedGender,
      "female",
    );
    assert.equal(replay.applied, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction menstrual fact fingerprints survive insertion and reordering while edits protect omissions", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-menstrual-semantic-facets");
  const snapshot = (input: { qualities: string[]; updatedAt: string }) => ({
    importedAt: input.updatedAt,
    summaries: {
      menstrual_cycle: [{
        id: "stable-cycle-member-edit",
        created_at: "2026-05-01T09:00:00Z",
        updated_at: input.updatedAt,
        period_start: "2026-05-01",
        cervical_mucus: input.qualities.map((quality) => ({
          date: "2026-05-12",
          quality,
        })),
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const importSnapshot = (input: { qualities: string[]; updatedAt: string }) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "junction",
        vaultRoot,
        snapshot: snapshot(input),
      },
      { corePort: coreRuntime },
    );
    const first = await importSnapshot({
      qualities: ["egg_white"],
      updatedAt: "2026-05-20T09:00:00.000Z",
    });
    const editedFact = first.events.find((event) =>
      storedMeasurements(event).some((measurement) =>
        measurement.metric === "cervical-mucus"
        && measurement.qualifiers?.quality === "egg_white"
      )
    );
    assert.ok(editedFact);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: { ...editedFact, note: "member context", source: "manual" },
    });

    const inserted = await importSnapshot({
      qualities: ["watery", "egg_white"],
      updatedAt: "2026-05-21T09:00:00.000Z",
    });
    const replay = await importSnapshot({
      qualities: ["egg_white", "watery"],
      updatedAt: "2026-05-21T09:00:00.000Z",
    });
    const rows = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...inserted.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveFacts = latestLiveRecords(rows).filter((event) =>
      storedMeasurements(event).some((measurement) => measurement.metric === "cervical-mucus")
    );
    const liveEditedFact = liveFacts.find((event) => event.id === editedFact.id);

    assert.equal(replay.applied, false);
    assert.equal(liveFacts.length, 2);
    assert.equal(liveEditedFact?.note, "member context");
    assert.equal(liveEditedFact?.source, "manual");
    assert.equal(storedExternalRefField(liveEditedFact, "facet"), editedFact.externalRef?.facet);
    assert.ok(liveFacts.every((event) =>
      /^cervical-mucus-2026-05-12-[a-f0-9]{16}$/u.test(storedExternalRefField(event, "facet") ?? "")
    ));
    assert.ok(liveFacts.every((event) =>
      !/(egg|white|watery)/u.test(storedExternalRefField(event, "facet") ?? "")
    ));

    const omitted = await importSnapshot({
      qualities: ["watery"],
      updatedAt: "2026-05-22T09:00:00.000Z",
    });
    const afterOmission = (
      await Promise.all(
        [...new Set([...first.eventShardPaths, ...omitted.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const retainedEditedFact = latestLiveRecords(afterOmission).find((event) =>
      event.id === editedFact.id
    );
    assert.equal(retainedEditedFact?.note, "member context");
    assert.equal(retainedEditedFact?.source, "manual");
    assert.ok(afterOmission.some((event) =>
      event.id === editedFact.id && isDeletedEventLifecycle(event.lifecycle)
    ));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction menstrual evidence admits actual cycles and known facts before bounded evidence", () => {
  const predictedCycles = Array.from({ length: 64 }, (_, index) => ({
    id: `predicted-${index}`,
    is_predicted: true,
    period_start: "2026-06-01",
    source: { provider: "apple_health", type: "phone" },
  }));
  const futureQualities = Array.from({ length: 513 }, (_, index) => ({
    date: "2026-04-18",
    quality: `future-quality-${String(index).padStart(3, "0")}`,
  }));
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-02T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [
        ...predictedCycles,
        {
          id: "actual-cycle",
          period_start: "2026-04-07",
          cervical_mucus: [...futureQualities, { date: "2026-04-18", quality: "watery" }],
          source: { provider: "apple_health", type: "phone" },
        },
      ],
    },
  });
  const evidence = readJunctionMenstrualCycleEvidence(payload);

  assert.equal(evidence.cycleCount, 64);
  assert.equal(evidence.omittedCycleCount, 1);
  assert.equal(evidence.factCount, 512);
  assert.equal(evidence.omittedFactCount, 2);
  assert.equal(evidence.cycles[0]?.isPredicted, false);
  assert.equal(evidence.cycles[0]?.periodStart, "2026-04-07");
  assert.ok(evidence.facts.some((fact) => fact.kind === "cervical_mucus" && fact.value === "watery"));
  assert.ok(payload.events?.some((event) =>
    event.title === "Junction cervical mucus" && JSON.stringify(event.fields).includes("watery")
  ));
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("Junction menstrual evidence and receipt hashes are stable under provider-array reordering", async () => {
  const firstCycle = {
    id: "private-cycle-id-one",
    period_start: "2026-04-07",
    period_end: "2026-04-11",
    cycle_end: "2026-05-01",
    menstrual_flow: [
      { date: "2026-04-07", flow: "light" },
      { date: "2026-04-08", flow: "heavy" },
    ],
    cervical_mucus: [
      { date: "2026-04-18", quality: "watery" },
      { date: "2026-04-19", quality: "egg_white" },
    ],
    source: {
      provider: "apple_health",
      type: "phone",
      app_id: "private-app-id",
      device_id: "private-device-id",
    },
  };
  const secondCycle = {
    id: "private-cycle-id-two",
    period_start: "2026-05-05",
    sexual_activity: [
      { date: "2026-05-12", protection_used: true },
      { date: "2026-05-13", protection_used: false },
    ],
    source: { provider: "apple_health", type: "phone" },
  };
  const snapshot = (reverse: boolean) => ({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      menstrual_cycle: reverse
        ? [{
            ...secondCycle,
            sexual_activity: [...secondCycle.sexual_activity].reverse(),
          }, {
            ...firstCycle,
            menstrual_flow: [...firstCycle.menstrual_flow].reverse(),
            cervical_mucus: [...firstCycle.cervical_mucus].reverse(),
          }]
        : [firstCycle, secondCycle],
    },
  });
  const ordered = normalizeJunctionSnapshot(snapshot(false));
  const reversed = normalizeJunctionSnapshot(snapshot(true));
  const prepare = (reverse: boolean) => prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_menstrual_order",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: snapshot(reverse),
  });
  const [orderedImport, reversedImport] = await Promise.all([prepare(false), prepare(true)]);
  const orderedEvidence = readJunctionMenstrualCycleEvidence(ordered);

  assert.deepEqual(orderedEvidence, readJunctionMenstrualCycleEvidence(reversed));
  assert.deepEqual(
    ordered.events?.map((event) => event.externalRef).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ),
    reversed.events?.map((event) => event.externalRef).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ),
  );
  assert.equal(
    readRawReceiptArtifact(orderedImport).payloadHash,
    readRawReceiptArtifact(reversedImport).payloadHash,
  );
  const evidenceText = JSON.stringify(orderedEvidence);
  assert.doesNotMatch(evidenceText, /"menstrual_flow":\[/u);
  assert.doesNotMatch(evidenceText, /"cervical_mucus":\[/u);
  assert.doesNotMatch(evidenceText, /"sexual_activity":\[/u);
  assertJsonOmits(evidenceText, [
    "private-cycle-id-one",
    "private-cycle-id-two",
    "private-app-id",
    "private-device-id",
  ]);
  assert.equal(ordered.samples?.length ?? 0, 0);
  assert.equal(reversed.samples?.length ?? 0, 0);
});

test("Junction menstrual preparation keeps same-provider source instances distinct and replay-safe", async () => {
  const snapshot = {
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      menstrual_cycle: ["private-device-one", "private-device-two"].map((deviceId) => ({
        id: "shared-provider-cycle-id",
        updated_at: "2026-05-20T10:00:00.000Z",
        period_start: "2026-05-01",
        period_end: "2026-05-05",
        menstrual_flow: [{ date: "2026-05-02", flow: "medium" }],
        source: { provider: "apple_health", type: "phone", device_id: deviceId },
      })),
    },
  };
  const normalized = normalizeJunctionSnapshot(snapshot);
  const evidence = readJunctionMenstrualCycleEvidence(normalized);
  const flows = normalized.events?.filter((event) => event.title === "Junction menstrual flow") ?? [];
  const flowResourceIds = new Set(flows.map((event) => event.externalRef?.resourceId));
  const vaultRoot = await makeTempDirectory("murph-junction-menstrual-source-instances");

  assert.equal(evidence.cycleCount, 2);
  assert.equal(evidence.factCount, 2);
  assert.equal(new Set(evidence.cycles.map((cycle) => cycle.recordHash)).size, 2);
  assert.equal(new Set(evidence.facts.map((fact) => fact.cycleRecordHash)).size, 2);
  assert.equal(flows.length, 2);
  assert.equal(flowResourceIds.size, 2);
  assertJsonOmits(evidence, [
    "shared-provider-cycle-id",
    "private-device-one",
    "private-device-two",
  ]);

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-19T00:00:00.000Z",
      timezone: "UTC",
    });
    const importSnapshot = () =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        { provider: "junction", vaultRoot, snapshot },
        { corePort: coreRuntime },
      );
    const first = await importSnapshot();
    const replay = await importSnapshot();
    const importedFlows = first.events.filter((event) => event.title === "Junction menstrual flow");

    assert.equal(importedFlows.length, 2);
    assert.equal(new Set(importedFlows.map((event) => event.externalRef?.resourceId)).size, 2);
    assert.equal(replay.applied, false);
    assert.equal(replay.samples.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction menstrual caps keep newest cycles and facts with deterministic omission hashing", async () => {
  const isoDate = (index: number) =>
    new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
  const cycles = Array.from({ length: 65 }, (_, index) => ({
    id: `cycle-${index}`,
    period_start: isoDate(index),
    source: { provider: "apple_health", type: "phone" },
  }));
  const orderedCycles = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: { menstrual_cycle: cycles },
  });
  const reversedCycles = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: { menstrual_cycle: [...cycles].reverse() },
  });
  const cycleEvidence = readJunctionMenstrualCycleEvidence(orderedCycles);

  assert.deepEqual(cycleEvidence, readJunctionMenstrualCycleEvidence(reversedCycles));
  assert.equal(cycleEvidence.cycleCount, 64);
  assert.equal(cycleEvidence.omittedCycleCount, 1);
  assert.equal(cycleEvidence.cycles[0]?.periodStart, isoDate(64));
  assert.equal(cycleEvidence.cycles.some((cycle) => cycle.periodStart === isoDate(0)), false);

  const facts = Array.from({ length: 513 }, (_, index) => ({
    date: isoDate(index),
    quality: "watery",
  }));
  const factSnapshot = (inputFacts: typeof facts) => ({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "bounded-fact-cycle",
        period_start: "2024-01-01",
        cervical_mucus: inputFacts,
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  });
  const baseNormalized = normalizeJunctionSnapshot(factSnapshot(facts));
  const baseEvidence = readJunctionMenstrualCycleEvidence(baseNormalized);
  const reversedEvidence = readJunctionMenstrualCycleEvidence(
    normalizeJunctionSnapshot(factSnapshot([...facts].reverse())),
  );
  const omittedChangedFacts = facts.map((fact, index) =>
    index === 0 ? { ...fact, quality: "egg_white" } : fact
  );
  const admittedChangedFacts = facts.map((fact, index) =>
    index === facts.length - 1 ? { ...fact, quality: "egg_white" } : fact
  );
  const prepare = (inputFacts: typeof facts) => prepareDeviceProviderSnapshotImport({
    provider: "junction",
    connectionId: "conn_junction_menstrual_caps",
    sourceKind: "poll",
    deliveryMode: "scheduled_reconcile",
    normalizerVersion: "junction-normalizer.v1",
    snapshot: factSnapshot(inputFacts),
  });
  const [baseImport, reversedImport, omittedChangedImport, admittedChangedImport] = await Promise.all([
    prepare(facts),
    prepare([...facts].reverse()),
    prepare(omittedChangedFacts),
    prepare(admittedChangedFacts),
  ]);

  assert.deepEqual(baseEvidence, reversedEvidence);
  assert.equal(baseEvidence.factCount, 512);
  assert.equal(baseEvidence.omittedFactCount, 1);
  assert.equal(baseEvidence.facts[0]?.date, isoDate(512));
  assert.equal(baseEvidence.facts.some((fact) => fact.date === isoDate(0)), false);
  assert.deepEqual(
    new Set(
      baseNormalized.events
        ?.filter((event) => event.kind === "measurement")
        .map((event) => event.dayKey),
    ),
    new Set(baseEvidence.facts.map((fact) => fact.date)),
  );
  assert.equal(
    readRawReceiptArtifact(baseImport).payloadHash,
    readRawReceiptArtifact(reversedImport).payloadHash,
  );
  assert.equal(
    readRawReceiptArtifact(baseImport).payloadHash,
    readRawReceiptArtifact(omittedChangedImport).payloadHash,
  );
  assert.notEqual(
    readRawReceiptArtifact(baseImport).payloadHash,
    readRawReceiptArtifact(admittedChangedImport).payloadHash,
  );
});

test("Junction commits the composed 514-facet menstrual maximum and replays as a no-op", async () => {
  const isoDate = (index: number) =>
    new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
  const snapshot = {
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      menstrual_cycle: [{
        id: "maximum-canonical-cycle",
        updated_at: "2026-05-20T10:00:00.000Z",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        cycle_end: "2024-01-29",
        cervical_mucus: Array.from({ length: 512 }, (_, index) => ({
          date: isoDate(index),
          quality: "watery",
        })),
        source: { provider: "apple_health", type: "phone" },
      }],
    },
  };
  const normalized = normalizeJunctionSnapshot(snapshot);
  const evidence = readJunctionMenstrualCycleEvidence(normalized);
  const authoritativeSet = normalized.authoritativeEventSets?.[0];
  const vaultRoot = await makeTempDirectory("murph-junction-menstrual-514-facets");

  assert.equal(evidence.factCount, 512);
  assert.equal(evidence.omittedFactCount, 0);
  assert.equal(normalized.events?.length, 514);
  assert.equal(authoritativeSet?.currentFacets.length, 514);
  assert.equal(normalized.samples?.length ?? 0, 0);

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-05-19T00:00:00.000Z",
      timezone: "UTC",
    });
    const importSnapshot = () =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        { provider: "junction", vaultRoot, snapshot },
        { corePort: coreRuntime },
      );
    const first = await importSnapshot();
    const watchedPaths = [...new Set([
      ...first.eventShardPaths,
      first.ingestShardPath,
      first.auditPath,
    ].filter((relativePath): relativePath is string => typeof relativePath === "string"))];
    const beforeReplay = await Promise.all(
      watchedPaths.map((relativePath) => readFile(join(vaultRoot, relativePath))),
    );
    const replay = await importSnapshot();

    assert.equal(first.applied, true);
    assert.equal(first.events.length, 514);
    assert.equal(first.samples.length, 0);
    assert.equal(replay.applied, false);
    assert.equal(replay.ingestId, null);
    assert.equal(replay.samples.length, 0);
    assert.deepEqual(
      await Promise.all(
        watchedPaths.map((relativePath) => readFile(join(vaultRoot, relativePath))),
      ),
      beforeReplay,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
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

test("Junction normalizer ignores unknown legacy dense-resource names", () => {
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
      electrocardiogram_waveform_legacy: [{
        timestamp: "2026-04-22T18:00:00Z",
        value: 0.2,
      }],
      workout_heartrate: [{
        timestamp: "2026-04-22T18:00:00Z",
        value: 64,
      }],
    },
  });

  assert.deepEqual(payload.provenance?.summaryResources, []);
  assert.deepEqual(payload.provenance?.timeseriesResources, []);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-workout-stream"), false);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-electrocardiogram-waveform-legacy"), false);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "junction-timeseries-workout-heartrate"), false);
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
        electrocardiogram_waveform_legacy: [{
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
  assert.doesNotMatch(rawArtifactText, /unsupported_clinical_value|electrocardiogram_waveform_legacy/u);
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
        electrocardiogram_waveform_legacy: [{ timestamp: "2026-04-22T18:00:00Z", value: 0.2 }],
        workout_heartrate: [{ timestamp: "2026-04-22T18:00:00Z", value: 64 }],
        workout_power: [{ timestamp: "2026-04-22T18:00:00Z", value: 250 }],
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
    "electrocardiogram_waveform_legacy",
    "workout_heartrate",
    "workout_power",
    "\"value\":64",
    "\"value\":250",
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
        workout_heartrate: [{ timestamp: "2026-04-22T18:00:00Z", value: 64 }],
        workout_power: [{ timestamp: "2026-04-22T18:00:00Z", value: 250 }],
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
    "workout_heartrate",
    "workout_power",
    "\"value\":64",
    "\"value\":250",
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
  const heartRateEvent = payload.events?.find((event) => event.fields?.metric === "average-heart-rate");
  const activeCaloriesEvent = payload.events?.find((event) => event.fields?.metric === "active-calories");
  const weightEvent = payload.events?.find((event) =>
    event.kind === "measurement"
    && (event.fields?.measurements as Array<Record<string, unknown>> | undefined)
      ?.some((measurement) => measurement.metric === "weight")
  );
  const weightMeasurement = (
    weightEvent?.fields?.measurements as Array<Record<string, unknown>> | undefined
  )?.[0];

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(
    payload.provenance?.timeseriesResources,
    ["heartrate", "weight", "calories_active", "glucose"],
  );
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-sleep-cycle"));
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "heartrate").length, 1);
  assert.equal(findJunctionWeightReadingArtifacts(payload).length, 1);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "calories-active").length, 1);
  assert.equal(findJunctionCompactTimeseriesArtifacts(payload, "glucose").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(payload.events?.some((event) => event.externalRef?.resourceType === "junction-garmin-hypnogram"), false);
  assert.equal(heartRateEvent?.fields?.value, 61);
  assert.equal(activeCaloriesEvent?.fields?.value, 123);
  assert.deepEqual(weightMeasurement, { metric: "weight", value: 82.1, unit: "kg" });
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

  const weightEvents = (payload.events ?? []).filter((event) => event.kind === "measurement");

  assert.deepEqual(payload.provenance?.summaryResources, ["sleep_cycle"]);
  assert.deepEqual(payload.provenance?.timeseriesResources, ["weight", "calories_active"]);
  assert.equal(
    payload.evidenceParts?.filter((artifact) => artifact.role === "junction-summary-sleep-cycle").length,
    1,
  );
  assert.equal(findJunctionWeightReadingArtifacts(payload).length, 2);
  assert.equal(findJunctionFeatureTimeseriesArtifacts(payload, "calories-active").length, 1);
  assertNoFullJunctionTimeseriesArtifacts(payload);
  assert.equal(weightEvents.length, 2);
  assert.equal(payload.events?.some((event) => event.fields?.metric === "active-calories"), true);
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
          latency: 600,
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
  assert.equal(metricValue("sleep-latency-minutes"), 10);
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

test("Junction sleep latency only bypasses seconds conversion for minute-named fields", () => {
  const secondsPayload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [{
        source: { provider: "garmin", type: "watch" },
        id: "sleep-latency-seconds",
        date: "2026-05-20T08:00:00+00:00",
        sleep_latency: 900,
        unit: "minutes",
      }],
    },
  });
  const minutesPayload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [{
        source: { provider: "garmin", type: "watch" },
        id: "sleep-latency-minutes",
        date: "2026-05-20T08:00:00+00:00",
        latency_minutes: 15,
        unit: "seconds",
      }],
    },
  });
  const latencyObservation = (payload: ReturnType<typeof normalizeJunctionSnapshot>) =>
    payload.events?.find((event) => event.fields?.metric === "sleep-latency-minutes");

  for (const payload of [secondsPayload, minutesPayload]) {
    const observation = latencyObservation(payload);
    assert.equal(observation?.fields?.value, 15);
    assert.equal(observation?.fields?.unit, "minutes");
    assert.equal(observation?.externalRef?.facet, "sleep-latency-minutes");
    assert.equal(observation?.externalRef?.resourceType, "junction-garmin-sleep");
    assert.equal(observation?.dataOrigin?.aggregatorProvider, "junction");
    assert.equal(observation?.dataOrigin?.sourceProviderSlug, "garmin");
    assert.deepEqual(observation?.evidenceRoles, ["junction-summary-sleep"]);
  }
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
          avg_bpm: 72,
          avg_walking_bpm: 83,
          max_bpm: 148,
          min_bpm: 44,
          resting_bpm: 52,
        },
        high: 29,
        low: 84,
        medium: 15,
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
        bone_mass_percentage: 4.2,
        fat: 30,
        lean_body_mass_kilogram: 40.1,
        muscle_mass_percentage: 63.4,
        visceral_fat_index: 7,
        waist_circumference_centimeter: 86.36,
        water_percentage: 51.8,
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

  assert.equal(activityMinutes?.fields?.value, 128);
  assert.equal(activityMinutes?.fields?.unit, "minutes");
  assert.equal(activityMinutes?.externalRef?.facet, "activity-minutes");
  assert.equal(metricValue("low-activity-minutes"), 84);
  assert.equal(metricValue("medium-activity-minutes"), 15);
  assert.equal(metricValue("high-activity-minutes"), 29);
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
  assert.equal(metricValue("activity-average-heart-rate"), 72);
  assert.equal(metricValue("walking-average-heart-rate"), 83);
  assert.equal(metricValue("minimum-heart-rate"), 44);
  assert.equal(metricValue("resting-heart-rate"), 52);

  const activityFidelityMetrics = [
    "activity-minutes",
    "low-activity-minutes",
    "medium-activity-minutes",
    "high-activity-minutes",
    "activity-average-heart-rate",
    "walking-average-heart-rate",
    "minimum-heart-rate",
  ];
  const activityFidelityObservations = activityFidelityMetrics.map((metric) =>
    observations.find((event) => event.fields?.metric === metric)
  );
  assert.equal(activityFidelityObservations.every((event) => event !== undefined), true);
  assert.deepEqual(
    activityFidelityObservations.map((event) => event?.externalRef?.facet),
    activityFidelityMetrics,
  );
  const activityFidelityResourceIds = activityFidelityObservations.map(
    (event) => event?.externalRef?.resourceId,
  );
  assert.equal(
    activityFidelityResourceIds.every((resourceId) => typeof resourceId === "string"),
    true,
  );
  assert.equal(new Set(activityFidelityResourceIds).size, 1);
  assert.ok(activityFidelityObservations.every((event) =>
    event?.externalRef?.resourceType === "junction-garmin-activity"
    && event?.dataOrigin?.aggregatorProvider === "junction"
    && event?.dataOrigin?.sourceProviderSlug === "garmin"
    && event?.evidenceRoles?.length === 1
    && event?.evidenceRoles?.[0] === "junction-summary-activity"
  ));

  assert.equal(metricValue("weight"), 80);
  assert.equal(metricValue("bmi"), 22.3);
  assert.equal(metricValue("body-fat-percentage"), 30);
  assert.equal(metricValue("bone-mass-percentage"), 4.2);
  assert.equal(metricValue("muscle-mass-percentage"), 63.4);
  assert.equal(metricValue("visceral-fat-index"), 7);
  assert.equal(metricValue("body-water-percentage"), 51.8);
  assert.equal(metricValue("waist-circumference"), 86.36);
  assert.equal(metricValue("lean-body-mass"), 40.1);
  assert.equal(metricValue("temperature"), 36.7);
  assert.match(JSON.stringify(rawBodyArtifact?.content), /"lean_body_mass_kilogram":40.1/u);
  assert.ok(observations.every((event) => event.fields?.observationGrain === "summary"));
});

test("Junction body composition summaries preserve distinct facts, provenance, and replay identity", () => {
  const snapshot = {
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      body: [{
        source: {
          provider: "withings",
          type: "scale",
        },
        id: "body-composition-fidelity",
        date: "2026-05-20T08:00:00+00:00",
        unit: "kg",
        bone_mass_percentage: 4.2,
        muscle_mass_percentage: 61.8,
        visceral_fat_index: 7,
        water_percentage: 54.6,
        height: 1.82,
      }],
    },
  };

  const first = normalizeJunctionSnapshot(snapshot);
  const replay = normalizeJunctionSnapshot(snapshot);
  const expectedMetrics = new Set([
    "body-water-percentage",
    "bone-mass-percentage",
    "muscle-mass-percentage",
    "visceral-fat-index",
  ]);
  const observations = (first.events ?? []).filter(
    (event) => event.kind === "observation" && expectedMetrics.has(String(event.fields?.metric)),
  );
  const replayObservations = (replay.events ?? []).filter(
    (event) => event.kind === "observation" && expectedMetrics.has(String(event.fields?.metric)),
  );
  const evidenceParts = (first.evidenceParts ?? []).filter(
    (part) => part.role === "junction-summary-body",
  );

  assert.deepEqual(
    observations
      .map((event) => ({
        facet: event.externalRef?.facet,
        metric: event.fields?.metric,
        unit: event.fields?.unit,
        value: event.fields?.value,
      }))
      .sort((left, right) => String(left.metric).localeCompare(String(right.metric))),
    [
      { facet: "body-water-percentage", metric: "body-water-percentage", unit: "%", value: 54.6 },
      { facet: "bone-mass-percentage", metric: "bone-mass-percentage", unit: "%", value: 4.2 },
      { facet: "muscle-mass-percentage", metric: "muscle-mass-percentage", unit: "%", value: 61.8 },
      { facet: "visceral-fat-index", metric: "visceral-fat-index", unit: "index", value: 7 },
    ],
  );
  assert.equal(new Set(observations.map((event) => event.externalRef?.resourceId)).size, 1);
  assert.ok(observations.every((event) => event.externalRef?.system === "junction"));
  assert.ok(observations.every((event) => event.externalRef?.resourceType === "junction-withings-body"));
  assert.ok(observations.every((event) => event.dataOrigin?.aggregatorProvider === "junction"));
  assert.ok(observations.every((event) => event.dataOrigin?.sourceProviderSlug === "withings"));
  assert.ok(observations.every((event) => event.dataOrigin?.sourceType === "scale"));
  assert.ok(observations.every((event) => event.evidenceRoles?.join(",") === "junction-summary-body"));
  assert.deepEqual(
    replayObservations.map((event) => event.externalRef),
    observations.map((event) => event.externalRef),
  );
  assert.equal(evidenceParts.length, 1);
  assert.match(JSON.stringify(evidenceParts[0]?.content), /"bone_mass_percentage":4.2/u);
  assert.match(JSON.stringify(evidenceParts[0]?.content), /"muscle_mass_percentage":61.8/u);
  assert.match(JSON.stringify(evidenceParts[0]?.content), /"visceral_fat_index":7/u);
  assert.match(JSON.stringify(evidenceParts[0]?.content), /"water_percentage":54.6/u);
  assert.equal(first.events?.some((event) => event.fields?.metric === "height"), false);
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
    { low: 20, medium: 10, high: 1441 },
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
  assert.equal(payload.events?.filter((event) => event.fields?.metric === "low-activity-minutes").length, 5);
  assert.equal(payload.events?.filter((event) => event.fields?.metric === "medium-activity-minutes").length, 4);
  assert.equal(payload.events?.filter((event) => event.fields?.metric === "high-activity-minutes").length, 2);
  assert.equal(payload.events?.some((event) =>
    event.fields?.metric === "high-activity-minutes" && event.fields.value === 1441
  ), false);
});

test("Junction normalizer rejects invalid sleep latency and activity heart rates", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-05-20T12:00:00.000Z",
    summaries: {
      sleep: [{
        source: { provider: "oura", type: "ring" },
        id: "sleep-invalid-latency",
        date: "2026-05-20T08:00:00+00:00",
        latency: -60,
      }],
      activity: [{
        source: { provider: "garmin", type: "watch" },
        id: "activity-invalid-heart-rates",
        date: "2026-05-20T00:00:00+00:00",
        heart_rate: {
          avg_bpm: -1,
          avg_walking_bpm: -2,
          min_bpm: -3,
        },
      }],
    },
  });
  const metrics = new Set(
    (payload.events ?? []).map((event) => event.fields?.metric),
  );

  assert.equal(metrics.has("sleep-latency-minutes"), false);
  assert.equal(metrics.has("average-heart-rate"), false);
  assert.equal(metrics.has("walking-average-heart-rate"), false);
  assert.equal(metrics.has("minimum-heart-rate"), false);
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
