import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, inflateRawSync } from "node:zlib";

import {
  integrationIngestReceiptSchema,
  integrationIngestRecordSchema,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestReceipt,
  type IntegrationIngestRecord,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import { toMonthlyShardRelativePath } from "./jsonl.ts";
import { resolveVaultPath } from "./path-safety.ts";

export const MAX_INTEGRATION_INGEST_PARTS = 10_000;
export const MAX_INTEGRATION_EVIDENCE_PART_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;

export interface BuildIntegrationEvidencePartInput {
  role: string;
  fileName: string;
  mediaType: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BuildIntegrationIngestRecordInput {
  id: string;
  provider: string;
  accountId?: string;
  source: "manual" | "import" | "device" | "derived";
  importedAt: string;
  receipt?: unknown;
  parts: readonly IntegrationEvidencePart[];
  eventOutputs: readonly IntegrationIngestEventOutput[];
  eventIdsComplete: boolean;
  sampleIds: readonly string[];
  sampleIdsComplete: boolean;
  eventCount: number;
  sampleCount: number;
  provenance?: Record<string, unknown>;
}

export interface IntegrationIngestAppendPlan {
  appendedIds: string[];
  payloads: Map<string, string>;
  targetShardPaths: string[];
}

export interface StoredIntegrationIngestEntry {
  relativePath: string;
  record: IntegrationIngestRecord;
}

interface RawIntegrationIngestJsonlRow {
  lineNumber: number;
  raw: unknown;
  relativePath: string;
  sourcePath: string;
}

type IntegrationIngestRowSourceKind = "jsonl" | "gzip" | "zip";

interface IntegrationIngestRowSource {
  kind: IntegrationIngestRowSourceKind;
  logicalPath: string;
  sourcePath: string;
}

interface ZipCentralDirectoryEntry {
  compressedSize: number;
  compressionMethod: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

const INTEGRATION_INGEST_ARCHIVE_SUFFIXES = [".gz", ".zip"] as const;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export function integrationIngestShardPath(importedAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.integrationIngestLedgerDirectory,
    importedAt,
    "importedAt",
  );
}

export function buildIntegrationEvidencePart(
  input: BuildIntegrationEvidencePartInput,
): IntegrationEvidencePart {
  const byteSize = Buffer.byteLength(input.content, "utf8");
  if (byteSize > MAX_INTEGRATION_EVIDENCE_PART_BYTES) {
    throw new VaultError(
      "INTEGRATION_EVIDENCE_PART_TOO_LARGE",
      `Integration evidence part "${input.role}" exceeds the ${MAX_INTEGRATION_EVIDENCE_PART_BYTES}-byte limit.`,
      { byteSize, role: input.role },
    );
  }

  return {
    role: input.role,
    fileName: input.fileName,
    mediaType: input.mediaType,
    content: input.content,
    byteSize,
    sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function compactIntegrationIngestReceipt(value: unknown): IntegrationIngestReceipt | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError(
      "INTEGRATION_INGEST_RECEIPT_INVALID",
      "Integration ingest receipt must be an object.",
    );
  }

  const receipt = value as Record<string, unknown>;
  const parsed = integrationIngestReceiptSchema.safeParse({
    schemaVersion: receipt.schemaVersion,
    id: receipt.id,
    provider: receipt.provider,
    userId: receipt.userId,
    accountId: receipt.accountId,
    connectionId: receipt.connectionId,
    sourceKind: receipt.sourceKind,
    deliveryMode: receipt.deliveryMode,
    resourceType: receipt.resourceType,
    resourceId: receipt.resourceId,
    providerEventId: receipt.providerEventId,
    eventType: receipt.eventType,
    observedAt: receipt.observedAt,
    occurredAt: receipt.occurredAt,
    windowStart: receipt.windowStart,
    windowEnd: receipt.windowEnd,
    cursor: receipt.cursor,
    signatureVerified: receipt.signatureVerified,
    payloadHash: receipt.payloadHash,
  });
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_RECEIPT_INVALID",
      "Integration ingest receipt failed contract validation.",
      { errors: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  return parsed.data;
}

export function buildIntegrationIngestRecord(
  input: BuildIntegrationIngestRecordInput,
): IntegrationIngestRecord {
  if (input.parts.length > MAX_INTEGRATION_INGEST_PARTS) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_MANY_PARTS",
      `Integration ingest may contain at most ${MAX_INTEGRATION_INGEST_PARTS} evidence parts.`,
      { partCount: input.parts.length },
    );
  }
  const totalPartBytes = input.parts.reduce((total, part) => total + part.byteSize, 0);
  if (totalPartBytes > MAX_INTEGRATION_INGEST_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_LARGE",
      `Integration ingest exceeds the ${MAX_INTEGRATION_INGEST_BYTES}-byte evidence limit.`,
      { totalPartBytes },
    );
  }

  const candidate = {
    schemaVersion: "murph.integration-ingest.v1" as const,
    id: input.id,
    provider: input.provider,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    source: input.source,
    importedAt: input.importedAt,
    ...(input.receipt ? { receipt: compactIntegrationIngestReceipt(input.receipt) } : {}),
    parts: [...input.parts],
    outputs: {
      events: [...input.eventOutputs],
      eventIdsComplete: input.eventIdsComplete,
      sampleIds: [...input.sampleIds],
      sampleIdsComplete: input.sampleIdsComplete,
    },
    counts: {
      eventCount: input.eventCount,
      sampleCount: input.sampleCount,
    },
    ...(input.provenance && Object.keys(input.provenance).length > 0
      ? { provenance: input.provenance }
      : {}),
  };

  const parsed = integrationIngestRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest failed contract validation before write.",
      { errors: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  assertIntegrationIngestRecordIntegrity(parsed.data);
  return parsed.data;
}

export function assertIntegrationIngestRecordIntegrity(record: IntegrationIngestRecord): void {
  let totalBytes = 0;
  for (const part of record.parts) {
    const byteSize = Buffer.byteLength(part.content, "utf8");
    const sha256 = createHash("sha256").update(part.content, "utf8").digest("hex");
    if (part.byteSize !== byteSize || part.sha256 !== sha256) {
      throw new VaultError(
        "INTEGRATION_EVIDENCE_INTEGRITY_INVALID",
        `Integration evidence part "${part.role}" failed byte-size or SHA-256 verification.`,
        { role: part.role },
      );
    }
    totalBytes += byteSize;
  }
  if (totalBytes > MAX_INTEGRATION_INGEST_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_LARGE",
      `Integration ingest exceeds the ${MAX_INTEGRATION_INGEST_BYTES}-byte evidence limit.`,
      { totalBytes },
    );
  }
}

