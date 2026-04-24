import type {
  HostedExecutionCursorState,
  HostedExecutionRunnerResult,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import {
  createRuntimeTimerSyntheticWake,
  emitHostedExecutionStructuredLog,
  isHostedRuntimeTimerWake,
} from "@murphai/hosted-execution";
import type {
  HostedIngressLifecycleState,
  HostedRunAcquireResponse,
  HostedRunCleanupTarget,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import {
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type {
  HostedAssistantDeliveryOutcome,
  HostedRunMessagingActivityHandle,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { createHostedBrowserVaultReplicaStore } from "../browser-vault-store.js";
import { HostedBundleGarbageCollector } from "../bundle-gc.js";
import type { HostedExecutionEnvironment } from "../env.js";
import {
  acquireHostedRunFromWeb,
  commitHostedRunToWeb,
  finalizeHostedRunInWeb,
  readHostedRunStatusFromWeb,
  releaseHostedRunFinalizeInWeb,
} from "../web-control-plane.ts";
import type {
  RunnerRunProcessor,
  RunnerUserStores,
} from "./runner-run-processor.js";
import type { RunnerStateStore } from "./runner-state-store.js";
import {
  resolveHostedRunDrainInputs,
  type HostedWakeInputContext,
} from "./wake-inputs.js";
import {
  isHostedBundleArchiveValidationError,
} from "../hosted-bundle-validation.js";

export type HostedRunDrainState = HostedIngressLifecycleState;

export interface HostedRunBreadcrumbInput {
  level?: "info" | "warn" | "error";
  message: string;
  phase: string;
  redacted?: Record<string, unknown> | null;
  run: HostedRunRecord;
  runToken?: string | null;
  userId: string;
  wakeEventId?: string;
}

type HostedRunFinalizationProcessor = Pick<
  RunnerRunProcessor,
  | "cleanupTransientWakeDataBestEffortForRunDrain"
  | "executeRunDrain"
  | "finalizeRunDrain"
  | "persistPendingRunCleanupData"
  | "startRunMessagingActivity"
>;

type HostedRunFinalizationStateStore = Pick<
  RunnerStateStore,
  | "clearPendingRunCleanup"
  | "readDurablePendingRunCleanup"
  | "readPendingRunCleanup"
  | "readPendingRunCleanupRecoveryRunIds"
  | "readTrackedAuthoritativeCursor"
  | "writeTrackedAuthoritativeCursor"
>;

export interface HostedRunFinalizationContext extends HostedWakeInputContext {
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  hostedWebBaseUrl: string;
  runnerTimeoutMs: HostedExecutionEnvironment["runnerTimeoutMs"];
  runProcessor: HostedRunFinalizationProcessor;
  stateStore: HostedRunFinalizationStateStore;
  bindRunMessagingActivity(input: {
    handle: HostedRunMessagingActivityHandle | null;
    runId: string;
  }): Promise<void>;
  recordHostedRunBreadcrumb(input: HostedRunBreadcrumbInput): void;
  resolveAcquiredRunInputSnapshotRef(
    acquired: HostedRunAcquireResponse,
  ): HostedExecutionCursorState["snapshotRef"];
  resolveAcquiredRunPreparedSnapshotRef(
    acquired: HostedRunAcquireResponse,
  ): HostedExecutionCursorState["snapshotRef"];
  stopActiveMessagingActivity(input: {
    runId?: string;
  }): Promise<{
    stopped: boolean;
  }>;
  syncRunnerBundleCacheToCursor(
    snapshotRef: HostedExecutionCursorState["snapshotRef"] | undefined,
  ): Promise<void>;
}

interface HostedRunFinalizationOutcome {
  cursor: HostedExecutionCursorState;
  state: HostedRunDrainState;
}

export async function prepareAndCommitAcquiredHostedRun(
  context: HostedRunFinalizationContext,
  input: {
    acquired: HostedRunAcquireResponse;
    userId: string;
  },
): Promise<HostedRunFinalizationOutcome> {
  const run = input.acquired.run;
  const runToken = input.acquired.runToken;
  if (!run || !runToken) {
    return {
      cursor: input.acquired.cursor,
      state: "backpressured",
    };
  }

  const resolved = await resolveHostedRunDrainInputs(context, {
    acquired: input.acquired,
    run,
    userId: input.userId,
  });
  const primaryWake = resolved.primaryWake
    ?? createRuntimeTimerSyntheticWake({
      acquiredAt: run.acquiredAt,
      runId: run.id,
      triggerKind: run.triggerKind,
      userId: input.userId,
    });
  const cleanupWakes = resolved.events
    .map((event) => event.wake)
    .filter((wake): wake is HostedIngressEnvelope => !isHostedRuntimeTimerWake(wake));

  if (resolved.events.length === 0 && input.acquired.events.length > 0) {
    context.recordHostedRunBreadcrumb({
      message: "Cloudflare attempted to commit the acquired hosted run.",
      phase: "commit_attempted",
      redacted: {
        commitKind: "quarantine",
        quarantinedEventCount: input.acquired.events.length,
        validEventCount: 0,
      },
      run,
      runToken,
      userId: input.userId,
    });
    const commit = await commitHostedRunToWeb({
      baseUrl: context.hostedWebBaseUrl,
      body: {
        eventResults: resolved.eventResults,
        expectedCursorVersion: input.acquired.cursor.version,
        finalizeRequired: false,
        outputCommittedSeq: resolved.outputCommittedSeq,
        preparedSnapshotRef: input.acquired.cursor.snapshotRef,
        redactedSummary: {
          eventCount: input.acquired.events.length,
          phase: "quarantined",
          validEventCount: 0,
        },
        runId: run.id,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: context.callbackSigning,
      timeoutMs: context.runnerTimeoutMs,
    });

    const cursor = commit.cursor;

    context.recordHostedRunBreadcrumb({
      level: commit.committed ? "info" : "warn",
      message: commit.committed
        ? "Cloudflare won the hosted run commit."
        : "Cloudflare lost the hosted run commit.",
      phase: commit.committed ? "commit_won" : "commit_lost",
      redacted: {
        commitKind: "quarantine",
        quarantinedEventCount: input.acquired.events.length,
        validEventCount: 0,
      },
      run,
      runToken,
      userId: input.userId,
    });

    return {
      cursor,
      state: commit.committed ? "completed" : "backpressured",
    };
  }

  const messagingActivity = await context.runProcessor.startRunMessagingActivity({
    events: resolved.events,
    run,
  });
  await context.bindRunMessagingActivity({
    handle: messagingActivity,
    runId: run.id,
  });
  const stopMessagingActivity = async () => {
    await context.stopActiveMessagingActivity({
      runId: run.id,
    });
  };

  try {
    await context.ensureManagedUserCryptoForActivationWakeIfNeeded(primaryWake);
    const execution = await context.runProcessor.executeRunDrain({
      currentBundleRef: context.resolveAcquiredRunInputSnapshotRef(input.acquired),
      events: resolved.events,
      primaryWake,
      messagingActivityOwnedByExecutor: messagingActivity?.ownsRuntimeActivity === true,
      run,
      runToken,
    });

    if (execution.state === "quarantined") {
      return quarantineAcquiredHostedRunAfterInvalidBundle(context, {
        acquired: input.acquired,
        eventResults: input.acquired.events.map((event) => ({
          ingressEventId: event.id,
          quarantineCode: execution.quarantineCode ?? "invalid-authoritative-snapshot",
          state: "quarantined",
        })),
        outputCommittedSeq: resolved.outputCommittedSeq,
        run,
        runToken,
        snapshotRef: execution.cursorSnapshotRef ?? input.acquired.cursor.snapshotRef,
        summary: execution.redactedSummary ?? null,
        userId: input.userId,
      });
    }

    if (execution.state !== "completed") {
      return failAcquiredHostedRun(context, {
        acquired: input.acquired,
        failureCode: "HOSTED_RUN_RUNTIME_BACKPRESSURED",
        run,
        runToken,
        userId: input.userId,
      });
    }

    const commitInputs = await mergeAdoptedHostedRunCommitInputs(context, {
      adoptedEventResults: execution.adoptedEventResults ?? [],
      eventResults: resolved.eventResults,
      outputCommittedSeq: resolved.outputCommittedSeq,
      run,
      userId: input.userId,
    });
    if (execution.finalizeRequired) {
      const persistedCleanup = await persistPendingRunCleanupDataRequired(context, {
        assistantDeliveryOutcomes: execution.assistantDeliveryOutcomes ?? [],
        ...(execution.adoptedCleanupTargets && execution.adoptedCleanupTargets.length > 0
          ? { cleanupTargets: execution.adoptedCleanupTargets }
          : {}),
        committedResult: execution.committedResult ?? null,
        runId: run.id,
        userId: input.userId,
        wakes: cleanupWakes,
      });
      if (!persistedCleanup) {
        await cleanupCandidateCursorTransitionBestEffort(context, {
          candidateBrowserVaultReplicaRef: execution.browserVaultReplicaRef ?? null,
          candidateSnapshotRef: execution.cursorSnapshotRef,
          currentCursor: input.acquired.cursor,
          userId: input.userId,
        });
        await clearPendingRunCleanupDataBestEffort(context, {
          runId: run.id,
          userId: input.userId,
        });
        return failAcquiredHostedRun(context, {
          acquired: input.acquired,
          failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_PERSIST_FAILED",
          run,
          runToken,
          userId: input.userId,
        });
      }
    }

    context.recordHostedRunBreadcrumb({
      message: "Cloudflare attempted to commit the acquired hosted run.",
      phase: "commit_attempted",
      redacted: {
        commitKind: execution.finalizeRequired ? "prepared_snapshot_finalize" : "prepared_snapshot",
        eventCount: commitInputs.eventResults.length,
        preparedSnapshotPresent: execution.cursorSnapshotRef !== null,
      },
      run,
      runToken,
      userId: input.userId,
    });
    const commit = await commitHostedRunToWeb({
      baseUrl: context.hostedWebBaseUrl,
      body: {
        eventResults: commitInputs.eventResults,
        expectedCursorVersion: input.acquired.cursor.version,
        finalizeRequired: execution.finalizeRequired,
        ...(execution.nextRuntimeWakeAt === undefined
          ? {}
          : {
            nextRuntimeWakeAt: execution.nextRuntimeWakeAt ?? null,
            nextRuntimeWakeReason: execution.nextRuntimeWakeAt ? "runtime" : null,
          }),
        outputCommittedSeq: commitInputs.outputCommittedSeq,
        browserVaultReplicaRef: execution.finalizeRequired ? undefined : execution.browserVaultReplicaRef ?? null,
        preparedSnapshotRef: execution.cursorSnapshotRef,
        redactedSummary: execution.redactedSummary ?? null,
        runId: run.id,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: context.callbackSigning,
      timeoutMs: context.runnerTimeoutMs,
    });

    context.recordHostedRunBreadcrumb({
      level: commit.committed ? "info" : "warn",
      message: commit.committed
        ? "Cloudflare won the hosted run commit."
        : "Cloudflare lost the hosted run commit.",
      phase: commit.committed ? "commit_won" : "commit_lost",
      redacted: {
        commitKind: execution.finalizeRequired ? "prepared_snapshot_finalize" : "prepared_snapshot",
        eventCount: commitInputs.eventResults.length,
        needsFinalize: commit.needsFinalize,
      },
      run,
      runToken,
      userId: input.userId,
    });

    if (!commit.committed || !commit.run) {
      const authoritativeCursorCleanupApplied = await cleanupCommittedCursorTransitionBestEffort(
        context,
        {
          nextCursor: commit.cursor,
          previousCursor: input.acquired.cursor,
          userId: input.userId,
        },
      );
      if (authoritativeCursorCleanupApplied) {
        await writeTrackedAuthoritativeCursorBestEffort(context, {
          cursor: commit.cursor,
          userId: input.userId,
        });
      }
      await cleanupCandidateCursorTransitionBestEffort(context, {
        candidateBrowserVaultReplicaRef: execution.browserVaultReplicaRef ?? null,
        candidateSnapshotRef: execution.cursorSnapshotRef,
        currentCursor: commit.cursor,
        userId: input.userId,
      });
      await clearPendingRunCleanupDataBestEffort(context, {
        runId: run.id,
        userId: input.userId,
      });
      return {
        cursor: commit.cursor,
        state: "backpressured",
      };
    }

    let cleanupCompleted = false;
    let cursor = commit.cursor;
    const committedCursorCleanupApplied = await cleanupCommittedCursorTransitionBestEffort(
      context,
      {
        nextCursor: commit.cursor,
        previousCursor: input.acquired.cursor,
        userId: input.userId,
      },
    );
    if (committedCursorCleanupApplied) {
      await writeTrackedAuthoritativeCursorBestEffort(context, {
        cursor: commit.cursor,
        userId: input.userId,
      });
    }

    if (commit.needsFinalize) {
      await context.syncRunnerBundleCacheToCursor(cursor.snapshotRef);
      const resumeFinalizeAcquire = await acquireHostedRunFromWeb({
        baseUrl: context.hostedWebBaseUrl,
        body: {
          executorKind: "cloudflare-container",
          triggerKind: "retry_finalize",
        },
        boundUserId: input.userId,
        callbackSigning: context.callbackSigning,
        timeoutMs: context.runnerTimeoutMs,
      });
      if (
        !resumeFinalizeAcquire.acquired
        || resumeFinalizeAcquire.resumeFinalize !== true
        || !resumeFinalizeAcquire.run
        || !resumeFinalizeAcquire.runToken
        || resumeFinalizeAcquire.run.id !== commit.run.id
        || resumeFinalizeAcquire.run.status !== "finalizing"
      ) {
        return {
          cursor: resumeFinalizeAcquire.cursor,
          state: "backpressured",
        };
      }
      const finalized = await finalizeAcquiredHostedRun(context, {
        acquired: resumeFinalizeAcquire,
        ...(execution.adoptedCleanupTargets && execution.adoptedCleanupTargets.length > 0
          ? { cleanupTargets: execution.adoptedCleanupTargets }
          : {}),
        committedResult: execution.committedResult ?? null,
        cleanupWakes,
        messagingActivityOwnedByExecutor: messagingActivity?.ownsRuntimeActivity === true,
        onRuntimeDeliveryFinished: stopMessagingActivity,
        userId: input.userId,
      });
      cursor = finalized.cursor;
      if (finalized.state !== "completed") {
        return finalized;
      }
      cleanupCompleted = true;
    }

    if (!cleanupCompleted) {
      await context.runProcessor.cleanupTransientWakeDataBestEffortForRunDrain({
        assistantDeliveryOutcomes: execution.assistantDeliveryOutcomes ?? [],
        ...(execution.adoptedCleanupTargets && execution.adoptedCleanupTargets.length > 0
          ? { cleanupTargets: execution.adoptedCleanupTargets }
          : {}),
        runId: run.id,
        userId: input.userId,
        wakes: cleanupWakes,
      });
    }

    return {
      cursor,
      state: "completed",
    };
  } finally {
    await stopMessagingActivity();
  }
}

export async function finalizeAcquiredHostedRun(
  context: HostedRunFinalizationContext,
  input: {
    acquired: HostedRunAcquireResponse;
    committedResult?: HostedExecutionRunnerResult | null;
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    cleanupWakes?: readonly HostedIngressEnvelope[];
    messagingActivityOwnedByExecutor?: boolean;
    onRuntimeDeliveryFinished?: () => Promise<void>;
    userId: string;
  },
): Promise<HostedRunFinalizationOutcome> {
  const run = input.acquired.run;
  const runToken = input.acquired.runToken;
  if (
    !run
    || !runToken
    || input.acquired.resumeFinalize !== true
    || run.status !== "finalizing"
  ) {
    return {
      cursor: input.acquired.cursor,
      state: "backpressured",
    };
  }

  let committedResult = input.committedResult ?? null;

  if (input.cleanupWakes === undefined) {
    let pendingCleanup: Awaited<ReturnType<RunnerStateStore["readPendingRunCleanup"]>>;

    try {
      pendingCleanup = await context.stateStore.readPendingRunCleanup(run.id);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId: run.id,
        },
        error,
        level: "warn",
        message:
          "Hosted run finalize resume could not read pending cleanup recovery state; refusing to finalize until recovery data is available.",
        phase: "wake.running",
        userId: input.userId,
      });
      await releaseHostedRunFinalizeForRetry(context, {
        failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_UNREADABLE",
        run,
        runToken,
        userId: input.userId,
      });
      return {
        cursor: input.acquired.cursor,
        state: "backpressured",
      };
    }

    if (!pendingCleanup?.required) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId: run.id,
        },
        level: "warn",
        message:
          "Hosted run finalize resume is missing pending cleanup recovery state; refusing to finalize until recovery data is available.",
        phase: "wake.running",
        userId: input.userId,
      });
      await releaseHostedRunFinalizeForRetry(context, {
        failureCode: "HOSTED_RUN_FINALIZE_CLEANUP_RECOVERY_MISSING",
        run,
        runToken,
        userId: input.userId,
      });
      return {
        cursor: input.acquired.cursor,
        state: "backpressured",
      };
    }

    committedResult = pendingCleanup.committedResult ?? null;
  }

  await context.syncRunnerBundleCacheToCursor(input.acquired.cursor.snapshotRef);
  context.recordHostedRunBreadcrumb({
    message: "Cloudflare started hosted run finalization from the prepared snapshot.",
    phase: "finalize_started",
    redacted: {
      resumeFinalize: input.acquired.resumeFinalize,
    },
    run,
    runToken,
    userId: input.userId,
  });
  const execution = await context.runProcessor.finalizeRunDrain({
    committedResult,
    currentBundleRef: context.resolveAcquiredRunPreparedSnapshotRef(input.acquired),
    primaryWake: createRuntimeTimerSyntheticWake({
      acquiredAt: run.acquiredAt,
      runId: run.id,
      triggerKind: run.triggerKind,
      userId: input.userId,
    }),
    messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor === true,
    run,
    runToken,
  });

  if (execution.state === "completed") {
    await input.onRuntimeDeliveryFinished?.();
  }

  if (execution.state === "quarantined") {
    const finalized = await finalizeHostedRunInWeb({
      baseUrl: context.hostedWebBaseUrl,
      body: {
        browserVaultReplicaRef: null,
        finalSnapshotRef: execution.cursorSnapshotRef ?? input.acquired.cursor.snapshotRef,
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        redactedSummary: execution.redactedSummary ?? {
          phase: "quarantined",
          reason: "invalid_authoritative_snapshot",
        },
        runId: run.id,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: context.callbackSigning,
      timeoutMs: context.runnerTimeoutMs,
    });

    context.recordHostedRunBreadcrumb({
      level: finalized.finalized ? "warn" : "error",
      message: finalized.finalized
        ? "Cloudflare finalized a hosted run without runtime replay because the authoritative bundle archive is invalid."
        : "Cloudflare could not finalize a hosted run after detecting an invalid authoritative bundle archive.",
      phase: finalized.finalized ? "finalize_quarantined" : "finalize_quarantine_failed",
      redacted: {
        finalized: finalized.finalized,
        reason: "invalid_authoritative_snapshot",
      },
      run,
      runToken,
      userId: input.userId,
    });

    if (finalized.finalized) {
      await context.runProcessor.cleanupTransientWakeDataBestEffortForRunDrain({
        ...(input.cleanupTargets && input.cleanupTargets.length > 0
          ? { cleanupTargets: input.cleanupTargets }
          : {}),
        runId: run.id,
        userId: input.userId,
        wakes: input.cleanupWakes ?? [],
      });
    }

    return {
      cursor: finalized.cursor,
      state: finalized.finalized ? "completed" : "backpressured",
    };
  }

  if (execution.state !== "completed") {
    await releaseHostedRunFinalizeForRetry(context, {
      failureCode: execution.state === "backpressured"
        ? "HOSTED_RUN_FINALIZE_BACKPRESSURED"
        : "HOSTED_RUN_FINALIZE_RETRYABLE",
      run,
      runToken,
      userId: input.userId,
    });
    return {
      cursor: input.acquired.cursor,
      state: execution.state,
    };
  }

  const finalized = await finalizeHostedRunInWeb({
    baseUrl: context.hostedWebBaseUrl,
    body: {
      browserVaultReplicaRef: execution.browserVaultReplicaRef ?? null,
      finalSnapshotRef: execution.cursorSnapshotRef,
      ...(execution.nextRuntimeWakeAt === undefined
        ? {}
        : {
          nextRuntimeWakeAt: execution.nextRuntimeWakeAt ?? null,
          nextRuntimeWakeReason: execution.nextRuntimeWakeAt ? "runtime" : null,
        }),
      redactedSummary: execution.redactedSummary ?? null,
      runId: run.id,
      runToken,
    },
    boundUserId: input.userId,
    callbackSigning: context.callbackSigning,
    timeoutMs: context.runnerTimeoutMs,
  });

  context.recordHostedRunBreadcrumb({
    level: finalized.finalized ? "info" : "warn",
    message: "Cloudflare finished hosted run finalization.",
    phase: "finalize_finished",
    redacted: {
      finalized: finalized.finalized,
      nextRuntimeWakeScheduled: execution.nextRuntimeWakeAt !== null,
    },
    run,
    runToken,
    userId: input.userId,
  });

  if (finalized.finalized) {
    const finalizedCursorCleanupApplied = await cleanupCommittedCursorTransitionBestEffort(
      context,
      {
        nextCursor: finalized.cursor,
        previousCursor: input.acquired.cursor,
        userId: input.userId,
      },
    );
    if (finalizedCursorCleanupApplied) {
      await writeTrackedAuthoritativeCursorBestEffort(context, {
        cursor: finalized.cursor,
        userId: input.userId,
      });
    }
    await context.runProcessor.cleanupTransientWakeDataBestEffortForRunDrain({
      assistantDeliveryOutcomes: execution.assistantDeliveryOutcomes ?? [],
      ...(input.cleanupTargets && input.cleanupTargets.length > 0
        ? { cleanupTargets: input.cleanupTargets }
        : {}),
      runId: run.id,
      userId: input.userId,
      wakes: input.cleanupWakes ?? [],
    });
  } else {
    const authoritativeCursorCleanupApplied = await cleanupCommittedCursorTransitionBestEffort(
      context,
      {
        nextCursor: finalized.cursor,
        previousCursor: input.acquired.cursor,
        userId: input.userId,
      },
    );
    if (authoritativeCursorCleanupApplied) {
      await writeTrackedAuthoritativeCursorBestEffort(context, {
        cursor: finalized.cursor,
        userId: input.userId,
      });
    }
    await cleanupCandidateCursorTransitionBestEffort(context, {
      candidateBrowserVaultReplicaRef: execution.browserVaultReplicaRef ?? null,
      candidateSnapshotRef: execution.cursorSnapshotRef,
      currentCursor: finalized.cursor,
      userId: input.userId,
    });
  }

  return {
    cursor: finalized.cursor,
    state: finalized.finalized ? "completed" : "backpressured",
  };
}

