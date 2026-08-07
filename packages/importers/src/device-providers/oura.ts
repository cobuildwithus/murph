import * as z from "@murphai/contracts/zod-runtime";

import { extractIsoDatePrefix, type WorkoutSessionMetrics } from "@murphai/contracts";

import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  buildSyntheticDeletionResourceId,
  createEvidencePart,
  emitObservationMetrics,
  finiteNumber,
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
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.ts";
import { OURA_DEVICE_PROVIDER_DESCRIPTOR } from "./provider-descriptors.ts";

export interface OuraSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  personalInfo?: unknown;
  dailyActivity?: unknown[];
  dailySleep?: unknown[];
  dailyReadiness?: unknown[];
  dailySpO2?: unknown[];
  dailySpo2?: unknown[];
  sleeps?: unknown[];
  sessions?: unknown[];
  workouts?: unknown[];
  deletions?: unknown[];
}

const ouraCollectionSchema = z.array(z.unknown());

const ouraSnapshotSchema = z.object({
  accountId: z.union([z.string(), z.number()]).optional(),
  importedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  personalInfo: z.unknown().optional(),
  dailyActivity: ouraCollectionSchema.optional(),
  dailySleep: ouraCollectionSchema.optional(),
  dailyReadiness: ouraCollectionSchema.optional(),
  dailySpO2: ouraCollectionSchema.optional(),
  dailySpo2: ouraCollectionSchema.optional(),
  sleeps: ouraCollectionSchema.optional(),
  sessions: ouraCollectionSchema.optional(),
  workouts: ouraCollectionSchema.optional(),
  deletions: ouraCollectionSchema.optional(),
}).catchall(z.unknown());

function parseOuraSnapshot(snapshot: unknown): OuraSnapshotInput {
  return ouraSnapshotSchema.parse(snapshot);
}

function sanitizeOuraRawSnapshot(snapshot: OuraSnapshotInput): unknown {
  const source = asPlainObject(snapshot);
  if (!source) {
    return source;
  }

  const sanitized: PlainObject = { ...source };
  delete sanitized.heartrate;
  delete sanitized.heartRate;

  const hasRetainedCollection = [
    sanitized.personalInfo,
    sanitized.dailyActivity,
    sanitized.dailySleep,
    sanitized.dailyReadiness,
    sanitized.dailySpO2,
    sanitized.dailySpo2,
    sanitized.sleeps,
    sanitized.sessions,
    sanitized.workouts,
    sanitized.deletions,
  ].some((value) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null);

  return hasRetainedCollection ? sanitized : {};
}

function secondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 60);
}

function resolveOuraDailyActivityMinutes(activity: PlainObject): number | undefined {
  // Oura reports each required daily intensity bucket in seconds.
  const lowActivitySeconds = finiteNumber(activity.low_activity_time);
  const mediumActivitySeconds = finiteNumber(activity.medium_activity_time);
  const highActivitySeconds = finiteNumber(activity.high_activity_time);

  if (
    lowActivitySeconds === undefined
    || mediumActivitySeconds === undefined
    || highActivitySeconds === undefined
    || lowActivitySeconds < 0
    || mediumActivitySeconds < 0
    || highActivitySeconds < 0
  ) {
    return undefined;
  }

  const totalActivitySeconds =
    lowActivitySeconds + mediumActivitySeconds + highActivitySeconds;

  return totalActivitySeconds <= 24 * 60 * 60
    ? totalActivitySeconds / 60
    : undefined;
}

function makeExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef("oura", resourceType, resourceId, version, facet);
}

function firstIso(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = toIso(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function firstNumber(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    const numeric = finiteNumber(candidate);

    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function firstDayKey(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const dayKey = extractIsoDatePrefix(candidate);
    if (dayKey) {
      return dayKey;
    }
  }

  return undefined;
}

function resolveOuraSleepType(value: unknown): "main_sleep" | "nap" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (normalized.includes("nap")) {
    return "nap";
  }

  return normalized === "sleep" || normalized === "long_sleep" ? "main_sleep" : undefined;
}

const OURA_DAILY_ACTIVITY_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "activity-minutes",
    value: resolveOuraDailyActivityMinutes,
    unit: "minutes",
    title: "Oura daily active minutes",
    facet: "activity-minutes",
  },
  {
    metric: "activity-score",
    value: (activity) => activity.score,
    unit: "%",
    title: "Oura activity score",
    facet: "activity-score",
  },
  {
    metric: "daily-steps",
    value: (activity) => activity.steps,
    unit: "count",
    title: "Oura daily steps",
    facet: "steps",
  },
  {
    metric: "active-calories",
    value: (activity) => activity.active_calories,
    unit: "kcal",
    title: "Oura active calories",
    facet: "active-calories",
  },
  {
    metric: "total-calories",
    value: (activity) => activity.total_calories,
    unit: "kcal",
    title: "Oura total calories",
    facet: "total-calories",
  },
  {
    metric: "equivalent-walking-distance",
    value: (activity) => activity.equivalent_walking_distance,
    unit: "meter",
    title: "Oura walking distance",
    facet: "walking-distance",
  },
  {
    metric: "non-wear-minutes",
    value: (activity) => activity.non_wear_time,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura non-wear time",
    facet: "non-wear-minutes",
  },
];

