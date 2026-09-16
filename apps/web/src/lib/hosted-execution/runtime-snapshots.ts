import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { Prisma, type PrismaClient, type HostedRuntimeSnapshotUpload } from "@prisma/client";
import { HOSTED_RUNTIME_ORPHAN_GRACE_MS, type HostedRuntimeSnapshotCommand, type HostedRuntimeSnapshotResponse } from "@murphai/hosted-execution/runtime-resources";
import { HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA, parseHostedWorkspaceSnapshotUploadSession, type HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { parseHostedRuntimeOwnerIdentity } from "@murphai/hosted-execution/runtime-owner";
import { recordRuntimeOrphansTx, snapshotOrphanCandidates } from "./runtime-orphans";
import { requireHostedRuntimeOwnerTx } from "./runtime-owner";
import { manageSnapshotUploadTx, settleManagedSnapshotUploadTx } from "./runtime-snapshot-managed";

/** All session state, ownership, and capability drains commit together. R2 and
 * encryption stay in the Worker before/after these database-only commands.
 */
export async function executeHostedRuntimeSnapshotCommand(input: {
  prisma: PrismaClient; userId: string; command: HostedRuntimeSnapshotCommand; now?: Date;
}): Promise<HostedRuntimeSnapshotResponse> {
  const now = input.now ?? new Date();
  const command = input.command;
  const supplied = command.operation === "snapshot_create" ? command.session
    : "expectedSession" in command ? command.expectedSession : null;
  if (supplied && supplied.userId !== input.userId) throw new TypeError("Runtime snapshot member mismatch.");
  if (supplied && (supplied.encryption.aad.userId !== supplied.userId
    || supplied.encryption.aad.snapshotId !== supplied.snapshotId
    || supplied.encryption.aad.objectKey !== supplied.objectKey)) throw new TypeError("Runtime snapshot encryption identity mismatch.");
  if (supplied && supplied.objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId: supplied.snapshotId })) {
    throw new TypeError("Runtime snapshot namespace mismatch.");
  }
  const identity = supplied
    ? { attemptId: supplied.attemptId, generation: supplied.leaseGeneration, userId: input.userId }
    : { ...command, userId: input.userId };
  const runtimeIdentity = { userId: input.userId, ...parseHostedRuntimeOwnerIdentity(identity) };
  return input.prisma.$transaction(async (tx) => {
    const cutover = await lockHostedRuntimeMemberCutoverTx(tx, input.userId);
    if (cutover !== "postgres") return { cutover, applied: false, session: null };
    if (command.operation === "snapshot_managed_settled") return settleManagedSnapshotUploadTx({ tx, userId: input.userId, command, now });
    await requireHostedRuntimeOwnerTx(tx, runtimeIdentity);
    const current = await tx.hostedRuntimeSnapshotUpload.findUnique({ where: { userId: input.userId } });
    const unchanged = (): HostedRuntimeSnapshotResponse => ({ cutover, applied: false, session: current ? projectSession(current) : null });
    if (command.operation === "snapshot_create") {
      return createSnapshotSessionTx(tx, input.userId, command.session, current, now);
    }
    if (!current || !commandOwnsCurrentSession(current, command, runtimeIdentity)) return unchanged();
    switch (command.operation) {
      case "snapshot_managed_admit":
      case "snapshot_managed_read":
        return manageSnapshotUploadTx({ tx, session: projectSession(current), command, now });
      case "snapshot_read":
        // Expired sessions still identify ambiguous checkpoint recovery. Only
        // final PUT admission grants a fresh capability and checks expiry.
        return { cutover, applied: true, session: projectSession(current) };
      case "snapshot_heartbeat":
      case "snapshot_complete": {
        if (current.completedAt) return { cutover, applied: true, session: projectSession(current) };
        const row = await tx.hostedRuntimeSnapshotUpload.update({ where: { userId: input.userId }, data:
          command.operation === "snapshot_complete" ? { heartbeatAt: now, completedAt: now } : { heartbeatAt: now },
        });
        return { cutover, applied: true, session: projectSession(row) };
      }
      case "snapshot_delete":
        await recordSessionOrphansTx(tx, projectSession(current), now);
        await tx.hostedRuntimeSnapshotUpload.delete({ where: { userId: input.userId } });
        return { cutover, applied: true, session: null };
      case "snapshot_admit_put":
        return admitSnapshotPutTx(tx, current, command, now);
      case "snapshot_record_replaced": {
        const row = await tx.hostedRuntimeSnapshotUpload.update({ where: { userId: input.userId }, data: { replacedSnapshotRef: jsonObject(command.replacedSnapshotRef) } });
        await recordSessionOrphansTx(tx, projectSession(row), now);
        return { cutover, applied: true, session: projectSession(row) };
      }
    }
  });
}

