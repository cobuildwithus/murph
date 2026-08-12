import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import * as coreRuntime from "@murphai/core";
import {
  eventRevisionFromLifecycle,
  isDeletedEventLifecycle,
  workoutSessionSchema,
  type WorkoutSessionMetrics,
} from "@murphai/contracts";

import {
  createDeviceProviderRegistry,
  createImporters,
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
  type DeviceProviderAdapter,
  type DeviceProviderSnapshotImportPayload,
  type NormalizedDeviceBatch,
  type WearableRawIngestReceipt,
} from "../src/index.ts";
import { normalizeWhoopSnapshot } from "../src/device-providers/whoop.ts";
import {
  makeNormalizedDeviceBatch,
  type NormalizedDeviceBatchOptions,
} from "../src/device-providers/shared-normalization.ts";

type AssertTrue<T extends true> = T;
type IsMutuallyAssignable<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type StoredJsonlRecord = Awaited<ReturnType<typeof coreRuntime.readJsonlRecords>>[number];

test("WHOOP sleep normalization preserves strict nap identity and leaves missing flags unknown", () => {
  const sleeps = [
    { id: "main", nap: false },
    { id: "nap", nap: true },
    { id: "missing" },
  ].map((sleep, index) => ({
    ...sleep,
    start: `2026-03-${String(10 + index).padStart(2, "0")}T01:00:00.000Z`,
    end: `2026-03-${String(10 + index).padStart(2, "0")}T02:00:00.000Z`,
  }));
  const payload = normalizeWhoopSnapshot({
    importedAt: "2026-03-16T10:00:00.000Z",
    sleeps,
  });
  const byId = new Map(
    payload.events
      ?.filter((event) => event.kind === "sleep_session")
      .map((event) => [event.externalRef?.resourceId, event.fields?.sleepType]),
  );

  assert.equal(byId.get("main"), "main_sleep");
  assert.equal(byId.get("nap"), "nap");
  assert.equal(byId.get("missing"), undefined);
});

type _normalizedDeviceBatchMatchesCorePayload = AssertTrue<
  IsMutuallyAssignable<NormalizedDeviceBatch, Omit<DeviceBatchImportPayload, "vaultRoot">>
>;
type _normalizedDeviceBatchOptionsOmitSource = AssertTrue<
  IsMutuallyAssignable<NormalizedDeviceBatchOptions, Omit<NormalizedDeviceBatch, "source">>
>;
type _deviceProviderSnapshotImportPayloadLayersSnapshotOntoCorePayload = AssertTrue<
  IsMutuallyAssignable<
    DeviceProviderSnapshotImportPayload,
    DeviceBatchImportPayload & { snapshot: unknown }
  >
>;
type CoreDeviceImportResult = Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>;
type CoreDeviceImportEvent = CoreDeviceImportResult["events"][number];

interface DeviceProviderCoreContractFixture {
  expectedEventKinds?: readonly string[];
  expectedObservationMetrics?: readonly string[];
  expectedWorkoutMetrics?: readonly {
    metric: keyof WorkoutSessionMetrics;
    value: number;
  }[];
  label: string;
  provider: string;
  snapshot: Record<string, unknown>;
}

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

function readRawReceiptArtifact(payload: DeviceBatchImportPayload): WearableRawIngestReceipt {
  const receipt = payload.ingestReceipt as WearableRawIngestReceipt | undefined;
  assert.ok(receipt);
  assert.equal(receipt.schemaVersion, "wearable.raw_ingest_receipt.v1");
  return receipt;
}

function workoutMetricsFromEvent(
  event: { fields?: { workout?: unknown } } | undefined,
): WorkoutSessionMetrics | undefined {
  const result = workoutSessionSchema.safeParse(event?.fields?.workout);
  if (!result.success) {
    assert.fail(`workout contract paths: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return result.data.metrics;
}

function workoutMetricsFromCoreEvent(
  event: CoreDeviceImportEvent | undefined,
): WorkoutSessionMetrics | undefined {
  const workout = event && "workout" in event ? event.workout : undefined;
  const result = workoutSessionSchema.safeParse(workout);
  if (!result.success) {
    assert.fail(`core workout contract paths: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return result.data.metrics;
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

function storedExternalRefVersion(record: StoredJsonlRecord | undefined): string | undefined {
  const externalRef = record?.externalRef;
  if (!externalRef || typeof externalRef !== "object" || Array.isArray(externalRef)) {
    return undefined;
  }

  return typeof externalRef.version === "string" ? externalRef.version : undefined;
}

function assertWhoopScopedBodyDateResourceId(resourceId: string | undefined, dayKey: string): void {
  assert.match(resourceId ?? "", new RegExp(`^account:[0-9a-f]{16}/date:${dayKey}$`, "u"));
}

function whoopBodyDateResourceSuffix(resourceId: string | undefined): string | undefined {
  return resourceId?.replace(/^account:[0-9a-f]{16}\//u, "");
}

async function readRequiredIntegrationIngest(vaultRoot: string, ingestId: string) {
  const entry = await coreRuntime.readIntegrationIngestById(vaultRoot, ingestId);
  assert.ok(entry, `Expected integration ingest "${ingestId}" to exist.`);
  return entry.record;
}

function hasCoreEventKind(events: readonly CoreDeviceImportEvent[], kind: string): boolean {
  return events.some((event) => event.kind === kind);
}

function hasCoreObservationMetric(events: readonly CoreDeviceImportEvent[], metric: string): boolean {
  return events.some((event) => event.kind === "observation" && event.metric === metric);
}

test("makeNormalizedDeviceBatch preserves the canonical device payload shape and hardcodes device source", () => {
  const options: NormalizedDeviceBatchOptions = {
    provider: "polar",
    accountId: "polar-user-1",
    importedAt: "2026-03-16T12:00:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-03-16T12:00:00.000Z",
        title: "Polar daily steps",
        fields: {
          metric: "daily-steps",
          value: 12345,
          unit: "count",
        },
      },
    ],
    provenance: {
      importedSections: {
        dailySummaries: 1,
      },
    },
  };

  const payload: DeviceBatchImportPayload = {
    vaultRoot: "fixture-vault",
    ...makeNormalizedDeviceBatch(options),
  };

  assert.deepEqual(payload, {
    vaultRoot: "fixture-vault",
    ...options,
    source: "device",
  });
});

test("default provider contract fixtures round-trip canonical records through real core", async () => {
  const fixtures: readonly DeviceProviderCoreContractFixture[] = [
    {
      label: "whoop-recovery",
      provider: "whoop",
      snapshot: {
        accountId: "whoop-contract-user",
        importedAt: "2026-04-22T12:00:00.000Z",
        recoveries: [
          {
            sleep_id: "sleep-contract-1",
            updated_at: "2026-04-22T08:00:00.000Z",
            score: {
              recovery_score: 72,
              resting_heart_rate: 54,
            },
          },
        ],
      },
      expectedObservationMetrics: ["recovery-score", "resting-heart-rate"],
    },
    {
      label: "oura-readiness",
      provider: "oura",
      snapshot: {
        accountId: "oura-contract-user",
        importedAt: "2026-04-22T12:00:00.000Z",
        dailyActivity: [
          {
            day: "2026-04-22",
            steps: 4321,
          },
        ],
        dailyReadiness: [
          {
            day: "2026-04-22",
            score: 81,
          },
        ],
      },
      expectedObservationMetrics: ["daily-steps", "readiness-score"],
    },
    {
      label: "junction-timeseries-aggregate",
      provider: "junction",
      snapshot: {
        accountId: "junction-contract-user",
        importedAt: "2026-04-22T12:00:00.000Z",
        timeseries: {
          blood_oxygen: {
            groups: {
              garmin: [
                {
                  data: [
                    { timestamp: "2026-04-22T07:15:00.000Z", unit: "percent", value: 97 },
                    { timestamp: "2026-04-22T07:45:00.000Z", unit: "percent", value: 93 },
                  ],
                  source: { provider: "garmin", type: "watch" },
                },
              ],
            },
          },
          stress_level: {
            groups: {
              garmin: [
                {
                  data: [
                    { timestamp: "2026-04-22T08:00:00.000Z", value: 25 },
                    { timestamp: "2026-04-22T16:00:00.000Z", value: 55 },
                  ],
                  source: { provider: "garmin", type: "watch" },
                },
              ],
            },
          },
        },
      },
      expectedObservationMetrics: ["lowest-spo2", "spo2", "stress-level"],
    },
    {
      label: "strava-activity",
      provider: "strava",
      snapshot: {
        accountId: "strava-contract-user",
        importedAt: "2026-04-22T12:00:00.000Z",
        activities: [
          {
            id: "strava-activity-1",
            name: "Morning run",
            sport_type: "Run",
            start_date: "2026-04-22T11:00:00.000Z",
            moving_time: 1800,
            distance: 5200,
            calories: 340,
            average_heartrate: 150,
            max_heartrate: 165,
            total_elevation_gain: 42,
            average_speed: 2.87,
            max_speed: 4.1,
          },
        ],
      },
      expectedEventKinds: ["activity_session"],
      expectedWorkoutMetrics: [
        { metric: "activeCalories", value: 340 },
        { metric: "averageHeartRate", value: 150 },
        { metric: "maxHeartRate", value: 165 },
        { metric: "totalElevationGainMeters", value: 42 },
        { metric: "averageSpeedMps", value: 2.87 },
        { metric: "maxSpeedMps", value: 4.1 },
      ],
    },
  ];

  for (const fixture of fixtures) {
    const vaultRoot = await makeTempDirectory(`murph-provider-contract-${fixture.label}`);
    try {
      await coreRuntime.initializeVault({
        vaultRoot,
        createdAt: "2026-04-22T00:00:00.000Z",
        timezone: "UTC",
      });

      const result = await importDeviceProviderSnapshot<CoreDeviceImportResult>(
        {
          provider: fixture.provider,
          vaultRoot,
          snapshot: fixture.snapshot,
        },
        {
          corePort: coreRuntime,
        },
      );

      assert.ok(result.events.length > 0, `${fixture.label} should write at least one canonical event`);
      assert.equal(result.samples.length, 0, `${fixture.label} should not write generic sample telemetry`);
      assert.ok(result.evidencePartCount > 0, `${fixture.label} should retain raw evidence`);

      for (const eventKind of fixture.expectedEventKinds ?? []) {
        assert.ok(
          hasCoreEventKind(result.events, eventKind),
          `${fixture.label} should write a canonical ${eventKind} event`,
        );
      }

      for (const metric of fixture.expectedObservationMetrics ?? []) {
        assert.ok(
          hasCoreObservationMetric(result.events, metric),
          `${fixture.label} should write a canonical ${metric} observation`,
        );
      }

      if ((fixture.expectedWorkoutMetrics ?? []).length > 0) {
        const activityEvent = result.events.find((event) => event.kind === "activity_session");
        const workoutMetrics = workoutMetricsFromCoreEvent(activityEvent);

        for (const { metric, value } of fixture.expectedWorkoutMetrics ?? []) {
          assert.equal(
            workoutMetrics?.[metric],
            value,
            `${fixture.label} should retain canonical workout metric ${metric}`,
          );
        }
      }
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  }
});

test("prepareDeviceProviderSnapshotImport normalizes WHOOP snapshots into canonical device payloads", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    vaultRoot: "canonical-vault",
    vault: "fixture-vault",
    snapshot: {
      accountId: "whoop-user-1",
      importedAt: "2026-03-16T09:30:00.000Z",
      profile: {
        user_id: "whoop-user-1",
      },
      bodyMeasurements: {
        height_meter: 1.82,
        weight_kilogram: 82.1,
        max_heart_rate: 188,
      },
      sleeps: [
        {
          id: "sleep-1",
          start: "2026-03-15T22:00:00.000Z",
          end: "2026-03-16T07:00:00.000Z",
          updated_at: "2026-03-16T07:30:00.000Z",
          score: {
            respiratory_rate: 14.8,
            sleep_performance_percentage: 89,
            sleep_consistency_percentage: 83,
            sleep_efficiency_percentage: 94,
            stage_summary: {
              total_awake_time_milli: 900000,
              total_light_sleep_time_milli: 18900000,
              total_slow_wave_sleep_time_milli: 6300000,
              total_rem_sleep_time_milli: 5400000,
            },
          },
        },
      ],
      recoveries: [
        {
          sleep_id: "sleep-1",
          updated_at: "2026-03-16T07:30:00.000Z",
          score: {
            recovery_score: 67,
            resting_heart_rate: 54,
            hrv_rmssd_milli: 42.5,
            spo2_percentage: 97.1,
            skin_temp_celsius: 36.5,
          },
        },
      ],
      cycles: [
        {
          id: "cycle-1",
          start: "2026-03-15T00:00:00.000Z",
          end: "2026-03-15T23:59:59.000Z",
          updated_at: "2026-03-16T00:05:00.000Z",
          score: {
            strain: 14.2,
            kilojoule: 890,
            average_heart_rate: 73,
            max_heart_rate: 154,
          },
        },
      ],
      workouts: [
        {
          id: "workout-1",
          start: "2026-03-15T17:00:00.000Z",
          end: "2026-03-15T17:45:00.000Z",
          updated_at: "2026-03-15T18:00:00.000Z",
          sport_name: "Run",
          altitude_gain_meter: 42,
          score: {
            strain: 11.3,
            average_heart_rate: 141,
            max_heart_rate: 168,
            kilojoule: 510,
            percent_recorded: 99,
            distance_meter: 7250,
          },
        },
      ],
    },
  });

  assert.equal(payload.vaultRoot, "canonical-vault");
  assert.equal(payload.provider, "whoop");
  assert.equal(payload.accountId, "whoop-user-1");
  assert.equal(payload.source, "device");
  assert.ok(payload.events?.some((event) => event.kind === "sleep_session"));
  assert.ok(payload.events?.some((event) => event.kind === "activity_session"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "recovery-score"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "day-strain"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "weight"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "bmi"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "respiratory-rate"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "hrv"));
  assert.ok(payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "temperature"));
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "profile"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "body-measurement"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "sleep:sleep-1"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "workout:workout-1"));

  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");
  const workoutObservationMetrics = payload.events
    ?.filter((event) => event.kind === "observation" && event.externalRef?.resourceType === "workout")
    .map((event) => event.fields?.metric) ?? [];
  const hrvEvent = payload.events?.find((event) => event.fields?.metric === "hrv");
  const bmiEvent = payload.events?.find((event) => event.fields?.metric === "bmi");

  assert.deepEqual(sleepEvent?.fields, {
    startAt: "2026-03-15T22:00:00.000Z",
    endAt: "2026-03-16T07:00:00.000Z",
    durationMinutes: 540,
  });
  assert.equal(workoutEvent?.fields?.activityType, "run");
  assert.equal(workoutEvent?.fields?.distanceKm, 7.25);
  assert.deepEqual(workoutMetricsFromEvent(workoutEvent), {
    workoutStrain: 11.3,
    averageHeartRate: 141,
    maxHeartRate: 168,
    totalCalories: 121.8929,
    percentRecorded: 99,
    totalElevationGainMeters: 42,
  });
  assert.deepEqual(workoutObservationMetrics, []);
  assert.equal(hrvEvent?.fields?.value, 42.5);
  assert.equal(hrvEvent?.externalRef?.facet, "hrv");
  assert.equal(bmiEvent?.dayKey, undefined);
});

