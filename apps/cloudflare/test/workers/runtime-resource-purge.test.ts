/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { purgeHostedRuntimeResource } from "../../src/worker/route-handlers/runtime-resource-purge.ts";
import { hostedBrowserVaultReplicaObjectKey } from "../../src/storage-paths.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "../../src/browser-vault-store.ts";

describe("replica purge through the R2 binding", () => {
  it("deletes present siblings, tolerates missing ones and preserves another namespace", async () => {
    // The Workers test configuration owns this isolated R2 binding.
    const bucket = (env as { BUNDLES: R2Bucket }).BUNDLES;
    const userId = "synthetic_purge_owner";
    const objectKey = await hostedBrowserVaultReplicaObjectKey({ userId, dataVersion: "1", generatedAt: "2026-09-15T00:00:00.000Z" });
    const foreignKey = await hostedBrowserVaultReplicaObjectKey({ userId: "synthetic_purge_other", dataVersion: "1", generatedAt: "2026-09-15T00:00:00.000Z" });
    const keys = [objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(objectKey)];
    try {
      for (const key of [objectKey, keys[1]!, keys.at(-1)!, foreignKey]) await bucket.put(key, "synthetic");
      const source = { BUNDLES: {
        get: (key: string) => bucket.get(key),
        put: async () => { throw new Error("Purge must not write objects."); },
        delete: (requested: string | string[]) => bucket.delete(requested),
      } };
      const input = { source, userId, resource: { kind: "replica" as const, objectKey } };
      await purgeHostedRuntimeResource(input);
      for (const key of keys) expect(await bucket.head(key)).toBeNull();
      expect(await bucket.head(foreignKey)).not.toBeNull();
      // Retrying an already-completed deletion must remain safe.
      await purgeHostedRuntimeResource(input);
      expect(await bucket.head(foreignKey)).not.toBeNull();
    } finally {
      await bucket.delete([...keys, foreignKey]);
    }
  });
});
