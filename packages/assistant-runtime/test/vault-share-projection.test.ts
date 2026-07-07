import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getHostedVaultShareActivityHeartRateZoneProjectionSpec,
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  parseHostedVaultShareDeliverRequest,
} from "@murphai/hosted-execution/vault-share";
import {
  selectMetricSeries,
  type MetricPoint,
  type MetricSeriesPoint,
} from "@murphai/query";
import { describe, expect, it, vi } from "vitest";

import {
  applyHostedVaultShareRevokeWake,
  importHostedVaultShareDeliveryWake,
} from "../src/hosted-runtime/vault-share-import.ts";
import {
  HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS,
  offerHostedVaultShareProjectionBestEffort,
  readProjectableActivityHeartRateZoneDays,
  readProjectableActivityMinutesDays,
  readProjectableDailyMetricDays,
  readProjectableProfileName,
  selectProjectableDailyMetricDays,
  selectProjectableActivityHeartRateZoneDays,
  selectProjectableActivityMinutesDays,
  selectProjectableHeartRateZoneDays,
  selectProjectableSleepNights,
  selectProjectableWorkoutDays,
  type ActivitySessionProjectionRow,
} from "../src/hosted-runtime/vault-share-projection.ts";
import {
  CURRENT_VAULT_FORMAT_VERSION,
  createEmptyProfileDocument,
  renderProfileDocument,
  setProfileDisplayName,
} from "@murphai/contracts";

const NIGHT = {
  date: "2026-06-09",
  sleepEndAt: "2026-06-10T06:31:00.000Z",
  sleepStartAt: "2026-06-09T22:04:00.000Z",
};

const RECORD = {
  data: NIGHT,
  occurredAt: `${NIGHT.date}T00:00:00.000Z`,
  recordKey: NIGHT.date,
};

const ACTIVITY_DAY = {
  date: "2026-07-03",
  metricKey: "activity-minutes",
  unit: "minutes",
  value: 73,
};

const ACTIVITY_RECORD = {
  data: ACTIVITY_DAY,
  occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
  recordKey: ACTIVITY_DAY.date,
};

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

type WorkoutMetricRow = Pick<
  MetricSeriesPoint,
  | "date"
  | "grain"
  | "metricKey"
  | "observedAt"
  | "pointIds"
  | "recordIds"
  | "sourceFamily"
  | "sourceKind"
  | "statistic"
  | "value"
>;

function workoutMetricRow(input: {
  date: string;
  metricKey: "activity-minutes" | "workout-count";
  recordIds?: string[];
  value: number;
}): WorkoutMetricRow {
  const recordIds = input.recordIds ?? [`evt_activity_${input.date}`];
  return {
    date: input.date,
    grain: "day",
    metricKey: input.metricKey,
    observedAt: `${input.date}T00:00:00.000Z`,
    pointIds: [`point_${input.metricKey}_${input.value}_${recordIds.join("_")}`],
    recordIds,
    sourceFamily: "derived",
    sourceKind: "activity-summary",
    statistic: "value",
    value: input.value,
  };
}

function workoutRows(input: {
  countRecordIds?: string[];
  date: string;
  minuteRecordIds?: string[];
  workoutCount: number;
  workoutMinutes: number;
}): {
  countRows: WorkoutMetricRow[];
  minuteRows: WorkoutMetricRow[];
  nowMs: number;
} {
  const recordIds = [`evt_activity_${input.date}`];
  return {
    countRows: [workoutMetricRow({
      date: input.date,
      metricKey: "workout-count",
      recordIds: input.countRecordIds ?? recordIds,
      value: input.workoutCount,
    })],
    minuteRows: [workoutMetricRow({
      date: input.date,
      metricKey: "activity-minutes",
      recordIds: input.minuteRecordIds ?? recordIds,
      value: input.workoutMinutes,
    })],
    nowMs: Date.parse("2026-07-04T00:00:00.000Z"),
  };
}

