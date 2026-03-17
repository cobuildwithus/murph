import {
  normalizeTimestamp,
  stripEmptyObject,
  stripUndefined,
} from "../shared.js";

import type {
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
  DeviceSampleValuePayload,
} from "../core-port.js";
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.js";

interface PlainObject {
  [key: string]: unknown;
}

export interface WhoopSnapshotInput {
  accountId?: string;
  importedAt?: string | number | Date;
  profile?: unknown;
  bodyMeasurement?: unknown;
  bodyMeasurements?: unknown;
  cycles?: unknown[];
  recoveries?: unknown[];
  sleeps?: unknown[];
  workouts?: unknown[];
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
}

function trimToLength(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
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
    system: "whoop",
    resourceType,
    resourceId,
    version,
    facet,
  });
}

function pushRawArtifact(
  rawArtifacts: DeviceRawArtifactPayload[],
  artifact: DeviceRawArtifactPayload | null,
): void {
  if (!artifact) {
    return;
  }

  rawArtifacts.push(artifact);
}

function createRawArtifact(
  role: string,
  fileName: string,
  content: PlainObject | undefined,
): DeviceRawArtifactPayload | null {
  if (!content || Object.keys(content).length === 0) {
    return null;
  }

  return {
    role,
    fileName,
    mediaType: "application/json",
    content,
  };
}

function pushObservationEvent(
  events: DeviceEventPayload[],
  options: {
    metric: string;
    value: unknown;
    unit: string;
    occurredAt?: string;
    recordedAt?: string;
    title: string;
    note?: string;
    rawArtifactRoles?: string[];
    externalRef: DeviceExternalRefPayload;
  },
): void {
  const numeric = finiteNumber(options.value);
  const occurredAt = options.occurredAt ?? options.recordedAt;

  if (numeric === undefined || !occurredAt) {
    return;
  }

  events.push(
    stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: options.recordedAt,
      source: "device",
      title: trimToLength(options.title, 160),
      note: options.note ? trimToLength(options.note, 4000) : undefined,
      rawArtifactRoles: options.rawArtifactRoles,
      externalRef: options.externalRef,
      fields: {
        metric: options.metric,
        value: numeric,
        unit: options.unit,
      },
    }),
  );
}

function pushSample(
  samples: DeviceSamplePayload[],
  options: {
    stream: string;
    value: unknown;
    unit: string;
    recordedAt?: string;
    externalRef: DeviceExternalRefPayload;
  },
): void {
  const numeric = finiteNumber(options.value);

  if (numeric === undefined || !options.recordedAt) {
    return;
  }

  const sample: DeviceSampleValuePayload = {
    recordedAt: options.recordedAt,
    value: numeric,
  };

  samples.push(
    stripUndefined({
      stream: options.stream,
      recordedAt: options.recordedAt,
      source: "device",
      quality: "normalized",
      unit: options.unit,
      externalRef: options.externalRef,
      sample,
    }),
  );
}

