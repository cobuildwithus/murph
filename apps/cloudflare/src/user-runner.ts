import type {
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchStatus,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionAssistantCronTickDispatch,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import type { R2BucketLike } from "./bundle-store.js";
import {
  createHostedDispatchPayloadStore,
  type HostedDispatchPayloadStore,
} from "./dispatch-payload-store.js";
import { HostedGatewayProjectionStore } from "./gateway-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { toStringEnvSource } from "./string-env.js";
import {
  type HostedExecutionCommitPayload,
} from "./execution-journal.js";
import {
  createHostedUserKeyStore,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import {
  createRunnerCommitRecovery,
} from "./user-runner/runner-commit-recovery.js";
import {
  appendHostedWakeDispatchInWeb,
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
  quarantineHostedWakeInWeb,
} from "./web-control-plane.ts";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import {
  RunnerDispatchProcessor,
  HostedExecutionObsoleteRunResultError,
  type RunnerUserStores,
} from "./user-runner/runner-dispatch-processor.js";
import type { RunnerLeaseOwnerInput } from "./user-runner/runner-queue-store.js";
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import { RunnerQueueStore } from "./user-runner/runner-queue-store.js";
import { RunnerScheduler } from "./user-runner/runner-scheduler.js";
import {
  shouldAdvanceHostedWakeCursor,
  type HostedWakeDrainState,
} from "./user-runner/runner-wake-state.js";
import {
  toUserStatus,
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

const DEFAULT_HOSTED_WAKE_BATCH_LIMIT = 64;
const HOSTED_WAKE_CRON_APPEND_RETRY_DELAY_MS = 5_000;
const HOSTED_WAKE_DISPATCH_POLL_INTERVAL_MS = 250;
const MAX_HOSTED_WAKE_DRAIN_ROUNDS = 32;
const HOSTED_WAKE_QUARANTINE_INVALID_DISPATCH = "invalid-dispatch-payload";
const HOSTED_WAKE_QUARANTINE_USER_MISMATCH = "dispatch-user-mismatch";

function emitHostedUserKeyAuditLog(record: HostedUserKeyAuditRecord): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.user-key-store",
    level: "warn",
    message: `${record.action}: ${record.reason}`,
    phase: "runtime.starting",
    userId: record.userId,
  });
}

