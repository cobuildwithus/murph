import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import * as coreRuntime from "@murphai/core";

import {
  createDeviceProviderRegistry,
  createImporters,
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
  type DeviceProviderAdapter,
  type DeviceProviderSnapshotImportPayload,
  type NormalizedDeviceBatch,
} from "../src/index.ts";
import {
  makeNormalizedDeviceBatch,
  type NormalizedDeviceBatchOptions,
} from "../src/device-providers/shared-normalization.ts";

type AssertTrue<T extends true> = T;
type IsMutuallyAssignable<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

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

async function makeTempDirectory(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
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
  assert.ok(payload.samples?.some((sample) => sample.stream === "respiratory_rate"));
  assert.ok(payload.samples?.some((sample) => sample.stream === "hrv"));
  assert.ok(payload.samples?.some((sample) => sample.stream === "temperature"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "profile"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "sleep:sleep-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "workout:workout-1"));

  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const workoutEvent = payload.events?.find((event) => event.kind === "activity_session");
  const hrvSample = payload.samples?.find((sample) => sample.stream === "hrv");

  assert.deepEqual(sleepEvent?.fields, {
    startAt: "2026-03-15T22:00:00.000Z",
    endAt: "2026-03-16T07:00:00.000Z",
    durationMinutes: 540,
  });
  assert.equal(workoutEvent?.fields?.activityType, "run");
  assert.equal(workoutEvent?.fields?.distanceKm, 7.25);
  assert.equal(hrvSample?.sample.value, 42.5);
  assert.equal(hrvSample?.externalRef?.facet, "hrv");
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
    payload.samples?.some(
      (sample) => sample.stream === "respiratory_rate" && sample.sample.value === 13.8,
    ),
  );
  assert.ok(payload.samples?.some((sample) => sample.stream === "hrv" && sample.sample.value === 41.2));
  assert.ok(payload.samples?.some((sample) => sample.stream === "heart_rate" && sample.sample.value === 64));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "personal-info"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "sleep:sleep-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "session:session-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "workout:workout-1"));
  assert.ok(
    payload.rawArtifacts?.some((artifact) => artifact.role === "deletion:workout:workout-deleted"),
  );

  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const workoutEvent = payload.events?.find((event) => event.externalRef?.resourceType === "workout");
  const activityScoreEvent = payload.events?.find(
    (event) => event.fields?.metric === "activity-score",
  );
  const sleepSummarySample = payload.samples?.find(
    (sample) => sample.stream === "respiratory_rate",
  );

  assert.deepEqual(sleepEvent?.fields, {
    startAt: "2026-03-14T22:30:00.000Z",
    endAt: "2026-03-15T06:45:00.000Z",
    durationMinutes: 495,
  });
  assert.equal(activityScoreEvent?.dayKey, "2026-03-15");
  assert.equal(sleepSummarySample?.dayKey, "2026-03-15");
  assert.equal(workoutEvent?.fields?.activityType, "running");
  assert.equal(workoutEvent?.fields?.distanceKm, 6.8);
});

