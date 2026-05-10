import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionStructuredLogRecord,
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedAiUsageAllowDecision,
  HostedRunnerNudgeResult,
  HostedWorkspaceState,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedAiUsageAllowDecisionBody,
  signHostedAiUsageAllowDecision,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.ts";
import {
  resolveHostedExecutionRunnerContainerName,
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
import { RunnerStateStore } from "../src/user-runner/runner-state-store.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestHostedRuntimeCryptoContext } from "./hosted-runtime-crypto-fixtures.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const HOSTED_WEB_USAGE_GATE_PATH = "/api/internal/hosted-execution/usage/gate";
const TEST_RUNNER_RUNTIME_ENV_SOURCE = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-openai-key",
} as const;
const TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE = {
  ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
  CF_VERSION_METADATA: {
    id: "worker-version-current",
  },
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
  public failRunWith: Error | null = null;
  public readonly runCalls: HostedWorkspaceInvocationReason[] = [];

  override async runUntilIdleOrBudget(input: {
    dueWake?: boolean;
    idleCheckpointWorkspaceVersion?: string | null;
    reason: HostedWorkspaceInvocationReason;
  }) {
    this.runCalls.push(input.reason);
    if (this.failRunWith) {
      throw this.failRunWith;
    }
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
    expect(runner.runCalls).toEqual(["nudge"]);
    expect(alarms).toEqual([]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          pendingNudge: true,
          runnerAlarmKind: "work",
          runnerNextWakePresent: false,
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

  it("uses a short fallback alarm when an idle nudge starts an immediate drive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner } = createRunnerHarness();
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();

    expect(alarms[0]).toBe("2026-04-27T00:00:01.000Z");
  });

  it("keeps the first failed immediate nudge retry on the short fallback path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner } = createRunnerHarness();
    await runner.bindUser("member_123");
    runner.failRunWith = new Error("Hosted runner failed before the alarm retry.");

    await runner.nudgeHostedRunner();
    await flushDetachedRunnerDrive();

    expect(runner.runCalls).toEqual(["nudge"]);
    expect(alarms).toEqual([
      "2026-04-27T00:00:01.000Z",
      "2026-04-27T00:00:01.000Z",
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "nudge",
          retryDelayMs: 1000,
        }),
        message: "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.",
        phase: "failed",
        userId: "member_123",
      }),
    );
  });

  it("keeps immediate nudge retry on the short fallback path after the generic cap is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("Hosted runner failed while recording a checkpoint.");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 1,
    });
    await runner.bindUser("member_123");

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await flushDetachedRunnerDrive();

    expect(alarms[0]).toBe("2026-04-27T00:00:01.000Z");
    const retryAlarm = alarms.at(-1);
    expect(Date.parse(retryAlarm ?? "") - Date.parse(FIXED_NOW)).toBeGreaterThanOrEqual(1_000);
    expect(Date.parse(retryAlarm ?? "") - Date.parse(FIXED_NOW)).toBeLessThan(1_100);
    expect(
      sql.exec(
        "SELECT retry_failure_count, next_wake_at FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: retryAlarm,
      retry_failure_count: 1,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "nudge",
          retryDelayMs: 1000,
        }),
        message: "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.",
      }),
    );
  });

  it("preserves nudge retry when a recovered-abort-shaped failure is not durably settled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    runner.failRunWith = new Error("Hosted workspace invocation lost liveness during active work.");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = NULL,
           pending_nudge = 1,
           pending_work = 1
       WHERE user_id = ?`,
      "member_123",
    );

    expect(startDetachedRunnerDriveForTest(runner, {
      aiUsageAllowDecision: null,
      reason: "nudge",
      userId: "member_123",
    })).toBe(true);
    await flushDetachedRunnerDrive();

    expect(runner.runCalls).toEqual(["nudge"]);
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:01.000Z",
      pending_nudge: 1,
      pending_work: 1,
    }]);
  });

  it("backs off failed immediate nudge retries after the first failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("Hosted runner failed after prior nudge retries.");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET retry_failure_count = ? WHERE user_id = ?",
      1,
      "member_123",
    );

    await runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await flushDetachedRunnerDrive();

    expect(alarms[0]).toBe("2026-04-27T00:00:01.000Z");
    expect(Date.parse(alarms[1] ?? "") - Date.parse(FIXED_NOW)).toBeGreaterThanOrEqual(2_000);
    expect(Date.parse(alarms[1] ?? "") - Date.parse(FIXED_NOW)).toBeLessThan(2_100);
    expect(alarms[2]).toBe(alarms[1]);
    expect(
      sql.exec(
        "SELECT retry_failure_count FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ retry_failure_count: 2 }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          reason: "nudge",
          retryDelayMs: 2000,
        }),
        message: "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.",
        phase: "failed",
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

  it("preempts persisted active invocations before deleting user R2 data", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundlePrefix = await hostedBundleUserPrefix({ userId: "member_123" });
    await bucket.put(`${bundlePrefix}bundle.bundle.json`, "bundle");

    const events: string[] = [];
    let sql!: ReturnType<typeof createTestSqlStorage>;
    const destroyInstance = vi.fn(async () => {
      events.push("destroy");
      expect(
        sql.exec(
          "SELECT in_flight, active_invocation_id FROM runner_meta WHERE user_id = ?",
          "member_123",
        ).toArray(),
      ).toEqual([{ active_invocation_id: null, in_flight: 0 }]);
    });
    const harness = createRunnerHarness({
      bucket,
      runnerContainerNamespace: createRunnerContainerNamespace(destroyInstance),
    });
    sql = harness.sql;
    const { runner } = harness;
    bucket.onList = () => {
      events.push("list");
      expect(events[0]).toBe("destroy");
      expect(
        sql.exec(
          "SELECT in_flight, active_invocation_id FROM runner_meta WHERE user_id = ?",
          "member_123",
        ).toArray(),
      ).toEqual([{ active_invocation_id: null, in_flight: 0 }]);
    };

    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET in_flight = 1,
           active_invocation_id = ?,
           active_invocation_reason = ?,
           active_invocation_started_at = ?,
           lease_generation = 1
       WHERE user_id = ?`,
      "workspace-invocation-delete",
      "manual",
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      r2: {
        deletedObjectCount: 1,
        skippedUserScopedPrefixes: false,
        supported: true,
      },
      userId: "member_123",
    });

    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(events[0]).toBe("destroy");
    expect(bucket.objects.has(`${bundlePrefix}bundle.bundle.json`)).toBe(false);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          runnerContainerDestroyOk: true,
          workspaceAttemptId: "workspace-invocation-delete",
        }),
        message: "Hosted runner preempted active invocation before user data deletion.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("does not sweep R2 when active runner container teardown fails during user deletion", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundlePrefix = await hostedBundleUserPrefix({ userId: "member_123" });
    await bucket.put(`${bundlePrefix}bundle.bundle.json`, "bundle");
    bucket.onList = vi.fn();

    const destroyInstance = vi.fn(async () => {
      throw new Error("container still active");
    });
    const { runner, sql } = createRunnerHarness({
      bucket,
      runnerContainerNamespace: createRunnerContainerNamespace(destroyInstance),
    });

    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET in_flight = 1,
           active_invocation_id = ?,
           active_invocation_reason = ?,
           active_invocation_started_at = ?,
           lease_generation = 1
       WHERE user_id = ?`,
      "workspace-invocation-delete-failed",
      "manual",
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.deleteHostedUserData("member_123")).rejects.toThrow(
      "Hosted runner container cleanup failed before user data deletion.",
    );

    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(bucket.onList).not.toHaveBeenCalled();
    expect(bucket.objects.has(`${bundlePrefix}bundle.bundle.json`)).toBe(true);
    expect(sql.exec("SELECT user_id, in_flight, active_invocation_id FROM runner_meta").toArray()).toEqual([
      { active_invocation_id: null, in_flight: 0, user_id: "member_123" },
    ]);
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
      nextAlarmAt: "2026-04-27T00:00:01.100Z",
    });
    expect(alarms).toEqual(["2026-04-27T00:00:01.100Z"]);

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual(["2026-04-27T00:00:01.100Z"]);

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toEqual(expect.arrayContaining([
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:04:00.150Z",
    ]));
  });

  it("starts a fresh nudge follow-up after an active invocation fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeInvocation.promise;
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

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    activeInvocation.reject(new Error("active invocation failed"));

    await expect(activeRun).rejects.toThrow("active invocation failed");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    expect(alarms).not.toContain("2026-04-27T00:00:30.100Z");
  });

  it("times out a live invocation through the owning invocation path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const destroyInstance = vi.fn(async () => {});
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
      runnerTimeoutMs: 1_000,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    void activeRun.catch(() => undefined);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(activeRun).rejects.toThrow(/timeout|aborted/i);
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT in_flight, pending_nudge, retry_failure_count, next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: "2026-04-27T00:00:31.100Z",
      pending_nudge: 0,
      retry_failure_count: 1,
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:00:31.100Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    activeInvocation.reject(new Error("late invocation finished after timeout"));
  });

  it("starts a fresh nudge follow-up when the active invocation releases during nudge alarm application", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    let activeRun: Promise<unknown> | null = null;
    let releasedActiveDuringNudgeAlarm = false;
    const { alarms, runner } = createRunnerCryptoContextHarness(null, {
      invoke,
      onSetAlarm: async ({ scheduledTimeIso }) => {
        if (
          releasedActiveDuringNudgeAlarm
          || scheduledTimeIso !== "2026-04-27T00:00:01.100Z"
        ) {
          return;
        }
        if (!activeRun) {
          throw new Error("Active invocation promise is not available.");
        }
        releasedActiveDuringNudgeAlarm = true;
        activeInvocation.reject(new Error("active invocation failed during nudge"));
        await activeRun.catch(() => {});
      },
    });
    await runner.bindUser("member_123");

    activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    expect(releasedActiveDuringNudgeAlarm).toBe(true);
    await expect(activeRun).rejects.toThrow("active invocation failed during nudge");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    expect(alarms).not.toContain("2026-04-27T00:00:30.100Z");
  });

  it("queues nudge work behind a lower-priority alarm invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const destroyInstance = vi.fn(async () => {});
    const { runner } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(destroyInstance).not.toHaveBeenCalled();
    activeInvocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
  });

  it("lets active deferred alarm work finish when a foreground nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const destroyInstance = vi.fn(async () => {});
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET deferred_checkpoint_required = 1
       WHERE user_id = ?`,
      "member_123",
    );

    const activeRun = runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    expect(destroyInstance).not.toHaveBeenCalled();
    await expect(runner.ownsActiveInvocationLease({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "0",
    })).resolves.toBe(true);

    activeInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      deferredCheckpointRequired: true,
      status: "idle",
    });
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(destroyInstance).not.toHaveBeenCalled();
  });

  it("lets active deferred idle checkpoints finish when a foreground nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("deferred-active"),
      version: "4",
    });
    const activeCheckpoint = createDeferred<{
      idleShutdownCheckpointed: true;
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return activeCheckpoint.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const destroyInstance = vi.fn(async () => {});
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET deferred_checkpoint_required = 1,
           idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    const activeRun = runner.alarm();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    expect(destroyInstance).not.toHaveBeenCalled();
    await expect(runner.ownsActiveInvocationLease({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "4",
    })).resolves.toBe(true);

    activeCheckpoint.resolve({
      idleShutdownCheckpointed: true,
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toBeUndefined();
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(destroyInstance).not.toHaveBeenCalled();
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.100Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      pending_nudge: 0,
    }]);
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
    expect(alarms).toEqual(expect.arrayContaining([
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:04:00.150Z",
    ]));
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

  it("keeps pending nudge follow-up even when deferred checkpoint status catches up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      redactedStatus: Record<string, string>;
      status: "idle";
    }>();
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "41",
        hostedMailboxSystemImportedSeq: "7",
      },
      snapshotRef: createLayeredSnapshotRef("stale-pending-nudge-drained"),
      version: "4",
    });
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      runtimeStatusResponse: {
        mailboxLag: [
          {
            importedSeq: "7",
            lag: "0",
            lane: "system",
            maxSeq: "7",
          },
          {
            importedSeq: "41",
            lag: "1",
            lane: "conversation",
            maxSeq: "42",
          },
        ],
        userId: "member_123",
        workspace,
      },
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    firstInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "42",
        hostedMailboxSystemImportedSeq: "7",
      },
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]));
  });

  it("keeps pending nudge follow-up when effective mailbox lag remains nonzero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      redactedStatus: Record<string, string>;
      status: "idle";
    }>();
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "41",
        hostedMailboxSystemImportedSeq: "7",
      },
      snapshotRef: createLayeredSnapshotRef("stale-pending-nudge-nonzero"),
      version: "4",
    });
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      runtimeStatusResponse: {
        mailboxLag: [
          {
            importedSeq: "7",
            lag: "0",
            lane: "system",
            maxSeq: "7",
          },
          {
            importedSeq: "41",
            lag: "2",
            lane: "conversation",
            maxSeq: "43",
          },
        ],
        userId: "member_123",
        workspace,
      },
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    firstInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "42",
        hostedMailboxSystemImportedSeq: "7",
      },
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]));
  });

  it("keeps pending nudge follow-up when mailbox status omits a lane", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      redactedStatus: Record<string, string>;
      status: "idle";
    }>();
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "41",
        hostedMailboxSystemImportedSeq: "7",
      },
      snapshotRef: createLayeredSnapshotRef("stale-pending-nudge-partial-status"),
      version: "4",
    });
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      runtimeStatusResponse: {
        mailboxLag: [
          {
            importedSeq: "41",
            lag: "1",
            lane: "conversation",
            maxSeq: "42",
          },
        ],
        userId: "member_123",
        workspace,
      },
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    firstInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "42",
        hostedMailboxSystemImportedSeq: "7",
      },
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]));
  });

  it("keeps pending nudge follow-up when mailbox lag status is unknown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      redactedStatus: Record<string, string>;
      status: "idle";
    }>();
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "41",
        hostedMailboxSystemImportedSeq: "7",
      },
      snapshotRef: createLayeredSnapshotRef("stale-pending-nudge-unknown-status"),
      version: "4",
    });
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
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    firstInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "42",
        hostedMailboxSystemImportedSeq: "7",
      },
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]));
  });

  it("keeps pending nudge follow-up without status-read clearing races", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      deferredCheckpointRequired: true;
      nextWakeAt: null;
      redactedStatus: Record<string, string>;
      status: "idle";
    }>();
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "41",
        hostedMailboxSystemImportedSeq: "7",
      },
      snapshotRef: createLayeredSnapshotRef("stale-pending-nudge-newer-generation"),
      version: "4",
    });
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
    let sqlForStatusRead: ReturnType<typeof createTestSqlStorage> | null = null;
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      runtimeStatusResponse: ({ readCount }) => {
        if (readCount !== 1) {
          throw new Error("Unexpected extra hosted runtime status read.");
        }
        if (!sqlForStatusRead) {
          throw new Error("Runner SQL storage was unavailable.");
        }
        sqlForStatusRead.exec(
          `UPDATE runner_meta
           SET pending_nudge = 1,
               pending_nudge_generation = pending_nudge_generation + 1,
               pending_work = 1
           WHERE user_id = ?`,
          "member_123",
        );
        return {
          mailboxLag: [
            {
              importedSeq: "7",
              lag: "0",
              lane: "system",
              maxSeq: "7",
            },
            {
              importedSeq: "41",
              lag: "1",
              lane: "conversation",
              maxSeq: "42",
            },
          ],
          userId: "member_123",
          workspace,
        };
      },
    });
    sqlForStatusRead = sql;
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });

    firstInvocation.resolve({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "42",
        hostedMailboxSystemImportedSeq: "7",
      },
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.100Z");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]));
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
    expect(alarms).toEqual(expect.arrayContaining([
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:00:01.100Z",
      "2026-04-27T00:04:00.150Z",
    ]));
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
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);

    await vi.advanceTimersByTimeAsync(1_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual(expect.arrayContaining([
      "2026-04-27T00:00:01.000Z",
      "2026-04-27T00:00:20.050Z",
    ]));
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

  it("retries a consumed nudge when container readiness stalls before the first heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const stalledInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return stalledInvocation.promise;
      }
      if (invoke.mock.calls.length === 2) {
        return {
          nextWakeAt: null,
          status: "idle" as const,
        };
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
      runnerReadyTimeoutMs: 200,
      runnerTimeoutMs: 60_000,
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(runner.alarm()).resolves.toBeUndefined();
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("aborts stale local active invocations so pending nudges can drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const destroyInstance = vi.fn(async () => {});
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
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    sql.exec(
      `UPDATE runner_meta
       SET active_invocation_last_heartbeat_at = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await vi.advanceTimersByTimeAsync(4_000);
    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(runner.alarm()).resolves.toBeUndefined();
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(destroyInstance).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]));
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          activeWorkspaceInvocationAborted: true,
          pendingNudge: true,
        }),
        message: "Hosted runner cleared stale local invocation so pending nudge can drain.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("anchors the immediate nudge drive in Durable Object waitUntil", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const waitUntil = vi.fn();
    const { invoke, runner } = createRunnerCryptoContextHarness(null, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => invocation.promise),
      waitUntil,
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const drive = waitUntil.mock.calls[0]?.[0];
    expect(drive).toBeInstanceOf(Promise);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(drive).resolves.toBeUndefined();
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
      "2026-04-27T00:00:01.000Z",
      "2026-04-27T00:00:20.050Z",
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

  it("preserves a due idle-shutdown checkpoint while another invocation is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("active-preserves-idle-checkpoint"),
      version: "4",
    });
    const activeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return await activeInvocation.promise;
      }

      return {
        idleShutdownCheckpointed: true,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      runnerTimeoutMs: 10_000,
    });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?,
           next_wake_at = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "2026-04-27T00:01:00.000Z",
      "member_123",
    );

    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    const deferredRows = sql.exec<{
      idle_shutdown_checkpoint_due_at: string | null;
      idle_shutdown_checkpoint_workspace_version: string | null;
      next_wake_at: string | null;
    }>(
      `SELECT idle_shutdown_checkpoint_due_at,
              idle_shutdown_checkpoint_workspace_version,
              next_wake_at
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray();
    expect(deferredRows).toHaveLength(1);
    const deferredRow = deferredRows[0];
    expect(deferredRow?.idle_shutdown_checkpoint_due_at).not.toBeNull();
    expect(deferredRow?.idle_shutdown_checkpoint_workspace_version).toBe("4");
    expect(deferredRow?.next_wake_at).not.toBeNull();
    expect(
      Date.parse(deferredRow?.idle_shutdown_checkpoint_due_at ?? ""),
    ).toBeLessThan(Date.parse(deferredRow?.next_wake_at ?? ""));
    expect(alarms.at(-1)).toBe(deferredRow?.idle_shutdown_checkpoint_due_at);

    vi.setSystemTime(new Date("2026-04-27T00:00:02.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    const activeDeferredRows = sql.exec<{
      idle_shutdown_checkpoint_due_at: string | null;
      idle_shutdown_checkpoint_workspace_version: string | null;
      in_flight: number;
      next_wake_at: string | null;
    }>(
      `SELECT idle_shutdown_checkpoint_due_at,
              idle_shutdown_checkpoint_workspace_version,
              in_flight,
              next_wake_at
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray();
    expect(activeDeferredRows).toHaveLength(1);
    expect(activeDeferredRows[0]?.idle_shutdown_checkpoint_workspace_version).toBe("4");
    expect(activeDeferredRows[0]?.in_flight).toBe(1);
    expect(Date.parse(activeDeferredRows[0]?.idle_shutdown_checkpoint_due_at ?? "")).toBeLessThan(
      Date.parse(activeDeferredRows[0]?.next_wake_at ?? ""),
    );

    activeInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await expect(activeRun).resolves.toMatchObject({ status: "idle" });

    const completedRows = sql.exec<{
      idle_shutdown_checkpoint_due_at: string | null;
      idle_shutdown_checkpoint_workspace_version: string | null;
      in_flight: number;
      next_wake_at: string | null;
    }>(
      `SELECT idle_shutdown_checkpoint_due_at,
              idle_shutdown_checkpoint_workspace_version,
              in_flight,
              next_wake_at
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray();
    expect(completedRows).toHaveLength(1);
    expect(completedRows[0]?.in_flight).toBe(0);
    expect(completedRows[0]?.idle_shutdown_checkpoint_workspace_version).toBe("4");
    expect(Date.parse(completedRows[0]?.idle_shutdown_checkpoint_due_at ?? "")).toBeGreaterThan(
      Date.parse(deferredRow?.idle_shutdown_checkpoint_due_at ?? ""),
    );
    expect(completedRows[0]?.next_wake_at).toBeNull();
    expect(invoke).toHaveBeenCalledOnce();
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

    await vi.advanceTimersByTimeAsync(1_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual([
      "2026-04-27T00:00:01.000Z",
      "2026-04-27T00:00:20.050Z",
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

  it("replays from a durable alarm after cold restore clears an expired active invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("cold-restore-replay"),
      version: "4",
    });
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
        idleShutdownCheckpointed: true,
        nextWakeAt: null,
        status: "idle" as const,
      })),
      runnerTimeoutMs: 1_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_invocation_expires_at = ?,
           active_invocation_id = ?,
           active_invocation_reason = ?,
           active_invocation_started_at = ?,
           active_workspace_version = ?,
           alarm_due_at = ?,
           alarm_kind = ?,
           alarm_workspace_version = ?,
           idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?,
           in_flight = 1,
           lease_generation = 1
       WHERE user_id = ?`,
      "2026-04-27T00:00:01.000Z",
      "workspace-invocation-1",
      "manual",
      FIXED_NOW,
      "4",
      FIXED_NOW,
      "idle_checkpoint",
      "4",
      FIXED_NOW,
      "4",
      "member_123",
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(alarms).toEqual(["deleted"]);
    expect(
      sql.exec(
        `SELECT in_flight,
                active_invocation_id,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      active_invocation_id: null,
      in_flight: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
    }]);
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
      nextWakeAt: "2026-04-27T00:00:20.050Z",
      status: "scheduled",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toEqual(["2026-04-27T00:00:20.050Z"]);
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

    await vi.advanceTimersByTimeAsync(1_000);
    const alarmRun = runner.alarm();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();

    invocation.resolve({
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      status: "idle",
    });

    await expect(alarmRun).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(alarms).toEqual(expect.arrayContaining([
        "2026-04-27T00:00:01.000Z",
        "2026-04-27T00:00:20.050Z",
        "2026-04-27T00:04:01.100Z",
      ]))
    );
  });

  it("retries a newly observed persisted nudge without waiting for orphan grace", async () => {
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

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).not.toContain("2026-04-27T00:00:45.000Z");
    expect(
      sql.exec(
        "SELECT in_flight FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ in_flight: 0 }]);
  });

  it("retries a previous-worker consumed nudge immediately on worker-version mismatch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerReadyTimeoutMs: 20_000,
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        pending_nudge = 0,
        pending_work = 0
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      FIXED_NOW,
      "worker-version-previous",
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]);
  });

  it("clears a previous-worker persisted-only invocation immediately and starts a replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "worker-version-previous",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
    });
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message:
          "Hosted workspace invocation belonged to a previous worker version; clearing stale in-flight state.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });

  it("does not replace a previous-worker invocation with a fresh heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "worker-version-previous",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);
  });

  it("clears a stopped previous-worker invocation even with a fresh heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_container_stopped_at = ?,
        active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "2026-04-26T23:59:55.000Z",
      "workspace-invocation-1",
      "2026-04-26T23:59:59.000Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "worker-version-previous",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
    });
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted workspace invocation container stopped; clearing stale in-flight state.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });

  it("retries a same-worker persisted nudge without live heartbeat evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "worker-version-current",
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).not.toContain("2026-04-27T00:00:45.000Z");
    expect(
      sql.exec(
        "SELECT in_flight FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ in_flight: 0 }]);
  });

  it("treats legacy unstamped active invocations as previous-worker state once version metadata exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = NULL,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
    });
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  });

  it("does not replace a legacy unstamped invocation with a fresh heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = NULL,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);
  });

  it("retries a consumed persisted nudge on the first wake without heartbeat evidence", async () => {
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

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        "SELECT in_flight FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{ in_flight: 0 }]);
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

  it("schedules a short drain continuation when a fresh nudge lands during a persisted active invocation in another isolate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);
    expect(
      sql.exec(
        "SELECT in_flight, next_wake_at, pending_nudge FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 1,
      next_wake_at: "2026-04-27T00:00:01.000Z",
      pending_nudge: 1,
    }]);
  });

  it("does not clear a fresh no-heartbeat invocation before runner readiness can time out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:01.000Z"));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      runnerReadyTimeoutMs: 20_000,
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
      runnerTimeoutMs: 60_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      FIXED_NOW,
      "worker-version-current",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:20.000Z"]);
    expect(
      sql.exec(
        `SELECT active_invocation_id,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      active_invocation_id: "workspace-invocation-1",
      in_flight: 1,
      next_wake_at: "2026-04-27T00:00:20.000Z",
      pending_nudge: 1,
    }]);
  });

  it("retries a consumed persisted nudge after no-heartbeat readiness times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:01.000Z"));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      runnerReadyTimeoutMs: 500,
      runnerRuntimeEnvSource: TEST_VERSIONED_RUNNER_RUNTIME_ENV_SOURCE,
      runnerTimeoutMs: 60_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_invocation_worker_version_id = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-stalled",
      "nudge",
      FIXED_NOW,
      "worker-version-current",
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT active_invocation_id,
                in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      active_invocation_id: null,
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("retries a consumed persisted nudge after the active invocation hard timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:01.000Z"));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      runnerReadyTimeoutMs: 20_000,
      runnerTimeoutMs: 60_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_expires_at = ?,
        active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        pending_nudge = 0,
        pending_work = 0
      WHERE user_id = ?`,
      "2026-04-27T00:00:00.500Z",
      "workspace-invocation-expired",
      "nudge",
      FIXED_NOW,
      "0",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      reason: "alarm",
    })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
    }]);
  });

  it("queues behind a persisted active invocation when a foreground nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const {
      destroyInstanceNames,
      runner,
      sql,
    } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "alarm",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(destroyInstance).not.toHaveBeenCalled();
    await flushDetachedRunnerDrive();
    expect(invoke).not.toHaveBeenCalled();
    expect(destroyInstanceNames).toEqual([]);
    expect(
      sql.exec(
        `SELECT
          active_invocation_id,
          active_invocation_reason,
          in_flight,
          pending_nudge
        FROM runner_meta
        WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      active_invocation_id: "workspace-invocation-1",
      active_invocation_reason: "alarm",
      in_flight: 1,
      pending_nudge: 1,
    }]);
  });

  it("preserves persisted deferred idle checkpoints when a foreground nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        deferred_checkpoint_required = 1,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "idle_shutdown_checkpoint",
      "2026-04-26T23:59:30.000Z",
      "4",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });

    expect(destroyInstance).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);
    await expect(runner.ownsActiveInvocationLease({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "4",
    })).resolves.toBe(true);
    expect(
      sql.exec(
        `SELECT
          active_invocation_id,
          active_invocation_reason,
          deferred_checkpoint_required,
          in_flight,
          pending_nudge
        FROM runner_meta
        WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      active_invocation_id: "workspace-invocation-1",
      active_invocation_reason: "idle_shutdown_checkpoint",
      deferred_checkpoint_required: 1,
      in_flight: 1,
      pending_nudge: 1,
    }]);
  });

  it("resets exhausted retries when a fresh nudge waits behind another isolate invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        last_error_at = ?,
        last_error_code = ?,
        lease_generation = 1,
        retry_failure_count = 2
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "2026-04-26T23:59:58.000Z",
      "HostedExecutionRuntimeError",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:01.000Z"]);
    expect(
      sql.exec(
        `SELECT in_flight,
                last_error_at,
                last_error_code,
                next_wake_at,
                pending_nudge,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 1,
      last_error_at: null,
      last_error_code: null,
      next_wake_at: "2026-04-27T00:00:01.000Z",
      pending_nudge: 1,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          alreadyRunning: true,
          retryFailureCountReset: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );

    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = NULL,
        active_invocation_expires_at = NULL,
        active_invocation_last_heartbeat_at = NULL,
        active_invocation_orphan_observed_at = NULL,
        active_invocation_reason = NULL,
        active_invocation_started_at = NULL,
        active_workspace_version = NULL,
        in_flight = 0
      WHERE user_id = ?`,
      "member_123",
    );
    vi.setSystemTime(new Date("2026-04-27T00:00:01.000Z"));

    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT in_flight,
                next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("moves persisted pending nudges to recovery while another isolate is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_last_heartbeat_at = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "2026-04-26T23:59:59.500Z",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      FIXED_NOW,
      "member_123",
    );

    await runner.alarm();

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms).toEqual(["2026-04-27T00:00:02.500Z"]);
    expect(
      sql.exec(
        "SELECT in_flight, next_wake_at, pending_nudge FROM runner_meta WHERE user_id = ?",
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 1,
      next_wake_at: "2026-04-27T00:00:02.500Z",
      pending_nudge: 1,
    }]);
  });

  it("keeps a pending nudge on recovery when lease liveness clears orphan observation", async () => {
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
      "2026-04-27T00:00:03.000Z",
      "member_123",
    );

    await expect(runner.ownsActiveInvocationLease({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "0",
    })).resolves.toBe(true);

    expect(alarms).toEqual(["2026-04-27T00:00:03.000Z"]);
  });

  it("keeps a pending nudge on recovery when checkpoint liveness clears orphan observation", async () => {
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
      "2026-04-27T00:00:03.000Z",
      "member_123",
    );

    await expect(runner.recordActiveInvocationWorkspaceCheckpoint({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
      workspaceVersion: "1",
    })).resolves.toEqual({ recorded: true });

    expect(alarms).toEqual(["2026-04-27T00:00:03.000Z"]);
  });

  it("records container stop liveness and schedules immediate recovery for a consumed nudge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await expect(runner.recordActiveInvocationContainerStopped({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      stoppedAt: "2026-04-26T23:59:55.000Z",
      userId: "member_123",
    })).resolves.toEqual({ recorded: true });

    expect(alarms).toEqual(["2026-04-27T00:00:00.000Z"]);
    expect(sql.exec(
      `SELECT active_invocation_container_stopped_at,
              active_invocation_id,
              in_flight,
              pending_nudge,
              pending_work
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray()).toEqual([{
      active_invocation_container_stopped_at: "2026-04-26T23:59:55.000Z",
      active_invocation_id: "workspace-invocation-1",
      in_flight: 1,
      pending_nudge: 1,
      pending_work: 1,
    }]);
  });

  it("clears a stopped consumed nudge back onto the nudge path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_container_stopped_at = ?,
        active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        pending_nudge = 0,
        pending_work = 0
      WHERE user_id = ?`,
      "2026-04-26T23:59:55.000Z",
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "member_123",
    );

    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted workspace invocation container stopped; clearing stale in-flight state.",
        phase: "wake.running",
        userId: "member_123",
      }),
    );
  });

  it("aborts the local container wait when the active nudge container stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return await firstInvocation.promise;
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, { invoke });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    const firstRequest = invoke.mock.calls[0]?.[0].job.request;
    if (!firstRequest) {
      throw new Error("Expected the first hosted runner invocation request.");
    }
    await expect(runner.recordActiveInvocationContainerStopped({
      attemptId: firstRequest.attemptId,
      leaseGeneration: firstRequest.leaseGeneration,
      stoppedAt: "2026-04-26T23:59:55.000Z",
      userId: "member_123",
    })).resolves.toEqual({ recorded: true });
    await flushDetachedRunnerDrive();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await flushDetachedRunnerDrive();

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]));
  });

  it("records container stop liveness without pushing pending recovery to orphan grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1,
        pending_work = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      "2026-04-27T00:00:03.000Z",
      "member_123",
    );

    await expect(runner.recordActiveInvocationContainerStopped({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      stoppedAt: "2026-04-26T23:59:55.000Z",
      userId: "member_123",
    })).resolves.toEqual({ recorded: true });

    expect(alarms).toEqual(["2026-04-27T00:00:00.000Z"]);
    expect(sql.exec(
      `SELECT active_invocation_container_stopped_at,
              active_invocation_id,
              in_flight,
              pending_nudge,
              pending_work
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray()).toEqual([{
      active_invocation_container_stopped_at: "2026-04-26T23:59:55.000Z",
      active_invocation_id: "workspace-invocation-1",
      in_flight: 1,
      pending_nudge: 1,
      pending_work: 1,
    }]);
  });

  it("records heartbeat liveness without keeping pending work on the short drain continuation", async () => {
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
      nextAlarmAt: "2026-04-27T00:00:03.000Z",
      ok: true,
      pendingNudge: true,
    });

    expect(alarms).toEqual(["2026-04-27T00:00:03.000Z"]);
  });

  it("clears a due idle checkpoint when heartbeat liveness preserves pending nudge recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
      SET active_invocation_id = ?,
        active_invocation_reason = ?,
        active_invocation_started_at = ?,
        active_workspace_version = ?,
        idle_shutdown_checkpoint_due_at = ?,
        idle_shutdown_checkpoint_workspace_version = ?,
        in_flight = 1,
        lease_generation = 1,
        next_wake_at = ?,
        pending_nudge = 1
      WHERE user_id = ?`,
      "workspace-invocation-1",
      "nudge",
      "2026-04-26T23:59:30.000Z",
      "0",
      FIXED_NOW,
      "0",
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.recordActiveInvocationHeartbeat({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
    })).resolves.toEqual({
      inputAvailable: true,
      nextAlarmAt: "2026-04-27T00:00:03.000Z",
      ok: true,
      pendingNudge: true,
    });

    expect(alarms).toEqual(["2026-04-27T00:00:03.000Z"]);
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                next_wake_at,
                pending_nudge
        FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      next_wake_at: "2026-04-27T00:00:03.000Z",
      pending_nudge: 1,
    }]);
  });

  it("clears a persisted-only invocation after the last heartbeat goes stale and starts a replacement", async () => {
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
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
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

  it("does not call the live web AI usage gate before manual invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { alarms, invoke, runner } = createRunnerCryptoContextHarness(null, {
      usageGateResponse: {
        allowed: false,
        noticeCode: "pulse_upgrade_edge",
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
        userNotice:
          "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toEqual({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).not.toContain("2026-05-01T00:00:00.000Z");
    const usageGateCall = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .find(([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH);
    expect(usageGateCall).toBeUndefined();
  });

  it("skips the live web AI usage gate when a fresh signed allow decision is valid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const decision = await createTestAiUsageAllowDecision({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      secret: "test-ai-usage-allow-secret",
      userId: "member_123",
    });
    const { invoke, runner } = createRunnerCryptoContextHarness(null, {
      aiUsageAllowSigningSecret: "test-ai-usage-allow-secret",
      usageGateResponse: {
        allowed: false,
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({
      aiUsageAllowDecision: decision,
      reason: "manual",
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.some(
        ([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH,
      ),
    ).toBe(false);
  });

  it("does not fall back to the live web AI usage gate when signed allow decisions are invalid or reused", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const decision = await createTestAiUsageAllowDecision({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
      secret: "test-ai-usage-allow-secret",
      userId: "member_123",
    });
    const invalidSignatureDecision = await createTestAiUsageAllowDecision({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      nonce: "invalid-signature-nonce-00000001",
      secret: "other-secret",
      userId: "member_123",
    });
    const wrongUserDecision = await createTestAiUsageAllowDecision({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      nonce: "wrong-user-nonce-000000000001",
      secret: "test-ai-usage-allow-secret",
      userId: "member_other",
    });
    const { invoke, runner } = createRunnerCryptoContextHarness(null, {
      aiUsageAllowSigningSecret: "test-ai-usage-allow-secret",
      usageGateResponse: {
        allowed: false,
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({
      aiUsageAllowDecision: decision,
      reason: "manual",
    })).resolves.toMatchObject({
      status: "idle",
    });
    await expect(runner.runUntilIdleOrBudget({
      aiUsageAllowDecision: decision,
      reason: "manual",
    })).resolves.toMatchObject({
      status: "idle",
    });
    await expect(runner.runUntilIdleOrBudget({
      aiUsageAllowDecision: invalidSignatureDecision,
      reason: "manual",
    })).resolves.toMatchObject({
      status: "idle",
    });
    await expect(runner.runUntilIdleOrBudget({
      aiUsageAllowDecision: wrongUserDecision,
      reason: "manual",
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.some(
        ([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH,
      ),
    ).toBe(false);
  });

  it("carries a fresh signed allow decision from nudge into the detached runner drive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const decision = await createTestAiUsageAllowDecision({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      secret: "test-ai-usage-allow-secret",
      userId: "member_123",
    });
    const { invoke, runner } = createRunnerCryptoContextHarness(null, {
      aiUsageAllowSigningSecret: "test-ai-usage-allow-secret",
      usageGateResponse: {
        allowed: false,
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner({
      aiUsageAllowDecision: decision,
    })).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await flushDetachedRunnerDrive();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.some(
        ([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH,
      ),
    ).toBe(false);
  });

  it("does not ask the live web AI usage gate before draining a pending nudge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null, {
      usageGateResponse: {
        allowed: false,
        noticeCode: "pulse_upgrade_edge",
        reason: "ai_usage_limit_exceeded",
        retryAfter: "2026-05-01T00:00:00.000Z",
        userNotice:
          "Hey, you've reached your usage limit for the month. Upgrade to Edge: https://withmurph.ai/home",
      },
    });
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET pending_nudge = 1 WHERE user_id = ?",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    const usageGateCall = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .find(([input]) => input.path === HOSTED_WEB_USAGE_GATE_PATH);
    expect(usageGateCall).toBeUndefined();
  });

  it("treats direct retry recovery with a pending nudge as a nudge invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(null);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 1
       WHERE user_id = ?`,
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "retry" })).resolves.toMatchObject({
      nextWakeAt: null,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(sql.exec(
      `SELECT pending_nudge,
              pending_work,
              retry_failure_count
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray()).toEqual([{
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
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

  it("lets a fresh nudge restart work after retry attempts are exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length <= 2) {
        throw new Error("Hosted runner container timed out.");
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toThrow(
      "Hosted runner container timed out.",
    );
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

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      alreadyRunning: false,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    await flushDetachedRunnerDrive();

    expect(
      sql.exec(
        `SELECT in_flight,
                next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          retryFailureCountReset: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("queues pending nudge continuation when an active invocation fails at the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    let markPendingNudgeDuringInvocation: (() => void) | null = null;
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        markPendingNudgeDuringInvocation?.();
        throw new Error("workspace invocation container stopped during active work");
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    markPendingNudgeDuringInvocation = () => {
      sql.exec(
        `UPDATE runner_meta
         SET pending_nudge = 1,
             pending_work = 1,
             retry_failure_count = 2
         WHERE user_id = ?`,
        "member_123",
      );
    };

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toThrow(
      "workspace invocation container stopped during active work",
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await flushDetachedRunnerDrive();

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT in_flight,
                next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
      }),
    );
  });

  it("re-reads pending nudges that arrive while an invocation failure is being persisted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        throw new Error("workspace invocation container stopped during active work");
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    const stateStore = getRunnerStateStoreForTest(runner);
    const originalFailInvocation = stateStore.failInvocation.bind(stateStore);
    stateStore.failInvocation = async (input) => {
      const result = await originalFailInvocation(input);
      sql.exec(
        `UPDATE runner_meta
         SET next_wake_at = ?,
             pending_nudge = 1,
             pending_work = 1,
             retry_failure_count = 2
         WHERE user_id = ?`,
        "2026-04-27T00:05:00.000Z",
        "member_123",
      );
      return {
        ...result,
        record: {
          ...result.record,
          nextWakeAt: null,
          pendingNudge: false,
          pendingWork: false,
        },
      };
    };

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).rejects.toThrow(
      "workspace invocation container stopped during active work",
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await flushDetachedRunnerDrive();

    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(alarms).not.toContain("2026-04-27T00:00:30.000Z");
    expect(
      sql.exec(
        `SELECT in_flight,
                next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("keeps alarm failure retry scheduling from overwriting pending nudge recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const nudgeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        throw new Error("workspace invocation container stopped during alarm work");
      }
      if (invoke.mock.calls.length === 2) {
        return nudgeInvocation.promise;
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 0,
           pending_work = 0,
           retry_failure_count = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );
    const stateStore = getRunnerStateStoreForTest(runner);
    const originalFailInvocation = stateStore.failInvocation.bind(stateStore);
    stateStore.failInvocation = async (input) => {
      const result = await originalFailInvocation(input);
      sql.exec(
        `UPDATE runner_meta
         SET next_wake_at = ?,
             pending_nudge = 1,
             pending_work = 1,
             retry_failure_count = 2
         WHERE user_id = ?`,
        "2026-04-27T00:05:00.000Z",
        "member_123",
      );
      return {
        ...result,
        record: {
          ...result.record,
          nextWakeAt: null,
          pendingNudge: false,
          pendingWork: false,
        },
      };
    };

    await runner.alarm();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("alarm");
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(alarms).not.toContain("2026-04-27T00:00:30.000Z");
    expect(alarms).not.toContain("2026-04-27T00:05:00.000Z");
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
      }),
    );

    nudgeInvocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await flushDetachedRunnerDrive();
    await vi.waitFor(() => expect(
      sql.exec(
        `SELECT in_flight,
                next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]));
  });

  it("keeps failed pending nudge retries on the nudge path instead of exhausting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length <= 2) {
        throw new Error("workspace invocation container stopped during active work");
      }
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 4,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:02.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 2,
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:00:02.000Z"));
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:06.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 3,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
      }),
    );

    vi.setSystemTime(new Date("2026-04-27T00:00:06.000Z"));
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls[2]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toEqual(expect.arrayContaining([
      "2026-04-27T00:00:02.000Z",
      "2026-04-27T00:00:06.000Z",
      "2026-04-27T00:04:06.000Z",
    ]));
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("keeps exhausted pending nudge retries on the nudge path without clearing pending work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("workspace invocation container stopped during active work");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:02.000Z");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:02.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 2,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner pending nudge retry attempts exhausted; throttling retry while waiting for a fresh nudge.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
      }),
    );
  });

  it("caps direct nudge failure retry to the quick nudge backoff even when configured retry delay is higher", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("workspace invocation container stopped during active work");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
      retryDelayMs: 600_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toThrow(
      "workspace invocation container stopped during active work",
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:00:02.000Z");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:02.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 2,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner pending nudge retry attempts exhausted; throttling retry while waiting for a fresh nudge.",
      }),
    );
  });

  it("caps repeated nudge failure retry below generic-scale delays", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("workspace invocation container stopped during active work");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 10,
      retryDelayMs: 600_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 8
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toThrow(
      "workspace invocation container stopped during active work",
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:00:08.000Z");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:08.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 9,
    }]);
  });

  it("shortens stale persisted pending-nudge retry alarms to the bounded nudge wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      maxEventAttempts: 10,
      retryDelayMs: 600_000,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 8
       WHERE user_id = ?`,
      "2026-04-27T00:05:00.000Z",
      "member_123",
    );

    await preservePendingNudgeRetryAfterFailureForTest(runner);

    expect(alarms).toContain("2026-04-27T00:00:08.000Z");
    expect(alarms).not.toContain("2026-04-27T00:05:00.000Z");
    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: "2026-04-27T00:00:08.000Z",
      pending_nudge: 1,
      pending_work: 1,
      retry_failure_count: 8,
    }]);
  });

  it("logs metadata-only diagnostics for invalid runner invocation requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invalidRequestError = createInvalidRunnerRequestError();
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw invalidRequestError;
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({ reason: "nudge" })).rejects.toThrow(
      "Invalid request.",
    );

    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted runner workspace invocation failed.");
    if (!failureLogInput) {
      throw new Error("Expected hosted runner failure log input.");
    }
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          detailsKeys: expect.arrayContaining([
            "errorCode",
            "errorCodeDetail",
            "errorDetail",
            "errorMessage",
            "errorName",
            "errorStatus",
          ]),
          errorCode: "invalid_request",
          errorCodeDetail: "type_error",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
          errorName: "TypeError",
          errorStatus: 400,
          pendingNudgePresent: true,
          retryFailureCount: 1,
          workspaceAttemptId: expect.any(String),
          workspaceLeaseGeneration: "1",
          workspaceReason: "nudge",
          workspaceVersion: "0",
        }),
        level: "warn",
        message: "Hosted runner workspace invocation failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
    expect(failureLogInput).not.toHaveProperty("error");

    const builtFailureLog = buildHostedExecutionStructuredLogRecord(failureLogInput);
    expect(builtFailureLog.details).toEqual(
      expect.objectContaining({
        errorDetailPresent: true,
        errorMessage: "Hosted execution rejected an invalid request.",
      }),
    );
    expect(builtFailureLog.details).not.toHaveProperty("errorDetail");
    expect(JSON.stringify(builtFailureLog)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(builtFailureLog)).not.toContain("runtime.userEnv");
  });

  it("keeps detached invalid runner request wrapper logs metadata-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw createInvalidRunnerRequestError();
    });
    const { runner } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await flushDetachedRunnerDrive();

    const immediateFailureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input?.message === "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled."
      );
    if (!immediateFailureLogInput) {
      throw new Error("Expected immediate runner drive failure log input.");
    }
    expect(immediateFailureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
          reason: "nudge",
          retryDelayMs: 1000,
        }),
        level: "warn",
      }),
    );
    expect(immediateFailureLogInput).not.toHaveProperty("error");
    expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("keeps alarm invalid runner request wrapper logs metadata-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw createInvalidRunnerRequestError();
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 0,
           pending_work = 0
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await runner.alarm();

    const alarmFailureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted wake nudge failed; scheduling a retry.");
    if (!alarmFailureLogInput) {
      throw new Error("Expected alarm failure log input.");
    }
    expect(alarmFailureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
        }),
        level: "warn",
      }),
    );
    expect(alarmFailureLogInput).not.toHaveProperty("error");
    expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("keeps pending-nudge alarm invalid runner request wrapper logs metadata-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw createInvalidRunnerRequestError();
    });
    const { runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1
       WHERE user_id = ?`,
      FIXED_NOW,
      "member_123",
    );

    await runner.alarm();

    const alarmFailureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input?.message === "Hosted wake nudge failed; pending nudge retry remains scheduled."
      );
    if (!alarmFailureLogInput) {
      throw new Error("Expected pending nudge alarm failure log input.");
    }
    expect(alarmFailureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
        }),
        level: "warn",
      }),
    );
    expect(alarmFailureLogInput).not.toHaveProperty("error");
    expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("keeps idle-checkpoint alarm invalid runner request wrapper logs metadata-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-invalid-request"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw createInvalidRunnerRequestError();
    });
    const { runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    const alarmFailureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input?.message
          === "Hosted idle-shutdown checkpoint alarm failed; preserving idle checkpoint retry state."
      );
    if (!alarmFailureLogInput) {
      throw new Error("Expected idle checkpoint alarm failure log input.");
    }
    expect(alarmFailureLogInput).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
        }),
        level: "warn",
      }),
    );
    expect(alarmFailureLogInput).not.toHaveProperty("error");
    expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("resets exhausted throttled pending nudge retries when a fresh nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      invoke,
      maxEventAttempts: 2,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET next_wake_at = ?,
           pending_nudge = 1,
           pending_work = 1,
           retry_failure_count = 2
       WHERE user_id = ?`,
      "2026-04-27T00:05:00.000Z",
      "member_123",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alreadyRunning: false,
      immediateDriveStarted: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          retryFailureCountReset: true,
        }),
        message: "Hosted runner nudge accepted.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
    await flushDetachedRunnerDrive();

    expect(
      sql.exec(
        `SELECT next_wake_at,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      next_wake_at: null,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
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

  it("schedules one idle-shutdown checkpoint after a successful idle drain with hot state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-schedule"),
      version: "4",
    });
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace);
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
    }]);
  });

  it("schedules lifecycle idle-shutdown checkpoint even when the workspace is already base-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("base-only"),
      version: "4",
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace);
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at, idle_shutdown_checkpoint_workspace_version
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
    }]);
  });

  it("runs a lifecycle idle-shutdown checkpoint on a base-only workspace with deferred mailbox status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "444",
        hostedMailboxFetchedCount: 0,
        hostedMailboxImportedCount: 0,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      },
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      snapshotRef: createBundleRef("base-only-deferred-mailbox"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: null,
          redactedStatus: {
            hostedMailboxBlockedCount: 0,
            hostedMailboxConversationImportedSeq: "445",
            hostedMailboxFetchedCount: 1,
            hostedMailboxImportedCount: 1,
            hostedMailboxRetryableBlockedCount: 0,
            hostedMailboxSystemImportedSeq: "0",
          },
          status: "idle" as const,
        };
      }

      return {
        idleShutdownCheckpointed: true,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("manual");
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
    }]);
    const deferredMailboxStatusRows = sql.exec<{
      deferred_checkpoint_mailbox_status_json: string | null;
    }>(
      `SELECT deferred_checkpoint_mailbox_status_json
       FROM runner_meta WHERE user_id = ?`,
      "member_123",
    ).toArray();
    expect(deferredMailboxStatusRows).toHaveLength(1);
    expect(deferredMailboxStatusRows[0]?.deferred_checkpoint_mailbox_status_json).toBe(JSON.stringify({
      hostedMailboxSystemImportedSeq: "0",
      hostedMailboxConversationImportedSeq: "445",
    }));

    vi.setSystemTime(new Date("2026-04-27T00:04:00.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(invoke.mock.calls[1]?.[0].job.request.checkpointNextWakeAt).toBeNull();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                deferred_checkpoint_mailbox_status_json,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_mailbox_status_json: null,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
    }]);
  });

  it("keeps a lifecycle checkpoint alarm before the first workspace row exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: null,
          status: "idle" as const,
        };
      }

      return {
        idleShutdownCheckpointed: true,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(null, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.workspaceVersion).toBe("0");
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "0",
      next_wake_at: null,
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:04:00.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(invoke.mock.calls[1]?.[0].job.request.workspaceVersion).toBe("0");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: null,
    }]);
  });

  it("schedules lifecycle checkpoint without persisting deprecated deferred checkpoint state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("base-only-schedule-failure"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      deferredCheckpointRequired: true,
      nextWakeAt: null,
      status: "idle" as const,
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      onWorkspaceRead({ readCount }) {
        if (readCount === 2) {
          throw new Error("synthetic workspace status failure");
        }
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      deferredCheckpointRequired: true,
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
    }]);
  });

  it("keeps budget-exhausted work on the retry wake instead of running a 1s checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("base-only-sticky-deferred"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: "2026-04-27T00:01:00.000Z",
          status: "budget_exhausted" as const,
        };
      }

      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "budget_exhausted",
    });
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: "2026-04-27T00:01:00.000Z",
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:01:05.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("alarm");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:05:05.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
    }]);
  });

  it("keeps a short non-idle workspace wake instead of running a 1s checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("base-only-short-non-idle-wake"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: "2026-04-27T00:01:00.000Z",
          status: "scheduled" as const,
        };
      }

      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "scheduled",
    });
    expect(alarms).toContain("2026-04-27T00:01:00.000Z");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: "2026-04-27T00:01:00.000Z",
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:01:00.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("alarm");
  });

  it("schedules a lifecycle checkpoint before a later non-idle workspace wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("base-only-non-idle-later-wake"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: "2026-04-27T00:10:00.000Z",
          status: "scheduled" as const,
        };
      }

      return {
        idleShutdownCheckpointed: true,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: "2026-04-27T00:10:00.000Z",
    }]);

    vi.setSystemTime(new Date("2026-04-27T00:04:00.000Z"));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(invoke.mock.calls[1]?.[0].job.request.checkpointNextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: "2026-04-27T00:10:00.000Z",
    }]);
  });

  it("keeps an existing workspace wake instead of scheduling an idle-shutdown checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      nextWakeAt: "2026-04-27T00:01:30.000Z",
      snapshotRef: createLayeredSnapshotRef("idle-existing-wake"),
      version: "4",
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
        nextWakeAt: "2026-04-27T00:01:30.000Z",
        status: "idle",
      })),
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(alarms).toContain("2026-04-27T00:01:30.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: "2026-04-27T00:01:30.000Z",
    }]);
  });

  it("schedules idle-shutdown checkpoint before a later workspace wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      snapshotRef: createLayeredSnapshotRef("idle-before-later-wake"),
      version: "4",
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke: vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
        nextWakeAt: "2026-04-27T00:10:00.000Z",
        status: "idle",
      })),
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: "2026-04-27T00:10:00.000Z",
    }]);
  });

  it("clears a pending idle-shutdown checkpoint when a new nudge arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerCryptoContextHarness(createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("nudge-clears"),
      version: "4",
    }));
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      "2026-04-27T00:04:00.000Z",
      "4",
      "member_123",
    );

    await runner.nudgeHostedRunner();

    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at, idle_shutdown_checkpoint_workspace_version
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
    }]);
  });

	  it("runs due idle-shutdown checkpoints without calling the hosted AI usage gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-run"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const idleInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      idleShutdownCheckpointed: true,
      status: "idle",
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke: idleInvoke,
      usageGateStatus: 500,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    expect(idleInvoke).toHaveBeenCalledOnce();
    expect(idleInvoke.mock.calls[0]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms).toContain("deleted");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: null,
      pending_nudge: 0,
    }]);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: HOSTED_WEB_USAGE_GATE_PATH,
      }),
    );
  });

  it("runs due idle-shutdown checkpoint before a later workspace wake and preserves the wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      snapshotRef: createLayeredSnapshotRef("idle-run-before-later-wake"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const idleInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      idleShutdownCheckpointed: true,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "idle",
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke: idleInvoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?,
           next_wake_at = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "2026-04-27T00:10:00.000Z",
      "member_123",
    );

    await runner.alarm();

    expect(idleInvoke).toHaveBeenCalledOnce();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBe("2026-04-27T00:10:00.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: "2026-04-27T00:10:00.000Z",
      pending_nudge: 0,
    }]);
  });

  it("lets an already-due workspace wake preempt an idle-shutdown checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      nextWakeAt: FIXED_NOW,
      snapshotRef: createLayeredSnapshotRef("idle-run-before-due-wake"),
      version: "4",
    });
    const idleInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle",
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke: idleInvoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET deferred_checkpoint_required = 1,
           idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?,
           next_wake_at = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      FIXED_NOW,
      "member_123",
    );

    await runner.alarm();

    expect(idleInvoke).not.toHaveBeenCalled();
    expect(alarms.at(-1)).toBe(FIXED_NOW);
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: FIXED_NOW,
      pending_nudge: 0,
    }]);
  });

  it("keeps an already-due workspace wake instead of scheduling a deferred checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      nextWakeAt: FIXED_NOW,
      snapshotRef: createLayeredSnapshotRef("deferred-idle-before-due-wake"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: FIXED_NOW,
          status: "scheduled" as const,
        };
      }

      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(alarms).toContain(FIXED_NOW);
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: FIXED_NOW,
    }]);

    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("alarm");
    expect(
      sql.exec(
        `SELECT deferred_checkpoint_required,
                idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      deferred_checkpoint_required: 0,
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
    }]);
  });

  it("does not retry a committed idle-shutdown checkpoint when cleanup alarm deletion fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-cleanup-delete-fail"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const idleInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      idleShutdownCheckpointed: true,
      status: "idle",
    }));
    const cleanupError = new Error("alarm delete unavailable after checkpoint");
    const { runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke: idleInvoke,
      onDeleteAlarm: () => {
        throw cleanupError;
      },
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await expect(runner.runUntilIdleOrBudget({
      dueWake: true,
      idleCheckpointWorkspaceVersion: "4",
      reason: "idle_shutdown_checkpoint",
    })).resolves.toMatchObject({
      idleShutdownCheckpointed: true,
      status: "idle",
    });

    expect(idleInvoke).toHaveBeenCalledOnce();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                last_error_code,
                next_wake_at,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      last_error_code: null,
      next_wake_at: null,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        error: cleanupError,
        level: "warn",
        message: "Hosted idle-shutdown checkpoint committed but cleanup failed.",
      }),
    );
  });

  it("does not schedule a normal drain when post-checkpoint container destroy fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-cleanup-destroy-fail"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {
      throw new Error("destroy unavailable after checkpoint");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await expect(
      runner["finishIdleShutdownCheckpoint"]({
        preferredWakeAt: null,
        userId: "member_123",
      }),
    ).resolves.toBeUndefined();

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBe("deleted");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                last_error_code,
                next_wake_at,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      last_error_code: null,
      next_wake_at: null,
      retry_failure_count: 0,
    }]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          destroyOk: false,
        }),
        level: "warn",
        message: "Hosted runner completed idle-shutdown checkpoint container cleanup.",
      }),
    );
  });

  it("destroys the warm container when the idle-shutdown runtime only returns scheduled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-scheduled"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: "2026-04-27T00:00:45.000Z",
      status: "scheduled",
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:45.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: "2026-04-27T00:00:45.000Z",
      pending_nudge: 0,
    }]);
  });

  it("destroys the warm container for an inconsistent checkpoint marker result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-inconsistent-marker"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      idleShutdownCheckpointed: true,
      nextWakeAt: "2026-04-27T00:00:45.000Z",
      status: "scheduled",
    }));
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    expect(invoke).toHaveBeenCalledOnce();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:45.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                in_flight,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      in_flight: 0,
      next_wake_at: "2026-04-27T00:00:45.000Z",
      pending_nudge: 0,
    }]);
  });

  it("preserves a pending nudge alarm when work arrives during idle checkpoint cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-cleanup-race"),
      version: "4",
    });
    let runner!: HostedUserRunner;
    const destroyInstance = vi.fn(async () => {
      await runner.nudgeHostedRunner();
    });
    const idleInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      idleShutdownCheckpointed: true,
      status: "idle",
    }));
    const harness = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke: idleInvoke,
    });
    ({ runner } = harness);
    const { alarms, sql } = harness;
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    expect(idleInvoke).toHaveBeenCalledOnce();
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect([
      "2026-04-27T00:00:00.000Z",
      "2026-04-27T00:00:01.000Z",
    ]).toContain(alarms.at(-1));
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      next_wake_at: "2026-04-27T00:00:01.000Z",
      pending_nudge: 1,
    }]);
  });

  it("starts a follow-up drive when an external nudge appears after an idle checkpoint result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-result-external-nudge"),
      version: "4",
    });
    let markExternalPendingNudge = () => {};
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        markExternalPendingNudge();
      }
      return {
        status: "idle",
      };
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
    });
    markExternalPendingNudge = () => {
      sql.exec(
        `UPDATE runner_meta
         SET pending_nudge = 1,
             next_wake_at = ?
         WHERE user_id = ?`,
        FIXED_NOW,
        "member_123",
      );
    };
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();
    await flushDetachedRunnerDrive();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
    }]);
  });

  it("does not destroy the runner when pending work appears during failed idle checkpoint cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-failure-pending-nudge"),
      version: "4",
    });
    const nudgeInvocation = createDeferred<{
      nextWakeAt: null;
      status: "idle";
    }>();
    let markExternalPendingNudge = () => {};
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        markExternalPendingNudge();
        throw new Error("idle checkpoint failed while pending work arrived");
      }
      if (invoke.mock.calls.length === 2) {
        return nudgeInvocation.promise;
      }
      throw new Error("Unexpected extra workspace invocation.");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    markExternalPendingNudge = () => {
      sql.exec(
        `UPDATE runner_meta
         SET pending_nudge = 1,
             pending_work = 1
         WHERE user_id = ?`,
        "member_123",
      );
    };
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(destroyInstance).not.toHaveBeenCalled();
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        message: "Hosted idle-shutdown checkpoint failure cleanup yielded to pending work.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );

    nudgeInvocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await flushDetachedRunnerDrive();
    expect(
      sql.exec(
        `SELECT in_flight,
                pending_nudge,
                pending_work,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      pending_nudge: 0,
      pending_work: 0,
      retry_failure_count: 0,
    }]);
  });

  it("skips an idle-shutdown checkpoint when a nudge arrives after preflight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-race"),
      version: "4",
    });
    let runnerForReentrantNudge: HostedUserRunner | null = null;
    let reentrantNudge: HostedRunnerNudgeResult | null = null;
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      onWorkspaceRead: async ({ readCount }) => {
        if (readCount !== 1) {
          return;
        }
        if (!runnerForReentrantNudge) {
          throw new Error("Runner is not available for reentrant nudge.");
        }
        reentrantNudge = await runnerForReentrantNudge.nudgeHostedRunner();
      },
    });
    runnerForReentrantNudge = runner;
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();
    await flushDetachedRunnerDrive();

    expect(reentrantNudge).toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                pending_nudge,
                in_flight
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: expect.any(String),
      idle_shutdown_checkpoint_workspace_version: "4",
      in_flight: 0,
      pending_nudge: 0,
    }]);
  });

  it("continues a pending nudge when work arrives during idle scheduling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-schedule-race"),
      version: "4",
    });
    let injectedPendingNudge = false;
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      onSetAlarm: async ({ scheduledTimeIso }) => {
        if (injectedPendingNudge || scheduledTimeIso !== "2026-04-27T00:04:00.000Z") {
          return;
        }
        injectedPendingNudge = true;
        sql.exec(
          `UPDATE runner_meta
           SET pending_nudge = 1,
               next_wake_at = ?
           WHERE user_id = ?`,
          "2026-04-27T00:00:45.000Z",
          "member_123",
        );
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });
    await flushDetachedRunnerDrive();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                pending_nudge
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: expect.any(String),
      idle_shutdown_checkpoint_workspace_version: "4",
      pending_nudge: 0,
    }]);
  });

	  it("starts a fresh nudge drive when idle alarm application reenters during setAlarm", async () => {
	    vi.useFakeTimers();
	    vi.setSystemTime(new Date(FIXED_NOW));
	    const workspace = createWorkspaceState({
	      snapshotRef: createLayeredSnapshotRef("idle-alarm-application-race"),
	      version: "4",
	    });
	    let nudgedDuringIdleAlarmApplication = false;
	    let runnerForReentrantNudge: HostedUserRunner | null = null;
	    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace, {
	      onSetAlarm: async ({ scheduledTimeIso }) => {
	        if (
	          nudgedDuringIdleAlarmApplication
	          || scheduledTimeIso !== "2026-04-27T00:04:00.000Z"
	        ) {
	          return;
	        }
	        nudgedDuringIdleAlarmApplication = true;
	        if (!runnerForReentrantNudge) {
	          throw new Error("Runner is not available for reentrant nudge.");
	        }
	        await runnerForReentrantNudge.nudgeHostedRunner();
	      },
	    });
	    runnerForReentrantNudge = runner;
	    await runner.bindUser("member_123");

	    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
	      status: "idle",
	    });
	    await flushDetachedRunnerDrive();

	    expect(nudgedDuringIdleAlarmApplication).toBe(true);
	    expect(invoke).toHaveBeenCalledTimes(2);
	    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
	    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
	    expect(
	      sql.exec(
	        `SELECT idle_shutdown_checkpoint_due_at,
	                idle_shutdown_checkpoint_workspace_version,
	                next_wake_at,
	                pending_nudge
	         FROM runner_meta WHERE user_id = ?`,
	        "member_123",
	      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:04:00.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
      pending_nudge: 0,
    }]);
	  });

  it("runs external browser-vault refresh as detached best-effort work and clears its retry intent", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("external-browser-vault-refresh"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { alarms, readPendingBrowserVaultRefreshStorage, runner, runnerContainerNames } =
      createRunnerCryptoContextHarness(workspace, {
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.all(waitUntilPromises);
    expect(refreshBrowserVaultReplica).toHaveBeenCalledOnce();
    expect(readPendingBrowserVaultRefreshStorage()).toBeUndefined();
    expect(alarms).toEqual([]);
    expect(runnerContainerNames).toEqual([
      resolveHostedExecutionRunnerContainerName({
        source: TEST_RUNNER_RUNTIME_ENV_SOURCE,
        userId: "member_123",
      }),
    ]);
  });

  it("keeps background browser-vault refresh invalid-request logs metadata-only", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-invalid-request"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => {
      throw createInvalidRunnerRequestError();
    });
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { runner } = createRunnerCryptoContextHarness(workspace, {
      refreshBrowserVaultReplica,
      waitUntil,
    });
    await runner.bindUser("member_123");

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });
    await Promise.all(waitUntilPromises);

    const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) => input?.message === "Hosted runner background browser-vault refresh failed.");
    if (!failureLogInput) {
      throw new Error("Expected background browser-vault refresh failure log input.");
    }
    expect(failureLogInput).toEqual(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          errorCode: "invalid_request",
          errorDetailPresent: true,
          errorMessage: "Hosted execution rejected an invalid request.",
        }),
        level: "warn",
        message: "Hosted runner background browser-vault refresh failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
    expect(failureLogInput).not.toHaveProperty("error");
    expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails();
  });

  it("keeps detached browser-vault refresh pending while foreground work is pending", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("pending-work-browser-vault-refresh"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { alarms, readPendingBrowserVaultRefreshStorage, runner, sql } =
      createRunnerCryptoContextHarness(workspace, {
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET pending_nudge = 1, pending_work = 1 WHERE user_id = ?",
      "member_123",
    );

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.all(waitUntilPromises);
    expect(refreshBrowserVaultReplica).not.toHaveBeenCalled();
    expect(readPendingBrowserVaultRefreshStorage()).toMatchObject({
      failureCount: 0,
      lastErrorCode: "foreground_work",
      reason: "external_request",
      userId: "member_123",
    });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it("lets foreground nudge recovery outrank a due browser-vault refresh wake", async () => {
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
      return {
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { alarms, readPendingBrowserVaultRefreshStorage, runner } =
      createRunnerCryptoContextHarness(null, {
        invoke,
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");

    const activeRun = runner.runUntilIdleOrBudget({ reason: "manual" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await runner.scheduleBrowserVaultRefreshForUser({ userId: "member_123" });
    await Promise.all(waitUntilPromises.splice(0));
    const pendingIntent = readPendingBrowserVaultRefreshStorage();
    expect(pendingIntent).toMatchObject({
      lastErrorCode: "foreground_work",
      userId: "member_123",
    });
    setBrowserVaultRefreshIntentNextAttemptAtForTest(pendingIntent, FIXED_NOW);

    alarms.splice(0);
    const beforeNudgeMs = Date.now();
    const result = await runner.nudgeHostedRunner();
    const nextAlarmAt = result.nextAlarmAt;

    expect(result).toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
    });
    expect(nextAlarmAt).not.toBeNull();
    expect(Date.parse(nextAlarmAt ?? "")).toBeGreaterThan(beforeNudgeMs);
    expect(alarms.at(-1)).toBe(nextAlarmAt);
    expect(refreshBrowserVaultReplica).not.toHaveBeenCalled();

    invocation.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await expect(activeRun).resolves.toMatchObject({
      status: "idle",
    });
    await flushDetachedRunnerDrive();
  });

  it("keeps background browser-vault refresh conflicts best-effort", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-conflict"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "publish_conflict",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { alarms, readPendingBrowserVaultRefreshStorage, runner } =
      createRunnerCryptoContextHarness(workspace, {
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });

    await Promise.all(waitUntilPromises);
    expect(refreshBrowserVaultReplica).toHaveBeenCalledOnce();
    expect(readPendingBrowserVaultRefreshStorage()).toBeUndefined();
    expect(alarms).toEqual([]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        message: "Hosted runner skipped background browser-vault refresh because publish conflicted with the latest workspace row.",
        phase: "scheduled",
        userId: "member_123",
      }),
    );
  });

  it("keeps browser-vault refresh pending when restored source produces no private content", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-empty-source"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "refresh_failed_empty_source",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { alarms, readPendingBrowserVaultRefreshStorage, runner } =
      createRunnerCryptoContextHarness(workspace, {
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });

    await Promise.all(waitUntilPromises);
    expect(refreshBrowserVaultReplica).toHaveBeenCalledOnce();
    expect(readPendingBrowserVaultRefreshStorage()).toMatchObject({
      failureCount: 1,
      lastErrorCode: "refresh_failed_empty_source",
      reason: "external_request",
      userId: "member_123",
    });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it("coalesces repeated browser-vault refresh requests without resetting retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-coalesced-retry"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "refresh_failed_empty_source",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { readPendingBrowserVaultRefreshStorage, runner } =
      createRunnerCryptoContextHarness(workspace, {
        refreshBrowserVaultReplica,
        retryDelayMs: 10_000,
        waitUntil,
      });
    await runner.bindUser("member_123");

    await runner.scheduleBrowserVaultRefreshForUser({ userId: "member_123" });
    await Promise.all(waitUntilPromises.splice(0));
    const retryIntent = readPendingBrowserVaultRefreshStorage();
    expect(retryIntent).toMatchObject({
      failureCount: 1,
      lastErrorCode: "refresh_failed_empty_source",
    });
    const nextAttemptAt = requireBrowserVaultRefreshIntentNextAttemptAt(retryIntent);

    await runner.scheduleBrowserVaultRefreshForUser({ userId: "member_123" });
    await Promise.all(waitUntilPromises.splice(0));

    expect(refreshBrowserVaultReplica).toHaveBeenCalledOnce();
    expect(requireBrowserVaultRefreshIntentNextAttemptAt(
      readPendingBrowserVaultRefreshStorage(),
    )).toBe(nextAttemptAt);
  });

  it("does not consume a future runner alarm when only browser-vault retry is due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-future-work"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
      nextWakeAt: null,
      status: "idle",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { readPendingBrowserVaultRefreshStorage, runner, sql } =
      createRunnerCryptoContextHarness(workspace, {
        invoke,
        refreshBrowserVaultReplica,
        waitUntil,
      });
    await runner.bindUser("member_123");
    const runnerWakeAt = new Date(Date.parse(FIXED_NOW) + 60_000).toISOString();
    sql.exec(
      `UPDATE runner_meta
       SET pending_nudge = 1,
           pending_work = 1,
           alarm_kind = 'work',
           alarm_due_at = ?,
           alarm_workspace_version = NULL,
           alarm_checkpoint_next_wake_at = NULL
       WHERE user_id = ?`,
      runnerWakeAt,
      "member_123",
    );

    await runner.scheduleBrowserVaultRefreshForUser({ userId: "member_123" });
    await Promise.all(waitUntilPromises.splice(0));
    const pendingIntent = readPendingBrowserVaultRefreshStorage();
    expect(requireBrowserVaultRefreshIntentNextAttemptAt(
      pendingIntent,
    )).toBe(runnerWakeAt);
    setBrowserVaultRefreshIntentNextAttemptAtForTest(pendingIntent, FIXED_NOW);

    await runner.alarm();

    expect(invoke).not.toHaveBeenCalled();
    expect(refreshBrowserVaultReplica).not.toHaveBeenCalled();
    expect(sql.exec(
      "SELECT pending_nudge, pending_work, alarm_kind, alarm_due_at FROM runner_meta WHERE user_id = ?",
      "member_123",
    ).toArray()).toEqual([{
      alarm_due_at: runnerWakeAt,
      alarm_kind: "work",
      pending_nudge: 1,
      pending_work: 1,
    }]);
  });

  it("deletes pending browser-vault refresh intent during hosted user deletion", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("browser-vault-refresh-delete-user"),
      version: "4",
    });
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { readPendingBrowserVaultRefreshStorage, runner, sql } =
      createRunnerCryptoContextHarness(workspace, {
        waitUntil,
      });
    await runner.bindUser("member_123");
    sql.exec(
      "UPDATE runner_meta SET pending_nudge = 1, pending_work = 1 WHERE user_id = ?",
      "member_123",
    );
    await runner.scheduleBrowserVaultRefreshForUser({ userId: "member_123" });
    await Promise.all(waitUntilPromises);
    expect(readPendingBrowserVaultRefreshStorage()).toMatchObject({
      lastErrorCode: "foreground_work",
      userId: "member_123",
    });

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      userId: "member_123",
    });

    expect(readPendingBrowserVaultRefreshStorage()).toBeUndefined();
  });

  it("schedules browser-vault refresh after a committed idle-shutdown checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createBundleRef("idle-checkpoint-browser-vault-refresh"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          deferredCheckpointRequired: true,
          nextWakeAt: "2026-04-27T00:10:00.000Z",
          status: "scheduled" as const,
        };
      }
      return {
        idleShutdownCheckpointed: true,
        nextWakeAt: null,
        status: "idle" as const,
      };
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const waitUntilPromises: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
      void promise.catch(() => undefined);
    });
    const { runner } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
      refreshBrowserVaultReplica,
      waitUntil,
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "scheduled",
    });
    vi.setSystemTime(new Date("2026-04-27T00:04:00.000Z"));
    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("idle_shutdown_checkpoint");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.all(waitUntilPromises);
    expect(refreshBrowserVaultReplica).toHaveBeenCalledOnce();
  });

  it("skips background browser-vault refresh in hosted-local e2e isolation", async () => {
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("background-browser-vault-local-e2e-skip"),
      version: "4",
    });
    const refreshBrowserVaultReplica = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>
    >(async () => ({
      status: "already_fresh",
    }));
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise.catch(() => undefined);
    });
    const { readPendingBrowserVaultRefreshStorage, runner } = createRunnerCryptoContextHarness(
      workspace,
      {
        refreshBrowserVaultReplica,
        runnerRuntimeEnvSource: {
          ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
          MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        },
        waitUntil,
      },
    );
    await runner.bindUser("member_123");

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      scheduled: true,
    });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(refreshBrowserVaultReplica).not.toHaveBeenCalled();
    expect(readPendingBrowserVaultRefreshStorage()).toBeUndefined();
  });

  it("keeps a successful invocation successful without rereading the workspace for idle scheduling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-schedule-read-fail"),
      version: "4",
    });
    const { alarms, invoke, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      onWorkspaceRead: ({ readCount }) => {
        if (readCount === 2) {
          throw new Error("workspace read unavailable after completion");
        }
      },
    });
    await runner.bindUser("member_123");

    await expect(runner.runUntilIdleOrBudget({ reason: "manual" })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(alarms).toContain("2026-04-27T00:04:00.000Z");
    expect(
      sql.exec(
        `SELECT in_flight,
                last_error_code,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      in_flight: 0,
      last_error_code: null,
      retry_failure_count: 0,
    }]);
  });

  it("reschedules failed idle-shutdown checkpoints as idle retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-retry"),
      version: "4",
    });
    const destroyInstance = vi.fn(async () => {});
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("checkpoint failed");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      destroyInstance,
      invoke,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:30.000Z");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                next_wake_at,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: "2026-04-27T00:00:30.000Z",
      idle_shutdown_checkpoint_workspace_version: "4",
      next_wake_at: null,
      retry_failure_count: 1,
    }]);
  });

  it("does not retry idle-shutdown checkpoints after the max attempt cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-retry-cap"),
      version: "4",
    });
    const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => {
      throw new Error("checkpoint failed");
    });
    const { alarms, runner, sql } = createRunnerCryptoContextHarness(workspace, {
      invoke,
      maxEventAttempts: 1,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await expect(runner.alarm()).resolves.toBeUndefined();

    expect(alarms.at(-1)).toBe("deleted");
    expect(
      sql.exec(
        `SELECT idle_shutdown_checkpoint_due_at,
                idle_shutdown_checkpoint_workspace_version,
                retry_failure_count
         FROM runner_meta WHERE user_id = ?`,
        "member_123",
      ).toArray(),
    ).toEqual([{
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      retry_failure_count: 1,
    }]);
  });

  it("skips stale idle-shutdown checkpoint alarms when the workspace version changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspace = createWorkspaceState({
      snapshotRef: createLayeredSnapshotRef("idle-stale"),
      version: "5",
    });
    const { invoke, runner, sql } = createRunnerCryptoContextHarness(workspace);
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET idle_shutdown_checkpoint_due_at = ?,
           idle_shutdown_checkpoint_workspace_version = ?
       WHERE user_id = ?`,
      FIXED_NOW,
      "4",
      "member_123",
    );

    await runner.alarm();

    expect(invoke).not.toHaveBeenCalled();
  });
});

function requireBrowserVaultRefreshIntentNextAttemptAt(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a pending browser-vault refresh intent.");
  }
  const nextAttemptAt = (value as { nextAttemptAt?: unknown }).nextAttemptAt;
  if (typeof nextAttemptAt !== "string") {
    throw new Error("Expected pending browser-vault refresh intent nextAttemptAt.");
  }
  return nextAttemptAt;
}

function setBrowserVaultRefreshIntentNextAttemptAtForTest(
  value: unknown,
  nextAttemptAt: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a pending browser-vault refresh intent.");
  }
  Object.assign(value, { nextAttemptAt });
}

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
      expect([
        "member_123",
      ]).toContain(name);
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

async function createTestAiUsageAllowDecision(input: {
  expiresAt: string;
  issuedAt: string;
  nonce?: string;
  secret: string;
  userId: string;
}): Promise<HostedAiUsageAllowDecision> {
  return await signHostedAiUsageAllowDecision({
    body: buildHostedAiUsageAllowDecisionBody({
      expiresAt: input.expiresAt,
      issuedAt: input.issuedAt,
      nonce: input.nonce ?? "0123456789abcdef0123456789abcdef",
      userId: input.userId,
    }),
    keyId: "test",
    secret: input.secret,
  });
}

function createRunnerCryptoContextHarness(
  workspace: HostedWorkspaceState | null,
  options: {
    aiUsageAllowSigningSecret?: string;
    browserVaultPublish?(): Promise<void> | void;
    cryptoContextCacheMaxAgeMs?: number;
    cryptoContextStatus?: number;
    abortBrowserVaultRefresh?: HostedExecutionContainerStubLike["abortBrowserVaultRefresh"];
    destroyInstance?: HostedExecutionContainerStubLike["destroyInstance"];
    invoke?: ReturnType<typeof vi.fn<HostedExecutionContainerStubLike["invoke"]>>;
    maxEventAttempts?: number;
    onDeleteAlarm?(input: { alarmCount: number }): Promise<void> | void;
    onSetAlarm?(input: { alarmCount: number; scheduledTimeIso: string }): Promise<void> | void;
    onStoragePut?(input: { key: string; value: unknown }): void | Promise<void>;
    onWorkspaceRead?(input: { readCount: number }): void | Promise<void>;
    refreshBrowserVaultReplica?: HostedExecutionContainerStubLike["refreshBrowserVaultReplica"];
    runtimeStatusResponse?: Record<string, unknown> | ((input: {
      readCount: number;
    }) => Record<string, unknown>);
    runnerRuntimeEnvSource?: Readonly<Record<string, unknown>>;
    retryDelayMs?: number;
    runnerTimeoutMs?: number;
    runnerReadyTimeoutMs?: number;
    usageGateResponse?: Record<string, unknown>;
    usageGateStatus?: number;
    waitUntil?(promise: Promise<unknown>): void;
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
      await options.onDeleteAlarm?.({ alarmCount: alarms.length + 1 });
      alarms.push("deleted");
    },
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async getAlarm() {
      return null;
    },
    async put<T>(key: string, value: T) {
      await options.onStoragePut?.({ key, value });
      values.set(key, value);
    },
    async setAlarm(scheduledTime: number | Date) {
      const scheduledTimeIso = scheduledTime instanceof Date
        ? scheduledTime.toISOString()
        : new Date(scheduledTime).toISOString();
      await options.onSetAlarm?.({
        alarmCount: alarms.length + 1,
        scheduledTimeIso,
      });
      alarms.push(scheduledTimeIso);
    },
    sql,
  };
  const invoke = options.invoke ?? vi.fn<HostedExecutionContainerStubLike["invoke"]>(async () => ({
    nextWakeAt: null,
    status: "idle" as const,
  }));
  const refreshBrowserVaultReplica = options.refreshBrowserVaultReplica
    ?? vi.fn<NonNullable<HostedExecutionContainerStubLike["refreshBrowserVaultReplica"]>>(
      async () => ({ status: "already_fresh" as const }),
    );
  const abortBrowserVaultRefresh = options.abortBrowserVaultRefresh ?? vi.fn(async () => {});
  const destroyInstance = options.destroyInstance ?? vi.fn(async () => {});
  const destroyInstanceNames: string[] = [];
  const runnerContainerNames: string[] = [];
  const runnerRuntimeEnvSource = options.runnerRuntimeEnvSource ?? TEST_RUNNER_RUNTIME_ENV_SOURCE;
  let cryptoContextStatus = options.cryptoContextStatus ?? 200;
  let runtimeStatusReadCount = 0;
  let workspaceReadCount = 0;

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

    if (input.path === HOSTED_RUNTIME_STATUS_PATH) {
      runtimeStatusReadCount += 1;
      if (!options.runtimeStatusResponse) {
        throw new Error("Unexpected hosted runtime status read in runtime crypto context test.");
      }
      const response = typeof options.runtimeStatusResponse === "function"
        ? options.runtimeStatusResponse({ readCount: runtimeStatusReadCount })
        : options.runtimeStatusResponse;
      return Response.json(response);
    }

    if (input.path === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH) {
      await options.browserVaultPublish?.();
      return Response.json({
        published: true,
        workspace,
      });
    }

    if (input.path !== HOSTED_RUNTIME_WORKSPACE_PATH) {
      throw new Error(`Unexpected web control path in runtime crypto context test: ${input.path}`);
    }

    workspaceReadCount += 1;
    await options.onWorkspaceRead?.({ readCount: workspaceReadCount });
    return createWorkspaceReadResponseBody(workspace);
  });

  const runner = new HostedUserRunner(
    {
      storage,
      ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
    },
    {
      ...readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        ...(options.aiUsageAllowSigningSecret === undefined
          ? {}
          : {
              HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_KEY_ID: "test",
              HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_SECRET:
                options.aiUsageAllowSigningSecret,
            }),
        ...(options.maxEventAttempts === undefined
          ? {}
          : { HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: String(options.maxEventAttempts) }),
        ...(options.retryDelayMs === undefined
          ? {}
          : { HOSTED_EXECUTION_RETRY_DELAY_MS: String(options.retryDelayMs) }),
        ...(options.runnerTimeoutMs === undefined
          ? {}
          : { HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: String(options.runnerTimeoutMs) }),
        ...(options.runnerReadyTimeoutMs === undefined
          ? {}
          : { HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: String(options.runnerReadyTimeoutMs) }),
      })),
      idleShutdownCheckpointsEnabled: true,
    },
    new MemoryEncryptedR2Bucket(),
    runnerRuntimeEnvSource,
    {
      getByName(name: string) {
        runnerContainerNames.push(name);
        expect([
          resolveHostedExecutionRunnerContainerName({
            source: runnerRuntimeEnvSource,
            userId: "member_123",
          }),
        ]).toContain(name);
        return {
          abortBrowserVaultRefresh,
          async destroyInstance() {
            destroyInstanceNames.push(name);
            await destroyInstance();
          },
          invoke,
          async ownsInternalWorkerProxyToken() {
            return true;
          },
          refreshBrowserVaultReplica,
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
    abortBrowserVaultRefresh,
    destroyInstanceNames,
    invoke,
    runnerContainerNames,
    readPendingBrowserVaultRefreshStorage() {
      return values.get("runner:pending-browser-vault-refresh:v1");
    },
    runner,
    setCryptoContextStatus(status: number) {
      cryptoContextStatus = status;
    },
    sql,
  };
}

function getRunnerStateStoreForTest(runner: HostedUserRunner): RunnerStateStore {
  const value = Reflect.get(runner, "stateStore");
  if (!(value instanceof RunnerStateStore)) {
    throw new Error("Hosted user runner state store was unavailable for test.");
  }
  return value;
}

async function preservePendingNudgeRetryAfterFailureForTest(
  runner: HostedUserRunner,
): Promise<void> {
  const value = Reflect.get(runner, "preservePendingNudgeRetryAfterFailure");
  if (typeof value !== "function") {
    throw new Error("Hosted pending nudge retry helper was unavailable for test.");
  }

  const result = Reflect.apply(value, runner, []);
  if (!(result instanceof Promise)) {
    throw new Error("Hosted pending nudge retry helper did not return a promise.");
  }
  await result;
}

function startDetachedRunnerDriveForTest(
  runner: HostedUserRunner,
  input: {
    aiUsageAllowDecision: HostedAiUsageAllowDecision | null;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  },
): boolean {
  const value = Reflect.get(runner, "startDetachedRunnerDrive");
  if (typeof value !== "function") {
    throw new Error("Hosted detached runner drive helper was unavailable for test.");
  }

  const result = Reflect.apply(value, runner, [input]);
  if (typeof result !== "boolean") {
    throw new Error("Hosted detached runner drive helper did not return a boolean.");
  }
  return result;
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

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "user-runner-alarm-test",
    generatedAt: "2026-04-27T00:00:00.000Z",
    keyId: "browser-key-user-runner-alarm",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:user-runner-alarm",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

async function flushDetachedRunnerDrive(): Promise<void> {
  for (let index = 0; index < 25; index += 1) {
    await Promise.resolve();
  }
}

function createInvalidRunnerRequestError(): Error {
  return Object.assign(new TypeError("Invalid request."), {
    code: "type_error",
    details: {
      errorDetail: "Hosted assistant runtime job input runtime.userEnv.OPENAI_API_KEY must be a string.",
    },
    status: 400,
    statusCode: 400,
  });
}

function expectHostedRunnerStructuredLogsToOmitInvalidRequestDetails(): void {
  const structuredLogs = mocks.emitHostedExecutionStructuredLog.mock.calls
    .map(([input]) => buildHostedExecutionStructuredLogRecord(input));
  const serializedLogs = JSON.stringify(structuredLogs);
  expect(serializedLogs).not.toContain("OPENAI_API_KEY");
  expect(serializedLogs).not.toContain("runtime.userEnv");
  for (const log of structuredLogs) {
    if (log.details) {
      expect(log.details).not.toHaveProperty("errorDetail");
    }
  }
}

class ListableMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  onList: (() => void) | null = null;

  async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    this.onList?.();
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

function createLayeredSnapshotRef(id: string) {
  return {
    base: createBundleRef(`${id}-base`),
    hot: createBundleRef(`${id}-hot`),
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  } as const;
}
