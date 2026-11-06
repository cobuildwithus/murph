import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyLiveWorkoutMemberAction: vi.fn(),
  readLiveWorkoutCardSnapshot: vi.fn(),
  setWorkoutUnitPreferences: vi.fn(),
}));

vi.mock("@murphai/vault-usecases/workouts", () => ({
  applyLiveWorkoutMemberAction: mocks.applyLiveWorkoutMemberAction,
  readLiveWorkoutCardSnapshot: mocks.readLiveWorkoutCardSnapshot,
  setWorkoutUnitPreferences: mocks.setWorkoutUnitPreferences,
}));

import {
  executeHostedMemberActionWake,
} from "../src/hosted-runtime/events/member-action.ts";

describe("hosted member action runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyLiveWorkoutMemberAction.mockResolvedValue({ status: "applied" });
    mocks.setWorkoutUnitPreferences.mockResolvedValue({ updated: true });
    mocks.readLiveWorkoutCardSnapshot.mockResolvedValue({
      result: {
        cardUrl: "https://www.withmurph.ai/#murph-card=card",
        kind: "workout.live.snapshot",
        version: 1,
      },
      status: "unchanged",
    });
  });

  it.each(["applied", "unchanged"] as const)(
    "persists a preference-only unit selection after canonical %s validation",
    async (status) => {
      mocks.applyLiveWorkoutMemberAction.mockResolvedValueOnce({ status });
      const action = {
        expectedWorkout: {
          actionBinding: "a".repeat(64),
          exercises: [{ name: "Bench press", sets: [{ logged: false }] }],
        },
        kind: "workout.live.apply" as const,
        mutations: [],
        version: 1 as const,
        weightUnitPreference: "kg" as const,
      };

      const outcome = await executeHostedMemberActionWake({
        vaultRoot: "/vault",
        wake: {
          eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
          kind: "member.action.requested",
          occurredAt: "2026-08-26T05:45:00.000Z",
          request: {
            action,
            actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
            requestedAt: "2026-08-26T05:45:00.000Z",
            schemaVersion: 1,
          },
          userId: "member-1",
        },
      });

      expect(mocks.applyLiveWorkoutMemberAction).toHaveBeenCalledWith({
        acceptedAt: "2026-08-26T05:45:00.000Z",
        action,
        actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        vault: "/vault",
      });
      expect(mocks.setWorkoutUnitPreferences).toHaveBeenCalledWith({
        recordedAt: "2026-08-26T05:45:00.000Z",
        vault: "/vault",
        weight: "kg",
      });
      expect(outcome.postCheckpointRecord).toMatchObject({
        outcome: { status },
      });
    },
  );

  it("retries preference persistence after the canonical action marker commits", async () => {
    const action = {
      expectedWorkout: {
        actionBinding: "a".repeat(64),
        exercises: [{ name: "Bench press", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply" as const,
      mutations: [],
      version: 1 as const,
      weightUnitPreference: "kg" as const,
    };
    const wake = {
      eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      kind: "member.action.requested" as const,
      occurredAt: "2026-08-26T05:45:00.000Z",
      request: {
        action,
        actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        requestedAt: "2026-08-26T05:45:00.000Z",
        schemaVersion: 1 as const,
      },
      userId: "member-1",
    };
    mocks.applyLiveWorkoutMemberAction
      .mockResolvedValueOnce({ status: "applied" })
      .mockResolvedValueOnce({ status: "unchanged" });
    mocks.setWorkoutUnitPreferences
      .mockRejectedValueOnce(new Error("preference write failed"))
      .mockResolvedValueOnce({ updated: true });

    await expect(executeHostedMemberActionWake({
      vaultRoot: "/vault",
      wake,
    })).rejects.toThrow("preference write failed");
    await expect(executeHostedMemberActionWake({
      vaultRoot: "/vault",
      wake,
    })).resolves.toMatchObject({
      postCheckpointRecord: {
        outcome: { status: "unchanged" },
      },
    });

    expect(mocks.applyLiveWorkoutMemberAction).toHaveBeenCalledTimes(2);
    expect(mocks.setWorkoutUnitPreferences).toHaveBeenCalledTimes(2);
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
              exercises: [{ name: "Bench press", sets: [{ logged: false }] }],
            },
            kind: "workout.live.apply",
            mutations: [],
            version: 1,
            weightUnitPreference: "kg",
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
    expect(mocks.setWorkoutUnitPreferences).not.toHaveBeenCalled();
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
        weightUnitPreference: "kg" as const,
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
      expect(mocks.setWorkoutUnitPreferences).toHaveBeenCalledWith({
        recordedAt: "2026-08-12T15:00:00.000Z",
        vault: "/vault",
        weight: "kg",
      });
    },
  );
});


