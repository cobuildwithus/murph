import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";
import { COMPANION_HRV_RMSSD_RESOURCE } from "@murphai/contracts";
import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

import { buildJunctionProviderSourceInstanceKey } from "../src/connect-config.ts";
import { DeviceSyncError } from "../src/errors.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
} from "../src/junction-historical-backfill-progress.ts";
import { DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE } from "../src/public-account.ts";
import { markCredentialScopedPendingDeviceSyncJobsDeadForAccount } from "../src/store/jobs.ts";
import { DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION } from "../src/store/schema.ts";
import { makeTempDirectory } from "./helpers.ts";
import {
  deleteConnectionForTesting,
  insertWebhookTraceRowForTesting,
  readCredentialStateForTesting,
  readObservationStateForTesting,
  readWebhookTraceLifecycleRowsForTesting,
  readWebhookTraceRowForTesting,
  setCredentialStateForTesting,
  setConnectionScopesJsonForTesting,
  setConnectionUpdatedAtForTesting,
} from "./store-test-helpers.ts";
import type { StoredDeviceSyncAccount } from "../src/types.ts";

function historyCoverageVersion(resource: string): number {
  const version = resolveJunctionExtendedTimeseriesHistoryBackfillVersion(resource);
  if (version === null) {
    throw new TypeError(`Expected an extended-history version for ${resource}.`);
  }
  return version;
}

const MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID = "_minimized_";
const UNSUPPORTED_SCHEMA_VERSION = DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION + 1;
const UNSUPPORTED_SCHEMA_VERSION_RE = new RegExp(
  `device sync runtime database schema version ${UNSUPPORTED_SCHEMA_VERSION} is newer than supported version ${DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION}`,
  "u",
);

function downgradeDeviceSyncStoreToV8(databasePath: string): void {
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec(`
    alter table device_connection_source drop column last_data_at;
    pragma user_version = 8;
  `);
  database.close();
}

function downgradeDeviceSyncStoreToV9(databasePath: string): void {
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec(`
    alter table device_connection_source drop column lifecycle_epoch;
    pragma user_version = 9;
  `);
  database.close();
}

function downgradeDeviceSyncStoreToV7(databasePath: string): void {
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec(`
    drop index device_connection_hosted_connection_id_idx;
    alter table device_connection drop column hosted_connection_id;
    pragma user_version = 7;
  `);
  database.close();
}

