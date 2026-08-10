import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  parseHostedRuntimeLogRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_OWNER_RELEASED_PATH,
} from "@murphai/hosted-execution/routes";
import {
  readHostedRuntimeFailurePhaseCode,
  type HostedRuntimeWebStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedExecutionEnvironment,
} from "../src/env.js";
import type {
  R2BucketLike,
} from "../src/bundle-store.js";
import {
  RunnerContainer,
  type HostedExecutionContainerNamespaceLike,
  type HostedExecutionContainerStubLike,
  type RunnerContainerEnsureProcessingResult,
} from "../src/runner-container.js";
import {
  classifyRunnerJobError,
} from "../src/container-entrypoint.js";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "../src/hosted-runtime-architecture.js";
import {
  HostedRuntimeControlPlaneFetchError,
} from "../src/runtime-platform/control-plane-fetch.js";
import {
  buildHostedRunnerJobRuntimeConfig,
} from "../src/runner-env.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.js";
import type {
  WorkerActiveRuntimeUserFenceResult,
} from "../src/worker-contracts.js";
import {
  buildHostedRunnerRedactedErrorJson,
} from "../src/user-runner/diagnostics.js";
import {
  RunnerSecretsService,
} from "../src/user-runner/runner-secrets.js";
import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
} from "../src/user-runner/runner-state-store.js";
import {
  RuntimeInvocationService,
  type PreparedRuntimeInvocation,
} from "../src/user-runner/runtime-invocation.js";
import {
  RunnerStoreCache,
  type RunnerUserStores,
} from "../src/user-runner/runner-store-cache.js";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.js";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.js";
import {
  createTestHostedRuntimeCryptoContext,
  getTestHostedRuntimeRootKey,
} from "./hosted-runtime-crypto-fixtures.js";
import {
  createTestSqlStorage,
} from "./sql-storage.js";

const FIXED_NOW = "2026-06-11T00:00:00.000Z";
const TEST_USER_ID = "member_123";
const TEST_RUNNER_CONTAINER_NAME = "member_123--v-version_1";

