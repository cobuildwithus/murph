import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedRunnerContainerIdentity,
  resolveHostedExecutionRunnerContainerName,
} from "../src/hosted-runner-container-identity.js";
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
  RuntimeProcessingController,
} from "../src/user-runner/runtime-processing-controller.js";
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

const FIXED_NOW = "2026-06-03T00:00:00.000Z";
const TEST_USER_ID = "member_123";
describe("hosted runner container identity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a versioned runner container identity", () => {
    const source = {
      CF_VERSION_METADATA: {
        id: " version/123 ",
      },
    };

    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source,
      userId: "member_123",
    });

    expect(runnerContainerName).toBe("member_123--v-version-123");
    expect(readHostedRunnerContainerIdentity({
      containerName: ` ${runnerContainerName} `,
      source,
    })).toEqual({
      runnerContainerName,
      userId: "member_123",
    });
  });

  it("derives the same user when the active worker version suffix differs", () => {
    expect(readHostedRunnerContainerIdentity({
      containerName: "member_123--v-version-a",
      source: {
        CF_VERSION_METADATA: {
          id: "version-b",
        },
      },
    })).toEqual({
      runnerContainerName: "member_123--v-version-a",
      userId: "member_123",
    });
  });

  it("keeps suffix-looking container names literal without worker version metadata", () => {
    expect(readHostedRunnerContainerIdentity({
      containerName: "member_123--v-version-a",
      source: {},
    })).toEqual({
      runnerContainerName: "member_123--v-version-a",
      userId: "member_123--v-version-a",
    });
  });

  it("returns null for missing or suffix-only container names", () => {
    const source = {
      CF_VERSION_METADATA: {
        id: "version-a",
      },
    };

    expect(readHostedRunnerContainerIdentity({
      containerName: "   ",
      source,
    })).toBeNull();
    expect(readHostedRunnerContainerIdentity({
      containerName: "--v-version-a",
      source,
    })).toBeNull();
  });

  it("stores the helper-derived versioned runner container name in the runtime write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invocationService = new RecordingRuntimeInvocationService();
    const readyContainerNames: string[] = [];
    const runnerRuntimeEnvSource = {
      CF_VERSION_METADATA: {
        id: "worker version/current",
      },
    };
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService,
      runnerContainerNamespace: createRunnerContainerNamespace({
        readyContainerNames,
      }),
      runnerRuntimeEnvSource,
      state: durable.state,
      stateStore,
      alarmCoordinator: new RunnerAlarmCoordinator(durable.state),
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "started",
      kind: "runtime_processing_accepted",
    });

    const expectedRunnerContainerName = "member_123--v-worker-version-current";
    expect(invocationService.prepareTokens).toHaveLength(1);
    expect(invocationService.prepareTokens[0]?.runnerContainerName)
      .toBe(expectedRunnerContainerName);
    expect(readyContainerNames).toEqual([expectedRunnerContainerName]);
    await expect(stateStore.readWriteFenceToken()).resolves.toEqual(
      expect.objectContaining({
        runnerContainerName: expectedRunnerContainerName,
        userId: TEST_USER_ID,
      }),
    );
  });

  it("fails closed when runtime start parses a different user from the helper-derived name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invocationService = new RecordingRuntimeInvocationService();
    const readyContainerNames: string[] = [];
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService,
      runnerContainerNamespace: createRunnerContainerNamespace({
        readyContainerNames,
      }),
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
      },
      state: durable.state,
      stateStore,
      alarmCoordinator: new RunnerAlarmCoordinator(durable.state),
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: " member_123 ",
    })).rejects.toThrow(
      "Hosted runner container identity did not match the runtime start user.",
    );

    expect(invocationService.prepareTokens).toHaveLength(0);
    expect(readyContainerNames).toEqual([]);
    await expect(stateStore.readWriteFenceToken()).resolves.toBeNull();
  });

  it("uses the write-fence token's stored runner container name for runtime invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invokedContainerNames: string[] = [];
    const runnerRuntimeEnvSource = {
      CF_VERSION_METADATA: {
        id: "version_1",
      },
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
    };
    const service = createRuntimeInvocationService({
      invokedContainerNames,
      runnerRuntimeEnvSource,
      stateStore,
      state: durable.state,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version_1",
      userId: TEST_USER_ID,
    });

    const prepared = await service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_1",
        userId: TEST_USER_ID,
      },
      token,
    });
    expect(prepared.runnerContainerName).toBe("member_123--v-version_1");

    await expect(service.invokePreparedWithFence({
      acceptedProcessingAttempt: false,
      prepared,
      runtimeWakeStartedAt: Date.now(),
    })).resolves.toMatchObject({
      status: "idle",
    });

    expect(invokedContainerNames).toEqual(["member_123--v-version_1"]);
  });

  it("wakes an active runtime through the write fence's stored runner container name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    await stateStore.bindUser(TEST_USER_ID);
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123--v-version-a",
      userId: TEST_USER_ID,
    });
    const ensuredContainerNames: string[] = [];
    const controller = new RuntimeProcessingController({
      env: createHostedExecutionEnvironment(),
      invocationService: new RecordingRuntimeInvocationService(),
      runnerContainerNamespace: createRunnerContainerNamespace({
        ensuredContainerNames,
      }),
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version-b",
        },
      },
      state: durable.state,
      stateStore,
      alarmCoordinator: new RunnerAlarmCoordinator(durable.state),
    });

    await expect(controller.ensureForUser({
      orchestrationAttemptId: "orchestration_attempt_1",
      userId: TEST_USER_ID,
    })).resolves.toMatchObject({
      action: "already_running",
      kind: "runtime_processing_accepted",
      runtimeAttemptId: token.attemptId,
    });

    expect(ensuredContainerNames).toEqual(["member_123--v-version-a"]);
  });

  it("fails closed when runtime invocation parses a different user from the write-fence token name", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    const invokedContainerNames: string[] = [];
    const service = createRuntimeInvocationService({
      invokedContainerNames,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: {
          id: "version_1",
        },
        HOSTED_ASSISTANT_PROVIDER: "openai",
        OPENAI_API_KEY: "test-openai-key",
      },
      stateStore,
      state: durable.state,
    });
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_456--v-version_1",
      userId: TEST_USER_ID,
    });

    await expect(service.prepareWithFence({
      input: {
        orchestrationAttemptId: "orchestration_attempt_1",
        userId: TEST_USER_ID,
      },
      token,
    })).rejects.toThrow(
      "Hosted runner container identity did not match the runtime invocation user.",
    );
    expect(invokedContainerNames).toEqual([]);
  });
});

