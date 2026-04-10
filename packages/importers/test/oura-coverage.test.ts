import assert from "node:assert/strict";

import { test } from "vitest";

import { normalizeOuraSnapshot } from "../src/device-providers/oura.ts";

test("normalizeOuraSnapshot covers dailySpo2 aliasing, heartRate aliasing, and provenance fallbacks", () => {
  const payload = normalizeOuraSnapshot({
    importedAt: "2026-03-16T10:00:00.000Z",
    personalInfo: {
      user_id: "oura-user-user-id",
    },
    dailySpo2: [
      {
        day: "2026-03-15",
        spo2_percentage: {
          average: 97.6,
        },
        breathing_disturbance_index: 1,
      },
    ],
    dailyReadiness: [
      {
        day: "2026-03-15",
        score: 78,
      },
    ],
    heartRate: [
      {
        timestamp: "2026-03-15T12:00:00.000Z",
        bpm: 61,
        source: "Resting HR",
      },
      {
        timestamp: "2026-03-15T12:05:00.000Z",
        bpm: 63,
      },
    ],
  });

  const spo2Event = payload.events?.find((event) => event.externalRef?.facet === "spo2-average");
  const readinessEvent = payload.events?.find((event) => event.externalRef?.facet === "readiness-score");
  const slugifiedHeartRateSample = payload.samples?.find(
    (sample) => sample.externalRef?.facet === "resting-hr",
  );
  const fallbackHeartRateSample = payload.samples?.find(
    (sample) => sample.externalRef?.facet === "sample",
  );

  assert.equal(payload.accountId, "oura-user-user-id");
  assert.equal(payload.provenance?.ouraUserId, "oura-user-user-id");
  assert.equal(spo2Event?.fields?.metric, "spo2");
  assert.equal(spo2Event?.fields?.value, 97.6);
  assert.equal(readinessEvent?.fields?.value, 78);
  assert.equal(slugifiedHeartRateSample?.sample.value, 61);
  assert.equal(fallbackHeartRateSample?.sample.value, 63);
});

