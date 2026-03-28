import { DatabaseSync } from "node:sqlite";

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
    ...bindings: unknown[]
  ): SqlCursorLike<T>;
  reset(): void;
}

export function createTestSqlStorage(): TestSqlStorageLike {
  const database = new DatabaseSync(":memory:");
  initializeSchema(database);

  return {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): SqlCursorLike<T> {
      const trimmed = query.trim().toLowerCase();
      if (trimmed.startsWith("select")) {
        const statement = database.prepare(query);
        const rows = statement.all(...bindings) as T[];
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
      const result = statement.run(...bindings);
      return createCursor([], {
        rowsRead: 0,
        rowsWritten: Number(result.changes ?? 0),
      });
    },
    reset() {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS pending_events;
        DROP TABLE IF EXISTS consumed_events;
        DROP TABLE IF EXISTS poisoned_events;
      `);
      initializeSchema(database);
    },
  };
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      activated INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_event_id TEXT,
      last_run_at TEXT,
      next_wake_at TEXT,
      retrying_event_id TEXT,
      backpressured_event_ids_json TEXT NOT NULL DEFAULT '[]',
      agent_state_bundle_ref_json TEXT,
      vault_bundle_ref_json TEXT,
      agent_state_bundle_version INTEGER NOT NULL DEFAULT 0,
      vault_bundle_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pending_events (
      event_id TEXT PRIMARY KEY,
      dispatch_json TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS consumed_events (
      event_id TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poisoned_events (
      event_id TEXT PRIMARY KEY,
      poisoned_at TEXT NOT NULL,
      last_error TEXT NOT NULL
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
