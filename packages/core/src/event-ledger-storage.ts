import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

import { writeFileAtomic, writeBytesFileAtomicExclusive } from "./atomic-write.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles, walkVaultFilesInterruptible } from "./fs.ts";
import { withCanonicalWriteLock } from "./operations/canonical-write-lock.ts";
import {
  assertPathWithinVaultOnDisk,
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";

import type { UnknownRecord } from "./types.ts";

export const MAX_EVENT_LEDGER_SHARD_BYTES = 256 * 1024 * 1024;
export const MAX_EVENT_LEDGER_ARCHIVE_BYTES = 128 * 1024 * 1024;

export interface EventLedgerShardSource {
  kind: "jsonl" | "gzip";
  logicalPath: string;
  sourcePath: string;
}

export interface EventLedgerShardContentReceipt {
  byteLength: number;
  sha256: string;
}

export interface ArchiveClosedEventLedgerShardsResult {
  archivedByteCount: number;
  archivedShardCount: number;
  repairedShardCount: number;
  scannedShardCount: number;
  sourceByteCount: number;
}

function isEventLedgerSourcePath(relativePath: string): boolean {
  return isEventLedgerLogicalPath(relativePath)
    || (
      relativePath.endsWith(".jsonl.gz")
      && isEventLedgerLogicalPath(relativePath.slice(0, -".gz".length))
    );
}

export function isEventLedgerLogicalPath(relativePath: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeRelativeVaultPath(relativePath);
  } catch {
    return false;
  }
  return normalized.startsWith(`${VAULT_LAYOUT.eventLedgerDirectory}/`)
    && normalized.endsWith(".jsonl");
}

function requireEventLedgerLogicalPath(relativePath: string): string {
  const normalized = normalizeRelativeVaultPath(relativePath);
  if (!isEventLedgerLogicalPath(normalized)) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_PATH_INVALID",
      "Event ledger shard path must be a canonical .jsonl path.",
      { relativePath: normalized },
    );
  }
  return normalized;
}

function toEventLedgerShardSource(relativePath: string): EventLedgerShardSource {
  const normalized = normalizeRelativeVaultPath(relativePath);
  if (normalized.endsWith(".jsonl.gz")) {
    return {
      kind: "gzip",
      logicalPath: normalized.slice(0, -".gz".length),
      sourcePath: normalized,
    };
  }
  return {
    kind: "jsonl",
    logicalPath: normalized,
    sourcePath: normalized,
  };
}

function assertUnambiguousEventLedgerSources(
  sources: readonly EventLedgerShardSource[],
): void {
  const seen = new Map<string, EventLedgerShardSource>();
  for (const source of sources) {
    const prior = seen.get(source.logicalPath);
    if (prior) {
      throw new VaultError(
        "EVENT_LEDGER_SHARD_AMBIGUOUS",
        `Event ledger shard "${source.logicalPath}" has both plain and gzip representations.`,
        { relativePath: source.logicalPath },
      );
    }
    seen.set(source.logicalPath, source);
  }
}

export async function listEventLedgerShardSources(
  vaultRoot: string,
): Promise<EventLedgerShardSource[]> {
  const paths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory);
  const sources = paths
    .filter(isEventLedgerSourcePath)
    .map(toEventLedgerShardSource)
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  assertUnambiguousEventLedgerSources(sources);
  return sources;
}

export async function listEventLedgerShardPaths(vaultRoot: string): Promise<string[]> {
  return (await listEventLedgerShardSources(vaultRoot)).map((source) => source.logicalPath);
}

export async function listEventLedgerShardPathsInterruptible(input: {
  signal?: AbortSignal | null;
  shouldContinue?: () => boolean;
  vaultRoot: string;
}): Promise<{ interrupted: boolean; relativePaths: string[] }> {
  const walked = await walkVaultFilesInterruptible(
    input.vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    {
      shouldContinue: input.shouldContinue,
      signal: input.signal,
    },
  );
  const sources = walked.relativePaths
    .filter(isEventLedgerSourcePath)
    .map(toEventLedgerShardSource)
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  assertUnambiguousEventLedgerSources(sources);
  return {
    interrupted: walked.interrupted,
    relativePaths: sources.map((source) => source.logicalPath),
  };
}

