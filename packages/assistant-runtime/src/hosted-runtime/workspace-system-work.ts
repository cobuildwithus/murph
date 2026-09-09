import type { RuntimeWakeSignal } from "./runtime-wake.ts";
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
              input.preparation.signal?.throwIfAborted();
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
                ...(context?.vaultShareProjectionResult
                  ? { vaultShareProjectionResult: context.vaultShareProjectionResult }
                  : {}),
                ...resolveHostedDeviceSyncCompletionRecordInput({
                  item: preparation.item,
                  preparation,
                }),
              });
              return {
                nextWakeAt: record.deviceSyncWake?.at ?? record.nextWakeAt,
                nextWakeReason:
                  record.deviceSyncWake?.reason ?? record.nextWakeReason ?? null,
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
      onWake: () => Promise<boolean>,
    ): Promise<boolean> {
      const completion = input.settleOwnedMutations();
      const wakeController = new AbortController();
      try {
        while (wakeSignal && !input.preparation.signal?.aborted) {
          const result = await Promise.race([
            completion.then(() => "finished" as const),
            wakeSignal.wait(wakeController.signal).then(() => "wake" as const),
          ]);
          if (result === "finished") break;
          if (await onWake()) return true;
        }
        await completion;
        return false;
      } finally {
        wakeController.abort();
      }
    },
    async recover(
      allowedRouteActions: readonly HostedSystemMailboxRouteAction[] =
        HOSTED_WORKSPACE_SYSTEM_WORK_ACTIONS,
    ) {
      const state = await readHostedSystemMailboxState(input.preparation.vaultRoot);
      const now = Date.parse(input.preparation.now?.() ?? new Date().toISOString());
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
