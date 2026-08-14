import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkoutMemberActionExpectedSetResultV1,
  WorkoutMemberActionExpectedSetStateV1,
  WorkoutMemberActionSetResultV1,
  WorkoutSession,
  WorkoutSet,
} from "@murphai/contracts";
import {
  deriveWorkoutActionBinding,
  deriveWorkoutSetRemovalBinding,
} from "@murphai/operator-config/workout-action-binding";

const mocks = vi.hoisted(() => ({
  findActiveLiveWorkouts: vi.fn(),
  updateLiveWorkoutExercises: vi.fn(),
  withLiveWorkoutMutationLock: vi.fn(),
}));

vi.mock("../src/usecases/workout-live-state.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/usecases/workout-live-state.js")>(),
  findActiveLiveWorkouts: mocks.findActiveLiveWorkouts,
  updateLiveWorkoutExercises: mocks.updateLiveWorkoutExercises,
  updateLiveWorkoutExercisesAfterValidatedSetRemoval:
    mocks.updateLiveWorkoutExercises,
  withLiveWorkoutMutationLock: mocks.withLiveWorkoutMutationLock,
}));

import {
  applyLiveWorkoutMemberAction as applyLiveWorkoutMemberActionWithId,
} from "../src/usecases/workout-live.ts";

const BASE_WORKOUT: WorkoutSession = {
  exercises: [{
    mode: "weight_reps" as const,
    name: "Leg press",
    order: 1,
    sets: [{ order: 1 }],
    unitOverride: "lb" as const,
  }],
  sourceApp: "murph-live" as const,
  startedAt: "2026-08-12T14:00:00.000Z",
};
const ACCEPTED_AT = "2026-08-12T15:00:00.000Z";
const ACTION_BINDING = deriveWorkoutActionBinding("evt_test_workout");
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

function shownWorkout(
  workout: WorkoutSession = BASE_WORKOUT,
  id = "evt_test_workout",
) {
  return {
    entity: {
      data: { workout },
      id,
    },
    vault: "/vault",
  };
}

function setAction(
  result: WorkoutMemberActionSetResultV1,
  input: {
    expectedResult?: WorkoutMemberActionExpectedSetResultV1 | null;
    logged?: boolean;
  } = {},
) {
  return {
    expectedWorkout: {
      actionBinding: ACTION_BINDING,
      exercises: [{
        name: "Leg press",
        sets: [{ logged: input.logged ?? false }],
      }],
    },
    kind: "workout.live.apply" as const,
    mutations: [{
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedResult: input.expectedResult ?? null,
      kind: "set.put" as const,
      result,
      setPosition: 1,
    }],
    version: 1 as const,
  };
}

function appendAction(setCount = 1) {
  return {
    expectedWorkout: {
      actionBinding: ACTION_BINDING,
      exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
    },
    kind: "workout.live.apply" as const,
    mutations: [
      {
        exercisePosition: 2,
        kind: "exercise.append" as const,
        mode: "bodyweight" as const,
        name: "Push-up",
        setCount,
        unitOverride: null,
      },
      {
        exerciseName: "Push-up",
        exercisePosition: 2,
        expectedResult: null,
        kind: "set.put" as const,
        result: { kind: "reps" as const, reps: 12 },
        setPosition: 1,
      },
    ],
    version: 1 as const,
  };
}

function removeAction(input: {
  expectedSets?: WorkoutMemberActionExpectedSetStateV1[];
  setRemovalBinding?: string;
  setPosition?: number;
} = {}) {
  const expectedSets = input.expectedSets ?? [
    { logged: false, result: null },
    { logged: true, result: { kind: "reps" as const, reps: 8 } },
  ];
  return {
    expectedWorkout: {
      actionBinding: ACTION_BINDING,
      exercises: [{
        name: "Leg press",
        sets: expectedSets.map(({ logged }) => ({ logged })),
      }],
      setRemovalBinding: input.setRemovalBinding
        ?? deriveWorkoutSetRemovalBinding("evt_test_workout", [{
          ...BASE_WORKOUT.exercises[0],
          sets: expectedSets.map((set, index) => ({
            order: index + 1,
            ...(set.result?.kind === "note" && set.result.note !== null
              ? { note: set.result.note }
              : {}),
            ...(set.result?.kind === "reps" && set.result.reps !== null
              ? { reps: set.result.reps }
              : {}),
            ...(set.result?.kind === "weight_reps"
              ? {
                  ...(set.result.reps !== null ? { reps: set.result.reps } : {}),
                  ...(set.result.weight !== null
                    ? { weight: set.result.weight }
                    : {}),
                  ...(set.result.weightUnit !== null
                    ? { weightUnit: set.result.weightUnit }
                    : {}),
                }
              : {}),
          })),
        }]),
    },
    kind: "workout.live.apply" as const,
    mutations: [{
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedSets,
      kind: "set.remove" as const,
      setPosition: input.setPosition ?? 2,
    }],
    version: 1 as const,
  };
}

