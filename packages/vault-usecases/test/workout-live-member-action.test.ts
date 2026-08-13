import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutSession } from "@murphai/contracts";
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

function setAction(result: { kind: "reps"; reps: number }) {
  return {
    expectedWorkout: {
      actionBinding: ACTION_BINDING,
      exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
    },
    kind: "workout.live.apply" as const,
    mutations: [{
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedResult: null,
      kind: "set.put" as const,
      requiresExistingSet: true,
      result,
      setPosition: 1,
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
    const action = {
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
          setCount: 1,
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

    await expect(applyLiveWorkoutMemberAction({
      acceptedAt: ACCEPTED_AT,
      action,
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
});
