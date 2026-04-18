import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import {
  serializeHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state";
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

function createRunnerStateStoreHarness(setup?: (db: DatabaseSync) => void): {
  db: DatabaseSync;
  store: RunnerStateStore;
} {
  const db = new DatabaseSync(":memory:");
  setup?.(db);

  const state: DurableObjectStateLike = {
    storage: {
      deleteAlarm: async () => {},
      get: async () => undefined,
      getAlarm: async () => null,
      put: async () => {},
      setAlarm: async () => {},
      sql: new SqliteDurableObjectSqlStorage(db),
    },
  };

  return {
    db,
    store: new RunnerStateStore(state),
  };
}

function makeBundleRef(key: string): HostedExecutionBundleRef {
  return {
    hash: `${key}-hash`,
    key,
    size: key.length,
    updatedAt: "2026-04-02T00:00:00.000Z",
  };
}

function readRunnerMetaBundleState(db: DatabaseSync): {
  bundle_ref_json: string | null;
  bundle_version: number;
} {
  return db.prepare(`
    SELECT bundle_ref_json, bundle_version
    FROM runner_meta
    WHERE singleton = 1
  `).get() as {
    bundle_ref_json: string | null;
    bundle_version: number;
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

describe("RunnerStateStore bundle metadata", () => {
  it("hard-cuts the old bundle slot table and stores the vault bundle ref on runner_meta", async () => {
    const { db, store } = createRunnerStateStoreHarness((database) => {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS runner_bundle_slots;
        CREATE TABLE runner_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL,
          runtime_bootstrapped INTEGER NOT NULL DEFAULT 0,
          in_flight INTEGER NOT NULL DEFAULT 0,
          last_error_at TEXT,
          last_error_code TEXT,
          last_event_id TEXT,
          last_run_at TEXT,
          next_wake_at TEXT
        );
        CREATE TABLE runner_bundle_slots (
          slot TEXT PRIMARY KEY,
          bundle_ref_json TEXT,
          bundle_version INTEGER NOT NULL DEFAULT 0
        );
      `);
    });
    await store.bootstrapUser("user-fresh");

    expect(readRunnerMetaColumns(db)).toContain("bundle_ref_json");
    expect(readRunnerMetaColumns(db)).toContain("bundle_version");
    expect(runnerBundleSlotsTableExists(db)).toBe(false);
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: null,
      bundle_version: 0,
    });
  });

  it("keeps compare-and-swap bundle versions on runner_meta", async () => {
    const currentVaultRef = makeBundleRef("vault/current");
    const nextVaultRef = makeBundleRef("vault/next");
    const { db, store } = createRunnerStateStoreHarness();
    await store.bootstrapUser("user-cas");

    const initial = await store.compareAndSwapBundleRefs({
      expectedVersion: 0,
      nextBundleRef: currentVaultRef,
    });
    expect(initial.applied).toBe(true);
    expect(initial.record.bundleRef).toEqual(currentVaultRef);
    expect(initial.record.bundleVersion).toBe(1);
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: serializeHostedExecutionBundleRef(currentVaultRef),
      bundle_version: 1,
    });

    const swapped = await store.compareAndSwapBundleRefs({
      expectedVersion: initial.record.bundleVersion,
      nextBundleRef: nextVaultRef,
    });
    expect(swapped.applied).toBe(true);
    expect(swapped.record.bundleVersion).toBe(2);
    expect(swapped.record.bundleRef).toEqual(nextVaultRef);

    const rejected = await store.compareAndSwapBundleRefs({
      expectedVersion: initial.record.bundleVersion,
      nextBundleRef: swapped.record.bundleRef,
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.record.bundleVersion).toBe(2);
  });

  it("treats repeated cursor syncs of the same bundle ref as a no-op for the local version", async () => {
    const currentVaultRef = makeBundleRef("vault/current");
    const nextVaultRef = makeBundleRef("vault/next");
    const { db, store } = createRunnerStateStoreHarness();
    await store.bootstrapUser("user-cache");

    const firstSync = await store.syncBundleRefCache(currentVaultRef);
    expect(firstSync.bundleVersion).toBe(1);
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: serializeHostedExecutionBundleRef(currentVaultRef),
      bundle_version: 1,
    });

    const repeatedSync = await store.syncBundleRefCache(currentVaultRef);
    expect(repeatedSync.bundleVersion).toBe(1);
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: serializeHostedExecutionBundleRef(currentVaultRef),
      bundle_version: 1,
    });

    const changedSync = await store.syncBundleRefCache(nextVaultRef);
    expect(changedSync.bundleVersion).toBe(2);
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: serializeHostedExecutionBundleRef(nextVaultRef),
      bundle_version: 2,
    });
  });

  it("repairs malformed bundle refs without dropping their version", async () => {
    const vaultRef = makeBundleRef("vault/current");
    const { db, store } = createRunnerStateStoreHarness();
    await store.bootstrapUser("user-malformed");

    db.prepare(`
      UPDATE runner_meta
      SET bundle_ref_json = ?, bundle_version = ?
      WHERE singleton = 1
    `).run(JSON.stringify({ key: "missing-required-fields" }), 7);

    const state = await store.readState();
    expect(state.bundleRef).toBeNull();
    expect(state.bundleVersion).toBe(7);
    expect(state.lastError).toContain("Hosted runner cleared malformed bundle ref(s): vault.");
    expect(readRunnerMetaBundleState(db)).toEqual({
      bundle_ref_json: null,
      bundle_version: 7,
    });

    const repaired = await store.compareAndSwapBundleRefs({
      expectedVersion: state.bundleVersion,
      nextBundleRef: vaultRef,
    });
    expect(repaired.applied).toBe(true);
    expect(repaired.record.bundleRef).toEqual(vaultRef);
    expect(repaired.record.bundleVersion).toBe(8);
  });
});
