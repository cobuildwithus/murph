import { reconcileHostedRuntimeUploads } from "./runtime-upload-recovery";
import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { readHostedExecutionControlClientIfConfigured } from "./control";
import { Prisma, type HostedRuntimeOrphan, type PrismaClient } from "@prisma/client";
import { parseHostedBrowserVaultReplicaRef, parseHostedExecutionSnapshotRef } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { lockHostedRuntimeOwnerRowTx } from "./runtime-owner";
import { hostedRuntimePostgresResourceScopeSql, lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { snapshotOrphanCandidates, replicaOrphanCandidate } from "./runtime-orphans";
import { executeHostedRuntimeMediaCommand, hasPendingRuntimeMediaPutTx, lockHostedRuntimeMediaTx, purgeReceipt } from "./runtime-media";
import type { HostedRuntimeMediaPurge } from "@murphai/hosted-execution/runtime-media";

const RESOURCE_CLEANUP_BATCH_SIZE = 50;

/** Existing retention owns scheduling. These bounded claims commit terminal
 * retirement before the caller performs any external R2 deletion. */
export async function claimHostedRuntimeResourceCleanup(input: { prisma: PrismaClient; now: Date; deadlineAtMs?: number }): Promise<{
  orphans: HostedRuntimeOrphan[];
  media: Array<HostedRuntimeMediaPurge & { userId: string }>;
}> {
  const orphans: HostedRuntimeOrphan[] = [];
  const media: Array<HostedRuntimeMediaPurge & { userId: string }> = [];
  const candidates = await input.prisma.$queryRaw<Array<{ userId: string; kind: string; resourceId: string }>>`
    SELECT resource.user_id AS "userId", resource.kind, resource.resource_id AS "resourceId"
    FROM hosted_runtime_orphan AS resource
    WHERE resource.purged_at IS NULL AND resource.cleanup_at <= ${input.now}
      AND ${hostedRuntimePostgresResourceScopeSql(Prisma.sql`resource.user_id`)}
    ORDER BY resource.cleanup_at, resource.user_id, resource.kind, resource.resource_id
    LIMIT ${RESOURCE_CLEANUP_BATCH_SIZE}
  `;
  for (const candidate of candidates) {
    if (Date.now() >= (input.deadlineAtMs ?? Infinity)) break;
    const row = await input.prisma.$transaction(async tx => {
      if (await lockHostedRuntimeMemberCutoverTx(tx, candidate.userId) !== "postgres") return null;
      await lockHostedMemberRow(tx, candidate.userId);
      await lockHostedRuntimeOwnerRowTx(tx, candidate.userId);
      const where = { userId_kind_resourceId: candidate };
      const current = await tx.hostedRuntimeOrphan.findUnique({ where });
      if (!current || current.purgedAt || current.cleanupAt > input.now) return null;
      const workspace = await tx.hostedWorkspace.findUnique({ where: { userId: candidate.userId }, select: { snapshotRef: true, browserVaultReplicaRef: true } });
      const canonical = snapshotOrphanCandidates(parseHostedExecutionSnapshotRef(workspace?.snapshotRef ?? null));
      const replica = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null);
      if (replica) canonical.push(replicaOrphanCandidate(replica));
      const protectedRef = canonical.some(ref => ref.kind === candidate.kind && ref.resourceId === candidate.resourceId);
      const pendingPut = await tx.hostedRuntimePutDrain.findFirst({ where: { userId: candidate.userId, completedAt: null, OR: [{ drainUntil: null }, { drainUntil: { gt: input.now } }] }, select: { writeId: true } });
      const handoff = await tx.hostedRuntimeSnapshotUpload.findUnique({ where: { userId: candidate.userId } });
      const pendingHandoff = candidate.kind === "snapshot" && candidate.resourceId === handoff?.snapshotId
        && !handoff.completedAt && handoff.heartbeatAt.getTime() + 10_000 > input.now.getTime();
      if (protectedRef || pendingPut || pendingHandoff) {
        // Revisit through the existing bounded sweep without starving later rows.
        await tx.hostedRuntimeOrphan.update({ where, data: { cleanupAt: new Date(input.now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS) } });
        return null;
      }
      return current.retiredAt ? current : tx.hostedRuntimeOrphan.update({ where, data: { retiredAt: input.now } });
    });
    if (row) orphans.push(row);
  }
  if (Date.now() >= (input.deadlineAtMs ?? Infinity)) return { orphans, media };
  const expiredMedia = await input.prisma.$queryRaw<Array<{ userId: string; mediaId: string }>>`
    SELECT resource.user_id AS "userId", resource.media_id AS "mediaId"
    FROM hosted_runtime_media AS resource
    WHERE resource.purged_at IS NULL AND resource.expires_at <= ${input.now}
      AND (resource.retired_at IS NULL OR resource.updated_at <= ${new Date(input.now.getTime() - 60_000)})
      AND ${hostedRuntimePostgresResourceScopeSql(Prisma.sql`resource.user_id`)}
    ORDER BY resource.expires_at, resource.user_id, resource.media_id
    LIMIT ${RESOURCE_CLEANUP_BATCH_SIZE}
  `;
  for (const candidate of expiredMedia) {
    if (Date.now() >= (input.deadlineAtMs ?? Infinity)) break;
    const row = await input.prisma.$transaction(async tx => {
      if (await lockHostedRuntimeMemberCutoverTx(tx, candidate.userId) !== "postgres") return null;
      await lockHostedRuntimeMediaTx(tx, candidate.userId, candidate.mediaId);
      const where = { userId_mediaId: candidate };
      const current = await tx.hostedRuntimeMedia.findUnique({ where });
      if (!current || current.purgedAt || !current.expiresAt || current.expiresAt > input.now) return null;
      // The existing metadata timestamp paces retries without changing the
      // product expiry. Failed old rows cannot monopolize every bounded sweep.
      if (current.retiredAt && current.updatedAt.getTime() + 60_000 > input.now.getTime()) return null;
      const retired = await tx.hostedRuntimeMedia.update({ where, data: { retiredAt: current.retiredAt ?? input.now, updatedAt: input.now } });
      return await hasPendingRuntimeMediaPutTx(tx, candidate.userId, candidate.mediaId, input.now) ? null : retired;
    });
    if (row) media.push({ userId: row.userId, ...purgeReceipt(row) });
  }
  return { orphans, media };
}

