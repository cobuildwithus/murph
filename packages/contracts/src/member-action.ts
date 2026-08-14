import * as z from "./zod-runtime.ts";

export const memberActionV1Bounds = {
  actionId: 36,
  exerciseName: 60,
  exercises: 8,
  expectedFreeformResult: 400,
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

const canonicalNonnegativeIntegerSchema = z
  .number()
  .finite()
  .min(0)
  .refine((value) => Number.isInteger(value), "Expected an integer.");

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

export const workoutMemberActionExpectedSetResultV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("note"),
        note: singleLineText(
          memberActionV1Bounds.expectedFreeformResult,
        ).nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("reps"),
        reps: canonicalNonnegativeIntegerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("weight_reps"),
        reps: canonicalNonnegativeIntegerSchema.nullable(),
        weight: z.number().finite().min(0).nullable(),
        weightUnit: z.enum(["lb", "kg"]).nullable(),
      })
      .strict(),
  ],
);

export type WorkoutMemberActionExpectedSetResultV1 = z.infer<
  typeof workoutMemberActionExpectedSetResultV1Schema
>;

export const workoutMemberActionExpectedSetStateV1Schema = z
  .object({
    logged: z.boolean(),
    result: workoutMemberActionExpectedSetResultV1Schema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.logged !== (state.result !== null)) {
      context.addIssue({
        code: "custom",
        message: "Logged state and typed set state must agree.",
        path: ["result"],
      });
    }
  });

export type WorkoutMemberActionExpectedSetStateV1 = z.infer<
  typeof workoutMemberActionExpectedSetStateV1Schema
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
        expectedResult: workoutMemberActionExpectedSetResultV1Schema.nullable(),
        kind: z.literal("set.put"),
        result: workoutMemberActionSetResultV1Schema,
        setPosition: workoutSetPositionSchema,
      })
      .strict(),
    z
      .object({
        exerciseName: singleLineText(memberActionV1Bounds.exerciseName),
        exercisePosition: workoutExercisePositionSchema,
        kind: z.literal("set.append"),
        result: workoutMemberActionSetResultV1Schema.nullable(),
        setPosition: workoutSetPositionSchema,
      })
      .strict(),
    z
      .object({
        exerciseName: singleLineText(memberActionV1Bounds.exerciseName),
        exercisePosition: workoutExercisePositionSchema,
        expectedSets: z
          .array(workoutMemberActionExpectedSetStateV1Schema)
          .min(2)
          .max(memberActionV1Bounds.setsPerExercise),
        kind: z.literal("set.remove"),
        setPosition: workoutSetPositionSchema,
      })
      .strict(),
  ],
).superRefine((mutation, context) => {
  if (
    mutation.kind === "set.put"
    && mutation.expectedResult !== null
    && mutation.expectedResult.kind !== mutation.result.kind
  ) {
    context.addIssue({
      code: "custom",
      message: "A set update must compare and write the same field family.",
      path: ["expectedResult"],
    });
  }
  if (mutation.kind === "set.remove") {
    if (mutation.setPosition > mutation.expectedSets.length) {
      context.addIssue({
        code: "custom",
        message: "A removed set must exist in the expected exercise snapshot.",
        path: ["setPosition"],
      });
    }
  }
});

export type WorkoutMemberActionMutationV1 = z.infer<
  typeof workoutMemberActionMutationV1Schema
>;

type WorkoutMemberActionSetPutV1 = Extract<
  WorkoutMemberActionMutationV1,
  { kind: "set.put" }
>;
type WorkoutMemberActionSetAppendV1 = Extract<
  WorkoutMemberActionMutationV1,
  { kind: "set.append" }
>;
type WorkoutMemberActionSetRemoveV1 = Extract<
  WorkoutMemberActionMutationV1,
  { kind: "set.remove" }
>;

