import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedWorkspaceState,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.ts";
import { hostedEmailRawMessageUserPrefix } from "../src/hosted-email.ts";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedRunnerSecretsObjectKey,
} from "../src/storage-paths.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestHostedRuntimeCryptoContext } from "./hosted-runtime-crypto-fixtures.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const HOSTED_WEB_USAGE_GATE_PATH = "/api/internal/hosted-execution/usage/gate";
const TEST_RUNNER_RUNTIME_ENV_SOURCE = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-openai-key",
} as const;

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
    dueWake?: boolean;
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

  it("invokes the runtime directly when a due alarm fires without a pending nudge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = ?, pending_nudge = 0 WHERE user_id = ?",
      FIXED_NOW,
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

  it("treats stale duplicate alarms without pending work as no-ops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET next_wake_at = ?, pending_nudge = 0 WHERE user_id = ?",
      FUTURE_WAKE_AT,
      "member_123",
    );

    await runner.alarm();

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual([FUTURE_WAKE_AT]);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
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
          immediateDriveStarted: true,
          pendingNudge: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("starts the workspace invocation immediately when an idle nudge is accepted", async () => {
    const { runner } = createRunnerHarness();
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();

    expect(runner.runCalls).toEqual(["nudge"]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          immediateDriveStarted: true,
          pendingNudge: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("deletes runner state and clears alarms for hosted user deletion", async () => {
    const destroyInstance = vi.fn(async () => {});
    const { alarms, r2Deletes, runner, sql } = createRunnerHarness({
      runnerContainerNamespace: createRunnerContainerNamespace(destroyInstance),
    });
    await runner.bindUser("member_123");

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true,
      r2: {
        deletedObjectCount: 0,
        skippedUserScopedPrefixes: true,
        supported: false,
      },
      userId: "member_123",
    });

    expect(alarms).toContain("deleted");
    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(r2Deletes).toEqual([]);
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("preflights Durable Object ownership before deleting R2 objects", async () => {
    const destroyInstance = vi.fn(async () => {});
    const { r2Deletes, runner, sql } = createRunnerHarness({
      runnerContainerNamespace: createRunnerContainerNamespace(destroyInstance),
    });
    await runner.bindUser("member_other");

    await expect(runner.deleteHostedUserData("member_123")).rejects.toThrow(
      "Hosted runner Durable Object is bound to member_other, not member_123.",
    );

    expect(r2Deletes).toEqual([]);
    expect(destroyInstance).not.toHaveBeenCalled();
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([
      { user_id: "member_other" },
    ]);
  });

  it("continues Durable Object cleanup when best-effort R2 deletion fails", async () => {
    const destroyInstance = vi.fn(async () => {});
    const { alarms, runner, sql } = createRunnerHarness({
      bucket: {
        async delete() {},
        async get() {
          throw new Error("R2 unavailable");
        },
        async put() {},
      },
      runnerContainerNamespace: createRunnerContainerNamespace(destroyInstance),
    });
    await runner.bindUser("member_123");

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true,
      r2: {
        deletedObjectCount: 0,
        skippedUserScopedPrefixes: true,
        supported: false,
        userScopedSkipReason: "R2PrefixDeletionUnsupported",
      },
      userId: "member_123",
    });

    expect(alarms).toContain("deleted");
    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("skips user-scoped R2 prefixes when the web crypto context is unavailable", async () => {
    const r2Deletes: string[] = [];
    const { runner } = createRunnerHarness({
      cryptoContextStatus: 404,
      bucket: {
        async delete(key: string) {
          r2Deletes.push(key);
        },
        async get() {
          return null;
        },
        async put() {},
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      r2: {
        skippedUserScopedPrefixes: true,
        userScopedSkipReason: "HostedUserCryptoRepairNeededError",
      },
      userId: "member_123",
    });

    expect(r2Deletes).toEqual([]);
  });

  it("skips user-scoped R2 prefixes when R2 prefix listing is unavailable", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const { runner } = createRunnerHarness({
      bucket,
    });
    await runner.bindUser("member_123");

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      r2: {
        skippedUserScopedPrefixes: true,
        supported: false,
        userScopedSkipReason: "R2PrefixDeletionUnsupported",
      },
      userId: "member_123",
    });

    expect(bucket.deleted).toEqual([]);
  });

  it("deletes user-scoped R2 prefixes and runner secrets when cleanup is fully supported", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundlePrefix = await hostedBundleUserPrefix({ userId: "member_123" });
    const artifactPrefix = await hostedArtifactUserPrefix({ userId: "member_123" });
    const browserVaultPrefix = await hostedBrowserVaultReplicaUserPrefix({
      userId: "member_123",
    });
    const emailRawPrefix = await hostedEmailRawMessageUserPrefix({ userId: "member_123" });
    const unrelatedEmailRawPrefix = await hostedEmailRawMessageUserPrefix({
      userId: "other_member",
    });
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: "member_123" });
    await bucket.put(`${bundlePrefix}bundle.bundle.json`, "bundle");
    await bucket.put(`${artifactPrefix}artifact.artifact.bin`, "artifact");
    await bucket.put(`${browserVaultPrefix}replica.json`, "replica");
    await bucket.put(`${emailRawPrefix}message.eml`, "raw email");
    await bucket.put(runnerSecretsKey, "runner secrets");
    await bucket.put("users/bundles/unrelated/vault/object.bundle.json", "unrelated");
    await bucket.put(`${unrelatedEmailRawPrefix}message.eml`, "unrelated raw email");
    const { runner } = createRunnerHarness({
      bucket,
    });
    await runner.bindUser("member_123");

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      r2: {
        deletedObjectCount: 5,
        skippedUserScopedPrefixes: false,
        supported: true,
        userScopedSkipReason: null,
      },
      userId: "member_123",
    });

    expect(bucket.objects.has(`${bundlePrefix}bundle.bundle.json`)).toBe(false);
    expect(bucket.objects.has(`${artifactPrefix}artifact.artifact.bin`)).toBe(false);
    expect(bucket.objects.has(`${browserVaultPrefix}replica.json`)).toBe(false);
    expect(bucket.objects.has(`${emailRawPrefix}message.eml`)).toBe(false);
    expect(bucket.objects.has(runnerSecretsKey)).toBe(false);
    expect(bucket.objects.get("users/bundles/unrelated/vault/object.bundle.json")).toBe("unrelated");
    expect(bucket.objects.get(`${unrelatedEmailRawPrefix}message.eml`)).toBe("unrelated raw email");
    expect(new Set(bucket.deleted)).toEqual(new Set([
      `${bundlePrefix}bundle.bundle.json`,
      `${artifactPrefix}artifact.artifact.bin`,
      `${browserVaultPrefix}replica.json`,
      `${emailRawPrefix}message.eml`,
      runnerSecretsKey,
    ]));
  });
});