describe("live workout member action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withLiveWorkoutMutationLock.mockImplementation(
      async (_vault: string, run: () => Promise<unknown>) => await run(),
    );
    mocks.findActiveLiveWorkouts.mockResolvedValue([shownWorkout()]);
    mocks.updateLiveWorkoutExercises.mockResolvedValue(shownWorkout());
  });

  it("applies a bounded batch with one lock and one canonical write", async () => {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });

    expect(mocks.withLiveWorkoutMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.updateLiveWorkoutExercises).toHaveBeenCalledTimes(1);
    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{ order: 1, reps: 8 }],
    }]);
  });

  it("fails closed when the active workout no longer matches the expected shape", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        name: "Back squat",
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("does not retarget an old card to a later same-shaped workout", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([
      shownWorkout(BASE_WORKOUT, "evt_later_workout"),
    ]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("uses the persisted action id for exact retry before stale-shape checks", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 8 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("removes a set and compacts canonical set order", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1 }, { order: 2, reps: 8 }, { order: 3 }],
      }],
    })]);

    const action = removeAction({
      expectedSets: [
        { logged: false, result: null },
        { logged: true, result: { kind: "reps", reps: 8 } },
        { logged: false, result: null },
      ],
    });
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        ...action,
        expectedWorkout: {
          ...action.expectedWorkout,
          exercises: [{
            name: "Leg press",
            sets: [{ logged: false }, { logged: true }, { logged: false }],
          }],
        },
      },
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });
    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{ order: 1 }, { order: 2 }],
    }]);
  });

  it("treats an exact set-removal replay as unchanged", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeAction(),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("rejects a destructive projection collision before exact-replay detection", async () => {
    const workout: WorkoutSession = {
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [
          { order: 1, reps: 10, type: "warmup" },
          { order: 2, reps: 10 },
          { order: 3, reps: 10 },
        ],
      }],
    };
    const expectedSets = workout.exercises[0].sets.map(() => ({
      logged: true,
      result: { kind: "reps" as const, reps: 10 },
    }));

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        expectedWorkout: {
          actionBinding: ACTION_BINDING,
          exercises: [{
            name: "Leg press",
            sets: expectedSets.map(({ logged }) => ({ logged })),
          }],
          setRemovalBinding: deriveWorkoutSetRemovalBinding(
            "evt_test_workout",
            workout.exercises,
          ),
        },
        kind: "workout.live.apply",
        mutations: [
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedSets,
            kind: "set.remove",
            setPosition: 1,
          },
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            kind: "set.append",
            result: { kind: "reps", reps: 10 },
            setPosition: 3,
          },
        ],
        version: 1,
      },
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.withLiveWorkoutMutationLock).not.toHaveBeenCalled();
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("rejects a stale destructive action when current values mimic its final projection", async () => {
    const originalWorkout: WorkoutSession = {
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [
          { order: 1, reps: 10, type: "warmup" },
          { order: 2, reps: 20 },
        ],
      }],
    };
    const expectedSets = [
      { logged: true, result: { kind: "reps" as const, reps: 10 } },
      { logged: true, result: { kind: "reps" as const, reps: 20 } },
    ];
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...originalWorkout,
      lastMemberActionId: "8676b264-9b91-4b50-8c73-184d7a63b901",
      exercises: [{
        ...originalWorkout.exercises[0],
        sets: [
          { order: 1, reps: 20, type: "warmup" },
          { order: 2, reps: 30 },
        ],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        expectedWorkout: {
          actionBinding: ACTION_BINDING,
          exercises: [{
            name: "Leg press",
            sets: expectedSets.map(({ logged }) => ({ logged })),
          }],
          setRemovalBinding: deriveWorkoutSetRemovalBinding(
            "evt_test_workout",
            originalWorkout.exercises,
          ),
        },
        kind: "workout.live.apply",
        mutations: [
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedSets,
            kind: "set.remove",
            setPosition: 1,
          },
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            kind: "set.append",
            result: { kind: "reps", reps: 30 },
            setPosition: 2,
          },
        ],
        version: 1,
      },
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("applies and exactly replays descending removals plus appended sets", async () => {
    const expectedSets = [
      { logged: false, result: null },
      { logged: true, result: { kind: "reps" as const, reps: 8 } },
      { logged: false, result: null },
      { logged: true, result: { kind: "reps" as const, reps: 10 } },
    ];
    const initialWorkout: WorkoutSession = {
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [
          { order: 1 },
          { order: 2, reps: 8 },
          { order: 3 },
          { order: 4, reps: 10 },
        ],
      }],
    };
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([
      shownWorkout(initialWorkout),
    ]);

    const firstRemoval = removeAction({ expectedSets, setPosition: 2 });
    const action = {
      ...firstRemoval,
      mutations: [
        ...firstRemoval.mutations,
        { ...firstRemoval.mutations[0], setPosition: 4 },
        {
          exerciseName: "Leg press",
          exercisePosition: 1,
          kind: "set.append" as const,
          result: { kind: "reps" as const, reps: 12 },
          setPosition: 3,
        },
        {
          exerciseName: "Leg press",
          exercisePosition: 1,
          kind: "set.append" as const,
          result: null,
          setPosition: 4,
        },
      ],
    };

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });
    const finalExercises = [{
      ...BASE_WORKOUT.exercises[0],
      sets: [
        { order: 1 },
        { order: 2 },
        { order: 3, reps: 12 },
        { order: 4 },
      ],
    }];
    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual(
      finalExercises,
    );

    mocks.updateLiveWorkoutExercises.mockClear();
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: finalExercises,
    })]);
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("edits retained original positions before compacting removed sets", async () => {
    const expectedSets = [
      { logged: false, result: null },
      { logged: true, result: { kind: "reps" as const, reps: 8 } },
      { logged: false, result: null },
    ];
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1 }, { order: 2, reps: 8 }, { order: 3 }],
      }],
    })]);

    const action = removeAction({ expectedSets, setPosition: 1 });
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        ...action,
        mutations: [
          ...action.mutations,
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedResult: { kind: "reps" as const, reps: 8 },
            kind: "set.put" as const,
            result: { kind: "reps" as const, reps: 10 },
            setPosition: 2,
          },
        ],
      },
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });
    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{ order: 1, reps: 10 }, { order: 2 }],
    }]);

    mocks.updateLiveWorkoutExercises.mockClear();
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 10 }, { order: 2 }],
      }],
    })]);
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        ...action,
        mutations: [
          ...action.mutations,
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedResult: { kind: "reps" as const, reps: 8 },
            kind: "set.put" as const,
            result: { kind: "reps" as const, reps: 10 },
            setPosition: 2,
          },
        ],
      },
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("rejects a stale set removal and keeps at least one set", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1 }, { order: 2, reps: 10 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: removeAction(),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();

    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1 }, { order: 2 }],
      }],
    })]);
    const lastSetAction = removeAction({
      expectedSets: [
        { logged: false, result: null },
        { logged: false, result: null },
      ],
      setPosition: 1,
    });
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: {
        ...lastSetAction,
        expectedWorkout: {
          ...lastSetAction.expectedWorkout,
          exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
        },
      },
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
  });

  it("fails closed when the targeted set changed after the visible snapshot", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 7 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it.each([
    ["type", { type: "warmup" as const }],
    ["note", { note: "Pause at the bottom" }],
    ["duration", { durationSeconds: 45 }],
    ["distance", { distanceMeters: 100 }],
    ["RPE", { rpe: 8 }],
    ["bodyweight", { bodyweightKg: 82 }],
    ["assistance", { assistanceKg: 20 }],
    ["added load", { addedWeightKg: 10 }],
    ["mixed fields", { note: "Controlled", rpe: 7 }],
  ] satisfies Array<[string, Partial<WorkoutSet>]>)(
    "rejects removal after a concurrent %s change outside its visible family",
    async (_label, concurrentPatch) => {
      mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
        ...BASE_WORKOUT,
        exercises: [{
          ...BASE_WORKOUT.exercises[0],
          sets: [
            { order: 1 },
            { order: 2, reps: 8, ...concurrentPatch },
          ],
        }],
      })]);

      await expect(applyLiveWorkoutMemberAction({
        acceptedAt: ACCEPTED_AT,
        action: removeAction(),
        vault: "/vault",
      })).resolves.toEqual({
        reason: "workout_changed",
        status: "rejected",
      });
      expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
    },
  );

  it("updates weight and reps while preserving unrelated set annotations", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{
          note: "Final rep spotted",
          order: 1,
          reps: 8,
          rpe: 9,
          weight: 185,
          weightUnit: "lb",
        }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 190, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: 185,
            weightUnit: "lb",
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });

    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{
        note: "Final rep spotted",
        order: 1,
        reps: 8,
        rpe: 9,
        weight: 190,
        weightUnit: "lb",
      }],
    }]);
  });

  it("updates a note while preserving unrelated load and effort fields", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{
          note: "Final rep spotted",
          order: 1,
          reps: 8,
          rpe: 9,
          weight: 185,
          weightUnit: "lb",
        }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "note", note: "Smooth tempo" },
        {
          expectedResult: { kind: "note", note: "Final rep spotted" },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });

    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{
        note: "Smooth tempo",
        order: 1,
        reps: 8,
        rpe: 9,
        weight: 185,
        weightUnit: "lb",
      }],
    }]);
  });

  it("rejects a concurrent change to the fields owned by the correction", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{
          note: "Final rep spotted",
          order: 1,
          reps: 7,
          rpe: 9,
          weight: 185,
          weightUnit: "lb",
        }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 190, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: 185,
            weightUnit: "lb",
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("recognizes an exact correction replay after an unrelated annotation changes", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{
          note: "Coach updated this later",
          order: 1,
          reps: 8,
          rpe: 9.5,
          weight: 190,
          weightUnit: "lb",
        }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 190, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: 185,
            weightUnit: "lb",
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("adds weight to a reps-only set using its exact partial prior state", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ note: "Controlled", order: 1, reps: 8, rpe: 8 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 185, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: null,
            weightUnit: null,
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });

    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([{
      ...BASE_WORKOUT.exercises[0],
      sets: [{
        note: "Controlled",
        order: 1,
        reps: 8,
        rpe: 8,
        weight: 185,
        weightUnit: "lb",
      }],
    }]);
  });

  it("corrects canonical zero values with an inherited unit precondition", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 0, weight: 0 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 185, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 0,
            weight: 0,
            weightUnit: null,
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });
  });

  it("rejects an inherited-unit precondition after a set unit is explicit", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 8, weight: 185, weightUnit: "lb" }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 190, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: 185,
            weightUnit: null,
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
  });

  it("rejects a stale add-weight action after the reps-only value changed", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 10 }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 185, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: null,
            weightUnit: null,
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("recognizes an exact add-weight replay from a partial prior state", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [{
        ...BASE_WORKOUT.exercises[0],
        sets: [{ order: 1, reps: 8, weight: 185, weightUnit: "lb" }],
      }],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 185, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: null,
            weightUnit: null,
          },
          logged: true,
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("distinguishes a truly empty set from a reps-only set", async () => {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction(
        { kind: "weight_reps", reps: 8, weight: 185, weightUnit: "lb" },
        {
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: null,
            weightUnit: null,
          },
        },
      ),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("does not retarget a delayed action to a workout started after admission", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      startedAt: "2026-08-12T15:01:00.000Z",
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: setAction({ kind: "reps", reps: 8 }),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("appends an exercise and fills its sets in the same write", async () => {
    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: appendAction(),
      vault: "/vault",
    })).resolves.toEqual({ status: "applied" });
    expect(mocks.updateLiveWorkoutExercises.mock.calls[0]?.[2]).toEqual([
      BASE_WORKOUT.exercises[0],
      {
        mode: "bodyweight",
        name: "Push-up",
        order: 2,
        sets: [{ order: 1, reps: 12 }],
      },
    ]);
  });

  it("treats an exact appended exercise retry as unchanged", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [
        BASE_WORKOUT.exercises[0],
        {
          mode: "bodyweight",
          name: "Push-up",
          order: 2,
          sets: [{ order: 1, reps: 12 }],
        },
      ],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: appendAction(),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it("recognizes an appended-set replay after an unrelated annotation changes", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      lastMemberActionId: ACTION_ID,
      exercises: [
        BASE_WORKOUT.exercises[0],
        {
          mode: "bodyweight",
          name: "Push-up",
          order: 2,
          sets: [{ note: "Easy tempo", order: 1, reps: 12, rpe: 7 }],
        },
      ],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: appendAction(),
      vault: "/vault",
    })).resolves.toEqual({ status: "unchanged" });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an extra set",
      sets: [{ order: 1, reps: 12 }, { order: 2 }],
    },
    {
      label: "different logged data",
      sets: [{ order: 1, reps: 10 }],
    },
  ])("rejects an append retry containing $label", async ({ sets }) => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
      exercises: [
        BASE_WORKOUT.exercises[0],
        {
          mode: "bodyweight",
          name: "Push-up",
          order: 2,
          sets,
        },
      ],
    })]);

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action: appendAction(),
      vault: "/vault",
    })).resolves.toEqual({
      reason: "workout_changed",
      status: "rejected",
    });
    expect(mocks.updateLiveWorkoutExercises).not.toHaveBeenCalled();
  });
});
