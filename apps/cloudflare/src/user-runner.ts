import type {
  HostedExecutionBundleRefs,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionRunLevel,
  HostedExecutionRunContext,
  HostedExecutionRunPhase,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type { HostedAssistantRuntimeJobInput } from "@murphai/assistant-runtime";
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
  persistHostedExecutionFinalBundles,
  type HostedExecutionCommittedResult,
  type HostedExecutionCommitPayload,
  type HostedExecutionFinalizePayload,
} from "./execution-journal.js";
import {
  deleteHostedEmailRawMessage,
  readHostedEmailConfig,
} from "./hosted-email.js";
import {
  createHostedUserKeyStore,
  type HostedUserCryptoContext,
} from "./user-key-store.js";
import {
  HostedExecutionConfigurationError,
  type HostedExecutionContainerNamespaceLike,
  invokeHostedExecutionContainerRunner,
} from "./runner-container.js";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import { listHostedUserEnvKeys, type HostedUserEnvUpdate } from "./user-env.js";
import {
  createRunnerCommitRecovery,
  isCommittedResultFinalized,
  isCommittedResultFresh,
} from "./user-runner/runner-commit-recovery.js";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import { RunnerUserEnvService } from "./user-runner/runner-user-env.js";
import { RunnerQueueStore } from "./user-runner/runner-queue-store.js";
import { RunnerScheduler } from "./user-runner/runner-scheduler.js";
import {
  COMMITTED_RESULT_FRESH_WINDOW_MS,
  computeRetryDelayMs,
  toUserStatus,
  type DurableObjectStateLike,
  type PendingDispatchRecord,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

type HostedExecutionDispatchProgressRecord =
  Pick<HostedExecutionDispatchRequest, "eventId">
  & {
    event: Pick<HostedExecutionDispatchRequest["event"], "userId">;
  };

interface RunnerUserStores {
  bundleSync: RunnerBundleSync;
  commitRecovery: ReturnType<typeof createRunnerCommitRecovery>;
  crypto: HostedUserCryptoContext;
  gatewayStore: HostedGatewayProjectionStore;
  userEnv: RunnerUserEnvService;
  userId: string;
}

export class HostedUserRunner {
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
      key: env.bundleEncryptionKey,
      keyId: env.bundleEncryptionKeyId,
      keysById: env.bundleEncryptionKeysById,
    });
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: env.automationRecipientKeyId,
      automationRecipientPrivateKey: env.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: env.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: env.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: env.bundleEncryptionKey,
      envelopeEncryptionKeyId: env.bundleEncryptionKeyId,
      envelopeEncryptionKeysById: env.bundleEncryptionKeysById,
    });
    this.userKeyStore = userKeyStore;
    const runner = this;
    const dispatchPayloadStore: HostedDispatchPayloadStore = {
      deleteDispatchPayload: async (ref) => {
        if (!bucket.delete) {
          return;
        }

        await bucket.delete(ref.key);
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
    const crypto = await this.userKeyStore.ensureUserCryptoContext(userId);
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
        bundleEncryptionKey: crypto.rootKey,
        bundleEncryptionKeyId: crypto.rootKeyId,
        bundleEncryptionKeysById: crypto.keysById,
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
        this.env.bundleEncryptionKey,
        this.env.bundleEncryptionKeyId,
        this.env.bundleEncryptionKeysById,
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
      : await this.userKeyStore.ensureUserCryptoContext(userId);

    return createHostedExecutionDispatchPayloadStore({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    });
  }

  private async syncDeviceSyncRuntimeSnapshotFromDispatch(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<void> {
    if (dispatch.event.kind !== "device-sync.wake" || !dispatch.event.runtimeSnapshot) {
      return;
    }

    const runtimeSnapshot = dispatch.event.runtimeSnapshot;
    await this.withUserKeyEnvelopeLock(async () => {
      const { crypto } = await this.ensureRunnerStoresWhileHoldingKeyLock(dispatch.event.userId);
      await createHostedDeviceSyncRuntimeStore({
        bucket: this.bucket,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).mergeSnapshot(runtimeSnapshot);
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
    await this.ensureRunnerStores(userId);
    return { userId };
  }

  async putDeviceSyncRuntimeSnapshot(input: {
    snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
    const userId = await this.requireBoundUserId();

    if (input.snapshot.userId !== userId) {
      throw new TypeError("Hosted device-sync runtime snapshot userId does not match the bound user.");
    }

    const { crypto } = await this.ensureRunnerStores(userId);
    return createHostedDeviceSyncRuntimeStore({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).mergeSnapshot(input.snapshot);
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
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).deleteUsage({
        usageIds: input.usageIds,
        userId,
      });
    });
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureRunnerStores(input.event.userId);
    await this.syncDeviceSyncRuntimeSnapshotFromDispatch(input);
    return this.dispatchBootstrapped(input);
  }

  async dispatchWithOutcome(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchResult> {
    await this.queueStore.bootstrapUser(input.event.userId);
    await this.ensureRunnerStores(input.event.userId);
    await this.syncDeviceSyncRuntimeSnapshotFromDispatch(input);
    const initialState = await this.queueStore.readEventState(input.eventId);
    const status = await this.dispatchBootstrapped(input);
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

  private async dispatchBootstrapped(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionUserStatus> {
    const { commitRecovery, gatewayStore } = await this.ensureRunnerStores(input.event.userId);
    const committed = await commitRecovery.readCommittedDispatch(input.event.userId, input.eventId);
    if (committed) {
      const presence = await this.queueStore.readEventPresence(input.eventId);
      if (
        presence.pending
        || presence.consumed
        || isCommittedResultFresh(committed, COMMITTED_RESULT_FRESH_WINDOW_MS)
      ) {
        if (!isCommittedResultFinalized(committed)) {
          const synced = await commitRecovery.syncCommittedBundlesWithoutConsuming(
            input.event.userId,
            committed,
          );
          await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);

          return toUserStatus(
            await this.advanceRunPhase({
              clearError: true,
              dispatch: input,
              message: "Recovered a durable commit awaiting finalize.",
              phase: "commit.recorded",
              run: this.resolveRunContext(synced, {
                eventId: input.eventId,
                startedAt: committed.committedAt,
              }),
            }),
          );
        }

        await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
        return toUserStatus(
          presence.pending
            ? await this.applyCommittedDispatchAndCleanup(
              input.event.userId,
              committed,
              input,
              input,
            )
            : await this.rememberCommittedEventAndCleanup(input.event.userId, input.eventId, input),
        );
      }

      await commitRecovery.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const enqueueResult = await this.queueStore.enqueueDispatch(input);
    let record = enqueueResult.record;

    if (enqueueResult.accepted) {
      record = await this.scheduler.syncNextWake();
    }

    if (enqueueResult.alreadySeen || record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(record);
    }

    return this.runQueuedEvents(record.userId);
  }

  async alarm(): Promise<void> {
    let record: RunnerStateRecord;
    try {
      record = await this.queueStore.readState();
    } catch {
      return;
    }

    record = await this.queueStore.clearNextWakeIfDue(Date.now());
    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    if (record.activated && !(await this.queueStore.hasDuePendingDispatch(Date.now()))) {
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

    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    await this.runQueuedEvents(record.userId);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.queueStore.readState());
  }

  async getUserEnvStatus(): Promise<HostedExecutionUserEnvStatus> {
    const userId = await this.requireBoundUserId();
    const { userEnv } = await this.ensureRunnerStores(userId);
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await userEnv.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<HostedExecutionUserEnvStatus> {
    return this.withUserKeyEnvelopeLock(async () => {
      const userId = await this.requireBoundUserId();
      const { userEnv } = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
      return this.withUserEnvLock(() => userEnv.updateUserEnv(userId, update));
    });
  }

  async clearUserEnv(): Promise<HostedExecutionUserEnvStatus> {
    return this.updateUserEnv({
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: HostedExecutionBundleRefs;
    };
  }): Promise<HostedExecutionCommittedResult> {
    return this.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      run: async (userId, stores) => {
        return persistHostedExecutionCommit({
          bucket: this.bucket,
          currentBundleRefs: input.payload.currentBundleRefs,
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

  async finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult> {
    return this.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      run: async (userId, stores) => {
        return persistHostedExecutionFinalBundles({
          bucket: this.bucket,
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

  private async runQueuedEvents(userId: string): Promise<HostedExecutionUserStatus> {
    await this.ensureRunnerStores(userId);
    let record = await this.queueStore.readState();
    let processedDispatch = false;
    const recovered = await this.recoverCommittedPendingDispatchAndCleanup(record);
    if (recovered) {
      record = recovered;
      processedDispatch = true;
    }

    while (true) {
      const recoveredPending = await this.recoverCommittedPendingDispatchAndCleanup(record);
      if (recoveredPending) {
        record = recoveredPending;
        continue;
      }

      const claim = await this.queueStore.claimNextDuePendingDispatch(Date.now());
      const nextPending = claim.pendingDispatch;
      record = claim.record;

      if (!nextPending) {
        return toUserStatus(processedDispatch ? record : await this.scheduler.syncNextWake());
      }

      const run = this.createRunContext(record, nextPending);
      record = await this.advanceRunPhase({
        clearError: true,
        dispatch: nextPending.dispatch,
        message: "Hosted dispatch claimed for execution.",
        phase: "claimed",
        run,
      });

      try {
        const committed = await (await this.ensureRunnerStores(record.userId)).commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        if (committed && !isCommittedResultFinalized(committed)) {
          await (await this.ensureRunnerStores(record.userId)).gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
        }
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: committed && !isCommittedResultFinalized(committed)
            ? "Resuming hosted dispatch from a durable commit."
            : "Invoking hosted dispatch runtime.",
          phase: "dispatch.running",
          run,
        });
        const runnerResult = await this.invokeRunner(
          record.userId,
          nextPending.dispatch,
          run,
          committed && !isCommittedResultFinalized(committed)
            ? {
                committedResult: {
                  result: committed.result,
                  sideEffects: committed.sideEffects,
                },
              }
            : null,
        );
        record = await (await this.ensureRunnerStores(record.userId)).commitRecovery.requireCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: "Hosted dispatch recorded a durable commit.",
          phase: "commit.recorded",
          run,
        });
        record = await (await this.ensureRunnerStores(record.userId)).bundleSync.applyRunnerResultBundles(
          record.userId,
          record.bundleVersions,
          runnerResult.bundles,
        );
        record = await this.scheduler.syncNextWake(
          runnerResult.result.nextWakeAt ?? null,
        );
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: "Hosted dispatch completed.",
          phase: "completed",
          run,
        });
        await this.deleteCommittedDispatchBestEffort(record.userId, nextPending.dispatch.eventId);
        await this.deleteTransientDispatchDataBestEffort(nextPending.dispatch);
        processedDispatch = true;
      } catch (error) {
        const committed = await (await this.ensureRunnerStores(record.userId)).commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );

        if (committed) {
          if (isCommittedResultFinalized(committed)) {
            record = await this.applyCommittedDispatchAndCleanup(
              record.userId,
              committed,
              nextPending.dispatch,
              nextPending.dispatch,
              run,
            );
            continue;
          }

          record = await (await this.ensureRunnerStores(record.userId)).commitRecovery.rescheduleCommittedFinalizeRetry({
            attempts: nextPending.attempts + 1,
            committed,
            error,
            retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
          });
          record = await this.advanceRunPhase({
            dispatch: nextPending.dispatch,
            error,
            level: "warn",
            message: "Hosted dispatch scheduled a finalize retry.",
            phase: "retry.scheduled",
            run,
          });
          continue;
        }

        if (error instanceof HostedExecutionConfigurationError) {
          record = await this.queueStore.deferPendingConfigurationFailure({
            error,
            eventId: nextPending.dispatch.eventId,
            retryDelayMs: this.env.retryDelayMs,
          });
          record = await this.scheduler.syncNextWake();
          record = await this.advanceRunPhase({
            dispatch: nextPending.dispatch,
            error,
            level: "warn",
            message: "Hosted dispatch delayed for configuration retry.",
            phase: "retry.scheduled",
            run,
          });
          continue;
        }

        const failure = await this.queueStore.reschedulePendingFailure({
          error,
          eventId: nextPending.dispatch.eventId,
          maxEventAttempts: this.env.maxEventAttempts,
          retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
        });
        record = failure.record;
        record = await this.scheduler.syncNextWake();
        record = await this.advanceRunPhase({
          dispatch: nextPending.dispatch,
          error,
          level: failure.poisoned ? "error" : "warn",
          message: failure.poisoned
            ? "Hosted dispatch was poisoned after exhausting retries."
            : "Hosted dispatch scheduled a retry.",
          phase: failure.poisoned ? "poisoned" : "retry.scheduled",
          run,
        });
        if (failure.poisoned) {
          await this.deleteTransientDispatchDataBestEffort(nextPending.dispatch);
        }
        continue;
      }
    }
  }

  private async invokeRunner(
    userId: string,
    dispatch: HostedExecutionDispatchRequest,
    run: HostedExecutionRunContext,
    resume: {
      committedResult: {
        result: HostedExecutionCommittedResult["result"];
        sideEffects: HostedExecutionCommittedResult["sideEffects"];
      };
    } | null = null,
  ) {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { bundleSync, userEnv: userEnvService } = await this.ensureRunnerStores(userId);
    const [bundleState, userEnv] = await Promise.all([
      this.queueStore.readBundleMetaState(),
      userEnvService.readUserEnv(userId),
    ]);
    const forwardedEnv = buildHostedRunnerContainerEnv(this.runnerRuntimeEnvSource);
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundles: await bundleSync.readBundlesForRunner(),
        commit: {
          bundleRefs: bundleState.bundleRefs,
        },
        dispatch,
        run,
        ...(resume ? { resume } : {}),
      },
      runtime: buildHostedRunnerJobRuntimeConfig({
        forwardedEnv,
        userEnv,
      }),
    };

    return invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerControlToken: crypto.randomUUID(),
      timeoutMs: this.env.runnerTimeoutMs,
      userId,
    });
  }

  private async recoverCommittedPendingDispatchAndCleanup(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord | null> {
    const { commitRecovery, gatewayStore } = await this.ensureRunnerStores(record.userId);
    const recovered = await commitRecovery.recoverCommittedPendingDispatch(record);
    if (!recovered) {
      return null;
    }

    if (recovered.committedEventId) {
      await gatewayStore.applySnapshot(recovered.committed.gatewayProjectionSnapshot ?? null);
      const completedRecord = await this.advanceRunPhase({
        clearError: true,
        dispatch: {
          event: {
            userId: record.userId,
          },
          eventId: recovered.committedEventId,
        },
        message: "Recovered a finalized committed dispatch.",
        phase: "completed",
        run: this.resolveRunContext(recovered.record, {
          eventId: recovered.committedEventId,
          startedAt: recovered.record.lastRunAt ?? new Date().toISOString(),
        }),
      });
      await this.deleteCommittedDispatchBestEffort(record.userId, recovered.committedEventId);
      if (recovered.cleanupDispatch) {
        await this.deleteTransientDispatchDataBestEffort(recovered.cleanupDispatch);
      }
      return completedRecord;
    }

    return recovered.record;
  }

  private async applyCommittedDispatchAndCleanup(
    userId: string,
    committed: HostedExecutionCommittedResult,
    dispatch: HostedExecutionDispatchProgressRecord,
    cleanupDispatch: HostedExecutionDispatchRequest | null = null,
    run: HostedExecutionRunContext | null = null,
  ): Promise<RunnerStateRecord> {
    const { commitRecovery, gatewayStore } = await this.ensureRunnerStores(userId);
    await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
    let record = await commitRecovery.applyCommittedDispatch(userId, committed);
    record = await this.advanceRunPhase({
      clearError: true,
      dispatch,
      message: "Hosted dispatch completed from a committed result.",
      phase: "completed",
      run: run ?? this.resolveRunContext(record, {
        eventId: committed.eventId,
        startedAt: committed.committedAt,
      }),
    });
    await this.deleteCommittedDispatchBestEffort(userId, committed.eventId);
    if (cleanupDispatch) {
      await this.deleteTransientDispatchDataBestEffort(cleanupDispatch);
    }
    return record;
  }

  private createRunContext(
    record: RunnerStateRecord,
    pending: PendingDispatchRecord,
  ): HostedExecutionRunContext {
    const priorAttempt = record.run?.eventId === pending.eventId
      ? record.run.attempt
      : 0;

    return {
      attempt: Math.max(pending.attempts + 1, priorAttempt + 1),
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
  }

  private resolveRunContext(
    record: RunnerStateRecord,
    input: {
      attempt?: number;
      eventId: string;
      startedAt: string;
    },
  ): HostedExecutionRunContext {
    if (record.run && record.run.eventId === input.eventId) {
      return {
        attempt: record.run.attempt,
        runId: record.run.runId,
        startedAt: record.run.startedAt,
      };
    }

    return {
      attempt: input.attempt ?? 1,
      runId: crypto.randomUUID(),
      startedAt: input.startedAt,
    };
  }

  private async advanceRunPhase(input: {
    clearError?: boolean;
    dispatch: HostedExecutionDispatchProgressRecord;
    error?: unknown;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    run: HostedExecutionRunContext;
  }): Promise<RunnerStateRecord> {
    const record = await this.queueStore.recordRunPhase({
      attempt: input.run.attempt,
      clearError: input.clearError,
      component: "runner",
      error: input.error,
      eventId: input.dispatch.eventId,
      level: input.level,
      message: input.message,
      phase: input.phase,
      runId: input.run.runId,
      startedAt: input.run.startedAt,
    });

    emitHostedExecutionStructuredLog({
      component: "runner",
      dispatch: input.dispatch,
      error: input.error,
      level: input.level,
      message: input.message,
      phase: input.phase,
      run: input.run,
    });

    return record;
  }

  private async rememberCommittedEventAndCleanup(
    userId: string,
    eventId: string,
    dispatch: HostedExecutionDispatchRequest | null = null,
  ): Promise<RunnerStateRecord> {
    const record = await this.queueStore.rememberCommittedEvent(eventId);
    await this.deleteCommittedDispatchBestEffort(userId, eventId);
    if (dispatch) {
      await this.deleteTransientDispatchDataBestEffort(dispatch);
    }
    return record;
  }

  private async deleteCommittedDispatchBestEffort(userId: string, eventId: string): Promise<void> {
    try {
      await (await this.ensureRunnerStores(userId)).commitRecovery.deleteCommittedDispatch(userId, eventId);
    } catch {
      // Leaving the transient journal behind is preferable to failing a successful hosted run.
    }
  }

  private async deleteTransientDispatchDataBestEffort(
    dispatch: Pick<HostedExecutionDispatchRequest, "event">,
  ): Promise<void> {
    if (dispatch.event.kind !== "email.message.received") {
      return;
    }

    try {
      const { crypto } = await this.ensureRunnerStores(dispatch.event.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: dispatch.event.rawMessageKey,
        userId: dispatch.event.userId,
      });
    } catch {
      // Best-effort cleanup only; lifecycle TTL still backstops raw message deletion.
    }
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
