import { describe, expect, it, vi } from "vitest";

import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import { createTestSqlStorage } from "./sql-storage.js";

describe("RunnerQueueStore.syncNextWake", () => {
  it("does not reuse a stale persisted next_wake_at when no fresh preferred wake is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));

    const sql = createTestSqlStorage();
    sql.exec(
      `INSERT INTO runner_meta (
        singleton,
        user_id,
        activated,
        in_flight,
        last_error,
        last_event_id,
        last_run_at,
        next_wake_at,
        retrying_event_id,
        backpressured_event_ids_json,
        agent_state_bundle_ref_json,
        vault_bundle_ref_json,
        agent_state_bundle_version,
        vault_bundle_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      "member_123",
      1,
      0,
      null,
      "evt_seed",
      "2026-03-26T12:00:00.000Z",
      "2026-03-26T12:00:05.000Z",
      null,
      "[]",
      null,
      null,
      0,
      0,
    );

    const store = new RunnerQueueStore({
      storage: {
        deleteAlarm: async () => {},
        get: async () => undefined,
        getAlarm: async () => null,
        put: async () => {},
        setAlarm: async () => {},
        sql,
      },
    });

    const record = await store.syncNextWake({
      defaultAlarmDelayMs: 60_000,
    });

    expect(record.nextWakeAt).toBe("2026-03-26T12:01:10.000Z");
  });
});

describe("RunnerQueueStore replay compaction", () => {
  it("keeps replay protection after exact consumed rows expire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const sql = createTestSqlStorage();
    const store = new RunnerQueueStore({
      storage: {
        deleteAlarm: async () => {},
        get: async () => undefined,
        getAlarm: async () => null,
        put: async () => {},
        setAlarm: async () => {},
        sql,
      },
    });

    await store.bootstrapUser("member_123");
    await store.rememberCommittedEvent("evt_compacted");

    sql.exec(
      "UPDATE consumed_events SET expires_at = ? WHERE event_id = ?",
      "2026-03-01T00:00:00.000Z",
      "evt_compacted",
    );

    const state = await store.readEventPresence("evt_compacted");
    const remainingExactRows = Number(
      sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM consumed_events WHERE event_id = ?", "evt_compacted")
        .toArray()[0]?.count ?? 0,
    );

    expect(remainingExactRows).toBe(0);
    expect(state.consumed).toBe(true);
  });

  it("bounds stored poisoned events while preserving the newest surfaced ids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const sql = createTestSqlStorage();
    const store = new RunnerQueueStore({
      storage: {
        deleteAlarm: async () => {},
        get: async () => undefined,
        getAlarm: async () => null,
        put: async () => {},
        setAlarm: async () => {},
        sql,
      },
    });

    await store.bootstrapUser("member_123");

    for (let index = 0; index < 20; index += 1) {
      const eventId = `evt_poison_${index}`;
      await store.enqueueDispatch(createDispatch(eventId));
      vi.setSystemTime(new Date(Date.now() + 1_000));
      await store.reschedulePendingFailure({
        errorMessage: `poisoned ${index}`,
        eventId,
        maxEventAttempts: 1,
        retryDelayMs: 1_000,
      });
    }

    const poisonedRows = Number(
      sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM poisoned_events")
        .toArray()[0]?.count ?? 0,
    );
    const state = await store.readState();

    expect(poisonedRows).toBe(16);
    expect(state.poisonedEventIds).toEqual([
      "evt_poison_4",
      "evt_poison_5",
      "evt_poison_6",
      "evt_poison_7",
      "evt_poison_8",
      "evt_poison_9",
      "evt_poison_10",
      "evt_poison_11",
      "evt_poison_12",
      "evt_poison_13",
      "evt_poison_14",
      "evt_poison_15",
      "evt_poison_16",
      "evt_poison_17",
      "evt_poison_18",
      "evt_poison_19",
    ]);
  });
});

function createDispatch(eventId: string) {
  return {
    event: {
      kind: "assistant.cron.tick" as const,
      reason: "manual" as const,
      userId: "member_123",
    },
    eventId,
    occurredAt: new Date().toISOString(),
  };
}
