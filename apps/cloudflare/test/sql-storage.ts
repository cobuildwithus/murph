import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

type SqlStorageValue = ArrayBuffer | string | number | null;

interface SqlCursorLike<T extends Record<string, SqlStorageValue>> extends Iterable<T> {
  next(): IteratorResult<T>;
  one(): T;
  raw<U extends SqlStorageValue[]>(): IterableIterator<U>;
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
  toArray(): T[];
}

export interface TestSqlStorageLike {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): SqlCursorLike<T>;
  reset(): void;
  transactionSync<T>(callback: () => T): T;
}

export function createTestSqlStorage(input: {
  beforeExec?: (query: string) => void;
} = {}): TestSqlStorageLike {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database);

  return {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ): SqlCursorLike<T> {
      input.beforeExec?.(query);
      const trimmed = query.trim().toLowerCase();
      if (trimmed.startsWith("select") || trimmed.startsWith("pragma")) {
        const statement = database.prepare(query);
        const rows = statement.all(...bindings as SQLInputValue[]) as T[];
        return createCursor(rows, {
          rowsRead: rows.length,
          rowsWritten: 0,
        });
      }

      if (bindings.length === 0) {
        database.exec(query);
        return createCursor([], {
          rowsRead: 0,
          rowsWritten: 0,
        });
      }

      const statement = database.prepare(query);
      const result = statement.run(...bindings as SQLInputValue[]);
      return createCursor([], {
        rowsRead: 0,
        rowsWritten: Number(result.changes ?? 0),
      });
    },
    reset() {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS runner_bundle_slots;
      `);
      initializeSchema(database);
    },
    transactionSync<T>(callback: () => T): T {
      database.exec("BEGIN TRANSACTION");
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      active_invocation_id TEXT,
      active_invocation_container_stopped_at TEXT,
      active_invocation_consumed_pending_work INTEGER NOT NULL DEFAULT 0,
      active_invocation_expires_at TEXT,
      active_invocation_last_heartbeat_at TEXT,
      active_invocation_orphan_observed_at TEXT,
      active_invocation_reason TEXT,
      active_invocation_started_at TEXT,
      active_invocation_worker_version_id TEXT,
      active_workspace_version TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_invocation_at TEXT,
      next_wake_at TEXT,
      pending_nudge INTEGER NOT NULL DEFAULT 0,
      retry_failure_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function createCursor<T extends Record<string, SqlStorageValue>>(
  rows: T[],
  counts: {
    rowsRead: number;
    rowsWritten: number;
  },
): SqlCursorLike<T> {
  const columnNames = rows[0] ? Object.keys(rows[0]) : [];
  return {
    columnNames,
    next() {
      const value = rows.shift();
      return value === undefined
        ? { done: true, value: undefined }
        : { done: false, value };
    },
    one() {
      if (rows[0] === undefined) {
        throw new Error("SQL cursor is empty.");
      }

      return rows[0];
    },
    raw<U extends SqlStorageValue[]>() {
      return rows
        .map((row) => columnNames.map((columnName) => row[columnName]) as U)
        [Symbol.iterator]();
    },
    get rowsRead() {
      return counts.rowsRead;
    },
    get rowsWritten() {
      return counts.rowsWritten;
    },
    toArray() {
      return [...rows];
    },
    [Symbol.iterator]() {
      return this.toArray()[Symbol.iterator]();
    },
  };
}
