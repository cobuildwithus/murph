import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  checkpoint: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: mocks.transaction }),
}));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({
  requireHostedRuntimeCallbackTx: mocks.requireOwner,
}));
vi.mock("@/src/lib/hosted-workspace/store", () => ({
  checkpointHostedWorkspaceTx: mocks.checkpoint,
}));

import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";
import { recordPrismaOperationTiming, startPrismaPoolAcquisitionTiming } from "@/src/lib/prisma-operation-timing";

describe("slow workspace checkpoint diagnostics", () => {
  const input = {
    userId: "member_synthetic_checkpoint",
    runtimeAuthority: null,
    expectedVersion: "0",
    reason: "canonical_runtime_commit" as const,
    snapshotRef: null,
  };
  const result = { status: "conflict", workspace: null };
  let now = 0;

  beforeEach(() => {
    vi.resetAllMocks();
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.requireOwner.mockResolvedValue(null);
    mocks.checkpoint.mockResolvedValue(result);
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => {
      now += 200;
      const value = await callback({});
      now += 100;
      return value;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("separates acquisition, database operations, callback, and commit without logging inputs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mocks.checkpoint.mockImplementation(async () => {
      const acquired = startPrismaPoolAcquisitionTiming({ idleConnections: 0, totalConnections: 1, waitingRequests: 0 });
      now += 50;
      acquired?.();
      now += 1_450;
      recordPrismaOperationTiming("HostedWorkspace.updateMany", 1_450);
      return result;
    });

    await expect(checkpointHostedRuntimeWorkspace(input)).resolves.toBe(result);
    expect(log).toHaveBeenCalledExactlyOnceWith("Hosted workspace slow checkpoint database timing.", {
      completed: true,
      totalMs: 1_800,
      transactionAcquireMs: 200,
      transactionCallbackMs: 1_500,
      transactionFinishMs: 100,
      poolAcquisitionCount: 1,
      poolAcquireMs: [50],
      poolBeforeAcquire: [{ idleConnections: 0, totalConnections: 1, waitingRequests: 0 }],
      dbOperationCount: 1,
      dbTotalMs: 1_450,
      "db00.HostedWorkspace.updateMany": 1_450,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.userId);
  });

  it("leaves fast checkpoints quiet", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: object) => Promise<unknown>) => {
      now += 100;
      return callback({});
    });
    await expect(checkpointHostedRuntimeWorkspace(input)).resolves.toBe(result);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports sub-second checkpoint stalls at the callback timing threshold", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(checkpointHostedRuntimeWorkspace(input)).resolves.toBe(result);
    expect(log).toHaveBeenCalledWith("Hosted workspace slow checkpoint database timing.", expect.objectContaining({ totalMs: 300 }));
  });

  it("preserves a failed checkpoint even if diagnostic output fails", async () => {
    const failure = new Error("Synthetic checkpoint failure");
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("Synthetic logging failure");
    });
    mocks.checkpoint.mockImplementation(async () => {
      now += 1_500;
      throw failure;
    });
    await expect(checkpointHostedRuntimeWorkspace(input)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith("Hosted workspace slow checkpoint database timing.", expect.objectContaining({
      completed: false,
      totalMs: 1_700,
      transactionAcquireMs: 200,
      transactionCallbackMs: 1_500,
      transactionFinishMs: 0,
    }));
  });

  it.each(["same", "different", "metadata-change"])("skips cleanup bookkeeping only for unchanged snapshots (%s)", async (scenario) => {
    const unchanged = scenario === "same";
    const snapshot = { hash: "a".repeat(64), size: 512, key: "synthetic-current", updatedAt: "2026-09-25T00:00:00.000Z" };
    const previous = unchanged ? snapshot
      : scenario === "metadata-change" ? { ...snapshot, updatedAt: "2026-09-24T00:00:00.000Z" }
      : { ...snapshot, hash: "b".repeat(64), key: "synthetic-previous", size: 256 };
    const orphan = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    };
    mocks.requireOwner.mockResolvedValue({});
    mocks.checkpoint.mockResolvedValue({ status: "updated", replacedSnapshotRef: previous });
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback({ hostedRuntimeOrphan: orphan }));

    await checkpointHostedRuntimeWorkspace({ ...input, snapshotRef: snapshot });

    expect(orphan.findFirst).toHaveBeenCalledOnce();
    expect(orphan.findUnique).toHaveBeenCalledTimes(unchanged ? 0 : 2);
    expect(orphan.upsert).toHaveBeenCalledTimes(unchanged ? 0 : 2);
    const persisted = orphan.upsert.mock.calls.map(([call]) => call.create.snapshotRef);
    expect(persisted).toEqual(unchanged ? [] : [snapshot, previous]);
  });


  it("still rejects retired archives before publication or cleanup writes", async () => {
    const snapshot = { hash: "a".repeat(64), size: 512, key: "synthetic-retired", updatedAt: "2026-09-25T00:00:00.000Z" };
    const orphan = { findFirst: vi.fn().mockResolvedValue({ resourceId: "synthetic-retired" }), upsert: vi.fn() };
    mocks.requireOwner.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback({ hostedRuntimeOrphan: orphan }));
    await expect(checkpointHostedRuntimeWorkspace({ ...input, snapshotRef: snapshot }))
      .rejects.toMatchObject({ code: "HOSTED_RUNTIME_RESOURCE_RETIRED" });
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(orphan.upsert).not.toHaveBeenCalled();
  });


  it("leaves an unchanged v2 archive and its recovery deadline untouched", async () => {
    const schema = "murph.hosted-workspace-snapshot.v2";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId: "synthetic" });
    const snapshot = {
      schema, userId: input.userId, snapshotId: "synthetic", objectKey,
      createdAt: "2026-09-25T00:00:00.000Z", upload: "direct-r2-presigned-put",
      encryption: {
        scheme: "murph.hosted-workspace-snapshot-single-object.v1",
        aad: { schema, purpose: "workspace-snapshot", userId: input.userId, snapshotId: "synthetic", objectKey },
        ivBase64: Buffer.alloc(12).toString("base64url"), rootKeyId: "synthetic-root", wrappedDataKey: "synthetic-wrapped-key",
      },
      archive: { compression: "zstd", format: "tar", encryptedByteSize: 128,
        encryptedObjectSha256: "a".repeat(64), plaintextArchiveSha256: "b".repeat(64),
        fileCount: 1, totalPlainBytes: 256 },
    };
    const recoveryUntil = new Date("2026-09-25T01:00:00.000Z");
    const orphan = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ objectKey, recoveryUntil }),
      upsert: vi.fn().mockResolvedValue({}),
    };
    mocks.requireOwner.mockResolvedValue({});
    mocks.checkpoint.mockResolvedValue({ status: "updated", replacedSnapshotRef: snapshot });
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback({ hostedRuntimeOrphan: orphan }));
    await checkpointHostedRuntimeWorkspace({ ...input, snapshotRef: snapshot });
    expect(orphan.findFirst).toHaveBeenCalledOnce();
    expect(orphan.findUnique).not.toHaveBeenCalled();
    expect(orphan.upsert).not.toHaveBeenCalled();
  });

});
