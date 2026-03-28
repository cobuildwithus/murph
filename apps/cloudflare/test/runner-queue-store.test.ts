import { describe, expect, it } from "vitest";

import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import { createTestSqlStorage } from "./sql-storage.js";

describe("RunnerQueueStore", () => {
  it("poisons malformed pending rows and continues to the next valid dispatch", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");

    const sql = state.storage.sql!;
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_bad",
      "{not-json",
      0,
      "2026-03-29T10:00:00.000Z",
      "2026-03-29T10:00:00.000Z",
      null,
    );
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_good",
      JSON.stringify({
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_good",
        occurredAt: "2026-03-29T10:00:00.000Z",
      }),
      0,
      "2026-03-29T10:00:00.000Z",
      "2026-03-29T10:00:00.000Z",
      null,
    );

    const claimed = await store.claimNextDuePendingDispatch(
      Date.parse("2026-03-29T10:05:00.000Z"),
    );
    expect(claimed.pendingDispatch?.eventId).toBe("evt_good");

    const badEvent = await store.readEventState("evt_bad");
    expect(badEvent.pending).toBe(false);
    expect(badEvent.poisoned).toBe(true);
    expect(badEvent.lastError).toContain("poisoned malformed pending dispatch evt_bad");
  });

  it("clears malformed bundle refs to null and surfaces a corruption warning", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");

    const sql = state.storage.sql!;
    sql.exec(
      `UPDATE runner_meta
        SET agent_state_bundle_ref_json = ?, vault_bundle_ref_json = ?
        WHERE singleton = 1`,
      "{not-json",
      JSON.stringify({
        hash: 7,
      }),
    );

    const record = await store.readState();
    expect(record.bundleRefs.agentState).toBeNull();
    expect(record.bundleRefs.vault).toBeNull();
    expect(record.lastError).toContain("cleared malformed bundle ref(s): agent-state, vault");

    const meta = sql.exec<{
      agent_state_bundle_ref_json: string | null;
      vault_bundle_ref_json: string | null;
    }>(
      `SELECT agent_state_bundle_ref_json, vault_bundle_ref_json
      FROM runner_meta
      WHERE singleton = 1`,
    ).one();
    expect(meta.agent_state_bundle_ref_json).toBeNull();
    expect(meta.vault_bundle_ref_json).toBeNull();
  });
});

function createState() {
  const sql = createTestSqlStorage();

  return {
    storage: {
      sql,
    },
  };
}