test("importDeviceProviderSnapshot keeps WHOOP provider-local days across UTC-midnight imports", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-local-day");

  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const result = await importDeviceProviderSnapshot<CoreDeviceImportResult>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-local-day-user",
          importedAt: "2026-06-25T12:00:00.000Z",
          bodyMeasurements: {
            measured_at: "2026-06-25T03:30:00.000Z",
            weight_kilogram: 78.2,
          },
          sleeps: [
            {
              id: "sleep-local-24",
              cycle_id: "cycle-local-24",
              start: "2026-06-25T02:30:00.000Z",
              end: "2026-06-25T03:45:00.000Z",
              updated_at: "2026-06-25T04:00:00.000Z",
              timezone_offset: "-04:00",
              score: {
                respiratory_rate: 14.2,
              },
            },
            {
              id: "sleep-recovery-local-24",
              cycle_id: "cycle-recovery-no-offset",
              start: "2026-06-25T02:30:00.000Z",
              end: "2026-06-25T03:45:00.000Z",
              updated_at: "2026-06-25T04:00:00.000Z",
              timezone_offset: "-04:00",
              score: {},
            },
            {
              id: "sleep-no-offset-local-24",
              cycle_id: "cycle-no-offset-local-24",
              start: "2026-06-25T02:30:00.000Z",
              end: "2026-06-25T03:45:00.000Z",
              updated_at: "2026-06-25T04:00:00.000Z",
              score: {
                respiratory_rate: 13.9,
              },
            },
            {
              id: "sleep-no-offset-overnight-24",
              cycle_id: "cycle-no-offset-local-24",
              start: "2026-06-24T02:30:00.000Z",
              end: "2026-06-24T11:00:00.000Z",
              updated_at: "2026-06-24T11:30:00.000Z",
              score: {
                respiratory_rate: 13.7,
              },
            },
          ],
          cycles: [
            {
              id: "cycle-local-24",
              start: "2026-06-24T12:00:00.000Z",
              end: "2026-06-25T03:59:00.000Z",
              updated_at: "2026-06-25T04:10:00.000Z",
              timezone_offset: "-04:00",
              score: {
                strain: 12.4,
              },
            },
            {
              id: "cycle-recovery-no-offset",
              start: "2026-06-24T12:00:00.000Z",
              end: "2026-06-25T03:59:00.000Z",
              updated_at: "2026-06-25T04:10:00.000Z",
              score: {},
            },
            {
              id: "cycle-no-offset-local-24",
              start: "2026-06-24T12:00:00.000Z",
              end: "2026-06-25T03:59:00.000Z",
              updated_at: "2026-06-25T04:10:00.000Z",
              score: {
                strain: 10.1,
              },
            },
          ],
          recoveries: [
            {
              sleep_id: "sleep-recovery-local-24",
              cycle_id: "cycle-recovery-no-offset",
              updated_at: "2026-06-25T04:10:00.000Z",
              score: {
                recovery_score: 72,
              },
            },
            {
              sleep_id: "sleep-no-offset-local-24",
              cycle_id: "cycle-no-offset-local-24",
              updated_at: "2026-06-25T04:10:00.000Z",
              score: {
                recovery_score: 63,
              },
            },
          ],
          workouts: [
            {
              id: "workout-local-24",
              start: "2026-06-25T03:45:00.000Z",
              end: "2026-06-25T04:15:00.000Z",
              updated_at: "2026-06-25T04:20:00.000Z",
              timezone_offset: "-04:00",
              sport_name: "Run",
              score: {
                strain: 6.8,
              },
            },
            {
              id: "workout-no-offset-local-24",
              start: "2026-06-25T03:45:00.000Z",
              end: "2026-06-25T04:15:00.000Z",
              updated_at: "2026-06-25T04:20:00.000Z",
              sport_name: "Run",
              score: {
                strain: 5.9,
              },
            },
          ],
        },
      },
      {
        corePort: coreRuntime,
      },
    );

    const workoutEvent = result.events.find(
      (event) => event.kind === "activity_session" && event.externalRef?.resourceId === "workout-local-24",
    );
    const noOffsetWorkoutEvent = result.events.find(
      (event) => event.kind === "activity_session" && event.externalRef?.resourceId === "workout-no-offset-local-24",
    );
    const dayStrainEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "day-strain"
        && event.externalRef?.resourceId === "cycle-local-24",
    );
    const respiratoryEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "respiratory-rate"
        && event.externalRef?.resourceId === "sleep-local-24",
    );
    const noOffsetDayStrainEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "day-strain"
        && event.externalRef?.resourceId === "cycle-no-offset-local-24",
    );
    const noOffsetRespiratoryEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "respiratory-rate"
        && event.externalRef?.resourceId === "sleep-no-offset-local-24",
    );
    const overnightNoOffsetSleepEvent = result.events.find(
      (event) =>
        event.kind === "sleep_session"
        && event.externalRef?.resourceId === "sleep-no-offset-overnight-24",
    );
    const overnightNoOffsetRespiratoryEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "respiratory-rate"
        && event.externalRef?.resourceId === "sleep-no-offset-overnight-24",
    );
    const recoveryEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "recovery-score"
        && event.externalRef?.resourceId === "sleep-recovery-local-24",
    );
    const noOffsetRecoveryEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "recovery-score"
        && event.externalRef?.resourceId === "sleep-no-offset-local-24",
    );
    const noOffsetBodyWeightEvent = result.events.find(
      (event) =>
        event.kind === "observation"
        && event.metric === "weight"
        && event.externalRef?.resourceType === "body-measurement",
    );

    assert.equal(workoutEvent?.dayKey, "2026-06-24");
    assert.equal(noOffsetWorkoutEvent?.dayKey, "2026-06-24");
    assert.equal(dayStrainEvent?.dayKey, "2026-06-24");
    assert.equal(respiratoryEvent?.dayKey, "2026-06-24");
    assert.equal(noOffsetDayStrainEvent?.dayKey, "2026-06-24");
    assert.equal(noOffsetRespiratoryEvent?.dayKey, "2026-06-24");
    assert.equal(overnightNoOffsetSleepEvent?.dayKey, "2026-06-24");
    assert.equal(overnightNoOffsetRespiratoryEvent?.dayKey, "2026-06-24");
    assert.equal(recoveryEvent?.dayKey, "2026-06-24");
    assert.equal(noOffsetRecoveryEvent?.dayKey, "2026-06-24");
    assert.equal(noOffsetBodyWeightEvent?.dayKey, "2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("prepareDeviceProviderSnapshotImport normalizes Oura snapshots into canonical device payloads", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    vaultRoot: "fixture-vault",
    snapshot: {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T10:00:00.000Z",
      personalInfo: {
        id: "oura-user-1",
        email: "oura@example.com",
      },
      dailyActivity: [
        {
          day: "2026-03-15",
          score: 82,
          steps: 12034,
          active_calories: 510,
          total_calories: 2400,
          equivalent_walking_distance: 9200,
          non_wear_time: 1200,
        },
      ],
      dailySleep: [
        {
          day: "2026-03-15",
          score: 86,
        },
      ],
      dailyReadiness: [
        {
          day: "2026-03-15",
          score: 77,
          temperature_deviation: -0.12,
          temperature_trend_deviation: 0.05,
        },
      ],
      dailySpO2: [
        {
          day: "2026-03-15",
          spo2_percentage: {
            average: 97.4,
          },
          breathing_disturbance_index: 2,
        },
      ],
      sleeps: [
        {
          id: "sleep-1",
          type: "sleep",
          bedtime_start: "2026-03-14T22:30:00.000Z",
          bedtime_end: "2026-03-15T06:45:00.000Z",
          timestamp: "2026-03-15T06:50:00.000Z",
          average_breath: 13.8,
          average_hrv: 41.2,
          average_heart_rate: 56,
          efficiency: 91,
          total_sleep_duration: 27000,
          time_in_bed: 29700,
          awake_time: 1200,
          deep_sleep_duration: 5400,
          light_sleep_duration: 14400,
          rem_sleep_duration: 7200,
          latency: 600,
          lowest_heart_rate: 49,
          sleep_score_delta: 5,
          readiness_score_delta: 4,
        },
      ],
      sessions: [
        {
          id: "session-1",
          type: "meditation",
          start_datetime: "2026-03-15T13:00:00.000Z",
          end_datetime: "2026-03-15T13:20:00.000Z",
          timestamp: "2026-03-15T13:20:00.000Z",
          heart_rate: 62,
          heart_rate_variability: 48,
        },
      ],
      workouts: [
        {
          id: "workout-1",
          activity: "running",
          start_datetime: "2026-03-15T17:00:00.000Z",
          end_datetime: "2026-03-15T17:45:00.000Z",
          timestamp: "2026-03-15T17:50:00.000Z",
          calories: 430,
          total_calories: 470,
          distance: 6800,
        },
      ],
      heartrate: [
        {
          timestamp: "2026-03-15T12:00:00.000Z",
          bpm: 64,
          source: "live",
        },
      ],
      deletions: [
        {
          resource_type: "workout",
          resource_id: "workout-deleted",
          occurred_at: "2026-03-16T10:00:00.000Z",
          source_event_type: "workout.deleted",
        },
      ],
    },
  });

  assert.equal(payload.vaultRoot, "fixture-vault");
  assert.equal(payload.provider, "oura");
  assert.equal(payload.accountId, "oura-user-1");
  assert.equal(payload.source, "device");
  assert.equal(payload.provenance?.ouraUserId, "oura-user-1");
  assert.ok(payload.events?.some((event) => event.kind === "sleep_session"));
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "activity-score" &&
        event.fields?.value === 82,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "readiness-score" &&
        event.fields?.value === 77,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "spo2" && event.fields?.value === 97.4,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "external-resource-deleted" &&
        event.fields?.resourceType === "workout",
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "respiratory-rate" && event.fields?.value === 13.8,
    ),
  );
  assert.ok(payload.events?.some((event) => event.fields?.metric === "hrv" && event.fields?.value === 41.2));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "average-heart-rate" && event.fields?.value === 56));
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "personal-info"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "sleep:sleep-1"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "session:session-1"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "workout:workout-1"));
  assert.equal(payload.evidenceParts?.filter((artifact) => artifact.role === "heartrate").length, 0);
  assert.ok(
    payload.evidenceParts?.some((artifact) => artifact.role.startsWith("deletion:workout:workout.deleted:")),
  );

  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const workoutEvent = payload.events?.find((event) => event.externalRef?.resourceType === "workout");
  const sessionEvent = payload.events?.find(
    (event) => event.kind === "activity_session" && event.externalRef?.resourceType === "session",
  );
  const sessionObservationMetrics = payload.events
    ?.filter((event) => event.kind === "observation" && event.externalRef?.resourceType === "session")
    .map((event) => event.fields?.metric) ?? [];
  const workoutObservationMetrics = payload.events
    ?.filter(
      (event) =>
        event.kind === "observation" &&
        event.externalRef?.resourceType === "workout" &&
        event.externalRef?.resourceId === "workout-1",
    )
    .map((event) => event.fields?.metric) ?? [];
  const activityScoreEvent = payload.events?.find(
    (event) => event.fields?.metric === "activity-score",
  );
  const sleepRespiratoryEvent = payload.events?.find(
    (event) => event.fields?.metric === "respiratory-rate",
  );

  assert.deepEqual(sleepEvent?.fields, {
    startAt: "2026-03-14T22:30:00.000Z",
    endAt: "2026-03-15T06:45:00.000Z",
    durationMinutes: 495,
    sleepType: "main_sleep",
  });
  assert.equal(activityScoreEvent?.dayKey, "2026-03-15");
  assert.equal(sleepRespiratoryEvent?.dayKey, "2026-03-15");
  assert.equal(workoutEvent?.fields?.activityType, "running");
  assert.equal(workoutEvent?.fields?.distanceKm, 6.8);
  assert.deepEqual(workoutMetricsFromEvent(sessionEvent), {
    averageHeartRate: 62,
    hrv: 48,
  });
  assert.deepEqual(workoutMetricsFromEvent(workoutEvent), {
    activeCalories: 430,
    totalCalories: 470,
  });
  assert.deepEqual(sessionObservationMetrics, []);
  assert.deepEqual(workoutObservationMetrics, []);
});

