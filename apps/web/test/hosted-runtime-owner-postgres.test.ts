import { reconcileHostedRuntimeUploads } from "@/src/lib/hosted-execution/runtime-upload-recovery";
const uploadRecovery = vi.hoisted(() => ({ purge: vi.fn() }));
const completionNotification = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => ({ purgeRuntimeResource: uploadRecovery.purge }),
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-owner-release", () => ({
  notifyHostedRuntimeOwnerCompletion: completionNotification.notify,
}));
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, type HostedRuntimeOwner, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  recordHostedRuntimeFailure,
  isHostedRuntimeDeletionReady,
  authorizeHostedRuntimeProvider,
  recordHostedRuntimeTargetRetired,
  claimHostedRuntime,
  prepareHostedRuntimeLaunch,
  recordHostedRuntimeAccepted,
  releaseHostedRuntimeAfterRetirement,
  releaseHostedRuntimeAfterCompletion,
  requireHostedRuntimeOwnerTx,
  retireHostedRuntime,
  revokeHostedRuntimeAiUsageTx,
  type HostedRuntimeIdentity,
} from "@/src/lib/hosted-execution/runtime-owner";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { executeHostedRuntimeReplicaPutCommand } from "@/src/lib/hosted-execution/runtime-replica-puts";
import { hostedWorkspaceSnapshotObjectKey, hostedBrowserVaultReplicaUserPrefix } from "@murphai/hosted-execution/storage-paths";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE, revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";
import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";
import { claimHostedRuntimeResourceCleanup, acknowledgeHostedRuntimeOrphanPurge, runHostedRuntimeResourceCleanup } from "@/src/lib/hosted-execution/runtime-resource-cleanup";
import { recordRuntimeOrphansTx, snapshotOrphanCandidates } from "@/src/lib/hosted-execution/runtime-orphans";
import { HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS } from "@murphai/hosted-execution/runtime-resources";
import { executeHostedRuntimeMediaCommand, lockHostedRuntimeMediaTx } from "@/src/lib/hosted-execution/runtime-media";
import { executeHostedRuntimeSnapshotCommand } from "@/src/lib/hosted-execution/runtime-snapshots";
import { parseHostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME, HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA, HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE } from "@murphai/hosted-execution/workspace-snapshot-v2";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Runtime ownership proof requires a loopback PostgreSQL database.");
  }
}

