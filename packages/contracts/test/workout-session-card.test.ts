import { describe, expect, it } from "vitest";

import {
  assistantResponseCardSchema,
  buildWorkoutSessionAppCardEnvelopeV4,
  buildWorkoutSessionAppCardEnvelopeV6,
  compactTableResponseCardV1Schema,
  parseCompactTableAppCardEnvelope,
  workoutSessionCardV1Bounds,
  workoutSessionDetailV1Schema,
  workoutSessionSchema,
  type CompactTableResponseCardV1,
} from "../src/index.ts";

const TRACKED_WORKOUT_CARD: CompactTableResponseCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Push day",
  subtitle: "3 of 6 sets complete",
  footer: "Reply with the exercise, set, and result to log or correct it.",
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

const TRACKED_WORKOUT_EDITOR = {
  actionBinding: "a".repeat(64),
  setRemovalBinding: "b".repeat(64),
  version: 1 as const,
  exercises: [
    {
      unitOverride: "lb" as const,
      sets: [
        {
          logged: true,
          result: {
            kind: "weight_reps" as const,
            reps: 8,
            weight: 185,
            weightUnit: null,
          },
        },
        {
          logged: true,
          result: {
            kind: "weight_reps" as const,
            reps: 7,
            weight: 185,
            weightUnit: "lb" as const,
          },
        },
        {
          logged: false,
          result: null,
        },
      ],
    },
    {
      unitOverride: "lb" as const,
      sets: [
        {
          logged: true,
          result: {
            kind: "weight_reps" as const,
            reps: 10,
            weight: 55,
            weightUnit: null,
          },
        },
        {
          logged: false,
          result: null,
        },
        {
          logged: false,
          result: null,
        },
      ],
    },
  ],
};