test("normalizeOuraSnapshot covers sleep deleted, rest, nap, and partial timing branches", () => {
  const payload = normalizeOuraSnapshot({
    importedAt: "2026-03-16T10:00:00.000Z",
    personalInfo: {
      userId: "oura-user-user-id-2",
    },
    sleeps: [
      {
        id: "sleep-deleted",
        type: "deleted",
        timestamp: "2026-03-15T06:50:00.000Z",
      },
      {
        id: "sleep-rest",
        type: "rest",
        bedtime_start: "2026-03-14T22:00:00.000Z",
        bedtime_end: "2026-03-15T06:00:00.000Z",
        timestamp: "2026-03-15T06:05:00.000Z",
        average_breath: 13.2,
        average_hrv: 41.4,
        average_heart_rate: 55,
      },
      {
        id: "sleep-nap",
        type: "nap",
        bedtime_start: "2026-03-15T13:00:00.000Z",
        bedtime_end: "2026-03-15T13:40:00.000Z",
        timestamp: "2026-03-15T13:45:00.000Z",
        average_breath: 12.1,
        average_hrv: 39.8,
        average_heart_rate: 58,
      },
      {
        id: "sleep-partial",
        type: "sleep",
        bedtime_start: "2026-03-15T22:00:00.000Z",
        timestamp: "2026-03-15T22:05:00.000Z",
        average_breath: 11.7,
        average_hrv: 38.1,
        average_heart_rate: 54,
      },
    ],
    sessions: [
      {
        id: "session-partial",
        type: "meditation",
        start_datetime: "2026-03-15T14:00:00.000Z",
        timestamp: "2026-03-15T14:05:00.000Z",
        heart_rate: 62,
        heart_rate_variability: 46,
      },
    ],
    workouts: [
      {
        id: "workout-partial",
        activity_type: "cycling",
        start_datetime: "2026-03-15T18:00:00.000Z",
        timestamp: "2026-03-15T18:05:00.000Z",
        calories: 320,
        distance: 4800,
      },
      {
        id: "workout-unknown-distance",
        sport_name: "Rowing",
        start_datetime: "2026-03-15T19:00:00.000Z",
        end_datetime: "2026-03-15T19:30:00.000Z",
        timestamp: "2026-03-15T19:35:00.000Z",
        calories: 290,
        distance: "not-a-number",
        distance_meter: "",
        distance_meters: null,
      },
    ],
  });

  const deletedSleepEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "sleep-deleted" && event.externalRef?.facet === "deleted",
  );
  const napSleepEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "sleep-nap" && event.kind === "sleep_session",
  );
  const restSleepEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "sleep-rest" && event.kind === "sleep_session",
  );
  const partialSleepEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "sleep-partial" && event.kind === "sleep_session",
  );
  const partialSessionEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "session-partial" && event.kind === "activity_session",
  );
  const partialWorkoutEvent = payload.events?.find(
    (event) => event.externalRef?.resourceId === "workout-partial" && event.kind === "activity_session",
  );
  const unknownDistanceWorkoutEvent = payload.events?.find(
    (event) =>
      event.externalRef?.resourceId === "workout-unknown-distance" && event.kind === "activity_session",
  );

  assert.equal(payload.accountId, "oura-user-user-id-2");
  assert.equal(payload.provenance?.ouraUserId, "oura-user-user-id-2");
  assert.equal(deletedSleepEvent?.fields?.resourceType, "sleep");
  assert.equal(deletedSleepEvent?.fields?.sourceEventType, "sleep.deleted");
  assert.equal(napSleepEvent?.title, "Oura nap");
  assert.equal(restSleepEvent, undefined);
  assert.equal(partialSleepEvent, undefined);
  assert.equal(partialSessionEvent, undefined);
  assert.equal(partialWorkoutEvent, undefined);
  assert.ok(unknownDistanceWorkoutEvent);
  assert.equal(unknownDistanceWorkoutEvent?.fields?.activityType, "rowing");
  assert.equal(unknownDistanceWorkoutEvent?.fields?.distanceKm, undefined);
  assert.ok(
    payload.samples?.some((sample) => sample.externalRef?.resourceId === "sleep-rest" && sample.stream === "heart_rate"),
  );
  assert.ok(
    payload.samples?.some(
      (sample) => sample.externalRef?.resourceId === "sleep-partial" && sample.stream === "respiratory_rate",
    ),
  );
  assert.ok(
    payload.samples?.some(
      (sample) => sample.externalRef?.resourceId === "session-partial" && sample.stream === "heart_rate",
    ),
  );
  assert.ok(
    payload.events?.some(
      (event) =>
        event.externalRef?.resourceId === "workout-partial" &&
        event.kind === "observation" &&
        event.fields?.metric === "distance" &&
        event.fields?.value === 4800,
    ),
  );
});

test("normalizeOuraSnapshot covers deletion resource and event fallbacks", () => {
  const payload = normalizeOuraSnapshot({
    importedAt: "2026-03-16T12:00:00.000Z",
    deletions: [
      {
        resourceType: "sleep",
        resourceId: "sleep-camel",
        event_type: "sleep.deleted",
      },
      {
        data_type: "session",
        objectId: "session-camel",
        sourceEventType: "session.deleted",
      },
      {
        dataType: "workout",
        object_id: "workout-snake",
        eventType: "workout.deleted",
      },
    ],
  });

  const camelDeletion = payload.events?.find(
    (event) => event.externalRef?.resourceId === "sleep-camel" && event.externalRef?.facet === "deleted",
  );
  const objectIdDeletion = payload.events?.find(
    (event) => event.externalRef?.resourceId === "session-camel" && event.externalRef?.facet === "deleted",
  );
  const dataTypeDeletion = payload.events?.find(
    (event) => event.externalRef?.resourceId === "workout-snake" && event.externalRef?.facet === "deleted",
  );

  assert.equal(camelDeletion?.externalRef?.resourceType, "sleep");
  assert.equal(camelDeletion?.fields?.sourceEventType, "sleep.deleted");
  assert.equal(objectIdDeletion?.externalRef?.resourceType, "session");
  assert.equal(objectIdDeletion?.fields?.sourceEventType, "session.deleted");
  assert.equal(dataTypeDeletion?.externalRef?.resourceType, "workout");
  assert.equal(dataTypeDeletion?.fields?.sourceEventType, "workout.deleted");
  assert.ok(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("deletion:sleep:sleep-camel:")),
  );
  assert.ok(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("deletion:session:session-camel:")),
  );
  assert.ok(
    payload.rawArtifacts?.some((artifact) => artifact.role.startsWith("deletion:workout:workout-snake:")),
  );
});
