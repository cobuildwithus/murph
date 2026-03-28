import path from "node:path";
import {
  parseFrontmatterDocument as parseSharedFrontmatterDocument,
  type FrontmatterParseProblem,
} from "@murph/contracts";
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

function formatFrontmatterProblem(problem: FrontmatterParseProblem): Error {
  const lineNumber = problem.index === undefined ? null : problem.index + 1;

  switch (problem.code) {
    case "missing_closing_delimiter":
      return new Error(problem.message);
    case "unexpected_array_indentation":
      return new Error(`Unexpected array indentation at line ${lineNumber}.`);
    case "unexpected_nested_array_indentation":
      return new Error(`Unexpected nested array indentation at line ${lineNumber}.`);
    case "unexpected_object_indentation":
      return new Error(`Unexpected object indentation at line ${lineNumber}.`);
    case "expected_key_value":
      return new Error(`Expected "key: value" frontmatter at line ${lineNumber}.`);
    case "unexpected_nested_object_indentation":
      return new Error(`Unexpected nested object indentation at line ${lineNumber}.`);
    case "unexpected_trailing_content":
      return new Error(`Unexpected trailing frontmatter content at line ${lineNumber}.`);
  }

  return new Error(problem.message);
}

export function parseFrontmatterDocument(
  documentText: string,
): FrontmatterDocument {
  const parsed = parseSharedFrontmatterDocument(documentText, {
    mode: "strict",
    bodyNormalization: "trim",
    createError: formatFrontmatterProblem,
  });

  return {
    attributes: parsed.attributes,
    body: parsed.body,
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