it("applies demographics through canonical memory and replays after a later correction before outcome publication", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { setMemoryDemographics, readMemoryDemographics, upsertMemory } = await import("@murphai/core");
  const root = await mkdtemp(join(tmpdir(), "demographics-runtime-"));
  const wake = {
    eventId: "member.action.requested:d8653d1f-fb8d-400b-8efe-d3fbdc9f9830",
    kind: "member.action.requested" as const, userId: "member_synthetic", occurredAt: "2026-01-01T01:00:00Z",
    request: { actionId: "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830", requestedAt: "2025-12-31T23:30:00Z", schemaVersion: 1 as const,
      action: { kind: "demographics.set" as const, version: 1 as const, patch: { age: 39 } },
    },
  };
  try {
    const first = await executeHostedMemberActionWake({ vaultRoot: root, wake });
    expect(first.postCheckpointRecord).toMatchObject({ kind: "member-action.outcome-recorded", outcome: { status: "applied", reason: null } });
    expect(await readMemoryDemographics(root)).toMatchObject({ birthYear: 1986, birthYearPrecision: "approximate" });
    await setMemoryDemographics(root, { birthYear: 1980 });
    expect((await executeHostedMemberActionWake({ vaultRoot: root, wake })).postCheckpointRecord).toMatchObject({ outcome: { status: "applied" } });
    expect((await readMemoryDemographics(root)).birthYear).toBe(1980);
    const unchanged = { ...wake, request: { ...wake.request, actionId: "1c13cd3b-7e72-460d-a380-785025939fd6",
      action: { kind: "demographics.set" as const, version: 1 as const, patch: { birthYear: 1980 } } } };
    expect((await executeHostedMemberActionWake({ vaultRoot: root, wake: unchanged })).postCheckpointRecord).toMatchObject({ outcome: { status: "unchanged" } });
    await upsertMemory(root, { section: "Identity", text: "Date of birth: 1986-07-12" });
    const conflict = { ...unchanged, request: { ...unchanged.request, actionId: "8df94543-4285-4f06-b82b-0564b70c95bd" } };
    expect((await executeHostedMemberActionWake({ vaultRoot: root, wake: conflict })).postCheckpointRecord).toMatchObject({ outcome: { status: "rejected", reason: "demographics_unresolved" } });
  } finally { await rm(root, { force: true, recursive: true }); }
});


it("applies a display name through core, stays silent, and reports changed versus unchanged", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readMemoryDocument } = await import("@murphai/core");
  const { resolveMemoryDisplayName } = await import("@murphai/contracts");
  const root = await mkdtemp(join(tmpdir(), "display-name-action-"));
  const wake = {
    eventId: "member.action.requested:d8653d1f-fb8d-400b-8efe-d3fbdc9f9830",
    kind: "member.action.requested" as const, userId: "member_synthetic", occurredAt: "2026-01-01T01:00:00Z",
    request: { actionId: "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830", requestedAt: "2026-01-01T01:00:00Z", schemaVersion: 1 as const,
      action: { kind: "display-name.set" as const, version: 1 as const, displayName: "Avery" },
    },
  };
  try {
    for (const [displayName, status] of [["Avery", "applied"], ["Avery", "unchanged"], ["Robin", "applied"], ["Avery", "applied"]] as const) {
      wake.request.action.displayName = displayName;
      const result = await executeHostedMemberActionWake({ vaultRoot: root, wake });
      expect(result).toMatchObject({ conversationMetrics: null, mailboxLane: "member-action", nextWakeAt: null, redactedLogEntries: [],
        postCheckpointRecord: { kind: "member-action.outcome-recorded", outcome: { status, reason: null } } });
      expect(resolveMemoryDisplayName(await readMemoryDocument(root))?.displayName).toBe(displayName);
    }
  } finally { await rm(root, { force: true, recursive: true }); }
});


