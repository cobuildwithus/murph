import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterEach, test } from "vitest";
import {
  archiveClosedEventLedgerShards,
  archiveClosedIntegrationIngestShards,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  runCanonicalWrite,
  stageIntegrationIngestAppendPlan,
  initializeVault,
  listEventLedgerShardSources,
  readEvent,
  readIntegrationIngestById,
  upsertEvent,
} from "../src/index.ts";
import {
  appendArchivedIntegrationIngestShard,
  createArchivedIntegrationIngestShardContentReceipt,
  truncateArchivedIntegrationIngestShard,
} from "../src/integration-ingests.ts";
import {
  appendArchivedEventLedgerShard,
  createArchivedEventLedgerShardContentReceipt,
  truncateArchivedEventLedgerShard,
} from "../src/event-ledger-storage.ts";
import { compressShard, decompressShard } from "../src/shard-compression.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function createVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "murph-brotli-ledger-"));
  roots.push(root);
  await initializeVault({ vaultRoot: root, createdAt: "2026-01-01T00:00:00.000Z" });
  return root;
}

test.each(["gzip", "brotli"] as const)("%s decode enforces output bounds and rejects truncated frames", (kind) => {
  const content = Buffer.from("synthetic evidence\n".repeat(1000));
  const archive = compressShard(content, kind);
  assert.deepEqual(decompressShard(archive, kind, content.length), content);
  assert.throws(() => decompressShard(archive, kind, 128));
  assert.throws(() => decompressShard(archive.subarray(0, -3), kind, content.length));
});

test("Brotli event shards preserve logical reads, late writes and rollback receipts", async () => {
  const vaultRoot = await createVault();
  const event = await upsertEvent({ vaultRoot, payload: {
    kind: "note", title: "Synthetic archive", note: "Exact retained evidence.", occurredAt: "2026-01-02T00:00:00.000Z",
  } });
  const rawPath = path.join(vaultRoot, event.ledgerFile);
  const bytes = await fs.readFile(rawPath);
  await fs.writeFile(`${rawPath}.br`, brotliCompressSync(bytes));
  await fs.unlink(rawPath);
  assert.equal((await listEventLedgerShardSources(vaultRoot))[0]?.kind, "brotli");
  assert.equal((await readEvent({ vaultRoot, eventId: event.eventId })).event.title, "Synthetic archive");
  const receipt = await createArchivedEventLedgerShardContentReceipt(vaultRoot, event.ledgerFile);
  assert.ok(receipt);
  const input = { vaultRoot, targetRelativePath: event.ledgerFile,
    expectedBaseByteLength: receipt.byteLength, expectedBaseSha256: receipt.sha256 };
  await appendArchivedEventLedgerShard({ ...input, payload: '{"id":"evt_synthetic_late"}\n' });
  await appendArchivedEventLedgerShard({ ...input, payload: '{"id":"evt_synthetic_late"}\n' });
  await truncateArchivedEventLedgerShard(input);
  assert.deepEqual(brotliDecompressSync(await fs.readFile(`${rawPath}.br`)), bytes);
  await fs.writeFile(rawPath, bytes);
  await assert.rejects(listEventLedgerShardSources(vaultRoot), { code: "EVENT_LEDGER_SHARD_AMBIGUOUS" });
});

