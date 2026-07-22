import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open as openFile, readFile, stat, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createGunzip,
  createGzip,
  crc32,
  deflateRawSync,
  gzipSync,
  inflateRawSync,
} from "node:zlib";

import {
  integrationIngestReceiptSchema,
  integrationIngestRecordSchema,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestReceipt,
  type IntegrationIngestRecord,
} from "@murphai/contracts";

import {
  prepareFileAtomic,
  prepareFileAtomicExclusive,
  writeFileAtomic,
} from "./atomic-write.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import { toMonthlyShardRelativePath } from "./jsonl.ts";
import { withCanonicalWriteLock } from "./operations/canonical-write-lock.ts";
import { resolveVaultPath } from "./path-safety.ts";

export const MAX_INTEGRATION_INGEST_PARTS = 10_000;
export const MAX_INTEGRATION_EVIDENCE_PART_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const INTEGRATION_INGEST_NOVELTY_MAX_SCAN_BYTES = 8 * 1024 * 1024;
const INTEGRATION_INGEST_NOVELTY_MAX_SCAN_ROWS = 64;
const INTEGRATION_INGEST_NOVELTY_SCAN_CHUNK_BYTES = 64 * 1024;
const INTEGRATION_INGEST_ARCHIVE_GZIP_LEVEL = 6;
const INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY = Symbol("integration-ingest-append-plan-authority");
const INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY = Symbol("integration-ingest-id-inspection-authority");

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
  readonly [INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY]: true;
  archivedAmendmentShardPaths: string[];
  appendedIds: string[];
  payloads: Map<string, string>;
  targetShardPaths: string[];
}

export interface BuildIntegrationIngestAppendPlanOptions {
  allowArchivedShardAmendments?: boolean;
}

export interface IntegrationIngestIdInspection {
  readonly [INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY]: true;
  archivedLogicalPaths: ReadonlySet<string>;
  entriesById: ReadonlyMap<string, IntegrationIngestRecord>;
  failOpenAppendAllowed: boolean;
  historyComplete: boolean;
  invalidIds: ReadonlySet<string>;
  logicalPath: string;
  requestedIds: ReadonlySet<string>;
  unsafe: boolean;
}

export interface ArchivedIntegrationIngestShardText {
  content: string;
}

export interface ArchivedIntegrationIngestShardContentReceipt {
  byteLength: number;
  sha256: string;
}

