import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildJournalView } from "../src/journal-view.ts";
import type { MetricPoint } from "../src/metrics/index.ts";
import { createVaultReadModel } from "../src/read-model.ts";

test("Journal groups canonical records into human events without copying source data", () => {
  const tennis = event(
    "tennis",
    "activity_session",
    "2026-08-20T18:00:00.000Z",
    {
      activityType: "tennis",
      durationMinutes: 74,
      source: "device",
      timeZone: "America/New_York",
    },
    "Tennis",
  );
  const quality = event(
    "tennis_quality",
    "note",
    "2026-08-20T19:30:00.000Z",
    {
      note: "Played well.",
      noteType: "journal-outcome",
      source: "manual",
    },
    "Played well",
    [{ targetId: tennis.entityId, type: "related_to" }],
  );
  const pain = event(
    "tennis_pain",
    "note",
    "2026-08-20T19:31:00.000Z",
    {
      note: "Elbow feels sore.",
      noteType: "journal-outcome",
      source: "manual",
    },
    "Elbow feels sore",
    [{ targetId: tennis.entityId, type: "related_to" }],
  );
  const sleep = event(
    "sleep",
    "sleep_session",
    "2026-08-20T07:00:00.000Z",
    {
      durationMinutes: 420,
      source: "device",
    },
    "Sleep",
  );
  const bloodTest = event(
    "blood",
    "test",
    "2026-08-20T09:00:00.000Z",
    {
      source: "import",
      testName: "Blood panel",
    },
    "Blood panel",
  );
  const oldJournalDay = entity("journal", "journal_day", {
    date: "2026-08-20",
    kind: "journal_day",
    title: "Legacy daily journal",
  });
  const view = buildJournalView(
    createVaultReadModel({
      entities: [tennis, quality, pain, sleep, bloodTest, oldJournalDay],
      vaultRoot: "test://journal-view",
    }),
    [
      metric("sleep-score", "2026-08-20", 61, "score"),
      metric("hrv-rmssd", "2026-08-20", 42, "ms"),
    ],
    { asOf: "2026-08-21T12:00:00.000Z" },
  );

  assert.equal(view.days.length, 1);
  assert.equal(view.eventCount, 3);
  assert.equal(view.recordCount, 7);
  const events = view.days[0]?.events ?? [];
  const sleepEvent = events.find((entry) => entry.kind === "sleep");
  const activityEvent = events.find((entry) => entry.kind === "activity");
  const testEvent = events.find((entry) => entry.kind === "test");
  assert.deepEqual(
    events.map((entry) => entry.kind),
    ["sleep", "test", "activity"],
  );
  assert.deepEqual(sleepEvent?.records.map((record) => record.label).sort(), [
    "HRV",
    "Sleep",
    "Sleep score",
  ]);
  assert.deepEqual(activityEvent?.records.map((record) => record.id).sort(), [
    "tennis",
    "tennis_pain",
    "tennis_quality",
  ]);
  assert.equal(activityEvent?.occurredAt, "2026-08-20T18:00:00.000Z");
  assert.equal(activityEvent?.timeZone, "America/New_York");
  assert.equal(testEvent?.title, "Blood panel");
  assert.equal(
    events.some((entry) => entry.id.includes("journal_day")),
    false,
  );
});

test("Journal remains useful with notes only and keeps independent facts separate", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "sauna",
          "note",
          "2026-08-20T18:00:00.000Z",
          {
            note: "Sauna at 90 C for 20 minutes.",
            noteType: "journal-factor",
            source: "manual",
          },
          "Sauna",
        ),
        event(
          "dinner",
          "note",
          "2026-08-20T21:00:00.000Z",
          {
            note: "Late dinner.",
            noteType: "journal-factor",
            source: "manual",
          },
          "Late dinner",
        ),
      ],
      vaultRoot: "test://journal-notes-only",
    }),
    [],
    { asOf: "2026-08-20" },
  );

  assert.equal(view.eventCount, 2);
  assert.deepEqual(view.days[0]?.events.map((entry) => entry.title), [
    "Sauna",
    "Late dinner",
  ]);
});

