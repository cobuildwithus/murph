import {
  createImporters,
  JunctionSparseCalendarRepairNormalizationError,
} from "@murphai/importers";

import {
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
} from "./provider-job-definitions.ts";
import { buildDeviceSyncTokenCipherOptions, createSecretCodec } from "./local-secret-codec.ts";
import { deviceSyncError, isDeviceSyncError } from "./errors.ts";
import { JunctionTimeseriesProgressError } from "./junction-timeseries-progress.ts";
import {
  isJunctionCompanionHrvRmssdJob,
  isJunctionSparseCalendarRefreshJob,
  isJunctionSparseCalendarRefreshPayloadValid,
  isJunctionSparseCalendarRefreshTerminalFailureCode,
  JUNCTION_CALENDAR_REFRESH_JOB_INVALID_CODE,
  JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE,
} from "./junction-resources.ts";
import { buildJunctionProviderSourceInstanceKey } from "./config/junction-connect-sources.ts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
  sanitizeHostedRuntimeDiagnosticText,
  sanitizeHostedRuntimeErrorText,
} from "./hosted-runtime.ts";
import { createDeviceSyncPublicIngress, DeviceSyncPublicIngress } from "./public-ingress.ts";
import {
  isDeviceSyncConnectionSetupPending,
  toRedactedPublicDeviceSyncAccount,
} from "./public-account.ts";
import { createDeviceSyncRegistry } from "./registry.ts";
import {
  addMilliseconds,
  computeRetryDelayMs,
  defaultStateDatabasePath,
  generatePrefixedId,
  normalizeString,
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
  DeviceJobBatchExecutor,
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
  ProviderJobConnectionSource,
  ProviderJobContext,
  ProviderJobBatchDescriptor,
  ProviderSnapshotImportReceipt,
  PublicDeviceSyncAccount,
  PublicProviderDescriptor,
  QueueManualReconcileResult,
  StartConnectionInput,
  StoredDeviceSyncAccount,
} from "./types.ts";

export { SqliteDeviceSyncStore } from "./store.ts";

export function resolveDeviceSyncStoreNextJobWakeAt(input: {
  stateDatabasePath?: string | null;
  vaultRoot: string;
}): string | null {
  const store = new SqliteDeviceSyncStore(
    input.stateDatabasePath ?? defaultStateDatabasePath(input.vaultRoot),
  );

  try {
    return store.readNextJobWakeAt();
  } finally {
    store.close();
  }
}

export function resolveDeviceSyncStoreNextWakeAt(input: {
  stateDatabasePath?: string | null;
  vaultRoot: string;
}): string | null {
  const store = new SqliteDeviceSyncStore(
    input.stateDatabasePath ?? defaultStateDatabasePath(input.vaultRoot),
  );

  try {
    return earliestIsoTimestamp(
      store.readNextActiveReconcileAt(),
      store.readNextJobWakeAt(),
    );
  } finally {
    store.close();
  }
}

const DEVICE_SYNC_VALIDATION_ISSUE_LIMIT = 10;
const DEVICE_SYNC_VALIDATION_CAUSE_DEPTH_LIMIT = 4;
const DEVICE_SYNC_JOB_YIELD_POLL_MS = 100;
// Never retain fewer diagnostics than one hosted pass can produce, and never
// regress below the established 100-attempt observability window.
export const DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_LIMIT = Math.max(
  100,
  HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
);
const DEVICE_SYNC_CONNECTION_MUTATION_MAX_PENDING = 1;
const DEVICE_SYNC_CONNECTION_MUTATION_WAIT_TIMEOUT_MS = 15_000;
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
  // Hosted runtimes override job-time reads so Web remains the source of truth;
  // local runtimes continue reading the service's SQLite store.
  listConnectionSourcesForJob?(input: {
    accountId: string;
    provider: string;
    signal?: AbortSignal;
    sourceProviderSlug?: string | null;
    status?: ProviderJobConnectionSource["status"] | null;
  }): ProviderJobConnectionSource[] | Promise<ProviderJobConnectionSource[]>;
  store?: SqliteDeviceSyncStore;
  clock?: DeviceSyncClock;
  schedulerMutex?: DeviceSyncTickMutex;
  workerMutex?: DeviceSyncTickMutex;
  workerExecutor?: DeviceSyncWorkerExecutor;
}

export interface DeviceSyncClock {
  now(): Date;
}

export interface DeviceSyncTickMutex {
  runIfIdle<T>(operation: () => Promise<T>): Promise<T | undefined>;
}

export interface DeviceSyncWorkerExecutor {
  drainWorker(limit: number): Promise<number>;
}

export interface DeviceSyncService {
  readonly vaultRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly registry: DeviceSyncRegistry;
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
  queueManualReconcile(accountId: string): QueueManualReconcileResult;
  disconnectAccount(accountId: string, expectedConnectedAt: string): Promise<DisconnectAccountResult>;
  getNextJobWakeAt(): string | null;
  getNextWakeAt(now?: string): string | null;
  runSchedulerOnce(accountId?: string): Promise<DeviceSyncJobRecord[]>;
  runWorkerOnce(accountId?: string): Promise<DeviceSyncJobRecord | null>;
  // Drains up to `limit` durable job rows. One worker pass starts from one
  // claimed seed job, but provider batching still counts every claimed row.
  drainWorker(limit?: number, accountId?: string): Promise<number>;
}

const defaultDeviceSyncClock: DeviceSyncClock = Object.freeze({
  now: () => new Date(),
});

function createDeviceSyncTickMutex(): DeviceSyncTickMutex {
  let inFlight = false;

  return {
    async runIfIdle(operation) {
      if (inFlight) {
        return undefined;
      }

      inFlight = true;

      try {
        return await operation();
      } finally {
        inFlight = false;
      }
    },
  };
}

