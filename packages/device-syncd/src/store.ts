import type { DatabaseSync } from "node:sqlite";

import {
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  withImmediateTransaction,
} from "@murphai/runtime-state/node";

import {
  decodeDeviceSyncSummaryRow,
  disconnectAccount as disconnectStoredAccount,
  disconnectAccountIfCurrentInTransaction as disconnectStoredAccountIfCurrentInTransaction,
  getAccountByExternalAccount as getStoredAccountByExternalAccount,
  getAccountByHostedConnectionId as getStoredAccountByHostedConnectionId,
  getAccountById as getStoredAccountById,
  getHostedConnectionIdForAccountId as getStoredHostedConnectionIdForAccountId,
  getUnboundAccountByConnectionEpoch as getStoredUnboundAccountByConnectionEpoch,
  listAccounts as listStoredAccounts,
  patchAccount as patchStoredAccount,
  updateAccountTokens as updateStoredAccountTokens,
  upsertAccount as upsertStoredAccount,
} from "./store/accounts.ts";
import type {
  AccountPatchInput,
  AccountUpsertInput,
} from "./store/accounts.ts";
import {
  hydrateHostedAccount as hydrateStoredHostedAccount,
} from "./store/hosted-account-hydration.ts";
import type {
  HostedAccountHydrationInput,
} from "./store/hosted-account-hydration.ts";
import type { DeviceSyncEnqueueJobInput } from "./store/jobs.ts";
import {
  claimDeviceSyncJobBatchCandidatesIfSeedOwned,
  claimDueDeviceSyncJob,
  completeDeviceSyncJob,
  completeDeviceSyncJobIfOwned,
  completeDeviceSyncJobsIfOwned,
  completeDeviceSyncJobsIfOwnedInTransaction,
  continueDeviceSyncJobIfOwnedInTransaction,
  enqueueDeviceSyncJobInTransaction,
  failDeviceSyncJob,
  failDeviceSyncJobIfOwned,
  getDeviceSyncJobById,
  listDueDeviceSyncJobBatchCandidates,
  markPendingDeviceSyncJobsDeadForAccount,
  markPendingDeviceSyncJobsDeadForAccountIfCurrent,
  readNextDeviceSyncJobWakeAt,
  readNextDeviceSyncJobWakeAtForAccount,
  releaseDeviceSyncJobIfOwned,
} from "./store/jobs.ts";
import {
  consumeOAuthState,
  createOAuthState,
  deleteExpiredOAuthStates,
} from "./store/oauth-states.ts";
import {
  DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
  ensureDeviceSyncStoreSchema,
} from "./store/schema.ts";
import {
  listConnectionSources as listStoredConnectionSources,
  markConnectionSourceDataReceived as markStoredConnectionSourceDataReceived,
  upsertConnectionSource as upsertStoredConnectionSource,
  upsertConnectionSourceInTransaction as upsertStoredConnectionSourceInTransaction,
} from "./store/sources.ts";
import {
  markSyncFailed as markStoredSyncFailed,
  markConnectionSetupFailed as markStoredConnectionSetupFailed,
  markSyncStarted as markStoredSyncStarted,
  markSyncSucceeded as markStoredSyncSucceeded,
  markSyncSucceededInTransaction as markStoredSyncSucceededInTransaction,
  patchSyncContinuationMetadataInTransaction as patchStoredSyncContinuationMetadataInTransaction,
  markWebhookReceived as markStoredWebhookReceived,
  readNextActiveReconcileAt as readNextStoredActiveReconcileAt,
} from "./store/sync-state.ts";
import {
  claimDeviceSyncWebhookTrace,
  completeDeviceSyncWebhookTrace,
  releaseDeviceSyncWebhookTrace,
} from "./store/webhook-traces.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  ConsumeOAuthStateResult,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncAccountStatus,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncServiceSummary,
  ListDeviceConnectionSourcesInput,
  ListDeviceSyncAccountsInput,
  OAuthStateRecord,
  ProviderAuthTokens,
  StoredDeviceConnectionSource,
  StoredDeviceSyncAccount,
  UpsertDeviceConnectionSourceInput,
} from "./types.ts";

class DeviceSyncSuccessFenceRejectedError extends Error {
  constructor() {
    super("Device sync success fence rejected.");
    this.name = "DeviceSyncSuccessFenceRejectedError";
  }
}

export class SqliteDeviceSyncStore {
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    const database = openSqliteRuntimeDatabase(databasePath);
    this.database = database;

