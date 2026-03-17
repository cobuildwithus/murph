import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import {
  readHealthLibraryGraph,
} from "../src/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const demoVaultRoot = path.join(repoRoot, "fixtures/demo-web-vault");

test("readHealthLibraryGraph loads the canonical RHR graph nodes", async () => {
  const graph = await readHealthLibraryGraph(demoVaultRoot);

  assert.ok(graph.nodes.length >= 15);
  assert.equal(graph.bySlug.get("resting-heart-rate")?.entityType, "biomarker");
  assert.equal(graph.bySlug.get("attia-zone2-4x45m")?.entityType, "protocol_variant");
  assert.equal(graph.bySlug.get("100-healthy-years")?.entityType, "mission");
});