export interface ArchiveClosedIntegrationIngestShardsInput {
  now?: Date;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface ArchiveClosedIntegrationIngestShardsResult {
  archivedByteCount: number;
  archivedShardCount: number;
  blockedShardCount: number;
  repairedShardCount: number;
  scannedShardCount: number;
  sourceByteCount: number;
}

export interface RecoverInterruptedClosedIntegrationIngestArchivesInput {
  now?: Date;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface RecoverInterruptedClosedIntegrationIngestArchivesResult {
  blockedConflictCount: number;
  repairedShardCount: number;
  scannedConflictCount: number;
}

export interface InspectArchivedIntegrationIngestShardAppendInput {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  payload: Uint8Array;
  targetRelativePath: string;
  vaultRoot: string;
}

export type ArchivedIntegrationIngestShardAppendState = "applied" | "base";

export interface AppendArchivedIntegrationIngestShardInput {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  payload: string;
  targetRelativePath: string;
  vaultRoot: string;
}

export interface AppendArchivedIntegrationIngestShardResult {
  originalSize: number;
}

export interface TruncateArchivedIntegrationIngestShardInput {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  targetRelativePath: string;
  vaultRoot: string;
}

export interface StoredIntegrationIngestEntry {
  relativePath: string;
  record: IntegrationIngestRecord;
}

export interface SelectNovelIntegrationIngestEvidenceInput {
  vaultRoot: string;
  provider: string;
  accountId?: string;
  importedAt: string;
  parts: readonly IntegrationEvidencePart[];
  receipt?: IntegrationIngestReceipt;
  eventIdsByRole?: ReadonlyMap<string, ReadonlySet<string>>;
  sampleIds?: ReadonlySet<string>;
}

export interface NovelIntegrationIngestEvidenceSelection {
  parts: IntegrationEvidencePart[];
  receiptIsNovel: boolean;
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

interface IntegrationIngestSourceByteInspection
  extends ArchivedIntegrationIngestShardContentReceipt {
  endsWithNewline: boolean;
  prefixByteLength?: number;
  prefixSha256?: string;
  tailMatches?: boolean;
}

interface ValidatedIntegrationIngestSourceReceipt
  extends ArchivedIntegrationIngestShardContentReceipt {
  endsWithNewline: boolean;
  rowCount: number;
}

interface ZipCentralDirectoryEntry {
  centralDirectoryOffset: number;
  compressedSize: number;
  compressionMethod: number;
  crc32: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

type IntegrationIngestNoveltyTailDecision = "continue" | "complete" | "unsafe";

interface IntegrationIngestNoveltyTailScanResult {
  historyComplete: boolean;
  selectionComplete: boolean;
  unsafe: boolean;
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

function integrationEvidenceFingerprint(
  part: Pick<IntegrationEvidencePart, "role" | "sha256" | "mediaType" | "metadata">,
): string {
  return JSON.stringify([
    part.role,
    part.sha256,
    part.mediaType,
    stableSortJson(part.metadata ?? null),
  ]);
}

function integrationIngestAccountMatches(
  record: Pick<IntegrationIngestRecord, "accountId">,
  accountId: string | undefined,
): boolean {
  return (record.accountId ?? null) === (accountId ?? null);
}

function integrationIngestReceiptFingerprint(
  receipt: IntegrationIngestReceipt,
  includePayloadIdentity: boolean,
): string {
  return JSON.stringify([
    ...(includePayloadIdentity ? [receipt.id, receipt.payloadHash] : []),
    receipt.sourceKind,
    receipt.deliveryMode,
    receipt.resourceType ?? null,
    receipt.resourceId ?? null,
    receipt.providerEventId ?? null,
    receipt.eventType ?? null,
    receipt.occurredAt ?? null,
    receipt.signatureVerified ?? null,
  ]);
}

function rawIntegrationEvidenceFingerprint(value: unknown): string | null {
  if (
    !isRecord(value)
    || typeof value.role !== "string"
    || typeof value.sha256 !== "string"
    || typeof value.mediaType !== "string"
  ) {
    return null;
  }

  return JSON.stringify([
    value.role,
    value.sha256,
    value.mediaType,
    stableSortJson(value.metadata ?? null),
  ]);
}

function rawIntegrationIngestReceiptFingerprint(
  value: unknown,
  includePayloadIdentity: boolean,
): string | null {
  if (
    !isRecord(value)
    || typeof value.sourceKind !== "string"
    || typeof value.deliveryMode !== "string"
    || (includePayloadIdentity
      && (typeof value.id !== "string" || typeof value.payloadHash !== "string"))
  ) {
    return null;
  }

  return JSON.stringify([
    ...(includePayloadIdentity ? [value.id, value.payloadHash] : []),
    value.sourceKind,
    value.deliveryMode,
    value.resourceType ?? null,
    value.resourceId ?? null,
    value.providerEventId ?? null,
    value.eventType ?? null,
    value.occurredAt ?? null,
    value.signatureVerified ?? null,
  ]);
}

function rawIntegrationIngestCouldProveNovelty(input: {
  raw: Record<string, unknown>;
  receiptRequiresPayloadIdentity: boolean;
  requestedFingerprints: ReadonlySet<string>;
  requestedReceiptFingerprint: string | null;
}): boolean {
  if (
    Array.isArray(input.raw.parts)
    && input.raw.parts.some((part) => {
      const fingerprint = rawIntegrationEvidenceFingerprint(part);
      return fingerprint !== null && input.requestedFingerprints.has(fingerprint);
    })
  ) {
    return true;
  }

  return input.requestedReceiptFingerprint !== null
    && rawIntegrationIngestReceiptFingerprint(
      input.raw.receipt,
      input.receiptRequiresPayloadIdentity,
    ) === input.requestedReceiptFingerprint;
}

async function scanIntegrationIngestNoveltyTail(
  absolutePath: string,
  visitLine: (line: string) => IntegrationIngestNoveltyTailDecision,
): Promise<IntegrationIngestNoveltyTailScanResult> {
  const handle = await openFile(absolutePath, "r");

  try {
    const fileStat = await handle.stat();
    if (fileStat.size === 0) {
      return {
        historyComplete: true,
        selectionComplete: false,
        unsafe: false,
      };
    }

    let bytesReadTotal = 0;
    let lineSuffixChunks: Buffer[] = [];
    let position = fileStat.size;
    let rowsVisited = 0;
    let scanByteLimit = INTEGRATION_INGEST_NOVELTY_MAX_SCAN_BYTES;
    let completingOversizedTailRow = false;
    let strippedTrailingNewline = false;

    const visit = (lineBytes: Buffer): IntegrationIngestNoveltyTailScanResult | null => {
      rowsVisited += 1;
      if (lineBytes.length === 0) {
        return null;
      }
      const decision = visitLine(lineBytes.toString("utf8"));
      if (decision === "complete") {
        return {
          historyComplete: false,
          selectionComplete: true,
          unsafe: false,
        };
      }
      if (decision === "unsafe") {
        return {
          historyComplete: false,
          selectionComplete: false,
          unsafe: true,
        };
      }
      return null;
    };

    while (
      position > 0
      && bytesReadTotal < scanByteLimit
      && rowsVisited < INTEGRATION_INGEST_NOVELTY_MAX_SCAN_ROWS
    ) {
      const readSize = Math.min(
        position,
        INTEGRATION_INGEST_NOVELTY_SCAN_CHUNK_BYTES,
        scanByteLimit - bytesReadTotal,
      );
      const chunk = Buffer.allocUnsafe(readSize);
      const readPosition = position - readSize;
      const result = await handle.read(chunk, 0, readSize, readPosition);
      if (result.bytesRead !== readSize) {
        return {
          historyComplete: false,
          selectionComplete: false,
          unsafe: true,
        };
      }

      position = readPosition;
      bytesReadTotal += result.bytesRead;
      let segmentEnd = chunk.length;
      if (!strippedTrailingNewline) {
        if (chunk[chunk.length - 1] !== 0x0a) {
          return {
            historyComplete: false,
            selectionComplete: false,
            unsafe: true,
          };
        }
        segmentEnd -= 1;
        strippedTrailingNewline = true;
      }

      while (
        segmentEnd > 0
        && rowsVisited < INTEGRATION_INGEST_NOVELTY_MAX_SCAN_ROWS
      ) {
        const newlineIndex = chunk.lastIndexOf(0x0a, segmentEnd - 1);
        if (newlineIndex < 0) {
          break;
        }
        const leadingSegment = chunk.subarray(newlineIndex + 1, segmentEnd);
        const lineChunks = leadingSegment.length > 0
          ? [leadingSegment, ...lineSuffixChunks]
          : lineSuffixChunks;
        const firstLineChunk = lineChunks[0];
        const lineBytes = lineChunks.length === 1 && firstLineChunk
          ? firstLineChunk
          : Buffer.concat(lineChunks);
        const visitResult = visit(lineBytes);
        if (visitResult) {
          return visitResult;
        }
        if (completingOversizedTailRow) {
          return {
            historyComplete: false,
            selectionComplete: false,
            unsafe: false,
          };
        }
        lineSuffixChunks = [];
        segmentEnd = newlineIndex;
      }

      if (rowsVisited >= INTEGRATION_INGEST_NOVELTY_MAX_SCAN_ROWS) {
        return {
          historyComplete: position === 0 && segmentEnd === 0 && lineSuffixChunks.length === 0,
          selectionComplete: false,
          unsafe: false,
        };
      }
      if (segmentEnd > 0) {
        lineSuffixChunks.unshift(chunk.subarray(0, segmentEnd));
      }
      if (
        position > 0
        && rowsVisited === 0
        && bytesReadTotal >= scanByteLimit
        && scanByteLimit === INTEGRATION_INGEST_NOVELTY_MAX_SCAN_BYTES
      ) {
        // The ordinary tail budget ended inside the newest row. Finish only
        // that row so a bounded fail-open copy can prove the next replay, but
        // never use the extension to traverse older out-of-budget history.
        completingOversizedTailRow = true;
        scanByteLimit = MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES + 1;
      }
    }

    if (
      position === 0
      && lineSuffixChunks.length > 0
      && rowsVisited < INTEGRATION_INGEST_NOVELTY_MAX_SCAN_ROWS
    ) {
      const firstLineChunk = lineSuffixChunks[0];
      const lineBytes = lineSuffixChunks.length === 1 && firstLineChunk
        ? firstLineChunk
        : Buffer.concat(lineSuffixChunks);
      const visitResult = visit(lineBytes);
      if (visitResult) {
        return visitResult;
      }
      if (completingOversizedTailRow) {
        return {
          historyComplete: false,
          selectionComplete: false,
          unsafe: false,
        };
      }
      lineSuffixChunks = [];
    }

    return {
      historyComplete: position === 0 && lineSuffixChunks.length === 0,
      selectionComplete: false,
      unsafe: false,
    };
  } finally {
    await handle.close();
  }
}

export async function inspectIntegrationIngestIdsForImportedAt(
  vaultRoot: string,
  importedAt: string,
  requestedIds: ReadonlySet<string>,
  options: { fullScan?: boolean } = {},
): Promise<IntegrationIngestIdInspection> {
  const logicalPath = integrationIngestShardPath(importedAt);
  const sources = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  const source = sources.length === 1 ? sources[0] : undefined;
  const archivedLogicalPaths = new Set(
    sources.filter((candidate) => candidate.kind !== "jsonl").map((candidate) => candidate.logicalPath),
  );
  const entriesById = new Map<string, IntegrationIngestRecord>();
  const invalidIds = new Set<string>();
  let unsafe = sources.length > 1;

  const visitRaw = (raw: unknown, sourcePath: string): void => {
    if (!isRecord(raw) || typeof raw.id !== "string" || !requestedIds.has(raw.id)) {
      return;
    }
    try {
      const record = parseIntegrationIngestRecord(raw, sourcePath);
      assertIntegrationIngestShard(record.id, record.importedAt, logicalPath);
      assertIntegrationIngestRecordIntegrity(record);
      if (entriesById.has(record.id)) {
        unsafe = true;
        return;
      }
      entriesById.set(record.id, record);
    } catch {
      invalidIds.add(raw.id);
    }
  };

  if (!source) {
    return {
      [INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY]: true,
      archivedLogicalPaths,
      entriesById,
      failOpenAppendAllowed: false,
      historyComplete: !unsafe,
      invalidIds,
      logicalPath,
      requestedIds: new Set(requestedIds),
      unsafe,
    };
  }

  if (options.fullScan && source.kind === "jsonl") {
    let malformedHistory = false;
    let readFailed = false;
    let structurallyUnsafe = false;
    try {
      const lines = createInterface({
        input: await openIntegrationIngestLineStream(vaultRoot, source),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        if (Buffer.byteLength(line, "utf8") > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
          structurallyUnsafe = true;
          break;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          malformedHistory = true;
          for (const requestedId of requestedIds) {
            if (line.includes(JSON.stringify(requestedId))) {
              invalidIds.add(requestedId);
            }
          }
          continue;
        }
        visitRaw(raw, source.sourcePath);
        if (unsafe) {
          break;
        }
      }
    } catch {
      readFailed = true;
    }
    const failOpenAppendAllowed = malformedHistory
      && !unsafe
      && !readFailed
      && !structurallyUnsafe
      && invalidIds.size === 0;
    unsafe = unsafe || malformedHistory || readFailed || structurallyUnsafe;
    return {
      [INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY]: true,
      archivedLogicalPaths,
      entriesById,
      failOpenAppendAllowed,
      historyComplete: !unsafe,
      invalidIds,
      logicalPath,
      requestedIds: new Set(requestedIds),
      unsafe,
    };
  }

  if (options.fullScan || source.kind !== "jsonl") {
    try {
      for await (const row of readIntegrationIngestJsonlRows(vaultRoot, [source])) {
        visitRaw(row.raw, row.sourcePath);
      }
    } catch {
      unsafe = true;
    }
    return {
      [INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY]: true,
      archivedLogicalPaths,
      entriesById,
      failOpenAppendAllowed: false,
      historyComplete: !unsafe,
      invalidIds,
      logicalPath,
      requestedIds: new Set(requestedIds),
      unsafe,
    };
  }

  const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  let scan: IntegrationIngestNoveltyTailScanResult;
  try {
    scan = await scanIntegrationIngestNoveltyTail(absolutePath, (line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return "unsafe";
      }
      visitRaw(raw, source.sourcePath);
      if (unsafe) {
        return "unsafe";
      }
      return entriesById.size > 0 ? "complete" : "continue";
    });
  } catch {
    scan = { historyComplete: false, selectionComplete: false, unsafe: true };
  }
  return {
    [INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY]: true,
    archivedLogicalPaths,
    entriesById,
    failOpenAppendAllowed: false,
    historyComplete: scan.historyComplete,
    invalidIds,
    logicalPath,
    requestedIds: new Set(requestedIds),
    unsafe: scan.unsafe || unsafe,
  };
}

/**
 * Selects evidence whose provider/account/role/content identity has not already
 * been retained. This is a storage optimization, so damaged historical rows
 * fail open: only a valid, integrity-checked row may prove that incoming
 * evidence is redundant.
 */
export async function selectNovelIntegrationIngestEvidence(
  input: SelectNovelIntegrationIngestEvidenceInput,
): Promise<NovelIntegrationIngestEvidenceSelection> {
  if (!input.accountId) {
    return {
      parts: [...input.parts],
      receiptIsNovel: input.receipt !== undefined,
    };
  }

  const requestedFingerprints = new Set(input.parts.map(integrationEvidenceFingerprint));
  const existingFingerprints = new Set<string>();
  const requestedEventIdsByFingerprint = new Map<string, ReadonlySet<string>>(
    input.parts.map((part) => [
      integrationEvidenceFingerprint(part),
      input.eventIdsByRole?.get(part.role) ?? new Set<string>(),
    ]),
  );
  const existingEventLinks = new Set<string>();
  const existingSampleLinks = new Set<string>();
  const receiptRequiresPayloadIdentity = input.parts.length === 0;
  const requestedReceiptFingerprint = input.receipt
    ? integrationIngestReceiptFingerprint(input.receipt, receiptRequiresPayloadIdentity)
    : null;
  let receiptIsNovel = requestedReceiptFingerprint !== null;
  const failOpenSelection = (): NovelIntegrationIngestEvidenceSelection => ({
    parts: [...input.parts],
    receiptIsNovel: requestedReceiptFingerprint !== null,
  });
  const buildSelection = (): NovelIntegrationIngestEvidenceSelection => ({
    parts: input.parts.filter((part) =>
      !existingFingerprints.has(integrationEvidenceFingerprint(part))
      || [...(input.eventIdsByRole?.get(part.role) ?? [])].some((eventId) =>
        !existingEventLinks.has(`${integrationEvidenceFingerprint(part)}\u0000${eventId}`)
      )
      || [...(input.sampleIds ?? [])].some((sampleId) =>
        !existingSampleLinks.has(`${integrationEvidenceFingerprint(part)}\u0000${sampleId}`)
      )
    ),
    receiptIsNovel,
  });
  const selectionIsComplete = (): boolean =>
    existingFingerprints.size === requestedFingerprints.size
    && [...requestedEventIdsByFingerprint.entries()].every(([fingerprint, eventIds]) =>
      [...eventIds].every((eventId) => existingEventLinks.has(`${fingerprint}\u0000${eventId}`))
    )
    && [...requestedFingerprints].every((fingerprint) =>
      [...(input.sampleIds ?? [])].every((sampleId) =>
        existingSampleLinks.has(`${fingerprint}\u0000${sampleId}`)
      )
    )
    && !receiptIsNovel;

  if (requestedFingerprints.size === 0 && !receiptIsNovel) {
    return { parts: [], receiptIsNovel: false };
  }

  let sources: IntegrationIngestRowSource[];
  try {
    sources = await listIntegrationIngestRowSourcesForLogicalPaths(
      input.vaultRoot,
      [integrationIngestShardPath(input.importedAt)],
    );
  } catch {
    return failOpenSelection();
  }

  const source = sources.length === 1 ? sources[0] : undefined;
  if (!source) {
    return failOpenSelection();
  }
  const visitRaw = (
    raw: unknown,
    sourcePath: string,
    logicalPath: string,
  ): IntegrationIngestNoveltyTailDecision => {
    if (!isRecord(raw) || raw.provider !== input.provider) {
      return "continue";
    }
    const rawAccountId = typeof raw.accountId === "string" ? raw.accountId : undefined;
    if ((rawAccountId ?? null) !== (input.accountId ?? null)) {
      return "continue";
    }
    if (!rawIntegrationIngestCouldProveNovelty({
      raw,
      receiptRequiresPayloadIdentity,
      requestedFingerprints,
      requestedReceiptFingerprint,
    })) {
      return "continue";
    }

    let record: IntegrationIngestRecord;
    try {
      record = parseIntegrationIngestRecord(raw, sourcePath);
      assertIntegrationIngestShard(record.id, record.importedAt, logicalPath);
      assertIntegrationIngestRecordIntegrity(record);
    } catch {
      return "unsafe";
    }
    if (!integrationIngestAccountMatches(record, input.accountId)) {
      return "continue";
    }

    for (const part of record.parts) {
      const fingerprint = integrationEvidenceFingerprint(part);
      if (!requestedFingerprints.has(fingerprint)) {
        continue;
      }
      existingFingerprints.add(fingerprint);
      const requestedEventIds = requestedEventIdsByFingerprint.get(fingerprint);
      if (requestedEventIds && requestedEventIds.size > 0) {
        for (const output of record.outputs.events) {
          if (
            requestedEventIds.has(output.id)
            && output.roles.includes(part.role)
          ) {
            existingEventLinks.add(`${fingerprint}\u0000${output.id}`);
          }
        }
      }
      for (const sampleId of record.outputs.sampleIds) {
        if (input.sampleIds?.has(sampleId)) {
          existingSampleLinks.add(`${fingerprint}\u0000${sampleId}`);
        }
      }
    }
    if (
      requestedReceiptFingerprint
      && record.receipt
      && integrationIngestReceiptFingerprint(
        record.receipt,
        receiptRequiresPayloadIdentity,
      ) === requestedReceiptFingerprint
    ) {
      receiptIsNovel = false;
    }

    return selectionIsComplete() ? "complete" : "continue";
  };

  if (source.kind !== "jsonl") {
    try {
      for await (const row of readIntegrationIngestJsonlRows(input.vaultRoot, [source])) {
        const decision = visitRaw(row.raw, row.sourcePath, row.relativePath);
        if (decision === "unsafe") {
          return failOpenSelection();
        }
      }
    } catch {
      return failOpenSelection();
    }
    return buildSelection();
  }

  // Live shards use a bounded reverse-tail scan. Archived shards above use
  // their already-bounded representation reader because an amendment remains
  // archived and cannot create a future live-tail proof.
  const absolutePath = resolveVaultPath(input.vaultRoot, source.sourcePath).absolutePath;
  if (!(await pathExists(absolutePath))) {
    return failOpenSelection();
  }

  let scan: IntegrationIngestNoveltyTailScanResult;
  try {
    scan = await scanIntegrationIngestNoveltyTail(absolutePath, (line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return "unsafe";
      }
      return visitRaw(raw, source.sourcePath, source.logicalPath);
    });
  } catch {
    return failOpenSelection();
  }

