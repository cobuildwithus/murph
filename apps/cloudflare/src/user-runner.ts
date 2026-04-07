import type { CloudflareHostedUserEnvStatus } from "@murphai/cloudflare-hosted-control";
import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionOutboxPayload,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  GatewayFetchAttachmentsInput,
  GatewayGetConversationInput,
  GatewayListConversationsInput,
  GatewayListConversationsResult,
  GatewayListOpenPermissionsInput,
  GatewayPermissionRequest,
  GatewayPollEventsInput,
  GatewayPollEventsResult,
  GatewayReadMessagesInput,
  GatewayReadMessagesResult,
  GatewayRespondToPermissionInput,
} from "@murphai/gateway-core";
import {
  emitHostedExecutionStructuredLog,
  resolveHostedExecutionDispatchOutcomeState,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import {
  createHostedExecutionDispatchPayloadStore,
  type HostedDispatchPayloadStore,
} from "./dispatch-payload-store.js";
import { createHostedDeviceSyncRuntimeStore } from "./device-sync-runtime-store.ts";
import { createHostedPendingUsageStore } from "./usage-store.ts";
import { HostedGatewayProjectionStore } from "./gateway-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import {
  persistHostedExecutionCommit,
  type HostedExecutionCommitPayload,
  type HostedExecutionCommittedResult,
} from "./execution-journal.js";
import { readHostedEmailConfig } from "./hosted-email.js";
import {
  createHostedUserKeyStore,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import { listHostedUserEnvKeys, type HostedUserEnvUpdate } from "./user-env.js";
import {
  createRunnerCommitRecovery,
  type RunnerCommitRecovery,
} from "./user-runner/runner-commit-recovery.js";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import {
  RunnerDispatchProcessor,
  type RunnerUserStores,
} from "./user-runner/runner-dispatch-processor.js";
import { RunnerUserEnvService } from "./user-runner/runner-user-env.js";
import { RunnerQueueStore } from "./user-runner/runner-queue-store.js";
import { RunnerScheduler } from "./user-runner/runner-scheduler.js";
import {
  toUserStatus,
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

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
  private userEnvLock: Promise<void> | null = null;
  private userKeyEnvelopeLock: Promise<void> | null = null;

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
    const dispatchPayloadParserStore = createHostedExecutionDispatchPayloadStore({
      bucket,
      key: env.platformEnvelopeKey,
      keyId: env.platformEnvelopeKeyId,
      keysById: env.platformEnvelopeKeysById,
    });
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

      deleteStoredDispatchPayload: async (payloadJson) => {
        const dispatchRef = dispatchPayloadParserStore.readStoredDispatchRef(payloadJson);

        if (!dispatchRef) {
          return;
        }

        await (await runner.resolveUserDispatchPayloadStore(dispatchRef.userId))
          .deleteStoredDispatchPayload(payloadJson);
      },

      readDispatchPayload: async (ref) => {
        const userId = await runner.tryReadBoundUserId();
        if (!userId) {
          throw new Error("Hosted runner user is not initialized.");
        }

        return (await runner.resolveUserDispatchPayloadStore(userId)).readDispatchPayload(ref);
      },

      readStoredDispatch: async (payloadJson) => {
        const dispatchRef = dispatchPayloadParserStore.readStoredDispatchRef(payloadJson);
        if (!dispatchRef) {
          return dispatchPayloadParserStore.readStoredDispatch(payloadJson);
        }

        return (await runner.resolveUserDispatchPayloadStore(dispatchRef.userId))
          .readStoredDispatch(payloadJson);
      },

      readStoredDispatchRef(payloadJson) {
        return dispatchPayloadParserStore.readStoredDispatchRef(payloadJson);
      },

      writeDispatchPayload: async (dispatch) => {
        return (await runner.resolveUserDispatchPayloadStore(dispatch.event.userId))
          .writeDispatchPayload(dispatch);
      },

      writeStoredDispatch: async (dispatch) => {
        return (await runner.resolveUserDispatchPayloadStore(dispatch.event.userId))
          .writeStoredDispatch(dispatch);
      },
    };
    this.queueStore = new RunnerQueueStore(
      state,
      dispatchPayloadStore,
    );
    this.scheduler = new RunnerScheduler(this.queueStore, state, env.defaultAlarmDelayMs);
    this.dispatchProcessor = new RunnerDispatchProcessor({
      applyHostedTransition: <T>(input: {
        eventId: string;
        gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
        run: (userId: string, stores: RunnerUserStores) => Promise<T>;
      }) => this.applyHostedTransition(input),
      bucket: this.bucket,
      ensureRunnerStores: (userId?: string) => this.ensureRunnerStores(userId),
      env: this.env,
      queueStore: this.queueStore,
      readRunnerRuntimeConfigSource: () => this.readRunnerRuntimeConfigSource(),
      readWorkerStringEnvSource: () => this.readWorkerStringEnvSource(),
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
    const allowedUserEnvSource = this.readAllowedUserEnvSource();
    const hostedEmailConfig = readHostedEmailConfig(this.readWorkerStringEnvSource());

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
      userEnv: new RunnerUserEnvService(
        this.bucket,
        crypto.rootKey,
        crypto.rootKeyId,
        crypto.keysById,
        this.env.platformEnvelopeKey,
        this.env.platformEnvelopeKeyId,
        this.env.platformEnvelopeKeysById,
        allowedUserEnvSource,
        hostedEmailConfig,
      ),
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

    return createHostedExecutionDispatchPayloadStore({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    });
  }

  async gatewayListConversations(
    input?: GatewayListConversationsInput,
  ): Promise<GatewayListConversationsResult> {
    return (await this.ensureRunnerStores()).gatewayStore.listConversations(input);
  }

  async gatewayGetConversation(input: GatewayGetConversationInput) {
    return (await this.ensureRunnerStores()).gatewayStore.getConversation(input);
  }

  async gatewayReadMessages(
    input: GatewayReadMessagesInput,
  ): Promise<GatewayReadMessagesResult> {
    return (await this.ensureRunnerStores()).gatewayStore.readMessages(input);
  }

  async gatewayFetchAttachments(input: GatewayFetchAttachmentsInput) {
    return (await this.ensureRunnerStores()).gatewayStore.fetchAttachments(input);
  }

  async gatewayPollEvents(
    input?: GatewayPollEventsInput,
  ): Promise<GatewayPollEventsResult> {
    return (await this.ensureRunnerStores()).gatewayStore.pollEvents(input);
  }

  async gatewayListOpenPermissions(
    input?: GatewayListOpenPermissionsInput,
  ): Promise<GatewayPermissionRequest[]> {
    return (await this.ensureRunnerStores()).gatewayStore.listOpenPermissions(input);
  }

  async gatewayRespondToPermission(
    input: GatewayRespondToPermissionInput,
  ): Promise<GatewayPermissionRequest | null> {
    return (await this.ensureRunnerStores()).gatewayStore.respondToPermission(input);
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    await this.queueStore.bootstrapUser(userId);
    return { userId };
  }

  async provisionManagedUserCrypto(userId: string): Promise<{ recipientKinds: string[]; rootKeyId: string; userId: string }> {
    await this.queueStore.bootstrapUser(userId);
    const crypto = await this.userKeyStore.bootstrapManagedUserCryptoContext(userId, {
      reason: "managed-user-provisioning",
    });
    this.runnerStores = null;
    return {
      recipientKinds: crypto.envelope.recipients.map((recipient) => recipient.kind),
      rootKeyId: crypto.rootKeyId,
      userId,
    };
  }

  async getDeviceSyncRuntimeSnapshot(input: {
    request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
    const userId = await this.requireBoundUserId();

    if (input.request.userId !== userId) {
      throw new TypeError("Hosted device-sync runtime snapshot userId does not match the bound user.");
    }

    const { crypto } = await this.ensureRunnerStores(userId);
    return createHostedDeviceSyncRuntimeStore({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).readSnapshot(input.request);
  }

  async applyDeviceSyncRuntimeUpdates(input: {
    request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
    const userId = await this.requireBoundUserId();

    if (input.request.userId !== userId) {
      throw new TypeError("Hosted device-sync runtime apply userId does not match the bound user.");
    }

    return this.withUserKeyEnvelopeLock(async () => {
      const { crypto } = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
      return createHostedDeviceSyncRuntimeStore({
        bucket: this.bucket,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).applyUpdates(input.request);
    });
  }

  async putPendingUsage(input: {
    usage: readonly Record<string, unknown>[];
  }): Promise<{ recorded: number; usageIds: string[] }> {
    return this.withUserKeyEnvelopeLock(async () => {
      const userId = await this.requireBoundUserId();
      const { crypto } = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
      return createHostedPendingUsageStore({
        bucket: this.bucket,
        dirtyKey: this.env.platformEnvelopeKey,
        dirtyKeyId: this.env.platformEnvelopeKeyId,
        dirtyKeysById: this.env.platformEnvelopeKeysById,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).appendUsage({
        usage: input.usage,
        userId,
      });
    });
  }

  async readPendingUsage(input?: { limit?: number | null }): Promise<Record<string, unknown>[]> {
    const userId = await this.requireBoundUserId();
    const { crypto } = await this.ensureRunnerStores(userId);
    return createHostedPendingUsageStore({
      bucket: this.bucket,
      dirtyKey: this.env.platformEnvelopeKey,
      dirtyKeyId: this.env.platformEnvelopeKeyId,
      dirtyKeysById: this.env.platformEnvelopeKeysById,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).readUsage({
      limit: input?.limit ?? undefined,
      userId,
    });
  }

  async deletePendingUsage(input: { usageIds: readonly string[] }): Promise<void> {
    await this.withUserKeyEnvelopeLock(async () => {
      const userId = await this.requireBoundUserId();
      const { crypto } = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
      await createHostedPendingUsageStore({
        bucket: this.bucket,
        dirtyKey: this.env.platformEnvelopeKey,
        dirtyKeyId: this.env.platformEnvelopeKeyId,
        dirtyKeysById: this.env.platformEnvelopeKeysById,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).deleteUsage({
        usageIds: input.usageIds,
        userId,
      });
    });
  }

  async deleteStoredDispatchPayload(input: {
    payload: HostedExecutionOutboxPayload;
  }): Promise<void> {
    const userId = input.payload.storage === "inline"
      ? input.payload.dispatch.event.userId
      : input.payload.dispatchRef.userId;

    await this.queueStore.bootstrapUser(userId);
    await this.withUserKeyEnvelopeLock(async () => {
      await (await this.resolveUserDispatchPayloadStore(userId))
        .deleteStoredDispatchPayload(input.payload);
    });
  }

  async storeDispatchPayload(input: {
    dispatch: HostedExecutionDispatchRequest;
  }): Promise<HostedExecutionOutboxPayload> {
    await this.queueStore.bootstrapUser(input.dispatch.event.userId);
    await this.ensureRunnerStores(input.dispatch.event.userId);
    return (await this.resolveUserDispatchPayloadStore(input.dispatch.event.userId))
      .writeStoredDispatch(input.dispatch);
  }

  async dispatchStoredPayload(input: {
    payload: HostedExecutionOutboxPayload;
  }): Promise<HostedExecutionDispatchResult> {
    const userId = input.payload.storage === "inline"
      ? input.payload.dispatch.event.userId
      : input.payload.dispatchRef.userId;
    const dispatch = await (await this.resolveUserDispatchPayloadStore(userId))
      .readStoredDispatch(input.payload);

    return this.dispatchWithOutcome(
      dispatch,
      input.payload.storage === "reference" ? input.payload.stagedPayloadId : null,
    );
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureRunnerStores(input.event.userId);
    return this.dispatchProcessor.dispatchBootstrapped(input);
  }

  async dispatchWithOutcome(
    input: HostedExecutionDispatchRequest,
    stagedPayloadId: string | null = null,
  ): Promise<HostedExecutionDispatchResult> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureRunnerStores(input.event.userId);
    const initialState = await this.queueStore.readEventState(input.eventId);
    const status = await this.dispatchProcessor.dispatchBootstrapped(input, stagedPayloadId);
    const nextState = await this.queueStore.readEventState(input.eventId);

    return {
      event: {
        eventId: input.eventId,
        lastError: nextState.lastError ?? status.lastError,
        state: resolveHostedExecutionDispatchOutcomeState({
          initialState,
          nextState,
        }),
        userId: input.event.userId,
      },
      status,
    };
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

    if (record.runtimeBootstrapped && !(await this.queueStore.hasDuePendingDispatch(Date.now()))) {
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

    if (!record.runtimeBootstrapped && record.pendingEventCount === 0) {
      return;
    }

    await this.dispatchProcessor.runQueuedEvents(record.userId);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.queueStore.readState());
  }

  async getUserEnvStatus(): Promise<CloudflareHostedUserEnvStatus> {
    const userId = await this.requireBoundUserId();
    const { userEnv } = await this.ensureRunnerStores(userId);
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await userEnv.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<CloudflareHostedUserEnvStatus> {
    return this.withUserKeyEnvelopeLock(async () => {
      const userId = await this.requireBoundUserId();
      const { userEnv } = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
      return this.withUserEnvLock(() => userEnv.updateUserEnv(userId, update));
    });
  }

  async clearUserEnv(): Promise<CloudflareHostedUserEnvStatus> {
    return this.updateUserEnv({
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRef: HostedExecutionBundleRef | null;
    };
  }): Promise<HostedExecutionCommittedResult> {
    return this.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      run: async (userId, stores) => {
        return persistHostedExecutionCommit({
          bucket: this.bucket,
          currentBundleRef: input.payload.currentBundleRef,
          eventId: input.eventId,
          key: stores.crypto.rootKey,
          keyId: stores.crypto.rootKeyId,
          keysById: stores.crypto.keysById,
          payload: input.payload,
          userId,
        });
      },
    });
  }

  private async applyHostedTransition<T>(input: {
    eventId: string;
    gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
    run: (userId: string, stores: RunnerUserStores) => Promise<T>;
  }): Promise<T> {
    return this.withEventTransitionLock(input.eventId, async () => {
      return this.withUserKeyEnvelopeLock(async () => {
        const userId = await this.requireBoundUserId();
        const stores = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
        const result = await input.run(userId, stores);
        await stores.gatewayStore.applySnapshot(input.gatewayProjectionSnapshot ?? null);
        return result;
      });
    });
  }

  private readAllowedUserEnvSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: this.env.allowedUserEnvKeys ?? undefined,
    };
  }

  private readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return {
      ...this.readWorkerStringEnvSource(),
      ...this.readAllowedUserEnvSource(),
    };
  }

  private readWorkerStringEnvSource(): Readonly<Record<string, string | undefined>> {
    const values: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(this.runnerRuntimeEnvSource)) {
      values[key] = typeof value === "string" ? value : undefined;
    }

    return values;
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

  private async withUserEnvLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.userEnvLock ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.userEnvLock = chain;
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.userEnvLock === chain) {
        this.userEnvLock = null;
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
}
