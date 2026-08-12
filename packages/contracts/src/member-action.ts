import * as z from "./zod-runtime.ts";

export const memberActionV1Bounds = {
  actionId: 36,
  exerciseName: 60,
  exercises: 8,
  freeformResult: 200,
  mutations: 72,
  setsPerExercise: 8,
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u;

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(SINGLE_LINE_PATTERN, "Expected one printable line of text.");
}

const workoutExercisePositionSchema = z
  .number()
  .int()
  .min(1)
  .max(memberActionV1Bounds.exercises);

const workoutSetPositionSchema = z
  .number()
  .int()
  .min(1)
  .max(memberActionV1Bounds.setsPerExercise);

export const workoutMemberActionSetResultV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("note"),
        note: singleLineText(memberActionV1Bounds.freeformResult),
      })
      .strict(),
    z
      .object({
        kind: z.literal("reps"),
        reps: z.number().int().min(1).max(999),
      })
      .strict(),
    z
      .object({
        kind: z.literal("weight_reps"),
        reps: z.number().int().min(1).max(999),
        weight: z.number().finite().positive().max(9_999),
        weightUnit: z.enum(["lb", "kg"]),
      })
      .strict(),
  ],
);

export type WorkoutMemberActionSetResultV1 = z.infer<
  typeof workoutMemberActionSetResultV1Schema
>;

const workoutMemberActionExpectedSetV1Schema = z
  .object({
    logged: z.boolean(),
  })
  .strict();

const workoutMemberActionExpectedExerciseV1Schema = z
  .object({
    name: singleLineText(memberActionV1Bounds.exerciseName),
    sets: z
      .array(workoutMemberActionExpectedSetV1Schema)
      .min(1)
      .max(memberActionV1Bounds.setsPerExercise),
  })
  .strict();

export const workoutMemberActionMutationV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        exercisePosition: workoutExercisePositionSchema,
        kind: z.literal("exercise.append"),
        mode: z.enum(["bodyweight", "weight_reps"]).nullable(),
        name: singleLineText(memberActionV1Bounds.exerciseName),
        setCount: z
          .number()
          .int()
          .min(1)
          .max(memberActionV1Bounds.setsPerExercise),
        unitOverride: z.enum(["lb", "kg"]).nullable(),
      })
      .strict(),
    z
      .object({
        exerciseName: singleLineText(memberActionV1Bounds.exerciseName),
        exercisePosition: workoutExercisePositionSchema,
        expectedResult: workoutMemberActionSetResultV1Schema.nullable(),
        kind: z.literal("set.put"),
        requiresExistingSet: z.boolean(),
        result: workoutMemberActionSetResultV1Schema.nullable(),
        setPosition: workoutSetPositionSchema,
      })
      .strict(),
  ],
).superRefine((mutation, context) => {
  if (
    mutation.kind === "set.put"
    && !mutation.requiresExistingSet
    && mutation.expectedResult !== null
  ) {
    context.addIssue({
      code: "custom",
      message: "A new set cannot carry a previous result.",
      path: ["expectedResult"],
    });
  }
});

export type WorkoutMemberActionMutationV1 = z.infer<
  typeof workoutMemberActionMutationV1Schema
>;

export const workoutLiveApplyMemberActionV1Schema = z
  .object({
    expectedWorkout: z
      .object({
        exercises: z
          .array(workoutMemberActionExpectedExerciseV1Schema)
          .min(1)
          .max(memberActionV1Bounds.exercises),
      })
      .strict(),
    kind: z.literal("workout.live.apply"),
    mutations: z
      .array(workoutMemberActionMutationV1Schema)
      .min(1)
      .max(memberActionV1Bounds.mutations),
    version: z.literal(1),
  })
  .strict();

export type WorkoutLiveApplyMemberActionV1 = z.infer<
  typeof workoutLiveApplyMemberActionV1Schema
>;

export const memberActionV1Schema = z.discriminatedUnion("kind", [
  workoutLiveApplyMemberActionV1Schema,
]);

export type MemberActionV1 = z.infer<typeof memberActionV1Schema>;

export const memberActionRequestV1Schema = z
  .object({
    action: memberActionV1Schema,
    actionId: z
      .string()
      .length(memberActionV1Bounds.actionId)
      .regex(UUID_PATTERN, "Expected a UUID action identity."),
    requestedAt: z.string().datetime({ offset: true }),
    schemaVersion: z.literal(1),
  })
  .strict();

export type MemberActionRequestV1 = z.infer<
  typeof memberActionRequestV1Schema
>;

export function parseMemberActionRequestV1(
  value: unknown,
): MemberActionRequestV1 {
  return memberActionRequestV1Schema.parse(value);
}