test("prepareDeviceProviderSnapshotImport preserves descriptor-driven Oura and WHOOP unit and facet mappings", async () => {
  const [ouraPayload, whoopPayload] = await Promise.all([
    prepareDeviceProviderSnapshotImport({
      provider: "oura",
      snapshot: {
        dailyActivity: [
          {
            day: "2026-03-15",
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
  const ouraSpo2Event = ouraPayload.events?.find((event) => event.externalRef?.facet === "spo2-average");
  const ouraNonWearEvent = ouraPayload.events?.find((event) => event.externalRef?.facet === "non-wear-minutes");
  const whoopRemEvent = whoopPayload.events?.find((event) => event.externalRef?.facet === "sleep-rem-minutes");
  const whoopTemperatureSample = whoopPayload.samples?.find(
    (sample) => sample.externalRef?.facet === "skin-temperature",
  );

  assert.equal(ouraStepsEvent?.fields?.metric, "daily-steps");
  assert.equal(ouraStepsEvent?.fields?.unit, "count");
  assert.equal(ouraSpo2Event?.fields?.metric, "spo2");
  assert.equal(ouraSpo2Event?.fields?.unit, "%");
  assert.equal(ouraNonWearEvent?.fields?.value, 20);
  assert.equal(ouraNonWearEvent?.fields?.unit, "minutes");
  assert.equal(whoopRemEvent?.fields?.metric, "sleep-rem-minutes");
  assert.equal(whoopRemEvent?.fields?.unit, "minutes");
  assert.equal(whoopTemperatureSample?.unit, "celsius");
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
    payload.samples?.some(
      (sample) => sample.stream === "respiratory_rate" && sample.sample.value === 13.8,
    ),
  );
  assert.ok(payload.samples?.some((sample) => sample.stream === "hrv" && sample.sample.value === 41.2));
  assert.ok(payload.samples?.some((sample) => sample.stream === "heart_rate" && sample.sample.value === 64));
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
  const deletionArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "deletion:session:session-42");

  assert.equal(deletionEvent?.externalRef?.system, "oura");
  assert.equal(deletionEvent?.externalRef?.resourceType, "session");
  assert.equal(deletionEvent?.externalRef?.resourceId, "session-42");
  assert.equal(deletionEvent?.occurredAt, "2026-03-16T10:30:00.000Z");
  assert.equal(deletionEvent?.note, "Webhook event: session.deleted");
  assert.equal(deletionEvent?.fields?.sourceEventType, "session.deleted");
  assert.equal(deletionArtifact?.fileName, "deletion-session-session-42.json");
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
    payload.rawArtifacts?.some(
      (artifact) => artifact.role === "deletion:daily-readiness:2026-03-16",
    ),
  );
});

test("prepareDeviceProviderSnapshotImport normalizes Garmin snapshots into canonical device payloads", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    vaultRoot: "fixture-vault",
    snapshot: {
      accountId: "garmin-user-1",
      importedAt: "2026-03-16T11:00:00.000Z",
      profile: {
        id: "garmin-user-1",
        displayName: "Garmin User",
      },
      dailySummaries: [
        {
          summaryId: "2026-03-15",
          calendarDate: "2026-03-15",
          steps: 12034,
          activeCalories: 640,
          totalCalories: 2600,
          distanceMeters: 10450,
          floorsClimbed: 12,
          moderateIntensityMinutes: 34,
          vigorousIntensityMinutes: 18,
          restingHeartRate: 52,
          averageHeartRate: 74,
          maxHeartRate: 168,
          averageStressLevel: 29,
          bodyBattery: 76,
          averageSpo2: 97.2,
          averageRespirationRate: 14.1,
          systolicBloodPressure: 118,
          diastolicBloodPressure: 76,
          weightKg: 72.4,
          bodyFatPercent: 14.8,
          bmi: 22.3,
        },
      ],
      epochSummaries: [
        {
          epochId: "epoch-1",
          timestamp: "2026-03-15T12:00:00.000Z",
          heartRate: 64,
          steps: 42,
          respirationRate: 13.9,
          temperatureCelsius: 36.7,
          hrvMs: 51.2,
          stressLevel: 18,
          bodyBattery: 74,
          spo2: 98.1,
          activeCalories: 4.2,
        },
      ],
      sleeps: [
        {
          sleepId: "sleep-1",
          startTime: "2026-03-14T22:30:00.000Z",
          endTime: "2026-03-15T06:45:00.000Z",
          timestamp: "2026-03-15T06:50:00.000Z",
          sleepScore: 84,
          averageRespirationRate: 13.6,
          averageSpo2: 97.5,
          averageHeartRate: 56,
          awakeMinutes: 20,
          deepMinutes: 90,
          lightMinutes: 240,
          remMinutes: 120,
          stages: [
            {
              stage: "deep",
              startTime: "2026-03-14T23:00:00.000Z",
              endTime: "2026-03-15T00:30:00.000Z",
            },
            {
              stage: "light",
              startTime: "2026-03-15T00:30:00.000Z",
              endTime: "2026-03-15T04:30:00.000Z",
            },
            {
              stage: "rem",
              startTime: "2026-03-15T04:30:00.000Z",
              endTime: "2026-03-15T06:30:00.000Z",
            },
          ],
        },
      ],
      activities: [
        {
          activityId: "activity-1",
          activityType: "running",
          startTime: "2026-03-15T17:00:00.000Z",
          endTime: "2026-03-15T17:45:00.000Z",
          timestamp: "2026-03-15T17:50:00.000Z",
          distanceMeters: 7250,
          activeCalories: 510,
          averageHeartRate: 141,
          maxHeartRate: 168,
          averageSpeedMetersPerSecond: 3.9,
          elevationGainMeters: 42,
          aerobicTrainingEffect: 3.1,
        },
      ],
      activityFiles: [
        {
          activityId: "activity-1",
          fileType: "fit",
          fileName: "activity-1.fit",
          content: "FITDATA",
          checksum: "abc123",
        },
      ],
      womenHealth: [
        {
          recordId: "cycle-1",
          recordType: "cycle",
          recordedAt: "2026-03-15T09:00:00.000Z",
          cycleDay: 12,
          cycleLengthDays: 28,
          periodLengthDays: 5,
        },
      ],
      deletions: [
        {
          resourceType: "activity",
          resourceId: "activity-deleted",
          occurredAt: "2026-03-16T11:00:00.000Z",
          eventType: "activity.deleted",
        },
      ],
    },
  });

  assert.equal(payload.vaultRoot, "fixture-vault");
  assert.equal(payload.provider, "garmin");
  assert.equal(payload.accountId, "garmin-user-1");
  assert.equal(payload.source, "device");
  assert.equal(payload.provenance?.garminUserId, "garmin-user-1");
  assert.ok(payload.events?.some((event) => event.kind === "sleep_session"));
  assert.ok(payload.events?.some((event) => event.kind === "activity_session"));
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "daily-steps" && event.fields?.value === 12034,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "body-battery" && event.fields?.value === 76,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "systolic-blood-pressure" && event.fields?.value === 118,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "cycle-day" && event.fields?.value === 12,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "external-resource-deleted" &&
        event.fields?.resourceType === "activity",
    ),
  );
  assert.ok(payload.samples?.some((sample) => sample.stream === "heart_rate" && sample.sample.value === 64));
  assert.ok(payload.samples?.some((sample) => sample.stream === "steps" && sample.sample.value === 42));
  assert.ok(
    payload.samples?.some(
      (sample) => sample.stream === "respiratory_rate" && sample.sample.value === 13.9,
    ),
  );
  assert.ok(payload.samples?.some((sample) => sample.stream === "temperature" && sample.sample.value === 36.7));
  assert.ok(payload.samples?.some((sample) => sample.stream === "hrv" && sample.sample.value === 51.2));
  assert.ok(
    payload.samples?.some(
      (sample) => sample.stream === "sleep_stage" && sample.sample.stage === "deep" && sample.sample.durationMinutes === 90,
    ),
  );
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "profile"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "daily-summary:2026-03-15"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "epoch-summary:epoch-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "sleep:sleep-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "activity:activity-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "activity-asset:activity-1:fit"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "women-health:cycle-1"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "deletion:activity:activity-deleted"));

  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const activityEvent = payload.events?.find((event) => event.kind === "activity_session");
  const activityFile = payload.rawArtifacts?.find((artifact) => artifact.role === "activity-asset:activity-1:fit");
  const dailyStepsObservation = payload.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "daily-steps",
  );

  assert.deepEqual(sleepEvent?.fields, {
    startAt: "2026-03-14T22:30:00.000Z",
    endAt: "2026-03-15T06:45:00.000Z",
    durationMinutes: 495,
  });
  assert.equal(dailyStepsObservation?.dayKey, "2026-03-15");
  assert.equal(dailyStepsObservation?.timeZone, undefined);
  assert.equal(activityEvent?.fields?.activityType, "running");
  assert.equal(activityEvent?.fields?.distanceKm, 7.25);
  assert.ok(activityEvent?.rawArtifactRoles?.includes("activity-asset:activity-1:fit"));
  assert.equal(activityFile?.fileName, "activity-1.fit");
  assert.equal(activityFile?.mediaType, "application/octet-stream");
  assert.equal(activityFile?.metadata?.checksum, "abc123");
});