export function stableSerializeIntegrationIngest(value: IntegrationIngestRecord): string {
  return JSON.stringify(stableSortJson(value));
}

export async function readIntegrationIngestEntries(
  vaultRoot: string,
): Promise<StoredIntegrationIngestEntry[]> {
  return readIntegrationIngestEntriesFromSources(
    vaultRoot,
    await listIntegrationIngestRowSources(vaultRoot),
  );
}

async function readIntegrationIngestEntriesFromSources(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
): Promise<StoredIntegrationIngestEntry[]> {
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();

  for await (const { raw, relativePath, sourcePath } of readIntegrationIngestJsonlRows(vaultRoot, sources)) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, relativePath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }
  return entries;
}

async function readIntegrationIngestEntriesByIdFromPaths(
  vaultRoot: string,
  paths: readonly string[],
  ids: ReadonlySet<string>,
): Promise<StoredIntegrationIngestEntry[]> {
  return readIntegrationIngestEntriesByIdFromSources(
    vaultRoot,
    await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, paths),
    ids,
  );
}

async function readIntegrationIngestEntriesByIdFromSources(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
  ids: ReadonlySet<string>,
): Promise<StoredIntegrationIngestEntry[]> {
  if (ids.size === 0) return [];
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();

  for await (const { raw, relativePath, sourcePath, lineNumber } of readIntegrationIngestJsonlRows(vaultRoot, sources)) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.importedAt !== "string") {
      throw new VaultError(
        "INTEGRATION_INGEST_INVALID",
        `Integration ingest record in "${sourcePath}" is missing id or importedAt.`,
        { relativePath: sourcePath, lineNumber },
      );
    }
    assertIntegrationIngestShard(raw.id, raw.importedAt, relativePath);
    if (!ids.has(raw.id)) {
      continue;
    }
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }

  return entries;
}

