import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkoutMemberActionExpectedSetResultV1,
  WorkoutMemberActionSetResultV1,
  WorkoutSession,
} from "@murphai/contracts";
import { deriveWorkoutActionBinding } from "@murphai/operator-config/workout-action-binding";

const mocks = vi.hoisted(() => ({
  findActiveLiveWorkouts: vi.fn(),
  updateLiveWorkoutExercises: vi.fn(),
  withLiveWorkoutMutationLock: vi.fn(),
}));

vi.mock("../src/usecases/workout-live-state.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/usecases/workout-live-state.js")>(),
  findActiveLiveWorkouts: mocks.findActiveLiveWorkouts,
  updateLiveWorkoutExercises: mocks.updateLiveWorkoutExercises,
  withLiveWorkoutMutationLock: mocks.withLiveWorkoutMutationLock,
}));

import {
  applyLiveWorkoutMemberAction,
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
      requiresExistingSet: true,
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
        requiresExistingSet: false,
        result: { kind: "reps" as const, reps: 12 },
        setPosition: 1,
      },
    ],
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

  it("treats an exact retry as unchanged before the stale-shape check", async () => {
    mocks.findActiveLiveWorkouts.mockResolvedValueOnce([shownWorkout({
      ...BASE_WORKOUT,
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