  if (scan.selectionComplete) {
    return { parts: [], receiptIsNovel: false };
  }
  if (scan.unsafe || !scan.historyComplete) {
    return failOpenSelection();
  }

  return buildSelection();
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
    if (!isRecord(raw) || typeof raw.id !== "string") {
      continue;
    }
    if (!ids.has(raw.id)) {
      continue;
    }
    if (typeof raw.importedAt !== "string") {
      throw new VaultError(
        "INTEGRATION_INGEST_INVALID",
        `Integration ingest record in "${sourcePath}" is missing id or importedAt.`,
        { relativePath: sourcePath, lineNumber },
      );
    }
    assertIntegrationIngestShard(raw.id, raw.importedAt, relativePath);
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
  options: BuildIntegrationIngestAppendPlanOptions = {},
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
  const targetExistingEntries = await readIntegrationIngestEntriesByIdFromSources(
    vaultRoot,
    targetSources,
    requestedIds,
  );
  const existingById = new Map(
    targetExistingEntries.map((entry) =>
      [entry.record.id, entry.record] as const,
    ),
  );
  return buildIntegrationIngestAppendPlanFromExisting({
    archivedTargets,
    existingById,
    options,
    records,
    targetShardPaths,
  });
}

export function buildIntegrationIngestAppendPlanFromInspection(
  records: readonly IntegrationIngestRecord[],
  inspection: IntegrationIngestIdInspection,
  options: BuildIntegrationIngestAppendPlanOptions = {},
): IntegrationIngestAppendPlan {
  if (inspection[INTEGRATION_INGEST_ID_INSPECTION_AUTHORITY] !== true) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest inspection authority is invalid.",
    );
  }
  const targetShardPaths = [
    ...new Set(records.map((record) => integrationIngestShardPath(record.importedAt))),
  ].sort();
  if (
    (inspection.unsafe && !inspection.failOpenAppendAllowed)
    || targetShardPaths.length !== 1
    || targetShardPaths[0] !== inspection.logicalPath
    || records.some((record) => !inspection.requestedIds.has(record.id))
    || records.some((record) => inspection.invalidIds.has(record.id))
    || records.some((record) =>
      !inspection.historyComplete
      && !inspection.failOpenAppendAllowed
      && !inspection.entriesById.has(record.id)
    )
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest inspection does not authorize this append plan.",
    );
  }
  const existingById = new Map(
    [...inspection.entriesById].filter(([id]) => inspection.requestedIds.has(id)),
  );
  return buildIntegrationIngestAppendPlanFromExisting({
    archivedTargets: new Set(inspection.archivedLogicalPaths),
    existingById,
    options,
    records,
    targetShardPaths,
  });
}

function buildIntegrationIngestAppendPlanFromExisting(input: {
  archivedTargets: ReadonlySet<string>;
  existingById: ReadonlyMap<string, IntegrationIngestRecord>;
  options: BuildIntegrationIngestAppendPlanOptions;
  records: readonly IntegrationIngestRecord[];
  targetShardPaths: readonly string[];
}): IntegrationIngestAppendPlan {
  const pendingById = new Map<string, IntegrationIngestRecord>();
  const archivedAmendmentShardPaths = new Set<string>();
  const payloads = new Map<string, string>();
  const appendedIds: string[] = [];

  for (const record of input.records) {
    assertIntegrationIngestRecordIntegrity(record);
    const existing = input.existingById.get(record.id) ?? pendingById.get(record.id);
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
    if (input.archivedTargets.has(relativePath)) {
      if (!input.options.allowArchivedShardAmendments) {
        throw new VaultError(
          "INTEGRATION_INGEST_SHARD_ARCHIVED",
          `Integration ingest shard "${relativePath}" is archived and cannot be appended.`,
          { ingestId: record.id, relativePath },
        );
      }
      archivedAmendmentShardPaths.add(relativePath);
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

  return {
    [INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY]: true,
    archivedAmendmentShardPaths: [...archivedAmendmentShardPaths].sort(),
    appendedIds,
    payloads,
    targetShardPaths: [...input.targetShardPaths],
  };
}

export function assertAuthorizedIntegrationIngestAppendPlan(
  plan: unknown,
): asserts plan is IntegrationIngestAppendPlan {
  if (
    typeof plan !== "object"
    || plan === null
    || Reflect.get(plan, INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY) !== true
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest append plans must be created by the integration ingest planner.",
    );
  }
}

export async function parseIntegrationIngestAppendPayload(
  payload: string,
  logicalPath: string,
): Promise<IntegrationIngestRecord[]> {
  const records: IntegrationIngestRecord[] = [];
  const lines = createInterface({
    input: Readable.from([payload]),
    crlfDelay: Infinity,
  });
  const source: IntegrationIngestRowSource = {
    kind: "jsonl",
    logicalPath,
    sourcePath: logicalPath,
  };

  for await (const { raw, sourcePath } of parseIntegrationIngestJsonlLines(lines, source)) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, logicalPath);
    assertIntegrationIngestRecordIntegrity(record);
    records.push(record);
  }
  return records;
}

