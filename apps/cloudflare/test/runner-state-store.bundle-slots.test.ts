import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";

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

function createDurableObjectState(
  db: DatabaseSync,
  values: Map<string, unknown> = new Map(),
): DurableObjectStateLike {
  return {
    storage: {
      delete: async (key) => values.delete(key),
      deleteAlarm: async () => {},
      get: async <T,>(key: string) => values.get(key) as T | undefined,
      getAlarm: async () => null,
      put: async (key, value) => {
        values.set(key, value);
      },
      setAlarm: async () => {},
      sql: new SqliteDurableObjectSqlStorage(db),
    },
  };
}

function createRunnerStateStoreHarness(setup?: (db: DatabaseSync) => void): {
  db: DatabaseSync;
  storageValues: Map<string, unknown>;
  store: RunnerStateStore;
} {
  const db = new DatabaseSync(":memory:");
  const storageValues = new Map<string, unknown>();
  setup?.(db);

  return {
    db,
    storageValues,
    store: new RunnerStateStore(createDurableObjectState(db, storageValues)),
  };
}

function readRunnerMetaColumns(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(runner_meta)").all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function runnerBundleSlotsTableExists(db: DatabaseSync): boolean {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'runner_bundle_slots'
  `).get() as { name?: string } | undefined;
  return row?.name === "runner_bundle_slots";
}

describe("RunnerStateStore schema guard", () => {
  it("fails closed when the legacy split runner bundle schema is still present", () => {
    const setupLegacyBundleSchema = (database: DatabaseSync) => {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS runner_bundle_slots;
        CREATE TABLE runner_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL,
          in_flight INTEGER NOT NULL DEFAULT 0,
          last_error_at TEXT,
          last_error_code TEXT,
          last_invocation_at TEXT,
          next_wake_at TEXT
        );
        CREATE TABLE runner_bundle_slots (
          slot TEXT PRIMARY KEY,
          bundle_ref_json TEXT,
          bundle_version INTEGER NOT NULL DEFAULT 0
        );
      `);
    };
    const db = new DatabaseSync(":memory:");
    setupLegacyBundleSchema(db);

    expect(readRunnerMetaColumns(db)).not.toContain("bundle_ref_json");
    expect(runnerBundleSlotsTableExists(db)).toBe(true);
    expect(() => createRunnerStateStoreHarness(setupLegacyBundleSchema)).toThrow(
      /runner_meta schema is unsupported; legacy runner_bundle_slots table remains/u,
    );
  });

  it("keeps runner state free of bundle metadata after initialization", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-cache");

    await expect(store.readState()).resolves.toMatchObject({
      bundleRef: null,
      userId: "user-cache",
    });
    expect(readRunnerMetaColumns(db)).not.toContain("bundle_ref_json");
    expect(readRunnerMetaColumns(db)).not.toContain("bundle_version");
    expect(db.prepare(`
      SELECT user_id, active_invocation_id, active_invocation_reason, active_workspace_version
      FROM runner_meta
      WHERE singleton = 1
    `).get()).toEqual({
      user_id: "user-cache",
      active_invocation_id: null,
      active_invocation_reason: null,
      active_workspace_version: null,
    });
  });
});
