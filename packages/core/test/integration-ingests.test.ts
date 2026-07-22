import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, gunzipSync, gzipSync } from "node:zlib";
import { test } from "vitest";

import type { IntegrationIngestRecord } from "@murphai/contracts";

import { createWorkspaceSourceImportExecOptions } from "../../../config/workspace-source-resolution.js";

import {
  appendJsonlRecord,
  applyCanonicalWriteBatch,
  applyHostedCanonicalWriteReceipt,
  archiveClosedIntegrationIngestShards,
  buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  initializeVault,
  integrationIngestShardPath,
  listIntegrationIngestsForEvent,
  MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES,
  MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
  readIntegrationIngestById,
  readIntegrationIngestEntries,
  recoverInterruptedClosedIntegrationIngestArchives,
  runCanonicalWrite,
  stageIntegrationIngestAppendPlan,
  validateVault,
  VaultError,
} from "../src/index.ts";
import { resolveVaultPath } from "../src/path-safety.ts";
import {
  assertJsonlAppendTargetCanAppend,
  assertWriteTargetPolicy,
} from "../src/write-policy.ts";
import {
  buildIntegrationIngestAppendPlanFromInspection,
  inspectIntegrationIngestIdsForImportedAt,
  selectNovelIntegrationIngestEvidence,
} from "../src/integration-ingests.ts";

const corePackageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceSourceImportExecOptions = createWorkspaceSourceImportExecOptions(
  corePackageDirectory,
  process.env,
);

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
  await writeIntegrationIngestGzipArchiveText(
    vaultRoot,
    logicalPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

async function writeIntegrationIngestGzipArchiveText(
  vaultRoot: string,
  logicalPath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.gz`), gzipSync(content));
}

function runArchivedNoveltySelectionInChild(
  vaultRoot: string,
  importedAt: string,
): { code: number | null; stderr: string; stdout: string } {
  const source = `
    import {
      buildIntegrationEvidencePart,
      selectNovelIntegrationIngestEvidence,
    } from "./packages/core/src/integration-ingests.ts";

    const vaultRoot = process.argv[1];
    const importedAt = process.argv[2];
    if (!vaultRoot || !importedAt) {
      throw new Error("vaultRoot and importedAt are required");
    }

    const part = buildIntegrationEvidencePart({
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      mediaType: "application/json",
      content: JSON.stringify({ revision: 1, stages: [] }),
    });
    const selection = await selectNovelIntegrationIngestEvidence({
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt,
      parts: [part],
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.stdout.write(JSON.stringify(selection));
  `;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", source, vaultRoot, importedAt],
    {
      cwd: workspaceSourceImportExecOptions.cwd,
      encoding: "utf8",
      env: workspaceSourceImportExecOptions.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (child.error) {
    throw child.error;
  }
  return {
    code: child.status,
    stderr: child.stderr.trim(),
    stdout: child.stdout.trim(),
  };
}

function runArchivedIntegrationIngestConsumerInChild(
  vaultRoot: string,
  importedAt: string,
  operation: "device-import" | "read-by-id",
): { code: number | null; stderr: string; stdout: string } {
  const source = `
    import {
      importDeviceBatch,
      readIntegrationIngestById,
      VaultError,
    } from "./packages/core/src/index.ts";

    const vaultRoot = process.argv[1];
    const importedAt = process.argv[2];
    const operation = process.argv[3];
    if (!vaultRoot || !importedAt || !operation) {
      throw new Error("vaultRoot, importedAt, and operation are required");
    }

    let outcome;
    try {
      if (operation === "device-import") {
        const result = await importDeviceBatch({
          vaultRoot,
          provider: "junction",
          accountId: "account-a",
          importedAt,
          evidenceParts: [{
            role: "junction-summary-sleep-cycle",
            fileName: "junction-summary-sleep-cycle.json",
            content: { revision: 2, stages: [] },
          }],
        });
        outcome = { ok: true, applied: result.applied };
      } else if (operation === "read-by-id") {
        const result = await readIntegrationIngestById(
          vaultRoot,
          "xfm_ArchivedConsumerMissing",
        );
        outcome = { ok: true, found: result !== null };
      } else {
        throw new Error("unsupported operation");
      }
    } catch (error) {
      outcome = {
        ok: false,
        code: error instanceof VaultError ? error.code : "UNKNOWN",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.stdout.write(JSON.stringify(outcome));
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      "--input-type=module",
      "--eval",
      source,
      vaultRoot,
      importedAt,
      operation,
    ],
    {
      cwd: workspaceSourceImportExecOptions.cwd,
      encoding: "utf8",
      env: workspaceSourceImportExecOptions.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (child.error) {
    throw child.error;
  }
  return {
    code: child.status,
    stderr: child.stderr.trim(),
    stdout: child.stdout.trim(),
  };
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
  return createZip([{ fileName, content, compressionMethod: options.compressionMethod }]);
}

function createZip(
  entries: readonly { fileName: string; content: string; compressionMethod?: 0 | 8 }[],
): Buffer {
  const localParts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const compressionMethod = entry.compressionMethod ?? 8;
    const fileNameBytes = Buffer.from(entry.fileName, "utf8");
    const uncompressed = Buffer.from(entry.content, "utf8");
    const compressed = compressionMethod === 0 ? uncompressed : deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed) >>> 0;
    const localHeader = Buffer.alloc(30 + fileNameBytes.byteLength);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(uncompressed.byteLength, 22);
    localHeader.writeUInt16LE(fileNameBytes.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    fileNameBytes.copy(localHeader, 30);

    const centralDirectory = Buffer.alloc(46 + fileNameBytes.byteLength);
    centralDirectory.writeUInt32LE(0x02014b50, 0);
    centralDirectory.writeUInt16LE(20, 4);
    centralDirectory.writeUInt16LE(20, 6);
    centralDirectory.writeUInt16LE(0, 8);
    centralDirectory.writeUInt16LE(compressionMethod, 10);
    centralDirectory.writeUInt32LE(0, 12);
    centralDirectory.writeUInt32LE(checksum, 16);
    centralDirectory.writeUInt32LE(compressed.byteLength, 20);
    centralDirectory.writeUInt32LE(uncompressed.byteLength, 24);
    centralDirectory.writeUInt16LE(fileNameBytes.byteLength, 28);
    centralDirectory.writeUInt16LE(0, 30);
    centralDirectory.writeUInt16LE(0, 32);
    centralDirectory.writeUInt16LE(0, 34);
    centralDirectory.writeUInt16LE(0, 36);
    centralDirectory.writeUInt32LE(0, 38);
    centralDirectory.writeUInt32LE(localHeaderOffset, 42);
    fileNameBytes.copy(centralDirectory, 46);

    localParts.push(localHeader, compressed);
    centralDirectoryParts.push(centralDirectory);
    localHeaderOffset += localHeader.byteLength + compressed.byteLength;
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectory = Buffer.concat(centralDirectoryParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function prefixSingleEntryZip(zip: Buffer, prefix: Buffer): Buffer {
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  const localAndPayload = zip.subarray(0, centralDirectoryOffset);
  const centralDirectoryAndEocd = Buffer.from(zip.subarray(centralDirectoryOffset));
  centralDirectoryAndEocd.writeUInt32LE(prefix.byteLength, 42);
  centralDirectoryAndEocd.writeUInt32LE(
    prefix.byteLength + centralDirectoryOffset,
    eocdOffset - centralDirectoryOffset + 16,
  );
  return Buffer.concat([prefix, localAndPayload, centralDirectoryAndEocd]);
}

function addLocalExtraFieldToSingleEntryZip(zip: Buffer, extraField: Buffer): Buffer {
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  const fileNameLength = zip.readUInt16LE(26);
  const insertOffset = 30 + fileNameLength;
  const withExtraField = Buffer.concat([
    zip.subarray(0, insertOffset),
    extraField,
    zip.subarray(insertOffset),
  ]);
  withExtraField.writeUInt16LE(extraField.byteLength, 28);
  withExtraField.writeUInt32LE(
    centralDirectoryOffset + extraField.byteLength,
    eocdOffset + extraField.byteLength + 16,
  );
  return withExtraField;
}

function addCentralDirectoryExtraFieldToSingleEntryZip(zip: Buffer, extraField: Buffer): Buffer {
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  const fileNameLength = zip.readUInt16LE(centralDirectoryOffset + 28);
  const insertOffset = centralDirectoryOffset + 46 + fileNameLength;
  const withExtraField = Buffer.concat([
    zip.subarray(0, insertOffset),
    extraField,
    zip.subarray(insertOffset),
  ]);
  withExtraField.writeUInt16LE(extraField.byteLength, centralDirectoryOffset + 30);
  withExtraField.writeUInt32LE(
    zip.readUInt32LE(eocdOffset + 12) + extraField.byteLength,
    eocdOffset + extraField.byteLength + 12,
  );
  return withExtraField;
}

function addCentralDirectoryFileCommentToSingleEntryZip(zip: Buffer, comment: Buffer): Buffer {
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  const fileNameLength = zip.readUInt16LE(centralDirectoryOffset + 28);
  const extraLength = zip.readUInt16LE(centralDirectoryOffset + 30);
  const insertOffset = centralDirectoryOffset + 46 + fileNameLength + extraLength;
  const withComment = Buffer.concat([
    zip.subarray(0, insertOffset),
    comment,
    zip.subarray(insertOffset),
  ]);
  withComment.writeUInt16LE(comment.byteLength, centralDirectoryOffset + 32);
  withComment.writeUInt32LE(
    zip.readUInt32LE(eocdOffset + 12) + comment.byteLength,
    eocdOffset + comment.byteLength + 12,
  );
  return withComment;
}

function insertBytesBetweenCentralDirectoryAndEocd(zip: Buffer, hiddenBytes: Buffer): Buffer {
  const eocdOffset = findZipSignature(zip, 0x06054b50);
  return Buffer.concat([
    zip.subarray(0, eocdOffset),
    hiddenBytes,
    zip.subarray(eocdOffset),
  ]);
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

test("closed integration ingest months archive deterministically while current and future months stay live", async () => {
  const firstVaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-first");
  const secondVaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-second");
  const closedPath = "ledger/integration-ingests/2026/2026-05.jsonl";
  const currentPath = "ledger/integration-ingests/2026/2026-06.jsonl";
  const futurePath = "ledger/integration-ingests/2026/2026-07.jsonl";
  const closedRecord = makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedClosed1",
    eventId: "evt_AutoArchivedClosed1",
    importedAt: "2026-05-12T09:00:00.000Z",
  });
  const currentRecord = makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedCurrent1",
    eventId: "evt_AutoArchivedCurrent1",
    importedAt: "2026-06-12T09:00:00.000Z",
  });
  const futureRecord = makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedFuture1",
    eventId: "evt_AutoArchivedFuture1",
    importedAt: "2026-07-12T09:00:00.000Z",
  });

  for (const vaultRoot of [firstVaultRoot, secondVaultRoot]) {
    await initializeVault({ vaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
    await writeIntegrationIngestJsonl(vaultRoot, closedPath, [closedRecord]);
    await writeIntegrationIngestJsonl(vaultRoot, currentPath, [currentRecord]);
    await writeIntegrationIngestJsonl(vaultRoot, futurePath, [futureRecord]);
  }
  const closedContent = await fs.readFile(path.join(firstVaultRoot, closedPath));

  const firstResult = await archiveClosedIntegrationIngestShards({
    now: new Date("2026-06-20T12:00:00.000Z"),
    vaultRoot: firstVaultRoot,
  });
  const secondResult = await archiveClosedIntegrationIngestShards({
    now: new Date("2026-06-20T12:00:00.000Z"),
    vaultRoot: secondVaultRoot,
  });

  assert.deepEqual(firstResult, {
    archivedByteCount: (await fs.stat(path.join(firstVaultRoot, `${closedPath}.gz`))).size,
    archivedShardCount: 1,
    blockedShardCount: 0,
    repairedShardCount: 0,
    scannedShardCount: 1,
    sourceByteCount: closedContent.byteLength,
  });
  assert.equal(secondResult.archivedShardCount, 1);
  await assert.rejects(fs.access(path.join(firstVaultRoot, closedPath)));
  await fs.access(path.join(firstVaultRoot, currentPath));
  await fs.access(path.join(firstVaultRoot, futurePath));
  assert.deepEqual(
    gunzipSync(await fs.readFile(path.join(firstVaultRoot, `${closedPath}.gz`))),
    closedContent,
  );
  assert.deepEqual(
    await fs.readFile(path.join(firstVaultRoot, `${closedPath}.gz`)),
    await fs.readFile(path.join(secondVaultRoot, `${closedPath}.gz`)),
  );
  assert.deepEqual(
    (await readIntegrationIngestEntries(firstVaultRoot)).map((entry) => entry.record.id),
    [
      "xfm_AutoArchivedClosed1",
      "xfm_AutoArchivedCurrent1",
      "xfm_AutoArchivedFuture1",
    ],
  );
});

test("automatic integration ingest archiving blocks invalid shards without delaying valid shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-invalid");
  await initializeVault({ vaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
  const invalidPath = "ledger/integration-ingests/2026/2026-04.jsonl";
  const validPath = "ledger/integration-ingests/2026/2026-05.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, invalidPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, invalidPath), "not-json\n", "utf8");
  await writeIntegrationIngestJsonl(vaultRoot, validPath, [makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedValid1",
    eventId: "evt_AutoArchivedValid1",
    importedAt: "2026-05-12T09:00:00.000Z",
  })]);

  const result = await archiveClosedIntegrationIngestShards({
    now: new Date("2026-06-20T12:00:00.000Z"),
    vaultRoot,
  });

  assert.equal(result.archivedShardCount, 1);
  assert.equal(result.blockedShardCount, 1);
  await fs.access(path.join(vaultRoot, invalidPath));
  await assert.rejects(fs.access(path.join(vaultRoot, `${invalidPath}.gz`)));
  await assert.rejects(fs.access(path.join(vaultRoot, validPath)));
  await fs.access(path.join(vaultRoot, `${validPath}.gz`));
});

test("automatic integration ingest archive recovery removes only an exact interrupted raw duplicate", async () => {
  const exactVaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-recover");
  await initializeVault({ vaultRoot: exactVaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
  const logicalPath = "ledger/integration-ingests/2026/2026-05.jsonl";
  const exactRecord = makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedRecover1",
    eventId: "evt_AutoArchivedRecover1",
    importedAt: "2026-05-12T09:00:00.000Z",
  });
  await writeIntegrationIngestJsonl(exactVaultRoot, logicalPath, [exactRecord]);
  await writeIntegrationIngestGzipArchive(exactVaultRoot, logicalPath, [exactRecord]);

  assert.deepEqual(
    await recoverInterruptedClosedIntegrationIngestArchives({
      now: new Date("2026-06-20T12:00:00.000Z"),
      vaultRoot: exactVaultRoot,
    }),
    { blockedConflictCount: 0, repairedShardCount: 1, scannedConflictCount: 1 },
  );
  await assert.rejects(fs.access(path.join(exactVaultRoot, logicalPath)));
  await fs.access(path.join(exactVaultRoot, `${logicalPath}.gz`));

  const emptyVaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-empty");
  await initializeVault({ vaultRoot: emptyVaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
  const emptyRawPath = path.join(emptyVaultRoot, logicalPath);
  await fs.mkdir(path.dirname(emptyRawPath), { recursive: true });
  await fs.writeFile(emptyRawPath, "", "utf8");
  await fs.writeFile(`${emptyRawPath}.gz`, gzipSync(""));

  assert.deepEqual(
    await recoverInterruptedClosedIntegrationIngestArchives({
      now: new Date("2026-06-20T12:00:00.000Z"),
      vaultRoot: emptyVaultRoot,
    }),
    { blockedConflictCount: 0, repairedShardCount: 1, scannedConflictCount: 1 },
  );
  await assert.rejects(fs.access(emptyRawPath));
  await fs.access(`${emptyRawPath}.gz`);

  const unterminatedVaultRoot = await makeTempDirectory(
    "murph-integration-ingest-auto-archive-unterminated",
  );
  await initializeVault({
    vaultRoot: unterminatedVaultRoot,
    createdAt: "2026-06-20T00:00:00.000Z",
  });
  const unterminatedRawPath = path.join(unterminatedVaultRoot, logicalPath);
  const unterminatedContent = JSON.stringify(exactRecord);
  await fs.mkdir(path.dirname(unterminatedRawPath), { recursive: true });
  await fs.writeFile(unterminatedRawPath, unterminatedContent, "utf8");
  await fs.writeFile(`${unterminatedRawPath}.gz`, gzipSync(unterminatedContent));

  assert.deepEqual(
    await recoverInterruptedClosedIntegrationIngestArchives({
      now: new Date("2026-06-20T12:00:00.000Z"),
      vaultRoot: unterminatedVaultRoot,
    }),
    { blockedConflictCount: 1, repairedShardCount: 0, scannedConflictCount: 1 },
  );
  await fs.access(unterminatedRawPath);
  await fs.access(`${unterminatedRawPath}.gz`);

  const conflictVaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-conflict");
  await initializeVault({ vaultRoot: conflictVaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
  await writeIntegrationIngestJsonl(conflictVaultRoot, logicalPath, [exactRecord]);
  await writeIntegrationIngestGzipArchive(conflictVaultRoot, logicalPath, [makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedConflict1",
    eventId: "evt_AutoArchivedConflict1",
    importedAt: "2026-05-13T09:00:00.000Z",
  })]);

  assert.deepEqual(
    await recoverInterruptedClosedIntegrationIngestArchives({
      now: new Date("2026-06-20T12:00:00.000Z"),
      vaultRoot: conflictVaultRoot,
    }),
    { blockedConflictCount: 1, repairedShardCount: 0, scannedConflictCount: 1 },
  );
  await fs.access(path.join(conflictVaultRoot, logicalPath));
  await fs.access(path.join(conflictVaultRoot, `${logicalPath}.gz`));
  await assert.rejects(
    readIntegrationIngestEntries(conflictVaultRoot),
    (error: unknown) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT",
  );
});

test("automatic integration ingest archiving makes no change when already aborted", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-auto-archive-aborted");
  await initializeVault({ vaultRoot, createdAt: "2026-06-20T00:00:00.000Z" });
  const logicalPath = "ledger/integration-ingests/2026/2026-05.jsonl";
  await writeIntegrationIngestJsonl(vaultRoot, logicalPath, [makeIntegrationIngestRecord({
    id: "xfm_AutoArchivedAborted1",
    eventId: "evt_AutoArchivedAborted1",
    importedAt: "2026-05-12T09:00:00.000Z",
  })]);

  await assert.rejects(archiveClosedIntegrationIngestShards({
    now: new Date("2026-06-20T12:00:00.000Z"),
    signal: AbortSignal.abort(),
    vaultRoot,
  }));
  await fs.access(path.join(vaultRoot, logicalPath));
  await assert.rejects(fs.access(path.join(vaultRoot, `${logicalPath}.gz`)));
});

test("integration evidence novelty reads bounded gzip and zip target archives", async () => {
  for (const archiveKind of ["gzip", "zip"] as const) {
    const vaultRoot = await makeTempDirectory(`murph-integration-ingest-novelty-${archiveKind}`);
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const importedAt = "2026-06-03T21:00:00.000Z";
    const logicalPath = integrationIngestShardPath(importedAt);
    const part = buildIntegrationEvidencePart({
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      mediaType: "application/json",
      content: JSON.stringify({ revision: 1, stages: [] }),
    });
    const record = buildIntegrationIngestRecord({
      id: archiveKind === "gzip"
        ? "xfm_11111111111111111111111111"
        : "xfm_22222222222222222222222222",
      provider: "junction",
      accountId: "account-a",
      source: "device",
      importedAt,
      parts: [part],
      eventOutputs: [],
      eventIdsComplete: true,
      sampleIds: [],
      sampleIdsComplete: true,
      eventCount: 0,
      sampleCount: 0,
    });
    if (archiveKind === "gzip") {
      await writeIntegrationIngestGzipArchive(vaultRoot, logicalPath, [record]);
    } else {
      await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [record]);
    }

    const selection = await selectNovelIntegrationIngestEvidence({
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt,
      parts: [part],
    });

    assert.deepEqual(selection, { parts: [], receiptIsNovel: false });
  }
});

test("integration evidence novelty makes every gzip outcome provisional through its trailer", async () => {
  const importedAt = "2026-06-03T21:00:00.000Z";
  const logicalPath = integrationIngestShardPath(importedAt);
  const matchingPart = buildIntegrationEvidencePart({
    role: "junction-summary-sleep-cycle",
    fileName: "junction-summary-sleep-cycle.json",
    mediaType: "application/json",
    content: JSON.stringify({ revision: 1, stages: [] }),
  });
  const matchingRecord = buildIntegrationIngestRecord({
    id: "xfm_33333333333333333333333333",
    provider: "junction",
    accountId: "account-a",
    source: "device",
    importedAt,
    parts: [matchingPart],
    eventOutputs: [],
    eventIdsComplete: true,
    sampleIds: [],
    sampleIdsComplete: true,
    eventCount: 0,
    sampleCount: 0,
  });
  const archivedMatchingPart = matchingRecord.parts[0];
  assert.ok(archivedMatchingPart);
  const integrityInvalidRecord = {
    ...matchingRecord,
    parts: [{
      ...archivedMatchingPart,
      byteSize: archivedMatchingPart.byteSize + 1,
    }],
  };
  const trailingRecord = makeIntegrationIngestRecord({
    id: "xfm_GzipTrailerValidationTail",
    eventId: "evt_GzipTrailerValidationTail",
    importedAt,
    partContent: randomBytes(1024 * 1024).toString("base64"),
  });
  const failOpenSelection = { parts: [matchingPart], receiptIsNovel: false };
  const scenarios = [
    {
      name: "complete",
      firstLine: JSON.stringify(matchingRecord),
      intactSelection: { parts: [], receiptIsNovel: false },
    },
    {
      name: "integrity-invalid",
      firstLine: JSON.stringify(integrityInvalidRecord),
      intactSelection: failOpenSelection,
    },
    {
      name: "malformed",
      firstLine: "{not-json}",
      intactSelection: failOpenSelection,
    },
  ];

  for (const scenario of scenarios) {
    const vaultRoot = await makeTempDirectory(
      `murph-integration-ingest-novelty-gzip-trailer-${scenario.name}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    await writeIntegrationIngestGzipArchiveText(
      vaultRoot,
      logicalPath,
      `${scenario.firstLine}\n${JSON.stringify(trailingRecord)}\n`,
    );

    const intact = runArchivedNoveltySelectionInChild(vaultRoot, importedAt);
    assert.equal(intact.code, 0, `${scenario.name}: ${intact.stderr}`);
    assert.equal(intact.stderr, "");
    assert.deepEqual(JSON.parse(intact.stdout), scenario.intactSelection);

    const archivePath = path.join(vaultRoot, `${logicalPath}.gz`);
    const archive = await fs.readFile(archivePath);
    await fs.writeFile(archivePath, archive.subarray(0, archive.byteLength - 8));

    const corrupt = runArchivedNoveltySelectionInChild(vaultRoot, importedAt);
    assert.equal(corrupt.code, 0, `${scenario.name}: ${corrupt.stderr}`);
    assert.equal(corrupt.stderr, "");
    assert.deepEqual(JSON.parse(corrupt.stdout), failOpenSelection);
  }
});

test("device imports and typed reads own gzip row failures through trailer validation", async () => {
  const importedAt = "2026-06-03T21:00:00.000Z";
  const logicalPath = integrationIngestShardPath(importedAt);
  const trailingRecord = makeIntegrationIngestRecord({
    id: "xfm_GzipConsumerTrailerTail",
    eventId: "evt_GzipConsumerTrailerTail",
    importedAt,
    partContent: randomBytes(1024 * 1024).toString("base64"),
  });
  const archiveContent = `{not-json}\n${JSON.stringify(trailingRecord)}\n`;

  for (const operation of ["device-import", "read-by-id"] as const) {
    for (const corruptTrailer of [false, true]) {
      const vaultRoot = await makeTempDirectory(
        `murph-integration-ingest-gzip-consumer-${operation}-${corruptTrailer}`,
      );
      await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
      await writeIntegrationIngestGzipArchiveText(vaultRoot, logicalPath, archiveContent);
      if (corruptTrailer) {
        const archivePath = path.join(vaultRoot, `${logicalPath}.gz`);
        const archive = await fs.readFile(archivePath);
        await fs.writeFile(archivePath, archive.subarray(0, archive.byteLength - 8));
      }

      const child = runArchivedIntegrationIngestConsumerInChild(
        vaultRoot,
        importedAt,
        operation,
      );
      assert.equal(child.code, 0, `${operation}/${corruptTrailer}: ${child.stderr}`);
      assert.equal(child.stderr, "");
      assert.deepEqual(JSON.parse(child.stdout), {
        ok: false,
        code: corruptTrailer
          ? "INTEGRATION_INGEST_ARCHIVE_INVALID"
          : "VAULT_INVALID_JSONL",
      });
    }
  }

  const integrityRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedConsumerMissing",
    eventId: "evt_ArchivedConsumerMissing",
    importedAt,
  });
  const integrityPart = integrityRecord.parts[0];
  assert.ok(integrityPart);
  const integrityInvalidContent = `${JSON.stringify({
    ...integrityRecord,
    parts: [{
      ...integrityPart,
      byteSize: integrityPart.byteSize + 1,
    }],
  })}\n${JSON.stringify(trailingRecord)}\n`;
  for (const corruptTrailer of [false, true]) {
    const vaultRoot = await makeTempDirectory(
      `murph-integration-ingest-gzip-consumer-integrity-${corruptTrailer}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    await writeIntegrationIngestGzipArchiveText(vaultRoot, logicalPath, integrityInvalidContent);
    if (corruptTrailer) {
      const archivePath = path.join(vaultRoot, `${logicalPath}.gz`);
      const archive = await fs.readFile(archivePath);
      await fs.writeFile(archivePath, archive.subarray(0, archive.byteLength - 8));
    }

    const child = runArchivedIntegrationIngestConsumerInChild(
      vaultRoot,
      importedAt,
      "read-by-id",
    );
    assert.equal(child.code, 0, `integrity/${corruptTrailer}: ${child.stderr}`);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), {
      ok: false,
      code: "INTEGRATION_INGEST_INVALID",
    });
  }
});

test("full exact-id inspection reuses one complete history for append planning after a bounded tail miss", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-inspection-reuse");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const importedAt = "2026-06-03T21:00:00.000Z";
  const logicalPath = integrationIngestShardPath(importedAt);
  const requestedRecord = makeIntegrationIngestRecord({
    id: "xfm_FallbackAppendTarget",
    eventId: "evt_FallbackAppendTarget",
    importedAt,
  });
  const historicalRecords = Array.from({ length: 65 }, (_, index) =>
    makeIntegrationIngestRecord({
      id: `xfm_UnrelatedHistory${index}`,
      eventId: `evt_UnrelatedHistory${index}`,
      importedAt,
    })
  );
  await writeIntegrationIngestJsonl(vaultRoot, logicalPath, historicalRecords);
  const requestedIds = new Set([requestedRecord.id]);

  const boundedInspection = await inspectIntegrationIngestIdsForImportedAt(
    vaultRoot,
    importedAt,
    requestedIds,
  );
  assert.equal(boundedInspection.historyComplete, false);
  assert.equal(boundedInspection.unsafe, false);
  assert.equal(boundedInspection.entriesById.size, 0);

  const fullInspection = await inspectIntegrationIngestIdsForImportedAt(
    vaultRoot,
    importedAt,
    requestedIds,
    { fullScan: true },
  );
  assert.equal(fullInspection.historyComplete, true);
  assert.equal(fullInspection.unsafe, false);
  assert.equal(fullInspection.entriesById.size, 0);

  const appendPlan = buildIntegrationIngestAppendPlanFromInspection(
    [requestedRecord],
    fullInspection,
  );
  assert.deepEqual(appendPlan.appendedIds, [requestedRecord.id]);
  assert.deepEqual(appendPlan.targetShardPaths, [logicalPath]);
});

