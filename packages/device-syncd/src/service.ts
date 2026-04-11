import { createImporters } from "@murphai/importers";

import { createSecretCodec } from "./crypto.ts";
import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { createDeviceSyncPublicIngress, DeviceSyncPublicIngress } from "./public-ingress.ts";
import { toRedactedPublicDeviceSyncAccount } from "./public-account.ts";
import { createDeviceSyncRegistry } from "./registry.ts";
import {
  addMilliseconds,
  computeRetryDelayMs,
  defaultStateDatabasePath,
  generatePrefixedId,
  normalizeOriginList,
  normalizePublicBaseUrl,
  sha256Text,
  stringifyJson,
  toIsoTimestamp,
} from "./shared.ts";
import { SqliteDeviceSyncStore } from "./store.ts";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceSyncAccount,
  DeviceSyncImporterPort,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncRegistry,
  DeviceSyncServiceConfig,
  DeviceSyncServiceSummary,
  DisconnectAccountResult,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  QueueManualReconcileResult,
  StartConnectionInput,
  StoredDeviceSyncAccount,
} from "./types.ts";

class DeviceSyncJobExecutionCancelledError extends Error {
  constructor(readonly accountId: string, readonly jobId: string) {
    super(`Device sync job ${jobId} is no longer active for account ${accountId}.`);
    this.name = "DeviceSyncJobExecutionCancelledError";
  }
}

export interface CreateDeviceSyncServiceInput {
  secret: string;
  config: DeviceSyncServiceConfig;
  providers?: readonly DeviceSyncProvider[];
  registry?: DeviceSyncRegistry;
  importer?: DeviceSyncImporterPort;
  store?: SqliteDeviceSyncStore;
}

export class DeviceSyncService {
  readonly vaultRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly store: SqliteDeviceSyncStore;
  readonly registry: DeviceSyncRegistry;
  readonly publicIngress: DeviceSyncPublicIngress;

  private readonly logger: DeviceSyncLogger;
  private readonly importer: DeviceSyncImporterPort;
  private readonly codec: ReturnType<typeof createSecretCodec>;
  private readonly workerLeaseMs: number;
  private readonly workerPollMs: number;
  private readonly workerBatchSize: number;
  private readonly schedulerPollMs: number;
  private readonly workerId: string;
  private readonly ownsStore: boolean;
  private workerTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private workerTickInFlight = false;
  private schedulerTickInFlight = false;

  constructor(input: CreateDeviceSyncServiceInput) {
    this.vaultRoot = input.config.vaultRoot;
    this.publicBaseUrl = normalizePublicBaseUrl(input.config.publicBaseUrl);
    this.allowedReturnOrigins = normalizeOriginList(input.config.allowedReturnOrigins);
    this.registry = input.registry ?? createDeviceSyncRegistry(input.providers ?? []);
    this.importer = input.importer ?? createDefaultImporterPort();
    this.logger = input.config.log ?? console;
    this.workerLeaseMs = Math.max(60_000, input.config.workerLeaseMs ?? 5 * 60_000);
    this.workerPollMs = Math.max(1_000, input.config.workerPollMs ?? 5_000);
    this.workerBatchSize = Math.max(1, input.config.workerBatchSize ?? 4);
    this.schedulerPollMs = Math.max(5_000, input.config.schedulerPollMs ?? 60_000);
    this.workerId = generatePrefixedId("worker");
    this.store =
      input.store ?? new SqliteDeviceSyncStore(input.config.stateDatabasePath ?? defaultStateDatabasePath(this.vaultRoot));
    this.ownsStore = !input.store;
    this.codec = createSecretCodec(input.secret);
    this.publicIngress = createDeviceSyncPublicIngress({
      publicBaseUrl: this.publicBaseUrl,
      allowedReturnOrigins: this.allowedReturnOrigins,
      registry: this.registry,
      sessionTtlMs: input.config.sessionTtlMs,
      store: {
        deleteExpiredOAuthStates: (now) => this.store.deleteExpiredOAuthStates(now),
        createOAuthState: (record) => this.store.createOAuthState(record),
        consumeOAuthState: (state, now) => this.store.consumeOAuthState(state, now),
        upsertConnection: (record) =>
          this.toPublicAccount(
            this.store.upsertAccount({
              provider: record.provider,
              externalAccountId: record.externalAccountId,
              displayName: record.displayName ?? null,
              status: record.status,
              scopes: record.scopes,
              tokens: this.encryptTokens(record.tokens),
              metadata: record.metadata,
              connectedAt: record.connectedAt,
              nextReconcileAt: record.nextReconcileAt ?? null,
            }),
          ),
        getConnectionByExternalAccount: (provider, externalAccountId) => {
          const account = this.store.getAccountByExternalAccount(provider, externalAccountId);
          return account ? this.toPublicAccount(account) : null;
        },
        claimWebhookTrace: (record) => this.store.claimWebhookTrace(record),
        completeWebhookTrace: (provider, traceId) => this.store.completeWebhookTrace(provider, traceId),
        releaseWebhookTrace: (provider, traceId) => this.store.releaseWebhookTrace(provider, traceId),
        markWebhookReceived: (accountId, now) => this.store.markWebhookReceived(accountId, now),
      },
      hooks: {
        onConnectionEstablished: async ({ account, connection }) => {
          this.enqueueJobs(account, connection.initialJobs ?? []);
        },
        onWebhookAccepted: async ({ account, traceId, webhook }) => {
          this.store.enqueueJobsAndCompleteWebhookTrace({
            accountId: account.id,
            provider: account.provider,
            traceId,
            jobs: webhook.jobs,
          });
        },
      },
      log: this.logger,
    });
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.publicIngress.describeProviders();
  }

