import { createImporters } from "@healthybob/importers";

import { createSecretCodec } from "./crypto.js";
import { deviceSyncError, isDeviceSyncError } from "./errors.js";
import { createDeviceSyncPublicIngress, DeviceSyncPublicIngress } from "./public-ingress.js";
import { createDeviceSyncRegistry } from "./registry.js";
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
} from "./shared.js";
import { SqliteDeviceSyncStore } from "./store.js";

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
} from "./types.js";

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
        recordWebhookTraceIfNew: (record) => this.store.recordWebhookTraceIfNew(record),
        markWebhookReceived: (accountId, now) => this.store.markWebhookReceived(accountId, now),
      },
      hooks: {
        onConnectionEstablished: async ({ account, connection }) => {
          this.enqueueJobs(account, connection.initialJobs ?? []);
        },
        onWebhookAccepted: async ({ account, webhook }) => {
          this.enqueueJobs(account, webhook.jobs);
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

  startConnection(input: StartConnectionInput): BeginConnectionResult {
    return this.publicIngress.startConnection(input);
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

    let currentAccount = this.toDecryptedAccount(storedAccount);

    try {
      const result = await provider.executeJob(
        {
          account: currentAccount,
          now,
          importSnapshot: async (snapshot: unknown) =>
            this.importer.importDeviceProviderSnapshot({
              provider: provider.provider,
              snapshot,
              vaultRoot: this.vaultRoot,
            }),
          refreshAccountTokens: async () => {
            const refreshed = await provider.refreshTokens(currentAccount);
            const updated = this.store.updateAccountTokens(currentAccount.id, this.encryptTokens(refreshed));
            currentAccount = this.toDecryptedAccount(updated);
            return currentAccount;
          },
          logger: this.logger,
        },
        job,
      );

      this.store.completeJob(job.id, now);
      this.enqueueJobs(storedAccount, result.scheduledJobs ?? []);
      this.store.markSyncSucceeded(storedAccount.id, now, {
        metadataPatch: result.metadataPatch,
        nextReconcileAt: result.nextReconcileAt,
      });
      return job;
    } catch (error) {
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
    const { accessTokenEncrypted: _accessTokenEncrypted, refreshTokenEncrypted: _refreshTokenEncrypted, ...publicAccount } =
      account;
    return publicAccount;
  }

  private toDecryptedAccount(account: StoredDeviceSyncAccount): DeviceSyncAccount {
    return {
      ...this.toPublicAccount(account),
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
