import { describe, expect, it } from "vitest";

import { createHostedDispatchPayloadStore } from "../src/dispatch-payload-store.js";
import type { HostedExecutionCommittedResult } from "../src/execution-journal.js";
import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import { createTestSqlStorage } from "./sql-storage.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

function createQueueHarness(state: { storage: { sql: ReturnType<typeof createTestSqlStorage> } }) {
  const bucket = new MemoryEncryptedR2Bucket();
  const dispatchPayloadStore = createHostedDispatchPayloadStore({
    bucket,
    key: createTestRootKey(41),
    keyId: "k-test",
  });

  return {
    bucket,
    dispatchPayloadStore,
    store: new RunnerQueueStore(state as never, dispatchPayloadStore),
  };
}

describe("RunnerQueueStore", () => {
  it("poisons malformed pending rows and continues to the next valid dispatch", async () => {
    const state = createState();
    const { dispatchPayloadStore, store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    const sql = state.storage.sql!;
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_bad",
      "transient/dispatch-payloads/bad.json",
      0,
      "2026-03-29T10:00:00.000Z",
      "2026-03-29T10:00:00.000Z",
      null,
    );
    const payloadKey = await dispatchPayloadStore.writeDispatchPayload({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_good",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_good",
      payloadKey.key,
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
    expect(badEvent.lastError).toBe("Hosted execution rejected an invalid request.");
    expect(badEvent.lastError).not.toContain("evt_bad");
  });

  it("classifies malformed pending rows as invalid requests", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    state.storage.sql!.exec(
      `INSERT INTO pending_events (
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      "evt_bad_only",
      "transient/dispatch-payloads/bad-only.json",
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
    expect(claimed.record.lastError).toBe("Hosted execution rejected an invalid request.");
  });

  it("fails closed when the Durable Object still has the removed dispatch_json schema", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("DROP TABLE pending_events");
    sql.exec(`
      CREATE TABLE pending_events (
        event_id TEXT PRIMARY KEY,
        dispatch_json TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        last_error TEXT
      )
    `);

    expect(() => {
      createQueueHarness(state);
    }).toThrow(/pending_events schema is unsupported; missing payload_key/u);
  });

  it("fails closed when a mixed queue schema still carries forbidden legacy columns", async () => {
    const state = createState();
    const sql = state.storage.sql!;
    sql.exec("DROP TABLE pending_events");
    sql.exec(`
      CREATE TABLE pending_events (
        event_id TEXT PRIMARY KEY,
        payload_key TEXT NOT NULL,
        dispatch_json TEXT,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        last_error TEXT,
        last_error_code TEXT
      )
    `);

    expect(() => {
      createQueueHarness(state);
    }).toThrow(/pending_events schema is unsupported; forbidden dispatch_json, last_error/u);
  });

  it("persists only operator-safe queue metadata in Durable Object storage", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_secret");

    await store.enqueueDispatch({
      event: {
        kind: "gateway.message.send",
        userId: "member_secret",
        clientRequestId: "client-secret",
        replyToMessageId: null,
        sessionKey: "session-secret",
        text: "super secret gateway message",
      },
      eventId: "evt_secret_payload",
      occurredAt: "2026-03-29T10:00:00.000Z",
    });

    const sql = state.storage.sql!;
    const columns = sql.exec<{ name: string }>("PRAGMA table_info(pending_events)").toArray()
      .map((row) => row.name);
    const row = sql.exec<Record<string, string | number | null>>(
      "SELECT * FROM pending_events WHERE event_id = ?",
      "evt_secret_payload",
    ).one();

    expect(columns).toEqual([
      "event_id",
      "payload_key",
      "attempts",
      "available_at",
      "enqueued_at",
      "last_error_code",
    ]);
    expect(JSON.stringify(row)).not.toContain("super secret gateway message");
    expect(JSON.stringify(row)).not.toContain("session-secret");
  });

  it("deletes an encrypted payload blob when enqueue SQL fails after blob write", async () => {
    const state = createState();
    const { bucket, store } = createQueueHarness(state);
    await store.bootstrapUser("member_secret");

    const sql = state.storage.sql!;
    const originalExec = sql.exec.bind(sql);
    sql.exec = ((query: string, ...bindings: unknown[]) => {
      if (query.includes("INSERT INTO pending_events")) {
        throw new Error("simulated enqueue failure");
      }

      return originalExec(query, ...bindings);
    }) as typeof sql.exec;

    await expect(store.enqueueDispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_secret",
      },
      eventId: "evt_enqueue_cleanup",
      occurredAt: "2026-03-29T10:00:00.000Z",
    })).rejects.toThrow("simulated enqueue failure");

    expect(bucket.objects.size).toBe(0);
    expect(bucket.deleted).toHaveLength(1);
  });

  it("clears malformed bundle refs to null and surfaces a corruption warning", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    const sql = state.storage.sql!;
    sql.exec(
      `UPDATE runner_bundle_slots
        SET bundle_ref_json = ?
        WHERE slot = ?`,
      "{not-json",
      "vault",
    );

    const { store: repairedStore } = createQueueHarness(state);
    const record = await repairedStore.readState();
    expect(record.bundleRef).toBeNull();
    expect(record.lastError).toContain("cleared malformed bundle ref(s): vault");

    const bundleSlots = sql.exec<{
      bundle_ref_json: string | null;
      slot: string;
    }>(
      `SELECT slot, bundle_ref_json
      FROM runner_bundle_slots
      ORDER BY slot ASC`,
    ).toArray();
    expect(bundleSlots).toEqual([
      {
        bundle_ref_json: null,
        slot: "vault",
      },
    ]);
  });

  it("sanitizes malformed bundle refs when callers only read bundle meta state", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    const sql = state.storage.sql!;
    sql.exec(
      `UPDATE runner_bundle_slots
        SET bundle_ref_json = ?
        WHERE slot = ?`,
      "{not-json",
      "vault",
    );

    const bundleMetaState = await store.readBundleMetaState();
    expect(bundleMetaState.bundleRef).toBeNull();

    const bundleSlots = sql.exec<{
      bundle_ref_json: string | null;
      slot: string;
    }>(
      `SELECT slot, bundle_ref_json
      FROM runner_bundle_slots
      ORDER BY slot ASC`,
    ).toArray();
    expect(bundleSlots).toEqual([
      {
        bundle_ref_json: null,
        slot: "vault",
      },
    ]);
  });

  it("stores redacted operator-safe retry errors", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
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
    const { store } = createQueueHarness(state);
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
    const { store } = createQueueHarness(state);
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
    const { store } = createQueueHarness(state);
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
      bundleRef: null,
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

  it("clears stale last-error text when committed bundles are synchronized after a finalize retry", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    state.storage.sql!.exec(
      `UPDATE runner_meta
        SET last_error_at = ?, last_error_code = ?
        WHERE singleton = 1`,
      "2026-03-29T10:00:00.000Z",
      "runner_http_error",
    );

    const committed: HostedExecutionCommittedResult = {
      bundleRef: null,
      committedAt: "2026-03-29T10:00:00.000Z",
      eventId: "evt_finalize_cleared",
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
      userId: "member_123",
    };

    const result = await store.syncCommittedBundles(committed);
    expect(result.lastError).toBeNull();
    expect(result.lastErrorAt).toBeNull();
    expect(result.lastErrorCode).toBeNull();
  });

  it("records a bounded run trace and derives stable error codes", async () => {
    const state = createState();
    const { store } = createQueueHarness(state);
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
    const { store } = createQueueHarness(state);
    await store.bootstrapUser("member_123");

    state.storage.sql!.exec(
      `UPDATE runner_meta
        SET last_error_at = ?, last_error_code = ?
        WHERE singleton = 1`,
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
