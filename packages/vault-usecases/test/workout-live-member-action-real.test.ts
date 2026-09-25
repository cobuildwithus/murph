import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWorkoutSessionAppCardEnvelopeV6,
  parseWorkoutSessionAppCardEnvelopeV4,
  type WorkoutLiveApplyMemberActionV1,
  type WorkoutLiveSnapshotMemberActionV1,
  type WorkoutSession,
} from "@murphai/contracts";
import { initializeVault } from "@murphai/core";
import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
} from "@murphai/operator-config/workout-action-binding";
import { projectVaultCliError } from "@murphai/operator-config/vault-cli-error-projection";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { expect, test } from "vitest";

import {
  addLiveWorkoutExercise,
  applyLiveWorkoutMemberAction as applyLiveWorkoutMemberActionWithId,
  finishLiveWorkout,
  hasLoggedWorkoutSet,
  logLiveWorkoutSet,
  readLiveWorkoutCardSnapshot,
  readLiveWorkoutCardEditor,
  setLiveWorkoutExerciseReps,
  startLiveWorkout,
} from "../src/usecases/workout-live.js";
import {
  parseShownWorkout,
  updateLiveWorkoutExercises,
} from "../src/usecases/workout-live-state.js";
import { showWorkoutRecord } from "../src/usecases/workout-read.js";
import { editWorkoutRecord } from "../src/usecases/workout.js";

const STARTED_AT = "2026-08-13T14:00:00.000Z";
const ACCEPTED_AT = "2026-08-13T15:00:00.000Z";
const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
const SECOND_ACTION_ID = "8676b264-9b91-4b50-8c73-184d7a63b901";

