import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { expect, test, vi } from "vitest";
import { archiveClosedIntegrationIngestShards, buildIntegrationEvidencePart, buildIntegrationIngestRecord, initializeVault, readIntegrationIngestEntries, listIntegrationIngestsForEvent, withIntegrationIngestMaterializer } from "@murphai/core";
import type { HostedRuntimeMediaStore } from "../src/hosted-runtime/platform.ts";
import {
  type HostedMediaReferenceCatalogue,
  publishHostedWorkspaceMediaReferencesForSnapshot,
  readHostedMediaReferenceCatalogue,
  writeHostedMediaReferenceCatalogue,
  publishHostedWorkspaceMediaReferences,
} from "../src/hosted-runtime/media-references.ts";

import { collectHostedWorkspaceSnapshotArchivePlan, HOSTED_MEDIA_REFS_SCHEMA, HOSTED_MEDIA_REFS_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { createHostedArtifactMaterializer } from "../src/hosted-runtime/artifacts.ts";

const closedPath = "ledger/integration-ingests/2020/2020-01.jsonl.br";

test("reader expansion keeps unreferenced closed and current months inline", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "cold-reader-inline-"));
  const put = vi.fn(async () => {});
  try {
    await initializeVault({ vaultRoot });
    const month = new Date().toISOString().slice(0, 7);
    const currentPath = `ledger/integration-ingests/${month.slice(0, 4)}/${month}.jsonl.br`;
    for (const relativePath of [closedPath, currentPath]) {
      await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
      await writeFile(path.join(vaultRoot, relativePath), brotliCompressSync(Buffer.from('{"synthetic":true}\n')));
    }
    const result = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: { put, get: async () => null } });
    expect(result.excludedVaultPaths).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot: vaultRoot, vaultRoot, excludedVaultPaths: result.excludedVaultPaths });
    for (const relativePath of [closedPath, currentPath]) {
      expect(plan.entries).toContainEqual(expect.objectContaining({ relativePath }));
    }
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

for (const failure of [null, "missing", "hash", "size"] as const) {
  test(`restored history materializes before reads and export (${failure ?? "success"})`, async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "cold-ingest-read-"));
    const objects = new Map<string, Uint8Array>();
    let downloads = 0;
    const mediaStore: HostedRuntimeMediaStore = {
      put: async (entry) => { objects.set(entry.mediaId, entry.bytes); },
      get: async (entry) => {
        downloads += 1;
        const bytes = objects.get(entry.mediaId)!;
        if (failure === "missing") return null;
        if (failure === "size") return bytes.slice(1);
        if (failure === "hash") return new Uint8Array(bytes.length);
        return bytes;
      },
    };
    try {
      await initializeVault({ vaultRoot, title: "Synthetic history", timezone: "UTC" });
      const record = buildIntegrationIngestRecord({
        id: "xfm_synthetic", provider: "synthetic", source: "device", importedAt: "2020-01-02T00:00:00.000Z",
        parts: [buildIntegrationEvidencePart({ role: "payload", fileName: "payload.json", mediaType: "application/json", content: '{"value":42}' })],
        eventOutputs: [{ id: "evt_synthetic", roles: ["payload"] }], eventIdsComplete: true,
        sampleIds: [], sampleIdsComplete: true, eventCount: 1, sampleCount: 0,
      });
      const bytes = brotliCompressSync(Buffer.from(`${JSON.stringify(record)}\n`));
      await mkdir(path.dirname(path.join(vaultRoot, closedPath)), { recursive: true });
      await writeFile(path.join(vaultRoot, closedPath), bytes);
      // Old inline snapshots do not need a catalogue or downloader.
      expect((await readIntegrationIngestEntries(vaultRoot))[0]?.record).toEqual(record);
      // Seed a future producer's inventory: this reader release cannot create it.
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      objects.set(sha256, bytes);
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{
        relativePath: closedPath, mediaId: sha256, sha256, byteSize: bytes.length,
        mediaKind: "integration-ingest", expiresAt: null, mimeType: "application/octet-stream", recordedAt: "2020-01-01T00:00:00.000Z",
      }] } });
      const publication = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
      await rm(path.join(vaultRoot, closedPath));
      expect(downloads).toBe(0);
      await expect(readIntegrationIngestEntries(vaultRoot)).rejects.toMatchObject({ code: "HOSTED_COLD_HISTORY_UNAVAILABLE", retryable: true });
      await expect(collectHostedWorkspaceSnapshotArchivePlan({ durableRoot: vaultRoot, vaultRoot }))
        .rejects.toMatchObject({ code: "HOSTED_COLD_HISTORY_UNAVAILABLE" });
      // Idle maintenance sees no local shard; it neither downloads nor re-inlines it.
      expect((await archiveClosedIntegrationIngestShards({ vaultRoot })).archivedShardCount).toBe(0);
      expect(downloads).toBe(0);
      expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths)
        .toEqual(publication.excludedVaultPaths);
      const materialize = createHostedArtifactMaterializer({ mediaStore, vaultRoot, operatorHomeRoot: vaultRoot });
      const read = () => withIntegrationIngestMaterializer(vaultRoot, materialize, () => listIntegrationIngestsForEvent(vaultRoot, "evt_synthetic"));
      if (failure) {
        await expect(read()).rejects.toMatchObject({ code: "HOSTED_COLD_HISTORY_UNAVAILABLE", retryable: true });
        await expect(readFile(path.join(vaultRoot, closedPath))).rejects.toMatchObject({ code: "ENOENT" });
      } else {
        expect((await read())[0]?.record).toEqual(record);
        expect(downloads).toBe(1);
        expect((await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot: vaultRoot, vaultRoot })).entries)
          .toContainEqual(expect.objectContaining({ relativePath: closedPath, size: bytes.length }));
        // A downloaded cache never returns to the checkpoint archive.
        expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths).toEqual([closedPath]);
        await writeFile(path.join(vaultRoot, closedPath), new Uint8Array(bytes.length));
        expect((await read())[0]?.record).toEqual(record);
        expect(downloads).toBe(2);
      }
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
}

