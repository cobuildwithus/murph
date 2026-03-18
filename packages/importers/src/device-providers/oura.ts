import {
  normalizeTimestamp,
  stripEmptyObject,
  stripUndefined,
} from "../shared.js";
import {
  createRawArtifact,
  finiteNumber,
  pushObservationEvent,
  pushRawArtifact,
  pushSample,
  trimToLength,
} from "./shared-normalization.js";

import type {
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
} from "../core-port.js";
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.js";

interface PlainObject {
  [key: string]: unknown;
}

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
  heartrate?: unknown[];
  heartRate?: unknown[];
  deletions?: unknown[];
}

function asPlainObject(value: unknown): PlainObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as PlainObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return undefined;
}

function slugify(value: unknown, fallback: string): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || fallback;
}

function toIso(value: unknown): string | undefined {
  return normalizeTimestamp(value, "timestamp");
}

function secondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 60);
}

function minutesBetween(startAt: string | undefined, endAt: string | undefined): number | undefined {
  if (!startAt || !endAt) {
    return undefined;
  }

  const durationMs = Date.parse(endAt) - Date.parse(startAt);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(durationMs / 60000));
}

function makeExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return stripUndefined({
    system: "oura",
    resourceType,
    resourceId,
    version,
    facet,
  });
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

