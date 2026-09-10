import { createHash } from "node:crypto";

import * as z from "@murphai/contracts/zod-runtime";

import {
  toLocalDayKey,
  type WorkoutSessionMetrics,
} from "@murphai/contracts";

import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  buildSyntheticDeletionResourceId,
  createEvidencePart,
  emitObservationMetrics,
  finiteNumber,
  kilojoulesToKilocalories,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  minutesBetween,
  pushDeletionObservation as pushSharedDeletionObservation,
  pushEvidencePart,
  slugify,
  stringId,
  toIso,
  trimToLength,
} from "./shared-normalization.ts";

import type {
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceEvidencePartPayload,
} from "../core-port.ts";
import type {
  ObservationMetricDescriptor,
  PlainObject,
} from "./shared-normalization.ts";
import type {
  DeviceProviderAdapter,
  DeviceProviderNormalizationContext,
  NormalizedDeviceBatch,
} from "./types.ts";
import { WHOOP_DEVICE_PROVIDER_DESCRIPTOR } from "./provider-descriptors.ts";

export interface WhoopSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  profile?: unknown;
  bodyMeasurement?: unknown;
  bodyMeasurements?: unknown;
  cycles?: unknown[];
  recoveries?: unknown[];
  sleeps?: unknown[];
  workouts?: unknown[];
  deletions?: unknown[];
}

const whoopCollectionSchema = z.array(z.unknown());

const whoopSnapshotSchema = z.object({
  accountId: z.union([z.string(), z.number()]).optional(),
  importedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  profile: z.unknown().optional(),
  bodyMeasurement: z.unknown().optional(),
  bodyMeasurements: z.unknown().optional(),
  cycles: whoopCollectionSchema.optional(),
  recoveries: whoopCollectionSchema.optional(),
  sleeps: whoopCollectionSchema.optional(),
  workouts: whoopCollectionSchema.optional(),
  deletions: whoopCollectionSchema.optional(),
}).catchall(z.unknown());

function parseWhoopSnapshot(snapshot: unknown): WhoopSnapshotInput {
  return whoopSnapshotSchema.parse(snapshot);
}

function sanitizeWhoopRawSnapshot(snapshot: WhoopSnapshotInput): unknown {
  const source = asPlainObject(snapshot);
  if (!source) {
    return source;
  }

  const sanitized: PlainObject = { ...source };
  delete sanitized.importedAt;
  return sanitized;
}

function makeExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef("whoop", resourceType, resourceId, version, facet);
}

function shortHash(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 16);
}

function bodyMeasurementAccountScope(accountId: string | undefined): string | undefined {
  return accountId ? shortHash(["whoop", "body-measurement", accountId]) : undefined;
}

function bodyMeasurementDayResourceId(dayKey: string, accountScope: string | undefined): string {
  return accountScope ? `account:${accountScope}/date:${dayKey}` : `date:${dayKey}`;
}

function bodyMeasurementCurrentResourceId(accountScope: string | undefined): string {
  return accountScope ? `account:${accountScope}/current` : "current";
}

function cycleOrFallbackTimestamp(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
}

function whoopRecordTimestamps(record: PlainObject, importedAt: string) {
  const startAt = toIso(record.start);
  const endAt = toIso(record.end);
  const version = toIso(record.updated_at);
  const recordedAt = cycleOrFallbackTimestamp(version, endAt, startAt, importedAt);
  return { startAt, endAt, version, recordedAt };
}

function firstDayKey(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(candidate.trim());

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function parseWhoopTimezoneOffsetMinutes(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "Z") {
    return 0;
  }

  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const [, sign, hoursText, minutesText] = match;
  if (!sign || !hoursText || !minutesText) {
    return undefined;
  }

  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);

  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  const offsetMinutes = hours * 60 + minutes;
  return sign === "-" ? -offsetMinutes : offsetMinutes;
}

function whoopTimezoneOffsetMinutes(source: PlainObject | undefined): number | undefined {
  return parseWhoopTimezoneOffsetMinutes(source?.timezone_offset ?? source?.timezoneOffset);
}

function offsetDayKey(candidate: string | undefined, offsetMinutes: number): string | undefined {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return undefined;
  }

  const iso = toIso(candidate);
  if (!iso) {
    return undefined;
  }

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function firstWhoopLocalDayKey(
  offsetSource: PlainObject | undefined,
  ...candidates: Array<string | undefined>
): string | undefined {
  return firstWhoopOffsetDayKey(whoopTimezoneOffsetMinutes(offsetSource), ...candidates);
}

