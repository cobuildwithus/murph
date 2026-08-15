import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_METRIC_BUCKET_COUNT,
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  isBrowserVaultMetricBucketId,
} from "../src/browser-vault.ts";

test("browser vault generation rebuilds replicas for the bucketed metrics layout", () => {
  assert.equal(BROWSER_VAULT_REPLICA_CURRENT_GENERATION, 10);
});

test("browser vault owns one fixed 32-bucket lowercase hexadecimal namespace", () => {
  assert.equal(BROWSER_VAULT_METRIC_BUCKET_COUNT, 32);
  assert.deepEqual(BROWSER_VAULT_METRIC_BUCKET_IDS, [
    "00", "01", "02", "03", "04", "05", "06", "07",
    "08", "09", "0a", "0b", "0c", "0d", "0e", "0f",
    "10", "11", "12", "13", "14", "15", "16", "17",
    "18", "19", "1a", "1b", "1c", "1d", "1e", "1f",
  ]);
  assert.equal(isBrowserVaultMetricBucketId("00"), true);
  assert.equal(isBrowserVaultMetricBucketId("1f"), true);
  assert.equal(isBrowserVaultMetricBucketId("1F"), false);
  assert.equal(isBrowserVaultMetricBucketId("20"), false);
});
