import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";

import {
  createTrainingHandoffBaseline,
  isTrainingHandoffComplete,
  selectBrowserVaultTraining,
} from "../src/lib/training/browser-training";

type CanonicalEntity = Parameters<
  typeof createVaultReadModel
>[0]["entities"][number];

function createWorkoutEntity(
  entityId: string,
  attributes: Record<string, unknown>,
  occurredAt: string,
  date = occurredAt.slice(0, 10),
): CanonicalEntity {
  return {
    attributes,
    body: null,
    date,
    entityId,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: "activity_session",
    links: [],
    lookupIds: [entityId],
    occurredAt,
    path: `history/events/${entityId}.jsonl`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: null,
  };
}

async function createTrainingClient(
  entities: CanonicalEntity[],
  sourceBundleHash: string,
) {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash,
    vault: createVaultReadModel({
      entities,
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  return createBrowserVaultQueryClient(replica);
}

test("Training handoff completion follows the requested workout instead of any projection change", async () => {
  const activeWorkout = createWorkoutEntity(
    "active_workout",
    {
      activityType: "strength-training",
      source: "manual",
      workout: {
        exercises: [{
          name: "Bench press",
          sets: [{ order: 1, reps: 8, weight: 135 }],
        }],
        sourceApp: "murph-live",
        startedAt: "2026-08-09T17:00:00.000Z",
      },
    },
    "2026-08-09T17:00:00.000Z",
  );
  const deviceWorkout = createWorkoutEntity(
    "device_workout",
    {
      activityType: "strength-training",
      source: "garmin",
      title: "Device strength",
    },
    "2026-08-09T17:30:00.000Z",
  );
  const changedActiveWorkout = createWorkoutEntity(
    "active_workout",
    {
      activityType: "strength-training",
      source: "manual",
      workout: {
        exercises: [{
          name: "Bench press",
          sets: [{ order: 1, reps: 9, weight: 135 }],
        }],
        sourceApp: "murph-live",
        startedAt: "2026-08-09T17:00:00.000Z",
      },
    },
    "2026-08-09T17:00:00.000Z",
  );
  const manualRun = createWorkoutEntity(
    "manual_run",
    {
      activityType: "running",
      distanceKm: 4.8,
      source: "manual",
      workout: { exercises: [] },
    },
    "2026-08-09T18:00:00.000Z",
  );

  const continueBaseline = createTrainingHandoffBaseline(
    await createTrainingClient(
      [activeWorkout, manualRun],
      "continue-baseline",
    ),
  );
  assert.equal(continueBaseline.kind, "continue");
  assert.equal(
    isTrainingHandoffComplete(
      continueBaseline,
      await createTrainingClient(
        [activeWorkout, deviceWorkout],
        "unrelated-device-workout",
      ),
    ),
    false,
  );
  assert.equal(
    isTrainingHandoffComplete(
      continueBaseline,
      await createTrainingClient(
        [changedActiveWorkout, deviceWorkout],
        "continued-workout-update",
      ),
    ),
    true,
  );
  assert.equal(
    isTrainingHandoffComplete(
      continueBaseline,
      await createTrainingClient([deviceWorkout], "deleted-active-workout"),
    ),
    true,
  );

  const startBaseline = createTrainingHandoffBaseline(
    await createTrainingClient([manualRun], "start-baseline"),
  );
  assert.equal(startBaseline.kind, "start");
  assert.equal(
    isTrainingHandoffComplete(
      startBaseline,
      await createTrainingClient([deviceWorkout], "lookback-removal"),
    ),
    false,
  );
  assert.equal(
    isTrainingHandoffComplete(
      startBaseline,
      await createTrainingClient(
        [manualRun, deviceWorkout],
        "unrelated-device-addition",
      ),
    ),
    false,
  );
  assert.equal(
    isTrainingHandoffComplete(
      startBaseline,
      await createTrainingClient(
        [manualRun, createWorkoutEntity(
          "new_manual_workout",
          {
            activityType: "walking",
            source: "manual",
            workout: { exercises: [] },
          },
          "2026-08-09T18:10:00.000Z",
        )],
        "new-manual-workout",
      ),
    ),
    true,
  );
});

test("Training derives the live workout, recent history and exercise progress from canonical sessions", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-view",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "workout_completed",
          {
            activityType: "strength-training",
            durationMinutes: 48,
            source: "manual",
            title: "Push day",
            workout: {
              endedAt: "2026-08-07T17:48:00.000Z",
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [
                    {
                      order: 1,
                      reps: 10,
                      weight: 135,
                      weightUnit: "lb",
                    },
                    {
                      order: 2,
                      reps: 8,
                      weight: 145,
                      weightUnit: "lb",
                    },
                  ],
                  sourceExerciseId: "EX001",
                },
                {
                  name: "Lateral raise",
                  order: 2,
                  sets: [
                    {
                      order: 1,
                      reps: 12,
                      weight: 20,
                      weightUnit: "lb",
                    },
                  ],
                  sourceExerciseId: "EX002",
                },
              ],
              routineName: "Push day",
              startedAt: "2026-08-07T17:00:00.000Z",
            },
          },
          "2026-08-07T17:00:00.000Z",
        ),
        createWorkoutEntity(
          "workout_active",
          {
            activityType: "strength-training",
            source: "manual",
            title: "Push day",
            workout: {
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [
                    {
                      order: 1,
                      reps: 8,
                      type: "normal",
                      weight: 155,
                      weightUnit: "lb",
                    },
                    { order: 2, type: "normal" },
                  ],
                  sourceExerciseId: "EX001",
                },
              ],
              routineName: "Push day",
              sourceApp: "murph-live",
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );

  assert.equal(view.activeSession?.id, "workout_active");
  assert.equal(view.activeSession?.completedSetCount, 1);
  assert.equal(view.activeSession?.setCount, 2);
  assert.deepEqual(
    view.recentSessions.map((session) => session.id),
    ["workout_completed"],
  );
  assert.deepEqual(view.summary, {
    exerciseCount: 2,
    setCount: 4,
    trainingDayCount: 2,
    workoutCount: 2,
  });

  const bench = view.exerciseProgress.find((entry) => entry.id === "EX001");
  assert.ok(bench);
  assert.equal(bench.sessionCount, 2);
  assert.equal(bench.setCount, 3);
  assert.equal(bench.lastPerformedDate, "2026-08-09");
  assert.equal(bench.lastSet?.weight, 155);
  assert.equal(bench.bestSet?.weight, 155);
  assert.equal(
    view.weeks.reduce((sum, week) => sum + week.count, 0),
    2,
  );
});

