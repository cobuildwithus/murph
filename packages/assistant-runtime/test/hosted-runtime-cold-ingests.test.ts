import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { materializeVaultMedia } from "@murphai/assistant-engine/assistant-codex";
import { restoreHostedBundleRoots, snapshotHostedBundleRoots } from "@murphai/runtime-state/node";
import { expect, test, vi } from "vitest";
import { addMeal, addMeasurement, archiveClosedIntegrationIngestShards, buildIntegrationEvidencePart, buildIntegrationIngestRecord, importDeviceBatch, initializeVault, readIntegrationIngestEntries, listIntegrationIngestsForEvent, withIntegrationIngestMaterializer } from "@murphai/core";
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

test.each([false, true])("bulk restoration preserves a committed later-month backfill and checkpoint, replaced=%s", async republish => {
  const root = await mkdtemp(path.join(tmpdir(), "cold-ingest-bulk-race-"));
  const vaultRoot = path.join(root, "live"), restoredRoot = path.join(root, "restored");
  const objects = new Map<string, Uint8Array>();
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const paused = new Promise<void>(resolve => { started = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  let holdFirst = true;
  const mediaStore: HostedRuntimeMediaStore = {
    put: async entry => { objects.set(entry.mediaId, entry.bytes); },
    get: async entry => {
      if (holdFirst) { holdFirst = false; started!(); await resumed; }
      return objects.get(entry.mediaId) ?? null;
    },
  };
  const batch = { vaultRoot, provider: "synthetic", events: [], samples: [],
    evidenceParts: [{ role: "payload", fileName: "payload.json", content: { value: 1 } }] };
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const first = await importDeviceBatch({ ...batch, importedAt: "2020-01-15T00:00:00.000Z" });
    const second = await importDeviceBatch({ ...batch, importedAt: "2020-02-15T00:00:00.000Z" });
    expect((await archiveClosedIntegrationIngestShards({ vaultRoot })).archivedShardCount).toBe(2);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
    expect(catalogue.entries).toHaveLength(2);
    for (const entry of catalogue.entries) await rm(path.join(vaultRoot, entry.relativePath));
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore });
    const bulk = materializeVaultMedia({ args: { all: true }, vaultRoot, materialize });
    try {
      await paused;
      const backfill = await withIntegrationIngestMaterializer(vaultRoot, materialize, () => importDeviceBatch({
        ...batch, importedAt: "2020-02-16T00:00:00.000Z",
        evidenceParts: [{ role: "payload", fileName: "payload.json", content: { value: 2 } }],
      }));
      expect(backfill.applied).toBe(true);
      const laterPath = catalogue.entries[1]!.relativePath;
      const committed = await readFile(path.join(vaultRoot, laterPath));
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(entry => entry.relativePath === laterPath)).toBe(false);
      if (republish) await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
      release!();
      expect(await bulk).toEqual({ requested: 2, available: 2, removed: 0, unavailable: [] });
      expect(await readFile(path.join(vaultRoot, laterPath))).toEqual(committed);
      const ids = [first.ingestId, second.ingestId, backfill.ingestId];
      expect((await readIntegrationIngestEntries(vaultRoot)).map(entry => entry.record.id)).toEqual(ids);
      // The normal checkpoint externalizes the winning shard. A cold restore
      // and materialization must recover the backfill as well as the old rows.
      const publication = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
      const snapshot = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault", shouldIncludeRelativePath: relativePath => !publication.excludedVaultPaths.includes(relativePath) }] });
      expect(snapshot).toBeTruthy();
      await restoreHostedBundleRoots({ bytes: snapshot!, expectedKind: "vault", roots: { vault: restoredRoot } });
      const restoredMaterialize = createHostedArtifactMaterializer({ vaultRoot: restoredRoot, operatorHomeRoot: restoredRoot, mediaStore });
      await withIntegrationIngestMaterializer(restoredRoot, restoredMaterialize, async () => {
        expect((await readIntegrationIngestEntries(restoredRoot)).map(entry => entry.record.id)).toEqual(ids);
      });
      expect(await readFile(path.join(restoredRoot, laterPath))).toEqual(committed);
    } finally { release!(); await bulk; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed media pruning retains newly uploaded cold history and the cleanup pointer", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "cold-ingests-prune-retry-"));
  const objects = new Map<string, Uint8Array>();
  let failDelete = true;
  const mediaStore: HostedRuntimeMediaStore = {
    put: async entry => { objects.set(entry.mediaId, entry.bytes); },
    get: async entry => objects.get(entry.mediaId) ?? null,
    delete: async ({ mediaId }) => {
      if (failDelete) { failDelete = false; throw new Error("Synthetic prune failure"); }
      objects.delete(mediaId);
    },
  };
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const stale = { byteSize: 3, expiresAt: null, mediaId: "a".repeat(64), mediaKind: "image" as const,
      mimeType: "image/jpeg", recordedAt: "2020-01-01T00:00:00.000Z",
      relativePath: "raw/meals/synthetic/thumbnail-stale.jpg", sha256: "b".repeat(64) };
    objects.set(stale.mediaId, new Uint8Array([1, 2, 3]));
    await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [stale] } });
    await mkdir(path.dirname(path.join(vaultRoot, closedPath)), { recursive: true });
    await writeFile(path.join(vaultRoot, closedPath), brotliCompressSync(Buffer.from('{"synthetic":true}\n')));
    await expect(publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).rejects.toThrow("Synthetic prune failure");
    const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
    expect(new Set(catalogue.entries.map(entry => entry.mediaId))).toEqual(new Set(objects.keys()));
    expect(catalogue.entries).toHaveLength(2);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    expect(objects.size).toBe(1);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([
      expect.objectContaining({ relativePath: closedPath, mediaKind: "integration-ingest" }),
    ]);
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