  describeProvider(providerName: string | DeviceSyncProvider): PublicProviderDescriptor {
    return this.publicIngress.describeProvider(providerName);
  }

  summarize(): DeviceSyncServiceSummary {
    return this.store.summarize();
  }

  listAccounts(provider?: string): PublicDeviceSyncAccount[] {
    return this.store.listAccounts(provider).map((account) => this.toPublicAccount(account));
  }

  getAccount(accountId: string): PublicDeviceSyncAccount | null {
    const account = this.store.getAccountById(accountId);
    return account ? this.toPublicAccount(account) : null;
  }

  start(): void {
    if (!this.workerTimer) {
      void this.runWorkerBatchOnce();
      this.workerTimer = setInterval(() => {
        void this.runWorkerBatchOnce();
      }, this.workerPollMs);
    }

    if (!this.schedulerTimer) {
      void this.runSchedulerOnce();
      this.schedulerTimer = setInterval(() => {
        void this.runSchedulerOnce();
      }, this.schedulerPollMs);
    }
  }

  stop(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  close(): void {
    this.stop();

    if (this.ownsStore) {
      this.store.close();
    }
  }

  async startConnection(input: StartConnectionInput): Promise<BeginConnectionResult> {
    return await this.publicIngress.startConnection(input);
  }

  async handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult> {
    return this.publicIngress.handleOAuthCallback(input);
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    return this.publicIngress.handleWebhook(providerName, headers, rawBody);
  }

  queueManualReconcile(accountId: string): QueueManualReconcileResult {
    const account = this.requireStoredAccount(accountId);

    if (account.status === "disconnected") {
      throw deviceSyncError({
        code: "ACCOUNT_DISCONNECTED",
        message: "Disconnected device sync accounts must be reconnected before they can be reconciled.",
        retryable: false,
        httpStatus: 409,
      });
    }

    if (account.status === "reauthorization_required") {
      throw deviceSyncError({
        code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
        message: "This device sync account must be reconnected before it can be reconciled.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const provider = this.requireProvider(account.provider);
    const now = toIsoTimestamp(new Date());
    const scheduledJobs = provider.createScheduledJobs?.(account, now).jobs ?? [];
    const jobs = scheduledJobs.length > 0 ? scheduledJobs : [{ kind: "reconcile", priority: 80 }];
    const queuedJobs = this.enqueueJobs(
      account,
      jobs.map((job) => ({
        ...job,
        priority: Math.max(job.priority ?? 0, 80),
        availableAt: now,
        dedupeKey:
          job.dedupeKey ??
          `manual-reconcile:${job.kind}:${sha256Text(stringifyJson(job.payload ?? {}))}`,
      })),
    );
    const primary = queuedJobs[0];

    if (!primary) {
      throw deviceSyncError({
        code: "RECONCILE_JOBS_MISSING",
        message: `Device sync provider ${provider.provider} did not produce any manual reconcile jobs.`,
        retryable: false,
        httpStatus: 500,
      });
    }

    return {
      account: this.toPublicAccount(account),
      job: primary,
      jobs: queuedJobs,
    };
  }

  async disconnectAccount(accountId: string): Promise<DisconnectAccountResult> {
    const account = this.requireStoredAccount(accountId);
    const provider = this.requireProvider(account.provider);
    const now = toIsoTimestamp(new Date());

    if (account.status !== "disconnected") {
      try {
        const decrypted = this.toDecryptedAccount(account);
        await provider.revokeAccess?.(decrypted);
      } catch (error) {
        this.logger.warn?.("Provider revoke access failed during disconnect; continuing local disconnect.", {
          provider: provider.provider,
          accountId: account.id,
          error: summarizeError(error),
        });
      }
    }

    this.store.markPendingJobsDeadForAccount(account.id, now, "ACCOUNT_DISCONNECTED", "Device account disconnected.");
    const disconnected = this.store.disconnectAccount(account.id, now);
    return {
      account: this.toPublicAccount(disconnected),
    };
  }

  getNextWakeAt(_now = toIsoTimestamp(new Date())): string | null {
    const nextWakeAt = earliestIsoTimestamp(
      this.store.readNextActiveReconcileAt(),
      this.store.readNextJobWakeAt(),
    );

    if (!nextWakeAt) {
      return null;
    }

    return nextWakeAt;
  }

  async runSchedulerOnce(): Promise<void> {
    if (this.schedulerTickInFlight) {
      return;
    }

    this.schedulerTickInFlight = true;
    const now = toIsoTimestamp(new Date());

    try {
      for (const account of this.store.listAccounts()) {
        if (account.status !== "active" || !account.nextReconcileAt || Date.parse(account.nextReconcileAt) > Date.parse(now)) {
          continue;
        }

        const provider = this.registry.get(account.provider);

        if (!provider?.createScheduledJobs) {
          continue;
        }

        const schedule = provider.createScheduledJobs(account, now);
        this.enqueueJobs(account, schedule.jobs);
        this.store.patchAccount(account.id, {
          nextReconcileAt: schedule.nextReconcileAt ?? null,
        });
      }
    } catch (error) {
      this.logger.error?.("Device sync scheduler tick failed.", {
        error: summarizeError(error),
      });
    } finally {
      this.schedulerTickInFlight = false;
    }
  }

  async runWorkerOnce(): Promise<DeviceSyncJobRecord | null> {
    const now = toIsoTimestamp(new Date());
    const job = this.store.claimDueJob(this.workerId, now, this.workerLeaseMs);

    if (!job) {
      return null;
    }

    const provider = this.registry.get(job.provider);

    if (!provider) {
      this.store.failJob(job.id, now, "PROVIDER_NOT_REGISTERED", `No device sync provider registered for ${job.provider}.`, null, false);
      return job;
    }

    const storedAccount = this.store.getAccountById(job.accountId);

    if (!storedAccount) {
      this.store.failJob(job.id, now, "ACCOUNT_NOT_FOUND", `Device sync account ${job.accountId} does not exist.`, null, false);
      return job;
    }

    if (storedAccount.status === "disconnected") {
      this.store.completeJob(job.id, now);
      return job;
    }

    if (storedAccount.status === "reauthorization_required") {
      this.store.failJob(
        job.id,
        now,
        "ACCOUNT_REAUTHORIZATION_REQUIRED",
        "Device sync account requires reconnection before queued jobs can run.",
        null,
        false,
      );
      return job;
    }

    this.store.markSyncStarted(storedAccount.id, now);

    const disconnectGeneration = storedAccount.disconnectGeneration;
    const ensureExecutionActive = (): void => {
      const currentJob = this.store.getJobById(job.id);

      if (!currentJob || currentJob.status !== "running" || currentJob.leaseOwner !== this.workerId) {
        throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
      }

      const currentAccount = this.store.getAccountById(storedAccount.id);

      if (!currentAccount || currentAccount.status !== "active" || currentAccount.disconnectGeneration !== disconnectGeneration) {
        throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
      }
    };

    let currentAccount = this.toDecryptedAccount(storedAccount);

    try {
      const result = await provider.executeJob(
        {
          account: currentAccount,
          now,
          importSnapshot: async (snapshot: unknown) => {
            ensureExecutionActive();
            return this.importer.importDeviceProviderSnapshot({
              provider: provider.provider,
              snapshot,
              vaultRoot: this.vaultRoot,
            });
          },
          refreshAccountTokens: async () => {
            ensureExecutionActive();
            const refreshed = await provider.refreshTokens(currentAccount);
            const updated = this.store.updateAccountTokens(
              currentAccount.id,
              this.encryptTokens(refreshed),
              disconnectGeneration,
            );

            if (!updated) {
              throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
            }

            currentAccount = this.toDecryptedAccount(updated);
            return currentAccount;
          },
          logger: this.logger,
        },
        job,
      );

      ensureExecutionActive();

      if (!this.store.completeJobIfOwned(job.id, this.workerId, now)) {
        return job;
      }

      const markedSucceeded = this.store.markSyncSucceeded(storedAccount.id, now, disconnectGeneration, {
        metadataPatch: result.metadataPatch,
        nextReconcileAt: result.nextReconcileAt,
      });

      if (!markedSucceeded) {
        return job;
      }

      this.enqueueJobs(storedAccount, result.scheduledJobs ?? []);
      return job;
    } catch (error) {
      if (error instanceof DeviceSyncJobExecutionCancelledError) {
        this.logger.debug?.("Device sync job side effects skipped because execution was cancelled.", {
          provider: provider.provider,
          accountId: storedAccount.id,
          jobId: job.id,
        });
        return job;
      }

      const failure = normalizeExecutionError(error);
      const retryAt = failure.retryable ? addMilliseconds(now, computeRetryDelayMs(job.attempts)) : null;
      this.store.failJob(job.id, now, failure.code, failure.message, retryAt, failure.retryable);
      this.store.markSyncFailed(storedAccount.id, now, failure.code, failure.message, failure.accountStatus);
      this.logger.warn?.("Device sync job failed.", {
        provider: provider.provider,
        accountId: storedAccount.id,
        jobId: job.id,
        code: failure.code,
        retryable: failure.retryable,
      });
      return job;
    }
  }

  async drainWorker(limit = this.workerBatchSize): Promise<number> {
    let processed = 0;

    for (let index = 0; index < limit; index += 1) {
      const job = await this.runWorkerOnce();

      if (!job) {
        break;
      }

      processed += 1;
    }

    return processed;
  }

  private async runWorkerBatchOnce(): Promise<void> {
    if (this.workerTickInFlight) {
      return;
    }

    this.workerTickInFlight = true;

    try {
      await this.drainWorker(this.workerBatchSize);
    } catch (error) {
      this.logger.error?.("Device sync worker tick failed.", {
        error: summarizeError(error),
      });
    } finally {
      this.workerTickInFlight = false;
    }
  }

  private requireProvider(providerName: string): DeviceSyncProvider {
    const provider = this.registry.get(providerName);

    if (!provider) {
      throw deviceSyncError({
        code: "PROVIDER_NOT_REGISTERED",
        message: `Device sync provider ${providerName} is not registered.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    return provider;
  }

  private requireStoredAccount(accountId: string): StoredDeviceSyncAccount {
    const account = this.store.getAccountById(accountId);

    if (!account) {
      throw deviceSyncError({
        code: "ACCOUNT_NOT_FOUND",
        message: `Device sync account ${accountId} was not found.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    return account;
  }

  private toPublicAccount(account: StoredDeviceSyncAccount): PublicDeviceSyncAccount {
    return toRedactedPublicDeviceSyncAccount(this.toInternalAccountRecord(account));
  }

  private toInternalAccountRecord(account: StoredDeviceSyncAccount): PublicDeviceSyncAccount {
    const {
      accessTokenEncrypted: _accessTokenEncrypted,
      disconnectGeneration: _disconnectGeneration,
      hostedObservedTokenVersion: _hostedObservedTokenVersion,
      hostedObservedUpdatedAt: _hostedObservedUpdatedAt,
      refreshTokenEncrypted: _refreshTokenEncrypted,
      ...internalAccount
    } = account;
    return internalAccount;
  }

  private toDecryptedAccount(account: StoredDeviceSyncAccount): DeviceSyncAccount {
    return {
      disconnectGeneration: account.disconnectGeneration,
      ...this.toInternalAccountRecord(account),
      accessToken: account.accessTokenEncrypted ? this.codec.decrypt(account.accessTokenEncrypted) : "",
      refreshToken: account.refreshTokenEncrypted ? this.codec.decrypt(account.refreshTokenEncrypted) : null,
    };
  }

  private encryptTokens(
    tokens: ProviderAuthTokens,
  ): ProviderAuthTokens & { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null } {
    return {
      ...tokens,
      accessTokenEncrypted: this.codec.encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? this.codec.encrypt(tokens.refreshToken) : null,
    };
  }

  private enqueueJobs(
    account: Pick<PublicDeviceSyncAccount, "id" | "provider">,
    jobs: readonly DeviceSyncJobInput[],
  ): DeviceSyncJobRecord[] {
    return jobs.map((job) =>
      this.store.enqueueJob({
        provider: account.provider,
        accountId: account.id,
        kind: job.kind,
        payload: job.payload ?? {},
        priority: job.priority ?? 0,
        availableAt: job.availableAt,
        maxAttempts: job.maxAttempts,
        dedupeKey: job.dedupeKey,
      }),
    );
  }
}

export function createDefaultImporterPort(): DeviceSyncImporterPort {
  const importers = createImporters();

  return {
    importDeviceProviderSnapshot(input) {
      return importers.importDeviceProviderSnapshot(input);
    },
  };
}

export function createDeviceSyncService(input: CreateDeviceSyncServiceInput): DeviceSyncService {
  return new DeviceSyncService(input);
}

function earliestIsoTimestamp(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function normalizeExecutionError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  accountStatus?: "reauthorization_required" | "disconnected" | null;
} {
  if (isDeviceSyncError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      accountStatus: error.accountStatus,
    };
  }

  if (error instanceof Error) {
    return {
      code: "SYNC_JOB_FAILED",
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: "SYNC_JOB_FAILED",
    message: String(error),
    retryable: false,
  };
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    value: String(error),
  };
}
