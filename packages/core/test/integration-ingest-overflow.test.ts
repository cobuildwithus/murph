import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

const faults = vi.hoisted(() => ({ compressedLimit: false, archiveRemoval: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const result = await actual.lstat(...args);
      if (faults.compressedLimit && /\.br\.[a-f0-9]+\.tmp$/.test(String(args[0]))) {
        faults.compressedLimit = false;
        Object.defineProperty(result, "size", { value: 128 * 1024 * 1024 + 1 });
      }
      return result;
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (faults.archiveRemoval && String(args[0]).endsWith(".br")) {
        faults.archiveRemoval = false;
        throw new Error("synthetic interruption before archive removal");
      }
      return actual.unlink(...args);
    },
  };
});

import {
  archiveClosedIntegrationIngestShards, buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan, buildIntegrationIngestRecord, importDeviceBatch,
  initializeVault, integrationIngestShardPath, MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
  readIntegrationIngestById, recoverInterruptedClosedIntegrationIngestArchives,
  runCanonicalWrite, stageIntegrationIngestAppendPlan, VaultError,
} from "../src/index.ts";

const vaults: string[] = [];
afterEach(async () => {
  faults.compressedLimit = false;
  faults.archiveRemoval = false;
  for (const vaultRoot of vaults.splice(0)) await fs.rm(vaultRoot, { recursive: true, force: true });
});

async function fixture(bytesPerRecord = 5 * 1024 * 1024, count = 1) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-ingest-overflow-"));
  vaults.push(vaultRoot);
  const now = new Date();
  const importedAt = now.toISOString();
  await initializeVault({ vaultRoot, createdAt: importedAt });
  const logicalPath = integrationIngestShardPath(importedAt);
  const plainPath = path.join(vaultRoot, logicalPath);
  await fs.mkdir(path.dirname(plainPath), { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const record = buildIntegrationIngestRecord({
      id: `xfm_OverflowBase${index}`, provider: "synthetic", source: "device", importedAt,
      parts: [buildIntegrationEvidencePart({ role: `base-${index}`, fileName: "base.txt", mediaType: "text/plain", content: "x".repeat(bytesPerRecord) })],
      eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true,
      eventCount: 0, sampleCount: 0,
    });
    await fs.appendFile(plainPath, `${JSON.stringify(record)}\n`);
  }
  const baseSize = (await fs.stat(plainPath)).size;
  const baseHash = await prefixHash(plainPath, baseSize);
  assert.equal((await archiveClosedIntegrationIngestShards({ vaultRoot, now, archiveCurrentMonth: true })).archivedShardCount, 1);
  return { vaultRoot, now, importedAt, logicalPath, plainPath, archivePath: `${plainPath}.br`, baseSize, baseHash };
}

async function prefixHash(file: string, byteLength: number) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { start: 0, end: byteLength - 1 })) hash.update(chunk);
  return hash.digest("hex");
}

function deviceInput(vaultRoot: string, importedAt: string, bytes = 32) {
  return {
    vaultRoot, importedAt, provider: "synthetic",
    evidenceParts: [{ role: "summary", fileName: "summary.txt", mediaType: "text/plain", content: "y".repeat(bytes) }],
    events: [{ kind: "observation" as const, occurredAt: importedAt, title: "Daily steps", evidenceRoles: ["summary"], fields: { metric: "daily-steps", value: 1234, unit: "count" } }],
    samples: [{ stream: "hrv" as const, recordedAt: importedAt, unit: "ms", quality: "normalized" as const, sample: { recordedAt: importedAt, value: 42 } }],
  };
}

async function assertImportedAndReplay(input: ReturnType<typeof deviceInput>, base: Awaited<ReturnType<typeof fixture>>) {
  const result = await importDeviceBatch(input);
  assert.equal(result.applied, true);
  assert.equal(result.events.length, 1);
  assert.equal(result.samples.length, 1);
  assert.ok((await fs.readFile(path.join(base.vaultRoot, result.eventShardPaths[0]!), "utf8")).includes(result.events[0]!.id));
  assert.ok((await fs.readFile(path.join(base.vaultRoot, result.sampleShardPaths[0]!), "utf8")).includes(result.samples[0]!.id));
  assert.equal((await readIntegrationIngestById(base.vaultRoot, result.ingestId))?.record.id, result.ingestId);
  await assert.rejects(fs.access(base.archivePath));
  assert.equal(await prefixHash(base.plainPath, base.baseSize), base.baseHash);
  const finalSize = (await fs.stat(base.plainPath)).size;
  const finalHash = await prefixHash(base.plainPath, finalSize);
  assert.equal((await importDeviceBatch(input)).applied, false);
  assert.equal((await fs.stat(base.plainPath)).size, finalSize);
  assert.equal(await prefixHash(base.plainPath, finalSize), finalHash);
}

test("valid device publication crosses the real uncompressed archive ceiling without losing evidence", async () => {
  const base = await fixture(63 * 1024 * 1024, 4);
  assert.ok(base.baseSize < MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES);
  await assertImportedAndReplay(deviceInput(base.vaultRoot, base.importedAt, 8 * 1024 * 1024), base);
  assert.ok((await fs.stat(base.plainPath)).size > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES);
}, 240_000);

test("compressed-size overflow and interrupted base publication recover before the device append", async () => {
  const base = await fixture();
  const originalArchive = await fs.readFile(base.archivePath);
  faults.compressedLimit = true;
  faults.archiveRemoval = true;
  const input = deviceInput(base.vaultRoot, base.importedAt);
  await assert.rejects(importDeviceBatch(input), /synthetic interruption/);
  assert.equal((await fs.stat(base.plainPath)).size, base.baseSize);
  assert.equal(await prefixHash(base.plainPath, base.baseSize), base.baseHash);
  assert.deepEqual(await fs.readFile(base.archivePath), originalArchive);
  assert.equal((await recoverInterruptedClosedIntegrationIngestArchives({ vaultRoot: base.vaultRoot, now: base.now })).repairedShardCount, 1);
  faults.compressedLimit = true;
  await assertImportedAndReplay(input, base);
});

test("a later canonical failure rolls an overflow append back to the unchanged plain base", async () => {
  const base = await fixture();
  const record = buildIntegrationIngestRecord({
    id: "xfm_OverflowRollback", provider: "synthetic", source: "device", importedAt: base.importedAt,
    parts: [buildIntegrationEvidencePart({ role: "new", fileName: "new.txt", mediaType: "text/plain", content: "new" })],
    eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true, eventCount: 0, sampleCount: 0,
  });
  const plan = await buildIntegrationIngestAppendPlan(base.vaultRoot, [record], { allowArchivedShardAmendments: true });
  const conflict = "bank/overflow-conflict.md";
  await fs.mkdir(path.dirname(path.join(base.vaultRoot, conflict)), { recursive: true });
  await fs.writeFile(path.join(base.vaultRoot, conflict), "existing");
  faults.compressedLimit = true;
  await assert.rejects(runCanonicalWrite({
    vaultRoot: base.vaultRoot, operationType: "overflow_rollback", summary: "verify overflow rollback",
    mutate: async ({ batch }) => {
      await stageIntegrationIngestAppendPlan(batch, plan);
      await batch.stageTextWrite(conflict, "replacement", { overwrite: false });
    },
  }), (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS");
  await assert.rejects(fs.access(base.archivePath));
  assert.equal((await fs.stat(base.plainPath)).size, base.baseSize);
  assert.equal(await prefixHash(base.plainPath, base.baseSize), base.baseHash);
  assert.equal(await readIntegrationIngestById(base.vaultRoot, record.id), null);
});
