import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedWorkspaceState,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { HostedExecutionContainerStubLike } from "../src/runner-container.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse:
      mocks.fetchHostedExecutionWebControlPlaneResponse,
  };
});

const FUTURE_WAKE_AT = "2099-01-01T00:05:00.000Z";
const FIXED_NOW = "2026-04-27T00:00:00.000Z";

class TestHostedUserRunner extends HostedUserRunner {
  public readonly runCalls: HostedWorkspaceInvocationReason[] = [];

  override async runUntilIdleOrBudget(input: {
    reason: HostedWorkspaceInvocationReason;
  }) {
    this.runCalls.push(input.reason);
    return {
      nextWakeAt: null,
      status: "idle" as const,
    };
  }
}

describe("HostedUserRunner alarm routing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("invokes the runtime directly when an alarm fires without a pending nudge", async () => {
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = NULL, pending_nudge = 0 WHERE user_id = ?",
      "member_123",
    );

    await runner.alarm();

    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(runner.runCalls).toEqual(["alarm"]);
    expect(alarms).toEqual([]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        details: expect.objectContaining({
          pendingNudge: false,
          runnerNextWakePresent: false,
        }),
        userId: "member_123",
      }),
    );
  });

  it("does not second-guess runtime state when an alarm fires with a stored pending nudge", async () => {
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = ?, pending_nudge = 1 WHERE user_id = ?",
      FUTURE_WAKE_AT,
      "member_123",
    );

    await runner.alarm();

    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(runner.runCalls).toEqual(["alarm"]);
    expect(alarms).toEqual([]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
          runnerNextWakePresent: true,
        }),
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });

  it("logs accepted nudges with scheduling state", async () => {
    const { runner } = createRunnerHarness();
    await runner.bindUser("member_123");
    mocks.emitHostedExecutionStructuredLog.mockReset();

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: false,
      inFlight: false,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          alarmScheduled: true,
          alreadyRunning: false,
          pendingNudge: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("runs the workspace invocation when an idle nudge alarm fires", async () => {
    const { runner } = createRunnerHarness();
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await runner.alarm();

    expect(runner.runCalls).toEqual(["alarm"]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
        }),
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });
});

describe("HostedUserRunner first-workspace crypto bootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("marks a live invocation pending without scheduling another immediate alarm", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const { alarms, invoke, runner } = createRunnerBootstrapHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    const run = runner.runUntilIdleOrBudget({ reason: "nudge" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    const nudge = await runner.nudgeHostedRunner();
    expect(nudge).toMatchObject({
      accepted: true,
      alreadyRunning: true,
      inFlight: true,
    });
    expect(nudge.nextAlarmAt).toBe("2026-04-27T00:00:45.100Z");
    expect(alarms).toEqual([nudge.nextAlarmAt]);

    await vi.advanceTimersByTimeAsync(46_000);
    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:01:31.100Z",
      status: "scheduled",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:45.100Z",
      "2026-04-27T00:01:31.100Z",
    ]);

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(run).resolves.toMatchObject({
      status: "idle",
    });
    expect(alarms).toHaveLength(3);
    expect(Date.parse(alarms[2] ?? "")).toBeGreaterThanOrEqual(Date.parse(FIXED_NOW));
    expect(Date.parse(alarms[2] ?? "")).toBeLessThan(Date.parse(FIXED_NOW) + 47_000);
  });

  it("keeps a newly observed persisted-only invocation pending until the orphan grace deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      null,
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:00:45.000Z",
      status: "scheduled",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:45.000Z"]);
  });

  it("clears a persisted-only invocation on the second wake after orphan observation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      null,
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:00:45.000Z",
      status: "scheduled",
    });
    expect(invoke).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-04-27T00:00:46.000Z"));
    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("clears a persisted-only invocation after the observed orphan grace and starts a replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:50:00.000Z",
      "2026-04-26T23:59:10.000Z",
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted workspace invocation lease expired; clearing stale in-flight state.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });

  it("reports an expired persisted-only invocation as not running so the route can enqueue recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:50:00.000Z",
      "2026-04-26T23:59:10.000Z",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: false,
      inFlight: false,
    });
  });

  it("moves a pending nudge to the orphan check deadline when lease liveness clears orphan observation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "2026-04-26T23:59:10.000Z",
      "0",
      "2026-04-27T00:00:45.000Z",
      "member_123",
    );

    await expect(runner.ownsActiveInvocationLease({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "0",
    })).resolves.toBe(true);

    expect(alarms).toEqual(["2026-04-27T00:00:45.000Z"]);
  });

  it("moves a pending nudge to the orphan check deadline when checkpoint liveness clears orphan observation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "2026-04-26T23:59:10.000Z",
      "0",
      "2026-04-27T00:00:45.000Z",
      "member_123",
    );

    await expect(runner.recordActiveInvocationWorkspaceCheckpoint({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "1",
    })).resolves.toEqual({ recorded: true });

    expect(alarms).toEqual(["2026-04-27T00:00:45.000Z"]);
  });

  it("records heartbeat liveness and schedules pending work at the next orphan check deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "2026-04-26T23:59:10.000Z",
      "0",
      "2026-04-27T00:00:45.000Z",
      "member_123",
    );

    await expect(runner.recordActiveInvocationHeartbeat({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
    })).resolves.toEqual({
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true,
    });

    expect(alarms).toEqual(["2026-04-27T00:00:45.000Z"]);
  });

  it("clears a persisted-only invocation after the last heartbeat grace and starts a replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:46.000Z"));
    const { invoke, runner, sql } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_orphan_observed_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-27T00:00:00.000Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      null,
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
  });

  it("provisions managed user crypto before invoking a version-0 workspace without a snapshot", async () => {
    const { invoke, runner } = createRunnerBootstrapHarness(createWorkspaceState({
      snapshotRef: null,
      version: "0",
    }));
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({
          request: expect.objectContaining({
            userId: "member_123",
            workspaceVersion: "0",
          }),
        }),
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.user-key-store",
        message: "root-key-bootstrap: member-activation-workspace-bootstrap",
        userId: "member_123",
      }),
    );
  });

  it("provisions managed user crypto before invoking when the web workspace is absent", async () => {
    const { invoke, runner } = createRunnerBootstrapHarness(null);
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({
          request: expect.objectContaining({
            userId: "member_123",
            workspaceVersion: "0",
          }),
        }),
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.user-key-store",
        message: "root-key-bootstrap: member-activation-workspace-bootstrap",
        userId: "member_123",
      }),
    );
  });

  it("keeps missing crypto fail-closed for version-0 workspaces with a snapshot", async () => {
    const { invoke, runner } = createRunnerBootstrapHarness(createWorkspaceState({
      snapshotRef: createBundleRef("checkpointed"),
      version: "0",
    }));
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "missing-envelope",
    });

    expect(invoke).not.toHaveBeenCalled();
    expectBootstrapAuditLogNotEmitted();
  });

  it("keeps missing crypto fail-closed for nonzero workspace versions with a snapshot", async () => {
    const { invoke, runner } = createRunnerBootstrapHarness(createWorkspaceState({
      snapshotRef: createBundleRef("checkpointed"),
      version: "1",
    }));
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "missing-envelope",
    });

    expect(invoke).not.toHaveBeenCalled();
    expectBootstrapAuditLogNotEmitted();
  });

  it("keeps missing crypto fail-closed for nonzero workspace versions without a snapshot", async () => {
    const { invoke, runner } = createRunnerBootstrapHarness(createWorkspaceState({
      snapshotRef: null,
      version: "1",
    }));
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "missing-envelope",
    });

    expect(invoke).not.toHaveBeenCalled();
    expectBootstrapAuditLogNotEmitted();
  });
});