export async function stageIntegrationIngestAppendPlan(
  batch: {
    stageIntegrationIngestAppendPlan(plan: IntegrationIngestAppendPlan): Promise<void>;
  },
  plan: IntegrationIngestAppendPlan,
): Promise<void> {
  await batch.stageIntegrationIngestAppendPlan(plan);
}

export async function prepareLiveIntegrationIngestAppendPayload(
  vaultRoot: string,
  targetRelativePath: string,
  payload: string,
): Promise<string> {
  const target = resolveVaultPath(vaultRoot, targetRelativePath);
  if (!(await pathExists(target.absolutePath))) {
    return payload;
  }
  const targetStat = await stat(target.absolutePath);
  if (targetStat.size === 0) {
    return payload;
  }

  const handle = await openFile(target.absolutePath, "r");
  const chunks: Buffer[] = [];
  let position = targetStat.size;
  let finalRowByteLength = 0;
  try {
    while (position > 0) {
      const readLength = Math.min(INTEGRATION_INGEST_NOVELTY_SCAN_CHUNK_BYTES, position);
      position -= readLength;
      const chunk = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, position);
      const bytes = chunk.subarray(0, bytesRead);
      const newlineIndex = bytes.lastIndexOf(0x0a);
      const rowChunk = newlineIndex >= 0 ? bytes.subarray(newlineIndex + 1) : bytes;
      chunks.push(rowChunk);
      finalRowByteLength += rowChunk.byteLength;
      if (finalRowByteLength > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
        throw new VaultError(
          "INTEGRATION_INGEST_ROW_TOO_LARGE",
          `Final integration ingest row in "${targetRelativePath}" exceeds the journal row limit.`,
          { relativePath: targetRelativePath, rowPayloadBytes: finalRowByteLength },
        );
      }
      if (newlineIndex >= 0) {
        break;
      }
    }
  } finally {
    await handle.close();
  }

  const finalRow = Buffer.concat(chunks.reverse()).toString("utf8");
  if (finalRow.length === 0) {
    return payload;
  }
  try {
    const record = parseIntegrationIngestRecord(JSON.parse(finalRow), targetRelativePath);
    assertIntegrationIngestShard(record.id, record.importedAt, targetRelativePath);
    assertIntegrationIngestRecordIntegrity(record);
  } catch (error) {
    throw new VaultError(
      "VAULT_INVALID_JSONL",
      `Integration ingest shard "${targetRelativePath}" has an incomplete final row; append was rejected.`,
      {
        relativePath: targetRelativePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return `\n${payload}`;
}

export async function archiveClosedIntegrationIngestShards(
  input: ArchiveClosedIntegrationIngestShardsInput,
): Promise<ArchiveClosedIntegrationIngestShardsResult> {
  return await withCanonicalWriteLock(input.vaultRoot, async () => {
    input.signal?.throwIfAborted();
    const currentMonth = resolveIntegrationIngestArchiveCurrentMonth(input.now);
    const recovery = await recoverInterruptedClosedIntegrationIngestArchivesLocked({
      currentMonth,
      signal: input.signal ?? null,
      vaultRoot: input.vaultRoot,
    });
    const rawPaths = await listClosedRawIntegrationIngestShardPaths(
      input.vaultRoot,
      currentMonth,
    );
    let archivedByteCount = 0;
    let archivedShardCount = 0;
    let blockedShardCount = 0;
    let sourceByteCount = 0;

    for (const logicalPath of rawPaths) {
      input.signal?.throwIfAborted();
      const gzipPath = `${logicalPath}.gz`;
      const zipPath = `${logicalPath}.zip`;
      if (
        await pathExists(resolveVaultPath(input.vaultRoot, gzipPath).absolutePath)
        || await pathExists(resolveVaultPath(input.vaultRoot, zipPath).absolutePath)
      ) {
        blockedShardCount += 1;
        continue;
      }

      try {
        const archived = await archiveClosedIntegrationIngestShardLocked({
          logicalPath,
          signal: input.signal ?? null,
          vaultRoot: input.vaultRoot,
        });
        archivedByteCount += archived.archiveByteCount;
        archivedShardCount += 1;
        sourceByteCount += archived.sourceByteCount;
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!(error instanceof VaultError)) {
          throw error;
        }
        blockedShardCount += 1;
      }
    }

    return {
      archivedByteCount,
      archivedShardCount,
      blockedShardCount,
      repairedShardCount: recovery.repairedShardCount,
      scannedShardCount: rawPaths.length,
      sourceByteCount,
    };
  });
}

export async function recoverInterruptedClosedIntegrationIngestArchives(
  input: RecoverInterruptedClosedIntegrationIngestArchivesInput,
): Promise<RecoverInterruptedClosedIntegrationIngestArchivesResult> {
  return await withCanonicalWriteLock(input.vaultRoot, async () =>
    await recoverInterruptedClosedIntegrationIngestArchivesLocked({
      currentMonth: resolveIntegrationIngestArchiveCurrentMonth(input.now),
      signal: input.signal ?? null,
      vaultRoot: input.vaultRoot,
    })
  );
}

export async function createArchivedIntegrationIngestShardContentReceipt(
  vaultRoot: string,
  logicalPath: string,
): Promise<ArchivedIntegrationIngestShardContentReceipt | null> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  if (!source || source.kind === "jsonl") {
    return null;
  }
  return await validateArchivedIntegrationIngestSource(vaultRoot, source);
}

