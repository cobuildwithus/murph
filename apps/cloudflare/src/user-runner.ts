import type {
  HostedExecutionBundleRef,
  HostedExecutionCursorState,
  HostedExecutionWakeDrainResult,
  HostedExecutionWake,
  HostedExecutionUserStatus,
  HostedWakeMaterializationHints,
} from "@murphai/hosted-execution";
import type {
  HostedFetchedWakeRecord,
  HostedWakeRecord,
} from "@murphai/hosted-execution/contracts";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionCursorSnapshotRef,
  parseHostedWakeExecutionPayload,
} from "@murphai/hosted-execution/parsers";
import type { R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { HostedGatewayProjectionCache } from "./gateway-projection-cache.js";
import { toStringEnvSource } from "./string-env.js";
import {
  createHostedUserKeyStore,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  decryptHostedWakePayloadCiphertext,
} from "./hosted-wake-encryption.ts";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import {
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
  materializeHostedDueWakesInWeb,
  quarantineHostedWakeInWeb,
  readHostedWakeStatusFromWeb,
  recordHostedWakeTerminalInWeb,
} from "./web-control-plane.ts";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import {
  RunnerWakeProcessor,
  HostedExecutionObsoleteRunResultError,
  type RunnerUserStores,
} from "./user-runner/runner-wake-processor.js";
import type { RunnerLeaseOwnerInput } from "./user-runner/runner-state-store.js";
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import { RunnerStateStore } from "./user-runner/runner-state-store.js";
import { RunnerWakeScheduler } from "./user-runner/runner-wake-scheduler.js";
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
const HOSTED_WAKE_NUDGE_RETRY_DELAY_MS = 5_000;
const MAX_HOSTED_WAKE_DRAIN_ROUNDS = 32;
const HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD = "invalid-wake-payload";
const HOSTED_WAKE_QUARANTINE_USER_MISMATCH = "wake-user-mismatch";

interface HostedWakeDrainOutcome {
  cursorSnapshotRef: HostedExecutionBundleRef | null;
  postCursorAction: "cleanup-only" | "finalize-after-commit";
  wake: HostedExecutionWake | null;
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
  private readonly wakeProcessor: RunnerWakeProcessor;
  private readonly eventTransitionLocks = new Map<string, Promise<void>>();
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly wakeScheduler: RunnerWakeScheduler;
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
    this.stateStore = new RunnerStateStore(state);
    this.wakeScheduler = new RunnerWakeScheduler(this.stateStore, state);
    this.wakeProcessor = new RunnerWakeProcessor({
      applyHostedTransition: <T>(input: {
        eventId: string;
        gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
        leaseOwner?: RunnerLeaseOwnerInput;
        run: (userId: string, stores: RunnerUserStores) => Promise<T>;
      }) => this.applyHostedTransition(input),
      bucket: this.bucket,
      ensureRunnerStores: (userId?: string) => this.ensureRunnerStores(userId),
      env: this.env,
      hostedWebBaseUrl: this.env.hostedWebBaseUrl,
      stateStore: this.stateStore,
      readRunnerRuntimeConfigSource: () => this.readRunnerRuntimeConfigSource(),
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.runnerRuntimeEnvSource,
      wakeScheduler: this.wakeScheduler,
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
      reason: "runner-store-refresh",
    });

    const stores: RunnerUserStores = {
      bundleSync: new RunnerBundleSync(
        this.bucket,
        crypto.rootKey,
        crypto.rootKeyId,
        crypto.keysById,
        this.stateStore,
      ),
      crypto,
      gatewayCache: new HostedGatewayProjectionCache(),
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };

    this.runnerStores = stores;
    return stores;
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    await this.stateStore.bootstrapUser(userId);
    return { userId };
  }

  private async ensureManagedUserCryptoForActivationWakeIfNeeded(
    wake: HostedExecutionWake,
  ): Promise<void> {
    if (wake.kind !== "member.activated") {
      return;
    }

    await this.provisionManagedUserCryptoAtActivation(wake.userId, "member-activation-wake");
  }

  async alarm(): Promise<void> {
    let record: RunnerStateRecord;
    try {
      record = await this.stateStore.readState();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted wake nudge could not read runner state; scheduling a retry.",
        phase: "wake.running",
        userId: null,
      });
      await this.wakeScheduler.syncNextWake({
        preferredWakeAt: new Date(Date.now() + HOSTED_WAKE_NUDGE_RETRY_DELAY_MS).toISOString(),
      });
      return;
    }

    record = await this.stateStore.clearNextWakeIfDue(Date.now());
    if (!record.runtimeBootstrapped) {
      return;
    }

    if (!record.userId) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        level: "warn",
        message: "Hosted wake nudge skipped because the runner is not bound yet.",
        phase: "wake.running",
        userId: record.userId ?? null,
      });
      await this.wakeScheduler.syncNextWake({
        preferredWakeAt: new Date(Date.now() + HOSTED_WAKE_NUDGE_RETRY_DELAY_MS).toISOString(),
      });
      return;
    }

    try {
      const materialization = await this.materializeDueHostedWakesInWeb(record.userId);
      await this.wakeScheduler.syncNextWake({
        preferredWakeAt: null,
        wakeMaterializationHints: materialization.wakeMaterializationHints,
      });
      await this.wakeHostedWakes({
        targetSeqHint: materialization.targetSeqHint,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted wake nudge failed; scheduling a retry.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.wakeScheduler.syncNextWake({
        preferredWakeAt: new Date(Date.now() + HOSTED_WAKE_NUDGE_RETRY_DELAY_MS).toISOString(),
      });
    }
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.composeUserStatus(await this.stateStore.readState());
  }

  async wakeHostedWakes(input: {
    targetSeqHint?: string | null;
  } = {}): Promise<HostedExecutionWakeDrainResult> {
    return this.withWakeDrainLock(async () => this.wakeHostedWakesInternal(input));
  }

  private async materializeDueHostedWakesInWeb(
    userId: string,
  ): Promise<{
    targetSeqHint: string | null;
    wakeMaterializationHints: HostedWakeMaterializationHints | null;
  }> {
    const wakeMaterializationHints = await this.stateStore.readWakeMaterializationHints();

    if (!hostedWakeMaterializationDueNow(wakeMaterializationHints)) {
      return {
        targetSeqHint: null,
        wakeMaterializationHints,
      };
    }

    return materializeHostedDueWakesInWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      body: {
        wakeMaterializationHints,
      },
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });
  }

  private async wakeHostedWakesInternal(input: {
    targetSeqHint?: string | null;
  }): Promise<HostedExecutionWakeDrainResult> {
    const userId = await this.requireBoundUserId();
    await this.stateStore.bootstrapUser(userId);
    const targetSeqHint = parseOptionalHostedWakeSeq(input.targetSeqHint);
    const requestedTargetSeq = targetSeqHint?.toString() ?? null;
    await this.resumePendingCommittedCleanupIfNeeded();
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
            component: "hosted.runner",
            level: "info",
            message: "Hosted wake drain saw no unseen rows before the target sequence hint.",
            phase: "wake.running",
            userId,
          });
        }

        break;
      }

      let stoppingState: HostedWakeDrainState | null = null;

      for (const wake of batch.wakes) {
        const outcome = await this.executeHostedWakeRecord(wake);

        if (!shouldAdvanceHostedWakeCursor(outcome.state)) {
          stoppingState = outcome.state;
          break;
        }

        if (!expectedVersion) {
          stoppingState = outcome.state;
          break;
        }

        if (outcome.state === "completed" || outcome.state === "replaced") {
          try {
            const terminal = await recordHostedWakeTerminalInWeb({
              baseUrl: this.env.hostedWebBaseUrl,
              body: {
                fetchProof: wake.fetchProof,
                state: outcome.state,
                wakeId: wake.id,
                wakeSeq: wake.seq,
              },
              boundUserId: userId,
              callbackSigning: this.env.webCallbackSigning,
              timeoutMs: this.env.runnerTimeoutMs,
            });

            if (!terminal.recorded) {
              stoppingState = "backpressured";
              break;
            }
          } catch (error) {
            emitHostedExecutionStructuredLog({
              component: "hosted.runner",
              error,
              eventId: outcome.wake?.eventId ?? wake.id,
              level: "warn",
              message: "Hosted wake terminal receipt record failed; refusing to advance the web cursor.",
              phase: "wake.running",
              userId,
            });
            stoppingState = "backpressured";
            break;
          }
        }

        const commit = await commitHostedWakeCursorToWeb({
          baseUrl: this.env.hostedWebBaseUrl,
          body: {
            committedSeq: wake.seq,
            expectedVersion,
            snapshotRef: outcome.cursorSnapshotRef,
          },
          boundUserId: userId,
          callbackSigning: this.env.webCallbackSigning,
          timeoutMs: this.env.runnerTimeoutMs,
        });

        let cursor = commit.cursor;
        await this.syncHostedWakeBundleCacheToCursor(cursor.snapshotRef);
        if (commit.committed) {
          if (outcome.postCursorAction === "finalize-after-commit") {
            const finalized = await this.finalizeCommittedHostedWakeIfNeeded({
              cursor,
              wake: outcome.wake,
            });
            cursor = finalized.cursor;
            if (finalized.state !== "completed") {
              afterSeq = cursor.committedSeq;
              expectedVersion = cursor.version;
              stoppingState = finalized.state;
              break;
            }
          }
          cursor = await this.cleanupCommittedHostedWakesLocally({
            cursor,
            wake: outcome.wake,
          });
        } else {
          if (outcome.wake) {
            await this.wakeProcessor.discardWakeAfterLostCursorRace({
              wake: outcome.wake,
            });
          }
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            level: "info",
            message: "Hosted wake cursor commit lost a compare-and-swap race; refetching cursor state.",
            phase: "wake.running",
            userId,
          });
          afterSeq = cursor.committedSeq;
          expectedVersion = cursor.version;
          stoppingState = "backpressured";
          break;
        }

        afterSeq = cursor.committedSeq;
        expectedVersion = cursor.version;
      }

      if (stoppingState) {
        if (stoppingState === "poisoned") {
          continue;
        }

        break;
      }

      if (
        batch.wakes.length < DEFAULT_HOSTED_WAKE_BATCH_LIMIT
        && afterSeq
        && (!targetSeqHint || BigInt(afterSeq) >= targetSeqHint)
      ) {
        break;
      }
    }

    const committedSeq = afterSeq ?? await this.readCommittedWakeSeqFromWeb(userId);

    return {
      committedSeq,
      requestedTargetSeq,
      targetReached: targetSeqHint === null || BigInt(committedSeq) >= targetSeqHint,
    };
  }

  private async executeHostedWakeRecord(
    wake: HostedFetchedWakeRecord,
  ): Promise<HostedWakeDrainOutcome> {
    const userId = await this.requireBoundUserId();
    const seq = BigInt(wake.seq);

    if (wake.quarantinedAt) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          quarantineCode: wake.quarantineCode ?? null,
        },
        level: "info",
        message: `Hosted wake seq ${wake.seq} is already quarantined; advancing the cursor past the terminal row.`,
        phase: "wake.running",
        userId,
      });
      return {
        cursorSnapshotRef: await this.readCurrentHostedWakeCursorSnapshotRef(),
        postCursorAction: "cleanup-only",
        wake: null,
        seq,
        state: "quarantined",
      };
    }

    let hostedWake: HostedExecutionWake;

    try {
      const decryptedPayload = await this.decryptHostedWakeExecutionPayload(
        wake,
        userId,
      );
      hostedWake = parseHostedWakeExecutionPayload({
        decryptedPayload,
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        payloadSchema: wake.payloadSchema,
        userId,
      });
    } catch {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        level: "warn",
        message: `Hosted wake seq ${wake.seq} has an invalid wake payload and cannot be executed.`,
        phase: "wake.running",
        userId,
      });
      return await this.quarantineHostedWakeRecord(
        userId,
        wake.fetchProof,
        wake.id,
        HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD,
        wake.seq,
      )
        ? {
          cursorSnapshotRef: await this.readCurrentHostedWakeCursorSnapshotRef(),
          postCursorAction: "cleanup-only",
          wake: null,
          seq,
          state: "quarantined",
        }
        : {
          cursorSnapshotRef: await this.readCurrentHostedWakeCursorSnapshotRef(),
          postCursorAction: "cleanup-only",
          wake: null,
          seq,
          state: "backpressured",
        };
    }

    if (hostedWake.userId !== userId) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        level: "warn",
        message: `Hosted wake seq ${wake.seq} is bound to ${hostedWake.userId}, not ${userId}.`,
        phase: "wake.running",
        userId,
      });
      return await this.quarantineHostedWakeRecord(
        userId,
        wake.fetchProof,
        wake.id,
        HOSTED_WAKE_QUARANTINE_USER_MISMATCH,
        wake.seq,
      )
        ? {
          cursorSnapshotRef: await this.readCurrentHostedWakeCursorSnapshotRef(),
          postCursorAction: "cleanup-only",
          wake: null,
          seq,
          state: "quarantined",
        }
        : {
          cursorSnapshotRef: await this.readCurrentHostedWakeCursorSnapshotRef(),
          postCursorAction: "cleanup-only",
          wake: null,
          seq,
          state: "backpressured",
        };
    }

    await this.ensureManagedUserCryptoForActivationWakeIfNeeded(hostedWake);
    const payloadCiphertext = wake.payloadCiphertext;
    if (typeof payloadCiphertext !== "string" || payloadCiphertext.length === 0) {
      throw new TypeError("Hosted wake payload ciphertext is required.");
    }
    const execution = await this.wakeProcessor.executeWake(hostedWake, {
      holdLeaseUntilCleanup: true,
      wakeRecord: {
        eventId: hostedWake.eventId,
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        payloadCiphertext,
        payloadSchema: wake.payloadSchema,
        seq: wake.seq,
        userId,
      },
    });

    return {
      cursorSnapshotRef: execution.cursorSnapshotRef,
      postCursorAction: execution.postCursorAction,
      wake: hostedWake,
      seq,
      state: execution.state,
    };
  }

  private async decryptHostedWakeExecutionPayload(
    wake: HostedWakeRecord,
    userId: string,
  ): Promise<unknown> {
    const payloadCiphertext = wake.payloadCiphertext;

    if (typeof payloadCiphertext !== "string" || payloadCiphertext.length === 0) {
      throw new TypeError("Hosted wake payload ciphertext is required.");
    }

    return await decryptHostedWakePayloadCiphertext({
      ciphertext: payloadCiphertext,
      environment: this.env.hostedWakeEncryption,
      userId,
    });
  }

  private async quarantineHostedWakeRecord(
    userId: string,
    fetchProof: string,
    wakeId: string,
    quarantineCode: string,
    wakeSeq: string,
  ): Promise<boolean> {
    try {
      const response = await quarantineHostedWakeInWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        fetchProof,
        quarantineCode,
        timeoutMs: this.env.runnerTimeoutMs,
        wakeId,
        wakeSeq,
      });

      return response.quarantined;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: `Failed to quarantine hosted wake ${wakeId}.`,
        phase: "wake.running",
        userId,
      });
      return false;
    }
  }

  private async cleanupCommittedHostedWakesLocally<
    TCursor extends HostedExecutionCursorState,
  >(input: {
    cursor: TCursor;
    wake: HostedExecutionWake | null;
  }): Promise<TCursor> {
    try {
      return await this.wakeProcessor.cleanupWakeAfterCursorCommit({
        cursor: input.cursor,
        wake: input.wake,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        eventId: input.wake?.eventId ?? "pending-commit-cleanup",
        level: "warn",
        message: "Hosted wake cleanup failed after the cursor had already advanced.",
        phase: "completed",
        userId: input.wake?.userId ?? (await this.requireBoundUserId()),
      });
      return input.cursor;
    }
  }

  private async finalizeCommittedHostedWakeIfNeeded<
    TCursor extends HostedExecutionCursorState,
  >(input: {
    cursor: TCursor;
    wake: HostedExecutionWake | null;
  }): Promise<{
    cursor: TCursor;
    state: HostedWakeDrainState;
  }> {
    const finalized = await this.wakeProcessor.finalizePendingCommitAfterCursorCommit({
      wake: input.wake,
    });

    if (finalized.state !== "completed") {
      return {
        cursor: input.cursor,
        state: finalized.state,
      };
    }

    const pendingCommit = finalized.pendingCommit;
    if (!pendingCommit) {
      return {
        cursor: input.cursor,
        state: "completed",
      };
    }

    if (BigInt(input.cursor.committedSeq) !== BigInt(pendingCommit.wake.seq)) {
      return {
        cursor: input.cursor,
        state: "completed",
      };
    }

    if (sameHostedWakeCursorSnapshotRef(input.cursor.snapshotRef, pendingCommit.bundleRef)) {
      return {
        cursor: input.cursor,
        state: "completed",
      };
    }

    const published = await commitHostedWakeCursorToWeb({
      baseUrl: this.env.hostedWebBaseUrl,
      body: {
        committedSeq: input.cursor.committedSeq,
        expectedVersion: input.cursor.version,
        snapshotRef: pendingCommit.bundleRef,
      },
      boundUserId: pendingCommit.userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    await this.syncHostedWakeBundleCacheToCursor(published.cursor.snapshotRef);
    if (
      published.committed
      || sameHostedWakeCursorSnapshotRef(published.cursor.snapshotRef, pendingCommit.bundleRef)
    ) {
      return {
        cursor: published.cursor as TCursor,
        state: "completed",
      };
    }

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      eventId: pendingCommit.eventId,
      level: "info",
      message:
        "Hosted wake finalized snapshot publish lost a compare-and-swap race; deferring cleanup until the published cursor catches up.",
      phase: "completed",
      userId: pendingCommit.userId,
    });
    return {
      cursor: published.cursor as TCursor,
      state: "backpressured",
    };
  }

  private async resumePendingCommittedCleanupIfNeeded(): Promise<void> {
    const pendingCommit = await this.stateStore.readPendingCommit();
    if (!pendingCommit) {
      return;
    }

    const status = await readHostedWakeStatusFromWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: pendingCommit.userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    if (BigInt(status.cursor.committedSeq) < BigInt(pendingCommit.wake.seq)) {
      await this.syncHostedWakeBundleCacheToCursor(status.cursor.snapshotRef);
      return;
    }

    let cursor = status.cursor;
    const finalized = await this.finalizeCommittedHostedWakeIfNeeded({
      cursor,
      wake: null,
    });
    cursor = finalized.cursor;
    if (finalized.state !== "completed") {
      await this.syncHostedWakeBundleCacheToCursor(cursor.snapshotRef);
      return;
    }
    cursor = await this.cleanupCommittedHostedWakesLocally({
      cursor,
      wake: null,
    });
    await this.syncHostedWakeBundleCacheToCursor(cursor.snapshotRef);
  }

  private async syncHostedWakeBundleCacheToCursor(
    snapshotRef: HostedExecutionCursorState["snapshotRef"] | undefined,
  ): Promise<void> {
    const nextBundleRef = parseHostedExecutionCursorSnapshotRef(
      snapshotRef,
      "Hosted wake cursor snapshotRef",
    );
    await this.stateStore.syncBundleRefCache(nextBundleRef);
  }

  private async readCurrentHostedWakeCursorSnapshotRef(): Promise<HostedExecutionBundleRef | null> {
    const bundleState = await this.stateStore.readBundleMetaState();
    return bundleState.bundleRef ?? null;
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
        pendingWakeCount: wakeStatus.pendingWakeCount > 0
          ? wakeStatus.pendingWakeCount
          : baseStatus.pendingWakeCount,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted wake status read failed; returning local runner status only.",
        phase: "wake.running",
        userId: record.userId,
      });
      return baseStatus;
    }
  }

  private async readCommittedWakeSeqFromWeb(userId: string): Promise<string> {
    const wakeStatus = await readHostedWakeStatusFromWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    return wakeStatus.cursor.committedSeq;
  }

  private async applyHostedTransition<T>(input: {
    eventId: string;
    gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
    leaseOwner?: RunnerLeaseOwnerInput;
    run: (userId: string, stores: RunnerUserStores) => Promise<T>;
  }): Promise<T> {
    return this.withEventTransitionLock(input.eventId, async () => {
      if (input.leaseOwner && !(await this.stateStore.hasActiveRunLease(input.leaseOwner))) {
        throw new HostedExecutionObsoleteRunResultError(
          input.eventId,
          input.leaseOwner.run?.runId ?? null,
        );
      }

      return this.withUserKeyEnvelopeLock(async () => {
        const userId = await this.requireBoundUserId();
        const stores = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
        const result = await input.run(userId, stores);
        await stores.gatewayCache.applySnapshot(input.gatewayProjectionSnapshot ?? null);
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
    return (await this.stateStore.readState()).userId;
  }

  private async tryReadBoundUserId(): Promise<string | null> {
    if (this.runnerStores?.userId) {
      return this.runnerStores.userId;
    }

    try {
      return (await this.stateStore.readState()).userId;
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

function sameHostedWakeCursorSnapshotRef(
  snapshotRef: unknown,
  bundleRef: HostedExecutionBundleRef | null,
): boolean {
  return JSON.stringify(
    parseHostedExecutionCursorSnapshotRef(
      snapshotRef,
      "Hosted wake cursor snapshotRef equality check",
    ) ?? null,
  ) === JSON.stringify(bundleRef ?? null);
}

function hostedWakeMaterializationDueNow(
  wakeMaterializationHints: HostedWakeMaterializationHints | null,
): boolean {
  if (!wakeMaterializationHints) {
    return false;
  }

  return hostedWakeHintDueNow(wakeMaterializationHints.assistantWakeAt)
    || hostedWakeHintDueNow(wakeMaterializationHints.deviceSyncWakeAt);
}

function hostedWakeHintDueNow(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs <= Date.now();
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
