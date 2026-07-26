import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  buildHostedExecutionWorkingSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_OWNER_RELEASED_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.ts";
import {
  createHostedBundleStore,
} from "../src/bundle-store.ts";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedEmailRawMessageUserPrefix,
  hostedRunnerSecretsObjectKey,
  hostedWorkspaceSnapshotObjectKey,
  hostedWorkspaceSnapshotUserPrefix,
} from "../src/storage-paths.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { HostedUserRunnerWithTestControls } from "../src/user-runner/hosted-user-runner-test.ts";
import { RunnerStateStore } from "../src/user-runner/runner-state-store.ts";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.ts";
import {
  workspaceSnapshotUploadSessionCurrentStorageKey,
  workspaceSnapshotOrphanCandidateStorageKey,
  workspaceSnapshotOrphanCandidateStoragePrefix,
} from "../src/user-runner/workspace-snapshot-sessions.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  type HostedWorkspaceSnapshotUploadSession,
} from "../src/workspace-snapshot-store.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  verifyHostedProviderEgressCredential,
} from "../src/hosted-provider-egress-credential.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import {
  createTestHostedRuntimeCryptoContext,
  getTestHostedRuntimeRootKey,
} from "./hosted-runtime-crypto-fixtures.ts";
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
const ACTIVE_RUNTIME_RECHECK_AT = "2026-04-27T00:01:34.000Z";
const TEST_USER_ID = "member_123";
const TEST_RUNNER_RUNTIME_ENV_SOURCE = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
    "provider-egress-signing-secret",
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
    let callbackFenceAttemptId: string | null | undefined;
    let callbackSql!: TestSqlStorageLike;
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      mailboxLag: [createMailboxLag({ importedSeq: "1", lag: "0", maxSeq: "1" })],
      onOwnerReleased: ({ timeoutMs }) => {
        expect(timeoutMs).toBe(2_000);
        callbackFenceAttemptId = readRunnerMeta(callbackSql).active_attempt_id;
      },
      onStatusRead,
      workspace: createWorkspaceState({
        nextWakeAt: WORKSPACE_NEXT_WAKE_AT,
        nextWakeReason: "assistant",
        version: "5",
      }),
    });
    callbackSql = sql;
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
    await vi.waitFor(() => expect(callbackFenceAttemptId).toBeNull());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      backoff_until: null,
      failure_count: 0,
      last_invocation_at: expect.any(String),
      wake_at: null,
    });
    expect(callbackFenceAttemptId).toBeNull();
    const ownerReleaseCalls =
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      );
    expect(ownerReleaseCalls).toHaveLength(1);
    expect(ownerReleaseCalls[0]?.[0]).toMatchObject({
      boundUserId: TEST_USER_ID,
      method: "POST",
      timeoutMs: 2_000,
    });
    expect(ownerReleaseCalls[0]?.[0]).not.toHaveProperty("body");
    expect(ownerReleaseCalls[0]?.[0]).not.toHaveProperty("search");
    expect(alarms).toEqual([]);
  });

  it("forwards system-mailbox mode through the existing runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner } = createRunnerHarness({
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-system-mailbox-import",
      processingMode: "system_mailbox",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request.processingMode).toBe(
      "system_mailbox",
    );
  });

  it("clears the fence without owner release for a future mailbox continuation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerHarness({
      invocationResults: [{
        nextWakeAt: "2026-04-27T00:00:15.000Z",
        redactedStatus: {
          hostedMailboxRetryableBlockedCount: 1,
        },
        status: "scheduled",
      }],
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-future-mailbox-continuation",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      ),
    ).toHaveLength(0);
  });

  it("sends owner release when a selected wake is already due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner } = createRunnerHarness({
      invocationResults: [{
        nextWakeAt: FIXED_NOW,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedMailboxRetryableBlockedCount: 1,
        },
        status: "scheduled",
      }],
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-due-owner-release",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() =>
      expect(
        mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
          (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
        ),
      ).toHaveLength(1)
    );

    const ownerReleaseCalls =
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      );
    expect(ownerReleaseCalls).toHaveLength(1);
    expect(ownerReleaseCalls[0]?.[0]).not.toHaveProperty("search");
  });

  it("carries an immediate recheck request in the signed owner-release query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner } = createRunnerHarness({
      invocationResults: [{
        immediateRecheckRequested: true,
        nextWakeAt: "2026-04-27T00:00:15.000Z",
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxRetryableBlockedCount: 1,
        },
        status: "scheduled",
      }],
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-explicit-owner-release-recheck",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() =>
      expect(
        mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
          (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
        ),
      ).toHaveLength(1)
    );

    const ownerReleaseCalls =
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      );
    expect(ownerReleaseCalls).toHaveLength(1);
    expect(ownerReleaseCalls[0]?.[0]).toMatchObject({
      search: "?immediateRecheckRequested=1",
    });
    expect(ownerReleaseCalls[0]?.[0]).not.toHaveProperty("body");
  });

  it("keeps successful completion when the owner-release callback fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { runner, sql } = createRunnerHarness({
      ownerReleaseResponse: () => new Response("unavailable", { status: 503 }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-owner-release-failure",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Hosted runner runtime owner-release recheck callback failed; preserving completed result.",
        }),
      )
    );

    expect(readRunnerMeta(sql).active_attempt_id).toBeNull();
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      ),
    ).toHaveLength(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Hosted runner runtime owner-release recheck callback failed; preserving completed result.",
      }),
    );
  });

  it("does not send owner release after a stale completion loses the exact fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-stale-owner-release",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    sql.exec(
      "UPDATE runner_meta SET active_attempt_id = ? WHERE singleton = 1",
      "runtime-write-newer-owner",
    );
    invocationResult.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Hosted runner runtime execution completed after its write fence changed; preserving completed result without transport retry.",
        }),
      )
    );

    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      ),
    ).toHaveLength(0);
  });

  it("passes a runner-scoped OpenAI provider credential to hosted runtime jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const { invoke, runner } = createRunnerHarness({
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
    const credential = job?.runtime?.forwardedEnv?.OPENAI_API_KEY;
    expect(typeof credential).toBe("string");
    expect(credential).not.toBe(TEST_RUNNER_RUNTIME_ENV_SOURCE.OPENAI_API_KEY);
    expect(JSON.stringify(job)).not.toContain(
      TEST_RUNNER_RUNTIME_ENV_SOURCE.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    );
    const verified = await verifyHostedProviderEgressCredential({
      credential: String(credential),
      source: TEST_RUNNER_RUNTIME_ENV_SOURCE,
    });
    expect(verified).toEqual({
      claims: {
        providerKind: "openai",
        runnerContainerName: TEST_USER_ID,
        schema: "murph.hosted-provider-egress-credential.v1",
        scope: "hosted_runner_provider_egress",
        userId: TEST_USER_ID,
      },
      ok: true,
    });
    const preparedLog = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.message === "Hosted runner prepared workspace invocation.");
    expect(preparedLog).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        openAiCredentialAfterMintKind: "provider_egress",
        openAiCredentialBeforeMintKind: "sentinel",
        openAiProviderCredentialMinted: true,
      }),
    }));
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
    const { invoke, runner, sql } = createRunnerHarness({
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

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request).not.toHaveProperty("source");
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
  });

  it("keeps the fresh fence asynchronously when an accepted first container request fails without conclusive liveness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    let runtimeLogSawAlarmCleanup = false;
    let harness: ReturnType<typeof createRunnerHarness>;
    harness = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      runtimeLogResponse: () => {
        runtimeLogSawAlarmCleanup = harness.alarms.length > 0;
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
    const { invoke, runner, sql } = harness;
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
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      failure_count: 0,
    });

    invocationResult.reject(new Error("Hosted container first request failed."));
    await vi.waitFor(() =>
      expect(
        mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
          (call) => call[0].path === HOSTED_RUNTIME_LOG_PATH,
        ),
      ).toHaveLength(1)
    );

    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      failure_count: 0,
      last_invocation_at: null,
    });
    expect(runtimeLogSawAlarmCleanup).toBe(false);
    const runtimeLogCalls = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls
      .filter((call) => call[0].path === HOSTED_RUNTIME_LOG_PATH);
    expect(runtimeLogCalls).toHaveLength(1);
    const runtimeLogBody = JSON.parse(runtimeLogCalls[0]?.[0].body ?? "{}") as {
      entries?: Array<Record<string, unknown>>;
    };
    expect(runtimeLogBody.entries?.[0]).toEqual({
      at: expect.any(String),
      attemptId: expect.stringMatching(/^runtime-write-/),
      component: "runner",
      errorCode: "runtime_error",
      eventCode: "runner.accepted_attempt_failed",
      leaseGeneration: expect.any(String),
      level: "warn",
      phase: "error",
      redactedJson: expect.objectContaining({
        attemptLivenessProbeOutcome: "unsupported",
        attemptStillActive: false,
        fenceCleared: false,
        safeErrorMessage: "Hosted execution runtime failed.",
      }),
      workspaceVersion: "5",
    });
    // Error fields stay metadata-only: no internal write-attempt ids smuggled
    // through error text; the attempt id is carried only by the typed field.
    const redactedJson = runtimeLogBody.entries?.[0]?.redactedJson;
    expect(JSON.stringify(redactedJson)).not.toContain("runtime-write-");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          transportFailureFenceCleared: false,
          workspaceVersion: "5",
        }),
        message:
          "Hosted runner runtime transport failed without safe fence-clear proof; preserving the write fence.",
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
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      mailboxLag: [createMailboxLag({ lag: "0", maxSeq: "0" })],
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
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
    workspace.checkpointedAt = "2026-06-11T00:00:01.000Z";
    workspace.version = "6";
    invocationResult.reject(new Error("Hosted container first request failed."));
    await vi.waitFor(() =>
      expect(readRunnerMeta(sql)).toMatchObject({
        active_attempt_id: null,
        active_workspace_version: null,
        failure_count: 0,
        last_invocation_at: expect.any(String),
      })
    );
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
    expect(
      mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
        (call) => call[0].path === HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      ),
    ).toHaveLength(1);
  });

  it("keeps accepted failure cleanup best-effort when the runtime log callback fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql } = createRunnerHarness({
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
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            orchestrationAttemptIdPresent: true,
            workspaceAttemptIdPresent: true,
            workspaceVersion: "5",
          }),
          message: "Hosted runner accepted runtime attempt failure log write failed.",
        }),
      )
    );
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      failure_count: 0,
      last_invocation_at: null,
    });
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
    const { invoke, runner, sql } = createRunnerHarness({
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
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Hosted runner runtime transport failed without safe fence-clear proof; preserving the write fence.",
        }),
      )
    );

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

  it("starts container readiness while workspace preparation is in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceRead = createDeferred<void>();
    const workspaceReadTimeouts: number[] = [];
    let preparationStartedAtEpochMs: number | null = null;
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      onCryptoContextRead: () => {
        if (preparationStartedAtEpochMs === null) {
          throw new Error("Expected workspace preparation to have started.");
        }
        vi.setSystemTime(new Date(preparationStartedAtEpochMs + 1_250));
      },
      onWorkspaceRead: async (input) => {
        preparationStartedAtEpochMs = Date.now();
        workspaceReadTimeouts.push(input.timeoutMs);
        await workspaceRead.promise;
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const accepted = runner.ensureRuntimeProcessingForUser({
      orchestration: {
        freshStartContainerReadyAtEpochMs: 999_995,
        freshStartInvocationPreparedAtEpochMs: 999_996,
        runtimeInvocationPreparationElapsedMs: 999_997,
        runtimeStoreEnsureElapsedMs: 999_998,
        workspaceReadElapsedMs: 999_999,
      },
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
    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    }));
    expect(invoke).not.toHaveBeenCalled();
    expect(acceptedSettled).toBe(false);
    expect(workspaceReadTimeouts).toHaveLength(1);
    expect(workspaceReadTimeouts[0]).toBeGreaterThan(8_000);
    expect(workspaceReadTimeouts[0]).toBeLessThanOrEqual(9_000);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toHaveLength(0);

    if (preparationStartedAtEpochMs === null) {
      throw new Error("Expected workspace preparation to have started.");
    }
    vi.setSystemTime(new Date(preparationStartedAtEpochMs + 1_000));
    workspaceRead.resolve();

    await expect(accepted).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.stringMatching(/^runtime-write-/u),
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toHaveLength(1);
    const invocationOrchestration = invoke.mock.calls[0]?.[0].orchestration;
    expect(invocationOrchestration).toMatchObject({
      freshStartContainerReadyAtEpochMs: expect.any(Number),
      freshStartInvocationPreparedAtEpochMs: expect.any(Number),
      runtimeInvocationPreparationElapsedMs: 1_250,
      runtimeStoreEnsureElapsedMs: 250,
      workspaceReadElapsedMs: 1_000,
    });
    expect(invocationOrchestration?.freshStartContainerReadyAtEpochMs)
      .not.toBe(999_995);
    expect(invocationOrchestration?.freshStartInvocationPreparedAtEpochMs)
      .not.toBe(999_996);
    expect(invocationOrchestration?.runtimeInvocationPreparationElapsedMs)
      .not.toBe(999_997);
    expect(invocationOrchestration?.runtimeStoreEnsureElapsedMs)
      .not.toBe(999_998);
    expect(invocationOrchestration?.workspaceReadElapsedMs)
      .not.toBe(999_999);
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

  it("invokes the runner without prepared snapshot restore data when cold-restore acquisition is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const snapshotId = "snapshot_warm";
    const snapshotRef = await createWorkspaceSnapshotV2RefWithRuntimeRootForTest({
      objectKey: await hostedWorkspaceSnapshotObjectKey({
        snapshotId,
        userId: TEST_USER_ID,
      }),
      snapshotId,
    });
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({
        snapshotRef,
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
    expect(invoke.mock.calls[0]?.[0].job).not.toHaveProperty("preparedSnapshotRestore");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeSnapshotRestorePreparationFailureCode: "type_error",
          workspaceAttemptId: expect.stringMatching(/^runtime-write-/u),
          workspaceVersion: "5",
        }),
        level: "warn",
        message: "Hosted workspace snapshot restore preparation unavailable.",
      }),
    );
  });

  it("reuses cached runner stores when applying a caller command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceReadTimeouts: number[] = [];
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { runner, sql } = createRunnerHarness({
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
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());
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
    await vi.waitFor(() => expect(readRunnerMeta(sql).active_attempt_id).toBeNull());

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
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toEqual([
      [expect.objectContaining({ timeoutMs: 4_000 })],
    ]);
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

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
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
    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 4_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
  });

  it("measures how long runtime preparation remains pending after container readiness", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const runnerSecretsReadStarted = createDeferred<void>();
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: TEST_USER_ID });
    const bucket = new DelayedGetMemoryEncryptedR2Bucket({
      delayMs: 2_000,
      key: runnerSecretsKey,
      onDelayedGet: () => runnerSecretsReadStarted.resolve(),
    });
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => ({ kind: "ready" }));
    const { invoke, runner } = createRunnerHarness({
      bucket,
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    await runnerSecretsReadStarted.promise;
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(response).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });
    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimePreparationWaitAfterContainerReadyMs: 2_000,
        }),
        message: "Hosted runner runtime processing accepted.",
      }),
    );
  });

  it("converges on current state without invoking a stale prepared startup job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const readiness = createDeferred<Awaited<
      ReturnType<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>
    >>();
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => await readiness.promise);
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      invocationResults: [invocationResult.promise],
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
    const staleAttemptId = active.active_attempt_id;

    clearRuntimeFenceForTest(sql);
    vi.setSystemTime(new Date(FIXED_NOW));
    readiness.resolve({ kind: "ready" });

    const response = await accepted;
    expect(response).toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.not.stringMatching(staleAttemptId ?? ""),
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(ensureReadyForProcessing).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[0].job.request.attemptId).not.toBe(staleAttemptId);
    expect(invoke.mock.calls[0]?.[0].job.request.attemptId).toBe(
      response.kind === "runtime_processing_accepted"
        ? response.runtimeAttemptId
        : null,
    );
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(staleAttemptId ?? ""),
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted runner runtime processing startup confirmation finished after its write fence changed.",
      }),
    );

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

  it("does not restart after prepared-fence ownership loss exhausts the command budget", async () => {
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
    const initialFailureCount = readRunnerMeta(sql).failure_count;

    const response = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt-expired-ownership-loss",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(
        mocks.emitHostedExecutionStructuredLog.mock.calls
          .map((call) => call[0])
          .filter((entry) => entry.message === "Hosted runner prepared workspace invocation."),
      ).toHaveLength(1)
    );
    expect(readRunnerMeta(sql).active_attempt_id).not.toBeNull();

    clearRuntimeFenceForTest(sql);
    vi.setSystemTime(new Date("2026-04-27T00:00:10.500Z"));
    readiness.resolve({ kind: "ready" });

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:20.500Z",
    });
    expect(ensureReadyForProcessing).toHaveBeenCalledOnce();
    expect(
      mocks.emitHostedExecutionStructuredLog.mock.calls
        .map((call) => call[0])
        .filter((entry) => entry.message === "Hosted runner prepared workspace invocation."),
    ).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: initialFailureCount,
      last_invocation_at: null,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "command_budget_exhausted",
        }),
        message: "Hosted runner runtime processing could not be accepted yet.",
      }),
    );
  });

  it("returns retry_later and clears the fresh fence when workspace preparation fails", async () => {
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
      onWorkspaceRead: () => {
        throw new Error("Hosted workspace read failed with HTTP 503.");
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:30.000Z",
    });
    expect(ensureReadyForProcessing).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    readiness.resolve({ kind: "ready" });
    await Promise.resolve();
  });

  it("does not double-count when readiness fails after preparation already cleared the fence", async () => {
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
      onWorkspaceRead: () => {
        throw new Error("Hosted workspace read failed with HTTP 503.");
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:30.000Z",
    });
    expect(ensureReadyForProcessing).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.filter(
      ([input]) => input.path === HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    )).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();

    readiness.reject(createRuntimeStartupTimeoutError());
    await vi.waitFor(() =>
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            transportFailureFenceCleared: false,
          }),
          message: "Hosted runner runtime processing startup confirmation failed.",
        }),
      )
    );
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not invoke or double-count when readiness fails before preparation settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const workspaceRead = createDeferred<void>();
    let workspaceReadStarted = false;
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => {
      throw createRuntimeStartupTimeoutError();
    });
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      onWorkspaceRead: async () => {
        workspaceReadStarted = true;
        await workspaceRead.promise;
      },
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });

    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:10.000Z",
    });
    expect(workspaceReadStarted).toBe(true);
    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(invoke).not.toHaveBeenCalled();

    workspaceRead.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores preparation that finishes after readiness fails with a workspace version bound", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const runnerSecretsReadStarted = createDeferred<void>();
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId: TEST_USER_ID });
    const bucket = new DelayedGetMemoryEncryptedR2Bucket({
      delayMs: 10_000,
      key: runnerSecretsKey,
      onDelayedGet: () => runnerSecretsReadStarted.resolve(),
    });
    const readiness = createDeferred<Awaited<
      ReturnType<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>
    >>();
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => await readiness.promise);
    const { invoke, runner, sql } = createRunnerHarness({
      bucket,
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    await runnerSecretsReadStarted.promise;
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.stringMatching(/^runtime-write-/u),
      active_workspace_version: "5",
      failure_count: 0,
      wake_at: null,
    });

    readiness.reject(createRuntimeStartupTimeoutError());
    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:10.000Z",
    });
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      active_workspace_version: null,
      failure_count: 1,
      wake_at: null,
    });
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      active_workspace_version: null,
      failure_count: 1,
      wake_at: null,
    });
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

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
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

    expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns timeout retry cadence and clears the fresh fence when startup readiness times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => {
      throw createRuntimeStartupTimeoutError();
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

  it("bounds unresolved startup readiness RPCs with timeout retry cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const neverReady = new Promise<never>(() => undefined);
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async () => await neverReady);
    const { invoke, runner, sql } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const response = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureReadyForProcessing).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      userId: TEST_USER_ID,
    }));

    await vi.advanceTimersByTimeAsync(8_000);
    await expect(response).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:18.050Z",
    });

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

  it("invokes startup readiness directly on the container stub", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    let readinessReceiver: unknown = null;
    const ensureReadyForProcessing = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
    >(async function (
      this: unknown,
      input,
    ) {
      readinessReceiver = this;
      expect(input).toEqual({
        timeoutMs: 8_000,
        userId: TEST_USER_ID,
      });
      return { kind: "ready" };
    });
    const { invoke, runner } = createRunnerHarness({
      ensureReadyForProcessing,
      workspace: createWorkspaceState({ version: "5" }),
    });
    await runner.bindUser(TEST_USER_ID);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    expect(ensureReadyForProcessing).toHaveBeenCalledOnce();
    expect(readinessReceiver).toEqual(expect.objectContaining({
      invoke: expect.any(Function),
      smokeHealth: expect.any(Function),
    }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
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

  it("sends activation diagnostics behind an active write fence without starting another container run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: "attempt_runtime_active",
      leaseGeneration: "2",
      userId: TEST_USER_ID,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      readActiveRuntimeUserFence,
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
        orchestration: {
          activeFenceObservedAtEpochMs: Date.parse(FIXED_NOW),
          activeFenceTargetWasPriorVersion: false,
          activeWakeStartedAtEpochMs: Date.parse(FIXED_NOW),
          userRunnerEnsureStartedAtEpochMs: Date.parse(FIXED_NOW),
        },
        processingMode: "default",
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

  it("calls the legacy wakeRuntime fallback directly on the container stub", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const wakeRuntime = vi.fn<NonNullable<HostedExecutionContainerStubLike["wakeRuntime"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const { invoke, runner, sql } = createRunnerHarness({
      wakeRuntime,
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

    expect(wakeRuntime).toHaveBeenCalledWith({
      attemptId: token.attemptId,
      leaseGeneration: String(token.generation),
      orchestration: {
        activeFenceObservedAtEpochMs: Date.parse(FIXED_NOW),
        activeFenceTargetWasPriorVersion: false,
        activeWakeStartedAtEpochMs: Date.parse(FIXED_NOW),
        userRunnerEnsureStartedAtEpochMs: Date.parse(FIXED_NOW),
      },
      processingMode: "default",
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not coalesce retention-only requests into a default active write fence", async () => {
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
      orchestrationAttemptId: "test-orchestration-attempt-retention",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:05.000Z",
    });

    expect(ensureProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("accepts active legacy retention-only rechecks without waking the running retention pass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: "attempt_runtime_active",
      leaseGeneration: "2",
      userId: TEST_USER_ID,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: null,
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-recheck",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "already_running",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: ACTIVE_RUNTIME_RECHECK_AT,
      runtimeAttemptId: token.attemptId,
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(ensureProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("returns retry_later for retention rechecks when active child liveness is indeterminate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => {
      throw new Error("liveness unavailable");
    });
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: TEST_USER_ID,
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-liveness-indeterminate",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:30.000Z",
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(ensureProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it.each([
    ["default", undefined],
    ["system-mailbox", "system_mailbox"],
  ] as const)(
    "preempts active retention-only work before starting %s processing",
    async (_label, processingMode) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => "accepted");
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    let activeAttemptId = "";
    let activeGeneration = "";
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: activeAttemptId,
      leaseGeneration: activeGeneration,
      userId: TEST_USER_ID,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      abortWorkspaceInvocation,
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: TEST_USER_ID,
      workspaceVersion: "7",
    });
    activeAttemptId = token.attemptId;
    activeGeneration = String(token.generation);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-default-behind-retention",
      processingMode,
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:01:34.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(abortWorkspaceInvocation).toHaveBeenCalledWith({
      attemptId: token.attemptId,
      leaseGeneration: String(token.generation),
      userId: TEST_USER_ID,
    });
    expect(ensureProcessing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].job.request.processingMode).toBe(
      processingMode,
    );
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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
    },
  );

  it("preserves the active retention fence when the settled abort is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => "stale");
    let activeAttemptId = "";
    let activeGeneration = "";
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: activeAttemptId,
      leaseGeneration: activeGeneration,
      userId: TEST_USER_ID,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      abortWorkspaceInvocation,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: TEST_USER_ID,
      workspaceVersion: "7",
    });
    activeAttemptId = token.attemptId;
    activeGeneration = String(token.generation);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-default-behind-stale-retention",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:05.000Z",
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(abortWorkspaceInvocation).toHaveBeenCalledWith({
      attemptId: token.attemptId,
      leaseGeneration: String(token.generation),
      userId: TEST_USER_ID,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("preempts a legacy retention fence with no persisted container name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => "inactive");
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const versionedContainerName = `${TEST_USER_ID}--v-current`;
    const versionedInvoke = vi.fn<HostedExecutionContainerStubLike["invoke"]>(
      async () => await invocationResult.promise,
    );
    let activeAttemptId = "";
    let activeGeneration = "";
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: activeAttemptId,
      leaseGeneration: activeGeneration,
      userId: TEST_USER_ID,
    }));
    const readVersionedActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const legacyStub: HostedExecutionContainerStubLike = {
      abortWorkspaceInvocation: createDirectOnlyRpcMethod<
        NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
      >(
        async function (this: HostedExecutionContainerStubLike, abortInput) {
          expect(this).toBe(legacyStub);
          return await abortWorkspaceInvocation(abortInput);
        },
      ),
      destroyInstance: async () => {},
      invoke: async () => {
        throw new Error("legacy retention container must not receive foreground invoke");
      },
      readActiveRuntimeUserFence: createDirectOnlyRpcMethod<
        NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
      >(
        async function (this: HostedExecutionContainerStubLike) {
          expect(this).toBe(legacyStub);
          return await readActiveRuntimeUserFence();
        },
      ),
      smokeHealth: async () => ({
        ok: true,
        runnerBundle: null,
        service: "runner",
        status: 200,
      }),
    };
    const versionedStub: HostedExecutionContainerStubLike = {
      destroyInstance: async () => {},
      ensureReadyForProcessing: createDirectOnlyRpcMethod<
        NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>
      >(
        async function (this: HostedExecutionContainerStubLike) {
          expect(this).toBe(versionedStub);
          return { kind: "ready" };
        },
      ),
      invoke: versionedInvoke,
      readActiveRuntimeUserFence: createDirectOnlyRpcMethod<
        NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
      >(
        async function (this: HostedExecutionContainerStubLike) {
          expect(this).toBe(versionedStub);
          return await readVersionedActiveRuntimeUserFence();
        },
      ),
      smokeHealth: async () => ({
        ok: true,
        runnerBundle: null,
        service: "runner",
        status: 200,
      }),
    };
    const getByName = vi.fn((name: string): HostedExecutionContainerStubLike => {
      if (name === TEST_USER_ID) {
        return legacyStub;
      }
      if (name === versionedContainerName) {
        return versionedStub;
      }
      throw new Error(`Unexpected runner container name: ${name}`);
    });
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [invocationResult.promise],
      runnerContainerNamespace: { getByName },
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        CF_VERSION_METADATA: { id: "current" },
      },
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: null,
      workspaceVersion: "7",
    });
    activeAttemptId = token.attemptId;
    activeGeneration = String(token.generation);

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-default-behind-legacy-retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(readVersionedActiveRuntimeUserFence).not.toHaveBeenCalled();
    expect(abortWorkspaceInvocation).toHaveBeenCalledWith({
      attemptId: token.attemptId,
      leaseGeneration: String(token.generation),
      userId: TEST_USER_ID,
    });
    expect(getByName).toHaveBeenCalledWith(TEST_USER_ID);
    expect(getByName).toHaveBeenCalledWith(versionedContainerName);
    await vi.waitFor(() => expect(versionedInvoke).toHaveBeenCalledOnce());
    expect(invoke).not.toHaveBeenCalled();

    invocationResult.resolve({
      nextWakeAt: null,
      status: "idle",
    });
  });

  it("does not preempt retention through a rejected runner container name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const getByName = vi.fn((): HostedExecutionContainerStubLike => {
      throw new Error("rejected container name must not be used");
    });
    const { invoke, runner, sql } = createRunnerHarness({
      runnerContainerNamespace: { getByName },
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        CF_VERSION_METADATA: { id: "current" },
      },
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: "member_other--v-current",
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-default-behind-rejected-retention-name",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:30.000Z",
    });

    expect(getByName).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("keeps opposite-mode runtime busy when the active child identity does not match the fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: "attempt_different_runtime",
      leaseGeneration: "2",
      userId: TEST_USER_ID,
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "default",
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-26T23:59:20.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-behind-mismatched-default",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:36.000Z",
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(ensureProcessing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      wake_at: null,
    });
  });

  it("replaces a stale legacy default fence when retention processing has no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const onStatusRead = vi.fn();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "default",
      runnerContainerName: null,
      startedAt: "2026-04-26T23:59:20.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-behind-legacy-default",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(ensureProcessing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("replaces a stale default fence when retention processing has no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const onStatusRead = vi.fn();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "default",
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-26T23:59:20.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-replaces-stale-default",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(ensureProcessing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("preempts a fresh inactive retention-only fence for default processing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const abortWorkspaceInvocation = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
    >(async () => "accepted");
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const onStatusRead = vi.fn();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      abortWorkspaceInvocation,
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-27T00:00:20.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-default-preempts-fresh-inactive-retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(abortWorkspaceInvocation).toHaveBeenCalledWith({
      attemptId: token.attemptId,
      leaseGeneration: String(token.generation),
      userId: TEST_USER_ID,
    });
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(ensureProcessing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("replaces a stale legacy retention-only fence when retention processing has no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const onStatusRead = vi.fn();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      processingMode: "inbox_media_retention",
      runnerContainerName: null,
      startedAt: "2026-04-26T23:59:20.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-retention-replaces-stale-retention",
      processingMode: "inbox_media_retention",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(ensureProcessing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("does not resync snapshot orphan alarms while waking an active runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const storageList = vi.fn();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        action: "woken" as const,
        kind: "accepted" as const,
      }),
    );
    const { alarms, invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      onStorageList: storageList,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    await runner.recordHostedWorkspaceSnapshotOrphanCandidate({
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: "users/snapshots/member_123/snapshot_runtime_alarm.snapshot.enc",
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "snapshot_runtime_alarm",
      userId: TEST_USER_ID,
    });
    expect(alarms).toContain("2026-04-26T01:05:00.000Z");
    alarms.length = 0;
    storageList.mockClear();
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
    expect(alarms).toEqual([]);
    expect(storageList).not.toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: workspaceSnapshotOrphanCandidateStoragePrefix(),
      }),
    );
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
      recommendedRecheckAt: "2026-04-27T00:02:37.000Z",
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

  it("replaces a recent prior-version fence after its exact container reports no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const activeWakeStartedAtEpochMs = Date.parse(FIXED_NOW);
    const originalClearWriteFenceForReplacement =
      RunnerStateStore.prototype.clearWriteFenceForReplacement;
    const clearWriteFenceForReplacement = vi.spyOn(
      RunnerStateStore.prototype,
      "clearWriteFenceForReplacement",
    ).mockImplementation(async function (this: RunnerStateStore, input) {
      const result = await originalClearWriteFenceForReplacement.call(this, input);
      vi.setSystemTime(new Date(activeWakeStartedAtEpochMs + 125));
      return result;
    });
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        vi.setSystemTime(new Date(activeWakeStartedAtEpochMs + 50));
        return {
          kind: "start-required" as const,
          reason: "no-active-child" as const,
        };
      },
    );
    const runnerRuntimeEnvSource = {
      ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
      CF_VERSION_METADATA: { id: "current" },
    };
    const priorRunnerContainerName = `${TEST_USER_ID}--v-prior`;
    const currentRunnerContainerName = `${TEST_USER_ID}--v-current`;
    const { invoke, runner, runnerContainerNames, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      runnerRuntimeEnvSource,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: priorRunnerContainerName,
      startedAt: FIXED_NOW,
      workspaceVersion: "7",
    });

    const response = await runner.ensureRuntimeProcessingForUser({
      orchestration: {
        activeFenceTargetWasPriorVersion: false,
        activeWakeAccepted: true,
        activeWakeElapsedMs: 999_991,
        activeWakeFinishedAtEpochMs: 999_992,
        activeWakeFoundNoActiveChild: false,
        activeWakeStartedAtEpochMs: 999_993,
        replacedStaleFence: false,
        replacementFenceClearElapsedMs: 999_994,
        replacementFenceClearedAtEpochMs: 999_995,
        replacementFenceClearStartedAtEpochMs: 999_996,
      },
      orchestrationAttemptId: "test-orchestration-attempt-replace-prior-version",
      userId: TEST_USER_ID,
    }).finally(() => {
      clearWriteFenceForReplacement.mockRestore();
    });
    expect(response).toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:01:34.125Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(runnerContainerNames[0]).toBe(priorRunnerContainerName);
    expect(runnerContainerNames).toContain(currentRunnerContainerName);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].orchestration).toMatchObject({
      activeFenceTargetWasPriorVersion: true,
      activeWakeAccepted: false,
      activeWakeElapsedMs: 50,
      activeWakeFinishedAtEpochMs: activeWakeStartedAtEpochMs + 50,
      activeWakeFoundNoActiveChild: true,
      activeWakeStartedAtEpochMs,
      replacementFenceClearElapsedMs: 75,
      replacementFenceClearedAtEpochMs: activeWakeStartedAtEpochMs + 125,
      replacementFenceClearStartedAtEpochMs: activeWakeStartedAtEpochMs + 50,
      replacedStaleFence: true,
      runtimeInvocationPreparationElapsedMs: expect.any(Number),
      runtimeStoreEnsureElapsedMs: expect.any(Number),
      workspaceReadElapsedMs: expect.any(Number),
    });
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

  it("replaces a recent legacy-container fence when the versioned target reports no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const currentRunnerContainerName = `${TEST_USER_ID}--v-current`;
    const { invoke, runner, runnerContainerNames, sql } = createRunnerHarness({
      ensureProcessing,
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        CF_VERSION_METADATA: { id: "current" },
      },
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: null,
      startedAt: FIXED_NOW,
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-replace-legacy-container",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(runnerContainerNames[0]).toBe(TEST_USER_ID);
    expect(runnerContainerNames).toContain(currentRunnerContainerName);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0]?.[0].orchestration).toMatchObject({
      activeFenceTargetWasPriorVersion: true,
      replacedStaleFence: true,
    });
  });

  it("returns retry_later for a fresh same-version non-wakeable startup fence", async () => {
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
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        CF_VERSION_METADATA: { id: "current" },
      },
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: `${TEST_USER_ID}--v-current`,
      workspaceVersion: "7",
    });

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:03.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(ensureProcessing.mock.calls[0]?.[0].activeRuntime?.orchestration)
      .toMatchObject({ activeFenceTargetWasPriorVersion: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
      backoff_until: null,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "starting_fence_preserved",
        }),
        message: "Hosted runner runtime processing could not be accepted yet.",
      }),
    );
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
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
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

  it("replaces a non-wakeable inactive fence without reading web status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "start-required" as const,
        reason: "no-active-child" as const,
      }),
    );
    const onStatusRead = vi.fn();
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      mailboxLag: [],
      onStatusRead,
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      startedAt: "2026-04-27T00:00:00.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-replace-inactive-fence-without-status",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
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

  it("clears a non-wakeable inactive fence when replacement has no remaining command budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        vi.setSystemTime(new Date("2026-04-27T00:00:41.500Z"));
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
      retryAt: "2026-04-27T00:00:51.500Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: null,
      wake_at: null,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeProcessingRetryReason: "command_budget_exhausted",
        }),
        message: "Hosted runner runtime processing could not be accepted yet.",
      }),
    );
  });

  it("starts immediately when a replacement CAS loser observes the cleared authoritative fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    type EnsureProcessingResult = Awaited<ReturnType<
      NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>
    >>;
    const firstWakeResult = createDeferred<EnsureProcessingResult>();
    const secondWakeResult = createDeferred<EnsureProcessingResult>();
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    let ensureCallIndex = 0;
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        const deferred = ensureCallIndex === 0
          ? firstWakeResult
          : secondWakeResult;
        ensureCallIndex += 1;
        return await deferred.promise;
      },
    );
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const replacedToken = writeRuntimeFenceForTest(sql, {
      startedAt: "2026-04-26T23:59:00.000Z",
      workspaceVersion: "7",
    });

    const shortBudgetReplacement = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 10_000,
      orchestrationAttemptId: "test-orchestration-attempt-short-replacement",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureProcessing).toHaveBeenCalledOnce());
    const convergingReplacement = runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 60_000,
      orchestrationAttemptId: "test-orchestration-attempt-converging-replacement",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureProcessing).toHaveBeenCalledTimes(2));

    vi.setSystemTime(new Date("2026-04-27T00:00:10.500Z"));
    firstWakeResult.resolve({
      kind: "start-required",
      reason: "no-active-child",
    });
    await expect(shortBudgetReplacement).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:20.500Z",
    });
    expect(readRunnerMeta(sql).active_attempt_id).toBeNull();

    secondWakeResult.resolve({
      kind: "start-required",
      reason: "no-active-child",
    });
    await expect(convergingReplacement).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.not.stringMatching(replacedToken.attemptId),
    });

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(replacedToken.attemptId),
      active_expires_at: null,
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

  it("converges on the current fence when a replacement CAS loses to another replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    type EnsureProcessingResult = Awaited<ReturnType<
      NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>
    >>;
    const firstWakeResult = createDeferred<EnsureProcessingResult>();
    const secondWakeResult = createDeferred<EnsureProcessingResult>();
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    let ensureCallIndex = 0;
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => {
        const callIndex = ensureCallIndex;
        ensureCallIndex += 1;
        if (callIndex === 0) {
          return await firstWakeResult.promise;
        }
        if (callIndex === 1) {
          return await secondWakeResult.promise;
        }
        return {
          action: "already_running",
          kind: "accepted",
        };
      },
    );
    const priorRunnerContainerName = `${TEST_USER_ID}--v-prior`;
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      runnerRuntimeEnvSource: {
        ...TEST_RUNNER_RUNTIME_ENV_SOURCE,
        CF_VERSION_METADATA: { id: "current" },
      },
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const replacedToken = writeRuntimeFenceForTest(sql, {
      runnerContainerName: priorRunnerContainerName,
      startedAt: "2026-04-26T23:59:00.000Z",
      workspaceVersion: "7",
    });

    const winningReplacement = runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-winning-replacement",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureProcessing).toHaveBeenCalledOnce());
    const convergingReplacement = runner.ensureRuntimeProcessingForUser({
      orchestration: {
        triggeredByWebDirect: true,
      },
      orchestrationAttemptId: "test-orchestration-attempt-current-fence-convergence",
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => expect(ensureProcessing).toHaveBeenCalledTimes(2));

    firstWakeResult.resolve({
      kind: "start-required",
      reason: "no-active-child",
    });
    const winner = await winningReplacement;
    expect(winner).toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: expect.not.stringMatching(replacedToken.attemptId),
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    vi.setSystemTime(new Date(Date.parse(FIXED_NOW) + 250));
    secondWakeResult.resolve({
      kind: "start-required",
      reason: "no-active-child",
    });
    await expect(convergingReplacement).resolves.toMatchObject({
      action: "already_running",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: winner.kind === "runtime_processing_accepted"
        ? winner.runtimeAttemptId
        : null,
    });

    expect(ensureProcessing).toHaveBeenCalledTimes(3);
    const convergedWakeOrchestration =
      ensureProcessing.mock.calls[2]?.[0].activeRuntime?.orchestration;
    expect(convergedWakeOrchestration).toMatchObject({
      activeFenceObservedAtEpochMs: Date.parse(FIXED_NOW) + 250,
      activeFenceTargetWasPriorVersion: false,
      activeWakeStartedAtEpochMs: Date.parse(FIXED_NOW) + 250,
      triggeredByWebDirect: true,
      userRunnerEnsureStartedAtEpochMs: expect.any(Number),
    });
    expect(convergedWakeOrchestration).not.toHaveProperty("activeWakeAccepted");
    expect(convergedWakeOrchestration).not.toHaveProperty("activeWakeElapsedMs");
    expect(convergedWakeOrchestration).not.toHaveProperty(
      "activeWakeFinishedAtEpochMs",
    );
    expect(convergedWakeOrchestration).not.toHaveProperty(
      "activeWakeFoundNoActiveChild",
    );
    expect(convergedWakeOrchestration).not.toHaveProperty(
      "replacementFenceClearStartedAtEpochMs",
    );
    expect(convergedWakeOrchestration).not.toHaveProperty("replacedStaleFence");
    expect(convergedWakeOrchestration).not.toHaveProperty(
      "replacementFenceClearedAtEpochMs",
    );
    expect(convergedWakeOrchestration).not.toHaveProperty(
      "replacementFenceClearElapsedMs",
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: winner.kind === "runtime_processing_accepted"
        ? winner.runtimeAttemptId
        : null,
      active_expires_at: null,
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

  it("preserves a wake-unconfirmed runtime fence when liveness still matches the active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "active-child-rejected" as const,
      }),
    );
    let activeAttemptId = "";
    let activeGeneration = "";
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: true,
      attemptId: activeAttemptId,
      leaseGeneration: activeGeneration,
      userId: TEST_USER_ID,
    }));
    const onStatusRead = vi.fn();
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      mailboxLag: [createMailboxLag({ lag: "0" })],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-27T00:00:00.000Z",
      workspaceVersion: "7",
    });
    activeAttemptId = token.attemptId;
    activeGeneration = String(token.generation);
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-preserve-matching-wake-unconfirmed",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:46.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      wake_at: null,
    });
  });

  it("preserves a wake-unconfirmed runtime fence when liveness cannot prove the child is inactive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "active-child-rejected" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => {
      throw new Error("container health still active");
    });
    const onStatusRead = vi.fn();
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      mailboxLag: [createMailboxLag({ lag: "0" })],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-27T00:00:00.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-recover-liveness-indeterminate",
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:46.000Z",
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      wake_at: null,
    });
  });

  it("replaces a wake-unconfirmed inactive fence after liveness confirms no active child", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "active-child-rejected" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const onStatusRead = vi.fn();
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      mailboxLag: [createMailboxLag({ lag: "0" })],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-27T00:00:00.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-replace-inactive-wake-unconfirmed",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("replaces a wake-unconfirmed inactive fence when the runner container is gone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const invocationResult = createDeferred<HostedWorkspaceInvocationResult>();
    const ensureProcessing = vi.fn<NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>>(
      async () => ({
        kind: "wake-unconfirmed" as const,
        reason: "container-rpc-error" as const,
      }),
    );
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const onStatusRead = vi.fn();
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      invocationResults: [invocationResult.promise],
      mailboxLag: [createMailboxLag({ lag: "0" })],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: TEST_USER_ID,
      startedAt: "2026-04-27T00:00:00.000Z",
      workspaceVersion: "7",
    });
    vi.setSystemTime(new Date("2026-04-27T00:00:31.000Z"));

    await expect(runner.ensureRuntimeProcessingForUser({
      orchestrationAttemptId: "test-orchestration-attempt-replace-gone-container",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "replaced",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-04-27T00:02:05.000Z",
      runtimeAttemptId: expect.not.stringMatching(token.attemptId),
    });

    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(readActiveRuntimeUserFence).toHaveBeenCalledOnce();
    expect(onStatusRead).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: expect.not.stringMatching(token.attemptId),
      active_expires_at: null,
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

  it("does not probe inactive liveness after the active wake spends the caller command budget", async () => {
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
    const readActiveRuntimeUserFence = vi.fn<
      NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
    >(async () => ({
      active: false,
      reason: "no_active_runtime",
    }));
    const onStatusRead = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    });
    const { invoke, runner, sql } = createRunnerHarness({
      ensureProcessing,
      mailboxLag: [createMailboxLag({ lag: "0" })],
      onStatusRead,
      readActiveRuntimeUserFence,
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);
    const token = writeRuntimeFenceForTest(sql, {
      runnerContainerName: TEST_USER_ID,
      workspaceVersion: "7",
    });

    let settled: HostedRuntimeEnsureProcessingResponse | null = null;
    void runner.ensureRuntimeProcessingForUser({
      commandTimeoutMs: 5_000,
      orchestrationAttemptId: "test-orchestration-attempt-budgeted-recovery",
      userId: TEST_USER_ID,
    }).then((response) => {
      settled = response;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();

    expect(settled).toEqual({
      kind: "retry_later",
      retryAt: "2026-04-27T00:00:14.000Z",
    });
    expect(ensureProcessing).toHaveBeenCalledOnce();
    expect(readActiveRuntimeUserFence).not.toHaveBeenCalled();
    expect(onStatusRead).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(readRunnerMeta(sql)).toMatchObject({
      active_attempt_id: token.attemptId,
      active_expires_at: null,
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

  it("serializes simultaneous fresh ensure calls behind one write fence", async () => {
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
      workspace: createWorkspaceState({ version: "8" }),
    });
    await runner.bindUser(TEST_USER_ID);

    const results = await Promise.all([
      runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "test-orchestration-attempt-first",
        userId: TEST_USER_ID,
      }),
      runner.ensureRuntimeProcessingForUser({
        orchestrationAttemptId: "test-orchestration-attempt-second",
        userId: TEST_USER_ID,
      }),
    ]);

    expect(results.filter((result) =>
      result.kind === "runtime_processing_accepted"
      && result.action === "started"
    )).toHaveLength(1);
    expect(results.filter((result) => result.kind === "retry_later")).toHaveLength(1);
    expect(ensureProcessing).toHaveBeenCalledOnce();
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

  it("does not read web status while handling runner alarms", async () => {
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
    expect(alarms).toEqual([]);
  });

  it("uses runtime processing recovery for hosted-local run-until-idle behind an active fence", async () => {
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
      startedAt: "2026-04-26T23:59:20.000Z",
      workspaceVersion: "7",
    });

    await expect(runner.runUntilIdleForTest({ userId: TEST_USER_ID }))
      .resolves.toMatchObject({
        nextWakeAt: expect.any(String),
        status: "scheduled",
      });

    expect(ensureProcessing).toHaveBeenCalledWith({
      activeRuntime: {
        attemptId: token.attemptId,
        leaseGeneration: String(token.generation),
        orchestration: {
          activeFenceObservedAtEpochMs: Date.parse(FIXED_NOW),
          activeFenceTargetWasPriorVersion: false,
          activeWakeStartedAtEpochMs: Date.parse(FIXED_NOW),
          userRunnerEnsureStartedAtEpochMs: Date.parse(FIXED_NOW),
        },
        processingMode: "default",
        userId: TEST_USER_ID,
      },
      userId: TEST_USER_ID,
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledOnce();
      expect(readRunnerMeta(sql)).toMatchObject({
        active_attempt_id: null,
        wake_at: null,
      });
    });
    expect(invoke.mock.calls[0]?.[0].orchestration).toMatchObject({
      activeFenceObservedAtEpochMs: Date.parse(FIXED_NOW),
      activeWakeStartedAtEpochMs: Date.parse(FIXED_NOW),
      activeWakeFinishedAtEpochMs: Date.parse(FIXED_NOW),
      replacementFenceClearStartedAtEpochMs: Date.parse(FIXED_NOW),
      replacementFenceClearedAtEpochMs: Date.parse(FIXED_NOW),
      replacedStaleFence: true,
    });
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

  it("replaces an active owner's upload session after its workspace version advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const { runner, sql, storageValues } = createRunnerHarness({ bucket });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_1",
      9,
      "runtime",
      FIXED_NOW,
      "1",
    );
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

  it("refuses a stale owner when creating an upload session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const { runner, sql, storageValues } = createRunnerHarness({ bucket });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_1",
      9,
      "runtime",
      FIXED_NOW,
      "4",
    );
    const staleSession = createWorkspaceSnapshotUploadSessionForTest({
      objectKey:
        `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_stale_create.snapshot.enc`,
      snapshotId: "snapshot_stale_create",
    });
    await expect(runner.createHostedWorkspaceSnapshotUploadSession(staleSession))
      .resolves.toEqual(staleSession);

    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_2",
      10,
      "5",
    );
    const activeSession = {
      ...createWorkspaceSnapshotUploadSessionForTest({
        objectKey:
          `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_active_create.snapshot.enc`,
        snapshotId: "snapshot_active_create",
      }),
      attemptId: "attempt_2",
      expectedWorkspaceVersion: "5",
      leaseGeneration: "10",
      workspaceVersion: "5",
    };
    await expect(runner.createHostedWorkspaceSnapshotUploadSession(activeSession))
      .resolves.toEqual(activeSession);

    await expect(runner.createHostedWorkspaceSnapshotUploadSession(staleSession))
      .resolves.toBeNull();
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: activeSession.snapshotId,
      userId: TEST_USER_ID,
    })).resolves.toEqual(activeSession);
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey(activeSession.snapshotId),
    )).toBeUndefined();
  });

  it("refuses a stale replaced-ref update without overwriting the active upload session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const { flushWaitUntil, runner, sql, storageValues } = createRunnerHarness({ bucket });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_1",
      9,
      "runtime",
      FIXED_NOW,
      "4",
    );
    const staleObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_stale_update.snapshot.enc`;
    const activeObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_active_update.snapshot.enc`;
    const replacedObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_replaced_update.snapshot.enc`;
    const staleSession = createWorkspaceSnapshotUploadSessionForTest({
      objectKey: staleObjectKey,
      snapshotId: "snapshot_stale_update",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2RefForTest({
      objectKey: replacedObjectKey,
      snapshotId: "snapshot_replaced_update",
    });
    await bucket.put(replacedObjectKey, "selected-restore-snapshot");
    await runner.createHostedWorkspaceSnapshotUploadSession(staleSession);
    await expect(runner.rememberHostedWorkspaceSnapshotReplacedRef({
      expectedSession: staleSession,
      replacedSnapshotRef,
    })).resolves.toBe(true);

    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_2",
      10,
      "5",
    );
    const activeSession = {
      ...createWorkspaceSnapshotUploadSessionForTest({
        objectKey: activeObjectKey,
        snapshotId: "snapshot_active_update",
      }),
      attemptId: "attempt_2",
      expectedWorkspaceVersion: "5",
      leaseGeneration: "10",
      workspaceVersion: "5",
    };
    await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);

    await expect(runner.rememberHostedWorkspaceSnapshotReplacedRef({
      expectedSession: staleSession,
      replacedSnapshotRef,
    })).resolves.toBe(false);
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: activeSession.snapshotId,
      userId: TEST_USER_ID,
    })).resolves.toEqual(activeSession);
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey(replacedSnapshotRef.snapshotId),
    )).toMatchObject({
      createdAt: FIXED_NOW,
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotRef.snapshotId,
    });
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey(activeSession.snapshotId),
    )).toBeUndefined();
    await flushWaitUntil();
    expect(bucket.deleted).not.toContain(replacedObjectKey);

    vi.setSystemTime(new Date("2026-04-27T01:05:00.001Z"));
    await runner.alarm();

    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey(replacedSnapshotRef.snapshotId),
    )).toBeUndefined();
    expect(bucket.deleted).toContain(replacedObjectKey);
  });

  it("allows an active owner to advance workspace version while requiring the exact upload session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const { runner, sql, storageValues } = createRunnerHarness({ bucket });
    await runner.bindUser(TEST_USER_ID);
    sql.exec(
      `UPDATE runner_meta
       SET active_attempt_id = ?,
           active_generation = ?,
           active_kind = ?,
           active_started_at = ?,
           active_workspace_version = ?
       WHERE singleton = 1`,
      "attempt_1",
      9,
      "runtime",
      FIXED_NOW,
      "1",
    );
    const objectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_exact_session.snapshot.enc`;
    const replacedObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_exact_replaced.snapshot.enc`;
    const expectedSession = createWorkspaceSnapshotUploadSessionForTest({
      objectKey,
      snapshotId: "snapshot_exact_session",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2RefForTest({
      objectKey: replacedObjectKey,
      snapshotId: "snapshot_exact_replaced",
    });
    storageValues.set(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
      expectedSession,
    );

    await expect(runner.rememberHostedWorkspaceSnapshotReplacedRef({
      expectedSession,
      replacedSnapshotRef,
    })).resolves.toBe(true);
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: expectedSession.snapshotId,
      userId: TEST_USER_ID,
    })).resolves.toEqual({
      ...expectedSession,
      replacedSnapshotRef,
    });

    const currentSession = {
      ...expectedSession,
      expiresAt: "2026-04-27T00:11:00.000Z",
    };
    storageValues.set(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
      currentSession,
    );

    await expect(runner.rememberHostedWorkspaceSnapshotReplacedRef({
      expectedSession,
      replacedSnapshotRef,
    })).resolves.toBe(false);
    await expect(runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: currentSession.snapshotId,
      userId: TEST_USER_ID,
    })).resolves.toEqual(currentSession);
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey(currentSession.snapshotId),
    )).toBeUndefined();
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
    const { flushWaitUntil, runner, sql, storageValues } = createRunnerHarness({
      bucket,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: currentObjectKey,
          snapshotId: "snapshot_current",
        }),
      }),
    });
    await activateWorkspaceSnapshotSessionOwner({ runner, sql });

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

  it("cleans workspace snapshot orphan candidates from the runner alarm without a later upload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const orphanObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_alarm_orphan.snapshot.enc`;
    await bucket.put(orphanObjectKey, "orphan-encrypted-snapshot");
    const { alarms, runner, storageValues } = createRunnerHarness({ bucket });

    await runner.recordHostedWorkspaceSnapshotOrphanCandidate({
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: orphanObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "snapshot_alarm_orphan",
      userId: TEST_USER_ID,
    });
    expect(alarms).toContain("2026-04-26T01:05:00.000Z");

    await runner.alarm();

    expect(bucket.deleted).toContain(orphanObjectKey);
    expect(bucket.objects.has(orphanObjectKey)).toBe(false);
    expect(storageValues.get(
      workspaceSnapshotOrphanCandidateStorageKey("snapshot_alarm_orphan"),
    )).toBeUndefined();
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("does not scan orphan candidates when deleting an upload session", async () => {
    const currentObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_delete_no_scan_session.snapshot.enc`;
    const storageList = vi.fn();
    const { runner, storageValues } = createRunnerHarness({
      onStorageList: storageList,
    });
    storageValues.set(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
      createWorkspaceSnapshotUploadSessionForTest({
        objectKey: currentObjectKey,
        snapshotId: "snapshot_delete_no_scan_session",
      }),
    );
    const userPrefix = await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID });
    for (let i = 0; i < 1_500; i += 1) {
      const snapshotId = `snapshot_delete_no_scan_orphan_${i}`;
      storageValues.set(
        workspaceSnapshotOrphanCandidateStorageKey(snapshotId),
        {
          createdAt: "2026-04-26T00:00:00.000Z",
          objectKey: `${userPrefix}${snapshotId}.snapshot.enc`,
          schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
          snapshotId,
          userId: TEST_USER_ID,
        },
      );
    }

    await expect(runner.deleteHostedWorkspaceSnapshotUploadSession({
      snapshotId: "snapshot_delete_no_scan_session",
      userId: TEST_USER_ID,
    })).resolves.toEqual({ deleted: true });

    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeUndefined();
    expect(storageList).not.toHaveBeenCalled();
  });

  it("cleans replaced workspace snapshots retained on the current upload session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const replacedObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_replaced_session.snapshot.enc`;
    const currentObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_current_session.snapshot.enc`;
    await bucket.put(replacedObjectKey, "replaced-encrypted-snapshot");
    await bucket.put(currentObjectKey, "current-encrypted-snapshot");
    const { alarms, flushWaitUntil, runner, sql, storageValues } = createRunnerHarness({
      bucket,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: currentObjectKey,
          snapshotId: "snapshot_current_session",
        }),
      }),
    });
    await activateWorkspaceSnapshotSessionOwner({ runner, sql });

    await runner.createHostedWorkspaceSnapshotUploadSession(
      {
        ...createWorkspaceSnapshotUploadSessionForTest({
          objectKey: currentObjectKey,
          replacedSnapshotRef: createWorkspaceSnapshotV2RefForTest({
            objectKey: replacedObjectKey,
            snapshotId: "snapshot_replaced_session",
          }),
          snapshotId: "snapshot_current_session",
        }),
        createdAt: FIXED_NOW,
      },
    );

    expect(alarms).toContain("2026-04-27T01:05:00.000Z");
    await flushWaitUntil();
    expect(bucket.objects.has(replacedObjectKey)).toBe(true);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeDefined();

    vi.setSystemTime(new Date("2026-04-27T01:04:59.999Z"));
    await runner.alarm();

    expect(bucket.objects.has(replacedObjectKey)).toBe(true);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeDefined();

    vi.setSystemTime(new Date("2026-04-27T01:05:00.000Z"));
    await runner.alarm();

    expect(bucket.deleted).toContain(replacedObjectKey);
    expect(bucket.objects.has(replacedObjectKey)).toBe(false);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeUndefined();
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("cleans retained legacy workspace snapshot bundles through the delayed alarm path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const bundleStore = createHostedBundleStore({
      bucket,
      key: getTestHostedRuntimeRootKey("runtime"),
      keyId: "udrk:runtime:test-root",
      userId: TEST_USER_ID,
    });
    const legacyBaseRef = await bundleStore.writeBundle(
      "vault",
      new TextEncoder().encode("legacy workspace snapshot base"),
    );
    const legacyDeltaRef = await bundleStore.writeBundle(
      "vault",
      new TextEncoder().encode("legacy workspace snapshot delta"),
    );
    const legacySnapshotRef = buildHostedExecutionWorkingSnapshotRef({
      base: legacyBaseRef,
      delta: legacyDeltaRef,
    });
    const currentObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_current_after_legacy.snapshot.enc`;
    await bucket.put(currentObjectKey, "current-encrypted-snapshot");
    const { runner, sql, storageValues } = createRunnerHarness({
      bucket,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: currentObjectKey,
          snapshotId: "snapshot_current_after_legacy",
        }),
      }),
    });
    await activateWorkspaceSnapshotSessionOwner({ runner, sql });

    await runner.createHostedWorkspaceSnapshotUploadSession({
      ...createWorkspaceSnapshotUploadSessionForTest({
        objectKey: currentObjectKey,
        replacedSnapshotRef: legacySnapshotRef,
        snapshotId: "snapshot_current_after_legacy",
      }),
      createdAt: "2026-04-26T00:00:00.000Z",
    });

    await runner.alarm();

    expect(bucket.deleted).toContain(legacyBaseRef.key);
    expect(bucket.deleted).toContain(legacyDeltaRef.key);
    expect(bucket.objects.has(legacyBaseRef.key)).toBe(false);
    expect(bucket.objects.has(legacyDeltaRef.key)).toBe(false);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeUndefined();
  });

  it("keeps retained upload-session cleanup retryable when replaced snapshot deletion fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const replacedObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_replaced_session_retry.snapshot.enc`;
    const currentObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_current_session_retry.snapshot.enc`;
    class ReplacedDeleteFailureBucket extends MemoryEncryptedR2Bucket {
      failReplacedDelete = true;

      override async delete(key: string | string[]): Promise<void> {
        const keys = Array.isArray(key) ? key : [key];
        if (this.failReplacedDelete && keys.includes(replacedObjectKey)) {
          throw new Error("replaced snapshot delete failed");
        }
        await super.delete(key);
      }
    }
    const bucket = new ReplacedDeleteFailureBucket();
    await bucket.put(replacedObjectKey, "replaced-encrypted-snapshot");
    await bucket.put(currentObjectKey, "current-encrypted-snapshot");
    const { alarms, flushWaitUntil, runner, sql, storageValues } = createRunnerHarness({
      bucket,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: currentObjectKey,
          snapshotId: "snapshot_current_session_retry",
        }),
      }),
    });
    await activateWorkspaceSnapshotSessionOwner({ runner, sql });

    await runner.createHostedWorkspaceSnapshotUploadSession(
      {
        ...createWorkspaceSnapshotUploadSessionForTest({
          objectKey: currentObjectKey,
          replacedSnapshotRef: createWorkspaceSnapshotV2RefForTest({
            objectKey: replacedObjectKey,
            snapshotId: "snapshot_replaced_session_retry",
          }),
          snapshotId: "snapshot_current_session_retry",
        }),
        createdAt: "2026-04-26T00:00:00.000Z",
      },
    );
    await flushWaitUntil();

    expect(bucket.objects.has(replacedObjectKey)).toBe(true);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toMatchObject({
      replacedSnapshotRef: expect.objectContaining({
        objectKey: replacedObjectKey,
      }),
      snapshotId: "snapshot_current_session_retry",
    });
    expect(alarms).toContain("2026-04-26T01:05:00.000Z");
    expect(alarms.at(-1)).not.toBe("deleted");

    bucket.failReplacedDelete = false;
    await runner.alarm();

    expect(bucket.deleted).toContain(replacedObjectKey);
    expect(bucket.objects.has(replacedObjectKey)).toBe(false);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(storageValues.get(workspaceSnapshotUploadSessionCurrentStorageKey())).toBeUndefined();
    expect(alarms.at(-1)).toBe("deleted");
  });

  it("does not delete a newer active upload session after stale cleanup completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const bucket = new MemoryEncryptedR2Bucket();
    const staleObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_stale_session.snapshot.enc`;
    const nextObjectKey =
      `${await hostedWorkspaceSnapshotUserPrefix({ userId: TEST_USER_ID })}snapshot_next_session.snapshot.enc`;
    await bucket.put(staleObjectKey, "stale-encrypted-snapshot");
    await bucket.put(nextObjectKey, "next-encrypted-snapshot");
    let storageValues!: Map<string, unknown>;
    const harness = createRunnerHarness({
      bucket,
      onWorkspaceRead() {
        storageValues.set(
          workspaceSnapshotUploadSessionCurrentStorageKey(),
          createWorkspaceSnapshotUploadSessionForTest({
            objectKey: nextObjectKey,
            snapshotId: "snapshot_next_session",
          }),
        );
      },
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2RefForTest({
          objectKey: staleObjectKey,
          snapshotId: "snapshot_stale_session",
        }),
      }),
    });
    storageValues = harness.storageValues;
    await activateWorkspaceSnapshotSessionOwner({
      runner: harness.runner,
      sql: harness.sql,
    });

    await harness.runner.createHostedWorkspaceSnapshotUploadSession(
      {
        ...createWorkspaceSnapshotUploadSessionForTest({
          objectKey: staleObjectKey,
          snapshotId: "snapshot_stale_session",
        }),
        createdAt: "2026-04-26T00:00:00.000Z",
      },
    );
    await harness.runner.alarm();

    await expect(harness.runner.readHostedWorkspaceSnapshotUploadSession({
      snapshotId: "snapshot_next_session",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      objectKey: nextObjectKey,
      snapshotId: "snapshot_next_session",
    });
    expect(bucket.objects.has(staleObjectKey)).toBe(true);
    expect(bucket.objects.has(nextObjectKey)).toBe(true);
    expect(bucket.deleted).not.toContain(nextObjectKey);
  });
});

