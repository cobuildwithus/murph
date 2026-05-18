import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";

import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.ts";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedEmailRawMessageUserPrefix,
  hostedRunnerSecretsObjectKey,
} from "../src/storage-paths.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestHostedRuntimeCryptoContext } from "./hosted-runtime-crypto-fixtures.ts";
import { createTestSqlStorage, type TestSqlStorageLike } from "./sql-storage.ts";
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

const FIXED_NOW = "2026-04-27T00:00:00.000Z";
const RETRY_AT = "2026-04-27T00:00:05.000Z";
const WORKSPACE_NEXT_WAKE_AT = "2026-04-27T00:02:00.000Z";

const TEST_RUNNER_RUNTIME_ENV_SOURCE = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-openai-key",
} as const;

describe("HostedUserRunner wake scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("consumes one due wake when the runtime invocation starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");

    const nudge = await runner.nudgeHostedRunner();
    await flushWaitUntil();

    expect(nudge).toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      inFlight: true,
      kind: "processing-ensured",
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
      reason: "nudge",
      userId: "member_123",
      workspaceVersion: "5",
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      last_invocation_at: FIXED_NOW,
      wake_at: null,
    });
    expect(alarms[0]).toBe("2026-04-27T00:00:01.000Z");
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("does not start runtime work when mailbox checkpoints are caught up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      mailboxLag: [createMailboxLag({
        importedSeq: "1",
        lag: "0",
        maxSeq: "1",
      })],
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "caught-up",
      nextAlarmAt: null,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(alarms).toEqual(["deleted"]);
  });

  it("does not report caught-up when mailbox checkpoints are caught up behind an active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      mailboxLag: [createMailboxLag({
        importedSeq: "701",
        lag: "0",
        maxSeq: "701",
      })],
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_active",
      9,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "21",
    );

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      inFlight: true,
    });
    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "processing-ensured",
      nextAlarmAt: "2026-04-27T00:01:00.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledWith({
      activeRuntime: {
        attemptId: "attempt_active",
        leaseGeneration: "9",
        userId: "member_123",
      },
      reason: "nudge",
      userId: "member_123",
    });
    expect(invoke).not.toHaveBeenCalled();
    await expect(runner.runnerStatus()).resolves.toMatchObject({
      inFlight: true,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          activeWriteFencePresent: true,
          demandKind: "active-runtime",
          localEnsureInFlightPresent: false,
          progressKind: "processing-ensured",
          progressStateNextAlarmAt: "2026-04-27T00:01:00.000Z",
        }),
        message: "Hosted runner progress check completed.",
        phase: "scheduled",
        userId: null,
      }),
    );
  });

  it("reads mailbox status before scheduled runtime work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    let statusReadCount = 0;
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [{ nextWakeAt: WORKSPACE_NEXT_WAKE_AT, status: "scheduled" }],
      mailboxLag: [createMailboxLag({
        importedSeq: "1",
        lag: "0",
        maxSeq: "1",
      })],
      onStatusRead: () => {
        statusReadCount += 1;
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?
       WHERE singleton = 1`,
      FIXED_NOW,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(statusReadCount).toBeGreaterThan(0);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: WORKSPACE_NEXT_WAKE_AT,
    });
  });

  it("drops stale runtime wake completions after mailbox catch-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const staleWakeAt = "2026-04-26T23:59:59.000Z";
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [{ nextWakeAt: null, status: "idle" }],
      workspace: createWorkspaceState({
        nextWakeAt: staleWakeAt,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?
       WHERE singleton = 1`,
      FIXED_NOW,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("drops stale runtime-result assistant wakes after mailbox catch-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const staleWakeAt = "2026-04-26T23:59:59.000Z";
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [{ nextWakeAt: staleWakeAt, status: "scheduled" }],
      workspace: createWorkspaceState({
        nextWakeAt: staleWakeAt,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?
       WHERE singleton = 1`,
      FIXED_NOW,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("schedules a short recheck when runtime completion leaves mailbox lag", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [{ nextWakeAt: null, status: "idle" }],
      markMailboxCaughtUp: false,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: "2026-04-27T00:00:01.000Z",
    });
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:01.000Z");
  });

  it("schedules a short recheck when runtime completion cannot prove mailbox catch-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    let statusReadCount = 0;
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [{ nextWakeAt: null, status: "idle" }],
      mailboxLag: [createMailboxLag({
        importedSeq: "1",
        lag: "0",
        maxSeq: "1",
      })],
      onStatusRead: () => {
        statusReadCount += 1;
        if (statusReadCount === 3) {
          throw new Error("status unavailable");
        }
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?
       WHERE singleton = 1`,
      FIXED_NOW,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(statusReadCount).toBe(3);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: "2026-04-27T00:00:01.000Z",
    });
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:01.000Z");
  });

  it("schedules a bounded retry when initial mailbox status cannot be read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead: () => {
        throw new Error("status unavailable");
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: false,
      kind: "retry-scheduled",
      nextAlarmAt: RETRY_AT,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: RETRY_AT,
      failure_count: 1,
      last_error_code: "runtime_error",
      wake_at: FIXED_NOW,
    });
    expect(alarms.at(-1)).toBe(RETRY_AT);
  });

  it("keeps initial mailbox status read failures behind retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const secondRetryAt = "2026-04-27T00:00:10.000Z";
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead: () => {
        throw new Error("status unavailable");
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?, backoff_until = ?, failure_count = 1
       WHERE singleton = 1`,
      FIXED_NOW,
      RETRY_AT,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: false,
      kind: "retry-scheduled",
      nextAlarmAt: secondRetryAt,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: secondRetryAt,
      failure_count: 2,
      last_error_code: "runtime_error",
      wake_at: FIXED_NOW,
    });
    expect(alarms.at(-1)).toBe(secondRetryAt);
  });

  it("wakes a foreground runtime behind an active write fence without forcing a second local run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({ kind: "accepted" as const }));
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        firstInvocation.promise,
        { nextWakeAt: null, status: "idle" },
      ],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    const expectedRecheckAt = new Date(Date.now() + 1_000).toISOString();
    const nudge = await runner.nudgeHostedRunner();

    expect(nudge).toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "processing-ensured",
      nextAlarmAt: expectedRecheckAt,
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      wake_at: expectedRecheckAt,
    });

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
  });

  it("wakes the active runtime best-effort when a nudge arrives during an invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({ kind: "accepted" as const }));
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [firstInvocation.promise],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    const activeFence = readRunnerMeta(sql);
    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: activeFence.active_attempt_id,
      leaseGeneration: String(activeFence.active_generation),
      userId: "member_123",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          containerProcessingAction: "woken",
          containerProcessingResult: "accepted:woken",
          progressKind: "processing-ensured",
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps a fresh active write fence when no active runtime child is wakeable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const wakeRuntime = vi.fn(async () => ({
      kind: "not-wakeable" as const,
      reason: "no-active-child" as const,
    }));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      wakeRuntime,
      workspace: createWorkspaceState({ version: "9" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_stale",
      2,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "7",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "retry-scheduled",
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });

    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: "attempt_stale",
      leaseGeneration: "2",
      userId: "member_123",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_stale",
      active_generation: 2,
      wake_at: "2026-04-27T00:00:01.000Z",
    });
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:01.000Z");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          containerProcessingResult: "start-required:no-active-child",
          immediateDriveStarted: false,
          progressKind: "retry-scheduled",
          staleWriteFencePreempted: false,
          writeFenceHeldAfterStartRequired: true,
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );
  });

  it("preempts an expired write fence when no active runtime child is wakeable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const wakeRuntime = vi.fn(async () => ({
      kind: "not-wakeable" as const,
      reason: "no-active-child" as const,
    }));
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      wakeRuntime,
      workspace: createWorkspaceState({ version: "9" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_expired",
      2,
      "runtime",
      "2026-04-26T23:59:00.000Z",
      "2026-04-26T23:59:59.000Z",
      "7",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });
    await flushWaitUntil();

    expect(wakeRuntime).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
      leaseGeneration: "3",
      reason: "nudge",
      userId: "member_123",
      workspaceVersion: "9",
    });
    expect(invoke.mock.calls[0]?.[0].job.request.attemptId).not.toBe("attempt_expired");
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      last_invocation_at: FIXED_NOW,
      wake_at: null,
    });
  });

  it("keeps a fresh write fence and schedules a short retry when wake result is unknown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const wakeRuntime = vi.fn(async () => ({
      kind: "unknown" as const,
      reason: "container-rpc-error" as const,
    }));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      wakeRuntime,
      workspace: createWorkspaceState({ version: "9" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_unknown",
      2,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "7",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: "2026-04-27T00:00:01.000Z",
    });

    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: "attempt_unknown",
      leaseGeneration: "2",
      userId: "member_123",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_unknown",
      active_expires_at: "2026-04-27T00:01:00.000Z",
      wake_at: "2026-04-27T00:00:01.000Z",
    });
    expect(alarms.at(-1)).toBe("2026-04-27T00:00:01.000Z");
  });

  it("replaces a stale active write fence when runtime liveness is unconfirmed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const replacementInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({
      kind: "unknown" as const,
      reason: "container-rpc-error" as const,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [replacementInvocation.promise],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "9" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_unknown",
      2,
      "runtime",
      "2026-04-26T23:59:44.000Z",
      "2026-04-27T00:01:00.000Z",
      "7",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      inFlight: true,
      nextAlarmAt: FIXED_NOW,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: "attempt_unknown",
      leaseGeneration: "2",
      userId: "member_123",
    });
    expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
      leaseGeneration: "3",
      reason: "nudge",
      userId: "member_123",
      workspaceVersion: "9",
    });
    expect(invoke.mock.calls[0]?.[0].job.request.attemptId).not.toBe("attempt_unknown");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          containerProcessingResult: "retry-scheduled:container-rpc-error",
          immediateDriveStarted: true,
          progressKind: "processing-started",
          staleWriteFencePreempted: true,
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );

    replacementInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("defers preempting a fresh local drain before the container child is registered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({
      kind: "not-wakeable" as const,
      reason: "no-active-child" as const,
    }));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [firstInvocation.promise],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const activeFence = readRunnerMeta(sql);

    const secondNudge = await runner.nudgeHostedRunner();
    expect(secondNudge).toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: expect.any(String),
    });

    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: activeFence.active_attempt_id,
      leaseGeneration: String(activeFence.active_generation),
      userId: "member_123",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: activeFence.active_attempt_id,
      wake_at: secondNudge.nextAlarmAt,
    });
    expect(alarms.at(-1)).toBe(secondNudge.nextAlarmAt);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          containerProcessingResult: "start-required:no-active-child",
          freshLocalEnsurePreemptionDeferred: true,
          immediateDriveStarted: false,
          progressKind: "retry-scheduled",
          staleWriteFencePreempted: false,
          writeFenceHeldAfterStartRequired: true,
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("checks container processing when local ensure is in flight but no child is wakeable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [firstInvocation.promise],
      mailboxLag: [createMailboxLag({
        importedSeq: "700",
        lag: "1",
        maxSeq: "701",
      })],
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      kind: "processing-ensured",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const activeFence = readRunnerMeta(sql);

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "retry-scheduled",
    });

    expect(ensureProcessing).toHaveBeenCalledWith({
      activeRuntime: {
        attemptId: activeFence.active_attempt_id,
        leaseGeneration: String(activeFence.active_generation),
        userId: "member_123",
      },
      reason: "nudge",
      userId: "member_123",
    });
    expect(invoke).toHaveBeenCalledOnce();

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("uses the same container processing reconciliation from alarms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      mailboxLag: [createMailboxLag({
        importedSeq: "700",
        lag: "1",
        maxSeq: "701",
      })],
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_alarm",
      9,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "21",
    );

    await runner.alarm();

    expect(ensureProcessing).toHaveBeenCalledWith({
      activeRuntime: {
        attemptId: "attempt_alarm",
        leaseGeneration: "9",
        userId: "member_123",
      },
      reason: "alarm",
      userId: "member_123",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_alarm",
      active_generation: 9,
      wake_at: "2026-04-27T00:00:01.000Z",
    });
  });

  it("keeps alarm-started runtime work attached until the local drive settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocation = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocation.promise],
      mailboxLag: [createMailboxLag({
        importedSeq: "700",
        lag: "1",
        maxSeq: "701",
      })],
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?
       WHERE singleton = 1`,
      FIXED_NOW,
    );

    const alarm = runner.alarm();
    let alarmSettled = false;
    void alarm.finally(() => {
      alarmSettled = true;
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(alarmSettled).toBe(false);

    invocation.resolve({ nextWakeAt: null, status: "idle" });
    await expect(alarm).resolves.toBeUndefined();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
  });

  it("replaces a stale local drain when the exact active child is not wakeable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({
      kind: "not-wakeable" as const,
      reason: "no-active-child" as const,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        firstInvocation.promise,
        { nextWakeAt: null, status: "idle" },
      ],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const staleFence = readRunnerMeta(sql);
    vi.setSystemTime(new Date("2026-04-27T00:00:16.000Z"));

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
      inFlight: true,
      nextAlarmAt: expect.any(String),
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: staleFence.active_attempt_id,
      leaseGeneration: String(staleFence.active_generation),
      userId: "member_123",
    });
    expect(invoke.mock.calls[1]?.[0].job.request).toMatchObject({
      leaseGeneration: "2",
      reason: "nudge",
      userId: "member_123",
      workspaceVersion: "21",
    });
    expect(invoke.mock.calls[1]?.[0].job.request.attemptId).not.toBe(
      staleFence.active_attempt_id,
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          containerProcessingResult: "start-required:no-active-child",
          immediateDriveStarted: true,
          progressKind: "processing-started",
          staleWriteFencePreempted: true,
          writeFenceHeldAfterStartRequired: false,
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => {
      expect(readRunnerMeta(sql).active_attempt_id).toBeNull();
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "hosted.runner",
          message: "Hosted runner ignored stale runtime wake completion.",
        }),
      );
    });
  });

  it("ignores a stale local drain failure after replacement progress completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({
      kind: "not-wakeable" as const,
      reason: "no-active-child" as const,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        firstInvocation.promise,
        { nextWakeAt: null, status: "idle" },
      ],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    vi.setSystemTime(new Date("2026-04-27T00:00:16.000Z"));

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());

    firstInvocation.reject(new Error("stale container failed"));

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "hosted.runner",
          details: expect.objectContaining({
            errorCode: "runtime_error",
            errorDetailPresent: true,
            errorMessage: "Hosted execution runtime failed.",
            errorName: "Error",
            workspaceReason: "nudge",
            workspaceVersion: "21",
          }),
          message: "Hosted runner ignored stale runtime wake failure.",
          phase: "failed",
        }),
      );
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      wake_at: null,
    });
  });

  it("keeps a newer replacement drain when stale preemption loses the fence race", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const replacementInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const delayedWake = createDeferred<{
      kind: "not-wakeable";
      reason: "no-active-child";
    }>();
    const wakeResults: Array<
      Promise<{ kind: "not-wakeable"; reason: "no-active-child" }>
      | { kind: "not-wakeable"; reason: "no-active-child" }
    > = [
      delayedWake.promise,
      { kind: "not-wakeable", reason: "no-active-child" },
      { kind: "not-wakeable", reason: "no-active-child" },
    ];
    const wakeRuntime = vi.fn(async () => {
      const next = wakeResults.shift();
      if (!next) {
        throw new Error("Unexpected runtime wake call.");
      }
      return await next;
    });
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        firstInvocation.promise,
        replacementInvocation.promise,
      ],
      wakeRuntime,
      workspace: createWorkspaceState({ version: "21" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const staleFence = readRunnerMeta(sql);
    vi.setSystemTime(new Date("2026-04-27T00:00:16.000Z"));

    const stalePreemption = runner.nudgeHostedRunner();
    await vi.waitFor(() => expect(wakeRuntime).toHaveBeenCalledTimes(1));

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const replacementFence = readRunnerMeta(sql);
    expect(replacementFence.active_attempt_id).not.toBe(staleFence.active_attempt_id);

    delayedWake.resolve({ kind: "not-wakeable", reason: "no-active-child" });
    await expect(stalePreemption).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: false,
    });

    expect(wakeRuntime).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: replacementFence.active_attempt_id,
      wake_at: expect.any(String),
    });

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    replacementInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("returns a busy idle-checkpoint lease result behind an active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [firstInvocation.promise],
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const activeFence = readRunnerMeta(sql);

    await expect(runner.beginRuntimeWriteFenceForSmoke({
      userId: "member_123",
      workspaceVersion: "7",
    })).resolves.toBeNull();

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: activeFence.active_attempt_id,
      active_expires_at: activeFence.active_expires_at,
    });
    expect(alarms.at(-1)).toBe(activeFence.active_expires_at);

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("uses the active write-fence expiry for status alarms before workspace wakes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [firstInvocation.promise],
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        version: "3",
      }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const activeFenceExpiresAt = readRunnerMeta(sql).active_expires_at;

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      inFlight: true,
      nextAlarmAt: activeFenceExpiresAt,
      userId: "member_123",
    });

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
  });

  it("keeps legacy browser-vault refresh scheduling behind retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness();
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET wake_at = ?, backoff_until = ?, failure_count = 1
       WHERE singleton = 1`,
      FIXED_NOW,
      RETRY_AT,
    );

    await expect(runner.scheduleBrowserVaultRefreshForUser({
      userId: "member_123",
    })).resolves.toMatchObject({
      accepted: true,
      scheduled: true,
      userId: "member_123",
    });
    await flushWaitUntil();

    expect(invoke).not.toHaveBeenCalled();
    expect(alarms.at(-1)).toBe(RETRY_AT);
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: RETRY_AT,
      failure_count: 1,
      wake_at: FIXED_NOW,
    });
  });

  it("arms test-only run-until-idle work before draining", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      workspace: createWorkspaceState({ version: "12" }),
    });

    await expect(runner.runUntilIdleForTest({
      reason: "manual",
      userId: "member_123",
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
      reason: "manual",
      userId: "member_123",
      workspaceVersion: "12",
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      wake_at: null,
    });
    expect(alarms[0]).toBe(FIXED_NOW);
  });

  it("records one retry after a failed runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [new Error("container failed")],
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await flushWaitUntil();

    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: RETRY_AT,
      failure_count: 1,
      last_error_at: FIXED_NOW,
      wake_at: FIXED_NOW,
    });
    expect(alarms.at(-1)).toBe(RETRY_AT);
    expect(alarms).toContain("2026-04-27T00:00:01.000Z");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          runtimeRetryAt: RETRY_AT,
          runtimeRetryDelayMs: 5_000,
          workspaceAttemptId: expect.any(String),
          workspaceReason: "nudge",
          workspaceVersion: "0",
        }),
        level: "warn",
        message: "Hosted runner runtime wake failed.",
        phase: "failed",
        userId: "member_123",
      }),
    );
  });

  it("parks without another alarm after repeated runtime wake failures reach the cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const secondRetryAt = "2026-04-27T00:00:15.000Z";
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        new Error("container failed once"),
        new Error("container failed twice"),
        new Error("container failed three times"),
      ],
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await flushWaitUntil();
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: RETRY_AT,
      failure_count: 1,
      wake_at: FIXED_NOW,
    });

    vi.setSystemTime(new Date(RETRY_AT));
    await runner.alarm();
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: secondRetryAt,
      failure_count: 2,
      wake_at: RETRY_AT,
    });
    expect(alarms.at(-1)).toBe(secondRetryAt);

    vi.setSystemTime(new Date(secondRetryAt));
    await runner.alarm();

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 3,
      last_error_code: "runtime_error",
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          failureCount: 3,
          maxEventAttempts: 3,
          retryCapReason: "runtime-wake-failure",
        }),
        message: "Hosted runner parked after retry cap.",
        phase: "scheduled",
      }),
    );
  });

  it("counts stale active write-fence replacement toward the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const wakeRuntime = vi.fn(async () => ({
      kind: "unknown" as const,
      reason: "container-rpc-error" as const,
    }));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      wakeRuntime,
      workspace: createWorkspaceState({ version: "9" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?,
           failure_count = ?
       WHERE singleton = 1`,
      "attempt_unknown",
      2,
      "runtime",
      "2026-04-26T23:59:44.000Z",
      "2026-04-27T00:01:00.000Z",
      "7",
      2,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: false,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "retry-scheduled",
      nextAlarmAt: null,
    });

    expect(wakeRuntime).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 3,
      last_error_at: FIXED_NOW,
      last_error_code: "runtime_error",
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("does not let passive mailbox backlog rechecks bypass the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET failure_count = ?, last_error_at = ?, last_error_code = ?
       WHERE singleton = 1`,
      3,
      FIXED_NOW,
      "runtime_error",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: false,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "retry-scheduled",
      nextAlarmAt: null,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 3,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("does not let status-read rechecks bypass the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const onStatusRead = vi.fn(() => {
      throw new Error("status unavailable");
    });
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET failure_count = ?, last_error_at = ?, last_error_code = ?
       WHERE singleton = 1`,
      3,
      FIXED_NOW,
      "runtime_error",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: false,
      immediateDriveStarted: false,
      kind: "retry-scheduled",
      nextAlarmAt: null,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: null,
      failure_count: 3,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("reports the active write-fence alarm when status reads fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeExpiresAt = "2026-04-27T00:01:00.000Z";
    const onStatusRead = vi.fn(() => {
      throw new Error("status unavailable");
    });
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_active",
      1,
      "runtime",
      FIXED_NOW,
      activeExpiresAt,
      "5",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "retry-scheduled",
      nextAlarmAt: activeExpiresAt,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onStatusRead).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_active",
      active_expires_at: activeExpiresAt,
      backoff_until: null,
      failure_count: 0,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe(activeExpiresAt);
  });

  it("ignores a stale recheck alarm when status reads fail behind an active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const activeExpiresAt = "2026-04-27T00:01:00.000Z";
    const staleRecheckAt = "2026-04-26T23:59:59.000Z";
    const onStatusRead = vi.fn(() => {
      throw new Error("status unavailable");
    });
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?,
           wake_at = ?
       WHERE singleton = 1`,
      "attempt_active",
      1,
      "runtime",
      FIXED_NOW,
      activeExpiresAt,
      "5",
      staleRecheckAt,
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: false,
      inFlight: true,
      kind: "retry-scheduled",
      nextAlarmAt: activeExpiresAt,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onStatusRead).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_active",
      active_expires_at: activeExpiresAt,
      backoff_until: null,
      failure_count: 0,
      wake_at: staleRecheckAt,
    });
    expect(alarms.at(-1)).toBe(activeExpiresAt);
  });

  it("counts repeated status-read failures toward the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const secondRetryAt = "2026-04-27T00:00:15.000Z";
    const onStatusRead = vi.fn(() => {
      throw new Error("status unavailable");
    });
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: false,
      kind: "retry-scheduled",
      nextAlarmAt: RETRY_AT,
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: RETRY_AT,
      failure_count: 1,
      last_error_code: "runtime_error",
      wake_at: FIXED_NOW,
    });
    expect(alarms.at(-1)).toBe(RETRY_AT);

    vi.setSystemTime(new Date(RETRY_AT));
    await runner.alarm();
    expect(readRunnerMeta(sql)).toMatchObject({
      backoff_until: secondRetryAt,
      failure_count: 2,
      wake_at: FIXED_NOW,
    });
    expect(alarms.at(-1)).toBe(secondRetryAt);

    vi.setSystemTime(new Date(secondRetryAt));
    await runner.alarm();

    expect(invoke).not.toHaveBeenCalled();
    expect(onStatusRead).toHaveBeenCalledTimes(3);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 3,
      last_error_code: "runtime_error",
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("parks detached local ensure failures after the retry cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    let statusReadCount = 0;
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      onStatusRead: () => {
        statusReadCount += 1;
        if (statusReadCount > 1) {
          throw new Error("status unavailable");
        }
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET failure_count = ?, last_error_at = ?, last_error_code = ?
       WHERE singleton = 1`,
      2,
      FIXED_NOW,
      "runtime_error",
    );

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await expect(flushWaitUntil()).rejects.toThrow("status unavailable");
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 3,
      last_error_code: "runtime_error",
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          failureCount: 3,
          maxEventAttempts: 3,
          retryCapReason: "detached-ensure-failure",
        }),
        message: "Hosted runner parked after retry cap.",
        phase: "scheduled",
      }),
    );
  });

  it("deletes runner state and clears alarms for hosted user deletion", async () => {
    const destroyInstance = vi.fn(async () => {});
    const { alarms, runner, sql } = createRunnerHarness({
      destroyInstance,
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
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("preempts active invocations before deleting user R2 data", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundleKey = `${await hostedBundleUserPrefix({ userId: "member_123" })}bundle.bundle.json`;
    const artifactKey = `${await hostedArtifactUserPrefix({ userId: "member_123" })}artifact.bin`;
    const browserVaultKey =
      `${await hostedBrowserVaultReplicaUserPrefix({ userId: "member_123" })}replica.json`;
    const rawEmailKey =
      `${await hostedEmailRawMessageUserPrefix({ userId: "member_123" })}message.eml`;
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: "member_123" });
    for (const key of [
      artifactKey,
      browserVaultKey,
      bundleKey,
      rawEmailKey,
      runnerSecretsKey,
    ]) {
      await bucket.put(key, "test-data");
    }

    const events: string[] = [];
    let sql!: TestSqlStorageLike;
    const destroyInstance = vi.fn(async () => {
      events.push("destroy");
      expect(sql.exec(
        `SELECT active_attempt_id, active_kind
         FROM runner_meta
         WHERE singleton = 1`,
      ).toArray()).toEqual([{ active_attempt_id: null, active_kind: null }]);
    });
    const harness = createRunnerHarness({
      bucket,
      destroyInstance,
    });
    sql = harness.sql;
    await harness.runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?,
           wake_at = ?
       WHERE singleton = 1`,
      "attempt_delete",
      2,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "9",
      FIXED_NOW,
    );
    bucket.onList = () => {
      events.push("list");
      expect(events[0]).toBe("destroy");
    };

    await expect(harness.runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      ok: true,
      r2: {
        deletedObjectCount: 5,
        skippedUserScopedPrefixes: false,
        supported: true,
      },
      userId: "member_123",
    });

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(events[0]).toBe("destroy");
    for (const key of [
      artifactKey,
      browserVaultKey,
      bundleKey,
      rawEmailKey,
      runnerSecretsKey,
    ]) {
      expect(bucket.objects.has(key)).toBe(false);
    }
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("does not invoke or recreate state when deletion wins the pre-container drain window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceRead = createDeferred<void>();
    const destroyInstance = vi.fn(async () => {});
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      destroyInstance,
      onWorkspaceRead: async () => {
        await workspaceRead.promise;
      },
      workspace: createWorkspaceState({ version: "15" }),
    });

    const drain = runner.runUntilIdleForTest({
      reason: "manual",
      userId: "member_123",
    });

    await vi.waitFor(() => {
      expect(readRunnerMeta(sql).active_attempt_id).toEqual(expect.any(String));
    });
    expect(invoke).not.toHaveBeenCalled();

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true,
      userId: "member_123",
    });

    workspaceRead.resolve();

    await expect(drain).rejects.toThrow("Hosted runner user is not initialized.");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
    expect(alarms.at(-1)).toBe("deleted");
    expect(alarms).not.toContain(RETRY_AT);
  });

  it("does not recreate state from detached retry handling after pre-container deletion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceRead = createDeferred<void>();
    const destroyInstance = vi.fn(async () => {});
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      destroyInstance,
      onWorkspaceRead: async () => {
        await workspaceRead.promise;
      },
      workspace: createWorkspaceState({ version: "16" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });

    await vi.waitFor(() => {
      expect(readRunnerMeta(sql).active_attempt_id).toEqual(expect.any(String));
    });
    expect(invoke).not.toHaveBeenCalled();

    await expect(runner.deleteHostedUserData("member_123")).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        stateDeleted: true,
      },
      ok: true,
      userId: "member_123",
    });

    workspaceRead.resolve();

    await expect(flushWaitUntil()).rejects.toThrow("Hosted runner user is not initialized.");
    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Hosted runner retry scheduling failed.",
          userId: null,
        }),
      );
    });
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
    expect(alarms.at(-1)).toBe("deleted");
    expect(alarms).not.toContain(RETRY_AT);
  });

  it("does not sweep R2 when active runner container teardown fails during user deletion", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundleKey = `${await hostedBundleUserPrefix({ userId: "member_123" })}bundle.bundle.json`;
    await bucket.put(bundleKey, "test-data");
    bucket.onList = vi.fn();
    const destroyInstance = vi.fn(async () => {
      throw new Error("container still active");
    });
    const { runner, sql } = createRunnerHarness({
      bucket,
      destroyInstance,
    });
    await runner.bindUser("member_123");
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_expires_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_delete",
      2,
      "runtime",
      FIXED_NOW,
      "2026-04-27T00:01:00.000Z",
      "9",
    );

    await expect(runner.deleteHostedUserData("member_123")).rejects.toThrow(
      "Hosted runner container cleanup failed before user data deletion.",
    );

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(bucket.onList).not.toHaveBeenCalled();
    expect(bucket.objects.has(bundleKey)).toBe(true);
    expect(sql.exec(
      `SELECT active_attempt_id, user_id
       FROM runner_meta
       WHERE singleton = 1`,
    ).toArray()).toEqual([{ active_attempt_id: null, user_id: "member_123" }]);
  });
});

function createRunnerHarness(input: {
  bucket?: MemoryEncryptedR2Bucket;
  destroyInstance?: HostedExecutionContainerStubLike["destroyInstance"];
  ensureProcessing?: HostedExecutionContainerStubLike["ensureProcessing"];
  invocationResults?: Array<Error | HostedWorkspaceInvocationResult | Promise<HostedWorkspaceInvocationResult>>;
  markMailboxCaughtUp?: boolean;
  mailboxLag?: HostedRuntimeWebStatusResponse["mailboxLag"];
  onStatusRead?: () => Promise<void> | void;
  onWorkspaceRead?: () => Promise<void> | void;
  wakeRuntime?: HostedExecutionContainerStubLike["wakeRuntime"];
  workspace?: HostedWorkspaceState | null;
} = {}) {
  const durable = createDurableObjectState();
  const invocationResults = [...(input.invocationResults ?? [])];
  let mailboxLag = input.mailboxLag ?? [createMailboxLag()];
  const markMailboxCaughtUp = () => {
    mailboxLag = mailboxLag.map((lane) => ({
      ...lane,
      importedSeq: lane.maxSeq,
      lag: "0",
    }));
  };
  const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(
    async () => {
      const next = invocationResults.shift() ?? { nextWakeAt: null, status: "idle" };
      if (next instanceof Error) {
        throw next;
      }
      const result = await next;
      if (input.markMailboxCaughtUp !== false) {
        markMailboxCaughtUp();
      }
      return result;
    },
  );
  const runnerContainerNames: string[] = [];
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: input.destroyInstance ?? (async () => {}),
    ...(input.ensureProcessing
      ? {
          ensureProcessing: async (ensureInput) => {
            if (ensureInput.invoke) {
              return {
                action: ensureInput.activeRuntime ? "restarted" : "started",
                kind: "accepted",
                result: await invoke(ensureInput.invoke),
              };
            }
            return await input.ensureProcessing?.(ensureInput) ?? {
              kind: "start-required",
              reason: "no-active-child",
            };
          },
        }
      : {}),
    invoke,
    smokeHealth: async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    }),
    ...(input.wakeRuntime ? { wakeRuntime: input.wakeRuntime } : {}),
  };
  const namespace: HostedExecutionContainerNamespaceLike = {
    getByName(name) {
      runnerContainerNames.push(name);
      return stub;
    },
  };

  installWebControlResponses(input.workspace ?? createWorkspaceState(), {
    readMailboxLag: () => mailboxLag,
    onStatusRead: input.onStatusRead,
    onWorkspaceRead: input.onWorkspaceRead,
  });

  const runner = new HostedUserRunner(
    durable.state,
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_RETRY_DELAY_MS: "5000",
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "60000",
    })),
    input.bucket ?? new MemoryEncryptedR2Bucket(),
    TEST_RUNNER_RUNTIME_ENV_SOURCE,
    namespace,
  );

  return {
    alarms: durable.alarms,
    async flushWaitUntil() {
      while (durable.waitUntilPromises.length > 0) {
        await Promise.all(durable.waitUntilPromises.splice(0));
      }
    },
    invoke,
    runner,
    runnerContainerNames,
    sql: durable.sql,
  };
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

function createDurableObjectState(): {
  alarms: string[];
  state: DurableObjectStateLike;
  waitUntilPromises: Promise<unknown>[];
  sql: TestSqlStorageLike;
} {
  const alarms: string[] = [];
  const sql = createTestSqlStorage();
  const waitUntilPromises: Promise<unknown>[] = [];
  const storage: DurableObjectStorageLike = {
    delete: async () => false,
    deleteAlarm: async () => {
      alarms.push("deleted");
    },
    get: async () => undefined,
    getAlarm: async () => null,
    put: async () => {},
    setAlarm: async (scheduledTime) => {
      const date = scheduledTime instanceof Date
        ? scheduledTime
        : new Date(scheduledTime);
      alarms.push(date.toISOString());
    },
    sql,
  };

  return {
    alarms,
    state: {
      storage,
      waitUntil(promise) {
        waitUntilPromises.push(promise);
      },
    },
    waitUntilPromises,
    sql,
  };
}

function installWebControlResponses(
  workspace: HostedWorkspaceState | null,
  hooks: {
    onWorkspaceRead?: () => Promise<void> | void;
    onStatusRead?: () => Promise<void> | void;
    readMailboxLag?: () => HostedRuntimeWebStatusResponse["mailboxLag"];
  } = {},
): void {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(
    async (input: {
      boundUserId: string;
      path: string;
    }) => {
      if (input.path === HOSTED_RUNTIME_WORKSPACE_PATH) {
        await hooks.onWorkspaceRead?.();
        return jsonResponse({
          fetchedAt: FIXED_NOW,
          workspace,
        });
      }

      if (input.path === HOSTED_RUNTIME_STATUS_PATH) {
        await hooks.onStatusRead?.();
        return jsonResponse({
          mailboxLag: hooks.readMailboxLag?.() ?? [],
          userId: input.boundUserId,
          workspace,
        });
      }

      if (input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH) {
        return jsonResponse(
          await createTestHostedRuntimeCryptoContext(input.boundUserId),
        );
      }

      throw new Error(`Unexpected hosted web-control path: ${input.path}`);
    },
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
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

function createMailboxLag(
  overrides: Partial<HostedRuntimeWebStatusResponse["mailboxLag"][number]> = {},
): HostedRuntimeWebStatusResponse["mailboxLag"][number] {
  return {
    importedSeq: "0",
    lag: "1",
    lane: "conversation",
    maxSeq: "1",
    ...overrides,
  };
}

function readRunnerMeta(sql: TestSqlStorageLike): {
  active_attempt_id: string | null;
  active_expires_at: string | null;
  active_generation: number;
  backoff_until: string | null;
  failure_count: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_invocation_at: string | null;
  wake_at: string | null;
} {
  return sql.exec<{
    active_attempt_id: string | null;
    active_expires_at: string | null;
    active_generation: number;
    backoff_until: string | null;
    failure_count: number;
    last_error_at: string | null;
    last_error_code: string | null;
    last_invocation_at: string | null;
    wake_at: string | null;
  }>(
    `SELECT active_attempt_id,
            active_expires_at,
            active_generation,
            backoff_until,
            failure_count,
            last_error_at,
            last_error_code,
            last_invocation_at,
            wake_at
     FROM runner_meta
     WHERE singleton = 1`,
  ).one();
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}
