import type { ContractSchema } from "@murph/contracts";
import { safeParseContract } from "@murph/contracts";

import { VaultError } from "../errors.ts";
import { parseFrontmatterDocument } from "../frontmatter.ts";
import { readUtf8File } from "../fs.ts";
import { runCanonicalWrite, type WriteBatch } from "../operations/write-batch.ts";
import { loadVault } from "../vault.ts";

import type { DateInput } from "../types.ts";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface CanonicalWriteInput<TResult> {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  mutate: (context: { batch: WriteBatch; vaultRoot: string }) => Promise<TResult>;
}

export function compactObject<TRecord extends Record<string, unknown>>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function uniqueTrimmedStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined;
}

export function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function replaceMarkdownHeading(body: string, title: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("# ")) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`);
  }

  return `# ${title}\n\n${body.trimStart()}`;
}

export function ensureMarkdownHeading(body: string, title: string): string {
  return replaceMarkdownHeading(body, title);
}

export function appendMarkdownParagraph(body: string, text: string): string {
  const trimmedBody = body.trimEnd();
  const trimmedText = text.trim();

  if (trimmedBody.length === 0) {
    return `${trimmedText}\n`;
  }

  return `${trimmedBody}\n\n${trimmedText}\n`;
}

export function replaceMarkdownTitle(body: string, title: string): string {
  return replaceMarkdownHeading(body, title);
}

export function normalizeTimestampInput(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new VaultError("INVALID_TIMESTAMP", `Invalid timestamp "${String(value)}".`);
  }

  return date.toISOString();
}

export function normalizeLocalDate(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return LOCAL_DATE_PATTERN.test(value) ? value : undefined;
}

export function validateContract<TContract>(
  schema: ContractSchema<TContract>,
  value: unknown,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): TContract {
  const result = safeParseContract(schema, value);
  if (!result.success) {
    throw new VaultError(code, message, {
      ...details,
      errors: result.errors,
    });
  }

  return result.data;
}

export function safeParseFrontmatterDocument<TContract>(
  schema: ContractSchema<TContract>,
  markdown: string,
  relativePath: string,
  code: string,
  message: string,
): {
  attributes: TContract;
  body: string;
} {
  const document = parseFrontmatterDocument(markdown);
  return {
    attributes: validateContract(schema, document.attributes, code, message, {
      relativePath,
    }),
    body: document.body,
  };
}

export async function readValidatedFrontmatterDocument<TContract>(
  vaultRoot: string,
  relativePath: string,
  schema: ContractSchema<TContract>,
  code: string,
  message: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: TContract;
    body: string;
  };
}> {
  const rawDocument = await readUtf8File(vaultRoot, relativePath);
  return {
    rawDocument,
    document: safeParseFrontmatterDocument(schema, rawDocument, relativePath, code, message),
  };
}

export async function runLoadedCanonicalWrite<TResult>(
  input: CanonicalWriteInput<TResult>,
): Promise<TResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  return runCanonicalWrite(input);
}
