import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  WorkoutLiveApplyMemberActionV1,
  WorkoutSession,
} from "@murphai/contracts";
import { initializeVault } from "@murphai/core";
import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
} from "@murphai/operator-config/workout-action-binding";
import { expect, test } from "vitest";

import {
  addLiveWorkoutExercise,
  applyLiveWorkoutMemberAction as applyLiveWorkoutMemberActionWithId,
  finishLiveWorkout,
  logLiveWorkoutSet,
  showActiveLiveWorkout,
  startLiveWorkout,
} from "../src/usecases/workout-live.js";
import { parseShownWorkout } from "../src/usecases/workout-live-state.js";
import { editWorkoutRecord } from "../src/usecases/workout.js";

const STARTED_AT = "2026-08-13T14:00:00.000Z";
const ACCEPTED_AT = "2026-08-13T15:00:00.000Z";
const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
const SECOND_ACTION_ID = "8676b264-9b91-4b50-8c73-184d7a63b901";

function applyLiveWorkoutMemberAction(
  input: Omit<
    Parameters<typeof applyLiveWorkoutMemberActionWithId>[0],
    "actionId"
  > & { actionId?: string },
) {
  return applyLiveWorkoutMemberActionWithId({
    ...input,
    actionId: input.actionId ?? ACTION_ID,
  });
}

async function createLoggedWorkout(reps: readonly number[]): Promise<{
  vault: string;
  workout: WorkoutSession;
  workoutId: string;
}> {
  const vault = await mkdtemp(path.join(os.tmpdir(), "murph-member-action-real-"));
  await initializeVault({
    vaultRoot: vault,
    createdAt: "2026-08-13T13:00:00.000Z",
    timezone: "UTC",
  });
  await startLiveWorkout({
    vault,
    name: "Workout",
    startedAt: STARTED_AT,
  });
  await addLiveWorkoutExercise({
    vault,
    mode: "bodyweight",
    name: "Push-up",
    order: 1,
    setCount: reps.length,
  });
  for (const [index, value] of reps.entries()) {
    await logLiveWorkoutSet({
      vault,
      exerciseOrder: 1,
      reps: value,
      requireExistingSet: true,
      setOrder: index + 1,
    });
  }
  const shown = await showActiveLiveWorkout({ vault });
  return {
    vault,
    workout: parseShownWorkout(shown),
    workoutId: shown.entity.id,
  };
}

async function createSameNameWorkout(rightReps: number): Promise<{
  vault: string;
  workout: WorkoutSession;
  workoutId: string;
}> {
  const vault = await mkdtemp(path.join(os.tmpdir(), "murph-member-action-reorder-"));
  await initializeVault({
    vaultRoot: vault,
    createdAt: "2026-08-13T13:00:00.000Z",
    timezone: "UTC",
  });
  await startLiveWorkout({
    vault,
    name: "Workout",
    startedAt: STARTED_AT,
  });
  for (const [index, groupId] of ["left", "right"].entries()) {
    await addLiveWorkoutExercise({
      groupId,
      mode: "bodyweight",
      name: "Single-arm row",
      order: index + 1,
      setCount: 1,
      vault,
    });
    await logLiveWorkoutSet({
      vault,
      exerciseOrder: index + 1,
      reps: index === 0 ? 8 : rightReps,
      requireExistingSet: true,
      setOrder: 1,
    });
  }
  const shown = await showActiveLiveWorkout({ vault });
  return {
    vault,
    workout: parseShownWorkout(shown),
    workoutId: shown.entity.id,
  };
}

