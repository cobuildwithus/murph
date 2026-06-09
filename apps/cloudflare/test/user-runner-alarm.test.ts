import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

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
  hostedWorkspaceSnapshotUserPrefix,
} from "../src/storage-paths.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { HostedUserRunnerWithTestControls } from "../src/user-runner/hosted-user-runner-test.ts";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.ts";
import {
  workspaceSnapshotOrphanCandidateStorageKey,
} from "../src/user-runner/workspace-snapshot-sessions.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  type HostedWorkspaceSnapshotUploadSession,
} from "../src/workspace-snapshot-store.ts";
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
const WORKSPACE_NEXT_WAKE_AT = "2026-04-27T00:02:00.000Z";
const ACTIVE_RUNTIME_RECHECK_AT = "2026-04-27T00:01:00.000Z";
const TEST_USER_ID = "member_123";
const TEST_RUNNER_RUNTIME_ENV_SOURCE = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-openai-key",
} as const;

describe("HostedUserRunner execution coordination", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("accepts one runtime-processing pass without reading status as a scheduler", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const onStatusRead = vi.fn(() => {
      throw new Error("Cloudflare must not read status to schedule runtime work.");
    });
    const readiness = createDeferred<Awaited<
      ReturnType<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>
    >>();
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => await readiness.promise);
    const { alarms, flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      mailboxLag: [createMailboxLag({ importedSeq: "1", lag: "0", maxSeq: "1" })],
      onStatusRead,
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    const accepted = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    let acceptedSettled = false;
    void accepted.finally(() => {
      acceptedSettled = true;
    });

    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    }));
    expect(invoke).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(acceptedSettled).toBe(false);

    readiness.resolve({ kind: "ready" });

    await expect(accepted).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: expect.any(String),
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });

    expect(onStatusRead).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].job.request).toMatchObject({
      userId: TEST_USER_ID,
      workspace: expect.objectContaining({
        userId: TEST_USER_ID,
        version: "5",
      }),
      workspaceVersion: "5",
    });
    await flushWaitUntil();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      last_invocation_at: expect.any(String),
      wake_at: null,
    });
    const scheduledAlarms = alarms.filter((alarm) => alarm !== "deleted");
    expect(scheduledAlarms).toEqual([]);
    expect(alarms).toContain("deleted");
    expect(alarms).not.toContain(WORKSPACE_NEXT_WAKE_AT);
  });

  it("prewarms the container shell without taking a write fence or invoking runtime work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const prewarmForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["prewarmForProcessing"]>
    >(async () => ({ action: "started", kind: "ready" }));
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      mailboxLag: [createMailboxLag({ importedSeq: "1", lag: "0", maxSeq: "1" })],
      prewarmForProcessing,
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.prewarmRuntimeContainerForUser({
      prewarmAttemptId: "prewarm_attempt_1",
      source: "linq.message.ingress",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      action: "started",
      kind: "runtime_prewarm_accepted",
    });

    expect(prewarmForProcessing).toHaveBeenCalledOnce();
    expect(prewarmForProcessing).toHaveBeenCalledWith({
      timeoutMs: 5_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql).active_attempt_id).toBeNull();

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await flushWaitUntil();
  });

  it("treats prewarm during an active runtime fence as already running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ action: "already_warm", kind: "ready" }));
    const { runner } = createRunnerHarness({
      ensureReadyForProcessing,
    });
    await runner.bindUser(TEST_USER_ID);
    await runner.startStuckInvocationForTest({
      userId: TEST_USER_ID,
    });

    await expect(runner.prewarmRuntimeContainerForUser({
      prewarmAttemptId: "prewarm_attempt_2",
      source: "linq.message.ingress",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      action: "already_running",
      kind: "runtime_prewarm_accepted",
    });

    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
  });

  it("does not touch active write fences for prewarm hints", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:02:00.000Z"));
    const prewarmForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["prewarmForProcessing"]>
    >(async () => ({ action: "already_warm", kind: "ready" }));
    const { alarms, runner, sql } = createRunnerHarness({
      prewarmForProcessing,
    });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_expired",
      2,
      "runtime",
      FIXED_NOW,
      "5",
    );

    await expect(runner.prewarmRuntimeContainerForUser({
      prewarmAttemptId: "prewarm_attempt_expired",
      source: "linq.message.ingress",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      action: "already_running",
      kind: "runtime_prewarm_accepted",
    });

    expect(prewarmForProcessing).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_expired",
      active_expires_at: null,
    });
    expect(alarms).not.toContain("deleted");
  });

  it("passes a derived snapshot path diagnostics key without forwarding the raw log secret", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const logFingerprintSecret = "fixture-log-fingerprint-secret";
    const { invoke, runner } = createRunnerHarness({
      mailboxLag: [createMailboxLag({ importedSeq: "1", lag: "0", maxSeq: "1" })],
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        HOSTED_LOG_FINGERPRINT_SECRET: logFingerprintSecret,
      },
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const job = invoke.mock.calls[0]?.[0].job;
    expect(job?.diagnostics?.workspaceSnapshotPathHashSecret).toMatch(/^[a-f0-9]{64}$/u);
    expect(job?.diagnostics?.workspaceSnapshotPathHashSecret).not.toBe(logFingerprintSecret);
    expect(job?.runtime?.forwardedEnv?.HOSTED_LOG_FINGERPRINT_SECRET).toBeUndefined();
    expect(job?.runtime?.platformEnv?.HOSTED_LOG_FINGERPRINT_SECRET).toBeUndefined();
    expect(job?.runtime?.userEnv?.HOSTED_LOG_FINGERPRINT_SECRET).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain(logFingerprintSecret);
  });

  it("accepts runtime processing start before the invocation reaches idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql, waitUntilPromises } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: ACTIVE_RUNTIME_RECHECK_AT,
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });

    expect(waitUntilPromises).toHaveLength(1);
    let waitUntilSettled = false;
    waitUntilPromises[0]?.then(() => {
      waitUntilSettled = true;
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request).not.toHaveProperty("source");
    await Promise.resolve();
    expect(waitUntilSettled).toBe(false);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      last_invocation_at: null,
      wake_at: null,
    });

    invocationResult.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() =>
      expect(readRunnerMeta(sql)).toMatchObject({
        active_attempt_id: null,
        last_invocation_at: expect.any(String),
      })
    );
    await waitUntilPromises[0];
    expect(waitUntilSettled).toBe(true);
  });

  it("clears the fresh fence asynchronously when the accepted first container request fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    let runtimeLogSawDeletedAlarm = false;
    let harness: ReturnType<typeof createRunnerHarness>;
    harness = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      runtimeLogResponse: () => {
        runtimeLogSawDeletedAlarm = harness.alarms.includes("deleted");
        return jsonResponse({
          loggedCount: 1,
        });
      },
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    const { flushWaitUntil, invoke, runner, sql, waitUntilPromises } = harness;
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(waitUntilPromises).toHaveLength(1);
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      failure_count: 0,
    });

    invocationResult.reject(new Error("Hosted container first request failed."));
    await flushWaitUntil();

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      active_workspace_version: null,
      failure_count: 1,
      last_invocation_at: null,
    });
    expect(runtimeLogSawDeletedAlarm).toBe(true);
    const runtimeLogCalls = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .filter((call) => call[0].path === HOSTED_RUNTIME_LOG_PATH);
    expect(runtimeLogCalls).toHaveLength(1);
    const runtimeLogBody = JSON.parse(runtimeLogCalls[0]?.[0].body ?? "{}") as {
      entries?: Array<Record<string, unknown>>;
    };
    expect(runtimeLogBody.entries?.[0]).toEqual({
      at: expect.any(String),
      component: "runner",
      errorCode: "runtime_error",
      eventCode: "runner.accepted_attempt_failed",
      level: "warn",
      phase: "error",
      workspaceVersion: "5",
    });
    expect(JSON.stringify(runtimeLogBody)).not.toContain("runtime-write-");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          transportFailureFenceCleared: true,
          workspaceVersion: "5",
        }),
        message: "Hosted runner runtime execution adapter failed.",
      }),
    );
  });

  it("records accepted transport failure as complete when workspace progress committed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const workspace = createWorkspaceState({
      nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMailboxImportedCount: 1,
      },
      version: "5",
    });
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      mailboxLag: [createMailboxLag({ lag: "0", maxSeq: "0" })],
      workspace,
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    workspace.version = "6";
    invocationResult.reject(new Error("Hosted container first request failed."));
    await flushWaitUntil();

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      active_workspace_version: null,
      failure_count: 0,
      last_invocation_at: expect.any(String),
    });
    await expect(runner.runnerStatus()).resolves.toMatchObject({
      inFlight: false,
      workspace: expect.objectContaining({
        version: "6",
      }),
    });
    expect((await runner.runnerStatus()).lastErrorCode ?? null).toBeNull();
    const runtimeLogCalls = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .filter((call) => call[0].path === HOSTED_RUNTIME_LOG_PATH);
    expect(runtimeLogCalls).toHaveLength(0);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          workspaceVersion: "5",
        }),
        message: "Hosted runner accepted runtime attempt committed progress despite transport failure.",
      }),
    );
  });

  it("keeps accepted failure cleanup best-effort when the runtime log callback fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      runtimeLogResponse: () => new Response("unavailable", { status: 503 }),
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    invocationResult.reject(new Error("Hosted container first request failed."));
    await flushWaitUntil();

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      active_workspace_version: null,
      failure_count: 1,
      last_invocation_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          orchestrationAttemptIdPresent: true,
          workspaceAttemptIdPresent: true,
          workspaceVersion: "5",
        }),
        message: "Hosted runner accepted runtime attempt failure log write failed.",
      }),
    );
    const failureLog = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map((call) => call[0])
      .find((entry) =>
        entry.message === "Hosted runner accepted runtime attempt failure log write failed"
      );
    expect(JSON.stringify(failureLog?.details ?? {})).not.toContain("runtime-write-");
    expect(JSON.stringify(failureLog?.details ?? {})).not.toContain("test-orchestration-attempt");
  });

  it("does not emit an accepted failure log when the async attempt no longer owns the fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const { flushWaitUntil, invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    clearRuntimeFenceForTest(sql);

    invocationResult.reject(new Error("Hosted container first request failed."));
    await flushWaitUntil();

    const runtimeLogCalls = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .filter((call) => call[0].path === HOSTED_RUNTIME_LOG_PATH);
    expect(runtimeLogCalls).toHaveLength(0);
  });

  it("returns retry_later when processing cannot start without a container binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerHarness({
      runnerContainerNamespace: null,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:01:00.000Z",
    });

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "missing_container_binding",
        }),
      }),
    );
  });

  it("waits for workspace preparation before accepting a fresh runtime start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceRead = createDeferred<void>();
    const workspaceReadTimeouts: number[] = [];
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: async (input) => {
        workspaceReadTimeouts.push(input.timeoutMs);
        await workspaceRead.promise;
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const accepted = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    let acceptedSettled = false;
    void accepted.finally(() => {
      acceptedSettled = true;
    });

    await vi.waitFor(() =>
      expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          path: HOSTED_RUNTIME_WORKSPACE_PATH,
        }),
      )
    );
    await Promise.resolve();
    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(acceptedSettled).toBe(false);
    expect(workspaceReadTimeouts).toHaveLength(1);
    expect(workspaceReadTimeouts[0]).toBeGreaterThan(8_000);
    expect(workspaceReadTimeouts[0]).toBeLessThanOrEqual(9_000);

    workspaceRead.resolve();

    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledOnce());
    await expect(accepted).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  });

  it("reuses cached runner stores when applying a caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceReadTimeouts: number[] = [];
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { flushWaitUntil, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: (input) => {
        workspaceReadTimeouts.push(input.timeoutMs);
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-1",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await flushWaitUntil();
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toHaveLength(1);

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockClear();
    await expect(runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 5_000,
      orchestrationAttemptId: "test-orchestration-attempt-2",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await flushWaitUntil();

    expect(workspaceReadTimeouts).toEqual([9_000, 4_000]);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toHaveLength(0);
  });

  it("caps fresh-start readiness with the caller command timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceReadTimeouts: number[] = [];
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: (input) => {
        workspaceReadTimeouts.push(input.timeoutMs);
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 5_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    expect(workspaceReadTimeouts).toEqual([4_000]);
    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 4_000,
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  });

  it("does not let caller timeout metadata increase Cloudflare's configured cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceReadTimeouts: number[] = [];
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { runner } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: (input) => {
        workspaceReadTimeouts.push(input.timeoutMs);
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 120_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    expect(workspaceReadTimeouts).toEqual([29_000]);
    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
  });

  it("returns retry_later when fresh-start preparation exhausts the caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: () => {
        vi.setSystemTime(new Date("2026-04-27T00:00:09.500Z"));
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:19.500Z",
    });

    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "container_rpc_timeout",
        }),
      }),
    );
  });

  it("returns retry_later when runner secrets read exhausts the caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const runnerSecretsReadStarted = createDeferred<void>();
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: TEST_USER_ID });
    const bucket = new DelayedGetMemoryEncryptedR2Bucket({
      delayMs: 10_000,
      key: runnerSecretsKey,
      onDelayedGet: () => runnerSecretsReadStarted.resolve(),
    });
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner, sql } = createRunnerHarness({
      bucket,
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 5_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    await runnerSecretsReadStarted.promise;
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:14.000Z",
    });
    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
  });

  it("does not invoke a prepared startup job after its write fence changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const readiness = createDeferred<Awaited<
      ReturnType<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>
    >>();
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => await readiness.promise);
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const accepted = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });

    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledOnce());
    const active = readRunnerMeta(sql);
    expect(active.active_attempt_id).not.toBeNull();

    clearRuntimeFenceForTest(sql);
    vi.setSystemTime(new Date(FIXED_NOW));
    readiness.resolve({ kind: "ready" });

    await expect(accepted).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:05.000Z",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner runtime processing startup confirmation finished after its write fence changed.",
      }),
    );
  });

  it("returns retry_later and clears the fresh fence when workspace preparation fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: () => {
        throw new Error("Hosted workspace read failed with HTTP 503.");
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:30.000Z",
      runner,
      sql,
    });

    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns retry_later and clears the fresh fence when prepared workspace ownership mismatches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({
        userId: "member_other",
        version: "5",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:30.000Z",
      runner,
      sql,
    });

    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns retry_later and clears the fresh fence when runtime config preparation fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      runnerRuntimeEnvSource: {},
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:30.000Z",
      runner,
      sql,
    });

    expect(ensureReadyForProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns timeout retry cadence and clears the fresh fence when startup readiness times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => {
      const error = new Error("The operation timed out.");
      error.name = "TimeoutError";
      throw error;
    });
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:10.000Z",
      runner,
      sql,
    });

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "container_rpc_timeout",
        }),
      }),
    );
  });

  it("returns rpc-error retry cadence and clears the fresh fence when startup readiness is unsupported", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => {
      const error = new Error("Unsupported operation.") as Error & {
        status: number;
        statusCode: number;
      };
      error.status = 501;
      error.statusCode = 501;
      throw error;
    });
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:30.000Z",
      runner,
      sql,
    });

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "container_rpc_error",
        }),
      }),
    );
    const preparedLog = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.message === "Hosted runner prepared workspace invocation.");
    expect(preparedLog).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        runnerContainerWorkerVersionPresent: false,
      }),
    }));
    expect(preparedLog?.details).not.toHaveProperty("runnerContainerName");
  });

  it("returns rpc-error retry cadence when startup readiness RPC is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing: null,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expectFreshRuntimeRetryAndCleared({
      retryAt: "2026-04-27T00:00:30.000Z",
      runner,
      sql,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "container_rpc_error",
        }),
      }),
    );
  });

  it("sends a payloadless wake behind an active write fence without starting another container run", async () => {
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
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: expect.any(String),
      runtimeAttemptId: token.attemptId,
    });

    expect(ensureProcessing).toHaveBeenCalledWith({
      activeRuntime: {
        attemptId: token.attemptId,
        leaseGeneration: String(token.generation),
        userId: TEST_USER_ID,
      },
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
  });

  it("probes workspace wakes behind an active runtime write fence", async () => {
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
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: ACTIVE_RUNTIME_RECHECK_AT,
      runtimeAttemptId: token.attemptId,
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
  });

  it("uses the active write fence alarmCoordinator for accepted processing wakes", async () => {
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
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: ACTIVE_RUNTIME_RECHECK_AT,
      runtimeAttemptId: token.attemptId,
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not replace active write fences because wall-clock time advanced", async () => {
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
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:01:03.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-expired",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:03.000Z",
      runtimeAttemptId: token.attemptId,
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      failure_count: 0,
      wake_at: null,
    });
  });

  it("returns retry_later for a fresh non-wakeable startup fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:10.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
  });

  it("replaces a non-wakeable write fence after startup grace elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-replace",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:01:31.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });

    invocationResult.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() =>
      expect(readRunnerMeta(sql)).toMatchObject({
        active_attempt_id: null,
        last_invocation_at: expect.any(String),
      })
    );
  });

  it("does not give a replacement start a fresh caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        vi.setSystemTime(new Date("2026-04-27T00:00:40.500Z"));
        return {
          kind: "start-required" as const,
          reason: "no-active-child" as const,
        };
      },
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt-replace",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:50.500Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
  });

  it("returns retry_later when active child wake cannot be confirmed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "container-rpc-timeout" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:10.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
  });

  it("does not replace an old runtime write fence while an active child is wake-unconfirmed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "container-rpc-timeout" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-wake-replace",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:41.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
  });

  it("returns retry_later when active child wake exceeds the caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return {
          action: "woken" as const,
          kind: "accepted" as const,
        };
      },
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      workspaceVersion: "7",
    });

    const response = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 5_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:14.000Z",
    });
    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("routes concurrent ensure calls through the persisted active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const firstEnsure = await runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-first",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(firstEnsure).toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-second",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: expect.any(String),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(ensureProcessing.mock.calls[0]?.[0].activeRuntime).toMatchObject({
      userId: TEST_USER_ID,
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_expires_at: null,
      active_workspace_version: "8",
      wake_at: null,
    });

    invocationResult.resolve({
      nextWakeAt: null,
      status: "idle",
    });
    await vi.waitFor(() =>
      expect(readRunnerMeta(sql)).toMatchObject({
        active_attempt_id: null,
        wake_at: null,
      })
    );
  });

  it("does not read web status while syncing write-fence alarms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const onStatusRead = vi.fn(() => {
      throw new Error("Alarm must not read web status as runtime work.");
    });
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      onStatusRead,
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
      }),
    });
    await runner.bindUser(TEST_USER_ID);
    const stuck = await runner.startStuckInvocationForTest({
      userId: TEST_USER_ID,
    });
    expect(stuck.nextWakeAt).toBeNull();

    await runner.alarm();

    expect(onStatusRead).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: stuck.attemptId,
      wake_at: null,
    });
    expect(alarms.at(-1)).toBe("deleted");
    expect(alarms).not.toContain(WORKSPACE_NEXT_WAKE_AT);
  });

  it("can seed a stale stuck invocation for hosted-local tests without scheduling expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerHarness({
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    const stuck = await runner.startStuckInvocationForTest({
      startedAgoMs: 35_000,
      userId: TEST_USER_ID,
    });

    expect(stuck.nextWakeAt).toBeNull();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_expires_at: null,
      active_started_at: "2026-04-26T23:59:25.000Z",
    });
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("rethrows alarm cleanup failures so Cloudflare can retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { alarms, runner, sql } = createRunnerHarness({
      alarmDeleteError: new Error("alarm delete failed"),
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
      }),
    });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_alarm_failure",
      2,
      "runtime",
      FIXED_NOW,
      "7",
    );

    await expect(runner.alarm()).rejects.toThrow("alarm delete failed");

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: "attempt_alarm_failure",
      failure_count: 0,
    });
    expect(alarms).toEqual([]);
  });

  it("reports active write fences without treating semantic workspace wakes as alarms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerHarness({
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "3",
      }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      activeWriteFence: null,
      inFlight: false,
      nextAlarmAt: null,
      userId: TEST_USER_ID,
      workspace: expect.objectContaining({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
      }),
    });

    const token = writeRuntimeFenceForTest(sql, {
      attemptId: "runtime_status_attempt",
      workspaceVersion: "3",
    });
    await expect(runner.runnerStatus()).resolves.toMatchObject({
      activeWriteFence: {
        attemptId: token.attemptId,
        userId: TEST_USER_ID,
        workspaceVersion: "3",
      },
      inFlight: true,
      nextAlarmAt: null,
      userId: TEST_USER_ID,
    });
  });

  it(
    "reports active write-fence status without product reason semantics",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_NOW));
      const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
      const { invoke, runner, sql } = createRunnerHarness({
        invocationResults: [invocationResult.promise],
        workspace: createWorkspaceState({ version: "12" }),
      });
      await runner.bindUser(TEST_USER_ID);

      const ensure = await runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "test-orchestration-status-reasonless",
        userId: TEST_USER_ID,
      });
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
      const activeAttemptId = readRunnerMeta(sql).active_attempt_id;
      expect(activeAttemptId).toEqual(expect.any(String));
      const status = await runner.runnerStatus() as Awaited<
        ReturnType<HostedUserRunner["runnerStatus"]>
      > & {
        activeWriteFence: { expiresAt: string | null } | null;
      };

      expect(status.activeWriteFence?.expiresAt).toBe(status.nextAlarmAt);
      expect(status).toMatchObject({
        activeWriteFence: {
          attemptId: activeAttemptId,
          userId: TEST_USER_ID,
          workspaceVersion: "12",
        },
        inFlight: true,
        nextAlarmAt: null,
        userId: TEST_USER_ID,
      });
      expect(status.activeWriteFence).not.toHaveProperty("reason");

      invocationResult.resolve({
        nextWakeAt: null,
        status: "idle",
      });
      expect(ensure).toMatchObject({
        action: "started",
        kind: "runtime_processing_accepted",
      });
    },
  );

  it("deletes runner state and clears alarms for hosted user deletion", async () => {
    const destroyInstance = vi.fn(async () => {});
    const { alarms, runner, sql } = createRunnerHarness({
      destroyInstance,
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.deleteHostedUserData(TEST_USER_ID)).resolves.toMatchObject({
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
      userId: TEST_USER_ID,
    });

    expect(alarms).toContain("deleted");
    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("preempts active invocations before deleting user R2 data", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundleKey = `${await hostedBundleUserPrefix({ userId: TEST_USER_ID })}bundle.bundle.json`;
    const artifactKey = `${await hostedArtifactUserPrefix({ userId: TEST_USER_ID })}artifact.bin`;
    const browserVaultKey =
      `${await hostedBrowserVaultReplicaUserPrefix({ userId: TEST_USER_ID })}replica.json`;
    const workspaceSnapshotKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_abc.snapshot.enc`;
    const rawEmailKey =
      `${await hostedEmailRawMessageUserPrefix({ userId: TEST_USER_ID })}message.eml`;
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: TEST_USER_ID });
    for (const key of [
      artifactKey,
      browserVaultKey,
      bundleKey,
      rawEmailKey,
      runnerSecretsKey,
      workspaceSnapshotKey,
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
    await harness.runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_delete",
      2,
      "runtime",
      FIXED_NOW,
      "9",
    );
    bucket.onList = () => {
      events.push("list");
      expect(events[0]).toBe("destroy");
    };

    await expect(harness.runner.deleteHostedUserData(TEST_USER_ID)).resolves.toMatchObject({
      ok: true,
      r2: {
        deletedObjectCount: 6,
        skippedUserScopedPrefixes: false,
        supported: true,
      },
      userId: TEST_USER_ID,
    });

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(events[0]).toBe("destroy");
    for (const key of [
      artifactKey,
      browserVaultKey,
      bundleKey,
      rawEmailKey,
      runnerSecretsKey,
      workspaceSnapshotKey,
    ]) {
      expect(bucket.objects.has(key)).toBe(false);
    }
    expect(sql.exec("SELECT user_id FROM runner_meta").toArray()).toEqual([]);
  });

  it("does not sweep R2 when active runner container teardown fails during user deletion", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const bundleKey = `${await hostedBundleUserPrefix({ userId: TEST_USER_ID })}bundle.bundle.json`;
    await bucket.put(bundleKey, "test-data");
    bucket.onList = vi.fn();
    const destroyInstance = vi.fn(async () => {
      throw new Error("container still active");
    });
    const { runner, sql } = createRunnerHarness({
      bucket,
      destroyInstance,
    });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_delete",
      2,
      "runtime",
      FIXED_NOW,
      "9",
    );

    await expect(runner.deleteHostedUserData(TEST_USER_ID)).rejects.toThrow(
      "Hosted runner container cleanup failed before user data deletion.",
    );

    expect(destroyInstance).toHaveBeenCalledOnce();
    expect(bucket.onList).not.toHaveBeenCalled();
    expect(bucket.objects.has(bundleKey)).toBe(true);
    expect(sql.exec(
      `SELECT active_attempt_id, user_id
       FROM runner_meta
       WHERE singleton = 1`,
    ).toArray()).toEqual([{ active_attempt_id: null, user_id: TEST_USER_ID }]);
  });

  it("records the previous workspace snapshot object when replacing the active upload session", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const { runner, storageValues } = createRunnerHarness({ bucket });
    const previousObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_previous.snapshot.enc`;
    const nextObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_next.snapshot.enc`;
    await bucket.put(previousObjectKey, "previous-encrypted-snapshot");

    await runner.createHostedWorkspaceSnapshotUploadSession(
      createWorkspaceSnapshotUploadSessionForTest({
        objectKey: previousObjectKey,
        snapshotId: "snapshot_previous",
      }),
    );
    await runner.createHostedWorkspaceSnapshotUploadSession(
      createWorkspaceSnapshotUploadSessionForTest({
        objectKey: nextObjectKey,
        snapshotId: "snapshot_next",
      }),
    );

    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey("snapshot_previous"),
    )).toEqual(expect.objectContaining({
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      objectKey: previousObjectKey,
      snapshotId: "snapshot_previous",
      userId: TEST_USER_ID,
    }));
    expect(bucket.deleted).not.toContain(previousObjectKey);
    expect(bucket.objects.has(previousObjectKey)).toBe(true);
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: "snapshot_previous",
      userId: TEST_USER_ID,
    })).resolves.toBeNull();
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: "snapshot_next",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      objectKey: nextObjectKey,
      snapshotId: "snapshot_next",
    });
  });

  it("cleans old workspace snapshot orphan candidates only after confirming they are not current", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const orphanObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_orphan.snapshot.enc`;
    const currentObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_current.snapshot.enc`;
    const nextObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_next.snapshot.enc`;
    await bucket.put(orphanObjectKey, "orphan-encrypted-snapshot");
    await bucket.put(currentObjectKey, "current-encrypted-snapshot");
    const { flushWaitUntil, runner, storageValues } = createRunnerHarness({
      bucket,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: currentObjectKey,
          snapshotId: "snapshot_current",
        }),
      }),
    });

    await runner.recordHostedWorkspaceSnapshotOrphanCandidate({
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: orphanObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "snapshot_orphan",
      userId: TEST_USER_ID,
    });
    await runner.recordHostedWorkspaceSnapshotOrphanCandidate({
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: currentObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "snapshot_current",
      userId: TEST_USER_ID,
    });

    await runner.createHostedWorkspaceSnapshotUploadSession(
      createWorkspaceSnapshotUploadSessionForTest({
        objectKey: nextObjectKey,
        snapshotId: "snapshot_next",
      }),
    );
    await flushWaitUntil();

    expect(bucket.deleted).toContain(orphanObjectKey);
    expect(bucket.objects.has(orphanObjectKey)).toBe(false);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey("snapshot_orphan"),
    )).toBeUndefined();
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey("snapshot_current"),
    )).toBeUndefined();
  });
});