export async function inspectArchivedIntegrationIngestShardAppend(
  input: InspectArchivedIntegrationIngestShardAppendInput,
): Promise<ArchivedIntegrationIngestShardAppendState | null> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(
    input.vaultRoot,
    [input.targetRelativePath],
  );
  if (!source || source.kind === "jsonl") {
    return null;
  }

  const inspection = await inspectIntegrationIngestSourceBytes(input.vaultRoot, source, {
    expectedTail: input.payload,
    prefixByteLength: input.expectedBaseByteLength,
  });
  if (
    inspection.prefixByteLength !== input.expectedBaseByteLength
    || inspection.prefixSha256 !== input.expectedBaseSha256
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" base content does not match the append receipt.`,
      { relativePath: source.sourcePath },
    );
  }
  if (inspection.byteLength === input.expectedBaseByteLength) {
    return "base";
  }
  if (
    inspection.byteLength
      === input.expectedBaseByteLength + input.payload.byteLength
    && inspection.tailMatches === true
  ) {
    return "applied";
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
    `Integration ingest archive "${source.sourcePath}" changed after the append receipt base.`,
    { relativePath: source.sourcePath },
  );
}

function resolveIntegrationIngestArchiveCurrentMonth(now: Date | undefined): string {
  const resolved = now ?? new Date();
  if (!Number.isFinite(resolved.getTime())) {
    throw new TypeError("Integration ingest archive time must be a valid Date.");
  }
  return resolved.toISOString().slice(0, 7);
}

function integrationIngestMonthKeyFromLogicalPath(logicalPath: string): string | null {
  const prefix = `${VAULT_LAYOUT.integrationIngestLedgerDirectory}/`;
  if (!logicalPath.startsWith(prefix) || !logicalPath.endsWith(".jsonl")) {
    return null;
  }
  const [year, fileName, ...remaining] = logicalPath.slice(prefix.length).split("/");
  if (
    remaining.length > 0
    || !year
    || !/^\d{4}$/.test(year)
    || !fileName
  ) {
    return null;
  }
  const match = /^(\d{4})-(0[1-9]|1[0-2])\.jsonl$/.exec(fileName);
  if (!match || match[1] !== year) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

async function listClosedRawIntegrationIngestShardPaths(
  vaultRoot: string,
  currentMonth: string,
): Promise<string[]> {
  const rawPaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.integrationIngestLedgerDirectory,
    { extension: ".jsonl" },
  );
  return rawPaths
    .filter((logicalPath) => {
      const month = integrationIngestMonthKeyFromLogicalPath(logicalPath);
      return month !== null && month < currentMonth;
    })
    .sort();
}

