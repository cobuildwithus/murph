import { describe, expect, it } from "vitest";

import {
  assistantResponseCardSchema,
  compactTableResponseCardV1Schema,
  workoutSessionCardV1Bounds,
  workoutSessionDetailV1Schema,
  type CompactTableResponseCardV1,
} from "../src/index.ts";

const TRACKED_WORKOUT_CARD: CompactTableResponseCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Push day",
  subtitle: "3 of 6 sets complete",
  rowHeader: "Exercise",
  columns: ["Progress"],
  rows: [
    { label: "Bench press", values: ["2/3"] },
    { label: "Incline dumbbell press", values: ["1/3"] },
  ],
  footer: "Tap an exercise to log or correct a set.",
  tracking: {
    kind: "workout",
    entityId: "evt_01K1ABCDEFGHJKMNPQRSTVWXYZ",
    snapshotAt: "2026-08-09T19:45:00.000Z",
  },
  workout: {
    version: 1,
    state: "active",
    exercises: [
      {
        name: "Bench press",
        sets: [
          {
            status: "completed",
            target: "185 lb × 8",
            actual: "185 lb × 8",
          },
          {
            status: "completed",
            target: "185 lb × 8",
            actual: "185 lb × 7",
          },
          {
            status: "pending",
            target: "185 lb × 6–8",
            actual: null,
          },
        ],
      },
      {
        name: "Incline dumbbell press",
        sets: [
          {
            status: "completed",
            target: "55 lb × 10",
            actual: "55 lb × 10",
          },
          {
            status: "pending",
            target: "55 lb × 8–10",
            actual: null,
          },
          {
            status: "pending",
            target: null,
            actual: null,
          },
        ],
      },
    ],
  },
};

function summaryRows(
  workout: NonNullable<CompactTableResponseCardV1["workout"]>,
) {
  return workout.exercises.map((exercise) => ({
    label: exercise.name,
    values: [
      `${
        exercise.sets.filter((set) => set.status === "completed").length
      }/${exercise.sets.length}`,
    ],
  }));
}