function activitySessionRow(input: {
  activityKind: string | null;
  date: string;
  durationMinutes: number;
  endedAt?: string | null;
  heartRateZones?: ActivitySessionProjectionRow["heartRateZones"];
  recordIds?: string[];
  startedAt?: string | null;
}): ActivitySessionProjectionRow {
  const recordIds = input.recordIds ?? [`evt_${input.activityKind ?? "unknown"}_${input.date}`];
  return {
    activityKind: input.activityKind,
    date: input.date,
    durationMinutes: input.durationMinutes,
    endedAt: input.endedAt ?? null,
    heartRateZones: input.heartRateZones ?? [],
    observedAt: `${input.date}T12:00:00.000Z`,
    pointIds: [`point_${recordIds.join("_")}`],
    recordIds,
    sourceFamily: "event",
    sourceKind: "activity_session",
    startedAt: input.startedAt ?? `${input.date}T12:00:00.000Z`,
  };
}

async function createActivitySessionVault(
  records: readonly Record<string, unknown>[],
): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-activity-session-"));
  await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
  await writeFile(
    join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4C",
      createdAt: "2026-07-03T00:00:00.000Z",
      title: "Vault share activity session test",
      timezone: "UTC",
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return vaultRoot;
}

async function createProfileVault(displayName: string | null): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-profile-"));
  if (!displayName) {
    return vaultRoot;
  }

  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "profile.md"),
    renderProfileDocument(
      setProfileDisplayName(createEmptyProfileDocument(new Date("2026-07-01T00:00:00.000Z")), {
        displayName,
        now: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ),
    "utf8",
  );

  return vaultRoot;
}