test("selective ingest reads ignore malformed unrequested rows but validate the requested id", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-selective-read");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const importedAt = "2026-06-03T21:00:00.000Z";
  const logicalPath = integrationIngestShardPath(importedAt);
  const requestedRecord = makeIntegrationIngestRecord({
    id: "xfm_SelectiveRequested",
    eventId: "evt_SelectiveRequested",
    importedAt,
  });
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, logicalPath),
    [null, {}, { id: "xfm_UnrelatedMissingImportedAt" }, requestedRecord]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
    "utf8",
  );

  const stored = await readIntegrationIngestById(vaultRoot, requestedRecord.id);
  assert.equal(stored?.record.id, requestedRecord.id);

  const appendCandidate = makeIntegrationIngestRecord({
    id: "xfm_SelectiveAppend",
    eventId: "evt_SelectiveAppend",
    importedAt,
  });
  const appendPlan = await buildIntegrationIngestAppendPlan(vaultRoot, [appendCandidate]);
  assert.deepEqual(appendPlan.appendedIds, [appendCandidate.id]);

  await assert.rejects(
    readIntegrationIngestById(vaultRoot, "xfm_UnrelatedMissingImportedAt"),
    (error) => error instanceof VaultError && error.code === "INTEGRATION_INGEST_INVALID",
  );
});

