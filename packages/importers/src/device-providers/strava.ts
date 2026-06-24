import { extractIsoDatePrefix, type WorkoutSessionMetrics } from "@murphai/contracts";

import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  buildSyntheticDeletionResourceId,
  createEvidencePart,
  finiteNumber,
  kilojoulesToKilocalories,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  pushDeletionObservation as pushSharedDeletionObservation,
  pushEvidencePart,
  slugify,
  stringId,
  toIso,
  trimToLength,
} from "./shared-normalization.ts";

import type {
  DeviceEventPayload,
  DeviceEvidencePartPayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.ts";
import { STRAVA_DEVICE_PROVIDER_DESCRIPTOR } from "./provider-descriptors.ts";

export interface StravaSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  athlete?: unknown;
  activities?: unknown[];
  deletions?: unknown[];
  sourceWindow?: unknown;
}

function parseStravaSnapshot(snapshot: unknown): StravaSnapshotInput {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Strava snapshot must be an object.");
  }

  assertOptionalObjectCollection((snapshot as StravaSnapshotInput).activities, "activities");
  assertOptionalObjectCollection((snapshot as StravaSnapshotInput).deletions, "deletions");

  return snapshot as StravaSnapshotInput;
}

function assertOptionalObjectCollection(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`Strava snapshot ${fieldName} must be an array.`);
  }

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`Strava snapshot ${fieldName}[${index}] must be an object.`);
    }
  });
}