export async function acknowledgeHostedRuntimeOrphanPurge(input: { prisma: PrismaClient; orphan: HostedRuntimeOrphan; now: Date }): Promise<boolean> {
  const { userId, kind, resourceId, revision } = input.orphan;
  const result = await input.prisma.hostedRuntimeOrphan.updateMany({ where: { userId, kind, resourceId, revision, retiredAt: { not: null }, purgedAt: null }, data: { purgedAt: input.now } });
  return result.count === 1;
}

export async function runHostedRuntimeResourceCleanup(input: { prisma: PrismaClient; now: Date }): Promise<{ configured: boolean; deleted: number; failed: number }> {
  const client = readHostedExecutionControlClientIfConfigured(5_000);
  if (!client) return { configured: false, deleted: 0, failed: 0 };
  const deadline = Date.now() + 25_000;
  await reconcileHostedRuntimeUploads({ ...input, deadlineAtMs: deadline });
  const claimed = await claimHostedRuntimeResourceCleanup({ ...input, deadlineAtMs: deadline });
  let deleted = 0;
  let failed = 0;
  for (const orphan of claimed.orphans) {
    if (Date.now() >= deadline) break;
    try {
      await client.purgeRuntimeResource({ userId: orphan.userId, resource: parseHostedRuntimeResourcePurge(orphan) });
      if (await acknowledgeHostedRuntimeOrphanPurge({ ...input, orphan })) deleted += 1;
    } catch {
      failed += 1;
      // Avoid one unavailable resource monopolizing a bounded sweep.
      await input.prisma.hostedRuntimeOrphan.updateMany({ where: { userId: orphan.userId, kind: orphan.kind, resourceId: orphan.resourceId, revision: orphan.revision, purgedAt: null }, data: { cleanupAt: new Date(input.now.getTime() + 60_000) } });
    }
  }
  for (const purge of claimed.media) {
    if (Date.now() >= deadline) break;
    try {
      await client.purgeRuntimeResource({ userId: purge.userId, resource: { kind: "media", objectKey: purge.objectKey } });
      if ((await executeHostedRuntimeMediaCommand({ ...input, userId: purge.userId, command: { operation: "acknowledge_purge", purge } })).applied) deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { configured: true, deleted, failed };
}