async function recoverInterruptedClosedIntegrationIngestArchivesLocked(input: {
  currentMonth: string;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<RecoverInterruptedClosedIntegrationIngestArchivesResult> {
  const rawPaths = await listClosedRawIntegrationIngestShardPaths(
    input.vaultRoot,
    input.currentMonth,
  );
  let repairedShardCount = 0;
  let scannedConflictCount = 0;

  for (const logicalPath of rawPaths) {
    input.signal?.throwIfAborted();
    const gzipPath = `${logicalPath}.gz`;
    const zipPath = `${logicalPath}.zip`;
    const gzipAbsolutePath = resolveVaultPath(input.vaultRoot, gzipPath).absolutePath;
    if (!(await pathExists(gzipAbsolutePath))) {
      continue;
    }
    scannedConflictCount += 1;
    if (await pathExists(resolveVaultPath(input.vaultRoot, zipPath).absolutePath)) {
      continue;
    }

    try {
      const rawAbsolutePath = resolveVaultPath(input.vaultRoot, logicalPath).absolutePath;
      const rawStatBefore = await lstat(rawAbsolutePath);
      assertRegularIntegrationIngestArchiveFile(rawStatBefore, logicalPath);
      const [rawReceipt, gzipReceipt] = await Promise.all([
        validateRawIntegrationIngestSource({
          absolutePath: rawAbsolutePath,
          logicalPath,
          signal: input.signal,
        }),
        validateGzippedIntegrationIngestSource({
          absolutePath: gzipAbsolutePath,
          logicalPath,
          signal: input.signal,
          sourcePath: gzipPath,
        }),
      ]);
      if (
        rawReceipt.byteLength !== gzipReceipt.byteLength
        || rawReceipt.sha256 !== gzipReceipt.sha256
        || !rawReceipt.endsWithNewline
        || !gzipReceipt.endsWithNewline
      ) {
        continue;
      }
      const rawStatAfter = await lstat(rawAbsolutePath);
      assertIntegrationIngestArchiveSourceUnchanged(
        rawStatBefore,
        rawStatAfter,
        logicalPath,
      );
      await unlink(rawAbsolutePath);
      repairedShardCount += 1;
    } catch (error) {
      input.signal?.throwIfAborted();
      if (!(error instanceof VaultError)) {
        throw error;
      }
    }
  }

  return {
    blockedConflictCount: scannedConflictCount - repairedShardCount,
    repairedShardCount,
    scannedConflictCount,
  };
}

async function archiveClosedIntegrationIngestShardLocked(input: {
  logicalPath: string;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<{ archiveByteCount: number; sourceByteCount: number }> {
  const rawAbsolutePath = resolveVaultPath(input.vaultRoot, input.logicalPath).absolutePath;
  const gzipPath = `${input.logicalPath}.gz`;
  const gzipAbsolutePath = resolveVaultPath(input.vaultRoot, gzipPath).absolutePath;
  const rawStatBefore = await lstat(rawAbsolutePath);
  assertRegularIntegrationIngestArchiveFile(rawStatBefore, input.logicalPath);

  const sourceReceiptHolder: {
    value?: ArchivedIntegrationIngestShardContentReceipt;
  } = {};
  await prepareFileAtomicExclusive(gzipAbsolutePath, async (tempAbsolutePath) => {
    input.signal?.throwIfAborted();
    const sourceHash = createHash("sha256");
    let sourceByteCount = 0;
    const meter = new Transform({
      transform(chunk: Buffer | string, encoding, callback) {
        try {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
          sourceByteCount += bytes.byteLength;
          if (sourceByteCount > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
            callback(new VaultError(
              "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
              `Integration ingest shard "${input.logicalPath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte archive limit.`,
              { byteSize: sourceByteCount, relativePath: input.logicalPath },
            ));
            return;
          }
          sourceHash.update(bytes);
          callback(null, bytes);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    const sourceStream = createReadStream(
      rawAbsolutePath,
      input.signal ? { signal: input.signal } : undefined,
    );
    const targetStream = createWriteStream(tempAbsolutePath, {
      flags: "wx",
      mode: rawStatBefore.mode & 0o7777,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (input.signal) {
      await pipeline(
        sourceStream,
        meter,
        createGzip({ level: INTEGRATION_INGEST_ARCHIVE_GZIP_LEVEL }),
        targetStream,
        { signal: input.signal },
      );
    } else {
      await pipeline(
        sourceStream,
        meter,
        createGzip({ level: INTEGRATION_INGEST_ARCHIVE_GZIP_LEVEL }),
        targetStream,
      );
    }
    const sourceReceipt: ArchivedIntegrationIngestShardContentReceipt = {
      byteLength: sourceByteCount,
      sha256: sourceHash.digest("hex"),
    };
    sourceReceiptHolder.value = sourceReceipt;
    const validated = await validateGzippedIntegrationIngestSource({
      absolutePath: tempAbsolutePath,
      logicalPath: input.logicalPath,
      signal: input.signal,
      sourcePath: gzipPath,
    });
    if (
      validated.byteLength !== sourceReceipt.byteLength
      || validated.sha256 !== sourceReceipt.sha256
      || (!validated.endsWithNewline && validated.byteLength > 0)
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${gzipPath}" did not preserve the source shard exactly.`,
        { relativePath: gzipPath },
      );
    }
    const rawStatAfter = await lstat(rawAbsolutePath);
    assertIntegrationIngestArchiveSourceUnchanged(
      rawStatBefore,
      rawStatAfter,
      input.logicalPath,
    );
  });

  const sourceReceipt = sourceReceiptHolder.value;
  if (!sourceReceipt) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${gzipPath}" did not produce a source receipt.`,
      { relativePath: gzipPath },
    );
  }

  try {
    await unlink(rawAbsolutePath);
  } catch (error) {
    await unlink(gzipAbsolutePath).catch(() => undefined);
    throw error;
  }
  const archiveStat = await lstat(gzipAbsolutePath);
  assertRegularIntegrationIngestArchiveFile(archiveStat, gzipPath);
  return {
    archiveByteCount: archiveStat.size,
    sourceByteCount: sourceReceipt.byteLength,
  };
}

function assertIntegrationIngestArchiveSourceUnchanged(
  before: Awaited<ReturnType<typeof stat>>,
  after: Awaited<ReturnType<typeof stat>>,
  relativePath: string,
): void {
  if (
    before.dev === after.dev
    && before.ino === after.ino
    && before.mode === after.mode
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs
  ) {
    return;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_SOURCE_CHANGED",
    `Integration ingest shard "${relativePath}" changed while it was being archived.`,
    { relativePath },
  );
}

function assertRegularIntegrationIngestArchiveFile(
  fileStat: Awaited<ReturnType<typeof lstat>>,
  relativePath: string,
): void {
  if (fileStat.isFile()) {
    return;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_INVALID",
    `Integration ingest shard "${relativePath}" is not a regular file.`,
    { relativePath },
  );
}

async function validateRawIntegrationIngestSource(input: {
  absolutePath: string;
  logicalPath: string;
  signal: AbortSignal | null;
}): Promise<ValidatedIntegrationIngestSourceReceipt> {
  const hash = createHash("sha256");
  let byteLength = 0;
  let finalByte: number | null = null;
  const meter = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      try {
        input.signal?.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        byteLength += bytes.byteLength;
        if (byteLength > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
          callback(new VaultError(
            "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
            `Integration ingest shard "${input.logicalPath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte archive limit.`,
            { byteSize: byteLength, relativePath: input.logicalPath },
          ));
          return;
        }
        hash.update(bytes);
        if (bytes.byteLength > 0) {
          finalByte = bytes[bytes.byteLength - 1] ?? null;
        }
        callback(null, bytes);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  const sourceStream = createReadStream(
    input.absolutePath,
    input.signal ? { signal: input.signal } : undefined,
  );
  sourceStream.once("error", (error) => meter.destroy(error));
  meter.once("close", () => sourceStream.destroy());
  const lines = createInterface({
    input: sourceStream.pipe(meter),
    crlfDelay: Infinity,
  });
  const rowCount = await validateIntegrationIngestRows(lines, {
    kind: "jsonl",
    logicalPath: input.logicalPath,
    sourcePath: input.logicalPath,
  }, input.signal);
  return {
    byteLength,
    endsWithNewline: byteLength === 0 || finalByte === 0x0a,
    rowCount,
    sha256: hash.digest("hex"),
  };
}

async function validateGzippedIntegrationIngestSource(input: {
  absolutePath: string;
  logicalPath: string;
  signal: AbortSignal | null;
  sourcePath: string;
}): Promise<ValidatedIntegrationIngestSourceReceipt> {
  const hash = createHash("sha256");
  let byteLength = 0;
  let finalByte: number | null = null;
  const lineStream = await openGzippedIntegrationIngestLineStream(
    input.absolutePath,
    input.sourcePath,
    input.signal,
    (bytes) => {
      byteLength += bytes.byteLength;
      hash.update(bytes);
      if (bytes.byteLength > 0) {
        finalByte = bytes[bytes.byteLength - 1] ?? null;
      }
    },
  );
  const lines = createInterface({
    input: lineStream,
    crlfDelay: Infinity,
  });
  const rowCount = await validateIntegrationIngestRows(lines, {
    kind: "gzip",
    logicalPath: input.logicalPath,
    sourcePath: input.sourcePath,
  }, input.signal);
  return {
    byteLength,
    endsWithNewline: byteLength === 0 || finalByte === 0x0a,
    rowCount,
    sha256: hash.digest("hex"),
  };
}

async function validateIntegrationIngestRows(
  lines: AsyncIterable<string>,
  source: IntegrationIngestRowSource,
  signal: AbortSignal | null,
): Promise<number> {
  const seen = new Map<string, string>();
  let rowCount = 0;
  for await (const { raw, sourcePath } of parseIntegrationIngestJsonlLines(lines, source)) {
    signal?.throwIfAborted();
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, source.logicalPath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, source.logicalPath);
    rowCount += 1;
  }
  return rowCount;
}

async function inspectIntegrationIngestSourceBytes(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
  options: {
    expectedTail?: Uint8Array;
    prefixByteLength?: number;
  } = {},
): Promise<IntegrationIngestSourceByteInspection> {
  const hash = createHash("sha256");
  const prefixHash = options.prefixByteLength === undefined ? null : createHash("sha256");
  const expectedTail = options.expectedTail ? Buffer.from(options.expectedTail) : null;
  let byteLength = 0;
  let finalByte: number | null = null;
  let prefixByteLength = 0;
  let tailIndex = 0;
  let tailMatches = true;

  for await (const bytes of openIntegrationIngestSourceByteChunks(vaultRoot, source)) {
    hash.update(bytes);
    if (bytes.byteLength > 0) {
      finalByte = bytes[bytes.byteLength - 1] ?? null;
    }
    if (prefixHash && options.prefixByteLength !== undefined) {
      const prefixRemaining = Math.max(0, options.prefixByteLength - prefixByteLength);
      const prefixChunkLength = Math.min(prefixRemaining, bytes.byteLength);
      if (prefixChunkLength > 0) {
        prefixHash.update(bytes.subarray(0, prefixChunkLength));
        prefixByteLength += prefixChunkLength;
      }
      if (expectedTail && prefixChunkLength < bytes.byteLength) {
        const tailChunk = bytes.subarray(prefixChunkLength);
        for (const byte of tailChunk) {
          if (tailIndex >= expectedTail.byteLength || byte !== expectedTail[tailIndex]) {
            tailMatches = false;
          }
          tailIndex += 1;
        }
      }
    }
    byteLength += bytes.byteLength;
  }

  return {
    byteLength,
    endsWithNewline: byteLength === 0 || finalByte === 0x0a,
    sha256: hash.digest("hex"),
    ...(prefixHash
      ? {
          prefixByteLength,
          prefixSha256: prefixHash.digest("hex"),
          ...(expectedTail
            ? {
                tailMatches:
                  tailMatches
                  && tailIndex === expectedTail.byteLength,
              }
            : {}),
        }
      : {}),
  };
}

async function* openIntegrationIngestSourceByteChunks(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): AsyncGenerator<Buffer> {
  const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "jsonl") {
    for await (const chunk of createReadStream(absolutePath)) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
    return;
  }
  if (source.kind === "gzip") {
    yield* readBoundedGzippedIntegrationIngestChunks(absolutePath, source.sourcePath);
    return;
  }
  yield Buffer.from(await readZippedIntegrationIngestJsonlText(vaultRoot, source), "utf8");
}

export async function readArchivedIntegrationIngestShardText(
  vaultRoot: string,
  logicalPath: string,
): Promise<ArchivedIntegrationIngestShardText | null> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  if (!source || source.kind === "jsonl") {
    return null;
  }

  return {
    content: await readIntegrationIngestSourceText(vaultRoot, source),
  };
}

export async function appendArchivedIntegrationIngestShard({
  expectedBaseByteLength,
  expectedBaseSha256,
  payload,
  targetRelativePath,
  vaultRoot,
}: AppendArchivedIntegrationIngestShardInput): Promise<AppendArchivedIntegrationIngestShardResult> {
  const source = await readArchivedIntegrationIngestShardSource(vaultRoot, targetRelativePath);
  const payloadBytes = Buffer.from(payload, "utf8");
  const records = await parseIntegrationIngestAppendPayload(payload, targetRelativePath);

  if (typeof expectedBaseByteLength !== "number" || typeof expectedBaseSha256 !== "string") {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" append receipt base is required.`,
      { relativePath: source.sourcePath },
    );
  }

  const appendState = await inspectArchivedIntegrationIngestShardAppend({
    expectedBaseByteLength,
    expectedBaseSha256,
    payload: payloadBytes,
    targetRelativePath,
    vaultRoot,
  });
  if (appendState === "applied") {
    return {
      originalSize: expectedBaseByteLength,
    };
  }
  const validatedBase = await validateArchivedIntegrationIngestSource(vaultRoot, source);
  if (!validatedBase.endsWithNewline && validatedBase.byteLength > 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" is not newline-terminated.`,
      { relativePath: source.sourcePath },
    );
  }

  const appendPlan = await buildIntegrationIngestAppendPlan(vaultRoot, records, {
    allowArchivedShardAmendments: true,
  });
  const appendPayload = appendPlan.payloads.get(targetRelativePath);
  const originalSize = expectedBaseByteLength;
  if (!appendPayload) {
    return {
      originalSize,
    };
  }

  if (source.kind === "gzip") {
    await rewriteGzippedIntegrationIngestArchive({
      appendPayload: Buffer.from(appendPayload, "utf8"),
      source,
      vaultRoot,
    });
  } else {
    const baseContent = await readIntegrationIngestSourceText(vaultRoot, source);
    await writeIntegrationIngestArchiveText(vaultRoot, source, `${baseContent}${appendPayload}`);
  }
  return {
    originalSize,
  };
}

export async function truncateArchivedIntegrationIngestShard({
  expectedBaseByteLength,
  expectedBaseSha256,
  targetRelativePath,
  vaultRoot,
}: TruncateArchivedIntegrationIngestShardInput): Promise<void> {
  const source = await readArchivedIntegrationIngestShardSource(vaultRoot, targetRelativePath);
  const inspection = await inspectIntegrationIngestSourceBytes(vaultRoot, source, {
    prefixByteLength: expectedBaseByteLength,
  });
  if (
    inspection.byteLength < expectedBaseByteLength
    || inspection.prefixByteLength !== expectedBaseByteLength
    || inspection.prefixSha256 !== expectedBaseSha256
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" base content does not match the rollback receipt.`,
      { relativePath: source.sourcePath },
    );
  }
  if (inspection.byteLength === expectedBaseByteLength) {
    return;
  }
  if (source.kind === "gzip") {
    await rewriteGzippedIntegrationIngestArchive({
      source,
      truncateByteLength: expectedBaseByteLength,
      vaultRoot,
    });
  } else {
    const content = await readIntegrationIngestSourceText(vaultRoot, source);
    await writeIntegrationIngestArchiveText(
      vaultRoot,
      source,
      Buffer.from(content, "utf8").subarray(0, expectedBaseByteLength).toString("utf8"),
    );
  }
}

async function validateArchivedIntegrationIngestSource(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<ValidatedIntegrationIngestSourceReceipt> {
  const hash = createHash("sha256");
  let byteLength = 0;
  let finalByte: number | null = null;
  const measuredChunks = async function* (): AsyncGenerator<Buffer> {
    for await (const bytes of openIntegrationIngestSourceByteChunks(vaultRoot, source)) {
      byteLength += bytes.byteLength;
      hash.update(bytes);
      if (bytes.byteLength > 0) {
        finalByte = bytes[bytes.byteLength - 1] ?? null;
      }
      yield bytes;
    }
  };
  const lines = createInterface({
    input: Readable.from(measuredChunks()),
    crlfDelay: Infinity,
  });
  const rowCount = await validateIntegrationIngestRows(lines, source, null);
  return {
    byteLength,
    endsWithNewline: byteLength === 0 || finalByte === 0x0a,
    rowCount,
    sha256: hash.digest("hex"),
  };
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
  options: {
    signal?: AbortSignal | null;
  } = {},
): AsyncGenerator<RawIntegrationIngestJsonlRow> {
  for (const source of sortIntegrationIngestRowSources(sources)) {
    options.signal?.throwIfAborted();
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    const lines = createInterface({
      input: await openIntegrationIngestLineStream(vaultRoot, source, options.signal ?? null),
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
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
      throw new VaultError(
        "INTEGRATION_INGEST_ROW_TOO_LARGE",
        `Integration ingest row in "${source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte journal limit.`,
        { lineNumber, relativePath: source.sourcePath, rowPayloadBytes: lineBytes },
      );
    }
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
  signal: AbortSignal | null = null,
): Promise<NodeJS.ReadableStream> {
  if (source.kind === "jsonl") {
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    return createReadStream(absolutePath, {
      encoding: "utf8",
      ...(signal ? { signal } : {}),
    });
  }
  if (source.kind === "gzip") {
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    return await openGzippedIntegrationIngestLineStream(
      absolutePath,
      source.sourcePath,
      signal,
    );
  }
  return Readable.from([await readIntegrationIngestSourceText(vaultRoot, source)]);
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

async function readArchivedIntegrationIngestShardSource(
  vaultRoot: string,
  logicalPath: string,
): Promise<IntegrationIngestRowSource> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  if (!source || source.kind === "jsonl") {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_ARCHIVED",
      `Integration ingest shard "${logicalPath}" is not archived.`,
      { relativePath: logicalPath },
    );
  }
  return source;
}

async function readIntegrationIngestSourceText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<string> {
  const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "jsonl") {
    return readFile(absolutePath, "utf8");
  }
  if (source.kind === "gzip") {
    return readGzippedIntegrationIngestJsonlText(absolutePath, source.sourcePath);
  }
  return readZippedIntegrationIngestJsonlText(vaultRoot, source);
}

async function writeIntegrationIngestArchiveText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
  content: string,
): Promise<void> {
  if (source.kind === "jsonl") {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_ARCHIVED",
      `Integration ingest shard "${source.logicalPath}" is not archived.`,
      { relativePath: source.logicalPath },
    );
  }

  const archivePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "gzip") {
    const archive = gzipSync(content);
    assertIntegrationIngestArchiveReplacementSize(content, archive, source.sourcePath);
    await writeFileAtomic(archivePath, archive);
    return;
  }
  const archive = createSingleEntryIntegrationIngestZipArchive(
    source.logicalPath.split("/").at(-1) ?? "",
    content,
  );
  assertIntegrationIngestArchiveReplacementSize(content, archive, source.sourcePath);
  await writeFileAtomic(
    archivePath,
    archive,
  );
}

