import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import type { HostedRuntimeMedia, PrismaClient, Prisma } from "@prisma/client";
import { hostedMediaObjectKey, hostedPrivateMediaObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedRuntimeMediaCommand, type HostedRuntimeMediaCommand, type HostedRuntimeMediaPurge, type HostedRuntimeMediaResponse } from "@murphai/hosted-execution/runtime-media";
import { lockHostedRuntimeCutoverTx, requireHostedRuntimeOwnerTx } from "./runtime-owner";

/** Retirement is terminal. External deletion happens after this transaction;
 * its acknowledgement is conditional on the exact metadata revision. */
export async function executeHostedRuntimeMediaCommand(input: {
  prisma: PrismaClient; userId: string; command: HostedRuntimeMediaCommand; now?: Date;
}): Promise<HostedRuntimeMediaResponse> {
  const command = parseHostedRuntimeMediaCommand(input.command);
  const now = input.now ?? new Date();
  const mediaId = "sha256" in command ? command.sha256 : "descriptor" in command ? command.descriptor.mediaId : "purge" in command ? command.purge.mediaId : command.mediaId;
  const isPrivate = command.operation === "admit_private_put" || command.operation === "release_put" && command.scope === "private_media";
  const objectKey = isPrivate ? await hostedPrivateMediaObjectKey({ userId: input.userId, sha256: mediaId })
    : await hostedMediaObjectKey({ userId: input.userId, mediaId });
  return input.prisma.$transaction(async (tx) => {
    const cutover = await lockHostedRuntimeCutoverTx(tx);
    const result = (applied: boolean, reason: HostedRuntimeMediaResponse["reason"] = null, purge: HostedRuntimeMediaPurge | null = null): HostedRuntimeMediaResponse => ({ cutover, applied, reason, purge });
    if (cutover !== "postgres") return result(false);
    if (command.operation === "register" || command.operation === "retire" || command.operation === "admit_put" || command.operation === "admit_private_put") await requireHostedRuntimeOwnerTx(tx, { ...command, userId: input.userId });
    // Also serialize reads/cleanup for resource-only members whose account row
    // has already been deleted. No account FK owns this cleanup obligation.
    await lockHostedRuntimeMediaTx(tx, input.userId, mediaId);
    return executeMediaCommandTx({ tx, userId: input.userId, mediaId, objectKey, now }, command);

  });
}

type MediaTransaction = { tx: Prisma.TransactionClient; userId: string; mediaId: string; objectKey: string; now: Date };
function mediaResult(applied: boolean, reason: HostedRuntimeMediaResponse["reason"] = null, purge: HostedRuntimeMediaPurge | null = null): HostedRuntimeMediaResponse {
  return { cutover: "postgres", applied, reason, purge };
}

async function executeMediaCommandTx(input: MediaTransaction, command: HostedRuntimeMediaCommand): Promise<HostedRuntimeMediaResponse> {
  const { tx, userId, mediaId, now } = input;
  const where = { userId_mediaId: { userId, mediaId } };
  const row = await tx.hostedRuntimeMedia.findUnique({ where });
  switch (command.operation) {
    case "release_put": {
      const released = await tx.hostedRuntimePutDrain.updateMany({ where: {
        userId, kind: command.scope ?? "media", writeId: mediaPutWriteId(mediaId, command.writeId, command.scope), completedAt: null,
      }, data: { completedAt: now } });
      return mediaResult(released.count === 1);
    }
    case "admit_put":
      return admitMediaPutTx(input, command, row);
    case "admit_private_put": {
      const writeId = mediaPutWriteId(mediaId, command.writeId, "private_media");
      await tx.hostedRuntimePutDrain.create({ data: { userId, writeId, kind: "private_media",
        attemptId: command.attemptId, generation: BigInt(command.generation), admittedAt: now,
        objectKey: input.objectKey, uploadId: command.uploadId, reconcileAfter: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } });
      // The existing private-media bucket lifecycle owns its 24-hour lifetime.
      // This row tracks only the physical upload for account-deletion fencing.
      return mediaResult(true);
    }
    case "acknowledge_purge": {
      const updated = await tx.hostedRuntimeMedia.updateMany({ where: {
        userId, mediaId, objectKey: command.purge.objectKey,
        revision: BigInt(command.purge.revision), retiredAt: { not: null }, purgedAt: null,
      }, data: { purgedAt: now } });
      return mediaResult(updated.count === 1);
    }
    case "register":
      return registerMediaTx(input, command, row);
    case "read":
    case "retire":
      return readOrRetireMediaTx(input, command, row);
  }
}