class DeviceSyncServiceController {
  readonly vaultRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedReturnOrigins: string[];
  readonly registry: DeviceSyncRegistry;

  private readonly logger: DeviceSyncLogger;
  private readonly importer: DeviceSyncImporterPort;
  private readonly listConnectionSourcesForJob: CreateDeviceSyncServiceInput["listConnectionSourcesForJob"];
  private readonly store: SqliteDeviceSyncStore;
  private readonly publicIngress: DeviceSyncPublicIngress;
  private readonly codec: ReturnType<typeof createSecretCodec>;
  private readonly clock: DeviceSyncClock;
  private readonly schedulerMutex: DeviceSyncTickMutex;
  private readonly workerMutex: DeviceSyncTickMutex;
  private readonly workerExecutor: DeviceSyncWorkerExecutor;
  private readonly workerLeaseMs: number;
  private readonly workerPollMs: number;
  private readonly workerBatchSize: number;
  private readonly schedulerPollMs: number;
  private readonly shouldYieldJobExecution: (() => boolean) | null;
  private readonly workerId: string;
  private readonly ownsStore: boolean;
  private workerTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private readonly jobFailureDiagnostics: DeviceSyncJobFailureDiagnostic[] = [];
  private readonly connectionMutationStates = new Map<string, {
    activeAndWaiting: number;
    tail: Promise<void>;
  }>();

