import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  importDocument,
  initializeVault,
  resolveRawAssetDirectory,
  resolveRawManifestPath,
  resolveVaultPath,
  validateVault,
} from "../src/index.ts";
import { parseRawImportManifest, stageRawImportManifest } from "../src/operations/raw-manifests.ts";
import { WriteBatch } from "../src/operations/write-batch.ts";

const FIXED_TIME = "2026-04-08T10:15:00.000Z";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("stageRawImportManifest keys manifest paths by import identity and importedAt", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-raw-manifest-path");
  const sourceRoot = await makeTempDirectory("murph-core-raw-manifest-path-source");
  await initializeVault({ vaultRoot });

  const owner = {
    kind: "document" as const,
    id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  };
  const rawDirectory = resolveRawAssetDirectory({
    owner,
    occurredAt: FIXED_TIME,
  });
  const stagedSourcePath = path.join(sourceRoot, "scan.txt");
  await fs.writeFile(stagedSourcePath, "scan\n", "utf8");

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "raw_manifest_idempotency_path",
    summary: "stage raw manifest with immutable path",
  });
  const expectedManifestPath = resolveRawManifestPath({
    artifacts: [],
    rawDirectory,
    importId: owner.id,
    importedAt: FIXED_TIME,
  });
  const manifestPath = await stageRawImportManifest({
    batch,
    importId: owner.id,
    importKind: "document",
    importedAt: FIXED_TIME,
    owner,
    rawDirectory,
    source: "manual",
    artifacts: [
      {
        role: "source",
        raw: {
          relativePath: `${rawDirectory}/scan.txt`,
          originalFileName: "scan.txt",
          mediaType: "text/plain",
          stagedAbsolutePath: stagedSourcePath,
        },
      },
    ],
    provenance: {
      sourceFileName: "scan.txt",
    },
  });

  await batch.commit();
  const stagedVaultPath = resolveVaultPath(vaultRoot, `${rawDirectory}/scan.txt`).absolutePath;
  await fs.mkdir(path.dirname(stagedVaultPath), { recursive: true });
  await fs.copyFile(stagedSourcePath, stagedVaultPath);

  assert.equal(manifestPath, expectedManifestPath);
  const parsedManifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(resolveVaultPath(vaultRoot, manifestPath).absolutePath, "utf8")),
  );
  const validation = await validateVault({ vaultRoot });

  assert.equal(
    resolveRawManifestPath({
      artifacts: parsedManifest.artifacts,
      rawDirectory: parsedManifest.rawDirectory,
      importId: parsedManifest.importId,
      importedAt: parsedManifest.importedAt,
    }),
    expectedManifestPath,
  );
  assert.match(path.posix.basename(manifestPath), /^manifest\./u);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateVault reports missing raw manifests by raw directory for immutable manifest files", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-raw-manifest-missing");
  const sourceRoot = await makeTempDirectory("murph-core-raw-manifest-missing-source");
  await initializeVault({ vaultRoot });

  const documentPath = path.join(sourceRoot, "visit-summary.md");
  await fs.writeFile(documentPath, "# Visit summary\n", "utf8");

  const imported = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Visit summary",
  });

  await fs.rm(path.join(vaultRoot, imported.manifestPath), { force: true });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID"
        && issue.message.includes("missing a raw import manifest")
        && issue.path === path.posix.dirname(imported.manifestPath),
    ),
  );
});
