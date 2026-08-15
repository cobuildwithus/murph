import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  deleteEvent,
  importDocument,
  initializeVault,
  resolveRawAssetDirectory,
  resolveRawManifestPath,
  resolveVaultPath,
  validateVault,
  VaultError,
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

test("exact document reuse ignores member documents with manifest-like names", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-document-exact-reuse-manifest-name");
  const sourceRoot = await makeTempDirectory("murph-core-document-exact-reuse-manifest-name-source");
  await initializeVault({ vaultRoot });

  const memberArtifacts = new Map<string, { content: string; rawRef: string }>();
  for (const fileName of ["manifest.json", "manifest.fixture.json"]) {
    const content = `${JSON.stringify({ documentType: "member-owned", fileName })}\n`;
    const sourcePath = path.join(sourceRoot, fileName);
    await fs.writeFile(sourcePath, content, "utf8");
    const imported = await importDocument({ vaultRoot, sourcePath });
    memberArtifacts.set(fileName, { content, rawRef: imported.raw.relativePath });
  }

  const workoutSourcePath = path.join(sourceRoot, "workout-history.csv");
  await fs.writeFile(workoutSourcePath, "session,exercise,reps\na,Squat,5\n", "utf8");
  const firstWorkoutSource = await importDocument({
    vaultRoot,
    sourcePath: workoutSourcePath,
    reuseExact: true,
  });
  const rawTreeBeforeReplay = (await fs.readdir(
    path.join(vaultRoot, "raw", "documents"),
    { recursive: true },
  )).sort();

  const replayedWorkoutSource = await importDocument({
    vaultRoot,
    sourcePath: workoutSourcePath,
    reuseExact: true,
  });
  const rawTreeAfterReplay = (await fs.readdir(
    path.join(vaultRoot, "raw", "documents"),
    { recursive: true },
  )).sort();

  assert.equal(firstWorkoutSource.created, true);
  assert.equal(replayedWorkoutSource.created, false);
  assert.equal(replayedWorkoutSource.documentId, firstWorkoutSource.documentId);
  assert.equal(replayedWorkoutSource.event.id, firstWorkoutSource.event.id);
  assert.equal(replayedWorkoutSource.raw.relativePath, firstWorkoutSource.raw.relativePath);
  assert.equal(replayedWorkoutSource.manifestPath, firstWorkoutSource.manifestPath);
  assert.deepEqual(rawTreeAfterReplay, rawTreeBeforeReplay);

  for (const { content, rawRef } of memberArtifacts.values()) {
    assert.equal(await fs.readFile(path.join(vaultRoot, rawRef), "utf8"), content);
  }
});

test("exact document reuse fails closed after its source document is deleted", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-document-exact-reuse-deleted");
  const sourceRoot = await makeTempDirectory("murph-core-document-exact-reuse-deleted-source");
  await initializeVault({ vaultRoot });

  const sourcePath = path.join(sourceRoot, "workout-history.csv");
  await fs.writeFile(sourcePath, "session,exercise,reps\na,Squat,5\n", "utf8");
  const imported = await importDocument({ vaultRoot, sourcePath, reuseExact: true });
  await deleteEvent({ vaultRoot, eventId: imported.event.id });
  const treeBeforeReplay = (await fs.readdir(vaultRoot, { recursive: true })).sort();

  await assert.rejects(
    importDocument({ vaultRoot, sourcePath, reuseExact: true }),
    (error: unknown) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "DOCUMENT_EXACT_SOURCE_DELETED");
      return true;
    },
  );
  assert.deepEqual((await fs.readdir(vaultRoot, { recursive: true })).sort(), treeBeforeReplay);
  assert.equal(
    await fs.readFile(path.join(vaultRoot, imported.raw.relativePath), "utf8"),
    await fs.readFile(sourcePath, "utf8"),
  );

  const explicitReplacement = await importDocument({ vaultRoot, sourcePath });
  assert.equal(explicitReplacement.created, true);
  assert.notEqual(explicitReplacement.documentId, imported.documentId);
  assert.notEqual(explicitReplacement.raw.relativePath, imported.raw.relativePath);

  const treeBeforeAliasReplay = (await fs.readdir(vaultRoot, { recursive: true })).sort();
  await assert.rejects(
    importDocument({ vaultRoot, sourcePath, reuseExact: true }),
    (error: unknown) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "DOCUMENT_EXACT_SOURCE_DELETED");
      return true;
    },
  );
  assert.deepEqual((await fs.readdir(vaultRoot, { recursive: true })).sort(), treeBeforeAliasReplay);
});

