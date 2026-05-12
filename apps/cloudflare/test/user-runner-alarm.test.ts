import { afterEach, describe, expect, it, vi } from "vitest";

import type {
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
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
      nextAlarmAt: FIXED_NOW,
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
    expect(alarms[0]).toBe(FIXED_NOW);
    expect(alarms.slice(1)).toEqual(["deleted", "deleted"]);
  });

  it("queues a foreground nudge behind an active write fence and follows up after release", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const { invoke, runner, sql } = createRunnerHarness({
      invocationResults: [
        firstInvocation.promise,
        { nextWakeAt: null, status: "idle" },
      ],
      workspace: createWorkspaceState({ version: "7" }),
    });
    await runner.bindUser("member_123");

    await expect(runner.nudgeHostedRunner()).resolves.toMatchObject({
      accepted: true,
      immediateDriveStarted: true,
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const activeFenceExpiresAt = readRunnerMeta(sql).active_expires_at;

    const nudge = await runner.nudgeHostedRunner();

    expect(nudge).toMatchObject({
      accepted: true,
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAt: activeFenceExpiresAt,
    });

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[0].job.request.reason).toBe("nudge");
    expect(invoke.mock.calls[1]?.[0].job.request.reason).toBe("nudge");
  });

  it("wakes the active runtime best-effort when a nudge arrives during an invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const firstInvocation = createDeferred<HostedWorkspaceInvocationResult>();
    const wakeRuntime = vi.fn(async () => ({ accepted: true }));
    const { invoke, runner } = createRunnerHarness({
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
      alreadyRunning: true,
      immediateDriveStarted: false,
      inFlight: true,
    });

    expect(wakeRuntime).toHaveBeenCalledWith({ userId: "member_123" });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.runner",
        details: expect.objectContaining({
          alreadyRunning: true,
          runtimeWakeAccepted: true,
        }),
        message: "Hosted runner nudge accepted.",
      }),
    );

    firstInvocation.resolve({ nextWakeAt: null, status: "idle" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
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

    await expect(runner.beginIdleCheckpointLease({
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
    expect(alarms).toEqual([FIXED_NOW, RETRY_AT]);
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
    expect(alarms).toHaveLength(2);
    expect(alarms[1]).toBe("deleted");
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
    expect(alarms).toHaveLength(2);
    expect(alarms[1]).toBe("deleted");
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
  invocationResults?: Array<Error | HostedWorkspaceInvocationResult | Promise<HostedWorkspaceInvocationResult>>;
  onWorkspaceRead?: () => Promise<void> | void;
  wakeRuntime?: HostedExecutionContainerStubLike["wakeRuntime"];
  workspace?: HostedWorkspaceState | null;
} = {}) {
  const durable = createDurableObjectState();
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
  const runnerContainerNames: string[] = [];
  const stub: HostedExecutionContainerStubLike = {
    destroyInstance: input.destroyInstance ?? (async () => {}),
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
        return jsonResponse({
          mailboxLag: [],
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

function readRunnerMeta(sql: TestSqlStorageLike): {
  active_attempt_id: string | null;
  active_expires_at: string | null;
  backoff_until: string | null;
  failure_count: number;
  last_error_at: string | null;
  last_invocation_at: string | null;
  wake_at: string | null;
} {
  return sql.exec<{
    active_attempt_id: string | null;
    active_expires_at: string | null;
    backoff_until: string | null;
    failure_count: number;
    last_error_at: string | null;
    last_invocation_at: string | null;
    wake_at: string | null;
  }>(
    `SELECT active_attempt_id,
            active_expires_at,
            backoff_until,
            failure_count,
            last_error_at,
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
