import { normalizeRelativeVaultPath } from "@murphai/core";

import {
  normalizeParserArtifactIdentity,
  type ParserArtifactKind,
  type ParserArtifactSummary,
} from "./artifact.js";
import type {
  ParseBlockKind,
  ParsedBlock,
  ParsedTable,
  ParseOutputMetadata,
  ParserOutput,
} from "./parse.js";

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
const PARSER_ARTIFACT_KINDS = new Set<ParserArtifactKind>([
  "audio",
  "document",
  "image",
  "other",
  "video",
]);

export function decodeParserOutput(value: unknown): ParserOutput {
  const record = expectExactPlainObject(value, "Parser result", [
    "artifact",
    "blocks",
    "createdAt",
    "markdown",
    "metadata",
    "providerId",
    "schema",
    "tables",
    "text",
  ]);
  if (record.schema !== "murph.parser-output.v1") {
    throw new TypeError("Parser result has an unsupported schema.");
  }

  const createdAt = boundedString(record.createdAt, "Parser result createdAt", 64);
  if (!isCanonicalIsoTimestamp(createdAt)) {
    throw new TypeError("Parser result createdAt must be a canonical ISO timestamp.");
  }

  return {
    schema: "murph.parser-output.v1",
    providerId: nonemptyBoundedString(record.providerId, "Parser provider ID", MAX_PARSER_ID_CHARS),
    artifact: decodeArtifactSummary(record.artifact),
    text: boundedString(record.text, "Parser text", MAX_PARSER_TEXT_CHARS),
    markdown: boundedString(record.markdown, "Parser markdown", MAX_PARSER_MARKDOWN_CHARS),
    blocks: decodeBlocks(record.blocks),
    tables: decodeTables(record.tables),
    metadata: decodeOutputMetadata(record.metadata),
    createdAt,
  };
}

function decodeArtifactSummary(value: unknown): ParserArtifactSummary {
  const record = expectExactPlainObject(value, "Parser artifact", [
    "attachmentId",
    "captureId",
    "fileName",
    "kind",
    "mime",
    "storedPath",
  ], ["fileName", "mime"]);
  const kind = boundedString(record.kind, "Parser artifact kind", 32);
  if (!PARSER_ARTIFACT_KINDS.has(kind as ParserArtifactKind)) {
    throw new TypeError("Parser artifact has an unsupported kind.");
  }

  const artifact = normalizeParserArtifactIdentity({
    captureId: boundedString(record.captureId, "Parser capture ID", MAX_PARSER_ID_CHARS),
    attachmentId: boundedString(record.attachmentId, "Parser attachment ID", MAX_PARSER_ID_CHARS),
    kind: kind as ParserArtifactKind,
    mime: optionalBoundedString(record.mime, "Parser artifact MIME type", 512),
    fileName: optionalBoundedString(record.fileName, "Parser artifact file name", 1_024),
    storedPath: normalizeStoredPath(record.storedPath),
  });

  return stripUndefined(artifact);
}

function decodeBlocks(value: unknown): ParsedBlock[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Parser blocks must be an array.");
  }
  if (value.length > MAX_PARSER_BLOCKS) {
    throw new TypeError(`Parser blocks exceed the ${MAX_PARSER_BLOCKS} block limit.`);
  }

  return value.map((entry, index) => {
    const label = `Parser block ${index + 1}`;
    const record = expectExactPlainObject(entry, label, [
      "confidence",
      "endMs",
      "id",
      "kind",
      "metadata",
      "order",
      "page",
      "startMs",
      "text",
    ], ["confidence", "endMs", "metadata", "page", "startMs"]);
    const kind = boundedString(record.kind, `${label} kind`, MAX_PARSER_ID_CHARS);
    if (!PARSE_BLOCK_KINDS.has(kind as ParseBlockKind)) {
      throw new TypeError(`${label} has an unsupported kind.`);
    }

    return stripUndefined({
      id: boundedString(record.id, `${label} id`, MAX_PARSER_ID_CHARS),
      kind: kind as ParseBlockKind,
      text: boundedString(record.text, `${label} text`, MAX_PARSER_BLOCK_TEXT_CHARS),
      order: nonnegativeInteger(record.order, `${label} order`),
      page: optionalNonnegativeInteger(record.page, `${label} page`),
      startMs: optionalNonnegativeNumber(record.startMs, `${label} startMs`),
      endMs: optionalNonnegativeNumber(record.endMs, `${label} endMs`),
      confidence: optionalConfidence(record.confidence, `${label} confidence`),
      metadata: decodeScalarMetadata(record.metadata, `${label} metadata`),
    }) satisfies ParsedBlock;
  });
}

