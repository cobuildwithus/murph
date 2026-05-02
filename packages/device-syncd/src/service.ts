import { createImporters } from "@murphai/importers";

import {
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
} from "./config/provider-manifests.ts";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "./local-secret-codec.ts";
import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";
import { registerDeviceSyncServiceInternals } from "./service-internals.ts";
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
import {
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
} from "./types.ts";

import type {
  BeginConnectionResult,
  CompleteConnectionResult,
  DeviceConnectionHandler,
  DeviceJobExecutor,
  DeviceSyncAccountCredential,
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
  DeviceAccountCredential,
  HandleConnectionCallbackInput,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  ProviderAuthTokens,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  QueueManualReconcileResult,
  StartConnectionInput,
  StoredDeviceSyncAccount,
} from "./types.ts";

export { SqliteDeviceSyncStore } from "./store.ts";

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

export interface DeviceSyncService {
  readonly vaultRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly registry: DeviceSyncRegistry;
  readonly publicIngress: DeviceSyncPublicIngress;
  describeProviders(): PublicProviderDescriptor[];
  describeProvider(providerName: string | DeviceSyncProvider): PublicProviderDescriptor;
  summarize(): DeviceSyncServiceSummary;
  listAccounts(provider?: string): PublicDeviceSyncAccount[];
  getAccount(accountId: string): PublicDeviceSyncAccount | null;
  start(): void;
  stop(): void;
  close(): void;
  startConnection(input: StartConnectionInput): Promise<BeginConnectionResult>;
  handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult>;
  handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult>;
  handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult>;
  getNextWakeAt(now?: string): string | null;
  runSchedulerOnce(): Promise<void>;
  runWorkerOnce(): Promise<DeviceSyncJobRecord | null>;
  drainWorker(limit?: number): Promise<number>;
}

class DeviceSyncServiceController {
  readonly vaultRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly registry: DeviceSyncRegistry;
  readonly publicIngress: DeviceSyncPublicIngress;