function firstWhoopOffsetDayKey(
  offsetMinutes: number | undefined,
  ...candidates: Array<string | undefined>
): string | undefined {
  if (offsetMinutes === undefined) {
    return undefined;
  }

  for (const candidate of candidates) {
    const dayKey = offsetDayKey(candidate, offsetMinutes);

    if (dayKey) {
      return dayKey;
    }
  }

  return undefined;
}

function firstVaultLocalDayKey(
  defaultTimeZone: string | undefined,
  ...candidates: Array<string | undefined>
): string | undefined {
  if (!defaultTimeZone) {
    return undefined;
  }

  for (const candidate of candidates) {
    const iso = toIso(candidate);
    if (!iso) {
      continue;
    }

    try {
      return toLocalDayKey(iso, defaultTimeZone);
    } catch {
      continue;
    }
  }

  return undefined;
}

function millisecondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return numeric / 60000;
}

function firstBodyMeasurementMeasuredAt(bodyMeasurement: PlainObject): string | undefined {
  return cycleOrFallbackTimestamp(
    toIso(bodyMeasurement.measured_at),
    toIso(bodyMeasurement.measuredAt),
    toIso(bodyMeasurement.recorded_at),
    toIso(bodyMeasurement.recordedAt),
  );
}

function firstBodyMeasurementUpdatedAt(bodyMeasurement: PlainObject): string | undefined {
  return cycleOrFallbackTimestamp(
    toIso(bodyMeasurement.updated_at),
    toIso(bodyMeasurement.updatedAt),
  );
}

function firstBodyMeasurementExplicitDayKey(bodyMeasurement: PlainObject): string | undefined {
  return firstDayKey(
    stringId(bodyMeasurement.day),
    stringId(bodyMeasurement.date),
    stringId(bodyMeasurement.measurement_day ?? bodyMeasurement.measurementDay),
    stringId(bodyMeasurement.measured_date ?? bodyMeasurement.measuredDate),
    stringId(bodyMeasurement.recorded_date ?? bodyMeasurement.recordedDate),
  );
}

function calculateBodyMassIndex(bodyMeasurement: PlainObject): number | undefined {
  const weightKilograms = finiteNumber(bodyMeasurement.weight_kilogram ?? bodyMeasurement.weightKilogram);
  const heightMeters = finiteNumber(bodyMeasurement.height_meter ?? bodyMeasurement.heightMeter);

  if (weightKilograms === undefined || heightMeters === undefined || heightMeters <= 0) {
    return undefined;
  }

  return Number((weightKilograms / (heightMeters * heightMeters)).toFixed(4));
}

interface WhoopBodyMeasurementMetricSource {
  measurement: PlainObject;
  bmi?: number;
}

const WHOOP_SLEEP_OBSERVATION_METRICS: readonly ObservationMetricDescriptor<PlainObject | undefined>[] = [
  {
    metric: "respiratory-rate",
    value: (score) => score?.respiratory_rate,
    unit: "breaths_per_minute",
    title: "WHOOP respiratory rate",
    facet: "respiratory-rate",
  },
  {
    metric: "sleep-performance",
    value: (score) => score?.sleep_performance_percentage,
    unit: "%",
    title: "WHOOP sleep performance",
    facet: "sleep-performance",
  },
  {
    metric: "sleep-consistency",
    value: (score) => score?.sleep_consistency_percentage,
    unit: "%",
    title: "WHOOP sleep consistency",
    facet: "sleep-consistency",
  },
  {
    metric: "sleep-efficiency",
    value: (score) => score?.sleep_efficiency_percentage,
    unit: "%",
    title: "WHOOP sleep efficiency",
    facet: "sleep-efficiency",
  },
];