test("Training treats result-bearing sets as logged and keeps placeholders planned before and after finish", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "live-set-completion",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "workout_active_notes",
          {
            activityType: "strength-training",
            workout: {
              exercises: [
                {
                  name: "Plank",
                  order: 1,
                  sets: [
                    { note: "Hard brace", order: 1, type: "normal" },
                    { durationSeconds: 60, order: 2, type: "normal" },
                    { order: 3, type: "normal" },
                  ],
                },
              ],
              sourceApp: "murph-live",
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
        createWorkoutEntity(
          "workout_finished_placeholders",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-08T18:00:00.000Z",
              exercises: [
                {
                  name: "Squat",
                  order: 1,
                  sets: [
                    { order: 1, reps: 5, type: "normal", weight: 185 },
                    { order: 2, type: "normal" },
                  ],
                },
              ],
              sourceApp: "murph-live",
              startedAt: "2026-08-08T17:00:00.000Z",
            },
          },
          "2026-08-08T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );

  assert.equal(view.activeSession?.completedSetCount, 2);
  assert.deepEqual(
    view.activeSession?.exercises[0]?.sets.map((set) => set.completed),
    [true, true, false],
  );
  const finished = view.recentSessions.find(
    (session) => session.id === "workout_finished_placeholders",
  );
  assert.ok(finished);
  assert.equal(finished.completedSetCount, 1);
  assert.deepEqual(
    finished.exercises[0]?.sets.map((set) => set.completed),
    [true, false],
  );
});