test("prepareDeviceProviderSnapshotImport preserves descriptor-driven Oura and WHOOP unit and facet mappings", async () => {
  const [ouraPayload, whoopPayload] = await Promise.all([
    prepareDeviceProviderSnapshotImport({
      provider: "oura",
      snapshot: {
        dailyActivity: [
          {
            day: "2026-03-15",
            high_activity_time: 600,
            low_activity_time: 3600,
            medium_activity_time: 1200,
            steps: 12034,
            non_wear_time: 1200,
          },
        ],
        dailySpO2: [
          {
            day: "2026-03-15",
            spo2_percentage: {
              average: 97.4,
            },
          },
        ],
      },
    }),
    prepareDeviceProviderSnapshotImport({
      provider: "whoop",
      snapshot: {
        sleeps: [
          {
            id: "sleep-2",
            start: "2026-03-15T22:00:00.000Z",
            end: "2026-03-16T07:00:00.000Z",
            updated_at: "2026-03-16T07:30:00.000Z",
            score: {
              stage_summary: {
                total_rem_sleep_time_milli: 5400000,
              },
            },
          },
        ],
        recoveries: [
          {
            sleep_id: "sleep-2",
            updated_at: "2026-03-16T07:30:00.000Z",
            score: {
              skin_temp_celsius: 36.5,
            },
          },
        ],
      },
    }),
  ]);

  const ouraStepsEvent = ouraPayload.events?.find((event) => event.externalRef?.facet === "steps");
  const ouraActivityMinutesEvent = ouraPayload.events?.find(
    (event) => event.externalRef?.facet === "activity-minutes",
  );
  const ouraSpo2Event = ouraPayload.events?.find((event) => event.externalRef?.facet === "spo2-average");
  const ouraNonWearEvent = ouraPayload.events?.find((event) => event.externalRef?.facet === "non-wear-minutes");
  const whoopRemEvent = whoopPayload.events?.find((event) => event.externalRef?.facet === "sleep-rem-minutes");
  const whoopTemperatureEvent = whoopPayload.events?.find(
    (event) => event.externalRef?.facet === "skin-temperature",
  );

  assert.equal(ouraActivityMinutesEvent?.fields?.metric, "activity-minutes");
  assert.equal(ouraActivityMinutesEvent?.fields?.value, 90);
  assert.equal(ouraActivityMinutesEvent?.fields?.unit, "minutes");
  assert.equal(ouraStepsEvent?.fields?.metric, "daily-steps");
  assert.equal(ouraStepsEvent?.fields?.unit, "count");
  assert.equal(ouraStepsEvent?.fields?.observationGrain, "summary");
  assert.equal(ouraSpo2Event?.fields?.metric, "spo2");
  assert.equal(ouraSpo2Event?.fields?.unit, "%");
  assert.equal(ouraSpo2Event?.fields?.observationGrain, "summary");
  assert.equal(ouraNonWearEvent?.fields?.value, 20);
  assert.equal(ouraNonWearEvent?.fields?.unit, "minutes");
  assert.equal(ouraNonWearEvent?.fields?.observationGrain, "summary");
  assert.equal(whoopRemEvent?.fields?.metric, "sleep-rem-minutes");
  assert.equal(whoopRemEvent?.fields?.unit, "minutes");
  assert.equal(whoopRemEvent?.dayKey, undefined);
  assert.equal(whoopRemEvent?.fields?.observationGrain, "summary");
  assert.equal(whoopTemperatureEvent?.fields?.unit, "celsius");
  assert.equal(whoopTemperatureEvent?.dayKey, undefined);
  assert.equal(whoopTemperatureEvent?.fields?.observationGrain, "summary");
});

test("prepareDeviceProviderSnapshotImport rejects incomplete or invalid Oura daily activity durations", async () => {
  const invalidBuckets = [
    { low_activity_time: 600, medium_activity_time: 600 },
    { low_activity_time: 600, medium_activity_time: -1, high_activity_time: 600 },
    { low_activity_time: 600, medium_activity_time: 600, high_activity_time: "Infinity" },
    { low_activity_time: 86_400, medium_activity_time: 1, high_activity_time: 0 },
  ];
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: {
      dailyActivity: invalidBuckets.map((buckets, index) => ({
        ...buckets,
        id: `invalid-activity-buckets-${index}`,
        day: "2026-03-16",
      })),
    },
  });

  assert.equal(payload.events?.some((event) => event.fields?.metric === "activity-minutes"), false);
});

