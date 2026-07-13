import { promises as fs, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { normalizeParserArtifactId } from "../contracts/artifact.js";
import { decodeParserOutput } from "../contracts/parser-output.js";
import type { ParserOutput } from "../contracts/parse.js";
import { resolveVaultRelativePath } from "../shared.js";
import {
  PARSER_DERIVED_INBOX_ROOT,
  PARSER_RESULT_FILE_NAME,
  createParserResultFileAtomic,
  parseParserAttemptDirectoryPath,
  readParserResult,
} from "./writer.js";

export type LegacyParserAttemptCompactionReason =
  | "already_compacted"
  | "incomplete_legacy_attempt"
  | "invalid_attempt_path"
  | "invalid_legacy_artifact"
  | "invalid_legacy_manifest"
  | "legacy_path_mismatch"
  | "result_mismatch"
  | "unexpected_attempt_entry"
  | "unsafe_filesystem_entry";

export interface CompactLegacyParserAttemptsInput {
  vaultRoot: string;
  apply?: boolean;
  maxAttempts?: number;
}

export interface LegacyParserAttemptCompactionResult {
  mode: "apply" | "dry-run";
  mutated: boolean;
  scannedAttemptCount: number;
  eligibleAttemptCount: number;
  compactedAttemptCount: number;
  deletedFileCount: number;
  hasMore: boolean;
  reasons: Record<LegacyParserAttemptCompactionReason, number>;
}

interface LegacyAttemptSnapshot {
  legacySidecarPaths: string[];
  manifestPath: string;
  output: ParserOutput;
}

const LEGACY_MANIFEST_FILE_NAME = "manifest.json";
const LEGACY_PLAIN_TEXT_FILE_NAME = "plain.txt";
const LEGACY_MARKDOWN_FILE_NAME = "normalized.md";
const LEGACY_CHUNKS_FILE_NAME = "chunks.jsonl";
const LEGACY_TABLES_FILE_NAME = "tables.json";
const LEGACY_FILE_NAMES = new Set([
  LEGACY_MANIFEST_FILE_NAME,
  LEGACY_PLAIN_TEXT_FILE_NAME,
  LEGACY_MARKDOWN_FILE_NAME,
  LEGACY_CHUNKS_FILE_NAME,
  LEGACY_TABLES_FILE_NAME,
  PARSER_RESULT_FILE_NAME,
]);

const MAX_LEGACY_MANIFEST_BYTES = 1024 * 1024;
const MAX_LEGACY_PLAIN_TEXT_BYTES = 40 * 1024 * 1024;
const MAX_LEGACY_MARKDOWN_BYTES = 60 * 1024 * 1024;
const MAX_LEGACY_CHUNKS_BYTES = 128 * 1024 * 1024;
const MAX_LEGACY_TABLES_BYTES = 64 * 1024 * 1024;

class LegacyAttemptBlocked extends Error {
  constructor(readonly reason: LegacyParserAttemptCompactionReason) {
    super(reason);
    this.name = "LegacyAttemptBlocked";
  }
}

export async function compactLegacyParserAttempts(
  input: CompactLegacyParserAttemptsInput,
): Promise<LegacyParserAttemptCompactionResult> {
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const result: LegacyParserAttemptCompactionResult = {
    mode: input.apply === true ? "apply" : "dry-run",
    mutated: false,
    scannedAttemptCount: 0,
    eligibleAttemptCount: 0,
    compactedAttemptCount: 0,
    deletedFileCount: 0,
    hasMore: false,
    reasons: createReasonCounts(),
  };

  const attemptDirectoryPaths = await listAttemptDirectoryPaths(input.vaultRoot, result.reasons);
  for (const attemptDirectoryPath of attemptDirectoryPaths) {
    result.scannedAttemptCount += 1;

    try {
      const identity = parseParserAttemptDirectoryPath(attemptDirectoryPath);
      const resultExists = await pathEntryExists(input.vaultRoot, identity.resultPath);
      const existingResult = resultExists
        ? await readExistingResult(input.vaultRoot, identity.resultPath)
        : undefined;
      const snapshot = await readLegacyAttemptSnapshot(
        input.vaultRoot,
        attemptDirectoryPath,
        existingResult,
      );

      result.eligibleAttemptCount += 1;
      if (result.eligibleAttemptCount > maxAttempts) {
        result.hasMore = true;
      }
      if (result.mode === "dry-run") {
        continue;
      }
      if (result.compactedAttemptCount >= maxAttempts) {
        continue;
      }

      if (!resultExists) {
        await createParserResultFileAtomic({
          vaultRoot: input.vaultRoot,
          resultPath: identity.resultPath,
          output: snapshot.output,
        });
      }

      const persistedResult = await readExistingResult(input.vaultRoot, identity.resultPath);
      if (!isDeepStrictEqual(persistedResult, snapshot.output)) {
        block("result_mismatch");
      }

      const rereadSnapshot = await readLegacyAttemptSnapshot(
        input.vaultRoot,
        attemptDirectoryPath,
        persistedResult,
      );
      if (!isDeepStrictEqual(rereadSnapshot.output, persistedResult)) {
        block("result_mismatch");
      }

      for (const legacyPath of rereadSnapshot.legacySidecarPaths) {
        await unlinkExactRegularFile(input.vaultRoot, legacyPath);
        result.deletedFileCount += 1;
      }
      await unlinkExactRegularFile(input.vaultRoot, rereadSnapshot.manifestPath);
      result.deletedFileCount += 1;

      result.compactedAttemptCount += 1;
      result.mutated = true;
    } catch (error) {
      if (!(error instanceof LegacyAttemptBlocked)) {
        throw error;
      }
      result.reasons[error.reason] += 1;
    }
  }

  return result;
}

function normalizeMaxAttempts(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 100)
    : 100;
}