describe("offerHostedVaultShareProjectionBestEffort", () => {
  it("is a no-op without a vault-share port", async () => {
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: null,
    });

    expect(result.outcome).toBe("no-port");
  });

  it("offers projectable records and reports delivery", async () => {
    const vaultRoot = await createProfileVault("Theo");
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => ["profile-name.v0"],
      },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      projectionKind: "profile-name.v0",
      records: [{
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }],
    });
  });

  it("does not read or deliver payloads when the control plane reports no active kinds", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => [],
      },
    });

    expect(result.outcome).toBe("no-active-share");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips email delivery authorization grants because they carry no records", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => ["group-email.v0"],
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends nothing when the vault has no projectable share data", async () => {
    const vaultRoot = await createProfileVault(null);
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => ["profile-name.v0"],
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("never throws when the port fails", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/unused",
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => {
          throw new Error("network down");
        },
      },
    });

    expect(result.outcome).toBe("error");
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("selectProjectableDailyMetricDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const activitySpec = requireDailyMetricSpec("activity-days.v0");
  const stepsSpec = requireDailyMetricSpec("steps-days.v0");

  it("maps recent selected daily metric rows to generic scalar records", () => {
    const selected = selectProjectableDailyMetricDays([
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 12_345,
      },
      {
        date: ACTIVITY_DAY.date,
        grain: "event",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 999,
      },
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 1_000_001,
      },
    ], stepsSpec, nowMs);

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          metricKey: "steps",
          unit: "count",
          value: 12_345,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "steps-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("shares selected day-grain activity-minutes rows through the scalar activity spec", () => {
    const dailyActivitySummary = activityMetricPoint({
      date: ACTIVITY_DAY.date,
      grain: "day",
      id: "metric-point:activity-minutes:activity-summary",
      observedAt: "2026-07-03T08:00:00.000Z",
      sourceKind: "activity-summary",
      value: 73,
    });
    const eventMeasurement = activityMetricPoint({
      date: ACTIVITY_DAY.date,
      grain: "event",
      id: "metric-point:activity-minutes:event-measurement",
      observedAt: "2026-07-03T18:00:00.000Z",
      sourceKind: "measurement",
      value: 45,
    });
    const series = selectMetricSeries({
      duplicatePolicy: "selection-policy",
      grain: "day",
      metricKey: "activity-minutes",
      points: [dailyActivitySummary, eventMeasurement],
      statistic: "value",
    });

    expect(series.rows.map((row) => row.pointIds)).toEqual([[dailyActivitySummary.id]]);
    expect(selectProjectableDailyMetricDays([{
      date: ACTIVITY_DAY.date,
      grain: "event",
      metricKey: "activity-minutes",
      statistic: "value",
      unit: "minutes",
      value: 45,
    }], activitySpec, nowMs)).toEqual([]);
    const selected = selectProjectableDailyMetricDays(series.rows, activitySpec, nowMs);
    expect(selected).toEqual([{
      ...ACTIVITY_RECORD,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("reads allowlisted activity-session workout metrics as scalar share records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-workout-metrics-"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const expectedRecords = [
      ["active-calories-days.v0", "active-calories", "kcal", 360],
      ["distance-days.v0", "distance-km", "km", 5],
      ["elevation-gain-days.v0", "elevation-gain-meters", "meter", 42],
      ["max-heart-rate-days.v0", "max-heart-rate", "bpm", 165],
      ["workout-strain-days.v0", "workout-strain", "strain", 13.2],
    ] as const;

    try {
      await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
      await writeFile(
        join(vaultRoot, "vault.json"),
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
          createdAt: "2026-07-03T00:00:00.000Z",
          title: "Vault share workout metrics test",
          timezone: "UTC",
        })}\n`,
        "utf8",
      );
      await writeFile(
        join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
        `${JSON.stringify({
          schemaVersion: "murph.event.v1",
          id: "evt_vault_share_workout_metrics_01",
          kind: "activity_session",
          occurredAt: "2026-07-03T12:00:00Z",
          dayKey: "2026-07-03",
          recordedAt: "2026-07-03T12:45:00Z",
          title: "Shared challenge workout",
          durationMinutes: 35,
          distanceKm: 5,
          source: "device",
          externalRef: {
            system: "strava",
            resourceType: "activity_session",
            resourceId: "strava_activity_01",
          },
          workout: {
            metrics: {
              activeCalories: 360,
              averagePowerWatts: 215,
              maxHeartRate: 165,
              totalElevationGainMeters: 42,
              workoutStrain: 13.2,
            },
          },
        })}\n`,
        "utf8",
      );

      for (const [projectionKind, metricKey, unit, value] of expectedRecords) {
        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(projectionKind),
        );

        expect(selected).toEqual([{
          data: {
            date: ACTIVITY_DAY.date,
            metricKey,
            unit,
            value,
          },
          occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
          recordKey: ACTIVITY_DAY.date,
          sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
        }]);
        expect(JSON.stringify(selected)).not.toContain("strava");
        expect(JSON.stringify(selected)).not.toContain("averagePowerWatts");
      }
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableWorkoutDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");

  it("maps selected workout session summaries without raw workout details", () => {
    const selected = selectProjectableWorkoutDays({
      ...workoutRows({
        date: ACTIVITY_DAY.date,
        workoutCount: 2,
        workoutMinutes: 85,
      }),
      nowMs,
    });

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          workoutCount: 2,
          workoutMinutes: 85,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "workout-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops split-provider workout tuples instead of joining count and minutes by date", () => {
    const selected = selectProjectableWorkoutDays({
      ...workoutRows({
        countRecordIds: ["evt_garmin_count"],
        date: ACTIVITY_DAY.date,
        minuteRecordIds: ["evt_oura_minutes"],
        workoutCount: 1,
        workoutMinutes: 85,
      }),
      nowMs,
    });

    expect(selected).toEqual([]);
  });
});

describe("selectProjectableActivityMinutesDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningSpec = requireActivityMinutesSpec("running-minutes-days.v0");

  it("maps structured activity sessions to activity-specific daily minute records", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_1"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 35,
          recordIds: ["evt_run_2"],
          startedAt: "2026-07-03T17:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "walking",
          date: ACTIVITY_DAY.date,
          durationMinutes: 60,
          recordIds: ["evt_walk_1"],
        }),
      ],
      spec: runningSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
          sessionMinutes: 75,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "running-minutes-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops exact duplicate activity sessions before scoring a day", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      sessionCount: 1,
      sessionMinutes: 40,
    });
  });

  it("deduplicates matching activity aliases before scoring a day", () => {
    const selected = selectProjectableActivityMinutesDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      sessionCount: 1,
      sessionMinutes: 40,
    });
  });

  it("reads nested workout sport before generic activity labels from canonical vaults", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_nested_run_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:42:00.000Z",
      activityType: "workout",
      durationMinutes: 42,
      workout: {
        sportName: "Run",
        heartRateZones: [{ durationMinutes: 12, label: "Zone 5", zone: 5 }],
      },
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        runningSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionMinutes: 42,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
      await expect(readProjectableActivityHeartRateZoneDays(
        vaultRoot,
        requireActivityHeartRateZoneSpec("running-heart-rate-zones-days.v0"),
      )).resolves.toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          zones: [{ durationMinutes: 12, label: "Zone 5", zone: 5 }],
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableHeartRateZoneDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");

  it("maps selected workout heart-rate zone summaries to bounded daily buckets", () => {
    const selected = selectProjectableHeartRateZoneDays([
      {
        context: {
          maxHeartRate: 140,
          minHeartRate: 120,
          zoneLabel: "Zone 2",
        },
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "heart-rate-zone-2-minutes",
        observedAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        pointIds: ["point_zone_2"],
        recordIds: ["evt_activity_2026-07-03"],
        sourceFamily: "derived",
        sourceKind: "activity-summary",
        statistic: "value",
        value: 24,
      },
    ], nowMs);

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          zones: [
            {
              durationMinutes: 24,
              label: "Zone 2",
              zone: 2,
            },
          ],
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "heart-rate-zones-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });
});

describe("selectProjectableActivityHeartRateZoneDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningZoneSpec = requireActivityHeartRateZoneSpec("running-heart-rate-zones-days.v0");

  it("maps only matching activity sessions to activity-specific zone records", () => {
    const selected = selectProjectableActivityHeartRateZoneDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          heartRateZones: [
            { durationMinutes: 8, label: "Zone 5", zone: 5 },
            { durationMinutes: 14, label: "Zone 4", zone: 4 },
          ],
          recordIds: ["evt_run_zones"],
        }),
        activitySessionRow({
          activityKind: "cycling",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          heartRateZones: [{ durationMinutes: 20, label: "Zone 5", zone: 5 }],
          recordIds: ["evt_bike_zones"],
        }),
      ],
      spec: runningZoneSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          zones: [
            {
              durationMinutes: 14,
              label: "Zone 4",
              zone: 4,
            },
            {
              durationMinutes: 8,
              label: "Zone 5",
              zone: 5,
            },
          ],
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "running-heart-rate-zones-days.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("deduplicates matching activity aliases before scoring zone buckets", () => {
    const selected = selectProjectableActivityHeartRateZoneDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          heartRateZones: [{ durationMinutes: 8, label: "Zone 5", zone: 5 }],
          recordIds: ["evt_garmin_run_zones"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          heartRateZones: [{ durationMinutes: 8, label: "Zone 5", zone: 5 }],
          recordIds: ["evt_strava_run_zones"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningZoneSpec,
    });

    expect(selected[0]?.data).toEqual({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      zones: [{ durationMinutes: 8, label: "Zone 5", zone: 5 }],
    });
  });
});

function activityMetricPoint(input: {
  date: string;
  grain: MetricPoint["grain"];
  id: string;
  observedAt: string;
  sourceKind: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: "minutes",
    canonicalValue: input.value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: input.date,
    grain: input.grain,
    id: input.id,
    metricKey: "activity-minutes",
    observedAt: input.observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: input.sourceKind,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: input.sourceKind,
      path: "",
      recordId: input.id,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: "minutes",
    value: input.value,
  };
}

function requireDailyMetricSpec(kind: Parameters<typeof getHostedVaultShareDailyMetricProjectionSpec>[0]) {
  const spec = getHostedVaultShareDailyMetricProjectionSpec(kind);
  if (!spec) {
    throw new Error(`Missing daily metric projection spec for ${kind}.`);
  }
  return spec;
}

function requireActivityMinutesSpec(
  kind: Parameters<typeof getHostedVaultShareActivityMinutesProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivityMinutesProjectionSpec(kind);
  if (!spec) {
    throw new Error(`Missing activity minutes projection spec for ${kind}.`);
  }
  return spec;
}

function requireActivityHeartRateZoneSpec(
  kind: Parameters<typeof getHostedVaultShareActivityHeartRateZoneProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivityHeartRateZoneProjectionSpec(kind);
  if (!spec) {
    throw new Error(`Missing activity heart-rate zone projection spec for ${kind}.`);
  }
  return spec;
}

describe("selectProjectableSleepNights", () => {
  const nowMs = Date.parse("2026-06-10T00:00:00.000Z");

  it("maps recent fully-timed nights to records keyed by night date and drops stale or partial ones", () => {
    const staleDate = "2026-05-01";
    const summaries = [
      { date: NIGHT.date, sleepEndAt: NIGHT.sleepEndAt, sleepStartAt: NIGHT.sleepStartAt },
      { date: "2026-06-08", sleepEndAt: null, sleepStartAt: "2026-06-08T22:00:00.000Z" },
      {
        date: staleDate,
        sleepEndAt: "2026-05-02T06:00:00.000Z",
        sleepStartAt: "2026-05-01T22:00:00.000Z",
      },
    ];

    const selected = selectProjectableSleepNights(summaries, nowMs);

    // recordKey is the night date and occurredAt is the night date at UTC midnight, so the
    // dedupe key, vault path, and plaintext mailbox metadata all reduce to the night itself
    // — the exact sleep timestamps travel only inside the encrypted payload.
    expect(selected).toEqual([RECORD]);
    expect(selected[0]?.recordKey).toBe(NIGHT.date);
    expect(selected[0]?.occurredAt).toBe(`${NIGHT.date}T00:00:00.000Z`);
  });

  it("emits records the hosted-execution deliver-request parser accepts unchanged", () => {
    // Cross-package drift guard: the deliver parser pins occurredAt to the night-date
    // midnight and bounds the sleep window, so a projector that drifts from that contract
    // would make web reject every offer. Pipe real projector output through the real parser.
    const selected = selectProjectableSleepNights([NIGHT], nowMs);

    expect(selected).toHaveLength(1);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("drops nights older than the recency cutoff exactly", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const justInsideMs = nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS * dayMs;
    const justInsideDate = new Date(justInsideMs).toISOString().slice(0, 10);
    const justOutsideDate = new Date(justInsideMs - dayMs).toISOString().slice(0, 10);
    const summaries = [justInsideDate, justOutsideDate].map((date) => ({
      date,
      sleepEndAt: `${date}T06:00:00.000Z`,
      sleepStartAt: `${date}T22:00:00.000Z`,
    }));

    const selected = selectProjectableSleepNights(summaries, nowMs);

    expect(selected.map((record) => record.recordKey)).toEqual([justInsideDate]);
  });
});

describe("importHostedVaultShareDeliveryWake", () => {
  const wake = {
    delivery: {
      grantorMemberId: "member_grantor",
      projectionKind: "sleep-times.v0" as const,
      record: RECORD,
      schema: "murph.vault-share.delivery.v1" as const,
      shareId: "share_1",
    },
    eventId: "vault-share:share_1:2026-06-09",
    kind: "vault-share.delivery" as const,
    occurredAt: "2026-06-10T07:00:00.000Z",
    userId: "member_referee",
  };
  const storePath = (vaultRoot: string) =>
    join(vaultRoot, "derived", "vault-share", "projections.json");

  it("lands the shared record as durable vault content, idempotently", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    const first = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });
    const second = await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    expect(first).toEqual({ status: "imported" });
    expect(second).toEqual({ status: "imported" });

    const stored = JSON.parse(
      await readFile(
        storePath(vaultRoot),
        "utf8",
      ),
    );
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(RECORD);
    expect(grantor.records[0].shareId).toBe("share_1");
    expect(grantor.records[0].receivedEventId).toBe(wake.eventId);
    await expect(readFile(
      join(vaultRoot, "raw", "shared", "vault-share-projections.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips email delivery authorization imports because they carry no records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          projectionKind: "group-email.v0",
        },
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces a shared record when a corrected delivery revision arrives", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    const correctedRecord = {
      ...RECORD,
      data: {
        ...RECORD.data,
        sleepEndAt: "2026-06-10T06:59:00.000Z",
      },
    };

    await expect(importHostedVaultShareDeliveryWake({ vaultRoot, wake }))
      .resolves.toEqual({ status: "imported" });
    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          record: correctedRecord,
        },
        eventId: "vault-share:share_1:2026-06-09:revision_2",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(correctedRecord);
    expect(grantor.records[0].receivedEventId)
      .toBe("vault-share:share_1:2026-06-09:revision_2");
  });

  it("keeps one compact file with only the latest bounded records", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));

    for (let day = 1; day <= HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS + 1; day += 1) {
      const date = `2026-06-${String(day).padStart(2, "0")}`;
      const nextDate = `2026-06-${String(day + 1).padStart(2, "0")}`;
      const record = {
        data: {
          date,
          sleepEndAt: `${nextDate}T06:31:00.000Z`,
          sleepStartAt: `${date}T22:04:00.000Z`,
        },
        occurredAt: `${date}T00:00:00.000Z`,
        recordKey: date,
      };

      await expect(importHostedVaultShareDeliveryWake({
        vaultRoot,
        wake: {
          ...wake,
          delivery: { ...wake.delivery, record },
          eventId: `vault-share:share_1:${date}`,
          occurredAt: record.occurredAt,
        },
      })).resolves.toEqual({ status: "imported" });
    }

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const records = stored.projections["sleep-times.v0"].grantors.member_grantor.records;
    expect(records).toHaveLength(HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS);
    expect(records.map((entry: { record: { recordKey: string } }) => entry.record.recordKey))
      .not.toContain("2026-06-01");
    await expect(readFile(
      join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor", "2026-06-09.json"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies revoke wakes by removing the grantor projection entry", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves legacy raw shared records when a share is revoked", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    const legacyDirectory = join(vaultRoot, "raw", "shared", "sleep-times.v0", "member_grantor");
    const revokedLegacyPath = join(legacyDirectory, "2026-06-09.json");
    const activeLegacyPath = join(legacyDirectory, "2026-06-10.json");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      revokedLegacyPath,
      JSON.stringify({
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        receivedEventId: "vault-share:share_1:2026-06-09",
        record: RECORD,
        schema: "murph.vault-share.delivery.v1",
        shareId: "share_1",
      }),
    );
    await writeFile(
      activeLegacyPath,
      JSON.stringify({
        grantorMemberId: "member_grantor",
        projectionKind: "sleep-times.v0",
        receivedEventId: "vault-share:share_2:2026-06-10",
        record: {
          ...RECORD,
          recordKey: "2026-06-10",
        },
        schema: "murph.vault-share.delivery.v1",
        shareId: "share_2",
      }),
    );

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(revokedLegacyPath, "utf8")).resolves.toContain("share_1");
    await expect(readFile(activeLegacyPath, "utf8")).resolves.toContain("share_2");
    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let a stale revoke remove a newer grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: { ...wake.delivery, shareId: "share_2" },
        eventId: "vault-share:share_2:2026-06-09",
      },
    });

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records).toHaveLength(1);
  });

  it("starts a fresh record list when a delivery arrives for a new grant epoch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await importHostedVaultShareDeliveryWake({ vaultRoot, wake });

    const nextRecord = {
      data: {
        date: "2026-06-10",
        sleepEndAt: "2026-06-11T06:31:00.000Z",
        sleepStartAt: "2026-06-10T22:04:00.000Z",
      },
      occurredAt: "2026-06-10T00:00:00.000Z",
      recordKey: "2026-06-10",
    };
    await expect(importHostedVaultShareDeliveryWake({
      vaultRoot,
      wake: {
        ...wake,
        delivery: {
          ...wake.delivery,
          record: nextRecord,
          shareId: "share_2",
        },
        eventId: "vault-share:share_2:2026-06-10",
        occurredAt: "2026-06-10T00:00:00.000Z",
      },
    })).resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.shareId).toBe("share_2");
    expect(grantor.records.map((entry: { record: { recordKey: string } }) =>
      entry.record.recordKey,
    )).toEqual(["2026-06-10"]);
  });

  it("repairs a corrupt derived projection file before importing a delivery", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
    await writeFile(storePath(vaultRoot), "{not-json");

    await expect(importHostedVaultShareDeliveryWake({ vaultRoot, wake }))
      .resolves.toEqual({ status: "imported" });

    const stored = JSON.parse(await readFile(storePath(vaultRoot), "utf8"));
    const grantor = stored.projections["sleep-times.v0"].grantors.member_grantor;
    expect(grantor.records).toHaveLength(1);
    expect(grantor.records[0].record).toEqual(RECORD);
  });

  it("repairs a corrupt derived projection file before consuming a revoke", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-import-"));
    await mkdir(join(vaultRoot, "derived", "vault-share"), { recursive: true });
    await writeFile(
      storePath(vaultRoot),
      JSON.stringify({ schema: "murph.shared-vault-projections.v0" }),
    );

    await expect(applyHostedVaultShareRevokeWake({
      vaultRoot,
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    })).resolves.toEqual({ status: "imported" });

    await expect(readFile(storePath(vaultRoot), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps delivery import read failures retryable so shared data is not consumed", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake,
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: true,
      status: "blocked",
    });
  });

  it("keeps revoke import read failures retryable so stale shared data is not consumed", async () => {
    const result = await applyHostedVaultShareRevokeWake({
      vaultRoot: "/dev/null/not-a-dir",
      wake: {
        eventId: "vault-share-revoke:share_1:2026-07-01T00:00:00.000Z",
        kind: "vault-share.revoke",
        occurredAt: "2026-07-01T00:00:00.000Z",
        revoke: {
          grantorMemberId: "member_grantor",
          projectionKind: "sleep-times.v0",
          revokedAt: "2026-07-01T00:00:00.000Z",
          schema: "murph.vault-share.revoke.v1",
          shareId: "share_1",
        },
        userId: "member_referee",
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.read_failed",
      retryable: true,
      status: "blocked",
    });
  });

  it("blocks unsafe path segments without touching the filesystem", async () => {
    const result = await importHostedVaultShareDeliveryWake({
      vaultRoot: "/unused",
      wake: {
        ...wake,
        delivery: { ...wake.delivery, grantorMemberId: "../escape" },
      },
    });

    expect(result).toEqual({
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    });
  });
});

describe("readProjectableProfileName", () => {
  it("delivers the typed profile display name and the parser accepts it unchanged", async () => {
    const vaultRoot = await createProfileVault("Theo");
    const records = await readProjectableProfileName(vaultRoot);
    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(() =>
      parseHostedVaultShareDeliverRequest({
        projectionKind: "profile-name.v0",
        records,
      })
    ).not.toThrow();

    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => ["profile-name.v0"],
      },
    });
    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      projectionKind: "profile-name.v0",
      records,
    });
  });

  it("projects nothing when the typed profile document is absent", async () => {
    const vaultRoot = await createProfileVault(null);
    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);

    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionKinds: async () => ["profile-name.v0"],
      },
    });
    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });
});