test("prepareDeviceProviderSnapshotImport handles Oura string numerics through shared observation and sample helpers", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    vaultRoot: "fixture-vault",
    snapshot: {
      accountId: 202,
      dailyActivity: [
        {
          day: "2026-03-15",
          score: "82",
          steps: "12034",
          active_calories: "510",
          total_calories: "2400",
          equivalent_walking_distance: "9200",
          non_wear_time: "1200",
        },
      ],
      dailyReadiness: [
        {
          day: "2026-03-15",
          score: "77",
          temperature_deviation: "-0.12",
          temperature_trend_deviation: "0.05",
        },
      ],
      dailySpO2: [
        {
          day: "2026-03-15",
          spo2_percentage: {
            average: "97.4",
          },
          breathing_disturbance_index: "2",
        },
      ],
      sleeps: [
        {
          id: 5,
          type: "sleep",
          bedtime_start: "2026-03-14T22:30:00.000Z",
          bedtime_end: "2026-03-15T06:45:00.000Z",
          timestamp: "2026-03-15T06:50:00.000Z",
          average_breath: "13.8",
          average_hrv: "41.2",
          average_heart_rate: "56",
          efficiency: "91",
          total_sleep_duration: "27000",
          time_in_bed: "29700",
          awake_time: "1200",
          deep_sleep_duration: "5400",
          light_sleep_duration: "14400",
          rem_sleep_duration: "7200",
          latency: "600",
          lowest_heart_rate: "49",
          sleep_score_delta: "5",
          readiness_score_delta: "4",
        },
      ],
      heartrate: [
        {
          timestamp: "2026-03-15T12:00:00.000Z",
          bpm: "64",
          source: "live",
        },
      ],
    },
  });

  assert.equal(payload.accountId, "202");
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "activity-score" &&
        event.fields?.value === 82,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "readiness-score" &&
        event.fields?.value === 77,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "spo2" && event.fields?.value === 97.4,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "respiratory-rate" && event.fields?.value === 13.8,
    ),
  );
  assert.ok(payload.events?.some((event) => event.fields?.metric === "hrv" && event.fields?.value === 41.2));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "average-heart-rate" && event.fields?.value === 56));
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "heartrate"), false);
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("prepareDeviceProviderSnapshotImport preserves Oura deletion alias precedence through the shared tombstone builder", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      deletions: [
        {
          data_type: "session",
          object_id: "session-42",
          event_time: "2026-03-16T10:30:00.000Z",
          eventType: "session.deleted",
        },
      ],
    },
  });

  const deletionEvent = payload.events?.find((event) => event.externalRef?.facet === "deleted");
  const deletionArtifact = payload.evidenceParts?.find((artifact) =>
    artifact.role.startsWith("deletion:session:session.deleted:"),
  );

  assert.equal(deletionEvent?.externalRef?.system, "oura");
  assert.equal(deletionEvent?.externalRef?.resourceType, "session");
  assert.equal(deletionEvent?.externalRef?.resourceId, "session-42");
  assert.equal(deletionEvent?.occurredAt, "2026-03-16T10:30:00.000Z");
  assert.equal(deletionEvent?.note, "Webhook event: session.deleted");
  assert.equal(deletionEvent?.fields?.sourceEventType, "session.deleted");
  assert.match(deletionArtifact?.fileName ?? "", /^deletion-session-session.deleted-[0-9a-f]{64}\.json$/u);
  assert.ok(!deletionArtifact?.role.includes("session-42"));
});

test("prepareDeviceProviderSnapshotImport records Oura daily aggregate deletions through explicit deletion markers", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      deletions: [
        {
          data_type: "daily_readiness",
          object_id: "2026-03-16",
          occurred_at: "2026-03-16T09:58:00.000Z",
          source_event_type: "daily_readiness.deleted",
        },
      ],
    },
  });

  const deletionEvent = payload.events?.find(
    (event) =>
      event.externalRef?.facet === "deleted" && event.externalRef?.resourceType === "daily-readiness",
  );

  assert.equal(deletionEvent?.fields?.metric, "external-resource-deleted");
  assert.equal(deletionEvent?.fields?.resourceType, "daily-readiness");
  assert.equal(deletionEvent?.fields?.sourceEventType, "daily_readiness.deleted");
  assert.ok(
    payload.evidenceParts?.some(
      (artifact) => artifact.role.startsWith("deletion:daily-readiness:daily_readiness.deleted:"),
    ),
  );
});


















test("importDeviceProviderSnapshot uses the default Oura adapter registry", async () => {
  const calls: DeviceBatchImportPayload[] = [];

  const result = await importDeviceProviderSnapshot<{ ok: boolean; provider: string }>(
    {
      provider: "oura",
      snapshot: {
        accountId: "oura-user-2",
        dailyReadiness: [
          {
            day: "2026-03-16",
            score: 81,
          },
        ],
      },
    },
    {
      corePort: {
        async importDeviceBatch(payload: DeviceBatchImportPayload) {
          calls.push(payload);
          return {
            ok: true,
            provider: payload.provider,
          };
        },
      },
    },
  );

  assert.deepEqual(result, { ok: true, provider: "oura" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "oura");
  assert.ok(calls[0]?.events?.some((event) => event.fields?.metric === "readiness-score"));
});

test("importDeviceProviderSnapshot ignores legacy Oura heart-rate raw samples", async () => {
  const vaultRoot = await makeTempDirectory("murph-oura-heartrate-import");
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
    timezone: "America/Los_Angeles",
  });

  const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      provider: "oura",
      vaultRoot,
      snapshot: {
        importedAt: "2026-03-16T12:00:00.000Z",
        dailyReadiness: [
          {
            day: "2026-03-16",
            score: 81,
          },
        ],
        heartRate: [
          {
            timestamp: "2026-03-16T08:00:00.000Z",
            bpm: 62,
          },
        ],
      },
    },
    {
      corePort: coreRuntime,
    },
  );

  assert.ok(result.applied);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  assert.equal(
    ingest.parts.some((part) => part.role === "heartrate" || part.fileName.endsWith("/01-heartrate.json")),
    false,
  );
});

test("prepareDeviceProviderSnapshotImport does not retain legacy Oura heartrate-only snapshots", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: {
      accountId: "oura-user-1",
      importedAt: "2026-03-16T12:00:00.000Z",
      heartrate: [
        {
          timestamp: "2026-03-16T08:00:00.000Z",
          bpm: 62,
        },
      ],
      heartRate: [
        {
          timestamp: "2026-03-16T08:05:00.000Z",
          bpm: 63,
        },
      ],
    },
  });

  const rawArtifactText = JSON.stringify(payload.evidenceParts ?? []);

  assert.deepEqual(payload.events ?? [], []);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "heartrate"), false);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.equal(rawArtifactText.includes("\"bpm\":62"), false);
  assert.equal(rawArtifactText.includes("\"bpm\":63"), false);
});

test("prepareDeviceProviderSnapshotImport drops Junction floating raw-only timeseries entries", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot: {
      accountId: "junction-user-1",
      importedAt: "2026-03-16T12:00:00.000Z",
      windowStart: "2026-03-15T00:00:00.000Z",
      windowEnd: "2026-03-16T00:00:00.000Z",
      timeseries: {
        weight: [
          {
            day: "2026-03-15",
            value: 72.4,
            source: {
              provider: "apple-health",
              type: "watch",
              id: "device-1",
            },
          },
        ],
      },
    },
  });

  const weightEvent = payload.events?.find((event) => event.fields?.metric === "weight");
  const weightArtifact = payload.evidenceParts?.find((artifact) =>
    artifact.role === "junction-timeseries-weight"
  );

  assert.equal(weightEvent, undefined);
  assert.equal(weightArtifact, undefined);
  assert.equal(payload.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"), false);
  assert.doesNotMatch(JSON.stringify(payload.evidenceParts ?? []), /72\.4|apple-health|device-1/u);
});

test("prepareDeviceProviderSnapshotImport strips direct Junction identities from configured summaries", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot: {
      accountId: "junction-user-1",
      importedAt: "2026-03-16T12:00:00.000Z",
      summaries: {
        meal: [
          {
            id: "meal-1",
            name: "Greek yogurt bowl",
            sourceProviderSlug: "garmin",
            mealType: "breakfast",
            clientId: "raw-meal-client-id-sentinel",
            user_id: "raw-meal-user-id-sentinel",
            userId: "raw-meal-user-camel-sentinel",
            client_user_id: "raw-meal-client-user-sentinel",
            account_id: "raw-meal-account-sentinel",
            patientName: "raw-meal-patient-name-sentinel",
            memberName: "raw-meal-member-name-sentinel",
            fullName: "raw-meal-full-name-sentinel",
            firstName: "raw-meal-first-name-sentinel",
            lastName: "raw-meal-last-name-sentinel",
            dateOfBirth: "raw-meal-date-of-birth-sentinel",
            addressLine1: "raw-meal-address-sentinel",
            email: "raw-meal-email-sentinel",
            phoneNumber: "raw-meal-phone-sentinel",
            patient_id: "raw-meal-patient-sentinel",
            personId: "raw-meal-person-sentinel",
            member_id: "raw-meal-member-sentinel",
            profileId: "raw-meal-profile-sentinel",
            subjectId: "raw-meal-subject-sentinel",
            user: {
              id: "raw-meal-nested-user-sentinel",
            },
            account: {
              id: "raw-meal-nested-account-sentinel",
            },
            owner: {
              id: "raw-meal-owner-sentinel",
            },
            patients: [
              {
                id: "raw-meal-patients-container-sentinel",
              },
            ],
            profiles: [
              {
                id: "raw-meal-profiles-container-sentinel",
              },
            ],
            subject: {
              id: "raw-meal-nested-subject-sentinel",
            },
            subjects: [
              {
                id: "raw-meal-subjects-container-sentinel",
              },
            ],
          },
        ],
        menstrual_cycle: [
          {
            id: "cycle-1",
            sourceProviderSlug: "garmin",
            cycleDay: 3,
            birthDate: "raw-cycle-birth-date-sentinel",
            dob: "raw-cycle-dob-sentinel",
            ownerId: "raw-cycle-owner-sentinel",
            phone: "raw-cycle-phone-sentinel",
            client: {
              id: "raw-cycle-client-sentinel",
            },
            member: {
              id: "raw-cycle-member-sentinel",
            },
          },
        ],
      },
    },
  });

  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-meal"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "junction-summary-menstrual-cycle"));
  const mealEvents = payload.events?.filter((event) => event.kind === "meal") ?? [];
  assert.equal(mealEvents.length, 1);
  assert.equal(mealEvents[0]?.title, "Greek yogurt bowl");
  assert.equal(payload.samples?.length ?? 0, 0);

  const rawArtifactText = JSON.stringify(payload.evidenceParts);
  const rawReceiptText = JSON.stringify(readRawReceiptArtifact(payload));
  for (const sentinel of [
    "raw-meal-user-id-sentinel",
    "raw-meal-user-camel-sentinel",
    "raw-meal-client-id-sentinel",
    "raw-meal-client-user-sentinel",
    "raw-meal-account-sentinel",
    "raw-meal-patient-name-sentinel",
    "raw-meal-member-name-sentinel",
    "raw-meal-full-name-sentinel",
    "raw-meal-first-name-sentinel",
    "raw-meal-last-name-sentinel",
    "raw-meal-date-of-birth-sentinel",
    "raw-meal-address-sentinel",
    "raw-meal-email-sentinel",
    "raw-meal-phone-sentinel",
    "raw-meal-patient-sentinel",
    "raw-meal-person-sentinel",
    "raw-meal-member-sentinel",
    "raw-meal-profile-sentinel",
    "raw-meal-subject-sentinel",
    "raw-meal-nested-user-sentinel",
    "raw-meal-nested-account-sentinel",
    "raw-meal-owner-sentinel",
    "raw-meal-patients-container-sentinel",
    "raw-meal-profiles-container-sentinel",
    "raw-meal-nested-subject-sentinel",
    "raw-meal-subjects-container-sentinel",
    "raw-cycle-birth-date-sentinel",
    "raw-cycle-dob-sentinel",
    "raw-cycle-owner-sentinel",
    "raw-cycle-phone-sentinel",
    "raw-cycle-client-sentinel",
    "raw-cycle-member-sentinel",
  ]) {
    assert.doesNotMatch(rawArtifactText, new RegExp(sentinel, "u"), sentinel);
    assert.doesNotMatch(rawReceiptText, new RegExp(sentinel, "u"), sentinel);
  }
  assert.match(rawArtifactText, /breakfast/u);
  assert.match(rawArtifactText, /Greek yogurt bowl/u);
  assert.match(rawArtifactText, /legacyCycleDay/u);
});

