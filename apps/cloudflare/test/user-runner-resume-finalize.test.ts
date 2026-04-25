import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { gzipSync } from "node:zlib";

import type {
  HostedExecutionCursorState,
  HostedIngressEnvelope,
  HostedRunAcquireResponse,
  HostedRunCommitResponse,
  HostedRunFinalizeResponse,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import { HOSTED_INGRESS_PAYLOAD_SCHEMA } from "@murphai/hosted-execution/contracts";
import { sha256HostedBundleHex } from "@murphai/runtime-state/node/hosted-bundle-codec";
import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionVaultShareAcceptedWake,
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";
import {
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
} from "../src/bundle-store.ts";
import { createHostedBrowserVaultReplicaStore } from "../src/browser-vault-store.ts";
import type { HostedExecutionEnvironment } from "../src/env.ts";
import { hostedArtifactObjectKey } from "../src/storage-paths.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import { HostedWebControlPlaneResponseError } from "../src/web-control-plane.ts";
import { HostedRunSideInputNotFoundError } from "../src/user-runner/runner-run-processor.ts";
import { createHostedUserKeyStore } from "../src/user-key-store.ts";
import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";
import {
  TEST_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
  TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
  createHostedExecutionTestEnv,
  encryptTestHostedIngressPayload,
} from "./hosted-execution-fixtures.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMocks = vi.hoisted(() => ({
  readHostedExecutionEnvironment: vi.fn(),
}));

const webControlMocks = vi.hoisted(() => ({
  acquireHostedRunFromWeb: vi.fn(),
  commitHostedRunToWeb: vi.fn(),
  finalizeHostedRunInWeb: vi.fn(),
  recordHostedRunLogInWeb: vi.fn(),
  releaseHostedRunFinalizeInWeb: vi.fn(),
  readHostedRunStatusFromWeb: vi.fn(),
}));

const wakeProcessorMocks = vi.hoisted(() => ({
  cleanupTransientWakeDataBestEffortForRunDrain: vi.fn(),
  executeRunDrain: vi.fn(),
  finalizeRunDrain: vi.fn(),
  persistPendingRunCleanupData: vi.fn(),
  readRunDrainSharePack: vi.fn(),
  readRunDrainVaultSyncImport: vi.fn(),
  recordHostedRunBreadcrumbInWebBestEffort: vi.fn(),
}));

vi.mock("../src/env.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/env.ts")>(
    "../src/env.ts",
  );

  return {
    ...actual,
    readHostedExecutionEnvironment: envMocks.readHostedExecutionEnvironment,
  };
});

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    acquireHostedRunFromWeb: webControlMocks.acquireHostedRunFromWeb,
    commitHostedRunToWeb: webControlMocks.commitHostedRunToWeb,
    finalizeHostedRunInWeb: webControlMocks.finalizeHostedRunInWeb,
    recordHostedRunLogInWeb: webControlMocks.recordHostedRunLogInWeb,
    releaseHostedRunFinalizeInWeb: webControlMocks.releaseHostedRunFinalizeInWeb,
    readHostedRunStatusFromWeb: webControlMocks.readHostedRunStatusFromWeb,
  };
});

vi.mock("../src/user-runner/runner-run-processor.js", async () => {
  const actual = await vi.importActual<typeof import("../src/user-runner/runner-run-processor.js")>(
    "../src/user-runner/runner-run-processor.js",
  );

  class MockRunnerRunProcessor {
    cleanupTransientWakeDataBestEffortForRunDrain =
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain;

    executeRunDrain = wakeProcessorMocks.executeRunDrain;

    finalizeRunDrain = wakeProcessorMocks.finalizeRunDrain;

    persistPendingRunCleanupData = wakeProcessorMocks.persistPendingRunCleanupData;

    readRunDrainSharePack = wakeProcessorMocks.readRunDrainSharePack;

    readRunDrainVaultSyncImport = wakeProcessorMocks.readRunDrainVaultSyncImport;

    constructor(..._args: unknown[]) {}
  }

  return {
    ...actual,
    RunnerRunProcessor: MockRunnerRunProcessor,
    recordHostedRunBreadcrumbInWebBestEffort:
      wakeProcessorMocks.recordHostedRunBreadcrumbInWebBestEffort,
  };
});

function createTestRuntimeEnvironment(
  overrides: Partial<HostedExecutionEnvironment> = {},
): HostedExecutionEnvironment {
  const runtimeKey = Uint8Array.from({ length: 32 }, () => 9);

  return {
    allowedRunnerSecretKeys: null,
    automationRecipientKeyId: TEST_AUTOMATION_RECIPIENT_KEY_ID,
    automationRecipientPrivateKey: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
    automationRecipientPrivateKeysById: {
      [TEST_AUTOMATION_RECIPIENT_KEY_ID]: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
    },
    automationRecipientPublicKey: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    hostedIngressEncryption: {
      key: TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
      keyVersion: TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION,
      keysByVersion: {
        [TEST_HOSTED_WAKE_ENCRYPTION_KEY_VERSION]: TEST_HOSTED_WAKE_ENCRYPTION_KEY_BYTES,
      },
    },
    hostedWebBaseUrl: "https://web.example.test",
    maxEventAttempts: 3,
    platformEnvelopeKey: runtimeKey,
    platformEnvelopeKeyId: "v1",
    platformEnvelopeKeysById: {
      v1: runtimeKey,
    },
    recoveryRecipientKeyId: "recovery:v1",
    recoveryRecipientPublicKey: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    retryDelayMs: 30_000,
    runnerReadyTimeoutMs: 20_000,
    runnerTimeoutMs: 60_000,
    webControlTimeoutMs: 30_000,
    teeAutomationRecipientKeyId: null,
    teeAutomationRecipientPublicKey: null,
    vercelOidcValidation: {
      audience: "https://vercel.com/murph-team",
      environment: "production",
      issuer: "https://oidc.vercel.com/murph-team",
      jwksUrl: "https://oidc.vercel.com/murph-team/.well-known/jwks",
      projectName: "murph-web",
      subject: "owner:murph-team:project:murph-web:environment:production",
      teamSlug: "murph-team",
    },
    webCallbackSigning: {
      keyId: "v1",
      privateKeyJwkJson: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    },
    ...overrides,
  };
}

class SqliteCursor<T extends Record<string, DurableObjectSqlValue>>
  implements DurableObjectSqlCursorLike<T> {
  private index = 0;

  constructor(
    private readonly rows: T[],
    readonly columnNames: string[],
    readonly rowsRead: number,
    readonly rowsWritten: number,
  ) {}

  [Symbol.iterator](): Iterator<T> {
    return this.rows[Symbol.iterator]();
  }

  next(): IteratorResult<T> {
    if (this.index >= this.rows.length) {
      return {
        done: true,
        value: undefined as never,
      };
    }

    const value = this.rows[this.index];
    this.index += 1;
    return {
      done: false,
      value,
    };
  }

  one(): T {
    const row = this.rows[0];
    if (!row) {
      throw new Error("Expected a row.");
    }

    return row;
  }

  *raw<U extends DurableObjectSqlValue[]>(): IterableIterator<U> {
    for (const row of this.rows) {
      yield this.columnNames.map((columnName) => row[columnName]) as U;
    }
  }

  toArray(): T[] {
    return [...this.rows];
  }
}

class SqliteDurableObjectSqlStorage {
  constructor(private readonly db: DatabaseSync) {}

  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string,
    ...bindings: DurableObjectSqlValue[]
  ): DurableObjectSqlCursorLike<T> {
    const statement = this.db.prepare(query);
    const normalized = query.trimStart().toUpperCase();

    if (
      normalized.startsWith("SELECT")
      || normalized.startsWith("PRAGMA")
      || normalized.startsWith("WITH")
    ) {
      const rows = statement.all(...bindings as SQLInputValue[]) as T[];
      const columnNames = statement.columns().map((column) => column.name);
      return new SqliteCursor(rows, columnNames, rows.length, 0);
    }

    const result = statement.run(...bindings as SQLInputValue[]);
    return new SqliteCursor([], [], 0, Number(result.changes));
  }
}

function createDurableObjectStateHarness(): DurableObjectStateLike {
  const db = new DatabaseSync(":memory:");
  const storageValues = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    storage: {
      delete: async (key: string): Promise<boolean> => storageValues.delete(key),
      deleteAlarm: async () => {
        alarm = null;
      },
      get: async <T,>(key: string): Promise<T | undefined> => (
        storageValues.get(key) as T | undefined
      ),
      getAlarm: async () => alarm,
      put: async (key, value) => {
        storageValues.set(key, value);
      },
      setAlarm: async (scheduledTime) => {
        alarm = typeof scheduledTime === "number" ? scheduledTime : scheduledTime.getTime();
      },
      sql: new SqliteDurableObjectSqlStorage(db),
    },
  };
}