describe("workout session compact-table contract", () => {
  it("accepts one bounded active workout backed by canonical state", () => {
    expect(
      compactTableResponseCardV1Schema.parse(TRACKED_WORKOUT_CARD),
    ).toEqual(TRACKED_WORKOUT_CARD);
    expect(assistantResponseCardSchema.parse(TRACKED_WORKOUT_CARD)).toEqual(
      TRACKED_WORKOUT_CARD,
    );
  });

  it("accepts a completed workout with completed and skipped sets", () => {
    const workout = workoutSessionDetailV1Schema.parse({
      ...TRACKED_WORKOUT_CARD.workout,
      state: "completed",
      exercises: TRACKED_WORKOUT_CARD.workout?.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) =>
          set.status === "pending"
            ? { status: "skipped" as const, target: set.target, actual: null }
            : set,
        ),
      })),
    });
    const completedCard: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      rows: summaryRows(workout),
      workout,
    };

    expect(compactTableResponseCardV1Schema.parse(completedCard)).toEqual(
      completedCard,
    );
  });

  it("rejects contradictory set and workout states", () => {
    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        workout: {
          ...TRACKED_WORKOUT_CARD.workout,
          exercises: [
            {
              name: "Bench press",
              sets: [
                {
                  status: "completed",
                  target: "185 lb × 8",
                  actual: null,
                },
              ],
            },
          ],
        },
        rows: [{ label: "Bench press", values: ["1/1"] }],
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        workout: {
          ...TRACKED_WORKOUT_CARD.workout,
          state: "completed",
        },
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        workout: {
          ...TRACKED_WORKOUT_CARD.workout,
          exercises: [
            {
              name: "Bench press",
              sets: [
                {
                  status: "skipped",
                  target: "185 lb × 8",
                  actual: null,
                },
              ],
            },
          ],
        },
        rows: [{ label: "Bench press", values: ["0/1"] }],
      }).success,
    ).toBe(false);
  });

  it("allows an active workout to wait for explicit finish after its final set", () => {
    const workout = workoutSessionDetailV1Schema.parse({
      ...TRACKED_WORKOUT_CARD.workout,
      exercises: TRACKED_WORKOUT_CARD.workout?.exercises.map(
        (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            status: "completed",
            actual: set.actual ?? set.target ?? "1 rep",
          })),
        }),
      ),
    });
    const card: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      subtitle: "6 of 6 sets complete",
      rows: summaryRows(workout),
      workout,
    };

    expect(compactTableResponseCardV1Schema.parse(card)).toEqual(card);
  });

  it("requires the compact summary to mirror workout progress", () => {
    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        rows: [
          { label: "Bench press", values: ["3/3"] },
          { label: "Incline dumbbell press", values: ["1/3"] },
        ],
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        columns: ["Sets"],
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        tracking: null,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields, unprintable text, and unbounded shapes", () => {
    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        workout: {
          ...TRACKED_WORKOUT_CARD.workout,
          extra: true,
        },
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        workout: {
          ...TRACKED_WORKOUT_CARD.workout,
          exercises: [
            {
              name: "Bench\npress",
              sets: TRACKED_WORKOUT_CARD.workout?.exercises[0]?.sets,
            },
          ],
        },
        rows: [{ label: "Bench press", values: ["2/3"] }],
      }).success,
    ).toBe(false);

    expect(
      workoutSessionDetailV1Schema.safeParse({
        version: 1,
        state: "active",
        exercises: Array.from(
          { length: workoutSessionCardV1Bounds.exercises + 1 },
          (_, index) => ({
            name: `Exercise ${index + 1}`,
            sets: [{ status: "pending", target: null, actual: null }],
          }),
        ),
      }).success,
    ).toBe(false);

    expect(
      workoutSessionDetailV1Schema.safeParse({
        version: 1,
        state: "active",
        exercises: [
          {
            name: "Bench press",
            sets: Array.from(
              { length: workoutSessionCardV1Bounds.setsPerExercise + 1 },
              () => ({ status: "pending", target: null, actual: null }),
            ),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps realistic sessions under the inline URL limit", () => {
    const workout = workoutSessionDetailV1Schema.parse({
      version: 1,
      state: "active",
      exercises: Array.from({ length: 6 }, (_, exerciseIndex) => ({
        name: `Exercise ${exerciseIndex + 1}`,
        sets: Array.from({ length: 4 }, (_, setIndex) => ({
          status:
            exerciseIndex === 5 && setIndex === 3
              ? ("pending" as const)
              : ("completed" as const),
          target: `${setIndex + 1}`,
          actual:
            exerciseIndex === 5 && setIndex === 3
              ? null
              : `${setIndex + 1}`,
        })),
      })),
    });
    const sixExerciseSession: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      title: "T".repeat(workoutSessionCardV1Bounds.title),
      subtitle: null,
      rows: summaryRows(workout),
      footer: null,
      workout,
    };

    expect(
      compactTableResponseCardV1Schema.parse(sixExerciseSession),
    ).toEqual(sixExerciseSession);

    const oversizedWorkout = {
      version: 1 as const,
      state: "active" as const,
      exercises: Array.from(
        { length: workoutSessionCardV1Bounds.exercises },
        (_, exerciseIndex) => ({
          name: `Exercise ${exerciseIndex + 1}`,
          sets: Array.from(
            { length: workoutSessionCardV1Bounds.setsPerExercise },
            (_, setIndex) => ({
              status:
                exerciseIndex === workoutSessionCardV1Bounds.exercises - 1 &&
                setIndex === workoutSessionCardV1Bounds.setsPerExercise - 1
                  ? ("pending" as const)
                  : ("completed" as const),
              target: "T".repeat(workoutSessionCardV1Bounds.setValue),
              actual:
                exerciseIndex === workoutSessionCardV1Bounds.exercises - 1 &&
                setIndex === workoutSessionCardV1Bounds.setsPerExercise - 1
                  ? null
                  : "A".repeat(workoutSessionCardV1Bounds.setValue),
            }),
          ),
        }),
      ),
    };
    const oversized = {
      ...TRACKED_WORKOUT_CARD,
      rows: summaryRows(oversizedWorkout),
      workout: oversizedWorkout,
      footer: "F".repeat(workoutSessionCardV1Bounds.footer),
    };

    expect(compactTableResponseCardV1Schema.safeParse(oversized).success).toBe(
      false,
    );
  });
});
