import { DatabaseSync } from "node:sqlite";

import { HOSTED_EXECUTION_BUNDLE_SLOTS } from "@murphai/hosted-execution";
import {
  serializeHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state";
import { describe, expect, it } from "vitest";

import { createHostedDispatchPayloadStore } from "../src/dispatch-payload-store.js";
import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

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
    ...bindings: unknown[]
  ): DurableObjectSqlCursorLike<T> {
    const statement = this.db.prepare(query);
    const normalized = query.trimStart().toUpperCase();

    if (
      normalized.startsWith("SELECT")
      || normalized.startsWith("PRAGMA")
      || normalized.startsWith("WITH")
    ) {
      const rows = statement.all(...bindings) as T[];
      const columnNames = statement.columns().map((column) => column.name);
      return new SqliteCursor(rows, columnNames, rows.length, 0);
    }

    const result = statement.run(...bindings);
    return new SqliteCursor([], [], 0, result.changes);
  }
}

function createRunnerQueueStoreHarness(setup?: (db: DatabaseSync) => void): {
  db: DatabaseSync;
  store: RunnerQueueStore;
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
    store: new RunnerQueueStore(
      state,
      createHostedDispatchPayloadStore({
        bucket: new MemoryEncryptedR2Bucket(),
        key: createTestRootKey(61),
        keyId: "k-test",
      }),
    ),
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

function readBundleSlotRows(db: DatabaseSync): Array<{
  bundle_ref_json: string | null;
  bundle_version: number;
  slot: string;
}> {
  return db.prepare(`
    SELECT slot, bundle_ref_json, bundle_version
    FROM runner_bundle_slots
    ORDER BY slot ASC
  `).all() as Array<{
    bundle_ref_json: string | null;
    bundle_version: number;
    slot: string;
  }>;
}

describe("RunnerQueueStore bundle slot storage", () => {
  it("stores canonical bundle slots outside runner_meta for fresh state", async () => {
    const { db, store } = createRunnerQueueStoreHarness();
    await store.bootstrapUser("user-fresh");

    const runnerMetaColumns = db.prepare("PRAGMA table_info(runner_meta)").all() as Array<{
      name: string;
    }>;
    expect(runnerMetaColumns.map((column) => column.name)).not.toContain("agent_state_bundle_ref_json");
    expect(runnerMetaColumns.map((column) => column.name)).not.toContain("vault_bundle_ref_json");
    expect(runnerMetaColumns.map((column) => column.name)).not.toContain("agent_state_bundle_version");
    expect(runnerMetaColumns.map((column) => column.name)).not.toContain("vault_bundle_version");

    expect(readBundleSlotRows(db)).toEqual(
      HOSTED_EXECUTION_BUNDLE_SLOTS
        .map((slot) => ({
          bundle_ref_json: null,
          bundle_version: 0,
          slot,
        }))
        .sort((left, right) => left.slot.localeCompare(right.slot)),
    );
  });

  it("keeps compare-and-swap bundle versions in canonical slot rows", async () => {
    const agentStateRef = makeBundleRef("agent-state/current");
    const currentVaultRef = makeBundleRef("vault/current");
    const nextVaultRef = makeBundleRef("vault/next");
    const { db, store } = createRunnerQueueStoreHarness();
    await store.bootstrapUser("user-cas");

    const initial = await store.compareAndSwapBundleRefs({
      expectedVersions: {
        agentState: 0,
        vault: 0,
      },
      nextBundleRefs: {
        agentState: agentStateRef,
        vault: currentVaultRef,
      },
    });
    expect(initial.applied).toBe(true);
    expect(initial.record.bundleRefs).toEqual({
      agentState: agentStateRef,
      vault: currentVaultRef,
    });
    expect(initial.record.bundleVersions).toEqual({
      agentState: 1,
      vault: 1,
    });
    expect(readBundleSlotRows(db)).toEqual([
      {
        bundle_ref_json: serializeHostedExecutionBundleRef(agentStateRef),
        bundle_version: 1,
        slot: "agentState",
      },
      {
        bundle_ref_json: serializeHostedExecutionBundleRef(currentVaultRef),
        bundle_version: 1,
        slot: "vault",
      },
    ]);

    const swapped = await store.compareAndSwapBundleRefs({
      expectedVersions: initial.record.bundleVersions,
      nextBundleRefs: {
        ...initial.record.bundleRefs,
        vault: nextVaultRef,
      },
    });
    expect(swapped.applied).toBe(true);
    expect(swapped.record.bundleVersions).toEqual({
      agentState: 1,
      vault: 2,
    });
    expect(swapped.record.bundleRefs).toEqual({
      agentState: agentStateRef,
      vault: nextVaultRef,
    });

    const rejected = await store.compareAndSwapBundleRefs({
      expectedVersions: initial.record.bundleVersions,
      nextBundleRefs: swapped.record.bundleRefs,
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.record.bundleVersions).toEqual({
      agentState: 1,
      vault: 2,
    });
  });

  it("repairs malformed bundle-slot refs without dropping their versions", async () => {
    const vaultRef = makeBundleRef("vault/current");
    const { db, store } = createRunnerQueueStoreHarness();
    await store.bootstrapUser("user-malformed");

    db.prepare(`
      UPDATE runner_bundle_slots
      SET bundle_ref_json = ?, bundle_version = ?
      WHERE slot = ?
    `).run(JSON.stringify({ key: "missing-required-fields" }), 7, "agentState");
    db.prepare(`
      UPDATE runner_bundle_slots
      SET bundle_ref_json = ?, bundle_version = ?
      WHERE slot = ?
    `).run(serializeHostedExecutionBundleRef(vaultRef), 3, "vault");

    const state = await store.readState();
    expect(state.bundleRefs).toEqual({
      agentState: null,
      vault: vaultRef,
    });
    expect(state.bundleVersions).toEqual({
      agentState: 7,
      vault: 3,
    });
    expect(state.lastError).toContain("Hosted runner cleared malformed bundle ref(s): agent-state.");
    expect(readBundleSlotRows(db)).toEqual([
      {
        bundle_ref_json: null,
        bundle_version: 7,
        slot: "agentState",
      },
      {
        bundle_ref_json: serializeHostedExecutionBundleRef(vaultRef),
        bundle_version: 3,
        slot: "vault",
      },
    ]);
  });
});