function insertConnectionSourceRowForTesting(
  store: SqliteDeviceSyncStore,
  input: {
    connectionId: string;
    displayName?: string | null;
    firstSeenAt: string;
    id: string;
    lastDataAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    lastSeenAt: string;
    lifecycleEpoch: number;
    resourceAvailabilitySummary?: Record<string, string | number | boolean | null>;
    sourceInstanceKey: string;
    sourceProviderSlug: string;
    status: "connected" | "unavailable" | "error" | "disconnected";
  },
): void {
  const database = openSqliteRuntimeDatabase(store.databasePath);
  try {
    database.prepare(`
      insert into device_connection_source (
        id, connection_id, source_instance_key, source_provider_slug,
        display_name, status, resource_availability_summary_json,
        last_error_code, last_error_message, lifecycle_epoch,
        first_seen_at, last_seen_at, last_data_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.connectionId,
      input.sourceInstanceKey,
      input.sourceProviderSlug,
      input.displayName ?? null,
      input.status,
      JSON.stringify(input.resourceAvailabilitySummary ?? {}),
      input.lastErrorCode ?? null,
      input.lastErrorMessage ?? null,
      input.lifecycleEpoch,
      input.firstSeenAt,
      input.lastSeenAt,
      input.lastDataAt ?? null,
      input.firstSeenAt,
      input.lastSeenAt,
    );
  } finally {
    database.close();
  }
}

function requireStoredOAuthCredential(
  account: StoredDeviceSyncAccount | null | undefined,
): Extract<StoredDeviceSyncAccount["credential"], { kind: "oauth_tokens" }> {
  assert.ok(account);
  assert.equal(account.credential.kind, "oauth_tokens");
  return account.credential;
}

function assertStoredCredentialKind(
  account: StoredDeviceSyncAccount | null | undefined,
  kind: StoredDeviceSyncAccount["credential"]["kind"],
): void {
  assert.ok(account);
  assert.equal(account.credential.kind, kind);
}

test("connection epoch cleanup preserves credential-independent queued and running imports", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-epoch-authority");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const oura = store.upsertAccount({
      connectedAt: "2026-07-27T04:00:00.000Z",
      displayName: "Oura",
      externalAccountId: "oura-epoch-authority",
      provider: "oura",
      scopes: [],
      status: "active",
      tokens: {
        accessToken: "oura-access-token",
        accessTokenEncrypted: "enc:oura-access-token",
      },
    });
    const runningDelete = store.enqueueJob({
      accountId: oura.id,
      availableAt: "2026-07-27T04:00:00.000Z",
      kind: "delete",
      payload: {
        dataType: "sleep",
        objectId: "deleted-sleep-running",
      },
      priority: 100,
      provider: "oura",
    });
    const queuedDelete = store.enqueueJob({
      accountId: oura.id,
      availableAt: "2026-07-27T04:00:00.000Z",
      kind: "delete",
      payload: {
        dataType: "sleep",
        objectId: "deleted-sleep-queued",
      },
      priority: 90,
      provider: "oura",
    });
    const credentialScoped = ["resource", "reconcile", "deauthorize"].map((kind, index) =>
      store.enqueueJob({
        accountId: oura.id,
        availableAt: "2026-07-27T04:00:00.000Z",
        kind,
        payload: { objectId: `credential-scoped-${kind}` },
        priority: 80 - index,
        provider: "oura",
      })
    );
    assert.equal(
      store.claimDueJob("epoch-worker", "2026-07-27T04:01:00.000Z", 60_000)?.id,
      runningDelete.id,
    );

    const database = openSqliteRuntimeDatabase(store.databasePath);
    try {
      assert.equal(markCredentialScopedPendingDeviceSyncJobsDeadForAccount(database, {
        accountId: oura.id,
        code: "HOSTED_CONNECTION_EPOCH_REPLACED",
        message: "Connection epoch changed.",
        now: "2026-07-27T04:02:00.000Z",
      }), credentialScoped.length);
    } finally {
      database.close();
    }

    assert.equal(store.getJobById(runningDelete.id)?.status, "running");
    assert.equal(store.getJobById(queuedDelete.id)?.status, "queued");
    for (const job of credentialScoped) {
      assert.equal(store.getJobById(job.id)?.status, "dead");
      assert.equal(
        store.getJobById(job.id)?.lastErrorCode,
        "HOSTED_CONNECTION_EPOCH_REPLACED",
      );
    }

    const epochBJob = store.enqueueJob({
      accountId: oura.id,
      availableAt: "2026-07-27T04:03:00.000Z",
      kind: "resource",
      payload: { objectId: "epoch-b-resource" },
      provider: "oura",
    });
    assert.equal(store.getJobById(epochBJob.id)?.status, "queued");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store minimizes webhook trace payload retention without changing claim or completion state", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-1",
        externalAccountId: "acct-1",
        claimedAt: "2099-04-01T00:00:00.000Z",
        claimToken: "claim-1",
        eventType: "sleep.updated",
        receivedAt: "2099-04-01T00:00:00.000Z",
        processingExpiresAt: "2099-04-01T00:01:00.000Z",
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRowForTesting(store, "oura", "trace-1")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      payload_json: "{}",
      processing_expires_at: "2099-04-01T00:01:00.000Z",
      status: "processing",
    });

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-1",
        externalAccountId: "acct-1",
        claimedAt: "2099-04-01T00:02:00.000Z",
        claimToken: "claim-2",
        eventType: "sleep.updated",
        receivedAt: "2099-04-01T00:02:00.000Z",
        processingExpiresAt: "2099-04-01T00:03:00.000Z",
      }),
      "claimed",
    );

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRowForTesting(store, "oura", "trace-1")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      payload_json: "{}",
      processing_expires_at: "2099-04-01T00:03:00.000Z",
      status: "processing",
    });

    store.completeWebhookTrace("oura", "trace-1", "claim-2");

    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRowForTesting(store, "oura", "trace-1")), {
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

test("device sync store rolls back webhook jobs when the trace claim was lost", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-webhook-claim-lost");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
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
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-race",
        externalAccountId: "oura-user-1",
        claimedAt: "2026-04-07T00:00:00.000Z",
        claimToken: "claim-old",
        eventType: "sleep.updated",
        receivedAt: "2026-04-07T00:00:00.000Z",
        processingExpiresAt: "2026-04-07T00:01:00.000Z",
      }),
      "claimed",
    );
    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-race",
        externalAccountId: "oura-user-1",
        claimedAt: "2026-04-07T00:02:00.000Z",
        claimToken: "claim-new",
        eventType: "sleep.updated",
        receivedAt: "2026-04-07T00:02:00.000Z",
        processingExpiresAt: "2026-04-07T00:03:00.000Z",
      }),
      "claimed",
    );

    assert.throws(() =>
      store.enqueueJobsAndCompleteWebhookTrace({
        accountId: account.id,
        provider: "oura",
        traceId: "trace-race",
        claimToken: "claim-old",
        jobs: [
          {
            kind: "reconcile",
            payload: {},
          },
        ],
      }),
    );

    assert.equal(store.claimDueJob("worker-a", "2026-04-07T00:02:30.000Z", 60_000), null);
    assert.deepEqual(normalizeWebhookTraceRow(readWebhookTraceRowForTesting(store, "oura", "trace-race")), {
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      payload_json: "{}",
      processing_expires_at: "2026-04-07T00:03:00.000Z",
      status: "processing",
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves failed calendar work across a later correction", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-calendar-obligations");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-calendar-obligations",
      displayName: "Junction",
      scopes: [],
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-04-01T00:00:00.000Z",
    });
    const workerId = "calendar-obligation-worker";
    const v2 = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-04T00:00:00.000Z",
      kind: "resource",
      payload: { resource: "water", revision: "v2" },
      priority: 100,
      provider: "junction",
    });
    assert.equal(
      store.claimDueJob(workerId, "2026-04-04T00:01:00.000Z", 60_000)?.id,
      v2.id,
    );
    assert.equal(store.completeJobsMarkSyncSucceededAndEnqueueJobs({
      accountId: account.id,
      completedAt: "2026-04-04T00:01:10.000Z",
      disconnectGeneration: account.disconnectGeneration,
      jobIds: [v2.id],
      jobs: [{
        availableAt: "2026-04-04T00:01:10.000Z",
        dedupeKey: "calendar-water-2026-04-01",
        kind: "resource",
        payload: { calendarRefreshDay: "2026-04-01", resource: "water" },
        priority: 61,
      }, {
        availableAt: "2026-04-04T00:01:10.000Z",
        dedupeKey: "calendar-water-2026-04-02",
        kind: "resource",
        payload: { calendarRefreshDay: "2026-04-02", resource: "water" },
        priority: 60,
      }],
      provider: "junction",
      syncSucceededAt: "2026-04-04T00:01:00.000Z",
      syncSuccessOptions: { localConnectionRevision: account.localConnectionRevision },
      workerId,
    }), true);

    const failedDayOne = store.claimDueJob(
      workerId,
      "2026-04-04T00:02:00.000Z",
      60_000,
    );
    assert.equal(failedDayOne?.payload.calendarRefreshDay, "2026-04-01");
    assert.deepEqual(store.failJobIfOwned(
      failedDayOne!.id,
      workerId,
      "2026-04-04T00:02:10.000Z",
      "JUNCTION_RETRYABLE",
      "Calendar fetch failed.",
      "2026-04-05T00:00:00.000Z",
      true,
    ), {
      attempts: 1,
      disposition: "queued",
      maxAttempts: 5,
      remainingAttempts: 4,
    });
    const afterV2 = store.getAccountById(account.id);
    assert.ok(afterV2);

    const v3 = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-04T00:03:00.000Z",
      kind: "resource",
      payload: { resource: "water", revision: "v3" },
      priority: 100,
      provider: "junction",
    });
    assert.equal(
      store.claimDueJob(workerId, "2026-04-04T00:04:00.000Z", 60_000)?.id,
      v3.id,
    );
    assert.equal(store.completeJobsMarkSyncSucceededAndEnqueueJobs({
      accountId: account.id,
      completedAt: "2026-04-04T00:04:10.000Z",
      disconnectGeneration: afterV2.disconnectGeneration,
      jobIds: [v3.id],
      jobs: [{
        availableAt: "2026-04-04T00:04:10.000Z",
        dedupeKey: "calendar-water-2026-04-02",
        kind: "resource",
        payload: { calendarRefreshDay: "2026-04-02", resource: "water" },
        priority: 60,
      }, {
        availableAt: "2026-04-04T00:04:10.000Z",
        dedupeKey: "calendar-water-2026-04-03",
        kind: "resource",
        payload: { calendarRefreshDay: "2026-04-03", resource: "water" },
        priority: 60,
      }],
      provider: "junction",
      syncSucceededAt: "2026-04-04T00:04:00.000Z",
      syncSuccessOptions: { localConnectionRevision: afterV2.localConnectionRevision },
      workerId,
    }), true);

    const dayTwo = store.claimDueJob(workerId, "2026-04-04T00:05:00.000Z", 60_000);
    assert.equal(dayTwo?.payload.calendarRefreshDay, "2026-04-02");
    assert.equal(store.completeJobIfOwned(dayTwo!.id, workerId, "2026-04-04T00:05:10.000Z"), true);
    const dayThree = store.claimDueJob(workerId, "2026-04-04T00:06:00.000Z", 60_000);
    assert.equal(dayThree?.payload.calendarRefreshDay, "2026-04-03");
    assert.equal(store.completeJobIfOwned(dayThree!.id, workerId, "2026-04-04T00:06:10.000Z"), true);
    assert.equal(store.claimDueJob(workerId, "2026-04-04T23:59:59.000Z", 60_000), null);
    const retriedDayOne = store.claimDueJob(
      workerId,
      "2026-04-05T00:00:00.000Z",
      60_000,
    );
    assert.equal(retriedDayOne?.id, failedDayOne?.id);
    assert.equal(retriedDayOne?.payload.calendarRefreshDay, "2026-04-01");
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("device sync store commits source admission with initial jobs atomically", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-connection-admission");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-user-1",
      displayName: "Junction",
      scopes: [],
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-07-28T10:00:00.000Z",
    });
    const source = {
      connectionId: account.id,
      sourceInstanceKey: "junction-source-garmin",
      sourceProviderSlug: "garmin",
      status: "disconnected" as const,
      firstSeenAt: "2026-07-28T10:00:00.000Z",
      lastSeenAt: "2026-07-28T10:00:00.000Z",
    };
    store.upsertConnectionSource(source);
    const coverage = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata: account.metadata,
      providerSlug: "garmin",
      resource: "note",
      version: historyCoverageVersion("note"),
    });
    assert.ok(coverage);
    store.patchAccount(account.id, {
      metadata: { ...account.metadata, [coverage.metadataKey]: coverage.value },
    });
    const revisionBeforeStaleAdmission = store.getAccountById(account.id)?.localConnectionRevision;

    store.upsertConnectionSource({
      ...source,
      lastSeenAt: "2026-07-28T10:00:30.000Z",
    });
    const stale = store.commitConnectionEstablished({
      accountId: account.id,
      expectedSourceLastSeenAt: source.lastSeenAt,
      provider: account.provider,
      source: {
        ...source,
        status: "connected",
        lastSeenAt: "2026-07-28T10:01:00.000Z",
      },
      jobs: [{
        availableAt: "2026-07-28T10:01:00.000Z",
        kind: "reconcile",
        payload: {},
      }],
    });
    assert.equal(stale, null);
    assert.equal(store.listConnectionSources({ connectionId: account.id })[0]?.status, "disconnected");
    assert.equal(store.listConnectionSources({ connectionId: account.id })[0]?.lifecycleEpoch, 1);
    assert.equal(
      store.getAccountById(account.id)?.localConnectionRevision,
      revisionBeforeStaleAdmission,
    );
    assert.equal(
      hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
        store.getAccountById(account.id)?.metadata ?? {},
        "garmin",
        "note",
        historyCoverageVersion("note"),
      ),
      true,
    );
    assert.equal(store.claimDueJob("worker-a", "2026-07-28T10:02:00.000Z", 60_000), null);

    const circularPayload: Record<string, unknown> = {};
    circularPayload.self = circularPayload;
    assert.throws(() =>
      store.commitConnectionEstablished({
        accountId: account.id,
        expectedSourceLastSeenAt: "2026-07-28T10:00:30.000Z",
        provider: account.provider,
        source: {
          ...source,
          status: "connected",
          lastSeenAt: "2026-07-28T10:01:00.000Z",
        },
        jobs: [{
          availableAt: "2026-07-28T10:01:00.000Z",
          kind: "reconcile",
          payload: circularPayload,
        }],
      }),
    );
    assert.equal(
      store.listConnectionSources({ connectionId: account.id })[0]?.status,
      "disconnected",
    );
    assert.equal(
      store.listConnectionSources({ connectionId: account.id })[0]?.lifecycleEpoch,
      1,
    );
    assert.equal(
      store.getAccountById(account.id)?.localConnectionRevision,
      revisionBeforeStaleAdmission,
    );
    assert.equal(
      store.claimDueJob("worker-a", "2026-07-28T10:02:00.000Z", 60_000),
      null,
    );

    const committed = store.commitConnectionEstablished({
      accountId: account.id,
      expectedSourceLastSeenAt: "2026-07-28T10:00:30.000Z",
      provider: account.provider,
      source: {
        ...source,
        status: "connected",
        lastSeenAt: "2026-07-28T10:03:00.000Z",
      },
      jobs: [{
        availableAt: "2026-07-28T10:03:00.000Z",
        kind: "reconcile",
        payload: {},
      }],
    });
    assert.ok(committed);
    assert.equal(committed.length, 1);
    assert.equal(
      store.listConnectionSources({ connectionId: account.id })[0]?.status,
      "connected",
    );
    assert.equal(
      store.listConnectionSources({ connectionId: account.id })[0]?.lifecycleEpoch,
      2,
    );
    assert.equal(
      store.getAccountById(account.id)?.localConnectionRevision,
      (revisionBeforeStaleAdmission ?? 0) + 1,
    );
    assert.equal(
      store.claimDueJob("worker-a", "2026-07-28T10:04:00.000Z", 60_000)?.id,
      committed[0]?.id,
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves legacy Junction identity and reconnects one merged lifecycle", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-junction-canonical-source");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-canonical-source-account",
      displayName: "Junction",
      scopes: [],
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-07-28T09:00:00.000Z",
    });
    const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
    });
    assert.ok(canonicalSourceInstanceKey);

    const sibling = store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: "legacy-garmin-key",
      sourceProviderSlug: "garmin",
      status: "connected",
      firstSeenAt: "2026-07-28T09:00:00.000Z",
      lastSeenAt: "2026-07-28T09:30:00.000Z",
      resourceAvailabilitySummary: { activity: true },
    });
    insertConnectionSourceRowForTesting(store, {
      connectionId: account.id,
      firstSeenAt: "2026-07-27T08:00:00.000Z",
      id: "dcs_legacy_apple_health",
      lastSeenAt: "2026-07-28T10:00:00.000Z",
      lifecycleEpoch: 2,
      resourceAvailabilitySummary: { activity: true },
      sourceInstanceKey: "legacy-apple-health-key",
      sourceProviderSlug: "apple_health",
      status: "connected",
    });
    const legacyAuthority = store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0];
    assert.ok(legacyAuthority);
    assert.equal(legacyAuthority?.id, "dcs_legacy_apple_health");
    assert.equal(legacyAuthority?.sourceInstanceKey, "legacy-apple-health-key");
    assert.equal(legacyAuthority?.sourceProviderSlug, "apple_health");
    assert.equal(legacyAuthority?.lifecycleEpoch, 2);
    assert.equal(
      store.markConnectionSourceDataReceived({
        connectionId: account.id,
        now: "2026-07-28T10:00:30.000Z",
        sourceProviderSlug: "apple_healthkit",
      }),
      1,
    );
    assert.equal(store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health",
    })[0]?.lastDataAt, "2026-07-28T10:00:30.000Z");
    const aliasOnly = store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: legacyAuthority.sourceInstanceKey,
      sourceProviderSlug: legacyAuthority.sourceProviderSlug,
      status: "connected",
      lastSeenAt: "2026-07-28T10:01:00.000Z",
    });
    assert.equal(aliasOnly.id, "dcs_legacy_apple_health");
    assert.equal(aliasOnly.sourceInstanceKey, "legacy-apple-health-key");
    assert.equal(aliasOnly.sourceProviderSlug, "apple_health");
    assert.equal(aliasOnly.lifecycleEpoch, 2);

    store.upsertConnectionSource({
      connectionId: account.id,
      firstSeenAt: "2026-07-27T08:00:00.000Z",
      lastDataAt: "2026-07-28T09:30:00.000Z",
      lastSeenAt: "2026-07-28T10:02:00.000Z",
      lifecycleEpoch: 3,
      resourceAvailabilitySummary: { activity: true },
      sourceInstanceKey: canonicalSourceInstanceKey,
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
    });
    insertConnectionSourceRowForTesting(store, {
      connectionId: account.id,
      firstSeenAt: "2026-07-26T08:00:00.000Z",
      id: "dcs_lower_epoch_apple_health",
      lastDataAt: "2026-07-28T09:45:00.000Z",
      lastSeenAt: "2026-07-28T10:04:00.000Z",
      lifecycleEpoch: 2,
      resourceAvailabilitySummary: { sleep: true },
      sourceInstanceKey: "lower-epoch-apple-health-key",
      sourceProviderSlug: "apple_health",
      status: "error",
    });
    insertConnectionSourceRowForTesting(store, {
      connectionId: account.id,
      firstSeenAt: "2026-07-28T08:45:00.000Z",
      id: "dcs_alias_apple_healthkit",
      lastDataAt: "2026-07-28T09:40:00.000Z",
      lastSeenAt: "2026-07-28T10:05:00.000Z",
      lifecycleEpoch: 3,
      resourceAvailabilitySummary: { workouts: true },
      sourceInstanceKey: "legacy-apple-healthkit-key",
      sourceProviderSlug: "apple_healthkit",
      status: "disconnected",
    });

    const preCollapseAuthority = store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health",
    })[0];
    assert.equal(preCollapseAuthority?.status, "disconnected");
    assert.equal(preCollapseAuthority?.lifecycleEpoch, 3);
    assert.equal(preCollapseAuthority?.firstSeenAt, "2026-07-26T08:00:00.000Z");
    assert.equal(preCollapseAuthority?.lastSeenAt, "2026-07-28T10:05:00.000Z");
    assert.deepEqual(store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
      status: "connected",
    }), []);
    assert.equal(
      store.markConnectionSourceDataReceived({
        connectionId: account.id,
        now: "2026-07-28T10:05:30.000Z",
        sourceProviderSlug: "apple_health",
      }),
      3,
    );
    const authorityAfterArrival = store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0];
    assert.equal(authorityAfterArrival?.lastDataAt, "2026-07-28T10:05:30.000Z");
    assert.equal(authorityAfterArrival?.updatedAt, "2026-07-28T10:05:30.000Z");

    const collapsed = store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: "ignored-alias-write-key",
      sourceProviderSlug: "apple_health",
      status: "connected",
      lastSeenAt: "2026-07-28T10:06:00.000Z",
    }, { preserveDisconnected: true });

    assert.equal(collapsed.id, "dcs_lower_epoch_apple_health");
    assert.equal(collapsed.sourceInstanceKey, "lower-epoch-apple-health-key");
    assert.equal(collapsed.sourceProviderSlug, "apple_health");
    assert.equal(collapsed.lifecycleEpoch, 3);
    assert.equal(collapsed.status, "disconnected");
    assert.equal(collapsed.firstSeenAt, "2026-07-26T08:00:00.000Z");
    assert.equal(collapsed.lastSeenAt, "2026-07-28T10:05:00.000Z");
    assert.equal(collapsed.lastDataAt, "2026-07-28T10:05:30.000Z");
    assert.equal(collapsed.updatedAt, "2026-07-28T10:05:30.000Z");
    assert.deepEqual(collapsed.resourceAvailabilitySummary, {
      activity: true,
      workouts: true,
      sleep: true,
    });
    assert.equal(store.listConnectionSources({ connectionId: account.id }).length, 4);

    store.upsertConnectionSource({
      connectionId: account.id,
      sourceInstanceKey: "second-ignored-alias-key",
      sourceProviderSlug: "apple_health",
      status: "disconnected",
      firstSeenAt: collapsed.firstSeenAt,
      lastSeenAt: "2026-07-28T10:06:00.000Z",
    });
    const revisionBeforeCallbacks = store.getAccountById(account.id)?.localConnectionRevision;
    const stale = store.commitConnectionEstablished({
      accountId: account.id,
      expectedSourceLastSeenAt: "2026-07-28T10:05:00.000Z",
      provider: "junction",
      source: {
        connectionId: account.id,
        sourceInstanceKey: "stale-alias-callback-key",
        sourceProviderSlug: "apple_healthkit",
        status: "connected",
        firstSeenAt: collapsed.firstSeenAt,
        lastSeenAt: "2026-07-28T10:07:00.000Z",
      },
      jobs: [{
        availableAt: "2026-07-28T10:07:00.000Z",
        kind: "reconcile",
        payload: {},
      }],
    });
    assert.equal(stale, null);
    const afterStale = store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0];
    assert.equal(afterStale?.lastSeenAt, "2026-07-28T10:06:00.000Z");
    assert.equal(afterStale?.lifecycleEpoch, 3);
    assert.equal(store.getAccountById(account.id)?.localConnectionRevision, revisionBeforeCallbacks);
    assert.equal(store.listPendingJobsForAccount(account.id, 20).length, 0);

    const committed = store.commitConnectionEstablished({
      accountId: account.id,
      expectedSourceLastSeenAt: "2026-07-28T10:06:00.000Z",
      provider: "junction",
      source: {
        connectionId: account.id,
        sourceInstanceKey: "current-alias-callback-key",
        sourceProviderSlug: "apple_health",
        status: "connected",
        firstSeenAt: collapsed.firstSeenAt,
        lastSeenAt: "2026-07-28T10:08:00.000Z",
      },
      jobs: [{
        availableAt: "2026-07-28T10:08:00.000Z",
        kind: "reconcile",
        payload: {},
      }],
    });
    assert.equal(committed?.length, 1);
    const reconnected = store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "apple_health_kit",
    })[0];
    assert.equal(reconnected?.status, "connected");
    assert.equal(reconnected?.lifecycleEpoch, 4);
    assert.equal(
      store.getAccountById(account.id)?.localConnectionRevision,
      (revisionBeforeCallbacks ?? 0) + 1,
    );
    assert.deepEqual(store.listConnectionSources({
      connectionId: account.id,
      sourceProviderSlug: "garmin",
    })[0], sibling);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves current Junction disconnect fences independent of alias row order", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-junction-source-fence");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    for (const order of ["canonical-first", "alias-first"] as const) {
      const account = store.upsertAccount({
        provider: "junction",
        externalAccountId: `junction-source-fence-${order}`,
        displayName: "Junction",
        scopes: [],
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        connectedAt: "2026-07-29T09:00:00.000Z",
      });
      const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: account.id,
        sourceProviderSlug: "apple_health_kit",
      });
      assert.ok(canonicalSourceInstanceKey);
      const canonical = {
        connectionId: account.id,
        firstSeenAt: "2026-07-29T09:00:00.000Z",
        id: `dcs_${order}_canonical`,
        lastSeenAt: "2026-07-29T10:01:00.000Z",
        lifecycleEpoch: 4,
        sourceInstanceKey: canonicalSourceInstanceKey,
        sourceProviderSlug: "apple_health_kit",
        status: "connected" as const,
      };
      const fencedAlias = {
        connectionId: account.id,
        firstSeenAt: "2026-07-29T09:00:00.000Z",
        id: `dcs_${order}_alias`,
        lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
        lastErrorMessage: "Reconnect required.",
        lastSeenAt: "2026-07-29T10:00:00.000Z",
        lifecycleEpoch: 4,
        sourceInstanceKey: `legacy-${order}-alias`,
        sourceProviderSlug: "apple_health",
        status: "connected" as const,
      };

      for (const row of order === "canonical-first"
        ? [canonical, fencedAlias]
        : [fencedAlias, canonical]) {
        insertConnectionSourceRowForTesting(store, row);
      }

      const projected = store.listConnectionSources({
        connectionId: account.id,
        sourceProviderSlug: "apple_healthkit",
      })[0];
      assert.equal(projected?.status, "connected");
      assert.equal(projected?.lastErrorCode, DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE);
      assert.equal(projected?.lastErrorMessage, "Reconnect required.");

      const collapsed = store.upsertConnectionSource({
        connectionId: account.id,
        lastSeenAt: "2026-07-29T10:02:00.000Z",
        sourceInstanceKey: "ignored-provider-key",
        sourceProviderSlug: "apple_health_kit",
        status: "connected",
      }, { preserveDisconnected: true });
      assert.equal(collapsed.lastErrorCode, DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE);
      assert.equal(collapsed.lastErrorMessage, "Reconnect required.");
      assert.equal(store.listConnectionSources({ connectionId: account.id }).length, 2);
    }
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store migrates existing v9 sources to lifecycle epoch one", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-v9-migration");
  const databasePath = path.join(tempDir, "state.sqlite");

  try {
    let store = new SqliteDeviceSyncStore(databasePath);
    const connection = store.upsertAccount({
      connectedAt: "2026-07-01T00:00:00.000Z",
      credential: { kind: "none" },
      displayName: "Aggregator",
      externalAccountId: "aggregator-lifecycle-account",
      metadata: {},
      provider: "aggregator",
      scopes: [],
    });
    store.upsertConnectionSource({
      connectionId: connection.id,
      lastSeenAt: "2026-07-01T00:00:00.000Z",
      sourceInstanceKey: "src_garmin_lifecycle",
      sourceProviderSlug: "garmin",
      status: "connected",
    });
    store.close();

    downgradeDeviceSyncStoreToV9(databasePath);

    store = new SqliteDeviceSyncStore(databasePath);
    const [migrated] = store.listConnectionSources({ connectionId: connection.id });
    assert.equal(migrated?.lifecycleEpoch, 1);

    const advanced = store.upsertConnectionSource({
      connectionId: connection.id,
      lastSeenAt: "2026-07-02T00:00:00.000Z",
      lifecycleEpoch: 2,
      sourceInstanceKey: "src_garmin_lifecycle",
      sourceProviderSlug: "garmin",
      status: "connected",
    });
    assert.equal(advanced.lifecycleEpoch, 2);
    assert.equal(store.upsertConnectionSource({
      connectionId: connection.id,
      lastSeenAt: "2026-07-03T00:00:00.000Z",
      sourceInstanceKey: "src_garmin_lifecycle",
      sourceProviderSlug: "garmin",
      status: "connected",
    }).lifecycleEpoch, 2);

    const disconnected = store.upsertConnectionSource({
      connectionId: connection.id,
      lastSeenAt: "2026-07-04T00:00:00.000Z",
      lifecycleEpoch: 2,
      sourceInstanceKey: "src_garmin_lifecycle",
      sourceProviderSlug: "garmin",
      status: "disconnected",
    });
    const preserved = store.upsertConnectionSource({
      connectionId: connection.id,
      lastSeenAt: "2026-07-05T00:00:00.000Z",
      lifecycleEpoch: 2,
      sourceInstanceKey: "src_garmin_lifecycle",
      sourceProviderSlug: "garmin",
      status: "disconnected",
    }, { preserveDisconnected: true });
    assert.deepEqual(preserved, disconnected);
    store.close();
  } finally {
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
    insertWebhookTraceRowForTesting(store, {
      provider: "oura",
      traceId: "trace-old-processed",
      externalAccountId: "legacy-acct",
      eventType: "sleep.updated",
      receivedAt: "2025-01-01T00:00:00.000Z",
      status: "processed",
    });

    assert.equal(
      store.claimWebhookTrace({
        provider: "oura",
        traceId: "trace-new",
        externalAccountId: "acct-1",
        claimedAt: "2026-04-01T00:00:00.000Z",
        claimToken: "claim-prune",
        eventType: "sleep.updated",
        receivedAt: "2026-04-01T00:00:00.000Z",
        processingExpiresAt: "2026-04-01T00:01:00.000Z",
      }),
      "claimed",
    );

    const remainingTraceIds = readWebhookTraceLifecycleRowsForTesting(store, "oura").map((row) => row.trace_id);

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
    const hydratedOAuthCredential = requireStoredOAuthCredential(hydrated);
    assert.equal(hydratedOAuthCredential.accessTokenEncrypted, "enc:access-token");
    assert.equal(hydratedOAuthCredential.refreshTokenEncrypted, "enc:refresh-token");
    assert.deepEqual(hydrated?.metadata, {
      attempts: 2,
    });
    assert.equal(hydrated?.hostedObservedTokenVersion, 4);
    assert.equal(hydrated?.disconnectGeneration, 0);

    const disconnected = store.hydrateHostedAccount({
      credential: {
        kind: "none",
      },
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

    assertStoredCredentialKind(disconnected, "none");
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
    const reconnectedOAuthCredential = requireStoredOAuthCredential(reconnected);
    assert.equal(reconnectedOAuthCredential.accessTokenEncrypted, "enc:reconnected-access-token");
    assert.equal(reconnectedOAuthCredential.refreshTokenEncrypted, "enc:reconnected-refresh-token");
    assert.equal(reconnected?.hostedObservedTokenVersion, 1);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store keeps one hosted account when terminal privacy scrubbing changes provider identity", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-hosted-identity-scrub");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      connectedAt: "2026-07-13T01:00:00.000Z",
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      displayName: "Junction",
      externalAccountId: "junction-account-before-scrub",
      provider: "junction",
      scopes: [],
      status: "active",
    });
    const localState = {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
    };

    const active = store.hydrateHostedAccount({
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connection: {
        connectedAt: "2026-07-13T01:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-account-before-scrub",
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "active",
        updatedAt: "2026-07-13T01:01:00.000Z",
      },
      hostedConnectionId: "hosted-connection-stable-1",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T01:01:00.000Z",
      localState,
    });
    const disconnected = store.hydrateHostedAccount({
      credential: {
        credentialMetadata: {},
        kind: "none",
      },
      connection: {
        connectedAt: "2026-07-13T01:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "opaque:hosted-connection-stable-1",
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "disconnected",
        updatedAt: "2026-07-13T01:02:00.000Z",
      },
      hostedConnectionId: "hosted-connection-stable-1",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T01:02:00.000Z",
      localState,
    });

    assert.equal(active?.id, account.id);
    assert.equal(disconnected?.id, account.id);
    assert.equal(disconnected?.externalAccountId, "opaque:hosted-connection-stable-1");
    assert.equal(disconnected?.status, "disconnected");
    assert.equal(store.listAccounts().length, 1);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store rejects ambiguous legacy and bound hosted identity collisions", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-hosted-identity-collision");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const createAccount = (externalAccountId: string) => store.upsertAccount({
      connectedAt: "2026-07-13T01:00:00.000Z",
      credential: {
        credentialMetadata: {},
        kind: "provider_config" as const,
        providerConfigKey: "junction",
      },
      displayName: "Junction",
      externalAccountId,
      provider: "junction",
      scopes: [],
      status: "active",
    });
    const first = createAccount("junction-account-first");
    const second = createAccount("junction-account-second");
    const localState = {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
    };
    const credential = {
      credentialMetadata: {},
      kind: "provider_config" as const,
      providerConfigKey: "junction",
    };

    assert.throws(
      () => store.hydrateHostedAccount({
        credential: {
          credentialMetadata: {},
          kind: "none",
        },
        connection: {
          connectedAt: "2026-07-13T01:00:00.000Z",
          displayName: "Junction",
          externalAccountId: "opaque:hosted-connection-ambiguous",
          metadata: {},
          provider: "junction",
          scopes: [],
          status: "disconnected",
          updatedAt: "2026-07-13T01:00:30.000Z",
        },
        hostedConnectionId: "hosted-connection-ambiguous",
        hostedObservedTokenVersion: null,
        hostedObservedUpdatedAt: "2026-07-13T01:00:30.000Z",
        localState,
      }),
      /legacy connection identity is ambiguous/u,
    );
    assert.equal(store.getAccountByHostedConnectionId("hosted-connection-ambiguous"), null);

    store.hydrateHostedAccount({
      credential,
      connection: {
        connectedAt: "2026-07-13T01:00:00.000Z",
        displayName: "Junction",
        externalAccountId: first.externalAccountId,
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "active",
        updatedAt: "2026-07-13T01:01:00.000Z",
      },
      hostedConnectionId: "hosted-connection-collision",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T01:01:00.000Z",
      localState,
    });

    assert.throws(
      () => store.hydrateHostedAccount({
        credential,
        connection: {
          connectedAt: "2026-07-13T02:00:00.000Z",
          displayName: "Wrong reconnect",
          externalAccountId: first.externalAccountId,
          metadata: {},
          provider: "junction",
          scopes: [],
          status: "active",
          updatedAt: "2026-07-13T02:01:00.000Z",
        },
        hostedConnectionId: "hosted-connection-reconnect-collision",
        hostedObservedTokenVersion: null,
        hostedObservedUpdatedAt: "2026-07-13T02:01:00.000Z",
        localState,
      }),
      /bound to another hosted connection/u,
    );
    assert.equal(store.getAccountById(first.id)?.displayName, "Junction");
    assert.equal(store.getAccountById(first.id)?.connectedAt, "2026-07-13T01:00:00.000Z");

    const unbound = createAccount("junction-account-unbound-epoch");
    const adopted = store.hydrateHostedAccount({
      credential,
      connection: {
        connectedAt: "2026-07-13T03:00:00.000Z",
        displayName: "Hosted unbound account",
        externalAccountId: unbound.externalAccountId,
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "active",
        updatedAt: "2026-07-13T03:01:00.000Z",
      },
      hostedConnectionId: "hosted-connection-unbound",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T03:01:00.000Z",
      localState,
    });
    assert.equal(adopted?.id, unbound.id);
    assert.equal(adopted?.connectedAt, "2026-07-13T03:00:00.000Z");
    assert.equal(store.getAccountByHostedConnectionId("hosted-connection-unbound")?.id, unbound.id);

    assert.throws(
      () => store.hydrateHostedAccount({
        credential,
        connection: {
          connectedAt: "2026-07-13T01:00:00.000Z",
          displayName: "Junction",
          externalAccountId: second.externalAccountId,
          metadata: {},
          provider: "junction",
          scopes: [],
          status: "active",
          updatedAt: "2026-07-13T01:02:00.000Z",
        },
        hostedConnectionId: "hosted-connection-collision",
        hostedObservedTokenVersion: null,
        hostedObservedUpdatedAt: "2026-07-13T01:02:00.000Z",
        localState,
      }),
      /identity conflicts with another local account/u,
    );

    assert.equal(
      store.getAccountByHostedConnectionId("hosted-connection-collision")?.id,
      first.id,
    );
    assert.equal(store.getAccountById(second.id)?.externalAccountId, second.externalAccountId);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store stores provider-config and none credentials without token bundles", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-provider-config");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const providerConfigAccount = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-user-hash",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        subject: {
          account: "raw-account",
          accountHashedId: "raw-account-id",
          accountIdentifier: "raw-account-identifier",
          athleteId: "raw-athlete-id",
          authHeader: "Bearer subject-auth-token",
          client: "raw-client",
          clientUserId: "raw-client-user-id",
          clientUserIdHash: "client-user-id-hash",
          credential: "credential-material",
          external: "raw-external",
          externalAccount: "raw-external-account",
          externalAccountRawId: "raw-external-account-id",
          externalIdentifier: "raw-external-identifier",
          member: "raw-member",
          memberIdentifier: "raw-member-identifier",
          memberId: "raw-member-id",
          owner: "raw-owner",
          ownerIdentifier: "raw-owner-identifier",
          ownerId: "raw-owner-id",
          ownerIdHash: "owner-id-hash",
          passwordHash: "password-hash",
          profile: "raw-profile",
          profileIdentifier: "raw-profile-identifier",
          profileId: "raw-profile-id",
          providerAccount: "raw-provider-account",
          providerAccountHashIdentifier: "raw-provider-account-identifier",
          providerAccountIdentifier: "raw-provider-account-identifier",
          sessionHash: "session-hash",
          sessionToken: "session-token",
          subject: "raw-subject",
          subjectIdentifier: "raw-subject-identifier",
          subjectId: "raw-subject-id",
          user: "raw-user",
          userHashId: "raw-user-id",
          userIdentifier: "raw-user-identifier",
          userId: "raw-user-id",
          userIdHash: "user-id-hash",
          webhookSignature: "webhook-signature",
        },
        credentialMetadata: {
          hmacSecret: "drop-me",
          mode: "external-link",
          ownerId: "drop-owner",
          ownerIdHash: "keep-owner-hash",
          userId: "drop-user",
          userIdHash: "keep-user-hash",
          webhookSecret: "drop-me-too",
        },
      },
      metadata: {
        apiKey: "drop-me",
        clientUserId: "drop-me-too",
        clientUserIdHash: "drop-me-three",
        hmacSecret: "drop-me-four",
        ownerId: "drop-owner",
        ownerIdHash: "keep-owner-hash",
        safe: "kept",
        userId: "drop-user",
        userIdHash: "keep-user-hash",
        webhookSecret: "drop-me-five",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T01:00:00.000Z",
    });

    assertStoredCredentialKind(providerConfigAccount, "provider_config");
    assert.equal("accessTokenEncrypted" in providerConfigAccount, false);
    assert.equal("accessToken" in providerConfigAccount, false);
    assert.equal("accessTokenEncrypted" in providerConfigAccount.credential, false);
    assert.equal("accessToken" in providerConfigAccount.credential, false);
    assert.equal(providerConfigAccount.accessTokenExpiresAt, null);
    assert.deepEqual(providerConfigAccount.metadata, {
      clientUserIdHash: "drop-me-three",
      ownerIdHash: "keep-owner-hash",
      safe: "kept",
      userIdHash: "keep-user-hash",
    });

    const providerConfigCredential = readCredentialStateForTesting(store, providerConfigAccount.id);
    assert.ok(providerConfigCredential);
    assert.deepEqual({ ...providerConfigCredential }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "provider_config",
      credential_metadata_json: JSON.stringify({
        mode: "external-link",
        ownerIdHash: "keep-owner-hash",
        userIdHash: "keep-user-hash",
        subject: {
          clientUserIdHash: "client-user-id-hash",
          ownerIdHash: "owner-id-hash",
          userIdHash: "user-id-hash",
        },
      }),
      provider_config_key: "junction",
      refresh_token_encrypted: null,
    });

    const sanitizedCredentialMetadata = {
      mode: "external-link",
      ownerIdHash: "keep-owner-hash",
      userIdHash: "keep-user-hash",
      subject: {
        clientUserIdHash: "client-user-id-hash",
        ownerIdHash: "owner-id-hash",
        userIdHash: "user-id-hash",
      },
    };
    setCredentialStateForTesting(store, providerConfigAccount.id, {
      credential_metadata_json: JSON.stringify({
        authHeader: "Bearer legacy-auth-token",
        mode: "external-link",
        ownerId: "legacy-owner-id",
        ownerIdHash: "keep-owner-hash",
        token: "legacy-token",
        userIdHash: "keep-user-hash",
        subject: {
          clientUserId: "legacy-client-user-id",
          clientUserIdHash: "client-user-id-hash",
          owner: "legacy-owner",
          ownerIdHash: "owner-id-hash",
          sessionToken: "legacy-session-token",
          userHashId: "legacy-user-id",
          userIdHash: "user-id-hash",
        },
      }),
    });
    const legacyContaminatedAccount = store.getAccountById(providerConfigAccount.id);
    assert.equal(legacyContaminatedAccount?.credential.kind, "provider_config");
    assert.deepEqual(legacyContaminatedAccount?.credential.credentialMetadata, sanitizedCredentialMetadata);

    const preservedHydration = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-hash",
        metadata: providerConfigAccount.metadata,
        provider: "junction",
        scopes: [],
        status: "active",
        updatedAt: "2026-04-07T00:30:00.000Z",
      },
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-04-07T00:30:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: "2026-04-07T01:00:00.000Z",
      },
    });
    assert.equal(preservedHydration?.credential.kind, "provider_config");
    assert.deepEqual(preservedHydration?.credential.credentialMetadata, sanitizedCredentialMetadata);
    const providerConfigCredentialAfterHydration = readCredentialStateForTesting(store, providerConfigAccount.id);
    assert.ok(providerConfigCredentialAfterHydration);
    assert.equal(
      providerConfigCredentialAfterHydration.credential_metadata_json,
      JSON.stringify(sanitizedCredentialMetadata),
    );

    assert.equal(
      store.updateAccountTokens(providerConfigAccount.id, {
        accessToken: "should-not-store",
        accessTokenEncrypted: "enc:should-not-store",
      }),
      null,
    );
    const providerConfigCredentialAfterRefresh = readCredentialStateForTesting(store, providerConfigAccount.id);
    assert.ok(providerConfigCredentialAfterRefresh);
    assert.deepEqual({ ...providerConfigCredentialAfterRefresh }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "provider_config",
      credential_metadata_json: JSON.stringify({
        mode: "external-link",
        ownerIdHash: "keep-owner-hash",
        userIdHash: "keep-user-hash",
        subject: {
          clientUserIdHash: "client-user-id-hash",
          ownerIdHash: "owner-id-hash",
          userIdHash: "user-id-hash",
        },
      }),
      provider_config_key: "junction",
      refresh_token_encrypted: null,
    });

    const disconnected = store.disconnectAccount(providerConfigAccount.id, "2026-04-07T02:00:00.000Z");
    assert.equal(disconnected.status, "disconnected");
    const providerConfigCredentialAfterDisconnect = readCredentialStateForTesting(store, providerConfigAccount.id);
    assert.ok(providerConfigCredentialAfterDisconnect);
    assert.deepEqual({ ...providerConfigCredentialAfterDisconnect }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "provider_config",
      credential_metadata_json: JSON.stringify({
        mode: "external-link",
        ownerIdHash: "keep-owner-hash",
        userIdHash: "keep-user-hash",
        subject: {
          clientUserIdHash: "client-user-id-hash",
          ownerIdHash: "owner-id-hash",
          userIdHash: "user-id-hash",
        },
      }),
      provider_config_key: "junction",
      refresh_token_encrypted: null,
    });

    const noneAccount = store.upsertAccount({
      provider: "manual-device",
      externalAccountId: "manual-device-account",
      displayName: "Manual Device",
      scopes: [],
      credential: {
        kind: "none",
      },
      metadata: {},
      connectedAt: "2026-04-07T03:00:00.000Z",
    });
    const noneCredential = readCredentialStateForTesting(store, noneAccount.id);
    assert.equal("accessTokenEncrypted" in noneAccount, false);
    assert.equal("accessToken" in noneAccount, false);
    assert.equal("accessTokenEncrypted" in noneAccount.credential, false);
    assert.equal("accessToken" in noneAccount.credential, false);
    assert.ok(noneCredential);
    assert.deepEqual({ ...noneCredential }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "none",
      credential_metadata_json: "{}",
      provider_config_key: null,
      refresh_token_encrypted: null,
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store hosted hydration can create provider-config accounts without tokens", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-provider-config");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const hydrated = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Junction",
        externalAccountId: "junction-hosted-user",
        metadata: {
          clientUserId: "drop-me",
          hmacSecret: "drop-me-too",
          linked: true,
          webhookSecret: "drop-me-three",
        },
        provider: "junction",
        scopes: [],
        status: "active",
        updatedAt: "2026-04-07T00:00:00.000Z",
      },
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        subject: {
          account: "hosted-account",
          accountHashedId: "hosted-account-id",
          accountIdentifier: "hosted-account-identifier",
          authHeader: "Bearer hosted-auth-token",
          client: "hosted-client",
          clientUserIdHash: "hosted-client-user-id-hash",
          externalAccount: "hosted-external-account",
          externalAccountRawId: "hosted-external-account-id",
          externalIdentifier: "hosted-external-identifier",
          memberIdentifier: "hosted-member-identifier",
          owner: "hosted-owner",
          ownerIdentifier: "hosted-owner-identifier",
          passwordHash: "hosted-password-hash",
          profile: "hosted-profile",
          profileIdentifier: "hosted-profile-identifier",
          providerAccountHashIdentifier: "hosted-provider-account-identifier",
          providerAccountIdentifier: "hosted-provider-account-identifier",
          sessionHash: "hosted-session-hash",
          sessionToken: "hosted-session-token",
          subjectIdentifier: "hosted-subject-identifier",
          subjectId: "hosted-subject-id",
          user: "hosted-user",
          userHashId: "hosted-user-id",
          userIdentifier: "hosted-user-identifier",
          webhookSignature: "hosted-webhook-signature",
        },
      },
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-04-07T00:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: "2026-04-07T01:00:00.000Z",
      },
    });

    assert.ok(hydrated);
    assert.equal(hydrated?.provider, "junction");
    assertStoredCredentialKind(hydrated, "provider_config");
    assert.equal("accessTokenEncrypted" in hydrated, false);
    assert.equal("accessToken" in hydrated, false);
    assert.equal("accessTokenEncrypted" in hydrated.credential, false);
    assert.equal("accessToken" in hydrated.credential, false);
    assert.deepEqual(hydrated?.metadata, {
      linked: true,
    });
    const hydratedCredential = readCredentialStateForTesting(store, hydrated!.id);
    assert.ok(hydratedCredential);
    assert.deepEqual({ ...hydratedCredential }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "provider_config",
      credential_metadata_json: JSON.stringify({
        subject: {
          clientUserIdHash: "hosted-client-user-id-hash",
        },
      }),
      provider_config_key: "junction",
      refresh_token_encrypted: null,
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store migrates an existing v8 source row to the arrival column", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-v8-migration");
  const databasePath = path.join(tempDir, "state.sqlite");

  try {
    let store = new SqliteDeviceSyncStore(databasePath);
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-account",
      displayName: "Aggregator",
      scopes: [],
      credential: { kind: "none" },
      metadata: {},
      connectedAt: "2026-07-01T00:00:00.000Z",
    });
    store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_garmin",
      sourceProviderSlug: "garmin",
      status: "connected",
      lastSeenAt: "2026-07-01T00:00:00.000Z",
    });
    store.close();

    // Every existing runner database traverses this migration with real rows.
    downgradeDeviceSyncStoreToV8(databasePath);

    store = new SqliteDeviceSyncStore(databasePath);
    const [migrated] = store.listConnectionSources({ connectionId: connection.id });
    assert.ok(migrated, "the pre-existing source must survive the migration");
    assert.equal(migrated.sourceProviderSlug, "garmin");
    assert.equal(migrated.lastDataAt, null);

    assert.equal(
      store.markConnectionSourceDataReceived({
        connectionId: connection.id,
        now: "2026-07-05T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      }),
      1,
    );
    const [afterArrival] = store.listConnectionSources({ connectionId: connection.id });
    assert.equal(afterArrival?.lastDataAt, "2026-07-05T00:00:00.000Z");
    store.close();
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store keeps source instances distinct and lists them deterministically", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-sources");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-account",
      displayName: "Aggregator",
      scopes: [],
      credential: {
        kind: "none",
      },
      metadata: {
        shallow: true,
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const ouraB = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_oura_hash_b",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {
        dailySleep: "available",
        deviceId: "provider-device-identifier",
        note: "provider-device-identifier",
        serialNumber: "provider-serial-identifier",
      },
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });
    const ouraA = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {
        dailySleep: "available",
        workoutCount: 2,
      },
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });
    const dexcom = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_dexcom_hash_c",
      sourceProviderSlug: "dexcom",
      displayName: "Dexcom",
      status: "unavailable",
      resourceAvailabilitySummary: {
        glucose: "not_granted",
      },
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    assert.notEqual(ouraA.id, ouraB.id);
    assert.notEqual(ouraA.id, dexcom.id);
    assert.deepEqual(
      store.listConnectionSources({ connectionId: connection.id }).map((source) => source.sourceInstanceKey),
      ["src_dexcom_hash_c", "src_oura_hash_a", "src_oura_hash_b"],
    );
    assert.deepEqual(
      store.listConnectionSources({
        connectionId: connection.id,
        sourceProviderSlug: "oura",
      }).map((source) => source.sourceInstanceKey),
      ["src_oura_hash_a", "src_oura_hash_b"],
    );
    assert.deepEqual(
      store.listAccounts({ sourceProviderSlug: "oura" }).map((account) => ({
        externalAccountId: account.externalAccountId,
        sources: account.sources?.map((source) => source.sourceProviderSlug),
      })),
      [{
        externalAccountId: "aggregator-account",
        sources: ["dexcom", "oura", "oura"],
      }],
    );
    assert.deepEqual(
      store.listAccounts({ sourceProviderSlug: "garmin" }),
      [],
    );
    assert.equal(store.getAccountById(connection.id)?.sources?.[0]?.resourceCount, 1);
    assert.deepEqual(
      store.getAccountById(connection.id)?.sources?.find(
        (source) => source.sourceProviderSlug === "dexcom",
      )?.resourceAvailabilitySummary,
      { glucose: "not_granted" },
    );

    const updatedOuraA = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_oura_hash_a",
      sourceProviderSlug: "oura",
      status: "error",
      lastErrorCode: "SOURCE_UNAVAILABLE",
      lastErrorMessage: "source temporarily unavailable",
      lastSeenAt: "2026-04-07T02:00:00.000Z",
    });

    assert.equal(updatedOuraA.id, ouraA.id);
    assert.equal(updatedOuraA.displayName, "Oura Ring");
    assert.equal(updatedOuraA.firstSeenAt, "2026-04-07T01:00:00.000Z");
    assert.equal(updatedOuraA.lastSeenAt, "2026-04-07T02:00:00.000Z");
    assert.deepEqual(updatedOuraA.resourceAvailabilitySummary, {
      dailySleep: "available",
      workoutCount: 2,
    });
    assert.deepEqual(ouraB.resourceAvailabilitySummary, {
      dailySleep: "available",
    });
    assert.deepEqual(
      store.listConnectionSources({ connectionId: connection.id }).map((source) => ({
        key: source.sourceInstanceKey,
        status: source.status,
      })),
      [
        {
          key: "src_oura_hash_a",
          status: "error",
        },
        {
          key: "src_dexcom_hash_c",
          status: "unavailable",
        },
        {
          key: "src_oura_hash_b",
          status: "connected",
        },
      ],
    );
    assert.deepEqual(store.getAccountById(connection.id)?.metadata, {
      shallow: true,
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store provider filters match direct and aggregator-backed source aliases", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-provider-aliases");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    store.upsertAccount({
      provider: "whoop",
      externalAccountId: "direct-whoop",
      displayName: "Direct WHOOP",
      scopes: [],
      credential: {
        kind: "none",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const junctionWhoop = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-whoop",
      displayName: "Junction WHOOP",
      scopes: [],
      credential: {
        kind: "none",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    store.upsertConnectionSource({
      connectionId: junctionWhoop.id,
      sourceInstanceKey: "src_whoop_v2",
      sourceProviderSlug: "whoop_v2",
      displayName: "WHOOP",
      status: "connected",
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    const junctionFitbit = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-fitbit",
      displayName: "Junction Fitbit",
      scopes: [],
      credential: {
        kind: "none",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    store.upsertConnectionSource({
      connectionId: junctionFitbit.id,
      sourceInstanceKey: "src_fitbit",
      sourceProviderSlug: "fitbit",
      displayName: "Fitbit",
      status: "connected",
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    const disconnectedWhoop = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-disconnected-whoop",
      displayName: "Disconnected Junction WHOOP",
      scopes: [],
      credential: {
        kind: "none",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    store.upsertConnectionSource({
      connectionId: disconnectedWhoop.id,
      sourceInstanceKey: "src_disconnected_whoop_v2",
      sourceProviderSlug: "whoop_v2",
      displayName: "WHOOP",
      status: "disconnected",
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    assert.deepEqual(
      store.listAccounts({ provider: "whoop" }).map((account) => account.externalAccountId).sort(),
      ["direct-whoop", "junction-whoop"],
    );
    assert.deepEqual(
      store.listAccounts({ provider: "whoop_v2" }).map((account) => account.externalAccountId).sort(),
      ["direct-whoop", "junction-whoop"],
    );
    assert.deepEqual(
      store.listAccounts({ sourceProviderSlug: "whoop" }).map((account) => account.externalAccountId),
      ["junction-whoop"],
    );
    assert.deepEqual(
      store.listAccounts({ provider: "fitbit" }).map((account) => account.externalAccountId),
      ["junction-fitbit"],
    );
    assert.deepEqual(store.listAccounts({ provider: "   " }), []);
    assert.deepEqual(store.listAccounts({ sourceProviderSlug: "   " }), []);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves omitted source error detail while errored and clears it on recovery", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-source-error-detail");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-source-error-detail",
      displayName: "Aggregator",
      scopes: [],
      credential: {
        kind: "none",
      },
      metadata: {},
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    const errored = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_whoop_hash_a",
      sourceProviderSlug: "whoop_v2",
      status: "error",
      lastErrorCode: "token_refresh_failed",
      lastErrorMessage: "WHOOP rejected the refresh token.",
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    assert.equal(errored.lastErrorCode, "token_refresh_failed");
    assert.equal(errored.lastErrorMessage, "WHOOP rejected the refresh token.");

    // Still errored with the error keys omitted: existing detail is preserved.
    const stillErrored = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_whoop_hash_a",
      sourceProviderSlug: "whoop_v2",
      status: "error",
      lastSeenAt: "2026-04-07T02:00:00.000Z",
    });

    assert.equal(stillErrored.lastErrorCode, "token_refresh_failed");
    assert.equal(stillErrored.lastErrorMessage, "WHOOP rejected the refresh token.");

    // Recovery with the error keys omitted: stale detail auto-clears.
    const recovered = store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_whoop_hash_a",
      sourceProviderSlug: "whoop_v2",
      status: "connected",
      lastSeenAt: "2026-04-07T03:00:00.000Z",
    });

    assert.equal(recovered.lastErrorCode, null);
    assert.equal(recovered.lastErrorMessage, null);

    // The store rejects over-length error fields, which is why projections
    // must truncate to 80/240 before persisting.
    assert.throws(
      () =>
        store.upsertConnectionSource({
          connectionId: connection.id,
          sourceInstanceKey: "src_whoop_hash_a",
          sourceProviderSlug: "whoop_v2",
          status: "error",
          lastErrorCode: "x".repeat(81),
          lastSeenAt: "2026-04-07T04:00:00.000Z",
        }),
      /lastErrorCode must be 80 characters or fewer\./u,
    );
    assert.throws(
      () =>
        store.upsertConnectionSource({
          connectionId: connection.id,
          sourceInstanceKey: "src_whoop_hash_a",
          sourceProviderSlug: "whoop_v2",
          status: "error",
          lastErrorMessage: "x".repeat(241),
          lastSeenAt: "2026-04-07T04:00:00.000Z",
        }),
      /lastErrorMessage must be 240 characters or fewer\./u,
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store cascades source projection rows when the parent connection is deleted", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-source-cascade");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-source-cascade",
      displayName: "Aggregator",
      scopes: [],
      credential: {
        kind: "none",
      },
      metadata: {},
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    store.upsertConnectionSource({
      connectionId: connection.id,
      sourceInstanceKey: "src_hash_one",
      sourceProviderSlug: "source-provider",
      displayName: "Source One",
      status: "connected",
      resourceAvailabilitySummary: {
        sleep: true,
      },
      lastSeenAt: "2026-04-07T01:00:00.000Z",
    });

    assert.equal(store.listConnectionSources({ connectionId: connection.id }).length, 1);

    deleteConnectionForTesting(store, connection.id);

    assert.deepEqual(store.listConnectionSources({ connectionId: connection.id }), []);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store rejects raw source instance keys before persistence", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-source-key-privacy");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const connection = store.upsertAccount({
      provider: "aggregator",
      externalAccountId: "aggregator-source-key-privacy",
      displayName: "Aggregator",
      scopes: [],
      credential: {
        kind: "none",
      },
      metadata: {},
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    assert.throws(
      () =>
        store.upsertConnectionSource({
          connectionId: connection.id,
          sourceInstanceKey: "oura:provider-device-identifier",
          sourceProviderSlug: "oura",
          status: "connected",
          lastSeenAt: "2026-04-07T01:00:00.000Z",
        }),
      /sourceInstanceKey must be a stable opaque lowercase slug/u,
    );
    assert.deepEqual(store.listConnectionSources({ connectionId: connection.id }), []);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store rejects malformed provider-config credential rows", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-provider-config-invalid");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-user-invalid-row",
      displayName: "Junction",
      scopes: [],
      status: "active",
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {},
      connectedAt: "2026-04-07T00:00:00.000Z",
    });

    assert.throws(
      () =>
        setCredentialStateForTesting(store, account.id, {
          provider_config_key: null,
        }),
      /CHECK constraint failed/u,
    );

    setCredentialStateForTesting(store, account.id, {
      provider_config_key: "",
    });
    assert.throws(
      () => store.getAccountById(account.id),
      /Stored provider-config credential rows require provider_config_key/u,
    );

    assert.throws(
      () =>
        setCredentialStateForTesting(store, account.id, {
          provider_config_key: "junction",
          access_token_encrypted: "enc:should-not-exist",
        }),
      /CHECK constraint failed/u,
    );
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
    const partiallyHydratedOAuthCredential = requireStoredOAuthCredential(partiallyHydrated);
    assert.equal(partiallyHydratedOAuthCredential.accessTokenEncrypted, "enc:local-access-refresh");
    assert.equal(partiallyHydratedOAuthCredential.refreshTokenEncrypted, "enc:local-refresh-refresh");
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

    setConnectionUpdatedAtForTesting(store, hydrated!.id, "2026-04-06T23:00:00.000Z");

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
    const replayedOAuthCredential = requireStoredOAuthCredential(replayed);
    assert.equal(replayedOAuthCredential.accessTokenEncrypted, "enc:local-access-refresh");
    assert.equal(replayedOAuthCredential.refreshTokenEncrypted, "enc:local-refresh-refresh");
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

test("device sync store preserves replayed connection state while applying fresher hosted tokens", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-token-advance");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-token-advance",
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

    const locallyPatched = store.patchAccount(hydrated!.id, {
      displayName: "Local Fresh",
      metadata: {
        local: true,
      },
      scopes: ["offline", "manual"],
      status: "reauthorization_required",
    });

    assert.equal(locallyPatched.displayName, "Local Fresh");

    const replayedConnectionFreshToken = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Replayed Connection",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          replay: true,
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "active",
        updatedAt: "2026-04-07T01:00:00.000Z",
      },
      hostedObservedTokenVersion: 8,
      hostedObservedUpdatedAt: "2026-04-07T01:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T01:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T01:20:00.000Z",
        lastWebhookAt: "2026-04-07T01:10:00.000Z",
        nextReconcileAt: "2026-04-07T04:00:00.000Z",
      },
      tokens: {
        accessToken: "hosted-access-v8",
        accessTokenEncrypted: "enc:hosted-access-v8",
        accessTokenExpiresAt: "2026-04-07T05:00:00.000Z",
        refreshToken: "hosted-refresh-v8",
        refreshTokenEncrypted: "enc:hosted-refresh-v8",
      },
    });

    assert.equal(replayedConnectionFreshToken?.id, seeded.id);
    assert.equal(replayedConnectionFreshToken?.displayName, "Local Fresh");
    assert.equal(replayedConnectionFreshToken?.status, "reauthorization_required");
    assert.deepEqual(replayedConnectionFreshToken?.metadata, {
      hosted: true,
      local: true,
    });
    assert.deepEqual(replayedConnectionFreshToken?.scopes, ["offline", "manual"]);
    assert.equal(replayedConnectionFreshToken?.hostedObservedUpdatedAt, "2026-04-07T01:00:00.000Z");
    assert.equal(replayedConnectionFreshToken?.hostedObservedTokenVersion, 8);
    const replayedConnectionFreshTokenCredential = requireStoredOAuthCredential(replayedConnectionFreshToken);
    assert.equal(replayedConnectionFreshTokenCredential.accessTokenEncrypted, "enc:hosted-access-v8");
    assert.equal(replayedConnectionFreshTokenCredential.refreshTokenEncrypted, "enc:hosted-refresh-v8");
    assert.equal(replayedConnectionFreshToken?.accessTokenExpiresAt, "2026-04-07T05:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store keeps local tokens when hosted disconnect clear requests arrive with stale token observations", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-clear-stale");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-clear-stale",
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

    const blockedClear = store.hydrateHostedAccount({
      clearTokens: true,
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Disconnect",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          reason: "stale-observation",
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "disconnected",
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
        nextReconcileAt: null,
      },
    });

    assert.equal(blockedClear?.id, seeded.id);
    assert.equal(blockedClear?.status, "disconnected");
    assert.equal(blockedClear?.disconnectGeneration, 1);
    assert.deepEqual(blockedClear?.metadata, {
      reason: "stale-observation",
    });
    assert.equal(blockedClear?.hostedObservedUpdatedAt, "2026-04-07T02:00:00.000Z");
    assert.equal(blockedClear?.hostedObservedTokenVersion, 7);
    const blockedClearOAuthCredential = requireStoredOAuthCredential(blockedClear);
    assert.equal(blockedClearOAuthCredential.accessTokenEncrypted, "enc:hosted-access-v7");
    assert.equal(blockedClearOAuthCredential.refreshTokenEncrypted, "enc:hosted-refresh-v7");
    assert.equal(blockedClear?.accessTokenExpiresAt, "2026-04-07T04:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store keeps local tokens when stale hosted disconnects send credential clears", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-credential-clear-stale");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-credential-clear-stale",
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

    const blockedClear = store.hydrateHostedAccount({
      credential: {
        kind: "none",
      },
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Disconnect",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          reason: "stale-credential-clear",
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "disconnected",
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
        nextReconcileAt: null,
      },
    });

    assert.equal(blockedClear?.id, seeded.id);
    assert.equal(blockedClear?.status, "disconnected");
    assert.equal(blockedClear?.hostedObservedTokenVersion, 7);
    const blockedClearOAuthCredential = requireStoredOAuthCredential(blockedClear);
    assert.equal(blockedClearOAuthCredential.accessTokenEncrypted, "enc:hosted-access-v7");
    assert.equal(blockedClearOAuthCredential.refreshTokenEncrypted, "enc:hosted-refresh-v7");
    assert.equal(blockedClear?.accessTokenExpiresAt, "2026-04-07T04:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store clears tokens for fresh hosted credential-mode changes", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-credential-mode-change");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-credential-mode-change",
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

    const providerConfig = store.hydrateHostedAccount({
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Provider Config",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          mode: "provider-config",
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "active",
        updatedAt: "2026-04-07T02:00:00.000Z",
      },
      hostedObservedTokenVersion: 8,
      hostedObservedUpdatedAt: "2026-04-07T02:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T01:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T01:20:00.000Z",
        lastWebhookAt: "2026-04-07T01:10:00.000Z",
        nextReconcileAt: null,
      },
    });

    assert.equal(providerConfig?.id, seeded.id);
    assert.equal(providerConfig?.credential.kind, "provider_config");
    assert.equal(providerConfig?.credential.providerConfigKey, "junction");
    assert.equal(providerConfig?.accessTokenExpiresAt, null);
    assert.equal(providerConfig?.hostedObservedTokenVersion, 8);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store clears tokens for fresh hosted disconnects after local token refreshes", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-hosted-clear-after-refresh");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-hosted-clear-after-refresh",
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
    assert.equal(locallyRefreshed.localTokenRevision, hydrated!.localTokenRevision + 1);

    const disconnected = store.hydrateHostedAccount({
      credential: {
        kind: "none",
      },
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Disconnect",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          reason: "hosted-disconnect",
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "disconnected",
        updatedAt: "2026-04-07T02:00:00.000Z",
      },
      hostedObservedTokenVersion: 7,
      hostedObservedUpdatedAt: "2026-04-07T02:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T01:30:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T01:20:00.000Z",
        lastWebhookAt: "2026-04-07T01:10:00.000Z",
        nextReconcileAt: null,
      },
    });

    assert.equal(disconnected?.id, seeded.id);
    assert.equal(disconnected?.status, "disconnected");
    assert.equal(disconnected?.disconnectGeneration, hydrated!.disconnectGeneration + 1);
    assertStoredCredentialKind(disconnected, "none");
    assert.equal(disconnected?.accessTokenExpiresAt, null);
    assert.equal(disconnected?.hostedObservedTokenVersion, 7);

    const replayedActiveTokens = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T00:00:00.000Z",
        displayName: "Hosted Replayed Active",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          reason: "replayed-active-token",
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
        lastSyncCompletedAt: "2026-04-07T01:40:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T01:35:00.000Z",
        lastWebhookAt: "2026-04-07T01:30:00.000Z",
        nextReconcileAt: "2026-04-07T04:00:00.000Z",
      },
      tokens: {
        accessToken: "replayed-hosted-access-v7",
        accessTokenEncrypted: "enc:replayed-hosted-access-v7",
        accessTokenExpiresAt: "2026-04-07T06:00:00.000Z",
        refreshToken: "replayed-hosted-refresh-v7",
        refreshTokenEncrypted: "enc:replayed-hosted-refresh-v7",
      },
    });

    assert.equal(replayedActiveTokens?.id, seeded.id);
    assert.equal(replayedActiveTokens?.status, "disconnected");
    assertStoredCredentialKind(replayedActiveTokens, "none");
    assert.equal(replayedActiveTokens?.accessTokenExpiresAt, null);
    assert.equal(replayedActiveTokens?.hostedObservedTokenVersion, 7);

    const freshReconnectTokens = store.hydrateHostedAccount({
      connection: {
        connectedAt: "2026-04-07T03:00:00.000Z",
        displayName: "Hosted Reconnect",
        externalAccountId: seeded.externalAccountId,
        metadata: {
          reason: "fresh-reconnect",
        },
        provider: seeded.provider,
        scopes: ["sleep"],
        status: "active",
        updatedAt: "2026-04-07T03:00:00.000Z",
      },
      hostedObservedTokenVersion: 1,
      hostedObservedUpdatedAt: "2026-04-07T03:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-07T02:40:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-07T02:35:00.000Z",
        lastWebhookAt: "2026-04-07T02:30:00.000Z",
        nextReconcileAt: "2026-04-07T04:00:00.000Z",
      },
      tokens: {
        accessToken: "fresh-reconnect-access-v1",
        accessTokenEncrypted: "enc:fresh-reconnect-access-v1",
        accessTokenExpiresAt: "2026-04-07T06:00:00.000Z",
        refreshToken: "fresh-reconnect-refresh-v1",
        refreshTokenEncrypted: "enc:fresh-reconnect-refresh-v1",
      },
    });

    assert.equal(freshReconnectTokens?.id, seeded.id);
    assert.equal(freshReconnectTokens?.status, "active");
    const freshReconnectCredential = requireStoredOAuthCredential(freshReconnectTokens);
    assert.equal(freshReconnectCredential.accessTokenEncrypted, "enc:fresh-reconnect-access-v1");
    assert.equal(freshReconnectTokens?.hostedObservedTokenVersion, 1);
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store failure transitions requeue, replace only owned progress, and preserve it at exhaustion", async () => {
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
      maxAttempts: 3,
      payload: { phase: "original" },
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

    assert.equal(
      store.claimDueJob("worker-a", "2026-04-07T00:05:00.000Z", 60_000)?.id,
      retryableJob.id,
    );
    assert.deepEqual(
      store.failJobIfOwned(
        retryableJob.id,
        "worker-b",
        "2026-04-07T00:05:10.000Z",
        "FOREIGN_FAILURE",
        "foreign worker must not replace progress",
        "2026-04-07T00:05:20.000Z",
        true,
        false,
        { phase: "foreign" },
      ),
      null,
    );
    assert.deepEqual(store.getJobById(retryableJob.id)?.payload, { phase: "original" });

    assert.deepEqual(
      store.failJobIfOwned(
        retryableJob.id,
        "worker-a",
        "2026-04-07T00:05:10.000Z",
        "TEMPORARY_FAILURE",
        "retry with bounded progress",
        "2026-04-07T00:05:20.000Z",
        true,
        false,
        { phase: "bounded-progress" },
      ),
      {
        attempts: 2,
        disposition: "queued",
        maxAttempts: 3,
        remainingAttempts: 1,
      },
    );
    const ownedRetry = store.getJobById(retryableJob.id);
    assert.equal(ownedRetry?.status, "queued");
    assert.equal(ownedRetry?.attempts, 2);
    assert.equal(ownedRetry?.availableAt, "2026-04-07T00:05:20.000Z");
    assert.deepEqual(ownedRetry?.payload, { phase: "bounded-progress" });

    assert.equal(
      store.claimDueJob("worker-b", "2026-04-07T00:05:20.000Z", 60_000)?.id,
      retryableJob.id,
    );
    assert.deepEqual(
      store.failJobIfOwned(
        retryableJob.id,
        "worker-b",
        "2026-04-07T00:05:30.000Z",
        "EXHAUSTED",
        "retry budget exhausted",
        null,
        true,
        false,
        { phase: "must-not-replace-on-dead" },
      ),
      {
        attempts: 3,
        disposition: "dead",
        maxAttempts: 3,
        remainingAttempts: 0,
      },
    );
    const exhausted = store.getJobById(retryableJob.id);
    assert.equal(exhausted?.status, "dead");
    assert.equal(exhausted?.attempts, 3);
    assert.deepEqual(exhausted?.payload, { phase: "bounded-progress" });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store disconnects only the expected connection generation", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-disconnect-generation");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const originalConnectedAt = "2026-04-07T00:00:00.000Z";
    const reconnectedAt = "2026-04-07T01:00:00.000Z";
    const original = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-disconnect-generation",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "original-access-token",
        accessTokenEncrypted: "enc:original-access-token",
      },
      connectedAt: originalConnectedAt,
    });
    const reconnected = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-disconnect-generation",
      displayName: "Demo",
      scopes: ["offline"],
      tokens: {
        accessToken: "reconnected-access-token",
        accessTokenEncrypted: "enc:reconnected-access-token",
      },
      connectedAt: reconnectedAt,
    });
    const job = store.enqueueJob({
      accountId: reconnected.id,
      availableAt: reconnectedAt,
      kind: "reconcile",
      payload: {},
      provider: "demo",
    });

    assert.equal(reconnected.id, original.id);
    assert.equal(
      store.disconnectAccountAndMarkPendingJobsDeadIfConnectedAt({
        accountId: reconnected.id,
        code: "ACCOUNT_DISCONNECTED",
        expectedConnectedAt: originalConnectedAt,
        message: "The account was disconnected.",
        now: "2026-04-07T02:00:00.000Z",
      }),
      null,
    );
    assert.equal(store.getAccountById(reconnected.id)?.status, "active");
    assert.equal(store.getAccountById(reconnected.id)?.connectedAt, reconnectedAt);
    assert.equal(store.getJobById(job.id)?.status, "queued");

    const disconnected = store.disconnectAccountAndMarkPendingJobsDeadIfConnectedAt({
      accountId: reconnected.id,
      code: "ACCOUNT_DISCONNECTED",
      expectedConnectedAt: reconnectedAt,
      message: "The account was disconnected.",
      now: "2026-04-07T02:00:00.000Z",
    });

    assert.equal(disconnected?.status, "disconnected");
    assert.equal(disconnected?.connectedAt, reconnectedAt);
    assert.equal(store.getJobById(job.id)?.status, "dead");
    assert.equal(store.getJobById(job.id)?.lastErrorCode, "ACCOUNT_DISCONNECTED");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("active dedupe membership matches enqueue ownership for queued and exhausted running jobs", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-active-dedupe-membership");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      connectedAt: "2026-04-07T00:00:00.000Z",
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      displayName: "Junction",
      externalAccountId: "junction-active-dedupe-membership",
      provider: "junction",
      scopes: [],
    });
    const ordinaryKey = "junction-history-ordinary";
    const companionKey = "junction-history-companion";
    const ordinaryJob = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: ordinaryKey,
      kind: "resource",
      maxAttempts: 1,
      payload: { resource: "caffeine" },
      priority: 10,
      provider: "junction",
    });
    store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: companionKey,
      kind: "resource",
      maxAttempts: 1,
      payload: { resource: COMPANION_HRV_RMSSD_RESOURCE },
      priority: 5,
      provider: "junction",
    });
    assert.deepEqual(
      [...store.findActiveJobDedupeKeys({
        accountId: account.id,
        dedupeKeys: [ordinaryKey, companionKey, "missing"],
        provider: "junction",
      })].sort(),
      [companionKey, ordinaryKey].sort(),
    );
    assert.throws(
      () => store.findActiveJobDedupeKeys({
        accountId: account.id,
        dedupeKeys: Array.from({ length: 397 }, (_, index) => `candidate-${index}`),
        provider: "junction",
      }),
      /exceeds 396 keys/u,
    );

    assert.equal(
      store.claimDueJob("worker-ordinary", "2026-04-07T00:00:00.000Z", 60_000)?.dedupeKey,
      ordinaryKey,
    );
    assert.deepEqual(
      [...store.findActiveJobDedupeKeys({
        accountId: account.id,
        dedupeKeys: [ordinaryKey, companionKey],
        provider: "junction",
      })],
      [companionKey],
    );
    store.failJob(
      ordinaryJob.id,
      "2026-04-07T00:01:02.000Z",
      "TERMINAL_TEST_FAILURE",
      "Terminal test failure.",
      null,
      false,
    );
    assert.equal(store.getJobById(ordinaryJob.id)?.status, "dead");
    assert.equal(store.findActiveJobDedupeKeys({
      accountId: account.id,
      dedupeKeys: [ordinaryKey],
      provider: "junction",
    }).size, 0);

    assert.equal(
      store.claimDueJob("worker-companion", "2026-04-07T00:01:01.000Z", 60_000)?.dedupeKey,
      companionKey,
    );
    assert.deepEqual(
      [...store.findActiveJobDedupeKeys({
        accountId: account.id,
        dedupeKeys: [ordinaryKey, companionKey],
        provider: "junction",
      })],
      [companionKey],
    );
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
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

test("device sync store reclaims an expired retained companion lease on the same row past its attempt fence", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-expired-companion-lease");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-expired-companion-lease",
      displayName: "Junction",
      scopes: [],
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    const job = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: "companion-expired-final-attempt",
      kind: "resource",
      maxAttempts: 1,
      payload: {
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      },
      provider: "junction",
    });

    const firstClaim = store.claimDueJob("worker-a", "2026-04-07T00:00:00.000Z", 60_000);
    assert.equal(firstClaim?.id, job.id);
    assert.equal(firstClaim?.attempts, 1);
    assert.equal(firstClaim?.maxAttempts, 1);

    const refetched = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:01:01.000Z",
      dedupeKey: "companion-expired-final-attempt",
      kind: "resource",
      maxAttempts: 1,
      payload: {
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      },
      provider: "junction",
    });
    assert.equal(refetched.id, job.id);

    const reclaimed = store.claimDueJob("worker-b", "2026-04-07T00:01:01.000Z", 60_000);
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.status, "running");
    assert.equal(reclaimed?.leaseOwner, "worker-b");
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(reclaimed?.maxAttempts, 2);
    assert.equal(store.completeJobIfOwned(job.id, "worker-b", "2026-04-07T00:01:02.000Z"), true);
    assert.equal(store.getJobById(job.id)?.status, "succeeded");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store reclaims an expired retained calendar lease on the same row past its attempt fence", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-expired-calendar-lease");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-expired-calendar-lease",
      displayName: "Junction",
      scopes: [],
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    const input = {
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      dedupeKey: "calendar-expired-final-attempt",
      kind: "resource",
      maxAttempts: 1,
      payload: {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        sourceProviderSlug: "garmin",
      },
      provider: "junction",
    } as const;
    const job = store.enqueueJob(input);

    const firstClaim = store.claimDueJob("worker-a", "2026-04-07T00:00:00.000Z", 60_000);
    assert.equal(firstClaim?.id, job.id);
    assert.equal(firstClaim?.attempts, 1);
    assert.equal(firstClaim?.maxAttempts, 1);

    const refetched = store.enqueueJob({
      ...input,
      availableAt: "2026-04-07T00:01:01.000Z",
    });
    assert.equal(refetched.id, job.id);

    const reclaimed = store.claimDueJob("worker-b", "2026-04-07T00:01:01.000Z", 60_000);
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.status, "running");
    assert.equal(reclaimed?.leaseOwner, "worker-b");
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(reclaimed?.maxAttempts, 2);
    assert.equal(store.completeJobIfOwned(job.id, "worker-b", "2026-04-07T00:01:02.000Z"), true);
    assert.equal(store.getJobById(job.id)?.status, "succeeded");
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves retained calendar work across account cleanup and wakes it on reconnect", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-retained-calendar-lifecycle");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));
  try {
    const account = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-retained-calendar-lifecycle",
      displayName: "Junction",
      status: "active",
      scopes: [],
      credential: { kind: "provider_config", providerConfigKey: "junction" },
      connectedAt: "2026-04-07T00:00:00.000Z",
    });
    const retained = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-09T00:00:00.000Z",
      kind: "resource",
      payload: {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        sourceProviderSlug: "garmin",
      },
      priority: 1,
      provider: "junction",
    });
    const ordinary = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-07T00:00:00.000Z",
      kind: "reconcile",
      payload: {},
      provider: "junction",
    });
    const unrelatedFailure = store.enqueueJob({
      accountId: account.id,
      availableAt: "2026-04-09T00:00:00.000Z",
      kind: "resource",
      payload: {
        calendarRefreshDay: "2026-04-03",
        resource: "water",
        sourceProviderSlug: "garmin",
      },
      provider: "junction",
    });

    store.markPendingJobsDeadForAccount(
      account.id,
      "2026-04-07T01:00:00.000Z",
      "ACCOUNT_DISCONNECTED",
      "Disconnected.",
    );
    assert.equal(store.getJobById(retained.id)?.status, "queued");
    assert.equal(store.getJobById(ordinary.id)?.status, "dead");

    const claimedRetained = store.claimDueJob(
      "worker-disconnected",
      "2026-04-09T00:00:00.000Z",
      60_000,
    );
    assert.equal(claimedRetained?.id, retained.id);
    assert.deepEqual(store.failJobIfOwned(
      retained.id,
      "worker-disconnected",
      "2026-04-09T00:00:01.000Z",
      "ACCOUNT_DISCONNECTED",
      "Reconnect required.",
      "2026-04-10T00:00:00.000Z",
      true,
      true,
    ), {
      attempts: 1,
      disposition: "queued",
      maxAttempts: 5,
      remainingAttempts: 4,
    });
    assert.equal(
      store.claimDueJob("worker-unrelated-failure", "2026-04-09T00:00:01.000Z", 60_000)?.id,
      unrelatedFailure.id,
    );
    assert.deepEqual(store.failJobIfOwned(
      unrelatedFailure.id,
      "worker-unrelated-failure",
      "2026-04-09T00:00:02.000Z",
      "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION",
      "Provider data incomplete.",
      "2026-04-10T00:00:00.000Z",
      true,
      true,
    ), {
      attempts: 1,
      disposition: "queued",
      maxAttempts: 5,
      remainingAttempts: 4,
    });

    const database = openSqliteRuntimeDatabase(store.databasePath);
    try {
      assert.equal(markCredentialScopedPendingDeviceSyncJobsDeadForAccount(database, {
        accountId: account.id,
        code: "HOSTED_CONNECTION_EPOCH_REPLACED",
        message: "Connection epoch changed.",
        now: "2026-04-07T02:00:00.000Z",
      }), 0);
    } finally {
      database.close();
    }
    assert.equal(store.getJobById(retained.id)?.status, "queued");

    store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-retained-calendar-lifecycle",
      displayName: "Junction",
      status: "active",
      scopes: [],
      credential: { kind: "provider_config", providerConfigKey: "junction" },
      connectedAt: "2026-04-09T01:00:00.000Z",
    });
    assert.equal(
      store.claimDueJob("worker-reconnected", "2026-04-09T01:00:00.000Z", 60_000)?.id,
      retained.id,
    );
    assert.equal(store.getJobById(unrelatedFailure.id)?.availableAt, "2026-04-10T00:00:00.000Z");
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
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
      consumedAt: "2026-04-07T00:01:00.000Z",
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

test("device sync store adds consumed_at when reopening a v6 database", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-v6-reopen");
  const databasePath = path.join(tempDir, "state.sqlite");
  const database = openSqliteRuntimeDatabase(databasePath);
  database.exec(`
    create table oauth_state (
      state text primary key,
      provider text not null,
      owner_id text,
      return_to text,
      metadata_json text not null,
      created_at text not null,
      expires_at text not null
    );

    insert into oauth_state values (
      'v6-state',
      'demo',
      null,
      '/devices',
      '{}',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:15:00.000Z'
    );

    pragma user_version = 6;
  `);
  database.close();

  const store = new SqliteDeviceSyncStore(databasePath);

  try {
    assert.equal(
      store.consumeOAuthState("v6-state", "2026-04-07T00:01:00.000Z", "demo").status,
      "consumed",
    );
    assert.equal(
      store.consumeOAuthState("v6-state", "2026-04-07T00:02:00.000Z", "demo").status,
      "replayed",
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store binds a first terminal hosted snapshot when reopening a v7 database", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-v7-reopen");
  const databasePath = path.join(tempDir, "state.sqlite");
  const legacyStore = new SqliteDeviceSyncStore(databasePath);
  const existing = legacyStore.upsertAccount({
    connectedAt: "2026-07-13T01:00:00.000Z",
    credential: {
      credentialMetadata: {},
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    displayName: "Junction",
    externalAccountId: "junction-v7-account",
    provider: "junction",
    scopes: [],
    status: "active",
  });
  legacyStore.close();

  downgradeDeviceSyncStoreToV7(databasePath);

  const store = new SqliteDeviceSyncStore(databasePath);

  try {
    const hydrated = store.hydrateHostedAccount({
      credential: {
        credentialMetadata: {},
        kind: "none",
      },
      connection: {
        connectedAt: "2026-07-13T01:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "opaque:hosted-connection-v7",
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "disconnected",
        updatedAt: "2026-07-13T01:01:00.000Z",
      },
      hostedConnectionId: "hosted-connection-v7",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T01:01:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
    });

    assert.equal(hydrated?.id, existing.id);
    assert.equal(hydrated?.externalAccountId, "opaque:hosted-connection-v7");
    assert.equal(hydrated?.status, "disconnected");
    assert.equal(hydrated?.credential.kind, "none");
    assert.equal(store.listAccounts().length, 1);
    assert.equal(
      store.getAccountByHostedConnectionId("hosted-connection-v7")?.id,
      existing.id,
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store consolidates a pre-v8 terminal identity fork", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-v7-fork");
  const databasePath = path.join(tempDir, "state.sqlite");
  const legacyStore = new SqliteDeviceSyncStore(databasePath);
  const original = legacyStore.upsertAccount({
    connectedAt: "2026-07-13T01:00:00.000Z",
    credential: {
      credentialMetadata: {},
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    displayName: "Junction",
    externalAccountId: "junction-v7-original",
    provider: "junction",
    scopes: [],
    status: "active",
  });
  const fork = legacyStore.upsertAccount({
    connectedAt: "2026-07-13T01:00:00.000Z",
    credential: {
      credentialMetadata: {},
      kind: "none",
    },
    displayName: "Junction",
    externalAccountId: "opaque:hosted-connection-v7-fork",
    provider: "junction",
    scopes: [],
    status: "disconnected",
  });
  const providerJob = legacyStore.enqueueJob({
    accountId: original.id,
    availableAt: "2026-07-13T01:01:00.000Z",
    kind: "resource-sync",
    payload: {},
    provider: "junction",
  });
  insertConnectionSourceRowForTesting(legacyStore, {
    connectionId: original.id,
    displayName: "Original Garmin",
    firstSeenAt: "2026-07-13T01:01:00.000Z",
    id: "dcs_original_garmin",
    lastSeenAt: "2026-07-13T01:01:00.000Z",
    lifecycleEpoch: 1,
    sourceInstanceKey: "src_original_garmin",
    sourceProviderSlug: "garmin",
    status: "connected",
  });
  insertConnectionSourceRowForTesting(legacyStore, {
    connectionId: original.id,
    displayName: "Original WHOOP",
    firstSeenAt: "2026-07-13T01:01:00.000Z",
    id: "dcs_original_whoop",
    lastSeenAt: "2026-07-13T01:01:00.000Z",
    lifecycleEpoch: 1,
    sourceInstanceKey: "src_shared_whoop",
    sourceProviderSlug: "whoop",
    status: "connected",
  });
  insertConnectionSourceRowForTesting(legacyStore, {
    connectionId: fork.id,
    displayName: "Canonical WHOOP",
    firstSeenAt: "2026-07-13T01:01:30.000Z",
    id: "dcs_canonical_whoop",
    lastSeenAt: "2026-07-13T01:01:30.000Z",
    lifecycleEpoch: 1,
    sourceInstanceKey: "src_shared_whoop",
    sourceProviderSlug: "whoop",
    status: "disconnected",
  });
  legacyStore.close();
  downgradeDeviceSyncStoreToV7(databasePath);

  const store = new SqliteDeviceSyncStore(databasePath);

  try {
    const hydrated = store.hydrateHostedAccount({
      credential: {
        credentialMetadata: {},
        kind: "none",
      },
      connection: {
        connectedAt: "2026-07-13T01:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "opaque:hosted-connection-v7-fork",
        metadata: {},
        provider: "junction",
        scopes: [],
        status: "disconnected",
        updatedAt: "2026-07-13T01:02:00.000Z",
      },
      hostedConnectionId: "hosted-connection-v7-fork",
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-07-13T01:02:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
    });

    assert.equal(hydrated?.id, fork.id);
    assert.equal(store.getAccountById(original.id), null);
    assert.equal(store.listAccounts().length, 1);
    assert.equal(store.getJobById(providerJob.id)?.accountId, fork.id);
    assert.equal(store.getAccountByHostedConnectionId("hosted-connection-v7-fork")?.id, fork.id);
    assert.deepEqual(
      store.listConnectionSources({ connectionId: fork.id }).map((source) => ({
        displayName: source.displayName,
        sourceInstanceKey: source.sourceInstanceKey,
        status: source.status,
      })),
      [{
        displayName: "Canonical WHOOP",
        sourceInstanceKey: "src_shared_whoop",
        status: "disconnected",
      }, {
        displayName: "Original Garmin",
        sourceInstanceKey: "src_original_garmin",
        status: "connected",
      }],
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store migrates existing token-only credential rows as oauth token credentials", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-credential-migration");
  const databasePath = path.join(tempDir, "state.sqlite");
  const database = openSqliteRuntimeDatabase(databasePath);

  database.exec(`
    create table device_connection (
      id text primary key,
      provider text not null,
      external_account_id text not null,
      display_name text,
      status text not null,
      scopes_json text not null,
      disconnect_generation integer not null default 0,
      metadata_json text not null,
      connected_at text not null,
      created_at text not null,
      updated_at text not null,
      unique (provider, external_account_id)
    );

    create table device_credential_state (
      account_id text primary key references device_connection(id) on delete cascade,
      access_token_encrypted text not null,
      refresh_token_encrypted text,
      access_token_expires_at text,
      created_at text not null,
      updated_at text not null
    );

    create table device_observation_state (
      account_id text primary key references device_connection(id) on delete cascade,
      hosted_observed_updated_at text,
      hosted_observed_connection_revision integer not null default 0,
      hosted_observed_token_version integer,
      hosted_observed_token_revision integer not null default 0,
      local_connection_revision integer not null default 0,
      local_token_revision integer not null default 0,
      last_webhook_at text,
      last_sync_started_at text,
      last_sync_completed_at text,
      last_sync_error_at text,
      last_error_code text,
      last_error_message text,
      next_reconcile_at text,
      created_at text not null,
      updated_at text not null
    );

    insert into device_connection (
      id,
      provider,
      external_account_id,
      display_name,
      status,
      scopes_json,
      metadata_json,
      connected_at,
      created_at,
      updated_at
    ) values (
      'dsa_legacy',
      'oura',
      'oura-legacy',
      'Legacy Oura',
      'active',
      '["daily"]',
      '{}',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z'
    );

    insert into device_credential_state (
      account_id,
      access_token_encrypted,
      refresh_token_encrypted,
      access_token_expires_at,
      created_at,
      updated_at
    ) values (
      'dsa_legacy',
      'enc:legacy-access',
      'enc:legacy-refresh',
      '2026-04-07T02:00:00.000Z',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z'
    );

    insert into device_observation_state (
      account_id,
      created_at,
      updated_at
    ) values (
      'dsa_legacy',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z'
    );

    pragma user_version = 1;
  `);
  database.close();

  const store = new SqliteDeviceSyncStore(databasePath);

  try {
    const migrated = store.getAccountById("dsa_legacy");
    assert.ok(migrated);
    const migratedOAuthCredential = requireStoredOAuthCredential(migrated);
    assert.equal(migratedOAuthCredential.accessTokenEncrypted, "enc:legacy-access");
    assert.equal(migratedOAuthCredential.refreshTokenEncrypted, "enc:legacy-refresh");
    assert.equal(migrated?.accessTokenExpiresAt, "2026-04-07T02:00:00.000Z");
    const migratedCredential = readCredentialStateForTesting(store, "dsa_legacy");
    assert.ok(migratedCredential);
    assert.deepEqual({ ...migratedCredential }, {
      access_token_encrypted: "enc:legacy-access",
      access_token_expires_at: "2026-04-07T02:00:00.000Z",
      credential_kind: "oauth_tokens",
      credential_metadata_json: "{}",
      provider_config_key: null,
      refresh_token_encrypted: "enc:legacy-refresh",
    });
  } finally {
    store.close();
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

    setConnectionScopesJsonForTesting(store, account.id, "{not-json");

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
      consumedAt: "2026-04-07T00:05:00.000Z",
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
      status: "replayed",
      consumedAt: "2026-04-07T00:05:00.000Z",
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
    assert.equal(
      store.deleteExpiredOAuthStates("2026-04-07T00:10:00.000Z"),
      0,
    );
    assert.deepEqual(store.consumeOAuthState("active-state", "2026-04-07T00:20:00.000Z"), {
      status: "recovery_required",
      consumedAt: "2026-04-07T00:05:00.000Z",
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
    assert.equal(
      store.resolveOAuthStateWithoutProviderAuthority({
        state: "active-state",
        consumedAt: "2026-04-07T00:05:00.000Z",
      }),
      true,
    );
    assert.deepEqual(store.consumeOAuthState("active-state", "2026-04-07T00:10:01.000Z"), {
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

test("device sync store commits a connection and exact OAuth claim resolution atomically", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-oauth-connection-atomic");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const record = {
      state: "atomic-state",
      provider: "demo",
      returnTo: "/devices",
      metadata: {},
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:10:00.000Z",
    };
    store.createOAuthState(record);
    const consumed = store.consumeOAuthState(
      record.state,
      "2026-04-07T00:05:00.000Z",
      record.provider,
    );
    assert.equal(consumed.status, "consumed");
    if (consumed.status !== "consumed") {
      throw new Error("Expected an exact consumed OAuth claim.");
    }

    assert.throws(
      () => store.upsertAccount({
        provider: "demo",
        externalAccountId: "rolled-back-account",
        scopes: [],
        tokens: {
          accessToken: "rolled-back-access",
          accessTokenEncrypted: "enc:rolled-back-access",
        },
        connectedAt: "2026-04-07T00:06:00.000Z",
        oauthClaim: {
          state: record.state,
          consumedAt: "2026-04-07T00:05:01.000Z",
        },
      }),
      (error: unknown) => error instanceof DeviceSyncError && error.code === "OAUTH_STATE_CHANGED",
    );
    assert.equal(store.getAccountByExternalAccount("demo", "rolled-back-account"), null);
    assert.equal(
      store.consumeOAuthState(
        record.state,
        "2026-04-07T00:07:00.000Z",
        record.provider,
      ).status,
      "replayed",
    );

    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "committed-account",
      scopes: [],
      tokens: {
        accessToken: "committed-access",
        accessTokenEncrypted: "enc:committed-access",
      },
      connectedAt: "2026-04-07T00:08:00.000Z",
      oauthClaim: {
        state: record.state,
        consumedAt: consumed.consumedAt,
      },
    });
    assert.equal(account.externalAccountId, "committed-account");
    assert.deepEqual(
      store.consumeOAuthState(record.state, "2026-04-07T00:09:00.000Z"),
      { status: "missing" },
    );
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
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
        consumedAt: "2026-04-07T00:05:01.000Z",
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

test("device sync store preserves OAuth state on owner mismatch and returns owner binding when consumed", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-owner-mismatch");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    store.createOAuthState({
      state: "owner-bound-state",
      provider: "demo",
      ownerId: "member_a",
      returnTo: "/devices",
      metadata: {
        intent: "connect",
      },
      createdAt: "2026-04-07T00:00:00.000Z",
      expiresAt: "2026-04-07T00:10:00.000Z",
    });

    assert.deepEqual(
      store.consumeOAuthState(
        "owner-bound-state",
        "2026-04-07T00:05:00.000Z",
        "demo",
        "member_b",
      ),
      {
        status: "owner_mismatch",
      },
    );
    assert.deepEqual(
      store.consumeOAuthState(
        "owner-bound-state",
        "2026-04-07T00:05:01.000Z",
        "demo",
        "member_a",
      ),
      {
        status: "consumed",
        consumedAt: "2026-04-07T00:05:01.000Z",
        record: {
          state: "owner-bound-state",
          provider: "demo",
          ownerId: "member_a",
          returnTo: "/devices",
          metadata: {
            intent: "connect",
          },
          createdAt: "2026-04-07T00:00:00.000Z",
          expiresAt: "2026-04-07T00:10:00.000Z",
        },
      },
    );
    assert.deepEqual(
      store.consumeOAuthState(
        "owner-bound-state",
        "2026-04-07T00:05:02.000Z",
        "demo",
        "member_a",
      ),
      {
        status: "replayed",
        consumedAt: "2026-04-07T00:05:01.000Z",
        record: {
          state: "owner-bound-state",
          provider: "demo",
          ownerId: "member_a",
          returnTo: "/devices",
          metadata: {
            intent: "connect",
          },
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

test("device sync store migrates existing OAuth state tables to preserve owner binding", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-oauth-owner-migration");
  const databasePath = path.join(tempDir, "state.sqlite");
  const database = openSqliteRuntimeDatabase(databasePath);

  database.exec(`
    create table oauth_state (
      state text primary key,
      provider text not null,
      return_to text,
      metadata_json text not null,
      created_at text not null,
      expires_at text not null
    );

    insert into oauth_state (
      state,
      provider,
      return_to,
      metadata_json,
      created_at,
      expires_at
    ) values (
      'legacy-state',
      'demo',
      '/devices',
      '{}',
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T00:10:00.000Z'
    );

    pragma user_version = 5;
  `);
  database.close();

  const store = new SqliteDeviceSyncStore(databasePath);

  try {
    assert.deepEqual(
      store.consumeOAuthState(
        "legacy-state",
        "2026-04-07T00:05:00.000Z",
        "demo",
        "member_a",
      ),
      {
        status: "owner_mismatch",
      },
    );
    assert.deepEqual(store.consumeOAuthState("legacy-state", "2026-04-07T00:05:01.000Z", "demo"), {
      status: "consumed",
      consumedAt: "2026-04-07T00:05:01.000Z",
      record: {
        state: "legacy-state",
        provider: "demo",
        returnTo: "/devices",
        metadata: {},
        createdAt: "2026-04-07T00:00:00.000Z",
        expiresAt: "2026-04-07T00:10:00.000Z",
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

test("device sync store clears next reconcile when sync failure preserves an existing terminal status", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-terminal-failure");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-terminal-failure",
      displayName: "Demo",
      scopes: ["offline"],
      status: "reauthorization_required",
      tokens: {
        accessToken: "terminal-access",
        accessTokenEncrypted: "enc:terminal-access",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T02:00:00.000Z",
    });

    store.markSyncFailed(
      account.id,
      "2026-04-07T01:00:00.000Z",
      "SYNC_FAILED",
      "Sync failed.",
      null,
    );

    const failed = store.getAccountById(account.id);
    assert.equal(failed?.status, "reauthorization_required");
    assert.equal(failed?.lastErrorCode, "SYNC_FAILED");
    assert.equal(failed?.lastErrorMessage, "Sync failed.");
    assert.equal(failed?.nextReconcileAt, null);
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
    const hydratedOAuthCredential = requireStoredOAuthCredential(hydrated);
    assert.equal(hydratedOAuthCredential.accessTokenEncrypted, "enc:hosted-access");
    assert.equal(hydratedOAuthCredential.refreshTokenEncrypted, null);
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
    assert.deepEqual(
      store.failJobIfOwned(
        job.id,
        "worker-a",
        "2026-04-07T01:01:00.000Z",
        "LEASE_EXPIRED",
        "stale worker should not transition expired leases",
        "2026-04-07T01:05:00.000Z",
        true,
        false,
        { windowStart: "2026-04-08T00:00:00.000Z" },
      ),
      null,
    );
    assert.equal(store.getJobById(job.id)?.status, "running");
    assert.deepEqual(store.getJobById(job.id)?.payload, {});
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

test("device sync store retains failed setup tokens until confirmed provider revocation", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-setup-failed");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    assert.deepEqual(
      store.markConnectionSetupFailed(
        "missing-account",
        null,
        "2026-04-07T00:30:00.000Z",
        "OAUTH_DENIED",
        "operator denied access",
      ),
      {
        account: null,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: null,
      },
    );

    const account = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-setup-failed",
      displayName: "Setup Failed",
      scopes: ["offline"],
      tokens: {
        accessToken: "setup-access",
        accessTokenEncrypted: "enc:setup-access",
        refreshToken: "setup-refresh",
        refreshTokenEncrypted: "enc:setup-refresh",
        accessTokenExpiresAt: "2026-04-07T02:00:00.000Z",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T01:00:00.000Z",
    });
    store.markWebhookReceived(account.id, "2026-04-07T00:20:00.000Z");

    const failed = store.markConnectionSetupFailed(
      account.id,
      account.connectedAt,
      "2026-04-07T00:30:00.000Z",
      "OAUTH_DENIED",
      "operator denied access",
    );

    assert.equal(failed.applied, true);
    assert.equal(failed.account?.id, account.id);
    assert.equal(failed.account?.status, "reauthorization_required");
    assertStoredCredentialKind(failed.account, "oauth_tokens");
    assert.equal(failed.account?.accessTokenExpiresAt, "2026-04-07T02:00:00.000Z");
    assert.equal(failed.account?.lastSyncErrorAt, "2026-04-07T00:30:00.000Z");
    assert.equal(failed.account?.lastErrorCode, "OAUTH_DENIED");
    assert.equal(failed.account?.lastErrorMessage, "operator denied access");
    assert.equal(failed.account?.nextReconcileAt, null);
    assert.equal(failed.account?.localConnectionRevision, account.localConnectionRevision + 1);
    assert.equal(failed.account?.localTokenRevision, account.localTokenRevision);

    let credentialState = readCredentialStateForTesting(store, account.id);
    assert.ok(credentialState);
    assert.deepEqual({ ...credentialState }, {
      access_token_encrypted: "enc:setup-access",
      access_token_expires_at: "2026-04-07T02:00:00.000Z",
      credential_kind: "oauth_tokens",
      credential_metadata_json: "{}",
      provider_config_key: null,
      refresh_token_encrypted: "enc:setup-refresh",
    });
    let observationState = readObservationStateForTesting(store, account.id);
    assert.ok(observationState);
    assert.deepEqual({ ...observationState }, {
      hosted_observed_connection_revision: 0,
      hosted_observed_token_revision: 0,
      hosted_observed_token_version: null,
      hosted_observed_updated_at: null,
      last_error_code: "OAUTH_DENIED",
      last_webhook_at: "2026-04-07T00:20:00.000Z",
      local_connection_revision: account.localConnectionRevision + 1,
      local_token_revision: account.localTokenRevision,
      next_reconcile_at: null,
    });

    assert.equal(
      store.clearOAuthCredentialAfterConfirmedRevoke(
        account.id,
        account.connectedAt,
        account.localTokenRevision,
        "2026-04-07T00:31:00.000Z",
      ),
      true,
    );
    const cleared = store.getAccountById(account.id);
    assertStoredCredentialKind(cleared, "none");
    assert.equal(cleared?.accessTokenExpiresAt, null);
    assert.equal(cleared?.localConnectionRevision, account.localConnectionRevision + 2);
    assert.equal(cleared?.localTokenRevision, account.localTokenRevision + 1);

    credentialState = readCredentialStateForTesting(store, account.id);
    assert.ok(credentialState);
    assert.deepEqual({ ...credentialState }, {
      access_token_encrypted: null,
      access_token_expires_at: null,
      credential_kind: "none",
      credential_metadata_json: "{}",
      provider_config_key: null,
      refresh_token_encrypted: null,
    });
    observationState = readObservationStateForTesting(store, account.id);
    assert.ok(observationState);
    assert.equal(
      observationState.local_connection_revision,
      account.localConnectionRevision + 2,
    );
    assert.equal(
      observationState.local_token_revision,
      account.localTokenRevision + 1,
    );

    const raceAccount = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-setup-disconnected",
      displayName: "Disconnected Setup",
      scopes: ["offline"],
      setupPhase: "pending_link",
      tokens: {
        accessToken: "race-access",
        accessTokenEncrypted: "enc:race-access",
        refreshToken: "race-refresh",
        refreshTokenEncrypted: "enc:race-refresh",
      },
      connectedAt: "2026-04-07T00:00:00.000Z",
      nextReconcileAt: "2026-04-07T01:00:00.000Z",
    });
    const disconnected = store.disconnectAccount(raceAccount.id, "2026-04-07T00:20:00.000Z");
    const blockedFailure = store.markConnectionSetupFailed(
      raceAccount.id,
      raceAccount.connectedAt,
      "2026-04-07T00:30:00.000Z",
      "OAUTH_DENIED",
      "operator denied access",
    );

    assert.equal(blockedFailure.applied, false);
    assert.equal(blockedFailure.account?.status, "disconnected");
    assert.equal(blockedFailure.account?.setupPhase, null);
    assertStoredCredentialKind(blockedFailure.account, "none");
    assert.equal(blockedFailure.account?.disconnectGeneration, disconnected.disconnectGeneration);
    assert.equal(blockedFailure.account?.localConnectionRevision, disconnected.localConnectionRevision);
    assert.equal(blockedFailure.account?.localTokenRevision, disconnected.localTokenRevision);
    assert.equal(blockedFailure.account?.lastErrorCode, null);

    const epochOne = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-setup-epoch",
      displayName: "Setup Epoch One",
      scopes: ["offline"],
      tokens: {
        accessToken: "epoch-one-access",
        accessTokenEncrypted: "enc:epoch-one-access",
        refreshToken: "epoch-one-refresh",
        refreshTokenEncrypted: "enc:epoch-one-refresh",
      },
      connectedAt: "2026-04-07T00:40:00.000Z",
      nextReconcileAt: "2026-04-07T01:40:00.000Z",
    });
    const epochTwo = store.upsertAccount({
      provider: "demo",
      externalAccountId: "demo-setup-epoch",
      displayName: "Setup Epoch Two",
      scopes: ["offline"],
      tokens: {
        accessToken: "epoch-two-access",
        accessTokenEncrypted: "enc:epoch-two-access",
        refreshToken: "epoch-two-refresh",
        refreshTokenEncrypted: "enc:epoch-two-refresh",
      },
      connectedAt: "2026-04-07T00:45:00.000Z",
      nextReconcileAt: "2026-04-07T01:45:00.000Z",
    });
    assert.throws(
      () =>
        store.upsertAccount({
          provider: "demo",
          externalAccountId: "demo-setup-epoch",
          displayName: "Stale Setup Epoch",
          scopes: ["offline"],
          tokens: {
            accessToken: "stale-epoch-access",
            accessTokenEncrypted: "enc:stale-epoch-access",
          },
          existingAccountGuard: {
            expectedAccountId: epochOne.id,
            expectedConnectedAt: epochOne.connectedAt,
            rejectIfDisconnected: true,
          },
          connectedAt: "2026-04-07T00:50:00.000Z",
          nextReconcileAt: null,
        }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "CONNECTION_SEEDED_ACCOUNT_CHANGED",
    );
    const guardedEpoch = store.getAccountById(epochTwo.id);
    assert.equal(guardedEpoch?.updatedAt, epochTwo.updatedAt);
    assert.equal(guardedEpoch?.displayName, "Setup Epoch Two");
    assert.equal(
      requireStoredOAuthCredential(guardedEpoch).accessTokenEncrypted,
      "enc:epoch-two-access",
    );
    const staleFailure = store.markConnectionSetupFailed(
      epochTwo.id,
      epochOne.connectedAt,
      "2026-04-07T00:50:00.000Z",
      "OAUTH_DENIED",
      "stale setup failure",
    );

    assert.equal(staleFailure.applied, false);
    assert.equal(staleFailure.account?.status, "active");
    assert.equal(staleFailure.account?.updatedAt, epochTwo.updatedAt);
    assertStoredCredentialKind(staleFailure.account, "oauth_tokens");
    assert.equal(staleFailure.account?.lastErrorCode, null);
    assert.equal(
      store.clearOAuthCredentialAfterConfirmedRevoke(
        epochTwo.id,
        epochOne.connectedAt,
        epochOne.localTokenRevision,
        "2026-04-07T00:51:00.000Z",
      ),
      false,
    );
    assert.equal(
      requireStoredOAuthCredential(store.getAccountById(epochTwo.id)).accessTokenEncrypted,
      "enc:epoch-two-access",
    );
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store preserves guarded Junction historical progress across callback replacement", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-junction-callback-metadata");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const seeded = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-guarded-callback",
      displayName: "Junction",
      status: "active",
      setupPhase: "pending_link",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {
        callbackOutcome: "seeded",
        seedOnlyState: "discard",
      },
      connectedAt: "2026-04-03T00:00:00.000Z",
      nextReconcileAt: null,
    });
    store.patchAccount(seeded.id, {
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 2,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:30:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        junctionHistoricalBackfillEvidence:
          "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
      },
    });

    const completed = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-guarded-callback",
      displayName: "Junction",
      status: "active",
      setupPhase: "link_returned",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      metadata: {
        callbackOutcome: "complete",
      },
      existingAccountGuard: {
        expectedAccountId: seeded.id,
        expectedConnectedAt: seeded.connectedAt,
        rejectIfDisconnected: true,
      },
      connectedAt: seeded.connectedAt,
      nextReconcileAt: null,
    });

    assert.equal(completed.id, seeded.id);
    assert.deepEqual(completed.metadata, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 2,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:30:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
      callbackOutcome: "complete",
    });
  } finally {
    store.close();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});

test("device sync store never promotes pending setup from ordinary sync success", async () => {
  const tempDir = await makeTempDirectory("murph-device-syncd-store-pending-sync");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));

  try {
    const pending = store.upsertAccount({
      provider: "junction",
      externalAccountId: "junction-pending-sync",
      displayName: "Junction",
      status: "active",
      setupPhase: "pending_link",
      setupExpiresAt: "2026-04-03T00:15:00.000Z",
      scopes: [],
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      connectedAt: "2026-04-03T00:00:00.000Z",
      nextReconcileAt: null,
    });

    assert.equal(
      store.markSyncSucceeded(
        pending.id,
        "2026-04-03T00:05:00.000Z",
        pending.disconnectGeneration,
      ),
      true,
    );

    const after = store.getAccountById(pending.id);
    assert.equal(after?.status, "active");
    assert.equal(after?.setupPhase, "pending_link");
    assert.equal(after?.setupExpiresAt, "2026-04-03T00:15:00.000Z");
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
    const updatedOAuthCredential = requireStoredOAuthCredential(updated);
    assert.equal(updatedOAuthCredential.accessTokenEncrypted, "enc:updated-access");
    assert.equal(updatedOAuthCredential.refreshTokenEncrypted, null);
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
    assert.ok(refreshed);

    const refreshedOAuthCredential = requireStoredOAuthCredential(refreshed);
    assert.equal(refreshedOAuthCredential.accessTokenEncrypted, "enc:fresh-access");
    assert.equal(refreshedOAuthCredential.refreshTokenEncrypted, "enc:fresh-refresh");
    const successRevision = refreshed.localConnectionRevision;
    const concurrentlyPatched = store.patchAccount(updated.id, {
      metadata: {
        concurrent: true,
      },
      nextReconcileAt: "2026-04-07T07:00:00.000Z",
    });
    assert.notEqual(concurrentlyPatched.localConnectionRevision, successRevision);
    assert.equal(
      store.markSyncSucceeded(updated.id, "2026-04-07T06:00:00.000Z", updated.disconnectGeneration, {
        localConnectionRevision: successRevision,
        metadataPatch: {
          staleSuccess: true,
        },
        nextReconcileAt: "2026-04-07T08:00:00.000Z",
      }),
      false,
    );
    const afterStaleSuccess = store.getAccountById(updated.id);
    assert.equal(afterStaleSuccess?.lastSyncCompletedAt, null);
    assert.equal(afterStaleSuccess?.nextReconcileAt, "2026-04-07T07:00:00.000Z");
    assert.deepEqual(afterStaleSuccess?.metadata, {
      fresh: true,
      concurrent: true,
    });
    assert.equal(
      store.markSyncSucceeded(updated.id, "2026-04-07T06:30:00.000Z", updated.disconnectGeneration, {
        localConnectionRevision: concurrentlyPatched.localConnectionRevision,
        metadataPatch: {
          success: true,
        },
        nextReconcileAt: "2026-04-07T09:00:00.000Z",
      }),
      true,
    );
    const afterCurrentSuccess = store.getAccountById(updated.id);
    assert.equal(afterCurrentSuccess?.lastSyncCompletedAt, "2026-04-07T06:30:00.000Z");
    assert.equal(afterCurrentSuccess?.nextReconcileAt, "2026-04-07T09:00:00.000Z");
    assert.deepEqual(afterCurrentSuccess?.metadata, {
      fresh: true,
      concurrent: true,
      success: true,
    });
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

function normalizeWebhookTraceRow(
  row: ReturnType<typeof readWebhookTraceRowForTesting>,
): ReturnType<typeof readWebhookTraceRowForTesting> {
  return row ? { ...row } : null;
}
