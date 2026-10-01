import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_VAULT_REPLICA_SCHEMA } from "@murphai/contracts/browser-vault";
import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA, type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import { buildHostedWorkspaceSnapshotV2FingerprintSha256 as fingerprint, type HostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { fingerprintRecoveryReplica, type HostedCheckpointRecoveryRequest } from "@murphai/hosted-execution/runtime-resources";
import { HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS } from "@murphai/hosted-execution/runtime-control";
import { createPrismaClient } from "@/src/lib/prisma";
import { claimHostedRuntime, requireHostedRuntimeOwnerTx, releaseHostedRuntimeAfterRetirement,
  prepareHostedRuntimeLaunch, recordHostedRuntimeAccepted } from "@/src/lib/hosted-execution/runtime-owner";
import { recoverHostedWorkspaceCheckpoint } from "@/src/lib/hosted-workspace/checkpoint-recovery";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search || url.hash) throw new Error("Recovery proof requires a local test database.");
}

describe.skipIf(!enabled)("protected checkpoint recovery PostgreSQL publication", () => {
  let db: PrismaClient;
  let concurrent: PrismaClient;
  const members: string[] = [];
  let phase: string;
  beforeAll(async () => {
    db = createPrismaClient({ databaseUrl, poolMax: 1 });
    concurrent = createPrismaClient({ databaseUrl, poolMax: 1 });
    phase = (await db.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).phase;
    await db.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres" } });
  });
  afterAll(async () => {
    if (db) {
      await db.hostedRuntimeOrphan.deleteMany({ where: { userId: { in: members } } });
      await db.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
      await db.hostedMember.deleteMany({ where: { id: { in: members } } });
      await db.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase } });
    }
    await Promise.all([db?.$disconnect(), concurrent?.$disconnect()]);
  });

  async function fixture() {
    const userId = `recovery-proof-${randomUUID()}`;
    members.push(userId);
    await db.hostedMember.create({ data: { id: userId, billingStatus: "active", initialOnboardingCompletedAt: new Date() } });
    const claimed = await claimHostedRuntime({ prisma: db, userId, processingMode: "default" });
    if (claimed.status === "blocked" || !claimed.owner.attemptId) throw new Error("Synthetic claim failed.");
    const identity = { userId, attemptId: claimed.owner.attemptId, generation: claimed.owner.generation.toString() };
    const source = await snapshot(userId);
    const replacement = await snapshot(userId);
    const replica: HostedBrowserVaultReplicaRef = { schema: HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA, replicaSchema: BROWSER_VAULT_REPLICA_SCHEMA,
      objectKey: "synthetic-replica", byteLength: 10, dataVersion: "1", generatedAt: source.createdAt,
      keyId: "synthetic-key", runtimeRootKeyId: "synthetic-root", sourceBundleHash: "a".repeat(64) };
    const status = { ...Object.fromEntries(HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS.map(key => [key, "synthetic-old-history"])),
      hostedMailboxSystemHandledThroughSeq: "9" };
    await db.hostedWorkspace.create({ data: { userId, version: 7n, snapshotRef: JSON.parse(JSON.stringify(source)),
      browserVaultReplicaRef: JSON.parse(JSON.stringify(replica)), redactedStatusJson: status, systemMailboxProgressGeneration: 3n } });
    const request: HostedCheckpointRecoveryRequest = { operation: "stage", expectedWorkspaceVersion: "7",
      sourceSnapshotFingerprint: fingerprint(source), sourceReplicaFingerprint: fingerprintRecoveryReplica(replica), replacement };
    const run = (operation: "stage" | "publish", overrides: Partial<HostedCheckpointRecoveryRequest> = {}) =>
      recoverHostedWorkspaceCheckpoint({ prisma: db, userId, request: { ...request, ...overrides, operation } });
    return { userId, identity, source, replacement, replica, request, run };
  }

  it("stages without retiring, then atomically replaces and fences old writes without claiming native stop", async () => {
    const f = await fixture();
    await prepareHostedRuntimeLaunch({ prisma: db, identity: f.identity, runnerContainerName: "synthetic-native-target",
      workspaceVersion: "7", providerEgressTokenHash: null, customInferenceEnvelope: null, platformAiUsageAllowed: true });
    expect(await recordHostedRuntimeAccepted({ prisma: db, identity: f.identity })).toBe(true);
    await db.hostedMailboxLaneCounter.create({ data: { userId: f.userId, lane: "system", nextSeq: 10n, consumedSeq: 8n } });
    const pendingId = `synthetic-pending-${randomUUID()}`;
    await db.hostedMailboxItem.create({ data: { id: pendingId, userId: f.userId, lane: "system", laneSeq: 9n,
      kind: "device-sync.wake", dedupeKey: "synthetic-pending", occurredAt: new Date(), payloadSchema: "hosted.execution.wake.v1" } });
    expect(await f.run("stage")).toEqual({ status: "staged", workspaceVersion: "7" });
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: f.userId } })).phase).toBe("active");
    expect(await f.run("publish")).toEqual({ status: "published", workspaceVersion: "8" });
    const workspace = await db.hostedWorkspace.findUniqueOrThrow({ where: { userId: f.userId } });
    expect(workspace).toMatchObject({ snapshotRef: f.replacement, browserVaultReplicaRef: f.replica,
      systemMailboxProgressGeneration: 3n, redactedStatusJson: { checkpointPartialRecovery: true } });
    const owner = await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: f.userId } });
    expect(owner).toMatchObject({ phase: "retiring", attemptId: f.identity.attemptId, completedAt: null, platformAiUsageAllowed: false,
      runnerContainerName: "synthetic-native-target" });
    await expect(db.$transaction(tx => requireHostedRuntimeOwnerTx(tx, f.identity))).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    expect((await db.hostedMember.findUniqueOrThrow({ where: { id: f.userId } })).initialOnboardingCompletedAt).not.toBeNull();
    expect((await db.hostedMailboxItem.findUniqueOrThrow({ where: { id: pendingId } })).consumedAt).toBeNull();
    expect((await db.hostedMailboxLaneCounter.findUniqueOrThrow({ where: { userId_lane: { userId: f.userId, lane: "system" } } })).consumedSeq).toBe(8n);
    expect(await f.run("publish")).toEqual({ status: "published", workspaceVersion: "8" });
    // The synthetic adapter supplies the normal native-stop proof, then a new
    // attempt claims. Replaying the old publication must leave it authorized.
    expect(await releaseHostedRuntimeAfterRetirement({ prisma: db, identity: f.identity, runnerContainerName: "synthetic-native-target" })).toBe(true);
    const successor = await claimHostedRuntime({ prisma: db, userId: f.userId, processingMode: "default" });
    if (successor.status === "blocked") throw new Error("Synthetic successor rejected.");
    expect(await f.run("publish")).toEqual({ status: "published", workspaceVersion: "8" });
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: f.userId } })).attemptId).toBe(successor.owner.attemptId);
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: f.userId } })).phase).toBe("starting");
    expect((await db.hostedRuntimeOrphan.findMany({ where: { userId: f.userId } })).map(row => row.resourceId).sort())
      .toEqual([f.source.snapshotId, f.replacement.snapshotId].sort());
  });

  it("rejects unstaged publication and stale source, replica, version or member without revoking the owner", async () => {
    const f = await fixture();
    await expect(f.run("publish")).rejects.toMatchObject({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT" });
    for (const overrides of [{ expectedWorkspaceVersion: "6" }, { sourceSnapshotFingerprint: "0".repeat(64) },
      { sourceReplicaFingerprint: "0".repeat(64) }, { replacement: await snapshot("another-synthetic-member") }]) {
      await expect(f.run("stage", overrides)).rejects.toMatchObject({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT" });
    }
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: f.userId } })).phase).toBe("starting");
    expect(await db.hostedRuntimeOrphan.count({ where: { userId: f.userId } })).toBe(0);
  });

  it("does not revive cleanup-retired candidates or publish over a newer checkpoint", async () => {
    const f = await fixture();
    await f.run("stage");
    await db.hostedRuntimeOrphan.updateMany({ where: { userId: f.userId }, data: { retiredAt: new Date() } });
    await expect(f.run("stage")).rejects.toMatchObject({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED" });
    await expect(f.run("publish")).rejects.toMatchObject({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED" });
    const other = await fixture();
    await other.run("stage");
    await db.hostedWorkspace.update({ where: { userId: other.userId }, data: { version: { increment: 1 } } });
    await expect(other.run("publish")).rejects.toMatchObject({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT" });
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: other.userId } })).phase).toBe("starting");
  });

  it("serializes competing publication and acknowledges the same replacement exactly once", async () => {
    const f = await fixture();
    await f.run("stage");
    const results = await Promise.all([f.run("publish"), recoverHostedWorkspaceCheckpoint({
      prisma: concurrent, userId: f.userId, request: { ...f.request, operation: "publish" },
    })]);
    expect(results).toEqual([{ status: "published", workspaceVersion: "8" }, { status: "published", workspaceVersion: "8" }]);
    expect((await db.hostedWorkspace.findUniqueOrThrow({ where: { userId: f.userId } })).version).toBe(8n);
  });

  it("rechecks same-version replica changes and account suspension between staging and publication", async () => {
    const f = await fixture();
    await f.run("stage");
    await db.hostedWorkspace.update({ where: { userId: f.userId }, data: {
      browserVaultReplicaRef: JSON.parse(JSON.stringify({ ...f.replica, generation: 2 })),
    } });
    await expect(f.run("publish")).rejects.toMatchObject({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT" });
    const other = await fixture();
    await other.run("stage");
    await db.hostedMember.update({ where: { id: other.userId }, data: { suspendedAt: new Date() } });
    await expect(other.run("publish")).rejects.toMatchObject({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT" });
    expect((await db.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: other.userId } })).phase).toBe("starting");
  });
});

async function snapshot(userId: string): Promise<HostedWorkspaceSnapshotV2Ref> {
  const snapshotId = `synthetic-${randomUUID()}`;
  const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId });
  return parseHostedWorkspaceSnapshotV2Ref({ schema: "murph.hosted-workspace-snapshot.v2", userId, snapshotId, objectKey, createdAt: new Date().toISOString(),
    upload: "direct-r2-presigned-put", archive: { compression: "zstd", format: "tar", encryptedByteSize: 128,
      encryptedObjectSha256: "a".repeat(64), plaintextArchiveSha256: "b".repeat(64), fileCount: 5, totalPlainBytes: 256 },
    encryption: { scheme: "murph.hosted-workspace-snapshot-single-object.v1", rootKeyId: "synthetic-root",
      ivBase64: Buffer.alloc(12).toString("base64url"), wrappedDataKey: "synthetic-wrapped-key",
      aad: { schema: "murph.hosted-workspace-snapshot.v2", purpose: "workspace-snapshot", userId, objectKey, snapshotId } } });
}
