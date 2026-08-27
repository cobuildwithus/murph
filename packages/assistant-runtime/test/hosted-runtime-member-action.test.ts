import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyLiveWorkoutMemberAction: vi.fn(),
  readLiveWorkoutCardSnapshot: vi.fn(),
}));

vi.mock("@murphai/vault-usecases/workouts", () => ({
  applyLiveWorkoutMemberAction: mocks.applyLiveWorkoutMemberAction,
  readLiveWorkoutCardSnapshot: mocks.readLiveWorkoutCardSnapshot,
}));

import {
  executeHostedMemberActionWake,
} from "../src/hosted-runtime/events/member-action.ts";

describe("hosted member action runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyLiveWorkoutMemberAction.mockResolvedValue({ status: "applied" });
    mocks.readLiveWorkoutCardSnapshot.mockResolvedValue({
      result: {
        cardUrl: "https://www.withmurph.ai/#murph-card=card",
        kind: "workout.live.snapshot",
        version: 1,
      },
      status: "unchanged",
    });
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
    if (outcome.postCheckpointRecord?.kind !== "member-action.outcome-recorded") {
      throw new TypeError("Expected one member-action outcome record.");
    }
    expect(outcome.postCheckpointRecord.outcome).not.toHaveProperty("result");
    expect(mocks.applyLiveWorkoutMemberAction).toHaveBeenCalledWith({
      acceptedAt: "2026-08-12T15:00:00.000Z",
      action,
      actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      vault: "/vault",
    });
  });

  it.each(["applied", "unchanged"] as const)(
    "records the optional direct-save card result on %s",
    async (status) => {
      const result = {
        cardUrl: "https://www.withmurph.ai/#murph-card=apply-card",
        kind: "workout.live.apply" as const,
        version: 1 as const,
      };
      mocks.applyLiveWorkoutMemberAction.mockResolvedValueOnce({
        result,
        status,
      });
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
        presentation: {
          footer: null,
          subtitle: null,
          title: "Strength",
          workout: {
            exercises: [{
              name: "Leg press",
              sets: [{ actual: "8 reps", status: "completed" as const, target: null }],
            }],
            state: "active" as const,
            version: 1 as const,
          },
        },
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
          result,
          status,
        },
      });
    },
  );

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

  it("records the authenticated read-only workout snapshot result", async () => {
    const action = {
      kind: "workout.live.snapshot" as const,
      presentation: {
        title: "Strength",
        subtitle: null,
        footer: null,
        workout: {
          exercises: [{
            name: "Bench press",
            sets: [{ actual: null, status: "pending" as const, target: null }],
          }],
          state: "active" as const,
          version: 1 as const,
        },
      },
      version: 1 as const,
      workoutBinding: "c".repeat(64),
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
        result: {
          cardUrl: "https://www.withmurph.ai/#murph-card=card",
          kind: "workout.live.snapshot",
        },
        status: "unchanged",
      },
    });
    expect(mocks.readLiveWorkoutCardSnapshot).toHaveBeenCalledWith({
      action,
      vault: "/vault",
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
