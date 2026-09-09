import {
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedDeviceSyncCompletionRecordInput,
  resolveHostedSystemMailboxNextWakeCandidate,
} from "./system-mailbox.ts";
import type {
  HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
} from "./workspace-runner.ts";

/** One device preparation per durable checkpoint, using the existing mailbox owner. */
export function createHostedForegroundDeviceSync(input: Pick<
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0],
  "now" | "operatorHomeRoot" | "runtime" | "runtimeEnv" | "signal" | "vaultRoot"
>) {
  let pendingCheckpoint = false;
  return {
    hasPendingCheckpoint: (): boolean => pendingCheckpoint,
    async prepare(pass: { signal: AbortSignal; shouldYield?: (() => boolean) | null }): Promise<
      HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null
    > {
      if (pendingCheckpoint || pass.signal.aborted || input.signal?.aborted) {
        return null;
      }
      const signal = input.signal
        ? AbortSignal.any([input.signal, pass.signal])
        : pass.signal;
      const preparation = await prepareHostedSystemMailboxItemForCheckpoint({
        ...input,
        allowedRouteActions: ["run-device-sync-wake"],
        deviceSyncIngestionOnly: true,
        retainProcessedItemUntilRecorded: true,
        shouldYieldBackgroundMaintenance: () => signal.aborted || pass.shouldYield?.() === true,
        signal,
      });
      if (!preparation) {
        return null;
      }
      // Do not reselect a recording item on every foreground turn, or let an
      // idle lane record it before its snapshot. No importer waits on this bit.
      const nextWake = await resolveHostedSystemMailboxNextWakeCandidate({
        ...(input.now ? { now: input.now } : {}),
        vaultRoot: input.vaultRoot,
      });
      pendingCheckpoint = true;
      return {
        checkpointReason: "system_mailbox_receipt",
        nextWakeAt: nextWake.at,
        nextWakeReason: nextWake.reason,
        afterDurableCheckpoint: async () => {
          try {
            input.signal?.throwIfAborted();
            if (preparation.status === "processed" || preparation.status === "recording") {
              // Delivery cancellation belongs to the importer, not to this
              // durable effect. Lease/consent/shutdown authority is still live.
              const record = await recordHostedSystemMailboxItemAfterCheckpoint({
                ...input,
                item: preparation.item,
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
            }
            return { requiresFollowUpCheckpoint: true };
          } finally {
            pendingCheckpoint = false;
          }
        },
      };
    },
  };
}