  constructor(input: CreateDeviceSyncServiceInput) {
    this.vaultRoot = input.config.vaultRoot;
    this.publicBaseUrl = normalizePublicBaseUrl(input.config.publicBaseUrl);
    this.allowedReturnOrigins = normalizeOriginList(input.config.allowedReturnOrigins);
    this.registry = input.registry ?? createDeviceSyncRegistry(input.providers ?? []);
    this.importer = input.importer ?? createDefaultImporterPort();
    this.listConnectionSourcesForJob = input.listConnectionSourcesForJob;
    this.logger = input.config.log ?? console;
    this.clock = input.clock ?? defaultDeviceSyncClock;
    this.schedulerMutex = input.schedulerMutex ?? createDeviceSyncTickMutex();
    this.workerMutex = input.workerMutex ?? createDeviceSyncTickMutex();
    this.workerExecutor = input.workerExecutor ?? {
      drainWorker: (limit) => this.drainWorker(limit),
    };
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
        discardUnconsumedOAuthState: (state, now, expectedProvider, expectedOwnerId) =>
          this.store.discardUnconsumedOAuthState(
            state,
            now,
            expectedProvider,
            expectedOwnerId,
          ),
        resolveOAuthStateWithoutProviderAuthority: (claim) =>
          this.store.resolveOAuthStateWithoutProviderAuthority(claim),
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
              existingAccountPolicy: record.existingAccountPolicy,
              connectedAt: record.connectedAt,
              nextReconcileAt: record.nextReconcileAt ?? null,
              oauthClaim: record.oauthClaim,
            }),
          ),
        markConnectionSetupFailed: (record) => {
          const result = this.store.markConnectionSetupFailed(
            record.accountId,
            record.expectedConnectedAt,
            record.now,
            record.code,
            record.message,
            record.oauthClaim,
          );
          return {
            account: result.account ? this.toPublicAccount(result.account) : null,
            applied: result.applied,
            blockedByRefreshLease: result.blockedByRefreshLease,
            oauthTokenVersion: result.oauthTokenVersion,
          };
        },
        clearOAuthCredentialAfterConfirmedRevoke: (record) =>
          this.store.clearOAuthCredentialAfterConfirmedRevoke(
            record.accountId,
            record.expectedConnectedAt,
            record.expectedTokenVersion,
            record.now,
          ),
        getOAuthCleanupAccount: (record) => {
          const account = this.store.getAccountById(record.accountId);
          if (
            !account
            || account.connectedAt !== record.expectedConnectedAt
            || account.localTokenRevision !== record.expectedTokenVersion
            || account.status !== "reauthorization_required"
            || account.setupPhase !== "failed"
            || account.credential.kind !== "oauth_tokens"
          ) {
            return null;
          }
          return this.toDecryptedAccount(account);
        },
        getConnectionById: (accountId) => {
          const account = this.store.getAccountById(accountId);
          return account ? this.toPublicAccount(account) : null;
        },
        getConnectionByExternalAccount: (provider, externalAccountId) => {
          const account = this.store.getAccountByExternalAccount(provider, externalAccountId);
          return account ? this.toPublicAccount(account) : null;
        },
        upsertConnectionSource: (input) => this.store.upsertConnectionSource(input),
        listConnectionSources: (input) => this.store.listConnectionSources(input),
        claimWebhookTrace: (record) => this.store.claimWebhookTrace(record),
        completeWebhookTrace: (provider, traceId, claimToken) =>
          this.store.completeWebhookTrace(provider, traceId, claimToken),
        releaseWebhookTrace: (provider, traceId, claimToken) =>
          this.store.releaseWebhookTrace(provider, traceId, claimToken),
        markWebhookReceived: (accountId, now) => this.store.markWebhookReceived(accountId, now),
        markConnectionSourceDataReceived: (input) =>
          this.store.markConnectionSourceDataReceived(input),
      },
      hooks: {
        runConnectionMutation: ({ provider }, operation) =>
          this.runProviderConnectionMutation(provider, operation),
        onConnectionEstablished: async ({
          account,
          connection,
          now,
          provider,
          sourceProviderSlug,
        }) => {
          const sourceInstanceKey = provider.provider === "junction" && sourceProviderSlug
            ? buildJunctionProviderSourceInstanceKey({
                connectionId: account.id,
                sourceProviderSlug,
              })
            : null;
          this.store.commitConnectionEstablished({
            accountId: account.id,
            jobs: this.normalizeJobsForEnqueue(account, connection.initialJobs ?? []),
            provider: account.provider,
            source: sourceInstanceKey && sourceProviderSlug
              ? {
                  connectionId: account.id,
                  sourceInstanceKey,
                  sourceProviderSlug,
                  status: "connected",
                  firstSeenAt: now,
                  lastSeenAt: now,
                }
              : null,
          });
          await this.ensureWebhookAdminUpkeepAfterConnectionEstablished(provider);
          return {
            sourceAdmissionCommitted: true,
          };
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

  private async runProviderConnectionMutation<Result>(
    provider: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const existingState = this.connectionMutationStates.get(provider);
    if (
      existingState
      && existingState.activeAndWaiting >= DEVICE_SYNC_CONNECTION_MUTATION_MAX_PENDING + 1
    ) {
      throw connectionMutationBusyError();
    }

    const state = existingState ?? {
      activeAndWaiting: 0,
      tail: Promise.resolve(),
    };
    const previous = state.tail;
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    state.activeAndWaiting += 1;
    state.tail = tail;
    this.connectionMutationStates.set(provider, state);
    let waitTimeout: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        previous,
        new Promise<never>((_resolve, reject) => {
          waitTimeout = setTimeout(
            () => reject(connectionMutationBusyError()),
            DEVICE_SYNC_CONNECTION_MUTATION_WAIT_TIMEOUT_MS,
          );
        }),
      ]);
      if (waitTimeout) {
        clearTimeout(waitTimeout);
        waitTimeout = null;
      }
      return await operation();
    } finally {
      if (waitTimeout) {
        clearTimeout(waitTimeout);
      }
      releaseCurrent();
      state.activeAndWaiting -= 1;
      void tail.then(() => {
        if (
          state.activeAndWaiting === 0
          && state.tail === tail
          && this.connectionMutationStates.get(provider) === state
        ) {
          this.connectionMutationStates.delete(provider);
        }
      });
    }
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
    return this.handleConnectionCallback(input);
  }

  async handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult> {
    return this.publicIngress.handleConnectionCallback(input);
  }

  async handleWebhook(providerName: string, headers: Headers, rawBody: Buffer): Promise<HandleWebhookResult> {
    return this.publicIngress.handleWebhook(providerName, headers, rawBody);
  }

  queueManualReconcile(accountId: string): QueueManualReconcileResult {
    const account = this.requireStoredAccount(accountId);

    if (
      account.status === "active"
      && isDeviceSyncConnectionSetupPending(account)
    ) {
      throw deviceSyncError({
        code: "CONNECTION_SETUP_PENDING",
        message: "Finish device sync setup before reconciling this account.",
        retryable: false,
        httpStatus: 409,
      });
    }

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
    const now = this.nowIso();
    const scheduledJobs = resolveProviderJobExecutor(provider)?.createScheduledJobs?.(account, now).jobs ?? [];
    const jobs = scheduledJobs.length > 0 ? scheduledJobs : [{ kind: "reconcile", priority: 80 }];
    const queuedJobs = this.enqueueJobs(
      account,
      jobs.map((job) => ({
        ...job,
        priority: job.kind === "reconcile" ? Math.max(job.priority ?? 0, 80) : job.priority,
        availableAt: job.kind === "reconcile" ? now : job.availableAt ?? now,
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

  async disconnectAccount(
    accountId: string,
    expectedConnectedAt: string,
  ): Promise<DisconnectAccountResult> {
    const normalizedExpectedConnectedAt = normalizeString(expectedConnectedAt);
    if (!normalizedExpectedConnectedAt) {
      throw connectionGenerationRequiredError();
    }

    const account = this.requireStoredAccount(accountId);
    return await this.runProviderConnectionMutation(account.provider, () =>
      this.disconnectAccountAfterConnectionMutation(accountId, normalizedExpectedConnectedAt)
    );
  }

  private async disconnectAccountAfterConnectionMutation(
    accountId: string,
    expectedConnectedAt: string,
  ): Promise<DisconnectAccountResult> {
    const account = this.requireStoredAccount(accountId);
    if (account.connectedAt !== expectedConnectedAt) {
      throw connectionChangedDuringDisconnectError();
    }
    const provider = this.requireProvider(account.provider);
    const now = this.nowIso();

    if (account.status !== "disconnected") {
      try {
        const decrypted = this.toDecryptedAccount(account);
        await provider.connectionHandler?.revokeAccess?.(decrypted);
      } catch (error) {
        this.logger.warn?.("Provider revoke access failed during disconnect; continuing local disconnect.", {
          provider: provider.provider,
          accountId: account.id,
          failureCode: "DEVICE_SYNC_DISCONNECT_REVOKE_FAILED",
          error: summarizeError(error),
        });
      }
    }

    const disconnected = this.store.disconnectAccountAndMarkPendingJobsDeadIfConnectedAt({
      accountId: account.id,
      code: "ACCOUNT_DISCONNECTED",
      expectedConnectedAt,
      message: "Device account disconnected.",
      now,
    });

    if (!disconnected) {
      throw connectionChangedDuringDisconnectError();
    }

    return {
      account: this.toPublicAccount(disconnected),
    };
  }

  getNextWakeAt(_now = this.nowIso()): string | null {
    const nextWakeAt = earliestIsoTimestamp(
      this.store.readNextActiveReconcileAt(),
      this.store.readNextJobWakeAt(),
    );

    if (!nextWakeAt) {
      return null;
    }

    return nextWakeAt;
  }

  getNextJobWakeAt(): string | null {
    return this.store.readNextJobWakeAt();
  }

  async runSchedulerOnce(accountId?: string): Promise<DeviceSyncJobRecord[]> {
    return await this.schedulerMutex.runIfIdle(async () => {
      const now = this.nowIso();
      const queuedJobs: DeviceSyncJobRecord[] = [];

      try {
        for (const account of this.store.listAccounts()) {
          if (
            (accountId !== undefined && account.id !== accountId)
            || account.status !== "active"
            || isDeviceSyncConnectionSetupPending(account)
            || !account.nextReconcileAt
            || Date.parse(account.nextReconcileAt) > Date.parse(now)
          ) {
            continue;
          }

          const provider = this.registry.get(account.provider);

          const jobExecutor = provider ? resolveProviderJobExecutor(provider) : undefined;

          if (!jobExecutor?.createScheduledJobs) {
            continue;
          }

          const schedule = jobExecutor.createScheduledJobs(account, now);
          queuedJobs.push(...this.enqueueJobs(account, schedule.jobs));
          this.store.patchAccount(account.id, {
            nextReconcileAt: schedule.nextReconcileAt ?? null,
          });
        }
      } catch (error) {
        this.logger.error?.("Device sync scheduler tick failed.", {
          failureCode: "DEVICE_SYNC_SCHEDULER_TICK_FAILED",
          error: summarizeError(error),
        });
      }
      return queuedJobs;
    }) ?? [];
  }

  async runWorkerOnce(accountId?: string): Promise<DeviceSyncJobRecord | null> {
    const result = await this.runWorkerPassOnce({
      accountId,
      maxJobRows: Number.POSITIVE_INFINITY,
    });
    return result?.job ?? null;
  }

  private async runWorkerPassOnce(input: {
    accountId?: string;
    maxJobRows: number;
  }): Promise<{
    job: DeviceSyncJobRecord;
    processedJobRows: number;
  } | null> {
    const maxJobRows = normalizeProviderJobBatchLimit(
      input.maxJobRows,
      DEFAULT_PROVIDER_JOB_BATCH_MAX_JOBS,
    );
    if (maxJobRows <= 0) {
      return null;
    }

    if (this.shouldYieldJobExecution?.() === true) {
      return null;
    }

    const now = this.nowIso();
    const job = this.store.claimDueJob(
      this.workerId,
      now,
      this.workerLeaseMs,
      input.accountId,
    );
    const currentNow = (): string => this.nowIso();

    if (!job) {
      return null;
    }

    let activeJobs: DeviceSyncJobRecord[] = [job];
    const finishPass = (): {
      job: DeviceSyncJobRecord;
      processedJobRows: number;
    } => ({
      job,
      processedJobRows: Math.max(1, activeJobs.length),
    });
    const failClaimedJob = (
      code: string,
      message: string,
      retryAt: string | null,
      retryable: boolean,
    ): boolean => {
      const failedAt = currentNow();
      const failed = this.store.failJobIfOwned(job.id, this.workerId, failedAt, code, message, retryAt, retryable);

      if (!failed) {
        this.logger.debug?.("Device sync job side effects skipped because execution was cancelled.", {
          provider: job.provider,
          accountId: job.accountId,
          jobId: job.id,
        });
        return failed;
      }

      // No summary here: these repo-authored messages can embed the local
      // account id, and the failure code already names the cause.
      const failedJobResource = readSafeDiagnosticToken(job.payload.resource);
      this.recordJobFailureDiagnostic({
        accountId: job.accountId,
        accountStatus: null,
        at: failedAt,
        attempts: job.attempts,
        code,
        details: {},
        jobKind: job.kind,
        provider: job.provider,
        ...(failedJobResource ? { resource: failedJobResource } : {}),
        retryable,
      });
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
      return finishPass();
    }

    const storedAccount = this.store.getAccountById(job.accountId);

    if (!storedAccount) {
      failClaimedJob("ACCOUNT_NOT_FOUND", `Device sync account ${job.accountId} does not exist.`, null, false);
      return finishPass();
    }

    const preservesAcceptedCompanionHrv = isJunctionCompanionHrvRmssdJob(job);
    const retainsAcceptedCalendarRefresh = isJunctionSparseCalendarRefreshJob(job);
    const retainsAcceptedWork = preservesAcceptedCompanionHrv || retainsAcceptedCalendarRefresh;
    const delayRetainedJobUntilAuthorityReturns = (code: string, message: string): void => {
      const delayedAt = currentNow();
      this.store.failJobIfOwned(
        job.id,
        this.workerId,
        delayedAt,
        code,
        message,
        addMilliseconds(delayedAt, computeRetryDelayMs(job.attempts)),
        true,
        true,
      );
    };

    if (
      retainsAcceptedCalendarRefresh
      && !isJunctionSparseCalendarRefreshPayloadValid(job.payload)
    ) {
      failClaimedJob(
        JUNCTION_CALENDAR_REFRESH_JOB_INVALID_CODE,
        "Junction calendar refresh job payload was invalid.",
        null,
        false,
      );
      return finishPass();
    }

    if (
      storedAccount.status === "active"
      && isDeviceSyncConnectionSetupPending(storedAccount)
      && !retainsAcceptedWork
    ) {
      failClaimedJob(
        "CONNECTION_SETUP_PENDING",
        "Device sync setup must finish before queued jobs can run.",
        null,
        false,
      );
      return finishPass();
    }

    if (
      storedAccount.status === "active"
      && isDeviceSyncConnectionSetupPending(storedAccount)
      && retainsAcceptedCalendarRefresh
    ) {
      delayRetainedJobUntilAuthorityReturns(
        "CONNECTION_SETUP_PENDING",
        "Device sync setup must finish before retained calendar work can run.",
      );
      return finishPass();
    }

    if (storedAccount.status === "disconnected" && retainsAcceptedCalendarRefresh) {
      delayRetainedJobUntilAuthorityReturns(
        "ACCOUNT_DISCONNECTED",
        "Device sync account must reconnect before retained calendar work can run.",
      );
      return finishPass();
    }

    if (storedAccount.status === "disconnected" && !preservesAcceptedCompanionHrv) {
      const completed = this.store.completeJobIfOwned(job.id, this.workerId, currentNow());

      if (!completed) {
        this.logger.debug?.("Device sync job side effects skipped because execution was cancelled.", {
          provider: job.provider,
          accountId: job.accountId,
          jobId: job.id,
        });
      }
      return finishPass();
    }

    if (storedAccount.status === "reauthorization_required" && retainsAcceptedCalendarRefresh) {
      delayRetainedJobUntilAuthorityReturns(
        "ACCOUNT_REAUTHORIZATION_REQUIRED",
        "Device sync account must reauthorize before retained calendar work can run.",
      );
      return finishPass();
    }

    if (storedAccount.status === "reauthorization_required" && !preservesAcceptedCompanionHrv) {
      const failed = failClaimedJob(
        "ACCOUNT_REAUTHORIZATION_REQUIRED",
        "Device sync account requires reconnection before queued jobs can run.",
        null,
        false,
      );
      if (failed) {
        this.store.markPendingJobsDeadForAccountIfCurrent({
          accountId: storedAccount.id,
          code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
          expectedLocalConnectionRevision: storedAccount.localConnectionRevision,
          expectedStatus: "reauthorization_required",
          message: "Device sync account requires reconnection before queued jobs can run.",
          now: currentNow(),
        });
      }
      return finishPass();
    }

    if (storedAccount.status === "active") {
      this.store.markSyncStarted(storedAccount.id, now);
    }

    const disconnectGeneration = storedAccount.disconnectGeneration;
    const localConnectionRevision = storedAccount.localConnectionRevision;
    const jobExecutor = resolveProviderJobExecutor(provider);

    if (!jobExecutor) {
      failClaimedJob(
        "JOB_EXECUTOR_NOT_SUPPORTED",
        `Device sync provider ${provider.provider} does not support job execution.`,
        null,
        false,
      );
      return finishPass();
    }

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
    const isOriginalActiveAccountExecutionCurrent = (): boolean => {
      const currentStoredAccount = this.store.getAccountById(storedAccount.id);

      return !!currentStoredAccount
        && currentStoredAccount.status === "active"
        && currentStoredAccount.disconnectGeneration === disconnectGeneration
        && currentStoredAccount.localConnectionRevision === localConnectionRevision;
    };
    const isAccountExecutionCurrent = (): boolean =>
      preservesAcceptedCompanionHrv
        ? this.store.getAccountById(storedAccount.id) !== null
        : isOriginalActiveAccountExecutionCurrent();
    const releaseActiveJobsIfCurrentAccountActive = (releaseNow: string): number => {
      const currentStoredAccount = this.store.getAccountById(storedAccount.id);

      if (!currentStoredAccount || (
        !preservesAcceptedCompanionHrv
        && !retainsAcceptedCalendarRefresh
        && (
          currentStoredAccount.status !== "active"
          || currentStoredAccount.disconnectGeneration !== disconnectGeneration
        )
      )) {
        return 0;
      }

      return activeJobs.filter((activeJob) =>
        this.store.releaseJobIfOwned(activeJob.id, this.workerId, releaseNow)
      ).length;
    };
    const ensureAccountActive = (): void => {
      if (!isAccountExecutionCurrent()) {
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
      activeJobs = preservesAcceptedCompanionHrv || retainsAcceptedCalendarRefresh
        ? [normalizedJob]
        : this.claimProviderJobBatch({
            accountId: storedAccount.id,
            jobExecutor,
            maxJobRows,
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
        connectionSourceAdmissionMode: this.listConnectionSourcesForJob
          ? "listed_only"
          : "discover_unlisted",
        ...(this.shouldYieldJobExecution
          ? { shouldYield: this.shouldYieldJobExecution }
          : {}),
        throwIfAborted: assertJobExecutionNotYielded,
        importSnapshot: async (snapshot: unknown) => {
          ensureExecutionActive();
          const importResult = await this.importer.importDeviceProviderSnapshot({
            provider: provider.provider,
            snapshot,
            vaultRoot: this.vaultRoot,
          });
          const canonicalSparseCalendarTargets =
            readCanonicalDeviceImportSparseCalendarTargets(importResult);
          const receipt: ProviderSnapshotImportReceipt = {
            canonicalEventCount: readCanonicalDeviceImportEventCount(importResult),
            canonicalEventDayKeys: readCanonicalDeviceImportEventDayKeys(importResult),
            canonicalEventExternalRefResourceIds:
              readCanonicalDeviceImportEventExternalRefResourceIds(importResult),
            ...(canonicalSparseCalendarTargets.length > 0
              ? { canonicalSparseCalendarTargets }
              : {}),
            durableDeliveryAccepted: true,
          };
          return receipt;
        },
        upsertConnectionSource: (input) => {
          ensureExecutionActive();
          return this.store.upsertConnectionSource({
            ...input,
            connectionId: currentAccount.id,
          });
        },
        listConnectionSources: async (input = {}) => {
          ensureExecutionActive();
          const sources = this.listConnectionSourcesForJob
            ? await this.listConnectionSourcesForJob({
                accountId: currentAccount.id,
                provider: currentAccount.provider,
                signal: jobAbortController.signal,
                ...input,
              })
            : this.store.listConnectionSources({
                ...input,
                connectionId: currentAccount.id,
              });
          ensureExecutionActive();
          return sources;
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
          const disconnected = this.store.disconnectAccountAndMarkPendingJobsDeadIfCurrent({
            accountId: currentAccount.id,
            code: "ACCOUNT_DISCONNECTED",
            expectedLocalConnectionRevision: localConnectionRevision,
            expectedStatus: "active",
            message: "Device account disconnected.",
            now: currentNow(),
          });

          if (!disconnected) {
            throw new DeviceSyncJobExecutionCancelledError(storedAccount.id, job.id);
          }

          currentAccount = this.toDecryptedAccount(disconnected);
        },
        logger: this.logger,
      };
      const result = normalizedJobs.length > 1 && jobExecutor.batch
        ? await jobExecutor.batch.execute(jobContext, normalizedJobs)
        : await jobExecutor.executeJob(jobContext, normalizedJob);

      ensureJobLeasesOwned();
      ensureAccountActive();

      if (preservesAcceptedCompanionHrv && !isOriginalActiveAccountExecutionCurrent()) {
        this.store.completeJobsIfOwned(
          activeJobs.map((activeJob) => activeJob.id),
          this.workerId,
          currentNow(),
        );
        return finishPass();
      }

      const successOptions: {
        localConnectionRevision: number;
        metadataPatch?: Record<string, unknown>;
        nextReconcileAt?: string | null;
        preserveLastSyncCompletedAt?: boolean;
      } = {
        localConnectionRevision,
      };

      if (
        provider.provider === "junction"
        && shouldPreserveJunctionLastSyncCompletedAt({
          activeJobs,
          scheduledJobs: result.scheduledJobs ?? [],
          syncSucceededAt: now,
        })
      ) {
        successOptions.preserveLastSyncCompletedAt = true;
      }

      if (Object.prototype.hasOwnProperty.call(result, "metadataPatch")) {
        successOptions.metadataPatch = result.metadataPatch;
      }

      if (Object.prototype.hasOwnProperty.call(result, "nextReconcileAt")) {
        successOptions.nextReconcileAt = result.nextReconcileAt ?? null;
      }

      const scheduledJobs = this.normalizeJobsForEnqueue(storedAccount, result.scheduledJobs ?? []);
      const completed = this.store.completeJobsMarkSyncSucceededAndEnqueueJobs({
        accountId: storedAccount.id,
        completedAt: currentNow(),
        disconnectGeneration,
        jobIds: activeJobs.map((activeJob) => activeJob.id),
        jobs: scheduledJobs,
        provider: provider.provider,
        syncSucceededAt: now,
        syncSuccessOptions: successOptions,
        workerId: this.workerId,
      });

      if (!completed) {
        releaseActiveJobsIfCurrentAccountActive(currentNow());
        return finishPass();
      }

      return finishPass();
    } catch (error) {
      if (isDeviceSyncJobExecutionYielded(error, jobAbortController.signal)) {
        const releaseNow = currentNow();
        const released = releaseActiveJobsIfCurrentAccountActive(releaseNow);
        this.logger.debug?.("Device sync job yielded before completion.", {
          provider: provider.provider,
          jobId: job.id,
          jobCount: activeJobs.length,
          released,
        });
        return finishPass();
      }

      if (error instanceof DeviceSyncJobExecutionCancelledError) {
        const releaseNow = currentNow();
        const released = releaseActiveJobsIfCurrentAccountActive(releaseNow);
        this.logger.debug?.("Device sync job side effects skipped because execution was cancelled.", {
          provider: provider.provider,
          accountId: storedAccount.id,
          jobId: job.id,
          ...(released > 0 ? { released } : {}),
        });
        return finishPass();
      }

      const timeseriesProgress = error instanceof JunctionTimeseriesProgressError
        ? error
        : null;
      const failure = normalizeExecutionError(timeseriesProgress?.failure ?? error);
      const replacementPayload = timeseriesProgress
        ? normalizeConfiguredDeviceSyncJobRecord(
            provider.provider,
            {
              ...job,
              payload: {
                ...job.payload,
                windowStart: timeseriesProgress.windowStart,
                workoutStreamCursor:
                  timeseriesProgress.workoutStreamCursor ?? undefined,
              },
            },
            "retry progress",
          ).payload
        : undefined;
      const retainsAcceptedCompanionHrvUntilSuccess = preservesAcceptedCompanionHrv
        && failure.code !== JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE;
      const retainsAcceptedCalendarRefreshUntilSuccess = retainsAcceptedCalendarRefresh
        && !isJunctionSparseCalendarRefreshTerminalFailureCode(failure.code);
      const retainsAcceptedWorkUntilSuccess = retainsAcceptedCompanionHrvUntilSuccess
        || retainsAcceptedCalendarRefreshUntilSuccess;
      const retainedFailureRetryable = failure.retryable
        || retainsAcceptedCompanionHrvUntilSuccess
        || retainsAcceptedCalendarRefreshUntilSuccess;
      const failureNow = currentNow();
      if (!isAccountExecutionCurrent()) {
        const released = releaseActiveJobsIfCurrentAccountActive(failureNow);
        this.logger.debug?.("Device sync job failure ignored because account execution was superseded.", {
          provider: provider.provider,
          accountId: storedAccount.id,
          jobId: job.id,
          jobCount: activeJobs.length,
          released,
        });
        return finishPass();
      }

      const failed = activeJobs
        .map((activeJob) => {
          const retryAt = retainedFailureRetryable
            ? addMilliseconds(failureNow, computeRetryDelayMs(activeJob.attempts))
            : null;
          return this.store.failJobIfOwned(
            activeJob.id,
            this.workerId,
            failureNow,
            failure.code,
            failure.message,
            retryAt,
            retainedFailureRetryable,
            retainsAcceptedWorkUntilSuccess,
            activeJob.id === job.id ? replacementPayload : undefined,
          );
        })
        .some(Boolean);

      if (!failed) {
        return finishPass();
      }

      const failedJobResource = readSafeDiagnosticToken(job.payload.resource);
      this.recordJobFailureDiagnostic({
        accountId: storedAccount.id,
        accountStatus: failure.accountStatus ?? null,
        at: failureNow,
        attempts: job.attempts,
        code: failure.code,
        details: failure.details,
        jobKind: job.kind,
        provider: provider.provider,
        ...(failedJobResource ? { resource: failedJobResource } : {}),
        retryable: retainedFailureRetryable,
        summary: failure.message,
      });
      if (preservesAcceptedCompanionHrv && !isOriginalActiveAccountExecutionCurrent()) {
        return finishPass();
      }
      const failureOptions = {
        disconnectGeneration,
        localConnectionRevision,
      };
      const markedFailed = this.store.markSyncFailed(
        storedAccount.id,
        failureNow,
        failure.code,
        failure.message,
        failure.accountStatus,
        failureOptions,
      );

      if (!markedFailed) {
        this.logger.debug?.("Device sync account failure state skipped because execution was superseded.", {
          provider: provider.provider,
          accountId: storedAccount.id,
          jobId: job.id,
          code: failure.code,
        });
        return finishPass();
      }

      if (failure.accountStatus === "reauthorization_required") {
        this.store.markPendingJobsDeadForAccountIfCurrent({
          accountId: storedAccount.id,
          code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
          expectedLocalConnectionRevision: localConnectionRevision + 1,
          expectedStatus: "reauthorization_required",
          message: "Device sync account requires reconnection before queued jobs can run.",
          now: failureNow,
        });
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
      return finishPass();
    } finally {
      stopYieldPolling();
    }
  }

  async drainWorker(limit = this.workerBatchSize, accountId?: string): Promise<number> {
    const maxJobRows = normalizeProviderJobBatchLimit(limit, this.workerBatchSize);
    let processedJobRows = 0;

    while (processedJobRows < maxJobRows) {
      const result = await this.runWorkerPassOnce({
        accountId,
        maxJobRows: maxJobRows - processedJobRows,
      });

      if (!result) {
        break;
      }

      processedJobRows += result.processedJobRows;
    }

    return processedJobRows;
  }

  private claimProviderJobBatch(input: {
    accountId: string;
    jobExecutor: DeviceJobExecutor;
    maxJobRows: number;
    normalizedSeedJob: DeviceSyncJobRecord;
    now: string;
    provider: string;
  }): DeviceSyncJobRecord[] {
    const batchExecutor = input.jobExecutor.batch;
    if (!batchExecutor) {
      return [input.normalizedSeedJob];
    }

    const seedDescriptor = readProviderJobBatchDescriptor({
      batchExecutor,
      job: input.normalizedSeedJob,
      logger: this.logger,
      provider: input.provider,
      role: "seed",
    });
    if (!isValidProviderJobBatchDescriptor(seedDescriptor)) {
      return [input.normalizedSeedJob];
    }

    const maxBatchSize = Math.min(
      normalizeProviderJobBatchLimit(
        batchExecutor.maxJobs,
        DEFAULT_PROVIDER_JOB_BATCH_MAX_JOBS,
      ),
      normalizeProviderJobBatchLimit(input.maxJobRows, DEFAULT_PROVIDER_JOB_BATCH_MAX_JOBS),
    );
    if (maxBatchSize <= 1) {
      return [input.normalizedSeedJob];
    }

    const maxEstimatedBytes = normalizeProviderJobBatchLimit(
      batchExecutor.maxEstimatedBytes,
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
        break;
      }

      const descriptor = readProviderJobBatchDescriptor({
        batchExecutor,
        job: normalizedCandidate,
        logger: this.logger,
        provider: input.provider,
        role: "candidate",
      });
      if (!isValidProviderJobBatchDescriptor(descriptor) || descriptor.key !== seedDescriptor.key) {
        break;
      }

      const estimatedBytes = normalizeProviderJobBatchEstimatedBytes(descriptor);
      if (totalEstimatedBytes + estimatedBytes > maxEstimatedBytes) {
        break;
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

  private async runWorkerBatchOnce(): Promise<void> {
    await this.workerMutex.runIfIdle(async () => {
      try {
        await this.workerExecutor.drainWorker(this.workerBatchSize);
      } catch (error) {
        this.logger.error?.("Device sync worker tick failed.", {
          failureCode: "DEVICE_SYNC_WORKER_TICK_FAILED",
          error: summarizeError(error),
        });
      }
    });
  }

  private nowIso(): string {
    return toIsoTimestamp(this.clock.now());
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

    if (this.jobFailureDiagnostics.length > DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_LIMIT) {
      this.jobFailureDiagnostics.splice(
        0,
        this.jobFailureDiagnostics.length - DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_LIMIT,
      );
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
    return this.normalizeJobsForEnqueue(account, jobs)
      .map((job) =>
        this.store.enqueueJob({
          provider: account.provider,
          accountId: account.id,
          kind: job.kind,
          payload: job.payload ?? {},
          priority: job.priority ?? 0,
          availableAt: job.availableAt,
          maxAttempts: job.maxAttempts,
          dedupeKey: job.dedupeKey,
        })
      );
  }

  private normalizeJobsForEnqueue(
    account: Pick<PublicDeviceSyncAccount, "provider">,
    jobs: readonly DeviceSyncJobInput[],
  ): DeviceSyncJobInput[] {
    return jobs.map((job) => normalizeConfiguredDeviceSyncJobInput(account.provider, job, "enqueue"));
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
        failureCode: "DEVICE_SYNC_WEBHOOK_ADMIN_UPKEEP_FAILED",
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
    queueManualReconcile: (accountId) => controller.queueManualReconcile(accountId),
    disconnectAccount: (accountId, expectedConnectedAt) =>
      controller.disconnectAccount(accountId, expectedConnectedAt),
    getNextJobWakeAt: () => controller.getNextJobWakeAt(),
    getNextWakeAt: (now) => controller.getNextWakeAt(now),
    runSchedulerOnce: (accountId) => controller.runSchedulerOnce(accountId),
    runWorkerOnce: (accountId) => controller.runWorkerOnce(accountId),
    drainWorker: (limit, accountId) => controller.drainWorker(limit, accountId),
  } satisfies DeviceSyncService);
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

function readProviderJobBatchDescriptor(input: {
  batchExecutor: DeviceJobBatchExecutor;
  job: DeviceSyncJobRecord;
  logger: DeviceSyncLogger;
  provider: string;
  role: "candidate" | "seed";
}): ProviderJobBatchDescriptor | null {
  try {
    return input.batchExecutor.describe(input.job);
  } catch (error) {
    input.logger.debug?.("Device sync provider batch descriptor failed; using single-job fallback.", {
      error: summarizeError(error),
      jobId: input.job.id,
      provider: input.provider,
      role: input.role,
    });
    return null;
  }
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

function connectionMutationBusyError(): DeviceSyncError {
  return deviceSyncError({
    code: "CONNECTION_MUTATION_BUSY",
    message: "Another device connection update is still in progress. Retry shortly.",
    retryable: true,
    httpStatus: 503,
  });
}

function connectionGenerationRequiredError(): DeviceSyncError {
  return deviceSyncError({
    code: "CONNECTION_GENERATION_REQUIRED",
    message: "Device account disconnect requires the expected connection generation.",
    retryable: false,
    httpStatus: 400,
  });
}

function connectionChangedDuringDisconnectError(): DeviceSyncError {
  return deviceSyncError({
    code: "CONNECTION_CHANGED_DURING_DISCONNECT",
    message: "Device sync connection changed before disconnect could start. Retry with the current account.",
    retryable: true,
    httpStatus: 409,
  });
}

function normalizeExecutionError(error: unknown): {
  code: string;
  details: DeviceSyncJobFailureDiagnostic["details"];
  message: string;
  retryable: boolean;
  accountStatus?: "reauthorization_required" | "disconnected" | null;
} {
  if (error instanceof JunctionSparseCalendarRepairNormalizationError) {
    return {
      code: error.code,
      details: {},
      message: error.message,
      retryable: true,
    };
  }

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

function readCanonicalDeviceImportEventCount(value: unknown): number {
  const record = toPlainRecord(value);
  return record && Array.isArray(record.events) ? record.events.length : 0;
}

function readCanonicalDeviceImportEventDayKeys(value: unknown): string[] {
  const record = toPlainRecord(value);
  if (!record || !Array.isArray(record.events)) {
    return [];
  }

  return [...new Set([
    ...record.events.flatMap((event) => {
      const dayKey = toPlainRecord(event)?.dayKey;
      return typeof dayKey === "string" ? [dayKey] : [];
    }),
    ...readStringArray(record.affectedEventDayKeys),
  ].filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/u.test(dayKey)))].sort();
}

function shouldPreserveJunctionLastSyncCompletedAt(input: {
  activeJobs: readonly DeviceSyncJobRecord[];
  scheduledJobs: readonly DeviceSyncJobInput[];
  syncSucceededAt: string;
}): boolean {
  if (input.scheduledJobs.some(isFullDeviceSyncJob)) {
    return true;
  }

  const currentClosedDayEnd = floorUtcDayTimestampIfValid(input.syncSucceededAt);
  if (!currentClosedDayEnd) {
    return true;
  }

  return !input.activeJobs.some((job) =>
    isFullDeviceSyncJob(job)
    && normalizeIsoTimestamp(job.payload.windowEnd) === currentClosedDayEnd
  );
}

function isFullDeviceSyncJob(job: Pick<DeviceSyncJobInput, "kind">): boolean {
  return job.kind === "backfill" || job.kind === "reconcile";
}

function floorUtcDayTimestampIfValid(value: string): string | null {
  const normalized = normalizeIsoTimestamp(value);
  return normalized ? `${normalized.slice(0, 10)}T00:00:00.000Z` : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readCanonicalDeviceImportEventExternalRefResourceIds(value: unknown): string[] {
  const record = toPlainRecord(value);
  if (!record || !Array.isArray(record.events)) {
    return [];
  }

  return record.events.flatMap((event) => {
    const externalRef = toPlainRecord(toPlainRecord(event)?.externalRef);
    return typeof externalRef?.resourceId === "string"
      ? [externalRef.resourceId]
      : [];
  });
}

function readCanonicalDeviceImportSparseCalendarTargets(value: unknown): Array<{
  dayKey: string;
  sourceInstanceId?: string | null;
  sourceProviderSlug: string;
  sourceType?: string;
}> {
  const record = toPlainRecord(value);
  if (!record || !Array.isArray(record.affectedSparseCalendarTargets)) {
    return [];
  }
  return record.affectedSparseCalendarTargets.flatMap((value) => {
    const target = toPlainRecord(value);
    const dayKey = target?.dayKey;
    const sourceProviderSlug = target?.sourceProviderSlug;
    if (
      typeof dayKey !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(dayKey)
      || typeof sourceProviderSlug !== "string"
      || !sourceProviderSlug
    ) {
      return [];
    }
    const sourceInstanceId = target.sourceInstanceId;
    const sourceType = target.sourceType;
    return [{
      dayKey,
      ...(typeof sourceInstanceId === "string" || sourceInstanceId === null
        ? { sourceInstanceId }
        : {}),
      sourceProviderSlug,
      ...(typeof sourceType === "string" ? { sourceType } : {}),
    }];
  });
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
    const cause = toPlainRecord(error.cause);
    return {
      category: isDeviceSyncError(error) ? "device_sync_error" : "unexpected_error",
      ...(isDeviceSyncError(error) ? { code: error.code } : {}),
      name: error.name,
      message: summarizeExecutionErrorMessage(error),
      ...(cause?.message
        ? { cause: readSafeDiagnosticText(cause.message) ?? "[redacted]" }
        : {}),
      ...(cause?.code
        ? { causeCode: readSafeDiagnosticToken(cause.code) ?? "[redacted]" }
        : {}),
      ...(cause?.name
        ? { causeName: readSafeDiagnosticToken(cause.name) ?? "[redacted]" }
        : {}),
    };
  }

  return {
    category: "non_error_throw",
    value: sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]",
  };
}