async function rewriteGzippedIntegrationIngestArchive(input: {
  appendPayload?: Buffer;
  source: IntegrationIngestRowSource;
  truncateByteLength?: number;
  vaultRoot: string;
}): Promise<void> {
  if (input.source.kind !== "gzip") {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      `Integration ingest archive "${input.source.sourcePath}" is not gzip.`,
      { relativePath: input.source.sourcePath },
    );
  }
  if (input.appendPayload && input.truncateByteLength !== undefined) {
    throw new TypeError("Gzip integration ingest rewrite cannot append and truncate together.");
  }

  const archivePath = resolveVaultPath(input.vaultRoot, input.source.sourcePath).absolutePath;
  await prepareFileAtomic(archivePath, async (tempAbsolutePath) => {
    const outputHash = createHash("sha256");
    let outputByteLength = 0;
    const outputChunks = async function* (): AsyncGenerator<Buffer> {
      let remaining = input.truncateByteLength ?? Number.POSITIVE_INFINITY;
      for await (const chunk of readBoundedGzippedIntegrationIngestChunks(
        archivePath,
        input.source.sourcePath,
      )) {
        if (remaining <= 0) {
          break;
        }
        const output = Number.isFinite(remaining)
          ? chunk.subarray(0, Math.min(chunk.byteLength, remaining))
          : chunk;
        if (output.byteLength > 0) {
          outputHash.update(output);
          outputByteLength += output.byteLength;
          remaining -= output.byteLength;
          yield output;
        }
      }
      if (Number.isFinite(remaining) && remaining !== 0) {
        throw new VaultError(
          "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
          `Integration ingest archive "${input.source.sourcePath}" is smaller than the rollback base.`,
          { relativePath: input.source.sourcePath },
        );
      }
      if (input.appendPayload && input.appendPayload.byteLength > 0) {
        outputHash.update(input.appendPayload);
        outputByteLength += input.appendPayload.byteLength;
        if (outputByteLength > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
          throw new VaultError(
            "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
            `Integration ingest archive "${input.source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
            { byteSize: outputByteLength, relativePath: input.source.sourcePath },
          );
        }
        yield input.appendPayload;
      }
    };

    await pipeline(
      Readable.from(outputChunks()),
      createGzip({ level: INTEGRATION_INGEST_ARCHIVE_GZIP_LEVEL }),
      createWriteStream(tempAbsolutePath, { flags: "wx", mode: 0o600 }),
    );
    const expectedReceipt = {
      byteLength: outputByteLength,
      sha256: outputHash.digest("hex"),
    };
    const validated = await validateGzippedIntegrationIngestSource({
      absolutePath: tempAbsolutePath,
      logicalPath: input.source.logicalPath,
      signal: null,
      sourcePath: input.source.sourcePath,
    });
    if (
      validated.byteLength !== expectedReceipt.byteLength
      || validated.sha256 !== expectedReceipt.sha256
      || (!validated.endsWithNewline && validated.byteLength > 0)
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${input.source.sourcePath}" failed rewrite verification.`,
        { relativePath: input.source.sourcePath },
      );
    }
  });
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

async function readGzippedIntegrationIngestJsonlText(
  absolutePath: string,
  relativePath: string,
): Promise<string> {
  return readBoundedIntegrationIngestArchiveText(
    readBoundedGzippedIntegrationIngestChunks(absolutePath, relativePath),
    relativePath,
    "gzip",
  );
}

async function openGzippedIntegrationIngestLineStream(
  absolutePath: string,
  relativePath: string,
  signal: AbortSignal | null = null,
  inspectChunk?: (chunk: Buffer) => void,
): Promise<NodeJS.ReadableStream> {
  await assertIntegrationIngestArchiveCompressedSize(absolutePath, relativePath);
  return Readable.from(
    readBoundedIntegrationIngestArchiveChunks(
      createGzippedIntegrationIngestReadStream(absolutePath, signal),
      relativePath,
      "gzip",
      signal,
      inspectChunk,
    ),
  );
}

async function* readBoundedGzippedIntegrationIngestChunks(
  absolutePath: string,
  relativePath: string,
  signal: AbortSignal | null = null,
): AsyncGenerator<Buffer> {
  await assertIntegrationIngestArchiveCompressedSize(absolutePath, relativePath);
  yield* readBoundedIntegrationIngestArchiveChunks(
    createGzippedIntegrationIngestReadStream(absolutePath, signal),
    relativePath,
    "gzip",
    signal,
  );
}

function createGzippedIntegrationIngestReadStream(
  absolutePath: string,
  signal: AbortSignal | null,
): NodeJS.ReadableStream {
  const compressed = createReadStream(
    absolutePath,
    signal ? { signal } : undefined,
  );
  const gunzip = createGunzip();
  compressed.once("error", (error) => gunzip.destroy(error));
  gunzip.once("close", () => compressed.destroy());
  return compressed.pipe(gunzip);
}

async function assertIntegrationIngestArchiveCompressedSize(
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  const archiveStat = await lstat(absolutePath);
  if (!archiveStat.isFile()) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" is not a regular file.`,
      { relativePath },
    );
  }
  if (archiveStat.size > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archiveStat.size, relativePath },
    );
  }
}

