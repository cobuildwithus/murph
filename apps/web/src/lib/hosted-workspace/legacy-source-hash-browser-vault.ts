import type {
  HostedBrowserVaultReplicaPublishResult,
  HostedWorkspaceMutationTx,
  HostedWorkspaceTransactionRunner,
} from "./store";
import {
  publishHostedBrowserVaultReplicaRef,
  publishHostedBrowserVaultReplicaRefTx,
} from "./store";

// Compatibility-only source-hash publish path for older browser-vault refresh
// callers. Deletion target: 2026-05-23, after web and Cloudflare have both
// cleared the deploy-skew window. Active refresh callers must omit
// `expectedSourceStateHash` and use latest-ref publishing.
export async function publishLegacySourceHashBrowserVaultReplicaRef(input: {
  expectedSourceStateHash: string;
  expectedWorkspaceVersion?: bigint | number | string | null;
  prisma?: HostedWorkspaceTransactionRunner;
  replicaRef: unknown;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  return await publishHostedBrowserVaultReplicaRef({
    expectedSourceStateHash: input.expectedSourceStateHash,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
    prisma: input.prisma,
    replicaRef: input.replicaRef,
    userId: input.userId,
  });
}

export async function publishLegacySourceHashBrowserVaultReplicaRefTx(input: {
  expectedSourceStateHash: string;
  expectedWorkspaceVersion?: bigint | number | string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  return publishHostedBrowserVaultReplicaRefTx({
    expectedSourceStateHash: input.expectedSourceStateHash,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
    replicaRef: input.replicaRef,
    tx: input.tx,
    userId: input.userId,
  });
}

export function readLegacyExpectedSourceStateHash(
  body: Record<string, unknown>,
): string | null {
  if (!Object.hasOwn(body, "expectedSourceStateHash")) {
    return null;
  }
  if (typeof body.expectedSourceStateHash !== "string" || !body.expectedSourceStateHash.trim()) {
    throw new TypeError(
      "Legacy hosted browser-vault replica publish expectedSourceStateHash must be a non-empty string.",
    );
  }
  return body.expectedSourceStateHash;
}
