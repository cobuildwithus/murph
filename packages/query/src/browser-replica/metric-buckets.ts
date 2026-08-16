import { normalizeMetricKey, resolveMetricDefinition } from "@murphai/health-metrics";
import {
  BROWSER_VAULT_METRIC_BUCKET_COUNT,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  isBrowserVaultMetricBucketId,
  type BrowserVaultMetricBucketId,
} from "@murphai/contracts/browser-vault";

export {
  BROWSER_VAULT_METRIC_BUCKET_COUNT,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  isBrowserVaultMetricBucketId,
};
export type { BrowserVaultMetricBucketId };

export function canonicalizeBrowserVaultMetricKey(metricKey: string): string {
  return resolveMetricDefinition(metricKey)?.key ?? normalizeMetricKey(metricKey);
}

export function requireBrowserVaultMetricBucketId(
  value: unknown,
  label = "Browser vault metric bucket id",
): BrowserVaultMetricBucketId {
  if (!isBrowserVaultMetricBucketId(value)) {
    throw new TypeError(`${label} must be a lowercase hexadecimal bucket id from 00 through 1f.`);
  }
  return value;
}

/**
 * Place a canonical metric key into one of 32 stable buckets using the low five
 * bits of the first SHA-256 byte. Web Crypto keeps this browser-compatible and
 * avoids a second cryptography implementation or dependency.
 * Changing canonicalization or placement requires a Browser Vault generation
 * bump because already-published refs retain the previous bucket assignment.
 */
export async function getBrowserVaultMetricBucketId(
  metricKey: string,
): Promise<BrowserVaultMetricBucketId> {
  const canonicalKey = canonicalizeBrowserVaultMetricKey(metricKey);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalKey)),
  );
  return BROWSER_VAULT_METRIC_BUCKET_IDS[digest[0]! & 0x1f]!;
}