describe("runtime invocation transport failure fence handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("persists the runtime phase for a natural generic control-plane failure", async () => {
    const hiddenCauseMessage = "private control-plane network detail";
    const controlPlaneFailure = new HostedRuntimeControlPlaneFetchError({
      cause: new TypeError(hiddenCauseMessage),
      description: "Hosted workspace read",
      signalState: {
        callerSignalAborted: false,
        requestSignalAborted: false,
        timeoutMs: 5_000,
        timeoutSignalAborted: false,
      },
    });
    expect(controlPlaneFailure.code).toBe("type_error");

    const runtimeFailure = await runHostedWorkspaceRuntimeJobInProcess({
      request: {
        attemptId: "attempt_control_plane_phase",
        idleCheckpointDelayMs: 1,
        leaseGeneration: "1",
        userId: TEST_USER_ID,
        workspaceVersion: "0",
      },
    }, {
      async createCheckpointSnapshot() {
        throw new Error("Checkpoint should not run after workspace read failure.");
      },
      async importItem() {
        throw new Error("Mailbox import should not run after workspace read failure.");
      },
      platform: {
        artifactStore: {
          async get() {
            return null;
          },
          async put() {},
        },
        effectsPort: {
          async readRawEmailMessage() {
            return null;
          },
          async sendEmail() {},
        },
        mailboxPort: {
          async fetch() {
            throw new Error("Mailbox fetch should not run after workspace read failure.");
          },
          async fetchPayload() {
            throw new Error("Mailbox payload fetch should not run after workspace read failure.");
          },
        },
        workspacePort: {
          async checkpoint() {
            throw new Error("Checkpoint should not run after workspace read failure.");
          },
          async read() {
            throw controlPlaneFailure;
          },
        },
      },
      vaultRoot: "synthetic-control-plane-failure-vault",
    }).catch((error: unknown) => error);

    expect(runtimeFailure).toBe(controlPlaneFailure);
    expect(readHostedRuntimeFailurePhaseCode(runtimeFailure)).toBe(
      "runtime_phase:workspace.read",
    );

    const classified = classifyRunnerJobError(runtimeFailure);
    expect(classified).toMatchObject({
      payload: {
        code: "runtime_error",
        details: {
          errorCodeDetail: "type_error",
          runtimeFailurePhaseCode: "runtime_phase:workspace.read",
        },
      },
      statusCode: 500,
    });

    const storage = createRunnerContainerStorageDouble();
    let runnerStatus: "running" | "stopped" = "stopped";
    const container = new RunnerContainer({ storage } as never, {} as never);
    Object.assign(container, {
      containerFetch: vi.fn(async (url: string) => {
        if (String(url).endsWith("/health")) {
          return new Response(JSON.stringify({
            activeJobCount: 0,
            conversationWarmActivityCompletedAtEpochMs: null,
            hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
            ok: true,
          }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify(classified.payload), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: classified.statusCode,
        });
      }),
      async destroy() {
        runnerStatus = "stopped";
      },
      async getState() {
        return {
          lastChange: Date.now(),
          status: runnerStatus,
        };
      },
      async start() {
        runnerStatus = "running";
      },
      async startAndWaitForPorts() {
        runnerStatus = "running";
      },
      storage,
    });

    const processingFailure = await container.ensureProcessing({
      invoke: {
        job: {
          kind: "workspace-invocation",
          request: {
            attemptId: "attempt_control_plane_phase",
            leaseGeneration: "1",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        },
        timeoutMs: 10_000,
        userId: TEST_USER_ID,
      },
      userId: TEST_USER_ID,
    });

    expect(processingFailure).toEqual({
      failure: {
        code: "runtime_error",
        errorCodeDetail: "type_error",
        runtimeFailurePhaseCode: "runtime_phase:workspace.read",
        status: 500,
      },
      kind: "failed",
    });
    if (processingFailure.kind !== "failed") {
      throw new Error("Expected RunnerContainer to return a processing failure.");
    }

    const harness = await createTransportFailureHarness({
      ensureProcessingFailure: processingFailure,
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: token.leaseGeneration,
        userId: TEST_USER_ID,
      }),
    });

    await expect(harness.invoke()).rejects.toMatchObject({
      code: "runtime_error",
      details: {
        errorCodeDetail: "type_error",
        runtimeFailurePhaseCode: "runtime_phase:workspace.read",
      },
      message: "Hosted execution runtime failed. Code: type_error. Status: 500.",
      status: 500,
      statusCode: 500,
    });
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        errorCode: "runtime_error",
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          errorCodeDetail: "runtime_phase:workspace.read",
          safeErrorDetail:
            "Hosted execution runtime failed. Code: type_error. Status: 500.",
        }),
      }),
    ]);
    expect(JSON.stringify(harness.loggedFailureEntries())).not.toContain(hiddenCauseMessage);
  });

  it("preserves a typed failure and safe source code through the plain RPC result", async () => {
    const harness = await createTransportFailureHarness({
      ensureProcessingFailure: {
        failure: {
          code: "type_error",
          errorCodeDetail: "EACCES",
          runtimeFailurePhaseCode: null,
          status: 500,
        },
        kind: "failed",
      },
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: token.leaseGeneration,
        userId: TEST_USER_ID,
      }),
    });

    await expect(harness.invoke()).rejects.toMatchObject({
      code: "type_error",
      details: {
        errorCodeDetail: "EACCES",
      },
      message: "Hosted execution runtime failed. Code: EACCES. Status: 500.",
      name: "TypeError",
      status: 500,
      statusCode: 500,
    });
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        errorCode: "type_error",
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          errorCode: "type_error",
          errorCodeDetail: "type_error",
          safeErrorDetail:
            "Hosted execution runtime failed. Code: EACCES. Status: 500.",
        }),
      }),
    ]);
  });

  it("keeps the write fence when the invocation is still active in the container", async () => {
    const rawHostedId = "hbm_abcdefghijklmnop-";
    const rawPath = "/tmp/runtime.log";
    const rawUrl = "https://internal.example.test/private?token=url-secret";
    const rawEmail = "operator@example.test";
    const rawPhone = "+15551234567";
    const rawToken = "raw-token";
    const safeDetailPrefix =
      "container transport failed for hbm_<redacted-id> at <REDACTED_PATH> "
      + "via <REDACTED_URL> contact [redacted-email] [redacted-phone] token=[redacted] ";
    const safeCausePrefix = "authorization=Bearer [redacted] ";
    const invocationError = new Error(
      `container transport failed for ${rawHostedId} at ${rawPath} via ${rawUrl} `
      + `contact ${rawEmail} ${rawPhone} token=${rawToken} ${"x".repeat(400)}`,
      {
        cause: new Error(`authorization=Bearer cause-secret ${"y".repeat(400)}`),
      },
    );
    Object.assign(invocationError, {
      code: "runtime_error",
      details: {
        errorCodeDetail: "runtime_phase:workspace.checkpoint.idle_compact",
      },
    });
    const harness = await createTransportFailureHarness({
      invocationError,
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: token.leaseGeneration,
        userId: TEST_USER_ID,
      }),
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        errorCode: "runtime_error",
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptStillActive: true,
          errorCode: "runtime_error",
          errorCodeDetail: "runtime_phase:workspace.checkpoint.idle_compact",
          fenceCleared: false,
          safeErrorCause:
            `${safeCausePrefix}${"y".repeat(319 - safeCausePrefix.length)}…`,
          safeErrorDetail:
            `${safeDetailPrefix}${"x".repeat(319 - safeDetailPrefix.length)}…`,
        }),
      }),
    ]);
    const serializedEntries = JSON.stringify(harness.loggedFailureEntries());
    for (const rawSensitiveValue of [
      rawHostedId,
      rawPath,
      rawUrl,
      rawEmail,
      rawPhone,
      rawToken,
      "cause-secret",
    ]) {
      expect(serializedEntries).not.toContain(rawSensitiveValue);
    }
  });

  it("keeps the accepted write fence when the local active pointer is missing but progress is not durable yet", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [
          {
            importedSeq: "0",
            lag: "1",
            lane: "conversation",
            maxSeq: "1",
          },
        ],
        userId,
        workspace: {
          createdAt: FIXED_NOW,
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatus: {},
          snapshotRef: null,
          updatedAt: FIXED_NOW,
          userId,
          version: "0",
        },
      }),
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "inactive",
          attemptStillActive: false,
          fenceCleared: false,
        }),
      }),
    ]);
  });

  it("clears the write fence for non-accepted attempts when no invocation is active in the container", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
    });

    await expect(
      harness.invoke({ acceptedProcessingAttempt: false }),
    ).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(harness.loggedFailureEntries()).toEqual([]);
  });

  it("clears the write fence when the container runs a different attempt", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: true,
        attemptId: "runtime-write-other-attempt",
        leaseGeneration: "99",
        userId: TEST_USER_ID,
      }),
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("keeps the accepted write fence when the liveness probe itself fails but progress is not durable yet", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => {
        throw new Error("container probe unreachable");
      },
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "error",
          attemptStillActive: false,
          fenceCleared: false,
        }),
      }),
    ]);
  });

  it("keeps the accepted write fence when liveness fails even if committed progress is visible", async () => {
    const readHostedRuntimeStatusFromWeb = vi.fn(async (userId: string) => ({
      mailboxLag: [],
      userId,
      workspace: {
        createdAt: FIXED_NOW,
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: FIXED_NOW,
        userId,
        version: "1",
      },
    }));
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => {
        throw new Error("container health still active");
      },
      readHostedRuntimeStatusFromWeb,
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "error",
          attemptStillActive: false,
          fenceCleared: false,
        }),
      }),
    ]);
    expect(readHostedRuntimeStatusFromWeb).not.toHaveBeenCalled();
  });

  it("keeps the accepted write fence when the liveness probe hangs past its timeout but progress is not durable yet", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: () =>
        new Promise<WorkerActiveRuntimeUserFenceResult>(() => {}),
    });

    const invocation = harness.invoke();
    // Attach rejection handling before advancing timers so the rejection that
    // resolves the probe race is never treated as unhandled.
    const settled = invocation.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(settled).resolves.toBe("rejected");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "timeout",
          attemptStillActive: false,
          fenceCleared: false,
        }),
      }),
    ]);
  });

  it("clears the write fence when only the lease generation differs", async () => {
    const readHostedRuntimeStatusFromWeb = vi.fn(async (userId: string) => ({
      mailboxLag: [],
      userId,
      workspace: {
        createdAt: FIXED_NOW,
        nextWakeAt: "2026-06-11T00:05:00.000Z",
        nextWakeReason: "scheduled_wake",
        redactedStatus: { lastTurn: "ok" },
        snapshotRef: null,
        updatedAt: FIXED_NOW,
        userId,
        version: "1",
      },
    }));
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: "999",
        userId: TEST_USER_ID,
      }),
      readHostedRuntimeStatusFromWeb,
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(readHostedRuntimeStatusFromWeb).not.toHaveBeenCalled();
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "mismatch",
          attemptStillActive: false,
          fenceCleared: true,
        }),
      }),
    ]);
  });

  it("clears the write fence when the container reports the attempt for a different user", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: token.leaseGeneration,
        userId: "member_999",
      }),
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("keeps the accepted write fence when the container stub lacks the liveness probe method but progress is not durable yet", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: null,
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptLivenessProbeOutcome: "unsupported",
          attemptStillActive: false,
          fenceCleared: false,
        }),
      }),
    ]);
  });

  it("does not trust committed progress when the container stub lacks the liveness probe method", async () => {
    const readHostedRuntimeStatusFromWeb = vi.fn(async (userId: string) => ({
      mailboxLag: [],
      userId,
      workspace: {
        createdAt: FIXED_NOW,
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        snapshotRef: null,
        updatedAt: FIXED_NOW,
        userId,
        version: "1",
      },
    }));
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: null,
      readHostedRuntimeStatusFromWeb,
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(readHostedRuntimeStatusFromWeb).not.toHaveBeenCalled();
    expect(harness.ownerReleaseCallCount()).toBe(0);
  });

  it("keeps the fence without posting an accepted-attempt-failed row for non-accepted attempts", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: token.leaseGeneration,
        userId: TEST_USER_ID,
      }),
    });

    await expect(
      harness.invoke({ acceptedProcessingAttempt: false }),
    ).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([]);
  });

  it("keeps a non-accepted fence when container liveness is unsupported", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: null,
    });

    await expect(
      harness.invoke({ acceptedProcessingAttempt: false }),
    ).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.loggedFailureEntries()).toEqual([]);
  });

  for (const livenessFailure of ["error", "timeout"] as const) {
    it(`keeps a non-accepted fence when container liveness ends in ${livenessFailure}`, async () => {
      const harness = await createTransportFailureHarness({
        readActiveRuntimeUserFence: livenessFailure === "error"
          ? async () => {
              throw new Error("container probe unavailable");
            }
          : () => new Promise<WorkerActiveRuntimeUserFenceResult>(() => {}),
      });

      const invocation = harness.invoke({ acceptedProcessingAttempt: false });
      const settled = invocation.then(
        () => "resolved" as const,
        () => "rejected" as const,
      );
      if (livenessFailure === "timeout") {
        await vi.advanceTimersByTimeAsync(6_000);
      }

      await expect(settled).resolves.toBe("rejected");
      await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
        expect.objectContaining({
          attemptId: harness.token.attemptId,
          userId: TEST_USER_ID,
        }),
      );
      expect(harness.loggedFailureEntries()).toEqual([]);
      expect(harness.ownerReleaseCallCount()).toBe(0);
    });
  }

  it("returns committed progress when the inactive attempt advanced the workspace with newer mailbox input still ahead", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [
          {
            importedSeq: "1",
            lag: "1",
            lane: "conversation",
            maxSeq: "2",
          },
        ],
        userId,
        workspace: {
          checkpointedAt: "2026-06-11T00:01:00.000Z",
          createdAt: FIXED_NOW,
          nextWakeAt: "2026-06-11T00:05:00.000Z",
          nextWakeReason: "scheduled_wake",
          redactedStatus: { lastTurn: "ok" },
          snapshotRef: null,
          updatedAt: FIXED_NOW,
          userId,
          version: "1",
        },
      }),
    });

    await expect(harness.invoke()).resolves.toEqual({
      nextWakeAt: "2026-06-11T00:05:00.000Z",
      nextWakeReason: "scheduled_wake",
      redactedStatus: { lastTurn: "ok" },
      status: "idle",
    });

    // Fence released through the completion path, with no failure row posted.
    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(harness.loggedFailureEntries()).toEqual([]);
    expect(harness.ownerReleaseCallCount()).toBe(1);
  });

  it("does not treat a version-only administrative transition as runtime progress", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [],
        userId,
        workspace: {
          checkpointedAt: null,
          createdAt: FIXED_NOW,
          nextWakeAt: FIXED_NOW,
          nextWakeReason: "inbox_media_retention",
          redactedStatus: {},
          snapshotRef: null,
          updatedAt: FIXED_NOW,
          userId,
          version: "1",
        },
      }),
    });

    await expect(harness.invoke()).rejects.toThrow(
      "container transport failed",
    );
    await expect(harness.stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        attemptId: harness.token.attemptId,
        userId: TEST_USER_ID,
      }),
    );
    expect(harness.ownerReleaseCallCount()).toBe(0);
  });

  it("requests one immediate recheck when recovered progress published a due default wake", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [],
        userId,
        workspace: {
          checkpointedAt: "2026-06-11T00:01:00.000Z",
          createdAt: FIXED_NOW,
          nextWakeAt: FIXED_NOW,
          nextWakeReason: "assistant",
          redactedStatus: { lastTurn: "staged" },
          snapshotRef: null,
          updatedAt: FIXED_NOW,
          userId,
          version: "1",
        },
      }),
    });

    await expect(harness.invoke()).resolves.toEqual({
      immediateRecheckRequested: true,
      nextWakeAt: FIXED_NOW,
      nextWakeReason: "assistant",
      redactedStatus: { lastTurn: "staged" },
      status: "idle",
    });
    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(harness.ownerReleaseCallCount()).toBe(1);
  });

  it("keeps a recovered future mailbox retry on its authoritative timer", async () => {
    const futureRetryAt = "2026-06-11T00:00:15.000Z";
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [{
          importedSeq: "1",
          lag: "1",
          lane: "conversation",
          maxSeq: "2",
        }],
        userId,
        workspace: {
          checkpointedAt: "2026-06-11T00:01:00.000Z",
          createdAt: FIXED_NOW,
          nextWakeAt: futureRetryAt,
          nextWakeReason: "mailbox",
          redactedStatus: {
            hostedMailboxRetryableBlockedCount: 1,
          },
          snapshotRef: null,
          updatedAt: FIXED_NOW,
          userId,
          version: "1",
        },
      }),
    });

    await expect(harness.invoke()).resolves.toEqual({
      nextWakeAt: futureRetryAt,
      nextWakeReason: "mailbox",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: 1,
      },
      status: "idle",
    });
    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(harness.ownerReleaseCallCount()).toBe(0);
  });
});

