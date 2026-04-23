import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import type {
  HostedExecutionCursorState,
  HostedIngressEnvelope,
  HostedRunAcquireResponse,
  HostedRunCommitResponse,
  HostedRunFinalizeResponse,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import { HOSTED_INGRESS_PAYLOAD_SCHEMA } from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";
import { HostedUserRunner } from "../src/user-runner.ts";
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
  startRunMessagingActivity: vi.fn(),
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

    startRunMessagingActivity = wakeProcessorMocks.startRunMessagingActivity;

    constructor(..._args: unknown[]) {}
  }

  return {
    ...actual,
    RunnerRunProcessor: MockRunnerRunProcessor,
    recordHostedRunBreadcrumbInWebBestEffort:
      wakeProcessorMocks.recordHostedRunBreadcrumbInWebBestEffort,
  };
});

function createTestRuntimeEnvironment() {
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
    teeAutomationRecipientKeyId: null,
    teeAutomationRecipientPublicKey: null,
    vercelOidcValidation: {
      audience: "https://vercel.com/murph-team",
      issuer: "https://oidc.vercel.com/murph-team",
      jwksUrl: "https://oidc.vercel.com/murph-team/.well-known/jwks",
      projectName: "murph-web",
      teamSlug: "murph-team",
    },
    webCallbackSigning: {
      keyId: "v1",
      privateKeyJwkJson: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    },
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

  return {
    storage: {
      delete: async (key: string): Promise<boolean> => storageValues.delete(key),
      deleteAlarm: async () => {},
      get: async <T,>(key: string): Promise<T | undefined> => (
        storageValues.get(key) as T | undefined
      ),
      getAlarm: async () => null,
      put: async (key, value) => {
        storageValues.set(key, value);
      },
      setAlarm: async () => {},
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
  committedSeq: string;
  nextSeq: string;
  nextRuntimeWakeAt?: string | null;
  snapshotKey: string;
  version: string;
}): HostedExecutionCursorState {
  return {
    committedSeq: input.committedSeq,
    createdAt: "2026-04-20T00:00:00.000Z",
    nextSeq: input.nextSeq,
    nextRuntimeWakeAt: input.nextRuntimeWakeAt ?? null,
    nextRuntimeWakeReason: input.nextRuntimeWakeAt ? "runtime" : null,
    snapshotRef: createSnapshotRef(input.snapshotKey),
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

async function expectRecordedRunPhases(phases: readonly string[]): Promise<void> {
  await vi.waitFor(() => {
    const recordedPhases = webControlMocks.recordHostedRunLogInWeb.mock.calls
      .map(([input]) => input.body.phase)
      .sort();
    expect(recordedPhases).toEqual([...phases].sort());
  });
}

beforeEach(() => {
  wakeProcessorMocks.recordHostedRunBreadcrumbInWebBestEffort.mockImplementation((input: {
    baseUrl: string | null;
    callbackSigning: unknown;
    message: string;
    phase: string;
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
        level: "info",
        message: input.message,
        phase: input.phase,
        redacted: null,
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
  vi.clearAllMocks();
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
    wakeProcessorMocks.startRunMessagingActivity.mockResolvedValue(null);
    wakeProcessorMocks.finalizeRunDrain.mockResolvedValue({
      cursorSnapshotRef: finalizedCursor.snapshotRef,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });

    const result = await runner.drainHostedRuns();

    expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(2);
    expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledTimes(1);
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

  it("keeps runtime fallback ownership enabled when runner typing only returns a cleanup handle", async () => {
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
      committedSeq: "11",
      nextSeq: "12",
      snapshotKey: "snapshot/committed",
      version: "cursor-v2",
    });
    const run = {
      ...createRunRecord(),
      status: "acquired" as const,
      triggerKind: "external_ingress" as const,
    };
    const prepareAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingIngressEventCount: 1,
      resumeFinalize: false,
      run,
      runToken: "prepare-token",
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    };
    const stopHandle = vi.fn(async () => {});

    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce(prepareAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.startRunMessagingActivity.mockResolvedValue({
      ownsRuntimeActivity: false,
      stop: stopHandle,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
      cursorSnapshotRef: committedCursor.snapshotRef,
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
    expect(wakeProcessorMocks.executeRunDrain.mock.calls[0]?.[0]).toMatchObject({
      messagingActivityOwnedByExecutor: false,
    });
    expect(stopHandle).toHaveBeenCalledTimes(1);
  });

  it("keeps runtime fallback ownership enabled through finalize when runner typing only returns a cleanup handle", async () => {
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
    const stopHandle = vi.fn(async () => {});

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(prepareAcquire)
      .mockResolvedValueOnce(resumeFinalizeAcquire);
    webControlMocks.commitHostedRunToWeb.mockResolvedValue(commitResponse);
    webControlMocks.finalizeHostedRunInWeb.mockResolvedValue(finalizedResponse);
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.startRunMessagingActivity.mockResolvedValue({
      ownsRuntimeActivity: false,
      stop: stopHandle,
    });
    wakeProcessorMocks.executeRunDrain.mockResolvedValue({
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

    expect(result).toEqual({
      committedSeq: finalizedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(wakeProcessorMocks.executeRunDrain.mock.calls[0]?.[0]).toMatchObject({
      messagingActivityOwnedByExecutor: false,
    });
    expect(wakeProcessorMocks.finalizeRunDrain.mock.calls[0]?.[0]).toMatchObject({
      messagingActivityOwnedByExecutor: false,
    });
    expect(stopHandle).toHaveBeenCalledTimes(1);
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
    expect(wakeProcessorMocks.persistPendingRunCleanupData).toHaveBeenCalledWith({
      runId: acquiredRun.id,
      wakes: [
        expect.objectContaining({
          eventId: "linq-wake",
          kind: "conversation.message",
        }),
      ],
    });
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

  it("logs and ignores pending cleanup persistence failures when same-request finalize can finish", async () => {
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
      cursorSnapshotRef: committedCursor.snapshotRef,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: null,
      state: "completed",
    });
    wakeProcessorMocks.persistPendingRunCleanupData.mockRejectedValueOnce(
      new Error("pending cleanup sidecar write failed"),
    );
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
      expect(wakeProcessorMocks.persistPendingRunCleanupData).toHaveBeenCalledWith({
        runId: acquiredRun.id,
        wakes: [cleanupWake],
      });
      expect(webControlMocks.acquireHostedRunFromWeb).toHaveBeenCalledTimes(2);
      expect(wakeProcessorMocks.finalizeRunDrain).toHaveBeenCalledTimes(1);
      expect(webControlMocks.finalizeHostedRunInWeb).toHaveBeenCalledTimes(1);
      expect(wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: finalizingRun.id,
          userId: "user-resume-finalize",
          wakes: [cleanupWake],
        }),
      );

      const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0] ?? "{}")) as Record<string, unknown>;
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(payload).toEqual(expect.objectContaining({
        component: "cloudflare.user-runner",
        details: expect.objectContaining({
          cleanupWakeCount: 1,
          runId: acquiredRun.id,
        }),
        level: "warn",
        message: expect.stringContaining(
          "Hosted run pending cleanup persistence failed after commit; continuing without durable cleanup recovery state.",
        ),
        phase: "wake.running",
        userId: "user-resume-finalize",
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps messaging activity alive through finalize and stops it before finalize delivery completes", async () => {
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
    const stopHandle = vi.fn(async () => {
      steps.push("activity.stop");
    });

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
        "activity.start",
        "prepare.runtime",
        "finalize.runtime",
        "activity.stop",
      ]));
      expect(steps.indexOf("activity.start")).toBeLessThan(steps.indexOf("prepare.runtime"));
      expect(steps.indexOf("prepare.runtime")).toBeLessThan(steps.indexOf("finalize.runtime"));
      expect(steps.indexOf("finalize.runtime")).toBeLessThan(steps.indexOf("activity.stop"));
      return finalizedResponse;
    });
    webControlMocks.recordHostedRunLogInWeb.mockResolvedValue({
      log: null,
      logged: true,
    });
    wakeProcessorMocks.startRunMessagingActivity.mockImplementation(async () => {
      steps.push("activity.start");
      return {
        ownsRuntimeActivity: true,
        stop: stopHandle,
      };
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
    expect(wakeProcessorMocks.startRunMessagingActivity).toHaveBeenCalledTimes(1);
    expect(stopHandle).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([
      "activity.start",
      "prepare.runtime",
      "finalize.runtime",
      "activity.stop",
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

  it("quarantines wakes when the share pack cannot be hydrated", async () => {
    envMocks.readHostedExecutionEnvironment.mockReturnValue(createTestRuntimeEnvironment());
    const state = createDurableObjectStateHarness();
    const stateStore = new RunnerStateStore(state);
    await stateStore.bootstrapUser("user-resume-finalize");
    const runner = new HostedUserRunner(
      state,
      envMocks.readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      new MemoryEncryptedR2Bucket(),
    );

    const activationWake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_share_pack_missing",
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      memberId: "user-resume-finalize",
      occurredAt: "2026-04-20T00:00:00.000Z",
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
      new Error("share pack unavailable"),
    );
    webControlMocks.acquireHostedRunFromWeb.mockResolvedValueOnce({
      acquired: true,
      cursor: acquiredCursor,
      events: [
        createAcquireEvent({
          id: "wake-share-pack-missing",
          seq: "11",
          userId: "user-resume-finalize",
          wake: activationWake,
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