async function listAttemptDirectoryPaths(
  vaultRoot: string,
  reasons: Record<LegacyParserAttemptCompactionReason, number>,
): Promise<string[]> {
  const attempts: string[] = [];
  const captureEntries = await readDirectoryEntriesIfPresent(vaultRoot, PARSER_DERIVED_INBOX_ROOT);

  for (const captureEntry of captureEntries) {
    if (captureEntry.isSymbolicLink()) {
      reasons.unsafe_filesystem_entry += 1;
      continue;
    }
    if (!captureEntry.isDirectory()) {
      continue;
    }

    try {
      normalizeParserArtifactId(captureEntry.name, "captureId");
    } catch {
      reasons.invalid_attempt_path += 1;
      continue;
    }

    const capturePath = path.posix.join(PARSER_DERIVED_INBOX_ROOT, captureEntry.name);
    const attachmentsPath = path.posix.join(capturePath, "attachments");
    const attachmentEntries = await readDirectoryEntriesIfPresent(vaultRoot, attachmentsPath);

    for (const attachmentEntry of attachmentEntries) {
      if (attachmentEntry.isSymbolicLink()) {
        reasons.unsafe_filesystem_entry += 1;
        continue;
      }
      if (!attachmentEntry.isDirectory()) {
        continue;
      }

      try {
        normalizeParserArtifactId(attachmentEntry.name, "attachmentId");
      } catch {
        reasons.invalid_attempt_path += 1;
        continue;
      }

      const attemptsPath = path.posix.join(
        attachmentsPath,
        attachmentEntry.name,
        "attempts",
      );
      const attemptEntries = await readDirectoryEntriesIfPresent(vaultRoot, attemptsPath);
      for (const attemptEntry of attemptEntries) {
        if (attemptEntry.isSymbolicLink()) {
          reasons.unsafe_filesystem_entry += 1;
          continue;
        }
        if (!attemptEntry.isDirectory()) {
          reasons.unexpected_attempt_entry += 1;
          continue;
        }

        const attemptPath = path.posix.join(attemptsPath, attemptEntry.name);
        try {
          parseParserAttemptDirectoryPath(attemptPath);
          attempts.push(attemptPath);
        } catch {
          reasons.invalid_attempt_path += 1;
        }
      }
    }
  }

  return attempts.sort((left, right) => left.localeCompare(right));
}

