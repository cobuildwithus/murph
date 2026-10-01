import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeReplicaWriteBucket } from "../src/runtime-replica-upload.ts";
import { purgeHostedRuntimeResource } from "../src/worker/route-handlers/runtime-resource-purge.ts";
import { hostedBrowserVaultReplicaUserPrefix, listHostedBrowserVaultReplicaSiblingObjectKeys } from "../src/storage-paths.ts";
import * as resourceClient from "../src/runtime-resource-client.ts";

afterEach(() => vi.restoreAllMocks());
describe("recoverable replica shards", () => {
  async function fixture(failure?: "unknown" | "aborted" | "admission" | "settlement") {
    const userId = "synthetic_replica_member";
    const root = `${await hostedBrowserVaultReplicaUserPrefix({ userId })}synthetic-root.json`;
    const objectKeys = [root, ...listHostedBrowserVaultReplicaSiblingObjectKeys(root)];
    const commands = vi.spyOn(resourceClient, "commandHostedRuntimeReplicaPut").mockImplementation(async ({ command }) => {
      if (failure === "admission" && command.operation === "admit_batch") throw new Error("lost admission response");
      if (failure === "settlement" && command.operation === "release_batch") throw new Error("lost settlement response");
      return true;
    });
    const sent: string[] = [];
    const aborted: string[] = [];
    let activeCreates = 0;
    let peakCreates = 0;
    const bucket = {
      get: async () => null, put: vi.fn(async () => {}), resumeMultipartUpload: vi.fn(),
      createMultipartUpload: async (objectKey: string) => {
        peakCreates = Math.max(peakCreates, ++activeCreates);
        await Promise.resolve();
        activeCreates--;
        return { uploadId: `upload-${objectKeys.indexOf(objectKey)}`,
          uploadPart: async () => {
            expect(commands.mock.calls[0]?.[0].command.operation).toBe("admit_batch");
            sent.push(objectKey);
            return { partNumber: 1, etag: "synthetic-etag" };
          },
          complete: async () => { if (objectKey === root && (failure === "unknown" || failure === "aborted")) throw new Error("unknown complete"); },
          abort: async () => {
            aborted.push(objectKey);
            if (objectKey === root && (failure === "unknown" || failure === "admission")) throw new Error("unknown abort");
          },
        };
      },
    };
    const writes = createRuntimeReplicaWriteBucket({ source: { BUNDLES: bucket }, userId, attemptId: "synthetic-attempt", generation: "4" });
    return { root, objectKeys, commands, sent, aborted, bucket, writes, peak: () => peakCreates };
  }

  it("admits and settles all 36 physical writes in two Web requests", async () => {
    const f = await fixture();
    await f.writes.admit(f.root);
    expect(f.peak()).toBe(4);
    for (const key of f.objectKeys) await f.writes.bucket.put(key, "encrypted");
    await f.writes.settle();
    expect(f.sent).toEqual(f.objectKeys);
    expect(f.commands).toHaveBeenCalledTimes(2);
    const admission = f.commands.mock.calls[0]![0].command;
    const settlement = f.commands.mock.calls[1]![0].command;
    expect(admission.operation).toBe("admit_batch");
    if (admission.operation !== "admit_batch") throw new Error("Expected admission batch");
    expect(admission.uploads).toHaveLength(36);
    expect(new Set(admission.uploads.map(upload => upload.writeId)).size).toBe(36);
    expect(settlement).toEqual({ operation: "release_batch", writeIds: admission.uploads.map(upload => upload.writeId) });
    expect(f.aborted).toEqual([]);
    expect(f.bucket.put).not.toHaveBeenCalled();
    await expect(f.writes.bucket.put(f.root, "again")).rejects.toThrow("unused receipt");
    await expect(f.writes.bucket.put(`${f.root}/outside`, "bytes")).rejects.toThrow("unused receipt");
  });

  it.each(["unknown", "aborted"] as const)("settles only proven terminal uploads after %s completion", async failure => {
    const f = await fixture(failure);
    await f.writes.admit(f.root);
    const results = await Promise.allSettled(f.objectKeys.map(key => f.writes.bucket.put(key, "encrypted")));
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    await f.writes.settle();
    expect(f.aborted).toEqual([f.root]);
    const admission = f.commands.mock.calls[0]![0].command;
    const settlement = f.commands.mock.calls[1]![0].command;
    if (admission.operation !== "admit_batch" || settlement.operation !== "release_batch") throw new Error("Expected batches");
    expect(settlement.writeIds).toHaveLength(failure === "unknown" ? 35 : 36);
    expect(settlement.writeIds.includes(admission.uploads.find(upload => upload.objectKey === f.root)!.writeId)).toBe(failure === "aborted");
  });

  it("sends no bytes after a lost admission response and retains unknown aborts", async () => {
    const f = await fixture("admission");
    await expect(f.writes.admit(f.root)).rejects.toThrow("lost admission");
    await expect(f.writes.bucket.put(f.root, "encrypted")).rejects.toThrow("admitted");
    await f.writes.settle();
    expect(f.sent).toEqual([]);
    expect(f.aborted).toHaveLength(36);
    expect(f.commands.mock.calls[1]![0].command).toMatchObject({ operation: "release_batch", writeIds: expect.any(Array) });
    const settlement = f.commands.mock.calls[1]![0].command;
    if (settlement.operation !== "release_batch") throw new Error("Expected settlement");
    expect(settlement.writeIds).toHaveLength(35);
  });

  it("leaves durable recovery responsible when the settlement response is lost", async () => {
    const f = await fixture("settlement");
    await f.writes.admit(f.root);
    for (const key of f.objectKeys) await f.writes.bucket.put(key, "encrypted");
    await expect(f.writes.settle()).rejects.toThrow("lost settlement");
    expect(f.commands).toHaveBeenCalledTimes(2);
    expect(f.aborted).toEqual([]);
  });

  it("aborts only the exact admitted upload in the bound member namespace", async () => {
    const userId = "synthetic_recovery_member";
    const objectKey = `${await hostedBrowserVaultReplicaUserPrefix({ userId })}synthetic-root.json`;
    const abort = vi.fn(async () => { throw new Error("upload missing (10024)"); });
    const bucket = { get: async () => null, put: async () => {}, delete: vi.fn(async () => {}), resumeMultipartUpload: vi.fn(() => ({ uploadId: "synthetic-upload", abort,
      uploadPart: async () => ({ partNumber: 1, etag: "unused" }), complete: async () => {},
    })) };
    const resource = { kind: "multipart" as const, objectKey, uploadId: "synthetic-upload" };
    await purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId, resource });
    expect(bucket.resumeMultipartUpload).toHaveBeenCalledWith(objectKey, "synthetic-upload");
    expect(bucket.delete).not.toHaveBeenCalled();
    await expect(purgeHostedRuntimeResource({ source: { BUNDLES: bucket }, userId: "another_synthetic_member", resource })).rejects.toThrow("member namespace");
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