test("invalid stored workout state does not masquerade as submitted field guidance", () => {
  const privateStoredKey = "private-stored-workout-key";
  const privateStoredId = "private-stored-event-id";
  let caught: unknown;

  try {
    parseShownWorkout({
      entity: {
        data: { workout: { [privateStoredKey]: true } },
        id: privateStoredId,
      },
    } as never);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(VaultCliError);
  const projection = projectVaultCliError(caught);
  expect(projection.fieldErrors).toBeUndefined();
  expect(projection.stage).toBeUndefined();
  expect(JSON.stringify(projection)).not.toContain(privateStoredKey);
  expect(JSON.stringify(projection)).not.toContain(privateStoredId);
});

test("invalid post-mutation workout state remains field-neutral", async () => {
  const privateStoredKey = "private-post-mutation-key";
  const privateStoredId = "private-post-mutation-event-id";
  const workout: WorkoutSession = {
    sourceApp: "murph-live",
    startedAt: STARTED_AT,
    exercises: [{
      name: "Push-up",
      order: 1,
      sets: [{ order: 1, reps: 8 }],
    }],
  };
  const invalidExercises = [{
    ...workout.exercises[0]!,
    [privateStoredKey]: true,
  }];
  let caught: unknown;

  try {
    await updateLiveWorkoutExercises(
      {
        entity: { id: privateStoredId },
      } as never,
      workout,
      invalidExercises,
      { observedAt: ACCEPTED_AT },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(VaultCliError);
  const projection = projectVaultCliError(caught);
  expect(projection.fieldErrors).toBeUndefined();
  expect(projection.stage).toBeUndefined();
  expect(JSON.stringify(projection)).not.toContain(privateStoredKey);
  expect(JSON.stringify(projection)).not.toContain(privateStoredId);
});

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
  const started = await startLiveWorkout({
    vault,
    name: "Workout",
    startedAt: STARTED_AT,
  });
  await addLiveWorkoutExercise({
    vault,
    workoutId: started.eventId,
    mode: "bodyweight",
    name: "Push-up",
    order: 1,
  });
  for (const [index, value] of reps.entries()) {
    await logLiveWorkoutSet({
      vault,
      workoutId: started.eventId,
      exerciseOrder: 1,
      reps: value,
      requireExistingSet: index === 0,
      setOrder: index + 1,
    });
  }
  const shown = await showWorkoutRecord(vault, started.eventId);
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
  const started = await startLiveWorkout({
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
      vault,
      workoutId: started.eventId,
    });
    await logLiveWorkoutSet({
      vault,
      workoutId: started.eventId,
      exerciseOrder: index + 1,
      reps: index === 0 ? 8 : rightReps,
      requireExistingSet: true,
      setOrder: 1,
    });
  }
  const shown = await showWorkoutRecord(vault, started.eventId);
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
  const started = await startLiveWorkout({
    vault,
    name: "Workout",
    startedAt: STARTED_AT,
  });
  for (const [exerciseIndex, reps] of [leftReps, rightReps].entries()) {
    await addLiveWorkoutExercise({
      mode: "bodyweight",
      name: "Single-arm row",
      order: exerciseIndex + 1,
      vault,
      workoutId: started.eventId,
    });
    for (const [setIndex, value] of reps.entries()) {
      await logLiveWorkoutSet({
        vault,
        workoutId: started.eventId,
        exerciseOrder: exerciseIndex + 1,
        reps: value,
        requireExistingSet: setIndex === 0,
        setOrder: setIndex + 1,
      });
    }
  }
  const shown = await showWorkoutRecord(vault, started.eventId);
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

function preferenceOnlyAction(input: {
  workout: WorkoutSession;
  workoutId: string;
}): WorkoutLiveApplyMemberActionV1 {
  return {
    expectedWorkout: {
      actionBinding: deriveWorkoutActionBinding(input.workoutId, input.workout),
      exercises: input.workout.exercises
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((exercise) => ({
          name: exercise.name,
          sets: exercise.sets
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((set) => ({ logged: hasLoggedWorkoutSet(set) })),
        })),
    },
    kind: "workout.live.apply",
    mutations: [],
    version: 1,
    weightUnitPreference: "kg",
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

function snapshotAction(input: {
  workout: WorkoutSession;
  workoutId: string;
}): WorkoutLiveSnapshotMemberActionV1 {
  return {
    kind: "workout.live.snapshot",
    presentation: {
      footer: null,
      subtitle: null,
      title: "Workout",
      workout: {
        exercises: input.workout.exercises
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((exercise) => ({
            name: exercise.name,
            sets: exercise.sets
              .slice()
              .sort((left, right) => left.order - right.order)
              .map((set) => ({
                actual: typeof set.reps === "number"
                  ? `${set.reps} reps`
                  : "Logged",
                status: "completed" as const,
                target: null,
              })),
          })),
        state: "active",
        version: 1,
      },
    },
    version: 1,
    workoutBinding: deriveWorkoutActionBinding(
      input.workoutId,
      input.workout,
    ),
  };
}

async function expectStoredReps(
  vault: string,
  workoutId: string,
  reps: readonly number[],
) {
  const shown = await showWorkoutRecord(vault, workoutId);
  expect(parseShownWorkout(shown).exercises[0]?.sets).toEqual(
    reps.map((value, index) => ({ order: index + 1, reps: value })),
  );
}

test("a preference-only action stores its replay marker without advancing duration", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: ["durationMinutes=17"],
      vault: fixture.vault,
    });
    const current = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );
    const action = preferenceOnlyAction({
      workout: current,
      workoutId: fixture.workoutId,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "unchanged" });

    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(stored.entity.data.durationMinutes).toBe(17);
    expect(parseShownWorkout(stored).lastMemberActionId).toBe(ACTION_ID);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a stale preference-only action preserves duration and writes no marker", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    const action = preferenceOnlyAction(fixture);
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [
        "durationMinutes=17",
        `workout.exercises=${JSON.stringify([{
          ...fixture.workout.exercises[0],
          sets: [
            { order: 1, reps: 10 },
            { order: 2, reps: 10 },
            { order: 3, reps: 12 },
          ],
        }])}`,
      ],
      vault: fixture.vault,
    });

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });

    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(stored.entity.data.durationMinutes).toBe(17);
    expect(parseShownWorkout(stored).lastMemberActionId).toBeUndefined();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("an ambiguous preference-only action preserves duration and writes no marker", async () => {
  const fixture = await createAmbiguousSameNameWorkout([8], [8]);
  try {
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: ["durationMinutes=17"],
      vault: fixture.vault,
    });
    const current = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: preferenceOnlyAction({
        workout: current,
        workoutId: fixture.workoutId,
      }),
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });

    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(stored.entity.data.durationMinutes).toBe(17);
    expect(parseShownWorkout(stored).lastMemberActionId).toBeUndefined();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a closed preference-only action preserves the completed duration", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    const action = preferenceOnlyAction(fixture);
    await finishLiveWorkout({
      endedAt: "2026-08-13T16:00:00.000Z",
      vault: fixture.vault,
      workoutId: fixture.workoutId,
    });
    const completed = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    const durationMinutes = completed.entity.data.durationMinutes;

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({
      status: "unchanged",
    });

    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(stored.entity.data.durationMinutes).toBe(durationMinutes);
    expect(parseShownWorkout(stored).lastMemberActionId).toBe(ACTION_ID);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a mixed set and preference action advances duration with the set change", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: ["durationMinutes=17"],
      vault: fixture.vault,
    });
    const current = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );
    const action = {
      ...putFirstSetAction({
        actionBinding: deriveWorkoutActionBinding(fixture.workoutId, current),
        reps: 12,
      }),
      weightUnitPreference: "kg" as const,
    };

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "applied" });

    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(stored.entity.data.durationMinutes).toBe(60);
    expect(parseShownWorkout(stored)).toMatchObject({
      lastMemberActionId: ACTION_ID,
      exercises: [{ sets: [{ reps: 12 }, { reps: 10 }] }],
    });
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("the final native set write closes one finite workout at its accepted boundary", async () => {
  const vault = await mkdtemp(
    path.join(os.tmpdir(), "murph-member-action-final-set-"),
  );
  try {
    await initializeVault({
      vaultRoot: vault,
      createdAt: "2026-08-13T13:00:00.000Z",
      timezone: "UTC",
    });
    const started = await startLiveWorkout({
      name: "Finite workout",
      startedAt: STARTED_AT,
      vault,
    });
    await addLiveWorkoutExercise({
      mode: "bodyweight",
      name: "Push-up",
      order: 1,
      setCount: 1,
      vault,
      workoutId: started.eventId,
    });
    const before = parseShownWorkout(
      await showWorkoutRecord(vault, started.eventId),
    );
    expect(before.endedAt).toBeUndefined();

    const action: WorkoutLiveApplyMemberActionV1 = {
      expectedWorkout: {
        actionBinding: deriveWorkoutActionBinding(started.eventId, before),
        exercises: [{ name: "Push-up", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply",
      mutations: [{
        exerciseName: "Push-up",
        exercisePosition: 1,
        expectedResult: null,
        kind: "set.put",
        result: { kind: "reps", reps: 12 },
        setPosition: 1,
      }],
      version: 1,
    };

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault,
    })).resolves.toEqual({ status: "applied" });

    const storedRecord = await showWorkoutRecord(vault, started.eventId);
    const stored = parseShownWorkout(storedRecord);
    expect(stored.exercises[0]?.sets).toEqual([{ order: 1, reps: 12 }]);
    expect(stored.endedAt).toBe(ACCEPTED_AT);
    expect(stored.lastMemberActionId).toBe(ACTION_ID);
    expect(storedRecord.entity.data.durationMinutes).toBe(60);
  } finally {
    await rm(vault, { force: true, recursive: true });
  }
});

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

    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 10]);
    const stored = await showWorkoutRecord(fixture.vault, fixture.workoutId);
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
      reason: "workout_changed",
      status: "rejected",
    });

    const laterStarted = await startLiveWorkout({
      name: "Later workout",
      startedAt: "2026-08-13T17:00:00.000Z",
      vault: fixture.vault,
    });
    const later = await showWorkoutRecord(fixture.vault, laterStarted.eventId);
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    })).resolves.toEqual({ status: "unchanged" });
    const unchangedLater = await showWorkoutRecord(
      fixture.vault,
      laterStarted.eventId,
    );
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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

