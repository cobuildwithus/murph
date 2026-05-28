import { createImporters } from "@murphai/importers";

import {
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
} from "./config/provider-manifests.ts";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "./local-secret-codec.ts";
import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import {
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedRuntimeErrorText,
} from "./hosted-runtime.ts";
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

import type { DeviceSyncError } from "./errors.ts";
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
  DeviceSyncJobFailureDiagnostic,
  DisconnectAccountResult,
  DeviceAccountCredential,
  HandleConnectionCallbackInput,
  HandleOAuthCallbackInput,
  HandleWebhookResult,
  ListDeviceSyncAccountsInput,
  ProviderAuthTokens,
  ProviderJobContext,
  ProviderJobBatchDescriptor,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  QueueManualReconcileResult,
  StartConnectionInput,
  StoredDeviceSyncAccount,
} from "./types.ts";

export { SqliteDeviceSyncStore } from "./store.ts";

const DEVICE_SYNC_VALIDATION_ISSUE_LIMIT = 10;
const DEVICE_SYNC_VALIDATION_CAUSE_DEPTH_LIMIT = 4;
const DEVICE_SYNC_JOB_YIELD_POLL_MS = 100;
const DEFAULT_PROVIDER_JOB_BATCH_MAX_JOBS = 50;
const DEFAULT_PROVIDER_JOB_BATCH_MAX_ESTIMATED_BYTES = 2 * 1024 * 1024;
const DEFAULT_PROVIDER_JOB_BATCH_CANDIDATE_SCAN_LIMIT = 200;
const DEVICE_SYNC_VALIDATION_SENSITIVE_FIELD_PATTERN =
  /(?:authorization|bearer|cookie|password|secret|token|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|id[-_]?token|email|phone|address|user(?:name)?|owner|account(?:id)?|external(?:id)?)/iu;
const DEVICE_SYNC_VALIDATION_METADATA_FIELDS = Object.freeze([
  "expected",
  "received",
  "origin",
  "format",
  "minimum",
  "maximum",
  "inclusive",
  "exact",
] as const);

class DeviceSyncJobExecutionCancelledError extends Error {
  constructor(readonly accountId: string, readonly jobId: string) {
    super(`Device sync job ${jobId} is no longer active for account ${accountId}.`);
    this.name = "DeviceSyncJobExecutionCancelledError";
  }
}

class DeviceSyncJobExecutionYieldedError extends Error {
  constructor() {
    super("Device sync job yielded before completion.");
    this.name = "DeviceSyncJobExecutionYieldedError";
  }
}