export async function buildIntegrationIngestAppendPlan(
  vaultRoot: string,
  records: readonly IntegrationIngestRecord[],
): Promise<IntegrationIngestAppendPlan> {
  const targetShardPaths = [
    ...new Set(records.map((record) => integrationIngestShardPath(record.importedAt))),
  ].sort();
  const requestedIds = new Set(records.map((record) => record.id));
  const targetSources = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, targetShardPaths);
  const archivedTargets = new Set(
    targetSources
      .filter((source) => source.kind !== "jsonl")
      .map((source) => source.logicalPath),
  );
  const existingById = new Map(
    (await readIntegrationIngestEntriesByIdFromSources(vaultRoot, targetSources, requestedIds)).map((entry) =>
      [entry.record.id, entry.record] as const,
    ),
  );
  const pendingById = new Map<string, IntegrationIngestRecord>();
  const payloads = new Map<string, string>();
  const appendedIds: string[] = [];

  for (const record of records) {
    assertIntegrationIngestRecordIntegrity(record);
    const existing = existingById.get(record.id) ?? pendingById.get(record.id);
    if (existing) {
      if (stableSerializeIntegrationIngest(existing) !== stableSerializeIntegrationIngest(record)) {
        throw new VaultError(
          "INTEGRATION_INGEST_ID_CONFLICT",
          `Integration ingest id "${record.id}" already exists with different content.`,
          { ingestId: record.id },
        );
      }
      continue;
    }

    pendingById.set(record.id, record);
    appendedIds.push(record.id);
    const relativePath = integrationIngestShardPath(record.importedAt);
    if (archivedTargets.has(relativePath)) {
      throw new VaultError(
        "INTEGRATION_INGEST_SHARD_ARCHIVED",
        `Integration ingest shard "${relativePath}" is archived and cannot be appended.`,
        { ingestId: record.id, relativePath },
      );
    }
    const rowPayload = `${JSON.stringify(record)}\n`;
    const rowPayloadBytes = Buffer.byteLength(rowPayload, "utf8");
    if (rowPayloadBytes > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
      throw new VaultError(
        "INTEGRATION_INGEST_ROW_TOO_LARGE",
        `Integration ingest row "${record.id}" exceeds the ${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte journal limit.`,
        { ingestId: record.id, rowPayloadBytes },
      );
    }
    payloads.set(relativePath, `${payloads.get(relativePath) ?? ""}${rowPayload}`);
  }

  return { appendedIds, payloads, targetShardPaths };
}

export async function stageIntegrationIngestAppendPlan(
  batch: { stageJsonlAppend(relativePath: string, content: string): Promise<string> },
  plan: IntegrationIngestAppendPlan,
): Promise<void> {
  for (const relativePath of [...plan.payloads.keys()].sort()) {
    const payload = plan.payloads.get(relativePath);
    if (payload) {
      await batch.stageJsonlAppend(relativePath, payload);
    }
  }
}

export async function listIntegrationIngestsForEvent(
  vaultRoot: string,
  eventId: string,
): Promise<StoredIntegrationIngestEntry[]> {
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();
  for await (const { raw, relativePath, sourcePath } of readIntegrationIngestJsonlRows(
    vaultRoot,
    await listIntegrationIngestRowSources(vaultRoot),
  )) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, relativePath);
    if (!record.outputs.events.some((output) => output.id === eventId)) {
      continue;
    }
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }
  return entries;
}

export async function readIntegrationIngestById(
  vaultRoot: string,
  ingestId: string,
): Promise<StoredIntegrationIngestEntry | null> {
  return (
    await readIntegrationIngestEntriesByIdFromSources(
      vaultRoot,
      await listIntegrationIngestRowSources(vaultRoot),
      new Set([ingestId]),
    )
  )[0] ?? null;
}