test("Training aggregates only completed sessions or performed live work", async () => {
  const createRoutineView = async (firstSet: Record<string, unknown>) => {
    const replica = await createBrowserVaultReplica({
      generatedAt: "2026-08-09T18:00:00.000Z",
      metricPoints: [],
      sourceBundleHash: JSON.stringify(firstSet),
      vault: createVaultReadModel({
        entities: [
          createWorkoutEntity(
            "started_routine",
            {
              activityType: "strength-training",
              workout: {
                exercises: [
                  {
                    name: "Bench press",
                    order: 1,
                    sets: [firstSet, { order: 2, type: "normal" }],
                  },
                  {
                    name: "Row",
                    order: 2,
                    sets: [
                      { order: 1, type: "normal" },
                      { order: 2, type: "normal" },
                    ],
                  },
                ],
                sourceApp: "murph-live",
                startedAt: "2026-08-09T17:00:00.000Z",
              },
            },
            "2026-08-09T17:00:00.000Z",
          ),
        ],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });
    return selectBrowserVaultTraining(createBrowserVaultQueryClient(replica), {
      now: new Date("2026-08-09T19:00:00.000Z"),
      timeZone: "UTC",
    });
  };

  const plannedView = await createRoutineView({ order: 1, type: "normal" });
  assert.equal(plannedView.activeSession?.completedSetCount, 0);
  assert.equal(plannedView.activeSession?.exerciseCount, 2);
  assert.deepEqual(plannedView.summary, {
    exerciseCount: 0,
    setCount: 0,
    trainingDayCount: 0,
    workoutCount: 0,
  });
  assert.equal(
    plannedView.weeks.reduce((sum, week) => sum + week.count, 0),
    0,
  );

  const performedView = await createRoutineView({
    order: 1,
    reps: 5,
    type: "normal",
    weight: 135,
    weightUnit: "lb",
  });
  assert.equal(performedView.activeSession?.completedSetCount, 1);
  assert.deepEqual(performedView.summary, {
    exerciseCount: 1,
    setCount: 1,
    trainingDayCount: 1,
    workoutCount: 1,
  });
  assert.deepEqual(
    performedView.exerciseProgress.map((entry) => entry.name),
    ["Bench press"],
  );
  assert.equal(
    performedView.weeks.reduce((sum, week) => sum + week.count, 0),
    1,
  );

  const completedReplica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "completed-session-without-set-details",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "completed_without_sets",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-08T18:00:00.000Z",
              sourceApp: "murph-live",
              startedAt: "2026-08-08T17:00:00.000Z",
            },
          },
          "2026-08-08T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const completedView = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(completedReplica),
    {
      now: new Date("2026-08-09T19:00:00.000Z"),
      timeZone: "UTC",
    },
  );
  assert.deepEqual(completedView.summary, {
    exerciseCount: 0,
    setCount: 0,
    trainingDayCount: 1,
    workoutCount: 1,
  });
  assert.equal(completedView.recentSessions.length, 1);
  assert.equal(
    completedView.weeks.reduce((sum, week) => sum + week.count, 0),
    1,
  );
});

test("Training keeps legacy strength summaries visible while old records migrate", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "legacy-training-view",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "legacy_workout",
          {
            activityType: "strength-training",
            durationMinutes: 30,
            strengthExercises: [
              {
                exercise: "Goblet squat",
                load: 50,
                loadUnit: "lb",
                repsPerSet: 10,
                setCount: 3,
              },
            ],
          },
          "2026-08-08T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );

  assert.equal(
    view.recentSessions[0]?.exercises[0]?.name,
    "Goblet squat",
  );
  assert.equal(view.recentSessions[0]?.completedSetCount, 3);
  assert.equal(view.exerciseProgress[0]?.bestSet?.weight, 50);
});

test("Training uses the canonical local date for week buckets and progress labels", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-10T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-local-date",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "sunday_local_workout",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-10T02:00:00.000Z",
              exercises: [
                {
                  name: "Deadlift",
                  order: 1,
                  sets: [{ order: 1, reps: 5, weight: 225 }],
                },
              ],
              startedAt: "2026-08-10T01:00:00.000Z",
            },
          },
          "2026-08-10T01:00:00.000Z",
          "2026-08-09",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );

  assert.equal(view.weeks.at(-1)?.count, 0);
  assert.equal(view.weeks.at(-2)?.count, 1);
  assert.equal(view.exerciseProgress[0]?.lastPerformedDate, "2026-08-09");
});


test("Training treats less assistance as stronger progress", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "assisted-progress",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "assisted_pullups",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-09T17:30:00.000Z",
              exercises: [
                {
                  name: "Assisted pull-up",
                  order: 1,
                  sets: [
                    { assistanceKg: 25, order: 1, reps: 8 },
                    { assistanceKg: 15, order: 2, reps: 8 },
                  ],
                  sourceExerciseId: "EX_ASSISTED_PULLUP",
                },
              ],
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );

  assert.equal(view.exerciseProgress[0]?.bestSet?.assistanceKg, 15);
});


