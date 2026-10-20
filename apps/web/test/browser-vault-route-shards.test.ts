import assert from "node:assert/strict";

import { test } from "vitest";

import {
  browserVaultShardSetContains,
  planBrowserVaultRouteShards,
} from "@/src/lib/browser-vault/route-shards";

test.each([
  ["/training", ["core"]],
  ["/home", ["core"]],
  ["/overview", ["core"]],
  ["/patterns", ["core"]],
  ["/history", ["core"]],
  ["/environment", ["core"]],
  ["/environment/print", ["core"]],
  ["/settings", ["core"]],
] as const)("plans core-only Browser Vault data for %s", (pathname, expected) => {
  assert.deepEqual(planBrowserVaultRouteShards(pathname), expected);
});

test("normalizes route decorations without broadening a shard demand", () => {
  assert.deepEqual(
    planBrowserVaultRouteShards("/training/?tab=week#today"),
    ["core"],
  );
});

test("detects whether cached shards cover a route demand", () => {
  assert.equal(
    browserVaultShardSetContains(["core", "metricsIndex"], ["core"]),
    true,
  );
  assert.equal(
    browserVaultShardSetContains(["core"], ["core", "metricsIndex"]),
    false,
  );
});