describe.skipIf(!enabled)("Postgres runtime ownership", () => {
  let first: PrismaClient;
  let second: PrismaClient;
  let observer: PrismaClient;
  let blockerClient: PrismaClient;
  const members: string[] = [];
  let previousPhase: string;

  beforeAll(async () => {
    first = createPrismaClient({ databaseUrl, poolMax: 1 });
    second = createPrismaClient({ databaseUrl, poolMax: 1 });
    observer = createPrismaClient({ databaseUrl, poolMax: 1 });
    blockerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
    previousPhase = (await observer.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).phase;
    await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres" } });
  });

  afterAll(async () => {
    if (observer) {
      await observer.hostedRuntimeMedia.deleteMany({ where: { userId: { in: members } } });
      await observer.hostedRuntimeSnapshotUpload.deleteMany({ where: { userId: { in: members } } });
      await observer.hostedRuntimePutDrain.deleteMany({ where: { userId: { in: members } } });
      await observer.hostedRuntimeOrphan.deleteMany({ where: { userId: { in: members } } });
      await observer.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
      await observer.hostedMember.deleteMany({ where: { id: { in: members } } });
      await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: previousPhase } });
    }
    await Promise.all([first?.$disconnect(), second?.$disconnect(), observer?.$disconnect(), blockerClient?.$disconnect()]);
  });

  async function member(billingStatus: "active" | "paused" = "active") {
    const id = `runtime_proof_${randomUUID()}`;
    members.push(id);
    await observer.hostedMember.create({ data: { id, billingStatus } });
    return id;
  }

  async function claim(userId: string, prisma = first) {
    const result = await claimHostedRuntime({ prisma, userId, processingMode: "default" });
    if (result.status === "blocked") throw new Error(`Unexpected admission rejection: ${result.reason}`);
    return result;
  }

  it("reads callback authority in the three lock queries without fetching either row twice", async () => {
    const userId = await member();
    const claimed = (await claim(userId)).owner;
    const expected = await observer.hostedRuntimeOwner.update({ where: { userId }, data: {
      generation: 9007199254740993n,
      runnerContainerName: "synthetic-locked-owner",
      workspaceVersion: 9007199254740995n,
      providerEgressTokenHash: "synthetic-provider-hash",
      customInferenceEnvelope: "synthetic-envelope",
      platformAiUsageAllowed: true,
      failureCount: 2,
      lastErrorCode: "SYNTHETIC_FAILURE",
    } });
    expect(expected.attemptId).toBe(claimed.attemptId);
    await first.$transaction(async (tx) => {
      const raw = vi.spyOn(tx, "$queryRaw");
      const ownerRead = vi.spyOn(tx.hostedRuntimeOwner, "findUnique");
      const memberRead = vi.spyOn(tx.hostedMember, "findUnique");
      try {
        expect(await requireHostedRuntimeOwnerTx(tx, identity(expected))).toEqual(expected);
        expect(raw.mock.calls.length + ownerRead.mock.calls.length + memberRead.mock.calls.length).toBe(3);
      } finally {
        raw.mockRestore();
        ownerRead.mockRestore();
        memberRead.mockRestore();
      }
    });
  });

  it("drains 200 eligible snapshot/replica candidates within the configured cron hour", async () => {
    const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const crons = config.crons.filter(cron =>
      cron.path === "/api/internal/hosted-execution/retention/external/cron");
    expect(crons).toHaveLength(1);
    const schedule = /^(\d+)-(\d+)\/(\d+) \* \* \* \*$/u.exec(crons[0]!.schedule);
    if (!schedule) throw new Error("Expected a staggered, every-N-minutes external retention cron.");
    const [start, end, step] = schedule.slice(1).map(Number);
    expect([start, end, step]).toEqual([2, 59, 5]);

    const userId = await member();
    // Keep this fixture's due dates before unrelated rows in the shared proof database.
    const hour = new Date("2020-01-01T00:00:00.000Z");
    const createdAt = new Date(hour.getTime() - 65 * 60_000);
    const replicaPrefix = await hostedBrowserVaultReplicaUserPrefix({ userId });
    const data = await Promise.all(Array.from({ length: 200 }, async (_, index) => {
      const snapshotId = `synthetic-cadence-${index}`;
      const kind = index % 2 === 0 ? "snapshot" : "replica";
      const objectKey = kind === "snapshot"
        ? await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId })
        : `${replicaPrefix}${snapshotId}.enc`;
      return { userId, kind, resourceId: kind === "snapshot" ? snapshotId : objectKey,
        objectKey, createdAt, cleanupAt: hour };
    }));
    await observer.hostedRuntimeOrphan.createMany({ data });
    uploadRecovery.purge.mockReset().mockResolvedValue(undefined);
    try {
      const deletedPerRun: number[] = [];
      for (let minute = start!; minute <= end!; minute += step!) {
        const result = await runHostedRuntimeResourceCleanup({
          prisma: first, now: new Date(hour.getTime() + minute * 60_000),
        });
        expect(result).toMatchObject({ configured: true, failed: 0 });
        expect(result.deleted).toBeLessThanOrEqual(50);
        deletedPerRun.push(result.deleted);
        if (deletedPerRun.length === 1) {
          // The old hourly invocation can only clear 50 of these 200 candidates.
          expect(result.deleted).toBe(50);
          expect(await observer.hostedRuntimeOrphan.count({ where: { userId, purgedAt: null } })).toBe(150);
        }
      }
      expect(deletedPerRun).toHaveLength(12);
      expect(deletedPerRun.reduce((total, count) => total + count, 0)).toBe(200);
      expect(deletedPerRun[0]! * deletedPerRun.length).toBe(600);
      expect(uploadRecovery.purge).toHaveBeenCalledTimes(200);
      expect(await observer.hostedRuntimeOrphan.count({ where: { userId, purgedAt: null } })).toBe(0);
    } finally {
      uploadRecovery.purge.mockReset();
      await observer.hostedRuntimeOrphan.deleteMany({ where: { userId } });
    }
  });

  it("recovers uncertain media uploads by exact provider abort before deleted-member cleanup", async () => {
    const userId = await member();
    const owner = (await claim(userId)).owner;
    const current = identity(owner);
    const descriptor = { mediaId: "d".repeat(64), sha256: "e".repeat(64), mediaKind: "image" as const, byteSize: 4, expiresAt: null };
    await executeHostedRuntimeMediaCommand({ prisma: first, userId, command: {
      operation: "admit_put", ...current, descriptor, uploadId: "synthetic-recovery-upload", writeId: "synthetic-recovery-write",
    } });
    uploadRecovery.purge.mockReset();
    expect(await reconcileHostedRuntimeUploads({ prisma: first, now: new Date(), deadlineAtMs: Date.now() + 5_000, deletedUserId: userId })).toEqual({ recovered: 0, failed: 0 });
    expect(uploadRecovery.purge).not.toHaveBeenCalled();
    await retireHostedRuntime({ prisma: first, identity: current });
    await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: current, runnerContainerName: null });
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    uploadRecovery.purge.mockRejectedValueOnce(new Error("synthetic uncertain abort"));
    expect(await reconcileHostedRuntimeUploads({ prisma: first, now: new Date(), deadlineAtMs: Date.now() + 5_000, deletedUserId: userId })).toEqual({ recovered: 0, failed: 1 });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    uploadRecovery.purge.mockResolvedValueOnce(undefined);
    expect(await reconcileHostedRuntimeUploads({ prisma: first, now: new Date(), deadlineAtMs: Date.now() + 5_000, deletedUserId: userId })).toEqual({ recovered: 1, failed: 0 });
    expect(uploadRecovery.purge).toHaveBeenLastCalledWith({ userId, resource: {
      kind: "multipart", uploadId: "synthetic-recovery-upload", objectKey: (await observer.hostedRuntimeMedia.findUniqueOrThrow({ where: { userId_mediaId: { userId, mediaId: descriptor.mediaId } } })).objectKey,
    } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(true);
  });

  it("serializes competing claims on independent connections", async () => {
    const userId = await member();
    const locked = deferred();
    const release = deferred();
    const [firstPid, secondPid] = await Promise.all([backendPid(first), backendPid(second)]);
    const blocker = blockerClient.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, userId);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const a = claim(userId, first);
    const b = claim(userId, second);
    const settled = Promise.allSettled([a, b, blocker]);
    try {
      await Promise.all([waitBlocked(observer, firstPid), waitBlocked(observer, secondPid)]);
    } finally {
      release.resolve();
      await settled;
    }
    await blocker;
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.status).sort()).toEqual(["claimed", "existing"]);
    expect(results[0].owner.attemptId).toBe(results[1].owner.attemptId);
    expect(results[0].owner.generation).toBe(1n);
  });

  it("retains an uncertain exact target and rejects stale completion after replacement", async () => {
    const userId = await member();
    const original = identity((await claim(userId)).owner);
    await prepareHostedRuntimeLaunch({
      prisma: first, identity: original, runnerContainerName: "synthetic-slot-a",
      workspaceVersion: "0", customInferenceEnvelope: null,
      platformAiUsageAllowed: true, providerEgressTokenHash: null,
    });
    expect(await recordHostedRuntimeAccepted({ prisma: first, identity: original })).toBe(true);
    expect(await retireHostedRuntime({ prisma: first, identity: original })).toBe(true);
    expect((await claim(userId, second)).status).toBe("existing");
    expect(await releaseHostedRuntimeAfterRetirement({
      prisma: first, identity: original, runnerContainerName: "synthetic-slot-wrong",
    })).toBe(false);
    expect(await releaseHostedRuntimeAfterRetirement({
      prisma: first, identity: original, runnerContainerName: "synthetic-slot-a",
    })).toBe(true);
    const successor = (await claim(userId, second)).owner;
    expect(successor.generation).toBe(2n);
    expect(await retireHostedRuntime({ prisma: first, identity: original, completed: true })).toBe(false);
    expect(await observer.hostedRuntimeOwner.findUnique({ where: { userId } })).toMatchObject({
      attemptId: successor.attemptId, phase: "starting",
    });
  });

  it("preserves the warm assignment across completed generations without restoring old authority", async () => {
    const userId = await member();
    const originalOwner = (await claim(userId)).owner;
    const original = identity(originalOwner);
    await prepareHostedRuntimeLaunch({
      prisma: first, identity: original, runnerContainerName: "synthetic-warm-slot",
      workspaceVersion: "0", customInferenceEnvelope: null,
      platformAiUsageAllowed: true, providerEgressTokenHash: null,
    });
    await retireHostedRuntime({ prisma: first, identity: original });
    expect(await releaseHostedRuntimeAfterCompletion({ prisma: first, identity: original, runnerContainerName: "synthetic-warm-slot" })).toBe(false);
    await retireHostedRuntime({ prisma: first, identity: original, completed: true });
    expect(await releaseHostedRuntimeAfterCompletion({ prisma: first, identity: original, runnerContainerName: "wrong-slot" })).toBe(false);
    expect(await releaseHostedRuntimeAfterCompletion({ prisma: first, identity: original, runnerContainerName: "synthetic-warm-slot" })).toBe(true);
    const successor = (await claim(userId, second)).owner;
    expect(successor.generation).toBe(originalOwner.generation + 1n);
    expect(successor.runnerContainerName).toBe("synthetic-warm-slot");
    expect(successor.allocationId).toBe(originalOwner.allocationId);
    expect(successor.platformAiUsageAllowed).toBe(false);
    expect(successor.workspaceVersion).toBeNull();
    expect(await retireHostedRuntime({ prisma: first, identity: original, completed: true })).toBe(false);
    expect(await releaseHostedRuntimeAfterCompletion({ prisma: first, identity: original, runnerContainerName: "synthetic-warm-slot" })).toBe(false);
    await expect(first.$transaction((tx) => requireHostedRuntimeOwnerTx(tx, original))).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("records early completion without releasing the live invocation or retaining effect authority", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const runnerContainerName = "synthetic-early-completion-slot";
    const providerEgressTokenHash = "e".repeat(64);
    await prepareHostedRuntimeLaunch({ prisma: first, identity: runtime, runnerContainerName,
      workspaceVersion: "0", customInferenceEnvelope: null,
      platformAiUsageAllowed: true, providerEgressTokenHash });
    await recordHostedRuntimeAccepted({ prisma: first, identity: runtime });
    const notifiedOwners: HostedRuntimeOwner[] = [];
    completionNotification.notify.mockReset().mockImplementationOnce(async () => {
      notifiedOwners.push(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } }));
    });

    expect(await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command: {
      operation: "complete", ...runtime, settledRunnerContainerName: null, immediateRecheckRequested: false,
    } })).toMatchObject({ cutover: "postgres", status: "updated" });
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      phase: "retiring", attemptId: runtime.attemptId, generation: BigInt(runtime.generation),
      runnerContainerName, completedAt: expect.any(Date), platformAiUsageAllowed: false,
    });
    expect(notifiedOwners).toMatchObject([{ phase: "retiring", completedAt: expect.any(Date) }]);
    expect(completionNotification.notify).toHaveBeenCalledWith({
      userId, runtimeAttemptId: runtime.attemptId, immediateRecheckRequested: false,
    });
    expect((await claim(userId, second)).status).toBe("existing");
    expect(await authorizeHostedRuntimeProvider({ prisma: second, userId, runnerContainerName: null,
      providerEgressTokenHash, providerKind: "openai" })).toBeNull();
    await expect(second.$transaction(tx => requireHostedRuntimeOwnerTx(tx, runtime)))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });

    await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command: {
      operation: "complete", ...runtime, settledRunnerContainerName: "synthetic-wrong-slot", immediateRecheckRequested: false,
    } });
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      phase: "retiring", attemptId: runtime.attemptId, runnerContainerName,
    });
    expect(completionNotification.notify).toHaveBeenCalledTimes(1);
  });

  it("settles completion once while retaining the warm assignment and uncertain upload obligations", async () => {
    const userId = await member();
    const originalOwner = (await claim(userId)).owner;
    const runtime = identity(originalOwner);
    const runnerContainerName = "synthetic-completed-warm-slot";
    await prepareHostedRuntimeLaunch({ prisma: first, identity: runtime, runnerContainerName,
      workspaceVersion: "0", customInferenceEnvelope: "synthetic-inference-envelope",
      platformAiUsageAllowed: true, providerEgressTokenHash: "f".repeat(64) });
    const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId });
    await executeHostedRuntimeReplicaPutCommand({ prisma: first, userId, command: {
      operation: "admit", ...runtime, writeId: "synthetic-completion-single", objectKey: `${prefix}single.json`,
    } });
    await executeHostedRuntimeReplicaPutCommand({ prisma: first, userId, command: {
      operation: "admit", ...runtime, writeId: "synthetic-completion-multipart", objectKey: `${prefix}multipart.json`,
      multipart: { objectKey: `${prefix}multipart.json`, uploadId: "synthetic-completion-upload" },
    } });
    const command = { operation: "complete" as const, ...runtime, settledRunnerContainerName: runnerContainerName,
      immediateRecheckRequested: true };
    const notifiedOwners: HostedRuntimeOwner[] = [];
    completionNotification.notify.mockReset().mockImplementationOnce(async () => {
      notifiedOwners.push(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } }));
    });

    expect(await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command }))
      .toMatchObject({ cutover: "postgres", status: "updated" });
    const completedOwner = await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } });
    expect(completedOwner).toMatchObject({
      phase: "idle", attemptId: null, allocationId: originalOwner.allocationId, runnerContainerName,
      processingMode: null, workspaceVersion: null, customInferenceEnvelope: null,
      providerEgressTokenHash: null, platformAiUsageAllowed: false, completedAt: expect.any(Date),
    });
    expect(notifiedOwners).toEqual([completedOwner]);
    expect(completionNotification.notify).toHaveBeenCalledWith({
      userId, runtimeAttemptId: runtime.attemptId, immediateRecheckRequested: true,
    });
    const drains = await observer.hostedRuntimePutDrain.findMany({ where: { userId }, orderBy: { writeId: "asc" } });
    expect(drains).toHaveLength(2);
    expect(drains[0]).toMatchObject({ writeId: "replica:synthetic-completion-multipart",
      completedAt: null, drainUntil: null, uploadId: "synthetic-completion-upload" });
    expect(drains[1]).toMatchObject({ writeId: "replica:synthetic-completion-single",
      completedAt: null, drainUntil: expect.any(Date) });

    // A lost response can replay the command without renewing drains or restoring authority.
    expect(await executeHostedRuntimeOwnerCommand({ prisma: second, userId, command }))
      .toMatchObject({ status: "stale" });
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toEqual(completedOwner);
    expect(await observer.hostedRuntimePutDrain.findMany({ where: { userId }, orderBy: { writeId: "asc" } })).toEqual(drains);

    const successor = (await claim(userId, second)).owner;
    expect(successor).toMatchObject({
      generation: originalOwner.generation + 1n, runnerContainerName, allocationId: originalOwner.allocationId,
    });
    expect(await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command }))
      .toMatchObject({ status: "stale" });
    expect(await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command: {
      ...command, settledRunnerContainerName: null,
    } })).toMatchObject({ status: "stale" });
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toEqual(successor);
    expect(completionNotification.notify).toHaveBeenCalledTimes(1);
  });

  it("keeps an upload capability drain and orphan obligation after session and member deletion", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const session = await snapshotSession(runtime);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session } });
    expect(created.applied).toBe(true);
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: second, userId, command: { operation: "snapshot_create", session } })).applied).toBe(true);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const drainUntil = new Date(Date.now() + 120_000).toISOString();
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_admit_put", expectedSession: created.session!, expiresAt, drainUntil,
    } })).applied).toBe(true);
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_delete", ...runtime, snapshotId: session.snapshotId,
    } })).applied).toBe(true);
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await observer.hostedRuntimePutDrain.count({ where: { userId } })).toBe(1);
    expect(await observer.hostedRuntimeOrphan.count({ where: { userId } })).toBe(1);
    expect((await observer.hostedRuntimePutDrain.findFirstOrThrow({ where: { userId } })).drainUntil?.toISOString()).toBe(drainUntil);
  });

  it("serializes managed snapshot admission, binds immutable bytes and excludes direct PUT capabilities", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session: await snapshotSession(runtime) } });
    const command = { operation: "snapshot_managed_admit" as const, expectedSession: created.session!, uploadId: "synthetic-upload-a", encryptedByteSize: 4, encryptedSha256: "a".repeat(64) };
    const [a, b] = await Promise.all([
      executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command }),
      executeHostedRuntimeSnapshotCommand({ prisma: second, userId, command: { ...command, uploadId: "synthetic-upload-b" } }),
    ]);
    expect(a.applied && b.applied).toBe(true);
    expect(a.managedUpload).toEqual(b.managedUpload);
    expect(await observer.hostedRuntimePutDrain.count({ where: { userId } })).toBe(1);
    expect(a.managedUpload).toMatchObject({ encryptedByteSize: 4, encryptedSha256: "a".repeat(64), completedAt: null, verifiedAt: null });
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { ...command, encryptedSha256: "b".repeat(64) } })).applied).toBe(false);
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_admit_put", expectedSession: created.session!, expiresAt: new Date(Date.now() + 60_000).toISOString(), drainUntil: new Date(Date.now() + 120_000).toISOString(),
    } })).applied).toBe(false);
    const wrong = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_managed_settled", ...runtime, snapshotId: created.session!.snapshotId, uploadId: "wrong-upload", verified: true,
    } });
    expect(wrong.applied).toBe(false);
    expect((await observer.hostedRuntimePutDrain.findFirstOrThrow({ where: { userId } })).completedAt).toBeNull();
  });

  it("persists a declared MD5 with the managed receipt and keeps replays consistent with it", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session: await snapshotSession(runtime) } });
    const command = { operation: "snapshot_managed_admit" as const, expectedSession: created.session!, uploadId: "synthetic-upload-md5", encryptedByteSize: 4, encryptedSha256: "a".repeat(64), encryptedMd5: "c".repeat(32) };
    const admitted = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command });
    expect(admitted.applied).toBe(true);
    expect(admitted.managedUpload).toMatchObject({ encryptedMd5: "c".repeat(32) });
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command })).managedUpload).toEqual(admitted.managedUpload);
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { ...command, encryptedMd5: undefined } })).applied).toBe(true);
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { ...command, encryptedMd5: "d".repeat(32) } })).applied).toBe(false);
    const read = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_managed_read", ...runtime, snapshotId: created.session!.snapshotId } });
    expect(read.managedUpload?.encryptedMd5).toBe("c".repeat(32));
  });

  it("retains managed snapshot obligations after session deletion until exact abort or verified completion", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session: await snapshotSession(runtime) } });
    const admission = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_managed_admit", expectedSession: created.session!, uploadId: "synthetic-managed-upload", encryptedByteSize: 4, encryptedSha256: "a".repeat(64),
    } });
    expect(admission.applied).toBe(true);
    await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_delete", ...runtime, snapshotId: created.session!.snapshotId } });
    await retireHostedRuntime({ prisma: first, identity: runtime });
    await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime, runnerContainerName: null });
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    const settled = { operation: "snapshot_managed_settled" as const, ...runtime, snapshotId: created.session!.snapshotId, uploadId: "synthetic-managed-upload", verified: true };
    const completed = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: settled });
    expect(completed.managedUpload?.verifiedAt).not.toBeNull();
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(true);
    const lateAbort = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { ...settled, verified: false } });
    expect(lateAbort.managedUpload).toEqual(completed.managedUpload);
  });

  it("cannot turn an issued direct snapshot capability into a revocable managed upload", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session: await snapshotSession(runtime) } });
    const direct = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_admit_put", expectedSession: created.session!, expiresAt: new Date(Date.now() + 60_000).toISOString(), drainUntil: new Date(Date.now() + 120_000).toISOString(),
    } });
    expect((await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: {
      operation: "snapshot_managed_admit", expectedSession: direct.session!, uploadId: "synthetic-managed-upload", encryptedByteSize: 4, encryptedSha256: "a".repeat(64),
    } })).applied).toBe(false);
    expect((await observer.hostedRuntimePutDrain.findFirstOrThrow({ where: { userId } })).uploadId).toBeNull();
  });

  it("serializes revocation ahead of final PUT admission on independent connections", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const created = await executeHostedRuntimeSnapshotCommand({ prisma: first, userId, command: { operation: "snapshot_create", session: await snapshotSession(runtime) } });
    const locked = deferred();
    const release = deferred();
    const [firstPid, secondPid] = await Promise.all([backendPid(first), backendPid(second)]);
    const blocker = blockerClient.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM hosted_runtime_owner WHERE user_id = ${userId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const revocation = retireHostedRuntime({ prisma: first, identity: runtime });
    await waitBlocked(observer, firstPid);
    const admission = executeHostedRuntimeSnapshotCommand({ prisma: second, userId, command: {
      operation: "snapshot_admit_put", expectedSession: created.session!,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), drainUntil: new Date(Date.now() + 120_000).toISOString(),
    } });
    const settled = Promise.allSettled([blocker, revocation, admission]);
    try { await waitBlocked(observer, secondPid); }
    finally { release.resolve(); await settled; }
    expect(await revocation).toBe(true);
    await expect(admission).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    expect(await observer.hostedRuntimePutDrain.count({ where: { userId } })).toBe(0);
    await expect(executeHostedRuntimeSnapshotCommand({ prisma: second, userId, command: {
      operation: "snapshot_heartbeat", ...runtime, snapshotId: created.session!.snapshotId,
    } })).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("does not infer retirement from an old start timestamp", async () => {
    const userId = await member();
    const original = await claimHostedRuntime({
      prisma: first, userId, processingMode: "default", now: new Date("2020-01-01T00:00:00Z"),
    });
    expect(original.status).toBe("claimed");
    expect((await claim(userId, second)).status).toBe("existing");
  });

  it("keeps publication and revocation ordered under a row lock", async () => {
    const userId = await member();
    const owner = identity((await claim(userId)).owner);
    const secondPid = await backendPid(second);
    await observer.hostedWorkspace.create({ data: { userId } });
    const locked = deferred();
    const release = deferred();
    const publication = first.$transaction(async (tx) => {
      await requireHostedRuntimeOwnerTx(tx, owner);
      locked.resolve();
      await release.promise;
      await tx.hostedWorkspace.update({ where: { userId }, data: { version: { increment: 1 } } });
    });
    await locked.promise;
    const revocation = retireHostedRuntime({ prisma: second, identity: owner });
    const settled = Promise.allSettled([publication, revocation]);
    try {
      await waitBlocked(observer, secondPid);
    } finally {
      release.resolve();
      await settled;
    }
    await publication;
    expect(await revocation).toBe(true);
    expect((await observer.hostedWorkspace.findUniqueOrThrow({ where: { userId } })).version).toBe(1n);
    await expect(first.$transaction(async (tx) => {
      await requireHostedRuntimeOwnerTx(tx, owner);
      await tx.hostedWorkspace.update({ where: { userId }, data: { version: { increment: 1 } } });
    })).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("rolls back a fenced publication and releases its locks", async () => {
    const userId = await member();
    const owner = identity((await claim(userId)).owner);
    await observer.hostedWorkspace.create({ data: { userId } });
    await expect(first.$transaction(async (tx) => {
      await requireHostedRuntimeOwnerTx(tx, owner);
      await tx.hostedWorkspace.update({ where: { userId }, data: { version: 1n } });
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");
    expect((await observer.hostedWorkspace.findUniqueOrThrow({ where: { userId } })).version).toBe(0n);
    expect(await retireHostedRuntime({ prisma: second, identity: owner })).toBe(true);
  });

  it.each(["checkpoint", "revocation"])("orders the composed checkpoint when %s obtains its lock first", async (firstOperation) => {
    const userId = await member();
    const owner = identity((await claim(userId)).owner);
    await observer.hostedWorkspace.create({ data: { userId } });
    const [checkpointPid, revokePid] = await Promise.all([backendPid(first), backendPid(second)]);
    const locked = deferred();
    const release = deferred();
    const blocker = blockerClient.$transaction(async (tx) => {
      if (firstOperation === "checkpoint") {
        await tx.$queryRaw`SELECT user_id FROM hosted_workspace WHERE user_id = ${userId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT user_id FROM hosted_runtime_owner WHERE user_id = ${userId} FOR UPDATE`;
      }
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const checkpoint = () => checkpointHostedRuntimeWorkspace({
      prisma: first, userId, runtimeAuthority: { ...owner, workspaceVersion: "0" },
      expectedVersion: "0", reason: "canonical_runtime_commit",
      snapshotRef: { hash: "synthetic_checkpoint_hash", key: "bundles/vault/runtime-proof.bundle.json", size: 128, updatedAt: "2026-09-15T00:00:00Z" },
    });
    const revoke = () => retireHostedRuntime({ prisma: second, identity: owner });
    const firstResult = firstOperation === "checkpoint" ? checkpoint() : revoke();
    const firstSettled = Promise.allSettled([firstResult, blocker]);
    let nextResult: ReturnType<typeof checkpoint> | ReturnType<typeof revoke> | undefined;
    let nextSettled: Promise<unknown> | undefined;
    try {
      await waitBlocked(observer, firstOperation === "checkpoint" ? checkpointPid : revokePid);
      nextResult = firstOperation === "checkpoint" ? revoke() : checkpoint();
      nextSettled = Promise.allSettled([nextResult]);
      await waitBlocked(observer, firstOperation === "checkpoint" ? revokePid : checkpointPid);
    } finally {
      release.resolve();
      await Promise.all([firstSettled, nextSettled]);
    }
    const results = await Promise.allSettled([blocker, firstResult, nextResult]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe(firstOperation === "checkpoint" ? "fulfilled" : "rejected");
    expect((await observer.hostedWorkspace.findUniqueOrThrow({ where: { userId } })).version)
      .toBe(firstOperation === "checkpoint" ? 1n : 0n);
  });

  it("checks consent at admission while an admitted owner can finish", async () => {
    const userId = await member();
    await observer.hostedConsentGrant.create({ data: {
      memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "granted",
      documentVersionsJson: {}, source: "runtime_owner_proof", grantedAt: new Date(),
    } });
    const owner = identity((await claim(userId)).owner);
    await revokeHostedConsentScope({
      prisma: second, memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
    });
    await expect(first.$transaction((tx) => requireHostedRuntimeOwnerTx(tx, owner)))
      .resolves.toMatchObject({ attemptId: owner.attemptId });
    expect(await claimHostedRuntime({ prisma: first, userId, processingMode: "default" }))
      .toEqual({ status: "blocked", reason: "admission" });
  });

  it.each(["consent", "suspension", "billing"] as const)("keeps admitted provider work usable after %s changes and blocks the next run", async policy => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const tokenHash = "c".repeat(64);
    const runnerContainerName = "synthetic-admitted-slot";
    await prepareHostedRuntimeLaunch({ prisma: first, identity: runtime, runnerContainerName,
      workspaceVersion: "0", customInferenceEnvelope: null, platformAiUsageAllowed: true, providerEgressTokenHash: tokenHash });
    if (policy === "consent") {
      await observer.hostedConsentGrant.create({ data: {
        memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "granted",
        documentVersionsJson: {}, source: "runtime_owner_proof", grantedAt: new Date(),
      } });
      await revokeHostedConsentScope({ prisma: observer, memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE });
    } else {
      await observer.hostedMember.update({ where: { id: userId }, data: policy === "suspension"
        ? { suspendedAt: new Date() } : { billingStatus: "paused" } });
    }
    const tokenCommand = { operation: "authorize_provider" as const, runnerContainerName: null,
      providerEgressTokenHash: tokenHash, providerKind: "linq" };
    expect(await executeHostedRuntimeOwnerCommand({ prisma: second, userId, command: tokenCommand }))
      .toMatchObject({ cutover: "postgres", status: "authorized", owner: { attemptId: runtime.attemptId } });
    expect(await executeHostedRuntimeOwnerCommand({ prisma: second, userId,
      command: { operation: "authorize_effect", ...runtime, runnerContainerName, managedAi: false } }))
      .toMatchObject({ status: "authorized", owner: { attemptId: runtime.attemptId } });
    await retireHostedRuntime({ prisma: first, identity: runtime });
    expect(await executeHostedRuntimeOwnerCommand({ prisma: second, userId, command: tokenCommand }))
      .toMatchObject({ status: "blocked", owner: null });
    await expect(first.$transaction(tx => requireHostedRuntimeOwnerTx(tx, runtime)))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime, runnerContainerName });
    expect(await claimHostedRuntime({ prisma: first, userId, processingMode: "default" }))
      .toEqual({ status: "blocked", reason: "admission" });
  });

  it.each(["legacy", "draining"])("returns explicit %s routing without executing provider authorization", async phase => {
    const userId = await member();
    await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase } });
    try {
      for (const command of [
        { operation: "authorize_provider" as const, runnerContainerName: null, providerEgressTokenHash: "d".repeat(64), providerKind: "linq" },
        { operation: "authorize_effect" as const, attemptId: "synthetic-missing", generation: "1", runnerContainerName: null, managedAi: false },
      ]) {
        expect(await executeHostedRuntimeOwnerCommand({ prisma: first, userId, command }))
          .toEqual({ cutover: phase, status: "blocked", owner: null });
      }
    } finally {
      await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres" } });
    }
  });

  it("serializes consent withdrawal with a waiting claim", async () => {
    const userId = await member();
    await observer.hostedConsentGrant.create({ data: {
      memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "granted",
      documentVersionsJson: {}, source: "runtime_owner_proof", grantedAt: new Date(),
    } });
    const [revokerPid, claimantPid] = await Promise.all([backendPid(first), backendPid(second)]);
    const locked = deferred();
    const release = deferred();
    const blocker = blockerClient.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, userId);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const revocation = revokeHostedConsentScope({ prisma: first, memberId: userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE });
    const revocationSettled = Promise.allSettled([revocation, blocker]);
    let claiming: ReturnType<typeof claimHostedRuntime> | undefined;
    let claimSettled: Promise<unknown> | undefined;
    try {
      await waitBlocked(observer, revokerPid);
      claiming = claimHostedRuntime({ prisma: second, userId, processingMode: "default" });
      claimSettled = Promise.allSettled([claiming]);
      await waitBlocked(observer, claimantPid);
    } finally {
      release.resolve();
      await Promise.all([revocationSettled, claimSettled]);
    }
    await Promise.all([blocker, revocation]);
    expect(await claiming).toEqual({ status: "blocked", reason: "admission" });
  });

  it("never restores revoked AI permission on a lost launch-ack retry", async () => {
    const userId = await member();
    const owner = identity((await claim(userId)).owner);
    const launch = {
      prisma: first, identity: owner, runnerContainerName: "synthetic-retry-slot",
      workspaceVersion: "0", customInferenceEnvelope: null,
      platformAiUsageAllowed: true, providerEgressTokenHash: null,
    };
    await prepareHostedRuntimeLaunch(launch);
    await second.$transaction((tx) => revokeHostedRuntimeAiUsageTx(tx, owner));
    expect((await prepareHostedRuntimeLaunch(launch)).platformAiUsageAllowed).toBe(false);
    await expect(prepareHostedRuntimeLaunch({ ...launch, runnerContainerName: "synthetic-wrong-slot" }))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("preserves cleanup targets after canonical account deletion", async () => {
    const userId = await member();
    const owner = identity((await claim(userId)).owner);
    await prepareHostedRuntimeLaunch({
      prisma: first, identity: owner, runnerContainerName: "synthetic-deletion-slot",
      workspaceVersion: "0", customInferenceEnvelope: null,
      platformAiUsageAllowed: false, providerEgressTokenHash: null,
    });
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await observer.hostedRuntimeOwner.findUnique({ where: { userId } }))
      .toMatchObject({ runnerContainerName: "synthetic-deletion-slot" });
    expect(await authorizeHostedRuntimeProvider({ prisma: first, userId,
      runnerContainerName: "synthetic-deletion-slot", providerEgressTokenHash: null, providerKind: "openai" })).toBeNull();
    await expect(first.$transaction((tx) => requireHostedRuntimeOwnerTx(tx, owner)))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
  });

  it("protects canonical snapshot payloads and rejects publication after cleanup retirement", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const ref = { hash: "synthetic_retained_bundle", key: "bundles/vault/retained-proof.bundle.json", size: 128, updatedAt: "2026-09-15T00:00:00Z" };
    const future = new Date(Date.now() + 2 * 3_600_000);
    await observer.hostedWorkspace.create({ data: { userId } });
    await first.$transaction(async tx => {
      await requireHostedRuntimeOwnerTx(tx, runtime);
      await recordRuntimeOrphansTx(tx, userId, snapshotOrphanCandidates(ref), new Date());
    });
    await checkpointHostedRuntimeWorkspace({ prisma: first, userId, runtimeAuthority: { ...runtime, workspaceVersion: "0" }, expectedVersion: "0", reason: "canonical_runtime_commit", snapshotRef: ref });
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: future })).orphans.filter(row => row.userId === userId)).toHaveLength(0);
    expect(await observer.hostedRuntimeOrphan.findFirstOrThrow({ where: { userId } })).toMatchObject({ retiredAt: null });
    await checkpointHostedRuntimeWorkspace({ prisma: first, userId, runtimeAuthority: { ...runtime, workspaceVersion: "1" }, expectedVersion: "1", reason: "canonical_runtime_commit", snapshotRef: null });
    const now = new Date(future.getTime() + 2 * 3_600_000);
    const retired = (await claimHostedRuntimeResourceCleanup({ prisma: second, now })).orphans.find(row => row.userId === userId);
    if (!retired) throw new Error("Expected an orphan cleanup receipt.");
    await expect(checkpointHostedRuntimeWorkspace({ prisma: first, userId, runtimeAuthority: { ...runtime, workspaceVersion: "2" }, expectedVersion: "2", reason: "canonical_runtime_commit", snapshotRef: ref }))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED" });
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now })).orphans.find(row => row.userId === userId)?.revision).toBe(retired.revision);
    expect(await acknowledgeHostedRuntimeOrphanPurge({ prisma: first, orphan: retired, now })).toBe(true);
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now })).orphans.some(row => row.userId === userId)).toBe(false);
  });

  it.each(["none", "soon", "unknown"] as const)("retains a replaced v2 snapshot without extending %s content expiry", async (expiry) => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const session = await snapshotSession(runtime);
    const ref = {
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      userId, snapshotId: session.snapshotId, objectKey: session.objectKey,
      createdAt: session.createdAt, encryption: { ...session.encryption, ivBase64: Buffer.alloc(12).toString("base64url") },
      upload: "direct-r2-presigned-put" as const,
      archive: { compression: "zstd" as const, format: "tar" as const,
        encryptedByteSize: 128, encryptedObjectSha256: "a".repeat(64),
        plaintextArchiveSha256: "b".repeat(64), fileCount: 5, totalPlainBytes: 256 },
    };
    const contentExpiry = new Date(Date.now() + 30 * 60_000);
    await observer.hostedWorkspace.create({ data: { userId } });
    await checkpointHostedRuntimeWorkspace({ prisma: first, userId, runtimeAuthority: { ...runtime, workspaceVersion: "0" }, expectedVersion: "0", reason: "idle_shutdown", snapshotRef: ref,
      ...(expiry === "unknown" ? {} : { inboxMediaRetentionWakeAt: expiry === "none" ? null : contentExpiry }),
    });
    const retained = await observer.hostedRuntimeOrphan.findFirstOrThrow({ where: { userId, kind: "snapshot" } });
    expect(retained.snapshotRef).toEqual(ref);
    if (expiry === "none") expect(retained.cleanupAt.getTime()).toBe(Date.parse(ref.createdAt) + HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS);
    if (expiry === "soon") expect(retained.cleanupAt).toEqual(contentExpiry);
    if (expiry === "unknown") expect(retained.cleanupAt.getTime() - retained.createdAt.getTime()).toBe(65 * 60_000);
    // A current snapshot stays protected, but moving its cleanup retry must
    // not extend the archive's fixed recovery deadline when it is replaced.
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: retained.cleanupAt })).orphans.some(row => row.userId === userId)).toBe(false);
    const deferred = await observer.hostedRuntimeOrphan.findFirstOrThrow({ where: { userId, kind: "snapshot" } });
    expect(deferred.cleanupAt.getTime()).toBeGreaterThan(retained.cleanupAt.getTime());
    expect(deferred.recoveryUntil).toEqual(retained.cleanupAt);
    await checkpointHostedRuntimeWorkspace({ prisma: first, userId, runtimeAuthority: { ...runtime, workspaceVersion: "1" }, expectedVersion: "1", reason: "canonical_runtime_commit", snapshotRef: null });
    const lateAt = new Date();
    await first.$transaction(async tx => {
      await requireHostedRuntimeOwnerTx(tx, runtime);
      await recordRuntimeOrphansTx(tx, userId, [{ kind: "snapshot", resourceId: ref.snapshotId,
        objectKey: ref.objectKey, snapshotRef: Prisma.DbNull }], lateAt);
    });
    const afterLateRecord = await observer.hostedRuntimeOrphan.findFirstOrThrow({ where: { userId, kind: "snapshot" } });
    expect(afterLateRecord.snapshotRef).toEqual(ref);
    expect(afterLateRecord.cleanupAt).toEqual(retained.cleanupAt);
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: new Date(afterLateRecord.cleanupAt.getTime() - 1) })).orphans.some(row => row.userId === userId)).toBe(false);
    const retired = (await claimHostedRuntimeResourceCleanup({ prisma: second, now: afterLateRecord.cleanupAt })).orphans.find(row => row.userId === userId);
    expect(retired).toBeDefined();
    expect(retired?.snapshotRef).toEqual(ref);
    expect(retired?.retiredAt).not.toBeNull();
  });

  it.each([14, 30, 90])("registers successful media with its %i-day retention instead of the orphan deadline", async days => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
    const descriptor = { mediaId: "a".repeat(64), mediaKind: days === 30 ? "video" as const : "image" as const,
      byteSize: 12, sha256: "b".repeat(64), expiresAt };
    const run = (command: Parameters<typeof executeHostedRuntimeMediaCommand>[0]["command"], at = now) =>
      executeHostedRuntimeMediaCommand({ prisma: first, userId, command, now: at });
    await run({ operation: "admit_put", ...runtime, descriptor, writeId: "retention-write", uploadId: "retention-upload" });
    await run({ operation: "release_put", mediaId: descriptor.mediaId, writeId: "retention-write" });
    await run({ operation: "register", ...runtime, descriptor });
    const afterGrace = new Date(now.getTime() + 66 * 60_000);
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: afterGrace })).media
      .filter(row => row.userId === userId)).toHaveLength(0);
    expect(await run({ operation: "read", descriptor }, afterGrace)).toMatchObject({ applied: true, reason: "active" });
    // A subsequent registration still cannot extend an established finite expiry.
    await run({ operation: "register", ...runtime, descriptor: { ...descriptor,
      expiresAt: new Date(now.getTime() + (days + 1) * 86_400_000).toISOString() } });
    expect(await observer.hostedRuntimeMedia.findUniqueOrThrow({ where: { userId_mediaId: { userId, mediaId: descriptor.mediaId } } }))
      .toMatchObject({ expiresAt: new Date(expiresAt), retiredAt: null });
    expect(await run({ operation: "read", descriptor }, new Date(expiresAt))).toMatchObject({ applied: false, reason: "expired" });
  });

  it("cleans up completed uploads that never register after the orphan grace", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const now = new Date();
    const descriptor = { mediaId: "a".repeat(64), mediaKind: "image" as const, byteSize: 12,
      sha256: "b".repeat(64), expiresAt: new Date(now.getTime() + 90 * 86_400_000).toISOString() };
    await executeHostedRuntimeMediaCommand({ prisma: first, userId, now,
      command: { operation: "admit_put", ...runtime, descriptor, writeId: "abandoned-write", uploadId: "abandoned-upload" } });
    await executeHostedRuntimeMediaCommand({ prisma: first, userId, now,
      command: { operation: "release_put", mediaId: descriptor.mediaId, writeId: "abandoned-write" } });
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: new Date(now.getTime() + 66 * 60_000) })).media
      .filter(row => row.userId === userId)).toHaveLength(1);
    expect(await executeHostedRuntimeMediaCommand({ prisma: first, userId,
      command: { operation: "register", ...runtime, descriptor } })).toMatchObject({ applied: false, reason: "expired" });
  });

  it("keeps media retirement terminal and fences purge acknowledgements after a late upload", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const descriptor = { mediaId: "a".repeat(64), mediaKind: "image" as const, byteSize: 12, sha256: "b".repeat(64), expiresAt: null };
    const run = (command: Parameters<typeof executeHostedRuntimeMediaCommand>[0]["command"]) =>
      executeHostedRuntimeMediaCommand({ prisma: first, userId, command });
    expect(await run({ operation: "read", descriptor })).toMatchObject({ applied: true, reason: "unregistered" });
    await run({ operation: "register", ...runtime, descriptor });
    const retired = await run({ operation: "retire", ...runtime, mediaId: descriptor.mediaId });
    if (!retired.purge) throw new Error("Expected a durable purge receipt.");
    expect(await run({ operation: "acknowledge_purge", purge: retired.purge })).toMatchObject({ applied: true });
    const lateUpload = await run({ operation: "register", ...runtime, descriptor });
    expect(lateUpload).toMatchObject({ applied: false, reason: "expired" });
    if (!lateUpload.purge) throw new Error("Expected a rearmed purge receipt.");
    expect(lateUpload.purge.revision).not.toBe(retired.purge.revision);
    expect(await run({ operation: "acknowledge_purge", purge: retired.purge })).toMatchObject({ applied: false });
    expect(await run({ operation: "read", descriptor })).toMatchObject({ applied: false, reason: "expired" });
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await observer.hostedRuntimeMedia.findUnique({ where: { userId_mediaId: { userId, mediaId: descriptor.mediaId } } }))
      .toMatchObject({ retiredAt: expect.any(Date), purgedAt: null });
    expect(await run({ operation: "acknowledge_purge", purge: lateUpload.purge })).toMatchObject({ applied: true });
  });

  it("serializes expired-media retirement with a racing preservation registration", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const descriptor = { mediaId: "c".repeat(64), mediaKind: "video" as const, byteSize: 21, sha256: "d".repeat(64), expiresAt: "2026-01-01T00:00:00.000Z" };
    await executeHostedRuntimeMediaCommand({ prisma: observer, userId, command: { operation: "register", ...runtime, descriptor } });
    const [firstPid, secondPid] = await Promise.all([backendPid(first), backendPid(second)]);
    const locked = deferred();
    const release = deferred();
    const blocker = blockerClient.$transaction(async (tx) => {
      await lockHostedRuntimeMediaTx(tx, userId, descriptor.mediaId);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const retirement = executeHostedRuntimeMediaCommand({ prisma: first, userId, command: { operation: "read", descriptor } });
    const settling = Promise.allSettled([retirement, blocker]);
    let registration: ReturnType<typeof executeHostedRuntimeMediaCommand> | undefined;
    let registered: Promise<unknown> | undefined;
    try {
      await waitBlocked(observer, firstPid);
      registration = executeHostedRuntimeMediaCommand({ prisma: second, userId, command: { operation: "register", ...runtime, descriptor: { ...descriptor, expiresAt: null } } });
      registered = Promise.allSettled([registration]);
      await waitBlocked(observer, secondPid);
    } finally {
      release.resolve();
      await Promise.all([settling, registered]);
    }
    expect(await retirement).toMatchObject({ applied: false, reason: "expired" });
    expect(await registration).toMatchObject({ applied: false, reason: "expired" });
  });

  it("admits account cleanup only after membership, exact target, and upload drains are gone", async () => {
    const userId = await member();
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    const runtime = identity((await claim(userId)).owner);
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    await retireHostedRuntime({ prisma: first, identity: runtime });
    await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime, runnerContainerName: null });
    await observer.hostedRuntimePutDrain.create({ data: { ...runtime, generation: BigInt(runtime.generation),
      writeId: "snapshot:synthetic-deletion", kind: "snapshot", admittedAt: new Date(), drainUntil: new Date(Date.now() + 60_000) } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(false);
    await observer.hostedRuntimePutDrain.updateMany({ where: { userId }, data: { completedAt: new Date() } });
    expect(await isHostedRuntimeDeletionReady({ prisma: first, userId })).toBe(true);
  });

  it("records media before PUT and retains uncertain writes across retirement and deletion", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const now = new Date();
    const descriptor = { mediaId: "e".repeat(64), mediaKind: "image" as const,
      byteSize: 30, sha256: "f".repeat(64), expiresAt: null };
    const command = { operation: "admit_put" as const, uploadId: "synthetic-upload", ...runtime, writeId: "synthetic-media-write", descriptor };
    expect(await executeHostedRuntimeMediaCommand({ prisma: first, userId, command, now })).toMatchObject({ applied: true });
    expect(await executeHostedRuntimeMediaCommand({ prisma: first, userId, command, now })).toMatchObject({ applied: false });
    expect(await executeHostedRuntimeMediaCommand({ prisma: second, userId, command: {
      operation: "retire", ...runtime, mediaId: descriptor.mediaId,
    }, now })).toMatchObject({ applied: true, purge: null });
    const sweepAt = new Date(now.getTime() + 2 * 60 * 60_000);
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: sweepAt })).media
      .filter(row => row.userId === userId)).toEqual([]);
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await executeHostedRuntimeMediaCommand({ prisma: second, userId, command: {
      operation: "release_put", writeId: command.writeId, mediaId: descriptor.mediaId,
    }, now: sweepAt })).toMatchObject({ applied: true });
    const nextSweepAt = new Date(sweepAt.getTime() + 60_000);
    const cleanup = await claimHostedRuntimeResourceCleanup({ prisma: second, now: nextSweepAt });
    expect(cleanup.media.filter(row => row.userId === userId)).toHaveLength(1);
    // A failed purge is paced using metadata, so it cannot dominate every sweep.
    expect((await claimHostedRuntimeResourceCleanup({ prisma: second, now: sweepAt })).media
      .filter(row => row.userId === userId)).toEqual([]);
  });

  it("records one failure per exact attempt without releasing it or touching its successor", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const failure = () => recordHostedRuntimeFailure({ prisma: first, identity: runtime, errorCode: "runtime_phase:mailbox.import.initial" });
    expect(await failure()).toBe(true);
    expect(await failure()).toBe(false);
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      phase: "starting", attemptId: runtime.attemptId, failureCount: 1,
      lastErrorCode: "runtime_phase:mailbox.import.initial",
    });
    await retireHostedRuntime({ prisma: first, identity: runtime });
    await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime, runnerContainerName: null });
    const successor = (await claim(userId)).owner!;
    expect(await failure()).toBe(false);
    expect(await observer.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      attemptId: successor.attemptId, lastErrorCode: null, failureCount: 1,
    });
  });

  it("keeps concurrent replica PUTs independent through revocation and account deletion", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    await prepareHostedRuntimeLaunch({ prisma: first, identity: runtime,
      runnerContainerName: "synthetic-replica-slot", workspaceVersion: "0",
      customInferenceEnvelope: null, platformAiUsageAllowed: true, providerEgressTokenHash: null });
    const prefix = await hostedBrowserVaultReplicaUserPrefix({ userId });
    const admit = (writeId: string) => executeHostedRuntimeReplicaPutCommand({ prisma: first, userId,
      command: { operation: "admit", ...runtime, writeId, objectKey: `${prefix}${writeId}` } });
    const release = (writeId: string) => executeHostedRuntimeReplicaPutCommand({ prisma: second, userId,
      command: { operation: "release", writeId } });
    expect(await admit("synthetic-write-a")).toEqual({ applied: true });
    expect(await admit("synthetic-write-b")).toEqual({ applied: true });
    expect(await executeHostedRuntimeReplicaPutCommand({ prisma: first, userId, command: {
      operation: "admit", ...runtime, writeId: "synthetic-multipart-write", objectKey: `${prefix}synthetic-root.json`,
      multipart: { objectKey: `${prefix}synthetic-root.json`, uploadId: "synthetic-upload" },
    } })).toEqual({ applied: true });
    const multipartOutstanding = () => observer.hostedRuntimePutDrain.findUniqueOrThrow({ where: {
      userId_writeId: { userId, writeId: "replica:synthetic-multipart-write" },
    } });
    expect(await admit("synthetic-write-a")).toEqual({ applied: false });
    expect(await release("synthetic-write-a")).toEqual({ applied: true });
    const outstanding = () => observer.hostedRuntimePutDrain.findUniqueOrThrow({ where: {
      userId_writeId: { userId, writeId: "replica:synthetic-write-b" },
    } });
    expect(await outstanding()).toMatchObject({ completedAt: null, drainUntil: null });
    await retireHostedRuntime({ prisma: first, identity: runtime });
    await expect(admit("synthetic-write-c")).rejects.toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE" });
    expect(await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime,
      runnerContainerName: "wrong-slot" })).toBe(false);
    expect(await outstanding()).toMatchObject({ completedAt: null, drainUntil: null });
    expect(await releaseHostedRuntimeAfterRetirement({ prisma: first, identity: runtime,
      runnerContainerName: "synthetic-replica-slot" })).toBe(true);
    expect((await outstanding()).drainUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await multipartOutstanding()).toMatchObject({ completedAt: null, drainUntil: null, uploadId: "synthetic-upload" });
    await observer.hostedMember.delete({ where: { id: userId } });
    expect(await release("synthetic-write-b")).toEqual({ applied: true });
    expect(await multipartOutstanding()).toMatchObject({ completedAt: null, drainUntil: null });
    expect(await release("synthetic-multipart-write")).toEqual({ applied: true });
    expect(await outstanding()).toMatchObject({ completedAt: expect.any(Date) });
  });

  it("binds provider credentials and delayed retirement to the current immutable target", async () => {
    const userId = await member();
    const runtime = identity((await claim(userId)).owner);
    const tokenHash = "a".repeat(64);
    await prepareHostedRuntimeLaunch({ prisma: first, identity: runtime,
      runnerContainerName: "synthetic-provider-slot", workspaceVersion: "0",
      customInferenceEnvelope: null, platformAiUsageAllowed: true, providerEgressTokenHash: tokenHash });
    const authorize = (runnerContainerName: string | null, providerEgressTokenHash: string | null = null) =>
      authorizeHostedRuntimeProvider({ prisma: second, userId, runnerContainerName, providerEgressTokenHash, providerKind: "openai" });
    expect(await authorize("wrong-slot")).toBeNull();
    expect(await authorize(null, "b".repeat(64))).toBeNull();
    expect(await authorize(null, tokenHash)).toMatchObject({ attemptId: runtime.attemptId, platformAiUsageAllowed: true });
    await first.$transaction(tx => revokeHostedRuntimeAiUsageTx(tx, runtime));
    expect(await authorize("synthetic-provider-slot")).toMatchObject({ platformAiUsageAllowed: false });
    expect(await recordHostedRuntimeTargetRetired({ prisma: first, userId, runnerContainerName: "wrong-slot" })).toBe(false);
    expect(await recordHostedRuntimeTargetRetired({ prisma: first, userId, runnerContainerName: "synthetic-provider-slot" })).toBe(true);
    expect(await authorize(null, tokenHash)).toBeNull();
    const successor = identity((await claim(userId)).owner);
    await prepareHostedRuntimeLaunch({ prisma: first, identity: successor,
      runnerContainerName: "synthetic-successor-slot", workspaceVersion: "0",
      customInferenceEnvelope: null, platformAiUsageAllowed: true, providerEgressTokenHash: null });
    expect(await recordHostedRuntimeTargetRetired({ prisma: first, userId, runnerContainerName: "synthetic-provider-slot" })).toBe(false);
    expect(await authorize("synthetic-successor-slot")).toMatchObject({ attemptId: successor.attemptId });
    await observer.hostedMember.update({ where: { id: userId }, data: { suspendedAt: new Date() } });
    expect(await authorize("synthetic-successor-slot")).toMatchObject({ attemptId: successor.attemptId });
    expect(await claimHostedRuntime({ prisma: first, userId, processingMode: "default" }))
      .toEqual({ status: "blocked", reason: "admission" });
  });

  it("blocks claims during draining without consuming a generation", async () => {
    const userId = await member();
    await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "draining" } });
    try {
      expect(await claimHostedRuntime({ prisma: first, userId, processingMode: "default" }))
        .toEqual({ status: "blocked", reason: "cutover" });
      expect(await observer.hostedRuntimeOwner.findUnique({ where: { userId } })).toBeNull();
    } finally {
      await observer.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres" } });
    }
  });
});

function identity(owner: HostedRuntimeOwner): HostedRuntimeIdentity {
  if (!owner.attemptId) throw new Error("Expected a claimed runtime.");
  return { userId: owner.userId, attemptId: owner.attemptId, generation: owner.generation.toString() };
}

async function backendPid(client: PrismaClient): Promise<number> {
  const [row] = await client.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  if (!row) throw new Error("Missing PostgreSQL backend.");
  return row.pid;
}

async function waitBlocked(observer: PrismaClient, pid: number, blockerPid?: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await observer.$queryRaw<Array<{ blockers: number[] }>>`
      SELECT pg_blocking_pids(${pid}::integer) AS blockers
    `;
    if (row && (blockerPid === undefined ? row.blockers.length > 0 : row.blockers.includes(blockerPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The competing operation did not reach the expected PostgreSQL lock.");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

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