test("prepareDeviceProviderSnapshotImport rounds fractional integer sample streams", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      accountId: "garmin-user-1",
      importedAt: "2026-03-16T11:00:00.000Z",
      epochSummaries: [
        {
          epochId: "epoch-1",
          timestamp: "2026-03-15T12:00:00.000Z",
          heartRate: 64.6,
          steps: 42.6,
          respirationRate: 13.9,
        },
      ],
    },
  });

  assert.ok(payload.samples?.some((sample) => sample.stream === "heart_rate" && sample.sample.value === 65));
  assert.ok(payload.samples?.some((sample) => sample.stream === "steps" && sample.sample.value === 43));
  assert.ok(
    payload.samples?.some(
      (sample) => sample.stream === "respiratory_rate" && sample.sample.value === 13.9,
    ),
  );
});

test("prepareDeviceProviderSnapshotImport handles Garmin alias collections, unsupported legacy file sections, and string numerics", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    vaultRoot: "fixture-vault",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      profile: {
        userId: 303,
      },
      dailySummary: [
        {
          calendarDate: "2026-03-16",
          steps: "1500",
          totalCalories: "2200",
        },
      ],
      epochs: [
        {
          epochId: 9,
          timestamp: "2026-03-16T12:05:00.000Z",
          heartRate: "61",
          bodyBattery: "70",
        },
      ],
      activities: [
        {
          id: "activity-2",
          type: "walking",
          startAt: "2026-03-16T13:00:00.000Z",
          endAt: "2026-03-16T13:30:00.000Z",
          calories: "120",
          distance: "2100",
        },
      ],
      files: [
        {
          activity: {
            id: "activity-2",
          },
          filename: "activity-2.tcx",
          payload: "<TrainingCenterDatabase />",
          metadata: {
            fileType: "tcx",
            checksum: "xyz789",
          },
        },
      ],
      womenHealthSummaries: [
        {
          id: "pregnancy-1",
          timestamp: "2026-03-16T09:00:00.000Z",
          gestationalWeek: "18",
        },
      ],
      deletions: [
        {
          data_type: "activity",
          object_id: "activity-3",
          event_time: "2026-03-16T14:00:00.000Z",
          source_event_type: "activity.deleted",
        },
      ],
    },
  });

  assert.equal(payload.accountId, "303");
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "daily-steps" && event.fields?.value === 1500,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "total-calories" && event.fields?.value === 2200,
    ),
  );
  assert.ok(payload.samples?.some((sample) => sample.stream === "heart_rate" && sample.sample.value === 61));
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "body-battery" && event.fields?.value === 70,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "activity_session" && event.fields?.activityType === "walking" && event.fields?.distanceKm === 2.1,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "pregnancy-week" && event.fields?.value === 18,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "external-resource-deleted" &&
        event.fields?.resourceType === "activity" &&
        event.fields?.sourceEventType === "activity.deleted",
    ),
  );
  assert.ok(!payload.rawArtifacts?.some((artifact) => artifact.role === "activity-asset:activity-2:tcx"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "snapshot-section:files"));
});

