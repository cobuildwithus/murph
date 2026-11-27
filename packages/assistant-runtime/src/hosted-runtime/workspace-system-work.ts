import type { RuntimeWakeNotification, RuntimeWakeSignal } from "./runtime-wake.ts";
import {
  deferHostedSystemMailboxItemAfterVaultShareProjectionFailure,
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedDeviceSyncCompletionRecordInput,
  resolveHostedSystemMailboxNextWakeCandidate,
  type HostedSystemMailboxCheckpointPreparation,
} from "./system-mailbox.ts";
import {
  runHostedWorkspaceCanonicalWriteAtBoundary,
  type HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
  type HostedWorkspaceRunnerInput,
} from "./workspace-runner.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
  type HostedSystemMailboxRouteAction,
} from "./system-mailbox-state.ts";

/**
 * An enrichment pointer with nothing to publish is removed when its final apply
 * commits. Losing that removal only reruns the apply, which finishes through its
 * saved receipt, so the job end joins the batched checkpoint.
 */
function finishesWithItsApply(item: HostedSystemMailboxPendingItem): boolean {
  return item.routeAction === "apply-clinical-enrichment" && item.postCheckpointRecord === null;
}

export const HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS = [
  "run-device-sync-wake",
  "run-clinical-records-sync",
  "apply-clinical-enrichment",
] as const satisfies readonly HostedSystemMailboxRouteAction[];

