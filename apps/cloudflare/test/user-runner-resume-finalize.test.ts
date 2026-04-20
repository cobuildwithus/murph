import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import type {
  HostedExecutionCursorState,
  HostedRunAcquireResponse,
  HostedRunCommitResponse,
  HostedRunFinalizeResponse,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import { HostedUserRunner } from "../src/user-runner.ts";
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
} from "./hosted-execution-fixtures.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const envMocks = vi.hoisted(() => ({
  readHostedExecutionEnvironment: vi.fn(),
}));

const webControlMocks = vi.hoisted(() => ({
  acquireHostedRunFromWeb: vi.fn(),
  commitHostedRunToWeb: vi.fn(),
  finalizeHostedRunInWeb: vi.fn(),
  recordHostedRunLogInWeb: vi.fn(),
  readHostedRunStatusFromWeb: vi.fn(),
}));

const wakeProcessorMocks = vi.hoisted(() => ({
  cleanupTransientWakeDataBestEffortForRunDrain: vi.fn(),
  executeRunDrain: vi.fn(),
  finalizeRunDrain: vi.fn(),
  readRunDrainSharePack: vi.fn(),
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
    readHostedRunStatusFromWeb: webControlMocks.readHostedRunStatusFromWeb,
  };
});

vi.mock("../src/user-runner/runner-wake-processor.js", async () => {
  const actual = await vi.importActual<typeof import("../src/user-runner/runner-wake-processor.js")>(
    "../src/user-runner/runner-wake-processor.js",
  );

  class MockRunnerWakeProcessor {
    cleanupTransientWakeDataBestEffortForRunDrain =
      wakeProcessorMocks.cleanupTransientWakeDataBestEffortForRunDrain;

    executeRunDrain = wakeProcessorMocks.executeRunDrain;

    finalizeRunDrain = wakeProcessorMocks.finalizeRunDrain;

    readRunDrainSharePack = wakeProcessorMocks.readRunDrainSharePack;

    constructor(..._args: unknown[]) {}
  }

  return {
    ...actual,
    RunnerWakeProcessor: MockRunnerWakeProcessor,
  };
});

afterEach(() => {
  vi.clearAllMocks();
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

  return {
    storage: {
      deleteAlarm: async () => {},
      get: async () => undefined,
      getAlarm: async () => null,
      put: async () => {},
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
    wakeIds: [],
  };
}

describe("HostedUserRunner resumeFinalize drain", () => {
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
    const run = createRunRecord();

    const resumeFinalizeAcquire: HostedRunAcquireResponse = {
      acquired: true,
      cursor: acquiredCursor,
      events: [],
      pendingWakeCount: 1,
      resumeFinalize: true,
      run,
      runToken: "run-token",
    };
    const noWorkAcquire: HostedRunAcquireResponse = {
      acquired: false,
      cursor: drainedCursor,
      events: [],
      pendingWakeCount: 0,
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
    expect(result).toEqual({
      committedSeq: drainedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(
      webControlMocks.recordHostedRunLogInWeb.mock.calls.map(([input]) => input.body.phase),
    ).toEqual([
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
      pendingWakeCount: 1,
      resumeFinalize: false,
      run,
      runToken: "run-token",
    };
    const noWorkAcquire: HostedRunAcquireResponse = {
      acquired: false,
      cursor: drainedCursor,
      events: [],
      pendingWakeCount: 0,
      resumeFinalize: false,
      run: null,
      runToken: null,
    };
    const commitResponse: HostedRunCommitResponse = {
      committed: true,
      cursor: committedCursor,
      needsFinalize: false,
      run,
    };

    webControlMocks.acquireHostedRunFromWeb
      .mockResolvedValueOnce(prepareAcquire)
      .mockResolvedValueOnce(noWorkAcquire);
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
    expect(result).toEqual({
      committedSeq: drainedCursor.committedSeq,
      requestedTargetSeq: null,
      targetReached: true,
    });
    expect(
      webControlMocks.recordHostedRunLogInWeb.mock.calls.map(([input]) => input.body.phase),
    ).toEqual([
      "acquired",
      "commit_attempted",
      "commit_won",
    ]);
  });
});