describe("buildHostedRunnerRedactedErrorJson", () => {
  it("keeps scalar diagnostics plus bounded sanitized detail and cause in the persisted redacted shape", () => {
    const error = new Error(
      "container transport failed for hbm_abcdefghijklmnop- at /tmp/runtime.log",
      { cause: new Error("authorization=Bearer secret-token") },
    );
    const redacted = buildHostedRunnerRedactedErrorJson(error);

    expect(redacted).toEqual({
      detailsKeys: ["errorCause", "errorCode", "errorDetail", "errorMessage", "errorName"],
      errorCode: "runtime_error",
      errorDetailPresent: true,
      errorName: "Error",
      safeErrorCause: "authorization=Bearer [redacted]",
      safeErrorDetail:
        "container transport failed for hbm_<redacted-id> at <REDACTED_PATH>",
      safeErrorMessage: "Hosted execution runtime failed.",
    });
    expect(JSON.stringify(redacted)).not.toContain("abcdefghijklmnop-");
    expect(JSON.stringify(redacted)).not.toContain("/tmp/runtime.log");
    expect(JSON.stringify(redacted)).not.toContain("secret-token");
  });

  it("returns an empty redacted object for undefined errors", () => {
    expect(buildHostedRunnerRedactedErrorJson(undefined)).toEqual({});
  });

  it("drops errorCodeDetail values that do not look like plain code tokens", () => {
    const pathShapedCode = new Error("boom");
    Object.assign(pathShapedCode, { code: "/etc/passwd leaked via code" });

    const redacted = buildHostedRunnerRedactedErrorJson(pathShapedCode);

    expect(redacted).not.toHaveProperty("errorCodeDetail");
    expect(JSON.stringify(redacted)).not.toContain("/etc/passwd");
  });

  it("keeps errorCodeDetail values that look like plain code tokens", () => {
    const tokenCode = new Error("boom");
    Object.assign(tokenCode, { code: "ECONNRESET" });

    expect(buildHostedRunnerRedactedErrorJson(tokenCode)).toMatchObject({
      errorCodeDetail: "ECONNRESET",
    });
  });

  it("does not promote identifier-shaped nested detail over the outer error code", () => {
    const nestedIdentifier = Object.assign(new Error("boom"), {
      code: "runtime_error",
      details: {
        errorCodeDetail: "member_123456789",
      },
    });

    const redacted = buildHostedRunnerRedactedErrorJson(nestedIdentifier);

    expect(redacted).toMatchObject({
      errorCodeDetail: "runtime_error",
    });
    expect(JSON.stringify(redacted)).not.toContain("member_123456789");
  });
});