test("prepareDeviceProviderSnapshotImport keeps Garmin date buckets on the provider day and honors summaryDate aliases", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      dailySummaries: [
        {
          summaryDate: "2026-03-15",
          steps: 8765,
        },
      ],
      womenHealth: [
        {
          date: "2026-03-15",
          cycleDay: 7,
        },
      ],
    },
  });

  const dailySteps = payload.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "daily-steps",
  );
  const cycleDay = payload.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "cycle-day",
  );

  assert.equal(dailySteps?.occurredAt, "2026-03-15T00:00:00.000Z");
  assert.equal(dailySteps?.recordedAt, "2026-03-15T00:00:00.000Z");
  assert.equal(dailySteps?.dayKey, "2026-03-15");
  assert.equal(dailySteps?.timeZone, undefined);
  assert.equal(cycleDay?.dayKey, "2026-03-15");
  assert.equal(cycleDay?.recordedAt, "2026-03-15T00:00:00.000Z");
});

test("prepareDeviceProviderSnapshotImport synthesizes Garmin date-bucket timestamps that match the provider timezone", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      dailySummaries: [
        {
          summaryDate: "2026-03-15",
          timeZone: "America/Los_Angeles",
          steps: 8765,
        },
      ],
      womenHealth: [
        {
          date: "2026-03-15",
          timeZone: "America/Los_Angeles",
          cycleDay: 7,
        },
      ],
    },
  });

  const dailySteps = payload.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "daily-steps",
  );
  const cycleDay = payload.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "cycle-day",
  );

  assert.equal(dailySteps?.occurredAt, "2026-03-15T07:00:00.000Z");
  assert.equal(dailySteps?.recordedAt, "2026-03-15T07:00:00.000Z");
  assert.equal(dailySteps?.dayKey, "2026-03-15");
  assert.equal(dailySteps?.timeZone, "America/Los_Angeles");
  assert.equal(cycleDay?.occurredAt, "2026-03-15T07:00:00.000Z");
  assert.equal(cycleDay?.recordedAt, "2026-03-15T07:00:00.000Z");
  assert.equal(cycleDay?.dayKey, "2026-03-15");
  assert.equal(cycleDay?.timeZone, "America/Los_Angeles");
});