async function createAmbiguousSameNameWorkout(
  leftReps: readonly number[],
  rightReps: readonly number[],
): Promise<{
  vault: string;
  workout: WorkoutSession;
  workoutId: string;
}> {
  const vault = await mkdtemp(
    path.join(os.tmpdir(), "murph-member-action-ambiguous-"),
  );
  await initializeVault({
    vaultRoot: vault,
    createdAt: "2026-08-13T13:00:00.000Z",
    timezone: "UTC",
  });
  await startLiveWorkout({
    vault,
    name: "Workout",
    startedAt: STARTED_AT,
  });
  for (const [exerciseIndex, reps] of [leftReps, rightReps].entries()) {
    await addLiveWorkoutExercise({
      mode: "bodyweight",
      name: "Single-arm row",
      order: exerciseIndex + 1,
      setCount: reps.length,
      vault,
    });
    for (const [setIndex, value] of reps.entries()) {
      await logLiveWorkoutSet({
        vault,
        exerciseOrder: exerciseIndex + 1,
        reps: value,
        requireExistingSet: true,
        setOrder: setIndex + 1,
      });
    }
  }
  const shown = await showActiveLiveWorkout({ vault });
  return {
    vault,
    workout: parseShownWorkout(shown),
    workoutId: shown.entity.id,
  };
}

function removeSetsAction(input: {
  appendedReps?: readonly number[];
  removePositions: readonly number[];
  workout: WorkoutSession;
  workoutId: string;
}): WorkoutLiveApplyMemberActionV1 {
  const exercise = input.workout.exercises[0]!;
  const sets = exercise.sets
    .slice()
    .sort((left, right) => left.order - right.order);
  const expectedSets = sets.map((set) => ({
    logged: true,
    result: { kind: "reps" as const, reps: set.reps ?? null },
  }));
  const mutations: WorkoutLiveApplyMemberActionV1["mutations"] =
    input.removePositions.map((setPosition) => ({
      exerciseName: exercise.name,
      exercisePosition: 1,
      expectedSets,
      kind: "set.remove",
      setPosition,
    }));
  const retainedCount = sets.length - input.removePositions.length;
  for (const [index, reps] of (input.appendedReps ?? []).entries()) {
    mutations.push({
      exerciseName: exercise.name,
      exercisePosition: 1,
      kind: "set.append",
      result: { kind: "reps", reps },
      setPosition: retainedCount + index + 1,
    });
  }
  return {
    expectedWorkout: {
      actionBinding: deriveWorkoutActionBinding(input.workoutId, input.workout),
      exercises: [{
        name: exercise.name,
        sets: expectedSets.map(({ logged }) => ({ logged })),
      }],
      setRemovalBinding: deriveWorkoutSetRemovalBinding(
        input.workoutId,
        input.workout.exercises,
      ),
    },
    kind: "workout.live.apply",
    mutations,
    version: 1,
  };
}

function putFirstSetAction(input: {
  actionBinding: string;
  reps: number;
}): WorkoutLiveApplyMemberActionV1 {
  return {
    expectedWorkout: {
      actionBinding: input.actionBinding,
      exercises: [{
        name: "Push-up",
        sets: [{ logged: true }, { logged: true }],
      }],
    },
    kind: "workout.live.apply",
    mutations: [{
      exerciseName: "Push-up",
      exercisePosition: 1,
      expectedResult: { kind: "reps", reps: 10 },
      kind: "set.put",
      result: { kind: "reps", reps: input.reps },
      setPosition: 1,
    }],
    version: 1,
  };
}

function putSameNameExerciseAction(input: {
  actionBinding: string;
  exercisePosition: number;
  reps: number;
  setCount?: number;
}): WorkoutLiveApplyMemberActionV1 {
  return {
    expectedWorkout: {
      actionBinding: input.actionBinding,
      exercises: [1, 2].map(() => ({
        name: "Single-arm row",
        sets: Array.from(
          { length: input.setCount ?? 1 },
          () => ({ logged: true }),
        ),
      })),
    },
    kind: "workout.live.apply",
    mutations: [{
      exerciseName: "Single-arm row",
      exercisePosition: input.exercisePosition,
      expectedResult: { kind: "reps", reps: 8 },
      kind: "set.put",
      result: { kind: "reps", reps: input.reps },
      setPosition: 1,
    }],
    version: 1,
  };
}

async function expectStoredReps(vault: string, reps: readonly number[]) {
  const shown = await showActiveLiveWorkout({ vault });
  expect(parseShownWorkout(shown).exercises[0]?.sets).toEqual(
    reps.map((value, index) => ({ order: index + 1, reps: value })),
  );
}