function asObjectArray(value: unknown): PlainObject[] {
  return asArray(value)
    .map((entry) => asPlainObject(entry))
    .filter((entry): entry is PlainObject => Boolean(entry));
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function firstNumber(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function firstIso(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const normalized = toIso(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function firstDayKey(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const candidate = typeof value === "string" ? value : toIso(value);
    const dayKey = extractIsoDatePrefix(candidate ?? undefined);
    if (dayKey) {
      return dayKey;
    }
  }

  return undefined;
}

function addSecondsToIso(timestamp: string | undefined, seconds: number | undefined): string | undefined {
  if (!timestamp || seconds === undefined) {
    return undefined;
  }

  const startMs = Date.parse(timestamp);
  if (!Number.isFinite(startMs)) {
    return undefined;
  }

  return new Date(startMs + seconds * 1000).toISOString();
}

function nonEmptyWorkoutMetrics(metrics: WorkoutSessionMetrics): WorkoutSessionMetrics | undefined {
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function buildStravaActivityMetrics(activity: PlainObject): WorkoutSessionMetrics | undefined {
  const metrics: WorkoutSessionMetrics = {};
  const activeCalories = firstNumber(activity.calories);
  const totalCalories = kilojoulesToKilocalories(activity.kilojoules);
  const averageHeartRate = firstNumber(activity.average_heartrate, activity.averageHeartRate);
  const maxHeartRate = firstNumber(activity.max_heartrate, activity.maxHeartRate);
  const totalElevationGainMeters = firstNumber(activity.total_elevation_gain, activity.totalElevationGain);
  const averageSpeedMps = firstNumber(activity.average_speed, activity.averageSpeed);
  const maxSpeedMps = firstNumber(activity.max_speed, activity.maxSpeed);

  if (activeCalories !== undefined) {
    metrics.activeCalories = activeCalories;
  }
  if (totalCalories !== undefined) {
    metrics.totalCalories = totalCalories;
  }
  if (averageHeartRate !== undefined) {
    metrics.averageHeartRate = averageHeartRate;
  }
  if (maxHeartRate !== undefined) {
    metrics.maxHeartRate = maxHeartRate;
  }
  if (totalElevationGainMeters !== undefined) {
    metrics.totalElevationGainMeters = totalElevationGainMeters;
  }
  if (averageSpeedMps !== undefined) {
    metrics.averageSpeedMps = averageSpeedMps;
  }
  if (maxSpeedMps !== undefined) {
    metrics.maxSpeedMps = maxSpeedMps;
  }

  return nonEmptyWorkoutMetrics(metrics);
}

function makeExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
) {
  return makeProviderExternalRef("strava", resourceType, resourceId, version, facet);
}

function pushDeletionObservation(
  events: DeviceEventPayload[],
  evidenceParts: DeviceEvidencePartPayload[],
  importedAt: string,
  deletion: PlainObject,
): void {
  const resourceType = slugify(deletion.resource_type ?? deletion.resourceType, "activity");
  const occurredAt = firstIso(deletion.occurred_at, deletion.occurredAt) ?? importedAt;
  const sourceEventType = firstString(
    deletion.source_event_type,
    deletion.sourceEventType,
    deletion.eventType,
    deletion.event_type,
  );
  const resourceId =
    stringId(deletion.resource_id ?? deletion.resourceId ?? deletion.object_id ?? deletion.objectId) ??
    buildSyntheticDeletionResourceId({
      provider: "strava",
      resourceType,
      occurredAt,
      sourceEventType,
      deletion,
    });

  pushSharedDeletionObservation(events, evidenceParts, {
    provider: "strava",
    providerDisplayName: "Strava",
    resourceType,
    resourceId,
    occurredAt,
    sourceEventType,
    makeExternalRef,
  });
}

export function normalizeStravaSnapshot(snapshot: StravaSnapshotInput): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const athlete = asPlainObject(request.athlete);
  const activities = asObjectArray(request.activities);
  const deletions = asObjectArray(request.deletions);
  const sourceWindow = asPlainObject(request.sourceWindow);
  const events: DeviceEventPayload[] = [];
  const evidenceParts: DeviceEvidencePartPayload[] = [];
  const accountId =
    stringId(request.accountId) ??
    stringId(athlete?.id ?? athlete?.athlete_id ?? athlete?.athleteId);

  pushEvidencePart(evidenceParts, createEvidencePart("athlete", "athlete.json", athlete));

  for (const activity of activities) {
    const activityId = stringId(activity.id) ?? `activity-${events.length + 1}`;
    const role = `activity:${activityId}`;
    const version = firstIso(activity.updated_at, activity.updatedAt, activity.start_date, activity.startDate);
    const occurredAt = firstIso(activity.start_date, activity.startDate) ?? importedAt;
    const recordedAt = firstIso(
      activity.updated_at,
      activity.updatedAt,
      activity.start_date_local,
      activity.startDateLocal,
      activity.start_date,
      activity.startDate,
    ) ?? occurredAt;
    const elapsedSeconds = firstNumber(activity.elapsed_time, activity.elapsedTime);
    const movingSeconds = firstNumber(activity.moving_time, activity.movingTime);
    const durationSeconds = elapsedSeconds ?? movingSeconds;
    const durationMinutes = durationSeconds !== undefined
      ? Math.max(1, Math.round(durationSeconds / 60))
      : undefined;
    const movingTimeMinutes = movingSeconds !== undefined ? movingSeconds / 60 : undefined;
    const startAt = firstIso(activity.start_date, activity.startDate) ?? occurredAt;
    const endAt = addSecondsToIso(startAt, durationSeconds);
    const dayKey = firstDayKey(activity.start_date_local, activity.start_date, occurredAt, recordedAt);
    const sportName =
      firstString(activity.sport_type, activity.sportType, activity.type, activity.activity_type, activity.activityType)
      ?? "Activity";
    const activityType = slugify(sportName, "activity");
    const distanceMeters = firstNumber(activity.distance, activity.distance_meter, activity.distanceMeter);
    const distanceKm = distanceMeters !== undefined ? distanceMeters / 1000 : undefined;
    const title = firstString(activity.name)
      ? `Strava ${firstString(activity.name)}`
      : `Strava ${sportName}`;

    pushEvidencePart(evidenceParts, createEvidencePart(role, `activity-${activityId}.json`, activity));

    if (occurredAt && durationMinutes !== undefined) {
      events.push(
        stripUndefined({
          kind: "activity_session",
          occurredAt,
          recordedAt,
          dayKey,
          source: "device",
          title: trimToLength(title, 160),
          evidenceRoles: [role],
          externalRef: makeExternalRef("activity", activityId, version),
          fields: stripUndefined({
            activityType,
            distanceKm,
            durationMinutes,
            workout: stripUndefined({
              sourceApp: "strava",
              sourceWorkoutId: activityId,
              sport: activityType,
              sportName,
              startedAt: startAt,
              endedAt: endAt,
              movingTimeMinutes,
              sessionNote: trimToLength(title, 160),
              metrics: buildStravaActivityMetrics(activity),
              exercises: [],
            }),
          }),
        }),
      );
    }
  }

  for (const deletion of deletions) {
    pushDeletionObservation(events, evidenceParts, importedAt, deletion);
  }


  const provenance = stripEmptyObject({
    athleteId: stringId(athlete?.id ?? athlete?.athlete_id ?? athlete?.athleteId),
    importedSections: {
      athlete: Boolean(athlete),
      activities: activities.length,
      deletions: deletions.length,
    },
    sourceWindow: sourceWindow
      ? stripUndefined({
          kind: firstString(sourceWindow.kind, sourceWindow.windowKind),
          resourceId: stringId(sourceWindow.resourceId),
          resourceType: firstString(sourceWindow.resourceType),
          windowEnd: firstIso(sourceWindow.windowEnd),
          windowStart: firstIso(sourceWindow.windowStart),
        })
      : undefined,
  });

  return makeNormalizedDeviceBatch({
    provider: "strava",
    accountId,
    importedAt,
    events,
    evidenceParts,
    provenance,
  });
}

export const stravaProviderAdapter: DeviceProviderAdapter<StravaSnapshotInput> = {
  ...STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseStravaSnapshot,
  normalizeSnapshot: normalizeStravaSnapshot,
};
