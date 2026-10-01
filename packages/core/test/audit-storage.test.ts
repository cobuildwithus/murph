import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterEach, test } from "vitest";
import {
  applyHostedCanonicalWriteReceipt, archiveClosedAuditShards, initializeVault,
  listAuditShardPaths, readJsonlRecords, runCanonicalWrite, validateVault,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
} from "../src/index.ts";
import { visitJsonlRecordsInterruptible } from "../src/jsonl.ts";
import { emitAuditRecord } from "../src/audit.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function createRoot() {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-audit-storage-"));
  roots.push(vaultRoot);
  return vaultRoot;
}
async function createVault() {
  const vaultRoot = await createRoot();
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
  return vaultRoot;
}
const archive = (vaultRoot: string, signal?: AbortSignal) => archiveClosedAuditShards({
  vaultRoot, now: new Date("2026-02-15T00:00:00.000Z"), signal,
});
const append = (vaultRoot: string, summary: string, occurredAt = "2026-01-02T00:00:00.000Z") =>
  emitAuditRecord({ vaultRoot, action: "vault_init", summary, occurredAt });

test("closed audit months preserve exact records, validation and interruptible reads after restore", async () => {
  const vaultRoot = await createVault();
  const first = await append(vaultRoot, "Synthetic historical audit");
  const current = await append(vaultRoot, "Current audit", "2026-02-02T00:00:00.000Z");
  const future = await append(vaultRoot, "Future audit", "2026-03-02T00:00:00.000Z");
  const plain = await fs.readFile(path.join(vaultRoot, first.relativePath));
  const validationBefore = await validateVault({ vaultRoot });
  const result = await archive(vaultRoot);
  assert.equal(result.archivedShardCount, 1);
  assert.ok(result.archivedByteCount < result.sourceByteCount);
  assert.deepEqual(brotliDecompressSync(await fs.readFile(path.join(vaultRoot, `${first.relativePath}.br`))), plain);
  await assert.rejects(fs.access(path.join(vaultRoot, first.relativePath)), { code: "ENOENT" });
  for (const row of [current, future]) await fs.access(path.join(vaultRoot, row.relativePath));
  assert.equal((await archive(vaultRoot)).archivedShardCount, 0);
  assert.deepEqual(await validateVault({ vaultRoot }), validationBefore);
  const restored = await createRoot();
  await fs.cp(vaultRoot, restored, { recursive: true });
  assert.ok((await listAuditShardPaths(restored)).includes(first.relativePath));
  const records = await readJsonlRecords({ vaultRoot: restored, relativePath: first.relativePath });
  assert.ok(records.some((record) => record.id === first.record.id));
  const visited: unknown[] = [];
  await visitJsonlRecordsInterruptible({ vaultRoot: restored, relativePath: first.relativePath,
    visit: (record) => { visited.push(record); } });
  assert.deepEqual(visited, records);
});

test("late audit writes and hosted replay preserve archived history despite independent later writes", async () => {
  const vaultRoot = await createVault();
  const first = await append(vaultRoot, "Original audit");
  await archive(vaultRoot);
  const replayRoot = await createRoot();
  await fs.cp(vaultRoot, replayRoot, { recursive: true });
  const captured: HostedCanonicalWritePersistenceInput[] = [];
  const late = await withHostedCanonicalWritePort({
    persistCanonicalWrite: async (input) => { captured.push(input); },
  }, () => append(vaultRoot, "Late historical audit"));
  assert.equal(captured.length, 1);
  const saved = captured[0]!;
  // A restored history can have an independent audit that differs from the receipt base.
  const independent = await append(replayRoot, "Independent restored audit");
  const payloads = new Map(saved.payloads.map((item) => [item.sha256, item.bytes]));
  const replay = () => applyHostedCanonicalWriteReceipt({ vaultRoot: replayRoot, receipt: saved.receipt,
    readPayload: async (ref) => payloads.get(ref.sha256) ?? null });
  await replay();
  await replay();
  const records = await readJsonlRecords({ vaultRoot: replayRoot, relativePath: first.relativePath });
  for (const record of [first.record, late.record, independent.record]) {
    assert.equal(records.filter((row) => row.id === record.id).length, 1);
  }
  await assert.rejects(fs.access(path.join(replayRoot, first.relativePath)), { code: "ENOENT" });
  // Conflicting record identity must not overwrite the archive.
  const archivePath = path.join(replayRoot, `${first.relativePath}.br`);
  const changed = records.map((row) => row.id === late.record.id ? { ...row, summary: "Conflicting audit" } : row);
  const conflictBytes = brotliCompressSync(Buffer.from(changed.map((row) => JSON.stringify(row)).join("\n") + "\n"));
  await fs.writeFile(archivePath, conflictBytes);
  await assert.rejects(replay(), /conflicting content/);
  assert.deepEqual(await fs.readFile(archivePath), conflictBytes);
});

test("failed canonical writes roll archived audit appends back to the exact original bytes", async () => {
  const vaultRoot = await createVault();
  const first = await append(vaultRoot, "Original audit");
  await archive(vaultRoot);
  const archivePath = path.join(vaultRoot, `${first.relativePath}.br`);
  const original = await fs.readFile(archivePath);
  await assert.rejects(runCanonicalWrite({ vaultRoot, operationType: "audit_archive_rollback",
    summary: "Synthetic audit rollback proof", mutate: async ({ batch }) => {
      await emitAuditRecord({ vaultRoot, batch, action: "vault_init", occurredAt: "2026-01-03T00:00:00.000Z" });
      await batch.stageTextWrite("CORE.md", "Conflict\n", { overwrite: false });
    },
  }), { code: "VAULT_FILE_EXISTS" });
  assert.deepEqual(await fs.readFile(archivePath), original);
});

test("audit maintenance repairs only byte-equivalent interrupted copies and retains malformed history", async () => {
  const vaultRoot = await createVault();
  const first = await append(vaultRoot, "Original audit");
  const plainPath = path.join(vaultRoot, first.relativePath);
  const plain = await fs.readFile(plainPath);
  await fs.writeFile(`${plainPath}.br`, brotliCompressSync(plain));
  assert.equal((await archive(vaultRoot)).repairedShardCount, 1);
  const conflict = Buffer.from('{"id":"aud_conflict"}\n');
  await fs.writeFile(plainPath, conflict);
  assert.equal((await archive(vaultRoot)).blockedShardCount, 1);
  assert.deepEqual(await fs.readFile(plainPath), conflict);
  await assert.rejects(readJsonlRecords({ vaultRoot, relativePath: first.relativePath }), { code: "AUDIT_SHARD_AMBIGUOUS" });
  await fs.unlink(plainPath);
  await fs.writeFile(`${plainPath}.br`, "not an archive");
  await assert.rejects(readJsonlRecords({ vaultRoot, relativePath: first.relativePath }), { code: "AUDIT_ARCHIVE_INVALID" });
});

test("a foreground interruption leaves unarchived audit history intact", async () => {
  const vaultRoot = await createVault();
  const first = await append(vaultRoot, "Original audit");
  const plainPath = path.join(vaultRoot, first.relativePath);
  const plain = await fs.readFile(plainPath);
  const controller = new AbortController();
  const reason = new Error("Synthetic foreground wake");
  queueMicrotask(() => controller.abort(reason));
  await assert.rejects(archive(vaultRoot, controller.signal), (error) => error === reason);
  assert.deepEqual(await fs.readFile(plainPath), plain);
});