test("Brotli integration shards preserve exact content through append replay and rollback", async () => {
  const vaultRoot = await createVault();
  const logicalPath = "ledger/integration-ingests/2026/2026-01.jsonl";
  const makeRecord = (id: string) => buildIntegrationIngestRecord({
    id, provider: "synthetic", source: "device", importedAt: "2026-01-02T00:00:00.000Z",
    parts: [], eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true,
    eventCount: 0, sampleCount: 0,
  });
  const first = makeRecord("xfm_SyntheticFirst");
  const next = makeRecord("xfm_SyntheticNext");
  const bytes = Buffer.from(`${JSON.stringify(first)}\n`);
  const archivePath = path.join(vaultRoot, `${logicalPath}.br`);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, brotliCompressSync(bytes));
  assert.ok(await readIntegrationIngestById(vaultRoot, first.id));
  const receipt = await createArchivedIntegrationIngestShardContentReceipt(vaultRoot, logicalPath);
  assert.equal(receipt?.sha256, createHash("sha256").update(bytes).digest("hex"));
  const input = { vaultRoot, targetRelativePath: logicalPath,
    expectedBaseByteLength: bytes.length, expectedBaseSha256: receipt!.sha256 };
  const payload = `${JSON.stringify(next)}\n`;
  await appendArchivedIntegrationIngestShard({ ...input, payload });
  await appendArchivedIntegrationIngestShard({ ...input, payload });
  assert.ok(await readIntegrationIngestById(vaultRoot, next.id));
  await truncateArchivedIntegrationIngestShard(input);
  assert.deepEqual(brotliDecompressSync(await fs.readFile(archivePath)), bytes);
  const plan = await buildIntegrationIngestAppendPlan(vaultRoot, [next], { allowArchivedShardAmendments: true });
  const conflictPath = "bank/synthetic-conflict.md";
  await fs.mkdir(path.dirname(path.join(vaultRoot, conflictPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, conflictPath), "existing\n");
  await assert.rejects(runCanonicalWrite({
    vaultRoot, operationType: "synthetic_archive_rollback", summary: "Synthetic rollback proof",
    mutate: async ({ batch }) => {
      await stageIntegrationIngestAppendPlan(batch, plan);
      await batch.stageTextWrite(conflictPath, "replacement\n", { overwrite: false });
    },
  }), { code: "VAULT_FILE_EXISTS" });
  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  assert.deepEqual(brotliDecompressSync(await fs.readFile(archivePath)), bytes);
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.gz`), compressShard(bytes, "gzip"));
  await assert.rejects(readIntegrationIngestById(vaultRoot, first.id), { code: "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT" });
});

test("malformed Brotli shards fail closed through both public readers", async () => {
  const vaultRoot = await createVault();
  for (const family of ["events", "integration-ingests"]) {
    const archivePath = path.join(vaultRoot, `ledger/${family}/2026/2026-01.jsonl.br`);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.writeFile(archivePath, "not an archive");
  }
  await assert.rejects(readEvent({ vaultRoot, eventId: "evt_synthetic_missing" }), { code: "EVENT_LEDGER_ARCHIVE_INVALID" });
  await assert.rejects(readIntegrationIngestById(vaultRoot, "xfm_SyntheticMissing"), { code: "INTEGRATION_INGEST_ARCHIVE_INVALID" });
});


for (const family of ["events", "integration-ingests"] as const) {
  const archive = (vaultRoot: string) => (family === "events"
    ? archiveClosedEventLedgerShards
    : archiveClosedIntegrationIngestShards)({ vaultRoot, now: new Date("2026-02-15T00:00:00.000Z") });
  const record = family === "events" ? { id: "evt_SyntheticArchive", kind: "note" }
    : buildIntegrationIngestRecord({
      id: "xfm_SyntheticArchive", provider: "synthetic", source: "device", importedAt: "2026-01-02T00:00:00.000Z",
      parts: [], eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true,
      eventCount: 0, sampleCount: 0,
    });
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  async function shard(vaultRoot: string, month = "01", year = "2026") {
    const absolutePath = path.join(vaultRoot, `ledger/${family}/${year}/${year}-${month}.jsonl`);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    return absolutePath;
  }

  test(`${family}: converts historical gzip exactly and leaves current/future months untouched`, async () => {
    const vaultRoot = await createVault();
    const historical = await shard(vaultRoot);
    const current = await shard(vaultRoot, "02");
    const future = await shard(vaultRoot, "03");
    const gzip = compressShard(bytes, "gzip");
    for (const absolutePath of [historical, current, future]) await fs.writeFile(`${absolutePath}.gz`, gzip);
    assert.equal((await archive(vaultRoot)).archivedShardCount, 1);
    assert.deepEqual(brotliDecompressSync(await fs.readFile(`${historical}.br`)), bytes);
    await assert.rejects(fs.access(`${historical}.gz`));
    assert.deepEqual(await fs.readFile(`${current}.gz`), gzip);
    assert.deepEqual(await fs.readFile(`${future}.gz`), gzip);
    assert.equal((await archive(vaultRoot)).archivedShardCount, 0);
  });

  test(`${family}: resumes interrupted gzip/Brotli publication without rewriting the retained archive`, async () => {
    const vaultRoot = await createVault();
    const absolutePath = await shard(vaultRoot);
    const brotli = compressShard(bytes, "brotli");
    await fs.writeFile(`${absolutePath}.gz`, compressShard(bytes, "gzip"));
    await fs.writeFile(`${absolutePath}.br`, brotli);
    assert.equal((await archive(vaultRoot)).repairedShardCount, 1);
    await assert.rejects(fs.access(`${absolutePath}.gz`));
    assert.deepEqual(await fs.readFile(`${absolutePath}.br`), brotli);
  });

  test(`${family}: preserves conflicting raw/gzip/Brotli copies`, async () => {
    const vaultRoot = await createVault();
    const absolutePath = await shard(vaultRoot);
    const different = Buffer.concat([bytes, bytes]);
    await fs.writeFile(absolutePath, bytes);
    await fs.writeFile(`${absolutePath}.gz`, compressShard(bytes, "gzip"));
    await fs.writeFile(`${absolutePath}.br`, compressShard(different, "brotli"));
    assert.equal((await archive(vaultRoot)).archivedShardCount, 0);
    assert.deepEqual(await fs.readFile(absolutePath), bytes);
    assert.deepEqual(decompressShard(await fs.readFile(`${absolutePath}.gz`), "gzip", 10000), bytes);
    assert.deepEqual(brotliDecompressSync(await fs.readFile(`${absolutePath}.br`)), different);
  });

  test(`${family}: a corrupt gzip does not prevent another closed month from archiving`, async () => {
    const vaultRoot = await createVault();
    const badPath = await shard(vaultRoot, "12", "2025");
    await fs.writeFile(`${badPath}.gz`, "broken gzip");
    const valid = await shard(vaultRoot);
    await fs.writeFile(`${valid}.gz`, compressShard(bytes, "gzip"));
    const result = await archive(vaultRoot);
    assert.equal(result.blockedShardCount, 1);
    assert.equal(result.archivedShardCount, 1);
    assert.equal(await fs.readFile(`${badPath}.gz`, "utf8"), "broken gzip");
    assert.deepEqual(brotliDecompressSync(await fs.readFile(`${valid}.br`)), bytes);
  });
}