export async function cleanupCommittedCursorTransitionBestEffort(
  context: Pick<HostedRunFinalizationContext, "bucket" | "ensureRunnerStores">,
  input: {
    nextCursor: HostedExecutionCursorState;
    previousCursor: HostedExecutionCursorState;
    userId: string;
  },
): Promise<boolean> {
  const bundleTransitionChanged = !sameHostedBundlePayloadRef(
    input.previousCursor.snapshotRef,
    input.nextCursor.snapshotRef,
  );
  const replicaTransitionChanged = !sameHostedBrowserVaultReplicaObjectRef(
    input.previousCursor.browserVaultReplicaRef ?? null,
    input.nextCursor.browserVaultReplicaRef ?? null,
  );

  if (!bundleTransitionChanged && !replicaTransitionChanged) {
    return true;
  }

  let stores: RunnerUserStores;
  try {
    stores = await context.ensureRunnerStores(input.userId);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        bundleTransitionChanged,
        nextBundleRefKey: input.nextCursor.snapshotRef?.key ?? null,
        nextReplicaObjectKey: input.nextCursor.browserVaultReplicaRef?.objectKey ?? null,
        previousBundleRefKey: input.previousCursor.snapshotRef?.key ?? null,
        previousReplicaObjectKey: input.previousCursor.browserVaultReplicaRef?.objectKey ?? null,
        replicaTransitionChanged,
      },
      error,
      level: "warn",
      message:
        "Hosted cursor cleanup could not resolve runner stores after a committed ref swap; continuing without cleanup.",
      phase: "wake.running",
      userId: input.userId,
    });
    return false;
  }

  let cleanupApplied = true;

  if (bundleTransitionChanged) {
    try {
      await new HostedBundleGarbageCollector(
        context.bucket,
        stores.crypto.rootKey,
        stores.crypto.rootKeyId,
        stores.crypto.keysById,
      ).cleanupBundleTransition({
        nextBundleRef: input.nextCursor.snapshotRef,
        previousBundleRef: input.previousCursor.snapshotRef,
        userId: input.userId,
      });
    } catch (error) {
      if (isHostedBundleArchiveValidationError(error)) {
        emitHostedExecutionStructuredLog({
          component: "cloudflare.user-runner",
          details: {
            nextBundleRefKey: input.nextCursor.snapshotRef?.key ?? null,
            previousBundleRefKey: input.previousCursor.snapshotRef?.key ?? null,
          },
          error,
          level: "warn",
          message:
            "Hosted bundle cleanup found an invalid authoritative snapshot archive; preserving prior bundle data and marking cleanup reconciled.",
          phase: "wake.running",
          userId: input.userId,
        });
      } else {
        emitHostedExecutionStructuredLog({
          component: "cloudflare.user-runner",
          details: {
            nextBundleRefKey: input.nextCursor.snapshotRef?.key ?? null,
            previousBundleRefKey: input.previousCursor.snapshotRef?.key ?? null,
          },
          error,
          level: "warn",
          message:
            "Hosted bundle cleanup failed after the authoritative cursor committed a new snapshot ref; continuing without cleanup.",
          phase: "wake.running",
          userId: input.userId,
        });
        cleanupApplied = false;
      }
    }
  }

  if (replicaTransitionChanged) {
    try {
      const store = createHostedBrowserVaultReplicaStore({
        bucket: context.bucket,
        rootKey: stores.crypto.rootKey,
        userId: input.userId,
      });
      await store.deleteBrowserVaultReplica(input.previousCursor.browserVaultReplicaRef ?? null);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          nextReplicaObjectKey: input.nextCursor.browserVaultReplicaRef?.objectKey ?? null,
          previousReplicaObjectKey: input.previousCursor.browserVaultReplicaRef?.objectKey ?? null,
        },
        error,
        level: "warn",
        message:
          "Hosted browser vault replica cleanup failed after the authoritative cursor committed a new replica ref; continuing without cleanup.",
        phase: "wake.running",
        userId: input.userId,
      });
      cleanupApplied = false;
    }
  }

  return cleanupApplied;
}