it("writes a typed reading at requestedAt and keeps an exact replay silent and unchanged", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { deterministicContractId, ID_PREFIXES, initializeVault, readJsonlRecords } = await import("@murphai/core");
  const { resolveMetricDefinition } = await import("@murphai/query");
  const root = await mkdtemp(join(tmpdir(), "measurement-action-"));
  const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
  const requestedAt = "2026-11-06T12:34:56.000Z";
  const wake = {
    eventId: `member.action.requested:${actionId}`,
    kind: "member.action.requested" as const, userId: "member_synthetic",
    occurredAt: "2026-11-07T01:00:00.000Z",
    request: { actionId, requestedAt, schemaVersion: 1 as const,
      action: { kind: "measurement.add" as const, version: 1 as const, metric: "estimated-vo2-max" as const, value: 42.5 },
    },
  };
  try {
    await initializeVault({ vaultRoot: root, title: "Synthetic measurement vault", timezone: "UTC" });
    for (const status of ["applied", "unchanged"]) {
      expect(await executeHostedMemberActionWake({ vaultRoot: root, wake })).toMatchObject({
        conversationMetrics: null, mailboxLane: "member-action", nextWakeAt: null, redactedLogEntries: [],
        postCheckpointRecord: { kind: "member-action.outcome-recorded", outcome: { actionId, status, reason: null } },
      });
    }
    const records = await readJsonlRecords({ vaultRoot: root, relativePath: "ledger/events/2026/2026-11.jsonl" });
    expect(records).toEqual([expect.objectContaining({
      id: deterministicContractId(ID_PREFIXES.event, `member-action:${actionId}`),
      occurredAt: requestedAt, source: "manual", lifecycle: expect.objectContaining({ revision: 1 }),
      measurements: [{ metric: "estimated-vo2-max", value: 42.5, unit: resolveMetricDefinition("estimated-vo2-max")!.canonicalUnit }],
    })]);
  } finally { await rm(root, { force: true, recursive: true }); }
});

it("keeps an evening reading on the member's day, not the next UTC day", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { initializeVault } = await import("@murphai/core");
  const { listMetricPoints } = await import("@murphai/query");
  const root = await mkdtemp(join(tmpdir(), "measurement-evening-"));
  const actionId = "c3a1f6de-2f14-4a6e-9a55-6f1e2b7d4c10";
  const requestedAt = "2026-11-06T20:30:00-05:00";
  try {
    await initializeVault({ vaultRoot: root, title: "Synthetic measurement vault", timezone: "America/New_York" });
    await executeHostedMemberActionWake({ vaultRoot: root, wake: {
      eventId: `member.action.requested:${actionId}`,
      kind: "member.action.requested" as const, userId: "member_synthetic", occurredAt: requestedAt,
      request: { actionId, requestedAt, schemaVersion: 1 as const,
        action: { kind: "measurement.add" as const, version: 1 as const, metric: "estimated-vo2-max" as const, value: 42 },
      },
    } });
    const points = await listMetricPoints(root, { metricKey: "estimated-vo2-max", limit: null });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ effectiveDate: "2026-11-06", grain: "day" });
    expect(Date.parse(points[0]!.observedAt)).toBe(Date.parse(requestedAt));
  } finally { await rm(root, { force: true, recursive: true }); }
});