function cycleOrFallbackTimestamp(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
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
  const events: DeviceEventPayload[] = [];
  const samples: DeviceSamplePayload[] = [];
  const rawArtifacts: DeviceRawArtifactPayload[] = [];
  const accountId =
    stringId(request.accountId) ??
    stringId(profile?.user_id ?? profile?.userId ?? profile?.id);

  pushRawArtifact(rawArtifacts, createRawArtifact("profile", "profile.json", profile));
  pushRawArtifact(rawArtifacts, createRawArtifact("body-measurement", "body-measurement.json", bodyMeasurement));

  for (const sleep of sleeps) {
    const sleepId = stringId(sleep.id) ?? `sleep-${events.length + 1}`;
    const startAt = toIso(sleep.start);
    const endAt = toIso(sleep.end);
    const recordedAt = cycleOrFallbackTimestamp(toIso(sleep.updated_at), endAt, startAt, importedAt);
    const occurredAt = startAt ?? recordedAt;
    const durationMinutes = minutesBetween(startAt, endAt);
    const sleepRole = `sleep:${sleepId}`;
    const sleepRef = makeExternalRef("sleep", sleepId, toIso(sleep.updated_at));
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

    pushSample(samples, {
      stream: "respiratory_rate",
      value: score?.respiratory_rate,
      unit: "breaths_per_minute",
      recordedAt,
      externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "respiratory-rate"),
    });

    pushObservationEvent(events, {
      metric: "sleep-performance",
      value: score?.sleep_performance_percentage,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "WHOOP sleep performance",
      rawArtifactRoles: [sleepRole],
      externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-performance"),
    });
    pushObservationEvent(events, {
      metric: "sleep-consistency",
      value: score?.sleep_consistency_percentage,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "WHOOP sleep consistency",
      rawArtifactRoles: [sleepRole],
      externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-consistency"),
    });
    pushObservationEvent(events, {
      metric: "sleep-efficiency",
      value: score?.sleep_efficiency_percentage,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "WHOOP sleep efficiency",
      rawArtifactRoles: [sleepRole],
      externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-efficiency"),
    });

    if (stageSummary) {
      pushObservationEvent(events, {
        metric: "sleep-awake-minutes",
        value: finiteNumber(stageSummary.total_awake_time_milli) !== undefined
          ? Number(stageSummary.total_awake_time_milli) / 60000
          : undefined,
        unit: "minutes",
        occurredAt,
        recordedAt,
        title: "WHOOP awake time",
        rawArtifactRoles: [sleepRole],
        externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-awake-minutes"),
      });
      pushObservationEvent(events, {
        metric: "sleep-light-minutes",
        value: finiteNumber(stageSummary.total_light_sleep_time_milli) !== undefined
          ? Number(stageSummary.total_light_sleep_time_milli) / 60000
          : undefined,
        unit: "minutes",
        occurredAt,
        recordedAt,
        title: "WHOOP light sleep",
        rawArtifactRoles: [sleepRole],
        externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-light-minutes"),
      });
      pushObservationEvent(events, {
        metric: "sleep-deep-minutes",
        value: finiteNumber(stageSummary.total_slow_wave_sleep_time_milli) !== undefined
          ? Number(stageSummary.total_slow_wave_sleep_time_milli) / 60000
          : undefined,
        unit: "minutes",
        occurredAt,
        recordedAt,
        title: "WHOOP deep sleep",
        rawArtifactRoles: [sleepRole],
        externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-deep-minutes"),
      });
      pushObservationEvent(events, {
        metric: "sleep-rem-minutes",
        value: finiteNumber(stageSummary.total_rem_sleep_time_milli) !== undefined
          ? Number(stageSummary.total_rem_sleep_time_milli) / 60000
          : undefined,
        unit: "minutes",
        occurredAt,
        recordedAt,
        title: "WHOOP REM sleep",
        rawArtifactRoles: [sleepRole],
        externalRef: makeExternalRef("sleep", sleepId, toIso(sleep.updated_at), "sleep-rem-minutes"),
      });
    }
  }

  for (const recovery of recoveries) {
    const sleepId = stringId(recovery.sleep_id) ?? stringId(recovery.cycle_id) ?? `recovery-${events.length + 1}`;
    const recoveryRole = `recovery:${sleepId}`;
    const recordedAt = cycleOrFallbackTimestamp(toIso(recovery.updated_at), importedAt);
    const occurredAt = recordedAt;
    const score = asPlainObject(recovery.score);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(recoveryRole, `recovery-${sleepId}.json`, recovery),
    );

    pushSample(samples, {
      stream: "hrv",
      value: score?.hrv_rmssd_milli,
      unit: "ms",
      recordedAt,
      externalRef: makeExternalRef("recovery", sleepId, toIso(recovery.updated_at), "hrv"),
    });
    pushSample(samples, {
      stream: "temperature",
      value: score?.skin_temp_celsius,
      unit: "celsius",
      recordedAt,
      externalRef: makeExternalRef("recovery", sleepId, toIso(recovery.updated_at), "skin-temperature"),
    });

    pushObservationEvent(events, {
      metric: "recovery-score",
      value: score?.recovery_score,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "WHOOP recovery score",
      rawArtifactRoles: [recoveryRole],
      externalRef: makeExternalRef("recovery", sleepId, toIso(recovery.updated_at), "recovery-score"),
    });
    pushObservationEvent(events, {
      metric: "resting-heart-rate",
      value: score?.resting_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "WHOOP resting heart rate",
      rawArtifactRoles: [recoveryRole],
      externalRef: makeExternalRef("recovery", sleepId, toIso(recovery.updated_at), "resting-heart-rate"),
    });
    pushObservationEvent(events, {
      metric: "spo2",
      value: score?.spo2_percentage,
      unit: "%",
      occurredAt,
      recordedAt,
      title: "WHOOP SpO2",
      rawArtifactRoles: [recoveryRole],
      externalRef: makeExternalRef("recovery", sleepId, toIso(recovery.updated_at), "spo2"),
    });
  }

  for (const cycle of cycles) {
    const cycleId = stringId(cycle.id) ?? `cycle-${events.length + 1}`;
    const cycleRole = `cycle:${cycleId}`;
    const startAt = toIso(cycle.start);
    const endAt = toIso(cycle.end);
    const recordedAt = cycleOrFallbackTimestamp(toIso(cycle.updated_at), endAt, startAt, importedAt);
    const occurredAt = endAt ?? startAt ?? recordedAt;
    const score = asPlainObject(cycle.score);

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(cycleRole, `cycle-${cycleId}.json`, cycle),
    );

    pushObservationEvent(events, {
      metric: "day-strain",
      value: score?.strain,
      unit: "whoop_strain",
      occurredAt,
      recordedAt,
      title: "WHOOP day strain",
      rawArtifactRoles: [cycleRole],
      externalRef: makeExternalRef("cycle", cycleId, toIso(cycle.updated_at), "day-strain"),
    });
    pushObservationEvent(events, {
      metric: "energy-burned",
      value: score?.kilojoule,
      unit: "kJ",
      occurredAt,
      recordedAt,
      title: "WHOOP energy burned",
      rawArtifactRoles: [cycleRole],
      externalRef: makeExternalRef("cycle", cycleId, toIso(cycle.updated_at), "energy-burned"),
    });
    pushObservationEvent(events, {
      metric: "average-heart-rate",
      value: score?.average_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "WHOOP average heart rate",
      rawArtifactRoles: [cycleRole],
      externalRef: makeExternalRef("cycle", cycleId, toIso(cycle.updated_at), "average-heart-rate"),
    });
    pushObservationEvent(events, {
      metric: "max-heart-rate",
      value: score?.max_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "WHOOP max heart rate",
      rawArtifactRoles: [cycleRole],
      externalRef: makeExternalRef("cycle", cycleId, toIso(cycle.updated_at), "max-heart-rate"),
    });
  }

  for (const workout of workouts) {
    const workoutId = stringId(workout.id) ?? `workout-${events.length + 1}`;
    const workoutRole = `workout:${workoutId}`;
    const startAt = toIso(workout.start);
    const endAt = toIso(workout.end);
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
          externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at)),
          fields: stripUndefined({
            activityType,
            durationMinutes,
            distanceKm:
              finiteNumber(score?.distance_meter ?? workout.distance_meter) !== undefined
                ? Number(score?.distance_meter ?? workout.distance_meter) / 1000
                : undefined,
          }),
        }),
      );
    }

    pushObservationEvent(events, {
      metric: "workout-strain",
      value: score?.strain,
      unit: "whoop_strain",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} strain`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "workout-strain"),
    });
    pushObservationEvent(events, {
      metric: "average-heart-rate",
      value: score?.average_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} average heart rate`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "average-heart-rate"),
    });
    pushObservationEvent(events, {
      metric: "max-heart-rate",
      value: score?.max_heart_rate,
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} max heart rate`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "max-heart-rate"),
    });
    pushObservationEvent(events, {
      metric: "energy-burned",
      value: score?.kilojoule,
      unit: "kJ",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} energy burned`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "energy-burned"),
    });
    pushObservationEvent(events, {
      metric: "percent-recorded",
      value: score?.percent_recorded,
      unit: "%",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} percent recorded`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "percent-recorded"),
    });
    pushObservationEvent(events, {
      metric: "altitude-gain",
      value: finiteNumber(workout.altitude_gain_meter),
      unit: "meter",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} altitude gain`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "altitude-gain"),
    });
    pushObservationEvent(events, {
      metric: "altitude-change",
      value: finiteNumber(workout.altitude_change_meter),
      unit: "meter",
      occurredAt,
      recordedAt,
      title: `WHOOP ${sportName} altitude change`,
      rawArtifactRoles: [workoutRole],
      externalRef: makeExternalRef("workout", workoutId, toIso(workout.updated_at), "altitude-change"),
    });
  }

  const provenance = stripEmptyObject({
    whoopUserId: stringId(profile?.user_id ?? profile?.userId ?? profile?.id),
    importedSections: {
      profile: Boolean(profile),
      bodyMeasurement: Boolean(bodyMeasurement),
      sleeps: sleeps.length,
      recoveries: recoveries.length,
      cycles: cycles.length,
      workouts: workouts.length,
    },
  });

  return stripUndefined({
    provider: "whoop",
    accountId,
    importedAt,
    source: "device",
    events,
    samples,
    rawArtifacts,
    provenance,
  });
}

export const whoopProviderAdapter: DeviceProviderAdapter<WhoopSnapshotInput> = {
  provider: "whoop",
  normalizeSnapshot: normalizeWhoopSnapshot,
};