export async function reconcileTrackedAuthoritativeCursorBestEffort(
  context: Pick<
    HostedRunFinalizationContext,
    | "bucket"
    | "callbackSigning"
    | "ensureRunnerStores"
    | "hostedWebBaseUrl"
    | "runnerTimeoutMs"
    | "runProcessor"
    | "stateStore"
  >,
  input: {
    currentCursor: HostedExecutionCursorState;
    preservePendingCleanupRunId?: string | null;
    userId: string;
  },
): Promise<boolean> {
  let trackedCursor: Awaited<ReturnType<RunnerStateStore["readTrackedAuthoritativeCursor"]>>;
  try {
    trackedCursor = await context.stateStore.readTrackedAuthoritativeCursor();
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        currentBundleRefKey: input.currentCursor.snapshotRef?.key ?? null,
        currentReplicaObjectKey: input.currentCursor.browserVaultReplicaRef?.objectKey ?? null,
      },
      error,
      level: "warn",
      message:
        "Hosted runner could not read the tracked authoritative cursor cleanup state; continuing without reconciliation.",
      phase: "wake.running",
      userId: input.userId,
    });
    return false;
  }

  if (!trackedCursor) {
    await replayRecoveredPendingRunCleanupBestEffort(context, {
      preservePendingCleanupRunId: input.preservePendingCleanupRunId ?? null,
      pruneStaleNonFinalized: false,
      userId: input.userId,
    });
    await writeTrackedAuthoritativeCursorBestEffort(context, {
      cursor: input.currentCursor,
      userId: input.userId,
    });
    return false;
  }

  const authoritativeCursorAdvanced = !sameHostedBundlePayloadRef(
    trackedCursor.snapshotRef,
    input.currentCursor.snapshotRef,
  ) || !sameHostedBrowserVaultReplicaObjectRef(
    trackedCursor.browserVaultReplicaRef ?? null,
    input.currentCursor.browserVaultReplicaRef ?? null,
  );

  const cleanupApplied = await cleanupCommittedCursorTransitionBestEffort(context, {
    nextCursor: input.currentCursor,
    previousCursor: {
      ...input.currentCursor,
      browserVaultReplicaRef: trackedCursor.browserVaultReplicaRef ?? null,
      snapshotRef: trackedCursor.snapshotRef,
    },
    userId: input.userId,
  });
  if (!cleanupApplied) {
    return false;
  }

  const recoveredPendingCleanup = await replayRecoveredPendingRunCleanupBestEffort(context, {
    preservePendingCleanupRunId: input.preservePendingCleanupRunId ?? null,
    pruneStaleNonFinalized: authoritativeCursorAdvanced,
    userId: input.userId,
  });
  if (!recoveredPendingCleanup) {
    return false;
  }

  await writeTrackedAuthoritativeCursorBestEffort(context, {
    cursor: input.currentCursor,
    userId: input.userId,
  });
  return authoritativeCursorAdvanced;
}

