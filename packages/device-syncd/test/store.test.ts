import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

import { SqliteDeviceSyncStore } from "../src/store.ts";
import { DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION } from "../src/store/schema.ts";
import { makeTempDirectory } from "./helpers.ts";

const MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID = "_minimized_";
const UNSUPPORTED_SCHEMA_VERSION = DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION + 1;
const UNSUPPORTED_SCHEMA_VERSION_RE = new RegExp(
  `device sync runtime database schema version ${UNSUPPORTED_SCHEMA_VERSION} is newer than supported version ${DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION}`,
  "u",
);

interface WebhookTraceRow {
  external_account_id: string;
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
        receivedAt: "2026-04-01T00:00:00.000Z",
        processingExpiresAt: "2026-04-01T00:01:00.000Z",
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      payload_json: "{}",
      processing_expires_at: "2026-04-01T00:01:00.000Z",
      status: "processing",
    });

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-1",
        externalAccountId: "acct-1",
        eventType: "sleep.updated",
        receivedAt: "2026-04-01T00:02:00.000Z",
        processingExpiresAt: "2026-04-01T00:03:00.000Z",
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      payload_json: "{}",
      processing_expires_at: "2026-04-01T00:03:00.000Z",
      status: "processing",
    });

    store.completeWebhookTrace("oura", "trace-1");

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRow(store, "oura", "trace-1")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
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