function createRunnerContainerStorageDouble() {
  const values = new Map<string, unknown>();

  return {
    async delete(key: string): Promise<boolean> {
      return values.delete(key);
    },
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
      return new Map(
        Array.from(values.entries())
          .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
          .map(([key, value]) => [key, value as T]),
      );
    },
    async put<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
  };
}

async function createTransportFailureHarness(input: {
  ensureProcessingFailure?: Extract<
    RunnerContainerEnsureProcessingResult,
    { kind: "failed" }
  >;
  invocationError?: Error;
  /** `null` omits the probe method from the container stub entirely. */
  readActiveRuntimeUserFence:
    | ((
        token: RunnerWriteFenceToken,
      ) => Promise<WorkerActiveRuntimeUserFenceResult>)
    | null;
  readHostedRuntimeStatusFromWeb?: (
    userId: string,
  ) => Promise<HostedRuntimeWebStatusResponse>;
}): Promise<{
  invoke: (overrides?: { acceptedProcessingAttempt?: boolean }) => Promise<unknown>;
  loggedFailureEntries: () => unknown[];
  ownerReleaseCallCount: () => number;
  stateStore: RunnerStateStore;
  token: RunnerWriteFenceToken;
}> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));

  const loggedBodies: unknown[] = [];
  let ownerReleaseCallCount = 0;
  vi.stubGlobal("fetch", async (request: Request | string, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.includes("/hosted-runtime/log")) {
      const rawBody = typeof request === "string"
        ? init?.body
        : await request.clone().text();
      loggedBodies.push(JSON.parse(String(rawBody)));
      return Response.json({ loggedCount: 1 });
    }
    if (url.includes(HOSTED_RUNTIME_OWNER_RELEASED_PATH)) {
      ownerReleaseCallCount += 1;
      return Response.json({ signaled: true });
    }
    return Response.json({}, { status: 404 });
  });

  const readActiveRuntimeUserFenceInput = input.readActiveRuntimeUserFence;
  const durable = createRunnerDurableState();
  const stateStore = new RunnerStateStore(durable.state);
  await stateStore.bindUser(TEST_USER_ID);
  const token = await stateStore.beginWriteFence({
    runnerContainerName: TEST_RUNNER_CONTAINER_NAME,
    userId: TEST_USER_ID,
  });

  const service = new RuntimeInvocationService({
    assertWorkspaceBelongsToRunnerUser() {},
    env: createHostedExecutionEnvironment(),
    readHostedRuntimeStatusFromWeb: input.readHostedRuntimeStatusFromWeb
      ?? (async (userId) => ({
        mailboxLag: [],
        userId,
        workspace: null,
      })),
    readHostedWebControlBaseUrl: () => "https://web.example.test",
    readHostedWorkspaceFromWeb: async () => ({
      fetchedAt: FIXED_NOW,
      workspace: null,
    }),
    runnerContainerNamespace: createFailingInvokeContainerNamespace({
      ensureProcessingFailure: input.ensureProcessingFailure,
      invocationError: input.invocationError,
      readActiveRuntimeUserFence: readActiveRuntimeUserFenceInput
        ? (() => readActiveRuntimeUserFenceInput(token))
        : null,
    }),
    runnerRuntimeEnvSource: {},
    runnerStoreCache: new TestRunnerStoreCache({}),
    stateStore,
  });

  const prepared: PreparedRuntimeInvocation = {
    input: {
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    },
    job: createWorkspaceInvocationJob({ token, userId: TEST_USER_ID }),
    runnerContainerName: TEST_RUNNER_CONTAINER_NAME,
    token,
    workspaceCheckpointedAt: null,
    workspaceVersion: "0",
  };

  return {
    invoke: (overrides?: { acceptedProcessingAttempt?: boolean }) =>
      service.invokePreparedWithFence({
        acceptedProcessingAttempt: overrides?.acceptedProcessingAttempt ?? true,
        prepared,
        runtimeWakeStartedAt: Date.now(),
      }),
    // Parse through the real web-route request parser so every asserted entry
    // also proves the enriched row passes the hosted runtime-log
    // redacted-key gate instead of being rejected by `apps/web` in production.
    loggedFailureEntries: () => loggedBodies.flatMap((body) =>
      parseHostedRuntimeLogRequest(body).entries
    ),
    ownerReleaseCallCount: () => ownerReleaseCallCount,
    stateStore,
    token,
  };
}