function createRunnerHarness(input: {
  alarmDeleteError?: Error;
  bucket?: MemoryEncryptedR2Bucket;
  destroyInstance?: HostedExecutionContainerStubLike["destroyInstance"];
  ensureReadyForProcessing?: HostedExecutionContainerStubLike["ensureReadyForProcessing"] | null;
  ensureProcessing?: HostedExecutionContainerStubLike["ensureProcessing"];
  invocationResults?: Array<Error | HostedWorkspaceInvocationResult | Promise<HostedWorkspaceInvocationResult>>;
  mailboxLag?: HostedRuntimeWebStatusResponse["mailboxLag"];
  onStatusRead?: () => Promise<void> | void;
  onWorkspaceRead?: (input: { timeoutMs: number }) => Promise<void> | void;
  prewarmForProcessing?: HostedExecutionContainerStubLike["prewarmForProcessing"] | null;
  runtimeLogResponse?: () => Promise<Response> | Response;
  runnerRuntimeEnvSource?: Readonly<Record<string, unknown>>;
  runnerContainerNamespace?: HostedExecutionContainerNamespaceLike | null;
  workspace?: HostedWorkspaceState | null;
} = {}) {
  const durable = createDurableObjectState({
    alarmDeleteError: input.alarmDeleteError,
  });
  const invocationResults = [...(input.invocationResults ?? [])];
  const invoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(
    async () => {
      const next = invocationResults.shift() ?? { nextWakeAt: null, status: "idle" };
      if (next instanceof Error) {
        throw next;
      }
      return await next;
    },
  );
  const ensureReadyForProcessing = input.ensureReadyForProcessing === null
    ? null
    : createDirectOnlyRpcMethod<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>(
        async (ensureInput) =>
          await input.ensureReadyForProcessing?.(ensureInput) ?? { kind: "ready" },
      );
  const prewarmForProcessing = input.prewarmForProcessing === null
    ? null
    : createDirectOnlyRpcMethod<NonNullable<HostedExecutionContainerStubLike["prewarmForProcessing"]>>(
        async (prewarmInput) =>
          await input.prewarmForProcessing?.(prewarmInput) ?? { kind: "ready" },
      );
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: input.destroyInstance ?? (async () => {}),
    ...(ensureReadyForProcessing ? { ensureReadyForProcessing } : {}),
    ...(prewarmForProcessing ? { prewarmForProcessing } : {}),
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
  };
  const namespace: HostedExecutionContainerNamespaceLike = {
    getByName() {
      return stub;
    },
  };

  installWebControlResponses(input.workspace ?? createWorkspaceState(), {
    readMailboxLag: () => input.mailboxLag ?? [createMailboxLag()],
    onStatusRead: input.onStatusRead,
    onWorkspaceRead: input.onWorkspaceRead,
    runtimeLogResponse: input.runtimeLogResponse,
  });

  const runner = new HostedUserRunnerWithTestControls(
    durable.state,
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
      HOSTED_EXECUTION_RETRY_DELAY_MS: "5000",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
    })),
    input.bucket ?? new MemoryEncryptedR2Bucket(),
    input.runnerRuntimeEnvSource ?? TEST_RUNNER_RUNTIME_ENV_SOURCE,
    input.runnerContainerNamespace === undefined
      ? namespace
      : input.runnerContainerNamespace,
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
    sql: durable.sql,
    storageValues: durable.storageValues,
    waitUntilPromises: durable.waitUntilPromises,
  };
}