export async function replayRecoveredPendingRunCleanupBestEffort(
  context: Pick<
    HostedRunFinalizationContext,
    | "callbackSigning"
    | "hostedWebBaseUrl"
    | "runnerTimeoutMs"
    | "runProcessor"
    | "stateStore"
  >,
  input: {
    preservePendingCleanupRunId?: string | null;
    pruneStaleNonFinalized: boolean;
    userId: string;
  },
): Promise<boolean> {
  let runIds: string[];
  try {
    runIds = await context.stateStore.readPendingRunCleanupRecoveryRunIds();
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      error,
      level: "warn",
      message:
        "Hosted runner could not read the durable pending cleanup recovery pointer after an authoritative cursor advance.",
      phase: "wake.running",
      userId: input.userId,
    });
    return false;
  }

  if (runIds.length === 0) {
    return true;
  }

  let recoveredAll = true;
  for (const runId of runIds) {
    if (
      input.preservePendingCleanupRunId
      && runId === input.preservePendingCleanupRunId
    ) {
      continue;
    }

    let runStatus: Awaited<ReturnType<typeof readHostedRunStatusFromWeb>>;
    try {
      runStatus = await readHostedRunStatusFromWeb({
        baseUrl: context.hostedWebBaseUrl,
        body: {
          runId,
        },
        boundUserId: input.userId,
        callbackSigning: context.callbackSigning,
        timeoutMs: context.runnerTimeoutMs,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId,
        },
        error,
        level: "warn",
        message:
          "Hosted runner could not verify whether durable pending cleanup recovery is still authoritative; leaving retry inputs durable.",
        phase: "wake.running",
        userId: input.userId,
      });
      recoveredAll = false;
      continue;
    }

    if (runStatus.run?.id !== runId || runStatus.run.status !== "finalized") {
      if (!input.pruneStaleNonFinalized) {
        continue;
      }
      if (
        runStatus.run?.id === runId
        && (
          runStatus.run.status === "committed_needs_finalize"
          || runStatus.run.status === "finalizing"
        )
      ) {
        continue;
      }
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId,
          runStatus: runStatus.run?.status ?? null,
        },
        level: "warn",
        message:
          "Hosted runner found stale durable pending cleanup recovery state for a non-finalized run; clearing it instead of replaying cleanup.",
        phase: "wake.running",
        userId: input.userId,
      });
      await clearPendingRunCleanupDataBestEffort(context, {
        runId,
        userId: input.userId,
      });
      try {
        const remaining = await context.stateStore.readDurablePendingRunCleanup(runId);
        if (remaining) {
          recoveredAll = false;
        }
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "cloudflare.user-runner",
          details: {
            runId,
          },
          error,
          level: "warn",
          message:
            "Hosted runner could not confirm that stale durable pending cleanup recovery inputs were cleared.",
          phase: "wake.running",
          userId: input.userId,
        });
        recoveredAll = false;
      }
      continue;
    }

    try {
      await context.runProcessor.cleanupTransientWakeDataBestEffortForRunDrain({
        runId,
        userId: input.userId,
        wakes: [],
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId,
        },
        error,
        level: "warn",
        message:
          "Hosted runner could not replay durable pending cleanup after an authoritative cursor advance.",
        phase: "wake.running",
        userId: input.userId,
      });
      recoveredAll = false;
      continue;
    }

    try {
      const remaining = await context.stateStore.readDurablePendingRunCleanup(runId);
      if (remaining) {
        emitHostedExecutionStructuredLog({
          component: "cloudflare.user-runner",
          details: {
            runId,
          },
          level: "warn",
          message:
            "Hosted runner replayed durable pending cleanup after an authoritative cursor advance, but retry inputs remain durable and will be retried.",
          phase: "wake.running",
          userId: input.userId,
        });
        recoveredAll = false;
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          runId,
        },
        error,
        level: "warn",
        message:
          "Hosted runner could not confirm whether durable pending cleanup replay fully cleared its retry inputs.",
        phase: "wake.running",
        userId: input.userId,
      });
      recoveredAll = false;
    }
  }

  return recoveredAll;
}

