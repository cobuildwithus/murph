import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { deflateRawSync, gzipSync } from "node:zlib";
import { test } from "vitest";

import type { IntegrationIngestRecord } from "@murphai/contracts";

import {
  buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  initializeVault,
  listIntegrationIngestsForEvent,
  MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
  readIntegrationIngestById,
  readIntegrationIngestEntries,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function makeIntegrationIngestRecord(input: {
  eventId: string;
  id: string;
  importedAt: string;
  partContent?: string;
}): IntegrationIngestRecord {
  const role = `summary-${input.id}`;
  const part = buildIntegrationEvidencePart({
    role,
    fileName: `${input.id}.json`,
    mediaType: "application/json",
    content: input.partContent ?? JSON.stringify({ id: input.id }),
  });

  return buildIntegrationIngestRecord({
    id: input.id,
    provider: "junction",
    source: "device",
    importedAt: input.importedAt,
    parts: [part],
    eventOutputs: [
      {
        id: input.eventId,
        roles: [role],
      },
    ],
    eventIdsComplete: true,
    sampleIds: [],
    sampleIdsComplete: true,
    eventCount: 1,
    sampleCount: 0,
  });
}

async function writeIntegrationIngestJsonl(
  vaultRoot: string,
  relativePath: string,
  records: readonly IntegrationIngestRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}

async function writeIntegrationIngestGzipArchive(
  vaultRoot: string,
  logicalPath: string,
  records: readonly IntegrationIngestRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.gz`), gzipSync(content));
}

async function writeIntegrationIngestZipArchive(
  vaultRoot: string,
  logicalPath: string,
  records: readonly IntegrationIngestRecord[],
  options: { compressionMethod?: 0 | 8; entryName?: string } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await fs.writeFile(
    path.join(vaultRoot, `${logicalPath}.zip`),
    createSingleEntryZip(options.entryName ?? path.basename(logicalPath), content, {
      compressionMethod: options.compressionMethod,
    }),
  );
}

function createSingleEntryZip(
  fileName: string,
  content: string,
  options: { compressionMethod?: 0 | 8 } = {},
): Buffer {
  const compressionMethod = options.compressionMethod ?? 8;
  const fileNameBytes = Buffer.from(fileName, "utf8");
  const uncompressed = Buffer.from(content, "utf8");
  const compressed = compressionMethod === 0 ? uncompressed : deflateRawSync(uncompressed);
  const localHeader = Buffer.alloc(30 + fileNameBytes.byteLength);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(compressionMethod, 8);
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.byteLength, 18);
  localHeader.writeUInt32LE(uncompressed.byteLength, 22);
  localHeader.writeUInt16LE(fileNameBytes.byteLength, 26);
  localHeader.writeUInt16LE(0, 28);
  fileNameBytes.copy(localHeader, 30);

  const centralDirectoryOffset = localHeader.byteLength + compressed.byteLength;
  const centralDirectory = Buffer.alloc(46 + fileNameBytes.byteLength);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(compressionMethod, 10);
  centralDirectory.writeUInt32LE(0, 12);
  centralDirectory.writeUInt32LE(0, 16);
  centralDirectory.writeUInt32LE(compressed.byteLength, 20);
  centralDirectory.writeUInt32LE(uncompressed.byteLength, 24);
  centralDirectory.writeUInt16LE(fileNameBytes.byteLength, 28);
  centralDirectory.writeUInt16LE(0, 30);
  centralDirectory.writeUInt16LE(0, 32);
  centralDirectory.writeUInt16LE(0, 34);
  centralDirectory.writeUInt16LE(0, 36);
  centralDirectory.writeUInt32LE(0, 38);
  centralDirectory.writeUInt32LE(0, 42);
  fileNameBytes.copy(centralDirectory, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, centralDirectory, eocd]);
}

function findZipSignature(buffer: Buffer, signature: number): number {
  for (let offset = 0; offset <= buffer.byteLength - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  throw new Error(`Missing ZIP signature ${signature.toString(16)}.`);
}

test("integration ingest readers load closed-month gzip and zip archives", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archives");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const gzipRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedGzip1",
    eventId: "evt_ArchivedGzip1",
    importedAt: "2025-11-12T09:00:00.000Z",
  });
  const zipRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZip1",
    eventId: "evt_ArchivedZip1",
    importedAt: "2025-12-12T09:00:00.000Z",
  });
  const liveRecord = makeIntegrationIngestRecord({
    id: "xfm_LiveJsonl1",
    eventId: "evt_LiveJsonl1",
    importedAt: "2026-03-12T09:00:00.000Z",
  });

  await writeIntegrationIngestGzipArchive(
    vaultRoot,
    "ledger/integration-ingests/2025/2025-11.jsonl",
    [gzipRecord],
  );
  await writeIntegrationIngestZipArchive(
    vaultRoot,
    "ledger/integration-ingests/2025/2025-12.jsonl",
    [zipRecord],
  );
  await writeIntegrationIngestJsonl(
    vaultRoot,
    "ledger/integration-ingests/2026/2026-03.jsonl",
    [liveRecord],
  );

  const entries = await readIntegrationIngestEntries(vaultRoot);
  assert.deepEqual(
    entries.map((entry) => [entry.relativePath, entry.record.id]),
    [
      ["ledger/integration-ingests/2025/2025-11.jsonl", "xfm_ArchivedGzip1"],
      ["ledger/integration-ingests/2025/2025-12.jsonl", "xfm_ArchivedZip1"],
      ["ledger/integration-ingests/2026/2026-03.jsonl", "xfm_LiveJsonl1"],
    ],
  );

  const zipEntry = await readIntegrationIngestById(vaultRoot, "xfm_ArchivedZip1");
  assert.equal(zipEntry?.relativePath, "ledger/integration-ingests/2025/2025-12.jsonl");
  assert.equal(zipEntry?.record.id, "xfm_ArchivedZip1");

  const eventEntries = await listIntegrationIngestsForEvent(vaultRoot, "evt_ArchivedZip1");
  assert.deepEqual(eventEntries.map((entry) => entry.record.id), ["xfm_ArchivedZip1"]);
});

test("integration ingest zip archive reader accepts nested stored entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-stored-zip");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedStoredZip1",
    eventId: "evt_ArchivedStoredZip1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });

  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord], {
    compressionMethod: 0,
    entryName: `nested/${path.basename(logicalPath)}`,
  });

  const entries = await readIntegrationIngestEntries(vaultRoot);
  assert.deepEqual(
    entries.map((entry) => [entry.relativePath, entry.record.id]),
    [["ledger/integration-ingests/2025/2025-10.jsonl", "xfm_ArchivedStoredZip1"]],
  );

  const storedZipEntry = await readIntegrationIngestById(vaultRoot, "xfm_ArchivedStoredZip1");
  assert.equal(storedZipEntry?.relativePath, "ledger/integration-ingests/2025/2025-10.jsonl");
  assert.equal(storedZipEntry?.record.id, "xfm_ArchivedStoredZip1");
});

test("integration ingest readers reject live and archived copies of the same shard", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-representation-conflict");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-09.jsonl";
  const record = makeIntegrationIngestRecord({
    id: "xfm_RepresentationConflict1",
    eventId: "evt_RepresentationConflict1",
    importedAt: "2025-09-12T09:00:00.000Z",
  });

  await writeIntegrationIngestJsonl(vaultRoot, logicalPath, [record]);
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [record]);

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT");
      assert.deepEqual((error as VaultError).details.sourcePaths, [
        logicalPath,
        `${logicalPath}.zip`,
      ]);
      return true;
    },
  );
});

test("integration ingest zip archive reader rejects oversized entry metadata before inflate", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-oversized-zip");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-08.jsonl";
  const record = makeIntegrationIngestRecord({
    id: "xfm_OversizedZip1",
    eventId: "evt_OversizedZip1",
    importedAt: "2025-08-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(record)}\n`;
  const zip = createSingleEntryZip(path.basename(logicalPath), content);
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  zip.writeUInt32LE(MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES + 1, centralDirectoryOffset + 24);

  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.zip`), zip);

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE");
      return true;
    },
  );
});

test("integration ingest zip archive reader rejects mismatched central directory sizes", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-invalid-zip-directory");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-07.jsonl";
  const record = makeIntegrationIngestRecord({
    id: "xfm_InvalidZipDirectory1",
    eventId: "evt_InvalidZipDirectory1",
    importedAt: "2025-07-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(record)}\n`;
  const zip = createSingleEntryZip(path.basename(logicalPath), content);
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  zip.writeUInt32LE(zip.readUInt32LE(eocdOffset + 12) + 1, eocdOffset + 12);

  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.zip`), zip);

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_INVALID");
      return true;
    },
  );
});

test("integration ingest append plans refuse new rows for archived months", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-append");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedAppend1",
    eventId: "evt_ArchivedAppend1",
    importedAt: "2025-12-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(
    vaultRoot,
    "ledger/integration-ingests/2025/2025-12.jsonl",
    [archivedRecord],
  );

  const duplicatePlan = await buildIntegrationIngestAppendPlan(vaultRoot, [archivedRecord]);
  assert.deepEqual(duplicatePlan.appendedIds, []);
  assert.deepEqual([...duplicatePlan.payloads.keys()], []);

  const conflictingRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedAppend1",
    eventId: "evt_ArchivedAppend1",
    importedAt: "2025-12-12T09:00:00.000Z",
    partContent: JSON.stringify({ changed: true }),
  });
  await assert.rejects(
    buildIntegrationIngestAppendPlan(vaultRoot, [conflictingRecord]),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ID_CONFLICT");
      return true;
    },
  );

  const newArchivedMonthRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedAppend2",
    eventId: "evt_ArchivedAppend2",
    importedAt: "2025-12-13T09:00:00.000Z",
  });
  await assert.rejects(
    buildIntegrationIngestAppendPlan(vaultRoot, [newArchivedMonthRecord]),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
});