async function admitMediaPutTx(input: MediaTransaction, command: Extract<HostedRuntimeMediaCommand, { operation: "admit_put" }>, row: HostedRuntimeMedia | null) {
  const { tx, userId, mediaId, objectKey, now } = input;
  if (row?.retiredAt) return mediaResult(false, "expired");
  const writeId = mediaPutWriteId(mediaId, command.writeId);
  if (await tx.hostedRuntimePutDrain.findUnique({ where: { userId_writeId: { userId, writeId } } })) return mediaResult(false);
  await tx.hostedRuntimePutDrain.create({ data: { userId, writeId, kind: "media",
    attemptId: command.attemptId, generation: BigInt(command.generation), admittedAt: now,
    objectKey, uploadId: command.uploadId, reconcileAfter: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } });
  if (!row) {
    const descriptor = command.descriptor;
    // An interrupted first upload expires; its independent drain prevents
    // deletion while the write may still be in flight.
    await tx.hostedRuntimeMedia.create({ data: { userId, mediaId, objectKey,
      mediaKind: descriptor.mediaKind, sha256: descriptor.sha256, byteSize: BigInt(descriptor.byteSize),
      expiresAt: new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } });
  }
  return mediaResult(true);
}

async function registerMediaTx(input: MediaTransaction, command: Extract<HostedRuntimeMediaCommand, { operation: "register" }>, row: HostedRuntimeMedia | null) {
  const { tx, userId, mediaId, objectKey, now } = input;
  const where = { userId_mediaId: { userId, mediaId } };
  if (row?.retiredAt) {
    const rearmed = await tx.hostedRuntimeMedia.update({ where, data: { purgedAt: null, revision: { increment: 1 } } });
    return mediaResult(false, "expired", await hasPendingRuntimeMediaPutTx(tx, userId, mediaId, now) ? null : purgeReceipt(rearmed));
  }
  const descriptor = command.descriptor;
  const candidateExpiry = descriptor.expiresAt === null ? null : new Date(descriptor.expiresAt);
  const expiresAt = candidateExpiry === null ? null : row?.expiresAt && row.expiresAt < candidateExpiry ? row.expiresAt : candidateExpiry;
  const data = { mediaKind: descriptor.mediaKind, byteSize: BigInt(descriptor.byteSize), sha256: descriptor.sha256, objectKey, expiresAt };
  await tx.hostedRuntimeMedia.upsert({ where, create: { userId, mediaId, ...data }, update: { ...data, revision: { increment: 1 } } });
  return mediaResult(true);
}

async function readOrRetireMediaTx(input: MediaTransaction, command: Extract<HostedRuntimeMediaCommand, { operation: "read" | "retire" }>, row: HostedRuntimeMedia | null) {
  const { tx, userId, mediaId, now } = input;
  if (!row) return mediaResult(command.operation === "read", command.operation === "read" ? "unregistered" : null);
  if (command.operation === "read") {
    const descriptor = command.descriptor;
    if (row.byteSize !== BigInt(descriptor.byteSize) || row.mediaKind !== descriptor.mediaKind || row.sha256 !== descriptor.sha256) return mediaResult(false, "descriptor_mismatch");
    if (!row.retiredAt && (row.expiresAt === null || row.expiresAt > now)) return mediaResult(true, "active");
  }
  if (!row.retiredAt) row = await tx.hostedRuntimeMedia.update({ where: { userId_mediaId: { userId, mediaId } },
    data: { retiredAt: now, expiresAt: row.expiresAt && row.expiresAt < now ? row.expiresAt : now } });
  return mediaResult(command.operation === "retire", "expired", row.purgedAt || await hasPendingRuntimeMediaPutTx(tx, userId, mediaId, now) ? null : purgeReceipt(row));
}

export async function lockHostedRuntimeMediaTx(tx: Prisma.TransactionClient, userId: string, mediaId: string): Promise<void> {
  // Transaction-scoped lock includes identities with no row yet. Hash collisions
  // only serialize unrelated resources; they cannot grant access to either.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["runtime-media", userId, mediaId])}, 0))::text`;
}

export function purgeReceipt(row: HostedRuntimeMedia): HostedRuntimeMediaPurge {
  return { mediaId: row.mediaId, objectKey: row.objectKey, revision: row.revision.toString() };
}

function mediaPutWriteId(mediaId: string, writeId: string, scope = "media"): string {
  return `${scope}:${mediaId}:${writeId}`;
}

export async function hasPendingRuntimeMediaPutTx(tx: Prisma.TransactionClient, userId: string, mediaId: string, now: Date): Promise<boolean> {
  return await tx.hostedRuntimePutDrain.findFirst({ where: {
    userId, kind: "media", writeId: { startsWith: `media:${mediaId}:` }, completedAt: null,
    OR: [{ drainUntil: null }, { drainUntil: { gt: now } }],
  }, select: { writeId: true } }) !== null;
}
