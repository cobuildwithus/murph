import { z } from "zod";

import type { WorkoutSessionMetrics } from "@murphai/contracts";

import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  buildSyntheticDeletionResourceId,
  createRawArtifact,
  emitObservationMetrics,
  finiteNumber,
  kilojoulesToKilocalories,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  minutesBetween,
  pushDeletionObservation as pushSharedDeletionObservation,
  pushRawArtifact,
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
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.ts";
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

function makeExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef("whoop", resourceType, resourceId, version, facet);
}

function cycleOrFallbackTimestamp(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
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

function utcStartOfDay(dayKey: string | undefined): string | undefined {
  return dayKey ? toIso(`${dayKey}T00:00:00.000Z`) : undefined;
}

function millisecondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return numeric / 60000;
}

function firstBodyMeasurementRecordedAt(bodyMeasurement: PlainObject | undefined): string | undefined {
  if (!bodyMeasurement) {
    return undefined;
  }

  return cycleOrFallbackTimestamp(
    toIso(bodyMeasurement.measured_at),
    toIso(bodyMeasurement.measuredAt),
    toIso(bodyMeasurement.recorded_at),
    toIso(bodyMeasurement.recordedAt),
    toIso(bodyMeasurement.updated_at),
    toIso(bodyMeasurement.updatedAt),
  );
}

