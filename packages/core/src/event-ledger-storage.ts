import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { prepareFileAtomicExclusive, writeFileAtomic } from "./atomic-write.ts";
import {
  compressShard,
  createShardCompressor,
  createShardDecompressor,
  decompressShard,
  type ShardCompression,
} from "./shard-compression.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles, walkVaultFilesInterruptible } from "./fs.ts";
import { withCanonicalWriteLock } from "./operations/canonical-write-lock.ts";
import {
  assertPathWithinVaultOnDisk,
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";

import { isErrnoException, type UnknownRecord } from "./types.ts";

export const MAX_EVENT_LEDGER_SHARD_BYTES = 256 * 1024 * 1024;
export const MAX_EVENT_LEDGER_ARCHIVE_BYTES = 128 * 1024 * 1024;

export interface EventLedgerShardSource {
  kind: "jsonl" | ShardCompression;
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
  blockedShardCount: number;
  repairedShardCount: number;
  scannedShardCount: number;
  sourceByteCount: number;
}

function isEventLedgerSourcePath(relativePath: string): boolean {
  return ["", ".gz", ".br"].some((suffix) =>
    relativePath.endsWith(`.jsonl${suffix}`)
    && isEventLedgerLogicalPath(suffix ? relativePath.slice(0, -suffix.length) : relativePath)
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
  if (normalized.endsWith(".jsonl.br")) {
    return { kind: "brotli", logicalPath: normalized.slice(0, -3), sourcePath: normalized };
  }
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
        `Event ledger shard "${source.logicalPath}" has multiple physical representations.`,
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
  const candidates = await Promise.all(["", ".gz", ".br"].map(async (suffix) => {
    const sourcePath = `${logicalPath}${suffix}`;
    return await pathExists(resolveVaultPath(vaultRoot, sourcePath).absolutePath)
      ? toEventLedgerShardSource(sourcePath)
      : null;
  }));
  const sources = candidates.filter((source) => source !== null);
  assertUnambiguousEventLedgerSources(sources);
  return sources[0] ?? null;
}

async function readBoundedEventLedgerSourceBytes(
  vaultRoot: string,
  source: EventLedgerShardSource,
  signal: AbortSignal | null = null,
): Promise<Buffer> {
  signal?.throwIfAborted();
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
  const maxStoredBytes = source.kind !== "jsonl"
    ? MAX_EVENT_LEDGER_ARCHIVE_BYTES
    : MAX_EVENT_LEDGER_SHARD_BYTES;
  if (stats.size > maxStoredBytes) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${source.sourcePath}" exceeds its storage limit.`,
      { byteSize: stats.size, relativePath: source.sourcePath },
    );
  }
  const storedBytes = await fs.readFile(
    resolved.absolutePath,
    signal ? { signal } : undefined,
  );
  signal?.throwIfAborted();
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
    const bytes = decompressShard(storedBytes, source.kind, MAX_EVENT_LEDGER_SHARD_BYTES);
    signal?.throwIfAborted();
    return bytes;
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
  if (!source || source.kind === "jsonl") {
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
  if (!source || source.kind === "jsonl") {
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

function buildVerifiedEventLedgerArchive(
  bytes: Uint8Array,
  relativePath: string,
  kind: ShardCompression,
): Buffer {
  if (bytes.byteLength > MAX_EVENT_LEDGER_SHARD_BYTES) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${relativePath}" exceeds its uncompressed size limit.`,
      { byteSize: bytes.byteLength, relativePath },
    );
  }
  const archive = compressShard(bytes, kind);
  if (archive.byteLength > MAX_EVENT_LEDGER_ARCHIVE_BYTES) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger archive "${relativePath}" exceeds its compressed size limit.`,
      { byteSize: archive.byteLength, relativePath },
    );
  }
  const verified = decompressShard(archive, kind, MAX_EVENT_LEDGER_SHARD_BYTES);
  if (!verified.equals(Buffer.from(bytes))) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Event ledger archive verification failed.",
      { relativePath },
    );
  }
  return archive;
}

async function rewriteArchivedEventLedgerShard(
  vaultRoot: string,
  source: EventLedgerShardSource,
  bytes: Uint8Array,
): Promise<void> {
  if (source.kind === "jsonl") throw new TypeError("Expected an archived event shard.");
  const archive = buildVerifiedEventLedgerArchive(bytes, source.sourcePath, source.kind);
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
  if (!source || source.kind === "jsonl") {
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
  if (!source || source.kind === "jsonl") {
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

function createEventLedgerJsonlReceiptMeter(input: {
  relativePath: string;
  signal: AbortSignal | null;
}): {
  readReceipt: () => EventLedgerShardContentReceipt;
  stream: Transform;
} {
  const decoder = new StringDecoder("utf8");
  const hash = createHash("sha256");
  let byteLength = 0;
  let lineNumber = 0;
  const pendingFragments: string[] = [];
  let receipt: EventLedgerShardContentReceipt | null = null;

  const parseLine = (finalFragment: string): void => {
    let line = finalFragment;
    if (pendingFragments.length > 0) {
      pendingFragments.push(finalFragment);
      line = pendingFragments.join("");
      pendingFragments.length = 0;
    }
    lineNumber += 1;
    if (line.length > 0) {
      parseEventLedgerRow(line, lineNumber, input.relativePath);
    }
  };

  const parseDecodedText = (text: string): void => {
    let lineStart = 0;
    let newlineIndex = text.indexOf("\n", lineStart);
    while (newlineIndex >= 0) {
      parseLine(text.slice(lineStart, newlineIndex));
      lineStart = newlineIndex + 1;
      newlineIndex = text.indexOf("\n", lineStart);
    }
    if (lineStart < text.length) {
      pendingFragments.push(text.slice(lineStart));
    }
  };

  const stream = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      try {
        input.signal?.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        byteLength += bytes.byteLength;
        if (byteLength > MAX_EVENT_LEDGER_SHARD_BYTES) {
          callback(new VaultError(
            "EVENT_LEDGER_SHARD_TOO_LARGE",
            `Event ledger shard "${input.relativePath}" exceeds its uncompressed size limit.`,
            { byteSize: byteLength, relativePath: input.relativePath },
          ));
          return;
        }
        hash.update(bytes);
        parseDecodedText(decoder.write(bytes));
        callback(null, bytes);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback) {
      try {
        input.signal?.throwIfAborted();
        parseDecodedText(decoder.end());
        if (pendingFragments.length > 0) {
          parseLine("");
        }
        receipt = {
          byteLength,
          sha256: hash.digest("hex"),
        };
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  return {
    readReceipt() {
      if (!receipt) {
        throw new VaultError(
          "EVENT_LEDGER_ARCHIVE_INVALID",
          "Event ledger archive validation did not produce a content receipt.",
          { relativePath: input.relativePath },
        );
      }
      return receipt;
    },
    stream,
  };
}

async function validatePreparedEventLedgerArchive(input: {
  absolutePath: string;
  logicalPath: string;
  signal: AbortSignal | null;
}): Promise<EventLedgerShardContentReceipt> {
  const archiveStat = await fs.stat(input.absolutePath);
  if (!archiveStat.isFile() || archiveStat.size > MAX_EVENT_LEDGER_ARCHIVE_BYTES) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger archive "${input.logicalPath}.br" exceeds its compressed size limit.`,
      { byteSize: archiveStat.size, relativePath: `${input.logicalPath}.br` },
    );
  }
  const meter = createEventLedgerJsonlReceiptMeter({
    relativePath: input.logicalPath,
    signal: input.signal,
  });
  await pipeline(
    createReadStream(input.absolutePath, input.signal ? { signal: input.signal } : undefined),
    createShardDecompressor("brotli"),
    meter.stream,
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    { signal: input.signal ?? undefined },
  );
  return meter.readReceipt();
}