    try {
      applySqliteRuntimeMigrations(database, {
        migrations: [
          {
            version: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
            migrate(candidateDatabase: DatabaseSync) {
              ensureDeviceSyncStoreSchema(candidateDatabase);
            },
          },
        ],
        schemaVersion: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
        storeName: "device sync runtime",
      });
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  summarize(): DeviceSyncServiceSummary {
    const row = this.database.prepare(`
      select
        (select count(*) from device_connection) as accounts_total,
        (select count(*) from device_connection where status = 'active') as accounts_active,
        (select count(*) from device_job where status = 'queued') as jobs_queued,
        (select count(*) from device_job where status = 'running') as jobs_running,
        (select count(*) from device_job where status = 'dead') as jobs_dead,
        (select count(*) from oauth_state) as oauth_states,
        (select count(*) from webhook_trace) as webhook_traces
    `).get();
    if (!row) {
      throw new Error("Failed to summarize device sync store.");
    }
    const decodedRow = decodeDeviceSyncSummaryRow(row);

    return {
      accountsTotal: decodedRow.accounts_total,
      accountsActive: decodedRow.accounts_active,
      jobsQueued: decodedRow.jobs_queued,
      jobsRunning: decodedRow.jobs_running,
      jobsDead: decodedRow.jobs_dead,
      oauthStates: decodedRow.oauth_states,
      webhookTraces: decodedRow.webhook_traces,
    };
  }

  createOAuthState(input: OAuthStateRecord): OAuthStateRecord {
    return createOAuthState(this.database, input);
  }

  deleteExpiredOAuthStates(now: string): number {
    return deleteExpiredOAuthStates(this.database, now);
  }

  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): ConsumeOAuthStateResult {
    return consumeOAuthState(this.database, state, now, expectedProvider, expectedOwnerId);
  }

  listAccounts(input: ListDeviceSyncAccountsInput | string = {}): StoredDeviceSyncAccount[] {
    return listStoredAccounts(
      this.database,
      normalizeAccountListInput(input),
    ).map((account) => this.hydrateAccountSources(account));
  }

  getAccountById(accountId: string): StoredDeviceSyncAccount | null {
    const account = getStoredAccountById(this.database, accountId);
    return account ? this.hydrateAccountSources(account) : null;
  }

  getAccountByExternalAccount(provider: string, externalAccountId: string): StoredDeviceSyncAccount | null {
    const account = getStoredAccountByExternalAccount(this.database, provider, externalAccountId);
    return account ? this.hydrateAccountSources(account) : null;
  }

  getAccountByHostedConnectionId(hostedConnectionId: string): StoredDeviceSyncAccount | null {
    const account = getStoredAccountByHostedConnectionId(this.database, hostedConnectionId);
    return account ? this.hydrateAccountSources(account) : null;
  }

  getHostedConnectionIdForAccountId(accountId: string): string | null {
    return getStoredHostedConnectionIdForAccountId(this.database, accountId);
  }

  getUnboundAccountByConnectionEpoch(
    provider: string,
    connectedAt: string,
  ): StoredDeviceSyncAccount | null {
    const account = getStoredUnboundAccountByConnectionEpoch(
      this.database,
      provider,
      connectedAt,
    );
    return account ? this.hydrateAccountSources(account) : null;
  }

  upsertAccount(input: AccountUpsertInput): StoredDeviceSyncAccount {
    return upsertStoredAccount(this.database, input);
  }

  patchAccount(accountId: string, patch: AccountPatchInput): StoredDeviceSyncAccount {
    return patchStoredAccount(this.database, accountId, patch);
  }

  upsertConnectionSource(input: UpsertDeviceConnectionSourceInput): StoredDeviceConnectionSource {
    return upsertStoredConnectionSource(this.database, input);
  }

  listConnectionSources(input: ListDeviceConnectionSourcesInput): StoredDeviceConnectionSource[] {
    return listStoredConnectionSources(this.database, input);
  }

  private hydrateAccountSources(account: StoredDeviceSyncAccount): StoredDeviceSyncAccount {
    const sources = listStoredConnectionSources(this.database, {
      connectionId: account.id,
    }).map((source) => ({
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lifecycleEpoch: source.lifecycleEpoch,
      lastDataAt: source.lastDataAt,
      lastSeenAt: source.lastSeenAt,
      resourceCount: countConnectionSourceResources(source.resourceAvailabilitySummary),
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    }));

    return {
      ...account,
      sources,
    };
  }