export async function resolveEventLedgerShardSource(
  vaultRoot: string,
  relativePath: string,
): Promise<EventLedgerShardSource | null> {
  const logicalPath = requireEventLedgerLogicalPath(relativePath);
  const plainPath = resolveVaultPath(vaultRoot, logicalPath).absolutePath;
  const gzipPath = resolveVaultPath(vaultRoot, `${logicalPath}.gz`).absolutePath;
  const [plainExists, gzipExists] = await Promise.all([
    pathExists(plainPath),
    pathExists(gzipPath),
  ]);
  if (plainExists && gzipExists) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_AMBIGUOUS",
      `Event ledger shard "${logicalPath}" has both plain and gzip representations.`,
      { relativePath: logicalPath },
    );
  }
  if (gzipExists) {
    return { kind: "gzip", logicalPath, sourcePath: `${logicalPath}.gz` };
  }
  return plainExists ? { kind: "jsonl", logicalPath, sourcePath: logicalPath } : null;
}

async function readBoundedEventLedgerSourceBytes(
  vaultRoot: string,
  source: EventLedgerShardSource,
): Promise<Buffer> {
  const resolved = resolveVaultPath(vaultRoot, source.sourcePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_INVALID",
      "Event ledger shard source must be a file.",
      { relativePath: source.sourcePath },
    );
  }
  const maxStoredBytes = source.kind === "gzip"
    ? MAX_EVENT_LEDGER_ARCHIVE_BYTES
    : MAX_EVENT_LEDGER_SHARD_BYTES;
  if (stats.size > maxStoredBytes) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${source.sourcePath}" exceeds its storage limit.`,
      { byteSize: stats.size, relativePath: source.sourcePath },
    );
  }
  const storedBytes = await fs.readFile(resolved.absolutePath);
  if (storedBytes.byteLength > maxStoredBytes) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${source.sourcePath}" exceeds its storage limit.`,
      { byteSize: storedBytes.byteLength, relativePath: source.sourcePath },
    );
  }
  if (source.kind === "jsonl") {
    return storedBytes;
  }
  try {
    return gunzipSync(storedBytes, { maxOutputLength: MAX_EVENT_LEDGER_SHARD_BYTES });
  } catch (error) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      `Event ledger archive "${source.sourcePath}" could not be decoded.`,
      {
        cause: error instanceof Error ? error.message : String(error),
        relativePath: source.sourcePath,
      },
    );
  }
}

function parseEventLedgerRows(
  bytes: Uint8Array,
  relativePath: string,
): Array<{ lineNumber: number; value: UnknownRecord }> {
  const content = Buffer.from(bytes).toString("utf8");
  const rows: Array<{ lineNumber: number; value: UnknownRecord }> = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line) {
      continue;
    }
    rows.push({
      lineNumber: index + 1,
      value: parseEventLedgerRow(line, index + 1, relativePath),
    });
  }
  return rows;
}

function parseEventLedgerRow(
  line: string,
  lineNumber: number,
  relativePath: string,
): UnknownRecord {
  try {
    return JSON.parse(line) as UnknownRecord;
  } catch (error) {
    throw new VaultError(
      "VAULT_INVALID_JSONL",
      `Invalid JSON on line ${lineNumber}.`,
      {
        cause: error instanceof Error ? error.message : String(error),
        lineNumber,
        relativePath,
      },
    );
  }
}