type DeviceSyncJobFailureDiagnosticInput = {
  [Key in keyof DeviceSyncJobFailureDiagnostic["details"]]?: DeviceSyncJobFailureDiagnostic["details"][Key] | null;
};

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
  listAccounts(input?: ListDeviceSyncAccountsInput): PublicDeviceSyncAccount[];
  getAccount(accountId: string): PublicDeviceSyncAccount | null;
  listJobFailureDiagnostics(): DeviceSyncJobFailureDiagnostic[];
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
  private readonly shouldYieldJobExecution: (() => boolean) | null;
  private readonly workerId: string;
  private readonly ownsStore: boolean;
  private workerTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  workerTickInFlight = false;
  schedulerTickInFlight = false;
  private readonly jobFailureDiagnostics: DeviceSyncJobFailureDiagnostic[] = [];

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
    this.shouldYieldJobExecution = input.config.shouldYieldJobExecution ?? null;
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
        consumeOAuthState: (state, now, expectedProvider, expectedOwnerId) =>
          this.store.consumeOAuthState(state, now, expectedProvider, expectedOwnerId),
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
              existingAccountGuard: record.existingAccountGuard ?? null,
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
        getConnectionById: (accountId) => {
          const account = this.store.getAccountById(accountId);
          return account ? this.toPublicAccount(account) : null;
        },
        getConnectionByExternalAccount: (provider, externalAccountId) => {
          const account = this.store.getAccountByExternalAccount(provider, externalAccountId);
          return account ? this.toPublicAccount(account) : null;
        },
        claimWebhookTrace: (record) => this.store.claimWebhookTrace(record),
        completeWebhookTrace: (provider, traceId, claimToken) =>
          this.store.completeWebhookTrace(provider, traceId, claimToken),
        releaseWebhookTrace: (provider, traceId, claimToken) =>
          this.store.releaseWebhookTrace(provider, traceId, claimToken),
        markWebhookReceived: (accountId, now) => this.store.markWebhookReceived(accountId, now),
      },
      hooks: {
        onConnectionEstablished: async ({ account, connection, provider }) => {
          this.enqueueJobs(account, connection.initialJobs ?? []);
          await this.ensureWebhookAdminUpkeepAfterConnectionEstablished(provider);
        },
        onWebhookAccepted: async ({ account, claimToken, traceId, webhook }) => {
          this.store.enqueueJobsAndCompleteWebhookTrace({
            accountId: account.id,
            provider: account.provider,
            traceId,
            claimToken,
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

  listAccounts(input: ListDeviceSyncAccountsInput = {}): PublicDeviceSyncAccount[] {
    return this.store.listAccounts(input).map((account) => this.toPublicAccount(account));
  }

  getAccount(accountId: string): PublicDeviceSyncAccount | null {
    const account = this.store.getAccountById(accountId);
    return account ? this.toPublicAccount(account) : null;
  }

  listJobFailureDiagnostics(): DeviceSyncJobFailureDiagnostic[] {
    return this.jobFailureDiagnostics.map((entry) => ({
      ...entry,
      details: { ...entry.details },
    }));
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
    if (this.shouldYieldJobExecution?.() === true) {
      return null;
    }

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
      this.store.markPendingJobsDeadForAccount(
        storedAccount.id,
        now,
        "ACCOUNT_REAUTHORIZATION_REQUIRED",
        "Device sync account requires reconnection before queued jobs can run.",
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

    let activeJobs: DeviceSyncJobRecord[] = [job];
    const ensureJobLeasesOwned = (): void => {
      const fenceNow = currentNow();
      for (const activeJob of activeJobs) {
        const currentJob = this.store.getJobById(activeJob.id);

        if (
          !currentJob
          || currentJob.status !== "running"
          || currentJob.leaseOwner !== this.workerId
          || currentJob.leaseExpiresAt === null
          || currentJob.leaseExpiresAt <= fenceNow
        ) {
          throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, activeJob.id);
        }
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
    const jobAbortController = new AbortController();
    const yieldJobExecution = (): void => {
      if (!jobAbortController.signal.aborted) {
        jobAbortController.abort(new DeviceSyncJobExecutionYieldedError());
      }
    };
    const assertJobExecutionNotYielded = (): void => {
      if (jobAbortController.signal.aborted) {
        throw readDeviceSyncJobYieldAbortReason(jobAbortController.signal);
      }

      if (this.shouldYieldJobExecution?.() === true) {
        yieldJobExecution();
        throw readDeviceSyncJobYieldAbortReason(jobAbortController.signal);
      }
    };
    const ensureExecutionActive = (): void => {
      assertJobExecutionNotYielded();
      ensureJobLeasesOwned();
      ensureAccountActive();
    };
    const stopYieldPolling = startDeviceSyncJobYieldPolling({
      abort: yieldJobExecution,
      shouldYield: this.shouldYieldJobExecution,
      signal: jobAbortController.signal,
    });

    let currentAccount: DeviceSyncAccount;

    try {
      ensureExecutionActive();
      currentAccount = this.toDecryptedAccount(storedAccount);
      const normalizedJob = normalizeConfiguredDeviceSyncJobRecord(provider.provider, job, "execution");
      activeJobs = this.claimProviderJobBatch({
        accountId: storedAccount.id,
        jobExecutor,
        normalizedSeedJob: normalizedJob,
        now,
        provider: provider.provider,
      });
      const normalizedJobs = activeJobs.map((activeJob) =>
        activeJob.id === normalizedJob.id
          ? normalizedJob
          : normalizeConfiguredDeviceSyncJobRecord(provider.provider, activeJob, "execution")
      );
      const jobContext: ProviderJobContext = {
        account: currentAccount,
        now,
        signal: jobAbortController.signal,
        ...(this.shouldYieldJobExecution
          ? { shouldYield: this.shouldYieldJobExecution }
          : {}),
        throwIfAborted: assertJobExecutionNotYielded,
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
          ensureJobLeasesOwned();
          ensureAccountActive();
          const updated = this.store.updateAccountTokens(
            currentAccount.id,
            this.encryptTokens(currentAccount, refreshed),
            disconnectGeneration,
          );

          if (!updated) {
            throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
          }

          currentAccount = this.toDecryptedAccount(updated);
          assertJobExecutionNotYielded();
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
      };
      const result = normalizedJobs.length > 1 && jobExecutor.executeJobBatch
        ? await jobExecutor.executeJobBatch(jobContext, normalizedJobs)
        : await jobExecutor.executeJob(jobContext, normalizedJob);

      ensureJobLeasesOwned();
      ensureAccountActive();

      if (!this.store.completeJobsIfOwned(activeJobs.map((activeJob) => activeJob.id), this.workerId, currentNow())) {
        return job;
      }

      const successOptions: {
        metadataPatch?: Record<string, unknown>;
        nextReconcileAt?: string | null;
      } = {};

      if (Object.prototype.hasOwnProperty.call(result, "metadataPatch")) {
        successOptions.metadataPatch = result.metadataPatch;
      }

      if (Object.prototype.hasOwnProperty.call(result, "nextReconcileAt")) {
        successOptions.nextReconcileAt = result.nextReconcileAt ?? null;
      }

      const markedSucceeded = this.store.markSyncSucceeded(
        storedAccount.id,
        now,
        disconnectGeneration,
        successOptions,
      );

      if (!markedSucceeded) {
        return job;
      }

      this.enqueueJobs(storedAccount, result.scheduledJobs ?? []);
      return job;
    } catch (error) {
      if (isDeviceSyncJobExecutionYielded(error, jobAbortController.signal)) {
        const releaseNow = currentNow();
        const released = activeJobs.filter((activeJob) =>
          this.store.releaseJobIfOwned(activeJob.id, this.workerId, releaseNow)
        ).length;
        this.logger.debug?.("Device sync job yielded before completion.", {
          provider: provider.provider,
          jobId: job.id,
          jobCount: activeJobs.length,
          released,
        });
        return job;
      }

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
      const failed = activeJobs
        .map((activeJob) =>
          this.store.failJobIfOwned(
            activeJob.id,
            this.workerId,
            failureNow,
            failure.code,
            failure.message,
            retryAt,
            failure.retryable,
          )
        )
        .some(Boolean);

      if (!failed) {
        return job;
      }

      this.recordJobFailureDiagnostic({
        accountId: storedAccount.id,
        accountStatus: failure.accountStatus ?? null,
        code: failure.code,
        details: failure.details,
        retryable: failure.retryable,
      });
      this.store.markSyncFailed(storedAccount.id, now, failure.code, failure.message, failure.accountStatus);
      if (failure.accountStatus === "reauthorization_required") {
        this.store.markPendingJobsDeadForAccount(
          storedAccount.id,
          failureNow,
          "ACCOUNT_REAUTHORIZATION_REQUIRED",
          "Device sync account requires reconnection before queued jobs can run.",
        );
      }
      this.logger.warn?.("Device sync job failed.", {
        provider: provider.provider,
        jobId: job.id,
        code: failure.code,
        failureSummary: failure.message,
        retryable: failure.retryable,
        accountStatus: failure.accountStatus ?? null,
        ...failure.details,
      });
      return job;
    } finally {
      stopYieldPolling();
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

  private claimProviderJobBatch(input: {
    accountId: string;
    jobExecutor: DeviceJobExecutor;
    normalizedSeedJob: DeviceSyncJobRecord;
    now: string;
    provider: string;
  }): DeviceSyncJobRecord[] {
    if (!input.jobExecutor.executeJobBatch || !input.jobExecutor.describeJobBatch) {
      return [input.normalizedSeedJob];
    }

    const seedDescriptor = input.jobExecutor.describeJobBatch(input.normalizedSeedJob);
    if (!isValidProviderJobBatchDescriptor(seedDescriptor)) {
      return [input.normalizedSeedJob];
    }

    const maxBatchSize = normalizeProviderJobBatchLimit(
      input.jobExecutor.maxJobBatchSize,
      DEFAULT_PROVIDER_JOB_BATCH_MAX_JOBS,
    );
    if (maxBatchSize <= 1) {
      return [input.normalizedSeedJob];
    }

    const maxEstimatedBytes = normalizeProviderJobBatchLimit(
      input.jobExecutor.maxJobBatchEstimatedBytes,
      DEFAULT_PROVIDER_JOB_BATCH_MAX_ESTIMATED_BYTES,
    );
    const seedEstimatedBytes = normalizeProviderJobBatchEstimatedBytes(seedDescriptor);
    if (seedEstimatedBytes > maxEstimatedBytes) {
      return [input.normalizedSeedJob];
    }

    const candidates = this.store.listDueJobBatchCandidates({
      accountId: input.accountId,
      excludeJobId: input.normalizedSeedJob.id,
      limit: Math.max(DEFAULT_PROVIDER_JOB_BATCH_CANDIDATE_SCAN_LIMIT, maxBatchSize - 1),
      now: input.now,
      provider: input.provider,
    });
    const selectedJobIds: string[] = [];
    let totalEstimatedBytes = seedEstimatedBytes;

    for (const candidate of candidates) {
      if (selectedJobIds.length >= maxBatchSize - 1) {
        break;
      }

      let normalizedCandidate: DeviceSyncJobRecord;
      try {
        normalizedCandidate = normalizeConfiguredDeviceSyncJobRecord(input.provider, candidate, "execution");
      } catch {
        continue;
      }

      const descriptor = input.jobExecutor.describeJobBatch(normalizedCandidate);
      if (!isValidProviderJobBatchDescriptor(descriptor) || descriptor.key !== seedDescriptor.key) {
        continue;
      }

      const estimatedBytes = normalizeProviderJobBatchEstimatedBytes(descriptor);
      if (totalEstimatedBytes + estimatedBytes > maxEstimatedBytes) {
        continue;
      }

      selectedJobIds.push(candidate.id);
      totalEstimatedBytes += estimatedBytes;
    }

    const claimed = this.store.claimJobBatchCandidatesIfSeedOwned({
      accountId: input.accountId,
      jobIds: selectedJobIds,
      leaseMs: this.workerLeaseMs,
      now: input.now,
      provider: input.provider,
      seedJobId: input.normalizedSeedJob.id,
      workerId: this.workerId,
    });

    return [input.normalizedSeedJob, ...claimed];
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

  private recordJobFailureDiagnostic(entry: DeviceSyncJobFailureDiagnostic): void {
    this.jobFailureDiagnostics.push({
      ...entry,
      details: { ...entry.details },
    });

    if (this.jobFailureDiagnostics.length > 50) {
      this.jobFailureDiagnostics.splice(0, this.jobFailureDiagnostics.length - 50);
    }
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
    listAccounts: (input) => controller.listAccounts(input),
    getAccount: (accountId) => controller.getAccount(accountId),
    listJobFailureDiagnostics: () => controller.listJobFailureDiagnostics(),
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

function isValidProviderJobBatchDescriptor(
  descriptor: ProviderJobBatchDescriptor | null | undefined,
): descriptor is ProviderJobBatchDescriptor {
  return typeof descriptor?.key === "string" && descriptor.key.length > 0;
}

function normalizeProviderJobBatchLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function normalizeProviderJobBatchEstimatedBytes(
  descriptor: ProviderJobBatchDescriptor,
): number {
  if (typeof descriptor.estimatedBytes !== "number" || !Number.isFinite(descriptor.estimatedBytes)) {
    return 1;
  }

  return Math.max(1, Math.floor(descriptor.estimatedBytes));
}

function resolveProviderTokenRefresher(
  provider: DeviceSyncProvider,
): DeviceConnectionHandler["refreshTokens"] {
  return provider.connectionHandler?.refreshTokens;
}

function startDeviceSyncJobYieldPolling(input: {
  abort(): void;
  shouldYield: (() => boolean) | null;
  signal: AbortSignal;
}): () => void {
  if (!input.shouldYield) {
    return () => undefined;
  }

  const interval = setInterval(() => {
    if (input.signal.aborted) {
      return;
    }

    if (input.shouldYield?.() === true) {
      input.abort();
    }
  }, DEVICE_SYNC_JOB_YIELD_POLL_MS);

  return () => clearInterval(interval);
}

function readDeviceSyncJobYieldAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DeviceSyncJobExecutionYieldedError();
}

function isDeviceSyncJobExecutionYielded(error: unknown, signal: AbortSignal): boolean {
  return error instanceof DeviceSyncJobExecutionYieldedError
    || (
      signal.reason instanceof DeviceSyncJobExecutionYieldedError
      && isDeviceSyncJobAbortError(error, signal)
    );
}

function isDeviceSyncJobAbortError(error: unknown, signal: AbortSignal, depth = 0): boolean {
  if (error === signal.reason || error instanceof DeviceSyncJobExecutionYieldedError) {
    return true;
  }

  if (depth >= DEVICE_SYNC_VALIDATION_CAUSE_DEPTH_LIMIT || typeof error !== "object" || error === null) {
    return false;
  }

  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return cause !== undefined && isDeviceSyncJobAbortError(cause, signal, depth + 1);
}

function normalizeExecutionError(error: unknown): {
  code: string;
  details: DeviceSyncJobFailureDiagnostic["details"];
  message: string;
  retryable: boolean;
  accountStatus?: "reauthorization_required" | "disconnected" | null;
} {
  if (isDeviceSyncError(error)) {
    return {
      code: error.code,
      details: buildDeviceSyncErrorFailureDiagnostics(error),
      message: summarizeDeviceSyncErrorMessage(error),
      retryable: error.retryable,
      accountStatus: error.accountStatus,
    };
  }

  if (error instanceof Error) {
    return {
      code: "SYNC_JOB_FAILED",
      details: buildUnexpectedErrorFailureDiagnostics(error),
      message: summarizeExecutionErrorMessage(error),
      retryable: false,
    };
  }

  return {
    code: "SYNC_JOB_FAILED",
    details: {},
    message: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
    retryable: false,
  };
}

function summarizeDeviceSyncErrorMessage(error: DeviceSyncError): string {
  const baseMessage = sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]";
  const providerReason =
    readSafeDiagnosticText(error.details?.responseErrorDescription)
    ?? readSafeDiagnosticText(error.details?.oauthErrorDescription);
  if (!providerReason) {
    return baseMessage;
  }

  return sanitizeHostedRuntimeErrorText(`${baseMessage} Provider reason: ${providerReason}`) ?? baseMessage;
}

function buildDeviceSyncErrorFailureDiagnostics(
  error: DeviceSyncError,
): DeviceSyncJobFailureDiagnostic["details"] {
  const cause = toPlainRecord(error.cause);

  return compactFailureDiagnostics({
    failureCauseCode: readSafeDiagnosticToken(cause?.code),
    failureCauseName: readSafeDiagnosticToken(cause?.name),
    failureErrorCause: readSafeDiagnosticText(cause?.message),
    providerHttpStatus: readSafeDiagnosticNumber(error.details?.status) ?? error.httpStatus,
    providerHttpStatusText: readSafeDiagnosticText(error.details?.httpStatusText),
    providerRequestAuthKind: readSafeDiagnosticToken(error.details?.requestAuthKind),
    providerRequestAuthPlacement: readSafeDiagnosticToken(error.details?.requestAuthPlacement),
    providerRequestBodyFieldCount: readSafeDiagnosticNumber(error.details?.requestBodyFieldCount),
    providerRequestBodyFieldNames: readSafeDiagnosticToken(error.details?.requestBodyFieldNames),
    providerRequestBodyKind: readSafeDiagnosticToken(error.details?.requestBodyKind),
    providerRequestContentType: readSafeDiagnosticToken(error.details?.requestContentType),
    providerRequestCredentialPresent: readSafeDiagnosticBoolean(error.details?.requestCredentialPresent),
    providerRequestEndpointKind: readSafeDiagnosticToken(error.details?.requestEndpointKind),
    providerRequestMethod: readSafeDiagnosticToken(error.details?.requestMethod),
    providerRequestQueryParameterCount: readSafeDiagnosticNumber(error.details?.requestQueryParameterCount),
    providerRequestQueryParameterNames: readSafeDiagnosticToken(error.details?.requestQueryParameterNames),
    providerResponseErrorCode: readSafeDiagnosticToken(error.details?.responseErrorCode),
    providerResponseErrorDescription: readSafeDiagnosticText(error.details?.responseErrorDescription),
    providerResponseErrorDescriptionFieldPresent: readSafeDiagnosticBoolean(
      error.details?.responseErrorDescriptionFieldPresent,
    ),
    providerResponseErrorFieldPresent: readSafeDiagnosticBoolean(error.details?.responseErrorFieldPresent),
    providerResponseShapeKind: readSafeDiagnosticToken(error.details?.responseShapeKind),
    providerOAuthErrorCode: readSafeDiagnosticToken(error.details?.oauthErrorCode),
    providerOAuthErrorDescription: readSafeDiagnosticText(error.details?.oauthErrorDescription),
    providerOAuthGrantType: readSafeDiagnosticToken(error.details?.oauthGrantType),
    providerOAuthRequestBodyBuilderKind: readSafeDiagnosticToken(error.details?.oauthRequestBodyBuilderKind),
    providerOAuthRequestClientAuthPlacement: readSafeDiagnosticToken(error.details?.oauthRequestClientAuthPlacement),
    providerOAuthRequestClientCredentialPresent: readSafeDiagnosticBoolean(
      error.details?.oauthRequestClientCredentialPresent,
    ),
    providerOAuthRequestClientIdPresent: readSafeDiagnosticBoolean(error.details?.oauthRequestClientIdPresent),
    providerOAuthRequestContentType: readSafeDiagnosticToken(error.details?.oauthRequestContentType),
    providerOAuthRequestDuplicateParameterCount: readSafeDiagnosticNumber(
      error.details?.oauthRequestDuplicateParameterCount,
    ),
    providerOAuthRequestEncodingKind: readSafeDiagnosticToken(error.details?.oauthRequestEncodingKind),
    providerOAuthRequestHasDuplicateParameters: readSafeDiagnosticBoolean(
      error.details?.oauthRequestHasDuplicateParameters,
    ),
    providerOAuthRequestMethod: readSafeDiagnosticToken(error.details?.oauthRequestMethod),
    providerOAuthRequestOfflineScopePresent: readSafeDiagnosticBoolean(error.details?.oauthRequestOfflineScopePresent),
    providerOAuthRequestParameterCount: readSafeDiagnosticNumber(error.details?.oauthRequestParameterCount),
    providerOAuthRequestParameterNames: readSafeDiagnosticToken(error.details?.oauthRequestParameterNames),
    providerOAuthRequestRefreshCredentialPresent: readSafeDiagnosticBoolean(
      error.details?.oauthRequestRefreshCredentialPresent,
    ),
    providerOAuthRequestScopeCount: readSafeDiagnosticNumber(error.details?.oauthRequestScopeCount),
    providerOAuthRequestScopePresent: readSafeDiagnosticBoolean(error.details?.oauthRequestScopePresent),
    providerOAuthRequestScopeValue: readSafeDiagnosticToken(error.details?.oauthRequestScopeValue),
    providerOAuthRequestTokenEndpointKind: readSafeDiagnosticToken(error.details?.oauthRequestTokenEndpointKind),
    providerOAuthResponseErrorDescriptionFieldPresent: readSafeDiagnosticBoolean(
      error.details?.oauthResponseErrorDescriptionFieldPresent,
    ),
    providerOAuthResponseErrorFieldPresent: readSafeDiagnosticBoolean(error.details?.oauthResponseErrorFieldPresent),
    providerOAuthResponseShapeKind: readSafeDiagnosticToken(error.details?.oauthResponseShapeKind),
  });
}

function buildUnexpectedErrorFailureDiagnostics(
  error: Error,
): DeviceSyncJobFailureDiagnostic["details"] {
  const cause = toPlainRecord(error.cause);

  return compactFailureDiagnostics({
    failureErrorName: readSafeDiagnosticToken(error.name),
    failureCauseName: readSafeDiagnosticToken(cause?.name),
    failureCauseCode: readSafeDiagnosticToken(cause?.code),
    failureErrorCause: readSafeDiagnosticText(cause?.message),
  });
}

function compactFailureDiagnostics(
  input: DeviceSyncJobFailureDiagnosticInput,
): DeviceSyncJobFailureDiagnostic["details"] {
  const output: DeviceSyncJobFailureDiagnostic["details"] = {};

  for (const key of Object.keys(input) as Array<keyof DeviceSyncJobFailureDiagnostic["details"]>) {
    setFailureDiagnosticDetail(output, key, input[key]);
  }

  return output;
}

function setFailureDiagnosticDetail<Key extends keyof DeviceSyncJobFailureDiagnostic["details"]>(
  output: DeviceSyncJobFailureDiagnostic["details"],
  key: Key,
  value: DeviceSyncJobFailureDiagnostic["details"][Key] | null | undefined,
): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  output[key] = value;
}

function readSafeDiagnosticToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/u.test(token) ? token : null;
}

function readSafeDiagnosticBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readSafeDiagnosticNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSafeDiagnosticText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return sanitizeHostedRuntimeDiagnosticText(value);
}

function summarizeExecutionErrorMessage(error: Error): string {
  const baseMessage = sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]";
  const validationSummary = summarizeValidationIssues(error);

  if (!validationSummary) {
    return baseMessage;
  }

  return sanitizeHostedRuntimeErrorText(`${baseMessage} | ${validationSummary}`) ?? baseMessage;
}

function summarizeValidationIssues(error: Error): string | null {
  const issueSummaries = collectValidationIssueSummaries(error);
  const uniqueSummaries = [...new Set(issueSummaries)].slice(0, DEVICE_SYNC_VALIDATION_ISSUE_LIMIT);

  return uniqueSummaries.length > 0
    ? `validationIssues=${uniqueSummaries.join("; ")}`
    : null;
}

function collectValidationIssueSummaries(error: unknown): string[] {
  const seen = new Set<unknown>();

  return collectValidationIssueSummariesInternal(error, seen, 0);
}

function collectValidationIssueSummariesInternal(
  error: unknown,
  seen: Set<unknown>,
  depth: number,
): string[] {
  if (!error || seen.has(error) || depth > DEVICE_SYNC_VALIDATION_CAUSE_DEPTH_LIMIT) {
    return [];
  }

  if (typeof error === "object") {
    seen.add(error);
  }

  const record = toPlainRecord(error);
  const aggregateErrors = error instanceof AggregateError ? error.errors : [];
  const nestedErrors = readUnknownArray(record?.errors)
    .filter((entry) => entry instanceof Error || Boolean(toPlainRecord(entry)?.issues));

  return [
    ...readZodLikeIssueSummaries(record?.issues),
    ...readZodLikeIssueSummaries(record?.errors),
    ...readVaultLikeErrorSummaries(record),
    ...collectValidationIssueSummariesInternal(record?.cause, seen, depth + 1),
    ...aggregateErrors.flatMap((entry) =>
      collectValidationIssueSummariesInternal(entry, seen, depth + 1)
    ),
    ...nestedErrors.flatMap((entry) =>
      collectValidationIssueSummariesInternal(entry, seen, depth + 1)
    ),
  ];
}

function readZodLikeIssueSummaries(value: unknown): string[] {
  const issues = readRecordArray(value);

  return issues.flatMap((issue) => {
    const record = toPlainRecord(issue);

    if (!record || !hasValidationIssueShape(record)) {
      return [];
    }

    const path = formatValidationPath(record.path);
    const code = formatValidationToken(record.code) ?? "validation";
    const message = sanitizeHostedRuntimeErrorText(String(record.message ?? "")) ?? "";
    const metadata = formatValidationIssueMetadata(record);
    const parts = [path, code, message, metadata].filter(Boolean);

    return parts.length > 0 ? [parts.join(" ")] : [];
  });
}

function hasValidationIssueShape(record: Record<string, unknown>): boolean {
  return (
    "code" in record ||
    "path" in record ||
    DEVICE_SYNC_VALIDATION_METADATA_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(record, field)
    )
  );
}

function readVaultLikeErrorSummaries(error: Record<string, unknown> | null): string[] {
  const details = toPlainRecord(error?.details);
  const errors = readStringArray(details?.errors);

  return errors.flatMap((entry) => {
    const sanitized = sanitizeHostedRuntimeErrorText(entry);

    if (!sanitized) {
      return [];
    }

    return [sanitizeValidationIssueText(sanitized)];
  });
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = toPlainRecord(entry);
    return record ? [record] : [];
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function formatValidationPath(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "$";
  }

  return value.reduce<string>((path, segment) => {
    if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
      return `${path}[${segment}]`;
    }

    if (typeof segment !== "string") {
      return `${path}.<field>`;
    }

    const token = formatValidationToken(segment);
    return token ? `${path}.${token}` : `${path}.<field>`;
  }, "$");
}

function formatValidationToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,80}$/u.test(trimmed)) {
    return null;
  }

  return DEVICE_SYNC_VALIDATION_SENSITIVE_FIELD_PATTERN.test(trimmed)
    ? "<redacted-field>"
    : trimmed;
}