const OURA_DAILY_SLEEP_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "sleep-score",
    value: (summary) => summary.score,
    unit: "%",
    title: "Oura sleep score",
    facet: "sleep-score",
  },
];

const OURA_DAILY_READINESS_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "readiness-score",
    value: (readiness) => readiness.score,
    unit: "%",
    title: "Oura readiness score",
    facet: "readiness-score",
  },
  {
    metric: "temperature-deviation",
    value: (readiness) => readiness.temperature_deviation,
    unit: "celsius",
    title: "Oura temperature deviation",
    facet: "temperature-deviation",
  },
  {
    metric: "temperature-trend-deviation",
    value: (readiness) => readiness.temperature_trend_deviation,
    unit: "celsius",
    title: "Oura temperature trend deviation",
    facet: "temperature-trend-deviation",
  },
];

const OURA_DAILY_SPO2_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "spo2",
    value: (spo2) => asPlainObject(spo2.spo2_percentage)?.average,
    unit: "%",
    title: "Oura average SpO2",
    facet: "spo2-average",
  },
  {
    metric: "breathing-disturbance-index",
    value: (spo2) => spo2.breathing_disturbance_index,
    unit: "count",
    title: "Oura breathing disturbance index",
    facet: "breathing-disturbance-index",
  },
];

const OURA_SLEEP_OBSERVATION_METRICS: readonly ObservationMetricDescriptor<PlainObject>[] = [
  {
    metric: "respiratory-rate",
    value: (sleep) => sleep.average_breath,
    unit: "breaths_per_minute",
    title: "Oura respiratory rate",
    facet: "respiratory-rate",
  },
  {
    metric: "hrv",
    value: (sleep) => sleep.average_hrv,
    unit: "ms",
    title: "Oura average HRV",
    facet: "average-hrv",
  },
  {
    metric: "average-heart-rate",
    value: (sleep) => sleep.average_heart_rate,
    unit: "bpm",
    title: "Oura average heart rate",
    facet: "average-heart-rate",
  },
  {
    metric: "sleep-efficiency",
    value: (sleep) => sleep.efficiency,
    unit: "%",
    title: "Oura sleep efficiency",
    facet: "sleep-efficiency",
  },
  {
    metric: "sleep-total-minutes",
    value: (sleep) => sleep.total_sleep_duration,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura total sleep",
    facet: "sleep-total-minutes",
  },
  {
    metric: "time-in-bed-minutes",
    value: (sleep) => sleep.time_in_bed,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura time in bed",
    facet: "time-in-bed-minutes",
  },
  {
    metric: "sleep-awake-minutes",
    value: (sleep) => sleep.awake_time,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura awake time",
    facet: "sleep-awake-minutes",
  },
  {
    metric: "sleep-deep-minutes",
    value: (sleep) => sleep.deep_sleep_duration,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura deep sleep",
    facet: "sleep-deep-minutes",
  },
  {
    metric: "sleep-light-minutes",
    value: (sleep) => sleep.light_sleep_duration,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura light sleep",
    facet: "sleep-light-minutes",
  },
  {
    metric: "sleep-rem-minutes",
    value: (sleep) => sleep.rem_sleep_duration,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura REM sleep",
    facet: "sleep-rem-minutes",
  },
  {
    metric: "sleep-latency-minutes",
    value: (sleep) => sleep.latency,
    transform: secondsToMinutes,
    unit: "minutes",
    title: "Oura sleep latency",
    facet: "sleep-latency-minutes",
  },
  {
    metric: "lowest-heart-rate",
    value: (sleep) => sleep.lowest_heart_rate,
    unit: "bpm",
    title: "Oura lowest heart rate",
    facet: "lowest-heart-rate",
  },
  {
    metric: "sleep-score-delta",
    value: (sleep) => sleep.sleep_score_delta,
    unit: "score",
    title: "Oura sleep score contribution",
    facet: "sleep-score-delta",
  },
  {
    metric: "readiness-score-delta",
    value: (sleep) => sleep.readiness_score_delta,
    unit: "score",
    title: "Oura readiness contribution",
    facet: "readiness-score-delta",
  },
];

