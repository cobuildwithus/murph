import { randomUUID } from "node:crypto";

import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { hostedBrowserVaultReplicaUserPrefix, hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotUploadSession, type HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import { recordHostedRuntimeOrphan, recordRuntimeOrphansTx, snapshotOrphanCandidates } from "@/src/lib/hosted-execution/runtime-orphans";
import { executeHostedRuntimeReplicaPutCommand } from "@/src/lib/hosted-execution/runtime-replica-puts";
import { acknowledgeHostedRuntimeOrphanPurge, claimHostedRuntimeResourceCleanup } from "@/src/lib/hosted-execution/runtime-resource-cleanup";
import {
  claimHostedRuntime,
  releaseHostedRuntimeAfterRetirement,
  retireHostedRuntime,
  type HostedRuntimeIdentity,
} from "@/src/lib/hosted-execution/runtime-owner";
import { executeHostedRuntimeSnapshotCommand } from "@/src/lib/hosted-execution/runtime-snapshots";
import {
  deleteExpiredRuntimePutDrains,
  HOSTED_RUNTIME_LEDGER_RETENTION_MS,
} from "@/src/lib/hosted-retention/cleanup";
import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  // These sweeps are global, so a shared development database must never qualify.
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("Runtime ledger retention proof requires a local test database.");
  }
}

const DAY_MS = 86_400_000;

type OrphanWhere = { userId_kind_resourceId: { userId: string; kind: string; resourceId: string } };

