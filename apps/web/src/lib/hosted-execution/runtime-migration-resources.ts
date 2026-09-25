import { Prisma } from "@prisma/client";
import type { LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import { parseHostedRuntimeMediaDescriptor } from "@murphai/hosted-execution/runtime-media";
import { hostedBrowserVaultReplicaUserPrefix, hostedMediaObjectKey, hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotOrphanCandidate, parseHostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { recordRuntimeOrphansTx, snapshotOrphanCandidates } from "./runtime-orphans";

type Orphan = Parameters<typeof recordRuntimeOrphansTx>[2][number];
export interface LegacyMigrationResources {
  media: Prisma.HostedRuntimeMediaCreateManyInput[];
  sessions: Prisma.HostedRuntimeSnapshotUploadCreateManyInput[];
  orphans: Orphan[];
}

/** Parse and derive storage namespaces outside the short import transaction. */
export async function prepareLegacyMigrationResources(page: LegacyRuntimeExportPage): Promise<LegacyMigrationResources> {
  const result: LegacyMigrationResources = { media: [], sessions: [], orphans: [] };
  if (!page.userId && page.records.length) throw new TypeError("Legacy resources require a member identity.");
  for (const record of page.records) {
    const userId = page.userId!;
    if (record.kind === "media") {
      result.media.push(await prepareMedia(userId, record));
    } else if (record.key === "workspace-snapshot-upload-session:current") {
      await prepareSession(userId, record.value, result);
    } else if (record.key.startsWith("workspace-snapshot-orphan-candidate:")) {
      const candidate = parseHostedWorkspaceSnapshotOrphanCandidate(record.value);
      if (candidate.userId !== userId) throw new TypeError("Legacy snapshot member mismatch.");
      if (candidate.kind === "legacy_workspace_snapshot") result.orphans.push(...snapshotOrphanCandidates(candidate.snapshotRef));
      else {
        await requireSnapshotKey(userId, candidate.snapshotId, candidate.objectKey);
        result.orphans.push({ kind: "snapshot", resourceId: candidate.snapshotId, objectKey: candidate.objectKey, snapshotRef: Prisma.DbNull });
      }
    } else if (record.key.startsWith("browser-vault-replica-orphan-candidate:")) {
      result.orphans.push(await prepareReplica(userId, record.value));
    } else throw new TypeError("Legacy resource kind is not supported.");
  }
  return result;
}

async function prepareMedia(userId: string, record: LegacyRuntimeExportPage["records"][number]): Promise<Prisma.HostedRuntimeMediaCreateManyInput> {
  const row = record.value;
  const descriptor = parseHostedRuntimeMediaDescriptor({ mediaId: row.media_id, mediaKind: row.media_kind,
    byteSize: row.byte_size, sha256: row.sha256, expiresAt: row.expires_at });
  if (row.user_id !== userId || record.key !== descriptor.mediaId
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new TypeError("Legacy media identity is invalid.");
  const objectKey = await hostedMediaObjectKey({ userId, mediaId: descriptor.mediaId });
  if (objectKey !== row.object_key) throw new TypeError("Legacy media namespace mismatch.");
  const retiredAt = optionalDate(row.retired_at);
  const purgedAt = optionalDate(row.purged_at);
  if (purgedAt && !retiredAt) throw new TypeError("Purged legacy media must retain its retirement.");
  return { ...descriptor, userId, objectKey, byteSize: BigInt(descriptor.byteSize),
    expiresAt: optionalDate(descriptor.expiresAt), retiredAt, purgedAt,
    revision: BigInt(Math.max(1, row.revision)), updatedAt: requiredDate(row.updated_at) };
}

async function prepareSession(userId: string, value: unknown, result: LegacyMigrationResources): Promise<void> {
  const session = parseHostedWorkspaceSnapshotUploadSession(value);
  if (session.userId !== userId || session.encryption.aad.userId !== userId
    || session.encryption.aad.snapshotId !== session.snapshotId || session.encryption.aad.objectKey !== session.objectKey) throw new TypeError("Legacy snapshot session identity mismatch.");
  await requireSnapshotKey(userId, session.snapshotId, session.objectKey);
  if (session.r2PutDrainUntil && requiredDate(session.r2PutDrainUntil) > new Date()) throw new TypeError("Legacy snapshot PUT has not drained.");
  const replaced = session.replacedSnapshotRef;
  if (replaced && isHostedWorkspaceSnapshotV2Ref(replaced)) {
    if (replaced.userId !== userId || replaced.encryption.aad.userId !== userId) throw new TypeError("Legacy replaced snapshot member mismatch.");
    await requireSnapshotKey(userId, replaced.snapshotId, replaced.objectKey);
  }
  result.orphans.push({ kind: "snapshot", resourceId: session.snapshotId, objectKey: session.objectKey, snapshotRef: Prisma.DbNull });
  if (replaced) result.orphans.push(...snapshotOrphanCandidates(replaced));
  result.sessions.push({ userId, snapshotId: session.snapshotId, attemptId: session.attemptId,
    generation: integerString(session.leaseGeneration), expectedWorkspaceVersion: integerString(session.expectedWorkspaceVersion),
    workspaceVersion: integerString(session.workspaceVersion), objectKey: session.objectKey,
    encryption: jsonObject(session.encryption), replacedSnapshotRef: replaced ? jsonObject(replaced) : Prisma.DbNull,
    createdAt: requiredDate(session.createdAt), expiresAt: requiredDate(session.expiresAt),
    heartbeatAt: requiredDate(session.checkpointHandoffHeartbeatAt ?? session.createdAt),
    completedAt: optionalDate(session.checkpointHandoffCompletedAt ?? null),
    putExpiresAt: optionalDate(session.r2PutExpiresAt ?? null), putDrainUntil: optionalDate(session.r2PutDrainUntil ?? null) });
}
async function prepareReplica(userId: string, value: Record<string, unknown>): Promise<Orphan> {
  if (value.schema !== "murph.hosted-browser-vault-replica-orphan-candidate.v1" || value.userId !== userId
    || typeof value.objectKey !== "string") throw new TypeError("Legacy replica identity is invalid.");
  requiredDate(value.createdAt);
  const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId });
  if (!value.objectKey.startsWith(prefix) || value.objectKey.slice(prefix.length).includes("/")) throw new TypeError("Legacy replica namespace mismatch.");
  return { kind: "replica", resourceId: value.objectKey, objectKey: value.objectKey, snapshotRef: Prisma.DbNull };
}
async function requireSnapshotKey(userId: string, snapshotId: string, objectKey: string): Promise<void> {
  if (objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId })) throw new TypeError("Legacy snapshot namespace mismatch.");
}
function requiredDate(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError("Legacy resource timestamp is invalid.");
  return new Date(value);
}
function optionalDate(value: unknown): Date | null { return value === null ? null : requiredDate(value); }
function integerString(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) throw new TypeError("Legacy resource generation is invalid.");
  return BigInt(value);
}
function jsonObject(value: object): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject; }