export async function writeTrackedAuthoritativeCursorBestEffort(
  context: Pick<HostedRunFinalizationContext, "stateStore">,
  input: {
    cursor: HostedExecutionCursorState;
    userId: string;
  },
): Promise<void> {
  try {
    await context.stateStore.writeTrackedAuthoritativeCursor({
      browserVaultReplicaRef: input.cursor.browserVaultReplicaRef ?? null,
      snapshotRef: input.cursor.snapshotRef,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        bundleRefKey: input.cursor.snapshotRef?.key ?? null,
        replicaObjectKey: input.cursor.browserVaultReplicaRef?.objectKey ?? null,
      },
      error,
      level: "warn",
      message:
        "Hosted runner could not persist the tracked authoritative cursor cleanup state; future drains may retry cleanup.",
      phase: "wake.running",
      userId: input.userId,
    });
  }
}

export async function cleanupCandidateCursorTransitionBestEffort(
  context: Pick<HostedRunFinalizationContext, "bucket" | "ensureRunnerStores">,
  input: {
    candidateBrowserVaultReplicaRef: HostedExecutionCursorState["browserVaultReplicaRef"];
    candidateSnapshotRef: HostedExecutionCursorState["snapshotRef"];
    currentCursor: HostedExecutionCursorState;
    userId: string;
  },
): Promise<void> {
  const candidateCursor: HostedExecutionCursorState = {
    ...input.currentCursor,
    browserVaultReplicaRef: input.candidateBrowserVaultReplicaRef ?? null,
    snapshotRef: input.candidateSnapshotRef,
  };
  await cleanupCommittedCursorTransitionBestEffort(context, {
    nextCursor: input.currentCursor,
    previousCursor: candidateCursor,
    userId: input.userId,
  });
}