function decodeTables(value: unknown): ParsedTable[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Parser tables must be an array.");
  }
  if (value.length > MAX_PARSER_TABLES) {
    throw new TypeError(`Parser tables exceed the ${MAX_PARSER_TABLES} table limit.`);
  }

  return value.map((entry, index) => {
    const label = `Parser table ${index + 1}`;
    const record = expectExactPlainObject(entry, label, ["id", "page", "rows"], ["page"]);
    if (!Array.isArray(record.rows)) {
      throw new TypeError(`${label} rows must be an array.`);
    }
    if (record.rows.length > MAX_PARSER_TABLE_ROWS) {
      throw new TypeError(`${label} exceeds the ${MAX_PARSER_TABLE_ROWS} row limit.`);
    }

    return stripUndefined({
      id: boundedString(record.id, `${label} id`, MAX_PARSER_ID_CHARS),
      page: optionalNonnegativeInteger(record.page, `${label} page`),
      rows: record.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new TypeError(`${label} row ${rowIndex + 1} must be an array.`);
        }
        if (row.length > MAX_PARSER_TABLE_COLUMNS) {
          throw new TypeError(
            `${label} row ${rowIndex + 1} exceeds the ${MAX_PARSER_TABLE_COLUMNS} column limit.`,
          );
        }
        return row.map((cell, cellIndex) => boundedString(
          cell,
          `${label} row ${rowIndex + 1} cell ${cellIndex + 1}`,
          MAX_PARSER_TABLE_CELL_CHARS,
        ));
      }),
    }) satisfies ParsedTable;
  });
}

function decodeOutputMetadata(value: unknown): ParseOutputMetadata {
  const record = expectExactPlainObject(value, "Parser metadata", [
    "durationMs",
    "language",
    "pageCount",
    "warnings",
  ], ["durationMs", "language", "pageCount", "warnings"]);

  return stripUndefined({
    language: optionalBoundedString(record.language, "Parser metadata language", 64),
    pageCount: optionalNonnegativeInteger(record.pageCount, "Parser metadata pageCount"),
    durationMs: optionalNonnegativeNumber(record.durationMs, "Parser metadata durationMs"),
    warnings: decodeWarnings(record.warnings),
  });
}

function decodeWarnings(value: unknown): ParseOutputMetadata["warnings"] {
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
    const label = `Parser warning ${index + 1}`;
    const record = expectExactPlainObject(entry, label, ["code", "message"]);
    return {
      code: boundedString(record.code, `${label} code`, 64),
      message: boundedString(record.message, `${label} message`, 500),
    };
  });
}

function decodeScalarMetadata(value: unknown, label: string): Record<string, unknown> | undefined {
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

function normalizeStoredPath(value: unknown): string {
  const storedPath = boundedString(value, "Parser artifact stored path", 4_096);
  try {
    return normalizeRelativeVaultPath(storedPath);
  } catch (error) {
    throw new TypeError(error instanceof Error ? error.message : "Parser artifact stored path is invalid.");
  }
}

function expectExactPlainObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = expectPlainObject(value, label);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} field "${key}" is not supported.`);
    }
  }
  for (const key of allowed) {
    if (!optional.has(key) && !(key in record)) {
      throw new TypeError(`${label} is missing field "${key}".`);
    }
  }

  return record;
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

function nonemptyBoundedString(value: unknown, label: string, maxLength: number): string {
  const result = boundedString(value, label, maxLength);
  if (result.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
  return result;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null | undefined {
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

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