test("Journal keeps canonical meal ingredients concise and moves prose to details", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "meal_1",
          "meal",
          "2026-08-20T12:30:00.000Z",
          {
            ingredients: ["Eggs", "Spinach", "Toast", "Olive oil"],
            summary: "Photo estimate with ingredients and uncertain portions.",
            nutrition: {
              totals: {
                calories: 540,
                proteinGrams: 31,
              },
            },
            source: "manual",
          },
          "Meal",
        ),
      ],
      vaultRoot: "test://journal-meal",
    }),
    [],
    { asOf: "2026-08-20" },
  );

  const meal = view.days[0]?.events[0];
  assert.equal(meal?.kind, "meal");
  assert.equal(meal?.title, "Meal");
  assert.equal(meal?.summary, "Eggs, Spinach, Toast");
  assert.deepEqual(meal?.details, [
    "Photo estimate with ingredients and uncertain portions.",
    "Ingredients: Eggs, Spinach, Toast, Olive oil",
    "Energy: 540 kcal",
    "Protein: 31 g",
  ]);
});

test("Journal does not repeat a descriptive meal title in the timeline", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "meal_named",
          "meal",
          "2026-08-20T17:00:00.000Z",
          {
            dishName: "Vegetable stir-fry",
            ingredients: ["Noodles", "Vegetables", "Egg"],
            summary: "A detailed photo estimate with uncertain portions.",
          },
          "Vegetable stir-fry",
        ),
      ],
      vaultRoot: "test://journal-named-meal",
    }),
    [],
    { asOf: "2026-08-20" },
  );

  const meal = view.days[0]?.events[0];
  assert.equal(meal?.title, "Vegetable stir-fry");
  assert.equal(meal?.summary, null);
  assert.deepEqual(meal?.details, [
    "A detailed photo estimate with uncertain portions.",
    "Ingredients: Noodles, Vegetables, Egg",
  ]);
});

