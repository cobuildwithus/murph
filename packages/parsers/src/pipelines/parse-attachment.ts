import { promises as fs } from "node:fs";
import path from "node:path";

import {
  normalizeParserArtifactIdentity,
  type ParserArtifactRef,
} from "../contracts/artifact.js";
import type {
  ParseBlockKind,
  ParsedBlock,
  ParsedTable,
  ParseOutputMetadata,
  ParseRequest,
  ParserOutput,
  ProviderRunResult,
} from "../contracts/parse.js";
import type { ParserRegistry } from "../registry/registry.js";
import { prepareAudioInput, type FfmpegToolOptions } from "../adapters/ffmpeg.js";
import {
  buildMarkdown,
  ensureDirectory,
  removeDirectoryIfExists,
  splitTextIntoBlocks,
  toArtifactSummary,
} from "../shared.js";

export interface ParseAttachmentInput {
  artifact: ParserArtifactRef;
  registry: ParserRegistry;
  scratchRoot: string;
  ffmpeg?: FfmpegToolOptions;
}

export interface ParseAttachmentResult {
  providerId: string;
  output: ParserOutput;
}

const MAX_PARSER_TEXT_CHARS = 10 * 1024 * 1024;
const MAX_PARSER_MARKDOWN_CHARS = 15 * 1024 * 1024;
const MAX_PARSER_BLOCKS = 100_000;
const MAX_PARSER_BLOCK_TEXT_CHARS = 20_000;
const MAX_PARSER_TABLES = 100;
const MAX_PARSER_TABLE_ROWS = 1_000;
const MAX_PARSER_TABLE_COLUMNS = 50;
const MAX_PARSER_TABLE_CELL_CHARS = 10_000;
const MAX_PARSER_METADATA_KEYS = 20;
const MAX_PARSER_METADATA_STRING_CHARS = 1_000;
const MAX_PARSER_WARNINGS = 50;
const MAX_PARSER_ID_CHARS = 128;
const PARSE_BLOCK_KINDS = new Set<ParseBlockKind>([
  "heading",
  "line",
  "list_item",
  "page_break",
  "paragraph",
  "segment",
  "table",
]);

export async function parseAttachment(input: ParseAttachmentInput): Promise<ParseAttachmentResult> {
  const artifact = normalizeParserArtifactIdentity(input.artifact);
  const scratchRoot = path.resolve(input.scratchRoot);
  await ensureDirectory(scratchRoot);
  const scratchDirectory = await fs.mkdtemp(path.join(scratchRoot, "attachment-"));

  try {
    const preparedMedia = await prepareAudioInput({
      artifact,
      scratchDirectory,
      ffmpeg: input.ffmpeg,
    });
    const request: ParseRequest = {
      intent: "attachment_text",
      artifact,
      inputPath: preparedMedia.inputPath,
      preparedKind: preparedMedia.preparedKind,
      scratchDirectory,
    };
    const { selection, result } = await input.registry.run(request);
    const output = normalizeParserOutput({
      artifact,
      providerId: selection.provider.id,
      result,
    });

    return {
      providerId: selection.provider.id,
      output,
    };
  } finally {
    await removeDirectoryIfExists(scratchDirectory);
  }
}

