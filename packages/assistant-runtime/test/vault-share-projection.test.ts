import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHostedVaultShareActivityDistanceProjectionScope,
  buildHostedVaultShareActivityMinutesProjectionScope,
  buildHostedVaultShareActivitySessionCountProjectionScope,
  buildHostedVaultShareProjectionScopeKey,
  getHostedVaultShareActivityDistanceProjectionSpec,
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareActivitySessionCountProjectionSpec,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
  HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH,
  HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY,
  HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  hostedVaultShareProjectionKindToScope,
  parseHostedVaultShareDeliverRequest as parseHostedVaultShareDeliverRequestContract,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareDeliverRequest,
  type HostedVaultShareProjectionMode,
  type HostedVaultShareWorkoutsDayData,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
} from "@murphai/hosted-execution/runtime-control";
import {
  selectMetricSeries,
  type MealNutritionDayTotal,
  type MetricPoint,
  type MetricSeriesPoint,
} from "@murphai/query";
import {
  executeScheduledLogOccurrence,
  initializeVault,
  upsertScheduledLog,
} from "@murphai/core";
import { describe, expect, it, vi } from "vitest";

import {
  captureHostedVaultShareProjectionBestEffort,
  HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS,
  offerCapturedHostedVaultShareProjectionBestEffort,
  readProjectableActivityDistanceDays,
  readProjectableActivityMinutesDays,
  readProjectableActivitySessionCountDays,
  readProjectableDailyMetricDays,
  readProjectableHeartRateZoneDays,
  readProjectableWorkoutDays,
  readProjectableWorkoutsDays,
  readProjectableMealNutritionDays,
  readProjectableProfileName,
  readProjectableSleepNights,
  selectProjectableDailyMetricDays,
  selectProjectableMealNutritionDays,
  selectProjectableActivityDistanceDays,
  selectProjectableActivityMinutesDays,
  selectProjectableActivitySessionCountDays,
  selectProjectableHeartRateZoneDays,
  selectProjectableSleepNights,
  selectProjectableWorkoutDays,
  selectProjectableWorkoutsDays,
  resolveHostedVaultShareProjectionScopesBestEffort,
  type ActivitySessionProjectionRow,
} from "../src/hosted-runtime/vault-share-projection.ts";
import {
  CURRENT_VAULT_FORMAT_VERSION,
  createEmptyMemoryDocument,
  formatTimeZoneDateTimeParts,
  formatMemoryDisplayNameRecordText,
  renderMemoryDocument,
  setMemoryDisplayName,
  upsertMemoryRecord,
} from "@murphai/contracts";

const TEST_SOURCE_WORKSPACE_VERSION = "7";
const GARMIN_SOURCE = { label: "Garmin", source: "garmin" } as const;
const MURPH_SOURCE = { label: "Murph", source: "murph" } as const;
const OURA_SOURCE = { label: "Oura", source: "oura" } as const;
const STRAVA_SOURCE = { label: "Strava", source: "strava" } as const;
const WHOOP_SOURCE = { label: "WHOOP", source: "whoop" } as const;

function parseHostedVaultShareDeliverRequest(value: Record<string, unknown>) {
  const {
    expectedGenerationToken: _generationToken,
    sourceWorkspaceVersion: _sourceWorkspaceVersion,
    ...parsed
  } = parseHostedVaultShareDeliverRequestContract({
    expectedGenerationToken: GENERATION_TOKEN,
    sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    ...value,
  });
  return parsed;
}

async function offerHostedVaultShareProjectionBestEffort(input: {
  projectionMode?: HostedVaultShareProjectionMode;
  shouldStop?: () => boolean;
  vaultRoot: string;
  vaultSharePort:
    | Parameters<
      typeof resolveHostedVaultShareProjectionScopesBestEffort
    >[0]["vaultSharePort"]
    | null;
}) {
  if (!input.vaultSharePort) {
    return { outcome: "no-port" as const };
  }
  const scopeResolution = await resolveHostedVaultShareProjectionScopesBestEffort({
    ...(input.projectionMode ? { projectionMode: input.projectionMode } : {}),
    vaultSharePort: input.vaultSharePort,
  });
  if (scopeResolution.outcome !== "active-scopes") {
    return scopeResolution;
  }
  const capture = await captureHostedVaultShareProjectionBestEffort({
    generationTokensByProjectionScopeKey:
      scopeResolution.generationTokensByProjectionScopeKey,
    hasDeferredProjectionWork: scopeResolution.hasDeferredProjectionWork,
    ...(scopeResolution.projectionMode
      ? { projectionMode: scopeResolution.projectionMode }
      : {}),
    projectionScopes: scopeResolution.projectionScopes,
    sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    vaultRoot: input.vaultRoot,
  });
  if (capture.outcome !== "captured") {
    return capture;
  }
  return await offerCapturedHostedVaultShareProjectionBestEffort({
    capture: capture.capture,
    ...(input.shouldStop ? { shouldStop: input.shouldStop } : {}),
    vaultSharePort: input.vaultSharePort,
  });
}

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

const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const GROUP_EMAIL_SCOPE = hostedVaultShareProjectionKindToScope("group-email.v0");
const PROFILE_SCOPE = hostedVaultShareProjectionKindToScope("profile-name.v0");
const TIME_ZONE_SCOPE = hostedVaultShareProjectionKindToScope("time-zone.v0");
const PROTEIN_SCOPE = hostedVaultShareProjectionKindToScope("protein-days.v0");
const DEVICE_SYNC_STATUS_SCOPE = hostedVaultShareProjectionKindToScope(
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
);
const RUNNING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "running",
});
const RUNNING_DISTANCE_SCOPE = buildHostedVaultShareActivityDistanceProjectionScope({
  activityKind: "running",
});
const RUNNING_SESSION_COUNT_SCOPE = buildHostedVaultShareActivitySessionCountProjectionScope({
  activityKind: "running",
});
const WALKING_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "walking",
});
const SAUNA_SCOPE = buildHostedVaultShareActivityMinutesProjectionScope({
  activityKind: "sauna",
});
const WORKOUTS_SCOPE = hostedVaultShareProjectionKindToScope(
  "workouts.v0",
);
const GENERATION_TOKEN = "a".repeat(43);

function activeProjectionResponse(
  ...projectionScopes: HostedVaultShareProjectionScope[]
) {
  return {
    generationTokensByProjectionScopeKey: Object.fromEntries(
      projectionScopes.map((scope) => [
        buildHostedVaultShareProjectionScopeKey(scope),
        GENERATION_TOKEN,
      ]),
    ),
    projectionKinds: [...new Set(
      projectionScopes.map((scope) => scope.projectionKind),
    )],
    projectionScopes,
  };
}

const ACTIVITY_DAY = {
  date: "2026-07-03",
  metricKey: "activity-minutes",
  metricSemantics: HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
  unit: "minutes",
  value: 73,
};

const ACTIVITY_RECORD = {
  data: ACTIVITY_DAY,
  occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
  recordKey: ACTIVITY_DAY.date,
};

const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

function utcDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

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
  metricKey: "workout-count" | "workout-minutes";
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
      metricKey: "workout-minutes",
      recordIds: input.minuteRecordIds ?? recordIds,
      value: input.workoutMinutes,
    })],
    nowMs: Date.parse("2026-07-04T00:00:00.000Z"),
  };
}

function activitySessionRow(input: {
  activityKind: string | null;
  date: string;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  endedAt?: string | null;
  isWorkout?: boolean;
  observedAt?: string;
  recordIds?: string[];
  sourceKind?: string;
  startedAt?: string | null;
  timeZone?: string | null;
}): ActivitySessionProjectionRow {
  const recordIds = input.recordIds ?? [`evt_${input.activityKind ?? "unknown"}_${input.date}`];
  return {
    activityKind: input.activityKind,
    date: input.date,
    ...(input.distanceMeters === undefined ? {} : { distanceMeters: input.distanceMeters }),
    ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
    endedAt: input.endedAt ?? null,
    isWorkout: input.isWorkout ?? true,
    observedAt: input.observedAt ?? `${input.date}T12:00:00.000Z`,
    pointIds: [`point_${recordIds.join("_")}`],
    recordIds,
    sourceFamily: "event",
    sourceKind: input.sourceKind ?? "activity_session",
    startedAt: input.startedAt ?? `${input.date}T12:00:00.000Z`,
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
  };
}

type WorkoutsRuling =
  | { status: "missing" }
  | { status: "pending" }
  | {
      qualifies: boolean;
      status: "settled";
      workoutCount: number;
    };

type WorkoutsRecord = HostedVaultShareDeliveryRecord & {
  data: HostedVaultShareWorkoutsDayData;
};

function isWorkoutsRecord(
  record: HostedVaultShareDeliveryRecord,
): record is WorkoutsRecord {
  return "workouts" in record.data;
}

function findWorkoutsRecord(
  records: readonly HostedVaultShareDeliveryRecord[],
  date: string,
): WorkoutsRecord | undefined {
  return records.find((record): record is WorkoutsRecord =>
    isWorkoutsRecord(record) && record.data.date === date
  );
}

function scoreSettledWorkoutsDate(
  records: HostedVaultShareDeliverRequest["records"],
  date: string,
  thresholdLocalMs: number,
): WorkoutsRuling {
  const record = findWorkoutsRecord(records, date);
  if (!record) {
    return { status: "missing" };
  }
  if (date > record.data.calendarClosedThroughDate) {
    return { status: "pending" };
  }
  return {
    qualifies: record.data.workouts.some((workout) =>
      workout.startLocalMs > thresholdLocalMs
    ),
    status: "settled",
    workoutCount: record.data.workouts.length,
  };
}

function mealNutritionDay(input: {
  date: string;
  mealCount?: number;
  proteinMealCount?: number;
  proteinTotal: number | null;
}): MealNutritionDayTotal {
  const mealCount = input.mealCount ?? 1;
  return {
    date: input.date,
    mealCount,
    totals: {
      calories: { mealCount: 0, total: null },
      carbsGrams: { mealCount: 0, total: null },
      fatGrams: { mealCount: 0, total: null },
      fiberGrams: { mealCount: 0, total: null },
      proteinGrams: {
        mealCount: input.proteinMealCount ?? mealCount,
        total: input.proteinTotal,
      },
    },
  };
}

async function createActivitySessionVault(
  records: readonly Record<string, unknown>[],
  timeZone = "UTC",
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
      timezone: timeZone,
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

function sparseNinthSourceActivityRecords(input?: {
  includeSparseNinthSource?: boolean;
}): Record<string, unknown>[] {
  const dates = [
    "2026-07-02",
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
  ];
  const providers = [
    "coros",
    "fitbit",
    "garmin",
    "oura",
    "polar",
    "strava",
    "suunto",
    "whoop",
  ];
  const record = (
    date: string,
    provider: string,
    sourceIndex: number,
    zone: number,
  ): Record<string, unknown> => ({
    schemaVersion: "murph.event.v1",
    id: `evt_sparse_${date}_${provider}`,
    kind: "activity_session",
    occurredAt: `${date}T${String(sourceIndex + 1).padStart(2, "0")}:30:00.000Z`,
    dayKey: date,
    recordedAt: `${date}T20:00:00.000Z`,
    source: "device",
    externalRef: {
      system: provider,
      resourceType: "activity_session",
      resourceId: `sparse-${date}-${provider}`,
    },
    activityType: "running",
    distanceKm: sourceIndex + 2,
    durationMinutes: sourceIndex + 21,
    workout: {
      heartRateZones: [{
        durationMinutes: 10,
        label: `Zone ${zone}`,
        zone,
      }],
    },
  });

  const records = dates.flatMap((date) =>
    providers.map((provider, sourceIndex) =>
      record(date, provider, sourceIndex, 1)
    )
  );
  return input?.includeSparseNinthSource === false
    ? records
    : [...records, record(dates[0]!, "withings", -1, 2)];
}

async function createMemoryDisplayNameVault(displayName: string | null): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-memory-name-"));
  if (!displayName) {
    return vaultRoot;
  }

  const document = setMemoryDisplayName(
    createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
    {
      displayName,
      now: new Date("2026-07-01T00:00:00.000Z"),
    },
  ).document;
  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "memory.md"),
    renderMemoryDocument({ document }),
    "utf8",
  );

  return vaultRoot;
}

