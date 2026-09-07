import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  HostedBrowserVaultReplicaTooLargeError,
} from "../src/browser-vault-limits.ts";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.js";
import {
  assertBrowserVaultProofReadback,
  BrowserVaultProofBucket,
  createBrowserVaultProofStore,
  readBrowserVaultProofRequest,
} from "./browser-vault-write-memory.proof.js";

describe("large hosted browser vault publication", () => {
  it("reads the complete root, all fixed shards and all metric buckets after a varied 28 MiB request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "browser-vault-proof-"));
    try {
      // Generate before the write, then use the outbound owner's actual bounded
      // JSON reader. The standalone proof uses separate processes for these phases.
      writeFileSync(join(directory, "request.json"), JSON.stringify({
        replica: createSyntheticBrowserVaultReplica(),
      }));
      const body = await readBrowserVaultProofRequest(directory);
      const bucket = new BrowserVaultProofBucket(join(directory, "objects"));
      const store = createBrowserVaultProofStore(bucket);
      const ref = await store.writeBrowserVaultReplica({
        replica: body.replica,
        userId: "synthetic-member",
      });
      expect(ref.byteLength).toBeGreaterThan(28 * 1024 * 1024);
      expect(ref.byteLength).toBeLessThan(29 * 1024 * 1024);
      expect(bucket.puts).toBe(36);
      await assertBrowserVaultProofReadback(bucket, body.replica, ref);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an over-50-MiB root before admission or any R2 write", async () => {
    const directory = mkdtempSync(join(tmpdir(), "browser-vault-size-"));
    try {
      const bucket = new BrowserVaultProofBucket(directory);
      const store = createBrowserVaultProofStore(bucket);
      const replica = createSyntheticBrowserVaultReplica(4);
      replica.metricRows[0]!.context.sample = "x".repeat(HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES);
      let admitted = false;
      await expect(store.writeBrowserVaultReplica({
        beforeWrite: async () => { admitted = true; },
        replica,
        userId: "synthetic-member",
      })).rejects.toBeInstanceOf(HostedBrowserVaultReplicaTooLargeError);
      expect(admitted).toBe(false);
      expect(bucket.puts).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
