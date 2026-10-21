import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { hostedBrowserVaultReplicaUserPrefix, listHostedBrowserVaultReplicaSiblingObjectKeys } from "@murphai/hosted-execution/storage-paths";
import { parseHostedRuntimeReplicaPutCommand, type HostedRuntimeReplicaPutCommand } from "@murphai/hosted-execution/runtime-resources";
import { requireHostedRuntimeOwnerTx } from "./runtime-owner";
import { recordRuntimeOrphansTx, requireRuntimeResourcesPublishableTx } from "./runtime-orphans";

export async function executeHostedRuntimeReplicaPutCommand(input: {
  prisma: PrismaClient; userId: string; command: HostedRuntimeReplicaPutCommand; now?: Date;
}): Promise<{ applied: boolean }> {
  const command = parseHostedRuntimeReplicaPutCommand(input.command);
  const now = input.now ?? new Date();
  if (command.operation === "admit" || command.operation === "admit_batch") {
    const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId });
    if (!command.objectKey.startsWith(prefix) || command.objectKey.slice(prefix.length).includes("/")) throw new TypeError("Replica PUT namespace mismatch.");
    const uploads = command.operation === "admit_batch" ? command.uploads : command.multipart ? [command.multipart] : [];
    const allowedKeys = uploads.length === 0 ? new Set<string>()
      : new Set([command.objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(command.objectKey)]);
    if (uploads.some(upload => !allowedKeys.has(upload.objectKey))) throw new TypeError("Replica upload is outside its root resource.");
  }
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") return { applied: false };
    if (command.operation === "release" || command.operation === "release_batch") {
      // Only exact completed/confirmed-aborted writes are acknowledged, even
      // after runtime revocation or member deletion. Siblings remain independent.
      const writeIds = (command.operation === "release" ? [command.writeId] : command.writeIds).map(id => `replica:${id}`);
      const result = await tx.hostedRuntimePutDrain.updateMany({ where: { userId: input.userId, writeId: { in: writeIds }, kind: "replica", completedAt: null }, data: { completedAt: now } });
      return { applied: result.count > 0 };
    }
    await requireHostedRuntimeOwnerTx(tx, { ...command, userId: input.userId });
    const candidate = { kind: "replica" as const, resourceId: command.objectKey, objectKey: command.objectKey, snapshotRef: Prisma.DbNull };
    await requireRuntimeResourcesPublishableTx(tx, input.userId, [candidate]);
    const writes = command.operation === "admit_batch" ? command.uploads.map(upload => ({ writeId: upload.writeId, multipart: upload }))
      : [{ writeId: command.writeId, multipart: command.multipart }];
    // Reject the whole batch if any receipt exists. A lost admission response
    // never authorizes a second dispatch under a previously used identity.
    const existing = await tx.hostedRuntimePutDrain.findFirst({ where: { userId: input.userId,
      writeId: { in: writes.map(write => `replica:${write.writeId}`) } }, select: { writeId: true } });
    if (existing) return { applied: false };
    await tx.hostedRuntimePutDrain.createMany({ data: writes.map(write => ({ userId: input.userId, writeId: `replica:${write.writeId}`,
      kind: "replica", attemptId: command.attemptId, generation: BigInt(command.generation), admittedAt: now,
      ...(write.multipart ? { objectKey: write.multipart.objectKey, uploadId: write.multipart.uploadId,
        reconcileAfter: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } : {}) })) });
    await recordRuntimeOrphansTx(tx, input.userId, [candidate], now);
    return { applied: true };
  }, { timeout: 5_000, maxWait: 5_000 });
}
