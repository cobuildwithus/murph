import { describe, expect, it, vi } from "vitest";

import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import type { RunnerPendingCommitRecord } from "../src/user-runner/types.js";
import { createTestSqlStorage } from "./sql-storage.js";

function createQueueHarness(state: { storage: { sql: ReturnType<typeof createTestSqlStorage> } }) {
  return {
    store: new RunnerStateStore(state as never),
  };
}

function createPendingCommit(): RunnerPendingCommitRecord {
  return {
    assistantDeliveryEffects: [],
    bundleRef: null,
    committedAt: "2026-04-18T12:00:00.000Z",
    eventId: "evt_committed",
    finalizedAt: null,
    result: {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "ok",
    },
    schemaVersion: 1,
    userId: "member_123",
    wake: {
      eventId: "evt_committed",
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-18T11:59:59.000Z",
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-wake-system.v1",
      seq: "1",
      userId: "member_123",
    },
  };
}

describe("RunnerStateStore", () => {
  it("drops legacy local queue lifecycle tables during schema setup", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("CREATE TABLE IF NOT EXISTS pending_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS consumed_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS backpressured_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS poisoned_events (event_id TEXT PRIMARY KEY)");

    createQueueHarness(state);

    expect(sql.exec<{ name: string }>("PRAGMA table_info(pending_events)").toArray()).toEqual([]);
    expect(sql.exec<{ name: string }>("PRAGMA table_info(consumed_events)").toArray()).toEqual([]);
    expect(sql.exec<{ name: string }>("PRAGMA table_info(backpressured_events)").toArray()).toEqual([]);
    expect(sql.exec<{ name: string }>("PRAGMA table_info(poisoned_events)").toArray()).toEqual([]);
  });

  it("fails closed when runner_meta still carries the removed activated column", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("DROP TABLE runner_meta");
    sql.exec(`
      CREATE TABLE runner_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        user_id TEXT NOT NULL,
        activated INTEGER NOT NULL DEFAULT 0,
        in_flight INTEGER NOT NULL DEFAULT 0,
        last_error_at TEXT,
        last_error_code TEXT,
        last_run_at TEXT,
        next_wake_at TEXT
      )
    `);

    expect(() => {
      createQueueHarness(state);
    }).toThrow(/runner_meta schema is unsupported; missing runtime_bootstrapped; forbidden activated/u);
  });

  it("upgrades an existing runner_meta row by adding active-run lease and operator summary columns in place", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("DROP TABLE runner_meta");
    sql.exec(`
      CREATE TABLE runner_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        user_id TEXT NOT NULL,
        runtime_bootstrapped INTEGER NOT NULL DEFAULT 0,
        in_flight INTEGER NOT NULL DEFAULT 0,
        last_error_at TEXT,
        last_error_code TEXT,
        last_run_at TEXT,
        next_wake_at TEXT
      )
    `);
    sql.exec(
      `INSERT INTO runner_meta (
        singleton,
        user_id,
        runtime_bootstrapped,
        in_flight,
        last_error_at,
        last_error_code,
        last_run_at,
        next_wake_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      "member_123",
      1,
      1,
      "2026-03-29T10:00:00.000Z",
      "runner_http_error",
      "2026-03-29T10:05:00.000Z",
      "2026-03-29T10:06:00.000Z",
    );

    const { store } = createQueueHarness(state);
    const columns = sql.exec<{ name: string }>("PRAGMA table_info(runner_meta)").toArray()
      .map((row) => row.name);
    const record = await store.readState();

    expect(columns).toContain("active_run_event_id");
    expect(columns).toContain("active_run_id");
    expect(columns).toContain("active_run_attempt");
    expect(columns).toContain("active_run_started_at");
    expect(columns).toContain("last_event_id");
    expect(record.userId).toBe("member_123");
    expect(record.runtimeBootstrapped).toBe(true);
    expect(record.inFlight).toBe(true);
    expect(record.lastErrorCode).toBe("runner_http_error");
    expect(record.lastRunAt).toBe("2026-03-29T10:05:00.000Z");
    expect(record.pendingWakeCount).toBe(0);
  });

  it("tracks active-run lease and next-wake scheduling without local queue rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T10:00:00.000Z"));
    const state = createState();
    const { store } = createQueueHarness(state);
    try {
      await store.bootstrapUser("member_123");

      const claimed = await store.beginWakeRun({
        eventId: "evt_active",
        run: {
          attempt: 2,
          runId: "run_active",
          startedAt: "2026-04-18T10:00:00.000Z",
        },
        userId: "member_123",
      });

      expect(claimed.inFlight).toBe(true);
      expect(claimed.run).toMatchObject({
        attempt: 2,
        eventId: "evt_active",
        runId: "run_active",
      });
      expect(claimed.lastEventId).toBe("evt_active");
      expect(await store.hasActiveRunLease({
        eventId: "evt_active",
        run: {
          attempt: 2,
          runId: "run_active",
          startedAt: "2026-04-18T10:00:00.000Z",
        },
      })).toBe(true);

      const retried = await store.failWakeRun({
        error: new Error("runner_http_error"),
        eventId: "evt_active",
        leaseOwner: {
          eventId: "evt_active",
          run: {
            attempt: 2,
            runId: "run_active",
            startedAt: "2026-04-18T10:00:00.000Z",
          },
        },
      });
      expect(retried.inFlight).toBe(false);
      expect(retried.lastEventId).toBe("evt_active");
      expect(retried.lastErrorCode).toBe("runtime_error");
      expect(retried.pendingWakeCount).toBe(0);

      const scheduled = await store.syncNextWake({
        preferredWakeAt: "2026-04-18T10:05:00.000Z",
      });
      expect(scheduled.nextWakeAt).toBe("2026-04-18T10:05:00.000Z");

      const cleared = await store.clearNextWakeIfDue(Date.parse("2026-04-18T10:05:01.000Z"));
      expect(cleared.nextWakeAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores and clears DO-local pending commit recovery metadata", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");
    await store.beginWakeRun({
      eventId: "evt_committed",
      run: {
        attempt: 1,
        runId: "run_committed",
        startedAt: "2026-04-18T11:00:00.000Z",
      },
      userId: "member_123",
    });

    const afterCommit = await store.writePendingCommit(createPendingCommit());
    expect(afterCommit.inFlight).toBe(true);
    expect(await store.readPendingCommit("evt_committed")).toEqual(createPendingCommit());

    const finalized = await store.completeWakeRun({
      eventId: "evt_committed",
      finishedAt: "2026-04-18T12:00:01.000Z",
      leaseOwner: {
        eventId: "evt_committed",
        policy: "same-event",
        run: null,
      },
    });
    await store.clearPendingCommit("evt_committed");
    expect(finalized.inFlight).toBe(false);
    expect(finalized.lastEventId).toBe("evt_committed");
    expect(finalized.lastRunAt).toBe("2026-04-18T12:00:01.000Z");
    expect(finalized.pendingWakeCount).toBe(0);
    await expect(store.readPendingCommit("evt_committed")).resolves.toBeNull();
  });
});

function createState() {
  return {
    storage: {
      sql: createTestSqlStorage(),
    },
  };
}