const WHOOP_SLEEP_STAGE_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "sleep-awake-minutes",
    value: (stageSummary) => stageSummary.total_awake_time_milli,
    transform: millisecondsToMinutes,
    unit: "minutes",
    title: "WHOOP awake time",
    facet: "sleep-awake-minutes",
  },
  {
    metric: "sleep-light-minutes",
    value: (stageSummary) => stageSummary.total_light_sleep_time_milli,
    transform: millisecondsToMinutes,
    unit: "minutes",
    title: "WHOOP light sleep",
    facet: "sleep-light-minutes",
  },
  {
    metric: "sleep-deep-minutes",
    value: (stageSummary) => stageSummary.total_slow_wave_sleep_time_milli,
    transform: millisecondsToMinutes,
    unit: "minutes",
    title: "WHOOP deep sleep",
    facet: "sleep-deep-minutes",
  },
  {
    metric: "sleep-rem-minutes",
    value: (stageSummary) => stageSummary.total_rem_sleep_time_milli,
    transform: millisecondsToMinutes,
    unit: "minutes",
    title: "WHOOP REM sleep",
    facet: "sleep-rem-minutes",
  },
];

const WHOOP_RECOVERY_OBSERVATION_METRICS: readonly ObservationMetricDescriptor<PlainObject | undefined>[] = [
  {
    metric: "recovery-score",
    value: (score) => score?.recovery_score,
    unit: "%",
    title: "WHOOP recovery score",
    facet: "recovery-score",
  },
  {
    metric: "resting-heart-rate",
    value: (score) => score?.resting_heart_rate,
    unit: "bpm",
    title: "WHOOP resting heart rate",
    facet: "resting-heart-rate",
  },
  {
    metric: "spo2",
    value: (score) => score?.spo2_percentage,
    unit: "%",
    title: "WHOOP SpO2",
    facet: "spo2",
  },
  {
    metric: "hrv",
    value: (score) => score?.hrv_rmssd_milli,
    unit: "ms",
    title: "WHOOP HRV",
    facet: "hrv",
  },
  {
    metric: "temperature",
    value: (score) => score?.skin_temp_celsius,
    unit: "celsius",
    title: "WHOOP skin temperature",
    facet: "skin-temperature",
  },
];

const WHOOP_CYCLE_OBSERVATION_METRICS: readonly ObservationMetricDescriptor<PlainObject | undefined>[] = [
  {
    metric: "day-strain",
    value: (score) => score?.strain,
    unit: "whoop_strain",
    title: "WHOOP day strain",
    facet: "day-strain",
  },
  {
    metric: "energy-burned",
    value: (score) => score?.kilojoule,
    unit: "kJ",
    title: "WHOOP energy burned",
    facet: "energy-burned",
  },
  {
    metric: "average-heart-rate",
    value: (score) => score?.average_heart_rate,
    unit: "bpm",
    title: "WHOOP average heart rate",
    facet: "average-heart-rate",
  },
  {
    metric: "max-heart-rate",
    value: (score) => score?.max_heart_rate,
    unit: "bpm",
    title: "WHOOP max heart rate",
    facet: "max-heart-rate",
  },
];

const WHOOP_BODY_OBSERVATION_METRICS: readonly ObservationMetricDescriptor<WhoopBodyMeasurementMetricSource>[] = [
  {
    metric: "weight",
    value: ({ measurement }) => measurement.weight_kilogram ?? measurement.weightKilogram,
    unit: "kg",
    title: "WHOOP weight",
    facet: "weight",
  },
  {
    metric: "bmi",
    value: ({ bmi }) => bmi,
    unit: "kg_m2",
    title: "WHOOP BMI",
    facet: "bmi",
  },
  {
    metric: "max-heart-rate",
    value: ({ measurement }) => measurement.max_heart_rate ?? measurement.maxHeartRate,
    unit: "bpm",
    title: "WHOOP max heart rate",
    facet: "max-heart-rate",
  },
];

