import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceState,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../src/env.ts";
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
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("prefers the web-owned workspace nextWakeAt when no pending nudge is stored", async () => {
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = NULL, pending_nudge = 0 WHERE user_id = ?",
      "member_123",
    );
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(createWebStatusResponseBody());

    await runner.alarm();

    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        boundUserId: "member_123",
        method: "GET",
        path: HOSTED_RUNTIME_STATUS_PATH,
      }),
    );
    expect(runner.runCalls).toEqual([]);
    expect(alarms).toEqual([FUTURE_WAKE_AT]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted runner alarm skipped because no wake is due.",
        phase: "scheduled",
        details: expect.objectContaining({
          pendingNudge: false,
          runnerNextWakePresent: false,
          workspaceNextWakePresent: true,
          workspaceWakeDue: false,
        }),
        userId: "member_123",
      }),
    );
  });

  it("treats a stored pending nudge as immediate work even when the web wake is in the future", async () => {
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = ?, pending_nudge = 1 WHERE user_id = ?",
      FUTURE_WAKE_AT,
      "member_123",
    );
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(createWebStatusResponseBody());

    await runner.alarm();

    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        boundUserId: "member_123",
        method: "GET",
        path: HOSTED_RUNTIME_STATUS_PATH,
      }),
    );
    expect(runner.runCalls).toEqual(["alarm"]);
    expect(alarms).toEqual([]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
          runnerNextWakePresent: true,
          workspaceNextWakePresent: true,
          workspaceWakeDue: false,
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
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(createWebStatusResponseBody());

    await runner.nudgeHostedRunner();
    await runner.alarm();

    expect(runner.runCalls).toEqual(["alarm"]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
          workspaceWakeDue: false,
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
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
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

function createRunnerBootstrapHarness(workspace: HostedWorkspaceState | null) {
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
  const invoke = vi.fn(async () => ({
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

function createWebStatusResponse(): HostedRuntimeWebStatusResponse {
  return {
    mailboxLag: [],
    recentLogs: [],
    userId: "member_123",
    workspace: {
      checkpointedAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      nextWakeAt: FUTURE_WAKE_AT,
      nextWakeReason: "mailbox",
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "12",
      },
      snapshotRef: null,
      updatedAt: FIXED_NOW,
      userId: "member_123",
      version: "7",
    },
  };
}

function createWebStatusResponseBody(): Response {
  return new Response(JSON.stringify(createWebStatusResponse()), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
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