  private readonly logger: DeviceSyncLogger;
  private readonly importer: DeviceSyncImporterPort;
  readonly store: SqliteDeviceSyncStore;
  private readonly codec: ReturnType<typeof createSecretCodec>;
  private readonly workerLeaseMs: number;
  private readonly workerPollMs: number;
  private readonly workerBatchSize: number;
  private readonly schedulerPollMs: number;
  private readonly workerId: string;
  private readonly ownsStore: boolean;
  private workerTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  workerTickInFlight = false;
  schedulerTickInFlight = false;

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
        consumeOAuthState: (state, now, expectedProvider) =>
          this.store.consumeOAuthState(state, now, expectedProvider),
        upsertConnection: (record) =>
          this.toPublicAccount(
            this.store.upsertAccount({
              provider: record.provider,
              externalAccountId: record.externalAccountId,
              displayName: record.displayName ?? null,
              status: record.status,
              setupPhase: record.setupPhase,
              setupExpiresAt: record.setupExpiresAt,
              scopes: record.scopes,
              credential: this.toStoredConnectionCredential(
                {
                  externalAccountId: record.externalAccountId,
                  provider: record.provider,
                },
                record.credential,
                record.tokens,
              ),
              metadata: record.metadata,
              connectedAt: record.connectedAt,
              nextReconcileAt: record.nextReconcileAt ?? null,
            }),
          ),
        markConnectionSetupFailed: (record) => {
          const account = this.store.markConnectionSetupFailed(
            record.accountId,
            record.now,
            record.code,
            record.message,
          );
          return account ? this.toPublicAccount(account) : null;
        },
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
        onConnectionEstablished: async ({ account, connection, provider }) => {
          this.enqueueJobs(account, connection.initialJobs ?? []);
          await this.ensureWebhookAdminUpkeepAfterConnectionEstablished(provider);
        },
        onWebhookAccepted: async ({ account, traceId, webhook }) => {
          this.store.enqueueJobsAndCompleteWebhookTrace({
            accountId: account.id,
            provider: account.provider,
            traceId,
            jobs: webhook.jobs,
          });
          return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
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
      void this.runWorkerBatchOnceInternal();
      this.workerTimer = setInterval(() => {
        void this.runWorkerBatchOnceInternal();
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
    return this.handleConnectionCallback(input);
  }

  async handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult> {
    return this.publicIngress.handleConnectionCallback(input);
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    return this.publicIngress.handleWebhook(providerName, headers, rawBody);
  }

  queueManualReconcileInternal(accountId: string): QueueManualReconcileResult {
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
    const scheduledJobs = resolveProviderJobExecutor(provider)?.createScheduledJobs?.(account, now).jobs ?? [];
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

  async disconnectAccountInternal(accountId: string): Promise<DisconnectAccountResult> {
    const account = this.requireStoredAccount(accountId);
    const provider = this.requireProvider(account.provider);
    const now = toIsoTimestamp(new Date());

    if (account.status !== "disconnected") {
      try {
        const decrypted = this.toDecryptedAccount(account);
        await provider.connectionHandler?.revokeAccess?.(decrypted);
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

        const jobExecutor = provider ? resolveProviderJobExecutor(provider) : undefined;

        if (!jobExecutor?.createScheduledJobs) {
          continue;
        }

        const schedule = jobExecutor.createScheduledJobs(account, now);
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
    const currentNow = (): string => toIsoTimestamp(new Date());

    if (!job) {
      return null;
    }

    const failClaimedJob = (
      code: string,
      message: string,
      retryAt: string | null,
      retryable: boolean,
    ): boolean => {
      const failed = this.store.failJobIfOwned(job.id, this.workerId, currentNow(), code, message, retryAt, retryable);

      if (!failed) {
        this.logger.debug?.("Device sync job side effects skipped because execution was cancelled.", {
          provider: job.provider,
          accountId: job.accountId,
          jobId: job.id,
        });
      }

      return failed;
    };

    const provider = this.registry.get(job.provider);

    if (!provider) {
      failClaimedJob(
        "PROVIDER_NOT_REGISTERED",
        `No device sync provider registered for ${job.provider}.`,
        null,
        false,
      );
      return job;
    }

    const storedAccount = this.store.getAccountById(job.accountId);

    if (!storedAccount) {
      failClaimedJob("ACCOUNT_NOT_FOUND", `Device sync account ${job.accountId} does not exist.`, null, false);
      return job;
    }

    if (storedAccount.status === "disconnected") {
      this.store.completeJob(job.id, now);
      return job;
    }

    if (storedAccount.status === "reauthorization_required") {
      failClaimedJob(
        "ACCOUNT_REAUTHORIZATION_REQUIRED",
        "Device sync account requires reconnection before queued jobs can run.",
        null,
        false,
      );
      return job;
    }

    this.store.markSyncStarted(storedAccount.id, now);

    const disconnectGeneration = storedAccount.disconnectGeneration;
    const jobExecutor = resolveProviderJobExecutor(provider);

    if (!jobExecutor) {
      failClaimedJob(
        "JOB_EXECUTOR_NOT_SUPPORTED",
        `Device sync provider ${provider.provider} does not support job execution.`,
        null,
        false,
      );
      return job;
    }

    const ensureJobLeaseOwned = (): void => {
      const fenceNow = currentNow();
      const currentJob = this.store.getJobById(job.id);

      if (
        !currentJob
        || currentJob.status !== "running"
        || currentJob.leaseOwner !== this.workerId
        || currentJob.leaseExpiresAt === null
        || currentJob.leaseExpiresAt <= fenceNow
      ) {
        throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
      }
    };
    const ensureAccountActive = (): void => {
      const currentStoredAccount = this.store.getAccountById(storedAccount.id);

      if (
        !currentStoredAccount ||
        currentStoredAccount.status !== "active" ||
        currentStoredAccount.disconnectGeneration !== disconnectGeneration
      ) {
        throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
      }
    };
    const ensureExecutionActive = (): void => {
      ensureJobLeaseOwned();
      ensureAccountActive();
    };

    let currentAccount: DeviceSyncAccount;

    try {
      currentAccount = this.toDecryptedAccount(storedAccount);
      const normalizedJob = normalizeConfiguredDeviceSyncJobRecord(provider.provider, job, "execution");
      const result = await jobExecutor.executeJob(
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
          upsertConnectionSource: (input) => {
            ensureExecutionActive();
            return this.store.upsertConnectionSource({
              ...input,
              connectionId: currentAccount.id,
            });
          },
          listConnectionSources: (input = {}) => {
            ensureExecutionActive();
            return this.store.listConnectionSources({
              ...input,
              connectionId: currentAccount.id,
            });
          },
          refreshAccountTokens: async () => {
            ensureExecutionActive();
            if (currentAccount.credential.kind !== "oauth_tokens") {
              throw deviceSyncError({
                code: "DEVICE_SYNC_CREDENTIAL_REFRESH_UNSUPPORTED",
                message: "Provider-config device sync credentials cannot be refreshed as OAuth tokens.",
                retryable: false,
                httpStatus: 409,
              });
            }

            const refreshTokens = resolveProviderTokenRefresher(provider);

            if (!refreshTokens) {
              throw deviceSyncError({
                code: "TOKEN_REFRESH_NOT_SUPPORTED",
                message: `Device sync provider ${provider.provider} does not support account token refresh.`,
                retryable: false,
                httpStatus: 409,
              });
            }
            const refreshed = await refreshTokens(currentAccount);
            ensureExecutionActive();
            const updated = this.store.updateAccountTokens(
              currentAccount.id,
              this.encryptTokens(currentAccount, refreshed),
              disconnectGeneration,
            );

            if (!updated) {
              throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
            }

            currentAccount = this.toDecryptedAccount(updated);
            return currentAccount;
          },
          disconnectAccount: async () => {
            ensureExecutionActive();
            this.store.markPendingJobsDeadForAccount(
              currentAccount.id,
              now,
              "ACCOUNT_DISCONNECTED",
              "Device account disconnected.",
            );
            const disconnected = this.store.disconnectAccount(currentAccount.id, now);
            currentAccount = this.toDecryptedAccount(disconnected);
          },
          logger: this.logger,
        },
        normalizedJob,
      );

      ensureExecutionActive();

      if (!this.store.completeJobIfOwned(job.id, this.workerId, currentNow())) {
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
      const failureNow = currentNow();
      const retryAt = failure.retryable ? addMilliseconds(failureNow, computeRetryDelayMs(job.attempts)) : null;
      const failed = failClaimedJob(failure.code, failure.message, retryAt, failure.retryable);

      if (!failed) {
        return job;
      }

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

  async runWorkerBatchOnceInternal(): Promise<void> {
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
      credential: _credential,
      disconnectGeneration: _disconnectGeneration,
      hostedObservedTokenVersion: _hostedObservedTokenVersion,
      hostedObservedUpdatedAt: _hostedObservedUpdatedAt,
      ...internalAccount
    } = account;
    return internalAccount;
  }

  private toDecryptedAccount(account: StoredDeviceSyncAccount): DeviceSyncAccount {
    return {
      disconnectGeneration: account.disconnectGeneration,
      ...this.toInternalAccountRecord(account),
      credential: this.toDecryptedAccountCredential(account),
    };
  }

  private toDecryptedAccountCredential(account: StoredDeviceSyncAccount): DeviceSyncAccountCredential {
    if (account.credential.kind === "oauth_tokens") {
      return {
        kind: "oauth_tokens",
        tokens: {
          accessToken: this.decryptStoredToken(
            account,
            account.credential.accessTokenEncrypted,
            "device-sync-access-token",
          ),
          refreshToken: account.credential.refreshTokenEncrypted
            ? this.decryptStoredToken(
              account,
              account.credential.refreshTokenEncrypted,
              "device-sync-refresh-token",
            )
            : null,
          accessTokenExpiresAt: account.credential.accessTokenExpiresAt,
        },
      };
    }

    if (account.credential.kind === "provider_config") {
      return {
        kind: "provider_config",
        providerConfigKey: account.credential.providerConfigKey,
        credentialMetadata: { ...account.credential.credentialMetadata },
      };
    }

    return {
      kind: "none",
      credentialMetadata: { ...account.credential.credentialMetadata },
    };
  }

  private decryptStoredToken(
    account: Pick<StoredDeviceSyncAccount, "id" | "externalAccountId" | "provider">,
    payload: string,
    purpose: "device-sync-access-token" | "device-sync-refresh-token",
  ): string {
    try {
      return this.codec.decrypt(
        payload,
        buildDeviceSyncTokenCipherOptions({
          externalAccountId: account.externalAccountId,
          provider: account.provider,
          purpose,
        }),
      );
    } catch {
      const tokenLabel = purpose === "device-sync-access-token" ? "access" : "refresh";
      throw deviceSyncError({
        accountStatus: "reauthorization_required",
        code: "ACCOUNT_TOKEN_DECRYPT_FAILED",
        httpStatus: 409,
        message: `Stored device sync ${tokenLabel} token for account ${account.id} failed integrity validation. Reconnect the account before retrying.`,
        retryable: false,
      });
    }
  }

  private encryptTokens(
    account: Pick<StoredDeviceSyncAccount, "externalAccountId" | "provider">,
    tokens: ProviderAuthTokens,
  ): ProviderAuthTokens & { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null } {
    return {
      ...tokens,
      accessTokenEncrypted: this.codec.encrypt(
        tokens.accessToken,
        buildDeviceSyncTokenCipherOptions({
          externalAccountId: account.externalAccountId,
          provider: account.provider,
          purpose: "device-sync-access-token",
        }),
      ),
      refreshTokenEncrypted: tokens.refreshToken
        ? this.codec.encrypt(
          tokens.refreshToken,
          buildDeviceSyncTokenCipherOptions({
            externalAccountId: account.externalAccountId,
            provider: account.provider,
            purpose: "device-sync-refresh-token",
          }),
        )
        : null,
    };
  }

  private toStoredConnectionCredential(
    account: Pick<StoredDeviceSyncAccount, "externalAccountId" | "provider">,
    credential: DeviceAccountCredential | undefined,
    legacyTokens: ProviderAuthTokens | undefined,
  ): DeviceAccountCredential {
    if (!credential) {
      if (!legacyTokens) {
        throw deviceSyncError({
          code: "CONNECTION_CREDENTIAL_MISSING",
          message: "Device sync connection did not provide account credentials.",
          retryable: false,
          httpStatus: 500,
        });
      }

      return {
        kind: "oauth_tokens",
        tokens: this.encryptTokens(account, legacyTokens),
      };
    }

    if (credential.kind !== "oauth_tokens") {
      return credential;
    }

    return {
      kind: "oauth_tokens",
      tokens: this.encryptTokens(account, credential.tokens),
    };
  }

  private enqueueJobs(
    account: Pick<PublicDeviceSyncAccount, "id" | "provider">,
    jobs: readonly DeviceSyncJobInput[],
  ): DeviceSyncJobRecord[] {
    return jobs.map((job) => {
      const normalizedJob = normalizeConfiguredDeviceSyncJobInput(account.provider, job, "enqueue");
      return this.store.enqueueJob({
        provider: account.provider,
        accountId: account.id,
        kind: normalizedJob.kind,
        payload: normalizedJob.payload ?? {},
        priority: normalizedJob.priority ?? 0,
        availableAt: normalizedJob.availableAt,
        maxAttempts: normalizedJob.maxAttempts,
        dedupeKey: normalizedJob.dedupeKey,
      });
    });
  }

  private async ensureWebhookAdminUpkeepAfterConnectionEstablished(provider: DeviceSyncProvider): Promise<void> {
    if (provider.provider !== "oura") {
      return;
    }

    const ensureSubscriptions = provider.webhookAdmin?.ensureSubscriptions;

    if (!ensureSubscriptions) {
      return;
    }

    try {
      await ensureSubscriptions({
        publicBaseUrl: this.publicBaseUrl,
      });
    } catch (error) {
      this.logger.warn?.("Failed to ensure device-sync webhook admin upkeep after connection establishment.", {
        provider: provider.provider,
        reason: "connection-established",
        error: summarizeError(error),
      });
    }
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
  const controller = new DeviceSyncServiceController(input);
  const service = Object.freeze({
    vaultRoot: controller.vaultRoot,
    publicBaseUrl: controller.publicBaseUrl,
    allowedReturnOrigins: [...controller.allowedReturnOrigins],
    registry: controller.registry,
    publicIngress: controller.publicIngress,
    describeProviders: () => controller.describeProviders(),
    describeProvider: (providerName) => controller.describeProvider(providerName),
    summarize: () => controller.summarize(),
    listAccounts: (provider) => controller.listAccounts(provider),
    getAccount: (accountId) => controller.getAccount(accountId),
    start: () => controller.start(),
    stop: () => controller.stop(),
    close: () => controller.close(),
    startConnection: (startConnectionInput) => controller.startConnection(startConnectionInput),
    handleConnectionCallback: (callbackInput) => controller.handleConnectionCallback(callbackInput),
    handleOAuthCallback: (callbackInput) => controller.handleOAuthCallback(callbackInput),
    handleWebhook: (providerName, headers, rawBody) => controller.handleWebhook(providerName, headers, rawBody),
    getNextWakeAt: (now) => controller.getNextWakeAt(now),
    runSchedulerOnce: () => controller.runSchedulerOnce(),
    runWorkerOnce: () => controller.runWorkerOnce(),
    drainWorker: (limit) => controller.drainWorker(limit),
  } satisfies DeviceSyncService);
  registerDeviceSyncServiceInternals(service, controller);
  return service;
}

function earliestIsoTimestamp(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function resolveProviderJobExecutor(provider: DeviceSyncProvider): DeviceJobExecutor | undefined {
  return provider.jobExecutor;
}

function resolveProviderTokenRefresher(
  provider: DeviceSyncProvider,
): DeviceConnectionHandler["refreshTokens"] {
  return provider.connectionHandler?.refreshTokens;
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
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]",
      retryable: error.retryable,
      accountStatus: error.accountStatus,
    };
  }

  if (error instanceof Error) {
    return {
      code: "SYNC_JOB_FAILED",
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]",
      retryable: false,
    };
  }

  return {
    code: "SYNC_JOB_FAILED",
    message: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
    retryable: false,
  };
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]",
    };
  }

  return {
    value: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
  };
}