function createDirectOnlyRpcMethod<T extends (...args: never[]) => unknown>(
  method: T,
): T {
  return new Proxy(method, {
    get(target, property, receiver) {
      if (property === "call" || property === "apply" || property === "bind") {
        throw new TypeError("Cloudflare Durable Object RPC methods must be invoked directly on the stub.");
      }

      return Reflect.get(target, property, receiver);
    },
  });
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

class DelayedGetMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  private readonly delayMs: number;
  private readonly key: string;
  private readonly onDelayedGet: () => void;

  constructor(input: {
    delayMs: number;
    key: string;
    onDelayedGet: () => void;
  }) {
    super();
    this.delayMs = input.delayMs;
    this.key = input.key;
    this.onDelayedGet = input.onDelayedGet;
  }

  override async get(
    key: string,
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    if (key === this.key) {
      this.onDelayedGet();
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return await super.get(key);
  }
}

function createDurableObjectState(input: {
  alarmDeleteError?: Error;
} = {}): {
  alarms: string[];
  state: DurableObjectStateLike;
  waitUntilPromises: Promise<unknown>[];
  storageValues: Map<string, unknown>;
  sql: TestSqlStorageLike;
} {
  const alarms: string[] = [];
  const sql = createTestSqlStorage();
  const waitUntilPromises: Promise<unknown>[] = [];
  const values = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => values.delete(key),
    deleteAlarm: async () => {
      if (input.alarmDeleteError) {
        throw input.alarmDeleteError;
      }
      alarms.push("deleted");
    },
    get: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
    getAlarm: async () => null,
    list: async <T>(options: { prefix?: string } = {}): Promise<Map<string, T>> => {
      const result = new Map<string, T>();
      for (const [key, value] of values) {
        if (!options.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T);
        }
      }
      return result;
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      values.set(key, value);
    },
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
    storageValues: values,
    sql,
  };
}