function nonEmptyWorkoutMetrics(metrics: WorkoutSessionMetrics): WorkoutSessionMetrics | undefined {
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function buildOuraSessionMetrics(session: PlainObject): WorkoutSessionMetrics | undefined {
  const metrics: WorkoutSessionMetrics = {};
  const averageHeartRate = firstNumber(session.heart_rate);
  const hrv = firstNumber(session.heart_rate_variability);

  if (averageHeartRate !== undefined) {
    metrics.averageHeartRate = averageHeartRate;
  }
  if (hrv !== undefined) {
    metrics.hrv = hrv;
  }

  return nonEmptyWorkoutMetrics(metrics);
}

function buildOuraWorkoutMetrics(workout: PlainObject): WorkoutSessionMetrics | undefined {
  const metrics: WorkoutSessionMetrics = {};
  const activeCalories = firstNumber(workout.active_calories, workout.calories);
  const totalCalories = firstNumber(workout.total_calories);

  if (activeCalories !== undefined) {
    metrics.activeCalories = activeCalories;
  }
  if (totalCalories !== undefined) {
    metrics.totalCalories = totalCalories;
  }

  return nonEmptyWorkoutMetrics(metrics);
}

function pushDeletionObservation(
  events: DeviceEventPayload[],
  evidenceParts: DeviceEvidencePartPayload[],
  importedAt: string,
  deletion: PlainObject,
): void {
  const resourceType = slugify(
    deletion.resource_type ?? deletion.resourceType ?? deletion.data_type ?? deletion.dataType,
    "resource",
  );
  const occurredAt =
    firstIso(deletion.occurred_at, deletion.occurredAt, deletion.event_time, deletion.eventTime) ??
    importedAt;
  const sourceEventType =
    typeof deletion.source_event_type === "string" && deletion.source_event_type.trim()
      ? deletion.source_event_type.trim()
      : typeof deletion.sourceEventType === "string" && deletion.sourceEventType.trim()
        ? deletion.sourceEventType.trim()
        : typeof deletion.event_type === "string" && deletion.event_type.trim()
        ? deletion.event_type.trim()
        : typeof deletion.eventType === "string" && deletion.eventType.trim()
          ? deletion.eventType.trim()
          : undefined;
  const resourceId =
    stringId(deletion.resource_id ?? deletion.resourceId ?? deletion.object_id ?? deletion.objectId) ??
    buildSyntheticDeletionResourceId({
      provider: "oura",
      resourceType,
      occurredAt,
      sourceEventType,
      deletion,
    });
  pushSharedDeletionObservation(events, evidenceParts, {
    provider: "oura",
    providerDisplayName: "Oura",
    resourceType,
    resourceId,
    occurredAt,
    sourceEventType,
    makeExternalRef,
  });
}

export function normalizeOuraSnapshot(snapshot: OuraSnapshotInput): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const personalInfo = asPlainObject(request.personalInfo);
  const dailyActivity = asArray(request.dailyActivity)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const dailySleep = asArray(request.dailySleep)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const dailyReadiness = asArray(request.dailyReadiness)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const dailySpO2 = asArray(request.dailySpO2 ?? request.dailySpo2)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const sleeps = asArray(request.sleeps)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const sessions = asArray(request.sessions)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const workouts = asArray(request.workouts)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const deletions = asArray(request.deletions)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const events: DeviceEventPayload[] = [];
  const evidenceParts: DeviceEvidencePartPayload[] = [];
  const accountId =
    stringId(request.accountId) ?? stringId(personalInfo?.id ?? personalInfo?.user_id ?? personalInfo?.userId);

  pushEvidencePart(evidenceParts, createEvidencePart("personal-info", "personal-info.json", personalInfo));

  for (const activity of dailyActivity) {
    const activityId = stringId(activity.id) ?? stringId(activity.day) ?? `daily-activity-${events.length + 1}`;
    const recordedAt = firstIso(activity.timestamp, activity.day) ?? importedAt;
    const occurredAt = recordedAt;
    const dayKey = firstDayKey(stringId(activity.day), recordedAt);
    const role = `daily-activity:${activityId}`;
    const version = firstIso(activity.timestamp);

    pushEvidencePart(evidenceParts, createEvidencePart(role, `daily-activity-${activityId}.json`, activity));

    emitObservationMetrics(
      events,
      {
        source: activity,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [role],
        externalRef: (facet) => makeExternalRef("daily-activity", activityId, version, facet),
      },
      OURA_DAILY_ACTIVITY_METRICS,
    );
  }

  for (const summary of dailySleep) {
    const summaryId = stringId(summary.id) ?? stringId(summary.day) ?? `daily-sleep-${events.length + 1}`;
    const recordedAt = firstIso(summary.timestamp, summary.day) ?? importedAt;
    const occurredAt = recordedAt;
    const dayKey = firstDayKey(stringId(summary.day), recordedAt);
    const role = `daily-sleep:${summaryId}`;
    const version = firstIso(summary.timestamp);

    pushEvidencePart(evidenceParts, createEvidencePart(role, `daily-sleep-${summaryId}.json`, summary));

    emitObservationMetrics(
      events,
      {
        source: summary,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [role],
        externalRef: (facet) => makeExternalRef("daily-sleep", summaryId, version, facet),
      },
      OURA_DAILY_SLEEP_METRICS,
    );
  }

  for (const readiness of dailyReadiness) {
    const readinessId =
      stringId(readiness.id) ?? stringId(readiness.day) ?? `daily-readiness-${events.length + 1}`;
    const recordedAt = firstIso(readiness.timestamp, readiness.day) ?? importedAt;
    const occurredAt = recordedAt;
    const dayKey = firstDayKey(stringId(readiness.day), recordedAt);
    const role = `daily-readiness:${readinessId}`;
    const version = firstIso(readiness.timestamp);

    pushEvidencePart(evidenceParts, createEvidencePart(role, `daily-readiness-${readinessId}.json`, readiness));

    emitObservationMetrics(
      events,
      {
        source: readiness,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [role],
        externalRef: (facet) => makeExternalRef("daily-readiness", readinessId, version, facet),
      },
      OURA_DAILY_READINESS_METRICS,
    );
  }

  for (const spo2 of dailySpO2) {
    const spo2Id = stringId(spo2.id) ?? stringId(spo2.day) ?? `daily-spo2-${events.length + 1}`;
    const recordedAt = firstIso(spo2.timestamp, spo2.day) ?? importedAt;
    const occurredAt = recordedAt;
    const dayKey = firstDayKey(stringId(spo2.day), recordedAt);
    const role = `daily-spo2:${spo2Id}`;
    const version = firstIso(spo2.timestamp);

    pushEvidencePart(evidenceParts, createEvidencePart(role, `daily-spo2-${spo2Id}.json`, spo2));

    emitObservationMetrics(
      events,
      {
        source: spo2,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [role],
        externalRef: (facet) => makeExternalRef("daily-spo2", spo2Id, version, facet),
      },
      OURA_DAILY_SPO2_METRICS,
    );
  }

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id) ?? `sleep-${events.length + 1}`;
    const startAt = firstIso(sleep.bedtime_start, sleep.start_datetime, sleep.start_time, sleep.start);
    const endAt = firstIso(sleep.bedtime_end, sleep.end_datetime, sleep.end_time, sleep.end);
    const recordedAt =
      firstIso(sleep.timestamp, sleep.updated_at, sleep.updatedAt, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const dayKey = firstDayKey(
      stringId(sleep.day),
      stringId(sleep.date),
      stringId(sleep.sleep_date),
      endAt,
      recordedAt,
      occurredAt,
    );
    const durationMinutes =
      minutesBetween(startAt, endAt) ??
      secondsToMinutes(sleep.time_in_bed) ??
      secondsToMinutes(sleep.total_sleep_duration);
    const sleepType = slugify(sleep.type, "sleep");
    const canonicalSleepType = resolveOuraSleepType(sleep.type);
    const role = `sleep:${sleepId}`;
    const version = firstIso(sleep.timestamp, sleep.updated_at, sleep.updatedAt);

    if (sleepType === "deleted") {
      pushDeletionObservation(events, evidenceParts, importedAt, {
        resource_type: "sleep",
        resource_id: sleepId,
        occurred_at: recordedAt,
        source_event_type: "sleep.deleted",
      });
      continue;
    }

    pushEvidencePart(evidenceParts, createEvidencePart(role, `sleep-${sleepId}.json`, sleep));

    if (sleepType !== "rest" && occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "sleep_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: sleepType.includes("nap") ? "Oura nap" : "Oura sleep",
          evidenceRoles: [role],
          externalRef: makeExternalRef("sleep", sleepId, version),
          fields: stripUndefined({
            startAt,
            endAt,
            durationMinutes,
            sleepType: canonicalSleepType,
          }),
        }),
      );
    }

    emitObservationMetrics(
      events,
      {
        source: sleep,
        occurredAt,
        recordedAt,
        dayKey,
        observationGrain: "summary",
        evidenceRoles: [role],
        externalRef: (facet) => makeExternalRef("sleep", sleepId, version, facet),
      },
      OURA_SLEEP_OBSERVATION_METRICS,
    );
  }

  for (const session of sessions) {
    const sessionId = stringId(session.id) ?? `session-${events.length + 1}`;
    const startAt = firstIso(session.start_datetime, session.start_time, session.start);
    const endAt = firstIso(session.end_datetime, session.end_time, session.end);
    const recordedAt = firstIso(session.timestamp, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const dayKey = firstDayKey(
      stringId(session.day),
      stringId(session.date),
      occurredAt,
      recordedAt,
    );
    const durationMinutes = minutesBetween(startAt, endAt);
    const sessionType = slugify(session.type, "session");
    const role = `session:${sessionId}`;
    const version = firstIso(session.timestamp, session.updated_at, session.updatedAt);

    pushEvidencePart(evidenceParts, createEvidencePart(role, `session-${sessionId}.json`, session));

    if (occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: trimToLength(`Oura ${sessionType} session`, 160),
          evidenceRoles: [role],
          externalRef: makeExternalRef("session", sessionId, version),
          fields: stripUndefined({
            activityType: sessionType,
            durationMinutes,
            workout: {
              sourceApp: "oura",
              sourceWorkoutId: sessionId,
              startedAt: startAt,
              endedAt: endAt,
              sessionNote: `Oura ${sessionType} session`,
              metrics: buildOuraSessionMetrics(session),
              exercises: [],
            },
          }),
        }),
      );
    }
  }

  for (const workout of workouts) {
    const workoutId = stringId(workout.id) ?? `workout-${events.length + 1}`;
    const startAt = firstIso(workout.start_datetime, workout.start_time, workout.start);
    const endAt = firstIso(workout.end_datetime, workout.end_time, workout.end);
    const recordedAt =
      firstIso(workout.timestamp, workout.updated_at, workout.updatedAt, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const dayKey = firstDayKey(
      stringId(workout.day),
      stringId(workout.date),
      occurredAt,
      recordedAt,
    );
    const durationMinutes = minutesBetween(startAt, endAt);
    const activityType = slugify(
      workout.activity ?? workout.activity_type ?? workout.sport_name ?? workout.sport ?? workout.type,
      "workout",
    );
    const role = `workout:${workoutId}`;
    const version = firstIso(workout.timestamp, workout.updated_at, workout.updatedAt);
    const distanceMeters = firstNumber(workout.distance, workout.distance_meter, workout.distance_meters);
    const distanceKm = distanceMeters !== undefined ? distanceMeters / 1000 : undefined;

    pushEvidencePart(evidenceParts, createEvidencePart(role, `workout-${workoutId}.json`, workout));

    if (occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: trimToLength(`Oura ${activityType}`, 160),
          evidenceRoles: [role],
          externalRef: makeExternalRef("workout", workoutId, version),
          fields: stripUndefined({
            activityType,
            durationMinutes,
            distanceKm,
            workout: {
              sourceApp: "oura",
              sourceWorkoutId: workoutId,
              startedAt: startAt,
              endedAt: endAt,
              sessionNote: `Oura ${activityType}`,
              metrics: buildOuraWorkoutMetrics(workout),
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
    ouraUserId: stringId(personalInfo?.id ?? personalInfo?.user_id ?? personalInfo?.userId),
    importedSections: {
      personalInfo: Boolean(personalInfo),
      dailyActivity: dailyActivity.length,
      dailySleep: dailySleep.length,
      dailyReadiness: dailyReadiness.length,
      dailySpO2: dailySpO2.length,
      sleeps: sleeps.length,
      sessions: sessions.length,
      workouts: workouts.length,
      deletions: deletions.length,
    },
  });

  return makeNormalizedDeviceBatch({
    provider: "oura",
    accountId,
    importedAt,
    events,
    evidenceParts,
    provenance,
  });
}

export const ouraProviderAdapter: DeviceProviderAdapter<OuraSnapshotInput> = {
  ...OURA_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseOuraSnapshot,
  normalizeSnapshot: normalizeOuraSnapshot,
  sanitizeRawSnapshot: sanitizeOuraRawSnapshot,
};