test("Training ranks only explicitly unit-bearing weights as best sets", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-comparable-loads",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "comparable_loads_older",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-07T18:00:00.000Z",
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [{ order: 1, reps: 8, weight: 135 }],
                  sourceExerciseId: "EX_BENCH",
                },
                {
                  name: "Shoulder press",
                  order: 2,
                  sets: [{ order: 1, reps: 8, weight: 150, weightUnit: "lb" }],
                  sourceExerciseId: "EX_PRESS",
                },
                {
                  name: "Row",
                  order: 3,
                  sets: [{ order: 1, reps: 8, weight: 60 }],
                  sourceExerciseId: "EX_OVERRIDE",
                  unitOverride: "kg",
                },
                {
                  name: "Curl",
                  order: 4,
                  sets: [{ order: 1, reps: 10, weight: 100 }],
                  sourceExerciseId: "EX_AMBIGUOUS",
                },
              ],
              startedAt: "2026-08-07T17:00:00.000Z",
            },
          },
          "2026-08-07T17:00:00.000Z",
        ),
        createWorkoutEntity(
          "comparable_loads_latest",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-09T18:00:00.000Z",
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [{ order: 1, reps: 8, weight: 155, weightUnit: "lb" }],
                  sourceExerciseId: "EX_BENCH",
                },
                {
                  name: "Shoulder press",
                  order: 2,
                  sets: [{ order: 1, reps: 8, weight: 70, weightUnit: "kg" }],
                  sourceExerciseId: "EX_PRESS",
                },
                {
                  name: "Row",
                  order: 3,
                  sets: [{ order: 1, reps: 8, weight: 130, weightUnit: "lb" }],
                  sourceExerciseId: "EX_OVERRIDE",
                },
                {
                  name: "Curl",
                  order: 4,
                  sets: [{ order: 1, reps: 12, weight: 110 }],
                  sourceExerciseId: "EX_AMBIGUOUS",
                },
                {
                  name: "Mobility drill",
                  order: 5,
                  sets: [{ note: "Looser through the right side", order: 1 }],
                  sourceExerciseId: "EX_NOTE_ONLY",
                },
                {
                  name: "Technique practice",
                  order: 6,
                  sets: [{ order: 1, rpe: 7 }],
                  sourceExerciseId: "EX_RPE_ONLY",
                },
                {
                  name: "Push-up",
                  order: 7,
                  sets: [{ note: "Strong lockout", order: 1, reps: 12 }],
                  sourceExerciseId: "EX_MEASURABLE_NOTE",
                },
              ],
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );
  const progress = new Map(
    view.exerciseProgress.map((entry) => [entry.id, entry]),
  );

  assert.equal(progress.get("EX_BENCH")?.bestSet?.weight, 155);
  assert.equal(progress.get("EX_BENCH")?.bestSet?.weightUnit, "lb");
  assert.equal(progress.get("EX_PRESS")?.bestSet?.weight, 70);
  assert.equal(progress.get("EX_PRESS")?.bestSet?.weightUnit, "kg");
  assert.equal(progress.get("EX_OVERRIDE")?.bestSet?.weight, 60);
  assert.equal(progress.get("EX_OVERRIDE")?.bestSet?.weightUnit, "kg");
  assert.equal(progress.get("EX_AMBIGUOUS")?.bestSet, null);
  assert.equal(progress.get("EX_AMBIGUOUS")?.lastSet?.weight, 110);
  assert.equal(progress.get("EX_NOTE_ONLY")?.bestSet, null);
  assert.equal(
    progress.get("EX_NOTE_ONLY")?.lastSet?.note,
    "Looser through the right side",
  );
  assert.equal(progress.get("EX_RPE_ONLY")?.bestSet, null);
  assert.equal(progress.get("EX_RPE_ONLY")?.lastSet?.rpe, 7);
  assert.equal(progress.get("EX_MEASURABLE_NOTE")?.bestSet?.reps, 12);
  assert.equal(
    progress.get("EX_MEASURABLE_NOTE")?.bestSet?.note,
    "Strong lockout",
  );

  const latest = view.recentSessions.find(
    (session) => session.id === "comparable_loads_latest",
  );
  assert.equal(
    latest?.exercises.find((exercise) =>
      exercise.sourceExerciseId === "EX_NOTE_ONLY"
    )?.sets[0]?.completed,
    true,
  );
  assert.equal(
    latest?.exercises.find((exercise) =>
      exercise.sourceExerciseId === "EX_RPE_ONLY"
    )?.sets[0]?.completed,
    true,
  );
});

