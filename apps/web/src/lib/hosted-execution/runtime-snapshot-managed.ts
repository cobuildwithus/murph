import { Prisma, type HostedRuntimePutDrain } from "@prisma/client";
import {
  HOSTED_RUNTIME_ORPHAN_GRACE_MS, parseHostedRuntimeManagedSnapshotUpload,
  type HostedRuntimeManagedSnapshotCommand, type HostedRuntimeSnapshotResponse,
} from "@murphai/hosted-execution/runtime-resources";
import type { HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { requireRuntimeResourcesPublishableTx } from "./runtime-orphans";

/** The caller holds member admission and has validated the current session.
 * This ledger survives session replacement and is shared with upload recovery.
 * An upload's identity and byte commitment can never be reused or overwritten. */
export async function manageSnapshotUploadTx(input: {
  tx: Prisma.TransactionClient; session: HostedWorkspaceSnapshotUploadSession; now: Date;
  command: Exclude<HostedRuntimeManagedSnapshotCommand, { operation: "snapshot_managed_settled" }>;
}): Promise<HostedRuntimeSnapshotResponse> {
  const { tx, session, command, now } = input;
  const where = { userId_writeId: { userId: session.userId, writeId: `snapshot:${session.snapshotId}` } };
  const existing = await tx.hostedRuntimePutDrain.findUnique({ where });
  const response = (applied: boolean, row: HostedRuntimePutDrain | null = existing): HostedRuntimeSnapshotResponse => ({
    cutover: "postgres", applied, session, managedUpload: projectManagedSnapshotUpload(row),
  });
  if (command.operation === "snapshot_managed_read") return response(!existing?.uploadId || managedUploadBelongsToSession(existing, session));
  if (session.r2PutExpiresAt || Date.parse(session.expiresAt) <= now.getTime()) return response(false);
  if (existing) {
    return response(existing.uploadId !== null && managedUploadBelongsToSession(existing, session)
      && existing.encryptedByteSize === BigInt(command.encryptedByteSize)
      && existing.encryptedSha256 === command.encryptedSha256);
  }
  await requireRuntimeResourcesPublishableTx(tx, session.userId, [{
    kind: "snapshot", resourceId: session.snapshotId, objectKey: session.objectKey, snapshotRef: Prisma.DbNull,
  }]);
  const row = await tx.hostedRuntimePutDrain.create({ data: {
    userId: session.userId, writeId: where.userId_writeId.writeId, kind: "snapshot",
    attemptId: session.attemptId, generation: BigInt(session.leaseGeneration), admittedAt: now,
    objectKey: session.objectKey, uploadId: command.uploadId, encryptedByteSize: BigInt(command.encryptedByteSize),
    encryptedSha256: command.encryptedSha256, reconcileAfter: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS),
  } });
  return response(true, row);
}

function managedUploadBelongsToSession(row: HostedRuntimePutDrain, session: HostedWorkspaceSnapshotUploadSession): boolean {
  return row.objectKey === session.objectKey && row.attemptId === session.attemptId
    && row.generation.toString() === session.leaseGeneration;
}

/** Trusted adapter receipt, including after session replacement or revocation.
 * A release requires exact upload identity; it never retires another upload. */
export async function settleManagedSnapshotUploadTx(input: {
  tx: Prisma.TransactionClient; userId: string; now: Date;
  command: Extract<HostedRuntimeManagedSnapshotCommand, { operation: "snapshot_managed_settled" }>;
}): Promise<HostedRuntimeSnapshotResponse> {
  const { tx, command, userId, now } = input;
  const where = { userId_writeId: { userId, writeId: `snapshot:${command.snapshotId}` } };
  const existing = await tx.hostedRuntimePutDrain.findUnique({ where });
  if (!existing || existing.kind !== "snapshot" || existing.uploadId !== command.uploadId
    || existing.attemptId !== command.attemptId || existing.generation.toString() !== command.generation
    || existing.encryptedSha256 === null) return { cutover: "postgres", applied: false, session: null };
  const row = await tx.hostedRuntimePutDrain.update({ where, data: {
    completedAt: existing.completedAt ?? now,
    ...(command.verified && existing.verifiedAt === null ? { verifiedAt: now } : {}),
  } });
  return { cutover: "postgres", applied: true, session: null, managedUpload: projectManagedSnapshotUpload(row) };
}

function projectManagedSnapshotUpload(row: HostedRuntimePutDrain | null) {
  if (!row?.uploadId || row.encryptedByteSize === null || row.encryptedSha256 === null) return null;
  return parseHostedRuntimeManagedSnapshotUpload({
    userId: row.userId, snapshotId: row.writeId.slice("snapshot:".length), attemptId: row.attemptId,
    generation: row.generation.toString(), uploadId: row.uploadId, objectKey: row.objectKey,
    encryptedByteSize: Number(row.encryptedByteSize), encryptedSha256: row.encryptedSha256,
    completedAt: row.completedAt?.toISOString() ?? null, verifiedAt: row.verifiedAt?.toISOString() ?? null,
  });
}
