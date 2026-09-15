import { describe, expect, it, vi } from "vitest";
import { purgeHostedRuntimeResource } from "../src/worker/route-handlers/runtime-resource-purge.ts";
import { hostedBrowserVaultReplicaObjectKey, hostedMediaObjectKey, hostedWorkspaceSnapshotObjectKey } from "../src/storage-paths.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "../src/browser-vault-store.ts";

function source() {
  return { BUNDLES: { get: vi.fn(async () => null), put: vi.fn(async () => {}), delete: vi.fn(async (_key: string | string[]) => {}) },
    USER_RUNNER: { getByName() { throw new Error("Resource cleanup must not activate UserRunner."); } } };
}

describe("Postgres-owned physical resource cleanup", () => {
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
    expect(env.BUNDLES.delete.mock.calls.map(([key]) => key)).toEqual([objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(objectKey)]);
  });

  it("deletes only the requested snapshot object", async () => {
    const env = source();
    const userId = "synthetic_owner";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({ userId, snapshotId: "snapshot-proof" });
    await purgeHostedRuntimeResource({ source: env, userId, resource: { kind: "snapshot", objectKey } });
    expect(env.BUNDLES.delete.mock.calls).toEqual([[objectKey]]);
  });
});