function emitWhoopBodyMeasurement(
  events: DeviceEventPayload[],
  measurement: PlainObject | undefined,
  accountId: string | undefined,
  importedAt: string,
  defaultTimeZone: string | undefined,
): string | undefined {
  if (!measurement) {
    return undefined;
  }

  const explicitDayKey = firstBodyMeasurementExplicitDayKey(measurement);
  const measuredAt = firstBodyMeasurementMeasuredAt(measurement);
  const updatedAt = firstBodyMeasurementUpdatedAt(measurement);
  const accountScope = bodyMeasurementAccountScope(accountId);
  const observedAt = explicitDayKey ? measuredAt : measuredAt ?? updatedAt;
  const recordedAt = measuredAt ?? updatedAt ?? importedAt;
  const occurredAt = observedAt ??
    (explicitDayKey ? `${explicitDayKey}T00:00:00.000Z` : undefined) ?? recordedAt;
  const dayKey = explicitDayKey ??
    firstWhoopLocalDayKey(measurement, recordedAt) ??
    firstVaultLocalDayKey(defaultTimeZone, recordedAt);
  const fallbackDayKey = firstDayKey(observedAt) ?? firstDayKey(recordedAt);
  const resourceDayKey = dayKey ?? fallbackDayKey;
  const resourceId = resourceDayKey
    ? bodyMeasurementDayResourceId(resourceDayKey, accountScope)
    : bodyMeasurementCurrentResourceId(accountScope);
  const legacyDayKey = firstDayKey(measuredAt, updatedAt, importedAt);
  const legacyResourceIds = [
    dayKey ? bodyMeasurementDayResourceId(dayKey, undefined) : undefined,
    fallbackDayKey,
    fallbackDayKey ? bodyMeasurementDayResourceId(fallbackDayKey, undefined) : undefined,
    legacyDayKey,
    legacyDayKey ? bodyMeasurementDayResourceId(legacyDayKey, undefined) : undefined,
  ].filter((legacyId): legacyId is string => Boolean(legacyId) && legacyId !== resourceId);

  emitObservationMetrics(
    events,
    {
      source: { measurement, bmi: calculateBodyMassIndex(measurement) },
      occurredAt,
      recordedAt,
      dayKey,
      observationGrain: "summary",
      evidenceRoles: ["body-measurement"],
      externalRef: (facet) => makeExternalRef("body-measurement", resourceId, undefined, facet),
      legacyExternalRefs: (facet) => [...new Set(legacyResourceIds)]
        .map((legacyId) => makeExternalRef("body-measurement", legacyId, undefined, facet)),
    },
    WHOOP_BODY_OBSERVATION_METRICS,
  );

  return dayKey;
}

function buildWhoopWorkoutMetrics(
  workout: PlainObject,
  score: PlainObject | undefined,
): WorkoutSessionMetrics | undefined {
  return stripEmptyObject(stripUndefined({
    workoutStrain: finiteNumber(score?.strain),
    averageHeartRate: finiteNumber(score?.average_heart_rate),
    maxHeartRate: finiteNumber(score?.max_heart_rate),
    totalCalories: kilojoulesToKilocalories(score?.kilojoule),
    percentRecorded: finiteNumber(score?.percent_recorded),
    totalElevationGainMeters: finiteNumber(workout.altitude_gain_meter),
    altitudeChangeMeters: finiteNumber(workout.altitude_change_meter),
  }));
}

function pushDeletionObservation(
  events: DeviceEventPayload[],
  evidenceParts: DeviceEvidencePartPayload[],
  importedAt: string,
  deletion: PlainObject,
): void {
  const resourceType = slugify(deletion.resource_type ?? deletion.resourceType, "resource");
  const occurredAt = toIso(deletion.occurred_at ?? deletion.occurredAt) ?? importedAt;
  const sourceEventType =
    typeof deletion.source_event_type === "string" && deletion.source_event_type.trim()
      ? deletion.source_event_type.trim()
      : typeof deletion.sourceEventType === "string" && deletion.sourceEventType.trim()
        ? deletion.sourceEventType.trim()
        : undefined;
  const resourceId =
    stringId(deletion.resource_id ?? deletion.resourceId) ??
    buildSyntheticDeletionResourceId({
      provider: "whoop",
      resourceType,
      occurredAt,
      sourceEventType,
      deletion,
    });

  pushSharedDeletionObservation(events, evidenceParts, {
    provider: "whoop",
    providerDisplayName: "WHOOP",
    resourceType,
    resourceId,
    occurredAt,
    sourceEventType,
    makeExternalRef,
  });
}

