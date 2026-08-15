import * as z from "./zod-runtime.ts";

import { workoutMemberActionExpectedSetResultV1Schema } from "./member-action.ts";

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

const workoutSessionEditorResultV1Schema = workoutMemberActionExpectedSetResultV1Schema
  .superRefine((result, context) => {
    if (
      result.kind === "note"
      && result.note !== null
      && result.note.length > workoutSessionCardV1Bounds.setValue
    ) {
      context.addIssue({
        code: "custom",
        message: "An editable note must be fully visible in the workout card.",
        path: ["note"],
      });
    }
  });

const workoutSessionEditorSetV1Schema = z
  .object({
    logged: z.boolean(),
    result: workoutSessionEditorResultV1Schema.nullable(),
  })
  .strict()
  .superRefine((set, context) => {
    if (set.logged !== (set.result !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a logged set carries an editable result.",
        path: ["result"],
      });
    }
  });

const workoutSessionEditorExerciseV1Schema = z
  .object({
    sets: z
      .array(workoutSessionEditorSetV1Schema)
      .min(1)
      .max(workoutSessionCardV1Bounds.setsPerExercise),
    unitOverride: z.enum(["lb", "kg"]).nullable(),
  })
  .strict();

/**
 * Runtime-authored optimistic projection for the native workout editor.
 * It is deliberately separate from the model-authored presentation schema.
 */
export const workoutSessionEditorProjectionV1Schema = z
  .object({
    actionBinding: z.string().regex(/^[0-9a-f]{64}$/u),
    exercises: z
      .array(workoutSessionEditorExerciseV1Schema)
      .min(1)
      .max(workoutSessionCardV1Bounds.exercises),
    setRemovalBinding: z.string().regex(/^[0-9a-f]{64}$/u),
    version: z.literal(1),
  })
  .strict();

export type WorkoutSessionEditorProjectionV1 = z.infer<
  typeof workoutSessionEditorProjectionV1Schema
>;

type WorkoutSessionEditorSetResultV1 = NonNullable<
  WorkoutSessionEditorProjectionV1["exercises"][number]["sets"][number]["result"]
>;

type WorkoutSessionEditorResultWireV1 =
  | [kind: "n", note: string | null]
  | [kind: "r", reps: number | null]
  | [
      kind: "w",
      reps: number | null,
      weight: number | null,
      setUnit: "l" | "k" | null,
    ];

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