test("snapshot excludes closed ingest months, retains current month and sparse references", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "cold-ingests-"));
  const objects = new Map<string, Uint8Array>();
  const mediaStore: HostedRuntimeMediaStore = {
    put: async (entry) => { objects.set(entry.mediaId, entry.bytes); },
    get: async (entry) => objects.get(entry.mediaId) ?? null,
  };
  try {
    await initializeVault({ vaultRoot, title: "Synthetic cold history", timezone: "UTC" });
    const month = new Date().toISOString().slice(0, 7);
    const currentPath = `ledger/integration-ingests/${month.slice(0, 4)}/${month}.jsonl.br`;
    const bytes = brotliCompressSync(Buffer.from('{"synthetic":true}\n'));
    for (const relativePath of [closedPath, currentPath]) {
      await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
      await writeFile(path.join(vaultRoot, relativePath), bytes);
    }
    const result = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    expect(result.excludedVaultPaths).toEqual([closedPath]);
    const plan = await collectHostedWorkspaceSnapshotArchivePlan({ durableRoot: vaultRoot, vaultRoot, excludedVaultPaths: result.excludedVaultPaths });
    expect(plan.entries.some((entry) => entry.relativePath === closedPath)).toBe(false);
    expect(plan.entries.some((entry) => entry.relativePath === currentPath)).toBe(true);
    expect(plan.entries.some((entry) => entry.relativePath === HOSTED_MEDIA_REFS_RELATIVE_PATH)).toBe(true);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([
      expect.objectContaining({
        relativePath: closedPath, mediaKind: "integration-ingest", expiresAt: null,
        byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    ]);
    await rm(path.join(vaultRoot, closedPath));
    expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths)
      .toEqual([closedPath]);
    expect(objects.size).toBe(1);
    expect(await readFile(path.join(vaultRoot, currentPath))).toEqual(bytes);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("idle-compressed current month stays inline and appendable, then externalizes after rollover", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-11-15T12:00:00.000Z"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "active-cold-ingest-"));
  const objects = new Map<string, Uint8Array>();
  const mediaStore: HostedRuntimeMediaStore = {
    put: vi.fn(async (entry) => { objects.set(entry.mediaId, entry.bytes); }),
    get: vi.fn(async (entry) => objects.get(entry.mediaId) ?? null),
  };
  const importedAt = new Date().toISOString();
  const logicalPath = "ledger/integration-ingests/2030/2030-11.jsonl";
  const archivePath = `${logicalPath}.br`;
  const batch = { vaultRoot, provider: "synthetic", importedAt,
    evidenceParts: [{ role: "payload", fileName: "payload.json", content: { value: 1 } }],
    events: [], samples: [] };
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const record = buildIntegrationIngestRecord({
      id: "xfm_ActiveLarge", provider: "synthetic", source: "device", importedAt,
      parts: [buildIntegrationEvidencePart({ role: "payload", fileName: "payload.json",
        mediaType: "application/json", content: JSON.stringify({ evidence: "x".repeat(4 * 1024 * 1024) }) })],
      eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true,
      eventCount: 0, sampleCount: 0,
    });
    await mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
    await writeFile(path.join(vaultRoot, logicalPath), `${JSON.stringify(record)}\n`);
    expect((await archiveClosedIntegrationIngestShards({ vaultRoot, archiveCurrentMonth: true })).archivedShardCount).toBe(1);
    await expect(readFile(path.join(vaultRoot, logicalPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths).toEqual([]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([]);
    const first = await importDeviceBatch(batch);
    expect(first.applied).toBe(true);
    expect((await importDeviceBatch(batch)).applied).toBe(false);
    expect((await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id))
      .toEqual([record.id, first.ingestId]);
    const activeBytes = await readFile(path.join(vaultRoot, archivePath));
    const publication = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    expect(publication.excludedVaultPaths).toEqual([]);
    const plan = await collectHostedWorkspaceSnapshotArchivePlan({ vaultRoot, durableRoot: vaultRoot,
      excludedVaultPaths: publication.excludedVaultPaths });
    expect(plan.entries).toContainEqual(expect.objectContaining({ relativePath: archivePath, size: activeBytes.length }));
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2030-12-01T00:00:00.000Z"));
    expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths).toEqual([archivePath]);
    const [cold] = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
    expect(cold).toBeDefined();
    await rm(path.join(vaultRoot, archivePath));
    const materialize = createHostedArtifactMaterializer({ mediaStore, vaultRoot, operatorHomeRoot: vaultRoot });
    const historical = await withIntegrationIngestMaterializer(vaultRoot, materialize, () => importDeviceBatch({
      ...batch, evidenceParts: [{ role: "payload", fileName: "payload.json", content: { value: 2 } }],
    }));
    expect(historical.applied).toBe(true);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([]);
    expect((await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id))
      .toEqual([record.id, first.ingestId, historical.ingestId]);
    expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).excludedVaultPaths).toEqual([archivePath]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]?.sha256).not.toBe(cold!.sha256);
    expect(Buffer.from(objects.get(cold!.mediaId)!)).toEqual(activeBytes);
  } finally {
    vi.useRealTimers();
    await rm(vaultRoot, { recursive: true, force: true });
  }
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
    const photoPath = path.join(root, "fixture.jpg");
    await writeFile(photoPath, "synthetic retained photo");
    const meal = await addMeal({ vaultRoot: source, photoPath, occurredAt: "2020-01-01T00:00:00.000Z" });
    const measurement = await addMeasurement({ vaultRoot: source,
      draft: { title: "Synthetic measurement", occurredAt: "2020-01-01T00:00:00.000Z", measurements: [{ metric: "weight", value: 70, unit: "kg" }] },
      attachments: [{ role: "media_1", sourcePath: photoPath }] });
    for (const attachment of [meal.photo!, measurement.event.attachments![0]!]) {
      const bytes = await readFile(path.join(source, attachment.relativePath));
      catalogue.entries.push({ relativePath: attachment.relativePath, mediaKind: "image",
        mediaId: createHash("sha256").update(attachment.relativePath).digest("hex"),
        sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length,
        mimeType: "image/jpeg", recordedAt: entry.recordedAt, expiresAt: null });
      await rm(path.join(source, attachment.relativePath));
    }
    // A newer producer fixture writes sole-copy references; the preserver must
    // carry them through canonical merge and its next sparse checkpoint.
    await writeHostedMediaReferenceCatalogue({ vaultRoot: source, catalogue });
    await mkdir(restored); await mkdir(restoredAgain);
    const firstArchive = path.join(root, "first.tar");
    await tar("tar", ["-cf", firstArchive, "-C", source, "."]);
    await tar("tar", ["-xf", firstArchive, "-C", restored]);
    expect(await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).toEqual(catalogue);
    for (const photo of [meal.photo!, measurement.event.attachments![0]!]) {
      await expect(readFile(path.join(restored, photo.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    }
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
    for (const photo of [meal.photo!, measurement.event.attachments![0]!]) {
      await expect(readFile(path.join(restoredAgain, photo.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(JSON.parse(await readFile(path.join(restoredAgain, HOSTED_MEDIA_REFS_RELATIVE_PATH), "utf8"))).toEqual(catalogue);
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
