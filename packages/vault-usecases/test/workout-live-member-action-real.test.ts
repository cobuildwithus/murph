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
  logLiveWorkoutSet,
  showActiveLiveWorkout,
  startLiveWorkout,
} from "../src/usecases/workout-live.js";
import { parseShownWorkout } from "../src/usecases/workout-live-state.js";
import { editWorkoutRecord } from "../src/usecases/workout.js";

const STARTED_AT = "2026-08-13T14:00:00.000Z";
const ACCEPTED_AT = "2026-08-13T15:00:00.000Z";
const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";

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
      actionBinding: deriveWorkoutActionBinding(input.workoutId),
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