test("integration ingest zip archive reader accepts exact stored entries", async () => {
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

test("integration ingest zip archive reader rejects path-bearing archive entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-path-zip-entry");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedPathZip1",
    eventId: "evt_ArchivedPathZip1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });

  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord], {
    entryName: `../${path.basename(logicalPath)}`,
  });

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    /must contain exactly one entry named/u,
  );
});

test("integration ingest zip archive reader rejects extra archive entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-extra-zip-entry");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipExtra1",
    eventId: "evt_ArchivedZipExtra1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, `${logicalPath}.zip`),
    createZip([
      { fileName: path.basename(logicalPath), content },
      { fileName: "raw-provider-payload.json", content: "{}\n" },
    ]),
  );

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_INVALID");
      assert.equal((error as VaultError).details.entryCount, 2);
      return true;
    },
  );
});

test("integration ingest zip archive reader rejects extra archive directory entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-extra-zip-directory");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipDirectory1",
    eventId: "evt_ArchivedZipDirectory1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, `${logicalPath}.zip`),
    createZip([
      { fileName: path.basename(logicalPath), content },
      { fileName: "nested/", content: "", compressionMethod: 0 },
    ]),
  );

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_INVALID");
      assert.equal((error as VaultError).details.entryCount, 2);
      return true;
    },
  );
});

