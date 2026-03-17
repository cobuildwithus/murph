import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createDeviceProviderRegistry,
  createImporters,
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceBatchImportPayload,
  type DeviceProviderAdapter,
} from "../src/index.js";

test("prepareDeviceProviderSnapshotImport normalizes WHOOP snapshots into canonical device payloads", async () => {
  const payload = await prepareDeviceProviderSnapshotImport({
    provider: "whoop",
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

  assert.equal(payload.vaultRoot, "fixture-vault");
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

test("createImporters composes custom device providers behind the same core seam", async () => {
  const registry = createDeviceProviderRegistry();
  const calls: DeviceBatchImportPayload[] = [];

  const garminAdapter: DeviceProviderAdapter<{ accountId?: string; steps?: number }> = {
    provider: "garmin",
    normalizeSnapshot(snapshot) {
      return {
        provider: "garmin",
        accountId: snapshot.accountId ?? "garmin-user-1",
        source: "device",
        events: [
          {
            kind: "observation",
            occurredAt: "2026-03-16T12:00:00.000Z",
            recordedAt: "2026-03-16T12:00:00.000Z",
            title: "Garmin daily steps",
            externalRef: {
              system: "garmin",
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
  };

  registry.register(garminAdapter);

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
    provider: "garmin",
    snapshot: {
      accountId: "garmin-user-9",
      steps: 12345,
    },
  }) as { ok: boolean; provider: string };

  assert.deepEqual(result, { ok: true, provider: "garmin" });
  assert.equal(importers.deviceProviderRegistry.get("garmin")?.provider, "garmin");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, "garmin");
  assert.equal(calls[0]?.accountId, "garmin-user-9");
  assert.equal(calls[0]?.events?.[0]?.kind, "observation");
  assert.equal(calls[0]?.events?.[0]?.fields?.value, 12345);
});

test("device provider registry normalizes provider keys and rejects invalid registrations", () => {
  const registry = createDeviceProviderRegistry();
  const garminAdapter: DeviceProviderAdapter<{ steps?: number }> = {
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
  };

  registry.register(garminAdapter);

  assert.equal(registry.get("GARMIN")?.provider, "Garmin");
  assert.equal(registry.get("   "), undefined);
  assert.deepEqual(registry.list().map((adapter) => adapter.provider), ["Garmin"]);
  assert.throws(
    () =>
      registry.register({
        provider: "garmin",
        normalizeSnapshot() {
          return { provider: "garmin", events: [] };
        },
      }),
    /already registered/u,
  );
  assert.throws(
    () =>
      registry.register({
        provider: "   ",
        normalizeSnapshot() {
          return { provider: "empty", events: [] };
        },
      }),
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