function pushDeletionObservation(
  events: DeviceEventPayload[],
  rawArtifacts: DeviceRawArtifactPayload[],
  importedAt: string,
  deletion: PlainObject,
): void {
  const resourceType = slugify(
    deletion.resource_type ?? deletion.resourceType ?? deletion.data_type ?? deletion.dataType,
    "resource",
  );
  const resourceId =
    stringId(deletion.resource_id ?? deletion.resourceId ?? deletion.object_id ?? deletion.objectId) ??
    `deleted-${events.length + 1}`;
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
  const deletionRole = `deletion:${resourceType}:${resourceId}`;

  pushRawArtifact(
    rawArtifacts,
    createRawArtifact(deletionRole, `deletion-${resourceType}-${resourceId}.json`, deletion),
  );

  events.push(
    stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: occurredAt,
      source: "device",
      title: trimToLength(`Oura ${resourceType} deleted`, 160),
      note: sourceEventType ? trimToLength(`Webhook event: ${sourceEventType}`, 4000) : undefined,
      rawArtifactRoles: [deletionRole],
      externalRef: makeExternalRef(resourceType, resourceId, occurredAt, "deleted"),
      fields: stripUndefined({
        metric: "external-resource-deleted",
        value: 1,
        unit: "boolean",
        provider: "oura",
        resourceType,
        deleted: true,
        sourceEventType,
      }),
    }),
  );
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
  const heartrate = asArray(request.heartrate ?? request.heartRate)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const deletions = asArray(request.deletions)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
  const events: DeviceEventPayload[] = [];
  const samples: DeviceSamplePayload[] = [];
  const rawArtifacts: DeviceRawArtifactPayload[] = [];
  const accountId =
    stringId(request.accountId) ?? stringId(personalInfo?.id ?? personalInfo?.user_id ?? personalInfo?.userId);

  pushRawArtifact(rawArtifacts, createRawArtifact("personal-info", "personal-info.json", personalInfo));
  pushRawArtifact(rawArtifacts, createRawArtifact("heartrate", "heartrate.json", heartrate));

  for (const activity of dailyActivity) {
    const activityId = stringId(activity.id) ?? stringId(activity.day) ?? `daily-activity-${events.length + 1}`;
    const recordedAt = firstIso(activity.timestamp, activity.day) ?? importedAt;
    const occurredAt = recordedAt;
    const role = `daily-activity:${activityId}`;

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `daily-activity-${activityId}.json`, activity));

    pushObservationEvent(events, {
      metric: "activity-score",
      value: activity.score,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Oura activity score",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "activity-score"),
    });
    pushObservationEvent(events, {
      metric: "daily-steps",
      value: activity.steps,
      unit: "count",
      occurredAt,
      recordedAt,
      title: "Oura daily steps",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "steps"),
    });
    pushObservationEvent(events, {
      metric: "active-calories",
      value: activity.active_calories,
      unit: "kcal",
      occurredAt,
      recordedAt,
      title: "Oura active calories",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "active-calories"),
    });
    pushObservationEvent(events, {
      metric: "total-calories",
      value: activity.total_calories,
      unit: "kcal",
      occurredAt,
      recordedAt,
      title: "Oura total calories",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "total-calories"),
    });
    pushObservationEvent(events, {
      metric: "equivalent-walking-distance",
      value: activity.equivalent_walking_distance,
      unit: "meter",
      occurredAt,
      recordedAt,
      title: "Oura walking distance",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "walking-distance"),
    });
    pushObservationEvent(events, {
      metric: "non-wear-minutes",
      value: secondsToMinutes(activity.non_wear_time),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura non-wear time",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-activity", activityId, firstIso(activity.timestamp), "non-wear-minutes"),
    });
  }

  for (const summary of dailySleep) {
    const summaryId = stringId(summary.id) ?? stringId(summary.day) ?? `daily-sleep-${events.length + 1}`;
    const recordedAt = firstIso(summary.timestamp, summary.day) ?? importedAt;
    const occurredAt = recordedAt;
    const role = `daily-sleep:${summaryId}`;

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `daily-sleep-${summaryId}.json`, summary));

    pushObservationEvent(events, {
      metric: "sleep-score",
      value: summary.score,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Oura sleep score",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-sleep", summaryId, firstIso(summary.timestamp), "sleep-score"),
    });
  }

  for (const readiness of dailyReadiness) {
    const readinessId =
      stringId(readiness.id) ?? stringId(readiness.day) ?? `daily-readiness-${events.length + 1}`;
    const recordedAt = firstIso(readiness.timestamp, readiness.day) ?? importedAt;
    const occurredAt = recordedAt;
    const role = `daily-readiness:${readinessId}`;

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `daily-readiness-${readinessId}.json`, readiness));

    pushObservationEvent(events, {
      metric: "readiness-score",
      value: readiness.score,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Oura readiness score",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef(
        "daily-readiness",
        readinessId,
        firstIso(readiness.timestamp),
        "readiness-score",
      ),
    });
    pushObservationEvent(events, {
      metric: "temperature-deviation",
      value: readiness.temperature_deviation,
      unit: "celsius",
      occurredAt,
      recordedAt,
      title: "Oura temperature deviation",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef(
        "daily-readiness",
        readinessId,
        firstIso(readiness.timestamp),
        "temperature-deviation",
      ),
    });
    pushObservationEvent(events, {
      metric: "temperature-trend-deviation",
      value: readiness.temperature_trend_deviation,
      unit: "celsius",
      occurredAt,
      recordedAt,
      title: "Oura temperature trend deviation",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef(
        "daily-readiness",
        readinessId,
        firstIso(readiness.timestamp),
        "temperature-trend-deviation",
      ),
    });
  }

  for (const spo2 of dailySpO2) {
    const spo2Id = stringId(spo2.id) ?? stringId(spo2.day) ?? `daily-spo2-${events.length + 1}`;
    const recordedAt = firstIso(spo2.timestamp, spo2.day) ?? importedAt;
    const occurredAt = recordedAt;
    const role = `daily-spo2:${spo2Id}`;
    const spo2Percentage = asPlainObject(spo2.spo2_percentage);

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `daily-spo2-${spo2Id}.json`, spo2));

    pushObservationEvent(events, {
      metric: "spo2",
      value: spo2Percentage?.average,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Oura average SpO2",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("daily-spo2", spo2Id, firstIso(spo2.timestamp), "spo2-average"),
    });
    pushObservationEvent(events, {
      metric: "breathing-disturbance-index",
      value: spo2.breathing_disturbance_index,
      unit: "count",
      occurredAt,
      recordedAt,
      title: "Oura breathing disturbance index",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef(
        "daily-spo2",
        spo2Id,
        firstIso(spo2.timestamp),
        "breathing-disturbance-index",
      ),
    });
  }

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id) ?? `sleep-${events.length + 1}`;
    const startAt = firstIso(sleep.bedtime_start, sleep.start_datetime, sleep.start_time, sleep.start);
    const endAt = firstIso(sleep.bedtime_end, sleep.end_datetime, sleep.end_time, sleep.end);
    const recordedAt =
      firstIso(sleep.timestamp, sleep.updated_at, sleep.updatedAt, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const durationMinutes =
      minutesBetween(startAt, endAt) ??
      secondsToMinutes(sleep.time_in_bed) ??
      secondsToMinutes(sleep.total_sleep_duration);
    const sleepType = slugify(sleep.type, "sleep");
    const role = `sleep:${sleepId}`;
    const version = firstIso(sleep.timestamp, sleep.updated_at, sleep.updatedAt);

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `sleep-${sleepId}.json`, sleep));

    if (sleepType === "deleted") {
      pushDeletionObservation(events, rawArtifacts, importedAt, {
        resource_type: "sleep",
        resource_id: sleepId,
        occurred_at: recordedAt,
        source_event_type: "sleep.deleted",
        payload: sleep,
      });
      continue;
    }

    if (sleepType !== "rest" && occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "sleep_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: sleepType.includes("nap") ? "Oura nap" : "Oura sleep",
          rawArtifactRoles: [role],
          externalRef: makeExternalRef("sleep", sleepId, version),
          fields: {
            startAt,
            endAt,
            durationMinutes,
          },
        }),
      );
    }

    pushSample(samples, {
      stream: "respiratory_rate",
      value: sleep.average_breath,
      unit: "breaths_per_minute",
      recordedAt,
      externalRef: makeExternalRef("sleep", sleepId, version, "respiratory-rate"),
    });
    pushSample(samples, {
      stream: "hrv",
      value: sleep.average_hrv,
      unit: "ms",
      recordedAt,
      externalRef: makeExternalRef("sleep", sleepId, version, "average-hrv"),
    });
    pushSample(samples, {
      stream: "heart_rate",
      value: sleep.average_heart_rate,
      unit: "bpm",
      recordedAt,
      externalRef: makeExternalRef("sleep", sleepId, version, "average-heart-rate"),
    });

    pushObservationEvent(events, {
      metric: "sleep-efficiency",
      value: sleep.efficiency,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Oura sleep efficiency",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-efficiency"),
    });
    pushObservationEvent(events, {
      metric: "sleep-total-minutes",
      value: secondsToMinutes(sleep.total_sleep_duration),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura total sleep",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-total-minutes"),
    });
    pushObservationEvent(events, {
      metric: "time-in-bed-minutes",
      value: secondsToMinutes(sleep.time_in_bed),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura time in bed",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "time-in-bed-minutes"),
    });
    pushObservationEvent(events, {
      metric: "sleep-awake-minutes",
      value: secondsToMinutes(sleep.awake_time),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura awake time",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-awake-minutes"),
    });
    pushObservationEvent(events, {
      metric: "sleep-deep-minutes",
      value: secondsToMinutes(sleep.deep_sleep_duration),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura deep sleep",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-deep-minutes"),
    });
    pushObservationEvent(events, {
      metric: "sleep-light-minutes",
      value: secondsToMinutes(sleep.light_sleep_duration),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura light sleep",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-light-minutes"),
    });
    pushObservationEvent(events, {
      metric: "sleep-rem-minutes",
      value: secondsToMinutes(sleep.rem_sleep_duration),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura REM sleep",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-rem-minutes"),
    });
    pushObservationEvent(events, {
      metric: "sleep-latency-minutes",
      value: secondsToMinutes(sleep.latency),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Oura sleep latency",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-latency-minutes"),
    });
    pushObservationEvent(events, {
      metric: "lowest-heart-rate",
      value: sleep.lowest_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "Oura lowest heart rate",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "lowest-heart-rate"),
    });
    pushObservationEvent(events, {
      metric: "sleep-score-delta",
      value: sleep.sleep_score_delta,
      unit: "score",
      occurredAt,
      recordedAt,
      title: "Oura sleep score contribution",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "sleep-score-delta"),
    });
    pushObservationEvent(events, {
      metric: "readiness-score-delta",
      value: sleep.readiness_score_delta,
      unit: "score",
      occurredAt,
      recordedAt,
      title: "Oura readiness contribution",
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("sleep", sleepId, version, "readiness-score-delta"),
    });
  }

  for (const session of sessions) {
    const sessionId = stringId(session.id) ?? `session-${events.length + 1}`;
    const startAt = firstIso(session.start_datetime, session.start_time, session.start);
    const endAt = firstIso(session.end_datetime, session.end_time, session.end);
    const recordedAt = firstIso(session.timestamp, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const durationMinutes = minutesBetween(startAt, endAt);
    const sessionType = slugify(session.type, "session");
    const role = `session:${sessionId}`;
    const version = firstIso(session.timestamp, session.updated_at, session.updatedAt);

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `session-${sessionId}.json`, session));

    if (occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: trimToLength(`Oura ${sessionType} session`, 160),
          rawArtifactRoles: [role],
          externalRef: makeExternalRef("session", sessionId, version),
          fields: stripUndefined({
            activityType: sessionType,
            startAt,
            endAt,
            durationMinutes,
          }),
        }),
      );
    }

    pushSample(samples, {
      stream: "heart_rate",
      value: session.heart_rate,
      unit: "bpm",
      recordedAt,
      externalRef: makeExternalRef("session", sessionId, version, "heart-rate"),
    });
    pushSample(samples, {
      stream: "hrv",
      value: session.heart_rate_variability,
      unit: "ms",
      recordedAt,
      externalRef: makeExternalRef("session", sessionId, version, "hrv"),
    });
  }

  for (const workout of workouts) {
    const workoutId = stringId(workout.id) ?? `workout-${events.length + 1}`;
    const startAt = firstIso(workout.start_datetime, workout.start_time, workout.start);
    const endAt = firstIso(workout.end_datetime, workout.end_time, workout.end);
    const recordedAt =
      firstIso(workout.timestamp, workout.updated_at, workout.updatedAt, endAt, startAt) ?? importedAt;
    const occurredAt = startAt ?? recordedAt;
    const durationMinutes = minutesBetween(startAt, endAt);
    const activityType = slugify(
      workout.activity ?? workout.activity_type ?? workout.sport_name ?? workout.sport ?? workout.type,
      "workout",
    );
    const role = `workout:${workoutId}`;
    const version = firstIso(workout.timestamp, workout.updated_at, workout.updatedAt);
    const distanceMeters = firstNumber(workout.distance, workout.distance_meter, workout.distance_meters);
    const distanceKm = distanceMeters !== undefined ? distanceMeters / 1000 : undefined;

    pushRawArtifact(rawArtifacts, createRawArtifact(role, `workout-${workoutId}.json`, workout));

    if (occurredAt && startAt && endAt && durationMinutes) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: trimToLength(`Oura ${activityType}`, 160),
          rawArtifactRoles: [role],
          externalRef: makeExternalRef("workout", workoutId, version),
          fields: stripUndefined({
            activityType,
            startAt,
            endAt,
            durationMinutes,
            distanceKm,
          }),
        }),
      );
    }

    pushObservationEvent(events, {
      metric: "active-calories",
      value: firstNumber(workout.calories, workout.active_calories, workout.total_calories),
      unit: "kcal",
      occurredAt,
      recordedAt,
      title: `Oura ${activityType} calories`,
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("workout", workoutId, version, "active-calories"),
    });
    pushObservationEvent(events, {
      metric: "distance",
      value: distanceMeters,
      unit: "meter",
      occurredAt,
      recordedAt,
      title: `Oura ${activityType} distance`,
      rawArtifactRoles: [role],
      externalRef: makeExternalRef("workout", workoutId, version, "distance"),
    });
  }

  for (const point of heartrate) {
    const pointId = stringId(point.id) ?? stringId(point.timestamp) ?? `heartrate-${samples.length + 1}`;
    const recordedAt = firstIso(point.timestamp, point.recorded_at, point.recordedAt) ?? importedAt;
    const version = recordedAt;
    const bpm = firstNumber(point.bpm, point.heart_rate, point.value);

    pushSample(samples, {
      stream: "heart_rate",
      value: bpm,
      unit: "bpm",
      recordedAt,
      externalRef: makeExternalRef("heartrate", pointId, version, slugify(point.source, "sample")),
    });
  }

  for (const deletion of deletions) {
    pushDeletionObservation(events, rawArtifacts, importedAt, deletion);
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
      heartrate: heartrate.length,
      deletions: deletions.length,
    },
  });

  return stripUndefined({
    provider: "oura",
    accountId,
    importedAt,
    source: "device",
    events,
    samples,
    rawArtifacts,
    provenance,
  });
}

export const ouraProviderAdapter: DeviceProviderAdapter<OuraSnapshotInput> = {
  provider: "oura",
  normalizeSnapshot: normalizeOuraSnapshot,
};