describe.skipIf(!enabled)("Postgres runtime ledger retention", () => {
  let prisma: PrismaClient;
  const users: string[] = [];
  const members: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  });

  afterAll(async () => {
    if (!prisma) return;
    const where = { userId: { in: users } };
    await prisma.hostedRuntimeSnapshotUpload.deleteMany({ where });
    await prisma.hostedRuntimePutDrain.deleteMany({ where });
    await prisma.hostedRuntimeOrphan.deleteMany({ where });
    await prisma.hostedRuntimeOwner.deleteMany({ where });
    await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
    await prisma.$disconnect();
  });

  function user(): string {
    const id = `ledger_retention_${randomUUID()}`;
    users.push(id);
    return id;
  }

  async function member(): Promise<string> {
    const id = user();
    members.push(id);
    await prisma.hostedMember.create({ data: { id, billingStatus: "active" } });
    return id;
  }

  async function currentAttempt(userId: string, generation = 7n, attemptId = "attempt-current") {
    await prisma.hostedRuntimeOwner.create({
      data: { userId, attemptId, generation, phase: "active", allocationId: "allocation",
        processingMode: "default", runnerContainerName: "runner", workspaceVersion: 0n },
    });
  }

  async function uploadSession(userId: string, snapshotId: string, expiresAt: Date) {
    await prisma.hostedRuntimeSnapshotUpload.create({ data: {
      userId, snapshotId, attemptId: "attempt-session", generation: 1n, expectedWorkspaceVersion: 0n,
      workspaceVersion: 0n, objectKey: `synthetic/${snapshotId}`, encryption: {},
      createdAt: new Date(expiresAt.getTime() - 3_600_000), expiresAt, heartbeatAt: expiresAt,
    } });
  }

  async function claimed(userId: string): Promise<HostedRuntimeIdentity> {
    const result = await claimHostedRuntime({ prisma, userId, processingMode: "default" });
    if (result.status === "blocked" || !result.owner.attemptId) throw new Error("Expected a claimed runtime.");
    return { userId, attemptId: result.owner.attemptId, generation: result.owner.generation.toString() };
  }

  async function recordedSnapshot(now: Date) {
    const userId = await member();
    const runtime = await claimed(userId);
    const session = await snapshotSession(runtime);
    const ref = acceptedRef(session);
    await prisma.$transaction(tx => recordRuntimeOrphansTx(tx, userId, snapshotOrphanCandidates(ref), now));
    const where: OrphanWhere = { userId_kind_resourceId: { userId, kind: "snapshot", resourceId: session.snapshotId } };
    return { userId, runtime, session, ref, where };
  }

  const stored = (where: OrphanWhere) => prisma.hostedRuntimeOrphan.findUniqueOrThrow({ where });

  async function claimOrphan(where: OrphanWhere, now: Date) {
    // Stand in for the grace period, and sort first in this bounded shared sweep.
    await prisma.hostedRuntimeOrphan.update({ where, data: { cleanupAt: new Date(0) } });
    const { userId, kind, resourceId } = where.userId_kind_resourceId;
    const claim = await claimHostedRuntimeResourceCleanup({ prisma, now });
    const orphan = claim.orphans.find(row => row.userId === userId && row.kind === kind && row.resourceId === resourceId);
    if (!orphan) throw new Error("Expected the resource to be claimed for purge.");
    return orphan;
  }

  async function purge(where: OrphanWhere, now: Date) {
    const orphan = await claimOrphan(where, now);
    // The adapter request is parsed from the claimed row, exactly as the sweep does.
    expect(parseHostedRuntimeResourcePurge(orphan).kind).toBe(orphan.kind);
    expect(await acknowledgeHostedRuntimeOrphanPurge({ prisma, orphan, now })).toBe(true);
  }

  it("deletes only finished put receipts outside every owner fence and session", async () => {
    const now = new Date();
    const older = new Date(now.getTime() - HOSTED_RUNTIME_LEDGER_RETENTION_MS - 1);
    const cutoff = new Date(now.getTime() - HOSTED_RUNTIME_LEDGER_RETENTION_MS);
    const inside = new Date(now.getTime() - 29 * DAY_MS);
    const expiredSession = new Date(now.getTime() - 40 * DAY_MS);
    const liveSession = new Date(now.getTime() + 3_600_000);
    type Case = { name: string; deleted: boolean; kind: string; writeId: string; completedAt: Date | null;
      generation?: bigint; attemptId?: string; setup?: (userId: string) => Promise<void> };
    const cases: Case[] = [
      { name: "replica from a finished attempt", deleted: true, kind: "replica", writeId: "replica:a", completedAt: older },
      { name: "snapshot with no session", deleted: true, kind: "snapshot", writeId: "snapshot:a", completedAt: older },
      { name: "snapshot beside another session", deleted: true, kind: "snapshot", writeId: "snapshot:a", completedAt: older,
        setup: userId => uploadSession(userId, "b", liveSession) },
      { name: "same attempt in an earlier generation", deleted: true, kind: "replica", writeId: "replica:a", completedAt: older,
        generation: 6n, attemptId: "attempt-current", setup: userId => currentAttempt(userId) },
      { name: "same generation under another attempt", deleted: true, kind: "replica", writeId: "replica:a", completedAt: older,
        generation: 7n, attemptId: "attempt-finished", setup: userId => currentAttempt(userId) },
      { name: "another member's identical attempt and session", deleted: true, kind: "snapshot", writeId: "snapshot:a", completedAt: older,
        generation: 7n, attemptId: "attempt-current", setup: async () => {
          const other = user();
          await currentAttempt(other);
          await uploadSession(other, "a", liveSession);
        } },
      { name: "receipt exactly at the cutoff", deleted: false, kind: "replica", writeId: "replica:a", completedAt: cutoff },
      { name: "receipt inside the window", deleted: false, kind: "replica", writeId: "replica:a", completedAt: inside },
      { name: "snapshot exactly at the cutoff", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: cutoff },
      { name: "snapshot inside the window", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: inside },
      { name: "unfinished replica", deleted: false, kind: "replica", writeId: "replica:a", completedAt: null },
      { name: "unfinished snapshot", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: null },
      { name: "current attempt replica", deleted: false, kind: "replica", writeId: "replica:a", completedAt: older,
        generation: 7n, attemptId: "attempt-current", setup: userId => currentAttempt(userId) },
      { name: "current attempt snapshot", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: older,
        generation: 7n, attemptId: "attempt-current", setup: userId => currentAttempt(userId) },
      { name: "live session", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: older,
        setup: userId => uploadSession(userId, "a", liveSession) },
      { name: "expired session", deleted: false, kind: "snapshot", writeId: "snapshot:a", completedAt: older,
        setup: userId => uploadSession(userId, "a", expiredSession) },
      { name: "media", deleted: false, kind: "media", writeId: "media:a:b", completedAt: older },
      { name: "private media", deleted: false, kind: "private_media", writeId: "private_media:a:b", completedAt: older },
    ];
    const names = new Map<string, string>();
    for (const row of cases) {
      const userId = user();
      names.set(userId, row.name);
      await row.setup?.(userId);
      await prisma.hostedRuntimePutDrain.create({ data: {
        userId, writeId: row.writeId, kind: row.kind, attemptId: row.attemptId ?? "attempt-finished",
        generation: row.generation ?? 1n, admittedAt: new Date(now.getTime() - 60 * DAY_MS), completedAt: row.completedAt,
      } });
    }

    expect(await deleteExpiredRuntimePutDrains({ now, prisma })).toBeGreaterThanOrEqual(
      cases.filter(row => row.deleted).length,
    );

    const survivors = await prisma.hostedRuntimePutDrain.findMany({
      where: { userId: { in: [...names.keys()] } }, select: { userId: true },
    });
    expect(survivors.map(row => names.get(row.userId)).sort())
      .toEqual(cases.filter(row => !row.deleted).map(row => row.name).sort());
  });

  it("still rejects every stale writer once its receipts have aged out", async () => {
    const userId = await member();
    const finished = await claimed(userId);
    const objectKey = `${await hostedBrowserVaultReplicaUserPrefix({ userId })}finished.json`;
    const admit = { operation: "admit" as const, writeId: "finished-write", objectKey };
    const session = await snapshotSession(finished);
    await executeHostedRuntimeReplicaPutCommand({ prisma, userId, command: { ...admit, ...finished } });
    await executeHostedRuntimeReplicaPutCommand({ prisma, userId, command: { operation: "release", writeId: admit.writeId } });
    await executeHostedRuntimeSnapshotCommand({ prisma, userId, command: { operation: "snapshot_create", session } });
    await executeHostedRuntimeSnapshotCommand({ prisma, userId, command: {
      operation: "snapshot_managed_admit", expectedSession: session, uploadId: "finished-upload",
      encryptedByteSize: 128, encryptedSha256: "a".repeat(64),
    } });
    await executeHostedRuntimeSnapshotCommand({ prisma, userId, command: {
      operation: "snapshot_managed_settled", ...finished, snapshotId: session.snapshotId,
      uploadId: "finished-upload", verified: true,
    } });
    await prisma.hostedRuntimeSnapshotUpload.delete({ where: { userId } });
    await retireHostedRuntime({ prisma, identity: finished });
    await releaseHostedRuntimeAfterRetirement({ prisma, identity: finished, runnerContainerName: null });
    const current = await claimed(userId);

    const now = new Date();
    await prisma.hostedRuntimePutDrain.updateMany({ where: { userId },
      data: { completedAt: new Date(now.getTime() - HOSTED_RUNTIME_LEDGER_RETENTION_MS - 1) } });
    await deleteExpiredRuntimePutDrains({ now, prisma });
    expect(await prisma.hostedRuntimePutDrain.count({ where: { userId } })).toBe(0);

    await expect(executeHostedRuntimeReplicaPutCommand({ prisma, userId, command: { ...admit, ...finished } }))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    await expect(executeHostedRuntimeSnapshotCommand({ prisma, userId, command: {
      operation: "snapshot_managed_read", ...finished, snapshotId: session.snapshotId,
    } })).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    // The late settle has no owner fence, so a missing receipt must fail closed.
    await expect(executeHostedRuntimeSnapshotCommand({ prisma, userId, command: {
      operation: "snapshot_managed_settled", ...finished, snapshotId: session.snapshotId,
      uploadId: "finished-upload", verified: true,
    } })).resolves.toMatchObject({ applied: false });
    await expect(executeHostedRuntimeReplicaPutCommand({ prisma, userId, command: {
      operation: "release", writeId: admit.writeId,
    } })).resolves.toEqual({ applied: false });
    await expect(executeHostedRuntimeReplicaPutCommand({ prisma, userId, command: {
      ...admit, ...current, writeId: "current-write",
    } })).resolves.toEqual({ applied: true });
  });

  it("clears a snapshot's ref in the purge acknowledgement and keeps its tombstone", async () => {
    const now = new Date();
    const { session, ref, where } = await recordedSnapshot(now);
    const before = await stored(where);
    expect(before.snapshotRef).toEqual(ref);

    const orphan = await claimOrphan(where, now);
    // A superseded receipt changes nothing, so the ref only goes with a real purge.
    expect(await acknowledgeHostedRuntimeOrphanPurge({ prisma, orphan: { ...orphan, revision: orphan.revision + 1n }, now })).toBe(false);
    expect((await stored(where)).snapshotRef).toEqual(ref);
    expect((await stored(where)).purgedAt).toBeNull();

    expect(await acknowledgeHostedRuntimeOrphanPurge({ prisma, orphan, now })).toBe(true);
    expect(await stored(where)).toMatchObject({
      snapshotRef: null, purgedAt: now, retiredAt: now, objectKey: session.objectKey,
      recoveryUntil: before.recoveryUntil, revision: before.revision,
    });
  });

  it("keeps a legacy snapshot's ref through purge and leaves a replica row without one", async () => {
    const now = new Date();
    const userId = await member();
    const bundle = { hash: "synthetic_bundle", key: "bundles/vault/synthetic.bundle.json", size: 128, updatedAt: "2026-09-15T00:00:00Z" };
    const replicaKey = `${await hostedBrowserVaultReplicaUserPrefix({ userId })}purged.json`;
    await prisma.$transaction(tx => recordRuntimeOrphansTx(tx, userId, [
      ...snapshotOrphanCandidates(bundle),
      { kind: "replica", resourceId: replicaKey, objectKey: replicaKey, snapshotRef: Prisma.DbNull },
    ], now));
    const { resourceId } = await prisma.hostedRuntimeOrphan.findFirstOrThrow({ where: { userId, kind: "legacy_snapshot" } });
    const legacy = { userId_kind_resourceId: { userId, kind: "legacy_snapshot", resourceId } };
    const replica = { userId_kind_resourceId: { userId, kind: "replica", resourceId: replicaKey } };

    await purge(legacy, now);
    await purge(replica, now);

    expect(await stored(legacy)).toMatchObject({ snapshotRef: bundle, purgedAt: now });
    expect(await stored(replica)).toMatchObject({ snapshotRef: null, purgedAt: now });
  });

  it("still fences publication and session creation after the ref is cleared", async () => {
    const now = new Date();
    const { userId, runtime, session, ref, where } = await recordedSnapshot(now);
    await prisma.hostedWorkspace.create({ data: { userId } });
    await purge(where, now);
    expect(await stored(where)).toMatchObject({ snapshotRef: null, purgedAt: now });

    await expect(checkpointHostedRuntimeWorkspace({
      prisma, userId, runtimeAuthority: { ...runtime, workspaceVersion: "0" },
      expectedVersion: "0", reason: "idle_shutdown", snapshotRef: ref,
    })).rejects.toMatchObject({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED" });
    await expect(executeHostedRuntimeSnapshotCommand({ prisma, userId, command: { operation: "snapshot_create", session } }))
      .resolves.toEqual({ cutover: "postgres", applied: false, session: null });

    expect(await prisma.hostedRuntimeSnapshotUpload.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.hostedWorkspace.findUniqueOrThrow({ where: { userId } })).toMatchObject({ version: 0n, snapshotRef: null });
  });

  it("re-arms a cleared row and repeats its purge from the object key alone", async () => {
    const now = new Date();
    const { userId, session, ref, where } = await recordedSnapshot(now);
    await purge(where, now);
    const cleared = await stored(where);

    // A key-only record through the same owner the orphan route calls.
    await recordHostedRuntimeOrphan({ prisma, userId, resource: { kind: "snapshot", objectKey: session.objectKey } });
    expect(await stored(where)).toMatchObject({
      snapshotRef: null, purgedAt: null, retiredAt: cleared.retiredAt, revision: cleared.revision + 1n,
    });
    expect(parseHostedRuntimeResourcePurge(await claimOrphan(where, now)))
      .toEqual({ kind: "snapshot", objectKey: session.objectKey });
    await purge(where, now);
    expect(await stored(where)).toMatchObject({ snapshotRef: null, purgedAt: now, retiredAt: cleared.retiredAt });

    // A retained session's replaced ref restores the payload until its repeat purge.
    await prisma.$transaction(tx => recordRuntimeOrphansTx(tx, userId, snapshotOrphanCandidates(ref), now));
    expect(await stored(where)).toMatchObject({ snapshotRef: ref, purgedAt: null, retiredAt: cleared.retiredAt });
    await purge(where, now);
    expect(await stored(where)).toMatchObject({ snapshotRef: null, purgedAt: now });
  });
});