function normalizeParserOutput(input: {
  artifact: ParserArtifactRef;
  providerId: string;
  result: ProviderRunResult;
}): ParserOutput {
  const result = normalizeProviderRunResult(input.result);
  const text = result.text.trim();
  const blocks =
    result.blocks && result.blocks.length > 0
      ? result.blocks
      : splitTextIntoBlocks(text, { defaultKind: "paragraph" });
  const markdown = result.markdown?.trim() || buildMarkdown(text, blocks);

  return {
    schema: "murph.parser-output.v1",
    providerId: input.providerId,
    artifact: toArtifactSummary(input.artifact),
    text,
    markdown,
    blocks,
    tables: result.tables ?? [],
    metadata: result.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

function normalizeProviderRunResult(result: ProviderRunResult): ProviderRunResult {
  const record = expectPlainObject(result, "Parser provider result");
  const text = boundedString(record.text, "Parser text", MAX_PARSER_TEXT_CHARS);
  const markdown = record.markdown === undefined || record.markdown === null
    ? null
    : boundedString(record.markdown, "Parser markdown", MAX_PARSER_MARKDOWN_CHARS);

  return {
    text,
    markdown,
    blocks: normalizeBlocks(record.blocks),
    tables: normalizeTables(record.tables),
    metadata: normalizeOutputMetadata(record.metadata),
  };
}

function normalizeBlocks(value: unknown): ParsedBlock[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError("Parser blocks must be an array when provided.");
  }

  if (value.length > MAX_PARSER_BLOCKS) {
    throw new TypeError(`Parser blocks exceed the ${MAX_PARSER_BLOCKS} block limit.`);
  }

  return value.map((entry, index) => {
    const record = expectPlainObject(entry, `Parser block ${index + 1}`);
    const kind = boundedString(record.kind, `Parser block ${index + 1} kind`, MAX_PARSER_ID_CHARS);
    if (!PARSE_BLOCK_KINDS.has(kind as ParseBlockKind)) {
      throw new TypeError(`Parser block ${index + 1} has an unsupported kind.`);
    }

    return stripUndefined({
      id: boundedString(record.id, `Parser block ${index + 1} id`, MAX_PARSER_ID_CHARS),
      kind: kind as ParseBlockKind,
      text: boundedString(record.text, `Parser block ${index + 1} text`, MAX_PARSER_BLOCK_TEXT_CHARS),
      order: nonnegativeInteger(record.order, `Parser block ${index + 1} order`),
      page: optionalNonnegativeInteger(record.page, `Parser block ${index + 1} page`),
      startMs: optionalNonnegativeNumber(record.startMs, `Parser block ${index + 1} startMs`),
      endMs: optionalNonnegativeNumber(record.endMs, `Parser block ${index + 1} endMs`),
      confidence: optionalConfidence(record.confidence, `Parser block ${index + 1} confidence`),
      metadata: normalizeScalarMetadata(record.metadata, `Parser block ${index + 1} metadata`),
    }) satisfies ParsedBlock;
  });
}

function normalizeTables(value: unknown): ParsedTable[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError("Parser tables must be an array when provided.");
  }

  if (value.length > MAX_PARSER_TABLES) {
    throw new TypeError(`Parser tables exceed the ${MAX_PARSER_TABLES} table limit.`);
  }

  return value.map((entry, index) => {
    const record = expectPlainObject(entry, `Parser table ${index + 1}`);
    const rows = record.rows;
    if (!Array.isArray(rows)) {
      throw new TypeError(`Parser table ${index + 1} rows must be an array.`);
    }
    if (rows.length > MAX_PARSER_TABLE_ROWS) {
      throw new TypeError(`Parser table ${index + 1} exceeds the ${MAX_PARSER_TABLE_ROWS} row limit.`);
    }

    return stripUndefined({
      id: boundedString(record.id, `Parser table ${index + 1} id`, MAX_PARSER_ID_CHARS),
      page: optionalNonnegativeInteger(record.page, `Parser table ${index + 1} page`),
      rows: rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new TypeError(`Parser table ${index + 1} row ${rowIndex + 1} must be an array.`);
        }
        if (row.length > MAX_PARSER_TABLE_COLUMNS) {
          throw new TypeError(
            `Parser table ${index + 1} row ${rowIndex + 1} exceeds the ${MAX_PARSER_TABLE_COLUMNS} column limit.`,
          );
        }
        return row.map((cell, cellIndex) =>
          boundedString(
            cell,
            `Parser table ${index + 1} row ${rowIndex + 1} cell ${cellIndex + 1}`,
            MAX_PARSER_TABLE_CELL_CHARS,
          )
        );
      }),
    }) satisfies ParsedTable;
  });
}

function normalizeOutputMetadata(value: unknown): ParseOutputMetadata {
  if (value === undefined) {
    return {};
  }

  const record = expectPlainObject(value, "Parser metadata");
  const allowedKeys = new Set(["language", "pageCount", "durationMs", "warnings"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Parser metadata field "${key}" is not supported.`);
    }
  }

  return stripUndefined({
    language: optionalBoundedString(record.language, "Parser metadata language", 64),
    pageCount: optionalNonnegativeInteger(record.pageCount, "Parser metadata pageCount"),
    durationMs: optionalNonnegativeNumber(record.durationMs, "Parser metadata durationMs"),
    warnings: normalizeWarnings(record.warnings),
  });
}

function normalizeWarnings(value: unknown): ParseOutputMetadata["warnings"] {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError("Parser metadata warnings must be an array when provided.");
  }
  if (value.length > MAX_PARSER_WARNINGS) {
    throw new TypeError(`Parser metadata warnings exceed the ${MAX_PARSER_WARNINGS} warning limit.`);
  }

  return value.map((entry, index) => {
    const record = expectPlainObject(entry, `Parser warning ${index + 1}`);
    return {
      code: boundedString(record.code, `Parser warning ${index + 1} code`, 64),
      message: boundedString(record.message, `Parser warning ${index + 1} message`, 500),
    };
  });
}

function normalizeScalarMetadata(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = expectPlainObject(value, label);
  const entries = Object.entries(record);
  if (entries.length > MAX_PARSER_METADATA_KEYS) {
    throw new TypeError(`${label} exceeds the ${MAX_PARSER_METADATA_KEYS} key limit.`);
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > MAX_PARSER_ID_CHARS) {
      throw new TypeError(`${label} contains an invalid metadata key.`);
    }
    if (entry === null || typeof entry === "boolean") {
      output[key] = entry;
      continue;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      output[key] = entry;
      continue;
    }
    if (typeof entry === "string" && entry.length <= MAX_PARSER_METADATA_STRING_CHARS) {
      output[key] = entry;
      continue;
    }
    throw new TypeError(`${label} contains an unsupported metadata value.`);
  }

  return output;
}

function expectPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new TypeError(`${label} exceeds the ${maxLength} character limit.`);
  }
  return value;
}

function optionalBoundedString(value: unknown, label: string, maxLength: number): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return boundedString(value, label, maxLength);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function optionalNonnegativeInteger(value: unknown, label: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return nonnegativeInteger(value, label);
}

function optionalNonnegativeNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function optionalConfidence(value: unknown, label: string): number | null | undefined {
  const confidence = optionalNonnegativeNumber(value, label);
  if (typeof confidence === "number" && confidence > 1) {
    throw new TypeError(`${label} must be between 0 and 1.`);
  }
  return confidence;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
