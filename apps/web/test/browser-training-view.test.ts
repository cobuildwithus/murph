import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";

import { selectBrowserVaultTraining } from "../src/lib/training/browser-training";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

function createWorkoutEntity(
  entityId: string,
  attributes: Record<string, unknown>,
  occurredAt: string,
): CanonicalEntity {
  return {
    attributes,
    body: null,
    date: occurredAt.slice(0, 10),
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
                    { order: 1, reps: 10, weight: 135, weightUnit: "lb" },
                    { order: 2, reps: 8, weight: 145, weightUnit: "lb" },
                  ],
                  sourceExerciseId: "EX001",
                },
                {
                  name: "Lateral raise",
                  order: 2,
                  sets: [{ order: 1, reps: 12, weight: 20, weightUnit: "lb" }],
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
                      completedAt: "2026-08-09T17:10:00.000Z",
                      order: 1,
                      reps: 8,
                      weight: 155,
                      weightUnit: "lb",
                    },
                    { order: 2, reps: 8, weight: 155, weightUnit: "lb" },
                  ],
                  sourceExerciseId: "EX001",
                },
              ],
              routineName: "Push day",
              startedAt: "2026-08-09T17:00:00.000Z",
              state: "in_progress",
            },
          },
          "2026-08-09T17:00:00.000Z",
        ),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const view = selectBrowserVaultTraining(createBrowserVaultQueryClient(replica));

  assert.equal(view.activeSession?.id, "workout_active");
  assert.equal(view.activeSession?.completedSetCount, 1);
  assert.equal(view.activeSession?.setCount, 2);
  assert.deepEqual(view.recentSessions.map((session) => session.id), ["workout_completed"]);
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
  assert.equal(bench.lastSet?.weight, 155);
  assert.equal(bench.bestSet?.weight, 155);
  assert.equal(view.weeks.reduce((sum, week) => sum + week.count, 0), 2);
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
  const view = selectBrowserVaultTraining(createBrowserVaultQueryClient(replica));

  assert.equal(view.recentSessions[0]?.exercises[0]?.name, "Goblet squat");
  assert.equal(view.recentSessions[0]?.completedSetCount, 3);
  assert.equal(view.exerciseProgress[0]?.bestSet?.weight, 50);
});
