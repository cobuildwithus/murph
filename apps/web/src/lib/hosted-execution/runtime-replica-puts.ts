import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { hostedBrowserVaultReplicaUserPrefix, listHostedBrowserVaultReplicaSiblingObjectKeys } from "@murphai/hosted-execution/storage-paths";
import { parseHostedRuntimeReplicaPutCommand, type HostedRuntimeReplicaPutCommand } from "@murphai/hosted-execution/runtime-resources";
import { lockHostedRuntimeCutoverTx, requireHostedRuntimeOwnerTx } from "./runtime-owner";
import { recordRuntimeOrphansTx, requireRuntimeResourcesPublishableTx } from "./runtime-orphans";

export async function executeHostedRuntimeReplicaPutCommand(input: {
  prisma: PrismaClient; userId: string; command: HostedRuntimeReplicaPutCommand; now?: Date;
}): Promise<{ applied: boolean }> {
  const command = parseHostedRuntimeReplicaPutCommand(input.command);
  const now = input.now ?? new Date();
  if (command.operation === "admit") {
    const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId });
    if (!command.objectKey.startsWith(prefix) || command.objectKey.slice(prefix.length).includes("/")) throw new TypeError("Replica PUT namespace mismatch.");
    if (command.multipart && ![command.objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(command.objectKey)].includes(command.multipart.objectKey)) throw new TypeError("Replica upload is outside its root resource.");
  }
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeCutoverTx(tx) !== "postgres") return { applied: false };
    const writeId = `replica:${command.writeId}`;
    const where = { userId_writeId: { userId: input.userId, writeId } };
    if (command.operation === "release") {
      // This acknowledges an exact completed adapter write, including after
      // runtime revocation. A different write identity remains independently held.
      const result = await tx.hostedRuntimePutDrain.updateMany({ where: { userId: input.userId, writeId, kind: "replica", completedAt: null }, data: { completedAt: now } });
      return { applied: result.count === 1 };
    }
    await requireHostedRuntimeOwnerTx(tx, { ...command, userId: input.userId });
    const candidate = { kind: "replica" as const, resourceId: command.objectKey, objectKey: command.objectKey, snapshotRef: Prisma.DbNull };
    await requireRuntimeResourcesPublishableTx(tx, input.userId, [candidate]);
    const existing = await tx.hostedRuntimePutDrain.findUnique({ where });
    // Reusing a write identity must not dispatch another physical PUT whose
    // lifetime could be cleared by the first write's delayed release.
    if (existing) return { applied: false };
    await tx.hostedRuntimePutDrain.create({ data: { userId: input.userId, writeId, kind: "replica", attemptId: command.attemptId, generation: BigInt(command.generation), admittedAt: now,
      ...(command.multipart ? { objectKey: command.multipart.objectKey, uploadId: command.multipart.uploadId,
        reconcileAfter: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } : {}) } });
    await recordRuntimeOrphansTx(tx, input.userId, [candidate], now);
    return { applied: true };
  });
}