test("prepareDeviceProviderSnapshotImport rounds Garmin duration fields before they reach integer-only canonical records", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      activities: [
        {
          activityId: "activity-1",
          activityType: "run",
          startTime: "2026-03-15T10:00:00.000Z",
          endTime: "2026-03-15T10:01:35.000Z",
          durationSeconds: 95,
        },
      ],
      sleeps: [
        {
          sleepId: "sleep-1",
          startTime: "2026-03-15T00:00:00.000Z",
          endTime: "2026-03-15T00:01:35.000Z",
          durationMillis: 95_000,
          stages: [
            {
              stage: "light",
              startTime: "2026-03-15T00:00:00.000Z",
              endTime: "2026-03-15T00:01:35.000Z",
              durationSeconds: 95,
            },
          ],
        },
      ],
    },
  });

  const activityEvent = payload.events?.find((event) => event.kind === "activity_session");
  const sleepEvent = payload.events?.find((event) => event.kind === "sleep_session");
  const sleepStage = payload.samples?.find((sample) => sample.stream === "sleep_stage");

  assert.equal(activityEvent?.fields?.durationMinutes, 2);
  assert.equal(sleepEvent?.fields?.durationMinutes, 2);
  assert.equal(sleepStage?.sample.durationMinutes, 2);
});

test("prepareDeviceProviderSnapshotImport drops unsupported Garmin sleep stage labels", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      sleeps: [
        {
          sleepId: "sleep-1",
          startTime: "2026-03-15T00:00:00.000Z",
          endTime: "2026-03-15T01:00:00.000Z",
          stages: [
            {
              stage: "mystery-phase",
              startTime: "2026-03-15T00:00:00.000Z",
              endTime: "2026-03-15T00:30:00.000Z",
            },
            {
              stage: "light",
              startTime: "2026-03-15T00:30:00.000Z",
              endTime: "2026-03-15T01:00:00.000Z",
            },
          ],
        },
      ],
    },
  });

  assert.equal(
    payload.samples?.filter((sample) => sample.stream === "sleep_stage").length,
    1,
  );
  assert.ok(
    payload.samples?.some(
      (sample) => sample.stream === "sleep_stage" && sample.sample.stage === "light",
    ),
  );
  assert.ok(
    !payload.samples?.some(
      (sample) => sample.stream === "sleep_stage" && sample.sample.stage === "mystery-phase",
    ),
  );
});