function createSnapshotRef(key: string) {
  return {
    hash: `${key}-hash`,
    key,
    size: key.length,
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

function createCursorState(input: {
  browserVaultReplicaRef?: HostedExecutionCursorState["browserVaultReplicaRef"];
  committedSeq: string;
  nextSeq: string;
  nextRuntimeWakeAt?: string | null;
  snapshotKey?: string;
  snapshotRef?: HostedExecutionCursorState["snapshotRef"];
  version: string;
}): HostedExecutionCursorState {
  return {
    browserVaultReplicaRef: input.browserVaultReplicaRef ?? null,
    committedSeq: input.committedSeq,
    createdAt: "2026-04-20T00:00:00.000Z",
    nextSeq: input.nextSeq,
    nextRuntimeWakeAt: input.nextRuntimeWakeAt ?? null,
    nextRuntimeWakeReason: input.nextRuntimeWakeAt ? "runtime" : null,
    snapshotRef: input.snapshotRef ?? createSnapshotRef(input.snapshotKey ?? "snapshot/default"),
    updatedAt: "2026-04-20T00:00:00.000Z",
    userId: "user-resume-finalize",
    version: input.version,
  };
}

function createRunRecord(): HostedRunRecord {
  return {
    acquiredAt: "2026-04-20T00:00:00.000Z",
    attempt: 1,
    createdAt: "2026-04-20T00:00:00.000Z",
    eventCount: 0,
    eventKinds: [],
    eventSeqs: [],
    executorKind: "cloudflare-container",
    id: "run-resume-finalize",
    inputCommittedSeq: "10",
    inputCursorVersion: "cursor-v1",
    status: "committed_needs_finalize",
    triggerKind: "retry_finalize",
    updatedAt: "2026-04-20T00:00:00.000Z",
    userId: "user-resume-finalize",
    ingressEventIds: [],
  };
}

async function writeHostedBundleFixture(input: {
  artifactPayloads: string[];
  bucket: MemoryEncryptedR2Bucket;
  crypto: {
    keysById: Readonly<Record<string, Uint8Array>>;
    rootKey: Uint8Array;
    rootKeyId: string;
  };
  userId: string;
}): Promise<{
  artifactKeys: string[];
  ref: NonNullable<HostedExecutionCursorState["snapshotRef"]>;
}> {
  const artifactStore = createHostedArtifactStore({
    bucket: input.bucket,
    key: input.crypto.rootKey,
    keyId: input.crypto.rootKeyId,
    keysById: input.crypto.keysById,
    userId: input.userId,
  });
  const bundleStore = createHostedBundleStore({
    bucket: input.bucket,
    key: input.crypto.rootKey,
    keyId: input.crypto.rootKeyId,
    keysById: input.crypto.keysById,
    userId: input.userId,
  });
  const artifactRefs = await Promise.all(
    input.artifactPayloads.map(async (payload, index) => {
      const bytes = Uint8Array.from(Buffer.from(payload, "utf8"));
      const sha256 = sha256HostedBundleHex(bytes);
      await artifactStore.writeArtifact(sha256, bytes);
      return {
        byteSize: bytes.byteLength,
        key: await hostedArtifactObjectKey(input.crypto.rootKey, input.userId, sha256),
        path: `artifacts/file-${index + 1}.bin`,
        root: "vault",
        sha256,
      };
    }),
  );

  return {
    artifactKeys: artifactRefs.map((artifact) => artifact.key),
    ref: await bundleStore.writeBundle(
      "vault",
      createHostedArtifactBundleBytes(artifactRefs),
    ),
  };
}

async function writeBrowserVaultReplicaFixture(input: {
  bucket: MemoryEncryptedR2Bucket;
  generatedAt: string;
  rootKey: Uint8Array;
  sourceBundleHash: string;
  userId: string;
}) {
  const store = createHostedBrowserVaultReplicaStore({
    bucket: input.bucket,
    rootKey: input.rootKey,
  });

  return store.writeBrowserVaultReplica({
    replica: await createBrowserVaultReplica({
      generatedAt: input.generatedAt,
      sourceBundleHash: input.sourceBundleHash,
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    }),
    userId: input.userId,
  });
}

function createHostedArtifactBundleBytes(input: Array<{
  byteSize: number;
  path: string;
  root: string;
  sha256: string;
}>): Uint8Array {
  return Uint8Array.from(
    gzipSync(
      Buffer.from(JSON.stringify({
        files: input.map((artifact) => ({
          artifact: {
            byteSize: artifact.byteSize,
            sha256: artifact.sha256,
          },
          path: artifact.path,
          root: artifact.root,
        })),
        kind: "vault",
        schema: "murph.hosted-bundle.v1",
      })),
    ),
  );
}

async function writeRequiredPendingCleanupState(
  stateStore: RunnerStateStore,
  runId: string,
): Promise<void> {
  await stateStore.writePendingRunCleanup(runId, {
    emailMessages: [],
    linqMessageIds: [],
    required: true,
    telegramMessages: [],
  });
}

async function expectRecordedRunPhases(phases: readonly string[]): Promise<void> {
  await vi.waitFor(() => {
    const recordedPhases = getRecordedRunLogBodies()
      .map((body) => body.phase)
      .sort();
    expect(recordedPhases).toEqual([...phases].sort());
  });
}

function getRecordedRunLogBodies(): Array<{
  level: string;
  message: string;
  phase: string;
  redacted: unknown;
}> {
  return webControlMocks.recordHostedRunLogInWeb.mock.calls
    .map(([input]) => input.body);
}

beforeEach(() => {
  wakeProcessorMocks.recordHostedRunBreadcrumbInWebBestEffort.mockImplementation((input: {
    baseUrl: string | null;
    callbackSigning: unknown;
    message: string;
    phase: string;
    level?: "debug" | "info" | "warn" | "error";
    redacted?: Record<string, unknown> | null;
    run: {
      runId: string;
    };
    runToken?: string | null;
    userId: string;
  }) => {
    if (!input.baseUrl || typeof input.runToken !== "string") {
      return Promise.resolve();
    }

    webControlMocks.recordHostedRunLogInWeb({
      baseUrl: input.baseUrl,
      body: {
        at: "2026-04-20T00:00:00.000Z",
        component: "cloudflare-runner",
        level: input.level ?? "info",
        message: input.message,
        phase: input.phase,
        redacted: input.redacted ?? null,
        runId: input.run.runId,
        runToken: input.runToken,
      },
      boundUserId: input.userId,
      callbackSigning: input.callbackSigning,
      timeoutMs: 5_000,
    });

    return Promise.resolve();
  });

  webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
    body?: {
      runId?: string | null;
    };
  }) => {
    const run = createRunRecord();
    run.id = input.body?.runId ?? run.id;
    run.status = "running";

    return {
      cursor: createCursorState({
        committedSeq: "10",
        nextSeq: "11",
        snapshotKey: "snapshot/status",
        version: "cursor-status",
      }),
      pendingIngressEventCount: 0,
      run,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("HostedUserRunner resumeFinalize drain", () => {
  it("marks bootstrap state as runtime-ready so later alarms can drain", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    await runner.bootstrapUser("user-resume-finalize");

    await expect(stateStore.readState()).resolves.toMatchObject({
      runtimeBootstrapped: true,
      userId: "user-resume-finalize",
    });
  });

  it("nudges by scheduling an immediate alarm when a run is not already draining", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const result = await runner.nudgeHostedRun();
    const record = await stateStore.readState();

    expect(result).toEqual({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
    });
    expect(record.nextWakeAt).not.toBeNull();
  });

  it("still schedules an immediate retry alarm when a run is already draining", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    Reflect.set(runner, "runDrainLock", Promise.resolve());

    const result = await runner.nudgeHostedRun();
    const record = await stateStore.readState();

    expect(result).toEqual({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: true,
    });
    expect(record.nextWakeAt).not.toBeNull();
  });

  it("clears the alarm without retrying when acquire reports a stale missing hosted member", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    await runner.bootstrapUser("user-resume-finalize");
    await runner.nudgeHostedRun();
    await expect(state.storage.getAlarm()).resolves.toEqual(expect.any(Number));

    webControlMocks.acquireHostedRunFromWeb.mockRejectedValueOnce(
      new HostedWebControlPlaneResponseError({
        description: "Hosted run acquire",
        error: {
          code: "HOSTED_RUN_STALE_RUNNER_USER",
          details: {
            boundary: "hosted-run.acquire",
            condition: "stale_runner_missing_hosted_member",
          },
          message:
            "Hosted runner is bound to a member that no longer exists in the hosted web database.",
          retryable: false,
        },
        path: "/api/internal/hosted-run/acquire",
        responseDetail: null,
        status: 410,
      }),
    );

    await runner.alarm();

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(1);
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: null,
    });
    await expect(state.storage.getAlarm()).resolves.toBeNull();
  });

  it("keeps retrying ordinary acquire failures from the alarm path with the configured delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00.000Z"));
    const environment = createTestRuntimeEnvironment({
      retryDelayMs: 45_000,
    });
    envMocks.readHostedExecutionEnvironment.mockReturnValue(environment);
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    const runner = new HostedUserRunner(
      state,
      environment,
      new MemoryEncryptedR2Bucket(),
    );
    await runner.bootstrapUser("user-resume-finalize");
    await runner.nudgeHostedRun();
    await expect(state.storage.getAlarm()).resolves.toBe(
      Date.parse("2026-04-20T00:00:00.000Z"),
    );

    webControlMocks.acquireHostedRunFromWeb.mockRejectedValueOnce(new Error("temporary web outage"));

    await runner.alarm();

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(1);
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: "2026-04-20T00:00:45.000Z",
    });
    await expect(state.storage.getAlarm()).resolves.toBe(
      Date.parse("2026-04-20T00:00:45.000Z"),
    );
  });

  it("refetches after a successful finalize-resume before declaring the queue drained", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v2",
    });
    const drainedCursor = createCursorState({
      committedSeq: "12",
      nextSeq: "13",
      snapshotKey: "snapshot/drained",
      version: "cursor-v3",
    });
    const run = {
      ...createRunRecord(),
      status: "finalizing" as const,
    };
    await stateStore.writePendingRunCleanup(run.id, {
      emailMessages: [],
      linqMessageIds: ["linq_outbound_message"],
      required: true,
      telegramMessages: [],
    });

    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run,
      runToken: "run-token",
    };
    const noWorkAcquire: HostedRunAcquireResponse = {
      acquired: false,
      cursor: drainedCursor,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: null,
      runToken: null,
    };
    const finalizedResponse: HostedRunFinalizeResponse = {
      cursor: finalizedCursor,
      finalized: true,
      run,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(resumeFinalizeAcquire)
      .mockResolvedValueOnce(noWorkAcquire);
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue(finalizedResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      cursorSnapshotRef: finalizedCursor.snapshotRef,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(2);
    expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.acquireHostedRunFromWeb.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      timeoutMs: 30_000,
    }));
    expect(webControlMocks.finalizeHostedRunInWeb.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      timeoutMs: 30_000,
    }));
    expect(result).toEqual({
      committedSeq: drainedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expectRecordedRunPhases([
      "acquired",
      "finalize_started",
      "finalize_finished",
    ]);
  });

  it("records commit breadcrumbs when a prepared snapshot wins commit without finalize", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/committed",
      version: "cursor-v2",
    });
    const drainedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/drained",
      version: "cursor-v3",
    });
    const run = createRunRecord();
    run.status = "acquired";
    run.triggerKind = "runtime_timer";

    const prepareAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(prepareAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: committedCursor.snapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.acquireHostedRunFromWeb.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      timeoutMs: 30_000,
    }));
    expect(webControlMocks.commitHostedRunToWeb.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      timeoutMs: 30_000,
    }));
    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expectRecordedRunPhases([
      "acquired",
      "commit_attempted",
      "commit_won",
    ]);
  });

  it("records web-closed runtime failures as expected requeues instead of commit loss", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const run = createRunRecord();
    run.status = "acquired";
    run.triggerKind = "runtime_timer";
    const failedRun: HostedRunRecord = {
      ...run,
      errorClass: "hosted_run_runtime",
      errorCode: "HOSTED_RUN_RUNTIME_BACKPRESSURED",
      failedAt: "2026-04-20T00:00:01.000Z",
      status: "failed",
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    } satisfies HostedRunAcquireResponse);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue({
      committed: false,
      cursor: acquiredCursor,
      needsFinalize: false,
      run: failedRun,
    } satisfies HostedRunCommitResponse);
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: null,
      finalizeRequired: false,
      state: "backpressured",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: acquiredCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expectRecordedRunPhases([
      "acquired",
      "commit_attempted",
      "failure_recorded",
    ]);
    const recordedPhases = getRecordedRunLogBodies().map((body) => body.phase);
    expect(recordedPhases).not.toContain("commit_lost");
    const failureLog = getRecordedRunLogBodies()
      .find((body) => body.phase === "failure_recorded");
    expect(failureLog).toMatchObject({
      level: "warn",
      redacted: {
        commitKind: "failure",
        failureCode: "HOSTED_RUN_RUNTIME_BACKPRESSURED",
        requeueExpected: true,
        webRunStatus: "failed",
      },
    });
  });

  it("deletes superseded bundle and browser-vault replica objects after a commit wins without finalize", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-committed-cleanup",
    });
    const previousBundle = await writeHostedBundleFixture({
      artifactPayloads: ["old-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const nextBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const previousReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "a".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: previousBundle.ref,
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      browserVaultReplicaRef: null,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: nextBundle.ref,
      version: "cursor-v2",
    });
    const run = createRunRecord();
    run.status = "acquired";
    run.triggerKind = "runtime_timer";

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValue({
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: null,
      cursorSnapshotRef: nextBundle.ref,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      previousBundle.ref.key,
      previousBundle.artifactKeys[0],
      previousReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(3);
    expect(bucket.objects.has(previousBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(nextBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(previousReplicaRef.objectKey)).toBe(false);
  });

  it("deletes losing candidate bundle and browser-vault replica objects when commit loses", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-commit-loss-candidate-cleanup",
    });
    const authoritativeBundle = await writeHostedBundleFixture({
      artifactPayloads: ["authoritative-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const candidateBundle = await writeHostedBundleFixture({
      artifactPayloads: ["candidate-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const authoritativeReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "a".repeat(64),
      userId: "user-resume-finalize",
    });
    const candidateReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T09:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "b".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: authoritativeReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: authoritativeBundle.ref,
      version: "cursor-v1",
    });
    const run = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "runtime_timer" as const,
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValue({
      committed: false,
      cursor: acquiredCursor,
      needsFinalize: false,
      run: null,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: candidateReplicaRef,
      cursorSnapshotRef: candidateBundle.ref,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: acquiredCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      candidateBundle.artifactKeys[0],
      candidateBundle.ref.key,
      candidateReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(3);
    expect(bucket.objects.has(authoritativeBundle.artifactKeys[0])).toBe(true);
    expect(bucket.objects.has(authoritativeBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(authoritativeReplicaRef.objectKey)).toBe(true);
    expect(bucket.objects.has(candidateBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(candidateReplicaRef.objectKey)).toBe(false);
    await expectRecordedRunPhases([
      "acquired",
      "commit_attempted",
      "commit_lost",
    ]);
  });

  it("reconciles old authoritative cleanup on the next drain when commit response loss hides a winning cursor swap", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-commit-response-loss-cleanup",
    });
    const previousBundle = await writeHostedBundleFixture({
      artifactPayloads: ["old-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const currentBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const previousReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "a".repeat(64),
      userId: "user-resume-finalize",
    });
    const currentReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T09:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "b".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: previousBundle.ref,
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      browserVaultReplicaRef: currentReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: currentBundle.ref,
      version: "cursor-v2",
    });
    const run = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "runtime_timer" as const,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: true,
        cursor: acquiredCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: false,
        run,
        runToken: "prepare-token",
      })
      .mockResolvedValueOnce({
        acquired: false,
        cursor: committedCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
      });
    webControlMocks.commitHostedRunToWeb.mockRejectedValueOnce(
      new Error("hosted run commit response lost"),
    );
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: currentReplicaRef,
      cursorSnapshotRef: currentBundle.ref,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    await expect(runner.drainHostedRuns()).rejects.toThrow("hosted run commit response lost");

    const recovered = await runner.drainHostedRuns();

    expect(recovered).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      previousBundle.artifactKeys[0],
      previousBundle.ref.key,
      previousReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(3);
    expect(bucket.objects.has(previousBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(currentBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(previousReplicaRef.objectKey)).toBe(false);
    expect(bucket.objects.has(currentReplicaRef.objectKey)).toBe(true);
  });

  it("marks stale authoritative cleanup reconciled when the current authoritative bundle archive is invalid", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-invalid-authoritative-cleanup",
    });
    const previousBundle = await writeHostedBundleFixture({
      artifactPayloads: ["old-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const invalidCurrentBundleRef = await createHostedBundleStore({
      bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      userId: "user-resume-finalize",
    }).writeBundle("vault", Uint8Array.from(Buffer.from("not-a-hosted-bundle")));
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: previousBundle.ref,
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: invalidCurrentBundleRef,
      version: "cursor-v2",
    });
    const run = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "runtime_timer" as const,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: true,
        cursor: acquiredCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: false,
        run,
        runToken: "prepare-token",
      })
      .mockResolvedValueOnce({
        acquired: false,
        cursor: committedCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
      });
    webControlMocks.commitHostedRunToWeb.mockRejectedValueOnce(
      new Error("hosted run commit response lost"),
    );
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: invalidCurrentBundleRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    await expect(runner.drainHostedRuns()).rejects.toThrow("hosted run commit response lost");
    await expect(stateStore.readTrackedAuthoritativeCursor()).resolves.toEqual({
      browserVaultReplicaRef: null,
      snapshotRef: previousBundle.ref,
    });

    const recovered = await runner.drainHostedRuns();

    expect(recovered).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expect(stateStore.readTrackedAuthoritativeCursor()).resolves.toEqual({
      browserVaultReplicaRef: null,
      snapshotRef: invalidCurrentBundleRef,
    });
    expect(bucket.deleted).toEqual([]);
    expect(bucket.objects.has(previousBundle.artifactKeys[0])).toBe(true);
    expect(bucket.objects.has(previousBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(invalidCurrentBundleRef.key)).toBe(true);
  });

  it("preserves pending finalize cleanup when commit response loss hides a winning prepared snapshot", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-finalize-response-loss-recovery",
    });
    const initialBundle = await writeHostedBundleFixture({
      artifactPayloads: ["initial-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const preparedBundle = await writeHostedBundleFixture({
      artifactPayloads: ["prepared-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const finalBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const previousReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:45:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "d".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: initialBundle.ref,
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: preparedBundle.ref,
      version: "cursor-v2",
    });
    const finalizedCursor = createCursorState({
      browserVaultReplicaRef: null,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: finalBundle.ref,
      version: "cursor-v3",
    });
    const acquiredRun = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "runtime_timer" as const,
    };
    const committedRun = {
      ...acquiredRun,
      status: "committed_needs_finalize" as const,
    };
    const finalizingRun = {
      ...acquiredRun,
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: true,
        cursor: acquiredCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: false,
        run: acquiredRun,
        runToken: "prepare-token",
      })
      .mockResolvedValueOnce({
        acquired: true,
        cursor: committedCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: true,
        run: finalizingRun,
        runToken: "finalize-token",
      })
      .mockResolvedValueOnce({
        acquired: false,
        cursor: finalizedCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
        runToken: null,
      });
    webControlMocks.commitHostedRunToWeb.mockRejectedValueOnce(
      new Error("hosted run commit response lost"),
    );
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue({
      cursor: finalizedCursor,
      finalized: true,
      run: finalizingRun,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: preparedBundle.ref,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: null,
      cursorSnapshotRef: finalBundle.ref,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.persistPendingRunCleanupData.mockImplementation(async (input: {
      runId: string;
    }) => {
      await writeRequiredPendingCleanupState(stateStore, input.runId);
    });
    wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mockImplementation(async (input: {
      runId: string;
    }) => {
      await stateStore.clearPendingRunCleanup(input.runId);
    });

    await expect(runner.drainHostedRuns()).rejects.toThrow("hosted run commit response lost");
    await expect(stateStore.readDurablePendingRunCleanup(acquiredRun.id)).resolves.toEqual({
      emailMessages: [],
      linqMessageIds: [],
      required: true,
      telegramMessages: [],
    });

    const recovered = await runner.drainHostedRuns();

    expect(recovered).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.finalizeRunDrain).toHaveBeenCalledTimes(1);
    expect(webControlMocks.releaseHostedRunFinalizeInWeb).not.toHaveBeenCalled();
    await expect(stateStore.readDurablePendingRunCleanup(acquiredRun.id)).resolves.toBeNull();
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      initialBundle.artifactKeys[0],
      initialBundle.ref.key,
      preparedBundle.artifactKeys[0],
      preparedBundle.ref.key,
      previousReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(5);
    expect(bucket.objects.has(initialBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(preparedBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(finalBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(previousReplicaRef.objectKey)).toBe(false);
  });

  it("keeps the current browser-vault replica when commit rewrites it in place", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-in-place-browser-vault-rewrite",
    });
    const previousReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "c".repeat(64),
      userId: "user-resume-finalize",
    });
    const nextReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-21T08:30:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "c".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    expect(nextReplicaRef.objectKey).toBe(previousReplicaRef.objectKey);
    expect(nextReplicaRef.generatedAt).not.toBe(previousReplicaRef.generatedAt);

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/current",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      browserVaultReplicaRef: nextReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/current",
      version: "cursor-v2",
    });
    const run = createRunRecord();
    run.status = "acquired";
    run.triggerKind = "runtime_timer";

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValue({
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: nextReplicaRef,
      cursorSnapshotRef: acquiredCursor.snapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual([]);
    expect(bucket.objects.has(nextReplicaRef.objectKey)).toBe(true);
  });

  it("deletes superseded prepared snapshots only after finalization commits the replacement ref", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-finalize-cleanup",
    });
    const initialBundle = await writeHostedBundleFixture({
      artifactPayloads: ["initial-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const preparedBundle = await writeHostedBundleFixture({
      artifactPayloads: ["prepared-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const finalBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const previousReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:45:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "b".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const acquiredCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: initialBundle.ref,
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      browserVaultReplicaRef: previousReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: preparedBundle.ref,
      version: "cursor-v2",
    });
    const finalizedCursor = createCursorState({
      browserVaultReplicaRef: null,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: finalBundle.ref,
      version: "cursor-v3",
    });
    const run = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "runtime_timer" as const,
    };
    const committedRun = {
      ...run,
      status: "committed_needs_finalize" as const,
    };
    const finalizingRun = {
      ...run,
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: true,
        cursor: acquiredCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: false,
        run,
        runToken: "prepare-token",
      })
      .mockResolvedValueOnce({
        acquired: true,
        cursor: committedCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: true,
        run: finalizingRun,
        runToken: "finalize-token",
      });
    webControlMocks.commitHostedRunToWeb.mockResolvedValue({
      committed: true,
      cursor: committedCursor,
      needsFinalize: true,
      run: committedRun,
    });
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue({
      cursor: finalizedCursor,
      finalized: true,
      run: finalizingRun,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: preparedBundle.ref,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: null,
      cursorSnapshotRef: finalBundle.ref,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      initialBundle.artifactKeys[0],
      initialBundle.ref.key,
      preparedBundle.artifactKeys[0],
      preparedBundle.ref.key,
      previousReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(5);
    expect(bucket.objects.has(initialBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(preparedBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(finalBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(previousReplicaRef.objectKey)).toBe(false);
  });

  it("deletes losing finalization candidate objects when finalize loses", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-finalize-loss-candidate-cleanup",
    });
    const committedBundle = await writeHostedBundleFixture({
      artifactPayloads: ["prepared-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const finalCandidateBundle = await writeHostedBundleFixture({
      artifactPayloads: ["final-candidate-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const committedReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:45:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "b".repeat(64),
      userId: "user-resume-finalize",
    });
    const finalCandidateReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T09:45:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "c".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const committedCursor = createCursorState({
      browserVaultReplicaRef: committedReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: committedBundle.ref,
      version: "cursor-v2",
    });
    const run = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    await writeRequiredPendingCleanupState(stateStore, run.id);

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: committedCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run,
      runToken: "finalize-token",
    });
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue({
      cursor: committedCursor,
      finalized: false,
      run: null,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: finalCandidateReplicaRef,
      cursorSnapshotRef: finalCandidateBundle.ref,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      finalCandidateBundle.artifactKeys[0],
      finalCandidateBundle.ref.key,
      finalCandidateReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(3);
    expect(bucket.objects.has(committedBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(committedReplicaRef.objectKey)).toBe(true);
    expect(bucket.objects.has(finalCandidateBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(finalCandidateReplicaRef.objectKey)).toBe(false);
  });

  it("reconciles prepared snapshot cleanup on the next drain when finalize response loss hides a winning final ref", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-finalize-response-loss-cleanup",
    });
    const preparedBundle = await writeHostedBundleFixture({
      artifactPayloads: ["prepared-artifact"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const finalBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const preparedReplicaRef = await writeBrowserVaultReplicaFixture({
      bucket,
      generatedAt: "2026-04-20T08:45:00.000Z",
      rootKey: crypto.rootKey,
      sourceBundleHash: "b".repeat(64),
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const committedCursor = createCursorState({
      browserVaultReplicaRef: preparedReplicaRef,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: preparedBundle.ref,
      version: "cursor-v2",
    });
    const finalizedCursor = createCursorState({
      browserVaultReplicaRef: null,
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: finalBundle.ref,
      version: "cursor-v3",
    });
    const run = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    let finalizeResponseLost = false;
    await writeRequiredPendingCleanupState(stateStore, run.id);

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: true,
        cursor: committedCursor,
        events: [],
        pendingIngressEventCount: 1,
        resumeFinalize: true,
        run,
        runToken: "finalize-token",
      })
      .mockResolvedValueOnce({
        acquired: false,
        cursor: finalizedCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
      });
    webControlMocks.finalizeHostedRunInWeb.mockImplementationOnce(async () => {
      finalizeResponseLost = true;
      throw new Error("hosted run finalize response lost");
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
      body?: {
        runId?: string | null;
      };
    }) => {
      const statusRun = createRunRecord();
      statusRun.id = input.body?.runId ?? statusRun.id;
      statusRun.status = input.body?.runId === run.id && finalizeResponseLost
        ? "finalized"
        : "running";

      return {
        cursor: finalizedCursor,
        pendingIngressEventCount: 0,
        run: statusRun,
      };
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      browserVaultReplicaRef: null,
      cursorSnapshotRef: finalBundle.ref,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mockImplementation(async (input) => {
      if (input.runId === run.id) {
        await stateStore.clearPendingRunCleanup(run.id);
      }
    });

    await expect(runner.drainHostedRuns()).rejects.toThrow("hosted run finalize response lost");

    const recovered = await runner.drainHostedRuns();

    expect(recovered).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledTimes(1);
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledWith({
      runId: run.id,
      userId: "user-resume-finalize",
      wakes: [],
    });
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      preparedBundle.artifactKeys[0],
      preparedBundle.ref.key,
      preparedReplicaRef.objectKey,
    ]));
    expect(bucket.deleted).toHaveLength(3);
    expect(bucket.objects.has(preparedBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(finalBundle.ref.key)).toBe(true);
    expect(bucket.objects.has(preparedReplicaRef.objectKey)).toBe(false);
  });

  it("replays finalized pending cleanup state and prunes stale recovery sidecars", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const crypto = await userKeyStore.requireUserCryptoContext("user-resume-finalize", {
      reason: "test-recovered-pending-cleanup-replay",
    });
    const trackedBundle = await writeHostedBundleFixture({
      artifactPayloads: ["tracked-before-cleanup"],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const acquiredBundle = await writeHostedBundleFixture({
      artifactPayloads: [],
      bucket,
      crypto,
      userId: "user-resume-finalize",
    });
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const trackedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotRef: trackedBundle.ref,
      version: "cursor-v1",
    });
    const acquiredCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotRef: acquiredBundle.ref,
      version: "cursor-v2",
    });
    await stateStore.writeTrackedAuthoritativeCursor({
      browserVaultReplicaRef: trackedCursor.browserVaultReplicaRef ?? null,
      snapshotRef: trackedCursor.snapshotRef,
    });
    await stateStore.writePendingRunCleanup("run-cleanup-a", {
      emailMessages: [],
      linqMessageIds: ["linq-a"],
      required: true,
      telegramMessages: [],
    });
    await stateStore.writePendingRunCleanup("run-cleanup-b", {
      emailMessages: [],
      linqMessageIds: ["linq-b"],
      required: true,
      telegramMessages: [],
    });
    await stateStore.clearPendingRunCleanup("run-cleanup-b");

    const run = createRunRecord();
    run.id = "run-fresh-work";
    run.status = "acquired";

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: acquiredCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
      body?: {
        runId?: string | null;
      };
    }) => {
      const statusRun = createRunRecord();
      statusRun.id = input.body?.runId ?? statusRun.id;
      statusRun.status = input.body?.runId === "run-cleanup-a"
        ? "finalized"
        : input.body?.runId === "run-cleanup-b"
          ? "failed"
          : "running";

      return {
        cursor: acquiredCursor,
        pendingIngressEventCount: 0,
        run: statusRun,
      };
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: acquiredCursor.snapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mockImplementation(async (input) => {
      if (input.runId === "run-cleanup-a") {
        await stateStore.clearPendingRunCleanup("run-cleanup-a");
      }
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: acquiredCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledTimes(2);
    expect(
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mock.calls[0]?.[0],
    ).toEqual({
      runId: "run-cleanup-a",
      userId: "user-resume-finalize",
      wakes: [],
    });
    expect(
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mock.calls[1]?.[0],
    ).toEqual({
      assistantDeliveryOutcomes: [],
      runId: "run-fresh-work",
      userId: "user-resume-finalize",
      wakes: [],
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).not.toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-cleanup-b",
    }));
    await expect(stateStore.readDurablePendingRunCleanup("run-cleanup-b")).resolves.toBeNull();
    expect(wakeProcessorMocks.executeRunDrain).toHaveBeenCalledTimes(1);
    expect(bucket.deleted).toEqual(expect.arrayContaining([
      trackedBundle.artifactKeys[0],
      trackedBundle.ref.key,
    ]));
    expect(bucket.deleted).toHaveLength(2);
    expect(bucket.objects.has(trackedBundle.ref.key)).toBe(false);
    expect(bucket.objects.has(acquiredBundle.ref.key)).toBe(true);
  });

  it("replays durable pending cleanup before the tracked authoritative cursor is first seeded", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const currentCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v2",
    });

    await stateStore.writePendingRunCleanup("run-cleanup-bootstrap", {
      emailMessages: [],
      linqMessageIds: ["linq-bootstrap"],
      required: true,
      telegramMessages: [],
    });

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: false,
      cursor: currentCursor,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: null,
      runToken: null,
    });
    webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
      body?: {
        runId?: string | null;
      };
    }) => {
      const statusRun = createRunRecord();
      statusRun.id = input.body?.runId ?? statusRun.id;
      statusRun.status = input.body?.runId === "run-cleanup-bootstrap" ? "finalized" : "running";

      return {
        cursor: currentCursor,
        pendingIngressEventCount: 0,
        run: statusRun,
      };
    });
    wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mockImplementation(async (input) => {
      if (input.runId === "run-cleanup-bootstrap") {
        await stateStore.clearPendingRunCleanup("run-cleanup-bootstrap");
      }
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: currentCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledTimes(1);
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledWith({
      runId: "run-cleanup-bootstrap",
      userId: "user-resume-finalize",
      wakes: [],
    });
    await expect(stateStore.readTrackedAuthoritativeCursor()).resolves.toEqual({
      browserVaultReplicaRef: currentCursor.browserVaultReplicaRef ?? null,
      snapshotRef: currentCursor.snapshotRef,
    });
    await expect(stateStore.readDurablePendingRunCleanup("run-cleanup-bootstrap")).resolves.toBeNull();
  });

  it("preserves durable pending cleanup for a live finalize run when the authoritative cursor has advanced", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );
    const trackedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/tracked",
      version: "cursor-v1",
    });
    const currentCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/prepared",
      version: "cursor-v2",
    });

    await stateStore.writeTrackedAuthoritativeCursor({
      browserVaultReplicaRef: trackedCursor.browserVaultReplicaRef ?? null,
      snapshotRef: trackedCursor.snapshotRef,
    });
    await stateStore.writePendingRunCleanup("run-cleanup-live", {
      emailMessages: [],
      linqMessageIds: ["linq-live"],
      required: true,
      telegramMessages: [],
    });

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: false,
      cursor: currentCursor,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: null,
      runToken: null,
    });
    webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
      body?: {
        runId?: string | null;
      };
    }) => {
      const statusRun = createRunRecord();
      statusRun.id = input.body?.runId ?? statusRun.id;
      statusRun.status = input.body?.runId === "run-cleanup-live"
        ? "committed_needs_finalize"
        : "running";

      return {
        cursor: currentCursor,
        pendingIngressEventCount: 0,
        run: statusRun,
      };
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: currentCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expect(stateStore.readTrackedAuthoritativeCursor()).resolves.toEqual({
      browserVaultReplicaRef: currentCursor.browserVaultReplicaRef ?? null,
      snapshotRef: currentCursor.snapshotRef,
    });
    await expect(stateStore.readDurablePendingRunCleanup("run-cleanup-live")).resolves.toEqual({
      emailMessages: [],
      linqMessageIds: ["linq-live"],
      required: true,
      telegramMessages: [],
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).not.toHaveBeenCalled();
  });

  it("retries durable pending cleanup replay even when the authoritative cursor does not change again", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const currentCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v2",
    });

    await stateStore.writeTrackedAuthoritativeCursor({
      browserVaultReplicaRef: currentCursor.browserVaultReplicaRef ?? null,
      snapshotRef: currentCursor.snapshotRef,
    });
    await stateStore.writePendingRunCleanup("run-cleanup-retry", {
      emailMessages: [],
      linqMessageIds: ["linq-retry"],
      required: true,
      telegramMessages: [],
    });

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce({
        acquired: false,
        cursor: currentCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
        runToken: null,
      })
      .mockResolvedValueOnce({
        acquired: false,
        cursor: currentCursor,
        events: [],
        pendingIngressEventCount: 0,
        resumeFinalize: false,
        run: null,
        runToken: null,
      });
    webControlMocks.readHostedRunStatusFromWeb.mockImplementation(async (input: {
      body?: {
        runId?: string | null;
      };
    }) => {
      const statusRun = createRunRecord();
      statusRun.id = input.body?.runId ?? statusRun.id;
      statusRun.status = input.body?.runId === "run-cleanup-retry" ? "finalized" : "running";

      return {
        cursor: currentCursor,
        pendingIngressEventCount: 0,
        run: statusRun,
      };
    });
    wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain
      .mockRejectedValueOnce(new Error("cleanup replay failed"))
      .mockImplementationOnce(async (input) => {
        if (input.runId === "run-cleanup-retry") {
          await stateStore.clearPendingRunCleanup("run-cleanup-retry");
        }
      });

    const first = await runner.drainHostedRuns();
    const second = await runner.drainHostedRuns();

    expect(first).toEqual({
      committedSeq: currentCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(second).toEqual({
      committedSeq: currentCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledTimes(2);
    expect(
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mock.calls[0]?.[0],
    ).toEqual({
      runId: "run-cleanup-retry",
      userId: "user-resume-finalize",
      wakes: [],
    });
    expect(
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain.mock.calls[1]?.[0],
    ).toEqual({
      runId: "run-cleanup-retry",
      userId: "user-resume-finalize",
      wakes: [],
    });
    await expect(stateStore.readDurablePendingRunCleanup("run-cleanup-retry")).resolves.toBeNull();
  });

  it("fails closed when hosted run status cannot be refreshed before commit", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const runner = new HostedUserRunner(
      createDurableObjectStateHarness(),
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const mergeCommitInputs = Reflect.get(
      runner,
      "mergeAdoptedHostedRunCommitInputs",
    );
    if (typeof mergeCommitInputs !== "function") {
      throw new Error("Expected hosted runner commit merge helper to be callable.");
    }
    const run = createRunRecord();
    run.status = "acquired";
    webControlMocks.readHostedRunStatusFromWeb.mockRejectedValueOnce(
      new Error("status refresh failed"),
    );

    await expect(
      mergeCommitInputs.call(runner, {
        eventResults: [],
        outputCommittedSeq: "10",
        run,
        userId: "user-resume-finalize",
      }),
    ).rejects.toThrow("status refresh failed");
  });

  it("does not infer adopted wake completion from refreshed run projection membership", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const runner = new HostedUserRunner(
      createDurableObjectStateHarness(),
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const mergeCommitInputs = Reflect.get(
      runner,
      "mergeAdoptedHostedRunCommitInputs",
    );
    if (typeof mergeCommitInputs !== "function") {
      throw new Error("Expected hosted runner commit merge helper to be callable.");
    }
    const run = createRunRecord();
    run.status = "running";
    run.eventSeqs = ["11", "12"];
    run.ingressEventIds = ["wake-explicit", "wake-adopted"];
    webControlMocks.readHostedRunStatusFromWeb.mockResolvedValueOnce({
      cursor: createCursorState({
        committedSeq: "10",
        nextSeq: "13",
        snapshotKey: "snapshot/adopted-status",
        version: "cursor-adopted",
      }),
      pendingIngressEventCount: 1,
      run,
    });

    await expect(
      mergeCommitInputs.call(runner, {
        eventResults: [
          {
            ingressEventId: "wake-explicit",
            state: "completed",
          },
        ],
        outputCommittedSeq: "11",
        run,
        userId: "user-resume-finalize",
      }),
    ).resolves.toEqual({
      eventResults: [
        {
          ingressEventId: "wake-explicit",
          state: "completed",
        },
      ],
      outputCommittedSeq: "11",
    });
  });

  it("commits adopted turn-input wakes only when the runtime reports them processed", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const runner = new HostedUserRunner(
      createDurableObjectStateHarness(),
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const mergeCommitInputs = Reflect.get(
      runner,
      "mergeAdoptedHostedRunCommitInputs",
    );
    if (typeof mergeCommitInputs !== "function") {
      throw new Error("Expected hosted runner commit merge helper to be callable.");
    }
    const run = createRunRecord();
    run.status = "running";
    run.eventSeqs = ["11", "12", "13"];
    run.ingressEventIds = ["wake-explicit", "wake-adopted", "wake-unreported"];
    webControlMocks.readHostedRunStatusFromWeb.mockResolvedValueOnce({
      cursor: createCursorState({
        committedSeq: "10",
        nextSeq: "14",
        snapshotKey: "snapshot/adopted-runtime-reported",
        version: "cursor-adopted-runtime-reported",
      }),
      pendingIngressEventCount: 1,
      run,
    });

    await expect(
      mergeCommitInputs.call(runner, {
        adoptedEventResults: [
          {
            ingressEventId: "wake-adopted",
            state: "completed",
          },
          {
            ingressEventId: "wake-not-in-run",
            state: "completed",
          },
        ],
        eventResults: [
          {
            ingressEventId: "wake-explicit",
            state: "completed",
          },
        ],
        outputCommittedSeq: "11",
        run,
        userId: "user-resume-finalize",
      }),
    ).resolves.toEqual({
      eventResults: [
        {
          ingressEventId: "wake-explicit",
          state: "completed",
        },
        {
          ingressEventId: "wake-adopted",
          state: "completed",
        },
      ],
      outputCommittedSeq: "12",
    });
  });

  it("treats hosted wake drain cap exhaustion as backpressure and schedules a retry", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const run = createRunRecord();
    run.status = "acquired";
    run.triggerKind = "external_ingress";

    for (let index = 0; index < 32; index += 1) {
      const seq = (11 + index).toString();
      const nextSeq = (12 + index).toString();
      const wake = buildHostedExecutionMemberActivatedWake({
        eventId: `evt_cap_${seq}`,
        memberChannels: {
          email: true,
          linq: false,
          telegram: false,
        },
        memberId: "user-resume-finalize",
        occurredAt: "2026-04-20T00:00:00.000Z",
      });
      const acquiredCursor = createCursorState({
        committedSeq: (10 + index).toString(),
        nextSeq: seq,
        snapshotKey: `snapshot/cap-acquired-${seq}`,
        version: `cursor-cap-${seq}`,
      });
      const committedCursor = createCursorState({
        committedSeq: seq,
        nextSeq,
        snapshotKey: `snapshot/cap-committed-${seq}`,
        version: `cursor-cap-committed-${seq}`,
      });
      webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
        acquired: true,
        cursor: acquiredCursor,
        events: [
          createAcquireEvent({
            id: `wake-cap-${seq}`,
            seq,
            userId: "user-resume-finalize",
            wake,
          }),
        ],
        pendingIngressEventCount: 1,
        resumeFinalize: false,
        run,
        runToken: `run-token-${seq}`,
      });
      webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
        committed: true,
        cursor: committedCursor,
        needsFinalize: false,
        run,
      });
    }

    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockImplementation(async (input) => ({
      cursorSnapshotRef: createSnapshotRef(
        `snapshot/cap-committed-${input.events[0]?.seq ?? "unknown"}`,
      ),
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    }));

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "999",
    });

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(32);
    expect(webControlMocks.acquireHostedRunFromWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        limit: 64,
      },
    });
    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(32);
    expect(result).toEqual({
      committedSeq: "42",
      requestedTargetSeq: "999",
      targetReached: false,
    });
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: expect.any(String),
    });
  });

  it("reacquires finalize-required commits before running finalize side effects", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/committed",
      version: "cursor-v2",
    });
    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v4",
    });
    const acquiredRun = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "external_ingress" as const,
    };
    const committedRun = {
      ...acquiredRun,
      status: "committed_needs_finalize" as const,
    };
    const finalizingRun = {
      ...acquiredRun,
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };

    const prepareAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "evt-linq",
          seq: "11",
          userId: "user-resume-finalize",
          wake: buildHostedExecutionLinqConversationMessageWake({
            eventId: "linq-wake",
            linqMessage: {
              chatId: "chat_123",
              from: "+15550001",
              isFromMe: false,
              messageId: "linq_inbound_message",
              parts: [
                {
                  type: "text",
                  value: "hello",
                },
              ],
            },
            occurredAt: "2026-04-20T09:00:00.000Z",
            phoneLookupKey: "lookup_123",
            userId: "user-resume-finalize",
          }),
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run: acquiredRun,
      runToken: "prepare-token",
    };
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: committedCursor,
      needsFinalize: true,
      run: committedRun,
    };
    const finalizedResponse: HostedRunFinalizeResponse = {
      cursor: finalizedCursor,
      finalized: true,
      run: finalizingRun,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(prepareAcquire)
      .mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue(finalizedResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      assistantDeliveryOutcomes: [
        {
          deliveryChannel: "linq",
          deliveryErrorCode: null,
          deliveryErrorMessage: null,
          deliveryStatus: "sent",
          effectFingerprint: "fingerprint-linq",
          effectId: "effect-linq",
          journalMethod: null,
          journalStatus: null,
          providerMessageId: "linq_outbound_message",
          providerThreadId: "chat_123",
          retryable: false,
          target: "chat_123",
          targetKind: "thread",
        },
      ],
      cursorSnapshotRef: committedCursor.snapshotRef,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      cursorSnapshotRef: finalizedCursor.snapshotRef,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(2);
    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledTimes(1);
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledTimes(1);
    expect(wakeProcessorMocks.persistPendingRunCleanupData).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [
          expect.objectContaining({
            deliveryChannel: "linq",
            providerMessageId: "linq_outbound_message",
          }),
        ],
        runId: acquiredRun.id,
        wakes: [
          expect.objectContaining({
            eventId: "linq-wake",
            kind: "conversation.message",
          }),
        ],
      }),
    );
    expect(wakeProcessorMocks.finalizeRunDrain).toHaveBeenCalledTimes(1);
    expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        runId: finalizingRun.id,
        runToken: "finalize-token",
      }),
    }));
    expect(result).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [],
        runId: finalizingRun.id,
        userId: "user-resume-finalize",
        wakes: [
          expect.objectContaining({
            eventId: "linq-wake",
            kind: "conversation.message",
          }),
        ],
      }),
    );
    await expectRecordedRunPhases([
      "acquired",
      "commit_attempted",
      "commit_won",
      "finalize_started",
      "finalize_finished",
    ]);
  });

  it("fails closed before a finalize-required commit when pending cleanup persistence fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/retry",
      version: "cursor-v2",
    });
    const acquiredRun = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "external_ingress" as const,
    };
    const cleanupWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-wake",
      linqMessage: {
        chatId: "chat_123",
        from: "+15550001",
        isFromMe: false,
        messageId: "linq_inbound_message",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-20T09:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "user-resume-finalize",
    });

    const prepareAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "evt-linq",
          seq: "11",
          userId: "user-resume-finalize",
          wake: cleanupWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run: acquiredRun,
      runToken: "prepare-token",
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: acquiredCursor,
      needsFinalize: false,
      run: null,
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(prepareAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: committedCursor.snapshotRef,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.persistPendingRunCleanupData.mockRejectedValueOnce(
      new Error("pending cleanup sidecar write failed"),
    );

    try {
      const result = await runner.drainHostedRuns();

      expect(result).toEqual({
        committedSeq: acquiredCursor.committedSeq,
        requestedTargetSeq: null,
        targetReached: true,
      });
      expect(wakeProcessorMocks.persistPendingRunCleanupData).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantDeliveryOutcomes: [],
          runId: acquiredRun.id,
          wakes: [cleanupWake],
        }),
      );
      expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(1);
      expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
      expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          failureClass: "hosted_run_runtime",
          failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_PERSIST_FAILED",
          finalizeRequired: false,
          preparedSnapshotRef: acquiredCursor.snapshotRef,
          runId: acquiredRun.id,
          runToken: "prepare-token",
        }),
      }));
      expect(wakeProcessorMocks.finalizeRunDrain).not.toHaveBeenCalled();
      expect(webControlMocks.finalizeHostedRunInWeb).not.toHaveBeenCalled();
      expect(webControlMocks.releaseHostedRunFinalizeInWeb).not.toHaveBeenCalled();
      expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).not.toHaveBeenCalled();

      const warningPayloads = warnSpy.mock.calls.map(([entry]) => (
        JSON.parse(String(entry ?? "{}")) as Record<string, unknown>
      ));
      const payload = warningPayloads.find((entry) => String(entry.message ?? "").includes(
        "Hosted run pending cleanup persistence failed; refusing to commit a finalize-required snapshot without durable cleanup recovery state.",
      ));
      expect(payload).toBeDefined();
      expect(payload).toEqual(expect.objectContaining({
        component: "cloudflare.user-runner",
        details: expect.objectContaining({
          cleanupWakeCount: 1,
          runId: acquiredRun.id,
        }),
        level: "warn",
        message: expect.stringContaining(
          "Hosted run pending cleanup persistence failed; refusing to commit a finalize-required snapshot without durable cleanup recovery state.",
        ),
        phase: "wake.running",
        userId: "user-resume-finalize",
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails closed when resume-finalize is missing pending cleanup recovery state", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizingRun = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    webControlMocks.releaseHostedRunFinalizeInWeb.mockResolvedValue({
      cursor: finalizeCursor,
      released: true,
      run: {
        ...finalizingRun,
        errorClass: "hosted_run_finalize_retryable",
        errorCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_MISSING",
        status: "committed_needs_finalize",
      },
    });

    try {
      const result = await runner.drainHostedRuns();

      expect(result).toEqual({
        committedSeq: finalizeCursor.committedSeq,
        requestedTargetSeq: null,
        targetReached: true,
      });
      expect(wakeProcessorMocks.finalizeRunDrain).not.toHaveBeenCalled();
      expect(webControlMocks.finalizeHostedRunInWeb).not.toHaveBeenCalled();
      expect(webControlMocks.releaseHostedRunFinalizeInWeb).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_MISSING",
          runId: finalizingRun.id,
          runToken: "finalize-token",
        }),
      }));

      const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0] ?? "{}")) as Record<string, unknown>;
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(payload).toEqual(expect.objectContaining({
        component: "cloudflare.user-runner",
        details: expect.objectContaining({
          runId: finalizingRun.id,
        }),
        level: "warn",
        message: expect.stringContaining(
          "Hosted run finalize resume is missing pending cleanup recovery state; refusing to finalize until recovery data is available.",
        ),
        phase: "wake.running",
        userId: "user-resume-finalize",
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails closed when resume-finalize cannot read pending cleanup recovery state", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const originalGet = state.storage.get.bind(state.storage);
    state.storage.get = async <T,>(key: string): Promise<T | undefined> => {
      if (key === "runner:pending-cleanup:run-resume-finalize") {
        throw new Error("pending cleanup sidecar unreadable");
      }

      return await originalGet<T>(key);
    };
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizingRun = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    webControlMocks.releaseHostedRunFinalizeInWeb.mockResolvedValue({
      cursor: finalizeCursor,
      released: true,
      run: {
        ...finalizingRun,
        errorClass: "hosted_run_finalize_retryable",
        errorCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_UNREADABLE",
        status: "committed_needs_finalize",
      },
    });

    try {
      const result = await runner.drainHostedRuns();

      expect(result).toEqual({
        committedSeq: finalizeCursor.committedSeq,
        requestedTargetSeq: null,
        targetReached: true,
      });
      expect(wakeProcessorMocks.finalizeRunDrain).not.toHaveBeenCalled();
      expect(webControlMocks.finalizeHostedRunInWeb).not.toHaveBeenCalled();
      expect(webControlMocks.releaseHostedRunFinalizeInWeb).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_UNREADABLE",
          runId: finalizingRun.id,
          runToken: "finalize-token",
        }),
      }));

      const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0] ?? "{}")) as Record<string, unknown>;
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(payload).toEqual(expect.objectContaining({
        component: "cloudflare.user-runner",
        details: expect.objectContaining({
          runId: finalizingRun.id,
        }),
        level: "warn",
        message: expect.stringContaining(
          "Hosted run finalize resume could not read pending cleanup recovery state; refusing to finalize until recovery data is available.",
        ),
        phase: "wake.running",
        userId: "user-resume-finalize",
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("uses runner-local fallback cleanup recovery state for resume-finalize on the same Durable Object", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );
    const runnerStateStore = Reflect.get(runner, "stateStore") as RunnerStateStore;

    if (!runnerStateStore) {
      throw new Error("Expected hosted runner state store to be available for test setup.");
    }

    const originalPut = state.storage.put.bind(state.storage);
    let failPendingCleanupPut = true;
    state.storage.put = async (key, value) => {
      if (failPendingCleanupPut) {
        failPendingCleanupPut = false;
        throw new Error("pending cleanup sidecar write failed");
      }

      await originalPut(key, value);
    };

    await expect(runnerStateStore.writePendingRunCleanup("run-resume-finalize", {
      emailMessages: [],
      linqMessageIds: ["linq-fallback"],
      required: true,
      telegramMessages: [],
    })).rejects.toThrow("pending cleanup sidecar write failed");
    state.storage.put = originalPut;

    await expect(runnerStateStore.readPendingRunCleanup("run-resume-finalize")).resolves.toEqual({
      emailMessages: [],
      linqMessageIds: ["linq-fallback"],
      required: true,
      telegramMessages: [],
    });
    await expect(runnerStateStore.readDurablePendingRunCleanup("run-resume-finalize")).resolves.toBeNull();

    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v4",
    });
    const finalizingRun = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };
    const noWorkAcquire: HostedRunAcquireResponse = {
      acquired: false,
      cursor: finalizedCursor,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: null,
      runToken: null,
    };
    const finalizedResponse: HostedRunFinalizeResponse = {
      cursor: finalizedCursor,
      finalized: true,
      run: finalizingRun,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(resumeFinalizeAcquire)
      .mockResolvedValueOnce(noWorkAcquire);
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue(finalizedResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      cursorSnapshotRef: finalizedCursor.snapshotRef,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    try {
      const result = await runner.drainHostedRuns();

      expect(result).toEqual({
        committedSeq: finalizedCursor.committedSeq,
        requestedTargetSeq: null,
        targetReached: true,
      });
      expect(wakeProcessorMocks.finalizeRunDrain).toHaveBeenCalledTimes(1);
      expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledTimes(1);
      expect(webControlMocks.releaseHostedRunFinalizeInWeb).not.toHaveBeenCalled();
      expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantDeliveryOutcomes: [],
          runId: finalizingRun.id,
          userId: "user-resume-finalize",
          wakes: [],
        }),
      );

      const warningPayloads = warnSpy.mock.calls.map(([entry]) => (
        JSON.parse(String(entry ?? "{}")) as Record<string, unknown>
      ));
      expect(warningPayloads.some((entry) => String(entry.message ?? "").includes(
        "Hosted run finalize resume is missing pending cleanup recovery state",
      ))).toBe(false);
      expect(warningPayloads.some((entry) => String(entry.message ?? "").includes(
        "Hosted run finalize resume could not read pending cleanup recovery state",
      ))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("runs prepare and finalize side effects in order for finalize-required commits", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/acquired",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/committed",
      version: "cursor-v2",
    });
    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/finalized",
      version: "cursor-v4",
    });
    const acquiredRun = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "external_ingress" as const,
    };
    const committedRun = {
      ...acquiredRun,
      status: "committed_needs_finalize" as const,
    };
    const finalizingRun = {
      ...acquiredRun,
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    const steps: string[] = [];

    const prepareAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run: acquiredRun,
      runToken: "prepare-token",
    };
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: committedCursor,
      needsFinalize: true,
      run: committedRun,
    };
    const finalizedResponse: HostedRunFinalizeResponse = {
      cursor: finalizedCursor,
      finalized: true,
      run: finalizingRun,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(prepareAcquire)
      .mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.finalizeHostedRunInWeb.mockImplementation(async () => {
      expect(steps).toEqual(expect.arrayContaining([
        "prepare.runtime",
        "finalize.runtime",
      ]));
      expect(steps.indexOf("prepare.runtime")).toBeLessThan(steps.indexOf("finalize.runtime"));
      return finalizedResponse;
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockImplementation(async () => {
      steps.push("prepare.runtime");
      return {
        cursorSnapshotRef: committedCursor.snapshotRef,
        finalizeRequired: true,
        nextRuntimeWakeAt: null,
        redactedSummary: null,
        state: "completed",
      };
    });
    wakeProcessorMocks.finalizeRunDrain.mockImplementation(async () => {
      steps.push("finalize.runtime");
      return {
        cursorSnapshotRef: finalizedCursor.snapshotRef,
        nextRuntimeWakeAt: null,
        redactedSummary: null,
        state: "completed",
      };
    });

    const result = await runner.drainHostedRuns();

    expect(result).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(steps).toEqual([
      "prepare.runtime",
      "finalize.runtime",
    ]);
  });

  it("releases claimed finalizing runs for retry when finalize side effects backpressure", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const finalizeCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/finalize",
      version: "cursor-v3",
    });
    const finalizingRun = {
      ...createRunRecord(),
      status: "finalizing" as const,
      triggerKind: "retry_finalize" as const,
    };
    await writeRequiredPendingCleanupState(stateStore, finalizingRun.id);
    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: finalizeCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: true,
      run: finalizingRun,
      runToken: "finalize-token",
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    webControlMocks.releaseHostedRunFinalizeInWeb.mockResolvedValue({
      cursor: finalizeCursor,
      released: true,
      run: {
        ...finalizingRun,
        errorClass: "hosted_run_finalize_retryable",
        errorCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
        status: "committed_needs_finalize",
      },
    });
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      cursorSnapshotRef: finalizeCursor.snapshotRef,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "backpressured",
    });

    const result = await runner.drainHostedRuns();

    expect(wakeProcessorMocks.finalizeRunDrain).toHaveBeenCalledTimes(1);
    expect(webControlMocks.finalizeHostedRunInWeb).not.toHaveBeenCalled();
    expect(webControlMocks.releaseHostedRunFinalizeInWeb).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        failureClass: "hosted_run_finalize_retryable",
        failureCode: "HOSTED_RUN_FINALIZE_BACKPRESSURED",
        runId: finalizingRun.id,
        runToken: "finalize-token",
      }),
    }));
    expect(result).toEqual({
      committedSeq: finalizeCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: expect.any(String),
    });
    await expectRecordedRunPhases([
      "acquired",
      "finalize_started",
      "finalize_released",
    ]);
  });

  it("quarantines wakes with missing raw email payloads and keeps draining later contiguous wakes", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );

    const missingRawWake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_missing_raw",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-20T00:00:00.000Z",
      rawMessageKey: "raw_missing",
      selfAddress: "reply+user@mail.example.test",
      userId: "user-resume-finalize",
    });
    const laterWake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_later",
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:01:00.000Z",
    });
    const firstAcquireCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/quarantine",
      version: "cursor-v1",
    });
    const secondAcquireCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/later",
      version: "cursor-v2",
    });
    const drainedCursor = createCursorState({
      committedSeq: "12",
      nextSeq: "13",
      snapshotKey: "snapshot/drained",
      version: "cursor-v3",
    });
    const run = createRunRecord();
    run.status = "acquired";

    const firstAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: firstAcquireCursor,
      events: [
        createAcquireEvent({
          id: "wake-missing-raw",
          seq: "11",
          userId: "user-resume-finalize",
          wake: missingRawWake,
        }),
      ],
      pendingIngressEventCount: 2,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    };
    const secondAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: secondAcquireCursor,
      events: [
        createAcquireEvent({
          id: "wake-later",
          seq: "12",
          userId: "user-resume-finalize",
          wake: laterWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    };
    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(firstAcquire)
      .mockResolvedValueOnce(secondAcquire);
    webControlMocks.commitHostedRunToWeb
      .mockResolvedValueOnce({
        committed: true,
        cursor: secondAcquireCursor,
        needsFinalize: false,
        run,
      })
      .mockResolvedValueOnce({
        committed: true,
        cursor: drainedCursor,
        needsFinalize: false,
        run,
      });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: drainedCursor.snapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "12",
    });

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(2);
    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(2);
    expect(webControlMocks.commitHostedRunToWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventResults: [
          {
            quarantineCode: "email-raw-message-missing",
            state: "quarantined",
            ingressEventId: "wake-missing-raw",
          },
        ],
        outputCommittedSeq: "11",
      },
    });
    expect(wakeProcessorMocks.executeRunDrain).toHaveBeenCalledTimes(1);
    expect(wakeProcessorMocks.executeRunDrain.mock.calls[0]?.[0]).toMatchObject({
      events: [
        {
          seq: "12",
          wake: laterWake,
          ingressEventId: "wake-later",
        },
      ],
    });
    expect(result).toEqual({
      committedSeq: drainedCursor.committedSeq,
      requestedTargetSeq: "12",
      targetReached: true,
    });
  });

  it("quarantines invalid wake payloads before commit", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/invalid-payload",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/after-invalid-payload",
      version: "cursor-v2",
    });
    const run = createRunRecord();
    run.status = "acquired";

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createEncryptedAcquireEvent({
          decryptedPayload: {
            nope: true,
          },
          id: "wake-invalid-payload",
          kind: "member.activated",
          occurredAt: "2026-04-20T00:00:00.000Z",
          seq: "11",
          userId: "user-resume-finalize",
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    });

    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.commitHostedRunToWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventResults: [
          {
            quarantineCode: "invalid-wake-payload",
            state: "quarantined",
            ingressEventId: "wake-invalid-payload",
          },
        ],
        outputCommittedSeq: "11",
      },
    });
    expect(wakeProcessorMocks.executeRunDrain).not.toHaveBeenCalled();
    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: "11",
      targetReached: true,
    });
    await expect(stateStore.readState()).resolves.toMatchObject({
      userId: "user-resume-finalize",
    });
  });

  it("quarantines wakes when a deterministic share pack side input is missing", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const shareWake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share_pack_missing",
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:00:00.000Z",
      share: {
        ownerUserId: "share-owner",
        shareId: "share-missing",
      },
    });
    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/share-pack-missing",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/after-share-pack-missing",
      version: "cursor-v2",
    });
    const run = createRunRecord();
    run.status = "acquired";

    wakeProcessorMocks.readRunDrainSharePack.mockRejectedValueOnce(
      new HostedRunSideInputNotFoundError({
        message: "share pack unavailable",
        sideInputKind: "share-pack",
      }),
    );
    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-share-pack-missing",
          seq: "11",
          userId: "user-resume-finalize",
          wake: shareWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    });

    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.commitHostedRunToWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventResults: [
          {
            quarantineCode: "hosted-side-input-unavailable",
            state: "quarantined",
            ingressEventId: "wake-share-pack-missing",
          },
        ],
        outputCommittedSeq: "11",
      },
    });
    expect(wakeProcessorMocks.executeRunDrain).not.toHaveBeenCalled();
    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: "11",
      targetReached: true,
    });
    await expect(stateStore.readState()).resolves.toMatchObject({
      userId: "user-resume-finalize",
    });
  });

  it("quarantines wakes when a deterministic vault sync import side input is missing", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const vaultSyncWake = buildHostedExecutionVaultSyncImportWake({
      eventId: "evt_vault_sync_missing",
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:00:00.000Z",
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi-missing",
        sourceVaultId: "vault-source",
        sourceVaultTitle: "Source Vault",
      },
    });
    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/vault-sync-missing",
      version: "cursor-v1",
    });
    const run = createRunRecord();
    run.status = "acquired";

    wakeProcessorMocks.readRunDrainVaultSyncImport.mockRejectedValueOnce(
      new HostedRunSideInputNotFoundError({
        message: "vault sync import unavailable",
        sideInputKind: "vault-sync-import",
      }),
    );
    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-vault-sync-missing",
          seq: "11",
          userId: "user-resume-finalize",
          wake: vaultSyncWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: createCursorState({
        committedSeq: "11",
        nextSeq: "12",
        snapshotKey: "snapshot/vault-sync-missing-committed",
        version: "cursor-v2",
      }),
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    });

    expect(webControlMocks.commitHostedRunToWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.commitHostedRunToWeb.mock.calls[0]?.[0]).toMatchObject({
      body: {
        eventResults: [
          {
            quarantineCode: "hosted-side-input-unavailable",
            state: "quarantined",
            ingressEventId: "wake-vault-sync-missing",
          },
        ],
        outputCommittedSeq: "11",
      },
    });
    expect(wakeProcessorMocks.executeRunDrain).not.toHaveBeenCalled();
    expect(result).toEqual({
      committedSeq: "11",
      requestedTargetSeq: "11",
      targetReached: true,
    });
    await expect(stateStore.readState()).resolves.toMatchObject({
      userId: "user-resume-finalize",
    });
  });

  it("backpressures without committing when share pack hydration fails transiently", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const shareWake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share_pack_transient",
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:00:00.000Z",
      share: {
        ownerUserId: "share-owner",
        shareId: "share-transient",
      },
    });
    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/share-pack-transient",
      version: "cursor-v1",
    });
    const run = createRunRecord();
    run.status = "acquired";

    wakeProcessorMocks.readRunDrainSharePack.mockRejectedValueOnce(
      new Error("Hosted share payload read failed with HTTP 503."),
    );
    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-share-pack-transient",
          seq: "11",
          userId: "user-resume-finalize",
          wake: shareWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });

    await expect(runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    })).rejects.toThrow("Hosted share payload read failed with HTTP 503.");
    expect(webControlMocks.commitHostedRunToWeb).not.toHaveBeenCalled();
    expect(wakeProcessorMocks.executeRunDrain).not.toHaveBeenCalled();
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: expect.any(String),
    });
  });

  it("hydrates vault sync imports before draining and commits the hydrated side input", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const vaultSyncWake = buildHostedExecutionVaultSyncImportWake({
      eventId: "evt_vault_sync",
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:00:00.000Z",
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceVaultId: "vault_local",
        sourceVaultTitle: "Local Vault",
      },
    });
    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/vault-sync",
      version: "cursor-v1",
    });
    const committedCursor = createCursorState({
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/vault-sync-committed",
      version: "cursor-v2",
    });
    const run = createRunRecord();
    run.status = "acquired";

    wakeProcessorMocks.readRunDrainVaultSyncImport.mockResolvedValueOnce({
      bundleBase64: "AQID",
      sessionId: "vsi_runtime",
    });
    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-vault-sync",
          seq: "11",
          userId: "user-resume-finalize",
          wake: vaultSyncWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    });
    webControlMocks.commitHostedRunToWeb.mockResolvedValueOnce({
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: committedCursor.snapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    });

    expect(wakeProcessorMocks.readRunDrainVaultSyncImport).toHaveBeenCalledWith(vaultSyncWake);
    expect(wakeProcessorMocks.executeRunDrain).toHaveBeenCalledWith(expect.objectContaining({
      events: [
        expect.objectContaining({
          ingressEventId: "wake-vault-sync",
          seq: "11",
          vaultSyncImport: {
            bundleBase64: "AQID",
            sessionId: "vsi_runtime",
          },
          wake: vaultSyncWake,
        }),
      ],
    }));
    expect(result).toEqual({
      committedSeq: committedCursor.committedSeq,
      requestedTargetSeq: "11",
      targetReached: true,
    });
  });

  it("retries when raw email validation fails for reasons other than a missing payload", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const environment = envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv());
    const bucket = new MemoryEncryptedR2Bucket();
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: environment.automationRecipientKeyId,
      automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: environment.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: environment.platformEnvelopeKey,
      envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
      recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
    });
    await userKeyStore.provisionManagedUserCryptoAtActivation("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      environment,
      bucket,
    );
    bucket.get = vi.fn(async () => {
      throw new Error("raw read failed");
    });

    const emailWake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_retry_raw_error",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-20T00:00:00.000Z",
      rawMessageKey: "raw_missing",
      selfAddress: "reply+user@mail.example.test",
      userId: "user-resume-finalize",
    });
    const acquiredCursor = createCursorState({
      committedSeq: "10",
      nextSeq: "11",
      snapshotKey: "snapshot/raw-error",
      version: "cursor-v1",
    });
    const run = createRunRecord();
    run.status = "acquired";

    const acquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-raw-error",
          seq: "11",
          userId: "user-resume-finalize",
          wake: emailWake,
        }),
      ],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    };

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(acquire);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });

    await expect(runner.drainHostedRuns({
      targetCommittedSeqHint: "11",
    })).rejects.toThrow(/raw read failed/u);
    await expect(stateStore.readState()).resolves.toMatchObject({
      nextWakeAt: expect.any(String),
    });
    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(1);
    expect(webControlMocks.commitHostedRunToWeb).not.toHaveBeenCalled();
    expect(wakeProcessorMocks.executeRunDrain).not.toHaveBeenCalled();
  });
});