function formatValidationIssueMetadata(record: Record<string, unknown>): string | null {
  const metadata = DEVICE_SYNC_VALIDATION_METADATA_FIELDS.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      return [];
    }

    const value = formatValidationMetadataValue(field, record[field]);
    return value ? [`${field}=${value}`] : [];
  });

  return metadata.length > 0 ? `[${metadata.join(" ")}]` : null;
}

function formatValidationMetadataValue(field: string, value: unknown): string | null {
  if (DEVICE_SYNC_VALIDATION_SENSITIVE_FIELD_PATTERN.test(field)) {
    return "<redacted>";
  }

  if (typeof value === "string") {
    const token = formatValidationToken(value);
    return token ?? sanitizeHostedRuntimeErrorText(value)?.replace(/\s+/gu, "_") ?? null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function sanitizeValidationIssueText(value: string): string {
  const [path, ...rest] = value.split(":");

  if (!path || !path.trim().startsWith("$")) {
    return value;
  }

  const safePath = path
    .split(".")
    .reduce<string[]>((segments, segment, index) => {
      if (index === 0) {
        return ["$"];
      }

      const arrayMatch = /^([A-Za-z_][A-Za-z0-9_-]{0,80})((?:\[\d+\])*)$/u.exec(segment);
      if (!arrayMatch) {
        return [...segments, "<field>"];
      }

      if (segments.includes("<field>")) {
        return segments;
      }

      const token = formatValidationToken(arrayMatch[1]) ?? "<field>";
      return [...segments, `${token}${arrayMatch[2]}`];
    }, [])
    .join(".");

  return [safePath, ...rest].join(":");
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: summarizeExecutionErrorMessage(error),
    };
  }

  return {
    value: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
  };
}
