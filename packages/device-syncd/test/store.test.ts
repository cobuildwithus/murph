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

test("device sync store hosted hydration preserves existing tokens until disconnect and sanitizes mirrored metadata", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    assert.equal(
      store.hydrateHostedAccount({
        connection: {
          connectedAt: "2026-04-07T00:00:00.000Z",
          displayName: "Missing",
          externalAccountId: "missing-account",
          metadata: {},
          provider: "oura",
          scopes: ["daily"],
          status: "active",
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
        hostedObservedTokenVersion: null,
        hostedObservedUpdatedAt: null,
        localState: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          nextReconcileAt: null,
        },
      }),
      null,
    );

    const account = store.upsertAccount({
      provider: "oura",
      externalAccountId: "oura-user-1",
      displayName: "Oura User",
      scopes: ["daily"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      metadata: {
        existing: "value",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const hydrated = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Updated User",
        externalAccountId: "oura-user-1",
        metadata: {
          "__proto__": "blocked",
          attempts: 2,
          nested: {
            secret: "discarded",
          },
        },
        provider: "oura",
        scopes: ["daily", "sleep"],
        status: "active",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 4,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T00:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T00:20:00.000Z",
        lastWebhookAt: "2026-04-07T00:10:00.000Z",
        nextReconcileAt: "2026-04-07T02:00:00.000Z",
      },
    });

    assert.equal(hydrated?.id, account.id);
    assert.equal(hydrated?.accessTokenEncrypted, "enc:access-token");
    assert.equal(hydrated?.refreshTokenEncrypted, "enc:refresh-token");
    assert.deepEqual(hydrated?.metadata, {
      attempts: 2,
    });
    assert.equal(hydrated?.hostedObservedTokenVersion, 4);
    assert.equal(hydrated?.disconnectGeneration, 0);

    const disconnected = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Updated User",
        externalAccountId: "oura-user-1",
        metadata: {
          reason: "disconnect",
        },
        provider: "oura",
        scopes: ["daily", "sleep"],
        status: "disconnected",
        updatedAt: "2026-04-07T03:00:00.000Z",
      },
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T00:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T00:20:00.000Z",
        lastWebhookAt: "2026-04-07T00:10:00.000Z",
        nextReconcileAt: null,
      },
    });

    assert.equal(disconnected?.accessTokenEncrypted, "");
    assert.equal(disconnected?.refreshTokenEncrypted, null);
    assert.equal(disconnected?.accessTokenExpiresAt, null);
    assert.equal(disconnected?.disconnectGeneration, 1);
    assert.deepEqual(disconnected?.metadata, {
      reason: "disconnect",
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