export function readIntegrationEvidencePart(
  record: IntegrationIngestRecord,
  role: string,
): IntegrationEvidencePart | null {
  assertIntegrationIngestRecordIntegrity(record);
  return record.parts.find((candidate) => candidate.role === role) ?? null;
}

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableSortJson(entry)]),
    );
  }
  return value;
}

async function* readIntegrationIngestJsonlRows(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
): AsyncGenerator<RawIntegrationIngestJsonlRow> {
  for (const source of sortIntegrationIngestRowSources(sources)) {
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    const lines = createInterface({
      input: await openIntegrationIngestLineStream(vaultRoot, source),
      crlfDelay: Infinity,
    });
    yield* parseIntegrationIngestJsonlLines(lines, source);
  }
}

async function* parseIntegrationIngestJsonlLines(
  lines: AsyncIterable<string>,
  source: IntegrationIngestRowSource,
): AsyncGenerator<RawIntegrationIngestJsonlRow> {
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${lineNumber}.`, {
        relativePath: source.sourcePath,
        lineNumber,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    yield {
      lineNumber,
      raw,
      relativePath: source.logicalPath,
      sourcePath: source.sourcePath,
    };
  }
}

async function openIntegrationIngestLineStream(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<NodeJS.ReadableStream> {
  const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "jsonl") {
    return createReadStream(absolutePath, { encoding: "utf8" });
  }
  if (source.kind === "gzip") {
    return createReadStream(absolutePath).pipe(createGunzip()).setEncoding("utf8");
  }
  return Readable.from([await readZippedIntegrationIngestJsonlText(vaultRoot, source)]);
}

async function listIntegrationIngestRowSources(
  vaultRoot: string,
): Promise<IntegrationIngestRowSource[]> {
  const sources = new Map<string, IntegrationIngestRowSource>();
  for (const extension of [".jsonl", ".jsonl.gz", ".jsonl.zip"] as const) {
    const paths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory, {
      extension,
    });
    for (const sourcePath of paths) {
      const source = integrationIngestRowSourceFromPath(sourcePath);
      sources.set(source.sourcePath, source);
    }
  }
  return assertSingleIntegrationIngestShardRepresentation(
    sortIntegrationIngestRowSources([...sources.values()]),
  );
}

async function listIntegrationIngestRowSourcesForLogicalPaths(
  vaultRoot: string,
  logicalPaths: readonly string[],
): Promise<IntegrationIngestRowSource[]> {
  const sources: IntegrationIngestRowSource[] = [];
  for (const logicalPath of [...new Set(logicalPaths)].sort()) {
    for (const sourcePath of [logicalPath, ...INTEGRATION_INGEST_ARCHIVE_SUFFIXES.map((suffix) => `${logicalPath}${suffix}`)]) {
      const resolved = resolveVaultPath(vaultRoot, sourcePath);
      if (await pathExists(resolved.absolutePath)) {
        sources.push(integrationIngestRowSourceFromPath(sourcePath));
      }
    }
  }
  return assertSingleIntegrationIngestShardRepresentation(sortIntegrationIngestRowSources(sources));
}

function integrationIngestRowSourceFromPath(sourcePath: string): IntegrationIngestRowSource {
  if (sourcePath.endsWith(".jsonl.gz")) {
    return {
      kind: "gzip",
      logicalPath: sourcePath.slice(0, -".gz".length),
      sourcePath,
    };
  }
  if (sourcePath.endsWith(".jsonl.zip")) {
    return {
      kind: "zip",
      logicalPath: sourcePath.slice(0, -".zip".length),
      sourcePath,
    };
  }
  return {
    kind: "jsonl",
    logicalPath: sourcePath,
    sourcePath,
  };
}

function sortIntegrationIngestRowSources(
  sources: readonly IntegrationIngestRowSource[],
): IntegrationIngestRowSource[] {
  return [...sources].sort((left, right) => {
    const logicalComparison = left.logicalPath.localeCompare(right.logicalPath);
    if (logicalComparison !== 0) return logicalComparison;
    return integrationIngestSourceKindOrder(left.kind) - integrationIngestSourceKindOrder(right.kind)
      || left.sourcePath.localeCompare(right.sourcePath);
  });
}

function integrationIngestSourceKindOrder(kind: IntegrationIngestRowSourceKind): number {
  if (kind === "jsonl") return 0;
  if (kind === "gzip") return 1;
  return 2;
}

async function readZippedIntegrationIngestJsonlText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<string> {
  const archivePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  const archiveStat = await stat(archivePath);
  if (archiveStat.size > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archiveStat.size, relativePath: source.sourcePath },
    );
  }
  const archive = await readFile(archivePath);
  const entry = selectZippedIntegrationIngestJsonlEntry(archive, source);
  assertZippedIntegrationIngestEntrySize(entry, source.sourcePath);
  const localHeaderOffset = entry.localHeaderOffset;
  assertZipReadableRange(archive, localHeaderOffset, 30, source.sourcePath);
  if (archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has an invalid local file header.`,
      { relativePath: source.sourcePath },
    );
  }
  if ((entry.flags & 0x1) !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      `Integration ingest archive "${source.sourcePath}" contains an encrypted entry.`,
      { relativePath: source.sourcePath },
    );
  }

  const fileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(localHeaderOffset + 28);
  const contentOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  assertZipReadableRange(archive, contentOffset, entry.compressedSize, source.sourcePath);
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  const content = unzipIntegrationIngestEntry(compressed, entry, source.sourcePath);
  if (content.byteLength !== entry.uncompressedSize) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has an invalid uncompressed size.`,
      { relativePath: source.sourcePath },
    );
  }
  return content.toString("utf8");
}

function selectZippedIntegrationIngestJsonlEntry(
  archive: Buffer,
  source: IntegrationIngestRowSource,
): ZipCentralDirectoryEntry {
  const entries = readZipCentralDirectory(archive, source.sourcePath)
    .filter((entry) => !entry.name.endsWith("/") && !entry.name.startsWith("__MACOSX/"));
  const expectedName = source.logicalPath.split("/").at(-1) ?? "";
  const exactNameMatches = entries.filter((entry) => zipEntryBaseName(entry.name) === expectedName);
  if (exactNameMatches.length === 1) {
    return exactNameMatches[0] as ZipCentralDirectoryEntry;
  }
  const jsonlEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"));
  if (jsonlEntries.length === 1) {
    return jsonlEntries[0] as ZipCentralDirectoryEntry;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_INVALID",
    `Integration ingest archive "${source.sourcePath}" must contain exactly one matching JSONL entry.`,
    { relativePath: source.sourcePath, entryCount: jsonlEntries.length },
  );
}

function readZipCentralDirectory(
  archive: Buffer,
  relativePath: string,
): ZipCentralDirectoryEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(archive);
  if (eocdOffset < 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" is missing a ZIP central directory.`,
      { relativePath },
    );
  }
  assertZipReadableRange(archive, eocdOffset, 22, relativePath);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === ZIP64_MARKER_16
    || centralDirectorySize === ZIP64_MARKER_32
    || centralDirectoryOffset === ZIP64_MARKER_32
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      `Integration ingest archive "${relativePath}" uses an unsupported ZIP variant.`,
      { relativePath },
    );
  }
  if (eocdOffset + 22 + commentLength !== archive.byteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid ZIP comment length.`,
      { relativePath },
    );
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  assertZipReadableRange(archive, centralDirectoryOffset, centralDirectorySize, relativePath);
  for (let index = 0; index < entryCount; index += 1) {
    assertZipReadableRange(archive, offset, 46, relativePath);
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" has an invalid central directory entry.`,
        { relativePath },
      );
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    if (
      compressedSize === ZIP64_MARKER_32
      || uncompressedSize === ZIP64_MARKER_32
      || localHeaderOffset === ZIP64_MARKER_32
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
        `Integration ingest archive "${relativePath}" uses an unsupported ZIP64 entry.`,
        { relativePath },
      );
    }

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    assertZipReadableRange(archive, nameStart, fileNameLength, relativePath);
    entries.push({
      compressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
      name: archive.subarray(nameStart, nameEnd).toString("utf8").replaceAll("\\", "/"),
      uncompressedSize,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralDirectoryEnd) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid central directory size.`,
      { relativePath },
    );
  }
  return entries;
}

function findZipEndOfCentralDirectory(archive: Buffer): number {
  const firstOffset = Math.max(0, archive.byteLength - ZIP_MAX_EOCD_SEARCH_BYTES);
  for (let offset = archive.byteLength - 22; offset >= firstOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function unzipIntegrationIngestEntry(
  compressed: Buffer,
  entry: ZipCentralDirectoryEntry,
  relativePath: string,
): Buffer {
  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(compressed, {
        maxOutputLength: MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
      });
    } catch (error) {
      if (isZlibMaxOutputLengthError(error)) {
        throw new VaultError(
          "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
          `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
          { relativePath },
        );
      }
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" contains invalid deflated data.`,
        { relativePath },
      );
    }
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
    `Integration ingest archive "${relativePath}" uses an unsupported compression method.`,
    { compressionMethod: entry.compressionMethod, relativePath },
  );
}