  updateAccountTokens(
    accountId: string,
    tokens: ProviderAuthTokens & { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null },
    disconnectGeneration?: number,
  ): StoredDeviceSyncAccount | null {
    return updateStoredAccountTokens(this.database, accountId, tokens, disconnectGeneration);
  }

  hydrateHostedAccount(input: HostedAccountHydrationInput): StoredDeviceSyncAccount | null {
    return hydrateStoredHostedAccount(this.database, input);
  }

  disconnectAccount(accountId: string, now: string): StoredDeviceSyncAccount {
    return disconnectStoredAccount(this.database, accountId, now);
  }

  disconnectAccountAndMarkPendingJobsDeadIfConnectedAt(input: {
    accountId: string;
    code: string;
    expectedConnectedAt: string;
    message: string;
    now: string;
  }): StoredDeviceSyncAccount | null {
    return withImmediateTransaction(this.database, () => {
      const existing = getStoredAccountById(this.database, input.accountId);
      if (!existing) {
        return null;
      }
      if (existing.connectedAt !== input.expectedConnectedAt) {
        return null;
      }

      const disconnected = existing.status === "disconnected"
        ? existing
        : disconnectStoredAccountIfCurrentInTransaction(
            this.database,
            input.accountId,
            input.now,
            null,
            null,
            input.expectedConnectedAt,
          );

      if (!disconnected) {
        return null;
      }

      markPendingDeviceSyncJobsDeadForAccount(this.database, {
        accountId: input.accountId,
        code: input.code,
        message: input.message,
        now: input.now,
      });
      return disconnected;
    });
  }

  disconnectAccountAndMarkPendingJobsDeadIfCurrent(input: {
    accountId: string;
    code: string;
    expectedLocalConnectionRevision: number;
    expectedStatus: Exclude<DeviceSyncAccountStatus, "disconnected">;
    message: string;
    now: string;
  }): StoredDeviceSyncAccount | null {
    return withImmediateTransaction(this.database, () => {
      const disconnected = disconnectStoredAccountIfCurrentInTransaction(
        this.database,
        input.accountId,
        input.now,
        input.expectedLocalConnectionRevision,
        input.expectedStatus,
        null,
      );

      if (!disconnected) {
        return null;
      }

      markPendingDeviceSyncJobsDeadForAccount(this.database, {
        accountId: input.accountId,
        code: input.code,
        message: input.message,
        now: input.now,
      });
      return disconnected;
    });
  }

  markWebhookReceived(accountId: string, now: string): void {
    markStoredWebhookReceived(this.database, accountId, now);
  }

  markConnectionSourceDataReceived(input: {
    connectionId: string;
    now: string;
    sourceProviderSlug: string;
  }): number {
    return markStoredConnectionSourceDataReceived(this.database, input);
  }

  markSyncStarted(accountId: string, now: string): void {
    markStoredSyncStarted(this.database, accountId, now);
  }

  markSyncSucceeded(
    accountId: string,
    now: string,
    disconnectGeneration: number | null = null,
    options: {
      localConnectionRevision?: number | null;
      metadataPatch?: Record<string, unknown>;
      nextReconcileAt?: string | null;
    } = {},
  ): boolean {
    return markStoredSyncSucceeded(this.database, accountId, now, disconnectGeneration, options);
  }

  markSyncFailed(
    accountId: string,
    now: string,
    code: string,
    message: string,
    status: DeviceSyncAccountStatus | null | undefined,
    options: {
      disconnectGeneration?: number | null;
      localConnectionRevision?: number | null;
      metadataPatch?: Record<string, unknown>;
    } = {},
  ): boolean {
    return markStoredSyncFailed(this.database, accountId, now, code, message, status, options);
  }

  markConnectionSetupFailed(
    accountId: string,
    expectedConnectedAt: string | null,
    now: string,
    code: string,
    message: string,
  ): { account: StoredDeviceSyncAccount | null; applied: boolean } {
    return markStoredConnectionSetupFailed(
      this.database,
      accountId,
      expectedConnectedAt,
      now,
      code,
      message,
    );
  }

  enqueueJob(input: DeviceSyncEnqueueJobInput): DeviceSyncJobRecord {
    return withImmediateTransaction(this.database, () =>
      enqueueDeviceSyncJobInTransaction(this.database, input)
    );
  }

