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
  type HostedSystemMailboxRouteAction,
} from "./system-mailbox-state.ts";

export const HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS = [
  "run-device-sync-wake",
  "run-clinical-records-sync",
  "run-environment-interview",
] as const satisfies readonly HostedSystemMailboxRouteAction[];

/** Attempts belong to the fenced workspace. Mailbox claims own exclusion and retry. */
export function createHostedWorkspaceSystemWork(input: {
  preparation: Pick<
    Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0],
    "now" | "operatorHomeRoot" | "runtime" | "runtimeEnv" | "signal" | "vaultRoot"
  >;
  runnerInput: HostedWorkspaceRunnerInput;
  onCompleted(
    result: HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
    notify: boolean,
  ): void;
  onFailure(error: unknown, notify: boolean): void;
  settleOwnedMutations(): Promise<void>;
}) {
  let paused = true;
  let cancellation = new AbortController();
  const completed = async (
    preparation: HostedSystemMailboxCheckpointPreparation,
  ): Promise<void> => {
    const nextWake = await resolveHostedSystemMailboxNextWakeCandidate({
      ...(input.preparation.now ? { now: input.preparation.now } : {}),
      vaultRoot: input.preparation.vaultRoot,
    });
    input.onCompleted({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: nextWake.at,
      nextWakeReason: nextWake.reason,
      ...(preparation.status === "processed" || preparation.status === "recording"
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
              return {
                nextWakeAt: record.nextWakeAt,
                nextWakeReason: record.nextWakeReason ?? null,
                requiresFollowUpCheckpoint: true,
              };
            },
          }
        : {}),
    }, !paused);
  };
  const kick = (
    allowedRouteActions: readonly HostedSystemMailboxRouteAction[] =
      HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS,
  ): void => {
    if (paused || input.preparation.signal?.aborted
      || input.runnerInput.shouldYieldBackgroundMaintenance?.()) {
      return;
    }
    const signal = input.preparation.signal
      ? AbortSignal.any([input.preparation.signal, cancellation.signal])
      : cancellation.signal;
    for (const routeAction of HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS) {
      if (!allowedRouteActions.includes(routeAction)) continue;
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
              retainProcessedItemUntilRecorded: true,
              shouldYieldBackgroundMaintenance: input.runnerInput.shouldYieldBackgroundMaintenance,
              signal,
            }),
          });
          if (!preparation) return;
          await completed(preparation);
        } catch (error) {
          input.onFailure(error, !paused);
        }
      })();
      input.runnerInput.trackLocalWorkspaceMutationCompletion?.(completion);
    }
  };
  return {
    kick,
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
          try {
            const result = await Promise.race([
              completion.then(() => null),
              ...(wakeSignal ? [wakeSignal.wait(wakeController.signal)] : []),
              ...(deadline ? [deadline] : []),
            ]);
            if (result === null) break;
            if (result === "deadline") deadline = null;
            if (await onWake(result === "deadline" ? null : result)) return true;
          } finally {
            wakeController.abort();
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
      const workspace = input.runnerInput.workspace;
      const occurredAt = input.preparation.now?.() ?? new Date().toISOString();
      const now = Date.parse(occurredAt);
      if (allowedRouteActions.includes("run-device-sync-wake")
        && input.preparation.runtime.resolvedConfig.deviceSync !== null
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