function assertEventLedgerArchiveSourceUnchanged(
  before: Awaited<ReturnType<typeof fs.stat>>,
  after: Awaited<ReturnType<typeof fs.stat>>,
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
    "EVENT_LEDGER_ARCHIVE_SOURCE_CHANGED",
    "Event ledger shard changed while it was being archived.",
    { relativePath },
  );
}

async function archiveEventLedgerShard(
  vaultRoot: string,
  source: EventLedgerShardSource,
  signal: AbortSignal | null,
): Promise<{ archiveByteCount: number; sourceByteCount: number }> {
  signal?.throwIfAborted();
  const sourceAbsolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  const archiveSource = {
    kind: "brotli" as const,
    logicalPath: source.logicalPath,
    sourcePath: `${source.logicalPath}.br`,
  };
  const archiveAbsolutePath = resolveVaultPath(vaultRoot, archiveSource.sourcePath).absolutePath;
  await assertPathWithinVaultOnDisk(vaultRoot, sourceAbsolutePath);
  const sourceStatBefore = await fs.stat(sourceAbsolutePath);
  if (!sourceStatBefore.isFile() || sourceStatBefore.size > (source.kind === "jsonl" ? MAX_EVENT_LEDGER_SHARD_BYTES : MAX_EVENT_LEDGER_ARCHIVE_BYTES)) {
    throw new VaultError(
      "EVENT_LEDGER_SHARD_TOO_LARGE",
      `Event ledger shard "${source.logicalPath}" exceeds its uncompressed size limit.`,
      { byteSize: sourceStatBefore.size, relativePath: source.logicalPath },
    );
  }
  const sourceReceiptHolder: { value?: EventLedgerShardContentReceipt } = {};
  await prepareFileAtomicExclusive(archiveAbsolutePath, async (tempAbsolutePath) => {
    signal?.throwIfAborted();
    const meter = createEventLedgerJsonlReceiptMeter({
      relativePath: source.logicalPath,
      signal,
    });
    await pipeline([
      createReadStream(sourceAbsolutePath, signal ? { signal } : undefined),
      ...(source.kind === "jsonl" ? [] : [createShardDecompressor(source.kind)]),
      meter.stream,
      createShardCompressor("brotli"),
      createWriteStream(tempAbsolutePath, {
        flags: "wx",
        mode: sourceStatBefore.mode & 0o7777,
        ...(signal ? { signal } : {}),
      }),
    ], { signal: signal ?? undefined });
    const sourceReceipt = meter.readReceipt();
    sourceReceiptHolder.value = sourceReceipt;
    const archivedReceipt = await validatePreparedEventLedgerArchive({
      absolutePath: tempAbsolutePath,
      logicalPath: source.logicalPath,
      signal,
    });
    if (!receiptsMatch(sourceReceipt, archivedReceipt)) {
      throw new VaultError(
        "EVENT_LEDGER_ARCHIVE_INVALID",
        "Prepared event ledger archive did not preserve the source shard exactly.",
        { relativePath: archiveSource.sourcePath },
      );
    }
    assertEventLedgerArchiveSourceUnchanged(
      sourceStatBefore,
      await fs.stat(sourceAbsolutePath),
      source.logicalPath,
    );
  });
  const sourceReceipt = sourceReceiptHolder.value;
  if (!sourceReceipt) {
    throw new VaultError(
      "EVENT_LEDGER_ARCHIVE_INVALID",
      "Event ledger archive did not produce a source receipt.",
      { relativePath: archiveSource.sourcePath },
    );
  }
  await fs.unlink(sourceAbsolutePath);
  return {
    archiveByteCount: (await fs.stat(archiveAbsolutePath)).size,
    sourceByteCount: sourceReceipt.byteLength,
  };
}