test("Journal turns dense wearable records into main sleep, naps, and grouped activity", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "main_sleep",
          "sleep_session",
          "2026-08-25T08:57:00.000Z",
          {
            durationMinutes: 450,
            sleepType: "main_sleep",
            source: "oura",
          },
          "Sleep",
        ),
        event(
          "nap",
          "sleep_session",
          "2026-08-25T15:30:00.000Z",
          {
            durationMinutes: 25,
            sleepType: "nap",
            source: "oura",
          },
          "Sleep",
        ),
        event(
          "yard_1",
          "activity_session",
          "2026-08-25T10:00:00.000Z",
          {
            activityType: "yardwork",
            durationMinutes: 81,
            source: "oura",
          },
          "yardwork",
        ),
        event(
          "yard_2",
          "activity_session",
          "2026-08-25T13:00:00.000Z",
          {
            activityType: "yardwork",
            durationMinutes: 41,
            source: "oura",
          },
          "yardwork",
        ),
        event(
          "yard_3",
          "activity_session",
          "2026-08-25T17:00:00.000Z",
          {
            activityType: "yardwork",
            durationMinutes: 48,
            source: "oura",
          },
          "yardwork",
        ),
        event(
          "profile",
          "note",
          "2026-08-25T20:45:00.000Z",
          {
            source: "oura",
            summary: "Biological sex: male.",
          },
          "Junction profile",
        ),
      ],
      vaultRoot: "test://journal-wearable-density",
    }),
    [
      metric("total-sleep", "2026-08-25", 450, "min"),
      metric("sleep-efficiency", "2026-08-25", 89, "percent"),
      metric("hrv-rmssd", "2026-08-25", 68.1429, "ms"),
      metric("readiness-score", "2026-08-25", 71, "score"),
      metric("recovery-score", "2026-08-25", 71, "score"),
      metric("sleep-score", "2026-08-25", 78, "score"),
    ],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.equal(view.eventCount, 3);
  const events = view.days[0]?.events ?? [];
  const mainSleep = events.find((entry) => entry.kind === "sleep");
  const nap = events.find((entry) => entry.kind === "nap");
  const yardWork = events.find((entry) => entry.kind === "activity");

  assert.equal(mainSleep?.timing, "night");
  assert.equal(mainSleep?.summary, "7 h 30 · sleep score 78");
  assert.deepEqual(mainSleep?.details, []);
  assert.deepEqual(mainSleep?.metrics, {
    activityMinutes: 0,
    deepSleepMinutes: null,
    hrvMs: 68.1429,
    readinessScore: 71,
    recoveryScore: null,
    remSleepMinutes: null,
    respiratoryRate: null,
    restingHeartRateBpm: null,
    sleepEfficiencyPercent: 89,
    sleepMinutes: 450,
    sleepScore: 78,
    spo2Percent: null,
  });
  assert.equal(
    mainSleep?.records.some((record) => record.label === "Recovery score"),
    false,
  );
  assert.equal(
    mainSleep?.records.some((record) => record.label === "Total sleep"),
    false,
  );

  assert.equal(nap?.timing, "timed");
  assert.equal(nap?.title, "Nap");
  assert.equal(nap?.summary, "25 min");

  assert.equal(yardWork?.title, "Yard work");
  assert.equal(yardWork?.summary, "2 h 50 across 3 sessions");
  assert.equal(yardWork?.metrics.activityMinutes, 170);
  assert.deepEqual(yardWork?.records.map((record) => record.id).sort(), [
    "yard_1",
    "yard_2",
    "yard_3",
  ]);
  assert.equal(
    events.some((entry) => entry.id.includes("profile")),
    false,
  );
  assert.deepEqual(view.weeks, [
    {
      activityMinutes: 170,
      averageSleepMinutes: 450,
      averageSleepScore: 78,
      endDate: "2026-08-30",
      sleepNights: 1,
      startDate: "2026-08-24",
    },
  ]);
});

test("Journal keeps useful workout detail in the activity popover", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "workout",
          "activity_session",
          "2026-08-25T17:30:00.000Z",
          {
            activityType: "cycling",
            durationMinutes: 72,
            source: "whoop",
            workout: {
              exercises: [{ name: "Front squat" }, { name: "Deadlift" }],
              metrics: {
                activeCalories: 640,
                averageHeartRateBpm: 142,
                maxHeartRateBpm: 176,
                totalElevationGainMeters: 310,
                workoutStrain: 14.2,
              },
              routineName: "Strength Base",
            },
            distanceKm: 32.4,
          },
          "Cycling",
        ),
      ],
      vaultRoot: "test://journal-workout-detail",
    }),
    [],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.deepEqual(view.days[0]?.events[0]?.details, [
    "Strength Base",
    "Distance: 32.4 km",
    "Average heart rate: 142 bpm",
    "Maximum heart rate: 176 bpm",
    "Strain: 14.2",
    "Active energy: 640 kcal",
    "Elevation gain: 310 m",
    "Exercises: Deadlift, Front squat",
  ]);
});

test("Journal combines exercises across grouped activity sessions", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "strength_1",
          "activity_session",
          "2026-08-25T17:30:00.000Z",
          {
            activityType: "strength_training",
            durationMinutes: 30,
            workout: {
              exercises: [{ name: "Bench press" }, { name: "Lunge" }],
            },
          },
          "Strength training",
        ),
        event(
          "strength_2",
          "activity_session",
          "2026-08-25T18:00:00.000Z",
          {
            activityType: "strength_training",
            durationMinutes: 25,
            workout: {
              exercises: [{ name: "Lunge" }, { name: "Calf raise" }],
            },
          },
          "Strength training",
        ),
      ],
      vaultRoot: "test://journal-combined-exercises",
    }),
    [],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.deepEqual(view.days[0]?.events[0]?.details, [
    "Exercises: Bench press, Calf raise, Lunge",
  ]);
});