test("importDeviceProviderSnapshot keeps new Junction timeseries imports out of dense retention", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-dense-retention");
  await coreRuntime.initializeVault({
    createdAt: "2026-05-01T00:00:00.000Z",
    vaultRoot,
  });

  const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      provider: "junction",
      vaultRoot,
      snapshot: {
        accountId: "junction-user-1",
        importedAt: "2026-05-01T00:00:00.000Z",
        timeseries: {
          blood_oxygen: {
            groups: {
              oura: [{
                data: [{
                  timestamp: "2026-05-01T00:00:00.000Z",
                  value: 96,
                }],
                source: { provider: "oura", type: "ring" },
              }],
            },
          },
          heartrate: [
            {
              timestamp: "2026-05-01T00:00:00.000Z",
              value: 70,
            },
          ],
          weight: [
            {
              day: "2026-05-01",
              value: 72.4,
            },
          ],
        },
      },
    },
    {
      corePort: coreRuntime,
    },
  );

  assert.ok(result.applied);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  const ingestParts = ingest.parts;
  const compactBloodOxygenPart = ingestParts.find(
    (part) => part.role.startsWith("junction-timeseries-daily-blood-oxygen:"),
  );
  assert.ok(compactBloodOxygenPart);
  assert.equal(ingestParts.some((part) => part.role === "junction-timeseries-heartrate"), false);
  assert.equal(ingestParts.some((part) => part.role === "junction-timeseries-weight"), false);
  const metadataByRole = new Map(
    ingestParts.map((part) => [
      part.role,
      part.metadata,
    ]),
  );
  assert.deepEqual(metadataByRole.get(compactBloodOxygenPart.role), {
    artifactClass: "compact_provider_timeseries_aggregate",
    provider: "junction",
    resource: "blood_oxygen",
    resourceCategory: "timeseries_daily_aggregate",
    retentionClass: "provider_evidence",
  });

  const detection = await coreRuntime.detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: new Date("2026-05-09T00:00:00.000Z"),
    vaultRoot,
  });
  assert.equal(detection.denseProviderRawTimeseriesCount, 0);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 0);

  const pruneResult = await coreRuntime.pruneWearableDenseRawTimeseries({
    maxFiles: 5,
    now: new Date("2026-05-09T00:00:00.000Z"),
    vaultRoot,
  });
  assert.equal(pruneResult.tombstonedDenseRawArtifactCount, 0);

  assert.match(compactBloodOxygenPart.content, /"meanValue":96/u);
  assert.doesNotMatch(compactBloodOxygenPart.content, /dense_provider_timeseries_pruned|70|72\.4/u);
});

test("importDeviceProviderSnapshot rejects ambiguous Junction daily aggregate legacy aliases", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-daily-aggregate-legacy-conflict");
  await coreRuntime.initializeVault({
    createdAt: "2026-06-25T00:00:00.000Z",
    vaultRoot,
  });

  const snapshot = {
    accountId: "junction-user-legacy-days",
    importedAt: "2026-06-25T12:00:00.000Z",
    timeseries: {
      stress_level: {
        groups: {
          garmin: [{
            data: [
              {
                calendar_date: "2026-06-25",
                timestamp: "2026-06-25T00:30:00.000Z",
                timestamp_semantics: "offset",
                timezone_offset: -14_400,
                value: 44,
              },
              {
                calendar_date: "2026-06-25",
                timestamp: "2026-06-25T10:00:00.000Z",
                timestamp_semantics: "offset",
                timezone_offset: -14_400,
                value: 44,
              },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      },
    },
  };
  const prepared = await prepareDeviceProviderSnapshotImport({
    provider: "junction",
    snapshot,
  });
  const correctedStressEvent = prepared.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "stress-level",
  );
  const currentExternalRef = correctedStressEvent?.externalRef;
  const legacyExternalRef = correctedStressEvent?.legacyExternalRefs?.[0];
  assert.equal(correctedStressEvent?.dayKey, "2026-06-25");
  assert.ok(currentExternalRef);
  assert.ok(legacyExternalRef);

  const sourceOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    timestampSemantics: "offset" as const,
    normalizerVersion: "junction-normalizer.v1",
  };
  const legacyImport = await coreRuntime.importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-legacy-days",
    importedAt: "2026-06-25T11:00:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-06-25T10:00:00.000Z",
        recordedAt: "2026-06-25T10:00:00.000Z",
        dayKey: "2026-06-24",
        title: "Junction stress level average",
        externalRef: legacyExternalRef,
        dataOrigin: {
          ...sourceOrigin,
          observedAtRaw: "2026-06-24:stress_level:daily",
        },
        fields: {
          metric: "stress-level",
          observationGrain: "summary",
          value: 44,
          unit: "score",
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-06-25T10:00:00.000Z",
        recordedAt: "2026-06-25T10:00:00.000Z",
        dayKey: "2026-06-25",
        title: "Junction stress level average",
        externalRef: currentExternalRef,
        dataOrigin: {
          ...sourceOrigin,
          observedAtRaw: "2026-06-25:stress_level:daily",
        },
        fields: {
          metric: "stress-level",
          observationGrain: "summary",
          value: 44,
          unit: "score",
        },
      },
    ],
  });

  await assert.rejects(
    importDeviceProviderSnapshot(
      {
        provider: "junction",
        vaultRoot,
        snapshot,
      },
      {
        corePort: coreRuntime,
      },
    ),
    (error) =>
      error instanceof coreRuntime.VaultError &&
      error.code === "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
  );

  const records = (
    await Promise.all(
      legacyImport.eventShardPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ),
    )
  ).flat();
  const liveStressRecords = latestLiveRecords(records).filter(
    (record) => record.kind === "observation" && record.metric === "stress-level",
  );
  assert.equal(liveStressRecords.length, 2);
});

test("importDeviceProviderSnapshot delegates normalized device batches to core", async () => {
  const calls: DeviceBatchImportPayload[] = [];

  const result = await importDeviceProviderSnapshot<{ ok: boolean; provider: string }>({
    provider: "whoop",
    snapshot: {
      accountId: "whoop-user-2",
      recoveries: [
        {
          sleep_id: "sleep-2",
          updated_at: "2026-03-16T08:00:00.000Z",
          score: {
            recovery_score: 72,
          },
        },
      ],
    },
  }, {
    corePort: {
      async importDeviceBatch(payload: DeviceBatchImportPayload) {
        calls.push(payload);
        return {
          ok: true,
          provider: payload.provider,
        };
      },
    },
  });

  assert.deepEqual(result, { ok: true, provider: "whoop" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "whoop");
  assert.ok(calls[0]?.events?.some((event) => event.kind === "observation"));
  assert.ok(calls[0]?.evidenceParts?.some((artifact) => artifact.role === "recovery:sleep-2"));
});

test("importDeviceProviderSnapshot strips snapshot input fields before delegating to core and omits blank vaultRoot", async () => {
  const registry = createDeviceProviderRegistry();
  const calls: DeviceBatchImportPayload[] = [];

  registry.register(makeTestDeviceProviderAdapter({
    provider: "polar",
    normalizeSnapshot() {
      return makeNormalizedDeviceBatch({
        provider: "polar",
        accountId: "polar-user-2",
        events: [
          {
            kind: "observation",
            occurredAt: "2026-03-16T12:00:00.000Z",
            title: "Polar daily steps",
            fields: {
              metric: "daily-steps",
              value: 4321,
              unit: "count",
            },
          },
        ],
      });
    },
  }));

  await importDeviceProviderSnapshot(
    {
      provider: "polar",
      vaultRoot: "   ",
      snapshot: {
        importedAt: "2026-03-16T12:05:00.000Z",
      },
    },
    {
      corePort: {
        async importDeviceBatch(payload: DeviceBatchImportPayload) {
          calls.push(payload);
          return { ok: true };
        },
      },
      providerRegistry: registry,
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "polar");
  assert.equal(calls[0]?.accountId, "polar-user-2");
  assert.equal(calls[0]?.source, "device");
  assert.deepEqual(calls[0]?.events, [
    {
      kind: "observation",
      occurredAt: "2026-03-16T12:00:00.000Z",
      title: "Polar daily steps",
      evidenceRoles: ["provider-snapshot"],
      fields: {
        metric: "daily-steps",
        value: 4321,
        unit: "count",
      },
    },
  ]);
  assert.equal(Object.hasOwn(calls[0] ?? {}, "snapshot"), false);
  assert.equal(Object.hasOwn(calls[0] ?? {}, "rawIngestReceipts"), false);
  assert.equal(Object.hasOwn(calls[0] ?? {}, "canonicalWearableRecords"), false);
  assert.ok(calls[0]?.evidenceParts?.some((artifact) => artifact.role === "provider-snapshot"));
  assert.equal(calls[0]?.evidenceParts?.some((artifact) => artifact.role.startsWith("wearable-raw-receipt:")), false);
  const fallbackRawArtifact = calls[0]?.evidenceParts?.find((artifact) => artifact.role === "provider-snapshot");
  const rawReceipt = readRawReceiptArtifact(calls[0] as DeviceBatchImportPayload);
  assert.deepEqual(fallbackRawArtifact?.content, {
    importedAt: "2026-03-16T12:05:00.000Z",
  });
  assert.equal(rawReceipt?.schemaVersion, "wearable.raw_ingest_receipt.v1");
  assert.deepEqual(rawReceipt?.rawArtifactRoles, ["provider-snapshot"]);
  assert.equal(rawReceipt?.rawArtifactCount, 1);
  assert.equal(rawReceipt?.rawArtifactRoles.some((role) => role.startsWith("wearable-raw-receipt:")), false);
  assert.equal(calls[0]?.vaultRoot, undefined);
});

test("importDeviceProviderSnapshot does not let adapters bypass the dense sample guard", async () => {
  const registry = createDeviceProviderRegistry();
  const vaultRoot = await makeTempDirectory("murph-importers-dense-policy-");
  await coreRuntime.initializeVault({
    createdAt: "2026-03-16T12:00:00.000Z",
    vaultRoot,
  });

  registry.register(makeTestDeviceProviderAdapter({
    provider: "polar",
    normalizeSnapshot() {
      const samples: NonNullable<NormalizedDeviceBatch["samples"]> = Array.from(
        { length: 1001 },
        (_, index) => {
          const recordedAt = new Date(Date.UTC(2026, 2, 16, 12, 0, index)).toISOString();
          return {
            stream: "heart_rate",
            recordedAt,
            unit: "bpm",
            quality: "normalized",
            sample: {
              recordedAt,
              value: 70,
            },
          };
        },
      );
      const normalized: NormalizedDeviceBatch = {
        provider: "polar",
        source: "device",
        samples,
      };
      return normalized;
    },
  }));

  await assert.rejects(
    importDeviceProviderSnapshot(
      {
        provider: "polar",
        vaultRoot,
        snapshot: {},
      },
      {
        corePort: coreRuntime,
        providerRegistry: registry,
      },
    ),
    (error) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "VAULT_DENSE_DEVICE_TELEMETRY_NOT_ALLOWED",
  );
});

test("createImporters composes custom device providers behind the same core seam", async () => {
  const registry = createDeviceProviderRegistry();
  const calls: DeviceBatchImportPayload[] = [];

  const polarAdapter: DeviceProviderAdapter<{ accountId?: string; steps?: number }> = makeTestDeviceProviderAdapter({
    provider: "polar",
    normalizeSnapshot(snapshot) {
      return {
        provider: "polar",
        accountId: snapshot.accountId ?? "polar-user-1",
        source: "device",
        events: [
          {
            kind: "observation",
            occurredAt: "2026-03-16T12:00:00.000Z",
            recordedAt: "2026-03-16T12:00:00.000Z",
            title: "Polar daily steps",
            externalRef: {
              system: "polar",
              resourceType: "daily-summary",
              resourceId: "2026-03-16",
              facet: "steps",
            },
            fields: {
              metric: "daily-steps",
              value: snapshot.steps ?? 0,
              unit: "count",
            },
          },
        ],
        evidenceParts: [
          {
            role: "daily-summary",
            fileName: "daily-summary.json",
            content: snapshot,
          },
        ],
      };
    },
  });

  registry.register(polarAdapter);

  const importers = createImporters({
    corePort: {
      async importDeviceBatch(payload: DeviceBatchImportPayload) {
        calls.push(payload);
        return {
          ok: true,
          provider: payload.provider,
        };
      },
    },
    deviceProviderRegistry: registry,
  });

  const result = await importers.importDeviceProviderSnapshot({
    provider: "polar",
    snapshot: {
      accountId: "polar-user-9",
      steps: 12345,
    },
  }) as { ok: boolean; provider: string };

  assert.deepEqual(result, { ok: true, provider: "polar" });
  assert.equal(importers.deviceProviderRegistry.get("polar")?.provider, "polar");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "polar");
  assert.equal(calls[0]?.accountId, "polar-user-9");
  assert.equal(calls[0]?.events?.[0]?.kind, "observation");
  assert.equal(calls[0]?.events?.[0]?.fields?.value, 12345);
});

test("prepareDeviceProviderSnapshotImport records WHOOP deletions as append-only tombstone observations", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    vault: "fixture-vault",
    snapshot: {
      accountId: "whoop-user-3",
      importedAt: "2026-03-16T12:00:00.000Z",
      deletions: [
        {
          resource_type: "sleep",
          resource_id: "sleep-9",
          occurred_at: "2026-03-16T12:00:00.000Z",
          source_event_type: "sleep.deleted",
          payload: {
            trace_id: "trace-9",
          },
        },
      ],
    },
  });

  const deletionEvent = payload.events?.find((event) => event.externalRef?.facet === "deleted");
  const deletionArtifact = payload.evidenceParts?.find((artifact) =>
    artifact.role.startsWith("deletion:sleep:sleep.deleted:"),
  );

  assert.equal(deletionEvent?.kind, "observation");
  assert.equal(deletionEvent?.fields?.metric, "external-resource-deleted");
  assert.equal(deletionEvent?.fields?.deleted, true);
  assert.match(deletionArtifact?.fileName ?? "", /^deletion-sleep-sleep.deleted-[0-9a-f]{64}\.json$/u);
  assert.ok(!deletionArtifact?.role.includes("sleep-9"));
});

