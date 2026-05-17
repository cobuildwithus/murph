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
const RETRY_AT = "2026-04-27T00:00:05.000Z";
const LATER_WAKE = "2026-04-27T00:00:30.000Z";

describe("RunnerStateStore wake/backoff authority", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gates pending runtime work behind the retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    await store.markWakePending({ preferredWakeAt: NOW });

    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      reason: "nudge",
      userId: "member_123",
    });
    const failed = await store.clearWriteFenceAfterFailure({
      error: new Error("runner failed"),
      finishedAt: NOW,
      retryAt: RETRY_AT,
      token,
    });

    expect(failed.record).toMatchObject({
      backoffUntil: RETRY_AT,
      failureCount: 1,
      wakeAt: NOW,
    });
    await expect(store.readDueWork(Date.parse(NOW))).resolves.toMatchObject({
      kind: "idle",
    });
    await expect(store.readDueWork(Date.parse(RETRY_AT))).resolves.toMatchObject({
      kind: "runtime",
      reason: "retry",
    });
  });

  it("replaces a nudge recorded while a runtime write fence is active with the next runtime wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");
    await store.markWakePending({ preferredWakeAt: NOW });
    const token = await store.beginWriteFence({
      expiresAt: LATER_WAKE,
      reason: "nudge",
      userId: "member_123",
    });
    await store.markWakePending({ preferredWakeAt: RETRY_AT });

    const completed = await store.clearWriteFenceAfterCompletion({
      finishedAt: NOW,
      token,
    });
    const scheduled = await store.scheduleNextWake({
      nextWakeAt: LATER_WAKE,
    });

    expect(completed.completed).toBe(true);
    expect(scheduled).toMatchObject({
      backoffUntil: null,
      failureCount: 0,
      wakeAt: LATER_WAKE,
    });
    await expect(store.readDueWork(Date.parse(RETRY_AT))).resolves.toMatchObject({
      kind: "idle",
    });
    await expect(store.readDueWork(Date.parse(LATER_WAKE))).resolves.toMatchObject({
      kind: "runtime",
      reason: "wake",
    });
  });

  it("does not clamp stale scheduled runtime wakes into new due work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { store } = createHarness();
    await store.bindUser("member_123");

    const scheduled = await store.scheduleNextWake({
      nextWakeAt: "2026-04-26T23:59:59.000Z",
    });

    expect(scheduled).toMatchObject({
      wakeAt: null,
    });
    await expect(store.readDueWork(Date.parse(NOW))).resolves.toMatchObject({
      kind: "idle",
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

  it("migrates legacy pending_nudge-only state into runtime due work", async () => {
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
    expect(state.wakeAt).not.toBeNull();
    await expect(store.readDueWork(Date.now() + 60_000)).resolves.toMatchObject({
      kind: "runtime",
      reason: "wake",
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