async function activateWorkspaceSnapshotSessionOwner(input: {
  runner: HostedUserRunner;
  sql: TestSqlStorageLike;
}): Promise<void> {
  await input.runner.bindUser(TEST_USER_ID);
  input.sql.exec(
    `UPDATE runner_meta
     SET active_attempt_id = ?,
         active_generation = ?,
         active_kind = ?,
         active_started_at = ?,
         active_workspace_version = ?
     WHERE singleton = 1`,
    "attempt_1",
    9,
    "runtime",
    FIXED_NOW,
    "4",
  );
}

function createRunnerHarness(input: {
  alarmDeleteError?: Error;
  abortWorkspaceInvocation?: HostedExecutionContainerStubLike["abortWorkspaceInvocation"];
  bucket?: MemoryEncryptedR2Bucket;
  destroyInstance?: HostedExecutionContainerStubLike["destroyInstance"];
  ensureReadyForProcessing?: HostedExecutionContainerStubLike["ensureReadyForProcessing"] | null;
  ensureProcessing?: HostedExecutionContainerStubLike["ensureProcessing"];
  invocationResults?: Array<Error | HostedWorkspaceInvocationResult | Promise<HostedWorkspaceInvocationResult>>;
  mailboxLag?: HostedRuntimeWebStatusResponse["mailboxLag"];
  onCryptoContextRead?: () => Promise<void> | void;
  onOwnerReleased?: (input: { timeoutMs: number }) => Promise<void> | void;
  onStatusRead?: () => Promise<void> | void;
  onStorageList?: (input: { prefix?: string }) => Promise<void> | void;
  onWorkspaceRead?: (input: { timeoutMs: number }) => Promise<void> | void;
  readActiveRuntimeUserFence?: HostedExecutionContainerStubLike["readActiveRuntimeUserFence"];
  ownerReleaseResponse?: () => Promise<Response> | Response;
  runtimeLogResponse?: () => Promise<Response> | Response;
  runnerRuntimeEnvSource?: Readonly<Record<string, unknown>>;
  runnerContainerNamespace?: HostedExecutionContainerNamespaceLike | null;
  wakeRuntime?: HostedExecutionContainerStubLike["wakeRuntime"];
  workspace?: HostedWorkspaceState | null;
} = {}) {
  const durable = createDurableObjectState({
    alarmDeleteError: input.alarmDeleteError,
    onStorageList: input.onStorageList,
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
  const readActiveRuntimeUserFenceInput = input.readActiveRuntimeUserFence;
  const abortWorkspaceInvocationInput = input.abortWorkspaceInvocation;
  const ensureReadyForProcessing = input.ensureReadyForProcessing === null
    ? null
    : createDirectOnlyRpcMethod<NonNullable<HostedExecutionContainerStubLike["ensureReadyForProcessing"]>>(
        async function (
          this: HostedExecutionContainerStubLike,
          ensureInput,
        ) {
          return await input.ensureReadyForProcessing?.call(this, ensureInput) ?? { kind: "ready" };
        },
      );
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: input.destroyInstance ?? (async () => {}),
    ...(abortWorkspaceInvocationInput
      ? {
          abortWorkspaceInvocation: createDirectOnlyRpcMethod<
            NonNullable<HostedExecutionContainerStubLike["abortWorkspaceInvocation"]>
          >(
            async function (
              this: HostedExecutionContainerStubLike,
              abortInput,
            ) {
              expect(this).toBe(stub);
              return await abortWorkspaceInvocationInput.call(this, abortInput);
            },
          ),
        }
      : {}),
    ...(ensureReadyForProcessing ? { ensureReadyForProcessing } : {}),
    ...(input.ensureProcessing
      ? {
          ensureProcessing: createDirectOnlyRpcMethod<
            NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>
          >(
            async function (
              this: HostedExecutionContainerStubLike,
              ensureInput,
            ) {
              if (ensureInput.invoke) {
                return {
                  action: ensureInput.activeRuntime ? "restarted" : "started",
                  kind: "accepted",
                  result: await invoke(ensureInput.invoke),
                };
              }
              return await input.ensureProcessing?.call(this, ensureInput) ?? {
                kind: "start-required",
                reason: "no-active-child",
              };
            },
          ),
        }
      : {}),
    ...(input.wakeRuntime
      ? {
          wakeRuntime: createDirectOnlyRpcMethod<
            NonNullable<HostedExecutionContainerStubLike["wakeRuntime"]>
          >(
            async function (
              this: HostedExecutionContainerStubLike,
              wakeInput,
            ) {
              expect(this).toBe(stub);
              return await input.wakeRuntime?.call(this, wakeInput) ?? {
                kind: "not-wakeable",
                reason: "no-active-child",
              };
            },
          ),
        }
      : {}),
    invoke,
    smokeHealth: async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    }),
    ...(readActiveRuntimeUserFenceInput
      ? {
          readActiveRuntimeUserFence: createDirectOnlyRpcMethod<
            NonNullable<HostedExecutionContainerStubLike["readActiveRuntimeUserFence"]>
          >(
            async function (this: HostedExecutionContainerStubLike) {
              expect(this).toBe(stub);
              return await readActiveRuntimeUserFenceInput.call(this);
            },
          ),
        }
      : {}),
  };
  const runnerContainerNames: string[] = [];
  const namespace: HostedExecutionContainerNamespaceLike = {
    getByName(name) {
      runnerContainerNames.push(name);
      return stub;
    },
  };

  installWebControlResponses(input.workspace ?? createWorkspaceState(), {
    readMailboxLag: () => input.mailboxLag ?? [createMailboxLag()],
    onCryptoContextRead: input.onCryptoContextRead,
    onStatusRead: input.onStatusRead,
    onOwnerReleased: input.onOwnerReleased,
    onWorkspaceRead: input.onWorkspaceRead,
    runtimeLogResponse: input.runtimeLogResponse,
    ownerReleaseResponse: input.ownerReleaseResponse,
  });

  const runner = new HostedUserRunnerWithTestControls(
    durable.state,
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
      HOSTED_EXECUTION_RETRY_DELAY_MS: "5000",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "35000",
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
    runnerContainerNames,
    sql: durable.sql,
    storageValues: durable.storageValues,
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
  onStorageList?: (input: { prefix?: string }) => Promise<void> | void;
} = {}): {
  alarms: string[];
  state: DurableObjectStateLike;
  waitUntilPromises: Promise<unknown>[];
  storageValues: Map<string, unknown>;
  sql: TestSqlStorageLike;
} {
  const alarms: string[] = [];
  let activeAlarm: number | null = null;
  const sql = createTestSqlStorage();
  const waitUntilPromises: Promise<unknown>[] = [];
  const values = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => values.delete(key),
    deleteAlarm: async () => {
      if (input.alarmDeleteError) {
        throw input.alarmDeleteError;
      }
      activeAlarm = null;
      alarms.push("deleted");
    },
    get: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
    getAlarm: async () => activeAlarm,
    list: async <T>(options: { prefix?: string } = {}): Promise<Map<string, T>> => {
      await input.onStorageList?.(options);
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
      activeAlarm = date.getTime();
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
    onCryptoContextRead?: () => Promise<void> | void;
    onWorkspaceRead?: (input: { timeoutMs: number }) => Promise<void> | void;
    onOwnerReleased?: (input: { timeoutMs: number }) => Promise<void> | void;
    onStatusRead?: () => Promise<void> | void;
    readMailboxLag?: () => HostedRuntimeWebStatusResponse["mailboxLag"];
    runtimeLogResponse?: () => Promise<Response> | Response;
    ownerReleaseResponse?: () => Promise<Response> | Response;
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
        await hooks.onCryptoContextRead?.();
        return jsonResponse(
          await createTestHostedRuntimeCryptoContext(input.boundUserId),
        );
      }

      if (input.path === HOSTED_RUNTIME_LOG_PATH) {
        return await hooks.runtimeLogResponse?.() ?? jsonResponse({
          loggedCount: 1,
        });
      }

      if (input.path === HOSTED_RUNTIME_OWNER_RELEASED_PATH) {
        await hooks.onOwnerReleased?.({ timeoutMs: input.timeoutMs });
        return await hooks.ownerReleaseResponse?.() ?? jsonResponse({
          signaled: true,
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

async function createWorkspaceSnapshotV2RefWithRuntimeRootForTest(input: {
  objectKey: string;
  snapshotId: string;
}): Promise<HostedWorkspaceSnapshotV2Ref> {
  const aad = buildHostedWorkspaceSnapshotV2Aad({
    objectKey: input.objectKey,
    snapshotId: input.snapshotId,
    userId: TEST_USER_ID,
  });
  const rootKeyId = "udrk:runtime:test-root";
  const dataKey = createHostedWorkspaceSnapshotV2DataKey();
  const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
    aad,
    dataKey,
    rootKey: getTestHostedRuntimeRootKey("runtime"),
    rootKeyId,
  });
  dataKey.fill(0);

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
      aad,
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId,
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey,
    },
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId: input.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: TEST_USER_ID,
  };
}