test("device provider registry normalizes provider keys and rejects invalid registrations", () => {
  const registry = createDeviceProviderRegistry();
  const garminAdapter: DeviceProviderAdapter<{ steps?: number }> = makeTestDeviceProviderAdapter({
    provider: "Garmin",
    normalizeSnapshot(snapshot) {
      return {
        provider: "garmin",
        events: [
          {
            kind: "observation",
            occurredAt: "2026-03-16T12:00:00.000Z",
            recordedAt: "2026-03-16T12:00:00.000Z",
            title: "Garmin steps",
            fields: {
              metric: "daily-steps",
              value: snapshot.steps ?? 0,
              unit: "count",
            },
          },
        ],
      };
    },
  });

  registry.register(garminAdapter);

  assert.equal(registry.get("GARMIN")?.provider, "Garmin");
  assert.equal(registry.get("   "), undefined);
  assert.deepEqual(registry.list().map((adapter) => adapter.provider), ["Garmin"]);
  assert.throws(
    () =>
      registry.register(makeTestDeviceProviderAdapter({
        provider: "garmin",
        normalizeSnapshot() {
          return { provider: "garmin", events: [] };
        },
      })),
    /already registered/u,
  );
  assert.throws(
    () =>
      registry.register(makeTestDeviceProviderAdapter({
        provider: "   ",
        normalizeSnapshot() {
          return { provider: "empty", events: [] };
        },
      })),
    /provider must be a non-empty string/u,
  );
});

test("prepareDeviceProviderSnapshotImport handles WHOOP fallbacks and string numerics", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      accountId: 101,
      importedAt: "2026-03-16T12:00:00.000Z",
      bodyMeasurements: {
        height_meter: "1.82",
        weight_kilogram: "72.8",
        max_heart_rate: "191",
      },
      sleeps: [
        {
          id: 77,
          end: "2026-03-16T06:30:00.000Z",
          updated_at: "2026-03-16T06:45:00.000Z",
          score: {
            respiratory_rate: "14.6",
            sleep_performance_percentage: "88",
          },
        },
        {
          id: "sleep-negative",
          start: "2026-03-16T10:00:00.000Z",
          end: "2026-03-16T09:30:00.000Z",
          updated_at: "2026-03-16T10:05:00.000Z",
          score: {
            sleep_efficiency_percentage: "91",
          },
        },
      ],
      recoveries: [
        {
          sleep_id: 77,
          updated_at: "2026-03-16T06:45:00.000Z",
          score: {
            recovery_score: "72",
            resting_heart_rate: "54",
            hrv_rmssd_milli: "42.5",
            spo2_percentage: "97.2",
            skin_temp_celsius: "36.7",
          },
        },
      ],
      cycles: [
        {
          id: 12,
          start: "2026-03-15T00:00:00.000Z",
          end: "2026-03-15T23:59:59.000Z",
          updated_at: "2026-03-16T00:05:00.000Z",
          score: {
            strain: "13.7",
            kilojoule: "850",
            average_heart_rate: "71",
            max_heart_rate: "149",
          },
        },
      ],
      workouts: [
        {
          id: 9,
          start: "2026-03-15T18:00:00.000Z",
          end: "2026-03-15T17:30:00.000Z",
          updated_at: "2026-03-15T18:15:00.000Z",
          sport_name: "   ",
          altitude_gain_meter: "bad-number",
          altitude_change_meter: "33",
          score: {
            strain: "11.1",
            average_heart_rate: "141",
            max_heart_rate: "168",
            kilojoule: "510",
            percent_recorded: "99",
            distance_meter: "7250",
          },
        },
      ],
    },
  });

  assert.equal(payload.accountId, "101");
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "body-measurement"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "cycle:12"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "workout:9"));
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "weight" && event.fields?.value === 72.8,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "max-heart-rate" &&
        event.fields?.value === 191,
    ),
  );
  assert.ok(payload.events?.some((event) => event.fields?.metric === "respiratory-rate" && event.fields?.value === 14.6));
  assert.ok(payload.events?.some((event) => event.fields?.metric === "temperature" && event.fields?.value === 36.7));
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "day-strain" && event.fields?.value === 13.7,
    ),
  );
  assert.equal(
    payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "altitude-change"),
    false,
  );
  assert.equal(payload.events?.some((event) => event.kind === "sleep_session"), false);
  assert.equal(payload.events?.some((event) => event.kind === "activity_session"), false);
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "bmi" &&
        event.fields?.value === Number((72.8 / (1.82 * 1.82)).toFixed(4)),
    ),
  );
  assert.equal(payload.provenance?.whoopUserId, undefined);
  assert.equal(payload.provenance?.bodyMeasurementDay, undefined);
});

test("prepareDeviceProviderSnapshotImport prefers WHOOP measurement timestamps over generic update timestamps", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      accountId: "whoop-user-1",
      importedAt: "2026-03-17T12:00:00.000Z",
      bodyMeasurements: {
        height_meter: 1.82,
        weight_kilogram: 72.8,
        updated_at: "2026-03-17T08:00:00.000Z",
        measured_at: "2026-03-16T07:00:00.000Z",
      },
    },
  });

  const weightEvent = payload.events?.find((event) => event.fields?.metric === "weight");

  assert.equal(weightEvent?.occurredAt, "2026-03-16T07:00:00.000Z");
  assert.equal(weightEvent?.recordedAt, "2026-03-16T07:00:00.000Z");
  assert.equal(weightEvent?.dayKey, undefined);
  assertWhoopScopedBodyDateResourceId(weightEvent?.externalRef?.resourceId, "2026-03-16");
  assert.equal(payload.provenance?.bodyMeasurementDay, undefined);
});

test("prepareDeviceProviderSnapshotImport preserves WHOOP body measurement offset day keys", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      accountId: "whoop-user-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      bodyMeasurements: {
        height_meter: 1.82,
        weight_kilogram: 78.2,
        measured_at: "2026-06-25T03:30:00.000Z",
        timezone_offset: "-04:00",
      },
    },
  });

  const weightEvent = payload.events?.find((event) => event.fields?.metric === "weight");

  assert.equal(weightEvent?.occurredAt, "2026-06-25T03:30:00.000Z");
  assert.equal(weightEvent?.dayKey, "2026-06-24");
  assertWhoopScopedBodyDateResourceId(weightEvent?.externalRef?.resourceId, "2026-06-24");
  assert.equal(payload.provenance?.bodyMeasurementDay, "2026-06-24");
});

