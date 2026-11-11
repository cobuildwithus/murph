import { createHash } from "node:crypto";
import { readCloudflareHostedControlHttpError } from "@murphai/cloudflare-hosted-control/client";
import { reconcileHostedRuntimeUploads } from "./runtime-upload-recovery";
import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { readHostedExecutionControlClientIfConfigured } from "./control";
import { Prisma, type HostedRuntimeOrphan, type PrismaClient } from "@prisma/client";
import { parseHostedBrowserVaultReplicaRef, parseHostedExecutionSnapshotRef } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { lockHostedRuntimeOwnerRowTx } from "./runtime-owner";
import { snapshotOrphanCandidates, replicaOrphanCandidate } from "./runtime-orphans";
import { executeHostedRuntimeMediaCommand, hasPendingRuntimeMediaPutTx, lockHostedRuntimeMediaTx, purgeReceipt } from "./runtime-media";
import type { HostedRuntimeMediaPurge } from "@murphai/hosted-execution/runtime-media";

const RESOURCE_CLEANUP_BATCH_SIZE = 50;

type CleanupResourceKind = "snapshot" | "replica" | "legacy_snapshot" | "media" | "unknown";
type CleanupFailureStage = "parse" | "purge" | "acknowledge";
type CleanupErrorCategory = "timeout" | "abort" | "http" | "validation" | "database" | "other";

function classifyCleanupError(error: unknown, stage: CleanupFailureStage): { errorCategory: CleanupErrorCategory; httpStatus?: number } {
  if (typeof error !== "object" || error === null) return { errorCategory: "other" };
  const prototype: object | null = Object.getPrototypeOf(error);
  // The public predicate reads code/status. Give it only inert own data
  // properties, preserving the prototype for its real HTTP-error check.
  const http = readCloudflareHostedControlHttpError(Object.create(prototype, {
    code: { value: undefined },
    status: { value: Object.getOwnPropertyDescriptor(error, "status")?.value },
  }));
  if (http) return Number.isInteger(http.status) && http.status >= 100 && http.status <= 599
    ? { errorCategory: "http", httpStatus: http.status } : { errorCategory: "http" };
  const descriptor = Object.getOwnPropertyDescriptor(error, "name") ?? (prototype && Object.getOwnPropertyDescriptor(prototype, "name"));
  const errorCategory = new Map<unknown, CleanupErrorCategory>([
    ["TimeoutError", "timeout"], ["AbortError", "abort"],
    // A fetch TypeError is not evidence of a validation failure.
    ["TypeError", stage === "parse" ? "validation" : "other"],
    ["PrismaClientValidationError", "validation"],
    ["PrismaClientKnownRequestError", "database"], ["PrismaClientUnknownRequestError", "database"],
    ["PrismaClientInitializationError", "database"], ["PrismaClientRustPanicError", "database"],
  ]).get(descriptor?.value) ?? "other";
  if (errorCategory !== "other" || typeof DOMException === "undefined" || !(error instanceof DOMException)) return { errorCategory };
  // Native fetch aborts have accessor-backed names. This intrinsic is
  // brand-checked; it never invokes the input's name/code getters.
  const code: unknown = Object.getOwnPropertyDescriptor(DOMException.prototype, "code")?.get?.call(error);
  return { errorCategory: new Map<unknown, CleanupErrorCategory>([
    [DOMException.ABORT_ERR, "abort"], [DOMException.TIMEOUT_ERR, "timeout"],
  ]).get(code) ?? "other" };
}