async function snapshotSession(runtime: HostedRuntimeIdentity) {
  const snapshotId = `snapshot-${randomUUID()}`;
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId: runtime.userId, snapshotId });
  return parseHostedWorkspaceSnapshotUploadSession({
    schema: "murph.hosted-workspace-snapshot-upload.v1", userId: runtime.userId,
    snapshotId, objectKey, attemptId: runtime.attemptId, leaseGeneration: runtime.generation,
    workspaceVersion: "0", expectedWorkspaceVersion: "0", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    encryption: {
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME, rootKeyId: "synthetic-root", ivBase64: "synthetic-iv", wrappedDataKey: "synthetic-wrapped-key",
      aad: { schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA, purpose: HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE, userId: runtime.userId, objectKey, snapshotId },
    },
  });
}

function acceptedRef(session: HostedWorkspaceSnapshotUploadSession) {
  return parseHostedWorkspaceSnapshotV2Ref({
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA, userId: session.userId, snapshotId: session.snapshotId,
    objectKey: session.objectKey, createdAt: session.createdAt,
    encryption: { ...session.encryption, ivBase64: Buffer.alloc(12).toString("base64url") },
    upload: "direct-r2-presigned-put",
    archive: { compression: "zstd", format: "tar", encryptedByteSize: 128, encryptedObjectSha256: "a".repeat(64),
      plaintextArchiveSha256: "b".repeat(64), fileCount: 5, totalPlainBytes: 256 },
  });
}
