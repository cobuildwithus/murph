import { createImporters } from "@healthybob/importers";

import { createSecretCodec } from "./crypto.js";
import { deviceSyncError, isDeviceSyncError } from "./errors.js";
import { createDeviceSyncRegistry } from "./registry.js";
import {
  addMilliseconds,
  computeRetryDelayMs,
  defaultStateDatabasePath,
  generatePrefixedId,
  generateStateCode,
  joinUrl,
  normalizeOriginList,
  normalizePublicBaseUrl,
  normalizeString,
  resolveRelativeOrAllowedOriginUrl,
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

  private readonly logger: DeviceSyncLogger;
  private readonly importer: DeviceSyncImporterPort;
  private readonly codec: ReturnType<typeof createSecretCodec>;
  private readonly sessionTtlMs: number;
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
    this.sessionTtlMs = Math.max(60_000, input.config.sessionTtlMs ?? 15 * 60_000);
    this.workerLeaseMs = Math.max(60_000, input.config.workerLeaseMs ?? 5 * 60_000);
    this.workerPollMs = Math.max(1_000, input.config.workerPollMs ?? 5_000);
    this.workerBatchSize = Math.max(1, input.config.workerBatchSize ?? 4);
    this.schedulerPollMs = Math.max(5_000, input.config.schedulerPollMs ?? 60_000);
    this.workerId = generatePrefixedId("worker");
    this.store =
      input.store ?? new SqliteDeviceSyncStore(input.config.stateDatabasePath ?? defaultStateDatabasePath(this.vaultRoot));
    this.ownsStore = !input.store;
    this.codec = createSecretCodec(input.secret);
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.registry.list().map((provider) => this.describeProvider(provider));
  }

  describeProvider(providerName: string | DeviceSyncProvider): PublicProviderDescriptor {
    const provider = typeof providerName === "string" ? this.requireProvider(providerName) : providerName;
    const webhookPath = provider.webhookPath ?? null;

    return {
      provider: provider.provider,
      callbackPath: provider.callbackPath,
      callbackUrl: joinUrl(this.publicBaseUrl, provider.callbackPath),
      webhookPath,
      webhookUrl: webhookPath ? joinUrl(this.publicBaseUrl, webhookPath) : null,
      supportsWebhooks: Boolean(webhookPath && provider.verifyAndParseWebhook),
      defaultScopes: [...provider.defaultScopes],
    };
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
    const now = toIsoTimestamp(new Date());
    const provider = this.requireProvider(input.provider);
    const descriptor = this.describeProvider(provider);
    const returnTo = this.resolveReturnTo(input.returnTo ?? null);
    const state = generateStateCode();
    const expiresAt = addMilliseconds(now, this.sessionTtlMs);

    this.store.deleteExpiredOAuthStates(now);
    this.store.createOAuthState({
      state,
      provider: provider.provider,
      returnTo,
      createdAt: now,
      expiresAt,
      metadata: {},
    });

    return {
      provider: provider.provider,
      state,
      expiresAt,
      authorizationUrl: provider.buildConnectUrl({
        state,
        callbackUrl: descriptor.callbackUrl,
        scopes: provider.defaultScopes,
        now,
      }),
    };
  }

  async handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult> {
    const provider = this.requireProvider(input.provider);
    const now = toIsoTimestamp(new Date());
    const descriptor = this.describeProvider(provider);
    const state = normalizeString(input.state);

    if (!state) {
      throw deviceSyncError({
        code: "OAUTH_STATE_MISSING",
        message: "OAuth callback is missing the state parameter.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const stateRecord = this.store.consumeOAuthState(state, now);

    if (!stateRecord) {
      throw deviceSyncError({
        code: "OAUTH_STATE_INVALID",
        message: "OAuth state is invalid or expired.",
        retryable: false,
        httpStatus: 400,
      });
    }

    if (stateRecord.provider !== provider.provider) {
      throw deviceSyncError({
        code: "OAUTH_PROVIDER_MISMATCH",
        message: `OAuth state belongs to provider ${stateRecord.provider}, not ${provider.provider}.`,
        retryable: false,
        httpStatus: 400,
      });
    }

    const callbackError = normalizeString(input.error);

    if (callbackError) {
      throw deviceSyncError({
        code: "OAUTH_CALLBACK_REJECTED",
        message: normalizeString(input.errorDescription) ?? `OAuth authorization failed: ${callbackError}`,
        retryable: false,
        httpStatus: 400,
      });
    }

    const code = normalizeString(input.code);

    if (!code) {
      throw deviceSyncError({
        code: "OAUTH_CODE_MISSING",
        message: "OAuth callback is missing the authorization code.",
        retryable: false,
        httpStatus: 400,
      });
    }

    const grantedScopes = normalizeString(input.scope)
      ? input.scope!
        .split(/\s+/u)
        .map((scope) => scope.trim())
        .filter(Boolean)
      : [];

    const connection = await provider.exchangeAuthorizationCode(
      {
        callbackUrl: descriptor.callbackUrl,
        now,
        grantedScopes,
      },
      code,
    );

    const account = this.store.upsertAccount({
      provider: provider.provider,
      externalAccountId: connection.externalAccountId,
      displayName: connection.displayName ?? null,
      scopes: connection.scopes?.length
        ? [...connection.scopes]
        : grantedScopes.length > 0
          ? [...grantedScopes]
          : [...provider.defaultScopes],
      tokens: this.encryptTokens(connection.tokens),
      metadata: connection.metadata ?? {},
      connectedAt: now,
      nextReconcileAt: connection.nextReconcileAt ?? null,
    });

    this.enqueueJobs(account, connection.initialJobs ?? []);

    return {
      account: this.toPublicAccount(account),
      returnTo: stateRecord.returnTo ?? null,
    };
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    const provider = this.requireProvider(providerName);

    if (!provider.webhookPath || !provider.verifyAndParseWebhook) {
      throw deviceSyncError({
        code: "WEBHOOKS_NOT_SUPPORTED",
        message: `Device sync provider ${provider.provider} does not accept webhooks.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    const now = toIsoTimestamp(new Date());
    const parsed = await provider.verifyAndParseWebhook({
      headers,
      rawBody,
      now,
    });

    if (parsed.traceId) {
      const inserted = this.store.recordWebhookTraceIfNew({
        provider: provider.provider,
        traceId: parsed.traceId,
        externalAccountId: parsed.externalAccountId,
        eventType: parsed.eventType,
        receivedAt: parsed.occurredAt ?? now,
        payload: parsed.payload,
      });

      if (!inserted) {
        return {
          accepted: true,
          duplicate: true,
          provider: provider.provider,
          eventType: parsed.eventType,
          traceId: parsed.traceId,
        };
      }
    }

    const account = this.store.getAccountByExternalAccount(provider.provider, parsed.externalAccountId);

    if (!account) {
      this.logger.warn?.("Ignoring webhook for unknown device sync account.", {
        provider: provider.provider,
        externalAccountId: parsed.externalAccountId,
        eventType: parsed.eventType,
      });

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    this.store.markWebhookReceived(account.id, parsed.occurredAt ?? now);

    if (account.status !== "active") {
      this.logger.warn?.("Ignoring webhook job enqueue for non-active device sync account.", {
        provider: provider.provider,
        accountId: account.id,
        status: account.status,
        eventType: parsed.eventType,
      });

      return {
        accepted: true,
        duplicate: false,
        provider: provider.provider,
        eventType: parsed.eventType,
        traceId: parsed.traceId,
      };
    }

    this.enqueueJobs(account, parsed.jobs);

    return {
      accepted: true,
      duplicate: false,
      provider: provider.provider,
      eventType: parsed.eventType,
      traceId: parsed.traceId,
    };
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
    const jobs = provider.createScheduledJobs?.(account, now).jobs ?? [{ kind: "reconcile", priority: 80 }];
    const primary = jobs[0] ?? { kind: "reconcile", priority: 80 };
    const queued = this.store.enqueueJob({
      provider: provider.provider,
      accountId: account.id,
      kind: primary.kind,
      payload: primary.payload ?? {},
      priority: Math.max(primary.priority ?? 0, 80),
      availableAt: now,
      maxAttempts: primary.maxAttempts ?? 5,
      dedupeKey: `${primary.dedupeKey ?? `manual-reconcile:${now}`}`,
    });

    return {
      account: this.toPublicAccount(account),
      job: queued,
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

  private resolveReturnTo(candidate: string | null): string | null {
    const resolved = resolveRelativeOrAllowedOriginUrl(
      candidate,
      this.publicBaseUrl,
      this.allowedReturnOrigins,
    );

    if (candidate && !resolved) {
      throw deviceSyncError({
        code: "RETURN_TO_INVALID",
        message: "returnTo must be a relative path or an allowed origin URL.",
        retryable: false,
        httpStatus: 400,
      });
    }

    return resolved;
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

  private enqueueJobs(account: StoredDeviceSyncAccount, jobs: readonly DeviceSyncJobInput[]): DeviceSyncJobRecord[] {
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
