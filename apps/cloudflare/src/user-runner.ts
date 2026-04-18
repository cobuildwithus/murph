import type {
  HostedExecutionCursorState,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchStatus,
  HostedExecutionDispatchRequest,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionAssistantCronTickDispatch,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import { isHostedMessageWakeDispatch } from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionBundleRef,
  parseHostedWakeDispatchPayload,
} from "@murphai/hosted-execution/parsers";
import {
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state";

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
  readHostedWakeStatusFromWeb,
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
const HOSTED_WAKE_BACKPRESSURE_RETRY_DELAY_MS = 250;
const MAX_HOSTED_WAKE_DRAIN_ROUNDS = 32;
const HOSTED_WAKE_QUARANTINE_INVALID_DISPATCH = "invalid-dispatch-payload";
const HOSTED_WAKE_QUARANTINE_USER_MISMATCH = "dispatch-user-mismatch";

interface HostedWakeDrainOutcome {
  dispatch: HostedExecutionDispatchRequest | null;
  seq: bigint;
  state: HostedWakeDrainState;
}

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
      hostedWebBaseUrl: this.env.hostedWebBaseUrl,
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
    if (!record.runtimeBootstrapped) {
      return;
    }

    if (!record.userId) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        level: "warn",
        message: "Hosted cron wake append skipped because the user runner is not bound yet.",
        phase: "dispatch.running",
        userId: record.userId ?? null,
      });
      await this.scheduler.syncNextWake(
        new Date(Date.now() + HOSTED_WAKE_CRON_APPEND_RETRY_DELAY_MS).toISOString(),
      );
      return;
    }

    try {
      const dispatch = buildHostedExecutionAssistantCronTickDispatch({
        eventId: `alarm:${Date.now()}`,
        occurredAt: new Date().toISOString(),
        reason: "alarm",
        userId: record.userId,
      });
      const append = await appendHostedWakeDispatchInWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        boundUserId: record.userId,
        callbackSigning: this.env.webCallbackSigning,
        dispatch,
        timeoutMs: this.env.runnerTimeoutMs,
      });
      await this.wakeHostedWakes({
        targetSeqHint: append.wake.seq,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        error,
        level: "warn",
        message: "Hosted cron wake append failed; scheduling a retry.",
        phase: "dispatch.running",
        userId: record.userId,
      });
      await this.scheduler.syncNextWake(
        new Date(Date.now() + HOSTED_WAKE_CRON_APPEND_RETRY_DELAY_MS).toISOString(),
      );
    }
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.composeUserStatus(await this.queueStore.readState());
  }

  async dispatch(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionUserStatus> {
    await this.ensureManagedUserCryptoForActivationIfNeeded(input);
    await this.queueStore.bootstrapUser(input.event.userId);
    const append = await appendHostedWakeDispatchInWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: input.event.userId,
      callbackSigning: this.env.webCallbackSigning,
      dispatch: input,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    return this.wakeHostedWakes({
      targetSeqHint: append.wake.seq,
    });
  }

  async dispatchWithOutcome(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchResult> {
    const status = await this.dispatch(input);
    const event = await this.readHostedDispatchStatus(input, status)
      ?? await this.queueStore.readEventDispatchStatus(input.eventId)
      ?? buildLegacyDispatchStatus(input);

    return {
      event,
      status,
    };
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
    await this.queueStore.bootstrapUser(userId);
    const targetSeqHint = parseOptionalHostedWakeSeq(input.targetSeqHint);
    let afterSeq: string | null = null;
    let expectedVersion: string | null = null;

    for (let round = 0; round < MAX_HOSTED_WAKE_DRAIN_ROUNDS; round += 1) {
      const batch = await fetchHostedWakeBatchFromWeb({
        afterSeq,
        baseUrl: this.readHostedWebControlBaseUrl(),
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        limit: DEFAULT_HOSTED_WAKE_BATCH_LIMIT,
        timeoutMs: this.env.runnerTimeoutMs,
      });
      afterSeq = batch.cursor.committedSeq;
      expectedVersion = batch.cursor.version;
      await this.syncHostedWakeBundleCacheToCursor(batch.cursor.snapshotRef);

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
      const advancedWakes: HostedWakeDrainOutcome[] = [];
      let stoppingState: HostedWakeDrainState | null = null;

      for (const wake of batch.wakes) {
        const outcome = await this.dispatchHostedWakeRecord(wake);

        if (shouldAdvanceHostedWakeCursor(outcome.state)) {
          highestCommittedWakeSeq = wake.seq;
          advancedWakeCount += 1;
          advancedWakes.push(outcome);
        }

        if (!shouldAdvanceHostedWakeCursor(outcome.state)) {
          stoppingState = outcome.state;
          break;
        }
      }

      if (!highestCommittedWakeSeq || !expectedVersion) {
        if (stoppingState === "backpressured") {
          await sleep(HOSTED_WAKE_BACKPRESSURE_RETRY_DELAY_MS);
          continue;
        }

        break;
      }

      const bundleState = await this.queueStore.readBundleMetaState();
      const commit = await commitHostedWakeCursorToWeb({
        baseUrl: this.env.hostedWebBaseUrl,
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
      await this.syncHostedWakeBundleCacheToCursor(commit.cursor.snapshotRef);
      if (commit.committed) {
        await this.finalizeCommittedHostedWakesLocally({
          committedCursor: commit.cursor,
          dispatches: advancedWakes,
        });
      }

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
        if (
          stoppingState === "poisoned"
          || (stoppingState === "backpressured" && advancedWakeCount > 0)
        ) {
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

    return this.composeUserStatus(await this.queueStore.readState());
  }

  private async dispatchHostedWakeRecord(wake: {
    id: string;
    kind: string;
    occurredAt: string;
    quarantineCode?: string | null;
    quarantinedAt?: string | null;
    payloadSchema: string;
    payloadJson?: unknown;
    seq: string;
  }): Promise<HostedWakeDrainOutcome> {
    const userId = await this.requireBoundUserId();
    const seq = BigInt(wake.seq);

    if (wake.quarantinedAt) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        details: {
          quarantineCode: wake.quarantineCode ?? null,
        },
        level: "info",
        message: `Hosted wake seq ${wake.seq} is already quarantined; advancing the cursor past the terminal row.`,
        phase: "dispatch.running",
        userId,
      });
      return {
        dispatch: null,
        seq,
        state: "quarantined",
      };
    }

    let dispatch: HostedExecutionDispatchRequest;

    try {
      dispatch = parseHostedWakeDispatchPayload({
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        payloadJson: wake.payloadJson,
        payloadSchema: wake.payloadSchema,
        userId,
      });
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
        ? { dispatch: null, seq, state: "quarantined" }
        : { dispatch: null, seq, state: "backpressured" };
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
        ? { dispatch: null, seq, state: "quarantined" }
        : { dispatch: null, seq, state: "backpressured" };
    }

    await this.ensureManagedUserCryptoForActivationIfNeeded(dispatch);
    const state = isHostedMessageWakeDispatch(dispatch)
      ? await this.dispatchHostedMessageWake(dispatch)
      : await this.dispatchHostedSystemWake(dispatch);

    return {
      dispatch,
      seq,
      state,
    };
  }

  private async quarantineHostedWakeRecord(
    userId: string,
    wakeId: string,
    quarantineCode: string,
  ): Promise<boolean> {
    try {
      const response = await quarantineHostedWakeInWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
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

  private async dispatchHostedMessageWake(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedWakeDrainState> {
    return this.dispatchProcessor.executeNativeWakeDispatch(dispatch);
  }

  private async dispatchHostedSystemWake(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedWakeDrainState> {
    return this.dispatchProcessor.executeNativeWakeDispatch(dispatch);
  }

  private async finalizeCommittedHostedWakesLocally(input: {
    committedCursor: HostedExecutionCursorState;
    dispatches: readonly HostedWakeDrainOutcome[];
  }): Promise<void> {
    const committedThroughSeq = BigInt(input.committedCursor.committedSeq);
    const committedOutcomes = input.dispatches.filter((outcome) =>
      outcome.dispatch && outcome.seq <= committedThroughSeq
    );

    if (committedOutcomes.length === 0) {
      return;
    }

    const finalOutcome = committedOutcomes[committedOutcomes.length - 1]!;
    let finalCommittedResult: Awaited<
      ReturnType<typeof this.dispatchProcessor.finalizeNativeWakeDispatchAfterCursorCommit>
    > = null;

    for (const outcome of committedOutcomes) {
      try {
        const finalizedCommit = await this.dispatchProcessor.finalizeNativeWakeDispatchAfterCursorCommit({
          dispatch: outcome.dispatch!,
        });

        if (outcome === finalOutcome) {
          finalCommittedResult = finalizedCommit;
          continue;
        }

        await this.dispatchProcessor.cleanupNativeWakeDispatchAfterCursorCommit({
          dispatch: outcome.dispatch!,
        });
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "hosted.user-runner",
          dispatch: outcome.dispatch!,
          error,
          level: "warn",
          message: "Hosted wake finalization failed after the cursor had already advanced.",
          phase: "completed",
          userId: outcome.dispatch!.event.userId,
        });
      }
    }

    try {
      if (!finalCommittedResult) {
        await this.dispatchProcessor.cleanupNativeWakeDispatchAfterCursorCommit({
          dispatch: finalOutcome.dispatch!,
        });
        return;
      }

      const cursorSnapshotRef = parseHostedExecutionBundleRef(
        input.committedCursor.snapshotRef,
        "Hosted wake committed cursor snapshotRef",
      );

      if (!sameHostedBundlePayloadRef(finalCommittedResult.bundleRef, cursorSnapshotRef)) {
        const snapshotCommit = await commitHostedWakeCursorToWeb({
          baseUrl: this.readHostedWebControlBaseUrl(),
          body: {
            committedSeq: input.committedCursor.committedSeq,
            expectedVersion: input.committedCursor.version,
            snapshotRef: finalCommittedResult.bundleRef ?? null,
          },
          boundUserId: finalOutcome.dispatch!.event.userId,
          callbackSigning: this.env.webCallbackSigning,
          timeoutMs: this.env.runnerTimeoutMs,
        });

        await this.syncHostedWakeBundleCacheToCursor(snapshotCommit.cursor.snapshotRef);

        if (
          !snapshotCommit.committed
          && !sameHostedBundlePayloadRef(
            finalCommittedResult.bundleRef,
            parseHostedExecutionBundleRef(
              snapshotCommit.cursor.snapshotRef,
              "Hosted wake finalized cursor snapshotRef",
            ),
          )
        ) {
          throw new Error("Hosted wake finalized snapshot lost the cursor compare-and-swap race.");
        }
      }

      await this.dispatchProcessor.cleanupNativeWakeDispatchAfterCursorCommit({
        dispatch: finalOutcome.dispatch!,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        dispatch: finalOutcome.dispatch!,
        error,
        level: "warn",
        message: "Hosted wake finalization failed after the cursor had already advanced.",
        phase: "completed",
        userId: finalOutcome.dispatch!.event.userId,
      });
    }
  }

  private async syncHostedWakeBundleCacheToCursor(
    snapshotRef: unknown,
  ): Promise<void> {
    const nextBundleRef = parseHostedExecutionBundleRef(
      snapshotRef === undefined ? null : snapshotRef,
      "Hosted wake cursor snapshotRef",
    );
    await this.queueStore.syncBundleRefCache(nextBundleRef);
  }

  private async composeUserStatus(record: RunnerStateRecord): Promise<HostedExecutionUserStatus> {
    const baseStatus = toUserStatus(record);

    try {
      const wakeStatus = await readHostedWakeStatusFromWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        boundUserId: record.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      return {
        ...baseStatus,
        pendingEventCount: wakeStatus.pendingWakeCount,
        retryingEventId: wakeStatus.pendingWakeCount > 0
          ? (baseStatus.run?.eventId ?? baseStatus.retryingEventId ?? baseStatus.lastEventId)
          : null,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        error,
        level: "warn",
        message: "Hosted wake status read failed; returning local shim status only.",
        phase: "dispatch.running",
        userId: record.userId,
      });
      return baseStatus;
    }
  }

  private async readHostedDispatchStatus(
    dispatch: HostedExecutionDispatchRequest,
    status: HostedExecutionUserStatus,
  ): Promise<HostedExecutionDispatchStatus | null> {
    try {
      const wakeStatus = await readHostedWakeStatusFromWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          eventId: dispatch.eventId,
        },
        boundUserId: dispatch.event.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      return {
        eventId: dispatch.eventId,
        lastError: wakeStatus.dispatchState === "poisoned" ? status.lastError : null,
        state: wakeStatus.dispatchState ?? "queued",
        userId: dispatch.event.userId,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.user-runner",
        dispatch,
        error,
        level: "warn",
        message: "Hosted wake dispatch status read failed; falling back to local shim status.",
        phase: "dispatch.running",
        userId: dispatch.event.userId,
      });
      return null;
    }
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

  private readHostedWebControlBaseUrl(): string {
    return this.env.hostedWebBaseUrl;
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

function buildLegacyDispatchStatus(
  input: HostedExecutionDispatchRequest,
): HostedExecutionDispatchStatus {
  return {
    eventId: input.eventId,
    lastError: null,
    state: "queued",
    userId: input.event.userId,
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