test("Journal groups activity aliases with the shared vocabulary", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "dance_1",
          "activity_session",
          "2026-08-25T17:30:00.000Z",
          { activityType: "dancing", durationMinutes: 30 },
          "Dancing",
        ),
        event(
          "dance_2",
          "activity_session",
          "2026-08-25T18:00:00.000Z",
          { activityType: "cardio_dance", durationMinutes: 25 },
          "Cardio dance",
        ),
      ],
      vaultRoot: "test://journal-activity-vocabulary",
    }),
    [],
    {
      asOf: "2026-08-25T22:00:00.000Z",
      vocabulary: {
        concepts: [
          {
            aliases: ["cardio-dance", "dancing"],
            icon: "dance",
            id: "dance",
            label: "Dance",
          },
        ],
        version: 1,
      },
    },
  );

  assert.equal(view.eventCount, 1);
  assert.equal(view.days[0]?.events[0]?.title, "Dance");
  assert.equal(view.days[0]?.events[0]?.summary, "55 min across 2 sessions");
});

test("Journal groups deterministic activity aliases without vocabulary", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "run_1",
          "activity_session",
          "2026-08-25T07:00:00.000Z",
          { activityType: "run", durationMinutes: 20 },
          "Run",
        ),
        event(
          "run_2",
          "activity_session",
          "2026-08-25T18:00:00.000Z",
          { activityType: "running", durationMinutes: 35 },
          "Running",
        ),
      ],
      vaultRoot: "test://journal-canonical-activity-aliases",
    }),
    [],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.equal(view.eventCount, 1);
  assert.equal(view.days[0]?.events[0]?.title, "Running");
  assert.equal(view.days[0]?.events[0]?.summary, "55 min across 2 sessions");
});

test("Journal keeps test results in details and hides raw capture attachments", () => {
  const hearingTest = event(
    "hearing_test",
    "test",
    "2026-08-25T12:00:00.000Z",
    {
      note: "Screenshot provided by member.",
      resultSummary: "Hearing result was within the expected range.",
      testName: "AirPods hearing test",
    },
    "AirPods hearing test",
  );
  const generatedImage = {
    ...event(
      "generated_image",
      "note",
      "2026-08-25T12:01:00.000Z",
      { note: "Saved for visual reuse." },
      "Generated image",
    ),
    tags: ["assistant-generated-image", "generated-image"],
  };
  const rawCapture = {
    ...event(
      "raw_capture",
      "note",
      "2026-08-25T12:02:00.000Z",
      { note: "Collection: posture-study" },
      "Capture - posture-study",
    ),
    tags: ["capture", "collection-posture-study"],
  };
  const bloodTest = event(
    "blood_test",
    "test",
    "2026-08-25T13:00:00.000Z",
    {
      flaggedCount: 3,
      markerCount: 18,
      resultSummary: "Three markers are outside their reference ranges.",
      testName: "Blood test results",
    },
    "Blood test results",
  );
  const view = buildJournalView(
    createVaultReadModel({
      entities: [hearingTest, generatedImage, rawCapture, bloodTest],
      vaultRoot: "test://journal-structured-result",
    }),
    [],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.equal(view.eventCount, 2);
  assert.equal(view.days[0]?.events[0]?.title, "AirPods hearing test");
  assert.equal(view.days[0]?.events[0]?.summary, null);
  assert.deepEqual(view.days[0]?.events[0]?.details, [
    "Summary: Hearing result was within the expected range.",
  ]);
  assert.equal(view.days[0]?.events[1]?.title, "Blood test results");
  assert.equal(view.days[0]?.events[1]?.summary, "18 markers · 3 need attention");
  assert.deepEqual(view.days[0]?.events[1]?.details, [
    "Markers: 18",
    "Flagged: 3",
    "Summary: Three markers are outside their reference ranges.",
  ]);
});

test("Journal omits missing and repeated activity details", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "yard_work",
          "activity_session",
          "2026-08-25T12:37:00.000Z",
          {
            activityType: "yardwork",
            source: "oura",
            workout: {
              metrics: { activeCalories: 925 },
              routineName: "Unknown",
              sportName: "Yard work",
            },
            distanceKm: 0,
          },
          "Yard work",
        ),
      ],
      vaultRoot: "test://journal-activity-detail-cleanup",
    }),
    [],
    { asOf: "2026-08-25T22:00:00.000Z" },
  );

  assert.deepEqual(view.days[0]?.events[0]?.details, [
    "Active energy: 925 kcal",
  ]);
});

