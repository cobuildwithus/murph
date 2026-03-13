import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  parseFrontmatterDocument,
  type MarkdownDocumentRecord,
} from "./shared.js";

export interface ParseFailure {
  ok: false;
  parser: "json" | "frontmatter";
  relativePath: string;
  reason: string;
  lineNumber?: number;
}

export interface JsonlRecordSuccess {
  ok: true;
  relativePath: string;
  lineNumber: number;
  value: unknown;
}

export interface MarkdownDocumentSuccess {
  ok: true;
  relativePath: string;
  document: MarkdownDocumentRecord;
}

export type JsonlRecordOutcome = JsonlRecordSuccess | ParseFailure;
export type MarkdownDocumentOutcome = MarkdownDocumentSuccess | ParseFailure;

function explainParseError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

function buildMarkdownDocument(
  relativePath: string,
  markdown: string,
): MarkdownDocumentRecord {
  const parsed = parseFrontmatterDocument(markdown);

  return {
    relativePath,
    markdown,
    body: parsed.body,
    attributes: parsed.attributes,
  };
}

function buildJsonParseFailure(
  relativePath: string,
  lineNumber: number,
  error: unknown,
): ParseFailure {
  return {
    ok: false,
    parser: "json",
    relativePath,
    reason: explainParseError(error),
    lineNumber,
  };
}

function buildFrontmatterParseFailure(
  relativePath: string,
  error: unknown,
): ParseFailure {
  return {
    ok: false,
    parser: "frontmatter",
    relativePath,
    reason: explainParseError(error),
  };
}

function toStrictParseError(failure: ParseFailure): Error {
  if (failure.parser === "json") {
    return new Error(
      `Failed to parse JSONL at ${failure.relativePath}:${failure.lineNumber ?? 0}: ${failure.reason}`,
    );
  }

  return new Error(
    `Failed to parse frontmatter at ${failure.relativePath}: ${failure.reason}`,
  );
}

export async function walkRelativeFiles(
  vaultRoot: string,
  relativeRoot: string,
  extension: string,
): Promise<string[]> {
  const basePath = path.join(vaultRoot, relativeRoot);
  let entries;

  try {
    entries = await readdir(basePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkRelativeFiles(vaultRoot, relativePath, extension)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(relativePath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

export function walkRelativeFilesSync(
  vaultRoot: string,
  relativeRoot: string,
  extension: string,
): string[] {
  const basePath = path.join(vaultRoot, relativeRoot);
  let entries;

  try {
    entries = readdirSync(basePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkRelativeFilesSync(vaultRoot, relativePath, extension));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(relativePath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

export async function readMarkdownDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<MarkdownDocumentRecord> {
  const outcome = await readMarkdownDocumentOutcome(vaultRoot, relativePath);
  if (!outcome.ok) {
    throw toStrictParseError(outcome);
  }

  return outcome.document;
}

export async function readOptionalMarkdownDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<MarkdownDocumentRecord | null> {
  const outcome = await readOptionalMarkdownDocumentOutcome(vaultRoot, relativePath);
  if (!outcome) {
    return null;
  }

  if (!outcome.ok) {
    throw toStrictParseError(outcome);
  }

  return outcome.document;
}

export async function readOptionalMarkdownDocumentOutcome(
  vaultRoot: string,
  relativePath: string,
): Promise<MarkdownDocumentOutcome | null> {
  const absolutePath = path.join(vaultRoot, relativePath);
  let markdown: string;

  try {
    markdown = await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  try {
    return {
      ok: true,
      relativePath,
      document: buildMarkdownDocument(relativePath, markdown),
    };
  } catch (error) {
    return buildFrontmatterParseFailure(relativePath, error);
  }
}

export function readOptionalMarkdownDocumentOutcomeSync(
  vaultRoot: string,
  relativePath: string,
): MarkdownDocumentOutcome | null {
  const absolutePath = path.join(vaultRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  const markdown = readFileSync(absolutePath, "utf8");

  try {
    return {
      ok: true,
      relativePath,
      document: buildMarkdownDocument(relativePath, markdown),
    };
  } catch (error) {
    return buildFrontmatterParseFailure(relativePath, error);
  }
}

export async function readMarkdownDocumentOutcome(
  vaultRoot: string,
  relativePath: string,
): Promise<MarkdownDocumentOutcome> {
  const outcome = await readOptionalMarkdownDocumentOutcome(vaultRoot, relativePath);
  if (!outcome) {
    throw new Error(`Missing markdown document at ${relativePath}`);
  }

  return outcome;
}

export function readMarkdownDocumentOutcomeSync(
  vaultRoot: string,
  relativePath: string,
): MarkdownDocumentOutcome {
  const outcome = readOptionalMarkdownDocumentOutcomeSync(vaultRoot, relativePath);
  if (!outcome) {
    throw new Error(`Missing markdown document at ${relativePath}`);
  }

  return outcome;
}

export async function readJsonlRecords(
  vaultRoot: string,
  relativeRoot: string,
): Promise<Array<{ relativePath: string; value: unknown }>> {
  const outcomes = await readJsonlRecordOutcomes(vaultRoot, relativeRoot);
  const records: Array<{ relativePath: string; value: unknown }> = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      throw toStrictParseError(outcome);
    }

    records.push({
      relativePath: outcome.relativePath,
      value: outcome.value,
    });
  }

  return records;
}

export async function readJsonlRecordOutcomes(
  vaultRoot: string,
  relativeRoot: string,
): Promise<JsonlRecordOutcome[]> {
  const shardPaths = await walkRelativeFiles(vaultRoot, relativeRoot, ".jsonl");
  const records: JsonlRecordOutcome[] = [];

  for (const relativePath of shardPaths) {
    const absolutePath = path.join(vaultRoot, relativePath);
    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/u);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        records.push({
          ok: true,
          relativePath,
          lineNumber: index + 1,
          value: JSON.parse(line) as unknown,
        });
      } catch (error) {
        records.push(buildJsonParseFailure(relativePath, index + 1, error));
      }
    }
  }

  return records;
}

export function readJsonlRecordOutcomesSync(
  vaultRoot: string,
  relativeRoot: string,
): JsonlRecordOutcome[] {
  const shardPaths = walkRelativeFilesSync(vaultRoot, relativeRoot, ".jsonl");
  const records: JsonlRecordOutcome[] = [];

  for (const relativePath of shardPaths) {
    const absolutePath = path.join(vaultRoot, relativePath);
    const raw = readFileSync(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/u);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        records.push({
          ok: true,
          relativePath,
          lineNumber: index + 1,
          value: JSON.parse(line) as unknown,
        });
      } catch (error) {
        records.push(buildJsonParseFailure(relativePath, index + 1, error));
      }
    }
  }

  return records;
}
