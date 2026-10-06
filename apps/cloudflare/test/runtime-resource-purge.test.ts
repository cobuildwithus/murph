import { describe, expect, it, vi } from "vitest";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { purgeHostedRuntimeResource } from "../src/worker/route-handlers/runtime-resource-purge.ts";
import { hostedBrowserVaultReplicaObjectKey, hostedMediaObjectKey, hostedWorkspaceSnapshotObjectKey } from "../src/storage-paths.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "../src/browser-vault-store.ts";

function source() {
  return { BUNDLES: { get: vi.fn(async () => null), put: vi.fn(async () => {}), delete: vi.fn(async (_key: string | string[]) => {}) },
    USER_RUNNER: { getByName() { throw new Error("Resource cleanup must not activate UserRunner."); } } };
}

describe("Postgres-owned physical resource cleanup", () => {
  it("aborts the exact managed snapshot upload while rejecting foreign and nested snapshot keys", async () => {
    const base = source();
    const abort = vi.fn(async () => {});
    const resumeMultipartUpload = vi.fn(() => ({ uploadId: "synthetic-upload", abort,
      complete: async () => undefined, uploadPart: async () => ({ partNumber: 1, etag: "synthetic-etag" }) }));
    const env = { ...base, BUNDLES: { ...base.BUNDLES, resumeMultipartUpload } };
    const userId = "synthetic_owner";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId: "snapshot-proof" });
    await purgeHostedRuntimeResource({ source: env, userId, resource: { kind: "multipart", objectKey, uploadId: "synthetic-upload" } });
    expect(resumeMultipartUpload).toHaveBeenCalledExactlyOnceWith(objectKey, "synthetic-upload");
    expect(abort).toHaveBeenCalledOnce();
    const foreign = await hostedWorkspaceSnapshotObjectKey({ userId: "synthetic_other", snapshotId: "snapshot-proof" });
    for (const badKey of [foreign, objectKey + "/nested"]) {
      await expect(purgeHostedRuntimeResource({ source: env, userId, resource: { kind: "multipart", objectKey: badKey, uploadId: "synthetic-upload" } })).rejects.toThrow("outside the member namespace");
    }
    expect(abort).toHaveBeenCalledOnce();
    expect(base.BUNDLES.delete).not.toHaveBeenCalled();
  });

  it("rejects another member's object and nested paths before touching R2", async () => {
    const env = source();
    const objectKey = await hostedMediaObjectKey({ userId: "synthetic_other", mediaId: "a".repeat(64) });
    await expect(purgeHostedRuntimeResource({ source: env, userId: "synthetic_owner", resource: { kind: "media", objectKey } })).rejects.toThrow("outside the member namespace");
    const ownedKey = await hostedMediaObjectKey({ userId: "synthetic_owner", mediaId: "a".repeat(64) });
    await expect(purgeHostedRuntimeResource({ source: env, userId: "synthetic_owner", resource: { kind: "media", objectKey: ownedKey + "/nested" } })).rejects.toThrow("outside the member namespace");
    expect(env.BUNDLES.delete).not.toHaveBeenCalled();
  });

  it("retries an interrupted replica purge including every sibling without activating UserRunner", async () => {
    const env = source();
    const userId = "synthetic_owner";
    const objectKey = await hostedBrowserVaultReplicaObjectKey({ userId, dataVersion: "1", generatedAt: "2026-09-15T00:00:00.000Z" });
    const resource = { kind: "replica" as const, objectKey };
    env.BUNDLES.delete.mockRejectedValueOnce(new Error("synthetic R2 failure"));
    await expect(purgeHostedRuntimeResource({ source: env, userId, resource })).rejects.toThrow("synthetic R2 failure");
    env.BUNDLES.delete.mockClear();
    await purgeHostedRuntimeResource({ source: env, userId, resource });
    expect(env.BUNDLES.delete.mock.calls).toEqual([[[objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(objectKey)]]]);
  });

  it("finishes the complete replica set before the Web control client deadline", async () => {
    const userId = "synthetic_owner";
    const objectKey = await hostedBrowserVaultReplicaObjectKey({ userId, dataVersion: "1", generatedAt: "2026-09-15T00:00:00.000Z" });
    const keys = [objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(objectKey)];
    expect(keys.length).toBeLessThanOrEqual(1_000);
    const remaining = new Set(keys);
    const env = source();
    vi.useFakeTimers();
    // Node's native AbortSignal timer is not controlled by Vitest's clock.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Synthetic deadline", "TimeoutError")), ms);
      return controller.signal;
    });
    env.BUNDLES.delete.mockImplementation(async requested => {
      await new Promise<void>(resolve => setTimeout(resolve, 200));
      for (const key of typeof requested === "string" ? [requested] : requested) remaining.delete(key);
    });
    const fetchImpl: typeof fetch = async (_url, init) => {
      const signal = init?.signal;
      const operation = purgeHostedRuntimeResource({ source: env, userId,
        resource: parseHostedRuntimeResourcePurge(JSON.parse(String(init?.body))) });
      // A real fetch rejects on cancellation even if the Worker finishes later.
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(signal?.reason);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        operation.then(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(Response.json({ deleted: true }));
        }, error => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
      });
    };
    const client = createCloudflareHostedControlClient({ baseUrl: "https://runner.example.test",
      fetchImpl, getBearerToken: async () => "synthetic-token", timeoutMs: 5_000 });
    try {
      const outcome = client.purgeRuntimeResource({ userId, resource: { kind: "replica", objectKey } })
        .then(value => ({ value }), error => ({ error: error instanceof Error ? error.name : "unknown" }));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toEqual({ value: { deleted: true } });
      expect(remaining.size).toBe(0);
      expect(timeout).toHaveBeenCalledWith(5_000);
    } finally {
      await vi.runAllTimersAsync();
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it("deletes only the requested snapshot object", async () => {
    const env = source();
    const userId = "synthetic_owner";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId: "snapshot-proof" });
    await purgeHostedRuntimeResource({ source: env, userId, resource: { kind: "snapshot", objectKey } });
    expect(env.BUNDLES.delete.mock.calls).toEqual([[objectKey]]);
  });
});