function warnHostedRuntimeResourceCleanupFailure(resource: HostedRuntimeOrphan | "media", stage: CleanupFailureStage, error: unknown): void {
  const diagnostic: { resourceKind: CleanupResourceKind; stage: CleanupFailureStage; errorCategory: CleanupErrorCategory; httpStatus?: number; resourceFingerprint?: string } = {
    resourceKind: "unknown", stage, errorCategory: "other",
  };
  try {
    const kind: unknown = resource === "media" ? "media" : Object.getOwnPropertyDescriptor(resource, "kind")?.value;
    diagnostic.resourceKind = new Map<unknown, CleanupResourceKind>([
      ["snapshot", "snapshot"], ["replica", "replica"], ["legacy_snapshot", "legacy_snapshot"], ["media", "media"],
    ]).get(kind) ?? "unknown";
    if (kind === "snapshot" || kind === "replica" || kind === "legacy_snapshot") {
      const userId: unknown = Object.getOwnPropertyDescriptor(resource, "userId")?.value;
      const resourceId: unknown = Object.getOwnPropertyDescriptor(resource, "resourceId")?.value;
      const revision: unknown = Object.getOwnPropertyDescriptor(resource, "revision")?.value;
      if (typeof userId === "string" && userId.length > 0
        && typeof resourceId === "string" && resourceId.length > 0
        && typeof revision === "bigint" && revision > 0n) {
        // Read-only joins: SHA-256 of UTF-8 JSON.stringify([domain, userId,
        // kind, resourceId, decimal revision]); domain is the literal below.
        diagnostic.resourceFingerprint = createHash("sha256").update(JSON.stringify([
          "murph.runtime-resource-cleanup.orphan.v1", userId, kind, resourceId, String(revision),
        ]), "utf8").digest("hex");
      }
    }
  } catch { /* Resource inspection/hashing is optional, including for proxies. */ }
  try {
    Object.assign(diagnostic, classifyCleanupError(error, stage));
  } catch { /* Hostile reflection/predicate inputs must not affect cleanup. */ }
  try {
    console.warn("Hosted runtime resource cleanup failed.", diagnostic);
  } catch { /* A failed warning must not prevent acknowledgement/requeue. */ }
}

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
    FROM (
      SELECT user_id, kind, resource_id, cleanup_at FROM hosted_runtime_orphan
      WHERE purged_at IS NULL AND cleanup_at <= ${input.now}
      UNION ALL
      SELECT user_id, 'game_recap' AS kind, resource_id, cleanup_at FROM game_recap_asset
      WHERE purged_at IS NULL AND cleanup_at <= ${input.now}
        AND (retired_at IS NOT NULL OR recovery_until <= ${input.now})
    ) AS resource
    ORDER BY resource.cleanup_at, resource.user_id, resource.kind, resource.resource_id
    LIMIT ${RESOURCE_CLEANUP_BATCH_SIZE}
  `;
  for (const candidate of candidates) {
    if (Date.now() >= (input.deadlineAtMs ?? Infinity)) break;
    const row = await input.prisma.$transaction(async tx => {
      await lockHostedMemberRow(tx, candidate.userId);
      await lockHostedRuntimeOwnerRowTx(tx, candidate.userId);
      if (candidate.kind === "game_recap") {
        const { userId, resourceId } = candidate;
        const where = { userId_resourceId: { userId, resourceId } };
        const current = await tx.gameRecapAsset.findUnique({ where });
        if (!current || current.purgedAt || current.cleanupAt > input.now) return null;
        if (!current.retiredAt) {
          if (!current.recoveryUntil || current.recoveryUntil > input.now) return null;
          const changed = await tx.gameRecapAsset.updateMany({ where: { userId, resourceId, revision: current.revision, retiredAt: null, recoveryUntil: { lte: input.now } },
            data: { retiredAt: input.now, revision: { increment: 1 } } });
          if (!changed.count) return null;
        }
        const retired = await tx.gameRecapAsset.findUniqueOrThrow({ where });
        return { ...retired, kind: "game_recap", snapshotRef: null };
      }
      const where = { userId_kind_resourceId: candidate };
      const current = await tx.hostedRuntimeOrphan.findUnique({ where });
      if (!current || current.purgedAt || current.cleanupAt > input.now) return null;
      const workspace = await tx.hostedWorkspace.findUnique({ where: { userId: candidate.userId }, select: { snapshotRef: true, browserVaultReplicaRef: true } });
      const canonical = snapshotOrphanCandidates(parseHostedExecutionSnapshotRef(workspace?.snapshotRef ?? null));
      const replica = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null);
      if (replica) canonical.push(replicaOrphanCandidate(replica));
      const protectedRef = canonical.some(ref => ref.kind === candidate.kind && ref.resourceId === candidate.resourceId);
      const pendingPut = await tx.hostedRuntimePutDrain.findFirst({ where: { userId: candidate.userId, completedAt: null, OR: [{ drainUntil: null }, { drainUntil: { gt: input.now } }] }, select: { writeId: true } });
      // Upload receipts protect writes in flight; canonical refs protect accepted
      // archives. Publication holds these same locks and rejects retired refs.
      if (protectedRef || pendingPut) {
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
    ORDER BY resource.expires_at, resource.user_id, resource.media_id
    LIMIT ${RESOURCE_CLEANUP_BATCH_SIZE}
  `;
  for (const candidate of expiredMedia) {
    if (Date.now() >= (input.deadlineAtMs ?? Infinity)) break;
    const row = await input.prisma.$transaction(async tx => {
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
  // The row stays as the publication fence, which reads only retiredAt. A wrapped
  // key is useless once its object is gone. Legacy rows keep their ref: the table
  // requires it and a repeat purge parses it.
  if (kind === "game_recap") {
    const result = await input.prisma.gameRecapAsset.updateMany({ where: { userId, resourceId, revision, retiredAt: { not: null }, purgedAt: null }, data: { purgedAt: input.now } });
    return result.count === 1;
  }
  const result = await input.prisma.hostedRuntimeOrphan.updateMany({ where: { userId, kind, resourceId, revision, retiredAt: { not: null }, purgedAt: null },
    data: { purgedAt: input.now, ...(kind === "snapshot" ? { snapshotRef: Prisma.DbNull } : {}) } });
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
    let stage: CleanupFailureStage = "parse";
    try {
      const request = { userId: orphan.userId, resource: parseHostedRuntimeResourcePurge(orphan) };
      stage = "purge";
      await client.purgeRuntimeResource(request);
      stage = "acknowledge";
      if (await acknowledgeHostedRuntimeOrphanPurge({ ...input, orphan })) deleted += 1;
    } catch (error) {
      failed += 1;
      warnHostedRuntimeResourceCleanupFailure(orphan, stage, error);
      // Avoid one unavailable resource monopolizing a bounded sweep.
      const where = { userId: orphan.userId, resourceId: orphan.resourceId, revision: orphan.revision, purgedAt: null };
      const data = { cleanupAt: new Date(input.now.getTime() + 60_000) };
      if (orphan.kind === "game_recap") await input.prisma.gameRecapAsset.updateMany({ where, data });
      else await input.prisma.hostedRuntimeOrphan.updateMany({ where: { ...where, kind: orphan.kind }, data });
    }
  }
  for (const purge of claimed.media) {
    if (Date.now() >= deadline) break;
    let stage: CleanupFailureStage = "purge";
    try {
      await client.purgeRuntimeResource({ userId: purge.userId, resource: { kind: "media", objectKey: purge.objectKey } });
      stage = "acknowledge";
      if ((await executeHostedRuntimeMediaCommand({ ...input, userId: purge.userId, command: { operation: "acknowledge_purge", purge } })).applied) deleted += 1;
    } catch (error) {
      failed += 1;
      warnHostedRuntimeResourceCleanupFailure("media", stage, error);
    }
  }
  return { configured: true, deleted, failed };
}