test("prepareDeviceProviderSnapshotImport keeps metadata-only Garmin activityFiles on first-class asset roles and links them from the activity event", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      activities: [
        {
          activityId: "activity-1",
          activityType: "run",
          startTime: "2026-03-15T10:00:00.000Z",
          endTime: "2026-03-15T10:30:00.000Z",
        },
      ],
      activityFiles: [
        {
          activityId: "activity-1",
          fileType: "fit",
          fileName: "activity-1.fit",
          checksum: "abc123",
        },
      ],
    },
  });

  const descriptor = payload.rawArtifacts?.find((artifact) => artifact.role === "activity-asset:activity-1:fit");
  const activityEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.ok(descriptor);
  assert.equal(descriptor?.fileName, "activity-1-fit-asset-descriptor.json");
  assert.equal(descriptor?.mediaType, "application/json");
  assert.equal(descriptor?.metadata?.intendedFileType, "fit");
  assert.equal(descriptor?.metadata?.intendedFileName, "activity-1.fit");
  assert.ok(activityEvent?.rawArtifactRoles?.includes("activity-asset:activity-1:fit"));
  assert.ok(!payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("activity-file:")));
});

test("importDeviceProviderSnapshot re-imports metadata-only Garmin activity files without churning the canonical activity-session id", async () => {
  const vaultRoot = await makeTempDirectory("murph-garmin-metadata-only-reimport");
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
    timezone: "America/Los_Angeles",
  });

  const snapshot = {
    importedAt: "2026-03-16T12:00:00.000Z",
    activities: [
      {
        activityId: "activity-1",
        activityType: "run",
        startTime: "2026-03-15T10:00:00.000Z",
        endTime: "2026-03-15T10:30:00.000Z",
      },
    ],
    activityFiles: [
      {
        activityId: "activity-1",
        fileType: "fit",
        fileName: "activity-1.fit",
        checksum: "abc123",
      },
    ],
  };

  const firstImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      provider: "garmin",
      vaultRoot,
      snapshot,
    },
    {
      corePort: coreRuntime,
    },
  );
  const secondImport = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      provider: "garmin",
      vaultRoot,
      snapshot,
    },
    {
      corePort: coreRuntime,
    },
  );

  const firstActivityEvent = firstImport.events.find((event) => event.kind === "activity_session");
  const secondActivityEvent = secondImport.events.find((event) => event.kind === "activity_session");
  const storedEvents = await coreRuntime.readJsonlRecords({
    vaultRoot,
    relativePath: firstImport.eventShardPaths[0]!,
  });

  assert.equal(firstActivityEvent?.id, secondActivityEvent?.id);
  assert.equal(
    storedEvents.filter((event) => event.id === firstActivityEvent?.id).length,
    1,
  );
});

test("prepareDeviceProviderSnapshotImport preserves unsupported Garmin sections and treats the old files alias as an unsupported retained section", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      activityFiles: [
        42,
        {
          activityId: "activity-2",
          fileType: "tcx",
          fileName: "activity-2.tcx",
          payload: "<TrainingCenterDatabase />",
        },
      ],
      files: [
        "https://example.test/download/garmin/file",
        {
          activityId: "activity-1",
          fileType: "gpx",
          fileName: "activity-1.gpx",
          content: "<gpx />",
        },
        {
          fileType: "fit",
          fileName: "daily-summary.fit",
          checksum: "not-an-activity-file",
        },
      ],
      readinessWidgets: [
        42,
      ],
    },
  });

  const retainedSnapshotSections =
    (payload.provenance?.importedSections as { retainedSnapshotSections?: string[] } | undefined)?.retainedSnapshotSections;

  assert.ok(!payload.rawArtifacts?.some((artifact) => artifact.role === "activity-asset:activity-1:gpx"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "activity-asset:activity-2:tcx"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "snapshot-section:activityfiles"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "snapshot-section:files"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "snapshot-section:readinesswidgets"));
  assert.ok(!payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("activity-asset:unknown:fit")));
  assert.deepEqual(
    [...(retainedSnapshotSections ?? [])].sort(),
    ["activityfiles", "files", "readinesswidgets"],
  );
});