/** Attempts belong to the fenced workspace. Mailbox claims own exclusion and retry. */
export function createHostedWorkspaceSystemWork(input: {
  preparation: Pick<
    Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0],
    "assistantExecutionBlocked" | "now" | "operatorHomeRoot" | "runtime" | "runtimeEnv" | "signal" | "vaultRoot"
  >;
  runnerInput: HostedWorkspaceRunnerInput;
  onCompleted(
    result: HostedWorkspaceRunnerAssistantPhasePostCheckpoint & { systemProgressed?: true; alreadyCheckpointed?: true },
    notify: boolean,
  ): void;
  onFailure(error: unknown, notify: boolean): void;
  settleOwnedMutations(): Promise<void>;
}) {
  let paused = true;
  let cancellation = new AbortController();
  let pendingClinicalApplies = 0;
  let clinicalApplyDrained = new AbortController();
  const completed = async (
    preparation: HostedSystemMailboxCheckpointPreparation,
  ): Promise<void> => {
    const nextWake = await resolveHostedSystemMailboxNextWakeCandidate({
      assistantExecutionBlocked: input.preparation.assistantExecutionBlocked,
      ...(input.preparation.now ? { now: input.preparation.now } : {}),
      vaultRoot: input.preparation.vaultRoot,
    });
    input.onCompleted({
      ...(preparation.status === "recording" && preparation.item.routeAction === "run-device-sync-wake"
        ? { alreadyCheckpointed: true as const } : {}),
      checkpointReason: "system_mailbox_receipt",
      ...(preparation.status === "processed" && preparation.metrics.systemProgressed === true
        ? { systemProgressed: true as const } : {}),
      nextWakeAt: nextWake.at,
      nextWakeReason: nextWake.reason,
      ...(preparation.status === "recording"
        || (preparation.status === "processed" && !finishesWithItsApply(preparation.item))
        ? {
            afterDurableCheckpoint: async (context) => {
              (context?.signal ?? input.preparation.signal)?.throwIfAborted();
              if (context?.vaultShareProjectionResult?.outcome === "error"
                && preparation.item.postCheckpointRecord?.kind !== "vault-share.projection") {
                const wake = await deferHostedSystemMailboxItemAfterVaultShareProjectionFailure({
                  item: preparation.item,
                  vaultRoot: input.preparation.vaultRoot,
                });
                return { nextWakeAt: wake.at, nextWakeReason: wake.reason, requiresFollowUpCheckpoint: true };
              }
              const record = await recordHostedSystemMailboxItemAfterCheckpoint({
                ...input.preparation,
                item: preparation.item,
                signal: context?.signal ?? input.preparation.signal,
                ...(context?.vaultShareProjectionResult
                  ? { vaultShareProjectionResult: context.vaultShareProjectionResult }
                  : {}),
                ...resolveHostedDeviceSyncCompletionRecordInput({
                  item: preparation.item,
                  preparation,
                }),
              });
              const requiresFollowUpCheckpoint = preparation.item.routeAction !== "run-device-sync-wake"
                || preparation.status === "recording" || record.failed > 0;
              return {
                nextWakeAt: record.nextWakeAt,
                nextWakeReason: record.nextWakeReason ?? null,
                // Fresh imports and their journal are already in the snapshot.
                // Replay cleanup instead joins the next invocation's one save.
                requiresFollowUpCheckpoint,
              };
            },
          }
        : {}),
    }, !paused);
  };
  // Clinical apply yields at its own receipt-capacity budget; every other route keeps the shared one.
  const yieldsFor = (routeAction: HostedSystemMailboxRouteAction) => routeAction === "apply-clinical-enrichment"
    ? input.runnerInput.shouldYieldClinicalApply ?? input.runnerInput.shouldYieldBackgroundMaintenance
    : input.runnerInput.shouldYieldBackgroundMaintenance;
  const kick = (
    allowedRouteActions: readonly HostedSystemMailboxRouteAction[] =
      HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS,
  ): void => {
    if (paused || input.preparation.signal?.aborted) return;
    const signal = input.preparation.signal
      ? AbortSignal.any([input.preparation.signal, cancellation.signal])
      : cancellation.signal;
    for (const routeAction of HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS) {
      const shouldYieldBackgroundMaintenance = yieldsFor(routeAction);
      if (!allowedRouteActions.includes(routeAction) || shouldYieldBackgroundMaintenance?.()) continue;
      const isClinicalApply = routeAction === "apply-clinical-enrichment";
      if (isClinicalApply) pendingClinicalApplies++;
      const completion = (async () => {
        try {
          const { result: preparation } = await runHostedWorkspaceCanonicalWriteAtBoundary({
            previousRedactedStatus: input.runnerInput.checkpointRequestBuilder.readRedactedStatus(),
            runnerInput: input.runnerInput,
            write: () => prepareHostedSystemMailboxItemForCheckpoint({
              ...input.preparation,
              allowedRouteActions: [routeAction],
              pendingOnly: true,
              runtimeLogContext: input.runnerInput.runtimeLogContext,
              retainProcessedItemUntilRecorded: !isClinicalApply,
              shouldYieldDeviceImportPreparation: input.runnerInput.shouldYieldDeviceImportPreparation,
              shouldYieldBackgroundMaintenance,
              backgroundMaintenanceYieldReason: input.runnerInput.backgroundMaintenanceYieldReason,
              signal,
            }),
          });
          if (!preparation) return;
          await completed(preparation);
          // Several jobs' cached units can be due at once; apply them back to back.
          if (isClinicalApply) kick([routeAction]);
        } catch (error) {
          input.onFailure(error, !paused);
        } finally {
          // A chained apply takes ownership above before its predecessor settles.
          if (isClinicalApply && --pendingClinicalApplies === 0) {
            const drained = clinicalApplyDrained;
            clinicalApplyDrained = new AbortController();
            drained.abort();
          }
        }
      })();
      input.runnerInput.trackLocalWorkspaceMutationCompletion?.(completion);
    }
  };
  const recoverProjectedWake = async (workspace: HostedWorkspaceRunnerInput["workspace"]): Promise<void> => {
    const occurredAt = input.preparation.now?.() ?? new Date().toISOString();
    const now = Date.parse(occurredAt);
    if (input.preparation.runtime.resolvedConfig.deviceSync !== null
      && workspace?.nextWakeReason === "device-sync.reconcile"
      && Date.parse(workspace.nextWakeAt ?? "") <= now) {
      // A due mailbox item already owns this alarm. Otherwise, materialize the
      // legacy timer through the same claim/retry path as incoming hints.
      const itemId = `device-sync.wake:workspace:${workspace.nextWakeAt}`;
      await updateHostedSystemMailboxState(input.preparation.vaultRoot, (state) => {
        if (state.pending.some((item) => item.routeAction === "run-device-sync-wake"
          && item.wake.kind === "device-sync.wake"
          && (!item.wake.connectionId
            || Date.parse(item.nextAttemptAt ?? item.occurredAt) <= now))) {
          return { result: undefined, write: false };
        }
        return { pending: [...state.pending, {
          attemptCount: 0,
          itemId,
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          mailboxDedupeKey: itemId,
          mailboxLaneSeq: null,
          nextAttemptAt: null,
          occurredAt,
          postCheckpointRecord: null,
          requestId: null,
          routeAction: "run-device-sync-wake",
          status: "pending",
          wake: {
            eventId: itemId,
            kind: "device-sync.wake",
            occurredAt,
            reason: "reconcile_due",
            userId: input.runnerInput.expectedUserId,
          },
        }] };
      });
    }
  };
  return {
    kick,
    // A checkpoint can start waiting while the provider is still preparing its first apply.
    readClinicalApplies: () => ({ pending: pendingClinicalApplies > 0, drained: clinicalApplyDrained.signal }),
    recoverProjectedWake,
    async waitForCompletion(
      wakeSignal: RuntimeWakeSignal | null,
      onWake: (notification: RuntimeWakeNotification | null) => Promise<boolean>,
      deadlineMs: number | null = null,
    ): Promise<boolean> {
      const completion = input.settleOwnedMutations();
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let deadline = deadlineMs === null ? null : new Promise<"deadline">((resolve) => {
        deadlineTimer = setTimeout(() => resolve("deadline"), Math.min(
          2_147_483_647, Math.max(0, deadlineMs - Date.now()),
        ));
        deadlineTimer.unref?.();
      });
      try {
        while ((wakeSignal || deadline) && !input.preparation.signal?.aborted) {
          const wakeController = new AbortController();
          const wake = wakeSignal?.wait(wakeController.signal).catch((error: unknown) => {
            if (wakeController.signal.aborted) return null;
            throw error;
          });
          let wakeHandled = false;
          try {
            const result = await Promise.race([
              completion.then(() => null),
              ...(wake ? [wake] : []),
              ...(deadline ? [deadline] : []),
            ]);
            wakeController.abort();
            // Completion can win after the waiter consumed the same-tick wake.
            // Join the waiter before deciding that no foreground work arrived.
            const notification = await wake;
            if (notification) {
              wakeHandled = true;
              if (await onWake(notification)) return true;
            }
            if (result === null) break;
            if (result === "deadline") {
              deadline = null;
              if (await onWake(null)) return true;
            }
          } finally {
            wakeController.abort();
            // A failed completion must not discard an already accepted wake.
            if (!wakeHandled) {
              const notification = await wake;
              if (notification) wakeSignal?.notify(notification);
            }
          }
        }
        await completion;
        return false;
      } finally {
        clearTimeout(deadlineTimer);
      }
    },
    async recover(
      allowedRouteActions: readonly HostedSystemMailboxRouteAction[] =
        HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS,
    ) {
      if (allowedRouteActions.includes("run-device-sync-wake")) {
        await recoverProjectedWake(input.runnerInput.workspace);
      }
      const now = Date.parse(input.preparation.now?.() ?? new Date().toISOString());
      const state = await readHostedSystemMailboxState(input.preparation.vaultRoot);
      for (const item of state.pending) {
        if (item.status === "recording"
          && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now)
          && HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS.some((action) => action === item.routeAction)
          && allowedRouteActions.includes(item.routeAction)) {
          await completed({ checkpointRequired: true, item, itemId: item.itemId, status: "recording" });
        }
      }
    },
    resume() {
      if (input.preparation.signal?.aborted) return;
      if (cancellation.signal.aborted) cancellation = new AbortController();
      paused = false;
    },
    async quiesce() {
      paused = true;
      cancellation.abort(new DOMException("Workspace boundary paused background work.", "AbortError"));
      await input.settleOwnedMutations();
    },
  };
}