export async function readEventLedgerShardRows(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<Array<{ lineNumber: number; value: UnknownRecord }>> {
  const logicalPath = requireEventLedgerLogicalPath(input.relativePath);
  const source = await resolveEventLedgerShardSource(input.vaultRoot, logicalPath);
  if (!source) {
    throw new VaultError(
      "VAULT_FILE_MISSING",
      `Event ledger shard "${logicalPath}" does not exist.`,
      { relativePath: logicalPath },
    );
  }
  return parseEventLedgerRows(
    await readBoundedEventLedgerSourceBytes(input.vaultRoot, source),
    logicalPath,
  );
}

export async function readEventLedgerShardText(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<string> {
  const logicalPath = requireEventLedgerLogicalPath(input.relativePath);
  const source = await resolveEventLedgerShardSource(input.vaultRoot, logicalPath);
  if (!source) {
    throw new VaultError(
      "VAULT_FILE_MISSING",
      `Event ledger shard "${logicalPath}" does not exist.`,
      { relativePath: logicalPath },
    );
  }
  return (await readBoundedEventLedgerSourceBytes(input.vaultRoot, source)).toString("utf8");
}

export async function readEventLedgerShardRecords(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<UnknownRecord[]> {
  return (await readEventLedgerShardRows(input)).map((row) => row.value);
}

export async function visitEventLedgerShardRecordsInterruptible(input: {
  vaultRoot: string;
  relativePath: string;
  shouldContinue?: () => boolean;
  signal?: AbortSignal | null;
  visit: (record: UnknownRecord, lineNumber: number) => Promise<void> | void;
}): Promise<{ interrupted: boolean; visitedCount: number }> {
  if (input.shouldContinue?.() === false) {
    return { interrupted: true, visitedCount: 0 };
  }
  input.signal?.throwIfAborted();
  let visitedCount = 0;
  const logicalPath = requireEventLedgerLogicalPath(input.relativePath);
  const content = await readEventLedgerShardText(input);
  for (const [index, line] of content.split("\n").entries()) {
    input.signal?.throwIfAborted();
    if (input.shouldContinue?.() === false) {
      return { interrupted: true, visitedCount };
    }
    if (!line) {
      continue;
    }
    await input.visit(
      parseEventLedgerRow(line, index + 1, logicalPath),
      index + 1,
    );
    visitedCount += 1;
  }
  return { interrupted: false, visitedCount };
}

function createContentReceipt(bytes: Uint8Array): EventLedgerShardContentReceipt {
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function receiptsMatch(
  left: EventLedgerShardContentReceipt,
  right: EventLedgerShardContentReceipt,
): boolean {
  return left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

export async function createArchivedEventLedgerShardContentReceipt(
  vaultRoot: string,
  logicalPath: string,
): Promise<EventLedgerShardContentReceipt | null> {
  const source = await resolveEventLedgerShardSource(vaultRoot, logicalPath);
  if (!source || source.kind !== "gzip") {
    return null;
  }
  const bytes = await readBoundedEventLedgerSourceBytes(vaultRoot, source);
  parseEventLedgerRows(bytes, source.logicalPath);
  return createContentReceipt(bytes);
}

export async function inspectArchivedEventLedgerShardAppend(input: {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  payload: Uint8Array;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<"applied" | "base" | null> {
  const source = await resolveEventLedgerShardSource(input.vaultRoot, input.targetRelativePath);
  if (!source || source.kind !== "gzip") {
    return null;
  }
  const bytes = await readBoundedEventLedgerSourceBytes(input.vaultRoot, source);
  if (bytes.byteLength < input.expectedBaseByteLength) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
      "Event ledger archive is shorter than its append receipt base.",
      { relativePath: source.logicalPath },
    );
  }
  const actualBase = createContentReceipt(bytes.subarray(0, input.expectedBaseByteLength));
  const expectedBase = {
    byteLength: input.expectedBaseByteLength,
    sha256: input.expectedBaseSha256,
  };
  if (!receiptsMatch(actualBase, expectedBase)) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
      "Event ledger archive base content does not match the append receipt.",
      { relativePath: source.logicalPath },
    );
  }
  if (bytes.byteLength === input.expectedBaseByteLength) {
    return "base";
  }
  const expectedLength = input.expectedBaseByteLength + input.payload.byteLength;
  if (
    bytes.byteLength === expectedLength
    && Buffer.from(bytes.subarray(input.expectedBaseByteLength)).equals(Buffer.from(input.payload))
  ) {
    return "applied";
  }
  throw new VaultError(
    "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
    "Event ledger archive changed after the append receipt base.",
    { relativePath: source.logicalPath },
  );
}

function buildVerifiedEventLedgerArchive(bytes: Uint8Array, relativePath: string): Buffer {
  if (bytes.byteLength > MAX_EVENT_LEDGER_SHARD_BYTES) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${relativePath}" exceeds its uncompressed size limit.`,
      { byteSize: bytes.byteLength, relativePath },
    );
  }
  const archive = gzipSync(bytes, { level: 6 });
  if (archive.byteLength > MAX_EVENT_LEDGER_ARCHIVE_BYTES) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger archive "${relativePath}.gz" exceeds its compressed size limit.`,
      { byteSize: archive.byteLength, relativePath: `${relativePath}.gz` },
    );
  }
  const verified = gunzipSync(archive, { maxOutputLength: MAX_EVENT_LEDGER_SHARD_BYTES });
  if (!verified.equals(Buffer.from(bytes))) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Event ledger archive verification failed.",
      { relativePath: `${relativePath}.gz` },
    );
  }
  return archive;
}

async function rewriteArchivedEventLedgerShard(
  vaultRoot: string,
  source: EventLedgerShardSource,
  bytes: Uint8Array,
): Promise<void> {
  const archive = buildVerifiedEventLedgerArchive(bytes, source.logicalPath);
  await writeFileAtomic(
    resolveVaultPath(vaultRoot, source.sourcePath).absolutePath,
    archive,
  );
  const stored = await readBoundedEventLedgerSourceBytes(vaultRoot, source);
  if (!stored.equals(Buffer.from(bytes))) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Event ledger archive replacement verification failed.",
      { relativePath: source.sourcePath },
    );
  }
}

export async function appendArchivedEventLedgerShard(input: {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  payload: string;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<{ originalSize: number }> {
  const source = await resolveEventLedgerShardSource(input.vaultRoot, input.targetRelativePath);
  if (!source || source.kind !== "gzip") {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_NOT_ARCHIVED",
      "Event ledger shard is not archived.",
      { relativePath: input.targetRelativePath },
    );
  }
  const payload = Buffer.from(input.payload, "utf8");
  parseEventLedgerRows(payload, source.logicalPath);
  const state = await inspectArchivedEventLedgerShardAppend({
    expectedBaseByteLength: input.expectedBaseByteLength,
    expectedBaseSha256: input.expectedBaseSha256,
    payload,
    targetRelativePath: input.targetRelativePath,
    vaultRoot: input.vaultRoot,
  });
  if (state === "applied") {
    return { originalSize: input.expectedBaseByteLength };
  }
  const base = await readBoundedEventLedgerSourceBytes(input.vaultRoot, source);
  if (base.byteLength > 0 && base.at(-1) !== 0x0a) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Event ledger archive is not newline-terminated.",
      { relativePath: source.sourcePath },
    );
  }
  await rewriteArchivedEventLedgerShard(
    input.vaultRoot,
    source,
    Buffer.concat([base, payload]),
  );
  return { originalSize: input.expectedBaseByteLength };
}

export async function truncateArchivedEventLedgerShard(input: {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const source = await resolveEventLedgerShardSource(input.vaultRoot, input.targetRelativePath);
  if (!source || source.kind !== "gzip") {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_NOT_ARCHIVED",
      "Event ledger shard is not archived.",
      { relativePath: input.targetRelativePath },
    );
  }
  const bytes = await readBoundedEventLedgerSourceBytes(input.vaultRoot, source);
  if (bytes.byteLength < input.expectedBaseByteLength) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
      "Event ledger archive is shorter than its rollback receipt base.",
      { relativePath: source.logicalPath },
    );
  }
  const base = bytes.subarray(0, input.expectedBaseByteLength);
  if (createContentReceipt(base).sha256 !== input.expectedBaseSha256) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
      "Event ledger archive base content does not match the rollback receipt.",
      { relativePath: source.logicalPath },
    );
  }
  if (bytes.byteLength !== input.expectedBaseByteLength) {
    await rewriteArchivedEventLedgerShard(input.vaultRoot, source, base);
  }
}

function eventLedgerShardMonth(logicalPath: string): string | null {
  return /(?:^|\/)(\d{4}-\d{2})\.jsonl$/u.exec(logicalPath)?.[1] ?? null;
}

async function archivePlainEventLedgerShard(
  vaultRoot: string,
  source: EventLedgerShardSource,
): Promise<{ archiveByteCount: number; repaired: boolean; sourceByteCount: number }> {
  const plainAbsolutePath = resolveVaultPath(vaultRoot, source.logicalPath).absolutePath;
  const gzipSource = {
    kind: "gzip" as const,
    logicalPath: source.logicalPath,
    sourcePath: `${source.logicalPath}.gz`,
  };
  const gzipAbsolutePath = resolveVaultPath(vaultRoot, gzipSource.sourcePath).absolutePath;
  const sourceBytes = await readBoundedEventLedgerSourceBytes(vaultRoot, source);
  parseEventLedgerRows(sourceBytes, source.logicalPath);

  if (await pathExists(gzipAbsolutePath)) {
    const archivedBytes = await readBoundedEventLedgerSourceBytes(vaultRoot, gzipSource);
    if (!archivedBytes.equals(sourceBytes)) {
      throw new VaultError(
        "EVENT_LEDGER_SHARD_AMBIGUOUS",
        "Plain and gzip event ledger shard representations differ.",
        { relativePath: source.logicalPath },
      );
    }
    await fs.unlink(plainAbsolutePath);
    return {
      archiveByteCount: (await fs.stat(gzipAbsolutePath)).size,
      repaired: true,
      sourceByteCount: sourceBytes.byteLength,
    };
  }

  const archive = buildVerifiedEventLedgerArchive(sourceBytes, source.logicalPath);
  await writeBytesFileAtomicExclusive(gzipAbsolutePath, archive);
  const verified = await readBoundedEventLedgerSourceBytes(vaultRoot, gzipSource);
  if (!verified.equals(sourceBytes)) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Published event ledger archive verification failed.",
      { relativePath: gzipSource.sourcePath },
    );
  }
  await fs.unlink(plainAbsolutePath);
  return {
    archiveByteCount: archive.byteLength,
    repaired: false,
    sourceByteCount: sourceBytes.byteLength,
  };
}

/**
 * Explicit consumer-first activation seam. No runtime invokes this automatically;
 * callers must deploy gzip-capable readers everywhere before archiving any shard.
 */
export async function archiveClosedEventLedgerShards(input: {
  now?: Date;
  vaultRoot: string;
}): Promise<ArchiveClosedEventLedgerShardsResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Event ledger archive time must be a valid Date.");
  }
  const currentMonth = now.toISOString().slice(0, 7);
  return await withCanonicalWriteLock(input.vaultRoot, async () => {
    const paths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory);
    const plainSources = paths
      .filter((relativePath) => relativePath.endsWith(".jsonl"))
      .map(toEventLedgerShardSource)
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
    const result: ArchiveClosedEventLedgerShardsResult = {
      archivedByteCount: 0,
      archivedShardCount: 0,
      repairedShardCount: 0,
      scannedShardCount: plainSources.length,
      sourceByteCount: 0,
    };
    for (const source of plainSources) {
      const month = eventLedgerShardMonth(source.logicalPath);
      if (!month || month >= currentMonth) {
        continue;
      }
      const archived = await archivePlainEventLedgerShard(input.vaultRoot, source);
      result.archivedByteCount += archived.archiveByteCount;
      result.archivedShardCount += 1;
      result.repairedShardCount += archived.repaired ? 1 : 0;
      result.sourceByteCount += archived.sourceByteCount;
    }
    return result;
  });
}