async function readLegacyAttemptSnapshot(
  vaultRoot: string,
  attemptDirectoryPath: string,
  existingResult?: ParserOutput,
): Promise<LegacyAttemptSnapshot> {
  const identity = parseParserAttemptDirectoryPath(attemptDirectoryPath);
  const entries = await readDirectoryEntries(vaultRoot, attemptDirectoryPath);

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      block("unsafe_filesystem_entry");
    }
    if (!LEGACY_FILE_NAMES.has(entry.name)) {
      block("unexpected_attempt_entry");
    }
  }

  const entryNames = new Set(entries.map((entry) => entry.name));
  if (!entryNames.has(LEGACY_MANIFEST_FILE_NAME)) {
    if (entryNames.size === 1 && entryNames.has(PARSER_RESULT_FILE_NAME)) {
      block("already_compacted");
    }
    block("incomplete_legacy_attempt");
  }

  const manifestPath = path.posix.join(attemptDirectoryPath, LEGACY_MANIFEST_FILE_NAME);
  const manifest = await readJsonFile(
    vaultRoot,
    manifestPath,
    MAX_LEGACY_MANIFEST_BYTES,
    "invalid_legacy_manifest",
  );
  const manifestRecord = expectExactObject(
    manifest,
    ["artifact", "createdAt", "metadata", "paths", "providerId", "schema"],
    "invalid_legacy_manifest",
  );
  if (manifestRecord.schema !== "murph.parser-manifest.v1") {
    block("invalid_legacy_manifest");
  }

  const pathsRecord = expectExactObject(
    manifestRecord.paths,
    ["chunksPath", "markdownPath", "plainTextPath", "tablesPath"],
    "invalid_legacy_manifest",
  );
  const expectedPlainTextPath = path.posix.join(attemptDirectoryPath, LEGACY_PLAIN_TEXT_FILE_NAME);
  const expectedMarkdownPath = path.posix.join(attemptDirectoryPath, LEGACY_MARKDOWN_FILE_NAME);
  const expectedChunksPath = path.posix.join(attemptDirectoryPath, LEGACY_CHUNKS_FILE_NAME);
  const expectedTablesPath = path.posix.join(attemptDirectoryPath, LEGACY_TABLES_FILE_NAME);

  assertExactLegacyPath(pathsRecord.plainTextPath, expectedPlainTextPath);
  assertExactLegacyPath(pathsRecord.markdownPath, expectedMarkdownPath);
  assertExactLegacyPath(pathsRecord.chunksPath, expectedChunksPath);

  const hasTables = pathsRecord.tablesPath !== null;
  if (hasTables) {
    assertExactLegacyPath(pathsRecord.tablesPath, expectedTablesPath);
  }

  const sidecarNames = [
    LEGACY_PLAIN_TEXT_FILE_NAME,
    LEGACY_MARKDOWN_FILE_NAME,
    LEGACY_CHUNKS_FILE_NAME,
    ...(hasTables ? [LEGACY_TABLES_FILE_NAME] : []),
  ];
  if (existingResult === undefined) {
    for (const sidecarName of sidecarNames) {
      if (!entryNames.has(sidecarName)) {
        block("incomplete_legacy_attempt");
      }
    }
  }
  if (!hasTables && entryNames.has(LEGACY_TABLES_FILE_NAME)) {
    block("unexpected_attempt_entry");
  }

  if (existingResult !== undefined) {
    if (
      manifestRecord.providerId !== existingResult.providerId ||
      manifestRecord.createdAt !== existingResult.createdAt ||
      !isDeepStrictEqual(manifestRecord.artifact, existingResult.artifact) ||
      !isDeepStrictEqual(manifestRecord.metadata, existingResult.metadata) ||
      hasTables !== (existingResult.tables.length > 0)
    ) {
      block("result_mismatch");
    }
  }

  const text = entryNames.has(LEGACY_PLAIN_TEXT_FILE_NAME)
    ? decodeCanonicalLegacyText(
      await readBoundedUtf8File(
        vaultRoot,
        expectedPlainTextPath,
        MAX_LEGACY_PLAIN_TEXT_BYTES,
        "invalid_legacy_artifact",
      ),
    )
    : existingResult?.text;
  const markdown = entryNames.has(LEGACY_MARKDOWN_FILE_NAME)
    ? decodeCanonicalLegacyText(
      await readBoundedUtf8File(
        vaultRoot,
        expectedMarkdownPath,
        MAX_LEGACY_MARKDOWN_BYTES,
        "invalid_legacy_artifact",
      ),
    )
    : existingResult?.markdown;
  const blocks = entryNames.has(LEGACY_CHUNKS_FILE_NAME)
    ? decodeLegacyChunks(
      await readBoundedUtf8File(
        vaultRoot,
        expectedChunksPath,
        MAX_LEGACY_CHUNKS_BYTES,
        "invalid_legacy_artifact",
      ),
    )
    : existingResult?.blocks;
  const tables = hasTables
    ? entryNames.has(LEGACY_TABLES_FILE_NAME)
      ? decodeLegacyTables(
        await readBoundedUtf8File(
          vaultRoot,
          expectedTablesPath,
          MAX_LEGACY_TABLES_BYTES,
          "invalid_legacy_artifact",
        ),
      )
      : existingResult?.tables
    : [];

  if (
    text === undefined ||
    markdown === undefined ||
    blocks === undefined ||
    tables === undefined
  ) {
    block("incomplete_legacy_attempt");
  }

  if (
    existingResult !== undefined &&
    (
      text !== existingResult.text ||
      markdown !== existingResult.markdown ||
      !isDeepStrictEqual(blocks, existingResult.blocks) ||
      !isDeepStrictEqual(tables, existingResult.tables)
    )
  ) {
    block("result_mismatch");
  }

  let output: ParserOutput;
  if (existingResult !== undefined) {
    output = existingResult;
  } else {
    try {
      output = decodeParserOutput({
        schema: "murph.parser-output.v1",
        providerId: manifestRecord.providerId,
        artifact: manifestRecord.artifact,
        text,
        markdown,
        blocks,
        tables,
        metadata: manifestRecord.metadata,
        createdAt: manifestRecord.createdAt,
      });
    } catch {
      block("invalid_legacy_artifact");
    }
  }

  if (
    output.artifact.captureId !== identity.captureId ||
    output.artifact.attachmentId !== identity.attachmentId
  ) {
    block("legacy_path_mismatch");
  }

  return {
    output,
    legacySidecarPaths: [
      ...(entryNames.has(LEGACY_PLAIN_TEXT_FILE_NAME) ? [expectedPlainTextPath] : []),
      ...(entryNames.has(LEGACY_MARKDOWN_FILE_NAME) ? [expectedMarkdownPath] : []),
      ...(entryNames.has(LEGACY_CHUNKS_FILE_NAME) ? [expectedChunksPath] : []),
      ...(entryNames.has(LEGACY_TABLES_FILE_NAME) ? [expectedTablesPath] : []),
    ],
    manifestPath,
  };
}

