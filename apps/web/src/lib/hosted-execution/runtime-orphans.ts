import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";
import { createHash } from "node:crypto";
import { hostedBrowserVaultReplicaUserPrefix, hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedRuntimeResourcePurge, type HostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { lockHostedRuntimeOwnerRowTx } from "./runtime-owner";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { HostedExecutionSnapshotRef, HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import { isHostedWorkspaceSnapshotV2Ref, readHostedExecutionSnapshotBaseRef, readHostedExecutionSnapshotHotRef, readHostedExecutionSnapshotDeltaRef } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_ORPHAN_GRACE_MS } from "@murphai/hosted-execution/runtime-resources";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

type Candidate = { kind: "snapshot" | "legacy_snapshot" | "replica"; resourceId: string; objectKey: string | null; snapshotRef: Prisma.InputJsonValue | typeof Prisma.DbNull; recoveryUntil?: Date };

export function snapshotOrphanCandidates(ref: HostedExecutionSnapshotRef): Candidate[] {
  if (!ref) return [];
  if (isHostedWorkspaceSnapshotV2Ref(ref)) return [{ kind: "snapshot", resourceId: ref.snapshotId, objectKey: ref.objectKey, snapshotRef: JSON.parse(JSON.stringify(ref)) as Prisma.InputJsonObject }];
  const refs = [readHostedExecutionSnapshotBaseRef(ref), readHostedExecutionSnapshotHotRef(ref), readHostedExecutionSnapshotDeltaRef(ref)].filter(value => value !== null);
  const candidates = new Map<string, Candidate>();
  for (const bundle of refs) {
    // Legacy references can share encrypted bundle payloads across snapshots.
    // A tombstone per payload fences all references to that payload in O(3).
    const resourceId = createHash("sha256").update(JSON.stringify([bundle.hash, bundle.size])).digest("hex");
    candidates.set(resourceId, { kind: "legacy_snapshot", resourceId, objectKey: null, snapshotRef: JSON.parse(JSON.stringify(bundle)) as Prisma.InputJsonObject });
  }
  return [...candidates.values()];
}

export function replicaOrphanCandidate(ref: HostedBrowserVaultReplicaRef): Candidate {
  return { kind: "replica", resourceId: ref.objectKey, objectKey: ref.objectKey, snapshotRef: Prisma.DbNull };
}

export async function recordRuntimeOrphansTx(tx: Prisma.TransactionClient, userId: string, candidates: readonly Candidate[], now: Date): Promise<void> {
  for (const candidate of candidates) {
    const where = { userId_kind_resourceId: { userId, kind: candidate.kind, resourceId: candidate.resourceId } };
    const existing = await tx.hostedRuntimeOrphan.findUnique({ where });
    if (existing && existing.objectKey !== candidate.objectKey) throw new TypeError("Runtime resource identity changed object key.");
    // Session retirement can later repeat a key-only orphan record. It must
    // neither erase the wrapped data key nor shorten an accepted snapshot's
    // recovery window. Raw encrypted bytes alone cannot be restored.
    const recoveryRef = candidate.kind === "snapshot" && candidate.snapshotRef !== Prisma.DbNull
      ? candidate.snapshotRef : undefined;
    // The first complete reference fixes the deadline from that archive's
    // content-expiry evidence. Later records cannot extend expired content.
    const recoveryUntil = existing?.recoveryUntil ?? (recoveryRef === undefined ? null
      : candidate.recoveryUntil ?? new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS));
    const cleanupAt = recoveryUntil ?? new Date(now.getTime() + HOSTED_RUNTIME_ORPHAN_GRACE_MS);
    const { recoveryUntil: _recoveryUntil, ...resource } = candidate;
    await tx.hostedRuntimeOrphan.upsert({ where,
      create: { userId, ...resource, createdAt: now, cleanupAt, recoveryUntil },
      update: { cleanupAt, recoveryUntil, ...(recoveryRef === undefined ? {} : { snapshotRef: recoveryRef }), purgedAt: null, revision: { increment: 1 } },
    });
  }
}

/** Caller holds the runtime owner and workspace publication locks. Cleanup
 * acquires them in the same order before irreversible resource retirement. */
export async function requireRuntimeResourcesPublishableTx(tx: Prisma.TransactionClient, userId: string, candidates: readonly Candidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const retired = await tx.hostedRuntimeOrphan.findFirst({ where: {
    userId, retiredAt: { not: null }, OR: candidates.map(({ kind, resourceId }) => ({ kind, resourceId })),
  }, select: { resourceId: true } });
  if (retired) throw hostedOnboardingError({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED", httpStatus: 409, message: "Hosted runtime resource has been retired." });
}

/** Recording cleanup obligations grants no runtime authority. Late adapter
 * results may retain them after revocation or account deletion. */
export async function recordHostedRuntimeOrphan(input: { prisma: PrismaClient; userId: string; resource: HostedRuntimeResourcePurge }): Promise<void> {
  const resource = parseHostedRuntimeResourcePurge(input.resource);
  let candidates: Candidate[];
  if (resource.kind === "legacy_snapshot") candidates = snapshotOrphanCandidates(resource.snapshotRef);
  else if (resource.kind === "snapshot") {
    const snapshotId = /\/workspace-snapshots\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.snapshot\.enc$/u.exec(resource.objectKey)?.[1];
    if (!snapshotId || resource.objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId })) throw new TypeError("Snapshot orphan namespace mismatch.");
    candidates = [{ kind: "snapshot", resourceId: snapshotId, objectKey: resource.objectKey, snapshotRef: Prisma.DbNull }];
  } else if (resource.kind === "replica") {
    const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId: input.userId });
    if (!resource.objectKey.startsWith(prefix) || resource.objectKey.slice(prefix.length).includes("/")) throw new TypeError("Replica orphan namespace mismatch.");
    candidates = [{ kind: "replica", resourceId: resource.objectKey, objectKey: resource.objectKey, snapshotRef: Prisma.DbNull }];
  } else throw new TypeError("Media retirement has its own metadata owner.");
  await input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") throw hostedOnboardingError({ code: "HOSTED_RUNTIME_OWNER_STALE", httpStatus: 409, message: "Postgres resource ownership is not active." });
    await lockHostedMemberRow(tx, input.userId);
    await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    await recordRuntimeOrphansTx(tx, input.userId, candidates, new Date());
  });
}