describe("workout session compact-table contract", () => {
  it("accepts one bounded active workout backed by canonical state", () => {
    expect(
      compactTableResponseCardV1Schema.parse(TRACKED_WORKOUT_CARD),
    ).toEqual(TRACKED_WORKOUT_CARD);
    expect(assistantResponseCardSchema.parse(TRACKED_WORKOUT_CARD)).toEqual(
      TRACKED_WORKOUT_CARD,
    );
  });

  it("restores the compact V4 wire without restoring workout authority", () => {
    if (!("workout" in TRACKED_WORKOUT_CARD)) {
      throw new TypeError("Expected the workout card fixture.");
    }
    const envelope = buildWorkoutSessionAppCardEnvelopeV4({
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: TRACKED_WORKOUT_CARD.subtitle,
      footer: TRACKED_WORKOUT_CARD.footer,
      workout: TRACKED_WORKOUT_CARD.workout,
    });

    expect(parseCompactTableAppCardEnvelope(envelope)).toEqual({
      kind: "compact_table",
      version: 1,
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: TRACKED_WORKOUT_CARD.subtitle,
      footer: TRACKED_WORKOUT_CARD.footer,
      workout: TRACKED_WORKOUT_CARD.workout,
    });
    expect(parseCompactTableAppCardEnvelope({
      ...envelope,
      card: { ...envelope.card, extra: true },
    })).toBeNull();
    expect(parseCompactTableAppCardEnvelope({
      ...envelope,
      card: {
        ...envelope.card,
        e: [["Bench press", [["c", "185 lb × 8", null]]]],
      },
    })).toBeNull();
  });

  it("validates but does not expose the V6 workout action binding", () => {
    if (!("workout" in TRACKED_WORKOUT_CARD)) {
      throw new TypeError("Expected the workout card fixture.");
    }
    const envelope = buildWorkoutSessionAppCardEnvelopeV6({
      editor: TRACKED_WORKOUT_EDITOR,
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: TRACKED_WORKOUT_CARD.subtitle,
      footer: TRACKED_WORKOUT_CARD.footer,
      workout: TRACKED_WORKOUT_CARD.workout,
    });

    expect(envelope.schemaVersion).toBe(6);
    expect(envelope.card.b).toBe("a".repeat(64));
    expect(envelope.card.d).toBe("b".repeat(64));
    expect(parseCompactTableAppCardEnvelope(envelope)).toEqual({
      kind: "compact_table",
      version: 1,
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: TRACKED_WORKOUT_CARD.subtitle,
      footer: TRACKED_WORKOUT_CARD.footer,
      workout: TRACKED_WORKOUT_CARD.workout,
    });
    expect(() => buildWorkoutSessionAppCardEnvelopeV6({
      editor: {
        ...TRACKED_WORKOUT_EDITOR,
        actionBinding: "A".repeat(64),
      },
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: TRACKED_WORKOUT_CARD.subtitle,
      footer: TRACKED_WORKOUT_CARD.footer,
      workout: TRACKED_WORKOUT_CARD.workout,
    })).toThrow(/binding/iu);
    expect(parseCompactTableAppCardEnvelope({
      ...envelope,
      card: { ...envelope.card, s: "c" },
    })).toBeNull();
    expect(parseCompactTableAppCardEnvelope({
      ...envelope,
      card: {
        ...envelope.card,
        e: [["Bench press", "l", [["p", null, ["r", 8]]]]],
      },
    })).toBeNull();
  });

  it("keeps canonical zero and large finite snapshot values in the V6 wire", () => {
    if (!("workout" in TRACKED_WORKOUT_CARD)) {
      throw new TypeError("Expected the workout card fixture.");
    }
    const workout = {
      ...TRACKED_WORKOUT_CARD.workout,
      exercises: [{
        name: "Bench press",
        sets: [{ status: "completed" as const, target: null, actual: "Logged" }],
      }],
    };
    const envelope = buildWorkoutSessionAppCardEnvelopeV6({
      editor: {
        actionBinding: "a".repeat(64),
        exercises: [{
          unitOverride: "lb",
          sets: [{
            logged: true,
            result: {
              kind: "weight_reps",
              reps: 1e100,
              weight: 0,
              weightUnit: null,
            },
          }],
        }],
        setRemovalBinding: "b".repeat(64),
        version: 1 as const,
      },
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: null,
      footer: null,
      workout,
    });

    expect(envelope.card.e[0]?.[2][0]?.[2]).toEqual(["w", 1e100, 0, null]);
    const parsed = parseCompactTableAppCardEnvelope(envelope);
    if (!parsed || !("workout" in parsed)) {
      throw new TypeError("Expected the parsed workout card.");
    }
    expect(parsed.workout).toEqual({
      ...workout,
      exercises: [{
        name: "Bench press",
        sets: [{
          status: "completed",
          target: null,
          actual: "0 lb × 1e+100",
        }],
      }],
    });

    const noteInput = {
      editor: {
        actionBinding: "a".repeat(64),
        exercises: [{
          unitOverride: null,
          sets: [{
            logged: true,
            result: { kind: "note" as const, note: "n".repeat(40) },
          }],
        }],
        setRemovalBinding: "b".repeat(64),
        version: 1 as const,
      },
      title: TRACKED_WORKOUT_CARD.title,
      subtitle: null,
      footer: null,
      workout,
    };
    const noteEnvelope = buildWorkoutSessionAppCardEnvelopeV6(noteInput);
    const parsedNote = parseCompactTableAppCardEnvelope(noteEnvelope);
    if (!parsedNote || !("workout" in parsedNote)) {
      throw new TypeError("Expected the parsed note workout card.");
    }
    expect(parsedNote.workout.exercises[0]?.sets[0]?.actual).toBe("n".repeat(40));
    expect(() => buildWorkoutSessionAppCardEnvelopeV6({
      ...noteInput,
      editor: {
        ...noteInput.editor,
        exercises: [{
          unitOverride: null,
          sets: [{
            logged: true,
            result: { kind: "note", note: "n".repeat(41) },
          }],
        }],
      },
    })).toThrow(/fully visible/iu);
    expect(() => buildWorkoutSessionAppCardEnvelopeV6({
      ...noteInput,
      editor: {
        ...noteInput.editor,
        exercises: [{
          unitOverride: null,
          sets: [{
            logged: true,
            result: { kind: "note", note: "n".repeat(400) },
          }],
        }],
      },
    })).toThrow(/fully visible/iu);
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
      }).success,
    ).toBe(false);
  });

  it("allows an open targetless workout whose current slots are logged", () => {
    const workout = workoutSessionDetailV1Schema.parse({
      ...TRACKED_WORKOUT_CARD.workout,
      exercises: TRACKED_WORKOUT_CARD.workout?.exercises.map(
        (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({
            actual: set.actual ?? "1 rep",
            status: "completed",
            target: null,
          })),
        }),
      ),
    });
    const card: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      subtitle: "All current log slots complete",
      workout,
    };

    expect(compactTableResponseCardV1Schema.parse(card)).toEqual(card);
  });

  it("keeps member repetition prescriptions separate from finite plans and actuals", () => {
    const workout = workoutSessionSchema.parse({
      sourceApp: "murph-live",
      startedAt: "2026-08-20T12:00:00.000Z",
      exercises: [
        {
          memberRepsPerSet: 9,
          name: "Seated cable curl",
          order: 1,
          setPlanIsFinite: true,
          sets: [{ order: 1 }, { order: 2, reps: 9 }],
        },
        {
          name: "Push-up",
          order: 2,
          setPlanIsFinite: false,
          sets: [{ order: 1 }],
        },
      ],
    });

    expect(workout.exercises[0]?.memberRepsPerSet).toBe(9);
    expect(workout.exercises[0]?.sets[0]?.reps).toBeUndefined();
    expect(workout.exercises[0]?.sets[1]?.reps).toBe(9);
    expect(workout.exercises[1]?.setPlanIsFinite).toBe(false);
    expect(
      workoutSessionSchema.safeParse({
        ...workout,
        exercises: [{ ...workout.exercises[0], memberRepsPerSet: 0 }],
      }).success,
    ).toBe(false);
  });

  it("accepts complete higher-cardinality workouts when their actual envelope fits", () => {
    if (!("workout" in TRACKED_WORKOUT_CARD)) {
      throw new TypeError("Expected the workout card fixture.");
    }

    const exerciseNames = [
      "Back squat",
      "Romanian deadlift",
      "Leg press",
      "Leg extension",
      "Hamstring curl",
      "Walking lunge",
      "Calf raise",
      "Hip thrust",
      "Cable row",
      "Push-up",
      "Farmer carry",
    ];
    const largerWorkoutCard: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      subtitle: null,
      footer: "Reply with the exercise, set, and result.",
      workout: {
        version: 1,
        state: "active",
        exercises: exerciseNames.map((name, exerciseIndex) => ({
          name,
          sets: Array.from({ length: 3 }, (_, setIndex) => {
            const isCompleted = exerciseIndex * 3 + setIndex < 30;
            return isCompleted
              ? {
                  status: "completed" as const,
                  target: "8 reps",
                  actual: "8 reps",
                }
              : {
                  status: "pending" as const,
                  target: "8 reps",
                  actual: null,
                };
          }),
        })),
      },
    };

    expect(compactTableResponseCardV1Schema.parse(largerWorkoutCard)).toEqual(
      largerWorkoutCard,
    );
    expect(largerWorkoutCard.workout.exercises).toHaveLength(11);
    expect(largerWorkoutCard.workout.exercises.flatMap(
      (exercise) => exercise.sets,
    )).toHaveLength(33);

    const manySetCard: CompactTableResponseCardV1 = {
      ...largerWorkoutCard,
      workout: {
        version: 1,
        state: "active",
        exercises: [{
          name: "Pull-up",
          sets: Array.from({ length: 12 }, (_, index) =>
            index < 11
              ? {
                  status: "completed" as const,
                  target: "5 reps",
                  actual: "5 reps",
                }
              : {
                  status: "pending" as const,
                  target: "5 reps",
                  actual: null,
                }),
        }],
      },
    };

    expect(compactTableResponseCardV1Schema.parse(manySetCard)).toEqual(
      manySetCard,
    );
  });

  it("pins the literal 16-exercise and 16-set V4 boundaries", () => {
    const sixteenExerciseWorkout = {
      version: 1 as const,
      state: "active" as const,
      exercises: Array.from({ length: 16 }, (_, index) => ({
        name: `Exercise ${index + 1}`,
        sets: [{ status: "pending" as const, target: null, actual: null }],
      })),
    };
    const sixteenExerciseCard = {
      ...TRACKED_WORKOUT_CARD,
      title: "Exercise boundary",
      subtitle: null,
      footer: null,
      workout: sixteenExerciseWorkout,
    } satisfies CompactTableResponseCardV1;

    expect(
      compactTableResponseCardV1Schema.parse(sixteenExerciseCard),
    ).toEqual(sixteenExerciseCard);
    const decodedExerciseCard = parseCompactTableAppCardEnvelope(
      buildWorkoutSessionAppCardEnvelopeV4({
        title: sixteenExerciseCard.title,
        subtitle: sixteenExerciseCard.subtitle,
        footer: sixteenExerciseCard.footer,
        workout: sixteenExerciseCard.workout,
      }),
    );
    if (decodedExerciseCard === null || !("workout" in decodedExerciseCard)) {
      throw new TypeError("Expected the 16-exercise V4 workout envelope.");
    }
    expect(decodedExerciseCard.workout.exercises).toHaveLength(16);
    expect(decodedExerciseCard.workout.exercises[15]?.name).toBe(
      "Exercise 16",
    );

    const sixteenSetWorkout = {
      version: 1 as const,
      state: "active" as const,
      exercises: [{
        name: "Exercise 1",
        sets: Array.from({ length: 16 }, (_, index) => ({
          status: "pending" as const,
          target: `Set ${index + 1}`,
          actual: null,
        })),
      }],
    };
    const sixteenSetCard = {
      ...TRACKED_WORKOUT_CARD,
      title: "Set boundary",
      subtitle: null,
      footer: null,
      workout: sixteenSetWorkout,
    } satisfies CompactTableResponseCardV1;

    expect(compactTableResponseCardV1Schema.parse(sixteenSetCard)).toEqual(
      sixteenSetCard,
    );
    const decodedSetCard = parseCompactTableAppCardEnvelope(
      buildWorkoutSessionAppCardEnvelopeV4({
        title: sixteenSetCard.title,
        subtitle: sixteenSetCard.subtitle,
        footer: sixteenSetCard.footer,
        workout: sixteenSetCard.workout,
      }),
    );
    if (decodedSetCard === null || !("workout" in decodedSetCard)) {
      throw new TypeError("Expected the 16-set V4 workout envelope.");
    }
    expect(decodedSetCard.workout.exercises[0]?.sets).toHaveLength(16);
    expect(decodedSetCard.workout.exercises[0]?.sets[15]?.target).toBe(
      "Set 16",
    );

    expect(workoutSessionDetailV1Schema.safeParse({
      ...sixteenExerciseWorkout,
      exercises: Array.from({ length: 17 }, (_, index) => ({
        name: `Exercise ${index + 1}`,
        sets: [{ status: "pending" as const, target: null, actual: null }],
      })),
    }).success).toBe(false);
    expect(workoutSessionDetailV1Schema.safeParse({
      ...sixteenSetWorkout,
      exercises: [{
        name: "Exercise 1",
        sets: Array.from({ length: 17 }, () => ({
          status: "pending" as const,
          target: null,
          actual: null,
        })),
      }],
    }).success).toBe(false);
  });

  it("keeps generic table fields out of the workout branch", () => {
    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        rows: [{ label: "Bench press", values: ["3/3"] }],
      }).success,
    ).toBe(false);

    expect(
      compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        rowHeader: "Exercise",
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

  it("keeps realistic initial, late-active, and completed sessions under the inline URL limit", () => {
    const exerciseNames = [
      "Dumbbell Single-Leg Romanian Deadlift",
      "Dumbbell Bulgarian Split Squat",
      "Dumbbell Walking Lunge in Place",
      "Split Squat with Front Heel Lift",
      "Dumbbell Reverse Lunge",
      "Dumbbell Step-Up",
    ];
    const targets = [
      "55 lb × 8–10",
      "55 lb × 10",
      "65 lb × 10–12",
      "65 lb × 12",
    ];
    const actuals = [
      "55 lb × 9",
      "55 lb × 10",
      "65 lb × 11",
      "65 lb × 12",
    ];
    const buildCard = (
      state: "active" | "completed",
      completedSetCount: number,
    ): CompactTableResponseCardV1 => ({
      ...TRACKED_WORKOUT_CARD,
      title: "Lower body strength",
      subtitle: `${completedSetCount} of 24 sets complete`,
      footer:
        state === "active"
          ? "Reply with the exercise, set, and result to log or correct it."
          : "Workout completed.",
      workout: {
        version: 1,
        state,
        exercises: exerciseNames.map((name, exerciseIndex) => ({
          name,
          sets: targets.map((target, setIndex) => {
            const isCompleted =
              exerciseIndex * targets.length + setIndex < completedSetCount;
            return {
              status: isCompleted ? "completed" : "pending",
              target,
              actual: isCompleted ? actuals[setIndex] : null,
            };
          }),
        })),
      },
    });

    for (const card of [
      buildCard("active", 0),
      buildCard("active", 18),
      buildCard("completed", 24),
    ]) {
      expect(compactTableResponseCardV1Schema.parse(card)).toEqual(card);
    }

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
      workout: oversizedWorkout,
      footer: "F".repeat(workoutSessionCardV1Bounds.footer),
    };

    expect(compactTableResponseCardV1Schema.safeParse(oversized).success).toBe(
      false,
    );
  });
});