async function readExistingResult(vaultRoot: string, resultPath: string): Promise<ParserOutput> {
  try {
    return await readParserResult({ vaultRoot, resultPath });
  } catch {
    block("result_mismatch");
  }
}

async function unlinkExactRegularFile(vaultRoot: string, relativePath: string): Promise<void> {
  const absolutePath = await resolveSafePath(vaultRoot, relativePath);
  let stats: Stats;
  try {
    stats = await fs.lstat(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      block("already_compacted");
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    block("unsafe_filesystem_entry");
  }
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      block("already_compacted");
    }
    throw error;
  }
}

async function pathEntryExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  const absolutePath = await resolveSafePath(vaultRoot, relativePath);
  try {
    await fs.lstat(absolutePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readDirectoryEntriesIfPresent(
  vaultRoot: string,
  relativePath: string,
): Promise<Dirent[]> {
  const absolutePath = await resolveSafePath(vaultRoot, relativePath);
  try {
    const stats = await fs.lstat(absolutePath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return [];
    }
    return await fs.readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readDirectoryEntries(
  vaultRoot: string,
  relativePath: string,
): Promise<Dirent[]> {
  const absolutePath = await resolveSafePath(vaultRoot, relativePath);
  const stats = await lstatOrBlock(absolutePath, "incomplete_legacy_attempt");
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    block("unsafe_filesystem_entry");
  }
  return fs.readdir(absolutePath, { withFileTypes: true });
}

async function readJsonFile(
  vaultRoot: string,
  relativePath: string,
  maxBytes: number,
  reason: LegacyParserAttemptCompactionReason,
): Promise<unknown> {
  const content = await readBoundedUtf8File(vaultRoot, relativePath, maxBytes, reason);
  try {
    return JSON.parse(content);
  } catch {
    block(reason);
  }
}

async function readBoundedUtf8File(
  vaultRoot: string,
  relativePath: string,
  maxBytes: number,
  reason: LegacyParserAttemptCompactionReason,
): Promise<string> {
  const absolutePath = await resolveSafePath(vaultRoot, relativePath);
  const stats = await lstatOrBlock(absolutePath, reason);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    block(stats.isSymbolicLink() ? "unsafe_filesystem_entry" : reason);
  }
  const content = await fs.readFile(absolutePath, "utf8");
  await resolveSafePath(vaultRoot, relativePath);
  return content;
}

async function resolveSafePath(vaultRoot: string, relativePath: string): Promise<string> {
  try {
    return await resolveVaultRelativePath(vaultRoot, relativePath);
  } catch {
    block("unsafe_filesystem_entry");
  }
}

async function lstatOrBlock(
  absolutePath: string,
  reason: LegacyParserAttemptCompactionReason,
): Promise<Stats> {
  try {
    return await fs.lstat(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      block(reason);
    }
    throw error;
  }
}

function decodeCanonicalLegacyText(content: string): string {
  const text = content.trim();
  if (content !== `${text}\n`) {
    block("invalid_legacy_artifact");
  }
  return text;
}

function decodeLegacyChunks(content: string): unknown[] {
  if (content.length === 0) {
    return [];
  }
  if (!content.endsWith("\n")) {
    block("invalid_legacy_artifact");
  }

  const lines = content.slice(0, -1).split("\n");
  const blocks: unknown[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      block("invalid_legacy_artifact");
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      block("invalid_legacy_artifact");
    }
    if (line !== JSON.stringify(value)) {
      block("invalid_legacy_artifact");
    }
    blocks.push(value);
  }
  return blocks;
}

function decodeLegacyTables(content: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    block("invalid_legacy_artifact");
  }
  if (content !== `${JSON.stringify(value, null, 2)}\n`) {
    block("invalid_legacy_artifact");
  }
  return value;
}

function assertExactLegacyPath(value: unknown, expectedPath: string): void {
  if (value !== expectedPath) {
    block("legacy_path_mismatch");
  }
}

function expectExactObject(
  value: unknown,
  expectedKeys: readonly string[],
  reason: LegacyParserAttemptCompactionReason,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    block(reason);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  const expected = [...expectedKeys].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(keys, expected)) {
    block(reason);
  }
  return record;
}

function createReasonCounts(): Record<LegacyParserAttemptCompactionReason, number> {
  return {
    already_compacted: 0,
    incomplete_legacy_attempt: 0,
    invalid_attempt_path: 0,
    invalid_legacy_artifact: 0,
    invalid_legacy_manifest: 0,
    legacy_path_mismatch: 0,
    result_mismatch: 0,
    unexpected_attempt_entry: 0,
    unsafe_filesystem_entry: 0,
  };
}

function block(reason: LegacyParserAttemptCompactionReason): never {
  throw new LegacyAttemptBlocked(reason);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
