import {
  readVault,
} from "@murphai/query";
import {
  createBrowserVaultReplica,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";

export async function createHostedBrowserVaultReplicaForSnapshot(input: {
  generatedAt?: string;
  snapshotRef: HostedExecutionBundleRef | null;
  vaultRoot: string;
}): Promise<BrowserVaultReplica | null> {
  if (!input.snapshotRef) {
    return null;
  }

  return await createBrowserVaultReplica({
    generatedAt: input.generatedAt,
    sourceBundleHash: input.snapshotRef.hash,
    vault: await readVault(input.vaultRoot),
  });
}
