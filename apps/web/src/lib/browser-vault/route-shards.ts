import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  type HostedBrowserVaultReplicaMetricBucketId,
} from "@murphai/hosted-execution/browser-vault";

export const BROWSER_VAULT_REPLICA_SHARDS =
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS;

export type BrowserVaultReplicaShard =
  typeof BROWSER_VAULT_REPLICA_SHARDS[number];

export const BROWSER_VAULT_INTERACTIVE_METRIC_BUCKET_LIMIT =
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_COUNT - 1;

export type BrowserVaultMetricBucketId =
  HostedBrowserVaultReplicaMetricBucketId;

const CORE_SHARDS = ["core"] as const satisfies readonly BrowserVaultReplicaShard[];

/**
 * Returns the complete Browser Vault shard demand for one dashboard route.
 * Unknown routes stay on the small core projection until a page explicitly
 * demonstrates that it needs another shard.
 */
export function planBrowserVaultRouteShards(
  _pathname: string,
): readonly BrowserVaultReplicaShard[] {
  return CORE_SHARDS;
}

export function browserVaultShardSetContains(
  available: readonly BrowserVaultReplicaShard[],
  required: readonly BrowserVaultReplicaShard[],
): boolean {
  return required.every((shard) => available.includes(shard));
}

export function normalizeBrowserVaultMetricBucketDemand(
  bucketIds: readonly BrowserVaultMetricBucketId[],
): BrowserVaultMetricBucketId[] {
  const unique = [...new Set(bucketIds)].sort();
  if (unique.length > BROWSER_VAULT_INTERACTIVE_METRIC_BUCKET_LIMIT) {
    throw new Error(
      "Interactive Browser Vault requests cannot load every metric bucket.",
    );
  }
  return unique;
}