test("prepareDeviceProviderSnapshotImport only reports retained Garmin snapshot sections when an artifact was created", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      readinessWidgets: [],
    },
  });

  assert.ok(!payload.rawArtifacts?.some((artifact) => artifact.role === "snapshot-section:readinesswidgets"));
  assert.deepEqual(
    (payload.provenance?.importedSections as { retainedSnapshotSections?: string[] } | undefined)?.retainedSnapshotSections ?? [],
    [],
  );
});

test("prepareDeviceProviderSnapshotImport does not use Garmin activityName as the canonical activityType fallback", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "garmin",
    snapshot: {
      importedAt: "2026-03-16T12:00:00.000Z",
      activities: [
        {
          activityId: "activity-1",
          activityName: "Morning Victory Lap",
          startTime: "2026-03-15T10:00:00.000Z",
          endTime: "2026-03-15T10:30:00.000Z",
        },
      ],
    },
  });

  const activityEvent = payload.events?.find((event) => event.kind === "activity_session");

  assert.equal(activityEvent?.fields?.activityType, "activity");
  assert.equal(activityEvent?.title, "Garmin Morning Victory Lap");
});

test("prepareDeviceProviderSnapshotImport rejects Garmin snapshots with invalid collection shapes before normalization", async () => {
  await assert.rejects(
    () => prepareDeviceProviderSnapshotImport({
      provider: "garmin",
      snapshot: {
        dailySummaries: {
          summaryDate: "2026-03-15",
        },
      },
    }),
  );

  const handledCollections = [
    "dailySummaries",
    "dailySummary",
    "epochSummaries",
    "epochs",
    "sleeps",
    "activities",
    "womenHealth",
    "womenHealthSummaries",
    "deletions",
  ];

  for (const key of handledCollections) {
    await assert.rejects(
      () => prepareDeviceProviderSnapshotImport({
        provider: "garmin",
        snapshot: {
          [key]: [42],
        },
      }),
    );
  }

  await assert.doesNotReject(
    () => prepareDeviceProviderSnapshotImport({
      provider: "garmin",
      snapshot: {
        activityFiles: [42],
        files: [42],
      },
    }),
  );
});

test("importDeviceProviderSnapshot round-trips Garmin date buckets through real core without vault-day shift", async () => {
  const vaultRoot = await makeTempDirectory("murph-garmin-roundtrip");
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
    timezone: "America/Los_Angeles",
  });

  const result = await importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      provider: "garmin",
      vaultRoot,
      snapshot: {
        importedAt: "2026-03-16T12:00:00.000Z",
        dailySummaries: [
          {
            summaryDate: "2026-03-15",
            steps: 5432,
          },
        ],
        sleeps: [
          {
            sleepId: "sleep-1",
            startTime: "2026-03-15T00:00:00.000Z",
            endTime: "2026-03-15T00:01:35.000Z",
            durationSeconds: 95,
            stages: [
              {
                stage: "mystery-phase",
                startTime: "2026-03-15T00:00:00.000Z",
                endTime: "2026-03-15T00:00:30.000Z",
              },
              {
                stage: "light",
                startTime: "2026-03-15T00:00:30.000Z",
                endTime: "2026-03-15T00:01:35.000Z",
                durationSeconds: 65,
              },
            ],
          },
        ],
      },
    },
    {
      corePort: coreRuntime,
    },
  );

  const dailySteps = result.events.find(
    (event) => event.kind === "observation" && event.metric === "daily-steps",
  );
  const sleepEvent = result.events.find((event) => event.kind === "sleep_session");
  const sleepStage = result.samples.find((sample) => sample.stream === "sleep_stage");

  assert.equal(dailySteps?.dayKey, "2026-03-15");
  assert.equal(dailySteps?.timeZone, "America/Los_Angeles");
  assert.equal(sleepEvent?.durationMinutes, 2);
  assert.equal(sleepStage?.durationMinutes, 1);
  assert.equal(result.samples.filter((sample) => sample.stream === "sleep_stage").length, 1);
});