async function createProfileAndTimeZoneVault(
  displayName: string,
  timeZone: string,
): Promise<string> {
  const vaultRoot = await createMemoryDisplayNameVault(displayName);
  await writeFile(
    join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-07-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: timeZone,
      title: "Projection capture test",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4F",
    })}\n`,
    "utf8",
  );
  return vaultRoot;
}

async function createLegacyMemoryDisplayNameVault(...texts: string[]): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-memory-name-"));
  let document = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
  for (const [index, text] of texts.entries()) {
    document = upsertMemoryRecord(document, {
      now: new Date(Date.parse("2026-07-01T00:00:00.000Z") + (index + 1) * 1000),
      section: "Identity",
      text,
    }).document;
  }

  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "memory.md"),
    renderMemoryDocument({ document }),
    "utf8",
  );

  return vaultRoot;
}

async function createLegacyProfileDisplayNameVault(displayName: string): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-share-legacy-profile-name-"));
  await mkdir(join(vaultRoot, "bank"), { recursive: true });
  await writeFile(
    join(vaultRoot, "bank", "profile.md"),
    [
      "---",
      "docType: profile",
      "schemaVersion: 1",
      `displayName: ${JSON.stringify(displayName)}`,
      "updatedAt: 2026-07-01T00:00:00.000Z",
      "---",
      "# Profile",
      "",
    ].join("\n"),
    "utf8",
  );
  return vaultRoot;
}

async function createSleepSourceProjectionVault(
  days: readonly {
    date: string;
    providers: readonly string[];
    stage?: "deep" | "rem";
  }[],
): Promise<string> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-sleep-source-window-"));
  await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
  await writeFile(
    join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4E",
      createdAt: "2026-07-01T00:00:00.000Z",
      title: "Synthetic sleep-source window",
      timezone: "UTC",
    })}\n`,
    "utf8",
  );
  const records = days.flatMap((day, dayIndex) =>
    day.providers.flatMap((provider, providerIndex) => {
      const stage = day.stage ?? "deep";
      const suffix = `${dayIndex}_${providerIndex}`;
      const recordedAt = `${day.date}T07:0${providerIndex}:00.000Z`;
      const externalRef = {
        system: "junction",
        resourceType: "sleep",
        resourceId: `sleep_source_window_${suffix}`,
      };
      const dataOrigin = {
        aggregatorProvider: "junction",
        originConfidence: "high",
        sourceProviderSlug: provider,
        version: 1,
      };
      return [
        {
          schemaVersion: "murph.event.v1",
          id: `evt_sleep_source_window_session_${suffix}`,
          kind: "sleep_session",
          occurredAt: `${day.date}T07:00:00.000Z`,
          recordedAt,
          dayKey: day.date,
          source: "device",
          title: "Overnight sleep",
          startAt: `${day.date}T00:00:00.000Z`,
          endAt: `${day.date}T07:00:00.000Z`,
          durationMinutes: 420,
          dataOrigin,
          externalRef,
        },
        {
          schemaVersion: "murph.event.v1",
          id: `evt_sleep_source_window_${stage}_${suffix}`,
          kind: "observation",
          occurredAt: `${day.date}T07:00:00.000Z`,
          recordedAt,
          dayKey: day.date,
          source: "device",
          title: stage === "deep" ? "Deep sleep" : "REM sleep",
          metric: stage === "deep"
            ? "sleep-deep-minutes"
            : "sleep-rem-minutes",
          value: 70 + dayIndex * 10 + providerIndex,
          unit: "minutes",
          dataOrigin,
          externalRef,
        },
      ];
    })
  );
  await writeFile(
    join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
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
    const vaultRoot = await createMemoryDisplayNameVault("Theo");
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => ({
          ...activeProjectionResponse(PROFILE_SCOPE),
          generationTokensByProjectionScopeKey: {
            [buildHostedVaultShareProjectionScopeKey(PROFILE_SCOPE)]: GENERATION_TOKEN,
          },
        }),
      },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records: [{
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });
  });

  it("captures every scope before delivery can mutate the shared vault root", async () => {
    const vaultRoot = await createProfileAndTimeZoneVault("Theo", "UTC");
    const deliveries: HostedVaultShareDeliverRequest[] = [];
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        async deliver(request) {
          deliveries.push(request);
          if (request.projectionKind === "profile-name.v0") {
            await writeFile(
              join(vaultRoot, "vault.json"),
              `${JSON.stringify({
                createdAt: "2026-07-01T00:00:00.000Z",
                formatVersion: CURRENT_VAULT_FORMAT_VERSION,
                timezone: "America/Chicago",
                title: "Successor projection capture test",
                vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4F",
              })}\n`,
              "utf8",
            );
          }
          return { status: "delivered" };
        },
        listActiveProjectionScopes: async () =>
          activeProjectionResponse(PROFILE_SCOPE, TIME_ZONE_SCOPE),
      },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toMatchObject({
      projectionKind: "time-zone.v0",
      records: [{ data: { timeZone: "UTC" } }],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });
  });

  it("continues after a definitive scope failure and aggregates the attempt as failed", async () => {
    const vaultRoot = await createProfileAndTimeZoneVault("Theo", "UTC");
    const deliver = vi.fn().mockImplementation(async (
      request: HostedVaultShareDeliverRequest,
    ) => request.projectionKind === "time-zone.v0"
      ? { status: "scope-failed" as const }
      : { status: "delivered" as const });

    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () =>
          activeProjectionResponse(PROFILE_SCOPE, TIME_ZONE_SCOPE, SLEEP_SCOPE),
      },
    });

    expect(result).toEqual({ outcome: "error" });
    expect(deliver).toHaveBeenCalledTimes(3);
    expect(deliver.mock.calls.map(([request]) => request.projectionKind)).toEqual([
      "profile-name.v0",
      "time-zone.v0",
      "sleep-times.v0",
    ]);
  });

  it("stops the captured delivery chain after an ambiguous failure", async () => {
    const vaultRoot = await createProfileAndTimeZoneVault("Theo", "UTC");
    const deliver = vi.fn().mockRejectedValue(new Error("synthetic delivery failure"));

    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () =>
          activeProjectionResponse(PROFILE_SCOPE, TIME_ZONE_SCOPE),
      },
    });

    expect(result).toEqual({ outcome: "error" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({
      projectionKind: "profile-name.v0",
    });
  });

  it("finishes only the active scope after foreground work preempts delivery", async () => {
    const vaultRoot = await createProfileAndTimeZoneVault("Theo", "UTC");
    let foregroundPreempted = false;
    const deliver = vi.fn().mockImplementation(async () => {
      foregroundPreempted = true;
      return { status: "delivered" as const };
    });

    const result = await offerHostedVaultShareProjectionBestEffort({
      shouldStop: () => foregroundPreempted,
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () =>
          activeProjectionResponse(PROFILE_SCOPE, TIME_ZONE_SCOPE, SLEEP_SCOPE),
      },
    });

    expect(result).toEqual({ outcome: "preempted" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({
      projectionKind: "profile-name.v0",
    });
  });

  it("starts no delivery when its owner ended before the first scope", async () => {
    const deliver = vi.fn();

    const result = await offerCapturedHostedVaultShareProjectionBestEffort({
      capture: {
        hasDeferredProjectionWork: false,
        snapshots: [{
          generationToken: GENERATION_TOKEN,
          projectionScope: PROFILE_SCOPE,
          records: [],
        }],
        sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
      },
      shouldStop: () => true,
      vaultSharePort: {
        deliver,
        async listActiveProjectionScopes() {
          throw new Error("Immutable delivery must not resolve scopes again.");
        },
      },
    });

    expect(result).toEqual({ outcome: "preempted" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers the maximum projectable registry sequentially", async () => {
    const projectableScopes = HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.filter(
      ({ projectionKind }) =>
        projectionKind !== HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND
        && projectionKind !== "group-email.v0",
    );
    const deliveredScopeKeys: string[] = [];
    let activeDeliveries = 0;
    let peakActiveDeliveries = 0;

    const result = await offerCapturedHostedVaultShareProjectionBestEffort({
      capture: {
        hasDeferredProjectionWork: false,
        snapshots: projectableScopes.map((projectionScope) => ({
          generationToken: GENERATION_TOKEN,
          projectionScope,
          records: [],
        })),
        sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
      },
      vaultSharePort: {
        async deliver(request) {
          activeDeliveries += 1;
          peakActiveDeliveries = Math.max(peakActiveDeliveries, activeDeliveries);
          await Promise.resolve();
          deliveredScopeKeys.push(
            buildHostedVaultShareProjectionScopeKey(request.projectionScope),
          );
          activeDeliveries -= 1;
          return { status: "delivered" };
        },
        async listActiveProjectionScopes() {
          throw new Error("Immutable delivery must not resolve scopes again.");
        },
      },
    });

    expect(projectableScopes).toHaveLength(98);
    expect(
      projectableScopes.length * HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
    ).toBe(2_450);
    expect(result).toEqual({ outcome: "delivered" });
    expect(deliveredScopeKeys).toEqual(
      projectableScopes.map(buildHostedVaultShareProjectionScopeKey),
    );
    expect(peakActiveDeliveries).toBe(1);
    expect(activeDeliveries).toBe(0);
  });

  it("does not read or deliver payloads when the control plane reports no active kinds", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(),
      },
    });

    expect(result.outcome).toBe("no-active-share");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("defers without reading when only temporarily inactive approved work remains", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/must-not-read",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => ({
          ...activeProjectionResponse(),
          hasDeferredProjectionWork: true,
          projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
        }),
      },
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    });

    expect(result.outcome).toBe("deferred");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("terminates acknowledged first-materialization after all grants are revoked", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/must-not-read",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => ({
          ...activeProjectionResponse(),
          hasDeferredProjectionWork: false,
          projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
        }),
      },
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    });

    expect(result.outcome).toBe("no-active-share");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("continues after a bounded first-materialization page with more work", async () => {
    const vaultRoot = await createMemoryDisplayNameVault("Theo");
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => ({
          ...activeProjectionResponse(PROFILE_SCOPE),
          hasDeferredProjectionWork: true,
          projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
        }),
      },
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    });

    expect(result.outcome).toBe("continued");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    }));
  });

  it("does not read or deliver when Web cannot acknowledge the requested projection mode", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/must-not-read",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(PROFILE_SCOPE),
      },
      projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
    });

    expect(result.outcome).toBe("error");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not read or deliver when old Web omits active-generation proof", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/must-not-read",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => ({
          projectionKinds: [PROFILE_SCOPE.projectionKind],
          projectionScopes: [PROFILE_SCOPE],
        }),
      },
    });

    expect(result.outcome).toBe("error");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips email delivery authorization grants because they carry no records", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(GROUP_EMAIL_SCOPE),
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("replaces the snapshot with empty when projectable share data disappears", async () => {
    const vaultRoot = await createMemoryDisplayNameVault(null);
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(PROFILE_SCOPE),
      },
    });

    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledWith({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records: [],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });
  });

  it("never throws when the port fails", async () => {
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/unused",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => {
          throw new Error("network down");
        },
      },
    });

    expect(result.outcome).toBe("error");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips device status because its projection snapshot is Web-owned", async () => {
    const deliver = vi.fn();
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot: "/nonexistent",
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(DEVICE_SYNC_STATUS_SCOPE),
      },
    });

    expect(result.outcome).toBe("no-projectable-records");
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("selectProjectableDailyMetricDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const activitySpec = requireDailyMetricSpec("activity-days.v0");
  const sleepDurationSpec = requireDailyMetricSpec("sleep-duration-days.v0");
  const stepsSpec = requireDailyMetricSpec("steps-days.v0");

  it("keeps total sleep duration distinct from the bedtime-to-wake window", () => {
    const date = "2026-07-03";
    const sleepWindows = selectProjectableSleepNights([{
      date,
      sleepEndAt: "2026-07-04T07:51:00.000Z",
      sleepStartAt: "2026-07-03T22:00:00.000Z",
    }], utcDateKey(nowMs));
    const sleepDurations = selectProjectableDailyMetricDays([{
      date,
      grain: "day",
      metricKey: "total-sleep-minutes",
      statistic: "value",
      unit: "minutes",
      value: 477,
    }], sleepDurationSpec, nowMs, utcDateKey(nowMs));

    expect(Date.parse("2026-07-04T07:51:00.000Z") - Date.parse("2026-07-03T22:00:00.000Z"))
      .toBe(591 * 60_000);
    expect(sleepDurations).toEqual([{
      data: {
        date,
        metricKey: "total-sleep-minutes",
        unit: "minutes",
        value: 477,
      },
      occurredAt: `${date}T00:00:00.000Z`,
      recordKey: date,
    }]);
    expect(sleepWindows[0]?.data).toEqual({
      date,
      sleepEndAt: "2026-07-04T07:51:00.000Z",
      sleepStartAt: "2026-07-03T22:00:00.000Z",
    });
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-duration-days.v0",
        records: sleepDurations,
      }).records,
    ).toEqual(sleepDurations);
  });

  it("limits eight sleep-duration dates to the seven dates disclosed by consent", () => {
    const boundaryNowMs = Date.parse("2026-07-08T12:00:00.000Z");
    const dates = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ];

    const selected = selectProjectableDailyMetricDays(
      dates.map((date) => ({
        date,
        grain: "day" as const,
        metricKey: "total-sleep-minutes",
        statistic: "value",
        unit: "minutes",
        value: 480,
      })),
      sleepDurationSpec,
      boundaryNowMs,
      utcDateKey(boundaryNowMs),
    );

    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-07-08",
      "2026-07-07",
      "2026-07-06",
      "2026-07-05",
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
    ]);
  });

  it("scores reported current member-local deep and REM sleep values immediately", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-sleep-stages-"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
      await writeFile(
        join(vaultRoot, "vault.json"),
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4D",
          createdAt: "2026-07-03T00:00:00.000Z",
          title: "Vault share sleep stages test",
          timezone: "UTC",
        })}\n`,
        "utf8",
      );
      await writeFile(
        join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
        `${[
          {
            schemaVersion: "murph.event.v1",
            id: "evt_sleep_stage_session_01",
            kind: "sleep_session",
            occurredAt: "2026-07-02T22:00:00.000Z",
            recordedAt: "2026-07-03T07:00:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "device",
            timeZone: "America/Los_Angeles",
            title: "Overnight sleep",
            startAt: "2026-07-02T22:00:00.000Z",
            endAt: "2026-07-03T07:00:00.000Z",
            durationMinutes: 540,
            externalRef: {
              system: "garmin",
              resourceType: "sleep",
              resourceId: "sleep_stage_projection_01",
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_sleep_stage_deep_01",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T07:01:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "device",
            title: "Deep sleep",
            metric: "sleep-deep-minutes",
            value: 0,
            unit: "minutes",
            externalRef: {
              system: "garmin",
              resourceType: "sleep",
              resourceId: "sleep_stage_projection_01",
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_sleep_stage_light_01",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T07:01:30.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "device",
            title: "Light sleep",
            metric: "sleep-light-minutes",
            value: 420,
            unit: "minutes",
            externalRef: {
              system: "garmin",
              resourceType: "sleep",
              resourceId: "sleep_stage_projection_01",
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_sleep_stage_rem_01",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T07:02:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "device",
            title: "REM sleep",
            metric: "sleep-rem-minutes",
            value: 85,
            unit: "minutes",
            externalRef: {
              system: "garmin",
              resourceType: "sleep",
              resourceId: "sleep_stage_projection_01",
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_sleep_stage_awake_01",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T07:02:30.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "device",
            title: "Awake time",
            metric: "sleep-awake-minutes",
            value: 35,
            unit: "minutes",
            externalRef: {
              system: "garmin",
              resourceType: "sleep",
              resourceId: "sleep_stage_projection_01",
            },
          },
        ].map((record) => JSON.stringify(record)).join("\n")}\n`,
        "utf8",
      );

      for (const [projectionKind, metricKey, value] of [
        ["deep-sleep-days.v0", "deep-sleep-minutes", 0],
        ["rem-sleep-days.v0", "rem-sleep-minutes", 85],
      ] as const) {
        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(projectionKind),
        );
        expect(selected).toEqual([{
          data: {
            date: ACTIVITY_DAY.date,
            metricKey,
            recordedAt: metricKey === "deep-sleep-minutes"
              ? "2026-07-03T07:01:00.000Z"
              : "2026-07-03T07:02:00.000Z",
            unit: "minutes",
            value,
          },
          occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
          recordKey: `${ACTIVITY_DAY.date}.garmin`,
          source: GARMIN_SOURCE,
          sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
        }]);
        expect(parseHostedVaultShareDeliverRequest({
          projectionKind,
          records: selected,
        }).records).toEqual(selected);
        expect(JSON.stringify(selected)).not.toMatch(/timeZone|America\/Los_Angeles/u);
      }

      for (const [projectionKind, metricKey, value] of [
        ["deep-sleep-sources-days.v1", "deep-sleep-minutes", 0],
        ["rem-sleep-sources-days.v1", "rem-sleep-minutes", 85],
      ] as const) {
        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(projectionKind),
        );
        expect(selected).toHaveLength(1);
        expect(selected[0]?.data).toMatchObject({
          date: ACTIVITY_DAY.date,
          metricKey,
          recordedAt: metricKey === "deep-sleep-minutes"
            ? "2026-07-03T07:01:00.000Z"
            : "2026-07-03T07:02:00.000Z",
          value,
        });
        expect(selected[0]?.data).not.toHaveProperty("provisional");
      }

      expect(JSON.stringify(await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec("deep-sleep-days.v0"),
      ))).not.toContain("provisional");
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("projects every available sleep source without choosing a canonical winner", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-sleep-sources-"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
      await writeFile(
        join(vaultRoot, "vault.json"),
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4E",
          createdAt: "2026-07-03T00:00:00.000Z",
          title: "Vault share sleep source projection test",
          timezone: "UTC",
        })}\n`,
        "utf8",
      );
      const providers = [
        { deepMinutes: 64, provider: "fitbit", recordedAt: "2026-07-03T06:58:00.000Z" },
        { deepMinutes: 88, provider: "garmin", recordedAt: "2026-07-03T07:01:00.000Z" },
        { deepMinutes: 112, provider: "oura", recordedAt: "2026-07-03T07:04:00.000Z" },
      ] as const;
      const records = providers.flatMap((provider, index) => [
        {
          schemaVersion: "murph.event.v1",
          id: `evt_sleep_source_session_${index}`,
          kind: "sleep_session",
          occurredAt: "2026-07-02T22:00:00.000Z",
          recordedAt: provider.recordedAt,
          dayKey: ACTIVITY_DAY.date,
          source: "device",
          title: "Overnight sleep",
          startAt: "2026-07-02T22:00:00.000Z",
          endAt: "2026-07-03T07:00:00.000Z",
          durationMinutes: 540,
          dataOrigin: {
            aggregatorProvider: "junction",
            originConfidence: "high",
            sourceProviderSlug: provider.provider,
            version: 1,
          },
          externalRef: {
            system: "junction",
            resourceType: "sleep",
            resourceId: `sleep_source_projection_${index}`,
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: `evt_sleep_source_deep_${index}`,
          kind: "observation",
          occurredAt: "2026-07-03T07:00:00.000Z",
          recordedAt: provider.recordedAt,
          dayKey: ACTIVITY_DAY.date,
          source: "device",
          title: "Deep sleep",
          metric: "sleep-deep-minutes",
          value: provider.deepMinutes,
          unit: "minutes",
          dataOrigin: {
            aggregatorProvider: "junction",
            originConfidence: "high",
            sourceProviderSlug: provider.provider,
            version: 1,
          },
          externalRef: {
            system: "junction",
            resourceType: "sleep",
            resourceId: `sleep_source_projection_${index}`,
          },
        },
      ]);
      await writeFile(
        join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
        `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
        "utf8",
      );

      const selected = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec("deep-sleep-sources-days.v1"),
      );

      expect(selected).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            date: ACTIVITY_DAY.date,
            metricKey: "deep-sleep-minutes",
            recordedAt: "2026-07-03T06:58:00.000Z",
            unit: "minutes",
            value: 64,
          }),
          recordKey: `${ACTIVITY_DAY.date}.fitbit`,
          source: { label: "fitbit", source: "fitbit" },
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            recordedAt: "2026-07-03T07:01:00.000Z",
            value: 88,
          }),
          recordKey: `${ACTIVITY_DAY.date}.garmin`,
          source: { label: "Garmin", source: "garmin" },
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            recordedAt: "2026-07-03T07:04:00.000Z",
            value: 112,
          }),
          recordKey: `${ACTIVITY_DAY.date}.oura`,
          source: { label: "Oura", source: "oura" },
        }),
      ]);
      expect(selected.every((record) =>
        !("sources" in record.data)
        && !("selected" in record.data)
      )).toBe(true);
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: "deep-sleep-sources-days.v1",
        records: selected,
      }).records).toEqual(selected);
      expect(JSON.stringify(selected)).not.toMatch(
        /sourceInstanceId|connectionId|accountId|timeZone|resourceId/u,
      );
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("reprojects a source-tagged sleep stage when its provider time changes", () => {
    const point = {
      date: ACTIVITY_DAY.date,
      grain: "day" as const,
      metricKey: "deep-sleep-minutes",
      observedAt: `${ACTIVITY_DAY.date}T07:00:00.000Z`,
      pointIds: ["point-deep-garmin"],
      recordedAt: `${ACTIVITY_DAY.date}T07:01:00.000Z`,
      recordIds: ["record-deep-garmin"],
      source: GARMIN_SOURCE,
      sourceFamily: "event" as const,
      sourceKind: "observation" as const,
      statistic: "value" as const,
      unit: "minutes",
      value: 88,
    };
    const spec = requireDailyMetricSpec("deep-sleep-sources-days.v1");
    const first = selectProjectableDailyMetricDays(
      [point],
      spec,
      nowMs,
      utcDateKey(nowMs),
    )[0];
    const changedRecordedAt = `${ACTIVITY_DAY.date}T07:02:00.000Z`;
    const changed = selectProjectableDailyMetricDays(
      [{ ...point, recordedAt: changedRecordedAt }],
      spec,
      nowMs,
      utcDateKey(nowMs),
    )[0];

    expect(first?.data).toMatchObject({ recordedAt: point.recordedAt });
    expect(changed?.data).toMatchObject({ recordedAt: changedRecordedAt });
    expect(first?.sourceRevision).toMatch(SOURCE_REVISION_PATTERN);
    expect(changed?.sourceRevision).toMatch(SOURCE_REVISION_PATTERN);
    expect(changed?.sourceRevision).not.toBe(first?.sourceRevision);
  });

  it.each([
    {
      legacyProjectionKind: "deep-sleep-days.v0" as const,
      metric: "sleep-deep-minutes",
      metricKey: "deep-sleep-minutes",
      sourceProjectionKind: "deep-sleep-sources-days.v1" as const,
      stage: "deep" as const,
      title: "Deep sleep",
    },
    {
      legacyProjectionKind: "rem-sleep-days.v0" as const,
      metric: "sleep-rem-minutes",
      metricKey: "rem-sleep-minutes",
      sourceProjectionKind: "rem-sleep-sources-days.v1" as const,
      stage: "rem" as const,
      title: "REM sleep",
    },
  ])("keeps the newest manual $stage correction beside wearable evidence", async ({
    legacyProjectionKind,
    metric,
    metricKey,
    sourceProjectionKind,
    stage,
    title,
  }) => {
    for (const includesWearable of [false, true]) {
      const vaultRoot = await createSleepSourceProjectionVault(includesWearable
        ? [{ date: ACTIVITY_DAY.date, providers: ["garmin"], stage }]
        : []);
      const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

      try {
        const eventsPath = join(
          vaultRoot,
          "ledger",
          "events",
          "2026",
          "2026-07.jsonl",
        );
        const existingRecords = await readFile(eventsPath, "utf8");
        const manualCorrections = [
          {
            schemaVersion: "murph.event.v1",
            id: `evt_manual_${stage}_sleep_older`,
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T12:00:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "manual",
            title,
            metric,
            value: 60,
            unit: "minutes",
          },
          {
            schemaVersion: "murph.event.v1",
            id: `evt_manual_${stage}_sleep_newer`,
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T13:00:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "manual",
            title,
            metric,
            value: 91,
            unit: "minutes",
          },
        ];
        await writeFile(
          eventsPath,
          `${existingRecords}${manualCorrections.map((record) => JSON.stringify(record)).join("\n")}\n`,
          "utf8",
        );

        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(sourceProjectionKind),
        );
        const legacySelected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec(legacyProjectionKind),
        );

        expect(selected).toHaveLength(includesWearable ? 2 : 1);
        expect(selected).toEqual(expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              date: ACTIVITY_DAY.date,
              metricKey,
              recordedAt: "2026-07-03T13:00:00.000Z",
              unit: "minutes",
              value: 91,
            }),
            recordKey: `${ACTIVITY_DAY.date}.manual`,
            source: { label: "Manual", source: "manual" },
          }),
          ...(includesWearable
            ? [expect.objectContaining({
                data: expect.objectContaining({ value: 70 }),
                recordKey: `${ACTIVITY_DAY.date}.garmin`,
                source: { label: "Garmin", source: "garmin" },
              })]
            : []),
        ]));
        expect(legacySelected).toEqual(selected);
        expect(parseHostedVaultShareDeliverRequest({
          projectionKind: sourceProjectionKind,
          records: selected,
        }).records).toEqual(selected);
      } finally {
        dateNow.mockRestore();
        await rm(vaultRoot, { recursive: true, force: true });
      }
    }
  });

  it.each([
    {
      legacyProjectionKind: "deep-sleep-days.v0" as const,
      metric: "sleep-deep-minutes",
      metricKey: "deep-sleep-minutes",
      sourceProjectionKind: "deep-sleep-sources-days.v1" as const,
      stage: "deep" as const,
      title: "Deep sleep",
    },
    {
      legacyProjectionKind: "rem-sleep-days.v0" as const,
      metric: "sleep-rem-minutes",
      metricKey: "rem-sleep-minutes",
      sourceProjectionKind: "rem-sleep-sources-days.v1" as const,
      stage: "rem" as const,
      title: "REM sleep",
    },
  ])("keeps four wearable $stage sources visible beside the manual correction", async ({
    legacyProjectionKind,
    metric,
    metricKey,
    sourceProjectionKind,
    stage,
    title,
  }) => {
    const vaultRoot = await createSleepSourceProjectionVault([{
      date: ACTIVITY_DAY.date,
      providers: ["fitbit", "garmin", "oura", "polar"],
      stage,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const eventsPath = join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl");
      const existingRecords = await readFile(eventsPath, "utf8");
      const manualCorrection = {
        schemaVersion: "murph.event.v1",
        id: `evt_manual_${stage}_sleep_four_wearables`,
        kind: "observation",
        occurredAt: "2026-07-03T07:00:00.000Z",
        recordedAt: "2026-07-03T12:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "manual",
        title,
        metric,
        value: 91,
        unit: "minutes",
      };
      await writeFile(
        eventsPath,
        `${existingRecords}${JSON.stringify(manualCorrection)}\n`,
        "utf8",
      );

      const sourceAware = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(sourceProjectionKind),
      );
      const legacy = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(legacyProjectionKind),
      );

      expect(sourceAware).toHaveLength(5);
      expect(sourceAware.map((record) => record.source?.source).sort()).toEqual([
        "fitbit",
        "garmin",
        "manual",
        "oura",
        "polar",
      ]);
      expect(sourceAware.find((record) => record.source?.source === "manual")?.data)
        .toMatchObject({ value: 91 });
      expect(legacy).toEqual(sourceAware);
      expect(parseHostedVaultShareDeliverRequest({
        projectionKind: sourceProjectionKind,
        records: sourceAware,
      }).records).toEqual(sourceAware);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    "omits an invalid manual sleep-stage value without erasing wearable source history (history=%s)",
    async (includesValidHistory) => {
      const vaultRoot = await createSleepSourceProjectionVault(includesValidHistory
        ? [{ date: "2026-07-02", providers: ["garmin"] }]
        : []);
      const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

      try {
        const eventsPath = join(
          vaultRoot,
          "ledger",
          "events",
          "2026",
          "2026-07.jsonl",
        );
        const existingRecords = await readFile(eventsPath, "utf8");
        const manualCorrections = [
          {
            schemaVersion: "murph.event.v1",
            id: "evt_valid_manual_deep_sleep_older",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T12:00:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "manual",
            title: "Deep sleep",
            metric: "sleep-deep-minutes",
            value: 90,
            unit: "minutes",
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_invalid_manual_deep_sleep_newer",
            kind: "observation",
            occurredAt: "2026-07-03T07:00:00.000Z",
            recordedAt: "2026-07-03T13:00:00.000Z",
            dayKey: ACTIVITY_DAY.date,
            source: "manual",
            title: "Deep sleep",
            metric: "sleep-deep-minutes",
            value: 1_500,
            unit: "minutes",
          },
        ];
        await writeFile(
          eventsPath,
          `${existingRecords}${manualCorrections.map((record) => JSON.stringify(record)).join("\n")}\n`,
          "utf8",
        );

        const selected = await readProjectableDailyMetricDays(
          vaultRoot,
          requireDailyMetricSpec("deep-sleep-sources-days.v1"),
        );
        expect(selected.map((record) => record.recordKey)).toEqual(
          includesValidHistory ? ["2026-07-02.garmin"] : [],
        );
        expect(parseHostedVaultShareDeliverRequest({
          projectionKind: "deep-sleep-sources-days.v1",
          records: selected,
        }).records).toEqual(selected);
      } finally {
        dateNow.mockRestore();
        await rm(vaultRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      legacyProjectionKind: "deep-sleep-days.v0" as const,
      metric: "sleep-deep-minutes",
      sourceProjectionKind: "deep-sleep-sources-days.v1" as const,
      stage: "deep" as const,
      title: "Deep sleep",
    },
    {
      legacyProjectionKind: "rem-sleep-days.v0" as const,
      metric: "sleep-rem-minutes",
      sourceProjectionKind: "rem-sleep-sources-days.v1" as const,
      stage: "rem" as const,
      title: "REM sleep",
    },
  ])("does not revive an older valid manual $stage correction when the newest unit is unsupported", async ({
    legacyProjectionKind,
    metric,
    sourceProjectionKind,
    stage,
    title,
  }) => {
    const vaultRoot = await createSleepSourceProjectionVault([
      { date: "2026-07-02", providers: ["garmin"], stage },
      { date: ACTIVITY_DAY.date, providers: ["garmin"], stage },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const eventsPath = join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl");
      const existingRecords = await readFile(eventsPath, "utf8");
      const manualCorrections = [
        {
          schemaVersion: "murph.event.v1",
          id: `evt_valid_manual_${stage}_sleep_older_unit`,
          kind: "observation",
          occurredAt: "2026-07-03T07:00:00.000Z",
          recordedAt: "2026-07-03T12:00:00.000Z",
          dayKey: ACTIVITY_DAY.date,
          source: "manual",
          title,
          metric,
          value: 90,
          unit: "minutes",
        },
        {
          schemaVersion: "murph.event.v1",
          id: `evt_invalid_manual_${stage}_sleep_newer_unit`,
          kind: "observation",
          occurredAt: "2026-07-03T07:00:00.000Z",
          recordedAt: "2026-07-03T13:00:00.000Z",
          dayKey: ACTIVITY_DAY.date,
          source: "manual",
          title,
          metric,
          value: 5_400,
          unit: "seconds",
        },
      ];
      await writeFile(
        eventsPath,
        `${existingRecords}${manualCorrections.map((record) => JSON.stringify(record)).join("\n")}\n`,
        "utf8",
      );

      const sourceAware = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(sourceProjectionKind),
      );
      const legacy = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(legacyProjectionKind),
      );

      expect(sourceAware.map((record) => record.recordKey)).toEqual([
        "2026-07-03.garmin",
        "2026-07-02.garmin",
      ]);
      expect(legacy).toEqual(sourceAware);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      legacyProjectionKind: "deep-sleep-days.v0" as const,
      metric: "sleep-deep-minutes",
      sourceProjectionKind: "deep-sleep-sources-days.v1" as const,
      stage: "deep" as const,
      title: "Deep sleep",
    },
    {
      legacyProjectionKind: "rem-sleep-days.v0" as const,
      metric: "sleep-rem-minutes",
      sourceProjectionKind: "rem-sleep-sources-days.v1" as const,
      stage: "rem" as const,
      title: "REM sleep",
    },
  ])("falls back to the newest live manual $stage correction after deletion", async ({
    legacyProjectionKind,
    metric,
    sourceProjectionKind,
    stage,
    title,
  }) => {
    const vaultRoot = await createSleepSourceProjectionVault([
      { date: ACTIVITY_DAY.date, providers: ["garmin"], stage },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const eventsPath = join(
        vaultRoot,
        "ledger",
        "events",
        "2026",
        "2026-07.jsonl",
      );
      const existingRecords = await readFile(eventsPath, "utf8");
      const olderCorrection = {
        schemaVersion: "murph.event.v1",
        id: `evt_manual_${stage}_sleep_live`,
        kind: "observation",
        occurredAt: "2026-07-03T07:00:00.000Z",
        recordedAt: "2026-07-03T12:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "manual",
        title,
        metric,
        value: 60,
        unit: "minutes",
      };
      const deletedCorrection = {
        ...olderCorrection,
        id: `evt_manual_${stage}_sleep_deleted`,
        recordedAt: "2026-07-03T13:00:00.000Z",
        value: 91,
        lifecycle: { revision: 1 },
      };
      const tombstone = {
        ...deletedCorrection,
        recordedAt: "2026-07-03T14:00:00.000Z",
        lifecycle: { revision: 2, state: "deleted" },
      };
      await writeFile(
        eventsPath,
        `${existingRecords}${[olderCorrection, deletedCorrection, tombstone]
          .map((record) => JSON.stringify(record))
          .join("\n")}\n`,
        "utf8",
      );

      const sourceAware = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(sourceProjectionKind),
      );
      const legacy = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec(legacyProjectionKind),
      );

      expect(sourceAware).toHaveLength(2);
      expect(sourceAware).toEqual(expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ value: 60 }),
          source: { label: "Manual", source: "manual" },
        }),
        expect.objectContaining({
          source: { label: "Garmin", source: "garmin" },
        }),
      ]));
      expect(legacy).toEqual(sourceAware);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps valid dates when more than four providers appear across the window", async () => {
    const vaultRoot = await createSleepSourceProjectionVault([
      { date: "2026-07-02", providers: ["fitbit", "garmin", "oura", "polar"] },
      { date: "2026-07-03", providers: ["suunto"] },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec("deep-sleep-sources-days.v1"),
      );

      expect(selected.map((record) => record.recordKey).sort()).toEqual([
        "2026-07-02.fitbit",
        "2026-07-02.garmin",
        "2026-07-02.oura",
        "2026-07-02.polar",
        "2026-07-03.suunto",
      ]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("rejects future member-local sleep-stage dates", async () => {
    const vaultRoot = await createSleepSourceProjectionVault([
      { date: "2026-07-05", providers: ["garmin"] },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec("deep-sleep-sources-days.v1"),
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of truncating when public sources exceed the bound", async () => {
    const vaultRoot = await createSleepSourceProjectionVault([
      { date: "2026-07-02", providers: ["fitbit"] },
      {
        date: "2026-07-03",
        providers: [
          "fitbit",
          "garmin",
          "oura",
          "polar",
          "suunto",
          "coros",
          "whoop",
          "strava",
          "withings",
        ],
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableDailyMetricDays(
        vaultRoot,
        requireDailyMetricSpec("deep-sleep-sources-days.v1"),
      );

      expect(selected).toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("uses canonical source identity to select equal values and fails closed above the source bound", () => {
    const spec = requireDailyMetricSpec("deep-sleep-sources-days.v1");
    const sourceRows = [
      {
        label: "Fitbit",
        recordedAt: "2026-07-03T06:58:00.000Z",
        source: "fitbit",
        unit: "minutes",
        value: 88,
      },
      {
        label: "Garmin",
        recordedAt: "2026-07-03T07:01:00.000Z",
        source: "garmin",
        unit: "minutes",
        value: 88,
      },
      {
        label: "Oura",
        recordedAt: null,
        source: "oura",
        unit: "minutes",
        value: 112,
      },
    ];
    const point = {
      date: ACTIVITY_DAY.date,
      grain: "day" as const,
      metricKey: "deep-sleep-minutes",
      sourceLabel: "Garmin",
      sources: sourceRows,
      statistic: "value" as const,
      unit: "minutes",
      value: 88,
    };

    const selected = selectProjectableDailyMetricDays(
      [point],
      spec,
      nowMs,
      utcDateKey(nowMs),
    );
    expect(selected[0]?.data).toMatchObject({
      projectedAt: "2026-07-04T00:00:00.000Z",
      sources: [
        expect.not.objectContaining({ selected: true }),
        expect.objectContaining({ selected: true, source: "garmin" }),
        expect.not.objectContaining({ selected: true }),
      ],
      sourcesDisagree: true,
      value: 88,
    });

    expect(selectProjectableDailyMetricDays([{
      ...point,
      sources: [
        ...sourceRows,
        {
          label: "Polar",
          recordedAt: null,
          source: "polar",
          unit: "minutes",
          value: 90,
        },
        {
          label: "Suunto",
          recordedAt: null,
          source: "suunto",
          unit: "minutes",
          value: 92,
        },
      ],
    }], spec, nowMs, utcDateKey(nowMs))).toEqual([]);
  });

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
    ], stepsSpec, nowMs, utcDateKey(nowMs));

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

  it("keeps distinct public step sources as separate tagged records", () => {
    const records = selectProjectableDailyMetricDays([
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        source: { label: "Garmin", source: "garmin" },
        statistic: "value",
        unit: "count",
        value: 18_000,
      },
      {
        date: ACTIVITY_DAY.date,
        grain: "day",
        metricKey: "steps",
        source: { label: "Apple Health", source: "apple-health-kit" },
        statistic: "value",
        unit: "count",
        value: 12_000,
      },
    ], stepsSpec, nowMs, utcDateKey(nowMs));

    expect(records).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ value: 12_000 }),
        recordKey: `${ACTIVITY_DAY.date}.apple-health-kit`,
        source: { label: "Apple Health", source: "apple-health-kit" },
      }),
      expect.objectContaining({
        data: expect.objectContaining({ value: 18_000 }),
        recordKey: `${ACTIVITY_DAY.date}.garmin`,
        source: { label: "Garmin", source: "garmin" },
      }),
    ]);
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "steps-days.v0",
      records,
    }).records).toEqual(records);
  });

  it("reconstructs every public step source from a Junction-backed vault", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_steps_apple_health",
        kind: "observation",
        occurredAt: "2026-07-03T12:00:00.000Z",
        recordedAt: "2026-07-03T12:01:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "device",
        title: "Steps",
        metric: "steps",
        value: 12_000,
        unit: "count",
        dataOrigin: {
          aggregatorProvider: "junction",
          originConfidence: "high",
          sourceProviderSlug: "apple-health-kit",
          version: 1,
        },
        externalRef: {
          system: "junction",
          resourceType: "steps",
          resourceId: "steps_apple_health",
        },
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_steps_garmin",
        kind: "observation",
        occurredAt: "2026-07-03T12:00:00.000Z",
        recordedAt: "2026-07-03T12:02:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "device",
        title: "Steps",
        metric: "steps",
        value: 18_000,
        unit: "count",
        dataOrigin: {
          aggregatorProvider: "junction",
          originConfidence: "high",
          sourceProviderSlug: "garmin",
          version: 1,
        },
        externalRef: {
          system: "junction",
          resourceType: "steps",
          resourceId: "steps_garmin",
        },
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const records = await readProjectableDailyMetricDays(vaultRoot, stepsSpec);
      expect(records).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ value: 12_000 }),
          source: { label: "Apple Health", source: "apple-health-kit" },
        }),
        expect.objectContaining({
          data: expect.objectContaining({ value: 18_000 }),
          source: GARMIN_SOURCE,
        }),
      ]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("fails a daily metric scope closed when a relevant source cannot be tagged", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_steps_resolved",
        kind: "observation",
        occurredAt: "2026-07-03T12:00:00.000Z",
        recordedAt: "2026-07-03T12:01:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "device",
        title: "Steps",
        metric: "steps",
        value: 12_000,
        unit: "count",
        dataOrigin: {
          aggregatorProvider: "junction",
          originConfidence: "high",
          sourceProviderSlug: "garmin",
          version: 1,
        },
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-steps",
          resourceId: "steps_resolved",
        },
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_steps_unresolved",
        kind: "observation",
        occurredAt: "2026-07-03T12:00:00.000Z",
        recordedAt: "2026-07-03T12:02:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        source: "device",
        title: "Steps",
        metric: "steps",
        value: 18_000,
        unit: "count",
        dataOrigin: {
          aggregatorProvider: "junction",
          originConfidence: "high",
          version: 1,
        },
        externalRef: {
          system: "junction",
          resourceType: "steps",
          resourceId: "steps_unresolved",
        },
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableDailyMetricDays(vaultRoot, stepsSpec))
        .resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "UTC+14 Monday",
      currentDate: "2026-07-27",
      nowMs: Date.parse("2026-07-26T10:15:00.000Z"),
      expectedDates: [
        "2026-07-27",
        "2026-07-26",
        "2026-07-25",
        "2026-07-24",
        "2026-07-23",
        "2026-07-22",
        "2026-07-21",
      ],
    },
    {
      label: "UTC-12 Monday",
      currentDate: "2026-07-27",
      nowMs: Date.parse("2026-07-28T11:45:00.000Z"),
      expectedDates: [
        "2026-07-27",
        "2026-07-26",
        "2026-07-25",
        "2026-07-24",
        "2026-07-23",
        "2026-07-22",
        "2026-07-21",
      ],
    },
    {
      label: "Chicago before UTC midnight",
      currentDate: "2026-07-27",
      nowMs: Date.parse("2026-07-28T04:30:00.000Z"),
      expectedDates: [
        "2026-07-27",
        "2026-07-26",
        "2026-07-25",
        "2026-07-24",
        "2026-07-23",
        "2026-07-22",
        "2026-07-21",
      ],
    },
  ])("keeps the member-local seven-date disclosure window on $label", ({
    currentDate,
    expectedDates,
    nowMs: boundaryNowMs,
  }) => {
    const dates = [
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
    ];
    const selected = selectProjectableDailyMetricDays(
      dates.map((date, index) => ({
        date,
        grain: "day",
        metricKey: "steps",
        statistic: "value",
        unit: "count",
        value: 1_000 + index,
      })),
      stepsSpec,
      boundaryNowMs,
      currentDate,
    );

    expect(selected.map((record) => record.recordKey)).toEqual(expectedDates);
  });

  it("excludes sparse dates outside the member-local window", () => {
    const selected = selectProjectableDailyMetricDays(
      ["2026-07-27", "2026-07-25", "2026-07-23", "2026-07-22", "2026-07-20"]
        .map((date, index) => ({
          date,
          grain: "day" as const,
          metricKey: "steps",
          statistic: "value" as const,
          unit: "count",
          value: 1_000 + index,
        })),
      stepsSpec,
      Date.parse("2026-07-26T10:15:00.000Z"),
      "2026-07-27",
    );

    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-07-27",
      "2026-07-25",
      "2026-07-23",
      "2026-07-22",
    ]);
  });

  it("keeps seven civil dates across daylight-saving changes", () => {
    const selected = selectProjectableDailyMetricDays(
      [
        "2026-03-08",
        "2026-03-07",
        "2026-03-06",
        "2026-03-05",
        "2026-03-04",
        "2026-03-03",
        "2026-03-02",
        "2026-03-01",
      ].map((date, index) => ({
        date,
        grain: "day" as const,
        metricKey: "steps",
        statistic: "value" as const,
        unit: "count",
        value: 1_000 + index,
      })),
      stepsSpec,
      Date.parse("2026-03-08T18:00:00.000Z"),
      "2026-03-08",
    );

    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-03-08",
      "2026-03-07",
      "2026-03-06",
      "2026-03-05",
      "2026-03-04",
      "2026-03-03",
      "2026-03-02",
    ]);
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
    }], activitySpec, nowMs, utcDateKey(nowMs))).toEqual([]);
    const selected = selectProjectableDailyMetricDays(
      series.rows,
      activitySpec,
      nowMs,
      utcDateKey(nowMs),
    );
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
          recordKey: `${ACTIVITY_DAY.date}.strava`,
          source: STRAVA_SOURCE,
          sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
        }]);
        expect(JSON.stringify(selected)).not.toContain("averagePowerWatts");
      }
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableMealNutritionDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const proteinSpec = requireDailyMetricSpec("protein-days.v0");

  it("maps a complete meal-nutrition day to one scalar gram record", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({
        date: "2026-07-03",
        mealCount: 2,
        proteinTotal: 87.5,
      }),
    ], proteinSpec, utcDateKey(nowMs))).toEqual([{
      data: {
        date: "2026-07-03",
        metricKey: "protein-grams",
        unit: "g",
        value: 87.5,
      },
      occurredAt: "2026-07-03T00:00:00.000Z",
      recordKey: "2026-07-03.murph",
      source: { label: "Murph", source: "murph" },
    }]);
  });

  it("omits a day when protein is missing from one of its meals", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({
        date: "2026-07-03",
        mealCount: 2,
        proteinMealCount: 1,
        proteinTotal: 42,
      }),
    ], proteinSpec, utcDateKey(nowMs))).toEqual([]);
  });

  it("retains a complete true-zero protein day", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({
        date: "2026-07-03",
        mealCount: 2,
        proteinTotal: 0,
      }),
    ], proteinSpec, utcDateKey(nowMs))).toEqual([{
      data: {
        date: "2026-07-03",
        metricKey: "protein-grams",
        unit: "g",
        value: 0,
      },
      occurredAt: "2026-07-03T00:00:00.000Z",
      recordKey: "2026-07-03.murph",
      source: { label: "Murph", source: "murph" },
    }]);
  });

  it("skips protein totals outside the projection bounds", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({ date: "2026-07-03", proteinTotal: 2_001 }),
      mealNutritionDay({ date: "2026-07-02", proteinTotal: -1 }),
    ], proteinSpec, utcDateKey(nowMs))).toEqual([]);
  });

  it("skips protein days older than the seven-date cutoff", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({ date: "2026-06-25", proteinTotal: 55 }),
    ], proteinSpec, utcDateKey(nowMs))).toEqual([]);
  });

  it("keeps at most the seven newest complete protein days", () => {
    const selected = selectProjectableMealNutritionDays([
      "2026-07-04",
      "2026-06-30",
      "2026-06-27",
      "2026-07-02",
      "2026-06-29",
      "2026-07-01",
      "2026-06-28",
      "2026-07-03",
    ].map((date, index) => mealNutritionDay({
      date,
      proteinTotal: 40 + index,
    })), proteinSpec, utcDateKey(nowMs));

    expect(selected).toHaveLength(7);
    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-07-04.murph",
      "2026-07-03.murph",
      "2026-07-02.murph",
      "2026-07-01.murph",
      "2026-06-30.murph",
      "2026-06-29.murph",
      "2026-06-28.murph",
    ]);
  });

  it("returns no records for a metric-series-sourced projection spec", () => {
    expect(selectProjectableMealNutritionDays([
      mealNutritionDay({ date: "2026-07-03", proteinTotal: 55 }),
    ], requireDailyMetricSpec("steps-days.v0"), utcDateKey(nowMs))).toEqual([]);
  });

  const NUTRIENT_CASES = [
    { projectionKind: "calories-days.v0", totalKey: "calories", metricKey: "dietary-calories", unit: "kcal", value: 2_150, overMax: 20_001 },
    { projectionKind: "carbs-days.v0", totalKey: "carbsGrams", metricKey: "carbs-grams", unit: "g", value: 240, overMax: 2_001 },
    { projectionKind: "fat-days.v0", totalKey: "fatGrams", metricKey: "fat-grams", unit: "g", value: 71, overMax: 2_001 },
    { projectionKind: "fiber-days.v0", totalKey: "fiberGrams", metricKey: "fiber-grams", unit: "g", value: 34, overMax: 501 },
  ] as const;

  for (const nutrient of NUTRIENT_CASES) {
    const dayForNutrient = (
      date: string,
      total: number | null,
      opts: { metricMealCount?: number; mealCount?: number } = {},
    ): MealNutritionDayTotal => {
      const mealCount = opts.mealCount ?? 1;
      const empty = { mealCount: 0, total: null as number | null };
      const totals = {
        calories: { ...empty },
        carbsGrams: { ...empty },
        fatGrams: { ...empty },
        fiberGrams: { ...empty },
        proteinGrams: { ...empty },
      };
      totals[nutrient.totalKey] = { mealCount: opts.metricMealCount ?? mealCount, total };
      return { date, mealCount, totals };
    };

    it(`shares complete ${nutrient.projectionKind} days and fails closed otherwise`, () => {
      const spec = requireDailyMetricSpec(nutrient.projectionKind);
      expect(selectProjectableMealNutritionDays([
        dayForNutrient("2026-07-03", nutrient.value),
      ], spec, utcDateKey(nowMs))).toEqual([{
        data: {
          date: "2026-07-03",
          metricKey: nutrient.metricKey,
          unit: nutrient.unit,
          value: nutrient.value,
        },
        occurredAt: "2026-07-03T00:00:00.000Z",
        recordKey: "2026-07-03.murph",
        source: { label: "Murph", source: "murph" },
      }]);

      // Complete true-zero day is data.
      expect(selectProjectableMealNutritionDays([
        dayForNutrient("2026-07-03", 0),
      ], spec, utcDateKey(nowMs))[0]?.data).toMatchObject({ value: 0 });

      // Incomplete day (a meal lacks the nutrient) is omitted.
      expect(selectProjectableMealNutritionDays([
        dayForNutrient("2026-07-03", nutrient.value, { mealCount: 2, metricMealCount: 1 }),
      ], spec, utcDateKey(nowMs))).toEqual([]);

      // Out-of-bounds total is skipped, never clamped.
      expect(selectProjectableMealNutritionDays([
        dayForNutrient("2026-07-03", nutrient.overMax),
      ], spec, utcDateKey(nowMs))).toEqual([]);
    });
  }

  it("reads and offers complete local-day protein totals without exposing meal metadata", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-protein-days-"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-05T00:00:00.000Z"),
    );

    try {
      await mkdir(join(vaultRoot, "ledger", "events", "2026"), { recursive: true });
      await writeFile(
        join(vaultRoot, "vault.json"),
        `${JSON.stringify({
          formatVersion: CURRENT_VAULT_FORMAT_VERSION,
          vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4D",
          createdAt: "2026-07-01T00:00:00.000Z",
          title: "Vault share protein test",
          timezone: "America/Los_Angeles",
        })}\n`,
        "utf8",
      );
      await writeFile(
        join(vaultRoot, "ledger", "events", "2026", "2026-07.jsonl"),
        `${[
          {
            schemaVersion: "murph.event.v1",
            id: "evt_01K72NVW6Z4QK8VYAVX7GT7S5A",
            kind: "meal",
            occurredAt: "2026-07-04T00:30:00Z",
            dayKey: "2026-07-03",
            recordedAt: "2026-07-04T00:35:00Z",
            title: "Local evening meal",
            source: "manual",
            mealId: "meal_01K72NVW6Z4QK8VYAVX7GT7S5A",
            nutrition: {
              totals: {
                calories: 610,
                proteinGrams: 40,
              },
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_01K72NVW6Z4QK8VYAVX7GT7S5B",
            kind: "meal",
            occurredAt: "2026-07-03T17:00:00Z",
            dayKey: "2026-07-03",
            recordedAt: "2026-07-03T17:01:00Z",
            title: "Imported meal revision one",
            source: "device",
            externalRef: {
              system: "junction",
              resourceType: "junction-meal",
              resourceId: "protein-meal-01",
            },
            mealId: "meal_01K72NVW6Z4QK8VYAVX7GT7S5B",
            nutrition: {
              totals: {
                calories: 420,
                proteinGrams: 10,
              },
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_01K72NVW6Z4QK8VYAVX7GT7S5C",
            kind: "meal",
            occurredAt: "2026-07-03T17:00:00Z",
            dayKey: "2026-07-03",
            recordedAt: "2026-07-03T17:05:00Z",
            title: "Imported meal revision two",
            source: "device",
            externalRef: {
              system: "junction",
              resourceType: "junction-meal",
              resourceId: "protein-meal-01",
            },
            mealId: "meal_01K72NVW6Z4QK8VYAVX7GT7S5C",
            nutrition: {
              totals: {
                calories: 450,
                proteinGrams: 22,
              },
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_01K72NVW6Z4QK8VYAVX7GT7S5D",
            kind: "meal",
            occurredAt: "2026-07-04T16:00:00Z",
            dayKey: "2026-07-04",
            recordedAt: "2026-07-04T16:01:00Z",
            title: "Partial day protein meal",
            source: "manual",
            mealId: "meal_01K72NVW6Z4QK8VYAVX7GT7S5D",
            nutrition: {
              totals: {
                calories: 500,
                proteinGrams: 35,
              },
            },
          },
          {
            schemaVersion: "murph.event.v1",
            id: "evt_01K72NVW6Z4QK8VYAVX7GT7S5E",
            kind: "meal",
            occurredAt: "2026-07-04T20:00:00Z",
            dayKey: "2026-07-04",
            recordedAt: "2026-07-04T20:01:00Z",
            title: "Partial day meal without protein",
            source: "manual",
            mealId: "meal_01K72NVW6Z4QK8VYAVX7GT7S5E",
            nutrition: {
              totals: {
                calories: 300,
              },
            },
          },
        ].map((record) => JSON.stringify(record)).join("\n")}\n`,
        "utf8",
      );

      const selected = await readProjectableMealNutritionDays(
        vaultRoot,
        proteinSpec,
      );

      expect(selected).toEqual([{
        data: {
          date: "2026-07-03",
          metricKey: "protein-grams",
          unit: "g",
          value: 62,
        },
        occurredAt: "2026-07-03T00:00:00.000Z",
        recordKey: "2026-07-03.murph",
        source: { label: "Murph", source: "murph" },
      }]);
      expect(selected[0]).not.toHaveProperty("sourceRevision");
      expect(JSON.stringify(selected)).not.toContain("externalRef");
      expect(JSON.stringify(selected)).not.toContain("mealId");

      const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
      await expect(offerHostedVaultShareProjectionBestEffort({
        vaultRoot,
        vaultSharePort: {
          deliver,
          listActiveProjectionScopes: async () => activeProjectionResponse(PROTEIN_SCOPE),
        },
      })).resolves.toEqual({ outcome: "delivered" });
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver).toHaveBeenCalledWith({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "protein-days.v0",
        projectionScope: PROTEIN_SCOPE,
        records: selected,
        sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
      });
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
      currentDate: utcDateKey(nowMs),
      ...workoutRows({
        date: ACTIVITY_DAY.date,
        workoutCount: 2,
        workoutMinutes: 85,
      }),
    });

    expect(selected).toEqual([
      {
        data: {
          date: ACTIVITY_DAY.date,
          metricSemantics:
            HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
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
      currentDate: utcDateKey(nowMs),
      ...workoutRows({
        countRecordIds: ["evt_garmin_count"],
        date: ACTIVITY_DAY.date,
        minuteRecordIds: ["evt_oura_minutes"],
        workoutCount: 1,
        workoutMinutes: 85,
      }),
    });

    expect(selected).toEqual([]);
  });
});

describe("selectProjectableWorkoutsDays", () => {
  const nowMs = Date.parse("2026-07-04T12:00:00.000Z");

  it("emits one day-keyed record with every workout in canonical local-clock order", () => {
    const selected = selectProjectableWorkoutsDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "strength-training",
          date: "2026-07-04",
          durationMinutes: 30,
          recordIds: ["evt_local_strength"],
          startedAt: "2026-07-04T02:00:00.000Z",
          timeZone: "America/Los_Angeles",
        }),
        activitySessionRow({
          activityKind: "running",
          date: "2026-07-04",
          durationMinutes: 45,
          recordIds: ["evt_local_run"],
          startedAt: "2026-07-04T01:30:00.000Z",
          timeZone: "America/Los_Angeles",
        }),
      ],
      vaultTimeZone: "UTC",
    });

    expect(selected).toHaveLength(7);
    expect(findWorkoutsRecord(selected, "2026-07-03")).toEqual({
      data: {
        calendarClosedThroughDate: "2026-07-03",
        date: "2026-07-03",
        timeSemantics: HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
        workouts: [
          {
            kind: "running",
            minutes: 45,
            startLocalMs: 18 * 60 * 60 * 1_000 + 30 * 60 * 1_000,
          },
          {
            kind: "strength-training",
            minutes: 30,
            startLocalMs: 19 * 60 * 60 * 1_000,
          },
        ],
      },
      occurredAt: "2026-07-03T00:00:00.000Z",
      recordKey: "2026-07-03",
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    });
    expect(parseHostedVaultShareDeliverRequest({
      projectionKind: "workouts.v0",
      records: selected,
    }).records).toEqual(selected);
  });

  it("keeps a member behind group midnight pending and settles a later threshold flip", () => {
    const date = "2026-07-04";
    const thresholdLocalMs = 18 * 60 * 60 * 1_000;
    const afterGroupMidnight = Date.parse("2026-07-04T15:30:00.000Z");
    expect(
      formatTimeZoneDateTimeParts(afterGroupMidnight, "Pacific/Kiritimati").dayKey,
    ).toBe("2026-07-05");
    expect(
      formatTimeZoneDateTimeParts(afterGroupMidnight, "America/Los_Angeles").dayKey,
    ).toBe(date);

    const earlyWorkout = activitySessionRow({
      activityKind: "running",
      date,
      durationMinutes: 30,
      recordIds: ["evt_member_behind_early"],
      startedAt: "2026-07-04T08:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
    const initial = selectProjectableWorkoutsDays({
      nowMs: afterGroupMidnight,
      rows: [earlyWorkout],
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(initial, date)?.data).toMatchObject({
      calendarClosedThroughDate: "2026-07-03",
      date,
      workouts: [{ startLocalMs: 60 * 60 * 1_000 }],
    });
    expect(scoreSettledWorkoutsDate(initial, date, thresholdLocalMs)).toEqual({
      status: "pending",
    });

    const laterWorkout = activitySessionRow({
      activityKind: "cycling",
      date,
      durationMinutes: 30,
      recordIds: ["evt_member_behind_later"],
      startedAt: "2026-07-05T02:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
    const updatedButOpen = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-05T04:00:00.000Z"),
      rows: [earlyWorkout, laterWorkout],
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(updatedButOpen, date)?.data).toMatchObject({
      calendarClosedThroughDate: "2026-07-03",
      workouts: [
        { startLocalMs: 60 * 60 * 1_000 },
        { startLocalMs: 19 * 60 * 60 * 1_000 },
      ],
    });
    expect(scoreSettledWorkoutsDate(
      updatedButOpen,
      date,
      thresholdLocalMs,
    )).toEqual({ status: "pending" });

    const settled = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-05T12:30:00.000Z"),
      rows: [earlyWorkout, laterWorkout],
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(settled, date)?.data)
      .toHaveProperty("calendarClosedThroughDate", date);
    expect(scoreSettledWorkoutsDate(settled, date, thresholdLocalMs)).toEqual({
      qualifies: true,
      status: "settled",
      workoutCount: 2,
    });
  });

  it("settles a date only after the last civil timezone has passed it", () => {
    const beforeGlobalCloseMs = Date.parse("2026-07-05T11:59:59.999Z");
    expect(
      formatTimeZoneDateTimeParts(beforeGlobalCloseMs, "America/Los_Angeles").dayKey,
    ).toBe("2026-07-05");
    expect(
      formatTimeZoneDateTimeParts(beforeGlobalCloseMs, "Pacific/Kiritimati").dayKey,
    ).toBe("2026-07-06");

    const workout = activitySessionRow({
      activityKind: "running",
      date: "2026-07-04",
      durationMinutes: 30,
      recordIds: ["evt_global_close"],
      startedAt: "2026-07-04T05:00:00.000Z",
      timeZone: "Pacific/Kiritimati",
    });
    const pending = selectProjectableWorkoutsDays({
      nowMs: beforeGlobalCloseMs,
      rows: [workout],
      vaultTimeZone: "Pacific/Kiritimati",
    });
    expect(findWorkoutsRecord(pending, "2026-07-04")?.data)
      .toHaveProperty("calendarClosedThroughDate", "2026-07-03");
    expect(scoreSettledWorkoutsDate(
      pending,
      "2026-07-04",
      18 * 60 * 60 * 1_000,
    )).toEqual({ status: "pending" });

    const settled = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-05T12:00:00.000Z"),
      rows: [workout],
      vaultTimeZone: "Pacific/Kiritimati",
    });
    expect(findWorkoutsRecord(settled, "2026-07-04")?.data)
      .toHaveProperty("calendarClosedThroughDate", "2026-07-04");
    expect(scoreSettledWorkoutsDate(
      settled,
      "2026-07-04",
      18 * 60 * 60 * 1_000,
    )).toEqual({
      qualifies: true,
      status: "settled",
      workoutCount: 1,
    });
  });

  it("dates a travelling workout in its event zone without using that zone for settlement", () => {
    const travelNowMs = Date.parse("2026-07-04T15:30:00.000Z");
    expect(formatTimeZoneDateTimeParts(travelNowMs, "Asia/Tokyo").dayKey)
      .toBe("2026-07-05");
    expect(formatTimeZoneDateTimeParts(
      travelNowMs,
      "America/Los_Angeles",
    ).dayKey).toBe("2026-07-04");

    const selected = selectProjectableWorkoutsDays({
      nowMs: travelNowMs,
      rows: [activitySessionRow({
        activityKind: "running",
        date: "2026-07-04",
        durationMinutes: 30,
        recordIds: ["evt_travel_event_zone"],
        startedAt: "2026-07-04T13:00:00.000Z",
        timeZone: "Asia/Tokyo",
      })],
      vaultTimeZone: "America/Los_Angeles",
    });
    // The workout's own clock still comes from where it happened: 13:00Z is
    // 22:00 in Tokyo.
    expect(findWorkoutsRecord(selected, "2026-07-04")?.data).toMatchObject({
      date: "2026-07-04",
      workouts: [{ startLocalMs: 22 * 60 * 60 * 1_000 }],
    });
    expect(findWorkoutsRecord(selected, "2026-07-04")?.data)
      .toHaveProperty("calendarClosedThroughDate", "2026-07-03");
    // The zone itself is still never embedded in a workout record; it is shared
    // only through the separately granted time-zone.v0 scope.
    expect(JSON.stringify(selected)).not.toMatch(
      /timeZone|Asia\/Tokyo|Los_Angeles/u,
    );
  });

  it("keeps the globally open date pending across travel zones", () => {
    const travelNowMs = Date.parse("2026-07-04T16:00:00.000Z");
    expect(formatTimeZoneDateTimeParts(
      travelNowMs,
      "America/Los_Angeles",
    ).dayKey).toBe("2026-07-04");
    expect(formatTimeZoneDateTimeParts(travelNowMs, "Asia/Tokyo").dayKey)
      .toBe("2026-07-05");

    const selected = selectProjectableWorkoutsDays({
      nowMs: travelNowMs,
      rows: [
        activitySessionRow({
          activityKind: "walking",
          date: "2026-07-03",
          durationMinutes: 20,
          recordIds: ["evt_current_zone_anchor"],
          startedAt: "2026-07-04T06:30:00.000Z",
          timeZone: "America/Los_Angeles",
        }),
        activitySessionRow({
          activityKind: "running",
          date: "2026-07-04",
          durationMinutes: 30,
          recordIds: ["evt_closed_travel_date"],
          startedAt: "2026-07-03T15:30:00.000Z",
          timeZone: "Asia/Tokyo",
        }),
      ],
      vaultTimeZone: "America/Los_Angeles",
    });

    expect(findWorkoutsRecord(selected, "2026-07-04")?.data).toMatchObject({
      calendarClosedThroughDate: "2026-07-03",
      workouts: [{ kind: "running", startLocalMs: 30 * 60 * 1_000 }],
    });
  });

  it("keeps the hidden timezone out of an otherwise identical source revision", () => {
    const common = {
      activityKind: "running",
      date: "2026-07-03",
      durationMinutes: 45,
      observedAt: "2026-07-03T23:00:00.000Z",
      recordIds: ["evt_timezone_opaque"],
    };
    const utc = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-04T12:00:00.000Z"),
      rows: [activitySessionRow({
        ...common,
        startedAt: "2026-07-03T18:00:00.000Z",
        timeZone: "UTC",
      })],
      vaultTimeZone: "UTC",
    });
    const newYork = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-04T12:00:00.000Z"),
      rows: [activitySessionRow({
        ...common,
        startedAt: "2026-07-03T22:00:00.000Z",
        timeZone: "America/New_York",
      })],
      vaultTimeZone: "America/New_York",
    });

    const utcRecord = findWorkoutsRecord(utc, "2026-07-03");
    const newYorkRecord = findWorkoutsRecord(newYork, "2026-07-03");
    expect(utcRecord?.data).toEqual(newYorkRecord?.data);
    expect(utcRecord?.sourceRevision).toMatch(SOURCE_REVISION_PATTERN);
    expect(utcRecord?.sourceRevision).toBe(newYorkRecord?.sourceRevision);
  });

  it("does not reopen a completed date when the declared timezone changes", () => {
    const rows = [activitySessionRow({
      activityKind: "running",
      date: "2026-07-03",
      durationMinutes: 45,
      recordIds: ["evt_timezone_change"],
      startedAt: "2026-07-03T18:00:00.000Z",
      timeZone: "UTC",
    })];

    const beforeChange = selectProjectableWorkoutsDays({
      nowMs,
      rows,
      vaultTimeZone: "America/Los_Angeles",
    });
    const afterChange = selectProjectableWorkoutsDays({
      nowMs,
      rows,
      vaultTimeZone: "Pacific/Kiritimati",
    });

    expect(afterChange).toEqual(beforeChange);
    expect(scoreSettledWorkoutsDate(
      afterChange,
      "2026-07-03",
      18 * 60 * 60 * 1_000,
    )).toMatchObject({ status: "settled" });
  });

  it("does not require a declared timezone when the event timezone is valid", () => {
    const rows = [activitySessionRow({
      activityKind: "running",
      date: "2026-07-03",
      durationMinutes: 45,
      recordIds: ["evt_no_declared_timezone"],
      startedAt: "2026-07-03T18:00:00.000Z",
      timeZone: "UTC",
    })];

    expect(selectProjectableWorkoutsDays({
      nowMs,
      rows,
      vaultTimeZone: null,
    })).toEqual(selectProjectableWorkoutsDays({
      nowMs,
      rows,
      vaultTimeZone: "Pacific/Kiritimati",
    }));
  });

  it("defers a valid date-line workout outside the window without erasing it", () => {
    const selected = selectProjectableWorkoutsDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: "2026-07-03",
          durationMinutes: 30,
          recordIds: ["evt_inside_window"],
          startedAt: "2026-07-03T18:00:00.000Z",
          timeZone: "UTC",
        }),
        activitySessionRow({
          activityKind: "cycling",
          date: "2026-07-05",
          durationMinutes: 30,
          recordIds: ["evt_across_date_line"],
          startedAt: "2026-07-04T11:30:00.000Z",
          timeZone: "Pacific/Kiritimati",
        }),
      ],
      vaultTimeZone: "UTC",
    });

    expect(selected).toHaveLength(7);
    expect(findWorkoutsRecord(selected, "2026-07-03")?.data.workouts)
      .toHaveLength(1);
    expect(findWorkoutsRecord(selected, "2026-07-05")).toBeUndefined();
  });

  it("keeps both repeated-DST-hour workouts and settles only after global close", () => {
    const rows = [
      activitySessionRow({
        activityKind: "running",
        date: "2026-11-01",
        durationMinutes: 30,
        recordIds: ["evt_dst_before_fallback"],
        startedAt: "2026-11-01T05:15:00.000Z",
        timeZone: "America/New_York",
      }),
      activitySessionRow({
        activityKind: "cycling",
        date: "2026-11-01",
        durationMinutes: 30,
        recordIds: ["evt_dst_after_fallback"],
        startedAt: "2026-11-01T06:15:00.000Z",
        timeZone: "America/New_York",
      }),
    ];
    const open = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-11-01T13:00:00.000Z"),
      rows,
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(open, "2026-11-01")?.data).toMatchObject({
      calendarClosedThroughDate: "2026-10-31",
      workouts: [
        { kind: "cycling", startLocalMs: 75 * 60 * 1_000 },
        { kind: "running", startLocalMs: 75 * 60 * 1_000 },
      ],
    });
    expect(scoreSettledWorkoutsDate(
      open,
      "2026-11-01",
      60 * 60 * 1_000,
    )).toEqual({ status: "pending" });

    const settled = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-11-02T12:00:00.000Z"),
      rows,
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(settled, "2026-11-01")?.data)
      .toHaveProperty("calendarClosedThroughDate", "2026-11-01");
    expect(scoreSettledWorkoutsDate(
      settled,
      "2026-11-01",
      60 * 60 * 1_000,
    )).toEqual({
      qualifies: true,
      status: "settled",
      workoutCount: 2,
    });
  });

  it("falls back only to a validated vault timezone and omits events with neither", () => {
    const fallback = selectProjectableWorkoutsDays({
      nowMs,
      rows: [activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 30,
        recordIds: ["evt_vault_zone_fallback"],
        startedAt: "2026-07-03T22:00:00.000Z",
        timeZone: "Mars/Olympus",
      })],
      vaultTimeZone: "America/New_York",
    });
    expect(findWorkoutsRecord(fallback, ACTIVITY_DAY.date)?.data).toMatchObject({
      workouts: [{ startLocalMs: 18 * 60 * 60 * 1_000 }],
    });

    const eventZoneWins = selectProjectableWorkoutsDays({
      nowMs,
      rows: [activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 30,
        recordIds: ["evt_event_zone_wins"],
        startedAt: "2026-07-03T22:00:00.000Z",
        timeZone: "UTC",
      })],
      vaultTimeZone: "America/New_York",
    });
    expect(findWorkoutsRecord(
      eventZoneWins,
      ACTIVITY_DAY.date,
    )?.data).toMatchObject({
      workouts: [{ startLocalMs: 22 * 60 * 60 * 1_000 }],
    });

    expect(selectProjectableWorkoutsDays({
      nowMs,
      rows: [activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 30,
        recordIds: ["evt_no_valid_zone"],
        startedAt: "2026-07-03T22:00:00.000Z",
        timeZone: "Mars/Olympus",
      })],
      vaultTimeZone: "Moon/Base",
    })).toEqual([]);
  });

  it("uses a strict any-workout threshold and excludes intervention sessions", () => {
    const thresholdLocalMs = 18 * 60 * 60 * 1_000;
    const exactBoundary = activitySessionRow({
      activityKind: "running",
      date: ACTIVITY_DAY.date,
      durationMinutes: 30,
      recordIds: ["evt_exact_boundary"],
      startedAt: "2026-07-03T18:00:00.000Z",
      timeZone: "UTC",
    });
    const later = activitySessionRow({
      activityKind: "cycling",
      date: ACTIVITY_DAY.date,
      durationMinutes: 20,
      recordIds: ["evt_one_ms_later"],
      startedAt: "2026-07-03T18:00:00.001Z",
      timeZone: "UTC",
    });
    const intervention = activitySessionRow({
      activityKind: "sauna",
      date: ACTIVITY_DAY.date,
      durationMinutes: 40,
      isWorkout: true,
      recordIds: ["evt_intervention_not_eligible"],
      sourceKind: "intervention_session",
      startedAt: "2026-07-03T23:00:00.000Z",
      timeZone: "UTC",
    });

    const boundaryOnly = selectProjectableWorkoutsDays({
      nowMs,
      rows: [exactBoundary, intervention],
      vaultTimeZone: "UTC",
    });
    expect(scoreSettledWorkoutsDate(
      boundaryOnly,
      ACTIVITY_DAY.date,
      thresholdLocalMs,
    )).toEqual({
      qualifies: false,
      status: "settled",
      workoutCount: 1,
    });

    const withLater = selectProjectableWorkoutsDays({
      nowMs,
      rows: [exactBoundary, later, intervention],
      vaultTimeZone: "UTC",
    });
    expect(findWorkoutsRecord(
      withLater,
      ACTIVITY_DAY.date,
    )?.data.workouts).toEqual([
      {
        kind: "running",
        minutes: 30,
        startLocalMs: thresholdLocalMs,
      },
      {
        kind: "cycling",
        minutes: 20,
        startLocalMs: thresholdLocalMs + 1,
      },
    ]);
    expect(scoreSettledWorkoutsDate(
      withLater,
      ACTIVITY_DAY.date,
      thresholdLocalMs,
    )).toEqual({
      qualifies: true,
      status: "settled",
      workoutCount: 2,
    });
  });

  it("deduplicates overlapping provider copies before emitting the array", () => {
    const selected = selectProjectableWorkoutsDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          endedAt: "2026-07-03T18:45:00.000Z",
          observedAt: "2026-07-03T19:00:00.000Z",
          recordIds: ["evt_provider_copy_a"],
          startedAt: "2026-07-03T18:00:00.000Z",
          timeZone: "UTC",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 45,
          endedAt: "2026-07-03T18:46:00.000Z",
          observedAt: "2026-07-03T19:05:00.000Z",
          recordIds: ["evt_provider_copy_b"],
          startedAt: "2026-07-03T18:01:00.000Z",
          timeZone: "UTC",
        }),
        activitySessionRow({
          activityKind: "strength-training",
          date: ACTIVITY_DAY.date,
          durationMinutes: 30,
          recordIds: ["evt_distinct_strength"],
          startedAt: "2026-07-03T20:00:00.000Z",
          timeZone: "UTC",
        }),
      ],
      vaultTimeZone: "UTC",
    });

    expect(findWorkoutsRecord(
      selected,
      ACTIVITY_DAY.date,
    )?.data.workouts).toEqual([
      {
        kind: "run",
        minutes: 45,
        startLocalMs: 18 * 60 * 60 * 1_000 + 60 * 1_000,
      },
      {
        kind: "strength-training",
        minutes: 30,
        startLocalMs: 20 * 60 * 60 * 1_000,
      },
    ]);
  });

  it("fails the whole projection when a deduplicated day exceeds the per-day bound", () => {
    const rows = Array.from(
      { length: HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY + 1 },
      (_, index) => activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 5,
        recordIds: [`evt_daily_overflow_${index}`],
        startedAt: new Date(
          Date.parse("2026-07-03T00:00:00.000Z") + index * 10 * 60 * 1_000,
        ).toISOString(),
        timeZone: "UTC",
      }),
    );

    expect(selectProjectableWorkoutsDays({
      nowMs,
      rows,
      vaultTimeZone: "UTC",
    })).toEqual([]);
  });

  it("fails closed rather than publishing a partial day when workout details are missing", () => {
    expect(selectProjectableWorkoutsDays({
      nowMs,
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 30,
          recordIds: ["evt_complete_workout"],
          startedAt: "2026-07-03T18:00:00.000Z",
          timeZone: "UTC",
        }),
        activitySessionRow({
          activityKind: "cycling",
          date: ACTIVITY_DAY.date,
          durationMinutes: null,
          recordIds: ["evt_workout_without_duration"],
          startedAt: "2026-07-03T20:00:00.000Z",
          timeZone: "UTC",
        }),
      ],
      vaultTimeZone: "UTC",
    })).toEqual([]);
  });

  it("scores a settled empty array as observed zero but keeps a missing date unobserved", () => {
    const selected = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-04T12:00:00.000Z"),
      rows: [],
      vaultTimeZone: "UTC",
    });

    expect(selected).toHaveLength(7);
    expect(findWorkoutsRecord(selected, "2026-07-03")?.data).toEqual({
      calendarClosedThroughDate: "2026-07-03",
      date: "2026-07-03",
      timeSemantics: HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
      workouts: [],
    });
    expect(scoreSettledWorkoutsDate(
      selected,
      "2026-07-03",
      18 * 60 * 60 * 1_000,
    )).toEqual({
      qualifies: false,
      status: "settled",
      workoutCount: 0,
    });
    expect(scoreSettledWorkoutsDate(
      selected,
      "2026-07-04",
      18 * 60 * 60 * 1_000,
    )).toEqual({ status: "pending" });
    // A reader never advances a stale snapshot from its own clock.
    expect(scoreSettledWorkoutsDate(
      selected,
      "2026-07-04",
      18 * 60 * 60 * 1_000,
    )).toEqual({ status: "pending" });

    const refreshed = selectProjectableWorkoutsDays({
      nowMs: Date.parse("2026-07-05T12:00:00.000Z"),
      rows: [],
      vaultTimeZone: "Pacific/Kiritimati",
    });
    expect(scoreSettledWorkoutsDate(
      refreshed,
      "2026-07-04",
      18 * 60 * 60 * 1_000,
    )).toEqual({
      qualifies: false,
      status: "settled",
      workoutCount: 0,
    });
    expect(scoreSettledWorkoutsDate(
      selected,
      "2026-06-26",
      18 * 60 * 60 * 1_000,
    )).toEqual({ status: "missing" });
  });

  it("requires durable workout evidence and excludes Oura wellness on a workout day", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_oura_workout",
        kind: "activity_session",
        occurredAt: "2026-07-03T18:30:00.000Z",
        dayKey: "2026-07-03",
        recordedAt: "2026-07-03T19:15:00.000Z",
        source: "device",
        externalRef: {
          system: "oura",
          resourceType: "workout",
          resourceId: "oura-workout-1",
        },
        activityType: "running",
        durationMinutes: 45,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_oura_wellness",
        kind: "activity_session",
        occurredAt: "2026-07-03T21:30:00.000Z",
        dayKey: "2026-07-03",
        recordedAt: "2026-07-03T22:00:00.000Z",
        source: "device",
        externalRef: {
          system: "oura",
          resourceType: "session",
          resourceId: "oura-session-1",
        },
        activityType: "meditation",
        durationMinutes: 30,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_manual_strength",
        kind: "activity_session",
        occurredAt: "2026-07-02T20:00:00.000Z",
        dayKey: "2026-07-02",
        recordedAt: "2026-07-02T20:45:00.000Z",
        source: "manual",
        activityType: "strength-training",
        durationMinutes: 45,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_strava_run",
        kind: "activity_session",
        occurredAt: "2026-07-01T19:00:00.000Z",
        dayKey: "2026-07-01",
        recordedAt: "2026-07-01T19:40:00.000Z",
        source: "device",
        externalRef: {
          system: "strava",
          resourceType: "activity",
          resourceId: "strava-activity-1",
        },
        activityType: "running",
        durationMinutes: 40,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_whoop_workout",
        kind: "activity_session",
        occurredAt: "2026-06-30T17:00:00.000Z",
        dayKey: "2026-06-30",
        recordedAt: "2026-06-30T17:32:00.000Z",
        source: "device",
        externalRef: {
          system: "whoop",
          resourceType: "workout",
          resourceId: "whoop-workout-1",
        },
        activityType: "cycling",
        durationMinutes: 32,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_junction_workout",
        kind: "activity_session",
        occurredAt: "2026-06-30T20:00:00.000Z",
        dayKey: "2026-06-30",
        recordedAt: "2026-06-30T20:25:00.000Z",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-workouts",
          resourceId: "junction-workout-1",
        },
        activityType: "walking",
        durationMinutes: 25,
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableWorkoutsDays(vaultRoot);
      expect(findWorkoutsRecord(
        selected,
        "2026-07-03",
      )?.data.workouts).toEqual([{
        kind: "running",
        minutes: 45,
        source: OURA_SOURCE,
        startLocalMs: 18 * 60 * 60 * 1_000 + 30 * 60 * 1_000,
      }]);
      expect(JSON.stringify(selected)).not.toMatch(/meditation|oura-session/u);
      expect(findWorkoutsRecord(
        selected,
        "2026-07-02",
      )?.data.workouts).toMatchObject([{ kind: "strength-training" }]);
      expect(findWorkoutsRecord(
        selected,
        "2026-07-01",
      )?.data.workouts).toMatchObject([{ kind: "running" }]);
      expect(findWorkoutsRecord(
        selected,
        "2026-06-30",
      )?.data.workouts).toMatchObject([
        { kind: "cycling" },
        { kind: "walking" },
      ]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("fails the workout scope closed when a relevant source cannot be tagged", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_resolved_workout",
        kind: "activity_session",
        occurredAt: "2026-07-03T18:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T19:00:00.000Z",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-workouts",
          resourceId: "resolved-workout",
        },
        activityType: "running",
        durationMinutes: 40,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_unresolved_workout",
        kind: "activity_session",
        occurredAt: "2026-07-03T20:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T20:30:00.000Z",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "workout",
          resourceId: "unresolved-workout",
        },
        activityType: "cycling",
        durationMinutes: 30,
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableWorkoutsDays(vaultRoot)).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("accepts exactly eight workout sources and fails closed at nine", async () => {
    const records = Array.from({ length: 9 }, (_, index) => ({
      schemaVersion: "murph.event.v1",
      id: `evt_source_${index}_workout`,
      kind: "activity_session",
      occurredAt: new Date(
        Date.parse("2026-07-03T07:00:00.000Z") + index * 60 * 60 * 1_000,
      ).toISOString(),
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T20:00:00.000Z",
      source: "device",
      externalRef: {
        system: "junction",
        resourceType: `junction-source-${index}-workouts`,
        resourceId: `source-${index}-workout`,
      },
      activityType: "running",
      durationMinutes: 30,
    }));
    const exactBoundVaultRoot = await createActivitySessionVault(records.slice(0, 8));
    const overBoundVaultRoot = await createActivitySessionVault(records);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const exactBound = await readProjectableWorkoutsDays(exactBoundVaultRoot);
      expect(findWorkoutsRecord(exactBound, ACTIVITY_DAY.date)?.data.workouts)
        .toHaveLength(8);
      await expect(readProjectableWorkoutsDays(overBoundVaultRoot))
        .resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(exactBoundVaultRoot, { recursive: true, force: true });
      await rm(overBoundVaultRoot, { recursive: true, force: true });
    }
  });

  it("discloses a generic provider workout instead of emptying the projection", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_generic_whoop_workout",
        kind: "activity_session",
        // WHOOP maps an unusable sport name to the canonical generic type.
        occurredAt: "2026-07-03T19:00:00.000Z",
        dayKey: "2026-07-03",
        recordedAt: "2026-07-03T20:00:00.000Z",
        timeZone: "UTC",
        source: "device",
        externalRef: {
          system: "whoop",
          resourceType: "workout",
          resourceId: "whoop-generic-1",
        },
        activityType: "workout",
        durationMinutes: 40,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_specific_running_workout",
        kind: "activity_session",
        occurredAt: "2026-07-02T18:30:00.000Z",
        dayKey: "2026-07-02",
        recordedAt: "2026-07-02T19:20:00.000Z",
        timeZone: "UTC",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-workouts",
          resourceId: "junction-specific-1",
        },
        activityType: "running",
        durationMinutes: 30,
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableWorkoutsDays(vaultRoot);
      // The generic row is real workout evidence, so it is disclosed plainly.
      expect(findWorkoutsRecord(selected, "2026-07-03")?.data.workouts)
        .toMatchObject([{ kind: "workout", minutes: 40 }]);
      // And it must not take the unrelated specific workout down with it.
      expect(findWorkoutsRecord(selected, "2026-07-02")?.data.workouts)
        .toMatchObject([{ kind: "running", minutes: 30 }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps overlapping provider copies separate and source tagged", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        // Specific copy starts exactly at 18:00, so a strict "after 18:00"
        // challenge must NOT qualify on it.
        schemaVersion: "murph.event.v1",
        id: "evt_specific_copy",
        kind: "activity_session",
        occurredAt: "2026-07-03T18:00:00.000Z",
        dayKey: "2026-07-03",
        recordedAt: "2026-07-03T19:05:00.000Z",
        timeZone: "UTC",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-workouts",
          resourceId: "junction-dup-1",
        },
        activityType: "running",
        durationMinutes: 60,
      },
      {
        // Same session from another provider, one minute later and generic.
        // Before the fix this survived separately and falsely qualified.
        schemaVersion: "murph.event.v1",
        id: "evt_generic_copy",
        kind: "activity_session",
        occurredAt: "2026-07-03T18:01:00.000Z",
        dayKey: "2026-07-03",
        recordedAt: "2026-07-03T19:06:00.000Z",
        timeZone: "UTC",
        source: "device",
        externalRef: {
          system: "whoop",
          resourceType: "workout",
          resourceId: "whoop-dup-1",
        },
        activityType: "workout",
        durationMinutes: 59,
      },
      {
        // A standalone generic workout must still be disclosed generically.
        schemaVersion: "murph.event.v1",
        id: "evt_standalone_generic",
        kind: "activity_session",
        occurredAt: "2026-07-02T07:00:00.000Z",
        dayKey: "2026-07-02",
        recordedAt: "2026-07-02T08:00:00.000Z",
        timeZone: "UTC",
        source: "device",
        externalRef: {
          system: "whoop",
          resourceType: "workout",
          resourceId: "whoop-standalone-1",
        },
        activityType: "workout",
        durationMinutes: 30,
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableWorkoutsDays(vaultRoot);
      const duplicated = findWorkoutsRecord(selected, "2026-07-03")?.data
        .workouts as { kind: string; startLocalMs: number }[];
      expect(duplicated).toEqual([
        expect.objectContaining({
          kind: "running",
          source: GARMIN_SOURCE,
          startLocalMs: 18 * 60 * 60 * 1_000,
        }),
        expect.objectContaining({
          kind: "workout",
          source: WHOOP_SOURCE,
          startLocalMs: 18 * 60 * 60 * 1_000 + 60 * 1_000,
        }),
      ]);
      expect(findWorkoutsRecord(selected, "2026-07-02")?.data.workouts)
        .toMatchObject([{ kind: "workout", minutes: 30 }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps the oldest UTC-12 workout stable across UTC midnight", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_rederived_date_cutoff",
      kind: "activity_session",
      occurredAt: "2026-07-01T21:30:00.000Z",
      dayKey: "2026-07-01",
      recordedAt: "2026-07-01T22:30:00.000Z",
      timeZone: "Asia/Tokyo",
      activityType: "running",
      durationMinutes: 30,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-08T23:59:59.999Z"),
    );

    try {
      const assertStableOldestDate = async () => {
        const selected = await readProjectableWorkoutsDays(vaultRoot);
        expect(findWorkoutsRecord(selected, "2026-07-02")).toMatchObject({
          data: {
            calendarClosedThroughDate: "2026-07-07",
            workouts: [{
              kind: "running",
              minutes: 30,
              startLocalMs: 23_400_000,
            }],
          },
          recordKey: "2026-07-02",
        });
      };

      await assertStableOldestDate();
      dateNow.mockReturnValue(Date.parse("2026-07-09T00:00:00.000Z"));
      await assertStableOldestDate();

      dateNow.mockReturnValue(Date.parse("2026-07-09T12:00:00.000Z"));
      const advanced = await readProjectableWorkoutsDays(vaultRoot);
      expect(advanced.map((record) => record.recordKey)).toEqual([
        "2026-07-09",
        "2026-07-08",
        "2026-07-07",
        "2026-07-06",
        "2026-07-05",
        "2026-07-04",
        "2026-07-03",
      ]);
      expect(findWorkoutsRecord(advanced, "2026-07-02")).toBeUndefined();
      expect(advanced.every((record) =>
        "calendarClosedThroughDate" in record.data
        && record.data.calendarClosedThroughDate === "2026-07-08"
      )).toBe(true);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("reads canonical activity sessions with vault-zone fallback and never interventions", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_activity_for_workouts",
        kind: "activity_session",
        occurredAt: "2026-07-03T22:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T22:45:00.000Z",
        activityType: "running",
        durationMinutes: 45,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_intervention_not_workout",
        kind: "intervention_session",
        occurredAt: "2026-07-03T23:30:00.000Z",
        sessionLocalDate: ACTIVITY_DAY.date,
        interventionType: "sauna",
        durationMinutes: 30,
      },
    ], "America/New_York");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const selected = await readProjectableWorkoutsDays(vaultRoot);
      expect(findWorkoutsRecord(
        selected,
        ACTIVITY_DAY.date,
      )?.data.workouts).toEqual([{
        kind: "running",
        minutes: 45,
        source: MURPH_SOURCE,
        startLocalMs: 18 * 60 * 60 * 1_000,
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("omits workouts when neither an event nor vault timezone validates", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_activity_without_timezone",
      kind: "activity_session",
      occurredAt: "2026-07-03T22:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T22:45:00.000Z",
      activityType: "running",
      durationMinutes: 45,
    }]);
    await rm(join(vaultRoot, "vault.json"));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableWorkoutsDays(vaultRoot)).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
describe("selectProjectableActivityMinutesDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningSpec = requireActivityMinutesSpec(RUNNING_SCOPE);

  it("maps structured activity sessions to activity-specific daily minute records", () => {
    const selected = selectProjectableActivityMinutesDays({
      currentDate: utcDateKey(nowMs),
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
        projectionKind: "activity-minutes-days.v1",
        projectionScope: RUNNING_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("does not count durationless sessions as activity-minute records", () => {
    const selected = selectProjectableActivityMinutesDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          recordIds: ["evt_run_no_duration"],
        }),
      ],
      spec: runningSpec,
    });

    expect(selected).toEqual([]);
  });

  it("drops exact duplicate activity sessions before scoring a day", () => {
    const selected = selectProjectableActivityMinutesDays({
      currentDate: utcDateKey(nowMs),
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
      currentDate: utcDateKey(nowMs),
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

  it("deduplicates overlapping provider copies with rounded duration drift", () => {
    const selected = selectProjectableActivityMinutesDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          endedAt: "2026-07-03T07:40:00.000Z",
          recordIds: ["evt_garmin_run"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          durationMinutes: 41,
          endedAt: "2026-07-03T07:41:30.000Z",
          recordIds: ["evt_strava_run"],
          startedAt: "2026-07-03T07:00:30.000Z",
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
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("reads sauna minutes from canonical intervention sessions", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_sauna_1",
      kind: "intervention_session",
      occurredAt: "2026-07-03T18:00:00.000Z",
      sessionLocalDate: ACTIVITY_DAY.date,
      interventionType: "sauna",
      durationMinutes: 20,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        requireActivityMinutesSpec(SAUNA_SCOPE),
      )).resolves.toEqual([{
        data: {
          activityKind: "sauna",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionMinutes: 20,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("fails exact activity scopes closed when a relevant source cannot be tagged", async () => {
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_resolved_run",
        kind: "activity_session",
        occurredAt: "2026-07-03T07:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T08:00:00.000Z",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-activity",
          resourceId: "resolved-run",
        },
        activityType: "running",
        distanceKm: 5,
        durationMinutes: 40,
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_unresolved_run",
        kind: "activity_session",
        occurredAt: "2026-07-03T09:00:00.000Z",
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T10:00:00.000Z",
        source: "device",
        externalRef: {
          system: "junction",
          resourceType: "activity",
          resourceId: "unresolved-run",
        },
        activityType: "running",
        distanceKm: 4,
        durationMinutes: 30,
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(vaultRoot, runningSpec))
        .resolves.toEqual([]);
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE),
      )).resolves.toEqual([]);
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps scheduled activity and intervention records under the Murph source", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "vault-share-scheduled-source-"));
    await initializeVault({ vaultRoot });
    const activity = await upsertScheduledLog({
      action: {
        activityType: "running",
        durationMinutes: 30,
        kind: "activity_session.add",
        title: "Scheduled run",
      },
      body: "Write the scheduled activity.",
      schedule: { everyMs: 3_600_000, kind: "every" },
      scheduledLogId: "slog_01JX8V5QY2M5ZBV64ZP4N1DRB5",
      slug: "scheduled-run",
      status: "active",
      title: "Scheduled run",
      vaultRoot,
    });
    const intervention = await upsertScheduledLog({
      action: {
        durationMinutes: 10,
        interventionType: "sauna",
        kind: "intervention_session.add",
        title: "Scheduled sauna",
      },
      body: "Write the scheduled intervention.",
      schedule: { everyMs: 3_600_000, kind: "every" },
      scheduledLogId: "slog_01JX8V6QY2M5ZBV64ZP4N1DRB6",
      slug: "scheduled-sauna",
      status: "active",
      title: "Scheduled sauna",
      vaultRoot,
    });
    await executeScheduledLogOccurrence({
      occurrenceAt: "2026-07-03T07:00:00.000Z",
      scheduledLogId: activity.record.scheduledLogId,
      vaultRoot,
    });
    await executeScheduledLogOccurrence({
      occurrenceAt: "2026-07-03T08:00:00.000Z",
      scheduledLogId: intervention.record.scheduledLogId,
      vaultRoot,
    });
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const running = await readProjectableActivityMinutesDays(
        vaultRoot,
        runningSpec,
      );
      const sauna = await readProjectableActivityMinutesDays(
        vaultRoot,
        requireActivityMinutesSpec(SAUNA_SCOPE),
      );
      const workouts = await readProjectableWorkoutsDays(vaultRoot);

      expect(running).toEqual([expect.objectContaining({
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
      })]);
      expect(sauna).toEqual([expect.objectContaining({
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
      })]);
      expect(findWorkoutsRecord(workouts, ACTIVITY_DAY.date)?.data.workouts)
        .toEqual([expect.objectContaining({ source: MURPH_SOURCE })]);
      expect(JSON.stringify({ running, sauna, workouts }))
        .not.toContain("murph-scheduled-log");
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("applies the source cap to the requested activity kind only", async () => {
    const activityRecord = (input: {
      activityKind: "running" | "walking";
      index: number;
    }) => ({
      schemaVersion: "murph.event.v1",
      id: `evt_${input.activityKind}_${input.index}`,
      kind: "activity_session",
      occurredAt: new Date(
        Date.parse("2026-07-03T07:00:00.000Z") + input.index * 60_000,
      ).toISOString(),
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T20:00:00.000Z",
      source: "device",
      externalRef: {
        system: "junction",
        resourceType: `junction-source-${input.index}-activity`,
        resourceId: `${input.activityKind}-${input.index}`,
      },
      activityType: input.activityKind,
      distanceKm: 1 + input.index,
      durationMinutes: 20 + input.index,
    });
    const unrelatedVaultRoot = await createActivitySessionVault([
      activityRecord({ activityKind: "running", index: 20 }),
      ...Array.from({ length: 9 }, (_, index) =>
        activityRecord({ activityKind: "walking", index })),
    ]);
    const exactBoundVaultRoot = await createActivitySessionVault(
      Array.from({ length: 8 }, (_, index) =>
        activityRecord({ activityKind: "running", index })),
    );
    const overBoundVaultRoot = await createActivitySessionVault(
      Array.from({ length: 9 }, (_, index) =>
        activityRecord({ activityKind: "running", index })),
    );
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        unrelatedVaultRoot,
        runningSpec,
      )).resolves.toHaveLength(1);
      await expect(readProjectableActivityMinutesDays(
        exactBoundVaultRoot,
        runningSpec,
      )).resolves.toHaveLength(8);
      await expect(readProjectableActivityMinutesDays(
        overBoundVaultRoot,
        runningSpec,
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(unrelatedVaultRoot, { recursive: true, force: true });
      await rm(exactBoundVaultRoot, { recursive: true, force: true });
      await rm(overBoundVaultRoot, { recursive: true, force: true });
    }
  });

  it("fails every exact activity scope closed for a sparse ninth source after 56 records", async () => {
    const vaultRoot = await createActivitySessionVault(
      sparseNinthSourceActivityRecords(),
    );
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-08T12:00:00.000Z"),
    );

    try {
      await expect(readProjectableActivityMinutesDays(vaultRoot, runningSpec))
        .resolves.toEqual([]);
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE),
      )).resolves.toEqual([]);
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
      )).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps activity-minute reads bounded to query projection entities", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/vault-share-projection.ts", import.meta.url),
      "utf8",
    );
    const readerStart = source.indexOf("async function readProjectableActivitySessionRows");
    const readerEnd = source.indexOf("function toActivitySessionProjectionRow");

    expect(readerStart).toBeGreaterThanOrEqual(0);
    expect(readerEnd).toBeGreaterThan(readerStart);
    const activitySessionReader = source.slice(readerStart, readerEnd);

    expect(activitySessionReader).toContain("listCanonicalEntities");
    expect(activitySessionReader).toContain('family: "event"');
    expect(activitySessionReader).toContain('from: cutoffDate');
    expect(activitySessionReader).toContain("ACTIVITY_SESSION_SOURCE_ROW_QUERY_LIMIT");
    expect(activitySessionReader).toContain("entities.length > ACTIVITY_SESSION_SOURCE_ROW_LIMIT");
    expect(activitySessionReader).toContain(
      "return { complete: false, rows: [] }",
    );
    expect(activitySessionReader).toContain('"activity_session"');
    expect(activitySessionReader).toContain('"intervention_session"');
    expect(activitySessionReader).not.toContain("limit: null");
    expect(activitySessionReader).not.toContain("readVault(");
  });

  it("fails closed when activity-session source rows exceed the read cap", async () => {
    const startMs = Date.parse("2026-07-03T07:00:00.000Z");
    const vaultRoot = await createActivitySessionVault(Array.from(
      { length: 501 },
      (_, index) => ({
        schemaVersion: "murph.event.v1",
        id: `evt_run_overflow_${index}`,
        kind: "activity_session",
        occurredAt: new Date(startMs + index * 60_000).toISOString(),
        dayKey: ACTIVITY_DAY.date,
        recordedAt: "2026-07-03T20:00:00.000Z",
        startAt: new Date(startMs + index * 60_000).toISOString(),
        endAt: new Date(startMs + index * 60_000 + 30 * 60_000).toISOString(),
        activityType: "running",
        distanceKm: 5,
        durationMinutes: 30,
      }),
    ));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityMinutesDays(
        vaultRoot,
        runningSpec,
      )).resolves.toEqual([]);
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE),
      )).resolves.toEqual([]);
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
      )).resolves.toEqual([]);
      await expect(readProjectableWorkoutsDays(vaultRoot)).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("projects active scopes in the production active-kinds order", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_run_active_kinds_order_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:40:00.000Z",
      activityType: "running",
      distanceKm: 5,
      durationMinutes: 40,
      workout: {
        heartRateZones: [{ durationMinutes: 8, label: "Zone 5", zone: 5 }],
      },
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const deliver = vi.fn(async (_request: HostedVaultShareDeliverRequest) => ({
      status: "delivered" as const,
    }));
    const activeScopes = [
      WORKOUTS_SCOPE,
      RUNNING_SCOPE,
      RUNNING_DISTANCE_SCOPE,
      RUNNING_SESSION_COUNT_SCOPE,
    ].sort((left, right) =>
      buildHostedVaultShareProjectionScopeKey(left).localeCompare(
        buildHostedVaultShareProjectionScopeKey(right),
      )
    );

    try {
      await expect(offerHostedVaultShareProjectionBestEffort({
        vaultRoot,
        vaultSharePort: {
          deliver,
          listActiveProjectionScopes: async () => activeProjectionResponse(...activeScopes),
        },
      })).resolves.toEqual({ outcome: "delivered" });
      expect(deliver).toHaveBeenCalledTimes(4);
      expect(deliver.mock.calls.map(
        (call: readonly [HostedVaultShareDeliverRequest]) =>
          call[0].projectionScope,
      )).toEqual([
        RUNNING_DISTANCE_SCOPE,
        RUNNING_SCOPE,
        RUNNING_SESSION_COUNT_SCOPE,
        WORKOUTS_SCOPE,
      ]);
      expect(deliver.mock.calls[0]?.[0].records).toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionDistanceMeters: 5_000,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
      expect(deliver.mock.calls[1]?.[0].records).toMatchObject([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionMinutes: 40,
        },
      }]);
      expect(deliver.mock.calls[2]?.[0].records).toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
      expect(findWorkoutsRecord(
        deliver.mock.calls[3]?.[0].records ?? [],
        ACTIVITY_DAY.date,
      )).toMatchObject({
        data: {
          date: ACTIVITY_DAY.date,
          workouts: [{
            kind: "running",
            minutes: 40,
            source: MURPH_SOURCE,
            startLocalMs: 7 * 60 * 60 * 1_000,
          }],
        },
      });
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableActivityDistanceDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningDistanceSpec = requireActivityDistanceSpec(RUNNING_DISTANCE_SCOPE);

  it("limits an eight-date source set to the seven dates disclosed by consent", () => {
    const boundaryNowMs = Date.parse("2026-07-08T12:00:00.000Z");
    const dates = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ];

    const selected = selectProjectableActivityDistanceDays({
      currentDate: utcDateKey(boundaryNowMs),
      rows: dates.map((date, index) => activitySessionRow({
        activityKind: "running",
        date,
        distanceMeters: 1_000 + index,
        durationMinutes: 30,
        recordIds: [`evt_run_distance_${index}`],
        startedAt: `${date}T07:00:00.000Z`,
      })),
      spec: runningDistanceSpec,
    });

    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-07-08",
      "2026-07-07",
      "2026-07-06",
      "2026-07-05",
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
    ]);
  });

  it.each([
    {
      expectedDates: ["2026-07-27", "2026-07-25", "2026-07-23", "2026-07-21"],
      label: "UTC+14 excludes a sparse eighth local date",
      nowMs: Date.parse("2026-07-26T10:15:00.000Z"),
      timeZone: "Pacific/Kiritimati",
    },
    {
      expectedDates: ["2026-07-27", "2026-07-25", "2026-07-23", "2026-07-21"],
      label: "UTC-12 retains the oldest valid local date",
      nowMs: Date.parse("2026-07-28T11:45:00.000Z"),
      timeZone: "Etc/GMT+12",
    },
    {
      expectedDates: ["2026-07-27", "2026-07-25", "2026-07-23", "2026-07-21"],
      label: "Chicago retains its local date before UTC midnight",
      nowMs: Date.parse("2026-07-28T04:30:00.000Z"),
      timeZone: "America/Chicago",
    },
  ])("uses the validated vault timezone when $label", async ({
    expectedDates,
    nowMs: boundaryNowMs,
    timeZone,
  }) => {
    const dates = ["2026-07-27", "2026-07-25", "2026-07-23", "2026-07-21", "2026-07-20"];
    const vaultRoot = await createActivitySessionVault(
      dates.map((date, index) => ({
        activityType: "running",
        dayKey: date,
        distanceKm: 5,
        durationMinutes: 30,
        id: `evt_local_window_${index}`,
        kind: "activity_session",
        occurredAt: `${date}T07:00:00.000Z`,
        recordedAt: `${date}T08:00:00.000Z`,
        schemaVersion: "murph.event.v1",
        startAt: `${date}T07:00:00.000Z`,
      })),
      timeZone,
    );
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(boundaryNowMs);

    try {
      const selected = await readProjectableActivityDistanceDays(
        vaultRoot,
        runningDistanceSpec,
      );
      expect(selected.map((record) => record.recordKey)).toEqual(
        expectedDates.map((date) => `${date}.murph`),
      );
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("maps activity-session distance to activity-specific daily distance records", () => {
    const selected = selectProjectableActivityDistanceDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          distanceMeters: 5_000,
          durationMinutes: 40,
          recordIds: ["evt_run_1"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "run",
          date: ACTIVITY_DAY.date,
          distanceMeters: 3_400,
          durationMinutes: 35,
          recordIds: ["evt_run_2"],
          startedAt: "2026-07-03T17:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "walking",
          date: ACTIVITY_DAY.date,
          distanceMeters: 2_000,
          durationMinutes: 30,
          recordIds: ["evt_walk_1"],
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
          sessionDistanceMeters: 8_400,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-distance-days.v1",
        projectionScope: RUNNING_DISTANCE_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("does not infer distance when matching sessions have no canonical distance", () => {
    const selected = selectProjectableActivityDistanceDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_no_distance"],
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([]);
  });

  it("preserves distance when duplicate matching session rows disagree on distance", () => {
    const selected = selectProjectableActivityDistanceDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          distanceMeters: 5_000,
          durationMinutes: 40,
          recordIds: ["evt_run_with_distance"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          endedAt: "2026-07-03T07:40:00.000Z",
          recordIds: ["evt_run_without_distance"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningDistanceSpec,
    });

    expect(selected).toEqual([{
      data: {
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        sessionCount: 1,
        sessionDistanceMeters: 5_000,
      },
      occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
      recordKey: ACTIVITY_DAY.date,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
  });

  it("skips a distance day when any matching same-day session lacks distance", () => {
    const rows = [
      activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        distanceMeters: 5_000,
        durationMinutes: 40,
        recordIds: ["evt_run_with_distance"],
        startedAt: "2026-07-03T07:00:00.000Z",
      }),
      activitySessionRow({
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        durationMinutes: 35,
        recordIds: ["evt_run_no_distance"],
        startedAt: "2026-07-03T17:00:00.000Z",
      }),
    ];

    expect(selectProjectableActivityDistanceDays({
      currentDate: utcDateKey(nowMs),
      rows,
      spec: runningDistanceSpec,
    })).toEqual([]);
    expect(selectProjectableActivitySessionCountDays({
      currentDate: utcDateKey(nowMs),
      rows,
      spec: requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE),
    })).toEqual([{
      data: {
        activityKind: "running",
        date: ACTIVITY_DAY.date,
        sessionCount: 2,
      },
      occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
      recordKey: ACTIVITY_DAY.date,
      sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
    }]);
  });

  it("reads canonical distanceKm from activity-session vault entities", async () => {
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_distance_run_1",
      kind: "activity_session",
      occurredAt: "2026-07-03T07:00:00.000Z",
      dayKey: ACTIVITY_DAY.date,
      recordedAt: "2026-07-03T08:00:00.000Z",
      startAt: "2026-07-03T07:00:00.000Z",
      endAt: "2026-07-03T07:42:00.000Z",
      activityType: "running",
      distanceKm: 8.4,
      durationMinutes: 42,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivityDistanceDays(
        vaultRoot,
        runningDistanceSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
          sessionDistanceMeters: 8_400,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});

describe("selectProjectableActivitySessionCountDays", () => {
  const nowMs = Date.parse("2026-07-04T00:00:00.000Z");
  const runningSessionCountSpec =
    requireActivitySessionCountSpec(RUNNING_SESSION_COUNT_SCOPE);

  it("limits an eight-date source set to the seven dates disclosed by consent", () => {
    const boundaryNowMs = Date.parse("2026-07-08T12:00:00.000Z");
    const dates = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ];

    const selected = selectProjectableActivitySessionCountDays({
      currentDate: utcDateKey(boundaryNowMs),
      rows: dates.map((date, index) => activitySessionRow({
        activityKind: "running",
        date,
        durationMinutes: 30,
        recordIds: [`evt_run_count_${index}`],
        startedAt: `${date}T07:00:00.000Z`,
      })),
      spec: runningSessionCountSpec,
    });

    expect(selected.map((record) => record.recordKey)).toEqual([
      "2026-07-08",
      "2026-07-07",
      "2026-07-06",
      "2026-07-05",
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
    ]);
  });

  it("maps activity sessions to activity-specific daily count records", () => {
    const selected = selectProjectableActivitySessionCountDays({
      currentDate: utcDateKey(nowMs),
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
      spec: runningSessionCountSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 2,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "activity-session-count-days.v1",
        projectionScope: RUNNING_SESSION_COUNT_SCOPE,
        records: selected,
      }).records,
    ).toEqual(selected);
  });

  it("deduplicates count rows when one copy omits duration", () => {
    const selected = selectProjectableActivitySessionCountDays({
      currentDate: utcDateKey(nowMs),
      rows: [
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          durationMinutes: 40,
          recordIds: ["evt_run_duration"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
        activitySessionRow({
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          recordIds: ["evt_run_no_duration"],
          startedAt: "2026-07-03T07:00:00.000Z",
        }),
      ],
      spec: runningSessionCountSpec,
    });

    expect(selected).toEqual([
      {
        data: {
          activityKind: "running",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: ACTIVITY_DAY.date,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("counts canonical intervention sessions without requiring duration", async () => {
    const saunaSessionCountSpec = requireActivitySessionCountSpec(
      buildHostedVaultShareActivitySessionCountProjectionScope({
        activityKind: "sauna",
      }),
    );
    const vaultRoot = await createActivitySessionVault([{
      schemaVersion: "murph.event.v1",
      id: "evt_sauna_count_1",
      kind: "intervention_session",
      occurredAt: "2026-07-03T18:00:00.000Z",
      sessionLocalDate: ACTIVITY_DAY.date,
      interventionType: "sauna",
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        saunaSessionCountSpec,
      )).resolves.toEqual([{
        data: {
          activityKind: "sauna",
          date: ACTIVITY_DAY.date,
          sessionCount: 1,
        },
        occurredAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        recordKey: `${ACTIVITY_DAY.date}.murph`,
        source: MURPH_SOURCE,
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      }]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("does not count missed or skipped intervention sessions", async () => {
    const saunaSessionCountSpec = requireActivitySessionCountSpec(
      buildHostedVaultShareActivitySessionCountProjectionScope({
        activityKind: "sauna",
      }),
    );
    const vaultRoot = await createActivitySessionVault([
      {
        schemaVersion: "murph.event.v1",
        id: "evt_sauna_missed",
        kind: "intervention_session",
        occurredAt: "2026-07-03T18:00:00.000Z",
        sessionLocalDate: ACTIVITY_DAY.date,
        interventionType: "sauna",
        sessionStatus: "missed",
      },
      {
        schemaVersion: "murph.event.v1",
        id: "evt_sauna_skipped",
        kind: "intervention_session",
        occurredAt: "2026-07-03T19:00:00.000Z",
        sessionLocalDate: ACTIVITY_DAY.date,
        interventionType: "sauna",
        sessionStatus: "skipped",
      },
    ]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      await expect(readProjectableActivitySessionCountDays(
        vaultRoot,
        saunaSessionCountSpec,
      )).resolves.toEqual([]);
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
        sourceFamily: "derived" as const,
        sourceKind: "activity-summary",
        statistic: "value",
        value: 24,
      },
    ], utcDateKey(nowMs));

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

  it("fails the whole scope above the payload-safe zone and label bounds", () => {
    const points = Array.from(
      { length: HOSTED_VAULT_SHARE_HEART_RATE_ZONES_MAX_PER_DAY },
      (_, zone) => ({
        context: {
          zoneLabel: "x".repeat(
            HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH,
          ),
        },
        date: ACTIVITY_DAY.date,
        grain: "day" as const,
        metricKey: `heart-rate-zone-${zone}-minutes`,
        observedAt: `${ACTIVITY_DAY.date}T00:00:00.000Z`,
        pointIds: [`point_zone_${zone}`],
        recordIds: [`evt_zone_${zone}`],
        source: GARMIN_SOURCE,
        sourceFamily: "derived" as const,
        sourceKind: "activity-summary",
        statistic: "value" as const,
        value: 24,
      }),
    );

    expect(selectProjectableHeartRateZoneDays(points, utcDateKey(nowMs)))
      .toHaveLength(1);
    expect(selectProjectableHeartRateZoneDays([
      ...points,
      {
        ...points[0]!,
        metricKey: points[0]!.metricKey,
        pointIds: ["point_zone_over_bound"],
        recordIds: ["evt_zone_over_bound"],
      },
    ], utcDateKey(nowMs))).toEqual([]);
    expect(selectProjectableHeartRateZoneDays([{
      ...points[0]!,
      context: {
        zoneLabel: "x".repeat(
          HOSTED_VAULT_SHARE_HEART_RATE_ZONE_LABEL_MAX_LENGTH + 1,
        ),
      },
    }], utcDateKey(nowMs))).toEqual([]);
  });

  it("fails closed when sparse zone subseries contain a ninth public source", async () => {
    const exactBoundVaultRoot = await createActivitySessionVault(
      sparseNinthSourceActivityRecords({
        includeSparseNinthSource: false,
      }),
    );
    const overBoundVaultRoot = await createActivitySessionVault(
      sparseNinthSourceActivityRecords(),
    );
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-08T12:00:00.000Z"),
    );

    try {
      const exactBound = await readProjectableHeartRateZoneDays(
        exactBoundVaultRoot,
      );
      expect(exactBound).toHaveLength(56);
      expect(new Set(exactBound.map((record) => record.source?.source)).size)
        .toBe(8);
      await expect(readProjectableHeartRateZoneDays(overBoundVaultRoot))
        .resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(exactBoundVaultRoot, { recursive: true, force: true });
      await rm(overBoundVaultRoot, { recursive: true, force: true });
    }
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

function requireActivityDistanceSpec(
  kind: Parameters<typeof getHostedVaultShareActivityDistanceProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivityDistanceProjectionSpec(kind);
  if (!spec) {
    throw new Error("Missing activity distance projection spec.");
  }
  return spec;
}

function requireActivitySessionCountSpec(
  kind: Parameters<typeof getHostedVaultShareActivitySessionCountProjectionSpec>[0],
) {
  const spec = getHostedVaultShareActivitySessionCountProjectionSpec(kind);
  if (!spec) {
    throw new Error("Missing activity session count projection spec.");
  }
  return spec;
}

describe("selectProjectableSleepNights", () => {
  const nowMs = Date.parse("2026-06-10T00:00:00.000Z");

  it("fails the sleep scope closed when a relevant source cannot be tagged", async () => {
    const vaultRoot = await createSleepSourceProjectionVault([{
      date: ACTIVITY_DAY.date,
      providers: ["garmin", "unknown"],
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-04T00:00:00.000Z"),
    );

    try {
      await expect(readProjectableSleepNights(vaultRoot)).resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("accepts exactly eight sleep sources and fails closed at nine", async () => {
    const providers = Array.from({ length: 9 }, (_, index) => `source-${index}`);
    const exactBoundVaultRoot = await createSleepSourceProjectionVault([{
      date: ACTIVITY_DAY.date,
      providers: providers.slice(0, 8),
    }]);
    const overBoundVaultRoot = await createSleepSourceProjectionVault([{
      date: ACTIVITY_DAY.date,
      providers,
    }]);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-04T00:00:00.000Z"),
    );

    try {
      await expect(readProjectableSleepNights(exactBoundVaultRoot))
        .resolves.toHaveLength(8);
      await expect(readProjectableSleepNights(overBoundVaultRoot))
        .resolves.toEqual([]);
    } finally {
      dateNow.mockRestore();
      await rm(exactBoundVaultRoot, { recursive: true, force: true });
      await rm(overBoundVaultRoot, { recursive: true, force: true });
    }
  });

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

    const selected = selectProjectableSleepNights(summaries, utcDateKey(nowMs));

    // recordKey is the night date and occurredAt is the night date at UTC midnight, so the
    // dedupe key, vault path, and plaintext mailbox metadata all reduce to the night itself
    // — the exact sleep timestamps travel only inside the encrypted payload.
    expect(selected).toEqual([RECORD]);
    expect(selected[0]?.recordKey).toBe(NIGHT.date);
    expect(selected[0]?.occurredAt).toBe(`${NIGHT.date}T00:00:00.000Z`);
  });

  it("limits an eight-night source set to the seven nights disclosed by consent", () => {
    const boundaryNowMs = Date.parse("2026-07-08T12:00:00.000Z");
    const dates = [
      "2026-07-08",
      "2026-07-07",
      "2026-07-06",
      "2026-07-05",
      "2026-07-04",
      "2026-07-03",
      "2026-07-02",
      "2026-07-01",
    ];

    const selected = selectProjectableSleepNights(
      dates.map((date) => ({
        date,
        sleepEndAt: `${date}T06:00:00.000Z`,
        sleepStartAt: `${date}T00:00:00.000Z`,
      })),
      utcDateKey(boundaryNowMs),
    );

    expect(selected.map((record) => record.recordKey)).toEqual(dates.slice(0, 7));
  });

  it("emits records the hosted-execution deliver-request parser accepts unchanged", () => {
    // Cross-package drift guard: the deliver parser pins occurredAt to the night-date
    // midnight and bounds the sleep window, so a projector that drifts from that contract
    // would make web reject every offer. Pipe real projector output through the real parser.
    const selected = selectProjectableSleepNights([NIGHT], utcDateKey(nowMs));

    expect(selected).toHaveLength(1);
    expect(
      parseHostedVaultShareDeliverRequest({
        projectionKind: "sleep-times.v0",
        projectionScope: SLEEP_SCOPE,
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

    const selected = selectProjectableSleepNights(summaries, utcDateKey(nowMs));

    expect(selected.map((record) => record.recordKey)).toEqual([justInsideDate]);
  });
});


describe("readProjectableProfileName", () => {
  it("delivers the typed memory display name and the parser accepts it unchanged", async () => {
    const vaultRoot = await createMemoryDisplayNameVault("Theo");
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
        projectionScope: PROFILE_SCOPE,
        records,
      })
    ).not.toThrow();

    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(PROFILE_SCOPE),
      },
    });
    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records,
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });
  });

  it("backfills the projection from unambiguous legacy Identity memory", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault("The user's name is Theo.");
    const records = await readProjectableProfileName(vaultRoot);

    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:01.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("falls back to an existing profile-only display name without mutating memory", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Theo");
    const records = await readProjectableProfileName(vaultRoot);

    expect(records).toEqual([
      {
        data: { displayName: "Theo" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual(records);
    await expect(readFile(join(vaultRoot, "bank", "memory.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("falls back to legacy profile when memory exists without display-name evidence", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({
        document: createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
      }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([
      {
        data: { displayName: "Alice" },
        occurredAt: "2026-07-01T00:00:00.000Z",
        recordKey: "profile-name",
        sourceRevision: expect.stringMatching(SOURCE_REVISION_PATTERN),
      },
    ]);
  });

  it("does not fall back to legacy profile when memory display-name evidence is ambiguous", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    let document = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    document = upsertMemoryRecord(document, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Ari"),
    }).document;
    document = upsertMemoryRecord(document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Riley"),
    }).document;
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({ document }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("does not fall back to legacy profile when memory has invalid canonical display-name evidence", async () => {
    const vaultRoot = await createLegacyProfileDisplayNameVault("Alice");
    const document = upsertMemoryRecord(
      createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z")),
      {
        now: new Date("2026-07-01T00:00:01.000Z"),
        section: "Identity",
        text: `Preferred display name: ${"a".repeat(121)}`,
      },
    ).document;
    await writeFile(
      join(vaultRoot, "bank", "memory.md"),
      renderMemoryDocument({ document }),
      "utf8",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing for compound legacy Identity memory display-name candidates", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault(
      "The user's name is Theo from Seattle.",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing when legacy Identity memory names are ambiguous", async () => {
    const vaultRoot = await createLegacyMemoryDisplayNameVault(
      "The user's name is Theo.",
      "The user goes by Ari.",
    );

    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);
  });

  it("projects nothing when the memory display name is absent", async () => {
    const vaultRoot = await createMemoryDisplayNameVault(null);
    await expect(readProjectableProfileName(vaultRoot)).resolves.toEqual([]);

    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const result = await offerHostedVaultShareProjectionBestEffort({
      vaultRoot,
      vaultSharePort: {
        deliver,
        listActiveProjectionScopes: async () => activeProjectionResponse(PROFILE_SCOPE),
      },
    });
    expect(result.outcome).toBe("delivered");
    expect(deliver).toHaveBeenCalledWith({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: PROFILE_SCOPE,
      records: [],
      sourceWorkspaceVersion: TEST_SOURCE_WORKSPACE_VERSION,
    });
  });
});