function createAcquireEvent(input: {
  id: string;
  seq: string;
  userId: string;
  wake: HostedIngressEnvelope;
}): HostedRunAcquireResponse["events"][number] {
  return createEncryptedAcquireEvent({
    decryptedPayload: input.wake,
    id: input.id,
    kind: input.wake.kind,
    occurredAt: input.wake.occurredAt,
    seq: input.seq,
    userId: input.userId,
  });
}

function createEncryptedAcquireEvent(input: {
  decryptedPayload: unknown;
  id: string;
  kind: HostedRunAcquireResponse["events"][number]["kind"];
  occurredAt: string;
  payloadSchema?: HostedRunAcquireResponse["events"][number]["payloadSchema"];
  seq: string;
  userId: string;
}): HostedRunAcquireResponse["events"][number] {
  const encrypted = encryptTestHostedIngressPayload({
    userId: input.userId,
    value: input.decryptedPayload,
  });

  return {
    behavior: "ordered" as const,
    createdAt: "2026-04-20T00:00:00.000Z",
    dedupeKey: null,
    id: input.id,
    kind: input.kind,
    occurredAt: input.occurredAt,
    payloadBytes: encrypted.payloadBytes,
    payloadCiphertext: encrypted.payloadCiphertext,
    payloadSchema: input.payloadSchema ?? HOSTED_INGRESS_PAYLOAD_SCHEMA,
    quarantineCode: null,
    quarantinedAt: null,
    seq: input.seq,
    updatedAt: "2026-04-20T00:00:00.000Z",
    userId: input.userId,
  };
}