test("exact document reuse distinguishes damaged owned evidence from source absence", async () => {
  const cases = [
    {
      expectedCode: "RAW_MANIFEST_INVALID",
      name: "missing-manifest",
      damage: async (vaultRoot: string, imported: Awaited<ReturnType<typeof importDocument>>) => {
        await fs.rm(path.join(vaultRoot, imported.manifestPath));
      },
    },
    {
      expectedCode: "RAW_MANIFEST_INVALID",
      name: "malformed-manifest",
      damage: async (vaultRoot: string, imported: Awaited<ReturnType<typeof importDocument>>) => {
        await fs.writeFile(path.join(vaultRoot, imported.manifestPath), "not-json\n", "utf8");
      },
    },
    {
      expectedCode: "RAW_MANIFEST_INVALID",
      name: "owner-mismatched-manifest",
      damage: async (vaultRoot: string, imported: Awaited<ReturnType<typeof importDocument>>) => {
        const manifestPath = path.join(vaultRoot, imported.manifestPath);
        const manifest = parseRawImportManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
        await fs.writeFile(
          manifestPath,
          `${JSON.stringify({
            ...manifest,
            owner: {
              kind: "document",
              id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            },
          })}\n`,
          "utf8",
        );
      },
    },
    {
      expectedCode: "RAW_REFERENCE_MISSING",
      name: "missing-artifact",
      damage: async (vaultRoot: string, imported: Awaited<ReturnType<typeof importDocument>>) => {
        await fs.rm(path.join(vaultRoot, imported.raw.relativePath));
      },
    },
    {
      expectedCode: "RAW_MANIFEST_INVALID",
      name: "artifact-digest-drift",
      damage: async (vaultRoot: string, imported: Awaited<ReturnType<typeof importDocument>>) => {
        await fs.writeFile(path.join(vaultRoot, imported.raw.relativePath), "changed source\n", "utf8");
      },
    },
  ] as const;

  for (const testCase of cases) {
    const vaultRoot = await makeTempDirectory(`murph-core-document-exact-reuse-${testCase.name}`);
    const sourceRoot = await makeTempDirectory(`murph-core-document-exact-reuse-${testCase.name}-source`);
    await initializeVault({ vaultRoot });
    const sourcePath = path.join(sourceRoot, "workout-history.csv");
    await fs.writeFile(sourcePath, "session,exercise,reps\na,Squat,5\n", "utf8");
    const imported = await importDocument({ vaultRoot, sourcePath, reuseExact: true });
    await testCase.damage(vaultRoot, imported);
    const treeBeforeReplay = (await fs.readdir(vaultRoot, { recursive: true })).sort();

    await assert.rejects(
      importDocument({ vaultRoot, sourcePath, reuseExact: true }),
      (error: unknown) => {
        assert.equal(error instanceof VaultError, true);
        assert.equal((error as VaultError).code, testCase.expectedCode);
        return true;
      },
    );
    assert.deepEqual((await fs.readdir(vaultRoot, { recursive: true })).sort(), treeBeforeReplay);
  }
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

test("validateVault reports raw manifest artifact hash and size drift", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-raw-manifest-integrity");
  const sourceRoot = await makeTempDirectory("murph-core-raw-manifest-integrity-source");
  await initializeVault({ vaultRoot });

  const documentPath = path.join(sourceRoot, "visit-summary.md");
  await fs.writeFile(documentPath, "# Visit summary\n", "utf8");

  const imported = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Visit summary",
  });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, imported.raw.relativePath).absolutePath,
    "# Tampered visit summary\n",
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID"
        && issue.path === imported.manifestPath
        && issue.message.includes("bytes or sha256"),
    ),
  );
});

test("validateVault reports raw manifest artifacts that are not safe regular files", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-raw-manifest-invalid-artifact");
  const sourceRoot = await makeTempDirectory("murph-core-raw-manifest-invalid-artifact-source");
  await initializeVault({ vaultRoot });

  const documentPath = path.join(sourceRoot, "linked-summary.md");
  await fs.writeFile(documentPath, "# Linked summary\n", "utf8");

  const imported = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Linked summary",
  });
  const artifactPath = resolveVaultPath(vaultRoot, imported.raw.relativePath);
  await fs.rm(artifactPath.absolutePath, { force: true });
  await fs.symlink(documentPath, artifactPath.absolutePath);

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "VAULT_PATH_SYMLINK"
        && issue.path === imported.raw.relativePath,
    ),
  );
});
