export const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica" as const;
export const BROWSER_VAULT_TRAINING_SESSION_SCHEMA =
  "murph.browser-vault.training-session.v1" as const;

/**
 * Increment when a projection-shape or projection-interpretation change makes
 * an otherwise source-current browser replica incomplete for current readers.
 */
export const BROWSER_VAULT_REPLICA_CURRENT_GENERATION = 10 as const;

export const BROWSER_VAULT_METRIC_BUCKET_IDS = [
  "00", "01", "02", "03", "04", "05", "06", "07",
  "08", "09", "0a", "0b", "0c", "0d", "0e", "0f",
  "10", "11", "12", "13", "14", "15", "16", "17",
  "18", "19", "1a", "1b", "1c", "1d", "1e", "1f",
] as const;

export const BROWSER_VAULT_METRIC_BUCKET_COUNT = BROWSER_VAULT_METRIC_BUCKET_IDS.length;

export type BrowserVaultMetricBucketId = (typeof BROWSER_VAULT_METRIC_BUCKET_IDS)[number];

const browserVaultMetricBucketIds = new Set<string>(BROWSER_VAULT_METRIC_BUCKET_IDS);

export function isBrowserVaultMetricBucketId(value: unknown): value is BrowserVaultMetricBucketId {
  return typeof value === "string" && browserVaultMetricBucketIds.has(value);
}