test("Journal keeps source note summaries and experiment results without tag rules", () => {
  const lateCaffeine = {
    ...event(
      "late_caffeine",
      "note",
      "2026-08-25T16:30:00.000Z",
      {
        note: "Coffee late in the afternoon.",
        noteType: "journal-factor",
      },
      "Late caffeine",
    ),
    tags: ["key-late-caffeine"],
  };
  const workTrip = {
    ...event(
      "work_trip",
      "note",
      "2026-08-25T12:00:00.000Z",
      {
        destination: "Berlin",
        detail: "Hotel stay with two work meetings.",
        duration: "Four nights",
        note: "Berlin · four nights",
      },
      "Work trip",
    ),
    tags: ["episode-work-trip"],
  };
  const activeExperiment = event(
    "active_experiment",
    "experiment_context",
    "2026-08-25T08:00:00.000Z",
    {
      progress: "Day 6 of 14",
      resultSummary: "Sleep duration is above the baseline so far.",
      status: "active",
    },
    "Magnesium for Sleep",
  );
  const completedExperiment = event(
    "completed_experiment",
    "experiment_context",
    "2026-08-24T08:00:00.000Z",
    {
      progress: "14 of 14 days",
      resultSummary: "Sleep timing became more consistent.",
      status: "completed",
    },
    "Consistent Wake Time",
  );

  const view = buildJournalView(
    createVaultReadModel({
      entities: [lateCaffeine, workTrip, activeExperiment, completedExperiment],
      vaultRoot: "test://journal-concise-context",
    }),
    [],
    { asOf: "2026-08-25" },
  );
  const events = view.days.flatMap((day) => day.events);

  assert.equal(
    events.find((entry) => entry.title === "Late caffeine")?.summary,
    "Coffee late in the afternoon.",
  );
  assert.equal(
    events.find((entry) => entry.title === "Work trip")?.summary,
    "Berlin · four nights",
  );
  assert.deepEqual(
    events.find((entry) => entry.title === "Work trip")?.details,
    [
      "Hotel stay with two work meetings.",
      "Destination: Berlin",
      "Duration: Four nights",
    ],
  );
  assert.equal(
    events.find((entry) => entry.title === "Magnesium for Sleep")?.summary,
    "Running experiment · day 6",
  );
  assert.deepEqual(
    events.find((entry) => entry.title === "Magnesium for Sleep")?.details,
    [
      "Status: Active",
      "Progress: Day 6 of 14",
      "Result: Sleep duration is above the baseline so far.",
    ],
  );
  assert.equal(
    events.find((entry) => entry.title === "Consistent Wake Time")?.summary,
    "Experiment completed",
  );
});

test("Journal shows each planned experiment day without writing new events", () => {
  const experiment = entity("experiment", "experiment_daily", {
    attributes: {
      endedOn: "2026-08-25",
      runPlan: {
        baselineEnd: "2026-08-21",
        baselineStart: "2026-08-20",
        interventionEnd: "2026-08-25",
        interventionStart: "2026-08-22",
      },
      status: "completed",
      title: "Magnesium for Sleep",
    },
    date: "2026-08-20",
    kind: "experiment_entry",
    occurredAt: "2026-08-20T08:00:00.000Z",
    status: "completed",
    title: "Magnesium for Sleep",
  });

  const view = buildJournalView(
    createVaultReadModel({
      entities: [experiment],
      vaultRoot: "test://journal-daily-experiment",
    }),
    [],
    { asOf: "2026-08-25" },
  );
  const summariesByDate = new Map(
    view.days.map((day) => [day.date, day.events[0]?.summary]),
  );

  assert.deepEqual(
    [...summariesByDate.entries()],
    [
      ["2026-08-25", "Experiment completed"],
      ["2026-08-24", "Running experiment · day 3"],
      ["2026-08-23", "Running experiment · day 2"],
      ["2026-08-22", "Experiment started"],
      ["2026-08-21", "Baseline · day 2"],
      ["2026-08-20", "Baseline · day 1"],
    ],
  );
  assert.equal(view.recordCount, 6);
});