function destructiveSetBatchChangesVisibleSequence(input: {
  exercisePosition: number;
  expectedSets: WorkoutMemberActionExpectedSetStateV1[];
  mutations: WorkoutMemberActionMutationV1[];
}): boolean {
  const projected = input.expectedSets.map((state) => ({
    logged: state.logged,
    result: state.result === null ? null : { ...state.result },
  }));
  const puts = input.mutations.filter(
    (mutation): mutation is WorkoutMemberActionSetPutV1 =>
      mutation.kind === "set.put"
      && mutation.exercisePosition === input.exercisePosition,
  );
  for (const mutation of puts) {
    if (projected[mutation.setPosition - 1] === undefined) {
      return true;
    }
    projected[mutation.setPosition - 1] = {
      logged: true,
      result: mutation.result,
    };
  }

  const removals = input.mutations.filter(
    (mutation): mutation is WorkoutMemberActionSetRemoveV1 =>
      mutation.kind === "set.remove"
      && mutation.exercisePosition === input.exercisePosition,
  ).sort((left, right) => right.setPosition - left.setPosition);
  for (const mutation of removals) {
    projected.splice(mutation.setPosition - 1, 1);
  }

  const appends = input.mutations.filter(
    (mutation): mutation is WorkoutMemberActionSetAppendV1 =>
      mutation.kind === "set.append"
      && mutation.exercisePosition === input.exercisePosition,
  ).sort((left, right) => left.setPosition - right.setPosition);
  for (const mutation of appends) {
    if (mutation.setPosition !== projected.length + 1) {
      return true;
    }
    projected.push({
      logged: mutation.result !== null,
      result: mutation.result,
    });
  }

  return JSON.stringify(projected) !== JSON.stringify(input.expectedSets);
}

export const workoutLiveApplyMemberActionV1Schema = z
  .object({
    expectedWorkout: z
      .object({
        actionBinding: z.string().regex(/^[0-9a-f]{64}$/u),
        exercises: z
          .array(workoutMemberActionExpectedExerciseV1Schema)
          .min(1)
          .max(memberActionV1Bounds.exercises),
        setRemovalBinding: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
      })
      .strict(),
    kind: z.literal("workout.live.apply"),
    mutations: z
      .array(workoutMemberActionMutationV1Schema)
      .min(1)
      .max(memberActionV1Bounds.mutations),
    version: z.literal(1),
  })
  .strict()
  .superRefine((action, context) => {
    const targets = new Map<string, WorkoutMemberActionMutationV1>();
    const removalSnapshots = new Map<
      number,
      { exerciseName: string; expectedSets: string }
    >();
    action.mutations.forEach((mutation, index) => {
      const target = mutation.kind === "exercise.append"
        ? `exercise:${mutation.exercisePosition}`
        : mutation.kind === "set.append"
          ? `set-append:${mutation.exercisePosition}:${mutation.setPosition}`
        : `set:${mutation.exercisePosition}:${mutation.setPosition}`;
      const existing = targets.get(target);
      if (existing) {
        context.addIssue({
          code: "custom",
          message: "Each workout mutation target must be unique.",
          path: ["mutations", index],
        });
        return;
      }
      targets.set(target, mutation);

      if (mutation.kind === "set.remove") {
        const snapshot = {
          exerciseName: mutation.exerciseName,
          expectedSets: JSON.stringify(mutation.expectedSets),
        };
        const existingSnapshot = removalSnapshots.get(
          mutation.exercisePosition,
        );
        if (
          existingSnapshot
          && (existingSnapshot.exerciseName !== snapshot.exerciseName
            || existingSnapshot.expectedSets !== snapshot.expectedSets)
        ) {
          context.addIssue({
            code: "custom",
            message: "Set removals for one exercise must share one snapshot.",
            path: ["mutations", index, "expectedSets"],
          });
          return;
        }
        removalSnapshots.set(mutation.exercisePosition, snapshot);
      }
    });

    const removals = action.mutations.filter(
      (mutation) => mutation.kind === "set.remove",
    );
    if (removals.length > 0 && action.expectedWorkout.setRemovalBinding === undefined) {
      context.addIssue({
        code: "custom",
        message: "Set removal requires an exact canonical-state binding.",
        path: ["expectedWorkout", "setRemovalBinding"],
      });
    }

    const checkedRemovalExercises = new Set<number>();
    removals.forEach((removal) => {
      if (checkedRemovalExercises.has(removal.exercisePosition)) {
        return;
      }
      checkedRemovalExercises.add(removal.exercisePosition);
      if (!destructiveSetBatchChangesVisibleSequence({
        exercisePosition: removal.exercisePosition,
        expectedSets: removal.expectedSets,
        mutations: action.mutations,
      })) {
        const index = action.mutations.indexOf(removal);
        context.addIssue({
          code: "custom",
          message: "A destructive set batch must change the visible set sequence.",
          path: ["mutations", index],
        });
      }
    });

    const appendsByExercise = new Map<
      number,
      Array<{
        exerciseName: string;
        index: number;
        setPosition: number;
      }>
    >();
    action.mutations.forEach((mutation, index) => {
      if (mutation.kind !== "set.append") {
        return;
      }
      const appends = appendsByExercise.get(mutation.exercisePosition) ?? [];
      appends.push({
        exerciseName: mutation.exerciseName,
        index,
        setPosition: mutation.setPosition,
      });
      appendsByExercise.set(mutation.exercisePosition, appends);
    });
    for (const [exercisePosition, appends] of appendsByExercise) {
      const expectedExercise = action.expectedWorkout.exercises[
        exercisePosition - 1
      ];
      if (expectedExercise === undefined) {
        context.addIssue({
          code: "custom",
          message: "A set append must target an existing expected exercise.",
          path: ["mutations", appends[0]!.index],
        });
        continue;
      }
      const removedPositions = new Set(
        removals.flatMap((removal) =>
          removal.exercisePosition === exercisePosition
            ? [removal.setPosition]
            : []
        ),
      );
      const firstAppendPosition = expectedExercise.sets.length
        - removedPositions.size
        + 1;
      const orderedAppends = appends.slice().sort((left, right) =>
        left.setPosition - right.setPosition
      );
      orderedAppends.forEach((append, appendIndex) => {
        if (
          append.exerciseName !== expectedExercise.name
          || append.setPosition !== firstAppendPosition + appendIndex
        ) {
          context.addIssue({
            code: "custom",
            message: "New sets must append contiguously after retained sets.",
            path: ["mutations", append.index],
          });
        }
      });
    }
  });

