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
  ["/experiments", ["core"]],
  ["/experiments/protocol-1/research", ["core"]],
  ["/biomarkers/heart-rate-variability/research", ["core"]],
  ["/settings", ["core"]],
] as const)("plans core-only Browser Vault data for %s", (pathname, expected) => {
  assert.deepEqual(planBrowserVaultRouteShards(pathname), expected);
});

test.each([
  "/biomarkers/heart-rate-variability",
  "/experiments/protocol-1",
  "/experiments/protocol-1/results",
  "/experiments/runs/protocol-1",
] as const)("plans core and the metrics index for %s", (pathname) => {
  assert.deepEqual(planBrowserVaultRouteShards(pathname), ["core", "metricsIndex"]);
});

test("plans every Browser Vault shard for the biomarkers index", () => {
  assert.deepEqual(planBrowserVaultRouteShards("/biomarkers"), [
    "core",
    "labs",
    "metricsIndex",
  ]);
});

test("plans core and labs for a lab result detail route", () => {
  assert.deepEqual(
    planBrowserVaultRouteShards("/biomarkers/results/apob"),
    ["core", "labs"],
  );
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