export type WorkoutSessionAppCardEnvelopeV6 = {
  schemaVersion: 6;
  card: {
    k: "w";
    v: 1;
    t: string;
    u: string | null;
    s: "a";
    e: Array<
      [
        name: string,
        exerciseUnit: "l" | "k" | null,
        sets: Array<
          [
            status: "p" | "c",
            target: string | null,
            result: WorkoutSessionEditorResultWireV1 | null,
          ]
        >,
      ]
    >;
    f: string | null;
    b: string;
    d: string;
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

export function buildWorkoutSessionAppCardEnvelopeV6(input: {
  editor: WorkoutSessionEditorProjectionV1;
  title: string;
  subtitle: string | null;
  footer: string | null;
  workout: WorkoutSessionDetailV1;
}): WorkoutSessionAppCardEnvelopeV6 {
  const editor = workoutSessionEditorProjectionV1Schema.parse(input.editor);
  if (
    input.workout.state !== "active"
    || editor.exercises.length !== input.workout.exercises.length
  ) {
    throw new TypeError("Workout editor projection does not match the active card.");
  }
  return {
    schemaVersion: 6,
    card: {
      k: "w",
      v: 1,
      t: input.title,
      u: input.subtitle,
      s: "a",
      e: input.workout.exercises.map((exercise, exerciseIndex) => {
        const editorExercise = editor.exercises[exerciseIndex];
        if (
          !editorExercise
          || editorExercise.sets.length !== exercise.sets.length
        ) {
          throw new TypeError("Workout editor projection does not match the card sets.");
        }
        return [
          exercise.name,
          encodeWorkoutWeightUnit(editorExercise.unitOverride),
          exercise.sets.map((set, setIndex) => {
            const editorSet = editorExercise.sets[setIndex];
            if (
              !editorSet
              || editorSet.logged !== (set.status === "completed")
            ) {
              throw new TypeError("Workout editor projection does not match set state.");
            }
            return [
              set.status === "completed" ? "c" : "p",
              set.target,
              editorSet.result === null
                ? null
                : encodeWorkoutEditorResult(editorSet.result),
            ];
          }),
        ];
      }),
      f: input.footer,
      b: editor.actionBinding,
      d: editor.setRemovalBinding,
    },
  };
}

/**
 * Restores the readable presentation snapshot from either workout-card wire.
 * The V6 action and removal bindings are validated and intentionally omitted
 * from presentation.
 */
export function parseWorkoutSessionAppCardEnvelopeV4(
  value: unknown,
): WorkoutSessionAppCardPresentationV4 | null {
  if (
    !isExactRecord(value, ["schemaVersion", "card"])
    || (value.schemaVersion !== 4 && value.schemaVersion !== 6)
    || !isExactRecord(
      value.card,
      value.schemaVersion === 6
        ? ["k", "v", "t", "u", "s", "e", "f", "b", "d"]
        : ["k", "v", "t", "u", "s", "e", "f"],
    )
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
    || (value.schemaVersion === 6 && !isWorkoutActionBinding(card.b))
    || (value.schemaVersion === 6 && !isWorkoutActionBinding(card.d))
    || (value.schemaVersion === 6 && card.s !== "a")
  ) {
    return null;
  }

  const exercises: WorkoutSessionDetailV1["exercises"] = [];
  for (const exercise of card.e) {
    if (
      !Array.isArray(exercise)
      || exercise.length !== (value.schemaVersion === 6 ? 3 : 2)
      || !isSingleLineText(
        exercise[0],
        workoutSessionCardV1Bounds.exerciseName,
      )
      || (value.schemaVersion === 6
        && !isEncodedWorkoutWeightUnit(exercise[1]))
      || !Array.isArray(exercise[value.schemaVersion === 6 ? 2 : 1])
    ) {
      return null;
    }
    const encodedExerciseUnit = value.schemaVersion === 6
      ? exercise[1]
      : null;
    const encodedSets = exercise[value.schemaVersion === 6 ? 2 : 1];
    if (!Array.isArray(encodedSets)) {
      return null;
    }
    const sets: WorkoutSessionSetV1[] = [];
    for (const set of encodedSets) {
      if (
        !Array.isArray(set)
        || set.length !== 3
        || (value.schemaVersion === 6
          ? set[0] !== "p" && set[0] !== "c"
          : set[0] !== "p" && set[0] !== "c" && set[0] !== "s")
        || !isNullableSingleLineText(
          set[1],
          workoutSessionCardV1Bounds.setValue,
        )
      ) {
        return null;
      }
      if (
        value.schemaVersion === 6
        && set[0] === "p"
        && set[2] !== null
      ) {
        return null;
      }
      const renderedEditorActual = value.schemaVersion === 6
        ? set[0] === "p" && set[2] === null
          ? null
          : renderWorkoutSessionEditorResultV1(
              set[2],
              decodeWorkoutWeightUnit(encodedExerciseUnit),
            )
        : isNullableSingleLineText(
            set[2],
            workoutSessionCardV1Bounds.setValue,
          )
          ? set[2]
          : undefined;
      if (
        renderedEditorActual === undefined
        || (set[0] === "c" && renderedEditorActual === null)
      ) {
        return null;
      }
      const actual = set[0] === "c" ? renderedEditorActual : null;
      sets.push({
        status:
          set[0] === "p"
            ? "pending"
            : set[0] === "c"
              ? "completed"
              : "skipped",
        target: set[1],
        actual,
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

function encodeWorkoutEditorResult(
  result: WorkoutSessionEditorSetResultV1,
): WorkoutSessionEditorResultWireV1 {
  switch (result.kind) {
    case "note":
      return ["n", result.note];
    case "reps":
      return ["r", result.reps];
    case "weight_reps":
      return [
        "w",
        result.reps,
        result.weight,
        encodeWorkoutWeightUnit(result.weightUnit),
      ];
  }
}

export function renderWorkoutSessionEditorResultV1(
  value: unknown,
  exerciseUnit: "lb" | "kg" | null,
): string | null | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 2 && value[0] === "n") {
    if (value[1] === null) {
      return "Logged";
    }
    if (!isSingleLineText(
      value[1],
      workoutSessionCardV1Bounds.setValue,
    )) {
      return undefined;
    }
    return value[1];
  }
  if (value.length === 2 && value[0] === "r") {
    if (value[1] === null) {
      return "Logged";
    }
    return isCanonicalWorkoutReps(value[1]) ? `${value[1]} reps` : undefined;
  }
  if (
    value.length !== 4
    || value[0] !== "w"
    || !isNullableCanonicalWorkoutReps(value[1])
    || !isNullableCanonicalWorkoutWeight(value[2])
    || !isEncodedWorkoutWeightUnit(value[3])
  ) {
    return undefined;
  }
  const reps = value[1];
  const weight = value[2];
  const unit = decodeWorkoutWeightUnit(value[3]) ?? exerciseUnit;
  if (weight !== null && reps !== null && unit !== null) {
    return `${weight} ${unit} × ${reps}`;
  }
  if (reps !== null) {
    return `${reps} reps`;
  }
  if (weight !== null && unit !== null) {
    return `${weight} ${unit}`;
  }
  if (weight !== null) {
    return `${weight}`;
  }
  return "Logged";
}

function encodeWorkoutWeightUnit(
  value: "lb" | "kg" | null,
): "l" | "k" | null {
  return value === "lb" ? "l" : value === "kg" ? "k" : null;
}

function decodeWorkoutWeightUnit(
  value: unknown,
): "lb" | "kg" | null {
  return value === "l" ? "lb" : value === "k" ? "kg" : null;
}

function isEncodedWorkoutWeightUnit(
  value: unknown,
): value is "l" | "k" | null {
  return value === null || value === "l" || value === "k";
}

function isCanonicalWorkoutReps(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

function isNullableCanonicalWorkoutReps(
  value: unknown,
): value is number | null {
  return value === null || isCanonicalWorkoutReps(value);
}

function isNullableCanonicalWorkoutWeight(
  value: unknown,
): value is number | null {
  return value === null
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isWorkoutActionBinding(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
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