  commitConnectionEstablished(input: {
    accountId: string;
    jobs: readonly DeviceSyncJobInput[];
    provider: string;
    source?: UpsertDeviceConnectionSourceInput | null;
  }): DeviceSyncJobRecord[] {
    return withImmediateTransaction(this.database, () => {
      if (input.source) {
        upsertStoredConnectionSourceInTransaction(this.database, input.source);
      }

      return input.jobs.map((job) =>
        enqueueDeviceSyncJobInTransaction(this.database, {
          provider: input.provider,
          accountId: input.accountId,
          kind: job.kind,
          payload: job.payload ?? {},
          priority: job.priority ?? 0,
          availableAt: job.availableAt,
          maxAttempts: job.maxAttempts,
          dedupeKey: job.dedupeKey,
        })
      );
    });
  }

  enqueueJobsAndCompleteWebhookTrace(input: {
    accountId: string;
    provider: string;
    traceId: string;
    claimToken: string;
    jobs: readonly DeviceSyncJobInput[];
  }): DeviceSyncJobRecord[] {
    return withImmediateTransaction(this.database, () => {
      const queuedJobs = input.jobs.map((job) =>
        enqueueDeviceSyncJobInTransaction(this.database, {
          provider: input.provider,
          accountId: input.accountId,
          kind: job.kind,
          payload: job.payload ?? {},
          priority: job.priority ?? 0,
          availableAt: job.availableAt,
          maxAttempts: job.maxAttempts,
          dedupeKey: job.dedupeKey,
        }),
      );

      const completed = completeDeviceSyncWebhookTrace(
        this.database,
        input.provider,
        input.traceId,
        input.claimToken,
      );
      if (!completed) {
        throw new Error("Device sync webhook trace claim was lost before job enqueue completed.");
      }
      return queuedJobs;
    });
  }

  getJobById(jobId: string): DeviceSyncJobRecord | null {
    return getDeviceSyncJobById(this.database, jobId);
  }

  readNextActiveReconcileAt(): string | null {
    return readNextStoredActiveReconcileAt(this.database);
  }

  readNextJobWakeAt(): string | null {
    return readNextDeviceSyncJobWakeAt(this.database);
  }

  readNextJobWakeAtForAccount(accountId: string): string | null {
    return readNextDeviceSyncJobWakeAtForAccount(this.database, accountId);
  }

  claimDueJob(workerId: string, now: string, leaseMs: number): DeviceSyncJobRecord | null {
    return claimDueDeviceSyncJob(this.database, workerId, now, leaseMs);
  }

  listDueJobBatchCandidates(input: {
    accountId: string;
    excludeJobId: string;
    limit: number;
    now: string;
    provider: string;
  }): DeviceSyncJobRecord[] {
    return listDueDeviceSyncJobBatchCandidates(this.database, input);
  }

  claimJobBatchCandidatesIfSeedOwned(input: {
    accountId: string;
    jobIds: readonly string[];
    leaseMs: number;
    now: string;
    provider: string;
    seedJobId: string;
    workerId: string;
  }): DeviceSyncJobRecord[] {
    return claimDeviceSyncJobBatchCandidatesIfSeedOwned(this.database, input);
  }

  completeJob(jobId: string, now: string): void {
    completeDeviceSyncJob(this.database, jobId, now);
  }

  completeJobIfOwned(jobId: string, workerId: string, now: string): boolean {
    return completeDeviceSyncJobIfOwned(this.database, jobId, workerId, now);
  }

  completeJobsIfOwned(jobIds: readonly string[], workerId: string, now: string): boolean {
    return completeDeviceSyncJobsIfOwned(this.database, {
      jobIds,
      now,
      workerId,
    });
  }

  completeJobsMarkSyncSucceededAndEnqueueJobs(input: {
    accountId: string;
    completedAt: string;
    disconnectGeneration: number | null;
    jobIds: readonly string[];
    jobs: readonly DeviceSyncJobInput[];
    provider: string;
    syncSucceededAt: string;
    syncSuccessOptions: {
      localConnectionRevision?: number | null;
      metadataPatch?: Record<string, unknown>;
      nextReconcileAt?: string | null;
    };
    workerId: string;
  }): boolean {
    try {
      return withImmediateTransaction(this.database, () => {
        const completed = completeDeviceSyncJobsIfOwnedInTransaction(this.database, {
          jobIds: input.jobIds,
          now: input.completedAt,
          workerId: input.workerId,
        });

        if (!completed) {
          return false;
        }

        const markedSucceeded = markStoredSyncSucceededInTransaction(
          this.database,
          input.accountId,
          input.syncSucceededAt,
          input.disconnectGeneration,
          input.syncSuccessOptions,
        );

        if (!markedSucceeded) {
          throw new DeviceSyncSuccessFenceRejectedError();
        }

        for (const job of input.jobs) {
          enqueueDeviceSyncJobInTransaction(this.database, {
            provider: input.provider,
            accountId: input.accountId,
            kind: job.kind,
            payload: job.payload ?? {},
            priority: job.priority ?? 0,
            availableAt: job.availableAt,
            maxAttempts: job.maxAttempts,
            dedupeKey: job.dedupeKey,
          });
        }

        return true;
      });
    } catch (error) {
      if (error instanceof DeviceSyncSuccessFenceRejectedError) {
        return false;
      }

      throw error;
    }
  }

