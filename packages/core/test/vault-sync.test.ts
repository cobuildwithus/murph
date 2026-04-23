import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendJsonlRecord,
  buildVaultSyncImportPack,
  initializeVault,
  isVaultError,
  mergeVaultSyncImportIntoVault,
  readVaultSyncImportManifest,
  restoreVaultSyncImportPack,
  validateVault,
  VAULT_LAYOUT,
} from "../src/index.ts";

const tempRoots: string[] = [];

async function createTempVault(title: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-test-"));
  tempRoots.push(root);
  await initializeVault({
    createdAt: "2026-04-21T00:00:00.000Z",
    title,
    vaultRoot: root,
  });
  return root;
}

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

function buildEncounterEvent(input: {
  id: string;
  title: string;
  encounterType?: string;
  location?: string;
  revision?: number;
}) {
  return {
    schemaVersion: "murph.event.v1",
    id: input.id,
    kind: "encounter",
    occurredAt: "2026-04-21T00:00:00.000Z",
    recordedAt: "2026-04-21T00:05:00.000Z",
    dayKey: "2026-04-21",
    source: "import",
    title: input.title,
    encounterType: input.encounterType ?? "follow-up",
    location: input.location ?? "Clinic",
    lifecycle: input.revision ? { revision: input.revision } : undefined,
  };
}