export class HostedUserRunner {
  private readonly dispatchProcessor: RunnerDispatchProcessor;
  private readonly eventTransitionLocks = new Map<string, Promise<void>>();
  private readonly queueStore: RunnerQueueStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly scheduler: RunnerScheduler;
  private readonly userKeyStore: ReturnType<typeof createHostedUserKeyStore>;
  private runnerStores: RunnerUserStores | null = null;
  private userKeyEnvelopeLock: Promise<void> | null = null;
  private wakeDrainLock: Promise<void> | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
    private readonly runnerRuntimeEnvSource: Readonly<Record<string, unknown>> = {},
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null = (
      state as {
        runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
      }
    ).runnerContainerNamespace ?? null,
  ) {
    this.runnerContainerNamespace = runnerContainerNamespace;
    const userKeyStore = createHostedUserKeyStore({
      auditLog: emitHostedUserKeyAuditLog,
      automationRecipientKeyId: env.automationRecipientKeyId,
      automationRecipientPrivateKey: env.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: env.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: env.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: env.platformEnvelopeKey,
      envelopeEncryptionKeyId: env.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: env.platformEnvelopeKeysById,
      recoveryRecipientKeyId: env.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: env.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: env.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: env.teeAutomationRecipientPublicKey,
    });
    this.userKeyStore = userKeyStore;
    const runner = this;
    const dispatchPayloadStore: HostedDispatchPayloadStore = {
      deleteDispatchPayload: async (ref) => {
        if (!bucket.delete) {
          return;
        }

        await bucket.delete(ref.stagedPayloadId);
      },

      readDispatchPayload: async (ref) => {
        const userId = await runner.tryReadBoundUserId();
        if (!userId) {
          throw new Error("Hosted runner user is not initialized.");
        }

        return (await runner.resolveUserDispatchPayloadStore(userId)).readDispatchPayload(ref);
      },

      writeDispatchPayload: async (dispatch) => {
        return (await runner.resolveUserDispatchPayloadStore(dispatch.event.userId))
          .writeDispatchPayload(dispatch);
      },
    };
    this.queueStore = new RunnerQueueStore(
      state,
      dispatchPayloadStore,
    );
    this.scheduler = new RunnerScheduler(this.queueStore, state);
    this.dispatchProcessor = new RunnerDispatchProcessor({
      applyHostedTransition: <T>(input: {
        eventId: string;
        gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
        leaseOwner?: RunnerLeaseOwnerInput;
        run: (userId: string, stores: RunnerUserStores) => Promise<T>;
      }) => this.applyHostedTransition(input),
      bucket: this.bucket,
      ensureRunnerStores: (userId?: string) => this.ensureRunnerStores(userId),
      env: this.env,
      hostedWebBaseUrl: toStringEnvSource(this.runnerRuntimeEnvSource).HOSTED_WEB_BASE_URL ?? null,
      queueStore: this.queueStore,
      readRunnerRuntimeConfigSource: () => this.readRunnerRuntimeConfigSource(),
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.runnerRuntimeEnvSource,
      scheduler: this.scheduler,
    });
  }

  private async ensureRunnerStores(userId?: string): Promise<RunnerUserStores> {
    const resolvedUserId = userId ?? await this.requireBoundUserId();

    if (this.runnerStores?.userId === resolvedUserId && !this.userKeyEnvelopeLock) {
      return this.runnerStores;
    }

    return this.withUserKeyEnvelopeLock(async () => {
      if (this.runnerStores?.userId === resolvedUserId) {
        return this.runnerStores;
      }

      return this.refreshRunnerStores(resolvedUserId);
    });
  }

  private async ensureRunnerStoresWhileHoldingKeyLock(userId: string): Promise<RunnerUserStores> {
    if (this.runnerStores?.userId === userId) {
      return this.runnerStores;
    }

    return this.refreshRunnerStores(userId);
  }

  private async refreshRunnerStores(userId: string): Promise<RunnerUserStores> {
    const crypto = await this.userKeyStore.requireUserCryptoContext(userId, {
      reason: "user-runner-store-refresh",
    });

    const stores: RunnerUserStores = {
      bundleSync: new RunnerBundleSync(
        this.bucket,
        crypto.rootKey,
        crypto.rootKeyId,
        crypto.keysById,
        this.queueStore,
      ),
      commitRecovery: createRunnerCommitRecovery({
        bucket: this.bucket,
        platformEnvelopeKey: crypto.rootKey,
        platformEnvelopeKeyId: crypto.rootKeyId,
        platformEnvelopeKeysById: crypto.keysById,
        queueStore: this.queueStore,
        scheduler: this.scheduler,
      }),
      crypto,
      gatewayStore: new HostedGatewayProjectionStore(this.state, {
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }),
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };

    this.runnerStores = stores;
    return stores;
  }

  private async resolveUserDispatchPayloadStore(userId: string): Promise<HostedDispatchPayloadStore> {
    const crypto = this.runnerStores?.userId === userId
      ? this.runnerStores.crypto
      : await this.userKeyStore.requireUserCryptoContext(userId, {
        reason: "dispatch-payload-access",
      });

    return createHostedDispatchPayloadStore({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    });
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    await this.queueStore.bootstrapUser(userId);
    return { userId };
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureManagedUserCryptoForActivationIfNeeded(input);
    await this.ensureRunnerStores(input.event.userId);
    return this.dispatchProcessor.dispatchBootstrapped(input);
  }

  async dispatchWithOutcome(
    input: HostedExecutionDispatchRequest,
    stagedPayloadId: string | null = null,
  ): Promise<HostedExecutionDispatchResult> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureManagedUserCryptoForActivationIfNeeded(input);
    await this.ensureRunnerStores(input.event.userId);
    const initialStatus = await this.queueStore.readEventDispatchStatus(input.eventId);
    const status = await this.dispatchProcessor.dispatchBootstrapped(input, stagedPayloadId);
    const nextStatus = await this.queueStore.readEventDispatchStatus(input.eventId);

    return {
      event: resolveHostedExecutionDispatchStatus({
        eventId: input.eventId,
        initialStatus,
        nextStatus,
        userId: input.event.userId,
      }),
      status,
    };
  }

  private async ensureManagedUserCryptoForActivationIfNeeded(
    input: HostedExecutionDispatchRequest,
  ): Promise<void> {
    if (input.event.kind !== "member.activated") {
      return;
    }

    await this.provisionManagedUserCryptoAtActivation(input.event.userId, "member-activation-dispatch");
  }

  async alarm(): Promise<void> {
    let record: RunnerStateRecord;
    try {
      record = await this.queueStore.readState();
    } catch {
      return;
    }

    record = await this.queueStore.clearNextWakeIfDue(Date.now());
    if (!record.runtimeBootstrapped && record.pendingEventCount === 0) {
      return;
    }

    const hostedWebBaseUrl = this.readHostedWebControlBaseUrl();
    if (record.runtimeBootstrapped && !(await this.queueStore.hasDuePendingDispatch(Date.now()))) {
      if (record.userId && hostedWebBaseUrl && this.env.webCallbackSigning) {
        try {
          const dispatch = buildHostedExecutionAssistantCronTickDispatch({
            eventId: `alarm:${Date.now()}`,
            occurredAt: new Date().toISOString(),
            reason: "alarm",
            userId: record.userId,
          });
          const append = await appendHostedWakeDispatchInWeb({
            baseUrl: hostedWebBaseUrl,
            boundUserId: record.userId,
            callbackSigning: this.env.webCallbackSigning,
            dispatch,
            timeoutMs: this.env.runnerTimeoutMs,
          });
          await this.wakeHostedWakes({
            targetSeqHint: append.wake.seq,
          });
          record = await this.queueStore.readState();
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "hosted.user-runner",
            error,
            level: "warn",
            message: "Hosted cron wake append failed; scheduling a retry.",
            phase: "dispatch.running",
            userId: record.userId,
          });
          record = await this.scheduler.syncNextWake(
            new Date(Date.now() + HOSTED_WAKE_CRON_APPEND_RETRY_DELAY_MS).toISOString(),
          );
        }
      } else {
        const enqueueResult = await this.queueStore.enqueueDispatch({
          event: {
            kind: "assistant.cron.tick",
            reason: "alarm",
            userId: record.userId,
          },
          eventId: `alarm:${Date.now()}`,
          occurredAt: new Date().toISOString(),
        });

        if (enqueueResult.accepted) {
          record = await this.scheduler.syncNextWake();
        } else {
          record = enqueueResult.record;
        }
      }
    }

    if (!record.runtimeBootstrapped && record.pendingEventCount === 0) {
      return;
    }

    await this.dispatchProcessor.runQueuedEvents(record.userId);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.queueStore.readState());
  }

  async getEventStatus(input: {
    eventId: string;
  }): Promise<HostedExecutionDispatchStatus | null> {
    return this.queueStore.readEventDispatchStatus(input.eventId);
  }

  async wakeHostedWakes(input: {
    targetSeqHint?: string | null;
  } = {}): Promise<HostedExecutionUserStatus> {
    return this.withWakeDrainLock(async () => this.wakeHostedWakesInternal(input));
  }

  private async wakeHostedWakesInternal(input: {
    targetSeqHint?: string | null;
  }): Promise<HostedExecutionUserStatus> {
    const userId = await this.requireBoundUserId();
    const hostedWebBaseUrl = this.readHostedWebControlBaseUrl();

    if (!hostedWebBaseUrl) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        level: "warn",
        message: "Hosted wake drain skipped because HOSTED_WEB_BASE_URL is not configured.",
        phase: "dispatch.running",
        userId,
      });
      return this.status();
    }

    await this.queueStore.bootstrapUser(userId);
    const targetSeqHint = parseOptionalHostedWakeSeq(input.targetSeqHint);
    let afterSeq: string | null = null;
    let expectedVersion: string | null = null;

    for (let round = 0; round < MAX_HOSTED_WAKE_DRAIN_ROUNDS; round += 1) {
      const batch = await fetchHostedWakeBatchFromWeb({
        afterSeq,
        baseUrl: hostedWebBaseUrl,
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        limit: DEFAULT_HOSTED_WAKE_BATCH_LIMIT,
        timeoutMs: this.env.runnerTimeoutMs,
      });
      afterSeq = batch.cursor.committedSeq;
      expectedVersion = batch.cursor.version;

      if (batch.wakes.length === 0) {
        if (targetSeqHint && BigInt(batch.cursor.committedSeq) < targetSeqHint) {
          emitHostedExecutionStructuredLog({
            component: "hosted.user-runner",
            level: "info",
            message: "Hosted wake drain saw no unseen rows before the target sequence hint.",
            phase: "dispatch.running",
            userId,
          });
        }

        break;
      }

      let highestCommittedWakeSeq: string | null = null;
      let advancedWakeCount = 0;
      let stoppingState: HostedWakeDrainState | null = null;

      for (const wake of batch.wakes) {
        const state = await this.dispatchHostedWakeRecord(wake);

        if (shouldAdvanceHostedWakeCursor(state)) {
          highestCommittedWakeSeq = wake.seq;
          advancedWakeCount += 1;
        }

        if (!shouldAdvanceHostedWakeCursor(state)) {
          stoppingState = state;
          break;
        }
      }

      if (!highestCommittedWakeSeq || !expectedVersion) {
        break;
      }

      const bundleState = await this.queueStore.readBundleMetaState();
      const commit = await commitHostedWakeCursorToWeb({
        baseUrl: hostedWebBaseUrl,
        body: {
          committedSeq: highestCommittedWakeSeq,
          expectedVersion,
          snapshotRef: bundleState.bundleRef ?? null,
        },
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      afterSeq = commit.cursor.committedSeq;
      expectedVersion = commit.cursor.version;

      if (!commit.committed) {
        emitHostedExecutionStructuredLog({
          component: "hosted.user-runner",
          level: "info",
          message: "Hosted wake cursor commit lost a compare-and-swap race; refetching cursor state.",
          phase: "dispatch.running",
          userId,
        });
      }

      if (advancedWakeCount < batch.wakes.length) {
        if (stoppingState === "poisoned") {
          continue;
        }

        break;
      }

      if (
        batch.wakes.length < DEFAULT_HOSTED_WAKE_BATCH_LIMIT
        && (!targetSeqHint || BigInt(afterSeq) >= targetSeqHint)
      ) {
        break;
      }
    }

    return this.status();
  }

  private async dispatchHostedWakeRecord(wake: {
    id: string;
    payloadJson?: unknown;
    seq: string;
  }): Promise<HostedWakeDrainState> {
    const userId = await this.requireBoundUserId();
    let dispatch: HostedExecutionDispatchRequest;

    try {
      dispatch = parseHostedExecutionDispatchRequest(wake.payloadJson);
    } catch {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        level: "warn",
        message: `Hosted wake seq ${wake.seq} has an invalid dispatch payload and cannot be executed.`,
        phase: "dispatch.running",
        userId,
      });
      return await this.quarantineHostedWakeRecord(
        userId,
        wake.id,
        HOSTED_WAKE_QUARANTINE_INVALID_DISPATCH,
      )
        ? "quarantined"
        : "backpressured";
    }

    if (dispatch.event.userId !== userId) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        level: "warn",
        message: `Hosted wake seq ${wake.seq} is bound to ${dispatch.event.userId}, not ${userId}.`,
        phase: "dispatch.running",
        userId,
      });
      return await this.quarantineHostedWakeRecord(
        userId,
        wake.id,
        HOSTED_WAKE_QUARANTINE_USER_MISMATCH,
      )
        ? "quarantined"
        : "backpressured";
    }

    const result = await this.dispatchWithOutcome(dispatch);

    if (
      result.event.state === "completed"
      || result.event.state === "poisoned"
      || result.event.state === "backpressured"
    ) {
      return result.event.state;
    }

    return this.waitForHostedDispatchCompletion(dispatch.eventId);
  }

  private async quarantineHostedWakeRecord(
    userId: string,
    wakeId: string,
    quarantineCode: string,
  ): Promise<boolean> {
    const hostedWebBaseUrl = this.readHostedWebControlBaseUrl();

    if (!hostedWebBaseUrl || !this.env.webCallbackSigning) {
      return false;
    }

    try {
      const response = await quarantineHostedWakeInWeb({
        baseUrl: hostedWebBaseUrl,
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        quarantineCode,
        timeoutMs: this.env.runnerTimeoutMs,
        wakeId,
      });

      return response.quarantined;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        error,
        level: "warn",
        message: `Failed to quarantine hosted wake ${wakeId}.`,
        phase: "dispatch.running",
        userId,
      });
      return false;
    }
  }

  private async waitForHostedDispatchCompletion(
    eventId: string,
  ): Promise<HostedExecutionDispatchLifecycleState> {
    const deadline = Date.now() + this.env.runnerTimeoutMs;

    while (Date.now() < deadline) {
      const status = await this.queueStore.readEventDispatchStatus(eventId);

      if (
        status?.state === "completed"
        || status?.state === "poisoned"
        || status?.state === "backpressured"
      ) {
        return status.state;
      }

      await delay(HOSTED_WAKE_DISPATCH_POLL_INTERVAL_MS);
    }

    return (await this.queueStore.readEventDispatchStatus(eventId))?.state ?? "queued";
  }

  private async applyHostedTransition<T>(input: {
    eventId: string;
    gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
    leaseOwner?: RunnerLeaseOwnerInput;
    run: (userId: string, stores: RunnerUserStores) => Promise<T>;
  }): Promise<T> {
    return this.withEventTransitionLock(input.eventId, async () => {
      if (input.leaseOwner && !(await this.queueStore.hasActiveRunLease(input.leaseOwner))) {
        throw new HostedExecutionObsoleteRunResultError(
          input.eventId,
          input.leaseOwner.run?.runId ?? null,
        );
      }

      return this.withUserKeyEnvelopeLock(async () => {
        const userId = await this.requireBoundUserId();
        const stores = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
        const result = await input.run(userId, stores);
        await stores.gatewayStore.applySnapshot(input.gatewayProjectionSnapshot ?? null);
        return result;
      });
    });
  }

  private readAllowedRunnerSecretsSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: this.env.allowedRunnerSecretKeys ?? undefined,
    };
  }

  private createRunnerSecretsService(crypto: HostedUserCryptoContext): RunnerSecretsService {
    return new RunnerSecretsService(
      this.bucket,
      crypto.rootKey,
      crypto.rootKeyId,
      crypto.keysById,
      this.readAllowedRunnerSecretsSource(),
    );
  }

  private readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return {
      ...this.readWorkerStringEnvSource(),
      ...this.readAllowedRunnerSecretsSource(),
    };
  }

  private readWorkerStringEnvSource(): Readonly<Record<string, string | undefined>> {
    return toStringEnvSource(this.runnerRuntimeEnvSource);
  }

  private readHostedWebControlBaseUrl(): string | null {
    return this.readWorkerStringEnvSource().HOSTED_WEB_BASE_URL ?? null;
  }

  private async resolveRunnerSecretsServiceWhileHoldingKeyLock(
    userId: string,
    options: {
      reason: string;
    },
  ): Promise<RunnerSecretsService | null> {
    if (this.runnerStores?.userId === userId) {
      return this.runnerStores.runnerSecrets;
    }

    if (!(await this.userKeyStore.hasManagedUserCryptoEnvelope(userId))) {
      return null;
    }

    const crypto = await this.userKeyStore.requireUserCryptoContext(userId, {
      reason: options.reason,
    });
    return this.createRunnerSecretsService(crypto);
  }

  private async provisionManagedUserCryptoAtActivation(
    userId: string,
    reason: string,
  ) {
    const status = await this.userKeyStore.provisionManagedUserCryptoAtActivation(userId, {
      reason,
    });

    if (status.needsRunnerStoreRefresh && this.runnerStores?.userId === userId) {
      this.runnerStores = null;
    }

    return status;
  }

  private async requireBoundUserId(): Promise<string> {
    return (await this.queueStore.readState()).userId;
  }

  private async tryReadBoundUserId(): Promise<string | null> {
    if (this.runnerStores?.userId) {
      return this.runnerStores.userId;
    }

    try {
      return (await this.queueStore.readState()).userId;
    } catch {
      return null;
    }
  }

  private async withEventTransitionLock<T>(eventId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.eventTransitionLocks.get(eventId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.eventTransitionLocks.set(eventId, chain);
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.eventTransitionLocks.get(eventId) === chain) {
        this.eventTransitionLocks.delete(eventId);
      }
    }
  }

  private async withUserKeyEnvelopeLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.userKeyEnvelopeLock ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.userKeyEnvelopeLock = chain;
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.userKeyEnvelopeLock === chain) {
        this.userKeyEnvelopeLock = null;
      }
    }
  }

  private async withWakeDrainLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.wakeDrainLock ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.wakeDrainLock = chain;
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.wakeDrainLock === chain) {
        this.wakeDrainLock = null;
      }
    }
  }
}

function parseOptionalHostedWakeSeq(value: string | null | undefined): bigint | null {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveHostedExecutionDispatchStatus(input: {
  eventId: string;
  initialStatus: HostedExecutionDispatchStatus | null;
  nextStatus: HostedExecutionDispatchStatus | null;
  userId: string;
}): HostedExecutionDispatchStatus {
  const currentStatus = input.nextStatus ?? input.initialStatus;

  if (input.nextStatus?.state === "poisoned") {
    return {
      eventId: input.eventId,
      lastError: input.nextStatus.lastError,
      state: "poisoned",
      userId: input.userId,
    };
  }

  if (input.nextStatus?.state === "backpressured") {
    return {
      eventId: input.eventId,
      lastError: input.nextStatus.lastError,
      state: "backpressured",
      userId: input.userId,
    };
  }

  if (input.nextStatus?.state === "completed" || input.initialStatus?.state === "completed") {
    return {
      eventId: input.eventId,
      lastError: input.nextStatus?.lastError ?? input.initialStatus?.lastError ?? null,
      state: "completed",
      userId: input.userId,
    };
  }

  return {
    eventId: input.eventId,
    lastError: currentStatus?.lastError ?? null,
    state: "queued",
    userId: input.userId,
  };
}