function commandOwnsCurrentSession(current: HostedRuntimeSnapshotUpload, command: Exclude<HostedRuntimeSnapshotCommand, { operation: "snapshot_create" }>, identity: { attemptId: string; generation: string }): boolean {
  const supplied = "expectedSession" in command ? command.expectedSession : null;
  const snapshotId = supplied?.snapshotId ?? ("snapshotId" in command ? command.snapshotId : null);
  return current.snapshotId === snapshotId && current.attemptId === identity.attemptId
    && current.generation.toString() === identity.generation
    && (supplied === null || sameSession(projectSession(current), supplied));
}

async function createSnapshotSessionTx(tx: Prisma.TransactionClient, userId: string, session: HostedWorkspaceSnapshotUploadSession, current: HostedRuntimeSnapshotUpload | null, now: Date): Promise<HostedRuntimeSnapshotResponse> {
  if (Date.parse(session.expiresAt) <= now.getTime()
    || !/^(0|[1-9][0-9]*)$/u.test(session.expectedWorkspaceVersion)
    || session.workspaceVersion !== session.expectedWorkspaceVersion
    || BigInt(session.workspaceVersion) > 9_223_372_036_854_775_807n) {
    throw new TypeError("Runtime snapshot session version or expiry is invalid.");
  }
  if (current?.snapshotId === session.snapshotId) {
    return { cutover: "postgres", applied: sameSession(projectSession(current), session), session: projectSession(current) };
  }
  const retired = await tx.hostedRuntimeOrphan.findUnique({ where: {
    userId_kind_resourceId: { userId, kind: "snapshot", resourceId: session.snapshotId },
  } });
  if (retired?.retiredAt) return { cutover: "postgres", applied: false, session: current ? projectSession(current) : null };
  if (current) await recordSessionOrphansTx(tx, projectSession(current), now);
  const data = {
    snapshotId: session.snapshotId, attemptId: session.attemptId, generation: BigInt(session.leaseGeneration),
    expectedWorkspaceVersion: BigInt(session.expectedWorkspaceVersion), workspaceVersion: BigInt(session.workspaceVersion),
    objectKey: session.objectKey, encryption: jsonObject(session.encryption),
    replacedSnapshotRef: session.replacedSnapshotRef ? jsonObject(session.replacedSnapshotRef) : Prisma.DbNull,
    createdAt: new Date(session.createdAt), expiresAt: new Date(session.expiresAt), heartbeatAt: now,
    completedAt: null, putExpiresAt: null, putDrainUntil: null,
  };
  const row = await tx.hostedRuntimeSnapshotUpload.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await recordSessionOrphansTx(tx, projectSession(row), now);
  return { cutover: "postgres", applied: true, session: projectSession(row) };

}

