import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseHostedRuntimeLogRequest,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeWebStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedExecutionEnvironment,
} from "../src/env.js";
import type {
  R2BucketLike,
} from "../src/bundle-store.js";
import type {
  HostedExecutionContainerNamespaceLike,
  HostedExecutionContainerStubLike,
} from "../src/runner-container.js";
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
  RunnerAlarmCoordinator,
} from "../src/user-runner/alarm-coordinator.js";
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

  it("keeps the write fence when the invocation is still active in the container", async () => {
    const harness = await createTransportFailureHarness({
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
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptStillActive: true,
          fenceCleared: false,
        }),
      }),
    ]);
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

  it("clears the write fence when the liveness probe itself fails", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => {
        throw new Error("container probe unreachable");
      },
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("clears the write fence when the liveness probe hangs past its timeout", async () => {
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

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("clears the write fence when only the lease generation differs", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async (token) => ({
        active: true,
        attemptId: token.attemptId,
        leaseGeneration: "999",
        userId: TEST_USER_ID,
      }),
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
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

  it("clears the write fence when the container stub lacks the liveness probe method", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: null,
    });

    await expect(harness.invoke()).rejects.toThrow("container transport failed");

    await expect(harness.stateStore.readWriteFenceToken()).resolves.toBeNull();
    expect(harness.loggedFailureEntries()).toEqual([
      expect.objectContaining({
        eventCode: "runner.accepted_attempt_failed",
        redactedJson: expect.objectContaining({
          attemptStillActive: false,
          fenceCleared: true,
        }),
      }),
    ]);
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

  it("still returns committed progress instead of clearing toward failure when the attempt is inactive but the workspace advanced", async () => {
    const harness = await createTransportFailureHarness({
      readActiveRuntimeUserFence: async () => ({
        active: false,
        reason: "no_active_runtime",
      }),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
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
  });
});

describe("buildHostedRunnerRedactedErrorJson", () => {
  it("keeps scalar diagnostics and the string-array details keys in the persisted redacted shape", () => {
    const redacted = buildHostedRunnerRedactedErrorJson(
      new Error("container transport failed"),
    );

    expect(redacted).toEqual({
      detailsKeys: ["errorCode", "errorDetail", "errorMessage", "errorName"],
      errorCode: "runtime_error",
      errorDetailPresent: true,
      errorName: "Error",
      // The sanitized summary moves to the runtime-log allowlisted key.
      safeErrorMessage: "Hosted execution runtime failed.",
    });
    // The raw error text stays out of the persisted redacted JSON; only the
    // presence flag survives.
    expect(JSON.stringify(redacted)).not.toContain("container transport failed");
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
});

async function createTransportFailureHarness(input: {
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
  stateStore: RunnerStateStore;
  token: RunnerWriteFenceToken;
}> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));

  const loggedBodies: unknown[] = [];
  vi.stubGlobal("fetch", async (request: Request | string, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.includes("/hosted-runtime/log")) {
      const rawBody = typeof request === "string"
        ? init?.body
        : await request.clone().text();
      loggedBodies.push(JSON.parse(String(rawBody)));
      return Response.json({ loggedCount: 1 });
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
      readActiveRuntimeUserFence: readActiveRuntimeUserFenceInput
        ? (() => readActiveRuntimeUserFenceInput(token))
        : null,
    }),
    runnerRuntimeEnvSource: {},
    runnerStoreCache: new TestRunnerStoreCache({}),
    stateStore,
    alarmCoordinator: new RunnerAlarmCoordinator(durable.state),
  });

  const prepared: PreparedRuntimeInvocation = {
    input: {
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    },
    job: createWorkspaceInvocationJob({ token, userId: TEST_USER_ID }),
    runnerContainerName: TEST_RUNNER_CONTAINER_NAME,
    token,
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
    stateStore,
    token,
  };
}

function createFailingInvokeContainerNamespace(input: {
  readActiveRuntimeUserFence:
    | (() => Promise<WorkerActiveRuntimeUserFenceResult>)
    | null;
}): HostedExecutionContainerNamespaceLike {
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: async () => {},
    invoke: async () => {
      throw new Error("container transport failed");
    },
    ...(input.readActiveRuntimeUserFence
      ? { readActiveRuntimeUserFence: input.readActiveRuntimeUserFence }
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

function createHostedExecutionEnvironment() {
  return readHostedExecutionEnvironment(createHostedExecutionTestEnv({
    HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "54000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
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
