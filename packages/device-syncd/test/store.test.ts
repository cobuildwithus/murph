import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

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

test("device sync store rejects legacy schemas and consumes missing or expired OAuth state safely", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-legacy");
  const legacyDatabasePath = path.join(tempDir, "legacy.sqlite");
  const legacyDatabase = openSqliteRuntimeDatabase(legacyDatabasePath);
  legacyDatabase.exec(`
    create table device_account (
      id text primary key
    );
  `);
  legacyDatabase.close();

  assert.throws(
    () => new SqliteDeviceSyncStore(legacyDatabasePath),
    /Unsupported legacy device-sync runtime schema detected/u,
  );

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

    assert.equal(store.consumeOAuthState("missing-state", "2026-04-07T00:01:00.000Z"), null);
    assert.equal(store.consumeOAuthState("expired-state", "2026-04-07T00:01:00.000Z"), null);
    assert.deepEqual(store.consumeOAuthState("defaulted-state", "2026-04-07T00:01:00.000Z"), {
      state: "defaulted-state",
      provider: "demo",
      returnTo: null,
      metadata: {},
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:02:00.000Z",
    });
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
      state: "active-state",
      provider: "demo",
      returnTo: "/devices",
      metadata: {
        intent: "connect",
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:10:00.000Z",
    });
    assert.equal(store.consumeOAuthState("active-state", "2026-04-07T00:05:01.000Z"), null);
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
