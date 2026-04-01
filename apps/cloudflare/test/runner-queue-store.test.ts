import { describe, expect, it } from "vitest";

import type { HostedExecutionCommittedResult } from "../src/execution-journal.js";
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
    expect(badEvent.lastError).toBe("Hosted runner poisoned a malformed pending dispatch.");
    expect(badEvent.lastError).not.toContain("evt_bad");
  });

  it("classifies malformed pending rows as invalid requests", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");

    state.storage.sql!.exec(
      `INSERT INTO pending_events (
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_bad_only",
      "{not-json",
      0,
      "2026-03-29T10:00:00.000Z",
      "2026-03-29T10:00:00.000Z",
      null,
    );

    const claimed = await store.claimNextDuePendingDispatch(
      Date.parse("2026-03-29T10:05:00.000Z"),
    );
    expect(claimed.pendingDispatch).toBeNull();
    expect(claimed.record.lastErrorCode).toBe("invalid_request");
    expect(claimed.record.lastError).toBe("Hosted runner poisoned a malformed pending dispatch.");
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

    const repairedStore = new RunnerQueueStore(state as never);
    const record = await repairedStore.readState();
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

  it("sanitizes malformed bundle refs when callers only read bundle meta state", async () => {
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

    const bundleMetaState = await store.readBundleMetaState();
    expect(bundleMetaState.bundleRefs.agentState).toBeNull();
    expect(bundleMetaState.bundleRefs.vault).toBeNull();

    const meta = sql.exec<{
      agent_state_bundle_ref_json: string | null;
      last_error: string | null;
      vault_bundle_ref_json: string | null;
    }>(
      `SELECT agent_state_bundle_ref_json, vault_bundle_ref_json, last_error
      FROM runner_meta
      WHERE singleton = 1`,
    ).one();
    expect(meta.agent_state_bundle_ref_json).toBeNull();
    expect(meta.vault_bundle_ref_json).toBeNull();
    expect(meta.last_error).toContain("cleared malformed bundle ref(s): agent-state, vault");
  });

  it("stores redacted operator-safe retry errors", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");
    await store.enqueueDispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_secret_retry",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });

    await store.claimNextDuePendingDispatch(Date.parse("2026-03-29T10:00:00.000Z"));
    const result = await store.reschedulePendingFailure({
      error: new Error("Authorization: Bearer secret-token for ops@example.com OPENAI_API_KEY=sk-live-secret"),
      eventId: "evt_secret_retry",
      maxEventAttempts: 3,
      retryDelayMs: 30_000,
    });

    expect(result.poisoned).toBe(false);
    expect(result.record.lastError).toBe("Hosted execution authorization failed.");
    expect(result.record.lastErrorCode).toBe("authorization_error");

    const eventState = await store.readEventState("evt_secret_retry");
    expect(eventState.lastError).toBe("Hosted execution authorization failed.");
    expect(eventState.lastError).not.toContain("secret-token");
    expect(eventState.lastError).not.toContain("ops@example.com");
  });

  it("keeps runtime exception summaries generic in persisted retry state", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");
    await store.enqueueDispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_runtime_retry",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });

    await store.claimNextDuePendingDispatch(Date.parse("2026-03-29T10:00:00.000Z"));
    const result = await store.reschedulePendingFailure({
      error: new TypeError("missing hosted runtime config"),
      eventId: "evt_runtime_retry",
      maxEventAttempts: 3,
      retryDelayMs: 30_000,
    });

    expect(result.poisoned).toBe(false);
    expect(result.record.lastError).toBe("Hosted execution runtime failed.");
    expect(result.record.lastErrorCode).toBe("type_error");
  });

  it("stores sanitized configuration summaries when deferring pending work", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");
    await store.enqueueDispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_secret_config",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });

    await store.claimNextDuePendingDispatch(Date.parse("2026-03-29T10:00:00.000Z"));
    const error = new Error("OPENAI_API_KEY=sk-live-secret must be configured");
    error.name = "HostedExecutionConfigurationError";
    const result = await store.deferPendingConfigurationFailure({
      error,
      eventId: "evt_secret_config",
      retryDelayMs: 30_000,
    });

    expect(result.lastError).toBe("Hosted execution configuration is invalid.");
    expect(result.lastErrorCode).toBe("configuration_error");

    const eventState = await store.readEventState("evt_secret_config");
    expect(eventState.lastError).toBe("Hosted execution configuration is invalid.");
    expect(eventState.lastError).not.toContain("sk-live-secret");
  });

  it("stores sanitized finalize-retry summaries for committed results", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");
    await store.enqueueDispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_secret_finalize",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });

    const committed: HostedExecutionCommittedResult = {
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      committedAt: "2026-03-29T10:00:00.000Z",
      eventId: "evt_secret_finalize",
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
      userId: "member_123",
    };

    const result = await store.rescheduleCommittedFinalizeRetry({
      attempts: 2,
      committed,
      error: new Error("Authorization: Bearer secret-token for ops@example.com OPENAI_API_KEY=sk-live-secret"),
      retryDelayMs: 30_000,
    });

    expect(result.lastError).toBe("Hosted execution authorization failed.");
    expect(result.lastErrorCode).toBe("authorization_error");

    const eventState = await store.readEventState("evt_secret_finalize");
    expect(eventState.lastError).toBe("Hosted execution authorization failed.");
    expect(eventState.lastError).not.toContain("secret-token");
    expect(eventState.lastError).not.toContain("ops@example.com");
  });

  it("records a bounded run trace and derives stable error codes", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");

    for (let index = 0; index < 26; index += 1) {
      await store.recordRunPhase({
        attempt: 2,
        component: "runner",
        eventId: "evt_trace",
        message: `phase-${index}`,
        phase: index === 25 ? "retry.scheduled" : "dispatch.running",
        ...(index === 25 ? {
          error: new Error("Hosted runner container returned HTTP 503."),
          level: "warn" as const,
        } : {}),
        runId: "run_trace",
        startedAt: "2026-03-29T10:00:00.000Z",
      });
    }

    const record = await store.readState();
    expect(record.lastEventId).toBe("evt_trace");
    expect(record.lastErrorCode).toBe("runner_http_error");
    expect(record.lastErrorAt).toEqual(expect.any(String));
    expect(record.run).toMatchObject({
      attempt: 2,
      eventId: "evt_trace",
      phase: "retry.scheduled",
      runId: "run_trace",
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    expect(record.timeline).toHaveLength(24);
    expect(record.timeline[0]).toMatchObject({
      message: "phase-2",
      phase: "dispatch.running",
      runId: "run_trace",
    });
    expect(record.timeline.at(-1)).toMatchObject({
      errorCode: "runner_http_error",
      level: "warn",
      message: "phase-25",
      phase: "retry.scheduled",
    });
  });

  it("clears the persisted last-error string when a later phase requests clearError", async () => {
    const state = createState();
    const store = new RunnerQueueStore(state as never);
    await store.bootstrapUser("member_123");

    state.storage.sql!.exec(
      `UPDATE runner_meta
        SET last_error = ?, last_error_at = ?, last_error_code = ?
        WHERE singleton = 1`,
      "Hosted execution runtime failed.",
      "2026-03-29T10:00:00.000Z",
      "type_error",
    );

    const record = await store.recordRunPhase({
      attempt: 3,
      clearError: true,
      component: "runner",
      eventId: "evt_cleared",
      message: "run recovered",
      phase: "dispatch.running",
      runId: "run_recovered",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(record.lastError).toBeNull();
    expect(record.lastErrorAt).toBeNull();
    expect(record.lastErrorCode).toBeNull();
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
