import path from "node:path";
import { z } from "zod";

export type FrontmatterScalar = string | number | boolean | null;
export type FrontmatterValue =
  | FrontmatterScalar
  | FrontmatterObject
  | FrontmatterValue[];

export interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

export interface FrontmatterDocument {
  attributes: FrontmatterObject;
  body: string;
}

export interface MarkdownDocumentRecord {
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

interface MeaningfulLine {
  index: number;
  line: string;
  indent: number;
  text: string;
}

interface ParseResult<TValue> {
  value: TValue;
  index: number;
}

const plainObjectSchema: z.ZodType<Record<string, unknown>> = z.object({}).catchall(z.unknown());
const trimmedNonEmptyStringSchema: z.ZodType<string> = z
  .string()
  .transform((value: string) => value.trim())
  .pipe(z.string().min(1));
const finiteNumberSchema: z.ZodType<number> = z.number().finite();
const booleanSchema: z.ZodType<boolean> = z.boolean();
const trimmedStringListSchema: z.ZodType<string[]> = z.array(z.unknown()).transform((entries: unknown[]) =>
  entries.flatMap((entry: unknown) => {
    const parsed = trimmedNonEmptyStringSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
);

function parseNullable<TValue>(
  schema: z.ZodType<TValue>,
  value: unknown,
): TValue | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function countIndentation(line: string): number {
  const match = line.match(/^ */u);
  return match ? match[0].length : 0;
}

function parseScalar(value: string): FrontmatterValue {
  if (value === "null") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "[]") {
    return [];
  }

  if (value === "{}") {
    return {};
  }

  if (/^-?\d+(\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  if (value.startsWith('"')) {
    return JSON.parse(value) as string;
  }

  return value;
}

function nextMeaningfulLine(
  lines: string[],
  startIndex: number,
): MeaningfulLine | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line?.trim()) {
      continue;
    }

    return {
      index,
      line,
      indent: countIndentation(line),
      text: line.trimStart(),
    };
  }

  return null;
}

function parseArray(
  lines: string[],
  startIndex: number,
  indent: number,
): ParseResult<FrontmatterValue[]> {
  const value: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);
    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      throw new Error(`Unexpected array indentation at line ${index + 1}.`);
    }

    const trimmed = line.slice(indent);
    if (!trimmed.startsWith("-")) {
      break;
    }

    const remainder = trimmed.slice(1).trimStart();
    if (remainder) {
      value.push(parseScalar(remainder));
      index += 1;
      continue;
    }

    index += 1;

    const nested = nextMeaningfulLine(lines, index);
    if (!nested || nested.indent <= indent) {
      value.push({});
      continue;
    }

    if (nested.indent !== indent + 2) {
      throw new Error(`Unexpected nested array indentation at line ${nested.index + 1}.`);
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(lines, nested.index, nested.indent);
      value.push(result.value);
      index = result.index;
      continue;
    }

    const result = parseObject(lines, nested.index, nested.indent);
    value.push(result.value);
    index = result.index;
  }

  return { value, index };
}

function parseObject(
  lines: string[],
  startIndex: number,
  indent: number,
): ParseResult<FrontmatterObject> {
  const value: FrontmatterObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);
    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      throw new Error(`Unexpected object indentation at line ${index + 1}.`);
    }

    const trimmed = line.slice(indent);
    if (trimmed.startsWith("-")) {
      break;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Expected "key: value" frontmatter at line ${index + 1}.`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder) {
      value[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    index += 1;

    const nested = nextMeaningfulLine(lines, index);
    if (!nested || nested.indent <= indent) {
      value[key] = {};
      continue;
    }

    if (nested.indent !== indent + 2) {
      throw new Error(`Unexpected nested object indentation at line ${nested.index + 1}.`);
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(lines, nested.index, nested.indent);
      value[key] = result.value;
      index = result.index;
      continue;
    }

    const result = parseObject(lines, nested.index, nested.indent);
    value[key] = result.value;
    index = result.index;
  }

  return { value, index };
}

export function parseFrontmatterDocument(
  documentText: string,
): FrontmatterDocument {
  const normalized = String(documentText ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    return {
      attributes: {},
      body: normalized.trim(),
    };
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    throw new Error("Frontmatter block is missing a closing delimiter.");
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n").trim();

  if (frontmatterLines.every((line) => !line.trim())) {
    return {
      attributes: {},
      body,
    };
  }

  const parsed = parseObject(frontmatterLines, 0, 0);
  const trailing = nextMeaningfulLine(frontmatterLines, parsed.index);

  if (trailing) {
    throw new Error(`Unexpected trailing frontmatter content at line ${trailing.index + 1}.`);
  }

  return {
    attributes: parsed.value,
    body,
  };
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return parseNullable<Record<string, unknown>>(plainObjectSchema, value);
}

export function firstString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const parsed = parseNullable(trimmedNonEmptyStringSchema, source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function firstNumber(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const parsed = parseNullable(finiteNumberSchema, source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function firstBoolean(
  source: Record<string, unknown>,
  keys: readonly string[],
): boolean | null {
  for (const key of keys) {
    const parsed = parseNullable(booleanSchema, source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function firstObject(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const parsed = parseNullable<Record<string, unknown>>(plainObjectSchema, source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function firstStringArray(
  source: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = source[key];

    if (!Array.isArray(value)) {
      continue;
    }

    return trimmedStringListSchema.parse(value);
  }

  return [];
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return trimmedStringListSchema.parse(value);
}

export function compareNullableStrings(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";
  return normalizedLeft.localeCompare(normalizedRight);
}

export function matchesText(
  values: unknown[],
  text: string | undefined,
): boolean {
  if (!text?.trim()) {
    return true;
  }

  const haystack = values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  return haystack.includes(text.trim().toLowerCase());
}

export function matchesStatus(
  value: string | null | undefined,
  status: string | string[] | undefined,
): boolean {
  if (status === undefined) {
    return true;
  }

  const candidates = Array.isArray(status) ? status : [status];
  const normalized = candidates
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());

  if (normalized.length === 0) {
    return true;
  }

  return value ? normalized.includes(value.toLowerCase()) : false;
}

export function matchesDateRange(
  value: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!value) {
    return !from && !to;
  }

  if (from && value < from) {
    return false;
  }

  if (to && value > to) {
    return false;
  }

  return true;
}

export function applyLimit<TValue>(
  values: TValue[],
  limit?: number,
): TValue[] {
  if (!Number.isInteger(limit) || (limit as number) < 1) {
    return values;
  }

  return values.slice(0, limit);
}

export function matchesLookup(
  lookup: string,
  ...candidates: Array<string | null | undefined>
): boolean {
  const normalized = lookup.trim().toLowerCase();

  return candidates.some(
    (candidate) => typeof candidate === "string" && candidate.trim().toLowerCase() === normalized,
  );
}

export function pathSlug(relativePath: string): string {
  return path.posix.basename(relativePath, path.posix.extname(relativePath));
}

export function maybeString(value: unknown): string | null {
  return parseNullable(trimmedNonEmptyStringSchema, value);
}