test("importDeviceProviderSnapshot uses the default Garmin adapter registry", async () => {
  const calls: DeviceBatchImportPayload[] = [];

  const result = await importDeviceProviderSnapshot<{ ok: boolean; provider: string }>(
    {
      provider: "garmin",
      snapshot: {
        accountId: "garmin-user-2",
        dailySummaries: [
          {
            calendarDate: "2026-03-16",
            steps: 9876,
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

  assert.deepEqual(result, { ok: true, provider: "garmin" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "garmin");
  assert.ok(calls[0]?.events?.some((event) => event.fields?.metric === "daily-steps"));
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
  assert.ok(calls[0]?.rawArtifacts?.some((artifact) => artifact.role === "recovery:sleep-2"));
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
  assert.deepEqual(calls[0], {
    provider: "polar",
    accountId: "polar-user-2",
    source: "device",
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
  assert.equal("snapshot" in (calls[0] as Record<string, unknown>), false);
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
        rawArtifacts: [
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
  const deletionArtifact = payload.rawArtifacts?.find((artifact) => artifact.role === "deletion:sleep:sleep-9");

  assert.equal(deletionEvent?.kind, "observation");
  assert.equal(deletionEvent?.fields?.metric, "external-resource-deleted");
  assert.equal(deletionEvent?.fields?.deleted, true);
  assert.equal(deletionArtifact?.fileName, "deletion-sleep-sleep-9.json");
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
      bodyMeasurements: {
        height_meter: "1.82",
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
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "body-measurement"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "cycle:12"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "workout:9"));
  assert.ok(payload.samples?.some((sample) => sample.stream === "respiratory_rate" && sample.sample.value === 14.6));
  assert.ok(payload.samples?.some((sample) => sample.stream === "temperature" && sample.sample.value === 36.7));
  assert.ok(
    payload.events?.some(
      (event) => event.kind === "observation" && event.fields?.metric === "day-strain" && event.fields?.value === 13.7,
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.kind === "observation" &&
        event.fields?.metric === "altitude-change" &&
        event.fields?.value === 33,
    ),
  );
  assert.equal(payload.events?.some((event) => event.kind === "sleep_session"), false);
  assert.equal(payload.events?.some((event) => event.kind === "activity_session"), false);
  assert.equal(payload.provenance?.whoopUserId, undefined);
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

  assert.equal(ouraPayload.rawArtifacts?.some((artifact) => artifact.role === "personal-info"), false);
  assert.equal(ouraPayload.rawArtifacts?.some((artifact) => artifact.role === "heartrate"), false);
  assert.equal(whoopPayload.rawArtifacts?.some((artifact) => artifact.role === "profile"), false);
  assert.equal(whoopPayload.rawArtifacts?.some((artifact) => artifact.role === "body-measurement"), false);
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
          distance_meter: 4800,
          score: {
            strain: 9.4,
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
  assert.equal(
    payload.events?.some((event) => event.kind === "observation" && event.fields?.metric === "sleep-awake-minutes"),
    false,
  );
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("sleep:sleep-")));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role === "recovery:cycle-77"));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("cycle:cycle-")));
  assert.ok(payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("workout:workout-")));
});