function assertSingleIntegrationIngestShardRepresentation(
  sources: readonly IntegrationIngestRowSource[],
): IntegrationIngestRowSource[] {
  const byLogicalPath = new Map<string, IntegrationIngestRowSource[]>();
  for (const source of sources) {
    const siblings = byLogicalPath.get(source.logicalPath) ?? [];
    siblings.push(source);
    byLogicalPath.set(source.logicalPath, siblings);
  }
  for (const [logicalPath, siblings] of byLogicalPath.entries()) {
    if (siblings.length <= 1) {
      continue;
    }
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT",
      `Integration ingest shard "${logicalPath}" has multiple physical representations.`,
      {
        relativePath: logicalPath,
        sourcePaths: siblings.map((source) => source.sourcePath).sort(),
      },
    );
  }
  return [...sources];
}

function assertZippedIntegrationIngestEntrySize(
  entry: ZipCentralDirectoryEntry,
  relativePath: string,
): void {
  if (entry.compressedSize > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" contains an entry that exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: entry.compressedSize, relativePath },
    );
  }
  if (entry.uncompressedSize > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" contains an entry that exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
      { byteSize: entry.uncompressedSize, relativePath },
    );
  }
}

function assertZipReadableRange(
  archive: Buffer,
  offset: number,
  length: number,
  relativePath: string,
): void {
  if (offset < 0 || length < 0 || offset + length > archive.byteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid ZIP offset.`,
      { relativePath },
    );
  }
}

function zipEntryBaseName(name: string): string {
  return name.split("/").at(-1) ?? name;
}

function isZlibMaxOutputLengthError(error: unknown): boolean {
  return error instanceof RangeError
    && (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
}

function parseIntegrationIngestRecord(
  raw: unknown,
  relativePath: string,
): IntegrationIngestRecord {
  const parsed = integrationIngestRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      `Integration ingest record in "${relativePath}" failed contract validation.`,
      { errors: parsed.error.issues.map((issue) => issue.message), relativePath },
    );
  }
  return parsed.data;
}

function assertIntegrationIngestShard(
  id: string,
  importedAt: string,
  relativePath: string,
): void {
  const expectedPath = integrationIngestShardPath(importedAt);
  if (expectedPath !== relativePath) {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_INVALID",
      `Integration ingest "${id}" belongs in "${expectedPath}", not "${relativePath}".`,
      { relativePath },
    );
  }
}

function assertUniqueIntegrationIngestId(
  seen: Map<string, string>,
  id: string,
  relativePath: string,
): void {
  const previousPath = seen.get(id);
  if (previousPath) {
    throw new VaultError(
      "INTEGRATION_INGEST_DUPLICATE_ID",
      `Integration ingest id "${id}" appears more than once.`,
      { previousPath, relativePath },
    );
  }
  seen.set(id, relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