test("integration ingest zip archive reader rejects hidden macOS archive entries", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-macos-zip-entry");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipMacos1",
    eventId: "evt_ArchivedZipMacos1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, `${logicalPath}.zip`),
    createZip([
      { fileName: path.basename(logicalPath), content },
      { fileName: "__MACOSX/raw-provider-payload.json", content: "{}\n" },
    ]),
  );

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_INVALID");
      assert.equal((error as VaultError).details.entryCount, 2);
      return true;
    },
  );
});

test("integration ingest zip archive reader rejects hidden leading archive bytes", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hidden-zip-bytes");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipHidden1",
    eventId: "evt_ArchivedZipHidden1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  const zip = prefixSingleEntryZip(
    createSingleEntryZip(path.basename(logicalPath), content),
    Buffer.from("hidden bytes\n", "utf8"),
  );
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

test("integration ingest zip archive reader rejects hidden entry metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hidden-zip-metadata");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipMetadata1",
    eventId: "evt_ArchivedZipMetadata1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });

  for (const [label, zip] of [
    [
      "local extra field",
      addLocalExtraFieldToSingleEntryZip(
        createSingleEntryZip(path.basename(logicalPath), content),
        Buffer.from("hidden local metadata\n", "utf8"),
      ),
    ],
    [
      "central directory file comment",
      addCentralDirectoryFileCommentToSingleEntryZip(
        createSingleEntryZip(path.basename(logicalPath), content),
        Buffer.from("hidden central metadata\n", "utf8"),
      ),
    ],
    [
      "central directory extra field",
      addCentralDirectoryExtraFieldToSingleEntryZip(
        createSingleEntryZip(path.basename(logicalPath), content),
        Buffer.from("hidden central extra metadata\n", "utf8"),
      ),
    ],
  ] as const) {
    await fs.writeFile(path.join(vaultRoot, `${logicalPath}.zip`), zip);

    await assert.rejects(
      readIntegrationIngestEntries(vaultRoot),
      (error) => {
        assert.equal(error instanceof VaultError, true, label);
        assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_INVALID", label);
        return true;
      },
    );
  }
});

test("integration ingest zip archive reader rejects hidden central directory padding", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hidden-zip-directory-padding");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedZipDirectoryPadding1",
    eventId: "evt_ArchivedZipDirectoryPadding1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(archivedRecord)}\n`;
  const zip = insertBytesBetweenCentralDirectoryAndEocd(
    createSingleEntryZip(path.basename(logicalPath), content),
    Buffer.from("hidden central directory padding\n", "utf8"),
  );
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

test("integration ingest zip archive reader rejects CRC mismatches", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-invalid-zip-crc");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-06.jsonl";
  const record = makeIntegrationIngestRecord({
    id: "xfm_InvalidZipCrc1",
    eventId: "evt_InvalidZipCrc1",
    importedAt: "2025-06-12T09:00:00.000Z",
  });
  const content = `${JSON.stringify(record)}\n`;
  const zip = createSingleEntryZip(path.basename(logicalPath), content);
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  zip.writeUInt32LE((zip.readUInt32LE(centralDirectoryOffset + 16) ^ 1) >>> 0, centralDirectoryOffset + 16);

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

test("integration ingest gzip archive reader rejects oversized compressed files", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-oversized-gzip");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-05.jsonl";
  const archivePath = path.join(vaultRoot, `${logicalPath}.gz`);
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(archivePath, "");
  await fs.truncate(
    archivePath,
    MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES + 1,
  );

  await assert.rejects(
    readIntegrationIngestEntries(vaultRoot),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE");
      return true;
    },
  );
});

test("integration ingest append plans require opt-in before amending archived months", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-append");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-12.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchivedAppend1",
    eventId: "evt_ArchivedAppend1",
    importedAt: "2025-12-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(
    vaultRoot,
    logicalPath,
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
  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "generic_integration_ingest_archive_append",
      summary: "reject generic archived integration ingest append",
      mutate: async ({ batch }) => {
        await Reflect.apply(batch.stageJsonlAppend, batch, [
          logicalPath,
          `${JSON.stringify(newArchivedMonthRecord)}\n`,
          { allowArchivedIntegrationIngestAmendment: true },
        ]);
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "forged_integration_ingest_archive_plan",
      summary: "reject forged archived integration ingest plan",
      mutate: async ({ batch }) => {
        await Reflect.apply(batch.stageIntegrationIngestAppendPlan, batch, [{
          archivedAmendmentShardPaths: [logicalPath],
          appendedIds: [newArchivedMonthRecord.id],
          payloads: new Map([
            [logicalPath, `${JSON.stringify(newArchivedMonthRecord)}\n`],
          ]),
          targetShardPaths: [logicalPath],
        }]);
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_INVALID");
      return true;
    },
  );

  const amendmentPlan = await buildIntegrationIngestAppendPlan(
    vaultRoot,
    [newArchivedMonthRecord],
    { allowArchivedShardAmendments: true },
  );
  assert.deepEqual(amendmentPlan.appendedIds, ["xfm_ArchivedAppend2"]);
  assert.deepEqual(amendmentPlan.archivedAmendmentShardPaths, [logicalPath]);
  assert.deepEqual([...amendmentPlan.payloads.keys()], [logicalPath]);

  const hostedAmendmentFlags: boolean[] = [];
  await runCanonicalWrite({
    hostedCanonicalWritePort: {
      async persistCanonicalWrite(input) {
        for (const action of input.receipt.actions) {
          if (action.kind === "jsonl_append") {
            hostedAmendmentFlags.push(
              action.allowArchivedIntegrationIngestAmendment === true,
            );
          }
        }
      },
    },
    vaultRoot,
    operationType: "integration_ingest_archive_amend",
    summary: "amend archived integration ingest shard",
    mutate: async ({ batch }) => {
      await stageIntegrationIngestAppendPlan(batch, amendmentPlan);
    },
  });
  assert.deepEqual(hostedAmendmentFlags, [true]);

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  await fs.access(path.join(vaultRoot, `${logicalPath}.zip`));
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_ArchivedAppend1", "xfm_ArchivedAppend2"],
  );
  assert.deepEqual(
    (await listIntegrationIngestsForEvent(vaultRoot, "evt_ArchivedAppend2")).map((entry) => entry.record.id),
    ["xfm_ArchivedAppend2"],
  );
});

