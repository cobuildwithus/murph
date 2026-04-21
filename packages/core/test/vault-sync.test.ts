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
  restoreVaultSyncImportPack,
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
});

describe("vault sync merge", () => {
  it("treats missing import manifests as an empty additive merge", async () => {
    const hosted = await createTempVault("Hosted vault");
    const importWorkspace = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-empty-import-"));
    tempRoots.push(importWorkspace);
    const importVaultRoot = path.join(importWorkspace, "vault");
    const importMetaRoot = path.join(importWorkspace, "meta");
    await mkdir(importVaultRoot, { recursive: true });
    await mkdir(importMetaRoot, { recursive: true });

    const result = await mergeVaultSyncImportIntoVault({
      importMetaRoot,
      importVaultRoot,
      sessionId: "vsi_empty_manifest",
      targetVaultRoot: hosted,
    });

    expect(result.conflicts).toEqual([]);
    expect(result.imported).toEqual({
      jsonlRecords: 0,
      rawFiles: 0,
      textFiles: 0,
    });
    expect(result.skipped).toEqual({
      duplicates: 0,
      excludedFiles: 0,
    });
  });

  it("adds missing records and raw files without overwriting hosted text conflicts", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;
    const rawFile = `${VAULT_LAYOUT.rawDirectory}/sync-fixtures/local.txt`;

    await appendJsonlRecord({
      vaultRoot: local,
      relativePath: eventLedger,
      record: {
        id: "evt_local_merge_1",
        kind: "note",
        occurredAt: "2026-04-21T00:00:00.000Z",
        text: "local merge note",
      },
    });
    await writeVaultFile(local, rawFile, "raw local evidence\n");

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
      .resolves.toContain("evt_local_merge_1");
    await expect(readFile(path.join(hosted, rawFile), "utf8"))
      .resolves.toBe("raw local evidence\n");
    await expect(readFile(path.join(hosted, VAULT_LAYOUT.coreDocument), "utf8"))
      .resolves.toBe(hostedCoreBefore);
    expect(result.imported.jsonlRecords).toBe(1);
    expect(result.imported.rawFiles).toBe(1);
    expect(result.conflicts.some((conflict) => conflict.path === VAULT_LAYOUT.coreDocument)).toBe(true);
    expect(result.conflictManifestPath).toBeTruthy();
  });

  it("preserves raw and JSONL conflicts without clobbering hosted values", async () => {
    const hosted = await createTempVault("Hosted vault");
    const local = await createTempVault("Local vault");
    const eventLedger = `${VAULT_LAYOUT.eventLedgerDirectory}/2026/2026-04.jsonl`;
    const rawFile = `${VAULT_LAYOUT.rawDirectory}/sync-fixtures/conflict.txt`;

    await appendJsonlRecord({
      vaultRoot: hosted,
      relativePath: eventLedger,
      record: {
        id: "evt_conflict",
        kind: "note",
        lifecycle: { revision: 1 },
        occurredAt: "2026-04-21T00:00:00.000Z",
        text: "hosted",
      },
    });
    await appendJsonlRecord({
      vaultRoot: local,
      relativePath: eventLedger,
      record: {
        id: "evt_conflict",
        kind: "note",
        lifecycle: { revision: 1 },
        occurredAt: "2026-04-21T00:00:00.000Z",
        text: "local",
      },
    });
    await writeVaultFile(hosted, rawFile, "hosted raw\n");
    await writeVaultFile(local, rawFile, "local raw\n");

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
      .resolves.toContain("\"text\":\"hosted\"");
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
});