test("Journal uses the longest unknown sleep as the night and keeps shorter sleep separate", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "unknown_main",
          "sleep_session",
          "2026-08-23T09:00:00.000Z",
          {
            durationMinutes: 507,
            source: "oura",
          },
          "Sleep",
        ),
        event(
          "unknown_nap",
          "sleep_session",
          "2026-08-23T14:07:00.000Z",
          {
            durationMinutes: 25,
            source: "oura",
          },
          "Sleep",
        ),
      ],
      vaultRoot: "test://journal-unknown-sleep",
    }),
    [],
    { asOf: "2026-08-23T22:00:00.000Z" },
  );

  const events = view.days[0]?.events ?? [];
  assert.equal(
    events.find((entry) => entry.kind === "sleep")?.summary,
    "8 h 27",
  );
  assert.equal(events.find((entry) => entry.kind === "nap")?.summary, "25 min");
});

test("Journal folds a long unknown provider duplicate into explicit main sleep", () => {
  const view = buildJournalView(
    createVaultReadModel({
      entities: [
        event(
          "explicit_main",
          "sleep_session",
          "2026-08-23T08:50:00.000Z",
          {
            durationMinutes: 495,
            sleepType: "main_sleep",
            source: "oura",
          },
          "Sleep",
        ),
        event(
          "unknown_duplicate",
          "sleep_session",
          "2026-08-23T09:00:00.000Z",
          {
            durationMinutes: 507,
            source: "oura",
          },
          "Sleep",
        ),
        event(
          "unknown_nap",
          "sleep_session",
          "2026-08-23T14:07:00.000Z",
          {
            durationMinutes: 25,
            source: "oura",
          },
          "Sleep",
        ),
      ],
      vaultRoot: "test://journal-explicit-sleep-duplicate",
    }),
    [],
    { asOf: "2026-08-23T22:00:00.000Z" },
  );

  const events = view.days[0]?.events ?? [];
  assert.equal(events.filter((entry) => entry.kind === "sleep").length, 1);
  assert.equal(
    events.find((entry) => entry.kind === "sleep")?.summary,
    "8 h 27",
  );
  assert.equal(events.filter((entry) => entry.kind === "nap").length, 1);
  assert.equal(events.find((entry) => entry.kind === "nap")?.summary, "25 min");
});

function event(
  id: string,
  kind: string,
  occurredAt: string,
  attributes: Record<string, unknown>,
  title: string,
  links: CanonicalEntity["links"] = [],
): CanonicalEntity {
  return entity("event", id, {
    attributes,
    date: occurredAt.slice(0, 10),
    kind,
    links,
    occurredAt,
    title,
  });
}

function metric(
  metricKey: string,
  date: string,
  value: number,
  unit: string,
): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: date,
    grain: "day",
    id: `metric_${metricKey}_${date}`,
    metricKey,
    observedAt: `${date}T07:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: "oura",
      rawRefs: [],
      sourceLabel: "Oura",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: `record:${metricKey}:${date}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function entity(
  family: CanonicalEntity["family"],
  id: string,
  overrides: Partial<CanonicalEntity>,
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId: id,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [id],
    occurredAt: null,
    path: `${family}/${id}.jsonl`,
    primaryLookupId: id,
    recordClass: family === "sample" ? "sample" : "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: null,
    ...overrides,
  };
}
