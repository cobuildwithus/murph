import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_STATUS_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

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
        details: expect.objectContaining({
          pendingNudge: false,
          workspaceWakeDue: false,
        }),
        message: "Hosted runner alarm evaluated wake state.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted runner alarm skipped because no wake is due.",
        phase: "scheduled",
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
          pendingNudge: false,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
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