function createWorkspaceSnapshotUploadSessionForTest(input: {
  objectKey: string;
  replacedSnapshotRef?: HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"];
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
    ...(input.replacedSnapshotRef ? { replacedSnapshotRef: input.replacedSnapshotRef } : {}),
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

function createRuntimeStartupTimeoutError(): Error {
  const error = new Error("The operation timed out.");
  error.name = "TimeoutError";
  return error;
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
    processingMode?: "default" | "inbox_media_retention" | "system_mailbox";
    runnerContainerName?: string | null;
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
         active_runner_container_name = ?,
         active_started_at = ?,
         active_workspace_version = ?
     WHERE singleton = 1`,
    attemptId,
    generation,
    "runtime",
    input.processingMode ?? "nudge",
    input.runnerContainerName ?? null,
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
  active_expires_at: null;
  active_generation: number;
  active_started_at: string | null;
  active_workspace_version: string | null;
  backoff_until: null;
  failure_count: number;
  last_invocation_at: string | null;
  wake_at: null;
} {
  return sql.exec<{
    active_attempt_id: string | null;
    active_expires_at: null;
    active_generation: number;
    active_started_at: string | null;
    active_workspace_version: string | null;
    backoff_until: null;
    failure_count: number;
    last_invocation_at: string | null;
    wake_at: null;
  }>(
    `SELECT active_attempt_id,
            NULL AS active_expires_at,
            active_generation,
            active_started_at,
            active_workspace_version,
            NULL AS backoff_until,
            failure_count,
            last_invocation_at,
            NULL AS wake_at
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