export type WorkoutLiveApplyMemberActionV1 = z.infer<
  typeof workoutLiveApplyMemberActionV1Schema
>;

export const memberActionV1Schema = z.discriminatedUnion("kind", [
  workoutLiveApplyMemberActionV1Schema,
]);

export type MemberActionV1 = z.infer<typeof memberActionV1Schema>;

export const memberActionIdV1Schema = z
  .string()
  .length(memberActionV1Bounds.actionId)
  .regex(UUID_PATTERN, "Expected a UUID action identity.");

export const memberActionRequestV1Schema = z
  .object({
    action: memberActionV1Schema,
    actionId: memberActionIdV1Schema,
    requestedAt: z.string().datetime({ offset: true }),
    schemaVersion: z.literal(1),
  })
  .strict();

export type MemberActionRequestV1 = z.infer<
  typeof memberActionRequestV1Schema
>;

export const memberActionRejectionReasonV1Schema = z.enum([
  "multiple_active_workouts",
  "no_active_workout",
  "workout_changed",
]);

export type MemberActionRejectionReasonV1 = z.infer<
  typeof memberActionRejectionReasonV1Schema
>;

export const memberActionOutcomeV1Schema = z
  .object({
    actionId: memberActionIdV1Schema,
    completedAt: z.string().datetime({ offset: true }),
    reason: memberActionRejectionReasonV1Schema.nullable(),
    schemaVersion: z.literal(1),
    status: z.enum(["applied", "rejected", "unchanged"]),
  })
  .strict()
  .superRefine((outcome, context) => {
    if ((outcome.status === "rejected") !== (outcome.reason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a rejected member action carries a reason.",
        path: ["reason"],
      });
    }
  });

export type MemberActionOutcomeV1 = z.infer<typeof memberActionOutcomeV1Schema>;

export const memberActionStatusV1Schema = z.union([
  z.object({
    actionId: memberActionIdV1Schema,
    schemaVersion: z.literal(1),
    status: z.literal("pending"),
  }).strict(),
  memberActionOutcomeV1Schema,
]);

export type MemberActionStatusV1 = z.infer<typeof memberActionStatusV1Schema>;

export function parseMemberActionRequestV1(
  value: unknown,
): MemberActionRequestV1 {
  return memberActionRequestV1Schema.parse(value);
}

export function parseMemberActionOutcomeV1(value: unknown): MemberActionOutcomeV1 {
  return memberActionOutcomeV1Schema.parse(value);
}
