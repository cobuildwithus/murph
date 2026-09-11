import assert from "node:assert/strict";

import { workoutSessionSchema, type WorkoutSessionMetrics } from "@murphai/contracts";
import { test } from "vitest";

import { normalizeOuraSnapshot } from "../src/device-providers/oura.ts";

function workoutMetricsFromEvent(
  event: { fields?: { workout?: unknown } } | undefined,
): WorkoutSessionMetrics | undefined {
  const result = workoutSessionSchema.safeParse(event?.fields?.workout);
  if (!result.success) {
    assert.fail(`workout contract paths: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return result.data.metrics;
}

test("normalizeOuraSnapshot covers dailySpo2 aliasing", () => {
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
  });

  const spo2Event = payload.events?.find((event) => event.externalRef?.facet === "spo2-average");
  const readinessEvent = payload.events?.find((event) => event.externalRef?.facet === "readiness-score");

  assert.equal(payload.accountId, "oura-user-user-id");
  assert.equal(payload.provenance?.ouraUserId, "oura-user-user-id");
  assert.equal(spo2Event?.fields?.metric, "spo2");
  assert.equal(spo2Event?.fields?.value, 97.6);
  assert.equal(readinessEvent?.fields?.value, 78);
  assert.equal("heartrate" in (payload.provenance?.importedSections as Record<string, unknown>), false);
  assert.equal(payload.samples?.length ?? 0, 0);
});

test("normalizeOuraSnapshot preserves daily resource order, fallback identity, and evidence", () => {
  const importedAt = "2026-03-16T10:00:00.000Z";
  const personalInfo = { id: "synthetic-oura-account" };
  const activity = {
    id: 42,
    day: "2026-03-14",
    timestamp: "2026-03-15T01:30:00+02:00",
    score: "80",
    steps: 42,
  };
  const dailySleep = { day: "2026-03-15", score: 90 };
  const invalidReadiness = { score: "invalid", temperature_deviation: Infinity };
  const readiness = { score: 0, temperature_deviation: "-0.2" };
  const spo2 = {
    spo2_percentage: { average: 97 },
    breathing_disturbance_index: 2,
  };
  const sleep = { average_hrv: 42 };
  const payload = normalizeOuraSnapshot({
    importedAt,
    personalInfo,
    dailyActivity: [null, false, [], {}, activity],
    dailySleep: [dailySleep],
    dailyReadiness: [invalidReadiness, readiness],
    dailySpO2: [spo2],
    sleeps: [sleep],
  });

  assert.deepEqual(payload.events?.map((event) => [
    event.externalRef?.resourceType,
    event.externalRef?.resourceId,
    event.externalRef?.facet,
    event.fields?.value,
  ]), [
    ["daily-activity", "42", "activity-score", 80],
    ["daily-activity", "42", "steps", 42],
    ["daily-sleep", "2026-03-15", "sleep-score", 90],
    ["daily-readiness", "daily-readiness-4", "readiness-score", 0],
    ["daily-readiness", "daily-readiness-4", "temperature-deviation", -0.2],
    ["daily-spo2", "daily-spo2-6", "spo2-average", 97],
    ["daily-spo2", "daily-spo2-6", "breathing-disturbance-index", 2],
    ["sleep", "sleep-8", "average-hrv", 42],
  ]);
  assert.deepEqual(payload.events?.slice(0, 7).map((event) => [
    event.occurredAt, event.recordedAt, event.dayKey, event.externalRef?.version,
  ]), [
    ["2026-03-14T23:30:00.000Z", "2026-03-14T23:30:00.000Z", "2026-03-14", "2026-03-14T23:30:00.000Z"],
    ["2026-03-14T23:30:00.000Z", "2026-03-14T23:30:00.000Z", "2026-03-14", "2026-03-14T23:30:00.000Z"],
    ["2026-03-15T00:00:00.000Z", "2026-03-15T00:00:00.000Z", "2026-03-15", undefined],
    [importedAt, importedAt, "2026-03-16", undefined],
    [importedAt, importedAt, "2026-03-16", undefined],
    [importedAt, importedAt, "2026-03-16", undefined],
    [importedAt, importedAt, "2026-03-16", undefined],
  ]);
  for (const event of payload.events?.slice(0, 7) ?? []) {
    assert.equal(event.fields?.observationGrain, "summary");
    assert.equal(event.externalRef?.system, "oura");
    assert.deepEqual(event.evidenceRoles, [
      `${event.externalRef?.resourceType}:${event.externalRef?.resourceId}`,
    ]);
  }
  assert.deepEqual(payload.evidenceParts?.map((part) => [part.role, part.fileName]), [
    ["personal-info", "personal-info.json"],
    ["daily-activity:42", "daily-activity-42.json"],
    ["daily-sleep:2026-03-15", "daily-sleep-2026-03-15.json"],
    ["daily-readiness:daily-readiness-4", "daily-readiness-daily-readiness-4.json"],
    ["daily-readiness:daily-readiness-4", "daily-readiness-daily-readiness-4.json"],
    ["daily-spo2:daily-spo2-6", "daily-spo2-daily-spo2-6.json"],
    ["sleep:sleep-8", "sleep-sleep-8.json"],
  ]);
  assert.deepEqual(payload.evidenceParts?.map((part) => part.content), [
    personalInfo, activity, dailySleep, invalidReadiness, readiness, spo2, sleep,
  ]);
  assert.deepEqual(payload.provenance?.importedSections, {
    personalInfo: true,
    dailyActivity: 2,
    dailySleep: 1,
    dailyReadiness: 2,
    dailySpO2: 1,
    sleeps: 1,
    sessions: 0,
    workouts: 0,
    deletions: 0,
  });
});

test("normalizeOuraSnapshot prefers dailySpO2 even when the primary collection is empty", () => {
  const alias = [{ day: "2026-03-15", spo2_percentage: { average: 97 } }];
  for (const dailySpO2 of [[], [{ day: "2026-03-14", spo2_percentage: { average: 98 } }]]) {
    const payload = normalizeOuraSnapshot({
      importedAt: "2026-03-16T10:00:00.000Z",
      dailySpO2,
      dailySpo2: alias,
    });
    assert.deepEqual(payload.events?.map((event) => event.fields?.value), dailySpO2.length ? [98] : []);
    assert.deepEqual(payload.evidenceParts?.map((part) => part.content), dailySpO2);
  }
});

test.each(["dailyActivity", "dailySleep", "dailyReadiness", "dailySpO2"])(
  "normalizeOuraSnapshot rejects an invalid %s timestamp before day fallback",
  (collection) => {
    assert.throws(() => normalizeOuraSnapshot({
      importedAt: "2026-03-16T10:00:00.000Z",
      [collection]: [{ timestamp: "invalid", day: "2026-03-15" }],
    }), { name: "TypeError", message: "timestamp must be a valid timestamp" });
  },
);

test("normalizeOuraSnapshot preserves explicit main-sleep and nap identity without guessing unknown types", () => {
  const sleeps = [
    { id: "main", type: "sleep" },
    { id: "long", type: "long_sleep" },
    { id: "nap", type: "nap" },
    { id: "unknown", type: "other" },
    { id: "missing" },
  ].map((sleep, index) => ({
    ...sleep,
    bedtime_start: `2026-03-${String(10 + index).padStart(2, "0")}T01:00:00.000Z`,
    bedtime_end: `2026-03-${String(10 + index).padStart(2, "0")}T02:00:00.000Z`,
  }));

  const payload = normalizeOuraSnapshot({
    importedAt: "2026-03-16T10:00:00.000Z",
    sleeps,
  });
  const byId = new Map(
    payload.events
      ?.filter((event) => event.kind === "sleep_session")
      .map((event) => [event.externalRef?.resourceId, event.fields?.sleepType]),
  );

  assert.equal(byId.get("main"), "main_sleep");
  assert.equal(byId.get("long"), "main_sleep");
  assert.equal(byId.get("nap"), "nap");
  assert.equal(byId.get("unknown"), undefined);
  assert.equal(byId.get("missing"), undefined);
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
  const restSleepAverageHeartRate = payload.events?.find(
    (event) =>
      event.externalRef?.resourceId === "sleep-rest" &&
      event.kind === "observation" &&
      event.fields?.metric === "average-heart-rate",
  );
  const partialSleepRespiratoryRate = payload.events?.find(
    (event) =>
      event.externalRef?.resourceId === "sleep-partial" &&
      event.kind === "observation" &&
      event.fields?.metric === "respiratory-rate",
  );
  const partialSessionHeartRate = payload.events?.find(
    (event) =>
      event.externalRef?.resourceId === "session-partial" &&
      event.kind === "observation" &&
      event.fields?.metric === "average-heart-rate",
  );
  const partialWorkoutMetricEvents = payload.events?.filter(
    (event) =>
      event.externalRef?.resourceId === "workout-partial" &&
      event.kind === "observation",
  ) ?? [];

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
  assert.deepEqual(workoutMetricsFromEvent(unknownDistanceWorkoutEvent), {
    activeCalories: 290,
  });
  assert.equal(restSleepAverageHeartRate?.fields?.value, 55);
  assert.equal(partialSleepRespiratoryRate?.fields?.value, 11.7);
  assert.equal(partialSessionHeartRate, undefined);
  assert.equal(payload.samples?.length ?? 0, 0);
  assert.deepEqual(partialWorkoutMetricEvents, []);
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
    payload.evidenceParts?.some((artifact) => artifact.role.startsWith("deletion:sleep:sleep.deleted:")),
  );
  assert.ok(
    payload.evidenceParts?.some((artifact) => artifact.role.startsWith("deletion:session:session.deleted:")),
  );
  assert.ok(
    payload.evidenceParts?.some((artifact) => artifact.role.startsWith("deletion:workout:workout.deleted:")),
  );
});
