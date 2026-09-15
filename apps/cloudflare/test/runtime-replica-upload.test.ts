import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeReplicaWriteBucket } from "../src/runtime-replica-upload.ts";
import { purgeHostedRuntimeResource } from "../src/worker/route-handlers/runtime-resource-purge.ts";
import { hostedBrowserVaultReplicaUserPrefix, listHostedBrowserVaultReplicaSiblingObjectKeys } from "../src/storage-paths.ts";
import * as resourceClient from "../src/runtime-resource-client.ts";

afterEach(() => vi.restoreAllMocks());
describe("recoverable replica shards", () => {
  it("keeps an uncertain shard pending when its concurrent sibling completes", async () => {
    const userId = "synthetic_replica_member";
    const root = `${await hostedBrowserVaultReplicaUserPrefix({ userId })}synthetic-root.json`;
    const sibling = listHostedBrowserVaultReplicaSiblingObjectKeys(root)[0]!;
    const commands = vi.spyOn(resourceClient, "commandHostedRuntimeReplicaPut").mockResolvedValue(true);
    const bucket = {
      get: async () => null, put: vi.fn(async () => {}), resumeMultipartUpload: vi.fn(),
      createMultipartUpload: async (key: string) => ({ uploadId: key === root ? "root-upload" : "sibling-upload",
        uploadPart: async () => ({ partNumber: 1, etag: "synthetic-etag" }),
        complete: async () => { if (key === root) throw new Error("unknown complete"); },
        abort: async () => { throw new Error("unknown abort"); },
      }),
    };
    const wrapped = createRuntimeReplicaWriteBucket({ source: { BUNDLES: bucket }, userId,
      attemptId: "synthetic-attempt", generation: "4", readRootObjectKey: () => root });
    const results = await Promise.allSettled([wrapped.put(root, "encrypted-root"), wrapped.put(sibling, "encrypted-shard")]);
    expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
    const admitted = commands.mock.calls.map(([input]) => input.command).filter(command => command.operation === "admit");
    expect(admitted).toHaveLength(2);
    expect(new Set(admitted.map(command => command.writeId)).size).toBe(2);
    const released = commands.mock.calls.map(([input]) => input.command).filter(command => command.operation === "release");
    expect(released).toEqual([{ operation: "release", writeId: admitted.find(command => command.multipart?.objectKey === sibling)!.writeId }]);
    expect(bucket.put).not.toHaveBeenCalled();
    await expect(wrapped.put(`${root}/outside`, "bytes")).rejects.toThrow("admitted root");
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
