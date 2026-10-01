import { expect, it, vi } from "vitest";
import { parseBrowserVaultReplica } from "@murphai/query/browser";
import { fingerprintRecoveryReplica } from "@murphai/hosted-execution/runtime-resources";
import { createHostedBrowserVaultReplicaStore } from "../src/browser-vault-store.ts";
import { readRecoveryReplica, summarizeRecoveryReplica } from "../scripts/checkpoint-recovery-replica.ts";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.ts";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.ts";

async function fixture() {
  const bucket = new MemoryEncryptedR2Bucket();
  const rootKey = createTestRootKey(23);
  const userId = "synthetic-recovery-member";
  const rootKeyId = "synthetic-runtime-root";
  const replica = createSyntheticBrowserVaultReplica(8);
  const store = createHostedBrowserVaultReplicaStore({ bucket, rootKey, rootKeyId, userId });
  const ref = await store.writeBrowserVaultReplica({ replica, userId });
  const readObject = vi.fn(async (key: string) => {
    const object = await bucket.get(key);
    if (!object) throw new Error("synthetic_object_missing");
    return new Uint8Array(await object.arrayBuffer());
  });
  return { bucket, replica, input: { ref, userId, rootKey, rootKeyId, readObject,
    before: replica.generatedAt, signal: new AbortController().signal } };
}

it("authenticates the real encrypted full browser copy and reports only closed coverage", async () => {
  const { input, replica } = await fixture();
  const originalRoot = input.rootKey.slice();
  const { replica: recovered, sourceBytes } = await readRecoveryReplica(input);
  expect(recovered).toEqual(parseBrowserVaultReplica(replica));
  expect(JSON.parse(new TextDecoder().decode(sourceBytes))).toEqual(replica);
  sourceBytes.fill(0);
  expect(input.readObject).toHaveBeenCalledTimes(1);
  expect(input.rootKey).toEqual(originalRoot);
  const summary = summarizeRecoveryReplica(recovered);
  expect(summary).toMatchObject({ entities: 2, entitiesByFamily: { journal: 2 }, metricRows: 8,
    labResultRows: 2, entitiesWithBodyPreviews: 2, completeFileBackup: false, restorationPerformed: false });
  for (const secretValue of [input.userId, input.rootKeyId, input.ref.objectKey, replica.entities[0]!.bodyPreview!,
    replica.entities[0]!.id, replica.metricRows[0]!.sourceLabel!]) expect(JSON.stringify(summary)).not.toContain(secretValue);
});

it("rejects another member and a post-incident reference before reading storage", async () => {
  const { input } = await fixture();
  await expect(readRecoveryReplica({ ...input, userId: "another-synthetic-member" })).rejects.toThrow();
  await expect(readRecoveryReplica({ ...input, before: "2025-01-01T00:00:00.000Z" })).rejects.toThrow();
  expect(input.readObject).not.toHaveBeenCalled();
});

it("fingerprints complete normalized references independently of database JSON key ordering", async () => {
  const { input } = await fixture();
  function reorder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
    return value;
  }
  const reversed = JSON.parse(JSON.stringify(reorder(input.ref)));
  expect(fingerprintRecoveryReplica(reversed)).toBe(fingerprintRecoveryReplica(input.ref));
  expect(fingerprintRecoveryReplica({ ...input.ref, generation: (input.ref.generation ?? 1) + 1 })).not.toBe(fingerprintRecoveryReplica(input.ref));
});

it("rejects changed authenticated reference fields and mismatched projection identity", async () => {
  const { input } = await fixture();
  await expect(readRecoveryReplica({ ...input, ref: { ...input.ref, sourceBundleHash: "different-source" } })).rejects.toThrow();
  await expect(readRecoveryReplica({ ...input, ref: { ...input.ref, byteLength: input.ref.byteLength + 1 } })).rejects.toThrow();
  await expect(readRecoveryReplica({ ...input, ref: { ...input.ref, generation: (input.ref.generation ?? 0) + 1 } })).rejects.toThrow();
});

it("rejects missing encrypted bytes, wrong keys, and cancellation", async () => {
  const { input, bucket } = await fixture();
  await expect(readRecoveryReplica({ ...input, rootKey: createTestRootKey(24) })).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  input.readObject.mockClear();
  await expect(readRecoveryReplica({ ...input, signal: controller.signal })).rejects.toThrow();
  expect(input.readObject).not.toHaveBeenCalled();
  bucket.objects.delete(input.ref.objectKey);
  await expect(readRecoveryReplica(input)).rejects.toThrow();
});

it("never echoes unrecognized family values in diagnostic keys", () => {
  const replica = createSyntheticBrowserVaultReplica(4);
  replica.entities[0]!.family = "synthetic-private-value";
  expect(summarizeRecoveryReplica(replica).entitiesByFamily).toEqual({ other: 1 });
});