export async function persistPendingRunCleanupDataRequired(
  context: Pick<HostedRunFinalizationContext, "runProcessor">,
  input: {
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    committedResult?: HostedExecutionRunnerResult | null;
    runId: string;
    userId: string;
    wakes: readonly HostedIngressEnvelope[];
  },
): Promise<boolean> {
  try {
    await context.runProcessor.persistPendingRunCleanupData({
      assistantDeliveryOutcomes: input.assistantDeliveryOutcomes ?? [],
      ...(input.cleanupTargets && input.cleanupTargets.length > 0
        ? { cleanupTargets: input.cleanupTargets }
        : {}),
      committedResult: input.committedResult ?? null,
      runId: input.runId,
      wakes: input.wakes,
    });
    return true;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        cleanupWakeCount: input.wakes.length,
        runId: input.runId,
      },
      error,
      level: "warn",
      message:
        "Hosted run pending cleanup persistence failed; refusing to commit a finalize-required snapshot without durable cleanup recovery state.",
      phase: "wake.running",
      userId: input.userId,
    });
    return false;
  }
}

export async function clearPendingRunCleanupDataBestEffort(
  context: Pick<HostedRunFinalizationContext, "stateStore">,
  input: {
    runId: string;
    userId: string;
  },
): Promise<void> {
  try {
    await context.stateStore.clearPendingRunCleanup(input.runId);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        runId: input.runId,
      },
      error,
      level: "warn",
      message:
        "Hosted run pending cleanup sidecar clear failed after the run lost commit authority; continuing without cleanup-state pruning.",
      phase: "wake.running",
      userId: input.userId,
    });
  }
}