test("a stale snapshot cannot re-arm a card after a hidden same-name reorder", async () => {
  const fixture = await createSameNameWorkout(12);
  try {
    const action = snapshotAction(fixture);
    const [left, right] = fixture.workout.exercises;
    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([
        { ...right, order: 1 },
        { ...left, order: 2 },
      ])}`],
      vault: fixture.vault,
    });

    await expect(readLiveWorkoutCardSnapshot({
      action,
      vault: fixture.vault,
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test.each(["absent", "unavailable"])("workout refresh, save, and replay leave an %s shared query projection untouched", async (projectionState) => {
  const fixture = await createLoggedWorkout([10, 10]);
  const projectionPath = path.join(fixture.vault, ".runtime/projections/query.sqlite");
  try {
    if (projectionState === "unavailable") {
      await mkdir(projectionPath, { recursive: true });
    }
    const expectProjectionUntouched = async () => {
      if (projectionState === "unavailable") {
        expect((await stat(projectionPath)).isDirectory()).toBe(true);
      } else {
        await expect(stat(projectionPath)).rejects.toMatchObject({ code: "ENOENT" });
      }
    };
    await expectProjectionUntouched();
    const snapshot = snapshotAction(fixture);
    await expect(readLiveWorkoutCardSnapshot({
      action: snapshot,
      vault: fixture.vault,
    })).resolves.toMatchObject({ status: "unchanged" });
    await expectProjectionUntouched();

    const request = {
      acceptedAt: ACCEPTED_AT,
      action: putFirstSetAction({ actionBinding: snapshot.workoutBinding, reps: 12 }),
      vault: fixture.vault,
    };
    await expect(applyLiveWorkoutMemberAction(request)).resolves.toEqual({ status: "applied" });
    await expectStoredReps(fixture.vault, fixture.workoutId, [12, 10]);
    await expectProjectionUntouched();
    await expect(applyLiveWorkoutMemberAction(request)).resolves.toEqual({ status: "unchanged" });
    await expectProjectionUntouched();
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a direct result save returns its canonical card without a second action", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    const snapshot = snapshotAction(fixture);
    const action = {
      ...putFirstSetAction({
        actionBinding: snapshot.workoutBinding,
        reps: 12,
      }),
      presentation: snapshot.presentation,
    };
    const applied = await applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied" || applied.result === undefined) {
      throw new TypeError("Expected the direct-save card result.");
    }
    const envelope = applied.result.card;
    expect(envelope).toMatchObject({ schemaVersion: 6 });
    expect(
      parseWorkoutSessionAppCardEnvelopeV4(envelope)
        ?.workout.exercises[0]?.sets[0]?.actual,
    ).toBe("12 reps");

    const replayed = await applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: fixture.vault,
    });
    expect(replayed).toEqual({
      result: applied.result,
      status: "unchanged",
    });
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("a generic edit refuses an ambiguous duplicate-exercise reorder", async () => {
  const fixture = await createAmbiguousSameNameWorkout([8, 10], [8, 12]);
  try {
    const [left, right] = fixture.workout.exercises;
    await expect(editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([
        { ...right, order: 1 },
        { ...left, order: 2 },
      ])}`],
      vault: fixture.vault,
    })).rejects.toThrow(/would remove saved exercise 1 \(Single-arm row\)/iu);

    const stored = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );
    expect(stored.exercises).toEqual(fixture.workout.exercises);
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
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
    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 12]);
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
    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 12]);
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
    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 12, 14]);
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
    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 10]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test.each([12, null])("generic structural edits retain exercise-owned repetition rules (%s)", async (memberRepsPerSet) => {
  const fixture = await createLoggedWorkout([8, 10]);
  try {
    await setLiveWorkoutExerciseReps({
      exerciseOrder: 1,
      ...(memberRepsPerSet === null ? { clear: true } : { reps: memberRepsPerSet }),
      vault: fixture.vault,
      workoutId: fixture.workoutId,
    });
    const before = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );
    const exercise = before.exercises[0]!;
    expect(exercise.memberRepsPerSet).toBe(memberRepsPerSet);

    await editWorkoutRecord({
      lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify([{
        name: exercise.name,
        note: "Member-requested label cleanup.",
        order: exercise.order,
        sets: exercise.sets,
      }])}`],
      vault: fixture.vault,
    });

    const after = parseShownWorkout(
      await showWorkoutRecord(fixture.vault, fixture.workoutId),
    );
    expect(after.exercises[0]).toMatchObject({
      memberRepsPerSet,
      note: "Member-requested label cleanup.",
      setPlanIsFinite: false,
    });
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("generic structural edits preserve facts only across stable exercise identity", async () => {
  const vault = await mkdtemp(
    path.join(os.tmpdir(), "murph-exercise-identity-real-"),
  );
  try {
    await initializeVault({
      vaultRoot: vault,
      createdAt: "2026-08-13T13:00:00.000Z",
      timezone: "UTC",
    });
    const started = await startLiveWorkout({
      name: "Exercise identity",
      startedAt: STARTED_AT,
      vault,
    });
    await addLiveWorkoutExercise({
      name: "Bench press",
      order: 1,
      setCount: 2,
      sourceExerciseId: "exercise_bench",
      vault,
      workoutId: started.eventId,
    });
    await setLiveWorkoutExerciseReps({
      exerciseOrder: 1,
      reps: 8,
      vault,
      workoutId: started.eventId,
    });
    await addLiveWorkoutExercise({
      name: "Push-up",
      order: 2,
      sourceExerciseId: "exercise_push_up",
      vault,
      workoutId: started.eventId,
    });

    const before = parseShownWorkout(
      await showWorkoutRecord(vault, started.eventId),
    );
    const bench = before.exercises[0]!;
    const pushUp = before.exercises[1]!;
    await editWorkoutRecord({
      lookup: started.eventId,
      set: [`workout.exercises=${JSON.stringify([
        {
          name: pushUp.name,
          order: 1,
          sets: pushUp.sets,
          sourceExerciseId: pushUp.sourceExerciseId,
        },
        {
          name: "Barbell bench press",
          order: 2,
          sets: bench.sets,
          sourceExerciseId: bench.sourceExerciseId,
        },
      ])}`],
      vault,
    });

    const reordered = parseShownWorkout(
      await showWorkoutRecord(vault, started.eventId),
    );
    expect(reordered.exercises).toMatchObject([
      {
        name: "Push-up",
        order: 1,
        setPlanIsFinite: false,
        sourceExerciseId: "exercise_push_up",
      },
      {
        memberRepsPerSet: 8,
        name: "Barbell bench press",
        order: 2,
        setPlanIsFinite: true,
        sourceExerciseId: "exercise_bench",
      },
    ]);

    await expect(editWorkoutRecord({
      lookup: started.eventId,
      set: [`workout.exercises=${JSON.stringify([
        reordered.exercises[0],
        {
          name: "Squat",
          order: 2,
          sets: reordered.exercises[1]?.sets,
          sourceExerciseId: "exercise_squat",
        },
      ])}`],
      vault,
    })).rejects.toThrow(/would remove saved exercise 2 \(Barbell bench press\)/iu);

    expect(parseShownWorkout(
      await showWorkoutRecord(vault, started.eventId),
    ).exercises).toEqual(reordered.exercises);
  } finally {
    await rm(vault, { force: true, recursive: true });
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
    await expectStoredReps(fixture.vault, fixture.workoutId, [8, 10]);
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});


test("completed workout cards remain editable and corrections preserve their end boundary", async () => {
  const fixture = await createLoggedWorkout([10, 10]);
  try {
    await finishLiveWorkout({ vault: fixture.vault, workoutId: fixture.workoutId, endedAt: ACCEPTED_AT });
    const before = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    const workout = parseShownWorkout(before);
    const snapshot = snapshotAction({ workout, workoutId: fixture.workoutId });
    snapshot.presentation.workout.state = "completed";
    const editor = await readLiveWorkoutCardEditor({
      vault: fixture.vault, workoutId: fixture.workoutId, presentation: snapshot.presentation.workout,
    });
    expect(editor?.editor.actionBinding).toMatch(/^[a-f0-9]{64}$/u);
    const action = {
      ...putFirstSetAction({ actionBinding: snapshot.workoutBinding, reps: 12 }),
      presentation: snapshot.presentation,
    };
    const request = { action, acceptedAt: "2026-08-14T15:00:00.000Z", vault: fixture.vault };
    const result = await applyLiveWorkoutMemberAction(request);
    expect(result.status).toBe("applied");
    if (result.status !== "applied" || !result.result) throw new Error("Expected an editable save result.");
    const envelope = result.result.card;
    expect(envelope).toMatchObject({ schemaVersion: 6, card: { s: "c", b: expect.stringMatching(/^[a-f0-9]{64}$/u) } });
    const after = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    expect(parseShownWorkout(after).endedAt).toBe(workout.endedAt);
    expect(after.entity.data.durationMinutes).toBe(before.entity.data.durationMinutes);
    expect(parseShownWorkout(after).exercises[0]?.sets[0]?.reps).toBe(12);
    expect((await applyLiveWorkoutMemberAction(request)).status).toBe("unchanged");
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});

test("completed corrections survive crossing the message URL limit and allow another save", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "murph-completed-card-size-"));
  await initializeVault({ vaultRoot: vault, createdAt: STARTED_AT, timezone: "UTC" });
  const started = await startLiveWorkout({ vault, name: "Workout", startedAt: STARTED_AT });
  const fixture = { vault, workoutId: started.eventId };
  try {
    const exercises = Array.from({ length: 8 }, (_, exerciseIndex) => ({
      name: `Exercise ${exerciseIndex + 1}`,
      order: exerciseIndex + 1,
      mode: "weight_reps" as const,
      unitOverride: "lb" as const,
      sets: Array.from({ length: 8 }, (_, setIndex) => ({
        order: setIndex + 1,
        ...(exerciseIndex === 0 && setIndex < 7 ? { reps: 12, weight: 135, weightUnit: "lb" as const } : {}),
      })),
    }));
    await editWorkoutRecord({ vault: fixture.vault, lookup: fixture.workoutId,
      set: [`workout.exercises=${JSON.stringify(exercises)}`] });
    await finishLiveWorkout({ vault: fixture.vault, workoutId: fixture.workoutId, endedAt: ACCEPTED_AT });
    const before = await showWorkoutRecord(fixture.vault, fixture.workoutId);
    let workout = parseShownWorkout(before);
    const presentation = snapshotAction({ workout, workoutId: fixture.workoutId }).presentation;
    presentation.workout.state = "completed";
    presentation.workout.exercises = exercises.map((exercise, exerciseIndex) => ({
      name: exercise.name,
      sets: exercise.sets.map((_, setIndex) => ({ target: null,
        status: exerciseIndex === 0 && setIndex < 7 ? "completed" : "skipped",
        actual: exerciseIndex === 0 && setIndex < 7 ? "135 lb × 12" : null,
      })),
    }));
    const editor = await readLiveWorkoutCardEditor({ vault: fixture.vault,
      workoutId: fixture.workoutId, presentation: presentation.workout });
    if (!editor) throw new Error("Expected completed editor.");
    const initial = buildWorkoutSessionAppCardEnvelopeV6({ ...presentation, editor: editor.editor });
    const urlLength = (card: unknown) => "https://www.withmurph.ai/#murph-card=".length
      + Buffer.from(JSON.stringify(card)).toString("base64url").length;
    expect(urlLength(initial)).toBeLessThan(2_048);
    let binding = editor.editor.actionBinding;
    for (const [index, reps] of [12, 15].entries()) {
      const action: WorkoutLiveApplyMemberActionV1 = {
        ...preferenceOnlyAction({ workout, workoutId: fixture.workoutId }),
        presentation,
        mutations: [{ kind: "set.put", exerciseName: "Exercise 1", exercisePosition: 1, setPosition: 8,
          expectedResult: index === 0 ? null : { kind: "weight_reps", reps: 12, weight: 135, weightUnit: "lb" },
          result: { kind: "weight_reps", reps, weight: 135, weightUnit: "lb" } }],
      };
      action.expectedWorkout.actionBinding = binding;
      const result = await applyLiveWorkoutMemberAction({ vault: fixture.vault, action,
        acceptedAt: "2026-08-14T15:00:00.000Z", actionId: index === 0 ? ACTION_ID : SECOND_ACTION_ID });
      if (result.status !== "applied" || !result.result?.card) throw new Error("Expected editable correction result.");
      expect(urlLength(result.result.card)).toBeGreaterThanOrEqual(2_048);
      expect(result.result.card.card.s).toBe("c");
      binding = result.result.card.card.b;
      const current = await showWorkoutRecord(fixture.vault, fixture.workoutId);
      workout = parseShownWorkout(current);
      expect(workout.exercises[0]?.sets[7]?.reps).toBe(reps);
      expect(workout.endedAt).toBe(ACCEPTED_AT);
      expect(current.entity.data.durationMinutes).toBe(before.entity.data.durationMinutes);
    }
  } finally {
    await rm(fixture.vault, { force: true, recursive: true });
  }
});
