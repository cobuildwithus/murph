import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, test } from "vitest";

import {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
} from "../src/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const demoVaultRoot = path.join(repoRoot, "fixtures/demo-web-vault");
const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test("readHealthLibraryGraph loads the canonical RHR graph nodes", async () => {
  const graph = await readHealthLibraryGraph(demoVaultRoot);

  assert.ok(graph.nodes.length >= 15);
  assert.equal(graph.bySlug.get("resting-heart-rate")?.entityType, "biomarker");
  assert.equal(graph.bySlug.get("attia-zone2-4x45m")?.entityType, "protocol_variant");
  assert.equal(graph.bySlug.get("100-healthy-years")?.entityType, "mission");
});

test("readHealthLibraryGraphWithIssues tolerates malformed bank/library pages", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-health-library-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank", "library", "sleep-architecture.md"),
    [
      "---",
      "title: Sleep architecture",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "---",
      "",
      "# Sleep architecture",
      "",
      "Stable reference page.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "broken.md"),
    [
      "---",
      "title: Broken",
      "slug: broken",
      "",
      "# Broken",
    ].join("\n"),
  );

  const result = await readHealthLibraryGraphWithIssues(vaultRoot);

  assert.equal(result.graph.bySlug.has("sleep-architecture"), true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.relativePath, "bank/library/broken.md");
});