function createRunnerHarness() {
  const sql = createTestSqlStorage();
  const alarms: string[] = [];
  const storage = {
    async delete() {
      return true;
    },
    async deleteAlarm() {
      alarms.push("deleted");
    },
    async get() {
      return undefined;
    },
    async getAlarm() {
      return null;
    },
    async put() {},
    async setAlarm(scheduledTime: number | Date) {
      alarms.push(
        scheduledTime instanceof Date
          ? scheduledTime.toISOString()
          : new Date(scheduledTime).toISOString(),
      );
    },
    sql,
  };
  const bucket = {
    async get() {
      return null;
    },
    async put() {},
  };

  return {
    alarms,
    runner: new TestHostedUserRunner(
      {
        storage,
      },
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      bucket,
    ),
    sql,
  };
}

function createRunnerBootstrapHarness(
  workspace: HostedWorkspaceState | null,
  options: {
    invoke?: ReturnType<typeof vi.fn<HostedExecutionContainerStubLike["invoke"]>>;
  } = {},
) {
  const sql = createTestSqlStorage();
  const values = new Map<string, unknown>();
  const alarms: string[] = [];
  const storage = {
    async delete(key: string) {
      return values.delete(key);
    },
    async deleteAlarm() {
      alarms.push("deleted");
    },
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async getAlarm() {
      return null;
    },
    async put<T>(key: string, value: T) {
      values.set(key, value);
    },
    async setAlarm(scheduledTime: number | Date) {
      alarms.push(
        scheduledTime instanceof Date
          ? scheduledTime.toISOString()
          : new Date(scheduledTime).toISOString(),
      );
    },
    sql,
  };
  const invoke = options.invoke ?? vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
    nextWakeAt: null,
    status: "idle" as const,
  }));

  mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
    path: string;
  }) => {
    if (input.path !== HOSTED_RUNTIME_WORKSPACE_PATH) {
      throw new Error(`Unexpected web control path in bootstrap test: ${input.path}`);
    }

    return createWorkspaceReadResponseBody(workspace);
  });

  const runner = new HostedUserRunner(
    {
      storage,
    },
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    })),
    new MemoryEncryptedR2Bucket(),
    {},
    {
      getByName(name: string) {
        expect(name).toBe("member_123");
        return {
          async destroyInstance() {},
          invoke,
          async ownsInternalWorkerProxyToken() {
            return true;
          },
          async smokeHealth() {
            return {
              ok: true,
              runnerBundle: null,
              service: "cloudflare-hosted-runner-node",
              status: 200,
            };
          },
        };
      },
    },
  );

  return {
    alarms,
    invoke,
    runner,
    sql,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

function createWorkspaceReadResponseBody(workspace: HostedWorkspaceState | null): Response {
  return new Response(JSON.stringify({
    fetchedAt: FIXED_NOW,
    workspace,
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

function createWorkspaceState(
  overrides: Partial<HostedWorkspaceState> = {},
): HostedWorkspaceState {
  return {
    checkpointedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: FIXED_NOW,
    userId: "member_123",
    version: "0",
    ...overrides,
  };
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function expectBootstrapAuditLogNotEmitted(): void {
  expect(
    mocks.emitHostedExecutionStructuredLog.mock.calls.some(([record]) =>
      record.component === "hosted.user-key-store"
      && typeof record.message === "string"
      && record.message.includes("member-activation-workspace-bootstrap")
    ),
  ).toBe(false);
}