test("integration ingest append plans do not scan live id conflicts outside target months", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-cross-shard-id");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const historicalPath = "ledger/integration-ingests/2025/2025-11.jsonl";
  const historicalRecord = makeIntegrationIngestRecord({
    id: "xfm_CrossShardDuplicate1",
    eventId: "evt_CrossShardDuplicate1",
    importedAt: "2025-11-12T09:00:00.000Z",
  });
  await writeIntegrationIngestJsonl(vaultRoot, historicalPath, [historicalRecord]);

  const incomingRecord = makeIntegrationIngestRecord({
    id: "xfm_CrossShardDuplicate1",
    eventId: "evt_CrossShardDuplicate2",
    importedAt: "2025-12-12T09:00:00.000Z",
  });
  const plan = await buildIntegrationIngestAppendPlan(vaultRoot, [incomingRecord]);
  assert.deepEqual(plan.appendedIds, ["xfm_CrossShardDuplicate1"]);
  assert.deepEqual([...plan.payloads.keys()], [
    "ledger/integration-ingests/2025/2025-12.jsonl",
  ]);
});

test("integration ingest append plans do not scan archived id conflicts outside target months", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-cross-shard-archive-id");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const historicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
  const historicalRecord = makeIntegrationIngestRecord({
    id: "xfm_CrossShardArchiveDuplicate1",
    eventId: "evt_CrossShardArchiveDuplicate1",
    importedAt: "2025-10-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, historicalPath, [historicalRecord]);

  const incomingRecord = makeIntegrationIngestRecord({
    id: "xfm_CrossShardArchiveDuplicate1",
    eventId: "evt_CrossShardArchiveDuplicate2",
    importedAt: "2025-12-12T09:00:00.000Z",
  });
  const plan = await buildIntegrationIngestAppendPlan(vaultRoot, [incomingRecord]);
  assert.deepEqual(plan.appendedIds, ["xfm_CrossShardArchiveDuplicate1"]);
  assert.deepEqual([...plan.payloads.keys()], [
    "ledger/integration-ingests/2025/2025-12.jsonl",
  ]);
});

test("generic JSONL append paths refuse archived integration ingest shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-generic-append-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-01.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_GenericArchivedAppend1",
    eventId: "evt_GenericArchivedAppend1",
    importedAt: "2025-01-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_GenericArchivedAppend2",
    eventId: "evt_GenericArchivedAppend2",
    importedAt: "2025-01-13T09:00:00.000Z",
  });
  await assert.rejects(
    appendJsonlRecord({ vaultRoot, relativePath: logicalPath, record: newRecord }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
});

test("generic text writes refuse archived integration ingest logical shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-generic-text-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-01.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_GenericArchivedText1",
    eventId: "evt_GenericArchivedText1",
    importedAt: "2025-01-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const replacementRecord = makeIntegrationIngestRecord({
    id: "xfm_GenericArchivedText2",
    eventId: "evt_GenericArchivedText2",
    importedAt: "2025-01-13T09:00:00.000Z",
  });
  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "integration_ingest_generic_text_archive",
      summary: "reject generic text write to archived integration ingest shard",
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(
          logicalPath,
          `${JSON.stringify(replacementRecord)}\n`,
          { allowAppendOnlyJsonl: true, overwrite: true },
        );
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  await fs.access(path.join(vaultRoot, `${logicalPath}.zip`));
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_GenericArchivedText1"],
  );
});

test("integration ingest archive amendments roll back with canonical write batches", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-rollback");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-01.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_RollbackArchivedAppend1",
    eventId: "evt_RollbackArchivedAppend1",
    importedAt: "2025-01-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_RollbackArchivedAppend2",
    eventId: "evt_RollbackArchivedAppend2",
    importedAt: "2025-01-13T09:00:00.000Z",
  });
  const amendmentPlan = await buildIntegrationIngestAppendPlan(
    vaultRoot,
    [newRecord],
    { allowArchivedShardAmendments: true },
  );
  const conflictPath = "bank/archive-rollback-conflict.md";
  await fs.mkdir(path.dirname(path.join(vaultRoot, conflictPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, conflictPath), "existing\n", "utf8");

  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "integration_ingest_archive_amend_rollback",
      summary: "roll back archived integration ingest amendment",
      mutate: async ({ batch }) => {
        await stageIntegrationIngestAppendPlan(batch, amendmentPlan);
        await batch.stageTextWrite(conflictPath, "replacement\n", { overwrite: false });
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "VAULT_FILE_EXISTS");
      return true;
    },
  );

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_RollbackArchivedAppend1"],
  );
  assert.equal(await fs.readFile(path.join(vaultRoot, conflictPath), "utf8"), "existing\n");
});

test("automatic gzip integration ingest archive amendments stream and roll back", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-gzip-amendment");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-01.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_GzipAmendment1",
    eventId: "evt_GzipAmendment1",
    importedAt: "2025-01-12T09:00:00.000Z",
  });
  await writeIntegrationIngestJsonl(vaultRoot, logicalPath, [archivedRecord]);
  assert.equal((await archiveClosedIntegrationIngestShards({
    now: new Date("2026-03-01T00:00:00.000Z"),
    vaultRoot,
  })).archivedShardCount, 1);

  const gzipPath = path.join(vaultRoot, `${logicalPath}.gz`);
  const originalGzip = await fs.readFile(gzipPath);
  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_GzipAmendment2",
    eventId: "evt_GzipAmendment2",
    importedAt: "2025-01-13T09:00:00.000Z",
  });
  const amendmentPlan = await buildIntegrationIngestAppendPlan(
    vaultRoot,
    [newRecord],
    { allowArchivedShardAmendments: true },
  );
  const conflictPath = "bank/gzip-amendment-conflict.md";
  await fs.mkdir(path.dirname(path.join(vaultRoot, conflictPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, conflictPath), "existing\n", "utf8");

  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "integration_ingest_gzip_amend_rollback",
      summary: "roll back gzipped integration ingest amendment",
      mutate: async ({ batch }) => {
        await stageIntegrationIngestAppendPlan(batch, amendmentPlan);
        await batch.stageTextWrite(conflictPath, "replacement\n", { overwrite: false });
      },
    }),
    (error) =>
      error instanceof VaultError
      && error.code === "VAULT_FILE_EXISTS",
  );

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  assert.deepEqual(await fs.readFile(gzipPath), originalGzip);
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_GzipAmendment1"],
  );

  await runCanonicalWrite({
    vaultRoot,
    operationType: "integration_ingest_gzip_amend",
    summary: "amend gzipped integration ingest shard",
    mutate: async ({ batch }) => {
      await stageIntegrationIngestAppendPlan(batch, amendmentPlan);
    },
  });

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  assert.deepEqual(
    gunzipSync(await fs.readFile(gzipPath)).toString("utf8"),
    `${JSON.stringify(archivedRecord)}\n${JSON.stringify(newRecord)}\n`,
  );
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_GzipAmendment1", "xfm_GzipAmendment2"],
  );
});

