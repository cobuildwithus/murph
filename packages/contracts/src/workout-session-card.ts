import * as z from "./zod-runtime.ts";

export const workoutSessionCardV1Bounds = {
  title: 60,
  subtitle: 120,
  exerciseName: 60,
  setValue: 40,
  footer: 120,
  exercises: 8,
  setsPerExercise: 8,
} as const;

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(
      /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u,
      "Expected one printable line of text.",
    );
}

export const workoutSessionCardStateValues = [
  "active",
  "completed",
] as const;
export type WorkoutSessionCardState =
  (typeof workoutSessionCardStateValues)[number];

export const workoutSessionSetStatusValues = [
  "pending",
  "completed",
  "skipped",
] as const;
export type WorkoutSessionSetStatus =
  (typeof workoutSessionSetStatusValues)[number];

export const workoutSessionSetV1Schema = z
  .object({
    status: z.enum(workoutSessionSetStatusValues),
    target: singleLineText(workoutSessionCardV1Bounds.setValue).nullable(),
    actual: singleLineText(workoutSessionCardV1Bounds.setValue).nullable(),
  })
  .strict()
  .superRefine((set, context) => {
    if (set.status === "completed" && set.actual === null) {
      context.addIssue({
        code: "custom",
        message: "A completed set requires an actual value.",
        path: ["actual"],
      });
    }

    if (set.status !== "completed" && set.actual !== null) {
      context.addIssue({
        code: "custom",
        message: "Only a completed set may carry an actual value.",
        path: ["actual"],
      });
    }
  });

export type WorkoutSessionSetV1 = z.infer<
  typeof workoutSessionSetV1Schema
>;

export const workoutSessionExerciseV1Schema = z
  .object({
    name: singleLineText(workoutSessionCardV1Bounds.exerciseName),
    sets: z
      .array(workoutSessionSetV1Schema)
      .min(1)
      .max(workoutSessionCardV1Bounds.setsPerExercise),
  })
  .strict();

export type WorkoutSessionExerciseV1 = z.infer<
  typeof workoutSessionExerciseV1Schema
>;

/**
 * Structured workout detail embedded in a tracked compact-table response card.
 * The outer compact-table card owns the title, subtitle, footer, and canonical
 * tracking marker; this detail owns only live workout state and set rows.
 */
export const workoutSessionDetailV1Schema = z
  .object({
    version: z.literal(1),
    state: z.enum(workoutSessionCardStateValues),
    exercises: z
      .array(workoutSessionExerciseV1Schema)
      .min(1)
      .max(workoutSessionCardV1Bounds.exercises),
  })
  .strict()
  .superRefine((workout, context) => {
    const pendingSetCount = workout.exercises.reduce(
      (total, exercise) =>
        total +
        exercise.sets.filter((set) => set.status === "pending").length,
      0,
    );
    const skippedSetCount = workout.exercises.reduce(
      (total, exercise) =>
        total +
        exercise.sets.filter((set) => set.status === "skipped").length,
      0,
    );

    if (workout.state === "active" && skippedSetCount > 0) {
      context.addIssue({
        code: "custom",
        message: "An active workout cannot contain skipped sets.",
        path: ["state"],
      });
    }

    if (workout.state === "completed" && pendingSetCount > 0) {
      context.addIssue({
        code: "custom",
        message: "A completed workout cannot contain pending sets.",
        path: ["state"],
      });
    }
  });

export type WorkoutSessionDetailV1 = z.infer<
  typeof workoutSessionDetailV1Schema
>;

export type WorkoutSessionAppCardEnvelopeV4 = {
  schemaVersion: 4;
  card: {
    k: "w";
    v: 1;
    t: string;
    u: string | null;
    s: "a" | "c";
    e: Array<
      [
        name: string,
        sets: Array<
          [
            status: "p" | "c" | "s",
            target: string | null,
            actual: string | null,
          ]
        >,
      ]
    >;
    f: string | null;
  };
};

export function buildWorkoutSessionAppCardEnvelopeV4(input: {
  title: string;
  subtitle: string | null;
  footer: string | null;
  workout: WorkoutSessionDetailV1;
}): WorkoutSessionAppCardEnvelopeV4 {
  return {
    schemaVersion: 4,
    card: {
      k: "w",
      v: 1,
      t: input.title,
      u: input.subtitle,
      s: input.workout.state === "active" ? "a" : "c",
      e: input.workout.exercises.map((exercise) => [
        exercise.name,
        exercise.sets.map((set) => [
          set.status === "pending"
            ? "p"
            : set.status === "completed"
              ? "c"
              : "s",
          set.target,
          set.actual,
        ]),
      ]),
      f: input.footer,
    },
  };
}