  continueJobAndPatchSyncMetadataIfOwned(input: {
    accountId: string;
    availableAt: string;
    disconnectGeneration: number | null;
    jobId: string;
    localConnectionRevision: number;
    metadataPatch?: Record<string, unknown>;
    now: string;
    payload: Record<string, unknown>;
    workerId: string;
  }): boolean {
    try {
      return withImmediateTransaction(this.database, () => {
        const continued = continueDeviceSyncJobIfOwnedInTransaction(this.database, {
          availableAt: input.availableAt,
          jobId: input.jobId,
          now: input.now,
          payload: input.payload,
          workerId: input.workerId,
        });

        if (!continued) {
          return false;
        }

        const patched = patchStoredSyncContinuationMetadataInTransaction(
          this.database,
          input.accountId,
          input.now,
          input.disconnectGeneration,
          {
            localConnectionRevision: input.localConnectionRevision,
            ...(input.metadataPatch ? { metadataPatch: input.metadataPatch } : {}),
          },
        );

        if (!patched) {
          throw new DeviceSyncSuccessFenceRejectedError();
        }

        return true;
      });
    } catch (error) {
      if (error instanceof DeviceSyncSuccessFenceRejectedError) {
        return false;
      }

      throw error;
    }
  }

  releaseJobIfOwned(jobId: string, workerId: string, now: string): boolean {
    return releaseDeviceSyncJobIfOwned(this.database, {
      jobId,
      now,
      workerId,
    });
  }

  failJob(
    jobId: string,
    now: string,
    code: string,
    message: string,
    retryAt: string | null,
    retryable: boolean,
  ): void {
    failDeviceSyncJob(this.database, {
      code,
      jobId,
      message,
      now,
      retryAt,
      retryable,
    });
  }

  failJobIfOwned(
    jobId: string,
    workerId: string,
    now: string,
    code: string,
    message: string,
    retryAt: string | null,
    retryable: boolean,
    retainUntilSuccess = false,
  ): boolean {
    return failDeviceSyncJobIfOwned(this.database, {
      code,
      jobId,
      message,
      now,
      retryAt,
      retryable,
      retainUntilSuccess,
      workerId,
    });
  }

  markPendingJobsDeadForAccount(accountId: string, now: string, code: string, message: string): number {
    return markPendingDeviceSyncJobsDeadForAccount(this.database, {
      accountId,
      code,
      message,
      now,
    });
  }

  markPendingJobsDeadForAccountIfCurrent(input: {
    accountId: string;
    code: string;
    expectedLocalConnectionRevision: number;
    expectedStatus: Extract<DeviceSyncAccountStatus, "disconnected" | "reauthorization_required">;
    message: string;
    now: string;
  }): number {
    return markPendingDeviceSyncJobsDeadForAccountIfCurrent(this.database, input);
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    return claimDeviceSyncWebhookTrace(this.database, input);
  }

  completeWebhookTrace(provider: string, traceId: string, claimToken: string): boolean {
    return completeDeviceSyncWebhookTrace(this.database, provider, traceId, claimToken);
  }

  releaseWebhookTrace(provider: string, traceId: string, claimToken: string): void {
    releaseDeviceSyncWebhookTrace(this.database, provider, traceId, claimToken);
  }
}

const CONNECTION_SOURCE_SUMMARY_METADATA_KEYS = new Set([
  "sourceInstanceKeyFallback",
]);

function normalizeAccountListInput(
  input: ListDeviceSyncAccountsInput | string,
): ListDeviceSyncAccountsInput {
  if (typeof input === "string") {
    return { provider: input };
  }

  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.sourceProviderSlug ? { sourceProviderSlug: input.sourceProviderSlug } : {}),
  };
}

function countConnectionSourceResources(
  summary: StoredDeviceConnectionSource["resourceAvailabilitySummary"],
): number {
  return Object.entries(summary).filter(([key, value]) =>
    !CONNECTION_SOURCE_SUMMARY_METADATA_KEYS.has(key)
    && value !== false
    && value !== null
    && value !== undefined
  ).length;
}
