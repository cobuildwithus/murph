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
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles, walkVaultFilesInterruptible } from "./fs.ts";
import { withCanonicalWriteLock } from "./operations/canonical-write-lock.ts";
import {
  assertPathWithinVaultOnDisk,
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";

import { isErrnoException, type UnknownRecord } from "./types.ts";

export const MAX_JSONL_SHARD_BYTES = 256 * 1024 * 1024;
export const MAX_JSONL_ARCHIVE_BYTES = 128 * 1024 * 1024;

export interface JsonlShardSource {
  kind: "jsonl" | ShardCompression;
  logicalPath: string;
  sourcePath: string;
}

export interface JsonlShardContentReceipt {
  byteLength: number;
  sha256: string;
}

export interface ArchiveClosedJsonlShardsResult {
  archivedByteCount: number;
  archivedShardCount: number;
  blockedShardCount: number;
  repairedShardCount: number;
  scannedShardCount: number;
  sourceByteCount: number;
}

export function createJsonlShardStorage(relativeDirectory: string, errorPrefix: "EVENT_LEDGER" | "AUDIT") {
  function isJsonlSourcePath(relativePath: string): boolean {
    return ["", ".gz", ".br"].some((suffix) =>
      relativePath.endsWith(`.jsonl${suffix}`)
      && isJsonlLogicalPath(suffix ? relativePath.slice(0, -suffix.length) : relativePath)
    );
  }

  function isJsonlLogicalPath(relativePath: string): boolean {
    let normalized: string;
    try {
      normalized = normalizeRelativeVaultPath(relativePath);
    } catch {
      return false;
    }
    return normalized.startsWith(`${relativeDirectory}/`)
      && normalized.endsWith(".jsonl");
  }

  function requireJsonlLogicalPath(relativePath: string): string {
    const normalized = normalizeRelativeVaultPath(relativePath);
    if (!isJsonlLogicalPath(normalized)) {
      throw new VaultError(
        `${errorPrefix}_SHARD_PATH_INVALID`,
        "Ledger shard path must be a canonical .jsonl path.",
        { relativePath: normalized },
      );
    }
    return normalized;
  }

  function toJsonlShardSource(relativePath: string): JsonlShardSource {
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

  function assertUnambiguousJsonlSources(
    sources: readonly JsonlShardSource[],
  ): void {
    const seen = new Map<string, JsonlShardSource>();
    for (const source of sources) {
      const prior = seen.get(source.logicalPath);
      if (prior) {
        throw new VaultError(
          `${errorPrefix}_SHARD_AMBIGUOUS`,
          `Ledger shard "${source.logicalPath}" has multiple physical representations.`,
          { relativePath: source.logicalPath },
        );
      }
      seen.set(source.logicalPath, source);
    }
  }

  async function listJsonlShardSources(
    vaultRoot: string,
  ): Promise<JsonlShardSource[]> {
    const paths = await walkVaultFiles(vaultRoot, relativeDirectory);
    const sources = paths
      .filter(isJsonlSourcePath)
      .map(toJsonlShardSource)
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
    assertUnambiguousJsonlSources(sources);
    return sources;
  }

  async function listJsonlShardPaths(vaultRoot: string): Promise<string[]> {
    return (await listJsonlShardSources(vaultRoot)).map((source) => source.logicalPath);
  }

  async function listJsonlShardPathsInterruptible(input: {
    signal?: AbortSignal | null;
    shouldContinue?: () => boolean;
    vaultRoot: string;
  }): Promise<{ interrupted: boolean; relativePaths: string[] }> {
    const walked = await walkVaultFilesInterruptible(
      input.vaultRoot,
      relativeDirectory,
      {
        shouldContinue: input.shouldContinue,
        signal: input.signal,
      },
    );
    const sources = walked.relativePaths
      .filter(isJsonlSourcePath)
      .map(toJsonlShardSource)
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
    assertUnambiguousJsonlSources(sources);
    return {
      interrupted: walked.interrupted,
      relativePaths: sources.map((source) => source.logicalPath),
    };
  }

  async function resolveJsonlShardSource(
    vaultRoot: string,
    relativePath: string,
  ): Promise<JsonlShardSource | null> {
    const logicalPath = requireJsonlLogicalPath(relativePath);
    const candidates = await Promise.all(["", ".gz", ".br"].map(async (suffix) => {
      const sourcePath = `${logicalPath}${suffix}`;
      return await pathExists(resolveVaultPath(vaultRoot, sourcePath).absolutePath)
        ? toJsonlShardSource(sourcePath)
        : null;
    }));
    const sources = candidates.filter((source) => source !== null);
    assertUnambiguousJsonlSources(sources);
    return sources[0] ?? null;
  }

  async function readBoundedJsonlSourceBytes(
    vaultRoot: string,
    source: JsonlShardSource,
    signal: AbortSignal | null = null,
  ): Promise<Buffer> {
    signal?.throwIfAborted();
    const resolved = resolveVaultPath(vaultRoot, source.sourcePath);
    await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
    const stats = await fs.stat(resolved.absolutePath);
    if (!stats.isFile()) {
      throw new VaultError(
        `${errorPrefix}_SHARD_INVALID`,
        "Ledger shard source must be a file.",
        { relativePath: source.sourcePath },
      );
    }
    const maxStoredBytes = source.kind !== "jsonl"
      ? MAX_JSONL_ARCHIVE_BYTES
      : MAX_JSONL_SHARD_BYTES;
    if (stats.size > maxStoredBytes) {
      throw new VaultError(
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger shard "${source.sourcePath}" exceeds its storage limit.`,
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
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger shard "${source.sourcePath}" exceeds its storage limit.`,
        { byteSize: storedBytes.byteLength, relativePath: source.sourcePath },
      );
    }
    if (source.kind === "jsonl") {
      return storedBytes;
    }
    try {
      const bytes = decompressShard(storedBytes, source.kind, MAX_JSONL_SHARD_BYTES);
      signal?.throwIfAborted();
      return bytes;
    } catch (error) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_INVALID`,
        `Ledger archive "${source.sourcePath}" could not be decoded.`,
        {
          cause: error instanceof Error ? error.message : String(error),
          relativePath: source.sourcePath,
        },
      );
    }
  }

  function parseJsonlRows(
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
        value: parseJsonlRow(line, index + 1, relativePath),
      });
    }
    return rows;
  }

  function parseJsonlRow(
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

  async function readJsonlShardRows(input: {
    vaultRoot: string;
    relativePath: string;
  }): Promise<Array<{ lineNumber: number; value: UnknownRecord }>> {
    const logicalPath = requireJsonlLogicalPath(input.relativePath);
    const source = await resolveJsonlShardSource(input.vaultRoot, logicalPath);
    if (!source) {
      throw new VaultError(
        "VAULT_FILE_MISSING",
        `Ledger shard "${logicalPath}" does not exist.`,
        { relativePath: logicalPath },
      );
    }
    return parseJsonlRows(
      await readBoundedJsonlSourceBytes(input.vaultRoot, source),
      logicalPath,
    );
  }

  async function readJsonlShardText(input: {
    vaultRoot: string;
    relativePath: string;
  }): Promise<string> {
    return (await readJsonlShardBytes(input)).toString("utf8");
  }

  async function readJsonlShardBytes(input: {
    vaultRoot: string;
    relativePath: string;
  }): Promise<Buffer> {
    const logicalPath = requireJsonlLogicalPath(input.relativePath);
    const source = await resolveJsonlShardSource(input.vaultRoot, logicalPath);
    if (!source) {
      throw new VaultError(
        "VAULT_FILE_MISSING",
        `Ledger shard "${logicalPath}" does not exist.`,
        { relativePath: logicalPath },
      );
    }
    return await readBoundedJsonlSourceBytes(input.vaultRoot, source);
  }

  async function readJsonlShardRecords(input: {
    vaultRoot: string;
    relativePath: string;
  }): Promise<UnknownRecord[]> {
    return (await readJsonlShardRows(input)).map((row) => row.value);
  }

  async function visitJsonlShardRecordsInterruptible(input: {
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
    const logicalPath = requireJsonlLogicalPath(input.relativePath);
    const bytes = await readJsonlShardBytes(input);
    // Retain archive validation before callbacks, but decode only visited lines.
    // Include the trailing empty physical line in the continuation checks.
    for (let offset = 0, lineNumber = 1; offset <= bytes.length; lineNumber += 1) {
      if ((input.signal || input.shouldContinue) && lineNumber > 1 && (lineNumber - 1) % 256 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      input.signal?.throwIfAborted();
      if (input.shouldContinue?.() === false) {
        return { interrupted: true, visitedCount };
      }
      const newline = bytes.indexOf(0x0a, offset);
      const end = newline < 0 ? bytes.length : newline;
      const line = bytes.toString("utf8", offset, end);
      offset = end + 1;
      if (!line) {
        continue;
      }
      await input.visit(
        parseJsonlRow(line, lineNumber, logicalPath),
        lineNumber,
      );
      visitedCount += 1;
    }
    return { interrupted: false, visitedCount };
  }

  function createContentReceipt(bytes: Uint8Array): JsonlShardContentReceipt {
    return {
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  function receiptsMatch(
    left: JsonlShardContentReceipt,
    right: JsonlShardContentReceipt,
  ): boolean {
    return left.byteLength === right.byteLength && left.sha256 === right.sha256;
  }

  async function createArchivedJsonlShardContentReceipt(
    vaultRoot: string,
    logicalPath: string,
  ): Promise<JsonlShardContentReceipt | null> {
    const source = await resolveJsonlShardSource(vaultRoot, logicalPath);
    if (!source || source.kind === "jsonl") {
      return null;
    }
    const bytes = await readBoundedJsonlSourceBytes(vaultRoot, source);
    parseJsonlRows(bytes, source.logicalPath);
    return createContentReceipt(bytes);
  }

  async function inspectArchivedJsonlShardAppend(input: {
    expectedBaseByteLength: number;
    expectedBaseSha256: string;
    payload: Uint8Array;
    targetRelativePath: string;
    vaultRoot: string;
  }): Promise<"applied" | "base" | null> {
    const source = await resolveJsonlShardSource(input.vaultRoot, input.targetRelativePath);
    if (!source || source.kind === "jsonl") {
      return null;
    }
    const bytes = await readBoundedJsonlSourceBytes(input.vaultRoot, source);
    if (bytes.byteLength < input.expectedBaseByteLength) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_BASE_MISMATCH`,
        "Ledger archive is shorter than its append receipt base.",
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
        `${errorPrefix}_ARCHIVE_BASE_MISMATCH`,
        "Ledger archive base content does not match the append receipt.",
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
      `${errorPrefix}_ARCHIVE_BASE_MISMATCH`,
      "Ledger archive changed after the append receipt base.",
      { relativePath: source.logicalPath },
    );
  }

  function buildVerifiedJsonlArchive(
    bytes: Uint8Array,
    relativePath: string,
    kind: ShardCompression,
  ): Buffer {
    if (bytes.byteLength > MAX_JSONL_SHARD_BYTES) {
      throw new VaultError(
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger shard "${relativePath}" exceeds its uncompressed size limit.`,
        { byteSize: bytes.byteLength, relativePath },
      );
    }
    const archive = compressShard(bytes, kind);
    if (archive.byteLength > MAX_JSONL_ARCHIVE_BYTES) {
      throw new VaultError(
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger archive "${relativePath}" exceeds its compressed size limit.`,
        { byteSize: archive.byteLength, relativePath },
      );
    }
    const verified = decompressShard(archive, kind, MAX_JSONL_SHARD_BYTES);
    if (!verified.equals(Buffer.from(bytes))) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_INVALID`,
        "Ledger archive verification failed.",
        { relativePath },
      );
    }
    return archive;
  }

  async function rewriteArchivedJsonlShard(
    vaultRoot: string,
    source: JsonlShardSource,
    bytes: Uint8Array,
  ): Promise<void> {
    if (source.kind === "jsonl") throw new TypeError("Expected an archived ledger shard.");
    const archive = buildVerifiedJsonlArchive(bytes, source.sourcePath, source.kind);
    await writeFileAtomic(
      resolveVaultPath(vaultRoot, source.sourcePath).absolutePath,
      archive,
    );
    const stored = await readBoundedJsonlSourceBytes(vaultRoot, source);
    if (!stored.equals(Buffer.from(bytes))) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_INVALID`,
        "Ledger archive replacement verification failed.",
        { relativePath: source.sourcePath },
      );
    }
  }

  async function appendArchivedJsonlShard(input: {
    expectedBaseByteLength: number;
    expectedBaseSha256: string;
    payload: string;
    targetRelativePath: string;
    vaultRoot: string;
  }): Promise<{ originalSize: number }> {
    const source = await resolveJsonlShardSource(input.vaultRoot, input.targetRelativePath);
    if (!source || source.kind === "jsonl") {
      throw new VaultError(
        `${errorPrefix}_SHARD_NOT_ARCHIVED`,
        "Ledger shard is not archived.",
        { relativePath: input.targetRelativePath },
      );
    }
    const payload = Buffer.from(input.payload, "utf8");
    parseJsonlRows(payload, source.logicalPath);
    const state = await inspectArchivedJsonlShardAppend({
      expectedBaseByteLength: input.expectedBaseByteLength,
      expectedBaseSha256: input.expectedBaseSha256,
      payload,
      targetRelativePath: input.targetRelativePath,
      vaultRoot: input.vaultRoot,
    });
    if (state === "applied") {
      return { originalSize: input.expectedBaseByteLength };
    }
    const base = await readBoundedJsonlSourceBytes(input.vaultRoot, source);
    if (base.byteLength > 0 && base.at(-1) !== 0x0a) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_INVALID`,
        "Ledger archive is not newline-terminated.",
        { relativePath: source.sourcePath },
      );
    }
    await rewriteArchivedJsonlShard(
      input.vaultRoot,
      source,
      Buffer.concat([base, payload]),
    );
    return { originalSize: input.expectedBaseByteLength };
  }

  async function truncateArchivedJsonlShard(input: {
    expectedBaseByteLength: number;
    expectedBaseSha256: string;
    targetRelativePath: string;
    vaultRoot: string;
  }): Promise<void> {
    const source = await resolveJsonlShardSource(input.vaultRoot, input.targetRelativePath);
    if (!source || source.kind === "jsonl") {
      throw new VaultError(
        `${errorPrefix}_SHARD_NOT_ARCHIVED`,
        "Ledger shard is not archived.",
        { relativePath: input.targetRelativePath },
      );
    }
    const bytes = await readBoundedJsonlSourceBytes(input.vaultRoot, source);
    if (bytes.byteLength < input.expectedBaseByteLength) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_BASE_MISMATCH`,
        "Ledger archive is shorter than its rollback receipt base.",
        { relativePath: source.logicalPath },
      );
    }
    const base = bytes.subarray(0, input.expectedBaseByteLength);
    if (createContentReceipt(base).sha256 !== input.expectedBaseSha256) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_BASE_MISMATCH`,
        "Ledger archive base content does not match the rollback receipt.",
        { relativePath: source.logicalPath },
      );
    }
    if (bytes.byteLength !== input.expectedBaseByteLength) {
      await rewriteArchivedJsonlShard(input.vaultRoot, source, base);
    }
  }

  function jsonlShardMonth(logicalPath: string): string | null {
    return /(?:^|\/)(\d{4}-\d{2})\.jsonl$/u.exec(logicalPath)?.[1] ?? null;
  }

  function createJsonlJsonlReceiptMeter(input: {
    relativePath: string;
    signal: AbortSignal | null;
  }): {
    readReceipt: () => JsonlShardContentReceipt;
    stream: Transform;
  } {
    const decoder = new StringDecoder("utf8");
    const hash = createHash("sha256");
    let byteLength = 0;
    let lineNumber = 0;
    const pendingFragments: string[] = [];
    let receipt: JsonlShardContentReceipt | null = null;

    const parseLine = (finalFragment: string): void => {
      let line = finalFragment;
      if (pendingFragments.length > 0) {
        pendingFragments.push(finalFragment);
        line = pendingFragments.join("");
        pendingFragments.length = 0;
      }
      lineNumber += 1;
      if (line.length > 0) {
        parseJsonlRow(line, lineNumber, input.relativePath);
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
          if (byteLength > MAX_JSONL_SHARD_BYTES) {
            callback(new VaultError(
              `${errorPrefix}_SHARD_TOO_LARGE`,
              `Ledger shard "${input.relativePath}" exceeds its uncompressed size limit.`,
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
            `${errorPrefix}_ARCHIVE_INVALID`,
            "Ledger archive validation did not produce a content receipt.",
            { relativePath: input.relativePath },
          );
        }
        return receipt;
      },
      stream,
    };
  }

  async function validatePreparedJsonlArchive(input: {
    absolutePath: string;
    logicalPath: string;
    signal: AbortSignal | null;
  }): Promise<JsonlShardContentReceipt> {
    const archiveStat = await fs.stat(input.absolutePath);
    if (!archiveStat.isFile() || archiveStat.size > MAX_JSONL_ARCHIVE_BYTES) {
      throw new VaultError(
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger archive "${input.logicalPath}.br" exceeds its compressed size limit.`,
        { byteSize: archiveStat.size, relativePath: `${input.logicalPath}.br` },
      );
    }
    const meter = createJsonlJsonlReceiptMeter({
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

  function assertJsonlArchiveSourceUnchanged(
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
      `${errorPrefix}_ARCHIVE_SOURCE_CHANGED`,
      "Ledger shard changed while it was being archived.",
      { relativePath },
    );
  }

  async function archiveJsonlShard(
    vaultRoot: string,
    source: JsonlShardSource,
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
    if (!sourceStatBefore.isFile() || sourceStatBefore.size > (source.kind === "jsonl" ? MAX_JSONL_SHARD_BYTES : MAX_JSONL_ARCHIVE_BYTES)) {
      throw new VaultError(
        `${errorPrefix}_SHARD_TOO_LARGE`,
        `Ledger shard "${source.logicalPath}" exceeds its uncompressed size limit.`,
        { byteSize: sourceStatBefore.size, relativePath: source.logicalPath },
      );
    }
    const sourceReceiptHolder: { value?: JsonlShardContentReceipt } = {};
    await prepareFileAtomicExclusive(archiveAbsolutePath, async (tempAbsolutePath) => {
      signal?.throwIfAborted();
      const meter = createJsonlJsonlReceiptMeter({
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
      const archivedReceipt = await validatePreparedJsonlArchive({
        absolutePath: tempAbsolutePath,
        logicalPath: source.logicalPath,
        signal,
      });
      if (!receiptsMatch(sourceReceipt, archivedReceipt)) {
        throw new VaultError(
          `${errorPrefix}_ARCHIVE_INVALID`,
          "Prepared ledger archive did not preserve the source shard exactly.",
          { relativePath: archiveSource.sourcePath },
        );
      }
      assertJsonlArchiveSourceUnchanged(
        sourceStatBefore,
        await fs.stat(sourceAbsolutePath),
        source.logicalPath,
      );
    });
    const sourceReceipt = sourceReceiptHolder.value;
    if (!sourceReceipt) {
      throw new VaultError(
        `${errorPrefix}_ARCHIVE_INVALID`,
        "Ledger archive did not produce a source receipt.",
        { relativePath: archiveSource.sourcePath },
      );
    }
    await fs.unlink(sourceAbsolutePath);
    return {
      archiveByteCount: (await fs.stat(archiveAbsolutePath)).size,
      sourceByteCount: sourceReceipt.byteLength,
    };
  }

  async function reconcileJsonlShardSources(
    vaultRoot: string,
    sources: readonly JsonlShardSource[],
    signal: AbortSignal | null,
  ): Promise<{ source: JsonlShardSource; sourceByteCount: number }> {
    const source = sources.find((candidate) => candidate.kind === "brotli") ?? sources[0];
    if (!source) throw new TypeError("Expected an ledger source.");
    if (sources.length === 1) return { source, sourceByteCount: 0 };
    const before = await Promise.all(sources.map((candidate) =>
      fs.stat(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath)
    ));
    const content = await readBoundedJsonlSourceBytes(vaultRoot, source, signal);
    parseJsonlRows(content, source.logicalPath);
    const verified: string[] = [];
    for (const candidate of sources) {
      signal?.throwIfAborted();
      if (candidate === source) continue;
      const bytes = await readBoundedJsonlSourceBytes(vaultRoot, candidate, signal);
      parseJsonlRows(bytes, candidate.logicalPath);
      if (!content.equals(bytes)) {
        throw new VaultError(`${errorPrefix}_SHARD_AMBIGUOUS`, "Ledger representations differ.", {
          relativePath: source.logicalPath,
        });
      }
      verified.push(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath);
    }
    for (const [index, candidate] of sources.entries()) {
      assertJsonlArchiveSourceUnchanged(before[index]!,
        await fs.stat(resolveVaultPath(vaultRoot, candidate.sourcePath).absolutePath), candidate.sourcePath);
    }
    for (const absolutePath of verified) {
      signal?.throwIfAborted();
      await fs.unlink(absolutePath);
    }
    return { source, sourceByteCount: content.byteLength };
  }

  async function archiveClosedJsonlShards(input: {
    now?: Date;
    signal?: AbortSignal | null;
    vaultRoot: string;
  }): Promise<ArchiveClosedJsonlShardsResult> {
    input.signal?.throwIfAborted();
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError("Ledger archive time must be a valid Date.");
    }
    const currentMonth = now.toISOString().slice(0, 7);
    return await withCanonicalWriteLock(input.vaultRoot, async () => {
      input.signal?.throwIfAborted();
      const { relativePaths: paths } = await walkVaultFilesInterruptible(
        input.vaultRoot,
        relativeDirectory,
        { signal: input.signal },
      );
      const groups = new Map<string, JsonlShardSource[]>();
      for (const source of paths.filter(isJsonlSourcePath).map(toJsonlShardSource)) {
        const group = groups.get(source.logicalPath) ?? [];
        group.push(source);
        groups.set(source.logicalPath, group);
      }
      const result: ArchiveClosedJsonlShardsResult = {
        archivedByteCount: 0,
        archivedShardCount: 0,
        blockedShardCount: 0,
        repairedShardCount: 0,
        scannedShardCount: groups.size,
        sourceByteCount: 0,
      };
      for (const [logicalPath, sources] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
        input.signal?.throwIfAborted();
        const month = jsonlShardMonth(logicalPath);
        if (!month || month >= currentMonth) {
          continue;
        }
        try {
          const { source, sourceByteCount } = await reconcileJsonlShardSources(
            input.vaultRoot, sources, input.signal ?? null,
          );
          if (source.kind === "brotli" && sources.length === 1) continue;
          const archived = source.kind === "brotli"
            ? {
                archiveByteCount: (await fs.stat(resolveVaultPath(input.vaultRoot, source.sourcePath).absolutePath)).size,
                sourceByteCount,
              }
            : await archiveJsonlShard(input.vaultRoot, source, input.signal ?? null);
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

  return {
    isJsonlLogicalPath,
    listJsonlShardSources,
    listJsonlShardPaths,
    listJsonlShardPathsInterruptible,
    resolveJsonlShardSource,
    readJsonlShardRows,
    readJsonlShardText,
    readJsonlShardRecords,
    visitJsonlShardRecordsInterruptible,
    createArchivedJsonlShardContentReceipt,
    inspectArchivedJsonlShardAppend,
    appendArchivedJsonlShard,
    truncateArchivedJsonlShard,
    archiveClosedJsonlShards,
  };
}