export function normalizeWhoopSnapshot(
  snapshot: WhoopSnapshotInput,
  context: DeviceProviderNormalizationContext = {},
): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const profile = asPlainObject(request.profile);
  const bodyMeasurement = asPlainObject(request.bodyMeasurements) ?? asPlainObject(request.bodyMeasurement);
  const sleeps = asArray(request.sleeps).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const recoveries = asArray(request.recoveries).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const cycles = asArray(request.cycles).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const workouts = asArray(request.workouts).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const deletions = asArray(request.deletions).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const sleepsById = new Map<string, PlainObject>();
  const cyclesById = new Map<string, PlainObject>();
  const events: DeviceEventPayload[] = [];
  const evidenceParts: DeviceEvidencePartPayload[] = [];
  const accountId =
    stringId(request.accountId) ??
    stringId(profile?.user_id ?? profile?.userId ?? profile?.id);

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id);

    if (sleepId) {
      sleepsById.set(sleepId, sleep);
    }
  }

  for (const cycle of cycles) {
    const cycleId = stringId(cycle.id);

    if (cycleId) {
      cyclesById.set(cycleId, cycle);
    }
  }

  pushEvidencePart(evidenceParts, createEvidencePart("profile", "profile.json", profile));
  pushEvidencePart(evidenceParts, createEvidencePart("body-measurement", "body-measurement.json", bodyMeasurement));
  const bodyMeasurementDayKey = emitWhoopBodyMeasurement(
    events, bodyMeasurement, accountId, importedAt, context.defaultTimeZone,
  );

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id) ?? `sleep-${events.length + 1}`;
    const { startAt, endAt, version, recordedAt } = whoopRecordTimestamps(sleep, importedAt);
    const dayKey = firstWhoopLocalDayKey(sleep, endAt, startAt, recordedAt);
    const occurredAt = dayKey ? startAt ?? recordedAt : endAt ?? startAt ?? recordedAt;
    const durationMinutes = minutesBetween(startAt, endAt);
    const sleepRole = `sleep:${sleepId}`;
    const sleepRef = makeExternalRef("sleep", sleepId, version);
    const score = asPlainObject(sleep.score);
    const stageSummary = asPlainObject(score?.stage_summary);
    const nap = sleep.nap === true;
    const sleepType = sleep.nap === true
      ? "nap" as const
      : sleep.nap === false
        ? "main_sleep" as const
        : undefined;

    pushEvidencePart(
      evidenceParts,
      createEvidencePart(sleepRole, `sleep-${sleepId}.json`, sleep),
    );

    if (occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "sleep_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: nap ? "WHOOP nap" : "WHOOP sleep",
          evidenceRoles: [sleepRole],
          externalRef: sleepRef,
          fields: stripUndefined({
            startAt,
            endAt,
            durationMinutes,
            sleepType,
          }),
        }),
      );
    }

    emitObservationMetrics(
      events,
      {
        source: score,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [sleepRole],
        externalRef: (facet) => makeExternalRef("sleep", sleepId, version, facet),
      },
      WHOOP_SLEEP_OBSERVATION_METRICS,
    );

    if (stageSummary) {
      emitObservationMetrics(
        events,
        {
          source: stageSummary,
          occurredAt,
          recordedAt,
          dayKey,
          observationGrain: "summary",
          evidenceRoles: [sleepRole],
          externalRef: (facet) => makeExternalRef("sleep", sleepId, version, facet),
        },
        WHOOP_SLEEP_STAGE_METRICS,
      );
    }
  }

  for (const recovery of recoveries) {
    const sleepId = stringId(recovery.sleep_id ?? recovery.sleepId);
    const cycleId = stringId(recovery.cycle_id ?? recovery.cycleId);
    const recoveryResourceId = sleepId ?? cycleId ?? `recovery-${events.length + 1}`;
    const recoveryRole = `recovery:${recoveryResourceId}`;
    const version = toIso(recovery.updated_at);
    const recordedAt = cycleOrFallbackTimestamp(toIso(recovery.updated_at), importedAt);
    const recoveryCycle = cycleId ? cyclesById.get(cycleId) : undefined;
    const recoverySleep = sleepId ? sleepsById.get(sleepId) : undefined;
    const recoveryCycleEndAt = toIso(recoveryCycle?.end);
    const recoveryCycleStartAt = toIso(recoveryCycle?.start);
    const recoverySleepEndAt = toIso(recoverySleep?.end);
    const recoverySleepStartAt = toIso(recoverySleep?.start);
    const occurredAt =
      recoveryCycleEndAt
      ?? recoveryCycleStartAt
      ?? recoverySleepEndAt
      ?? recoverySleepStartAt
      ?? recordedAt;
    const dayKey =
      firstWhoopLocalDayKey(recoveryCycle, recoveryCycleEndAt, recoveryCycleStartAt) ??
      firstWhoopLocalDayKey(recoverySleep, recoverySleepEndAt, recoverySleepStartAt) ??
      firstWhoopLocalDayKey(recovery, recordedAt);
    const score = asPlainObject(recovery.score);

    pushEvidencePart(
      evidenceParts,
      createEvidencePart(recoveryRole, `recovery-${recoveryResourceId}.json`, recovery),
    );

    emitObservationMetrics(
      events,
      {
        source: score,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [recoveryRole],
        externalRef: (facet) => makeExternalRef("recovery", recoveryResourceId, version, facet),
      },
      WHOOP_RECOVERY_OBSERVATION_METRICS,
    );
  }

  for (const cycle of cycles) {
    const cycleId = stringId(cycle.id) ?? `cycle-${events.length + 1}`;
    const cycleRole = `cycle:${cycleId}`;
    const { startAt, endAt, version, recordedAt } = whoopRecordTimestamps(cycle, importedAt);
    const occurredAt = endAt ?? startAt ?? recordedAt;
    const dayKey = firstWhoopLocalDayKey(cycle, endAt, startAt, recordedAt);
    const score = asPlainObject(cycle.score);

    pushEvidencePart(
      evidenceParts,
      createEvidencePart(cycleRole, `cycle-${cycleId}.json`, cycle),
    );

    emitObservationMetrics(
      events,
      {
        source: score,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [cycleRole],
        externalRef: (facet) => makeExternalRef("cycle", cycleId, version, facet),
      },
      WHOOP_CYCLE_OBSERVATION_METRICS,
    );
  }

  for (const workout of workouts) {
    const workoutId = stringId(workout.id) ?? `workout-${events.length + 1}`;
    const workoutRole = `workout:${workoutId}`;
    const { startAt, endAt, version, recordedAt } = whoopRecordTimestamps(workout, importedAt);
    const occurredAt = startAt ?? recordedAt;
    const dayKey = firstWhoopOffsetDayKey(whoopTimezoneOffsetMinutes(workout), startAt, recordedAt, endAt);
    const durationMinutes = minutesBetween(startAt, endAt);
    const sportName = typeof workout.sport_name === "string" && workout.sport_name.trim()
      ? workout.sport_name.trim()
      : "Workout";
    const activityType = slugify(sportName, "workout");
    const score = asPlainObject(workout.score);

    pushEvidencePart(
      evidenceParts,
      createEvidencePart(workoutRole, `workout-${workoutId}.json`, workout),
    );

    if (occurredAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: trimToLength(`WHOOP ${sportName}`, 160),
          evidenceRoles: [workoutRole],
          externalRef: makeExternalRef("workout", workoutId, version),
          fields: stripUndefined({
            activityType,
            durationMinutes,
            distanceKm:
              finiteNumber(score?.distance_meter ?? workout.distance_meter) !== undefined
                ? Number(score?.distance_meter ?? workout.distance_meter) / 1000
                : undefined,
            workout: {
              sourceApp: "whoop",
              sourceWorkoutId: workoutId,
              startedAt: startAt,
              endedAt: endAt,
              sessionNote: `WHOOP ${sportName}`,
              metrics: buildWhoopWorkoutMetrics(workout, score),
              exercises: [],
            },
          }),
        }),
      );
    }
  }

  for (const deletion of deletions) {
    pushDeletionObservation(events, evidenceParts, importedAt, deletion);
  }

  const provenance = stripEmptyObject({
    whoopUserId: stringId(profile?.user_id ?? profile?.userId ?? profile?.id),
    bodyMeasurementDay: bodyMeasurementDayKey,
    importedSections: {
      profile: Boolean(profile),
      bodyMeasurement: Boolean(bodyMeasurement),
      sleeps: sleeps.length,
      recoveries: recoveries.length,
      cycles: cycles.length,
      workouts: workouts.length,
      deletions: deletions.length,
    },
  });

  return makeNormalizedDeviceBatch({
    provider: "whoop",
    accountId,
    importedAt,
    events,
    evidenceParts,
    provenance,
  });
}

export const whoopProviderAdapter: DeviceProviderAdapter<WhoopSnapshotInput> = {
  ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseWhoopSnapshot,
  normalizeSnapshot: normalizeWhoopSnapshot,
  sanitizeRawSnapshot: sanitizeWhoopRawSnapshot,
};