test("a member action can remove a saved set through the real vault boundary", async () => {
  const fixture = await createLoggedWorkout([8, 10, 12]);
  try {
    const action = removeSetsAction({
      removePositions: [3],
      workout: fixture.workout,
      workoutId: fixture.workoutId,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });

    await expectStoredReps(fixture.vault, [8, 10]);
    const stored = await showActiveLiveWorkout({ vault: fixture.vault });
    expect(parseShownWorkout(stored).lastMemberActionId).toBe(ACTION_ID);
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "unchanged" });
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("an exact member-action retry survives workout completion", async () => {
  const fixture = await createLoggedWorkout([8, 10, 12]);
  try {
    const action = removeSetsAction({
      removePositions: [3],
      workout: fixture.workout,
      workoutId: fixture.workoutId,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });
    await finishLiveWorkout({
      endedAt: "2026-08-13T16:00:00.000Z",
      vault: fixture.vault,
      workoutId: fixture.workoutId,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "unchanged" });
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      actionId: "8676b264-9b91-4b50-8c73-184d7a63b901",
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "no_active_workout",
      status: "rejected",
    });

    await startLiveWorkout({
      name: "Later workout",
      startedAt: "2026-08-13T17:00:00.000Z",
      vault: fixture.vault,
    });
    const later = await showActiveLiveWorkout({ vault: fixture.vault });
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "unchanged" });
    const unchangedLater = await showActiveLiveWorkout({ vault: fixture.vault });
    expect(unchangedLater.entity.id).toBe(later.entity.id);
    const laterWorkout = parseShownWorkout(unchangedLater);
    expect(laterWorkout.exercises).toEqual([]);
    expect(laterWorkout.lastMemberActionId).toBeUndefined();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a stale card cannot retarget a set compacted by another member action", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([{
        ...fixture.workout.exercises[0],
        sets: [
          { order: 1, reps: 10, type: "warmup" },
          { order: 2, reps: 10, type: "normal" },
        ],
      }])}`],
      vault: fixture.vault,
    });
    const original = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    const originalBinding = deriveWorkoutActionBinding(
      fixture.workoutId,
      original,
    );

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeSetsAction({
        appendedReps: [20],
        removePositions: [1],
        workout: original,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: putFirstSetAction({
        actionBinding: originalBinding,
        reps: 12,
      }),
      actionId: SECOND_ACTION_ID,
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    let stored = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(stored.exercises[0]?.sets).toEqual([
      { order: 1, reps: 10, type: "normal" },
      { order: 2, reps: 20 },
    ]);
    expect(stored.lastMemberActionId).toBe(ACTION_ID);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: putFirstSetAction({
        actionBinding: deriveWorkoutActionBinding(
          fixture.workoutId,
          stored,
        ),
        reps: 12,
      }),
      actionId: SECOND_ACTION_ID,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });
    stored = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(stored.exercises[0]?.sets).toEqual([
      { order: 1, reps: 12, type: "normal" },
      { order: 2, reps: 20 },
    ]);
    expect(stored.lastMemberActionId).toBe(SECOND_ACTION_ID);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test.each([
  { label: "write the wrong exercise", rightReps: 8 },
  { label: "report false unchanged success", rightReps: 12 },
])("a stale card cannot $label after a generic same-name reorder", async ({ rightReps }) => {
  const fixture = await createSameNameWorkout(rightReps);
  try {
    const originalBinding = deriveWorkoutActionBinding(
      fixture.workoutId,
      fixture.workout,
    );
    const [left, right] = fixture.workout.exercises;
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([
        { ...right, order: 1 },
        { ...left, order: 2 },
      ])}`],
      vault: fixture.vault,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: putSameNameExerciseAction({
        actionBinding: originalBinding,
        exercisePosition: 1,
        reps: 12,
      }),
      actionId: SECOND_ACTION_ID,
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });

    const stored = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(stored.exercises.map((exercise) => ({
      groupId: exercise.groupId,
      reps: exercise.sets[0]?.reps,
    }))).toEqual([
      { groupId: "right", reps: rightReps },
      { groupId: "left", reps: 8 },
    ]);
    expect(stored.lastMemberActionId).toBeUndefined();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test.each([
  {
    label: "write a colliding set on the wrong exercise",
    leftReps: [8, 10],
    rightReps: [8, 12],
  },
  {
    label: "report false unchanged success for a colliding exercise",
    leftReps: [8, 10],
    rightReps: [12, 8],
  },
])("an ambiguous duplicate-exercise card cannot $label", async ({
  leftReps,
  rightReps,
}) => {
  const fixture = await createAmbiguousSameNameWorkout(leftReps, rightReps);
  try {
    const originalBinding = deriveWorkoutActionBinding(
      fixture.workoutId,
      fixture.workout,
    );
    const [left, right] = fixture.workout.exercises;
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([
        { ...right, order: 1 },
        { ...left, order: 2 },
      ])}`],
      vault: fixture.vault,
    });
    const reordered = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(deriveWorkoutActionBinding(
      fixture.workoutId,
      reordered,
    )).toBe(originalBinding);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: putSameNameExerciseAction({
        actionBinding: originalBinding,
        exercisePosition: 1,
        reps: 12,
        setCount: 2,
      }),
      actionId: SECOND_ACTION_ID,
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });

    const stored = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(stored.exercises.map((exercise) =>
      exercise.sets.map((set) => set.reps),
    )).toEqual([rightReps, leftReps]);
    expect(stored.lastMemberActionId).toBeUndefined();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a freshly rendered card edits the intended exercise after a generic reorder", async () => {
  const fixture = await createSameNameWorkout(8);
  try {
    const [left, right] = fixture.workout.exercises;
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([
        { ...right, order: 1 },
        { ...left, order: 2 },
      ])}`],
      vault: fixture.vault,
    });
    const reordered = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: putSameNameExerciseAction({
        actionBinding: deriveWorkoutActionBinding(
          fixture.workoutId,
          reordered,
        ),
        exercisePosition: 2,
        reps: 12,
      }),
      actionId: SECOND_ACTION_ID,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });

    const stored = parseShownWorkout(
      await showActiveLiveWorkout({ vault: fixture.vault }),
    );
    expect(stored.exercises.map((exercise) => ({
      groupId: exercise.groupId,
      reps: exercise.sets[0]?.reps,
    }))).toEqual([
      { groupId: "right", reps: 8 },
      { groupId: "left", reps: 12 },
    ]);
    expect(stored.lastMemberActionId).toBe(SECOND_ACTION_ID);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("set removal compacts a middle set through the real vault boundary", async () => {
  const fixture = await createLoggedWorkout([8, 10, 12]);
  try {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeSetsAction({
        removePositions: [2],
        workout: fixture.workout,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });
    await expectStoredReps(fixture.vault, [8, 12]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("multiple set removals apply in descending order through the real vault boundary", async () => {
  const fixture = await createLoggedWorkout([8, 10, 12, 14]);
  try {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeSetsAction({
        removePositions: [2, 4],
        workout: fixture.workout,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });
    await expectStoredReps(fixture.vault, [8, 12]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("set removal and append persist atomically through the real vault boundary", async () => {
  const fixture = await createLoggedWorkout([8, 10, 12]);
  try {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeSetsAction({
        appendedReps: [14],
        removePositions: [2],
        workout: fixture.workout,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });
    await expectStoredReps(fixture.vault, [8, 12, 14]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a member action cannot remove every set through the real vault boundary", async () => {
  const fixture = await createLoggedWorkout([8, 10]);
  try {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeSetsAction({
        removePositions: [1, 2],
        workout: fixture.workout,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    await expectStoredReps(fixture.vault, [8, 10]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("the generic workout editor still rejects an accidental saved-set deletion", async () => {
  const fixture = await createLoggedWorkout([8, 10]);
  try {
    await expect(editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([{
        ...fixture.workout.exercises[0],
        sets: [{ order: 1, reps: 8 }],
      }])}`],
      vault: fixture.vault,
    })).rejects.toThrow(/would remove saved set 2/iu);
    await expectStoredReps(fixture.vault, [8, 10]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});
