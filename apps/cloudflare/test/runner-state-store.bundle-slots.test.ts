import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

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

  it("adds invocation liveness metadata to existing runner_meta rows", async () => {
    const setupPreviousSchema = (database: DatabaseSync) => {
      database.exec(`
        DROP TABLE IF EXISTS runner_meta;
        DROP TABLE IF EXISTS runner_bundle_slots;
        CREATE TABLE runner_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          user_id TEXT NOT NULL,
          active_invocation_id TEXT,
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
          active_invocation_reason,
          active_invocation_started_at,
          active_workspace_version,
          lease_generation,
          in_flight
        ) VALUES (
          1,
          'user-existing',
          'workspace-invocation-1',
          'nudge',
          '2026-04-27T00:00:00.000Z',
          '0',
          1,
          1
        );
      `);
    };

    const { db, store } = createRunnerStateStoreHarness(setupPreviousSchema);

    expect(readRunnerMetaColumns(db)).toContain("active_invocation_last_heartbeat_at");
    expect(readRunnerMetaColumns(db)).toContain("active_invocation_container_stopped_at");
    expect(readRunnerMetaColumns(db)).toContain("active_invocation_orphan_observed_at");
    expect(readRunnerMetaColumns(db)).toContain("active_invocation_worker_version_id");
    expect(readRunnerMetaColumns(db)).toContain("deferred_checkpoint_mailbox_status_json");
    expect(readRunnerMetaColumns(db)).toContain("idle_shutdown_checkpoint_due_at");
    expect(readRunnerMetaColumns(db)).toContain("idle_shutdown_checkpoint_workspace_version");
    expect(
      (db.prepare(
        "SELECT value FROM runner_schema_meta WHERE key = 'runner_state_schema_version'",
      ).get() as { value: number }).value,
    ).toBe(6);
    await expect(store.readState()).resolves.toMatchObject({
      userId: "user-existing",
      workspaceInvocation: {
        attemptId: "workspace-invocation-1",
        lastHeartbeatAt: null,
        orphanObservedAt: null,
      },
    });
  });

  it("migrates schema v3 active leases to v4 container stop markers", async () => {
    const setupV3Schema = (database: DatabaseSync) => {
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
          active_invocation_last_heartbeat_at TEXT,
          active_invocation_orphan_observed_at TEXT,
          active_invocation_reason TEXT,
          active_invocation_started_at TEXT,
          active_invocation_worker_version_id TEXT,
          active_workspace_version TEXT,
          alarm_kind TEXT,
          alarm_due_at TEXT,
          alarm_workspace_version TEXT,
          alarm_checkpoint_next_wake_at TEXT,
          lease_generation INTEGER NOT NULL DEFAULT 0,
          in_flight INTEGER NOT NULL DEFAULT 0,
          last_error_at TEXT,
          last_error_code TEXT,
          last_invocation_at TEXT,
          deferred_checkpoint_required INTEGER NOT NULL DEFAULT 0,
          idle_shutdown_checkpoint_due_at TEXT,
          idle_shutdown_checkpoint_workspace_version TEXT,
          next_wake_at TEXT,
          pending_nudge INTEGER NOT NULL DEFAULT 0,
          pending_work INTEGER NOT NULL DEFAULT 0,
          retry_failure_count INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO runner_meta (
          singleton,
          user_id,
          active_invocation_id,
          active_invocation_expires_at,
          active_invocation_last_heartbeat_at,
          active_invocation_reason,
          active_invocation_started_at,
          active_invocation_worker_version_id,
          active_workspace_version,
          lease_generation,
          in_flight
        ) VALUES (
          1,
          'user-existing',
          'workspace-invocation-1',
          '2026-04-27T00:30:00.000Z',
          '2026-04-27T00:01:00.000Z',
          'nudge',
          '2026-04-27T00:00:00.000Z',
          'worker-version-previous',
          '0',
          1,
          1
        );
      `);
    };

    const { db, store } = createRunnerStateStoreHarness(setupV3Schema);

    expect(readRunnerMetaColumns(db)).toContain("active_invocation_container_stopped_at");
    expect(readRunnerMetaColumns(db)).toContain("deferred_checkpoint_mailbox_status_json");
    expect(
      (db.prepare(
        "SELECT value FROM runner_schema_meta WHERE key = 'runner_state_schema_version'",
      ).get() as { value: number }).value,
    ).toBe(6);
    await expect(store.readState()).resolves.toMatchObject({
      userId: "user-existing",
      workspaceInvocation: {
        attemptId: "workspace-invocation-1",
        lastHeartbeatAt: "2026-04-27T00:01:00.000Z",
      },
    });
    expect(db.prepare(`
      SELECT active_invocation_container_stopped_at
      FROM runner_meta
      WHERE singleton = 1
    `).get()).toEqual({
      active_invocation_container_stopped_at: null,
    });
  });

  it("ignores stale invocation completion and failure metadata", async () => {
    const { store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const activeLease = await store.beginInvocation({
      reason: "nudge",
      userId: "user-existing",
    });
    const staleLease = {
      ...activeLease,
      attemptId: "workspace-invocation-0",
      leaseGeneration: "0",
    };

    await expect(store.completeInvocation({
      finishedAt: "2026-04-27T00:01:00.000Z",
      lease: staleLease,
    })).resolves.toMatchObject({
      completed: false,
      record: {
        inFlight: true,
        lastInvocationAt: null,
        workspaceInvocation: {
          attemptId: activeLease.attemptId,
        },
      },
    });
    await expect(store.failInvocation({
      error: new Error("stale failure"),
      finishedAt: "2026-04-27T00:02:00.000Z",
      lease: staleLease,
    })).resolves.toMatchObject({
      failed: false,
      record: {
        inFlight: true,
        lastErrorAt: null,
        lastErrorCode: null,
        workspaceInvocation: {
          attemptId: activeLease.attemptId,
        },
      },
    });
  });

  it("rejects a duplicate invocation begin while a lease is active", async () => {
    const { store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const activeLease = await store.beginInvocation({
      reason: "nudge",
      userId: "user-existing",
    });

    await expect(store.beginInvocation({
      reason: "alarm",
      userId: "user-existing",
    })).rejects.toMatchObject({
      name: "RunnerInvocationAlreadyActiveError",
      record: {
        inFlight: true,
        pendingNudge: false,
        workspaceInvocation: {
          attemptId: activeLease.attemptId,
        },
      },
    });
  });

  it("clears orphan observation when the active child proves it still owns the lease", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const lease = await store.beginInvocation({
      reason: "nudge",
      userId: "user-existing",
    });
    db.prepare(`
      UPDATE runner_meta
      SET active_invocation_orphan_observed_at = ?
      WHERE singleton = 1
    `).run("2026-04-27T00:00:00.000Z");

    await expect(store.ownsActiveInvocationLease({
      attemptId: lease.attemptId,
      leaseGeneration: lease.leaseGeneration,
      userId: lease.userId,
    })).resolves.toMatchObject({
      clearedOrphanObservation: true,
      owns: true,
      record: {
        pendingNudge: false,
        workspaceInvocation: {
          attemptId: lease.attemptId,
          orphanObservedAt: null,
        },
      },
    });

    expect(db.prepare(`
      SELECT active_invocation_orphan_observed_at
      FROM runner_meta
      WHERE singleton = 1
    `).get()).toEqual({
      active_invocation_orphan_observed_at: null,
    });
  });

  it("refreshes the active invocation heartbeat when a child proves lease ownership", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:01:00.000Z"));
    try {
      const { store } = createRunnerStateStoreHarness();
      await store.bindUser("user-existing");
      const lease = await store.beginInvocation({
        reason: "nudge",
        userId: "user-existing",
      });

      await expect(store.ownsActiveInvocationLease({
        attemptId: lease.attemptId,
        leaseGeneration: lease.leaseGeneration,
        userId: lease.userId,
      })).resolves.toMatchObject({
        clearedOrphanObservation: false,
        owns: true,
        record: {
          workspaceInvocation: {
            attemptId: lease.attemptId,
            lastHeartbeatAt: "2026-04-27T00:01:00.000Z",
            orphanObservedAt: null,
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects expired active invocation ownership and clears the stale lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:10.000Z"));
    try {
      const { store } = createRunnerStateStoreHarness();
      await store.bindUser("user-existing");
      const lease = await store.beginInvocation({
        expiresAt: "2026-04-27T00:00:05.000Z",
        reason: "nudge",
        userId: "user-existing",
      });

      await expect(store.ownsActiveInvocationLease({
        attemptId: lease.attemptId,
        leaseGeneration: lease.leaseGeneration,
        userId: lease.userId,
      })).resolves.toMatchObject({
        clearedOrphanObservation: false,
        owns: false,
        record: {
          active: null,
          inFlight: false,
          lastErrorAt: "2026-04-27T00:00:10.000Z",
          workspaceInvocation: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects expired active invocation checkpoint writes and clears the stale lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:10.000Z"));
    try {
      const { store } = createRunnerStateStoreHarness();
      await store.bindUser("user-existing");
      const lease = await store.beginInvocation({
        expiresAt: "2026-04-27T00:00:05.000Z",
        reason: "idle_shutdown_checkpoint",
        userId: "user-existing",
      });

      await expect(store.recordActiveInvocationWorkspaceCheckpoint({
        attemptId: lease.attemptId,
        leaseGeneration: lease.leaseGeneration,
        userId: lease.userId,
        workspaceVersion: "1",
      })).resolves.toMatchObject({
        clearedOrphanObservation: false,
        recorded: false,
        record: {
          active: null,
          inFlight: false,
          lastErrorAt: "2026-04-27T00:00:10.000Z",
          workspaceInvocation: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a consumed nudge when clearing a stopped active invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    try {
      const { db, store } = createRunnerStateStoreHarness();
      await store.bindUser("user-existing");
      const lease = await store.beginInvocation({
        expiresAt: "2026-04-27T00:00:45.000Z",
        reason: "nudge",
        userId: "user-existing",
      });
      expect(db.prepare(`
        SELECT pending_nudge, pending_work
        FROM runner_meta
        WHERE singleton = 1
      `).get()).toEqual({
        pending_nudge: 0,
        pending_work: 0,
      });

      await expect(store.recordActiveInvocationContainerStopped({
        attemptId: lease.attemptId,
        leaseGeneration: lease.leaseGeneration,
        stoppedAt: "2026-04-27T00:00:05.000Z",
        userId: "user-existing",
      })).resolves.toMatchObject({
        recorded: true,
        record: {
          inFlight: true,
          pendingNudge: true,
          pendingWork: true,
        },
      });

      await expect(store.clearStaleInvocationIfExpired({
        currentWorkerVersionId: null,
        heartbeatStaleMs: 3_000,
        nowMs: Date.parse("2026-04-27T00:00:06.000Z"),
        readyTimeoutMs: 20_000,
        timeoutMs: 45_000,
      })).resolves.toMatchObject({
        cleared: true,
        reason: "container_stopped",
        record: {
          inFlight: false,
          pendingNudge: true,
          pendingWork: true,
          workspaceInvocation: null,
        },
      });
      expect(db.prepare(`
        SELECT in_flight, pending_nudge, pending_work
        FROM runner_meta
        WHERE singleton = 1
      `).get()).toEqual({
        in_flight: 0,
        pending_nudge: 1,
        pending_work: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clear a work alarm when the expected pending-nudge generation matches but pending_nudge is already consumed", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const workAlarmAt = "2026-04-27T00:05:00.000Z";
    db.prepare(`
      UPDATE runner_meta
      SET pending_nudge = 0,
          pending_work = 1,
          pending_nudge_generation = 3,
          alarm_kind = 'work',
          alarm_due_at = ?,
          alarm_workspace_version = NULL,
          alarm_checkpoint_next_wake_at = NULL
      WHERE singleton = 1
    `).run(workAlarmAt);

    await expect(store.clearPendingInvocationNudge({
      expectedPendingNudgeGeneration: 3,
    })).resolves.toMatchObject({
      alarm: {
        dueAt: workAlarmAt,
        kind: "work",
      },
      pendingNudge: false,
      pendingWork: true,
    });
    expect(db.prepare(`
      SELECT pending_nudge, pending_work, pending_nudge_generation, alarm_kind, alarm_due_at
      FROM runner_meta
      WHERE singleton = 1
    `).get()).toEqual({
      alarm_due_at: workAlarmAt,
      alarm_kind: "work",
      pending_nudge: 0,
      pending_nudge_generation: 3,
      pending_work: 1,
    });
  });

  it("classifies legacy pending_nudge mirror drift as foreground work", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    db.prepare(`
      UPDATE runner_meta
      SET pending_nudge = 1,
          pending_work = 0,
          alarm_kind = 'idle_checkpoint',
          alarm_due_at = ?,
          alarm_workspace_version = ?,
          alarm_checkpoint_next_wake_at = NULL
      WHERE singleton = 1
    `).run("2026-04-27T00:00:00.000Z", "4");

    await expect(store.consumeDueRunnerAlarmAndDecide(
      Date.parse("2026-04-27T00:00:00.000Z"),
    )).resolves.toMatchObject({
      kind: "work",
      reason: "nudge",
      record: {
        alarm: null,
        pendingNudge: true,
        pendingWork: true,
      },
    });
  });

  it("classifies pending_work without the pending_nudge mirror as foreground work", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    db.prepare(`
      UPDATE runner_meta
      SET pending_nudge = 0,
          pending_work = 1,
          alarm_kind = 'work',
          alarm_due_at = ?,
          alarm_workspace_version = NULL,
          alarm_checkpoint_next_wake_at = NULL
      WHERE singleton = 1
    `).run("2026-04-27T00:00:00.000Z");

    await expect(store.consumeDueRunnerAlarmAndDecide(
      Date.parse("2026-04-27T00:00:00.000Z"),
    )).resolves.toMatchObject({
      dueWake: true,
      kind: "work",
      reason: "nudge",
      record: {
        alarm: null,
        pendingNudge: false,
        pendingWork: true,
      },
    });
  });

  it("does not schedule idle checkpoint when legacy pending_nudge mirror drift exists", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    db.prepare(`
      UPDATE runner_meta
      SET pending_nudge = 1,
          pending_work = 0
      WHERE singleton = 1
    `).run();

    await expect(store.scheduleIdleShutdownCheckpointIfStillQuiet({
      dueAt: "2026-04-27T00:01:00.000Z",
      workspaceVersion: "4",
    })).resolves.toMatchObject({
      record: {
        alarm: null,
        pendingNudge: true,
        pendingWork: true,
      },
      scheduled: false,
    });
    expect(db.prepare(`
      SELECT alarm_kind,
             idle_shutdown_checkpoint_due_at,
             idle_shutdown_checkpoint_workspace_version,
             pending_nudge,
             pending_work
      FROM runner_meta
      WHERE singleton = 1
    `).get()).toEqual({
      alarm_kind: null,
      idle_shutdown_checkpoint_due_at: null,
      idle_shutdown_checkpoint_workspace_version: null,
      pending_nudge: 1,
      pending_work: 0,
    });
  });

  it("records active invocation heartbeats and rejects stale heartbeat leases", async () => {
    const { store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const lease = await store.beginInvocation({
      reason: "nudge",
      userId: "user-existing",
    });
    await store.bindInvocationWorkspaceVersion({
      lease,
      workspaceVersion: "0",
    });

    await expect(store.recordActiveInvocationHeartbeatInstruction({
      attemptId: lease.attemptId,
      heartbeatStaleMs: 3_000,
      leaseGeneration: lease.leaseGeneration,
      nowMs: Date.parse("2026-04-27T00:00:10.000Z"),
      runnerReadyTimeoutMs: 20_000,
      runnerTimeoutMs: 45_000,
      userId: lease.userId,
    })).resolves.toMatchObject({
      kind: "continue",
      record: {
        workspaceInvocation: {
          lastHeartbeatAt: "2026-04-27T00:00:10.000Z",
          orphanObservedAt: null,
        },
      },
    });

    await expect(store.recordActiveInvocationHeartbeatInstruction({
      attemptId: lease.attemptId,
      heartbeatStaleMs: 3_000,
      leaseGeneration: lease.leaseGeneration,
      nowMs: Date.parse("2026-04-27T00:00:20.000Z"),
      runnerReadyTimeoutMs: 20_000,
      runnerTimeoutMs: 45_000,
      userId: lease.userId,
    })).resolves.toMatchObject({
      kind: "continue",
      record: {
        workspaceInvocation: {
          lastHeartbeatAt: "2026-04-27T00:00:20.000Z",
        },
      },
    });
  });

  it("yields active foreground heartbeats while preserving pending work", async () => {
    const { db, store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const lease = await store.beginInvocation({
      reason: "nudge",
      userId: "user-existing",
    });
    await store.bindInvocationWorkspaceVersion({
      lease,
      workspaceVersion: "0",
    });
    db.prepare(`
      UPDATE runner_meta
      SET pending_nudge = 0,
          pending_work = 1
      WHERE singleton = 1
    `).run();

    await expect(store.recordActiveInvocationHeartbeatInstruction({
      attemptId: lease.attemptId,
      heartbeatStaleMs: 3_000,
      leaseGeneration: lease.leaseGeneration,
      nowMs: Date.parse("2026-04-27T00:00:10.000Z"),
      runnerReadyTimeoutMs: 20_000,
      runnerTimeoutMs: 45_000,
      userId: lease.userId,
    })).resolves.toMatchObject({
      activeInvocation: {
        attemptId: lease.attemptId,
        reason: "nudge",
        userId: "user-existing",
      },
      kind: "yield",
      nextWakeAt: "2026-04-27T00:00:13.000Z",
      record: {
        alarm: {
          dueAt: "2026-04-27T00:00:13.000Z",
          kind: "work",
        },
        pendingNudge: false,
        pendingWork: true,
      },
      status: "scheduled",
    });
  });

  it("rejects expired active invocation heartbeats and clears the stale lease", async () => {
    const { store } = createRunnerStateStoreHarness();
    await store.bindUser("user-existing");
    const lease = await store.beginInvocation({
      expiresAt: "2026-04-27T00:00:05.000Z",
      reason: "nudge",
      userId: "user-existing",
    });

    await expect(store.recordActiveInvocationHeartbeatInstruction({
      attemptId: lease.attemptId,
      heartbeatStaleMs: 3_000,
      leaseGeneration: lease.leaseGeneration,
      nowMs: Date.parse("2026-04-27T00:00:10.000Z"),
      runnerReadyTimeoutMs: 20_000,
      runnerTimeoutMs: 45_000,
      userId: lease.userId,
    })).resolves.toMatchObject({
      kind: "abort",
      reason: "no_active_invocation",
      record: {
        active: null,
        inFlight: false,
        lastErrorAt: "2026-04-27T00:00:10.000Z",
        workspaceInvocation: null,
      },
    });
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