test("prepareDeviceProviderSnapshotImport keeps date-only WHOOP body measurement identity stable", async () => {
  const firstPayload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      accountId: "whoop-user-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      bodyMeasurements: {
        date: "2026-06-24",
        updated_at: "2026-06-25T12:00:00.000Z",
        weight_kilogram: 78.2,
      },
    },
  });
  const secondPayload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      accountId: "whoop-user-1",
      importedAt: "2026-06-26T12:00:00.000Z",
      bodyMeasurements: {
        date: "2026-06-24",
        updated_at: "2026-06-26T12:00:00.000Z",
        weight_kilogram: 78.2,
      },
    },
  });
  const firstWeightEvent = firstPayload.events?.find((event) => event.fields?.metric === "weight");
  const secondWeightEvent = secondPayload.events?.find((event) => event.fields?.metric === "weight");

  assert.equal(firstWeightEvent?.occurredAt, "2026-06-24T00:00:00.000Z");
  assert.equal(secondWeightEvent?.occurredAt, firstWeightEvent?.occurredAt);
  assert.equal(firstWeightEvent?.recordedAt, "2026-06-25T12:00:00.000Z");
  assert.equal(secondWeightEvent?.recordedAt, "2026-06-26T12:00:00.000Z");
  assert.equal(firstWeightEvent?.dayKey, "2026-06-24");
  assert.equal(secondWeightEvent?.dayKey, "2026-06-24");
  assertWhoopScopedBodyDateResourceId(firstWeightEvent?.externalRef?.resourceId, "2026-06-24");
  assert.equal(secondWeightEvent?.externalRef?.resourceId, firstWeightEvent?.externalRef?.resourceId);
});