function createFailingInvokeContainerNamespace(input: {
  ensureProcessingFailure?: Extract<
    RunnerContainerEnsureProcessingResult,
    { kind: "failed" }
  >;
  invocationError?: Error;
  readActiveRuntimeUserFence:
    | (() => Promise<WorkerActiveRuntimeUserFenceResult>)
    | null;
}): HostedExecutionContainerNamespaceLike {
  const ensureProcessingFailure = input.ensureProcessingFailure;
  const readActiveRuntimeUserFenceInput = input.readActiveRuntimeUserFence;
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: async () => {},
    ...(ensureProcessingFailure
      ? {
          ensureProcessing: createDirectOnlyRpcMethod<
            NonNullable<HostedExecutionContainerStubLike["ensureProcessing"]>
          >(
            async function (this: HostedExecutionContainerStubLike) {
              expect(this).toBe(stub);
              return ensureProcessingFailure;
            },
          ),
        }
      : {}),
    invoke: async () => {
      throw input.invocationError ?? new Error("container transport failed");
    },
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
    smokeHealth: async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    }),
  };
  return {
    getByName: () => stub,
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

function createHostedExecutionEnvironment() {
  return readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "35000",
  }));
}

function createRunnerDurableState(): {
  state: DurableObjectStateLike;
} {
  const sql = createTestSqlStorage();
  const values = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => values.delete(key),
    deleteAlarm: async () => {},
    get: async <T,>(key: string): Promise<T | undefined> =>
      values.get(key) as T | undefined,
    getAlarm: async () => null,
    put: async <T,>(key: string, value: T): Promise<void> => {
      values.set(key, value);
    },
    setAlarm: async () => {},
    sql,
  };
  return {
    state: {
      storage,
      waitUntil() {},
    },
  };
}