describe("HostedUserRunner runtime crypto context", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("marks a live invocation pending, schedules recovery, and starts a follow-up after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return invocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { alarms, runner } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    const nudge = await runner.nudgeHostedRunner();
    expect(nudge).toMatchObject({
      accepted: true,
      alreadyRunning: true,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:45.100Z",
    });
    expect(alarms).toEqual(["2026-04-27T00:00:45.100Z"]);

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual(["2026-04-27T00:00:45.100Z"]);

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toEqual([
      "2026-04-27T00:00:45.100Z",
      "2026-04-27T00:00:01.100Z",
      "deleted",
    ]);
  });

  it("treats alarms during a live invocation as recovery-only while the pending nudge follows after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const secondInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return firstInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return secondInvocation.promise;
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { runner } = createRunnerCryptoContextHarness(null, { invoke });
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await runner.nudgeHostedRunner();

    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();
    await expect(alarmRun).resolves.toBeUndefined();

    firstInvocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    secondInvocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("queues a follow-up drive after completion when a pending nudge remains after budget exhaustion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      nextWakeAt: null;
      status: "budget_exhausted";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return firstInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { alarms, runner } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await runner.nudgeHostedRunner();

    firstInvocation.resolve({
      nextWakeAt: null,
      status: "budget_exhausted",
    });

    const scheduledResult = await activeRun;
    expect(scheduledResult).toMatchObject({
      status: "budget_exhausted",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toEqual([
      "2026-04-27T00:00:45.100Z",
      "2026-04-27T00:00:01.100Z",
      "deleted",
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
        }),
        message: "Hosted runner queued follow-up drive for pending nudge and scheduled delayed continuation alarm.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("starts a pending follow-up after lock release even when the completed pass returned scheduled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      nextWakeAt: string;
      status: "scheduled";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return firstInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { alarms, runner } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await runner.nudgeHostedRunner();

    firstInvocation.resolve({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "scheduled",
    });

    await expect(activeRun).resolves.toMatchObject({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "scheduled",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toEqual([
      "2026-04-27T00:00:45.100Z",
      "2026-04-27T00:00:01.100Z",
      "deleted",
    ]);
  });

  it("keeps the idle nudge alarm as a fallback when the detached drive is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    const nudge = await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(nudge).toMatchObject({
      accepted: true,
      alreadyRunning: false,
      inFlight: false,
      nextAlarmAt: "2026-04-27T00:00:30.000Z",
    });
    expect(alarms).toEqual(["2026-04-27T00:00:30.000Z"]);

    await vi.advanceTimersByTimeAsync(30_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:30.000Z",
      "2026-04-27T00:01:15.100Z",
      "deleted",
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "alarm",
        }),
        message: "Hosted runner invocation already active; synced recovery wake.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("syncs only the recovery alarm for a duplicate alarm while an invocation is still active with no pending work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:30.000Z",
      "2026-04-27T00:00:45.100Z",
    ]);
    expect(
      sql.exec(
        "SELECT pending_nudge FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ pending_nudge: 0 }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "alarm",
        }),
        message: "Hosted runner invocation already active; synced recovery wake.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("syncs a recovery alarm instead of waiting behind a long active invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const { alarms, invoke, runner } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(30_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:30.000Z",
      "2026-04-27T00:01:15.100Z",
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "alarm",
        }),
        message: "Hosted runner invocation already active; synced recovery wake.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("syncs only a recovery alarm when runUntilIdleOrBudget is called during an active invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.runUntilIdleOrBudget({ reason: "alarm" })).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:00:45.100Z",
      status: "scheduled",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual(["2026-04-27T00:00:45.100Z"]);
    expect(
      sql.exec(
        "SELECT pending_nudge FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ pending_nudge: 0 }]);

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("keeps a future runtime wake after an active alarm syncs recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: string;
      status: "idle";
    }>();
    const { alarms, invoke, runner } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
    });
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(30_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    invocation.resolve({
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      status: "idle",
    });

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:30.000Z",
      "2026-04-27T00:01:15.100Z",
      "2026-04-27T00:05:00.000Z",
    ]);
  });

  it("keeps a newly observed persisted-only invocation pending until the orphan grace deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null);
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
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null);
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
    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
      status: "idle",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("clears a persisted-only invocation after the observed orphan grace and starts a replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null);
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

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
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
    const { runner, sql } = createRunnerCryptoContextHarness(null);
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
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
      inputAvailable: true,
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true,
      pendingNudge: true,
    });

    expect(alarms).toEqual(["2026-04-27T00:00:45.000Z"]);
  });

  it("clears a persisted-only invocation after the last heartbeat grace and starts a replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:46.000Z"));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null);
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

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
  });

  it("uses the web crypto context before invoking a version-0 workspace without a snapshot", async () => {
    const { invoke, runner } = createRunnerCryptoContextHarness(createWorkspaceState({
      snapshotRef: null,
      version: "0",
    }));
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
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
  });

  it("uses the web crypto context before invoking when the web workspace is absent", async () => {
    const { invoke, runner } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
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
  });

  it("does not begin a container invocation when the web AI usage gate denies the start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { alarms, invoke, runner } = createRunnerCryptoContextHarness(null, {
      usageGateResponse: {
        allowed: false,
        noticeCode: "pulse_upgrade_edge",
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
        userNotice: "Hey - you've reached your usage limit for the month. Upgrade to Edge for more usage.",
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toEqual({
      nextWakeAt: "2026-05-01T00:00:00.000Z",
      redactedStatus: {
        aiUsageGateBlocked: true,
        aiUsageGateNotice: "Hey - you've reached your usage limit for the month. Upgrade to Edge for more usage.",
        aiUsageGateNoticeCode: "pulse_upgrade_edge",
        aiUsageGateReason: "ai_usage_limit_exceeded",
        aiUsageGateRetryAfter: "2026-05-01T00:00:00.000Z",
      },
      status: "scheduled",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toContain("2026-05-01T00:00:00.000Z");
  });

  it("fails closed with a retry alarm when the web AI usage gate is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      maxEventAttempts: 2,
      usageGateResponse: {
        error: "Unavailable",
      },
      usageGateStatus: 503,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: {
        aiUsageGateBlocked: true,
        aiUsageGateReason: "ai_usage_gate_unavailable",
        aiUsageGateRetryAfter: "2026-04-27T00:00:30.000Z",
      },
      status: "scheduled",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toContain("2026-04-27T00:00:30.000Z");
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:30.000Z",
      retry_failure_count: 1,
    }]);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).not.toHaveBeenCalled();
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      retry_failure_count: 2,
    }]);
  });

  it("skips the duplicate web AI usage gate for pending nudge invocations", async () => {
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      usageGateResponse: {
        allowed: false,
        noticeCode: "pulse_upgrade_edge",
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
        userNotice: "Limit reached.",
      },
    });
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET pending_nudge = 1 WHERE user_id = ?",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.some(
        ([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH,
      ),
    ).toBe(false);
  });

  it("refreshes the cached runtime crypto context after the web TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner } = createRunnerCryptoContextHarness(null, {
      cryptoContextCacheMaxAgeMs: 1_000,
    });
    const cryptoFetchCount = () =>
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(([input]) =>
        input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH
      ).length;

    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });
    expect(cryptoFetchCount()).toBe(1);

    vi.setSystemTime(new Date(Date.parse(FIXED_NOW) + 500));
    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });
    expect(cryptoFetchCount()).toBe(1);

    vi.setSystemTime(new Date(Date.parse(FIXED_NOW) + 1_001));
    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });
    expect(cryptoFetchCount()).toBe(2);
  });

  it("keeps crypto-context fetch failures fail-closed for version-0 workspaces with a snapshot", async () => {
    const { invoke, runner } = createRunnerCryptoContextHarness(createWorkspaceState({
      snapshotRef: createBundleRef("checkpointed"),
      version: "0",
    }), { cryptoContextStatus: 404 });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "runner-store-refresh",
      status: 404,
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps crypto-context fetch failures fail-closed for nonzero workspace versions with a snapshot", async () => {
    const { invoke, runner } = createRunnerCryptoContextHarness(createWorkspaceState({
      snapshotRef: createBundleRef("checkpointed"),
      version: "1",
    }), { cryptoContextStatus: 404 });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "runner-store-refresh",
      status: 404,
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps crypto-context fetch failures fail-closed for nonzero workspace versions without a snapshot", async () => {
    const { invoke, runner } = createRunnerCryptoContextHarness(createWorkspaceState({
      snapshotRef: null,
      version: "1",
    }), { cryptoContextStatus: 404 });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "runner-store-refresh",
      status: 404,
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops scheduling retry alarms after the configured max event attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      cryptoContextStatus: 403,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      status: 403,
    });

    expect(alarms).toEqual(["2026-04-27T00:00:30.000Z"]);
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:30.000Z",
      retry_failure_count: 1,
    }]);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).not.toHaveBeenCalled();
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      retry_failure_count: 2,
    }]);
    expect(alarms).toEqual(["2026-04-27T00:00:30.000Z"]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          maxEventAttempts: 2,
          retryFailureCount: 2,
        }),
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
        phase: "failed",
        userId: "member_123",
      }),
    );
  });

  it("stops scheduling retry alarms after repeated container invocation failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("Hosted runner container timed out.");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toThrow(
      "Hosted runner container timed out.",
    );
    expect(alarms).toEqual(["2026-04-27T00:00:30.000Z"]);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      retry_failure_count: 2,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          maxEventAttempts: 2,
          retryFailureCount: 2,
        }),
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
        phase: "failed",
        userId: "member_123",
      }),
    );
  });

  it("resets the retry failure counter after a successful invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, setCryptoContextStatus, sql } = createRunnerCryptoContextHarness(null, {
      cryptoContextStatus: 403,
      maxEventAttempts: 3,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      status: 403,
    });
    expect(
      sql.exec(
        "SELECT retry_failure_count FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ retry_failure_count: 1 }]);

    setCryptoContextStatus(200);
    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      retry_failure_count: 0,
    }]);
  });
});