async function writeRawImportManifest(input: {
  artifactRelativePath: string;
  importId: string;
  importKind: string;
  vaultRoot: string;
}): Promise<void> {
  const rawDirectory = path.posix.dirname(input.artifactRelativePath);
  const manifestRelativePath = `${rawDirectory}/manifest.json`;
  const artifactBytes = await readFile(path.join(input.vaultRoot, input.artifactRelativePath));
  await writeVaultFile(
    input.vaultRoot,
    manifestRelativePath,
    `${JSON.stringify({
      schemaVersion: "murph.raw-import-manifest.v1",
      importId: input.importId,
      importKind: input.importKind,
      importedAt: "2026-04-21T00:00:00.000Z",
      source: "import",
      owner: {
        kind: "document",
        id: input.importId,
      },
      rawDirectory,
      artifacts: [
        {
          role: "source",
          relativePath: input.artifactRelativePath,
          originalFileName: path.posix.basename(input.artifactRelativePath),
          mediaType: "text/plain",
          byteSize: artifactBytes.byteLength,
          sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        },
      ],
      provenance: {
        sourceFileName: path.posix.basename(input.artifactRelativePath),
      },
    }, null, 2)}\n`,
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("vault sync import packs", () => {
  it("builds and restores canonical-only import packs with nested ledger files", async () => {
    const source = await createTempVault("Local source");
    const restoreRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-restore-test-"));
    tempRoots.push(restoreRoot);
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;

    await appendJsonlRecord({
      vaultRoot: source,
      relativePath: eventLedger,
      record: {
        id: "evt_local_1",
        kind: "note",
        occurredAt: "2026-04-21T00:00:00.000Z",
        text: "local note",
      },
    });
    await writeVaultFile(source, ".runtime/operations/vault-sync/state.json", "{}\n");
    await writeVaultFile(source, "derived/inbox/cache.json", "{}\n");

    const pack = await buildVaultSyncImportPack({ vaultRoot: source });
    const restored = await restoreVaultSyncImportPack({
      bundle: pack.bundle,
      workspaceRoot: restoreRoot,
    });

    await expect(readFile(path.join(restored.vaultRoot, eventLedger), "utf8"))
      .resolves.toContain("evt_local_1");
    await expect(readFile(path.join(restored.vaultRoot, ".runtime/operations/vault-sync/state.json"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(path.join(restored.vaultRoot, "derived/inbox/cache.json"), "utf8"))
      .rejects.toThrow();
    expect(pack.manifest.files.some((file) => file.path === eventLedger)).toBe(true);
    expect(pack.manifest.excluded.some((file) => file.path.startsWith(".runtime/"))).toBe(true);
  });

  it("reads a verified import manifest from a restored import pack", async () => {
    const source = await createTempVault("Local source");

    const pack = await buildVaultSyncImportPack({ vaultRoot: source });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    const manifest = await readVaultSyncImportManifest(restored.metaRoot);
    expect(manifest.manifestHash).toBe(pack.manifestHash);
    expect(manifest.sourceVault.vaultId).toBe(pack.sourceVaultId);
  });

  it("rejects an import manifest whose hash does not match its contents", async () => {
    const source = await createTempVault("Local source");

    const pack = await buildVaultSyncImportPack({ vaultRoot: source });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);
    const manifestPath = path.join(restored.metaRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.manifestHash = "sha256:tampered";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(readVaultSyncImportManifest(restored.metaRoot)).rejects.toSatisfy((error: unknown) =>
      isVaultError(error) && error.code === "VAULT_SYNC_IMPORT_MANIFEST_HASH_MISMATCH"
    );
  });
});

describe("vault sync merge", () => {
  it("fails closed when the import manifest is missing or invalid", async () => {
    const hosted = await createTempVault("Hosted vault");
    const importWorkspace = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-empty-import-"));
    tempRoots.push(importWorkspace);
    const importVaultRoot = path.join(importWorkspace, "vault");
    const importMetaRoot = path.join(importWorkspace, "meta");
    await mkdir(importVaultRoot, { recursive: true });
    await mkdir(importMetaRoot, { recursive: true });

    await expect(mergeVaultSyncImportIntoVault({
      importMetaRoot,
      importVaultRoot,
      sessionId: "vsi_empty_manifest",
      targetVaultRoot: hosted,
    })).rejects.toSatisfy((error: unknown) =>
      isVaultError(error) && error.code === "VAULT_SYNC_IMPORT_MANIFEST_INVALID"
    );
  });

  it("adds missing records and raw files without overwriting hosted text conflicts", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;
    const rawFile = `${VAULT_LAYOUT.rawDirectory}/documents/2026/04/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/local.txt`;

    await appendJsonlRecord({
      vaultRoot: local,
      relativePath: eventLedger,
      record: buildEncounterEvent({
        id: "evt_01JQ7AHM7QKZKWF0D8TG7ZW99A",
        title: "Local merge encounter",
      }),
    });
    await writeVaultFile(local, rawFile, "raw local evidence\n");
    await writeRawImportManifest({
      artifactRelativePath: rawFile,
      importId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG",
      importKind: "document",
      vaultRoot: local,
    });

    const hostedCoreBefore = await readFile(path.join(hosted, VAULT_LAYOUT.coreDocument), "utf8");
    const pack = await buildVaultSyncImportPack({ vaultRoot: local });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    const result = await mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: "vsi_test_merge",
      targetVaultRoot: hosted,
    });

    await expect(readFile(path.join(hosted, eventLedger), "utf8"))
      .resolves.toContain("evt_01JQ7AHM7QKZKWF0D8TG7ZW99A");
    await expect(readFile(path.join(hosted, rawFile), "utf8"))
      .resolves.toBe("raw local evidence\n");
    await expect(readFile(path.join(hosted, path.posix.dirname(rawFile), "manifest.json"), "utf8"))
      .resolves.toContain("\"rawDirectory\"");
    await expect(readFile(path.join(hosted, VAULT_LAYOUT.coreDocument), "utf8"))
      .resolves.toBe(hostedCoreBefore);
    expect(result.imported.jsonlRecords).toBe(1);
    expect(result.imported.rawFiles).toBe(2);
    expect(result.conflicts.some((conflict) => conflict.path === VAULT_LAYOUT.coreDocument)).toBe(true);
    expect(result.conflictManifestPath).toBeTruthy();
  });

  it("preserves raw and JSONL conflicts without clobbering hosted values", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;
    const rawFile = `${VAULT_LAYOUT.rawDirectory}/documents/2026/04/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/conflict.txt`;

    await appendJsonlRecord({
      vaultRoot: hosted,
      relativePath: eventLedger,
      record: buildEncounterEvent({
        id: "evt_01JQ7AHY3W3W73Q9CKP2WR18MM",
        revision: 1,
        title: "Hosted encounter",
      }),
    });
    await appendJsonlRecord({
      vaultRoot: local,
      relativePath: eventLedger,
      record: buildEncounterEvent({
        id: "evt_01JQ7AHY3W3W73Q9CKP2WR18MM",
        revision: 1,
        title: "Local encounter",
      }),
    });
    await writeVaultFile(hosted, rawFile, "hosted raw\n");
    await writeVaultFile(local, rawFile, "local raw\n");
    await writeRawImportManifest({
      artifactRelativePath: rawFile,
      importId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG",
      importKind: "document",
      vaultRoot: hosted,
    });
    await writeRawImportManifest({
      artifactRelativePath: rawFile,
      importId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG",
      importKind: "document",
      vaultRoot: local,
    });

    const pack = await buildVaultSyncImportPack({ vaultRoot: local });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    const result = await mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: "vsi_conflicts",
      targetVaultRoot: hosted,
    });

    await expect(readFile(path.join(hosted, eventLedger), "utf8"))
      .resolves.toContain("\"title\":\"Hosted encounter\"");
    await expect(readFile(path.join(hosted, rawFile), "utf8"))
      .resolves.toBe("hosted raw\n");
    expect(result.conflicts.some((conflict) => conflict.kind === "jsonl")).toBe(true);
    expect(result.conflicts.some((conflict) => conflict.kind === "raw")).toBe(true);
    const preservedPaths = result.conflicts
      .map((conflict) => conflict.preservedLocalPath)
      .filter((preservedPath): preservedPath is string => Boolean(preservedPath));
    expect(preservedPaths.length).toBeGreaterThanOrEqual(2);
    for (const preservedPath of preservedPaths) {
      await expect(readFile(path.join(hosted, preservedPath), "utf8"))
        .resolves.toBeTruthy();
    }
  });

  it("rejects JSONL import records that are not objects", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;
    await writeVaultFile(local, eventLedger, "\"not an object\"\n");

    const pack = await buildVaultSyncImportPack({ vaultRoot: local });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    await expect(mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: "vsi_invalid_jsonl",
      targetVaultRoot: hosted,
    })).rejects.toSatisfy((error: unknown) =>
      isVaultError(error) && error.code === "VAULT_SYNC_INVALID_JSONL"
    );
  });

  it("rejects contract-invalid imported JSONL before mutating the hosted vault", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const captureLedger = `${VAULT_LAYOUT.inboxCaptureLedgerDirectory}/2026/2026-04.jsonl`;

    await writeVaultFile(local, captureLedger, "{}\n");

    const pack = await buildVaultSyncImportPack({ vaultRoot: local });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    await expect(mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: "vsi_invalid_contract_jsonl",
      targetVaultRoot: hosted,
    })).rejects.toSatisfy((error: unknown) => (
      isVaultError(error) &&
      error.code === "VAULT_SYNC_IMPORT_VALIDATION_FAILED" &&
      Array.isArray(error.details.issues) &&
      error.details.issues.some((issue) =>
        typeof issue === "object" &&
        issue !== null &&
        (issue as { path?: unknown }).path === captureLedger
      )
    ));

    await expect(readFile(path.join(hosted, captureLedger), "utf8")).rejects.toThrow();
    await expect(validateVault({ vaultRoot: hosted })).resolves.toMatchObject({ valid: true });
  });

  it("blocks merged-vault writes when an imported canonical file would fail validation", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const journalDay = `${VAULT_LAYOUT.journalDirectory}/2026-04-21.md`;

    await writeVaultFile(local, journalDay, "not frontmatter\n");

    const pack = await buildVaultSyncImportPack({ vaultRoot: local });
    const restored = await restoreVaultSyncImportPack({ bundle: pack.bundle });
    tempRoots.push(restored.workspaceRoot);

    await expect(mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: "vsi_invalid_preferences",
      targetVaultRoot: hosted,
    })).rejects.toSatisfy((error: unknown) => (
      isVaultError(error) &&
      error.code === "VAULT_SYNC_IMPORT_VALIDATION_FAILED" &&
      Array.isArray(error.details.issues) &&
      error.details.issues.some((issue) =>
        typeof issue === "object" &&
        issue !== null &&
        (issue as { path?: unknown }).path === journalDay
      )
    ));

    await expect(readFile(path.join(hosted, journalDay), "utf8")).rejects.toThrow();
    await expect(
      readFile(path.join(hosted, "raw/sync-imports/vsi_invalid_preferences/manifest.json"), "utf8"),
    ).rejects.toThrow();
    await expect(validateVault({ vaultRoot: hosted })).resolves.toMatchObject({ valid: true });
  });
});