function createWorkspaceInvocationJob(input: {
  token: RunnerWriteFenceToken;
  userId: string;
}): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
    request: {
      attemptId: input.token.attemptId,
      idleCheckpointDelayMs: 54_000,
      leaseGeneration: input.token.generation,
      userId: input.userId,
      workspace: null,
      workspaceVersion: input.token.workspaceVersion ?? "0",
    },
    runtime: buildHostedRunnerJobRuntimeConfig({
      forwardedEnv: {},
      runnerSecrets: {},
    }),
  };
}

class TestRunnerStoreCache extends RunnerStoreCache {
  private readonly source: Readonly<Record<string, unknown>>;
  private readonly runnerSecrets = new EmptyRunnerSecretsService();

  constructor(source: Readonly<Record<string, unknown>>) {
    super({
      bucket: createEmptyR2Bucket(),
      env: createHostedExecutionEnvironment(),
      runnerRuntimeEnvSource: source,
    });
    this.source = source;
  }

  override async ensure(userId: string): Promise<RunnerUserStores> {
    const cryptoContext = await createTestHostedRuntimeCryptoContext(userId);
    const rootKeyId = "udrk:runtime:test-root";
    const rootKey = getTestHostedRuntimeRootKey("runtime");
    return {
      crypto: {
        cacheMaxAgeMs: 60_000,
        cryptoContextVersion: null,
        domain: "runtime",
        envelope: cryptoContext.envelopes.runtime,
        fetchedAtMs: Date.now(),
        keysById: {
          [rootKeyId]: rootKey,
        },
        resolveKeyById: async (keyId) => keyId === rootKeyId ? rootKey : null,
        rootKey,
        rootKeyId,
      },
      runnerSecrets: this.runnerSecrets,
      userId,
    };
  }

  override readRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return Object.fromEntries(
      Object.entries(this.source).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      ),
    );
  }
}

class EmptyRunnerSecretsService extends RunnerSecretsService {
  constructor() {
    const rootKey = new Uint8Array(32);
    super(
      createEmptyR2Bucket(),
      rootKey,
      "test-root",
      { "test-root": rootKey },
      async () => null,
      {},
    );
  }

  override async readRunnerSecrets(): Promise<Record<string, string>> {
    return {};
  }
}

function createEmptyR2Bucket(): R2BucketLike {
  return {
    get: async () => null,
    put: async () => {},
  };
}
