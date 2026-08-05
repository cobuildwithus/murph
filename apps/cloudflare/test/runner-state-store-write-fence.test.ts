import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
} from "../src/user-runner/runner-state-store.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";

const NOW = "2026-04-27T00:00:00.000Z";

describe("RunnerStateStore write-fence state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records transport failures after clearing the exact write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");

    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });
    const failed = await store.clearWriteFenceAfterTransportFailure({
      error: new Error("runner failed"),
      finishedAt: NOW,
      token,
    });

    expect(failed.record).toMatchObject({
      failureCount: 1,
      lastErrorAt: NOW,
      writeFence: null,
    });
  });

  it("clears completed write fences and resets failure diagnostics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });

    const completed = await store.clearWriteFenceAfterCompletion({
      finishedAt: NOW,
      token,
    });

    expect(completed.completed).toBe(true);
    expect(completed.record).toMatchObject({
      failureCount: 0,
      lastInvocationAt: NOW,
      writeFence: null,
    });
  });

  it("keeps the persisted processing mode while the write fence is live and clears it after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { db, store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      processingMode: "inbox_media_retention",
      runnerContainerName: "member_123",
      userId: "member_123",
    });
    expect(readActiveReason(db)).toBe("inbox_media_retention");
    const restartedStore = new RunnerStateStore(createDurableObjectState(db));
    await expect(restartedStore.readWriteFenceToken()).resolves.toMatchObject({
      attemptId: token.attemptId,
      processingMode: "inbox_media_retention",
      userId: "member_123",
    } satisfies Partial<RunnerWriteFenceToken>);

    const completed = await store.clearWriteFenceAfterCompletion({
      finishedAt: NOW,
      token,
    });

    expect(completed.completed).toBe(true);
    expect(completed.record.writeFence).toBeNull();
    expect(readActiveReason(db)).toBeNull();
    await expect(store.readWriteFenceToken()).resolves.toBeNull();
  });

  it("binds the effective invocation mode to the active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { db, store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });

    const pinned = await store.bindWriteFenceInvocationFacts({
      customInferenceEnvelope: null,
      platformAiUsageAllowed: false,
      processingMode: "system_mailbox",
      token,
      workspaceVersion: "9",
    });

    expect(pinned.processingMode).toBe("system_mailbox");
    expect(readActiveReason(db)).toBe("system_mailbox");
    const restartedStore = new RunnerStateStore(createDurableObjectState(db));
    await expect(restartedStore.readWriteFenceToken()).resolves.toMatchObject({
      attemptId: token.attemptId,
      processingMode: "system_mailbox",
      userId: "member_123",
      workspaceVersion: "9",
    } satisfies Partial<RunnerWriteFenceToken>);
  });

  it("pins one custom target envelope to the active fence and clears it with that fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { db, store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });
    const pinned = await store.bindWriteFenceInvocationFacts({
      customInferenceEnvelope: "synthetic-sealed-target-envelope",
      platformAiUsageAllowed: false,
      token,
      workspaceVersion: "9",
    });
    if (!token.providerEgressToken) {
      throw new Error("Expected a provider egress token on the active fence.");
    }

    await expect(store.validateProviderEgressToken({
      providerEgressToken: token.providerEgressToken,
      userId: "member_123",
    })).resolves.toMatchObject({
      customInferenceEnvelope: "synthetic-sealed-target-envelope",
      owns: true,
      platformAiUsageAllowed: false,
      workspaceVersion: "9",
    });
    expect(readActiveCustomInferenceEnvelope(db))
      .toBe("synthetic-sealed-target-envelope");
    expect(readActivePlatformAiAllowed(db)).toBe(0);

    await store.clearWriteFenceAfterCompletion({
      finishedAt: NOW,
      token: pinned,
    });

    expect(readActiveCustomInferenceEnvelope(db)).toBeNull();
    expect(readActivePlatformAiAllowed(db)).toBeNull();
    await expect(store.validateProviderEgressToken({
      providerEgressToken: token.providerEgressToken,
      userId: "member_123",
    })).resolves.toMatchObject({
      owns: false,
      reason: "missing_write_fence",
    });
  });

  it("clears replacement fences by identity and records the failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });

    const cleared = await store.clearWriteFenceForReplacement({
      attemptId: token.attemptId,
      error: new Error("no active child"),
      finishedAt: NOW,
      generation: token.generation,
      userId: "member_123",
    });

    expect(cleared).toMatchObject({
      cleared: true,
      record: {
        failureCount: 1,
        lastErrorAt: NOW,
        writeFence: null,
      },
    });
  });

  it("does not let a stale completion clear the active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });

    const replay = await store.clearWriteFenceIdentityAfterCompletion({
      attemptId: token.attemptId,
      finishedAt: NOW,
      generation: String(Number(token.generation) + 1),
      userId: "member_123",
    });
    const liveToken = await store.readWriteFenceToken();

    expect(replay.completed).toBe(false);
    expect(liveToken).toMatchObject({
      attemptId: token.attemptId,
      generation: token.generation,
      userId: "member_123",
    } satisfies Partial<RunnerWriteFenceToken>);
  });
});

function createHarness(): {
  db: DatabaseSync;
  store: RunnerStateStore;
} {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    store: new RunnerStateStore(createDurableObjectState(db)),
  };
}

function readActiveReason(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT active_reason FROM runner_meta WHERE singleton = 1")
    .get() as { active_reason: string | null };
  return row.active_reason;
}

function readActiveCustomInferenceEnvelope(db: DatabaseSync): string | null {
  const row = db.prepare(
    "SELECT active_custom_inference_envelope FROM runner_meta WHERE singleton = 1",
  ).get() as { active_custom_inference_envelope: string | null };
  return row.active_custom_inference_envelope;
}

function readActivePlatformAiAllowed(db: DatabaseSync): number | null {
  const row = db.prepare(
    "SELECT active_platform_ai_allowed FROM runner_meta WHERE singleton = 1",
  ).get() as { active_platform_ai_allowed: number | null };
  return row.active_platform_ai_allowed;
}

function createDurableObjectState(db: DatabaseSync): DurableObjectStateLike {
  return {
    storage: {
      delete: async () => false,
      deleteAlarm: async () => {},
      get: async () => undefined,
      getAlarm: async () => null,
      put: async () => {},
      setAlarm: async () => {},
      sql: new SqliteDurableObjectSqlStorage(db),
    },
    waitUntil() {},
  };
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