test("integration ingest archive amendments validate existing archived base rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-base-validation");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-01.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchiveBaseValidationExisting1",
    eventId: "evt_ArchiveBaseValidationExisting1",
    importedAt: "2025-01-12T09:00:00.000Z",
  });
  const corruptedRecord = {
    ...archivedRecord,
    parts: archivedRecord.parts.map((part) => ({
      ...part,
      sha256: "0".repeat(64),
    })),
  } satisfies IntegrationIngestRecord;
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [corruptedRecord]);

  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchiveBaseValidationNew1",
    eventId: "evt_ArchiveBaseValidationNew1",
    importedAt: "2025-01-13T09:00:00.000Z",
  });
  const amendmentPlan = await buildIntegrationIngestAppendPlan(
    vaultRoot,
    [newRecord],
    { allowArchivedShardAmendments: true },
  );

  await assert.rejects(
    runCanonicalWrite({
      vaultRoot,
      operationType: "integration_ingest_archive_base_validation",
      summary: "reject archived integration ingest amendment with invalid base",
      mutate: async ({ batch }) => {
        await stageIntegrationIngestAppendPlan(batch, amendmentPlan);
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_EVIDENCE_INTEGRITY_INVALID");
      return true;
    },
  );
});

test("hosted JSONL receipt replay refuses archived integration ingest shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hosted-replay-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2024/2024-12.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_HostedArchivedReplay1",
    eventId: "evt_HostedArchivedReplay1",
    importedAt: "2024-12-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_HostedArchivedReplay2",
    eventId: "evt_HostedArchivedReplay2",
    importedAt: "2024-12-13T09:00:00.000Z",
  });
  const appendPayload = `${JSON.stringify(newRecord)}\n`;
  const appendSha256 = createHash("sha256").update(appendPayload).digest("hex");
  await assert.rejects(
    applyHostedCanonicalWriteReceipt({
      vaultRoot,
      readPayload: async () => Buffer.from(appendPayload, "utf8"),
      receipt: {
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        operationId: "op_hosted_integration_archive_replay",
        operationType: "hosted_integration_archive_replay",
        summary: "reject archived integration ingest replay",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        occurredAt: "2026-03-01T00:00:00.000Z",
        committedAt: "2026-03-01T00:00:00.000Z",
        actions: [{
          kind: "jsonl_append",
          targetRelativePath: logicalPath,
          appendSha256,
          appendByteLength: Buffer.byteLength(appendPayload),
          baseSha256: createHash("sha256").update("").digest("hex"),
          baseByteLength: 0,
          originalSize: 0,
          contentRef: {
            sha256: appendSha256,
            byteSize: Buffer.byteLength(appendPayload),
          },
        }],
      },
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
});

test("hosted JSONL receipt replay can amend archived integration ingest shards when opted in", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hosted-replay-archive-amend");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2024/2024-12.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_HostedArchivedReplayAmend1",
    eventId: "evt_HostedArchivedReplayAmend1",
    importedAt: "2024-12-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const newRecord = makeIntegrationIngestRecord({
    id: "xfm_HostedArchivedReplayAmend2",
    eventId: "evt_HostedArchivedReplayAmend2",
    importedAt: "2024-12-13T09:00:00.000Z",
  });
  const basePayload = `${JSON.stringify(archivedRecord)}\n`;
  const baseSha256 = createHash("sha256").update(basePayload).digest("hex");
  const appendPayload = `${JSON.stringify(newRecord)}\n`;
  const appendSha256 = createHash("sha256").update(appendPayload).digest("hex");
  const receipt = {
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
    operationId: "op_hosted_integration_archive_replay_amend",
    operationType: "hosted_integration_archive_replay_amend",
    summary: "amend archived integration ingest replay",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    occurredAt: "2026-03-01T00:00:00.000Z",
    committedAt: "2026-03-01T00:00:00.000Z",
    actions: [{
      kind: "jsonl_append",
      targetRelativePath: logicalPath,
      appendSha256,
      appendByteLength: Buffer.byteLength(appendPayload),
      baseSha256,
      baseByteLength: Buffer.byteLength(basePayload),
      originalSize: Buffer.byteLength(basePayload),
      allowArchivedIntegrationIngestAmendment: true,
      contentRef: {
        sha256: appendSha256,
        byteSize: Buffer.byteLength(appendPayload),
      },
    }],
  } satisfies Parameters<typeof applyHostedCanonicalWriteReceipt>[0]["receipt"];

  await applyHostedCanonicalWriteReceipt({
    vaultRoot,
    readPayload: async () => Buffer.from(appendPayload, "utf8"),
    receipt,
  });
  await applyHostedCanonicalWriteReceipt({
    vaultRoot,
    readPayload: async () => Buffer.from(appendPayload, "utf8"),
    receipt,
  });

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  await fs.access(path.join(vaultRoot, `${logicalPath}.zip`));
  assert.deepEqual(
    (await readIntegrationIngestEntries(vaultRoot)).map((entry) => entry.record.id),
    ["xfm_HostedArchivedReplayAmend1", "xfm_HostedArchivedReplayAmend2"],
  );
});

