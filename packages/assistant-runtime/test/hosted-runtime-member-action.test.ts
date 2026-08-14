import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyLiveWorkoutMemberAction: vi.fn(),
}));

vi.mock("@murphai/vault-usecases/workouts", () => ({
  applyLiveWorkoutMemberAction: mocks.applyLiveWorkoutMemberAction,
}));

import {
  executeHostedMemberActionWake,
} from "../src/hosted-runtime/events/member-action.ts";

describe("hosted member action runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyLiveWorkoutMemberAction.mockResolvedValue({ status: "applied" });
  });

  it("applies the typed action directly without an assistant turn", async () => {
    const action = {
      expectedWorkout: {
        actionBinding: "a".repeat(64),
        exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply" as const,
      mutations: [{
        exerciseName: "Leg press",
        exercisePosition: 1,
        expectedResult: null,
        kind: "set.put" as const,
        result: { kind: "reps" as const, reps: 8 },
        setPosition: 1,
      }],
      version: 1 as const,
    };

    const outcome = await executeHostedMemberActionWake({
      vaultRoot: "/vault",
      wake: {
        eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        kind: "member.action.requested",
        occurredAt: "2026-08-12T15:00:00.000Z",
        request: {
          action,
          actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
          requestedAt: "2026-08-12T15:00:00.000Z",
          schemaVersion: 1,
        },
        userId: "member-1",
      },
    });
    expect(outcome).toMatchObject({
      conversationMetrics: null,
      mailboxLane: "member-action",
      postCheckpointRecord: {
        kind: "member-action.outcome-recorded",
        outcome: {
          actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
          reason: null,
          schemaVersion: 1,
          status: "applied",
        },
      },
    });
    expect(Date.parse(
      outcome.postCheckpointRecord?.kind === "member-action.outcome-recorded"
        ? outcome.postCheckpointRecord.outcome.completedAt
        : "",
    )).not.toBeNaN();
    expect(mocks.applyLiveWorkoutMemberAction).toHaveBeenCalledWith({
      acceptedAt: "2026-08-12T15:00:00.000Z",
      action,
      actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      vault: "/vault",
    });
  });

  it("records a typed terminal rejection for the client", async () => {
    mocks.applyLiveWorkoutMemberAction.mockResolvedValueOnce({
      reason: "workout_changed",
      status: "rejected",
    });

    const outcome = await executeHostedMemberActionWake({
      vaultRoot: "/vault",
      wake: {
        eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        kind: "member.action.requested",
        occurredAt: "2026-08-12T15:00:00.000Z",
        request: {
          action: {
            expectedWorkout: {
              actionBinding: "a".repeat(64),
              exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
            },
            kind: "workout.live.apply",
            mutations: [{
              exerciseName: "Leg press",
              exercisePosition: 1,
              expectedResult: null,
              kind: "set.put",
              result: { kind: "reps", reps: 8 },
              setPosition: 1,
            }],
            version: 1,
          },
          actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
          requestedAt: "2026-08-12T15:00:00.000Z",
          schemaVersion: 1,
        },
        userId: "member-1",
      },
    });

    expect(outcome.postCheckpointRecord).toMatchObject({
      kind: "member-action.outcome-recorded",
      outcome: {
        reason: "workout_changed",
        status: "rejected",
      },
    });
  });

  it.each(["applied", "unchanged"] as const)(
    "records a %s mixed-field correction as a terminal success",
    async (status) => {
      mocks.applyLiveWorkoutMemberAction.mockResolvedValueOnce({ status });
      const action = {
        expectedWorkout: {
          actionBinding: "a".repeat(64),
          exercises: [{ name: "Bench press", sets: [{ logged: true }] }],
        },
        kind: "workout.live.apply" as const,
        mutations: [{
          exerciseName: "Bench press",
          exercisePosition: 1,
          expectedResult: {
            kind: "weight_reps" as const,
            reps: 8,
            weight: null,
            weightUnit: null,
          },
          kind: "set.put" as const,
          result: {
            kind: "weight_reps" as const,
            reps: 8,
            weight: 190,
            weightUnit: "lb" as const,
          },
          setPosition: 1,
        }],
        version: 1 as const,
      };

      const outcome = await executeHostedMemberActionWake({
        vaultRoot: "/vault",
        wake: {
          eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
          kind: "member.action.requested",
          occurredAt: "2026-08-12T15:00:00.000Z",
          request: {
            action,
            actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
            requestedAt: "2026-08-12T15:00:00.000Z",
            schemaVersion: 1,
          },
          userId: "member-1",
        },
      });

      expect(outcome.postCheckpointRecord).toMatchObject({
        kind: "member-action.outcome-recorded",
        outcome: {
          reason: null,
          status,
        },
      });
      expect(mocks.applyLiveWorkoutMemberAction).toHaveBeenCalledWith({
        acceptedAt: "2026-08-12T15:00:00.000Z",
        action,
        actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        vault: "/vault",
      });
    },
  );
});