test("device sync store prunes processed webhook traces older than the retention window", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-webhook-trace-prune");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    store.database.prepare(`
      insert into webhook_trace (
        provider,
        trace_id,
        external_account_id,
        event_type,
        received_at,
        payload_json,
        status,
        processing_expires_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "oura",
      "trace-old-processed",
      "legacy-acct",
      "sleep.updated",
      "2025-01-01T00:00:00.000Z",
      "{}",
      "processed",
      null,
    );

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-new",
        externalAccountId: "acct-1",
        eventType: "sleep.updated",
        receivedAt: "2026-04-01T00:00:00.000Z",
        processingExpiresAt: "2026-04-01T00:01:00.000Z",
      }),
      "claimed",
    );

    const remainingTraceIds = (
      store.database.prepare(`
        select trace_id
        from webhook_trace
        where provider = ?
        order by trace_id asc
      `).all("oura") as Array<{ trace_id?: string }>
    )
      .map((row) => row.trace_id)
      .filter((traceId): traceId is string => typeof traceId === "string");

    assert.deepEqual(remainingTraceIds, ["trace-new"]);
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
    assert.equal(disconnected?.hostedObservedTokenVersion, null);
    assert.deepEqual(disconnected?.metadata, {
      reason: "disconnect",
    });

    const reconnected = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T04:00:00.000Z",
        displayName: "Reconnected User",
        externalAccountId: "oura-user-1",
        metadata: {
          reconnect: true,
        },
        provider: "oura",
        scopes: ["daily", "sleep"],
        status: "active",
        updatedAt: "2026-04-07T04:00:00.000Z",
      },
      hostedObservedTokenVersion: 1,
      hostedObservedUpdatedAt: "2026-04-07T04:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T03:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T03:20:00.000Z",
        lastWebhookAt: "2026-04-07T03:10:00.000Z",
        nextReconcileAt: "2026-04-07T05:00:00.000Z",
      },
      tokens: {
        accessToken: "reconnected-access-token",
        accessTokenEncrypted: "enc:reconnected-access-token",
        accessTokenExpiresAt: "2026-04-07T06:00:00.000Z",
        refreshToken: "reconnected-refresh-token",
        refreshTokenEncrypted: "enc:reconnected-refresh-token",
      },
    });

    assert.equal(reconnected?.status, "active");
    assert.equal(reconnected?.displayName, "Reconnected User");
    assert.equal(reconnected?.accessTokenEncrypted, "enc:reconnected-access-token");
    assert.equal(reconnected?.refreshTokenEncrypted, "enc:reconnected-refresh-token");
    assert.equal(reconnected?.hostedObservedTokenVersion, 1);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store applies newer hosted connection state without replaying older token bundles", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-stale-hosted-token");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-stale-hosted-token",
      displayName: "Seeded",
      scopes: ["offline"],
      tokens: {
        accessToken: "seed-access",
        accessTokenEncrypted: "enc:seed-access",
        refreshToken: "seed-refresh",
        refreshTokenEncrypted: "enc:seed-refresh",
      },
      metadata: {
        seeded: true,
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T02:00:00.000Z",
    });

    const hydrated = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Fresh",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          hosted: true,
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "active",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 7,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T00:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T00:20:00.000Z",
        lastWebhookAt: "2026-04-07T00:10:00.000Z",
        nextReconcileAt: "2026-04-07T03:00:00.000Z",
      },
      tokens: {
        accessToken: "hosted-access-v7",
        accessTokenEncrypted: "enc:hosted-access-v7",
        accessTokenExpiresAt: "2026-04-07T04:00:00.000Z",
        refreshToken: "hosted-refresh-v7",
        refreshTokenEncrypted: "enc:hosted-refresh-v7",
      },
    });

    assert.ok(hydrated);
    assert.equal(hydrated?.hostedObservedTokenVersion, 7);

    const locallyRefreshed = store.updateAccountTokens(
      hydrated!.id,
      {
        accessToken: "local-access-refresh",
        accessTokenEncrypted: "enc:local-access-refresh",
        accessTokenExpiresAt: "2026-04-07T05:00:00.000Z",
        refreshToken: "local-refresh-refresh",
        refreshTokenEncrypted: "enc:local-refresh-refresh",
      },
      hydrated!.disconnectGeneration,
    );

    assert.ok(locallyRefreshed);

    const partiallyHydrated = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Connection Update",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          fresh: true,
          nested: {
            drop: "me",
          },
        },
        provider: seeded.provider,
        scopes: ["daily"],
        status: "reauthorization_required",
        updatedAt: "2026-04-07T02:00:00.000Z",
      },
      hostedObservedTokenVersion: 6,
      hostedObservedUpdatedAt: "2026-04-07T02:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T01:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T01:20:00.000Z",
        lastWebhookAt: "2026-04-07T01:10:00.000Z",
        nextReconcileAt: "2026-04-07T06:00:00.000Z",
      },
      tokens: {
        accessToken: "stale-hosted-access",
        accessTokenEncrypted: "enc:stale-hosted-access",
        accessTokenExpiresAt: "2026-04-07T03:00:00.000Z",
        refreshToken: "stale-hosted-refresh",
        refreshTokenEncrypted: "enc:stale-hosted-refresh",
      },
    });

    assert.equal(partiallyHydrated?.id, seeded.id);
    assert.equal(partiallyHydrated?.displayName, "Hosted Connection Update");
    assert.equal(partiallyHydrated?.status, "reauthorization_required");
    assert.deepEqual(partiallyHydrated?.metadata, {
      fresh: true,
    });
    assert.deepEqual(partiallyHydrated?.scopes, ["daily"]);
    assert.equal(partiallyHydrated?.hostedObservedUpdatedAt, "2026-04-07T02:00:00.000Z");
    assert.equal(partiallyHydrated?.hostedObservedTokenVersion, 7);
    assert.equal(partiallyHydrated?.accessTokenEncrypted, "enc:local-access-refresh");
    assert.equal(partiallyHydrated?.refreshTokenEncrypted, "enc:local-refresh-refresh");
    assert.equal(partiallyHydrated?.accessTokenExpiresAt, "2026-04-07T05:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store rejects same-snapshot hosted replays after newer local connection and token writes even when local timestamps skew older", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-replay");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-replay",
      displayName: "Seeded",
      scopes: ["offline"],
      tokens: {
        accessToken: "seed-access",
        accessTokenEncrypted: "enc:seed-access",
        refreshToken: "seed-refresh",
        refreshTokenEncrypted: "enc:seed-refresh",
      },
      metadata: {
        seeded: true,
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T02:00:00.000Z",
    });

    const hydrated = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Fresh",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          hosted: true,
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "active",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 7,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T00:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T00:20:00.000Z",
        lastWebhookAt: "2026-04-07T00:10:00.000Z",
        nextReconcileAt: "2026-04-07T03:00:00.000Z",
      },
      tokens: {
        accessToken: "hosted-access-v7",
        accessTokenEncrypted: "enc:hosted-access-v7",
        accessTokenExpiresAt: "2026-04-07T04:00:00.000Z",
        refreshToken: "hosted-refresh-v7",
        refreshTokenEncrypted: "enc:hosted-refresh-v7",
      },
    });

    assert.ok(hydrated);

    const locallyRefreshed = store.updateAccountTokens(
      hydrated!.id,
      {
        accessToken: "local-access-refresh",
        accessTokenEncrypted: "enc:local-access-refresh",
        accessTokenExpiresAt: "2026-04-07T05:00:00.000Z",
        refreshToken: "local-refresh-refresh",
        refreshTokenEncrypted: "enc:local-refresh-refresh",
      },
      hydrated!.disconnectGeneration,
    );

    assert.ok(locallyRefreshed);

    const locallyPatched = store.patchAccount(hydrated!.id, {
      displayName: "Local Fresh",
      metadata: {
        local: true,
      },
      nextReconcileAt: "2026-04-07T03:30:00.000Z",
      scopes: ["offline", "manual"],
      status: "reauthorization_required",
    });

    assert.equal(locallyPatched.displayName, "Local Fresh");
    assert.equal(locallyPatched.localConnectionRevision, 1);
    assert.equal(locallyPatched.localTokenRevision, 1);

    store.database.prepare(`
      update device_connection
      set updated_at = ?
      where id = ?
    `).run("2026-04-06T23:00:00.000Z", hydrated!.id);

    const replayed = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Replayed Disconnect",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          replay: true,
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "disconnected",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 7,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: "REPLAY_IGNORED",
        lastErrorMessage: "same hosted snapshot",
        lastSyncCompletedAt: "2026-04-07T01:30:00.000Z",
        lastSyncErrorAt: "2026-04-07T01:25:00.000Z",
        lastSyncStartedAt: "2026-04-07T01:20:00.000Z",
        lastWebhookAt: "2026-04-07T01:10:00.000Z",
        nextReconcileAt: "2026-04-07T06:00:00.000Z",
      },
      tokens: undefined,
    });

    assert.equal(replayed?.id, seeded.id);
    assert.equal(replayed?.status, "reauthorization_required");
    assert.equal(replayed?.displayName, "Local Fresh");
    assert.deepEqual(replayed?.metadata, {
      hosted: true,
      local: true,
    });
    assert.deepEqual(replayed?.scopes, ["offline", "manual"]);
    assert.equal(replayed?.hostedObservedUpdatedAt, "2026-04-07T01:00:00.000Z");
    assert.equal(replayed?.hostedObservedTokenVersion, 7);
    assert.equal(replayed?.accessTokenEncrypted, "enc:local-access-refresh");
    assert.equal(replayed?.refreshTokenEncrypted, "enc:local-refresh-refresh");
    assert.equal(replayed?.accessTokenExpiresAt, "2026-04-07T05:00:00.000Z");
    assert.equal(replayed?.nextReconcileAt, "2026-04-07T06:00:00.000Z");
    assert.equal(replayed?.lastErrorCode, "REPLAY_IGNORED");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store failJob requeues retryable jobs, dead-letters terminal jobs, and ignores missing work", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-fail-job");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-fail-job",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const retryableJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      kind: "retryable",
      payload: {},
      provider: "demo",
    });
    const claimedRetryableJob = store.claimDueJob("worker-a", "2026-04-07T00:00:00.000Z", 60_000);

    assert.equal(claimedRetryableJob?.id, retryableJob.id);

    store.failJob(
      retryableJob.id,
      "2026-04-07T00:01:00.000Z",
      "TEMPORARY_FAILURE",
      "retry later",
      "2026-04-07T00:05:00.000Z",
      true,
    );

    const requeuedJob = store.getJobById(retryableJob.id);
    assert.equal(requeuedJob?.status, "queued");
    assert.equal(requeuedJob?.availableAt, "2026-04-07T00:05:00.000Z");
    assert.equal(requeuedJob?.lastErrorCode, "TEMPORARY_FAILURE");
    assert.equal(requeuedJob?.lastErrorMessage, "retry later");

    const terminalJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:02:00.000Z",
      kind: "terminal",
      maxAttempts: 1,
      payload: {},
      provider: "demo",
    });
    const claimedTerminalJob = store.claimDueJob("worker-b", "2026-04-07T00:02:00.000Z", 60_000);

    assert.equal(claimedTerminalJob?.id, terminalJob.id);

    store.failJob(
      terminalJob.id,
      "2026-04-07T00:03:00.000Z",
      "TERMINAL_FAILURE",
      "stop retrying",
      null,
      true,
    );

    const deadJob = store.getJobById(terminalJob.id);
    assert.equal(deadJob?.status, "dead");
    assert.equal(deadJob?.lastErrorCode, "TERMINAL_FAILURE");
    assert.equal(deadJob?.lastErrorMessage, "stop retrying");

    store.completeJob(terminalJob.id, "2026-04-07T00:04:00.000Z");
    store.failJob(
      terminalJob.id,
      "2026-04-07T00:05:00.000Z",
      "IGNORED",
      "already complete",
      null,
      false,
    );
    assert.equal(store.getJobById(terminalJob.id)?.lastErrorCode, "TERMINAL_FAILURE");

    store.failJob(
      "missing-job",
      "2026-04-07T00:06:00.000Z",
      "MISSING",
      "missing",
      null,
      false,
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store wakes expired final-attempt leases and dead-letters them instead of stranding them", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-expired-final-attempt");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-expired-final-attempt",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const job = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      kind: "final-attempt",
      maxAttempts: 1,
      payload: {},
      provider: "demo",
    });

    const claimed = store.claimDueJob("worker-a", "2026-04-07T00:00:00.000Z", 60_000);
    assert.equal(claimed?.id, job.id);
    assert.equal(store.readNextJobWakeAt(), "2026-04-07T00:01:00.000Z");
    assert.equal(store.claimDueJob("worker-b", "2026-04-07T00:01:01.000Z", 60_000), null);

    const deadJob = store.getJobById(job.id);
    assert.equal(deadJob?.status, "dead");
    assert.equal(deadJob?.lastErrorCode, "LEASE_EXPIRED");
    assert.equal(deadJob?.lastErrorMessage, "Device sync job lease expired before completion.");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store ignores expired exhausted running rows for dedupe and reaps them before lower-priority follow-up claims", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-expired-final-attempt-dedupe");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-expired-final-attempt-dedupe",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const exhaustedJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: "reconcile:demo-expired-final-attempt-dedupe",
      kind: "final-attempt",
      maxAttempts: 1,
      payload: {},
      priority: 5,
      provider: "demo",
    });
    const claimed = store.claimDueJob("worker-a", "2026-04-07T00:00:00.000Z", 60_000);
    assert.equal(claimed?.id, exhaustedJob.id);

    const dedupedReplacement = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:01:01.000Z",
      dedupeKey: "reconcile:demo-expired-final-attempt-dedupe",
      kind: "replacement",
      payload: {},
      provider: "demo",
    });
    assert.notEqual(dedupedReplacement.id, exhaustedJob.id);

    store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:01:01.000Z",
      kind: "higher-priority-follow-up",
      payload: {},
      priority: 100,
      provider: "demo",
    });

    const firstAfterExpiry = store.claimDueJob("worker-b", "2026-04-07T00:01:01.000Z", 60_000);
    assert.equal(firstAfterExpiry?.kind, "higher-priority-follow-up");
    assert.equal(store.completeJobIfOwned(firstAfterExpiry!.id, "worker-b", "2026-04-07T00:01:30.000Z"), true);

    const exhaustedAfterClaim = store.getJobById(exhaustedJob.id);
    assert.equal(exhaustedAfterClaim?.status, "dead");
    assert.equal(exhaustedAfterClaim?.lastErrorCode, "LEASE_EXPIRED");

    const replacementJob = store.claimDueJob("worker-c", "2026-04-07T00:01:31.000Z", 60_000);
    assert.equal(replacementJob?.id, dedupedReplacement.id);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store reuses queued jobs with the same dedupe key", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-dedupe");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-dedupe",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const firstJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: "reconcile:demo",
      kind: "reconcile",
      payload: {
        full: true,
      },
      provider: "demo",
    });
    const duplicateJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T01:00:00.000Z",
      dedupeKey: "reconcile:demo",
      kind: "reconcile",
      payload: {
        full: false,
      },
      provider: "demo",
    });

    assert.equal(duplicateJob.id, firstJob.id);
    assert.deepEqual(duplicateJob.payload, {
      full: true,
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store bootstraps current tables even when stale legacy tables remain and consumes missing or expired OAuth state safely", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-legacy");
  const legacyDatabasePath = path.join(tempDir, "legacy.sqlite");
  const legacyDatabase = openSqliteRuntimeDatabase(legacyDatabasePath);
  legacyDatabase.exec(`
    create table device_account (
      id text primary key
    );
  `);
  legacyDatabase.close();

  const legacyStore = new SqliteDeviceSyncStore(legacyDatabasePath);
  legacyStore.close();

  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    assert.equal(store.deleteExpiredOAuthStates("2026-04-07T00:00:00.000Z"), 0);

    store.createOAuthState({
      state: "expired-state",
      provider: "demo",
      returnTo: "/devices",
      metadata: {},
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:00:10.000Z",
    });
    store.createOAuthState({
      state: "defaulted-state",
      provider: "demo",
      returnTo: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:02:00.000Z",
    });

    assert.deepEqual(store.consumeOAuthState("missing-state", "2026-04-07T00:01:00.000Z"), {
      status: "missing",
    });
    assert.deepEqual(store.consumeOAuthState("expired-state", "2026-04-07T00:01:00.000Z"), {
      status: "missing",
    });
    assert.deepEqual(store.consumeOAuthState("defaulted-state", "2026-04-07T00:01:00.000Z"), {
      status: "consumed",
      record: {
        state: "defaulted-state",
        provider: "demo",
        returnTo: null,
        metadata: {},
        createdAt: "2026-04-07T00:00:00.000Z",
        expiresAt: "2026-04-07T00:02:00.000Z",
      },
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store rejects pre-cutover sqlite user_version values", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-version");
  const databasePath = path.join(tempDir, "state.sqlite");
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec(`PRAGMA user_version = ${UNSUPPORTED_SCHEMA_VERSION};`);
  database.close();

  try {
    assert.throws(
      () => new SqliteDeviceSyncStore(databasePath),
      UNSUPPORTED_SCHEMA_VERSION_RE,
    );
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store fails closed when stored scopes_json is malformed", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-bad-scopes");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "oura",
      externalAccountId: "oura-user-bad-scopes",
      displayName: "Broken Scopes",
      scopes: ["daily"],
      tokens: {
        accessToken: "access-token",
        accessTokenEncrypted: "enc:access-token",
        refreshToken: "refresh-token",
        refreshTokenEncrypted: "enc:refresh-token",
      },
      metadata: {},
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    store.database
      .prepare("update device_connection set scopes_json = ? where id = ?")
      .run("{not-json", account.id);

    assert.throws(
      () => store.getAccountById(account.id),
      /device_connection\.scopes_json/u,
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store filters listed accounts by provider and returns unexpired OAuth state once", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-listing");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-account",
      displayName: "Demo Account",
      scopes: ["offline"],
      tokens: {
        accessToken: "demo-access",
        accessTokenEncrypted: "enc:demo-access",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    store.upsertAccount({
      provider: "oura",
      externalAccountId: "oura-account",
      displayName: "Oura Account",
      scopes: ["daily"],
      tokens: {
        accessToken: "oura-access",
        accessTokenEncrypted: "enc:oura-access",
      },
      connectedAt: "2026-04-07T01:00:00.000Z",
    });
    store.createOAuthState({
      state: "active-state",
      provider: "demo",
      returnTo: "/devices",
      metadata: {
        intent: "connect",
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:10:00.000Z",
    });

    assert.deepEqual(
      store.listAccounts().map((account) => account.provider),
      ["oura", "demo"],
    );
    assert.deepEqual(
      store.listAccounts("demo").map((account) => account.externalAccountId),
      ["demo-account"],
    );
    assert.deepEqual(store.consumeOAuthState("active-state", "2026-04-07T00:05:00.000Z"), {
      status: "consumed",
      record: {
        state: "active-state",
        provider: "demo",
        returnTo: "/devices",
        metadata: {
          intent: "connect",
        },
        createdAt: "2026-04-07T00:00:00.000Z",
        expiresAt: "2026-04-07T00:10:00.000Z",
      },
    });
    assert.deepEqual(store.consumeOAuthState("active-state", "2026-04-07T00:05:01.000Z"), {
      status: "missing",
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves unexpired OAuth state on provider mismatch", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-provider-mismatch");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    store.createOAuthState({
      state: "provider-mismatch-state",
      provider: "demo",
      returnTo: "/devices",
      metadata: {},
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:10:00.000Z",
    });

    assert.deepEqual(
      store.consumeOAuthState(
        "provider-mismatch-state",
        "2026-04-07T00:05:00.000Z",
        "oura",
      ),
      {
        status: "provider_mismatch",
        provider: "demo",
      },
    );
    assert.deepEqual(
      store.consumeOAuthState(
        "provider-mismatch-state",
        "2026-04-07T00:05:01.000Z",
        "demo",
      ),
      {
        status: "consumed",
        record: {
          state: "provider-mismatch-state",
          provider: "demo",
          returnTo: "/devices",
          metadata: {},
          createdAt: "2026-04-07T00:00:00.000Z",
          expiresAt: "2026-04-07T00:10:00.000Z",
        },
      },
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store hydrates new hosted accounts, guards token updates, and respects running-job ownership", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-insert");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const hydrated = store.hydrateHostedAccount({
      clearTokens: true,
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Insert",
        externalAccountId: "hosted-insert",
        metadata: {
          providerHint: "hosted",
        },
        provider: "demo",
        scopes: ["offline", "sleep"],
        status: "active",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 7,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: "OLD_ERROR",
        lastErrorMessage: "old",
        lastSyncCompletedAt: "2026-04-07T00:30:00.000Z",
        lastSyncErrorAt: "2026-04-07T00:20:00.000Z",
        lastSyncStartedAt: "2026-04-07T00:10:00.000Z",
        lastWebhookAt: "2026-04-07T00:05:00.000Z",
        nextReconcileAt: "2026-04-07T02:00:00.000Z",
      },
      tokens: {
        accessToken: "hosted-access",
        accessTokenEncrypted: "enc:hosted-access",
        accessTokenExpiresAt: "2026-04-07T03:00:00.000Z",
      },
    });

    assert.ok(hydrated);
    assert.equal(hydrated?.accessTokenEncrypted, "enc:hosted-access");
    assert.equal(hydrated?.refreshTokenEncrypted, null);
    assert.equal(hydrated?.accessTokenExpiresAt, "2026-04-07T03:00:00.000Z");
    assert.equal(hydrated?.hostedObservedTokenVersion, 7);
    assert.equal(hydrated?.updatedAt, "2026-04-07T01:00:00.000Z");
    assert.deepEqual(hydrated?.metadata, {
      providerHint: "hosted",
    });

    assert.throws(
      () => store.patchAccount("missing-account", {}),
      /Unknown account missing-account/u,
    );
    assert.equal(
      store.updateAccountTokens(
        hydrated!.id,
        {
          accessToken: "stale",
          accessTokenEncrypted: "enc:stale",
        },
        hydrated!.disconnectGeneration + 1,
      ),
      null,
    );
    assert.equal(
      store.markSyncSucceeded("missing-account", "2026-04-07T04:00:00.000Z"),
      false,
    );

    const job = store.enqueueJob({
      accountId: hydrated!.id,
      availableAt: "2026-04-07T01:00:00.000Z",
      kind: "hosted-sync",
      payload: {},
      provider: "demo",
    });
    const claimed = store.claimDueJob("worker-a", "2026-04-07T01:00:00.000Z", 60_000);

    assert.equal(claimed?.id, job.id);
    assert.equal(store.completeJobIfOwned(job.id, "worker-b", "2026-04-07T01:00:30.000Z"), false);
    assert.equal(store.completeJobIfOwned(job.id, "worker-a", "2026-04-07T01:01:00.000Z"), false);
    assert.equal(
      store.failJobIfOwned(
        job.id,
        "worker-a",
        "2026-04-07T01:01:00.000Z",
        "LEASE_EXPIRED",
        "stale worker should not transition expired leases",
        "2026-04-07T01:05:00.000Z",
        true,
      ),
      false,
    );
    assert.equal(store.getJobById(job.id)?.status, "running");
    assert.equal(store.readNextJobWakeAt(), "2026-04-07T01:01:00.000Z");

    const reclaimed = store.claimDueJob("worker-b", "2026-04-07T01:01:01.000Z", 60_000);
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.leaseOwner, "worker-b");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store updates existing accounts and rejects stale success writes", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-update-existing");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const created = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-existing",
      displayName: "Original",
      scopes: ["offline"],
      tokens: {
        accessToken: "original-access",
        accessTokenEncrypted: "enc:original-access",
        refreshToken: "original-refresh",
        refreshTokenEncrypted: "enc:original-refresh",
      },
      metadata: {
        original: true,
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T02:00:00.000Z",
    });

    const updated = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-existing",
      displayName: "Updated",
      status: "reauthorization_required",
      scopes: ["sleep"],
      tokens: {
        accessToken: "updated-access",
        accessTokenEncrypted: "enc:updated-access",
        accessTokenExpiresAt: "2026-04-07T03:00:00.000Z",
      },
      metadata: {
        fresh: true,
      },
      connectedAt: "2026-04-07T01:00:00.000Z",
      nextReconcileAt: "2026-04-07T04:00:00.000Z",
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.displayName, "Updated");
    assert.equal(updated.status, "reauthorization_required");
    assert.deepEqual(updated.scopes, ["sleep"]);
    assert.deepEqual(updated.metadata, {
      fresh: true,
    });
    assert.equal(updated.accessTokenEncrypted, "enc:updated-access");
    assert.equal(updated.refreshTokenEncrypted, null);
    assert.equal(updated.accessTokenExpiresAt, "2026-04-07T03:00:00.000Z");
    assert.equal(updated.nextReconcileAt, "2026-04-07T04:00:00.000Z");

    const reactivated = store.patchAccount(updated.id, {
      status: "active",
    });
    assert.equal(reactivated.status, "active");

    const refreshed = store.updateAccountTokens(
      updated.id,
      {
        accessToken: "fresh-access",
        accessTokenEncrypted: "enc:fresh-access",
        refreshToken: "fresh-refresh",
        refreshTokenEncrypted: "enc:fresh-refresh",
        accessTokenExpiresAt: "2026-04-07T05:00:00.000Z",
      },
      updated.disconnectGeneration,
    );

    assert.equal(refreshed?.accessTokenEncrypted, "enc:fresh-access");
    assert.equal(refreshed?.refreshTokenEncrypted, "enc:fresh-refresh");
    assert.equal(
      store.markSyncSucceeded(updated.id, "2026-04-07T06:00:00.000Z", updated.disconnectGeneration + 1),
      false,
    );
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
  const row = store.database.prepare(`
    select external_account_id, payload_json, processing_expires_at, status
    from webhook_trace
    where provider = ?
      and trace_id = ?
  `).get(provider, traceId);

  if (
    !row
    || typeof row !== "object"
    || typeof row.external_account_id !== "string"
    || typeof row.payload_json !== "string"
    || (row.processing_expires_at !== null && typeof row.processing_expires_at !== "string")
    || typeof row.status !== "string"
  ) {
    return null;
  }

  return {
    external_account_id: row.external_account_id,
    payload_json: row.payload_json,
    processing_expires_at: row.processing_expires_at,
    status: row.status,
  };
}

function normalizeWebhookTraceRow(row: WebhookTraceRow | null): WebhookTraceRow | null {
  return row ? { ...row } : null;
}
