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
const LATER_WAKE = "2026-04-27T00:00:30.000Z";

describe("RunnerStateStore execution lease authority", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records transport failures without scheduling wake or backoff work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");

    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      reason: "nudge",
      userId: "member_123",
    });
    const failed = await store.clearWriteFenceAfterTransportFailure({
      error: new Error("runner failed"),
      finishedAt: NOW,
      token,
    });

    expect(failed.record).toMatchObject({
      backoffUntil: null,
      failureCount: 1,
      lastErrorAt: NOW,
      wakeAt: null,
      writeFence: null,
    });
  });

  it("clears completed write fences without writing wake or backoff work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      reason: "nudge",
      userId: "member_123",
    });

    const completed = await store.clearWriteFenceAfterCompletion({
      finishedAt: NOW,
      token,
    });

    expect(completed.completed).toBe(true);
    expect(completed.record).toMatchObject({
      backoffUntil: null,
      failureCount: 0,
      lastInvocationAt: NOW,
      wakeAt: null,
      writeFence: null,
    });
  });

  it("clears replacement fences by identity without scheduling retry work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      reason: "nudge",
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
        backoffUntil: null,
        failureCount: 1,
        lastErrorAt: NOW,
        writeFence: null,
      },
    });
    expect(cleared.record).toMatchObject({
      wakeAt: null,
    });
  });

  it("does not let a stale completion clear the active write fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      kind: "runtime",
      reason: "manual",
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

  it("keeps legacy pending_nudge-only state inert after migration", async () => {
    const { store } = createHarness((db) => {
      db.exec(`
        CREATE TABLE runner_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL,
          pending_nudge INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.exec(`
        INSERT INTO runner_meta (singleton, user_id, pending_nudge)
        VALUES (1, 'member_123', 1)
      `);
    });

    const state = await store.readState();
    expect(state).toMatchObject({
      nextWakeAt: null,
      pendingNudge: false,
      pendingWork: false,
      wakeAt: null,
      wakePending: false,
    });
  });
});

function createHarness(setup?: (db: DatabaseSync) => void): { store: RunnerStateStore } {
  const db = new DatabaseSync(":memory:");
  setup?.(db);
  return {
    store: new RunnerStateStore(createDurableObjectState(db)),
  };
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