class RecordingRuntimeInvocationService extends RuntimeInvocationService {
  readonly prepareTokens: RunnerWriteFenceToken[] = [];

  constructor() {
    const durable = createRunnerDurableState();
    const stateStore = new RunnerStateStore(durable.state);
    super({
      assertWorkspaceBelongsToRunnerUser() {},
      env: createHostedExecutionEnvironment(),
      readHostedRuntimeStatusFromWeb: async (userId) => ({
        mailboxLag: [],
        userId,
        workspace: null,
      }),
      readHostedWebControlBaseUrl: () => "https://web.example.test",
      readHostedWorkspaceFromWeb: async () => ({
        fetchedAt: FIXED_NOW,
        workspace: null,
      }),
      runnerContainerNamespace: createRunnerContainerNamespace({}),
      runnerRuntimeEnvSource: {},
      runnerStoreCache: new TestRunnerStoreCache({}),
      stateStore,
      alarmCoordinator: new RunnerAlarmCoordinator(durable.state),
    });
  }

  override async prepareWithFence(input: {
    input: PreparedRuntimeInvocation["input"];
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
    this.prepareTokens.push(input.token);
    return {
      input: input.input,
      job: createWorkspaceInvocationJob({
        token: input.token,
        userId: input.input.userId,
      }),
      runnerContainerName: input.token.runnerContainerName ?? input.input.userId,
      token: input.token,
      workspaceVersion: "0",
    };
  }

  override async invokePreparedWithFence(): Promise<HostedWorkspaceInvocationResult> {
    return {
      nextWakeAt: null,
      status: "idle",
    };
  }
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

function createRuntimeInvocationService(input: {
  invokedContainerNames: string[];
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  state: DurableObjectStateLike;
  stateStore: RunnerStateStore;
}): RuntimeInvocationService {
  return new RuntimeInvocationService({
    assertWorkspaceBelongsToRunnerUser(workspace, userId) {
      if (workspace && workspace.userId !== userId) {
        throw new Error("Workspace belonged to a different user.");
      }
    },
    env: createHostedExecutionEnvironment(),
    readHostedRuntimeStatusFromWeb: async (userId) => ({
      mailboxLag: [],
      userId,
      workspace: null,
    }),
    readHostedWebControlBaseUrl: () => "https://web.example.test",
    readHostedWorkspaceFromWeb: async () => ({
      fetchedAt: FIXED_NOW,
      workspace: null,
    }),
    runnerContainerNamespace: createRunnerContainerNamespace({
      invokedContainerNames: input.invokedContainerNames,
    }),
    runnerRuntimeEnvSource: input.runnerRuntimeEnvSource,
    runnerStoreCache: new TestRunnerStoreCache(input.runnerRuntimeEnvSource),
    stateStore: input.stateStore,
    alarmCoordinator: new RunnerAlarmCoordinator(input.state),
  });
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

function createRunnerContainerNamespace(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  readyContainerNames?: string[];
}): HostedExecutionContainerNamespaceLike {
  return {
    getByName(name) {
      return createRunnerContainerStub({
        ensuredContainerNames: input.ensuredContainerNames,
        name,
        invokedContainerNames: input.invokedContainerNames,
        readyContainerNames: input.readyContainerNames,
      });
    },
  };
}

function createRunnerContainerStub(input: {
  ensuredContainerNames?: string[];
  invokedContainerNames?: string[];
  name: string;
  readyContainerNames?: string[];
}): HostedExecutionContainerStubLike {
  return {
    destroyInstance: async () => {},
    ensureReadyForProcessing: async () => {
      input.readyContainerNames?.push(input.name);
      return { kind: "ready" };
    },
    ...(input.ensuredContainerNames
      ? {
          ensureProcessing: async () => {
            input.ensuredContainerNames?.push(input.name);
            return {
              action: "already_running",
              kind: "accepted",
            };
          },
        }
      : {}),
    invoke: async () => {
      input.invokedContainerNames?.push(input.name);
      return {
        nextWakeAt: null,
        status: "idle",
      };
    },
    smokeHealth: async () => ({
      ok: true,
      runnerBundle: null,
      service: "runner",
      status: 200,
    }),
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

function createEmptyR2Bucket(): R2BucketLike {
  return {
    get: async () => null,
    put: async () => {},
  };
}
