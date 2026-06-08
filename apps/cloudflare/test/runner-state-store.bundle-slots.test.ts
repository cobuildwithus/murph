import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";

const CURRENT_RUNNER_META_COLUMNS = [
  "singleton",
  "user_id",
  "wake_at",
  "active_attempt_id",
  "active_generation",
  "active_kind",
  "active_provider_egress_token_hash",
  "active_runner_container_name",
  "active_reason",
  "active_started_at",
  "active_expires_at",
  "active_workspace_version",
  "backoff_until",
  "failure_count",
  "last_error_at",
  "last_error_code",
  "last_invocation_at",
];

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
    waitUntil() {},
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

function readRunnerStateSchemaVersion(db: DatabaseSync): number {
  return (
    db.prepare("SELECT value FROM runner_schema_meta WHERE key = 'runner_state_schema_version'")
      .get() as { value: number }
  ).value;
}

function readActiveRunnerContainerName(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT active_runner_container_name FROM runner_meta WHERE singleton = 1")
    .get() as { active_runner_container_name: string | null } | undefined;
  return row?.active_runner_container_name ?? null;
}

function readRunnerMetaActiveState(db: DatabaseSync): {
  active_attempt_id: string | null;
  active_expires_at: string | null;
  failure_count: number;
  last_error_code: string | null;
} {
  return db.prepare(`
    SELECT active_attempt_id,
           active_expires_at,
           failure_count,
           last_error_code
    FROM runner_meta
    WHERE singleton = 1
  `).get() as {
    active_attempt_id: string | null;
    active_expires_at: string | null;
    failure_count: number;
    last_error_code: string | null;
  };
}

function readRunnerMetaRowCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM runner_meta")
    .get() as { count: number };
  return row.count;
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

  it("creates the current write-fence schema without retired active-invocation columns", async () => {
    const { db, store } = createRunnerStateStoreHarness();

    await store.bindUser("user-current");

    const columns = readRunnerMetaColumns(db);
    const retiredBrowserVaultRefreshColumn = [
      "browser",
      "vault",
      "refresh",
      "requested",
      "at",
    ].join("_");
    const retiredBrowserVaultRefreshProjection = [
      "browser",
      "Vault",
      "Refresh",
      "Requested",
      "At",
    ].join("");
    expect(columns).toEqual(expect.arrayContaining(CURRENT_RUNNER_META_COLUMNS));
    expect(columns).not.toContain("active_invocation_id");
    expect(columns).not.toContain("pending_nudge");
    expect(columns).not.toContain("alarm_kind");
    expect(columns).not.toContain(retiredBrowserVaultRefreshColumn);
    expect(readRunnerStateSchemaVersion(db)).toBe(13);
    const state = await store.readState();
    expect(state).toMatchObject({
      schema: "murph.hosted-runner.v3",
      userId: "user-current",
      wakeAt: null,
      writeFence: null,
    });
    expect(state).not.toHaveProperty(retiredBrowserVaultRefreshProjection);
  });

  it("migrates legacy active invocation and pending nudge state into the write fence", async () => {
    const setupLegacyRunnerSchema = (database: DatabaseSync) => {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS runner_schema_meta;
        DROP TABLE IF EXISTS runner_bundle_slots;
        CREATE TABLE runner_schema_meta (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        INSERT INTO runner_schema_meta (key, value)
        VALUES ('runner_state_schema_version', 3);
        CREATE TABLE runner_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL,
          active_invocation_id TEXT,
          active_invocation_expires_at TEXT,
          active_invocation_reason TEXT,
          active_invocation_started_at TEXT,
          active_workspace_version TEXT,
          lease_generation INTEGER NOT NULL DEFAULT 0,
          in_flight INTEGER NOT NULL DEFAULT 0,
          last_error_at TEXT,
          last_error_code TEXT,
          last_invocation_at TEXT,
          next_wake_at TEXT,
          pending_nudge INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO runner_meta (
          singleton,
          user_id,
          active_invocation_id,
          active_invocation_expires_at,
          active_invocation_reason,
          active_invocation_started_at,
          active_workspace_version,
          lease_generation,
          in_flight,
          next_wake_at,
          pending_nudge
        ) VALUES (
          1,
          'user-existing',
          'workspace-invocation-1',
          '2030-04-27T00:01:00.000Z',
          'manual',
          '2030-04-27T00:00:00.000Z',
          '42',
          3,
          1,
          '2030-04-27T00:20:00.000Z',
          1
        );
      `);
    };

    const { db, store } = createRunnerStateStoreHarness(setupLegacyRunnerSchema);

    expect(readRunnerMetaColumns(db)).toEqual(expect.arrayContaining(CURRENT_RUNNER_META_COLUMNS));
    expect(readRunnerStateSchemaVersion(db)).toBe(13);
    expect(readRunnerMetaActiveState(db)).toMatchObject({
      active_attempt_id: "workspace-invocation-1",
      active_expires_at: null,
    });
    await expect(store.readState()).resolves.toMatchObject({
      active: {
        attemptId: "workspace-invocation-1",
        reason: "manual",
        workspaceVersion: "42",
      },
      leaseGeneration: 3,
      pendingWork: false,
      userId: "user-existing",
      wakeAt: null,
      writeFence: {
        attemptId: "workspace-invocation-1",
        expiresAt: null,
        generation: 3,
        kind: "runtime",
        workspaceVersion: "42",
      },
    });
  });

  it("blocks duplicate write fences and validates workspace versions when requested", async () => {
    const { store } = createRunnerStateStoreHarness();
    const lease = await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-write",
      userId: "user-write",
    });

    await expect(store.beginWriteFence({
      reason: "alarm",
      runnerContainerName: "user-write",
      userId: "user-write",
    })).rejects.toMatchObject({
      name: "RunnerWriteFenceAlreadyActiveError",
      record: {
        writeFence: {
          attemptId: lease.attemptId,
        },
      },
    });

    const boundLease = await store.bindWriteFenceWorkspaceVersion({
      token: lease,
      workspaceVersion: "6",
    });

    await expect(store.validateWriteFenceToken({
      attemptId: boundLease.attemptId,
      generation: boundLease.generation,
      userId: boundLease.userId,
      workspaceVersion: "6",
    })).resolves.toMatchObject({
      owns: true,
      record: {
        writeFence: {
          workspaceVersion: "6",
        },
      },
    });
    await expect(store.validateWriteFenceToken({
      attemptId: boundLease.attemptId,
      generation: boundLease.generation,
      userId: boundLease.userId,
    })).resolves.toMatchObject({
      owns: true,
    });
    await expect(store.validateWriteFenceToken({
      attemptId: boundLease.attemptId,
      generation: boundLease.generation,
      userId: boundLease.userId,
      workspaceVersion: "7",
    })).resolves.toMatchObject({
      owns: false,
    });
  });

  it("fails closed without initializing state when exact write-fence validation reaches an unbound runner", async () => {
    const { db, store } = createRunnerStateStoreHarness();

    await expect(store.validateWriteFenceToken({
      attemptId: "attempt_missing",
      generation: "1",
      userId: "user-unbound",
    })).resolves.toEqual({
      owns: false,
      record: null,
    });
    expect(readRunnerMetaRowCount(db)).toBe(0);
  });

  it("validates provider egress tokens without storing the raw token", async () => {
    const { store } = createRunnerStateStoreHarness();
    const lease = await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-write",
      userId: "user-write",
    });
    expect(lease.providerEgressToken).toEqual(expect.stringMatching(/^provider-egress-[a-f0-9]{64}$/u));
    const boundLease = await store.bindWriteFenceWorkspaceVersion({
      token: lease,
      workspaceVersion: "6",
    });

    await expect(store.readWriteFenceToken()).resolves.toMatchObject({
      attemptId: boundLease.attemptId,
      providerEgressToken: null,
    });
    await expect(store.validateProviderEgressToken({
      providerEgressToken: lease.providerEgressToken ?? "",
      userId: "user-write",
    })).resolves.toMatchObject({
      attemptId: boundLease.attemptId,
      leaseGeneration: boundLease.leaseGeneration,
      owns: true,
      userId: "user-write",
      workspaceVersion: "6",
    });
    await expect(store.validateProviderEgressToken({
      providerEgressToken: "provider-egress-stale",
      userId: "user-write",
    })).resolves.toMatchObject({
      owns: false,
      reason: "provider_egress_token_mismatch",
    });
  });

  it("fails closed without initializing state when provider egress validation reaches an unbound runner", async () => {
    const { db, store } = createRunnerStateStoreHarness();

    await expect(store.validateProviderEgressToken({
      providerEgressToken: "provider-egress-token",
      userId: "user-unbound",
    })).resolves.toEqual({
      owns: false,
      reason: "missing_runner_state",
    });
    expect(readRunnerMetaRowCount(db)).toBe(0);
  });

  it("validates active write fences by active user and returns runtime metadata", async () => {
    const { store } = createRunnerStateStoreHarness();
    const lease = await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-write--v-worker-current",
      userId: "user-write",
    });
    const boundLease = await store.bindWriteFenceWorkspaceVersion({
      token: lease,
      workspaceVersion: "6",
    });

    await expect(store.validateActiveWriteFence({
      userId: "user-write",
    })).resolves.toMatchObject({
      attemptId: boundLease.attemptId,
      leaseGeneration: boundLease.leaseGeneration,
      owns: true,
      record: {
        writeFence: {
          runnerContainerName: "user-write--v-worker-current",
        },
      },
      userId: "user-write",
      workspaceVersion: "6",
    });

    await expect(store.validateActiveWriteFence({
      userId: "user-other",
    })).resolves.toMatchObject({
      owns: false,
      reason: "write_fence_mismatch",
      record: {
        writeFence: {
          attemptId: boundLease.attemptId,
          runnerContainerName: "user-write--v-worker-current",
        },
      },
    });
  });

  it("fails closed without initializing state when active validation reaches an unbound runner", async () => {
    const { db, store } = createRunnerStateStoreHarness();

    await expect(store.validateActiveWriteFence({
      userId: "user-unbound",
    })).resolves.toEqual({
      owns: false,
      reason: "missing_runner_state",
    });
    expect(readRunnerMetaRowCount(db)).toBe(0);
  });

  it("validates active fences without requiring runner container state", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-legacy",
      userId: "user-legacy",
    });
    db.prepare("UPDATE runner_meta SET active_runner_container_name = NULL WHERE singleton = 1")
      .run();

    await expect(store.validateActiveWriteFence({
      userId: "user-legacy",
    })).resolves.toMatchObject({
      owns: true,
      record: {
        writeFence: {
          runnerContainerName: null,
        },
      },
    });
  });

  it("keeps legacy active_expires_at inert during write-fence validation", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    const lease = await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-write",
      userId: "user-write",
    });
    db.prepare("UPDATE runner_meta SET active_expires_at = ? WHERE singleton = 1")
      .run("2000-04-27T00:30:00.000Z");

    await expect(store.validateWriteFenceToken({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId: lease.userId,
    })).resolves.toMatchObject({
      owns: true,
      record: {
        failureCount: 0,
        writeFence: expect.objectContaining({
          expiresAt: null,
          runnerContainerName: "user-write",
        }),
      },
    });
    await expect(store.validateActiveWriteFence({
      userId: "user-write",
    })).resolves.toMatchObject({
      owns: true,
      record: {
        failureCount: 0,
        writeFence: expect.objectContaining({
          expiresAt: null,
          runnerContainerName: "user-write",
        }),
      },
    });
    await expect(store.readWriteFenceToken()).resolves.toMatchObject({
      attemptId: lease.attemptId,
      expiresAt: null,
    });
    expect(readRunnerMetaActiveState(db)).toMatchObject({
      active_attempt_id: lease.attemptId,
      active_expires_at: "2000-04-27T00:30:00.000Z",
      failure_count: 0,
      last_error_code: null,
    });
    expect(readActiveRunnerContainerName(db)).toBe("user-write");
  });

  it("projects legacy active_expires_at rows as null", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.beginWriteFence({
      reason: "nudge",
      runnerContainerName: "user-expired",
      userId: "user-expired",
    });
    db.prepare("UPDATE runner_meta SET active_expires_at = ? WHERE singleton = 1")
      .run("2030-04-27T00:00:05.000Z");

    await expect(store.readState()).resolves.toMatchObject({
      backoffUntil: null,
      failureCount: 0,
      wakeAt: null,
      writeFence: expect.objectContaining({
        expiresAt: null,
      }),
    });
    expect(readActiveRunnerContainerName(db)).toBe("user-expired");
  });

  it("keeps legacy wake and backoff columns inert in projected state", async () => {
    const { store } = createRunnerStateStoreHarness();
    await store.bindUser("user-inert-legacy");

    await expect(store.readState()).resolves.toMatchObject({
      backoffUntil: null,
      nextWakeAt: null,
      retry: {
        at: null,
      },
      wakeAt: null,
      wakePending: false,
    });
  });

});