function installWebControlResponses(
  workspace: HostedWorkspaceState | null,
  hooks: {
    onWorkspaceRead?: (input: { timeoutMs: number }) => Promise<void> | void;
    onStatusRead?: () => Promise<void> | void;
    readMailboxLag?: () => HostedRuntimeWebStatusResponse["mailboxLag"];
    runtimeLogResponse?: () => Promise<Response> | Response;
  } = {},
): void {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(
    async (input: {
      boundUserId: string;
      path: string;
      timeoutMs: number;
    }) => {
      if (input.path === HOSTED_RUNTIME_WORKSPACE_PATH) {
        await hooks.onWorkspaceRead?.({ timeoutMs: input.timeoutMs });
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

      if (input.path === HOSTED_RUNTIME_LOG_PATH) {
        return await hooks.runtimeLogResponse?.() ?? jsonResponse({
          loggedCount: 1,
        });
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
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

function createBrowserVaultReplicaRef(input: {
  generatedAt?: string;
  sourceBundleHash?: string;
} = {}): NonNullable<HostedWorkspaceState["browserVaultReplicaRef"]> {
  const sourceBundleHash = input.sourceBundleHash ?? "a".repeat(64);
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: input.generatedAt ?? FIXED_NOW,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function createWorkspaceSnapshotV2RefForTest(input: {
  objectKey: string;
  snapshotId: string;
}): HostedWorkspaceSnapshotV2Ref {
  return {
    archive: {
      compression: "zstd",
      encryptedByteSize: 128,
      encryptedObjectSha256: "b".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "a".repeat(64),
      totalPlainBytes: 64,
    },
    createdAt: FIXED_NOW,
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
        userId: TEST_USER_ID,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId: input.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: TEST_USER_ID,
  } satisfies HostedWorkspaceSnapshotV2Ref;
}

function createWorkspaceSnapshotUploadSessionForTest(input: {
  objectKey: string;
  snapshotId: string;
}): HostedWorkspaceSnapshotUploadSession {
  return {
    attemptId: "attempt_1",
    createdAt: FIXED_NOW,
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
        userId: TEST_USER_ID,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    expectedWorkspaceVersion: "4",
    expiresAt: "2026-04-27T00:10:00.000Z",
    leaseGeneration: "9",
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
    snapshotId: input.snapshotId,
    userId: TEST_USER_ID,
    workspaceVersion: "4",
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

async function expectFreshRuntimeRetryAndCleared(input: {
  retryAt: string;
  runner: HostedUserRunner;
  sql: TestSqlStorageLike;
}): Promise<void> {
  await expect(input.runner.ensureRuntimeProcessingForUser({
    orchestrationAttemptId: "test-orchestration-attempt",
    userId: TEST_USER_ID,
  })).resolves.toEqual({
    kind: "retry_later",
    retryAt: input.retryAt,
  });

  expect(readRunnerMeta(input.sql)).toMatchObject({
    active_attempt_id: null,
    failure_count: 1,
    wake_at: null,
  });
}

function writeRuntimeFenceForTest(
  sql: TestSqlStorageLike,
  input: {
    attemptId?: string;
    generation?: number;
    startedAt?: string;
    workspaceVersion?: string;
  } = {},
): {
  attemptId: string;
  generation: number;
} {
  const attemptId = input.attemptId ?? "attempt_runtime_active";
  const generation = input.generation ?? 2;
  sql.exec(
    `UPDATE runner_meta
     SET active_attempt_id = ?,
         active_generation = ?,
         active_kind = ?,
         active_reason = ?,
         active_started_at = ?,
         active_workspace_version = ?
     WHERE singleton = 1`,
    attemptId,
    generation,
    "runtime",
    "nudge",
    input.startedAt ?? FIXED_NOW,
    input.workspaceVersion ?? "7",
  );
  return {
    attemptId,
    generation,
  };
}

function clearRuntimeFenceForTest(sql: TestSqlStorageLike): void {
  sql.exec(
    `UPDATE runner_meta
     SET active_attempt_id = NULL,
         active_expires_at = NULL,
         active_kind = NULL,
         active_provider_egress_token_hash = NULL,
         active_reason = NULL,
         active_runner_container_name = NULL,
         active_started_at = NULL,
         active_workspace_version = NULL
     WHERE singleton = 1`,
  );
}

function readRunnerMeta(sql: TestSqlStorageLike): {
  active_attempt_id: string | null;
  active_expires_at: string | null;
  active_generation: number;
  active_started_at: string | null;
  active_workspace_version: string | null;
  backoff_until: string | null;
  failure_count: number;
  last_invocation_at: string | null;
  wake_at: string | null;
} {
  return sql.exec<{
    active_attempt_id: string | null;
    active_expires_at: string | null;
    active_generation: number;
    active_started_at: string | null;
    active_workspace_version: string | null;
    backoff_until: string | null;
    failure_count: number;
    last_invocation_at: string | null;
    wake_at: string | null;
  }>(
    `SELECT active_attempt_id,
            active_expires_at,
            active_generation,
            active_started_at,
            active_workspace_version,
            backoff_until,
            failure_count,
            last_invocation_at,
            wake_at
     FROM runner_meta
     WHERE singleton = 1`,
  ).one();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}
