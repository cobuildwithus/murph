import { isDeepStrictEqual } from "node:util";
import type { HostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { parseHostedExecutionSnapshotRef, parseHostedBrowserVaultReplicaRef, isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS } from "@murphai/hosted-execution/runtime-resources";
import type { PrismaClient } from "@prisma/client";

import { requireHostedRuntimeCallbackTx } from "../hosted-execution/runtime-owner";
import { requireRuntimeResourcesPublishableTx, recordRuntimeOrphansTx, snapshotOrphanCandidates, replicaOrphanCandidate } from "../hosted-execution/runtime-orphans";
import { getPrisma } from "../prisma";
import { runWithPrismaOperationTimings, type PrismaOperationTiming } from "../prisma-operation-timing";
import { buildHostedWebhookDbTimingLogDetails } from "../hosted-onboarding/webhook-db-timing";
import {
  checkpointHostedWorkspaceTx,
  publishLatestBrowserVaultReplicaRefTx,
} from "./store";

type RuntimePublication = {
  prisma?: PrismaClient;
  runtimeAuthority: HostedExecutionRuntimeAuthority | null;
};

export async function checkpointHostedRuntimeWorkspace(
  input: Omit<Parameters<typeof checkpointHostedWorkspaceTx>[0], "tx"> & RuntimePublication,
) {
  const operations: PrismaOperationTiming[] = [];
  const startedAtMs = Date.now();
  let callbackStartedAtMs: number | null = null;
  let callbackFinishedAtMs: number | null = null;
  let completed = false;
  try {
    const result = await runWithPrismaOperationTimings(operations, async () =>
      (input.prisma ?? getPrisma()).$transaction(async (tx) => {
        callbackStartedAtMs = Date.now();
        try {
          const owner = await requireHostedRuntimeCallbackTx(tx, input.userId, input.runtimeAuthority
            ? { ...input.runtimeAuthority, userId: input.userId }
            : null);
          if (owner) await requireRuntimeResourcesPublishableTx(tx, input.userId, snapshotOrphanCandidates(parseHostedExecutionSnapshotRef(input.snapshotRef)));
          const result = await checkpointHostedWorkspaceTx({ ...input, tx });
          if (owner && result.status === "updated") {
            const snapshot = parseHostedExecutionSnapshotRef(input.snapshotRef);
            const candidates = snapshotOrphanCandidates(snapshot);
            const previous = result.replacedSnapshotRef;
            // Only a newly accepted archive with explicit retention evidence earns
            // a recovery window. Reusing an old ref cannot refresh its content age.
            if (input.reason === "idle_shutdown" && isHostedWorkspaceSnapshotV2Ref(snapshot)
              && (!isHostedWorkspaceSnapshotV2Ref(previous) || previous.snapshotId !== snapshot.snapshotId)
              && input.inboxMediaRetentionWakeAt !== undefined) {
              const contentExpiry = input.inboxMediaRetentionWakeAt === null ? Infinity
                : new Date(input.inboxMediaRetentionWakeAt).getTime();
              const recoveryUntil = new Date(Math.min(
                Date.parse(snapshot.createdAt) + HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS,
                contentExpiry,
              ));
              for (const candidate of candidates) candidate.recoveryUntil = recoveryUntil;
            }
            // Status-only checkpoints retain the same archive. Recording its
            // identical cleanup candidate twice adds two serial DB operations.
            // Compare the complete candidate so differing retention or resource
            // metadata still goes through the existing validation and update.
            const replacedCandidates = snapshotOrphanCandidates(result.replacedSnapshotRef ?? null)
              .filter((previous) => !candidates.some((current) => isDeepStrictEqual(current, previous)));
            await recordRuntimeOrphansTx(tx, input.userId, [
              ...candidates,
              ...replacedCandidates,
            ], new Date());
          }
          return result;
        } finally {
          callbackFinishedAtMs = Date.now();
        }
      }),
    );
    completed = true;
    return result;
  } finally {
    const finishedAtMs = Date.now();
    if (finishedAtMs - startedAtMs >= 1_000) {
      try {
        console.info("Hosted workspace slow checkpoint database timing.", {
          completed,
          totalMs: finishedAtMs - startedAtMs,
          transactionAcquireMs: (callbackStartedAtMs ?? finishedAtMs) - startedAtMs,
          transactionCallbackMs: callbackStartedAtMs === null
            ? null
            : (callbackFinishedAtMs ?? finishedAtMs) - callbackStartedAtMs,
          transactionFinishMs: callbackFinishedAtMs === null
            ? null
            : finishedAtMs - callbackFinishedAtMs,
          ...buildHostedWebhookDbTimingLogDetails(operations),
        });
      } catch {
        // Diagnostic output must not change checkpoint success or failure.
      }
    }
  }
}

export async function publishHostedRuntimeBrowserVaultReplica(
  input: Omit<Parameters<typeof publishLatestBrowserVaultReplicaRefTx>[0], "tx"> & RuntimePublication,
) {
  return (input.prisma ?? getPrisma()).$transaction(async (tx) => {
    const owner = await requireHostedRuntimeCallbackTx(tx, input.userId, input.runtimeAuthority
      ? { ...input.runtimeAuthority, userId: input.userId }
      : null);
    const replica = parseHostedBrowserVaultReplicaRef(input.replicaRef);
    if (owner && replica) await requireRuntimeResourcesPublishableTx(tx, input.userId, [replicaOrphanCandidate(replica)]);
    const result = await publishLatestBrowserVaultReplicaRefTx({ ...input, tx });
    if (owner && replica && result.status === "published") await recordRuntimeOrphansTx(tx, input.userId, [replicaOrphanCandidate(replica)], new Date());
    return result;
  });
}
