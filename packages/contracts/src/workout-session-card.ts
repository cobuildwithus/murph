import * as z from "./zod-runtime.ts";

export const workoutSessionCardV1Bounds = {
  title: 60,
  subtitle: 120,
  exerciseName: 60,
  setValue: 40,
  footer: 120,
  exercises: 16,
  setsPerExercise: 16,
} as const;

const singleLineTextPattern =
  /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u;

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(singleLineTextPattern, "Expected one printable line of text.");
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

export type WorkoutSessionAppCardPresentationV4 = {
  title: string;
  subtitle: string | null;
  footer: string | null;
  workout: WorkoutSessionDetailV1;
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

/**
 * Restores the readable, authority-free presentation snapshot from the compact
 * V4 wire. Canonical workout tracking remains intentionally absent.
 */
export function parseWorkoutSessionAppCardEnvelopeV4(
  value: unknown,
): WorkoutSessionAppCardPresentationV4 | null {
  if (
    !isExactRecord(value, ["schemaVersion", "card"])
    || value.schemaVersion !== 4
    || !isExactRecord(value.card, ["k", "v", "t", "u", "s", "e", "f"])
  ) {
    return null;
  }
  const card = value.card;
  if (
    card.k !== "w"
    || card.v !== 1
    || !isSingleLineText(card.t, workoutSessionCardV1Bounds.title)
    || !isNullableSingleLineText(
      card.u,
      workoutSessionCardV1Bounds.subtitle,
    )
    || (card.s !== "a" && card.s !== "c")
    || !Array.isArray(card.e)
    || !isNullableSingleLineText(card.f, workoutSessionCardV1Bounds.footer)
  ) {
    return null;
  }

  const exercises: WorkoutSessionDetailV1["exercises"] = [];
  for (const exercise of card.e) {
    if (
      !Array.isArray(exercise)
      || exercise.length !== 2
      || !isSingleLineText(
        exercise[0],
        workoutSessionCardV1Bounds.exerciseName,
      )
      || !Array.isArray(exercise[1])
    ) {
      return null;
    }
    const sets: WorkoutSessionSetV1[] = [];
    for (const set of exercise[1]) {
      if (
        !Array.isArray(set)
        || set.length !== 3
        || (set[0] !== "p" && set[0] !== "c" && set[0] !== "s")
        || !isNullableSingleLineText(
          set[1],
          workoutSessionCardV1Bounds.setValue,
        )
        || !isNullableSingleLineText(
          set[2],
          workoutSessionCardV1Bounds.setValue,
        )
      ) {
        return null;
      }
      sets.push({
        status:
          set[0] === "p"
            ? "pending"
            : set[0] === "c"
              ? "completed"
              : "skipped",
        target: set[1],
        actual: set[2],
      });
    }
    exercises.push({ name: exercise[0], sets });
  }

  const workout = workoutSessionDetailV1Schema.safeParse({
    version: 1,
    state: card.s === "a" ? "active" : "completed",
    exercises,
  });
  if (!workout.success) {
    return null;
  }

  return {
    title: card.t,
    subtitle: card.u,
    footer: card.f,
    workout: workout.data,
  };
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isSingleLineText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && singleLineTextPattern.test(value);
}

function isNullableSingleLineText(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || isSingleLineText(value, maxLength);
}