test("importDeviceProviderSnapshot replays date-only WHOOP body measurements idempotently", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-body-date-only-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: "2026-07-01T12:00:00.000Z",
          bodyMeasurements: {
            date: "2026-06-24",
            updated_at: "2026-06-25T12:00:00.000Z",
            weight_kilogram: 78.2,
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: "2026-07-02T12:00:00.000Z",
          bodyMeasurements: {
            date: "2026-06-24",
            updated_at: "2026-06-26T12:00:00.000Z",
            weight_kilogram: 78.2,
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const firstWeight = firstImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const replayWeight = replayImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const [eventShardPath] = firstImport.eventShardPaths;
    assert.ok(eventShardPath);
    const records = await coreRuntime.readJsonlRecords({
      vaultRoot,
      relativePath: eventShardPath,
    });
    const weightRecords = records.filter(
      (record) => record.kind === "observation" && record.metric === "weight",
    );

    assert.equal(firstWeight?.occurredAt, "2026-06-24T00:00:00.000Z");
    assert.equal(firstWeight?.recordedAt, "2026-06-25T12:00:00.000Z");
    assert.equal(replayWeight?.id, firstWeight?.id);
    assert.equal(replayWeight?.occurredAt, firstWeight?.occurredAt);
    assert.equal(replayWeight?.recordedAt, firstWeight?.recordedAt);
    assert.equal(weightRecords.length, 1);
    assert.equal(weightRecords[0]?.occurredAt, "2026-06-24T00:00:00.000Z");
    assert.equal(weightRecords[0]?.recordedAt, "2026-06-25T12:00:00.000Z");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot makes operational WHOOP snapshot timestamp churn a storage no-op", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-operational-snapshot-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });
    const importAt = (importedAt: string) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "whoop",
          vaultRoot,
          snapshot: {
            accountId: "whoop-user-1",
            importedAt,
            bodyMeasurements: {
              date: "2026-06-24",
              updated_at: "2026-06-25T12:00:00.000Z",
              weight_kilogram: 78.2,
            },
          },
        },
        { corePort: coreRuntime },
      );

    const first = await importAt("2026-07-01T12:00:00.000Z");
    const replay = await importAt("2026-07-02T12:00:00.000Z");

    assert.ok(first.applied);
    assert.equal(replay.applied, false);
    assert.equal(replay.ingestId, null);
    assert.equal(replay.auditPath, null);
    assert.equal(replay.persistedEvidencePartCount, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot preserves a WHOOP user edit across later poll identity churn", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-user-edit-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });
    const importAt = (importedAt: string) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "whoop",
          vaultRoot,
          snapshot: {
            accountId: "whoop-user-1",
            importedAt,
            bodyMeasurements: {
              date: "2026-06-24",
              updated_at: "2026-06-25T12:00:00.000Z",
              weight_kilogram: 78.2,
            },
          },
        },
        { corePort: coreRuntime },
      );

    const first = await importAt("2026-07-01T12:00:00.000Z");
    const weight = first.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    assert.ok(weight);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: { ...weight, note: "user-owned note", source: "manual" },
    });

    const replay = await importAt("2026-07-02T12:00:00.000Z");
    const records = (
      await Promise.all(
        first.eventShardPaths.map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const latestWeight = latestLiveRecords(records).find((record) => record.id === weight.id);

    assert.equal(replay.applied, false);
    assert.equal(replay.events.find((event) => event.id === weight.id), undefined);
    assert.equal(latestWeight?.note, "user-owned note");
    assert.equal(records.filter((record) => record.id === weight.id).length, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot rejects delayed WHOOP revisions across later poll identity churn", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-delayed-revision-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });
    const importVersion = (input: {
      importedAt: string;
      updatedAt: string;
    }) => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: input.importedAt,
          sleeps: [{
            id: "sleep-delayed-revision",
            start: "2026-06-24T22:00:00.000Z",
            end: "2026-06-25T06:00:00.000Z",
            updated_at: input.updatedAt,
            score: { sleep_performance_percentage: 88 },
          }],
        },
      },
      { corePort: coreRuntime },
    );

    const first = await importVersion({
      importedAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-06-25T12:00:00.000Z",
    });
    const corrected = await importVersion({
      importedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-06-26T12:00:00.000Z",
    });
    const delayed = await importVersion({
      importedAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-06-25T12:00:00.000Z",
    });
    const correctedSleep = corrected.events.find(
      (event) => event.kind === "sleep_session",
    );
    const delayedSleep = delayed.events.find(
      (event) => event.kind === "sleep_session",
    );
    const records = (
      await Promise.all(
        first.eventShardPaths.map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const latestSleep = latestLiveRecords(records).find(
      (record) => record.id === correctedSleep?.id,
    );

    assert.equal(delayed.applied, false);
    assert.equal(delayedSleep, undefined);
    assert.equal(storedExternalRefVersion(latestSleep), "2026-06-26T12:00:00.000Z");
    assert.equal(records.filter((record) => record.id === correctedSleep?.id).length, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot preserves a WHOOP tombstone from a delayed later poll", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-delayed-tombstone-replay");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });
    const importVersion = (input: {
      importedAt: string;
      updatedAt: string;
    }) => importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: input.importedAt,
          sleeps: [{
            id: "sleep-delayed-tombstone",
            start: "2026-06-24T22:00:00.000Z",
            end: "2026-06-25T06:00:00.000Z",
            updated_at: input.updatedAt,
            score: { sleep_performance_percentage: 88 },
          }],
        },
      },
      { corePort: coreRuntime },
    );

    await importVersion({
      importedAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-06-25T12:00:00.000Z",
    });
    const corrected = await importVersion({
      importedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-06-26T12:00:00.000Z",
    });
    const correctedSleep = corrected.events.find(
      (event) => event.kind === "sleep_session",
    );
    assert.ok(correctedSleep);
    await coreRuntime.deleteEvent({ vaultRoot, eventId: correctedSleep.id });

    const delayed = await importVersion({
      importedAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-06-25T12:00:00.000Z",
    });
    const records = (
      await Promise.all(
        corrected.eventShardPaths.map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();

    assert.equal(delayed.applied, false);
    assert.equal(latestLiveRecords(records).some((record) => record.id === correctedSleep.id), false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot keys current WHOOP body snapshots by vault local day", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-body-current-local-day");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-24T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const importAt = (importedAt: string, weightKilogram: number) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "whoop",
          vaultRoot,
          snapshot: {
            accountId: "whoop-user-1",
            importedAt,
            bodyMeasurements: {
              weight_kilogram: weightKilogram,
            },
          },
        },
        {
          corePort: coreRuntime,
        },
      );

    const firstImport = await importAt("2026-06-24T23:30:00.000Z", 78.2);
    const replaySameLocalDay = await importAt("2026-06-25T03:30:00.000Z", 78.2);
    const nextLocalDay = await importAt("2026-06-25T04:30:00.000Z", 78.6);
    const records = (
      await Promise.all(
        [...new Set([
          ...firstImport.eventShardPaths,
          ...replaySameLocalDay.eventShardPaths,
          ...nextLocalDay.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const liveWeightRecords = latestLiveRecords(records)
      .filter((record) => record.kind === "observation" && record.metric === "weight")
      .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));
    const firstWeight = firstImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const replayWeight = replaySameLocalDay.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const nextWeight = nextLocalDay.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );

    assert.equal(replayWeight?.id, firstWeight?.id);
    assert.notEqual(nextWeight?.id, firstWeight?.id);
    assert.deepEqual(liveWeightRecords.map((record) => record.dayKey), ["2026-06-24", "2026-06-25"]);
    assert.deepEqual(
      liveWeightRecords.map((record) => whoopBodyDateResourceSuffix(storedExternalRefResourceId(record))),
      ["date:2026-06-24", "date:2026-06-25"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot scopes WHOOP body measurement identities by account", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-body-account-scope");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-24T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const importAccount = (accountId: string, weightKilogram: number) =>
      importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
        {
          provider: "whoop",
          vaultRoot,
          snapshot: {
            accountId,
            importedAt: "2026-06-25T12:00:00.000Z",
            bodyMeasurements: {
              date: "2026-06-24",
              updated_at: "2026-06-25T12:00:00.000Z",
              weight_kilogram: weightKilogram,
            },
          },
        },
        {
          corePort: coreRuntime,
        },
      );

    const firstAccount = await importAccount("whoop-account-a", 78.2);
    const secondAccount = await importAccount("whoop-account-b", 82.4);
    const firstReplay = await importAccount("whoop-account-a", 78.2);
    const records = (
      await Promise.all(
        [...new Set([
          ...firstAccount.eventShardPaths,
          ...secondAccount.eventShardPaths,
          ...firstReplay.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const liveWeightRecords = latestLiveRecords(records)
      .filter((record) => record.kind === "observation" && record.metric === "weight")
      .sort((left, right) => Number(left.value) - Number(right.value));
    const firstWeight = firstAccount.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const secondWeight = secondAccount.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const replayWeight = firstReplay.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );

    assert.equal(replayWeight?.id, firstWeight?.id);
    assert.notEqual(secondWeight?.id, firstWeight?.id);
    assert.equal(liveWeightRecords.length, 2);
    assert.deepEqual(liveWeightRecords.map((record) => record.value), [78.2, 82.4]);
    assert.equal(
      new Set(liveWeightRecords.map((record) => storedExternalRefResourceId(record))).size,
      2,
    );
    assertWhoopScopedBodyDateResourceId(storedExternalRefResourceId(liveWeightRecords[0]), "2026-06-24");
    assertWhoopScopedBodyDateResourceId(storedExternalRefResourceId(liveWeightRecords[1]), "2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot supersedes date-only direct WHOOP body measurements keyed by UTC day", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-body-date-only-legacy-ref");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const legacyImport = await coreRuntime.importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: "2026-06-25T12:00:00.000Z",
      events: [{
        kind: "observation",
        occurredAt: "2026-06-25T12:00:00.000Z",
        recordedAt: "2026-06-25T12:00:00.000Z",
        dayKey: "2026-06-25",
        title: "WHOOP weight",
        externalRef: {
          system: "whoop",
          resourceType: "body-measurement",
          resourceId: "2026-06-25",
          facet: "weight",
        },
        fields: {
          metric: "weight",
          observationGrain: "summary",
          value: 78.2,
          unit: "kg",
        },
      }],
    });
    const replayImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: "2026-06-25T12:00:00.000Z",
          bodyMeasurements: {
            date: "2026-06-24",
            updated_at: "2026-06-25T12:00:00.000Z",
            weight_kilogram: 78.2,
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const legacyWeight = legacyImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const replayWeight = replayImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const records = (
      await Promise.all(
        [...new Set([...legacyImport.eventShardPaths, ...replayImport.eventShardPaths])].map((relativePath) =>
          coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
        ),
      )
    ).flat();
    const liveWeightRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "weight",
    );

    assert.equal(replayWeight?.id, legacyWeight?.id);
    assert.equal(replayWeight?.occurredAt, "2026-06-24T00:00:00.000Z");
    assert.equal(replayWeight?.recordedAt, "2026-06-25T12:00:00.000Z");
    assert.equal(replayWeight?.dayKey, "2026-06-24");
    assertWhoopScopedBodyDateResourceId(replayWeight?.externalRef?.resourceId, "2026-06-24");
    assert.equal(liveWeightRecords.length, 1);
    assert.equal(liveWeightRecords[0]?.id, legacyWeight?.id);
    assert.equal(whoopBodyDateResourceSuffix(storedExternalRefResourceId(liveWeightRecords[0])), "date:2026-06-24");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot does not alias WHOOP body measurements to import day when updated_at exists", async () => {
  const vaultRoot = await makeTempDirectory("murph-whoop-body-date-only-import-day-alias");
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-06-25T00:00:00.000Z",
      timezone: "America/New_York",
    });

    const julyImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: "2026-07-01T12:00:00.000Z",
          bodyMeasurements: {
            date: "2026-07-01",
            updated_at: "2026-07-01T12:00:00.000Z",
            weight_kilogram: 79.4,
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const olderImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
      {
        provider: "whoop",
        vaultRoot,
        snapshot: {
          accountId: "whoop-user-1",
          importedAt: "2026-07-01T12:00:00.000Z",
          bodyMeasurements: {
            date: "2026-06-24",
            updated_at: "2026-06-25T12:00:00.000Z",
            weight_kilogram: 78.2,
          },
        },
      },
      {
        corePort: coreRuntime,
      },
    );
    const julyWeight = julyImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const olderWeight = olderImport.events.find(
      (event) => event.kind === "observation" && event.metric === "weight",
    );
    const records = (
      await Promise.all(
        [...new Set([
          ...julyImport.eventShardPaths,
          ...olderImport.eventShardPaths,
        ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat();
    const liveWeightRecords = latestLiveRecords(records).filter(
      (record) => record.kind === "observation" && record.metric === "weight",
    );

    assert.notEqual(olderWeight?.id, julyWeight?.id);
    assertWhoopScopedBodyDateResourceId(olderWeight?.externalRef?.resourceId, "2026-06-24");
    assertWhoopScopedBodyDateResourceId(julyWeight?.externalRef?.resourceId, "2026-07-01");
    assert.equal(liveWeightRecords.length, 2);
    assert.deepEqual(
      liveWeightRecords.map((record) => whoopBodyDateResourceSuffix(storedExternalRefResourceId(record))).sort(),
      ["date:2026-06-24", "date:2026-07-01"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("importDeviceProviderSnapshot keeps adjacent legacy WHOOP body dates distinct during replay", async () => {
  async function exercise(order: "corrected-first" | "adjacent-first") {
    const vaultRoot = await makeTempDirectory(`murph-whoop-body-adjacent-${order}`);
    try {
      await coreRuntime.initializeVault({
        vaultRoot,
        createdAt: "2026-06-25T00:00:00.000Z",
        timezone: "America/New_York",
      });

      const legacyImport = await coreRuntime.importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        accountId: "whoop-user-1",
        importedAt: "2026-06-25T12:00:00.000Z",
        events: [{
          kind: "observation",
          occurredAt: "2026-06-25T12:00:00.000Z",
          recordedAt: "2026-06-25T12:00:00.000Z",
          dayKey: "2026-06-24",
          title: "WHOOP weight",
          externalRef: {
            system: "whoop",
            resourceType: "body-measurement",
            resourceId: "2026-06-25",
            facet: "weight",
          },
          fields: {
            metric: "weight",
            observationGrain: "summary",
            value: 78.2,
            unit: "kg",
          },
        }],
      });
      const importSnapshot = (date: string, updatedAt: string, weightKilogram: number) =>
        importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
          {
            provider: "whoop",
            vaultRoot,
            snapshot: {
              accountId: "whoop-user-1",
              importedAt: updatedAt,
              bodyMeasurements: {
                date,
                updated_at: updatedAt,
                weight_kilogram: weightKilogram,
              },
            },
          },
          {
            corePort: coreRuntime,
          },
        );

      const correctedJune24 = () => importSnapshot("2026-06-24", "2026-06-25T12:00:00.000Z", 78.2);
      const adjacentJune25 = () => importSnapshot("2026-06-25", "2026-06-25T13:00:00.000Z", 78.2);
      const firstReplay = order === "corrected-first" ? await correctedJune24() : await adjacentJune25();
      const secondReplay = order === "corrected-first" ? await adjacentJune25() : await correctedJune24();
      const records = (
        await Promise.all(
          [...new Set([
            ...legacyImport.eventShardPaths,
            ...firstReplay.eventShardPaths,
            ...secondReplay.eventShardPaths,
          ])].map((relativePath) => coreRuntime.readJsonlRecords({ vaultRoot, relativePath })),
        )
      ).flat();
      const liveWeightRecords = latestLiveRecords(records)
        .filter((record) => record.kind === "observation" && record.metric === "weight")
        .sort((left, right) => String(left.dayKey).localeCompare(String(right.dayKey)));

      assert.equal(liveWeightRecords.length, 2);
      assert.deepEqual(liveWeightRecords.map((record) => record.dayKey), ["2026-06-24", "2026-06-25"]);
      assert.deepEqual(
        liveWeightRecords.map((record) => whoopBodyDateResourceSuffix(storedExternalRefResourceId(record))),
        ["date:2026-06-24", "date:2026-06-25"],
      );
      assert.equal(
        liveWeightRecords.find((record) => record.dayKey === "2026-06-24")?.id,
        legacyImport.events.find((event) => event.kind === "observation" && event.metric === "weight")?.id,
      );
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  }

  await exercise("corrected-first");
  await exercise("adjacent-first");
});

test("prepareDeviceProviderSnapshotImport preserves shared raw-artifact omission and text trimming across Oura and WHOOP", async () => {
  const longResourceType = `resource-${"x".repeat(200)}`;
  const longSourceEventType = "y".repeat(5000);

  const ouraPayload = await prepareDeviceProviderSnapshotImport({
    provider: "oura",
    snapshot: {
      personalInfo: {},
      heartrate: [],
      deletions: [
        {
          resource_type: longResourceType,
          resource_id: "oura-deleted-1",
          occurred_at: "2026-03-16T10:00:00.000Z",
          source_event_type: longSourceEventType,
        },
      ],
    },
  });

  const whoopPayload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      profile: {},
      bodyMeasurements: {},
      deletions: [
        {
          resource_type: longResourceType,
          resource_id: "whoop-deleted-1",
          occurred_at: "2026-03-16T10:00:00.000Z",
          source_event_type: longSourceEventType,
        },
      ],
    },
  });

  const ouraDeletion = ouraPayload.events?.find(
    (event) => event.externalRef?.resourceId === "oura-deleted-1",
  );
  const whoopDeletion = whoopPayload.events?.find(
    (event) => event.externalRef?.resourceId === "whoop-deleted-1",
  );

  assert.equal(ouraPayload.evidenceParts?.some((artifact) => artifact.role === "personal-info"), false);
  assert.equal(ouraPayload.evidenceParts?.some((artifact) => artifact.role === "heartrate"), false);
  assert.equal(whoopPayload.evidenceParts?.some((artifact) => artifact.role === "profile"), false);
  assert.equal(whoopPayload.evidenceParts?.some((artifact) => artifact.role === "body-measurement"), false);
  assert.equal(ouraDeletion?.title?.length, 160);
  assert.equal(ouraDeletion?.note?.length, 4000);
  assert.equal(whoopDeletion?.title?.length, 160);
  assert.equal(whoopDeletion?.note?.length, 4000);
});

test("prepareDeviceProviderSnapshotImport covers WHOOP fallback ids and workout distance fallbacks", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
    snapshot: {
      profile: {
        userId: "whoop-profile-3",
      },
      sleeps: [
        {
          nap: true,
          start: "2026-03-15T13:00:00.000Z",
          end: "2026-03-15T13:45:00.000Z",
          updated_at: "2026-03-15T13:50:00.000Z",
          score: {
            stage_summary: {},
          },
        },
      ],
      recoveries: [
        {
          cycle_id: "cycle-77",
          updated_at: "2026-03-15T13:50:00.000Z",
          score: {},
        },
      ],
      cycles: [
        {
          start: "2026-03-15T00:00:00.000Z",
          updated_at: "2026-03-16T00:05:00.000Z",
          score: {
            strain: 12.1,
          },
        },
      ],
      workouts: [
        {
          start: "2026-03-15T17:00:00.000Z",
          end: "2026-03-15T17:45:00.000Z",
          updated_at: "2026-03-15T18:00:00.000Z",
          sport_name: "!!!",
          altitude_gain_meter: "18",
          altitude_change_meter: "-4",
          distance_meter: 4800,
          score: {
            strain: "9.4",
            average_heart_rate: "132",
            max_heart_rate: "151",
            kilojoule: "418.4",
            percent_recorded: "96",
          },
        },
      ],
    },
  });

  const napEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(payload.accountId, "whoop-profile-3");
  assert.equal(payload.provenance?.whoopUserId, "whoop-profile-3");
  assert.equal(napEvent?.title, "WHOOP nap");
  assert.equal(workoutEvent?.fields?.activityType, "workout");
  assert.equal(workoutEvent?.fields?.distanceKm, 4.8);
  assert.deepEqual(workoutMetricsFromEvent(workoutEvent), {
    workoutStrain: 9.4,
    averageHeartRate: 132,
    maxHeartRate: 151,
    totalCalories: 100,
    percentRecorded: 96,
    totalElevationGainMeters: 18,
    altitudeChangeMeters: -4,
  });
  assert.equal(
    payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "sleep-awake-minutes"),
    false,
  );
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role.startsWith("sleep:sleep-")));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role === "recovery:cycle-77"));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role.startsWith("cycle:cycle-")));
  assert.ok(payload.evidenceParts?.some((artifact) => artifact.role.startsWith("workout:workout-")));
});
