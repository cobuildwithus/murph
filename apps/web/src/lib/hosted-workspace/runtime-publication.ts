import type { HostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { parseHostedExecutionSnapshotRef, parseHostedBrowserVaultReplicaRef, isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS } from "@murphai/hosted-execution/runtime-resources";
import type { PrismaClient } from "@prisma/client";

import { requireHostedRuntimeCallbackTx } from "../hosted-execution/runtime-owner";
import { requireRuntimeResourcesPublishableTx, recordRuntimeOrphansTx, snapshotOrphanCandidates, replicaOrphanCandidate } from "../hosted-execution/runtime-orphans";
import { getPrisma } from "../prisma";
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
  return (input.prisma ?? getPrisma()).$transaction(async (tx) => {
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
      await recordRuntimeOrphansTx(tx, input.userId, [
        ...candidates,
        ...snapshotOrphanCandidates(result.replacedSnapshotRef ?? null),
      ], new Date());
    }
    return result;
  });
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