function createRunnerHarness(options: {
  bucket?: {
    delete?(key: string): Promise<void>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(key: string, value: string): Promise<void>;
  };
  cryptoContextStatus?: number;
  runnerContainerNamespace?: HostedExecutionContainerNamespaceLike | null;
} = {}) {
  const sql = createTestSqlStorage();
  const alarms: string[] = [];
  const r2Deletes: string[] = [];
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
  const bucket = options.bucket ?? {
    async delete(key: string) {
      r2Deletes.push(key);
    },
    async get() {
      return null;
    },
    async put() {},
  };
  mockRuntimeCryptoContextWebControl(options.cryptoContextStatus ?? 200);

  return {
    alarms,
    r2Deletes,
    runner: new TestHostedUserRunner(
      {
        storage,
      },
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      bucket,
      TEST_RUNNER_RUNTIME_ENV_SOURCE,
      options.runnerContainerNamespace ?? null,
    ),
    sql,
  };
}

function createRunnerContainerNamespace(
  destroyInstance: HostedExecutionContainerStubLike["destroyInstance"],
): HostedExecutionContainerNamespaceLike {
  return {
    getByName(name: string) {
      expect(name).toBe("member_123");
      return {
        destroyInstance,
        async invoke() {
          throw new Error("Deletion tests should not invoke the runner container.");
        },
        async ownsInternalWorkerProxyToken() {
          return false;
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
  };
}

function createRunnerCryptoContextHarness(
  workspace: HostedWorkspaceState | null,
  options: {
    cryptoContextCacheMaxAgeMs?: number;
    cryptoContextStatus?: number;
    invoke?: ReturnType<typeof vi.fn<HostedExecutionContainerStubLike["invoke"]>>;
    maxEventAttempts?: number;
    usageGateResponse?: Record<string, unknown>;
    usageGateStatus?: number;
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
  let cryptoContextStatus = options.cryptoContextStatus ?? 200;

  mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
    boundUserId?: string;
    path: string;
  }) => {
    if (input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
      if (cryptoContextStatus !== 200) {
        return Response.json({ error: "Unavailable" }, { status: cryptoContextStatus });
      }
      return Response.json({
        ...await createTestHostedRuntimeCryptoContext(input.boundUserId ?? "member_123"),
        ...(options.cryptoContextCacheMaxAgeMs === undefined
          ? {}
          : { cacheMaxAgeMs: options.cryptoContextCacheMaxAgeMs }),
      });
    }

    if (input.path === HOSTED_WEB_USAGE_GATE_PATH) {
      return Response.json(options.usageGateResponse ?? {
        allowed: true,
      }, {
        status: options.usageGateStatus ?? 200,
      });
    }

    if (input.path !== HOSTED_RUNTIME_WORKSPACE_PATH) {
      throw new Error(`Unexpected web control path in runtime crypto context test: ${input.path}`);
    }

    return createWorkspaceReadResponseBody(workspace);
  });

  const runner = new HostedUserRunner(
    {
      storage,
    },
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      ...(options.maxEventAttempts === undefined
        ? {}
        : { HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: String(options.maxEventAttempts) }),
    })),
    new MemoryEncryptedR2Bucket(),
    TEST_RUNNER_RUNTIME_ENV_SOURCE,
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
    setCryptoContextStatus(status: number) {
      cryptoContextStatus = status;
    },
    sql,
  };
}

function mockRuntimeCryptoContextWebControl(status: number): void {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
    boundUserId?: string;
    path: string;
  }) => {
    if (input.path !== HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
      throw new Error(`Unexpected web control path in deletion test: ${input.path}`);
    }

    if (status !== 200) {
      return Response.json({ error: "Unavailable" }, { status });
    }

    return Response.json(await createTestHostedRuntimeCryptoContext(input.boundUserId ?? "member_123"));
  });
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

class ListableMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    const matchingKeys = [...this.objects.keys()]
      .filter((key) => input.prefix ? key.startsWith(input.prefix) : true)
      .sort();
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const limit = input.limit ?? 1_000;
    const pageKeys = matchingKeys.slice(offset, offset + limit);
    const nextOffset = offset + pageKeys.length;
    const truncated = nextOffset < matchingKeys.length;

    return {
      ...(truncated ? { cursor: String(nextOffset) } : {}),
      objects: pageKeys.map((key) => ({ key })),
      truncated,
    };
  }
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