test("Training keeps multi-axis cardio results visible without inventing a Best", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-multi-axis-cardio",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "cardio_intervals",
          {
            activityType: "cardio",
            workout: {
              endedAt: "2026-08-09T17:30:00.000Z",
              exercises: [
                {
                  name: "Row",
                  order: 1,
                  sets: [
                    { distanceMeters: 1_000, durationSeconds: 300, order: 1 },
                    { distanceMeters: 1_000, durationSeconds: 360, order: 2 },
                  ],
                  sourceExerciseId: "EX_CARDIO_ROW",
                },
              ],
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );
  const progress = view.exerciseProgress.find(
    (entry) => entry.id === "EX_CARDIO_ROW",
  );
  const completedSets = view.recentSessions[0]?.exercises[0]?.sets ?? [];

  assert.deepEqual(
    completedSets.map((set) => ({
      completed: set.completed,
      distanceMeters: set.distanceMeters,
      durationSeconds: set.durationSeconds,
    })),
    [
      { completed: true, distanceMeters: 1_000, durationSeconds: 300 },
      { completed: true, distanceMeters: 1_000, durationSeconds: 360 },
    ],
  );
  assert.equal(progress?.bestSet, null);
  assert.equal(progress?.lastSet?.durationSeconds, 360);
  assert.equal(progress?.lastSet?.distanceMeters, 1_000);
});

test("Training reserves Best for strength-comparable sets across stable and fallback exercise keys", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-09T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-strength-only-best",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "cardio_and_strength_older",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-07T18:00:00.000Z",
              exercises: [
                {
                  name: "Bike",
                  sets: [{ durationSeconds: 300, order: 1, reps: 20 }],
                  sourceExerciseId: "EX_DURATION",
                },
                {
                  name: "Sled push",
                  sets: [{ distanceMeters: 100, order: 1, weight: 90, weightUnit: "kg" }],
                  sourceExerciseId: "EX_DISTANCE",
                },
                {
                  name: "Row",
                  sets: [{ distanceMeters: 1_000, order: 1, reps: 24 }],
                  sourceExerciseId: "EX_MIXED",
                },
                {
                  name: "  Farmer   carry ",
                  sets: [{ durationSeconds: 45, order: 1, reps: 12 }],
                },
                {
                  name: "Bench press",
                  sets: [{ order: 1, reps: 8, weight: 135, weightUnit: "lb" }],
                  sourceExerciseId: "EX_STRENGTH",
                },
              ],
              startedAt: "2026-08-07T17:00:00.000Z",
            },
          },
          "2026-08-07T17:00:00.000Z",
        ),
        createWorkoutEntity(
          "cardio_and_strength_latest",
          {
            activityType: "strength-training",
            workout: {
              endedAt: "2026-08-09T18:00:00.000Z",
              exercises: [
                {
                  name: "Bike",
                  sets: [{ durationSeconds: 360, order: 1, reps: 20 }],
                  sourceExerciseId: "EX_DURATION",
                },
                {
                  name: "Sled push",
                  sets: [{ distanceMeters: 120, order: 1, weight: 95, weightUnit: "kg" }],
                  sourceExerciseId: "EX_DISTANCE",
                },
                {
                  name: "Row",
                  sets: [{ durationSeconds: 300, order: 1, weight: 25, weightUnit: "kg" }],
                  sourceExerciseId: "EX_MIXED",
                },
                {
                  name: "Farmer carry",
                  sets: [{ distanceMeters: 30, order: 1, weight: 35, weightUnit: "kg" }],
                },
                {
                  name: "Bench press",
                  sets: [{ order: 1, reps: 8, weight: 155, weightUnit: "lb" }],
                  sourceExerciseId: "EX_STRENGTH",
                },
              ],
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
  );
  const progress = new Map(
    view.exerciseProgress.map((entry) => [entry.id, entry]),
  );

  for (const id of [
    "EX_DURATION",
    "EX_DISTANCE",
    "EX_MIXED",
    "farmer-carry",
  ]) {
    assert.equal(progress.get(id)?.bestSet, null);
    assert.equal(progress.get(id)?.sessionCount, 2);
  }
  assert.equal(progress.get("EX_DURATION")?.lastSet?.durationSeconds, 360);
  assert.equal(progress.get("EX_DISTANCE")?.lastSet?.distanceMeters, 120);
  assert.equal(progress.get("EX_MIXED")?.lastSet?.durationSeconds, 300);
  assert.equal(progress.get("farmer-carry")?.lastSet?.distanceMeters, 30);
  assert.equal(progress.get("EX_STRENGTH")?.bestSet?.weight, 155);
});