test("generic canonical writes cannot overwrite or delete integration ingest archives", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-write-policy");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const zipLogicalPath = "ledger/integration-ingests/2024/2024-10.jsonl";
  const zipArchivePath = `${zipLogicalPath}.zip`;
  const zipArchivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchiveWritePolicy1",
    eventId: "evt_ArchiveWritePolicy1",
    importedAt: "2024-10-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, zipLogicalPath, [zipArchivedRecord]);

  const gzipLogicalPath = "ledger/integration-ingests/2024/2024-09.jsonl";
  const gzipArchivePath = `${gzipLogicalPath}.gz`;
  const gzipArchivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ArchiveWritePolicy2",
    eventId: "evt_ArchiveWritePolicy2",
    importedAt: "2024-09-12T09:00:00.000Z",
  });
  await writeIntegrationIngestGzipArchive(vaultRoot, gzipLogicalPath, [gzipArchivedRecord]);

  for (const archivePath of [zipArchivePath, gzipArchivePath]) {
    await assert.rejects(
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "integration_ingest_archive_overwrite",
        summary: "reject integration ingest archive overwrite",
        audit: {
          action: "jsonl_append",
          commandName: "test.integrationIngestArchiveOverwrite",
          summary: "Reject integration ingest archive overwrite.",
        },
        textWrites: [{
          relativePath: archivePath,
          content: "not an archive",
          overwrite: true,
        }],
      }),
      (error) => {
        assert.equal(error instanceof VaultError, true);
        assert.equal((error as VaultError).code, "VAULT_APPEND_ONLY_PATH");
        return true;
      },
    );

    await assert.rejects(
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "integration_ingest_archive_delete",
        summary: "reject integration ingest archive delete",
        audit: {
          action: "jsonl_append",
          commandName: "test.integrationIngestArchiveDelete",
          summary: "Reject integration ingest archive delete.",
        },
        deletes: [{ relativePath: archivePath }],
      }),
      (error) => {
        assert.equal(error instanceof VaultError, true);
        assert.equal((error as VaultError).code, "VAULT_APPEND_ONLY_PATH");
        return true;
      },
    );
  }

  const entry = await readIntegrationIngestById(vaultRoot, "xfm_ArchiveWritePolicy1");
  assert.equal(entry?.record.id, "xfm_ArchiveWritePolicy1");
  const gzipEntry = await readIntegrationIngestById(vaultRoot, "xfm_ArchiveWritePolicy2");
  assert.equal(gzipEntry?.record.id, "xfm_ArchiveWritePolicy2");
  await assert.rejects(fs.access(path.join(vaultRoot, zipLogicalPath)));
  await assert.rejects(fs.access(path.join(vaultRoot, gzipLogicalPath)));
});

test("integration ingest archive write policy honors case-insensitive path comparisons", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-archive-case-policy");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2024/2024-08.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, `${logicalPath}.zip`), "");

  const uppercaseArchivePath = "ledger/integration-ingests/2024/2024-08.JSONL.ZIP";
  for (const kind of ["text", "delete"] as const) {
    assert.doesNotThrow(() =>
      assertWriteTargetPolicy(uppercaseArchivePath, { kind }, { caseInsensitive: false })
    );
    assert.throws(
      () => assertWriteTargetPolicy(uppercaseArchivePath, { kind }, { caseInsensitive: true }),
      (error) => {
        assert.equal(error instanceof VaultError, true);
        assert.equal((error as VaultError).code, "VAULT_APPEND_ONLY_PATH");
        return true;
      },
    );
  }

  const uppercaseJsonlTarget = {
    ...resolveVaultPath(vaultRoot, logicalPath),
    relativePath: "ledger/integration-ingests/2024/2024-08.JSONL",
  };
  await assert.doesNotReject(
    assertJsonlAppendTargetCanAppend(uppercaseJsonlTarget, { caseInsensitive: false }),
  );
  await assert.rejects(
    assertJsonlAppendTargetCanAppend(uppercaseJsonlTarget, { caseInsensitive: true }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_SHARD_ARCHIVED");
      return true;
    },
  );
});

test("hosted JSONL receipt replay treats exact archived integration ingest duplicates as no-ops", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-hosted-replay-duplicate");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2024/2024-11.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_HostedArchivedReplayDuplicate1",
    eventId: "evt_HostedArchivedReplayDuplicate1",
    importedAt: "2024-11-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const appendPayload = `${JSON.stringify(archivedRecord)}\n`;
  const appendSha256 = createHash("sha256").update(appendPayload).digest("hex");
  await applyHostedCanonicalWriteReceipt({
    vaultRoot,
    readPayload: async () => Buffer.from(appendPayload, "utf8"),
    receipt: {
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
      operationId: "op_hosted_integration_archive_duplicate_replay",
      operationType: "hosted_integration_archive_duplicate_replay",
      summary: "no-op archived integration ingest replay",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      occurredAt: "2026-03-01T00:00:00.000Z",
      committedAt: "2026-03-01T00:00:00.000Z",
      actions: [{
        kind: "jsonl_append",
        targetRelativePath: logicalPath,
        appendSha256,
        appendByteLength: Buffer.byteLength(appendPayload),
        baseSha256: createHash("sha256").update("").digest("hex"),
        baseByteLength: 0,
        originalSize: 0,
        contentRef: {
          sha256: appendSha256,
          byteSize: Buffer.byteLength(appendPayload),
        },
      }],
    },
  });

  await assert.rejects(fs.access(path.join(vaultRoot, logicalPath)));
  const entries = await readIntegrationIngestEntries(vaultRoot);
  assert.deepEqual(entries.map((entry) => entry.record.id), ["xfm_HostedArchivedReplayDuplicate1"]);
});

test("validateVault validates archived integration ingest shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-validate-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const logicalPath = "ledger/integration-ingests/2025/2025-04.jsonl";
  const archivedRecord = makeIntegrationIngestRecord({
    id: "xfm_ValidateArchive1",
    eventId: "evt_ValidateArchive1",
    importedAt: "2025-04-12T09:00:00.000Z",
  });
  await writeIntegrationIngestZipArchive(vaultRoot, logicalPath, [archivedRecord]);

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("validateVault reports integration ingest archive conflicts and invalid archives", async () => {
  const conflictVaultRoot = await makeTempDirectory("murph-integration-ingest-validate-conflict");
  await initializeVault({ vaultRoot: conflictVaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const conflictPath = "ledger/integration-ingests/2025/2025-03.jsonl";
  const conflictRecord = makeIntegrationIngestRecord({
    id: "xfm_ValidateConflict1",
    eventId: "evt_ValidateConflict1",
    importedAt: "2025-03-12T09:00:00.000Z",
  });
  await writeIntegrationIngestJsonl(conflictVaultRoot, conflictPath, [conflictRecord]);
  await writeIntegrationIngestZipArchive(conflictVaultRoot, conflictPath, [conflictRecord]);

  const conflictValidation = await validateVault({ vaultRoot: conflictVaultRoot });
  assert.equal(conflictValidation.valid, false);
  assert.ok(
    conflictValidation.issues.some((issue) =>
      issue.code === "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT"
      && issue.path === conflictPath,
    ),
  );

  const invalidVaultRoot = await makeTempDirectory("murph-integration-ingest-validate-invalid");
  await initializeVault({ vaultRoot: invalidVaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });

  const invalidPath = "ledger/integration-ingests/2025/2025-02.jsonl";
  const invalidRecord = makeIntegrationIngestRecord({
    id: "xfm_ValidateInvalidArchive1",
    eventId: "evt_ValidateInvalidArchive1",
    importedAt: "2025-02-12T09:00:00.000Z",
  });
  const zip = createSingleEntryZip(path.basename(invalidPath), `${JSON.stringify(invalidRecord)}\n`);
  const centralDirectoryOffset = findZipSignature(zip, 0x02014b50);
  zip.writeUInt32LE((zip.readUInt32LE(centralDirectoryOffset + 16) ^ 1) >>> 0, centralDirectoryOffset + 16);
  await fs.mkdir(path.dirname(path.join(invalidVaultRoot, invalidPath)), { recursive: true });
  await fs.writeFile(path.join(invalidVaultRoot, `${invalidPath}.zip`), zip);

  const invalidValidation = await validateVault({ vaultRoot: invalidVaultRoot });
  assert.equal(invalidValidation.valid, false);
  assert.ok(
    invalidValidation.issues.some((issue) =>
      issue.code === "INTEGRATION_INGEST_ARCHIVE_INVALID"
      && issue.path === `${invalidPath}.zip`,
    ),
  );
});