export async function releaseHostedRunFinalizeForRetry(
  context: Pick<
    HostedRunFinalizationContext,
    "callbackSigning" | "hostedWebBaseUrl" | "recordHostedRunBreadcrumb" | "runnerTimeoutMs"
  >,
  input: {
    failureCode: string;
    run: HostedRunRecord;
    runToken: string;
    userId: string;
  },
): Promise<void> {
  try {
    const released = await releaseHostedRunFinalizeInWeb({
      baseUrl: context.hostedWebBaseUrl,
      body: {
        failureClass: "hosted_run_finalize_retryable",
        failureCode: input.failureCode,
        runId: input.run.id,
        runToken: input.runToken,
      },
      boundUserId: input.userId,
      callbackSigning: context.callbackSigning,
      timeoutMs: context.runnerTimeoutMs,
    });

    context.recordHostedRunBreadcrumb({
      level: released.released ? "warn" : "error",
      message: released.released
        ? "Cloudflare released hosted run finalization for retry."
        : "Cloudflare could not release hosted run finalization for retry.",
      phase: released.released ? "finalize_released" : "finalize_release_failed",
      redacted: {
        failureCode: input.failureCode,
        released: released.released,
      },
      run: input.run,
      runToken: input.runToken,
      userId: input.userId,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare.user-runner",
      details: {
        failureCode: input.failureCode,
        runId: input.run.id,
      },
      error,
      level: "error",
      message: "Hosted run finalize release request failed; stale-run recovery is now the fallback.",
      phase: "wake.running",
      userId: input.userId,
    });
  }
}

async function quarantineAcquiredHostedRunAfterInvalidBundle(
  context: Pick<
    HostedRunFinalizationContext,
    "callbackSigning" | "hostedWebBaseUrl" | "recordHostedRunBreadcrumb" | "runnerTimeoutMs"
  >,
  input: {
    acquired: HostedRunAcquireResponse;
    eventResults: HostedRunEventResult[];
    outputCommittedSeq: string;
    run: HostedRunRecord;
    runToken: string;
    snapshotRef: HostedExecutionCursorState["snapshotRef"];
    summary: Record<string, unknown> | null;
    userId: string;
  },
): Promise<HostedRunFinalizationOutcome> {
  const reason = typeof input.summary?.reason === "string"
    ? input.summary.reason
    : "invalid_authoritative_snapshot";
  context.recordHostedRunBreadcrumb({
    level: "warn",
    message:
      "Cloudflare quarantined a hosted run because a bundle archive failed validation.",
    phase: "commit_quarantine_attempted",
    redacted: {
      commitKind: reason,
      eventCount: input.eventResults.length,
    },
    run: input.run,
    runToken: input.runToken,
    userId: input.userId,
  });
  const commit = await commitHostedRunToWeb({
    baseUrl: context.hostedWebBaseUrl,
    body: {
      eventResults: input.eventResults,
      expectedCursorVersion: input.acquired.cursor.version,
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      outputCommittedSeq: input.outputCommittedSeq,
      preparedSnapshotRef: input.snapshotRef,
      redactedSummary: input.summary ?? {
        eventCount: input.eventResults.length,
        phase: "quarantined",
        reason,
      },
      runId: input.run.id,
      runToken: input.runToken,
    },
    boundUserId: input.userId,
    callbackSigning: context.callbackSigning,
    timeoutMs: context.runnerTimeoutMs,
  });

  context.recordHostedRunBreadcrumb({
    level: commit.committed ? "warn" : "error",
    message: commit.committed
      ? "Cloudflare committed bundle-validation quarantine for the hosted run."
      : "Cloudflare could not commit bundle-validation quarantine for the hosted run.",
    phase: commit.committed ? "commit_quarantined" : "commit_quarantine_failed",
    redacted: {
      committed: commit.committed,
      eventCount: input.eventResults.length,
      reason,
    },
    run: input.run,
    runToken: input.runToken,
    userId: input.userId,
  });

  return {
    cursor: commit.cursor,
    state: commit.committed ? "completed" : "backpressured",
  };
}