function calculateBodyMassIndex(bodyMeasurement: PlainObject | undefined): number | undefined {
  const weightKilograms = finiteNumber(bodyMeasurement?.weight_kilogram ?? bodyMeasurement?.weightKilogram);
  const heightMeters = finiteNumber(bodyMeasurement?.height_meter ?? bodyMeasurement?.heightMeter);

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

function nonEmptyWorkoutMetrics(metrics: WorkoutSessionMetrics): WorkoutSessionMetrics | undefined {
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function buildWhoopWorkoutMetrics(
  workout: PlainObject,
  score: PlainObject | undefined,
): WorkoutSessionMetrics | undefined {
  const metrics: WorkoutSessionMetrics = {};
  const workoutStrain = finiteNumber(score?.strain);
  const averageHeartRate = finiteNumber(score?.average_heart_rate);
  const maxHeartRate = finiteNumber(score?.max_heart_rate);
  const totalCalories = kilojoulesToKilocalories(score?.kilojoule);
  const percentRecorded = finiteNumber(score?.percent_recorded);
  const totalElevationGainMeters = finiteNumber(workout.altitude_gain_meter);
  const altitudeChangeMeters = finiteNumber(workout.altitude_change_meter);

  if (workoutStrain !== undefined) {
    metrics.workoutStrain = workoutStrain;
  }
  if (averageHeartRate !== undefined) {
    metrics.averageHeartRate = averageHeartRate;
  }
  if (maxHeartRate !== undefined) {
    metrics.maxHeartRate = maxHeartRate;
  }
  if (totalCalories !== undefined) {
    metrics.totalCalories = totalCalories;
  }
  if (percentRecorded !== undefined) {
    metrics.percentRecorded = percentRecorded;
  }
  if (totalElevationGainMeters !== undefined) {
    metrics.totalElevationGainMeters = totalElevationGainMeters;
  }
  if (altitudeChangeMeters !== undefined) {
    metrics.altitudeChangeMeters = altitudeChangeMeters;
  }

  return nonEmptyWorkoutMetrics(metrics);
}

function pushDeletionObservation(
  events: DeviceEventPayload[],
  rawArtifacts: DeviceEvidencePartPayload[],
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

  pushSharedDeletionObservation(events, rawArtifacts, {
    provider: "whoop",
    providerDisplayName: "WHOOP",
    resourceType,
    resourceId,
    occurredAt,
    sourceEventType,
    makeExternalRef,
  });
}

export function normalizeWhoopSnapshot(snapshot: WhoopSnapshotInput): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const profile = asPlainObject(request.profile);
  const bodyMeasurement = asPlainObject(request.bodyMeasurements) ?? asPlainObject(request.bodyMeasurement);
  const sleeps = asArray(request.sleeps).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const recoveries = asArray(request.recoveries).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const cycles = asArray(request.cycles).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const workouts = asArray(request.workouts).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const deletions = asArray(request.deletions).map((entry) => asPlainObject(entry)).filter(Boolean) as PlainObject[];
  const events: DeviceEventPayload[] = [];
  const rawArtifacts: DeviceEvidencePartPayload[] = [];
  const accountId =
    stringId(request.accountId) ??
    stringId(profile?.user_id ?? profile?.userId ?? profile?.id);
  const bodyMeasurementDayKey = bodyMeasurement
    ? firstDayKey(firstBodyMeasurementRecordedAt(bodyMeasurement), importedAt)
    : undefined;
  const bodyMeasurementRecordedAt = bodyMeasurement
    ? firstBodyMeasurementRecordedAt(bodyMeasurement) ?? utcStartOfDay(bodyMeasurementDayKey)
    : undefined;
  const bodyMeasurementResourceId = bodyMeasurementDayKey ?? "current";
  const bodyMeasurementBmi = calculateBodyMassIndex(bodyMeasurement);

  pushRawArtifact(rawArtifacts, createRawArtifact("profile", "profile.json", profile));
  pushRawArtifact(rawArtifacts, createRawArtifact("body-measurement", "body-measurement.json", bodyMeasurement));

  if (bodyMeasurement && bodyMeasurementRecordedAt) {
    emitObservationMetrics(
      events,
      {
        source: {
          measurement: bodyMeasurement,
          bmi: bodyMeasurementBmi,
        },
        occurredAt: bodyMeasurementRecordedAt,
        recordedAt: bodyMeasurementRecordedAt,
        dayKey: bodyMeasurementDayKey,
        observationGrain: "summary",
        rawArtifactRoles: ["body-measurement"],
        externalRef: (facet) => makeExternalRef("body-measurement", bodyMeasurementResourceId, undefined, facet),
      },
      WHOOP_BODY_OBSERVATION_METRICS,
    );
  }

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id) ?? `sleep-${events.length + 1}`;
    const startAt = toIso(sleep.start);
    const endAt = toIso(sleep.end);
    const version = toIso(sleep.updated_at);
    const recordedAt = cycleOrFallbackTimestamp(toIso(sleep.updated_at), endAt, startAt, importedAt);
    const occurredAt = startAt ?? recordedAt;
    const dayKey = firstDayKey(endAt, startAt, recordedAt);
    const durationMinutes = minutesBetween(startAt, endAt);
    const sleepRole = `sleep:${sleepId}`;
    const sleepRef = makeExternalRef("sleep", sleepId, version);
    const score = asPlainObject(sleep.score);
    const stageSummary = asPlainObject(score?.stage_summary);
    const nap = Boolean(sleep.nap);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(sleepRole, `sleep-${sleepId}.json`, sleep),
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
          rawArtifactRoles: [sleepRole],
          externalRef: sleepRef,
          fields: {
            startAt,
            endAt,
            durationMinutes,
          },
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
        rawArtifactRoles: [sleepRole],
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
          rawArtifactRoles: [sleepRole],
          externalRef: (facet) => makeExternalRef("sleep", sleepId, version, facet),
        },
        WHOOP_SLEEP_STAGE_METRICS,
      );
    }
  }

  for (const recovery of recoveries) {
    const sleepId = stringId(recovery.sleep_id) ?? stringId(recovery.cycle_id) ?? `recovery-${events.length + 1}`;
    const recoveryRole = `recovery:${sleepId}`;
    const version = toIso(recovery.updated_at);
    const recordedAt = cycleOrFallbackTimestamp(toIso(recovery.updated_at), importedAt);
    const occurredAt = recordedAt;
    const dayKey = firstDayKey(recordedAt);
    const score = asPlainObject(recovery.score);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(recoveryRole, `recovery-${sleepId}.json`, recovery),
    );

    emitObservationMetrics(
      events,
      {
        source: score,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        rawArtifactRoles: [recoveryRole],
        externalRef: (facet) => makeExternalRef("recovery", sleepId, version, facet),
      },
      WHOOP_RECOVERY_OBSERVATION_METRICS,
    );
  }

  for (const cycle of cycles) {
    const cycleId = stringId(cycle.id) ?? `cycle-${events.length + 1}`;
    const cycleRole = `cycle:${cycleId}`;
    const startAt = toIso(cycle.start);
    const endAt = toIso(cycle.end);
    const version = toIso(cycle.updated_at);
    const recordedAt = cycleOrFallbackTimestamp(toIso(cycle.updated_at), endAt, startAt, importedAt);
    const occurredAt = endAt ?? startAt ?? recordedAt;
    const dayKey = firstDayKey(endAt, startAt, recordedAt);
    const score = asPlainObject(cycle.score);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(cycleRole, `cycle-${cycleId}.json`, cycle),
    );

    emitObservationMetrics(
      events,
      {
        source: score,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        rawArtifactRoles: [cycleRole],
        externalRef: (facet) => makeExternalRef("cycle", cycleId, version, facet),
      },
      WHOOP_CYCLE_OBSERVATION_METRICS,
    );
  }

  for (const workout of workouts) {
    const workoutId = stringId(workout.id) ?? `workout-${events.length + 1}`;
    const workoutRole = `workout:${workoutId}`;
    const startAt = toIso(workout.start);
    const endAt = toIso(workout.end);
    const version = toIso(workout.updated_at);
    const recordedAt = cycleOrFallbackTimestamp(toIso(workout.updated_at), endAt, startAt, importedAt);
    const occurredAt = startAt ?? recordedAt;
    const durationMinutes = minutesBetween(startAt, endAt);
    const sportName = typeof workout.sport_name === "string" && workout.sport_name.trim()
      ? workout.sport_name.trim()
      : "Workout";
    const activityType = slugify(sportName, "workout");
    const score = asPlainObject(workout.score);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(workoutRole, `workout-${workoutId}.json`, workout),
    );

    if (occurredAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: trimToLength(`WHOOP ${sportName}`, 160),
          rawArtifactRoles: [workoutRole],
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
    pushDeletionObservation(events, rawArtifacts, importedAt, deletion);
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
    rawArtifacts,
    provenance,
  });
}

export const whoopProviderAdapter: DeviceProviderAdapter<WhoopSnapshotInput> = {
  ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseWhoopSnapshot,
  normalizeSnapshot: normalizeWhoopSnapshot,
};
