import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  parseBrowserVaultReplica,
} from "@murphai/query/browser";
import {
  markHostedBrowserVaultRefreshDirty,
  readHostedBrowserVaultRefreshState,
} from "@murphai/assistant-runtime";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import { describe, expect, it } from "vitest";

import {
  refreshBrowserVaultReplicaFromWarmVault,
} from "../src/browser-vault-refresh/refresher.ts";
import {
  measureHostedBrowserVaultReplicaBytes,
} from "../src/browser-vault-limits.ts";

describe("browser-vault background refresh", () => {
  it("publishes a valid empty/current replica after query-visible content is deleted", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-background-"));
    const writes: unknown[] = [];
    const publishes: HostedBrowserVaultReplicaRef[] = [];
    try {
      await markHostedBrowserVaultRefreshDirty({
        dirtyReason: "query_source_deleted",
        now: () => "2026-05-10T00:00:00.000Z",
        vaultRoot,
      });

      const result = await refreshBrowserVaultReplicaFromWarmVault({
        generatedAt: "2026-05-10T00:01:00.000Z",
        port: {
          async write(input) {
            writes.push(input.replica);
            return createReplicaRef({
              byteLength: measureHostedBrowserVaultReplicaBytes(parseBrowserVaultReplica(input.replica)),
              sourceBundleHash: input.expectedReplicaSourceHash ?? "missing",
            });
          },
          async publishRef(input) {
            publishes.push(input.replicaRef);
            return {
              published: true,
              workspace: null,
            };
          },
        },
        vaultRoot,
      });

      expect(result.status).toBe("published");
      expect(writes).toHaveLength(1);
      expect(publishes).toHaveLength(1);
      expect((writes[0] as { schema?: unknown }).schema).toBe("murph.browser-vault-replica");
      expect((writes[0] as { entities?: unknown[] }).entities).toEqual([]);
      expect((await readHostedBrowserVaultRefreshState({ vaultRoot })).dirty).toBe(false);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps the marker dirty when query sources change during build", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-race-"));
    try {
      await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core\n");
      await markHostedBrowserVaultRefreshDirty({
        dirtyReason: "query_source_changed",
        vaultRoot,
      });

      const result = await refreshBrowserVaultReplicaFromWarmVault({
        generatedAt: "2026-05-10T00:01:00.000Z",
        port: {
          async write(input) {
            return createReplicaRef({
              byteLength: measureHostedBrowserVaultReplicaBytes(parseBrowserVaultReplica(input.replica)),
              sourceBundleHash: input.expectedReplicaSourceHash ?? "missing",
            });
          },
          async publishRef() {
            return {
              published: true,
              workspace: null,
            };
          },
        },
        signal: AbortSignal.timeout(30_000),
        vaultRoot,
      });

      expect(result.status).toBe("published");
      await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core updated\n");
      await markHostedBrowserVaultRefreshDirty({
        dirtyReason: "query_source_changed",
        vaultRoot,
      });
      const raced = await refreshBrowserVaultReplicaFromWarmVault({
        beforeSourceHashAfterBuild: async () => {
          await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core changed\n");
        },
        generatedAt: "2026-05-10T00:02:00.000Z",
        port: {
          async write() {
            throw new Error("Source races must not write replicas.");
          },
          async publishRef() {
            throw new Error("Source races must not publish replicas.");
          },
        },
        vaultRoot,
      });
      expect(raced.status).toBe("source_changed_during_build");
      expect((await readHostedBrowserVaultRefreshState({ vaultRoot })).dirty).toBe(true);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function createReplicaRef(input: {
  byteLength: number;
  sourceBundleHash: string;
}): HostedBrowserVaultReplicaRef {
  return {
    byteLength: input.byteLength,
    dataVersion: `2026-05-10T00:00:00.000Z:${input.sourceBundleHash}`,
    generatedAt: "2026-05-10T00:00:00.000Z",
    keyId: `browser-vault-replica:${input.sourceBundleHash.slice(0, 32)}`,
    objectKey: "users/opaque/browser-vault-replicas/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: input.sourceBundleHash,
  };
}