async function reconcileEventLedgerShardSources(
  vaultRoot: string,
  sources: readonly EventLedgerShardSource[],
  signal: AbortSignal | null,
): Promise<{ source: EventLedgerShardSource; sourceByteCount: number }> {
  const source = sources.find((candidate) => candidate.kind === "brotli") ?? sources[0];
  if (!source) throw new TypeError("Expected an event ledger source.");
  if (sources.length === 1) return { source, sourceByteCount: 0 };
  const before = await Promise.all(sources.map((candidate) =>
    fs.stat(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath)
  ));
  const content = await readBoundedEventLedgerSourceBytes(vaultRoot, source, signal);
  parseEventLedgerRows(content, source.logicalPath);
  const verified: string[] = [];
  for (const candidate of sources) {
    signal?.throwIfAborted();
    if (candidate === source) continue;
    const bytes = await readBoundedEventLedgerSourceBytes(vaultRoot, candidate, signal);
    parseEventLedgerRows(bytes, candidate.logicalPath);
    if (!content.equals(bytes)) {
      throw new VaultError("EVENT_LEDGER_SHARD_AMBIGUOUS", "Event ledger representations differ.", {
        relativePath: source.logicalPath,
      });
    }
    verified.push(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath);
  }
  for (const [index, candidate] of sources.entries()) {
    assertEventLedgerArchiveSourceUnchanged(before[index]!,
      await fs.stat(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath), candidate.sourcePath);
  }
  for (const absolutePath of verified) {
    signal?.throwIfAborted();
    await fs.unlink(absolutePath);
  }
  return { source, sourceByteCount: content.byteLength };
}

