import { describe, expect, it, vi } from "vitest";
import { HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA } from "@murphai/hosted-execution";

import {
  RunnerPendingCommitCorruptionError,
  RunnerStateStore,
} from "../src/user-runner/runner-state-store.js";
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
    finalizeToken: null,
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
      fetchProof: null,
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-18T11:59:59.000Z",
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      seq: "1",
      userId: "member_123",
      wakeId: null,
    },
  };
}

describe("RunnerStateStore", () => {
  it("boots the greenfield runner state without depending on legacy local queue tables", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("CREATE TABLE IF NOT EXISTS pending_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS consumed_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS backpressured_events (event_id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS legacy_terminal_events (event_id TEXT PRIMARY KEY)");

    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");
    const record = await store.readState();

    expect(record.userId).toBe("member_123");
    expect(record.pendingWakeCount).toBe(0);
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
    }).toThrow(
      /runner_meta schema is unsupported; missing bundle_ref_json, bundle_version, active_run_event_id, active_run_id, active_run_attempt, active_run_started_at, runtime_bootstrapped, last_event_id, pending_commit_json, wake_materialization_hints_json/u,
    );
  });

  it("fails closed when runner_meta omits required greenfield columns", async () => {
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

    expect(() => {
      createQueueHarness(state);
    }).toThrow(
      /runner_meta schema is unsupported; missing bundle_ref_json, bundle_version, active_run_event_id, active_run_id, active_run_attempt, active_run_started_at, last_event_id, pending_commit_json, wake_materialization_hints_json/u,
    );
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

  it("logs malformed active-run lease timestamps while keeping the persisted lease readable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");
    state.storage.sql.exec(
      `UPDATE runner_meta
         SET active_run_event_id = ?,
             active_run_id = ?,
             active_run_attempt = ?,
             active_run_started_at = ?
       WHERE singleton = 1`,
      "evt_active",
      "run_active",
      1,
      "not-a-timestamp",
    );

    await expect(store.readActiveRunLease()).resolves.toEqual({
      eventId: "evt_active",
      run: {
        attempt: 1,
        runId: "run_active",
        startedAt: "not-a-timestamp",
      },
    });
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        activeRunAttempt?: number;
        activeRunEventId?: string;
        activeRunId?: string;
        activeRunStartedAt?: string;
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("active-run lease timestamp was malformed")
      && record.details?.activeRunEventId === "evt_active"
      && record.details?.activeRunId === "run_active"
      && record.details?.activeRunAttempt === 1
      && record.details?.activeRunStartedAt === "not-a-timestamp")).toBe(true);
    warnSpy.mockRestore();
  });

  it("logs when malformed wake materialization hints are dropped while syncing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    const scheduled = await store.syncNextWake({
      preferredWakeAt: null,
      wakeMaterializationHints: {
        assistantWakeAt: "not-a-timestamp",
      },
    });

    expect(scheduled.nextWakeAt).toBeNull();
    expect(await store.readWakeMaterializationHints()).toEqual({
      assistantWakeAt: null,
    });
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        assistantWakeAt?: string | null;
        deviceSyncWakeAt?: string | null;
        wakeMaterializationHintKeys?: string[];
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("dropped after normalization")
      && record.details?.assistantWakeAt === "not-a-timestamp"
      && record.details?.wakeMaterializationHintKeys?.length === 1)).toBe(true);
    warnSpy.mockRestore();
  });

  it("logs when empty wake materialization hints are dropped while syncing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    const scheduled = await store.syncNextWake({
      preferredWakeAt: null,
      wakeMaterializationHints: {},
    });

    expect(scheduled.nextWakeAt).toBeNull();
    expect(await store.readWakeMaterializationHints()).toBeNull();
    const logRecords = warnSpy.mock.calls.map(([entry]) => JSON.parse(String(entry)) as {
      details?: {
        wakeMaterializationHintKeyCount?: number;
      };
      message: string;
    });
    expect(logRecords.some((record) => record.message.includes("dropped after normalization")
      && record.details?.wakeMaterializationHintKeyCount === 0)).toBe(true);
    warnSpy.mockRestore();
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

  it("clears stale pending-commit wake hints together with recovery state", async () => {
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
    await store.syncNextWake({
      preferredWakeAt: "2026-04-18T12:30:00.000Z",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-18T12:30:00.000Z",
      },
    });
    await store.writePendingCommit(createPendingCommit());

    const cleared = await store.discardPendingCommitRecoveryState("evt_committed");

    expect(cleared.inFlight).toBe(false);
    expect(cleared.nextWakeAt).toBeNull();
    await expect(store.readPendingCommit("evt_committed")).resolves.toBeNull();
    await expect(store.readWakeMaterializationHints()).resolves.toBeNull();
  });

  it("fails closed when raw pending commit JSON is malformed", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");
    state.storage.sql.exec(
      "UPDATE runner_meta SET pending_commit_json = ? WHERE singleton = 1",
      "{",
    );

    await expect(store.readPendingCommit("evt_committed")).rejects.toThrow(
      RunnerPendingCommitCorruptionError,
    );
    await expect(store.writePendingCommit({
      ...createPendingCommit(),
      eventId: "evt_replacement",
      wake: {
        ...createPendingCommit().wake,
        eventId: "evt_replacement",
      },
    })).rejects.toThrow(/pending_commit_json is corrupted/u);
    await expect(store.clearPendingCommit("evt_committed")).rejects.toThrow(
      RunnerPendingCommitCorruptionError,
    );
    await expect(store.readPendingCommit()).rejects.toThrow(
      RunnerPendingCommitCorruptionError,
    );

    const repaired = await store.clearPendingCommit();
    expect(repaired.lastEventId).toBeNull();
    await expect(store.readPendingCommit()).resolves.toBeNull();
  });
});

function createState() {
  return {
    storage: {
      sql: createTestSqlStorage(),
    },
  };
}