async function admitSnapshotPutTx(tx: Prisma.TransactionClient, current: HostedRuntimeSnapshotUpload, command: Extract<HostedRuntimeSnapshotCommand, { operation: "snapshot_admit_put" }>, now: Date): Promise<HostedRuntimeSnapshotResponse> {
  const expiresAt = new Date(command.expiresAt);
  const drainUntil = new Date(command.drainUntil);
  if (expiresAt <= now || expiresAt > current.expiresAt || drainUntil < expiresAt
    || drainUntil.getTime() > now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) throw new TypeError("Snapshot capability lifetime is invalid.");
  const writeId = `snapshot:${current.snapshotId}`;
  const previous = await tx.hostedRuntimePutDrain.findUnique({ where: { userId_writeId: { userId: current.userId, writeId } } });
  if (previous?.uploadId) return { cutover: "postgres", applied: false, session: projectSession(current) };
  const retainedDrainUntil = previous?.drainUntil && previous.drainUntil > drainUntil ? previous.drainUntil : drainUntil;
  await tx.hostedRuntimePutDrain.upsert({
    where: { userId_writeId: { userId: current.userId, writeId } },
    create: { userId: current.userId, writeId, kind: "snapshot", attemptId: current.attemptId, generation: current.generation, admittedAt: now, drainUntil: retainedDrainUntil },
    update: { drainUntil: retainedDrainUntil, completedAt: null },
  });
  const row = await tx.hostedRuntimeSnapshotUpload.update({ where: { userId: current.userId }, data: { putExpiresAt: expiresAt, putDrainUntil: drainUntil } });
  return { cutover: "postgres", applied: true, session: projectSession(row) };

}

function projectSession(row: HostedRuntimeSnapshotUpload): HostedWorkspaceSnapshotUploadSession {
  return parseHostedWorkspaceSnapshotUploadSession({
    schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA, userId: row.userId,
    snapshotId: row.snapshotId, attemptId: row.attemptId, leaseGeneration: row.generation.toString(),
    expectedWorkspaceVersion: row.expectedWorkspaceVersion.toString(), workspaceVersion: row.workspaceVersion.toString(),
    objectKey: row.objectKey, encryption: row.encryption, replacedSnapshotRef: row.replacedSnapshotRef,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    checkpointHandoffHeartbeatAt: row.heartbeatAt.toISOString(),
    ...(row.completedAt ? { checkpointHandoffCompletedAt: row.completedAt.toISOString() } : {}),
    ...(row.putExpiresAt ? { r2PutExpiresAt: row.putExpiresAt.toISOString() } : {}),
    ...(row.putDrainUntil ? { r2PutDrainUntil: row.putDrainUntil.toISOString() } : {}),
  });
}

function sameSession(left: HostedWorkspaceSnapshotUploadSession, right: HostedWorkspaceSnapshotUploadSession): boolean {
  const clientFields = (session: HostedWorkspaceSnapshotUploadSession) => {
    const { checkpointHandoffCompletedAt: _completed, checkpointHandoffHeartbeatAt: _heartbeat, ...fields } = parseHostedWorkspaceSnapshotUploadSession({ ...session, replacedSnapshotRef: session.replacedSnapshotRef ?? null });
    return fields;
  };
  return JSON.stringify(clientFields(left)) === JSON.stringify(clientFields(right));
}

async function recordSessionOrphansTx(tx: Prisma.TransactionClient, session: HostedWorkspaceSnapshotUploadSession, now: Date) {
  await recordRuntimeOrphansTx(tx, session.userId, [{ kind: "snapshot", resourceId: session.snapshotId, objectKey: session.objectKey, snapshotRef: Prisma.DbNull }], now);
  const ref = session.replacedSnapshotRef;
  if (!ref) return;
  if (isHostedWorkspaceSnapshotV2Ref(ref) && (ref.userId !== session.userId || ref.encryption.aad.userId !== session.userId
    || ref.encryption.aad.snapshotId !== ref.snapshotId || ref.encryption.aad.objectKey !== ref.objectKey)) {
    throw new TypeError("Replaced snapshot encryption identity mismatch.");
  }
  await recordRuntimeOrphansTx(tx, session.userId, snapshotOrphanCandidates(ref), now);
}

function jsonObject(value: object): Prisma.InputJsonObject {
  // Parsed protocol objects contain JSON fields only; round-trip removes
  // optional undefined properties before Prisma receives the JSON object.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
