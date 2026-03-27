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