export async function archiveClosedEventLedgerShards(input: {
  now?: Date;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<ArchiveClosedEventLedgerShardsResult> {
  input.signal?.throwIfAborted();
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Event ledger archive time must be a valid Date.");
  }
  const currentMonth = now.toISOString().slice(0, 7);
  return await withCanonicalWriteLock(input.vaultRoot, async () => {
    input.signal?.throwIfAborted();
    const { relativePaths: paths } = await walkVaultFilesInterruptible(
      input.vaultRoot,
      VAULT_LAYOUT.eventLedgerDirectory,
      { signal: input.signal },
    );
    const groups = new Map<string, EventLedgerShardSource[]>();
    for (const source of paths.filter(isEventLedgerSourcePath).map(toEventLedgerShardSource)) {
      const group = groups.get(source.logicalPath) ?? [];
      group.push(source);
      groups.set(source.logicalPath, group);
    }
    const result: ArchiveClosedEventLedgerShardsResult = {
      archivedByteCount: 0,
      archivedShardCount: 0,
      blockedShardCount: 0,
      repairedShardCount: 0,
      scannedShardCount: groups.size,
      sourceByteCount: 0,
    };
    for (const [logicalPath, sources] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
      input.signal?.throwIfAborted();
      const month = eventLedgerShardMonth(logicalPath);
      if (!month || month >= currentMonth) {
        continue;
      }
      try {
        const { source, sourceByteCount } = await reconcileEventLedgerShardSources(
          input.vaultRoot, sources, input.signal ?? null,
        );
        if (source.kind === "brotli" && sources.length === 1) continue;
        const archived = source.kind === "brotli"
          ? {
              archiveByteCount: (await fs.stat(resolveVaultPath(input.vaultRoot, source.sourcePath).absolutePath)).size,
              sourceByteCount,
            }
          : await archiveEventLedgerShard(input.vaultRoot, source, input.signal ?? null);
        result.archivedByteCount += archived.archiveByteCount;
        result.archivedShardCount += 1;
        result.repairedShardCount += sources.length > 1 ? 1 : 0;
        result.sourceByteCount += archived.sourceByteCount;
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!(error instanceof VaultError) && !(isErrnoException(error)
          && (error.code === "Z_DATA_ERROR" || error.code === "Z_BUF_ERROR"))) {
          throw error;
        }
        result.blockedShardCount += 1;
      }
    }
    return result;
  });
}
