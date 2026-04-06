import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { SqliteDeviceSyncStore } from "../src/store.ts";
import { makeTempDirectory } from "./helpers.ts";

interface WebhookTraceRow {
  payload_json: string;
  processing_expires_at: string | null;
  status: string;
}

test("device sync store minimizes webhook trace payload retention without changing claim or completion state", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-1",
        externalAccountId: "acct-1",
        eventType: "sleep.updated",
        receivedAt: "2026-01-01T00:00:00.000Z",
        processingExpiresAt: "2026-01-01T00:01:00.000Z",
        payload: {
          accessToken: "sample-token",
          nested: {
            healthRecordId: "sample-record",
          },
        },
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      payload_json: "{}",
      processing_expires_at: "2026-01-01T00:01:00.000Z",
      status: "processing",
    });

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-1",
        externalAccountId: "acct-1",
        eventType: "sleep.updated",
        receivedAt: "2026-01-01T00:02:00.000Z",
        processingExpiresAt: "2026-01-01T00:03:00.000Z",
        payload: {
          email: "still-should-not-persist@example.invalid",
        },
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      payload_json: "{}",
      processing_expires_at: "2026-01-01T00:03:00.000Z",
      status: "processing",
    });

    store.completeWebhookTrace("oura", "trace-1");

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      payload_json: "{}",
      processing_expires_at: null,
      status: "processed",
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

function readWebhookTraceRow(
  store: SqliteDeviceSyncStore,
  provider: string,
  traceId: string,
): WebhookTraceRow | null {
  return store.database.prepare(`
    select payload_json, processing_expires_at, status
    from webhook_trace
    where provider = ?
      and trace_id = ?
  `).get(provider, traceId) as WebhookTraceRow | null;
}

function normalizeWebhookTraceRow(row: WebhookTraceRow | null): WebhookTraceRow | null {
  return row ? { ...row } : null;
}