async function* readBoundedIntegrationIngestArchiveChunks(
  chunks: AsyncIterable<Buffer | string>,
  relativePath: string,
  archiveKind: "gzip" | "zip",
  signal: AbortSignal | null = null,
  inspectChunk?: (chunk: Buffer) => void,
): AsyncGenerator<Buffer> {
  let byteSize = 0;

  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      byteSize += buffer.byteLength;
      if (byteSize > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
        throw new VaultError(
          "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
          `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
          { byteSize, relativePath },
        );
      }
      inspectChunk?.(buffer);
      yield buffer;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof VaultError) {
      throw error;
    }
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" contains invalid ${archiveKind} data.`,
      { relativePath },
    );
  }
}

async function readBoundedIntegrationIngestArchiveText(
  chunks: AsyncIterable<Buffer | string>,
  relativePath: string,
  archiveKind: "gzip" | "zip",
): Promise<string> {
  const buffers: Buffer[] = [];
  let byteSize = 0;

  for await (const buffer of readBoundedIntegrationIngestArchiveChunks(
    chunks,
    relativePath,
    archiveKind,
  )) {
    byteSize += buffer.byteLength;
    buffers.push(buffer);
  }

  return Buffer.concat(buffers, byteSize).toString("utf8");
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
  if (localHeaderOffset !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden bytes before its JSONL entry.`,
      { relativePath: source.sourcePath },
    );
  }
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
  if (extraLength !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden local header metadata.`,
      { relativePath: source.sourcePath },
    );
  }
  const localNameStart = localHeaderOffset + 30;
  const localNameEnd = localNameStart + fileNameLength;
  assertZipReadableRange(archive, localNameStart, fileNameLength, source.sourcePath);
  const localName = archive.subarray(localNameStart, localNameEnd).toString("utf8").replaceAll("\\", "/");
  if (localName !== entry.name) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" local file header does not match its central directory.`,
      { relativePath: source.sourcePath },
    );
  }
  const contentOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  assertZipReadableRange(archive, contentOffset, entry.compressedSize, source.sourcePath);
  if (contentOffset + entry.compressedSize !== entry.centralDirectoryOffset) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden bytes before its central directory.`,
      { relativePath: source.sourcePath },
    );
  }
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  const content = unzipIntegrationIngestEntry(compressed, entry, source.sourcePath);
  if (content.byteLength !== entry.uncompressedSize) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has an invalid uncompressed size.`,
      { relativePath: source.sourcePath },
    );
  }
  if ((crc32(content) >>> 0) !== entry.crc32) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" failed CRC-32 verification.`,
      { relativePath: source.sourcePath },
    );
  }
  return content.toString("utf8");
}

function selectZippedIntegrationIngestJsonlEntry(
  archive: Buffer,
  source: IntegrationIngestRowSource,
): ZipCentralDirectoryEntry {
  const entries = readZipCentralDirectory(archive, source.sourcePath);
  const expectedName = source.logicalPath.split("/").at(-1) ?? "";
  if (entries.length === 1 && entries[0]?.name === expectedName) {
    return entries[0] as ZipCentralDirectoryEntry;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_INVALID",
    `Integration ingest archive "${source.sourcePath}" must contain exactly one entry named "${expectedName}".`,
    { relativePath: source.sourcePath, entryCount: entries.length },
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
  if (commentLength !== 0 || eocdOffset + 22 !== archive.byteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid ZIP comment length.`,
      { relativePath },
    );
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd !== eocdOffset) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has hidden central directory padding.`,
      { relativePath },
    );
  }
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
    const entryCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    if (extraLength !== 0 || commentLength !== 0) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" has hidden central directory metadata.`,
        { relativePath },
      );
    }
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
      centralDirectoryOffset,
      compressedSize,
      compressionMethod,
      crc32: entryCrc32,
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

function assertIntegrationIngestArchiveReplacementSize(
  content: string,
  archive: Buffer,
  relativePath: string,
): void {
  const entryBytes = Buffer.byteLength(content, "utf8");
  if (entryBytes > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
      { byteSize: entryBytes, relativePath },
    );
  }
  if (archive.byteLength > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archive.byteLength, relativePath },
    );
  }
}

function createSingleEntryIntegrationIngestZipArchive(
  fileName: string,
  content: string,
): Buffer {
  const fileNameBytes = Buffer.from(fileName, "utf8");
  if (fileNameBytes.byteLength === 0 || fileNameBytes.byteLength > 0xffff) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      "Integration ingest ZIP archive entry name is unsupported.",
    );
  }

  const contentBytes = Buffer.from(content, "utf8");
  const compressed = deflateRawSync(contentBytes);
  const contentCrc32 = crc32(contentBytes) >>> 0;
  const localHeader = Buffer.alloc(30 + fileNameBytes.byteLength);
  localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(contentCrc32, 14);
  localHeader.writeUInt32LE(compressed.byteLength, 18);
  localHeader.writeUInt32LE(contentBytes.byteLength, 22);
  localHeader.writeUInt16LE(fileNameBytes.byteLength, 26);
  fileNameBytes.copy(localHeader, 30);

  const centralDirectoryOffset = localHeader.byteLength + compressed.byteLength;
  const centralDirectory = Buffer.alloc(46 + fileNameBytes.byteLength);
  centralDirectory.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(8, 10);
  centralDirectory.writeUInt32LE(contentCrc32, 16);
  centralDirectory.writeUInt32LE(compressed.byteLength, 20);
  centralDirectory.writeUInt32LE(contentBytes.byteLength, 24);
  centralDirectory.writeUInt16LE(fileNameBytes.byteLength, 28);
  centralDirectory.writeUInt32LE(0, 42);
  fileNameBytes.copy(centralDirectory, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([localHeader, compressed, centralDirectory, eocd]);
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