async function failAcquiredHostedRun(
  context: Pick<
    HostedRunFinalizationContext,
    "callbackSigning" | "hostedWebBaseUrl" | "recordHostedRunBreadcrumb" | "runnerTimeoutMs"
  >,
  input: {
    acquired: HostedRunAcquireResponse;
    failureCode: string;
    run: HostedRunRecord;
    runToken: string;
    userId: string;
  },
): Promise<HostedRunFinalizationOutcome> {
  context.recordHostedRunBreadcrumb({
    message: "Cloudflare attempted to commit the acquired hosted run.",
    phase: "commit_attempted",
    redacted: {
      commitKind: "failure",
      failureCode: input.failureCode,
    },
    run: input.run,
    runToken: input.runToken,
    userId: input.userId,
  });
  const commit = await commitHostedRunToWeb({
    baseUrl: context.hostedWebBaseUrl,
    body: {
      expectedCursorVersion: input.acquired.cursor.version,
      failureClass: "hosted_run_runtime",
      failureCode: input.failureCode,
      finalizeRequired: false,
      outputCommittedSeq: input.acquired.cursor.committedSeq,
      preparedSnapshotRef: input.acquired.cursor.snapshotRef,
      runId: input.run.id,
      runToken: input.runToken,
    },
    boundUserId: input.userId,
    callbackSigning: context.callbackSigning,
    timeoutMs: context.runnerTimeoutMs,
  });
  const breadcrumb = resolveFailureCommitBreadcrumb({
    commit,
    failureCode: input.failureCode,
  });

  context.recordHostedRunBreadcrumb({
    level: breadcrumb.level,
    message: breadcrumb.message,
    phase: breadcrumb.phase,
    redacted: breadcrumb.redacted,
    run: input.run,
    runToken: input.runToken,
    userId: input.userId,
  });

  return {
    cursor: commit.cursor,
    state: "backpressured",
  };
}

function resolveFailureCommitBreadcrumb(input: {
  commit: HostedRunCommitResponse;
  failureCode: string;
}): {
  level: "info" | "warn";
  message: string;
  phase: string;
  redacted: Record<string, unknown>;
} {
  const failureRecorded = input.commit.run?.status === "failed"
    && input.commit.run.errorCode === input.failureCode;

  if (failureRecorded) {
    return {
      level: "warn",
      message:
        "Cloudflare recorded the hosted run failure; web will retry the uncommitted work.",
      phase: "failure_recorded",
      redacted: {
        commitKind: "failure",
        failureCode: input.failureCode,
        requeueExpected: true,
        webRunStatus: input.commit.run?.status ?? null,
      },
    };
  }

  return {
    level: input.commit.committed ? "info" : "warn",
    message: input.commit.committed
      ? "Cloudflare won the hosted run commit."
      : "Cloudflare lost the hosted run commit.",
    phase: input.commit.committed ? "commit_won" : "commit_lost",
    redacted: {
      commitKind: "failure",
      failureCode: input.failureCode,
      webRunStatus: input.commit.run?.status ?? null,
    },
  };
}

export async function mergeAdoptedHostedRunCommitInputs(
  context: Pick<
    HostedRunFinalizationContext,
    "callbackSigning" | "hostedWebBaseUrl" | "runnerTimeoutMs"
  >,
  input: {
    adoptedEventResults?: HostedRunEventResult[] | null;
    eventResults: HostedRunEventResult[];
    outputCommittedSeq: string;
    run: HostedRunRecord;
    userId: string;
  },
): Promise<{
  eventResults: HostedRunEventResult[];
  outputCommittedSeq: string;
}> {
  const status = await readHostedRunStatusFromWeb({
    baseUrl: context.hostedWebBaseUrl,
    body: {
      runId: input.run.id,
    },
    boundUserId: input.userId,
    callbackSigning: context.callbackSigning,
    timeoutMs: context.runnerTimeoutMs,
  });
  if (status.run?.id !== input.run.id) {
    throw new Error("Hosted run status refresh did not return the active run before commit.");
  }

  const latestRun = status.run;
  const explicitResults: HostedRunEventResult[] = [...input.eventResults];
  let explicitOutputCommittedSeq = BigInt(input.outputCommittedSeq);
  const eventCount = Math.min(
    latestRun.eventSeqs.length,
    latestRun.ingressEventIds.length,
  );
  const explicitResultIds = new Set(explicitResults.map((result) => result.ingressEventId));
  const adoptedResultsById = new Map(
    (input.adoptedEventResults ?? []).map((result) => [result.ingressEventId, result]),
  );

  for (let index = 0; index < eventCount; index += 1) {
    const seqText = latestRun.eventSeqs[index];
    const ingressEventId = latestRun.ingressEventIds[index];
    if (!seqText || !ingressEventId) {
      continue;
    }
    const seq = BigInt(seqText);
    const adoptedResult = adoptedResultsById.get(ingressEventId);
    if (!explicitResultIds.has(ingressEventId) && adoptedResult) {
      explicitResults.push(adoptedResult);
      explicitResultIds.add(ingressEventId);
    }
    if (!explicitResultIds.has(ingressEventId)) {
      if (seq > explicitOutputCommittedSeq) {
        break;
      }
      continue;
    }
    if (seq > explicitOutputCommittedSeq) {
      if (seq > explicitOutputCommittedSeq + 1n) {
        break;
      }
      explicitOutputCommittedSeq = seq;
    }
  }

  return {
    eventResults: explicitResults,
    outputCommittedSeq: explicitOutputCommittedSeq.toString(),
  };
}

function sameHostedBrowserVaultReplicaObjectRef(
  left: HostedExecutionCursorState["browserVaultReplicaRef"] | null,
  right: HostedExecutionCursorState["browserVaultReplicaRef"] | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  // Cleanup liveness is keyed by the stored object location. Metadata such as
  // generatedAt can change when the replica is rewritten in place.
  return left.objectKey === right.objectKey;
}