test("Training preserves a completed next-local-day workout before UTC midnight", async () => {
  const createReplica = (endedAt?: string) => createBrowserVaultReplica({
    generatedAt: "2026-08-09T23:30:00.000Z",
    metricPoints: [],
    sourceBundleHash: endedAt
      ? "training-positive-time-zone-completed"
      : "training-positive-time-zone-active",
    vault: createVaultReadModel({
      entities: [
        createWorkoutEntity(
          "tokyo_monday_workout",
          {
            activityType: "strength-training",
            workout: {
              ...(endedAt ? { endedAt } : {}),
              exercises: [
                {
                  name: "Bench press",
                  order: 1,
                  sets: [{ order: 1, reps: 8, weight: 60, weightUnit: "kg" }],
                },
              ],
              sourceApp: "murph-live",
              startedAt: "2026-08-09T23:00:00.000Z",
            },
          },
          "2026-08-09T23:00:00.000Z",
          "2026-08-10",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const activeView = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(await createReplica()),
    {
      now: new Date("2026-08-09T23:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    },
  );
  const completedView = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(
      await createReplica("2026-08-09T23:25:00.000Z"),
    ),
    {
      now: new Date("2026-08-09T23:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    },
  );

  assert.equal(activeView.activeSession?.id, "tokyo_monday_workout");
  assert.equal(completedView.activeSession, null);
  assert.equal(completedView.recentSessions[0]?.id, "tokyo_monday_workout");
  assert.equal(completedView.summary.workoutCount, 1);
  assert.equal(completedView.summary.trainingDayCount, 1);
  assert.equal(completedView.weeks.at(-1)?.count, 1);
  assert.equal(
    completedView.exerciseProgress[0]?.lastPerformedDate,
    "2026-08-10",
  );
});

test("Training derives the current week from the browser time zone without a workout anchor", async () => {
  const createEmptyClient = async (generatedAt: string) =>
    createBrowserVaultQueryClient(await createBrowserVaultReplica({
      generatedAt,
      metricPoints: [],
      sourceBundleHash: generatedAt,
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    }));

  const tokyoView = selectBrowserVaultTraining(
    await createEmptyClient("2026-08-09T23:30:00.000Z"),
    {
      now: new Date("2026-08-09T23:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    },
  );
  const losAngelesView = selectBrowserVaultTraining(
    await createEmptyClient("2026-08-10T04:30:00.000Z"),
    {
      now: new Date("2026-08-10T04:30:00.000Z"),
      timeZone: "America/Los_Angeles",
    },
  );

  assert.equal(tokyoView.weeks.at(-1)?.startDate, "2026-08-10");
  assert.equal(losAngelesView.weeks.at(-1)?.startDate, "2026-08-03");
});

test("Training uses the browser's current local day while a pre-midnight replica remains fresh", async () => {
  const trainingEntity = (id: string, date: string, sourceExerciseId: string) =>
    createWorkoutEntity(
      id,
      {
        activityType: "strength-training",
        workout: {
          endedAt: `${date}T18:30:00.000Z`,
          exercises: [{
            name: sourceExerciseId,
            sets: [{ order: 1, reps: 5, weight: 100, weightUnit: "lb" }],
            sourceExerciseId,
          }],
          startedAt: `${date}T18:00:00.000Z`,
        },
      },
      `${date}T18:00:00.000Z`,
      date,
    );
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-10T06:58:00.000Z",
    metricPoints: [],
    sourceBundleHash: "training-stale-local-date",
    vault: createVaultReadModel({
      entities: [
        trainingEntity("summary_boundary", "2026-07-12", "SUMMARY_IN"),
        trainingEntity("before_summary_boundary", "2026-07-11", "SUMMARY_OUT"),
        trainingEntity("progress_boundary", "2026-02-09", "PROGRESS_IN"),
        trainingEntity("before_progress_boundary", "2026-02-08", "PROGRESS_OUT"),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(
    createBrowserVaultQueryClient(replica),
    {
      now: new Date("2026-08-10T19:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    },
  );

  assert.equal(view.weeks.at(-1)?.startDate, "2026-08-10");
  assert.equal(view.summary.workoutCount, 1);
  assert.deepEqual(
    view.exerciseProgress.map((entry) => entry.id).sort(),
    ["PROGRESS_IN", "SUMMARY_IN", "SUMMARY_OUT"].sort(),
  );
});