// Use real archive extraction around the production catalogue reconciliation.
// The encrypted archive/decrypt path is covered by workspace-snapshot-local.test.
test("cold catalogue survives restore, media merge, checkpoint and another restore unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cold-preserver-roundtrip-"));
  const source = path.join(root, "source");
  const restored = path.join(root, "restored");
  const restoredAgain = path.join(root, "restored-again");
  const tar = promisify(execFile);
  const entry = { relativePath: closedPath, mediaKind: "integration-ingest" as const,
    mediaId: "a".repeat(64), sha256: "b".repeat(64), byteSize: 42, expiresAt: null,
    mimeType: "application/octet-stream", recordedAt: "2020-01-01T00:00:00.000Z" };
  const catalogue: HostedMediaReferenceCatalogue = { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [entry] };
  const mediaStore: HostedRuntimeMediaStore = {
    put: vi.fn(async () => {}), get: vi.fn(async () => null), delete: vi.fn(async () => {}),
  };
  try {
    await initializeVault({ vaultRoot: source });
    await writeHostedMediaReferenceCatalogue({ vaultRoot: source, catalogue });
    await mkdir(restored); await mkdir(restoredAgain);
    const firstArchive = path.join(root, "first.tar");
    await tar("tar", ["-cf", firstArchive, "-C", source, "."]);
    await tar("tar", ["-xf", firstArchive, "-C", restored]);
    expect(await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).toEqual(catalogue);
    // Receipt/media reconciliation must preserve the same entry too.
    await publishHostedWorkspaceMediaReferences({ vaultRoot: restored, mediaStore });
    const publication = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restored, mediaStore });
    expect(publication.excludedVaultPaths).toEqual([closedPath]);
    expect(publication.prunedMediaCount).toBe(0);
    expect(await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).toEqual(catalogue);
    const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot: restored, vaultRoot: restored,
      excludedVaultPaths: publication.excludedVaultPaths });
    expect(plan.entries).toContainEqual(expect.objectContaining({ relativePath: HOSTED_MEDIA_REFS_RELATIVE_PATH }));
    expect(plan.entries.some((item) => item.relativePath === closedPath)).toBe(false);
    const checkpoint = path.join(root, "checkpoint.tar");
    await tar("tar", ["-cf", checkpoint, "-C", restored, "."]);
    await tar("tar", ["-xf", checkpoint, "-C", restoredAgain]);
    expect(await readHostedMediaReferenceCatalogue({ vaultRoot: restoredAgain })).toEqual(catalogue);
    expect(JSON.parse(await readFile(path.join(restoredAgain, HOSTED_MEDIA_REFS_RELATIVE_PATH), "utf8"))).toEqual(catalogue);
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
