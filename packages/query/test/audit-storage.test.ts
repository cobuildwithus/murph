import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import { archiveClosedAuditShards, initializeVault, listAuditShardSources } from "@murphai/core";
import {
  hashCanonicalQuerySources, isCanonicalQuerySourcePath, listCanonicalSourceManifest,
  readCanonicalEntityFamilySource,
} from "../src/vault-source.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("audit archival preserves family reads and logical paths without invalidating the unrelated query cache", async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-query-audit-storage-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, createdAt: "2026-01-02T00:00:00.000Z" });
  const before = await readCanonicalEntityFamilySource(vaultRoot, "audit");
  assert.ok(before.length > 0);
  const beforeHash = await hashCanonicalQuerySources(vaultRoot);
  const result = await archiveClosedAuditShards({ vaultRoot, now: new Date("2026-02-15T00:00:00.000Z") });
  assert.ok(result.archivedShardCount > 0);
  assert.deepEqual(await readCanonicalEntityFamilySource(vaultRoot, "audit"), before);
  assert.equal((await hashCanonicalQuerySources(vaultRoot)).hash, beforeHash.hash);
  const manifest = await listCanonicalSourceManifest(vaultRoot);
  const archive = (await listAuditShardSources(vaultRoot)).find((entry) => entry.sourcePath.endsWith(".br"));
  assert.ok(archive);
  assert.equal(isCanonicalQuerySourcePath(archive.sourcePath), false);
  assert.ok(!manifest.some((entry) => entry.relativePath.startsWith("audit/")));
  await fs.writeFile(path.join(vaultRoot, archive.sourcePath), "Corrupt archive");
  await assert.rejects(readCanonicalEntityFamilySource(vaultRoot, "audit"));
});
